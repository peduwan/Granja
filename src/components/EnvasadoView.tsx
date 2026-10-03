import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  Plus,
  AlertCircle,
  Layers,
  CheckCircle2,
  Printer,
  Tag,
  Trash2,
  ArrowRight,
  ShieldCheck,
  Filter,
  FileText,
  X,
  ChevronRight,
  ChevronDown,
  Calendar,
  BarChart3,
  Boxes,
  Clock,
  Heart,
  QrCode,
  Zap,
  Mic,
  Sparkles,
  Home
} from 'lucide-react';
import { FormatoEnvase, LoteEnvasado, LotePuesta, ComponenteLoteEstuche, Nave, Albaran, Factura } from '../types';
import { padNumero, formatearFechaES } from '../utils/storage';
import { AsistenteVozEnvasado, DatosEnvasadoInterpretados } from './AsistenteVozEnvasado';

interface EnvasadoViewProps {
  formatos: FormatoEnvase[];
  naves?: Nave[];
  lotesPuesta: LotePuesta[];
  lotesEnvasados: LoteEnvasado[];
  albaranes?: Albaran[];
  facturas?: Factura[];
  contadorEnvasado: number;
  config?: {
    nombreEmpresa: string;
    cifEmpresa: string;
    direccionEmpresa: string;
    telefonoEmpresa: string;
    emailEmpresa: string;
    registroSanitario: string;
  };
  registroSanitario: string;
  nombreEmpresa: string;
  onAddLoteEnvasado: (lote: LoteEnvasado, consumoPorLotePuesta: Record<string, number>) => void;
  onDeleteLoteEnvasado: (id: string) => void;
}

