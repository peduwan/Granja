/**
 * SUITE DE VALIDACIÓN E INTEGRACIÓN CON EL EMULADOR DE FIRESTORE
 *
 * Validación exhaustiva y determinista sobre Firestore real (emulado con el jar oficial de Google):
 * 1. Emisión concurrente de dos facturas del mismo obligado tributario (OCC y serialización atómica).
 * 2. Idempotencia distribuida entre instancias independientes con pérdidas de respuesta en fases críticas:
 *    - Pérdida de respuesta tras reservar el número rectificativo (estado RESERVED).
 *    - Pérdida de respuesta tras persistir el FiscalRecord en Firestore (antes de marcar COMPLETED).
 *    - Reintento antes y después de marcar la operación como COMPLETED.
 * 3. Verificación de que NUNCA se generan dos FiscalRecord para una misma operación y que los reintentos
 *    devuelven el mismo FiscalRecord y el mismo número asignado.
 * 4. Verificación de coherencia relacional entre `fiscal_emission_operations`, `fiscal_chain_state`
 *    y `fiscal_records`.
 * 5. Verificación de reglas de seguridad de Firestore (`firestore.rules`):
 *    - Backend con cuenta de servicio/admin tiene acceso a `fiscal_emission_operations` y demás colecciones.
 *    - Clientes web SDK tienen RECHAZO TOTAL (403 / permission-denied) en escrituras directas.
 */

import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import { CloudDistributedChainCoordinator } from '../src/fiscal/cloudDistributedChainCoordinator';
import { emitFiscalInvoice, resetFiscalQueue } from '../src/fiscal/emissionService';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { Factura } from '../src/types';

const EMULATOR_PORT = process.env.FIRESTORE_EMULATOR_PORT
  ? parseInt(process.env.FIRESTORE_EMULATOR_PORT, 10)
  : (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST.includes(':')
      ? parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1], 10)
      : 8089);
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || `127.0.0.1:${EMULATOR_PORT}`;
const OBLIGADO_NIF_TEST = 'B12345678';
const OBLIGADO_NIF_CONCURRENTE = 'B98765432';

let emulatorProcess: ChildProcess | null = null;
let emulatorWasAlreadyRunning = false;

function findEmulatorJar(): string | null {
  if (process.env.FIRESTORE_EMULATOR_JAR && fs.existsSync(process.env.FIRESTORE_EMULATOR_JAR)) {
    return process.env.FIRESTORE_EMULATOR_JAR;
  }
  const candidateDirs = [
    path.join(process.env.HOME || '/root', '.cache', 'firebase', 'emulators'),
    '/root/.cache/firebase/emulators',
    path.join(process.cwd(), '.firebase', 'emulators')
  ];
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        const jarFile = files.find((f) => f.startsWith('cloud-firestore-emulator-') && f.endsWith('.jar'));
        if (jarFile) return path.join(dir, jarFile);
      } catch {}
    }
  }

  // Si no está en caché, intentar descargarlo automáticamente con firebase CLI si está disponible
  try {
    console.log('Descargando emulador oficial de Firestore mediante Firebase CLI...');
    const { execSync } = require('node:child_process');
    execSync('firebase setup:emulators:firestore || npx firebase setup:emulators:firestore', { stdio: 'inherit' });
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        const jarFile = files.find((f) => f.startsWith('cloud-firestore-emulator-') && f.endsWith('.jar'));
        if (jarFile) return path.join(dir, jarFile);
      }
    }
  } catch (err: any) {
    console.warn('No se pudo descargar automáticamente el emulador de Firestore:', err.message);
  }

  return null;
}

