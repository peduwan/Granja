/**
 * PROCESADOR AUTORITATIVO DE LOTES Y OUTBOX VERI*FACTU (1 A 1.000 REGISTROS) (FASE 4.2)
 *
 * Normativa de Referencia:
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 * - Especificación Técnica Servicios Web AEAT: SuministroLR.xsd (1..1000 RegistroFactura) y RespuestaSuministro.xsd
 *
 * RESPONSABILIDAD:
 * Conecta de forma productiva y transaccional:
 * - Custodia fiscal autoritativa (BackendFiscalCustody / CloudDistributedChainCoordinator)
 * - Outbox de remisiones (FiscalSubmission con 1..1000 FiscalRecord)
 * - Cerrojos distribuidos con renovación de lease (Heartbeat) y protección TOCTOU
 * - Control de flujo dinámico AEAT (<TiempoEsperaEnvio>)
 * - Transporte SOAP/mTLS y correlación individual por línea (<sfR:RespuestaLinea>)
 */

import {
  FiscalRecord,
  FiscalSubmission,
  FiscalRecordSubmissionResult,
  FiscalConfiguration,
  FiscalEvent,
  FiscalActor
} from './types';
import { BackendFiscalCustody } from './backendCustodyRepository';
import { verifyFiscalRecordHash } from './hashService';
import {
  createFiscalSubmission,
  partitionRecordsIntoBatches,
  resolveRecordOutboxState,
  RecordAuthoritativeOutboxState,
  MAX_RECORDS_PER_AEAT_SUBMISSION
} from './submissionService';
import {
  executeAeatSubmission,
  AeatFlowControlManager,
  AeatTransportResult,
  MAX_RETRY_ATTEMPTS
} from './aeatTransport';
import { AeatCertificateProvider } from './aeatCertificateProvider';
import { getAeatSoapEndpoint } from './aeatEndpoints';
import { MockScenario, MockRecordLineSpec } from './mockAeatTransport';

export class FiscalSubmissionHttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'FiscalSubmissionHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface AuthoritativeSubmitRequest {
  readonly fiscalRecordId?: string;
  readonly fiscalRecordIds?: ReadonlyArray<string>;
  readonly batchFromOutbox?: boolean;
  readonly obligadoTributarioId?: string;
  readonly maxBatchSize?: number;
  readonly actor?: FiscalActor;
  readonly authorizeObligadoFn?: (obligadoTributarioId: string) => void;
  /**
   * Opciones internas exclusivas para pruebas de integración en backend (nunca expuestas a payloads de cliente).
   */
  readonly internalTestOptions?: {
    readonly mockScenario?: MockScenario;
    readonly mockTiempoEsperaEnvio?: number;
    readonly mockLineOverrides?: Record<string, Partial<MockRecordLineSpec>>;
  };
}

export interface AuthoritativeSubmitResponse extends Omit<Partial<AeatTransportResult>, 'fiscalEvent'> {
  readonly submission?: FiscalSubmission;
  readonly fiscalEvent?: FiscalEvent | null;
  readonly resultadosIndividuales?: ReadonlyArray<FiscalRecordSubmissionResult>;
  readonly recordResult?: FiscalRecordSubmissionResult;
  readonly cantidadRegistros?: number;
  readonly esBatch?: boolean;
  readonly isTechnicalError: boolean;
  readonly idempotentReplay?: boolean;
  readonly emptyOutbox?: boolean;
  readonly message?: string;
}

/**
 * Construye autoritativamente en servidor la configuración fiscal para un obligado tributario.
 */
