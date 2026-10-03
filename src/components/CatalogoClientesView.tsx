import React, { useState, useEffect } from 'react';
import {
  Users,
  Package,
  Home,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  ShieldAlert,
  Building2,
  Phone,
  Mail,
  MapPin,
  Tag,
  DollarSign,
  Layers,
  Save,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react';
import { Cliente, FormatoEnvase, Nave, TipoCria, TipoEnvase, ConfiguracionEmpresa } from '../types';

interface CatalogoClientesViewProps {
  clientes: Cliente[];
  formatos: FormatoEnvase[];
  naves: Nave[];
  config: ConfiguracionEmpresa;
  onAddCliente: (c: Cliente) => void;
  onUpdateCliente: (c: Cliente) => void;
  onDeleteCliente: (id: string) => void;
  onAddFormato: (f: FormatoEnvase) => void;
  onUpdateFormato: (f: FormatoEnvase) => void;
  onDeleteFormato: (id: string) => void;
  onAddNave: (n: Nave) => void;
  onUpdateNave: (n: Nave) => void;
  onDeleteNave: (id: string) => void;
  onUpdateConfig: (cfg: ConfiguracionEmpresa) => void;
}

export const CatalogoClientesView: React.FC<CatalogoClientesViewProps> = ({
  clientes,
  formatos,
  naves,
  config,
  onAddCliente,
  onUpdateCliente,
  onDeleteCliente,
  onAddFormato,
  onUpdateFormato,
  onDeleteFormato,
  onAddNave,
  onUpdateNave,
  onDeleteNave,
  onUpdateConfig
}) => {
  const [tabInterna, setTabInterna] = useState<'clientes' | 'formatos' | 'naves' | 'empresa'>('clientes');

  // Estado para modal / formulario de cliente
  const [mostrarModalCliente, setMostrarModalCliente] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<Cliente | null>(null);
  const [nombreCli, setNombreCli] = useState('');
  const [cifCli, setCifCli] = useState('');
  const [dirCli, setDirCli] = useState('');
  const [pobCli, setPobCli] = useState('');
  const [provCli, setProvCli] = useState('');
  const [cpCli, setCpCli] = useState('');
  const [telCli, setTelCli] = useState('');
  const [emailCli, setEmailCli] = useState('');
  const [recargoCli, setRecargoCli] = useState(false);

  // Estado para modal / formulario de formato (crear o editar)
  const [mostrarModalFormato, setMostrarModalFormato] = useState(false);
  const [formatoEditando, setFormatoEditando] = useState<FormatoEnvase | null>(null);
  const [nombreFmt, setNombreFmt] = useState('');
  const [tipoEnvaseFmt, setTipoEnvaseFmt] = useState<TipoEnvase>('estuche_carton');
  const [cantidadHuevosFmt, setCantidadHuevosFmt] = useState<number | ''>('');
  const [calibreFmt, setCalibreFmt] = useState<'XL' | 'L' | 'M' | 'S' | 'MIX'>('L');
  const [precioVentaFmt, setPrecioVentaFmt] = useState<number | ''>('');
  const [costeEnvaseFmt, setCosteEnvaseFmt] = useState<number | ''>('');
  const [textoEtiquetaFmt, setTextoEtiquetaFmt] = useState('');
  const [activoFmt, setActivoFmt] = useState(true);

  // Estado para modal / formulario de nave (crear o editar)
  const [mostrarModalNave, setMostrarModalNave] = useState(false);
  const [naveEditando, setNaveEditando] = useState<Nave | null>(null);
  const [codigoNave, setCodigoNave] = useState('');
  const [nombreNave, setNombreNave] = useState('');
  const [tipoCriaNave, setTipoCriaNave] = useState<TipoCria>('1-Campero');
  const [codigoREGANave, setCodigoREGANave] = useState('');
  const [capacidadAvesNave, setCapacidadAvesNave] = useState<number | ''>('');
  const [activaNave, setActivaNave] = useState(true);

  // Estado local para Centro de Envasado / Empresa
  const [empresaNombre, setEmpresaNombre] = useState(config.nombreEmpresa || '');
  const [empresaCif, setEmpresaCif] = useState(config.cifEmpresa || '');
  const [empresaSanitario, setEmpresaSanitario] = useState(config.registroSanitario || '');
  const [empresaCentroCod, setEmpresaCentroCod] = useState(config.codigoCentroEnvasado || '');
  const [empresaRega, setEmpresaRega] = useState(config.codigoREGA || '');
  const [empresaResponsable, setEmpresaResponsable] = useState(config.responsableCentro || '');
  const [empresaDir, setEmpresaDir] = useState(config.direccionEmpresa || '');
  const [empresaPob, setEmpresaPob] = useState(config.poblacionEmpresa || '');
  const [empresaProv, setEmpresaProv] = useState(config.provinciaEmpresa || '');
  const [empresaCp, setEmpresaCp] = useState(config.codigoPostalEmpresa || '');
  const [empresaTel, setEmpresaTel] = useState(config.telefonoEmpresa || '');
  const [empresaEmail, setEmpresaEmail] = useState(config.emailEmpresa || '');
  const [empresaContadorAlb, setEmpresaContadorAlb] = useState(config.contadorAlbaran || 1);
  const [empresaContadorFact, setEmpresaContadorFact] = useState(config.contadorFactura || 1);
  const [empresaContadorEnv, setEmpresaContadorEnv] = useState(config.contadorEnvasado || 1);
  const [guardadoExitosoCentro, setGuardadoExitosoCentro] = useState(false);

  // Sincronizar estado local del centro si cambian las props
  useEffect(() => {
    setEmpresaNombre(config.nombreEmpresa || '');
    setEmpresaCif(config.cifEmpresa || '');
    setEmpresaSanitario(config.registroSanitario || '');
    setEmpresaCentroCod(config.codigoCentroEnvasado || '');
    setEmpresaRega(config.codigoREGA || '');
    setEmpresaResponsable(config.responsableCentro || '');
    setEmpresaDir(config.direccionEmpresa || '');
    setEmpresaPob(config.poblacionEmpresa || '');
    setEmpresaProv(config.provinciaEmpresa || '');
    setEmpresaCp(config.codigoPostalEmpresa || '');
    setEmpresaTel(config.telefonoEmpresa || '');
    setEmpresaEmail(config.emailEmpresa || '');
    setEmpresaContadorAlb(config.contadorAlbaran || 1);
    setEmpresaContadorFact(config.contadorFactura || 1);
    setEmpresaContadorEnv(config.contadorEnvasado || 1);
  }, [config]);

  // Abrir modal cliente (nuevo o editar)
  const handleOpenCliente = (c?: Cliente) => {
    if (c) {
      setClienteEditando(c);
      setNombreCli(c.nombre);
      setCifCli(c.cifNif);
      setDirCli(c.direccion);
      setPobCli(c.poblacion);
      setProvCli(c.provincia);
      setCpCli(c.codigoPostal);
      setTelCli(c.telefono);
      setEmailCli(c.email);
      setRecargoCli(c.recargoEquivalencia);
    } else {
      setClienteEditando(null);
      setNombreCli('');
      setCifCli('');
      setDirCli('');
      setPobCli('');
      setProvCli('');
      setCpCli('');
      setTelCli('');
      setEmailCli('');
      setRecargoCli(false);
    }
    setMostrarModalCliente(true);
  };

  // Abrir modal formato (nuevo o editar)
  const handleOpenFormato = (f?: FormatoEnvase) => {
    if (f) {
      setFormatoEditando(f);
      setNombreFmt(f.nombre);
      setTipoEnvaseFmt(f.tipoEnvase);
      setCantidadHuevosFmt(f.cantidadHuevos);
      setCalibreFmt(f.calibreRecomendado);
      setPrecioVentaFmt(f.precioVenta);
      setCosteEnvaseFmt(f.costeEnvase);
      setTextoEtiquetaFmt(f.textoEtiqueta || '');
      setActivoFmt(f.activo !== false);
    } else {
      setFormatoEditando(null);
      setNombreFmt('');
      setTipoEnvaseFmt('estuche_carton');
      setCantidadHuevosFmt(12);
      setCalibreFmt('L');
      setPrecioVentaFmt('');
      setCosteEnvaseFmt('');
      setTextoEtiquetaFmt('Huevos frescos Clase A');
      setActivoFmt(true);
    }
    setMostrarModalFormato(true);
  };

  // Abrir modal nave (nuevo o editar)
  const handleOpenNave = (n?: Nave) => {
    if (n) {
      setNaveEditando(n);
      setCodigoNave(n.codigo);
      setNombreNave(n.nombre);
      setTipoCriaNave(n.tipoCria);
      setCodigoREGANave(n.codigoREGA);
      setCapacidadAvesNave(n.capacidadAves);
      setActivaNave(n.activa !== false);
    } else {
      setNaveEditando(null);
      const siguienteNum = naves.length + 1;
      setCodigoNave(`NAV${siguienteNum}`);
      setNombreNave(`Nave ${siguienteNum} - Puesta`);
      setTipoCriaNave('1-Campero');
      setCodigoREGANave(config.codigoREGA || 'ES45000189');
      setCapacidadAvesNave(3000);
      setActivaNave(true);
    }
    setMostrarModalNave(true);
  };

  const handleFabClick = () => {
    if (tabInterna === 'clientes') handleOpenCliente();
    else if (tabInterna === 'formatos') handleOpenFormato();
    else if (tabInterna === 'naves') handleOpenNave();
    else setTabInterna('clientes');
  };

  const handleGuardarCliente = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreCli.trim() || !cifCli.trim()) {
      alert('Nombre y CIF/NIF son obligatorios.');
      return;
    }

    const cData: Cliente = {
      id: clienteEditando ? clienteEditando.id : 'cli-' + Date.now(),
      nombre: nombreCli.trim(),
      cifNif: cifCli.trim().toUpperCase(),
      direccion: dirCli.trim(),
      poblacion: pobCli.trim(),
      provincia: provCli.trim(),
      codigoPostal: cpCli.trim(),
      telefono: telCli.trim(),
      email: emailCli.trim(),
      recargoEquivalencia: recargoCli
    };

    if (clienteEditando) {
      onUpdateCliente(cData);
    } else {
      onAddCliente(cData);
    }
    setMostrarModalCliente(false);
  };

  const handleGuardarFormato = (e: React.FormEvent) => {
    e.preventDefault();
    const cantH = Number(cantidadHuevosFmt) || 12;
    const precio = Number(precioVentaFmt) || 0;
    const coste = Number(costeEnvaseFmt) || 0;

    const fData: FormatoEnvase = {
      id: formatoEditando ? formatoEditando.id : 'fmt-' + Date.now(),
      nombre: nombreFmt.trim(),
      tipoEnvase: tipoEnvaseFmt,
      cantidadHuevos: cantH,
      calibreRecomendado: calibreFmt,
      precioVenta: precio,
      costeEnvase: coste,
      textoEtiqueta: textoEtiquetaFmt.trim(),
      activo: activoFmt
    };

    if (formatoEditando) {
      onUpdateFormato(fData);
    } else {
      onAddFormato(fData);
    }
    setMostrarModalFormato(false);
  };

  const handleGuardarNave = (e: React.FormEvent) => {
    e.preventDefault();
    const nData: Nave = {
      id: naveEditando ? naveEditando.id : 'nave-' + Date.now(),
      codigo: codigoNave.trim().toUpperCase(),
      nombre: nombreNave.trim(),
      tipoCria: tipoCriaNave,
      codigoREGA: codigoREGANave.trim().toUpperCase(),
      capacidadAves: Number(capacidadAvesNave) || 1000,
      activa: activaNave
    };

    if (naveEditando) {
      onUpdateNave(nData);
    } else {
      onAddNave(nData);
    }
    setMostrarModalNave(false);
  };

  // Guardar Centro de Envasado
  const handleGuardarCentro = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedCfg: ConfiguracionEmpresa = {
      ...config,
      nombreEmpresa: empresaNombre.trim(),
      cifEmpresa: empresaCif.trim().toUpperCase(),
      registroSanitario: empresaSanitario.trim(),
      codigoCentroEnvasado: empresaCentroCod.trim(),
      codigoREGA: empresaRega.trim().toUpperCase(),
      responsableCentro: empresaResponsable.trim(),
      direccionEmpresa: empresaDir.trim(),
      poblacionEmpresa: empresaPob.trim(),
      provinciaEmpresa: empresaProv.trim(),
      codigoPostalEmpresa: empresaCp.trim(),
      telefonoEmpresa: empresaTel.trim(),
      emailEmpresa: empresaEmail.trim(),
      contadorAlbaran: Number(empresaContadorAlb) || config.contadorAlbaran,
      contadorFactura: Number(empresaContadorFact) || config.contadorFactura,
      contadorEnvasado: Number(empresaContadorEnv) || config.contadorEnvasado
    };

    onUpdateConfig(updatedCfg);
    setGuardadoExitosoCentro(true);
    setTimeout(() => setGuardadoExitosoCentro(false), 3500);
  };

  const handleResetCentro = () => {
    setEmpresaNombre(config.nombreEmpresa || '');
    setEmpresaCif(config.cifEmpresa || '');
    setEmpresaSanitario(config.registroSanitario || '');
    setEmpresaCentroCod(config.codigoCentroEnvasado || '');
    setEmpresaRega(config.codigoREGA || '');
    setEmpresaResponsable(config.responsableCentro || '');
    setEmpresaDir(config.direccionEmpresa || '');
    setEmpresaPob(config.poblacionEmpresa || '');
    setEmpresaProv(config.provinciaEmpresa || '');
    setEmpresaCp(config.codigoPostalEmpresa || '');
    setEmpresaTel(config.telefonoEmpresa || '');
    setEmpresaEmail(config.emailEmpresa || '');
    setEmpresaContadorAlb(config.contadorAlbaran || 1);
    setEmpresaContadorFact(config.contadorFactura || 1);
    setEmpresaContadorEnv(config.contadorEnvasado || 1);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-20">
      {/* 1. HERO CARD SUPERIOR ESTILO LIMPIO */}
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {config.nombreEmpresa}
            </h2>
            <p className="text-amber-100 text-xs sm:text-sm font-medium flex items-center gap-2">
              <span>RGSEAA: {config.registroSanitario}</span>
              <span>•</span>
              <span>{clientes.length} Clientes · {naves.length} Naves</span>
            </p>
          </div>

          {tabInterna !== 'empresa' && (
            <button
              type="button"
              onClick={handleFabClick}
              className="flex items-center gap-1.5 px-4 py-2 bg-white text-amber-800 hover:bg-amber-50 font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
            >
              <Plus className="w-4 h-4 text-amber-600" />
              <span>
                {tabInterna === 'clientes' && 'Nuevo Cliente'}
                {tabInterna === 'formatos' && 'Nuevo Formato'}
                {tabInterna === 'naves' && 'Nueva Nave'}
              </span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-amber-400/40 text-xs text-white">
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Clientes Activos</span>
            <strong className="text-sm sm:text-base font-bold">{clientes.length}</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Formatos de Venta</span>
            <strong className="text-sm sm:text-base font-bold text-white">{formatos.length}</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Naves Registradas</span>
            <strong className="text-sm sm:text-base font-bold text-amber-100">{naves.length}</strong>
          </div>
        </div>
      </div>

      {/* 2. SUB-PESTAÑAS */}
      <div className="flex border-b border-stone-200 justify-around text-xs sm:text-sm font-bold tracking-wider text-stone-500">
        <button
          type="button"
          onClick={() => setTabInterna('clientes')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            tabInterna === 'clientes' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Clientes ({clientes.length})</span>
          {tabInterna === 'clientes' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setTabInterna('formatos')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            tabInterna === 'formatos' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Formatos ({formatos.length})</span>
          {tabInterna === 'formatos' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setTabInterna('naves')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            tabInterna === 'naves' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Naves y REGA ({naves.length})</span>
          {tabInterna === 'naves' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setTabInterna('empresa')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            tabInterna === 'empresa' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Datos Centro</span>
          {tabInterna === 'empresa' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>
      </div>

      {/* 3. CONTENIDO SEGÚN SUB-PESTAÑA */}

      {/* === SUBTAB: CLIENTES === */}
      {tabInterna === 'clientes' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
              <Users className="w-3.5 h-3.5 text-amber-600" />
              <span>Clientes Registrados ({clientes.length})</span>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
            {clientes.map(cli => (
              <div key={cli.id} className="p-4 flex items-center justify-between gap-3 hover:bg-stone-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-amber-700" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="text-stone-900 text-sm">{cli.nombre}</strong>
                      <span className="font-mono text-xs text-stone-500">({cli.cifNif})</span>
                      {cli.recargoEquivalencia ? (
                        <span className="bg-purple-100 text-purple-900 px-2 py-0.5 rounded-full font-bold text-[10px]">
                          4% IVA + 0,5% R.E.
                        </span>
                      ) : (
                        <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full text-[10px] font-medium">
                          Régimen General
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 flex items-center gap-2 mt-0.5 flex-wrap">
                      {cli.direccion && <span>{cli.direccion} ({cli.poblacion})</span>}
                      {cli.telefono && <span>• Tel: {cli.telefono}</span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenCliente(cli)}
                    className="p-2 text-stone-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                    title="Editar Cliente"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`¿Eliminar al cliente ${cli.nombre}?`)) {
                        onDeleteCliente(cli.id);
                      }
                    }}
                    className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Eliminar Cliente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === SUBTAB: FORMATOS === */}
      {tabInterna === 'formatos' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
              <Package className="w-3.5 h-3.5 text-amber-600" />
              <span>Formatos Comerciales ({formatos.length})</span>
            </div>
            <button
              type="button"
              onClick={() => handleOpenFormato()}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Formato</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {formatos.map(fmt => (
              <div key={fmt.id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-stone-900 text-sm">{fmt.nombre}</h4>
                        {fmt.activo === false && (
                          <span className="text-[10px] bg-stone-100 text-stone-500 font-semibold px-1.5 py-0.5 rounded">
                            Inactivo
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full inline-block mt-1">
                        {fmt.cantidadHuevos} huevos · Calibre {fmt.calibreRecomendado}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenFormato(fmt)}
                        className="p-1.5 text-stone-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        title="Modificar Formato"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar formato ${fmt.nombre}?`)) {
                            onDeleteFormato(fmt.id);
                          }
                        }}
                        className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar Formato"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-stone-50 p-2.5 rounded-xl border border-stone-100 mt-3">
                    <div>
                      <span className="text-stone-400 block text-[10px]">Precio Venta (PVP):</span>
                      <strong className="text-base text-stone-900 font-black">{fmt.precioVenta.toFixed(2)} €</strong>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px]">Coste Envase:</span>
                      <span className="text-stone-700 font-semibold">{fmt.costeEnvase.toFixed(2)} €</span>
                    </div>
                  </div>

                  {fmt.textoEtiqueta && (
                    <p className="text-[11px] italic text-stone-500 mt-2">
                      «{fmt.textoEtiqueta}»
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400">
                  <span>Tipo: <strong className="text-stone-700 capitalize">{fmt.tipoEnvase.replace('_', ' ')}</strong></span>
                  <button
                    type="button"
                    onClick={() => handleOpenFormato(fmt)}
                    className="text-amber-700 hover:text-amber-800 font-bold hover:underline"
                  >
                    Editar datos →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === SUBTAB: NAVES Y REGA === */}
      {tabInterna === 'naves' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
              <Home className="w-3.5 h-3.5 text-amber-600" />
              <span>Naves de Producción ({naves.length})</span>
            </div>
            <button
              type="button"
              onClick={() => handleOpenNave()}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nueva Nave</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {naves.map(nave => (
              <div key={nave.id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="font-mono text-xs font-bold bg-amber-100 text-amber-950 px-2 py-0.5 rounded border border-amber-300">
                        {nave.codigo}
                      </span>
                      <h4 className="font-bold text-stone-900 text-sm mt-1">{nave.nombre}</h4>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenNave(nave)}
                        className="p-1.5 text-stone-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        title="Modificar Nave"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar nave ${nave.nombre}?`)) {
                            onDeleteNave(nave.id);
                          }
                        }}
                        className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar Nave"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-3 mt-2 border-t border-stone-100 text-stone-700">
                    <div>
                      <span className="text-[10px] text-stone-400 block">Código REGA:</span>
                      <strong className="font-mono text-stone-900">{nave.codigoREGA}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block">Sistema de Cría:</span>
                      <span className="font-bold text-amber-900">{nave.tipoCria}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block">Capacidad Aves:</span>
                      <span className="font-semibold text-stone-800">{nave.capacidadAves.toLocaleString()} aves</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 block">Estado Operativo:</span>
                      {nave.activa !== false ? (
                        <span className="text-emerald-700 font-bold">Activa ✓</span>
                      ) : (
                        <span className="text-stone-400 font-bold">Inactiva</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-stone-100 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleOpenNave(nave)}
                    className="text-amber-700 hover:text-amber-800 text-xs font-bold hover:underline"
                  >
                    Modificar datos de la nave →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === SUBTAB: DATOS DEL CENTRO DE ENVASADO Y FISCALES === */}
      {tabInterna === 'empresa' && (
        <form onSubmit={handleGuardarCentro} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-base text-stone-900">Centro de Envasado y Datos Fiscales</h3>
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Parámetros oficiales impresos en estuches, albaranes de entrega, facturas y registros de trazabilidad
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleResetCentro}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restablecer</span>
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Guardar Cambios</span>
              </button>
            </div>
          </div>

          {guardadoExitosoCentro && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
              <span>¡Datos del Centro de Envasado actualizados y guardados correctamente!</span>
            </div>
          )}

          {/* Bloque 1: Registros Sanitarios y de Centro de Envasado */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <span>1. Registros Oficiales del Centro de Envasado</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-700 mb-1">Nombre Comercial / Razón Social</label>
                <input
                  type="text"
                  value={empresaNombre}
                  onChange={e => setEmpresaNombre(e.target.value)}
                  placeholder="Granja Avícola Ejemplo S.L."
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-bold text-stone-900"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">CIF / NIF</label>
                <input
                  type="text"
                  value={empresaCif}
                  onChange={e => setEmpresaCif(e.target.value.toUpperCase())}
                  placeholder="B45000000"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Registro Sanitario Oficial (RGSEAA)
                </label>
                <input
                  type="text"
                  value={empresaSanitario}
                  onChange={e => setEmpresaSanitario(e.target.value)}
                  placeholder="ES 10.04523/TO CE"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-mono font-bold text-amber-950"
                  required
                />
                <span className="text-[10px] text-stone-400 block mt-0.5">Identificador sanitario para estuches y albaranes</span>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Código Autorización Centro Envasado
                </label>
                <input
                  type="text"
                  value={empresaCentroCod}
                  onChange={e => setEmpresaCentroCod(e.target.value)}
                  placeholder="ES-10.04523-TO"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-mono"
                />
                <span className="text-[10px] text-stone-400 block mt-0.5">Código de centro de embalaje autorizado</span>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Código REGA Central de la Granja
                </label>
                <input
                  type="text"
                  value={empresaRega}
                  onChange={e => setEmpresaRega(e.target.value.toUpperCase())}
                  placeholder="ES45000189"
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase"
                />
                <span className="text-[10px] text-stone-400 block mt-0.5">Registro de Explotaciones Ganaderas</span>
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-700 mb-1">
                  Responsable Técnico / Veterinario o Encargado de Calidad
                </label>
                <input
                  type="text"
                  value={empresaResponsable}
                  onChange={e => setEmpresaResponsable(e.target.value)}
                  placeholder="D. Juan Pérez - Veterinario Col. 1234"
                  className="w-full rounded-xl border border-stone-300 p-2.5 text-stone-800"
                />
              </div>
            </div>
          </div>

          {/* Bloque 2: Ubicación y Contacto */}
          <div className="space-y-3 pt-4 border-t border-stone-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <span>2. Domicilio y Vías de Contacto</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-700 mb-1">Dirección Postal / Ubicación de la Granja</label>
                <input
                  type="text"
                  value={empresaDir}
                  onChange={e => setEmpresaDir(e.target.value)}
                  placeholder="Camino de la Dehesa s/n, Polígono 4, Parcela 12"
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Población / Municipio</label>
                <input
                  type="text"
                  value={empresaPob}
                  onChange={e => setEmpresaPob(e.target.value)}
                  placeholder="Mora"
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Provincia</label>
                  <input
                    type="text"
                    value={empresaProv}
                    onChange={e => setEmpresaProv(e.target.value)}
                    placeholder="Toledo"
                    className="w-full rounded-xl border border-stone-300 p-2.5"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Código Postal</label>
                  <input
                    type="text"
                    value={empresaCp}
                    onChange={e => setEmpresaCp(e.target.value)}
                    placeholder="45400"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Teléfono</label>
                <input
                  type="text"
                  value={empresaTel}
                  onChange={e => setEmpresaTel(e.target.value)}
                  placeholder="925 000 000 / 600 000 000"
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Email de Contacto</label>
                <input
                  type="email"
                  value={empresaEmail}
                  onChange={e => setEmpresaEmail(e.target.value)}
                  placeholder="info@avicolaproyecto.com"
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>
            </div>
          </div>

          {/* Bloque 3: Contadores de Series */}
          <div className="space-y-3 pt-4 border-t border-stone-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <span>3. Control de Series y Numeración Oficial</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Siguiente Nº Albarán</label>
                <input
                  type="number"
                  min="1"
                  value={empresaContadorAlb}
                  onChange={e => setEmpresaContadorAlb(parseInt(e.target.value) || 1)}
                  className="w-full rounded-lg border border-stone-300 p-2 bg-white font-mono font-bold"
                />
                <span className="text-[10px] text-stone-400 block mt-0.5">Correlativo de entrega</span>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Siguiente Nº Factura</label>
                <input
                  type="number"
                  min="1"
                  value={empresaContadorFact}
                  onChange={e => setEmpresaContadorFact(parseInt(e.target.value) || 1)}
                  className="w-full rounded-lg border border-stone-300 p-2 bg-white font-mono font-bold"
                />
                <span className="text-[10px] text-stone-400 block mt-0.5">Serie contable</span>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Siguiente Nº Envasado</label>
                <input
                  type="number"
                  min="1"
                  value={empresaContadorEnv}
                  onChange={e => setEmpresaContadorEnv(parseInt(e.target.value) || 1)}
                  className="w-full rounded-lg border border-stone-300 p-2 bg-white font-mono font-bold"
                />
                <span className="text-[10px] text-stone-400 block mt-0.5">Lotes de envasado</span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>Guardar Datos del Centro de Envasado</span>
            </button>
          </div>
        </form>
      )}

      {/* 4. BOTÓN FLOTANTE CIRCULAR '+' (FAB) */}
      {tabInterna !== 'empresa' && (
        <button
          type="button"
          onClick={handleFabClick}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-600 to-amber-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all cursor-pointer group"
          title="Añadir Nuevo Elemento (+)"
        >
          <Plus className="w-7 h-7 stroke-[2.5] group-hover:rotate-90 transition-transform duration-200" />
        </button>
      )}

      {/* 5. MODAL CLIENTE */}
      {mostrarModalCliente && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">
                    {clienteEditando ? 'Editar Cliente' : 'Nuevo Cliente'}
                  </h3>
                  <p className="text-xs text-stone-500">Datos fiscales y régimen de IVA</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalCliente(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarCliente} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Nombre o Razón Social</label>
                <input
                  type="text"
                  value={nombreCli}
                  onChange={e => setNombreCli(e.target.value)}
                  placeholder="Ej: Supermercados del Tajo S.L."
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">CIF / NIF</label>
                  <input
                    type="text"
                    value={cifCli}
                    onChange={e => setCifCli(e.target.value)}
                    placeholder="B-12345678"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={telCli}
                    onChange={e => setTelCli(e.target.value)}
                    placeholder="600 000 000"
                    className="w-full rounded-xl border border-stone-300 p-2.5"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Dirección Completa</label>
                <input
                  type="text"
                  value={dirCli}
                  onChange={e => setDirCli(e.target.value)}
                  placeholder="Calle Comercio, 14"
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Población</label>
                  <input
                    type="text"
                    value={pobCli}
                    onChange={e => setPobCli(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Provincia</label>
                  <input
                    type="text"
                    value={provCli}
                    onChange={e => setProvCli(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Código Postal</label>
                  <input
                    type="text"
                    value={cpCli}
                    onChange={e => setCpCli(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 p-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Email</label>
                <input
                  type="email"
                  value={emailCli}
                  onChange={e => setEmailCli(e.target.value)}
                  placeholder="administracion@cliente.com"
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recargoCli}
                    onChange={e => setRecargoCli(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="font-bold text-stone-800">Aplica Recargo de Equivalencia (+0,5%)</span>
                    <span className="text-[11px] text-stone-500 block">
                      Obligatorio para comerciantes minoristas personas físicas
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalCliente(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
                >
                  Guardar Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MODAL FORMATO */}
      {mostrarModalFormato && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">
                    {formatoEditando ? 'Modificar Formato Comercial' : 'Nuevo Formato de Envasado'}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {formatoEditando ? `Actualizando datos de ${formatoEditando.nombre}` : 'Escandallo de envase y PVP'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalFormato(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarFormato} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Nombre Comercial del Formato</label>
                <input
                  type="text"
                  placeholder="Ej: Estuche 12 Huevos Clase L"
                  value={nombreFmt}
                  onChange={e => setNombreFmt(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Tipo de Envase</label>
                  <select
                    value={tipoEnvaseFmt}
                    onChange={e => setTipoEnvaseFmt(e.target.value as TipoEnvase)}
                    className="w-full rounded-xl border border-stone-300 p-2.5 bg-white"
                  >
                    <option value="estuche_carton">Estuche Cartón</option>
                    <option value="estuche_plastico">Estuche Plástico</option>
                    <option value="bandeja_celulosa">Bandeja Celulosa</option>
                    <option value="caja_granel">Caja Granel</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Huevos / Envase</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="12"
                    value={cantidadHuevosFmt}
                    onChange={e => setCantidadHuevosFmt(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Calibre</label>
                  <select
                    value={calibreFmt}
                    onChange={e => setCalibreFmt(e.target.value as any)}
                    className="w-full rounded-xl border border-stone-300 p-2 bg-white"
                  >
                    <option value="XL">XL</option>
                    <option value="L">L</option>
                    <option value="M">M</option>
                    <option value="S">S</option>
                    <option value="MIX">MIX</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Precio PVP (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="2.50"
                    value={precioVentaFmt}
                    onChange={e => setPrecioVentaFmt(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-stone-300 p-2 font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Coste Envase (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.25"
                    value={costeEnvaseFmt}
                    onChange={e => setCosteEnvaseFmt(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-stone-300 p-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Texto en Etiqueta</label>
                <input
                  type="text"
                  placeholder="Huevos frescos Clase A"
                  value={textoEtiquetaFmt}
                  onChange={e => setTextoEtiquetaFmt(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activoFmt}
                    onChange={e => setActivoFmt(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="font-bold text-stone-800">Formato Activo y Disponible</span>
                    <span className="text-[11px] text-stone-500 block">
                      Aparecerá en el selector de envasado y pedidos
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalFormato(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!nombreFmt.trim() || !cantidadHuevosFmt}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{formatoEditando ? 'Guardar Cambios' : 'Crear Formato'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. MODAL NAVE */}
      {mostrarModalNave && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
                  <Home className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">
                    {naveEditando ? 'Modificar Nave de Producción' : 'Nueva Nave de Producción'}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {naveEditando ? `Actualizando parámetros de ${naveEditando.codigo}` : 'Código REGA y sistema de cría'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalNave(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarNave} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Código Nave</label>
                  <input
                    type="text"
                    placeholder="NAV3"
                    value={codigoNave}
                    onChange={e => setCodigoNave(e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Capacidad (Aves)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="3000"
                    value={capacidadAvesNave}
                    onChange={e => setCapacidadAvesNave(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Nombre Descriptivo</label>
                <input
                  type="text"
                  placeholder="Ej: Nave 3 - Gallinas Camperas"
                  value={nombreNave}
                  onChange={e => setNombreNave(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Sistema de Cría</label>
                <select
                  value={tipoCriaNave}
                  onChange={e => setTipoCriaNave(e.target.value as TipoCria)}
                  className="w-full rounded-xl border border-stone-300 p-2.5 bg-white font-medium"
                >
                  <option value="0-Ecologico">0 - Ecológico</option>
                  <option value="1-Campero">1 - Campero</option>
                  <option value="2-Suelo">2 - En Suelo</option>
                  <option value="3-Jaula">3 - Jaula Acondicionada</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Código REGA Oficial</label>
                <input
                  type="text"
                  placeholder="ES4500000000"
                  value={codigoREGANave}
                  onChange={e => setCodigoREGANave(e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase"
                  required
                />
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activaNave}
                    onChange={e => setActivaNave(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="font-bold text-stone-800">Nave Activa y Operativa</span>
                    <span className="text-[11px] text-stone-500 block">
                      Disponible para registros diarios de puesta
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalNave(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!codigoNave.trim() || !nombreNave.trim()}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{naveEditando ? 'Guardar Cambios' : 'Crear Nave'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
