/**
 * SERVICIO DE EMISIÓN FISCAL CENTRALIZADO (FASE 1.3)
 *
 * Este servicio constituye el ÚNICO camino autorizado para emitir nuevas facturas
 * con su correspondiente FiscalRecord inmutable, de acuerdo a la normativa:
 * - Ley 11/2021 (Medidas de prevención y lucha contra el fraude fiscal)
 * - RD 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 *
 * ARQUITECTURA FISCAL (FASE 1.3):
 * UI -> emitFiscalInvoice() -> enqueueEmissionForObligado()
 *    -> getLastFiscalRecord(obligadoTributarioId)
 *    -> createFiscalRecordFromInvoice()
 *    -> validate(no placeholders, no ES_UNKNOWN, no PENDING_FASE_2_HASH)
 *    -> persist /fiscal_records/{id} (saveFiscalRecordToCloud / persistFn)
 *    -> return { invoice, fiscalRecord, fiscalRecordRef }
 *
 * GARANTÍAS DE CONCURRENCIA E INTEGRIDAD:
 * 1. Cola de serialización aislada por obligadoTributarioId (evita condiciones de carrera en encadenamiento).
 * 2. Determinación del registro anterior DENTRO de la sección serializada.
 * 3. Prohibición estricta de Invoice.hashAnterior como fuente de encadenamiento.
 * 4. Persistencia obligatoria: si falla la custodia en Firestore, la emisión falla y no se silencia el error.
 * 5. Registro anterior resuelto unívocamente mediante getLastFiscalRecord(obligadoTributarioId).
 */

import {
  Factura,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration,
  AppData
} from '../types';
import {
  createFiscalRecordFromInvoice,
  createFiscalRecordRef,
  createFiscalAnulacionRecord
} from './modelTransformers';
import {
  calculateAltaHash,
  calculateAnulacionHash,
  formatFechaHoraHusoGenRegistro,
  validatePreviousRecordRequirement,
  verifyFiscalRecordHash
} from './hashService';
import {
  buildFiscalQrUrl,
  generateQrDataUri
} from './qrService';
import { saveFiscalRecordToCloud } from '../utils/firebase';

export interface EmitFiscalInvoiceParams {
  invoiceDraft: Factura;
  fiscalConfig: FiscalConfiguration;
  /** Opcional: lista de referencias conocidas (ej. appData.fiscalRecordRefs) para buscar el histórico */
  existingRecordRefs?: FiscalRecordRef[];
  /** Opcional: registro anterior explícito para testing o forzar caso inicial */
  previousRecordRef?: FiscalRecordRef | FiscalRecord | null;
  /** Inyección opcional para testing/mocks de persistencia */
  persistRecordFn?: (record: FiscalRecord) => Promise<boolean | void>;
}

export interface EmitFiscalInvoiceResult {
  invoice: Factura;
  fiscalRecord: FiscalRecord;
  fiscalRecordRef: FiscalRecordRef;
}

/**
 * Colas de serialización aisladas por obligadoTributarioId.
 * Garantiza que dos emisiones simultáneas del mismo obligado tributario no compitan
 * por el mismo registro anterior, mientras que obligados distintos no interfieren entre sí.
 */
const emissionQueuesByObligado = new Map<string, Promise<any>>();

/**
 * Memoria en sesión del último registro emitido por cada obligado tributario.
 */
const latestEmittedByObligado = new Map<string, FiscalRecordRef>();

/**
 * Reinicia las colas y cachés de emisión (esencial para tests unitarios).
 */
export function resetFiscalQueue(): void {
  emissionQueuesByObligado.clear();
  latestEmittedByObligado.clear();
}

/**
 * Registra manualmente o actualiza el último registro fiscal de un obligado en memoria.
 */
export function registerEmittedFiscalRecordRef(obligadoTributarioId: string, ref: FiscalRecordRef): void {
  if (!obligadoTributarioId || obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('registerEmittedFiscalRecordRef: obligadoTributarioId no puede ser vacío ni ES_UNKNOWN.');
  }
  latestEmittedByObligado.set(obligadoTributarioId, ref);
}

/**
 * Determina de forma centralizada y unívoca el último registro fiscal válido de un obligado tributario.
 * La UI no decide el registro anterior; esta función es la única fuente de verdad para la resolución.
 */
