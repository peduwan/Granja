import React, { useState } from 'react';
import { ShieldCheck, Lock, X, CheckCircle2, AlertCircle, RefreshCw, LogOut } from 'lucide-react';
import { loginWithGoogle, logoutUser, UserProfile } from '../utils/firebase';
import { ROOT_OWNER_EMAIL } from '../utils/storage';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserProfile | null;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [exitoMsg, setExitoMsg] = useState('');

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    setCargando(true);
    try {
      const res = await loginWithGoogle();
      if (res.success) {
        setExitoMsg('Cuenta verificada correctamente.');
        setTimeout(() => onClose(), 800);
      } else {
        setErrorMsg(res.error || 'La cuenta no tiene permisos de acceso.');
      }
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setErrorMsg('Error al conectar con Google: ' + (err.message || 'Intente de nuevo.'));
      }
    } finally {
      setCargando(false);
    }
  };

  const handleLogout = async () => {
    setCargando(true);
    try {
      await logoutUser();
      onClose();
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-5 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Cabecera del Modal */}
        <div className="text-center space-y-1.5">
          <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto border border-amber-200 shadow-inner">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-black text-stone-900">
            {currentUser ? 'Cuenta Activa' : 'Iniciar Sesión'}
          </h3>
          <p className="text-xs text-stone-500">
            Control de acceso protegido con Google Identity
          </p>
        </div>

        {/* Notificaciones de error o éxito */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {exitoMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{exitoMsg}</span>
          </div>
        )}

        {currentUser ? (
          <div className="space-y-4">
            <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1">
              <div className="text-stone-500">Conectado como:</div>
              <div className="font-bold text-stone-900 text-sm truncate">{currentUser.displayName || currentUser.email}</div>
              <div className="font-mono text-stone-600 text-[11px] truncate">{currentUser.email}</div>
              <div className="pt-1">
                <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-900 font-bold rounded-md uppercase text-[10px]">
                  {currentUser.role === 'propietario' ? '👑 Propietario' : currentUser.role === 'admin' ? 'Administrador' : 'Operario'}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={cargando}
                className="flex-1 py-2.5 px-3 bg-white hover:bg-stone-50 text-stone-800 font-semibold rounded-xl border border-stone-300 text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Cambiar de cuenta</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={cargando}
                className="flex-1 py-2.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-xl border border-rose-200 text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-stone-600 text-center leading-relaxed">
              Inicia sesión con tu cuenta de Google. Solo el propietario (<strong>{ROOT_OWNER_EMAIL}</strong>) y las cuentas habilitadas por él tienen acceso a los registros.
            </p>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={cargando}
              className="w-full py-3 px-4 bg-white hover:bg-stone-50 text-stone-800 font-bold rounded-xl border-2 border-stone-300 hover:border-amber-500 shadow-sm flex items-center justify-center gap-3 transition-colors cursor-pointer text-xs"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Acceder con Google</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
