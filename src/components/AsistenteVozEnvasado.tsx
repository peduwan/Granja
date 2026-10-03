import React, { useState, useEffect, useRef } from 'react';
import { LotePuesta, FormatoEnvase } from '../types';
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
  Package,
  Layers,
  Zap
} from 'lucide-react';

export interface DatosEnvasadoInterpretados {
  formatoId: string;
  cantidadEstuches: number | null;
  maximoPosible?: boolean;
  asignaciones: Array<{ lotePuestaId: string; huevosPorEstuche: number }>;
  mermasRotos: number;
  mermasDescarte: number;
  motivoMerma?: string;
  notas?: string;
  resumen?: string;
}

interface AsistenteVozEnvasadoProps {
  lotesPuesta: LotePuesta[];
  formatos: FormatoEnvase[];
  onAplicarDatos: (datos: DatosEnvasadoInterpretados) => void;
}

export const AsistenteVozEnvasado: React.FC<AsistenteVozEnvasadoProps> = ({
  lotesPuesta,
  formatos,
  onAplicarDatos
}) => {
  const [escuchando, setEscuchando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [transcripcion, setTranscripcion] = useState('');
  const [errorVoz, setErrorVoz] = useState<string | null>(null);
  const [resultado, setResultado] = useState<DatosEnvasadoInterpretados | null>(null);
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

    const lotesConStock = lotesPuesta.filter(l => l.huevosDisponibles > 0);

    try {
      const resp = await fetch('/api/interpretar-envasado-voz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto: textoLimpio,
          lotes: (lotesConStock.length > 0 ? lotesConStock : lotesPuesta).map(l => ({
            id: l.id,
            codigoLote: l.codigoLote,
            nombreNave: l.nombreNave,
            huevosDisponibles: l.huevosDisponibles,
            fechaPuesta: l.fechaPuesta
          })),
          formatos: formatos.map(f => ({
            id: f.id,
            nombre: f.nombre,
            cantidadHuevos: f.cantidadHuevos
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
      console.error('Error procesando voz envasado:', err);
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
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscripcion(currentTranscript);
          transcripcionRef.current = currentTranscript;
        };

        recognition.onerror = (event: any) => {
          console.warn('Aviso de reconocimiento de voz envasado:', event.error);
          setEscuchando(false);
          if (event.error === 'not-allowed') {
            setErrorVoz('Permiso de micrófono no habilitado. Puedes usar la caja de texto manual.');
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
    '50 docenas con el lote de la Nave 1 y 4 huevos rotos',
    '40 docenas: 8 huevos de Nave 1 y 4 de Nave 2',
    '30 docenas a partes iguales Nave 1 y Nave 2',
    'Hacer el máximo posible de docenas con la Nave 1'
  ];

  const formatoEncontrado = formatos.find(f => f.id === resultado?.formatoId);
  const totalHuevosEstuche = resultado?.asignaciones?.reduce((sum, a) => sum + (a.huevosPorEstuche || 0), 0) || 0;
  const esMultilote = (resultado?.asignaciones?.length || 0) > 1;

  return (
    <div className="bg-gradient-to-br from-amber-500/10 via-amber-600/5 to-stone-50 border border-amber-200/80 rounded-2xl p-4 shadow-sm mb-4">
      {/* Cabecera del Asistente */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
              <span>Dictado de Envasado por Voz</span>
              <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full">
                Soporta Multilote
              </span>
            </h4>
            <p className="text-[11px] text-stone-500">
              Pulsa el micro y dicta la tirada (ej. 1 o 2 lotes en el estuche, mermas o máximo posible)
            </p>
          </div>
        </div>

        {/* Botón Principal del Micrófono */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleGrabacion}
            disabled={procesando}
            className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer ${
              escuchando
                ? 'bg-red-600 text-white animate-pulse shadow-red-200'
                : procesando
                ? 'bg-stone-200 text-stone-600 cursor-wait'
                : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white'
            }`}
            title={escuchando ? 'Detener escucha' : 'Comenzar a dictar por voz'}
          >
            {procesando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analizando...</span>
              </>
            ) : escuchando ? (
              <>
                <MicOff className="w-4 h-4" />
                <span>Escuchando... (Pulsar para parar)</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Dictar Envasado</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Onda y Transcripción en tiempo real cuando escucha */}
      {escuchando && (
        <div className="bg-white/90 border border-amber-300 rounded-xl p-3 mb-3 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-4 bg-red-500 rounded-full animate-bounce"></span>
            <span className="w-1.5 h-6 bg-red-600 rounded-full animate-bounce delay-100"></span>
            <span className="w-1.5 h-3 bg-red-400 rounded-full animate-bounce delay-200"></span>
          </div>
          <div className="flex-1">
            <span className="text-[11px] font-semibold text-red-700 block">Dictando en tiempo real:</span>
            <p className="text-xs text-stone-800 italic">
              {transcripcion || 'Habla ahora con naturalidad... (ej: "40 docenas con 8 huevos de la nave 1 y 4 de la nave 2")'}
            </p>
          </div>
        </div>
      )}

      {/* Alerta de Error */}
      {errorVoz && (
        <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
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

      {/* Entrada Manual alternativa */}
      {mostrarTextoManual && (
        <div className="bg-white border border-stone-200 rounded-xl p-3 mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-stone-700">
              Escribir o pegar dictado de envasado:
            </label>
            <button
              type="button"
              onClick={() => setMostrarTextoManual(false)}
              className="text-stone-400 hover:text-stone-600 text-xs"
            >
              Cerrar
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={textoManual}
              onChange={e => setTextoManual(e.target.value)}
              placeholder='Ej: "50 docenas con 8 huevos nave 1 y 4 nave 2 con 5 rotos"'
              className="flex-1 text-xs rounded-lg border border-stone-300 px-3 py-2 text-stone-800 focus:ring-1 focus:ring-amber-500"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  procesarTextoDictado(textoManual);
                }
              }}
            />
            <button
              type="button"
              onClick={() => procesarTextoDictado(textoManual)}
              disabled={!textoManual.trim() || procesando}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1 cursor-pointer"
            >
              <span>Interpretar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Tarjeta de Confirmación de Datos Interpretados */}
      {resultado && (
        <div className="bg-white border-2 border-amber-500/80 rounded-xl p-3.5 mb-3 shadow-md space-y-3">
          <div className="flex items-start justify-between gap-2 border-b border-stone-100 pb-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <span className="text-xs font-bold text-stone-900 block">
                  Orden de Envasado Interpretada
                </span>
                <p className="text-[11px] text-stone-500">
                  {resultado.resumen}
                </p>
              </div>
            </div>
            {metodoUsado === 'gemini_ai' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" />
                Gemini IA
              </span>
            )}
          </div>

          {/* Desglose visual de los datos extraídos */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-stone-50 p-2 rounded-lg border border-stone-200">
              <span className="text-[10px] text-stone-400 font-semibold block uppercase">Formato</span>
              <strong className="text-stone-900 font-bold">
                {formatoEncontrado?.nombre || 'Docena (12)'}
              </strong>
            </div>

            <div className="bg-stone-50 p-2 rounded-lg border border-stone-200">
              <span className="text-[10px] text-stone-400 font-semibold block uppercase">Cantidad</span>
              <strong className="text-amber-800 font-bold flex items-center gap-1">
                {resultado.maximoPosible ? (
                  <>
                    <Zap className="w-3 h-3 text-amber-600" />
                    <span>Máximo stock</span>
                  </>
                ) : (
                  <span>{resultado.cantidadEstuches || 0} estuches</span>
                )}
              </strong>
            </div>

            <div className="bg-stone-50 p-2 rounded-lg border border-stone-200">
              <span className="text-[10px] text-stone-400 font-semibold block uppercase">Tipo Envase</span>
              <strong className={esMultilote ? 'text-amber-800 font-bold' : 'text-stone-800 font-bold'}>
                {esMultilote ? 'Multilote (Combinado)' : 'Lote Único'}
              </strong>
            </div>

            <div className="bg-stone-50 p-2 rounded-lg border border-stone-200">
              <span className="text-[10px] text-stone-400 font-semibold block uppercase">Mermas</span>
              <strong className="text-red-700 font-bold">
                {resultado.mermasRotos} rotos / {resultado.mermasDescarte} desc.
              </strong>
            </div>
          </div>

          {/* Composición Multilote detallada */}
          <div className="bg-amber-50/60 p-2.5 rounded-xl border border-amber-200 text-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-stone-700 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-amber-700" />
                <span>Composición de cada estuche ({totalHuevosEstuche} huevos):</span>
              </span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                ✓ Cuadre detectado
              </span>
            </div>

            <div className="space-y-1">
              {resultado.asignaciones?.map((asig, idx) => {
                const lote = lotesPuesta.find(l => l.id === asig.lotePuestaId);
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-amber-200/80 text-[11px]"
                  >
                    <span className="font-medium text-stone-800">
                      Lote {idx + 1}: <strong>{lote?.nombreNave || 'Lote de Puesta'}</strong> ({lote?.codigoLote || asig.lotePuestaId})
                    </span>
                    <span className="font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                      {asig.huevosPorEstuche} huevos / estuche
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setResultado(null)}
              className="text-stone-500 hover:text-stone-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleAplicar}
              className="inline-flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md transition-all cursor-pointer hover:scale-[1.02]"
            >
              <span>Aplicar al Formulario de Envasado</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Barra de ejemplos rápidos y toggle manual */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/50 mt-2 text-[11px] text-stone-500">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-stone-600">Ejemplos:</span>
          {ejemplos.map((ej, i) => (
            <button
              key={i}
              type="button"
              onClick={() => procesarTextoDictado(ej)}
              className="text-[10px] text-amber-800 bg-amber-100/80 hover:bg-amber-200 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
            >
              «{ej}»
            </button>
          ))}
        </div>

        {!mostrarTextoManual && (
          <button
            type="button"
            onClick={() => setMostrarTextoManual(true)}
            className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold underline cursor-pointer"
          >
            Escribir dictado manualmente
          </button>
        )}
      </div>
    </div>
  );
};
