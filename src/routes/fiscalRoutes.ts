/**
 * ENRUTADOR MODULAR FISCAL VERI*FACTU DE BACKEND (H5)
 *
 * Desacoplamiento de server.ts conforme a la arquitectura modular de la Fase 4.
 * Endpoints protegidos con requireFiscalAuthMiddleware y autoridad exclusiva en backend.
 */

import express from 'express';
import { Firestore } from '@google-cloud/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  requireFiscalAuthMiddleware,
  assertObligadoAuthorized,
  FiscalAuthenticatedRequest
} from '../fiscal/backendAuth';
import { BackendFiscalCustody } from '../fiscal/backendCustodyRepository';
import {
  emitFiscalInvoice,
  emitFiscalAnulacion
} from '../fiscal/emissionService';
import {
  executeAuthoritativeOutboxSubmission,
  collectEligibleOutboxRecordsForObligado,
  FiscalSubmissionHttpError
} from '../fiscal/outboxBatchProcessor';
import { resolveRecordOutboxState } from '../fiscal/submissionService';
import { createDefaultFiscalConfiguration } from '../fiscal/modelTransformers';
import { getSifIdentityConfig } from '../config/sifIdentity';
import { getAeatSoapEndpoint } from '../fiscal/aeatEndpoints';
import { AeatCertificateProvider } from '../fiscal/aeatCertificateProvider';
import { validateEmisorTenantCoherence } from '../fiscal/tenantEmisorService';
import { FiscalRecord, FiscalConfiguration } from '../fiscal/types';

export const fiscalRouter = express.Router();

export function getServerFiscalConfig(record: FiscalRecord): FiscalConfiguration {
  const isProdEnv = process.env.AEAT_ENV === 'production' || process.env.AEAT_ENVIRONMENT === 'production';
  const entornoAeat = isProdEnv ? 'produccion' : 'pruebas';
  const hasCert = AeatCertificateProvider.hasCertificate();
  const endpointUrl = getAeatSoapEndpoint(isProdEnv ? 'production' : 'test');
  const sifConfig = getSifIdentityConfig();

  return {
    obligadoTributarioId: record.obligadoTributarioId,
    nifEmisor: record.emisor.nif,
    nombreRazonEmisor: record.emisor.nombreRazon,
    modalidad: 'VERI_FACTU',
    entornoAeat,
    versionEspecificacion: '1.0',
    sistemaInformatico: {
      nombreRazon: sifConfig.nombreRazon,
      nif: sifConfig.nif,
      nombreSistemaInformatico: sifConfig.nombreSistemaInformatico,
      idSistemaInformatico: sifConfig.idSistemaInformatico,
      version: sifConfig.version,
      numeroInstalacion: sifConfig.numeroInstalacion,
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'N',
      indicadorMultiplesOT: 'N'
    },
    remisionAutomatica: true,
    reintentosMaximos: 3,
    minutosEntreReintentos: 5,
    transporte: {
      endpointUrl,
      timeoutMs: 30000,
      certificadoConfigurado: hasCert
    },
    certificadoConfigurado: hasCert,
    fechaActivacion: sifConfig.fechaActivacion
  };
}

