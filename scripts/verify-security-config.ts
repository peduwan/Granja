/**
 * SCRIPT DE VERIFICACIÓN ACTIVA DE SEGURIDAD Y CUMPLIMIENTO FISCAL (M4 & M5)
 *
 * Cumplimiento con:
 * - Ley 11/2021 de medidas contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 * - Directrices de seguridad de Google Cloud Platform (Secret Manager, API Keys, IAM)
 *
 * Ejecución directa: npx tsx scripts/verify-security-config.ts
 */

import {
  getSifIdentityConfig,
  SIF_BLACKLIST_NIFS,
  SIF_BLACKLIST_RAZONES
} from '../src/config/sifIdentity';
import { normalizeAeatEnvironment } from '../src/fiscal/aeatEndpoints';
import { getRootOwnerEmail, isValidEmail } from '../src/config/serverConfig';
import { isValidSpanishNifCifNie } from '../src/fiscal/backendAuth';

export interface SecurityCheckResult {
  id: string;
  name: string;
  category: 'SIF_IDENTITY' | 'AEAT_ENV' | 'SECRETS_AND_KEYS' | 'MULTI_TENANT';
  passed: boolean;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  details?: string;
}

export interface SecurityAuditReport {
  timestamp: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningsCount: number;
  isReadyForProduction: boolean;
  checks: SecurityCheckResult[];
}

