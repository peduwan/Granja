/**
 * SERVICIO DE TRANSPORTE Y REMISIÓN WEB SERVICE AEAT VERI*FACTU (FASE 3.1)
 *
 * Normativa Oficial:
 * - Ley 11/2021 de medidas contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024 (BOE 28/10/2024)
 * - Especificación Técnica de Servicios Web AEAT - SuministroLR / RespuestaSuministro v1.0
 *
 * RESPONSABILIDAD ÚNICA:
 * Capa pura de comunicación y transporte HTTP/SOAP con los servicios web de la AEAT.
 *
 * PRINCIPIOS ABSOLUTOS:
 * 1. Pureza del FiscalRecord: El FiscalRecord ya sellado es ESTRICTAMENTE INMUTABLE.
 *    Ningún estado HTTP, timeout, rechazo o aceptación altera huella, encadenamiento,
 *    timestamp ni XML del registro fiscal.
 * 2. Integridad del XML: Se envía exclusivamente el XML oficial ya sellado en FiscalRecord.
 * 3. Desacoplamiento Outbox: El ciclo de vida pertenece a FiscalSubmission y FiscalEvent.
 * 4. Clasificación estricta: Se diferencian inequívocamente errores técnicos (FAILED_TECHNICAL)
 *    de rechazos funcionales tributarios de la AEAT (REJECTED).
 * 5. Seguridad: Ninguna clave privada o certificado se procesa en el cliente/frontend.
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {
  FiscalRecord,
  FiscalSubmission,
  FiscalConfiguration,
  FiscalEvent,
  FiscalActor
} from './types';
import { transitionSubmissionStatus, createFiscalSubmission } from './submissionService';
import { parseAeatXmlResponse, AeatParsedResponse } from './aeatResponseParser';
import { MockAeatTransport, MockScenario } from './mockAeatTransport';
import { AeatCertificateProvider } from './aeatCertificateProvider';
import { validateAeatXmlAgainstXsd } from './aeatXsdValidatorNode';
import {
  AEAT_OFFICIAL_ENDPOINTS,
  getAeatSoapEndpoint,
  getAeatQrEndpoint,
  normalizeAeatEnvironment,
  type AeatEnvironment,
  type AeatCertificateType
} from './aeatEndpoints';

export {
  AEAT_OFFICIAL_ENDPOINTS,
  getAeatSoapEndpoint,
  getAeatQrEndpoint,
  normalizeAeatEnvironment,
  type AeatEnvironment,
  type AeatCertificateType
};

export const AEAT_SOAP_ENDPOINTS = {
  production: AEAT_OFFICIAL_ENDPOINTS.soap.production.standard,
  testing: AEAT_OFFICIAL_ENDPOINTS.soap.test.standard
} as const;

/**
 * ============================================================================
 * CONTROL DE FLUJO OFICIAL AEAT (TIEMPO DE ESPERA ENTRE ENVÍOS)
 * ============================================================================
 * Conforme a la documentación técnica oficial de la AEAT (v1.0.3 / SuministroLR),
 * la AEAT devuelve en la cabecera de cada respuesta el elemento <TiempoEsperaEnvio> (en segundos).
 * Este valor representa la ventana de control de flujo dinámico que el emisor DEBE
 * respetar antes de realizar el siguiente envío ordinario a los servicios web de la AEAT.
 * El valor por defecto inicial del servicio es de 60 segundos, y la AEAT puede aumentarlo
 * dinámicamente (por ejemplo a 120, 300, etc.) para regular la tasa de peticiones.
 */
export const DEFAULT_AEAT_TIEMPO_ESPERA_SEGUNDOS = 60;
export const MAX_AEAT_RECORDS_PER_SUBMISSION = 1000;

export interface FlowControlState {
  readonly tiempoEsperaEnvioSegundos: number;
  readonly lastResponseTimestamp: number;
  readonly nextAllowedSendTimestamp: number;
}

const FLOW_CONTROL_FILE = path.resolve(process.cwd(), 'data', 'aeat_flow_control.json');

export class AeatFlowControlManager {
  private static flowStateByObligado: Map<string, FlowControlState> = new Map();
  private static activeLocks: Set<string> = new Set();
  private static diskInitialized = false;

  private static initFromDisk(): void {
    if (this.diskInitialized || typeof window !== 'undefined') return;
    try {
      if (fs.existsSync(FLOW_CONTROL_FILE)) {
        const raw = fs.readFileSync(FLOW_CONTROL_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.flowStateByObligado.set(k, v as FlowControlState);
        }
      }
    } catch {}
    this.diskInitialized = true;
  }

