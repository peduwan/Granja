import React, { useRef, useState } from 'react';
import {
  Egg,
  Package,
  Truck,
  Receipt,
  Users,
  Home,
  Building2,
  FileText,
  ShoppingBag,
  Download,
  Upload,
  RotateCcw,
  Cloud,
  CloudOff,
  LogIn,
  LogOut,
  User as UserIcon,
  Menu,
  X,
  Layers,
  Archive,
  FileSpreadsheet,
  ChevronRight,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import { AppData } from '../types';
import { UserProfile } from '../utils/firebase';
import { PWAInstallButton } from './PWAInstallButton';

export type MainModule = 'produccion' | 'ventas' | 'trazabilidad' | 'usuarios';

export interface SidebarProps {
  activeModule: MainModule;
  produccionSubTab: 'puesta' | 'envasado' | 'naves' | 'centro';
  ventasSubTab: 'albaranes' | 'facturas' | 'clientes' | 'formatos';
  onNavigate: (module: MainModule, subTab?: string) => void;
  data: AppData;
  user: UserProfile | null;
  isOnline: boolean;
  isSyncing: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  onOpenZeroDayModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  produccionSubTab,
  ventasSubTab,
  onNavigate,
  data,
  user,
  isOnline,
  isSyncing,
  onOpenAuth,
  onLogout,
  onExport,
  onImport,
  onReset,
  onOpenZeroDayModal
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cálculos de existencias y albaranes
  const totalHuevosPuestaDisponibles = data.lotesPuesta.reduce((acc, lp) => acc + (lp.huevosDisponibles || 0), 0);
  const totalEstuchesDisponibles = data.lotesEnvasados.reduce((acc, le) => acc + (le.estuchesDisponibles || 0), 0);
  const albaranesPendientes = data.albaranes.filter(a => a.estado === 'pendiente_facturar').length;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
  };

  const handleNavClick = (module: MainModule, subTab?: string) => {
    onNavigate(module, subTab);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Barra superior translúcida para Móviles (< lg) */}
      <div className="lg:hidden apple-toolbar-glass text-neutral-900 dark:text-neutral-100 px-4 py-3 flex items-center justify-between sticky top-0 z-30 print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Egg className="w-5 h-5 fill-amber-500/30" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight leading-tight line-clamp-1">
              {data.config.nombreEmpresa}
            </h1>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
              RGSEAA: {data.config.registroSanitario}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PWAInstallButton variant="header" className="hidden sm:inline-flex text-[11px] py-1 px-2.5" />

          {user ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
              <Cloud className="w-3 h-3" strokeWidth={2} />
              <span className="hidden sm:inline">Nube</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-2 py-0.5 rounded-full font-medium">
              <CloudOff className="w-3 h-3 text-neutral-400" strokeWidth={2} />
              <span className="hidden sm:inline">Offline</span>
            </span>
          )}

          <button
            type="button"
            id="mobile-menu-toggle-btn"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 cursor-pointer"
            aria-label="Abrir menú de navegación"
          >
            {mobileOpen ? <X className="w-5 h-5" strokeWidth={1.75} /> : <Menu className="w-5 h-5" strokeWidth={1.75} />}
          </button>
        </div>
      </div>

      {/* Backdrop para cerrar el menú en móviles */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Menú Lateral (Sidebar Principal macOS HIG) */}
      <aside
        id="farm-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-50 w-72 apple-panel-glass text-neutral-800 dark:text-neutral-200 border-r border-black/[0.08] dark:border-white/[0.08] flex flex-col justify-between transition-transform duration-200 ease-out lg:translate-x-0 lg:static lg:h-screen lg:sticky lg:top-0 print:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Cabecera macOS: Traffic lights + Identidad de Explotación */}
        <div className="p-4 border-b border-black/[0.06] dark:border-white/[0.06]">
          {/* Traffic light dots discretos */}
          <div className="hidden lg:flex items-center gap-2 mb-3 select-none">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e] inline-block shadow-2xs" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24] inline-block shadow-2xs" />
            <span className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1aab29] inline-block shadow-2xs" />
            <span className="text-[10px] text-neutral-400 font-medium ml-2 tracking-wide">SIF v2.0</span>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white shadow-xs shrink-0">
                <Egg className="w-5 h-5 fill-white/20" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white tracking-tight leading-snug truncate" title={data.config.nombreEmpresa}>
                  {data.config.nombreEmpresa}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-mono font-medium text-neutral-500 dark:text-neutral-400 truncate">
                    {data.config.registroSanitario}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              <X className="w-5 h-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Zona Central: Navegación de módulos estilo macOS Sidebar */}
        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4 text-[13px] no-scrollbar">
          
          {/* SECCIÓN 1: PRODUCCIÓN */}
          <div>
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none">
              Producción
            </div>
            <div className="mt-1 space-y-0.5">
              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'puesta')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'puesta'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Egg className={`w-4 h-4 shrink-0 ${activeModule === 'produccion' && produccionSubTab === 'puesta' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Puesta Diaria</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">
                  {totalHuevosPuestaDisponibles > 0 ? `${totalHuevosPuestaDisponibles.toLocaleString()}h` : '0h'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'envasado')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'envasado'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Package className={`w-4 h-4 shrink-0 ${activeModule === 'produccion' && produccionSubTab === 'envasado' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Envasado y FIFO</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">
                  {totalEstuchesDisponibles > 0 ? `${totalEstuchesDisponibles.toLocaleString()} est.` : '0'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'naves')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'naves'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Home className={`w-4 h-4 shrink-0 ${activeModule === 'produccion' && produccionSubTab === 'naves' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Naves y REGA</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">{data.naves.length}</span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'centro')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'centro'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Building2 className={`w-4 h-4 shrink-0 ${activeModule === 'produccion' && produccionSubTab === 'centro' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Datos Centro</span>
                </div>
              </button>
            </div>
          </div>

          {/* SECCIÓN 2: VENTAS Y FACTURACIÓN */}
          <div>
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none flex items-center justify-between">
              <span>Ventas y Fiscal</span>
              {albaranesPendientes > 0 && (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  {albaranesPendientes} pend.
                </span>
              )}
            </div>
            <div className="mt-1 space-y-0.5">
              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'albaranes')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'albaranes'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className={`w-4 h-4 shrink-0 ${activeModule === 'ventas' && ventasSubTab === 'albaranes' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Albaranes</span>
                </div>
                {albaranesPendientes > 0 ? (
                  <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    {albaranesPendientes}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">{data.albaranes.length}</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'facturas')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'facturas'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Receipt className={`w-4 h-4 shrink-0 ${activeModule === 'ventas' && ventasSubTab === 'facturas' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Facturas Veri*Factu</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" strokeWidth={2} />
                  <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">{data.facturas.length}</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'clientes')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'clientes'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Users className={`w-4 h-4 shrink-0 ${activeModule === 'ventas' && ventasSubTab === 'clientes' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Clientes</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">{data.clientes.length}</span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'formatos')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'formatos'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Package className={`w-4 h-4 shrink-0 ${activeModule === 'ventas' && ventasSubTab === 'formatos' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Formatos de Venta</span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">{data.formatos.length}</span>
              </button>
            </div>
          </div>

          {/* SECCIÓN 3: TRAZABILIDAD Y REGISTRO OFICIAL */}
          <div>
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none">
              Sanitario & Trazabilidad
            </div>
            <div className="mt-1 space-y-0.5">
              <button
                type="button"
                onClick={() => handleNavClick('trazabilidad')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeModule === 'trazabilidad'
                    ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Truck className={`w-4 h-4 shrink-0 ${activeModule === 'trazabilidad' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="truncate">Libro RD 226/2008</span>
                </div>
                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Oficial</span>
              </button>
            </div>
          </div>

          {/* SECCIÓN 4: USUARIOS GOOGLE (Solo Admin/Propietario) */}
          {(user?.role === 'propietario' || user?.role === 'admin') && (
            <div>
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none">
                Seguridad & Equipo
              </div>
              <div className="mt-1 space-y-0.5">
                <button
                  type="button"
                  id="sidebar-nav-usuarios"
                  onClick={() => handleNavClick('usuarios')}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                    activeModule === 'usuarios'
                      ? 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-semibold shadow-2xs'
                      : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Users className={`w-4 h-4 shrink-0 ${activeModule === 'usuarios' ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                    <span className="truncate">Usuarios Google</span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500">
                    {data.usuariosAutorizados?.length || 1}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Tarjeta de Existencias en Vivo (Apple Card Style) */}
          <div className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-neutral-400" strokeWidth={1.75} />
                Existencias Almacén
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="En tiempo real" />
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                <span className="text-[11px]">Huevos frescos:</span>
                <span className="font-semibold text-neutral-900 dark:text-white tabular-nums font-mono">
                  {totalHuevosPuestaDisponibles.toLocaleString()} <span className="text-[10px] font-normal text-neutral-400">h</span>
                </span>
              </div>

              <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                <span className="text-[11px]">Estuches listos:</span>
                <span className="font-semibold text-neutral-900 dark:text-white tabular-nums font-mono">
                  {totalEstuchesDisponibles.toLocaleString()} <span className="text-[10px] font-normal text-neutral-400">est.</span>
                </span>
              </div>
            </div>
          </div>

          {/* Gestión de Datos y Copias */}
          <div className="pt-1">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none">
              Datos y Copias
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
              />
              <button
                type="button"
                id="sidebar-export-btn"
                onClick={onExport}
                title="Descargar copia de seguridad en JSON"
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-black/[0.03] hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.09] rounded-lg border border-black/[0.05] dark:border-white/[0.08] transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-neutral-500" strokeWidth={1.75} />
                <span>Exportar</span>
              </button>

              <button
                type="button"
                id="sidebar-import-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Cargar y restaurar datos desde archivo JSON"
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-black/[0.03] hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.09] rounded-lg border border-black/[0.05] dark:border-white/[0.08] transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-neutral-500" strokeWidth={1.75} />
                <span>Importar</span>
              </button>
            </div>

            {onOpenZeroDayModal && (user?.role === 'propietario' || user?.role === 'admin') && (
              <button
                type="button"
                id="sidebar-dia-cero-btn"
                onClick={onOpenZeroDayModal}
                title="Reiniciar y empezar desde cero sin datos"
                className="w-full mt-2 flex items-center justify-center gap-2 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/20 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.75} />
                <span>Iniciar Día Cero</span>
              </button>
            )}

            <button
              type="button"
              id="sidebar-reset-btn"
              onClick={onReset}
              title="Restablecer datos de ejemplo"
              className="w-full mt-1 flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3 text-neutral-400" strokeWidth={1.75} />
              <span>Cargar datos demo</span>
            </button>
          </div>
        </div>

        {/* Pie del Sidebar: Apple Account Card Style */}
        <div className="p-3 border-t border-black/[0.06] dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.015]">
          {user ? (
            <div className="p-2.5 rounded-xl bg-white/60 dark:bg-neutral-800/60 border border-black/[0.05] dark:border-white/[0.08] shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                  <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                    {isOnline ? 'Cloud Firestore' : 'Modo Local'}
                  </span>
                  {isSyncing && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                  )}
                </div>

                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider bg-black/5 dark:bg-white/10 text-neutral-700 dark:text-neutral-300">
                  {user.role === 'propietario' ? 'Propietario' : user.role === 'admin' ? 'Admin' : 'Operario'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-white text-xs font-semibold shrink-0 shadow-2xs">
                    {user.displayName ? user.displayName.charAt(0).toUpperCase() : (user.email?.charAt(0).toUpperCase() || 'U')}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-neutral-900 dark:text-white truncate max-w-[130px]">
                      {user.displayName || user.email?.split('@')[0]}
                    </p>
                    <p className="text-[10px] text-neutral-400 truncate max-w-[130px]">
                      {user.email}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  id="sidebar-logout-btn"
                  onClick={onLogout}
                  title="Cerrar sesión"
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                id="sidebar-login-btn"
                onClick={onOpenAuth}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold apple-btn-primary cursor-pointer"
              >
                <LogIn className="w-4 h-4" strokeWidth={1.75} />
                <span>Iniciar Sesión / Nube</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
