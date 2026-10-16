/**
 * SUITE DE TESTS - FASE 3: MEDIA PRIORIDAD (M1 - M5)
 * Normativa: RD 1007/2023, Orden HAC/1177/2024, Ley 11/2021
 * Ejecución directa: npx tsx tests/remediacion_fase3_media_prioridad.test.ts
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import firebaseConfig from '../firebase-applet-config.json';
import {
  requireFiscalAuthMiddleware,
  registerTestPublicKey,
  clearTestAuthTokens,
  isValidSpanishNifCifNie,
  ROOT_OWNER_EMAIL
} from '../src/fiscal/backendAuth';
import {
  getSifIdentityConfig,
  setTestSifIdentityConfig,
  SIF_DEFAULT_FECHA_ACTIVACION
} from '../src/config/sifIdentity';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { MockAeatTransport } from '../src/fiscal/mockAeatTransport';
import { getDefaultFiscalConfig } from '../src/utils/storage';
import { runSecurityAudit } from '../scripts/verify-security-config';

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
  console.log('  EJECUTANDO SUITE DE TESTS — FASE 3: MEDIA PRIORIDAD (M1 - M5)');
  console.log('========================================================================');

  // Par de claves RSA para pruebas de middleware de autenticación
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const testKid = 'test-kid-fase3';

  function createSignedTestToken(payloadOverrides?: Record<string, any>): string {
    registerTestPublicKey(testKid, publicKey);
    const header = { alg: 'RS256', kid: testKid, typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'test-user-fase3',
      user_id: 'test-user-fase3',
      email: ROOT_OWNER_EMAIL,
      email_verified: true,
      auth_time: now,
      iat: now,
      exp: now + 3600,
      ...payloadOverrides
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const dataToSign = `${headerB64}.${payloadB64}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(dataToSign);
    const signature = signer.sign(privateKey, 'base64url');
    return `${dataToSign}.${signature}`;
  }

  // ==========================================
  // M1: PROTECCIÓN DE /api/fiscal/cert-status
  // ==========================================
  console.log('\n--- M1: Protección de /api/fiscal/cert-status con requireFiscalAuthMiddleware ---');

  await runTest('M1.1: requireFiscalAuthMiddleware rechaza peticiones anónimas a cert-status con 401', async () => {
    let statusCode = 0;
    let jsonBody: any = null;
    let nextCalled = false;

    const req: any = {
      headers: {},
      ip: '127.0.0.1'
    };
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (b: any) => { jsonBody = b; }
        };
      }
    };
    const next = () => { nextCalled = true; };

    await requireFiscalAuthMiddleware(req, res, next);
    assert.strictEqual(statusCode, 401, 'Debe devolver HTTP 401');
    assert.strictEqual(nextCalled, false, 'No debe llamar a next()');
    assert.match(jsonBody.error, /Bearer requerido/i);
  });

  await runTest('M1.2: requireFiscalAuthMiddleware permite acceso a cert-status con token Bearer válido', async () => {
    const token = createSignedTestToken();
    let nextCalled = false;
    let statusCode = 0;

    const req: any = {
      headers: {
        authorization: `Bearer ${token}`
      },
      ip: '127.0.0.1'
    };
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: () => {}
        };
      }
    };
    const next = () => { nextCalled = true; };

    await requireFiscalAuthMiddleware(req, res, next);
    assert.strictEqual(nextCalled, true, 'Debe permitir el paso llamando a next()');
    assert.strictEqual(statusCode, 0);
    assert.ok(req.fiscalUser);
    assert.strictEqual(req.fiscalUser.email, ROOT_OWNER_EMAIL);
  });

  // ==========================================
  // M2: INMUTABILIDAD SIF_FECHA_ACTIVACION
  // ==========================================
  console.log('\n--- M2: Inmutabilidad y Control de SIF_FECHA_ACTIVACION ---');

  await runTest('M2.1: En no-producción, provee valor constante por defecto (2026-01-01T00:00:00Z)', () => {
    const oldEnv = { ...process.env };
    try {
      delete process.env.SIF_FECHA_ACTIVACION;
      process.env.NODE_ENV = 'development';
      setTestSifIdentityConfig(null);

      const sifConfig = getSifIdentityConfig();
      assert.strictEqual(sifConfig.fechaActivacion, SIF_DEFAULT_FECHA_ACTIVACION);
    } finally {
      process.env = oldEnv;
    }
  });

  await runTest('M2.2: En producción, lanza error fatal si falta SIF_FECHA_ACTIVACION', () => {
    const oldEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.SIF_NIF = 'A12345674';
      process.env.SIF_NOMBRE_RAZON = 'AGROTECH S.L.';
      process.env.SIF_INSTALACION_ID = 'INST-01';
      delete process.env.SIF_FECHA_ACTIVACION;
      setTestSifIdentityConfig(null);

      assert.throws(() => {
        getSifIdentityConfig();
      }, /SIF_FECHA_ACTIVACION obligatoria no configurada en producción/);
    } finally {
      process.env = oldEnv;
    }
  });

  await runTest('M2.3: En producción, acepta timestamp ISO válido y lo normaliza', () => {
    const oldEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.SIF_NIF = 'A12345674';
      process.env.SIF_NOMBRE_RAZON = 'AGROTECH S.L.';
      process.env.SIF_INSTALACION_ID = 'INST-01';
      process.env.SIF_FECHA_ACTIVACION = '2026-03-15T08:00:00.000Z';
      setTestSifIdentityConfig(null);

      const sifConfig = getSifIdentityConfig();
      assert.strictEqual(sifConfig.fechaActivacion, '2026-03-15T08:00:00.000Z');
    } finally {
      process.env = oldEnv;
    }
  });

  await runTest('M2.4: createDefaultFiscalConfiguration propaga la fecha de activación del SIF', () => {
    setTestSifIdentityConfig(null);
    const cfg = createDefaultFiscalConfiguration({
      nif: 'A12345674',
      nombreRazon: 'Explotación Avícola Test'
    });
    assert.ok(cfg.fechaActivacion);
    assert.strictEqual(cfg.fechaActivacion, getSifIdentityConfig().fechaActivacion);
  });

  // ==========================================
  // M3: ERRADICACIÓN DE CIFS DE PRUEBA
  // ==========================================
  console.log('\n--- M3: Erradicación de CIFs de Prueba (B45123987 y B12345678) ---');

  await runTest('M3.1: isValidSpanishNifCifNie rechaza taxativamente B45123987 y B12345678', () => {
    assert.strictEqual(isValidSpanishNifCifNie('B45123987'), false);
    assert.strictEqual(isValidSpanishNifCifNie('B12345678'), false);
    assert.strictEqual(isValidSpanishNifCifNie('ES_UNKNOWN'), false);
    assert.strictEqual(isValidSpanishNifCifNie('A12345674'), true);
  });

  await runTest('M3.2: MockAeatTransport rechaza NIF de prueba B12345678 o B45123987', () => {
    assert.throws(() => {
      MockAeatTransport.generateMockResponseBody('ACCEPTANCE', {
        nifEmisor: 'B12345678'
      });
    }, /CIF de prueba ficticio/);

    assert.throws(() => {
      MockAeatTransport.generateMockResponseBody('ACCEPTANCE', {
        nifEmisor: 'B45123987'
      });
    }, /CIF de prueba ficticio/);
  });

  await runTest('M3.3: getDefaultFiscalConfig() no inyecta CIF ficticio por defecto', () => {
    const config = getDefaultFiscalConfig();
    assert.strictEqual(config.nifEmisor, '');
    assert.strictEqual(config.obligadoTributarioId, '');
  });

  // ==========================================
  // M4 & M5: AUDITORÍA ACTIVA DE SEGURIDAD
  // ==========================================
  console.log('\n--- M4 & M5: Auditoría Activa de Seguridad y Restricción GCP ---');

  await runTest('M4.1: runSecurityAudit ejecuta batería completa y aprueba configuración limpia', () => {
    setTestSifIdentityConfig(null);
    const report = runSecurityAudit();
    assert.ok(report.totalChecks >= 8);
    assert.strictEqual(report.failedChecks, 0);
    assert.strictEqual(report.isReadyForProduction, true);
  });

  await runTest('M4.2: runSecurityAudit detecta y suspende si se expone VITE_GEMINI_API_KEY', () => {
    const oldKey = process.env.VITE_GEMINI_API_KEY;
    try {
      process.env.VITE_GEMINI_API_KEY = 'AIzaSy_EXPOSED_CLIENT_KEY';
      const report = runSecurityAudit();
      const check = report.checks.find(c => c.id === 'SEC-KEY-01');
      assert.ok(check);
      assert.strictEqual(check.passed, false);
      assert.strictEqual(report.isReadyForProduction, false);
    } finally {
      if (oldKey !== undefined) {
        process.env.VITE_GEMINI_API_KEY = oldKey;
      } else {
        delete process.env.VITE_GEMINI_API_KEY;
      }
    }
  });

  console.log('========================================================================');
  console.log('  RESULTADO SUITE FASE 3 (M1-M5): TODOS LOS TESTS SUPERADOS CON ÉXITO');
  console.log('========================================================================');
}

main().catch(err => {
  console.error('\n*** ERROR FATAL EN LA EJECUCIÓN DE LA SUITE FASE 3 ***\n', err);
  process.exit(1);
});