export const EnvasadoView: React.FC<EnvasadoViewProps> = ({
  formatos,
  naves = [],
  lotesPuesta,
  lotesEnvasados,
  albaranes = [],
  facturas = [],
  contadorEnvasado,
  config,
  registroSanitario,
  nombreEmpresa,
  onAddLoteEnvasado,
  onDeleteLoteEnvasado
}) => {
  const hoy = new Date().toISOString().split('T')[0];
  const anioActual = new Date().getFullYear();

  const empresaConfig = {
    nombreEmpresa: config?.nombreEmpresa || nombreEmpresa || 'Avícola San Jerónimo S.L.',
    cifEmpresa: config?.cifEmpresa || 'B-12345678',
    direccionEmpresa: config?.direccionEmpresa || 'Polígono Ganadero El Valle, Parcela 14, 45000 Toledo',
    telefonoEmpresa: config?.telefonoEmpresa || '+34 925 123 456',
    emailEmpresa: config?.emailEmpresa || 'trazabilidad@avicolasanjeronimo.es',
    registroSanitario: config?.registroSanitario || registroSanitario || 'ES 14.05432/TO CE'
  };

  // Subpestañas superiores (RECORDS | ANALYSIS | EXPORT)
  const [subTab, setSubTab] = useState<'records' | 'analysis' | 'export'>('records');

  // Control de apertura del Modal de Nueva Orden de Envasado
  const [mostrarModalNuevoEnvasado, setMostrarModalNuevoEnvasado] = useState(false);

  // Control de elementos expandidos en el histórico
  const [lotesExpandidos, setLotesExpandidos] = useState<Record<string, boolean>>({});

  // Filtros del Histórico de Envasado
  const [filtroFormato, setFiltroFormato] = useState<string>('todos');
  const [filtroStock, setFiltroStock] = useState<'todos' | 'con_stock' | 'agotados'>('todos');
  const [fechaDesde, setFechaDesde] = useState<string>('');
  const [fechaHasta, setFechaHasta] = useState<string>('');
  const [mostrarFiltrosAvanzados, setMostrarFiltrosAvanzados] = useState(false);

  // Código correlativo sugerido
  const codigoSugerido = `ENV-${anioActual}-${padNumero(contadorEnvasado)}`;

  // Form state
  const [fechaEnvasado, setFechaEnvasado] = useState(hoy);
  const [formatoId, setFormatoId] = useState(formatos[0]?.id || '');
  const [cantidadEstuches, setCantidadEstuches] = useState<number | ''>('');
  const [notas, setNotas] = useState('');

  // Mermas durante el proceso de envasado
  const [mermasRotos, setMermasRotos] = useState<number | ''>('');
  const [mermasDescarte, setMermasDescarte] = useState<number | ''>('');
  const [motivoMerma, setMotivoMerma] = useState('');

  // Naves disponibles para selección
  const navesDisponibles = useMemo(() => {
    if (naves && naves.length > 0) return naves;
    const map = new Map<string, Nave>();
    lotesPuesta.forEach(lp => {
      if (lp.naveId && !map.has(lp.naveId)) {
        map.set(lp.naveId, {
          id: lp.naveId,
          nombre: lp.nombreNave || 'Nave',
          codigo: lp.codigoLote?.split('-')?.[0] || 'NAV',
          tipoCria: lp.tipoCria || '2-Suelo',
          codigoREGA: lp.codigoREGA || '',
          capacidadAves: 0,
          activa: true
        });
      }
    });
    return Array.from(map.values());
  }, [naves, lotesPuesta]);

  // Configuración Multilote por Estuche y Principio FIFO
  // 1. Los lotes con stock se ordenan estrictamente por fecha de puesta ascendente (los más antiguos primero - FIFO)
  // En caso de empate en fecha de puesta, se desempata por orden cronológico de registro y código de lote
  const lotesConStock = useMemo(() => {
    return [...lotesPuesta]
      .filter(l => l.huevosDisponibles > 0)
      .sort((a, b) => {
        const cmpFecha = a.fechaPuesta.localeCompare(b.fechaPuesta);
        if (cmpFecha !== 0) return cmpFecha;
        const cmpCreado = (a.creadoEn || '').localeCompare(b.creadoEn || '');
        if (cmpCreado !== 0) return cmpCreado;
        return a.codigoLote.localeCompare(b.codigoLote);
      });
  }, [lotesPuesta]);

  const primerLote = lotesConStock[0];
  const formatoSeleccionado = formatos.find(f => f.id === formatoId) || formatos[0];

  // Estado de nave seleccionada para el envasado
  const [naveSeleccionadaId, setNaveSeleccionadaId] = useState<string>('');
  // Indicador de modo FIFO automático activo (si el usuario edita a mano, pasa a false)
  const [modoFIFO, setModoFIFO] = useState<boolean>(true);

  // Nave activa efectiva
  const naveActivaId = naveSeleccionadaId || primerLote?.naveId || navesDisponibles[0]?.id || '';
  const naveActivaObj = navesDisponibles.find(n => n.id === naveActivaId);
  const nombreNaveActiva = naveActivaObj?.nombre || lotesPuesta.find(l => l.naveId === naveActivaId)?.nombreNave || 'Nave';

  // Lotes con stock de la MISMA NAVE, ordenados cronológicamente por FIFO
  const lotesMismaNaveConStock = useMemo(() => {
    if (!naveActivaId) return [];
    return lotesConStock.filter(l => l.naveId === naveActivaId);
  }, [lotesConStock, naveActivaId]);

  // Cálculo de capacidad según stock del lote para el número de estuches solicitado
  const calcularHuevosSugeridos = (
    lote: LotePuesta | undefined,
    huevosFaltantes: number,
    cantEstuches: number | ''
  ): number => {
    if (!lote || lote.huevosDisponibles <= 0 || huevosFaltantes <= 0) return 0;
    const n = typeof cantEstuches === 'number' && cantEstuches > 0 ? cantEstuches : 1;
    // Capacidad máxima de aportación por estuche según stock disponible
    const maxAportePorEstuche = Math.floor(lote.huevosDisponibles / n);
    if (maxAportePorEstuche <= 0) {
      return n === 1 ? Math.min(huevosFaltantes, lote.huevosDisponibles) : 0;
    }
    return Math.min(huevosFaltantes, maxAportePorEstuche);
  };

  // Algoritmo puro FIFO: distribuye los huevos por estuche agotando de más antiguo a más reciente
  const calcularDistribucionFIFO = (
    targetNaveId: string,
    targetFormatoId: string,
    cantEstuches: number | ''
  ): Array<{ lotePuestaId: string; huevosPorEstuche: number }> => {
    const fmt = formatos.find(f => f.id === targetFormatoId) || formatos[0];
    const capPorEstuche = fmt?.cantidadHuevos || 12;

    const lotesNave = lotesConStock.filter(l => l.naveId === targetNaveId);
    if (lotesNave.length === 0) return [];

    const n = typeof cantEstuches === 'number' && cantEstuches > 0 ? cantEstuches : 0;

    // Si aún no se ha especificado la cantidad de estuches a producir
    if (n <= 0) {
      const pLote = lotesNave[0];
      return [{
        lotePuestaId: pLote.id,
        huevosPorEstuche: Math.min(capPorEstuche, pLote.huevosDisponibles)
      }];
    }

    // Algoritmo FIFO: agotar primero el lote de puesta más antiguo
    const asignacionesCalculadas: Array<{ lotePuestaId: string; huevosPorEstuche: number }> = [];
    let faltanPorEstuche = capPorEstuche;

    for (const lote of lotesNave) {
      if (faltanPorEstuche <= 0) break;
      const maxPorEstuche = Math.floor(lote.huevosDisponibles / n);
      if (maxPorEstuche > 0) {
        const asignado = Math.min(faltanPorEstuche, maxPorEstuche);
        asignacionesCalculadas.push({
          lotePuestaId: lote.id,
          huevosPorEstuche: asignado
        });
        faltanPorEstuche -= asignado;
      }
    }

    // Si ningún lote de la nave tiene stock suficiente para aportar al menos 1 huevo por estuche (stock < n)
    if (asignacionesCalculadas.length === 0) {
      asignacionesCalculadas.push({
        lotePuestaId: lotesNave[0].id,
        huevosPorEstuche: capPorEstuche
      });
    } else if (faltanPorEstuche > 0) {
      // Si todavía faltan huevos para completar el estuche, incorporar el siguiente lote cronológico disponible
      const idsUsados = asignacionesCalculadas.map(a => a.lotePuestaId);
      const siguienteLote = lotesNave.find(l => !idsUsados.includes(l.id));
      if (siguienteLote) {
        asignacionesCalculadas.push({
          lotePuestaId: siguienteLote.id,
          huevosPorEstuche: faltanPorEstuche
        });
      }
    }

    return asignacionesCalculadas;
  };

  const huevosInicialesPrimerLote = primerLote
    ? Math.min(formatoSeleccionado?.cantidadHuevos || 12, primerLote.huevosDisponibles)
    : (formatoSeleccionado?.cantidadHuevos || 12);

  const [asignaciones, setAsignaciones] = useState<Array<{ lotePuestaId: string; huevosPorEstuche: number }>>([
    {
      lotePuestaId: primerLote?.id || '',
      huevosPorEstuche: huevosInicialesPrimerLote
    }
  ]);

  // Lote principal actual
  const lotePrincipal = lotesPuesta.find(l => l.id === asignaciones[0]?.lotePuestaId) || primerLote;

  // IDs de lotes ya asignados en este estuche
  const lotesUsadosIds = useMemo(() => {
    return asignaciones.map(a => a.lotePuestaId);
  }, [asignaciones]);

  // Lotes de la misma nave que aún no han sido seleccionados en ninguna fila
  const lotesMismaNaveDisponiblesParaAgregar = useMemo(() => {
    return lotesMismaNaveConStock.filter(l => !lotesUsadosIds.includes(l.id));
  }, [lotesMismaNaveConStock, lotesUsadosIds]);

  // Stock total de huevos disponibles en toda la nave activa
  const totalHuevosNave = useMemo(() => {
    return lotesMismaNaveConStock.reduce((acc, l) => acc + l.huevosDisponibles, 0);
  }, [lotesMismaNaveConStock]);

  const huevosEsperados = formatoSeleccionado?.cantidadHuevos || 0;

  // Cantidad máxima de estuches que puede producir la nave activa completa sin mezclar con otra nave
  const maxEstuchesPosiblesNave = useMemo(() => {
    if (!huevosEsperados || huevosEsperados <= 0) return 0;
    return Math.floor(totalHuevosNave / huevosEsperados);
  }, [totalHuevosNave, huevosEsperados]);

  // Modal para imprimir o visualizar etiqueta individual
  const [loteParaEtiqueta, setLoteParaEtiqueta] = useState<LoteEnvasado | null>(null);

  // Modal para Libro Oficial de Registro de Envasado y Marcado
  const [mostrarModalInformeEnvasado, setMostrarModalInformeEnvasado] = useState(false);

  useEffect(() => {
    if (mostrarModalInformeEnvasado || loteParaEtiqueta) {
      document.body.classList.add('has-print-modal');
    } else {
      document.body.classList.remove('has-print-modal');
    }
    return () => {
      document.body.classList.remove('has-print-modal');
    };
  }, [mostrarModalInformeEnvasado, loteParaEtiqueta]);

  const toggleExpandirLote = (id: string) => {
    setLotesExpandidos(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Apertura limpia con selección estricta del lote más antiguo (FIFO)
  const abrirNuevoEnvasado = () => {
    const fmt = formatos.find(f => f.id === formatoId) || formatos[0];
    const pLote = lotesConStock[0]; // Lote más antiguo de toda la explotación
    const targetNave = pLote?.naveId || navesDisponibles[0]?.id || '';

    setNaveSeleccionadaId(targetNave);
    setModoFIFO(true);

    const asignacionesIniciales = calcularDistribucionFIFO(targetNave, fmt?.id || '', '');
    setAsignaciones(
      asignacionesIniciales.length > 0
        ? asignacionesIniciales
        : [
            {
              lotePuestaId: pLote?.id || '',
              huevosPorEstuche: fmt?.cantidadHuevos || 12
            }
          ]
    );

    setCantidadEstuches('');
    setMermasRotos('');
    setMermasDescarte('');
    setMotivoMerma('');
    setNotas('');
    setFechaEnvasado(hoy);
    setMostrarModalNuevoEnvasado(true);
  };

  const handleCambioFormato = (nuevoFormatoId: string) => {
    setFormatoId(nuevoFormatoId);
    if (modoFIFO) {
      const nuevas = calcularDistribucionFIFO(naveActivaId, nuevoFormatoId, cantidadEstuches);
      if (nuevas.length > 0) {
        setAsignaciones(nuevas);
      }
    } else if (asignaciones.length === 1) {
      const nuevoFmt = formatos.find(f => f.id === nuevoFormatoId);
      const loteActual = lotesPuesta.find(l => l.id === asignaciones[0]?.lotePuestaId) || lotesConStock[0];
      const sugeridos = calcularHuevosSugeridos(loteActual, nuevoFmt?.cantidadHuevos || 12, cantidadEstuches);
      setAsignaciones([
        {
          lotePuestaId: asignaciones[0]?.lotePuestaId || loteActual?.id || '',
          huevosPorEstuche: sugeridos
        }
      ]);
    }
  };

  const handleCambioCantidadEstuches = (val: number | '') => {
    setCantidadEstuches(val);
    if (modoFIFO) {
      const nuevas = calcularDistribucionFIFO(naveActivaId, formatoId, val);
      if (nuevas.length > 0) {
        setAsignaciones(nuevas);
      }
    }
  };

  const handleCambioNave = (nuevaNaveId: string) => {
    setNaveSeleccionadaId(nuevaNaveId);
    const nuevas = calcularDistribucionFIFO(nuevaNaveId, formatoId, cantidadEstuches);
    if (nuevas.length > 0) {
      setAsignaciones(nuevas);
    }
  };

  // Añadir un nuevo lote asegurando que pertenezca a la MISMA NAVE y no esté repetido
  const agregarAsignacion = () => {
    setModoFIFO(false);
    const lotesUsados = asignaciones.map(a => a.lotePuestaId);
    const siguienteLote = lotesMismaNaveConStock.find(l => !lotesUsados.includes(l.id));
    if (siguienteLote) {
      const sumaActual = asignaciones.reduce((acc, a) => acc + (Number(a.huevosPorEstuche) || 0), 0);
      const faltantes = Math.max(0, huevosEsperados - sumaActual);
      const sugeridos = calcularHuevosSugeridos(siguienteLote, faltantes, cantidadEstuches);
      setAsignaciones([
        ...asignaciones,
        {
          lotePuestaId: siguienteLote.id,
          huevosPorEstuche: sugeridos
        }
      ]);
    }
  };

  const quitarAsignacion = (index: number) => {
    if (asignaciones.length <= 1) return;
    setModoFIFO(false);
    const nuevas = asignaciones.filter((_, i) => i !== index);
    if (nuevas.length === 1) {
      const loteRestante = lotesPuesta.find(l => l.id === nuevas[0].lotePuestaId);
      nuevas[0].huevosPorEstuche = calcularHuevosSugeridos(loteRestante, huevosEsperados, cantidadEstuches);
    }
    setAsignaciones(nuevas);
  };

  const actualizarAsignacion = (index: number, campo: 'lotePuestaId' | 'huevosPorEstuche', valor: any) => {
    setModoFIFO(false);
    const copia = [...asignaciones];
    if (campo === 'lotePuestaId') {
      const nuevoLote = lotesPuesta.find(l => l.id === valor);
      if (index === 0) {
        const loteAnterior = lotesPuesta.find(l => l.id === copia[0]?.lotePuestaId);
        // Si cambia la nave del lote principal, reseteamos las filas complementarias para cumplir
        // estrictamente la regla de no mezclar distintas naves en el mismo estuche
        if (nuevoLote && loteAnterior && nuevoLote.naveId !== loteAnterior.naveId) {
          setNaveSeleccionadaId(nuevoLote.naveId);
          const sugeridos = calcularHuevosSugeridos(nuevoLote, huevosEsperados, cantidadEstuches);
          setAsignaciones([
            {
              lotePuestaId: nuevoLote.id,
              huevosPorEstuche: sugeridos
            }
          ]);
          return;
        }
      }

      const asignadosOtros = copia
        .filter((_, i) => i !== index)
        .reduce((acc, a) => acc + (Number(a.huevosPorEstuche) || 0), 0);
      const faltantes = Math.max(0, huevosEsperados - asignadosOtros);
      const sugeridos = calcularHuevosSugeridos(nuevoLote, faltantes, cantidadEstuches);
      copia[index] = {
        lotePuestaId: valor,
        huevosPorEstuche: sugeridos
      };
    } else {
      copia[index] = {
        ...copia[index],
        huevosPorEstuche: Math.max(0, parseInt(valor) || 0)
      };
    }
    setAsignaciones(copia);
  };

  // Asistente Inteligente FIFO: reparte la capacidad del estuche entre los lotes de la misma nave por orden estricto de antigüedad
  const autocompletarRepartoFIFO = () => {
    setModoFIFO(true);
    const nuevas = calcularDistribucionFIFO(naveActivaId, formatoId, cantidadEstuches);
    if (nuevas.length > 0) {
      setAsignaciones(nuevas);
    }
  };

  // Aplicar datos dictados por voz (admite lote único y multilote de 2 o más lotes)
  const aplicarDatosVoz = (datos: DatosEnvasadoInterpretados) => {
    // 1. Formato comercial
    const fmt = formatos.find(f => f.id === datos.formatoId) || formatos[0];
    if (fmt) {
      setFormatoId(fmt.id);
    }
    const capEnvase = fmt?.cantidadHuevos || 12;

    // 2. Asignaciones de lotes por estuche
    if (datos.asignaciones && datos.asignaciones.length > 0) {
      setAsignaciones(
        datos.asignaciones.map(a => ({
          lotePuestaId: a.lotePuestaId,
          huevosPorEstuche: Number(a.huevosPorEstuche) || 0
        }))
      );
    }

    // 3. Cantidad de estuches o máximo posible
    if (datos.maximoPosible) {
      let maxCalculado = Infinity;
      const asignacionesValidas = (datos.asignaciones && datos.asignaciones.length > 0)
        ? datos.asignaciones
        : asignaciones;

      for (const asig of asignacionesValidas) {
        if (asig.huevosPorEstuche > 0) {
          const lote = lotesPuesta.find(l => l.id === asig.lotePuestaId);
          const disp = lote?.huevosDisponibles || 0;
          const maxDeEsteLote = Math.floor(disp / asig.huevosPorEstuche);
          if (maxDeEsteLote < maxCalculado) {
            maxCalculado = maxDeEsteLote;
          }
        }
      }
      setCantidadEstuches(maxCalculado > 0 && maxCalculado !== Infinity ? maxCalculado : 1);
    } else if (typeof datos.cantidadEstuches === 'number' && datos.cantidadEstuches > 0) {
      setCantidadEstuches(datos.cantidadEstuches);
    }

    // 4. Mermas de envasado
    if (datos.mermasRotos !== undefined) {
      setMermasRotos(datos.mermasRotos === 0 ? '' : datos.mermasRotos);
    }
    if (datos.mermasDescarte !== undefined) {
      setMermasDescarte(datos.mermasDescarte === 0 ? '' : datos.mermasDescarte);
    }
    if (datos.motivoMerma) {
      setMotivoMerma(datos.motivoMerma);
    }
    if (datos.notas) {
      setNotas(datos.notas);
    }
  };

  // Cálculos dinámicos
  const numEstuches = Number(cantidadEstuches) || 0;
  const sumaHuevosPorEstuche = asignaciones.reduce((acc, a) => acc + (Number(a.huevosPorEstuche) || 0), 0);
  const cuadreEstuche = sumaHuevosPorEstuche === huevosEsperados;

  // Cálculo de cuántos estuches completos se pueden producir como máximo con la combinación actual
  const maxEstuchesPosible = (() => {
    const asignacionesValidas = asignaciones.filter(a => a.huevosPorEstuche > 0 && a.lotePuestaId);
    if (asignacionesValidas.length === 0) return 0;
    const maximos = asignacionesValidas.map(a => {
      const lp = lotesPuesta.find(l => l.id === a.lotePuestaId);
      if (!lp || lp.huevosDisponibles <= 0) return 0;
      return Math.floor(lp.huevosDisponibles / a.huevosPorEstuche);
    });
    return Math.min(...maximos);
  })();

  // Comprobar stock de cada lote de puesta
  const consumoPorLotePuesta: Record<string, number> = {};
  asignaciones.forEach(a => {
    if (a.lotePuestaId && a.huevosPorEstuche > 0) {
      consumoPorLotePuesta[a.lotePuestaId] = (consumoPorLotePuesta[a.lotePuestaId] || 0) + (a.huevosPorEstuche * numEstuches);
    }
  });

  const stockInsuficienteInfo = Object.entries(consumoPorLotePuesta).map(([loteId, necesario]) => {
    const lote = lotesPuesta.find(l => l.id === loteId);
    const disponible = lote?.huevosDisponibles || 0;
    return {
      lote,
      necesario,
      disponible,
      falta: necesario > disponible ? necesario - disponible : 0
    };
  }).filter(item => item.falta > 0);

  const stockSuficiente = stockInsuficienteInfo.length === 0;

  // Determinar DCP oficial (basada en el lote de puesta más antiguo)
  const lotesUtilizados = asignaciones
    .map(a => lotesPuesta.find(l => l.id === a.lotePuestaId))
    .filter((l): l is LotePuesta => !!l && (asignaciones.find(a => a.lotePuestaId === l.id)?.huevosPorEstuche || 0) > 0);

  const loteMasAntiguo = lotesUtilizados.length > 0
    ? [...lotesUtilizados].sort((a, b) => a.fechaCaducidad.localeCompare(b.fechaCaducidad))[0]
    : null;

  const dcpCalculada = loteMasAntiguo ? loteMasAntiguo.fechaCaducidad : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formatoSeleccionado) {
      alert('Selecciona un formato válido.');
      return;
    }
    if (numEstuches <= 0) {
      alert('Debes indicar una cantidad de estuches superior a 0.');
      return;
    }
    if (!cuadreEstuche) {
      alert(`La suma de huevos asignados (${sumaHuevosPorEstuche}) no coincide con los que lleva el envase (${huevosEsperados}).`);
      return;
    }
    if (!stockSuficiente) {
      alert('No hay suficiente stock en los lotes de puesta seleccionados para completar esta orden de envasado.');
      return;
    }

    // 1. Validar que no se haya duplicado el mismo lote en distintas filas
    const lotesConAporte = asignaciones.filter(a => a.huevosPorEstuche > 0);
    const idsLotes = lotesConAporte.map(a => a.lotePuestaId);
    if (new Set(idsLotes).size !== idsLotes.length) {
      alert('Error en la composición: No puedes seleccionar el mismo lote de puesta más de una vez en el mismo estuche.');
      return;
    }

    // 2. Validar que todos los lotes pertenezcan a la MISMA NAVE (Regla Sanitaria Estricta)
    const navesInvolucradas = Array.from(
      new Set(
        lotesConAporte
          .map(a => lotesPuesta.find(l => l.id === a.lotePuestaId)?.naveId)
          .filter(Boolean)
      )
    );
    if (navesInvolucradas.length > 1) {
      alert('Regla Sanitaria Estricta: En un estuche NO se permite mezclar huevos de distintas naves.');
      return;
    }

    const componentesLotes: ComponenteLoteEstuche[] = asignaciones
      .filter(a => a.huevosPorEstuche > 0)
      .map(a => {
        const lp = lotesPuesta.find(l => l.id === a.lotePuestaId)!;
        return {
          lotePuestaId: lp.id,
          codigoLotePuesta: lp.codigoLote,
          nombreNave: lp.nombreNave,
          fechaPuesta: lp.fechaPuesta,
          fechaCaducidad: lp.fechaCaducidad,
          huevosPorEstuche: a.huevosPorEstuche,
          totalHuevosConsumidos: a.huevosPorEstuche * numEstuches
        };
      });

    const mermasTotales = (Number(mermasRotos) || 0) + (Number(mermasDescarte) || 0);

    const nuevoLoteEnvasado: LoteEnvasado = {
      id: 'le-' + Date.now(),
      codigoLoteEnvasado: codigoSugerido,
      formatoId: formatoSeleccionado.id,
      nombreFormato: formatoSeleccionado.nombre,
      huevosPorEstuche: formatoSeleccionado.cantidadHuevos,
      fechaEnvasado,
      fechaConsumoPreferente: dcpCalculada,
      cantidadEstuchesProducidos: numEstuches,
      estuchesDisponibles: numEstuches,
      esMultilote: componentesLotes.length > 1,
      componentesLotes,
      mermasEnvasado: {
        rotosManipulacion: Number(mermasRotos) || 0,
        descartePeso: Number(mermasDescarte) || 0,
        motivo: motivoMerma.trim() || undefined
      },
      totalHuevosConsumidos: (numEstuches * formatoSeleccionado.cantidadHuevos) + mermasTotales,
      estado: 'en_stock',
      notas: notas.trim() || undefined,
      creadoEn: new Date().toISOString()
    };

    onAddLoteEnvasado(nuevoLoteEnvasado, consumoPorLotePuesta);
    setCantidadEstuches('');
    setMermasRotos('');
    setMermasDescarte('');
    setMotivoMerma('');
    setNotas('');
    setMostrarModalNuevoEnvasado(false);
  };

  // Filtrado de lotes envasados con rango de fechas
  const lotesEnvasadosFiltrados = lotesEnvasados.filter(lote => {
    if (filtroFormato !== 'todos' && lote.formatoId !== filtroFormato) return false;
    if (filtroStock === 'con_stock' && lote.estuchesDisponibles <= 0) return false;
    if (filtroStock === 'agotados' && lote.estuchesDisponibles > 0) return false;
    if (fechaDesde && lote.fechaEnvasado < fechaDesde) return false;
    if (fechaHasta && lote.fechaEnvasado > fechaHasta) return false;
    return true;
  });

  // Totales agregados para análisis e informes
  const totalesInforme = lotesEnvasadosFiltrados.reduce((acc, l) => {
    acc.estuchesProducidos += l.cantidadEstuchesProducidos;
    acc.estuchesDisponibles += l.estuchesDisponibles;
    acc.huevosTotalesEnvasados += (l.cantidadEstuchesProducidos * l.huevosPorEstuche);
    acc.mermasRotos += (l.mermasEnvasado?.rotosManipulacion || 0);
    acc.mermasDescarte += (l.mermasEnvasado?.descartePeso || 0);
    acc.totalMermas += ((l.mermasEnvasado?.rotosManipulacion || 0) + (l.mermasEnvasado?.descartePeso || 0));
    return acc;
  }, {
    estuchesProducidos: 0,
    estuchesDisponibles: 0,
    huevosTotalesEnvasados: 0,
    mermasRotos: 0,
    mermasDescarte: 0,
    totalMermas: 0
  });

  const formatoFiltroActivo = formatos.find(f => f.id === filtroFormato);

  return (
    <>
      <div className={`space-y-4 max-w-4xl mx-auto pb-20 ${mostrarModalInformeEnvasado || loteParaEtiqueta ? 'print:hidden' : ''}`}>
        {/* 1. HERO CARD SUPERIOR ESTILO LIMPIO */}
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {formatoFiltroActivo ? formatoFiltroActivo.nombre : 'Lotes Envasados y Multilote'}
            </h2>
            <p className="text-amber-100 text-xs sm:text-sm font-medium flex items-center gap-2">
              <span>{formatoFiltroActivo ? `${formatoFiltroActivo.tipoEnvase} · ${formatoFiltroActivo.cantidadHuevos} uds/est.` : 'Centro de Embalaje Autorizado'}</span>
              <span>•</span>
              <span>{lotesEnvasadosFiltrados.length} Partidas Registradas</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={abrirNuevoEnvasado}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-700/70 hover:bg-amber-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all cursor-pointer border border-amber-400/40 hover:scale-[1.02]"
              title="Abrir formulario y dictar envasado por voz"
            >
              <Mic className="w-4 h-4 text-amber-200" />
              <span>Dictar por Voz</span>
            </button>

            <button
              type="button"
              onClick={abrirNuevoEnvasado}
              className="flex items-center gap-1.5 px-4 py-2 bg-white text-amber-800 hover:bg-amber-50 font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
            >
              <Plus className="w-4 h-4 text-amber-600" />
              <span>Nuevo Envasado</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-amber-400/40 text-xs text-white">
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Estuches Producidos</span>
            <strong className="text-sm sm:text-base font-bold">{totalesInforme.estuchesProducidos.toLocaleString()}</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Huevos Consumidos</span>
            <strong className="text-sm sm:text-base font-bold text-white">{totalesInforme.huevosTotalesEnvasados.toLocaleString()}</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Estuches Disponibles</span>
            <strong className="text-sm sm:text-base font-bold text-amber-100">{totalesInforme.estuchesDisponibles.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      {/* 2. BARRA DE SUB-PESTAÑAS */}
      <div className="flex border-b border-stone-200 justify-around text-xs sm:text-sm font-bold tracking-wider text-stone-500">
        <button
          type="button"
          onClick={() => setSubTab('records')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'records' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Registros de Envasado</span>
          {subTab === 'records' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('analysis')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'analysis' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Métricas y Mermas</span>
          {subTab === 'analysis' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('export')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'export' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Libro de Embalaje</span>
          {subTab === 'export' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>
      </div>

      {/* 3. CONTENIDO SEGÚN LA SUB-PESTAÑA */}

      {/* === SUBTAB: REGISTROS (HISTÓRICO DE ENVASADO) === */}
      {subTab === 'records' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
              <Boxes className="w-3.5 h-3.5 text-amber-600" />
              <span>Partidas Envasadas ({lotesEnvasadosFiltrados.length})</span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filtroFormato}
                onChange={e => setFiltroFormato(e.target.value)}
                className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="todos">Todos los Formatos</option>
                {formatos.map(f => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setMostrarFiltrosAvanzados(!mostrarFiltrosAvanzados)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1 font-medium transition-colors ${
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
                <label className="block text-stone-500 mb-1 font-medium">Disponibilidad en Almacén:</label>
                <select
                  value={filtroStock}
                  onChange={e => setFiltroStock(e.target.value as any)}
                  className="w-full border border-stone-200 rounded-lg p-1.5 bg-stone-50 text-xs"
                >
                  <option value="todos">Todos los Estados</option>
                  <option value="con_stock">Con Estuches en Stock</option>
                  <option value="agotados">Agotados (0 estuches)</option>
                </select>
              </div>
            </div>
          )}

          {lotesEnvasadosFiltrados.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
                <Package className="w-6 h-6" />
              </div>
              <h3 className="text-stone-800 font-bold text-sm">No hay lotes envasados registrados</h3>
              <p className="text-stone-500 text-xs max-w-sm mx-auto">
                No hay órdenes de envasado para los filtros seleccionados. Pulsa el botón <strong className="text-amber-700 font-semibold">+</strong> para crear una nueva orden.
              </p>
              <button
                type="button"
                onClick={() => setMostrarModalNuevoEnvasado(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Primera Orden de Envasado</span>
              </button>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
              {lotesEnvasadosFiltrados.map((lote) => {
                const estaExpandido = Boolean(lotesExpandidos[lote.id]);
                const porcentajeDisponible = lote.cantidadEstuchesProducidos > 0
                  ? Math.round((lote.estuchesDisponibles / lote.cantidadEstuchesProducidos) * 100)
                  : 0;

                // Validación de trazabilidad e integridad: Comprobar si tiene albaranes o facturas vinculadas
                const tieneAlbaran = (albaranes || []).some(alb =>
                  alb.lineas.some(l => l.loteEnvasadoId === lote.id || l.codigoLoteEnvasado === lote.codigoLoteEnvasado)
                );
                const tieneFactura = (facturas || []).some(fac =>
                  fac.lineas.some(l => l.loteEnvasadoId === lote.id || l.codigoLoteEnvasado === lote.codigoLoteEnvasado)
                );
                const tieneSalidas = lote.estuchesDisponibles < lote.cantidadEstuchesProducidos;
                const tieneExpedicionBloqueante = tieneAlbaran || tieneFactura || tieneSalidas;
                const estuchesExpedidos = lote.cantidadEstuchesProducidos - lote.estuchesDisponibles;

                return (
                  <div key={lote.id} className="transition-colors hover:bg-amber-50/30">
                    <div
                      onClick={() => toggleExpandirLote(lote.id)}
                      className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-amber-100/90 border border-amber-200 text-amber-800 flex items-center justify-center shrink-0 shadow-xs">
                          <Package className="w-5 h-5 text-amber-700" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-stone-900 text-sm tracking-tight">
                              {lote.codigoLoteEnvasado}
                            </span>
                            <span className="text-[10px] font-semibold bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                              {lote.nombreFormato}
                            </span>
                            {lote.esMultilote && (
                              <span className="text-[9px] font-bold bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded-full">
                                MULTILOTE
                              </span>
                            )}
                            {tieneExpedicionBloqueante && (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1" title="Lote con albaranes o facturas emitidas">
                                <ShieldCheck className="w-3 h-3 text-amber-700" />
                                <span>Con Expedición</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                            <Calendar className="w-3 h-3 text-stone-400" />
                            <span>Envasado: {formatearFechaES(lote.fechaEnvasado)}</span>
                            <span>•</span>
                            <span className="text-red-700 font-medium">DCP: {formatearFechaES(lote.fechaConsumoPreferente)}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-right shrink-0">
                        <div>
                          <span className="text-sm font-black text-stone-900 block">
                            {lote.cantidadEstuchesProducidos.toLocaleString()} <span className="text-xs font-normal text-stone-500">est.</span>
                          </span>
                          <span className={`text-[11px] font-semibold block ${lote.estuchesDisponibles > 0 ? 'text-emerald-700' : 'text-stone-400'}`}>
                            {lote.estuchesDisponibles.toLocaleString()} disp.
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
                              Stock en cámara: <strong>{lote.estuchesDisponibles.toLocaleString()}</strong> de {lote.cantidadEstuchesProducidos.toLocaleString()} estuches listos
                              {estuchesExpedidos > 0 && (
                                <span className="text-amber-800 font-normal ml-1">
                                  ({estuchesExpedidos.toLocaleString()} expedidos en albaranes/ventas)
                                </span>
                              )}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              porcentajeDisponible > 30 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {porcentajeDisponible}% restante
                            </span>
                          </div>
                          <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                porcentajeDisponible > 30 ? 'bg-amber-500' : 'bg-orange-500'
                              }`}
                              style={{ width: `${porcentajeDisponible}%` }}
                            />
                          </div>
                        </div>

                        {/* Componentes de Puesta Multilote por Estuche */}
                        <div className="bg-white p-3 rounded-xl border border-stone-200 space-y-2">
                          <span className="text-[10px] uppercase font-bold text-stone-500 block">
                            Orígenes de Puesta (Trazabilidad por Estuche):
                          </span>
                          <div className="space-y-1">
                            {lote.componentesLotes.map((comp, idx) => (
                              <div key={idx} className="flex justify-between items-center text-xs p-1.5 bg-stone-50 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-stone-900">{comp.codigoLotePuesta}</span>
                                  <span className="text-stone-500">({comp.nombreNave})</span>
                                </div>
                                <div className="text-right">
                                  <strong className="text-amber-900">{comp.huevosPorEstuche} huevos/est.</strong>
                                  <span className="text-[10px] text-stone-400 ml-2 font-mono">({comp.totalHuevosConsumidos.toLocaleString()} uds totales)</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Mermas en envasado si existen */}
                        {((lote.mermasEnvasado?.rotosManipulacion || 0) + (lote.mermasEnvasado?.descartePeso || 0) > 0) && (
                          <div className="bg-red-50/60 p-2.5 rounded-xl border border-red-200 text-red-900 text-xs flex items-center justify-between">
                            <span className="font-semibold">Mermas en manipulador/línea:</span>
                            <span>
                              {lote.mermasEnvasado?.rotosManipulacion || 0} rotos · {lote.mermasEnvasado?.descartePeso || 0} descarte
                              {lote.mermasEnvasado?.motivo && ` (${lote.mermasEnvasado.motivo})`}
                            </span>
                          </div>
                        )}

                        {lote.notas && (
                          <div className="bg-white p-2 rounded-lg border border-stone-200 text-stone-600 text-xs italic">
                            «{lote.notas}»
                          </div>
                        )}

                        <div className="flex justify-end items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLoteParaEtiqueta(lote);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                          >
                            <Tag className="w-3.5 h-3.5 text-amber-700" />
                            <span>Imprimir Etiqueta / QR</span>
                          </button>

                          {tieneExpedicionBloqueante ? (
                            <div
                              className="inline-flex items-center gap-1.5 text-xs text-stone-500 bg-stone-100 border border-stone-200/90 px-3 py-1.5 rounded-lg select-none"
                              title="No se puede eliminar: Esta orden de envasado ya ha generado albaranes o facturas, o tiene estuches expedidos. Por exigencias de trazabilidad sanitaria e inmutabilidad legal, el registro no puede eliminarse."
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                              <span>Expedido ({estuchesExpedidos} est.) · Registro inmutable</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`¿Eliminar la orden de envasado ${lote.codigoLoteEnvasado}? Los huevos consumidos se reintegrarán al stock de puesta.`)) {
                                  onDeleteLoteEnvasado(lote.id);
                                }
                              }}
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-50 cursor-pointer"
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
      )}

      {/* === SUBTAB: ANÁLISIS DE LÍNEA DE ENVASADO === */}
      {subTab === 'analysis' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 shadow-xs">
            <h3 className="text-sm font-bold text-stone-900 mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-600" />
              <span>Eficiencia del Centro de Embalaje</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-amber-50/50 border border-amber-200/60">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-amber-700" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Estuches Producidos</span>
                  <strong className="text-xl font-black text-stone-900 block">
                    {totalesInforme.estuchesProducidos.toLocaleString()}
                  </strong>
                  <span className="text-[11px] text-stone-400">Total en {lotesEnvasadosFiltrados.length} órdenes</span>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-50/50 border border-emerald-200/60">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Huevos Envasados</span>
                  <strong className="text-xl font-black text-emerald-900 block">
                    {totalesInforme.huevosTotalesEnvasados.toLocaleString()} uds
                  </strong>
                  <span className="text-[11px] text-emerald-700 font-medium">Consumidos de los lotes de puesta</span>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-stone-50 border border-stone-200">
                <div className="w-12 h-12 rounded-full bg-stone-200 text-stone-800 flex items-center justify-center shrink-0">
                  <Boxes className="w-6 h-6 text-stone-600" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Stock en Cámara</span>
                  <strong className="text-xl font-black text-stone-900 block">
                    {totalesInforme.estuchesDisponibles.toLocaleString()} est.
                  </strong>
                  <span className="text-[11px] text-stone-500">Listos para expedición / albarán</span>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-red-50/50 border border-red-200/60">
                <div className="w-12 h-12 rounded-full bg-red-100 text-red-800 flex items-center justify-center shrink-0">
                  <Heart className="w-6 h-6 text-red-600 fill-red-200" />
                </div>
                <div>
                  <span className="text-xs text-stone-500 font-semibold block uppercase">Mermas de Envasado</span>
                  <strong className="text-xl font-black text-red-800 block">
                    {totalesInforme.totalMermas.toLocaleString()} uds
                  </strong>
                  <span className="text-[11px] text-red-600">
                    {totalesInforme.mermasRotos} rotos manipulado · {totalesInforme.mermasDescarte} descarte
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === SUBTAB: LIBRO OFICIAL (CENTRO DE EMBALAJE) === */}
      {subTab === 'export' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl shrink-0">
                <FileText className="w-6 h-6 text-amber-700" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">
                  Libro Oficial de Registro de Envasado, Marcado y Trazabilidad
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Documento formal de salidas y trazabilidad de centro de embalaje conforme al Reglamento (CE) 589/2008 y RD 226/2008 para inspección sanitaria.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs">
              <div>
                <label className="block text-stone-600 mb-1 font-semibold">Formato:</label>
                <select
                  value={filtroFormato}
                  onChange={e => setFiltroFormato(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg p-2 bg-white text-xs"
                >
                  <option value="todos">Todos los formatos comercializados</option>
                  {formatos.map(f => (
                    <option key={f.id} value={f.id}>{f.nombre}</option>
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
                onClick={() => setMostrarModalInformeEnvasado(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Abrir e Imprimir Libro Oficial de Envasado</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. BOTÓN FLOTANTE CIRCULAR '+' (FAB) */}
      <button
        type="button"
        onClick={abrirNuevoEnvasado}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-600 to-amber-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all cursor-pointer group"
        title="Crear Nueva Orden de Envasado (+)"
      >
        <Plus className="w-7 h-7 stroke-[2.5] group-hover:rotate-90 transition-transform duration-200" />
      </button>

      {/* 5. MODAL LIMPIO DE NUEVA ORDEN DE ENVASADO */}
      {mostrarModalNuevoEnvasado && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">Nueva Orden de Envasado</h3>
                  <p className="text-xs text-stone-500">Asigna lotes de origen y produce estuches</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalNuevoEnvasado(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Asistente de Voz Inteligente para Envasado (Multilote, Mermas y Formatos) */}
            <AsistenteVozEnvasado
              lotesPuesta={lotesPuesta}
              formatos={formatos}
              onAplicarDatos={aplicarDatosVoz}
            />

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Nave de Origen con trazabilidad */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-stone-800">
                    Nave de Puesta (Origen y Trazabilidad Sanitaria)
                  </label>
                  <span className="text-[11px] text-stone-500">
                    Regla Sanitaria: Un estuche no mezcla naves
                  </span>
                </div>
                <select
                  value={naveActivaId}
                  onChange={e => handleCambioNave(e.target.value)}
                  className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                >
                  {navesDisponibles.map(n => {
                    const stockTotalNave = lotesConStock.filter(l => l.naveId === n.id).reduce((acc, l) => acc + l.huevosDisponibles, 0);
                    const lotesNaveCount = lotesConStock.filter(l => l.naveId === n.id).length;
                    return (
                      <option key={n.id} value={n.id}>
                        {n.nombre} ({n.codigo}) — {stockTotalNave.toLocaleString()} huevos disp. ({lotesNaveCount} {lotesNaveCount === 1 ? 'lote' : 'lotes'})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Banner de Estado FIFO */}
              <div className="p-3 bg-amber-50/80 border border-amber-200/90 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="text-xs font-bold text-amber-950">
                      Criterio FIFO: {modoFIFO ? 'Automático Activo (Primero en Entrar, Primero en Salir)' : 'Personalizado Manual'}
                    </span>
                  </div>
                  {!modoFIFO ? (
                    <button
                      type="button"
                      onClick={autocompletarRepartoFIFO}
                      className="text-[11px] font-bold text-amber-900 bg-amber-200 hover:bg-amber-300 px-2.5 py-1 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 shadow-xs"
                    >
                      <Sparkles className="w-3 h-3 text-amber-800" />
                      <span>Reaplicar FIFO</span>
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold bg-amber-200/90 text-amber-900 px-2 py-0.5 rounded-full">
                      Puesta más antigua primero
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-amber-900 leading-snug">
                  Se consumen de forma prioritaria los lotes de recogida más antiguos de <strong>{nombreNaveActiva}</strong>. La caducidad DCP (+28 días) se vincula legalmente a la puesta más antigua utilizada.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Formato Comercial
                  </label>
                  <select
                    value={formatoId}
                    onChange={e => handleCambioFormato(e.target.value)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                  >
                    {formatos.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.nombre} ({f.cantidadHuevos} huevos - {f.calibreRecomendado})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha de Envasado
                  </label>
                  <input
                    type="date"
                    value={fechaEnvasado}
                    onChange={e => setFechaEnvasado(e.target.value)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                  />
                </div>
              </div>

              {/* Lote generado y DCP */}
              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="text-amber-800 font-medium block">Código de Lote Envasado:</span>
                  <span className="font-mono font-bold text-amber-950 text-sm">{codigoSugerido}</span>
                </div>
                <div className="text-right">
                  <span className="text-stone-500 block">DCP asignada (+28d lote más antiguo):</span>
                  <span className="font-mono font-bold text-red-700 text-sm">{dcpCalculada || 'Sin lote origen'}</span>
                </div>
              </div>

              {/* Cantidad de Estuches */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-stone-800">
                    Cantidad de Estuches a Producir
                  </label>
                  {maxEstuchesPosible > 0 && (
                    <button
                      type="button"
                      onClick={() => handleCambioCantidadEstuches(maxEstuchesPosible)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                      title="Rellenar automáticamente con el número máximo de estuches que permite el stock"
                    >
                      <Zap className="w-3 h-3 text-amber-600" />
                      <span>Producir máx. ({maxEstuchesPosible} estuches)</span>
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  min="1"
                  placeholder="Ej: 100"
                  value={cantidadEstuches}
                  onChange={e => handleCambioCantidadEstuches(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-base font-bold text-stone-900 rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Multilote por Estuche y Principio FIFO */}
              <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
                {/* Encabezado con Nave Activa y Regla de No Mezcla */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-stone-200/80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-stone-900 block">Composición de Huevos por Estuche</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        Misma Nave: {nombreNaveActiva}
                      </span>
                    </div>
                    <span className="text-[11px] text-stone-500">
                      Capacidad: <strong>{huevosEsperados} huevos</strong> · Criterio: <strong className="text-amber-800">FIFO ({modoFIFO ? 'Auto' : 'Manual'})</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Botón Asistente Reparto FIFO si hay más de 1 lote en la nave y estuches indicados */}
                    {lotesMismaNaveConStock.length > 1 && numEstuches > 0 && (
                      <button
                        type="button"
                        onClick={autocompletarRepartoFIFO}
                        className="text-[11px] font-bold text-amber-900 hover:text-amber-950 bg-amber-200/80 hover:bg-amber-300 px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                        title="Calcular distribución óptima FIFO con los lotes de esta misma nave"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-800" />
                        <span>Reparto FIFO Auto</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={lotesMismaNaveDisponiblesParaAgregar.length === 0}
                      onClick={agregarAsignacion}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                        lotesMismaNaveDisponiblesParaAgregar.length > 0
                          ? 'text-amber-800 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 cursor-pointer'
                          : 'text-stone-400 bg-stone-200/60 cursor-not-allowed'
                      }`}
                      title={
                        lotesMismaNaveDisponiblesParaAgregar.length > 0
                          ? `Añadir otro lote de ${nombreNaveActiva}`
                          : `No hay más lotes con stock disponibles en ${nombreNaveActiva}`
                      }
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Añadir Lote de {nombreNaveActiva}</span>
                    </button>
                  </div>
                </div>

                {/* Aviso si el pedido total de estuches supera el stock de toda la nave */}
                {numEstuches > 0 && totalHuevosNave < (numEstuches * huevosEsperados) && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>
                        La <strong>{nombreNaveActiva}</strong> dispone de <strong>{totalHuevosNave.toLocaleString()} huevos</strong> en total ({lotesMismaNaveConStock.length} {lotesMismaNaveConStock.length === 1 ? 'lote' : 'lotes'}). Para {numEstuches} estuches necesitas {(numEstuches * huevosEsperados).toLocaleString()}.
                        Al <strong>no mezclar con otras naves</strong>, el máximo posible son <strong>{maxEstuchesPosiblesNave} estuches</strong>.
                      </span>
                    </div>
                    {maxEstuchesPosiblesNave > 0 && (
                      <button
                        type="button"
                        onClick={() => handleCambioCantidadEstuches(maxEstuchesPosiblesNave)}
                        className="shrink-0 text-[11px] font-bold bg-amber-700 hover:bg-amber-800 text-white px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                      >
                        Ajustar a {maxEstuchesPosiblesNave} estuches
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-2.5">
                  {asignaciones.map((asig, index) => {
                    const lote = lotesPuesta.find(l => l.id === asig.lotePuestaId);
                    const disp = lote?.huevosDisponibles || 0;
                    const consumoFila = asig.huevosPorEstuche * numEstuches;
                    const sobrepasaStock = numEstuches > 0 && consumoFila > disp;
                    const esLoteDCP = loteMasAntiguo?.id === lote?.id && lotesUtilizados.length > 1;

                    // Opciones de lotes de la MISMA NAVE (ordenados cronológicamente por FIFO)
                    const opcionesLotes = lotesMismaNaveConStock.filter(
                      l => l.id === asig.lotePuestaId || !asignaciones.some((a, i) => i !== index && a.lotePuestaId === l.id)
                    );

                    return (
                      <div key={index} className="bg-white p-3 rounded-xl border border-stone-200 text-xs space-y-2">
                        <div className="grid grid-cols-12 gap-2.5 items-center">
                          <div className="col-span-7">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] font-semibold text-stone-600">
                                {index === 0 ? 'Lote Principal (FIFO):' : `Lote Complementario (${nombreNaveActiva}):`}
                              </label>
                              {esLoteDCP && (
                                <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-1.5 py-0.5 rounded" title="Este lote determina la fecha de consumo preferente (+28 días)">
                                  📅 Marca DCP
                                </span>
                              )}
                            </div>
                            <select
                              value={asig.lotePuestaId}
                              onChange={e => actualizarAsignacion(index, 'lotePuestaId', e.target.value)}
                              className={`w-full text-xs rounded-lg border p-2 font-medium text-stone-800 focus:ring-1 focus:ring-amber-500 ${
                                index === 0
                                  ? 'border-stone-300 bg-white'
                                  : 'border-amber-300 bg-amber-50/40'
                              }`}
                            >
                              {opcionesLotes.map(l => (
                                <option key={l.id} value={l.id}>
                                  {l.codigoLote} - {l.nombreNave} (Puesta: {formatearFechaES(l.fechaPuesta)} · {l.huevosDisponibles.toLocaleString()} disp.)
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center justify-between mt-1 text-[11px] text-stone-500">
                              <span>Stock disponible: <strong className={disp < huevosEsperados ? 'text-amber-700' : 'text-stone-700'}>{disp.toLocaleString()}</strong> huevos</span>
                              {numEstuches > 0 && (
                                <span>Consumo: <strong className={sobrepasaStock ? 'text-red-700' : 'text-stone-700'}>{consumoFila.toLocaleString()}</strong> uds.</span>
                              )}
                            </div>
                          </div>

                          <div className="col-span-4">
                            <label className="text-[10px] font-semibold text-stone-600 block mb-1">
                              Huevos / Estuche:
                            </label>
                            <input
                              type="number"
                              min="0"
                              max={huevosEsperados}
                              value={asig.huevosPorEstuche}
                              onChange={e => actualizarAsignacion(index, 'huevosPorEstuche', e.target.value)}
                              className="w-full text-sm font-bold text-stone-900 rounded-lg border border-stone-300 p-2 focus:ring-1 focus:ring-amber-500"
                            />
                            {disp < huevosEsperados && (
                              <span className="text-[10px] text-amber-800 block mt-0.5 font-medium">
                                Stock limitado en lote ({disp} disp.)
                              </span>
                            )}
                          </div>

                          <div className="col-span-1 text-center pt-2">
                            {asignaciones.length > 1 && (
                              <button
                                type="button"
                                onClick={() => quitarAsignacion(index)}
                                className="text-stone-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                title="Eliminar este lote de la composición"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {sobrepasaStock && (
                          <div className="flex items-center justify-between p-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-900">
                            <span className="flex items-center gap-1 font-semibold">
                              <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                              Faltan {(consumoFila - disp).toLocaleString()} huevos en este lote para {numEstuches} estuches.
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => actualizarAsignacion(index, 'huevosPorEstuche', Math.floor(disp / numEstuches))}
                                className="text-[10px] font-bold bg-white text-red-700 border border-red-300 px-2 py-0.5 rounded hover:bg-red-100 transition-colors cursor-pointer"
                              >
                                Ajustar a {Math.floor(disp / numEstuches)}/estuche
                              </button>
                              {lotesMismaNaveDisponiblesParaAgregar.length > 0 && (
                                <button
                                  type="button"
                                  onClick={autocompletarRepartoFIFO}
                                  className="text-[10px] font-bold bg-amber-600 hover:bg-amber-700 text-white px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  <span>Reparto FIFO</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {!cuadreEstuche && (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2 font-medium">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                      {sumaHuevosPorEstuche < huevosEsperados ? (
                        <span>
                          Faltan <strong>{huevosEsperados - sumaHuevosPorEstuche} huevos</strong> para completar los {huevosEsperados} del estuche (llevas {sumaHuevosPorEstuche}).
                        </span>
                      ) : (
                        <span>
                          La suma asignada ({sumaHuevosPorEstuche}) supera la capacidad de {huevosEsperados} huevos del estuche.
                        </span>
                      )}
                    </div>
                    {sumaHuevosPorEstuche < huevosEsperados && lotesMismaNaveDisponiblesParaAgregar.length > 0 && (
                      <button
                        type="button"
                        onClick={agregarAsignacion}
                        className="shrink-0 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Añadir lote de {nombreNaveActiva}</span>
                      </button>
                    )}
                  </div>
                )}

                {!stockSuficiente && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>Stock insuficiente en los lotes de puesta para esta tirada:</span>
                    </div>
                    {stockInsuficienteInfo.map((item, i) => (
                      <p key={i} className="text-[11px] pl-5">
                        Lote {item.lote?.codigoLote}: faltan {item.falta.toLocaleString()} huevos (necesarios {item.necesario.toLocaleString()}, disponibles {item.disponible.toLocaleString()}).
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Mermas en Envasado */}
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
                <span className="text-xs font-bold text-stone-800 block">Mermas en Línea de Envasado (Opcional)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">Rotos en manipulador</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={mermasRotos}
                      onChange={e => setMermasRotos(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-stone-500 font-medium block mb-0.5">Descartes de peso</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={mermasDescarte}
                      onChange={e => setMermasDescarte(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-sm rounded-lg border border-stone-300 p-2 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Observaciones */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Notas u Observaciones del Lote
                </label>
                <input
                  type="text"
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  placeholder="Ej: Embalado en estuches de cartón reciclado especial..."
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalNuevoEnvasado(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!cuadreEstuche || !stockSuficiente || numEstuches <= 0}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm cursor-pointer"
                >
                  Guardar Orden de Envasado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>

      {/* 6. MODAL DE ETIQUETA INDIVIDUAL CON QR / TRAZABILIDAD */}
      {loteParaEtiqueta && (
        <div
          id="modal-etiqueta-container"
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible print:block print:w-full"
        >
          <div
            id="modal-etiqueta-card"
            className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 border border-stone-200 my-auto print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full print:bg-white"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-2 no-print">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-700" />
                <h4 className="font-bold text-stone-900 text-sm">Etiqueta Oficial del Estuche</h4>
              </div>
              <button
                type="button"
                onClick={() => setLoteParaEtiqueta(null)}
                className="text-stone-400 hover:text-stone-700 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div
              id="hoja-etiqueta-envasado"
              className="p-4 border-2 border-stone-900 rounded-xl bg-white text-stone-900 font-sans space-y-2.5"
            >
              <div className="text-center border-b border-stone-400 pb-2">
                <h5 className="font-black text-sm tracking-wide text-stone-950 uppercase">{empresaConfig.nombreEmpresa}</h5>
                <p className="text-[10px] text-stone-600">RGSEAA: <strong>{empresaConfig.registroSanitario}</strong></p>
                <p className="text-[9px] text-stone-500">{empresaConfig.direccionEmpresa}</p>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-stone-500">Producto:</span>
                  <strong className="text-stone-900">{loteParaEtiqueta.nombreFormato}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Lote Envasado:</span>
                  <strong className="font-mono text-stone-900">{loteParaEtiqueta.codigoLoteEnvasado}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Consumo Preferente (DCP):</span>
                  <strong className="font-mono text-red-700 font-bold">{formatearFechaES(loteParaEtiqueta.fechaConsumoPreferente)}</strong>
                </div>
              </div>

              <div className="pt-2 border-t border-stone-300">
                <span className="text-[9px] uppercase font-bold text-stone-500 block">Composición Multilote:</span>
                <div className="space-y-0.5 mt-1">
                  {loteParaEtiqueta.componentesLotes.map((comp, idx) => (
                    <div key={idx} className="flex justify-between text-[10px] font-mono">
                      <span>{comp.codigoLotePuesta} ({comp.nombreNave})</span>
                      <strong className="text-amber-950">{comp.huevosPorEstuche} uds</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-stone-300">
                <div className="text-[9px] text-stone-500">
                  <p>Mantener refrigerado tras compra</p>
                  <p className="font-mono text-[8px] text-stone-400">COD-SAN: {empresaConfig.registroSanitario}</p>
                </div>
                <div className="w-12 h-12 bg-stone-900 text-white rounded flex items-center justify-center text-[9px] font-mono font-bold">
                  QR
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1 no-print">
              <button
                type="button"
                onClick={() => setLoteParaEtiqueta(null)}
                className="px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 rounded-lg cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir Etiqueta</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL DE LIBRO OFICIAL DE ENVASADO PARA SANIDAD */}
      {mostrarModalInformeEnvasado && (
        <div
          id="modal-informe-envasado-container"
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible print:block print:w-full"
        >
          <div
            id="modal-informe-envasado-card"
            className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full print:bg-white"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3 no-print">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-700" />
                <div>
                  <h3 className="font-bold text-stone-900">
                    Libro Oficial de Registro de Envasado, Marcado y Trazabilidad
                  </h3>
                  <p className="text-xs text-stone-500">
                    Documento Oficial para presentación a la Inspección Sanitaria (CEE 589/2008)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalInformeEnvasado(false)}
                className="text-stone-400 hover:text-stone-700 text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div
              id="hoja-informe-envasado"
              className="p-6 border border-stone-300 rounded-xl bg-white text-stone-900 font-sans space-y-4 print:border-none print:p-0"
            >
              <div className="flex justify-between items-start border-b-2 border-stone-900 pb-3">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amber-900 block">
                    CENTRO DE EMBALAJE AUTORIZADO • REGLAMENTO (CE) Nº 589/2008 Y R.D. 226/2008
                  </span>
                  <h2 className="text-xl font-black text-stone-950 mt-0.5">
                    {empresaConfig.nombreEmpresa}
                  </h2>
                  <p className="text-xs text-stone-600">
                    CIF: {empresaConfig.cifEmpresa} • {empresaConfig.direccionEmpresa}
                  </p>
                  <p className="text-xs text-stone-600">
                    RGSEAA: <strong className="font-mono">{empresaConfig.registroSanitario}</strong> • Tel: {empresaConfig.telefonoEmpresa}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs uppercase font-black bg-stone-900 text-white px-2 py-1 rounded block">
                    LIBRO OFICIAL DE ENVASADO
                  </span>
                  <span className="text-xs text-stone-600 block mt-1.5">
                    Fecha de emisión: <strong>{formatearFechaES(hoy)}</strong>
                  </span>
                  <span className="text-xs text-amber-900 font-medium block">
                    Período: {formatearFechaES(fechaDesde) || 'Inicio'} hasta {formatearFechaES(fechaHasta) || 'Actualidad'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-500 block">Filtro de Formatos:</span>
                  <span className="font-medium text-stone-800">
                    {filtroFormato === 'todos' ? 'Todos los formatos' : formatos.find(f => f.id === filtroFormato)?.nombre}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-500 block">Registro Sanitario:</span>
                  <span className="font-mono font-bold text-stone-900">{empresaConfig.registroSanitario}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-500 block">Total Órdenes:</span>
                  <span className="font-bold text-amber-900">{lotesEnvasadosFiltrados.length} lotes de envasado</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b-2 border-stone-800 bg-stone-100 text-stone-800 font-bold">
                      <th className="py-2 px-1.5">Fecha</th>
                      <th className="py-2 px-1.5">Lote Envasado</th>
                      <th className="py-2 px-1.5">Formato</th>
                      <th className="py-2 px-1.5 text-center">D.C.P.</th>
                      <th className="py-2 px-1.5">Trazabilidad Orígenes (Puesta)</th>
                      <th className="py-2 px-1.5 text-right">Estuches</th>
                      <th className="py-2 px-1.5 text-right">Total Huevos</th>
                      <th className="py-2 px-1.5 text-right">Mermas</th>
                      <th className="py-2 px-1.5 text-right">Stock Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {lotesEnvasadosFiltrados.map((lote) => {
                      const mermasTot = (lote.mermasEnvasado?.rotosManipulacion || 0) + (lote.mermasEnvasado?.descartePeso || 0);
                      const totalHuevos = lote.cantidadEstuchesProducidos * lote.huevosPorEstuche;
                      return (
                        <tr key={lote.id} className="hover:bg-stone-50">
                          <td className="py-1.5 px-1.5 font-mono text-[11px] whitespace-nowrap">{formatearFechaES(lote.fechaEnvasado)}</td>
                          <td className="py-1.5 px-1.5 font-mono font-bold text-stone-900 whitespace-nowrap">{lote.codigoLoteEnvasado}</td>
                          <td className="py-1.5 px-1.5 text-[11px]">{lote.nombreFormato}</td>
                          <td className="py-1.5 px-1.5 text-center font-mono font-bold text-red-700 text-[11px]">{formatearFechaES(lote.fechaConsumoPreferente)}</td>
                          <td className="py-1.5 px-1.5 text-[10px] font-mono text-stone-700">
                            {lote.componentesLotes.map(c => `${c.codigoLotePuesta} (${c.huevosPorEstuche}h)`).join(' + ')}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-medium text-stone-800">{lote.cantidadEstuchesProducidos.toLocaleString()}</td>
                          <td className="py-1.5 px-1.5 text-right font-mono text-stone-900 font-bold bg-amber-50/40">{totalHuevos.toLocaleString()}</td>
                          <td className="py-1.5 px-1.5 text-right text-red-700 text-[11px]">{mermasTot}</td>
                          <td className="py-1.5 px-1.5 text-right font-mono text-stone-700 font-semibold">{lote.estuchesDisponibles.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-stone-800 bg-stone-100 font-bold text-stone-900">
                      <td colSpan={5} className="py-2 px-1.5 text-right uppercase">TOTALES:</td>
                      <td className="py-2 px-1.5 text-right">{totalesInforme.estuchesProducidos.toLocaleString()}</td>
                      <td className="py-2 px-1.5 text-right text-amber-950 font-black bg-amber-100">{totalesInforme.huevosTotalesEnvasados.toLocaleString()}</td>
                      <td className="py-2 px-1.5 text-right text-red-800">{totalesInforme.totalMermas.toLocaleString()}</td>
                      <td className="py-2 px-1.5 text-right font-mono">{totalesInforme.estuchesDisponibles.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="pt-8 grid grid-cols-2 gap-8 text-[11px] text-stone-600 border-t border-stone-200">
                <div className="border-t border-stone-400 pt-2 text-center">
                  <p className="font-bold text-stone-800">Responsable de Calidad y Embalaje</p>
                  <p className="text-[10px] text-stone-500 mt-0.5">Firma, Sello y Declaración de Veracidad</p>
                </div>
                <div className="border-t border-stone-400 pt-2 text-center">
                  <p className="font-bold text-stone-800">Inspección Sanitaria Oficial</p>
                  <p className="text-[10px] text-stone-500 mt-0.5">Fecha, Firma del Facultativo y Número de Colegiado</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 no-print">
              <button
                type="button"
                onClick={() => setMostrarModalInformeEnvasado(false)}
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
    </>
  );
};
