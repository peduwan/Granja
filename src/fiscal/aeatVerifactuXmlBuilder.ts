/**
 * GENERADOR OFICIAL DE XML AEAT PARA VERI*FACTU / SIF (FASE 2.2)
 *
 * Normativa y Especificaciones Técnicas Oficiales de Referencia:
 * - Ley 11/2021, de 9 de julio, de medidas de prevención y lucha contra el fraude fiscal.
 * - Real Decreto 1007/2023, de 5 de diciembre (Reglamento Veri*Factu / SIF).
 * - Orden HAC/1177/2024, de 17 de octubre (BOE núm. 259, de 28/10/2024).
 * - Esquema XSD Oficial: SuministroLR.xsd (versión 1.0)
 *   Namespace: https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd
 * - Esquema XSD Oficial: SuministroInformacion.xsd (versión 1.0)
 *   Namespace: https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd
 *
 * PRINCIPIOS DE IMPLEMENTACIÓN:
 * 1. Determinismo estricto: Generación directa y ordenada siguiendo la secuencia obligatoria de los XSD.
 * 2. Cero valores artificiales: Si falta un campo obligatorio, se detiene la emisión y se lanza un error de dominio.
 * 3. Escapado seguro: Todo texto libre se sanea contra inyección XML (&, <, >, ", ').
 * 4. Validación de formatos: DD-MM-YYYY para fechas de factura, ISO 8601 para sellado temporal, punto decimal y 2 decimales para importes.
 */

import {
  FiscalRecord,
  DesgloseIvaFiscal,
  PersonaFisicaJuridicaFiscal,
  PersonaFisicaJuridicaIdOtroFiscal
} from './types';
import { formatFechaExpedicionFiscal, formatImporteFiscal } from './hashService';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const AEAT_NAMESPACES = {
  sfLR: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
  sf: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#'
} as const;

export interface XmlBuilderOptions {
  incidencia?: 'S' | 'N';
  fechaFinVeriFactu?: string;
  refRequerimiento?: string;
  finRequerimiento?: 'S' | 'N';
  representante?: {
    nombreRazon: string;
    nif: string;
  };
}

export interface XmlValidationReport {
  valid: boolean;
  errors: string[];
  engine?: string;
}

/**
 * Escapa caracteres especiales XML para garantizar un documento bien formado y seguro.
 */
export function escapeXml(str: string | number | undefined | null): string {
  if (str === undefined || str === null) {
    return '';
  }
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Valida que un NIF cumpla con el tipo XSD sf:NIFType (exactamente 9 caracteres) y rechaza valores ficticios.
 */
function validateNif(nif: string | undefined | null, fieldName: string): string {
  if (!nif || typeof nif !== 'string' || nif.trim() === '') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} es obligatorio y no puede estar vacío.`);
  }
  const clean = nif.trim().toUpperCase();
  if (clean === 'ES_UNKNOWN' || clean === 'UNKNOWN') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} no puede ser un valor artificial ('${clean}').`);
  }
  if (clean.length !== 9) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} ('${clean}') debe tener exactamente 9 caracteres según sf:NIFType (longitud recibida: ${clean.length}).`);
  }
  return clean;
}

/**
 * Valida un campo de texto obligatorio rechazando cadenas vacías o marcadores ficticios.
 */
function validateRequiredString(value: string | undefined | null, fieldName: string, maxLen?: number): string {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} es obligatorio y no puede estar vacío.`);
  }
  const clean = value.trim();
  if (
    clean === 'ES_UNKNOWN' ||
    clean === 'UNKNOWN' ||
    clean === 'PENDING_FASE_2_HASH' ||
    clean === '<pending_xml/>'
  ) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} no puede contener valores ficticios ('${clean}').`);
  }
  if (maxLen && clean.length > maxLen) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} excede la longitud máxima permitida de ${maxLen} caracteres.`);
  }
  return clean;
}

const VALID_ID_OTRO_TYPES = ['02', '03', '04', '05', '06', '07'] as const;