  private static persistToDisk(): void {
    if (typeof window !== 'undefined') return;
    try {
      const dataDir = path.dirname(FLOW_CONTROL_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const obj: Record<string, FlowControlState> = {};
      for (const [k, v] of this.flowStateByObligado.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(FLOW_CONTROL_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {}
  }

  /**
   * Actualiza el control de flujo oficial a partir del <TiempoEsperaEnvio> devuelto por la AEAT.
   */
  public static updateFromResponse(
    obligadoTributarioId: string,
    tiempoEsperaSegundos?: number,
    responseTimestampMs?: number
  ): FlowControlState {
    this.initFromDisk();
    const timestamp = responseTimestampMs ?? Date.now();
    const waitSeconds = typeof tiempoEsperaSegundos === 'number' && !isNaN(tiempoEsperaSegundos)
      ? Math.max(0, tiempoEsperaSegundos)
      : (this.flowStateByObligado.get(obligadoTributarioId)?.tiempoEsperaEnvioSegundos ?? DEFAULT_AEAT_TIEMPO_ESPERA_SEGUNDOS);

    const nextAllowed = timestamp + waitSeconds * 1000;
    const state: FlowControlState = {
      tiempoEsperaEnvioSegundos: waitSeconds,
      lastResponseTimestamp: timestamp,
      nextAllowedSendTimestamp: nextAllowed
    };

    this.flowStateByObligado.set(obligadoTributarioId, state);
    this.persistToDisk();
    return state;
  }

  /**
   * Obtiene los segundos de espera oficiales vigentes según la última respuesta de la AEAT.
   */
  public static getCurrentFlowWaitSeconds(obligadoTributarioId: string): number {
    this.initFromDisk();
    return this.flowStateByObligado.get(obligadoTributarioId)?.tiempoEsperaEnvioSegundos ?? DEFAULT_AEAT_TIEMPO_ESPERA_SEGUNDOS;
  }

  /**
   * Obtiene el timestamp en milisegundos más temprano en que la AEAT autoriza el próximo envío por tiempo.
   */
  public static getNextAllowedSendTimestamp(obligadoTributarioId: string): number {
    this.initFromDisk();
    return this.flowStateByObligado.get(obligadoTributarioId)?.nextAllowedSendTimestamp ?? 0;
  }

  /**
   * Obtiene el estado completo de control de flujo para un obligado tributario.
   */
  public static getFlowState(obligadoTributarioId: string): FlowControlState | undefined {
    this.initFromDisk();
    return this.flowStateByObligado.get(obligadoTributarioId);
  }

  /**
   * REGLA DISYUNTIVA OFICIAL AEAT (Apartado 6.4.4.1 de la documentación técnica v1.0.3):
   *
   * El siguiente envío puede realizarse cuando:
   * A) hayan transcurrido los segundos indicados por TiempoEsperaEnvio desde el envío anterior;
   * O
   * B) se haya acumulado el número máximo de registros permitido por envío (1.000 registros),
   * lo que ocurra primero.
   *
   * @param obligadoTributarioId Identificador único del obligado tributario (NIF)
   * @param currentTimestampMs Momento de evaluación (por defecto Date.now())
   * @param pendingRecordsCount Número de registros pendientes en cola de remisión
   */
  public static isSendAllowed(
    obligadoTributarioId: string,
    currentTimestampMs?: number,
    pendingRecordsCount?: number
  ): boolean {
    // Condición B: Capacidad máxima del lote alcanzada (>= 1.000 registros)
    // Permite el envío inmediato sin esperar la expiración de TiempoEsperaEnvio.
    if (typeof pendingRecordsCount === 'number' && pendingRecordsCount >= MAX_AEAT_RECORDS_PER_SUBMISSION) {
      return true;
    }

    // Condición A: Expiración del temporizador de espera desde la última respuesta
    const now = currentTimestampMs ?? Date.now();
    const nextAllowed = this.getNextAllowedSendTimestamp(obligadoTributarioId);
    return now >= nextAllowed;
  }

  /**
   * CERROJO DE ENVÍO EN VUELO (Exclusión mutua por obligadoTributarioId)
   *
   * Impide que dos ejecuciones concurrentes del mismo obligado tributario
   * realicen simultáneamente dos envíos SOAP, garantizando control de flujo
   * y evitando colisiones en el outbox.
   */
  public static acquireSendLock(obligadoTributarioId: string): boolean {
    if (!obligadoTributarioId) return false;
    if (this.activeLocks.has(obligadoTributarioId)) {
      return false;
    }
    this.activeLocks.add(obligadoTributarioId);
    return true;
  }

  /**
   * Libera el cerrojo de envío en vuelo para el obligado tributario especificado.
   * Se debe invocar SIEMPRE dentro de un bloque finally.
   */
  public static releaseSendLock(obligadoTributarioId: string): void {
    if (!obligadoTributarioId) return;
    this.activeLocks.delete(obligadoTributarioId);
  }

  /**
   * Comprueba si el obligado tributario tiene un envío en vuelo bloqueado.
   */
  public static isSendLocked(obligadoTributarioId: string): boolean {
    return this.activeLocks.has(obligadoTributarioId);
  }

  /**
   * Limpia el almacén de control de flujo y cerrojos activos (útil para pruebas).
   */
  public static reset(): void {
    this.flowStateByObligado.clear();
    this.activeLocks.clear();
    this.diskInitialized = true;
    try {
      if (fs.existsSync(FLOW_CONTROL_FILE)) {
        fs.unlinkSync(FLOW_CONTROL_FILE);
      }
    } catch {}
  }
}

/**
 * ============================================================================
 * POLÍTICA INTERNA DE REINTENTOS TÉCNICOS (ARQUITECTURA DE LA APLICACIÓN)
 * ============================================================================
 * ATENCIÓN: Las siguientes constantes y funciones corresponden a la política
 * INTERNA de diseño y resiliencia del software para recuperar errores técnicos de red
 * o caídas de servidor (SOAP Fault Server).
 * NO constituyen un requisito normativo de la AEAT ni deben presentarse como
 * "backoff oficial".
 */
export const INTERNAL_MAX_RETRY_ATTEMPTS = 3;
export const MAX_RETRY_ATTEMPTS = INTERNAL_MAX_RETRY_ATTEMPTS; // Alias de retrocompatibilidad

export const DEFAULT_INTERNAL_RETRY_DELAYS_SECONDS = [60, 180, 600] as const;
export const DEFAULT_RETRY_DELAYS_SECONDS = DEFAULT_INTERNAL_RETRY_DELAYS_SECONDS; // Alias de retrocompatibilidad

export function getInternalRetryDelaySeconds(attemptNumber: number): number {
  if (attemptNumber <= 1) return DEFAULT_INTERNAL_RETRY_DELAYS_SECONDS[0];
  if (attemptNumber === 2) return DEFAULT_INTERNAL_RETRY_DELAYS_SECONDS[1];
  return DEFAULT_INTERNAL_RETRY_DELAYS_SECONDS[2];
}
export const getRetryDelaySeconds = getInternalRetryDelaySeconds; // Alias

export interface AeatTransportOptions {
  readonly transportMode?: 'mock' | 'real';
  readonly mockScenario?: MockScenario;
  readonly mockTiempoEsperaEnvio?: number;
  readonly actor?: FiscalActor;
  readonly timeoutMs?: number;
  readonly endpointOverride?: string;
  readonly httpHeaders?: Record<string, string>;
  readonly customFetch?: (url: string, init: any) => Promise<any>;
  readonly acquireLock?: boolean;
}

/**
 * Ejecuta una operación de remisión SOAP protegida con cerrojo de exclusión mutua
 * por obligadoTributarioId. Garantiza que el cerrojo se libere SIEMPRE en un bloque finally.
 */
export async function executeWithAeatLock<T>(
  obligadoTributarioId: string,
  operation: () => Promise<T>
): Promise<{ executed: true; result: T } | { executed: false; reason: string }> {
  if (!AeatFlowControlManager.acquireSendLock(obligadoTributarioId)) {
    return { executed: false, reason: 'CONCURRENT_SEND_LOCKED' };
  }
  try {
    const result = await operation();
    return { executed: true, result };
  } finally {
    AeatFlowControlManager.releaseSendLock(obligadoTributarioId);
  }
}

export interface AeatTransportResult {
  readonly submission: FiscalSubmission;
  readonly fiscalEvent: FiscalEvent;
  readonly isTechnicalError: boolean;
  readonly parsedResponse?: AeatParsedResponse;
  readonly httpStatus?: number;
  readonly errorDetails?: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Envuelve el XML oficial de facturación (sfLR:RegFactuSistemaFacturacion)
 * dentro del SOAP Envelope oficial de transporte conforme a WSDL Document/Literal.
 */
export function wrapInAeatSoapEnvelope(officialXml: string): string {
  if (!officialXml || typeof officialXml !== 'string' || officialXml.trim() === '') {
    throw new Error('wrapInAeatSoapEnvelope: Se requiere un XML oficial no vacío para enviar a AEAT.');
  }

  // Si ya es un sobre SOAP completo, retornar tal cual
  if (officialXml.includes('<soapenv:Envelope') || officialXml.includes('<SOAP-ENV:Envelope')) {
    return officialXml;
  }

  // Limpiar declaración XML si ya existiese dentro del fragmento para evitar XML inválido
  const cleanBodyXml = officialXml.replace(/^<\?xml[^>]*\?>\s*/i, '').trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>
    ${cleanBodyXml}
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Crea un objeto inmutable de FiscalEvent para registrar el intento de auditoría.
 */
function createTransportFiscalEvent(params: {
  obligadoTributarioId: string;
  tipo: any;
  fiscalRecordId: string;
  numeroFactura: string;
  actor: FiscalActor;
  descripcion: string;
  datos?: Record<string, any>;
}): FiscalEvent {
  const event: FiscalEvent = {
    id: `fevt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    obligadoTributarioId: params.obligadoTributarioId,
    tipo: params.tipo,
    fechaHora: new Date().toISOString(),
    actor: params.actor,
    fiscalRecordId: params.fiscalRecordId,
    numeroFactura: params.numeroFactura,
    descripcion: params.descripcion,
    datos: params.datos
  };
  return Object.freeze(event);
}

/**
 * Ejecuta la remisión oficial a los servicios web de la AEAT manteniendo intacto el FiscalRecord.
 *
 * Ciclo de vida estricto:
 * PENDING -> SENDING -> (ACCEPTED | ACCEPTED_WITH_ERRORS | REJECTED | FAILED_TECHNICAL)
 */
export async function executeAeatSubmission(params: {
  submission: FiscalSubmission;
  fiscalRecord: FiscalRecord;
  config: FiscalConfiguration;
  options?: AeatTransportOptions;
}): Promise<AeatTransportResult> {
  const { submission, fiscalRecord, config, options } = params;

  // 1. Verificación previa de inmutabilidad e integridad
  if (!fiscalRecord || typeof fiscalRecord !== 'object') {
    throw new Error('executeAeatSubmission: Se requiere un FiscalRecord válido.');
  }
  if (!submission || typeof submission !== 'object') {
    throw new Error('executeAeatSubmission: Se requiere una FiscalSubmission válida.');
  }
  if (fiscalRecord.id !== submission.fiscalRecordId) {
    throw new Error(`executeAeatSubmission: Incoherencia crítica. La submission (${submission.fiscalRecordId}) no coincide con el FiscalRecord (${fiscalRecord.id}).`);
  }

  // Validación temprana de seguridad de destino: prohibido desviar tráfico hacia hosts ajenos a AEAT
  if (options?.endpointOverride) {
    const override = options.endpointOverride.trim();
    const allowedPrefixes = [
      'https://www1.agenciatributaria.gob.es',
      'https://www10.agenciatributaria.gob.es',
      'https://prewww1.aeat.es',
      'https://prewww10.aeat.es',
      'mock://'
    ];
    const isAllowed = allowedPrefixes.some(prefix => override.startsWith(prefix));
    if (!isAllowed) {
      throw new Error(`executeAeatSubmission: endpointOverride ('${override}') no autorizado. Solo se permiten destinos oficiales de la Agencia Tributaria. Prohibido desviar tráfico o credenciales mTLS a hosts de terceros.`);
    }
  }

  // Comprobación de XML oficial: no enviar sin XML oficial sellado
  const xmlParaEnvio = submission.xmlEnviado || fiscalRecord.xmlOficial;
  if (!xmlParaEnvio || xmlParaEnvio === '<pending_xml/>' || xmlParaEnvio.trim() === '') {
    throw new Error('executeAeatSubmission: No se permite enviar un registro sin XML oficial sellado.');
  }

  // Validación reglamentaria XSD previa al envío a AEAT (Fase 3.1.4)
  const xsdReport = validateAeatXmlAgainstXsd(xmlParaEnvio);
  if (!xsdReport.valid) {
    createTransportFiscalEvent({
      obligadoTributarioId: fiscalRecord.obligadoTributarioId,
      tipo: 'ENVIO_AEAT_ERROR_TECNICO',
      fiscalRecordId: fiscalRecord.id,
      numeroFactura: fiscalRecord.factura.numeroFactura,
      actor: options?.actor || { tipo: 'SYSTEM', nombre: 'AeatTransportService' },
      descripcion: `Validación formal XSD previa al envío fallida: ${xsdReport.errors.join('; ')}`,
      datos: { errors: xsdReport.errors }
    });
    throw new Error(`executeAeatSubmission: Validación formal XSD fallida previa al envío a AEAT: ${xsdReport.errors.join('; ')}`);
  }

  // Comprobación previa de modo de transporte y credenciales mTLS (prohibido fallback silencioso)
  const configuredMode = options?.transportMode || process.env.AEAT_TRANSPORT_MODE;
  if (configuredMode === 'real' && !AeatCertificateProvider.hasCertificate()) {
    throw new Error('executeAeatSubmission: Modo real de transporte AEAT requerido (AEAT_TRANSPORT_MODE=real), pero no se han configurado credenciales de certificado mTLS válidas en el servidor. Fallback a mock estrictamente prohibido.');
  }

  const explicitMockInOptions = options?.transportMode === 'mock';
  if (config.entornoAeat === 'produccion' && !AeatCertificateProvider.hasCertificate() && !explicitMockInOptions) {
    throw new Error('executeAeatSubmission: En entorno de producción AEAT es estrictamente obligatorio disponer de certificado mTLS válido. Fallback a mock PROHIBIDO.');
  }

  const actor: FiscalActor = options?.actor || { tipo: 'SYSTEM', nombre: 'AeatTransportService' };
  const startTime = Date.now();

  const shouldManageLock = options?.acquireLock !== false;
  if (shouldManageLock) {
    const lockAcquired = AeatFlowControlManager.acquireSendLock(fiscalRecord.obligadoTributarioId);
    if (!lockAcquired) {
      throw new Error(`executeAeatSubmission: Envío concurrente bloqueado para el obligado tributario ${fiscalRecord.obligadoTributarioId}. Ya existe un envío en vuelo.`);
    }
  }

  try {
    // 2. Transición a estado SENDING y emisión de evento de auditoría
    const sendingSubmission = transitionSubmissionStatus(submission, 'SENDING');
    createTransportFiscalEvent({
      obligadoTributarioId: fiscalRecord.obligadoTributarioId,
      tipo: 'ENVIO_AEAT_INICIADO',
      fiscalRecordId: fiscalRecord.id,
      numeroFactura: fiscalRecord.factura.numeroFactura,
      actor,
      descripcion: `Inicio de remisión intento #${submission.numeroIntento} a la sede electrónica de la AEAT`,
      datos: {
        submissionId: submission.id,
        numeroIntento: submission.numeroIntento,
        endpoint: submission.endpoint
      }
    });

    const soapPayload = wrapInAeatSoapEnvelope(xmlParaEnvio);

    // Determinar modo de transporte (Mock vs Real) con prohibición estricta de fallback silencioso
    let isMock = false;
    const configuredMode = options?.transportMode || process.env.AEAT_TRANSPORT_MODE;

    if (configuredMode === 'real') {
      // Modo real requerido expresamente: PROHIBIDO cualquier fallback silencioso a mock
      if (!AeatCertificateProvider.hasCertificate()) {
        throw new Error('executeAeatSubmission: Modo real de transporte AEAT requerido (AEAT_TRANSPORT_MODE=real), pero no se han configurado credenciales de certificado mTLS válidas en el servidor. Fallback a mock estrictamente prohibido.');
      }
      isMock = false;
    } else if (configuredMode === 'mock') {
      isMock = true;
    } else {
      // Sin modo explícito: si hay credenciales configuradas usar real; de lo contrario mock
      isMock = !AeatCertificateProvider.hasCertificate();
    }

    try {
      let httpStatus = 200;
      let responseText = '';

      if (isMock) {
        // Ejecución mediante Mock oficial de transporte
        const mockResult = await MockAeatTransport.execute(options?.mockScenario, {
          nifEmisor: fiscalRecord.emisor.nif,
          numSerie: fiscalRecord.factura.numeroFactura,
          fechaExpedicion: fiscalRecord.factura.fechaExpedicion,
          tiempoEsperaEnvio: options?.mockTiempoEsperaEnvio
        });
        httpStatus = mockResult.status;
        responseText = mockResult.text;
      } else {
        // Transporte real HTTP/mTLS
        let endpoint = submission.endpoint || (
          config.entornoAeat === 'produccion' ? AEAT_SOAP_ENDPOINTS.production : AEAT_SOAP_ENDPOINTS.testing
        );

        if (options?.endpointOverride) {
          const override = options.endpointOverride.trim();
          const allowedPrefixes = [
            'https://www1.agenciatributaria.gob.es',
            'https://www10.agenciatributaria.gob.es',
            'https://prewww1.aeat.es',
            'https://prewww10.aeat.es',
            'mock://'
          ];
          const isAllowed = allowedPrefixes.some(prefix => override.startsWith(prefix));
          if (!isAllowed) {
            throw new Error(`executeAeatSubmission: endpointOverride ('${override}') no autorizado. Solo se permiten destinos oficiales de la Agencia Tributaria. Prohibido desviar tráfico o credenciales mTLS a hosts de terceros.`);
          }
          endpoint = override;
        }

        const certCreds = AeatCertificateProvider.getCredentials();
        const customFetch = options?.customFetch;

        if (customFetch) {
          const res = await customFetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'SOAPAction': '""',
              ...(options?.httpHeaders || {})
            },
            body: soapPayload
          });
          httpStatus = res.status;
          responseText = await res.text();
        } else {
          // En entorno Node.js, utilizar agente HTTPS mTLS nativo con las credenciales
          if (!certCreds) {
            throw new Error('executeAeatSubmission: No se dispone de credenciales de certificado mTLS para la conexión real con AEAT.');
          }

          const httpsAgent = certCreds.pfx
            ? new https.Agent({ pfx: certCreds.pfx, passphrase: certCreds.passphrase, rejectUnauthorized: true })
            : new https.Agent({ cert: certCreds.cert, key: certCreds.key, rejectUnauthorized: true });

          const timeoutMs = options?.timeoutMs || 30000;
          const urlObj = new URL(endpoint);

          const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
            const req = https.request(urlObj, {
              method: 'POST',
              agent: httpsAgent,
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '""',
                'Content-Length': Buffer.byteLength(soapPayload, 'utf-8'),
                ...(options?.httpHeaders || {})
              },
              timeout: timeoutMs
            }, (res) => {
              let body = '';
              res.setEncoding('utf-8');
              res.on('data', chunk => { body += chunk; });
              res.on('end', () => {
                resolve({ status: res.statusCode || 200, text: body });
              });
            });

            req.on('timeout', () => {
              req.destroy(new Error(`Timeout de red superado (${timeoutMs}ms)`));
            });

            req.on('error', (err) => {
              reject(err);
            });

            req.write(soapPayload, 'utf-8');
            req.end();
          });

          httpStatus = response.status;
          responseText = response.text;
        }
      }

