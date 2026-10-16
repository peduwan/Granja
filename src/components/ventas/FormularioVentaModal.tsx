import React, { useState, useEffect } from 'react';
import { Receipt, X, Plus } from 'lucide-react';
import {
  Cliente,
  LoteEnvasado,
  FormatoEnvase,
  LineaDocumentoVenta,
  FormaPago,
  TotalesFiscales
} from '../../types';
import { calcularTotales, formatearFechaES } from '../../utils/storage';
import { AsistenteVozVenta, DatosVentaInterpretados } from '../AsistenteVozVenta';

export interface FormularioVentaModalProps {
  isOpen: boolean;
  onClose: () => void;
  tipoNuevoDoc: 'albaran' | 'factura_directa';
  setTipoNuevoDoc: (tipo: 'albaran' | 'factura_directa') => void;
  clientes: Cliente[];
  lotesEnvasados: LoteEnvasado[];
  formatos: FormatoEnvase[];
  numeroAlbaranSugerido: string;
  numeroFacturaSugerida: string;
  onGuardar: (datos: {
    tipo: 'albaran' | 'factura_directa';
    cliente: Cliente;
    fecha: string;
    formaPago: FormaPago;
    notas: string;
    lineas: LineaDocumentoVenta[];
    totales: TotalesFiscales;
    consumoEstuches: Record<string, number>;
  }) => Promise<void> | void;
  isEmitiendo?: boolean;
}

