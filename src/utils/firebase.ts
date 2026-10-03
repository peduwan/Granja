import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInAnonymously,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  Firestore
} from 'firebase/firestore';
import { AppData, RolUsuario, UsuarioAutorizado, FiscalRecord, FiscalSubmission, FiscalEvent } from '../types';
import { ROOT_OWNER_EMAIL } from './storage';

import firebaseConfig from '../../firebase-applet-config.json';

// Inicialización segura de Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// Inicializar Firestore con la base de datos configurada y experimentalForceLongPolling
// para evitar bloqueos por streaming/WebSockets en entornos de iframe y contenedores
function initFirestoreInstance(): Firestore {
  const rawDbId = firebaseConfig.firestoreDatabaseId;
  const dbId = (rawDbId && rawDbId.trim() !== '' && rawDbId !== '(default)') ? rawDbId.trim() : undefined;

  const settingsWithCache = {
    experimentalForceLongPolling: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  };

  const settingsMemory = {
    experimentalForceLongPolling: true,
    localCache: memoryLocalCache()
  };

  try {
    return dbId
      ? initializeFirestore(app, settingsWithCache, dbId)
      : initializeFirestore(app, settingsWithCache);
  } catch (err1) {
    try {
      return dbId
        ? initializeFirestore(app, settingsMemory, dbId)
        : initializeFirestore(app, settingsMemory);
    } catch (err2) {
      return dbId ? getFirestore(app, dbId) : getFirestore(app);
    }
  }
}

export const db = initFirestoreInstance();

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: RolUsuario;
  isOwner?: boolean;
  isAnonymous?: boolean;
  isUnauthorized?: boolean;
}

const FARM_DOC_ID = 'granja_principal';
const LOCAL_USER_KEY = 'gestion_avicola_local_user';

// Obtener usuario local emulado si no se usa Firebase Auth directo
function getSavedLocalUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalUser(user: UserProfile | null) {
  try {
    if (user) {
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(LOCAL_USER_KEY);
    }
  } catch {
    // Ignorar si falla storage
  }
}

let activeLocalUser: UserProfile | null = getSavedLocalUser();
const authSubscribers = new Set<(user: UserProfile | null) => void>();

function notifySubscribers(user: UserProfile | null) {
  authSubscribers.forEach(cb => cb(user));
}

/**
 * Comprueba si un correo de Google está autorizado en el sistema:
 * 1. Si es PEDUWAN@gmail.com -> Siempre autorizado como Propietario.
 * 2. Si existe en la colección Firestore /authorized_users/{email} y activo !== false.
 * 3. Si existe en la lista de usuariosAutorizados del documento de granja.
 */
export async function verifyUserAuthorization(
  email: string,
  localList?: UsuarioAutorizado[]
): Promise<{ authorized: boolean; role: RolUsuario; displayName?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const isOwner = cleanEmail === ROOT_OWNER_EMAIL.toLowerCase();

  if (isOwner) {
    return {
      authorized: true,
      role: 'propietario',
      displayName: 'Propietario Principal'
    };
  }

  // 1. Comprobar en lista local si fue provista
  if (localList && localList.length > 0) {
    const foundLocal = localList.find(u => u.email.trim().toLowerCase() === cleanEmail);
    if (foundLocal) {
      if (foundLocal.activo !== false) {
        return { authorized: true, role: foundLocal.rol, displayName: foundLocal.nombre };
      } else {
        return { authorized: false, role: 'lector' };
      }
    }
  }

  // 2. Comprobar en Firestore colección /authorized_users
  try {
    const authUserRef = doc(db, 'authorized_users', cleanEmail);
    const authDocSnap = await getDoc(authUserRef);
    if (authDocSnap.exists()) {
      const data = authDocSnap.data();
      if (data.activo !== false) {
        return {
          authorized: true,
          role: (data.rol as RolUsuario) || 'operario',
          displayName: data.nombre
        };
      } else {
        return { authorized: false, role: 'lector' };
      }
    }
  } catch (err) {
    console.warn('Verificando colección authorized_users:', err);
  }

  // 3. Comprobar en Firestore en /farms/granja_principal
  try {
    const farmRef = doc(db, 'farms', FARM_DOC_ID);
    const farmSnap = await getDoc(farmRef);
    if (farmSnap.exists()) {
      const farmData = farmSnap.data() as AppData;
      const foundInFarm = farmData.usuariosAutorizados?.find(u => u.email.trim().toLowerCase() === cleanEmail);
      if (foundInFarm) {
        if (foundInFarm.activo !== false) {
          return {
            authorized: true,
            role: foundInFarm.rol,
            displayName: foundInFarm.nombre
          };
        } else {
          return { authorized: false, role: 'lector' };
        }
      }
    }
  } catch (err) {
    console.warn('Verificando en documento granja_principal:', err);
  }

  return { authorized: false, role: 'lector' };
}

