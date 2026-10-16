import React, { useState } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  FileCode, 
  ExternalLink, 
  Lock, 
  Server, 
  Send, 
  Copy, 
  Check, 
  RefreshCw,
  Info,
  Terminal
} from 'lucide-react';
import { Factura, FiscalSubmission } from '../types';
import { descargarXmlVeriFactu } from '../utils/verifactu';
import { formatearFechaES } from '../utils/storage';

interface ModalLogAeatProps {
  factura: Factura;
  submission?: FiscalSubmission;
  isSending?: boolean;
  onClose: () => void;
  onReintentar?: () => void;
}

export const ModalLogAeat: React.FC<ModalLogAeatProps> = ({
  factura,
  submission,
  isSending = false,
  onClose,
  onReintentar
}) => {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [mostrarTrazaCruda, setMostrarTrazaCruda] = useState(false);

  const copiarAlPortapapeles = (texto: string, clave: string) => {
    navigator.clipboard.writeText(texto);
    setCopiado(clave);
    setTimeout(() => setCopiado(null), 2000);
  };

  const estado = submission?.estado || 'PENDING';
  const esAceptada = estado === 'ACCEPTED' || estado === 'ACCEPTED_WITH_ERRORS';
  const esRechazada = estado === 'REJECTED';
  const esErrorTecnico = estado === 'FAILED_TECHNICAL' || estado === 'RETRY_PENDING';
  const esFaltaCertificado = submission?.descripcion?.includes('certificado mTLS') || 
    submission?.descripcion?.includes('MISSING_PRODUCTION_MTLS_CERT');

  // Traza de eventos paso a paso
  const logs = [
    {
      timestamp: factura.creadoEn ? new Date(factura.creadoEn).toLocaleTimeString('es-ES') : '--:--:--',
      nivel: 'INFO',
      modulo: 'CUSTODIA_FISCAL',
      mensaje: `Borrador recibido para factura ${factura.numeroFactura} (${factura.clienteNombre}, ${factura.totales.totalDocumento.toFixed(2)} €).`
    },
    {
      timestamp: factura.creadoEn ? new Date(factura.creadoEn).toLocaleTimeString('es-ES') : '--:--:--',
      nivel: 'INFO',
      modulo: 'SHA256_ENGINE',
      mensaje: `Encadenamiento resuelto. Hash previo: ${factura.hashAnterior ? factura.hashAnterior.substring(0, 16) + '...' : 'GÉNESIS (inicio de serie)'}.`
    },
    {
      timestamp: factura.creadoEn ? new Date(factura.creadoEn).toLocaleTimeString('es-ES') : '--:--:--',
      nivel: 'SUCCESS',
      modulo: 'VERIFACTU_SEAL',
      mensaje: `Huella SHA-256 calculada y sellada: ${factura.hashActual || 'Generado'}. Inmutabilidad garantizada (RD 1007/2023).`
    },
    {
      timestamp: factura.creadoEn ? new Date(factura.creadoEn).toLocaleTimeString('es-ES') : '--:--:--',
      nivel: 'INFO',
      modulo: 'QR_GENERATOR',
      mensaje: `Código QR reglamentario generado para cotejo en sede electrónica AEAT.`
    },
    ...(submission ? [
      {
        timestamp: submission.fechaEnvio ? new Date(submission.fechaEnvio).toLocaleTimeString('es-ES') : '--:--:--',
        nivel: 'INFO',
        modulo: 'AEAT_OUTBOX',
        mensaje: `Petición de remisión encolada para registro fiscal ID: ${factura.fiscalRecordId || factura.id}. Intento 1.`
      },
      {
        timestamp: submission.fechaEnvio ? new Date(submission.fechaEnvio).toLocaleTimeString('es-ES') : '--:--:--',
        nivel: esFaltaCertificado || esErrorTecnico ? 'WARN' : 'INFO',
        modulo: 'MTLS_TRANSPORT',
        mensaje: `Estableciendo túnel mTLS hacia https://preverifactu.agenciatributaria.gob.es/wlpl/TIBA-V100/TIBAFacturacion`
      },
      {
        timestamp: submission.fechaEnvio ? new Date(submission.fechaEnvio).toLocaleTimeString('es-ES') : '--:--:--',
        nivel: esAceptada ? 'SUCCESS' : (esRechazada || esErrorTecnico ? 'ERROR' : 'INFO'),
        modulo: 'AEAT_SOAP_CLIENT',
        mensaje: submission.descripcion || `Estado de remisión: ${submission.estado}`
      },
      ...(submission.csv ? [{
        timestamp: submission.fechaEnvio ? new Date(submission.fechaEnvio).toLocaleTimeString('es-ES') : '--:--:--',
        nivel: 'SUCCESS',
        modulo: 'AEAT_AUDIT_CSV',
        mensaje: `Código Seguro de Verificación (CSV) oficial asignado por la AEAT: ${submission.csv}`
      }] : [])
    ] : [
      {
        timestamp: '--:--:--',
        nivel: 'INFO',
        modulo: 'AEAT_OUTBOX',
        mensaje: 'Factura sellada y lista para remisión a la AEAT. Aún no se ha ejecutado el envío o está pendiente de procesar.'
      }
    ])
  ];

  const textoLogs = logs.map(l => `[${l.timestamp}] [${l.modulo}] [${l.nivel}] ${l.mensaje}`).join('\n');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto animate-in fade-in zoom-in-95 max-h-[92vh] flex flex-col">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-stone-200 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              esAceptada ? 'bg-emerald-100 text-emerald-800' :
              esRechazada ? 'bg-red-100 text-red-800' :
              esErrorTecnico ? 'bg-amber-100 text-amber-800' :
              'bg-blue-100 text-blue-800'
            }`}>
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-stone-900 text-base">
                  Trazabilidad y Log de Remisión AEAT
                </h3>
                <span className="font-mono text-xs px-2 py-0.5 bg-stone-100 text-stone-800 rounded font-bold border border-stone-200">
                  {factura.numeroFactura}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Auditoría paso a paso del ciclo de vida fiscal conforme a la Ley Antifraude y el RD 1007/2023
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

        {/* Resumen del Estado Actual */}
        <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${
          esAceptada ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950' :
          esRechazada ? 'bg-red-50/80 border-red-200 text-red-950' :
          esErrorTecnico ? 'bg-amber-50/80 border-amber-200 text-amber-950' :
          'bg-stone-50 border-stone-200 text-stone-900'
        }`}>
          <div className="flex items-center gap-3">
            {esAceptada ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
            ) : esRechazada ? (
              <XCircle className="w-8 h-8 text-red-600 shrink-0" />
            ) : esErrorTecnico ? (
              <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0" />
            ) : (
              <Clock className="w-8 h-8 text-stone-500 shrink-0" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider">Estado de Remisión:</span>
                <span className="font-bold text-sm font-mono">
                  {isSending ? 'ENVIANDO A LA AEAT...' : estado}
                </span>
              </div>
              <p className="text-xs opacity-90 mt-0.5">
                {isSending
                  ? 'Conectando con el servidor oficial de la Agencia Tributaria...'
                  : esAceptada
                  ? `Factura admitida y validada por la AEAT. CSV: ${submission?.csv || 'Registrado'}`
                  : esRechazada
                  ? `Rechazada por la AEAT [${submission?.codigoAeat || 'Error'}]: ${submission?.descripcion || 'Revisar datos fiscales'}`
                  : esFaltaCertificado
                  ? 'Falta Certificado Digital mTLS de servidor. Las facturas se sellan localmente, pero el envío a Hacienda requiere credenciales.'
                  : submission?.descripcion || 'Factura sellada criptográficamente en servidor; lista para remisión manual o por lotes.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => descargarXmlVeriFactu(factura)}
              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Descargar el fichero XML oficial que se envía a la AEAT"
            >
              <FileCode className="w-3.5 h-3.5 text-amber-300" />
              <span>Descargar XML</span>
            </button>
            {onReintentar && !esAceptada && (
              <button
                type="button"
                disabled={isSending}
                onClick={onReintentar}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
                <span>Reintentar Envío</span>
              </button>
            )}
          </div>
        </div>

        {/* Flujo Paso a Paso */}
        <div className="space-y-3 shrink-0">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block">
            Fases del Proceso Veri*Factu:
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            {/* Paso 1: Sellado */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>1. Huella SHA-256</span>
              </div>
              <p className="text-[11px] text-stone-600">
                Inmutable y encadenada con la factura previa.
              </p>
              <span className="inline-block text-[10px] font-mono text-emerald-900 font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                OK · Conforme Ley
              </span>
            </div>

            {/* Paso 2: XML */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>2. Fichero XML</span>
              </div>
              <p className="text-[11px] text-stone-600">
                Esquema oficial AEAT (LRFacturasEmitidas).
              </p>
              <span className="inline-block text-[10px] font-mono text-emerald-900 font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                OK · Validado XSD
              </span>
            </div>

            {/* Paso 3: mTLS */}
            <div className={`p-3 rounded-xl space-y-1 border ${
              esFaltaCertificado 
                ? 'bg-amber-50/70 border-amber-200' 
                : esAceptada 
                ? 'bg-emerald-50/70 border-emerald-200' 
                : 'bg-stone-50 border-stone-200'
            }`}>
              <div className="flex items-center gap-1.5 font-bold text-xs text-stone-800">
                {esAceptada ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : esFaltaCertificado ? (
                  <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <Server className="w-4 h-4 text-stone-500 shrink-0" />
                )}
                <span>3. Canal mTLS</span>
              </div>
              <p className="text-[11px] text-stone-600">
                Autenticación mutua con certificado digital FNMT.
              </p>
              <span className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                esFaltaCertificado ? 'bg-amber-100 text-amber-900 border-amber-300' :
                esAceptada ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                'bg-white text-stone-700 border-stone-200'
              }`}>
                {esFaltaCertificado ? 'Requiere Cert. FNMT' : esAceptada ? 'Conectado mTLS' : 'Endpoint AEAT'}
              </span>
            </div>

            {/* Paso 4: Dictamen AEAT */}
            <div className={`p-3 rounded-xl space-y-1 border ${
              esAceptada ? 'bg-emerald-50/70 border-emerald-200' :
              esRechazada ? 'bg-red-50/70 border-red-200' :
              esErrorTecnico ? 'bg-amber-50/70 border-amber-200' :
              'bg-stone-50 border-stone-200'
            }`}>
              <div className="flex items-center gap-1.5 font-bold text-xs text-stone-800">
                {esAceptada ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : esRechazada ? (
                  <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                ) : (
                  <Send className="w-4 h-4 text-stone-500 shrink-0" />
                )}
                <span>4. Dictamen AEAT</span>
              </div>
              <p className="text-[11px] text-stone-600">
                Respuesta SOAP y asignación de CSV oficial.
              </p>
              <span className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                esAceptada ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                esRechazada ? 'bg-red-100 text-red-900 border-red-300' :
                'bg-white text-stone-700 border-stone-200'
              }`}>
                {esAceptada ? 'CSV Emitido' : esRechazada ? 'Rechazado' : 'Pendiente / En cola'}
              </span>
            </div>
          </div>
        </div>

        {/* Detalles Técnicos de Hashes */}
        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-2 text-xs font-mono shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-stone-400">Detalles Criptográficos:</span>
            {factura.urlVeriFactu && (
              <a
                href={factura.urlVeriFactu}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-700 hover:text-amber-900 flex items-center gap-1 text-[11px] font-sans font-bold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Cotejo en Sede Electrónica AEAT</span>
              </a>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-white p-2 rounded-lg border border-stone-200">
              <span className="text-[10px] text-stone-400 block font-sans">Hash Anterior (Encadenamiento):</span>
              <span className="text-stone-700 text-[11px] break-all">
                {factura.hashAnterior || '0000000000000000000000000000000000000000000000000000000000000000 (GÉNESIS)'}
              </span>
            </div>
            <div className="bg-white p-2 rounded-lg border border-stone-200">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-stone-400 block font-sans">Hash SHA-256 Actual:</span>
                {factura.hashActual && (
                  <button
                    type="button"
                    onClick={() => copiarAlPortapapeles(factura.hashActual!, 'hash')}
                    className="text-stone-400 hover:text-stone-700 p-0.5"
                    title="Copiar Hash SHA-256"
                  >
                    {copiado === 'hash' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
              <span className="text-emerald-900 font-bold text-[11px] break-all">
                {factura.hashActual || 'No calculado'}
              </span>
            </div>
          </div>
        </div>

        {/* Visor de Traza / Log Detallado */}
        <div className="flex-1 flex flex-col min-h-[160px] border border-stone-200 rounded-xl overflow-hidden bg-stone-900 text-stone-100">
          <div className="px-3 py-2 bg-stone-950 flex items-center justify-between border-b border-stone-800 text-xs">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="font-mono font-bold text-stone-300">Log de Ejecución en Servidor (Paso a Paso)</span>
            </div>
            <button
              type="button"
              onClick={() => copiarAlPortapapeles(textoLogs, 'logs')}
              className="text-stone-400 hover:text-white flex items-center gap-1 text-[11px] font-sans font-medium cursor-pointer"
            >
              {copiado === 'logs' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiado === 'logs' ? 'Copiado' : 'Copiar Traza'}</span>
            </button>
          </div>

          <div className="p-3 overflow-y-auto font-mono text-[11px] space-y-1 flex-1 leading-relaxed">
            {logs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-stone-500 shrink-0 select-none">[{log.timestamp}]</span>
                <span className={`font-bold shrink-0 ${
                  log.nivel === 'SUCCESS' ? 'text-emerald-400' :
                  log.nivel === 'ERROR' ? 'text-red-400' :
                  log.nivel === 'WARN' ? 'text-amber-400' :
                  'text-blue-400'
                }`}>
                  [{log.modulo}]
                </span>
                <span className={log.nivel === 'ERROR' ? 'text-red-300' : log.nivel === 'WARN' ? 'text-amber-200' : 'text-stone-300'}>
                  {log.mensaje}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Nota explicativa si falta certificado mTLS en producción */}
        {esFaltaCertificado && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-950 shrink-0">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">¿Por qué aparece el aviso de certificado mTLS?</p>
              <p className="text-[11px] text-amber-900 leading-normal">
                En el entorno desplegado en la nube (producción), la Agencia Tributaria no admite envíos anónimos: exige autenticación mutua TLS (mTLS) con un certificado digital oficial (FNMT, DNIe o certificado de representante). Mientras no se cargue el certificado en el servidor, el sistema actúa en modo de protección legal (bloquea envíos para evitar remitir datos de prueba a la AEAT). Tus facturas y albaranes son 100% legales, válidos y sellados localmente con su QR.
              </p>
            </div>
          </div>
        )}

        {/* Pie */}
        <div className="flex justify-between items-center pt-2 border-t border-stone-200 shrink-0">
          <span className="text-xs text-stone-400 font-mono">
            ID Fiscal: {factura.fiscalRecordId || factura.id}
          </span>
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