// 1. Emisión de Factura Fiscal con autoridad exclusiva en backend
fiscalRouter.post("/api/fiscal/emit-invoice", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const { invoiceDraft, fiscalConfig, obligadoTributarioId, nifEmisor } = req.body;
    if (!invoiceDraft) {
      return res.status(400).json({ error: "Faltan datos obligatorios: invoiceDraft es requerido." });
    }

    const rawNif = (obligadoTributarioId || nifEmisor || fiscalConfig?.nifEmisor || fiscalConfig?.obligadoTributarioId || "").trim().toUpperCase();
    if (!rawNif || rawNif === 'ES_UNKNOWN' || rawNif === 'B12345678' || rawNif === 'B45123987') {
      return res.status(400).json({ error: "NIF de emisor obligatorio y válido requerido (prohibido vacío, CIFs de prueba como B12345678/B45123987 o ES_UNKNOWN)." });
    }

    let verifiedObligado = '';
    try {
      verifiedObligado = assertObligadoAuthorized(req.fiscalUser!, rawNif);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }

    const isRectificativaDraft = Boolean(
      invoiceDraft.esRectificativa ||
      ['R1', 'R2', 'R3', 'R4', 'R5'].includes(invoiceDraft.tipoFactura || '')
    );
    const isSubsanacionDraft = invoiceDraft.subsanacion === 'S';

    if ((!invoiceDraft.numeroFactura && (!isRectificativaDraft || isSubsanacionDraft)) || !invoiceDraft.fecha) {
      return res.status(400).json({ error: "numeroFactura y fecha de expedición son obligatorios." });
    }

    // A1: Separación SIF vs Emisor y validación de coherencia de razón social
    const clientNombreRazon = (req.body.nombreRazonEmisor || req.body.nombreRazon || invoiceDraft.emisorNombre || '').trim();
    const coherenceCheck = validateEmisorTenantCoherence({
      nif: verifiedObligado,
      clientNombreRazon,
      expectedNombreRazon: req.body.expectedNombreRazonEmisor || req.body.perfilEmisor?.nombreRazon
    });

    if (!coherenceCheck.valid) {
      return res.status(400).json({ error: coherenceCheck.error });
    }

    const serverFiscalConfig = createDefaultFiscalConfiguration({
      nif: verifiedObligado,
      nombreRazon: coherenceCheck.resolvedNombreRazon
    });

    const authoritativeInvoiceDraft =
      isRectificativaDraft && !isSubsanacionDraft
        ? {
            ...invoiceDraft,
            numeroFactura: 'AUTO',
            numeracionAutoritativaBackend: true
          }
        : invoiceDraft;

    const rawOperationKey =
      (typeof req.body.operationKey === 'string' && req.body.operationKey.trim()) ||
      (typeof req.headers['x-idempotency-key'] === 'string' && req.headers['x-idempotency-key'].trim()) ||
      (typeof invoiceDraft.idempotencyKey === 'string' && invoiceDraft.idempotencyKey.trim()) ||
      undefined;

    const result = await emitFiscalInvoice({
      invoiceDraft: authoritativeInvoiceDraft,
      fiscalConfig: serverFiscalConfig,
      operationKey: rawOperationKey,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    return res.json({
      success: true,
      invoice: result.invoice,
      fiscalRecord: result.fiscalRecord,
      fiscalRecordRef: result.fiscalRecordRef,
      assignedNumeroFactura: result.fiscalRecord.factura.numeroFactura
    });
  } catch (err: any) {
    console.error("Error en emisión fiscal backend:", err);
    const isCloudCustodyError =
      err.message?.includes('CloudDistributedChainCoordinator') ||
      err.message?.includes('Firestore') ||
      err.message?.includes('custodia');
    if (isCloudCustodyError || (process.env.NODE_ENV === 'production' && !err.statusCode)) {
      return res.status(503).json({
        error: "Custodia Cloud Run Fail-Closed: Error persistiendo en Firestore. Emisión abortada.",
        details: err.message,
        code: "FIRESTORE_CUSTODY_UNAVAILABLE"
      });
    }
    return res.status(err.statusCode || 500).json({ error: err.message || "Error al emitir factura fiscal en backend" });
  }
});