function buildIdOtroXml(
  otro: PersonaFisicaJuridicaIdOtroFiscal,
  indent: string,
  fieldPrefix: string
): string {
  if (!otro.idType || !VALID_ID_OTRO_TYPES.includes(otro.idType as any)) {
    throw new Error(
      `aeatVerifactuXmlBuilder: ${fieldPrefix}.IDType ('${otro.idType}') no es válido. Valores permitidos: ${VALID_ID_OTRO_TYPES.join(', ')}.`
    );
  }
  const idVal = validateRequiredString(otro.id, `${fieldPrefix}.ID`, 20);
  const codigoPais = otro.codigoPais ? otro.codigoPais.trim().toUpperCase() : undefined;

  if (codigoPais && !/^[A-Z]{2}$/.test(codigoPais)) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldPrefix}.CodigoPais ('${codigoPais}') debe ser un código ISO 3166-1 alpha-2 de 2 letras.`);
  }
  if (otro.idType !== '02' && !codigoPais) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldPrefix}.CodigoPais es obligatorio cuando IDType es '${otro.idType}'.`);
  }
  if (codigoPais === 'ES' && otro.idType === '02') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldPrefix} no permite CodigoPais='ES' con IDType='02' (debe utilizarse <sf:NIF>).`);
  }

  const lines: string[] = [];
  lines.push(`${indent}<sf:IDOtro>`);
  if (codigoPais) {
    lines.push(`${indent}  <sf:CodigoPais>${escapeXml(codigoPais)}</sf:CodigoPais>`);
  }
  lines.push(`${indent}  <sf:IDType>${escapeXml(otro.idType)}</sf:IDType>`);
  lines.push(`${indent}  <sf:ID>${escapeXml(idVal)}</sf:ID>`);
  lines.push(`${indent}</sf:IDOtro>`);
  return lines.join('\n');
}

function buildPersonaFisicaJuridicaXml(
  tagName: string,
  person: PersonaFisicaJuridicaFiscal,
  indent: string,
  fieldPrefix: string
): string {
  const nombre = validateRequiredString(person.nombreRazon, `${fieldPrefix}.NombreRazon`, 120);
  const hasNif = Boolean(person.nif && person.nif.trim() !== '');
  const hasIdOtro = Boolean(person.idOtro);

  if (!hasNif && !hasIdOtro) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldPrefix} debe incluir obligatoriamente <sf:NIF> o <sf:IDOtro>.`);
  }
  if (hasNif && hasIdOtro) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldPrefix} no puede incluir simultáneamente <sf:NIF> y <sf:IDOtro> (xs:choice).`);
  }

  const lines: string[] = [];
  lines.push(`${indent}<${tagName}>`);
  lines.push(`${indent}  <sf:NombreRazon>${escapeXml(nombre)}</sf:NombreRazon>`);
  if (hasNif) {
    const nif = validateNif(person.nif, `${fieldPrefix}.NIF`);
    lines.push(`${indent}  <sf:NIF>${escapeXml(nif)}</sf:NIF>`);
  } else if (person.idOtro) {
    lines.push(buildIdOtroXml(person.idOtro, `${indent}  `, `${fieldPrefix}.IDOtro`));
  }
  lines.push(`${indent}</${tagName}>`);
  return lines.join('\n');
}

/**
 * Construye la sección <sfLR:Cabecera> según sf:CabeceraType.
 */
export function buildCabeceraXml(
  record: FiscalRecord,
  options?: XmlBuilderOptions
): string {
  const emisorNif = validateNif(record.emisor.nif, 'Cabecera.ObligadoEmision.NIF');
  const emisorNombre = validateRequiredString(record.emisor.nombreRazon, 'Cabecera.ObligadoEmision.NombreRazon', 120);

  const lines: string[] = [];
  lines.push('  <sfLR:Cabecera>');
  lines.push('    <sf:ObligadoEmision>');
  lines.push(`      <sf:NombreRazon>${escapeXml(emisorNombre)}</sf:NombreRazon>`);
  lines.push(`      <sf:NIF>${escapeXml(emisorNif)}</sf:NIF>`);
  lines.push('    </sf:ObligadoEmision>');

  if (options?.representante) {
    const repNombre = validateRequiredString(options.representante.nombreRazon, 'Cabecera.Representante.NombreRazon', 120);
    const repNif = validateNif(options.representante.nif, 'Cabecera.Representante.NIF');
    lines.push('    <sf:Representante>');
    lines.push(`      <sf:NombreRazon>${escapeXml(repNombre)}</sf:NombreRazon>`);
    lines.push(`      <sf:NIF>${escapeXml(repNif)}</sf:NIF>`);
    lines.push('    </sf:Representante>');
  }

  if (record.modoFiscal === 'VERI_FACTU') {
    lines.push('    <sf:RemisionVoluntaria>');
    if (options?.fechaFinVeriFactu) {
      const fechaFin = formatFechaExpedicionFiscal(options.fechaFinVeriFactu);
      lines.push(`      <sf:FechaFinVeriFactu>${escapeXml(fechaFin)}</sf:FechaFinVeriFactu>`);
    }
    if (options?.incidencia) {
      if (options.incidencia !== 'S' && options.incidencia !== 'N') {
        throw new Error(`aeatVerifactuXmlBuilder: Cabecera.RemisionVoluntaria.Incidencia inválida ('${options.incidencia}').`);
      }
      lines.push(`      <sf:Incidencia>${options.incidencia}</sf:Incidencia>`);
    } else {
      lines.push('      <sf:Incidencia>N</sf:Incidencia>');
    }
    lines.push('    </sf:RemisionVoluntaria>');
  }

  if (options?.refRequerimiento) {
    const refReq = validateRequiredString(options.refRequerimiento, 'Cabecera.RemisionRequerimiento.RefRequerimiento', 18);
    lines.push('    <sf:RemisionRequerimiento>');
    lines.push(`      <sf:RefRequerimiento>${escapeXml(refReq)}</sf:RefRequerimiento>`);
    if (options.finRequerimiento) {
      if (options.finRequerimiento !== 'S' && options.finRequerimiento !== 'N') {
        throw new Error(`aeatVerifactuXmlBuilder: Cabecera.RemisionRequerimiento.FinRequerimiento inválido ('${options.finRequerimiento}').`);
      }
      lines.push(`      <sf:FinRequerimiento>${options.finRequerimiento}</sf:FinRequerimiento>`);
    }
    lines.push('    </sf:RemisionRequerimiento>');
  }

  lines.push('  </sfLR:Cabecera>');
  return lines.join('\n');
}

/**
 * Construye la sección <sf:Encadenamiento> para RegistroAlta o RegistroAnulacion.
 */
function buildEncadenamientoXml(record: FiscalRecord): string {
  const { encadenamiento } = record;
  const lines: string[] = [];
  lines.push('      <sf:Encadenamiento>');

  if (encadenamiento.primerRegistro) {
    if (encadenamiento.registroAnterior) {
      throw new Error('aeatVerifactuXmlBuilder: encadenamiento.primerRegistro es true pero también contiene registroAnterior (violación de xs:choice).');
    }
    lines.push('        <sf:PrimerRegistro>S</sf:PrimerRegistro>');
  } else {
    const prev = encadenamiento.registroAnterior;
    if (!prev) {
      throw new Error('aeatVerifactuXmlBuilder: encadenamiento.primerRegistro es false pero no existe registroAnterior.');
    }
    const prevNif = validateNif(prev.idEmisorFactura, 'Encadenamiento.RegistroAnterior.IDEmisorFactura');
    const prevNum = validateRequiredString(prev.numSerieFactura, 'Encadenamiento.RegistroAnterior.NumSerieFactura', 60);
    const prevFecha = formatFechaExpedicionFiscal(prev.fechaExpedicionFactura);
    const prevHuella = validateRequiredString(prev.huella, 'Encadenamiento.RegistroAnterior.Huella');
    if (prevHuella.length !== 64 || !/^[0-9A-Fa-f]{64}$/.test(prevHuella)) {
      throw new Error(`aeatVerifactuXmlBuilder: Huella del registro anterior inválida (${prevHuella.length} caracteres, se requieren 64 hexadecimales).`);
    }

    lines.push('        <sf:RegistroAnterior>');
    lines.push(`          <sf:IDEmisorFactura>${escapeXml(prevNif)}</sf:IDEmisorFactura>`);
    lines.push(`          <sf:NumSerieFactura>${escapeXml(prevNum)}</sf:NumSerieFactura>`);
    lines.push(`          <sf:FechaExpedicionFactura>${escapeXml(prevFecha)}</sf:FechaExpedicionFactura>`);
    lines.push(`          <sf:Huella>${escapeXml(prevHuella.toUpperCase())}</sf:Huella>`);
    lines.push('        </sf:RegistroAnterior>');
  }

  lines.push('      </sf:Encadenamiento>');
  return lines.join('\n');
}

/**
 * Construye la sección <sf:SistemaInformatico> según sf:SistemaInformaticoType.
 */
function buildSistemaInformaticoXml(record: FiscalRecord): string {
  const sif = record.sistemaInformatico;
  if (!sif) {
    throw new Error('aeatVerifactuXmlBuilder: Bloque sistemaInformatico ausente en FiscalRecord.');
  }

  const nombreRazon = validateRequiredString(sif.nombreRazon, 'SistemaInformatico.NombreRazon', 120);
  const hasNif = Boolean(sif.nif && sif.nif.trim() !== '');
  const hasIdOtro = Boolean(sif.idOtro);
  if (!hasNif && !hasIdOtro) {
    throw new Error('aeatVerifactuXmlBuilder: SistemaInformatico debe incluir obligatoriamente NIF o IDOtro.');
  }
  if (hasNif && hasIdOtro) {
    throw new Error('aeatVerifactuXmlBuilder: SistemaInformatico no puede incluir simultáneamente NIF e IDOtro.');
  }

  const nombreSif = validateRequiredString(sif.nombreSistemaInformatico, 'SistemaInformatico.NombreSistemaInformatico', 30);
  const idSif = validateRequiredString(sif.idSistemaInformatico, 'SistemaInformatico.IdSistemaInformatico', 2);
  const version = validateRequiredString(sif.version, 'SistemaInformatico.Version', 50);
  const numeroInstalacion = validateRequiredString(sif.numeroInstalacion, 'SistemaInformatico.NumeroInstalacion', 100);
  const soloVerifactu = sif.tipoUsoPosibleSoloVerifactu || (record.modoFiscal === 'VERI_FACTU' ? 'S' : 'N');
  const multiOT = sif.tipoUsoPosibleMultiOT || 'N';
  const indicadorMultiOT = sif.indicadorMultiplesOT || 'N';

  if (soloVerifactu !== 'S' && soloVerifactu !== 'N') {
    throw new Error(`aeatVerifactuXmlBuilder: SistemaInformatico.TipoUsoPosibleSoloVerifactu inválido ('${soloVerifactu}').`);
  }
  if (multiOT !== 'S' && multiOT !== 'N') {
    throw new Error(`aeatVerifactuXmlBuilder: SistemaInformatico.TipoUsoPosibleMultiOT inválido ('${multiOT}').`);
  }
  if (indicadorMultiOT !== 'S' && indicadorMultiOT !== 'N') {
    throw new Error(`aeatVerifactuXmlBuilder: SistemaInformatico.IndicadorMultiplesOT inválido ('${indicadorMultiOT}').`);
  }

  const lines: string[] = [];
  lines.push('      <sf:SistemaInformatico>');
  lines.push(`        <sf:NombreRazon>${escapeXml(nombreRazon)}</sf:NombreRazon>`);
  if (hasNif) {
    const nif = validateNif(sif.nif, 'SistemaInformatico.NIF');
    lines.push(`        <sf:NIF>${escapeXml(nif)}</sf:NIF>`);
  } else if (sif.idOtro) {
    lines.push(buildIdOtroXml(sif.idOtro, '        ', 'SistemaInformatico.IDOtro'));
  }
  lines.push(`        <sf:NombreSistemaInformatico>${escapeXml(nombreSif)}</sf:NombreSistemaInformatico>`);
  lines.push(`        <sf:IdSistemaInformatico>${escapeXml(idSif)}</sf:IdSistemaInformatico>`);
  lines.push(`        <sf:Version>${escapeXml(version)}</sf:Version>`);
  lines.push(`        <sf:NumeroInstalacion>${escapeXml(numeroInstalacion)}</sf:NumeroInstalacion>`);
  lines.push(`        <sf:TipoUsoPosibleSoloVerifactu>${soloVerifactu}</sf:TipoUsoPosibleSoloVerifactu>`);
  lines.push(`        <sf:TipoUsoPosibleMultiOT>${multiOT}</sf:TipoUsoPosibleMultiOT>`);
  lines.push(`        <sf:IndicadorMultiplesOT>${indicadorMultiOT}</sf:IndicadorMultiplesOT>`);
  lines.push('      </sf:SistemaInformatico>');

  return lines.join('\n');
}

const VALID_CLAVES_REGIMEN = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11',
  '14', '15', '17', '18', '19', '20', '21'
] as const;

/**
 * Construye la sección <sf:Desglose> según sf:DesgloseType y sf:DetalleType.
 */
function buildDesgloseXml(desgloseIVA: readonly DesgloseIvaFiscal[]): string {
  if (!desgloseIVA || desgloseIVA.length === 0) {
    throw new Error('aeatVerifactuXmlBuilder: Desglose tributario ausente. El registro debe contener al menos un DetalleDesglose.');
  }
  if (desgloseIVA.length > 12) {
    throw new Error(`aeatVerifactuXmlBuilder: El desglose contiene ${desgloseIVA.length} líneas, superando el máximo de 12 permitido por el XSD.`);
  }

  const lines: string[] = [];
  lines.push('      <sf:Desglose>');

  for (let idx = 0; idx < desgloseIVA.length; idx++) {
    const item = desgloseIVA[idx];
    const impuesto = item.impuesto || '01'; // 01 = IVA
    if (!['01', '02', '03', '05'].includes(impuesto)) {
      throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: Impuesto '${impuesto}' no válido.`);
    }

    const claveRegimen = item.claveRegimen || '01'; // 01 = Régimen general
    if (!VALID_CLAVES_REGIMEN.includes(claveRegimen as any)) {
      throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: ClaveRegimen '${claveRegimen}' no válida.`);
    }

    if (item.calificacionOperacion && item.operacionExenta) {
      throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: No puede incluir simultáneamente CalificacionOperacion y OperacionExenta (xs:choice).`);
    }

    const isExenta = Boolean(item.operacionExenta);
    const calificacion = isExenta ? undefined : (item.calificacionOperacion || 'S1');

    if (isExenta && !['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'].includes(item.operacionExenta!)) {
      throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: OperacionExenta '${item.operacionExenta}' no válida.`);
    }
    if (calificacion && !['S1', 'S2', 'N1', 'N2'].includes(calificacion)) {
      throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: CalificacionOperacion '${calificacion}' no válida.`);
    }

    const isNoSujeta = calificacion === 'N1' || calificacion === 'N2';
    const base = formatImporteFiscal(item.baseImponible);

    lines.push('        <sf:DetalleDesglose>');
    lines.push(`          <sf:Impuesto>${escapeXml(impuesto)}</sf:Impuesto>`);
    lines.push(`          <sf:ClaveRegimen>${escapeXml(claveRegimen)}</sf:ClaveRegimen>`);

    if (isExenta) {
      lines.push(`          <sf:OperacionExenta>${escapeXml(item.operacionExenta)}</sf:OperacionExenta>`);
    } else {
      lines.push(`          <sf:CalificacionOperacion>${escapeXml(calificacion)}</sf:CalificacionOperacion>`);
    }

    if (isExenta || isNoSujeta) {
      if (item.tipoImpositivo !== undefined && item.tipoImpositivo !== 0) {
        throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: Las operaciones exentas o no sujetas no admiten TipoImpositivo distinto de 0.`);
      }
      if (item.cuotaRepercutida !== undefined && item.cuotaRepercutida !== 0) {
        throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: Las operaciones exentas o no sujetas no admiten CuotaRepercutida distinta de 0.`);
      }
    } else {
      if (item.tipoImpositivo !== undefined) {
        if (item.tipoImpositivo < 0 || item.tipoImpositivo > 999.99) {
          throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: TipoImpositivo fuera de rango sf:Tipo2.2Type (${item.tipoImpositivo}).`);
        }
        lines.push(`          <sf:TipoImpositivo>${escapeXml(Number(item.tipoImpositivo).toFixed(2))}</sf:TipoImpositivo>`);
      }
    }

    lines.push(`          <sf:BaseImponibleOimporteNoSujeto>${escapeXml(base)}</sf:BaseImponibleOimporteNoSujeto>`);

    if (item.baseImponibleACoste !== undefined) {
      lines.push(`          <sf:BaseImponibleACoste>${escapeXml(formatImporteFiscal(item.baseImponibleACoste))}</sf:BaseImponibleACoste>`);
    }

    if (!isExenta && !isNoSujeta) {
      const cuota = formatImporteFiscal(item.cuotaRepercutida ?? 0);
      lines.push(`          <sf:CuotaRepercutida>${escapeXml(cuota)}</sf:CuotaRepercutida>`);
    }

    if (item.tipoRecargoEquivalencia !== undefined && item.tipoRecargoEquivalencia > 0) {
      if (isExenta || isNoSujeta) {
        throw new Error(`aeatVerifactuXmlBuilder: DetalleDesglose #${idx + 1}: Las operaciones exentas o no sujetas no admiten Recargo de Equivalencia.`);
      }
      lines.push(`          <sf:TipoRecargoEquivalencia>${escapeXml(item.tipoRecargoEquivalencia.toFixed(2))}</sf:TipoRecargoEquivalencia>`);
      const cuotaRec = formatImporteFiscal(item.cuotaRecargoEquivalencia ?? 0);
      lines.push(`          <sf:CuotaRecargoEquivalencia>${escapeXml(cuotaRec)}</sf:CuotaRecargoEquivalencia>`);
    }

    lines.push('        </sf:DetalleDesglose>');
  }

  lines.push('      </sf:Desglose>');
  return lines.join('\n');
}

