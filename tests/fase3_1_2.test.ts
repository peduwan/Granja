/**
 * SUITE DE TESTS - FASE 3.1.2: CONTROL DE FLUJO OFICIAL AEAT Y POLÍTICA INTERNA DE REINTENTOS
 *
 * Normativa y Referencia Técnica Oficial:
 * - Documentación técnica oficial AEAT VERI*FACTU v1.0.3 (Descripción del Servicio Web de Suministro)
 * - Apartado 6.4.4.1 "Mecanismo de control de flujo"
 * - WSDL oficial AEAT: SistemaFacturacion.wsdl (soap:address en www1/prewww1 y www10/prewww10)
 * - Real Decreto 1007/2023 | Orden HAC/1177/2024
 */

import assert from 'node:assert';
import {
  executeAeatSubmission,
  executeWithAeatLock,
  AeatFlowControlManager,
  DEFAULT_AEAT_TIEMPO_ESPERA_SEGUNDOS,
  MAX_AEAT_RECORDS_PER_SUBMISSION,
  INTERNAL_MAX_RETRY_ATTEMPTS,
  getInternalRetryDelaySeconds,
  isRetryableSubmission,
  scheduleSubmissionRetry,
  createRetrySubmission,
  AEAT_OFFICIAL_ENDPOINTS,
  getAeatSoapEndpoint
} from '../src/fiscal/aeatTransport';
import {
  createFiscalSubmission,
  resetFiscalOutbox
} from '../src/fiscal/submissionService';
import {
  createDefaultFiscalConfiguration,
  createFiscalRecordFromInvoice
} from '../src/fiscal/modelTransformers';
import { buildAeatVerifactuXml } from '../src/fiscal/aeatVerifactuXmlBuilder';
import { MockAeatTransport } from '../src/fiscal/mockAeatTransport';
import { FiscalRecord, FiscalConfiguration } from '../src/fiscal/types';
import { Factura } from '../src/types';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 3.1.2: CONTROL DE FLUJO AEAT ');
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

