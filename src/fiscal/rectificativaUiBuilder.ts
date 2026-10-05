/**
 * CONSTRUCTOR Y VALIDADOR CANÓNICO DE FACTURA RECTIFICATIVA DESDE UI Y DOMINIO (VERI*FACTU)
 *
 * Conecta de forma determinista y sin pérdida de datos el estado del formulario de UI
 * (`ModalFacturaRectificativa`) con el borrador comercial `Factura` que ingresa en
 * `emitFiscalInvoice()` -> `FiscalRecord` -> `calculateAltaHash()` -> `buildAeatVerifactuXml()`
 * -> `validateXmlAgainstOfficialXsd()` -> `executeAuthoritativeOutboxSubmission()`.
 *
 * Garantías semánticas y reglamentarias (Orden HAC/1177/2024 y RD 1007/2023):
 * 1. FechaOperacion reglamentaria (P1):
 *    - En rectificativas de una única factura: consigna la fecha de operación de la factura original
 *      (o su fecha de expedición si no tenía fecha de operación distinta).
 *    - En rectificativas de múltiples facturas: consigna la fecha de operación MÁS RECIENTE entre
 *      las facturas rectificadas.
 * 2. Validación simétrica y estricta de R5 vs R1..R4 (P1):
 *    - R5 está reservada EXCLUSIVAMENTE a la rectificación de facturas simplificadas (F2 o R5).
 *    - Se rechaza emitir R5 sobre una factura F1 (tanto con destinatario como sin destinatario art. 6.1.d) o F3.
 *    - Se rechaza incluir NIF/IDOtro de destinatario en una R5.
 * 3. Integridad de FacturasRectificadas (P2):
 *    - Prohibición de duplicar la misma factura dentro de FacturasRectificadas.
 *    - Prohibición de rectificar facturas pertenecientes a otro obligado tributario (NIF emisor distinto).
 * 4. Coherencia estricta entre codigoMotivo y Clave TipoFactura R1/R2/R3/R4/R5 (P2):
 *    - 01, 02, 03 -> R1 (Error fundado en derecho / Art. 80.1, 80.2 y 80.6 LIVA) o R5 (si simplificada)
 *    - 04 -> R2 (Concurso de acreedores - Art. 80.3 LIVA)
 *    - 06 -> R3 (Deudas / créditos incobrables - Art. 80.4 LIVA)
 *    - 05 -> R4 (Resto de causas) o R5 (si simplificada)
 */

import {
  Factura,
  LineaDocumentoVenta,
  TipoFacturaAEAT,
  TipoRectificativa,
  TotalesFiscales
} from '../types';
import { formatFechaExpedicionFiscal } from './hashService';

export type ModoRectificacionUI = 'anulacion_total' | 'rectificacion_parcial';
export type ClaveTipoFacturaRectificativaAEAT = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type CodigoMotivoRectificativaUI = '01' | '02' | '03' | '04' | '05' | '06';

export const MOTIVOS_RECTIFICATIVA_AEAT: ReadonlyArray<{
  readonly codigo: CodigoMotivoRectificativaUI;
  readonly label: string;
  readonly claveFacturaSugerida: ClaveTipoFacturaRectificativaAEAT;
  readonly clavesCompatibles: ReadonlyArray<ClaveTipoFacturaRectificativaAEAT>;
}> = [
  {
    codigo: '01',
    label: '01 - Error fundado en derecho, importe, precio o unidades (Art. 80.1, 80.2 y 80.6 LIVA)',
    claveFacturaSugerida: 'R1',
    clavesCompatibles: ['R1', 'R5']
  },
  {
    codigo: '02',
    label: '02 - Devolución de mercancía, envases o embalajes (Art. 80.1 LIVA)',
    claveFacturaSugerida: 'R1',
    clavesCompatibles: ['R1', 'R5']
  },
  {
    codigo: '03',
    label: '03 - Descuentos o bonificaciones posteriores a la operación / Rappel (Art. 80.1.2º LIVA)',
    claveFacturaSugerida: 'R1',
    clavesCompatibles: ['R1', 'R5']
  },
  {
    codigo: '04',
    label: '04 - Concurso de acreedores dictado por auto judicial (Art. 80.3 LIVA)',
    claveFacturaSugerida: 'R2',
    clavesCompatibles: ['R2']
  },
  {
    codigo: '06',
    label: '06 - Créditos total o parcialmente incobrables (Art. 80.4 LIVA)',
    claveFacturaSugerida: 'R3',
    clavesCompatibles: ['R3']
  },
  {
    codigo: '05',
    label: '05 - Error en datos fiscales / Resto de causas reglamentarias',
    claveFacturaSugerida: 'R4',
    clavesCompatibles: ['R4', 'R5']
  }
];