/**
 * Construye el elemento <sf:RegistroAlta> conforme al tipo sf:RegistroFacturacionAltaType.
 * El orden estricto de xs:sequence y las reglas funcionales AEAT (F1, F2, F3, R1-R5) se verifican campo por campo.
 */
export function buildRegistroAltaXml(record: FiscalRecord): string {
  if (record.tipoRegistro !== 'alta') {
    throw new Error(`buildRegistroAltaXml: Tipo de registro no es 'alta' (recibido '${record.tipoRegistro}').`);
  }

  const emisorNif = validateNif(record.emisor.nif, 'RegistroAlta.IDFactura.IDEmisorFactura');
  const numeroFactura = validateRequiredString(record.factura.numeroFactura, 'RegistroAlta.IDFactura.NumSerieFactura', 60);
  const fechaExpedicion = formatFechaExpedicionFiscal(record.factura.fechaExpedicion);
  const nombreRazonEmisor = validateRequiredString(record.emisor.nombreRazon, 'RegistroAlta.NombreRazonEmisor', 120);
  const descripcionOperacion = validateRequiredString(record.factura.descripcionOperacion, 'RegistroAlta.DescripcionOperacion', 500);

  const tipoFactura = record.factura.tipoFactura || 'F1';
  if (!['F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'].includes(tipoFactura)) {
    throw new Error(`buildRegistroAltaXml: TipoFactura '${tipoFactura}' no pertenece a la enumeración oficial sf:ClaveTipoFacturaType.`);
  }

  const isRectificativaType = ['R1', 'R2', 'R3', 'R4', 'R5'].includes(tipoFactura);
  const isSimplifiedType = tipoFactura === 'F2' || tipoFactura === 'R5';

  // Validación funcional de coherencia entre TipoFactura y datosRectificativa
  if (isRectificativaType) {
    if (!record.datosRectificativa) {
      throw new Error(`buildRegistroAltaXml: Las facturas rectificativas (${tipoFactura}) requieren obligatoriamente el bloque datosRectificativa con TipoRectificativa ('S' o 'I').`);
    }
    const tr = record.datosRectificativa.tipoRectificativa;
    if (tr !== 'S' && tr !== 'I') {
      throw new Error(`buildRegistroAltaXml: TipoRectificativa ('${tr}') es obligatorio para ${tipoFactura} y debe ser 'S' (sustitución) o 'I' (diferencias).`);
    }
    if (tr === 'S' && !record.datosRectificativa.importeRectificacion) {
      throw new Error(`buildRegistroAltaXml: Para facturas rectificativas por sustitución (${tipoFactura} con TipoRectificativa='S') es obligatorio informar ImporteRectificacion (BaseRectificada y CuotaRectificada).`);
    }
    if (tr === 'I' && record.datosRectificativa.importeRectificacion) {
      throw new Error(`buildRegistroAltaXml: Para facturas rectificativas por diferencias (${tipoFactura} con TipoRectificativa='I') está prohibido incluir ImporteRectificacion.`);
    }
  } else {
    if (record.datosRectificativa) {
      throw new Error(`buildRegistroAltaXml: Las facturas no rectificativas (${tipoFactura}) no pueden incluir campos de rectificación (TipoRectificativa, FacturasRectificadas, ImporteRectificacion).`);
    }
  }

  if (record.factura.facturasSustituidas && record.factura.facturasSustituidas.length > 0 && tipoFactura !== 'F3') {
    throw new Error(`buildRegistroAltaXml: El bloque FacturasSustituidas solo está permitido cuando TipoFactura es 'F3' (recibido '${tipoFactura}').`);
  }

  // Resolver lista de destinatarios
  const recipientsList: PersonaFisicaJuridicaFiscal[] = [];
  if (record.destinatarios && record.destinatarios.length > 0) {
    for (const d of record.destinatarios) {
      recipientsList.push(d);
    }
  } else if (
    record.destinatario &&
    (record.destinatario.nif || record.destinatario.idOtro || record.destinatario.nombreRazon)
  ) {
    recipientsList.push({
      nombreRazon: record.destinatario.nombreRazon || '',
      nif: record.destinatario.nif,
      codigoPais: record.destinatario.codigoPais,
      idOtro: record.destinatario.idOtro
    });
  }

  if (isSimplifiedType) {
    if (recipientsList.length > 0) {
      throw new Error(`buildRegistroAltaXml: Las facturas simplificadas sin identificación de destinatario (${tipoFactura}) no deben incluir el bloque <sf:Destinatarios>.`);
    }
  } else {
    // F1, F3, R1, R2, R3, R4 requieren obligatoriamente Destinatarios salvo que F1 declare explícitamente FacturaSinIdentifDestinatarioArt61d='S'
    const allowNoRecipient = tipoFactura === 'F1' && record.factura.facturaSinIdentifDestinatarioArt61d === 'S';
    if (recipientsList.length === 0 && !allowNoRecipient) {
      throw new Error(`buildRegistroAltaXml: Las facturas de tipo ${tipoFactura} requieren obligatoriamente al menos un destinatario identificado en <sf:Destinatarios>.`);
    }
    if (recipientsList.length > 1000) {
      throw new Error(`buildRegistroAltaXml: Se superó el máximo de 1000 destinatarios permitido por el XSD (recibidos: ${recipientsList.length}).`);
    }
  }

  const lines: string[] = [];
  lines.push('    <sf:RegistroAlta>');

  // 1. IDVersion (fijo 1.0)
  lines.push('      <sf:IDVersion>1.0</sf:IDVersion>');

  // 2. IDFactura
  lines.push('      <sf:IDFactura>');
  lines.push(`        <sf:IDEmisorFactura>${escapeXml(emisorNif)}</sf:IDEmisorFactura>`);
  lines.push(`        <sf:NumSerieFactura>${escapeXml(numeroFactura)}</sf:NumSerieFactura>`);
  lines.push(`        <sf:FechaExpedicionFactura>${escapeXml(fechaExpedicion)}</sf:FechaExpedicionFactura>`);
  lines.push('      </sf:IDFactura>');

  // 3. RefExterna (opcional, TextMax60Type)
  if (record.factura.refExterna) {
    const refExt = validateRequiredString(record.factura.refExterna, 'RegistroAlta.RefExterna', 60);
    lines.push(`      <sf:RefExterna>${escapeXml(refExt)}</sf:RefExterna>`);
  }

  // 4. NombreRazonEmisor
  lines.push(`      <sf:NombreRazonEmisor>${escapeXml(nombreRazonEmisor)}</sf:NombreRazonEmisor>`);

  // 5. Subsanacion (opcional, 'S' | 'N')
  if (record.factura.subsanacion) {
    if (record.factura.subsanacion !== 'S' && record.factura.subsanacion !== 'N') {
      throw new Error(`buildRegistroAltaXml: Subsanacion inválida ('${record.factura.subsanacion}').`);
    }
    lines.push(`      <sf:Subsanacion>${record.factura.subsanacion}</sf:Subsanacion>`);
  }

  // 6. RechazoPrevio (opcional, 'N' | 'S' | 'X')
  if (record.factura.rechazoPrevio) {
    if (!['N', 'S', 'X'].includes(record.factura.rechazoPrevio)) {
      throw new Error(`buildRegistroAltaXml: RechazoPrevio inválido ('${record.factura.rechazoPrevio}').`);
    }
    lines.push(`      <sf:RechazoPrevio>${record.factura.rechazoPrevio}</sf:RechazoPrevio>`);
  }

  // 7. TipoFactura (F1, F2, F3, R1, R2, R3, R4, R5)
  lines.push(`      <sf:TipoFactura>${escapeXml(tipoFactura)}</sf:TipoFactura>`);

  // 8, 9, 10, 11. Campos de Rectificativa y Sustitución en orden xs:sequence
  if (record.datosRectificativa) {
    const tipoRect = record.datosRectificativa.tipoRectificativa;
    lines.push(`      <sf:TipoRectificativa>${escapeXml(tipoRect)}</sf:TipoRectificativa>`);

    // FacturasRectificadas (opcional en XSD, máx 1000)
    if (record.datosRectificativa.facturasRectificadas && record.datosRectificativa.facturasRectificadas.length > 0) {
      if (record.datosRectificativa.facturasRectificadas.length > 1000) {
        throw new Error('buildRegistroAltaXml: FacturasRectificadas supera el máximo de 1000 elementos.');
      }
      lines.push('      <sf:FacturasRectificadas>');
      for (const fr of record.datosRectificativa.facturasRectificadas) {
        const frEmisor = fr.idEmisorFactura ? validateNif(fr.idEmisorFactura, 'FacturaRectificada.IDEmisorFactura') : emisorNif;
        const frNum = validateRequiredString(fr.numeroFactura, 'FacturaRectificada.NumSerieFactura', 60);
        const frFecha = formatFechaExpedicionFiscal(fr.fechaExpedicion);
        lines.push('        <sf:IDFacturaRectificada>');
        lines.push(`          <sf:IDEmisorFactura>${escapeXml(frEmisor)}</sf:IDEmisorFactura>`);
        lines.push(`          <sf:NumSerieFactura>${escapeXml(frNum)}</sf:NumSerieFactura>`);
        lines.push(`          <sf:FechaExpedicionFactura>${escapeXml(frFecha)}</sf:FechaExpedicionFactura>`);
        lines.push('        </sf:IDFacturaRectificada>');
      }
      lines.push('      </sf:FacturasRectificadas>');
    }
  }

  // FacturasSustituidas (para F3, en posición exacta entre FacturasRectificadas e ImporteRectificacion)
  if (record.factura.facturasSustituidas && record.factura.facturasSustituidas.length > 0) {
    if (record.factura.facturasSustituidas.length > 1000) {
      throw new Error('buildRegistroAltaXml: FacturasSustituidas supera el máximo de 1000 elementos.');
    }
    lines.push('      <sf:FacturasSustituidas>');
    for (const fsItem of record.factura.facturasSustituidas) {
      const fsEmisor = fsItem.idEmisorFactura ? validateNif(fsItem.idEmisorFactura, 'FacturaSustituida.IDEmisorFactura') : emisorNif;
      const fsNum = validateRequiredString(fsItem.numeroFactura, 'FacturaSustituida.NumSerieFactura', 60);
      const fsFecha = formatFechaExpedicionFiscal(fsItem.fechaExpedicion);
      lines.push('        <sf:IDFacturaSustituida>');
      lines.push(`          <sf:IDEmisorFactura>${escapeXml(fsEmisor)}</sf:IDEmisorFactura>`);
      lines.push(`          <sf:NumSerieFactura>${escapeXml(fsNum)}</sf:NumSerieFactura>`);
      lines.push(`          <sf:FechaExpedicionFactura>${escapeXml(fsFecha)}</sf:FechaExpedicionFactura>`);
      lines.push('        </sf:IDFacturaSustituida>');
    }
    lines.push('      </sf:FacturasSustituidas>');
  }

  // ImporteRectificacion (para TipoRectificativa === 'S')
  if (record.datosRectificativa?.importeRectificacion) {
    const imp = record.datosRectificativa.importeRectificacion;
    lines.push('      <sf:ImporteRectificacion>');
    lines.push(`        <sf:BaseRectificada>${formatImporteFiscal(imp.baseRectificada)}</sf:BaseRectificada>`);
    lines.push(`        <sf:CuotaRectificada>${formatImporteFiscal(imp.cuotaRectificada)}</sf:CuotaRectificada>`);
    if (imp.cuotaRecargoRectificado !== undefined) {
      lines.push(`        <sf:CuotaRecargoRectificado>${formatImporteFiscal(imp.cuotaRecargoRectificado)}</sf:CuotaRecargoRectificado>`);
    }
    lines.push('      </sf:ImporteRectificacion>');
  }

  // 12. FechaOperacion (opcional, DD-MM-YYYY)
  if (record.factura.fechaOperacion) {
    const fechaOp = formatFechaExpedicionFiscal(record.factura.fechaOperacion);
    lines.push(`      <sf:FechaOperacion>${escapeXml(fechaOp)}</sf:FechaOperacion>`);
  }

  // 13. DescripcionOperacion
  lines.push(`      <sf:DescripcionOperacion>${escapeXml(descripcionOperacion)}</sf:DescripcionOperacion>`);

  // 14. FacturaSimplificadaArt7273 (opcional)
  if (record.factura.facturaSimplificadaArt7273 === 'S') {
    lines.push('      <sf:FacturaSimplificadaArt7273>S</sf:FacturaSimplificadaArt7273>');
  }

  // 15. FacturaSinIdentifDestinatarioArt61d (opcional)
  if (record.factura.facturaSinIdentifDestinatarioArt61d === 'S') {
    lines.push('      <sf:FacturaSinIdentifDestinatarioArt61d>S</sf:FacturaSinIdentifDestinatarioArt61d>');
  }

  // 16. Macrodato (opcional)
  if (record.factura.macrodato === 'S') {
    lines.push('      <sf:Macrodato>S</sf:Macrodato>');
  }

  // 17. EmitidaPorTerceroODestinatario (opcional: nombre exacto en XSD sin 's' en Tercero)
  if (record.factura.emitidaPorTerceroODestinatario) {
    const emTerc = record.factura.emitidaPorTerceroODestinatario;
    if (emTerc !== 'T' && emTerc !== 'D') {
      throw new Error(`buildRegistroAltaXml: EmitidaPorTerceroODestinatario inválido ('${emTerc}').`);
    }
    if (emTerc === 'T' && !record.tercero) {
      throw new Error("buildRegistroAltaXml: Cuando EmitidaPorTerceroODestinatario es 'T', el bloque <sf:Tercero> es obligatorio.");
    }
    lines.push(`      <sf:EmitidaPorTerceroODestinatario>${emTerc}</sf:EmitidaPorTerceroODestinatario>`);
  }

  // 18. Tercero (opcional)
  if (record.tercero) {
    lines.push(buildPersonaFisicaJuridicaXml('sf:Tercero', record.tercero, '      ', 'RegistroAlta.Tercero'));
  }

  // 19. Destinatarios
  if (recipientsList.length > 0) {
    lines.push('      <sf:Destinatarios>');
    for (let i = 0; i < recipientsList.length; i++) {
      lines.push(
        buildPersonaFisicaJuridicaXml(
          'sf:IDDestinatario',
          recipientsList[i],
          '        ',
          `RegistroAlta.Destinatarios.IDDestinatario[${i}]`
        )
      );
    }
    lines.push('      </sf:Destinatarios>');
  }

  // 20. Cupon (opcional)
  if (record.factura.cupon) {
    if (record.factura.cupon !== 'S' && record.factura.cupon !== 'N') {
      throw new Error(`buildRegistroAltaXml: Cupon inválido ('${record.factura.cupon}').`);
    }
    lines.push(`      <sf:Cupon>${record.factura.cupon}</sf:Cupon>`);
  }

  // 21. Desglose
  lines.push(buildDesgloseXml(record.desgloseTributario.desgloseIVA));

  // 22. CuotaTotal
  const cuotaTotalNum = (record.desgloseTributario.cuotaTotal ?? 0) + (record.desgloseTributario.cuotaRecargoTotal ?? 0);
  lines.push(`      <sf:CuotaTotal>${formatImporteFiscal(cuotaTotalNum)}</sf:CuotaTotal>`);

  // 23. ImporteTotal
  const importeTotalNum = record.desgloseTributario.importeTotal;
  lines.push(`      <sf:ImporteTotal>${formatImporteFiscal(importeTotalNum)}</sf:ImporteTotal>`);

  // 24. Encadenamiento
  lines.push(buildEncadenamientoXml(record));

  // 25. SistemaInformatico
  lines.push(buildSistemaInformaticoXml(record));

  // 26. FechaHoraHusoGenRegistro
  const fechaHora = validateRequiredString(record.fechaHoraHusoGenRegistro, 'RegistroAlta.FechaHoraHusoGenRegistro');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(fechaHora)) {
    throw new Error(`buildRegistroAltaXml: FechaHoraHusoGenRegistro ('${fechaHora}') debe cumplir formato ISO 8601 con huso horario.`);
  }
  lines.push(`      <sf:FechaHoraHusoGenRegistro>${escapeXml(fechaHora)}</sf:FechaHoraHusoGenRegistro>`);

  // 27. NumRegistroAcuerdoFacturacion (opcional, TextMax15Type)
  if (record.factura.numRegistroAcuerdoFacturacion) {
    const numAcuerdo = validateRequiredString(record.factura.numRegistroAcuerdoFacturacion, 'RegistroAlta.NumRegistroAcuerdoFacturacion', 15);
    lines.push(`      <sf:NumRegistroAcuerdoFacturacion>${escapeXml(numAcuerdo)}</sf:NumRegistroAcuerdoFacturacion>`);
  }

  // 28. IdAcuerdoSistemaInformatico (opcional, TextMax16Type)
  if (record.factura.idAcuerdoSistemaInformatico) {
    const idAcuerdo = validateRequiredString(record.factura.idAcuerdoSistemaInformatico, 'RegistroAlta.IdAcuerdoSistemaInformatico', 16);
    lines.push(`      <sf:IdAcuerdoSistemaInformatico>${escapeXml(idAcuerdo)}</sf:IdAcuerdoSistemaInformatico>`);
  }

  // 29. TipoHuella (fijo 01 para SHA-256)
  lines.push('      <sf:TipoHuella>01</sf:TipoHuella>');

  // 30. Huella (SHA-256 en mayúsculas de 64 caracteres)
  const huella = validateRequiredString(record.huella.hash, 'RegistroAlta.Huella');
  if (huella.length !== 64 || !/^[0-9A-Fa-f]{64}$/.test(huella)) {
    throw new Error(`aeatVerifactuXmlBuilder: Longitud de huella inválida (${huella.length} caracteres, deben ser 64 hexadecimales).`);
  }
  lines.push(`      <sf:Huella>${escapeXml(huella.toUpperCase())}</sf:Huella>`);

  lines.push('    </sf:RegistroAlta>');
  return lines.join('\n');
}

