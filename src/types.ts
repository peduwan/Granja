export type TipoCria = '0-Ecologico' | '1-Campero' | '2-Suelo' | '3-Jaula';

export interface Nave {
  id: string;
  codigo: string; // ej: NAV1
  nombre: string;
  tipoCria: TipoCria;
  codigoREGA: string;
  capacidadAves: number;
  activa: boolean;
  fechaEntrada?: string; // YYYY-MM-DD: Fecha de entrada del lote de gallinas en la nave
  edadSemanasEntrada?: number; // Semanas de vida de las gallinas al entrar (por defecto 18-24 semanas)
  razaGallinas?: string; // Estirpe/raza (ej: Lohmann Brown, Hy-Line, Isa Brown)
  observacionesLote?: string;
}

export interface CalibresHuevos {
  xl: number; // Super grandes (>73g)
  l: number;  // Grandes (63-73g)
  m: number;  // Medianos (53-63g)
  s: number;  // Pequeños (<53g)
}

export interface MermasRecogida {
  rotos: number;
  sucios: number;
  descarte: number;
}

export interface LotePuesta {
  id: string;
  codigoLote: string; // Formato: NAV-AAAAMMDD-DCP (ej: NAV1-20261018)
  naveId: string;
  nombreNave: string;
  tipoCria: TipoCria;
  codigoREGA: string;
  fechaPuesta: string; // YYYY-MM-DD
  fechaCaducidad: string; // YYYY-MM-DD (fechaPuesta + 28 días)
  totalHuevosRecogidos: number;
  calibres: CalibresHuevos;
  mermas: MermasRecogida;
  huevosAptos: number; // totalHuevosRecogidos - (rotos + sucios + descarte)
  huevosDisponibles: number; // Saldo no utilizado en envasado
  observaciones?: string;
  creadoEn: string;
}

export type TipoEnvase = 'estuche_carton' | 'estuche_plastico' | 'bandeja_celulosa' | 'caja_granel';

export interface FormatoEnvase {
  id: string;
  nombre: string; // ej: "Estuche Docena XL/L", "Bandeja 30 Huevos"
  tipoEnvase: TipoEnvase;
  cantidadHuevos: number; // 6, 12, 30, 180, etc.
  calibreRecomendado: 'XL' | 'L' | 'M' | 'S' | 'MIX';
  precioVenta: number; // En euros (sin IVA)
  costeEnvase: number; // Escandallo del envase vacío + etiqueta
  textoEtiqueta: string;
  activo: boolean;
}

export interface ComponenteLoteEstuche {
  lotePuestaId: string;
  codigoLotePuesta: string;
  nombreNave: string;
  fechaPuesta: string;
  fechaCaducidad: string;
  huevosPorEstuche: number; // Opción B: Número exacto de huevos de este lote por estuche
  totalHuevosConsumidos: number; // huevosPorEstuche * cantidadEstuches
}

export interface MermasEnvasado {
  rotosManipulacion: number;
  descartePeso: number;
  motivo?: string;
}

export interface LoteEnvasado {
  id: string;
  codigoLoteEnvasado: string; // Formato: ENV-AAAA-XXXX
  fechaEnvasado: string; // YYYY-MM-DD
  formatoId: string;
  nombreFormato: string;
  huevosPorEstuche: number;
  cantidadEstuchesProducidos: number;
  estuchesDisponibles: number; // Saldo de estuches no vendidos
  componentesLotes: ComponenteLoteEstuche[];
  mermasEnvasado: MermasEnvasado;
  totalHuevosConsumidos: number; // (cantidadEstuches * huevosPorEstuche) + mermas
  fechaConsumoPreferente: string; // La menor de las fechas de caducidad de los lotes utilizados
  esMultilote: boolean; // true si tiene > 1 lote de puesta
  estado: 'en_stock' | 'agotado' | 'parcial';
  notas?: string;
  creadoEn: string;
}

export interface Cliente {
  id: string;
  nombre: string;
  cifNif: string;
  direccion: string;
  poblacion: string;
  provincia: string;
  codigoPostal: string;
  telefono: string;
  email: string;
  recargoEquivalencia: boolean; // Si true, 4% IVA + 0.5% RE
  observaciones?: string;
}

