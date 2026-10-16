import React from 'react';
import { Printer, X, RotateCcw, QrCode } from 'lucide-react';
import { Albaran, Factura, ConfiguracionEmpresa } from '../../types';
import { formatearFechaES, desglosarLineasPorLote } from '../../utils/storage';

export interface DocumentoImprimirModalProps {
  documento: { tipo: 'albaran' | 'factura'; doc: Albaran | Factura } | null;
  config: ConfiguracionEmpresa;
  onClose: () => void;
}

export const DocumentoImprimirModal: React.FC<DocumentoImprimirModalProps> = ({
  documento,
  config,
  onClose
}) => {
  if (!documento) return null;

  const { tipo, doc } = documento;
  const esFactura = tipo === 'factura';
  const factura = esFactura ? (doc as Factura) : null;
  const esRectificativa = Boolean(factura?.esRectificativa);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto print-modal-overlay">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl space-y-6 my-auto print-container">
        {/* Barra superior de acciones para pantalla (oculta al imprimir) */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-200 no-print">
          <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
            Vista Previa de Impresión Oficial ({tipo === 'albaran' ? 'Albarán' : 'Factura'})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg cursor-pointer"
              title="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* CABECERA OFICIAL DEL DOCUMENTO */}
        <div className="border-b-2 border-stone-800 pb-4 flex justify-between items-start gap-4">
          <div>
            <h1 className="text-xl font-black text-stone-900 tracking-tight uppercase">
              {config.nombreEmpresa || 'Granja Avícola El Valle S.L.'}
            </h1>
            <p className="text-xs text-stone-700 mt-1 font-mono">CIF: {config.cifEmpresa || 'SIN CIF REGISTRADO'}</p>
            {config.registroSanitario && (
              <p className="text-xs text-stone-600 font-mono font-medium">RGSEAA: {config.registroSanitario}</p>
            )}
            {config.codigoREGA && (
              <p className="text-xs text-stone-600 font-mono">REGA Explotación: {config.codigoREGA}</p>
            )}
            <p className="text-xs text-stone-600 mt-0.5">
              {config.direccionEmpresa || 'Camino de las Huertas, km 2.4'} - {config.poblacionEmpresa || 'Toledo'} ({config.codigoPostalEmpresa || '45005'})
            </p>
            {config.telefonoEmpresa && <p className="text-xs text-stone-500">Teléfono: {config.telefonoEmpresa}</p>}
          </div>
          <div className="text-right">
            <span className="text-xs uppercase font-black bg-stone-900 text-white px-3 py-1.5 rounded inline-block tracking-wider">
              {tipo === 'albaran' ? 'ALBARÁN OFICIAL DE ENTREGA' : 'FACTURA COMERCIAL'}
            </span>
            <span className="text-base font-mono font-bold text-stone-900 block mt-2">
              {'numeroAlbaran' in doc ? doc.numeroAlbaran : doc.numeroFactura}
            </span>
            <span className="text-xs text-stone-600 block mt-0.5">
              Fecha de Emisión: <strong>{formatearFechaES(doc.fecha)}</strong>
            </span>
            {'formaPago' in doc && doc.formaPago && (
              <span className="text-xs text-stone-600 block mt-0.5">
                Forma de Pago: <span className="uppercase font-semibold">{doc.formaPago}</span>
              </span>
            )}
          </div>
        </div>

        {/* Datos del cliente destinatario */}
        <div className="grid grid-cols-2 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-200 text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
              Destinatario / Facturar a:
            </span>
            <strong className="text-sm text-stone-900 block mt-0.5">{doc.clienteNombre}</strong>
            <span className="text-stone-700 block mt-0.5 font-mono">CIF/NIF: {doc.clienteCif}</span>
            <span className="text-stone-600 block mt-0.5">{doc.clienteDireccion}</span>
          </div>
          <div className="text-right space-y-1">
            <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">
              Régimen Fiscal:
            </span>
            <span className="inline-block px-2 py-0.5 text-[11px] rounded font-medium bg-stone-200 text-stone-800">
              {doc.clienteRecargoEquivalencia
                ? 'Recargo de Equivalencia (IVA 4% + RE 0.5%)'
                : 'Régimen General IVA (4%)'}
            </span>
            {'albaranesAsociados' in doc && doc.albaranesAsociados && doc.albaranesAsociados.length > 0 && (
              <p className="text-[11px] text-stone-600 pt-1">
                Albaranes referenciados:{' '}
                {doc.albaranesAsociados
                  .map(a => `${a.numeroAlbaran} (${formatearFechaES(a.fecha)})`)
                  .join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Mención obligatoria de Rectificación si es Factura Rectificativa */}
        {esFactura && esRectificativa && factura && (
          <div className="p-3 bg-amber-50/80 rounded-xl border-2 border-amber-300 text-xs text-amber-950 space-y-1">
            <div className="font-black uppercase tracking-wider text-[10px] text-amber-900 flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Factura Rectificativa conforme a la Ley Antifraude y Art. 15 RD 1619/2012</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-stone-500">Factura Original Rectificada: </span>
                <strong className="font-mono text-stone-900">{factura.facturaRectificadaNumero}</strong>
                {factura.facturaRectificadaFecha && (
                  <span className="text-stone-600 font-mono"> ({formatearFechaES(factura.facturaRectificadaFecha)})</span>
                )}
              </div>
              <div>
                <span className="text-stone-500">Modalidad: </span>
                <strong className="text-stone-900">
                  {factura.tipoRectificativa === 'sustitucion' || factura.tipoRectificativa === 'por_sustitucion'
                    ? 'Por Sustitución'
                    : 'Por Diferencias'}
                </strong>
              </div>
            </div>
            {factura.motivoRectificativa && (
              <div className="text-[11px] pt-0.5 border-t border-amber-200/60">
                <span className="text-stone-500">Causa de rectificación: </span>
                <span className="italic text-stone-800">{factura.motivoRectificativa}</span>
              </div>
            )}
          </div>
        )}

        {/* Tabla de líneas y trazabilidad sanitaria - Una línea por lote */}
        <div>
          <table className="w-full text-xs text-left border-collapse border border-stone-300">
            <thead>
              <tr className="border-b-2 border-stone-800 bg-stone-100 font-bold text-stone-900">
                <th className="py-2.5 px-2">Descripción del Producto</th>
                <th className="py-2.5 px-2 font-mono">Código de Puesta (Lote)</th>
                <th className="py-2.5 px-2 text-center">D.C.P.</th>
                <th className="py-2.5 px-2 text-right">Cantidad</th>
                <th className="py-2.5 px-2 text-right">Precio Unit.</th>
                <th className="py-2.5 px-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {desglosarLineasPorLote(doc.lineas).map((l, i) => (
                <tr key={i} className="hover:bg-stone-50">
                  <td className="py-2 px-2">
                    <span className="font-bold text-stone-950 block">{l.nombreFormato}</span>
                  </td>
                  <td className="py-2 px-2 font-mono font-bold text-stone-900">
                    {l.codigoLotePuesta}
                  </td>
                  <td className="py-2 px-2 text-center font-mono font-bold text-red-700">
                    {formatearFechaES(l.fechaConsumoPreferente)}
                  </td>
                  <td className="py-2 px-2 text-right font-semibold text-stone-800">{l.cantidadEstuches} est.</td>
                  <td className="py-2 px-2 text-right">{l.precioUnitario.toFixed(2)} €</td>
                  <td className="py-2 px-2 text-right font-bold text-stone-950">{l.subtotal.toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Desglose Fiscal Completo */}
        <div className="flex justify-end pt-2">
          <div className="w-72 space-y-1.5 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
            <div className="flex justify-between text-stone-600">
              <span>Base Imponible:</span>
              <span className="font-mono font-semibold">{doc.totales.baseImponible.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-stone-600">
              <span>IVA ({doc.totales.porcentajeIva}%):</span>
              <span className="font-mono font-semibold">{doc.totales.cuotaIva.toFixed(2)} €</span>
            </div>
            {doc.clienteRecargoEquivalencia && (
              <div className="flex justify-between text-stone-600">
                <span>Recargo Eq. ({doc.totales.porcentajeRecargo}%):</span>
                <span className="font-mono font-semibold">{doc.totales.cuotaRecargo.toFixed(2)} €</span>
              </div>
            )}
            <div className="flex justify-between text-stone-950 pt-2 border-t-2 border-stone-800 text-sm font-black">
              <span>TOTAL A PAGAR:</span>
              <span className="font-mono text-amber-950 text-base">{doc.totales.totalDocumento.toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {doc.notas && (
          <div className="text-xs text-stone-600 p-2.5 bg-stone-50 rounded-lg border border-stone-200">
            <strong className="text-stone-800">Observaciones:</strong> {doc.notas}
          </div>
        )}

        {/* SECCIÓN OFICIAL VERI*FACTU CON CÓDIGO QR Y HUELLA CRIPTOGRÁFICA (Solo en Facturas) */}
        {esFactura && factura && (
          <div className="p-4 bg-stone-50 rounded-xl border-2 border-stone-300 grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
            {/* Código QR Veri*Factu (35mm x 35mm conforme a Orden HAC/1177/2024) */}
            <div className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-stone-300 shadow-2xs">
              {factura.qrDataUri ? (
                <img
                  src={factura.qrDataUri}
                  alt="Código QR Veri*Factu AEAT"
                  className="w-28 h-28 object-contain"
                />
              ) : (
                <div className="w-28 h-28 bg-stone-100 flex flex-col items-center justify-center text-center p-2 text-stone-400">
                  <QrCode className="w-8 h-8 mb-1 text-stone-500" />
                  <span className="text-[10px] font-mono">QR AEAT</span>
                </div>
              )}
              <span className="text-[9px] font-mono text-stone-500 mt-1">Sede AEAT</span>
            </div>

            {/* Texto Legal Oficial y Hash Encadenado */}
            <div className="sm:col-span-3 space-y-1.5 text-left">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-stone-900 text-white font-black font-mono text-[11px] rounded tracking-wider">
                  «VERI*FACTU»
                </span>
                <span className="font-bold text-[11px] text-stone-800">
                  Factura verificable en la sede electrónica de la AEAT
                </span>
              </div>

              <p className="text-[10px] text-stone-600 leading-tight">
                Este documento ha sido generado por un Sistema Informático de Facturación adaptado a las especificaciones técnicas del RD 1007/2023 (Ley 11/2021) y la Orden Ministerial HAC/1177/2024 (modalidad VERI*FACTU).
              </p>

              <div className="pt-1 text-[10px] font-mono space-y-0.5 text-stone-700 bg-white p-2 rounded border border-stone-200">
                <div className="truncate">
                  <span className="text-stone-400 font-sans">Huella SHA-256: </span>
                  <strong className="text-stone-950 select-all">
                    {factura.hashActual || 'Sellado criptográfico encadenado'}
                  </strong>
                </div>
                <div className="truncate text-stone-500">
                  <span className="text-stone-400 font-sans">Hash Anterior: </span>
                  <span>
                    {factura.hashAnterior || '0000000000000000000000000000000000000000 (GÉNESIS)'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trazabilidad Sanitaria y Firmas Legales */}
        <div className="pt-4 grid grid-cols-2 gap-8 text-[11px] text-stone-600 border-t border-stone-200">
          <div className="border-t border-stone-400 pt-3 text-center">
            <p className="font-bold text-stone-800">Por la Explotación Avícola / Emisor</p>
            <p className="text-[10px] text-stone-500 mt-1">Firma y Sello Oficial</p>
          </div>
          <div className="border-t border-stone-400 pt-3 text-center">
            <p className="font-bold text-stone-800">Conforme Receptor / Cliente</p>
            <p className="text-[10px] text-stone-500 mt-1">Firma, Nombre y DNI</p>
          </div>
        </div>

        {/* Botones al pie en pantalla */}
        <div className="flex justify-end gap-2 pt-2 no-print">
          <button
            type="button"
            onClick={onClose}
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
            <span>Imprimir / Guardar PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
};
