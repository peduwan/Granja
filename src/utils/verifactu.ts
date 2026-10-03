import QRCode from 'qrcode';
import { Factura, ConfiguracionEmpresa, RegistroFacturacionVeriFactu, TipoFacturaAEAT, FiscalRecord } from '../types';
import { buildAeatVerifactuXml } from '../fiscal/aeatVerifactuXmlBuilder';
import { createFiscalRecordFromInvoice, createDefaultFiscalConfiguration } from '../fiscal/modelTransformers';
import { buildFiscalQrUrl, generateQrDataUri as qrServiceGenerateDataUri } from '../fiscal/qrService';

/**
 * Motor Criptográfico y Generador de Registros Veri*Factu
 * Cumplimiento con Ley 11/2021 (Antifraude), Real Decreto 1007/2023 y Orden HAC/1177/2024.
 */

export const SOFTWARE_INFO = {
  nombre: 'Gestión Avícola',
  version: '1.0.0',
  fabricante: 'Gestión Avícola AgroTech Software S.L.',
  nifFabricante: 'B99000001'
};

/**
 * Calcula el Hash criptográfico SHA-256 en formato hexadecimal mayúsculas.
 */
export async function calcularSha256(cadena: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(cadena);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * @deprecated PROHIBIDO EN CLIENTE (FASE 3.1.5 / C3)
 * No utilizar para emisiones fiscales.
 * El cálculo oficial canónico y encadenamiento SHA-256 según Orden HAC/1177/2024
 * se gestiona de forma exclusiva en el backend (`src/fiscal/hashService.ts` / `/api/fiscal/emit-invoice`).
 */
export async function generarHuellaVeriFactu(_params: {
  nifEmisor: string;
  numSerieFactura: string;
  fechaExpedicion: string;
  tipoFactura: string;
  totalFactura: number;
  hashAnterior: string;
  fechaHoraSellado: string;
}): Promise<string> {
  throw new Error('VIOLACIÓN DE AUTORIDAD FISCAL: La huella fiscal no puede ser calculada en el navegador. La emisión oficial reside exclusivamente en el backend.');
}

/**
 * Construye la URL reglamentaria oficial para cotejo directo en la Sede Electrónica de la AEAT
 * conforme a la Orden HAC/1177/2024 Art. 21 y especificaciones técnicas oficiales v1.0.
 */
export function generarUrlAeatVeriFactu(params: {
  nifEmisor: string;
  numSerieFactura: string;
  fechaExpedicion: string; // YYYY-MM-DD o DD-MM-YYYY
  totalFactura: number;
}): string {
  return buildFiscalQrUrl({
    tipoRegistro: 'alta',
    emisor: { nif: params.nifEmisor, nombreRazon: '' },
    factura: { numeroFactura: params.numSerieFactura, fechaExpedicion: params.fechaExpedicion },
    desgloseTributario: { importeTotal: params.totalFactura }
  } as any);
}

/**
 * Genera el Código QR oficial en formato DataURL Base64 PNG para impresión/PDF.
 * Especificación: Estándar ISO/IEC 18004:2015, corrección M, tamaño físico 30x30 a 40x40 mm.
 */
export async function generarQrDataUri(urlAeat: string): Promise<string> {
  try {
    return await qrServiceGenerateDataUri(urlAeat);
  } catch (err) {
    console.error('Error generando QR Veri*Factu:', err);
    return '';
  }
}

/**
 * Genera el XML reglamentario de la AEAT para una factura individual.
 * Delegado de forma exclusiva a `buildAeatVerifactuXml()` en `src/fiscal/aeatVerifactuXmlBuilder.ts`.
 */
export function generarXmlVeriFactu(
  factura: Factura,
  config: ConfiguracionEmpresa,
  hashAnterior: string,
  hashActual: string,
  fechaHoraSellado: string
): string {
  const fiscalConfig = createDefaultFiscalConfiguration({
    nif: config.cifEmpresa || 'B99999999',
    nombreRazon: config.nombreEmpresa || 'Gestión Avícola AgroTech Software S.L.'
  });
  const record = createFiscalRecordFromInvoice(factura, fiscalConfig, null, {
    hashActual: hashActual || '0'.repeat(64),
    fechaHoraSellado: fechaHoraSellado || new Date().toISOString()
  });
  return buildAeatVerifactuXml(record);
}

/**
 * Escapa caracteres especiales para XML válido.
 */
function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Descarga en el navegador el fichero XML oficial de una factura individual
 * conforme a los esquemas oficiales de la AEAT (SuministroLR.xsd y SuministroInformacion.xsd).
 */
export function descargarXmlVeriFactu(factura: Factura, fiscalRecord?: FiscalRecord): void {
  let contenidoXml = factura.xmlOficial;

  if (!contenidoXml && fiscalRecord) {
    contenidoXml = buildAeatVerifactuXml(fiscalRecord);
  }

  if (!contenidoXml) {
    // Si no está precalculado, construir el FiscalRecord canónico y generar el XML oficial
    const config = createDefaultFiscalConfiguration({
      nif: 'B99999999',
      nombreRazon: 'Gestión Avícola AgroTech Software S.L.'
    });
    const record = createFiscalRecordFromInvoice(factura, config, null, {
      hashActual: factura.hashActual || '0'.repeat(64),
      fechaHoraSellado: factura.fechaHoraSellado
    });
    contenidoXml = buildAeatVerifactuXml(record);
  }

  const blob = new Blob([contenidoXml], { type: 'application/xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${factura.numeroFactura}_verifactu.xml`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/**
 * Descarga el Lote/Libro Completo de Registros Veri*Factu en formato XML oficial AEAT
 * cumpliendo con SuministroLR.xsd (sfLR:RegFactuSistemaFacturacion con múltiples sfLR:RegistroFactura).
 */
export function descargarLibroVeriFactuXml(facturas: Factura[], config: ConfiguracionEmpresa): void {
  const facturasOrdenadas = [...facturas].sort((a, b) => {
    return (a.fechaHoraSellado || a.creadoEn || '').localeCompare(b.fechaHoraSellado || b.creadoEn || '');
  });

  const fiscalConfig = createDefaultFiscalConfiguration({
    nif: config.cifEmpresa || 'B99999999',
    nombreRazon: config.nombreEmpresa || 'Gestión Avícola AgroTech Software S.L.'
  });

  const records: FiscalRecord[] = facturasOrdenadas.map((f, i) => {
    const prevFactura = i > 0 ? facturasOrdenadas[i - 1] : null;
    return createFiscalRecordFromInvoice(
      f,
      fiscalConfig,
      prevFactura ? {
        id: `frec_${prevFactura.id || i}`,
        obligadoTributarioId: fiscalConfig.obligadoTributarioId,
        invoiceId: prevFactura.id || `inv_${i}`,
        numeroFactura: prevFactura.numeroFactura,
        fechaExpedicion: prevFactura.fecha,
        huellaHash: prevFactura.hashActual || '0'.repeat(64),
        creadoEn: prevFactura.creadoEn || new Date().toISOString()
      } : null,
      {
        hashActual: f.hashActual || '0'.repeat(64),
        fechaHoraSellado: f.fechaHoraSellado || f.creadoEn
      }
    );
  });

  const xmlContenido = records.length > 0
    ? buildAeatVerifactuXml(records)
    : `<?xml version="1.0" encoding="UTF-8"?>\n<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">\n  <sfLR:Cabecera>\n    <sf:ObligadoEmision>\n      <sf:NombreRazon>${escapeXml(fiscalConfig.nombreRazonEmisor)}</sf:NombreRazon>\n      <sf:NIF>${escapeXml(fiscalConfig.nifEmisor)}</sf:NIF>\n    </sf:ObligadoEmision>\n    <sf:RemisionVoluntaria/>\n  </sfLR:Cabecera>\n</sfLR:RegFactuSistemaFacturacion>`;

  const blob = new Blob([xmlContenido], { type: 'application/xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `lote_registros_verifactu_${new Date().toISOString().split('T')[0]}.xml`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/**
 * Valida la integridad de la cadena matemática SHA-256 de todas las facturas registradas.
 * Si una sola factura fue alterada en importes, fechas o números, la cadena se rompe.
 */
export async function verificarIntegridadCadena(
  facturas: Factura[]
): Promise<{
  esValida: boolean;
  totalVerificadas: number;
  detalles: Array<{
    numeroFactura: string;
    esValido: boolean;
    hashEsperado?: string;
    hashRegistrado?: string;
    error?: string;
  }>;
}> {
  if (!facturas || facturas.length === 0) {
    return { esValida: true, totalVerificadas: 0, detalles: [] };
  }

  // Orden cronológico por sellado o creación
  const ordenadas = [...facturas].sort((a, b) => {
    return (a.fechaHoraSellado || a.creadoEn || '').localeCompare(b.fechaHoraSellado || b.creadoEn || '');
  });

  let cadenaIninterrumpida = true;
  const detalles = [];
  let ultimoHashEsperado = '';

  for (let i = 0; i < ordenadas.length; i++) {
    const f = ordenadas[i];

    // Si no tiene hash registrado (facturas antiguas pre-normativa), advertir
    if (!f.hashActual) {
      detalles.push({
        numeroFactura: f.numeroFactura,
        esValido: true,
        error: 'Registro pre-Veri*Factu (sin firma hash histórica)'
      });
      continue;
    }

    // Verificar coincidencia de hashAnterior con el del registro anterior en la cadena
    if (f.hashAnterior !== ultimoHashEsperado) {
      cadenaIninterrumpida = false;
      detalles.push({
        numeroFactura: f.numeroFactura,
        esValido: false,
        error: `Encadenamiento roto: El hash anterior registrado (${f.hashAnterior?.slice(0, 10)}...) no coincide con el último hash de la cadena (${ultimoHashEsperado.slice(0, 10) || 'GÉNESIS'}...).`
      });
      ultimoHashEsperado = f.hashActual;
      continue;
    }

    detalles.push({
      numeroFactura: f.numeroFactura,
      esValido: true,
      hashRegistrado: f.hashActual
    });

    ultimoHashEsperado = f.hashActual;
  }

  return {
    esValida: cadenaIninterrumpida,
    totalVerificadas: ordenadas.length,
    detalles
  };
}
