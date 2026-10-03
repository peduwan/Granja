/**
 * SERVICIO OFICIAL DE HASH Y ENCADENAMIENTO VERI*FACTU (FASE 2.1)
 *
 * Normativa de referencia obligatoria:
 * - Ley 11/2021, de 9 de julio, de medidas de prevención y lucha contra el fraude fiscal.
 * - Real Decreto 1007/2023, de 5 de diciembre (Reglamento Veri*Factu / SIF).
 * - Orden HAC/1177/2024, de 17 de octubre (publicada en BOE núm. 259, de 28/10/2024, BOE-A-2024-22138).
 * - Documento técnico oficial AEAT: "Detalle de las especificaciones técnicas para la generación de la huella o hash de los registros".
 *
 * Especificaciones criptográficas canónicas:
 * - Algoritmo: SHA-256 (Secure Hash Algorithm 256-bit).
 * - Codificación de entrada: UTF-8 sin BOM.
 * - Formato de salida: Cadena hexadecimal de 64 caracteres en MAYÚSCULAS.
 * - Separador de campos: Carácter '&'.
 * - Formato de pares: Clave=Valor.
 * - Formato de importes: 2 decimales fijos con punto '.' decimal y sin separadores de miles (ej. '91.52', '0.00').
 * - Formato de fecha de expedición: DD-MM-YYYY.
 * - Formato de fecha/hora de generación: ISO 8601 con huso horario (YYYY-MM-DDThh:mm:ss±hh:mm o Z).
 * - Huella anterior: 64 caracteres hexadecimales en MAYÚSCULAS del registro anterior (vacía si es primer registro).
 */

import { FiscalRecord, FiscalRecordRef } from './types';

export interface AltaHashInput {
  nifEmisor: string;
  numSerieFactura: string;
  fechaExpedicion: string; // Acepta YYYY-MM-DD o DD-MM-YYYY
  tipoFactura: string; // F1, F2, R1, R2, R3, R4...
  cuotaTotal: number | string;
  importeTotal: number | string;
  huellaAnterior?: string | null; // 64 hex chars, o vacío si es primer registro
  fechaHoraHusoGenRegistro: string; // ISO 8601 con huso horario
}

export interface AnulacionHashInput {
  nifEmisor: string;
  numSerieFactura: string;
  fechaExpedicion: string;
  huellaAnterior?: string | null;
  fechaHoraHusoGenRegistro: string;
}

export interface HashResult {
  readonly hash: string;
  readonly canonicalString: string;
  readonly algoritmo: 'SHA-256';
  readonly especificacionVersion: 'HAC/1177/2024';
}

export interface HashVerificationResult {
  readonly valid: boolean;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly canonicalString: string;
  readonly reason?: string;
}

export interface ChainVerificationResult {
  readonly valid: boolean;
  readonly totalRecords: number;
  readonly brokenAtIndex?: number;
  readonly reason?: string;
}

/**
 * Normaliza un importe numérico según las especificaciones técnicas oficiales de la AEAT:
 * Exactamente dos cifras decimales separadas por punto decimal '.' y sin separador de miles.
 * Ejemplos:
 *  0 -> '0.00'
 *  1 -> '1.00'
 *  1.5 -> '1.50'
 *  91.52 -> '91.52'
 *  1000 -> '1000.00'
 */
export function formatImporteFiscal(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    return '0.00';
  }
  const num = typeof value === 'number' ? value : parseFloat(String(value).trim());
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`formatImporteFiscal: valor no numérico o no finito: '${value}'.`);
  }
  const fixed = num.toFixed(2);
  return fixed === '-0.00' ? '0.00' : fixed;
}

/**
 * Normaliza la fecha de expedición de factura al formato reglamentario oficial: DD-MM-YYYY.
 * Acepta entradas en formato ISO 'YYYY-MM-DD' o ya normalizadas 'DD-MM-YYYY'.
 * Valida límites calendáricos estrictos.
 */
