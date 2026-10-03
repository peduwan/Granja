import {
  FiscalRecord,
  FiscalRecordRef,
  FiscalSubmission,
  FiscalEvent,
  FiscalConfiguration,
  FiscalActor,
  DesgloseIvaFiscal,
  TipoFiscalEvent,
  TipoFacturaAEAT
} from './types';
import { Factura } from '../types';
import {
  buildCanonicalAltaString,
  buildCanonicalAnulacionString,
  formatFechaHoraHusoGenRegistro
} from './hashService';
import { buildFiscalQrUrl } from './qrService';
import { createFiscalSubmission as serviceCreateFiscalSubmission } from './submissionService';
import { getAeatSoapEndpoint } from './aeatEndpoints';

/**
 * Función canónica de transformación: INVOICE -> FISCAL RECORD
 *
 * FASE 1.1:
 * - Unificación estricta del Hash: única fuente en `huella.hash`.
 * - Unificación del Encadenamiento: única fuente en `encadenamiento.registroAnterior.huella`.
 * - Unificación del XML: única fuente en `xmlOficial` (opcional).
 * - Identidad del obligado tributario: fijada en `obligadoTributarioId`.
 *
 * ACLARACIÓN SOBRE SEGURIDAD E INMUTABILIDAD:
 * - `deepFreeze()` actúa exclusivamente como protección defensiva en tiempo de ejecución (runtime)
 *   en el motor JavaScript para evitar que código de la UI o controladores mute accidentalmente el objeto.
 * - La integridad fiscal está garantizada matemáticamente por el encadenamiento criptográfico SHA-256.
 * - La seguridad de persistencia física reside en las Firestore Security Rules (`allow update: if false; allow delete: if false;`).
 * - LocalStorage es únicamente una memoria caché local del navegador del cliente y NO constituye por sí mismo
 *   un mecanismo suficiente de seguridad o custodia legal fiscal.
 */
