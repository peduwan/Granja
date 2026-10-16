import React from 'react';
import {
  Receipt,
  Plus,
  Printer,
  Trash2,
  Calendar,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  RefreshCw,
  Mic
} from 'lucide-react';
import { Albaran, Cliente, Factura } from '../../types';
import { formatearFechaES, desglosarLineasPorLote } from '../../utils/storage';

export interface TablaAlbaranesProps {
  albaranes: Albaran[];
  clientes: Cliente[];
  facturas: Factura[];
  filtroCliente: string;
  setFiltroCliente: (id: string) => void;
  filtroEstadoAlbaran: 'todos' | 'pendiente' | 'facturado';
  setFiltroEstadoAlbaran: (estado: 'todos' | 'pendiente' | 'facturado') => void;
  docsExpandidos: Record<string, boolean>;
  toggleExpandir: (id: string) => void;
  onNuevoAlbaran: () => void;
  onImprimirAlbaran: (albaran: Albaran) => void;
  onFacturarAlbaranDirecto: (albaranId: string) => void;
  onDeleteAlbaran: (id: string) => void;
  isEmitiendoFactura: boolean;
}

export const TablaAlbaranes: React.FC<TablaAlbaranesProps> = ({
  albaranes,
  clientes,
  facturas,
  filtroCliente,
  setFiltroCliente,
  filtroEstadoAlbaran,
  setFiltroEstadoAlbaran,
  docsExpandidos,
  toggleExpandir,
  onNuevoAlbaran,
  onImprimirAlbaran,
  onFacturarAlbaranDirecto,
  onDeleteAlbaran,
  isEmitiendoFactura
}) => {
  const albaranesFiltrados = albaranes.filter(a => {
    if (filtroCliente !== 'todos' && a.clienteId !== filtroCliente) return false;
    if (filtroEstadoAlbaran === 'pendiente' && a.estado !== 'pendiente_facturar') return false;
    if (filtroEstadoAlbaran === 'facturado' && a.estado !== 'facturado') return false;
    return true;
  });

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
          <Receipt className="w-3.5 h-3.5 text-amber-600" />
          <span>Albaranes ({albaranesFiltrados.length})</span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filtroCliente}
            onChange={e => setFiltroCliente(e.target.value)}
            className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
          >
            <option value="todos">Todos los Clientes</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>

          <select
            value={filtroEstadoAlbaran}
            onChange={e => setFiltroEstadoAlbaran(e.target.value as any)}
            className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
          >
            <option value="todos">Todos los Estados</option>
            <option value="pendiente">Pendientes de Facturar</option>
            <option value="facturado">Facturados</option>
          </select>

          <button
            type="button"
            onClick={onNuevoAlbaran}
            className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg px-2.5 py-1.5 font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
            title="Crear o dictar nuevo albarán"
          >
            <Mic className="w-3.5 h-3.5 text-amber-700" />
            <span>Dictar Albarán</span>
          </button>
        </div>
      </div>

      {albaranesFiltrados.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
            <Receipt className="w-6 h-6" />
          </div>
          <h3 className="text-stone-800 font-bold text-sm">No hay albaranes registrados</h3>
          <p className="text-stone-500 text-xs max-w-sm mx-auto">
            No se encontraron albaranes con los filtros actuales. Pulsa <strong className="text-amber-700 font-semibold">+</strong> para registrar una entrega.
          </p>
          <button
            type="button"
            onClick={onNuevoAlbaran}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Crear Primer Albarán</span>
          </button>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
          {albaranesFiltrados.map(alb => {
            const estaExpandido = Boolean(docsExpandidos[alb.id]);
            const totalEstuches = alb.lineas.reduce((acc, l) => acc + l.cantidadEstuches, 0);

            return (
              <div key={alb.id} className="transition-colors hover:bg-amber-50/30">
                <div
                  onClick={() => toggleExpandir(alb.id)}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-amber-100/90 border border-amber-200 text-amber-800 flex items-center justify-center shrink-0 shadow-xs">
                      <Receipt className="w-5 h-5 text-amber-700" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-stone-900 text-sm tracking-tight font-mono">
                          {alb.numeroAlbaran}
                        </span>
                        <span className="text-xs font-semibold text-stone-700 truncate max-w-[180px]">
                          {alb.clienteNombre}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                          alb.estado === 'pendiente_facturar'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {alb.estado === 'pendiente_facturar' ? 'Pendiente' : 'Facturado'}
                        </span>
                      </div>
                      <p className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                        <Calendar className="w-3 h-3 text-stone-400" />
                        <span>Fecha: {formatearFechaES(alb.fecha)}</span>
                        <span>•</span>
                        <span>{totalEstuches} estuches entregados</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right shrink-0">
                    <div>
                      <span className="text-sm font-black text-stone-900 block">
                        {alb.totales.totalDocumento.toFixed(2)} €
                      </span>
                      <span className="text-[11px] text-stone-500 font-medium block">
                        Base: {alb.totales.baseImponible.toFixed(2)} €
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
                    <div className="bg-white p-3 rounded-xl border border-stone-200 space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-stone-500 block">
                        Líneas de Entrega y Trazabilidad:
                      </span>
                      <div className="space-y-1">
                        {desglosarLineasPorLote(alb.lineas).map((linea, idx) => (
                          <div key={idx} className="flex flex-wrap justify-between items-center text-xs p-2 bg-stone-50 rounded-lg gap-2">
                            <div className="space-y-0.5">
                              <strong className="text-stone-900 block">{linea.nombreFormato}</strong>
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="font-mono text-amber-900 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                  Lote Puesta: {linea.codigoLotePuesta}
                                </span>
                                {linea.fechaConsumoPreferente && (
                                  <span className="text-stone-500 font-mono">
                                    DCP: {formatearFechaES(linea.fechaConsumoPreferente)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex items-center gap-3">
                              <div>
                                <span className="font-bold text-stone-900 block">{linea.cantidadEstuches} est.</span>
                                <span className="text-[11px] text-stone-500">{linea.precioUnitario.toFixed(2)} €/est.</span>
                              </div>
                              <span className="font-black text-amber-950 font-mono text-sm bg-white px-2 py-1 rounded border border-stone-200">
                                {linea.subtotal.toFixed(2)} €
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onImprimirAlbaran(alb);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-amber-700" />
                        <span>Imprimir Albarán</span>
                      </button>

                      {alb.estado === 'pendiente_facturar' && !alb.facturaId && !facturas.some(f => f.albaranesAsociados?.some(a => a.id === alb.id || a.numeroAlbaran === alb.numeroAlbaran)) && (
                        <button
                          type="button"
                          disabled={isEmitiendoFactura}
                          onClick={(e) => {
                            e.stopPropagation();
                            onFacturarAlbaranDirecto(alb.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs"
                          title="Generar factura oficial Veri*Factu para este albarán"
                        >
                          {isEmitiendoFactura ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Facturando...</span>
                            </>
                          ) : (
                            <>
                              <Receipt className="w-3.5 h-3.5" />
                              <span>Facturar este Albarán</span>
                            </>
                          )}
                        </button>
                      )}

                      {alb.estado === 'facturado' || Boolean(alb.facturaId) || facturas.some(f => f.albaranesAsociados?.some(a => a.id === alb.id || a.numeroAlbaran === alb.numeroAlbaran)) ? (
                        <div
                          className="inline-flex items-center gap-1.5 text-xs text-stone-500 bg-stone-100 border border-stone-200/90 px-3 py-1.5 rounded-lg select-none"
                          title="No se puede eliminar: Albarán facturado. La normativa tributaria oficial (Ley Antifraude / Veri*Factu) prohíbe eliminar o alterar operaciones facturadas."
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>Facturado ({alb.numeroFactura || 'Factura vinculada'}) · No eliminable</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`¿Eliminar el albarán ${alb.numeroAlbaran}? Se reintegrará el stock de estuches a los lotes envasados.`)) {
                              onDeleteAlbaran(alb.id);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Eliminar Albarán</span>
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
};
