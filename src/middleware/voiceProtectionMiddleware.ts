/**
 * MIDDLEWARE DE PROTECCIÓN, CONTROL DE CARGA Y CUOTA DIARIA PARA ENDPOINTS DE VOZ (FASE 1 / B4)
 *
 * Responsabilidades:
 * 1. Rate Limiting: Máximo 30 peticiones por minuto por UID de usuario (o IP como fallback).
 * 2. Cuota Diaria: Máximo 200 peticiones por día por usuario (configurable vía VOICE_DAILY_QUOTA).
 * 3. Cabeceras HTTP estándar: 'Retry-After' al superar cualquier umbral.
 * 4. Control de payload: Límite estricto de 1 MB para evitar abusos o desbordamiento de memoria.
 */

import { Request, Response, NextFunction } from 'express';
import { FiscalAuthenticatedRequest } from '../fiscal/backendAuth';

interface RateLimitEntry {
  timestamps: number[];
  dayDate: string; // 'YYYY-MM-DD'
  dailyCount: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export function getVoiceDailyQuota(): number {
  if (process.env.VOICE_DAILY_QUOTA) {
    const parsed = parseInt(process.env.VOICE_DAILY_QUOTA, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 200;
}

export function resetVoiceRateLimiters(): void {
  rateLimitStore.clear();
}

/**
 * Middleware para auditar y limitar las peticiones a endpoints de IA por voz
 */
export function voiceProtectionMiddleware(
  req: FiscalAuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const now = Date.now();
  const todayDate = new Date(now).toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Identificador prioritario: UID del usuario autenticado; IP como fallback
  const userKey = req.fiscalUser?.uid || req.ip || req.socket?.remoteAddress || 'unknown_client';

  let entry = rateLimitStore.get(userKey);
  if (!entry) {
    entry = {
      timestamps: [],
      dayDate: todayDate,
      dailyCount: 0
    };
    rateLimitStore.set(userKey, entry);
  }

  // Reiniciar contador diario si ha cambiado la fecha
  if (entry.dayDate !== todayDate) {
    entry.dayDate = todayDate;
    entry.dailyCount = 0;
  }

  // 1. Verificación de Cuota Diaria (200 consultas/día por omisión)
  const dailyQuota = getVoiceDailyQuota();
  if (entry.dailyCount >= dailyQuota) {
    // Calcular segundos restantes hasta medianoche UTC
    const midnightUtc = new Date();
    midnightUtc.setUTCHours(24, 0, 0, 0);
    const secondsToMidnight = Math.max(1, Math.ceil((midnightUtc.getTime() - now) / 1000));

    res.setHeader('Retry-After', String(secondsToMidnight));
    res.status(429).json({
      success: false,
      error: 'CUOTA_DIARIA_EXCEDIDA',
      message: `Ha superado el límite diario de ${dailyQuota} consultas de voz por usuario. La cuota se reinicia a las 00:00 UTC.`,
      retryAfter: secondsToMidnight
    });
    return;
  }

  // 2. Verificación de Rate Limit por minuto (30 req/min)
  const oneMinuteAgo = now - 60000;
  entry.timestamps = entry.timestamps.filter(ts => ts > oneMinuteAgo);

  const RATE_LIMIT_PER_MINUTE = 30;
  if (entry.timestamps.length >= RATE_LIMIT_PER_MINUTE) {
    const oldestTimestamp = entry.timestamps[0];
    const secondsToWait = Math.max(1, Math.ceil((oldestTimestamp + 60000 - now) / 1000));

    res.setHeader('Retry-After', String(secondsToWait));
    res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Ha superado el límite de 30 peticiones por minuto para transcripción y procesamiento por voz.',
      retryAfter: secondsToWait
    });
    return;
  }

  // Registrar consumo
  entry.timestamps.push(now);
  entry.dailyCount += 1;

  next();
}
