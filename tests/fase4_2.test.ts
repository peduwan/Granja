/**
 * SUITE DE TESTS EXHAUSTIVA — FASE 4.2:
 * IMPLEMENTACIÓN REAL DE BATCH VERI*FACTU 1–1000 + OUTBOX + CORRELACIÓN POR LÍNEA
 *
 * Normativa de referencia:
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 * - Esquemas oficiales AEAT: SuministroLR.xsd, SuministroInformacion.xsd, RespuestaSuministro.xsd
 */

import assert from 'node:assert';
import { Factura } from '../src/types';
import { FiscalRecord, FiscalConfiguration } from '../src/fiscal/types';
import {
  createDefaultFiscalConfiguration,
  createFiscalRecordFromInvoice
} from '../src/fiscal/modelTransformers';
import {
  emitFiscalInvoice,
  emitFiscalAnulacion,
  resetFiscalQueue
} from '../src/fiscal/emissionService';
import {
  createFiscalSubmission,
  createBatchFiscalSubmission,
  partitionRecordsIntoBatches,
  transitionSubmissionStatus,
  getRecordResultFromSubmission,
  resolveRecordOutboxState,
  resetFiscalOutbox,
  MAX_RECORDS_PER_AEAT_SUBMISSION
} from '../src/fiscal/submissionService';
import {
  parseAeatXmlResponse,
  correlateAeatResponseWithRecords
} from '../src/fiscal/aeatResponseParser';
import {
  executeAeatSubmission,
  AeatFlowControlManager,
  isRetryableSubmission,
  createRetrySubmission
} from '../src/fiscal/aeatTransport';
import {
  executeAuthoritativeOutboxSubmission,
  collectEligibleOutboxRecordsForObligado,
  FiscalSubmissionHttpError
} from '../src/fiscal/outboxBatchProcessor';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import { CloudDistributedChainCoordinator } from '../src/fiscal/cloudDistributedChainCoordinator';
import { validateAeatXmlAgainstXsd } from '../src/fiscal/aeatXsdValidatorNode';
import { verifyFiscalRecordHash } from '../src/fiscal/hashService';

const NIF_BATCH_OBLIGADO = 'B42424242';
const NOMBRE_BATCH_OBLIGADO = 'Granja Avícola Batch VeriFactu S.L.';

function createSampleInvoice(numFactura: string, overrides?: Partial<Factura>): Factura {
  return {
    id: `fac-${numFactura}-${Math.random().toString(36).slice(2, 6)}`,
    numeroFactura: numFactura,
    fecha: '2026-04-10',
    clienteId: 'cli-batch-01',
    clienteNombre: 'Distribuciones Huevos del Sur S.L.',
    clienteCif: 'B11223344',
    clienteDireccion: 'Polígono Industrial Sur Parcela 8, Sevilla',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-1',
        loteEnvasadoId: 'lote-1',
        codigoLoteEnvasado: 'ENV-2026-04',
        formatoId: 'fmt-L',
        nombreFormato: 'Estuche Docena Huevos L',
        cantidadEstuches: 50,
        precioUnitario: 2.0,
        subtotal: 100.0,
        fechaConsumoPreferente: '2026-05-10',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: 100.0,
      porcentajeIva: 4,
      cuotaIva: 4.0,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 104.0
    },
    formaPago: 'transferencia',
    estadoPago: 'pendiente',
    esVentaDirecta: true,
    creadoEn: '2026-04-10T10:00:00Z',
    ...overrides
  };
}

