/**
 * SUITE DE TESTS - FASE 3.1: TRANSPORTE AEAT Y REMISIÓN REAL VERI*FACTU
 *
 * Normativa Oficial:
 * - Ley 11/2021 de medidas de prevención y lucha contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024 (BOE 28/10/2024)
 * - Esquemas oficiales SuministroLR.xsd y RespuestaSuministro.xsd
 */

import assert from 'node:assert';
import {
  executeAeatSubmission,
  wrapInAeatSoapEnvelope,
  scheduleSubmissionRetry,
  createRetrySubmission,
  AEAT_SOAP_ENDPOINTS
} from '../src/fiscal/aeatTransport';
import {
  parseAeatXmlResponse
} from '../src/fiscal/aeatResponseParser';
import {
  MockAeatTransport,
  MockScenario
} from '../src/fiscal/mockAeatTransport';
import {
  AeatCertificateProvider
} from '../src/fiscal/aeatCertificateProvider';
import {
  createFiscalSubmission,
  resetFiscalOutbox,
  getSubmissionsForRecord
} from '../src/fiscal/submissionService';
import {
  createDefaultFiscalConfiguration,
  createFiscalRecordFromInvoice
} from '../src/fiscal/modelTransformers';
import { buildAeatVerifactuXml } from '../src/fiscal/aeatVerifactuXmlBuilder';
import { emitFiscalInvoice } from '../src/fiscal/emissionService';
import { FiscalRecord, FiscalConfiguration } from '../src/fiscal/types';
import { Factura } from '../src/types';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 3.1: TRANSPORTE Y REMISIÓN AEAT ');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  [PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] Test ${totalTests}: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

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

function createSampleSealedRecord(): { record: FiscalRecord; config: FiscalConfiguration } {
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Factura = {
    id: 'inv-test-trans-01',
    numeroFactura: 'FAC-2026/0501',
    fecha: '2026-10-15',
    clienteId: 'c1',
    clienteNombre: 'Restaurante El Gourmet',
    clienteCif: 'B99887766',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 100,
      porcentajeIva: 4,
      cuotaIva: 4,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 104
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-15T10:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const recordDraft = createFiscalRecordFromInvoice(invoice, config, null, {
    hashActual: '11223344556677889900AABBCCDDEEFF11223344556677889900AABBCCDDEEFF',
    fechaHoraSellado: '2026-10-15T10:00:00+02:00'
  });

  const officialXml = buildAeatVerifactuXml(recordDraft);

  const sealedRecord: FiscalRecord = deepFreeze({
    ...recordDraft,
    xmlOficial: officialXml
  });

  return { record: sealedRecord, config };
}

// -----------------------------------------------------------------------------
// TESTS OBLIGATORIOS FASE 3.1
// -----------------------------------------------------------------------------

await runTest('Test 1: FiscalRecord permanece estrictamente inmutable durante el envío a AEAT', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const snapshotBefore = JSON.stringify(record);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
  });

  const snapshotAfter = JSON.stringify(record);
  assert.strictEqual(snapshotBefore, snapshotAfter, 'FiscalRecord no debe sufrir ninguna alteración física ni lógica');
  assert.strictEqual(Object.isFrozen(record), true, 'FiscalRecord debe seguir congelado en runtime');
  assert.strictEqual(result.submission.estado, 'ACCEPTED');
});

await runTest('Test 2: FiscalSubmission pasa PENDING → SENDING durante el proceso de remisión', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  assert.strictEqual(submission.estado, 'PENDING');
  assert.strictEqual(submission.fechaEnvio, undefined);

  // Ejecutamos el envío
  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
  });

  // La sumisión resultante registra la fecha de envío
  assert.ok(result.submission.fechaEnvio, 'Debe registrar fechaEnvio');
  assert.notStrictEqual(result.submission.estado, 'PENDING');
});

await runTest('Test 3: Respuesta aceptada por AEAT → FiscalSubmission pasa a ACCEPTED con CSV', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
  });

  assert.strictEqual(result.submission.estado, 'ACCEPTED');
  assert.strictEqual(result.isTechnicalError, false);
  assert.ok(result.submission.csv?.startsWith('CSV-AEAT-'));
  assert.strictEqual(result.submission.codigoAeat, '0');
  assert.ok(result.submission.completadoEn);
  assert.strictEqual(result.fiscalEvent.tipo, 'ENVIO_AEAT_ACEPTADO');
});

