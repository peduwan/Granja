import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, FileText, Check, ArrowRight, RotateCcw, X, Info } from 'lucide-react';
import {
  Factura,
  LineaDocumentoVenta,
  TipoRectificativa,
  ConfiguracionEmpresa,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration
} from '../types';
import { padNumero, formatearFechaES, calcularTotales, getDefaultFiscalConfig } from '../utils/storage';
import { emitFiscalInvoiceViaBackend } from '../fiscal/fiscalApiClient';

interface ModalFacturaRectificativaProps {
  facturaOriginal: Factura | null;
  onClose: () => void;
  onEmitirRectificativa: (nuevaRectificativa: Factura, reingresarStock: boolean, nuevoFiscalRecordRef: FiscalRecordRef) => Promise<void> | void;
  contadorRectificativa: number;
  config: ConfiguracionEmpresa;
  ultimoHash?: string;
  fiscalRecordRefs?: FiscalRecordRef[];
  fiscalConfig?: FiscalConfiguration;
}

export const ModalFacturaRectificativa: React.FC<ModalFacturaRectificativaProps> = ({
  facturaOriginal,
  onClose,
  onEmitirRectificativa,
  contadorRectificativa,
  config,
  ultimoHash,
  fiscalRecordRefs,
  fiscalConfig
}) => {
  if (!facturaOriginal) return null;

  const anioActual = new Date().getFullYear();
  const numeroSiguiente = `R-${anioActual}-${padNumero(contadorRectificativa, 4)}`;
  const hoy = new Date().toISOString().split('T')[0];

  const [tipoRectificativa, setTipoRectificativa] = useState<TipoRectificativa>('por_sustitucion');
  const [codigoMotivo, setCodigoMotivo] = useState<'01' | '02' | '03' | '04'>('01');
  const [motivoTexto, setMotivoTexto] = useState('');
  const [reingresarStock, setReingresarStock] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Líneas modificadas para 'por_diferencias' o importes negativos
  const [lineasRectificadas, setLineasRectificadas] = useState<LineaDocumentoVenta[]>(() => {
    // Por defecto para sustitución/anulación total, genera importes en negativo
    return facturaOriginal.lineas.map(l => ({
      ...l,
      id: `rect_${l.id}_${Date.now()}`,
      cantidadEstuches: -l.cantidadEstuches,
      subtotal: Number((-l.subtotal).toFixed(2))
    }));
  });

  const cambiarModo = (modo: TipoRectificativa) => {
    setTipoRectificativa(modo);
    if (modo === 'por_sustitucion') {
      // Anulación / sustitución total: importes compensatorios negativos
      setLineasRectificadas(
        facturaOriginal.lineas.map(l => ({
          ...l,
          id: `rect_${l.id}_${Date.now()}`,
          cantidadEstuches: -Math.abs(l.cantidadEstuches),
          subtotal: Number((-Math.abs(l.subtotal)).toFixed(2))
        }))
      );
    } else {
      // Por diferencias: inicia en 0 para que el usuario indique la diferencia
      setLineasRectificadas(
        facturaOriginal.lineas.map(l => ({
          ...l,
          id: `rect_${l.id}_${Date.now()}`,
          cantidadEstuches: 0,
          subtotal: 0
        }))
      );
    }
  };

  const actualizarCantidadDiferencia = (idx: number, cantidad: number) => {
    setLineasRectificadas(prev => {
      const copy = [...prev];
      const precio = copy[idx].precioUnitario;
      copy[idx] = {
        ...copy[idx],
        cantidadEstuches: cantidad,
        subtotal: Number((cantidad * precio).toFixed(2))
      };
      return copy;
    });
  };

  const totales = calcularTotales(lineasRectificadas, facturaOriginal.clienteRecargoEquivalencia);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivoTexto.trim()) {
      alert('Por favor, describe el motivo de la rectificación según exige la normativa.');
      return;
    }

    setGuardando(true);
    try {
      const tipoDocAEAT = 'R1'; // R1: Rectificativa estándar por error / devolución

      // FASE 1.3: Emisión fiscal centralizada. El registro anterior se resuelve unívocamente dentro de la sección serializada.
      const invoiceDraft: Factura = {
        id: `fac_rect_${Date.now()}`,
        numeroFactura: numeroSiguiente,
        fecha: hoy,
        clienteId: facturaOriginal.clienteId,
        clienteNombre: facturaOriginal.clienteNombre,
        clienteCif: facturaOriginal.clienteCif,
        clienteDireccion: facturaOriginal.clienteDireccion,
        clienteRecargoEquivalencia: facturaOriginal.clienteRecargoEquivalencia,
        albaranesAsociados: [],
        lineas: lineasRectificadas,
        totales,
        estadoPago: 'pagada', // compensada
        formaPago: facturaOriginal.formaPago,
        esVentaDirecta: true,
        notas: `Factura Rectificativa de la factura ${facturaOriginal.numeroFactura}. Motivo: ${motivoTexto}`,
        creadoEn: hoy,
        tipoFactura: tipoDocAEAT,
        esRectificativa: true,
        facturaRectificadaId: facturaOriginal.id,
        facturaRectificadaNumero: facturaOriginal.numeroFactura,
        facturaRectificadaFecha: facturaOriginal.fecha,
        tipoRectificativa,
        motivoRectificativa: motivoTexto,
        codigoMotivoRectificativa: codigoMotivo
      };

      const effectiveFiscalConfig: FiscalConfiguration = fiscalConfig || getDefaultFiscalConfig(config.cifEmpresa, config.nombreEmpresa);

      const { invoice: nuevaFacturaRectificativa, fiscalRecordRef } = await emitFiscalInvoiceViaBackend({
        invoiceDraft,
        fiscalConfig: effectiveFiscalConfig
      });

      await onEmitirRectificativa(nuevaFacturaRectificativa, reingresarStock, fiscalRecordRef);
      onClose();
    } catch (err: any) {
      console.error('Error emitiendo factura rectificativa:', err);
      alert('Error al emitir factura rectificativa: ' + (err.message || 'Error desconocido'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between border-b border-stone-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-base">
                Emitir Factura Rectificativa
              </h3>
              <p className="text-xs text-stone-500">
                Normativa Ley Antifraude / Veri*Factu (RD 1007/2023)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-lg font-bold px-2 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Banner Legal */}
        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong className="block font-semibold">Inmutabilidad de la Factura Original</strong>
            <span>
              La factura original <strong>{facturaOriginal.numeroFactura}</strong> quedará conservada de forma inmutable. Se expedirá un nuevo documento con serie rectificativa <strong>{numeroSiguiente}</strong> encadenado a la huella criptográfica SHA-256.
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Datos Identificativos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-stone-50 rounded-xl border border-stone-200">
            <div>
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Factura Rectificada:</span>
              <strong className="text-sm font-mono text-stone-900 block">{facturaOriginal.numeroFactura}</strong>
              <span className="text-stone-500 block">Fecha: {formatearFechaES(facturaOriginal.fecha)}</span>
              <span className="text-stone-600 block truncate">{facturaOriginal.clienteNombre}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Nueva Serie / Número:</span>
              <strong className="text-sm font-mono text-amber-900 block">{numeroSiguiente}</strong>
              <span className="text-stone-500 block">Fecha de expedición: {formatearFechaES(hoy)}</span>
              <span className="text-[11px] text-stone-600 block">Hash encadenado a última factura</span>
            </div>
          </div>

          {/* Método de Rectificación */}
          <div className="space-y-1.5">
            <label className="font-bold text-stone-700 block">Método de Rectificación Legal:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => cambiarModo('por_sustitucion')}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  tipoRectificativa === 'por_sustitucion'
                    ? 'border-amber-500 bg-amber-50/80 ring-1 ring-amber-500'
                    : 'border-stone-200 bg-white hover:bg-stone-50'
                }`}
              >
                <strong className="block text-stone-900 text-xs">Por Sustitución / Anulación Total</strong>
                <span className="text-[11px] text-stone-500 block mt-0.5">
                  Anula completamente el importe de la factura original para cancelar la operación.
                </span>
              </button>

              <button
                type="button"
                onClick={() => cambiarModo('por_diferencias')}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  tipoRectificativa === 'por_diferencias'
                    ? 'border-amber-500 bg-amber-50/80 ring-1 ring-amber-500'
                    : 'border-stone-200 bg-white hover:bg-stone-50'
                }`}
              >
                <strong className="block text-stone-900 text-xs">Por Diferencias</strong>
                <span className="text-[11px] text-stone-500 block mt-0.5">
                  Corrige sólo la diferencia en unidades, precios o descuentos aplicados.
                </span>
              </button>
            </div>
          </div>

          {/* Motivo según AEAT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-stone-700 block">Causa de Rectificación (Clave AEAT):</label>
              <select
                value={codigoMotivo}
                onChange={e => setCodigoMotivo(e.target.value as any)}
                className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-stone-800 text-xs font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="01">01 - Error fundado en derecho / Art. 80.Uno LIVA</option>
                <option value="02">02 - Devolución de mercancías o envases</option>
                <option value="03">03 - Descuentos o bonificaciones posteriores</option>
                <option value="04">04 - Resto de causas / Anulación por emisión errónea</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-stone-700 block">Devolución a Stock de Almacén:</label>
              <label className="flex items-center gap-2 p-2 bg-stone-50 border border-stone-200 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={reingresarStock}
                  onChange={e => setReingresarStock(e.target.checked)}
                  className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-stone-700 text-xs">
                  Reincorporar estuches rectificados al inventario disponible
                </span>
              </label>
            </div>
          </div>

          {/* Explicación Detallada Obligatoria */}
          <div className="space-y-1">
            <label className="font-bold text-stone-700 block">
              Descripción del Motivo de la Rectificación <span className="text-red-500">*</span>:
            </label>
            <input
              type="text"
              required
              value={motivoTexto}
              onChange={e => setMotivoTexto(e.target.value)}
              placeholder="Ej: Anulación por error en los datos de facturación del cliente..."
              className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-stone-800 text-xs focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Partidas / Importes Rectificados */}
          <div className="space-y-1.5">
            <span className="font-bold text-stone-700 block">Desglose de Partidas a Rectificar:</span>
            <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 max-h-48 overflow-y-auto">
              {lineasRectificadas.map((linea, idx) => (
                <div key={linea.id} className="p-2.5 flex items-center justify-between gap-3 text-xs bg-stone-50/50">
                  <div className="min-w-0">
                    <strong className="text-stone-900 block truncate">{linea.nombreFormato}</strong>
                    <span className="text-[11px] text-stone-500 font-mono">
                      Lote Puesta: {linea.codigoLotePuesta || 'N/A'} • {linea.precioUnitario.toFixed(2)} €/est.
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {tipoRectificativa === 'por_diferencias' ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-stone-500">Dif. Estuches:</span>
                        <input
                          type="number"
                          step="1"
                          value={linea.cantidadEstuches}
                          onChange={e => actualizarCantidadDiferencia(idx, parseInt(e.target.value) || 0)}
                          className="w-18 bg-white border border-stone-300 rounded px-1.5 py-1 text-right font-mono font-bold"
                        />
                      </div>
                    ) : (
                      <span className="font-bold font-mono text-stone-700 bg-stone-100 px-2 py-0.5 rounded">
                        {linea.cantidadEstuches} est.
                      </span>
                    )}

                    <span className={`font-mono font-black text-xs px-2 py-1 rounded ${
                      linea.subtotal < 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-stone-100 text-stone-800'
                    }`}>
                      {linea.subtotal.toFixed(2)} €
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totales Rectificativa */}
          <div className="flex justify-between items-center bg-stone-100 p-3 rounded-xl border border-stone-200">
            <span className="text-xs text-stone-600 font-semibold">Total Documento Rectificativo:</span>
            <span className={`text-base font-black font-mono ${
              totales.totalDocumento < 0 ? 'text-red-700' : 'text-stone-900'
            }`}>
              {totales.totalDocumento.toFixed(2)} €
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              {guardando ? (
                <span>Sellando Criptográficamente...</span>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Emitir Factura Rectificativa</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
