/**
 * REPOSITORIO DE CUSTODIA FISCAL DE BACKEND (FASE 3.1.3)
 *
 * Normativa:
 * - Ley 11/2021 de medidas contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 *
 * AUTORIDAD EXCLUSIVA DE BACKEND:
 * 1. La custodia física y lógica de los registros fiscales reside en el backend.
 * 2. El cliente/navegador nunca inserta ni altera registros fiscales directamente.
 * 3. Garantiza la integridad de la cadena impidiendo bifurcaciones por concurrencia.
 * 4. Valida criptográficamente cada registro antes de persistirlo.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FiscalRecord, FiscalRecordRef, FiscalSubmission, FiscalEvent } from './types';
import { verifyFiscalRecordHash } from './hashService';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOCKS_DIR = path.join(DATA_DIR, 'locks');
const RECORDS_FILE = path.join(DATA_DIR, 'fiscal_records.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'fiscal_submissions.json');
const EVENTS_FILE = path.join(DATA_DIR, 'fiscal_events.json');

// Memoria caché del backend sincronizada con persistencia en disco
let recordsCache: FiscalRecord[] = [];
let submissionsCache: FiscalSubmission[] = [];
let eventsCache: FiscalEvent[] = [];
let initialized = false;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCKS_DIR)) {
    fs.mkdirSync(LOCKS_DIR, { recursive: true });
  }
}

function loadFromDisk(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(RECORDS_FILE)) {
      const raw = fs.readFileSync(RECORDS_FILE, 'utf-8');
      recordsCache = JSON.parse(raw);
    } else {
      recordsCache = [];
    }
  } catch (err) {
    console.error('Error cargando fiscal_records.json:', err);
    recordsCache = [];
  }

  try {
    if (fs.existsSync(SUBMISSIONS_FILE)) {
      const raw = fs.readFileSync(SUBMISSIONS_FILE, 'utf-8');
      submissionsCache = JSON.parse(raw);
    } else {
      submissionsCache = [];
    }
  } catch (err) {
    console.error('Error cargando fiscal_submissions.json:', err);
    submissionsCache = [];
  }

  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const raw = fs.readFileSync(EVENTS_FILE, 'utf-8');
      eventsCache = JSON.parse(raw);
    } else {
      eventsCache = [];
    }
  } catch (err) {
    console.error('Error cargando fiscal_events.json:', err);
    eventsCache = [];
  }

  initialized = true;
}

function persistRecordsToDisk(): void {
  ensureDataDir();
  const uniqueId = `${process.pid}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const tmpFile = path.join(DATA_DIR, `fiscal_records_${uniqueId}.tmp`);
  fs.writeFileSync(tmpFile, JSON.stringify(recordsCache, null, 2), 'utf-8');
  fs.renameSync(tmpFile, RECORDS_FILE);
}

function persistSubmissionsToDisk(): void {
  ensureDataDir();
  const uniqueId = `${process.pid}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const tmpFile = path.join(DATA_DIR, `fiscal_submissions_${uniqueId}.tmp`);
  fs.writeFileSync(tmpFile, JSON.stringify(submissionsCache, null, 2), 'utf-8');
  fs.renameSync(tmpFile, SUBMISSIONS_FILE);
}

function persistEventsToDisk(): void {
  ensureDataDir();
  const uniqueId = `${process.pid}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const tmpFile = path.join(DATA_DIR, `fiscal_events_${uniqueId}.tmp`);
  fs.writeFileSync(tmpFile, JSON.stringify(eventsCache, null, 2), 'utf-8');
  fs.renameSync(tmpFile, EVENTS_FILE);
}

// Registro en memoria de cerrojos activos en este proceso para re-entrancia segura
const activeLocksByObligado = new Map<string, string>();

/**
 * Comprueba si un proceso sigue en ejecución en el sistema operativo.
 */
function isProcessAlive(pid: number): boolean {
  if (isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM'; // Si EPERM, el proceso existe pero pertenece a otro usuario
  }
}

/**
 * Obtiene el tiempo de inicio del proceso en ticks/jiffies (Linux /proc/<pid>/stat, campo 22)
 * para detectar de forma unívoca la reutilización de PID por parte del sistema operativo.
 */