/**
 * Escuchar cambios en el estado de autenticación (Firebase Auth + Sesión Local Granja)
 */
export function onAuthChange(callback: (user: UserProfile | null) => void) {
  authSubscribers.add(callback);

  // Notificar estado inmediato (local o Firebase)
  if (activeLocalUser) {
    callback(activeLocalUser);
  } else if (auth.currentUser) {
    const email = auth.currentUser.email || '';
    const isOwner = email.trim().toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase();
    callback({
      uid: auth.currentUser.uid,
      email: auth.currentUser.email,
      displayName: auth.currentUser.displayName || (isOwner ? 'Propietario Principal' : 'Operario'),
      role: isOwner ? 'propietario' : 'admin',
      isOwner,
      isAnonymous: auth.currentUser.isAnonymous
    });
  } else {
    callback(null);
  }

  const unsubscribeFirebase = onAuthStateChanged(auth, async (firebaseUser) => {
    if (activeLocalUser) {
      callback(activeLocalUser);
      return;
    }

    if (!firebaseUser) {
      callback(null);
      return;
    }

    const email = firebaseUser.email || '';
    const cleanEmail = email.trim().toLowerCase();
    const isOwner = cleanEmail === ROOT_OWNER_EMAIL.toLowerCase();

    // Validar autorización
    const authStatus = await verifyUserAuthorization(cleanEmail);

    if (!authStatus.authorized && !isOwner) {
      // Usuario no habilitado por el propietario
      const blockedProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || email.split('@')[0],
        role: 'lector',
        isOwner: false,
        isUnauthorized: true
      };
      callback(blockedProfile);
      return;
    }

    const effectiveRole: RolUsuario = isOwner ? 'propietario' : authStatus.role;
    const effectiveDisplayName = authStatus.displayName || firebaseUser.displayName || (isOwner ? 'Propietario Principal' : email.split('@')[0]);

    const profile: UserProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: effectiveDisplayName,
      role: effectiveRole,
      isOwner,
      isAnonymous: firebaseUser.isAnonymous,
      isUnauthorized: false
    };

    callback(profile);
  });

  return () => {
    authSubscribers.delete(callback);
    unsubscribeFirebase();
  };
}

/**
 * Iniciar sesión con Google (Popup de Google Identity / Firebase)
 * Verifica estrictamente que el usuario sea el Propietario (PEDUWAN@gmail.com)
 * o esté en la lista de usuarios autorizados previamente habilitados por él.
 */
