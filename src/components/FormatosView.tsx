import React, { useState } from 'react';
import {
  Package,
  Plus,
  Edit2,
  Trash2,
  DollarSign,
  Tag,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  Layers
} from 'lucide-react';
import { FormatoEnvase, TipoEnvase, LoteEnvasado } from '../types';

interface FormatosViewProps {
  formatos: FormatoEnvase[];
  lotesEnvasados?: LoteEnvasado[];
  onAddFormato: (formato: FormatoEnvase) => void;
  onUpdateFormato: (formato: FormatoEnvase) => void;
  onDeleteFormato: (id: string) => void;
}

export const FormatosView: React.FC<FormatosViewProps> = ({
  formatos,
  lotesEnvasados = [],
  onAddFormato,
  onUpdateFormato,
  onDeleteFormato
}) => {
  const [mostrarModal, setMostrarModal] = useState(false);
  const [formatoEditando, setFormatoEditando] = useState<FormatoEnvase | null>(null);

  // Campos de formulario
  const [nombre, setNombre] = useState('');
  const [tipoEnvase, setTipoEnvase] = useState<TipoEnvase>('estuche_carton');
  const [cantidadHuevos, setCantidadHuevos] = useState<number | ''>(12);
  const [calibreRecomendado, setCalibreRecomendado] = useState<'XL' | 'L' | 'M' | 'S' | 'MIX'>('L');
  const [precioVenta, setPrecioVenta] = useState<number | ''>(2.80);
  const [costeEnvase, setCosteEnvase] = useState<number | ''>(0.25);
  const [textoEtiqueta, setTextoEtiqueta] = useState('Huevos frescos Clase A');
  const [activo, setActivo] = useState(true);

  const handleOpenModal = (fmt?: FormatoEnvase) => {
    if (fmt) {
      setFormatoEditando(fmt);
      setNombre(fmt.nombre);
      setTipoEnvase(fmt.tipoEnvase);
      setCantidadHuevos(fmt.cantidadHuevos);
      setCalibreRecomendado(fmt.calibreRecomendado);
      setPrecioVenta(fmt.precioVenta);
      setCosteEnvase(fmt.costeEnvase);
      setTextoEtiqueta(fmt.textoEtiqueta || 'Huevos frescos Clase A');
      setActivo(fmt.activo !== false);
    } else {
      setFormatoEditando(null);
      setNombre('Estuche Docena Campero L');
      setTipoEnvase('estuche_carton');
      setCantidadHuevos(12);
      setCalibreRecomendado('L');
      setPrecioVenta(2.80);
      setCosteEnvase(0.25);
      setTextoEtiqueta('Huevos frescos camperos Clase A');
      setActivo(true);
    }
    setMostrarModal(true);
  };

  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !cantidadHuevos) {
      alert('Nombre del formato y cantidad de huevos son obligatorios.');
      return;
    }

    const fData: FormatoEnvase = {
      id: formatoEditando ? formatoEditando.id : 'fmt-' + Date.now(),
      nombre: nombre.trim(),
      tipoEnvase,
      cantidadHuevos: Number(cantidadHuevos),
      calibreRecomendado,
      precioVenta: Number(precioVenta) || 0,
      costeEnvase: Number(costeEnvase) || 0,
      textoEtiqueta: textoEtiqueta.trim(),
      activo
    };

    if (formatoEditando) {
      onUpdateFormato(fData);
    } else {
      onAddFormato(fData);
    }
    setMostrarModal(false);
  };

  const handleEliminar = (fmt: FormatoEnvase) => {
    const tieneLotes = lotesEnvasados.some(l => l.formatoId === fmt.id);
    if (tieneLotes) {
      const confirmacion = window.confirm(
        `El formato "${fmt.nombre}" ha sido utilizado en órdenes de envasado existentes.\n\nPara no alterar el histórico de producción y facturación, se recomienda desactivarlo en lugar de borrarlo.\n\n¿Deseas marcarlo como Inactivo ahora?`
      );
      if (confirmacion) {
        onUpdateFormato({ ...fmt, activo: false });
      }
      return;
    }

    if (window.confirm(`¿Seguro que deseas eliminar el formato "${fmt.nombre}"?`)) {
      onDeleteFormato(fmt.id);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Encabezado y Métricas */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-stone-900 leading-tight">
                Formatos Comerciales de Envasado y Venta
              </h3>
              <p className="text-xs text-stone-500">
                Catálogo de estuches, bandejas y cajas: capacidades, precios recomendados, costes y calibres
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-700 hover:bg-amber-800 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Formato</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-stone-100 text-xs">
          <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-100">
            <span className="text-[10px] uppercase font-bold text-amber-900/80 block">Total Formatos</span>
            <strong className="text-lg font-black text-amber-950">{formatos.length}</strong>
          </div>
          <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
            <span className="text-[10px] uppercase font-bold text-stone-600 block">Formatos Activos</span>
            <strong className="text-lg font-black text-emerald-700">
              {formatos.filter(f => f.activo !== false).length}
            </strong>
          </div>
          <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
            <span className="text-[10px] uppercase font-bold text-stone-600 block">Capacidades</span>
            <strong className="text-xs sm:text-sm font-bold text-stone-800 block truncate">
              {Array.from(new Set(formatos.map(f => `${f.cantidadHuevos}h`))).join(', ')}
            </strong>
          </div>
          <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60">
            <span className="text-[10px] uppercase font-bold text-stone-600 block">Calibres Homologados</span>
            <strong className="text-xs sm:text-sm font-bold text-stone-800 block truncate">
              XL, L, M, S, MIX
            </strong>
          </div>
        </div>
      </div>

      {/* Grid de Formatos */}
      {formatos.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-2xl p-10 text-center space-y-3">
          <Package className="w-12 h-12 text-stone-300 mx-auto" />
          <h4 className="text-sm font-bold text-stone-800">No hay formatos comerciales registrados</h4>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            Configura tus formatos de venta (docenas, medias docenas, bandejas de 30) para poder envasar y facturar tus pedidos.
          </p>
          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs hover:bg-amber-800 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Crear Formato</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {formatos.map(fmt => {
            const margen = fmt.precioVenta - fmt.costeEnvase;
            const margenPorc = fmt.precioVenta > 0 ? Math.round((margen / fmt.precioVenta) * 100) : 0;
            const ordenesUso = lotesEnvasados.filter(l => l.formatoId === fmt.id).length;

            return (
              <div
                key={fmt.id}
                className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs bg-amber-100 text-amber-950 px-2 py-0.5 rounded-lg border border-amber-300">
                          {fmt.cantidadHuevos} huevos
                        </span>
                        <span className="font-bold text-xs bg-stone-100 text-stone-700 px-2 py-0.5 rounded-lg border border-stone-200">
                          Calibre {fmt.calibreRecomendado}
                        </span>
                        {fmt.activo === false && (
                          <span className="text-[10px] font-bold text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                            Inactivo
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-stone-900 text-base mt-2 leading-snug">
                        {fmt.nombre}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(fmt)}
                        className="p-1.5 text-stone-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        title="Modificar Formato"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEliminar(fmt)}
                        className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar o Desactivar Formato"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-stone-50 p-2.5 rounded-xl border border-stone-100 mt-3">
                    <div>
                      <span className="text-stone-400 block text-[10px] font-medium">Precio Venta (PVP):</span>
                      <strong className="text-base text-stone-900 font-black">
                        {fmt.precioVenta.toFixed(2)} €
                      </strong>
                      <span className="text-[10px] text-stone-400 block">sin IVA</span>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px] font-medium">Coste Envase:</span>
                      <strong className="text-base text-stone-700 font-bold">
                        {fmt.costeEnvase.toFixed(2)} €
                      </strong>
                      <span className="text-[10px] text-emerald-700 font-semibold block">
                        Margen: +{margen.toFixed(2)} € ({margenPorc}%)
                      </span>
                    </div>
                  </div>

                  {fmt.textoEtiqueta && (
                    <p className="text-[11px] italic text-stone-500 mt-2.5 line-clamp-2" title={fmt.textoEtiqueta}>
                      «{fmt.textoEtiqueta}»
                    </p>
                  )}
                </div>

                <div className="pt-3 mt-3 border-t border-stone-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-stone-500 capitalize">
                    {fmt.tipoEnvase.replace('_', ' ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenModal(fmt)}
                    className="text-amber-700 hover:text-amber-800 font-bold hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>Editar formato</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Crear / Editar Formato */}
      {mostrarModal && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-stone-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-700" />
                <h3 className="font-bold text-base text-stone-900">
                  {formatoEditando ? 'Modificar Formato Comercial' : 'Nuevo Formato Comercial'}
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
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Nombre del Formato *
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Estuche Docena Campero L"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-bold text-stone-900 focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Tipo de Envase *
                  </label>
                  <select
                    value={tipoEnvase}
                    onChange={e => setTipoEnvase(e.target.value as TipoEnvase)}
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-medium bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="estuche_carton">Estuche Cartón</option>
                    <option value="estuche_plastico">Estuche Plástico / PET</option>
                    <option value="bandeja_celulosa">Bandeja Celulosa (30)</option>
                    <option value="caja_granel">Caja Granel</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Huevos por Unidad *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={cantidadHuevos}
                    onChange={e => setCantidadHuevos(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="12"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Calibre
                  </label>
                  <select
                    value={calibreRecomendado}
                    onChange={e => setCalibreRecomendado(e.target.value as any)}
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="XL">XL (&gt;73g)</option>
                    <option value="L">L (63-73g)</option>
                    <option value="M">M (53-63g)</option>
                    <option value="S">S (&lt;53g)</option>
                    <option value="MIX">MIX Variado</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Precio Venta (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={precioVenta}
                    onChange={e => setPrecioVenta(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="2.80"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Coste Envase (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costeEnvase}
                    onChange={e => setCosteEnvase(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0.25"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-medium focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Texto Impreso en Etiqueta Oficial
                </label>
                <input
                  type="text"
                  value={textoEtiqueta}
                  onChange={e => setTextoEtiqueta(e.target.value)}
                  placeholder="Huevos frescos Clase A de gallinas camperas"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-medium focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={e => setActivo(e.target.checked)}
                    className="w-4 h-4 text-amber-600 rounded border-stone-300 focus:ring-amber-500"
                  />
                  <span className="font-semibold text-stone-700">Formato activo para envasado y ventas</span>
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
                  className="px-5 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-xl font-bold shadow-xs transition-colors"
                >
                  {formatoEditando ? 'Guardar Cambios' : 'Crear Formato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