      const durationMs = Date.now() - startTime;

      // 3. Tratamiento de respuestas con código de error HTTP 5xx (Errores técnicos de servidor)
      if (httpStatus >= 500) {
        let descripcionError = `Error técnico del servidor web de la AEAT (HTTP ${httpStatus})`;
        let soapFaultCode = `HTTP_${httpStatus}`;
        let parsedFault: AeatParsedResponse | undefined;

        try {
          parsedFault = parseAeatXmlResponse(responseText);
          if (parsedFault.fault) {
            soapFaultCode = parsedFault.fault.faultcode;
            descripcionError = parsedFault.fault.faultstring;
          }
        } catch {
          // Si no es XML válido, conservar la descripción HTTP genérica
        }

        const failedSub = transitionSubmissionStatus(sendingSubmission, 'FAILED_TECHNICAL', {
          httpStatus,
          codigoAeat: soapFaultCode,
          descripcion: descripcionError,
          xmlRespuesta: responseText,
          tiempoRespuestaMs: durationMs
        });

        const failureEvent = createTransportFiscalEvent({
          obligadoTributarioId: fiscalRecord.obligadoTributarioId,
          tipo: 'ENVIO_AEAT_ERROR_TECNICO',
          fiscalRecordId: fiscalRecord.id,
          numeroFactura: fiscalRecord.factura.numeroFactura,
          actor,
          descripcion: `Fallo técnico en remisión AEAT (HTTP ${httpStatus}): ${descripcionError}`,
          datos: { httpStatus, codigo: soapFaultCode, tiempoRespuestaMs: durationMs }
        });

        return {
          submission: failedSub,
          fiscalEvent: failureEvent,
          isTechnicalError: true,
          parsedResponse: parsedFault,
          httpStatus,
          errorDetails: {
            code: soapFaultCode,
            message: descripcionError
          }
        };
      }