export async function loginWithGoogle(): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  
  const result = await signInWithPopup(auth, provider);
  if (!result.user || !result.user.email) {
    throw new Error('No se pudo obtener la cuenta de Google seleccionada.');
  }

  const email = result.user.email.trim().toLowerCase();
  const isOwner = email === ROOT_OWNER_EMAIL.toLowerCase();
  const displayName = result.user.displayName || (isOwner ? 'Propietario Principal' : email.split('@')[0]);

  // Verificar si está en la lista de autorizados
  const authStatus = await verifyUserAuthorization(email);

  if (!authStatus.authorized && !isOwner) {
    const blockedUser: UserProfile = {
      uid: result.user.uid,
      email: result.user.email,
      displayName,
      role: 'lector',
      isOwner: false,
      isUnauthorized: true
    };
    activeLocalUser = blockedUser;
    saveLocalUser(blockedUser);
    notifySubscribers(blockedUser);
    return {
      success: false,
      user: blockedUser,
      error: `La cuenta de Google (${email}) no está dada de alta en el sistema. Contacta con el propietario (${ROOT_OWNER_EMAIL}) para que habilite tu acceso.`
    };
  }

  const role: RolUsuario = isOwner ? 'propietario' : authStatus.role;
  const effectiveDisplayName = authStatus.displayName || displayName;

  // Registrar / actualizar en Firestore
  try {
    const userDocRef = doc(db, 'users', result.user.uid);
    await setDoc(userDocRef, {
      email,
      displayName: effectiveDisplayName,
      role,
      isOwner,
      ultimoAcceso: new Date().toISOString()
    }, { merge: true });

    // Guardar / actualizar en authorized_users
    const authUserDocRef = doc(db, 'authorized_users', email);
    await setDoc(authUserDocRef, {
      email,
      nombre: effectiveDisplayName,
      rol: role,
      activo: true,
      ultimoAcceso: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Actualización de perfil en Firestore:', err);
  }

  const profile: UserProfile = {
    uid: result.user.uid,
    email: result.user.email,
    displayName: effectiveDisplayName,
    role,
    isOwner,
    isAnonymous: false,
    isUnauthorized: false
  };

  activeLocalUser = profile;
  saveLocalUser(profile);
  notifySubscribers(profile);

  return { success: true, user: profile };
}

/**
 * Guarda o actualiza un usuario en la colección de usuarios autorizados en Firestore
 */
export async function syncAuthorizedUserToCloud(user: UsuarioAutorizado): Promise<boolean> {
  try {
    const cleanEmail = user.email.trim().toLowerCase();
    const authDocRef = doc(db, 'authorized_users', cleanEmail);
    await setDoc(authDocRef, {
      email: cleanEmail,
      nombre: user.nombre || cleanEmail.split('@')[0],
      rol: user.rol,
      activo: user.activo,
      agregadoPor: user.agregadoPor,
      fechaAlta: user.fechaAlta || new Date().toISOString(),
      ultimoAcceso: user.ultimoAcceso || null,
      notas: user.notas || ''
    }, { merge: true });
    return true;
  } catch (err) {
    console.warn('Error guardando usuario autorizado en Firestore:', err);
    return false;
  }
}

/**
 * Elimina un usuario de la colección de autorizados en Firestore
 */
export async function deleteAuthorizedUserFromCloud(email: string): Promise<boolean> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail === ROOT_OWNER_EMAIL.toLowerCase()) {
      throw new Error('El propietario principal no puede ser eliminado.');
    }
    const authDocRef = doc(db, 'authorized_users', cleanEmail);
    await deleteDoc(authDocRef);
    return true;
  } catch (err) {
    console.warn('Error eliminando usuario autorizado en Firestore:', err);
    return false;
  }
}

/**
 * Cerrar sesión
 */
export async function logoutUser(): Promise<void> {
  activeLocalUser = null;
  saveLocalUser(null);
  notifySubscribers(null);
  try {
    await signOut(auth);
  } catch {}
}


/**
 * Limpia recursivamente cualquier objeto para Firestore eliminando propiedades con valor undefined
 * (ya que Firestore rechaza documentos con campos undefined lanzando error:
 * "Function setDoc() called with invalid data. Unsupported field value: undefined")
 */
export function sanitizeForFirestore<T>(val: T): T {
  if (val === undefined) {
    return null as any;
  }
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as unknown as T;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(val)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
}

