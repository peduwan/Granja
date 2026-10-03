import React, { useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  Building2,
  Phone,
  Mail,
  MapPin,
  FileText,
  ShieldCheck,
  Receipt,
  Clock,
  Eye,
  Printer,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Package,
  Calendar,
  DollarSign,
  AlertCircle,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Layers,
  ArrowRight,
  MessageCircle,
  Navigation
} from 'lucide-react';
import { Cliente, Albaran, Factura, ConfiguracionEmpresa, LineaDocumentoVenta } from '../types';
import { formatearFechaES, desglosarLineasPorLote } from '../utils/storage';

interface ClientesViewProps {
  clientes: Cliente[];
  albaranes?: Albaran[];
  facturas?: Factura[];
  config?: ConfiguracionEmpresa;
  onAddCliente: (cliente: Cliente) => void;
  onUpdateCliente: (cliente: Cliente) => void;
  onDeleteCliente: (id: string) => void;
}

export const ClientesView: React.FC<ClientesViewProps> = ({
  clientes,
  albaranes = [],
  facturas = [],
  config,
  onAddCliente,
  onUpdateCliente,
  onDeleteCliente
}) => {
  const [busqueda, setBusqueda] = useState('');
  const [filtroRegimen, setFiltroRegimen] = useState<'todos' | 'general' | 'recargo'>('todos');
  const [mostrarModal, setMostrarModal] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<Cliente | null>(null);
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
  const [mensajeAviso, setMensajeAviso] = useState<string | null>(null);
  const [clienteParaEliminar, setClienteParaEliminar] = useState<Cliente | null>(null);

  // Generador de enlaces a WhatsApp
  const generarUrlWhatsApp = (telefono?: string, nombreCliente?: string) => {
    if (!telefono) return '';
    let limpio = telefono.replace(/[^\d+]/g, '');
    if (limpio.startsWith('+')) {
      limpio = limpio.substring(1);
    } else if (limpio.length === 9) {
      limpio = '34' + limpio;
    }
    const texto = encodeURIComponent(
      `Hola ${nombreCliente || ''}, nos ponemos en contacto desde Granja Avícola El Valle en relación a sus pedidos de huevos camperos.`
    );
    return `https://wa.me/${limpio}?text=${texto}`;
  };

  // Generador de enlaces a Google Maps
  const generarUrlGoogleMaps = (cli?: { direccion?: string; poblacion?: string; provincia?: string; codigoPostal?: string }) => {
    if (!cli) return '';
    const partes = [cli.direccion, cli.codigoPostal, cli.poblacion, cli.provincia, 'España'].filter(Boolean);
    if (partes.length === 0) return '';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes.join(', '))}`;
  };

  // Ficha de cliente activa (modal con scroll nativo 100% fluido)
  const [clienteSeleccionadoFicha, setClienteSeleccionadoFicha] = useState<Cliente | null>(null);
  
  // Vista expandida en la misma página (acordeón directo sin modal para máxima comodidad en móvil)
  const [clienteExpandidoId, setClienteExpandidoId] = useState<string | null>(null);

  // Subpestañas de filtrado: 'todos' muestra tanto albaranes como facturas en una sola vista
  const [subTabFicha, setSubTabFicha] = useState<'todos' | 'pendientes' | 'albaranes' | 'facturas'>('todos');
  const [copiadoCif, setCopiadoCif] = useState(false);

  // Modal para imprimir/ver documento oficial de albarán o factura
  const [documentoImprimir, setDocumentoImprimir] = useState<{ tipo: 'albaran' | 'factura'; doc: Albaran | Factura } | null>(null);

  // Campos de formulario
  const [nombre, setNombre] = useState('');
  const [cifNif, setCifNif] = useState('');
  const [direccion, setDireccion] = useState('');
  const [poblacion, setPoblacion] = useState('');
  const [provincia, setProvincia] = useState('');
  const [codigoPostal, setCodigoPostal] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [recargoEquivalencia, setRecargoEquivalencia] = useState(false);

  const normalizar = (s?: string) => (s || '').toLowerCase().trim().replace(/[\s\-_.]/g, '');

  const clientesFiltrados = useMemo(() => {
    return clientes.filter(c => {
      const matchTexto =
        c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        c.cifNif.toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.poblacion && c.poblacion.toLowerCase().includes(busqueda.toLowerCase())) ||
        (c.telefono && c.telefono.includes(busqueda));

      if (!matchTexto) return false;
      if (filtroRegimen === 'general') return !c.recargoEquivalencia;
      if (filtroRegimen === 'recargo') return !!c.recargoEquivalencia;
      return true;
    });
  }, [clientes, busqueda, filtroRegimen]);

  const clientesConRecargo = clientes.filter(c => c.recargoEquivalencia).length;

  // Función utilitaria para obtener los documentos de un cliente concreto
  const obtenerDocumentosCliente = (cli: Cliente | null) => {
    if (!cli) return { albaranes: [], facturas: [], pendientes: [], totalPendiente: 0, totalFacturado: 0, totalEstuches: 0 };
    const id = cli.id;
    const cifNorm = normalizar(cli.cifNif);
    const nomNorm = normalizar(cli.nombre);

    const albs = albaranes
      .filter(a => {
        if (a.clienteId && a.clienteId === id) return true;
        if (cifNorm && normalizar(a.clienteCif) === cifNorm) return true;
        if (nomNorm && normalizar(a.clienteNombre) === nomNorm) return true;
        return false;
      })
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    const facts = facturas
      .filter(f => {
        if (f.clienteId && f.clienteId === id) return true;
        if (cifNorm && normalizar(f.clienteCif) === cifNorm) return true;
        if (nomNorm && normalizar(f.clienteNombre) === nomNorm) return true;
        return false;
      })
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    const ptes = albs.filter(a => a.estado === 'pendiente_facturar');
    const totalPte = ptes.reduce((acc, a) => acc + (a.totales?.totalDocumento || 0), 0);
    const totalFact = facts.reduce((acc, f) => acc + (f.totales?.totalDocumento || 0), 0);
    const totalEst = albs.reduce((acc, a) => {
      const sum = a.lineas.reduce((lAcc, l) => lAcc + (l.cantidadEstuches || 0), 0);
      return acc + sum;
    }, 0);

    return {
      albaranes: albs,
      facturas: facts,
      pendientes: ptes,
      totalPendiente: totalPte,
      totalFacturado: totalFact,
      totalEstuches: totalEst
    };
  };

  // Cálculos específicos para la Ficha del Cliente abierta
  const docsFicha = useMemo(() => {
    return obtenerDocumentosCliente(clienteSeleccionadoFicha);
  }, [clienteSeleccionadoFicha, albaranes, facturas]);

  const handleOpenModal = (cli?: Cliente) => {
    if (cli) {
      setClienteEditando(cli);
      setNombre(cli.nombre);
      setCifNif(cli.cifNif);
      setDireccion(cli.direccion || '');
      setPoblacion(cli.poblacion || '');
      setProvincia(cli.provincia || '');
      setCodigoPostal(cli.codigoPostal || '');
      setTelefono(cli.telefono || '');
      setEmail(cli.email || '');
      setRecargoEquivalencia(!!cli.recargoEquivalencia);
    } else {
      setClienteEditando(null);
      setNombre('');
      setCifNif('');
      setDireccion('');
      setPoblacion('');
      setProvincia('');
      setCodigoPostal('');
      setTelefono('');
      setEmail('');
      setRecargoEquivalencia(false);
    }
    setMostrarModal(true);
  };

  const handleAbrirFicha = (cli: Cliente) => {
    setClienteSeleccionadoFicha(cli);
    setSubTabFicha('todos');
  };

  const handleToggleExpandir = (cliId: string) => {
    setClienteExpandidoId(prev => (prev === cliId ? null : cliId));
  };

  const handleCopiarCif = (cif: string) => {
    navigator.clipboard.writeText(cif);
    setCopiadoCif(true);
    setTimeout(() => setCopiadoCif(false), 2000);
  };

  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !cifNif.trim()) {
      setErrorFormulario('Nombre o razón social y CIF/NIF son obligatorios.');
      return;
    }
    setErrorFormulario(null);

    const cData: Cliente = {
      id: clienteEditando ? clienteEditando.id : 'cli-' + Date.now(),
      nombre: nombre.trim(),
      cifNif: cifNif.trim().toUpperCase(),
      direccion: direccion.trim(),
      poblacion: poblacion.trim(),
      provincia: provincia.trim(),
      codigoPostal: codigoPostal.trim(),
      telefono: telefono.trim(),
      email: email.trim(),
      recargoEquivalencia
    };

    if (clienteEditando) {
      onUpdateCliente(cData);
      if (clienteSeleccionadoFicha && clienteSeleccionadoFicha.id === cData.id) {
        setClienteSeleccionadoFicha(cData);
      }
    } else {
      onAddCliente(cData);
    }
    setMostrarModal(false);
  };

  const handleEliminar = (cli: Cliente) => {
    const tieneDocs =
      albaranes.some(a => a.clienteId === cli.id || normalizar(a.clienteCif) === normalizar(cli.cifNif)) ||
      facturas.some(f => f.clienteId === cli.id || normalizar(f.clienteCif) === normalizar(cli.cifNif));

    if (tieneDocs) {
      setMensajeAviso(
        `No se puede eliminar el cliente "${cli.nombre}" porque tiene albaranes o facturas registradas en el historial fiscal y de trazabilidad. Puedes modificar sus datos si es necesario.`
      );
      return;
    }

    setClienteParaEliminar(cli);
  };

  const ejecutarEliminacionCliente = () => {
    if (!clienteParaEliminar) return;
    const cli = clienteParaEliminar;
    onDeleteCliente(cli.id);
    if (clienteSeleccionadoFicha && clienteSeleccionadoFicha.id === cli.id) {
      setClienteSeleccionadoFicha(null);
    }
    if (clienteExpandidoId === cli.id) {
      setClienteExpandidoId(null);
    }
    setClienteParaEliminar(null);
  };

  // Renderizador unificado para el bloque de documentos (usado tanto en la Ficha Modal como en el acordeón en línea)
  const renderBloqueDocumentos = (
    docData: ReturnType<typeof obtenerDocumentosCliente>,
    clienteNombre: string,
    subTabActiva: 'todos' | 'pendientes' | 'albaranes' | 'facturas',
    isInline: boolean = false
  ) => {
    const { albaranes: albs, facturas: facts, pendientes: ptes, totalPendiente, totalFacturado, totalEstuches } = docData;

    if (albs.length === 0 && facts.length === 0) {
      return (
        <div className="bg-white p-6 sm:p-8 rounded-xl border border-dashed border-stone-300 text-center space-y-2.5 my-2">
          <div className="w-10 h-10 rounded-full bg-stone-100 text-stone-400 mx-auto flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-stone-800 text-sm">
            Sin documentos emitidos para este cliente
          </h4>
          <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
            Aún no se ha emitido ningún albarán ni factura para <strong>{clienteNombre}</strong>.
            Puedes registrar un albarán desde el módulo de Ventas → Albaranes.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* SECCIÓN 1: ALBARANES PENDIENTES */}
        {(subTabActiva === 'todos' || subTabActiva === 'pendientes') && ptes.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-700" />
                <span>Albaranes Pendientes de Facturar ({ptes.length})</span>
              </h4>
              <span className="text-xs font-black text-amber-900 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                Total: {totalPendiente.toFixed(2)} €
              </span>
            </div>

            <div className="divide-y divide-stone-200 border border-amber-300 rounded-xl overflow-hidden bg-white shadow-xs">
              {ptes.map(alb => (
                <div key={alb.id} className="p-3 sm:p-4 space-y-2 bg-amber-50/20 hover:bg-amber-50/40 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs sm:text-sm text-stone-900 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                        {alb.numeroAlbaran}
                      </span>
                      <span className="text-xs text-stone-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-stone-400" />
                        {formatearFechaES(alb.fecha)}
                      </span>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-950 border border-amber-300 rounded-full font-bold text-[10px]">
                        Pendiente
                      </span>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0 border-t sm:border-t-0 border-stone-100">
                      <span className="text-sm sm:text-base font-black text-amber-950">
                        {alb.totales?.totalDocumento?.toFixed(2)} €
                      </span>
                      <button
                        type="button"
                        onClick={() => setDocumentoImprimir({ tipo: 'albaran', doc: alb })}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-stone-100 hover:bg-amber-100 text-stone-800 hover:text-amber-900 border border-stone-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        title="Ver e imprimir albarán oficial"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Ver / Imprimir</span>
                      </button>
                    </div>
                  </div>

                  {/* Desglose de lotes */}
                  <div className="bg-white rounded-lg p-2 border border-stone-200 text-xs space-y-1">
                    {desglosarLineasPorLote(alb.lineas).map((l, i) => (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-0.5 border-b last:border-b-0 border-stone-100">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-900">{l.nombreFormato}</span>
                          <span className="font-mono text-[10px] text-amber-900 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                            Lote: {l.codigoLotePuesta}
                          </span>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-2 text-stone-700">
                          <span className="text-[11px] text-stone-500">
                            {l.cantidadEstuches} est. × {l.precioUnitario?.toFixed(2)} €
                          </span>
                          <strong className="font-bold text-stone-900">{l.subtotal?.toFixed(2)} €</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mensaje cuando subTab === 'pendientes' pero no hay pendientes */}
        {subTabActiva === 'pendientes' && ptes.length === 0 && (
          <div className="p-6 bg-white rounded-xl border border-dashed border-stone-300 text-center space-y-1.5">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <h5 className="font-bold text-stone-800 text-xs sm:text-sm">
              Al día: Sin entregas pendientes de facturar
            </h5>
            <p className="text-xs text-stone-500 max-w-sm mx-auto">
              Todos los albaranes registrados para este cliente han sido formalizados en factura.
            </p>
          </div>
        )}

        {/* SECCIÓN 2: TODOS LOS ALBARANES */}
        {(subTabActiva === 'todos' || subTabActiva === 'albaranes') && albs.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-stone-600" />
                <span>Historial de Albaranes ({albs.length})</span>
              </h4>
              <span className="text-xs text-stone-500 font-medium">
                {totalEstuches.toLocaleString()} estuches entregados
              </span>
            </div>

            <div className="divide-y divide-stone-200 border border-stone-200 rounded-xl overflow-hidden bg-white shadow-xs">
              {albs.map(alb => (
                <div key={alb.id} className="p-3 sm:p-4 space-y-2 hover:bg-stone-50/60 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs sm:text-sm text-stone-900 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                        {alb.numeroAlbaran}
                      </span>
                      <span className="text-xs text-stone-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-stone-400" />
                        {formatearFechaES(alb.fecha)}
                      </span>
                      {alb.estado === 'pendiente_facturar' ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-950 border border-amber-300 rounded-full font-bold text-[10px] flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-amber-700" />
                          Pendiente Facturar
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-950 border border-emerald-300 rounded-full font-bold text-[10px] flex items-center gap-1">
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-700" />
                          Facturado {alb.numeroFactura && `(${alb.numeroFactura})`}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0 border-t sm:border-t-0 border-stone-100">
                      <span className="text-sm sm:text-base font-black text-stone-900">
                        {alb.totales?.totalDocumento?.toFixed(2)} €
                      </span>
                      <button
                        type="button"
                        onClick={() => setDocumentoImprimir({ tipo: 'albaran', doc: alb })}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-stone-100 hover:bg-amber-100 text-stone-800 hover:text-amber-900 border border-stone-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        title="Ver e imprimir albarán oficial"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Ver / Imprimir</span>
                      </button>
                    </div>
                  </div>

                  {/* Resumen de productos entregados */}
                  <div className="bg-stone-50 rounded-lg p-2 border border-stone-200/80 text-xs space-y-1">
                    {desglosarLineasPorLote(alb.lineas).map((l, i) => (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-900">{l.nombreFormato}</span>
                          <span className="font-mono text-[10px] text-amber-900 bg-amber-100/70 px-1.5 py-0.2 rounded border border-amber-200">
                            Lote: {l.codigoLotePuesta}
                          </span>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-2">
                          <span className="font-medium text-stone-600 text-[11px]">{l.cantidadEstuches} estuches</span>
                          <strong className="font-bold text-stone-900">{l.subtotal?.toFixed(2)} €</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECCIÓN 3: FACTURAS EMITIDAS */}
        {(subTabActiva === 'todos' || subTabActiva === 'facturas') && facts.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-950 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-emerald-700" />
                <span>Facturas Oficiales Emitidas ({facts.length})</span>
              </h4>
              <span className="text-xs font-black text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-300">
                Total: {totalFacturado.toFixed(2)} €
              </span>
            </div>

            <div className="divide-y divide-stone-200 border border-stone-200 rounded-xl overflow-hidden bg-white shadow-xs">
              {facts.map(fac => (
                <div key={fac.id} className="p-3 sm:p-4 space-y-2 hover:bg-stone-50/60 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs sm:text-sm text-stone-900 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                        {fac.numeroFactura}
                      </span>
                      <span className="text-xs text-stone-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-stone-400" />
                        {formatearFechaES(fac.fecha)}
                      </span>
                      {fac.esRectificativa ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-full font-bold text-[10px] flex items-center gap-1">
                          <RotateCcw className="w-2.5 h-2.5 text-amber-700" />
                          Rectificativa ({fac.facturaRectificadaNumero})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-full font-bold text-[10px] flex items-center gap-1">
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-700" />
                          Factura {fac.tipoFactura || 'F1'}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        fac.estadoPago === 'pagada'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          : 'bg-amber-100 text-amber-900 border border-amber-200'
                      }`}>
                        {fac.estadoPago === 'pagada' ? 'Cobrada' : 'Pendiente Pago'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0 border-t sm:border-t-0 border-stone-100">
                      <span className="text-sm sm:text-base font-black text-stone-950">
                        {fac.totales?.totalDocumento?.toFixed(2)} €
                      </span>
                      <button
                        type="button"
                        onClick={() => setDocumentoImprimir({ tipo: 'factura', doc: fac })}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs"
                        title="Ver e imprimir factura oficial"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Ver / Imprimir</span>
                      </button>
                    </div>
                  </div>

                  {/* Origen y Líneas */}
                  <div className="bg-stone-50 rounded-lg p-2 border border-stone-200/80 text-xs space-y-1">
                    {fac.albaranesAsociados && fac.albaranesAsociados.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-stone-600 flex-wrap text-[11px]">
                        <span className="font-semibold text-stone-500">Albaranes incluidos:</span>
                        {fac.albaranesAsociados.map(a => (
                          <span key={a.id} className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-stone-300 text-stone-800">
                            {a.numeroAlbaran}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-stone-500 italic text-[11px]">
                        Venta directa (sin albaranes previos)
                      </div>
                    )}

                    <div className="pt-1 border-t border-stone-200/60 space-y-1">
                      {desglosarLineasPorLote(fac.lineas).map((l, i) => (
                        <div key={i} className="flex justify-between items-center text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-stone-900">{l.nombreFormato}</span>
                            <span className="font-mono text-[10px] text-amber-900 bg-amber-100/70 px-1.5 py-0.2 rounded border border-amber-200">
                              Lote: {l.codigoLotePuesta}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-stone-600 mr-2 text-[11px]">{l.cantidadEstuches} est.</span>
                            <strong className="font-bold text-stone-900">{l.subtotal?.toFixed(2)} €</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mensaje cuando subTab === 'facturas' pero no hay */}
        {subTabActiva === 'facturas' && facts.length === 0 && (
          <div className="p-6 bg-white rounded-xl border border-dashed border-stone-300 text-center space-y-1.5">
            <Receipt className="w-8 h-8 text-stone-400 mx-auto" />
            <h5 className="font-bold text-stone-800 text-xs sm:text-sm">
              No hay facturas emitidas a este cliente
            </h5>
            <p className="text-xs text-stone-500 max-w-sm mx-auto">
              Puedes emitir facturas asociadas a sus albaranes desde Ventas → Facturación.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Encabezado y Filtros */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-stone-900 leading-tight">
                Cartera de Clientes Comerciales
              </h3>
              <p className="text-xs text-stone-500">
                Consulta albaranes entregados, entregas pendientes y facturas oficiales por cliente
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenModal()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-700 hover:bg-amber-800 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Cliente</span>
          </button>
        </div>

        {/* Barra de Filtros y Búsqueda */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-stone-100 text-xs">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar cliente por nombre, CIF/NIF, localidad o teléfono..."
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-stone-300 text-xs focus:ring-2 focus:ring-amber-500 bg-stone-50/50 focus:bg-white"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filtroRegimen}
              onChange={e => setFiltroRegimen(e.target.value as any)}
              className="w-full py-2 px-3 rounded-xl border border-stone-300 text-xs font-medium text-stone-700 bg-stone-50/50 focus:bg-white"
            >
              <option value="todos">Todos los regímenes ({clientes.length})</option>
              <option value="general">Régimen General ({clientes.length - clientesConRecargo})</option>
              <option value="recargo">Recargo de Equivalencia ({clientesConRecargo})</option>
            </select>
          </div>
        </div>
      </div>

      {/* Listado de Clientes */}
      {clientesFiltrados.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-2xl p-8 sm:p-10 text-center space-y-3">
          <Users className="w-12 h-12 text-stone-300 mx-auto" />
          <h4 className="text-sm font-bold text-stone-800">
            {busqueda ? 'No se encontraron clientes coincidentes' : 'No hay clientes registrados'}
          </h4>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            {busqueda
              ? 'Prueba a cambiar el texto de búsqueda o el filtro de régimen fiscal.'
              : 'Añade clientes para emitir albaranes de entrega y facturas legales con IVA o Recargo de Equivalencia.'}
          </p>
          {!busqueda && (
            <button
              type="button"
              onClick={() => handleOpenModal()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs hover:bg-amber-800 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir Cliente</span>
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
          {clientesFiltrados.map(cli => {
            const docInfo = obtenerDocumentosCliente(cli);
            const isExpanded = clienteExpandidoId === cli.id;

            return (
              <div key={cli.id} className="transition-colors">
                {/* Fila principal del cliente */}
                <div className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-amber-50/20">
                  <div
                    onClick={() => handleToggleExpandir(cli.id)}
                    className="flex items-start sm:items-center gap-3 min-w-0 cursor-pointer group flex-1"
                  >
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-amber-100/80 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200 group-hover:bg-amber-200 transition-colors">
                      <Building2 className="w-5 h-5 text-amber-700" />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="text-stone-900 text-sm font-bold group-hover:text-amber-900 transition-colors">
                          {cli.nombre}
                        </strong>
                        <span className="font-mono text-xs text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 font-bold">
                          {cli.cifNif}
                        </span>
                        {cli.recargoEquivalencia ? (
                          <span className="bg-purple-100 text-purple-900 px-2 py-0.5 rounded-full font-bold text-[10px] border border-purple-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-600" />
                            4% + 0,5% RE
                          </span>
                        ) : (
                          <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-200">
                            Régimen General
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-stone-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {(cli.direccion || cli.poblacion) && (
                          <a
                            href={generarUrlGoogleMaps(cli)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 truncate max-w-xs sm:max-w-md text-amber-800 hover:text-amber-950 hover:underline group/maps"
                            title="Abrir ubicación en Google Maps (Cómo llegar)"
                          >
                            <MapPin className="w-3.5 h-3.5 text-amber-600 group-hover/maps:scale-110 transition-transform shrink-0" />
                            <span className="truncate">
                              {cli.direccion} {cli.poblacion && `(${cli.poblacion})`}
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 text-stone-400 group-hover/maps:text-amber-700 shrink-0" />
                          </a>
                        )}
                        {cli.telefono && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={`tel:${cli.telefono}`}
                              onClick={e => e.stopPropagation()}
                              className="flex items-center gap-1 text-stone-600 hover:text-amber-800"
                              title="Llamar al cliente"
                            >
                              <Phone className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                              <span>{cli.telefono}</span>
                            </a>
                            <a
                              href={generarUrlWhatsApp(cli.telefono, cli.nombre)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded font-bold text-[10px] border border-emerald-300 transition-colors"
                              title="Enviar mensaje por WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3 text-emerald-700" />
                              <span>WhatsApp</span>
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Resumen de documentos y alerta de pendientes */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                        {docInfo.pendientes.length > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-950 border border-amber-300 rounded-full font-bold text-[11px]">
                            <Clock className="w-3 h-3 text-amber-700 shrink-0" />
                            <span>{docInfo.pendientes.length} pendiente{docInfo.pendientes.length > 1 ? 's' : ''} ({docInfo.totalPendiente.toFixed(2)} €)</span>
                          </span>
                        ) : docInfo.albaranes.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Al día (0 pendientes)</span>
                          </span>
                        ) : null}

                        <span className="text-[11px] text-stone-500">
                          {docInfo.albaranes.length} albaranes · {docInfo.facturas.length} facturas ({docInfo.totalFacturado.toFixed(2)} €)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Acciones principales */}
                  <div className="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-stone-100">
                    {/* Botón rápido para desplegar aquí mismo en la página sin modal */}
                    <button
                      type="button"
                      onClick={() => handleToggleExpandir(cli.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                        isExpanded
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200'
                      }`}
                      title={isExpanded ? 'Ocultar albaranes y facturas' : 'Ver albaranes y facturas aquí mismo'}
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>{isExpanded ? 'Ocultar' : 'Desplegar'}</span>
                    </button>

                    {/* Botón para abrir la Ficha completa */}
                    <button
                      type="button"
                      onClick={() => handleAbrirFicha(cli)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl transition-all shadow-2xs hover:shadow-xs cursor-pointer"
                      title="Ver Ficha Completa del Cliente"
                    >
                      <Eye className="w-3.5 h-3.5 text-amber-700" />
                      <span>Ficha Completa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenModal(cli)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-stone-600 hover:text-amber-800 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
                      title="Editar Datos del Cliente"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-stone-500" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleEliminar(cli)}
                      className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                      title="Eliminar Cliente"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* VISTA EXPANDIDA DIRECTAMENTE EN LA LISTA (Ideal para móvil, 100% scroll nativo garantizado) */}
                {isExpanded && (
                  <div className="bg-stone-50/70 p-3 sm:p-5 border-t border-stone-200 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-stone-700">Documentos de {cli.nombre}:</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAbrirFicha(cli)}
                        className="text-xs font-bold text-amber-800 hover:text-amber-950 flex items-center gap-1 cursor-pointer underline"
                      >
                        <span>Abrir en ventana completa</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {renderBloqueDocumentos(docInfo, cli.nombre, 'todos', true)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL / FICHA COMPLETA DEL CLIENTE                                   */}
      {/* (100% Scroll Nativo en Móvil: El contenedor exterior tiene el scroll) */}
      {/* ===================================================================== */}
      {clienteSeleccionadoFicha && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/80 backdrop-blur-xs overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* Contenedor centrador que permite scroll completo vertical */}
          <div className="min-h-full w-full flex flex-col justify-start items-center p-0 sm:p-4 md:p-6 pb-20">
            <div className="bg-white w-full max-w-4xl min-h-screen sm:min-h-0 sm:rounded-2xl shadow-2xl flex flex-col my-0 sm:my-4 border-0 sm:border border-stone-200 overflow-visible animate-in fade-in">
              
              {/* 1. Barra Superior Móvil / Escritorio (Sticky Header Nativo) */}
              <div className="sticky top-0 z-30 p-3.5 sm:p-5 bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white shadow-md">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-400/30">
                      <Building2 className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-400/30">
                          Ficha del Cliente
                        </span>
                        {clienteSeleccionadoFicha.recargoEquivalencia ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-500/30 text-purple-200 rounded border border-purple-400/40">
                            Recargo 4% + 0,5%
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500/30 text-emerald-200 rounded border border-emerald-400/40">
                            Régimen General 4%
                          </span>
                        )}
                      </div>

                      <h2 className="text-base sm:text-2xl font-black text-white tracking-tight truncate">
                        {clienteSeleccionadoFicha.nombre}
                      </h2>

                      <div className="flex items-center gap-2 sm:gap-3 text-xs text-stone-300 flex-wrap">
                        <div className="flex items-center gap-1 bg-stone-800/90 px-2 py-0.5 rounded font-mono text-[11px]">
                          <span className="text-stone-400">CIF:</span>
                          <strong className="text-amber-300 font-bold">{clienteSeleccionadoFicha.cifNif}</strong>
                          <button
                            type="button"
                            onClick={() => handleCopiarCif(clienteSeleccionadoFicha.cifNif)}
                            className="text-stone-400 hover:text-white p-0.5 cursor-pointer ml-0.5"
                            title="Copiar CIF"
                          >
                            {copiadoCif ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>

                        {/* Teléfono con llamada directa */}
                        {clienteSeleccionadoFicha.telefono && (
                          <a
                            href={`tel:${clienteSeleccionadoFicha.telefono}`}
                            className="flex items-center gap-1 text-stone-300 hover:text-amber-300 transition-colors text-[11px]"
                            title="Llamar al cliente"
                          >
                            <Phone className="w-3 h-3 text-stone-400" />
                            <span>{clienteSeleccionadoFicha.telefono}</span>
                          </a>
                        )}

                        {/* Dirección clickeable que abre directamente Google Maps */}
                        {(clienteSeleccionadoFicha.direccion || clienteSeleccionadoFicha.poblacion) ? (
                          <a
                            href={generarUrlGoogleMaps(clienteSeleccionadoFicha)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-amber-300 hover:text-white underline decoration-amber-400/50 hover:decoration-white transition-colors text-[11px] max-w-xs sm:max-w-md truncate group/maps"
                            title="Abrir ubicación en Google Maps (Cómo llegar)"
                          >
                            <MapPin className="w-3 h-3 text-amber-400 group-hover/maps:scale-110 transition-transform shrink-0" />
                            <span className="truncate">
                              {clienteSeleccionadoFicha.direccion ? `${clienteSeleccionadoFicha.direccion}, ` : ''}
                              {clienteSeleccionadoFicha.poblacion || ''}
                              {clienteSeleccionadoFicha.provincia ? ` (${clienteSeleccionadoFicha.provincia})` : ''}
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 text-stone-400 group-hover/maps:text-white shrink-0" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {/* Botón WhatsApp destacado en la cabecera */}
                    {clienteSeleccionadoFicha.telefono ? (
                      <a
                        href={generarUrlWhatsApp(clienteSeleccionadoFicha.telefono, clienteSeleccionadoFicha.nombre)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs hover:shadow cursor-pointer"
                        title="Enviar mensaje de WhatsApp al cliente"
                      >
                        <MessageCircle className="w-4 h-4 fill-white/20" />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenModal(clienteSeleccionadoFicha)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-stone-800 text-stone-400 hover:text-amber-300 rounded-xl text-xs border border-stone-700 transition-colors cursor-pointer"
                        title="Añadir teléfono para enviar WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">+ Teléfono</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenModal(clienteSeleccionadoFicha)}
                      className="p-1.5 sm:p-2 text-stone-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                      title="Editar datos del cliente"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setClienteSeleccionadoFicha(null)}
                      className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                      title="Cerrar Ficha"
                    >
                      <X className="w-4 h-4" />
                      <span className="hidden sm:inline">Cerrar</span>
                    </button>
                  </div>
                </div>

                {/* Barra de Acciones Rápidas: WhatsApp, Google Maps y selector de clientes */}
                <div className="mt-3 pt-3 border-t border-stone-700/60 flex flex-wrap items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Botón WhatsApp */}
                    {clienteSeleccionadoFicha.telefono && (
                      <a
                        href={generarUrlWhatsApp(clienteSeleccionadoFicha.telefono, clienteSeleccionadoFicha.nombre)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-xs transition-colors cursor-pointer"
                        title={`Enviar WhatsApp a ${clienteSeleccionadoFicha.telefono}`}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>WhatsApp ({clienteSeleccionadoFicha.telefono})</span>
                      </a>
                    )}

                    {/* Botón Abrir en Google Maps */}
                    {(clienteSeleccionadoFicha.direccion || clienteSeleccionadoFicha.poblacion) ? (
                      <a
                        href={generarUrlGoogleMaps(clienteSeleccionadoFicha)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 hover:text-white rounded-lg font-bold text-xs border border-amber-500/40 transition-colors cursor-pointer"
                        title="Abrir dirección en Google Maps"
                      >
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        <span>Abrir en Google Maps</span>
                        <ExternalLink className="w-3 h-3 text-amber-300/80" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenModal(clienteSeleccionadoFicha)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-stone-800 text-stone-400 hover:text-stone-200 rounded-lg text-xs cursor-pointer border border-stone-700"
                        title="Añadir dirección para Google Maps"
                      >
                        <MapPin className="w-3 h-3 text-stone-500" />
                        <span>Añadir dirección para Maps</span>
                      </button>
                    )}
                  </div>

                  {/* Selector para alternar entre clientes */}
                  {clientes.length > 1 && (
                    <div className="flex items-center gap-1.5 text-stone-400 text-xs ml-auto">
                      <span className="text-[11px] hidden sm:inline">Ver otro cliente:</span>
                      <select
                        value={clienteSeleccionadoFicha.id}
                        onChange={e => {
                          const found = clientes.find(c => c.id === e.target.value);
                          if (found) setClienteSeleccionadoFicha(found);
                        }}
                        className="bg-stone-800 text-stone-200 border border-stone-700 text-xs rounded-lg px-2.5 py-1 font-medium focus:ring-1 focus:ring-amber-400 cursor-pointer"
                      >
                        {clientes.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. KPIs Compactos (3 Columnas fluidas en móvil) */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-3 p-2.5 sm:p-4 bg-stone-50 border-b border-stone-200 text-xs">
                {/* Col 1: Pendientes de Facturar */}
                <button
                  type="button"
                  onClick={() => setSubTabFicha('pendientes')}
                  className={`p-2 sm:p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    subTabFicha === 'pendientes'
                      ? 'bg-amber-100/70 border-amber-400 ring-2 ring-amber-400/30 shadow-xs'
                      : docsFicha.pendientes.length > 0
                      ? 'bg-amber-50/80 border-amber-200 hover:bg-amber-50'
                      : 'bg-white border-stone-200 hover:bg-stone-100/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-600 uppercase tracking-tight truncate flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-700 shrink-0" />
                      <span className="truncate">Pendientes</span>
                    </span>
                    {docsFicha.pendientes.length > 0 && (
                      <span className="px-1.5 py-0.2 bg-amber-600 text-white rounded-full text-[9px] sm:text-[10px] font-black">
                        {docsFicha.pendientes.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <strong className="text-sm sm:text-base font-black text-amber-950 block truncate">
                      {docsFicha.totalPendiente.toFixed(2)} €
                    </strong>
                    <span className="text-[9px] sm:text-[11px] text-stone-500 block truncate">
                      {docsFicha.pendientes.length} por facturar
                    </span>
                  </div>
                </button>

                {/* Col 2: Total Albaranes */}
                <button
                  type="button"
                  onClick={() => setSubTabFicha('albaranes')}
                  className={`p-2 sm:p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    subTabFicha === 'albaranes'
                      ? 'bg-stone-200/80 border-stone-400 ring-2 ring-stone-400/30 shadow-xs'
                      : 'bg-white border-stone-200 hover:bg-stone-100/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-600 uppercase tracking-tight truncate flex items-center gap-1">
                      <FileText className="w-3 h-3 text-stone-600 shrink-0" />
                      <span className="truncate">Albaranes</span>
                    </span>
                    <span className="px-1.5 py-0.2 bg-stone-200 text-stone-800 rounded-full text-[9px] sm:text-[10px] font-bold">
                      {docsFicha.albaranes.length}
                    </span>
                  </div>
                  <div className="mt-1">
                    <strong className="text-sm sm:text-base font-black text-stone-900 block truncate">
                      {docsFicha.totalEstuches.toLocaleString()} <span className="text-[10px] font-normal text-stone-500">est.</span>
                    </strong>
                    <span className="text-[9px] sm:text-[11px] text-stone-500 block truncate">
                      {docsFicha.albaranes.length} entregas
                    </span>
                  </div>
                </button>

                {/* Col 3: Facturación Acumulada */}
                <button
                  type="button"
                  onClick={() => setSubTabFicha('facturas')}
                  className={`p-2 sm:p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    subTabFicha === 'facturas'
                      ? 'bg-emerald-100/70 border-emerald-400 ring-2 ring-emerald-400/30 shadow-xs'
                      : 'bg-white border-stone-200 hover:bg-stone-100/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-600 uppercase tracking-tight truncate flex items-center gap-1">
                      <Receipt className="w-3 h-3 text-emerald-700 shrink-0" />
                      <span className="truncate">Facturas</span>
                    </span>
                    <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-900 rounded-full text-[9px] sm:text-[10px] font-bold">
                      {docsFicha.facturas.length}
                    </span>
                  </div>
                  <div className="mt-1">
                    <strong className="text-sm sm:text-base font-black text-emerald-950 block truncate">
                      {docsFicha.totalFacturado.toFixed(2)} €
                    </strong>
                    <span className="text-[9px] sm:text-[11px] text-stone-500 block truncate">
                      {docsFicha.facturas.filter(f => f.estadoPago === 'pagada').length} cobradas
                    </span>
                  </div>
                </button>
              </div>

              {/* 3. Selector de Pestañas */}
              <div className="px-3 sm:px-5 pt-2.5 border-b border-stone-200 bg-white flex gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSubTabFicha('todos')}
                  className={`flex items-center gap-1.5 pb-2 px-2.5 sm:px-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    subTabFicha === 'todos'
                      ? 'border-amber-700 text-amber-900'
                      : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-amber-700" />
                  <span>Ver Todo ({docsFicha.albaranes.length + docsFicha.facturas.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubTabFicha('pendientes')}
                  className={`flex items-center gap-1.5 pb-2 px-2.5 sm:px-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    subTabFicha === 'pendientes'
                      ? 'border-amber-700 text-amber-900'
                      : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <span>Pendientes</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    docsFicha.pendientes.length > 0 ? 'bg-amber-600 text-white' : 'bg-stone-100 text-stone-600'
                  }`}>
                    {docsFicha.pendientes.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubTabFicha('albaranes')}
                  className={`flex items-center gap-1.5 pb-2 px-2.5 sm:px-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    subTabFicha === 'albaranes'
                      ? 'border-amber-700 text-amber-900'
                      : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-amber-700" />
                  <span>Albaranes</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-stone-100 text-stone-600">
                    {docsFicha.albaranes.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubTabFicha('facturas')}
                  className={`flex items-center gap-1.5 pb-2 px-2.5 sm:px-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    subTabFicha === 'facturas'
                      ? 'border-amber-700 text-amber-900'
                      : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <Receipt className="w-3.5 h-3.5 text-amber-700" />
                  <span>Facturas</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-stone-100 text-stone-600">
                    {docsFicha.facturas.length}
                  </span>
                </button>
              </div>

              {/* 4. Cuerpo de la Ficha (Expande libremente para scroll nativo suave) */}
              <div className="p-3.5 sm:p-6 space-y-4 bg-stone-50/50">
                {renderBloqueDocumentos(docsFicha, clienteSeleccionadoFicha.nombre, subTabFicha, false)}
              </div>

              {/* 5. Pie con botón grande de cierre accesible */}
              <div className="p-4 bg-white border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3 mt-auto">
                <span className="text-xs text-stone-500 text-center sm:text-left">
                  {clienteSeleccionadoFicha.nombre} · {clienteSeleccionadoFicha.cifNif}
                </span>

                <button
                  type="button"
                  onClick={() => setClienteSeleccionadoFicha(null)}
                  className="w-full sm:w-auto px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-xs"
                >
                  Cerrar Ficha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL / VISOR OFICIAL DE DOCUMENTO PARA IMPRESIÓN         */}
      {/* (100% Scroll Nativo en Móvil)                             */}
      {/* ========================================================= */}
      {documentoImprimir && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/80 backdrop-blur-xs overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="min-h-full w-full flex flex-col justify-start items-center p-2 sm:p-4 md:p-6 pb-20">
            <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col my-auto border border-stone-200 overflow-hidden animate-in fade-in">
              
              {/* Header del visor */}
              <div className="p-4 border-b border-stone-200 flex justify-between items-center bg-stone-50 shrink-0">
                <div className="flex items-center gap-2">
                  <Printer className="w-5 h-5 text-amber-700" />
                  <h3 className="font-bold text-stone-900 text-sm sm:text-base">
                    {documentoImprimir.tipo === 'albaran' ? 'Albarán Oficial de Entrega' : 'Factura Oficial de Venta'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setDocumentoImprimir(null)}
                  className="text-stone-400 hover:text-stone-700 p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Hoja de impresión */}
              <div className="p-4 sm:p-6 bg-stone-100">
                <div
                  id="hoja-documento-impresion"
                  className="p-5 sm:p-8 border border-stone-300 rounded-xl bg-white text-stone-900 font-sans space-y-5 print:border-none print:p-0 print:m-0 print:w-full max-w-2xl mx-auto shadow-sm"
                >
                  {/* Encabezado oficial */}
                  <div className="flex justify-between items-start border-b-2 border-stone-900 pb-4">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-black text-stone-950 tracking-tight">
                        {config?.nombreEmpresa || 'Granja Avícola'}
                      </h2>
                      <p className="text-xs text-stone-600 mt-1">
                        CIF / NIF: <strong className="font-mono">{config?.cifEmpresa || 'B-00000000'}</strong>
                      </p>
                      <p className="text-xs text-stone-600">{config?.direccionEmpresa}</p>
                      <p className="text-xs text-stone-600">
                        RGSEAA / Núm. Sanitario: <strong className="font-mono text-stone-900">{config?.registroSanitario || 'ES 10.04523/TO CE'}</strong>
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] sm:text-xs uppercase font-black bg-stone-900 text-white px-2.5 py-1 rounded inline-block tracking-wider">
                        {documentoImprimir.tipo === 'albaran' ? 'ALBARÁN DE ENTREGA' : 'FACTURA COMERCIAL'}
                      </span>
                      <span className="text-sm sm:text-base font-mono font-bold text-stone-900 block mt-2">
                        {'numeroAlbaran' in documentoImprimir.doc ? documentoImprimir.doc.numeroAlbaran : documentoImprimir.doc.numeroFactura}
                      </span>
                      <span className="text-xs text-stone-600 block mt-0.5">
                        Fecha: <strong>{formatearFechaES(documentoImprimir.doc.fecha)}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Datos del Cliente */}
                  <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs space-y-1">
                    <div className="font-bold text-stone-500 uppercase text-[10px]">Cliente / Destinatario:</div>
                    <div className="font-bold text-sm text-stone-900">{documentoImprimir.doc.clienteNombre}</div>
                    <div>CIF / NIF: <strong className="font-mono">{documentoImprimir.doc.clienteCif}</strong></div>
                    {documentoImprimir.doc.clienteDireccion && <div>Dirección: {documentoImprimir.doc.clienteDireccion}</div>}
                  </div>

                  {/* Tabla de Productos con desglose de lotes */}
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-stone-800 text-stone-600 uppercase text-[10px]">
                        <th className="text-left py-1.5">Descripción & Lote Puesta</th>
                        <th className="text-center py-1.5">D.C.P.</th>
                        <th className="text-right py-1.5">Cantidad</th>
                        <th className="text-right py-1.5">Precio</th>
                        <th className="text-right py-1.5">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {desglosarLineasPorLote(documentoImprimir.doc.lineas).map((l, i) => (
                        <tr key={i} className="py-2">
                          <td className="py-1.5">
                            <strong className="block text-stone-900">{l.nombreFormato}</strong>
                            <span className="text-[10px] font-mono text-stone-600">Lote: {l.codigoLotePuesta}</span>
                          </td>
                          <td className="text-center py-1.5 font-mono text-[11px] text-stone-700">
                            {formatearFechaES(l.fechaConsumoPreferente)}
                          </td>
                          <td className="text-right py-1.5 font-medium">{l.cantidadEstuches} est.</td>
                          <td className="text-right py-1.5 font-mono">{l.precioUnitario?.toFixed(2)} €</td>
                          <td className="text-right py-1.5 font-mono font-bold text-stone-900">{l.subtotal?.toFixed(2)} €</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totales */}
                  <div className="flex justify-end pt-3 border-t-2 border-stone-800">
                    <div className="w-56 text-xs space-y-1">
                      <div className="flex justify-between text-stone-600">
                        <span>Base Imponible:</span>
                        <span className="font-mono">{documentoImprimir.doc.totales?.baseImponible?.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between text-stone-600">
                        <span>IVA (4% Superreducido):</span>
                        <span className="font-mono">{documentoImprimir.doc.totales?.cuotaIva?.toFixed(2)} €</span>
                      </div>
                      {documentoImprimir.doc.totales?.aplicaRecargo && (
                        <div className="flex justify-between text-stone-600">
                          <span>Recargo Equiv. (0,5%):</span>
                          <span className="font-mono">{documentoImprimir.doc.totales?.cuotaRecargo?.toFixed(2)} €</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-black text-stone-950 pt-2 border-t border-stone-300">
                        <span>Total:</span>
                        <span className="font-mono">{documentoImprimir.doc.totales?.totalDocumento?.toFixed(2)} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer del visor */}
              <div className="p-3 sm:p-4 bg-white border-t border-stone-200 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setDocumentoImprimir(null)}
                  className="px-4 py-2 border border-stone-300 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-50 cursor-pointer"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir Documento</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL PARA CREAR / EDITAR CLIENTE                         */}
      {/* ========================================================= */}
      {mostrarModal && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4 animate-in fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-700" />
                <h3 className="font-bold text-base text-stone-900">
                  {clienteEditando ? 'Modificar Cliente' : 'Nuevo Cliente Comercial'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardar} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-stone-700 mb-1">
                    Nombre o Razón Social *
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={e => setNombre(e.target.value)}
                    placeholder="Supermercados La Despensa S.L."
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-bold text-stone-900 focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    CIF / NIF / NIE *
                  </label>
                  <input
                    type="text"
                    value={cifNif}
                    onChange={e => setCifNif(e.target.value.toUpperCase())}
                    placeholder="B45999888"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase font-bold focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Teléfono de Contacto
                  </label>
                  <input
                    type="tel"
                    value={telefono}
                    onChange={e => setTelefono(e.target.value)}
                    placeholder="+34 650 123 456"
                    className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-stone-700 mb-1">
                    Correo Electrónico (para facturación)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="facturacion@ladespensa.com"
                    className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-stone-700 mb-1">
                    Dirección de Entrega / Fiscal
                  </label>
                  <input
                    type="text"
                    value={direccion}
                    onChange={e => setDireccion(e.target.value)}
                    placeholder="Av. Castilla-La Mancha, 24"
                    className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Población / Localidad
                  </label>
                  <input
                    type="text"
                    value={poblacion}
                    onChange={e => setPoblacion(e.target.value)}
                    placeholder="Toledo"
                    className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Provincia
                  </label>
                  <input
                    type="text"
                    value={provincia}
                    onChange={e => setProvincia(e.target.value)}
                    placeholder="Toledo"
                    className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Código Postal
                  </label>
                  <input
                    type="text"
                    value={codigoPostal}
                    onChange={e => setCodigoPostal(e.target.value)}
                    placeholder="45001"
                    className="w-full rounded-xl border border-stone-300 p-2.5 font-mono focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Opción Tributaria: Recargo de Equivalencia */}
              <div className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl space-y-1 mt-2">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={recargoEquivalencia}
                    onChange={e => setRecargoEquivalencia(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500 mt-0.5"
                  />
                  <div>
                    <span className="font-bold text-purple-950 block text-xs">
                      Aplicar Régimen de Recargo de Equivalencia (R.E.)
                    </span>
                    <span className="text-[11px] text-purple-800 leading-tight block mt-0.5">
                      Para autónomos del comercio minorista: se aplicará <strong>4% de IVA</strong> + <strong>0,5% de Recargo de Equivalencia</strong>.
                    </span>
                  </div>
                </label>
              </div>

              {errorFormulario && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{errorFormulario}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModal(false)}
                  className="px-4 py-2 border border-stone-300 rounded-xl text-stone-600 hover:bg-stone-50 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-xl font-bold shadow-xs transition-colors cursor-pointer"
                >
                  {clienteEditando ? 'Guardar Cambios' : 'Registrar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Aviso Informativo (sustituto seguro de alert) */}
      {mensajeAviso && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
              </div>
              <h3 className="font-bold text-base text-stone-900">Aviso</h3>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">{mensajeAviso}</p>
            <div className="flex justify-end pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setMensajeAviso(null)}
                className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Eliminación (sustituto seguro de confirm) */}
      {clienteParaEliminar && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-800 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">¿Eliminar Cliente?</h3>
                <p className="text-xs text-stone-500">{clienteParaEliminar.nombre}</p>
              </div>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              ¿Estás seguro de que deseas eliminar este cliente de la cartera comercial? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setClienteParaEliminar(null)}
                className="px-4 py-2 border border-stone-300 rounded-xl text-xs font-semibold text-stone-600 hover:bg-stone-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={ejecutarEliminacionCliente}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
              >
                Eliminar Definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