export const FormularioVentaModal: React.FC<FormularioVentaModalProps> = ({
  isOpen,
  onClose,
  tipoNuevoDoc,
  setTipoNuevoDoc,
  clientes,
  lotesEnvasados,
  formatos,
  numeroAlbaranSugerido,
  numeroFacturaSugerida,
  onGuardar,
  isEmitiendo = false
}) => {
  const hoy = new Date().toISOString().split('T')[0];
  const lotesConStock = lotesEnvasados.filter(l => l.estuchesDisponibles > 0);

  const [clienteId, setClienteId] = useState<string>(clientes[0]?.id || '');
  const [fechaDocumento, setFechaDocumento] = useState<string>(hoy);
  const [formaPago, setFormaPago] = useState<FormaPago>('transferencia');
  const [notas, setNotas] = useState<string>('');

  const [lineasVenta, setLineasVenta] = useState<Array<{
    loteEnvasadoId: string;
    cantidadEstuches: number;
    precioUnitario: number;
  }>>([]);

  useEffect(() => {
    if (clientes.length > 0 && !clienteId) {
      setClienteId(clientes[0].id);
    }
  }, [clientes, clienteId]);

  useEffect(() => {
    if (isOpen && lineasVenta.length === 0 && lotesConStock.length > 0) {
      const primerLote = lotesConStock[0];
      const formato = formatos.find(f => f.id === primerLote.formatoId);
      setLineasVenta([
        {
          loteEnvasadoId: primerLote.id,
          cantidadEstuches: Math.min(10, primerLote.estuchesDisponibles),
          precioUnitario: formato?.precioVenta || 2.50
        }
      ]);
    }
  }, [isOpen, lotesConStock, formatos]);

  if (!isOpen) return null;

  const clienteSeleccionado = clientes.find(c => c.id === clienteId) || clientes[0];

  const getCodigoPuestaDeLote = (le: LoteEnvasado): string => {
    const lotes = le.componentesLotes || le.consumoLotesPuesta;
    if (lotes && lotes.length > 0) {
      return lotes.map((c: any) => c.codigoLotePuesta).join(', ');
    }
    return le.codigoLotePuestaOrigen || 'PUESTA';
  };

  const addLinea = () => {
    const loteDisponible = lotesConStock.find(le => !lineasVenta.some(l => l.loteEnvasadoId === le.id)) || lotesConStock[0];
    if (!loteDisponible) return;

    const formato = formatos.find(f => f.id === loteDisponible.formatoId);
    setLineasVenta(prev => [
      ...prev,
      {
        loteEnvasadoId: loteDisponible.id,
        cantidadEstuches: Math.min(5, loteDisponible.estuchesDisponibles),
        precioUnitario: formato?.precioVenta || 2.50
      }
    ]);
  };

  const updateLinea = (index: number, campo: 'loteEnvasadoId' | 'cantidadEstuches' | 'precioUnitario', valor: any) => {
    setLineasVenta(prev => {
      const nuevas = [...prev];
      nuevas[index] = { ...nuevas[index], [campo]: valor };

      if (campo === 'loteEnvasadoId') {
        const nuevoLote = lotesEnvasados.find(le => le.id === valor);
        if (nuevoLote) {
          const formato = formatos.find(f => f.id === nuevoLote.formatoId);
          if (formato?.precioVenta) {
            nuevas[index].precioUnitario = formato.precioVenta;
          }
        }
      }
      return nuevas;
    });
  };

  const removeLinea = (index: number) => {
    if (lineasVenta.length <= 1) return;
    setLineasVenta(prev => prev.filter((_, i) => i !== index));
  };

  const lineasTotalesCalculo = lineasVenta.map(l => ({
    subtotal: Number(((l.cantidadEstuches || 0) * (l.precioUnitario || 0)).toFixed(2))
  }));

  const totalesCalculados = calcularTotales(
    lineasTotalesCalculo,
    Boolean(clienteSeleccionado?.recargoEquivalencia)
  );

  // Comprobar stock agrupado
  const consumoAgrupado = lineasVenta.reduce((acc, l) => {
    acc[l.loteEnvasadoId] = (acc[l.loteEnvasadoId] || 0) + (l.cantidadEstuches || 0);
    return acc;
  }, {} as Record<string, number>);

  const stockVentaSuficiente = Object.entries(consumoAgrupado).every(([id, cant]) => {
    const lote = lotesEnvasados.find(le => le.id === id);
    return lote && cant <= lote.estuchesDisponibles;
  });

  const aplicarDatosVoz = (datos: DatosVentaInterpretados) => {
    if (datos.clienteId) setClienteId(datos.clienteId);
    if (datos.formaPago) setFormaPago(datos.formaPago);
    if (datos.notas) setNotas(datos.notas);
    if (datos.tipoDocumento) setTipoNuevoDoc(datos.tipoDocumento);
    else if ((datos as any).tipoDoc) setTipoNuevoDoc((datos as any).tipoDoc);

    if (datos.lineas && datos.lineas.length > 0) {
      setLineasVenta(datos.lineas.map(dl => ({
        loteEnvasadoId: dl.loteEnvasadoId,
        cantidadEstuches: dl.cantidadEstuches,
        precioUnitario: dl.precioUnitario
      })));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteSeleccionado) return;

    if (!stockVentaSuficiente) {
      alert('Error: La cantidad de estuches supera el stock disponible en almacén para uno o varios lotes.');
      return;
    }

    if (lineasVenta.some(l => l.cantidadEstuches <= 0)) {
      alert('Error: Todas las líneas deben tener una cantidad de estuches superior a 0.');
      return;
    }

    // Construir líneas completas con trazabilidad sanitaria
    const lineasFinales: LineaDocumentoVenta[] = lineasVenta.map((l, idx) => {
      const lote = lotesEnvasados.find(le => le.id === l.loteEnvasadoId)!;
      const formato = formatos.find(f => f.id === lote.formatoId);

      const componentes = lote.componentesLotes || lote.consumoLotesPuesta;
      const trazabilidad = (componentes && componentes.length > 0)
        ? componentes.map((c: any) => ({
            codigoLotePuesta: c.codigoLotePuesta,
            huevosPorEstuche: formato?.cantidadHuevos || 12,
            totalHuevosEntregados: (formato?.cantidadHuevos || 12) * l.cantidadEstuches
          }))
        : [
            {
              codigoLotePuesta: lote.codigoLotePuestaOrigen || 'PUESTA',
              huevosPorEstuche: formato?.cantidadHuevos || 12,
              totalHuevosEntregados: (formato?.cantidadHuevos || 12) * l.cantidadEstuches
            }
          ];

      return {
        id: `lin-${Date.now()}-${idx}`,
        loteEnvasadoId: l.loteEnvasadoId,
        codigoLoteEnvasado: lote.codigoLoteEnvasado || lote.codigoLote || '',
        codigoLotePuesta: getCodigoPuestaDeLote(lote),
        formatoId: lote.formatoId,
        nombreFormato: lote.nombreFormato,
        cantidadEstuches: l.cantidadEstuches,
        precioUnitario: l.precioUnitario,
        subtotal: Number((l.cantidadEstuches * l.precioUnitario).toFixed(2)),
        fechaConsumoPreferente: lote.fechaConsumoPreferente,
        trazabilidadPuesta: trazabilidad,
        tipoIva: 4,
        tipoRecargo: clienteSeleccionado.recargoEquivalencia ? 0.5 : 0
      };
    });

    onGuardar({
      tipo: tipoNuevoDoc,
      cliente: clienteSeleccionado,
      fecha: fechaDocumento,
      formaPago,
      notas: notas.trim(),
      lineas: lineasFinales,
      totales: totalesCalculados,
      consumoEstuches: consumoAgrupado
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-base">Emitir Documento de Venta</h3>
              <p className="text-xs text-stone-500">Genera un albarán de entrega o una factura directa</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selector de Tipo de Documento */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setTipoNuevoDoc('albaran')}
            className={`py-2 rounded-lg transition-all ${
              tipoNuevoDoc === 'albaran'
                ? 'bg-white text-amber-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Albarán de Entrega ({numeroAlbaranSugerido})
          </button>
          <button
            type="button"
            onClick={() => setTipoNuevoDoc('factura_directa')}
            className={`py-2 rounded-lg transition-all ${
              tipoNuevoDoc === 'factura_directa'
                ? 'bg-white text-amber-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Factura Directa ({numeroFacturaSugerida})
          </button>
        </div>

        {/* Asistente de Voz Inteligente para Albaranes y Facturas */}
        <AsistenteVozVenta
          clientes={clientes}
          lotesEnvasados={lotesEnvasados}
          formatos={formatos}
          tipoDocActual={tipoNuevoDoc}
          onAplicarDatos={aplicarDatosVoz}
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Cliente Destinatario
              </label>
              <select
                value={clienteId}
                onChange={e => setClienteId(e.target.value)}
                className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
              >
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.cifNif})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Fecha del Documento
              </label>
              <input
                type="date"
                value={fechaDocumento}
                onChange={e => setFechaDocumento(e.target.value)}
                className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
              />
            </div>
          </div>

          {tipoNuevoDoc === 'factura_directa' && (
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Forma de Pago:</label>
              <select
                value={formaPago}
                onChange={e => setFormaPago(e.target.value as any)}
                className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-white font-medium"
              >
                <option value="transferencia">Transferencia Bancaria</option>
                <option value="efectivo">Contado / Efectivo</option>
                <option value="recibo_bancario">Recibo Bancario</option>
                <option value="bizum">Bizum</option>
                <option value="pagare">Pagaré</option>
              </select>
            </div>
          )}

          {/* Líneas de producto a expedir */}
          <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-800">Partidas y Estuches a Vender</span>
              <button
                type="button"
                onClick={addLinea}
                className="text-[11px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                + Añadir Línea
              </button>
            </div>

            <div className="space-y-2.5">
              {lineasVenta.map((l, index) => {
                const lote = lotesEnvasados.find(le => le.id === l.loteEnvasadoId);
                const precioActual = typeof l.precioUnitario === 'number' && !isNaN(l.precioUnitario) ? l.precioUnitario : 2.50;
                const subtotalLinea = Number(((l.cantidadEstuches || 0) * precioActual).toFixed(2));

                return (
                  <div key={index} className="p-3 bg-white rounded-xl border border-stone-200 text-xs space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-12 sm:col-span-6">
                        <label className="text-[10px] font-bold text-stone-500 uppercase block mb-1">
                          Lote de Puesta / Formato:
                        </label>
                        <select
                          value={l.loteEnvasadoId}
                          onChange={e => updateLinea(index, 'loteEnvasadoId', e.target.value)}
                          className="w-full text-xs rounded-lg border border-stone-300 p-2 bg-white font-medium text-stone-900"
                        >
                          {lotesConStock.map(le => {
                            const codPuesta = getCodigoPuestaDeLote(le);
                            return (
                              <option key={le.id} value={le.id}>
                                Lote Puesta: {codPuesta} · {le.nombreFormato} ({le.estuchesDisponibles} disp.)
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div className="col-span-4 sm:col-span-2">
                        <label className="text-[10px] font-bold text-stone-500 uppercase block mb-1">
                          Cant. (est.):
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={l.cantidadEstuches}
                          onChange={e => updateLinea(index, 'cantidadEstuches', parseInt(e.target.value) || 0)}
                          className="w-full text-xs font-bold rounded-lg border border-stone-300 p-2 text-stone-900"
                        />
                      </div>

                      <div className="col-span-4 sm:col-span-2">
                        <label className="text-[10px] font-bold text-stone-500 uppercase block mb-1">
                          Precio (€):
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.precioUnitario}
                          onChange={e => updateLinea(index, 'precioUnitario', parseFloat(e.target.value) || 0)}
                          className="w-full text-xs font-bold rounded-lg border border-stone-300 p-2 text-stone-900"
                        />
                      </div>

                      <div className="col-span-4 sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 pt-3 sm:pt-4">
                        <span className="font-mono font-bold text-stone-900 text-xs">
                          {subtotalLinea.toFixed(2)} €
                        </span>
                        {lineasVenta.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLinea(index)}
                            className="text-stone-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors"
                            title="Eliminar línea"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-stone-100 text-[11px] text-stone-500">
                      <span>
                        D.C.P. Lote: <strong className="text-red-700 font-mono">{formatearFechaES(lote?.fechaConsumoPreferente)}</strong>
                      </span>
                      <span>
                        Línea por Lote individualizada para albarán y factura
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Resumen de totales */}
            <div className="pt-2 border-t border-stone-200 flex justify-between items-center text-xs">
              <span className="text-stone-600">
                Base: <strong>{totalesCalculados.baseImponible.toFixed(2)} €</strong> · IVA: <strong>{totalesCalculados.cuotaIva.toFixed(2)} €</strong>
              </span>
              <span className="text-sm font-black text-amber-900">
                Total: {totalesCalculados.totalDocumento.toFixed(2)} €
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Notas u Observaciones
            </label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej: Entregado en muelle de carga central..."
              className="w-full text-xs rounded-xl border border-stone-300 p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isEmitiendo || !stockVentaSuficiente || lineasVenta.some(l => l.cantidadEstuches <= 0)}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm cursor-pointer"
            >
              {isEmitiendo ? 'Emitiendo...' : 'Guardar y Emitir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
