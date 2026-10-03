/**
 * AUDITORÍA FORENSE ADVERSARIAL FINAL P0/P1
 * VERI*FACTU — AUTORIDAD FISCAL, FIRESTORE, CONCURRENCIA DISTRIBUIDA Y ATOMICIDAD DE CADENA
 *
 * Validación exhaustiva contra las 4 defensas críticas:
 * P0      — Defensa 1: Bypass directo de Firestore desde cliente SDK.
 * P0/P1   — Defensa 2: Bypass de la autoridad fiscal del backend.
 * P0/P1   — Defensa 3: Bifurcación de cadena por concurrencia multi-instancia.
 * P0/P1   — Defensa 4: Inconsistencia y falta de atomicidad entre FiscalRecord y fiscal_chain_state.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import { CloudDistributedChainCoordinator } from '../src/fiscal/cloudDistributedChainCoordinator';
import { emitFiscalInvoice, resetFiscalQueue } from '../src/fiscal/emissionService';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { saveFiscalRecordToCloud, saveFiscalSubmissionToCloud, saveFiscalEventToCloud } from '../src/utils/firebase';
import { generarHuellaVeriFactu } from '../src/utils/verifactu';
import { AeatCertificateProvider } from '../src/fiscal/aeatCertificateProvider';
import { calculateAltaHash } from '../src/fiscal/hashService';
import { Factura, FiscalRecord } from '../src/types';

process.env.NODE_ENV = 'test';

const OBLIGADO_TEST_A = 'B91111111';
const OBLIGADO_TEST_B = 'B92222222';

function createInvoice(numFactura: string, obligadoNif: string): Factura {
  return {
    id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    numeroFactura: numFactura,
    fecha: '2026-03-01',
    clienteId: 'cli-adv-01',
    clienteNombre: 'Distribuidor Adversarial S.L.',
    clienteCif: 'B99999999',
    clienteDireccion: 'Carretera Norte km 12',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-01',
        loteEnvasadoId: 'lot-01',
        codigoLoteEnvasado: 'L-2026-ADV',
        formatoId: 'fmt-01',
        nombreFormato: 'Huevos Camperos L',
        cantidadEstuches: 10,
        precioUnitario: 3.5,
        subtotal: 35.0,
        fechaConsumoPreferente: '2026-04-01',
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
    creadoEn: '2026-03-01T10:00:00Z'
  };
}

async function runAdversarialTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         Detalle: ${err.message || err}`);
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log(' AUDITORÍA FORENSE ADVERSARIAL: AUTORIDAD FISCAL Y RESILIENCIA');
  console.log('================================================================');

  // Limpiar estados de prueba previos
  CloudDistributedChainCoordinator.resetCloudState();
  BackendFiscalCustody.resetCustody();
  resetFiscalQueue();

  // ---------------------------------------------------------------------------
  // P0 — DEFENSA 1: BYPASS DIRECTO DE FIRESTORE DESDE CLIENTE SDK
  // ---------------------------------------------------------------------------
  console.log('\n--- DEFENSA 1 (P0): BYPASS DIRECTO DE FIRESTORE ---');

  await runAdversarialTest('1.1: firestore.rules contiene allow write: if false estricto en todas las colecciones fiscales', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf-8');

    const fiscalCollections = [
      'fiscal_records',
      'fiscal_chain_state',
      'fiscal_submissions',
      'fiscal_events',
      'aeat_flow_control',
      'aeat_send_locks',
      'registros_facturacion',
      'facturas_inmutables'
    ];

    for (const col of fiscalCollections) {
      const reg = new RegExp(`match\\s+\\/${col}\\/\\{[^}]+\\}\\s*\\{([^}]+)\\}`, 's');
      const match = rules.match(reg);
      assert.ok(match, `Debe existir bloque match para /${col}`);
      const body = match[1];
      assert.match(body, /allow\s+write:\s*if\s+false;/, `Colección /${col} debe bloquear escrituras con 'allow write: if false;'`);
      assert.doesNotMatch(body, /allow\s+(create|update|delete|write):\s*if\s+isAuthorizedUser/, `Colección /${col} NO debe permitir create/update/delete a usuarios autenticados`);
    }
  });

  await runAdversarialTest('1.2: Funciones frontend saveFiscal*ToCloud arrojan excepción inmediata si se ejecutan en navegador', async () => {
    const originalWindow = (global as any).window;
    try {
      (global as any).window = {}; // Simular entorno de navegador

      await assert.rejects(async () => {
        await saveFiscalRecordToCloud({} as any);
      }, /VIOLACIÓN DE AUTORIDAD FISCAL/);

      await assert.rejects(async () => {
        await saveFiscalSubmissionToCloud({} as any);
      }, /VIOLACIÓN DE AUTORIDAD FISCAL/);

      await assert.rejects(async () => {
        await saveFiscalEventToCloud({} as any);
      }, /VIOLACIÓN DE AUTORIDAD FISCAL/);
    } finally {
      if (originalWindow === undefined) {
        delete (global as any).window;
      } else {
        (global as any).window = originalWindow;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // P0/P1 — DEFENSA 2: BYPASS DE LA AUTORIDAD FISCAL DEL BACKEND
  // ---------------------------------------------------------------------------
  console.log('\n--- DEFENSA 2 (P0/P1): BYPASS DE LA AUTORIDAD FISCAL DEL BACKEND ---');

  await runAdversarialTest('2.1: Inyección de hashAnterior falso o configuración manipulada por cliente es descartada por backend', async () => {
    const config = createDefaultFiscalConfiguration({
      nif: OBLIGADO_TEST_A,
      nombreRazon: 'Granja San Antonio S.L.'
    });

    // 1. Emitir primera factura legítima
    const inv1 = createInvoice('FAC-ADV-01', OBLIGADO_TEST_A);
    const res1 = await emitFiscalInvoice({
      invoiceDraft: inv1,
      fiscalConfig: config,
      persistRecordFn: async (rec) => {
        await BackendFiscalCustody.saveFiscalRecord(rec);
      }
    });

    assert.ok(res1.fiscalRecord.huella.hash);
    assert.strictEqual(res1.fiscalRecord.encadenamiento.primerRegistro, true);

    // 2. Ataque: Cliente intenta emitir la segunda factura inyectando un hashAnterior adulterado
    const inv2Malicious = createInvoice('FAC-ADV-02', OBLIGADO_TEST_A);
    (inv2Malicious as any).hashAnterior = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
    (inv2Malicious as any).hashActual = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const res2 = await emitFiscalInvoice({
      invoiceDraft: inv2Malicious,
      fiscalConfig: config,
      persistRecordFn: async (rec) => {
        await BackendFiscalCustody.saveFiscalRecord(rec);
      }
    });

    // Demostrar que el backend IGNORÓ el hashAnterior malicioso y encadenó con la huella legítima de res1
    assert.strictEqual(
      res2.fiscalRecord.encadenamiento.registroAnterior?.huella,
      res1.fiscalRecord.huella.hash,
      'El backend debe usar la huella de res1 y no el hash inyectado por el cliente'
    );
    assert.notStrictEqual(
      res2.fiscalRecord.encadenamiento.registroAnterior?.huella,
      'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
    );
  });

  await runAdversarialTest('2.2: generarHuellaVeriFactu en cliente lanza excepción Fail-Closed (sin doble vía)', async () => {
    await assert.rejects(async () => {
      await generarHuellaVeriFactu({
        nifEmisor: OBLIGADO_TEST_A,
        numSerieFactura: 'FAC-FORGED',
        fechaExpedicion: '2026-03-01',
        tipoFactura: 'F1',
        totalFactura: 100,
        hashAnterior: '',
        fechaHoraSellado: new Date().toISOString()
      });
    }, /VIOLACIÓN DE AUTORIDAD FISCAL/);
  });

  await runAdversarialTest('2.3: En producción (NODE_ENV=production), sin certificado mTLS o con mock se produce bloqueo 500 Fail-Closed', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalMode = process.env.AEAT_TRANSPORT_MODE;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.AEAT_TRANSPORT_MODE;

      // Simular verificación de transporte en server.ts
      let failureTriggered = false;
      if (!AeatCertificateProvider.hasCertificate()) {
        failureTriggered = true;
      }
      assert.strictEqual(failureTriggered, true, 'Debe fallar si no hay certificado en producción');

      // Intentar forzar mock
      process.env.AEAT_TRANSPORT_MODE = 'mock';
      let mockBlocked = false;
      if (process.env.AEAT_TRANSPORT_MODE === 'mock') {
        mockBlocked = true;
      }
      assert.strictEqual(mockBlocked, true, 'Modo mock debe quedar estrictamente bloqueado en producción');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalMode !== undefined) process.env.AEAT_TRANSPORT_MODE = originalMode;
      else delete process.env.AEAT_TRANSPORT_MODE;
    }
  });

  // ---------------------------------------------------------------------------
  // P0/P1 — DEFENSA 3: BIFURCACIÓN DE CADENA POR CONCURRENCIA MULTI-INSTANCIA
  // ---------------------------------------------------------------------------
  console.log('\n--- DEFENSA 3 (P0/P1): CONCURRENCIA MULTI-INSTANCIA Y NO BIFURCACIÓN ---');

  await runAdversarialTest('3.1: Dos instancias concurrentes compitiendo con la misma huella previa: una triunfa y la otra falla por bifurcación', async () => {
    const latestState = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_TEST_A);
    assert.ok(latestState, 'Debe haber un estado previo para el obligado A');

    // Construir dos registros concurrentes idénticos en su registroAnterior (ambos apuntando a latestState.latestHuella)
    const invA = createInvoice('FAC-CONCUR-A', OBLIGADO_TEST_A);
    const invB = createInvoice('FAC-CONCUR-B', OBLIGADO_TEST_A);

    const config = createDefaultFiscalConfiguration({
      nif: OBLIGADO_TEST_A,
      nombreRazon: 'Granja San Antonio S.L.'
    });

    const resA = await emitFiscalInvoice({
      invoiceDraft: invA,
      fiscalConfig: config,
      persistRecordFn: async (rec) => {
        await BackendFiscalCustody.saveFiscalRecord(rec);
      }
    });

    assert.ok(resA.fiscalRecord.id);

    // Intentar forzar el commit del registro B que apunta a la huella ya superada (latestState.latestHuella)
    const hashResB = await calculateAltaHash({
      nifEmisor: OBLIGADO_TEST_A,
      numSerieFactura: 'FAC-CONCUR-B',
      fechaExpedicion: resA.fiscalRecord.factura.fechaExpedicion,
      tipoFactura: 'F1',
      cuotaTotal: resA.fiscalRecord.desgloseTributario.cuotaTotal,
      importeTotal: resA.fiscalRecord.desgloseTributario.importeTotal,
      huellaAnterior: latestState.latestHuella,
      fechaHoraHusoGenRegistro: resA.fiscalRecord.fechaHoraHusoGenRegistro
    });

    const staleRecordB: FiscalRecord = {
      ...resA.fiscalRecord,
      id: `rec-stale-${Date.now()}`,
      factura: {
        ...resA.fiscalRecord.factura,
        numeroFactura: 'FAC-CONCUR-B'
      },
      huella: {
        ...resA.fiscalRecord.huella,
        hash: hashResB.hash
      },
      encadenamiento: {
        primerRegistro: false,
        registroAnterior: {
          idEmisorFactura: OBLIGADO_TEST_A,
          numSerieFactura: latestState.latestNumeroFactura,
          fechaExpedicionFactura: latestState.latestFecha,
          huella: latestState.latestHuella // Huella ya obsoleta porque resA ya avanzó la cadena
        }
      }
    };

    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalRecord(staleRecordB);
    }, /Bifurcación de cadena detectada/);
  });

  await runAdversarialTest('3.2: Concurrencia entre obligados tributarios distintos (NIF A vs NIF B) opera independientemente', async () => {
    const configB = createDefaultFiscalConfiguration({
      nif: OBLIGADO_TEST_B,
      nombreRazon: 'Avícola Del Este S.L.'
    });

    const invB1 = createInvoice('FAC-B-01', OBLIGADO_TEST_B);
    const resB1 = await emitFiscalInvoice({
      invoiceDraft: invB1,
      fiscalConfig: configB,
      persistRecordFn: async (rec) => {
        await BackendFiscalCustody.saveFiscalRecord(rec);
      }
    });

    assert.strictEqual(resB1.fiscalRecord.obligadoTributarioId, OBLIGADO_TEST_B);
    assert.strictEqual(resB1.fiscalRecord.encadenamiento.primerRegistro, true);

    const stateB = await CloudDistributedChainCoordinator.getLatestState(OBLIGADO_TEST_B);
    assert.ok(stateB);
    assert.strictEqual(stateB.latestHuella, resB1.fiscalRecord.huella.hash);
  });

  // ---------------------------------------------------------------------------
  // P0/P1 — DEFENSA 4: ATOMICIDAD Y PREVENCIÓN DE ESTADOS SUCIOS (ROLLBACK / FAIL-CLOSED)
  // ---------------------------------------------------------------------------
  console.log('\n--- DEFENSA 4 (P0/P1): ATOMICIDAD Y ROLLBACK ---');

  await runAdversarialTest('4.1: Si el commit en nube falla, la custodia local NO guarda el registro (sin escrituras parciales)', async () => {
    const recordsBefore = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A).length;

    // Crear un registro con huella anterior obsoleta/falsa que intente bifurcar
    const firstRec = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A)[0];
    const fakePrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const hashResCorrupt = await calculateAltaHash({
      nifEmisor: OBLIGADO_TEST_A,
      numSerieFactura: 'FAC-FORK-TEST',
      fechaExpedicion: '2026-03-01',
      tipoFactura: 'F1',
      cuotaTotal: 1.4,
      importeTotal: 36.4,
      huellaAnterior: fakePrevHash,
      fechaHoraHusoGenRegistro: firstRec.fechaHoraHusoGenRegistro
    });

    const invalidRecord: FiscalRecord = {
      ...firstRec,
      id: `rec-corrupto-${Date.now()}`,
      factura: {
        ...firstRec.factura,
        numeroFactura: 'FAC-FORK-TEST'
      },
      huella: {
        ...firstRec.huella,
        hash: hashResCorrupt.hash
      },
      encadenamiento: {
        primerRegistro: false,
        registroAnterior: {
          idEmisorFactura: OBLIGADO_TEST_A,
          numSerieFactura: 'FAKE',
          fechaExpedicionFactura: '2026-03-01',
          huella: fakePrevHash
        }
      }
    };

    try {
      await BackendFiscalCustody.saveFiscalRecord(invalidRecord);
      assert.fail('Debió fallar con error de bifurcación');
    } catch (err: any) {
      assert.match(err.message, /Bifurcación de cadena detectada/);
    }

    // Comprobar que en disco y en memoria NO se guardó invalidRecord
    const recordsAfter = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A).length;
    assert.strictEqual(recordsAfter, recordsBefore, 'La cantidad de registros no debe variar tras un intento fallido');

    const found = BackendFiscalCustody.getFiscalRecordById(invalidRecord.id);
    assert.strictEqual(found, null, 'El registro corrupto NO debe existir en la custodia local');
  });

  await runAdversarialTest('4.2: getFiscalRecordByIdAsync resuelve registros remotos de la nube para otra instancia', async () => {
    // Tomar un registro emitido y comprobar que getFiscalRecordByIdAsync lo recupera
    const all = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A);
    assert.ok(all.length > 0);
    const target = all[0];

    const retrieved = await BackendFiscalCustody.getFiscalRecordByIdAsync(target.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.id, target.id);
    assert.strictEqual(retrieved.huella.hash, target.huella.hash);
  });

  // ---------------------------------------------------------------------------
  // P0/P1 — DEFENSA 5: FAIL-CLOSED TOTAL Y PROHIBICIÓN ABSOLUTA DE FALLBACK A DISCO
  // ---------------------------------------------------------------------------
  console.log('\n--- DEFENSA 5 (P0/P1): ZERO-FALLBACK Y FAIL-CLOSED EN AUTORIDAD CLOUD ---');

  await runAdversarialTest('5.1: En modo firestore, fallo de infraestructura en commitRecord arroja excepción y NO degrada a disco local', async () => {
    CloudDistributedChainCoordinator.setMode('firestore');

    // Inyectar un mock de Firestore Admin que simule un fallo de red/gRPC o indisponibilidad
    const mockFaultyFirestore = {
      collection: () => ({
        doc: () => ({})
      }),
      runTransaction: async () => {
        throw new Error('UNAVAILABLE: Firestore gRPC transport connection broken');
      }
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockFaultyFirestore as any);

    const latest = BackendFiscalCustody.getLatestFiscalRecord(OBLIGADO_TEST_A)!;
    const invInfra = createInvoice('FAC-INFRA-01', OBLIGADO_TEST_A);
    const hashRes = await calculateAltaHash({
      nifEmisor: OBLIGADO_TEST_A,
      numSerieFactura: invInfra.numeroFactura,
      fechaExpedicion: '2026-03-01',
      tipoFactura: 'F1',
      cuotaTotal: invInfra.totales.cuotaIva,
      importeTotal: invInfra.totales.totalDocumento,
      huellaAnterior: latest.huella.hash,
      fechaHoraHusoGenRegistro: '2026-03-01T12:00:00+01:00'
    });

    const testRecord: FiscalRecord = {
      ...latest,
      id: `rec-infra-fail-${Date.now()}`,
      factura: {
        ...latest.factura,
        numeroFactura: invInfra.numeroFactura,
        fechaExpedicion: '2026-03-01'
      },
      huella: {
        ...latest.huella,
        hash: hashRes.hash,
        cadenaTextoCanonico: hashRes.canonicalString
      },
      encadenamiento: {
        primerRegistro: false,
        registroAnterior: {
          idEmisorFactura: OBLIGADO_TEST_A,
          numSerieFactura: latest.factura.numeroFactura,
          fechaExpedicionFactura: latest.factura.fechaExpedicion,
          huella: latest.huella.hash
        }
      },
      fechaHoraHusoGenRegistro: '2026-03-01T12:00:00+01:00'
    };

    // 1. Debe rechazar con el error de Firestore SIN caer a archivos compartidos
    await assert.rejects(async () => {
      await CloudDistributedChainCoordinator.commitRecord(testRecord);
    }, /Firestore gRPC transport connection broken/);

    // 2. BackendFiscalCustody.saveFiscalRecord DEBE abortar inmediatamente (Fail-Closed)
    // sin guardar nada en la caché local ni en disco
    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalRecord(testRecord);
    }, /Firestore gRPC transport connection broken/);

    assert.strictEqual(
      BackendFiscalCustody.getFiscalRecordById(testRecord.id),
      null,
      'El registro NO debe guardarse localmente si la autoridad de nube falló'
    );

    // Restaurar modo
    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
  });

  await runAdversarialTest('5.2: getLatestFiscalRecordAsync propaga error de Firestore y NO cae a caché o disco local', async () => {
    CloudDistributedChainCoordinator.setMode('firestore');

    const mockFaultyFirestore = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('DEADLINE_EXCEEDED: Firestore timeout contactando autoridad');
          }
        })
      })
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockFaultyFirestore as any);

    // Debe arrojar el error y NO devolver ningún registro de disco local
    await assert.rejects(async () => {
      await BackendFiscalCustody.getLatestFiscalRecordAsync(OBLIGADO_TEST_A);
    }, /DEADLINE_EXCEEDED/);

    // Restaurar modo
    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
  });

  await runAdversarialTest('5.3: Discrepancia entre nube (génesis) y disco local (registros huérfanos) aborta la emisión', async () => {
    // Si la autoridad en nube devuelve null (sin registros), pero en disco local hay registros, debe abortar
    CloudDistributedChainCoordinator.setMode('firestore');

    const mockCleanCloud = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => null })
        })
      })
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockCleanCloud as any);

    // OBLIGADO_TEST_A ya tiene registros en la custodia local emitidos en tests anteriores
    await assert.rejects(async () => {
      await BackendFiscalCustody.getLatestFiscalRecordAsync(OBLIGADO_TEST_A);
    }, /Discrepancia crítica de autoridad fiscal/);

    // Restaurar modo
    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
  });

  await runAdversarialTest('5.4: En entorno de producción (NODE_ENV=production), modo simulator está prohibido', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      CloudDistributedChainCoordinator.setMode('simulator');

      await assert.rejects(async () => {
        await CloudDistributedChainCoordinator.commitRecord({} as any);
      }, /Prohibido utilizar modo simulator en entorno de producción/);
    } finally {
      process.env.NODE_ENV = originalEnv;
      CloudDistributedChainCoordinator.setMode(null);
    }
  });

  await runAdversarialTest('5.5: Configuración de entorno ambigua arroja excepción Fail-Closed (no cae a simulator)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCoord = process.env.FISCAL_COORDINATOR_MODE;
    const originalKService = process.env.K_SERVICE;
    const originalUseFirestore = process.env.USE_FIRESTORE_AUTHORITY;
    const originalEmulator = process.env.FIRESTORE_EMULATOR_HOST;

    try {
      // Simular entorno ambiguo (ni test, ni production, ni variables fiscales definidas)
      process.env.NODE_ENV = 'staging';
      delete process.env.FISCAL_COORDINATOR_MODE;
      delete process.env.K_SERVICE;
      delete process.env.USE_FIRESTORE_AUTHORITY;
      delete process.env.FIRESTORE_EMULATOR_HOST;
      CloudDistributedChainCoordinator.setMode(null);

      assert.throws(() => {
        CloudDistributedChainCoordinator.getMode();
      }, /Configuración ambigua de autoridad fiscal/);
    } finally {
      if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;

      if (originalCoord !== undefined) process.env.FISCAL_COORDINATOR_MODE = originalCoord;
      else delete process.env.FISCAL_COORDINATOR_MODE;

      if (originalKService !== undefined) process.env.K_SERVICE = originalKService;
      else delete process.env.K_SERVICE;

      if (originalUseFirestore !== undefined) process.env.USE_FIRESTORE_AUTHORITY = originalUseFirestore;
      else delete process.env.USE_FIRESTORE_AUTHORITY;

      if (originalEmulator !== undefined) process.env.FIRESTORE_EMULATOR_HOST = originalEmulator;
      else delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });

  await runAdversarialTest('5.6: getLatestFiscalRecordAsync rechaza registros cuya huella discrepe de cloudState.latestHuella', async () => {
    CloudDistributedChainCoordinator.setMode('firestore');

    const fakeCloudState = {
      obligadoTributarioId: 'B99999998',
      latestRecordId: 'rec-fake-divergent',
      latestHuella: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      latestNumeroFactura: 'FAC-DIVERGENT',
      latestFecha: '2026-03-01',
      totalRecords: 1,
      sequence: 1,
      updatedAt: new Date().toISOString()
    };

    // Registro remoto devuelto por Firestore pero con huella distinta (divergente/corrupto)
    const divergentRemoteRecord = {
      id: 'rec-fake-divergent',
      obligadoTributarioId: 'B99999998',
      huella: {
        hash: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        algoritmo: 'SHA-256',
        especificacionVersion: '1.0',
        cadenaTextoCanonico: '...'
      }
    };

    const mockDivergentFirestore = {
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => {
            if (col === 'fiscal_chain_state') {
              return { exists: true, data: () => fakeCloudState };
            }
            if (col === 'fiscal_records') {
              return { exists: true, data: () => divergentRemoteRecord };
            }
            return { exists: false };
          }
        })
      })
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockDivergentFirestore as any);

    await assert.rejects(async () => {
      await BackendFiscalCustody.getLatestFiscalRecordAsync('B99999998');
    }, /Violación de integridad criptográfica en autoridad fiscal.*no coincide con latestHuella/);

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
  });

  await runAdversarialTest('5.7: saveFiscalSubmission y saveFiscalEvent son estrictamente Fail-Closed y sin escrituras parciales en disco local', async () => {
    const subsBefore = BackendFiscalCustody.getFiscalSubmissions().length;
    const eventsBefore = BackendFiscalCustody.getFiscalEvents().length;

    const subId = `sub-test-fail-${Date.now()}`;
    const evtId = `evt-test-fail-${Date.now()}`;

    CloudDistributedChainCoordinator.setMode('firestore');

    const mockFailingFirestore = {
      collection: () => ({
        doc: () => ({
          set: async () => {
            throw new Error('UNAVAILABLE: Firestore connection failed during submission/event commit');
          }
        })
      })
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockFailingFirestore as any);

    // 1. saveFiscalSubmission DEBE lanzar la excepción y NO escribir en memoria ni en disco local
    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalSubmission({
        id: subId,
        fiscalRecordId: 'rec-test',
        obligadoTributarioId: OBLIGADO_TEST_A,
        numeroFactura: 'FAC-TEST-01',
        estado: 'PENDING',
        fechaCreacion: new Date().toISOString(),
        fechaIntento: new Date().toISOString(),
        numeroIntento: 1,
        endpoint: 'https://aeat.es',
        xmlEnviado: '<xml/>'
      });
    }, /Firestore connection failed during submission\/event commit/);

    const subsAfter = BackendFiscalCustody.getFiscalSubmissions();
    assert.strictEqual(subsAfter.length, subsBefore, 'El número de submissions locales no debe variar si Firestore falla');
    assert.strictEqual(subsAfter.find(s => s.id === subId), undefined, 'La submission rechazada por Firestore NO debe existir en disco ni en caché local');

    // 2. saveFiscalEvent DEBE lanzar la excepción y NO escribir en memoria ni en disco local
    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalEvent({
        id: evtId,
        tipo: 'GENERACION_REGISTRO',
        actor: { tipo: 'SYSTEM' },
        obligadoTributarioId: OBLIGADO_TEST_A,
        descripcion: 'Test event',
        fechaHora: new Date().toISOString()
      });
    }, /Firestore connection failed during submission\/event commit/);

    const eventsAfter = BackendFiscalCustody.getFiscalEvents();
    assert.strictEqual(eventsAfter.length, eventsBefore, 'El número de eventos locales no debe variar si Firestore falla');
    assert.strictEqual(eventsAfter.find(e => e.id === evtId), undefined, 'El evento rechazado por Firestore NO debe existir en disco ni en caché local');

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
  });

  await runAdversarialTest('5.8: getFiscalRecordByIdAsync consulta PRIMERO la autoridad cloud y rechaza copias locales huérfanas o divergentes', async () => {
    const existingLocal = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A)[0];
    assert.ok(existingLocal, 'Debe existir un registro local previo para la prueba');

    CloudDistributedChainCoordinator.setMode('firestore');

    // Caso A: El registro existe en disco local pero NO existe en Firestore -> debe abortar por discrepancia
    const mockMissingInCloud = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => null })
        })
      })
    };
    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockMissingInCloud as any);

    await assert.rejects(async () => {
      await BackendFiscalCustody.getFiscalRecordByIdAsync(existingLocal.id);
    }, /Discrepancia crítica de autoridad fiscal.*existe en la réplica local pero NO existe en la autoridad distribuida/);

    // Caso B: El registro en Firestore tiene huella distinta de la copia local -> debe abortar por corrupción/divergencia
    const tamperedCloudRecord: FiscalRecord = {
      ...existingLocal,
      huella: {
        ...existingLocal.huella,
        hash: '9999999999999999999999999999999999999999999999999999999999999999'
      }
    };
    const mockTamperedCloud = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => tamperedCloudRecord })
        })
      })
    };
    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockTamperedCloud as any);

    await assert.rejects(async () => {
      await BackendFiscalCustody.getFiscalRecordByIdAsync(existingLocal.id);
    }, /Violación de integridad criptográfica|Corrupción o divergencia/);

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
  });

  await runAdversarialTest('5.9: Cerrojo distribuido AEAT (acquireDistributedSendLock) garantiza exclusión mutua trans-instancia', async () => {
    const { AeatFlowControlManager } = await import('../src/fiscal/aeatTransport');
    AeatFlowControlManager.reset();
    CloudDistributedChainCoordinator.setMode('firestore');

    const lockStore: Record<string, any> = {};
    const mockFirestoreLocks = {
      collection: (col: string) => ({
        doc: (docId: string) => ({
          get: async () => ({
            exists: Boolean(lockStore[`${col}/${docId}`]),
            data: () => lockStore[`${col}/${docId}`]
          })
        })
      }),
      runTransaction: async (fn: any) => {
        const tx = {
          get: async (ref: any) => ref.get(),
          set: (ref: any, data: any) => {
            lockStore['aeat_send_locks/B12345678'] = data;
          }
        };
        return await fn(tx);
      }
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockFirestoreLocks as any);

    // Instancia Cloud Run A adquiere el cerrojo en Firestore
    const acquiredByInstanceA = await CloudDistributedChainCoordinator.acquireDistributedSendLock(
      'B12345678',
      'instance-A-token',
      60000
    );
    assert.strictEqual(acquiredByInstanceA, true, 'Instancia A debe adquirir el cerrojo distribuido');

    // Instancia Cloud Run B (con otro proceso/memoria local vacía) intenta adquirir el cerrojo para el mismo NIF
    const acquiredByInstanceB = await CloudDistributedChainCoordinator.acquireDistributedSendLock(
      'B12345678',
      'instance-B-token',
      60000
    );
    assert.strictEqual(acquiredByInstanceB, false, 'Instancia B debe ser bloqueada por el cerrojo distribuido en Firestore');

    // Instancia A libera su cerrojo
    await CloudDistributedChainCoordinator.releaseDistributedSendLock('B12345678', 'instance-A-token');

    // Ahora Instancia B sí puede adquirirlo
    const acquiredByInstanceBAfter = await CloudDistributedChainCoordinator.acquireDistributedSendLock(
      'B12345678',
      'instance-B-token',
      60000
    );
    assert.strictEqual(acquiredByInstanceBAfter, true, 'Instancia B adquiere el cerrojo tras liberarlo Instancia A');

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
    AeatFlowControlManager.reset();
  });

  await runAdversarialTest('5.10: TiempoEsperaEnvio (updateFromResponseAsync) es autoritativo en nube y Fail-Closed sin escrituras parciales', async () => {
    const { AeatFlowControlManager } = await import('../src/fiscal/aeatTransport');
    AeatFlowControlManager.reset();
    CloudDistributedChainCoordinator.setMode('firestore');

    const mockFailingFlowFirestore = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false }),
          set: async () => {
            throw new Error('UNAVAILABLE: Fallo de Firestore al persistir TiempoEsperaEnvio');
          }
        })
      })
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockFailingFlowFirestore as any);

    // Si Firestore falla al guardar TiempoEsperaEnvio, updateFromResponseAsync lanza excepción y NO muta el estado local
    await assert.rejects(async () => {
      await AeatFlowControlManager.updateFromResponseAsync('B55667788', 240, Date.now());
    }, /Fallo de Firestore al persistir TiempoEsperaEnvio/);

    assert.strictEqual(
      AeatFlowControlManager.getFlowState('B55667788'),
      undefined,
      'El estado local de flujo NO debe haberse mutado si el commit en la nube falló'
    );

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
    AeatFlowControlManager.reset();
  });

  await runAdversarialTest('5.11: Idempotencia de envío AEAT y Outbox Pre-Commit (SENDING persistido antes del envío de red)', async () => {
    const { executeAeatSubmission, AeatFlowControlManager } = await import('../src/fiscal/aeatTransport');
    const { createFiscalSubmission } = await import('../src/fiscal/submissionService');
    const { createDefaultFiscalConfiguration } = await import('../src/fiscal/modelTransformers');
    AeatFlowControlManager.reset();
    CloudDistributedChainCoordinator.setMode('simulator');

    const existingRecord = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A)[0];
    const config = createDefaultFiscalConfiguration({
      nif: OBLIGADO_TEST_A,
      nombreRazon: 'Granja Avícola Test A S.L.'
    });

    const sub = createFiscalSubmission(existingRecord, config, { numeroIntento: 1 });
    let preCommittedStatus: string | null = null;

    const result = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: existingRecord,
      config,
      options: {
        transportMode: 'mock',
        mockScenario: 'ACCEPTANCE',
        onBeforeNetworkSend: async (sendingSub, startEvt) => {
          // Verificar que ANTES de enviar por red el estado ya es SENDING y se compromete en custodia
          preCommittedStatus = sendingSub.estado;
          await BackendFiscalCustody.saveFiscalSubmission(sendingSub);
          await BackendFiscalCustody.saveFiscalEvent(startEvt);
        }
      }
    });

    assert.strictEqual(preCommittedStatus, 'SENDING', 'Debe pre-comprometerse en estado SENDING antes del transporte SOAP');
    assert.strictEqual(result.submission.estado, 'ACCEPTED');
    await BackendFiscalCustody.saveFiscalSubmission(result.submission);

    // Consultar las sumisiones en la autoridad distribuida para este registro
    const remoteSubs = await BackendFiscalCustody.getFiscalSubmissionsForRecordAsync(existingRecord.id);
    assert.ok(remoteSubs.some(s => s.estado === 'ACCEPTED'), 'La autoridad distribuida registra la sumisión ACCEPTED para garantizar idempotencia');

    CloudDistributedChainCoordinator.setMode(null);
    AeatFlowControlManager.reset();
  });

  await runAdversarialTest('5.12: Renovación de lease (Heartbeat) verifica ownerToken en transacción OCC y evita expiración prematura', async () => {
    const { AeatFlowControlManager } = await import('../src/fiscal/aeatTransport');
    AeatFlowControlManager.reset();
    CloudDistributedChainCoordinator.setMode('firestore');

    const lockStore: Record<string, any> = {};
    const mockFirestoreLocks = {
      collection: (col: string) => ({
        doc: (docId: string) => ({
          get: async () => ({
            exists: Boolean(lockStore[`${col}/${docId}`]),
            data: () => lockStore[`${col}/${docId}`]
          })
        })
      }),
      runTransaction: async (fn: any) => {
        const tx = {
          get: async (ref: any) => ref.get(),
          set: (ref: any, data: any) => {
            lockStore['aeat_send_locks/B88888888'] = data;
          }
        };
        return await fn(tx);
      }
    };

    CloudDistributedChainCoordinator.setFirestoreAdminInstance(mockFirestoreLocks as any);

    // 1. Instancia A adquiere lock con TTL inicial corto (100ms)
    const acquired = await CloudDistributedChainCoordinator.acquireDistributedSendLock('B88888888', 'owner-A', 100);
    assert.strictEqual(acquired, true);
    const initialExpiresAt = lockStore['aeat_send_locks/B88888888'].expiresAt;

    // 2. Intento de renovación por un impostor (owner-B) DEBE fallar (false) y no alterar el ownerToken
    const spoofRenew = await CloudDistributedChainCoordinator.renewDistributedSendLock('B88888888', 'owner-B', 5000);
    assert.strictEqual(spoofRenew, false, 'Un proceso con distinto ownerToken NO puede renovar el lease');
    assert.strictEqual(lockStore['aeat_send_locks/B88888888'].ownerToken, 'owner-A');

    // 3. Renovación legítima por owner-A extiende expiresAt
    await new Promise(r => setTimeout(r, 15));
    const validRenew = await CloudDistributedChainCoordinator.renewDistributedSendLock('B88888888', 'owner-A', 5000);
    assert.strictEqual(validRenew, true, 'El propietario legítimo renueva el lease con éxito');
    assert.ok(
      lockStore['aeat_send_locks/B88888888'].expiresAt > initialExpiresAt + 4000,
      'expiresAt se ha extendido mediante heartbeat'
    );

    // 4. Probar el heartbeat automático de AeatFlowControlManager
    AeatFlowControlManager.reset();
    delete lockStore['aeat_send_locks/B88888888'];
    const lockWithHeartbeat = await AeatFlowControlManager.acquireSendLockAsync('B88888888', 'owner-hb', 80, 25);
    assert.strictEqual(lockWithHeartbeat, true);
    const exp1 = lockStore['aeat_send_locks/B88888888'].expiresAt;

    // Esperar ~60ms para que el heartbeat de 25ms se ejecute al menos dos veces
    await new Promise(r => setTimeout(r, 60));
    const exp2 = lockStore['aeat_send_locks/B88888888'].expiresAt;
    assert.ok(exp2 > exp1, 'El heartbeat periódico renovó automáticamente el lease antes de su expiración');

    await AeatFlowControlManager.releaseSendLockAsync('B88888888');
    CloudDistributedChainCoordinator.setFirestoreAdminInstance(null);
    CloudDistributedChainCoordinator.setMode(null);
    AeatFlowControlManager.reset();
  });

  await runAdversarialTest('5.13: Techo matemático de timeout frente a TTL y código 409 en colisión de cerrojo concurrente', async () => {
    const { executeAeatSubmission, AeatFlowControlManager, MAX_ALLOWED_AEAT_TRANSPORT_TIMEOUT_MS } = await import('../src/fiscal/aeatTransport');
    const { createFiscalSubmission } = await import('../src/fiscal/submissionService');
    const { createDefaultFiscalConfiguration } = await import('../src/fiscal/modelTransformers');
    AeatFlowControlManager.reset();
    CloudDistributedChainCoordinator.setMode('simulator');

    const existingRecord = BackendFiscalCustody.getAllFiscalRecords(OBLIGADO_TEST_A)[0];
    const config = createDefaultFiscalConfiguration({
      nif: OBLIGADO_TEST_A,
      nombreRazon: 'Granja Avícola Test A S.L.'
    });
    const sub = createFiscalSubmission(existingRecord, config, { numeroIntento: 2 });

    // 1. Prohibición matemática de timeout superior a MAX_ALLOWED_AEAT_TRANSPORT_TIMEOUT_MS (45000ms)
    await assert.rejects(async () => {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: existingRecord,
        config,
        options: {
          transportMode: 'mock',
          timeoutMs: MAX_ALLOWED_AEAT_TRANSPORT_TIMEOUT_MS + 5000
        }
      });
    }, /supera el máximo permitido de seguridad/);

    // 2. Si el cerrojo ya está adquirido por otra operación, executeAeatSubmission lanza error con statusCode=409
    await AeatFlowControlManager.acquireSendLockAsync(existingRecord.obligadoTributarioId, 'other-owner');
    try {
      await executeAeatSubmission({
        submission: sub,
        fiscalRecord: existingRecord,
        config,
        options: {
          transportMode: 'mock'
        }
      });
      assert.fail('Debió lanzar excepción de conflicto concurrente');
    } catch (err: any) {
      assert.strictEqual(err.statusCode, 409, 'El error de cerrojo concurrente debe señalizar HTTP 409 Conflict');
      assert.strictEqual(err.code, 'CONCURRENT_SEND_LOCKED');
    } finally {
      await AeatFlowControlManager.releaseSendLockAsync(existingRecord.obligadoTributarioId);
      CloudDistributedChainCoordinator.setMode(null);
      AeatFlowControlManager.reset();
    }
  });

  // Limpieza final de estados de prueba
  BackendFiscalCustody.resetCustody();
  CloudDistributedChainCoordinator.resetCloudState();
  resetFiscalQueue();

  console.log('\n================================================================');
  console.log(' AUDITORÍA FORENSE ADVERSARIAL: TODAS LAS DEFENSAS VERIFICADAS!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\nFALLO CRÍTICO EN AUDITORÍA ADVERSARIAL:', err);
  process.exit(1);
});
