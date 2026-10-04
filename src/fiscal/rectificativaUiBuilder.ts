/**
 * CONSTRUCTOR Y VALIDADOR CANÓNICO DE FACTURA RECTIFICATIVA DESDE UI (VERI*FACTU)
 *
 * Conecta de forma determinista y sin pérdida de datos el estado del formulario de UI
 * (`ModalFacturaRectificativa`) con el borrador comercial `Factura` que ingresa en
 * `emitFiscalInvoice()` -> `FiscalRecord` -> `calculateAltaHash()` -> `buildAeatVerifactuXml()`
 * -> `validateXmlAgainstOfficialXsd()` -> `executeAuthoritativeOutboxSubmission()`.
 *
 * Cubre todas las variantes reglamentarias de la Orden HAC/1177/2024 y RD 1007/2023:
 * - Claves de factura rectificativa AEAT: R1, R2, R3, R4 y R5 (simplificada).
 * - Tipo de rectificativa:
 *   - Por diferencias ('por_diferencias' -> XML <sf:TipoRectificativa>I</sf:TipoRectificativa>)
 *   - Por sustitución ('por_sustitucion' -> XML <sf:TipoRectificativa>S</sf:TipoRectificativa> + <sf:ImporteRectificacion>)
 * - Modo operativo en UI:
 *   - Anulación económica total ('anulacion_total')
 *   - Rectificación parcial / ajuste de líneas ('rectificacion_parcial')
 * - Soporte de una o múltiples facturas rectificadas (<sf:FacturasRectificadas> -> <sf:IDFacturaRectificada>).
 * - Soporte de Recargo de Equivalencia (positivo, negativo en diferencias, o cero en sustitución).
 */

import {
  Factura,
  LineaDocumentoVenta,
  TipoFacturaAEAT,
  TipoRectificativa,
  TotalesFiscales
} from '../types';

export type ModoRectificacionUI = 'anulacion_total' | 'rectificacion_parcial';
export type ClaveTipoFacturaRectificativaAEAT = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type CodigoMotivoRectificativaUI = '01' | '02' | '03' | '04' | '05';

export const MOTIVOS_RECTIFICATIVA_AEAT: ReadonlyArray<{
  readonly codigo: CodigoMotivoRectificativaUI;
  readonly label: string;
  readonly claveFacturaSugerida: ClaveTipoFacturaRectificativaAEAT;
}> = [
  {
    codigo: '01',
    label: '01 - Error en importe, precio unitario o unidades entregadas (Art. 80.1 y 80.2 LIVA)',
    claveFacturaSugerida: 'R1'
  },
  {
    codigo: '02',
    label: '02 - Devolución de mercancía, envases o embalajes (Art. 80.1 LIVA)',
    claveFacturaSugerida: 'R1'
  },
  {
    codigo: '03',
    label: '03 - Descuentos o bonificaciones posteriores a la operación (Art. 80.1 LIVA)',
    claveFacturaSugerida: 'R1'
  },
  {
    codigo: '04',
    label: '04 - Concurso de acreedores o créditos incobrables (Art. 80.3 / 80.4 LIVA)',
    claveFacturaSugerida: 'R2'
  },
  {
    codigo: '05',
    label: '05 - Error en datos fiscales / Resto de causas reglamentarias',
    claveFacturaSugerida: 'R4'
  }
];

export const CLAVES_FACTURA_RECTIFICATIVA_AEAT: ReadonlyArray<{
  readonly clave: ClaveTipoFacturaRectificativaAEAT;
  readonly label: string;
}> = [
  {
    clave: 'R1',
    label: 'R1 - Error fundado en derecho y Art. 80 Uno, Dos y Seis LIVA'
  },
  {
    clave: 'R2',
    label: 'R2 - Concurso de acreedores (Art. 80.3 LIVA)'
  },
  {
    clave: 'R3',
    label: 'R3 - Deudas incobrables (Art. 80.4 LIVA)'
  },
  {
    clave: 'R4',
    label: 'R4 - Factura Rectificativa: Resto de causas'
  },
  {
    clave: 'R5',
    label: 'R5 - Factura Rectificativa en facturas simplificadas (sin destinatario)'
  }
];

