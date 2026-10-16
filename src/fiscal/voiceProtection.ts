/**
 * MIDDLEWARE DE SEGURIDAD Y CONTROL DE CONSUMO PARA ENDPOINTS DE VOZ (B4)
 * Cumplimiento con auditoría de seguridad: Autenticación obligatoria, Rate-Limiting estricto (30/min),
 * Cuota diaria (200/día) y límite de tamaño de carga útil (1MB).
 */

import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseIdToken, FiscalAuthenticatedUser } from './backendAuth';

export interface VoiceAuthenticatedRequest extends Request {
  voiceUser?: FiscalAuthenticatedUser;
}

interface RateLimitBucket {
  count: number;
  resetTime: number; // timestamp ms
}

interface DailyQuotaBucket {
  count: number;
  dateStr: string; // YYYY-MM-DD
}

// Registro en memoria para ventanas de 1 minuto por UID / IP
const minuteBuckets = new Map<string, RateLimitBucket>();
// Registro en memoria para cuota diaria por UID / IP
const dailyBuckets = new Map<string, DailyQuotaBucket>();

const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_REQUESTS_PER_DAY = 200;
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1MB

/**
 * Helper para reiniciar contadores en pruebas unitarias
 */
export function resetVoiceRateLimits(): void {
  minuteBuckets.clear();
  dailyBuckets.clear();
}

/**
 * Helper para reiniciar únicamente la ventana por minuto (para simulación de cuota diaria en tests)
 */
export function resetVoiceMinuteWindow(key?: string): void {
  if (key) {
    minuteBuckets.delete(key);
  } else {
    minuteBuckets.clear();
  }
}

/**
 * Obtiene el uso actual para inspección o tests
 */
export function getVoiceUsage(key: string): { minuteCount: number; dailyCount: number } {
  const min = minuteBuckets.get(key)?.count || 0;
  const day = dailyBuckets.get(key)?.count || 0;
  return { minuteCount: min, dailyCount: day };
}

/**
 * Middleware de protección de voz:
 * 1. Tamaño máximo de payload <= 1MB
 * 2. Autenticación Firebase ID Token obligatoria
 * 3. Rate limiting estricto (30 peticiones/minuto por UID o IP)
 * 4. Cuota diaria (200 peticiones/día por UID o IP)
 */
export async function voiceProtectionMiddleware(
  req: VoiceAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  // 1. Verificación preventiva de tamaño del payload
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({
      error: 'Carga útil excesiva: El audio o dictado enviado supera el límite reglamentario de 1MB.',
      maxBytes: MAX_PAYLOAD_BYTES
    });
  }

  // 2. Autenticación obligatoria de Firebase
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'No autorizado: Se requiere token de sesión activo (Bearer token) para utilizar las funciones de voz.'
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({
      error: 'No autorizado: Token de autenticación vacío.'
    });
  }

  let authenticatedUser: FiscalAuthenticatedUser;
  try {
    authenticatedUser = await verifyFirebaseIdToken(token);
    req.voiceUser = authenticatedUser;
  } catch (err: any) {
    return res.status(401).json({
      error: `Autenticación rechazada: ${err.message || 'Token inválido o expirado'}`
    });
  }

  // 3. Clave identificadora para límites: Priorizar UID del usuario autenticado; si no, IP
  const clientKey = authenticatedUser.uid || (req.ip || req.socket.remoteAddress || 'unknown-client');
  const now = Date.now();
  const todayDateStr = new Date(now).toISOString().split('T')[0];

  // 4. Rate-Limiting: 30 peticiones / minuto
  let minBucket = minuteBuckets.get(clientKey);
  if (!minBucket || now > minBucket.resetTime) {
    minBucket = { count: 0, resetTime: now + 60_000 };
    minuteBuckets.set(clientKey, minBucket);
  }

  if (minBucket.count >= MAX_REQUESTS_PER_MINUTE) {
    const retryAfterSeconds = Math.max(1, Math.ceil((minBucket.resetTime - now) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds);
    return res.status(429).json({
      error: `Límite de velocidad excedido: Máximo ${MAX_REQUESTS_PER_MINUTE} peticiones por minuto para transcripción por voz.`,
      retryAfterSeconds
    });
  }

  // 5. Cuota diaria: 200 peticiones / día
  let dayBucket = dailyBuckets.get(clientKey);
  if (!dayBucket || dayBucket.dateStr !== todayDateStr) {
    dayBucket = { count: 0, dateStr: todayDateStr };
    dailyBuckets.set(clientKey, dayBucket);
  }

  if (dayBucket.count >= MAX_REQUESTS_PER_DAY) {
    return res.status(429).json({
      error: `Cuota diaria agotada: Se ha alcanzado el límite de ${MAX_REQUESTS_PER_DAY} peticiones diarias de voz para este usuario.`,
      limiteDiario: MAX_REQUESTS_PER_DAY,
      fecha: todayDateStr
    });
  }

  // Incrementar contadores
  minBucket.count++;
  dayBucket.count++;

  // Inyectar cabeceras informativas
  res.setHeader('X-RateLimit-Limit-Minute', MAX_REQUESTS_PER_MINUTE);
  res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, MAX_REQUESTS_PER_MINUTE - minBucket.count));
  res.setHeader('X-RateLimit-Limit-Day', MAX_REQUESTS_PER_DAY);
  res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, MAX_REQUESTS_PER_DAY - dayBucket.count));

  next();
}