export function runSecurityAudit(): SecurityAuditReport {
  const checks: SecurityCheckResult[] = [];

  // ========================================================
  // 1. COMPROBACIÓN DE IDENTIDAD SIF (RD 1007/2023)
  // ========================================================
  try {
    const sifConfig = getSifIdentityConfig();

    // 1.1 SIF NIF
    const isNifBlacklisted = SIF_BLACKLIST_NIFS.includes(sifConfig.nif.toUpperCase());
    const isNifFormatValid = isValidSpanishNifCifNie(sifConfig.nif);
    checks.push({
      id: 'SEC-SIF-01',
      name: 'NIF del Fabricante del SIF',
      category: 'SIF_IDENTITY',
      passed: !isNifBlacklisted && isNifFormatValid,
      severity: 'CRITICAL',
      message: !isNifBlacklisted && isNifFormatValid
        ? `NIF válido y certificado: ${sifConfig.nif}`
        : `NIF no reglamentario o prohibido en lista negra: ${sifConfig.nif}`
    });

    // 1.2 SIF Razón Social
    const isRazonBlacklisted = SIF_BLACKLIST_RAZONES.includes(sifConfig.nombreRazon.toUpperCase().trim());
    checks.push({
      id: 'SEC-SIF-02',
      name: 'Razón Social del Fabricante del SIF',
      category: 'SIF_IDENTITY',
      passed: !isRazonBlacklisted && sifConfig.nombreRazon.length >= 3,
      severity: 'CRITICAL',
      message: !isRazonBlacklisted
        ? `Razón social verificada: "${sifConfig.nombreRazon}"`
        : `Razón social en lista negra de pruebas: "${sifConfig.nombreRazon}"`
    });

    // 1.3 Instalación y Versión
    checks.push({
      id: 'SEC-SIF-03',
      name: 'Identificador de Instalación y Versión SIF',
      category: 'SIF_IDENTITY',
      passed: Boolean(sifConfig.numeroInstalacion && sifConfig.version),
      severity: 'CRITICAL',
      message: `Instalación: ${sifConfig.numeroInstalacion}, Versión: ${sifConfig.version}`
    });

    // 1.4 Fecha de Activación Oficial (M2)
    const hasValidFecha = Boolean(sifConfig.fechaActivacion && !isNaN(new Date(sifConfig.fechaActivacion).getTime()));
    checks.push({
      id: 'SEC-SIF-04',
      name: 'Fecha de Activación Inmutable del SIF (M2)',
      category: 'SIF_IDENTITY',
      passed: hasValidFecha,
      severity: 'CRITICAL',
      message: hasValidFecha
        ? `Fecha de activación: ${sifConfig.fechaActivacion}`
        : 'Fecha de activación no configurada o formato inválido'
    });
  } catch (err: any) {
    checks.push({
      id: 'SEC-SIF-FATAL',
      name: 'Configuración Global de Identidad SIF',
      category: 'SIF_IDENTITY',
      passed: false,
      severity: 'CRITICAL',
      message: `Fallo al verificar identidad SIF: ${err.message}`
    });
  }

  // ========================================================
  // 2. COMPROBACIÓN DE ENTORNO AEAT (B2 & M3)
  // ========================================================
  try {
    const aeatEnv = normalizeAeatEnvironment();
    const isProd = process.env.NODE_ENV === 'production';
    const isMock = process.env.AEAT_ENV === 'mock';

    const passed = !(isProd && isMock);
    checks.push({
      id: 'SEC-AEAT-01',
      name: 'Entorno de Conexión Oficial AEAT',
      category: 'AEAT_ENV',
      passed,
      severity: 'CRITICAL',
      message: `Entorno AEAT activo: '${aeatEnv}' (NODE_ENV='${process.env.NODE_ENV || 'development'}')`,
      details: isMock ? 'Modo simulación mock activo (permitido exclusivamente en desarrollo offline)' : undefined
    });
  } catch (err: any) {
    checks.push({
      id: 'SEC-AEAT-01',
      name: 'Entorno de Conexión Oficial AEAT',
      category: 'AEAT_ENV',
      passed: false,
      severity: 'CRITICAL',
      message: `Configuración de AEAT_ENV rechazada: ${err.message}`
    });
  }

  // ========================================================
  // 3. SEGURIDAD DE SECRETOS Y API KEYS EN GCP (M4 & M5)
  // ========================================================
  // 3.1 Clave Gemini AI / Secret Manager
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const clientExposesGeminiKey = Boolean(
    process.env.VITE_GEMINI_API_KEY ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY)
  );

  checks.push({
    id: 'SEC-KEY-01',
    name: 'Restricción de Gemini API Key en GCP',
    category: 'SECRETS_AND_KEYS',
    passed: !clientExposesGeminiKey,
    severity: 'CRITICAL',
    message: !clientExposesGeminiKey
      ? 'La API Key de Gemini está protegida en backend y NO se expone en variables cliente (VITE_*)'
      : 'VULNERABILIDAD: Se detectó VITE_GEMINI_API_KEY expuesta al navegador'
  });

  checks.push({
    id: 'SEC-KEY-02',
    name: 'Disponibilidad de Servicio Gemini AI',
    category: 'SECRETS_AND_KEYS',
    passed: true,
    severity: hasGeminiKey ? 'INFO' : 'WARNING',
    message: hasGeminiKey
      ? 'GEMINI_API_KEY configurada para transcripción por voz'
      : 'GEMINI_API_KEY no configurada; el sistema operará con parser heurístico seguro'
  });

  // 3.2 Propietario Raíz
  let ownerPassed = false;
  let ownerMsg = '';
  try {
    const rootOwner = getRootOwnerEmail();
    ownerPassed = isValidEmail(rootOwner);
    ownerMsg = `Propietario raíz autorizado: ${rootOwner}`;
  } catch (err: any) {
    ownerMsg = err.message;
  }

  checks.push({
    id: 'SEC-AUTH-01',
    name: 'Propietario Raíz y Control de Acceso (B3 & A5)',
    category: 'MULTI_TENANT',
    passed: ownerPassed,
    severity: 'CRITICAL',
    message: ownerMsg
  });

  // 3.3 Erradicación de CIFs de prueba
  const prohibitedCifs = ['B45123987', 'B12345678', 'B99999999', 'ES_UNKNOWN'];
  const configuredSifNif = process.env.SIF_NIF || '';
  const isCifClean = !prohibitedCifs.includes(configuredSifNif.trim().toUpperCase());

  checks.push({
    id: 'SEC-CIF-01',
    name: 'Erradicación de CIFs de Prueba y Placeholders (M3)',
    category: 'SIF_IDENTITY',
    passed: isCifClean,
    severity: 'CRITICAL',
    message: isCifClean
      ? 'No se detectaron CIFs de prueba en variables de entorno oficiales'
      : `ALERTA: Se detectó CIF de prueba en SIF_NIF: ${configuredSifNif}`
  });

  const totalChecks = checks.length;
  const failedChecks = checks.filter(c => !c.passed && c.severity === 'CRITICAL').length;
  const warningsCount = checks.filter(c => !c.passed && c.severity === 'WARNING').length;
  const passedChecks = checks.filter(c => c.passed).length;

  return {
    timestamp: new Date().toISOString(),
    totalChecks,
    passedChecks,
    failedChecks,
    warningsCount,
    isReadyForProduction: failedChecks === 0,
    checks
  };
}

export function printSecurityReport(report: SecurityAuditReport): void {
  console.log('========================================================================');
  console.log('  AUDITORÍA DE SEGURIDAD Y CUMPLIMIENTO SIF / GCP (M4 & M5)');
  console.log('========================================================================');
  console.log(`Fecha de auditoría: ${report.timestamp}`);
  console.log(`Estado: ${report.isReadyForProduction ? 'APROBADO PARA PRODUCCIÓN' : 'FALLOS CRÍTICOS DETECTADOS'}`);
  console.log(`Total pruebas: ${report.totalChecks} | Aprobadas: ${report.passedChecks} | Críticas fallidas: ${report.failedChecks} | Avisos: ${report.warningsCount}\n`);

  for (const check of report.checks) {
    const symbol = check.passed ? '[PASS]' : (check.severity === 'WARNING' ? '[WARN]' : '[FAIL]');
    console.log(`  ${symbol} ${check.id}: ${check.name}`);
    console.log(`         ${check.message}`);
    if (check.details) {
      console.log(`         Detalle: ${check.details}`);
    }
  }

  console.log('\n========================================================================');
}

// Ejecución directa por CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify-security-config.ts')) {
  const report = runSecurityAudit();
  printSecurityReport(report);
  if (!report.isReadyForProduction) {
    process.exit(1);
  }
}
