/**
 * Arquitectura Fiscal SIF (Sistemas Informáticos de Facturación) - RD 1007/2023 y Orden HAC/1177/2024
 * FASE 1.1: Limpieza Arquitectónica y Unificación de Modelos
 *
 * Principios de seguridad y diseño:
 * - deepFreeze = Protección en tiempo de ejecución en memoria contra mutaciones accidentales.
 * - Hash y Encadenamiento = Garantía de integridad criptográfica verificable.
 * - Firestore Rules / Backend = Protección física de persistencia inmutable en base de datos.
 * - LocalStorage = Almacenamiento temporal / caché del navegador (NO es mecanismo suficiente de seguridad fiscal).
 * - /fiscal_records/{recordId} = ÚNICA FUENTE PERSISTENTE DE VERDAD del registro fiscal.
 */

export type FiscalMode = 'VERI_FACTU' | 'NO_VERI_FACTU';
export type TipoRegistroFiscal = 'alta' | 'anulacion';
export type TipoFacturaAEAT = 'F1' | 'F2' | 'F3' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type TipoRectificativa = 'por_diferencias' | 'por_sustitucion' | 'sustitucion' | 'diferencias';

export interface PersonaFisicaJuridicaIdOtroFiscal {
  readonly codigoPais?: string;
  readonly idType: '02' | '03' | '04' | '05' | '06' | '07';
  readonly id: string;
}

export interface PersonaFisicaJuridicaFiscal {
  readonly nombreRazon: string;
  readonly nif?: string;
  readonly codigoPais?: string;
  readonly idOtro?: PersonaFisicaJuridicaIdOtroFiscal;
}

/**
 * Desglose impositivo canónico según el esquema oficial AEAT (Orden HAC/1177/2024)
 */
export interface DesgloseIvaFiscal {
  readonly tipoImpositivo?: number; // Ej: 4, 10, 21 (opcional en exentas / no sujetas)
  readonly baseImponible: number;
  readonly baseImponibleACoste?: number;
  readonly cuotaRepercutida?: number;
  readonly tipoRecargoEquivalencia?: number; // Ej: 0.5, 1.4, 5.2
  readonly cuotaRecargoEquivalencia?: number;
  readonly impuesto?: '01' | '02' | '03' | '05'; // '01': IVA (default)
  readonly claveRegimen?: string; // '01': Régimen general (default)
  readonly calificacionOperacion?: 'S1' | 'S2' | 'N1' | 'N2'; // 'S1': Sujeta y no exenta sin ISP (default)
  readonly operacionExenta?: 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8';
}

/**
 * Identificación unívoca del Sistema Informático de Facturación (SIF)
 */
export interface SistemaInformaticoFiscal {
  readonly nombreRazon: string; // Desarrollador / Fabricante
  readonly nif?: string; // NIF del desarrollador
  readonly idOtro?: PersonaFisicaJuridicaIdOtroFiscal; // Identificación alternativa extranjera del desarrollador
  readonly nombreSistemaInformatico: string;
  readonly idSistemaInformatico: string; // Código asignado (AEAT max 2 caracteres, ej: '01')
  readonly version: string;
  readonly numeroInstalacion: string;
  readonly tipoUsoPosibleSoloVerifactu: 'S' | 'N';
  readonly tipoUsoPosibleMultiOT?: 'S' | 'N';
  readonly indicadorMultiplesOT?: 'S' | 'N';
}

/**
 * 2. FISCAL RECORD (Registro de Facturación Fiscal Oficial)
 * Fuente única de verdad del registro fiscal.
 *
 * UNIFICACIÓN DE CAMPOS EN FASE 1.1:
 * - ÚNICA fuente para la huella: `huella` (hash, algoritmo, especificacionVersion, cadenaTextoCanonico).
 * - ÚNICA fuente para encadenamiento: `encadenamiento` (registroAnterior.huella).
 * - ÚNICA fuente para el XML: `xmlOficial?: string` (opcional en Fase 1, ausente hasta Fase 3).
 * - Identidad del obligado tributario: `obligadoTributarioId` para cadenas independientes.
 */
export interface FiscalRecord {
  readonly id: string; // Identificador unívoco del registro fiscal
  readonly obligadoTributarioId: string; // Identificador inequívoco del obligado tributario titular de la cadena
  readonly invoiceId: string; // Enlace 1:1 con la Factura Comercial
  readonly tipoRegistro: TipoRegistroFiscal; // 'alta' | 'anulacion'
  readonly modoFiscal: FiscalMode; // 'VERI_FACTU' | 'NO_VERI_FACTU'
  readonly versionEspecificacion: string; // '1.0'
  readonly sistemaInformatico: SistemaInformaticoFiscal;