export function createFiscalRecordFromInvoice(
  invoice: Factura,
  config: FiscalConfiguration,
  previousRecord?: FiscalRecord | FiscalRecordRef | null,
  options?: {
    hashActual?: string;
    fechaHoraSellado?: string;
    cadenaTextoCanonico?: string;
    urlVeriFactu?: string;
    qrDataUri?: string;
  }
): FiscalRecord {
  const fechaHoraHuso = options?.fechaHoraSellado || invoice.fechaHoraSellado || formatFechaHoraHusoGenRegistro();
  const horaExpedicion = new Date().toTimeString().split(' ')[0] || '12:00:00';

  const obligadoTributarioId = config.obligadoTributarioId || config.nifEmisor;
  if (!obligadoTributarioId || obligadoTributarioId.trim() === '' || obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('createFiscalRecordFromInvoice: obligadoTributarioId es obligatorio y no puede ser ES_UNKNOWN ni estar vacío.');
  }

  if (!config.nifEmisor || config.nifEmisor.trim() === '' || config.nifEmisor === 'ES_UNKNOWN') {
    throw new Error('createFiscalRecordFromInvoice: NIF del emisor es obligatorio y no puede ser ES_UNKNOWN.');
  }

  // 1. Agrupar desglose de IVA por tipo impositivo a partir de las líneas
  const desgloseMap = new Map<number, { base: number; cuotaIva: number; cuotaRecargo: number; recargoPct: number }>();

  if (invoice.lineas && invoice.lineas.length > 0) {
    for (const linea of invoice.lineas) {
      const tipoIva = (linea as any).tipoIva ?? invoice.totales?.porcentajeIva ?? 4.0;
      const subtotal = linea.subtotal ?? 0;
      const recargoPct = invoice.totales?.aplicaRecargo
        ? ((linea as any).tipoRecargo ?? (tipoIva === 4 ? 0.5 : 1.4))
        : 0;
      const cuotaIva = Number(((subtotal * tipoIva) / 100).toFixed(2));
      const cuotaRecargo = recargoPct > 0 ? Number(((subtotal * recargoPct) / 100).toFixed(2)) : 0;

      const current = desgloseMap.get(tipoIva) || { base: 0, cuotaIva: 0, cuotaRecargo: 0, recargoPct };
      current.base = Number((current.base + subtotal).toFixed(2));
      current.cuotaIva = Number((current.cuotaIva + cuotaIva).toFixed(2));
      current.cuotaRecargo = Number((current.cuotaRecargo + cuotaRecargo).toFixed(2));
      desgloseMap.set(tipoIva, current);
    }
  } else {
    // Si no hay líneas detalladas, usar los totales globales de la factura
    const base = invoice.totales?.baseImponible ?? 0;
    const tipo = invoice.totales?.porcentajeIva ?? 4.0;
    const cuota = invoice.totales?.cuotaIva ?? Number(((base * tipo) / 100).toFixed(2));
    const recargo = invoice.totales?.cuotaRecargo ?? 0;
    const recargoPct = invoice.totales?.porcentajeRecargo ?? 0;
    desgloseMap.set(tipo, { base, cuotaIva: cuota, cuotaRecargo: recargo, recargoPct });
  }

  const desgloseIVA: DesgloseIvaFiscal[] = Array.from(desgloseMap.entries()).map(([tipo, val]) => ({
    tipoImpositivo: tipo,
    baseImponible: val.base,
    cuotaRepercutida: val.cuotaIva,
    tipoRecargoEquivalencia: val.recargoPct > 0 ? val.recargoPct : undefined,
    cuotaRecargoEquivalencia: val.cuotaRecargo > 0 ? val.cuotaRecargo : undefined
  }));

  const tipoFactura: TipoFacturaAEAT = invoice.tipoFactura || (invoice.esRectificativa ? 'R1' : 'F1');

  // 2. Encadenamiento criptográfico con el registro anterior
  // FASE 1.3: El encadenamiento proviene ESTRICTAMENTE del dominio FiscalRecord / FiscalRecordRef
  // Queda TERMINANTEMENTE PROHIBIDO usar invoice.hashAnterior u options.hashAnterior
  const esPrimerRegistro = !previousRecord;
  let hashAnterior = '';
  let registroAnterior: { idEmisorFactura: string; numSerieFactura: string; fechaExpedicionFactura: string; huella: string } | undefined = undefined;

  if (previousRecord) {
    if ('huellaHash' in previousRecord) {
      // Proviene de FiscalRecordRef
      hashAnterior = previousRecord.huellaHash;
      registroAnterior = {
        idEmisorFactura: previousRecord.obligadoTributarioId,
        numSerieFactura: previousRecord.numeroFactura,
        fechaExpedicionFactura: previousRecord.fechaExpedicion,
        huella: previousRecord.huellaHash
      };
    } else if ('huella' in previousRecord) {
      // Proviene de FiscalRecord
      hashAnterior = previousRecord.huella.hash;
      registroAnterior = {
        idEmisorFactura: previousRecord.obligadoTributarioId || previousRecord.emisor.nif,
        numSerieFactura: previousRecord.factura.numeroFactura,
        fechaExpedicionFactura: previousRecord.factura.fechaExpedicion,
        huella: previousRecord.huella.hash
      };
    }
  }

  // 3. Huella digital obligatoria (Fase 1.3: no se permiten placeholders)
  const hashActual = options?.hashActual || (invoice.hashActual && invoice.hashActual !== 'PENDING_FASE_2_HASH' ? invoice.hashActual : '');
  if (!hashActual || hashActual === 'PENDING_FASE_2_HASH') {
    throw new Error('createFiscalRecordFromInvoice: Huella fiscal obligatoria ausente o inválida (no se permite PENDING_FASE_2_HASH).');
  }

  if (invoice.xmlOficial === '<pending_xml/>') {
    throw new Error('createFiscalRecordFromInvoice: xmlOficial no puede ser <pending_xml/>.');
  }

  const cuotaTotalCalculada = (invoice.totales?.cuotaIva ?? 0) + (invoice.totales?.cuotaRecargo ?? 0);
  const importeTotalCalculado = invoice.totales?.totalDocumento ?? 0;

  const cadenaCanonica = options?.cadenaTextoCanonico || buildCanonicalAltaString({
    nifEmisor: config.nifEmisor,
    numSerieFactura: invoice.numeroFactura,
    fechaExpedicion: invoice.fecha,
    tipoFactura,
    cuotaTotal: cuotaTotalCalculada,
    importeTotal: importeTotalCalculado,
    huellaAnterior: hashAnterior,
    fechaHoraHusoGenRegistro: fechaHoraHuso
  });

  // 4. Construcción del FiscalRecord inmutable con campos únicos
  const record: FiscalRecord = {
    id: `frec-${invoice.id || Date.now()}`,
    obligadoTributarioId,
    invoiceId: invoice.id,
    tipoRegistro: 'alta',
    modoFiscal: config.modalidad,
    versionEspecificacion: config.versionEspecificacion || '1.0',
    sistemaInformatico: { ...config.sistemaInformatico },

    emisor: {
      nif: config.nifEmisor,
      nombreRazon: config.nombreRazonEmisor
    },

    destinatario: invoice.clienteCif ? {
      nif: invoice.clienteCif,
      nombreRazon: invoice.clienteNombre,
      codigoPais: 'ES'
    } : undefined,

    factura: {
      numeroFactura: invoice.numeroFactura,
      fechaExpedicion: invoice.fecha,
      horaExpedicion,
      tipoFactura,
      descripcionOperacion: 'Venta y distribución de huevos de granja',
      facturaSimplificadaArt7273: tipoFactura === 'F2' ? 'S' : 'N',
      facturaSinIdentifDestinatarioArt61d: !invoice.clienteCif ? 'S' : 'N',
      macrodato: 'N',
      emitidaPorTerceroODestinatario: undefined
    },

    desgloseTributario: {
      desgloseIVA,
      baseImponibleTotal: invoice.totales?.baseImponible ?? 0,
      cuotaTotal: invoice.totales?.cuotaIva ?? 0,
      cuotaRecargoTotal: invoice.totales?.cuotaRecargo ?? 0,
      importeTotal: invoice.totales?.totalDocumento ?? 0
    },

    datosRectificativa: invoice.esRectificativa ? {
      tipoRectificativa: invoice.tipoRectificativa === 'por_diferencias' ? 'I' : 'S',
      facturasRectificadas: invoice.facturaRectificadaNumero ? [{
        numeroFactura: invoice.facturaRectificadaNumero,
        fechaExpedicion: invoice.facturaRectificadaFecha || invoice.fecha
      }] : [],
      motivoRectificacion: invoice.motivoRectificativa,
      codigoMotivoRectificacion: invoice.codigoMotivoRectificativa || '01'
    } : undefined,

    // ÚNICA representación del encadenamiento
    encadenamiento: {
      primerRegistro: esPrimerRegistro,
      registroAnterior
    },

    // ÚNICA representación de la huella
    huella: {
      hash: hashActual,
      algoritmo: 'SHA-256',
      especificacionVersion: 'HAC/1177/2024',
      cadenaTextoCanonico: cadenaCanonica
    },

    fechaHoraHusoGenRegistro: fechaHoraHuso,

    qr: {
      url: options?.urlVeriFactu || (invoice.urlVeriFactu && !invoice.urlVeriFactu.includes('verifactu.html') ? invoice.urlVeriFactu : buildFiscalQrUrl({
        tipoRegistro: 'alta',
        emisor: { nif: config.nifEmisor, nombreRazon: config.nombreRazonEmisor },
        factura: { numeroFactura: invoice.numeroFactura, fechaExpedicion: invoice.fecha },
        desgloseTributario: { importeTotal: importeTotalCalculado }
      } as any)),
      payloadTexto: options?.urlVeriFactu || (invoice.urlVeriFactu && !invoice.urlVeriFactu.includes('verifactu.html') ? invoice.urlVeriFactu : buildFiscalQrUrl({
        tipoRegistro: 'alta',
        emisor: { nif: config.nifEmisor, nombreRazon: config.nombreRazonEmisor },
        factura: { numeroFactura: invoice.numeroFactura, fechaExpedicion: invoice.fecha },
        desgloseTributario: { importeTotal: importeTotalCalculado }
      } as any)),
      qrDataUri: options?.qrDataUri || invoice.qrDataUri
    },

    // ÚNICA representación de XML: ausente en Fase 1/1.1/1.2
    xmlOficial: undefined,

    estado: 'sellado_inmutable',
    creadoEn: invoice.creadoEn || fechaHoraHuso
  };

  // Congelar profundamente en runtime para evitar mutaciones en memoria
  return deepFreeze(record);
}