/**
 * Construye el elemento <sf:RegistroAnulacion> conforme al tipo sf:RegistroFacturacionAnulacionType.
 * El orden estricto de xs:sequence es verificado campo por campo.
 */
export function buildRegistroAnulacionXml(record: FiscalRecord): string {
  if (record.tipoRegistro !== 'anulacion') {
    throw new Error(`buildRegistroAnulacionXml: Tipo de registro no es 'anulacion' (recibido '${record.tipoRegistro}').`);
  }
  if (!record.datosAnulacion) {
    throw new Error('buildRegistroAnulacionXml: Bloque datosAnulacion ausente en FiscalRecord de anulación.');
  }

  const emisorNif = validateNif(record.emisor.nif, 'RegistroAnulacion.IDFactura.IDEmisorFacturaAnulada');
  const numAnulada = validateRequiredString(record.datosAnulacion.numeroFacturaAnulada, 'RegistroAnulacion.IDFactura.NumSerieFacturaAnulada', 60);
  const fechaAnulada = formatFechaExpedicionFiscal(record.datosAnulacion.fechaExpedicionFacturaAnulada);

  const lines: string[] = [];
  lines.push('    <sf:RegistroAnulacion>');

  // 1. IDVersion (fijo 1.0)
  lines.push('      <sf:IDVersion>1.0</sf:IDVersion>');

  // 2. IDFactura (tipo IDFacturaExpedidaBajaType)
  lines.push('      <sf:IDFactura>');
  lines.push(`        <sf:IDEmisorFacturaAnulada>${escapeXml(emisorNif)}</sf:IDEmisorFacturaAnulada>`);
  lines.push(`        <sf:NumSerieFacturaAnulada>${escapeXml(numAnulada)}</sf:NumSerieFacturaAnulada>`);
  lines.push(`        <sf:FechaExpedicionFacturaAnulada>${escapeXml(fechaAnulada)}</sf:FechaExpedicionFacturaAnulada>`);
  lines.push('      </sf:IDFactura>');

  // 3. RefExterna (opcional, TextMax60Type)
  if (record.datosAnulacion.refExterna) {
    const refExt = validateRequiredString(record.datosAnulacion.refExterna, 'RegistroAnulacion.RefExterna', 60);
    lines.push(`      <sf:RefExterna>${escapeXml(refExt)}</sf:RefExterna>`);
  }

  // 4. SinRegistroPrevio (opcional, 'S' | 'N')
  if (record.datosAnulacion.sinRegistroPrevio) {
    if (record.datosAnulacion.sinRegistroPrevio !== 'S' && record.datosAnulacion.sinRegistroPrevio !== 'N') {
      throw new Error(`buildRegistroAnulacionXml: SinRegistroPrevio inválido ('${record.datosAnulacion.sinRegistroPrevio}').`);
    }
    lines.push(`      <sf:SinRegistroPrevio>${record.datosAnulacion.sinRegistroPrevio}</sf:SinRegistroPrevio>`);
  }

  // 5. RechazoPrevio (opcional, 'S' | 'N')
  if (record.datosAnulacion.rechazoPrevio) {
    if (record.datosAnulacion.rechazoPrevio !== 'S' && record.datosAnulacion.rechazoPrevio !== 'N') {
      throw new Error(`buildRegistroAnulacionXml: RechazoPrevio inválido ('${record.datosAnulacion.rechazoPrevio}').`);
    }
    lines.push(`      <sf:RechazoPrevio>${record.datosAnulacion.rechazoPrevio}</sf:RechazoPrevio>`);
  }

  // 6. GeneradoPor (opcional, 'E' | 'D' | 'T')
  if (record.datosAnulacion.generadoPor) {
    const genPor = record.datosAnulacion.generadoPor;
    if (!['E', 'D', 'T'].includes(genPor)) {
      throw new Error(`buildRegistroAnulacionXml: GeneradoPor inválido ('${genPor}').`);
    }
    if ((genPor === 'D' || genPor === 'T') && !record.datosAnulacion.generador) {
      throw new Error(`buildRegistroAnulacionXml: Cuando GeneradoPor es '${genPor}', el bloque <sf:Generador> es obligatorio.`);
    }
    lines.push(`      <sf:GeneradoPor>${genPor}</sf:GeneradoPor>`);
  }

  // 7. Generador (opcional, PersonaFisicaJuridicaType)
  if (record.datosAnulacion.generador) {
    lines.push(
      buildPersonaFisicaJuridicaXml(
        'sf:Generador',
        record.datosAnulacion.generador,
        '      ',
        'RegistroAnulacion.Generador'
      )
    );
  }

  // 8. Encadenamiento
  lines.push(buildEncadenamientoXml(record));

  // 9. SistemaInformatico
  lines.push(buildSistemaInformaticoXml(record));

  // 10. FechaHoraHusoGenRegistro
  const fechaHora = validateRequiredString(record.fechaHoraHusoGenRegistro, 'RegistroAnulacion.FechaHoraHusoGenRegistro');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(fechaHora)) {
    throw new Error(`buildRegistroAnulacionXml: FechaHoraHusoGenRegistro ('${fechaHora}') debe cumplir formato ISO 8601 con huso horario.`);
  }
  lines.push(`      <sf:FechaHoraHusoGenRegistro>${escapeXml(fechaHora)}</sf:FechaHoraHusoGenRegistro>`);

  // 11. TipoHuella (fijo 01 para SHA-256)
  lines.push('      <sf:TipoHuella>01</sf:TipoHuella>');

  // 12. Huella (SHA-256 64 caracteres hex mayúsculas)
  const huella = validateRequiredString(record.huella.hash, 'RegistroAnulacion.Huella');
  if (huella.length !== 64 || !/^[0-9A-Fa-f]{64}$/.test(huella)) {
    throw new Error(`aeatVerifactuXmlBuilder: Longitud o formato de huella de anulación inválida (${huella.length} caracteres, deben ser 64 hexadecimales).`);
  }
  lines.push(`      <sf:Huella>${escapeXml(huella.toUpperCase())}</sf:Huella>`);

  lines.push('    </sf:RegistroAnulacion>');
  return lines.join('\n');
}