  // Emisor fiscal (coincide con el obligado tributario)
  readonly emisor: {
    readonly nif: string;
    readonly nombreRazon: string;
  };

  // Tercero que expide la factura y/o genera el registro de alta (opcional en XSD)
  readonly tercero?: PersonaFisicaJuridicaFiscal;

  // Destinatario fiscal (obligatorio en F1, F3, R1, R2, R3, R4; prohibido en F2 y R5)
  readonly destinatario?: {
    readonly nif?: string;
    readonly nombreRazon?: string;
    readonly codigoPais?: string;
    readonly idOtro?: {
      readonly codigoPais?: string;
      readonly idType: '02' | '03' | '04' | '05' | '06' | '07';
      readonly id: string;
    };
  };

  // Múltiples destinatarios (hasta 1000 según XSD IDDestinatario maxOccurs="1000")
  readonly destinatarios?: ReadonlyArray<PersonaFisicaJuridicaFiscal>;

  // Datos fiscales canónicos de la factura
  readonly factura: {
    readonly numeroFactura: string;
    readonly serieFactura?: string;
    readonly fechaExpedicion: string; // YYYY-MM-DD o DD-MM-YYYY
    readonly fechaOperacion?: string; // YYYY-MM-DD o DD-MM-YYYY (opcional en XSD)
    readonly horaExpedicion: string; // HH:mm:ss
    readonly tipoFactura: TipoFacturaAEAT;
    readonly descripcionOperacion: string;
    readonly refExterna?: string; // TextMax60Type
    readonly subsanacion?: 'S' | 'N';
    readonly rechazoPrevio?: 'N' | 'S' | 'X';
    readonly facturaSimplificadaArt7273: 'S' | 'N';
    readonly facturaSinIdentifDestinatarioArt61d: 'S' | 'N';
    readonly macrodato: 'S' | 'N';
    readonly emitidaPorTerceroODestinatario?: 'T' | 'D';
    readonly cupon?: 'S' | 'N';
    readonly numRegistroAcuerdoFacturacion?: string; // TextMax15Type
    readonly idAcuerdoSistemaInformatico?: string; // TextMax16Type
    readonly facturasSustituidas?: ReadonlyArray<{
      readonly idEmisorFactura?: string;
      readonly numeroFactura: string;
      readonly fechaExpedicion: string;
    }>;
  };

  // Desglose impositivo canónico
  readonly desgloseTributario: {
    readonly desgloseIVA: readonly DesgloseIvaFiscal[];
    readonly baseImponibleTotal: number;
    readonly cuotaTotal: number;
    readonly cuotaRecargoTotal: number;
    readonly importeTotal: number;
  };

  // Rectificativas (R1, R2, R3, R4, R5)
  readonly datosRectificativa?: {
    readonly tipoRectificativa: 'S' | 'I'; // S: sustitución, I: diferencias (incremental)
    readonly facturasRectificadas: ReadonlyArray<{
      readonly idEmisorFactura?: string;
      readonly numeroFactura: string;
      readonly fechaExpedicion: string;
    }>;
    readonly importeRectificacion?: {
      readonly baseRectificada: number;
      readonly cuotaRectificada: number;
      readonly cuotaRecargoRectificado?: number;
    };
    readonly motivoRectificacion?: string;
    readonly codigoMotivoRectificacion?: '01' | '02' | '03' | '04' | '05';
  };

  // Anulaciones (RegistroAnulacion)
  readonly datosAnulacion?: {
    readonly motivoAnulacion: string;
    readonly numeroFacturaAnulada: string;
    readonly fechaExpedicionFacturaAnulada: string;
    readonly refExterna?: string;
    readonly sinRegistroPrevio?: 'S' | 'N';
    readonly rechazoPrevio?: 'S' | 'N';
    readonly generadoPor?: 'E' | 'D' | 'T';
    readonly generador?: PersonaFisicaJuridicaFiscal;
  };

  // Encadenamiento criptográfico con el registro anterior (ÚNICA FUENTE DE ENCADENAMIENTO)
  readonly encadenamiento: {
    readonly primerRegistro: boolean;
    readonly registroAnterior?: {
      readonly idEmisorFactura: string;
      readonly numSerieFactura: string;
      readonly fechaExpedicionFactura: string;
      readonly huella: string; // Hash SHA-256 del registro anterior
    };
  };