export interface LineaDocumentoVenta {
  id: string;
  loteEnvasadoId: string;
  codigoLoteEnvasado: string;
  codigoLotePuesta?: string; // Código de lote de puesta de la granja
  formatoId: string;
  nombreFormato: string;
  cantidadEstuches: number;
  precioUnitario: number;
  subtotal: number;
  fechaConsumoPreferente: string;
  // Detalle de trazabilidad sanitaria de lotes de puesta para imprimir en albarán/factura
  trazabilidadPuesta: Array<{
    codigoLotePuesta: string;
    huevosPorEstuche: number;
    totalHuevosEntregados: number;
  }>;
}

export interface TotalesFiscales {
  baseImponible: number;
  porcentajeIva: number; // 4%
  cuotaIva: number;
  aplicaRecargo: boolean;
  porcentajeRecargo: number; // 0.5%
  cuotaRecargo: number;
  totalDocumento: number;
}

export interface Albaran {
  id: string;
  numeroAlbaran: string; // Formato: ALB-AAAA-XXXX
  fecha: string;
  clienteId: string;
  clienteNombre: string;
  clienteCif: string;
  clienteDireccion: string;
  clienteRecargoEquivalencia: boolean;
  lineas: LineaDocumentoVenta[];
  totales: TotalesFiscales;
  estado: 'pendiente_facturar' | 'facturado' | 'anulado';
  facturaId?: string;
  numeroFactura?: string;
  notas?: string;
  creadoEn: string;
}

export type FormaPago = 'transferencia' | 'efectivo' | 'recibo_bancario' | 'bizum' | 'pagare';

import {
  TipoFacturaAEAT,
  TipoRectificativa,
  FiscalRecord,
  FiscalRecordRef,
  FiscalSubmission,
  FiscalEvent,
  FiscalConfiguration,
  FiscalMode,
  TipoRegistroFiscal,
  FiscalActor
} from './fiscal/types';

export * from './fiscal/types';



/**
 * Alias retrocompatible para el modelo antiguo RegistroFacturacionVeriFactu
 */
export interface RegistroFacturacionVeriFactu {
  id: string;
  tipoRegistro?: 'alta' | 'anulacion';
  facturaId?: string;
  numeroFactura: string;
  fechaExpedicion: string;
  horaExpedicion?: string;
  tipoFactura: TipoFacturaAEAT;
  nifEmisor: string;
  nombreEmisor: string;
  nifReceptor?: string;
  nombreReceptor?: string;
  nifDestinatario?: string;
  nombreDestinatario?: string;
  baseImponible?: number;
  cuotaIva?: number;
  cuotaRecargo?: number;
  totalFactura?: number;
  baseImponibleTotal?: number;
  cuotaIvaTotal?: number;
  cuotaRecargoTotal?: number;
  importeTotal?: number;
  hashAnterior: string;
  hashActual: string;
  fechaHoraSellado: string;
  urlVeriFactu?: string;
  qrDataUri?: string;
  xmlOficial?: string;
  datosXml?: string;
  esRectificativa?: boolean;
  facturaRectificadaNumero?: string;
  motivoRectificativa?: string;
  sistemaInformatico?: {
    nombre: string;
    version: string;
    nifDesarrollador: string;
  };
  creadoEn?: string;
  estadoRemision?: 'no_remitido_custodiado' | 'remitido_verifactu';
  fiscalRecordId?: string;
  fiscalRecord?: FiscalRecord;
}

/**
 * 1. INVOICE / FACTURA (Modelo de Negocio Comercial y Agrícola)
 * Contiene todas las condiciones comerciales, líneas de productos,
 * trazabilidad agrícola de la granja (lotes de puesta, envasado, naves)
 * y enlace 1:1 con el FiscalRecord inmutable.
 */
export interface Factura {
  id: string;
  numeroFactura: string; // Formato: FAC-AAAA-XXXX o R-AAAA-XXXX
  fecha: string;
  clienteId: string;
  clienteNombre: string;
  clienteCif: string;
  clienteDireccion: string;
  clienteRecargoEquivalencia: boolean;
  albaranesAsociados: Array<{ id: string; numeroAlbaran: string; fecha: string }>;
  lineas: LineaDocumentoVenta[];
  totales: TotalesFiscales;
  estadoPago: 'pendiente' | 'pagada';
  formaPago: FormaPago;
  esVentaDirecta: boolean; // Si no proviene de albarán
  notas?: string;
  creadoEn: string;

  // Vinculación unívoca 1:1 con el Registro Fiscal Inmutable
  fiscalRecordId?: string;

