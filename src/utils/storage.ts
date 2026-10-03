import { AppData, TotalesFiscales, LineaDocumentoVenta, FiscalConfiguration, FiscalRecordRef, FiscalSubmission, FiscalEvent } from '../types';
import { createDefaultFiscalConfiguration } from '../fiscal/modelTransformers';


const STORAGE_KEY = 'avicola_gestion_data_v1';

export function getDefaultFiscalConfig(cif: string = 'B45123987', nombre: string = 'Granja Avícola El Valle S.L.'): FiscalConfiguration {
  return createDefaultFiscalConfiguration({
    nif: cif,
    nombreRazon: nombre
  });
}



export const IVA_HUEVOS = 4.0; // 4% Superreducido
export const RECARGO_EQUIVALENCIA = 0.5; // 0.5% para productos al 4% IVA

export function calcularDCP(fechaPuestaISO: string): string {
  const date = new Date(fechaPuestaISO);
  date.setDate(date.getDate() + 28);
  return date.toISOString().split('T')[0];
}

/**
 * Formatea una fecha estándar (YYYY-MM-DD o ISO) al formato español (día/mes/año -> DD/MM/AAAA)
 */
export function formatearFechaES(fechaStr?: string | null): string {
  if (!fechaStr) return '';
  const trimmed = fechaStr.trim();
  if (!trimmed) return '';

  // Si ya viene formateada como DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  // Si viene en formato YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, anio, mes, dia] = match;
    return `${dia}/${mes}/${anio}`;
  }

  // Fallback con objeto Date nativo
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return trimmed;
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

export function formatearFechaCaducidadMinima(fechas: string[]): string {
  if (!fechas || fechas.length === 0) return '';
  return [...fechas].sort()[0]; // La fecha más próxima / más antigua
}

export function calcularTotales(lineas: Array<{ subtotal: number }>, aplicaRecargo: boolean): TotalesFiscales {
  const baseImponible = Number(lineas.reduce((acc, l) => acc + (l.subtotal || 0), 0).toFixed(2));
  const cuotaIva = Number(((baseImponible * IVA_HUEVOS) / 100).toFixed(2));
  const cuotaRecargo = aplicaRecargo ? Number(((baseImponible * RECARGO_EQUIVALENCIA) / 100).toFixed(2)) : 0;
  const totalDocumento = Number((baseImponible + cuotaIva + cuotaRecargo).toFixed(2));

  return {
    baseImponible,
    porcentajeIva: IVA_HUEVOS,
    cuotaIva,
    aplicaRecargo,
    porcentajeRecargo: aplicaRecargo ? RECARGO_EQUIVALENCIA : 0,
    cuotaRecargo,
    totalDocumento
  };
}

export function padNumero(num: number, digits: number = 4): string {
  return String(num).padStart(digits, '0');
}

export function generarCodigoLotePuesta(codigoNave: string, fechaPuesta: string): string {
  // Regla de negocio del usuario: Identificador Nave - (fecha de puesta + 28 días)
  const dcp = calcularDCP(fechaPuesta);
  const dcpLimpia = dcp.replace(/-/g, '');
  return `${codigoNave}-${dcpLimpia}`;
}

export interface EdadLoteInfo {
  diasEnNave: number; // Ej: Día 56
  semanaVida: number; // Ej: Sem 32
  semanaPuesta: number; // Ej: Sem 8
  diasRestantesLote: number; // Ej: 674 días (sobre ciclo de 2 años / 730 días)
  porcentajeCicloCompletado: number; // 0-100%
}

/**
 * Calcula la edad de las gallinas (semana de vida y días en nave) para una fecha de puesta concreta
 */
