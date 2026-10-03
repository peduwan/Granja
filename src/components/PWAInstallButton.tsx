import React, { useState } from 'react';
import { Download, Smartphone, Share, PlusSquare, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'header' | 'floating' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'header'
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [showGenericModal, setShowGenericModal] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  // If already running inside standalone PWA window, hide install buttons
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const success = await install();
      if (success) {
        setInstallSuccess(true);
        setTimeout(() => setInstallSuccess(false), 4000);
      }
    } else if (isIOS) {
      setShowIOSModal(true);
    } else {
      setShowGenericModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className={`inline-flex items-center gap-2 font-bold transition-all shadow-xs cursor-pointer ${
          variant === 'header'
            ? 'px-3 py-1.5 rounded-xl text-xs bg-amber-600 hover:bg-amber-700 text-white active:scale-95 border border-amber-700/30'
            : 'px-4 py-2.5 rounded-xl text-sm bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white shadow-md hover:shadow-lg active:scale-95'
        } ${className}`}
        title="Instalar aplicación en el dispositivo"
      >
        <Download className="w-3.5 h-3.5 animate-bounce" />
        <span>Instalar App</span>
      </button>

      {/* iOS Safari Instruction Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm p-6 bg-white rounded-2xl shadow-2xl border border-stone-200 text-stone-800 space-y-4">
            <button
              onClick={() => setShowIOSModal(false)}
              className="absolute top-3.5 right-3.5 p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Instalar en iPhone / iPad</h3>
                <p className="text-xs text-stone-500">Acceso directo como app nativa</p>
              </div>
            </div>

            <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3 text-xs text-stone-700">
              <div className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold shrink-0">
                  1
                </span>
                <p className="leading-snug">
                  Pulsa el botón <strong>Compartir</strong> <Share className="inline w-3.5 h-3.5 text-blue-600 align-baseline" /> en la barra inferior de Safari.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold shrink-0">
                  2
                </span>
                <p className="leading-snug">
                  Baja y selecciona <strong>Añadir a la pantalla de inicio</strong> <PlusSquare className="inline w-3.5 h-3.5 text-stone-700 align-baseline" />.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold shrink-0">
                  3
                </span>
                <p className="leading-snug">
                  Pulsa <strong>Añadir</strong> arriba a la derecha. ¡Listo para usar incluso sin conexión!
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Generic Browser Guide Modal when beforeinstallprompt has not triggered yet */}
      {showGenericModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm p-6 bg-white rounded-2xl shadow-2xl border border-stone-200 text-stone-800 space-y-4">
            <button
              onClick={() => setShowGenericModal(false)}
              className="absolute top-3.5 right-3.5 p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Instalar en el Navegador</h3>
                <p className="text-xs text-stone-500">Chrome, Edge, Brave o Safari</p>
              </div>
            </div>

            <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-2.5 text-xs text-stone-700">
              <p className="leading-relaxed">
                Puedes instalar <strong>Gestión Avícola</strong> directamente como aplicación independiente en tu ordenador o móvil:
              </p>
              <ul className="list-disc pl-4 space-y-1.5 text-stone-600">
                <li>
                  En <strong>Chrome / Edge</strong> en ordenador: pulsa el icono de instalación <Download className="inline w-3 h-3 text-stone-800 align-baseline" /> en el extremo derecho de la barra de direcciones o en el menú de tres puntos (<strong>Instalar aplicación</strong>).
                </li>
                <li>
                  En <strong>Android</strong>: abre el menú ⋮ y pulsa <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => setShowGenericModal(false)}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {installSuccess && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-emerald-700 text-white rounded-2xl shadow-xl animate-in slide-in-from-bottom-3 duration-300">
          <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
          <div className="text-xs">
            <strong className="block font-bold">¡Aplicación instalada con éxito!</strong>
            <span>Ya tienes acceso directo desde tu escritorio o pantalla de inicio.</span>
          </div>
        </div>
      )}
    </>
  );
};
