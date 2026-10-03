/**
 * COORDINADOR DISTRIBUIDO DE CADENA FISCAL EN LA NUBE (FASE 3.1.6 / MULTI-INSTANCIA)
 *
 * Arquitectura para Google Cloud Run & Firestore:
 * - Evita bifurcaciones (forks) cuando múltiples instancias independientes atienden tráfico concurrente.
 * - Utiliza transacciones atómicas serializadas (OCC) sobre el documento de estado del obligado:
 *   `/fiscal_chain_state/{obligadoTributarioId}`
 * - El servidor (Cloud Run) utiliza `@google-cloud/firestore` con credenciales de cuenta de servicio (ADC/IAM),
 *   lo que permite custodiar los registros mientras que las reglas `firestore.rules` prohíben
 *   cualquier escritura directa desde clientes web (`allow write: if false;`).
 */

import { Firestore } from '@google-cloud/firestore';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json';
import { FiscalRecord, FiscalSubmission, FiscalEvent } from './types';

export interface CloudChainState {
  obligadoTributarioId: string;
  latestRecordId: string;
  latestHuella: string;
  latestNumeroFactura: string;
  latestFecha: string;
  totalRecords: number;
  sequence: number;
  updatedAt: string;
}

let firestoreAdminInstance: Firestore | null = null;
let firestoreInitialized = false;

export type CoordinatorMode = 'firestore' | 'simulator';
let modeOverride: CoordinatorMode | null = null;

export function getCoordinatorMode(): CoordinatorMode {
  if (modeOverride) return modeOverride;
  if (process.env.FISCAL_COORDINATOR_MODE === 'firestore') return 'firestore';
  if (process.env.FISCAL_COORDINATOR_MODE === 'simulator') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido forzar FISCAL_COORDINATOR_MODE=simulator en entorno de producción (Fail-Closed).'
      );
    }
    return 'simulator';
  }
  // En producción (NODE_ENV=production) o con flag explícito, Firestore es obligatorio y exclusivo
  if (process.env.NODE_ENV === 'production' || process.env.USE_FIRESTORE_AUTHORITY === 'true') {
    return 'firestore';
  }
  // Si se configuró host de emulador de Firestore
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return 'firestore';
  }
  // En pruebas unitarias explícitas (NODE_ENV=test)
  if (process.env.NODE_ENV === 'test') {
    return 'simulator';
  }
  // En despliegue Cloud Run
  if (process.env.K_SERVICE) {
    return 'firestore';
  }
  // Configuración ambigua: POLÍTICA FAIL-CLOSED ESTRICTA. Prohibido asumir simulator por defecto en entornos no-test.
  throw new Error(
    "CloudDistributedChainCoordinator: Configuración ambigua de autoridad fiscal. FISCAL_COORDINATOR_MODE no está definido y el entorno no es 'test'. En entornos reales la autoridad Firestore es obligatoria (Fail-Closed)."
  );
}

function getFirestoreAdmin(): Firestore | null {
  if (firestoreInitialized) return firestoreAdminInstance;
  firestoreInitialized = true;
  try {
    firestoreAdminInstance = new Firestore({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId
    });
  } catch (err: any) {
    console.warn('CloudDistributedChainCoordinator: Firestore Admin no inicializado con ADC:', err.message || err);
    firestoreAdminInstance = null;
  }
  return firestoreAdminInstance;
}

// Persistencia de estado compartido para entornos de prueba multi-proceso (simulador de autoridad Cloud)
const SHARED_STATE_FILE = path.resolve(process.cwd(), 'data', 'cloud_shared_chain_state.json');
const SHARED_RECORDS_FILE = path.resolve(process.cwd(), 'data', 'cloud_shared_records.json');
const SHARED_SUBMISSIONS_FILE = path.resolve(process.cwd(), 'data', 'cloud_shared_submissions.json');
const SHARED_EVENTS_FILE = path.resolve(process.cwd(), 'data', 'cloud_shared_events.json');
const SHARED_FLOW_CONTROL_FILE = path.resolve(process.cwd(), 'data', 'cloud_shared_flow_control.json');
const SHARED_SEND_LOCKS_FILE = path.resolve(process.cwd(), 'data', 'cloud_shared_send_locks.json');

export interface CloudFlowControlDoc {
  obligadoTributarioId: string;
  tiempoEsperaEnvioSegundos: number;
  lastResponseTimestamp: number;
  nextAllowedSendTimestamp: number;
  updatedAt: string;
}