export function calcularEdadLote(
  fechaPuesta: string,
  fechaEntrada?: string,
  edadSemanasEntrada: number = 24
): EdadLoteInfo {
  if (!fechaEntrada) {
    return {
      diasEnNave: 1,
      semanaVida: edadSemanasEntrada,
      semanaPuesta: 1,
      diasRestantesLote: 730,
      porcentajeCicloCompletado: 1
    };
  }

  const msPorDia = 86400000;
  const dPuesta = new Date(fechaPuesta.includes('T') ? fechaPuesta : fechaPuesta + 'T00:00:00');
  const dEntrada = new Date(fechaEntrada.includes('T') ? fechaEntrada : fechaEntrada + 'T00:00:00');

  const diffDays = Math.round((dPuesta.getTime() - dEntrada.getTime()) / msPorDia);
  const diasEnNave = Math.max(1, diffDays + 1);

  // Semanas de puesta (semana 1 = días 1 a 7 de puesta)
  const semanaPuesta = Math.floor((diasEnNave - 1) / 7) + 1;

  // Semanas de vida: edad al entrar en días + días en nave
  const diasVidaTotales = (edadSemanasEntrada * 7) + diasEnNave;
  const semanaVida = Math.floor((diasVidaTotales - 1) / 7) + 1;

  // Ciclo habitual de 2 años (aprox 730 días)
  const diasRestantesLote = Math.max(0, 730 - diasEnNave);
  const porcentajeCicloCompletado = Math.min(100, Math.round((diasEnNave / 730) * 100));

  return {
    diasEnNave,
    semanaVida,
    semanaPuesta,
    diasRestantesLote,
    porcentajeCicloCompletado
  };
}

/**
 * Desglosa líneas para garantizar siempre una línea por lote con su cantidad y precio
 */
export function desglosarLineasPorLote(lineas: LineaDocumentoVenta[]): LineaDocumentoVenta[] {
  const resultado: LineaDocumentoVenta[] = [];

  lineas.forEach((l) => {
    if (l.trazabilidadPuesta && l.trazabilidadPuesta.length > 1) {
      const totalHuevos = l.trazabilidadPuesta.reduce((acc, t) => acc + (t.totalHuevosEntregados || 0), 0);
      let estuchesAcumulados = 0;

      l.trazabilidadPuesta.forEach((t, subIdx) => {
        const esUltimo = subIdx === l.trazabilidadPuesta.length - 1;
        const ratio = totalHuevos > 0 ? (t.totalHuevosEntregados / totalHuevos) : (1 / l.trazabilidadPuesta.length);
        const cantEst = esUltimo
          ? Math.max(1, l.cantidadEstuches - estuchesAcumulados)
          : Math.max(1, Math.round(l.cantidadEstuches * ratio));
        estuchesAcumulados += cantEst;
        const subtotal = Number((cantEst * l.precioUnitario).toFixed(2));

        resultado.push({
          ...l,
          id: `${l.id}-lp-${subIdx}`,
          codigoLotePuesta: t.codigoLotePuesta,
          cantidadEstuches: cantEst,
          precioUnitario: l.precioUnitario,
          subtotal,
          trazabilidadPuesta: [t]
        });
      });
    } else if (l.codigoLotePuesta && l.codigoLotePuesta.includes(',')) {
      const codigos = l.codigoLotePuesta.split(',').map(s => s.trim()).filter(Boolean);
      const partes = codigos.length;
      let estuchesAcumulados = 0;

      codigos.forEach((cod, subIdx) => {
        const esUltimo = subIdx === partes - 1;
        const cantEst = esUltimo
          ? Math.max(1, l.cantidadEstuches - estuchesAcumulados)
          : Math.max(1, Math.floor(l.cantidadEstuches / partes));
        estuchesAcumulados += cantEst;
        const subtotal = Number((cantEst * l.precioUnitario).toFixed(2));

        resultado.push({
          ...l,
          id: `${l.id}-cod-${subIdx}`,
          codigoLotePuesta: cod,
          cantidadEstuches: cantEst,
          precioUnitario: l.precioUnitario,
          subtotal
        });
      });
    } else {
      resultado.push(l);
    }
  });

  return resultado;
}

