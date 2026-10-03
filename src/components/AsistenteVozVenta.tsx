import React, { useState, useEffect, useRef } from 'react';
import { Cliente, LoteEnvasado, FormatoEnvase, FormaPago } from '../types';
import {
  Mic,
  MicOff,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Volume2,
  ArrowRight,
  X,
  Receipt,
  FileText,
  UserCheck,
  Package,
  CreditCard,
  DollarSign
} from 'lucide-react';

export interface DatosVentaInterpretados {
  tipoDocumento: 'albaran' | 'factura_directa';
  clienteId: string;
  formaPago?: FormaPago;
  lineas: Array<{
    loteEnvasadoId: string;
    cantidadEstuches: number;
    precioUnitario: number;
  }>;
  notas?: string;
  resumen?: string;
}

interface AsistenteVozVentaProps {
  clientes: Cliente[];
  lotesEnvasados: LoteEnvasado[];
  formatos: FormatoEnvase[];
  tipoDocActual: 'albaran' | 'factura_directa';
  onAplicarDatos: (datos: DatosVentaInterpretados) => void;
}

export const AsistenteVozVenta: React.FC<AsistenteVozVentaProps> = ({
  clientes,
  lotesEnvasados,
  formatos,
  tipoDocActual,
  onAplicarDatos
}) => {
  const [escuchando, setEscuchando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [transcripcion, setTranscripcion] = useState('');
  const [errorVoz, setErrorVoz] = useState<string | null>(null);
  const [resultado, setResultado] = useState<DatosVentaInterpretados | null>(null);
  const [metodoUsado, setMetodoUsado] = useState<string | null>(null);
  const [mostrarTextoManual, setMostrarTextoManual] = useState(false);
  const [textoManual, setTextoManual] = useState('');

  const recognitionRef = useRef<any>(null);
  const transcripcionRef = useRef('');
  const procesandoRef = useRef(false);

  useEffect(() => {
    transcripcionRef.current = transcripcion;
  }, [transcripcion]);

  useEffect(() => {
    procesandoRef.current = procesando;
  }, [procesando]);

  const procesarTextoDictado = async (texto: string) => {
    const textoLimpio = (texto || transcripcionRef.current || '').trim();
    if (!textoLimpio) return;

    setProcesando(true);
    procesandoRef.current = true;
    setErrorVoz(null);
    setResultado(null);

    const lotesConStock = lotesEnvasados.filter(l => l.estuchesDisponibles > 0);
    const poolLotes = lotesConStock.length > 0 ? lotesConStock : lotesEnvasados;

    try {
      const resp = await fetch('/api/interpretar-venta-voz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto: textoLimpio,
          tipoDocActual,
          clientes: clientes.map(c => ({
            id: c.id,
            nombre: c.nombre,
            cifNif: c.cifNif,
            recargoEquivalencia: c.recargoEquivalencia
          })),
          lotesEnvasados: poolLotes.map(l => {
            const fmt = formatos.find(f => f.id === l.formatoId);
            const comp0 = l.componentesLotes?.[0];
            return {
              id: l.id,
              codigoLoteEnvasado: l.codigoLoteEnvasado,
              formatoId: l.formatoId,
              nombreFormato: l.nombreFormato || fmt?.nombre || 'Estuches',
              estuchesDisponibles: l.estuchesDisponibles,
              codigoLotePuesta: comp0?.codigoLotePuesta || '',
              nombreNave: comp0?.nombreNave || '',
              precioVenta: fmt?.precioVenta || 2.50
            };
          }),
          formatos: formatos.map(f => ({
            id: f.id,
            nombre: f.nombre,
            cantidadHuevos: f.cantidadHuevos,
            precioVenta: f.precioVenta
          }))
        })
      });

      if (!resp.ok) {
        throw new Error(`Error en el servidor: ${resp.status}`);
      }

      const resData = await resp.json();
      if (resData.datos) {
        setResultado(resData.datos);
        setMetodoUsado(resData.metodo);
      } else {
        throw new Error('No se recibieron datos interpretados.');
      }
    } catch (err: any) {
      console.error('Error procesando voz de venta:', err);
      setErrorVoz('No se pudo conectar con el asistente de voz. Puedes dictar de nuevo o rellenar manualmente.');
    } finally {
      setProcesando(false);
      procesandoRef.current = false;
    }
  };

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'es-ES';

        recognition.onstart = () => {
          setEscuchando(true);
          setErrorVoz(null);
          setResultado(null);
        };

        recognition.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.resultIndex[i] || event.results[i][0].transcript;
          }
          setTranscripcion(currentTranscript);
          transcripcionRef.current = currentTranscript;
        };

        recognition.onerror = (event: any) => {
          console.warn('Aviso de reconocimiento de voz ventas:', event.error);
          setEscuchando(false);
          if (event.error === 'not-allowed') {
            setErrorVoz('Permiso de micrófono no habilitado en el navegador. Puedes usar la caja de texto manual.');
            setMostrarTextoManual(true);
          } else if (event.error === 'no-speech') {
            setErrorVoz('No se detectó voz. Vuelve a pulsar el micrófono e inténtalo de nuevo.');
          } else {
            setErrorVoz(`Aviso de micrófono (${event.error}).`);
          }
        };

        recognition.onend = () => {
          setEscuchando(false);
          const finalTexto = transcripcionRef.current.trim();
          if (finalTexto && !procesandoRef.current) {
            procesarTextoDictado(finalTexto);
          }
        };

        recognitionRef.current = recognition;
      } catch (err) {
        console.warn('No se pudo inicializar SpeechRecognition:', err);
      }
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const toggleGrabacion = () => {
    setErrorVoz(null);
    if (escuchando) {
      setEscuchando(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      const t = transcripcionRef.current.trim();
      if (t) {
        procesarTextoDictado(t);
      }
    } else {
      if (!recognitionRef.current) {
        setErrorVoz('El reconocimiento de voz nativo no está disponible. Usa el campo de texto manual.');
        setMostrarTextoManual(true);
        return;
      }
      setTranscripcion('');
      transcripcionRef.current = '';
      setResultado(null);
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn('Error iniciando recognition:', e);
        setErrorVoz('No se pudo activar el micrófono. Comprueba los permisos de tu navegador.');
        setMostrarTextoManual(true);
      }
    }
  };

  const handleAplicar = () => {
    if (!resultado) return;
    onAplicarDatos(resultado);
    setResultado(null);
    setTranscripcion('');
  };

  const ejemplos = [
    'Albarán para Restaurante Los Olivos, 20 docenas',
    'Factura a Supermercado El Puente, 50 docenas a 2.80 euros pagado al contado',
    'Albarán para Frutería García, 30 estuches de media docena',
    'Factura para Bar Manolo, 15 docenas por transferencia'
  ];

  const clienteInterpretado = resultado ? clientes.find(c => c.id === resultado.clienteId) : null;

  return (
    <div className="bg-gradient-to-br from-amber-500/10 via-amber-50/50 to-stone-50 border border-amber-300/80 rounded-2xl p-4 shadow-xs space-y-3">
      {/* Cabecera del Asistente de Voz */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
              <span>Dictado Inteligente de Albaranes y Facturas</span>
              <span className="text-[10px] font-semibold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full">
                IA Gemini
              </span>
            </h4>
            <p className="text-[11px] text-stone-500">
              Pulsa el micro y dicta el cliente, formato, cantidad, precio o forma de pago
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botón Principal del Micrófono */}
          <button
            type="button"
            onClick={toggleGrabacion}
            disabled={procesando}
            className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer shadow-sm ${
              escuchando
                ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse ring-4 ring-red-400/30'
                : procesando
                ? 'bg-amber-400 text-amber-950 cursor-wait'
                : 'bg-amber-600 hover:bg-amber-700 text-white hover:scale-[1.02]'
            }`}
          >
            {escuchando ? (
              <>
                <MicOff className="w-4 h-4" />
                <span>Detener y Procesar</span>
              </>
            ) : procesando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Interpretando...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Dictar por Voz</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMostrarTextoManual(!mostrarTextoManual)}
            className="text-stone-400 hover:text-stone-600 p-1.5 rounded-lg hover:bg-stone-200/50 transition-colors"
            title="Escribir orden con teclado"
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Indicador de Escuchando Activo */}
      {escuchando && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-900 animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping" />
            <span className="font-semibold">Escuchando micrófono... habla con naturalidad</span>
          </div>
          <span className="text-[11px] text-red-700 font-mono">
            {transcripcion ? `"${transcripcion}"` : 'Esperando tu voz...'}
          </span>
        </div>
      )}

      {/* Transcripción en Proceso */}
      {transcripcion && !escuchando && procesando && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
            <span>Procesando dictado:</span>
          </div>
          <p className="text-[11px] italic text-amber-950 font-medium pl-5">"{transcripcion}"</p>
        </div>
      )}

      {/* Error o Aviso */}
      {errorVoz && (
        <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorVoz}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorVoz(null)}
            className="text-red-500 hover:text-red-700 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Campo de Texto Manual Alternativo */}
      {mostrarTextoManual && (
        <div className="p-3 bg-white border border-stone-200 rounded-xl space-y-2">
          <label className="text-[11px] font-bold text-stone-700 block">
            Escribir o pegar dictado en texto natural:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={textoManual}
              onChange={e => setTextoManual(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (textoManual.trim()) {
                    setTranscripcion(textoManual);
                    procesarTextoDictado(textoManual);
                  }
                }
              }}
              placeholder="Ej: Factura directa a Supermercado El Puente, 40 docenas a 2.75€ al contado"
              className="flex-1 text-xs rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="button"
              disabled={!textoManual.trim() || procesando}
              onClick={() => {
                setTranscripcion(textoManual);
                procesarTextoDictado(textoManual);
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              Procesar
            </button>
          </div>
        </div>
      )}

      {/* Ejemplos de uso rápido */}
      {!resultado && !escuchando && !procesando && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[10px] font-bold text-stone-500 uppercase mr-1">Ejemplos:</span>
          {ejemplos.map((ej, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setTranscripcion(ej);
                procesarTextoDictado(ej);
              }}
              className="text-[10px] bg-white hover:bg-amber-100 text-stone-700 hover:text-amber-900 border border-stone-200 hover:border-amber-300 px-2 py-0.5 rounded-lg transition-colors cursor-pointer font-medium"
            >
              "{ej}"
            </button>
          ))}
        </div>
      )}

      {/* RESULTADO INTERPRETADO CON ÉXITO */}
      {resultado && (
        <div className="p-3.5 bg-white border-2 border-emerald-500/80 rounded-xl space-y-3 animate-in fade-in duration-200 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-stone-900">
                Orden de Venta Interpretada con Éxito
              </span>
              {metodoUsado && (
                <span className="text-[9px] font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                  {metodoUsado === 'gemini_ai' ? 'IA Gemini' : 'Recuperación Local'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                resultado.tipoDocumento === 'factura_directa'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-blue-100 text-blue-900 border border-blue-300'
              }`}>
                {resultado.tipoDocumento === 'factura_directa' ? 'Factura Directa' : 'Albarán de Entrega'}
              </span>

              <button
                type="button"
                onClick={() => setResultado(null)}
                className="text-stone-400 hover:text-stone-600 p-1"
                title="Descartar resultado"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Resumen amigable */}
          {resultado.resumen && (
            <p className="text-xs text-stone-700 font-medium bg-stone-50 p-2.5 rounded-lg border border-stone-200">
              {resultado.resumen}
            </p>
          )}

          {/* Detalles del desglose */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2 bg-stone-50 rounded-lg space-y-1">
              <span className="text-[10px] font-bold text-stone-500 uppercase block">Cliente:</span>
              <strong className="text-stone-900 block">
                {clienteInterpretado ? clienteInterpretado.nombre : 'Cliente seleccionado'}
              </strong>
              {clienteInterpretado?.cifNif && (
                <span className="text-[11px] text-stone-500 font-mono">CIF: {clienteInterpretado.cifNif}</span>
              )}
            </div>

            {resultado.tipoDocumento === 'factura_directa' && (
              <div className="p-2 bg-stone-50 rounded-lg space-y-1">
                <span className="text-[10px] font-bold text-stone-500 uppercase block">Forma de Pago:</span>
                <strong className="text-stone-900 block capitalize">
                  {resultado.formaPago === 'efectivo' ? 'Efectivo / Contado' :
                   resultado.formaPago === 'recibo_bancario' ? 'Recibo Bancario / Domiciliación' :
                   resultado.formaPago === 'bizum' ? 'Bizum' :
                   resultado.formaPago === 'pagare' ? 'Pagaré' : 'Transferencia Bancaria'}
                </strong>
              </div>
            )}
          </div>

          {/* Partidas y líneas a vender */}
          {resultado.lineas && resultado.lineas.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-stone-500 uppercase block">
                Partidas asignadas:
              </span>
              <div className="space-y-1">
                {resultado.lineas.map((lin, idx) => {
                  const lote = lotesEnvasados.find(l => l.id === lin.loteEnvasadoId);
                  const sub = (lin.cantidadEstuches * lin.precioUnitario).toFixed(2);
                  return (
                    <div key={idx} className="flex justify-between items-center text-xs p-2 bg-emerald-50/60 border border-emerald-200 rounded-lg">
                      <div className="space-y-0.5">
                        <strong className="text-stone-900 block">
                          {lote?.nombreFormato || 'Estuches'}
                        </strong>
                        <span className="text-[11px] text-stone-500 font-mono">
                          Lote: {lote?.codigoLoteEnvasado || 'Lote envasado'}
                        </span>
                      </div>
                      <div className="text-right">
                        <strong className="text-stone-900 block">{lin.cantidadEstuches} est. · {lin.precioUnitario.toFixed(2)} €/ud</strong>
                        <span className="font-mono text-emerald-900 font-bold text-[11px]">Subtotal: {sub} €</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Botón de Aplicar */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => {
                setResultado(null);
                setTranscripcion('');
              }}
              className="text-xs text-stone-500 hover:text-stone-800 font-medium px-2 py-1 cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleAplicar}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-sm cursor-pointer hover:scale-[1.02]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Aplicar al Formulario de Venta</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
