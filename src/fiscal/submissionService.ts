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
  FiscalRecordSubmissionResult,
  FiscalRecordSubmissionStatus,
  FiscalConfiguration
} from './types';
import { buildAeatVerifactuXml } from './aeatVerifactuXmlBuilder';
import { getAeatSoapEndpoint } from './aeatEndpoints';
import {
  getRecordCanonicalNumSerie,
  getRecordCanonicalFechaExpedicion
} from './aeatResponseParser';

export const MAX_RECORDS_PER_AEAT_SUBMISSION = 1000;

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
  readonly estadoEnvioAeat?: 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto' | string;
  readonly resultadosIndividuales?: ReadonlyArray<FiscalRecordSubmissionResult>;
  readonly avisos?: ReadonlyArray<{
    readonly codigo: string;
    readonly descripcion: string;
    readonly numSerieFactura?: string;
    readonly fiscalRecordId?: string;
  }>;
  readonly errores?: ReadonlyArray<{
    readonly codigo: string;
    readonly descripcion: string;
    readonly numSerieFactura?: string;
    readonly fiscalRecordId?: string;
  }>;
  readonly xmlRespuesta?: string;
  readonly tiempoRespuestaMs?: number;
  readonly tiempoEsperaEnvio?: number;
  readonly proximoReintento?: string;
}

// Almacén en memoria de submissions para testing y gestión de outbox local
const outboxSubmissions: FiscalSubmission[] = [];

/**
 * Crea una nueva solicitud de remisión oficial (FiscalSubmission) en estado 'PENDING'
 * para 1 a 1000 registros fiscales (FiscalRecord | ReadonlyArray<FiscalRecord>).
 * Garantiza que ningún FiscalRecord de entrada sea modificado en modo alguno.
 */