      // 4. Parsear la respuesta funcional de la AEAT
      let parsed: AeatParsedResponse;
      try {
        parsed = parseAeatXmlResponse(responseText);
      } catch (parseErr: any) {
        // Si la respuesta no es un XML válido conforme a la especificación, es un fallo técnico
        const parseErrorMsg = parseErr?.message || 'Respuesta devuelta por la AEAT no es un XML válido';
        const failedSub = transitionSubmissionStatus(sendingSubmission, 'FAILED_TECHNICAL', {
          httpStatus,
          codigoAeat: 'ERR_XML_INVALID',
          descripcion: parseErrorMsg,
          xmlRespuesta: responseText,
          tiempoRespuestaMs: durationMs
        });

        const failureEvent = createTransportFiscalEvent({
          obligadoTributarioId: fiscalRecord.obligadoTributarioId,
          tipo: 'ENVIO_AEAT_ERROR_TECNICO',
          fiscalRecordId: fiscalRecord.id,
          numeroFactura: fiscalRecord.factura.numeroFactura,
          actor,
          descripcion: `Fallo técnico: La respuesta de la AEAT no tiene formato XML válido`,
          datos: { error: parseErrorMsg, httpStatus }
        });

        return {
          submission: failedSub,
          fiscalEvent: failureEvent,
          isTechnicalError: true,
          httpStatus,
          errorDetails: {
            code: 'ERR_XML_INVALID',
            message: parseErrorMsg
          }
        };
      }

