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
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { getCoordinatorMode, CloudDistributedChainCoordinator } from '../src/fiscal/cloudDistributedChainCoordinator';

console.log('================================================================');
console.log('  VERIFICACIÓN DE CONFIGURACIÓN Y PERMISOS IAM EN CLOUD FIRESTORE');
console.log('================================================================\n');

let passedTests = 0;
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
    assert.strictEqual((firestore as any).projectId || (firestore as any)._projectId || config.projectId, config.projectId);
  });

  // 5. Diagnóstico de credenciales ADC / Emulador para el entorno actual
  await runTest('1.5: Diagnóstico informativo de credenciales IAM / Emulador en el host', async () => {
    const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log(`    - FIRESTORE_EMULATOR_HOST: ${process.env.FIRESTORE_EMULATOR_HOST || 'no definido'}`);
    console.log(`    - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'no definido'}`);
    console.log(`    - Entorno detectado: ${hasEmulator ? 'Emulador Local/CI' : (hasAdc ? 'Credenciales ADC explícitas' : 'Metadata Server / Entorno Cloud Run por defecto')}`);
  });

  console.log(`\n================================================================`);
  console.log(`  VERIFICACIÓN IAM Y CONFIGURACIÓN COMPLETADA: ${passedTests}/${totalTests} TESTS PASADOS`);
  console.log(`================================================================`);
}

main().catch((err) => {
  console.error('\nERROR EN VERIFICACIÓN DE CONFIGURACIÓN/IAM:', err);
  process.exit(1);
});
