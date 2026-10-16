/**
 * SUITE DE TESTS - FASE 1: REMEDIACIÓN DE BLOQUEANTES (B1 - B6)
 * Normativa: RD 1007/2023, Orden HAC/1177/2024, Ley 11/2021
 * Ejecución directa: tsx tests/remediacion_fase1_bloqueantes.test.ts
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import firebaseConfig from '../firebase-applet-config.json';
import {
  getSifIdentityConfig,
  setTestSifIdentityConfig,
  SIF_BLACKLIST_NIFS,
  SIF_BLACKLIST_RAZONES
} from '../src/config/sifIdentity';
import { normalizeAeatEnvironment, getAeatSoapEndpoint, AEAT_OFFICIAL_ENDPOINTS } from '../src/fiscal/aeatEndpoints';
import {
  verifyFiscalToken,
  verifyFirebaseIdToken,
  registerTestPublicKey,
  clearTestAuthTokens,
  ROOT_OWNER_EMAIL
} from '../src/fiscal/backendAuth';
import {
  voiceProtectionMiddleware,
  resetVoiceRateLimits,
  resetVoiceMinuteWindow,
  VoiceAuthenticatedRequest
} from '../src/fiscal/voiceProtection';
import { createFiscalRecordFromInvoice, createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { buildFiscalQr, buildFiscalQrUrl, generateQrDataUri, AEAT_QR_ENDPOINTS } from '../src/fiscal/qrService';
import { Factura } from '../src/types';

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
  console.log('  EJECUTANDO SUITE DE TESTS — FASE 1: REMEDIACIÓN DE BLOQUEANTES (B1-B6)');
  console.log('========================================================================');

  const originalEnv = { ...process.env };

  // Generación de par de claves RSA 2048 para firma y verificación criptográfica estricta RS256
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const testKid = 'test-kid-fase1';

  function createSignedTestToken(payloadOverrides?: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: testKid })).toString('base64url');
    const payloadObj = {
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'user-voice-1',
      user_id: 'user-voice-1',
      email: 'operario@granja.es',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000) - 10,
      auth_time: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payloadOverrides
    };
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(privateKey, 'base64url');
    return `${header}.${payload}.${signature}`;
  }

  function mockVoiceReq(options: {
    authHeader?: string;
    contentLength?: string;
    ip?: string;
  }): { req: VoiceAuthenticatedRequest; res: any } {
    const req = {
      headers: {
        authorization: options.authHeader,
        'content-length': options.contentLength
      },
      ip: options.ip || '192.168.1.50',
      socket: { remoteAddress: options.ip || '192.168.1.50' }
    } as unknown as VoiceAuthenticatedRequest;

    const res: any = {
      statusCode: 200,
      headers: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: any) {
        this.headers[name] = value;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      }
    };

    return { req, res };
  }

  function getTestFiscalConfig() {
    process.env.SIF_NIF = 'B12345674';
    process.env.SIF_NOMBRE_RAZON = 'AVICOLA IBERICA TECNOLOGICA S.L.';
    process.env.SIF_INSTALACION_ID = 'INST-01';
    return createDefaultFiscalConfiguration({
      nif: 'B12345674',
      nombreRazon: 'AVICOLA IBERICA TECNOLOGICA S.L.',
      entorno: 'pruebas'
    });
  }

  function getTestInvoice(overrides?: Partial<Factura>): Factura {
    return {
      id: 'fac-qr-001',
      numeroFactura: 'F2026-QR-100',
      fecha: '2026-10-15',
      fechaHoraSellado: '2026-10-15T10:00:00+02:00',
      clienteId: 'cli-01',
      clienteNombre: 'Cliente QR',
      clienteCif: 'B98765432',
      clienteDireccion: 'Calle Principal 1',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      tipoFactura: 'F1',
      esRectificativa: false,
      lineas: [
        {
          id: 'lin-1',
          loteEnvasadoId: 'env-1',
          codigoLoteEnvasado: 'ENV-01',
          formatoId: 'fmt-1',
          nombreFormato: 'Huevos L',
          cantidadEstuches: 50,
          precioUnitario: 2.0,
          subtotal: 100.0,
          fechaConsumoPreferente: '2026-11-15',
          trazabilidadPuesta: [],
          tipoIva: 4
        } as any
      ],
      totales: {
        baseImponible: 100.0,
        porcentajeIva: 4,
        cuotaIva: 4.0,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 104.0
      },
      formaPago: 'transferencia',
      estadoPago: 'pagada',
      esVentaDirecta: false,
      creadoEn: '2026-10-15T10:00:00Z',
      ...overrides
    };
  }

  // --- BLOQUE 1: IDENTIDAD SIF CENTRALIZADA Y SEGURA (B1) ---
  console.log('\n--- B1: Identidad SIF Centralizada y Segura ---');

  await runTest('B1.1: Carga identidad válida desde variables de entorno', () => {
    process.env.NODE_ENV = 'production';
    process.env.SIF_NIF = 'B12345674';
    process.env.SIF_NOMBRE_RAZON = 'AVICOLA IBERICA TECNOLOGICA S.L.';
    process.env.SIF_INSTALACION_ID = 'INST-GRANJA-01';
    process.env.SIF_NOMBRE_SIF = 'GranjaAvicolaSIF';
    process.env.SIF_VERSION = '2.4.0';
    process.env.SIF_FECHA_ACTIVACION = '2026-01-01T00:00:00Z';

    const config = getSifIdentityConfig();
    assert.strictEqual(config.nif, 'B12345674');
    assert.strictEqual(config.nombreRazon, 'AVICOLA IBERICA TECNOLOGICA S.L.');
    assert.strictEqual(config.numeroInstalacion, 'INST-GRANJA-01');
    assert.strictEqual(config.nombreSistemaInformatico, 'GranjaAvicolaSIF');
    assert.strictEqual(config.version, '2.4.0');
  });

  await runTest('B1.2: Lanza error fatal si falta SIF_NIF en producción', () => {
    delete process.env.SIF_NIF;
    process.env.NODE_ENV = 'production';
    process.env.SIF_NOMBRE_RAZON = 'AVICOLA IBERICA TECNOLOGICA S.L.';
    process.env.SIF_INSTALACION_ID = 'INST-01';
    process.env.SIF_FECHA_ACTIVACION = '2026-01-01T00:00:00Z';

    assert.throws(() => getSifIdentityConfig(), /SIF_NIF obligatoria/);
  });

  await runTest('B1.3: Lanza error fatal si el NIF está en la lista negra (case-insensitive con trim)', () => {
    process.env.NODE_ENV = 'production';
    process.env.SIF_NOMBRE_RAZON = 'AVICOLA IBERICA TECNOLOGICA S.L.';
    process.env.SIF_INSTALACION_ID = 'INST-01';
    process.env.SIF_FECHA_ACTIVACION = '2026-01-01T00:00:00Z';

    for (const blacklisted of ['  b99999999  ', 'INST-001', 'ES_UNKNOWN', '000000000', 'UNKNOWN']) {
      process.env.SIF_NIF = blacklisted;
      assert.throws(() => getSifIdentityConfig(), /lista negra/i);
    }
  });

  await runTest('B1.4: Lanza error fatal si la razón social está en la lista negra (case-insensitive con trim)', () => {
    process.env.NODE_ENV = 'production';
    process.env.SIF_NIF = 'B12345674';
    process.env.SIF_INSTALACION_ID = 'INST-01';
    process.env.SIF_FECHA_ACTIVACION = '2026-01-01T00:00:00Z';

    for (const blacklistedRazon of ['  gestión avícola software s.l.  ', 'SOFTWARE FICTICIO', 'UNKNOWN']) {
      process.env.SIF_NOMBRE_RAZON = blacklistedRazon;
      assert.throws(() => getSifIdentityConfig(), /lista negra/i);
    }
  });

  await runTest('B1.5: Valida formato formal de NIF/CIF español', () => {
    process.env.NODE_ENV = 'production';
    process.env.SIF_NIF = 'INVALIDO123';
    process.env.SIF_NOMBRE_RAZON = 'AVICOLA VALIDA S.L.';
    process.env.SIF_INSTALACION_ID = 'INST-01';
    process.env.SIF_FECHA_ACTIVACION = '2026-01-01T00:00:00Z';

    assert.throws(() => getSifIdentityConfig(), /formato reglamentario/i);
  });

  // --- BLOQUE 2: UNIFICACIÓN DE AEAT_ENV (B2) ---
  console.log('\n--- B2: Unificación de AEAT_ENV ---');

  await runTest('B2.1: Reconoce entornos oficiales: production y test', () => {
    assert.strictEqual(normalizeAeatEnvironment('production'), 'production');
    assert.strictEqual(normalizeAeatEnvironment('produccion'), 'production');
    assert.strictEqual(normalizeAeatEnvironment('test'), 'test');
    assert.strictEqual(normalizeAeatEnvironment('pruebas'), 'test');
    assert.strictEqual(normalizeAeatEnvironment('testing'), 'test');
  });

  await runTest('B2.2: Lanza error fatal si se recibe un entorno no admitido o inventado', () => {
    assert.throws(() => normalizeAeatEnvironment('staging'), /Valor de entorno AEAT no permitido/);
    assert.throws(() => normalizeAeatEnvironment('qa'), /Valor de entorno AEAT no permitido/);
    assert.throws(() => normalizeAeatEnvironment('sandbox'), /Valor de entorno AEAT no permitido/);
  });

  await runTest('B2.3: Prohíbe terminantemente el modo mock si NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(() => normalizeAeatEnvironment('mock'), /Prohibido terminantemente el modo mock en entorno de producción/);
  });

  await runTest('B2.4: Permite modo mock si NODE_ENV !== production', () => {
    process.env.NODE_ENV = 'development';
    assert.strictEqual(normalizeAeatEnvironment('mock'), 'mock');
  });

  await runTest('B2.5: Endpoints SOAP apuntan a sedes oficiales reales sin fallbacks silenciosos', () => {
    const prodEndpoint = getAeatSoapEndpoint('production');
    assert.ok(prodEndpoint.includes('agenciatributaria.gob.es'));

    const testEndpoint = getAeatSoapEndpoint('test');
    assert.ok(testEndpoint.includes('prewww1.aeat.es'));
  });

  // --- BLOQUE 3: VERIFICACIÓN ESTRICTA isOwner (B3) ---
  console.log('\n--- B3: Verificación Estricta isOwner con email_verified === true ---');

  registerTestPublicKey(testKid, publicKey);

  await runTest('B3.1: Concede isOwner solo si email coincide y email_verified === true', async () => {
    const token = createSignedTestToken({
      email: ROOT_OWNER_EMAIL,
      sub: 'peduwan-uid-root',
      user_id: 'peduwan-uid-root',
      email_verified: true
    });
    const user = await verifyFirebaseIdToken(token);
    assert.strictEqual(user.isOwner, true);
    assert.strictEqual(user.emailVerified, true);
  });

  await runTest('B3.2: Deniega isOwner si email coincide pero email_verified === false', async () => {
    const token = createSignedTestToken({
      email: ROOT_OWNER_EMAIL,
      sub: 'peduwan-uid-root',
      user_id: 'peduwan-uid-root',
      email_verified: false
    });
    const user = await verifyFirebaseIdToken(token);
    assert.strictEqual(user.isOwner, false);
    assert.strictEqual(user.emailVerified, false);
  });

  // --- BLOQUE 4: ENDPOINTS DE VOZ BLINDADOS (B4) ---
  console.log('\n--- B4: Endpoints de Voz Blindados ---');

  await runTest('B4.1: Rechaza peticiones sin Authorization Bearer con 401', async () => {
    resetVoiceRateLimits();
    const { req, res } = mockVoiceReq({});
    let nextCalled = false;

    await voiceProtectionMiddleware(req, res, () => { nextCalled = true; });
    assert.strictEqual(res.statusCode, 401);
    assert.ok(res.body.error.includes('No autorizado'));
    assert.strictEqual(nextCalled, false);
  });

  await runTest('B4.2: Rechaza peticiones cuyo tamaño de carga exceda 1MB con 413', async () => {
    resetVoiceRateLimits();
    const token = createSignedTestToken();
    const { req, res } = mockVoiceReq({
      authHeader: `Bearer ${token}`,
      contentLength: (2 * 1024 * 1024).toString()
    });
    let nextCalled = false;

    await voiceProtectionMiddleware(req, res, () => { nextCalled = true; });
    assert.strictEqual(res.statusCode, 413);
    assert.ok(res.body.error.includes('Carga útil excesiva'));
    assert.strictEqual(nextCalled, false);
  });

  await runTest('B4.3: Permite peticiones autorizadas dentro de la tasa y cuota', async () => {
    resetVoiceRateLimits();
    const token = createSignedTestToken({ sub: 'user-legit', user_id: 'user-legit' });
    const { req, res } = mockVoiceReq({ authHeader: `Bearer ${token}` });
    let nextCalled = false;

    await voiceProtectionMiddleware(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.headers['X-RateLimit-Limit-Minute'], 30);
    assert.strictEqual(res.headers['X-RateLimit-Limit-Day'], 200);
  });

  await runTest('B4.4: Bloquea con 429 al superar 30 peticiones por minuto', async () => {
    resetVoiceRateLimits();
    const token = createSignedTestToken({ sub: 'user-spammer', user_id: 'user-spammer' });
    let passCount = 0;

    for (let i = 0; i < 30; i++) {
      const { req, res } = mockVoiceReq({ authHeader: `Bearer ${token}` });
      await voiceProtectionMiddleware(req, res, () => { passCount++; });
    }
    assert.strictEqual(passCount, 30);

    const { req: req31, res: res31 } = mockVoiceReq({ authHeader: `Bearer ${token}` });
    await voiceProtectionMiddleware(req31, res31, () => { passCount++; });
    assert.strictEqual(res31.statusCode, 429);
    assert.ok(res31.body.error.includes('Máximo 30 peticiones por minuto'));
  });

  await runTest('B4.5: Bloquea con 429 al agotar la cuota diaria de 200 peticiones', async () => {
    resetVoiceRateLimits();
    const userId = 'user-daily-quota';
    const token = createSignedTestToken({ sub: userId, user_id: userId });
    let passCount = 0;

    for (let i = 0; i < 200; i++) {
      if (i > 0 && i % 25 === 0) {
        resetVoiceMinuteWindow(userId);
      }
      const { req, res } = mockVoiceReq({ authHeader: `Bearer ${token}` });
      await voiceProtectionMiddleware(req, res, () => { passCount++; });
    }
    assert.strictEqual(passCount, 200);

    resetVoiceMinuteWindow(userId);
    const { req: reqExceeded, res: resExceeded } = mockVoiceReq({ authHeader: `Bearer ${token}` });
    await voiceProtectionMiddleware(reqExceeded, resExceeded, () => { passCount++; });
    assert.strictEqual(resExceeded.statusCode, 429);
    assert.ok(resExceeded.body.error.match(/cuota diaria agotada/i));
  });

  // --- BLOQUE 5: IVA Y RECARGO CON CONTEXTO COMPLETO (B5) ---
  console.log('\n--- B5: IVA y Recargo con Contexto Completo ---');

  await runTest('B5.1: Lanza error detallado con ID de factura y número de línea si falta tipoIva', () => {
    const config = getTestFiscalConfig();
    const invoice = getTestInvoice({
      id: 'FAC-ERR-001',
      numeroFactura: 'F2026-001',
      lineas: [
        {
          id: 'lin-1',
          loteEnvasadoId: 'env-1',
          codigoLoteEnvasado: 'ENV-01',
          formatoId: 'fmt-1',
          nombreFormato: 'Docena Huevos Camperos L',
          cantidadEstuches: 10,
          precioUnitario: 2.5,
          subtotal: 25.0,
          fechaConsumoPreferente: '2026-11-15',
          trazabilidadPuesta: []
          // tipoIva ausente
        } as any
      ],
      totales: {
        baseImponible: 25.0,
        porcentajeIva: undefined as any,
        cuotaIva: 1.0,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 26.0
      }
    });

    assert.throws(() => {
      createFiscalRecordFromInvoice(invoice, config, null, { hashActual: 'a'.repeat(64) });
    }, /Factura F2026-001: Línea 1 \("Docena Huevos Camperos L"\): Falta el tipo impositivo de IVA obligatorio/);
  });

  await runTest('B5.2: Exige porcentaje de recargo válido cuando aplicaRecargo === true', () => {
    const config = getTestFiscalConfig();
    const invoice = getTestInvoice({
      id: 'FAC-ERR-002',
      numeroFactura: 'F2026-002',
      clienteRecargoEquivalencia: true,
      lineas: [
        {
          id: 'lin-1',
          loteEnvasadoId: 'env-1',
          codigoLoteEnvasado: 'ENV-01',
          formatoId: 'fmt-1',
          nombreFormato: 'Huevos M',
          cantidadEstuches: 20,
          precioUnitario: 2.0,
          subtotal: 40.0,
          tipoIva: 4,
          fechaConsumoPreferente: '2026-11-15',
          trazabilidadPuesta: []
        } as any
      ],
      totales: {
        baseImponible: 40.0,
        porcentajeIva: 4,
        cuotaIva: 1.6,
        aplicaRecargo: true,
        porcentajeRecargo: undefined as any, // ausente
        cuotaRecargo: 0,
        totalDocumento: 41.6
      }
    });

    assert.throws(() => {
      createFiscalRecordFromInvoice(invoice, config, null, { hashActual: 'b'.repeat(64) });
    }, /Factura F2026-002: Línea 1 \("Huevos M"\): Aplica recargo de equivalencia pero no se especificó un porcentaje válido/);
  });

  await runTest('B5.3: Procesa correctamente cuando aplicaRecargo === false sin exigir recargo', () => {
    const config = getTestFiscalConfig();
    const invoice = getTestInvoice();

    const record = createFiscalRecordFromInvoice(invoice, config, null, { hashActual: 'c'.repeat(64) });
    assert.strictEqual(record.desgloseTributario.desgloseIVA[0].tipoImpositivo, 4);
    assert.strictEqual(record.desgloseTributario.desgloseIVA[0].cuotaRepercutida, 4.0);
    assert.strictEqual(record.desgloseTributario.desgloseIVA[0].tipoRecargoEquivalencia, undefined);
    assert.strictEqual(record.desgloseTributario.desgloseIVA[0].cuotaRecargoEquivalencia, undefined);
  });

  // --- BLOQUE 6: QR REGLAMENTARIO (DEFAULT TEST Y 4 MÓDULOS) (B6) ---
  console.log('\n--- B6: QR Reglamentario (Default test y 4 módulos) ---');

  await runTest('B6.1: Genera por defecto URL dirigida a preproducción/test (prewww2.aeat.es)', () => {
    const config = getTestFiscalConfig();
    const invoice = getTestInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, { hashActual: 'd'.repeat(64) });
    const qrUrl = buildFiscalQrUrl(record);
    assert.ok(qrUrl.includes(AEAT_QR_ENDPOINTS.testing));
    assert.ok(qrUrl.includes('nif=B12345674'));
    assert.ok(qrUrl.includes('numserie=F2026-QR-100'));
    assert.ok(qrUrl.includes('importe=104.00'));
  });

  await runTest('B6.2: Genera URL dirigida a producción cuando se solicita explícitamente', () => {
    const config = getTestFiscalConfig();
    const invoice = getTestInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, { hashActual: 'd'.repeat(64) });
    const qrUrl = buildFiscalQrUrl(record, { environment: 'production' });
    assert.ok(qrUrl.includes(AEAT_QR_ENDPOINTS.production));
    assert.ok(qrUrl.includes('www2.agenciatributaria.gob.es'));
  });

  await runTest('B6.3: Genera imagen Data URI con margen reglamentario de 4 módulos (ISO/IEC 18004)', async () => {
    const config = getTestFiscalConfig();
    const invoice = getTestInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, { hashActual: 'd'.repeat(64) });
    const qrResult = await buildFiscalQr(record);

    assert.ok(qrResult.qrDataUri);
    assert.ok(qrResult.qrDataUri.startsWith('data:image/png;base64,'));
    assert.strictEqual(qrResult.url, qrResult.payloadTexto);
  });

  clearTestAuthTokens();
  process.env = originalEnv;

  console.log('========================================================================');
  console.log('  RESULTADO SUITE FASE 1 (B1-B6): TODOS LOS TESTS SUPERADOS CON ÉXITO');
  console.log('========================================================================');
}

main().catch((err) => {
  console.error('ERROR EN TESTS FASE 1:', err);
  process.exit(1);
});