await runTest('Test 4: Respuesta con avisos o errores subsanables → ACCEPTED_WITH_ERRORS', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE_WITH_WARNINGS' }
  });

  assert.strictEqual(result.submission.estado, 'ACCEPTED_WITH_ERRORS');
  assert.strictEqual(result.isTechnicalError, false);
  assert.ok(result.submission.csv);
  assert.ok(result.submission.avisos && result.submission.avisos.length > 0);
  assert.strictEqual(result.submission.avisos[0].codigo, '1101');
  assert.strictEqual(result.fiscalEvent.tipo, 'ENVIO_AEAT_ACEPTADO_CON_ERRORES');
});

await runTest('Test 5: Rechazo funcional por la AEAT → REJECTED sin reintento automático ciego', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'FUNCTIONAL_REJECTION' }
  });

  assert.strictEqual(result.submission.estado, 'REJECTED');
  assert.strictEqual(result.isTechnicalError, false);
  assert.strictEqual(result.submission.csv, undefined, 'Un rechazo no emite CSV');
  assert.strictEqual(result.submission.codigoAeat, '1104');
  assert.ok(result.submission.errores && result.submission.errores.length > 0);
  assert.strictEqual(result.fiscalEvent.tipo, 'ENVIO_AEAT_RECHAZADO');
});

await runTest('Test 6: Timeout de red → Clasificado estrictamente como FAILED_TECHNICAL', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'TIMEOUT' }
  });

  assert.strictEqual(result.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(result.isTechnicalError, true);
  assert.strictEqual(result.errorDetails?.code, 'ETIMEDOUT');
  assert.notStrictEqual(result.submission.estado, 'REJECTED', 'Un timeout NO debe marcarse como REJECTED');
  assert.strictEqual(result.fiscalEvent.tipo, 'ENVIO_AEAT_ERROR_TECNICO');
});

await runTest('Test 7: Error HTTP 5xx del servidor AEAT → FAILED_TECHNICAL', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'HTTP_500' }
  });

  assert.strictEqual(result.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(result.isTechnicalError, true);
  assert.strictEqual(result.httpStatus, 500);
  assert.strictEqual(result.fiscalEvent.tipo, 'ENVIO_AEAT_ERROR_TECNICO');
});

await runTest('Test 8: Reintento técnico de una sumisión fallida → RETRY_PENDING con fecha programada', () => {
  const { record, config } = createSampleSealedRecord();
  const sub = createFiscalSubmission(record, config);

  // Simulamos fallo técnico previo
  const failedSub = deepFreeze({
    ...sub,
    estado: 'FAILED_TECHNICAL' as const
  });

  const scheduled = scheduleSubmissionRetry(failedSub, 120);

  assert.strictEqual(scheduled.estado, 'RETRY_PENDING');
  assert.ok(scheduled.proximoReintento);
  assert.ok(new Date(scheduled.proximoReintento).getTime() > Date.now());
});

await runTest('Test 9: Crear una nueva sumisión para reintento NO modifica en ningún caso el FiscalRecord', () => {
  const { record, config } = createSampleSealedRecord();
  const sub1 = createFiscalSubmission(record, config, { numeroIntento: 1 });

  const snapshotBefore = JSON.stringify(record);

  const retrySub = createRetrySubmission({
    previousSubmission: sub1,
    fiscalRecord: record,
    config
  });

  const snapshotAfter = JSON.stringify(record);
  assert.strictEqual(snapshotBefore, snapshotAfter, 'FiscalRecord sellado no debe mutar al reintentar');
  assert.strictEqual(retrySub.numeroIntento, 2);
  assert.strictEqual(retrySub.fiscalRecordId, record.id);
  assert.strictEqual(retrySub.estado, 'PENDING');
});

await runTest('Test 10: XML enviado por el transporte coincide exactamente con xmlOficial sin regeneración', () => {
  const { record } = createSampleSealedRecord();

  const soapEnvelope = wrapInAeatSoapEnvelope(record.xmlOficial!);

  assert.ok(soapEnvelope.includes('<soapenv:Envelope'), 'Debe incluir el envelope SOAP');
  assert.ok(soapEnvelope.includes(record.xmlOficial!.replace(/^<\?xml[^>]*\?>\s*/i, '').trim()), 'Debe encapsular exactamente el XML oficial');
  assert.ok(soapEnvelope.includes(record.huella.hash), 'Debe conservar la huella exacta');
  assert.ok(soapEnvelope.includes(record.factura.numeroFactura), 'Debe conservar el número exacto');
});

await runTest('Test 11: La respuesta XML bruta de la AEAT se conserva íntegramente en la sumisión', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
  });

  assert.ok(result.submission.xmlRespuesta, 'Debe almacenar xmlRespuesta');
  assert.ok(result.submission.xmlRespuesta.includes('RespuestaRegFactuSistemaFacturacion'));
  assert.ok(result.submission.xmlRespuesta.includes('CSV-AEAT-'));
});

