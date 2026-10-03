import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Download, CheckCircle2, Copy, Check, FileCode, ExternalLink, Link2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Factura, ConfiguracionEmpresa } from '../types';
import { verificarIntegridadCadena, descargarXmlVeriFactu, descargarLibroVeriFactuXml } from '../utils/verifactu';
import { formatearFechaES } from '../utils/storage';

interface ModalAuditoriaVeriFactuProps {
  facturas: Factura[];
  config: ConfiguracionEmpresa;
  onClose: () => void;
}

export const ModalAuditoriaVeriFactu: React.FC<ModalAuditoriaVeriFactuProps> = ({
  facturas,
  config,
  onClose
}) => {
  const [cargando, setCargando] = useState(true);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [resultadoAuditoria, setResultadoAuditoria] = useState<{
    esValida: boolean;
    totalVerificadas: number;
    detalles: Array<{
      numeroFactura: string;
      esValido: boolean;
      hashRegistrado?: string;
      hashEsperado?: string;
      error?: string;
    }>;
  }>({ esValida: true, totalVerificadas: 0, detalles: [] });

  const ejecutarAuditoria = async () => {
    setCargando(true);
    try {
      const res = await verificarIntegridadCadena(facturas);
      setResultadoAuditoria(res);
    } catch (err) {
      console.error('Error auditando cadena:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    ejecutarAuditoria();
  }, [facturas]);

  const copiarHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiado(hash);
    setTimeout(() => setCopiado(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-stone-200 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-base">
                Auditoría Criptográfica e Inmutabilidad Veri*Factu
              </h3>
              <p className="text-xs text-stone-500">
                Inspección de integridad de Hashes SHA-256 encadenados (Orden HAC/1177/2024)
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

        {/* Estado General */}
        <div className="shrink-0 space-y-3">
          <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
            resultadoAuditoria.esValida
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              : 'bg-red-50/80 border-red-200 text-red-950'
          }`}>
            <div className="flex items-center gap-3">
              {resultadoAuditoria.esValida ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
              ) : (
                <ShieldAlert className="w-8 h-8 text-red-600 shrink-0" />
              )}
              <div>
                <strong className="text-sm font-bold block">
                  {resultadoAuditoria.esValida
                    ? 'Cadena Criptográfica Íntegra y Conforme a Ley'
                    : 'Discrepancia detectada en la cadena de facturación'}
                </strong>
                <p className="text-xs opacity-90 mt-0.5">
                  {resultadoAuditoria.esValida
                    ? `Se han verificado ${resultadoAuditoria.totalVerificadas} facturas encadenadas matemáticamente. Ningún registro ha sido modificado o alterado.`
                    : 'Uno o más registros no coinciden con el encadenamiento previo.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => descargarLibroVeriFactuXml(facturas, config)}
              className="px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer transition-colors"
              title="Descargar fichero XML oficial del libro mayor de facturación para la AEAT"
            >
              <Download className="w-4 h-4 text-amber-300" />
              <span>Exportar Libro XML</span>
            </button>
          </div>
        </div>

        {/* Lista de Registros Encadenados */}
        <div className="flex-1 overflow-y-auto space-y-2 border border-stone-200 rounded-xl p-3 bg-stone-50/50">
          <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider px-1">
            Cadena de Registros de Alta ({facturas.length} documentos):
          </span>

          {facturas.length === 0 ? (
            <p className="text-stone-500 text-xs text-center py-6">
              No hay facturas registradas en la cadena todavía.
            </p>
          ) : (
            <div className="space-y-2">
              {facturas.map((f, i) => {
                const det = resultadoAuditoria.detalles.find(d => d.numeroFactura === f.numeroFactura);
                const hashCorto = f.hashActual ? `${f.hashActual.slice(0, 10)}...${f.hashActual.slice(-8)}` : 'Sin Hash';
                const hashPrevioCorto = f.hashAnterior ? `${f.hashAnterior.slice(0, 10)}...${f.hashAnterior.slice(-8)}` : 'GÉNESIS';

                return (
                  <div
                    key={f.id}
                    className="p-3 bg-white rounded-xl border border-stone-200 shadow-2xs space-y-2 text-xs hover:border-amber-300 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-stone-100 text-stone-700 flex items-center justify-center font-mono font-bold text-[11px]">
                          {i + 1}
                        </span>
                        <strong className="font-mono text-stone-900 text-sm font-black">
                          {f.numeroFactura}
                        </strong>
                        <span className="text-stone-600 truncate max-w-[150px]">
                          {f.clienteNombre}
                        </span>
                        {f.esRectificativa && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded font-bold text-[10px]">
                            RECTIFICATIVA
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <strong className="text-stone-900 font-mono text-sm">
                          {f.totales.totalDocumento.toFixed(2)} €
                        </strong>

                        <button
                          type="button"
                          onClick={() => descargarXmlVeriFactu(f)}
                          className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          title="Descargar XML individual conforme a la Orden HAC/1177/2024"
                        >
                          <FileCode className="w-3.5 h-3.5 text-amber-700" />
                          <span>XML</span>
                        </button>

                        {f.urlVeriFactu && (
                          <a
                            href={f.urlVeriFactu}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded text-[11px] font-semibold flex items-center gap-1 border border-amber-200 cursor-pointer"
                            title="Abrir enlace de comprobación en la Sede Electrónica de la AEAT"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-amber-700" />
                            <span>AEAT</span>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Hashes Encadenados */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono bg-stone-50 p-2 rounded-lg border border-stone-100">
                      <div className="flex items-center justify-between gap-1 overflow-hidden">
                        <span className="text-stone-400 shrink-0">Hash Anterior:</span>
                        <span className="text-stone-600 truncate" title={f.hashAnterior || 'Génesis'}>
                          {hashPrevioCorto}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1 overflow-hidden">
                        <span className="text-stone-400 shrink-0">Hash SHA-256:</span>
                        <div className="flex items-center gap-1 truncate">
                          <span className="text-emerald-800 font-bold truncate" title={f.hashActual}>
                            {hashCorto}
                          </span>
                          {f.hashActual && (
                            <button
                              type="button"
                              onClick={() => copiarHash(f.hashActual!)}
                              className="text-stone-400 hover:text-stone-700 p-0.5"
                              title="Copiar Hash SHA-256 completo"
                            >
                              {copiado === f.hashActual ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="flex justify-between items-center pt-2 border-t border-stone-200 shrink-0">
          <button
            type="button"
            onClick={ejecutarAuditoria}
            className="text-xs text-stone-600 hover:text-stone-900 font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin' : ''}`} />
            <span>Reverificar Cadena</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-xl cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