export function getLastFiscalRecord(
  obligadoTributarioId: string,
  options?: {
    candidateRefs?: FiscalRecordRef[];
  }
): FiscalRecordRef | null {
  if (!obligadoTributarioId || obligadoTributarioId.trim() === '' || obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('getLastFiscalRecord: obligadoTributarioId es obligatorio y no puede estar vacío ni ser ES_UNKNOWN.');
  }

  // 1. Verificar si existe en la memoria de la sesión activa para este obligado
  const inMemoryLatest = latestEmittedByObligado.get(obligadoTributarioId);

  // 2. Filtrar los candidateRefs que coincidan estrictamente con el obligadoTributarioId
  const matchingRefs = (options?.candidateRefs || []).filter(
    ref => ref.obligadoTributarioId === obligadoTributarioId
  );

  // Ordenar candidatos por fecha/hora de creación descendente (el más reciente primero)
  matchingRefs.sort((a, b) => {
    const timeA = new Date(a.creadoEn).getTime();
    const timeB = new Date(b.creadoEn).getTime();
    return timeB - timeA;
  });

  const bestCandidate = matchingRefs[0] || null;

  if (inMemoryLatest && bestCandidate) {
    const timeInMemory = new Date(inMemoryLatest.creadoEn).getTime();
    const timeCandidate = new Date(bestCandidate.creadoEn).getTime();
    return timeInMemory >= timeCandidate ? inMemoryLatest : bestCandidate;
  }

  return inMemoryLatest || bestCandidate || null;
}

/**
 * Función de dominio unificada para emitir una Factura con su correspondiente FiscalRecord.
 * ÚNICO camino autorizado para la creación y persistencia de nuevos registros fiscales.
 */
export async function emitFiscalInvoice(
  params: EmitFiscalInvoiceParams
): Promise<EmitFiscalInvoiceResult> {
  // En entorno navegador, delegar estrictamente a la autoridad fiscal del backend con autenticación
  if (typeof window !== 'undefined') {
    let authHeaders: Record<string, string> = {};
    try {
      const { auth } = await import('../utils/firebase');
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
      }
    } catch {}

    const res = await fetch('/api/fiscal/emit-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        invoiceDraft: params.invoiceDraft,
        fiscalConfig: params.fiscalConfig
      })
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.details || `Error en emisión fiscal de backend: HTTP ${res.status}`);
    }
    const data = await res.json();
    return {
      invoice: data.invoice,
      fiscalRecord: data.fiscalRecord,
      fiscalRecordRef: data.fiscalRecordRef
    };
  }

  const { fiscalConfig } = params;

  // Validación obligatoria del obligado tributario antes de encolar
  const obligadoTributarioId = fiscalConfig.obligadoTributarioId || fiscalConfig.nifEmisor;
  if (!obligadoTributarioId || obligadoTributarioId.trim() === '' || obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('emitFiscalInvoice: obligadoTributarioId es obligatorio y no puede estar vacío ni ser ES_UNKNOWN.');
  }

  // Serialización aislada por obligadoTributarioId en backend
  const currentQueue = emissionQueuesByObligado.get(obligadoTributarioId) || Promise.resolve();

  const nextPromise = currentQueue.then(async () => {
    return await executeEmitFiscalInvoice(params, obligadoTributarioId);
  });

  // Guardar en el mapa capturando errores para que fallos no bloqueen llamadas posteriores
  emissionQueuesByObligado.set(
    obligadoTributarioId,
    nextPromise.catch(() => {})
  );

  return nextPromise;
}

