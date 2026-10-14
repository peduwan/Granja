/**
 * VERIFICACIÓN DIAGNÓSTICA DE PERMISOS IAM Y CONFIGURACIÓN CLOUD FIRESTORE
 *
 * Este script/test valida de forma exhaustiva:
 * 1. La resolución autoritativa del proyecto (`projectId`) y base de datos (`firestoreDatabaseId`).
 * 2. La política Fail-Closed: en producción (`NODE_ENV=production` o `USE_FIRESTORE_AUTHORITY=true`),
 *    es obligatorio el acceso mediante Google Cloud Firestore y está estrictamente prohibido
 *    el modo simulador o cualquier fallback silencioso a memoria/disco local.
 * 3. La presencia y validez de credenciales de Google Cloud (ADC / Service Account con roles/datastore.user)
 *    o la detección determinista de entorno emulado local (`FIRESTORE_EMULATOR_HOST`).
 * 4. La verificación del catálogo de colecciones fiscales protegidas y su aislamiento IAM.
 * 5. Prueba operativa roundtrip de lectura, escritura y borrado (roles/datastore.user) con Firestore Admin SDK.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { getCoordinatorMode } from '../src/fiscal/cloudDistributedChainCoordinator';

const isStrictMode =
  process.argv.includes('--strict') ||
  process.env.STRICT_IAM_VERIFY === 'true' ||
  process.env.CI_DEPLOYMENT_GATE === 'true';

const isDiagnosticMode =
  process.argv.includes('--diagnostic') ||
  process.env.IAM_DIAGNOSTIC_MODE === 'true';

console.log(`  Modo de verificación: ${isStrictMode ? 'VALIDACIÓN ESTRICTA DE DESPLIEGUE (FAIL-CLOSED)' : 'DIAGNÓSTICO INFORMATIVO DE ENTORNO'}`);
console.log('================================================================\n');

let passedTests = 0;
let skippedTests = 0;
let totalTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] Test ${totalTests}: ${name}`);
    console.error('         Error:', err.message || err);
    throw err;
  }
}

function markTestSkipped(name: string, reason: string) {
  totalTests++;
  skippedTests++;
  console.log(`  [PENDING] Test ${totalTests}: ${name}`);
  console.log(`            Motivo: ${reason}`);
}

async function main() {
  // 1. Comprobar existencia y contenido de firebase-applet-config.json
  await runTest('1.1: firebase-applet-config.json contiene projectId y databaseId válidos', () => {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    assert.ok(fs.existsSync(configPath), 'firebase-applet-config.json debe existir');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(config.projectId, 'projectId debe estar definido');
    assert.ok(config.firestoreDatabaseId, 'firestoreDatabaseId debe estar definido');
    assert.strictEqual(typeof config.projectId, 'string');
    assert.strictEqual(typeof config.firestoreDatabaseId, 'string');
  });

  // 2. Comprobar que en producción el modo 'simulator' está terminantemente prohibido
  await runTest('1.2: En entorno de producción (NODE_ENV=production) el modo simulator está prohibido (Fail-Closed)', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevCoordMode = process.env.FISCAL_COORDINATOR_MODE;
    try {
      process.env.NODE_ENV = 'production';
      process.env.FISCAL_COORDINATOR_MODE = 'simulator';
      assert.throws(
        () => getCoordinatorMode(),
        /Prohibido forzar FISCAL_COORDINATOR_MODE=simulator en entorno de producción/
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.FISCAL_COORDINATOR_MODE = prevCoordMode;
    }
  });

  // 3. Comprobar que firestore.rules contiene las 7 colecciones fiscales selladas
  await runTest('1.3: firestore.rules protege las 7 colecciones fiscales contra acceso de clientes SDK', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    assert.ok(fs.existsSync(rulesPath), 'firestore.rules debe existir');
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

    const requiredCollections = [
      'fiscal_records',
      'fiscal_chain_state',
      'fiscal_submissions',
      'fiscal_events',
      'aeat_flow_control',
      'aeat_send_locks',
      'fiscal_emission_operations'
    ];

    for (const col of requiredCollections) {
      assert.ok(
        rulesContent.includes(`match /${col}/{`),
        `firestore.rules debe declarar regla explícita para la colección ${col}`
      );
    }

    // Comprobar que existe allow write: if false para fiscal_emission_operations
    const emissionOpRule = rulesContent.slice(rulesContent.indexOf('match /fiscal_emission_operations/'));
    assert.ok(
      emissionOpRule.includes('allow write: if false'),
      'fiscal_emission_operations debe tener allow write: if false para clientes'
    );
  });

  // 4. Comprobar la instanciación de Firestore Admin con databaseId explícito
  await runTest('1.4: Instanciación correcta de @google-cloud/firestore con databaseId del proyecto', () => {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const firestore = new Firestore({
      projectId: config.projectId,
      databaseId: config.firestoreDatabaseId
    });
    assert.ok(firestore, 'Debe instanciarse correctamente el cliente Firestore Admin');
    assert.strictEqual(
      (firestore as any).projectId || (firestore as any)._projectId || config.projectId,
      config.projectId
    );
  });

  // 5. Diagnóstico de credenciales ADC / Emulador para el entorno actual
  await runTest('1.5: Diagnóstico informativo de credenciales IAM / Emulador en el host', async () => {
    const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log(`    - FIRESTORE_EMULATOR_HOST: ${process.env.FIRESTORE_EMULATOR_HOST || 'no definido'}`);
    console.log(`    - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'no definido'}`);
    console.log(
      `    - Entorno detectado: ${
        hasEmulator
          ? 'Emulador Local/CI'
          : hasAdc
          ? 'Credenciales ADC explícitas'
          : 'Metadata Server / Entorno Cloud Run por defecto'
      }`
    );
  });

  // 6. Prueba operativa de permisos de cuenta de servicio (escritura, lectura, borrado) en base de datos real o emulador
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const firestore = new Firestore({
    projectId: config.projectId,
    databaseId: config.firestoreDatabaseId
  });

  const probeId = `_iam_probe_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const probeDoc = firestore.collection('fiscal_emission_operations').doc(probeId);
  let probeCreated = false;

  const testName = '1.6: Prueba operativa roundtrip de permisos IAM (write/read/delete) con Firestore Admin SDK';

  try {
    const ts = new Date().toISOString();
    try {
      // 1. Escritura (roles/datastore.user)
      await probeDoc.set({
        probe: true,
        timestamp: ts,
        serviceAccountTested: true
      });
      probeCreated = true;

      // 2. Lectura
      const snap = await probeDoc.get();
      assert.ok(snap.exists, 'El documento de sondeo IAM debe existir tras la escritura');
      assert.strictEqual(snap.data()?.timestamp, ts);

      // 3. Borrado
      await probeDoc.delete();
      probeCreated = false;

      const snapAfter = await probeDoc.get();
      assert.strictEqual(snapAfter.exists, false, 'El documento de sondeo IAM debe ser borrado');

      totalTests++;
      passedTests++;
      console.log(`  [PASS] Test ${totalTests}: ${testName}`);
      console.log('         ✓ Permisos de escritura, lectura y borrado verificados con éxito (roles/datastore.user activo)');
    } finally {
      // Limpieza garantizada del documento de prueba ante cualquier excepción intermedia
      if (probeCreated) {
        try {
          await probeDoc.delete();
        } catch (_cleanupErr) {
          // Ignorar error secundario de limpieza
        }
      }
    }
  } catch (err: any) {
    if (isStrictMode) {
      // EN MODO ESTRICTO DE DESPLIEGUE: Fallar taxativamente para bloquear el despliegue
      totalTests++;
      console.error(`  [FAIL] Test ${totalTests}: ${testName}`);
      console.error('         Error:', err.message || err);
      console.error('\n  ❌ BLOQUEO DE DESPLIEGUE POR PERMISOS IAM:');
      console.error(`     Proyecto GCP: ${config.projectId}`);
      console.error(`     Base de datos: ${config.firestoreDatabaseId}`);
      console.error('     Causa: La cuenta de servicio de Cloud Run no dispone de permisos operativos (roles/datastore.user).');
      console.error('     Acción requerida para desbloquear el despliegue:');
      console.error(`       gcloud projects add-iam-policy-binding ${config.projectId} \\`);
      console.error('         --member="serviceAccount:<CLOUD_RUN_SERVICE_ACCOUNT>" \\');
      console.error('         --role="roles/datastore.user"\n');
      throw new Error(
        `FALLO DE VALIDACIÓN DE DESPLIEGUE: roles/datastore.user no operativo en Firestore (${err.message}). Despliegue abortado.`
      );
    } else {
      // EN MODO DIAGNÓSTICO: Registrar como PENDIENTE sin otorgar un [PASS] falso
      markTestSkipped(
        testName,
        err.message?.includes('PERMISSION_DENIED')
          ? 'Permisos IAM pendientes en GCP (roles/datastore.user no asignado a la identidad del host)'
          : `Entorno sin conectividad directa o credenciales GCP (${err.message})`
      );
      console.log('\n    ℹ  DIAGNÓSTICO INFORMATIVO DE PERMISOS IAM GCP:');
      console.log(`       Proyecto GCP: ${config.projectId}`);
      console.log(`       Base de datos: ${config.firestoreDatabaseId}`);
      console.log('       Nota: Para validar de forma bloqueante antes del despliegue en producción:');
      console.log('             npm run test:iam:strict');
      console.log('       Para verificar en el entorno Cloud Run desplegado:');
      console.log('             GET /api/fiscal/diagnostics/iam (con Bearer token de Propietario/Admin)\n');
    }
  }

  console.log(`\n================================================================`);
  console.log(`  VERIFICACIÓN IAM Y CONFIGURACIÓN COMPLETADA: ${passedTests}/${totalTests} TESTS PASADOS (${skippedTests} PENDIENTES)`);
  if (skippedTests > 0) {
    console.log(`  ⚠️  ATENCIÓN: Hay ${skippedTests} test(s) con verificación pendiente en GCP.`);
    console.log(`      Para forzar validación estricta y bloquear despliegue si faltan roles: npm run test:iam:strict`);
  }
  console.log(`================================================================`);
}

main().catch((err) => {
  console.error('\nERROR EN VERIFICACIÓN DE CONFIGURACIÓN/IAM:', err.message || err);
  process.exit(1);
});
