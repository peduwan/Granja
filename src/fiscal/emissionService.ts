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
  createFiscalAnulacionRecord,
  resolveInvoiceTipoFactura
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

export interface EmitFiscalInvoiceParams {
  invoiceDraft: Factura;
  fiscalConfig: FiscalConfiguration;
  /** Opcional: lista de referencias conocidas (ej. appData.fiscalRecordRefs) para buscar el histórico */
  existingRecordRefs?: FiscalRecordRef[];
  /** Opcional: registro anterior explícito para testing o forzar caso inicial */
  previousRecordRef?: FiscalRecordRef | FiscalRecord | null;
  /** Inyección opcional para testing/mocks de persistencia */
  persistRecordFn?: (record: FiscalRecord) => Promise<boolean | void>;
  /** Hook opcional para tests de contienda OCC multi-instancia (simula dos instancias Cloud Run sin cola en memoria compartida) */
  _simulateIndependentCloudRunInstance?: boolean;
  /** Callback opcional invocado justo antes del commit OCC del intento indicado (para tests deterministas de carrera) */
  _onBeforeCommitAttempt?: (attempt: number, candidateRecord: FiscalRecord) => Promise<void>;
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

  if (params._simulateIndependentCloudRunInstance) {
    return await executeEmitFiscalInvoice(params, obligadoTributarioId);
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

function isRetryableDistributedConflictError(err: any): boolean {
  const msg = String(err?.message || '');
  return (
    msg.includes('Bifurcación de cadena detectada') ||
    msg.includes('Violación de encadenamiento') ||
    msg.includes('Colisión de numeración detectada') ||
    msg.includes('ABORTED') ||
    msg.includes('Transaction lock')
  );
}

function normalizeDateToIsoForComparison(dateStr?: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const mIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
  const mAeat = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (mAeat) return `${mAeat[3]}-${mAeat[2]}-${mAeat[1]}`;
  return trimmed;
}

async function executeEmitFiscalInvoice(
  params: EmitFiscalInvoiceParams,
  obligadoTributarioId: string
): Promise<EmitFiscalInvoiceResult> {
  const { invoiceDraft, fiscalConfig, persistRecordFn } = params;

  if (typeof window !== 'undefined') {
    throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: executeEmitFiscalInvoice está restringido exclusivamente al servidor backend.');
  }

  const { BackendFiscalCustody } = await import('./backendCustodyRepository');
  const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
  const releaseProcessLock = params._simulateIndependentCloudRunInstance
    ? null
    : await BackendFiscalCustody.acquireProcessLock(obligadoTributarioId);

  try {
    const tipoFactura = resolveInvoiceTipoFactura(invoiceDraft);
    const nifEmisor = fiscalConfig.nifEmisor;
    if (!nifEmisor || nifEmisor === 'ES_UNKNOWN' || nifEmisor.trim() === '') {
      throw new Error('emitFiscalInvoice: NIF del emisor es obligatorio y no puede ser ES_UNKNOWN ni estar vacío.');
    }

    const isRectificativa = Boolean(
      invoiceDraft.esRectificativa || ['R1', 'R2', 'R3', 'R4', 'R5'].includes(tipoFactura)
    );
    const isSubsanacion = invoiceDraft.subsanacion === 'S';

    // Reintento automático ante contienda OCC distribuida entre múltiples instancias Cloud Run
    const maxAttempts = params.previousRecordRef !== undefined ? 1 : 8;
    let lastConflictError: any = null;
    let reservedBackendNumber: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // 1. Obtener la huella anterior DENTRO de la sección serializada (y actualizada en cada intento OCC)
        // NUNCA de invoiceDraft.hashAnterior ni de invoiceDraft.hashActual
        let previousRecord: FiscalRecordRef | FiscalRecord | null = null;
        if (params.previousRecordRef !== undefined) {
          previousRecord = params.previousRecordRef;
        } else {
          // AUTORIDAD DISTRIBUIDA FAIL-CLOSED EN BACKEND:
          const latestFromCustody = await BackendFiscalCustody.getLatestFiscalRecordAsync(obligadoTributarioId);
          previousRecord = latestFromCustody || (attempt === 1 ? latestEmittedByObligado.get(obligadoTributarioId) : null) || null;
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

        // 3.5 Autoridad backend para facturas rectificativas: validación cruzada contra custodia y reserva atómica de serie R-YYYY-NNN
        let effectiveInvoiceDraft: Factura = { ...invoiceDraft };
        if (isRectificativa) {
          const allObligadoRecords = await BackendFiscalCustody.getAllFiscalRecordsByObligadoAsync(obligadoTributarioId);

          const rectRefs =
            effectiveInvoiceDraft.facturasRectificadas && effectiveInvoiceDraft.facturasRectificadas.length > 0
              ? effectiveInvoiceDraft.facturasRectificadas.map(r => ({
                  idEmisorFactura: (r.idEmisorFactura || nifEmisor).trim(),
                  numSerieFactura: (r.numeroFactura || (r as any).numSerieFactura || '').trim(),
                  fechaExpedicionFactura: (r.fechaExpedicion || (r as any).fechaExpedicionFactura || '').trim()
                }))
              : effectiveInvoiceDraft.facturaRectificadaNumero && effectiveInvoiceDraft.facturaRectificadaFecha
              ? [
                  {
                    idEmisorFactura: nifEmisor,
                    numSerieFactura: effectiveInvoiceDraft.facturaRectificadaNumero.trim(),
                    fechaExpedicionFactura: effectiveInvoiceDraft.facturaRectificadaFecha.trim()
                  }
                ]
              : [];

          const originalOperationDatesIso: string[] = [];

          for (const ref of rectRefs) {
            const origRecord = allObligadoRecords.find(
              r => r.tipoRegistro === 'alta' && r.factura.numeroFactura === ref.numSerieFactura
            );
            if (origRecord) {
              // Verificar coherencia de la fecha de expedición referenciada con la fecha custodiada del registro original
              const origExpIso = normalizeDateToIsoForComparison(origRecord.factura.fechaExpedicion);
              const refExpIso = normalizeDateToIsoForComparison(ref.fechaExpedicionFactura);
              if (origExpIso && refExpIso && origExpIso !== refExpIso) {
                throw new Error(
                  `RECHAZO_RECTIFICATIVA_FECHA_INCONSISTENTE: La fecha de expedición indicada (${ref.fechaExpedicionFactura}) para la factura rectificada '${ref.numSerieFactura}' no coincide con la fecha custodiada en el libro registro (${origRecord.factura.fechaExpedicion}).`
                );
              }

              if (tipoFactura === 'R5' && origRecord.factura.tipoFactura !== 'F2' && origRecord.factura.tipoFactura !== 'R5') {
                throw new Error(
                  `RECHAZO_RECTIFICATIVA_R5_ORIGEN_NO_SIMPLIFICADA: No se puede emitir una factura rectificativa R5 sobre la factura custodiada '${origRecord.factura.numeroFactura}' de tipo '${origRecord.factura.tipoFactura}' (R5 solo rectifica facturas simplificadas F2/R5).`
                );
              }
              if (
                tipoFactura !== 'R5' &&
                (origRecord.factura.tipoFactura === 'F2' || origRecord.factura.tipoFactura === 'R5') &&
                !origRecord.destinatario?.nif &&
                !origRecord.destinatario?.idOtro
              ) {
                throw new Error(
                  `RECHAZO_RECTIFICATIVA_SIMPLIFICADA_REQUIERE_R5: La factura original custodiada '${origRecord.factura.numeroFactura}' es simplificada (${origRecord.factura.tipoFactura}) sin destinatario; debe rectificarse mediante clave R5.`
                );
              }

              const origFechaOpIso = normalizeDateToIsoForComparison(
                origRecord.factura.fechaOperacion || origRecord.factura.fechaExpedicion
              );
              if (origFechaOpIso) {
                originalOperationDatesIso.push(origFechaOpIso);
              }
            }
          }

          // Si el borrador no especifica fechaOperacion y las facturas originales están custodiadas,
          // asignar autoritativamente la fecha de operación original (la más reciente si rectifica varias)
          if (!effectiveInvoiceDraft.fechaOperacion && originalOperationDatesIso.length > 0) {
            originalOperationDatesIso.sort();
            effectiveInvoiceDraft = {
              ...effectiveInvoiceDraft,
              fechaOperacion: originalOperationDatesIso[originalOperationDatesIso.length - 1]
            };
          }

          if (!isSubsanacion) {
            const requestedNum = ( reservedBackendNumber || effectiveInvoiceDraft.numeroFactura || '').trim();
            const alreadyExistsInCustody = allObligadoRecords.some(
              r => r.tipoRegistro === 'alta' && r.factura.numeroFactura === requestedNum
            );
            const isStandardRectSeries = /^R-\d{4}-\d+$/i.test(requestedNum);
            const shouldAssignBackendNumber =
              !requestedNum ||
              requestedNum.toUpperCase() === 'AUTO' ||
              effectiveInvoiceDraft.numeracionAutoritativaBackend === true ||
              alreadyExistsInCustody ||
              (attempt > 1 && isStandardRectSeries);

            if (shouldAssignBackendNumber) {
              if (!reservedBackendNumber || alreadyExistsInCustody) {
                // Reserva atómica en transacción Firestore OCC / Cloud Coordinator
                let reservedNumber = await CloudDistributedChainCoordinator.reserveNextRectificativaNumber(
                  obligadoTributarioId,
                  effectiveInvoiceDraft.fecha
                );
                const custodyNextNumber = BackendFiscalCustody.computeNextRectificativaNumber(
                  allObligadoRecords,
                  effectiveInvoiceDraft.fecha
                );
                const parsedReserved = parseInt(reservedNumber.split('-')[2] || '0', 10);
                const parsedCustody = parseInt(custodyNextNumber.split('-')[2] || '0', 10);
                if (parsedCustody > parsedReserved) {
                  reservedNumber = custodyNextNumber;
                }
                reservedBackendNumber = reservedNumber;
              }

              effectiveInvoiceDraft = {
                ...effectiveInvoiceDraft,
                numeroFactura: reservedBackendNumber
              };
            }
          }
        }

        const totalCuota = (effectiveInvoiceDraft.totales?.cuotaIva ?? 0) + (effectiveInvoiceDraft.totales?.cuotaRecargo ?? 0);
        const totalDocumento = effectiveInvoiceDraft.totales?.totalDocumento ?? 0;

        // 4. Cálculo oficial canónico de la huella SHA-256 (FASE 2.1)
        const hashResult = await calculateAltaHash({
          nifEmisor,
          numSerieFactura: effectiveInvoiceDraft.numeroFactura,
          fechaExpedicion: effectiveInvoiceDraft.fecha,
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
            ...effectiveInvoiceDraft,
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
          ...effectiveInvoiceDraft,
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

        // 7. Persistir el FiscalRecord en la autoridad fiscal del backend (transacción OCC en Firestore)
        // Si la persistencia falla por contienda concurrente multi-instancia, el bucle OCC reintenta automáticamente
        if (params._onBeforeCommitAttempt) {
          await params._onBeforeCommitAttempt(attempt, fiscalRecord);
        }

        const defaultSaveFn = async (rec: FiscalRecord) => {
          await BackendFiscalCustody.saveFiscalRecord(rec);
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
      } catch (err: any) {
        if (attempt < maxAttempts && !persistRecordFn && isRetryableDistributedConflictError(err)) {
          if (String(err?.message || '').includes('Colisión de numeración detectada')) {
            reservedBackendNumber = null;
          }
          lastConflictError = err;
          await new Promise(resolve => setTimeout(resolve, 15 * attempt));
          continue;
        }
        throw err;
      }
    }

    throw lastConflictError || new Error('emitFiscalInvoice: Fallo tras agotar reintentos de concurrencia distribuida.');
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
    refExterna?: string;
    sinRegistroPrevio?: 'S' | 'N';
    rechazoPrevio?: 'S' | 'N';
    generadoPor?: 'E' | 'D' | 'T';
    generador?: {
      nombreRazon: string;
      nif?: string;
      codigoPais?: string;
      idOtro?: {
        codigoPais?: string;
        idType: '02' | '03' | '04' | '05' | '06' | '07';
        id: string;
      };
    };
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

  if (typeof window !== 'undefined') {
    throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: executeEmitFiscalAnulacion está restringido exclusivamente al servidor backend.');
  }

  const { BackendFiscalCustody } = await import('./backendCustodyRepository');
  const releaseProcessLock = await BackendFiscalCustody.acquireProcessLock(obligadoTributarioId);

  try {
    let previousRecord: FiscalRecordRef | FiscalRecord | null = null;
    if (params.previousRecordRef !== undefined) {
      previousRecord = params.previousRecordRef;
    } else {
      // AUTORIDAD DISTRIBUIDA FAIL-CLOSED EN BACKEND:
      const latestFromCustody = await BackendFiscalCustody.getLatestFiscalRecordAsync(obligadoTributarioId);
      previousRecord = latestFromCustody || latestEmittedByObligado.get(obligadoTributarioId) || null;
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
    await BackendFiscalCustody.saveFiscalRecord(rec);
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
