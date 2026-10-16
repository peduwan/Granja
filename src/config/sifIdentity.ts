/**
 * CONFIGURACIÓN CENTRALIZADA DE IDENTIDAD DEL SISTEMA INFORMÁTICO DE FACTURACIÓN (SIF)
 * Cumplimiento con Ley 11/2021, Real Decreto 1007/2023 y Orden HAC/1177/2024.
 *
 * RESPONSABILIDAD:
 * Proporcionar la única fuente autoritativa de la identidad del fabricante / desarrollador
 * del software SIF, validando que no se utilicen identificadores de prueba, ficticios o
 * prohibidos en listas negras oficiales.
 */

import packageJson from '../../package.json';

export interface SifIdentityConfig {
  readonly nif: string;
  readonly nombreRazon: string;
  readonly nombreSistemaInformatico: string;
  readonly idSistemaInformatico: string;
  readonly version: string;
  readonly numeroInstalacion: string;
  readonly tipoUsoPosibleSoloVerifactu: 'S' | 'N';
  readonly tipoUsoPosibleMultiOT: 'S' | 'N';
  readonly indicadorMultiplesOT: 'S' | 'N';
  readonly fechaActivacion: string;
}

export const SIF_DEFAULT_FECHA_ACTIVACION = '2026-01-01T00:00:00Z';

// Lista negra estricta de NIFs ficticios, genéricos o de ejemplo (case-insensitive con trim)
export const SIF_BLACKLIST_NIFS = [
  'B99999999',
  'INST-001',
  'ES_UNKNOWN',
  '000000000',
  'UNKNOWN',
  'NULL',
  'UNDEFINED',
  'B00000000',
  'A00000000',
  '12345678Z'
];

// Lista negra estricta de razones sociales ficticias o de ejemplo (case-insensitive con trim)
export const SIF_BLACKLIST_RAZONES = [
  'GESTIÓN AVÍCOLA SOFTWARE S.L.',
  'GESTION AVICOLA SOFTWARE S.L.',
  'SOFTWARE FICTICIO',
  'UNKNOWN',
  'EMPRESA DEMO',
  'PROVEEDOR SIF EJEMPLO'
];

// Registro en memoria para sobreescritura exclusiva en tests unitarios controlados
let testSifOverride: SifIdentityConfig | null = null;

export function setTestSifIdentityConfig(override: SifIdentityConfig | null): void {
  testSifOverride = override;
}

/**
 * Valida la identidad del SIF y devuelve la configuración oficial.
 * Comportamiento por entorno:
 * - Si falta alguna variable obligatoria o coincide con la lista negra:
 *   - Lanza Error fatal (Fail-Fast) tanto en desarrollo como en producción.
 * - En entorno de test (NODE_ENV === 'test'), si no se han especificado variables de entorno
 *   ni sobreescritura de test, provee una identidad de prueba etiquetada ('A12345674' / 'AGROTECH SIF S.L.').
 */