export function getInitialData(): AppData {
  const hoy = new Date().toISOString().split('T')[0];
  const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const anteayer = new Date(Date.now() - 172800000).toISOString().split('T')[0];

  // Fecha de entrada del lote de gallinas en nave 1 hace 55 días (hoy es Día 56, ayer Día 55)
  const fechaEntradaNave1 = new Date(Date.now() - 55 * 86400000).toISOString().split('T')[0];
  const fechaEntradaNave2 = new Date(Date.now() - 34 * 86400000).toISOString().split('T')[0];

  const dcpHoy = calcularDCP(hoy);
  const dcpAyer = calcularDCP(ayer);
  const dcpAnteayer = calcularDCP(anteayer);

  const initialNaves = [
    {
      id: 'nave-1',
      codigo: 'NAV1',
      nombre: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      capacidadAves: 3000,
      activa: true,
      fechaEntrada: fechaEntradaNave1,
      edadSemanasEntrada: 24,
      razaGallinas: 'Lohmann Brown',
      observacionesLote: 'Lote de 3.000 aves camperas. Pico de puesta excelente.'
    },
    {
      id: 'nave-2',
      codigo: 'NAV2',
      nombre: 'Nave 2 - Lote Producción Ecológica',
      tipoCria: '0-Ecologico' as const,
      codigoREGA: 'ES45000190',
      capacidadAves: 1500,
      activa: true,
      fechaEntrada: fechaEntradaNave2,
      edadSemanasEntrada: 24,
      razaGallinas: 'Hy-Line Brown',
      observacionesLote: 'Lote ecológico alimentado con grano certificado.'
    }
  ];

  const initialFormatos = [
    {
      id: 'fmt-12-campero',
      nombre: 'Estuche 12 Huevos Camperos (Clase A)',
      tipoEnvase: 'estuche_carton' as const,
      cantidadHuevos: 12,
      calibreRecomendado: 'L' as const,
      precioVenta: 2.95,
      costeEnvase: 0.22,
      textoEtiqueta: 'Huevos de gallinas camperas criadas en libertad. Calibre L.',
      activo: true
    },
    {
      id: 'fmt-6-campero',
      nombre: 'Estuche 6 Huevos Camperos Selección',
      tipoEnvase: 'estuche_carton' as const,
      cantidadHuevos: 6,
      calibreRecomendado: 'XL' as const,
      precioVenta: 1.75,
      costeEnvase: 0.16,
      textoEtiqueta: 'Huevos camperos tamaño especial XL.',
      activo: true
    },
    {
      id: 'fmt-30-bandeja',
      nombre: 'Bandeja Celulosa 30 Huevos (Hostelería)',
      tipoEnvase: 'bandeja_celulosa' as const,
      cantidadHuevos: 30,
      calibreRecomendado: 'M' as const,
      precioVenta: 6.30,
      costeEnvase: 0.35,
      textoEtiqueta: 'Bandeja formato económico hostelería y obradores.',
      activo: true
    }
  ];

  const lotePuesta1 = {
    id: 'lp-01',
    codigoLote: `NAV1-${dcpAnteayer.replace(/-/g, '')}`,
    naveId: 'nave-1',
    nombreNave: 'Nave 1 - Gallinas Campero',
    tipoCria: '1-Campero' as const,
    codigoREGA: 'ES45000189',
    fechaPuesta: anteayer,
    fechaCaducidad: dcpAnteayer,
    totalHuevosRecogidos: 2400,
    calibres: { xl: 350, l: 1250, m: 600, s: 120 },
    mermas: { rotos: 45, sucios: 25, descarte: 10 },
    huevosAptos: 2320,
    huevosDisponibles: 1520, // 800 consumidos en el lote de envasado inicial
    observaciones: 'Puesta matinal regular, cáscara de excelente consistencia.',
    creadoEn: anteayer
  };

  const lotePuesta2 = {
    id: 'lp-02',
    codigoLote: `NAV1-${dcpAyer.replace(/-/g, '')}`,
    naveId: 'nave-1',
    nombreNave: 'Nave 1 - Gallinas Campero',
    tipoCria: '1-Campero' as const,
    codigoREGA: 'ES45000189',
    fechaPuesta: ayer,
    fechaCaducidad: dcpAyer,
    totalHuevosRecogidos: 2500,
    calibres: { xl: 400, l: 1300, m: 650, s: 90 },
    mermas: { rotos: 35, sucios: 20, descarte: 5 },
    huevosAptos: 2440,
    huevosDisponibles: 2040, // 400 consumidos en el lote de envasado inicial
    observaciones: 'Condiciones óptimas en nave.',
    creadoEn: ayer
  };

  const lotePuesta3 = {
    id: 'lp-03',
    codigoLote: `NAV1-${dcpHoy.replace(/-/g, '')}`,
    naveId: 'nave-1',
    nombreNave: 'Nave 1 - Lote Gallinas Campero',
    tipoCria: '1-Campero' as const,
    codigoREGA: 'ES45000189',
    fechaPuesta: hoy,
    fechaCaducidad: dcpHoy,
    totalHuevosRecogidos: 2580,
    calibres: { xl: 420, l: 1380, m: 660, s: 80 },
    mermas: { rotos: 25, sucios: 12, descarte: 3 },
    huevosAptos: 2540,
    huevosDisponibles: 2540,
    observaciones: 'Pico de producción en Sem 32 (Día 56). Calidad de cáscara óptima.',
    creadoEn: hoy
  };

  // Lotes históricos para demostración del agrupamiento mensual y scroll infinito (Septiembre, Agosto y Julio 2026)
  const lotesHistoricosMesesAnteriores = [
    {
      id: 'lp-04',
      codigoLote: `NAV1-${calcularDCP('2026-09-15').replace(/-/g, '')}`,
      naveId: 'nave-1',
      nombreNave: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      fechaPuesta: '2026-09-15',
      fechaCaducidad: calcularDCP('2026-09-15'),
      totalHuevosRecogidos: 2510,
      calibres: { xl: 390, l: 1320, m: 690, s: 70 },
      mermas: { rotos: 18, sucios: 9, descarte: 3 },
      huevosAptos: 2480,
      huevosDisponibles: 1200,
      observaciones: 'Puesta quincenal regular. Pienso complementado con calcio.',
      creadoEn: '2026-09-15'
    },
    {
      id: 'lp-05',
      codigoLote: `NAV1-${calcularDCP('2026-09-08').replace(/-/g, '')}`,
      naveId: 'nave-1',
      nombreNave: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      fechaPuesta: '2026-09-08',
      fechaCaducidad: calcularDCP('2026-09-08'),
      totalHuevosRecogidos: 2490,
      calibres: { xl: 380, l: 1310, m: 680, s: 85 },
      mermas: { rotos: 22, sucios: 10, descarte: 3 },
      huevosAptos: 2455,
      huevosDisponibles: 0,
      observaciones: 'Lote totalmente envasado y expedido.',
      creadoEn: '2026-09-08'
    },
    // AGOSTO 2026
    {
      id: 'lp-06',
      codigoLote: `NAV1-${calcularDCP('2026-08-28').replace(/-/g, '')}`,
      naveId: 'nave-1',
      nombreNave: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      fechaPuesta: '2026-08-28',
      fechaCaducidad: calcularDCP('2026-08-28'),
      totalHuevosRecogidos: 2460,
      calibres: { xl: 360, l: 1290, m: 690, s: 80 },
      mermas: { rotos: 24, sucios: 12, descarte: 4 },
      huevosAptos: 2420,
      huevosDisponibles: 0,
      observaciones: 'Final de agosto. Buen apetito en nave.',
      creadoEn: '2026-08-28'
    },
    {
      id: 'lp-07',
      codigoLote: `NAV1-${calcularDCP('2026-08-20').replace(/-/g, '')}`,
      naveId: 'nave-1',
      nombreNave: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      fechaPuesta: '2026-08-20',
      fechaCaducidad: calcularDCP('2026-08-20'),
      totalHuevosRecogidos: 2440,
      calibres: { xl: 340, l: 1270, m: 700, s: 90 },
      mermas: { rotos: 26, sucios: 11, descarte: 3 },
      huevosAptos: 2400,
      huevosDisponibles: 0,
      observaciones: 'Semana 27 de vida de las aves.',
      creadoEn: '2026-08-20'
    },
    {
      id: 'lp-08',
      codigoLote: `NAV2-${calcularDCP('2026-08-12').replace(/-/g, '')}`,
      naveId: 'nave-2',
      nombreNave: 'Nave 2 - Lote Producción Ecológica',
      tipoCria: '0-Ecologico' as const,
      codigoREGA: 'ES45000190',
      fechaPuesta: '2026-08-12',
      fechaCaducidad: calcularDCP('2026-08-12'),
      totalHuevosRecogidos: 1250,
      calibres: { xl: 180, l: 650, m: 360, s: 40 },
      mermas: { rotos: 12, sucios: 6, descarte: 2 },
      huevosAptos: 1230,
      huevosDisponibles: 0,
      observaciones: 'Lote ecológico nave 2. Calidad de yema dorada natural.',
      creadoEn: '2026-08-12'
    },
    // JULIO 2026
    {
      id: 'lp-09',
      codigoLote: `NAV1-${calcularDCP('2026-07-28').replace(/-/g, '')}`,
      naveId: 'nave-1',
      nombreNave: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      fechaPuesta: '2026-07-28',
      fechaCaducidad: calcularDCP('2026-07-28'),
      totalHuevosRecogidos: 2380,
      calibres: { xl: 300, l: 1220, m: 720, s: 100 },
      mermas: { rotos: 28, sucios: 9, descarte: 3 },
      huevosAptos: 2340,
      huevosDisponibles: 0,
      observaciones: 'Temperaturas estivales controladas por ventilación dinámica.',
      creadoEn: '2026-07-28'
    },
    {
      id: 'lp-10',
      codigoLote: `NAV1-${calcularDCP('2026-07-15').replace(/-/g, '')}`,
      naveId: 'nave-1',
      nombreNave: 'Nave 1 - Lote Gallinas Campero',
      tipoCria: '1-Campero' as const,
      codigoREGA: 'ES45000189',
      fechaPuesta: '2026-07-15',
      fechaCaducidad: calcularDCP('2026-07-15'),
      totalHuevosRecogidos: 2320,
      calibres: { xl: 280, l: 1180, m: 730, s: 95 },
      mermas: { rotos: 22, sucios: 11, descarte: 2 },
      huevosAptos: 2285,
      huevosDisponibles: 0,
      observaciones: 'Inicio de la curva alta de puesta.',
      creadoEn: '2026-07-15'
    }
  ];

  const initialLoteEnvasado = {
    id: 'env-01',
    codigoLoteEnvasado: 'ENV-2026-0001',
    fechaEnvasado: ayer,
    formatoId: 'fmt-12-campero',
    nombreFormato: 'Estuche 12 Huevos Camperos (Clase A)',
    huevosPorEstuche: 12,
    cantidadEstuchesProducidos: 100, // 100 estuches x 12 huevos = 1200 huevos
    estuchesDisponibles: 85, // 15 vendidos en albarán de prueba
    componentesLotes: [
      {
        lotePuestaId: 'lp-01',
        codigoLotePuesta: lotePuesta1.codigoLote,
        nombreNave: 'Nave 1 - Gallinas Campero',
        fechaPuesta: anteayer,
        fechaCaducidad: dcpAnteayer,
        huevosPorEstuche: 8, // 8 huevos por estuche del lote lp-01
        totalHuevosConsumidos: 800
      },
      {
        lotePuestaId: 'lp-02',
        codigoLotePuesta: lotePuesta2.codigoLote,
        nombreNave: 'Nave 1 - Gallinas Campero',
        fechaPuesta: ayer,
        fechaCaducidad: dcpAyer,
        huevosPorEstuche: 4, // 4 huevos por estuche del lote lp-02
        totalHuevosConsumidos: 400
      }
    ],
    mermasEnvasado: {
      rotosManipulacion: 6,
      descartePeso: 2,
      motivo: 'Pequeñas microfisuras detectadas en ovoscopia.'
    },
    totalHuevosConsumidos: 1208,
    fechaConsumoPreferente: dcpAnteayer, // Rige el lote más antiguo (anteayer + 28 días)
    esMultilote: true,
    estado: 'en_stock' as const,
    notas: 'Partida multilote con calibrado visual y ovoscopia completa.',
    creadoEn: ayer
  };

  const initialClientes = [
    {
      id: 'cli-01',
      nombre: 'Supermercado La Despensa Verde S.L.',
      cifNif: 'B45892341',
      direccion: 'Polígono Industrial Las Encinas, Nave 4',
      poblacion: 'Talavera de la Reina',
      provincia: 'Toledo',
      codigoPostal: '45600',
      telefono: '925 80 12 34',
      email: 'compras@ladespensa.es',
      recargoEquivalencia: false, // Régimen General (Solo 4% IVA)
      observaciones: 'Reparto los martes y jueves a primera hora.'
    },
    {
      id: 'cli-02',
      nombre: 'Frutas y Alimentación Paco (Comercio Minorista)',
      cifNif: '05432198H',
      direccion: 'Calle Mayor, 14',
      poblacion: 'Illescas',
      provincia: 'Toledo',
      codigoPostal: '45200',
      telefono: '639 12 45 78',
      email: 'pacofrutas@gmail.com',
      recargoEquivalencia: true, // Recargo de Equivalencia (+0.5%)
      observaciones: 'Autónomo en recargo de equivalencia. Exige desglose detallado de RE.'
    }
  ];

  const lineasVentaEjemplo: LineaDocumentoVenta[] = [
    {
      id: 'lin-01',
      loteEnvasadoId: 'env-01',
      codigoLoteEnvasado: 'ENV-2026-0001',
      codigoLotePuesta: lotePuesta1.codigoLote,
      formatoId: 'fmt-12-campero',
      nombreFormato: 'Estuche 12 Huevos Camperos (Clase A)',
      cantidadEstuches: 10,
      precioUnitario: 2.95,
      subtotal: 29.50,
      fechaConsumoPreferente: dcpAnteayer,
      trazabilidadPuesta: [
        {
          codigoLotePuesta: lotePuesta1.codigoLote,
          huevosPorEstuche: 12,
          totalHuevosEntregados: 120
        }
      ]
    },
    {
      id: 'lin-02',
      loteEnvasadoId: 'env-01',
      codigoLoteEnvasado: 'ENV-2026-0001',
      codigoLotePuesta: lotePuesta2.codigoLote,
      formatoId: 'fmt-12-campero',
      nombreFormato: 'Estuche 12 Huevos Camperos (Clase A)',
      cantidadEstuches: 5,
      precioUnitario: 2.95,
      subtotal: 14.75,
      fechaConsumoPreferente: dcpAyer,
      trazabilidadPuesta: [
        {
          codigoLotePuesta: lotePuesta2.codigoLote,
          huevosPorEstuche: 12,
          totalHuevosEntregados: 60
        }
      ]
    }
  ];

  const albaranEjemplo = {
    id: 'alb-01',
    numeroAlbaran: 'ALB-2026-0001',
    fecha: ayer,
    clienteId: 'cli-02',
    clienteNombre: 'Frutas y Alimentación Paco (Comercio Minorista)',
    clienteCif: '05432198H',
    clienteDireccion: 'Calle Mayor, 14 - 45200 Illescas (Toledo)',
    clienteRecargoEquivalencia: true,
    lineas: lineasVentaEjemplo,
    totales: calcularTotales(lineasVentaEjemplo, true),
    estado: 'pendiente_facturar' as const,
    notas: 'Entrega por la mañana. Mercancía revisada y conforme.',
    creadoEn: ayer
  };

  const lineasDespensa: LineaDocumentoVenta[] = [
    {
      id: 'lin-03',
      loteEnvasadoId: 'env-01',
      codigoLoteEnvasado: 'ENV-2026-0001',
      codigoLotePuesta: lotePuesta1.codigoLote,
      formatoId: 'fmt-12-campero',
      nombreFormato: 'Estuche 12 Huevos Camperos (Clase A)',
      cantidadEstuches: 20,
      precioUnitario: 2.95,
      subtotal: 59.00,
      fechaConsumoPreferente: dcpAnteayer,
      trazabilidadPuesta: [
        {
          codigoLotePuesta: lotePuesta1.codigoLote,
          huevosPorEstuche: 12,
          totalHuevosEntregados: 240
        }
      ]
    }
  ];

  const albaranDespensa = {
    id: 'alb-02',
    numeroAlbaran: 'ALB-2026-0002',
    fecha: anteayer,
    clienteId: 'cli-01',
    clienteNombre: 'Supermercado La Despensa Verde S.L.',
    clienteCif: 'B45892341',
    clienteDireccion: 'Polígono Industrial Las Encinas, Nave 4 - Talavera de la Reina (Toledo)',
    clienteRecargoEquivalencia: false,
    lineas: lineasDespensa,
    totales: calcularTotales(lineasDespensa, false),
    estado: 'facturado' as const,
    facturaId: 'fac-01',
    numeroFactura: 'FAC-2026-0001',
    notas: 'Entrega en muelle de recepción. Revisado conforme.',
    creadoEn: anteayer
  };

  const facturaDespensa = {
    id: 'fac-01',
    numeroFactura: 'FAC-2026-0001',
    fecha: ayer,
    clienteId: 'cli-01',
    clienteNombre: 'Supermercado La Despensa Verde S.L.',
    clienteCif: 'B45892341',
    clienteDireccion: 'Polígono Industrial Las Encinas, Nave 4 - Talavera de la Reina (Toledo)',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [{ id: 'alb-02', numeroAlbaran: 'ALB-2026-0002', fecha: anteayer }],
    lineas: lineasDespensa,
    totales: albaranDespensa.totales,
    estadoPago: 'pagada' as const,
    formaPago: 'transferencia' as const,
    esVentaDirecta: false,
    notas: 'Factura mensual correspondiente al albarán ALB-2026-0002.',
    creadoEn: ayer,
    tipoFactura: 'F1' as const,
    hashActual: 'E84D2B6019A84F82BB64221190ACDF4E',
    hashAnterior: '',
    fechaHoraSellado: new Date(Date.now() - 86400000).toISOString(),
    esRectificativa: false
  };

  return {
    naves: initialNaves,
    lotesPuesta: [lotePuesta3, lotePuesta2, lotePuesta1, ...lotesHistoricosMesesAnteriores],
    formatos: initialFormatos,
    lotesEnvasados: [initialLoteEnvasado],
    clientes: initialClientes,
    albaranes: [albaranEjemplo, albaranDespensa],
    facturas: [facturaDespensa],
    registrosFacturacionVeriFactu: [],
    fiscalRecordRefs: [],
    fiscalSubmissions: [],
    fiscalEvents: [],
    fiscalConfig: getDefaultFiscalConfig('B45123987', 'Granja Avícola El Valle S.L.'),
    otrasSalidas: [],
    config: {
      contadorAlbaran: 2,
      contadorFactura: 1,
      contadorRectificativa: 1,
      contadorEnvasado: 2,
      nombreEmpresa: 'Granja Avícola El Valle S.L.',
      cifEmpresa: 'B45123987',
      direccionEmpresa: 'Camino de las Huertas, km 2.4',
      poblacionEmpresa: 'Toledo',
      provinciaEmpresa: 'Toledo',
      codigoPostalEmpresa: '45005',
      telefonoEmpresa: '925 11 22 33',
      emailEmpresa: 'info@avicolaelvalle.es',
      registroSanitario: 'ES 10.04523/TO CE (Centro de Embalaje)',
      codigoCentroEnvasado: 'ES-10.04523-TO',
      codigoREGA: 'ES45000189',
      responsableCentro: 'Dra. Carmen Morales (Directora Técnica de Calidad)'
    },
    usuariosAutorizados: [
      {
        id: 'owner-peduwan',
        email: ROOT_OWNER_EMAIL,
        nombre: 'Propietario Principal',
        rol: 'propietario',
        activo: true,
        agregadoPor: 'sistema',
        fechaAlta: new Date().toISOString()
      }
    ],
    isZeroDayClean: false
  };
}