/**
 * Genera el documento XML oficial completo de remisión telemática según el esquema SuministroLR.xsd.
 * Admite tanto un FiscalRecord individual como un lote de registros (hasta 1000).
 */
export function buildAeatVerifactuXml(
  recordOrRecords: FiscalRecord | FiscalRecord[],
  options?: XmlBuilderOptions
): string {
  const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
  if (records.length === 0) {
    throw new Error('aeatVerifactuXmlBuilder: Se requiere al menos un FiscalRecord para generar el XML de suministro.');
  }
  if (records.length > 1000) {
    throw new Error(`aeatVerifactuXmlBuilder: Se admiten como máximo 1000 registros de facturación por remisión (recibidos: ${records.length}).`);
  }

  // El obligado tributario titular de la remisión se extrae del primer registro
  const primaryRecord = records[0];

  const xmlParts: string[] = [];
  xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlParts.push('<sfLR:RegFactuSistemaFacturacion');
  xmlParts.push(`    xmlns:sfLR="${AEAT_NAMESPACES.sfLR}"`);
  xmlParts.push(`    xmlns:sf="${AEAT_NAMESPACES.sf}">`);

  // Cabecera única del suministro
  xmlParts.push(buildCabeceraXml(primaryRecord, options));

  // Registros de facturación (Alta o Anulación)
  for (const rec of records) {
    xmlParts.push('  <sfLR:RegistroFactura>');
    if (rec.tipoRegistro === 'alta') {
      xmlParts.push(buildRegistroAltaXml(rec));
    } else if (rec.tipoRegistro === 'anulacion') {
      xmlParts.push(buildRegistroAnulacionXml(rec));
    } else {
      throw new Error(`aeatVerifactuXmlBuilder: tipoRegistro desconocido: '${(rec as any).tipoRegistro}'.`);
    }
    xmlParts.push('  </sfLR:RegistroFactura>');
  }

  xmlParts.push('</sfLR:RegFactuSistemaFacturacion>');
  return xmlParts.join('\n');
}

