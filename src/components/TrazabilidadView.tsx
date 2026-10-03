import React, { useState } from 'react';
import {
  Truck,
  Search,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  HeartHandshake,
  Utensils,
  RotateCcw,
  Plus,
  Trash2,
  CheckCircle2,
  Boxes,
  Package,
  Calendar,
  Layers,
  FileText,
  User,
  X,
  ChevronRight,
  ChevronDown,
  Printer
} from 'lucide-react';
import { LotePuesta, LoteEnvasado, Albaran, Factura, OtraSalida, TipoOtraSalida, ConfiguracionEmpresa } from '../types';
import { formatearFechaES } from '../utils/storage';

interface TrazabilidadViewProps {
  lotesPuesta: LotePuesta[];
  lotesEnvasados: LoteEnvasado[];
  albaranes: Albaran[];
  facturas: Factura[];
  otrasSalidas: OtraSalida[];
  config?: ConfiguracionEmpresa;
  onAddOtraSalida: (salida: OtraSalida) => void;
  onDeleteOtraSalida: (id: string) => void;
}

export const TrazabilidadView: React.FC<TrazabilidadViewProps> = ({
  lotesPuesta,
  lotesEnvasados,
  albaranes,
  facturas,
  otrasSalidas,
  config,
  onAddOtraSalida,
  onDeleteOtraSalida
}) => {
  const hoy = new Date().toISOString().split('T')[0];

  // Subpestañas superiores (AUDITORIA | PUESTAS | SALIDAS)
  const [subTab, setSubTab] = useState<'auditoria' | 'puestas' | 'salidas'>('auditoria');

  const [terminoBusqueda, setTerminoBusqueda] = useState('');
  const [lotePuestaSeleccionado, setLotePuestaSeleccionado] = useState<string>(lotesPuesta[0]?.codigoLote || '');
  const [loteEnvasadoSeleccionado, setLoteEnvasadoSeleccionado] = useState<string>('');
  const [mostrarDossierImprimir, setMostrarDossierImprimir] = useState(false);

  // Form state para Otras Salidas (mermas almacén, donaciones, etc.)
  const [mostrarModalSalida, setMostrarModalSalida] = useState(false);
  const [tipoSalida, setTipoSalida] = useState<TipoOtraSalida>('merma_almacen');
  const [loteSalidaId, setLoteSalidaId] = useState(lotesEnvasados[0]?.id || '');
  const [cantidadSalida, setCantidadSalida] = useState<number | ''>('');
  const [motivoSalida, setMotivoSalida] = useState('');
  const [responsableSalida, setResponsableSalida] = useState('');

  // Filtrado dinámico
  const lotesPuestaFiltrados = lotesPuesta.filter(lp =>
    lp.codigoLote.toLowerCase().includes(terminoBusqueda.toLowerCase()) ||
    lp.nombreNave.toLowerCase().includes(terminoBusqueda.toLowerCase())
  );

  const lotesEnvasadosFiltrados = lotesEnvasados.filter(le =>
    le.codigoLoteEnvasado.toLowerCase().includes(terminoBusqueda.toLowerCase()) ||
    le.nombreFormato.toLowerCase().includes(terminoBusqueda.toLowerCase())
  );

  const handleGuardarSalida = (e: React.FormEvent) => {
    e.preventDefault();
    const lote = lotesEnvasados.find(le => le.id === loteSalidaId);
    if (!lote) {
      alert('Selecciona un lote envasado válido.');
      return;
    }
    const cant = Number(cantidadSalida) || 0;
    if (cant <= 0) {
      alert('La cantidad debe ser superior a 0.');
      return;
    }
    if (lote.estuchesDisponibles < cant) {
      alert(`Stock insuficiente: Solo hay ${lote.estuchesDisponibles} estuches disponibles en ese lote.`);
      return;
    }

    const nuevaSalida: OtraSalida = {
      id: 'sal-' + Date.now(),
      fecha: hoy,
      tipo: tipoSalida,
      loteEnvasadoId: lote.id,
      codigoLoteEnvasado: lote.codigoLoteEnvasado,
      nombreFormato: lote.nombreFormato,
      cantidadEstuches: cant,
      motivo: motivoSalida.trim(),
      responsable: responsableSalida.trim() || undefined,
      creadoEn: new Date().toISOString()
    };

    onAddOtraSalida(nuevaSalida);
    setMostrarModalSalida(false);
    setCantidadSalida('');
    setMotivoSalida('');
    setResponsableSalida('');
    setSubTab('salidas');
  };

  // Datos para el árbol de trazabilidad
  const lotePuestaActivo = lotesPuesta.find(l => l.codigoLote === lotePuestaSeleccionado || l.id === lotePuestaSeleccionado);
  const loteEnvasadoActivo = lotesEnvasados.find(l => l.codigoLoteEnvasado === loteEnvasadoSeleccionado || l.id === loteEnvasadoSeleccionado);

  // Encontrar qué lotes de envasado usaron el lote de puesta activo
  const envasadosQueUsanPuesta = lotePuestaActivo
    ? lotesEnvasados.filter(le => le.componentesLotes.some(c => c.lotePuestaId === lotePuestaActivo.id || c.codigoLotePuesta === lotePuestaActivo.codigoLote))
    : [];

  // Encontrar albaranes y facturas que vendieron estos envasados
  const albaranesConPuesta = albaranes.filter(alb =>
    alb.lineas.some(
      lin =>
        lin.trazabilidadPuesta?.some(tp => tp.codigoLotePuesta === lotePuestaActivo?.codigoLote) ||
        (lotePuestaActivo && lin.codigoLotePuesta?.includes(lotePuestaActivo.codigoLote))
    )
  );

  return (
    <>
      <div className={`space-y-4 max-w-4xl mx-auto pb-20 ${mostrarDossierImprimir ? 'print:hidden' : ''}`}>
        {/* 1. HERO CARD SUPERIOR ESTILO LIMPIO */}
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Trazabilidad 360° y Libro de Salidas
            </h2>
            <p className="text-amber-100 text-xs sm:text-sm font-medium flex items-center gap-2">
              <span>Auditoría Sanitaria CEE 589/2008</span>
              <span>•</span>
              <span>Seguimiento Granja a Consumidor</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMostrarModalSalida(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-white text-amber-800 hover:bg-amber-50 font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
          >
            <Plus className="w-4 h-4 text-amber-600" />
            <span>Registrar Salida</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-amber-400/40 text-xs text-white">
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Lotes de Puesta</span>
            <strong className="text-sm sm:text-base font-bold">{lotesPuesta.length} partidas</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Lotes Envasados</span>
            <strong className="text-sm sm:text-base font-bold text-amber-100">{lotesEnvasados.length} partidas</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Mermas / Otras Salidas</span>
            <strong className="text-sm sm:text-base font-bold">{otrasSalidas.length} registros</strong>
          </div>
        </div>
      </div>

      {/* 2. SUB-PESTAÑAS */}
      <div className="flex border-b border-stone-200 justify-around text-xs sm:text-sm font-bold tracking-wider text-stone-500">
        <button
          type="button"
          onClick={() => setSubTab('auditoria')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'auditoria' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Árbol de Trazabilidad 360°</span>
          {subTab === 'auditoria' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('puestas')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'puestas' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Explorador de Lotes ({lotesPuesta.length})</span>
          {subTab === 'puestas' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('salidas')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'salidas' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Libro de Salidas y Mermas ({otrasSalidas.length})</span>
          {subTab === 'salidas' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>
      </div>

      {/* 3. CONTENIDO SEGÚN SUB-PESTAÑA */}

      {/* === SUBTAB: AUDITORÍA 360° === */}
      {subTab === 'auditoria' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Barra de búsqueda de lote */}
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por lote de puesta (NAV...), lote de envasado (ENV...), o nave..."
              value={terminoBusqueda}
              onChange={e => setTerminoBusqueda(e.target.value)}
              className="w-full text-xs rounded-xl border border-stone-200 pl-9 pr-3 py-2.5 bg-white shadow-xs focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Lista selectiva de lotes */}
            <div className="md:col-span-5 space-y-3">
              <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs space-y-2">
                <span className="text-[10px] uppercase font-bold text-stone-400 tracking-wider block">
                  Seleccionar Lote a Inspeccionar:
                </span>

                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {lotesPuestaFiltrados.map(lp => (
                    <div
                      key={lp.id}
                      onClick={() => {
                        setLotePuestaSeleccionado(lp.codigoLote);
                        setLoteEnvasadoSeleccionado('');
                      }}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                        lotePuestaSeleccionado === lp.codigoLote
                          ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold shadow-xs'
                          : 'bg-stone-50 border-stone-200/80 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-amber-600" />
                          <span className="font-mono text-xs">{lp.codigoLote}</span>
                        </div>
                        <span className="text-[10px] text-stone-500 block mt-0.5">{lp.nombreNave} · {formatearFechaES(lp.fechaPuesta)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-stone-800 font-semibold">{lp.totalHuevosRecogidos} uds</span>
                        <span className="text-[10px] text-emerald-700 block">{lp.huevosDisponibles} disp.</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Árbol interactivo del lote seleccionado */}
            <div className="md:col-span-7 space-y-3">
              {lotePuestaActivo ? (
                <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                      <div>
                        <h4 className="font-bold text-stone-900 text-sm">Cadena Sanitaria de Trazabilidad</h4>
                        <p className="text-[11px] text-stone-500">Lote auditado: {lotePuestaActivo.codigoLote}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMostrarDossierImprimir(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer no-print transition-all"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Imprimir Dossier Oficial</span>
                    </button>
                  </div>

                  {/* 1. Origen Granja */}
                  <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200/80 space-y-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-amber-800 block">1. Origen en Nave de Producción</span>
                        <h5 className="font-mono font-black text-amber-950 text-sm">{lotePuestaActivo.codigoLote}</h5>
                        <p className="text-xs text-stone-600 font-medium">{lotePuestaActivo.nombreNave} · REGA: {lotePuestaActivo.codigoREGA}</p>
                      </div>
                      <div className="text-right text-xs">
                        <span className="text-stone-500 block">Puesta: {formatearFechaES(lotePuestaActivo.fechaPuesta)}</span>
                        <span className="font-bold text-red-700 block">DCP: {formatearFechaES(lotePuestaActivo.fechaCaducidad)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center text-stone-300">
                    <ArrowRight className="w-5 h-5 rotate-90" />
                  </div>

                  {/* 2. Envasado */}
                  <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                    <span className="text-[10px] uppercase font-bold text-stone-500 block">
                      2. Partidas Envasadas con este Lote ({envasadosQueUsanPuesta.length})
                    </span>

                    {envasadosQueUsanPuesta.length === 0 ? (
                      <p className="text-xs text-stone-400 italic">No se ha utilizado aún en ninguna partida de envasado.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {envasadosQueUsanPuesta.map(le => {
                          const comp = le.componentesLotes.find(c => c.lotePuestaId === lotePuestaActivo.id || c.codigoLotePuesta === lotePuestaActivo.codigoLote);
                          return (
                            <div key={le.id} className="p-2 bg-white rounded-lg border border-stone-200/80 text-xs flex justify-between items-center">
                              <div>
                                <strong className="font-mono text-stone-900 block">{le.codigoLoteEnvasado}</strong>
                                <span className="text-stone-500 text-[11px]">{le.nombreFormato} · Envasado: {formatearFechaES(le.fechaEnvasado)}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-amber-900 block">{comp?.huevosPorEstuche} h/est.</span>
                                <span className="text-[10px] text-stone-400">{comp?.totalHuevosConsumidos} uds consumidas</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center text-stone-300">
                    <ArrowRight className="w-5 h-5 rotate-90" />
                  </div>

                  {/* 3. Salidas a Clientes */}
                  <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                    <span className="text-[10px] uppercase font-bold text-stone-500 block">
                      3. Expediciones y Clientes Destinatarios ({albaranesConPuesta.length})
                    </span>

                    {albaranesConPuesta.length === 0 ? (
                      <p className="text-xs text-stone-400 italic">No constan expediciones a clientes finales con este lote de puesta.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {albaranesConPuesta.map(alb => (
                          <div key={alb.id} className="p-2 bg-white rounded-lg border border-stone-200/80 text-xs flex justify-between items-center">
                            <div>
                              <strong className="text-stone-900 block">{alb.clienteNombre}</strong>
                              <span className="text-stone-500 text-[11px] font-mono">{alb.numeroAlbaran} · {formatearFechaES(alb.fecha)}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-emerald-800 block">{alb.totales.totalDocumento.toFixed(2)} €</span>
                              <span className="text-[10px] text-stone-400">{alb.lineas.length} líneas entregadas</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center text-stone-400 text-xs">
                  Selecciona un lote de la lista para visualizar su auditoría completa.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === SUBTAB: LOTES DE PUESTA EXPLORADOR === */}
      {subTab === 'puestas' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
            {lotesPuesta.map(lp => (
              <div key={lp.id} className="p-4 flex items-center justify-between gap-3 hover:bg-stone-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                    <Layers className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="font-mono text-stone-900 text-sm">{lp.codigoLote}</strong>
                      <span className="text-[11px] text-stone-500">{lp.nombreNave}</span>
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Puesta: {formatearFechaES(lp.fechaPuesta)} • DCP: <span className="text-red-700 font-semibold">{formatearFechaES(lp.fechaCaducidad)}</span>
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <strong className="text-stone-900 text-sm block">{lp.totalHuevosRecogidos} uds</strong>
                  <span className="text-xs text-emerald-700 font-semibold">{lp.huevosDisponibles} disp.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === SUBTAB: LIBRO DE OTRAS SALIDAS Y MERMAS === */}
      {subTab === 'salidas' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Salidas no comerciales registradas ({otrasSalidas.length})</span>
            </div>

            <button
              type="button"
              onClick={() => setMostrarModalSalida(true)}
              className="text-xs font-bold text-amber-700 hover:text-amber-900 bg-amber-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              + Nueva Merma o Salida
            </button>
          </div>

          {otrasSalidas.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-stone-800 font-bold text-sm">No hay salidas no comerciales</h3>
              <p className="text-stone-500 text-xs max-w-sm mx-auto">
                No se han registrado roturas en almacén, donaciones o autoconsumo. Pulsa <strong className="text-amber-700 font-semibold">+</strong> para registrar una incidencia.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
              {otrasSalidas.map(sal => (
                <div key={sal.id} className="p-4 flex items-center justify-between gap-3 hover:bg-stone-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-100 text-red-800 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="font-mono text-stone-900 text-sm">{sal.codigoLoteEnvasado}</strong>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 uppercase">
                          {sal.tipo.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-stone-600 mt-0.5">
                        {sal.motivo} {sal.responsable && `· Resp: ${sal.responsable}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <strong className="text-stone-900 text-sm block">{sal.cantidadEstuches} est.</strong>
                      <span className="text-[11px] text-stone-400">{formatearFechaES(sal.fecha)}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('¿Eliminar este registro del libro de salidas?')) {
                          onDeleteOtraSalida(sal.id);
                        }
                      }}
                      className="text-stone-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. BOTÓN FLOTANTE CIRCULAR '+' (FAB) */}
      <button
        type="button"
        onClick={() => setMostrarModalSalida(true)}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-600 to-amber-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all cursor-pointer group"
        title="Registrar Merma o Salida (+)"
      >
        <Plus className="w-7 h-7 stroke-[2.5] group-hover:rotate-90 transition-transform duration-200" />
      </button>
      </div>

      {/* 5. MODAL LIMPIO DE REGISTRAR SALIDA */}
      {mostrarModalSalida && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">Registrar Merma / Otra Salida</h3>
                  <p className="text-xs text-stone-500">Deducción de existencias en almacén</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalSalida(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarSalida} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Tipo de Incidencia / Destino:
                </label>
                <select
                  value={tipoSalida}
                  onChange={e => setTipoSalida(e.target.value as TipoOtraSalida)}
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5 bg-stone-50 focus:bg-white"
                >
                  <option value="merma_almacen">Merma / Rotura en Cámara o Transporte</option>
                  <option value="autoconsumo">Autoconsumo de la Explotación</option>
                  <option value="donacion">Donación a Banco de Alimentos</option>
                  <option value="devolucion_defecto">Devolución por defecto de cáscara</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Partida / Lote Envasado Afectado:
                </label>
                <select
                  value={loteSalidaId}
                  onChange={e => setLoteSalidaId(e.target.value)}
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5 bg-stone-50 focus:bg-white font-mono"
                >
                  {lotesEnvasados.map(le => (
                    <option key={le.id} value={le.id}>
                      {le.codigoLoteEnvasado} - {le.nombreFormato} ({le.estuchesDisponibles} disp.)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Cantidad de Estuches:
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="Ej: 2"
                  value={cantidadSalida}
                  onChange={e => setCantidadSalida(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                  className="w-full text-sm font-bold rounded-xl border border-stone-300 p-2.5"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Causa Detallada (para inspección sanitaria):
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej: Rotura accidental por caída de caja durante estibado..."
                  value={motivoSalida}
                  onChange={e => setMotivoSalida(e.target.value)}
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Responsable / Operario:
                </label>
                <input
                  type="text"
                  placeholder="Nombre de quien autoriza o notifica"
                  value={responsableSalida}
                  onChange={e => setResponsableSalida(e.target.value)}
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalSalida(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!cantidadSalida || Number(cantidadSalida) <= 0 || !motivoSalida.trim()}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
                >
                  Registrar Salida
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MODAL IMPRIMIBLE DE DOSSIER OFICIAL DE TRAZABILIDAD 360° */}
      {mostrarDossierImprimir && lotePuestaActivo && (
        <div
          id="modal-dossier-trazabilidad-container"
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible print:block print:w-full"
        >
          <div
            id="modal-dossier-trazabilidad-card"
            className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full print:bg-white"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3 no-print">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="font-bold text-stone-900">Dossier Oficial de Trazabilidad y Certificado Sanitario</h3>
                  <p className="text-xs text-stone-500">Documento vinculante de trazabilidad animal (Reglamento CE 178/2002)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarDossierImprimir(false)}
                className="text-stone-400 hover:text-stone-700 text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div
              id="hoja-dossier-trazabilidad"
              className="p-6 border border-stone-300 rounded-xl bg-white text-stone-900 font-sans space-y-5 print:border-none print:p-0 print:m-0 print:w-full"
            >
              {/* Encabezado */}
              <div className="flex justify-between items-start border-b-2 border-stone-900 pb-4">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-800 block">
                    SISTEMA INTEGRAL DE TRAZABILIDAD GANADERA Y CENTRO DE EMBALAJE
                  </span>
                  <h2 className="text-2xl font-black text-stone-950 tracking-tight mt-0.5">
                    {config?.nombreEmpresa || 'Explotación Avícola'}
                  </h2>
                  <p className="text-xs text-stone-600 mt-1">
                    CIF / NIF: <strong className="font-mono">{config?.cifEmpresa || '-'}</strong> • {config?.direccionEmpresa || '-'}
                  </p>
                  <p className="text-xs text-stone-600">
                    RGSEAA: <strong className="font-mono">{config?.registroSanitario || '-'}</strong> • Código REGA Nave: <strong className="font-mono text-stone-900">{lotePuestaActivo.codigoREGA}</strong>
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs uppercase font-black bg-stone-900 text-white px-3 py-1.5 rounded inline-block">
                    AUDITORÍA 360°
                  </span>
                  <span className="text-sm font-mono font-bold text-stone-900 block mt-2">
                    LOTE: {lotePuestaActivo.codigoLote}
                  </span>
                  <span className="text-xs text-stone-600 block mt-0.5">Fecha de Emisión: <strong>{hoy}</strong></span>
                </div>
              </div>

              {/* 1. Origen en Granja */}
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs">
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-[11px] text-amber-900">
                  1. Origen en Nave de Producción Avícola
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div>
                    <span className="text-[10px] text-stone-500 uppercase block">Nave:</span>
                    <strong className="text-stone-900 font-semibold">{lotePuestaActivo.nombreNave}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 uppercase block">Tipo de Cría:</span>
                    <span className="font-medium text-stone-800">{lotePuestaActivo.tipoCria}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 uppercase block">Fecha de Puesta:</span>
                    <strong className="font-mono text-stone-900">{formatearFechaES(lotePuestaActivo.fechaPuesta)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 uppercase block">Fecha Caducidad (DCP):</span>
                    <strong className="font-mono text-red-700 font-bold">{formatearFechaES(lotePuestaActivo.fechaCaducidad)}</strong>
                  </div>
                </div>

                <div className="pt-2 border-t border-stone-200 flex flex-wrap gap-4 text-stone-700">
                  <span>Total Recogido: <strong className="font-mono text-stone-900">{lotePuestaActivo.totalHuevosRecogidos} uds</strong></span>
                  <span>Huevos Aptos: <strong className="font-mono text-emerald-800">{lotePuestaActivo.huevosAptos} uds</strong></span>
                  <span>Calibres: XL({lotePuestaActivo.calibres.xl}) L({lotePuestaActivo.calibres.l}) M({lotePuestaActivo.calibres.m}) S({lotePuestaActivo.calibres.s})</span>
                  <span>Mermas: {lotePuestaActivo.mermas.rotos + lotePuestaActivo.mermas.sucios + lotePuestaActivo.mermas.descarte} uds</span>
                </div>
              </div>

              {/* 2. Transformación y Envasado */}
              <div className="space-y-2 text-xs">
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-[11px] text-stone-800">
                  2. Transformación en Centro de Embalaje ({envasadosQueUsanPuesta.length} Partidas Envasadas)
                </h4>
                {envasadosQueUsanPuesta.length === 0 ? (
                  <p className="text-stone-500 italic p-3 bg-stone-50 rounded-lg border border-stone-200">
                    Este lote de puesta aún no ha sido incorporado a órdenes de envasado comercial.
                  </p>
                ) : (
                  <table className="w-full text-left border-collapse border border-stone-300">
                    <thead>
                      <tr className="bg-stone-100 font-bold text-stone-900 border-b border-stone-300">
                        <th className="py-2 px-2">Lote Envasado</th>
                        <th className="py-2 px-2">Fecha</th>
                        <th className="py-2 px-2">Formato Comercial</th>
                        <th className="py-2 px-2 text-center">D.C.P.</th>
                        <th className="py-2 px-2 text-right">Huevos Usados</th>
                        <th className="py-2 px-2 text-right">Estuches Producidos</th>
                        <th className="py-2 px-2 text-right">Stock Saldo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {envasadosQueUsanPuesta.map(le => {
                        const comp = le.componentesLotes.find(c => c.lotePuestaId === lotePuestaActivo.id || c.codigoLotePuesta === lotePuestaActivo.codigoLote);
                        return (
                          <tr key={le.id}>
                            <td className="py-1.5 px-2 font-mono font-bold text-stone-900">{le.codigoLoteEnvasado}</td>
                            <td className="py-1.5 px-2 font-mono">{formatearFechaES(le.fechaEnvasado)}</td>
                            <td className="py-1.5 px-2">{le.nombreFormato}</td>
                            <td className="py-1.5 px-2 text-center font-mono font-bold text-red-700">{formatearFechaES(le.fechaConsumoPreferente)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{comp?.totalHuevosConsumidos}</td>
                            <td className="py-1.5 px-2 text-right font-semibold">{le.cantidadEstuchesProducidos}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-stone-700">{le.estuchesDisponibles}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 3. Distribución y Destinos Comerciales */}
              <div className="space-y-2 text-xs">
                <h4 className="font-black text-stone-900 uppercase tracking-wider text-[11px] text-stone-800">
                  3. Destinos Comerciales, Albaranes y Clientes Receptores ({albaranesConPuesta.length} Entregas)
                </h4>
                {albaranesConPuesta.length === 0 ? (
                  <p className="text-stone-500 italic p-3 bg-stone-50 rounded-lg border border-stone-200">
                    No existen salidas comerciales registradas para este lote o las partidas envasadas permanecen en cámara.
                  </p>
                ) : (
                  <table className="w-full text-left border-collapse border border-stone-300">
                    <thead>
                      <tr className="bg-stone-100 font-bold text-stone-900 border-b border-stone-300">
                        <th className="py-2 px-2">Documento</th>
                        <th className="py-2 px-2">Fecha Entrega</th>
                        <th className="py-2 px-2">Cliente Destinatario</th>
                        <th className="py-2 px-2">CIF/NIF</th>
                        <th className="py-2 px-2 text-right">Estuches Entregados</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {albaranesConPuesta.map(alb => {
                        const cant = alb.lineas.reduce((acc, l) => {
                          const usaPuesta = l.trazabilidadPuesta?.some(tp => tp.codigoLotePuesta === lotePuestaActivo.codigoLote);
                          return usaPuesta ? acc + l.cantidadEstuches : acc;
                        }, 0);
                        return (
                          <tr key={alb.id}>
                            <td className="py-1.5 px-2 font-mono font-bold text-amber-900">{alb.numeroAlbaran}</td>
                            <td className="py-1.5 px-2 font-mono">{formatearFechaES(alb.fecha)}</td>
                            <td className="py-1.5 px-2 font-semibold text-stone-900">{alb.clienteNombre}</td>
                            <td className="py-1.5 px-2 font-mono text-stone-600">{alb.clienteCif}</td>
                            <td className="py-1.5 px-2 text-right font-bold text-stone-950">{cant}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Diligencia Oficial Sanitaria y Firmas */}
              <div className="pt-4 border-t border-stone-300 text-[11px] text-stone-600 space-y-4">
                <p className="italic text-stone-700 leading-relaxed bg-stone-50 p-3 rounded-lg border border-stone-200">
                  <strong>DILIGENCIA DE CONTROL SANITARIO:</strong> Los datos contenidos en este dossier reflejan fielmente el flujo ininterrumpido de trazabilidad (one-step-back / one-step-forward) desde el corral/nave de postura hasta los puntos de venta o clientes finales autorizados, conforme al Reglamento (CE) 178/2002 y normativas sanitarias vigentes.
                </p>

                <div className="pt-4 grid grid-cols-2 gap-8">
                  <div className="border-t border-stone-400 pt-3 text-center">
                    <p className="font-bold text-stone-800">Responsable Sanitario de Explotación</p>
                    <p className="text-[10px] text-stone-500 mt-1">Firma, Sello y Fecha</p>
                  </div>
                  <div className="border-t border-stone-400 pt-3 text-center">
                    <p className="font-bold text-stone-800">Servicios Veterinarios Oficiales / Inspección</p>
                    <p className="text-[10px] text-stone-500 mt-1">Firma del Inspector y Núm. Colegiado</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 no-print">
              <button
                type="button"
                onClick={() => setMostrarDossierImprimir(false)}
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
                <span>Imprimir Dossier / PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
