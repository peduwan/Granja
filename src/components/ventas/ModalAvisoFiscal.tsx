import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ModalAvisoFiscalProps {
  aviso: { titulo: string; mensaje: string } | null;
  onClose: () => void;
}

export const ModalAvisoFiscal: React.FC<ModalAvisoFiscalProps> = ({ aviso, onClose }) => {
  if (!aviso) return null;

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
        <div className="flex items-center gap-3 text-rose-700">
          <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h4 className="font-bold text-stone-900 text-sm leading-tight">
              {aviso.titulo}
            </h4>
            <span className="text-[11px] text-stone-500">Aviso del Sistema Fiscal Veri*Factu</span>
          </div>
        </div>

        <p className="text-xs text-stone-700 leading-relaxed bg-stone-50 p-3 rounded-xl border border-stone-200">
          {aviso.mensaje}
        </p>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
          >
            Entendido / Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