  // Huella digital oficial del registro fiscal actual (ÚNICA FUENTE DEL HASH)
  readonly huella: {
    readonly hash: string; // Huella SHA-256 en hexadecimal mayúsculas
    readonly algoritmo: 'SHA-256';
    readonly especificacionVersion: string; // 'HAC/1177/2024'
    readonly cadenaTextoCanonico: string; // Cadena exacta normalizada
  };

  // Sello temporal ISO 8601 con huso horario
  readonly fechaHoraHusoGenRegistro: string;

  // Código QR tributario oficial y URL de verificación
  readonly qr: {
    readonly url: string;
    readonly payloadTexto: string;
    readonly qrDataUri?: string;
  };

  // XML oficial conforme al esquema XSD SuministroLRFacturasEmitidas (ÚNICA FUENTE DE XML, opcional en Fase 1)
  readonly xmlOficial?: string;

  readonly estado: 'sellado_inmutable';
  readonly creadoEn: string;
}

/**
 * Referencia liviana derivada a un FiscalRecord para indexación y consulta en AppData
 * Evita la duplicación del documento completo de FiscalRecord.
 */
export interface FiscalRecordRef {
  readonly id: string;
  readonly obligadoTributarioId: string;
  readonly invoiceId: string;
  readonly numeroFactura: string;
  readonly fechaExpedicion: string;
  readonly huellaHash: string;
  readonly creadoEn: string;
}

/**
 * 3. FISCAL SUBMISSION (Intento / Remisión a la AEAT - Outbox)
 *
 * Representa una remisión física específica hacia los servicios web de la AEAT.
 * Un FiscalRecord puede tener CERO, UNA o VARIAS FiscalSubmissions:
 * - CERO: Cuando el registro está recién generado, o el sistema opera en NO_VERI_FACTU, o la remisión está pendiente de encolar.
 * - UNA: Tras el primer intento de envío a la AEAT.
 * - VARIAS: Cuando se producen reintentos técnicos por incidencias de red, timeouts o rechazos subsanables.
 *
 * NUNCA se asume que un FiscalRecord contiene o requiere forzosamente una submission.
 */
export type FiscalSubmissionStatus =
  | 'PENDING'
  | 'SENDING'
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_ERRORS'
  | 'PARTIALLY_ACCEPTED'
  | 'REJECTED'
  | 'RETRY_PENDING'
  | 'FAILED_TECHNICAL';

export type FiscalRecordSubmissionStatus =
  | 'PENDING'
  | 'SENDING'
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_ERRORS'
  | 'REJECTED'
  | 'RETRY_PENDING'
  | 'FAILED_TECHNICAL';

/**
 * Resultado individual de la remisión de un FiscalRecord dentro de una FiscalSubmission (1..1000).
 * Preserva el estado tributario individual de cada registro sin mutar el FiscalRecord sellado.
 */
export interface FiscalRecordSubmissionResult {
  readonly fiscalRecordId: string;
  readonly numeroFactura: string;
  readonly fechaExpedicion: string;
  readonly tipoRegistro: TipoRegistroFiscal;
  readonly estado: FiscalRecordSubmissionStatus;
  readonly estadoRegistroAeat?: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto' | string;
  readonly codigoErrorRegistro?: string;
  readonly descripcionErrorRegistro?: string;
  readonly csv?: string;
  readonly refExterna?: string;
  readonly registroDuplicado?: any;
  readonly esReintentable: boolean;
  readonly requiereSubsanacion: boolean;
}

