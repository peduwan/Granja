/**
 * PARSER DE RESPUESTAS OFICIALES AEAT VERI*FACTU (FASE 3.1)
 *
 * Normativa Oficial:
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF)
 * - Orden HAC/1177/2024
 * - Esquema oficial RespuestaSuministro.xsd
 *
 * RESPONSABILIDAD ÚNICA:
 * Convierte la respuesta XML/SOAP oficial devuelta por la AEAT en un modelo tipado interno.
 * No ejecuta lógica de negocio, no muta registros fiscales y preserva el XML original íntegro.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  FiscalRecord,
  FiscalSubmissionStatus,
  FiscalRecordSubmissionResult,
  FiscalRecordSubmissionStatus
} from './types';

export interface AeatResponseLine {
  readonly idFactura: {
    readonly idEmisorFactura: string;
    readonly numSerieFactura: string;
    readonly fechaExpedicionFactura: string;
  };
  readonly operacion?: string;
  readonly operacionDetalle?: {
    readonly tipoOperacion: string;
    readonly subsanacion?: string;
    readonly rechazoPrevio?: string;
    readonly sinRegistroPrevio?: string;
  };
  readonly refExterna?: string;
  readonly estadoRegistro: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto' | string;
  readonly codigoErrorRegistro?: string;
  readonly descripcionErrorRegistro?: string;
  readonly registroDuplicado?: any;
}

export type SoapFaultCategory = 'SOAP_FAULT_SERVER' | 'SOAP_FAULT_CLIENT' | 'SOAP_FAULT_UNKNOWN';

export interface SoapFaultClassification {
  readonly category: SoapFaultCategory;
  readonly isRetryable: boolean;
  readonly faultcode: string;
  readonly faultstring: string;
  readonly detail?: string;
}

export interface AeatParsedResponse {
  readonly rawXml: string;
  readonly isSoapFault: boolean;
  readonly fault?: SoapFaultClassification;
  readonly csv?: string;
  readonly datosPresentacion?: {
    readonly nifPresentador?: string;
    readonly timestampPresentacion?: string;
  };
  readonly cabecera?: any;
  readonly tiempoEsperaEnvio?: number;
  readonly estadoEnvio?: 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto' | string;
  readonly lineas: ReadonlyArray<AeatResponseLine>;
  /**
   * Mapeo reglamentario al estado interno de FiscalSubmission
   */
  readonly mappedSubmissionStatus:
    | 'ACCEPTED'
    | 'ACCEPTED_WITH_ERRORS'
    | 'PARTIALLY_ACCEPTED'
    | 'REJECTED'
    | 'FAILED_TECHNICAL';
  /**
   * Indica si el error o estado admite reintento técnico automático según las reglas de la AEAT.
   */
  readonly isRetryable: boolean;
  readonly avisos: ReadonlyArray<{
    readonly codigo: string;
    readonly descripcion: string;
    readonly numSerieFactura?: string;
  }>;
  readonly errores: ReadonlyArray<{
    readonly codigo: string;
    readonly descripcion: string;
    readonly numSerieFactura?: string;
  }>;
}

/**
 * Clasifica un SOAP Fault conforme a la especificación SOAP 1.1 y directrices de la AEAT.
 */