// 2. Emisión de Anulación Fiscal con autoridad exclusiva en backend
fiscalRouter.post("/api/fiscal/emit-anulacion", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const { facturaAnulada, fiscalConfig, obligadoTributarioId, nifEmisor } = req.body;
    if (!facturaAnulada) {
      return res.status(400).json({ error: "Faltan datos obligatorios: facturaAnulada es requerida." });
    }

    const rawObligado = (obligadoTributarioId || nifEmisor || fiscalConfig?.obligadoTributarioId || fiscalConfig?.nifEmisor || "").trim().toUpperCase();
    if (!rawObligado || rawObligado === 'ES_UNKNOWN' || rawObligado === 'B12345678' || rawObligado === 'B45123987') {
      return res.status(400).json({ error: "obligadoTributarioId obligatorio y no puede ser ES_UNKNOWN ni CIF ficticio." });
    }

    let verifiedObligado = '';
    try {
      verifiedObligado = assertObligadoAuthorized(req.fiscalUser!, rawObligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }

    const serverFiscalConfig = createDefaultFiscalConfiguration({
      nif: verifiedObligado,
      nombreRazon: (req.body.nombreRazon || 'Gestión Avícola AgroTech Software S.L.').trim()
    });

    const result = await emitFiscalAnulacion({
      facturaAnulada,
      fiscalConfig: serverFiscalConfig,
      obligadoTributarioId: verifiedObligado,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    return res.json({
      success: true,
      fiscalRecord: result.fiscalRecord,
      fiscalRecordRef: result.fiscalRecordRef
    });
  } catch (err: any) {
    console.error("Error en anulación fiscal backend:", err);
    return res.status(500).json({ error: err.message || "Error al anular factura fiscal en backend" });
  }
});

// 3. Consulta de registros en custodia de backend
fiscalRouter.get("/api/fiscal/records", requireFiscalAuthMiddleware, (req: FiscalAuthenticatedRequest, res) => {
  const obligado = typeof req.query.obligado === 'string' ? req.query.obligado : undefined;
  if (obligado) {
    try {
      assertObligadoAuthorized(req.fiscalUser!, obligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }
  } else if (!req.fiscalUser!.isOwner) {
    return res.status(403).json({ error: "Debe especificar un parámetro 'obligado' autorizado." });
  }
  const records = BackendFiscalCustody.getAllFiscalRecords(obligado);
  res.json({ records, count: records.length });
});

fiscalRouter.get("/api/fiscal/records/:id", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  const record = await BackendFiscalCustody.getFiscalRecordByIdAsync(req.params.id);
  if (!record) {
    return res.status(404).json({ error: `FiscalRecord '${req.params.id}' no encontrado en custodia de backend.` });
  }
  try {
    assertObligadoAuthorized(req.fiscalUser!, record.obligadoTributarioId);
  } catch (authErr: any) {
    return res.status(authErr.statusCode || 403).json({ error: authErr.message });
  }
  res.json(record);
});

// 4. Estado de certificado (exclusivamente información pública sin secretos - Protegido M1)
fiscalRouter.get("/api/fiscal/cert-status", requireFiscalAuthMiddleware, (req: FiscalAuthenticatedRequest, res) => {
  res.json({
    available: AeatCertificateProvider.hasCertificate(),
    environment: process.env.AEAT_ENV || process.env.AEAT_ENVIRONMENT || 'test',
    transportMode: process.env.AEAT_TRANSPORT_MODE || (AeatCertificateProvider.hasCertificate() ? 'real' : 'mock')
  });
});

// 5. Remisión a AEAT (unitaria 1 registro o por lote 1..1000 registros + Outbox)
const handleAuthoritativeFiscalSubmit = async (req: FiscalAuthenticatedRequest, res: express.Response) => {
  try {
    const {
      fiscalRecordId,
      fiscalRecordIds,
      batchFromOutbox,
      obligadoTributarioId,
      maxBatchSize
    } = req.body || {};

    const result = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId,
      fiscalRecordIds,
      batchFromOutbox: Boolean(batchFromOutbox),
      obligadoTributarioId,
      maxBatchSize: maxBatchSize !== undefined ? Number(maxBatchSize) : undefined,
      actor: {
        tipo: 'USER',
        id: req.fiscalUser?.uid,
        email: req.fiscalUser?.email,
        nombre: req.fiscalUser?.email || 'AuthenticatedOperator'
      },
      authorizeObligadoFn: (obligadoId: string) => {
        assertObligadoAuthorized(req.fiscalUser!, obligadoId);
      }
    });

    return res.json(result);
  } catch (err: any) {
    if (err instanceof FiscalSubmissionHttpError) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        ...(err.details || {})
      });
    }
    if (err?.statusCode === 403 || err?.statusCode === 401) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Error en remisión AEAT backend:", err.message);
    const statusCode = err?.statusCode === 409 || err?.code === 'CONCURRENT_SEND_LOCKED' ? 409 : 500;
    return res.status(statusCode).json({
      error: statusCode === 409 ? "Conflicto de concurrencia en remisión AEAT" : "Error en el transporte AEAT",
      message: err.message
    });
  }
};

