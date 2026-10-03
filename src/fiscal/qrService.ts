/**
 * SERVICIO OFICIAL DE CÓDIGO QR TRIBUTARIO VERI*FACTU (FASE 2.3)
 *
 * Normativa y Especificaciones Técnicas Oficiales de Referencia:
 * - Ley 11/2021, de 9 de julio, de prevención del fraude fiscal.
 * - Real Decreto 1007/2023, de 5 de diciembre (Reglamento Veri*Factu / SIF), Artículos 8 y 16.
 * - Orden HAC/1177/2024, de 17 de octubre (BOE núm. 259, de 28/10/2024), Artículos 20 y 21.
 * - Documento Técnico AEAT: «Detalle de las especificaciones técnicas del código QR
 *   de la factura y de la URL del servicio de cotejo» (versión oficial v1.0).
 *
 * RESPONSABILIDAD ÚNICA:
 * FiscalRecord -> FiscalQrService -> QR payload -> URL oficial -> imagen/Data URI QR
 *
 * PRINCIPIOS DE IMPLEMENTACIÓN:
 * 1. Pureza estricta: No muta FiscalRecord ni Invoice, no accede a almacenamiento ni React.
 * 2. Datos fiscales sellados: Consume exclusivamente valores del FiscalRecord ya fijados.
 * 3. Determinismo absoluto: Mismo FiscalRecord produce exactamente el mismo payload y URL.
 * 4. Cero valores ficticios: Se rechazan tajantemente cadenas vacías o fallbacks artificiales.
 * 5. Conformidad ISO/IEC 18004: Nivel M de corrección de errores, zona de silencio y leyendas oficiales.
 */

import QRCode from 'qrcode';
import { FiscalRecord } from './types';
import { formatFechaExpedicionFiscal, formatImporteFiscal } from './hashService';
import { AEAT_OFFICIAL_ENDPOINTS } from './aeatEndpoints';

export const AEAT_QR_ENDPOINTS = {
  production: AEAT_OFFICIAL_ENDPOINTS.qr.production,
  testing: AEAT_OFFICIAL_ENDPOINTS.qr.test
} as const;

export const QR_SPEC_CONSTANTS = {
  STANDARD: 'ISO/IEC 18004:2015',
  ERROR_CORRECTION_LEVEL: 'M' as const,
  MIN_SIZE_MM: 30,
  MAX_SIZE_MM: 40,
  MIN_QUIET_ZONE_MM: 2,
  RECOMMENDED_QUIET_ZONE_MM: 6,
  TOP_LABEL: 'QR tributario',
  BOTTOM_LABEL_VERIFACTU: 'Factura verificable en la sede electrónica de la AEAT',
  BOTTOM_LABEL_SHORT: '«VERI*FACTU»'
} as const;

export interface FiscalQrPayloadData {
  readonly nif: string;
  readonly numserie: string;
  readonly fecha: string; // DD-MM-YYYY
  readonly importe: string; // 12.2 (ej. '121.00')
}

export interface FiscalQrOptions {
  readonly environment?: 'production' | 'testing';
  readonly baseUrl?: string;
}

export interface FiscalQrBuildResult {
  readonly url: string;
  readonly payloadTexto: string;
  readonly data: FiscalQrPayloadData;
  readonly qrDataUri?: string;
}

/**
 * Valida un campo de texto y rechaza cadenas vacías, nulos o marcadores ficticios.
 */
function validateStrictField(value: unknown, fieldName: string, maxLen?: number): string {
  if (value === undefined || value === null) {
    throw new Error(`FiscalQrService: ${fieldName} es obligatorio y no puede ser null ni undefined.`);
  }
  const clean = String(value).trim();
  if (clean === '') {
    throw new Error(`FiscalQrService: ${fieldName} es obligatorio y no puede estar vacío.`);
  }
  const forbiddenPlaceholders = [
    'ES_UNKNOWN',
    'UNKNOWN',
    'PENDING_FASE_2_HASH',
    '<PENDING_XML/>',
    'NULL',
    'UNDEFINED',
    '[PENDING]'
  ];
  if (forbiddenPlaceholders.includes(clean.toUpperCase())) {
    throw new Error(`FiscalQrService: ${fieldName} contiene un marcador ficticio prohibido ('${clean}').`);
  }
  if (maxLen && clean.length > maxLen) {
    throw new Error(`FiscalQrService: ${fieldName} ('${clean}') supera la longitud máxima permitida de ${maxLen} caracteres.`);
  }
  return clean;
}

/**
 * Extrae y valida estrictamente los datos del FiscalRecord para la construcción del QR de cotejo.
 *
 * Conforme al Art. 20 de la Orden HAC/1177/2024, el QR tributario aplica exclusivamente a las facturas
 * expedidas (tipoRegistro: 'alta'). Los registros de anulación son apuntes de cancelación interna
 * y no generan QR de cotejo comercial.
 */