export function classifySoapFault(
  faultcode: string,
  faultstring: string,
  detail?: string
): SoapFaultClassification {
  const cleanCode = (faultcode || '').toLowerCase().trim();
  const cleanString = (faultstring || '').toLowerCase().trim();
  const cleanDetail = (detail || '').toLowerCase().trim();

  let category: SoapFaultCategory = 'SOAP_FAULT_UNKNOWN';
  let isRetryable = false;

  if (
    cleanCode.includes('server') ||
    cleanCode.includes('500') ||
    cleanCode.includes('502') ||
    cleanCode.includes('503') ||
    cleanCode.includes('504') ||
    cleanCode.includes('timeout') ||
    cleanCode.includes('unavailable')
  ) {
    category = 'SOAP_FAULT_SERVER';
    isRetryable = true; // Error de infraestructura en la AEAT: reintento permitido
  } else if (
    cleanCode.includes('client') ||
    cleanCode.includes('versionmismatch') ||
    cleanCode.includes('mustunderstand') ||
    cleanCode.includes('dataencodingunknown') ||
    cleanCode.includes('badrequest') ||
    cleanCode.includes('400') ||
    cleanString.includes('cvc-') ||
    cleanString.includes('invalid content') ||
    cleanDetail.includes('cvc-') ||
    cleanDetail.includes('invalid content')
  ) {
    category = 'SOAP_FAULT_CLIENT';
    isRetryable = false; // Error de sintaxis o mensaje del cliente: NO reintentar a ciegas
  } else {
    category = 'SOAP_FAULT_UNKNOWN';
    isRetryable = false; // Desconocido: no asumir reintento para evitar bucles infinitos
  }

  return {
    category,
    isRetryable,
    faultcode,
    faultstring,
    detail
  };
}

/**
 * Parsea el XML oficial devuelto por los servicios web de la AEAT.
 */