fiscalRouter.post("/api/fiscal/submit", requireFiscalAuthMiddleware, handleAuthoritativeFiscalSubmit);
fiscalRouter.post("/api/fiscal/submit/batch", requireFiscalAuthMiddleware, handleAuthoritativeFiscalSubmit);

// 6. Consulta autoritativa del estado Outbox y cola de registros pendientes por obligado
fiscalRouter.get("/api/fiscal/outbox/pending", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const obligado = typeof req.query.obligado === 'string' ? req.query.obligado.trim() : '';
    if (!obligado) {
      return res.status(400).json({ error: "Parámetro 'obligado' obligatorio." });
    }
    try {
      assertObligadoAuthorized(req.fiscalUser!, obligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }

    const { eligibleRecords, totalPendingCount, batches, statesByRecordId } = await collectEligibleOutboxRecordsForObligado(obligado);
    const allRecords = await BackendFiscalCustody.getAllFiscalRecordsByObligadoAsync(obligado);
    const summaryByRecord = allRecords.map(r => {
      const st = statesByRecordId.get(r.id) || resolveRecordOutboxState(r.id, BackendFiscalCustody.getFiscalSubmissions(r.id));
      return {
        fiscalRecordId: r.id,
        numeroFactura: r.factura.numeroFactura,
        tipoRegistro: r.tipoRegistro,
        status: st.status,
        isAccepted: st.isAccepted,
        isRejected: st.isRejected,
        isSending: st.isSending,
        isOrphanedSending: Boolean(st.isOrphanedSending),
        resultadoAeatDesconocido: Boolean(st.resultadoAeatDesconocido),
        isPendingOrRetryable: st.isPendingOrRetryable,
        totalAttempts: st.totalAttempts,
        csv: st.latestRecordResult?.csv || st.acceptedSubmission?.csv,
        codigoError: st.latestRecordResult?.codigoErrorRegistro
      };
    });

    return res.json({
      obligadoTributarioId: obligado,
      pendingCount: totalPendingCount,
      batchesCount: batches.length,
      pendingRecordIds: eligibleRecords.map(r => r.id),
      recordsSummary: summaryByRecord
    });
  } catch (err: any) {
    return res.status(err?.statusCode || 500).json({ error: err.message });
  }
});

// 7. Previsualización de correlativo rectificativo en solo lectura
fiscalRouter.get("/api/fiscal/rectificativas/next-number", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const obligado = typeof req.query.obligado === 'string'
      ? req.query.obligado.trim().toUpperCase()
      : (typeof req.query.obligadoTributarioId === 'string' ? req.query.obligadoTributarioId.trim().toUpperCase() : '');
    const fecha = typeof req.query.fecha === 'string' ? req.query.fecha.trim() : undefined;
    if (!obligado) {
      return res.status(400).json({ error: "Parámetro 'obligado' obligatorio." });
    }
    try {
      assertObligadoAuthorized(req.fiscalUser!, obligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }
    const nextNumber = await BackendFiscalCustody.previewNextRectificativaNumeroAsync(obligado, fecha);
    return res.status(200).json({
      obligadoTributarioId: obligado,
      nextNumber,
      provisional: true,
      isProvisional: true,
      message: "Numeración provisional de previsualización (sin reserva). La numeración definitiva se asigna atómicamente durante la emisión en backend.",
      authority: "BACKEND_CUSTODY_PREVIEW"
    });
  } catch (err: any) {
    return res.status(err?.statusCode || 500).json({ error: err.message });
  }
});

// Control de concurrencia y limitación de frecuencia para el endpoint de diagnóstico IAM
let isIamDiagnosticActive = false;
let lastIamDiagnosticTimestamp = 0;
const IAM_DIAGNOSTIC_COOLDOWN_MS = 5000;