export function createFiscalSubmission(
  fiscalRecordOrBatch: FiscalRecord | ReadonlyArray<FiscalRecord>,
  config: FiscalConfiguration,
  options?: CreateSubmissionOptions
): FiscalSubmission {
  const records: ReadonlyArray<FiscalRecord> = Array.isArray(fiscalRecordOrBatch)
    ? fiscalRecordOrBatch
    : (fiscalRecordOrBatch ? [fiscalRecordOrBatch as FiscalRecord] : []);

  if (records.length === 0) {
    throw new Error('createFiscalSubmission: Se requiere al menos un FiscalRecord válido (mínimo 1).');
  }

  if (records.length > MAX_RECORDS_PER_AEAT_SUBMISSION) {
    throw new Error(
      `createFiscalSubmission: El lote excede el límite máximo normativo AEAT de ${MAX_RECORDS_PER_AEAT_SUBMISSION} registros por envío (recibidos: ${records.length}).`
    );
  }

  const firstRecord = records[0];
  if (!firstRecord || typeof firstRecord !== 'object') {
    throw new Error('createFiscalSubmission: Se requiere un FiscalRecord válido.');
  }

  const primaryObligado = (firstRecord.obligadoTributarioId || '').trim();
  if (!primaryObligado || primaryObligado === 'ES_UNKNOWN') {
    throw new Error('createFiscalSubmission: obligadoTributarioId es obligatorio y no puede ser ES_UNKNOWN ni estar vacío.');
  }

  const primaryNif = (firstRecord.emisor?.nif || primaryObligado).trim().toUpperCase();
  const seenIds = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec || typeof rec !== 'object' || !rec.id) {
      throw new Error(`createFiscalSubmission: El registro en posición ${i} no es un FiscalRecord válido.`);
    }
    const recObligado = (rec.obligadoTributarioId || '').trim();
    if (!recObligado || recObligado === 'ES_UNKNOWN') {
      throw new Error(`createFiscalSubmission: El registro '${rec.id}' tiene obligadoTributarioId inválido o ES_UNKNOWN.`);
    }
    if (recObligado !== primaryObligado) {
      throw new Error(
        `createFiscalSubmission: Prohibido mezclar distintos obligados tributarios en un mismo batch AEAT ('${primaryObligado}' vs '${recObligado}').`
      );
    }
    const recNif = (rec.emisor?.nif || recObligado).trim().toUpperCase();
    if (recNif !== primaryNif) {
      throw new Error(
        `createFiscalSubmission: Prohibido mezclar distintos NIF de emisor en un mismo batch AEAT ('${primaryNif}' vs '${recNif}').`
      );
    }
    if (seenIds.has(rec.id)) {
      throw new Error(
        `createFiscalSubmission: Registro duplicado '${rec.id}' dentro del mismo lote de remisión.`
      );
    }
    seenIds.add(rec.id);
  }

  const ahora = new Date().toISOString();
  const intento = options?.numeroIntento ?? 1;
  let xmlEnviado = options?.xmlEnviado || (records.length === 1 ? firstRecord.xmlOficial : undefined);

  let buildErrorMsg = '';
  if (!xmlEnviado) {
    try {
      xmlEnviado = buildAeatVerifactuXml(records.length === 1 ? firstRecord : [...records]);
    } catch (err: any) {
      buildErrorMsg = err?.message || String(err);
      xmlEnviado = undefined;
    }
  }

  // REGLA FASE 1.2: Prohibido <pending_xml/>. No crear sumisión sin XML oficial válido.
  if (!xmlEnviado || xmlEnviado === '<pending_xml/>' || xmlEnviado.trim() === '') {
    throw new Error(
      `createFiscalSubmission: No se puede crear una FiscalSubmission sin XML oficial válido. No se permite <pending_xml/>.${buildErrorMsg ? ` Causa: ${buildErrorMsg}` : ''}`
    );
  }

  const endpoint = options?.endpoint || config.transporte?.endpointUrl || getAeatSoapEndpoint(config.entornoAeat);

  const fiscalRecordIds = records.map(r => r.id);
  const numerosFactura = records.map(r => r.factura.numeroFactura);
  const resultadosIndividuales: FiscalRecordSubmissionResult[] = records.map(r => ({
    fiscalRecordId: r.id,
    numeroFactura: getRecordCanonicalNumSerie(r),
    fechaExpedicion: getRecordCanonicalFechaExpedicion(r),
    tipoRegistro: r.tipoRegistro,
    estado: 'PENDING',
    refExterna: r.tipoRegistro === 'anulacion' ? r.datosAnulacion?.refExterna : r.factura.refExterna,
    esReintentable: false,
    requiereSubsanacion: false
  }));

  const idPrefix = records.length === 1
    ? `fsub-${firstRecord.id}`
    : `fsub-batch-${records.length}-${firstRecord.id}`;

  const submission: FiscalSubmission = {
    id: `${idPrefix}-${intento}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    obligadoTributarioId: primaryObligado,
    fiscalRecordId: firstRecord.id,
    numeroFactura: firstRecord.factura.numeroFactura,
    fiscalRecordIds,
    numerosFactura,
    cantidadRegistros: records.length,
    esBatch: records.length > 1,
    estado: 'PENDING',
    resultadosIndividuales,
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

/**
 * Crea explícitamente una FiscalSubmission de lote (1 a 1000 registros).
 */
export function createBatchFiscalSubmission(
  fiscalRecords: ReadonlyArray<FiscalRecord>,
  config: FiscalConfiguration,
  options?: CreateSubmissionOptions
): FiscalSubmission {
  if (!Array.isArray(fiscalRecords)) {
    throw new Error('createBatchFiscalSubmission: Se requiere un array de FiscalRecord (1 a 1000 registros).');
  }
  return createFiscalSubmission(fiscalRecords, config, options);
}

/**
 * Particiona una lista arbitraria de FiscalRecord pendientes en lotes normativos de hasta 1.000 registros
 * agrupados por obligadoTributarioId y preservando estrictamente el orden de emisión/encadenamiento.
 */
export function partitionRecordsIntoBatches(
  records: ReadonlyArray<FiscalRecord>,
  maxBatchSize: number = MAX_RECORDS_PER_AEAT_SUBMISSION
): FiscalRecord[][] {
  if (!records || records.length === 0) return [];
  const effectiveMax = Math.max(1, Math.min(maxBatchSize, MAX_RECORDS_PER_AEAT_SUBMISSION));
  const batches: FiscalRecord[][] = [];

  let currentBatch: FiscalRecord[] = [];
  let currentObligado: string | null = null;

  for (const rec of records) {
    if (
      currentBatch.length >= effectiveMax ||
      (currentObligado !== null && rec.obligadoTributarioId !== currentObligado)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
    }
    currentObligado = rec.obligadoTributarioId;
    currentBatch.push(rec);
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export const ALLOWED_SUBMISSION_TRANSITIONS: Record<FiscalSubmissionStatus, readonly FiscalSubmissionStatus[]> = {
  PENDING: ['SENDING'],
  SENDING: ['ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'PARTIALLY_ACCEPTED', 'REJECTED', 'FAILED_TECHNICAL'],
  FAILED_TECHNICAL: ['RETRY_PENDING'],
  RETRY_PENDING: ['SENDING'],
  ACCEPTED: [], // Estado terminal
  ACCEPTED_WITH_ERRORS: [], // Estado terminal
  PARTIALLY_ACCEPTED: [], // Estado terminal (lote con registros aceptados y registros rechazados)
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

  let updatedResultados = details?.resultadosIndividuales ?? submission.resultadosIndividuales;
  if (!details?.resultadosIndividuales && submission.resultadosIndividuales) {
    updatedResultados = submission.resultadosIndividuales.map(item => {
      let itemStatus: FiscalRecordSubmissionStatus = item.estado;
      let esReintentable = item.esReintentable;
      let requiereSubsanacion = item.requiereSubsanacion;
      let csv = item.csv;

      if (newStatus === 'SENDING') {
        itemStatus = 'SENDING';
      } else if (newStatus === 'ACCEPTED') {
        itemStatus = 'ACCEPTED';
        esReintentable = false;
        requiereSubsanacion = false;
        csv = details?.csv ?? submission.csv ?? item.csv;
      } else if (newStatus === 'ACCEPTED_WITH_ERRORS') {
        itemStatus = 'ACCEPTED_WITH_ERRORS';
        esReintentable = false;
        requiereSubsanacion = false;
        csv = details?.csv ?? submission.csv ?? item.csv;
      } else if (newStatus === 'REJECTED') {
        itemStatus = 'REJECTED';
        esReintentable = false;
        requiereSubsanacion = true;
      } else if (newStatus === 'FAILED_TECHNICAL') {
        itemStatus = 'FAILED_TECHNICAL';
        esReintentable = true;
        requiereSubsanacion = false;
      } else if (newStatus === 'RETRY_PENDING') {
        itemStatus = 'RETRY_PENDING';
        esReintentable = true;
      }

      return {
        ...item,
        estado: itemStatus,
        csv,
        esReintentable,
        requiereSubsanacion
      };
    });
  }

  const updated: FiscalSubmission = {
    ...submission,
    estado: newStatus,
    estadoEnvioAeat: details?.estadoEnvioAeat ?? submission.estadoEnvioAeat,
    resultadosIndividuales: updatedResultados,
    fechaEnvio: newStatus === 'SENDING' ? ahora : submission.fechaEnvio,
    fechaRespuesta: ['ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'PARTIALLY_ACCEPTED', 'REJECTED', 'FAILED_TECHNICAL'].includes(newStatus)
      ? ahora
      : submission.fechaRespuesta,
    completadoEn: ['ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'PARTIALLY_ACCEPTED'].includes(newStatus)
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
 * Comprueba si una FiscalSubmission contiene un FiscalRecord determinado (ya sea individual o en lote).
 */
export function submissionContainsRecord(submission: FiscalSubmission, fiscalRecordId: string): boolean {
  if (!submission || !fiscalRecordId) return false;
  if (submission.fiscalRecordId === fiscalRecordId) return true;
  if (Array.isArray(submission.fiscalRecordIds) && submission.fiscalRecordIds.includes(fiscalRecordId)) {
    return true;
  }
  if (Array.isArray(submission.resultadosIndividuales)) {
    return submission.resultadosIndividuales.some(r => r.fiscalRecordId === fiscalRecordId);
  }
  return false;
}

/**
 * Obtiene el resultado individual de un FiscalRecord específico dentro de una FiscalSubmission.
 */
export function getRecordResultFromSubmission(
  submission: FiscalSubmission,
  fiscalRecordId: string
): FiscalRecordSubmissionResult | undefined {
  if (!submission || !fiscalRecordId) return undefined;
  if (Array.isArray(submission.resultadosIndividuales)) {
    const found = submission.resultadosIndividuales.find(r => r.fiscalRecordId === fiscalRecordId);
    if (found) return found;
  }
  if (submission.fiscalRecordId === fiscalRecordId) {
    const fallbackStatus: FiscalRecordSubmissionStatus =
      submission.estado === 'PARTIALLY_ACCEPTED' ? 'ACCEPTED_WITH_ERRORS' : submission.estado;
    return {
      fiscalRecordId: submission.fiscalRecordId,
      numeroFactura: submission.numeroFactura,
      fechaExpedicion: '',
      tipoRegistro: 'alta',
      estado: fallbackStatus,
      codigoErrorRegistro: submission.codigoAeat,
      descripcionErrorRegistro: submission.descripcion,
      csv: submission.csv,
      esReintentable: fallbackStatus === 'FAILED_TECHNICAL' || fallbackStatus === 'RETRY_PENDING',
      requiereSubsanacion: fallbackStatus === 'REJECTED'
    };
  }
  return undefined;
}

/**
 * Consulta todas las sumisiones asociadas a un FiscalRecord determinado (individuales o por lote).
 */
export function getSubmissionsForRecord(fiscalRecordId: string): FiscalSubmission[] {
  return outboxSubmissions.filter(s => submissionContainsRecord(s, fiscalRecordId));
}

export interface RecordAuthoritativeOutboxState {
  readonly fiscalRecordId: string;
  readonly status: FiscalRecordSubmissionStatus | 'NOT_SUBMITTED';
  readonly acceptedSubmission?: FiscalSubmission;
  readonly activeSendingSubmission?: FiscalSubmission;
  readonly latestSubmission?: FiscalSubmission;
  readonly latestRecordResult?: FiscalRecordSubmissionResult;
  readonly isAccepted: boolean;
  readonly isSending: boolean;
  readonly isRejected: boolean;
  readonly isPendingOrRetryable: boolean;
  readonly totalAttempts: number;
}

/**
 * Resuelve el estado autoritativo de un FiscalRecord individual a través de todas las
 * FiscalSubmission (individuales o por lote) en las que haya participado.
 *
 * Permite determinar con precisión qué registros de un lote fueron aceptados, cuáles
 * fueron rechazados funcionalmente (PARTIALLY_ACCEPTED / REJECTED) y cuáles sufrieron
 * un fallo técnico reintentable.
 */
export function resolveRecordOutboxState(
  fiscalRecordId: string,
  submissions: ReadonlyArray<FiscalSubmission>
): RecordAuthoritativeOutboxState {
  const relevant = submissions.filter(s => submissionContainsRecord(s, fiscalRecordId));
  if (relevant.length === 0) {
    return {
      fiscalRecordId,
      status: 'NOT_SUBMITTED',
      isAccepted: false,
      isSending: false,
      isRejected: false,
      isPendingOrRetryable: true,
      totalAttempts: 0
    };
  }

  for (const sub of relevant) {
    const res = getRecordResultFromSubmission(sub, fiscalRecordId);
    if (res && (res.estado === 'ACCEPTED' || res.estado === 'ACCEPTED_WITH_ERRORS')) {
      return {
        fiscalRecordId,
        status: res.estado,
        acceptedSubmission: sub,
        latestSubmission: sub,
        latestRecordResult: res,
        isAccepted: true,
        isSending: false,
        isRejected: false,
        isPendingOrRetryable: false,
        totalAttempts: relevant.length
      };
    }
  }

  for (const sub of relevant) {
    const res = getRecordResultFromSubmission(sub, fiscalRecordId);
    if (sub.estado === 'SENDING' || res?.estado === 'SENDING') {
      return {
        fiscalRecordId,
        status: 'SENDING',
        activeSendingSubmission: sub,
        latestSubmission: sub,
        latestRecordResult: res,
        isAccepted: false,
        isSending: true,
        isRejected: false,
        isPendingOrRetryable: false,
        totalAttempts: relevant.length
      };
    }
  }

  const latestSub = relevant[relevant.length - 1];
  const latestRes = getRecordResultFromSubmission(latestSub, fiscalRecordId);
  const status: FiscalRecordSubmissionStatus = latestRes?.estado || (
    latestSub.estado === 'PARTIALLY_ACCEPTED' ? 'REJECTED' : latestSub.estado
  );

  const isRejected = status === 'REJECTED';
  const isPendingOrRetryable =
    status === 'PENDING' ||
    status === 'FAILED_TECHNICAL' ||
    status === 'RETRY_PENDING';

  return {
    fiscalRecordId,
    status,
    latestSubmission: latestSub,
    latestRecordResult: latestRes,
    isAccepted: false,
    isSending: false,
    isRejected,
    isPendingOrRetryable,
    totalAttempts: relevant.length
  };
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