export const DEFAULT_MOTIVO_BY_CLAVE: Record<ClaveTipoFacturaRectificativaAEAT, CodigoMotivoRectificativaUI> = {
  R1: '01',
  R2: '04',
  R3: '06',
  R4: '05',
  R5: '01'
};

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
    label: 'R5 - Factura Rectificativa en facturas simplificadas (F2)'
  }
];

export interface RectificativaReferencedInvoiceInput {
  readonly id?: string;
  readonly numeroFactura: string;
  readonly fecha: string;
  readonly fechaOperacion?: string;
  readonly tipoFactura?: TipoFacturaAEAT;
  readonly clienteCif?: string;
  readonly clienteIdOtro?: Factura['clienteIdOtro'];
  readonly facturaSinIdentifDestinatarioArt61d?: 'S' | 'N';
  readonly obligadoTributarioId?: string;
  readonly idEmisorFactura?: string;
  readonly totales?: TotalesFiscales;
}

export interface RectificativaUiStateInput {
  facturaOriginal: Factura & { obligadoTributarioId?: string; idEmisorFactura?: string };
  facturasAdicionalesRectificadas?: ReadonlyArray<RectificativaReferencedInvoiceInput>;
  existingInvoices?: ReadonlyArray<Pick<Factura, 'numeroFactura'>>;
  numeroFacturaOverride?: string;
  idOverride?: string;
  fecha: string; // YYYY-MM-DD
  fechaOperacionOverride?: string; // Opcional; si se omite se calcula reglamentariamente desde las facturas rectificadas
  modo: ModoRectificacionUI;
  tipoRectificativa: TipoRectificativa; // 'por_diferencias' | 'por_sustitucion'
  claveTipoFactura?: ClaveTipoFacturaRectificativaAEAT;
  codigoMotivo?: CodigoMotivoRectificativaUI;
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
 * Normaliza una fecha ('YYYY-MM-DD' o 'DD-MM-YYYY') al formato ISO 'YYYY-MM-DD'
 * para comparaciones cronológicas exactas.
 */
export function normalizeToIsoDate(fecha: string): string {
  const ddMmYyyy = formatFechaExpedicionFiscal(fecha); // Valida calendario y devuelve DD-MM-YYYY
  const [dd, mm, yyyy] = ddMmYyyy.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Determina la FechaOperacion reglamentaria de una factura rectificativa según criterio AEAT:
 * - Si rectifica 1 factura: la fecha de operación de la factura original (o su fecha de expedición si no tenía fechaOperacion separada).
 * - Si rectifica varias facturas: la fecha de operación MÁS RECIENTE (máxima) entre todas las facturas rectificadas.
 */
export function computeRectificativaFechaOperacion(
  facturasRectificadas: ReadonlyArray<{
    readonly fechaExpedicion?: string;
    readonly fecha?: string;
    readonly fechaOperacion?: string;
  }>
): string {
  if (!facturasRectificadas || facturasRectificadas.length === 0) {
    throw new Error('computeRectificativaFechaOperacion: Se requiere al menos una factura rectificada con fecha válida.');
  }

  let maxIso = '';
  for (const item of facturasRectificadas) {
    const rawOpDate = (item.fechaOperacion || item.fechaExpedicion || item.fecha || '').trim();
    if (!rawOpDate) {
      throw new Error('computeRectificativaFechaOperacion: Una de las facturas rectificadas carece de fecha de operación y de fecha de expedición.');
    }
    const iso = normalizeToIsoDate(rawOpDate);
    if (!maxIso || iso > maxIso) {
      maxIso = iso;
    }
  }

  return maxIso;
}

/**
 * Valida la coherencia semántica entre la clave de factura rectificativa (R1..R5) y el código de motivo.
 */
export function validateMotivoCoherenceWithClave(
  claveTipoFactura: ClaveTipoFacturaRectificativaAEAT,
  codigoMotivo: CodigoMotivoRectificativaUI
): void {
  const motivoSpec = MOTIVOS_RECTIFICATIVA_AEAT.find(m => m.codigo === codigoMotivo);
  if (!motivoSpec) {
    throw new Error(`Código de motivo de rectificación desconocido: '${codigoMotivo}'.`);
  }
  if (!motivoSpec.clavesCompatibles.includes(claveTipoFactura)) {
    throw new Error(
      `Incoherencia normativa entre TipoFactura '${claveTipoFactura}' y el motivo '${motivoSpec.label}'. ` +
      `El motivo '${codigoMotivo}' solo es compatible con: ${motivoSpec.clavesCompatibles.join(', ')} ` +
      `(para ${claveTipoFactura} utilice el motivo '${DEFAULT_MOTIVO_BY_CLAVE[claveTipoFactura]}').`
    );
  }
}

/**
 * Determina si una factura original es legítimamente una factura simplificada susceptible de rectificarse mediante R5.
 * IMPORTANTE: Una factura F1 sin identificación de destinatario (Art. 6.1.d RD 1619/2012) es una factura COMPLETA,
 * NO una factura simplificada (F2, Art. 7.2 y 7.3 RD 1619/2012), por lo que NO admite R5.
 */
export function isSimplifiedInvoiceForR5(
  factura: {
    readonly tipoFactura?: TipoFacturaAEAT;
    readonly clienteCif?: string;
    readonly clienteIdOtro?: Factura['clienteIdOtro'];
    readonly facturaSinIdentifDestinatarioArt61d?: 'S' | 'N';
  }
): boolean {
  const tipo = factura.tipoFactura;
  if (tipo === 'F2' || tipo === 'R5') {
    return true;
  }
  if (tipo === 'F1' || tipo === 'F3' || tipo === 'R1' || tipo === 'R2' || tipo === 'R3' || tipo === 'R4') {
    return false;
  }
  // Si no tiene tipoFactura explícito, solo se considera simplificada si carece de NIF/IDOtro y no es F1 art. 61.d
  if (factura.facturaSinIdentifDestinatarioArt61d === 'S') {
    return false;
  }
  return !factura.clienteCif && !factura.clienteIdOtro;
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
 * Si la factura original es simplificada (F2 o R5), corresponde R5; en caso contrario, R1.
 */
export function inferDefaultClaveRectificativa(
  facturaOriginal: Factura
): ClaveTipoFacturaRectificativaAEAT {
  if (isSimplifiedInvoiceForR5(facturaOriginal)) {
    return 'R5';
  }
  return 'R1';
}

/**
 * Genera las líneas iniciales de la factura rectificativa según la combinación de
 * `modo` ('anulacion_total' | 'rectificacion_parcial') y `tipoRectificativa`
 * ('por_diferencias' | 'por_sustitucion').
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
  facturasAdicionalesRectificadas?: ReadonlyArray<Pick<RectificativaReferencedInvoiceInput, 'totales'>>
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
 * Lanza un Error descriptivo si faltan datos obligatorios o si se vulnera cualquier regla semántica AEAT.
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
    fechaOperacionOverride,
    modo,
    tipoRectificativa,
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

  // Resolver y validar coherencia estricta entre claveTipoFactura (R1..R5) y codigoMotivo ('01'..'06')
  const codigoMotivo: CodigoMotivoRectificativaUI =
    input.codigoMotivo || DEFAULT_MOTIVO_BY_CLAVE[claveTipoFactura];
  validateMotivoCoherenceWithClave(claveTipoFactura, codigoMotivo);

  const allReferencedOriginals: RectificativaReferencedInvoiceInput[] = [
    facturaOriginal,
    ...(facturasAdicionalesRectificadas || [])
  ];

  // 1. Validación simétrica de R5 vs R1..R4 sobre todas las facturas rectificadas
  const isOriginalSimplified = isSimplifiedInvoiceForR5(facturaOriginal);
  if (claveTipoFactura === 'R5') {
    if (!isOriginalSimplified) {
      throw new Error(
        `Violación normativa AEAT (R5): No se permite emitir una factura rectificativa simplificada R5 sobre la factura '${facturaOriginal.numeroFactura}' ` +
        `de tipo '${facturaOriginal.tipoFactura || 'F1'}'. El tipo R5 está reservado exclusivamente a la rectificación de facturas simplificadas (F2 o R5).`
      );
    }
    for (const extra of facturasAdicionalesRectificadas || []) {
      if (extra.tipoFactura && !isSimplifiedInvoiceForR5(extra)) {
        throw new Error(
          `Violación normativa AEAT (R5): La factura adicional '${extra.numeroFactura}' es de tipo '${extra.tipoFactura}' (no simplificada) y no admite rectificación mediante R5.`
        );
      }
    }
  } else {
    // R1, R2, R3, R4
    const allowF1SinIdentifArt61d =
      facturaOriginal.tipoFactura === 'F1' &&
      facturaOriginal.facturaSinIdentifDestinatarioArt61d === 'S';

    if (!facturaOriginal.clienteCif && !facturaOriginal.clienteIdOtro && !allowF1SinIdentifArt61d) {
      throw new Error(
        `La factura rectificativa tipo ${claveTipoFactura} exige identificación fiscal del destinatario (NIF o IDOtro). Para rectificar facturas simplificadas F2 sin destinatario utilice R5.`
      );
    }
    if (facturaOriginal.tipoFactura === 'F2' && !facturaOriginal.clienteCif && !facturaOriginal.clienteIdOtro) {
      throw new Error(
        `La factura original '${facturaOriginal.numeroFactura}' es una factura simplificada F2 sin destinatario identificado; debe rectificarse mediante R5.`
      );
    }
  }

  // 2. Validación de integridad de FacturasRectificadas (sin duplicados y mismo obligado tributario)
  const expectedEmisorNif = (
    nifEmisor ||
    facturaOriginal.idEmisorFactura ||
    facturaOriginal.obligadoTributarioId ||
    ''
  ).trim().toUpperCase();

  const seenRectificadas = new Set<string>();
  const facturasRectificadasList: Array<{
    readonly idFactura?: string;
    readonly idEmisorFactura?: string;
    readonly numeroFactura: string;
    readonly fechaExpedicion: string;
    readonly fechaOperacion: string;
  }> = [];

  for (const refInv of allReferencedOriginals) {
    const cleanNum = (refInv.numeroFactura || '').trim();
    if (!cleanNum) {
      throw new Error('Todas las facturas rectificadas deben tener un número de factura válido.');
    }
    const cleanFechaExp = (refInv.fecha || '').trim();
    if (!cleanFechaExp) {
      throw new Error(`La factura rectificada '${cleanNum}' carece de fecha de expedición.`);
    }
    // Validar formato calendárico de fechaExpedicion
    formatFechaExpedicionFiscal(cleanFechaExp);

    const numKey = cleanNum.toUpperCase();
    if (seenRectificadas.has(numKey)) {
      throw new Error(
        `Factura rectificada duplicada: '${cleanNum}' se ha incluido más de una vez en la relación de FacturasRectificadas.`
      );
    }
    seenRectificadas.add(numKey);

    const refEmisor = (refInv.idEmisorFactura || refInv.obligadoTributarioId || '').trim().toUpperCase();
    if (expectedEmisorNif && refEmisor && refEmisor !== expectedEmisorNif) {
      throw new Error(
        `Violación de obligado tributario en FacturasRectificadas: la factura '${cleanNum}' pertenece al obligado '${refEmisor}', distinto del emisor '${expectedEmisorNif}'.`
      );
    }

    const opDateIso = normalizeToIsoDate(refInv.fechaOperacion || cleanFechaExp);
    facturasRectificadasList.push({
      ...(refInv.id ? { idFactura: refInv.id } : {}),
      ...((expectedEmisorNif || refEmisor) ? { idEmisorFactura: expectedEmisorNif || refEmisor } : {}),
      numeroFactura: cleanNum,
      fechaExpedicion: cleanFechaExp,
      fechaOperacion: opDateIso
    });
  }

  // 3. Calcular FechaOperacion reglamentaria (la de la factura original, o la más reciente si son varias)
  const resolvedFechaOperacion = fechaOperacionOverride !== undefined
    ? (fechaOperacionOverride.trim() ? normalizeToIsoDate(fechaOperacionOverride) : '')
    : computeRectificativaFechaOperacion(facturasRectificadasList);

  if (!resolvedFechaOperacion) {
    throw new Error(
      `FechaOperacion obligatoria en factura rectificativa (${claveTipoFactura}): debe consignarse la fecha de operación original (o la más reciente si rectifica varias facturas).`
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

  // ImporteRectificacion solo aplica cuando tipoRectificativa === 'por_sustitucion' ('S')
  const importeRectificacion =
    tipoRectificativa === 'por_sustitucion'
      ? importeRectificacionOverride ||
        computeDefaultImporteRectificacion(facturaOriginal, facturasAdicionalesRectificadas)
      : undefined;

  const numeroRectificativa =
    numeroFacturaOverride ||
    getSiguienteNumeroRectificativa(existingInvoices, fecha);

  if (subsanacion !== 'S' && seenRectificadas.has(numeroRectificativa.trim().toUpperCase())) {
    throw new Error(
      `Número de factura rectificativa inválido ('${numeroRectificativa}'): una factura rectificativa no puede tener el mismo número de serie que la factura original que rectifica.`
    );
  }

  const isR5Simplified = claveTipoFactura === 'R5';

  const nuevaFactura: Factura = {
    id: idOverride || `rect-${Date.now()}`,
    numeroFactura: numeroRectificativa,
    numeracionAutoritativaBackend: !numeroFacturaOverride && subsanacion !== 'S',
    fecha,
    fechaOperacion: resolvedFechaOperacion,
    clienteId: facturaOriginal.clienteId,
    clienteNombre: facturaOriginal.clienteNombre,
    clienteCif: isR5Simplified ? '' : facturaOriginal.clienteCif,
    clienteDireccion: facturaOriginal.clienteDireccion,
    clienteRecargoEquivalencia: facturaOriginal.clienteRecargoEquivalencia,
    clienteIdOtro: isR5Simplified ? undefined : facturaOriginal.clienteIdOtro,
    facturaSinIdentifDestinatarioArt61d:
      !isR5Simplified && !facturaOriginal.clienteCif && !facturaOriginal.clienteIdOtro
        ? 'S'
        : undefined,
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