fiscalRouter.get("/api/fiscal/diagnostics/iam", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  if (!req.fiscalUser?.isOwner) {
    return res.status(403).json({
      success: false,
      status: "IAM_DIAGNOSTIC_FORBIDDEN",
      error: "Acceso denegado: El diagnóstico de permisos IAM y sondeo de infraestructura en Cloud Firestore está reservado exclusivamente a operadores con rol de Propietario o Administrador Fiscal."
    });
  }

  if (isIamDiagnosticActive) {
    return res.status(429).json({
      success: false,
      status: "IAM_DIAGNOSTIC_CONCURRENT",
      error: "Diagnóstico IAM actualmente en ejecución. Por favor espere a que finalice la prueba en curso."
    });
  }

  const now = Date.now();
  const elapsed = now - lastIamDiagnosticTimestamp;
  if (elapsed < IAM_DIAGNOSTIC_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((IAM_DIAGNOSTIC_COOLDOWN_MS - elapsed) / 1000);
    return res.status(429).json({
      success: false,
      status: "IAM_DIAGNOSTIC_RATE_LIMITED",
      error: `Límite de frecuencia excedido: el diagnóstico IAM solo puede ejecutarse una vez cada ${IAM_DIAGNOSTIC_COOLDOWN_MS / 1000} segundos para prevenir costes y saturación de cuota. Reintente en ${waitSeconds}s.`
    });
  }

  isIamDiagnosticActive = true;
  lastIamDiagnosticTimestamp = Date.now();

  const config = firebaseConfig as any;
  const permissions: Record<string, boolean> = {
    create: false,
    read: false,
    update: false,
    delete: false
  };

  let probeDocRef: any = null;
  let probeCreated = false;

  try {
    const firestore = new Firestore({
      projectId: config?.projectId,
      databaseId: config?.firestoreDatabaseId
    });

    const probeId = `probe_iam_diagnostic_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    probeDocRef = firestore.collection("fiscal_diagnostic_probes").doc(probeId);

    const testPayload = {
      probeId,
      createdAt: new Date().toISOString(),
      initiatedBy: req.fiscalUser.email,
      environment: process.env.NODE_ENV || "development",
      purpose: "IAM Permissions Probe (roles/datastore.user)"
    };

    await probeDocRef.set(testPayload);
    permissions.create = true;
    probeCreated = true;

    const readSnap = await probeDocRef.get();
    if (readSnap.exists && readSnap.data()?.probeId === probeId) {
      permissions.read = true;
    }

    await probeDocRef.update({
      updatedAt: new Date().toISOString(),
      status: "validated"
    });
    permissions.update = true;

    await probeDocRef.delete();
    permissions.delete = true;
    probeDocRef = null;

    return res.json({
      success: true,
      status: "IAM_PERMISSIONS_OK",
      serviceAccountConfigured: true,
      projectId: config?.projectId,
      databaseId: config?.firestoreDatabaseId,
      permissions,
      message: "Comprobación de permisos IAM completada con éxito. La cuenta de servicio de Cloud Run dispone del rol roles/datastore.user con acceso completo de lectura y escritura a Cloud Firestore."
    });
  } catch (err: any) {
    console.error("[IAM DIAGNOSTIC] Error durante la comprobación de permisos:", err);
    return res.status(500).json({
      success: false,
      status: "IAM_PERMISSIONS_ERROR",
      serviceAccountConfigured: false,
      error: err?.message || "Error al verificar permisos IAM en Cloud Firestore",
      code: err?.code,
      projectId: config?.projectId,
      databaseId: config?.firestoreDatabaseId,
      permissions,
      message: "Fallo de permisos o conectividad con Cloud Firestore. Verifique la vinculación de roles/datastore.user a la cuenta de servicio de Cloud Run."
    });
  } finally {
    if (probeCreated && probeDocRef) {
      try {
        await probeDocRef.delete();
      } catch (cleanupErr: any) {
        console.error(`[IAM DIAGNOSTIC] Error al limpiar documento de sondeo residual ${probeDocRef.id}:`, cleanupErr?.message);
      }
    }
    isIamDiagnosticActive = false;
  }
});
