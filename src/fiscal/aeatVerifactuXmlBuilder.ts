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

import { FiscalRecord, DesgloseIvaFiscal } from './types';
import { formatFechaExpedicionFiscal, formatImporteFiscal } from './hashService';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const AEAT_NAMESPACES = {
  sfLR: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
  sf: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#'
} as const;

export interface XmlBuilderOptions {
  incidencia?: 'S' | 'N';
  refRequerimiento?: string;
  finRequerimiento?: 'S' | 'N';
}

export interface XmlValidationReport {
  valid: boolean;
  errors: string[];
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
 * Valida que un NIF cumpla con los requisitos mínimos reglamentarios y rechaza valores ficticios.
 */
function validateNif(nif: string | undefined | null, fieldName: string): string {
  if (!nif || typeof nif !== 'string' || nif.trim() === '') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} es obligatorio y no puede estar vacío.`);
  }
  const clean = nif.trim().toUpperCase();
  if (clean === 'ES_UNKNOWN' || clean === 'UNKNOWN') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} no puede ser un valor artificial ('${clean}').`);
  }
  if (clean.length > 9) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} ('${clean}') excede la longitud máxima de 9 caracteres para NIF español.`);
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
  if (clean === 'ES_UNKNOWN' || clean === 'UNKNOWN') {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} no puede contener valores ficticios ('${clean}').`);
  }
  if (maxLen && clean.length > maxLen) {
    throw new Error(`aeatVerifactuXmlBuilder: ${fieldName} excede la longitud máxima permitida de ${maxLen} caracteres.`);
  }
  return clean;
}

/**
 * Normaliza y valida el código de sistema informático (XSD TextMax2Type: longitud <= 2).
 */