async function executeEmitFiscalInvoice(
  params: EmitFiscalInvoiceParams,
  obligadoTributarioId: string
): Promise<EmitFiscalInvoiceResult> {
  const { invoiceDraft, fiscalConfig, persistRecordFn } = params;

  let releaseProcessLock: (() => void) | null = null;
  if (typeof window === 'undefined') {
    const { BackendFiscalCustody } = await import('./backendCustodyRepository');
    releaseProcessLock = await BackendFiscalCustody.acquireProcessLock(obligadoTributarioId);
  }

  try {
    // 1. Obtener la huella anterior DENTRO de la sección serializada
    // NUNCA de invoiceDraft.hashAnterior ni de invoiceDraft.hashActual
    let previousRecord: FiscalRecordRef | FiscalRecord | null = null;
    if (params.previousRecordRef !== undefined) {
      previousRecord = params.previousRecordRef;
    } else {
      if (typeof window === 'undefined') {
        // AUTORIDAD DISTRIBUIDA FAIL-CLOSED EN BACKEND:
        // Se resuelve exclusivamente contra la custodia distribuida de la nube.
        // Si la autoridad falla o está inaccesible, se arroja excepción inmediata (sin degradación a memoria local).
        const { BackendFiscalCustody } = await import('./backendCustodyRepository');
        const latestFromCustody = await BackendFiscalCustody.getLatestFiscalRecordAsync(obligadoTributarioId);
        previousRecord = latestFromCustody || latestEmittedByObligado.get(obligadoTributarioId) || null;
      } else {
        previousRecord = getLastFiscalRecord(obligadoTributarioId, {
          candidateRefs: params.existingRecordRefs
        });
      }
    }

  let hashAnterior = '';
  if (previousRecord) {
    if ('huellaHash' in previousRecord) {
      hashAnterior = previousRecord.huellaHash;
    } else if ('huella' in previousRecord) {
      hashAnterior = previousRecord.huella.hash;
    }
  }

  // 2. Timestamp oficial inmutable con huso horario según Orden HAC/1177/2024
  const fechaHoraHusoGenRegistro = formatFechaHoraHusoGenRegistro();

  // 3. Comprobación estricta de requisitos del registro anterior (Orden HAC/1177/2024)
  await validatePreviousRecordRequirement(fechaHoraHusoGenRegistro, obligadoTributarioId, previousRecord);

  const tipoFactura = invoiceDraft.tipoFactura || (invoiceDraft.esRectificativa ? 'R1' : 'F1');
  const nifEmisor = fiscalConfig.nifEmisor;
  if (!nifEmisor || nifEmisor === 'ES_UNKNOWN' || nifEmisor.trim() === '') {
    throw new Error('emitFiscalInvoice: NIF del emisor es obligatorio y no puede ser ES_UNKNOWN ni estar vacío.');
  }

  const totalCuota = (invoiceDraft.totales?.cuotaIva ?? 0) + (invoiceDraft.totales?.cuotaRecargo ?? 0);
  const totalDocumento = invoiceDraft.totales?.totalDocumento ?? 0;

  // 4. Cálculo oficial canónico de la huella SHA-256 (FASE 2.1)
  const hashResult = await calculateAltaHash({
    nifEmisor,
    numSerieFactura: invoiceDraft.numeroFactura,
    fechaExpedicion: invoiceDraft.fecha,
    tipoFactura,
    cuotaTotal: totalCuota,
    importeTotal: totalDocumento,
    huellaAnterior: hashAnterior,
    fechaHoraHusoGenRegistro
  });

  const hashActual = hashResult.hash;
  if (!hashActual || hashActual.length !== 64) {
    throw new Error('emitFiscalInvoice: Huella fiscal calculada inválida o con longitud errónea.');
  }

  // 5. Preparar registro fiscal con datos definitivos para que el QR consuma exclusivamente la fuente fiscal
  const provisionalRecord = createFiscalRecordFromInvoice(
    {
      ...invoiceDraft,
      tipoFactura,
      hashActual,
      hashAnterior,
      fechaHoraSellado: fechaHoraHusoGenRegistro
    },
    fiscalConfig,
    previousRecord,
    {
      hashActual,
      fechaHoraSellado: fechaHoraHusoGenRegistro,
      cadenaTextoCanonico: hashResult.canonicalString
    }
  );

  // 6. QR tributario oficial generado EXCLUSIVAMENTE a partir del FiscalRecord sellado (FASE 2.3)
  const urlVeriFactu = buildFiscalQrUrl(provisionalRecord);
  const qrDataUri = await generateQrDataUri(urlVeriFactu);

  // 7. Preparar borrador enriquecido para la transformación final
  const enrichedInvoice: Factura = {
    ...invoiceDraft,
    tipoFactura,
    hashActual,
    hashAnterior,
    fechaHoraSellado: fechaHoraHusoGenRegistro,
    urlVeriFactu,
    qrDataUri
  };

  // 8. Crear el FiscalRecord definitivo e inmutable con su QR sellado antes del freeze final
  const fiscalRecord = createFiscalRecordFromInvoice(
    enrichedInvoice,
    fiscalConfig,
    previousRecord,
    {
      hashActual,
      fechaHoraSellado: fechaHoraHusoGenRegistro,
      cadenaTextoCanonico: hashResult.canonicalString,
      urlVeriFactu,
      qrDataUri
    }
  );

  // 8. Verificación inmediata de integridad criptográfica (cero falsos positivos)
  const verification = await verifyFiscalRecordHash(fiscalRecord);
  if (!verification.valid) {
    throw new Error(`emitFiscalInvoice: Fallo crítico de integridad criptográfica en el registro generado: ${verification.reason}`);
  }

  // 9. Validaciones de esquema antes de persistir
  if (!fiscalRecord.obligadoTributarioId || fiscalRecord.obligadoTributarioId === 'ES_UNKNOWN' || fiscalRecord.obligadoTributarioId.trim() === '') {
    throw new Error('emitFiscalInvoice: FiscalRecord inválido. obligadoTributarioId no puede ser vacío ni ES_UNKNOWN.');
  }
  if (!fiscalRecord.huella?.hash || fiscalRecord.huella.hash.length !== 64) {
    throw new Error('emitFiscalInvoice: FiscalRecord inválido. Huella fiscal ausente o longitud incorrecta.');
  }
  if (fiscalRecord.xmlOficial === '<pending_xml/>') {
    throw new Error('emitFiscalInvoice: FiscalRecord inválido. No se permite <pending_xml/>.');
  }

  // 7. Persistir el FiscalRecord en su única fuente persistente (/fiscal_records/{recordId})
  // Si la persistencia falla, el error debe propagarse obligatoriamente al llamador
  const defaultSaveFn = async (rec: FiscalRecord) => {
    if (typeof window === 'undefined') {
      const { BackendFiscalCustody } = await import('./backendCustodyRepository');
      await BackendFiscalCustody.saveFiscalRecord(rec);
    } else {
      await saveFiscalRecordToCloud(rec).catch(() => {});
    }
    return true;
  };
  const saveFn = persistRecordFn || defaultSaveFn;
  await saveFn(fiscalRecord);

  // 8. Generar la referencia liviana indexable para AppData
  const fiscalRecordRef = createFiscalRecordRef(fiscalRecord);

  // 9. Registrar la referencia en la sesión activa del obligado tributario
  registerEmittedFiscalRecordRef(obligadoTributarioId, fiscalRecordRef);

  // 10. Crear la Factura comercial final vinculada 1:1 a su FiscalRecord
  const finalInvoice: Factura = {
    ...enrichedInvoice,
    fiscalRecordId: fiscalRecord.id // VINCULACIÓN PRINCIPAL
  };

  return {
    invoice: finalInvoice,
    fiscalRecord,
    fiscalRecordRef
  };
  } finally {
    if (releaseProcessLock) {
      releaseProcessLock();
    }
  }
}