export function parseAeatXmlResponse(xmlString: string): AeatParsedResponse {
  if (!xmlString || typeof xmlString !== 'string' || xmlString.trim() === '') {
    throw new Error('parseAeatXmlResponse: Respuesta vacía o nula recibida de la AEAT.');
  }

  // 1. Validar sintaxis XML básica
  const validationResult = XMLValidator.validate(xmlString);
  if (validationResult !== true) {
    throw new Error(`parseAeatXmlResponse: Sintaxis XML inválida en la respuesta de la AEAT: ${JSON.stringify(validationResult)}`);
  }

  // 2. Parsear el árbol XML eliminando prefijos de namespace para una extracción limpia
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false, // Preservar strings sin conversión automática a booleanos/números
    trimValues: true
  });

  const parsed = parser.parse(xmlString);

  // 3. Comprobar si es un SOAP Fault
  // Puede estar en Envelope.Body.Fault o directamente en Fault
  const envelope = parsed.Envelope || parsed;
  const body = envelope.Body || envelope;
  const fault = body.Fault || parsed.Fault;

  if (fault) {
    const faultcode = fault.faultcode || fault.Code || 'soapenv:Server';
    const faultstring = fault.faultstring || fault.Reason || 'Error SOAP de infraestructura';
    const detail = typeof fault.detail === 'object' ? JSON.stringify(fault.detail) : String(fault.detail || '');

    const classification = classifySoapFault(String(faultcode), String(faultstring), detail || undefined);

    return {
      rawXml: xmlString,
      isSoapFault: true,
      fault: classification,
      lineas: [],
      mappedSubmissionStatus: 'FAILED_TECHNICAL',
      isRetryable: classification.isRetryable,
      avisos: [],
      errores: [
        {
          codigo: String(faultcode),
          descripcion: String(faultstring)
        }
      ]
    };
  }

  // 4. Localizar el nodo raíz RespuestaRegFactuSistemaFacturacion
  const respuestaRoot = body.RespuestaRegFactuSistemaFacturacion || parsed.RespuestaRegFactuSistemaFacturacion;
  if (!respuestaRoot) {
    throw new Error('parseAeatXmlResponse: El XML no contiene el elemento raíz oficial RespuestaRegFactuSistemaFacturacion.');
  }

  // 5. Extraer campos de cabecera y estado global
  const csv = respuestaRoot.CSV ? String(respuestaRoot.CSV) : undefined;
  const estadoEnvio = respuestaRoot.EstadoEnvio ? String(respuestaRoot.EstadoEnvio) : undefined;
  const tiempoEsperaEnvio = (respuestaRoot.TiempoEsperaEnvio !== undefined && respuestaRoot.TiempoEsperaEnvio !== null && String(respuestaRoot.TiempoEsperaEnvio).trim() !== '')
    ? parseInt(String(respuestaRoot.TiempoEsperaEnvio), 10)
    : undefined;

  const datosPresentacion = respuestaRoot.DatosPresentacion ? {
    nifPresentador: respuestaRoot.DatosPresentacion.NIFPresentador ? String(respuestaRoot.DatosPresentacion.NIFPresentador) : undefined,
    timestampPresentacion: respuestaRoot.DatosPresentacion.TimestampPresentacion ? String(respuestaRoot.DatosPresentacion.TimestampPresentacion) : undefined
  } : undefined;

  // 6. Extraer y normalizar las líneas de respuesta
  let rawLineas = respuestaRoot.RespuestaLinea;
  if (!rawLineas) {
    rawLineas = [];
  } else if (!Array.isArray(rawLineas)) {
    rawLineas = [rawLineas];
  }

  const lineas: AeatResponseLine[] = [];
  const avisos: Array<{ codigo: string; descripcion: string; numSerieFactura?: string }> = [];
  const errores: Array<{ codigo: string; descripcion: string; numSerieFactura?: string }> = [];

  for (const item of rawLineas) {
    const idFacturaNode = item.IDFactura || {};
    const idFactura = {
      idEmisorFactura: String(idFacturaNode.IDEmisorFactura || idFacturaNode.IDEmisorFacturaAnulada || ''),
      numSerieFactura: String(idFacturaNode.NumSerieFactura || idFacturaNode.NumSerieFacturaAnulada || ''),
      fechaExpedicionFactura: String(
        idFacturaNode.FechaExpedicionFactura || idFacturaNode.FechaExpedicionFacturaAnulada || ''
      )
    };

    let operacionStr: string | undefined;
    let operacionDetalle: AeatResponseLine['operacionDetalle'] | undefined;
    if (item.Operacion !== undefined && item.Operacion !== null) {
      if (typeof item.Operacion === 'object') {
        operacionStr = String(item.Operacion.TipoOperacion || 'Alta');
        operacionDetalle = {
          tipoOperacion: operacionStr,
          subsanacion: item.Operacion.Subsanacion ? String(item.Operacion.Subsanacion) : undefined,
          rechazoPrevio: item.Operacion.RechazoPrevio ? String(item.Operacion.RechazoPrevio) : undefined,
          sinRegistroPrevio: item.Operacion.SinRegistroPrevio ? String(item.Operacion.SinRegistroPrevio) : undefined
        };
      } else {
        operacionStr = String(item.Operacion);
      }
    }

    const estadoRegistro = String(item.EstadoRegistro || 'Incorrecto');
    const codigoError = item.CodigoErrorRegistro ? String(item.CodigoErrorRegistro) : undefined;
    const descripcionError = item.DescripcionErrorRegistro ? String(item.DescripcionErrorRegistro) : undefined;
    const rawDup = item.RegistroDuplicado;
    const registroDuplicado = rawDup && typeof rawDup === 'object' ? {
      idPeticionRegistroDuplicado: rawDup.IdPeticionRegistroDuplicado || rawDup.idPeticionRegistroDuplicado
        ? String(rawDup.IdPeticionRegistroDuplicado || rawDup.idPeticionRegistroDuplicado)
        : undefined,
      estadoRegistroDuplicado: rawDup.EstadoRegistroDuplicado || rawDup.estadoRegistroDuplicado
        ? String(rawDup.EstadoRegistroDuplicado || rawDup.estadoRegistroDuplicado)
        : undefined,
      codigoErrorRegistro: rawDup.CodigoErrorRegistro || rawDup.codigoErrorRegistro
        ? String(rawDup.CodigoErrorRegistro || rawDup.codigoErrorRegistro)
        : undefined,
      descripcionErrorRegistro: rawDup.DescripcionErrorRegistro || rawDup.descripcionErrorRegistro
        ? String(rawDup.DescripcionErrorRegistro || rawDup.descripcionErrorRegistro)
        : undefined
    } : undefined;

    lineas.push({
      idFactura,
      operacion: operacionStr,
      operacionDetalle,
      refExterna: item.RefExterna ? String(item.RefExterna) : undefined,
      estadoRegistro,
      codigoErrorRegistro: codigoError,
      descripcionErrorRegistro: descripcionError,
      registroDuplicado
    });

    if (estadoRegistro === 'AceptadoConErrores' && codigoError) {
      avisos.push({
        codigo: codigoError,
        descripcion: descripcionError || 'Aviso AEAT',
        numSerieFactura: idFactura.numSerieFactura || undefined
      });
    } else if (estadoRegistro === 'Incorrecto' && codigoError) {
      errores.push({
        codigo: codigoError,
        descripcion: descripcionError || 'Error de rechazo AEAT',
        numSerieFactura: idFactura.numSerieFactura || undefined
      });
    }
  }

  // 7. Determinar el estado interno para FiscalSubmission (1..1000 registros)
  let mappedStatus:
    | 'ACCEPTED'
    | 'ACCEPTED_WITH_ERRORS'
    | 'PARTIALLY_ACCEPTED'
    | 'REJECTED'
    | 'FAILED_TECHNICAL' = 'ACCEPTED';

  if (lineas.length === 0) {
    if (estadoEnvio === 'Correcto') {
      mappedStatus = 'ACCEPTED';
    } else if (estadoEnvio === 'Incorrecto') {
      mappedStatus = 'REJECTED';
    } else {
      mappedStatus = 'FAILED_TECHNICAL';
    }
  } else {
    const anyCorrect = lineas.some(l => l.estadoRegistro === 'Correcto');
    const anyAcceptedWithErrors = lineas.some(l => l.estadoRegistro === 'AceptadoConErrores');
    const anyAccepted = anyCorrect || anyAcceptedWithErrors;
    const anyIncorrect = lineas.some(l => l.estadoRegistro === 'Incorrecto');

    if (anyIncorrect && anyAccepted) {
      // Batch parcial: al menos un registro aceptado (Correcto / AceptadoConErrores) y al menos uno rechazado (Incorrecto)
      mappedStatus = 'PARTIALLY_ACCEPTED';
    } else if (anyIncorrect || estadoEnvio === 'Incorrecto') {
      mappedStatus = 'REJECTED';
    } else if (anyAcceptedWithErrors || estadoEnvio === 'ParcialmenteCorrecto') {
      mappedStatus = 'ACCEPTED_WITH_ERRORS';
    } else {
      mappedStatus = 'ACCEPTED';
    }
  }

  return {
    rawXml: xmlString,
    isSoapFault: false,
    csv,
    datosPresentacion,
    cabecera: respuestaRoot.Cabecera,
    tiempoEsperaEnvio,
    estadoEnvio,
    lineas,
    mappedSubmissionStatus: mappedStatus,
    isRetryable: false, // Las respuestas fiscales formales (Correcto, AceptadoConErrores, Incorrecto, ParcialmenteCorrecto) no se reintentan a ciegas
    avisos,
    errores
  };
}