// Listas canónicas de orden secuencial estricto xs:sequence según SuministroInformacion.xsd
const REGISTRO_ALTA_ELEMENTS_ORDER = [
  'sf:IDVersion',
  'sf:IDFactura',
  'sf:RefExterna',
  'sf:NombreRazonEmisor',
  'sf:Subsanacion',
  'sf:RechazoPrevio',
  'sf:TipoFactura',
  'sf:TipoRectificativa',
  'sf:FacturasRectificadas',
  'sf:FacturasSustituidas',
  'sf:ImporteRectificacion',
  'sf:FechaOperacion',
  'sf:DescripcionOperacion',
  'sf:FacturaSimplificadaArt7273',
  'sf:FacturaSinIdentifDestinatarioArt61d',
  'sf:Macrodato',
  'sf:EmitidaPorTerceroODestinatario',
  'sf:Tercero',
  'sf:Destinatarios',
  'sf:Cupon',
  'sf:Desglose',
  'sf:CuotaTotal',
  'sf:ImporteTotal',
  'sf:Encadenamiento',
  'sf:SistemaInformatico',
  'sf:FechaHoraHusoGenRegistro',
  'sf:NumRegistroAcuerdoFacturacion',
  'sf:IdAcuerdoSistemaInformatico',
  'sf:TipoHuella',
  'sf:Huella',
  'ds:Signature'
];

const MANDATORY_ALTA_TAGS = [
  'sf:IDVersion',
  'sf:IDFactura',
  'sf:NombreRazonEmisor',
  'sf:TipoFactura',
  'sf:DescripcionOperacion',
  'sf:Desglose',
  'sf:CuotaTotal',
  'sf:ImporteTotal',
  'sf:Encadenamiento',
  'sf:SistemaInformatico',
  'sf:FechaHoraHusoGenRegistro',
  'sf:TipoHuella',
  'sf:Huella'
];

const REGISTRO_ANULACION_ELEMENTS_ORDER = [
  'sf:IDVersion',
  'sf:IDFactura',
  'sf:RefExterna',
  'sf:SinRegistroPrevio',
  'sf:RechazoPrevio',
  'sf:GeneradoPor',
  'sf:Generador',
  'sf:Encadenamiento',
  'sf:SistemaInformatico',
  'sf:FechaHoraHusoGenRegistro',
  'sf:TipoHuella',
  'sf:Huella',
  'ds:Signature'
];

const MANDATORY_ANULACION_TAGS = [
  'sf:IDVersion',
  'sf:IDFactura',
  'sf:Encadenamiento',
  'sf:SistemaInformatico',
  'sf:FechaHoraHusoGenRegistro',
  'sf:TipoHuella',
  'sf:Huella'
];

const ID_FACTURA_ALTA_ORDER = [
  'sf:IDEmisorFactura',
  'sf:NumSerieFactura',
  'sf:FechaExpedicionFactura'
];

const ID_FACTURA_ANUL_ORDER = [
  'sf:IDEmisorFacturaAnulada',
  'sf:NumSerieFacturaAnulada',
  'sf:FechaExpedicionFacturaAnulada'
];

const REGISTRO_ANTERIOR_ORDER = [
  'sf:IDEmisorFactura',
  'sf:NumSerieFactura',
  'sf:FechaExpedicionFactura',
  'sf:Huella'
];

const IMPORTE_RECTIFICACION_ORDER = [
  'sf:BaseRectificada',
  'sf:CuotaRectificada',
  'sf:CuotaRecargoRectificado'
];

const PERSONA_FISICA_JURIDICA_ORDER = [
  'sf:NombreRazon',
  'sf:NIF',
  'sf:IDOtro'
];

const ID_OTRO_ORDER = [
  'sf:CodigoPais',
  'sf:IDType',
  'sf:ID'
];

const DETALLE_DESGLOSE_ORDER = [
  'sf:Impuesto',
  'sf:ClaveRegimen',
  'sf:CalificacionOperacion',
  'sf:OperacionExenta',
  'sf:TipoImpositivo',
  'sf:BaseImponibleOimporteNoSujeto',
  'sf:BaseImponibleACoste',
  'sf:CuotaRepercutida',
  'sf:TipoRecargoEquivalencia',
  'sf:CuotaRecargoEquivalencia'
];

const SISTEMA_INFORMATICO_ORDER = [
  'sf:NombreRazon',
  'sf:NIF',
  'sf:IDOtro',
  'sf:NombreSistemaInformatico',
  'sf:IdSistemaInformatico',
  'sf:Version',
  'sf:NumeroInstalacion',
  'sf:TipoUsoPosibleSoloVerifactu',
  'sf:TipoUsoPosibleMultiOT',
  'sf:IndicadorMultiplesOT'
];

const SISTEMA_INFORMATICO_MANDATORY = [
  'sf:NombreRazon',
  'sf:NombreSistemaInformatico',
  'sf:IdSistemaInformatico',
  'sf:Version',
  'sf:NumeroInstalacion',
  'sf:TipoUsoPosibleSoloVerifactu',
  'sf:TipoUsoPosibleMultiOT',
  'sf:IndicadorMultiplesOT'
];

const VALID_TIPOS_FACTURA = ['F1', 'F2', 'R1', 'R2', 'R3', 'R4', 'R5', 'F3'];
const VALID_TIPOS_RECTIFICATIVA = ['S', 'I'];
const VALID_IMPUESTOS = ['01', '02', '03', '05'];
const VALID_CALIFICACIONES = ['S1', 'S2', 'N1', 'N2'];
const VALID_OPERACIONES_EXENTAS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];

function validateElementSequence(
  parentName: string,
  childrenNodes: any[],
  allowedOrder: string[],
  mandatoryTags: string[],
  errors: string[]
) {
  const childTagNames: string[] = [];
  for (const node of childrenNodes) {
    if (typeof node === 'object' && node !== null) {
      const keys = Object.keys(node).filter(k => k !== ':@' && k !== '#text');
      for (const k of keys) {
        childTagNames.push(k);
      }
    }
  }

  // 1. Elementos inesperados fuera del esquema
  for (const tag of childTagNames) {
    if (!allowedOrder.includes(tag)) {
      errors.push(`Schemas validity error : Element '${tag}' is not expected in '${parentName}'.`);
    }
  }

  // 2. Orden secuencial estricto xs:sequence
  let maxIdx = -1;
  for (const tag of childTagNames) {
    const idx = allowedOrder.indexOf(tag);
    if (idx !== -1) {
      if (idx < maxIdx) {
        errors.push(`Schemas validity error : Element '${tag}' is not expected here; violates xs:sequence order in '${parentName}'.`);
      } else {
        maxIdx = idx;
      }
    }
  }

  // 3. Elementos obligatorios faltantes
  for (const mand of mandatoryTags) {
    if (!childTagNames.includes(mand)) {
      errors.push(`Schemas validity error : Element '${mand}' is not expected to be missing in '${parentName}'.`);
    }
  }
}

