/**
 * SERVICIO DE PREPARACIÓN DE REMISIONES AEAT Y OUTBOX FISCAL (FASE 2.3)
 *
 * Normativa de Referencia:
 * - Ley 11/2021 | RD 1007/2023 | Orden HAC/1177/2024
 *
 * RESPONSABILIDAD:
 * Gestiona el ciclo de vida del intento de remisión (FiscalSubmission / Outbox) de forma
 * completamente desacoplada del FiscalRecord.
 *
 * REGLAS CRÍTICAS DE INMUTABILIDAD:
 * 1. El FiscalRecord ya sellado es ESTRICTAMENTE INMUTABLE.
 * 2. Ningún intento de envío, error de red, rechazo o aceptación altera:
 *    - FiscalRecord.huella
 *    - FiscalRecord.encadenamiento
 *    - FiscalRecord.fechaHoraHusoGenRegistro
 *    - FiscalRecord.xmlOficial
 *    - FiscalRecord.qr
 * 3. El estado de la comunicación pertenece exclusivamente a FiscalSubmission.
 * 4. Un FiscalRecord puede asociarse a 0, 1 o N FiscalSubmission a lo largo del tiempo.
 *
 * ALCANCE FASE 2.3:
 * Preparación del modelo de datos y lógica de outbox sin comunicación real (HTTP/SOAP/certificados).
 */

import {
  FiscalRecord,
  FiscalSubmission,
  FiscalSubmissionStatus,
  FiscalConfiguration
} from './types';
import { buildAeatVerifactuXml } from './aeatVerifactuXmlBuilder';
import { getAeatSoapEndpoint } from './aeatEndpoints';

/**
 * Congela profundamente un objeto en runtime para prevenir mutaciones accidentales.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

export interface CreateSubmissionOptions {
  readonly numeroIntento?: number;
  readonly xmlEnviado?: string;
  readonly endpoint?: string;
}

export interface TransitionDetails {
  readonly httpStatus?: number;
  readonly codigoAeat?: string;
  readonly descripcion?: string;
  readonly csv?: string;
  readonly avisos?: ReadonlyArray<{ readonly codigo: string; readonly descripcion: string }>;
  readonly errores?: ReadonlyArray<{ readonly codigo: string; readonly descripcion: string }>;
  readonly xmlRespuesta?: string;
  readonly tiempoRespuestaMs?: number;
  readonly tiempoEsperaEnvio?: number;
  readonly proximoReintento?: string;
}

// Almacén en memoria de submissions para testing y gestión de outbox local
const outboxSubmissions: FiscalSubmission[] = [];

/**
 * Crea una nueva solicitud de remisión oficial (FiscalSubmission) en estado 'PENDING'.
 * Garantiza que el FiscalRecord de entrada NO sea modificado en modo alguno.
 */
