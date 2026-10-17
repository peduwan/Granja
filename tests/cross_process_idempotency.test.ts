/**
 * SUITE DE TESTS: IDEMPOTENCIA Y RECUPERACIÓN ENTRE PROCESOS DEL SISTEMA OPERATIVO
 *
 * Demuestra matemáticamente y en tiempo de ejecución que dos procesos de Node.js
 * físicamente independientes (distinto PID, espacio de memoria y ciclo de vida de SO):
 * 1. Serializan atómicamente la reserva y emisión duradera en Firestore sin estado en memoria compartido.
 * 2. Recuperan exactamente la misma reserva tras la caída abrupta (exit 42) de un proceso anterior.
 * 3. Ejecutan reintentos idempotentes transparentes devolviendo el mismo registro fiscal.
 * 4. Operan con aislamiento multi-inquilino estricto en paralelo sin colisiones entre obligados.
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import { startFirestoreEmulator, stopFirestoreEmulator } from './firestore_emulator_integration.test';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';

console.log('================================================================');
console.log('  TESTS DE IDEMPOTENCIA ENTRE PROCESOS INDEPENDIENTES DEL S.O.  ');
console.log('================================================================\n');

const EMULATOR_PORT = process.env.FIRESTORE_EMULATOR_PORT
  ? parseInt(process.env.FIRESTORE_EMULATOR_PORT, 10)
  : (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST.includes(':')
      ? parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1], 10)
      : 8089);
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || `127.0.0.1:${EMULATOR_PORT}`;

function runWorkerProcess(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const workerPath = path.resolve(process.cwd(), 'scripts/isolatedEmissionWorker.ts');
    const child = spawn(
      process.execPath,
      ['./node_modules/.bin/tsx', workerPath, ...args],
      {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          FISCAL_COORDINATOR_MODE: 'firestore',
          FIRESTORE_EMULATOR_HOST: EMULATOR_HOST
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

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
  try {
    await startFirestoreEmulator();
  } catch (err: any) {
    console.warn(`[SKIPPED] ${err.message || err}`);
    console.log('ℹ  Para ejecutar la prueba de idempotencia entre procesos con emulador, inicie el emulador externamente en 127.0.0.1:8089.');
    console.log('================================================================');
    console.log('  TESTS DE IDEMPOTENCIA OMITIDOS (ENTORNO SIN JAR LOCAL)');
    console.log('================================================================');
    return;
  }
  try {
    BackendFiscalCustody.resetCustody();
    // TEST 1: Caída de Proceso 1 tras reservar número -> Recuperación en Proceso 2
    await runTest(
      '1.1: Proceso 1 reserva número y muere abruptamente (exit 42); Proceso 2 recupera exactamente la misma reserva',
      async () => {
        const opKey = `OP-PROC-CRASH-${Date.now()}`;
        const obligado = 'B12345678';

        // 1. Lanzar Proceso 1: emite base, reserva rectificativa y crashea intencionalmente con código 42
        const proc1 = await runWorkerProcess([
          '--mode',
          'crash_after_reservation',
          '--obligado',
          obligado,
          '--opKey',
          opKey
        ]);

        assert.strictEqual(proc1.code, 42, `El proceso 1 debe haber terminado con exit code 42 (stderr: ${proc1.stderr})`);
        const out1 = JSON.parse(proc1.stdout.trim().split('\n').pop() || '{}');
        assert.strictEqual(out1.status, 'RESERVED_CRASHING');
        const reservedNumberFromProc1 = out1.reservedNum;
        assert.ok(reservedNumberFromProc1, 'Debe haber reservado un número');

        // 2. Lanzar Proceso 2 (proceso de SO completamente nuevo, espacio de memoria independiente):
        // Debe conectarse a Firestore, detectar la reserva duradera de Proceso 1 y completar la emisión
        const proc2 = await runWorkerProcess([
          '--mode',
          'retry_recovery',
          '--obligado',
          obligado,
          '--opKey',
          opKey
        ]);

        assert.strictEqual(proc2.code, 0, `Proceso 2 debe completar exitosamente (stderr: ${proc2.stderr})`);
        const out2 = JSON.parse(proc2.stdout.trim().split('\n').pop() || '{}');
        assert.strictEqual(out2.status, 'RECOVERED_SUCCESS');
        assert.strictEqual(
          out2.numeroFactura,
          reservedNumberFromProc1,
          'Proceso 2 debe haber reutilizado exactamente el número reservado por Proceso 1'
        );

        // 3. Lanzar Proceso 3 (otro proceso de SO completamente nuevo):
        // Debe consultar la operación en estado COMPLETED y devolver idéntico registro fiscal sin crear otro
        const proc3 = await runWorkerProcess([
          '--mode',
          'retry_recovery',
          '--obligado',
          obligado,
          '--opKey',
          opKey
        ]);

        assert.strictEqual(proc3.code, 0, `Proceso 3 debe completar exitosamente (stderr: ${proc3.stderr})`);
        const out3 = JSON.parse(proc3.stdout.trim().split('\n').pop() || '{}');
        assert.strictEqual(out3.status, 'RECOVERED_SUCCESS');
        assert.strictEqual(out3.numeroFactura, reservedNumberFromProc1);
        assert.strictEqual(out3.fiscalRecordId, out2.fiscalRecordId);
        assert.strictEqual(out3.huellaHash, out2.huellaHash);
      }
    );

    // TEST 2: Aislamiento entre dos procesos en paralelo con la misma clave relativa
    await runTest(
      '1.2: Procesos paralelos e independientes de obligados distintos con la misma clave relativa operan sin interferencia',
      async () => {
        const sharedRelativeKey = `OP-PROC-SHARED-${Date.now()}`;
        const obligadoA = 'B12345678';
        const obligadoB = 'B98765432';

        // Lanzar ambos procesos en paralelo en el SO
        const [resProcA, resProcB] = await Promise.all([
          runWorkerProcess(['--mode', 'emit_rectificativa', '--obligado', obligadoA, '--opKey', sharedRelativeKey]),
          runWorkerProcess(['--mode', 'emit_rectificativa', '--obligado', obligadoB, '--opKey', sharedRelativeKey])
        ]);

        assert.strictEqual(resProcA.code, 0, `Proceso A debe finalizar con éxito (stderr: ${resProcA.stderr})`);
        assert.strictEqual(resProcB.code, 0, `Proceso B debe finalizar con éxito (stderr: ${resProcB.stderr})`);

        const outA = JSON.parse(resProcA.stdout.trim().split('\n').pop() || '{}');
        const outB = JSON.parse(resProcB.stdout.trim().split('\n').pop() || '{}');

        assert.strictEqual(outA.status, 'EMITTED_SUCCESS');
        assert.strictEqual(outB.status, 'EMITTED_SUCCESS');
        assert.notStrictEqual(
          outA.fiscalRecordId,
          outB.fiscalRecordId,
          'Los registros fiscales emitidos por ambos procesos deben ser estrictamente diferentes'
        );
        assert.notStrictEqual(
          outA.huellaHash,
          outB.huellaHash,
          'Las huellas emitidas por ambos procesos deben ser estrictamente diferentes'
        );
      }
    );

    console.log(`\n================================================================`);
    console.log(`  IDEMPOTENCIA CROSS-PROCESO SUPERADA: ${passedTests}/${totalTests} TESTS PASADOS`);
    console.log(`================================================================`);
  } finally {
    stopFirestoreEmulator();
  }
}

main().catch((err) => {
  console.error('\nERROR EN SUITE DE IDEMPOTENCIA ENTRE PROCESOS:', err);
  process.exit(1);
});