export interface CloudSendLockDoc {
  obligadoTributarioId: string;
  locked: boolean;
  ownerToken: string;
  acquiredAt: number;
  expiresAt: number;
}

function commitSharedCloudTransaction(record: FiscalRecord): CloudChainState {
  const dir = path.dirname(SHARED_STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lockFile = `${SHARED_STATE_FILE}.lock`;
  const timeoutMs = 12000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      try {
        let allStates: Record<string, CloudChainState> = {};
        if (fs.existsSync(SHARED_STATE_FILE)) {
          try {
            allStates = JSON.parse(fs.readFileSync(SHARED_STATE_FILE, 'utf-8'));
          } catch {}
        }
        const current = allStates[record.obligadoTributarioId] || null;

        let allRecords: Record<string, FiscalRecord> = {};
        if (fs.existsSync(SHARED_RECORDS_FILE)) {
          try {
            allRecords = JSON.parse(fs.readFileSync(SHARED_RECORDS_FILE, 'utf-8'));
          } catch {}
        }

        // 1. Inmutabilidad por ID
        if (allRecords[record.id]) {
          throw new Error(`CloudDistributedChainCoordinator: Violación de inmutabilidad. El registro ${record.id} ya existe en la nube.`);
        }

        // 2. Encadenamiento y no-bifurcación estrictos
        let newState: CloudChainState;
        if (current) {
          if (record.encadenamiento.primerRegistro) {
            throw new Error(`CloudDistributedChainCoordinator: Violación de encadenamiento. Se indicó primerRegistro=true, pero ya existen registros en la nube para el obligado ${record.obligadoTributarioId}.`);
          }
          if (record.encadenamiento.registroAnterior?.huella !== current.latestHuella) {
            throw new Error(`CloudDistributedChainCoordinator: Bifurcación de cadena detectada en la nube. El hash del registro anterior (${record.encadenamiento.registroAnterior?.huella}) no coincide con el último registro en la nube (${current.latestHuella}).`);
          }

          newState = {
            obligadoTributarioId: record.obligadoTributarioId,
            latestRecordId: record.id,
            latestHuella: record.huella.hash,
            latestNumeroFactura: record.factura.numeroFactura,
            latestFecha: record.factura.fechaExpedicion,
            totalRecords: (current.totalRecords || 0) + 1,
            sequence: (current.sequence || 0) + 1,
            updatedAt: new Date().toISOString()
          };
        } else {
          if (!record.encadenamiento.primerRegistro) {
            throw new Error(`CloudDistributedChainCoordinator: Violación de encadenamiento. No existe estado previo en la nube para el obligado ${record.obligadoTributarioId}.`);
          }

          newState = {
            obligadoTributarioId: record.obligadoTributarioId,
            latestRecordId: record.id,
            latestHuella: record.huella.hash,
            latestNumeroFactura: record.factura.numeroFactura,
            latestFecha: record.factura.fechaExpedicion,
            totalRecords: 1,
            sequence: 1,
            updatedAt: new Date().toISOString()
          };
        }

        allStates[record.obligadoTributarioId] = newState;
        allRecords[record.id] = record;

        const tmpState = `${SHARED_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpState, JSON.stringify(allStates, null, 2), 'utf-8');
        fs.renameSync(tmpState, SHARED_STATE_FILE);

        const tmpRecords = `${SHARED_RECORDS_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpRecords, JSON.stringify(allRecords, null, 2), 'utf-8');
        fs.renameSync(tmpRecords, SHARED_RECORDS_FILE);

        return newState;
      } finally {
        fs.closeSync(fd);
        try { fs.unlinkSync(lockFile); } catch {}
      }
    } catch (e: any) {
      if (e.code === 'EEXIST') {
        try {
          const stats = fs.statSync(lockFile).mtimeMs;
          if (Date.now() - stats > 5000) {
            try { fs.unlinkSync(lockFile); } catch {}
          }
        } catch {}
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      } else {
        throw e;
      }
    }
  }
  throw new Error('Timeout coordinando estado compartido en cloud simulator');
}

function readSharedCloudState(obligadoId: string): CloudChainState | null {
  try {
    if (fs.existsSync(SHARED_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SHARED_STATE_FILE, 'utf-8'));
      return data[obligadoId] || null;
    }
  } catch {}
  return null;
}