      // 5. Tratar SOAP Faults explícitos
      if (parsed.isSoapFault && parsed.fault) {
        const failedSub = transitionSubmissionStatus(sendingSubmission, 'FAILED_TECHNICAL', {
          httpStatus,
          codigoAeat: parsed.fault.faultcode,
          descripcion: parsed.fault.faultstring,
          xmlRespuesta: responseText,
          tiempoRespuestaMs: durationMs
        });

        const faultEvent = createTransportFiscalEvent({
          obligadoTributarioId: fiscalRecord.obligadoTributarioId,
          tipo: 'ENVIO_AEAT_ERROR_TECNICO',
          fiscalRecordId: fiscalRecord.id,
          numeroFactura: fiscalRecord.factura.numeroFactura,
          actor,
          descripcion: `SOAP Fault de infraestructura AEAT: ${parsed.fault.faultstring}`,
          datos: { fault: parsed.fault }
        });

        return {
          submission: failedSub,
          fiscalEvent: faultEvent,
          isTechnicalError: true,
          parsedResponse: parsed,
          httpStatus,
          errorDetails: {
            code: parsed.fault.faultcode,
            message: parsed.fault.faultstring
          }
        };
      }

      // 6. Transición según el estado funcional de la respuesta AEAT
      // Actualizar control de flujo oficial AEAT si la respuesta contiene TiempoEsperaEnvio
      if (parsed.tiempoEsperaEnvio !== undefined) {
        AeatFlowControlManager.updateFromResponse(
          fiscalRecord.obligadoTributarioId,
          parsed.tiempoEsperaEnvio,
          Date.now()
        );
      }

