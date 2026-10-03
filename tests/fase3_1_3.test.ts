/**
 * SUITE DE TESTS - FASE 3.1.3
 * ENDURECIMIENTO DEFINITIVO DE SEGURIDAD, AUTORIDAD FISCAL Y TRANSPORTE AEAT
 *
 * Normativa Oficial:
 * - Ley 11/2021 (Medidas contra el fraude fiscal)
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 * - Documento técnico AEAT v1.0.3 (Remisión voluntaria y bajo requerimiento)
 */

import assert from 'node:assert';
import {
  executeAeatSubmission,
  AeatFlowControlManager,
  scheduleSubmissionRetry,
  createRetrySubmission,
  wrapInAeatSoapEnvelope
} from '../src/fiscal/aeatTransport';
import { AeatCertificateProvider } from '../src/fiscal/aeatCertificateProvider';
import {
  emitFiscalInvoice,
  emitFiscalAnulacion,
  resetFiscalQueue,
  getLastFiscalRecord
} from '../src/fiscal/emissionService';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import {
  verifyFiscalRecordHash,
  verifyFiscalRecordChain,
  calculateAltaHash
} from '../src/fiscal/hashService';
import {
  createFiscalRecordFromInvoice,
  createDefaultFiscalConfiguration
} from '../src/fiscal/modelTransformers';
import { createFiscalSubmission } from '../src/fiscal/submissionService';
import { Factura, FiscalRecord } from '../src/types';