function readSharedCloudRecord(recordId: string): FiscalRecord | null {
  try {
    if (fs.existsSync(SHARED_RECORDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SHARED_RECORDS_FILE, 'utf-8'));
      return data[recordId] || null;
    }
  } catch {}
  return null;
}

export class CloudDistributedChainCoordinator {
  /**
   * Permite fijar explícitamente el modo del coordinador (exclusivo para pruebas forenses).
   */
  public static setMode(mode: CoordinatorMode | null): void {
    modeOverride = mode;
  }

  /**
   * Obtiene el modo de coordinación activo ('firestore' | 'simulator').
   */
  public static getMode(): CoordinatorMode {
    return getCoordinatorMode();
  }

  /**
   * Permite inyectar o limpiar la instancia de Firestore Admin (para tests de inyección de fallos).
   */
  public static setFirestoreAdminInstance(instance: Firestore | null): void {
    firestoreAdminInstance = instance;
    firestoreInitialized = true;
  }

  /**
   * Ejecuta la validación y el compromiso atómico de un FiscalRecord contra la autoridad compartida de la nube.
   * Si dos instancias compiten para el mismo obligado, solo una se compromete y la otra detecta la discrepancia.
   *
   * POLÍTICA FAIL-CLOSED ESTRICTA:
   * En modo 'firestore', cualquier error (bifurcación, violación de encadenamiento, fallo de red,
   * timeout o indisponibilidad) LANZA EXCEPCIÓN DIRECTA.
   * Queda terminantemente PROHIBIDO degradarse a archivos locales en caso de fallo de Firestore.
   */
  public static async commitRecord(record: FiscalRecord): Promise<{ state: CloudChainState }> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Error fatal de infraestructura. Firestore Admin no está configurado ni disponible en modo firestore. No se permite degradación a disco local (Fail-Closed).'
        );
      }

      const stateRef = firestore.collection('fiscal_chain_state').doc(record.obligadoTributarioId);
      const recordRef = firestore.collection('fiscal_records').doc(record.id);

      // runTransaction ejecuta con Optimistic Concurrency Control (OCC) en Google Cloud Firestore.
      // Cualquier fallo en la transacción se propaga inmediatamente (Fail-Closed).
      const resultState = await firestore.runTransaction(async (tx) => {
        const [stateSnap, recordSnap] = await Promise.all([
          tx.get(stateRef),
          tx.get(recordRef)
        ]);

        if (recordSnap.exists) {
          throw new Error(`CloudDistributedChainCoordinator: Violación de inmutabilidad. El registro ${record.id} ya existe en Firestore.`);
        }

        let newState: CloudChainState;
        if (stateSnap.exists) {
          const current = stateSnap.data() as CloudChainState;
          if (record.encadenamiento.primerRegistro) {
            throw new Error(`CloudDistributedChainCoordinator: Violación de encadenamiento. Se indicó primerRegistro=true, pero ya existen registros en Firestore para el obligado ${record.obligadoTributarioId}.`);
          }
          if (record.encadenamiento.registroAnterior?.huella !== current.latestHuella) {
            throw new Error(`CloudDistributedChainCoordinator: Bifurcación de cadena detectada en Firestore. El hash del registro anterior (${record.encadenamiento.registroAnterior?.huella}) no coincide con el último registro en la nube (${current.latestHuella}).`);
          }

          newState = {
            obligadoTributarioId: record.obligadoTributarioId,
            latestRecordId: record.id,
            latestHuella: record.huella.hash,
            latestNumeroFactura: record.factura.numeroFactura,
            latestFecha: record.factura.fechaExpedicion,
            totalRecords: (current.totalRecords || 0) + 1,
            sequence: (current.sequence || 0) + 1,
            updatedAt: new Date().toISOString()
          };
          tx.update(stateRef, newState as any);
        } else {
          if (!record.encadenamiento.primerRegistro) {
            throw new Error(`CloudDistributedChainCoordinator: Violación de encadenamiento. No existe estado previo en Firestore para el obligado ${record.obligadoTributarioId}.`);
          }

          newState = {
            obligadoTributarioId: record.obligadoTributarioId,
            latestRecordId: record.id,
            latestHuella: record.huella.hash,
            latestNumeroFactura: record.factura.numeroFactura,
            latestFecha: record.factura.fechaExpedicion,
            totalRecords: 1,
            sequence: 1,
            updatedAt: new Date().toISOString()
          };
          tx.set(stateRef, newState as any);
        }

        tx.set(recordRef, JSON.parse(JSON.stringify(record)));
        return newState;
      });

      return { state: resultState };
    }

    // Modo 'simulator': Exclusivo para entornos de prueba offline/desarrollo local
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    const newState = commitSharedCloudTransaction(record);
    return { state: newState };
  }

  /**
   * Obtiene el estado oficial de la cadena en la nube para un obligado tributario.
   * En modo firestore, NUNCA cae a disco local si Firestore devuelve error o no responde.
   */
  public static async getLatestState(obligadoId: string): Promise<CloudChainState | null> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible en modo firestore para getLatestState (Fail-Closed).'
        );
      }
      const snap = await firestore.collection('fiscal_chain_state').doc(obligadoId).get();
      if (snap.exists) {
        return snap.data() as CloudChainState;
      }
      return null;
    }

    return readSharedCloudState(obligadoId);
  }

  /**
   * Recupera un FiscalRecord por ID desde la autoridad distribuida en la nube.
   * En modo firestore, NUNCA cae a disco local si Firestore devuelve error.
   */
  public static async getRecordById(recordId: string): Promise<FiscalRecord | null> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible en modo firestore para getRecordById (Fail-Closed).'
        );
      }
      const snap = await firestore.collection('fiscal_records').doc(recordId).get();
      if (snap.exists) {
        return snap.data() as FiscalRecord;
      }
      return null;
    }

    return readSharedCloudRecord(recordId);
  }

  /**
   * Registra una FiscalSubmission de forma atómica y fail-closed en la autoridad de nube.
   */
  public static async commitSubmission(submission: FiscalSubmission): Promise<void> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para commitSubmission (Fail-Closed).'
        );
      }
      await firestore.collection('fiscal_submissions').doc(submission.id).set(JSON.parse(JSON.stringify(submission)));
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    try {
      const dir = path.dirname(SHARED_SUBMISSIONS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let allSubmissions: Record<string, FiscalSubmission> = {};
      if (fs.existsSync(SHARED_SUBMISSIONS_FILE)) {
        try { allSubmissions = JSON.parse(fs.readFileSync(SHARED_SUBMISSIONS_FILE, 'utf-8')); } catch {}
      }
      allSubmissions[submission.id] = submission;
      const tmp = `${SHARED_SUBMISSIONS_FILE}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(allSubmissions, null, 2), 'utf-8');
      fs.renameSync(tmp, SHARED_SUBMISSIONS_FILE);
    } catch (err: any) {
      throw new Error(`CloudDistributedChainCoordinator: Error persistiendo submission en simulador cloud: ${err.message}`);
    }
  }

  /**
   * Registra un FiscalEvent de auditoría de forma atómica y fail-closed en la autoridad de nube.
   */
  public static async commitEvent(event: FiscalEvent): Promise<void> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para commitEvent (Fail-Closed).'
        );
      }
      await firestore.collection('fiscal_events').doc(event.id).set(JSON.parse(JSON.stringify(event)));
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    try {
      const dir = path.dirname(SHARED_EVENTS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let allEvents: Record<string, FiscalEvent> = {};
      if (fs.existsSync(SHARED_EVENTS_FILE)) {
        try { allEvents = JSON.parse(fs.readFileSync(SHARED_EVENTS_FILE, 'utf-8')); } catch {}
      }
      allEvents[event.id] = event;
      const tmp = `${SHARED_EVENTS_FILE}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(allEvents, null, 2), 'utf-8');
      fs.renameSync(tmp, SHARED_EVENTS_FILE);
    } catch (err: any) {
      throw new Error(`CloudDistributedChainCoordinator: Error persistiendo event en simulador cloud: ${err.message}`);
    }
  }

  /**
   * Consulta en la autoridad distribuida todas las sumisiones asociadas a un FiscalRecord.
   * Permite garantizar idempotencia trans-instancia y detectar envíos en vuelo o ya aceptados.
   */
  public static async getSubmissionsForRecord(fiscalRecordId: string): Promise<FiscalSubmission[]> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para getSubmissionsForRecord (Fail-Closed).'
        );
      }
      const snap = await firestore
        .collection('fiscal_submissions')
        .where('fiscalRecordId', '==', fiscalRecordId)
        .get();
      if (snap.empty) return [];
      const list: FiscalSubmission[] = [];
      snap.forEach((doc) => {
        list.push(doc.data() as FiscalSubmission);
      });
      return list;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    if (fs.existsSync(SHARED_SUBMISSIONS_FILE)) {
      const raw = fs.readFileSync(SHARED_SUBMISSIONS_FILE, 'utf-8');
      const allSubmissions: Record<string, FiscalSubmission> = JSON.parse(raw);
      return Object.values(allSubmissions).filter(s => s.fiscalRecordId === fiscalRecordId);
    }
    return [];
  }

  /**
   * Adquiere atómicamente el cerrojo distribuido de envío AEAT para un obligado tributario.
   * Utiliza transacciones OCC en Firestore (`/aeat_send_locks/{obligadoId}`) para garantizar
   * exclusión mutua global entre múltiples instancias de Cloud Run.
   */
  public static async acquireDistributedSendLock(
    obligadoId: string,
    ownerToken: string,
    ttlMs = 60000
  ): Promise<boolean> {
    if (!obligadoId) return false;
    const mode = getCoordinatorMode();
    const now = Date.now();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para acquireDistributedSendLock (Fail-Closed).'
        );
      }
      const lockRef = firestore.collection('aeat_send_locks').doc(obligadoId);
      return await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        if (snap.exists) {
          const data = snap.data() as CloudSendLockDoc;
          if (data.locked && data.expiresAt > now && data.ownerToken !== ownerToken) {
            return false;
          }
        }
        const newLock: CloudSendLockDoc = {
          obligadoTributarioId: obligadoId,
          locked: true,
          ownerToken,
          acquiredAt: now,
          expiresAt: now + ttlMs
        };
        tx.set(lockRef, newLock as any);
        return true;
      });
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    const dir = path.dirname(SHARED_SEND_LOCKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let allLocks: Record<string, CloudSendLockDoc> = {};
    if (fs.existsSync(SHARED_SEND_LOCKS_FILE)) {
      allLocks = JSON.parse(fs.readFileSync(SHARED_SEND_LOCKS_FILE, 'utf-8'));
    }
    const existing = allLocks[obligadoId];
    if (existing && existing.locked && existing.expiresAt > now && existing.ownerToken !== ownerToken) {
      return false;
    }
    allLocks[obligadoId] = {
      obligadoTributarioId: obligadoId,
      locked: true,
      ownerToken,
      acquiredAt: now,
      expiresAt: now + ttlMs
    };
    const tmp = `${SHARED_SEND_LOCKS_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(allLocks, null, 2), 'utf-8');
    fs.renameSync(tmp, SHARED_SEND_LOCKS_FILE);
    return true;
  }

  /**
   * Libera atómicamente el cerrojo distribuido de envío AEAT para un obligado tributario.
   */
  public static async releaseDistributedSendLock(obligadoId: string, ownerToken?: string): Promise<void> {
    if (!obligadoId) return;
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para releaseDistributedSendLock (Fail-Closed).'
        );
      }
      const lockRef = firestore.collection('aeat_send_locks').doc(obligadoId);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        if (!snap.exists) return;
        const data = snap.data() as CloudSendLockDoc;
        if (ownerToken && data.ownerToken && data.ownerToken !== ownerToken) {
          return;
        }
        tx.set(lockRef, {
          obligadoTributarioId: obligadoId,
          locked: false,
          ownerToken: '',
          acquiredAt: 0,
          expiresAt: 0
        });
      });
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    if (fs.existsSync(SHARED_SEND_LOCKS_FILE)) {
      const allLocks: Record<string, CloudSendLockDoc> = JSON.parse(fs.readFileSync(SHARED_SEND_LOCKS_FILE, 'utf-8'));
      const existing = allLocks[obligadoId];
      if (existing && (!ownerToken || !existing.ownerToken || existing.ownerToken === ownerToken)) {
        delete allLocks[obligadoId];
        const tmp = `${SHARED_SEND_LOCKS_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(allLocks, null, 2), 'utf-8');
        fs.renameSync(tmp, SHARED_SEND_LOCKS_FILE);
      }
    }
  }

  /**
   * Comprueba en la autoridad distribuida si el obligado tributario tiene un envío en vuelo bloqueado.
   */
  public static async isDistributedSendLocked(obligadoId: string): Promise<boolean> {
    if (!obligadoId) return false;
    const mode = getCoordinatorMode();
    const now = Date.now();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para isDistributedSendLocked (Fail-Closed).'
        );
      }
      const snap = await firestore.collection('aeat_send_locks').doc(obligadoId).get();
      if (!snap.exists) return false;
      const data = snap.data() as CloudSendLockDoc;
      return Boolean(data.locked && data.expiresAt > now);
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    if (fs.existsSync(SHARED_SEND_LOCKS_FILE)) {
      const allLocks: Record<string, CloudSendLockDoc> = JSON.parse(fs.readFileSync(SHARED_SEND_LOCKS_FILE, 'utf-8'));
      const existing = allLocks[obligadoId];
      return Boolean(existing && existing.locked && existing.expiresAt > now);
    }
    return false;
  }

  /**
   * Compromete de forma autoritativa y fail-closed el estado de control de flujo AEAT (<TiempoEsperaEnvio>)
   * en la autoridad distribuida de la nube.
   */
  public static async commitFlowControlState(state: CloudFlowControlDoc): Promise<void> {
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para commitFlowControlState (Fail-Closed).'
        );
      }
      await firestore
        .collection('aeat_flow_control')
        .doc(state.obligadoTributarioId)
        .set(JSON.parse(JSON.stringify(state)));
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    const dir = path.dirname(SHARED_FLOW_CONTROL_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let allFlow: Record<string, CloudFlowControlDoc> = {};
    if (fs.existsSync(SHARED_FLOW_CONTROL_FILE)) {
      allFlow = JSON.parse(fs.readFileSync(SHARED_FLOW_CONTROL_FILE, 'utf-8'));
    }
    allFlow[state.obligadoTributarioId] = state;
    const tmp = `${SHARED_FLOW_CONTROL_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(allFlow, null, 2), 'utf-8');
    fs.renameSync(tmp, SHARED_FLOW_CONTROL_FILE);
  }

  /**
   * Obtiene de forma autoritativa y fail-closed el estado de control de flujo AEAT (<TiempoEsperaEnvio>)
   * desde la autoridad distribuida de la nube.
   */
  public static async getFlowControlState(obligadoId: string): Promise<CloudFlowControlDoc | null> {
    if (!obligadoId) return null;
    const mode = getCoordinatorMode();

    if (mode === 'firestore') {
      const firestore = getFirestoreAdmin();
      if (!firestore) {
        throw new Error(
          'CloudDistributedChainCoordinator: Firestore Admin no disponible para getFlowControlState (Fail-Closed).'
        );
      }
      const snap = await firestore.collection('aeat_flow_control').doc(obligadoId).get();
      if (snap.exists) {
        return snap.data() as CloudFlowControlDoc;
      }
      return null;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CloudDistributedChainCoordinator: Prohibido utilizar modo simulator en entorno de producción Cloud Run (Fail-Closed).'
      );
    }

    if (fs.existsSync(SHARED_FLOW_CONTROL_FILE)) {
      const allFlow: Record<string, CloudFlowControlDoc> = JSON.parse(fs.readFileSync(SHARED_FLOW_CONTROL_FILE, 'utf-8'));
      return allFlow[obligadoId] || null;
    }
    return null;
  }

  /**
   * Resetea el simulador de estado en la nube (exclusivo para pruebas).
   */
  public static resetCloudState(): void {
    try {
      if (fs.existsSync(SHARED_STATE_FILE)) {
        fs.unlinkSync(SHARED_STATE_FILE);
      }
      if (fs.existsSync(SHARED_RECORDS_FILE)) {
        fs.unlinkSync(SHARED_RECORDS_FILE);
      }
      if (fs.existsSync(SHARED_SUBMISSIONS_FILE)) {
        fs.unlinkSync(SHARED_SUBMISSIONS_FILE);
      }
      if (fs.existsSync(SHARED_EVENTS_FILE)) {
        fs.unlinkSync(SHARED_EVENTS_FILE);
      }
      if (fs.existsSync(SHARED_FLOW_CONTROL_FILE)) {
        fs.unlinkSync(SHARED_FLOW_CONTROL_FILE);
      }
      if (fs.existsSync(SHARED_SEND_LOCKS_FILE)) {
        fs.unlinkSync(SHARED_SEND_LOCKS_FILE);
      }
    } catch {}
  }
}