function getProcessStartTime(pid: number): number {
  try {
    const statPath = `/proc/${pid}/stat`;
    if (fs.existsSync(statPath)) {
      const statData = fs.readFileSync(statPath, 'utf-8');
      const afterComm = statData.substring(statData.lastIndexOf(')') + 2);
      const fields = afterComm.split(' ');
      return parseInt(fields[19], 10) || 0; // Campo 22 global (19º tras comm)
    }
  } catch {}
  return 0;
}

/**
 * Cerrojo global a nivel de sistema de ficheros para serializar escrituras concurrentes multi-NIF.
 * Evita carreras de persistencia y colisiones de ficheros temporales cuando varios obligados emiten a la vez.
 */
async function acquireGlobalPersistenceLock(timeoutMs = 15000): Promise<() => void> {
  ensureDataDir();
  const lockPath = path.join(LOCKS_DIR, 'global_persistence.lock');
  const startTime = Date.now();
  const procStartTime = getProcessStartTime(process.pid);
  const ownerToken = `${process.pid}:${Date.now()}:${procStartTime}:${crypto.randomBytes(8).toString('hex')}`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, ownerToken);
      fs.closeSync(fd);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          if (fs.existsSync(lockPath)) {
            const currentContent = fs.readFileSync(lockPath, 'utf-8').trim();
            if (currentContent === ownerToken) {
              fs.unlinkSync(lockPath);
            }
          }
        } catch {}
      };
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          if (fs.existsSync(lockPath)) {
            const rawContent = fs.readFileSync(lockPath, 'utf-8').trim();
            const parts = rawContent.split(':');
            const ownerPid = parseInt(parts[0], 10);
            const lockTimestamp = parseInt(parts[1], 10);
            const lockProcStartTime = parts.length >= 4 ? parseInt(parts[2], 10) : 0;

            const ownerAlive = isProcessAlive(ownerPid);
            let isPidReused = false;
            if (ownerAlive && lockProcStartTime > 0) {
              const currentStartTime = getProcessStartTime(ownerPid);
              if (currentStartTime > 0 && currentStartTime !== lockProcStartTime) {
                isPidReused = true; // El PID fue reciclado por un proceso posterior
              }
            }

            const isDeadOwner = (!ownerAlive || isPidReused) && (Date.now() - lockTimestamp > 2000);

            // NUNCA eliminar si el proceso titular sigue vivo
            if (isDeadOwner) {
              try {
                fs.unlinkSync(lockPath);
                continue;
              } catch {}
            }
          }
        } catch {}

        await new Promise(resolve => setTimeout(resolve, 25));
      } else {
        throw err;
      }
    }
  }

  throw new Error(`BackendFiscalCustody: Timeout (${timeoutMs}ms) al adquirir cerrojo global de persistencia multi-NIF.`);
}

export class BackendFiscalCustody {
  private static init(): void {
    if (!initialized) {
      loadFromDisk();
    }
  }

  /**
   * Cerrojo exclusivo a nivel de proceso/sistema de ficheros para serializar emisiones concurrentes.
   * - FAIL CLOSED: Si no se adquiere en timeoutMs, lanza un error fatal.
   * - OWNERSHIP: Cada adquisición genera un token criptográfico único con PID y starttime; solo el titular puede liberarlo.
   * - LIVENESS: Un proceso vivo que tarda minutos u horas NUNCA pierde el lock por antigüedad.
   * - PID REUSE: Detecta reciclaje de PID mediante verificación del tiempo de inicio del proceso (/proc/<pid>/stat).
   */
  public static async acquireProcessLock(obligadoTributarioId: string, timeoutMs = 8000): Promise<() => void> {
    ensureDataDir();
    const cleanId = obligadoTributarioId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const lockPath = path.join(LOCKS_DIR, `obligado_${cleanId}.lock`);
    const startTime = Date.now();
    const procStartTime = getProcessStartTime(process.pid);
    const ownerToken = `${process.pid}:${Date.now()}:${procStartTime}:${crypto.randomBytes(8).toString('hex')}`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, ownerToken);
        fs.closeSync(fd);