function checkEmulatorHttp(): Promise<boolean> {
  return new Promise((resolve) => {
    const [host, portStr] = EMULATOR_HOST.split(':');
    const port = parseInt(portStr || '8089', 10);
    const req = http.get({ host, port, path: '/' }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForEmulatorReady(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      const ok = await checkEmulatorHttp();
      if (ok) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout (${timeoutMs}ms) esperando a que arranque el emulador de Firestore en ${EMULATOR_HOST}`));
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

export async function startFirestoreEmulator(): Promise<void> {
  const alreadyUp = await checkEmulatorHttp();
  if (alreadyUp) {
    emulatorWasAlreadyRunning = true;
    console.log(`✓ Emulador detectado ya en ejecución en http://${EMULATOR_HOST}`);
    return;
  }

  const jarPath = findEmulatorJar();
  if (!jarPath) {
    throw new Error(
      `No se encontró el jar del emulador de Firestore. Configure FIRESTORE_EMULATOR_JAR o inicie el emulador externamente en ${EMULATOR_HOST}`
    );
  }

  console.log(`Iniciando emulador desde jar: ${jarPath} en puerto ${EMULATOR_PORT}...`);
  emulatorProcess = spawn(
    'java',
    [
      '-jar',
      jarPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(EMULATOR_PORT),
      '--rules',
      path.resolve(process.cwd(), 'firestore.rules')
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  emulatorProcess.on('error', (err) => {
    console.error('Error lanzando proceso java del emulador:', err);
  });

  await waitForEmulatorReady();
}

export function stopFirestoreEmulator(): void {
  if (emulatorProcess && !emulatorWasAlreadyRunning) {
    try {
      emulatorProcess.kill('SIGTERM');
    } catch {}
    emulatorProcess = null;
  }
}

function createDummyInvoice(numFactura: string, idSuffix?: string): Factura {
  const uid = idSuffix || Math.random().toString(36).slice(2, 7);
  return {
    id: `fac-test-${Date.now()}-${uid}`,
    numeroFactura: numFactura,
    fecha: '2026-03-15',
    clienteId: 'cli-firestore-01',
    clienteNombre: 'Avícola San Jerónimo S.L.',
    clienteCif: 'B99999999',
    clienteDireccion: 'Camino Real 10',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-01',
        loteEnvasadoId: 'lot-01',
        codigoLoteEnvasado: 'L-2026-FST',
        formatoId: 'fmt-01',
        nombreFormato: 'Docena Huevos Camperos',
        cantidadEstuches: 10,
        precioUnitario: 3.5,
        subtotal: 35.0,
        fechaConsumoPreferente: '2026-04-15',
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
    creadoEn: '2026-03-15T10:00:00Z'
  };
}

function createDummyRectificativa(originalFac: Factura, idSuffix?: string, emisorNif = OBLIGADO_NIF_TEST): Factura {
  const uid = idSuffix || Math.random().toString(36).slice(2, 7);
  return {
    id: `rect-test-${Date.now()}-${uid}`,
    numeroFactura: 'AUTO',
    fecha: '2026-03-16',
    clienteId: originalFac.clienteId,
    clienteNombre: originalFac.clienteNombre,
    clienteCif: originalFac.clienteCif,
    clienteDireccion: originalFac.clienteDireccion,
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'R1',
    esRectificativa: true,
    facturasRectificadas: [
      {
        idEmisorFactura: emisorNif,
        numeroFactura: originalFac.numeroFactura,
        fechaExpedicion: originalFac.fecha
      }
    ],
    motivoRectificativa: '01',
    tipoRectificativa: 'I',
    lineas: [
      {
        id: 'lin-r01',
        loteEnvasadoId: 'lot-01',
        codigoLoteEnvasado: 'L-2026-FST',
        formatoId: 'fmt-01',
        nombreFormato: 'Abono Parcial Docena',
        cantidadEstuches: -2,
        precioUnitario: 3.5,
        subtotal: -7.0,
        fechaConsumoPreferente: '2026-04-15',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: -7.0,
      porcentajeIva: 4,
      cuotaIva: -0.28,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: -7.28
    },
    formaPago: 'transferencia',
    estadoPago: 'pendiente',
    esVentaDirecta: true,
    creadoEn: '2026-03-16T10:00:00Z'
  };
}

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         Error: ${err.message || err}`);
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log('  INICIANDO EMULADOR OFICIAL DE FIRESTORE CON firestore.rules   ');
  console.log('================================================================');

  await startFirestoreEmulator();
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  process.env.FISCAL_COORDINATOR_MODE = 'firestore';
  console.log(`✓ Emulador activo en http://${EMULATOR_HOST}`);

  const config = createDefaultFiscalConfiguration({
    nif: OBLIGADO_NIF_TEST,
    nombreRazon: 'Granja San Jerónimo S.L.'
  });

  const configConcurrente = createDefaultFiscalConfiguration({
    nif: OBLIGADO_NIF_CONCURRENTE,
    nombreRazon: 'Explotaciones Avícolas del Sur S.A.'
  });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: REGLAS DE SEGURIDAD (firestore.rules) EN CLIENTE VS BACKEND
    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 1: VERIFICACIÓN DE REGLAS DE SEGURIDAD EN EMULADOR ---');
    await runTest('1.1: Cliente Web SDK es RECHAZADO con PERMISSION_DENIED en escrituras en colecciones fiscales', async () => {
      const app = initializeApp({ projectId: 'generated-creek-65p7n', apiKey: 'fake-test-key' }, 'client-rules-test');
      const clientDb = getFirestore(app);
      connectFirestoreEmulator(clientDb, '127.0.0.1', EMULATOR_PORT);

      const collectionsToTest = [
        'fiscal_records',
        'fiscal_chain_state',
        'fiscal_submissions',
        'fiscal_events',
        'aeat_flow_control',
        'aeat_send_locks',
        'fiscal_emission_operations'
      ];

      for (const colName of collectionsToTest) {
        await assert.rejects(
          async () => {
            await setDoc(doc(clientDb, colName, 'malicious-client-doc'), { hacked: true });
          },
          (err: any) => {
            return (
              err.code === 'permission-denied' ||
              String(err.message).includes('PERMISSION_DENIED') ||
              String(err.message).includes('false for')
            );
          },
          `La colección /${colName} debe rechazar escrituras directas del cliente`
        );
      }
    });

    await runTest('1.2: Backend Custody con Admin SDK tiene permisos completos en colecciones fiscales', async () => {
      await CloudDistributedChainCoordinator.resetEmulatorCloudState();
      const state = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_NIF_TEST);
      assert.strictEqual(state, null, 'El estado inicial debe ser null');
    });

    // -------------------------------------------------------------------------
    // TEST 2: DOS EMISIONES CONCURRENTES DEL MISMO OBLIGADO TRIBUTARIO EN FIRESTORE
    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 2: EMISIONES CONCURRENTES DEL MISMO OBLIGADO EN FIRESTORE ---');
    await runTest('2.1: Dos emisiones concurrentes desde instancias independientes serializan sin forks', async () => {
      await CloudDistributedChainCoordinator.resetEmulatorCloudState();
      BackendFiscalCustody.resetCustody();
      resetFiscalQueue();

      const invA = createDummyInvoice('FAC-CONC-01', 'inst-A');
      const invB = createDummyInvoice('FAC-CONC-02', 'inst-B');

      // Simular dos instancias Cloud Run independientes emitiendo simultáneamente contra Firestore
      const promiseA = emitFiscalInvoice({
        invoiceDraft: invA,
        fiscalConfig: configConcurrente,
        _simulateIndependentCloudRunInstance: true
      });

      const promiseB = emitFiscalInvoice({
        invoiceDraft: invB,
        fiscalConfig: configConcurrente,
        _simulateIndependentCloudRunInstance: true
      });

      const [resA, resB] = await Promise.all([promiseA, promiseB]);

      assert.ok(resA.fiscalRecord && resB.fiscalRecord);
      assert.notStrictEqual(resA.fiscalRecord.id, resB.fiscalRecord.id);
      assert.notStrictEqual(resA.fiscalRecord.huella.hash, resB.fiscalRecord.huella.hash);

      // Comprobar estado final en Firestore
      const finalState = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_NIF_CONCURRENTE);
      assert.ok(finalState);
      assert.strictEqual(finalState.totalRecords, 2);
      assert.strictEqual(finalState.sequence, 2);

      // Comprobar que los registros forman una cadena continua sin bifurcación
      const records = await CloudDistributedChainCoordinator.getRecordsByObligado(OBLIGADO_NIF_CONCURRENTE);
      assert.strictEqual(records.length, 2);

      const genesis = records.find(r => r.encadenamiento.primerRegistro);
      const successor = records.find(r => !r.encadenamiento.primerRegistro);
      assert.ok(genesis, 'Debe existir registro génesis');
      assert.ok(successor, 'Debe existir registro sucesor');
      assert.strictEqual(successor.encadenamiento.registroAnterior?.huella, genesis.huella.hash);
      assert.strictEqual(finalState.latestHuella, successor.huella.hash);
    });

    // -------------------------------------------------------------------------
    // TEST 3: IDEMPOTENCIA DISTRIBUIDA Y RECUPERACIÓN ANTE FALLOS SIMULADOS
    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 3: IDEMPOTENCIA TRAS PÉRDIDA DE RESPUESTA EN PUNTOS CRÍTICOS ---');

    let baseInvoice: Factura;
    await runTest('Preparar factura base para pruebas rectificativas', async () => {
      await CloudDistributedChainCoordinator.resetEmulatorCloudState();
      BackendFiscalCustody.resetCustody();
      resetFiscalQueue();

      const invBase = createDummyInvoice('FAC-BASE-01');
      const resBase = await emitFiscalInvoice({
        invoiceDraft: invBase,
        fiscalConfig: config
      });
      baseInvoice = resBase.invoice;
      assert.ok(baseInvoice.fiscalRecordId);
    });

    await runTest('3.1: Fallo tras reservar número rectificativo: reintento recupera el mismo número y no crea duplicados', async () => {
      const stableOpKey = 'OP-IDEMP-FALLO-POST-RESERVA-001';
      const rectDraft = createDummyRectificativa(baseInvoice, 'draft-falla-1');

      // 1. Simular Instancia 1: reserva el número pero la instancia cae/aborta ANTES de persistir el registro
      const reservedNumber = await CloudDistributedChainCoordinator.reserveNextRectificativaNumberForOperation({
        operationKey: stableOpKey,
        obligadoId: OBLIGADO_NIF_TEST,
        invoiceId: rectDraft.id,
        fechaIsoOrAeat: rectDraft.fecha
      });

      assert.match(reservedNumber, /^R-2026-\d{4}$/);

      // Verificar que la operación quedó en Firestore en estado RESERVED
      const opBefore = await CloudDistributedChainCoordinator.getEmissionOperation(stableOpKey, OBLIGADO_NIF_TEST);
      assert.ok(opBefore);
      assert.strictEqual(opBefore.status, 'RESERVED');
      assert.strictEqual(opBefore.reservedNumeroFactura, reservedNumber);

      // Comprobar que NO se ha creado ningún FiscalRecord todavía
      const recordsBefore = await CloudDistributedChainCoordinator.getRecordsByObligado(OBLIGADO_NIF_TEST);
      assert.strictEqual(recordsBefore.length, 1, 'Solo debe existir la factura base');

      // 2. Simular Instancia 2 (independiente, con memoria vacía): reintenta la operación con la misma clave
      BackendFiscalCustody.clearLocalReplicaCacheForInstanceSimulation();

      const resRetry = await emitFiscalInvoice({
        invoiceDraft: {
          ...rectDraft,
          id: rectDraft.id
        },
        operationKey: stableOpKey,
        fiscalConfig: config,
        _simulateIndependentCloudRunInstance: true
      });

      // Debe haber reutilizado exactamente el número reservado
      assert.strictEqual(resRetry.fiscalRecord.factura.numeroFactura, reservedNumber);
      assert.strictEqual(resRetry.invoice.numeroFactura, reservedNumber);

      // En Firestore, la operación debe haberse consolidado como COMPLETED
      const opAfter = await CloudDistributedChainCoordinator.getEmissionOperation(stableOpKey, OBLIGADO_NIF_TEST);
      assert.ok(opAfter);
      assert.strictEqual(opAfter.status, 'COMPLETED');
      assert.strictEqual(opAfter.assignedNumeroFactura, reservedNumber);
      assert.strictEqual(opAfter.fiscalRecordId, resRetry.fiscalRecord.id);

      // Y solo debe existir 1 registro rectificativo en fiscal_records
      const recordsAfter = await CloudDistributedChainCoordinator.getRecordsByObligado(OBLIGADO_NIF_TEST);
      assert.strictEqual(recordsAfter.length, 2, 'Debe haber exactamente 2 registros: base + rectificativa');
    });

    await runTest('3.2: Fallo tras persistir FiscalRecord antes de marcar COMPLETED: reintento recupera el resultado exacto sin nuevo registro', async () => {
      const stableOpKey = 'OP-IDEMP-FALLO-PRE-COMPLETED-002';
      const rectDraft = createDummyRectificativa(baseInvoice, 'draft-falla-2');

      // 1. Instancia 1: emite con gancho interceptor que lanza excepción DESPUÉS de guardar en Firestore
      // pero antes de que la función retorne al cliente o de marcar COMPLETED
      let savedRecordId: string | null = null;
      let reservedNum: string | null = null;

      try {
        await emitFiscalInvoice({
          invoiceDraft: rectDraft,
          operationKey: stableOpKey,
          fiscalConfig: config,
          _simulateIndependentCloudRunInstance: true,
          persistRecordFn: async (rec) => {
            savedRecordId = rec.id;
            reservedNum = rec.factura.numeroFactura;
            await BackendFiscalCustody.saveFiscalRecord(rec);
            // Simular pérdida catastrófica de conexión/red justo tras persistir en Firestore
            throw new Error('SIMULATED_NETWORK_DROP_AFTER_FIRESTORE_RECORD_COMMIT');
          }
        });
        assert.fail('Debería haber lanzado la excepción simulada');
      } catch (err: any) {
        assert.strictEqual(err.message, 'SIMULATED_NETWORK_DROP_AFTER_FIRESTORE_RECORD_COMMIT');
      }

      // Verificar estado en Firestore: el registro existe, la operación quedó en RESERVED
      assert.ok(savedRecordId);
      const recordInFirestore = await CloudDistributedChainCoordinator.getRecordById(savedRecordId);
      assert.ok(recordInFirestore, 'El registro fiscal debe estar presente en Firestore');

      const opDoc = await CloudDistributedChainCoordinator.getEmissionOperation(stableOpKey, OBLIGADO_NIF_TEST);
      assert.ok(opDoc);
      assert.strictEqual(opDoc.status, 'RESERVED');

      // 2. Instancia 2: reintenta la misma llamada (mismo operationKey o mismo invoiceDraft.id)
      BackendFiscalCustody.clearLocalReplicaCacheForInstanceSimulation();

      const resRecovery = await emitFiscalInvoice({
        invoiceDraft: rectDraft,
        operationKey: stableOpKey,
        fiscalConfig: config,
        _simulateIndependentCloudRunInstance: true
      });

      // El reintento debe recuperar el registro existente sin reasignar ni crear uno nuevo
      assert.strictEqual(resRecovery.fiscalRecord.id, savedRecordId);
      assert.strictEqual(resRecovery.fiscalRecord.factura.numeroFactura, reservedNum);
      assert.strictEqual(resRecovery.invoice.fiscalRecordId, savedRecordId);

      // Ahora la operación debe estar COMPLETED vinculada al mismo registro
      const opRecovered = await CloudDistributedChainCoordinator.getEmissionOperation(stableOpKey, OBLIGADO_NIF_TEST);
      assert.ok(opRecovered);
      assert.strictEqual(opRecovered.status, 'COMPLETED');
      assert.strictEqual(opRecovered.fiscalRecordId, savedRecordId);

      // Total de registros para el obligado: 3 (base + rectificativa 1 + rectificativa 2)
      const allRecords = await CloudDistributedChainCoordinator.getRecordsByObligado(OBLIGADO_NIF_TEST);
      assert.strictEqual(allRecords.length, 3, 'No debe haberse duplicado ningún registro');
    });

    await runTest('3.3: Reintento posterior con estado COMPLETED devuelve idéntico resultado sin mutar contadores ni cadena', async () => {
      const stableOpKey = 'OP-IDEMP-FALLO-PRE-COMPLETED-002'; // Clave ya completada
      const rectDraft = createDummyRectificativa(baseInvoice, 'draft-falla-2');

      const stateBefore = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_NIF_TEST);
      assert.ok(stateBefore);

      // Simular una tercera instancia que vuelve a invocar la emisión
      BackendFiscalCustody.clearLocalReplicaCacheForInstanceSimulation();

      const resThird = await emitFiscalInvoice({
        invoiceDraft: rectDraft,
        operationKey: stableOpKey,
        fiscalConfig: config,
        _simulateIndependentCloudRunInstance: true
      });

      const stateAfter = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_NIF_TEST);
      assert.ok(stateAfter);

      // Ningún contador ni secuencia debe haber variado
      assert.strictEqual(stateAfter.sequence, stateBefore.sequence);
      assert.strictEqual(stateAfter.totalRecords, stateBefore.totalRecords);
      assert.strictEqual(stateAfter.latestHuella, stateBefore.latestHuella);

      const allRecords = await CloudDistributedChainCoordinator.getRecordsByObligado(OBLIGADO_NIF_TEST);
      assert.strictEqual(allRecords.length, 3);
    });

    await runTest('3.4: Aislamiento multi-inquilino: Obligado A y B usan idéntica clave relativa sin colisión de documentos ni números', async () => {
      const sharedRelativeKey = 'OP-SHARED-CROSS-TENANT';

      // Factura base para Obligado B
      const baseDraftB = createDummyInvoice('FAC-2026-B-BASE', 'b-base');
      const resBaseB = await emitFiscalInvoice({
        invoiceDraft: baseDraftB,
        fiscalConfig: configConcurrente,
        _simulateIndependentCloudRunInstance: true
      });
      assert.ok(resBaseB.invoice.fiscalRecordId);

      const rectDraftA = createDummyRectificativa(baseInvoice, 'draft-iso-a');
      const rectDraftB = createDummyRectificativa(resBaseB.invoice, 'draft-iso-b', OBLIGADO_NIF_CONCURRENTE);

      // 1. Obligado A reserva con la clave compartida
      const reservedA = await CloudDistributedChainCoordinator.reserveNextRectificativaNumberForOperation({
        operationKey: sharedRelativeKey,
        obligadoId: OBLIGADO_NIF_TEST,
        invoiceId: rectDraftA.id,
        fechaIsoOrAeat: rectDraftA.fecha
      });

      // 2. Obligado B reserva con la misma clave compartida
      const reservedB = await CloudDistributedChainCoordinator.reserveNextRectificativaNumberForOperation({
        operationKey: sharedRelativeKey,
        obligadoId: OBLIGADO_NIF_CONCURRENTE,
        invoiceId: rectDraftB.id,
        fechaIsoOrAeat: rectDraftB.fecha
      });

      // 3. Verificar que ambas reservas son independientes y existen como documentos distintos
      const opDocA = await CloudDistributedChainCoordinator.getEmissionOperation(sharedRelativeKey, OBLIGADO_NIF_TEST);
      const opDocB = await CloudDistributedChainCoordinator.getEmissionOperation(sharedRelativeKey, OBLIGADO_NIF_CONCURRENTE);

      assert.ok(opDocA);
      assert.ok(opDocB);
      assert.strictEqual(opDocA.operationKey, `${OBLIGADO_NIF_TEST}:${sharedRelativeKey}`);
      assert.strictEqual(opDocB.operationKey, `${OBLIGADO_NIF_CONCURRENTE}:${sharedRelativeKey}`);
      assert.strictEqual(opDocA.obligadoTributarioId, OBLIGADO_NIF_TEST);
      assert.strictEqual(opDocB.obligadoTributarioId, OBLIGADO_NIF_CONCURRENTE);
      assert.strictEqual(opDocA.reservedNumeroFactura, reservedA);
      assert.strictEqual(opDocB.reservedNumeroFactura, reservedB);

      // 4. Completar emisiones de ambos obligados
      const resEmittedA = await emitFiscalInvoice({
        invoiceDraft: rectDraftA,
        operationKey: sharedRelativeKey,
        fiscalConfig: config,
        _simulateIndependentCloudRunInstance: true
      });

      const resEmittedB = await emitFiscalInvoice({
        invoiceDraft: rectDraftB,
        operationKey: sharedRelativeKey,
        fiscalConfig: configConcurrente,
        _simulateIndependentCloudRunInstance: true
      });

      assert.strictEqual(resEmittedA.fiscalRecord.factura.numeroFactura, reservedA);
      assert.strictEqual(resEmittedB.fiscalRecord.factura.numeroFactura, reservedB);
      assert.notStrictEqual(resEmittedA.fiscalRecord.id, resEmittedB.fiscalRecord.id);

      // Comprobar que en Firestore las operaciones se completaron de forma aislada
      const completedDocA = await CloudDistributedChainCoordinator.getEmissionOperation(sharedRelativeKey, OBLIGADO_NIF_TEST);
      const completedDocB = await CloudDistributedChainCoordinator.getEmissionOperation(sharedRelativeKey, OBLIGADO_NIF_CONCURRENTE);
      assert.strictEqual(completedDocA?.status, 'COMPLETED');
      assert.strictEqual(completedDocB?.status, 'COMPLETED');
      assert.strictEqual(completedDocA?.fiscalRecordId, resEmittedA.fiscalRecord.id);
      assert.strictEqual(completedDocB?.fiscalRecordId, resEmittedB.fiscalRecord.id);
    });

    await runTest('3.5: Prevención de spoofing: Obligado A intenta usar clave con prefijo de Obligado B -> RECHAZADO tajantemente', async () => {
      const spoofedKey = `${OBLIGADO_NIF_CONCURRENTE}:OP-ATTACK-001`;
      const rectDraftA = createDummyRectificativa(baseInvoice, 'draft-spoof');

      // Intentar reservar con prefijo discrepante
      await assert.rejects(
        async () => {
          await CloudDistributedChainCoordinator.reserveNextRectificativaNumberForOperation({
            operationKey: spoofedKey,
            obligadoId: OBLIGADO_NIF_TEST,
            invoiceId: rectDraftA.id,
            fechaIsoOrAeat: rectDraftA.fecha
          });
        },
        (err: any) => {
          return (
            err.message.includes('Violación de aislamiento multi-inquilino') ||
            err.message.includes('no coincide con el obligado emisor autenticado')
          );
        }
      );

      // Intentar emitir pasando la clave spoofed
      await assert.rejects(
        async () => {
          await emitFiscalInvoice({
            invoiceDraft: rectDraftA,
            operationKey: spoofedKey,
            fiscalConfig: config,
            _simulateIndependentCloudRunInstance: true
          });
        },
        (err: any) => {
          return (
            err.message.includes('Violación de aislamiento multi-inquilino') ||
            err.message.includes('no coincide con el obligado emisor autenticado')
          );
        }
      );

      // Comprobar que NUNCA se creó el documento para el obligado usurpado
      const shouldNotExist = await CloudDistributedChainCoordinator.getEmissionOperation(
        spoofedKey,
        OBLIGADO_NIF_CONCURRENTE
      );
      assert.strictEqual(shouldNotExist, null);
    });

    // -------------------------------------------------------------------------
    // TEST 4: COHERENCIA RELACIONAL TRAS FALLOS
    // -------------------------------------------------------------------------
    console.log('\n--- PRUEBA 4: COHERENCIA RELACIONAL ENTRE COLECCIONES EN FIRESTORE ---');
    await runTest('4.1: fiscal_emission_operations, fiscal_chain_state y fiscal_records son consistentes al 100%', async () => {
      const state = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_NIF_TEST);
      assert.ok(state);

      const records = await CloudDistributedChainCoordinator.getRecordsByObligado(OBLIGADO_NIF_TEST);
      assert.strictEqual(records.length, state.totalRecords);
      assert.strictEqual(records.length, state.sequence);

      // Reconstruir y validar la cadena criptográfica
      const ordered = BackendFiscalCustody.orderRecordsByFiscalChain(records);
      assert.strictEqual(ordered.length, records.length);
      assert.strictEqual(ordered[ordered.length - 1].huella.hash, state.latestHuella);

      // Verificar que todas las operaciones COMPLETED apuntan a un FiscalRecord real
      const op1 = await CloudDistributedChainCoordinator.getEmissionOperation('OP-IDEMP-FALLO-POST-RESERVA-001', OBLIGADO_NIF_TEST);
      assert.ok(op1 && op1.status === 'COMPLETED');
      const rec1 = records.find(r => r.id === op1.fiscalRecordId);
      assert.ok(rec1, 'El registro de op1 debe existir');
      assert.strictEqual(rec1.factura.numeroFactura, op1.assignedNumeroFactura);

      const op2 = await CloudDistributedChainCoordinator.getEmissionOperation('OP-IDEMP-FALLO-PRE-COMPLETED-002', OBLIGADO_NIF_TEST);
      assert.ok(op2 && op2.status === 'COMPLETED');
      const rec2 = records.find(r => r.id === op2.fiscalRecordId);
      assert.ok(rec2, 'El registro de op2 debe existir');
      assert.strictEqual(rec2.factura.numeroFactura, op2.assignedNumeroFactura);
    });

    console.log('\n================================================================');
    console.log('  VALIDACIÓN COMPLETA CON EL EMULADOR DE FIRESTORE SUPERADA!    ');
    console.log('================================================================');
  } finally {
    console.log('\nCerrando emulador de Firestore...');
    stopFirestoreEmulator();
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('firestore_emulator_integration.test.ts') ||
    process.argv[1].endsWith('firestore_emulator_integration.test'))
) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nERROR EN SUITE DE INTEGRACIÓN CON FIRESTORE:', err);
      stopFirestoreEmulator();
      process.exit(1);
    });
}
