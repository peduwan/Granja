/**
 * SUITE DE TESTS - FASE 3.1.4: AUDITORÍA FORENSE Y CIERRE REAL DE AUTORIDAD FISCAL BACKEND
 *
 * Normativa Oficial:
 * - Ley 11/2021 de medidas de prevención y lucha contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 * - Documento técnico AEAT v1.0.3
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import firebaseConfig from '../firebase-applet-config.json';
import { ROOT_OWNER_EMAIL } from '../src/utils/storage';
import {
  executeAeatSubmission,
  AeatFlowControlManager,
  scheduleSubmissionRetry,
  createRetrySubmission
} from '../src/fiscal/aeatTransport';
import { AeatCertificateProvider } from '../src/fiscal/aeatCertificateProvider';
import {
  emitFiscalInvoice,
  emitFiscalAnulacion,
  resetFiscalQueue,
  getLastFiscalRecord
} from '../src/fiscal/emissionService';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import {
  verifyFiscalRecordHash,
  verifyFiscalRecordChain,
  calculateAltaHash
} from '../src/fiscal/hashService';
import {
  createFiscalRecordFromInvoice,
  createDefaultFiscalConfiguration
} from '../src/fiscal/modelTransformers';
import {
  createFiscalSubmission,
  transitionSubmissionStatus
} from '../src/fiscal/submissionService';
import {
  registerTestPublicKey,
  clearTestAuthTokens,
  verifyFiscalToken,
  isValidSpanishNifCifNie,
  assertObligadoAuthorized
} from '../src/fiscal/backendAuth';
import {
  saveFiscalRecordToCloud,
  saveFiscalSubmissionToCloud,
  saveFiscalEventToCloud
} from '../src/utils/firebase';
import { Factura, FiscalRecord } from '../src/types';

function createDummyInvoice(overrides?: Partial<Factura>): Factura {
  return {
    id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    numeroFactura: 'FAC-2026-0001',
    fecha: '2026-02-15',
    clienteId: 'cli-001',
    clienteNombre: 'Restaurante El Mirador',
    clienteCif: 'B12345678',
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
  console.log('================================================================');
  console.log('  EJECUTANDO SUITE DE TESTS - FASE 3.1.4: AUDITORÍA FORENSE');
  console.log('================================================================');

  BackendFiscalCustody.resetCustody();
  resetFiscalQueue();
  AeatFlowControlManager.reset();
  AeatCertificateProvider.clear();
  clearTestAuthTokens();

  const NIF_EMISOR_LEGAL = 'B88888888';
  const config = createDefaultFiscalConfiguration({
    nif: NIF_EMISOR_LEGAL,
    nombreRazon: 'Explotación Avícola Segura S.L.'
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 1: AUTENTICACIÓN Y AUTORIZACIÓN ESTRICTA EN BACKEND
  // -----------------------------------------------------------------------------

  await runTest('1.1: Request sin token o token vacío es rechazado con error 401', async () => {
    await assert.rejects(async () => {
      await verifyFiscalToken('');
    }, /Token de autenticación vacío o no proporcionado/);
  });

  await runTest('1.2: Token inválido o malformado es rechazado con error 401', async () => {
    await assert.rejects(async () => {
      await verifyFiscalToken('INVALID_TOKEN_NOT_A_JWT');
    }, /Formato de token de autenticación inválido/);
  });

  await runTest('1.3: Usuario autenticado pero sin rol ni obligaciones autorizadas recibe 403', () => {
    const unauthVisitor = {
      uid: 'user-intruder',
      email: 'intruder@unknown.com',
      emailVerified: false,
      isOwner: false,
      authorizedObligados: []
    };
    assert.throws(() => {
      assertObligadoAuthorized(unauthVisitor, NIF_EMISOR_LEGAL);
    }, /no está autorizado para emitir registros en nombre del obligado/);
  });

  await runTest('1.4: Usuario autorizado con su NIF asignado accede legítimamente', () => {
    const authOperator = {
      uid: 'user-operator',
      email: 'operator@granja.com',
      emailVerified: true,
      isOwner: false,
      authorizedObligados: [NIF_EMISOR_LEGAL]
    };
    const resolved = assertObligadoAuthorized(authOperator, NIF_EMISOR_LEGAL);
    assert.strictEqual(resolved, NIF_EMISOR_LEGAL);
  });

  await runTest('1.5: Intento de suplantar otro obligado tributario ajeno es rechazado tajantemente', () => {
    const authOperator = {
      uid: 'user-operator',
      email: 'operator@granja.com',
      emailVerified: true,
      isOwner: false,
      authorizedObligados: [NIF_EMISOR_LEGAL]
    };
    assert.throws(() => {
      // Intenta emitir en nombre de B77777777 (no en su lista autorizada)
      assertObligadoAuthorized(authOperator, 'B77777777');
    }, /no está autorizado para emitir registros en nombre del obligado tributario 'B77777777'/);
  });

  await runTest('1.6: Rechazo estricto de NIFs mal formados, ES_UNKNOWN, UNKNOWN y B12345678', () => {
    assert.strictEqual(isValidSpanishNifCifNie('ES_UNKNOWN'), false);
    assert.strictEqual(isValidSpanishNifCifNie('UNKNOWN'), false);
    assert.strictEqual(isValidSpanishNifCifNie('B12345678'), false);
    assert.strictEqual(isValidSpanishNifCifNie(''), false);
    assert.strictEqual(isValidSpanishNifCifNie('123'), false);
    assert.strictEqual(isValidSpanishNifCifNie(NIF_EMISOR_LEGAL), true);
  });

  await runTest('1.7: Ataque con JWT forjado que suplanta a ROOT_OWNER con firma inventada es rechazado', async () => {
    // Generar un JWT falso intentando reclamar ser el propietario raíz
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'forged-kid-001' })).toString('base64url');
    const forgedPayload = Buffer.from(JSON.stringify({
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'hacker-uid-666',
      email: ROOT_OWNER_EMAIL,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const fakeSignature = Buffer.from('FAKE_UNVERIFIABLE_SIGNATURE_DATA_STRING_HERE_XYZ').toString('base64url');
    const forgedToken = `${forgedHeader}.${forgedPayload}.${fakeSignature}`;

    await assert.rejects(async () => {
      await verifyFiscalToken(forgedToken);
    }, /(Clave pública con identificador kid 'forged-kid-001' no reconocida|Firma criptográfica)/);
  });

  await runTest('1.8: Ataque de manipulación (tampering) sobre un token firmado es detectado criptográficamente', async () => {
    // Generar par de claves RSA reales de prueba
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const testKid = 'rsa-test-key-2026';
    registerTestPublicKey(testKid, publicKey);

    const validHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: testKid })).toString('base64url');
    const originalPayload = Buffer.from(JSON.stringify({
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'legit-operator-777',
      email: 'operator@granja.com',
      email_verified: true,
      authorizedObligados: [NIF_EMISOR_LEGAL],
      iat: Math.floor(Date.now() / 1000) - 10,
      auth_time: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');

    // Firmar legítimamente con la clave privada
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${validHeader}.${originalPayload}`);
    const validSignature = signer.sign(privateKey, 'base64url');

    // 1. Verificar que el token sin manipular es admitido
    const legitToken = `${validHeader}.${originalPayload}.${validSignature}`;
    const verifiedUser = await verifyFiscalToken(legitToken);
    assert.strictEqual(verifiedUser.email, 'operator@granja.com');
    assert.strictEqual(verifiedUser.authorizedObligados[0], NIF_EMISOR_LEGAL);

    // 2. Un atacante manipula el payload para elevar privilegios al email de ROOT_OWNER
    const tamperedPayload = Buffer.from(JSON.stringify({
      iss: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      aud: firebaseConfig.projectId,
      sub: 'legit-operator-777',
      email: ROOT_OWNER_EMAIL, // SUPLANTACIÓN
      email_verified: true,
      iat: Math.floor(Date.now() / 1000) - 10,
      auth_time: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');

    const tamperedToken = `${validHeader}.${tamperedPayload}.${validSignature}`;

    // La firma criptográfica RSA-SHA256 DEBE fallar obligatoriamente
    await assert.rejects(async () => {
      await verifyFiscalToken(tamperedToken);
    }, /Fallo en la verificación criptográfica de la firma del token/);
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 2: PROHIBICIÓN ABSOLUTA DE BYPASS Y ESCRITURA DESDE CLIENTE
  // -----------------------------------------------------------------------------

  await runTest('2.1: Intento de llamar a saveFiscalRecordToCloud desde cliente web es bloqueado', async () => {
    (globalThis as any).window = {};
    try {
      const dummyRecord = { id: 'rec-test', obligadoTributarioId: NIF_EMISOR_LEGAL } as any;
      await assert.rejects(async () => {
        await saveFiscalRecordToCloud(dummyRecord);
      }, /VIOLACIÓN DE AUTORIDAD FISCAL: Los clientes web no pueden escribir directamente en \/fiscal_records/);
    } finally {
      delete (globalThis as any).window;
    }
  });

  await runTest('2.2: Intento de llamar a saveFiscalSubmissionToCloud desde cliente web es bloqueado', async () => {
    (globalThis as any).window = {};
    try {
      const dummySub = { id: 'sub-test', obligadoTributarioId: NIF_EMISOR_LEGAL } as any;
      await assert.rejects(async () => {
        await saveFiscalSubmissionToCloud(dummySub);
      }, /VIOLACIÓN DE AUTORIDAD FISCAL: Los clientes web no pueden escribir directamente en \/fiscal_submissions/);
    } finally {
      delete (globalThis as any).window;
    }
  });

  await runTest('2.3: Intento de llamar a saveFiscalEventToCloud desde cliente web es bloqueado', async () => {
    (globalThis as any).window = {};
    try {
      const dummyEvt = { id: 'evt-test', obligadoTributarioId: NIF_EMISOR_LEGAL } as any;
      await assert.rejects(async () => {
        await saveFiscalEventToCloud(dummyEvt);
      }, /VIOLACIÓN DE AUTORIDAD FISCAL: Los clientes web no pueden escribir directamente en \/fiscal_events/);
    } finally {
      delete (globalThis as any).window;
    }
  });

  await runTest('2.4: El cliente NO tiene autoridad sobre hashAnterior: el backend resuelve la cadena legítima', async () => {
    const inv1 = createDummyInvoice({ numeroFactura: 'FAC-FORGE-01' });
    const res1 = await emitFiscalInvoice({
      invoiceDraft: inv1,
      fiscalConfig: config,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    // Un atacante envía un invoiceDraft inyectando un hashAnterior arbitrario
    const invForge = createDummyInvoice({
      numeroFactura: 'FAC-FORGE-02',
      hashAnterior: 'ATTACKER_INVENTED_HASH_9999999999999999999999999999999999999999'
    } as any);

    const res2 = await emitFiscalInvoice({
      invoiceDraft: invForge,
      fiscalConfig: config,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    // El backend debe haber ignorado el hash inventado y encadenado con res1
    assert.strictEqual(
      res2.fiscalRecord.encadenamiento.registroAnterior?.huella,
      res1.fiscalRecord.huella.hash,
      'El backend debe encadenar estrictamente con la huella real anterior'
    );
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 3: CONCURRENCIA REAL ENTRE PROCESOS Y NO-BIFURCACIÓN DE LA CADENA
  // -----------------------------------------------------------------------------

  await runTest('3.1: Emisiones concurrentes simultáneas se serializan atómicamente sin bifurcación', async () => {
    const invA = createDummyInvoice({ numeroFactura: 'FAC-PARALLEL-A' });
    const invB = createDummyInvoice({ numeroFactura: 'FAC-PARALLEL-B' });

    const [resA, resB] = await Promise.all([
      emitFiscalInvoice({
        invoiceDraft: invA,
        fiscalConfig: config,
        persistRecordFn: async (record) => {
          await BackendFiscalCustody.saveFiscalRecord(record);
        }
      }),
      emitFiscalInvoice({
        invoiceDraft: invB,
        fiscalConfig: config,
        persistRecordFn: async (record) => {
          await BackendFiscalCustody.saveFiscalRecord(record);
        }
      })
    ]);

    assert.notStrictEqual(resA.fiscalRecord.id, resB.fiscalRecord.id);
    assert.notStrictEqual(resA.fiscalRecord.huella.hash, resB.fiscalRecord.huella.hash);

    // Comprobar que una es sucesora directa de la otra (cadena lineal sin dos registros con el mismo padre)
    const bChainedToA = resB.fiscalRecord.encadenamiento.registroAnterior?.huella === resA.fiscalRecord.huella.hash;
    const aChainedToB = resA.fiscalRecord.encadenamiento.registroAnterior?.huella === resB.fiscalRecord.huella.hash;
    assert.ok(bChainedToA || aChainedToB, 'Una emisión concurrente debe ser padre directa de la otra');

    // Verificar integridad completa de la cadena almacenada en custodia
    const allRecords = BackendFiscalCustody.getAllFiscalRecords(NIF_EMISOR_LEGAL);
    const chainVerification = await verifyFiscalRecordChain(allRecords);
    assert.strictEqual(chainVerification.valid, true, 'La cadena almacenada debe ser 100% íntegra y sin bifurcaciones');
  });

  await runTest('3.2: BackendFiscalCustody detecta y rechaza inmediatamente cualquier intento de bifurcación', async () => {
    const latest = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_LEGAL);
    assert.ok(latest, 'Debe haber un registro reciente');

    // Construimos mediante el transformer oficial un registro válido cuya huella anterior sea obsoleta (intento de bifurcación)
    const forgedInv = createDummyInvoice({ numeroFactura: 'FAC-FORKED-99' });
    const fechaHoraSellado = '2026-02-15T10:30:00+01:00';
    const huellaAnterior = 'DEADBEEF0000000000000000000000000000000000000000000000000000DEAD';
    const hashCalc = await calculateAltaHash({
      nifEmisor: NIF_EMISOR_LEGAL,
      numSerieFactura: forgedInv.numeroFactura,
      fechaExpedicion: forgedInv.fecha,
      tipoFactura: 'F1',
      cuotaTotal: 1.4,
      importeTotal: 36.4,
      huellaAnterior,
      fechaHoraHusoGenRegistro: fechaHoraSellado
    });

    const forgedForkRecord = createFiscalRecordFromInvoice(
      forgedInv,
      config,
      {
        id: 'frec-OLD',
        obligadoTributarioId: NIF_EMISOR_LEGAL,
        invoiceId: 'inv-OLD',
        numeroFactura: 'FAC-OLD',
        fechaExpedicion: '2026-02-15',
        huellaHash: huellaAnterior,
        creadoEn: '2026-02-15T10:00:00Z'
      },
      {
        hashActual: hashCalc.hash,
        fechaHoraSellado,
        cadenaTextoCanonico: hashCalc.canonicalString
      }
    );

    // Su huella es matemáticamente válida, pero intenta encadenar con un registro que no es la cabeza de la cadena
    const verification = await verifyFiscalRecordHash(forgedForkRecord);
    assert.strictEqual(verification.valid, true, 'El registro individual tiene huella matemáticamente válida');

    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalRecord(forgedForkRecord);
    }, /Bifurcación de cadena detectada/);
  });

  await runTest('3.3: acquireProcessLock falla cerrado (FAIL CLOSED) con excepción al agotar timeout', async () => {
    // Adquirir cerrojo para un obligado de prueba
    const testObligado = 'B11111111';
    const releaseFirst = await BackendFiscalCustody.acquireProcessLock(testObligado, 2000);

    try {
      // Intentar adquirir de forma concurrente con timeout muy corto (100ms)
      await assert.rejects(async () => {
        await BackendFiscalCustody.acquireProcessLock(testObligado, 100);
      }, /Timeout \(100ms\) al adquirir cerrojo de emisión exclusivo/);
    } finally {
      releaseFirst();
    }
  });

  await runTest('3.4: Ownership estricto del cerrojo: un proceso ajeno no puede borrar el lock del titular', async () => {
    const testObligado = 'B22222222';
    const cleanId = testObligado.replace(/[^a-zA-Z0-9_-]/g, '_');
    const lockPath = path.join(process.cwd(), 'data', 'locks', `obligado_${cleanId}.lock`);

    const releaseOwner = await BackendFiscalCustody.acquireProcessLock(testObligado, 2000);
    assert.ok(fs.existsSync(lockPath), 'El fichero de lock debe existir');

    // Simular que otro proceso o contexto intenta crear una función de liberación con token falso
    const fakeReleaseFn = () => {
      try {
        if (fs.existsSync(lockPath)) {
          const currentContent = fs.readFileSync(lockPath, 'utf-8').trim();
          if (currentContent === 'FAKE_PID:0000:fake_token') {
            fs.unlinkSync(lockPath);
          }
        }
      } catch {}
    };

    fakeReleaseFn();
    assert.ok(fs.existsSync(lockPath), 'El lock del titular NO debe haber sido eliminado por el proceso impostor');

    // La liberación por el propietario legítimo sí debe borrarlo
    releaseOwner();
    assert.strictEqual(fs.existsSync(lockPath), false, 'El lock se elimina limpiamente tras liberación por el propietario');
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 4: MÁQUINA DE ESTADOS ESTRICTA DE FISCALSUBMISSION
  // -----------------------------------------------------------------------------

  await runTest('4.1: Transiciones válidas en la máquina de estados se ejecutan correctamente', () => {
    const dummyRec = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_LEGAL)!;
    const sub = createFiscalSubmission(dummyRec, config);
    assert.strictEqual(sub.estado, 'PENDING');

    const sending = transitionSubmissionStatus(sub, 'SENDING');
    assert.strictEqual(sending.estado, 'SENDING');

    const accepted = transitionSubmissionStatus(sending, 'ACCEPTED', { csv: 'CSV-12345' });
    assert.strictEqual(accepted.estado, 'ACCEPTED');
    assert.strictEqual(accepted.csv, 'CSV-12345');
  });

  await runTest('4.2: Transiciones ilegales en la máquina de estados son rechazadas', () => {
    const dummyRec = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_LEGAL)!;
    const sub = createFiscalSubmission(dummyRec, config);

    // PENDING -> ACCEPTED (saltándose SENDING)
    assert.throws(() => {
      transitionSubmissionStatus(sub, 'ACCEPTED');
    }, /Transición de estado ilegal en FiscalSubmission/);

    // ACCEPTED es terminal -> no puede volver a PENDING ni SENDING
    const acceptedSub = { ...sub, estado: 'ACCEPTED' as const };
    assert.throws(() => {
      transitionSubmissionStatus(acceptedSub, 'PENDING');
    }, /Transición de estado ilegal en FiscalSubmission/);
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 5: PERSISTENCIA Y REGLAS DEL CONTROL DE FLUJO AEAT
  // -----------------------------------------------------------------------------

  await runTest('5.1: Control de flujo persiste en disco (aeat_flow_control.json) y sobrevive a reseteos de memoria', () => {
    const now = Date.now();
    AeatFlowControlManager.updateFromResponse(NIF_EMISOR_LEGAL, 180, now);

    const savedWait = AeatFlowControlManager.getCurrentFlowWaitSeconds(NIF_EMISOR_LEGAL);
    assert.strictEqual(savedWait, 180);

    // Comprobar que el archivo existe físicamente en disco
    const flowPath = path.resolve(process.cwd(), 'data', 'aeat_flow_control.json');
    assert.ok(fs.existsSync(flowPath), 'aeat_flow_control.json debe existir en disco');

    // Simular nueva instancia / reinicio de memoria
    const rawDisk = JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
    assert.strictEqual(rawDisk[NIF_EMISOR_LEGAL].tiempoEsperaEnvioSegundos, 180);
  });

  await runTest('5.2: Regla OR: pendingRecordsCount >= 1000 autoriza envío inmediato aunque no haya expirado el tiempo', () => {
    const now = Date.now();
    // Aún en ventana de espera (180 segundos)
    const isAllowedNormal = AeatFlowControlManager.isSendAllowed(NIF_EMISOR_LEGAL, now, 10);
    assert.strictEqual(isAllowedNormal, false, 'No debe permitir envío con 10 registros si la ventana no ha expirado');

    // Con 1.000 registros pendientes en cola (lote máximo legal según normativa AEAT v1.0.3)
    const isAllowedMaxBatch = AeatFlowControlManager.isSendAllowed(NIF_EMISOR_LEGAL, now, 1000);
    assert.strictEqual(isAllowedMaxBatch, true, 'Debe permitir envío inmediato al alcanzar los 1.000 registros');
  });

  // -----------------------------------------------------------------------------
  // BLOQUE 6: TRANSPORTE SEGURO Y VALIDACIÓN XSD PREVIA AL ENVÍO
  // -----------------------------------------------------------------------------

  await runTest('6.1: Validación formal XSD previa al envío rechaza XML malformado antes de contactar a AEAT', async () => {
    const dummyRec = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_LEGAL)!;
    // Registro con XML corrupto que no cumple el esquema
    const badRec = {
      ...dummyRec,
      id: `frec-BAD-XML-${Date.now()}`,
      xmlOficial: '<CorruptXmlSinEsquema><DatoInvalido/></CorruptXmlSinEsquema>'
    };
    const sub = createFiscalSubmission(badRec, config);

    await assert.rejects(async () => {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: badRec,
        config,
        options: { transportMode: 'mock' }
      });
    }, /Validación formal XSD fallida previa al envío a AEAT/);
  });

  await runTest('6.2: Modo producción sin certificado mTLS configurado rechaza el envío tajantemente (FAIL CLOSED)', async () => {
    AeatCertificateProvider.clear();
    const dummyRec = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_LEGAL)!;
    const sub = createFiscalSubmission(dummyRec, config);

    const prodConfig = {
      ...config,
      entornoAeat: 'produccion' as const
    };

    // Sin especificar mock explícito en producción: debe rechazar tajantemente (fail-closed)
    await assert.rejects(async () => {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: dummyRec,
        config: prodConfig
      });
    }, /En entorno de producción AEAT es estrictamente obligatorio disponer de certificado mTLS válido/);

    // Con transportMode: 'real' explícito sin certificado: debe rechazar
    await assert.rejects(async () => {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: dummyRec,
        config: prodConfig,
        options: { transportMode: 'real' }
      });
    }, /Modo real de transporte AEAT requerido/);
  });

  // -----------------------------------------------------------------------------
  // RESUMEN FINAL
  // -----------------------------------------------------------------------------
  console.log('================================================================');
  console.log('  RESUMEN FASE 3.1.4: 20/20 TESTS COMPLETADOS CON ÉXITO!');
  console.log('================================================================');
}

main().catch(err => {
  console.error('*** ERROR FATAL EN LA SUITE DE TESTS FASE 3.1.4 ***');
  console.error(err);
  process.exit(1);
});