/**
 * Guardar / Sincronizar datos de la granja en Firestore
 * En FASE 1.1: Se asegura que el snapshot de la granja en /farms/granja_principal
 * NO contenga el array completo de FiscalRecord, evitando dos copias de la verdad fiscal.
 * Solo se almacenan referencias livianas (fiscalRecordRefs).
 */
export async function syncFarmDataToCloud(data: AppData, userUid?: string): Promise<boolean> {
  try {
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch {
        // En caso de que anonymous auth no esté activo, continúa con las reglas desplegadas
      }
    }
    const farmRef = doc(db, 'farms', FARM_DOC_ID);
    
    // Desacoplar y asegurar que nunca se envíe el documento completo del registro fiscal
    const { ...payloadData } = data as any;
    delete payloadData.fiscalRecords; // Eliminar cualquier duplicado accidental en el snapshot de granja

    const sanitizedData = sanitizeForFirestore({
      ...payloadData,
      ultimaActualizacion: new Date().toISOString(),
      actualizadoPor: userUid || activeLocalUser?.email || auth.currentUser?.email || 'operario'
    });
    await setDoc(farmRef, sanitizedData, { merge: true });
    return true;
  } catch (err) {
    console.warn('Sincronización con Firestore pendiente o en modo local:', err);
    return false;
  }
}

/**
 * Suscribirse a cambios en tiempo real desde Firestore
 */
export function subscribeToFarmCloudData(
  onData: (data: AppData) => void,
  onError?: (err: any) => void,
  onEmpty?: () => void
) {
  const farmRef = doc(db, 'farms', FARM_DOC_ID);
  return onSnapshot(farmRef, (docSnap) => {
    if (docSnap.exists()) {
      const cloudData = docSnap.data() as AppData;
      if (cloudData.naves && cloudData.lotesPuesta) {
        onData(cloudData);
      }
    } else {
      if (onEmpty) {
        onEmpty();
      }
    }
  }, (err) => {
    console.warn('Aviso conexión Firestore:', err);
    if (onError) onError(err);
  });
}

/**
 * Persiste un FiscalRecord en su ÚNICA FUENTE PERSISTENTE DE VERDAD:
 * Colección `/fiscal_records/{recordId}`.
 * Blindada por firestore.rules para rechazar cualquier mutación posterior (update/delete false).
 * 
 * FASE 1.3:
 * - Prohibido persistir placeholders (PENDING_FASE_2_HASH, <pending_xml/>, ES_UNKNOWN).
 * - obligadoTributarioId y emisor.nif son obligatorios.
 * - Los errores de persistencia NO se silencian; deben propagarse al llamador para abortar la emisión.
 */
export async function saveFiscalRecordToCloud(record: FiscalRecord): Promise<boolean> {
  // Prohibición estricta de escritura directa desde el cliente del navegador (Fase 3.1.4)
  if (typeof window !== 'undefined') {
    throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: Los clientes web no pueden escribir directamente en /fiscal_records. La emisión y custodia residen exclusivamente en backend.');
  }

  // 1. Validaciones estrictas de integridad y custodia fiscal (Fase 1.3)
  if (!record.obligadoTributarioId || record.obligadoTributarioId.trim() === '' || record.obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('saveFiscalRecordToCloud: obligadoTributarioId es obligatorio y no puede estar vacío ni ser ES_UNKNOWN.');
  }

  if (!record.emisor?.nif || record.emisor.nif.trim() === '' || record.emisor.nif === 'ES_UNKNOWN') {
    throw new Error('saveFiscalRecordToCloud: NIF del emisor es obligatorio y no puede ser ES_UNKNOWN.');
  }

  if (!record.huella || !record.huella.hash || record.huella.hash === 'PENDING_FASE_2_HASH') {
    throw new Error('saveFiscalRecordToCloud: No se puede persistir un FiscalRecord con huella provisional o ausente (PENDING_FASE_2_HASH).');
  }

  if (record.xmlOficial === '<pending_xml/>') {
    throw new Error('saveFiscalRecordToCloud: No se puede persistir un FiscalRecord con XML provisional (<pending_xml/>).');
  }

  // 2. Persistencia en /fiscal_records sin silenciar fallos de custodia
  const recordRef = doc(db, 'fiscal_records', record.id);
  await setDoc(recordRef, sanitizeForFirestore(record));
  return true;
}