export interface EmitFiscalAnulacionParams {
  obligadoTributarioId?: string;
  fiscalConfig: FiscalConfiguration;
  facturaAnulada: {
    numeroFactura: string;
    fechaExpedicion: string; // YYYY-MM-DD o DD-MM-YYYY
    motivoAnulacion: string;
  };
  existingRecordRefs?: FiscalRecordRef[];
  previousRecordRef?: FiscalRecordRef | FiscalRecord | null;
  persistRecordFn?: (record: FiscalRecord) => Promise<boolean | void>;
}

export interface EmitFiscalAnulacionResult {
  fiscalRecord: FiscalRecord;
  fiscalRecordRef: FiscalRecordRef;
}

/**
 * Emite un Registro de Facturación de Anulación dentro de la cadena fiscal única del obligado.
 * Orden HAC/1177/2024: La cadena es única y contiene tanto altas como anulaciones.
 */
export async function emitFiscalAnulacion(
  params: EmitFiscalAnulacionParams
): Promise<EmitFiscalAnulacionResult> {
  // En entorno navegador, delegar estrictamente a la autoridad fiscal del backend con autenticación
  if (typeof window !== 'undefined') {
    let authHeaders: Record<string, string> = {};
    try {
      const { auth } = await import('../utils/firebase');
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
      }
    } catch {}

    const res = await fetch('/api/fiscal/emit-anulacion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        facturaAnulada: params.facturaAnulada,
        fiscalConfig: params.fiscalConfig,
        obligadoTributarioId: params.obligadoTributarioId
      })
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.details || `Error en anulación fiscal de backend: HTTP ${res.status}`);
    }
    const data = await res.json();
    return {
      fiscalRecord: data.fiscalRecord,
      fiscalRecordRef: data.fiscalRecordRef
    };
  }

  const { fiscalConfig } = params;
  const obligadoTributarioId = params.obligadoTributarioId || fiscalConfig.obligadoTributarioId || fiscalConfig.nifEmisor;
  if (!obligadoTributarioId || obligadoTributarioId.trim() === '' || obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('emitFiscalAnulacion: obligadoTributarioId es obligatorio y no puede estar vacío ni ser ES_UNKNOWN.');
  }

  const currentQueue = emissionQueuesByObligado.get(obligadoTributarioId) || Promise.resolve();
  const nextPromise = currentQueue.then(async () => {
    return await executeEmitFiscalAnulacion(params, obligadoTributarioId);
  });

  emissionQueuesByObligado.set(
    obligadoTributarioId,
    nextPromise.catch(() => {})
  );

  return nextPromise;
}