function createSampleSealedRecord(obligadoNif = 'B12345678'): { record: FiscalRecord; config: FiscalConfiguration } {
  const config = createDefaultFiscalConfiguration({
    nif: obligadoNif,
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Factura = {
    id: `inv-test-flow-${obligadoNif}-${Date.now()}`,
    numeroFactura: `FAC-2026/${Math.floor(1000 + Math.random() * 9000)}`,
    fecha: '2026-10-15',
    clienteId: 'c1',
    clienteNombre: 'Hostelería Castellana S.L.',
    clienteCif: 'B88776655',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 150,
      porcentajeIva: 4,
      cuotaIva: 6,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 156
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-15T10:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const recordDraft = createFiscalRecordFromInvoice(invoice, config, null, {
    hashActual: 'C1D2E3F4C1D2E3F4C1D2E3F4C1D2E3F4C1D2E3F4C1D2E3F4C1D2E3F4C1D2E3F4',
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
// BLOQUE 1: CONFIRMACIÓN DE ENDPOINTS CONTRA EL WSDL OFICIAL (SistemaFacturacion.wsdl)
// -----------------------------------------------------------------------------

await runTest('Test 1: Endpoints coinciden exactamente con SistemaFacturacion.wsdl (www1/prewww1 y www10/prewww10)', () => {
  assert.strictEqual(
    getAeatSoapEndpoint('production', 'standard'),
    'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    'Producción estándar debe apuntar a www1 según soap:address del WSDL'
  );
  assert.strictEqual(
    getAeatSoapEndpoint('production', 'sello'),
    'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    'Producción sello debe apuntar a www10 según soap:address del WSDL'
  );

  assert.strictEqual(
    getAeatSoapEndpoint('test', 'standard'),
    'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    'Pruebas estándar debe apuntar a prewww1 según soap:address del WSDL'
  );
  assert.strictEqual(
    getAeatSoapEndpoint('test', 'sello'),
    'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
    'Pruebas sello debe apuntar a prewww10 según soap:address del WSDL'
  );
});

// -----------------------------------------------------------------------------
// BLOQUE 2: CONTROL DE FLUJO DINÁMICO OFICIAL AEAT (<TiempoEsperaEnvio>)
// -----------------------------------------------------------------------------

await runTest('Test 2: Valor inicial por defecto de TiempoEsperaEnvio es de 60 segundos antes de recibir respuesta', () => {
  AeatFlowControlManager.reset();
  const nif = 'B11223344';
  assert.strictEqual(DEFAULT_AEAT_TIEMPO_ESPERA_SEGUNDOS, 60, 'El valor por defecto normativo inicial es 60s');
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(nif), 60);
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif), true, 'El primer envío está permitido al no haber respuesta previa');
});

await runTest('Test 3: Control de flujo AEAT: respuesta inicial devuelve TiempoEsperaEnvio = 60s y registra timestamp', async () => {
  AeatFlowControlManager.reset();
  const { record, config } = createSampleSealedRecord('B12345678');
  const sub = createFiscalSubmission(record, config);

  const tBefore = Date.now();
  const result = await executeAeatSubmission({
    submission: sub,
    fiscalRecord: record,
    config,
    options: {
      transportMode: 'mock',
      mockScenario: 'ACCEPTANCE',
      mockTiempoEsperaEnvio: 60
    }
  });
  const tAfter = Date.now();

  assert.strictEqual(result.submission.estado, 'ACCEPTED');
  assert.strictEqual(result.submission.tiempoEsperaEnvio, 60);
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(record.obligadoTributarioId), 60);

  const state = AeatFlowControlManager.getFlowState(record.obligadoTributarioId);
  assert.ok(state, 'Debe existir estado de control de flujo registrado');
  assert.ok(state!.lastResponseTimestamp >= tBefore && state!.lastResponseTimestamp <= tAfter, 'lastResponseTimestamp registrado fielmente');
  assert.strictEqual(state!.nextAllowedSendTimestamp, state!.lastResponseTimestamp + 60000);
});

await runTest('Test 4: Actualización dinámica: siguiente respuesta incrementa TiempoEsperaEnvio a 120s y 300s', async () => {
  const { record, config } = createSampleSealedRecord('B12345678');
  const sub1 = createFiscalSubmission(record, config);

  // Respuesta con 120s
  const res120 = await executeAeatSubmission({
    submission: sub1,
    fiscalRecord: record,
    config,
    options: {
      transportMode: 'mock',
      mockScenario: 'ACCEPTANCE',
      mockTiempoEsperaEnvio: 120
    }
  });
  assert.strictEqual(res120.submission.tiempoEsperaEnvio, 120);
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(record.obligadoTributarioId), 120);

  // Respuesta con 300s (saturación de servidores AEAT)
  const sub2 = createFiscalSubmission(record, config, { numeroIntento: 2 });
  const res300 = await executeAeatSubmission({
    submission: sub2,
    fiscalRecord: record,
    config,
    options: {
      transportMode: 'mock',
      mockScenario: 'ACCEPTANCE',
      mockTiempoEsperaEnvio: 300
    }
  });
  assert.strictEqual(res300.submission.tiempoEsperaEnvio, 300);
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(record.obligadoTributarioId), 300);
});

await runTest('Test 5: Aislamiento por obligadoTributarioId: Obligado A a 300s no bloquea a Obligado B', () => {
  AeatFlowControlManager.reset();
  const obligadoA = 'A11111111';
  const obligadoB = 'B22222222';
  const now = 1000000000;

  // Obligado A recibe TiempoEsperaEnvio = 300s
  AeatFlowControlManager.updateFromResponse(obligadoA, 300, now);
  // Obligado B recibe TiempoEsperaEnvio = 60s
  AeatFlowControlManager.updateFromResponse(obligadoB, 60, now);

  // A los 70 segundos:
  // A lleva 70s < 300s -> BLOQUEADO
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(obligadoA, now + 70000), false);
  // B lleva 70s > 60s -> PERMITIDO
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(obligadoB, now + 70000), true);

  // Comprobación de que no existe temporizador global
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(obligadoA), 300);
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(obligadoB), 60);
});