/**
 * Crea una referencia liviana indexable para AppData.
 * Permite conocer qué registros fiscales existen sin duplicar el documento completo.
 */
export function createFiscalRecordRef(record: FiscalRecord): FiscalRecordRef {
  return deepFreeze({
    id: record.id,
    obligadoTributarioId: record.obligadoTributarioId,
    invoiceId: record.invoiceId,
    numeroFactura: record.factura.numeroFactura,
    fechaExpedicion: record.factura.fechaExpedicion,
    huellaHash: record.huella.hash,
    creadoEn: record.creadoEn
  });
}

export interface CreateFiscalAnulacionParams {
  obligadoTributarioId: string;
  config: FiscalConfiguration;
  facturaAnulada: {
    numeroFactura: string;
    fechaExpedicion: string; // YYYY-MM-DD o DD-MM-YYYY
    motivoAnulacion: string;
  };
  previousRecord?: FiscalRecord | FiscalRecordRef | null;
  options?: {
    hashActual?: string;
    fechaHoraHusoGenRegistro?: string;
    cadenaTextoCanonico?: string;
  };
}

/**
 * Función canónica de transformación para un REGISTRO DE ANULACIÓN.
 * Permite que los registros de anulación formen parte de la misma cadena única del obligado tributario.
 */
export function createFiscalAnulacionRecord(
  params: CreateFiscalAnulacionParams
): FiscalRecord {
  const { obligadoTributarioId, config, facturaAnulada, previousRecord, options } = params;
  if (!obligadoTributarioId || obligadoTributarioId.trim() === '' || obligadoTributarioId === 'ES_UNKNOWN') {
    throw new Error('createFiscalAnulacionRecord: obligadoTributarioId es obligatorio y no puede ser ES_UNKNOWN ni estar vacío.');
  }
  if (!config.nifEmisor || config.nifEmisor.trim() === '' || config.nifEmisor === 'ES_UNKNOWN') {
    throw new Error('createFiscalAnulacionRecord: NIF del emisor es obligatorio y no puede ser ES_UNKNOWN.');
  }

  const fechaHoraHuso = options?.fechaHoraHusoGenRegistro || formatFechaHoraHusoGenRegistro();
  const horaExpedicion = new Date().toTimeString().split(' ')[0] || '12:00:00';

  const esPrimerRegistro = !previousRecord;
  let hashAnterior = '';
  let registroAnterior: { idEmisorFactura: string; numSerieFactura: string; fechaExpedicionFactura: string; huella: string } | undefined = undefined;

  if (previousRecord) {
    if ('huellaHash' in previousRecord) {
      hashAnterior = previousRecord.huellaHash;
      registroAnterior = {
        idEmisorFactura: previousRecord.obligadoTributarioId,
        numSerieFactura: previousRecord.numeroFactura,
        fechaExpedicionFactura: previousRecord.fechaExpedicion,
        huella: previousRecord.huellaHash
      };
    } else if ('huella' in previousRecord) {
      hashAnterior = previousRecord.huella.hash;
      registroAnterior = {
        idEmisorFactura: previousRecord.obligadoTributarioId || previousRecord.emisor.nif,
        numSerieFactura: previousRecord.factura.numeroFactura,
        fechaExpedicionFactura: previousRecord.factura.fechaExpedicion,
        huella: previousRecord.huella.hash
      };
    }
  }

  const hashActual = options?.hashActual || '';
  if (!hashActual || hashActual === 'PENDING_FASE_2_HASH') {
    throw new Error('createFiscalAnulacionRecord: Huella fiscal obligatoria ausente o inválida.');
  }

  const cadenaCanonica = options?.cadenaTextoCanonico || buildCanonicalAnulacionString({
    nifEmisor: config.nifEmisor,
    numSerieFactura: facturaAnulada.numeroFactura,
    fechaExpedicion: facturaAnulada.fechaExpedicion,
    huellaAnterior: hashAnterior,
    fechaHoraHusoGenRegistro: fechaHoraHuso
  });

  const record: FiscalRecord = {
    id: `fanul-${facturaAnulada.numeroFactura}-${Date.now()}`,
    obligadoTributarioId,
    invoiceId: `inv-anul-${facturaAnulada.numeroFactura}`,
    tipoRegistro: 'anulacion',
    modoFiscal: config.modalidad,
    versionEspecificacion: config.versionEspecificacion || '1.0',
    sistemaInformatico: { ...config.sistemaInformatico },

    emisor: {
      nif: config.nifEmisor,
      nombreRazon: config.nombreRazonEmisor
    },

    factura: {
      numeroFactura: facturaAnulada.numeroFactura,
      fechaExpedicion: facturaAnulada.fechaExpedicion,
      horaExpedicion,
      tipoFactura: 'F1',
      descripcionOperacion: `Anulación de la factura ${facturaAnulada.numeroFactura}`,
      facturaSimplificadaArt7273: 'N',
      facturaSinIdentifDestinatarioArt61d: 'N',
      macrodato: 'N'
    },

    desgloseTributario: {
      desgloseIVA: [],
      baseImponibleTotal: 0,
      cuotaTotal: 0,
      cuotaRecargoTotal: 0,
      importeTotal: 0
    },

    datosAnulacion: {
      motivoAnulacion: facturaAnulada.motivoAnulacion,
      numeroFacturaAnulada: facturaAnulada.numeroFactura,
      fechaExpedicionFacturaAnulada: facturaAnulada.fechaExpedicion
    },

    encadenamiento: {
      primerRegistro: esPrimerRegistro,
      registroAnterior
    },

    huella: {
      hash: hashActual,
      algoritmo: 'SHA-256',
      especificacionVersion: 'HAC/1177/2024',
      cadenaTextoCanonico: cadenaCanonica
    },

    fechaHoraHusoGenRegistro: fechaHoraHuso,

    qr: {
      url: '',
      payloadTexto: ''
    },

    xmlOficial: undefined,
    estado: 'sellado_inmutable',
    creadoEn: fechaHoraHuso
  };

  return deepFreeze(record);
}

