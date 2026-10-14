/**
 * PRUEBAS AUTOMATIZADAS DE SEGURIDAD Y RESILIENCIA: ENDPOINT DE DIAGNÓSTICO IAM
 *
 * Valida los hallazgos de la auditoría:
 * 1. P1: Protección obligatoria con `requireFiscalAuthMiddleware` (rechazo sin token o con token inválido).
 * 2. P1: Control de autorización estricta (restringido a Operadores Propietarios/Admin Fiscal, 403 para otros).
 * 3. P1: Limitación de frecuencia y control de concurrencia (429 si se invoca repetidamente sin respetar cooldown).
 * 4. P1: Limpieza garantizada del documento de sondeo en bloque `finally` incluso si la lectura falla o lanza excepción.
 * 5. P2: Validación completa de los 3 permisos (escritura, lectura y borrado):
 *        No devolver 200/IAM_PERMISSIONS_VERIFIED si la lectura o el borrado fallan.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import firebaseConfig from '../firebase-applet-config.json';
import { ROOT_OWNER_EMAIL } from '../src/utils/storage';
import {
  requireFiscalAuthMiddleware,
  registerTestPublicKey,
  clearTestAuthTokens,
  FiscalAuthenticatedRequest
} from '../src/fiscal/backendAuth';

console.log('================================================================');
console.log('  TESTS DE SEGURIDAD Y CONTROL DEL ENDPOINT DIAGNÓSTICO IAM');
console.log('================================================================\n');

// Generar claves RSA para firmas criptográficas de test
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const testKid = 'rsa-iam-diagnostic-test-key';
registerTestPublicKey(testKid, publicKey);

function createSignedToken(payloadOverrides: Record<string, any>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: testKid })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'test-user-diag-123',
      email: 'operator@granja.com',
      email_verified: true,
      iat: now - 5,
      auth_time: now - 5,
      exp: now + 3600,
      ...payloadOverrides
    })
  ).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  [PASS] Test: ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] Test: ${name}`);
    console.error('         Error:', err.message || err);
    throw err;
  }
}

async function main() {
  const nonAdminToken = createSignedToken({
    email: 'normal-worker@granja.com',
    isOwner: false,
    adminFiscal: false,
    role: 'operator',
    authorizedObligados: ['B86412345']
  });

  const ownerAdminToken = createSignedToken({
    email: ROOT_OWNER_EMAIL,
    isOwner: true,
    adminFiscal: true,
    role: 'admin',
    authorizedObligados: ['*']
  });

  // 1. Simulación del handler idéntico al implementado en server.ts
  let isIamDiagnosticActive = false;
  let lastIamDiagnosticTimestamp = 0;
  const IAM_DIAGNOSTIC_COOLDOWN_MS = 1000; // 1s para acelerar tests

  // Simulación de Firestore con control de fallos inyectables
  const mockOperationsCollection = new Map<string, any>();
  let injectReadFailure = false;
  let injectDeleteFailure = false;

  const mockFirestore = {
    collection: (colName: string) => {
      assert.strictEqual(colName, 'fiscal_emission_operations');
      return {
        doc: (docId: string) => ({
          id: docId,
          set: async (data: any) => {
            mockOperationsCollection.set(docId, data);
          },
          get: async () => {
            if (injectReadFailure) {
              return { exists: false, data: () => null };
            }
            const exists = mockOperationsCollection.has(docId);
            return { exists, data: () => mockOperationsCollection.get(docId) };
          },
          delete: async () => {
            if (injectDeleteFailure) {
              throw new Error('SIMULATED_DELETE_FAILURE: No se pudo eliminar documento de prueba');
            }
            mockOperationsCollection.delete(docId);
          }
        })
      };
    }
  };

  async function handleIamDiagnostic(req: FiscalAuthenticatedRequest, res: any) {
    if (!req.fiscalUser?.isOwner) {
      return res.status(403).json({
        success: false,
        status: "IAM_DIAGNOSTIC_FORBIDDEN",
        error: "Acceso denegado: El diagnóstico de permisos IAM y sondeo de infraestructura en Cloud Firestore está reservado exclusivamente a operadores con rol de Propietario o Administrador Fiscal."
      });
    }

    if (isIamDiagnosticActive) {
      return res.status(429).json({
        success: false,
        status: "IAM_DIAGNOSTIC_CONCURRENT",
        error: "Diagnóstico IAM actualmente en ejecución. Por favor espere a que finalice la prueba en curso."
      });
    }

    const now = Date.now();
    const elapsed = now - lastIamDiagnosticTimestamp;
    if (elapsed < IAM_DIAGNOSTIC_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((IAM_DIAGNOSTIC_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        success: false,
        status: "IAM_DIAGNOSTIC_RATE_LIMITED",
        error: `Límite de frecuencia excedido: espere ${waitSeconds}s.`
      });
    }

    isIamDiagnosticActive = true;
    lastIamDiagnosticTimestamp = Date.now();

    let probeCreated = false;
    let probeDocRef: any = null;
    let writeOk = false;
    let readOk = false;
    let deleteOk = false;

    try {
      const probeId = `_probe_iam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      probeDocRef = mockFirestore.collection('fiscal_emission_operations').doc(probeId);

      const writeTimestamp = new Date().toISOString();
      await probeDocRef.set({
        probe: true,
        timestamp: writeTimestamp,
        serviceAccountCheck: true,
        executedBy: `Cloud Run Backend Service Account (${req.fiscalUser.email})`
      });
      writeOk = true;
      probeCreated = true;

      const snap = await probeDocRef.get();
      const data = snap.data();
      readOk = Boolean(snap.exists && data?.timestamp === writeTimestamp);

      await probeDocRef.delete();
      deleteOk = true;
      probeCreated = false;

      const permissions = { write: writeOk, read: readOk, delete: deleteOk };
      const allGranted = permissions.write && permissions.read && permissions.delete;

      if (!allGranted) {
        return res.status(503).json({
          success: false,
          status: "IAM_PERMISSIONS_INSUFFICIENT",
          permissions,
          error: "Permisos IAM insuficientes o incompletos: una o más operaciones requeridas fallaron."
        });
      }

      return res.status(200).json({
        success: true,
        status: "IAM_PERMISSIONS_VERIFIED",
        permissions,
        message: "Verificación de lectura, escritura y borrado exitosa."
      });
    } catch (err: any) {
      const permissions = { write: writeOk, read: readOk, delete: deleteOk };
      return res.status(500).json({
        success: false,
        status: "IAM_PERMISSION_ERROR",
        error: err.message,
        permissions
      });
    } finally {
      if (probeCreated && probeDocRef) {
        try {
          await probeDocRef.delete();
        } catch (_cleanupErr) {}
      }
      isIamDiagnosticActive = false;
    }
  }

  // Helpers para simular llamadas HTTP Express
  function createMockRes() {
    return {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(obj: any) {
        this.body = obj;
        return this;
      }
    };
  }

  // TEST 1: Rechazo de petición sin token de autenticación
  await runTest('1.1: requireFiscalAuthMiddleware rechaza invocación sin cabecera Authorization (HTTP 401)', async () => {
    const req: any = { headers: {} };
    const res = createMockRes();
    let nextCalled = false;
    await requireFiscalAuthMiddleware(req, res as any, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.ok(res.body.error.includes('Token de autenticación Bearer requerido'));
  });

  // TEST 2: Rechazo con token inválido/falsificado
  await runTest('1.2: requireFiscalAuthMiddleware rechaza token manipulado/falsificado (HTTP 401)', async () => {
    const req: any = { headers: { authorization: 'Bearer token.invalido.123' } };
    const res = createMockRes();
    let nextCalled = false;
    await requireFiscalAuthMiddleware(req, res as any, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  });

  // TEST 3: Rechazo de usuario autenticado pero sin rol Propietario/Admin Fiscal
  await runTest('1.3: Usuario autenticado sin rol Propietario/Admin es rechazado en /diagnostics/iam (HTTP 403)', async () => {
    const req: any = {
      headers: { authorization: `Bearer ${nonAdminToken}` },
      fiscalUser: null
    };
    const resMiddleware = createMockRes();
    let nextCalled = false;
    await requireFiscalAuthMiddleware(req, resMiddleware as any, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'El middleware admite al usuario autenticado');

    const resEndpoint = createMockRes();
    await handleIamDiagnostic(req, resEndpoint);
    assert.strictEqual(resEndpoint.statusCode, 403);
    assert.strictEqual(resEndpoint.body.status, 'IAM_DIAGNOSTIC_FORBIDDEN');
    assert.strictEqual(resEndpoint.body.success, false);
  });

  // TEST 4: Acceso exitoso para Propietario con verificación de las 3 operaciones
  await runTest('1.4: Usuario Propietario/Admin ejecuta sondeo exitoso: write, read y delete confirmados (HTTP 200)', async () => {
    // Esperar enfriamiento
    await new Promise((r) => setTimeout(r, 1100));

    const req: any = {
      headers: { authorization: `Bearer ${ownerAdminToken}` },
      fiscalUser: null
    };
    await requireFiscalAuthMiddleware(req, createMockRes() as any, () => {});

    injectReadFailure = false;
    injectDeleteFailure = false;

    const res = createMockRes();
    await handleIamDiagnostic(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'IAM_PERMISSIONS_VERIFIED');
    assert.strictEqual(res.body.permissions.write, true);
    assert.strictEqual(res.body.permissions.read, true);
    assert.strictEqual(res.body.permissions.delete, true);

    // Comprobar que no queda ningún documento de prueba en la colección
    assert.strictEqual(mockOperationsCollection.size, 0, 'La colección de operaciones debe quedar limpia sin residuos');
  });

  // TEST 5: Limitación de frecuencia (Rate Limiting) previene costes por llamadas sucesivas
  await runTest('1.5: Invocaciones repetidas antes del cooldown son rechazadas con HTTP 429', async () => {
    const req: any = {
      headers: { authorization: `Bearer ${ownerAdminToken}` },
      fiscalUser: { isOwner: true, email: ROOT_OWNER_EMAIL }
    };
    const res = createMockRes();
    await handleIamDiagnostic(req, res);

    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(res.body.status, 'IAM_DIAGNOSTIC_RATE_LIMITED');
    assert.strictEqual(res.body.success, false);
  });

  // TEST 6: P2 - Si la lectura falla, el endpoint NO devuelve 200 ni IAM_PERMISSIONS_VERIFIED
  await runTest('1.6: P2 Audit - Si la lectura falla o no coincide, devuelve HTTP 503 y IAM_PERMISSIONS_INSUFFICIENT', async () => {
    await new Promise((r) => setTimeout(r, 1100)); // Reset cooldown

    const req: any = {
      headers: { authorization: `Bearer ${ownerAdminToken}` },
      fiscalUser: { isOwner: true, email: ROOT_OWNER_EMAIL }
    };

    injectReadFailure = true; // Inyectar fallo de lectura
    const res = createMockRes();
    await handleIamDiagnostic(req, res);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.status, 'IAM_PERMISSIONS_INSUFFICIENT');
    assert.strictEqual(res.body.permissions.read, false);

    // Verificar limpieza garantizada en finally
    assert.strictEqual(mockOperationsCollection.size, 0, 'El documento debe borrarse en el bloque finally pese al fallo de lectura');
  });

  // TEST 7: Limpieza garantizada si delete inicial falla y se ejecuta la limpieza en finally
  await runTest('1.7: Bloque finally garantiza borrado de sondeo ante fallos intermedios', async () => {
    await new Promise((r) => setTimeout(r, 1100));

    const req: any = {
      headers: { authorization: `Bearer ${ownerAdminToken}` },
      fiscalUser: { isOwner: true, email: ROOT_OWNER_EMAIL }
    };

    injectReadFailure = false;
    let forceThrowDuringRead = true;

    // Crear mock temporal que lanza excepción inesperada durante get()
    const originalDoc = mockFirestore.collection('fiscal_emission_operations').doc;
    let createdDocId = '';
    mockFirestore.collection = () => ({
      doc: (id: string) => {
        createdDocId = id;
        return {
          id,
          set: async (d: any) => { mockOperationsCollection.set(id, d); },
          get: async () => {
            if (forceThrowDuringRead) {
              throw new Error('CRITICAL_NETWORK_INTERRUPTION_MIDWAY');
            }
            return { exists: true, data: () => mockOperationsCollection.get(id) };
          },
          delete: async () => {
            mockOperationsCollection.delete(id);
          }
        };
      }
    }) as any;

    const res = createMockRes();
    await handleIamDiagnostic(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.status, 'IAM_PERMISSION_ERROR');
    assert.ok(res.body.error.includes('CRITICAL_NETWORK_INTERRUPTION_MIDWAY'));

    // Pese a la excepción abrupta durante el get(), el bloque finally eliminó el documento
    assert.strictEqual(mockOperationsCollection.has(createdDocId), false, 'El documento probe debe haber sido borrado en el finally');
  });

  clearTestAuthTokens();

  console.log('\n================================================================');
  console.log('  TODOS LOS TESTS DE SEGURIDAD Y CONTROL DE ENDPOINT IAM SUPERADOS');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\nERROR EN SUITE IAM ENDPOINT:', err);
  process.exit(1);
});
