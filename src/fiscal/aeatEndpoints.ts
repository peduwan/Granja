/**
 * ÚNICA FUENTE DE VERDAD DE ENDPOINTS AEAT VERI*FACTU (FASE 3.1.1)
 *
 * Normativa y Documentación Técnica Oficial AEAT:
 * - «Documento técnico de especificaciones del servicio web de los sistemas de facturación verificables (VERI*FACTU)» v1.0
 * - Departamento de Informática Tributaria — AEAT (Noviembre 2024 / Orden HAC/1177/2024)
 * - Esquemas WSDL Document/Literal: SuministroLR.xsd y RespuestaSuministro.xsd
 *
 * REGLAS:
 * 1. Centralización absoluta: ninguna URL de la AEAT debe estar duplicada ni hardcodeada fuera de este módulo.
 * 2. Soporte para certificados estándar (persona física/jurídica/representante) y certificados de sello electrónico.
 * 3. En entorno 'mock', los endpoints son puramente virtuales (mock://...) y NUNCA realizan resolución DNS ni peticiones de red.
 */

export type AeatEnvironment = 'production' | 'test' | 'mock';
export type AeatCertificateType = 'standard' | 'sello';

export const AEAT_OFFICIAL_ENDPOINTS = {
  // Servicio Web SOAP de Remisión Veri*Factu (SuministroLR) según SistemaFacturacion.wsdl
  soap: {
    production: {
      standard: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
      sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP'
    },
    test: {
      standard: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
      sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP'
    },
    mock: 'mock://aeat.local/ws/SistemaFacturacion/VerifactuSOAP'
  },
  // Servicio Web de Validación y Cotejo de Código QR de la Sede Electrónica
  qr: {
    production: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
    test: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
    mock: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
  }
} as const;

/**
 * Normaliza y valida estrictamente el entorno de conexión con la AEAT.
 * Contrato estricto: Solo se admiten 'production' o 'test' (y 'mock' en desarrollo).
 * En caso de valor desconocido, erróneo o intento de usar 'mock' en producción, lanza error fatal.
 */
export function normalizeAeatEnvironment(envInput?: string): AeatEnvironment {
  const isProdNode = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
  const isTestNode = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

  let raw = envInput;
  if (!raw && typeof process !== 'undefined') {
    if (process.env.AEAT_ENV) {
      raw = process.env.AEAT_ENV;
    } else if (process.env.AEAT_ENVIRONMENT) {
      console.warn('[AEAT_ENV_DEPRECATION] Uso de AEAT_ENVIRONMENT detectado. Por favor, migre a AEAT_ENV.');
      raw = process.env.AEAT_ENVIRONMENT;
    }
  }

  if (!raw) {
    if (isProdNode) {
      throw new Error(
        '[AEAT_ENV_FATAL] Variable de entorno AEAT_ENV obligatoria en producción. ' +
        "Debe configurarse explícitamente como 'test' o 'production'."
      );
    }
    return isTestNode ? 'mock' : 'test';
  }

  const clean = raw.trim().toLowerCase();

  if (clean === 'production' || clean === 'produccion' || clean === 'prod') {
    return 'production';
  }

  if (clean === 'test' || clean === 'pruebas' || clean === 'testing' || clean === 'pre' || clean === 'preproduccion') {
    return 'test';
  }

  if (clean === 'mock') {
    if (isProdNode) {
      throw new Error(
        '[AEAT_ENV_FATAL] Prohibido terminantemente el modo mock en entorno de producción (NODE_ENV=production). ' +
        "Debe utilizarse 'test' o 'production'."
      );
    }
    return 'mock';
  }

  throw new Error(
    `[AEAT_ENV_FATAL] Valor de entorno AEAT no permitido: '${raw}'. ` +
    "Solo se admiten estrictamente 'test' o 'production' (y 'mock' en desarrollo local)."
  );
}

/**
 * Resuelve la URL oficial del servicio web SOAP según el entorno y tipo de certificado.
 */
export function getAeatSoapEndpoint(
  environment?: AeatEnvironment | string,
  certType: AeatCertificateType = 'standard'
): string {
  const env = normalizeAeatEnvironment(environment);

  if (env === 'mock') {
    return AEAT_OFFICIAL_ENDPOINTS.soap.mock;
  }

  if (env === 'production') {
    return certType === 'sello'
      ? AEAT_OFFICIAL_ENDPOINTS.soap.production.sello
      : AEAT_OFFICIAL_ENDPOINTS.soap.production.standard;
  }

  return certType === 'sello'
    ? AEAT_OFFICIAL_ENDPOINTS.soap.test.sello
    : AEAT_OFFICIAL_ENDPOINTS.soap.test.standard;
}

/**
 * Resuelve la URL oficial de cotejo QR de la AEAT según el entorno.
 */
export function getAeatQrEndpoint(environment?: AeatEnvironment | string): string {
  const env = normalizeAeatEnvironment(environment);

  if (env === 'production') {
    return AEAT_OFFICIAL_ENDPOINTS.qr.production;
  }
  return AEAT_OFFICIAL_ENDPOINTS.qr.test;
}