export function createFiscalSubmission(
  fiscalRecord: FiscalRecord,
  config: FiscalConfiguration,
  options?: CreateSubmissionOptions
): FiscalSubmission {
  if (!fiscalRecord || typeof fiscalRecord !== 'object') {
    throw new Error('createFiscalSubmission: Se requiere un FiscalRecord válido.');
  }

  if (!fiscalRecord.obligadoTributarioId || fiscalRecord.obligadoTributarioId.trim() === '' || fiscalRecord.obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('createFiscalSubmission: obligadoTributarioId es obligatorio y no puede ser ES_UNKNOWN ni estar vacío.');
  }

  const ahora = new Date().toISOString();
  const intento = options?.numeroIntento ?? 1;
  let xmlEnviado = options?.xmlEnviado || fiscalRecord.xmlOficial;

  if (!xmlEnviado) {
    try {
      xmlEnviado = buildAeatVerifactuXml(fiscalRecord);
    } catch {
      xmlEnviado = undefined;
    }
  }

  // REGLA FASE 1.2: Prohibido <pending_xml/>. No crear sumisión sin XML oficial válido.
  if (!xmlEnviado || xmlEnviado === '<pending_xml/>' || xmlEnviado.trim() === '') {
    throw new Error('createFiscalSubmission: No se puede crear una FiscalSubmission sin XML oficial válido. No se permite <pending_xml/>.');
  }

  const endpoint = options?.endpoint || config.transporte?.endpointUrl || getAeatSoapEndpoint(config.entornoAeat);

  const submission: FiscalSubmission = {
    id: `fsub-${fiscalRecord.id}-${intento}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    obligadoTributarioId: fiscalRecord.obligadoTributarioId,
    fiscalRecordId: fiscalRecord.id,
    numeroFactura: fiscalRecord.factura.numeroFactura,
    estado: 'PENDING',
    fechaCreacion: ahora,
    fechaIntento: ahora,
    numeroIntento: intento,
    endpoint,
    xmlEnviado
  };

  const frozenSubmission = deepFreeze(submission);
  outboxSubmissions.push(frozenSubmission);
  return frozenSubmission;
}

export const ALLOWED_SUBMISSION_TRANSITIONS: Record<FiscalSubmissionStatus, readonly FiscalSubmissionStatus[]> = {
  PENDING: ['SENDING'],
  SENDING: ['ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'REJECTED', 'FAILED_TECHNICAL'],
  FAILED_TECHNICAL: ['RETRY_PENDING'],
  RETRY_PENDING: ['SENDING'],
  ACCEPTED: [], // Estado terminal
  ACCEPTED_WITH_ERRORS: [], // Estado terminal
  REJECTED: [] // Estado terminal tributario
};

/**
 * Efectúa una transición de estado en una FiscalSubmission existente produciendo
 * una nueva instancia inmutable, sin tocar en ningún caso el FiscalRecord sellado.
 */
export function transitionSubmissionStatus(
  submission: FiscalSubmission,
  newStatus: FiscalSubmissionStatus,
  details?: TransitionDetails
): FiscalSubmission {
  if (!submission || typeof submission !== 'object') {
    throw new Error('transitionSubmissionStatus: Se requiere una FiscalSubmission válida.');
  }

  // Validación estricta de la máquina de estados
  const allowed = ALLOWED_SUBMISSION_TRANSITIONS[submission.estado] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`transitionSubmissionStatus: Transición de estado ilegal en FiscalSubmission. De '${submission.estado}' a '${newStatus}' no está permitida por la máquina de estados.`);
  }

  const ahora = new Date().toISOString();

  const updated: FiscalSubmission = {
    ...submission,
    estado: newStatus,
    fechaEnvio: newStatus === 'SENDING' ? ahora : submission.fechaEnvio,
    fechaRespuesta: ['ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'REJECTED', 'FAILED_TECHNICAL'].includes(newStatus)
      ? ahora
      : submission.fechaRespuesta,
    completadoEn: ['ACCEPTED', 'ACCEPTED_WITH_ERRORS'].includes(newStatus)
      ? ahora
      : submission.completadoEn,
    httpStatus: details?.httpStatus ?? submission.httpStatus,
    codigoAeat: details?.codigoAeat ?? submission.codigoAeat,
    descripcion: details?.descripcion ?? submission.descripcion,
    csv: details?.csv ?? submission.csv,
    avisos: details?.avisos ?? submission.avisos,
    errores: details?.errores ?? submission.errores,
    xmlRespuesta: details?.xmlRespuesta ?? submission.xmlRespuesta,
    tiempoRespuestaMs: details?.tiempoRespuestaMs ?? submission.tiempoRespuestaMs,
    tiempoEsperaEnvio: details?.tiempoEsperaEnvio ?? submission.tiempoEsperaEnvio,
    proximoReintento: details?.proximoReintento ?? submission.proximoReintento
  };

  const frozenUpdated = deepFreeze(updated);

  // Actualizar en el almacén local del outbox
  const idx = outboxSubmissions.findIndex(s => s.id === submission.id);
  if (idx !== -1) {
    outboxSubmissions[idx] = frozenUpdated;
  } else {
    outboxSubmissions.push(frozenUpdated);
  }

  return frozenUpdated;
}

/**
 * Consulta todas las sumisiones asociadas a un FiscalRecord determinado.
 */
export function getSubmissionsForRecord(fiscalRecordId: string): FiscalSubmission[] {
  return outboxSubmissions.filter(s => s.fiscalRecordId === fiscalRecordId);
}

/**
 * Consulta las sumisiones pendientes en el outbox, opcionalmente filtradas por obligado tributario.
 */
export function getPendingSubmissions(obligadoTributarioId?: string): FiscalSubmission[] {
  return outboxSubmissions.filter(s => {
    const matchesObligado = !obligadoTributarioId || s.obligadoTributarioId === obligadoTributarioId;
    return matchesObligado && (s.estado === 'PENDING' || s.estado === 'RETRY_PENDING');
  });
}

/**
 * Limpia el almacén en memoria del outbox (utilizado en testing y reseteos).
 */
export function resetFiscalOutbox(): void {
  outboxSubmissions.length = 0;
}