export function buildFiscalQrPayload(record: FiscalRecord): FiscalQrPayloadData {
  if (!record || typeof record !== 'object') {
    throw new Error('FiscalQrService: Se requiere un FiscalRecord válido para construir el QR.');
  }

  if (record.tipoRegistro !== 'alta') {
    throw new Error(
      `FiscalQrService: El código QR tributario según Orden HAC/1177/2024 Art. 20 solo es aplicable a registros de Alta de facturas expedidas (recibido tipoRegistro='${record.tipoRegistro}').`
    );
  }

  // 1. NIF del obligado tributario emisor (9 caracteres alfanuméricos)
  const nifRaw = validateStrictField(record.emisor?.nif, 'NIF emisor', 9);
  const nif = nifRaw.toUpperCase();
  const spanishNifRegex = /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[A-HJ-NP-SUVW][0-9]{7}[0-9A-J])$/i;
  if (!spanishNifRegex.test(nif)) {
    throw new Error(`FiscalQrService: NIF emisor '${nif}' no cumple el formato reglamentario oficial (9 caracteres alfanuméricos válidos de DNI, NIE o CIF).`);
  }

  // 2. Número y serie de la factura expedida (hasta 60 caracteres)
  const numserie = validateStrictField(record.factura?.numeroFactura, 'Número/serie de factura', 60);

  // 3. Fecha de expedición de la factura (formato oficial DD-MM-YYYY)
  const fechaRaw = validateStrictField(record.factura?.fechaExpedicion, 'Fecha de expedición');
  const fecha = formatFechaExpedicionFiscal(fechaRaw);

  // 4. Importe total con dos decimales y punto decimal (ImporteSgn12.2Type)
  const importeTotalNum = record.desgloseTributario?.importeTotal;
  if (typeof importeTotalNum !== 'number' || !Number.isFinite(importeTotalNum)) {
    throw new Error(`FiscalQrService: ImporteTotal debe ser un número finito válido (recibido '${importeTotalNum}').`);
  }
  const importe = formatImporteFiscal(importeTotalNum);

  // 5. Verificación de ausencia de marcadores ficticios en la huella si existe
  if (record.huella && record.huella.hash) {
    if (record.huella.hash === 'PENDING_FASE_2_HASH' || record.huella.hash.trim() === '') {
      throw new Error(`FiscalQrService: Huella fiscal inválida o provisional ('${record.huella.hash}').`);
    }
  }

  return {
    nif,
    numserie,
    fecha,
    importe
  };
}

/**
 * Construye la URL reglamentaria oficial de cotejo de la AEAT con sus parámetros canónicos.
 *
 * Formato oficial:
 * https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=...&numserie=...&fecha=...&importe=...
 */
export function buildFiscalQrUrl(record: FiscalRecord, options?: FiscalQrOptions): string {
  const data = buildFiscalQrPayload(record);

  const baseUrl = options?.baseUrl || (
    options?.environment === 'testing'
      ? AEAT_QR_ENDPOINTS.testing
      : AEAT_QR_ENDPOINTS.production
  );

  const params = new URLSearchParams();
  params.set('nif', data.nif);
  params.set('numserie', data.numserie);
  params.set('fecha', data.fecha);
  params.set('importe', data.importe);

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Genera la representación Data URI en formato Base64 PNG del código QR tributario
 * cumpliendo estrictamente con el estándar ISO/IEC 18004 y nivel M de corrección de errores.
 */
export async function generateQrDataUri(url: string): Promise<string> {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error('FiscalQrService: Se requiere una URL no vacía para generar el código QR.');
  }

  return await QRCode.toDataURL(url, {
    errorCorrectionLevel: QR_SPEC_CONSTANTS.ERROR_CORRECTION_LEVEL,
    margin: QR_SPEC_CONSTANTS.MIN_QUIET_ZONE_MM,
    width: 320,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
}

/**
 * Función integral: Construye el payload, la URL oficial y el Data URI de imagen del código QR
 * a partir de un FiscalRecord sellado sin mutar el registro original.
 */
export async function buildFiscalQr(
  record: FiscalRecord,
  options?: FiscalQrOptions
): Promise<FiscalQrBuildResult & { qrDataUri: string }> {
  const data = buildFiscalQrPayload(record);
  const url = buildFiscalQrUrl(record, options);
  const qrDataUri = await generateQrDataUri(url);

  return {
    url,
    payloadTexto: url,
    data,
    qrDataUri
  };
}

/**
 * Extrae de forma pura los datos del código QR ya calculados en el FiscalRecord.
 * Garantiza que componentes de presentación (como PDF o vistas de impresión)
 * consuman directamente la fuente de verdad fiscal sin recalcular.
 */
export function getFiscalQrFromRecord(record: FiscalRecord): {
  url: string;
  payloadTexto: string;
  qrDataUri?: string;
} {
  if (!record || !record.qr) {
    throw new Error('FiscalQrService: El FiscalRecord no contiene información del código QR.');
  }
  return {
    url: record.qr.url,
    payloadTexto: record.qr.payloadTexto,
    qrDataUri: record.qr.qrDataUri
  };
}