export interface FiscalSubmission {
  readonly id: string;
  readonly obligadoTributarioId: string;
  readonly fiscalRecordId: string; // Primer o único registro (retrocompatibilidad 1:1)
  readonly numeroFactura: string; // Primera o única factura (retrocompatibilidad 1:1)
  readonly fiscalRecordIds?: ReadonlyArray<string>; // Identificadores ordenados de los 1..1000 registros del batch
  readonly numerosFactura?: ReadonlyArray<string>; // Números de factura ordenados de los 1..1000 registros del batch
  readonly cantidadRegistros?: number; // Cantidad total de registros en el envío (1..1000)
  readonly esBatch?: boolean; // true cuando la remisión agrupa múltiples registros
  readonly estado: FiscalSubmissionStatus;
  readonly estadoEnvioAeat?: 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto' | string;
  readonly resultadosIndividuales?: ReadonlyArray<FiscalRecordSubmissionResult>;
  readonly fechaCreacion: string; // ISO 8601
  readonly fechaIntento: string; // ISO 8601
  readonly fechaEnvio?: string;
  readonly fechaRespuesta?: string;
  readonly numeroIntento: number;
  readonly endpoint: string;
  readonly xmlEnviado: string;
  readonly xmlRespuesta?: string;
  readonly httpStatus?: number;
  readonly codigoAeat?: string;
  readonly descripcion?: string;
  readonly avisos?: ReadonlyArray<{
    readonly codigo: string;
    readonly descripcion: string;
    readonly numSerieFactura?: string;
    readonly fiscalRecordId?: string;
  }>;
  readonly errores?: ReadonlyArray<{
    readonly codigo: string;
    readonly descripcion: string;
    readonly numSerieFactura?: string;
    readonly fiscalRecordId?: string;
  }>;
  readonly csv?: string; // Código Seguro de Verificación emitido por AEAT
  readonly tiempoEsperaEnvio?: number; // Tiempo de espera en segundos indicado por la AEAT para control de flujo
  readonly tiempoRespuestaMs?: number;
  readonly proximoReintento?: string;
  readonly completadoEn?: string;
}

/**
 * Actor que origina un evento de auditoría en el SIF (Humano o Sistema)
 */
export interface FiscalActor {
  readonly tipo: 'USER' | 'SYSTEM';
  readonly id?: string;
  readonly email?: string;
  readonly nombre?: string;
}

/**
 * 4. FISCAL EVENT (Libro de Auditoría del SIF)
 * Registra eventos de forma continua e inalterable.
 * El actor puede ser un usuario (USER) o un proceso automático del software (SYSTEM).
 */
export type TipoFiscalEvent =
  | 'CREACION_FACTURA'
  | 'GENERACION_REGISTRO'
  | 'SELLADO_HUELLA'
  | 'ENCADENAMIENTO'
  | 'GENERACION_XML'
  | 'GENERACION_QR'
  | 'GENERACION_PDF'
  | 'COLA_SUBMISSION_CREADA'
  | 'ENVIO_AEAT_INICIADO'
  | 'ENVIO_AEAT_ACEPTADO'
  | 'ENVIO_AEAT_ACEPTADO_CON_ERRORES'
  | 'ENVIO_AEAT_PARCIALMENTE_ACEPTADO'
  | 'ENVIO_AEAT_RECHAZADO'
  | 'ENVIO_AEAT_ERROR_TECNICO'
  | 'REINTENTO_PROGRAMADO'
  | 'EMISION_RECTIFICATIVA'
  | 'ANULACION_REGISTRO'
  | 'VERIFICACION_INTEGRIDAD_EXITO'
  | 'VERIFICACION_INTEGRIDAD_FALLO';

export interface FiscalEvent {
  readonly id: string;
  readonly obligadoTributarioId: string;
  readonly tipo: TipoFiscalEvent;
  readonly fechaHora: string; // ISO 8601
  readonly actor: FiscalActor;
  readonly fiscalRecordId?: string;
  readonly numeroFactura?: string;
  readonly descripcion: string;
  readonly datos?: Record<string, any>;
  readonly hashEvento?: string; // Encadenamiento criptográfico del log de auditoría
}

/**
 * 5. FISCAL CONFIGURATION (Configuración Fiscal del Sistema y Emisor)
 * Independiente de la configuración general de empresa.
 * Identifica inequívocamente al obligado tributario.
 * Sin secretos, passwords ni certificados almacenados en plano en LocalStorage o Firestore.
 */
export interface FiscalConfiguration {
  readonly obligadoTributarioId: string; // NIF / Identificador inequívoco del obligado tributario
  readonly nifEmisor: string;
  readonly nombreRazonEmisor: string;
  readonly nombreComercial?: string;
  readonly modalidad: FiscalMode;
  readonly entornoAeat: 'pruebas' | 'produccion';
  readonly versionEspecificacion: string; // Ej: '1.0'
  readonly sistemaInformatico: SistemaInformaticoFiscal;
  readonly remisionAutomatica: boolean;
  readonly reintentosMaximos: number;
  readonly minutosEntreReintentos: number;
  readonly transporte: {
    readonly endpointUrl: string;
    readonly timeoutMs: number;
    readonly certificadoConfigurado: boolean; // Flag booleano; la clave privada reside exclusivamente en secrets del servidor
    readonly proxyUrl?: string;
  };
  readonly certificadoConfigurado: boolean;
  readonly fechaActivacion: string;
}