await runTest('Test 12: El CSV emitido por la AEAT se almacena en FiscalSubmission y NUNCA en FiscalRecord', async () => {
  const { record, config } = createSampleSealedRecord();
  const submission = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
  });

  assert.ok(result.submission.csv, 'FiscalSubmission debe almacenar el CSV');
  assert.strictEqual((record as any).csv, undefined, 'FiscalRecord sellado NUNCA debe contener el campo csv');
  assert.strictEqual((record as any).estadoEnvio, undefined, 'FiscalRecord sellado NUNCA debe contener estadoEnvio');
  assert.strictEqual(record.estado, 'sellado_inmutable');
});

await runTest('Test 13: Seguridad: No se almacenan ni exponen secretos privados en frontend ni logs', () => {
  // 1. AeatCertificateProvider no expone secretos en info pública
  const publicInfo = AeatCertificateProvider.getPublicInfo();
  assert.strictEqual((publicInfo as any).passphrase, undefined);
  assert.strictEqual((publicInfo as any).key, undefined);
  assert.strictEqual((publicInfo as any).pfx, undefined);

  // 2. FiscalRecord no contiene secretos ni campos de certificado
  const { record } = createSampleSealedRecord();
  assert.strictEqual((record as any).cert, undefined);
  assert.strictEqual((record as any).privateKey, undefined);
  assert.strictEqual((record as any).password, undefined);
});

await runTest('Test 14: MockAeatTransport reproduce fielmente los 8 escenarios oficiales requeridos', async () => {
  const scenarios: MockScenario[] = [
    'ACCEPTANCE',
    'ACCEPTANCE_WITH_WARNINGS',
    'FUNCTIONAL_REJECTION',
    'TIMEOUT',
    'HTTP_500',
    'INVALID_XML',
    'UNEXPECTED_RESPONSE',
    'TLS_CERT_ERROR'
  ];

  for (const sc of scenarios) {
    if (sc === 'TIMEOUT' || sc === 'TLS_CERT_ERROR') {
      await assert.rejects(async () => {
        await MockAeatTransport.execute(sc);
      });
    } else if (sc === 'HTTP_500') {
      const res = await MockAeatTransport.execute(sc);
      assert.strictEqual(res.status, 500);
      assert.ok(res.text.includes('soapenv:Fault'));
    } else if (sc === 'INVALID_XML') {
      const res = await MockAeatTransport.execute(sc);
      assert.strictEqual(res.status, 502);
      assert.ok(res.text.includes('502 Bad Gateway'));
    } else {
      const res = await MockAeatTransport.execute(sc);
      assert.strictEqual(res.status, 200);
      assert.ok(res.text.length > 50);
    }
  }
});

await runTest('Test 15: La acción "Enviar a AEAT" opera exclusivamente sobre el FiscalRecord ya emitido', async () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoiceDraft: Factura = {
    id: 'inv-fac-ui-send',
    numeroFactura: 'FAC-2026/0999',
    fecha: '2026-10-15',
    clienteId: 'c1',
    clienteNombre: 'Cliente Hostelería',
    clienteCif: 'B99887766',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 50,
      porcentajeIva: 4,
      cuotaIva: 2,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 52
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-15T12:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  // 1. Emisión de la factura y su FiscalRecord sellado
  const { invoice, fiscalRecord } = await emitFiscalInvoice({
    invoiceDraft,
    fiscalConfig: config,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });

  const originalHash = fiscalRecord.huella.hash;
  const originalNumero = fiscalRecord.factura.numeroFactura;
  const originalQrUrl = fiscalRecord.qr.url;

  // 2. Creación del envío a partir del FiscalRecord existente
  const sub = createFiscalSubmission(fiscalRecord, config);

  // 3. Ejecución del envío
  const result = await executeAeatSubmission({
    submission: sub,
    fiscalRecord,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
  });

  // 4. Verificación de que NO se regeneró ni mutó absolutamente nada del registro previo
  assert.strictEqual(fiscalRecord.huella.hash, originalHash);
  assert.strictEqual(fiscalRecord.factura.numeroFactura, originalNumero);
  assert.strictEqual(fiscalRecord.qr.url, originalQrUrl);
  assert.strictEqual(invoice.numeroFactura, originalNumero);
  assert.strictEqual(result.submission.estado, 'ACCEPTED');
  assert.strictEqual(result.submission.numeroFactura, originalNumero);
});

console.log('================================================================');
console.log(`  RESUMEN FASE 3.1: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO! `);
console.log('================================================================');