function validateEncadenamientoNode(encNode: any, errors: string[]) {
  const encChildren: any[] = encNode['sf:Encadenamiento'] || [];
  validateElementSequence(
    'sf:Encadenamiento',
    encChildren,
    ['sf:PrimerRegistro', 'sf:RegistroAnterior'],
    [],
    errors
  );
  const hasPrimer = encChildren.some((item: any) => item['sf:PrimerRegistro']);
  const regAntNode = encChildren.find((item: any) => item['sf:RegistroAnterior']);
  if (!hasPrimer && !regAntNode) {
    errors.push("Schemas validity error : Element 'sf:Encadenamiento' must contain either 'sf:PrimerRegistro' or 'sf:RegistroAnterior'.");
  }
  if (hasPrimer && regAntNode) {
    errors.push("Schemas validity error : Element 'sf:Encadenamiento' cannot contain both 'sf:PrimerRegistro' and 'sf:RegistroAnterior' (xs:choice).");
  }
  if (regAntNode) {
    validateElementSequence(
      'sf:RegistroAnterior',
      regAntNode['sf:RegistroAnterior'] || [],
      REGISTRO_ANTERIOR_ORDER,
      REGISTRO_ANTERIOR_ORDER,
      errors
    );
  }
}

/**
 * Validador sintáctico, estructural y normativo del XML frente a las reglas oficiales del XSD.
 * Implementación 100% portable y segura para navegador y Node.js.
 */
