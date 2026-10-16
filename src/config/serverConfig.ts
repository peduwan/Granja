/**
 * CONFIGURACIÓN CENTRALIZADA DEL SERVIDOR Y PROPIEDAD RAÍZ (A5)
 *
 * Módulo aislado sin dependencias de Express ni de módulos del cliente (UI/storage).
 * Directamente importable desde tests unitarios y procesos de backend.
 */

export const DEFAULT_ROOT_OWNER_EMAIL = 'peduwan@gmail.com';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function getRootOwnerEmail(): string {
  const envEmail = process.env.ROOT_OWNER_EMAIL?.trim();
  if (envEmail) {
    if (!isValidEmail(envEmail)) {
      throw new Error(`serverConfig: ROOT_OWNER_EMAIL inválido en variables de entorno: '${envEmail}'`);
    }
    return envEmail.toLowerCase();
  }
  return DEFAULT_ROOT_OWNER_EMAIL.toLowerCase();
}

export const ROOT_OWNER_EMAIL = getRootOwnerEmail();

export interface ServerConfig {
  readonly rootOwnerEmail: string;
  readonly port: number;
  readonly isProduction: boolean;
}

export function getServerConfig(): ServerConfig {
  const rootOwnerEmail = getRootOwnerEmail();
  const port = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  return Object.freeze({
    rootOwnerEmail,
    port: isNaN(port) ? 3000 : port,
    isProduction
  });
}