  // --- Campos Legacy / Deprecados (RD 1007/2023 en Factura comercial) ---
  /** @deprecated En Fase 2+, utilizar FiscalRecord.huella.hash */
  tipoFactura?: TipoFacturaAEAT;
  /** @deprecated En Fase 2+, utilizar FiscalRecord.huella.hash */
  hashActual?: string;
  /** @deprecated En Fase 2+, utilizar FiscalRecord.encadenamiento.registroAnterior.huella */
  hashAnterior?: string;
  /** @deprecated En Fase 2+, utilizar FiscalRecord.fechaHoraHusoGenRegistro */
  fechaHoraSellado?: string;
  /** @deprecated En Fase 2+, utilizar FiscalRecord.qr.url */
  urlVeriFactu?: string;
  /** @deprecated En Fase 2+, utilizar FiscalRecord.qr.qrDataUri */
  qrDataUri?: string;
  /** @deprecated En Fase 2+, utilizar fiscalRecordId */
  registroVeriFactuId?: string;
  /** @deprecated En Fase 2+, utilizar FiscalRecord.xmlOficial */
  xmlOficial?: string;

  // --- Facturas Rectificativas y Anulaciones Comerciales ---
  esRectificativa?: boolean;
  facturaRectificadaId?: string;
  facturaRectificadaNumero?: string;
  facturaRectificadaFecha?: string;
  tipoRectificativa?: TipoRectificativa;
  motivoRectificativa?: string;
  codigoMotivoRectificativa?: '01' | '02' | '03' | '04';

  // --- Estado de la Factura Original si ha sido rectificada ---
  rectificadaPorFacturaId?: string;
  rectificadaPorNumero?: string;
  estadoRectificacion?: 'original' | 'rectificada_total' | 'rectificada_parcial';
}

export type Invoice = Factura;



export type TipoOtraSalida = 'merma_almacen' | 'autoconsumo' | 'donacion' | 'devolucion_defecto';

export interface OtraSalida {
  id: string;
  fecha: string;
  tipo: TipoOtraSalida;
  loteEnvasadoId: string;
  codigoLoteEnvasado: string;
  nombreFormato: string;
  cantidadEstuches: number;
  motivo: string;
  responsable?: string;
  creadoEn: string;
}

export interface ConfiguracionEmpresa {
  contadorAlbaran: number;
  contadorFactura: number;
  contadorRectificativa?: number; // Contador para serie R-AAAA-XXXX
  contadorEnvasado: number;
  nombreEmpresa: string;
  cifEmpresa: string;
  direccionEmpresa: string;
  poblacionEmpresa?: string;
  provinciaEmpresa?: string;
  codigoPostalEmpresa?: string;
  telefonoEmpresa: string;
  emailEmpresa: string;
  registroSanitario: string; // RGSEAA (ej: ES 10.04523/TO CE)
  codigoCentroEnvasado?: string; // Código de Autorización de Centro de Embalaje
  codigoREGA?: string; // Código REGA de la explotación o centro
  responsableCentro?: string; // Responsable técnico / Veterinario o encargado
}

export type RolUsuario = 'propietario' | 'admin' | 'operario' | 'lector';

export interface UsuarioAutorizado {
  id: string;
  email: string;
  nombre?: string;
  rol: RolUsuario;
  activo: boolean;
  agregadoPor: string;
  fechaAlta: string;
  ultimoAcceso?: string;
  notas?: string;
}

export interface AppData {
  naves: Nave[];
  lotesPuesta: LotePuesta[];
  formatos: FormatoEnvase[];
  lotesEnvasados: LoteEnvasado[];
  clientes: Cliente[];
  albaranes: Albaran[];
  facturas: Factura[];
  registrosFacturacionVeriFactu?: RegistroFacturacionVeriFactu[];
  // Referencias livianas a registros fiscales (evita duplicar el documento completo del FiscalRecord).
  // La ÚNICA fuente persistente de verdad de cada registro fiscal es la colección /fiscal_records/{recordId}
  fiscalRecordRefs?: FiscalRecordRef[];
  fiscalSubmissions?: FiscalSubmission[];
  fiscalEvents?: FiscalEvent[];
  fiscalConfig?: FiscalConfiguration;
  otrasSalidas: OtraSalida[];
  config: ConfiguracionEmpresa;
  usuariosAutorizados?: UsuarioAutorizado[];
  isZeroDayClean?: boolean;
}