        activeLocksByObligado.set(obligadoTributarioId, ownerToken);

        // Retornar función de liberación condicional exclusiva del titular
        let released = false;
        return () => {
          if (released) return;
          released = true;
          activeLocksByObligado.delete(obligadoTributarioId);
          try {
            if (fs.existsSync(lockPath)) {
              const currentContent = fs.readFileSync(lockPath, 'utf-8').trim();
              if (currentContent === ownerToken) {
                fs.unlinkSync(lockPath);
              }
            }
          } catch {}
        };
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // El lock ya existe: verificar si el proceso dueño sigue vivo
          try {
            if (fs.existsSync(lockPath)) {
              const rawContent = fs.readFileSync(lockPath, 'utf-8').trim();
              const parts = rawContent.split(':');
              const ownerPid = parseInt(parts[0], 10);
              const lockTimestamp = parseInt(parts[1], 10);
              const lockProcStartTime = parts.length >= 4 ? parseInt(parts[2], 10) : 0;

              const ownerAlive = isProcessAlive(ownerPid);
              let isPidReused = false;
              if (ownerAlive && lockProcStartTime > 0) {
                const currentStartTime = getProcessStartTime(ownerPid);
                if (currentStartTime > 0 && currentStartTime !== lockProcStartTime) {
                  isPidReused = true; // El PID fue reciclado por un proceso nuevo; el dueño original murió
                }
              }

              const isDeadOwner = (!ownerAlive || isPidReused) && (Date.now() - lockTimestamp > 2000);

              // NUNCA eliminar si el proceso sigue vivo (sin importar si han transcurrido 2, 5 o 20 minutos)
              if (isDeadOwner) {
                try {
                  fs.unlinkSync(lockPath);
                  continue;
                } catch {}
              }
            }
          } catch {}

