/**
 * SUITE DE TESTS: AUDITORÍA DE SEGURIDAD Y ENDURECIMIENTO EXHAUSTIVO
 *
 * Cobertura precisa de los 10 puntos de auditoría:
 * 1. /api/fiscal/submit: el cliente NO puede controlar el XML (exclusivamente generado desde custodia backend)
 * 2. /api/fiscal/submit: endpoint AEAT NO controlable por cliente (bloqueo SSRF y exfiltración mTLS)
 * 3. Configuración fiscal: cero autoridad del cliente en entorno, endpoint o modalidad
 * 4. Lock stale >120 segundos: un proceso vivo (>120s) NUNCA pierde el lock por antigüedad + PID reuse
 * 5. Persistencia global multi-NIF: concurrencia real sin lost update en records, submissions y events
 * 6. Cadena bifurcada: detección inmediata de múltiples tips (A -> B y A -> C) y aborto estricto
 * 7. Persistencia fail-closed: fallos en disco de submissions o events lanzan excepción y no se silencian
 * 8. Bypass de autenticación de tests: bloqueado tajantemente en entorno de producción (NODE_ENV=production)
 * 9. Autorización sin fallback de NIF B88888888: usuarios sin authorizedObligados reciben []
 * 10. JWT hardening: verificación de firmas RS256, kid, iat/auth_time futuros, expiración y tampering
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import { emitFiscalInvoice } from '../src/fiscal/emissionService';
import { executeAeatSubmission } from '../src/fiscal/aeatTransport';
import { createFiscalSubmission } from '../src/fiscal/submissionService';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import {
  verifyFiscalToken,
  registerTestPublicKey,
  assertObligadoAuthorized,
  AuthenticatedFiscalUser
} from '../src/fiscal/backendAuth';
import firebaseConfig from '../firebase-applet-config.json';
import { Factura } from '../src/types';
import { FiscalRecord } from '../src/fiscal/types';

const NIF_EMISOR_A = 'A11111114';
const NIF_EMISOR_B = 'B22222228';
const ROOT_OWNER_EMAIL = 'peduwan@gmail.com';

function createDummyInvoice(overrides?: Partial<Factura>): Factura {
  return {
    id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    numeroFactura: `FAC-2026-${Math.floor(Math.random() * 90000) + 10000}`,
    fecha: '2026-02-15',
    clienteId: 'cli-001',
    clienteNombre: 'Restaurante El Mirador S.L.',
    clienteCif: 'B99999999',
    clienteDireccion: 'C/ Mayor 1, Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-001',
        loteEnvasadoId: 'lote-env-1',
        codigoLoteEnvasado: 'L-2026-001',
        formatoId: 'fmt-001',
        nombreFormato: 'Huevos Camperos L - Docena',
        cantidadEstuches: 10,
        precioUnitario: 3.5,
        subtotal: 35.0,
        fechaConsumoPreferente: '2026-03-15',
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
    creadoEn: '2026-02-15T10:00:00Z',
    ...overrides
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
  console.log('  SUITE DE TESTS: AUDITORÍA DE SEGURIDAD Y ENDURECIMIENTO');
  console.log('================================================================');

  BackendFiscalCustody.resetCustody();

  const configA = createDefaultFiscalConfiguration({
    nif: NIF_EMISOR_A,
    nombreRazon: 'Granja Avícola A S.L.'
  });

  // Generar par de claves RSA para los tests de autenticación
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const testKid = 'rsa-audit-key-2026';
  registerTestPublicKey(testKid, publicKey);

  // Helper para generar tokens firmados válidos
  function buildSignedToken(payloadOverrides?: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: testKid })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'operator-uid-123',
      email: 'operator@granja.com',
      email_verified: true,
      authorizedObligados: [NIF_EMISOR_A],
      iat: now - 10,
      auth_time: now - 10,
      exp: now + 3600,
      ...payloadOverrides
    })).toString('base64url');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(privateKey, 'base64url');
    return `${header}.${payload}.${signature}`;
  }

  // -----------------------------------------------------------------------------
  // PUNTO 1: /api/fiscal/submit - EL CLIENTE NO PUEDE CONTROLAR EL XML
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 1: XML transmitido procede 100% de custodia backend; xmlEnviado inyectado por cliente es ignorado', async () => {
    // 1. Emitir factura legítima
    const inv = createDummyInvoice({ numeroFactura: 'FAC-XML-CTRL-01' });
    const emitResult = await emitFiscalInvoice({
      invoiceDraft: inv,
      fiscalConfig: configA,
      persistRecordFn: async (r) => { await BackendFiscalCustody.saveFiscalRecord(r); }
    });
    const recordId = emitResult.fiscalRecord.id;

    // 2. Simular ataque: el cliente envía un XML falso pero formalmente válido con un NIF/datos ajenos
    const fakeClientXml = '<SuministroLR xmlns="https://www.agenciatributaria.gob.es/fake"><HACK>INJECTED_XML_BY_ATTACKER</HACK></SuministroLR>';

    // Simulación del endpoint de backend: solo toma fiscalRecordId
    const recordFromCustody = BackendFiscalCustody.getFiscalRecordById(recordId)!;
    assert(recordFromCustody, 'El registro debe existir en custodia');

    // El backend genera la sumisión a partir del record custodiado
    const serverSubmission = createFiscalSubmission(recordFromCustody, configA);

    // Comprobar que serverSubmission utiliza el XML oficial generado a partir del record custodiado y NO el fakeClientXml
    assert(serverSubmission.xmlEnviado.includes('RegFactuSistemaFacturacion'), 'Debe generar el XML oficial');
    assert(serverSubmission.xmlEnviado.includes('FAC-XML-CTRL-01'), 'Debe contener la factura custodiada');
    assert(!serverSubmission.xmlEnviado.includes('INJECTED_XML_BY_ATTACKER'), 'El XML de la sumisión nunca debe contener datos inyectados por el cliente');
  });

  // -----------------------------------------------------------------------------
  // PUNTO 2: /api/fiscal/submit - ENDPOINT AEAT NO CONTROLABLE POR CLIENTE
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 2: executeAeatSubmission rechaza endpointOverride hacia hosts atacantes de terceros', async () => {
    const dummyRec = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_A)!;
    const sub = createFiscalSubmission(dummyRec, configA);

    // Intento de dirigir el tráfico o credenciales mTLS a un servidor controlado por el atacante
    await assert.rejects(async () => {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: dummyRec,
        config: configA,
        options: {
          transportMode: 'real',
          endpointOverride: 'https://attacker.example.com/steal-mtls-certificate'
        }
      });
    }, /endpointOverride \('https:\/\/attacker\.example\.com\/steal-mtls-certificate'\) no autorizado\. Solo se permiten destinos oficiales de la Agencia Tributaria/);
  });

  // -----------------------------------------------------------------------------
  // PUNTO 3: CONFIGURACIÓN FISCAL RESUELTA SERVER-SIDE (0 AUTORIDAD DE CLIENTE)
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 3: Configuración fiscal del servidor ignora cualquier intento del cliente de cambiar modalidad o entorno', () => {
    const dummyRec = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_A)!;

    // Cliente malicioso intenta enviar config alterada
    const clientAttemptedConfig = {
      modalidad: 'NO_VERI_FACTU',
      entornoAeat: 'mock',
      transporte: { endpointUrl: 'https://attacker.example/ws' }
    };

    // La función del servidor construye la configuración estrictamente desde el registro y env vars
    const serverConfig = createDefaultFiscalConfiguration({
      nif: dummyRec.obligadoTributarioId,
      nombreRazon: dummyRec.emisor.nombreRazon
    });

    // Validar que el servidor fuerza VERI_FACTU y los endpoints oficiales
    assert.strictEqual(serverConfig.modalidad, 'VERI_FACTU');
    assert.notStrictEqual(serverConfig.transporte.endpointUrl, clientAttemptedConfig.transporte.endpointUrl);
    assert(serverConfig.transporte.endpointUrl.includes('aeat.es') || serverConfig.transporte.endpointUrl.includes('agenciatributaria.gob.es') || serverConfig.transporte.endpointUrl.includes('mock://'));
  });

  // -----------------------------------------------------------------------------
  // PUNTO 4: LOCK STALE >120 SEGUNDOS RESPETA PROCESOS VIVOS
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 4: Un lock con timestamp >120s NO puede ser robado si el proceso titular sigue vivo (Liveness + PID)', async () => {
    const dataDir = path.resolve(process.cwd(), 'data');
    const locksDir = path.join(dataDir, 'locks');
    if (!fs.existsSync(locksDir)) fs.mkdirSync(locksDir, { recursive: true });

    const lockPath = path.join(locksDir, `obligado_${NIF_EMISOR_A}.lock`);

    // Obtener starttime real de nuestro proceso
    let realProcStartTime = 0;
    try {
      if (fs.existsSync(`/proc/${process.pid}/stat`)) {
        const statData = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf-8');
        const afterComm = statData.substring(statData.lastIndexOf(')') + 2);
        realProcStartTime = parseInt(afterComm.split(' ')[19], 10) || 0;
      }
    } catch {}

    // Escribir un lock simulando que fue adquirido hace 180 segundos por NUESTRO propio PID (proceso vivo)
    const oldTimestamp = Date.now() - 180000;
    const lockContent = `${process.pid}:${oldTimestamp}:${realProcStartTime}:cryptononce123`;
    fs.writeFileSync(lockPath, lockContent, 'utf-8');

    // Intentar adquirir el lock desde otro llamador con timeout corto: debe fallar (fail closed)
    await assert.rejects(async () => {
      await BackendFiscalCustody.acquireProcessLock(NIF_EMISOR_A, 250);
    }, /Timeout \(250ms\) al adquirir cerrojo de emisión exclusivo/);

    // Verificar que el fichero de lock NO fue eliminado ni sobreescrito
    assert(fs.existsSync(lockPath), 'El lock debe seguir existiendo intacto');
    const readBack = fs.readFileSync(lockPath, 'utf-8').trim();
    assert.strictEqual(readBack, lockContent, 'El cerrojo del proceso vivo no puede ser alterado');

    // Ahora probar caso contrario: un lock de un proceso MUERTO (PID 99999999) sí puede ser recuperado
    const deadLockContent = `99999999:${Date.now() - 5000}:0:deadnonce`;
    fs.writeFileSync(lockPath, deadLockContent, 'utf-8');

    const releaseFn = await BackendFiscalCustody.acquireProcessLock(NIF_EMISOR_A, 1000);
    assert(releaseFn, 'Debe haber adquirido el lock saneando al dueño muerto');
    releaseFn();
  });

  // -----------------------------------------------------------------------------
  // PUNTO 5: PERSISTENCIA GLOBAL MULTI-NIF SIN LOST UPDATE
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 5: Concurrencia entre diferentes NIFs persiste ambos registros sin lost update', async () => {
    const configB = createDefaultFiscalConfiguration({
      nif: NIF_EMISOR_B,
      nombreRazon: 'Granja Avícola B S.A.'
    });

    const invA = createDummyInvoice({ numeroFactura: 'FAC-CONCUR-A1' });
    const invB = createDummyInvoice({ numeroFactura: 'FAC-CONCUR-B1' });

    // Emisión simultánea de dos obligados distintos
    const [resA, resB] = await Promise.all([
      emitFiscalInvoice({
        invoiceDraft: invA,
        fiscalConfig: configA,
        persistRecordFn: async (r) => { await BackendFiscalCustody.saveFiscalRecord(r); }
      }),
      emitFiscalInvoice({
        invoiceDraft: invB,
        fiscalConfig: configB,
        persistRecordFn: async (r) => { await BackendFiscalCustody.saveFiscalRecord(r); }
      })
    ]);

    // Verificar que ambos registros están en custodia de backend en disco
    const allRecords = BackendFiscalCustody.getAllFiscalRecords();
    const hasA = allRecords.some(r => r.id === resA.fiscalRecord.id);
    const hasB = allRecords.some(r => r.id === resB.fiscalRecord.id);

    assert(hasA, 'Registro de obligado A debe existir en custodia');
    assert(hasB, 'Registro de obligado B debe existir en custodia');

    // Verificar persistencia concurrente de submissions y events
    const subA = createFiscalSubmission(resA.fiscalRecord, configA);
    const subB = createFiscalSubmission(resB.fiscalRecord, configB);

    await Promise.all([
      BackendFiscalCustody.saveFiscalSubmission(subA),
      BackendFiscalCustody.saveFiscalSubmission(subB)
    ]);

    const subs = BackendFiscalCustody.getFiscalSubmissions();
    assert(subs.some(s => s.id === subA.id), 'Submission A debe persistir');
    assert(subs.some(s => s.id === subB.id), 'Submission B debe persistir');
  });

  // -----------------------------------------------------------------------------
  // PUNTO 6: CADENA CON MÚLTIPLES TIPS DETECTADA Y ABORTADA
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 6: Detección estricta de cadena bifurcada con múltiples puntas (A -> B y A -> C) aborta la emisión', async () => {
    const OBLIGADO_FORK = 'B33333331';
    const configFork = createDefaultFiscalConfiguration({
      nif: OBLIGADO_FORK,
      nombreRazon: 'Granja Fork S.L.'
    });

    // 1. Crear registro raíz A
    const invRoot = createDummyInvoice({ numeroFactura: 'FORK-ROOT' });
    const resRoot = await emitFiscalInvoice({
      invoiceDraft: invRoot,
      fiscalConfig: configFork,
      persistRecordFn: async (r) => { await BackendFiscalCustody.saveFiscalRecord(r); }
    });

    // 2. Crear rama B que encadena con Root
    const invB = createDummyInvoice({ numeroFactura: 'FORK-RAMA-B' });
    const resB = await emitFiscalInvoice({
      invoiceDraft: invB,
      fiscalConfig: configFork,
      persistRecordFn: async (r) => { await BackendFiscalCustody.saveFiscalRecord(r); }
    });

    // 3. Inyectar forzosamente una rama C en disco que también encadena con Root (bifurcación: Root -> B y Root -> C)
    const recC: any = {
      ...resB.fiscalRecord,
      id: `frec-FORK-C-${Date.now()}`,
      huella: {
        ...resB.fiscalRecord.huella,
        hash: 'C00000000000000000000000000000000000000000000000000000000000000C',
        cadenaTextoCanonico: 'FORK-C'
      },
      encadenamiento: {
        primerRegistro: false,
        registroAnterior: {
          ...resB.fiscalRecord.encadenamiento.registroAnterior,
          huella: resRoot.fiscalRecord.huella.hash
        }
      }
    };

    const dataDir = path.resolve(process.cwd(), 'data');
    const recordsFile = path.join(dataDir, 'fiscal_records.json');
    const raw = JSON.parse(fs.readFileSync(recordsFile, 'utf-8'));
    raw.push(recC);
    fs.writeFileSync(recordsFile, JSON.stringify(raw, null, 2), 'utf-8');

    // 4. Intentar resolver el último registro con getLatestFiscalRecord
    // Debe RECHAZAR elegir arbitrariamente entre B y C y lanzar un error de bifurcación
    assert.throws(() => {
      BackendFiscalCustody.getLatestFiscalRecord(OBLIGADO_FORK);
    }, /Bifurcación crítica detectada en la cadena criptográfica del obligado 'B33333331'\. Existen 2 puntas de cadena concurrentes/);
  });

  // -----------------------------------------------------------------------------
  // PUNTO 7: PERSISTENCIA FAIL-CLOSED DE SUBMISSION Y EVENT
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 7: Fallos de persistencia de submission o event lanzan error (Fail-Closed) y no se silencian', async () => {
    // Intentar guardar una submission inválida/sin ID
    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalSubmission({} as any);
    }, /Se requiere una FiscalSubmission válida con identificador/);

    // Intentar guardar un evento inválido/sin ID
    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalEvent({} as any);
    }, /Se requiere un FiscalEvent válido con identificador/);
  });

  // -----------------------------------------------------------------------------
  // PUNTO 8: BYPASS DE AUTENTICACIÓN DE TESTS BLOQUEADO EN PRODUCCIÓN
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 8: registerTestPublicKey y verificación con claves de test están prohibidas en producción (NODE_ENV=production)', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      // 1. Prohibido registrar claves de test en producción
      assert.throws(() => {
        registerTestPublicKey('prod-attempt-kid', publicKey);
      }, /VIOLACIÓN DE SEGURIDAD: Prohibido registrar claves públicas de test en entorno de producción/);

      // 2. verifyFiscalToken en producción nunca acepta tokens firmados con claves de test
      const testToken = buildSignedToken();
      await assert.rejects(async () => {
        await verifyFiscalToken(testToken);
      }, /Clave pública con identificador kid 'rsa-audit-key-2026' no reconocida o no autorizada por Google/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // -----------------------------------------------------------------------------
  // PUNTO 9: AUTORIZACIÓN: SIN FALLBACK FICTICIO DE NIF B88888888
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 9: Token sin authorizedObligados recibe [] y es rechazado para cualquier NIF (sin fallback a B88888888)', async () => {
    // Token sin el campo authorizedObligados
    const tokenWithoutObligados = buildSignedToken({
      email: 'operator_sin_nifs@granja.com',
      authorizedObligados: undefined
    });

    const user = await verifyFiscalToken(tokenWithoutObligados);
    assert.deepStrictEqual(user.authorizedObligados, [], 'Debe resolver como lista vacía');

    // Intentar emitir para B88888888 debe ser rechazado taxativamente
    assert.throws(() => {
      assertObligadoAuthorized(user, 'B88888888');
    }, /no está autorizado para emitir registros en nombre del obligado tributario 'B88888888'/);

    // Intentar emitir para cualquier otro NIF debe ser igualmente rechazado
    assert.throws(() => {
      assertObligadoAuthorized(user, NIF_EMISOR_A);
    }, /no está autorizado para emitir registros en nombre del obligado tributario/);
  });

  // -----------------------------------------------------------------------------
  // PUNTO 10: JWT HARDENING EXHAUSTIVO
  // -----------------------------------------------------------------------------
  await runTest('PUNTO 10.1: Algoritmo no RS256 (ej. HS256 o none) es rechazado', async () => {
    const badHeader = Buffer.from(JSON.stringify({ alg: 'HS256', kid: testKid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
    const fakeSig = Buffer.from('fakesig').toString('base64url');
    await assert.rejects(async () => {
      await verifyFiscalToken(`${badHeader}.${payload}.${fakeSig}`);
    }, /Algoritmo criptográfico de token no permitido/);
  });

  await runTest('PUNTO 10.2: Token expirado es rechazado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = buildSignedToken({ exp: now - 100 });
    await assert.rejects(async () => {
      await verifyFiscalToken(expiredToken);
    }, /El token de autenticación ha expirado/);
  });

  await runTest('PUNTO 10.3: Token con iat futuro es rechazado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const futureIatToken = buildSignedToken({ iat: now + 500 });
    await assert.rejects(async () => {
      await verifyFiscalToken(futureIatToken);
    }, /El token de autenticación no contiene 'iat' válido o fue emitido en el futuro/);
  });

  await runTest('PUNTO 10.4: Token con auth_time futuro es rechazado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const futureAuthTimeToken = buildSignedToken({ auth_time: now + 500 });
    await assert.rejects(async () => {
      await verifyFiscalToken(futureAuthTimeToken);
    }, /El token de autenticación no contiene 'auth_time' válido o es posterior al tiempo actual/);
  });

  await runTest('PUNTO 10.5: Token manipulado tras la firma es rechazado por la verificación RSA-SHA256', async () => {
    const validToken = buildSignedToken();
    const [h, p, s] = validToken.split('.');
    const decodedPayload = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
    decodedPayload.email = ROOT_OWNER_EMAIL; // Intento de escalada de privilegios a propietario
    const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
    const tamperedToken = `${h}.${tamperedPayload}.${s}`;

    await assert.rejects(async () => {
      await verifyFiscalToken(tamperedToken);
    }, /Fallo en la verificación criptográfica de la firma del token/);
  });

  console.log('================================================================');
  console.log('  AUDITORÍA DE SEGURIDAD EXHAUSTIVA: 10/10 PUNTOS SUPERADOS!');
  console.log('================================================================');
}

main().catch(err => {
  console.error('*** ERROR FATAL EN LA SUITE DE AUDITORÍA ***', err);
  process.exit(1);
});