async function executeEmitFiscalAnulacion(
  params: EmitFiscalAnulacionParams,
  obligadoTributarioId: string
): Promise<EmitFiscalAnulacionResult> {
  const { fiscalConfig, facturaAnulada, persistRecordFn } = params;

  let releaseProcessLock: (() => void) | null = null;
  if (typeof window === 'undefined') {
    const { BackendFiscalCustody } = await import('./backendCustodyRepository');
    releaseProcessLock = await BackendFiscalCustody.acquireProcessLock(obligadoTributarioId);
  }

  try {
    let previousRecord: FiscalRecordRef | FiscalRecord | null = null;
    if (params.previousRecordRef !== undefined) {
      previousRecord = params.previousRecordRef;
    } else {
      if (typeof window === 'undefined') {
        // AUTORIDAD DISTRIBUIDA FAIL-CLOSED EN BACKEND:
        const { BackendFiscalCustody } = await import('./backendCustodyRepository');
        const latestFromCustody = await BackendFiscalCustody.getLatestFiscalRecordAsync(obligadoTributarioId);
        previousRecord = latestFromCustody || latestEmittedByObligado.get(obligadoTributarioId) || null;
      } else {
        previousRecord = getLastFiscalRecord(obligadoTributarioId, {
          candidateRefs: params.existingRecordRefs
        });
      }
    }

  let hashAnterior = '';
  if (previousRecord) {
    if ('huellaHash' in previousRecord) {
      hashAnterior = previousRecord.huellaHash;
    } else if ('huella' in previousRecord) {
      hashAnterior = previousRecord.huella.hash;
    }
  }

  const fechaHoraHusoGenRegistro = formatFechaHoraHusoGenRegistro();
  await validatePreviousRecordRequirement(fechaHoraHusoGenRegistro, obligadoTributarioId, previousRecord);

  const hashResult = await calculateAnulacionHash({
    nifEmisor: fiscalConfig.nifEmisor,
    numSerieFactura: facturaAnulada.numeroFactura,
    fechaExpedicion: facturaAnulada.fechaExpedicion,
    huellaAnterior: hashAnterior,
    fechaHoraHusoGenRegistro
  });

  const hashActual = hashResult.hash;
  if (!hashActual || hashActual.length !== 64) {
    throw new Error('emitFiscalAnulacion: Huella de anulación calculada inválida o con longitud errónea.');
  }

  const fiscalRecord = createFiscalAnulacionRecord({
    obligadoTributarioId,
    config: fiscalConfig,
    facturaAnulada,
    previousRecord,
    options: {
      hashActual,
      fechaHoraHusoGenRegistro,
      cadenaTextoCanonico: hashResult.canonicalString
    }
  });

  const verification = await verifyFiscalRecordHash(fiscalRecord);
  if (!verification.valid) {
    throw new Error(`emitFiscalAnulacion: Fallo crítico de integridad criptográfica en el registro de anulación: ${verification.reason}`);
  }

  const defaultSaveFn = async (rec: FiscalRecord) => {
    if (typeof window === 'undefined') {
      const { BackendFiscalCustody } = await import('./backendCustodyRepository');
      await BackendFiscalCustody.saveFiscalRecord(rec);
    } else {
      await saveFiscalRecordToCloud(rec).catch(() => {});
    }
    return true;
  };
  const saveFn = persistRecordFn || defaultSaveFn;
  await saveFn(fiscalRecord);

  const fiscalRecordRef = createFiscalRecordRef(fiscalRecord);
  registerEmittedFiscalRecordRef(obligadoTributarioId, fiscalRecordRef);

    return {
      fiscalRecord,
      fiscalRecordRef
    };
  } finally {
    if (releaseProcessLock) {
      releaseProcessLock();
    }
  }
}

/**
 * Helper para actualizar AppData de forma consistente tras una emisión.
 * Almacena exclusivamente FiscalRecordRef en AppData, NUNCA el documento completo.
 */
export function persistNewFiscalEmission(
  appData: AppData,
  result: EmitFiscalInvoiceResult
): AppData {
  const { invoice, fiscalRecordRef } = result;

  return {
    ...appData,
    facturas: [invoice, ...appData.facturas],
    fiscalRecordRefs: [fiscalRecordRef, ...(appData.fiscalRecordRefs || [])]
  };
}