/**
 * Normaliza una fecha YYYY-MM-DD o DD-MM-YYYY al formato oficial AEAT DD-MM-YYYY para correlación.
 */
export function normalizeDateForAeatCorrelation(dateStr: string): string {
  const clean = (dateStr || '').trim();
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }
  return clean;
}

/**
 * Extrae el número de serie+factura canónico de un FiscalRecord (alta o anulación).
 */
export function getRecordCanonicalNumSerie(record: FiscalRecord): string {
  if (record.tipoRegistro === 'anulacion' && record.datosAnulacion?.numeroFacturaAnulada) {
    return record.datosAnulacion.numeroFacturaAnulada.trim();
  }
  const serie = (record.factura.serieFactura || '').trim();
  const num = (record.factura.numeroFactura || '').trim();
  if (serie && !num.startsWith(serie)) {
    return `${serie}${num}`;
  }
  return num;
}

/**
 * Extrae la fecha de expedición canónica en formato DD-MM-YYYY de un FiscalRecord.
 */
export function getRecordCanonicalFechaExpedicion(record: FiscalRecord): string {
  if (record.tipoRegistro === 'anulacion' && record.datosAnulacion?.fechaExpedicionFacturaAnulada) {
    return normalizeDateForAeatCorrelation(record.datosAnulacion.fechaExpedicionFacturaAnulada);
  }
  return normalizeDateForAeatCorrelation(record.factura.fechaExpedicion);
}