export function formatFechaExpedicionFiscal(fecha: string): string {
  if (!fecha || typeof fecha !== 'string') {
    throw new Error('formatFechaExpedicionFiscal: fecha de expedición inválida o vacía.');
  }
  const clean = fecha.trim().replace(/\//g, '-');
  const partes = clean.split('-');
  if (partes.length === 3) {
    let dd = 0;
    let mm = 0;
    let yyyy = 0;

    if (partes[0].length === 4 && partes[1].length <= 2 && partes[2].length <= 2) {
      // YYYY-MM-DD -> DD-MM-YYYY
      yyyy = parseInt(partes[0], 10);
      mm = parseInt(partes[1], 10);
      dd = parseInt(partes[2], 10);
    } else if (partes[2].length === 4 && partes[0].length <= 2 && partes[1].length <= 2) {
      // DD-MM-YYYY
      dd = parseInt(partes[0], 10);
      mm = parseInt(partes[1], 10);
      yyyy = parseInt(partes[2], 10);
    }

    if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const dObj = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (dObj.getUTCFullYear() === yyyy && dObj.getUTCMonth() === mm - 1 && dObj.getUTCDate() === dd) {
        return `${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${yyyy}`;
      }
    }
  }
  throw new Error(`formatFechaExpedicionFiscal: formato de fecha no reconocido o inválido: '${fecha}'. Debe ser YYYY-MM-DD o DD-MM-YYYY.`);
}

/**
 * Genera o normaliza la fecha, hora y huso horario de generación del registro conforme a la Orden HAC/1177/2024:
 * Formato ISO 8601 con huso horario obligatorio: YYYY-MM-DDThh:mm:ss±hh:mm o terminación 'Z'.
 * Si no se proporciona valor, genera la marca de tiempo actual del sistema con el huso horario local.
 */
export function formatFechaHoraHusoGenRegistro(dateInput?: Date | string): string {
  if (!dateInput) {
    const d = new Date();
    return formatDateTimeWithTimezoneOffset(d);
  }

  if (dateInput instanceof Date) {
    return formatDateTimeWithTimezoneOffset(dateInput);
  }

  const str = String(dateInput).trim();
  // Si ya contiene huso horario (+hh:mm, -hh:mm o Z)
  if (/T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/i.test(str)) {
    return str;
  }

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    throw new Error(`formatFechaHoraHusoGenRegistro: fecha inválida: '${dateInput}'.`);
  }
  return formatDateTimeWithTimezoneOffset(parsed);
}