export function buildServerAuthoritativeFiscalConfig(record: FiscalRecord): FiscalConfiguration {
  const isProdEnv = process.env.AEAT_ENVIRONMENT === 'produccion' || process.env.AEAT_ENVIRONMENT === 'production';
  const entornoAeat = isProdEnv ? 'produccion' : 'pruebas';
  const hasCert = AeatCertificateProvider.hasCertificate();
  const endpointUrl = getAeatSoapEndpoint(isProdEnv ? 'production' : 'test');

  return {
    obligadoTributarioId: record.obligadoTributarioId,
    nifEmisor: record.emisor.nif,
    nombreRazonEmisor: record.emisor.nombreRazon,
    modalidad: 'VERI_FACTU',
    entornoAeat,
    versionEspecificacion: '1.0',
    sistemaInformatico: {
      nombreRazon: 'Gestión Avícola Software S.L.',
      nif: 'B99999999',
      nombreSistemaInformatico: 'Gestión Avícola SIF',
      idSistemaInformatico: '01',
      version: '1.0.0',
      numeroInstalacion: 'INST-001',
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'N',
      indicadorMultiplesOT: 'N'
    },
    remisionAutomatica: true,
    reintentosMaximos: 3,
    minutosEntreReintentos: 5,
    transporte: {
      endpointUrl,
      timeoutMs: 30000,
      certificadoConfigurado: hasCert
    },
    certificadoConfigurado: hasCert,
    fechaActivacion: new Date().toISOString()
  };
}

/**
 * Recopila del Outbox autoritativo todos los FiscalRecord pendientes o reintentables
 * para un obligado tributario, preservando el orden de emisión/cadena y excluyendo:
 * - Registros ya aceptados (ACCEPTED o ACCEPTED_WITH_ERRORS, incluso dentro de lotes PARTIALLY_ACCEPTED)
 * - Registros en vuelo (SENDING)
 * - Registros rechazados funcionalmente (REJECTED, requieren subsanación)
 * - Registros que hayan agotado el límite de reintentos técnicos (MAX_RETRY_ATTEMPTS)
 */
export async function collectEligibleOutboxRecordsForObligado(
  obligadoTributarioId: string,
  maxRecords: number = MAX_RECORDS_PER_AEAT_SUBMISSION
): Promise<{
  eligibleRecords: FiscalRecord[];
  statesByRecordId: Map<string, RecordAuthoritativeOutboxState>;
}> {
  const cleanObligado = (obligadoTributarioId || '').trim();
  if (!cleanObligado || cleanObligado === 'ES_UNKNOWN') {
    throw new FiscalSubmissionHttpError(
      400,
      'INVALID_OBLIGADO',
      "El parámetro 'obligadoTributarioId' es obligatorio y no puede ser ES_UNKNOWN."
    );
  }

  const effectiveLimit = Math.max(1, Math.min(Number(maxRecords) || MAX_RECORDS_PER_AEAT_SUBMISSION, MAX_RECORDS_PER_AEAT_SUBMISSION));
  const allRecords = BackendFiscalCustody.getAllFiscalRecords(cleanObligado);
  const eligibleRecords: FiscalRecord[] = [];
  const statesByRecordId = new Map<string, RecordAuthoritativeOutboxState>();

  for (const rec of allRecords) {
    const subs = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(rec.id);
    const state = resolveRecordOutboxState(rec.id, subs);
    statesByRecordId.set(rec.id, state);

    if (
      state.isPendingOrRetryable &&
      !state.isAccepted &&
      !state.isSending &&
      !state.isRejected &&
      state.totalAttempts < MAX_RETRY_ATTEMPTS
    ) {
      eligibleRecords.push(rec);
      if (eligibleRecords.length >= effectiveLimit) {
        break;
      }
    }
  }

  return { eligibleRecords, statesByRecordId };
}

/**
 * Ejecuta de forma autoritativa y transaccional la remisión AEAT (unitaria o por lote de 1 a 1.000 registros).
 */