      if (parsed.mappedSubmissionStatus === 'ACCEPTED') {
        const acceptedSub = transitionSubmissionStatus(sendingSubmission, 'ACCEPTED', {
          httpStatus,
          csv: parsed.csv,
          codigoAeat: '0',
          descripcion: 'Aceptado por AEAT',
          tiempoEsperaEnvio: parsed.tiempoEsperaEnvio,
          xmlRespuesta: responseText,
          tiempoRespuestaMs: durationMs
        });

        const event = createTransportFiscalEvent({
          obligadoTributarioId: fiscalRecord.obligadoTributarioId,
          tipo: 'ENVIO_AEAT_ACEPTADO',
          fiscalRecordId: fiscalRecord.id,
          numeroFactura: fiscalRecord.factura.numeroFactura,
          actor,
          descripcion: `Factura ${fiscalRecord.factura.numeroFactura} aceptada formalmente por AEAT. CSV: ${parsed.csv || 'N/A'}`,
          datos: { csv: parsed.csv, tiempoRespuestaMs: durationMs, tiempoEsperaEnvio: parsed.tiempoEsperaEnvio }
        });

        return {
          submission: acceptedSub,
          fiscalEvent: event,
          isTechnicalError: false,
          parsedResponse: parsed,
          httpStatus
        };
      }

