import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Albaran, Cliente } from '../../types';
import { formatearFechaES } from '../../utils/storage';

export interface FacturarAlbaranesTabProps {
  albaranes: Albaran[];
  clientes: Cliente[];
  clienteParaFacturar: string;
  setClienteParaFacturar: (id: string) => void;
  albaranesSeleccionadosIds: string[];
  setAlbaranesSeleccionadosIds: (ids: string[]) => void;
  onCrearFactura: () => void;
  isEmitiendoFactura: boolean;
}

export const FacturarAlbaranesTab: React.FC<FacturarAlbaranesTabProps> = ({
  albaranes,
  clientes,
  clienteParaFacturar,
  setClienteParaFacturar,
  albaranesSeleccionadosIds,
  setAlbaranesSeleccionadosIds,
  onCrearFactura,
  isEmitiendoFactura
}) => {
  const albaranesPendientes = albaranes.filter(
    a => a.estado === 'pendiente_facturar' && (!clienteParaFacturar || a.clienteId === clienteParaFacturar)
  );

  const toggleSeleccion = (id: string) => {
    if (albaranesSeleccionadosIds.includes(id)) {
      setAlbaranesSeleccionadosIds(albaranesSeleccionadosIds.filter(item => item !== id));
    } else {
      setAlbaranesSeleccionadosIds([...albaranesSeleccionadosIds, id]);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-stone-900">
            Facturación Agrupada de Albaranes
          </h3>
          <p className="text-xs text-stone-500">
            Selecciona los albaranes pendientes del mismo cliente para generar su factura oficial correspondiente.
          </p>
        </div>

        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
          <label className="block text-xs font-semibold text-stone-700 mb-1">
            Filtrar por Cliente:
          </label>
          <select
            value={clienteParaFacturar}
            onChange={e => setClienteParaFacturar(e.target.value)}
            className="w-full text-xs rounded-lg border border-stone-300 p-2 bg-white"
          >
            <option value="">Todos los clientes con albaranes pendientes</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Listado de albaranes pendientes seleccionables */}
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {albaranesPendientes.length === 0 ? (
            <p className="text-xs text-stone-400 text-center py-6">
              No hay albaranes pendientes de facturación para el cliente seleccionado.
            </p>
          ) : (
            albaranesPendientes.map(alb => {
              const estaSeleccionado = albaranesSeleccionadosIds.includes(alb.id);
              return (
                <div
                  key={alb.id}
                  onClick={() => toggleSeleccion(alb.id)}
                  className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition-colors ${
                    estaSeleccionado
                      ? 'bg-amber-50 border-amber-400'
                      : 'bg-white border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={estaSeleccionado}
                      onChange={() => {}}
                      className="rounded text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <strong className="font-mono text-stone-900 block">{alb.numeroAlbaran}</strong>
                      <span className="text-stone-500">{alb.clienteNombre} · {formatearFechaES(alb.fecha)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <strong className="text-stone-900 block">{alb.totales.totalDocumento.toFixed(2)} €</strong>
                    <span className="text-[10px] text-stone-400">{alb.lineas.length} líneas</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-stone-100">
          <span className="text-xs text-stone-600">
            Seleccionados: <strong>{albaranesSeleccionadosIds.length}</strong> albarán(es)
          </span>
          <button
            type="button"
            onClick={onCrearFactura}
            disabled={albaranesSeleccionadosIds.length === 0 || isEmitiendoFactura}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer inline-flex items-center gap-2"
          >
            {isEmitiendoFactura ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Emitiendo Factura...</span>
              </>
            ) : (
              <span>Generar Factura Recapitulativa</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