          await new Promise(resolve => setTimeout(resolve, 40));
        } else {
          throw err;
        }
      }
    }

    // FAIL CLOSED: Si expira el tiempo sin adquirir el cerrojo, rechazar la operación rotundamente
    throw new Error(
      `BackendFiscalCustody: Timeout (${timeoutMs}ms) al adquirir cerrojo de emisión exclusivo para el obligado '${obligadoTributarioId}'. Operación fiscal abortada para evitar condiciones de carrera o bifurcación.`
    );
  }

  /**
   * Guarda un FiscalRecord en la custodia inmutable de backend tras verificar su integridad
   * y garantizar la no-bifurcación de la cadena criptográfica SHA-256.
   * Adquiere el cerrojo por obligado y el cerrojo global de persistencia para evitar carreras multi-NIF.
   */
  public static async saveFiscalRecord(record: FiscalRecord): Promise<void> {
    if (!record || !record.id) {
      throw new Error('BackendFiscalCustody: Se requiere un FiscalRecord válido con identificador.');
    }

    if (!record.obligadoTributarioId || record.obligadoTributarioId === 'ES_UNKNOWN' || record.obligadoTributarioId.trim() === '') {
      throw new Error('BackendFiscalCustody: obligadoTributarioId inválido o no especificado.');
    }

    // Si este hilo no posee el lock del obligado, adquirirlo transaccionalmente
    const alreadyLocked = activeLocksByObligado.has(record.obligadoTributarioId);
    let releaseObligadoLock: (() => void) | null = null;
    if (!alreadyLocked) {
      releaseObligadoLock = await this.acquireProcessLock(record.obligadoTributarioId);
    }

    try {
      // Adquirir el cerrojo global de persistencia para sincronizar escrituras en disco entre distintos NIFs
      const releaseGlobalLock = await acquireGlobalPersistenceLock(15000);
      try {
        this.init();
        loadFromDisk(); // Lectura atómica fresca del estado actual del disco

        // 1. Verificación de integridad matemática previa a la custodia
        const verification = await verifyFiscalRecordHash(record);
        if (!verification.valid) {
          throw new Error(`BackendFiscalCustody: Fallo de integridad criptográfica en el registro (${verification.reason}). Custodia rechazada.`);
        }

        // 2. Comprobar que no exista duplicado por ID
        const exists = recordsCache.some(r => r.id === record.id);
        if (exists) {
          throw new Error(`BackendFiscalCustody: Violación de inmutabilidad. El registro ${record.id} ya existe en la custodia fiscal.`);
        }

        // 3. Garantía absoluta de no bifurcación de la cadena por concurrencia
        const latestInChain = this.getLatestFiscalRecord(record.obligadoTributarioId);
        if (record.encadenamiento.primerRegistro) {
          if (latestInChain) {
            throw new Error(`BackendFiscalCustody: Violación de encadenamiento. Se indicó primerRegistro=true, pero ya existen ${recordsCache.filter(r => r.obligadoTributarioId === record.obligadoTributarioId).length} registros en custodia para el obligado ${record.obligadoTributarioId}.`);
          }
        } else {
          if (!latestInChain) {
            throw new Error(`BackendFiscalCustody: Violación de encadenamiento. No existe registro previo en custodia para el obligado ${record.obligadoTributarioId}.`);
          }
          if (record.encadenamiento.registroAnterior?.huella !== latestInChain.huella.hash) {
            throw new Error(`BackendFiscalCustody: Bifurcación de cadena detectada. El hash del registro anterior no coincide con el último registro existente en la custodia fiscal.`);
          }
        }

        // 4. C1 & C2: Compromiso obligatorio en la autoridad de nube (Fail-Closed estricto)
        // El compromiso en la autoridad de nube debe ocurrir ANTES de mutar la memoria local o el disco
        // para garantizar atomicidad estricta y prevenir registros sucios o bifurcados.
        // Si el compromiso falla por CUALQUIER motivo (bifurcación, violación de encadenamiento, fallo de red,
        // timeout o indisponibilidad de Firestore), la emisión se aborta tajantemente sin persistir nada en local.
        const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
        await CloudDistributedChainCoordinator.commitRecord(record);

        // 5. Persistir atómicamente en custodia local SÓLO si el commit distribuido fue aceptado
        recordsCache.push(Object.freeze(record));
        try {
          persistRecordsToDisk();
        } catch (err) {
          console.error('BackendFiscalCustody: Error persistiendo a disco tras commit en nube:', err);
          throw err;
        }
      } finally {
        releaseGlobalLock();
      }
    } finally {
      if (releaseObligadoLock) {
        releaseObligadoLock();
      }
    }
  }

  /**
   * Obtiene el último registro fiscal sellado para un obligado tributario.
   * Resuelve matemáticamente la cabeza/punta de la cadena criptográfica SHA-256 en la réplica local.
   * Si detecta múltiples puntas de cadena (cadena bifurcada A -> B y A -> C),
   * RECHAZA la selección de punta arbitraria y aborta inmediatamente con un error de seguridad.
   */
  public static getLatestFiscalRecord(obligadoTributarioId: string): FiscalRecord | null {
    this.init();
    loadFromDisk();
    if (!obligadoTributarioId) return null;

    const matching = recordsCache.filter(r => r.obligadoTributarioId === obligadoTributarioId);
    if (matching.length === 0) return null;
    if (matching.length === 1) return matching[0];

    // Encontrar los registros cuya huella no es predecesora de ningún otro registro en la cadena
    const referencedPredecessors = new Set<string>();
    for (const r of matching) {
      if (r.encadenamiento.registroAnterior?.huella) {
        referencedPredecessors.add(r.encadenamiento.registroAnterior.huella);
      }
    }

    const tips = matching.filter(r => !referencedPredecessors.has(r.huella.hash));

    // Si existen 2 o más puntas sin resolver, la cadena está BIFURCADA
    if (tips.length > 1) {
      throw new Error(
        `BackendFiscalCustody: Bifurcación crítica detectada en la cadena criptográfica del obligado '${obligadoTributarioId}'. Existen ${tips.length} puntas de cadena concurrentes: [${tips.map(t => `${t.id}:${t.huella.hash.substring(0, 10)}...`).join(', ')}]. Prohibido seleccionar puntas arbitrarias. Emisión abortada.`
      );
    }

    if (tips.length === 1) {
      return tips[0];
    }

    throw new Error(
      `BackendFiscalCustody: Corrupción crítica en la cadena criptográfica del obligado '${obligadoTributarioId}'. No se detecta ninguna punta de cadena libre.`
    );
  }

  /**
   * Recupera de forma asíncrona y distribuida el último registro fiscal de un obligado.
   * Consulta la autoridad distribuida de la nube (Cloud Run / Firestore) con política FAIL-CLOSED estricta:
   * Si la autoridad de la nube falla o está inaccesible, se PROPAGA el error y se aborta la emisión.
   * Queda PROHIBIDO degradarse silenciosamente a la caché o archivos locales.
   */
  public static async getLatestFiscalRecordAsync(obligadoTributarioId: string): Promise<FiscalRecordRef | FiscalRecord | null> {
    this.init();
    loadFromDisk();

    const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
    // Consulta la autoridad distribuida de forma obligatoria y estricta (FAIL-CLOSED)
    // NUNCA absorbe errores de infraestructura ni degrada silenciosamente a la custodia de disco local.
    const cloudState = await CloudDistributedChainCoordinator.getLatestState(obligadoTributarioId);
    
    if (cloudState) {
      // 1. Obtener autoritativamente el registro de la nube por su identificador
      const remoteRecord = await CloudDistributedChainCoordinator.getRecordById(cloudState.latestRecordId);
      if (!remoteRecord) {
        throw new Error(
          `BackendFiscalCustody: Corrupción de integridad en autoridad fiscal. El estado en la nube indica latestRecordId='${cloudState.latestRecordId}', pero dicho registro no existe en fiscal_records (Fail-Closed).`
        );
      }

      // 2. Contrastar obligatoriamente que la huella del registro coincide de forma exacta con la huella registrada en el estado de la cadena
      if (remoteRecord.huella.hash !== cloudState.latestHuella) {
        throw new Error(
          `BackendFiscalCustody: Violación de integridad criptográfica en autoridad fiscal. La huella del registro '${remoteRecord.id}' (${remoteRecord.huella.hash}) no coincide con latestHuella del estado de la cadena (${cloudState.latestHuella}). Emisión abortada.`
        );
      }

      // 3. Si la réplica local contiene una versión del registro, verificar estricta concordancia criptográfica
      const local = recordsCache.find(r => r.id === cloudState.latestRecordId);
      if (local && local.huella.hash !== cloudState.latestHuella) {
        throw new Error(
          `BackendFiscalCustody: Corrupción o divergencia detectada en la réplica local del registro '${cloudState.latestRecordId}'. Su huella local (${local.huella.hash}) difiere de la huella oficial en la nube (${cloudState.latestHuella}). Emisión abortada.`
        );
      }

      // 4. Sincronizar la réplica local con el registro validado
      if (!local) {
        recordsCache.push(Object.freeze(remoteRecord));
        try { persistRecordsToDisk(); } catch {}
      }

      return remoteRecord;
    }

    // Si cloudState es null, la autoridad en la nube certifica que NO existen registros previos (Génesis)
    // Verificamos que la custodia local no tenga registros huérfanos que provocarían discrepancia/bifurcación
    const localRecords = recordsCache.filter(r => r.obligadoTributarioId === obligadoTributarioId);
    if (localRecords.length > 0) {
      throw new Error(
        `BackendFiscalCustody: Discrepancia crítica de autoridad fiscal. La autoridad distribuida en la nube indica 0 registros previos (génesis) para el obligado '${obligadoTributarioId}', pero existen ${localRecords.length} registros en la custodia local. Emisión abortada para prevenir bifurcación.`
      );
    }

    return null;
  }

  /**
   * Recupera un registro fiscal por ID desde la custodia del backend (síncrono, disco local).
   */
  public static getFiscalRecordById(recordId: string): FiscalRecord | null {
    this.init();
    loadFromDisk();
    return recordsCache.find(r => r.id === recordId) || null;
  }

  /**
   * Recupera un registro fiscal por ID de forma asíncrona, consultando PRIMERO la autoridad distribuida
   * en la nube (Firestore) y contrastando la integridad criptográfica contra la réplica local.
   * NUNCA confía directamente en la copia local sin contrastar con la autoridad cloud (Fail-Closed).
   */
  public static async getFiscalRecordByIdAsync(recordId: string): Promise<FiscalRecord | null> {
    this.init();
    loadFromDisk();

    const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
    // 1. Consultar primero y de forma obligatoria la autoridad distribuida en la nube
    const remote = await CloudDistributedChainCoordinator.getRecordById(recordId);
    const local = recordsCache.find(r => r.id === recordId) || null;

    if (!remote) {
      if (local) {
        throw new Error(
          `BackendFiscalCustody: Discrepancia crítica de autoridad fiscal. El registro '${recordId}' existe en la réplica local pero NO existe en la autoridad distribuida de la nube. Operación abortada (Fail-Closed).`
        );
      }
      return null;
    }

    // 2. Verificar integridad criptográfica del registro oficial recuperado de la nube
    const integrity = await verifyFiscalRecordHash(remote);
    if (!integrity.valid) {
      throw new Error(
        `BackendFiscalCustody: Violación de integridad criptográfica en el registro '${recordId}' recuperado de la nube (${integrity.reason}). Operación abortada.`
      );
    }

    // 3. Si existe copia en la réplica local, contrastar que su huella no diverja del registro oficial
    if (local && local.huella.hash !== remote.huella.hash) {
      throw new Error(
        `BackendFiscalCustody: Corrupción o divergencia detectada en la réplica local del registro '${recordId}'. Su huella local (${local.huella.hash}) difiere de la huella oficial en la nube (${remote.huella.hash}). Operación abortada.`
      );
    }

    // 4. Sincronizar la réplica local si no estaba presente
    if (!local) {
      recordsCache.push(Object.freeze(remote));
      try { persistRecordsToDisk(); } catch {}
    }

    return remote;
  }

  /**
   * Obtiene todos los registros fiscales de la custodia.
   */
  public static getAllFiscalRecords(obligadoTributarioId?: string): FiscalRecord[] {
    this.init();
    loadFromDisk();
    if (obligadoTributarioId) {
      return recordsCache.filter(r => r.obligadoTributarioId === obligadoTributarioId);
    }
    return [...recordsCache];
  }

  /**
   * Registra una FiscalSubmission en la custodia de envíos con cerrojo global y persistencia fail-closed.
   * Compromete PRIMERO en la autoridad distribuida de la nube y SÓLO después actualiza la réplica local.
   */
  public static async saveFiscalSubmission(submission: FiscalSubmission): Promise<void> {
    if (!submission || !submission.id) {
      throw new Error('BackendFiscalCustody: Se requiere una FiscalSubmission válida con identificador.');
    }

    const releaseLock = await acquireGlobalPersistenceLock(15000);
    try {
      this.init();
      loadFromDisk(); // Lectura atómica del estado en disco

      // 1. C1: Persistir PRIMERO en la autoridad de nube de forma autoritativa y FAIL-CLOSED.
      // Si la nube rechaza o falla, la memoria local y el disco local NO se modifican (cero escrituras parciales).
      const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
      await CloudDistributedChainCoordinator.commitSubmission(submission);

      // 2. Actualizar la réplica local en memoria y disco SÓLO tras éxito en la autoridad cloud
      const idx = submissionsCache.findIndex(s => s.id === submission.id);
      if (idx !== -1) {
        submissionsCache[idx] = Object.freeze(submission);
      } else {
        submissionsCache.push(Object.freeze(submission));
      }

      persistSubmissionsToDisk();
    } catch (err: any) {
      console.error('BackendFiscalCustody: Error persistiendo submission:', err);
      throw err;
    } finally {
      releaseLock();
    }
  }

  /**
   * Obtiene las sumisiones registradas en el backend.
   * Soporta búsqueda tanto por fiscalRecordId principal como por inclusión en lotes (fiscalRecordIds / resultadosIndividuales).
   */
  public static getFiscalSubmissions(fiscalRecordId?: string): FiscalSubmission[] {
    this.init();
    loadFromDisk();
    if (fiscalRecordId) {
      return submissionsCache.filter(s =>
        s.fiscalRecordId === fiscalRecordId ||
        (Array.isArray(s.fiscalRecordIds) && s.fiscalRecordIds.includes(fiscalRecordId)) ||
        (Array.isArray(s.resultadosIndividuales) && s.resultadosIndividuales.some(r => r.fiscalRecordId === fiscalRecordId))
      );
    }
    return [...submissionsCache];
  }

  /**
   * Consulta autoritativa asíncrona en la nube de todas las FiscalSubmission asociadas a un FiscalRecord.
   * Garantiza idempotencia trans-instancia y evita envíos duplicados ante timeouts o respuestas perdidas.
   */
  public static async getFiscalSubmissionsForRecordAsync(fiscalRecordId: string): Promise<FiscalSubmission[]> {
    this.init();
    loadFromDisk();
    const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
    const remoteSubs = await CloudDistributedChainCoordinator.getSubmissionsForRecord(fiscalRecordId);
    // Sincronizar con caché local si hay sumisiones remotas que no estaban en la réplica local
    for (const remote of remoteSubs) {
      const idx = submissionsCache.findIndex(s => s.id === remote.id);
      if (idx !== -1) {
        submissionsCache[idx] = Object.freeze(remote);
      } else {
        submissionsCache.push(Object.freeze(remote));
      }
    }
    return remoteSubs;
  }

  /**
   * Registra un FiscalEvent de auditoría en la custodia del backend con cerrojo global y persistencia fail-closed.
   * Compromete PRIMERO en la autoridad distribuida de la nube y SÓLO después actualiza la réplica local.
   */
  public static async saveFiscalEvent(event: FiscalEvent): Promise<void> {
    if (!event || !event.id) {
      throw new Error('BackendFiscalCustody: Se requiere un FiscalEvent válido con identificador.');
    }

    const releaseLock = await acquireGlobalPersistenceLock(15000);
    try {
      this.init();
      loadFromDisk(); // Lectura atómica del estado en disco

      // 1. C1: Persistir PRIMERO en la autoridad de nube de forma autoritativa y FAIL-CLOSED.
      // Si la nube rechaza o falla, la memoria local y el disco local NO se modifican (cero escrituras parciales).
      const { CloudDistributedChainCoordinator } = await import('./cloudDistributedChainCoordinator');
      await CloudDistributedChainCoordinator.commitEvent(event);

      // 2. Actualizar la réplica local en memoria y disco SÓLO tras éxito en la autoridad cloud
      eventsCache.push(Object.freeze(event));
      persistEventsToDisk();
    } catch (err: any) {
      console.error('BackendFiscalCustody: Error persistiendo event:', err);
      throw err;
    } finally {
      releaseLock();
    }
  }

  /**
   * Obtiene los eventos de auditoría.
   * Soporta búsqueda por fiscalRecordId directo o incluido dentro de datos.fiscalRecordIds (lotes).
   */
  public static getFiscalEvents(fiscalRecordId?: string): FiscalEvent[] {
    this.init();
    loadFromDisk();
    if (fiscalRecordId) {
      return eventsCache.filter(e =>
        e.fiscalRecordId === fiscalRecordId ||
        (Array.isArray(e.datos?.fiscalRecordIds) && e.datos.fiscalRecordIds.includes(fiscalRecordId))
      );
    }
    return [...eventsCache];
  }

  /**
   * Reinicia la custodia en memoria y en disco (exclusivo para testing).
   */
  public static resetCustody(): void {
    recordsCache = [];
    submissionsCache = [];
    eventsCache = [];
    initialized = true;
    try {
      if (fs.existsSync(RECORDS_FILE)) fs.unlinkSync(RECORDS_FILE);
      if (fs.existsSync(SUBMISSIONS_FILE)) fs.unlinkSync(SUBMISSIONS_FILE);
      if (fs.existsSync(EVENTS_FILE)) fs.unlinkSync(EVENTS_FILE);
      const sharedState = path.resolve(process.cwd(), 'data', 'cloud_shared_chain_state.json');
      if (fs.existsSync(sharedState)) fs.unlinkSync(sharedState);
    } catch {}
  }
}