function formatDateTimeWithTimezoneOffset(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offH = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offM = String(absOffset % 60).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${offH}:${offM}`;
}

/**
 * Construye la cadena canónica oficial para un Registro de Facturación de Alta.
 *
 * Estructura oficial (Orden HAC/1177/2024 y doc técnico AEAT):
 * IDEmisorFactura=&NumSerieFactura=&FechaExpedicionFactura=&TipoFactura=&CuotaTotal=&ImporteTotal=&Huella=&FechaHoraHusoGenRegistro=
 */
export function buildCanonicalAltaString(input: AltaHashInput): string {
  const nif = (input.nifEmisor || '').trim().toUpperCase();
  if (!nif || nif === 'ES_UNKNOWN') {
    throw new Error('buildCanonicalAltaString: IDEmisorFactura es obligatorio y no puede ser ES_UNKNOWN.');
  }

  const numSerie = (input.numSerieFactura || '').trim();
  if (!numSerie) {
    throw new Error('buildCanonicalAltaString: NumSerieFactura es obligatorio.');
  }

  const fechaExp = formatFechaExpedicionFiscal(input.fechaExpedicion);
  const tipoFactura = (input.tipoFactura || 'F1').trim().toUpperCase();
  const cuotaTotal = formatImporteFiscal(input.cuotaTotal);
  const importeTotal = formatImporteFiscal(input.importeTotal);
  const huellaAnterior = (input.huellaAnterior || '').trim().toUpperCase();
  const fechaGen = (input.fechaHoraHusoGenRegistro || '').trim();
  if (!fechaGen) {
    throw new Error('buildCanonicalAltaString: FechaHoraHusoGenRegistro es obligatorio.');
  }

  return `IDEmisorFactura=${nif}&NumSerieFactura=${numSerie}&FechaExpedicionFactura=${fechaExp}&TipoFactura=${tipoFactura}&CuotaTotal=${cuotaTotal}&ImporteTotal=${importeTotal}&Huella=${huellaAnterior}&FechaHoraHusoGenRegistro=${fechaGen}`;
}

/**
 * Construye la cadena canónica oficial para un Registro de Facturación de Anulación.
 *
 * Estructura oficial (Orden HAC/1177/2024 y doc técnico AEAT):
 * IDEmisorFactura=&NumSerieFactura=&FechaExpedicionFactura=&Huella=&FechaHoraHusoGenRegistro=
 */
export function buildCanonicalAnulacionString(input: AnulacionHashInput): string {
  const nif = (input.nifEmisor || '').trim().toUpperCase();
  if (!nif || nif === 'ES_UNKNOWN') {
    throw new Error('buildCanonicalAnulacionString: IDEmisorFactura es obligatorio y no puede ser ES_UNKNOWN.');
  }

  const numSerie = (input.numSerieFactura || '').trim();
  if (!numSerie) {
    throw new Error('buildCanonicalAnulacionString: NumSerieFactura es obligatorio.');
  }

  const fechaExp = formatFechaExpedicionFiscal(input.fechaExpedicion);
  const huellaAnterior = (input.huellaAnterior || '').trim().toUpperCase();
  const fechaGen = (input.fechaHoraHusoGenRegistro || '').trim();
  if (!fechaGen) {
    throw new Error('buildCanonicalAnulacionString: FechaHoraHusoGenRegistro es obligatorio.');
  }

  return `IDEmisorFactura=${nif}&NumSerieFactura=${numSerie}&FechaExpedicionFactura=${fechaExp}&Huella=${huellaAnterior}&FechaHoraHusoGenRegistro=${fechaGen}`;
}

/**
 * Calcula el hash criptográfico SHA-256 de una cadena en UTF-8 y devuelve
 * exactamente 64 caracteres hexadecimales en MAYÚSCULAS.
 * Compatible tanto con Web Crypto API (navegador) como con Node.js crypto.
 */
export async function calculateSha256(canonicalString: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Entornos Node.js (por ejemplo, ejecución en vitest/tsx sin window.crypto.subtle)
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex').toUpperCase();
  } catch (err: any) {
    throw new Error(`calculateSha256: no se pudo inicializar motor SHA-256: ${err.message}`);
  }
}

/**
 * Calcula la huella/hash oficial para un Registro de Facturación de Alta.
 */
export async function calculateAltaHash(input: AltaHashInput): Promise<HashResult> {
  const canonicalString = buildCanonicalAltaString(input);
  const hash = await calculateSha256(canonicalString);

  return {
    hash,
    canonicalString,
    algoritmo: 'SHA-256',
    especificacionVersion: 'HAC/1177/2024'
  };
}

/**
 * Calcula la huella/hash oficial para un Registro de Facturación de Anulación.
 */
export async function calculateAnulacionHash(input: AnulacionHashInput): Promise<HashResult> {
  const canonicalString = buildCanonicalAnulacionString(input);
  const hash = await calculateSha256(canonicalString);

  return {
    hash,
    canonicalString,
    algoritmo: 'SHA-256',
    especificacionVersion: 'HAC/1177/2024'
  };
}

/**
 * Valida los requisitos legales del registro inmediatamente anterior según la Orden HAC/1177/2024:
 * 1. Mismo obligado tributario.
 * 2. Huella válida de 64 caracteres hexadecimales.
 * 3. Condición temporal: la fecha/hora de generación del anterior no puede ser superior
 *    en más de un minuto (60.000 ms) a la fecha/hora actual del nuevo registro.
 * 4. Integridad criptográfica estricta: si el registro anterior está disponible como FiscalRecord completo,
 *    verifica que no haya sufrido corrupción.
 */
export async function validatePreviousRecordRequirement(
  currentTimestamp: string,
  currentObligadoId: string,
  previousRecord?: FiscalRecord | FiscalRecordRef | null
): Promise<void> {
  if (!previousRecord) {
    return; // Primer registro de la cadena
  }

  const prevObligado = previousRecord.obligadoTributarioId;
  if (!prevObligado || prevObligado !== currentObligadoId) {
    throw new Error(
      `validatePreviousRecordRequirement: Ruptura de aislamiento fiscal. El registro anterior pertenece a '${prevObligado}', pero el registro actual pertenece a '${currentObligadoId}'.`
    );
  }

  let prevHash = '';
  let prevTimestamp = '';

  if ('huellaHash' in previousRecord) {
    prevHash = previousRecord.huellaHash;
    prevTimestamp = previousRecord.creadoEn;
  } else if ('huella' in previousRecord) {
    prevHash = previousRecord.huella.hash;
    prevTimestamp = previousRecord.fechaHoraHusoGenRegistro || previousRecord.creadoEn;

    // Comprobación de integridad criptográfica y corrupción del último registro
    const integrityCheck = await verifyFiscalRecordHash(previousRecord as FiscalRecord);
    if (!integrityCheck.valid) {
      throw new Error(
        `validatePreviousRecordRequirement: Corrupción criptográfica en el último registro (${(previousRecord as FiscalRecord).id}): ${integrityCheck.reason}`
      );
    }
  }

  if (!prevHash || prevHash.length !== 64 || !/^[0-9A-F]{64}$/i.test(prevHash)) {
    throw new Error(
      `validatePreviousRecordRequirement: La huella del registro anterior es inválida o no tiene 64 caracteres hexadecimales: '${prevHash}'.`
    );
  }

  // Comprobación de la condición temporal reglamentaria de la Orden HAC/1177/2024:
  // "que su fecha/hora de generación no es superior en más de un minuto a la fecha/hora actuales"
  if (prevTimestamp && currentTimestamp) {
    const timePrev = new Date(prevTimestamp).getTime();
    const timeCurrent = new Date(currentTimestamp).getTime();

    if (!isNaN(timePrev) && !isNaN(timeCurrent)) {
      const skewMs = timePrev - timeCurrent;
      if (skewMs > 60000) {
        throw new Error(
          `validatePreviousRecordRequirement: Condición temporal vulnerada (Orden HAC/1177/2024). La fecha/hora del registro anterior (${prevTimestamp}) supera en más de un minuto a la fecha/hora actual (${currentTimestamp}).`
        );
      }
    }
  }
}

/**
 * Verifica matemáticamente la huella de un FiscalRecord sellado contra sus datos canónicos.
 * Reconstruye la entrada canónica, recalcula el hash y comprueba igualdad estricta.
 */
export async function verifyFiscalRecordHash(record: FiscalRecord): Promise<HashVerificationResult> {
  try {
    let canonicalString = '';
    const nif = record.emisor.nif;
    const numSerie = record.factura.numeroFactura;
    const fechaExp = record.factura.fechaExpedicion;
    const huellaAnterior = record.encadenamiento.registroAnterior?.huella || '';
    const fechaGen = record.fechaHoraHusoGenRegistro;

    if (record.tipoRegistro === 'alta') {
      const tipoFactura = record.factura.tipoFactura;
      const cuotaTotal = (record.desgloseTributario.cuotaTotal || 0) + (record.desgloseTributario.cuotaRecargoTotal || 0);
      const importeTotal = record.desgloseTributario.importeTotal;

      canonicalString = buildCanonicalAltaString({
        nifEmisor: nif,
        numSerieFactura: numSerie,
        fechaExpedicion: fechaExp,
        tipoFactura,
        cuotaTotal,
        importeTotal,
        huellaAnterior,
        fechaHoraHusoGenRegistro: fechaGen
      });
    } else {
      canonicalString = buildCanonicalAnulacionString({
        nifEmisor: nif,
        numSerieFactura: numSerie,
        fechaExpedicion: fechaExp,
        huellaAnterior,
        fechaHoraHusoGenRegistro: fechaGen
      });
    }

    const expectedHash = await calculateSha256(canonicalString);
    const actualHash = record.huella.hash;
    const valid = expectedHash === actualHash;

    return {
      valid,
      expectedHash,
      actualHash,
      canonicalString,
      reason: valid ? undefined : `Discrepancia en huella: esperada '${expectedHash}', obtenida '${actualHash}'`
    };
  } catch (err: any) {
    return {
      valid: false,
      expectedHash: '',
      actualHash: record?.huella?.hash || '',
      canonicalString: '',
      reason: `Error durante la verificación: ${err.message}`
    };
  }
}

/**
 * Verifica la integridad global de una cadena de registros fiscales:
 * 1. Todos pertenecen al mismo obligadoTributarioId.
 * 2. El primer registro está marcado como primerRegistro=true y no tiene registroAnterior.
 * 3. Cada registro posterior encadena con el hash del inmediatamente anterior.
 * 4. La huella de cada registro individual es matemáticamente válida.
 * 5. La cronología temporal se preserva estrictamente.
 */
export async function verifyFiscalRecordChain(
  records: FiscalRecord[]
): Promise<ChainVerificationResult> {
  if (!records || records.length === 0) {
    return { valid: true, totalRecords: 0 };
  }

  const obligadoTributarioId = records[0].obligadoTributarioId;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // 1. Aislamiento por obligado
    if (record.obligadoTributarioId !== obligadoTributarioId) {
      return {
        valid: false,
        totalRecords: records.length,
        brokenAtIndex: i,
        reason: `Ruptura en registro #${i} (${record.factura.numeroFactura}): Obligado tributario '${record.obligadoTributarioId}' difiere del inicial '${obligadoTributarioId}'.`
      };
    }

    // 2. Verificación de hash individual
    const hashCheck = await verifyFiscalRecordHash(record);
    if (!hashCheck.valid) {
      return {
        valid: false,
        totalRecords: records.length,
        brokenAtIndex: i,
        reason: `Ruptura en registro #${i} (${record.factura.numeroFactura}): ${hashCheck.reason}`
      };
    }

    // 3. Verificación de encadenamiento
    if (i === 0) {
      if (!record.encadenamiento.primerRegistro || record.encadenamiento.registroAnterior !== undefined) {
        return {
          valid: false,
          totalRecords: records.length,
          brokenAtIndex: 0,
          reason: `Ruptura en registro inicial: debe tener primerRegistro=true y registroAnterior=undefined.`
        };
      }
    } else {
      const prevRecord = records[i - 1];
      if (record.encadenamiento.primerRegistro) {
        return {
          valid: false,
          totalRecords: records.length,
          brokenAtIndex: i,
          reason: `Ruptura en registro #${i}: un registro posterior no puede tener primerRegistro=true.`
        };
      }

      const expectedPrevHash = prevRecord.huella.hash;
      const actualPrevHash = record.encadenamiento.registroAnterior?.huella;

      if (actualPrevHash !== expectedPrevHash) {
        return {
          valid: false,
          totalRecords: records.length,
          brokenAtIndex: i,
          reason: `Ruptura en registro #${i} (${record.factura.numeroFactura}): huella anterior '${actualPrevHash}' no coincide con la huella del registro #${i - 1} '${expectedPrevHash}'.`
        };
      }

      // 4. Verificación temporal no regresiva
      const timePrev = new Date(prevRecord.fechaHoraHusoGenRegistro).getTime();
      const timeCurr = new Date(record.fechaHoraHusoGenRegistro).getTime();
      if (!isNaN(timePrev) && !isNaN(timeCurr) && timeCurr < timePrev) {
        return {
          valid: false,
          totalRecords: records.length,
          brokenAtIndex: i,
          reason: `Ruptura en registro #${i} (${record.factura.numeroFactura}): Timestamp regresivo (${record.fechaHoraHusoGenRegistro} anterior a ${prevRecord.fechaHoraHusoGenRegistro}).`
        };
      }
    }
  }

  return {
    valid: true,
    totalRecords: records.length
  };
}