export const ROOT_OWNER_EMAIL = 'peduwan@gmail.com';

/**
 * Genera una estructura de datos completamente vacía y limpia para inicio Día Cero
 * (Primera instalación real de la granja, sin datos ficticios ni lotes simulados).
 */
export function getZeroDayAppData(configPersonalizada?: Partial<AppData['config']>): AppData {
  return {
    naves: [],
    lotesPuesta: [],
    formatos: [
      {
        id: 'fmt-12-campero',
        nombre: 'Estuche 12 Huevos (Clase A)',
        tipoEnvase: 'estuche_carton',
        cantidadHuevos: 12,
        calibreRecomendado: 'L',
        precioVenta: 2.95,
        costeEnvase: 0.22,
        textoEtiqueta: 'Huevos frescos de categoría A. Conservar refrigerado tras la compra.',
        activo: true
      },
      {
        id: 'fmt-6-campero',
        nombre: 'Estuche 6 Huevos Selección',
        tipoEnvase: 'estuche_carton',
        cantidadHuevos: 6,
        calibreRecomendado: 'XL',
        precioVenta: 1.80,
        costeEnvase: 0.16,
        textoEtiqueta: 'Huevos frescos extra grandes categoría A.',
        activo: true
      },
      {
        id: 'fmt-30-bandeja',
        nombre: 'Bandeja Alveolada 30 Huevos',
        tipoEnvase: 'bandeja_celulosa',
        cantidadHuevos: 30,
        calibreRecomendado: 'M',
        precioVenta: 5.40,
        costeEnvase: 0.35,
        textoEtiqueta: 'Bandeja alveolada 30 huevos para hostelería y obradores.',
        activo: true
      }
    ],
    lotesEnvasados: [],
    clientes: [],
    albaranes: [],
    facturas: [],
    registrosFacturacionVeriFactu: [],
    fiscalRecordRefs: [],
    fiscalSubmissions: [],
    fiscalEvents: [],
    fiscalConfig: getDefaultFiscalConfig(configPersonalizada?.cifEmpresa || '', configPersonalizada?.nombreEmpresa || 'Mi Explotación Avícola'),
    otrasSalidas: [],
    usuariosAutorizados: [
      {
        id: 'owner-peduwan',
        email: ROOT_OWNER_EMAIL,
        nombre: 'Propietario Principal',
        rol: 'propietario',
        activo: true,
        agregadoPor: 'sistema',
        fechaAlta: new Date().toISOString()
      }
    ],
    config: {
      contadorAlbaran: 1,
      contadorFactura: 1,
      contadorRectificativa: 1,
      contadorEnvasado: 1,
      nombreEmpresa: configPersonalizada?.nombreEmpresa || 'Mi Explotación Avícola',
      cifEmpresa: configPersonalizada?.cifEmpresa || '',
      direccionEmpresa: configPersonalizada?.direccionEmpresa || '',
      poblacionEmpresa: configPersonalizada?.poblacionEmpresa || '',
      provinciaEmpresa: configPersonalizada?.provinciaEmpresa || '',
      codigoPostalEmpresa: configPersonalizada?.codigoPostalEmpresa || '',
      telefonoEmpresa: configPersonalizada?.telefonoEmpresa || '',
      emailEmpresa: configPersonalizada?.emailEmpresa || ROOT_OWNER_EMAIL,
      registroSanitario: configPersonalizada?.registroSanitario || 'ES 10.XXXXX/XX CE',
      codigoCentroEnvasado: configPersonalizada?.codigoCentroEnvasado || '',
      codigoREGA: configPersonalizada?.codigoREGA || 'ESXXXXXXXX',
      responsableCentro: configPersonalizada?.responsableCentro || 'Titular de la Explotación'
    },
    isZeroDayClean: true
  };
}