      if (parsed.mappedSubmissionStatus === 'ACCEPTED_WITH_ERRORS') {
        const warningSub = transitionSubmissionStatus(sendingSubmission, 'ACCEPTED_WITH_ERRORS', {
          httpStatus,
          csv: parsed.csv,
          codigoAeat: parsed.avisos[0]?.codigo || 'AVISO_AEAT',
          descripcion: parsed.avisos[0]?.descripcion || 'Aceptado con advertencias no bloqueantes',
          avisos: parsed.avisos,
          tiempoEsperaEnvio: parsed.tiempoEsperaEnvio,
          xmlRespuesta: responseText,
          tiempoRespuestaMs: durationMs
        });

        const event = createTransportFiscalEvent({
          obligadoTributarioId: fiscalRecord.obligadoTributarioId,
          tipo: 'ENVIO_AEAT_ACEPTADO_CON_ERRORES',
          fiscalRecordId: fiscalRecord.id,
          numeroFactura: fiscalRecord.factura.numeroFactura,
          actor,
          descripcion: `Factura ${fiscalRecord.factura.numeroFactura} aceptada con advertencias por AEAT. CSV: ${parsed.csv || 'N/A'}`,
          datos: { csv: parsed.csv, avisos: parsed.avisos, tiempoEsperaEnvio: parsed.tiempoEsperaEnvio }
        });

        return {
          submission: warningSub,
          fiscalEvent: event,
          isTechnicalError: false,
          parsedResponse: parsed,
          httpStatus
        };
      }

      // Caso REJECTED (Rechazo funcional)
      const errCode = parsed.errores[0]?.codigo || '1100';
      const errDesc = parsed.errores[0]?.descripcion || 'Rechazo funcional por la AEAT';

      const rejectedSub = transitionSubmissionStatus(sendingSubmission, 'REJECTED', {
        httpStatus,
        codigoAeat: errCode,
        descripcion: errDesc,
        errores: parsed.errores,
        tiempoEsperaEnvio: parsed.tiempoEsperaEnvio,
        xmlRespuesta: responseText,
        tiempoRespuestaMs: durationMs
      });

      const rejectEvent = createTransportFiscalEvent({
        obligadoTributarioId: fiscalRecord.obligadoTributarioId,
        tipo: 'ENVIO_AEAT_RECHAZADO',
        fiscalRecordId: fiscalRecord.id,
        numeroFactura: fiscalRecord.factura.numeroFactura,
        actor,
        descripcion: `Factura ${fiscalRecord.factura.numeroFactura} rechazada por la AEAT: [${errCode}] ${errDesc}`,
        datos: { codigo: errCode, errores: parsed.errores }
      });

      return {
        submission: rejectedSub,
        fiscalEvent: rejectEvent,
        isTechnicalError: false,
        parsedResponse: parsed,
        httpStatus,
        errorDetails: {
          code: errCode,
          message: errDesc
        }
      };

    } catch (networkErr: any) {
      // 7. Captura de errores técnicos de red (Timeout, DNS, TLS, Socket closed)
      const durationMs = Date.now() - startTime;
      const errorCode = networkErr?.code || 'ERR_NETWORK_FAILED';
      const errorMessage = networkErr?.message || 'Error de comunicación de red al conectar con AEAT';

      const failedSub = transitionSubmissionStatus(sendingSubmission, 'FAILED_TECHNICAL', {
        codigoAeat: errorCode,
        descripcion: errorMessage,
        tiempoRespuestaMs: durationMs
      });

      const errorEvent = createTransportFiscalEvent({
        obligadoTributarioId: fiscalRecord.obligadoTributarioId,
        tipo: 'ENVIO_AEAT_ERROR_TECNICO',
        fiscalRecordId: fiscalRecord.id,
        numeroFactura: fiscalRecord.factura.numeroFactura,
        actor,
        descripcion: `Fallo técnico de conexión con AEAT: ${errorMessage}`,
        datos: { code: errorCode, message: errorMessage, durationMs }
      });

      return {
        submission: failedSub,
        fiscalEvent: errorEvent,
        isTechnicalError: true,
        errorDetails: {
          code: errorCode,
          message: errorMessage
        }
      };
    }
  } finally {
    if (shouldManageLock) {
      AeatFlowControlManager.releaseSendLock(fiscalRecord.obligadoTributarioId);
    }
  }
}

/**
 * Determina si una sumisión o su respuesta asociada admite reintento técnico según la normativa AEAT.
 */