let passedTests = 0;

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message || err}`);
    throw err;
  }
}

function resetAllState(): void {
  BackendFiscalCustody.resetCustody();
  CloudDistributedChainCoordinator.resetCloudState();
  CloudDistributedChainCoordinator.setMode('simulator');
  resetFiscalQueue();
  resetFiscalOutbox();
  AeatFlowControlManager.reset();
}

async function emitAndCustodyBatch(
  count: number,
  config: FiscalConfiguration,
  prefix: string
): Promise<FiscalRecord[]> {
  const records: FiscalRecord[] = [];
  for (let i = 1; i <= count; i++) {
    const num = `${prefix}-${String(i).padStart(4, '0')}`;
    const inv = createSampleInvoice(num);
    const emitted = await emitFiscalInvoice({
      invoiceDraft: inv,
      fiscalConfig: config,
      persistRecordFn: async (rec) => {
        await BackendFiscalCustody.saveFiscalRecord(rec);
      }
    });
    records.push(emitted.fiscalRecord);
  }
  return records;
}

async function main() {
  console.log('================================================================');
  console.log('  SUITE DE TESTS FASE 4.2: BATCH VERI*FACTU 1–1000 + OUTBOX REAL');
  console.log('================================================================');

  resetAllState();

  const config = createDefaultFiscalConfiguration({
    nif: NIF_BATCH_OBLIGADO,
    nombreRazon: NOMBRE_BATCH_OBLIGADO
  });

  // ===========================================================================
  // BLOQUE 1: MODELO DE BATCH FISCALSUBMISSION Y PARTICIONAMIENTO (1..1000)
  // ===========================================================================
  console.log('\n--- BLOQUE 1: MODELO DE BATCH (1..1000 REGISTROS) Y VALIDACIÓN XSD ---');

  await runTest('1.1: createBatchFiscalSubmission genera un único XML SOAP/SuministroLR válido con múltiples registros (Alta + Anulación)', async () => {
    resetAllState();
    const emittedAltas = await emitAndCustodyBatch(3, config, 'FAC-B1');
    const anulacionRes = await emitFiscalAnulacion({
      facturaAnulada: {
        numeroFactura: emittedAltas[0].factura.numeroFactura,
        fechaExpedicion: emittedAltas[0].factura.fechaExpedicion,
        motivoAnulacion: 'Error en datos de cliente'
      },
      fiscalConfig: config,
      obligadoTributarioId: NIF_BATCH_OBLIGADO,
      persistRecordFn: async (rec) => {
        await BackendFiscalCustody.saveFiscalRecord(rec);
      }
    });

    const batchRecords = [...emittedAltas, anulacionRes.fiscalRecord];
    const batchSub = createBatchFiscalSubmission(batchRecords, config);

    assert.strictEqual(batchSub.esBatch, true);
    assert.strictEqual(batchSub.cantidadRegistros, 4);
    assert.deepStrictEqual(batchSub.fiscalRecordIds, batchRecords.map(r => r.id));
    assert.strictEqual(batchSub.resultadosIndividuales?.length, 4);
    assert.strictEqual(batchSub.resultadosIndividuales?.[3].tipoRegistro, 'anulacion');

    // Validar el XML del lote contra el XSD oficial de la AEAT (SuministroLR.xsd)
    const xsdValidation = validateAeatXmlAgainstXsd(batchSub.xmlEnviado);
    assert.strictEqual(
      xsdValidation.valid,
      true,
      `El XML del lote de 4 registros (3 altas + 1 anulación) debe ser 100% válido frente a SuministroLR.xsd. Errores: ${xsdValidation.errors.join('; ')}`
    );
  });

  await runTest('1.2: Validación estricta de límites normativos AEAT: rechaza 0 y 1001 registros, acepta exactamente 1000 registros validados contra XSD', async () => {
    // 0 registros -> error
    assert.throws(() => {
      createBatchFiscalSubmission([], config);
    }, /al menos un FiscalRecord válido/);

    // Generar 1000 registros en memoria para validar la capacidad máxima de 1000 por petición SOAP
    const thousandRecords: FiscalRecord[] = [];
    for (let i = 1; i <= MAX_RECORDS_PER_AEAT_SUBMISSION; i++) {
      const inv = createSampleInvoice(`FAC-1000-${String(i).padStart(4, '0')}`);
      const prev = i > 1 ? thousandRecords[i - 2] : null;
      const rec = createFiscalRecordFromInvoice(inv, config, prev, {
        hashActual: String(i).padStart(64, 'A'),
        fechaHoraSellado: '2026-04-10T10:00:00+02:00'
      });
      thousandRecords.push({
        ...rec,
        id: `frec-1000-${i}`
      });
    }

    const sub1000 = createBatchFiscalSubmission(thousandRecords, config);
    assert.strictEqual(sub1000.cantidadRegistros, 1000);
    assert.strictEqual(sub1000.esBatch, true);
    assert.strictEqual(sub1000.fiscalRecordIds?.length, 1000);
    assert.strictEqual(sub1000.resultadosIndividuales?.length, 1000);

    // Validar el lote de 1.000 registros contra el XSD oficial real en backend
    const xsd1000 = validateAeatXmlAgainstXsd(sub1000.xmlEnviado);
    assert.strictEqual(
      xsd1000.valid,
      true,
      `El lote máximo de 1.000 registros debe validar contra SuministroLR.xsd: ${xsd1000.errors.join('; ')}`
    );

    // 1001 registros -> error normativo
    const extraRecord = {
      ...thousandRecords[0],
      id: 'frec-1001-overflow'
    };
    assert.throws(() => {
      createBatchFiscalSubmission([...thousandRecords, extraRecord], config);
    }, /excede el límite máximo normativo AEAT de 1000 registros/);
  });

  await runTest('1.3: Prohibición de mezclar obligados tributarios o duplicar registros en un mismo batch', () => {
    const recA = createFiscalRecordFromInvoice(
      createSampleInvoice('FAC-OT-A'),
      config,
      null,
      { hashActual: '1'.repeat(64), fechaHoraSellado: '2026-04-10T10:00:00+02:00' }
    );
    const configB = createDefaultFiscalConfiguration({
      nif: 'B98765432',
      nombreRazon: 'Otra Empresa S.L.'
    });
    const recB = createFiscalRecordFromInvoice(
      createSampleInvoice('FAC-OT-B'),
      configB,
      null,
      { hashActual: '2'.repeat(64), fechaHoraSellado: '2026-04-10T10:00:00+02:00' }
    );

    // Mezcla de obligados
    assert.throws(() => {
      createBatchFiscalSubmission([recA, recB], config);
    }, /Prohibido mezclar distintos obligados tributarios/);

    // Registro duplicado
    assert.throws(() => {
      createBatchFiscalSubmission([recA, recA], config);
    }, /Registro duplicado/);
  });

  await runTest('1.4: partitionRecordsIntoBatches divide listas grandes en lotes de hasta 1.000 preservando orden y separando obligados', () => {
    const baseRec = createFiscalRecordFromInvoice(
      createSampleInvoice('FAC-PART-1'),
      config,
      null,
      { hashActual: '3'.repeat(64), fechaHoraSellado: '2026-04-10T10:00:00+02:00' }
    );

    const list2350: FiscalRecord[] = [];
    for (let i = 1; i <= 2350; i++) {
      list2350.push({
        ...baseRec,
        id: `rec-part-${i}`
      });
    }

    const batches = partitionRecordsIntoBatches(list2350, 1000);
    assert.strictEqual(batches.length, 3);
    assert.strictEqual(batches[0].length, 1000);
    assert.strictEqual(batches[1].length, 1000);
    assert.strictEqual(batches[2].length, 350);
    assert.strictEqual(batches[0][0].id, 'rec-part-1');
    assert.strictEqual(batches[1][0].id, 'rec-part-1001');
    assert.strictEqual(batches[2][349].id, 'rec-part-2350');
  });

  // ===========================================================================
  // BLOQUE 2: PARSER DE RESPUESTA AEAT Y CORRELACIÓN INDIVIDUAL POR REGISTRO
  // ===========================================================================
  console.log('\n--- BLOQUE 2: PARSER DE RESPUESTA AEAT Y CORRELACIÓN POR LÍNEA ---');

  await runTest('2.1: Correlación individual en respuesta ParcialmenteCorrecto con mezcla de Correcto, AceptadoConErrores e Incorrecto', async () => {
    resetAllState();
    const records = await emitAndCustodyBatch(3, config, 'FAC-CORR');

    const sampleXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion
      xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd"
      xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>CSV-BATCH-MIX-2026</sfR:CSV>
      <sfR:TiempoEsperaEnvio>90</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${NIF_BATCH_OBLIGADO}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-CORR-0001</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>10-04-2026</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>
          <sf:TipoOperacion>Alta</sf:TipoOperacion>
        </sfR:Operacion>
        <sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>
      </sfR:RespuestaLinea>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${NIF_BATCH_OBLIGADO}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-CORR-0002</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>10-04-2026</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>
          <sf:TipoOperacion>Alta</sf:TipoOperacion>
        </sfR:Operacion>
        <sfR:EstadoRegistro>AceptadoConErrores</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>1101</sfR:CodigoErrorRegistro>
        <sfR:DescripcionErrorRegistro>Aviso en identificación del destinatario</sfR:DescripcionErrorRegistro>
      </sfR:RespuestaLinea>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${NIF_BATCH_OBLIGADO}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-CORR-0003</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>10-04-2026</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>
          <sf:TipoOperacion>Alta</sf:TipoOperacion>
        </sfR:Operacion>
        <sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>3000</sfR:CodigoErrorRegistro>
        <sfR:DescripcionErrorRegistro>Registro de facturación duplicado</sfR:DescripcionErrorRegistro>
        <sfR:RegistroDuplicado>
          <sf:IdPeticionRegistroDuplicado>PET-DUP-999</sf:IdPeticionRegistroDuplicado>
          <sf:EstadoRegistroDuplicado>Correcta</sf:EstadoRegistroDuplicado>
        </sfR:RegistroDuplicado>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

    const parsed = parseAeatXmlResponse(sampleXmlResponse);
    assert.strictEqual(parsed.estadoEnvio, 'ParcialmenteCorrecto');
    assert.strictEqual(parsed.mappedSubmissionStatus, 'PARTIALLY_ACCEPTED');
    assert.strictEqual(parsed.tiempoEsperaEnvio, 90);
    assert.strictEqual(parsed.lineas.length, 3);

    const correlated = correlateAeatResponseWithRecords(parsed, records);
    assert.strictEqual(correlated.length, 3);

    // Registro 1: ACCEPTED
    assert.strictEqual(correlated[0].fiscalRecordId, records[0].id);
    assert.strictEqual(correlated[0].estado, 'ACCEPTED');
    assert.strictEqual(correlated[0].csv, 'CSV-BATCH-MIX-2026');
    assert.strictEqual(correlated[0].requiereSubsanacion, false);
    assert.strictEqual(correlated[0].esReintentable, false);

    // Registro 2: ACCEPTED_WITH_ERRORS
    assert.strictEqual(correlated[1].fiscalRecordId, records[1].id);
    assert.strictEqual(correlated[1].estado, 'ACCEPTED_WITH_ERRORS');
    assert.strictEqual(correlated[1].codigoErrorRegistro, '1101');
    assert.strictEqual(correlated[1].csv, 'CSV-BATCH-MIX-2026');
    assert.strictEqual(correlated[1].requiereSubsanacion, false);

    // Registro 3: REJECTED con RegistroDuplicado
    assert.strictEqual(correlated[2].fiscalRecordId, records[2].id);
    assert.strictEqual(correlated[2].estado, 'REJECTED');
    assert.strictEqual(correlated[2].codigoErrorRegistro, '3000');
    assert.strictEqual(correlated[2].csv, undefined);
    assert.strictEqual(correlated[2].requiereSubsanacion, true);
    assert.strictEqual(correlated[2].esReintentable, false);
    assert.strictEqual(correlated[2].registroDuplicado?.idPeticionRegistroDuplicado, 'PET-DUP-999');
  });

  // ===========================================================================
  // BLOQUE 3: FLUJO PRODUCTIVO COMPLETO DE LOTE + OUTBOX + IDEMPOTENCIA POR LÍNEA
  // ===========================================================================
  console.log('\n--- BLOQUE 3: EJECUCIÓN PRODUCTIVA DE LOTES, OUTBOX E INMUTABILIDAD ---');

  await runTest('3.1: Remisión productiva de un lote de 8 FiscalRecords en una única petición SOAP actualiza todos los registros y preserva su inmutabilidad', async () => {
    resetAllState();
    const records = await emitAndCustodyBatch(8, config, 'FAC-LOT8');
    const snapshotsBefore = records.map(r => JSON.stringify(r));

    const result = await executeAuthoritativeOutboxSubmission({
      fiscalRecordIds: records.map(r => r.id),
      internalTestOptions: {
        mockScenario: 'ACCEPTANCE',
        mockTiempoEsperaEnvio: 75
      }
    });

    assert.strictEqual(result.esBatch, true);
    assert.strictEqual(result.cantidadRegistros, 8);
    assert.strictEqual(result.submission?.estado, 'ACCEPTED');
    assert.strictEqual(result.submission?.cantidadRegistros, 8);
    assert.strictEqual(result.resultadosIndividuales?.length, 8);

    // Verificar que cada registro individual del lote figura como ACCEPTED en la custodia del Outbox
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const subsForRec = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(rec.id);
      assert.strictEqual(subsForRec.length, 1, `El registro ${rec.id} debe estar vinculado a la FiscalSubmission del lote`);
      const state = resolveRecordOutboxState(rec.id, subsForRec);
      assert.strictEqual(state.isAccepted, true);
      assert.strictEqual(state.status, 'ACCEPTED');
      assert.strictEqual(state.latestRecordResult?.csv, 'CSV-AEAT-1234567890ABCDEF');

      // Inmutabilidad estricta del FiscalRecord
      const storedAfter = await BackendFiscalCustody.getFiscalRecordByIdAsync(rec.id);
      assert.strictEqual(JSON.stringify(storedAfter), snapshotsBefore[i], 'El FiscalRecord no debe sufrir ninguna mutación tras el envío por lote');
      const integrity = await verifyFiscalRecordHash(storedAfter!);
      assert.strictEqual(integrity.valid, true);
    }

    // Verificar que TiempoEsperaEnvio (75s) quedó actualizado para el obligado
    const flowState = await AeatFlowControlManager.getFlowStateAsync(NIF_BATCH_OBLIGADO);
    assert.strictEqual(flowState?.tiempoEsperaEnvioSegundos, 75);
  });

  await runTest('3.2: Lote PARTIALLY_ACCEPTED actualiza individualmente aceptados vs rechazados y gobierna reintentos e idempotencia', async () => {
    resetAllState();
    const records = await emitAndCustodyBatch(4, config, 'FAC-PARTIAL');
    // Definir comportamiento por línea:
    // rec[0]: Correcto
    // rec[1]: AceptadoConErrores (código 1101)
    // rec[2]: Incorrecto (código 1104 - rechazo funcional)
    // rec[3]: Correcto
    const res = await executeAuthoritativeOutboxSubmission({
      fiscalRecordIds: records.map(r => r.id),
      internalTestOptions: {
        mockScenario: 'PARTIAL_ACCEPTANCE',
        mockTiempoEsperaEnvio: 0,
        mockLineOverrides: {
          [records[0].id]: { estadoRegistro: 'Correcto' },
          [records[1].id]: {
            estadoRegistro: 'AceptadoConErrores',
            codigoError: '1101',
            descripcionError: 'NIF destinatario con advertencia'
          },
          [records[2].id]: {
            estadoRegistro: 'Incorrecto',
            codigoError: '1104',
            descripcionError: 'Error funcional en línea 3'
          },
          [records[3].id]: { estadoRegistro: 'Correcto' }
        }
      }
    });

    assert.strictEqual(res.submission?.estado, 'PARTIALLY_ACCEPTED');
    assert.strictEqual(res.fiscalEvent?.tipo, 'ENVIO_AEAT_PARCIALMENTE_ACEPTADO');
    assert.strictEqual(isRetryableSubmission(res.submission!), false, 'Un lote PARTIALLY_ACCEPTED no debe reenviarse ciegamente como lote íntegro');

    // Verificar estados individuales en el Outbox
    const st0 = resolveRecordOutboxState(records[0].id, await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(records[0].id));
    const st1 = resolveRecordOutboxState(records[1].id, await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(records[1].id));
    const st2 = resolveRecordOutboxState(records[2].id, await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(records[2].id));
    const st3 = resolveRecordOutboxState(records[3].id, await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(records[3].id));

    assert.strictEqual(st0.status, 'ACCEPTED');
    assert.strictEqual(st0.isAccepted, true);

    assert.strictEqual(st1.status, 'ACCEPTED_WITH_ERRORS');
    assert.strictEqual(st1.isAccepted, true);

    assert.strictEqual(st2.status, 'REJECTED');
    assert.strictEqual(st2.isRejected, true);
    assert.strictEqual(st2.latestRecordResult?.requiereSubsanacion, true);

    assert.strictEqual(st3.status, 'ACCEPTED');
    assert.strictEqual(st3.isAccepted, true);

    // 1. Si se solicita enviar individualmente records[0] (que fue aceptado dentro del lote parcial),
    // devuelve idempotentReplay=true sin volver a llamar a AEAT
    const replay0 = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId: records[0].id
    });
    assert.strictEqual(replay0.idempotentReplay, true);
    assert.strictEqual(replay0.recordResult?.estado, 'ACCEPTED');

    // 2. Si se intenta enviar un nuevo lote mezclando records[0] (ya aceptado) con una nueva factura,
    // se bloquea con 409 ALREADY_ACCEPTED_RECORDS_IN_BATCH
    const newIssued = await emitAndCustodyBatch(1, config, 'FAC-NEW5');
    await assert.rejects(
      async () => {
        await executeAuthoritativeOutboxSubmission({
          fiscalRecordIds: [records[0].id, newIssued[0].id]
        });
      },
      (err: any) => err instanceof FiscalSubmissionHttpError && err.statusCode === 409 && err.code === 'ALREADY_ACCEPTED_RECORDS_IN_BATCH'
    );

    // 3. Si se intenta reenviar ciegamente records[2] (rechazado funcionalmente en el lote parcial),
    // se bloquea con 409 REJECTED_REQUIRES_SUBSANACION
    await assert.rejects(
      async () => {
        await executeAuthoritativeOutboxSubmission({
          fiscalRecordId: records[2].id
        });
      },
      (err: any) => err instanceof FiscalSubmissionHttpError && err.statusCode === 409 && err.code === 'REJECTED_REQUIRES_SUBSANACION'
    );
  });

  await runTest('3.3: Fallo técnico (HTTP_500 / TIMEOUT) en lote marca todos los registros como FAILED_TECHNICAL y permite su reintento', async () => {
    resetAllState();
    const records = await emitAndCustodyBatch(3, config, 'FAC-RETRY');

    // Intento 1: Fallo técnico HTTP 500
    const attempt1 = await executeAuthoritativeOutboxSubmission({
      fiscalRecordIds: records.map(r => r.id),
      internalTestOptions: {
        mockScenario: 'HTTP_500',
        mockTiempoEsperaEnvio: 0
      }
    });

    assert.strictEqual(attempt1.isTechnicalError, true);
    assert.strictEqual(attempt1.submission?.estado, 'FAILED_TECHNICAL');
    assert.strictEqual(attempt1.submission?.numeroIntento, 1);
    for (const r of records) {
      const resItem = getRecordResultFromSubmission(attempt1.submission!, r.id);
      assert.strictEqual(resItem?.estado, 'FAILED_TECHNICAL');
      assert.strictEqual(resItem?.esReintentable, true);
    }

    // Intento 2: Reintento del lote con éxito (ACCEPTANCE)
    const attempt2 = await executeAuthoritativeOutboxSubmission({
      fiscalRecordIds: records.map(r => r.id),
      internalTestOptions: {
        mockScenario: 'ACCEPTANCE',
        mockTiempoEsperaEnvio: 0
      }
    });

    assert.strictEqual(attempt2.isTechnicalError, false);
    assert.strictEqual(attempt2.submission?.estado, 'ACCEPTED');
    assert.strictEqual(attempt2.submission?.numeroIntento, 2);
    for (const r of records) {
      const subs = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(r.id);
      assert.strictEqual(subs.length, 2, 'Deben constar los 2 intentos en el historial del Outbox');
      const finalState = resolveRecordOutboxState(r.id, subs);
      assert.strictEqual(finalState.isAccepted, true);
      assert.strictEqual(finalState.status, 'ACCEPTED');
    }
  });

  // ===========================================================================
  // BLOQUE 4: DRENADO AUTOMÁTICO DE OUTBOX + CONTROL DE FLUJO + CONCURRENCIA
  // ===========================================================================
  console.log('\n--- BLOQUE 4: OUTBOX BATCH AUTOMÁTICO, TIEMPOESPERAENVIO Y LOCKS ---');

  await runTest('4.1: batchFromOutbox selecciona automáticamente los registros pendientes/reintentables en orden y respeta TiempoEsperaEnvio entre lotes', async () => {
    resetAllState();
    const records = await emitAndCustodyBatch(5, config, 'FAC-OUTBOX');

    // Drenar primeros 3 registros desde el Outbox (maxBatchSize = 3), simulando TiempoEsperaEnvio = 120s
    const batch1 = await executeAuthoritativeOutboxSubmission({
      batchFromOutbox: true,
      obligadoTributarioId: NIF_BATCH_OBLIGADO,
      maxBatchSize: 3,
      internalTestOptions: {
        mockScenario: 'ACCEPTANCE',
        mockTiempoEsperaEnvio: 120
      }
    });

    assert.strictEqual(batch1.cantidadRegistros, 3);
    assert.deepStrictEqual(batch1.submission?.fiscalRecordIds, [records[0].id, records[1].id, records[2].id]);
    assert.strictEqual(batch1.submission?.estado, 'ACCEPTED');

    // Verificar que en el Outbox quedan exactamente 2 registros pendientes (records[3] y records[4])
    const { eligibleRecords } = await collectEligibleOutboxRecordsForObligado(NIF_BATCH_OBLIGADO, 1000);
    assert.strictEqual(eligibleRecords.length, 2);
    assert.deepStrictEqual(eligibleRecords.map(r => r.id), [records[3].id, records[4].id]);

    // Si intentamos enviar el segundo lote inmediatamente mientras TiempoEsperaEnvio (120s) está activo,
    // el control de flujo AEAT lo bloquea con HTTP 429 (FLOW_CONTROL_WAIT_ACTIVE)
    await assert.rejects(
      async () => {
        await executeAuthoritativeOutboxSubmission({
          batchFromOutbox: true,
          obligadoTributarioId: NIF_BATCH_OBLIGADO,
          maxBatchSize: 3
        });
      },
      (err: any) => err instanceof FiscalSubmissionHttpError && err.statusCode === 429 && err.code === 'FLOW_CONTROL_WAIT_ACTIVE'
    );

    // Una vez transcurrida la ventana de espera (simulando expiración de ventana), el segundo lote envía los 2 restantes
    await AeatFlowControlManager.updateFromResponseAsync(NIF_BATCH_OBLIGADO, 0, Date.now() - 1000);

    const batch2 = await executeAuthoritativeOutboxSubmission({
      batchFromOutbox: true,
      obligadoTributarioId: NIF_BATCH_OBLIGADO,
      maxBatchSize: 3,
      internalTestOptions: {
        mockScenario: 'ACCEPTANCE',
        mockTiempoEsperaEnvio: 0
      }
    });

    assert.strictEqual(batch2.cantidadRegistros, 2);
    assert.deepStrictEqual(batch2.submission?.fiscalRecordIds, [records[3].id, records[4].id]);
    assert.strictEqual(batch2.submission?.estado, 'ACCEPTED');

    // Una tercera llamada con el Outbox ya vacío retorna emptyOutbox: true
    const batch3 = await executeAuthoritativeOutboxSubmission({
      batchFromOutbox: true,
      obligadoTributarioId: NIF_BATCH_OBLIGADO
    });
    assert.strictEqual(batch3.emptyOutbox, true);
    assert.strictEqual(batch3.cantidadRegistros, 0);
  });

  await runTest('4.2: Cerrojo distribuido bloquea con 409 (CONCURRENT_SEND_LOCKED) un envío de lote si ya existe otro envío en curso para el obligado', async () => {
    resetAllState();
    const records = await emitAndCustodyBatch(2, config, 'FAC-LOCK-BATCH');

    // Simular que otra instancia posee el cerrojo distribuido de envío para NIF_BATCH_OBLIGADO
    await AeatFlowControlManager.acquireSendLockAsync(NIF_BATCH_OBLIGADO, 'external-instance-owner');

    try {
      await assert.rejects(
        async () => {
          await executeAuthoritativeOutboxSubmission({
            fiscalRecordIds: records.map(r => r.id)
          });
        },
        (err: any) => err instanceof FiscalSubmissionHttpError && err.statusCode === 409 && err.code === 'CONCURRENT_SEND_LOCKED'
      );
    } finally {
      await AeatFlowControlManager.releaseSendLockAsync(NIF_BATCH_OBLIGADO);
    }
  });

  resetAllState();

  console.log('\n================================================================');
  console.log(`  FASE 4.2 COMPLETADA CON ÉXITO: ${passedTests}/${passedTests} TESTS VERIFICADOS`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\nERROR FATAL EN SUITE FASE 4.2:', err);
  process.exit(1);
});
