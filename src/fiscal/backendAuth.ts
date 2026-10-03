/**
 * SERVICIO DE AUTENTICACIÓN Y AUTORIZACIÓN FISCAL DE BACKEND (FASE 3.1.4)
 *
 * Cumplimiento con:
 * - Ley 11/2021 de medidas de prevención y lucha contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 *
 * INVARIANTES DE SEGURIDAD CRIPTOGRÁFICA:
 * 1. Todos los endpoints fiscales de backend exigen autenticación criptográfica.
 * 2. Ningún dato sensible de rol, email o uid enviado por el cliente es de confianza.
 * 3. Se verifica server-side la firma criptográfica RSA-SHA256 (RS256) del token Firebase ID
 *    contra los certificados públicos oficiales de Google (Google X.509 certs).
 * 4. Solo usuarios autorizados (propietario o usuarios en lista blanca) pueden invocar operaciones fiscales.
 * 5. Se valida estrictamente la correspondencia del obligado tributario con las organizaciones autorizadas.
 * 6. Rechazo taxativo de NIFs ficticios, placeholders ('ES_UNKNOWN', 'B12345678', etc.) y NIFs mal formados.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json';
import { ROOT_OWNER_EMAIL } from '../utils/storage';

export interface AuthenticatedFiscalUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  isOwner: boolean;
  authorizedObligados: string[]; // Lista de NIFs de obligados tributarios autorizados
}

// Extensión de Express Request para tipado
export interface FiscalAuthenticatedRequest extends Request {
  fiscalUser?: AuthenticatedFiscalUser;
}

// Almacén en memoria de claves públicas de test (para probar firmas criptográficas RS256 en suites de tests offline)
const testPublicKeysRegistry = new Map<string, string>();

/**
 * Registra una clave pública de test para validación criptográfica estricta de tokens RS256 en suites de tests.
 * En producción (NODE_ENV=production) está estrictamente bloqueado para impedir cualquier bypass.
 */
export function registerTestPublicKey(kid: string, publicKeyPem: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('VIOLACIÓN DE SEGURIDAD: Prohibido registrar claves públicas de test en entorno de producción.');
  }
  testPublicKeysRegistry.set(kid, publicKeyPem);
}

export function clearTestAuthTokens(): void {
  testPublicKeysRegistry.clear();
}

// Caché en memoria de certificados X.509 públicos de Google
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let googleCertsCache: Record<string, string> | null = null;
let googleCertsCacheExpiresAt = 0;

/**
 * Obtiene los certificados públicos oficiales de Google para verificación de Firebase ID Tokens.
 */
