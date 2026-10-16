/**
 * SUITE DE TESTS - FASE 2: REMEDIACIÓN DE ALTA PRIORIDAD (A1 - A5)
 * Normativa: RD 1007/2023, Orden HAC/1177/2024, Ley 11/2021
 * Ejecución directa: npx tsx tests/remediacion_fase2_alta_prioridad.test.ts
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getServerConfig,
  getRootOwnerEmail,
  isValidEmail,
  ROOT_OWNER_EMAIL,
  DEFAULT_ROOT_OWNER_EMAIL
} from '../src/config/serverConfig';
import {
  getMadridTimezoneOffset,
  formatDateTimeMadrid,
  formatFechaHoraHusoGenRegistro
} from '../src/fiscal/hashService';
import {
  validateEmisorTenantCoherence,
  registerFarmEmisorProfile,
  getFarmEmisorProfile,
  clearRegisteredEmisorProfiles
} from '../src/fiscal/tenantEmisorService';
import { getSifIdentityConfig } from '../src/config/sifIdentity';
import { migratePendingLocalRecordsToFirestore } from '../src/fiscal/cloudMigrationService';

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
  console.log('========================================================================');
  console.log('  EJECUTANDO SUITE DE TESTS — FASE 2: ALTA PRIORIDAD (A1 - A5)');
  console.log('========================================================================');

  // ==========================================
  // A5: SERVERCONFIG AISLADO Y VALIDACIÓN ROOT OWNER
  // ==========================================
  console.log('\n--- A5: serverConfig.ts Aislado y Validación ROOT_OWNER_EMAIL ---');

  await runTest('A5.1: serverConfig se importa y provee email por defecto de propietario raíz', () => {
    assert.strictEqual(DEFAULT_ROOT_OWNER_EMAIL, 'peduwan@gmail.com');
    assert.strictEqual(ROOT_OWNER_EMAIL, 'peduwan@gmail.com');
    const cfg = getServerConfig();
    assert.strictEqual(cfg.rootOwnerEmail, 'peduwan@gmail.com');
    assert.strictEqual(typeof cfg.port, 'number');
  });

  await runTest('A5.2: Validador de correo electrónico (isValidEmail)', () => {
    assert.strictEqual(isValidEmail('peduwan@gmail.com'), true);
    assert.strictEqual(isValidEmail('admin.avicola@granja-valle.es'), true);
    assert.strictEqual(isValidEmail(''), false);
    assert.strictEqual(isValidEmail('invalido'), false);
    assert.strictEqual(isValidEmail('@nodomain.com'), false);
    assert.strictEqual(isValidEmail('user@'), false);
    assert.strictEqual(isValidEmail(null), false);
    assert.strictEqual(isValidEmail(undefined), false);
  });

  await runTest('A5.3: getRootOwnerEmail lee y valida variable de entorno normalizada', () => {
    const oldEnv = process.env.ROOT_OWNER_EMAIL;
    try {
      process.env.ROOT_OWNER_EMAIL = '  Administrador@Granja.ES  ';
      const email = getRootOwnerEmail();
      assert.strictEqual(email, 'administrador@granja.es');

      process.env.ROOT_OWNER_EMAIL = 'correo_invalido';
      assert.throws(() => {
        getRootOwnerEmail();
      }, /ROOT_OWNER_EMAIL inválido en variables de entorno/);
    } finally {
      if (oldEnv !== undefined) {
        process.env.ROOT_OWNER_EMAIL = oldEnv;
      } else {
        delete process.env.ROOT_OWNER_EMAIL;
      }
    }
  });

  // ==========================================
  // A3: TIMEZONE EUROPE/MADRID DETERMINISTA
  // ==========================================
  console.log('\n--- A3: Timezone Europe/Madrid Robusta e Independiente del Host ---');

  await runTest('A3.1: Fecha de control 15 de enero (CET / Invierno) -> Offset exacto +01:00', () => {
    // 15 de enero a las 12:00:00 UTC
    const winterUtcDate = new Date('2026-01-15T12:00:00.000Z');
    const offset = getMadridTimezoneOffset(winterUtcDate);
    assert.strictEqual(offset, '+01:00', `El offset en enero debe ser +01:00 y se obtuvo '${offset}'`);

    const formatted = formatDateTimeMadrid(winterUtcDate);
    // En Madrid, 12:00 UTC son las 13:00 CET
    assert.strictEqual(formatted, '2026-01-15T13:00:00+01:00');
  });

  await runTest('A3.2: Fecha de control 15 de julio (CEST / Verano / DST) -> Offset exacto +02:00', () => {
    // 15 de julio a las 12:00:00 UTC
    const summerUtcDate = new Date('2026-07-15T12:00:00.000Z');
    const offset = getMadridTimezoneOffset(summerUtcDate);
    assert.strictEqual(offset, '+02:00', `El offset en julio debe ser +02:00 y se obtuvo '${offset}'`);

    const formatted = formatDateTimeMadrid(summerUtcDate);
    // En Madrid, 12:00 UTC son las 14:00 CEST
    assert.strictEqual(formatted, '2026-07-15T14:00:00+02:00');
  });

  await runTest('A3.3: formatFechaHoraHusoGenRegistro produce cadena AEAT con huso Madrid', () => {
    const winterDate = new Date('2026-01-15T10:30:45.000Z');
    const result = formatFechaHoraHusoGenRegistro(winterDate);
    assert.match(result, /^2026-01-15T11:30:45\+01:00$/);

    const summerDate = new Date('2026-07-15T10:30:45.000Z');
    const resultSummer = formatFechaHoraHusoGenRegistro(summerDate);
    assert.match(resultSummer, /^2026-07-15T12:30:45\+02:00$/);
  });

  // ==========================================
  // A1: SEPARACIÓN SIF VS EMISOR Y VALIDACIÓN 400
  // ==========================================
  console.log('\n--- A1: Separación SIF vs Emisor y Validación de Discrepancia ---');

  await runTest('A1.1: SIF del desarrollador se mantiene estrictamente independiente del emisor', () => {
    const sifConfig = getSifIdentityConfig();
    assert.ok(sifConfig.nif, 'SIF_NIF del desarrollador debe estar definido');
    assert.ok(sifConfig.nombreRazon, 'SIF_NOMBRE_RAZON del desarrollador debe estar definido');

    // Registrar perfil oficial para una explotación agrícola
    clearRegisteredEmisorProfiles();
    registerFarmEmisorProfile({
      nif: 'A12345674',
      nombreRazon: 'Avícola Valle Hermoso S.A.'
    });

    const retrieved = getFarmEmisorProfile('A12345674');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.nombreRazon, 'Avícola Valle Hermoso S.A.');
  });

  await runTest('A1.2: Acepta emisión cuando la razón social coincide con el perfil registrado', () => {
    clearRegisteredEmisorProfiles();
    registerFarmEmisorProfile({
      nif: 'A12345674',
      nombreRazon: 'Avícola Valle Hermoso S.A.'
    });

    const result = validateEmisorTenantCoherence({
      nif: 'A12345674',
      clientNombreRazon: '  Avícola Valle Hermoso S.A.  '
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.resolvedNombreRazon, 'Avícola Valle Hermoso S.A.');
  });

  await runTest('A1.3: Rechaza con "Discrepancia en la razón social del emisor" ante divergencias', () => {
    clearRegisteredEmisorProfiles();
    registerFarmEmisorProfile({
      nif: 'A12345674',
      nombreRazon: 'Avícola Valle Hermoso S.A.'
    });

    const result = validateEmisorTenantCoherence({
      nif: 'A12345674',
      clientNombreRazon: 'Granja Falsa Pirata S.L.'
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Discrepancia en la razón social del emisor');
  });

  await runTest('A1.4: Valida contra expectedNombreRazon proporcionado dinámicamente', () => {
    const result = validateEmisorTenantCoherence({
      nif: 'B98765432',
      clientNombreRazon: 'Granja Los Pinos S.L.',
      expectedNombreRazon: 'Avícola Los Montes S.A.'
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Discrepancia en la razón social del emisor');
  });

  // ==========================================
  // A2: FIRESTORE RULES: AISLAMIENTO MULTI-TENANT
  // ==========================================
  console.log('\n--- A2: Firestore Security Rules: Aislamiento Real Multi-Tenant ---');

  await runTest('A2.1: Reglas de Firestore definen pertenencia por granja y aislamiento estricto', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    assert.ok(fs.existsSync(rulesPath), 'firestore.rules debe existir');
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

    // 1. isOwner() exige peduwan@gmail.com y email_verified == true
    assert.match(rulesContent, /request\.auth\.token\.email\.lower\(\)\s*==\s*'peduwan@gmail\.com'/);
    assert.match(rulesContent, /request\.auth\.token\.email_verified\s*==\s*true/);

    // 2. isFarmMember comprueba members y ownerEmail
    assert.match(rulesContent, /function isFarmMember/);
    assert.match(rulesContent, /request\.auth\.token\.email\.lower\(\)\s*in\s*farmData\.members/);
    assert.match(rulesContent, /request\.auth\.token\.email\.lower\(\)\s*==\s*farmData\.ownerEmail\.lower\(\)/);

    // 3. /farms/{farmId} protegido por isFarmMember
    assert.match(rulesContent, /match\s+\/farms\/\{farmId\}/);
    assert.match(rulesContent, /isFarmMember\(resource\.data\)/);

    // 4. /authorized_users/{userEmail} solo legible por el propio usuario o isOwner
    assert.match(rulesContent, /match\s+\/authorized_users\/\{userEmail\}/);
    assert.match(rulesContent, /request\.auth\.token\.email\.lower\(\)\s*==\s*userEmail\.lower\(\)/);

    // 5. /users/{userId} solo legible y escribible por el propio usuario o isOwner
    assert.match(rulesContent, /match\s+\/users\/\{userId\}/);
    assert.match(rulesContent, /request\.auth\.uid\s*==\s*userId/);

    // 6. /fiscal_records/{recordId} y /fiscal_chain_state/{obligadoId} bloquean escritura y aíslan lectura por granja
    assert.match(rulesContent, /match\s+\/fiscal_records\/\{recordId\}/);
    assert.match(rulesContent, /isMemberOfObligado\(resource\.data\.obligadoTributarioId\)/);
    assert.match(rulesContent, /allow write:\s*if false;/);

    assert.match(rulesContent, /match\s+\/fiscal_chain_state\/\{obligadoId\}/);
    assert.match(rulesContent, /isMemberOfObligado\(obligadoId\)/);
  });

  // ==========================================
  // A4: CUSTODIA CLOUD RUN: FAIL-CLOSED Y MIGRACIÓN
  // ==========================================
  console.log('\n--- A4: Custodia Cloud Run: Fail-Closed y Migración al Arranque ---');

  await runTest('A4.1: Rutina de migración previa inspecciona y procesa registros locales', async () => {
    const summary = await migratePendingLocalRecordsToFirestore();
    assert.ok(typeof summary.inspected === 'number');
    assert.ok(typeof summary.migrated === 'number');
    assert.ok(typeof summary.alreadySynced === 'number');
  });

  await runTest('A4.2: Política Fail-Closed: Prohíbe modo simulator en entorno de producción', async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldFiscalMode = process.env.FISCAL_COORDINATOR_MODE;
    try {
      process.env.NODE_ENV = 'production';
      process.env.FISCAL_COORDINATOR_MODE = 'simulator';

      const { getCoordinatorMode } = await import('../src/fiscal/cloudDistributedChainCoordinator');
      assert.throws(() => {
        getCoordinatorMode();
      }, /Prohibido forzar FISCAL_COORDINATOR_MODE=simulator en entorno de producción/);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldFiscalMode !== undefined) {
        process.env.FISCAL_COORDINATOR_MODE = oldFiscalMode;
      } else {
        delete process.env.FISCAL_COORDINATOR_MODE;
      }
    }
  });

  console.log('========================================================================');
  console.log('  RESULTADO SUITE FASE 2 (A1-A5): TODOS LOS TESTS SUPERADOS CON ÉXITO');
  console.log('========================================================================');
}

main().catch(err => {
  console.error('\n*** ERROR FATAL EN LA EJECUCIÓN DE LA SUITE FASE 2 ***\n', err);
  process.exit(1);
});
