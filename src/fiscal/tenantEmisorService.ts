/**
 * SERVICIO DE GESTIÓN DE PERFILES DE EMISOR Y TENANTS (A1)
 *
 * Cumplimiento:
 * - Separación estricta entre la identidad del fabricante del SIF (SIF_NIF, SIF_NOMBRE_RAZON)
 *   y la identidad del obligado tributario / emisor de la factura (emisor.nif, emisor.nombreRazon).
 * - Rechazo con HTTP 400 Bad Request si el cliente envía un nombreRazonEmisor que discrepa
 *   del perfil registrado de la explotación para ese NIF.
 */

import { getSifIdentityConfig } from '../config/sifIdentity';

export interface FarmEmisorProfile {
  readonly nif: string;
  readonly nombreRazon: string;
  readonly codigoRega?: string;
  readonly direccion?: string;
  readonly email?: string;
}

// Almacén en memoria de perfiles de emisores / granjas registrados
const registeredEmisorProfiles = new Map<string, FarmEmisorProfile>();

export function registerFarmEmisorProfile(profile: FarmEmisorProfile): void {
  if (!profile || !profile.nif || !profile.nombreRazon) {
    throw new Error('registerFarmEmisorProfile: nif y nombreRazon son obligatorios.');
  }
  const cleanNif = profile.nif.trim().toUpperCase();
  const cleanNombre = profile.nombreRazon.trim();
  registeredEmisorProfiles.set(cleanNif, {
    ...profile,
    nif: cleanNif,
    nombreRazon: cleanNombre
  });
}

export function getFarmEmisorProfile(nif: string): FarmEmisorProfile | undefined {
  if (!nif) return undefined;
  return registeredEmisorProfiles.get(nif.trim().toUpperCase());
}

export function clearRegisteredEmisorProfiles(): void {
  registeredEmisorProfiles.clear();
}

export interface ValidateEmisorCoherenceInput {
  nif: string;
  clientNombreRazon?: string;
  expectedNombreRazon?: string;
}

export interface EmisorCoherenceResult {
  valid: boolean;
  resolvedNombreRazon: string;
  error?: string;
}

/**
 * Valida la coherencia de la razón social del emisor frente al perfil registrado (A1).
 * Si hay discrepancia entre lo enviado por el cliente y el perfil oficial registrado de la explotación,
 * devuelve error para retornar HTTP 400 Bad Request.
 */
export function validateEmisorTenantCoherence(input: ValidateEmisorCoherenceInput): EmisorCoherenceResult {
  const cleanNif = (input.nif || '').trim().toUpperCase();
  const clientNombre = (input.clientNombreRazon || '').trim();
  
  // Perfil registrado en el sistema o proporcionado explícitamente como expectativa
  const registered = input.expectedNombreRazon?.trim() || registeredEmisorProfiles.get(cleanNif)?.nombreRazon;

  if (registered && clientNombre) {
    if (registered.toUpperCase() !== clientNombre.toUpperCase()) {
      return {
        valid: false,
        resolvedNombreRazon: registered,
        error: 'Discrepancia en la razón social del emisor'
      };
    }
  }

  const resolved = registered || clientNombre;
  if (!resolved) {
    return {
      valid: false,
      resolvedNombreRazon: '',
      error: 'Razón social del emisor no especificada y no existe perfil registrado para este NIF.'
    };
  }

  return {
    valid: true,
    resolvedNombreRazon: resolved
  };
}