export interface RectificativaUiStateInput {
  facturaOriginal: Factura;
  facturasAdicionalesRectificadas?: ReadonlyArray<Pick<Factura, 'id' | 'numeroFactura' | 'fecha' | 'totales'>>;
  existingInvoices?: ReadonlyArray<Pick<Factura, 'numeroFactura'>>;
  numeroFacturaOverride?: string;
  idOverride?: string;
  fecha: string; // YYYY-MM-DD
  modo: ModoRectificacionUI;
  tipoRectificativa: TipoRectificativa; // 'por_diferencias' | 'por_sustitucion'
  claveTipoFactura?: ClaveTipoFacturaRectificativaAEAT;
  codigoMotivo: CodigoMotivoRectificativaUI;
  motivoTexto: string;
  lineasEditadas?: LineaDocumentoVenta[];
  importeRectificacionOverride?: {
    baseRectificada: number;
    cuotaRectificada: number;
    cuotaRecargoRectificado?: number;
  };
  nifEmisor?: string;
  subsanacion?: 'S' | 'N';
  rechazoPrevio?: 'S' | 'N' | 'X';
  refExterna?: string;
}

/**
 * Calcula el siguiente número correlativo de serie rectificativa R-AAAA-XXXX.
 */
export function getSiguienteNumeroRectificativa(
  facturas: ReadonlyArray<Pick<Factura, 'numeroFactura'>>,
  fecha: string
): string {
  const year = (fecha || new Date().toISOString()).split('-')[0] || String(new Date().getFullYear());
  const prefijo = `R-${year}-`;
  const numeros = (facturas || [])
    .filter(f => f.numeroFactura && f.numeroFactura.startsWith(prefijo))
    .map(f => {
      const partes = f.numeroFactura.split('-');
      const num = parseInt(partes[partes.length - 1], 10);
      return isNaN(num) ? 0 : num;
    });
  const max = numeros.length > 0 ? Math.max(...numeros) : 0;
  return `${prefijo}${String(max + 1).padStart(4, '0')}`;
}

/**
 * Determina la clave TipoFactura rectificativa por defecto a partir de la factura original.
 * Si la factura original es simplificada (F2 o sin NIF/IDOtro de destinatario), corresponde R5;
 * en caso contrario, R1.
 */
export function inferDefaultClaveRectificativa(
  facturaOriginal: Factura
): ClaveTipoFacturaRectificativaAEAT {
  if (
    facturaOriginal.tipoFactura === 'F2' ||
    facturaOriginal.tipoFactura === 'R5' ||
    (!facturaOriginal.clienteCif && !facturaOriginal.clienteIdOtro)
  ) {
    return 'R5';
  }
  return 'R1';
}

/**
 * Genera las líneas iniciales de la factura rectificativa según la combinación de
 * `modo` ('anulacion_total' | 'rectificacion_parcial') y `tipoRectificativa`
 * ('por_diferencias' | 'por_sustitucion').
 *
 * - Por diferencias ('I') + anulación total: cantidades y subtotales negativos (-100% de la original).
 * - Por diferencias ('I') + rectificación parcial: cantidades y subtotales negativos iniciales editables.
 * - Por sustitución ('S') + anulación total: cantidades y subtotales a 0.00 (sustituye la original por 0,00 €,
 *   informando en ImporteRectificacion la base y cuota originales sustituidas).
 * - Por sustitución ('S') + rectificación parcial: cantidades y subtotales positivos originales para que
 *   el usuario indique los nuevos importes definitivos que sustituyen a los originales.
 */
export function computeInitialRectificativaLines(
  facturaOriginal: Factura,
  modo: ModoRectificacionUI,
  tipoRectificativa: TipoRectificativa
): LineaDocumentoVenta[] {
  const sourceLines: LineaDocumentoVenta[] =
    facturaOriginal.lineas && facturaOriginal.lineas.length > 0
      ? facturaOriginal.lineas
      : [
          {
            id: `lin-fallback-${facturaOriginal.id}`,
            loteEnvasadoId: 'N/A',
            codigoLoteEnvasado: 'N/A',
            formatoId: 'FMT-AJUSTE',
            nombreFormato: facturaOriginal.descripcionOperacion || 'Rectificación de operación comercial',
            cantidadEstuches: 1,
            precioUnitario: Math.abs(facturaOriginal.totales.baseImponible),
            subtotal: Math.abs(facturaOriginal.totales.baseImponible),
            fechaConsumoPreferente: facturaOriginal.fecha,
            trazabilidadPuesta: []
          }
        ];

  if (tipoRectificativa === 'por_diferencias') {
    return sourceLines.map((l, idx) => ({
      ...l,
      id: `rect-lin-${Date.now()}-${idx}`,
      cantidadEstuches: -Math.abs(l.cantidadEstuches),
      precioUnitario: Math.abs(l.precioUnitario),
      subtotal: -Math.abs(l.subtotal)
    }));
  }

  // tipoRectificativa === 'por_sustitucion'
  if (modo === 'anulacion_total') {
    return sourceLines.map((l, idx) => ({
      ...l,
      id: `rect-lin-${Date.now()}-${idx}`,
      cantidadEstuches: 0,
      precioUnitario: Math.abs(l.precioUnitario),
      subtotal: 0
    }));
  }

  // por_sustitucion + rectificacion_parcial: importes definitivos sustituidos (positivos)
  return sourceLines.map((l, idx) => ({
    ...l,
    id: `rect-lin-${Date.now()}-${idx}`,
    cantidadEstuches: Math.abs(l.cantidadEstuches),
    precioUnitario: Math.abs(l.precioUnitario),
    subtotal: Math.abs(l.subtotal)
  }));
}