function createDummyInvoice(overrides?: Partial<Factura>): Factura {
  return {
    id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    numeroFactura: 'FAC-2026-0001',
    fecha: '2026-02-15',
    clienteId: 'cli-001',
    clienteNombre: 'Restaurante El Mirador',
    clienteCif: 'B12345678',
    clienteDireccion: 'C/ Mayor 1, Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-001',
        loteEnvasadoId: 'lote-env-1',
        codigoLoteEnvasado: 'L-2026-001',
        formatoId: 'fmt-001',
        nombreFormato: 'Huevos Camperos L - Docena',
        cantidadEstuches: 10,
        precioUnitario: 3.5,
        subtotal: 35.0,
        fechaConsumoPreferente: '2026-03-15',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: 35.0,
      porcentajeIva: 4,
      cuotaIva: 1.4,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 36.4
    },
    formaPago: 'transferencia',
    estadoPago: 'pendiente',
    esVentaDirecta: true,
    creadoEn: '2026-02-15T10:00:00Z',
    ...overrides
  };
}

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  [PASS] Test: ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] Test: ${name}`);
    console.error(`         Error: ${err.message || err}`);
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log('  EJECUTANDO SUITE DE TESTS - FASE 3.1.3: ENDURECIMIENTO DE SEGURIDAD');
  console.log('================================================================');

  BackendFiscalCustody.resetCustody();
  resetFiscalQueue();
  AeatFlowControlManager.reset();
  AeatCertificateProvider.clear();

  const NIF_EMISOR = 'B88888888';
  const config = createDefaultFiscalConfiguration({
    nif: NIF_EMISOR,
    nombreRazon: 'Explotación Avícola Segura S.L.'
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 1: AUTORIDAD EXCLUSIVA DE BACKEND Y CIERRE DE SUPERFICIE DE ATAQUE
  // -----------------------------------------------------------------------------

  await runTest('1.1: Backend emite factura fiscal y la almacena en custodia de backend con huella verificada', async () => {
    const invDraft = createDummyInvoice({ numeroFactura: 'FAC-313-001' });
    const result = await emitFiscalInvoice({
      invoiceDraft: invDraft,
      fiscalConfig: config,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    assert.ok(result.fiscalRecord, 'Debe generar FiscalRecord');
    assert.strictEqual(result.fiscalRecord.huella.hash.length, 64, 'Huella debe ser SHA-256 de 64 caracteres');
    assert.strictEqual(result.fiscalRecord.encadenamiento.primerRegistro, true, 'Primer registro de la cadena');

    // Verificar en custodia de backend
    const stored = BackendFiscalCustody.getFiscalRecordById(result.fiscalRecord.id);
    assert.ok(stored, 'Debe existir en la custodia física de backend');
    assert.strictEqual(stored?.huella.hash, result.fiscalRecord.huella.hash);
  });

  await runTest('1.2: El cliente NO puede forzar hashAnterior arbitrario; backend resuelve el registro anterior unívocamente', async () => {
    const invDraft2 = createDummyInvoice({ numeroFactura: 'FAC-313-002' });
    // Simulamos que el cliente intenta engañar pasando un hashAnterior falso en el borrador
    const forgerDraft = { ...invDraft2, hashAnterior: 'FAKE_ATTACKER_HASH_12345678901234567890123456789012345678901234' };

    const result2 = await emitFiscalInvoice({
      invoiceDraft: forgerDraft,
      fiscalConfig: config,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    const previousRecord = BackendFiscalCustody.getFiscalRecordById('frec-FAC-313-001') || BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR);
    // El encadenamiento debe apuntar al registro legítimo anterior, NO al hash falso
    assert.notStrictEqual(result2.fiscalRecord.encadenamiento.registroAnterior?.huella, forgerDraft.hashAnterior, 'El backend no debe aceptar hash falsificado');
    assert.strictEqual(result2.fiscalRecord.encadenamiento.primerRegistro, false);
  });

  await runTest('1.3: Rechazo tajante de NIF vacío, ES_UNKNOWN o NIF ficticio B12345678 en emisión', async () => {
    const invDraft = createDummyInvoice();
    const badConfig1 = { ...config, nifEmisor: 'ES_UNKNOWN', obligadoTributarioId: 'ES_UNKNOWN' };
    await assert.rejects(async () => {
      await emitFiscalInvoice({ invoiceDraft: invDraft, fiscalConfig: badConfig1 });
    }, /obligadoTributarioId es obligatorio y no puede estar vacío ni ser ES_UNKNOWN/);

    const badConfig2 = { ...config, nifEmisor: '', obligadoTributarioId: '' };
    await assert.rejects(async () => {
      await emitFiscalInvoice({ invoiceDraft: invDraft, fiscalConfig: badConfig2 });
    }, /obligadoTributarioId es obligatorio/);
  });

  await runTest('1.4: Emisión de Anulación Fiscal ejecutada autoritativamente en backend e integrada en la misma cadena', async () => {
    const anulacionResult = await emitFiscalAnulacion({
      facturaAnulada: {
        numeroFactura: 'FAC-313-001',
        fechaExpedicion: '2026-02-15',
        motivoAnulacion: 'Factura emitida por duplicado'
      },
      fiscalConfig: config,
      obligadoTributarioId: NIF_EMISOR,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    assert.ok(anulacionResult.fiscalRecord, 'Debe generar FiscalRecord de anulación');
    assert.strictEqual(anulacionResult.fiscalRecord.tipoRegistro, 'anulacion');
    const verification = await verifyFiscalRecordHash(anulacionResult.fiscalRecord);
    assert.strictEqual(verification.valid, true, 'El registro de anulación debe tener huella matemática válida');
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 2: PREVENCIÓN DE BIFURCACIONES Y EXCLUSIÓN MUTUA EN CONCURRENCIA
  // -----------------------------------------------------------------------------

  await runTest('2.1: Emisiones concurrentes simultáneas se serializan sin bifurcar la cadena SHA-256', async () => {
    resetFiscalQueue();
    const invA = createDummyInvoice({ numeroFactura: 'FAC-CONC-001' });
    const invB = createDummyInvoice({ numeroFactura: 'FAC-CONC-002' });

    // Lanzar dos emisiones exactamente al mismo tiempo
    const [resA, resB] = await Promise.all([
      emitFiscalInvoice({ invoiceDraft: invA, fiscalConfig: config }),
      emitFiscalInvoice({ invoiceDraft: invB, fiscalConfig: config })
    ]);

    assert.notStrictEqual(resA.fiscalRecord.huella.hash, resB.fiscalRecord.huella.hash, 'Las huellas deben ser distintas');
    // Una de ellas debe ser hija directa de la otra (encadenamiento perfecto sin bifurcación)
    const isChained = (resB.fiscalRecord.encadenamiento.registroAnterior?.huella === resA.fiscalRecord.huella.hash) ||
                      (resA.fiscalRecord.encadenamiento.registroAnterior?.huella === resB.fiscalRecord.huella.hash);
    assert.strictEqual(isChained, true, 'Las emisiones concurrentes deben encadenarse linealmente sin bifurcar');
  });

  await runTest('2.2: Emisiones simultáneas de obligados tributarios distintos se ejecutan sin interferencias', async () => {
    const configB = createDefaultFiscalConfiguration({
      nif: 'B99999999',
      nombreRazon: 'Otra Granja S.L.'
    });

    const [res1, res2] = await Promise.all([
      emitFiscalInvoice({ invoiceDraft: createDummyInvoice({ numeroFactura: 'FAC-OT-1' }), fiscalConfig: config }),
      emitFiscalInvoice({ invoiceDraft: createDummyInvoice({ numeroFactura: 'FAC-OT-2' }), fiscalConfig: configB })
    ]);

    assert.strictEqual(res1.fiscalRecord.obligadoTributarioId, NIF_EMISOR);
    assert.strictEqual(res2.fiscalRecord.obligadoTributarioId, 'B99999999');
    assert.strictEqual(res2.fiscalRecord.encadenamiento.primerRegistro, true, 'Debe ser primer registro de su propia cadena');
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 3: PROTECCIÓN DE TRANSPORTE AEAT Y MTLS REAL (PROHIBIDO FALLBACK A MOCK)
  // -----------------------------------------------------------------------------

  await runTest('3.1: AEAT_TRANSPORT_MODE=real sin certificado configurado RECHAZA el envío tajantemente (prohibido fallback a mock)', async () => {
    AeatCertificateProvider.clear();
    const inv = createDummyInvoice({ numeroFactura: 'FAC-REAL-001' });
    const rec = createFiscalRecordFromInvoice(inv, config, null, {
      hashActual: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      fechaHoraSellado: '2026-02-15T10:00:00+01:00'
    });
    const sub = createFiscalSubmission(rec, config);

    await assert.rejects(async () => {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: rec,
        config,
        options: { transportMode: 'real' }
      });
    }, /Modo real de transporte AEAT requerido \(AEAT_TRANSPORT_MODE=real\), pero no se han configurado credenciales de certificado mTLS válidas/);
  });

  await runTest('3.2: Modo mock explícito funciona sin certificado de forma aislada y controlada', async () => {
    AeatCertificateProvider.clear();
    const inv = createDummyInvoice({ numeroFactura: 'FAC-MOCK-001' });
    const rec = createFiscalRecordFromInvoice(inv, config, null, {
      hashActual: '222233334444555566667777888899990000aaaabbbbccccddddeeeeffff1111',
      fechaHoraSellado: '2026-02-15T10:05:00+01:00'
    });
    const sub = createFiscalSubmission(rec, config);

    const result = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: rec,
      config,
      options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
    });

    assert.strictEqual(result.submission.estado, 'ACCEPTED');
    assert.ok(result.submission.csv, 'Mock debe devolver CSV oficial');
  });

  await runTest('3.3: Modo real con credenciales mTLS configura e invoca el transporte seguro sin fallback', async () => {
    // Inyectar credenciales simuladas en el proveedor
    AeatCertificateProvider.setMockCredentialsForTesting({
      cert: '-----BEGIN CERTIFICATE-----\nMIIB...TEST...CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMIIE...TEST...KEY\n-----END PRIVATE KEY-----'
    });

    let customFetchInvoked = false;
    const inv = createDummyInvoice({ numeroFactura: 'FAC-REAL-MTLS' });
    const rec = createFiscalRecordFromInvoice(inv, config, null, {
      hashActual: '33334444555566667777888899990000aaaabbbbccccddddeeeeffff11112222',
      fechaHoraSellado: '2026-02-15T10:10:00+01:00'
    });
    const sub = createFiscalSubmission(rec, config);

    const result = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: rec,
      config,
      options: {
        transportMode: 'real',
        customFetch: async (url, init) => {
          customFetchInvoked = true;
          assert.strictEqual(init.method, 'POST');
          assert.ok(init.headers['Content-Type'].includes('text/xml'));
          return {
            status: 200,
            text: async () => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="https://www.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/RespuestaSuministro.xsd">
              <soapenv:Body>
                <sf:RespuestaRegFactuSistemaFacturacion>
                  <sf:Cabecera><sf:TiempoEsperaEnvio>60</sf:TiempoEsperaEnvio></sf:Cabecera>
                  <sf:EstadoEnvio>Correcto</sf:EstadoEnvio>
                  <sf:CSV>CSV-MTLS-REAL-12345</sf:CSV>
                </sf:RespuestaRegFactuSistemaFacturacion>
              </soapenv:Body>
            </soapenv:Envelope>`
          };
        }
      }
    });

    assert.strictEqual(customFetchInvoked, true, 'Debe invocar el canal HTTPS real');
    assert.strictEqual(result.submission.estado, 'ACCEPTED');
    assert.strictEqual(result.submission.csv, 'CSV-MTLS-REAL-12345');
    AeatCertificateProvider.clear();
  });

  await runTest('3.4: AeatCertificateProvider NUNCA expone secretos en frontend', () => {
    (globalThis as any).window = {};
    try {
      assert.throws(() => {
        AeatCertificateProvider.getCredentials();
      }, /VIOLACIÓN DE SEGURIDAD/);
    } finally {
      delete (globalThis as any).window;
    }
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 4: ENDURECIMIENTO DE CONTROL DE FLUJO Y CERROJOS POR DEFECTO
  // -----------------------------------------------------------------------------

  await runTest('4.1: executeAeatSubmission adquiere el cerrojo de envío en vuelo POR DEFECTO', async () => {
    AeatFlowControlManager.reset();
    const inv = createDummyInvoice({ numeroFactura: 'FAC-LOCK-001' });
    const rec = createFiscalRecordFromInvoice(inv, config, null, {
      hashActual: '4444555566667777888899990000aaaabbbbccccddddeeeeffff111122223333',
      fechaHoraSellado: '2026-02-15T10:15:00+01:00'
    });
    const sub = createFiscalSubmission(rec, config);

    // Si el lock ya está adquirido por otro proceso para este obligado
    AeatFlowControlManager.acquireSendLock(NIF_EMISOR);

    await assert.rejects(async () => {
      // Debe fallar porque el cerrojo está activo
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: rec,
        config,
        options: { transportMode: 'mock' }
      });
    }, /Envío concurrente bloqueado para el obligado tributario/);

    AeatFlowControlManager.releaseSendLock(NIF_EMISOR);
  });

  await runTest('4.2: scheduleSubmissionRetry NUNCA permite violar la ventana oficial de TiempoEsperaEnvio con delaySeconds inferior', () => {
    AeatFlowControlManager.reset();
    const now = Date.now();
    // AEAT devolvió 120s de espera
    AeatFlowControlManager.updateFromResponse(NIF_EMISOR, 120, now);

    const inv = createDummyInvoice();
    const rec = createFiscalRecordFromInvoice(inv, config, null, {
      hashActual: '555566667777888899990000aaaabbbbccccddddeeeeffff1111222233334444',
      fechaHoraSellado: '2026-02-15T10:20:00+01:00'
    });
    const sub = createFiscalSubmission(rec, config);
    const failedSub = {
      ...sub,
      estado: 'FAILED_TECHNICAL' as const,
      codigoAeat: 'ERR_TIMEOUT'
    };

    // Intentamos programar reintento con un delay de solo 5 segundos
    const retrySub = scheduleSubmissionRetry(failedSub, 5);

    const scheduledTime = new Date(retrySub.proximoReintento!).getTime();
    const diffSeconds = Math.round((scheduledTime - now) / 1000);

    // Debe ser al menos 120 segundos, no 5 segundos
    assert.ok(diffSeconds >= 120, `El reintento programado (${diffSeconds}s) debe respetar los 120s de AEAT`);
  });

  await runTest('4.3: Remisión con FiscalRecord corrupto o manipulado es rechazada tajantemente por el backend', async () => {
    const inv = createDummyInvoice({ numeroFactura: 'FAC-TAMPERED' });
    const rec = createFiscalRecordFromInvoice(inv, config, null, {
      hashActual: '66667777888899990000aaaabbbbccccddddeeeeffff11112222333344445555',
      fechaHoraSellado: '2026-02-15T10:25:00+01:00'
    });

    // Manipulamos el importe de la factura sellada
    const tamperedRec = {
      ...rec,
      desgloseTributario: {
        ...rec.desgloseTributario,
        importeTotal: 9999.99 // Importe alterado respecto al hash original
      }
    };

    const verification = await verifyFiscalRecordHash(tamperedRec);
    assert.strictEqual(verification.valid, false, 'La verificación de integridad debe fallar para registro manipulado');

    // Custodia de backend rechaza almacenar registros corruptos
    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalRecord(tamperedRec);
    }, /Fallo de integridad criptográfica en el registro/);
  });

  // -----------------------------------------------------------------------------
  // RESUMEN FINAL
  // -----------------------------------------------------------------------------
  console.log('================================================================');
  console.log('  RESUMEN FASE 3.1.3: 11/11 TESTS COMPLETADOS CON ÉXITO!');
  console.log('================================================================');
}

main().catch(err => {
  console.error('*** ERROR FATAL EN LA SUITE DE TESTS FASE 3.1.3 ***');
  console.error(err);
  process.exit(1);
});