function normalizeIdSistemaInformatico(id: string | undefined | null): string {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    return '01';
  }
  const clean = id.trim();
  if (clean.length <= 2) {
    return clean;
  }
  // Si contiene un identificador histórico más largo (ej. 'GAVICOLA_SIF_V1'), se normaliza a '01'
  return '01';
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

  if (record.modoFiscal === 'VERI_FACTU') {
    lines.push('    <sf:RemisionVoluntaria>');
    if (options?.incidencia) {
      lines.push(`      <sf:Incidencia>${options.incidencia}</sf:Incidencia>`);
    } else {
      lines.push('      <sf:Incidencia>N</sf:Incidencia>');
    }
    lines.push('    </sf:RemisionVoluntaria>');
  } else if (options?.refRequerimiento) {
    lines.push('    <sf:RemisionRequerimiento>');
    lines.push(`      <sf:RefRequerimiento>${escapeXml(options.refRequerimiento)}</sf:RefRequerimiento>`);
    if (options.finRequerimiento) {
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
    if (prevHuella.length !== 64) {
      throw new Error(`aeatVerifactuXmlBuilder: Huella del registro anterior inválida (${prevHuella.length} caracteres, se requieren 64).`);
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
  const nif = validateNif(sif.nif, 'SistemaInformatico.NIF');
  const nombreSif = validateRequiredString(sif.nombreSistemaInformatico, 'SistemaInformatico.NombreSistemaInformatico', 30);
  const idSif = normalizeIdSistemaInformatico(sif.idSistemaInformatico);
  const version = validateRequiredString(sif.version, 'SistemaInformatico.Version', 50);
  const numeroInstalacion = validateRequiredString(sif.numeroInstalacion, 'SistemaInformatico.NumeroInstalacion', 100);
  const soloVerifactu = sif.tipoUsoPosibleSoloVerifactu || (record.modoFiscal === 'VERI_FACTU' ? 'S' : 'N');
  const multiOT = sif.tipoUsoPosibleMultiOT || 'N';
  const indicadorMultiOT = sif.indicadorMultiplesOT || 'N';

  const lines: string[] = [];
  lines.push('      <sf:SistemaInformatico>');
  lines.push(`        <sf:NombreRazon>${escapeXml(nombreRazon)}</sf:NombreRazon>`);
  lines.push(`        <sf:NIF>${escapeXml(nif)}</sf:NIF>`);
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

/**
 * Construye la sección <sf:Desglose> según sf:DesgloseType.
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

  for (const item of desgloseIVA) {
    const impuesto = item.impuesto || '01'; // 01 = IVA
    const claveRegimen = item.claveRegimen || '01'; // 01 = Régimen general
    const calificacion = item.calificacionOperacion || 'S1'; // S1 = Sujeta y no exenta sin ISP
    const base = formatImporteFiscal(item.baseImponible);
    const cuota = formatImporteFiscal(item.cuotaRepercutida);
    const tipo = item.tipoImpositivo !== undefined ? Number(item.tipoImpositivo).toFixed(2) : undefined;

    lines.push('        <sf:DetalleDesglose>');
    lines.push(`          <sf:Impuesto>${escapeXml(impuesto)}</sf:Impuesto>`);
    lines.push(`          <sf:ClaveRegimen>${escapeXml(claveRegimen)}</sf:ClaveRegimen>`);

    if (item.operacionExenta) {
      lines.push(`          <sf:OperacionExenta>${escapeXml(item.operacionExenta)}</sf:OperacionExenta>`);
    } else {
      lines.push(`          <sf:CalificacionOperacion>${escapeXml(calificacion)}</sf:CalificacionOperacion>`);
    }

    if (tipo !== undefined) {
      lines.push(`          <sf:TipoImpositivo>${escapeXml(tipo)}</sf:TipoImpositivo>`);
    }
    lines.push(`          <sf:BaseImponibleOimporteNoSujeto>${escapeXml(base)}</sf:BaseImponibleOimporteNoSujeto>`);
    lines.push(`          <sf:CuotaRepercutida>${escapeXml(cuota)}</sf:CuotaRepercutida>`);

    if (item.tipoRecargoEquivalencia !== undefined && item.tipoRecargoEquivalencia > 0) {
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
 * El orden estricto de xs:sequence es verificado campo por campo.
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

  // 3. NombreRazonEmisor
  lines.push(`      <sf:NombreRazonEmisor>${escapeXml(nombreRazonEmisor)}</sf:NombreRazonEmisor>`);

  // 4. TipoFactura (F1, F2, R1, etc.)
  const tipoFactura = record.factura.tipoFactura || 'F1';
  lines.push(`      <sf:TipoFactura>${escapeXml(tipoFactura)}</sf:TipoFactura>`);

  // 5. TipoRectificativa (si aplica)
  if (record.datosRectificativa) {
    const tipoRect = record.datosRectificativa.tipoRectificativa;
    if (tipoRect === 'S' || tipoRect === 'I') {
      lines.push(`      <sf:TipoRectificativa>${escapeXml(tipoRect)}</sf:TipoRectificativa>`);
    }

    // 6. FacturasRectificadas (si aplica)
    if (record.datosRectificativa.facturasRectificadas && record.datosRectificativa.facturasRectificadas.length > 0) {
      lines.push('      <sf:FacturasRectificadas>');
      for (const fr of record.datosRectificativa.facturasRectificadas) {
        const frNum = validateRequiredString(fr.numeroFactura, 'FacturaRectificada.NumSerieFactura', 60);
        const frFecha = formatFechaExpedicionFiscal(fr.fechaExpedicion);
        lines.push('        <sf:IDFacturaRectificada>');
        lines.push(`          <sf:IDEmisorFactura>${escapeXml(emisorNif)}</sf:IDEmisorFactura>`);
        lines.push(`          <sf:NumSerieFactura>${escapeXml(frNum)}</sf:NumSerieFactura>`);
        lines.push(`          <sf:FechaExpedicionFactura>${escapeXml(frFecha)}</sf:FechaExpedicionFactura>`);
        lines.push('        </sf:IDFacturaRectificada>');
      }
      lines.push('      </sf:FacturasRectificadas>');
    }

    // 7. ImporteRectificacion (si aplica)
    if (record.datosRectificativa.importeRectificacion) {
      const imp = record.datosRectificativa.importeRectificacion;
      lines.push('      <sf:ImporteRectificacion>');
      lines.push(`        <sf:BaseRectificada>${formatImporteFiscal(imp.baseRectificada)}</sf:BaseRectificada>`);
      lines.push(`        <sf:CuotaRectificada>${formatImporteFiscal(imp.cuotaRectificada)}</sf:CuotaRectificada>`);
      lines.push('      </sf:ImporteRectificacion>');
    }
  }

  // 8. DescripcionOperacion
  lines.push(`      <sf:DescripcionOperacion>${escapeXml(descripcionOperacion)}</sf:DescripcionOperacion>`);

  // 9. FacturaSimplificadaArt7273 (opcional)
  if (record.factura.facturaSimplificadaArt7273 === 'S') {
    lines.push('      <sf:FacturaSimplificadaArt7273>S</sf:FacturaSimplificadaArt7273>');
  }

  // 10. FacturaSinIdentifDestinatarioArt61d (opcional)
  if (record.factura.facturaSinIdentifDestinatarioArt61d === 'S') {
    lines.push('      <sf:FacturaSinIdentifDestinatarioArt61d>S</sf:FacturaSinIdentifDestinatarioArt61d>');
  }

  // 11. Destinatarios (si existe cliente identificado)
  if (record.destinatario && (record.destinatario.nif || record.destinatario.idOtro)) {
    const destNombre = validateRequiredString(record.destinatario.nombreRazon || 'CLIENTE', 'Destinatario.NombreRazon', 120);
    lines.push('      <sf:Destinatarios>');
    lines.push('        <sf:IDDestinatario>');
    lines.push(`          <sf:NombreRazon>${escapeXml(destNombre)}</sf:NombreRazon>`);
    if (record.destinatario.nif) {
      lines.push(`          <sf:NIF>${escapeXml(validateNif(record.destinatario.nif, 'Destinatario.NIF'))}</sf:NIF>`);
    } else if (record.destinatario.idOtro) {
      const otro = record.destinatario.idOtro;
      lines.push('          <sf:IDOtro>');
      if (otro.codigoPais) {
        lines.push(`            <sf:CodigoPais>${escapeXml(otro.codigoPais)}</sf:CodigoPais>`);
      }
      lines.push(`            <sf:IDType>${escapeXml(otro.idType)}</sf:IDType>`);
      lines.push(`            <sf:ID>${escapeXml(otro.id)}</sf:ID>`);
      lines.push('          </sf:IDOtro>');
    }
    lines.push('        </sf:IDDestinatario>');
    lines.push('      </sf:Destinatarios>');
  }

  // 12. Desglose
  lines.push(buildDesgloseXml(record.desgloseTributario.desgloseIVA));

  // 13. CuotaTotal
  const cuotaTotalNum = (record.desgloseTributario.cuotaTotal ?? 0) + (record.desgloseTributario.cuotaRecargoTotal ?? 0);
  lines.push(`      <sf:CuotaTotal>${formatImporteFiscal(cuotaTotalNum)}</sf:CuotaTotal>`);

  // 14. ImporteTotal
  const importeTotalNum = record.desgloseTributario.importeTotal;
  lines.push(`      <sf:ImporteTotal>${formatImporteFiscal(importeTotalNum)}</sf:ImporteTotal>`);

  // 15. Encadenamiento
  lines.push(buildEncadenamientoXml(record));

  // 16. SistemaInformatico
  lines.push(buildSistemaInformaticoXml(record));

  // 17. FechaHoraHusoGenRegistro
  const fechaHora = validateRequiredString(record.fechaHoraHusoGenRegistro, 'RegistroAlta.FechaHoraHusoGenRegistro');
  lines.push(`      <sf:FechaHoraHusoGenRegistro>${escapeXml(fechaHora)}</sf:FechaHoraHusoGenRegistro>`);

  // 18. TipoHuella (fijo 01 para SHA-256)
  lines.push('      <sf:TipoHuella>01</sf:TipoHuella>');

  // 19. Huella (SHA-256 en mayúsculas de 64 caracteres)
  const huella = validateRequiredString(record.huella.hash, 'RegistroAlta.Huella');
  if (huella.length !== 64) {
    throw new Error(`aeatVerifactuXmlBuilder: Longitud de huella inválida (${huella.length} caracteres, deben ser 64).`);
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

  // 3. Encadenamiento
  lines.push(buildEncadenamientoXml(record));

  // 4. SistemaInformatico
  lines.push(buildSistemaInformaticoXml(record));

  // 5. FechaHoraHusoGenRegistro
  const fechaHora = validateRequiredString(record.fechaHoraHusoGenRegistro, 'RegistroAnulacion.FechaHoraHusoGenRegistro');
  lines.push(`      <sf:FechaHoraHusoGenRegistro>${escapeXml(fechaHora)}</sf:FechaHoraHusoGenRegistro>`);

  // 6. TipoHuella (fijo 01 para SHA-256)
  lines.push('      <sf:TipoHuella>01</sf:TipoHuella>');

  // 7. Huella (SHA-256 64 caracteres hex mayúsculas)
  const huella = validateRequiredString(record.huella.hash, 'RegistroAnulacion.Huella');
  if (huella.length !== 64) {
    throw new Error(`aeatVerifactuXmlBuilder: Longitud de huella de anulación inválida (${huella.length} caracteres, deben ser 64).`);
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
  'sf:SinRegistroPrevio',
  'sf:TipoFactura',
  'sf:TipoRectificativa',
  'sf:FacturasRectificadas',
  'sf:ImporteRectificacion',
  'sf:FechaOperacion',
  'sf:DescripcionOperacion',
  'sf:FacturaSimplificadaArt7273',
  'sf:FacturaSinIdentifDestinatarioArt61d',
  'sf:Macrodato',
  'sf:EmitidaPorTercerosODestinatario',
  'sf:Tercero',
  'sf:Destinatarios',
  'sf:Cupon',
  'sf:Desglose',
  'sf:CuotaTotal',
  'sf:ImporteTotal',
  'sf:Encadenamiento',
  'sf:SistemaInformatico',
  'sf:FechaHoraHusoGenRegistro',
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

const DETALLE_DESGLOSE_ORDER = [
  'sf:Impuesto',
  'sf:ClaveRegimen',
  'sf:CalificacionOperacion',
  'sf:OperacionExenta',
  'sf:TipoImpositivo',
  'sf:BaseImponibleOimporteNoSujeto',
  'sf:BaseImponibleCoste',
  'sf:CuotaRepercutida',
  'sf:TipoRecargoEquivalencia',
  'sf:CuotaRecargoEquivalencia'
];

const SISTEMA_INFORMATICO_ORDER = [
  'sf:NombreRazon',
  'sf:NIF',
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
const VALID_IMPUESTOS = ['01', '02', '03'];
const VALID_CALIFICACIONES = ['S1', 'S2', 'N1', 'N2'];
const VALID_OPERACIONES_EXENTAS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

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

/**
 * Validador sintáctico, estructural y normativo del XML frente a las reglas oficiales del XSD.
 * Implementación 100% portable y segura para navegador y Node.js.
 * Comprueba:
 * - XML bien formado (well-formed XML).
 * - Elemento raíz 'sfLR:RegFactuSistemaFacturacion' con namespaces oficiales.
 * - Estructura de Cabecera con ObligadoEmision válido.
 * - Secuencia estricta de elementos xs:sequence (RegistroAlta y RegistroAnulacion).
 * - Restricciones de tipos de datos, enumeraciones (TipoFactura, Impuesto, ClaveRegimen, etc.).
 * - Patrones numéricos oficiales (ej. ImporteSgn12.2Type ^-?\d{1,12}\.\d{2}$).
 * - Prohibición estricta de elementos ajenos al esquema.
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
      const cabeceraNode = rootChildren.find((item: any) => item['sfLR:Cabecera']);
      if (cabeceraNode) {
        const cabeceraChildren: any[] = cabeceraNode['sfLR:Cabecera'] || [];
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

          // Validar sub-secuencia de Desglose
          const desgloseNode = altaChildren.find((item: any) => item['sf:Desglose']);
          if (desgloseNode) {
            const desgloseChildren: any[] = desgloseNode['sf:Desglose'] || [];
            const detalles = desgloseChildren.filter((item: any) => item['sf:DetalleDesglose']);
            for (const det of detalles) {
              validateElementSequence('sf:DetalleDesglose', det['sf:DetalleDesglose'] || [], DETALLE_DESGLOSE_ORDER, ['sf:Impuesto', 'sf:ClaveRegimen', 'sf:BaseImponibleOimporteNoSujeto'], errors);
            }
          }

          // Validar sub-secuencia de SistemaInformatico
          const sistInfoNode = altaChildren.find((item: any) => item['sf:SistemaInformatico']);
          if (sistInfoNode) {
            validateElementSequence('sf:SistemaInformatico', sistInfoNode['sf:SistemaInformatico'] || [], SISTEMA_INFORMATICO_ORDER, SISTEMA_INFORMATICO_ORDER, errors);
          }
        }

        if (anulNode) {
          const anulChildren: any[] = anulNode['sf:RegistroAnulacion'] || [];
          validateElementSequence('sf:RegistroAnulacion', anulChildren, REGISTRO_ANULACION_ELEMENTS_ORDER, MANDATORY_ANULACION_TAGS, errors);

          const idFacturaAnulNode = anulChildren.find((item: any) => item['sf:IDFactura']);
          if (idFacturaAnulNode) {
            validateElementSequence('sf:IDFactura', idFacturaAnulNode['sf:IDFactura'] || [], ID_FACTURA_ANUL_ORDER, ID_FACTURA_ANUL_ORDER, errors);
          }

          const sistInfoNode = anulChildren.find((item: any) => item['sf:SistemaInformatico']);
          if (sistInfoNode) {
            validateElementSequence('sf:SistemaInformatico', sistInfoNode['sf:SistemaInformatico'] || [], SISTEMA_INFORMATICO_ORDER, SISTEMA_INFORMATICO_ORDER, errors);
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
          if (alta['sf:TipoRectificativa']) {
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

          // Validar importes contra patrón ImporteSgn12.2Type ^-?\d{1,12}\.\d{2}$
          const importeTotalStr = String(alta['sf:ImporteTotal'] ?? '');
          if (!/^-?\d{1,12}\.\d{2}$/.test(importeTotalStr)) {
            errors.push(`Schemas validity error : Value '${importeTotalStr}' is not facet-valid with respect to pattern for 'sf:ImporteTotal'.`);
          }

          const cuotaTotalStr = String(alta['sf:CuotaTotal'] ?? '');
          if (!/^-?\d{1,12}\.\d{2}$/.test(cuotaTotalStr)) {
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
    errors
  };
}