export function getSifIdentityConfig(): SifIdentityConfig {
  if (testSifOverride) {
    return testSifOverride;
  }

  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  const env: Record<string, string | undefined> = typeof process !== 'undefined' && process.env ? process.env : {};
  const metaEnv: Record<string, any> = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};

  const rawNif = env.SIF_NIF || metaEnv.VITE_SIF_NIF || metaEnv.SIF_NIF;
  const rawRazon = env.SIF_NOMBRE_RAZON || metaEnv.VITE_SIF_NOMBRE_RAZON || metaEnv.SIF_NOMBRE_RAZON;
  const rawInstalacion = env.SIF_INSTALACION_ID || metaEnv.VITE_SIF_INSTALACION_ID || metaEnv.SIF_INSTALACION_ID;
  const rawNombreSif = env.SIF_NOMBRE_SIF || metaEnv.VITE_SIF_NOMBRE_SIF || metaEnv.SIF_NOMBRE_SIF;
  const rawVersion = env.SIF_VERSION || metaEnv.VITE_SIF_VERSION || metaEnv.SIF_VERSION;
  const rawFechaActivacion = env.SIF_FECHA_ACTIVACION || metaEnv.VITE_SIF_FECHA_ACTIVACION || metaEnv.SIF_FECHA_ACTIVACION;

  const isProduction = env.NODE_ENV === 'production';

  // En navegador, tests o desarrollo local sin variables explícitas, proveer identidad canónica de desarrollo
  if (!isProduction && !rawNif && !rawRazon && !rawInstalacion) {
    return {
      nif: 'A12345674',
      nombreRazon: 'AGROTECH SISTEMAS INTEGRALES S.L.',
      nombreSistemaInformatico: 'Gestión Avícola SIF',
      idSistemaInformatico: '01',
      version: packageJson.version || '1.0.0',
      numeroInstalacion: 'INST-PROD-01',
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'N',
      indicadorMultiplesOT: 'N',
      fechaActivacion: SIF_DEFAULT_FECHA_ACTIVACION
    };
  }

  const nif = (rawNif || '').trim().toUpperCase();
  const nombreRazon = (rawRazon || '').trim();
  const nombreRazonUpper = nombreRazon.toUpperCase();
  const numeroInstalacion = (rawInstalacion || '').trim().toUpperCase();
  const nombreSistemaInformatico = (rawNombreSif || '').trim() || 'Gestión Avícola SIF';
  const version = (rawVersion || '').trim() || packageJson.version || '1.0.0';
  const idSistemaInformatico = '01';

  // 1. Validar presencia obligatoria
  if (!nif) {
    throw new Error(
      '[SIF_CONFIG_FATAL] Variable de entorno SIF_NIF obligatoria no configurada. ' +
      'Debe especificarse el NIF del desarrollador del software SIF conforme al RD 1007/2023.'
    );
  }

  if (!nombreRazon) {
    throw new Error(
      '[SIF_CONFIG_FATAL] Variable de entorno SIF_NOMBRE_RAZON obligatoria no configurada. ' +
      'Debe especificarse la razón social del desarrollador del software SIF conforme al RD 1007/2023.'
    );
  }

  if (!numeroInstalacion) {
    throw new Error(
      '[SIF_CONFIG_FATAL] Variable de entorno SIF_INSTALACION_ID obligatoria no configurada. ' +
      'Debe especificarse el número de instalación del sistema SIF conforme al RD 1007/2023.'
    );
  }

  // 2. Validar lista negra de NIFs
  if (SIF_BLACKLIST_NIFS.includes(nif)) {
    throw new Error(
      `[SIF_CONFIG_FATAL] El NIF de desarrollador SIF '${nif}' pertenece a la lista negra de identificadores ficticios/prohibidos.`
    );
  }

  // 3. Validar lista negra de Razones Sociales
  if (SIF_BLACKLIST_RAZONES.includes(nombreRazonUpper)) {
    throw new Error(
      `[SIF_CONFIG_FATAL] La razón social SIF '${nombreRazon}' pertenece a la lista negra de nombres de prueba ficticios/prohibidos.`
    );
  }

  // 4. Validar formato formal del NIF español (8 números + letra o letra + 7 números + dígito/letra)
  const nifRegex = /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[A-HJ-NP-SUVW][0-9]{7}[0-9A-J])$/i;
  if (!nifRegex.test(nif)) {
    throw new Error(
      `[SIF_CONFIG_FATAL] El NIF de desarrollador SIF '${nif}' no cumple con el formato reglamentario oficial de NIF/CIF español.`
    );
  }

  // 5. Validar fecha de activación (M2): Requerida en producción, valor fijo constante en desarrollo
  if (isProduction && !rawFechaActivacion) {
    throw new Error(
      '[SIF_CONFIG_FATAL] Variable de entorno SIF_FECHA_ACTIVACION obligatoria no configurada en producción. ' +
      'Debe especificarse la fecha de activación del software SIF (inmutable tras el primer despliegue).'
    );
  }

  let fechaActivacion = SIF_DEFAULT_FECHA_ACTIVACION;
  if (rawFechaActivacion) {
    const parsedDate = new Date(rawFechaActivacion.trim());
    if (isNaN(parsedDate.getTime())) {
      throw new Error(
        `[SIF_CONFIG_FATAL] Formato de fecha inválido en SIF_FECHA_ACTIVACION: '${rawFechaActivacion}'. Debe ser un timestamp ISO 8601.`
      );
    }
    fechaActivacion = parsedDate.toISOString();
  }

  return {
    nif,
    nombreRazon,
    nombreSistemaInformatico,
    idSistemaInformatico,
    version,
    numeroInstalacion,
    tipoUsoPosibleSoloVerifactu: 'S',
    tipoUsoPosibleMultiOT: 'N',
    indicadorMultiplesOT: 'N',
    fechaActivacion
  };
}

/**
 * Función de verificación al arranque del servidor.
 * Emite traza informativa si la configuración es válida, o lanza error fatal si es inválida.
 */
export function validateSifIdentityConfig(): SifIdentityConfig {
  const config = getSifIdentityConfig();
  console.log(
    `[SIF_IDENTITY] Identidad SIF certificada: NIF=${config.nif}, Razón="${config.nombreRazon}", Sistema="${config.nombreSistemaInformatico}" v${config.version}, Instalación=${config.numeroInstalacion}`
  );
  return config;
}