// -----------------------------------------------------------------------------
// BLOQUE 3: REGLA DISYUNTIVA OFICIAL AEAT (Apartado 6.4.4.1 v1.0.3)
// El siguiente envío puede realizarse cuando:
// A) hayan transcurrido los segundos indicados por TiempoEsperaEnvio;
// O
// B) se haya acumulado el número máximo de 1.000 registros, lo que ocurra primero.
// -----------------------------------------------------------------------------

await runTest('Test 6: Regla OR - Cuando la ventana de tiempo NO ha expirado y pendingRecordsCount < 1000 -> Bloqueado', () => {
  AeatFlowControlManager.reset();
  const nif = 'B33333333';
  const now = 1000000000;
  AeatFlowControlManager.updateFromResponse(nif, 120, now);

  // Con 0 registros pendientes y t = now + 30s
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 30000, 0), false);
  // Con 50 registros pendientes y t = now + 30s
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 30000, 50), false);
  // Con 999 registros pendientes y t = now + 30s
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 30000, 999), false);
  // Con 999 registros pendientes a falta de 1 milisegundo de expirar el tiempo
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 119999, 999), false);
});

await runTest('Test 7: Regla OR - Cuando pendingRecordsCount = 1000, se permite de inmediato aunque no haya expirado el tiempo', () => {
  AeatFlowControlManager.reset();
  const nif = 'B33333333';
  const now = 1000000000;
  AeatFlowControlManager.updateFromResponse(nif, 120, now);

  assert.strictEqual(MAX_AEAT_RECORDS_PER_SUBMISSION, 1000, 'Constante oficial MAX_AEAT_RECORDS_PER_SUBMISSION = 1000');

  // Solo han transcurrido 5 segundos de los 120 exigidos, pero la cola alcanza 1.000 registros
  const allowed = AeatFlowControlManager.isSendAllowed(nif, now + 5000, 1000);
  assert.strictEqual(allowed, true, 'El lote completo de 1.000 registros se autoriza sin esperar');
});

await runTest('Test 8: Regla OR - Soporte de cola acumulada con más de 1.000 registros (e.g. 1001 registros)', () => {
  AeatFlowControlManager.reset();
  const nif = 'B33333333';
  const now = 1000000000;
  AeatFlowControlManager.updateFromResponse(nif, 300, now);

  // Con 1.001 registros en cola tras solo 10 segundos
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 10000, 1001), true);
});

await runTest('Test 9: Regla OR - Cuando expira el tiempo de espera, se permite el envío con menos de 1.000 registros', () => {
  AeatFlowControlManager.reset();
  const nif = 'B33333333';
  const now = 1000000000;
  AeatFlowControlManager.updateFromResponse(nif, 60, now);

  // Tras 60 segundos cumplidos:
  // Con 1 solo registro en cola -> PERMITIDO
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 60000, 1), true);
  // Con 5 registros -> PERMITIDO
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 60000, 5), true);
  // Con 500 registros -> PERMITIDO
  assert.strictEqual(AeatFlowControlManager.isSendAllowed(nif, now + 65000, 500), true);
});

// -----------------------------------------------------------------------------
// BLOQUE 4: CERROJO DE ENVÍO EN VUELO (EXCLUSIÓN MUTUA POR OBLIGADO)
// -----------------------------------------------------------------------------

