import React, { useState, useEffect } from 'react';
import {
  Factura,
  LineaDocumentoVenta,
  TipoRectificativa,
  ConfiguracionEmpresa,
  FiscalRecordRef,
  FiscalConfiguration
} from '../types';
import { AlertTriangle, X, Check, FileWarning, RotateCcw, Calculator, Plus, Trash2 } from 'lucide-react';
import {
  ModoRectificacionUI,
  ClaveTipoFacturaRectificativaAEAT,
  CodigoMotivoRectificativaUI,
  MOTIVOS_RECTIFICATIVA_AEAT,
  CLAVES_FACTURA_RECTIFICATIVA_AEAT,
  inferDefaultClaveRectificativa,
  computeInitialRectificativaLines,
  calculateRectificativaTotales,
  computeDefaultImporteRectificacion,
  buildRectificativaFacturaFromUiState
} from '../fiscal/rectificativaUiBuilder';
import { emitFiscalInvoiceViaBackend } from '../fiscal/fiscalApiClient';
import { createDefaultFiscalConfiguration } from '../fiscal/modelTransformers';
import { padNumero } from '../utils/storage';

interface ModalFacturaRectificativaProps {
  isOpen?: boolean;
  onClose: () => void;
  facturaOriginal: Factura | null;
  facturas?: Factura[];
  contadorRectificativa?: number;
  config?: ConfiguracionEmpresa;
  fiscalRecordRefs?: FiscalRecordRef[];
  fiscalConfig?: FiscalConfiguration;
  onEmitirRectificativa: (
    nuevaFactura: Factura,
    reingresarStock: boolean,
    fiscalRecordRef: FiscalRecordRef
  ) => Promise<void> | void;
}

