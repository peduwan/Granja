import React from 'react';
import { Receipt, FileText, Users, Package, ShoppingBag, Layers, AlertCircle } from 'lucide-react';
import { VentasFacturacionView } from './VentasFacturacionView';
import { ClientesView } from './ClientesView';
import { FormatosView } from './FormatosView';
import {
  Cliente,
  FormatoEnvase,
  LoteEnvasado,
  Albaran,
  Factura,
  ConfiguracionEmpresa,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration
} from '../types';

export type VentasSubTab = 'albaranes' | 'facturas' | 'clientes' | 'formatos';

interface VentasModuleProps {
  activeSubTab: VentasSubTab;
  onSelectSubTab: (tab: VentasSubTab) => void;
  // Datos y Handlers
  clientes: Cliente[];
  formatos: FormatoEnvase[];
  lotesEnvasados: LoteEnvasado[];
  albaranes: Albaran[];
  facturas: Factura[];
  contadorAlbaran: number;
  contadorFactura: number;
  contadorRectificativa: number;
  config: ConfiguracionEmpresa;
  fiscalRecordRefs?: FiscalRecordRef[];
  fiscalConfig?: FiscalConfiguration;
  onAddAlbaran: (albaran: Albaran, consumoEstuches: Record<string, number>) => void;
  onAddFacturaDirecta: (factura: Factura, consumoEstuches: Record<string, number>, fiscalRecordRef: FiscalRecordRef) => void;
  onFacturarAlbaranes: (factura: Factura, albaranesIds: string[], fiscalRecordRef: FiscalRecordRef) => void;
  onAddFacturaRectificativa: (rectificativa: Factura, reingresarStock: boolean, fiscalRecordRef: FiscalRecordRef) => Promise<void> | void;
  onDeleteAlbaran: (id: string) => void;
  onDeleteFactura: (id: string) => void;
  onAddCliente: (cliente: Cliente) => void;
  onUpdateCliente: (cliente: Cliente) => void;
  onDeleteCliente: (id: string) => void;
  onAddFormato: (formato: FormatoEnvase) => void;
  onUpdateFormato: (formato: FormatoEnvase) => void;
  onDeleteFormato: (id: string) => void;
}

export const VentasModule: React.FC<VentasModuleProps> = ({
  activeSubTab,
  onSelectSubTab,
  clientes,
  formatos,
  lotesEnvasados,
  albaranes,
  facturas,
  contadorAlbaran,
  contadorFactura,
  contadorRectificativa,
  config,
  fiscalRecordRefs,
  fiscalConfig,
  onAddAlbaran,
  onAddFacturaDirecta,
  onFacturarAlbaranes,
  onAddFacturaRectificativa,
  onDeleteAlbaran,
  onDeleteFactura,
  onAddCliente,
  onUpdateCliente,
  onDeleteCliente,
  onAddFormato,
  onUpdateFormato,
  onDeleteFormato
}) => {
  const albaranesPendientes = albaranes.filter(a => a.estado === 'pendiente_facturar').length;
  const clientesConRecargo = clientes.filter(c => c.recargoEquivalencia).length;

  const subTabs = [
    {
      id: 'albaranes' as const,
      label: 'Albaranes de Entrega',
      shortLabel: 'Albaranes',
      icon: FileText,
      badge: albaranesPendientes > 0 ? `${albaranesPendientes} pend.` : `${albaranes.length} total`,
      badgeHighlight: albaranesPendientes > 0,
      desc: 'Salidas y entrega en destino'
    },
    {
      id: 'facturas' as const,
      label: 'Facturas (Veri*Factu)',
      shortLabel: 'Facturas',
      icon: Receipt,
      badge: `${facturas.length} emitidas`,
      badgeHighlight: false,
      desc: 'IVA 4%, R.E. 0,5% y QR AEAT'
    },
    {
      id: 'clientes' as const,
      label: 'Cartera de Clientes',
      shortLabel: 'Clientes',
      icon: Users,
      badge: `${clientes.length} registrados`,
      badgeHighlight: false,
      desc: 'Régimen general y minoristas'
    },
    {
      id: 'formatos' as const,
      label: 'Formatos de Venta',
      shortLabel: 'Formatos',
      icon: Package,
      badge: `${formatos.length} formatos`,
      badgeHighlight: false,
      desc: 'Precios PVP, costes y docenas'
    }
  ];

  return (
    <div className="space-y-4">
      {/* Barra de Subnavegación del Módulo de Ventas */}
      <div className="bg-white border border-stone-200 rounded-2xl p-2 sm:p-2.5 shadow-xs sticky top-0 z-20 print:hidden backdrop-blur-md bg-white/95">
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 min-w-max">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 text-stone-700 font-bold text-xs uppercase tracking-wider border-r border-stone-200 mr-1">
              <ShoppingBag className="w-4 h-4 text-amber-700" />
              <span>Ventas</span>
            </div>

            {subTabs.map(tab => {
              const isActive = activeSubTab === tab.id;
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  type="button"
                  id={`ventas-tab-${tab.id}`}
                  onClick={() => onSelectSubTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-amber-700 text-white shadow-sm shadow-amber-900/20'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-amber-700'}`} />
                  <span className="hidden md:inline">{tab.label}</span>
                  <span className="md:hidden">{tab.shortLabel}</span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full hidden lg:inline-block ${
                      isActive
                        ? 'bg-amber-800 text-amber-100'
                        : tab.badgeHighlight
                        ? 'bg-amber-100 text-amber-900 font-bold'
                        : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {tab.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Contenido según la pestaña activa */}
      <div>
        {(activeSubTab === 'albaranes' || activeSubTab === 'facturas') && (
          <VentasFacturacionView
            clientes={clientes}
            formatos={formatos}
            lotesEnvasados={lotesEnvasados}
            albaranes={albaranes}
            facturas={facturas}
            contadorAlbaran={contadorAlbaran}
            contadorFactura={contadorFactura}
            contadorRectificativa={contadorRectificativa}
            config={config}
            fiscalRecordRefs={fiscalRecordRefs}
            fiscalConfig={fiscalConfig}
            vistaInicial={activeSubTab}
            onAddAlbaran={onAddAlbaran}
            onAddFacturaDirecta={onAddFacturaDirecta}
            onFacturarAlbaranes={onFacturarAlbaranes}
            onAddFacturaRectificativa={onAddFacturaRectificativa}
            onDeleteAlbaran={onDeleteAlbaran}
            onDeleteFactura={onDeleteFactura}
          />
        )}

        {activeSubTab === 'clientes' && (
          <ClientesView
            clientes={clientes}
            albaranes={albaranes}
            facturas={facturas}
            config={config}
            onAddCliente={onAddCliente}
            onUpdateCliente={onUpdateCliente}
            onDeleteCliente={onDeleteCliente}
          />
        )}

        {activeSubTab === 'formatos' && (
          <FormatosView
            formatos={formatos}
            lotesEnvasados={lotesEnvasados}
            onAddFormato={onAddFormato}
            onUpdateFormato={onUpdateFormato}
            onDeleteFormato={onDeleteFormato}
          />
        )}
      </div>
    </div>
  );
};
