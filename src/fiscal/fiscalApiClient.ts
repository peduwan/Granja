/**
 * CLIENTE API FISCAL DE BACKEND (FASE 3.1.5 / CLOUD RESILIENCE)
 *
 * Responsabilidad:
 * Encapsula de forma estricta las llamadas desde el cliente web (React)
 * hacia los endpoints autoritativos de emisión fiscal del backend en server.ts:
 * - POST /api/fiscal/emit-invoice
 * - POST /api/fiscal/emit-anulacion
 * - POST /api/fiscal/submit
 *
 * Garantía:
 * El cliente del navegador NUNCA calcula huellas SHA-256 definitivas,
 * NUNCA resuelve el hash anterior por su cuenta y NUNCA escribe directamente en Firestore.
 * Toda emisión se delega al backend con token Bearer de Firebase Auth.
 */

import { Factura, FiscalRecord, FiscalRecordRef, FiscalConfiguration, FiscalSubmission } from '../types';
import { auth } from '../utils/firebase';

/**
 * Emite una factura fiscal delegando autoritativamente en el backend.
 */
export async function emitFiscalInvoiceViaBackend(params: {
  invoiceDraft: Factura;
  fiscalConfig?: FiscalConfiguration;
  obligadoTributarioId?: string;
}): Promise<{
  success: boolean;
  invoice: Factura;
  fiscalRecord: FiscalRecord;
  fiscalRecordRef: FiscalRecordRef;
}> {
  let authHeaders: Record<string, string> = {};
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch('/api/fiscal/emit-invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      invoiceDraft: params.invoiceDraft,
      obligadoTributarioId: params.obligadoTributarioId || params.fiscalConfig?.obligadoTributarioId || params.fiscalConfig?.nifEmisor
    })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Error en la emisión fiscal del backend (HTTP ${res.status})`);
  }

  return await res.json();
}

/**
 * Emite una anulación fiscal delegando autoritativamente en el backend.
 */
export async function emitFiscalAnulacionViaBackend(params: {
  facturaAnulada: Factura;
  fiscalConfig: FiscalConfiguration;
  obligadoTributarioId?: string;
}): Promise<{
  success: boolean;
  fiscalRecord: FiscalRecord;
  fiscalRecordRef: FiscalRecordRef;
}> {
  let authHeaders: Record<string, string> = {};
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch('/api/fiscal/emit-anulacion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      facturaAnulada: params.facturaAnulada,
      fiscalConfig: params.fiscalConfig,
      obligadoTributarioId: params.obligadoTributarioId
    })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Error en la anulación fiscal del backend (HTTP ${res.status})`);
  }

  return await res.json();
}

/**
 * Remite una factura fiscal existente a la AEAT a través del backend.
 */
export async function submitFiscalRecordViaBackend(fiscalRecordId: string): Promise<{
  submission: FiscalSubmission;
  fiscalEvent: any;
  isTechnicalError?: boolean;
}> {
  let authHeaders: Record<string, string> = {};
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch('/api/fiscal/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({ fiscalRecordId })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Error en la remisión AEAT del backend (HTTP ${res.status})`);
  }

  return await res.json();
}

/**
 * Remite un lote de 1 a 1.000 registros fiscales existentes a la AEAT en una única petición SOAP a través del backend.
 */
export async function submitFiscalBatchViaBackend(fiscalRecordIds: ReadonlyArray<string>): Promise<{
  submission: FiscalSubmission;
  fiscalEvent: any;
  resultadosIndividuales?: any[];
  cantidadRegistros?: number;
  esBatch?: boolean;
  isTechnicalError?: boolean;
  idempotentReplay?: boolean;
}> {
  let authHeaders: Record<string, string> = {};
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch('/api/fiscal/submit/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({ fiscalRecordIds })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Error en la remisión por lote AEAT del backend (HTTP ${res.status})`);
  }

  return await res.json();
}

/**
 * Procesa y remite un lote de hasta 1.000 registros pendientes desde el Outbox del obligado tributario.
 */
export async function submitOutboxBatchViaBackend(params: {
  obligadoTributarioId: string;
  maxBatchSize?: number;
}): Promise<{
  submission?: FiscalSubmission;
  fiscalEvent?: any;
  resultadosIndividuales?: any[];
  cantidadRegistros?: number;
  esBatch?: boolean;
  emptyOutbox?: boolean;
  isTechnicalError?: boolean;
}> {
  let authHeaders: Record<string, string> = {};
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch('/api/fiscal/submit/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      batchFromOutbox: true,
      obligadoTributarioId: params.obligadoTributarioId,
      maxBatchSize: params.maxBatchSize
    })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Error en el procesado de lote Outbox AEAT (HTTP ${res.status})`);
  }

  return await res.json();
}
