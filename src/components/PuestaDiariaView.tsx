import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Egg,
  Plus,
  Calendar,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Filter,
  Info,
  Trash2,
  Printer,
  FileText,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Scale,
  Droplet,
  Wheat,
  BarChart3,
  Clock,
  Sparkles,
  Layers,
  Heart,
  ShieldCheck,
  CalendarDays,
  Loader2,
  ArrowDown
} from 'lucide-react';
import { LotePuesta, LoteEnvasado, Nave } from '../types';
import { calcularDCP, generarCodigoLotePuesta, formatearFechaES, calcularEdadLote, EdadLoteInfo } from '../utils/storage';
import { AsistenteVozPuesta } from './AsistenteVozPuesta';

interface PuestaDiariaViewProps {
  naves: Nave[];
  lotesPuesta: LotePuesta[];
  lotesEnvasados?: LoteEnvasado[];
  config?: {
    nombreEmpresa: string;
    cifEmpresa: string;
    direccionEmpresa: string;
    telefonoEmpresa: string;
    emailEmpresa: string;
    registroSanitario: string;
  };
  onAddLotePuesta: (lote: LotePuesta) => void;
  onDeleteLotePuesta: (id: string) => void;
}

export const PuestaDiariaView: React.FC<PuestaDiariaViewProps> = ({
  naves,
  lotesPuesta,
  lotesEnvasados = [],
  config = {
    nombreEmpresa: 'Avícola San Jerónimo S.L.',
    cifEmpresa: 'B-12345678',
    direccionEmpresa: 'Polígono Ganadero El Valle, Parcela 14, 45000 Toledo',
    telefonoEmpresa: '+34 925 123 456',
    emailEmpresa: 'trazabilidad@avicolasanjeronimo.es',
    registroSanitario: 'ES 14.05432/TO CE'
  },
  onAddLotePuesta,
  onDeleteLotePuesta
}) => {
  const hoy = new Date().toISOString().split('T')[0];

  // Subpestañas superiores inspiradas en la captura (RECORDS | ANALYSIS | EXPORT)
  const [subTab, setSubTab] = useState<'records' | 'analysis' | 'export'>('records');
  const [modoVista, setModoVista] = useState<'timeline' | 'lista'>('timeline');

  // Control de apertura del Modal de Nuevo Registro con botón '+'
  const [mostrarModalNuevoRegistro, setMostrarModalNuevoRegistro] = useState(false);

  // Control de elementos expandidos en el histórico
  const [lotesExpandidos, setLotesExpandidos] = useState<Record<string, boolean>>({});

  // Filtros del histórico
  const [filtroNave, setFiltroNave] = useState<string>('todas');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'disponibles' | 'agotados'>('todos');
  const [fechaDesde, setFechaDesde] = useState<string>('');
  const [fechaHasta, setFechaHasta] = useState<string>('');
  const [mostrarFiltrosAvanzados, setMostrarFiltrosAvanzados] = useState(false);

  // Scroll Infinito por Meses y Nivel Superior Mensual
  const [mesesVisiblesCount, setMesesVisiblesCount] = useState<number>(1);
  const [cargandoSiguienteMes, setCargandoSiguienteMes] = useState<boolean>(false);
  const [filtroMesDirecto, setFiltroMesDirecto] = useState<string>('todos_progresivo');
  const [mesesColapsados, setMesesColapsados] = useState<Record<string, boolean>>({});
  const [loteParaEliminar, setLoteParaEliminar] = useState<LotePuesta | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Estado del formulario de registro diario (vacíos por defecto)
  const [naveId, setNaveId] = useState(naves[0]?.id || '');
  const [fechaPuesta, setFechaPuesta] = useState(hoy);
  const [totalRecogida, setTotalRecogida] = useState<number | ''>('');

  // Calibres (vacíos por defecto)
  const [xl, setXl] = useState<number | ''>('');
  const [l, setL] = useState<number | ''>('');
  const [m, setM] = useState<number | ''>('');
  const [s, setS] = useState<number | ''>('');

  // Mermas en recogida (vacíos por defecto)
  const [rotos, setRotos] = useState<number | ''>('');
  const [sucios, setSucios] = useState<number | ''>('');
  const [descarte, setDescarte] = useState<number | ''>('');

  const [observaciones, setObservaciones] = useState('');

  // Modal para informe imprimible de la administración
  const [mostrarModalInforme, setMostrarModalInforme] = useState(false);

  useEffect(() => {
    if (mostrarModalInforme) {
      document.body.classList.add('has-print-modal');
    } else {
      document.body.classList.remove('has-print-modal');
    }
    return () => {
      document.body.classList.remove('has-print-modal');
    };
  }, [mostrarModalInforme]);

  const toggleExpandirLote = (id: string) => {
    setLotesExpandidos(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const naveSeleccionada = naves.find(n => n.id === naveId) || naves[0];
  const fechaCaducidadCalculada = calcularDCP(fechaPuesta);
  const codigoLoteCalculado = naveSeleccionada
    ? generarCodigoLotePuesta(naveSeleccionada.codigo, fechaPuesta)
    : '';

  // Cálculos dinámicos del formulario
  const numTotal = Number(totalRecogida) || 0;
  const numRotos = Number(rotos) || 0;
  const numSucios = Number(sucios) || 0;
  const numDescarte = Number(descarte) || 0;
  const totalMermas = numRotos + numSucios + numDescarte;

  const numXl = Number(xl) || 0;
  const numL = Number(l) || 0;
  const numM = Number(m) || 0;
  const numS = Number(s) || 0;
  const sumaCalibres = numXl + numL + numM + numS;
  const sumaTotalCalculada = sumaCalibres + totalMermas;

  const huevosAptos = Math.max(0, numTotal - totalMermas);
  const diferenciaCalibres = huevosAptos - sumaCalibres;

  // Comprobaciones de coherencia:
  const errorMermasSuperanTotal = numTotal > 0 && totalMermas > numTotal;
  const errorCalibresSuperanAptos = numTotal > 0 && sumaCalibres > 0 && sumaCalibres > huevosAptos;
  const tieneErroresCoherencia = errorMermasSuperanTotal || errorCalibresSuperanAptos;

  const resetFormulario = () => {
    setTotalRecogida('');
    setXl('');
    setL('');
    setM('');
    setS('');
    setRotos('');
    setSucios('');
    setDescarte('');
    setObservaciones('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!naveSeleccionada) {
      alert('Por favor, selecciona una nave válida.');
      return;
    }

    let finalTotal = numTotal;
    if (finalTotal <= 0 && sumaTotalCalculada > 0) {
      finalTotal = sumaTotalCalculada;
    }

    if (finalTotal <= 0) {
      alert('Debes indicar la cantidad de huevos recogidos o rellenar los calibres / mermas.');
      return;
    }

    if (totalMermas > finalTotal) {
      alert(`Error de coherencia: Las mermas (${totalMermas.toLocaleString()} uds) no pueden superar los huevos recogidos (${finalTotal.toLocaleString()} uds).`);
      return;
    }

    const finalHuevosAptos = Math.max(0, finalTotal - totalMermas);

    if (sumaCalibres > 0 && sumaCalibres > finalHuevosAptos) {
      alert(`Error de coherencia: La clasificación por calibres (${sumaCalibres.toLocaleString()} uds) no puede superar los huevos aptos (${finalHuevosAptos.toLocaleString()} uds). Exceso: ${(sumaCalibres - finalHuevosAptos).toLocaleString()} uds.`);
      return;
    }

    const nuevoLote: LotePuesta = {
      id: 'lp-' + Date.now(),
      codigoLote: codigoLoteCalculado,
      naveId: naveSeleccionada.id,
      nombreNave: naveSeleccionada.nombre,
      tipoCria: naveSeleccionada.tipoCria,
      codigoREGA: naveSeleccionada.codigoREGA,
      fechaPuesta,
      fechaCaducidad: fechaCaducidadCalculada,
      totalHuevosRecogidos: finalTotal,
      calibres: {
        xl: numXl,
        l: numL,
        m: numM,
        s: numS
      },
      mermas: {
        rotos: numRotos,
        sucios: numSucios,
        descarte: numDescarte
      },
      huevosAptos: finalHuevosAptos,
      huevosDisponibles: finalHuevosAptos,
      observaciones: observaciones.trim() || undefined,
      creadoEn: new Date().toISOString()
    };

    onAddLotePuesta(nuevoLote);
    resetFormulario();
    setMostrarModalNuevoRegistro(false);
  };

  // Filtrado de lotes con soporte de Rango de Fechas
  const lotesFiltrados = lotesPuesta.filter(lote => {
    if (filtroNave !== 'todas' && lote.naveId !== filtroNave) return false;
    if (filtroEstado === 'disponibles' && lote.huevosDisponibles <= 0) return false;
    if (filtroEstado === 'agotados' && lote.huevosDisponibles > 0) return false;
    if (fechaDesde && lote.fechaPuesta < fechaDesde) return false;
    if (fechaHasta && lote.fechaPuesta > fechaHasta) return false;
    return true;
  });

  // Agrupación para la Vista Timeline y Lista con Nivel Superior MENSUAL
  interface ItemPuestaTimeline {
    lote: LotePuesta;
    edad: EdadLoteInfo;
    nave?: Nave;
    tasaPuestaPorcentaje?: number;
    estaEnvasado: boolean;
    huevosConsumidosEnvasado: number;
    totalMermasLote: number;
    porcentajeRestante: number;
    diasRestantesDCP: number;
  }

  interface GrupoSemanaTimeline {
    semanaVida: number;
    semanaPuesta: number;
    items: ItemPuestaTimeline[];
    totalHuevos: number;
    totalAptos: number;
    totalMermas: number;
  }

  interface GrupoMesTimeline {
    mesClave: string; // ej: "2026-09"
    nombreMes: string; // ej: "Septiembre 2026"
    anio: number;
    mesNumero: number;
    esMesActual: boolean;
    totalHuevosRecogidos: number;
    totalHuevosAptos: number;
    totalMermas: number;
    diasRegistrados: number;
    calibres: {
      xl: number;
      l: number;
      m: number;
      s: number;
    };
    semanas: GrupoSemanaTimeline[];
    itemsMes: ItemPuestaTimeline[];
  }

  // Ordenar cronológicamente descendente (más reciente primero)
  const lotesOrdenados = useMemo(() => {
    return [...lotesFiltrados].sort((a, b) => {
      return new Date(b.fechaPuesta).getTime() - new Date(a.fechaPuesta).getTime();
    });
  }, [lotesFiltrados]);

  const mesActualClave = hoy.substring(0, 7);

  const formatearNombreMes = (mesClave: string): string => {
    const [anioStr, mesStr] = mesClave.split('-');
    const anio = parseInt(anioStr, 10);
    const mesIdx = parseInt(mesStr, 10) - 1;
    const meses = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return `${meses[mesIdx] || mesStr} ${anio}`;
  };

  // Agrupación jerárquica: Mes (Nivel Superior) -> Semanas -> Días (Timeline y Lista)
  const gruposMeses: GrupoMesTimeline[] = useMemo(() => {
    const mapaMeses = new Map<string, {
      mesClave: string;
      nombreMes: string;
      anio: number;
      mesNumero: number;
      esMesActual: boolean;
      totalHuevosRecogidos: number;
      totalHuevosAptos: number;
      totalMermas: number;
      diasRegistrados: number;
      calibres: { xl: number; l: number; m: number; s: number };
      mapaSemanas: Map<number, GrupoSemanaTimeline>;
      itemsMes: ItemPuestaTimeline[];
    }>();

    lotesOrdenados.forEach(lote => {
      const mesClave = lote.fechaPuesta ? lote.fechaPuesta.substring(0, 7) : mesActualClave;
      const [anioStr, mesStr] = mesClave.split('-');
      const anio = parseInt(anioStr, 10) || new Date().getFullYear();
      const mesNumero = parseInt(mesStr, 10) || (new Date().getMonth() + 1);

      const naveLote = naves.find(n => n.id === lote.naveId || n.codigo === lote.codigoLote.split('-')[0]);
      const edad = calcularEdadLote(lote.fechaPuesta, naveLote?.fechaEntrada, naveLote?.edadSemanasEntrada ?? 24);

      const totalMermasLote = (lote.mermas?.rotos || 0) + (lote.mermas?.sucios || 0) + (lote.mermas?.descarte || 0);
      const porcentajeRestante = lote.huevosAptos > 0
        ? Math.round((lote.huevosDisponibles / lote.huevosAptos) * 100)
        : 0;

      const hoyDate = new Date();
      const caducidadDate = new Date(lote.fechaCaducidad);
      const diasRestantesDCP = Math.ceil((caducidadDate.getTime() - hoyDate.getTime()) / (1000 * 3600 * 24));

      const estaEnvasado = lotesEnvasados.some(le =>
        le.componentesLotes?.some(c => c.lotePuestaId === lote.id || c.codigoLotePuesta === lote.codigoLote)
      ) || (lote.huevosDisponibles < lote.huevosAptos);
      const huevosConsumidosEnvasado = lote.huevosAptos - lote.huevosDisponibles;

      const tasaPuesta = naveLote && naveLote.capacidadAves > 0
        ? Math.min(100, Math.round((lote.totalHuevosRecogidos / naveLote.capacidadAves) * 1000) / 10)
        : undefined;

      const item: ItemPuestaTimeline = {
        lote,
        edad,
        nave: naveLote,
        tasaPuestaPorcentaje: tasaPuesta,
        estaEnvasado,
        huevosConsumidosEnvasado,
        totalMermasLote,
        porcentajeRestante,
        diasRestantesDCP
      };

      if (!mapaMeses.has(mesClave)) {
        const mapaSemanas = new Map<number, GrupoSemanaTimeline>();
        mapaSemanas.set(edad.semanaVida, {
          semanaVida: edad.semanaVida,
          semanaPuesta: edad.semanaPuesta,
          items: [item],
          totalHuevos: lote.totalHuevosRecogidos,
          totalAptos: lote.huevosAptos,
          totalMermas: totalMermasLote
        });

        mapaMeses.set(mesClave, {
          mesClave,
          nombreMes: formatearNombreMes(mesClave),
          anio,
          mesNumero,
          esMesActual: mesClave === mesActualClave,
          totalHuevosRecogidos: lote.totalHuevosRecogidos,
          totalHuevosAptos: lote.huevosAptos,
          totalMermas: totalMermasLote,
          diasRegistrados: 1,
          calibres: {
            xl: lote.calibres?.xl || 0,
            l: lote.calibres?.l || 0,
            m: lote.calibres?.m || 0,
            s: lote.calibres?.s || 0
          },
          mapaSemanas,
          itemsMes: [item]
        });
      } else {
        const mesData = mapaMeses.get(mesClave)!;
        mesData.totalHuevosRecogidos += lote.totalHuevosRecogidos;
        mesData.totalHuevosAptos += lote.huevosAptos;
        mesData.totalMermas += totalMermasLote;
        mesData.diasRegistrados += 1;
        mesData.calibres.xl += (lote.calibres?.xl || 0);
        mesData.calibres.l += (lote.calibres?.l || 0);
        mesData.calibres.m += (lote.calibres?.m || 0);
        mesData.calibres.s += (lote.calibres?.s || 0);
        mesData.itemsMes.push(item);

        if (!mesData.mapaSemanas.has(edad.semanaVida)) {
          mesData.mapaSemanas.set(edad.semanaVida, {
            semanaVida: edad.semanaVida,
            semanaPuesta: edad.semanaPuesta,
            items: [item],
            totalHuevos: lote.totalHuevosRecogidos,
            totalAptos: lote.huevosAptos,
            totalMermas: totalMermasLote
          });
        } else {
          const sem = mesData.mapaSemanas.get(edad.semanaVida)!;
          sem.items.push(item);
          sem.totalHuevos += lote.totalHuevosRecogidos;
          sem.totalAptos += lote.huevosAptos;
          sem.totalMermas += totalMermasLote;
        }
      }
    });

    return Array.from(mapaMeses.values()).map(m => ({
      mesClave: m.mesClave,
      nombreMes: m.nombreMes,
      anio: m.anio,
      mesNumero: m.mesNumero,
      esMesActual: m.esMesActual,
      totalHuevosRecogidos: m.totalHuevosRecogidos,
      totalHuevosAptos: m.totalHuevosAptos,
      totalMermas: m.totalMermas,
      diasRegistrados: m.diasRegistrados,
      calibres: m.calibres,
      semanas: Array.from(m.mapaSemanas.values()),
      itemsMes: m.itemsMes
    }));
  }, [lotesOrdenados, naves, lotesEnvasados, mesActualClave]);

  // Reiniciar a 1 mes cargado (mes actual/más reciente) al cambiar filtros
  useEffect(() => {
    setMesesVisiblesCount(1);
  }, [filtroNave, filtroEstado, fechaDesde, fechaHasta]);

  const totalMeses = gruposMeses.length;
  const hayMasMeses = filtroMesDirecto === 'todos_progresivo' && mesesVisiblesCount < totalMeses;
  const siguienteMesNombre = hayMasMeses ? gruposMeses[mesesVisiblesCount]?.nombreMes : null;

  const cargarSiguienteMes = () => {
    if (hayMasMeses && !cargandoSiguienteMes) {
      setCargandoSiguienteMes(true);
      setTimeout(() => {
        setMesesVisiblesCount(prev => Math.min(prev + 1, totalMeses));
        setCargandoSiguienteMes(false);
      }, 260);
    }
  };

  const cargarTodosLosMeses = () => {
    setMesesVisiblesCount(totalMeses);
  };

  // IntersectionObserver para detectar el scroll al final y cargar automáticamente el mes anterior
  useEffect(() => {
    if (!hayMasMeses || filtroMesDirecto !== 'todos_progresivo') return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !cargandoSiguienteMes) {
          cargarSiguienteMes();
        }
      },
      { threshold: 0.1, rootMargin: '150px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hayMasMeses, cargandoSiguienteMes, mesesVisiblesCount, totalMeses, filtroMesDirecto]);

  // Meses a renderizar según modo progresivo o salto directo
  const mesesARenderizar = useMemo(() => {
    if (filtroMesDirecto !== 'todos_progresivo') {
      return gruposMeses.filter(g => g.mesClave === filtroMesDirecto);
    }
    return gruposMeses.slice(0, mesesVisiblesCount);
  }, [gruposMeses, filtroMesDirecto, mesesVisiblesCount]);

  const toggleColapsoMes = (mesClave: string) => {
    setMesesColapsados(prev => ({
      ...prev,
      [mesClave]: !prev[mesClave]
    }));
  };

  // Totales agregados para análisis e informes
  const totalesInforme = lotesFiltrados.reduce((acc, l) => {
    acc.recogidos += l.totalHuevosRecogidos;
    acc.aptos += l.huevosAptos;
    acc.disponibles += l.huevosDisponibles;
    acc.xl += l.calibres.xl;
    acc.l += l.calibres.l;
    acc.m += l.calibres.m;
    acc.s += l.calibres.s;
    acc.rotos += l.mermas.rotos;
    acc.sucios += l.mermas.sucios;
    acc.descarte += l.mermas.descarte;
    acc.totalMermas += (l.mermas.rotos + l.mermas.sucios + l.mermas.descarte);
    return acc;
  }, {
    recogidos: 0,
    aptos: 0,
    disponibles: 0,
    xl: 0,
    l: 0,
    m: 0,
    s: 0,
    rotos: 0,
    sucios: 0,
    descarte: 0,
    totalMermas: 0
  });

  const porcentajeAptitud = totalesInforme.recogidos > 0
    ? ((totalesInforme.aptos / totalesInforme.recogidos) * 100).toFixed(1)
    : '100';

  const naveFiltroActiva = naves.find(n => n.id === filtroNave);

  return (
    <>
      <div className={`space-y-4 max-w-4xl mx-auto pb-20 ${mostrarModalInforme ? 'print:hidden' : ''}`}>
        {/* 1. HERO CARD SUPERIOR ESTILO CAPTURA 2 & 3 */}
      <div className="bg-gradient-to-r from-amber-500 via-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {naveFiltroActiva ? naveFiltroActiva.nombre : 'Todos los Lotes de Puesta'}
              </h2>
            </div>
            <p className="text-amber-100 text-xs sm:text-sm font-medium flex items-center gap-2">
              <span>{naveFiltroActiva ? `${naveFiltroActiva.codigo} · ${naveFiltroActiva.tipoCria.split('-')[1]}` : 'Explotación Avícola Integral'}</span>
              <span>•</span>
              <span>{lotesFiltrados.length} Registros Activos</span>
            </p>
          </div>

          {/* Botón '+' de acción principal en cabecera */}
          <button
            type="button"
            onClick={() => setMostrarModalNuevoRegistro(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-white text-amber-800 hover:bg-amber-50 font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
          >
            <Plus className="w-4 h-4 text-amber-600" />
            <span>Nueva Puesta</span>
          </button>
        </div>

        {/* Cifras rápidas en la tarjeta hero */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-amber-400/40 text-xs text-white">
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Total Recogidos</span>
            <strong className="text-sm sm:text-base font-bold">{totalesInforme.recogidos.toLocaleString()}</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Aptos Envasar</span>
            <strong className="text-sm sm:text-base font-bold text-white">{totalesInforme.aptos.toLocaleString()}</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Calidad Comercial</span>
            <strong className="text-sm sm:text-base font-bold text-amber-100">{porcentajeAptitud}%</strong>
          </div>
        </div>
      </div>

      {/* 2. BARRA DE SUB-PESTAÑAS ESTILO CAPTURA 2 (RECORDS | ANALYSIS | EXPORT) */}
      <div className="flex border-b border-stone-200 justify-around text-xs sm:text-sm font-bold tracking-wider text-stone-500">
        <button
          type="button"
          onClick={() => setSubTab('records')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'records'
              ? 'text-amber-600'
              : 'hover:text-stone-800'
          }`}
        >
          <span>Registros (Histórico)</span>
          {subTab === 'records' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('analysis')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'analysis'
              ? 'text-amber-600'
              : 'hover:text-stone-800'
          }`}
        >
          <span>Análisis y Calibres</span>
          {subTab === 'analysis' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('export')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'export'
              ? 'text-amber-600'
              : 'hover:text-stone-800'
          }`}
        >
          <span>Libro Oficial (Export)</span>
          {subTab === 'export' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>
      </div>

      {/* 3. CONTENIDO SEGÚN LA PESTAÑA SELECCIONADA */}

      {/* === SUBTAB: REGISTROS (HISTÓRICO DÍA A DÍA - CAPTURA 1 Y 3) === */}
      {subTab === 'records' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          {/* Barra de Filtros Compacta con Selector de Vista Timeline vs Lista */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
                <Layers className="w-3.5 h-3.5 text-amber-600" />
                <span>Lotes Activos ({lotesFiltrados.length})</span>
              </div>

              {/* Selector de Modo de Vista: Timeline Semanal vs Lista */}
              <div className="flex items-center bg-stone-100 p-0.5 rounded-lg border border-stone-200 text-xs">
                <button
                  type="button"
                  onClick={() => setModoVista('timeline')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    modoVista === 'timeline'
                      ? 'bg-amber-700 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Timeline</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModoVista('lista')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    modoVista === 'lista'
                      ? 'bg-amber-700 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Lista</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filtroNave}
                onChange={e => setFiltroNave(e.target.value)}
                className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="todas">Todas las Naves</option>
                {naves.map(n => (
                  <option key={n.id} value={n.id}>{n.nombre}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setMostrarFiltrosAvanzados(!mostrarFiltrosAvanzados)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1 font-medium transition-colors cursor-pointer ${
                  mostrarFiltrosAvanzados || fechaDesde || fechaHasta
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                <Filter className="w-3 h-3 text-stone-500" />
                <span>Fechas y Stock</span>
              </button>
            </div>
          </div>

          {/* Panel Desplegable de Filtros Avanzados */}
          {mostrarFiltrosAvanzados && (
            <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-stone-500 mb-1 font-medium">Desde fecha:</label>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={e => setFechaDesde(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg p-1.5 bg-stone-50 text-xs"
                />
              </div>
              <div>
                <label className="block text-stone-500 mb-1 font-medium">Hasta fecha:</label>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={e => setFechaHasta(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg p-1.5 bg-stone-50 text-xs"
                />
              </div>
              <div>
                <label className="block text-stone-500 mb-1 font-medium">Stock de Huevos:</label>
                <select
                  value={filtroEstado}
                  onChange={e => setFiltroEstado(e.target.value as any)}
                  className="w-full border border-stone-200 rounded-lg p-1.5 bg-stone-50 text-xs"
                >
                  <option value="todos">Todos los Estados</option>
                  <option value="disponibles">Con Stock Disponible</option>
                  <option value="agotados">Agotados (0 uds)</option>
                </select>
              </div>
            </div>
          )}

          {/* BARRA DE NAVEGACIÓN RÁPIDA POR MESES */}
          {gruposMeses.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
              <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5 text-amber-600" />
                <span>Meses:</span>
              </span>

              <button
                type="button"
                onClick={() => setFiltroMesDirecto('todos_progresivo')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                  filtroMesDirecto === 'todos_progresivo'
                    ? 'bg-amber-700 text-white shadow-xs'
                    : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                }`}
              >
                <span>Scroll Infinito (Progresivo)</span>
                <span className="font-mono text-[10px] bg-white/20 px-1.5 py-0.5 rounded">
                  {mesesVisiblesCount} de {totalMeses}
                </span>
              </button>

              {gruposMeses.map(m => (
                <button
                  key={m.mesClave}
                  type="button"
                  onClick={() => setFiltroMesDirecto(m.mesClave)}
                  className={`px-3 py-1.5 rounded-xl font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    filtroMesDirecto === m.mesClave
                      ? 'bg-amber-800 text-white shadow-xs font-bold'
                      : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                  }`}
                >
                  <span>{m.nombreMes}</span>
                  {m.esMesActual && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  )}
                  <span className="font-mono text-[10px] opacity-75">
                    ({m.totalHuevosRecogidos.toLocaleString()})
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* LISTADO DIARIO CRONOLÓGICO */}
          {lotesFiltrados.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
                <Egg className="w-6 h-6" />
              </div>
              <h3 className="text-stone-800 font-bold text-sm">No hay registros de puesta</h3>
              <p className="text-stone-500 text-xs max-w-sm mx-auto">
                No se han encontrado puestas para los filtros seleccionados. Pulsa el botón <strong className="text-amber-700 font-semibold">+</strong> para registrar una nueva recogida.
              </p>
              <button
                type="button"
                onClick={() => setMostrarModalNuevoRegistro(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar Primera Puesta</span>
              </button>
            </div>
          ) : modoVista === 'timeline' ? (
            /* VISTA TIMELINE CON NIVEL SUPERIOR MENSUAL (MES -> SEMANA -> DÍA) */
            <div className="space-y-8 pt-1">
              {mesesARenderizar.map(grupoMes => {
                const estaMesColapsado = Boolean(mesesColapsados[grupoMes.mesClave]);

                return (
                  <div key={grupoMes.mesClave} className="space-y-4">
                    {/* Cabecera del Mes (Nivel Superior) */}
                    <div className="bg-gradient-to-r from-stone-900 via-stone-850 to-amber-950 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-stone-800/80">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 flex items-center justify-center shrink-0">
                            <CalendarDays className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-lg sm:text-xl font-black text-white tracking-tight">
                                {grupoMes.nombreMes}
                              </h3>
                              {grupoMes.esMesActual && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                  Mes en Curso
                                </span>
                              )}
                            </div>
                            <p className="text-stone-300 text-xs mt-0.5 flex items-center gap-2">
                              <span>{grupoMes.diasRegistrados} {grupoMes.diasRegistrados === 1 ? 'recogida' : 'recogidas registradas'}</span>
                              <span>•</span>
                              <span className="text-amber-300 font-bold">{grupoMes.totalHuevosRecogidos.toLocaleString()} huevos</span>
                              <span>•</span>
                              <span className="text-emerald-300 font-semibold">{grupoMes.totalHuevosAptos.toLocaleString()} aptos</span>
                            </p>
                          </div>
                        </div>

                        {/* Resumen de Calibres y Botón de Plegar */}
                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono bg-stone-950/70 px-3 py-1.5 rounded-xl border border-stone-700/60 text-stone-300">
                            <span className="text-amber-400 font-bold">XL: {grupoMes.calibres.xl.toLocaleString()}</span>
                            <span className="text-stone-500">·</span>
                            <span className="text-amber-300 font-bold">L: {grupoMes.calibres.l.toLocaleString()}</span>
                            <span className="text-stone-500">·</span>
                            <span className="text-stone-300 font-bold">M: {grupoMes.calibres.m.toLocaleString()}</span>
                            <span className="text-stone-500">·</span>
                            <span className="text-stone-400 font-bold">S: {grupoMes.calibres.s.toLocaleString()}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleColapsoMes(grupoMes.mesClave)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800/80 hover:bg-stone-700 text-stone-200 hover:text-white rounded-xl text-xs font-bold transition-all border border-stone-700 cursor-pointer"
                            title={estaMesColapsado ? 'Expandir semanas del mes' : 'Plegar mes'}
                          >
                            <span>{estaMesColapsado ? 'Ver Semanas' : 'Plegar'}</span>
                            {estaMesColapsado ? <ChevronDown className="w-4 h-4 text-amber-400" /> : <ChevronUp className="w-4 h-4 text-amber-400" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Semanas del Mes */}
                    {!estaMesColapsado && (
                      <div className="space-y-6 pl-1 sm:pl-2">
                        {grupoMes.semanas.map(grupo => (
                          <div key={`${grupoMes.mesClave}-sem-${grupo.semanaVida}`} className="space-y-3">
                            {/* Cabecera de la Semana (ej: Sem 32) */}
                            <div className="flex items-center gap-3">
                              <div className="bg-amber-700 text-white px-3.5 py-1.5 rounded-xl font-black text-sm tracking-tight shadow-xs flex items-center gap-1.5 shrink-0">
                                <span>Sem {grupo.semanaVida}</span>
                              </div>
                              <div className="flex-1 flex flex-wrap items-center justify-between text-xs text-stone-600 border-b border-amber-200/70 pb-1 gap-2">
                                <span className="font-bold text-stone-800">
                                  Semana {grupo.semanaVida} de vida · Sem {grupo.semanaPuesta} de puesta en nave
                                </span>
                                <span className="text-[11px] text-stone-500 font-mono bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                  {grupo.totalHuevos.toLocaleString()} huevos recogidos ({grupo.items.length} {grupo.items.length === 1 ? 'día' : 'días'})
                                </span>
                              </div>
                            </div>

                            {/* Conector Vertical de Timeline */}
                            <div className="relative pl-6 sm:pl-8 space-y-4 border-l-2 border-amber-300 ml-4 sm:ml-5">
                              {grupo.items.map(({ lote, edad, nave, tasaPuestaPorcentaje, estaEnvasado, huevosConsumidosEnvasado, totalMermasLote, porcentajeRestante, diasRestantesDCP }) => {
                                const estaExpandido = Boolean(lotesExpandidos[lote.id]);

                                return (
                                  <div key={lote.id} className="relative">
                                    {/* Nodo circular del timeline */}
                                    <div className="absolute -left-[31px] sm:-left-[39px] mt-4 w-4 h-4 rounded-full bg-amber-600 border-2 border-white shadow-xs" />

                                    {/* Tarjeta de Datos de Puesta */}
                                    <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-xs hover:shadow-md transition-all space-y-3">
                                      {/* Cabecera: Día 56 / Día 55 */}
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                          <span className="text-lg font-black text-stone-900 tracking-tight">
                                            Día {edad.diasEnNave}
                                          </span>
                                          <span className="text-xs font-bold bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-lg">
                                            {formatearFechaES(lote.fechaPuesta)}
                                          </span>
                                          <span className="text-xs font-mono font-bold bg-stone-100 text-stone-700 px-2 py-0.5 rounded border border-stone-200">
                                            {lote.codigoLote}
                                          </span>
                                          <span className="text-xs font-semibold text-stone-600">
                                            {nave?.nombre || lote.nombreNave}
                                          </span>
                                          {estaEnvasado && (
                                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                              <span>Envasado</span>
                                            </span>
                                          )}
                                        </div>

                                        <div className="text-xs text-stone-400 font-mono">
                                          <span>DCP: {formatearFechaES(lote.fechaCaducidad)}</span>
                                        </div>
                                      </div>

                                      {/* Datos de Puesta */}
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                        <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200/60">
                                          <span className="text-[10px] uppercase font-bold text-amber-900/70 block">Huevos Recogidos</span>
                                          <strong className="text-lg font-black text-amber-950 block">
                                            {lote.totalHuevosRecogidos.toLocaleString()} <span className="text-xs font-normal">uds</span>
                                          </strong>
                                          <span className="text-[10px] text-amber-800/80">Recolección de nave</span>
                                        </div>

                                        <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-200/60">
                                          <span className="text-[10px] uppercase font-bold text-emerald-900/70 block">Huevos Aptos</span>
                                          <strong className="text-lg font-black text-emerald-950 block">
                                            {lote.huevosAptos.toLocaleString()} <span className="text-xs font-normal">aptos</span>
                                          </strong>
                                          <span className="text-[10px] text-emerald-700">Para clasificar/envasar</span>
                                        </div>

                                        <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
                                          <span className="text-[10px] uppercase font-bold text-stone-500 block">Tasa de Puesta</span>
                                          <strong className="text-lg font-black text-stone-900 block">
                                            {tasaPuestaPorcentaje !== undefined ? `${tasaPuestaPorcentaje}%` : '—'}
                                          </strong>
                                          <span className="text-[10px] text-stone-400">Puesta diaria s/censo</span>
                                        </div>

                                        <div className={`p-3 rounded-xl border ${
                                          totalMermasLote > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-stone-50 border-stone-200/60'
                                        }`}>
                                          <span className="text-[10px] uppercase font-bold text-stone-500 block">Mermas en Puesta</span>
                                          <strong className={`text-lg font-black block ${totalMermasLote > 0 ? 'text-rose-700' : 'text-stone-800'}`}>
                                            {totalMermasLote} <span className="text-xs font-normal">uds</span>
                                          </strong>
                                          <span className="text-[10px] text-stone-400">
                                            {lote.mermas.rotos} rot · {lote.mermas.sucios} suc · {lote.mermas.descarte} desc
                                          </span>
                                        </div>
                                      </div>

                                      {/* Calibres y Stock */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100 text-xs">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-[11px] font-bold text-stone-500 uppercase">Calibres:</span>
                                          <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 rounded text-stone-800 font-bold text-[11px]">
                                            XL: {lote.calibres.xl}
                                          </span>
                                          <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 rounded text-stone-800 font-bold text-[11px]">
                                            L: {lote.calibres.l}
                                          </span>
                                          <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 rounded text-stone-800 font-bold text-[11px]">
                                            M: {lote.calibres.m}
                                          </span>
                                          <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 rounded text-stone-800 font-bold text-[11px]">
                                            S: {lote.calibres.s}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                          <span className="text-[11px] text-stone-600">
                                            Stock almacén: <strong className="text-amber-700">{lote.huevosDisponibles.toLocaleString()}</strong> de {lote.huevosAptos.toLocaleString()}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => toggleExpandirLote(lote.id)}
                                            className="text-amber-700 hover:text-amber-800 font-bold text-xs hover:underline cursor-pointer"
                                          >
                                            {estaExpandido ? 'Menos detalles ▲' : 'Más detalles ▼'}
                                          </button>
                                        </div>
                                      </div>

                                      {/* Desglose Expandible */}
                                      {estaExpandido && (
                                        <div className="pt-3 border-t border-stone-100 space-y-3 text-xs bg-stone-50/50 p-3 rounded-xl">
                                          {lote.observaciones && (
                                            <div className="p-2 bg-white rounded-lg border border-stone-200 text-stone-700 italic">
                                              «{lote.observaciones}»
                                            </div>
                                          )}

                                          <div className="flex items-center justify-between text-xs pt-1">
                                            <span className="text-stone-500 font-mono text-[11px]">
                                              Registro oficial: {lote.id} · DCP {formatearFechaES(lote.fechaCaducidad)}
                                            </span>
                                            <div>
                                              {estaEnvasado ? (
                                                <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                                                  🔒 Lote con huevos envasados ({huevosConsumidosEnvasado.toLocaleString()} uds) · Inmutable por RD 226/2008
                                                </span>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => setLoteParaEliminar(lote)}
                                                  className="text-red-600 hover:text-red-800 font-bold hover:underline inline-flex items-center gap-1 cursor-pointer"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                  <span>Eliminar Lote</span>
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* VISTA LISTA AGRUPADA POR MES CON NIVEL SUPERIOR */
            <div className="space-y-6">
              {mesesARenderizar.map(grupoMes => {
                const estaMesColapsado = Boolean(mesesColapsados[grupoMes.mesClave]);

                return (
                  <div key={grupoMes.mesClave} className="space-y-3">
                    {/* Cabecera del Mes en Vista Lista */}
                    <div className="bg-gradient-to-r from-stone-900 via-stone-850 to-amber-950 text-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-stone-800/80 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <CalendarDays className="w-5 h-5 text-amber-400 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm sm:text-base">{grupoMes.nombreMes}</span>
                            {grupoMes.esMesActual && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                Mes en Curso
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-stone-300">
                            {grupoMes.diasRegistrados} {grupoMes.diasRegistrados === 1 ? 'recogida' : 'recogidas'} · {grupoMes.totalHuevosRecogidos.toLocaleString()} huevos recogidos
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleColapsoMes(grupoMes.mesClave)}
                        className="flex items-center gap-1 text-xs text-stone-300 hover:text-white bg-stone-800/80 hover:bg-stone-700 px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        <span>{estaMesColapsado ? 'Expandir' : 'Plegar'}</span>
                        {estaMesColapsado ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {!estaMesColapsado && (
                      <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
                        {grupoMes.itemsMes.map(({ lote, edad, nave, estaEnvasado, huevosConsumidosEnvasado, totalMermasLote, porcentajeRestante, diasRestantesDCP }) => {
                          const estaExpandido = Boolean(lotesExpandidos[lote.id]);

                          return (
                            <div key={lote.id} className="transition-colors hover:bg-amber-50/30">
                              <div
                                onClick={() => toggleExpandirLote(lote.id)}
                                className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-10 h-10 rounded-full bg-amber-100/90 border border-amber-200 text-amber-800 flex items-center justify-center shrink-0 shadow-xs">
                                    <Egg className="w-5 h-5 fill-amber-300 text-amber-700" />
                                  </div>

                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-stone-900 text-sm tracking-tight">
                                        {lote.codigoLote}
                                      </span>
                                      <span className="text-[10px] font-bold bg-amber-700 text-white px-1.5 py-0.5 rounded">
                                        Día {edad.diasEnNave} · Sem {edad.semanaVida}
                                      </span>
                                      <span className="text-[10px] font-semibold bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                                        {nave?.nombre || lote.nombreNave}
                                      </span>
                                      {estaEnvasado && (
                                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                          <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                          <span>Envasado</span>
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                                      <Calendar className="w-3 h-3 text-stone-400" />
                                      <span>{formatearFechaES(lote.fechaPuesta)}</span>
                                      <span>•</span>
                                      <span className="text-[11px] text-stone-400">DCP: {formatearFechaES(lote.fechaCaducidad)}</span>
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 text-right shrink-0">
                                  <div>
                                    <span className="text-sm font-black text-stone-900 block">
                                      {lote.totalHuevosRecogidos.toLocaleString()} <span className="text-xs font-normal text-stone-500">uds</span>
                                    </span>
                                    <span className="text-[11px] text-emerald-700 font-semibold block">
                                      {lote.huevosAptos.toLocaleString()} aptos
                                      {totalMermasLote > 0 && (
                                        <span className="text-red-600 font-normal text-[10px] ml-1">
                                          (-{totalMermasLote})
                                        </span>
                                      )}
                                    </span>
                                  </div>

                                  <div className="text-stone-400 p-1">
                                    {estaExpandido ? (
                                      <ChevronDown className="w-4 h-4 text-amber-600" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    )}
                                  </div>
                                </div>
                              </div>

                              {estaExpandido && (
                                <div className="px-4 pb-4 pt-1 bg-stone-50/70 border-t border-stone-100 space-y-3 text-xs">
                                  <div className="space-y-1 bg-white p-3 rounded-xl border border-stone-200/80">
                                    <div className="flex justify-between items-center text-xs">
                                      <span className="text-stone-700 font-medium">
                                        Stock en almacén: <strong>{lote.huevosDisponibles.toLocaleString()}</strong> de {lote.huevosAptos.toLocaleString()} huevos aptos
                                        {huevosConsumidosEnvasado > 0 && (
                                          <span className="text-emerald-700 font-normal ml-1">
                                            ({huevosConsumidosEnvasado.toLocaleString()} consumidos en envasado)
                                          </span>
                                        )}
                                      </span>
                                      <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                        porcentajeRestante > 40
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : porcentajeRestante > 0
                                          ? 'bg-amber-100 text-amber-800'
                                          : 'bg-stone-200 text-stone-600'
                                      }`}>
                                        {porcentajeRestante}% restante
                                      </span>
                                    </div>
                                    <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full transition-all ${
                                          porcentajeRestante > 30 ? 'bg-amber-500' : 'bg-orange-500'
                                        }`}
                                        style={{ width: `${porcentajeRestante}%` }}
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                                      <span className="text-[10px] text-stone-400 block uppercase font-bold">Huevos Recogidos</span>
                                      <span className="text-stone-900 font-black text-sm">{lote.totalHuevosRecogidos.toLocaleString()}</span>
                                    </div>
                                    <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                                      <span className="text-[10px] text-stone-400 block uppercase font-bold">Aptos</span>
                                      <span className="text-emerald-800 font-black text-sm">{lote.huevosAptos.toLocaleString()}</span>
                                    </div>
                                    <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                                      <span className="text-[10px] text-stone-400 block uppercase font-bold">Mermas</span>
                                      <span className={`font-black text-sm ${totalMermasLote > 0 ? 'text-red-600' : 'text-stone-900'}`}>
                                        {totalMermasLote}
                                      </span>
                                    </div>
                                    <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                                      <span className="text-[10px] text-stone-400 block uppercase font-bold">Caducidad DCP</span>
                                      <span className="text-stone-900 font-bold text-xs">{diasRestantesDCP} días rest.</span>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-200/60">
                                    <div className="flex items-center gap-1.5 flex-wrap text-stone-600">
                                      <span className="font-semibold text-stone-500">Calibres:</span>
                                      <span className="px-1.5 py-0.5 bg-white border border-stone-200 rounded font-mono">XL: {lote.calibres.xl}</span>
                                      <span className="px-1.5 py-0.5 bg-white border border-stone-200 rounded font-mono">L: {lote.calibres.l}</span>
                                      <span className="px-1.5 py-0.5 bg-white border border-stone-200 rounded font-mono">M: {lote.calibres.m}</span>
                                      <span className="px-1.5 py-0.5 bg-white border border-stone-200 rounded font-mono">S: {lote.calibres.s}</span>
                                    </div>

                                    {estaEnvasado ? (
                                      <div
                                        className="inline-flex items-center gap-1.5 text-xs text-stone-500 bg-stone-100 border border-stone-200/90 px-3 py-1.5 rounded-lg select-none"
                                        title="No se puede eliminar: Registro de puesta con huevos ya envasados en órdenes activas. La normativa oficial de trazabilidad (Real Decreto 226/2008) exige conservar la trazabilidad de origen."
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                        <span>Envasado ({huevosConsumidosEnvasado.toLocaleString()} huevos) · Registro inmutable</span>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLoteParaEliminar(lote);
                                        }}
                                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50 cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Eliminar Lote</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* PIE DE SCROLL INFINITO Y CONTROL DE CARGA DE MESES ANTERIORES */}
          {hayMasMeses && (
            <div ref={sentinelRef} className="pt-6 pb-4 text-center space-y-3">
              {cargandoSiguienteMes ? (
                <div className="inline-flex items-center gap-2.5 px-5 py-2.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-bold shadow-xs animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                  <span>Cargando histórico anterior ({siguienteMesNombre})...</span>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={cargarSiguienteMes}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <ArrowDown className="w-4 h-4 text-amber-600" />
                    <span>Cargar mes anterior ({siguienteMesNombre})</span>
                  </button>

                  <button
                    type="button"
                    onClick={cargarTodosLosMeses}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <span>Mostrar todo el histórico ({totalMeses} meses)</span>
                  </button>
                </div>
              )}
              <p className="text-[11px] text-stone-400">
                Al hacer scroll y llegar al final se cargará automáticamente el mes anterior
              </p>
            </div>
          )}

          {!hayMasMeses && totalMeses > 0 && filtroMesDirecto === 'todos_progresivo' && (
            <div className="py-6 text-center text-xs text-stone-400 border-t border-stone-200 mt-6 space-y-1">
              <div className="inline-flex items-center gap-1.5 font-bold text-stone-600 bg-stone-100 px-3.5 py-1.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Inicio del histórico alcanzado</span>
              </div>
              <p className="text-[11px] text-stone-400">
                Mostrando la totalidad de registros ({totalMeses} {totalMeses === 1 ? 'mes' : 'meses'} · {lotesFiltrados.length} partes de puesta)
              </p>
            </div>
          )}
        </div>
      )}

      {/* === SUBTAB: ANÁLISIS (CUADRÍCULA LIMPIA 2 COLUMNAS - CAPTURA 2) === */}
      {subTab === 'analysis' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 shadow-xs">
            <h3 className="text-sm font-bold text-stone-900 mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-600" />
              <span>Balance Productivo y Sanitario</span>
            </h3>

            {/* Cuadrícula de 2 Columnas estilo Captura 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 1. Huevos Totales */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-amber-50/50 border border-amber-200/60">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Egg className="w-6 h-6 fill-amber-300 text-amber-700" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Huevos Recogidos</span>
                  <strong className="text-xl font-black text-stone-900 block">
                    {totalesInforme.recogidos.toLocaleString()}
                  </strong>
                  <span className="text-[11px] text-stone-400">Total en {lotesFiltrados.length} lotes</span>
                </div>
              </div>

              {/* 2. Huevos Aptos */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-50/50 border border-emerald-200/60">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Huevos Aptos Netos</span>
                  <strong className="text-xl font-black text-emerald-900 block">
                    {totalesInforme.aptos.toLocaleString()}
                  </strong>
                  <span className="text-[11px] text-emerald-700 font-medium">{porcentajeAptitud}% aptitud comercial</span>
                </div>
              </div>

              {/* 3. Mermas y Bajas (Rotos/Sucios) */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-red-50/50 border border-red-200/60">
                <div className="w-12 h-12 rounded-full bg-red-100 text-red-800 flex items-center justify-center shrink-0">
                  <Heart className="w-6 h-6 text-red-600 fill-red-200" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Mermas y Bajas</span>
                  <strong className="text-xl font-black text-red-800 block">
                    {totalesInforme.totalMermas.toLocaleString()}
                  </strong>
                  <span className="text-[11px] text-red-600">
                    {totalesInforme.rotos} rotos · {totalesInforme.sucios} sucios · {totalesInforme.descarte} desc.
                  </span>
                </div>
              </div>

              {/* 4. Calibres Clasificados */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-amber-50/40 border border-amber-200/60">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Scale className="w-6 h-6 text-amber-700" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Calibres Clasificados</span>
                  <strong className="text-sm font-bold text-stone-900 block mt-0.5">
                    XL: {totalesInforme.xl} · L: {totalesInforme.l}
                  </strong>
                  <span className="text-[11px] text-stone-600 block">
                    M: {totalesInforme.m} · S: {totalesInforme.s}
                  </span>
                </div>
              </div>

              {/* 5. Stock en Almacén Disponible para Envasar */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-stone-50 border border-stone-200">
                <div className="w-12 h-12 rounded-full bg-stone-200 text-stone-800 flex items-center justify-center shrink-0">
                  <Droplet className="w-6 h-6 text-stone-600" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Stock Disponible</span>
                  <strong className="text-xl font-black text-stone-900 block">
                    {totalesInforme.disponibles.toLocaleString()} <span className="text-xs font-normal text-stone-500">uds</span>
                  </strong>
                  <span className="text-[11px] text-stone-500">Listo para pasar a envasadora</span>
                </div>
              </div>

              {/* 6. Naves en Producción */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-stone-50 border border-stone-200">
                <div className="w-12 h-12 rounded-full bg-stone-200 text-stone-800 flex items-center justify-center shrink-0">
                  <Wheat className="w-6 h-6 text-stone-600" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Instalaciones Explotación</span>
                  <strong className="text-xl font-black text-stone-900 block">
                    {naves.length} Naves
                  </strong>
                  <span className="text-[11px] text-stone-500">REGA: {config.registroSanitario}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === SUBTAB: EXPORT / LIBRO OFICIAL (INSPECCIÓN SANITARIA) === */}
      {subTab === 'export' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl shrink-0">
                <FileText className="w-6 h-6 text-amber-700" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">
                  Libro Oficial de Registro de Puesta Diaria y Clasificación
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Documento formal de trazabilidad ganadera según el RD 226/2008 y Reglamento (CE) 589/2008 para presentación ante los Servicios Veterinarios Oficiales e Inspecciones Sanitarias.
                </p>
              </div>
            </div>

            {/* Parámetros de Generación */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs">
              <div>
                <label className="block text-stone-600 mb-1 font-semibold">Instalación:</label>
                <select
                  value={filtroNave}
                  onChange={e => setFiltroNave(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg p-2 bg-white text-xs"
                >
                  <option value="todas">Todas las naves (completo)</option>
                  {naves.map(n => (
                    <option key={n.id} value={n.id}>{n.codigo} - {n.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-stone-600 mb-1 font-semibold">Período Auditado:</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={fechaDesde}
                    onChange={e => setFechaDesde(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg p-1.5 bg-white text-xs"
                    placeholder="Desde"
                  />
                  <input
                    type="date"
                    value={fechaHasta}
                    onChange={e => setFechaHasta(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg p-1.5 bg-white text-xs"
                    placeholder="Hasta"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setMostrarModalInforme(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Abrir e Imprimir Libro Oficial de Puesta</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. BOTÓN FLOTANTE CIRCULAR '+' (FAB ESTILO CAPTURA 3) */}
      <button
        type="button"
        onClick={() => setMostrarModalNuevoRegistro(true)}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-600 to-amber-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all cursor-pointer group"
        title="Registrar Puesta Diaria (+)"
      >
        <Plus className="w-7 h-7 stroke-[2.5] group-hover:rotate-90 transition-transform duration-200" />
      </button>

      {/* 5. MODAL LIMPIO DEL FORMULARIO CON BOTÓN '+' */}
      {mostrarModalNuevoRegistro && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto max-h-[92vh] overflow-y-auto">
            {/* Cabecera del Modal */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
                  <Egg className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">Registrar Puesta Diaria</h3>
                  <p className="text-xs text-stone-500">Introduce o dicta la recogida del día</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalNuevoRegistro(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Asistente de Voz Integrado con Micrófono e IA */}
            <AsistenteVozPuesta
              naves={naves}
              onAplicarDatos={(datos) => {
                if (datos.naveId) setNaveId(datos.naveId);
                if (datos.totalRecogida !== undefined) setTotalRecogida(datos.totalRecogida);
                if (datos.rotos !== undefined) setRotos(datos.rotos);
                if (datos.sucios !== undefined) setSucios(datos.sucios);
                if (datos.descarte !== undefined) setDescarte(datos.descarte);
                if (datos.xl !== undefined && datos.xl !== null) setXl(datos.xl);
                if (datos.l !== undefined && datos.l !== null) setL(datos.l);
                if (datos.m !== undefined && datos.m !== null) setM(datos.m);
                if (datos.s !== undefined && datos.s !== null) setS(datos.s);
                if (datos.observaciones) setObservaciones(datos.observaciones);
              }}
            />

            {/* Formulario */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Nave y Fecha */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Nave / Galpón de Puesta
                  </label>
                  <select
                    value={naveId}
                    onChange={e => setNaveId(e.target.value)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium text-stone-900"
                  >
                    {naves.map(n => (
                      <option key={n.id} value={n.id}>
                        {n.nombre} ({n.codigo}) - {n.tipoCria.split('-')[1]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha de Puesta
                  </label>
                  <input
                    type="date"
                    value={fechaPuesta}
                    onChange={e => setFechaPuesta(e.target.value)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium text-stone-900"
                  />
                </div>
              </div>

              {/* Información de Edad del Lote para este día de recogida */}
              {(() => {
                const naveSel = naves.find(n => n.id === naveId) || naves[0];
                const edadModal = calcularEdadLote(fechaPuesta, naveSel?.fechaEntrada, naveSel?.edadSemanasEntrada ?? 24);
                return (
                  <div className="p-3 bg-gradient-to-r from-amber-50 to-stone-50 border border-amber-200/80 rounded-xl flex flex-wrap items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-700 text-white flex items-center justify-center font-black text-xs shadow-xs">
                        Sem {edadModal.semanaVida}
                      </div>
                      <div>
                        <span className="font-bold text-stone-900 text-xs block">
                          Día {edadModal.diasEnNave} de estancia en la nave
                        </span>
                        <span className="text-[10px] text-stone-500">
                          Semana {edadModal.semanaVida} de vida · Semana {edadModal.semanaPuesta} en producción
                        </span>
                      </div>
                    </div>

                    <div className="text-right text-[11px] font-mono">
                      <span className="text-stone-500 block">Lote: <strong className="text-amber-950">{codigoLoteCalculado}</strong></span>
                      <span className="text-stone-500">DCP (+28d): <strong>{formatearFechaES(fechaCaducidadCalculada)}</strong></span>
                    </div>
                  </div>
                );
              })()}

              {/* Recogida Total */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-stone-800">
                    Huevos Totales Recogidos
                  </label>
                  {sumaTotalCalculada > 0 && numTotal === 0 && (
                    <button
                      type="button"
                      onClick={() => setTotalRecogida(sumaTotalCalculada)}
                      className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold underline cursor-pointer"
                    >
                      Usar suma ({sumaTotalCalculada.toLocaleString()} uds)
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={totalRecogida}
                  onChange={e => setTotalRecogida(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-base font-bold text-stone-900 rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Mermas en Recogida */}
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <span className="text-xs font-bold text-stone-800 block">Mermas en Recogida (Rotos / Sucios / Descarte)</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">Rotos</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={rotos}
                      onChange={e => setRotos(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">Sucios</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={sucios}
                      onChange={e => setSucios(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">Descarte</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={descarte}
                      onChange={e => setDescarte(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Calibres */}
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <span className="text-xs font-bold text-stone-800 block">Clasificación por Calibres (Opcional)</span>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">XL (&gt;73g)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={xl}
                      onChange={e => setXl(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">L (63-73g)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={l}
                      onChange={e => setL(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">M (53-63g)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={m}
                      onChange={e => setM(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">S (&lt;53g)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={s}
                      onChange={e => setS(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Verificación de Coherencia Matemática */}
              {errorMermasSuperanTotal && (
                <div className="p-2.5 bg-red-100 border border-red-200 rounded-xl text-xs text-red-900 flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>Las mermas ({totalMermas} uds) superan la recogida total ({numTotal} uds).</span>
                </div>
              )}

              {errorCalibresSuperanAptos && (
                <div className="p-2.5 bg-red-100 border border-red-200 rounded-xl text-xs text-red-900 flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>La suma de calibres ({sumaCalibres} uds) supera los huevos aptos ({huevosAptos} uds).</span>
                </div>
              )}

              {numTotal > 0 && !tieneErroresCoherencia && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Huevos aptos netos para envasar:</span>
                  </span>
                  <strong className="text-sm">{huevosAptos.toLocaleString()} uds</strong>
                </div>
              )}

              {/* Observaciones */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Observaciones sanitarias o de manejo (opcional)
                </label>
                <input
                  type="text"
                  value={observaciones}
                  onChange={e => setObservaciones(e.target.value)}
                  placeholder="Ej: Lote con excelente cáscara, temperatura óptima..."
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              {/* Botones de acción */}
              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalNuevoRegistro(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={tieneErroresCoherencia}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm cursor-pointer"
                >
                  Guardar Lote de Puesta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>

      {/* 6. MODAL DE INFORME IMPRIMIBLE PARA LA ADMINISTRACIÓN */}
      {mostrarModalInforme && (
        <div
          id="modal-informe-puesta-container"
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible print:block print:w-full"
        >
          <div
            id="modal-informe-puesta-card"
            className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full print:bg-white"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3 no-print">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-700" />
                <div>
                  <h3 className="font-bold text-stone-900">
                    Libro Oficial de Registro de Puesta Diaria y Clasificación
                  </h3>
                  <p className="text-xs text-stone-500">
                    Documento de Trazabilidad Ganadera para presentación a los Servicios Veterinarios
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalInforme(false)}
                className="text-stone-400 hover:text-stone-700 text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div
              id="hoja-informe-puesta"
              className="p-6 border border-stone-300 rounded-xl bg-white text-stone-900 font-sans space-y-4 print:border-none print:p-0"
            >
              <div className="flex justify-between items-start border-b-2 border-stone-900 pb-3">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amber-900 block">
                    REGISTRO GENERAL DE EXPLOTACIONES GANADERAS (REGA) • RD 226/2008 &amp; REGLAMENTO (CE) 589/2008
                  </span>
                  <h2 className="text-xl font-black text-stone-950 mt-0.5">
                    {config.nombreEmpresa}
                  </h2>
                  <p className="text-xs text-stone-600">
                    CIF: {config.cifEmpresa} • {config.direccionEmpresa}
                  </p>
                  <p className="text-xs text-stone-600">
                    RGSEAA: <strong className="font-mono">{config.registroSanitario}</strong> • Tel: {config.telefonoEmpresa} • Email: {config.emailEmpresa}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs uppercase font-black bg-stone-900 text-white px-2 py-1 rounded block">
                    LIBRO OFICIAL DE PUESTA
                  </span>
                  <span className="text-xs text-stone-600 block mt-1.5">
                    Fecha de emisión: <strong>{formatearFechaES(hoy)}</strong>
                  </span>
                  <span className="text-xs text-amber-900 font-medium block">
                    Período auditado:{' '}
                    <strong>
                      {formatearFechaES(fechaDesde) || 'Inicio registros'} hasta {formatearFechaES(fechaHasta) || 'Actualidad'}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-500 block">Filtro de Instalaciones:</span>
                  <span className="font-medium text-stone-800">
                    {filtroNave === 'todas'
                      ? 'Todas las naves de la explotación'
                      : naves.find(n => n.id === filtroNave)?.nombre || filtroNave}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-500 block">Código REGA:</span>
                  <span className="font-mono font-bold text-stone-900">
                    {filtroNave === 'todas' ? 'Multi-REGA / Completo' : naves.find(n => n.id === filtroNave)?.codigoREGA}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-500 block">Total Lotes:</span>
                  <span className="font-bold text-amber-900">{lotesFiltrados.length} lotes registrados</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b-2 border-stone-800 bg-stone-100 text-stone-800 font-bold">
                      <th className="py-2 px-1.5">Fecha</th>
                      <th className="py-2 px-1.5">Código Lote Puesta</th>
                      <th className="py-2 px-1.5">Nave / REGA</th>
                      <th className="py-2 px-1.5 text-center">D.C.P.</th>
                      <th className="py-2 px-1.5 text-right">Recogidos</th>
                      <th className="py-2 px-1.5 text-center">Calibres (XL/L/M/S)</th>
                      <th className="py-2 px-1.5 text-right">Mermas</th>
                      <th className="py-2 px-1.5 text-right font-black">Aptos Envasar</th>
                      <th className="py-2 px-1.5 text-right">Saldo Disp.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {lotesFiltrados.map((lote) => {
                      const mermasLote = lote.mermas.rotos + lote.mermas.sucios + lote.mermas.descarte;
                      return (
                        <tr key={lote.id} className="hover:bg-stone-50">
                          <td className="py-1.5 px-1.5 font-mono text-[11px] whitespace-nowrap">
                            {formatearFechaES(lote.fechaPuesta)}
                          </td>
                          <td className="py-1.5 px-1.5 font-mono font-bold text-stone-900 whitespace-nowrap">
                            {lote.codigoLote}
                          </td>
                          <td className="py-1.5 px-1.5 text-[11px]">
                            <span className="font-medium text-stone-800 block">{lote.nombreNave}</span>
                            <span className="font-mono text-[10px] text-stone-500">{lote.codigoREGA}</span>
                          </td>
                          <td className="py-1.5 px-1.5 text-center font-mono text-[11px]">
                            {formatearFechaES(lote.fechaCaducidad)}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-medium text-stone-800">
                            {lote.totalHuevosRecogidos.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-1.5 text-center text-[11px] text-stone-600 font-mono">
                            {lote.calibres.xl}/{lote.calibres.l}/{lote.calibres.m}/{lote.calibres.s}
                          </td>
                          <td className="py-1.5 px-1.5 text-right text-red-700 text-[11px]">
                            {mermasLote}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-black text-amber-950 bg-amber-50/50">
                            {lote.huevosAptos.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono text-stone-700">
                            {lote.huevosDisponibles.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-stone-800 bg-stone-100 font-bold text-stone-900">
                      <td colSpan={4} className="py-2 px-1.5 text-right uppercase">
                        TOTALES AUDITADOS:
                      </td>
                      <td className="py-2 px-1.5 text-right">
                        {totalesInforme.recogidos.toLocaleString()}
                      </td>
                      <td className="py-2 px-1.5 text-center text-[10px] font-mono">
                        {totalesInforme.xl}/{totalesInforme.l}/{totalesInforme.m}/{totalesInforme.s}
                      </td>
                      <td className="py-2 px-1.5 text-right text-red-800">
                        {totalesInforme.totalMermas.toLocaleString()}
                      </td>
                      <td className="py-2 px-1.5 text-right text-amber-950 font-black bg-amber-100">
                        {totalesInforme.aptos.toLocaleString()}
                      </td>
                      <td className="py-2 px-1.5 text-right font-mono">
                        {totalesInforme.disponibles.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-stone-300 text-xs text-stone-700">
                <div className="space-y-1 bg-stone-50 p-2.5 rounded-lg border border-stone-200">
                  <span className="font-bold text-stone-900 block text-[11px] uppercase">
                    Balance Calibres:
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>XL: <strong>{totalesInforme.xl.toLocaleString()}</strong></div>
                    <div>L: <strong>{totalesInforme.l.toLocaleString()}</strong></div>
                    <div>M: <strong>{totalesInforme.m.toLocaleString()}</strong></div>
                    <div>S: <strong>{totalesInforme.s.toLocaleString()}</strong></div>
                  </div>
                </div>

                <div className="space-y-1 bg-red-50/50 p-2.5 rounded-lg border border-red-100">
                  <span className="font-bold text-red-950 block text-[11px] uppercase">
                    Bajas y Mermas:
                  </span>
                  <div className="grid grid-cols-3 gap-1 text-[11px] text-red-900">
                    <div>Rotos: <strong>{totalesInforme.rotos}</strong></div>
                    <div>Sucios: <strong>{totalesInforme.sucios}</strong></div>
                    <div>Descarte: <strong>{totalesInforme.descarte}</strong></div>
                  </div>
                </div>
              </div>

              <div className="pt-8 grid grid-cols-2 gap-8 text-[11px] text-stone-600 border-t border-stone-200">
                <div className="border-t border-stone-400 pt-2 text-center">
                  <p className="font-bold text-stone-800">Por el Titular de la Explotación</p>
                  <p className="text-[10px] text-stone-500 mt-0.5">Firma, Sello y Declaración de Veracidad</p>
                </div>
                <div className="border-t border-stone-400 pt-2 text-center">
                  <p className="font-bold text-stone-800">Diligencia Servicios Veterinarios</p>
                  <p className="text-[10px] text-stone-500 mt-0.5">Fecha, Firma y Número de Colegiado</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 no-print">
              <button
                type="button"
                onClick={() => setMostrarModalInforme(false)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN DE LOTE (SIN WINDOW.CONFIRM) */}
      {loteParaEliminar && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">¿Eliminar lote de puesta?</h3>
                <p className="text-xs text-stone-500">Esta acción no se puede deshacer</p>
              </div>
            </div>

            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 text-xs space-y-1">
              <p className="font-bold text-stone-800">
                Lote: <span className="font-mono text-amber-900">{loteParaEliminar.codigoLote}</span>
              </p>
              <p className="text-stone-600">
                Fecha de recogida: <strong>{formatearFechaES(loteParaEliminar.fechaPuesta)}</strong>
              </p>
              <p className="text-stone-600">
                Huevos aptos registrados: <strong>{loteParaEliminar.huevosAptos.toLocaleString()} uds</strong> ({loteParaEliminar.huevosDisponibles.toLocaleString()} disponibles)
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLoteParaEliminar(null)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteLotePuesta(loteParaEliminar.id);
                  setLoteParaEliminar(null);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Confirmar Eliminación</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