/**
 * Calcula los totales fiscales de las líneas de la rectificativa manteniendo coherencia exacta
 * con el porcentaje de IVA y el recargo de equivalencia de la factura original.
 */
export function calculateRectificativaTotales(
  facturaOriginal: Factura,
  lineas: ReadonlyArray<LineaDocumentoVenta>
): TotalesFiscales {
  const baseImponible = Number(
    lineas.reduce((acc, l) => acc + (Number(l.subtotal) || 0), 0).toFixed(2)
  );
  const porcentajeIva = facturaOriginal.totales?.porcentajeIva ?? 4;
  const cuotaIva = Number(((baseImponible * porcentajeIva) / 100).toFixed(2));
  const aplicaRecargo = Boolean(facturaOriginal.totales?.aplicaRecargo);
  const porcentajeRecargo = aplicaRecargo
    ? (facturaOriginal.totales?.porcentajeRecargo || (porcentajeIva === 4 ? 0.5 : 1.4))
    : 0;
  const cuotaRecargo = aplicaRecargo
    ? Number(((baseImponible * porcentajeRecargo) / 100).toFixed(2))
    : 0;
  const totalDocumento = Number((baseImponible + cuotaIva + cuotaRecargo).toFixed(2));

  return {
    baseImponible,
    porcentajeIva,
    cuotaIva,
    aplicaRecargo,
    porcentajeRecargo,
    cuotaRecargo,
    totalDocumento
  };
}

/**
 * Calcula el desglose de ImporteRectificacion (BaseRectificada, CuotaRectificada y CuotaRecargoRectificado)
 * sumando los totales de la factura original y cualesquiera facturas adicionales rectificadas.
 */
export function computeDefaultImporteRectificacion(
  facturaOriginal: Factura,
  facturasAdicionalesRectificadas?: ReadonlyArray<Pick<Factura, 'totales'>>
): {
  baseRectificada: number;
  cuotaRectificada: number;
  cuotaRecargoRectificado?: number;
} {
  const all = [facturaOriginal, ...(facturasAdicionalesRectificadas || [])];
  const baseRectificada = Number(
    all.reduce((acc, f) => acc + (f.totales?.baseImponible ?? 0), 0).toFixed(2)
  );
  const cuotaRectificada = Number(
    all.reduce((acc, f) => acc + (f.totales?.cuotaIva ?? 0), 0).toFixed(2)
  );
  const hasRecargo = all.some(
    f => Boolean(f.totales?.aplicaRecargo) || (f.totales?.cuotaRecargo ?? 0) !== 0
  );
  const cuotaRecargoRectificado = Number(
    all.reduce((acc, f) => acc + (f.totales?.cuotaRecargo ?? 0), 0).toFixed(2)
  );

  return {
    baseRectificada,
    cuotaRectificada,
    ...(hasRecargo ? { cuotaRecargoRectificado } : {})
  };
}

/**
 * Construye y valida el objeto `Factura` rectificativa completo a partir del estado de la UI.
 * Lanza un Error descriptivo si faltan datos obligatorios (motivo, líneas o incoherencia de destinatario).
 */
