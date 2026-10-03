import React from 'react';
import { Egg, Package, Home, Building2, Layers, CheckCircle2 } from 'lucide-react';
import { PuestaDiariaView } from './PuestaDiariaView';
import { EnvasadoView } from './EnvasadoView';
import { NavesView } from './NavesView';
import { CentroEnvasadoView } from './CentroEnvasadoView';
import {
  Nave,
  LotePuesta,
  LoteEnvasado,
  FormatoEnvase,
  Albaran,
  Factura,
  ConfiguracionEmpresa
} from '../types';

export type ProduccionSubTab = 'puesta' | 'envasado' | 'naves' | 'centro';

interface ProduccionModuleProps {
  activeSubTab: ProduccionSubTab;
  onSelectSubTab: (tab: ProduccionSubTab) => void;
  // Datos y Handlers
  naves: Nave[];
  lotesPuesta: LotePuesta[];
  lotesEnvasados: LoteEnvasado[];
  formatos: FormatoEnvase[];
  albaranes: Albaran[];
  facturas: Factura[];
  config: ConfiguracionEmpresa;
  onAddLotePuesta: (lote: LotePuesta) => void;
  onDeleteLotePuesta: (id: string) => void;
  onAddLoteEnvasado: (lote: LoteEnvasado, consumoLotes: Record<string, number>) => void;
  onDeleteLoteEnvasado: (id: string) => void;
  onAddNave: (nave: Nave) => void;
  onUpdateNave: (nave: Nave) => void;
  onDeleteNave: (id: string) => void;
  onUpdateConfig: (cfg: ConfiguracionEmpresa) => void;
}

export const ProduccionModule: React.FC<ProduccionModuleProps> = ({
  activeSubTab,
  onSelectSubTab,
  naves,
  lotesPuesta,
  lotesEnvasados,
  formatos,
  albaranes,
  facturas,
  config,
  onAddLotePuesta,
  onDeleteLotePuesta,
  onAddLoteEnvasado,
  onDeleteLoteEnvasado,
  onAddNave,
  onUpdateNave,
  onDeleteNave,
  onUpdateConfig
}) => {
  // Existencias calculadas
  const huevosDisponiblesAlmacen = lotesPuesta.reduce((acc, l) => acc + (l.huevosDisponibles || 0), 0);
  const estuchesListosCamara = lotesEnvasados.reduce((acc, l) => acc + (l.estuchesDisponibles || 0), 0);
  const navesActivas = naves.filter(n => n.activa !== false).length;

  const subTabs = [
    {
      id: 'puesta' as const,
      label: 'Puesta Diaria',
      shortLabel: 'Puesta',
      icon: Egg,
      badge: `${huevosDisponiblesAlmacen.toLocaleString()} huevos disp.`,
      desc: 'Recolección y lotes diarios'
    },
    {
      id: 'envasado' as const,
      label: 'Envasado y Calibrado',
      shortLabel: 'Envasado',
      icon: Package,
      badge: `${estuchesListosCamara.toLocaleString()} estuches`,
      desc: 'Multilote, FIFO y etiquetas'
    },
    {
      id: 'naves' as const,
      label: 'Naves y REGA',
      shortLabel: 'Naves',
      icon: Home,
      badge: `${navesActivas} ${navesActivas === 1 ? 'activa' : 'activas'}`,
      desc: 'Instalaciones y capacidad censal'
    },
    {
      id: 'centro' as const,
      label: 'Centro de Envasado',
      shortLabel: 'Centro',
      icon: Building2,
      badge: config.registroSanitario || 'RGSEAA',
      desc: 'Datos fiscales y registros'
    }
  ];

  return (
    <div className="space-y-4">
      {/* Barra de Subnavegación del Módulo de Producción */}
      <div className="bg-white border border-stone-200 rounded-2xl p-2 sm:p-2.5 shadow-xs sticky top-0 z-20 print:hidden backdrop-blur-md bg-white/95">
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 min-w-max">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 text-stone-700 font-bold text-xs uppercase tracking-wider border-r border-stone-200 mr-1">
              <Layers className="w-4 h-4 text-amber-700" />
              <span>Producción</span>
            </div>

            {subTabs.map(tab => {
              const isActive = activeSubTab === tab.id;
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  type="button"
                  id={`produccion-tab-${tab.id}`}
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

      {/* Contenido Dinámico de la Pestaña Activa */}
      <div>
        {activeSubTab === 'puesta' && (
          <PuestaDiariaView
            naves={naves}
            lotesPuesta={lotesPuesta}
            lotesEnvasados={lotesEnvasados}
            config={config}
            onAddLotePuesta={onAddLotePuesta}
            onDeleteLotePuesta={onDeleteLotePuesta}
          />
        )}

        {activeSubTab === 'envasado' && (
          <EnvasadoView
            formatos={formatos}
            naves={naves}
            lotesPuesta={lotesPuesta}
            lotesEnvasados={lotesEnvasados}
            albaranes={albaranes}
            facturas={facturas}
            contadorEnvasado={config.contadorEnvasado}
            config={config}
            registroSanitario={config.registroSanitario}
            nombreEmpresa={config.nombreEmpresa}
            onAddLoteEnvasado={onAddLoteEnvasado}
            onDeleteLoteEnvasado={onDeleteLoteEnvasado}
          />
        )}

        {activeSubTab === 'naves' && (
          <NavesView
            naves={naves}
            lotesPuesta={lotesPuesta}
            codigoREGADefault={config.codigoREGA}
            onAddNave={onAddNave}
            onUpdateNave={onUpdateNave}
            onDeleteNave={onDeleteNave}
          />
        )}

        {activeSubTab === 'centro' && (
          <CentroEnvasadoView
            config={config}
            onUpdateConfig={onUpdateConfig}
          />
        )}
      </div>
    </div>
  );
};