await runTest('Test 10: acquireSendLock(A) es exclusivo; segundo proceso concurrente es bloqueado (false)', () => {
  AeatFlowControlManager.reset();
  const obligadoA = 'A44444444';

  const lock1 = AeatFlowControlManager.acquireSendLock(obligadoA);
  assert.strictEqual(lock1, true, 'Proceso 1 adquiere el cerrojo');
  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoA), true);

  const lock2 = AeatFlowControlManager.acquireSendLock(obligadoA);
  assert.strictEqual(lock2, false, 'Proceso 2 concurrente NO debe adquirir el cerrojo');

  AeatFlowControlManager.releaseSendLock(obligadoA);
  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoA), false);

  const lock3 = AeatFlowControlManager.acquireSendLock(obligadoA);
  assert.strictEqual(lock3, true, 'Tras liberar, un nuevo envío puede adquirir el cerrojo');
  AeatFlowControlManager.releaseSendLock(obligadoA);
});

await runTest('Test 11: Cerrojos independientes por obligado: acquireSendLock(A) no bloquea a obligado B', () => {
  AeatFlowControlManager.reset();
  const obligadoA = 'A44444444';
  const obligadoB = 'B55555555';

  assert.strictEqual(AeatFlowControlManager.acquireSendLock(obligadoA), true);
  assert.strictEqual(AeatFlowControlManager.acquireSendLock(obligadoB), true, 'Obligado B puede enviar en paralelo');

  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoA), true);
  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoB), true);

  AeatFlowControlManager.releaseSendLock(obligadoA);
  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoA), false);
  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoB), true);

  AeatFlowControlManager.releaseSendLock(obligadoB);
  assert.strictEqual(AeatFlowControlManager.isSendLocked(obligadoB), false);
});