/**
 * Crea una sumisión específica a la AEAT (Outbox).
 * Delegado al servicio centralizado de Outbox `src/fiscal/submissionService.ts`.
 * NO se asume que todo FiscalRecord tenga una sumisión obligatoria.
 * Un FiscalRecord puede tener 0, 1 o varias sumisiones según modalidad y ciclo de vida.
 */
export function createFiscalSubmission(
  fiscalRecord: FiscalRecord,
  config: FiscalConfiguration,
  options?: {
    numeroIntento?: number;
    xmlEnviado?: string;
    endpoint?: string;
  }
): FiscalSubmission {
  return serviceCreateFiscalSubmission(fiscalRecord, config, options);
}

/**
 * Crea un evento inmutable en el libro de auditoría del SIF.
 * Permite que el actor sea un usuario humano (USER) o un proceso del sistema (SYSTEM).
 */
export function createFiscalEvent(params: {
  tipo: TipoFiscalEvent;
  actor: FiscalActor;
  obligadoTributarioId: string;
  fiscalRecordId?: string;
  numeroFactura?: string;
  descripcion: string;
  datos?: Record<string, any>;
}): FiscalEvent {
  // REGLA FASE 1.2: obligadoTributarioId es obligatorio y no puede tener fallbacks como 'ES_UNKNOWN'
  if (!params.obligadoTributarioId || params.obligadoTributarioId.trim() === '') {
    throw new Error('createFiscalEvent: obligadoTributarioId es obligatorio y no puede estar vacío (no se permite fallback ficticio).');
  }

  const event: FiscalEvent = {
    id: `fevt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    obligadoTributarioId: params.obligadoTributarioId,
    tipo: params.tipo,
    fechaHora: new Date().toISOString(),
    actor: { ...params.actor },
    fiscalRecordId: params.fiscalRecordId,
    numeroFactura: params.numeroFactura,
    descripcion: params.descripcion,
    datos: params.datos ? { ...params.datos } : undefined
  };

  return deepFreeze(event);
}

/**
 * Configuración fiscal por defecto

 */
export function createDefaultFiscalConfiguration(params: {
  nif: string;
  nombreRazon: string;
  nombreComercial?: string;
  modalidad?: 'VERI_FACTU' | 'NO_VERI_FACTU';
  entorno?: 'pruebas' | 'produccion';
}): FiscalConfiguration {
  const config: FiscalConfiguration = {
    obligadoTributarioId: params.nif,
    nifEmisor: params.nif,
    nombreRazonEmisor: params.nombreRazon,
    nombreComercial: params.nombreComercial,
    modalidad: params.modalidad || 'VERI_FACTU',
    entornoAeat: params.entorno || 'pruebas',
    versionEspecificacion: '1.0',
    sistemaInformatico: {
      nombreRazon: 'Gestión Avícola Software S.L.',
      nif: 'B99999999',
      nombreSistemaInformatico: 'Gestión Avícola SIF',
      idSistemaInformatico: '01',
      version: '1.0.0',
      numeroInstalacion: 'INST-001',
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'N',
      indicadorMultiplesOT: 'N'
    },
    remisionAutomatica: true,
    reintentosMaximos: 3,
    minutosEntreReintentos: 5,
    transporte: {
      endpointUrl: getAeatSoapEndpoint(params.entorno === 'produccion' ? 'production' : 'test'),
      timeoutMs: 15000,
      certificadoConfigurado: false
    },
    certificadoConfigurado: false,
    fechaActivacion: new Date().toISOString()
  };

  return deepFreeze(config);
}

/**
 * Helper para congelar en memoria profundamente un objeto.
 * NOTA DE SEGURIDAD: deepFreeze previene mutaciones accidentales en runtime dentro del proceso Node/browser.
 * No reemplaza la seguridad de persistencia que garantizan las reglas de Firestore en la base de datos.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const value = (obj as any)[key];
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}