export function buildRectificativaFacturaFromUiState(
  input: RectificativaUiStateInput
): Factura {
  const {
    facturaOriginal,
    facturasAdicionalesRectificadas,
    existingInvoices = [facturaOriginal],
    numeroFacturaOverride,
    idOverride,
    fecha,
    modo,
    tipoRectificativa,
    codigoMotivo,
    motivoTexto,
    lineasEditadas,
    importeRectificacionOverride,
    nifEmisor,
    subsanacion,
    rechazoPrevio,
    refExterna
  } = input;

  if (!facturaOriginal || !facturaOriginal.numeroFactura) {
    throw new Error('Se requiere una factura original válida para emitir una factura rectificativa.');
  }

  const cleanMotivoTexto = (motivoTexto || '').trim();
  if (!cleanMotivoTexto) {
    throw new Error('Por favor, especifique la explicación detallada del motivo de la rectificación.');
  }

  const claveTipoFactura: ClaveTipoFacturaRectificativaAEAT =
    input.claveTipoFactura || inferDefaultClaveRectificativa(facturaOriginal);

  if (!['R1', 'R2', 'R3', 'R4', 'R5'].includes(claveTipoFactura)) {
    throw new Error(`Clave de factura rectificativa inválida: '${claveTipoFactura}'. Debe ser R1, R2, R3, R4 o R5.`);
  }

  // Validar coherencia entre R5 (simplificada) y R1..R4 (con destinatario obligatorio)
  if (claveTipoFactura !== 'R5' && !facturaOriginal.clienteCif && !facturaOriginal.clienteIdOtro) {
    throw new Error(
      `La factura rectificativa tipo ${claveTipoFactura} exige identificación fiscal del destinatario (NIF o IDOtro). Para rectificar facturas simplificadas sin destinatario utilice R5.`
    );
  }

  const lineas =
    lineasEditadas && lineasEditadas.length > 0
      ? lineasEditadas
      : computeInitialRectificativaLines(facturaOriginal, modo, tipoRectificativa);

  if (lineas.length === 0) {
    throw new Error('La factura rectificativa debe contener al menos una línea.');
  }

  const totales = calculateRectificativaTotales(facturaOriginal, lineas);

  const motivoLabel =
    MOTIVOS_RECTIFICATIVA_AEAT.find(m => m.codigo === codigoMotivo)?.label || codigoMotivo;
  const motivoCompleto = `[${motivoLabel}] ${cleanMotivoTexto}`;

  // Construir lista normalizada de facturas rectificadas (1 o varias)
  const facturasRectificadasList = [
    {
      idFactura: facturaOriginal.id,
      ...(nifEmisor ? { idEmisorFactura: nifEmisor } : {}),
      numeroFactura: facturaOriginal.numeroFactura,
      fechaExpedicion: facturaOriginal.fecha
    },
    ...(facturasAdicionalesRectificadas || []).map(f => ({
      idFactura: f.id,
      ...(nifEmisor ? { idEmisorFactura: nifEmisor } : {}),
      numeroFactura: f.numeroFactura,
      fechaExpedicion: f.fecha
    }))
  ];

  // ImporteRectificacion solo aplica cuando tipoRectificativa === 'por_sustitucion' ('S')
  const importeRectificacion =
    tipoRectificativa === 'por_sustitucion'
      ? importeRectificacionOverride ||
        computeDefaultImporteRectificacion(facturaOriginal, facturasAdicionalesRectificadas)
      : undefined;

  const numeroRectificativa =
    numeroFacturaOverride ||
    getSiguienteNumeroRectificativa(existingInvoices, fecha);

  const isR5Simplified = claveTipoFactura === 'R5';

  const nuevaFactura: Factura = {
    id: idOverride || `rect-${Date.now()}`,
    numeroFactura: numeroRectificativa,
    fecha,
    clienteId: facturaOriginal.clienteId,
    clienteNombre: facturaOriginal.clienteNombre,
    clienteCif: isR5Simplified ? '' : facturaOriginal.clienteCif,
    clienteDireccion: facturaOriginal.clienteDireccion,
    clienteRecargoEquivalencia: facturaOriginal.clienteRecargoEquivalencia,
    clienteIdOtro: isR5Simplified ? undefined : facturaOriginal.clienteIdOtro,
    albaranesAsociados: [...(facturaOriginal.albaranesAsociados || [])],
    lineas: lineas.map(l => ({ ...l })),
    totales,
    estadoPago: 'pagada',
    formaPago: facturaOriginal.formaPago,
    esVentaDirecta: facturaOriginal.esVentaDirecta,
    notas: `Factura Rectificativa (${claveTipoFactura} - ${
      tipoRectificativa === 'por_diferencias' ? 'Por Diferencias [I]' : 'Por Sustitución [S]'
    }) de ${facturasRectificadasList.map(f => f.numeroFactura).join(', ')}. Motivo: ${motivoCompleto}`,
    creadoEn: new Date().toISOString(),
    tipoFactura: claveTipoFactura as TipoFacturaAEAT,
    esRectificativa: true,
    facturaRectificadaId: facturaOriginal.id,
    facturaRectificadaNumero: facturaOriginal.numeroFactura,
    facturaRectificadaFecha: facturaOriginal.fecha,
    facturasRectificadas: facturasRectificadasList,
    tipoRectificativa,
    importeRectificacion,
    baseRectificada: importeRectificacion?.baseRectificada,
    cuotaRectificada: importeRectificacion?.cuotaRectificada,
    cuotaRecargoRectificado: importeRectificacion?.cuotaRecargoRectificado,
    motivoRectificativa: motivoCompleto,
    codigoMotivoRectificativa: codigoMotivo,
    descripcionOperacion: `Rectificación (${claveTipoFactura}) de factura ${facturasRectificadasList
      .map(f => f.numeroFactura)
      .join(', ')}: ${cleanMotivoTexto}`,
    subsanacion,
    rechazoPrevio,
    refExterna
  };

  return nuevaFactura;
}