export const ModalFacturaRectificativa: React.FC<ModalFacturaRectificativaProps> = ({
  isOpen = true,
  onClose,
  facturaOriginal,
  facturas = [],
  contadorRectificativa,
  config,
  fiscalRecordRefs,
  fiscalConfig,
  onEmitirRectificativa
}) => {
  const [modo, setModo] = useState<ModoRectificacionUI>('anulacion_total');
  const [tipoRectificativa, setTipoRectificativa] = useState<TipoRectificativa>('por_diferencias');
  const [claveTipoFactura, setClaveTipoFactura] = useState<ClaveTipoFacturaRectificativaAEAT>('R1');
  const [codigoMotivo, setCodigoMotivo] = useState<CodigoMotivoRectificativaUI>('01');
  const [motivoTexto, setMotivoTexto] = useState<string>('');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reingresarStock, setReingresarStock] = useState<boolean>(false);
  const [lineasRectificativa, setLineasRectificativa] = useState<LineaDocumentoVenta[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (facturaOriginal) {
      const initialModo: ModoRectificacionUI = 'anulacion_total';
      const initialTipoRect: TipoRectificativa = 'por_diferencias';
      const defaultClave = inferDefaultClaveRectificativa(facturaOriginal);

      setModo(initialModo);
      setTipoRectificativa(initialTipoRect);
      setClaveTipoFactura(defaultClave);
      setCodigoMotivo('01');
      setMotivoTexto('Error en la emisión original de la factura');
      setFecha(new Date().toISOString().split('T')[0]);
      setValidationError(null);
      setLineasRectificativa(
        computeInitialRectificativaLines(facturaOriginal, initialModo, initialTipoRect)
      );
    }
  }, [facturaOriginal, isOpen]);

  if (!isOpen || !facturaOriginal) return null;

  const handleModoChange = (nuevoModo: ModoRectificacionUI) => {
    setModo(nuevoModo);
    setValidationError(null);
    setLineasRectificativa(
      computeInitialRectificativaLines(facturaOriginal, nuevoModo, tipoRectificativa)
    );
  };

  const handleTipoRectificativaChange = (nuevoTipo: TipoRectificativa) => {
    setTipoRectificativa(nuevoTipo);
    setValidationError(null);
    setLineasRectificativa(
      computeInitialRectificativaLines(facturaOriginal, modo, nuevoTipo)
    );
  };

  const handleCodigoMotivoChange = (nuevoCodigo: CodigoMotivoRectificativaUI) => {
    setCodigoMotivo(nuevoCodigo);
    setValidationError(null);
    if (claveTipoFactura !== 'R5') {
      const found = MOTIVOS_RECTIFICATIVA_AEAT.find(m => m.codigo === nuevoCodigo);
      if (found) {
        setClaveTipoFactura(found.claveFacturaSugerida);
      }
    }
  };

  const handleUpdateLinea = (index: number, field: keyof LineaDocumentoVenta, value: any) => {
    setValidationError(null);
    const nuevas = [...lineasRectificativa];
    const linea = { ...nuevas[index], [field]: value };

    if (field === 'cantidadEstuches' || field === 'precioUnitario') {
      const cant = Number(linea.cantidadEstuches) || 0;
      const precio = Number(linea.precioUnitario) || 0;
      linea.subtotal = Number((cant * precio).toFixed(2));
    }

    nuevas[index] = linea;
    setLineasRectificativa(nuevas);
  };

  const handleRemoveLinea = (index: number) => {
    if (lineasRectificativa.length <= 1) {
      setValidationError('La factura rectificativa debe tener al menos una línea.');
      return;
    }
    setValidationError(null);
    setLineasRectificativa(lineasRectificativa.filter((_, i) => i !== index));
  };

  const handleAddLineaLibre = () => {
    setValidationError(null);
    const defaultCant = tipoRectificativa === 'por_diferencias' ? -1 : 1;
    setLineasRectificativa([
      ...lineasRectificativa,
      {
        id: `rect-lin-${Date.now()}`,
        loteEnvasadoId: 'N/A',
        codigoLoteEnvasado: 'AJUSTE',
        formatoId: 'FMT-AJUSTE',
        nombreFormato: 'Ajuste / Rectificación sobre factura ' + facturaOriginal.numeroFactura,
        cantidadEstuches: defaultCant,
        precioUnitario: 0,
        subtotal: 0,
        fechaConsumoPreferente: fecha,
        trazabilidadPuesta: []
      }
    ]);
  };

  const totales = calculateRectificativaTotales(facturaOriginal, lineasRectificativa);
  const defaultImporteRectificacion = computeDefaultImporteRectificacion(facturaOriginal);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    try {
      const anio = fecha.split('-')[0] || String(new Date().getFullYear());
      const numeroFacturaOverride =
        typeof contadorRectificativa === 'number'
          ? `R-${anio}-${padNumero(contadorRectificativa, 4)}`
          : undefined;

      const effectiveFiscalConfig: FiscalConfiguration =
        fiscalConfig ||
        createDefaultFiscalConfiguration({
          nif: config?.cifEmpresa || 'B12345678',
          nombreRazon: config?.nombreEmpresa || 'Granja Avícola S.L.'
        });

      const borradorFactura = buildRectificativaFacturaFromUiState({
        facturaOriginal,
        existingInvoices: facturas,
        numeroFacturaOverride,
        fecha,
        modo,
        tipoRectificativa,
        claveTipoFactura,
        codigoMotivo,
        motivoTexto,
        lineasEditadas: lineasRectificativa,
        nifEmisor: effectiveFiscalConfig.nifEmisor
      });

      setIsSubmitting(true);
      const emitted = await emitFiscalInvoiceViaBackend({
        invoiceDraft: borradorFactura,
        fiscalConfig: effectiveFiscalConfig
      });
      await onEmitirRectificativa(emitted.invoice, reingresarStock, emitted.fiscalRecordRef);
      onClose();
    } catch (err: any) {
      setValidationError(err?.message || 'Error al construir o emitir la factura rectificativa.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-stone-200 max-w-4xl w-full overflow-hidden my-8">
        {/* Header */}
        <div className="bg-amber-950 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-800/60 rounded-lg">
              <FileWarning className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Emitir Factura Rectificativa (Veri*Factu)</h2>
              <p className="text-xs text-amber-200/80">
                Rectificando Factura Original: <span className="font-mono font-bold text-white">{facturaOriginal.numeroFactura}</span> ({facturaOriginal.fecha}) - Cliente: {facturaOriginal.clienteNombre}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-amber-200 hover:text-white p-1 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Aviso Legal VeriFactu */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-bold">Normativa Antifraude (RD 1007/2023 - Orden HAC/1177/2024):</p>
              <p>
                Las facturas emitidas son inalterables y no pueden borrarse ni editarse. Este proceso generará un nuevo registro de facturación rectificativo (serie <strong>R-AAAA-XXXX</strong>) encadenado criptográficamente con huella SHA-256 al libro registro del obligado tributario.
              </p>
            </div>
          </div>

          {validationError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Selección de Modo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => handleModoChange('anulacion_total')}
              className={`p-4 rounded-xl border-2 text-left transition-all flex items-start gap-3 ${
                modo === 'anulacion_total'
                  ? 'border-red-600 bg-red-50/50 ring-2 ring-red-600/20'
                  : 'border-stone-200 hover:border-stone-300 bg-white'
              }`}
            >
              <div className={`p-2 rounded-lg ${modo === 'anulacion_total' ? 'bg-red-600 text-white' : 'bg-stone-100 text-stone-600'}`}>
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-stone-900 text-sm">Anulación Económica Total</div>
                <p className="text-xs text-stone-600 mt-1">
                  {tipoRectificativa === 'por_diferencias'
                    ? 'Genera una factura rectificativa por el 100% en signo negativo para dejar el saldo neto de la operación en 0,00 €.'
                    : 'Sustituye la factura original por un nuevo importe definitivo de 0,00 €, informando la base y cuota rectificadas.'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleModoChange('rectificacion_parcial')}
              className={`p-4 rounded-xl border-2 text-left transition-all flex items-start gap-3 ${
                modo === 'rectificacion_parcial'
                  ? 'border-amber-600 bg-amber-50/50 ring-2 ring-amber-600/20'
                  : 'border-stone-200 hover:border-stone-300 bg-white'
              }`}
            >
              <div className={`p-2 rounded-lg ${modo === 'rectificacion_parcial' ? 'bg-amber-600 text-white' : 'bg-stone-100 text-stone-600'}`}>
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-stone-900 text-sm">Rectificación Parcial / Ajuste de Líneas</div>
                <p className="text-xs text-stone-600 mt-1">
                  Permite modificar unidades o precios unitarios para abonar devoluciones parciales, roturas o errores de tarifa.
                </p>
              </div>
            </button>
          </div>

          {/* Parámetros Fiscales AEAT */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-stone-50 p-4 rounded-lg border border-stone-200">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Fecha de Expedición</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Clave TipoFactura AEAT</label>
              <select
                value={claveTipoFactura}
                onChange={(e) => setClaveTipoFactura(e.target.value as ClaveTipoFacturaRectificativaAEAT)}
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
              >
                {CLAVES_FACTURA_RECTIFICATIVA_AEAT.map((c) => (
                  <option key={c.clave} value={c.clave}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Mecanismo (TipoRectificativa)</label>
              <select
                value={tipoRectificativa}
                onChange={(e) => handleTipoRectificativaChange(e.target.value as TipoRectificativa)}
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
              >
                <option value="por_diferencias">Por Diferencias (Clave AEAT &apos;I&apos;)</option>
                <option value="por_sustitucion">Por Sustitución (Clave AEAT &apos;S&apos;)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Causa Reglamentaria (Art. 80 LIVA)</label>
              <select
                value={codigoMotivo}
                onChange={(e) => handleCodigoMotivoChange(e.target.value as CodigoMotivoRectificativaUI)}
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
              >
                {MOTIVOS_RECTIFICATIVA_AEAT.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Descripción detallada del motivo de rectificación (Obligatorio en XML y PDF)
              </label>
              <input
                type="text"
                value={motivoTexto}
                onChange={(e) => setMotivoTexto(e.target.value)}
                placeholder="Ej: Error en precio unitario aplicado en docenas XL o devolución de 2 cajas rotas..."
                required
                className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {tipoRectificativa === 'por_sustitucion' && (
              <div className="md:col-span-4 bg-amber-100/60 border border-amber-300 rounded-lg p-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold">Desglose de ImporteRectificacion (Obligatorio en Clave &apos;S&apos;):</span>{' '}
                  Se informará en el XML AEAT la base y cuota originales sustituidas de la factura {facturaOriginal.numeroFactura}.
                </div>
                <div className="font-mono font-semibold flex items-center gap-4">
                  <span>BaseRectificada: {defaultImporteRectificacion.baseRectificada.toFixed(2)} €</span>
                  <span>CuotaRectificada: {defaultImporteRectificacion.cuotaRectificada.toFixed(2)} €</span>
                  {defaultImporteRectificacion.cuotaRecargoRectificado !== undefined && (
                    <span>CuotaRecargoRectificado: {defaultImporteRectificacion.cuotaRecargoRectificado.toFixed(2)} €</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Líneas de la Rectificativa */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-stone-800">
                Líneas del Documento Rectificativo{' '}
                {modo === 'anulacion_total'
                  ? tipoRectificativa === 'por_diferencias'
                    ? '(Abono 100% por diferencias - Bloqueado)'
                    : '(Sustitución a 0,00 € - Bloqueado)'
                  : tipoRectificativa === 'por_diferencias'
                  ? '(Indique las diferencias en negativo o positivo)'
                  : '(Indique los nuevos importes finales que sustituyen a la factura original)'}
              </h3>
              {modo === 'rectificacion_parcial' && (
                <button
                  type="button"
                  onClick={handleAddLineaLibre}
                  className="text-xs flex items-center gap-1 bg-stone-100 hover:bg-stone-200 text-stone-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir línea de ajuste
                </button>
              )}
            </div>

            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-100 border-b border-stone-200 text-[11px] font-bold text-stone-600 uppercase">
                    <th className="py-2.5 px-3">Concepto / Descripción</th>
                    <th className="py-2.5 px-3 w-24">Cat.</th>
                    <th className="py-2.5 px-3 w-32 text-right">Cantidad</th>
                    <th className="py-2.5 px-3 w-32 text-right">Precio Unit. (€)</th>
                    <th className="py-2.5 px-3 w-32 text-right">Subtotal (€)</th>
                    {modo === 'rectificacion_parcial' && <th className="py-2.5 px-2 w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 text-sm">
                  {lineasRectificativa.map((linea, idx) => (
                    <tr key={linea.id} className="hover:bg-stone-50/80">
                      <td className="p-2">
                        <input
                          type="text"
                          value={linea.nombreFormato}
                          disabled={modo === 'anulacion_total'}
                          onChange={(e) => handleUpdateLinea(idx, 'nombreFormato', e.target.value)}
                          className="w-full px-2 py-1 border border-stone-200 rounded text-xs disabled:bg-stone-100"
                        />
                      </td>
                      <td className="p-2 text-xs font-medium text-stone-600">
                        {linea.codigoLoteEnvasado}
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          value={linea.cantidadEstuches}
                          disabled={modo === 'anulacion_total'}
                          onChange={(e) => handleUpdateLinea(idx, 'cantidadEstuches', parseFloat(e.target.value))}
                          className={`w-full px-2 py-1 border border-stone-200 rounded text-xs text-right font-mono font-bold disabled:bg-stone-100 ${
                            linea.cantidadEstuches < 0 ? 'text-red-600' : 'text-stone-800'
                          }`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          value={linea.precioUnitario}
                          disabled={modo === 'anulacion_total'}
                          onChange={(e) => handleUpdateLinea(idx, 'precioUnitario', parseFloat(e.target.value))}
                          className="w-full px-2 py-1 border border-stone-200 rounded text-xs text-right font-mono disabled:bg-stone-100"
                        />
                      </td>
                      <td className={`p-2 text-right font-mono font-bold text-xs ${linea.subtotal < 0 ? 'text-red-600' : 'text-stone-900'}`}>
                        {linea.subtotal.toFixed(2)} €
                      </td>
                      {modo === 'rectificacion_parcial' && (
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLinea(idx)}
                            className="text-stone-400 hover:text-red-600 p-1"
                            title="Eliminar línea"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Comparativa de Totales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-900 text-white p-4 rounded-xl">
            <div className="space-y-1 border-r border-stone-700 pr-4">
              <div className="text-xs text-stone-400 uppercase font-semibold">Factura Original ({facturaOriginal.numeroFactura})</div>
              <div className="flex justify-between text-xs text-stone-300">
                <span>Base Imponible Original:</span>
                <span className="font-mono">{facturaOriginal.totales.baseImponible.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-xs text-stone-300">
                <span>IVA ({facturaOriginal.totales.porcentajeIva}%):</span>
                <span className="font-mono">{facturaOriginal.totales.cuotaIva.toFixed(2)} €</span>
              </div>
              {facturaOriginal.totales.aplicaRecargo && (
                <div className="flex justify-between text-xs text-stone-300">
                  <span>Recargo Eq. ({facturaOriginal.totales.porcentajeRecargo}%):</span>
                  <span className="font-mono">{facturaOriginal.totales.cuotaRecargo.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-white pt-1 border-t border-stone-700">
                <span>Total Original:</span>
                <span className="font-mono">{facturaOriginal.totales.totalDocumento.toFixed(2)} €</span>
              </div>
            </div>

            <div className="space-y-1 pl-2">
              <div className="text-xs text-amber-400 uppercase font-semibold">
                Nueva Factura Rectificativa ({claveTipoFactura} · {tipoRectificativa === 'por_diferencias' ? 'Diferencias [I]' : 'Sustitución [S]'})
              </div>
              <div className="flex justify-between text-xs text-stone-300">
                <span>Base Imponible Rectificativa:</span>
                <span className="font-mono">{totales.baseImponible.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-xs text-stone-300">
                <span>Cuota IVA ({totales.porcentajeIva}%):</span>
                <span className="font-mono">{totales.cuotaIva.toFixed(2)} €</span>
              </div>
              {totales.aplicaRecargo && (
                <div className="flex justify-between text-xs text-stone-300">
                  <span>Cuota Recargo ({totales.porcentajeRecargo}%):</span>
                  <span className="font-mono">{totales.cuotaRecargo.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-amber-300 pt-1 border-t border-stone-700">
                <span>Total Documento Rectificativo:</span>
                <span className="font-mono">{totales.totalDocumento.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-xs text-emerald-400 pt-1">
                <span>Saldo Neto Resultante de la Operación:</span>
                <span className="font-mono font-bold">
                  {tipoRectificativa === 'por_diferencias'
                    ? (facturaOriginal.totales.totalDocumento + totales.totalDocumento).toFixed(2)
                    : totales.totalDocumento.toFixed(2)}{' '}
                  €
                </span>
              </div>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2 shadow-sm transition-colors"
            >
              <Check className="w-4 h-4" />
              {isSubmitting ? 'Sellando y Emitiendo...' : 'Firmar y Emitir Factura Rectificativa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