await runTest('Test 12: Garantía de liberación del lock en bloque finally ante fallos técnicos o excepciones', async () => {
  AeatFlowControlManager.reset();
  const { record, config } = createSampleSealedRecord('B66666666');
  const sub = createFiscalSubmission(record, config);

  // Caso 1: SOAP Fault Server (HTTP 500)
  const resServer = await executeAeatSubmission({
    submission: sub,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_SERVER', acquireLock: true }
  });
  assert.strictEqual(resServer.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(AeatFlowControlManager.isSendLocked(record.obligadoTributarioId), false, 'Lock liberado tras SOAP Fault Server');

  // Caso 2: SOAP Fault Client (HTTP 400)
  const resClient = await executeAeatSubmission({
    submission: sub,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_CLIENT', acquireLock: true }
  });
  assert.strictEqual(resClient.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(AeatFlowControlManager.isSendLocked(record.obligadoTributarioId), false, 'Lock liberado tras SOAP Fault Client');

  // Caso 3: Error de red o timeout
  const resTimeout = await executeAeatSubmission({
    submission: sub,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'TIMEOUT', acquireLock: true }
  });
  assert.strictEqual(resTimeout.submission.estado, 'FAILED_TECHNICAL');
  assert.strictEqual(AeatFlowControlManager.isSendLocked(record.obligadoTributarioId), false, 'Lock liberado tras Network Timeout');

  // Caso 4: Excepción inesperada dentro de executeWithAeatLock
  try {
    await executeWithAeatLock(record.obligadoTributarioId, async () => {
      throw new Error('Crash simulado en transporte SOAP');
    });
  } catch (err: any) {
    assert.strictEqual(err.message, 'Crash simulado en transporte SOAP');
  }
  assert.strictEqual(AeatFlowControlManager.isSendLocked(record.obligadoTributarioId), false, 'Lock liberado en finally ante excepción inesperada');
});

await runTest('Test 13: executeWithAeatLock previene envíos paralelos concurrentes del mismo obligado', async () => {
  AeatFlowControlManager.reset();
  const obligado = 'B77777777';

  let running = false;
  let task1Started = false;
  let resolveTask1: () => void;
  const task1Promise = new Promise<void>(res => { resolveTask1 = res; });

  const p1 = executeWithAeatLock(obligado, async () => {
    running = true;
    task1Started = true;
    await task1Promise;
    running = false;
    return 'TASK_1_OK';
  });

  // Esperar a que la tarea 1 comience
  while (!task1Started) {
    await new Promise(r => setTimeout(r, 5));
  }

  // Intento concurrente de tarea 2 para el MISMO obligado
  const task2Result = await executeWithAeatLock(obligado, async () => {
    return 'TASK_2_OK';
  });

  assert.strictEqual(task2Result.executed, false);
  assert.strictEqual(task2Result.reason, 'CONCURRENT_SEND_LOCKED');

  // Completar tarea 1
  resolveTask1!();
  const task1Result = await p1;
  assert.strictEqual(task1Result.executed, true);
  if (task1Result.executed) {
    assert.strictEqual(task1Result.result, 'TASK_1_OK');
  }

  // Ahora el obligado está libre y una nueva tarea sí puede ejecutarse
  const task3Result = await executeWithAeatLock(obligado, async () => {
    return 'TASK_3_OK';
  });
  assert.strictEqual(task3Result.executed, true);
});

// -----------------------------------------------------------------------------
// BLOQUE 5: COORDINACIÓN ENTRE CONTROL DE FLUJO AEAT Y REINTENTOS INTERNOS
// -----------------------------------------------------------------------------

await runTest('Test 14: Diferenciación conceptual: reintentos con backoff (60/180/600s) son política interna', () => {
  assert.strictEqual(INTERNAL_MAX_RETRY_ATTEMPTS, 3);
  assert.strictEqual(getInternalRetryDelaySeconds(1), 60);
  assert.strictEqual(getInternalRetryDelaySeconds(2), 180);
  assert.strictEqual(getInternalRetryDelaySeconds(3), 600);
});

await runTest('Test 15: scheduleSubmissionRetry respeta la ventana de TiempoEsperaEnvio si es superior al backoff', async () => {
  AeatFlowControlManager.reset();
  const { record, config } = createSampleSealedRecord('B88888888');
  const now = Date.now();

  // La AEAT había devuelto TiempoEsperaEnvio = 300 segundos
  AeatFlowControlManager.updateFromResponse(record.obligadoTributarioId, 300, now);

  const sub = createFiscalSubmission(record, config, { numeroIntento: 1 });
  const failedSub = {
    ...sub,
    estado: 'FAILED_TECHNICAL' as const,
    codigoAeat: 'SOAP_500'
  };

  // Reintento interno #1 normalmente esperaría 60 segundos.
  // Pero la AEAT requiere 300 segundos.
  const scheduled = scheduleSubmissionRetry(failedSub);
  assert.strictEqual(scheduled.estado, 'RETRY_PENDING');
  assert.ok(scheduled.proximoReintento);

  const scheduledTime = new Date(scheduled.proximoReintento!).getTime();
  const delaySec = Math.round((scheduledTime - now) / 1000);
  // Debe esperar cerca de 300 segundos, nunca menos de la ventana oficial AEAT
  assert.ok(delaySec >= 298 && delaySec <= 302, `El retraso programado (${delaySec}s) debe respetar la ventana oficial de 300s`);
});

await runTest('Test 16: Un fallo técnico preserva íntegro el TiempoEsperaEnvio previo devuelto por la AEAT', async () => {
  AeatFlowControlManager.reset();
  const { record, config } = createSampleSealedRecord('B99999999');

  // 1. Envío exitoso que establece TiempoEsperaEnvio = 120s
  const sub1 = createFiscalSubmission(record, config);
  await executeAeatSubmission({
    submission: sub1,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE', mockTiempoEsperaEnvio: 120 }
  });
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(record.obligadoTributarioId), 120);

  // 2. Siguiente intento sufre un fallo técnico (SOAP Fault Server / Timeout)
  const sub2 = createFiscalSubmission(record, config, { numeroIntento: 2 });
  const failedRes = await executeAeatSubmission({
    submission: sub2,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_SERVER' }
  });
  assert.strictEqual(failedRes.submission.estado, 'FAILED_TECHNICAL');

  // El valor de 120s de la AEAT NO se ha borrado ni reseteado a 60s
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(record.obligadoTributarioId), 120);
});