export class AeatResponseCorrelationError extends Error {
  public readonly code = 'ERR_CORRELATION_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'AeatResponseCorrelationError';
  }
}

export interface AeatCorrelationOptions {
  readonly submissionStatus?: FiscalSubmissionStatus;
  /**
   * Conjunto de fiscalRecordIds que están siendo reconciliados tras un estado SENDING huérfano
   * con resultado AEAT desconocido. Si la AEAT responde con código 3000 (RegistroDuplicado) y
   * EstadoRegistroDuplicado = 'Correcta' o 'AceptadaConErrores', se reconcilian como aceptados.
   */
  readonly reconcilingRecordIds?: ReadonlySet<string> | ReadonlyArray<string>;
}

/**
 * Correlaciona cada FiscalRecord de un envío (1..1000) con su correspondiente <sfR:RespuestaLinea>
 * devuelta por la AEAT, produciendo el resultado individual determinista de cada registro.
 *
 * POLÍTICA FAIL-CLOSED ESTRICTA:
 * - Prohibido asignar respuestas por posición si los identificadores de factura no coinciden.
 * - Si un registro no puede correlacionarse unívocamente con su <sfR:RespuestaLinea>, lanza AeatResponseCorrelationError.
 */
export function correlateAeatResponseWithRecords(
  firstArg: ReadonlyArray<FiscalRecord> | AeatParsedResponse | undefined,
  secondArg: AeatParsedResponse | ReadonlyArray<FiscalRecord> | undefined,
  submissionStatusOrOptions?: FiscalSubmissionStatus | AeatCorrelationOptions
): FiscalRecordSubmissionResult[] {
  const isFirstArray = Array.isArray(firstArg);
  const records: ReadonlyArray<FiscalRecord> = isFirstArray
    ? (firstArg as ReadonlyArray<FiscalRecord>)
    : (Array.isArray(secondArg) ? (secondArg as ReadonlyArray<FiscalRecord>) : []);
  const parsedResponse: AeatParsedResponse | undefined = isFirstArray
    ? (secondArg as AeatParsedResponse | undefined)
    : (firstArg as AeatParsedResponse | undefined);

  const correlationOptions: AeatCorrelationOptions =
    typeof submissionStatusOrOptions === 'string'
      ? { submissionStatus: submissionStatusOrOptions }
      : (submissionStatusOrOptions || {});

  const submissionStatus: FiscalSubmissionStatus =
    correlationOptions.submissionStatus || parsedResponse?.mappedSubmissionStatus || 'FAILED_TECHNICAL';

  const reconcilingSet: Set<string> = new Set(
    Array.isArray(correlationOptions.reconcilingRecordIds)
      ? correlationOptions.reconcilingRecordIds
      : correlationOptions.reconcilingRecordIds instanceof Set
        ? Array.from(correlationOptions.reconcilingRecordIds)
        : []
  );

  if (!records || records.length === 0) return [];

  // Si hubo fallo técnico global (timeout, HTTP 5xx, SOAP Fault, XML corrupto)
  if (!parsedResponse || parsedResponse.isSoapFault || submissionStatus === 'FAILED_TECHNICAL') {
    const isRetryable = parsedResponse ? parsedResponse.isRetryable : true;
    const errCode = parsedResponse?.fault?.faultcode || parsedResponse?.errores[0]?.codigo;
    const errDesc = parsedResponse?.fault?.faultstring || parsedResponse?.errores[0]?.descripcion;

    return records.map(rec => ({
      fiscalRecordId: rec.id,
      numeroFactura: getRecordCanonicalNumSerie(rec),
      fechaExpedicion: getRecordCanonicalFechaExpedicion(rec),
      tipoRegistro: rec.tipoRegistro,
      estado: 'FAILED_TECHNICAL',
      codigoErrorRegistro: errCode,
      descripcionErrorRegistro: errDesc,
      esReintentable: isRetryable,
      requiereSubsanacion: false
    }));
  }

  const usedLineIndices = new Set<number>();
  const lines = parsedResponse.lineas || [];

  // Si es un lote (>1 registro) o si la respuesta incluye líneas, el cardinal debe coincidir exactamente
  if (records.length > 1 && lines.length !== records.length) {
    throw new AeatResponseCorrelationError(
      `ERROR DE INTEGRIDAD DE RESPUESTA AEAT: El lote envió ${records.length} registros fiscales pero la respuesta contiene ${lines.length} bloques <sfR:RespuestaLinea>. Correlación abortada (Fail-Closed).`
    );
  }

  return records.map((rec) => {
    const recNif = (rec.emisor?.nif || rec.obligadoTributarioId || '').trim().toUpperCase();
    const recNum = getRecordCanonicalNumSerie(rec);
    const recRawNum = (rec.factura.numeroFactura || '').trim();
    const recFecha = getRecordCanonicalFechaExpedicion(rec);
    const recRefExterna = (rec.tipoRegistro === 'anulacion' ? rec.datosAnulacion?.refExterna : rec.factura.refExterna)?.trim();

    // 1. Búsqueda exacta por clave compuesta oficial (IDEmisorFactura + NumSerieFactura + FechaExpedicionFactura)
    let matchedIndex = lines.findIndex((line, lineIdx) => {
      if (usedLineIndices.has(lineIdx)) return false;
      const lineNif = (line.idFactura.idEmisorFactura || '').trim().toUpperCase();
      const lineNum = (line.idFactura.numSerieFactura || '').trim();
      const lineFecha = normalizeDateForAeatCorrelation(line.idFactura.fechaExpedicionFactura);
      const nifMatches = !lineNif || lineNif === recNif;
      const numMatches = lineNum !== '' && (lineNum === recNum || lineNum === recRawNum);
      const fechaMatches = !lineFecha || lineFecha === recFecha;
      return nifMatches && numMatches && fechaMatches;
    });

    // 2. Búsqueda por IDEmisorFactura + NumSerieFactura (si la fecha tenía variación de formato)
    if (matchedIndex === -1) {
      matchedIndex = lines.findIndex((line, lineIdx) => {
        if (usedLineIndices.has(lineIdx)) return false;
        const lineNif = (line.idFactura.idEmisorFactura || '').trim().toUpperCase();
        const lineNum = (line.idFactura.numSerieFactura || '').trim();
        const nifMatches = !lineNif || lineNif === recNif;
        return nifMatches && lineNum !== '' && (lineNum === recNum || lineNum === recRawNum);
      });
    }

    // 3. Búsqueda por RefExterna unívoca si se informó en el registro
    if (matchedIndex === -1 && recRefExterna) {
      matchedIndex = lines.findIndex((line, lineIdx) => {
        if (usedLineIndices.has(lineIdx)) return false;
        return Boolean(line.refExterna && line.refExterna === recRefExterna);
      });
    }

    const matchedLine = matchedIndex !== -1 ? lines[matchedIndex] : undefined;
    if (matchedIndex !== -1) {
      usedLineIndices.add(matchedIndex);
    }

    if (!matchedLine) {
      // Si la respuesta AEAT contiene líneas pero ninguna corresponde a este registro -> FAIL-CLOSED ESTRICTO
      if (lines.length > 0 || records.length > 1) {
        throw new AeatResponseCorrelationError(
          `ERROR DE INTEGRIDAD DE RESPUESTA AEAT: Imposible correlacionar de forma unívoca el registro fiscal '${rec.id}' (factura '${recNum}') con las líneas <sfR:RespuestaLinea> devueltas por la AEAT. Prohibido asignar respuestas por posición (Fail-Closed).`
        );
      }

      // Caso legado exclusivo de envío unitario (1 registro) con respuesta sintética sin <sfR:RespuestaLinea>
      if (parsedResponse.estadoEnvio === 'Correcto' || submissionStatus === 'ACCEPTED') {
        return {
          fiscalRecordId: rec.id,
          numeroFactura: recNum,
          fechaExpedicion: recFecha,
          tipoRegistro: rec.tipoRegistro,
          estado: 'ACCEPTED',
          estadoRegistroAeat: 'Correcto',
          csv: parsedResponse.csv,
          esReintentable: false,
          requiereSubsanacion: false
        };
      }
      return {
        fiscalRecordId: rec.id,
        numeroFactura: recNum,
        fechaExpedicion: recFecha,
        tipoRegistro: rec.tipoRegistro,
        estado: 'REJECTED',
        estadoRegistroAeat: 'Incorrecto',
        codigoErrorRegistro: parsedResponse.errores[0]?.codigo || '1100',
        descripcionErrorRegistro: parsedResponse.errores[0]?.descripcion || 'Sin línea de respuesta en AEAT',
        esReintentable: false,
        requiereSubsanacion: true
      };
    }

    let individualStatus: FiscalRecordSubmissionStatus = 'REJECTED';
    let esReintentable = false;
    let requiereSubsanacion = false;
    let recordCsv: string | undefined = undefined;

    if (matchedLine.estadoRegistro === 'Correcto') {
      individualStatus = 'ACCEPTED';
      recordCsv = parsedResponse.csv;
    } else if (matchedLine.estadoRegistro === 'AceptadoConErrores') {
      individualStatus = 'ACCEPTED_WITH_ERRORS';
      recordCsv = parsedResponse.csv;
    } else if (
      reconcilingSet.has(rec.id) &&
      matchedLine.codigoErrorRegistro === '3000' &&
      matchedLine.registroDuplicado
    ) {
      const dupEstado = String(matchedLine.registroDuplicado.estadoRegistroDuplicado || '').trim();
      const dupIdPeticion = matchedLine.registroDuplicado.idPeticionRegistroDuplicado;
      if (dupEstado === 'Correcta' || dupEstado === 'Correcto') {
        individualStatus = 'ACCEPTED';
        esReintentable = false;
        requiereSubsanacion = false;
        recordCsv = parsedResponse.csv || dupIdPeticion || 'CSV-RECONCILIADO-AEAT';
      } else if (dupEstado === 'AceptadaConErrores' || dupEstado === 'AceptadoConErrores') {
        individualStatus = 'ACCEPTED_WITH_ERRORS';
        esReintentable = false;
        requiereSubsanacion = false;
        recordCsv = parsedResponse.csv || dupIdPeticion || 'CSV-RECONCILIADO-AEAT';
      } else {
        individualStatus = 'REJECTED';
        requiereSubsanacion = true;
      }
    } else {
      individualStatus = 'REJECTED';
      requiereSubsanacion = true;
    }

    return {
      fiscalRecordId: rec.id,
      numeroFactura: recNum,
      fechaExpedicion: recFecha,
      tipoRegistro: rec.tipoRegistro,
      estado: individualStatus,
      estadoRegistroAeat: matchedLine.estadoRegistro,
      codigoErrorRegistro: matchedLine.codigoErrorRegistro,
      descripcionErrorRegistro: matchedLine.descripcionErrorRegistro,
      csv: recordCsv,
      refExterna: matchedLine.refExterna || recRefExterna,
      registroDuplicado: matchedLine.registroDuplicado,
      esReintentable,
      requiereSubsanacion
    };
  });
}
