/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Sidebar, MainModule } from './components/Sidebar';
import { ProduccionModule, ProduccionSubTab } from './components/ProduccionModule';
import { VentasModule, VentasSubTab } from './components/VentasModule';
import { TrazabilidadView } from './components/TrazabilidadView';
import { GestionUsuariosView } from './components/GestionUsuariosView';
import { AuthModal } from './components/AuthModal';
import { AccessControlGate } from './components/AccessControlGate';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  AppData,
  LotePuesta,
  LoteEnvasado,
  Albaran,
  Factura,
  OtraSalida,
  Cliente,
  FormatoEnvase,
  Nave,
  RegistroFacturacionVeriFactu,
  UsuarioAutorizado,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration
} from './types';
import { loadAppData, saveAppData, resetToInitialData, resetToZeroDayData, ROOT_OWNER_EMAIL, getDefaultFiscalConfig } from './utils/storage';
import {
  UserProfile,
  onAuthChange,
  logoutUser,
  syncFarmDataToCloud,
  subscribeToFarmCloudData
} from './utils/firebase';
import { Cloud, WifiOff, RefreshCw, CheckCircle2, Egg, Sparkles, AlertTriangle, X, ShieldAlert, Trash2 } from 'lucide-react';

export default function App() {
  const [data, setData] = useState<AppData>(() => loadAppData());
  const [activeModule, setActiveModule] = useState<MainModule>('produccion');
  const [produccionSubTab, setProduccionSubTab] = useState<ProduccionSubTab>('puesta');
  const [ventasSubTab, setVentasSubTab] = useState<VentasSubTab>('albaranes');

  // Estados de modales especiales
  const [showZeroDayModal, setShowZeroDayModal] = useState(false);
  const [showResetDemoModal, setShowResetDemoModal] = useState(false);
  const [zeroDayEmpresa, setZeroDayEmpresa] = useState('');
  const [zeroDayRega, setZeroDayRega] = useState('');
  const [zeroDayCentro, setZeroDayCentro] = useState('');
  const [toastNotification, setToastNotification] = useState<string | null>(null);

  const showAppToast = (msg: string) => {
    setToastNotification(msg);
    setTimeout(() => setToastNotification(null), 4500);
  };


  const handleNavigate = (module: MainModule, subTab?: string) => {
    setActiveModule(module);
    if (module === 'produccion' && subTab) {
      setProduccionSubTab(subTab as ProduccionSubTab);
    } else if (module === 'ventas' && subTab) {
      setVentasSubTab(subTab as VentasSubTab);
    }
  };

  // Estado de Usuario y Autenticación
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Estado de Conexión a Internet y Sincronización
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Flag para evitar que una actualización que viene de la nube dispare un bucle de escritura
  const isUpdatingFromCloudRef = useRef(false);

  // 1. Escuchar eventos de conexión a internet
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncMessage('Conexión reestablecida. Sincronizando con la nube...');
      setTimeout(() => setSyncMessage(null), 4000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncMessage('Trabajando en modo local offline (sin internet). Los cambios se guardan en este dispositivo.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Escuchar cambios de autenticación de Firebase
  useEffect(() => {
    const unsubscribeAuth = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  // 3. Sincronización en tiempo real desde Firestore cuando hay usuario conectado
  useEffect(() => {
    if (!user || !isOnline) return;

    setIsSyncing(true);
    const unsubscribeFirestore = subscribeToFarmCloudData(
      (cloudData) => {
        isUpdatingFromCloudRef.current = true;
        setData(cloudData);
        saveAppData(cloudData); // Guardar siempre en local también
        setIsSyncing(false);
        setTimeout(() => {
          isUpdatingFromCloudRef.current = false;
        }, 300);
      },
      (error) => {
        console.warn('Conexión Firestore remota en espera:', error);
        setIsSyncing(false);
      },
      () => {
        // Si la granja no tiene aún documento en Firestore, sincronizar los datos iniciales
        syncFarmDataToCloud(data, user.uid).finally(() => {
          setIsSyncing(false);
        });
      }
    );

    return () => {
      unsubscribeFirestore();
    };
  }, [user, isOnline]);

  // 4. Guardar siempre en LocalStorage Y enviar a la Nube (si conectado)
  useEffect(() => {
    saveAppData(data);

    // Si el cambio vino de la nube, no reenviarlo
    if (isUpdatingFromCloudRef.current) return;

    // Si hay usuario y conexión a internet, sincronizar con Firestore
    if (user && isOnline) {
      setIsSyncing(true);
      syncFarmDataToCloud(data, user.uid).then((ok) => {
        setIsSyncing(false);
      }).catch(() => {
        setIsSyncing(false);
      });
    }
  }, [data, user, isOnline]);

  // Handlers de Autenticación
  const handleLogout = async () => {
    try {
      await logoutUser();
      setUser(null);
      setSyncMessage('Sesión cerrada. El acceso a los datos ha sido bloqueado de forma segura.');
      setTimeout(() => setSyncMessage(null), 4000);
    } catch (e) {
      console.error('Error al cerrar sesión:', e);
    }
  };

  // Handlers para Puesta Diaria
  const handleAddLotePuesta = (nuevoLote: LotePuesta) => {
    setData(prev => ({
      ...prev,
      lotesPuesta: [nuevoLote, ...prev.lotesPuesta]
    }));
  };

  const handleDeleteLotePuesta = (id: string) => {
    const loteAEliminar = data.lotesPuesta.find(lp => lp.id === id);
    if (!loteAEliminar) return;

    // Validación de integridad: no eliminar registros de puesta que estén envasados
    const estaEnvasado = data.lotesEnvasados.some(le =>
      le.componentesLotes?.some(c => c.lotePuestaId === id || c.codigoLotePuesta === loteAEliminar.codigoLote)
    ) || (loteAEliminar.huevosDisponibles < loteAEliminar.huevosAptos);

    if (estaEnvasado) {
      alert(`No se puede eliminar el registro de puesta ${loteAEliminar.codigoLote} porque ya ha sido envasado en una o más órdenes. Para cumplir con la trazabilidad alimentaria oficial (Real Decreto 226/2008), los registros de puesta con envasado no pueden ser eliminados.`);
      return;
    }

    setData(prev => ({
      ...prev,
      lotesPuesta: prev.lotesPuesta.filter(l => l.id !== id)
    }));
  };

  // Handlers para Envasado y Multilote (con deducción de huevos de puesta)
  const handleAddLoteEnvasado = (nuevoLote: LoteEnvasado, consumoPorLotePuesta: Record<string, number>) => {
    setData(prev => {
      // Deducir huevos consumidos del stock disponible de cada lote de puesta
      const updatedLotesPuesta = prev.lotesPuesta.map(lp => {
        const consumo = consumoPorLotePuesta[lp.id];
        if (consumo) {
          const saldo = Math.max(0, lp.huevosDisponibles - consumo);
          return {
            ...lp,
            huevosDisponibles: saldo
          };
        }
        return lp;
      });

      return {
        ...prev,
        lotesPuesta: updatedLotesPuesta,
        lotesEnvasados: [nuevoLote, ...prev.lotesEnvasados],
        config: {
          ...prev.config,
          contadorEnvasado: prev.config.contadorEnvasado + 1
        }
      };
    });
  };

  const handleDeleteLoteEnvasado = (id: string) => {
    const loteAEliminar = data.lotesEnvasados.find(l => l.id === id);
    if (!loteAEliminar) return;

    // Validación de integridad: no eliminar registros de envasado que hayan generado albarán o factura
    const tieneAlbaran = data.albaranes.some(alb =>
      alb.lineas.some(l => l.loteEnvasadoId === id || l.codigoLoteEnvasado === loteAEliminar.codigoLoteEnvasado)
    );
    const tieneFactura = data.facturas.some(fac =>
      fac.lineas.some(l => l.loteEnvasadoId === id || l.codigoLoteEnvasado === loteAEliminar.codigoLoteEnvasado)
    );
    const tieneSalidas = loteAEliminar.estuchesDisponibles < loteAEliminar.cantidadEstuchesProducidos;

    if (tieneAlbaran || tieneFactura || tieneSalidas) {
      alert(`No se puede eliminar la orden de envasado ${loteAEliminar.codigoLoteEnvasado} porque ya ha generado albaranes o facturas emitidas. Por trazabilidad legal y principio de inmutabilidad, no se pueden borrar lotes con expediciones.`);
      return;
    }

    setData(prev => {
      // Reintegrar huevos consumidos a los lotes de puesta
      const updatedLotesPuesta = prev.lotesPuesta.map(lp => {
        const comp = loteAEliminar.componentesLotes.find(c => c.lotePuestaId === lp.id);
        if (comp) {
          return {
            ...lp,
            huevosDisponibles: Math.min(lp.huevosAptos, lp.huevosDisponibles + comp.totalHuevosConsumidos)
          };
        }
        return lp;
      });

      return {
        ...prev,
        lotesPuesta: updatedLotesPuesta,
        lotesEnvasados: prev.lotesEnvasados.filter(l => l.id !== id)
      };
    });
  };

  // Handlers para Albaranes y Ventas (con deducción de stock de estuches)
  const handleAddAlbaran = (nuevoAlbaran: Albaran, consumoEstuches: Record<string, number>) => {
    setData(prev => {
      const updatedLotesEnvasados = prev.lotesEnvasados.map(le => {
        const cant = consumoEstuches[le.id];
        if (cant) {
          return {
            ...le,
            estuchesDisponibles: Math.max(0, le.estuchesDisponibles - cant)
          };
        }
        return le;
      });

      return {
        ...prev,
        lotesEnvasados: updatedLotesEnvasados,
        albaranes: [nuevoAlbaran, ...prev.albaranes],
        config: {
          ...prev.config,
          contadorAlbaran: prev.config.contadorAlbaran + 1
        }
      };
    });
  };

  const handleDeleteAlbaran = (id: string) => {
    const alb = data.albaranes.find(a => a.id === id);
    if (!alb) return;

    // Validación de integridad: no borrar albaranes que estén facturados
    const estaFacturado = alb.estado === 'facturado' || Boolean(alb.facturaId) || data.facturas.some(f =>
      f.albaranesAsociados?.some(a => a.id === id || a.numeroAlbaran === alb.numeroAlbaran)
    );

    if (estaFacturado) {
      alert(`No se puede eliminar el albarán ${alb.numeroAlbaran} porque ya está facturado. Por exigencias legales y fiscales de la Ley Antifraude y Veri*Factu, los albaranes integrados en facturas son inmutables.`);
      return;
    }

    setData(prev => {
      // Devolver stock de estuches
      const updatedLotesEnvasados = prev.lotesEnvasados.map(le => {
        const linea = alb.lineas.find(l => l.loteEnvasadoId === le.id);
        if (linea) {
          return {
            ...le,
            estuchesDisponibles: Math.min(le.cantidadEstuchesProducidos, le.estuchesDisponibles + linea.cantidadEstuches)
          };
        }
        return le;
      });

      return {
        ...prev,
        lotesEnvasados: updatedLotesEnvasados,
        albaranes: prev.albaranes.filter(a => a.id !== id)
      };
    });
  };

  // Factura Directa (FASE 1.3: Emisión fiscal centralizada)
  const handleAddFacturaDirecta = (
    nuevaFactura: Factura,
    consumoEstuches: Record<string, number>,
    nuevoFiscalRecordRef: FiscalRecordRef
  ) => {
    setData(prev => {
      const updatedLotesEnvasados = prev.lotesEnvasados.map(le => {
        const cant = consumoEstuches[le.id];
        if (cant) {
          return {
            ...le,
            estuchesDisponibles: Math.max(0, le.estuchesDisponibles - cant)
          };
        }
        return le;
      });

      return {
        ...prev,
        lotesEnvasados: updatedLotesEnvasados,
        facturas: [nuevaFactura, ...prev.facturas],
        fiscalRecordRefs: [nuevoFiscalRecordRef, ...(prev.fiscalRecordRefs || [])],
        config: {
          ...prev.config,
          contadorFactura: prev.config.contadorFactura + 1
        }
      };
    });
  };

  // Facturar Albaranes (FASE 1.3: Emisión fiscal centralizada)
  const handleFacturarAlbaranes = (
    nuevaFactura: Factura,
    albaranesIds: string[],
    nuevoFiscalRecordRef: FiscalRecordRef
  ) => {
    setData(prev => {
      const updatedAlbaranes = prev.albaranes.map(a => {
        if (albaranesIds.includes(a.id)) {
          return {
            ...a,
            estado: 'facturado' as const,
            facturaId: nuevaFactura.id,
            numeroFactura: nuevaFactura.numeroFactura
          };
        }
        return a;
      });

      return {
        ...prev,
        albaranes: updatedAlbaranes,
        facturas: [nuevaFactura, ...prev.facturas],
        fiscalRecordRefs: [nuevoFiscalRecordRef, ...(prev.fiscalRecordRefs || [])],
        config: {
          ...prev.config,
          contadorFactura: prev.config.contadorFactura + 1
        }
      };
    });
  };

  // Factura Rectificativa (FASE 1.3: Emisión fiscal centralizada)
  const handleAddFacturaRectificativa = (
    nuevaRectificativa: Factura,
    reingresarStock: boolean,
    nuevoFiscalRecordRef: FiscalRecordRef
  ) => {
    setData(prev => {
      // 1. Marcar la factura original como rectificada
      const updatedFacturas = prev.facturas.map(f => {
        if (f.id === nuevaRectificativa.facturaRectificadaId) {
          return {
            ...f,
            estadoRectificacion: 'rectificada_total' as const,
            rectificadaPorNumero: nuevaRectificativa.numeroFactura
          };
        }
        return f;
      });

      // 2. Si se solicitó reingresar estuches al almacén por devolución o anulación
      let updatedLotesEnvasados = prev.lotesEnvasados;
      if (reingresarStock && nuevaRectificativa.lineas) {
        const restitucion: Record<string, number> = {};
        nuevaRectificativa.lineas.forEach(l => {
          if (l.loteEnvasadoId && l.cantidadEstuches) {
            restitucion[l.loteEnvasadoId] = (restitucion[l.loteEnvasadoId] || 0) + Math.abs(l.cantidadEstuches);
          }
        });

        updatedLotesEnvasados = prev.lotesEnvasados.map(le => {
          const cant = restitucion[le.id];
          if (cant) {
            return {
              ...le,
              estuchesDisponibles: le.estuchesDisponibles + cant
            };
          }
          return le;
        });
      }

      return {
        ...prev,
        lotesEnvasados: updatedLotesEnvasados,
        facturas: [nuevaRectificativa, ...updatedFacturas],
        fiscalRecordRefs: [nuevoFiscalRecordRef, ...(prev.fiscalRecordRefs || [])],
        config: {
          ...prev.config,
          contadorRectificativa: (prev.config.contadorRectificativa || 1) + 1
        }
      };
    });
  };

  const handleDeleteFactura = (id: string) => {
    // Por normativa Ley Antifraude / Veri*Factu, las facturas emitidas son inmutables y no deben borrarse
    alert('Conforme a la Ley Antifraude (RD 1007/2023), una factura expedida no se puede eliminar. Para anularla o corregirla debes emitir una Factura Rectificativa.');
  };

  // Otras Salidas (mermas almacén, donaciones, autoconsumo)
  const handleAddOtraSalida = (nuevaSalida: OtraSalida) => {
    setData(prev => {
      const updatedLotesEnvasados = prev.lotesEnvasados.map(le => {
        if (le.id === nuevaSalida.loteEnvasadoId) {
          return {
            ...le,
            estuchesDisponibles: Math.max(0, le.estuchesDisponibles - nuevaSalida.cantidadEstuches)
          };
        }
        return le;
      });

      return {
        ...prev,
        lotesEnvasados: updatedLotesEnvasados,
        otrasSalidas: [nuevaSalida, ...prev.otrasSalidas]
      };
    });
  };

  const handleDeleteOtraSalida = (id: string) => {
    setData(prev => {
      const salida = prev.otrasSalidas.find(s => s.id === id);
      if (!salida) return prev;

      const updatedLotesEnvasados = prev.lotesEnvasados.map(le => {
        if (le.id === salida.loteEnvasadoId) {
          return {
            ...le,
            estuchesDisponibles: Math.min(le.cantidadEstuchesProducidos, le.estuchesDisponibles + salida.cantidadEstuches)
          };
        }
        return le;
      });

      return {
        ...prev,
        lotesEnvasados: updatedLotesEnvasados,
        otrasSalidas: prev.otrasSalidas.filter(s => s.id !== id)
      };
    });
  };

  // Clientes, Formatos y Naves
  const handleAddCliente = (c: Cliente) => setData(p => ({ ...p, clientes: [...p.clientes, c] }));
  const handleUpdateCliente = (c: Cliente) => setData(p => ({ ...p, clientes: p.clientes.map(item => item.id === c.id ? c : item) }));
  const handleDeleteCliente = (id: string) => setData(p => ({ ...p, clientes: p.clientes.filter(c => c.id !== id) }));

  const handleAddFormato = (f: FormatoEnvase) => setData(p => ({ ...p, formatos: [...p.formatos, f] }));
  const handleUpdateFormato = (f: FormatoEnvase) => {
    setData(p => {
      const updatedFormatos = p.formatos.map(item => item.id === f.id ? f : item);
      const updatedLotesEnvasados = p.lotesEnvasados.map(le => {
        if (le.formatoId === f.id) {
          return {
            ...le,
            nombreFormato: f.nombre,
            huevosPorEstuche: f.cantidadHuevos
          };
        }
        return le;
      });
      return {
        ...p,
        formatos: updatedFormatos,
        lotesEnvasados: updatedLotesEnvasados
      };
    });
  };
  const handleDeleteFormato = (id: string) => setData(p => ({ ...p, formatos: p.formatos.filter(f => f.id !== id) }));

  const handleAddNave = (n: Nave) => setData(p => ({ ...p, naves: [...p.naves, n] }));
  const handleUpdateNave = (n: Nave) => {
    setData(p => {
      const updatedNaves = p.naves.map(item => item.id === n.id ? n : item);
      const updatedLotesPuesta = p.lotesPuesta.map(lp => {
        if (lp.naveId === n.id) {
          return {
            ...lp,
            nombreNave: n.nombre,
            tipoCria: n.tipoCria,
            codigoREGA: n.codigoREGA
          };
        }
        return lp;
      });
      return {
        ...p,
        naves: updatedNaves,
        lotesPuesta: updatedLotesPuesta
      };
    });
  };
  const handleDeleteNave = (id: string) => setData(p => ({ ...p, naves: p.naves.filter(n => n.id !== id) }));

  const handleUpdateConfig = (cfg: any) => setData(p => ({ ...p, config: cfg }));

  // Exportar / Importar / Reset
  const handleExport = () => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_gestion_avicola_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (parsed.naves && parsed.lotesPuesta) {
          setData(parsed);
          saveAppData(parsed);
          alert('Copia de seguridad restaurada correctamente en local y en la nube.');
        } else {
          alert('El archivo no contiene el formato de datos válido.');
        }
      } catch (err) {
        alert('Error al leer el archivo JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    setShowResetDemoModal(true);
  };

  const confirmResetDemo = () => {
    const initial = resetToInitialData();
    setData(initial);
    saveAppData(initial);
    if (user && isOnline) {
      syncFarmDataToCloud(initial);
    }
    setShowResetDemoModal(false);
    showAppToast('Datos restablecidos a la configuración de demostración con éxito.');
  };

  const handleStartZeroDay = () => {
    const customConfig: Partial<AppData['config']> = {};
    if (zeroDayEmpresa.trim()) customConfig.nombreEmpresa = zeroDayEmpresa.trim();
    if (zeroDayRega.trim()) customConfig.codigoREGA = zeroDayRega.trim();
    if (zeroDayCentro.trim()) customConfig.codigoCentroEnvasado = zeroDayCentro.trim();

    const cleanZeroData = resetToZeroDayData(customConfig);
    setData(cleanZeroData);
    saveAppData(cleanZeroData);

    if (user && isOnline) {
      syncFarmDataToCloud(cleanZeroData);
    }

    setShowZeroDayModal(false);
    showAppToast('¡Instalación Día Cero iniciada! La app está completamente limpia y lista para tu granja real.');
  };

  const handleUpdateUsuarios = (updatedUsuarios: UsuarioAutorizado[]) => {
    setData(prev => {
      const updated = {
        ...prev,
        usuariosAutorizados: updatedUsuarios
      };
      saveAppData(updated);
      if (user && isOnline) {
        syncFarmDataToCloud(updated);
      }
      return updated;
    });
  };

  // 1. Pantalla de carga mientras se verifica la sesión en Firebase / Almacenamiento Local
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#F5F2EC] flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-800 animate-bounce mb-4 shadow-md border border-amber-200">
          <Egg className="w-8 h-8 fill-amber-700 text-amber-900" />
        </div>
        <h2 className="text-lg font-black text-stone-900 tracking-tight">
          {data.config.nombreEmpresa}
        </h2>
        <p className="text-xs text-stone-600 mt-1 font-medium">
          Verificando credenciales y autorización de acceso...
        </p>
      </div>
    );
  }

  // 2. REGLA FUNDAMENTAL DE CONTROL DE ACCESO:
  // Si el usuario no está registrado o su cuenta de Google NO está autorizada, NO PUEDE VER NINGÚN DATO
  if (!user || user.isUnauthorized) {
    return (
      <AccessControlGate
        config={data.config}
        currentUser={user}
        onSuccessLogin={() => {
          setSyncMessage('Acceso autorizado con éxito.');
          setTimeout(() => setSyncMessage(null), 3000);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-stone-900 flex flex-col lg:flex-row font-sans relative">
      {/* Toast Flotante Global de la App */}
      {toastNotification && (
        <div className="fixed top-5 right-5 z-50 bg-stone-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-xs font-semibold animate-in fade-in slide-in-from-top-4 border border-stone-700 max-w-md">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastNotification}</span>
        </div>
      )}

      <Sidebar
        activeModule={activeModule}
        produccionSubTab={produccionSubTab}
        ventasSubTab={ventasSubTab}
        onNavigate={handleNavigate}
        data={data}
        user={user}
        isOnline={isOnline}
        isSyncing={isSyncing}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        onExport={handleExport}
        onImport={handleImport}
        onReset={handleReset}
        onOpenZeroDayModal={() => {
          setZeroDayEmpresa(data.config.nombreEmpresa === 'Granja Avícola El Valle S.L.' ? '' : data.config.nombreEmpresa);
          setZeroDayRega(data.config.codigoREGA === 'ES45000189' ? '' : (data.config.codigoREGA || ''));
          setZeroDayCentro(data.config.codigoCentroEnvasado === 'ES-10.04523-TO' ? '' : (data.config.codigoCentroEnvasado || ''));
          setShowZeroDayModal(true);
        }}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Barra de Notificación de Conexión / Modo Offline */}
        {(!isOnline || syncMessage) && (
          <div className={`py-2 px-4 text-xs font-semibold flex items-center justify-between transition-all print:hidden ${
            !isOnline ? 'bg-amber-800 text-amber-100' : 'bg-stone-800 text-stone-200'
          }`}>
            <div className="max-w-7xl mx-auto w-full flex items-center gap-2">
              {!isOnline ? (
                <>
                  <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>Modo Local Offline: Sin conexión a internet. Los datos se guardan de forma segura en este dispositivo y se sincronizarán al recuperar la señal.</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{syncMessage}</span>
                </>
              )}
            </div>
          </div>
        )}

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 print:p-0 print:m-0 print:max-w-none print:w-full">
          {activeModule === 'produccion' && (
            <ProduccionModule
              activeSubTab={produccionSubTab}
              onSelectSubTab={setProduccionSubTab}
              naves={data.naves}
              lotesPuesta={data.lotesPuesta}
              lotesEnvasados={data.lotesEnvasados}
              formatos={data.formatos}
              albaranes={data.albaranes}
              facturas={data.facturas}
              config={data.config}
              onAddLotePuesta={handleAddLotePuesta}
              onDeleteLotePuesta={handleDeleteLotePuesta}
              onAddLoteEnvasado={handleAddLoteEnvasado}
              onDeleteLoteEnvasado={handleDeleteLoteEnvasado}
              onAddNave={handleAddNave}
              onUpdateNave={handleUpdateNave}
              onDeleteNave={handleDeleteNave}
              onUpdateConfig={handleUpdateConfig}
            />
          )}

          {activeModule === 'ventas' && (
            <VentasModule
              activeSubTab={ventasSubTab}
              onSelectSubTab={setVentasSubTab}
              clientes={data.clientes}
              formatos={data.formatos}
              lotesEnvasados={data.lotesEnvasados}
              albaranes={data.albaranes}
              facturas={data.facturas}
              contadorAlbaran={data.config.contadorAlbaran}
              contadorFactura={data.config.contadorFactura}
              contadorRectificativa={data.config.contadorRectificativa || 1}
              config={data.config}
              fiscalRecordRefs={data.fiscalRecordRefs}
              fiscalConfig={data.fiscalConfig}
              onAddAlbaran={handleAddAlbaran}
              onAddFacturaDirecta={handleAddFacturaDirecta}
              onFacturarAlbaranes={handleFacturarAlbaranes}
              onAddFacturaRectificativa={handleAddFacturaRectificativa}
              onDeleteAlbaran={handleDeleteAlbaran}
              onDeleteFactura={handleDeleteFactura}
              onAddCliente={handleAddCliente}
              onUpdateCliente={handleUpdateCliente}
              onDeleteCliente={handleDeleteCliente}
              onAddFormato={handleAddFormato}
              onUpdateFormato={handleUpdateFormato}
              onDeleteFormato={handleDeleteFormato}
            />
          )}

          {activeModule === 'trazabilidad' && (
            <TrazabilidadView
              lotesPuesta={data.lotesPuesta}
              lotesEnvasados={data.lotesEnvasados}
              albaranes={data.albaranes}
              facturas={data.facturas}
              otrasSalidas={data.otrasSalidas}
              config={data.config}
              onAddOtraSalida={handleAddOtraSalida}
              onDeleteOtraSalida={handleDeleteOtraSalida}
            />
          )}

          {activeModule === 'usuarios' && (
            <GestionUsuariosView
              usuarios={data.usuariosAutorizados || []}
              currentUser={user}
              onUpdateUsuarios={handleUpdateUsuarios}
            />
          )}
        </main>

        <footer className="bg-stone-200/80 border-t border-stone-300 py-3 text-center text-xs text-stone-600 print:hidden">
          <p>
            {data.config.nombreEmpresa} • RGSEAA: {data.config.registroSanitario} • Base de Datos Híbrida (Firestore + LocalStorage Offline) • Trazabilidad RD 226/2008 y Reg. UE 589/2008
          </p>
        </footer>
      </div>

      {/* Modal de Autenticación y Seguridad */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={user}
      />

      {/* Modal: Confirmación Inicio Día Cero (Limpio sin datos) */}
      {showZeroDayModal && (
        <div className="fixed inset-0 bg-stone-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-5 relative">
            <button
              type="button"
              onClick={() => setShowZeroDayModal(false)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center shrink-0 border border-amber-300 shadow-sm">
                <Sparkles className="w-6 h-6 text-amber-700" />
              </div>
              <div>
                <h3 className="text-lg font-black text-stone-900">
                  Iniciar Granja: Día Cero (Limpio)
                </h3>
                <p className="text-xs text-stone-500">
                  Configuración para una primera instalación real sin datos ficticios
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>¿Qué ocurrirá al iniciar en Día Cero?</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-stone-700 leading-relaxed">
                <li>Se eliminarán todos los lotes de puesta, envasados, albaranes, facturas y clientes de demostración.</li>
                <li>Los contadores de albaranes, facturas y envasado empezarán desde el número <strong>1</strong>.</li>
                <li>Se mantendrán los formatos estándar de estuches (12, 6 y 30 huevos) listos para usar o personalizar.</li>
                <li>Tu cuenta de Google (<strong>{ROOT_OWNER_EMAIL}</strong>) se mantendrá como propietario indiscutible con acceso total.</li>
              </ul>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-bold text-stone-800">
                Opcional: Datos iniciales de tu explotación
              </p>
              <div>
                <label className="block text-stone-600 mb-1 font-medium">
                  Nombre de tu Granja / Empresa
                </label>
                <input
                  type="text"
                  value={zeroDayEmpresa}
                  onChange={e => setZeroDayEmpresa(e.target.value)}
                  placeholder="Ej. Avícola Pedregal S.L."
                  className="w-full p-2.5 border border-stone-300 rounded-xl bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-stone-600 mb-1 font-medium">
                    Código REGA
                  </label>
                  <input
                    type="text"
                    value={zeroDayRega}
                    onChange={e => setZeroDayRega(e.target.value)}
                    placeholder="Ej. ES45000012"
                    className="w-full p-2.5 border border-stone-300 rounded-xl bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-stone-600 mb-1 font-medium">
                    Código Centro Embalaje
                  </label>
                  <input
                    type="text"
                    value={zeroDayCentro}
                    onChange={e => setZeroDayCentro(e.target.value)}
                    placeholder="Ej. ES-10.04523-TO"
                    className="w-full p-2.5 border border-stone-300 rounded-xl bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowZeroDayModal(false)}
                className="flex-1 py-2.5 px-3 rounded-xl border border-stone-300 text-stone-700 font-semibold hover:bg-stone-100 transition-colors cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="btn-confirm-dia-cero"
                onClick={handleStartZeroDay}
                className="flex-1 py-2.5 px-3 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-bold transition-colors cursor-pointer text-xs shadow-md flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>Iniciar Día Cero Limpio</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmación Cargar Datos Demo */}
      {showResetDemoModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-stone-200 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
              <RefreshCw className="w-6 h-6 text-amber-700" />
            </div>

            <div>
              <h3 className="text-base font-bold text-stone-900">
                ¿Cargar datos de demostración?
              </h3>
              <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                Se cargarán naves, lotes de prueba, clientes y facturas simuladas para explorar las funcionalidades de la aplicación.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetDemoModal(false)}
                className="flex-1 py-2 px-3 rounded-xl border border-stone-300 text-stone-700 font-semibold hover:bg-stone-100 transition-colors cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="btn-confirm-reset-demo"
                onClick={confirmResetDemo}
                className="flex-1 py-2 px-3 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-bold transition-colors cursor-pointer text-xs"
              >
                Cargar Demo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Indicador Flotante de Conectividad PWA */}
      <OfflineIndicator />
    </div>
  );
}