await runTest('Test 17: SOAP Fault de infraestructura no inventa ni altera arbitrariamente TiempoEsperaEnvio', async () => {
  AeatFlowControlManager.reset();
  const { record, config } = createSampleSealedRecord('B00000000');
  const sub = createFiscalSubmission(record, config);

  const res = await executeAeatSubmission({
    submission: sub,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_SERVER' }
  });

  // La sumisión fallida no inventa tiempo de espera oficial
  assert.strictEqual(res.submission.tiempoEsperaEnvio, undefined);
  // El gestor de flujo conserva el valor normativo por defecto
  assert.strictEqual(AeatFlowControlManager.getCurrentFlowWaitSeconds(record.obligadoTributarioId), 60);
});

// -----------------------------------------------------------------------------
// BLOQUE 6: INMUTABILIDAD DEL FISCALRECORD Y TRAZABILIDAD EN FISCALSUBMISSION
// -----------------------------------------------------------------------------

await runTest('Test 18: Inmutabilidad física estricta del FiscalRecord a través del control de flujo y reintentos', async () => {
  const { record, config } = createSampleSealedRecord('B12345678');
  const sub1 = createFiscalSubmission(record, config, { numeroIntento: 1 });

  const hashBefore = record.huella.hash;
  const xmlBefore = record.xmlOficial;
  const qrBefore = record.qr.url;

  const result = await executeAeatSubmission({
    submission: sub1,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'SOAP_FAULT_SERVER' }
  });

  const sub2 = createRetrySubmission({
    previousSubmission: result.submission,
    fiscalRecord: record,
    config
  });

  assert.strictEqual(record.huella.hash, hashBefore, 'Huella inalterada');
  assert.strictEqual(record.xmlOficial, xmlBefore, 'XML inalterado');
  assert.strictEqual(record.qr.url, qrBefore, 'QR inalterado');
  assert.strictEqual(Object.isFrozen(record), true, 'FiscalRecord debe seguir congelado');
  assert.strictEqual(sub2.numeroIntento, 2);
  assert.strictEqual(sub2.estado, 'PENDING');
});

await runTest('Test 19: FiscalSubmission registra exhaustivamente todos los metadatos de auditoría', async () => {
  const { record, config } = createSampleSealedRecord('B12345678');
  const sub = createFiscalSubmission(record, config);

  const result = await executeAeatSubmission({
    submission: sub,
    fiscalRecord: record,
    config,
    options: { transportMode: 'mock', mockScenario: 'ACCEPTANCE', mockTiempoEsperaEnvio: 180 }
  });

  assert.ok(result.submission.id.startsWith('fsub-'));
  assert.strictEqual(result.submission.fiscalRecordId, record.id);
  assert.strictEqual(result.submission.obligadoTributarioId, record.obligadoTributarioId);
  assert.strictEqual(result.submission.numeroFactura, record.factura.numeroFactura);
  assert.strictEqual(result.submission.estado, 'ACCEPTED');
  assert.strictEqual(result.submission.numeroIntento, 1);
  assert.strictEqual(result.submission.tiempoEsperaEnvio, 180);
  assert.ok(result.submission.fechaEnvio);
  assert.ok(result.submission.fechaRespuesta);
  assert.ok(result.submission.completadoEn);
  assert.ok(result.submission.csv?.startsWith('CSV-'), 'CSV válido emitido por la AEAT');
  assert.ok(result.submission.xmlRespuesta?.includes('RespuestaRegFactuSistemaFacturacion'));
  assert.ok(typeof result.submission.tiempoRespuestaMs === 'number');
});

console.log('================================================================');
console.log(`  RESUMEN FASE 3.1.2: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO! `);
console.log('================================================================');