/**
 * Recupera un FiscalRecord desde su única fuente persistente de verdad.
 */
export async function getFiscalRecordFromCloud(recordId: string): Promise<FiscalRecord | null> {
  try {
    const recordRef = doc(db, 'fiscal_records', recordId);
    const snap = await getDoc(recordRef);
    if (snap.exists()) {
      return snap.data() as FiscalRecord;
    }
    return null;
  } catch (err) {
    console.warn('Error al recuperar FiscalRecord:', err);
    return null;
  }
}

/**
 * Persiste un FiscalSubmission en la colección `/fiscal_submissions/{submissionId}`.
 */
export async function saveFiscalSubmissionToCloud(submission: FiscalSubmission): Promise<boolean> {
  if (typeof window !== 'undefined') {
    throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: Los clientes web no pueden escribir directamente en /fiscal_submissions. El outbox es gestionado exclusivamente por el backend.');
  }
  if (!submission.obligadoTributarioId || submission.obligadoTributarioId === 'ES_UNKNOWN' || submission.obligadoTributarioId.trim() === '') {
    throw new Error('saveFiscalSubmissionToCloud: obligadoTributarioId es obligatorio y no puede ser ES_UNKNOWN.');
  }
  if (!submission.xmlEnviado || submission.xmlEnviado === '<pending_xml/>' || submission.xmlEnviado.trim() === '') {
    throw new Error('saveFiscalSubmissionToCloud: No se permite <pending_xml/> en FiscalSubmission.');
  }

  const subRef = doc(db, 'fiscal_submissions', submission.id);
  await setDoc(subRef, sanitizeForFirestore(submission));
  return true;
}

/**
 * Registra un FiscalEvent inmutable en el libro de auditoría `/fiscal_events/{eventId}`.
 */
export async function saveFiscalEventToCloud(event: FiscalEvent): Promise<boolean> {
  if (typeof window !== 'undefined') {
    throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: Los clientes web no pueden escribir directamente en /fiscal_events. El libro de auditoría es gestionado exclusivamente por el backend.');
  }
  if (!event.obligadoTributarioId || event.obligadoTributarioId === 'ES_UNKNOWN' || event.obligadoTributarioId.trim() === '') {
    throw new Error('saveFiscalEventToCloud: obligadoTributarioId es obligatorio y no puede ser ES_UNKNOWN.');
  }

  const evtRef = doc(db, 'fiscal_events', event.id);
  await setDoc(evtRef, sanitizeForFirestore(event));
  return true;
}

/**
 * @deprecated LEGACY / FUNCIÓN EXCLUSIVA DE MIGRACIÓN HISTÓRICA
 * No debe ser invocada por ningún flujo normal de facturación ni nuevas emisiones.
 * Las nuevas emisiones persisten exclusivamente en /fiscal_records/{recordId} vía emitFiscalInvoice.
 */
export async function migrateLegacyBillingRecord(registro: any): Promise<boolean> {
  if (typeof window !== 'undefined') {
    throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: Prohibida la escritura en /registros_facturacion desde clientes del navegador.');
  }
  try {
    const regRef = doc(db, 'registros_facturacion', registro.id || `reg_${Date.now()}`);
    await setDoc(regRef, sanitizeForFirestore(registro));
    return true;
  } catch (err) {
    console.warn('migrateLegacyBillingRecord:', err);
    return false;
  }
}