export function isRetryableSubmission(
  submission: FiscalSubmission,
  parsedResponse?: AeatParsedResponse
): boolean {
  if (submission.estado === 'ACCEPTED' || submission.estado === 'ACCEPTED_WITH_ERRORS') {
    return false; // Ya admitido por la AEAT
  }
  if (submission.estado === 'REJECTED') {
    return false; // Rechazo funcional por la AEAT: requiere subsanación, nunca reintento ciego
  }
  if (submission.numeroIntento >= MAX_RETRY_ATTEMPTS) {
    return false; // Límite máximo de intentos alcanzado
  }

  if (parsedResponse?.isSoapFault && parsedResponse.fault) {
    return parsedResponse.fault.isRetryable;
  }

  const code = (submission.codigoAeat || '').toLowerCase();
  if (
    code.includes('client') ||
    code.includes('400') ||
    code.includes('cvc-') ||
    code === 'err_xml_invalid'
  ) {
    return false;
  }

  return submission.estado === 'FAILED_TECHNICAL' || submission.estado === 'RETRY_PENDING';
}

/**
 * Programa un reintento técnico para una sumisión fallida por causas de red o servidor.
 * Pasa de FAILED_TECHNICAL a RETRY_PENDING sin modificar el FiscalRecord.
 *
 * Aplica la política interna de reintentos técnicos de la aplicación con backoff:
 * - Intento 1: 60s
 * - Intento 2: 180s (3m)
 * - Intento 3: 600s (10m)
 *
 * (NOTA: Esta cadencia de reintento es una política interna de resiliencia del software
 * para fallos técnicos, no un requisito normativo de la AEAT).
 */
export function scheduleSubmissionRetry(
  submission: FiscalSubmission,
  delaySeconds?: number,
  parsedResponse?: AeatParsedResponse
): FiscalSubmission {
  if (submission.estado !== 'FAILED_TECHNICAL') {
    throw new Error(`scheduleSubmissionRetry: Solo se pueden reprogramar sumisiones en estado FAILED_TECHNICAL (recibido '${submission.estado}').`);
  }

  if (submission.numeroIntento >= MAX_RETRY_ATTEMPTS) {
    throw new Error(`scheduleSubmissionRetry: Se ha alcanzado el límite máximo de ${MAX_RETRY_ATTEMPTS} intentos. Se bloquea nuevo reintento automático.`);
  }

  if (!isRetryableSubmission(submission, parsedResponse)) {
    throw new Error(`scheduleSubmissionRetry: La sumisión no es reintentable automáticamente (${submission.codigoAeat || 'Error no reintentable'}).`);
  }

  const internalDelay = getRetryDelaySeconds(submission.numeroIntento);
  const now = Date.now();
  const nextAllowed = AeatFlowControlManager.getNextAllowedSendTimestamp(submission.obligadoTributarioId);
  const remainingAeatWaitSeconds = Math.max(0, Math.ceil((nextAllowed - now) / 1000));

  // Coordinación técnica:
  // Si la AEAT tiene una ventana de espera activa para el obligado tributario,
  // el reintento técnico no puede lanzarse antes de que expire dicha ventana oficial.
  const requestedOrInternalDelay = typeof delaySeconds === 'number' ? delaySeconds : internalDelay;
  const effectiveDelay = Math.max(requestedOrInternalDelay, remainingAeatWaitSeconds);

  const proximoReintento = new Date(now + effectiveDelay * 1000).toISOString();
  return transitionSubmissionStatus(submission, 'RETRY_PENDING', {
    proximoReintento
  });
}

/**
 * Crea una nueva sumisión (intento independiente en el Outbox) tras un error técnico,
 * incrementando el número de intento y dejando el FiscalRecord sellado 100% inalterado.
 */
export function createRetrySubmission(params: {
  previousSubmission: FiscalSubmission;
  fiscalRecord: FiscalRecord;
  config: FiscalConfiguration;
  parsedResponse?: AeatParsedResponse;
}): FiscalSubmission {
  const { previousSubmission, fiscalRecord, config, parsedResponse } = params;

  if (previousSubmission.estado === 'ACCEPTED' || previousSubmission.estado === 'ACCEPTED_WITH_ERRORS') {
    throw new Error('createRetrySubmission: No se puede reintentar una sumisión ya aceptada por la AEAT.');
  }

  if (previousSubmission.estado === 'REJECTED') {
    throw new Error('createRetrySubmission: No se puede reintentar automáticamente una sumisión rechazada funcionalmente por la AEAT. Requiere subsanación o corrección de datos.');
  }

  if (previousSubmission.numeroIntento >= MAX_RETRY_ATTEMPTS) {
    throw new Error(`createRetrySubmission: Se ha alcanzado el límite máximo de ${MAX_RETRY_ATTEMPTS} intentos. Se bloquea nuevo reintento automático.`);
  }

  if (!isRetryableSubmission(previousSubmission, parsedResponse) && previousSubmission.estado !== 'PENDING') {
    throw new Error(`createRetrySubmission: La sumisión previa no es reintentable (${previousSubmission.codigoAeat || 'Error no reintentable'}).`);
  }

  return createFiscalSubmission(fiscalRecord, config, {
    numeroIntento: previousSubmission.numeroIntento + 1,
    xmlEnviado: previousSubmission.xmlEnviado,
    endpoint: previousSubmission.endpoint
  });
}
