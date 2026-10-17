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
      {/* Barra de Subnavegación estilo Apple Segmented Control */}
      <div className="apple-toolbar-glass rounded-2xl p-1.5 shadow-2xs sticky top-0 z-20 print:hidden flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 min-w-max">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-neutral-500 dark:text-neutral-400 font-semibold text-xs uppercase tracking-wider border-r border-black/[0.06] dark:border-white/[0.08] mr-1 select-none">
            <Layers className="w-4 h-4 text-neutral-400" strokeWidth={1.5} />
            <span>Producción</span>
          </div>

          <div className="apple-segmented-bar">
            {subTabs.map(tab => {
              const isActive = activeSubTab === tab.id;
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  type="button"
                  id={`produccion-tab-${tab.id}`}
                  onClick={() => onSelectSubTab(tab.id)}
                  className={`apple-segmented-btn flex items-center gap-2 cursor-pointer ${isActive ? 'active' : ''}`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-500' : 'text-neutral-400'}`} strokeWidth={1.75} />
                  <span className="hidden md:inline font-medium">{tab.label}</span>
                  <span className="md:hidden font-medium">{tab.shortLabel}</span>
                  <span className="text-[11px] font-mono tabular-nums opacity-60 hidden lg:inline-block">
                    · {tab.badge}
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