async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && googleCertsCache && now < googleCertsCacheExpiresAt) {
    return googleCertsCache;
  }

  try {
    const res = await fetch(GOOGLE_CERTS_URL);
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al recuperar certificados públicos de Google.`);
    }

    // Parsear encabezado Cache-Control para tiempo de vida de la caché
    const cacheControl = res.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const maxAgeSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

    const certs = await res.json() as Record<string, string>;
    googleCertsCache = certs;
    googleCertsCacheExpiresAt = now + (maxAgeSeconds * 1000);
    return certs;
  } catch (err: any) {
    if (googleCertsCache) {
      return googleCertsCache; // Usar caché existente en caso de fallo de red transitorio
    }
    throw new Error(`No se pudieron obtener certificados de autenticación de Google: ${err.message}`);
  }
}

/**
 * Validador formal de formato de NIF/CIF/NIE español.
 * Longitud 9 caracteres:
 * - DNI: 8 dígitos + 1 letra control
 * - NIE: X/Y/Z + 7 dígitos + 1 letra control
 * - CIF: 1 letra tipo + 7 dígitos + 1 carácter control (letra o dígito)
 */
export function isValidSpanishNifCifNie(nifRaw: string): boolean {
  if (!nifRaw || typeof nifRaw !== 'string') return false;
  const nif = nifRaw.trim().toUpperCase();

  // Rechazo explícito de placeholders y valores ficticios
  if (
    nif === 'ES_UNKNOWN' ||
    nif === 'UNKNOWN' ||
    nif === 'B12345678' ||
    nif === 'B99999999' ||
    nif === '000000000' ||
    nif.length !== 9
  ) {
    return false;
  }

  // Regex estándar NIF/NIE/CIF
  const cifNieDniRegex = /^([ABCDEFGHJKLMNPQRSUVW][0-9]{7}[0-9A-J]|[0-9]{8}[TRWAGMYFPDXBNJZSQVHLCKE]|[XYZ][0-9]{7}[TRWAGMYFPDXBNJZSQVHLCKE])$/;
  return cifNieDniRegex.test(nif);
}

/**
 * Verifica criptográficamente un Firebase ID Token (firma RS256 con certificados Google) o token de test.
 */
export async function verifyFiscalToken(token: string): Promise<AuthenticatedFiscalUser> {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new Error('Token de autenticación vacío o no proporcionado.');
  }

  // 1. Parseo y verificación estructural del JWT (header.payload.signature)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Formato de token de autenticación inválido. Se requiere un JWT válido de 3 partes.');
  }

  let header: any;
  try {
    const headerJson = Buffer.from(parts[0], 'base64url').toString('utf-8');
    header = JSON.parse(headerJson);
  } catch {
    throw new Error('Cabecera del token de autenticación malformada.');
  }

  let payload: any;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error('Carga útil del token de autenticación malformada.');
  }

  // 2. Verificación formal de cabecera criptográfica
  if (!header || header.alg !== 'RS256') {
    throw new Error(`Algoritmo criptográfico de token no permitido ('${header?.alg}'). Solo se admite RS256.`);
  }

  const kid = header.kid;
  if (!kid || typeof kid !== 'string') {
    throw new Error("El token de autenticación no especifica el identificador de clave pública ('kid').");
  }

  // 3. Verificación criptográfica estricta de la firma digital (RS256)
  const isProduction = process.env.NODE_ENV === 'production';
  let publicKeyPem: string | undefined = !isProduction ? testPublicKeysRegistry.get(kid) : undefined;

  if (!publicKeyPem) {
    let googleCerts = await getGooglePublicCerts(false);
    if (!googleCerts[kid]) {
      // Reintentar refrescando la caché por si hubo rotación reciente de claves
      googleCerts = await getGooglePublicCerts(true);
    }
    publicKeyPem = googleCerts[kid];
  }

  if (!publicKeyPem) {
    throw new Error(`Clave pública con identificador kid '${kid}' no reconocida o no autorizada por Google.`);
  }

  const signedData = `${parts[0]}.${parts[1]}`;
  const signatureBase64Url = parts[2];

  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signedData);
    const isSignatureValid = verifier.verify(publicKeyPem, signatureBase64Url, 'base64url');
    if (!isSignatureValid) {
      throw new Error('Firma criptográfica inválida.');
    }
  } catch (cryptoErr: any) {
    throw new Error(`Fallo en la verificación criptográfica de la firma del token: ${cryptoErr.message || 'Firma alterada o no válida'}`);
  }

  // 4. Verificación de claims canónicos del Firebase ID Token (RFC 7519 / Especificaciones Oficiales Firebase)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const clockSkewAllowance = 10; // 10 segundos de holgura por desviación horaria

  if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < (nowSeconds - clockSkewAllowance)) {
    throw new Error('El token de autenticación ha expirado.');
  }

  if (typeof payload.iat !== 'number' || payload.iat > (nowSeconds + clockSkewAllowance)) {
    throw new Error("El token de autenticación no contiene 'iat' válido o fue emitido en el futuro.");
  }

  if (typeof payload.auth_time !== 'number' || payload.auth_time > (nowSeconds + clockSkewAllowance)) {
    throw new Error("El token de autenticación no contiene 'auth_time' válido o es posterior al tiempo actual.");
  }

  const expectedProjectId = firebaseConfig.projectId;
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;

  if (payload.iss !== expectedIssuer) {
    throw new Error(`Emisor del token ('${payload.iss}') no coincide con el emisor oficial autorizado ('${expectedIssuer}').`);
  }

  if (payload.aud !== expectedProjectId) {
    throw new Error(`Audiencia del token ('${payload.aud}') no coincide con el ID de proyecto autorizado ('${expectedProjectId}').`);
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 128) {
    throw new Error("El token de autenticación no contiene un identificador 'sub' válido.");
  }

  const email = (payload.email || '').trim().toLowerCase();
  const uid = (payload.user_id || sub).trim();
  const emailVerified = Boolean(payload.email_verified);

  if (!email || !uid) {
    throw new Error('El token de autenticación no contiene email o identificador de usuario válido.');
  }

  // Autorización multi-nivel: soporte para Custom Claims (adminFiscal/isOwner/role) y email raíz
  const isOwner = payload.adminFiscal === true ||
                  payload.isOwner === true ||
                  payload.role === 'admin' ||
                  email === ROOT_OWNER_EMAIL.toLowerCase();

  // Obligados autorizados para este usuario (sin NIF por defecto ni fallback ficticio)
  const authorizedObligados = isOwner
    ? ['*'] // Comodín para propietario (cualquier NIF legal de la granja)
    : (Array.isArray(payload.authorizedObligados)
        ? payload.authorizedObligados.filter((n: any) => typeof n === 'string' && isValidSpanishNifCifNie(n))
        : []);

  return {
    uid,
    email,
    emailVerified,
    isOwner,
    authorizedObligados
  };
}

/**
 * Middleware Express para proteger rutas fiscales con autenticación y autorización estricta.
 */
export async function requireFiscalAuthMiddleware(
  req: FiscalAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Acceso no autorizado: Token de autenticación Bearer requerido para operaciones fiscales de backend.'
    });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const user = await verifyFiscalToken(token);

    // Validación de autorización: debe ser propietario o usuario autorizado
    if (!user.isOwner && !user.authorizedObligados.length) {
      res.status(403).json({
        error: `Acceso denegado: El usuario autenticado (${user.email}) no cuenta con autorización fiscal en el sistema.`
      });
      return;
    }

    req.fiscalUser = user;
    next();
  } catch (err: any) {
    res.status(401).json({
      error: 'Token de autenticación inválido o expirado.',
      details: err.message
    });
  }
}

/**
 * Valida que el obligado tributario de la solicitud esté formalmente autorizado para el usuario autenticado.
 */
export function assertObligadoAuthorized(
  user: AuthenticatedFiscalUser,
  requestedObligadoRaw: string
): string {
  if (!requestedObligadoRaw || typeof requestedObligadoRaw !== 'string') {
    throw new Error('NIF/Identificador de obligado tributario obligatorio.');
  }

  const obligado = requestedObligadoRaw.trim().toUpperCase();

  // Validación de sintaxis oficial NIF/CIF
  if (!isValidSpanishNifCifNie(obligado)) {
    throw new Error(`NIF de obligado tributario inválido o no admitido ('${obligado}'). Se prohíben valores vacíos, ES_UNKNOWN y B12345678.`);
  }

  // Si el usuario es Propietario raíz, tiene autorización
  if (user.isOwner || user.authorizedObligados.includes('*')) {
    return obligado;
  }

  // Para otros usuarios, verificar coincidencia estricta en su lista blanca
  if (!user.authorizedObligados.includes(obligado)) {
    const err: any = new Error(`Acceso denegado: El usuario (${user.email}) no está autorizado para emitir registros en nombre del obligado tributario '${obligado}'.`);
    err.statusCode = 403;
    throw err;
  }

  return obligado;
}
