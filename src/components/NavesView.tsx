import React, { useState } from 'react';
import {
  Home,
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Layers,
  Sparkles,
  Info,
  Clock,
  Egg,
  Heart,
  RotateCcw,
  CheckCircle2,
  X
} from 'lucide-react';
import { Nave, TipoCria, LotePuesta } from '../types';
import { calcularEdadLote, formatearFechaES } from '../utils/storage';

interface NavesViewProps {
  naves: Nave[];
  lotesPuesta?: LotePuesta[];
  codigoREGADefault?: string;
  onAddNave: (nave: Nave) => void;
  onUpdateNave: (nave: Nave) => void;
  onDeleteNave: (id: string) => void;
}

export const NavesView: React.FC<NavesViewProps> = ({
  naves,
  lotesPuesta = [],
  codigoREGADefault = 'ES45000189',
  onAddNave,
  onUpdateNave,
  onDeleteNave
}) => {
  const hoyISO = new Date().toISOString().split('T')[0];
  const [mostrarModal, setMostrarModal] = useState(false);
  const [naveEditando, setNaveEditando] = useState<Nave | null>(null);

  // Campos de formulario
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoCria, setTipoCria] = useState<TipoCria>('1-Campero');
  const [codigoREGA, setCodigoREGA] = useState(codigoREGADefault);
  const [capacidadAves, setCapacidadAves] = useState<number | ''>(3000);
  const [activa, setActiva] = useState(true);
  const [fechaEntrada, setFechaEntrada] = useState(hoyISO);
  const [edadSemanasEntrada, setEdadSemanasEntrada] = useState<number | ''>(24);
  const [razaGallinas, setRazaGallinas] = useState('Lohmann Brown');
  const [observacionesLote, setObservacionesLote] = useState('');

  // Estadísticas
  const totalAves = naves.reduce((acc, n) => acc + (n.capacidadAves || 0), 0);
  const navesActivas = naves.filter(n => n.activa !== false).length;

  const handleOpenModal = (nave?: Nave) => {
    if (nave) {
      setNaveEditando(nave);
      setCodigo(nave.codigo);
      setNombre(nave.nombre);
      setTipoCria(nave.tipoCria);
      setCodigoREGA(nave.codigoREGA || codigoREGADefault);
      setCapacidadAves(nave.capacidadAves);
      setActiva(nave.activa !== false);
      setFechaEntrada(nave.fechaEntrada || hoyISO);
      setEdadSemanasEntrada(nave.edadSemanasEntrada ?? 24);
      setRazaGallinas(nave.razaGallinas || 'Lohmann Brown');
      setObservacionesLote(nave.observacionesLote || '');
    } else {
      setNaveEditando(null);
      const siguienteNum = naves.length + 1;
      setCodigo(`NAV${siguienteNum}`);
      setNombre(`Nave ${siguienteNum} - Lote Gallinas`);
      setTipoCria('1-Campero');
      setCodigoREGA(codigoREGADefault);
      setCapacidadAves(3000);
      setActiva(true);
      setFechaEntrada(hoyISO);
      setEdadSemanasEntrada(24);
      setRazaGallinas('Lohmann Brown');
      setObservacionesLote('');
    }
    setMostrarModal(true);
  };

  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo.trim() || !nombre.trim()) {
      alert('El código y el nombre del lote/nave son obligatorios.');
      return;
    }

    const nData: Nave = {
      id: naveEditando ? naveEditando.id : 'nave-' + Date.now(),
      codigo: codigo.trim().toUpperCase(),
      nombre: nombre.trim(),
      tipoCria,
      codigoREGA: codigoREGA.trim().toUpperCase(),
      capacidadAves: Number(capacidadAves) || 0,
      activa,
      fechaEntrada: fechaEntrada || hoyISO,
      edadSemanasEntrada: Number(edadSemanasEntrada) || 24,
      razaGallinas: razaGallinas.trim(),
      observacionesLote: observacionesLote.trim()
    };

    if (naveEditando) {
      onUpdateNave(nData);
    } else {
      onAddNave(nData);
    }
    setMostrarModal(false);
  };

  const handleEliminar = (nave: Nave) => {
    const tieneLotes = lotesPuesta.some(lp => lp.naveId === nave.id || lp.codigoLote?.startsWith(nave.codigo));
    if (tieneLotes) {
      const confirmacion = window.confirm(
        `El lote/nave ${nave.nombre} (${nave.codigo}) tiene puestas registradas en el historial de trazabilidad.\n\nPor trazabilidad alimentaria (RD 226/2008), se recomienda mantener la nave o desactivarla en lugar de borrarla.\n\n¿Deseas desactivarla ahora?`
      );
      if (confirmacion) {
        onUpdateNave({ ...nave, activa: false });
      }
      return;
    }

    if (window.confirm(`¿Seguro que deseas eliminar el lote ${nave.nombre} (${nave.codigo})?`)) {
      onDeleteNave(nave.id);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Encabezado y Métricas */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                <Home className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-900 leading-tight">
                  Lotes de Gallinas y Naves de Producción
                </h3>
                <p className="text-xs text-stone-500">
                  Control de ciclo de vida de cada lote (rotación bianual ~2 años), fecha de entrada, edad en semanas y días de puesta
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-700 hover:bg-amber-800 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Lote / Nave</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-stone-100 text-xs">
          <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-100">
            <span className="text-[10px] uppercase font-bold text-amber-900/80 block">Lotes Activos</span>
            <strong className="text-lg font-black text-amber-950">{navesActivas} de {naves.length}</strong>
          </div>
          <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
            <span className="text-[10px] uppercase font-bold text-stone-600 block">Capacidad Censal Total</span>
            <strong className="text-lg font-black text-stone-900">{totalAves.toLocaleString()} aves</strong>
          </div>
          <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
            <span className="text-[10px] uppercase font-bold text-stone-600 block">Ciclo Productivo</span>
            <strong className="text-xs sm:text-sm font-bold text-stone-800 block">
              2 años (~104 semanas / ~730 días)
            </strong>
          </div>
          <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
            <span className="text-[10px] uppercase font-bold text-stone-600 block">REGA Explotación</span>
            <strong className="text-xs sm:text-sm font-mono font-bold text-stone-800 block truncate" title={codigoREGADefault}>
              {codigoREGADefault}
            </strong>
          </div>
        </div>
      </div>

      {/* Grid de Naves / Lotes */}
      {naves.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-2xl p-10 text-center space-y-3">
          <Home className="w-12 h-12 text-stone-300 mx-auto" />
          <h4 className="text-sm font-bold text-stone-800">No hay lotes de gallinas registrados</h4>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            Registra tu primer lote de gallinas indicando la fecha de entrada para controlar su edad y el timeline de puesta.
          </p>
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs hover:bg-amber-800 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Lote</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {naves.map(nave => {
            const lotesNave = lotesPuesta.filter(lp => lp.naveId === nave.id || lp.codigoLote?.startsWith(nave.codigo));
            const huevosDisponiblesNave = lotesNave.reduce((acc, lp) => acc + (lp.huevosDisponibles || 0), 0);
            const edadActual = calcularEdadLote(hoyISO, nave.fechaEntrada, nave.edadSemanasEntrada ?? 24);

            return (
              <div
                key={nave.id}
                className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-black bg-amber-100 text-amber-950 px-2 py-0.5 rounded-lg border border-amber-300">
                          {nave.codigo}
                        </span>
                        {nave.activa !== false ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Activa
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
                            Inactiva
                          </span>
                        )}
                        <span className="text-[10px] font-bold bg-amber-700 text-white px-2 py-0.5 rounded-full shadow-xs">
                          Sem {edadActual.semanaVida}
                        </span>
                      </div>
                      <h4 className="font-bold text-stone-900 text-base mt-1.5 leading-snug">
                        {nave.nombre}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(nave)}
                        className="p-1.5 text-stone-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        title="Modificar Lote / Nave"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEliminar(nave)}
                        className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar o Desactivar Nave"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Panel de Edad del Lote y Ciclo de 2 años */}
                  <div className="mt-3 p-3 bg-gradient-to-br from-amber-50 to-stone-50 border border-amber-200/80 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-700" />
                        <span className="font-extrabold text-stone-900">
                          Día {edadActual.diasEnNave} en nave
                        </span>
                      </div>
                      <span className="font-bold text-amber-950 font-mono text-[11px]">
                        Semana {edadActual.semanaVida} de vida
                      </span>
                    </div>

                    {/* Barra de progreso de los 2 años */}
                    <div className="space-y-1">
                      <div className="w-full bg-stone-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-600 h-full rounded-full transition-all"
                          style={{ width: `${edadActual.porcentajeCicloCompletado}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-stone-500 font-medium">
                        <span>Entrada: {formatearFechaES(nave.fechaEntrada)}</span>
                        <span>{edadActual.diasRestantesLote} días restantes (~2 años)</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-3 mt-3 border-t border-stone-100 text-stone-700">
                    <div>
                      <span className="text-[10px] text-stone-400 block font-medium">Sistema de Cría:</span>
                      <strong className="text-amber-900 font-bold block truncate" title={nave.tipoCria}>
                        {nave.tipoCria}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block font-medium">Raza / Estirpe:</span>
                      <strong className="text-stone-800 font-bold block truncate">
                        {nave.razaGallinas || 'Lohmann Brown'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block font-medium">Capacidad de Aves:</span>
                      <span className="font-bold text-stone-800">
                        {nave.capacidadAves.toLocaleString()} aves
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block font-medium">Huevos en Stock:</span>
                      <span className="font-bold text-amber-700">
                        {huevosDisponiblesNave.toLocaleString()} uds
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 mt-3 border-t border-stone-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-stone-500">
                    {lotesNave.length} {lotesNave.length === 1 ? 'partida registrada' : 'partidas registradas'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenModal(nave)}
                    className="text-amber-700 hover:text-amber-800 font-bold hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Configurar lote</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Crear / Editar Nave y Lote */}
      {mostrarModal && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-stone-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Home className="w-5 h-5 text-amber-700" />
                <h3 className="font-bold text-base text-stone-900">
                  {naveEditando ? 'Configurar Lote de Gallinas / Nave' : 'Nuevo Lote de Gallinas'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardar} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Código de Nave / Lote *
                  </label>
                  <input
                    type="text"
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.toUpperCase())}
                    placeholder="NAV1"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase font-bold focus:ring-2 focus:ring-amber-500"
                    required
                  />
                  <span className="text-[10px] text-stone-400">Ej: NAV1, LOTE-2026-1</span>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Capacidad (Aves) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={capacidadAves}
                    onChange={e => setCapacidadAves(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="3000"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold focus:ring-2 focus:ring-amber-500"
                    required
                  />
                  <span className="text-[10px] text-stone-400">Censo inicial del lote</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Nombre Descriptivo del Lote *
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Nave 1 - Lote Gallinas Campero"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-medium focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              {/* SECCIÓN FECHA DE ENTRADA Y EDAD (REQUERIMIENTO PRINCIPAL) */}
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-700" />
                  <strong className="text-amber-950 font-bold text-xs">
                    Datos del Lote: Fecha de Entrada y Edad
                  </strong>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Fecha de Entrada en Nave *
                    </label>
                    <input
                      type="date"
                      value={fechaEntrada}
                      onChange={e => setFechaEntrada(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 p-2 text-xs font-bold text-stone-900 bg-white focus:ring-2 focus:ring-amber-500"
                      required
                    />
                    <span className="text-[10px] text-stone-500 mt-0.5 block">
                      Día 1 de inicio de la manada en la nave
                    </span>
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Edad al Entrar (Semanas) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={edadSemanasEntrada}
                      onChange={e => setEdadSemanasEntrada(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="24"
                      className="w-full rounded-xl border border-stone-300 p-2 text-xs font-bold text-stone-900 bg-white focus:ring-2 focus:ring-amber-500"
                      required
                    />
                    <span className="text-[10px] text-stone-500 mt-0.5 block">
                      Típicamente 18-24 semanas de vida
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-amber-900 bg-white/70 p-2 rounded-lg border border-amber-200/60 flex items-center justify-between">
                  <span>
                    Edad actual calculada hoy:
                  </span>
                  <strong className="text-xs font-extrabold text-amber-950">
                    Día {calcularEdadLote(hoyISO, fechaEntrada, Number(edadSemanasEntrada) || 24).diasEnNave} · Sem {calcularEdadLote(hoyISO, fechaEntrada, Number(edadSemanasEntrada) || 24).semanaVida}
                  </strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Raza / Estirpe de las Gallinas
                  </label>
                  <input
                    type="text"
                    value={razaGallinas}
                    onChange={e => setRazaGallinas(e.target.value)}
                    placeholder="Lohmann Brown"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-medium focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Sistema de Cría *
                  </label>
                  <select
                    value={tipoCria}
                    onChange={e => setTipoCria(e.target.value as TipoCria)}
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold text-amber-950 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="0-Ecologico">0 - Ecológico</option>
                    <option value="1-Campero">1 - Campero</option>
                    <option value="2-Suelo">2 - Suelo</option>
                    <option value="3-Jaula">3 - Jaula</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Código REGA de la Nave / Explotación
                </label>
                <input
                  type="text"
                  value={codigoREGA}
                  onChange={e => setCodigoREGA(e.target.value.toUpperCase())}
                  placeholder="ES45000189"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Observaciones del Lote
                </label>
                <textarea
                  rows={2}
                  value={observacionesLote}
                  onChange={e => setObservacionesLote(e.target.value)}
                  placeholder="Procedencia de la recría, certificados sanitarios, lote de pienso..."
                  className="w-full rounded-xl border border-stone-300 p-2.5 text-xs focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={activa}
                    onChange={e => setActiva(e.target.checked)}
                    className="w-4 h-4 text-amber-600 rounded border-stone-300 focus:ring-amber-500"
                  />
                  <span className="font-semibold text-stone-700">Lote en producción activa</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModal(false)}
                  className="px-4 py-2 border border-stone-300 rounded-xl text-stone-600 hover:bg-stone-50 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer"
                >
                  {naveEditando ? 'Guardar Cambios' : 'Registrar Lote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
