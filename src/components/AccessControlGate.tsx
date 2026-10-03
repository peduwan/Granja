import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  LogOut,
  Sparkles,
  RefreshCw,
  KeyRound
} from 'lucide-react';
import { loginWithGoogle, logoutUser, UserProfile } from '../utils/firebase';
import { ConfiguracionEmpresa } from '../types';
import { ROOT_OWNER_EMAIL } from '../utils/storage';

interface AccessControlGateProps {
  config: ConfiguracionEmpresa;
  currentUser?: UserProfile | null;
  onSuccessLogin?: () => void;
}

export const AccessControlGate: React.FC<AccessControlGateProps> = ({
  config,
  currentUser,
  onSuccessLogin
}) => {
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [exitoMsg, setExitoMsg] = useState('');

  const isBlocked = currentUser && currentUser.isUnauthorized;

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    setExitoMsg('');
    setCargando(true);

    try {
      const res = await loginWithGoogle();
      if (res.success) {
        setExitoMsg('Identificación con Google verificada. Cargando explotación...');
        if (onSuccessLogin) onSuccessLogin();
      } else {
        setErrorMsg(res.error || 'Acceso denegado: tu cuenta no está en la lista de usuarios autorizados.');
      }
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setErrorMsg('Error al conectar con Google: ' + (err.message || 'Inténtelo de nuevo.'));
      }
    } finally {
      setCargando(false);
    }
  };

  const handleLogout = async () => {
    setCargando(true);
    try {
      await logoutUser();
      setErrorMsg('');
      setExitoMsg('');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F2EC] flex flex-col justify-between items-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-amber-500 selection:text-amber-950">
      {/* Cabecera Institucional Superior */}
      <header className="w-full max-w-2xl text-center pt-2 sm:pt-4">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100/90 border border-amber-300 text-amber-900 text-xs font-semibold shadow-xs mb-3">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
          <span>Sistema Oficial de Trazabilidad Ganadera y Facturación</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight">
          {config.nombreEmpresa || 'Granja Avícola y Centro de Embalaje'}
        </h1>
        <p className="text-xs sm:text-sm text-stone-600 mt-1 font-medium">
          Registro General Sanitario: <span className="font-mono font-bold text-stone-900 bg-stone-200/80 px-2 py-0.5 rounded">{config.registroSanitario || 'RGSEAA'}</span>
          {config.codigoREGA && (
            <span className="ml-2">
              • REGA: <span className="font-mono font-bold text-stone-900">{config.codigoREGA}</span>
            </span>
          )}
        </p>
      </header>

      {/* Tarjeta Central de Control de Acceso */}
      <main className="w-full max-w-md my-6 bg-white rounded-2xl shadow-xl border border-stone-200/90 overflow-hidden">
        {/* Barra superior de la tarjeta */}
        <div className={`p-6 text-white text-center relative ${
          isBlocked
            ? 'bg-gradient-to-r from-rose-950 via-rose-900 to-[#2c0b0b]'
            : 'bg-gradient-to-r from-amber-950 via-amber-900 to-[#2c150b]'
        }`}>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-black/30 mb-3 border ${
            isBlocked
              ? 'bg-gradient-to-br from-rose-400 to-rose-600 text-rose-950 border-rose-300/40'
              : 'bg-gradient-to-br from-amber-400 to-amber-600 text-amber-950 border-amber-300/40'
          }`}>
            {isBlocked ? <ShieldAlert className="w-7 h-7" /> : <Lock className="w-7 h-7" />}
          </div>

          <h2 className="text-xl font-bold tracking-tight text-white">
            {isBlocked ? 'Acceso No Autorizado' : 'Control de Acceso Seguro'}
          </h2>
          <p className="text-xs text-amber-100/80 mt-1 max-w-sm mx-auto">
            {isBlocked
              ? 'Esta cuenta no tiene autorización para acceder a los registros de la explotación.'
              : 'Acceso protegido exclusivo para el titular y personal autorizado mediante cuenta de Google.'}
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-5">
          {/* Mensajes de Alerta */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-xs text-rose-800 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="font-medium leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {exitoMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-xs text-emerald-900 animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="font-semibold">{exitoMsg}</div>
            </div>
          )}

          {/* VISTA A: USUARIO BLOQUEADO / NO AUTORIZADO */}
          {isBlocked ? (
            <div className="space-y-4">
              <div className="p-4 bg-rose-50/90 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-rose-800">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Cuenta no habilitada en la granja</span>
                </div>
                <p>
                  Has iniciado sesión con el correo de Google:
                </p>
                <div className="font-mono font-bold bg-white p-2 rounded-lg border border-rose-200 text-rose-950 truncate">
                  {currentUser?.email}
                </div>
                <p className="text-stone-700 leading-relaxed pt-1">
                  Por estrictos motivos de seguridad alimentaria y control de inspecciones, solo el propietario principal (<strong>{ROOT_OWNER_EMAIL}</strong>) puede dar de alta nuevos usuarios.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  id="btn-switch-google-account"
                  onClick={handleGoogleLogin}
                  disabled={cargando}
                  className="w-full py-3 px-4 bg-amber-800 hover:bg-amber-900 text-white font-bold rounded-xl shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2 text-xs"
                >
                  <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
                  <span>Probar con otra cuenta de Google</span>
                </button>

                <button
                  type="button"
                  id="btn-logout-gate"
                  onClick={handleLogout}
                  disabled={cargando}
                  className="w-full py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold rounded-xl border border-stone-300 transition-colors cursor-pointer flex items-center justify-center gap-2 text-xs"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            </div>
          ) : (
            /* VISTA B: INICIO DE SESIÓN CON GOOGLE */
            <div className="space-y-4">
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200/90 text-xs text-stone-600 space-y-2">
                <div className="flex items-center gap-2 text-stone-800 font-bold">
                  <KeyRound className="w-4 h-4 text-amber-700" />
                  <span>Autenticación de Identidad Oficial</span>
                </div>
                <p className="leading-relaxed">
                  El titular de la explotación (<strong>{ROOT_OWNER_EMAIL}</strong>) y los operarios autorizados deben identificarse con su cuenta de Google para garantizar la trazabilidad de cada registro.
                </p>
              </div>

              <button
                type="button"
                id="auth-google-btn-main"
                onClick={handleGoogleLogin}
                disabled={cargando}
                className="w-full py-3 px-4 bg-white hover:bg-stone-50 text-stone-800 font-bold rounded-xl border-2 border-stone-300 hover:border-amber-500 shadow-md flex items-center justify-center gap-3 transition-all cursor-pointer text-sm"
              >
                {cargando ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-amber-800/30 border-t-amber-800 rounded-full animate-spin" />
                    <span>Verificando permisos con Google...</span>
                  </span>
                ) : (
                  <>
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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
                    <span>Iniciar Sesión con Google</span>
                  </>
                )}
              </button>

              <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/80 text-[11px] text-stone-600 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Solo cuentas expresamente autorizadas por el propietario pueden ingresar.</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Pie de Página Institucional */}
      <footer className="w-full max-w-2xl text-center text-xs text-stone-500 py-2">
        <p className="flex items-center justify-center gap-1.5 flex-wrap">
          <span>{config.nombreEmpresa}</span>
          <span>•</span>
          <span>RGSEAA {config.registroSanitario || 'Pendiente'}</span>
          <span>•</span>
          <span>RD 226/2008 y Reg. (CE) 178/2002</span>
        </p>
      </footer>
    </div>
  );
};
