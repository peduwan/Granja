import React, { useState, useEffect, useRef } from 'react';
import { Nave, LotePuesta } from '../types';
import { Mic, MicOff, Sparkles, Loader2, CheckCircle2, AlertCircle, RefreshCw, Volume2, ArrowRight, X } from 'lucide-react';

interface AsistenteVozPuestaProps {
  naves: Nave[];
  onAplicarDatos: (datos: {
    naveId: string;
    totalRecogida: number;
    rotos: number;
    sucios: number;
    descarte: number;
    xl?: number | null;
    l?: number | null;
    m?: number | null;
    s?: number | null;
    observaciones?: string;
  }) => void;
  onGuardarDirecto?: (nuevoLote: LotePuesta) => void;
}

interface ResultadoInterpretacion {
  naveId: string;
  totalRecogida: number;
  rotos: number;
  sucios: number;
  descarte: number;
  xl?: number | null;
  l?: number | null;
  m?: number | null;
  s?: number | null;
  observaciones?: string;
  resumen?: string;
}

export const AsistenteVozPuesta: React.FC<AsistenteVozPuestaProps> = ({
  naves,
  onAplicarDatos
}) => {
  const [escuchando, setEscuchando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [transcripcion, setTranscripcion] = useState('');
  const [errorVoz, setErrorVoz] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoInterpretacion | null>(null);
  const [metodoUsado, setMetodoUsado] = useState<string | null>(null);
  const [mostrarTextoManual, setMostrarTextoManual] = useState(false);
  const [textoManual, setTextoManual] = useState('');

  const recognitionRef = useRef<any>(null);
  const transcripcionRef = useRef('');
  const procesandoRef = useRef(false);

  // Mantener sincronizado el ref
  useEffect(() => {
    transcripcionRef.current = transcripcion;
  }, [transcripcion]);

  useEffect(() => {
    procesandoRef.current = procesando;
  }, [procesando]);

  // Si la transcripción termina, interpretamos
  const procesarTextoDictado = async (texto: string) => {
    const textoLimpio = (texto || transcripcionRef.current || '').trim();
    if (!textoLimpio) return;

    setProcesando(true);
    procesandoRef.current = true;
    setErrorVoz(null);
    setResultado(null);

    try {
      const resp = await fetch('/api/interpretar-puesta-voz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto: textoLimpio,
          naves: naves.map(n => ({ id: n.id, codigo: n.codigo, nombre: n.nombre }))
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
      console.error('Error procesando voz:', err);
      setErrorVoz('No se pudo conectar con el asistente de voz. Comprueba tu conexión o introduce los datos manualmente.');
    } finally {
      setProcesando(false);
      procesandoRef.current = false;
    }
  };

  // Inicializar Web Speech Recognition si está soportado
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
          console.warn('Aviso de reconocimiento de voz:', event.error);
          setEscuchando(false);
          if (event.error === 'not-allowed') {
            setErrorVoz('Permiso de micrófono no habilitado. Puedes escribir o pegar el dictado manualmente.');
            setMostrarTextoManual(true);
          } else if (event.error === 'no-speech') {
            setErrorVoz('No se detectó voz. Vuelve a pulsar el micrófono e inténtalo de nuevo.');
          } else {
            setErrorVoz(`Aviso de micrófono (${event.error}). Puedes usar el campo de texto manual.`);
          }
        };

        recognition.onend = () => {
          setEscuchando(false);
          const finalTexto = transcripcionRef.current.trim();
          if (finalTexto && !procesandoRef.current) {
            // Auto-procesar cuando el usuario termina de hablar
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
        setErrorVoz('El reconocimiento de voz nativo no está disponible en este navegador. Utiliza la caja de texto manual.');
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
    onAplicarDatos({
      naveId: resultado.naveId || naves[0]?.id || '',
      totalRecogida: resultado.totalRecogida || 0,
      rotos: resultado.rotos || 0,
      sucios: resultado.sucios || 0,
      descarte: resultado.descarte || 0,
      xl: resultado.xl,
      l: resultado.l,
      m: resultado.m,
      s: resultado.s,
      observaciones: resultado.observaciones
    });
    setResultado(null);
    setTranscripcion('');
    transcripcionRef.current = '';
  };

  const probarEjemplo = (ejemplo: string) => {
    setTranscripcion(ejemplo);
    transcripcionRef.current = ejemplo;
    setTextoManual(ejemplo);
    procesarTextoDictado(ejemplo);
  };

  const naveDetectada = naves.find(n => n.id === resultado?.naveId);

  return (
    <div className="bg-gradient-to-br from-amber-500/10 via-amber-50 to-stone-50 border-2 border-amber-300 rounded-xl p-4 shadow-sm mb-4">
      {/* Cabecera del Asistente */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-500 text-white rounded-lg shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
              <span>Asistente de Voz Manos Libres</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-amber-200/80 text-amber-900 rounded font-semibold">
                Fase 1 · Puesta
              </span>
            </h4>
            <p className="text-xs text-stone-600">
              Dicta la puesta directamente desde la nave o clasificadora sin teclear
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMostrarTextoManual(!mostrarTextoManual)}
          className="text-xs text-stone-500 hover:text-stone-800 underline decoration-stone-300 hover:decoration-stone-600"
        >
          {mostrarTextoManual ? 'Ocultar teclado' : 'Escribir dictado'}
        </button>
      </div>

      {/* Botón Principal de Micrófono y Barra de Transcripción con Botón de Interpretar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <button
          type="button"
          onClick={toggleGrabacion}
          disabled={procesando}
          className={`flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl font-semibold text-sm transition-all shadow-sm ${
            escuchando
              ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-200 animate-pulse'
              : 'bg-amber-600 hover:bg-amber-700 text-white hover:shadow-md'
          } ${procesando ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {procesando ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Interpretando con IA...</span>
            </>
          ) : escuchando ? (
            <>
              <MicOff className="w-5 h-5" />
              <span>Detener y Procesar</span>
            </>
          ) : (
            <>
              <Mic className="w-5 h-5" />
              <span>Pulsar para Dictar por Voz</span>
            </>
          )}
        </button>

        {/* Indicador de Transcripción en Vivo con Botón Directo de Interpretar */}
        <div className="flex-1 bg-white border border-stone-200 rounded-xl px-3.5 py-2 min-h-[46px] flex items-center justify-between gap-2 text-sm">
          {escuchando ? (
            <div className="flex items-center gap-2 text-red-700 font-medium animate-pulse flex-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping shrink-0" />
              <span className="line-clamp-2">Escuchando... {transcripcion || 'Habla ahora con naturalidad'}</span>
            </div>
          ) : procesando ? (
            <div className="flex items-center gap-2 text-amber-800 flex-1">
              <Loader2 className="w-4 h-4 animate-spin text-amber-600 shrink-0" />
              <span className="text-xs sm:text-sm">Extrayendo nave, cantidad recogida y mermas...</span>
            </div>
          ) : transcripcion ? (
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-2 text-stone-800 flex-1 overflow-hidden">
                <Volume2 className="w-4 h-4 text-stone-400 shrink-0" />
                <input
                  type="text"
                  value={transcripcion}
                  onChange={(e) => {
                    setTranscripcion(e.target.value);
                    transcripcionRef.current = e.target.value;
                  }}
                  className="w-full text-xs sm:text-sm font-medium text-stone-900 border-0 focus:ring-0 p-0 focus:outline-none"
                  placeholder="Dictado..."
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => procesarTextoDictado(transcripcion)}
                  disabled={procesando || !transcripcion.trim()}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Interpretar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTranscripcion('');
                    transcripcionRef.current = '';
                    setResultado(null);
                  }}
                  className="p-1.5 text-stone-400 hover:text-stone-600 rounded-md hover:bg-stone-100"
                  title="Borrar dictado"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <span className="text-stone-400 text-xs sm:text-sm">
              Ejemplo: <strong className="text-stone-600 font-normal">"Recogidos dos mil cuatrocientos en nave 1, 20 rotos y 15 sucios"</strong>
            </span>
          )}
        </div>
      </div>

      {/* Errores o Avisos */}
      {errorVoz && (
        <div className="mt-2.5 p-2 bg-amber-100 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-700" />
          <span>{errorVoz}</span>
        </div>
      )}

      {/* Campo Manual de Texto (para escribir o corregir) */}
      {mostrarTextoManual && (
        <div className="mt-3 p-3 bg-white border border-stone-200 rounded-xl space-y-2">
          <label className="block text-xs font-semibold text-stone-700">
            Escribir o dictar manualmente:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={textoManual}
              onChange={(e) => setTextoManual(e.target.value)}
              placeholder="Ej: Recogida en nave 1 de 2500 huevos, 25 rotos y 10 sucios..."
              className="flex-1 text-sm border border-stone-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  procesarTextoDictado(textoManual);
                }
              }}
            />
            <button
              type="button"
              onClick={() => procesarTextoDictado(textoManual)}
              disabled={procesando || !textoManual.trim()}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Interpretar</span>
            </button>
          </div>
        </div>
      )}

      {/* Ejemplos de prueba rápida con un clic */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-stone-500">Pruebas con 1 clic:</span>
        <button
          type="button"
          onClick={() => probarEjemplo("He recogido 2.650 huevos en la nave 1, con 30 rotos y 12 sucios")}
          className="text-[11px] bg-white border border-stone-200 hover:border-amber-400 text-stone-700 px-2 py-0.5 rounded-md hover:bg-amber-50 transition-colors"
        >
          2.650 en nave 1 (30 rotos)
        </button>
        <button
          type="button"
          onClick={() => probarEjemplo("Nave 2 ecológica recogida de 1.400 huevos, 15 rotos y 5 de descarte")}
          className="text-[11px] bg-white border border-stone-200 hover:border-amber-400 text-stone-700 px-2 py-0.5 rounded-md hover:bg-amber-50 transition-colors"
        >
          1.400 en nave 2 (ecológica)
        </button>
        <button
          type="button"
          onClick={() => probarEjemplo("Puesta nave 1 total 3000 huevos con 500 XL, 1500 L, 800 M y 150 S, con 25 rotos")}
          className="text-[11px] bg-white border border-stone-200 hover:border-amber-400 text-stone-700 px-2 py-0.5 rounded-md hover:bg-amber-50 transition-colors"
        >
          Con calibres (XL, L, M, S)
        </button>
      </div>

      {/* Tarjeta de Confirmación de Datos Extraídos por IA */}
      {resultado && (
        <div className="mt-3 p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2.5 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Dictado interpretado con éxito ({metodoUsado === 'gemini_ai' ? 'Gemini IA' : 'Procesador Inteligente'})</span>
            </div>
            <button
              type="button"
              onClick={() => setResultado(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs underline"
            >
              Descartar
            </button>
          </div>

          <div className="text-xs text-emerald-950 font-medium bg-white/80 p-2 rounded-lg border border-emerald-200">
            {resultado.resumen || 'Datos listos para aplicar en el formulario.'}
          </div>

          {/* Resumen en fichas compactas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-white p-2 rounded-lg border border-emerald-100">
              <span className="text-[10px] uppercase text-stone-500 block">Nave</span>
              <strong className="text-stone-900 truncate block">
                {naveDetectada ? naveDetectada.nombre : resultado.naveId}
              </strong>
            </div>

            <div className="bg-white p-2 rounded-lg border border-emerald-100">
              <span className="text-[10px] uppercase text-stone-500 block">Recogida Total</span>
              <strong className="text-emerald-800 text-sm block">
                {resultado.totalRecogida.toLocaleString()} uds
              </strong>
            </div>

            <div className="bg-white p-2 rounded-lg border border-emerald-100">
              <span className="text-[10px] uppercase text-stone-500 block">Mermas (R/S/D)</span>
              <strong className="text-red-700 block">
                {resultado.rotos} rot. / {resultado.sucios} suc. / {resultado.descarte} desc.
              </strong>
            </div>

            <div className="bg-white p-2 rounded-lg border border-emerald-100">
              <span className="text-[10px] uppercase text-stone-500 block">Saldo Neto Apto</span>
              <strong className="text-stone-900 text-sm block">
                {Math.max(0, resultado.totalRecogida - (resultado.rotos + resultado.sucios + resultado.descarte)).toLocaleString()} uds
              </strong>
            </div>
          </div>

          {/* Botón de Aplicación Directa al Formulario */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleAplicar}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <span>Aplicar al Formulario y Revisar</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

