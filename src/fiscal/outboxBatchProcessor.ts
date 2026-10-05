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
  ResolveOutboxStateOptions,
  transitionSubmissionStatus,
  submissionContainsRecord,
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
    readonly transportMode?: 'mock' | 'real';
    readonly mockScenario?: MockScenario;
    readonly mockTiempoEsperaEnvio?: number;
    readonly mockLineOverrides?: Record<string, Partial<MockRecordLineSpec>>;
    readonly staleSendingThresholdMs?: number;
    readonly nowMs?: number;
    readonly customFetch?: typeof fetch;
  };
}

export interface AuthoritativeSubmitResponse extends Omit<Partial<AeatTransportResult>, 'fiscalEvent'> {
  readonly submission?: FiscalSubmission;
  readonly submissions?: ReadonlyArray<FiscalSubmission>;
  readonly fiscalEvent?: FiscalEvent | null;
  readonly fiscalEvents?: ReadonlyArray<FiscalEvent>;
  readonly resultadosIndividuales?: ReadonlyArray<FiscalRecordSubmissionResult>;
  readonly recordResult?: FiscalRecordSubmissionResult;
  readonly cantidadRegistros?: number;
  readonly cantidadLotes?: number;
  readonly authoritativePendingCountBeforeSend?: number;
  readonly reconciledOrphanedSubmissionIds?: ReadonlyArray<string>;
  readonly reconciledRecordIds?: ReadonlyArray<string>;
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
 * Recopila del Outbox autoritativo (consultando Firestore / CloudDistributedChainCoordinator)
 * todos los FiscalRecord pendientes o reintentables para un obligado tributario,
 * preservando el orden determinista de la cadena fiscal y excluyendo:
 * - Registros ya aceptados (ACCEPTED o ACCEPTED_WITH_ERRORS, incluso dentro de lotes PARTIALLY_ACCEPTED)
 * - Registros en vuelo (SENDING)
 * - Registros rechazados funcionalmente (REJECTED, requieren subsanación)
 * - Registros que hayan agotado el límite de reintentos técnicos (MAX_RETRY_ATTEMPTS)
 *
 * IMPORTANTE:
 * - No trunca artificialmente a 1.000 registros si no se especifica `maxRecords`, permitiendo
 *   conocer el `totalPendingCount` autoritativo real (ej. 2.501 pendientes) y particionarlo en lotes
 *   de hasta 1.000 registros mediante `partitionRecordsIntoBatches`.
 */
export async function collectEligibleOutboxRecordsForObligado(
  obligadoTributarioId: string,
  maxRecords?: number,
  options?: ResolveOutboxStateOptions
): Promise<{
  eligibleRecords: FiscalRecord[];
  allEligibleRecords: FiscalRecord[];
  totalPendingCount: number;
  batches: FiscalRecord[][];
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

  // 1. Obtener autoritativamente TODOS los FiscalRecord del obligado desde Firestore / Cloud Authority
  // y ordenarlos según el encadenamiento criptográfico fiscal (nunca depender solo de recordsCache local).
  const allRecords = await BackendFiscalCustody.getAllFiscalRecordsByObligadoAsync(cleanObligado);

  // 2. Obtener autoritativamente todas las FiscalSubmission del obligado desde Firestore / Cloud Authority
  const allObligadoSubmissions = await BackendFiscalCustody.getFiscalSubmissionsByObligadoAsync(cleanObligado);

  // Pre-indexar sumisiones por fiscalRecordId en O(S) para evitar escaneos cuadráticos en lotes de >1.000 registros
  const subsByRecordId = new Map<string, FiscalSubmission[]>();
  const addSubForRecord = (recId: string | undefined, sub: FiscalSubmission) => {
    if (!recId) return;
    let list = subsByRecordId.get(recId);
    if (!list) {
      list = [];
      subsByRecordId.set(recId, list);
    }
    if (!list.some(existing => existing.id === sub.id)) {
      list.push(sub);
    }
  };

  for (const sub of allObligadoSubmissions) {
    addSubForRecord(sub.fiscalRecordId, sub);
    if (Array.isArray(sub.fiscalRecordIds)) {
      for (const rId of sub.fiscalRecordIds) {
        addSubForRecord(rId, sub);
      }
    }
    if (Array.isArray(sub.resultadosIndividuales)) {
      for (const resItem of sub.resultadosIndividuales) {
        addSubForRecord(resItem.fiscalRecordId, sub);
      }
    }
  }

  const allEligibleRecords: FiscalRecord[] = [];
  const statesByRecordId = new Map<string, RecordAuthoritativeOutboxState>();

  for (const rec of allRecords) {
    let subsForRec = subsByRecordId.get(rec.id) || [];
    // Si el conjunto de registros es pequeño, contrastar también con getFiscalSubmissionsForRecordAsync
    if (allRecords.length <= 25) {
      const directSubs = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(rec.id);
      const mergedMap = new Map<string, FiscalSubmission>();
      for (const s of subsForRec) mergedMap.set(s.id, s);
      for (const s of directSubs) mergedMap.set(s.id, s);
      subsForRec = Array.from(mergedMap.values());
    }

    const state = resolveRecordOutboxState(rec.id, subsForRec, options);
    statesByRecordId.set(rec.id, state);

    if (
      state.isPendingOrRetryable &&
      !state.isAccepted &&
      !state.isSending &&
      !state.isRejected &&
      (state.totalAttempts < MAX_RETRY_ATTEMPTS || state.isOrphanedSending)
    ) {
      allEligibleRecords.push(rec);
    }
  }

  const totalPendingCount = allEligibleRecords.length;
  const eligibleRecords =
    typeof maxRecords === 'number' && maxRecords > 0
      ? allEligibleRecords.slice(0, maxRecords)
      : allEligibleRecords;

  const effectiveBatchSize =
    typeof maxRecords === 'number' && maxRecords > 0
      ? Math.min(maxRecords, MAX_RECORDS_PER_AEAT_SUBMISSION)
      : MAX_RECORDS_PER_AEAT_SUBMISSION;

  const batches = partitionRecordsIntoBatches(eligibleRecords, effectiveBatchSize);

  return {
    eligibleRecords,
    allEligibleRecords,
    totalPendingCount,
    batches,
    statesByRecordId
  };
}

/**
 * Ejecuta de forma autoritativa y transaccional la remisión AEAT:
 * - Unitaria (1 registro)
 * - Lote explícito (1..1.000 registros o particionado automático si >1.000, reordenado según cadena fiscal)
 * - Drenado automático del Outbox (`batchFromOutbox: true`), dividiendo >1.000 pendientes en múltiples
 *   peticiones SOAP consecutivas de hasta 1.000 registros mediante `partitionRecordsIntoBatches`
 *   (ej. 2.501 pendientes -> SOAP #1: 1.000, SOAP #2: 1.000, SOAP #3: 501) y activando el disparador
 *   autoritativo de >=1.000 pendientes frente a <TiempoEsperaEnvio>.
 * - Reconciliación controlada de envíos SENDING huérfanos tras caída de instancia o expiración de lease.
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

  // 1. Determinar modo de selección de registros (unitario, lote explícito, o drenado de Outbox)
  let targetRecordIds: string[] = [];
  let isExplicitBatchRequest = false;

  if (Array.isArray(fiscalRecordIds)) {
    isExplicitBatchRequest = true;
    if (fiscalRecordIds.length === 0) {
      throw new FiscalSubmissionHttpError(
        400,
        'EMPTY_BATCH',
        "El array 'fiscalRecordIds' no puede estar vacío. Se requiere al menos 1 registro fiscal."
      );
    }
    if (fiscalRecordIds.length > MAX_RECORDS_PER_AEAT_SUBMISSION && !batchFromOutbox) {
      throw new FiscalSubmissionHttpError(
        400,
        'BATCH_LIMIT_EXCEEDED',
        `El lote explícito excede el límite máximo normativo AEAT de ${MAX_RECORDS_PER_AEAT_SUBMISSION} registros por envío SOAP (recibidos: ${fiscalRecordIds.length}).`
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

  // 3. Si es explícito por IDs, recuperar, verificar criptográficamente y REORDENAR según la cadena fiscal antes de bloquear
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

    // Reordenar autoritativamente el batch explícito según la cadena criptográfica fiscal (orderRecordsByFiscalChain).
    // Prohibido respetar un orden arbitrario (ej. [R3, R1, R2]) suministrado por el cliente.
    if (recordsToSubmit.length > 1) {
      recordsToSubmit = BackendFiscalCustody.orderRecordsByFiscalChain(recordsToSubmit);
      targetRecordIds = recordsToSubmit.map(r => r.id);
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
    const resolveOptions: ResolveOutboxStateOptions = {
      nowMs: internalTestOptions?.nowMs,
      staleSendingThresholdMs: internalTestOptions?.staleSendingThresholdMs
    };

    // 5. Consultar el estado autoritativo completo del Outbox para este obligado DENTRO del cerrojo exclusivo
    const authoritativeOutboxSnapshot = await collectEligibleOutboxRecordsForObligado(
      targetObligado,
      batchFromOutbox ? maxBatchSize : undefined,
      resolveOptions
    );

    if (batchFromOutbox) {
      const { eligibleRecords } = authoritativeOutboxSnapshot;
      if (eligibleRecords.length === 0) {
        return {
          emptyOutbox: true,
          cantidadRegistros: 0,
          cantidadLotes: 0,
          authoritativePendingCountBeforeSend: 0,
          esBatch: false,
          submissions: [],
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

    // 6. Evaluación autoritativa del estado Outbox por cada FiscalRecord solicitado DENTRO del cerrojo exclusivo
    const states: RecordAuthoritativeOutboxState[] = [];
    const statesMap = new Map<string, RecordAuthoritativeOutboxState>();

    for (const rec of recordsToSubmit) {
      let state = authoritativeOutboxSnapshot.statesByRecordId.get(rec.id);
      if (!state || recordsToSubmit.length <= 25) {
        const subs = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(rec.id);
        state = resolveRecordOutboxState(rec.id, subs, resolveOptions);
      }
      states.push(state);
      statesMap.set(rec.id, state);
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
          submissions: [firstAcceptedSub],
          fiscalEvent: existingEvents[existingEvents.length - 1] || null,
          resultadosIndividuales: firstAcceptedSub.resultadosIndividuales,
          recordResult: states[0].latestRecordResult,
          cantidadRegistros: recordsToSubmit.length,
          cantidadLotes: 1,
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

    // 6.c Autoridad sobre estado SENDING legítimamente activo (dentro de su ventana de lease):
    // Bloquea con 409 CONCURRENT_SUBMISSION_IN_FLIGHT.
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

    // 6.c.2 Reconciliación explícita de envíos SENDING huérfanos (abandonados tras caída de Cloud Run o expiración de lease):
    // No se hace un simple cambio ciego a RETRY_PENDING: se registra explícitamente la condición de
    // "resultado AEAT desconocido" (ORPHANED_SENDING_UNKNOWN_OUTCOME) en la FiscalSubmission huérfana y en el
    // libro de auditoría FiscalEvent, y se marcan los registros afectados como `reconcilingRecordIds` para que,
    // si el SOAP anterior sí había llegado a AEAT y esta responde con código 3000 + <sfR:RegistroDuplicado>,
    // se reconcilie formalmente el estado real en AEAT (Correcta / AceptadaConErrores) sin causar duplicidad ni bloqueo perpetuo.
    const orphanedStates = states.filter(s => s.isOrphanedSending || s.resultadoAeatDesconocido);
    const reconciledOrphanedSubmissionIds: string[] = [];
    const reconciledRecordIds: string[] = orphanedStates.map(s => s.fiscalRecordId);

    if (orphanedStates.length > 0) {
      const uniqueOrphanSubs = new Map<string, FiscalSubmission>();
      for (const st of orphanedStates) {
        if (st.orphanedSendingSubmission && st.orphanedSendingSubmission.estado === 'SENDING') {
          uniqueOrphanSubs.set(st.orphanedSendingSubmission.id, st.orphanedSendingSubmission);
        }
      }

      for (const orphanSub of uniqueOrphanSubs.values()) {
        const failedOrphan = transitionSubmissionStatus(orphanSub, 'FAILED_TECHNICAL', {
          codigoAeat: 'ORPHANED_SENDING_UNKNOWN_OUTCOME',
          descripcion: `Envío SENDING huérfano detectado tras expiración de lease distribuido (instancia previa caída o timeout sin cierre). Resultado en AEAT desconocido; se inicia reconciliación controlada.`
        });
        const retryPendingOrphan = transitionSubmissionStatus(failedOrphan, 'RETRY_PENDING', {
          codigoAeat: 'ORPHANED_SENDING_UNKNOWN_OUTCOME',
          descripcion: failedOrphan.descripcion,
          proximoReintento: new Date().toISOString()
        });
        await BackendFiscalCustody.saveFiscalSubmission(retryPendingOrphan);

        const orphanActor: FiscalActor = actor || { tipo: 'SYSTEM', nombre: 'OutboxOrphanReconciler' };
        const orphanEvent: FiscalEvent = Object.freeze({
          id: `fevt-orphan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          obligadoTributarioId: targetObligado,
          tipo: 'ENVIO_AEAT_ERROR_TECNICO',
          fechaHora: new Date().toISOString(),
          actor: orphanActor,
          fiscalRecordId: orphanSub.fiscalRecordId,
          numeroFactura: orphanSub.numeroFactura,
          descripcion: `Reconciliación de FiscalSubmission SENDING huérfana (${orphanSub.id}): resultado AEAT desconocido tras expiración de lease. Se habilita consulta/reconciliación controlada ante AEAT (con soporte de RegistroDuplicado 3000).`,
          datos: {
            orphanedSubmissionId: orphanSub.id,
            fiscalRecordIds: orphanSub.fiscalRecordIds || [orphanSub.fiscalRecordId],
            resultadoAeatDesconocido: true
          }
        });
        await BackendFiscalCustody.saveFiscalEvent(orphanEvent);
        reconciledOrphanedSubmissionIds.push(orphanSub.id);
      }
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

    // 6.e Límite máximo de reintentos técnicos (excluyendo reconciliaciones de SENDING huérfano con resultado desconocido)
    const exhaustedStates = states.filter(
      s => s.totalAttempts >= MAX_RETRY_ATTEMPTS && s.status === 'FAILED_TECHNICAL' && !s.isOrphanedSending && !s.resultadoAeatDesconocido
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

    // 6.f Verificar ventana distribuida de control de flujo AEAT (<TiempoEsperaEnvio>)
    // pasando el conteo AUTORITATIVO de registros pendientes en el Outbox de servidor
    // (Regla disyuntiva AEAT: se envía si ahora >= nextAllowedSendTimestamp O si pendientes >= 1.000).
    const authoritativePendingCount = Math.max(
      authoritativeOutboxSnapshot.totalPendingCount,
      recordsToSubmit.length
    );

    const sendAllowedByFlow = await AeatFlowControlManager.isSendAllowedAsync(
      targetObligado,
      undefined,
      authoritativePendingCount
    );
    if (!sendAllowedByFlow) {
      const nextAllowed = (await AeatFlowControlManager.getFlowStateAsync(targetObligado))?.nextAllowedSendTimestamp ?? 0;
      const waitSec = Math.max(1, Math.ceil((nextAllowed - Date.now()) / 1000));
      throw new FiscalSubmissionHttpError(
        429,
        'FLOW_CONTROL_WAIT_ACTIVE',
        `Control de flujo oficial AEAT activo para el obligado ${targetObligado}. Debe aguardar ${waitSec}s (<TiempoEsperaEnvio>) o acumular ${MAX_RECORDS_PER_AEAT_SUBMISSION} registros pendientes (actuales: ${authoritativePendingCount}) antes del próximo envío.`,
        { waitSeconds: waitSec, authoritativePendingCount }
      );
    }

    // 7. Particionar los registros pendientes en lotes normativos de 1..1.000 usando partitionRecordsIntoBatches
    // (Ej.: 2.501 pendientes -> Lote 1 = 1.000, Lote 2 = 1.000, Lote 3 = 501)
    const effectiveBatchSize =
      typeof maxBatchSize === 'number' && maxBatchSize > 0
        ? Math.min(maxBatchSize, MAX_RECORDS_PER_AEAT_SUBMISSION)
        : MAX_RECORDS_PER_AEAT_SUBMISSION;

    const batches = partitionRecordsIntoBatches(recordsToSubmit, effectiveBatchSize);

    const serverTransportMode = isProduction
      ? 'real'
      : (process.env.AEAT_TRANSPORT_MODE || (AeatCertificateProvider.hasCertificate() ? 'real' : 'mock'));

    const batchSubmissions: FiscalSubmission[] = [];
    const batchEvents: FiscalEvent[] = [];
    const allResultadosIndividuales: FiscalRecordSubmissionResult[] = [];
    let lastTransportResult: AeatTransportResult | undefined;
    let anyTechnicalError = false;

    // 8. Ejecutar secuencialmente cada lote de hasta 1.000 registros como una petición SOAP independiente
    for (let i = 0; i < batches.length; i++) {
      const batchRecords = batches[i];
      const primaryRecord = batchRecords[0];
      const serverFiscalConfig = buildServerAuthoritativeFiscalConfig(primaryRecord);

      const batchStates = batchRecords.map(r => statesMap.get(r.id)).filter(Boolean) as RecordAuthoritativeOutboxState[];
      const maxPreviousAttempts = batchStates.reduce((max, s) => Math.max(max, s.totalAttempts), 0);
      const nextAttemptNumber = maxPreviousAttempts + 1;
      const batchReconcilingRecordIds = batchStates
        .filter(s => s.isOrphanedSending || s.resultadoAeatDesconocido)
        .map(s => s.fiscalRecordId);

      const serverSubmission = createFiscalSubmission(
        batchRecords.length === 1 && !isExplicitBatchRequest && batches.length === 1
          ? primaryRecord
          : batchRecords,
        serverFiscalConfig,
        { numeroIntento: nextAttemptNumber }
      );

      const result = await executeAeatSubmission({
        submission: serverSubmission,
        fiscalRecords: batchRecords,
        config: serverFiscalConfig,
        options: {
          transportMode: (internalTestOptions?.transportMode || serverTransportMode) as any,
          mockScenario: internalTestOptions?.mockScenario,
          mockTiempoEsperaEnvio: internalTestOptions?.mockTiempoEsperaEnvio,
          mockLineOverrides: internalTestOptions?.mockLineOverrides,
          customFetch: internalTestOptions?.customFetch,
          reconcilingRecordIds: batchReconcilingRecordIds,
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

      batchSubmissions.push(result.submission);
      batchEvents.push(result.fiscalEvent);
      if (result.submission.resultadosIndividuales) {
        allResultadosIndividuales.push(...result.submission.resultadosIndividuales);
      }
      lastTransportResult = result;

      // Si el transporte falla técnicamente (HTTP 5xx, timeout, red), detener el drenado de los lotes subsiguientes
      if (result.isTechnicalError) {
        anyTechnicalError = true;
        break;
      }
    }

    const primaryOrLastSub = batchSubmissions[batchSubmissions.length - 1];
    const primaryOrLastEvt = batchEvents[batchEvents.length - 1] || null;

    return {
      ...(lastTransportResult || {}),
      submission: primaryOrLastSub,
      submissions: batchSubmissions,
      fiscalEvent: primaryOrLastEvt,
      fiscalEvents: batchEvents,
      resultadosIndividuales: allResultadosIndividuales,
      recordResult: allResultadosIndividuales[0],
      cantidadRegistros: allResultadosIndividuales.length,
      cantidadLotes: batchSubmissions.length,
      authoritativePendingCountBeforeSend: authoritativePendingCount,
      reconciledOrphanedSubmissionIds: reconciledOrphanedSubmissionIds.length > 0 ? reconciledOrphanedSubmissionIds : undefined,
      reconciledRecordIds: reconciledRecordIds.length > 0 ? reconciledRecordIds : undefined,
      esBatch: recordsToSubmit.length > 1 || batchSubmissions.length > 1,
      isTechnicalError: anyTechnicalError
    };
  } finally {
    await AeatFlowControlManager.releaseSendLockAsync(targetObligado);
  }
}

export { partitionRecordsIntoBatches };
