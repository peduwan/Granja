/**
 * SUITE DE TESTS - FASE 3.1.1: AUDITORÍA Y CORRECCIÓN DE LA INTEGRACIÓN AEAT VERI*FACTU
 *
 * Normativa Oficial:
 * - Ley 11/2021 de medidas contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024 (BOE 28/10/2024)
 * - Esquemas oficiales SuministroLR.xsd y RespuestaSuministro.xsd v1.0
 */

import assert from 'node:assert';
import {
  executeAeatSubmission,
  wrapInAeatSoapEnvelope,
  scheduleSubmissionRetry,
  createRetrySubmission,
  isRetryableSubmission,
  MAX_RETRY_ATTEMPTS,
  getRetryDelaySeconds,
  AEAT_SOAP_ENDPOINTS,
  AEAT_OFFICIAL_ENDPOINTS,
  getAeatSoapEndpoint,
  getAeatQrEndpoint,
  normalizeAeatEnvironment
} from '../src/fiscal/aeatTransport';
import {
  parseAeatXmlResponse,
  classifySoapFault
} from '../src/fiscal/aeatResponseParser';
import {
  MockAeatTransport
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
import { FiscalRecord, FiscalConfiguration, FiscalSubmission } from '../src/fiscal/types';
import { Factura } from '../src/types';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 3.1.1: AUDITORÍA AEAT VERI*FACTU ');
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
    id: 'inv-test-audit-01',
    numeroFactura: 'FAC-2026/0601',
    fecha: '2026-10-15',
    clienteId: 'c1',
    clienteNombre: 'Distribuidora Alimentaria Toledo',
    clienteCif: 'B99887766',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 200,
      porcentajeIva: 4,
      cuotaIva: 8,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 208
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-15T10:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const recordDraft = createFiscalRecordFromInvoice(invoice, config, null, {
    hashActual: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2',
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
// BLOQUE 1: AUDITORÍA DE ENDPOINTS OFICIALES Y ÚNICA FUENTE DE VERDAD
// -----------------------------------------------------------------------------

await runTest('Test 1: Única fuente de verdad: resolución exacta de endpoints SOAP (standard y sello)', () => {
  // Producción estándar vs sello
  const prodStd = getAeatSoapEndpoint('production', 'standard');
  const prodSello = getAeatSoapEndpoint('production', 'sello');
  assert.strictEqual(prodStd, 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP');
  assert.strictEqual(prodSello, 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP');

  // Pruebas / Preproducción estándar vs sello
  const testStd = getAeatSoapEndpoint('test', 'standard');
  const testSello = getAeatSoapEndpoint('test', 'sello');
  assert.strictEqual(testStd, 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP');
  assert.strictEqual(testSello, 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP');

  // Modo mock
  const mockSoap = getAeatSoapEndpoint('mock');
  assert.strictEqual(mockSoap, 'mock://aeat.local/ws/SistemaFacturacion/VerifactuSOAP');

  // Cotejo QR
  assert.strictEqual(getAeatQrEndpoint('production'), 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR');
  assert.strictEqual(getAeatQrEndpoint('test'), 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR');
});

await runTest('Test 2: Normalización unificada de entornos (production, test, mock)', () => {
  assert.strictEqual(normalizeAeatEnvironment('production'), 'production');
  assert.strictEqual(normalizeAeatEnvironment('produccion'), 'production');
  assert.strictEqual(normalizeAeatEnvironment('prod'), 'production');
  assert.strictEqual(normalizeAeatEnvironment('test'), 'test');
  assert.strictEqual(normalizeAeatEnvironment('pruebas'), 'test');
  assert.strictEqual(normalizeAeatEnvironment('pre'), 'test');
  assert.strictEqual(normalizeAeatEnvironment('preproduccion'), 'test');
  assert.strictEqual(normalizeAeatEnvironment('mock'), 'mock');
  
  // Con argumento no reconocido, normaliza a 'mock'
  assert.strictEqual(normalizeAeatEnvironment('desconocido'), 'mock');

  // Sin argumentos, resuelve a un entorno válido según process.env
  const fromEnv = normalizeAeatEnvironment();
  assert.ok(['production', 'test', 'mock'].includes(fromEnv));
});

await runTest('Test 3: Eliminación absoluta de endpoints legados en configuración por defecto y outbox', () => {
  const { record, config } = createSampleSealedRecord();
  
  // createDefaultFiscalConfiguration no debe generar URLs legadas (SuministroLRFacturasEmitidas)
  assert.ok(!config.transporte?.endpointUrl.includes('SuministroLRFacturasEmitidas'));
  assert.strictEqual(config.transporte?.endpointUrl, AEAT_OFFICIAL_ENDPOINTS.soap.test.standard);

  // createFiscalSubmission genera endpoint oficial conforme al WSDL
  const submission = createFiscalSubmission(record, config);
  assert.ok(!submission.endpoint.includes('SuministroLRFacturasEmitidas'));
  assert.strictEqual(submission.endpoint, AEAT_OFFICIAL_ENDPOINTS.soap.test.standard);
});

// -----------------------------------------------------------------------------
// BLOQUE 2: SEGURIDAD DEL CERTIFICADO Y MODO MOCK
// -----------------------------------------------------------------------------

await runTest('Test 4: El modo mock opera 100% aislado sin requerir certificado ni red externa', async () => {
  // Aseguramos que no hay certificados configurados en entorno temporalmente
  const prevPfx = process.env.AEAT_CERT_PFX_BASE64;
  const prevPass = process.env.AEAT_CERT_PASSWORD;
  delete process.env.AEAT_CERT_PFX_BASE64;
  delete process.env.AEAT_CERT_PASSWORD;

  try {
    const { record, config } = createSampleSealedRecord();
    const submission = createFiscalSubmission(record, config);

    // Ejecuta con transporte mock sin certificado
    const result = await executeAeatSubmission({
      submission,
      fiscalRecord: record,
      config,
      options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE' }
    });

    assert.strictEqual(result.submission.estado, 'ACCEPTED');
    assert.ok(result.submission.csv);
    assert.strictEqual(result.isTechnicalError, false);
  } finally {
    if (prevPfx) process.env.AEAT_CERT_PFX_BASE64 = prevPfx;
    if (prevPass) process.env.AEAT_CERT_PASSWORD = prevPass;
  }
});

await runTest('Test 5: AeatCertificateProvider no expone secretos privados y bloquea acceso frontend', () => {
  const info = AeatCertificateProvider.getPublicInfo();
  assert.strictEqual((info as any).passphrase, undefined);
  assert.strictEqual((info as any).key, undefined);
  assert.strictEqual((info as any).pfx, undefined);

  // Simulación de intento de acceso indebido desde entorno browser
  (globalThis as any).window = {};
  try {
    assert.throws(
      () => AeatCertificateProvider.getCredentials(),
      /VIOLACIÓN DE SEGURIDAD/
    );
  } finally {
    delete (globalThis as any).window;
  }
});

// -----------------------------------------------------------------------------
// BLOQUE 3: SOAP 1.1 Y CLASIFICACIÓN DE SOAP FAULTS
// -----------------------------------------------------------------------------

await runTest('Test 6: SOAP 1.1 Envelope: encapsulado UTF-8, namespaces oficiales y Header/Body', () => {
  const { record } = createSampleSealedRecord();
  const envelope = wrapInAeatSoapEnvelope(record.xmlOficial!);

  assert.ok(envelope.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(envelope.includes('xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'));
  assert.ok(envelope.includes('<soapenv:Header/>'));
  assert.ok(envelope.includes('<soapenv:Body>'));
  assert.ok(envelope.includes('</soapenv:Body>'));
  assert.ok(envelope.includes('</soapenv:Envelope>'));

  // Idempotencia: si ya está envuelto, wrapInAeatSoapEnvelope no lo anida dos veces
  const secondWrap = wrapInAeatSoapEnvelope(envelope);
  assert.strictEqual(secondWrap, envelope);
});

await runTest('Test 7: Clasificación SOAP Fault Server: infraestructura AEAT → FAILED_TECHNICAL reintentable', () => {
  const fault = classifySoapFault(
    'soapenv:Server',
    'Error interno en base de datos de la AEAT',
    'Database connection pool exhausted'
  );

  assert.strictEqual(fault.category, 'SOAP_FAULT_SERVER');
  assert.strictEqual(fault.isRetryable, true);
  assert.strictEqual(fault.faultcode, 'soapenv:Server');
  assert.ok(fault.detail?.includes('Database'));
});

await runTest('Test 8: Clasificación SOAP Fault Client: sintaxis o esquema XSD → FAILED_TECHNICAL NO reintentable', () => {
  const fault = classifySoapFault(
    'soapenv:Client',
    'El mensaje XML de solicitud no cumple con el esquema XSD SuministroLR',
    'cvc-complex-type.2.4.a: Invalid content was found'
  );

  assert.strictEqual(fault.category, 'SOAP_FAULT_CLIENT');
  assert.strictEqual(fault.isRetryable, false);
});

await runTest('Test 9: Clasificación SOAP Fault desconocido → NO reintentable por defecto', () => {
  const fault = classifySoapFault(
    'soapenv:CustomVendorCode',
    'Respuesta atípica de proxy inverso no clasificada'
  );

  assert.strictEqual(fault.category, 'SOAP_FAULT_UNKNOWN');
  assert.strictEqual(fault.isRetryable, false);
});

await runTest('Test 10: executeAeatSubmission clasifica SOAP_FAULT_CLIENT y SOAP_FAULT_SERVER preservando fault details', async () => {
  const { record, config } = createSampleSealedRecord();
  const sub1 = createFiscalSubmission(record, config);

  // 1. Ejecutar escenario SOAP_FAULT_CLIENT (Error 400 de sintaxis)
  const clientResult = await executeAeatSubmission({
    submission: sub1,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_CLIENT' }
  });

  assert.strictEqual(clientResult.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(clientResult.isTechnicalError, true);
  assert.strictEqual(clientResult.httpStatus, 400);
  assert.strictEqual(clientResult.parsedResponse?.fault?.category, 'SOAP_FAULT_CLIENT');
  assert.strictEqual(clientResult.parsedResponse?.fault?.isRetryable, false);
  assert.strictEqual(isRetryableSubmission(clientResult.submission, clientResult.parsedResponse), false);

  // 2. Ejecutar escenario SOAP_FAULT_SERVER (Error 500 de servidor)
  const sub2 = createFiscalSubmission(record, config, { numeroIntento: 1 });
  const serverResult = await executeAeatSubmission({
    submission: sub2,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_SERVER' }
  });

  assert.strictEqual(serverResult.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(serverResult.isTechnicalError, true);
  assert.strictEqual(serverResult.httpStatus, 500);
  assert.strictEqual(serverResult.parsedResponse?.fault?.category, 'SOAP_FAULT_SERVER');
  assert.strictEqual(serverResult.parsedResponse?.fault?.isRetryable, true);
  assert.strictEqual(isRetryableSubmission(serverResult.submission, serverResult.parsedResponse), true);
});

// -----------------------------------------------------------------------------
// BLOQUE 4: ENDURECIMIENTO DE POLÍTICA DE REINTENTOS Y BACKOFF EXPONENCIAL
// -----------------------------------------------------------------------------

await runTest('Test 11: Política interna con backoff: 60s (intento 1), 180s (intento 2), 600s (intento 3)', () => {
  assert.strictEqual(getRetryDelaySeconds(1), 60);
  assert.strictEqual(getRetryDelaySeconds(2), 180);
  assert.strictEqual(getRetryDelaySeconds(3), 600);
});

await runTest('Test 12: Bloqueo tajante de reintentos sobre sumisiones ya aceptadas o rechazadas funcionalmente', () => {
  const { record, config } = createSampleSealedRecord();

  // Aceptada
  const acceptedSub = deepFreeze({
    ...createFiscalSubmission(record, config),
    estado: 'ACCEPTED' as const
  });

  assert.throws(
    () => scheduleSubmissionRetry(acceptedSub),
    /Solo se pueden reprogramar sumisiones en estado FAILED_TECHNICAL/
  );
  assert.throws(
    () => createRetrySubmission({ previousSubmission: acceptedSub, fiscalRecord: record, config }),
    /No se puede reintentar una sumisión ya aceptada/
  );

  // Rechazo funcional por AEAT
  const rejectedSub = deepFreeze({
    ...createFiscalSubmission(record, config),
    estado: 'REJECTED' as const,
    codigoAeat: '1104'
  });

  assert.throws(
    () => scheduleSubmissionRetry(rejectedSub),
    /Solo se pueden reprogramar sumisiones en estado FAILED_TECHNICAL/
  );
  assert.throws(
    () => createRetrySubmission({ previousSubmission: rejectedSub, fiscalRecord: record, config }),
    /No se puede reintentar automáticamente una sumisión rechazada funcionalmente/
  );
});

await runTest('Test 13: Bloqueo tajante de reintentos automáticos tras fallo de cliente (SOAP_FAULT_CLIENT)', () => {
  const { record, config } = createSampleSealedRecord();

  const clientFaultSub = deepFreeze({
    ...createFiscalSubmission(record, config),
    estado: 'FAILED_TECHNICAL' as const,
    codigoAeat: 'soapenv:Client'
  });

  assert.throws(
    () => scheduleSubmissionRetry(clientFaultSub),
    /La sumisión no es reintentable automáticamente/
  );
  assert.throws(
    () => createRetrySubmission({ previousSubmission: clientFaultSub, fiscalRecord: record, config }),
    /La sumisión previa no es reintentable/
  );
});

await runTest('Test 14: Límite estricto de intentos (MAX_RETRY_ATTEMPTS = 3): bloqueo al superar el cupo', () => {
  const { record, config } = createSampleSealedRecord();

  // Sumisión en su 3º intento que falla
  const thirdAttemptSub = deepFreeze({
    ...createFiscalSubmission(record, config, { numeroIntento: 3 }),
    estado: 'FAILED_TECHNICAL' as const,
    codigoAeat: 'soapenv:Server'
  });

  assert.strictEqual(MAX_RETRY_ATTEMPTS, 3);

  // Intento de programar reintento sobre el intento #3
  assert.throws(
    () => scheduleSubmissionRetry(thirdAttemptSub),
    /Se ha alcanzado el límite máximo de 3 intentos/
  );

  // Intento de crear intento #4
  assert.throws(
    () => createRetrySubmission({ previousSubmission: thirdAttemptSub, fiscalRecord: record, config }),
    /Se ha alcanzado el límite máximo de 3 intentos/
  );
});

await runTest('Test 15: Reintento válido incrementa numeroIntento en Outbox y mantiene FiscalRecord 100% inmutable', () => {
  const { record, config } = createSampleSealedRecord();
  const sub1 = createFiscalSubmission(record, config, { numeroIntento: 1 });

  const failedSub1 = deepFreeze({
    ...sub1,
    estado: 'FAILED_TECHNICAL' as const,
    codigoAeat: 'soapenv:Server'
  });

  // Programar reintento automático con backoff
  const scheduledSub = scheduleSubmissionRetry(failedSub1);
  assert.strictEqual(scheduledSub.estado, 'RETRY_PENDING');
  assert.ok(scheduledSub.proximoReintento);

  // Crear intento #2
  const snapshotBefore = JSON.stringify(record);
  const sub2 = createRetrySubmission({
    previousSubmission: scheduledSub,
    fiscalRecord: record,
    config
  });
  const snapshotAfter = JSON.stringify(record);

  assert.strictEqual(snapshotBefore, snapshotAfter, 'FiscalRecord sellado permanece 100% inmutable');
  assert.strictEqual(Object.isFrozen(record), true);
  assert.strictEqual(sub2.numeroIntento, 2);
  assert.strictEqual(sub2.estado, 'PENDING');
  assert.strictEqual(sub2.fiscalRecordId, record.id);
});

console.log('================================================================');
console.log(`  RESUMEN FASE 3.1.1: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO! `);
console.log('================================================================');