export async function executeAuthoritativeOutboxSubmission(
  request: AuthoritativeSubmitRequest
): Promise<AuthoritativeSubmitResponse> {
  const {
    fiscalRecordId,
    fiscalRecordIds,
    batchFromOutbox,
    obligadoTributarioId,
    maxBatchSize,
    actor,
    authorizeObligadoFn,
    internalTestOptions
  } = request;

  // 1. Determinar modo de selección de registros (unitario, lote explícito 1..1000, o drenado de Outbox)
  let targetRecordIds: string[] = [];
  let isExplicitBatchRequest = false;

  if (Array.isArray(fiscalRecordIds)) {
    isExplicitBatchRequest = true;
    if (fiscalRecordIds.length === 0) {
      throw new FiscalSubmissionHttpError(
        400,
        'EMPTY_BATCH',
        "El array 'fiscalRecordIds' no puede estar vacío. Se requiere entre 1 y 1000 registros fiscales."
      );
    }
    if (fiscalRecordIds.length > MAX_RECORDS_PER_AEAT_SUBMISSION) {
      throw new FiscalSubmissionHttpError(
        400,
        'BATCH_LIMIT_EXCEEDED',
        `El lote excede el límite máximo normativo AEAT de ${MAX_RECORDS_PER_AEAT_SUBMISSION} registros por envío SOAP (recibidos: ${fiscalRecordIds.length}).`
      );
    }

    const seen = new Set<string>();
    for (const rawId of fiscalRecordIds) {
      if (!rawId || typeof rawId !== 'string' || rawId.trim() === '') {
        throw new FiscalSubmissionHttpError(
          400,
          'INVALID_RECORD_ID',
          "Todos los identificadores en 'fiscalRecordIds' deben ser cadenas no vacías."
        );
      }
      const id = rawId.trim();
      if (seen.has(id)) {
        throw new FiscalSubmissionHttpError(
          400,
          'DUPLICATE_RECORD_IN_BATCH',
          `El registro '${id}' está duplicado dentro del lote solicitado.`
        );
      }
      seen.add(id);
      targetRecordIds.push(id);
    }
  } else if (batchFromOutbox) {
    isExplicitBatchRequest = true;
    if (!obligadoTributarioId || typeof obligadoTributarioId !== 'string' || obligadoTributarioId.trim() === '') {
      throw new FiscalSubmissionHttpError(
        400,
        'MISSING_OBLIGADO_ID',
        "Para 'batchFromOutbox=true' es obligatorio especificar 'obligadoTributarioId'."
      );
    }
    if (maxBatchSize !== undefined && (maxBatchSize < 1 || maxBatchSize > MAX_RECORDS_PER_AEAT_SUBMISSION)) {
      throw new FiscalSubmissionHttpError(
        400,
        'BATCH_LIMIT_EXCEEDED',
        `El tamaño de lote 'maxBatchSize' debe estar entre 1 y ${MAX_RECORDS_PER_AEAT_SUBMISSION} (recibido: ${maxBatchSize}).`
      );
    }
    if (authorizeObligadoFn) {
      authorizeObligadoFn(obligadoTributarioId.trim());
    }
  } else if (fiscalRecordId && typeof fiscalRecordId === 'string' && fiscalRecordId.trim() !== '') {
    targetRecordIds = [fiscalRecordId.trim()];
    isExplicitBatchRequest = false;
  } else {
    throw new FiscalSubmissionHttpError(
      400,
      'MISSING_SUBMIT_TARGET',
      "Campo 'fiscalRecordId' (unitario), 'fiscalRecordIds' (lote 1..1000) o 'batchFromOutbox' obligatorio. Solo se permite remitir registros existentes en la custodia fiscal autoritativa del backend."
    );
  }

  // 2. Validación de seguridad de entorno de producción (Fail-Closed)
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    if (!AeatCertificateProvider.hasCertificate()) {
      throw new FiscalSubmissionHttpError(
        500,
        'MISSING_PRODUCTION_MTLS_CERT',
        'ERROR FATAL DE SEGURIDAD FISCAL: En entorno de producción (NODE_ENV=production) es estrictamente obligatorio disponer de certificado mTLS válido de servidor para comunicarse con la AEAT. Queda terminantemente prohibido el modo mock por omisión.'
      );
    }
    if (process.env.AEAT_TRANSPORT_MODE === 'mock') {
      throw new FiscalSubmissionHttpError(
        500,
        'MOCK_FORBIDDEN_IN_PRODUCTION',
        'ERROR FATAL DE SEGURIDAD FISCAL: AEAT_TRANSPORT_MODE=mock está terminantemente prohibido en entorno de producción.'
      );
    }
  }

  // 3.Si es explícito por IDs, recuperar y verificar criptográficamente cada FiscalRecord antes de bloquear
  let recordsToSubmit: FiscalRecord[] = [];
  let targetObligado: string = obligadoTributarioId ? obligadoTributarioId.trim() : '';

  if (!batchFromOutbox) {
    for (const id of targetRecordIds) {
      const rec = await BackendFiscalCustody.getFiscalRecordByIdAsync(id);
      if (!rec) {
        throw new FiscalSubmissionHttpError(
          404,
          'RECORD_NOT_FOUND',
          `FiscalRecord con id '${id}' no encontrado en la custodia fiscal del backend. Solo pueden remitirse registros legítimos previamente emitidos.`
        );
      }
      recordsToSubmit.push(rec);
    }

    const firstRecord = recordsToSubmit[0];
    targetObligado = firstRecord.obligadoTributarioId;
    const primaryNif = (firstRecord.emisor?.nif || targetObligado).trim().toUpperCase();

    if (authorizeObligadoFn) {
      authorizeObligadoFn(targetObligado);
    }

    for (const rec of recordsToSubmit) {
      if (rec.obligadoTributarioId !== targetObligado) {
        throw new FiscalSubmissionHttpError(
          400,
          'MIXED_OBLIGADO_IN_BATCH',
          `Prohibido mezclar distintos obligados tributarios en un mismo lote AEAT ('${targetObligado}' vs '${rec.obligadoTributarioId}').`
        );
      }
      const recNif = (rec.emisor?.nif || rec.obligadoTributarioId).trim().toUpperCase();
      if (recNif !== primaryNif) {
        throw new FiscalSubmissionHttpError(
          400,
          'MIXED_NIF_IN_BATCH',
          `Prohibido mezclar distintos NIF de emisor en un mismo lote AEAT ('${primaryNif}' vs '${recNif}').`
        );
      }

      const verification = await verifyFiscalRecordHash(rec);
      if (!verification.valid) {
        throw new FiscalSubmissionHttpError(
          400,
          'HASH_INTEGRITY_FAILURE',
          `Fallo de integridad criptográfica en FiscalRecord '${rec.id}': ${verification.reason}. Remisión rechazada por seguridad.`
        );
      }
    }
  }

  // 4. ADQUISICIÓN ATÓMICA DEL CERROJO DISTRIBUIDO CON HEARTBEAT (Elimina carrera TOCTOU)
  const lockAcquired = await AeatFlowControlManager.acquireSendLockAsync(targetObligado);
  if (!lockAcquired) {
    throw new FiscalSubmissionHttpError(
      409,
      'CONCURRENT_SEND_LOCKED',
      `Remisión en vuelo bloqueada: Ya existe un envío concurrente activo para el obligado tributario '${targetObligado}'. Prohibido duplicar envíos en paralelo.`
    );
  }

  try {
    // 5. Si es batchFromOutbox, recolectar registros elegibles DENTRO del cerrojo exclusivo
    if (batchFromOutbox) {
      const { eligibleRecords } = await collectEligibleOutboxRecordsForObligado(
        targetObligado,
        maxBatchSize ?? MAX_RECORDS_PER_AEAT_SUBMISSION
      );
      if (eligibleRecords.length === 0) {
        return {
          emptyOutbox: true,
          cantidadRegistros: 0,
          esBatch: false,
          resultadosIndividuales: [],
          isTechnicalError: false,
          message: `No existen registros fiscales pendientes de remisión en el Outbox para el obligado '${targetObligado}'.`
        };
      }

      for (const rec of eligibleRecords) {
        const verification = await verifyFiscalRecordHash(rec);
        if (!verification.valid) {
          throw new FiscalSubmissionHttpError(
            400,
            'HASH_INTEGRITY_FAILURE',
            `Fallo de integridad criptográfica en FiscalRecord '${rec.id}': ${verification.reason}. Remisión rechazada por seguridad.`
          );
        }
      }
      recordsToSubmit = eligibleRecords;
      targetRecordIds = eligibleRecords.map(r => r.id);
    }

    // 6. Evaluación autoritativa del estado Outbox por cada FiscalRecord DENTRO del cerrojo exclusivo
    const states: RecordAuthoritativeOutboxState[] = [];
    for (const rec of recordsToSubmit) {
      const subs = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(rec.id);
      states.push(resolveRecordOutboxState(rec.id, subs));
    }

    // 6.a Caso 1: Todos los registros solicitados ya están aceptados
    const allAccepted = states.every(s => s.isAccepted && s.acceptedSubmission);
    if (allAccepted) {
      const firstAcceptedSub = states[0].acceptedSubmission!;
      const sameSubmissionForAll = states.every(
        s => s.acceptedSubmission?.id === firstAcceptedSub.id
      );

      // Si es 1 registro o si el lote exacto fue aceptado en la misma FiscalSubmission, replay idempotente HTTP 200
      if (recordsToSubmit.length === 1 || sameSubmissionForAll) {
        const existingEvents = BackendFiscalCustody.getFiscalEvents(recordsToSubmit[0].id);
        return {
          submission: firstAcceptedSub,
          fiscalEvent: existingEvents[existingEvents.length - 1] || null,
          resultadosIndividuales: firstAcceptedSub.resultadosIndividuales,
          recordResult: states[0].latestRecordResult,
          cantidadRegistros: recordsToSubmit.length,
          esBatch: recordsToSubmit.length > 1,
          isTechnicalError: false,
          idempotentReplay: true
        };
      }
    }

    // 6.b Si algún registro dentro de un lote ya fue aceptado previamente (p.ej. en un lote PARTIALLY_ACCEPTED previo),
    // bloquear reenvío de registros ya aceptados para impedir duplicidad fiscal en AEAT
    const alreadyAcceptedStates = states.filter(s => s.isAccepted);
    if (alreadyAcceptedStates.length > 0) {
      const acceptedIds = alreadyAcceptedStates.map(s => s.fiscalRecordId);
      throw new FiscalSubmissionHttpError(
        409,
        'ALREADY_ACCEPTED_RECORDS_IN_BATCH',
        `Remisión de lote bloqueada: Los registros [${acceptedIds.join(', ')}] ya fueron aceptados previamente por la AEAT. No deben volver a incluirse en un nuevo envío.`,
        { acceptedRecordIds: acceptedIds }
      );
    }

    // 6.c Autoridad adicional sobre estado SENDING (Opción C)
    const sendingStates = states.filter(s => s.isSending);
    if (sendingStates.length > 0) {
      const firstSending = sendingStates[0];
      throw new FiscalSubmissionHttpError(
        409,
        'CONCURRENT_SUBMISSION_IN_FLIGHT',
        `Remisión en vuelo detectada: El registro '${firstSending.fiscalRecordId}' ya tiene un envío activo en estado 'SENDING' (${firstSending.activeSendingSubmission?.id}). Prohibido duplicar envíos concurrentes.`,
        { sendingRecordIds: sendingStates.map(s => s.fiscalRecordId) }
      );
    }

    // 6.d Prohibir reenvío ciego de registros rechazados funcionalmente (REJECTED o Incorrecto dentro de PARTIALLY_ACCEPTED)
    const rejectedStates = states.filter(s => s.isRejected);
    if (rejectedStates.length > 0) {
      const firstRej = rejectedStates[0];
      const errCode = firstRej.latestRecordResult?.codigoErrorRegistro || firstRej.latestSubmission?.codigoAeat || '1100';
      const errDesc = firstRej.latestRecordResult?.descripcionErrorRegistro || firstRej.latestSubmission?.descripcion || 'Rechazo funcional';
      throw new FiscalSubmissionHttpError(
        409,
        'REJECTED_REQUIRES_SUBSANACION',
        `Remisión bloqueada: El registro '${firstRej.fiscalRecordId}' fue rechazado funcionalmente por la AEAT ([${errCode}] ${errDesc}). Requiere subsanación reglamentaria, no admite reenvío automático.`,
        { rejectedRecordIds: rejectedStates.map(s => s.fiscalRecordId) }
      );
    }

    // 6.e Límite máximo de reintentos técnicos
    const exhaustedStates = states.filter(
      s => s.totalAttempts >= MAX_RETRY_ATTEMPTS && s.status === 'FAILED_TECHNICAL'
    );
    if (exhaustedStates.length > 0) {
      const firstExh = exhaustedStates[0];
      throw new FiscalSubmissionHttpError(
        429,
        'MAX_RETRIES_EXCEEDED',
        `Límite máximo de reintentos técnicos (${MAX_RETRY_ATTEMPTS}) alcanzado para el registro '${firstExh.fiscalRecordId}'.`,
        { exhaustedRecordIds: exhaustedStates.map(s => s.fiscalRecordId) }
      );
    }

    // 6.f Verificar ventana distribuida de control de flujo AEAT (<TiempoEsperaEnvio>) antes de enviar
    const sendAllowedByFlow = await AeatFlowControlManager.isSendAllowedAsync(targetObligado);
    if (!sendAllowedByFlow) {
      const nextAllowed = (await AeatFlowControlManager.getFlowStateAsync(targetObligado))?.nextAllowedSendTimestamp ?? 0;
      const waitSec = Math.max(1, Math.ceil((nextAllowed - Date.now()) / 1000));
      throw new FiscalSubmissionHttpError(
        429,
        'FLOW_CONTROL_WAIT_ACTIVE',
        `Control de flujo oficial AEAT activo para el obligado ${targetObligado}. Debe aguardar ${waitSec}s (<TiempoEsperaEnvio>) antes del próximo envío.`,
        { waitSeconds: waitSec }
      );
    }

    // 7. Construir FiscalSubmission (1..1000 registros) y configuración autoritativa en servidor
    const primaryRecord = recordsToSubmit[0];
    const serverFiscalConfig = buildServerAuthoritativeFiscalConfig(primaryRecord);
    const maxPreviousAttempts = states.reduce((max, s) => Math.max(max, s.totalAttempts), 0);
    const nextAttemptNumber = maxPreviousAttempts + 1;

    const serverSubmission = createFiscalSubmission(
      recordsToSubmit.length === 1 && !isExplicitBatchRequest ? primaryRecord : recordsToSubmit,
      serverFiscalConfig,
      { numeroIntento: nextAttemptNumber }
    );

    const serverTransportMode = isProduction
      ? 'real'
      : (process.env.AEAT_TRANSPORT_MODE || (AeatCertificateProvider.hasCertificate() ? 'real' : 'mock'));

    // 8. Ejecutar transporte SOAP con un único envío para los 1..1000 registros del lote
    const result = await executeAeatSubmission({
      submission: serverSubmission,
      fiscalRecords: recordsToSubmit,
      config: serverFiscalConfig,
      options: {
        transportMode: serverTransportMode as any,
        mockScenario: internalTestOptions?.mockScenario,
        mockTiempoEsperaEnvio: internalTestOptions?.mockTiempoEsperaEnvio,
        mockLineOverrides: internalTestOptions?.mockLineOverrides,
        acquireLock: false,
        actor: actor || {
          tipo: 'SYSTEM',
          nombre: 'OutboxBatchProcessor'
        },
        // Outbox Pre-Commit: Persiste en la autoridad distribuida el estado SENDING ANTES de enviar por red
        onBeforeNetworkSend: async (sendingSub, startEvt) => {
          await BackendFiscalCustody.saveFiscalSubmission(sendingSub);
          await BackendFiscalCustody.saveFiscalEvent(startEvt);
        }
      }
    });

    // 9. Persistencia fail-closed del estado terminal (con resultadosIndividuales por registro) y evento
    await BackendFiscalCustody.saveFiscalSubmission(result.submission);
    await BackendFiscalCustody.saveFiscalEvent(result.fiscalEvent);

    return {
      ...result,
      resultadosIndividuales: result.submission.resultadosIndividuales,
      recordResult: result.submission.resultadosIndividuales?.[0],
      cantidadRegistros: recordsToSubmit.length,
      esBatch: recordsToSubmit.length > 1
    };
  } finally {
    await AeatFlowControlManager.releaseSendLockAsync(targetObligado);
  }
}

export { partitionRecordsIntoBatches };
