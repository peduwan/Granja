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
  Sparkles
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
      {/* Barra superior solo para Móviles (< lg) */}
      <div className="lg:hidden bg-amber-950 text-amber-50 border-b border-amber-900/80 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-md print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300">
            <Egg className="w-5 h-5 fill-amber-400 text-amber-200" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight leading-tight line-clamp-1">
              {data.config.nombreEmpresa}
            </h1>
            <p className="text-[10px] text-amber-300 font-mono">
              RGSEAA: {data.config.registroSanitario}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PWAInstallButton variant="header" className="hidden sm:inline-flex text-[11px] py-1 px-2.5" />

          {user ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-amber-900/70 border border-amber-800/80 px-2 py-1 rounded-md">
              <Cloud className="w-3 h-3" />
              <span className="hidden sm:inline">Nube</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-amber-300 bg-amber-900/70 border border-amber-800/80 px-2 py-1 rounded-md">
              <CloudOff className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">Offline</span>
            </span>
          )}

          <button
            type="button"
            id="mobile-menu-toggle-btn"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-lg bg-amber-900 hover:bg-amber-800 text-amber-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
            aria-label="Abrir menú de navegación"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Backdrop para cerrar el menú en móviles */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-stone-950/70 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Menú Lateral (Sidebar Principal) */}
      <aside
        id="farm-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-50 w-72 bg-gradient-to-b from-amber-950 via-[#2c150b] to-[#1c0d06] text-amber-50 border-r border-amber-900/60 flex flex-col justify-between shadow-2xl transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:h-screen lg:sticky lg:top-0 print:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Parte Superior: Marca, Empresa y Registro */}
        <div className="p-4 border-b border-amber-900/50">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-amber-950 shadow-md shadow-amber-950/40 shrink-0">
                <Egg className="w-6 h-6 fill-amber-950 text-amber-900" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-white tracking-tight leading-snug truncate" title={data.config.nombreEmpresa}>
                  {data.config.nombreEmpresa}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-mono font-semibold bg-amber-900/80 text-amber-200 px-1.5 py-0.5 rounded border border-amber-800/80">
                    {data.config.registroSanitario}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-1.5 text-amber-300 hover:text-white rounded-lg hover:bg-amber-900/50 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-[11px] text-amber-200/70 mt-2.5 leading-tight">
            Gestión de Granja y Centro de Embalaje • Trazabilidad y Facturación
          </p>
        </div>

        {/* Zona Central Scrolleable: Navegación por Módulos y Subaccesos */}
        <div className="flex-1 overflow-y-auto py-3 px-3 space-y-4 text-sm no-scrollbar">
          {/* 1. MÓDULO DE PRODUCCIÓN */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => handleNavClick('produccion')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left cursor-pointer ${
                activeModule === 'produccion'
                  ? 'bg-amber-500 text-amber-950 font-bold shadow-md'
                  : 'text-amber-100 hover:text-white hover:bg-amber-900/40 font-semibold'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  activeModule === 'produccion' ? 'bg-amber-950/20 text-amber-950' : 'bg-amber-900/60 text-amber-300'
                }`}>
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider font-extrabold leading-tight">
                    1. Producción
                  </div>
                  <div className={`text-[10px] leading-tight ${activeModule === 'produccion' ? 'text-amber-950/80' : 'text-amber-300/70'}`}>
                    Puesta, envasado y naves
                  </div>
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 transition-transform ${activeModule === 'produccion' ? 'rotate-90 text-amber-950' : 'text-amber-400/50'}`} />
            </button>

            {/* Sub-enlaces de Producción */}
            <div className="pl-3 pr-1 py-1 space-y-0.5 border-l-2 border-amber-900/40 ml-4">
              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'puesta')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'puesta'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Egg className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Puesta Diaria</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">
                  {totalHuevosPuestaDisponibles > 0 ? `${totalHuevosPuestaDisponibles.toLocaleString()}h` : '0h'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'envasado')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'envasado'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Package className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Envasado y FIFO</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">
                  {totalEstuchesDisponibles > 0 ? `${totalEstuchesDisponibles.toLocaleString()} est.` : '0'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'naves')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'naves'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Home className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Naves y REGA</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">{data.naves.length}</span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('produccion', 'centro')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'produccion' && produccionSubTab === 'centro'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Datos Centro</span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. MÓDULO DE VENTAS */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => handleNavClick('ventas')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left cursor-pointer ${
                activeModule === 'ventas'
                  ? 'bg-amber-500 text-amber-950 font-bold shadow-md'
                  : 'text-amber-100 hover:text-white hover:bg-amber-900/40 font-semibold'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  activeModule === 'ventas' ? 'bg-amber-950/20 text-amber-950' : 'bg-amber-900/60 text-amber-300'
                }`}>
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider font-extrabold leading-tight">
                    2. Ventas
                  </div>
                  <div className={`text-[10px] leading-tight ${activeModule === 'ventas' ? 'text-amber-950/80' : 'text-amber-300/70'}`}>
                    Albaranes, facturas y clientes
                  </div>
                </div>
              </div>

              {albaranesPendientes > 0 ? (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                  activeModule === 'ventas' ? 'bg-amber-950 text-amber-300' : 'bg-amber-500 text-amber-950'
                }`}>
                  {albaranesPendientes} pend.
                </span>
              ) : (
                <ChevronRight className={`w-4 h-4 transition-transform ${activeModule === 'ventas' ? 'rotate-90 text-amber-950' : 'text-amber-400/50'}`} />
              )}
            </button>

            {/* Sub-enlaces de Ventas */}
            <div className="pl-3 pr-1 py-1 space-y-0.5 border-l-2 border-amber-900/40 ml-4">
              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'albaranes')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'albaranes'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Albaranes</span>
                </div>
                {albaranesPendientes > 0 && (
                  <span className="text-[10px] bg-amber-500/30 text-amber-200 font-bold px-1.5 py-0.2 rounded">
                    {albaranesPendientes}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'facturas')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'facturas'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Receipt className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Facturas Veri*Factu</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">{data.facturas.length}</span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'clientes')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'clientes'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Clientes</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">{data.clientes.length}</span>
              </button>

              <button
                type="button"
                onClick={() => handleNavClick('ventas', 'formatos')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                  activeModule === 'ventas' && ventasSubTab === 'formatos'
                    ? 'bg-amber-600/50 text-white font-bold'
                    : 'text-amber-200/80 hover:text-white hover:bg-amber-900/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Package className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="truncate">Formatos de Venta</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">{data.formatos.length}</span>
              </button>
            </div>
          </div>

          {/* 3. MÓDULO DE TRAZABILIDAD */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => handleNavClick('trazabilidad')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left cursor-pointer ${
                activeModule === 'trazabilidad'
                  ? 'bg-amber-500 text-amber-950 font-bold shadow-md'
                  : 'text-amber-100 hover:text-white hover:bg-amber-900/40 font-semibold'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  activeModule === 'trazabilidad' ? 'bg-amber-950/20 text-amber-950' : 'bg-amber-900/60 text-amber-300'
                }`}>
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider font-extrabold leading-tight">
                    3. Trazabilidad
                  </div>
                  <div className={`text-[10px] leading-tight ${activeModule === 'trazabilidad' ? 'text-amber-950/80' : 'text-amber-300/70'}`}>
                    Libro RD 226/2008 & 360°
                  </div>
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 transition-transform ${activeModule === 'trazabilidad' ? 'rotate-90 text-amber-950' : 'text-amber-400/50'}`} />
            </button>
          </div>

          {/* 4. MÓDULO DE GESTIÓN DE USUARIOS GOOGLE (Solo Propietario o Administrador) */}
          {(user?.role === 'propietario' || user?.role === 'admin') && (
            <div className="space-y-1">
              <button
                type="button"
                id="sidebar-nav-usuarios"
                onClick={() => handleNavClick('usuarios')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-left cursor-pointer ${
                  activeModule === 'usuarios'
                    ? 'bg-amber-500 text-amber-950 font-bold shadow-md'
                    : 'text-amber-100 hover:text-white hover:bg-amber-900/40 font-semibold'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    activeModule === 'usuarios' ? 'bg-amber-950/20 text-amber-950' : 'bg-amber-900/60 text-amber-300'
                  }`}>
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider font-extrabold leading-tight">
                      4. Usuarios Google
                    </div>
                    <div className={`text-[10px] leading-tight ${activeModule === 'usuarios' ? 'text-amber-950/80' : 'text-amber-300/70'}`}>
                      Control de accesos y roles
                    </div>
                  </div>
                </div>
                <span className="text-[10px] bg-amber-900/80 text-amber-200 font-mono px-1.5 py-0.5 rounded border border-amber-800/60">
                  {data.usuariosAutorizados?.length || 1}
                </span>
              </button>
            </div>
          )}

          {/* Panel de Estado y Existencias en Almacén */}
          <div className="bg-amber-950/60 rounded-xl p-3 border border-amber-900/70">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-amber-400" />
                Existencias en Vivo
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Actualizado en tiempo real" />
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between bg-amber-900/40 px-2.5 py-1.5 rounded-lg border border-amber-800/40">
                <span className="text-amber-200/80 text-[11px] flex items-center gap-1.5">
                  <Egg className="w-3 h-3 text-amber-400" /> Huevos almacén:
                </span>
                <span className="font-bold text-white text-xs">
                  {totalHuevosPuestaDisponibles.toLocaleString()} <span className="text-[10px] font-normal text-amber-300">uds</span>
                </span>
              </div>

              <div className="flex items-center justify-between bg-amber-900/40 px-2.5 py-1.5 rounded-lg border border-amber-800/40">
                <span className="text-amber-200/80 text-[11px] flex items-center gap-1.5">
                  <Archive className="w-3 h-3 text-amber-400" /> Estuches listos:
                </span>
                <span className="font-bold text-white text-xs">
                  {totalEstuchesDisponibles.toLocaleString()} <span className="text-[10px] font-normal text-amber-300">uds</span>
                </span>
              </div>

              <div className="flex items-center justify-between bg-amber-900/40 px-2.5 py-1.5 rounded-lg border border-amber-800/40">
                <span className="text-amber-200/80 text-[11px] flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3 h-3 text-amber-400" /> Alb. pendientes:
                </span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                  albaranesPendientes > 0 ? 'bg-amber-500/30 text-amber-200' : 'text-amber-400'
                }`}>
                  {albaranesPendientes}
                </span>
              </div>
            </div>
          </div>

          {/* Herramientas de Respaldo y Mantenimiento */}
          <div className="pt-1">
            <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-amber-400/70 block mb-1.5">
              Gestión de Datos y Copias
            </span>
            <div className="grid grid-cols-2 gap-1.5">
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
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-amber-100 bg-amber-900/50 hover:bg-amber-800/80 rounded-lg border border-amber-800/60 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-amber-300" />
                <span>Exportar</span>
              </button>

              <button
                type="button"
                id="sidebar-import-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Cargar y restaurar datos desde archivo JSON"
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-amber-100 bg-amber-900/50 hover:bg-amber-800/80 rounded-lg border border-amber-800/60 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-amber-300" />
                <span>Importar</span>
              </button>
            </div>

            {/* Botón especial Día Cero */}
            {onOpenZeroDayModal && (user?.role === 'propietario' || user?.role === 'admin') && (
              <button
                type="button"
                id="sidebar-dia-cero-btn"
                onClick={onOpenZeroDayModal}
                title="Reiniciar y empezar desde cero sin datos"
                className="w-full mt-2 flex items-center justify-center gap-2 px-2.5 py-2 text-xs font-bold text-amber-200 hover:text-white bg-gradient-to-r from-amber-900/80 to-amber-800/80 hover:from-amber-800 hover:to-amber-700 rounded-xl border border-amber-700/60 transition-all cursor-pointer shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Iniciar Día Cero (Sin datos)</span>
              </button>
            )}

            <button
              type="button"
              id="sidebar-reset-btn"
              onClick={onReset}
              title="Restablecer datos de ejemplo"
              className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] text-amber-300/80 hover:text-amber-100 hover:bg-amber-900/40 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3 text-amber-400" />
              <span>Cargar datos demo</span>
            </button>
          </div>

          {/* Botón de instalación PWA en escritorio / dispositivo */}
          <div className="pt-2 px-1">
            <PWAInstallButton
              variant="card"
              className="w-full justify-center text-xs py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 border border-amber-500/40 rounded-xl"
            />
          </div>
        </div>

        {/* Pie del Sidebar: Autenticación, Usuario y Nube */}
        <div className="p-3 border-t border-amber-900/60 bg-black/20">
          {user ? (
            <div className="bg-amber-950/70 border border-amber-800/80 p-2.5 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  {isOnline ? (
                    <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium" title="Conectado a Firebase en la nube">
                      <Cloud className="w-3.5 h-3.5" />
                      <span>Nube activa</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-300 text-xs font-medium" title="Sin conexión: trabajando en memoria local">
                      <CloudOff className="w-3.5 h-3.5" />
                      <span>Modo Local</span>
                    </span>
                  )}
                  {isSyncing && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping" title="Sincronizando..." />
                  )}
                </div>

                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase border tracking-wider ${
                  user.role === 'propietario'
                    ? 'bg-amber-400 text-amber-950 border-amber-300 shadow-xs'
                    : user.role === 'admin'
                    ? 'bg-indigo-300 text-indigo-950 border-indigo-200'
                    : 'bg-amber-900/90 text-amber-200 border-amber-700/80'
                }`}>
                  {user.role === 'propietario' ? 'Propietario' : user.role === 'admin' ? 'Admin' : user.role === 'lector' ? 'Inspector' : 'Operario'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1.5 border-t border-amber-900/60">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-amber-800/80 border border-amber-700/60 flex items-center justify-center text-amber-200 shrink-0">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate max-w-[125px]" title={user.email || ''}>
                      {user.displayName || user.email?.split('@')[0]}
                    </p>
                    <p className="text-[10px] text-amber-300/70 truncate max-w-[125px]" title={user.email || ''}>
                      {user.email}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  id="sidebar-logout-btn"
                  onClick={onLogout}
                  title="Cerrar sesión"
                  className="p-1.5 text-amber-300 hover:text-white hover:bg-amber-900/80 rounded-lg transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-amber-300 bg-amber-950/60 px-2.5 py-1.5 rounded-lg border border-amber-800/60">
                <span className="flex items-center gap-1.5">
                  <CloudOff className="w-3.5 h-3.5 text-amber-400" />
                  Modo Local (Offline)
                </span>
                <span className="text-[10px] text-amber-400 font-mono">Sin cuenta</span>
              </div>

              <button
                type="button"
                id="sidebar-login-btn"
                onClick={onOpenAuth}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-amber-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Iniciar Sesión / Nube</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