export function validateAeatVerifactuXml(xmlString: string): XmlValidationReport {
  const errors: string[] = [];

  if (!xmlString || typeof xmlString !== 'string' || xmlString.trim() === '') {
    return { valid: false, errors: ['El documento XML está vacío o no es una cadena válida.'] };
  }

  // 1. Validación de bien formado XML
  const isValidXml = XMLValidator.validate(xmlString);
  if (isValidXml !== true) {
    return {
      valid: false,
      errors: [`Error sintáctico de XML mal formado: ${(isValidXml as any).err?.msg || 'XML no válido'}`]
    };
  }

  // 2. Comprobaciones de Namespaces y Elemento Raíz
  if (!xmlString.includes('sfLR:RegFactuSistemaFacturacion')) {
    errors.push("El elemento raíz debe ser 'sfLR:RegFactuSistemaFacturacion'.");
  }
  if (!xmlString.includes(AEAT_NAMESPACES.sfLR)) {
    errors.push(`Falta la declaración del namespace oficial sfLR: '${AEAT_NAMESPACES.sfLR}'.`);
  }
  if (!xmlString.includes(AEAT_NAMESPACES.sf)) {
    errors.push(`Falta la declaración del namespace oficial sf: '${AEAT_NAMESPACES.sf}'.`);
  }

  // 3. Inspección del orden estricto de elementos xs:sequence mediante parser de orden preservado
  try {
    const orderedParser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      parseTagValue: false
    });
    const parsedOrdered = orderedParser.parse(xmlString);
    const rootNode = parsedOrdered.find((item: any) => item['sfLR:RegFactuSistemaFacturacion']);

    if (rootNode) {
      const rootChildren: any[] = rootNode['sfLR:RegFactuSistemaFacturacion'] || [];
      validateElementSequence(
        'sfLR:RegFactuSistemaFacturacion',
        rootChildren,
        ['sfLR:Cabecera', 'sfLR:RegistroFactura'],
        ['sfLR:Cabecera', 'sfLR:RegistroFactura'],
        errors
      );

      const cabeceraNode = rootChildren.find((item: any) => item['sfLR:Cabecera']);
      if (cabeceraNode) {
        const cabeceraChildren: any[] = cabeceraNode['sfLR:Cabecera'] || [];
        validateElementSequence(
          'sfLR:Cabecera',
          cabeceraChildren,
          ['sf:ObligadoEmision', 'sf:Representante', 'sf:RemisionVoluntaria', 'sf:RemisionRequerimiento'],
          ['sf:ObligadoEmision'],
          errors
        );
        const obligadoNode = cabeceraChildren.find((item: any) => item['sf:ObligadoEmision']);
        if (obligadoNode) {
          validateElementSequence('sf:ObligadoEmision', obligadoNode['sf:ObligadoEmision'] || [], ['sf:NombreRazon', 'sf:NIF'], ['sf:NombreRazon', 'sf:NIF'], errors);
        }
      }

      const registroFacturaNodes = rootChildren.filter((item: any) => item['sfLR:RegistroFactura']);
      for (const regItem of registroFacturaNodes) {
        const regChildren: any[] = regItem['sfLR:RegistroFactura'] || [];
        const altaNode = regChildren.find((item: any) => item['sf:RegistroAlta']);
        const anulNode = regChildren.find((item: any) => item['sf:RegistroAnulacion']);

        if (altaNode) {
          const altaChildren: any[] = altaNode['sf:RegistroAlta'] || [];
          validateElementSequence('sf:RegistroAlta', altaChildren, REGISTRO_ALTA_ELEMENTS_ORDER, MANDATORY_ALTA_TAGS, errors);

          // Validar sub-secuencia de IDFactura
          const idFacturaNode = altaChildren.find((item: any) => item['sf:IDFactura']);
          if (idFacturaNode) {
            validateElementSequence('sf:IDFactura', idFacturaNode['sf:IDFactura'] || [], ID_FACTURA_ALTA_ORDER, ID_FACTURA_ALTA_ORDER, errors);
          }

          // Validar sub-secuencia de FacturasRectificadas
          const rectificadasNode = altaChildren.find((item: any) => item['sf:FacturasRectificadas']);
          if (rectificadasNode) {
            const rectChildren: any[] = rectificadasNode['sf:FacturasRectificadas'] || [];
            validateElementSequence('sf:FacturasRectificadas', rectChildren, ['sf:IDFacturaRectificada'], ['sf:IDFacturaRectificada'], errors);
            for (const item of rectChildren.filter((x: any) => x['sf:IDFacturaRectificada'])) {
              validateElementSequence('sf:IDFacturaRectificada', item['sf:IDFacturaRectificada'] || [], ID_FACTURA_ALTA_ORDER, ID_FACTURA_ALTA_ORDER, errors);
            }
          }

          // Validar sub-secuencia de FacturasSustituidas
          const sustituidasNode = altaChildren.find((item: any) => item['sf:FacturasSustituidas']);
          if (sustituidasNode) {
            const sustChildren: any[] = sustituidasNode['sf:FacturasSustituidas'] || [];
            validateElementSequence('sf:FacturasSustituidas', sustChildren, ['sf:IDFacturaSustituida'], ['sf:IDFacturaSustituida'], errors);
            for (const item of sustChildren.filter((x: any) => x['sf:IDFacturaSustituida'])) {
              validateElementSequence('sf:IDFacturaSustituida', item['sf:IDFacturaSustituida'] || [], ID_FACTURA_ALTA_ORDER, ID_FACTURA_ALTA_ORDER, errors);
            }
          }

          // Validar sub-secuencia de ImporteRectificacion
          const impRectNode = altaChildren.find((item: any) => item['sf:ImporteRectificacion']);
          if (impRectNode) {
            validateElementSequence(
              'sf:ImporteRectificacion',
              impRectNode['sf:ImporteRectificacion'] || [],
              IMPORTE_RECTIFICACION_ORDER,
              ['sf:BaseRectificada', 'sf:CuotaRectificada'],
              errors
            );
          }

          // Validar sub-secuencia de Destinatarios
          const destsNode = altaChildren.find((item: any) => item['sf:Destinatarios']);
          if (destsNode) {
            const destsChildren: any[] = destsNode['sf:Destinatarios'] || [];
            validateElementSequence('sf:Destinatarios', destsChildren, ['sf:IDDestinatario'], ['sf:IDDestinatario'], errors);
            for (const dItem of destsChildren.filter((x: any) => x['sf:IDDestinatario'])) {
              const dChildren: any[] = dItem['sf:IDDestinatario'] || [];
              validateElementSequence('sf:IDDestinatario', dChildren, PERSONA_FISICA_JURIDICA_ORDER, ['sf:NombreRazon'], errors);
              const hasNif = dChildren.some((x: any) => x['sf:NIF']);
              const idOtroNode = dChildren.find((x: any) => x['sf:IDOtro']);
              if (!hasNif && !idOtroNode) {
                errors.push("Schemas validity error : Element 'sf:IDDestinatario' must include either 'sf:NIF' or 'sf:IDOtro'.");
              }
              if (hasNif && idOtroNode) {
                errors.push("Schemas validity error : Element 'sf:IDDestinatario' cannot include both 'sf:NIF' and 'sf:IDOtro' (xs:choice).");
              }
              if (idOtroNode) {
                validateElementSequence('sf:IDOtro', idOtroNode['sf:IDOtro'] || [], ID_OTRO_ORDER, ['sf:IDType', 'sf:ID'], errors);
              }
            }
          }

          // Validar sub-secuencia de Desglose
          const desgloseNode = altaChildren.find((item: any) => item['sf:Desglose']);
          if (desgloseNode) {
            const desgloseChildren: any[] = desgloseNode['sf:Desglose'] || [];
            const detalles = desgloseChildren.filter((item: any) => item['sf:DetalleDesglose']);
            for (const det of detalles) {
              const detChildren: any[] = det['sf:DetalleDesglose'] || [];
              validateElementSequence('sf:DetalleDesglose', detChildren, DETALLE_DESGLOSE_ORDER, ['sf:Impuesto', 'sf:ClaveRegimen', 'sf:BaseImponibleOimporteNoSujeto'], errors);
              const hasCal = detChildren.some((x: any) => x['sf:CalificacionOperacion']);
              const hasEx = detChildren.some((x: any) => x['sf:OperacionExenta']);
              if (!hasCal && !hasEx) {
                errors.push("Schemas validity error : Element 'sf:DetalleDesglose' must include 'sf:CalificacionOperacion' or 'sf:OperacionExenta'.");
              }
              if (hasCal && hasEx) {
                errors.push("Schemas validity error : Element 'sf:DetalleDesglose' cannot include both 'sf:CalificacionOperacion' and 'sf:OperacionExenta'.");
              }
            }
          }

          // Validar sub-secuencia de Encadenamiento
          const encNode = altaChildren.find((item: any) => item['sf:Encadenamiento']);
          if (encNode) {
            validateEncadenamientoNode(encNode, errors);
          }

          // Validar sub-secuencia de SistemaInformatico
          const sistInfoNode = altaChildren.find((item: any) => item['sf:SistemaInformatico']);
          if (sistInfoNode) {
            validateElementSequence('sf:SistemaInformatico', sistInfoNode['sf:SistemaInformatico'] || [], SISTEMA_INFORMATICO_ORDER, SISTEMA_INFORMATICO_MANDATORY, errors);
          }
        }

        if (anulNode) {
          const anulChildren: any[] = anulNode['sf:RegistroAnulacion'] || [];
          validateElementSequence('sf:RegistroAnulacion', anulChildren, REGISTRO_ANULACION_ELEMENTS_ORDER, MANDATORY_ANULACION_TAGS, errors);

          const idFacturaAnulNode = anulChildren.find((item: any) => item['sf:IDFactura']);
          if (idFacturaAnulNode) {
            validateElementSequence('sf:IDFactura', idFacturaAnulNode['sf:IDFactura'] || [], ID_FACTURA_ANUL_ORDER, ID_FACTURA_ANUL_ORDER, errors);
          }

          const encNode = anulChildren.find((item: any) => item['sf:Encadenamiento']);
          if (encNode) {
            validateEncadenamientoNode(encNode, errors);
          }

          const sistInfoNode = anulChildren.find((item: any) => item['sf:SistemaInformatico']);
          if (sistInfoNode) {
            validateElementSequence('sf:SistemaInformatico', sistInfoNode['sf:SistemaInformatico'] || [], SISTEMA_INFORMATICO_ORDER, SISTEMA_INFORMATICO_MANDATORY, errors);
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`Error en análisis de secuencia xs:sequence: ${err?.message || String(err)}`);
  }

  // 4. Inspección de contenido y valores contra tipos XSD
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: false,
      trimValues: true,
      parseTagValue: false
    });
    const parsed = parser.parse(xmlString);
    const root = parsed['sfLR:RegFactuSistemaFacturacion'];

    if (!root) {
      errors.push("No se encontró el nodo raíz 'sfLR:RegFactuSistemaFacturacion'.");
      return { valid: false, errors };
    }

    // Cabecera
    const cabecera = root['sfLR:Cabecera'];
    if (!cabecera) {
      errors.push("Falta el elemento obligatorio '<sfLR:Cabecera>'.");
    } else {
      const obligado = cabecera['sf:ObligadoEmision'];
      if (!obligado) {
        errors.push("Falta el elemento obligatorio '<sf:ObligadoEmision>' en Cabecera.");
      } else {
        if (!obligado['sf:NombreRazon']) errors.push("Falta 'sf:NombreRazon' en ObligadoEmision.");
        if (!obligado['sf:NIF']) errors.push("Falta 'sf:NIF' en ObligadoEmision.");
      }
    }

    // Registros
    let registros = root['sfLR:RegistroFactura'];
    if (!registros) {
      errors.push("Falta al menos un elemento '<sfLR:RegistroFactura>'.");
    } else {
      if (!Array.isArray(registros)) {
        registros = [registros];
      }
      if (registros.length > 1000) {
        errors.push(`El número de registros de facturación (${registros.length}) supera el límite de 1000.`);
      }

      for (let i = 0; i < registros.length; i++) {
        const reg = registros[i];
        const alta = reg['sf:RegistroAlta'];
        const anulacion = reg['sf:RegistroAnulacion'];

        if (!alta && !anulacion) {
          errors.push(`RegistroFactura #${i + 1}: Debe contener o 'sf:RegistroAlta' o 'sf:RegistroAnulacion'.`);
          continue;
        }

        if (alta && anulacion) {
          errors.push(`RegistroFactura #${i + 1}: No puede contener simultáneamente 'sf:RegistroAlta' y 'sf:RegistroAnulacion'.`);
          continue;
        }

        if (alta) {
          // Validar versión
          if (String(alta['sf:IDVersion']) !== '1.0' && alta['sf:IDVersion'] !== 1) {
            errors.push(`RegistroAlta #${i + 1}: IDVersion debe ser '1.0'.`);
          }

          // Validar enumeración TipoFactura
          const tipoFactura = String(alta['sf:TipoFactura'] || '');
          if (!VALID_TIPOS_FACTURA.includes(tipoFactura)) {
            errors.push(`Schemas validity error : Value '${tipoFactura}' is not facet-valid with respect to enumeration for 'sf:TipoFactura'.`);
          }

          // Validar enumeración TipoRectificativa si está presente
          if (alta['sf:TipoRectificativa'] !== undefined) {
            const tr = String(alta['sf:TipoRectificativa']);
            if (!VALID_TIPOS_RECTIFICATIVA.includes(tr)) {
              errors.push(`Schemas validity error : Value '${tr}' is not facet-valid with respect to enumeration for 'sf:TipoRectificativa'.`);
            }
          }

          // Validar fechas
          const fechaExp = alta['sf:IDFactura']?.['sf:FechaExpedicionFactura'];
          if (!fechaExp || !/^\d{2}-\d{2}-\d{4}$/.test(String(fechaExp))) {
            errors.push(`RegistroAlta #${i + 1}: FechaExpedicionFactura debe tener formato DD-MM-YYYY (recibido '${fechaExp}').`);
          }

          // Validar importes contra patrón ImporteSgn12.2Type ^(\+|-)?\d{1,12}(\.\d{0,2})?$
          const importeTotalStr = String(alta['sf:ImporteTotal'] ?? '');
          if (!/^(\+|-)?\d{1,12}\.\d{2}$/.test(importeTotalStr)) {
            errors.push(`Schemas validity error : Value '${importeTotalStr}' is not facet-valid with respect to pattern for 'sf:ImporteTotal'.`);
          }

          const cuotaTotalStr = String(alta['sf:CuotaTotal'] ?? '');
          if (!/^(\+|-)?\d{1,12}\.\d{2}$/.test(cuotaTotalStr)) {
            errors.push(`Schemas validity error : Value '${cuotaTotalStr}' is not facet-valid with respect to pattern for 'sf:CuotaTotal'.`);
          }

          // Validar huella
          if (String(alta['sf:TipoHuella']) !== '01') {
            errors.push(`RegistroAlta #${i + 1}: TipoHuella debe ser '01' (SHA-256).`);
          }
          const huella = alta['sf:Huella'];
          if (!huella || !/^[A-Fa-f0-9]{64}$/.test(String(huella))) {
            errors.push(`RegistroAlta #${i + 1}: Huella debe tener exactamente 64 caracteres hexadecimales.`);
          }

          // Validar sistema informático IdSistemaInformatico TextMax2Type
          const sistInfo = alta['sf:SistemaInformatico'];
          if (sistInfo) {
            const idSif = String(sistInfo['sf:IdSistemaInformatico'] || '');
            if (idSif.length > 2) {
              errors.push(`Schemas validity error : Value '${idSif}' exceeds maxLength 2 for 'sf:IdSistemaInformatico'.`);
            }
          }
        }

        if (anulacion) {
          if (String(anulacion['sf:IDVersion']) !== '1.0' && anulacion['sf:IDVersion'] !== 1) {
            errors.push(`RegistroAnulacion #${i + 1}: IDVersion debe ser '1.0'.`);
          }
          const fechaAnul = anulacion['sf:IDFactura']?.['sf:FechaExpedicionFacturaAnulada'];
          if (!fechaAnul || !/^\d{2}-\d{2}-\d{4}$/.test(String(fechaAnul))) {
            errors.push(`RegistroAnulacion #${i + 1}: FechaExpedicionFacturaAnulada debe tener formato DD-MM-YYYY (recibido '${fechaAnul}').`);
          }
          if (String(anulacion['sf:TipoHuella']) !== '01') {
            errors.push(`RegistroAnulacion #${i + 1}: TipoHuella debe ser '01' (SHA-256).`);
          }
          const huella = anulacion['sf:Huella'];
          if (!huella || !/^[A-Fa-f0-9]{64}$/.test(String(huella))) {
            errors.push(`RegistroAnulacion #${i + 1}: Huella debe tener exactamente 64 caracteres hexadecimales.`);
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`Error en parseo estructural XML: ${err?.message || String(err)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    engine: 'internal-structural-validator'
  };
}