export function resetToZeroDayData(configPersonalizada?: Partial<AppData['config']>): AppData {
  const zeroDayData = getZeroDayAppData(configPersonalizada);
  saveAppData(zeroDayData);
  return zeroDayData;
}

export function loadAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = getInitialData();
      saveAppData(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as AppData;

    // Inicializar o migrar referencias de registros fiscales sin duplicar el documento completo
    if (!parsed.fiscalRecordRefs) {
      if (Array.isArray((parsed as any).fiscalRecords)) {
        parsed.fiscalRecordRefs = (parsed as any).fiscalRecords.map((r: any) => ({
          id: r.id,
          obligadoTributarioId: r.obligadoTributarioId || r.emisor?.nif || '',
          invoiceId: r.invoiceId,
          numeroFactura: r.factura?.numeroFactura || '',
          fechaExpedicion: r.factura?.fechaExpedicion || '',
          huellaHash: r.huella?.hash || '',
          creadoEn: r.creadoEn || ''
        }));
        delete (parsed as any).fiscalRecords;
      } else {
        parsed.fiscalRecordRefs = [];
      }
    }
    if (!parsed.fiscalSubmissions) parsed.fiscalSubmissions = [];
    if (!parsed.fiscalEvents) parsed.fiscalEvents = [];
    if (!parsed.fiscalConfig) {
      parsed.fiscalConfig = getDefaultFiscalConfig(parsed.config?.cifEmpresa, parsed.config?.nombreEmpresa);
    }


    // Si el usuario activó Día Cero limpio, NUNCA repoblar datos de demostración
    if (parsed.isZeroDayClean) {
      // Garantizar que el propietario raíz esté siempre en la lista
      if (!parsed.usuariosAutorizados || !parsed.usuariosAutorizados.some(u => u.email.toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase())) {
        const rootUser = {
          id: 'owner-peduwan',
          email: ROOT_OWNER_EMAIL,
          nombre: 'Propietario Principal',
          rol: 'propietario' as const,
          activo: true,
          agregadoPor: 'sistema',
          fechaAlta: new Date().toISOString()
        };
        parsed.usuariosAutorizados = [rootUser, ...(parsed.usuariosAutorizados || [])];
        saveAppData(parsed);
      }
      return parsed;
    }

    // Asegurar siempre el usuario propietario en la lista
    if (!parsed.usuariosAutorizados || !parsed.usuariosAutorizados.some(u => u.email.toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase())) {
      const rootUser = {
        id: 'owner-peduwan',
        email: ROOT_OWNER_EMAIL,
        nombre: 'Propietario Principal',
        rol: 'propietario' as const,
        activo: true,
        agregadoPor: 'sistema',
        fechaAlta: new Date().toISOString()
      };
      parsed.usuariosAutorizados = [rootUser, ...(parsed.usuariosAutorizados || [])];
      saveAppData(parsed);
    }

    return parsed;
  } catch (err) {
    console.error('Error loading app data from localStorage:', err);
    return getInitialData();
  }
}


export function saveAppData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Error saving app data to localStorage:', err);
  }
}

export function resetToInitialData(): AppData {
  const initial = getInitialData();
  saveAppData(initial);
  return initial;
}
