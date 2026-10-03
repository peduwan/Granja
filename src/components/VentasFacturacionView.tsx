import React, { useState, useEffect } from 'react';
import {
  Receipt,
  FileText,
  Plus,
  CheckCircle2,
  Printer,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Eye,
  Trash2,
  Calendar,
  UserCheck,
  DollarSign,
  Clock,
  ChevronRight,
  ChevronDown,
  Filter,
  X,
  CreditCard,
  Building2,
  ShoppingBag,
  Mic,
  Sparkles,
  FileCode,
  QrCode,
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import {
  Albaran,
  Factura,
  Cliente,
  LoteEnvasado,
  FormatoEnvase,
  LineaDocumentoVenta,
  FormaPago,
  ConfiguracionEmpresa,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration,
  FiscalSubmission
} from '../types';
import { calcularTotales, padNumero, formatearFechaES, getDefaultFiscalConfig } from '../utils/storage';
import { AsistenteVozVenta, DatosVentaInterpretados } from './AsistenteVozVenta';
import { ModalFacturaRectificativa } from './ModalFacturaRectificativa';
import { ModalAuditoriaVeriFactu } from './ModalAuditoriaVeriFactu';
import {
  descargarXmlVeriFactu,
  descargarLibroVeriFactuXml
} from '../utils/verifactu';
import { emitFiscalInvoiceViaBackend } from '../fiscal/fiscalApiClient';
import { auth } from '../utils/firebase';

interface VentasFacturacionViewProps {
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
  vistaInicial?: 'albaranes' | 'facturas' | 'agrupar_albaranes';
  onAddAlbaran: (albaran: Albaran, consumoEstuches: Record<string, number>) => void;
  onAddFacturaDirecta: (factura: Factura, consumoEstuches: Record<string, number>, fiscalRecordRef: FiscalRecordRef) => void;
  onFacturarAlbaranes: (factura: Factura, albaranesIds: string[], fiscalRecordRef: FiscalRecordRef) => void;
  onAddFacturaRectificativa: (rectificativa: Factura, reingresarStock: boolean, fiscalRecordRef: FiscalRecordRef) => Promise<void> | void;
  onDeleteAlbaran: (id: string) => void;
  onDeleteFactura: (id: string) => void;
}

export const VentasFacturacionView: React.FC<VentasFacturacionViewProps> = ({
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
  vistaInicial,
  onAddAlbaran,
  onAddFacturaDirecta,
  onFacturarAlbaranes,
  onAddFacturaRectificativa,
  onDeleteAlbaran,
  onDeleteFactura
}) => {
  const hoy = new Date().toISOString().split('T')[0];
  const anioActual = new Date().getFullYear();

  // Subpestañas superiores (ALBARANES | FACTURAS | AGRUPAR)
  const [subTab, setSubTab] = useState<'albaranes' | 'facturas' | 'agrupar_albaranes'>(vistaInicial || 'albaranes');

  useEffect(() => {
    if (vistaInicial) {
      setSubTab(vistaInicial);
    }
  }, [vistaInicial]);

  // Modal para creación con botón '+'
  const [mostrarModalNuevoDoc, setMostrarModalNuevoDoc] = useState(false);
  const [tipoNuevoDoc, setTipoNuevoDoc] = useState<'albaran' | 'factura_directa'>('albaran');

  // Modal para Factura Rectificativa / Anulación
  const [facturaARectificar, setFacturaARectificar] = useState<Factura | null>(null);

  // Modal para Auditoría Veri*Factu
  const [mostrarModalAuditoria, setMostrarModalAuditoria] = useState(false);
  const [copiadoHash, setCopiadoHash] = useState<string | null>(null);

  // Control de elementos expandidos
  const [docsExpandidos, setDocsExpandidos] = useState<Record<string, boolean>>({});

  // Filtros
  const [filtroCliente, setFiltroCliente] = useState<string>('todos');
  const [filtroEstadoAlbaran, setFiltroEstadoAlbaran] = useState<'todos' | 'pendiente' | 'facturado'>('todos');

  // Modal para imprimir Albarán o Factura
  const [documentoImprimir, setDocumentoImprimir] = useState<{ tipo: 'albaran' | 'factura'; doc: Albaran | Factura } | null>(null);

  // Estado para seguimiento de remisiones AEAT Veri*Factu (Fase 3.1)
  const [submissionsByFactura, setSubmissionsByFactura] = useState<Record<string, FiscalSubmission>>({});
  const [enviandoAeat, setEnviandoAeat] = useState<Record<string, boolean>>({});

  const handleEnviarAeat = async (factura: Factura) => {
    if (!factura.fiscalRecordId) {
      alert("Esta factura no dispone de registro fiscal sellado.");
      return;
    }
    setEnviandoAeat(prev => ({ ...prev, [factura.id]: true }));
    try {
      const activeFiscalConfig = fiscalConfig || getDefaultFiscalConfig();
      let authHeaders: Record<string, string> = {};
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          authHeaders['Authorization'] = `Bearer ${token}`;
        }
      } catch {}

      const res = await fetch('/api/fiscal/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          fiscalRecordId: factura.fiscalRecordId,
          config: activeFiscalConfig
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.message || `Error en remisión AEAT de backend (HTTP ${res.status})`);
      }

      const result = await res.json();
      setSubmissionsByFactura(prev => ({
        ...prev,
        [factura.id]: result.submission
      }));
    } catch (err: any) {
      console.error("Error al remitir factura a AEAT:", err);
      alert(`Error en el transporte AEAT: ${err.message}`);
    } finally {
      setEnviandoAeat(prev => ({ ...prev, [factura.id]: false }));
    }
  };

  useEffect(() => {
    if (documentoImprimir) {
      document.body.classList.add('has-print-modal');
    } else {
      document.body.classList.remove('has-print-modal');
    }
    return () => {
      document.body.classList.remove('has-print-modal');
    };
  }, [documentoImprimir]);

  const toggleExpandir = (id: string) => {
    setDocsExpandidos(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Form state para Nuevo Documento
  const numeroAlbaranSugerido = `ALB-${anioActual}-${padNumero(contadorAlbaran)}`;
  const numeroFacturaSugerida = `FAC-${anioActual}-${padNumero(contadorFactura)}`;

  const [clienteId, setClienteId] = useState(clientes[0]?.id || '');
  const [fechaDocumento, setFechaDocumento] = useState(hoy);
  const [notas, setNotas] = useState('');
  const [formaPago, setFormaPago] = useState<FormaPago>('transferencia');

  // Líneas de producto
  const lotesConStock = lotesEnvasados.filter(l => l.estuchesDisponibles > 0);
  const primerLote = lotesConStock[0];
  const primerFormato = primerLote ? formatos.find(f => f.id === primerLote.formatoId) : null;

  const [lineasVenta, setLineasVenta] = useState<Array<{
    loteEnvasadoId: string;
    cantidadEstuches: number;
    precioUnitario: number;
  }>>([
    {
      loteEnvasadoId: primerLote?.id || '',
      cantidadEstuches: 10,
      precioUnitario: primerFormato?.precioVenta || 2.50
    }
  ]);

  // Selección de albaranes para agrupar en factura
  const [clienteParaFacturar, setClienteParaFacturar] = useState<string>('');
  const [albaranesSeleccionadosIds, setAlbaranesSeleccionadosIds] = useState<string[]>([]);

  const clienteSeleccionado = clientes.find(c => c.id === clienteId);
  const aplicaRecargo = !!clienteSeleccionado?.recargoEquivalencia;

  const addLinea = () => {
    if (primerLote) {
      setLineasVenta([
        ...lineasVenta,
        {
          loteEnvasadoId: primerLote.id,
          cantidadEstuches: 5,
          precioUnitario: primerFormato?.precioVenta || 2.50
        }
      ]);
    }
  };

  const removeLinea = (idx: number) => {
    if (lineasVenta.length <= 1) return;
    setLineasVenta(lineasVenta.filter((_, i) => i !== idx));
  };

  const updateLinea = (idx: number, field: 'loteEnvasadoId' | 'cantidadEstuches' | 'precioUnitario', val: any) => {
    const updated = [...lineasVenta];
    if (field === 'loteEnvasadoId') {
      const lote = lotesEnvasados.find(le => le.id === val);
      const fmt = lote ? formatos.find(f => f.id === lote.formatoId) : null;
      updated[idx] = {
        ...updated[idx],
        loteEnvasadoId: val,
        precioUnitario: fmt?.precioVenta || 2.50
      };
    } else {
      updated[idx] = { ...updated[idx], [field]: val };
    }
    setLineasVenta(updated);
  };

  // Función para volcar los datos interpretados por voz en el formulario de emisión
  const aplicarDatosVoz = (datos: DatosVentaInterpretados) => {
    if (datos.tipoDocumento) {
      setTipoNuevoDoc(datos.tipoDocumento);
    }
    if (datos.clienteId) {
      setClienteId(datos.clienteId);
    }
    if (datos.formaPago) {
      setFormaPago(datos.formaPago);
    }
    if (datos.notas) {
      setNotas(datos.notas);
    }
    if (datos.lineas && datos.lineas.length > 0) {
      setLineasVenta(
        datos.lineas.map(l => ({
          loteEnvasadoId: l.loteEnvasadoId,
          cantidadEstuches: l.cantidadEstuches,
          precioUnitario: l.precioUnitario
        }))
      );
    }
  };

  // Obtener el código de puesta de un lote envasado
  const getCodigoPuestaDeLote = (lote?: LoteEnvasado | null): string => {
    if (!lote) return 'S/C';
    if (lote.componentesLotes && lote.componentesLotes.length > 0) {
      const codigos = Array.from(
        new Set(lote.componentesLotes.map(c => c.codigoLotePuesta).filter(Boolean))
      );
      if (codigos.length > 0) {
        return codigos.join(', ');
      }
    }
    return lote.codigoLoteEnvasado || 'S/C';
  };

  // Obtener el código de puesta de una línea para albaranes y facturas (impresión y trazabilidad)
  const getCodigoPuestaLinea = (linea: LineaDocumentoVenta): string => {
    if (linea.codigoLotePuesta && linea.codigoLotePuesta.trim().length > 0) {
      return linea.codigoLotePuesta;
    }

    if (linea.trazabilidadPuesta && linea.trazabilidadPuesta.length > 0) {
      const codigos = Array.from(
        new Set(linea.trazabilidadPuesta.map(tp => tp.codigoLotePuesta).filter(Boolean))
      );
      if (codigos.length > 0) {
        return codigos.join(', ');
      }
    }

    const lote = lotesEnvasados.find(
      le => le.id === linea.loteEnvasadoId || le.codigoLoteEnvasado === linea.codigoLoteEnvasado
    );
    return getCodigoPuestaDeLote(lote);
  };

  // Desglosar líneas para garantizar siempre UNA LÍNEA POR LOTE con su cantidad y precio
  const desglosarLineasPorLote = (lineas: LineaDocumentoVenta[]): LineaDocumentoVenta[] => {
    const resultado: LineaDocumentoVenta[] = [];

    lineas.forEach((l, lIdx) => {
      // Caso 1: Tiene trazabilidad detallada con más de un lote de puesta
      if (l.trazabilidadPuesta && l.trazabilidadPuesta.length > 1) {
        const totalHuevos = l.trazabilidadPuesta.reduce((acc, t) => acc + (t.totalHuevosEntregados || 0), 0);
        let estuchesAcumulados = 0;

        l.trazabilidadPuesta.forEach((t, subIdx) => {
          const esUltimo = subIdx === l.trazabilidadPuesta.length - 1;
          const ratio = totalHuevos > 0 ? (t.totalHuevosEntregados / totalHuevos) : (1 / l.trazabilidadPuesta.length);
          const cantEst = esUltimo
            ? Math.max(1, l.cantidadEstuches - estuchesAcumulados)
            : Math.max(1, Math.round(l.cantidadEstuches * ratio));
          estuchesAcumulados += cantEst;
          const subtotal = Number((cantEst * l.precioUnitario).toFixed(2));

          resultado.push({
            ...l,
            id: `${l.id}-lp-${subIdx}`,
            codigoLotePuesta: t.codigoLotePuesta,
            cantidadEstuches: cantEst,
            precioUnitario: l.precioUnitario,
            subtotal,
            trazabilidadPuesta: [t]
          });
        });
      }
      // Caso 2: Tiene varios códigos de lote de puesta separados por coma
      else if (l.codigoLotePuesta && l.codigoLotePuesta.includes(',')) {
        const codigos = l.codigoLotePuesta.split(',').map(s => s.trim()).filter(Boolean);
        const partes = codigos.length;
        let estuchesAcumulados = 0;

        codigos.forEach((cod, subIdx) => {
          const esUltimo = subIdx === partes - 1;
          const cantEst = esUltimo
            ? Math.max(1, l.cantidadEstuches - estuchesAcumulados)
            : Math.max(1, Math.floor(l.cantidadEstuches / partes));
          estuchesAcumulados += cantEst;
          const subtotal = Number((cantEst * l.precioUnitario).toFixed(2));

          resultado.push({
            ...l,
            id: `${l.id}-cod-${subIdx}`,
            codigoLotePuesta: cod,
            cantidadEstuches: cantEst,
            precioUnitario: l.precioUnitario,
            subtotal
          });
        });
      }
      // Caso 3: Es un solo lote de puesta
      else {
        resultado.push({
          ...l,
          id: l.id || `lin-${lIdx}`,
          codigoLotePuesta: getCodigoPuestaLinea(l)
        });
      }
    });

    return resultado;
  };

  // Construcción de líneas asegurando una línea por lote con su cantidad y precio
  const lineasConstruidas: LineaDocumentoVenta[] = [];
  lineasVenta.forEach((l, index) => {
    const lote = lotesEnvasados.find(le => le.id === l.loteEnvasadoId);
    const formato = lote ? formatos.find(f => f.id === lote.formatoId) : null;
    const precio = typeof l.precioUnitario === 'number' && !isNaN(l.precioUnitario) ? l.precioUnitario : (formato?.precioVenta || 2.50);

    // Si el lote contiene más de un lote de puesta, creamos una línea por cada lote de puesta
    if (lote && lote.componentesLotes && lote.componentesLotes.length > 1) {
      const totalHuevos = lote.componentesLotes.reduce((acc, c) => acc + (c.huevosPorEstuche || 0), 0);
      let estuchesAcumulados = 0;

      lote.componentesLotes.forEach((c, cIdx) => {
        const esUltimo = cIdx === lote.componentesLotes.length - 1;
        const ratio = totalHuevos > 0 ? (c.huevosPorEstuche / totalHuevos) : (1 / lote.componentesLotes.length);
        const cantEst = esUltimo
          ? Math.max(1, (l.cantidadEstuches || 0) - estuchesAcumulados)
          : Math.max(1, Math.round((l.cantidadEstuches || 0) * ratio));
        estuchesAcumulados += cantEst;
        const sub = Number((cantEst * precio).toFixed(2));

        lineasConstruidas.push({
          id: `lin-${index}-${cIdx}`,
          loteEnvasadoId: l.loteEnvasadoId,
          codigoLoteEnvasado: lote.codigoLoteEnvasado,
          codigoLotePuesta: c.codigoLotePuesta,
          formatoId: formato?.id || '',
          nombreFormato: formato?.nombre || 'Estuche Huevos',
          cantidadEstuches: cantEst,
          precioUnitario: precio,
          subtotal: sub,
          fechaConsumoPreferente: c.fechaCaducidad || lote.fechaConsumoPreferente,
          trazabilidadPuesta: [
            {
              codigoLotePuesta: c.codigoLotePuesta,
              huevosPorEstuche: c.huevosPorEstuche,
              totalHuevosEntregados: c.huevosPorEstuche * cantEst
            }
          ]
        });
      });
    } else {
      const codPuesta = lote?.componentesLotes?.[0]?.codigoLotePuesta || lote?.codigoLoteEnvasado || 'S/C';
      const cantEst = l.cantidadEstuches || 0;
      const sub = Number((cantEst * precio).toFixed(2));

      lineasConstruidas.push({
        id: `lin-${index}`,
        loteEnvasadoId: l.loteEnvasadoId,
        codigoLoteEnvasado: lote?.codigoLoteEnvasado || '',
        codigoLotePuesta: codPuesta,
        formatoId: formato?.id || '',
        nombreFormato: formato?.nombre || 'Estuche Huevos',
        cantidadEstuches: cantEst,
        precioUnitario: precio,
        subtotal: sub,
        fechaConsumoPreferente: lote?.fechaConsumoPreferente || '',
        trazabilidadPuesta: lote?.componentesLotes?.map(c => ({
          codigoLotePuesta: c.codigoLotePuesta,
          huevosPorEstuche: c.huevosPorEstuche,
          totalHuevosEntregados: c.huevosPorEstuche * cantEst
        })) || []
      });
    }
  });

  const totalesCalculados = calcularTotales(lineasConstruidas, aplicaRecargo);

  const stockVentaSuficiente = lineasVenta.every(l => {
    const lote = lotesEnvasados.find(le => le.id === l.loteEnvasadoId);
    return lote && lote.estuchesDisponibles >= (l.cantidadEstuches || 0);
  });

  const handleSubmitNuevoDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteSeleccionado) {
      alert('Selecciona un cliente.');
      return;
    }
    if (!stockVentaSuficiente) {
      alert('No hay suficiente stock de estuches en los lotes seleccionados.');
      return;
    }

    const consumoEstuches: Record<string, number> = {};
    lineasConstruidas.forEach(l => {
      consumoEstuches[l.loteEnvasadoId] = (consumoEstuches[l.loteEnvasadoId] || 0) + l.cantidadEstuches;
    });

    if (tipoNuevoDoc === 'albaran') {
      const nuevoAlbaran: Albaran = {
        id: 'alb-' + Date.now(),
        numeroAlbaran: numeroAlbaranSugerido,
        fecha: fechaDocumento,
        clienteId: clienteSeleccionado.id,
        clienteNombre: clienteSeleccionado.nombre,
        clienteCif: clienteSeleccionado.cifNif,
        clienteDireccion: `${clienteSeleccionado.direccion}, ${clienteSeleccionado.codigoPostal} ${clienteSeleccionado.poblacion} (${clienteSeleccionado.provincia})`,
        clienteRecargoEquivalencia: clienteSeleccionado.recargoEquivalencia,
        lineas: lineasConstruidas,
        totales: totalesCalculados,
        estado: 'pendiente_facturar',
        notas: notas.trim() || undefined,
        creadoEn: new Date().toISOString()
      };

      onAddAlbaran(nuevoAlbaran, consumoEstuches);
      setMostrarModalNuevoDoc(false);
      setDocumentoImprimir({ tipo: 'albaran', doc: nuevoAlbaran });
      setSubTab('albaranes');
    } else {
      // FASE 1.3: Emisión fiscal centralizada. El registro anterior se resuelve unívocamente dentro de la sección serializada.
      const effectiveFiscalConfig: FiscalConfiguration = fiscalConfig || getDefaultFiscalConfig(config.cifEmpresa, config.nombreEmpresa);

      const invoiceDraft: Factura = {
        id: 'fac-' + Date.now(),
        numeroFactura: numeroFacturaSugerida,
        fecha: fechaDocumento,
        clienteId: clienteSeleccionado.id,
        clienteNombre: clienteSeleccionado.nombre,
        clienteCif: clienteSeleccionado.cifNif,
        clienteDireccion: `${clienteSeleccionado.direccion}, ${clienteSeleccionado.codigoPostal} ${clienteSeleccionado.poblacion} (${clienteSeleccionado.provincia})`,
        clienteRecargoEquivalencia: clienteSeleccionado.recargoEquivalencia,
        albaranesAsociados: [],
        lineas: lineasConstruidas,
        totales: totalesCalculados,
        estadoPago: 'pendiente',
        formaPago,
        esVentaDirecta: true,
        notas: notas.trim() || undefined,
        creadoEn: new Date().toISOString(),
        tipoFactura: 'F1',
        esRectificativa: false
      };

      const { invoice: nuevaFactura, fiscalRecordRef } = await emitFiscalInvoiceViaBackend({
        invoiceDraft,
        fiscalConfig: effectiveFiscalConfig
      });

      onAddFacturaDirecta(nuevaFactura, consumoEstuches, fiscalRecordRef);
      setMostrarModalNuevoDoc(false);
      setDocumentoImprimir({ tipo: 'factura', doc: nuevaFactura });
      setSubTab('facturas');
    }
  };

  const handleCrearFacturaDesdeAlbaranes = async () => {
    if (albaranesSeleccionadosIds.length === 0) {
      alert('Selecciona al menos un albarán para facturar.');
      return;
    }

    const seleccionados = albaranes.filter(a => albaranesSeleccionadosIds.includes(a.id));
    const primerAlbaran = seleccionados[0];
    const todosMismoCliente = seleccionados.every(a => a.clienteId === primerAlbaran.clienteId);

    if (!todosMismoCliente) {
      alert('Todos los albaranes agrupados en una factura deben pertenecer al mismo cliente.');
      return;
    }

    const lineasUnificadas: LineaDocumentoVenta[] = [];
    seleccionados.forEach(alb => {
      alb.lineas.forEach(l => {
        lineasUnificadas.push({
          ...l,
          id: 'lin-' + Date.now() + '-' + Math.random()
        });
      });
    });

    const totales = calcularTotales(lineasUnificadas, primerAlbaran.clienteRecargoEquivalencia);
    const numeroFacturaAgrupada = `FAC-${anioActual}-${padNumero(contadorFactura)}`;

    // FASE 1.3: Emisión fiscal centralizada. Resolución serializada sin depender de fiscalRecordRefs[0].
    const effectiveFiscalConfig: FiscalConfiguration = fiscalConfig || getDefaultFiscalConfig(config.cifEmpresa, config.nombreEmpresa);

    const invoiceDraft: Factura = {
      id: 'fac-' + Date.now(),
      numeroFactura: numeroFacturaAgrupada,
      fecha: hoy,
      clienteId: primerAlbaran.clienteId,
      clienteNombre: primerAlbaran.clienteNombre,
      clienteCif: primerAlbaran.clienteCif,
      clienteDireccion: primerAlbaran.clienteDireccion,
      clienteRecargoEquivalencia: primerAlbaran.clienteRecargoEquivalencia,
      albaranesAsociados: seleccionados.map(a => ({
        id: a.id,
        numeroAlbaran: a.numeroAlbaran,
        fecha: a.fecha
      })),
      lineas: lineasUnificadas,
      totales,
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: false,
      notas: `Factura recapitulativa correspondiente a los albaranes: ${seleccionados.map(a => a.numeroAlbaran).join(', ')}.`,
      creadoEn: new Date().toISOString(),
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const { invoice: nuevaFactura, fiscalRecordRef } = await emitFiscalInvoiceViaBackend({
      invoiceDraft,
      fiscalConfig: effectiveFiscalConfig
    });

    onFacturarAlbaranes(nuevaFactura, albaranesSeleccionadosIds, fiscalRecordRef);
    setAlbaranesSeleccionadosIds([]);
    setSubTab('facturas');
    setDocumentoImprimir({ tipo: 'factura', doc: nuevaFactura });
  };

  // Filtrados
  const albaranesFiltrados = albaranes.filter(a => {
    if (filtroCliente !== 'todos' && a.clienteId !== filtroCliente) return false;
    if (filtroEstadoAlbaran === 'pendiente' && a.estado !== 'pendiente_facturar') return false;
    if (filtroEstadoAlbaran === 'facturado' && a.estado !== 'facturado') return false;
    return true;
  });

  const facturasFiltradas = facturas.filter(f => {
    if (filtroCliente !== 'todos' && f.clienteId !== filtroCliente) return false;
    return true;
  });

  const totalFacturado = facturas.reduce((acc, f) => acc + f.totales.totalDocumento, 0);
  const albaranesPendientes = albaranes.filter(a => a.estado === 'pendiente_facturar');
  const albaranesPendientesImporte = albaranesPendientes.reduce((acc, a) => acc + a.totales.totalDocumento, 0);

  return (
    <>
      <div className={`space-y-4 max-w-4xl mx-auto pb-20 ${documentoImprimir ? 'print:hidden' : ''}`}>
        {/* 1. HERO CARD SUPERIOR ESTILO LIMPIO */}
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Ventas, Albaranes y Facturación
            </h2>
            <p className="text-amber-100 text-xs sm:text-sm font-medium flex items-center gap-2">
              <span>{clientes.length} Clientes Comerciales</span>
              <span>•</span>
              <span>{albaranesPendientes.length} Albaranes por Facturar</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTipoNuevoDoc(subTab === 'facturas' ? 'factura_directa' : 'albaran');
                setMostrarModalNuevoDoc(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-700/70 hover:bg-amber-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all cursor-pointer border border-amber-400/40 hover:scale-[1.02]"
              title="Abrir formulario y dictar albarán o factura por voz con IA"
            >
              <Mic className="w-4 h-4 text-amber-200" />
              <span>Dictar por Voz</span>
            </button>

            <button
              type="button"
              onClick={() => setMostrarModalNuevoDoc(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-white text-amber-800 hover:bg-amber-50 font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
            >
              <Plus className="w-4 h-4 text-amber-600" />
              <span>Nueva Venta</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-amber-400/40 text-xs text-white">
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Facturación Total</span>
            <strong className="text-sm sm:text-base font-bold">{totalFacturado.toFixed(2)} €</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Pendiente Facturar</span>
            <strong className="text-sm sm:text-base font-bold text-amber-100">{albaranesPendientesImporte.toFixed(2)} €</strong>
          </div>
          <div>
            <span className="text-[10px] text-amber-200 block uppercase font-semibold">Albaranes Emitidos</span>
            <strong className="text-sm sm:text-base font-bold">{albaranes.length} albaranes</strong>
          </div>
        </div>
      </div>

      {/* 2. SUB-PESTAÑAS */}
      <div className="flex border-b border-stone-200 justify-around text-xs sm:text-sm font-bold tracking-wider text-stone-500">
        <button
          type="button"
          onClick={() => setSubTab('albaranes')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'albaranes' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Albaranes ({albaranes.length})</span>
          {subTab === 'albaranes' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('facturas')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'facturas' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Facturas ({facturas.length})</span>
          {subTab === 'facturas' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('agrupar_albaranes')}
          className={`pb-3 px-3 transition-colors uppercase cursor-pointer relative ${
            subTab === 'agrupar_albaranes' ? 'text-amber-600' : 'hover:text-stone-800'
          }`}
        >
          <span>Facturar Albaranes ({albaranesPendientes.length})</span>
          {subTab === 'agrupar_albaranes' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>
      </div>

      {/* 3. CONTENIDO SEGÚN SUB-PESTAÑA */}

      {/* === SUBTAB: ALBARANES === */}
      {subTab === 'albaranes' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
              <Receipt className="w-3.5 h-3.5 text-amber-600" />
              <span>Albaranes ({albaranesFiltrados.length})</span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filtroCliente}
                onChange={e => setFiltroCliente(e.target.value)}
                className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="todos">Todos los Clientes</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>

              <select
                value={filtroEstadoAlbaran}
                onChange={e => setFiltroEstadoAlbaran(e.target.value as any)}
                className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="todos">Todos los Estados</option>
                <option value="pendiente">Pendientes de Facturar</option>
                <option value="facturado">Facturados</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setTipoNuevoDoc('albaran');
                  setMostrarModalNuevoDoc(true);
                }}
                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg px-2.5 py-1.5 font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                title="Dictar nuevo albarán por voz con IA"
              >
                <Mic className="w-3.5 h-3.5 text-amber-700" />
                <span>Dictar Albarán</span>
              </button>
            </div>
          </div>

          {albaranesFiltrados.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
                <Receipt className="w-6 h-6" />
              </div>
              <h3 className="text-stone-800 font-bold text-sm">No hay albaranes registrados</h3>
              <p className="text-stone-500 text-xs max-w-sm mx-auto">
                No se encontraron albaranes con los filtros actuales. Pulsa <strong className="text-amber-700 font-semibold">+</strong> para registrar una entrega.
              </p>
              <button
                type="button"
                onClick={() => {
                  setTipoNuevoDoc('albaran');
                  setMostrarModalNuevoDoc(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Primer Albarán</span>
              </button>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
              {albaranesFiltrados.map(alb => {
                const estaExpandido = Boolean(docsExpandidos[alb.id]);
                const totalEstuches = alb.lineas.reduce((acc, l) => acc + l.cantidadEstuches, 0);

                return (
                  <div key={alb.id} className="transition-colors hover:bg-amber-50/30">
                    <div
                      onClick={() => toggleExpandir(alb.id)}
                      className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-amber-100/90 border border-amber-200 text-amber-800 flex items-center justify-center shrink-0 shadow-xs">
                          <Receipt className="w-5 h-5 text-amber-700" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-stone-900 text-sm tracking-tight font-mono">
                              {alb.numeroAlbaran}
                            </span>
                            <span className="text-xs font-semibold text-stone-700 truncate max-w-[180px]">
                              {alb.clienteNombre}
                            </span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                              alb.estado === 'pendiente_facturar'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {alb.estado === 'pendiente_facturar' ? 'Pendiente' : 'Facturado'}
                            </span>
                          </div>
                          <p className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                            <Calendar className="w-3 h-3 text-stone-400" />
                            <span>Fecha: {formatearFechaES(alb.fecha)}</span>
                            <span>•</span>
                            <span>{totalEstuches} estuches entregados</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-right shrink-0">
                        <div>
                          <span className="text-sm font-black text-stone-900 block">
                            {alb.totales.totalDocumento.toFixed(2)} €
                          </span>
                          <span className="text-[11px] text-stone-500 font-medium block">
                            Base: {alb.totales.baseImponible.toFixed(2)} €
                          </span>
                        </div>

                        <div className="text-stone-400 p-1">
                          {estaExpandido ? (
                            <ChevronDown className="w-4 h-4 text-amber-600" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {estaExpandido && (
                      <div className="px-4 pb-4 pt-1 bg-stone-50/70 border-t border-stone-100 space-y-3 text-xs">
                        <div className="bg-white p-3 rounded-xl border border-stone-200 space-y-1.5">
                          <span className="text-[10px] uppercase font-bold text-stone-500 block">
                            Líneas de Entrega y Trazabilidad:
                          </span>
                          <div className="space-y-1">
                            {desglosarLineasPorLote(alb.lineas).map((linea, idx) => (
                              <div key={idx} className="flex flex-wrap justify-between items-center text-xs p-2 bg-stone-50 rounded-lg gap-2">
                                <div className="space-y-0.5">
                                  <strong className="text-stone-900 block">{linea.nombreFormato}</strong>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="font-mono text-amber-900 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                      Lote Puesta: {linea.codigoLotePuesta}
                                    </span>
                                    {linea.fechaConsumoPreferente && (
                                      <span className="text-stone-500 font-mono">
                                        DCP: {formatearFechaES(linea.fechaConsumoPreferente)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right flex items-center gap-3">
                                  <div>
                                    <span className="font-bold text-stone-900 block">{linea.cantidadEstuches} est.</span>
                                    <span className="text-[11px] text-stone-500">{linea.precioUnitario.toFixed(2)} €/est.</span>
                                  </div>
                                  <span className="font-black text-amber-950 font-mono text-sm bg-white px-2 py-1 rounded border border-stone-200">
                                    {linea.subtotal.toFixed(2)} €
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDocumentoImprimir({ tipo: 'albaran', doc: alb });
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5 text-amber-700" />
                            <span>Imprimir Albarán</span>
                          </button>

                          {alb.estado === 'facturado' || Boolean(alb.facturaId) || facturas.some(f => f.albaranesAsociados?.some(a => a.id === alb.id || a.numeroAlbaran === alb.numeroAlbaran)) ? (
                            <div
                              className="inline-flex items-center gap-1.5 text-xs text-stone-500 bg-stone-100 border border-stone-200/90 px-3 py-1.5 rounded-lg select-none"
                              title="No se puede eliminar: Albarán facturado. La normativa tributaria oficial (Ley Antifraude / Veri*Factu) prohíbe eliminar o alterar operaciones facturadas."
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span>Facturado ({alb.numeroFactura || 'Factura vinculada'}) · No eliminable</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`¿Eliminar el albarán ${alb.numeroAlbaran}? Se reintegrará el stock de estuches a los lotes envasados.`)) {
                                  onDeleteAlbaran(alb.id);
                                }
                              }}
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Eliminar</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === SUBTAB: FACTURAS === */}
      {subTab === 'facturas' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100/70 border border-amber-200 text-amber-900 rounded-full text-xs font-semibold">
                <FileText className="w-3.5 h-3.5 text-amber-600" />
                <span>Facturas Emitidas ({facturasFiltradas.length})</span>
              </div>

              {/* Botón de Auditoría e Integridad Veri*Factu */}
              <button
                type="button"
                onClick={() => setMostrarModalAuditoria(true)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-full text-xs font-bold transition-all cursor-pointer shadow-2xs hover:scale-[1.02]"
                title="Comprobar la cadena de huellas criptográficas SHA-256 (Ley Antifraude)"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Auditoría Veri*Factu</span>
              </button>

              {/* Botón Exportar Libro XML AEAT */}
              <button
                type="button"
                onClick={() => descargarLibroVeriFactuXml(facturas, config as any)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 rounded-full text-xs font-bold transition-all cursor-pointer shadow-2xs"
                title="Descargar libro de registro de facturación en formato XML oficial para la AEAT"
              >
                <FileCode className="w-3.5 h-3.5 text-amber-700" />
                <span>Libro XML AEAT</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filtroCliente}
                onChange={e => setFiltroCliente(e.target.value)}
                className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="todos">Todos los Clientes</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  setTipoNuevoDoc('factura_directa');
                  setMostrarModalNuevoDoc(true);
                }}
                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg px-2.5 py-1.5 font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                title="Dictar nueva factura directa por voz con IA"
              >
                <Mic className="w-3.5 h-3.5 text-amber-700" />
                <span>Dictar Factura</span>
              </button>
            </div>
          </div>

          {facturasFiltradas.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-stone-800 font-bold text-sm">No hay facturas emitidas</h3>
              <p className="text-stone-500 text-xs max-w-sm mx-auto">
                No hay facturas emitidas con los filtros actuales. Puedes crear una Factura Directa o agrupar Albaranes pendientes.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100 shadow-xs overflow-hidden">
              {facturasFiltradas.map(fac => {
                const estaExpandido = Boolean(docsExpandidos[fac.id]);

                return (
                  <div key={fac.id} className="transition-colors hover:bg-amber-50/30">
                    <div
                      onClick={() => toggleExpandir(fac.id)}
                      className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 shadow-xs ${
                          fac.esRectificativa
                            ? 'bg-amber-700 text-white border-amber-800'
                            : 'bg-amber-100/90 border border-amber-200 text-amber-800'
                        }`}>
                          <FileText className="w-5 h-5" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-stone-900 text-sm tracking-tight font-mono">
                              {fac.numeroFactura}
                            </span>
                            <span className="text-xs font-semibold text-stone-700 truncate max-w-[180px]">
                              {fac.clienteNombre}
                            </span>

                            {fac.esRectificativa ? (
                              <span className="text-[9px] font-bold bg-amber-700 text-white px-1.5 py-0.5 rounded-full">
                                RECTIFICATIVA
                              </span>
                            ) : fac.esVentaDirecta ? (
                              <span className="text-[9px] font-bold bg-stone-100 text-stone-600 px-1.5 py-0.2 rounded-full">
                                DIRECTA
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded-full">
                                {fac.albaranesAsociados.length} ALBARANES
                              </span>
                            )}

                            {fac.estadoRectificacion === 'rectificada_total' && (
                              <span className="text-[9px] font-bold bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 rounded-full">
                                RECTIFICADA ({fac.rectificadaPorNumero})
                              </span>
                            )}

                            {fac.hashActual && (
                              <span
                                className="text-[9px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded-full hidden sm:inline-flex items-center gap-1"
                                title={`Huella Digital SHA-256 Veri*Factu: ${fac.hashActual}`}
                              >
                                <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                                <span>SHA: {fac.hashActual.slice(0, 8)}...</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-stone-500 flex items-center gap-1.5 mt-0.5">
                            <Calendar className="w-3 h-3 text-stone-400" />
                            <span>Fecha: {formatearFechaES(fac.fecha)}</span>
                            <span>•</span>
                            <span className="capitalize">{fac.formaPago}</span>
                            {fac.esRectificativa && fac.facturaRectificadaNumero && (
                              <>
                                <span>•</span>
                                <span className="text-amber-800 font-semibold font-mono">
                                  Origen: {fac.facturaRectificadaNumero}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-right shrink-0">
                        <div>
                          <span className={`text-sm font-black block ${
                            fac.totales.totalDocumento < 0 ? 'text-red-700 font-mono' : 'text-stone-900'
                          }`}>
                            {fac.totales.totalDocumento.toFixed(2)} €
                          </span>
                          <span className="text-[11px] text-stone-500 font-medium block">
                            IVA: {fac.totales.cuotaIva.toFixed(2)} €
                          </span>
                        </div>

                        <div className="text-stone-400 p-1">
                          {estaExpandido ? (
                            <ChevronDown className="w-4 h-4 text-amber-600" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {estaExpandido && (
                      <div className="px-4 pb-4 pt-1 bg-stone-50/70 border-t border-stone-100 space-y-3 text-xs">
                        {/* Ficha Veri*Factu y Huella Criptográfica */}
                        <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-emerald-900 flex items-center gap-1 tracking-wider">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Registro Inmutable Veri*Factu (Ley Antifraude RD 1007/2023)</span>
                            </span>
                            <span className="text-[10px] text-emerald-700 font-mono">
                              Tipo AEAT: {fac.tipoFactura || (fac.esRectificativa ? 'R1' : 'F1')}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                            <div className="bg-white/90 p-2 rounded border border-emerald-100 truncate">
                              <span className="text-stone-400 block text-[9px] uppercase font-sans">Hash Anterior Encadenado:</span>
                              <span className="text-stone-600 truncate block" title={fac.hashAnterior || 'Génesis'}>
                                {fac.hashAnterior || '0000000000000000000000000000000000000000 (GÉNESIS)'}
                              </span>
                            </div>
                            <div className="bg-white/90 p-2 rounded border border-emerald-100 truncate">
                              <span className="text-stone-400 block text-[9px] uppercase font-sans">Huella Digital SHA-256 Actual:</span>
                              <span className="text-emerald-800 font-bold truncate block" title={fac.hashActual || 'Generado'}>
                                {fac.hashActual || 'Sellado criptográfico activo'}
                              </span>
                            </div>
                          </div>

                          {fac.esRectificativa && (
                            <div className="bg-amber-50 p-2 rounded border border-amber-200 text-amber-900 text-xs mt-1">
                              <strong>Factura Rectificativa:</strong> Corrige la factura original <span className="font-mono font-bold">{fac.facturaRectificadaNumero}</span>.
                              {fac.motivoRectificativa && <span className="block text-[11px] text-amber-800 mt-0.5">Motivo: {fac.motivoRectificativa}</span>}
                            </div>
                          )}
                        </div>

                        {fac.lineas && fac.lineas.length > 0 && (
                          <div className="bg-white p-3 rounded-xl border border-stone-200 space-y-1.5">
                            <span className="text-[10px] uppercase font-bold text-stone-500 block">
                              Líneas Facturadas y Trazabilidad de Puesta:
                            </span>
                            <div className="space-y-1">
                              {desglosarLineasPorLote(fac.lineas).map((linea, idx) => (
                                <div key={idx} className="flex flex-wrap justify-between items-center text-xs p-2 bg-stone-50 rounded-lg gap-2">
                                  <div className="space-y-0.5">
                                    <strong className="text-stone-900 block">{linea.nombreFormato}</strong>
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                      <span className="font-mono text-amber-900 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                        Lote Puesta: {linea.codigoLotePuesta}
                                      </span>
                                      {linea.fechaConsumoPreferente && (
                                        <span className="text-stone-500 font-mono">
                                          DCP: {formatearFechaES(linea.fechaConsumoPreferente)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right flex items-center gap-3">
                                    <div>
                                      <span className="font-bold text-stone-900 block">{linea.cantidadEstuches} est.</span>
                                      <span className="text-[11px] text-stone-500">{linea.precioUnitario.toFixed(2)} €/est.</span>
                                    </div>
                                    <span className="font-black text-amber-950 font-mono text-sm bg-white px-2 py-1 rounded border border-stone-200">
                                      {linea.subtotal.toFixed(2)} €
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="bg-white p-3 rounded-xl border border-stone-200 space-y-1">
                          <div className="flex justify-between text-stone-600">
                            <span>Base Imponible:</span>
                            <strong>{fac.totales.baseImponible.toFixed(2)} €</strong>
                          </div>
                          <div className="flex justify-between text-stone-600">
                            <span>IVA (4% / 10%):</span>
                            <strong>{fac.totales.cuotaIva.toFixed(2)} €</strong>
                          </div>
                          {fac.totales.cuotaRecargo > 0 && (
                            <div className="flex justify-between text-stone-600">
                              <span>Recargo Equivalencia:</span>
                              <strong>{fac.totales.cuotaRecargo.toFixed(2)} €</strong>
                            </div>
                          )}
                          <div className="flex justify-between text-sm font-bold text-stone-900 pt-1 border-t border-stone-100">
                            <span>Total Factura:</span>
                            <span className="text-amber-900">{fac.totales.totalDocumento.toFixed(2)} €</span>
                          </div>
                        </div>

                        {/* Botonera de Acciones Veri*Factu: Imprimir, XML AEAT, Rectificar / Anular */}
                        <div className="flex flex-wrap justify-end items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDocumentoImprimir({ tipo: 'factura', doc: fac });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                          >
                            <Printer className="w-3.5 h-3.5 text-amber-700" />
                            <span>Imprimir / PDF con QR</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              descargarXmlVeriFactu(fac);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-stone-300"
                            title="Descargar registro de alta en XML oficial para la AEAT"
                          >
                            <FileCode className="w-3.5 h-3.5 text-amber-700" />
                            <span>Descargar XML AEAT</span>
                          </button>

                          {/* Botón Rectificar / Anular (Ley Antifraude: No se borra, se rectifica) */}
                          <button
                            type="button"
                            disabled={fac.estadoRectificacion === 'rectificada_total'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setFacturaARectificar(fac);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs"
                            title="Emitir factura rectificativa oficial conforme a la Ley Antifraude"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Rectificar / Anular</span>
                          </button>
                        </div>

                        {/* Sección de Remisión y Estado AEAT (Fase 3.1) */}
                        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Estado AEAT:</span>
                            {(() => {
                              const sub = submissionsByFactura[fac.id];
                              if (!sub) {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-600 border border-stone-200">
                                    Pendiente de remisión (PENDING)
                                  </span>
                                );
                              }
                              if (sub.estado === 'SENDING') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                                    Enviando a la AEAT...
                                  </span>
                                );
                              }
                              if (sub.estado === 'ACCEPTED') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                    <span>Aceptada (CSV: {sub.csv || 'Generado'})</span>
                                  </span>
                                );
                              }
                              if (sub.estado === 'ACCEPTED_WITH_ERRORS') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3 text-amber-700" />
                                    <span>Aceptada con avisos (CSV: {sub.csv || 'Generado'})</span>
                                  </span>
                                );
                              }
                              if (sub.estado === 'REJECTED') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-900 border border-red-300" title={sub.descripcion}>
                                    Rechazada AEAT [{sub.codigoAeat || 'Error'}]: {sub.descripcion}
                                  </span>
                                );
                              }
                              if (sub.estado === 'FAILED_TECHNICAL' || sub.estado === 'RETRY_PENDING') {
                                return (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-900 border border-rose-300" title={sub.descripcion}>
                                    Error técnico: {sub.descripcion}
                                  </span>
                                );
                              }
                              return (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-700">
                                  {sub.estado}
                                </span>
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-2">
                            {(() => {
                              const sub = submissionsByFactura[fac.id];
                              const isSending = enviandoAeat[fac.id];
                              const isAccepted = sub?.estado === 'ACCEPTED' || sub?.estado === 'ACCEPTED_WITH_ERRORS';
                              const isTechnicalError = sub?.estado === 'FAILED_TECHNICAL' || sub?.estado === 'RETRY_PENDING';
                              const isRejected = sub?.estado === 'REJECTED';

                              if (isAccepted) {
                                return (
                                  <span className="text-[11px] font-mono text-emerald-800 font-semibold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                                    ✓ Remitida con éxito
                                  </span>
                                );
                              }

                              if (isRejected) {
                                return (
                                  <span className="text-[11px] text-red-700 font-medium italic">
                                    Requiere subsanación / rectificativa fiscal
                                  </span>
                                );
                              }

                              return (
                                <button
                                  type="button"
                                  disabled={isSending}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEnviarAeat(fac);
                                  }}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs ${
                                    isTechnicalError
                                      ? 'bg-rose-700 hover:bg-rose-800 text-white'
                                      : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                  }`}
                                  title="Remitir registro sellado a los servicios web oficiales de la AEAT"
                                >
                                  {isSending ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      <span>Enviando...</span>
                                    </>
                                  ) : isTechnicalError ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      <span>Reintentar envío a AEAT</span>
                                    </>
                                  ) : (
                                    <>
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      <span>Enviar a AEAT</span>
                                    </>
                                  )}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === SUBTAB: AGRUPAR ALBARANES === */}
      {subTab === 'agrupar_albaranes' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-stone-900">
                Facturación Agrupada de Albaranes
              </h3>
              <p className="text-xs text-stone-500">
                Selecciona los albaranes pendientes del mismo cliente para generar su factura oficial correspondiente.
              </p>
            </div>

            <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Filtrar por Cliente:
              </label>
              <select
                value={clienteParaFacturar}
                onChange={e => setClienteParaFacturar(e.target.value)}
                className="w-full text-xs rounded-lg border border-stone-300 p-2 bg-white"
              >
                <option value="">Todos los clientes con albaranes pendientes</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            {/* Listado de albaranes pendientes seleccionables */}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {albaranes
                .filter(a => a.estado === 'pendiente_facturar' && (!clienteParaFacturar || a.clienteId === clienteParaFacturar))
                .map(alb => {
                  const estaSeleccionado = albaranesSeleccionadosIds.includes(alb.id);
                  return (
                    <div
                      key={alb.id}
                      onClick={() => {
                        if (estaSeleccionado) {
                          setAlbaranesSeleccionadosIds(albaranesSeleccionadosIds.filter(id => id !== alb.id));
                        } else {
                          setAlbaranesSeleccionadosIds([...albaranesSeleccionadosIds, alb.id]);
                        }
                      }}
                      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition-colors ${
                        estaSeleccionado
                          ? 'bg-amber-50 border-amber-400'
                          : 'bg-white border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={estaSeleccionado}
                          onChange={() => {}}
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        <div>
                          <strong className="font-mono text-stone-900 block">{alb.numeroAlbaran}</strong>
                          <span className="text-stone-500">{alb.clienteNombre} · {formatearFechaES(alb.fecha)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <strong className="text-stone-900 block">{alb.totales.totalDocumento.toFixed(2)} €</strong>
                        <span className="text-[10px] text-stone-400">{alb.lineas.length} líneas</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-stone-100">
              <span className="text-xs text-stone-600">
                Seleccionados: <strong>{albaranesSeleccionadosIds.length}</strong> albarán(es)
              </span>
              <button
                type="button"
                onClick={handleCrearFacturaDesdeAlbaranes}
                disabled={albaranesSeleccionadosIds.length === 0}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Generar Factura Recapitulativa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. BOTÓN FLOTANTE CIRCULAR '+' (FAB) */}
      <button
        type="button"
        onClick={() => setMostrarModalNuevoDoc(true)}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-tr from-amber-600 to-amber-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all cursor-pointer group"
        title="Crear Nueva Venta / Albarán (+)"
      >
        <Plus className="w-7 h-7 stroke-[2.5] group-hover:rotate-90 transition-transform duration-200" />
      </button>

      {/* 5. MODAL LIMPIO DE NUEVA VENTA (ALBARÁN O FACTURA DIRECTA) */}
      {mostrarModalNuevoDoc && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-4 border border-stone-200 my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">Emitir Documento de Venta</h3>
                  <p className="text-xs text-stone-500">Genera un albarán de entrega o una factura directa</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalNuevoDoc(false)}
                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selector de Tipo de Documento */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setTipoNuevoDoc('albaran')}
                className={`py-2 rounded-lg transition-all ${
                  tipoNuevoDoc === 'albaran'
                    ? 'bg-white text-amber-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Albarán de Entrega ({numeroAlbaranSugerido})
              </button>
              <button
                type="button"
                onClick={() => setTipoNuevoDoc('factura_directa')}
                className={`py-2 rounded-lg transition-all ${
                  tipoNuevoDoc === 'factura_directa'
                    ? 'bg-white text-amber-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Factura Directa ({numeroFacturaSugerida})
              </button>
            </div>

            {/* Asistente de Voz Inteligente para Albaranes y Facturas */}
            <AsistenteVozVenta
              clientes={clientes}
              lotesEnvasados={lotesEnvasados}
              formatos={formatos}
              tipoDocActual={tipoNuevoDoc}
              onAplicarDatos={aplicarDatosVoz}
            />

            <form onSubmit={handleSubmitNuevoDoc} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Cliente Destinatario
                  </label>
                  <select
                    value={clienteId}
                    onChange={e => setClienteId(e.target.value)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                  >
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} ({c.cifNif})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Fecha del Documento
                  </label>
                  <input
                    type="date"
                    value={fechaDocumento}
                    onChange={e => setFechaDocumento(e.target.value)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-stone-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                  />
                </div>
              </div>

              {tipoNuevoDoc === 'factura_directa' && (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Forma de Pago:</label>
                  <select
                    value={formaPago}
                    onChange={e => setFormaPago(e.target.value as any)}
                    className="w-full text-sm rounded-xl border border-stone-300 p-2.5 bg-white font-medium"
                  >
                    <option value="transferencia">Transferencia Bancaria</option>
                    <option value="contado">Contado / Efectivo</option>
                    <option value="tarjeta">Tarjeta Bancaria</option>
                    <option value="domiciliacion">Domiciliación Bancaria</option>
                  </select>
                </div>
              )}

              {/* Líneas de producto a expedir */}
              <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-stone-800">Partidas y Estuches a Vender</span>
                  <button
                    type="button"
                    onClick={addLinea}
                    className="text-[11px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    + Añadir Línea
                  </button>
                </div>

                <div className="space-y-2.5">
                  {lineasVenta.map((l, index) => {
                    const lote = lotesEnvasados.find(le => le.id === l.loteEnvasadoId);
                    const precioActual = typeof l.precioUnitario === 'number' && !isNaN(l.precioUnitario) ? l.precioUnitario : 2.50;
                    const subtotalLinea = Number(((l.cantidadEstuches || 0) * precioActual).toFixed(2));

                    return (
                      <div key={index} className="p-3 bg-white rounded-xl border border-stone-200 text-xs space-y-2">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-12 sm:col-span-6">
                            <label className="text-[10px] font-bold text-stone-500 uppercase block mb-1">
                              Lote de Puesta / Formato:
                            </label>
                            <select
                              value={l.loteEnvasadoId}
                              onChange={e => updateLinea(index, 'loteEnvasadoId', e.target.value)}
                              className="w-full text-xs rounded-lg border border-stone-300 p-2 bg-white font-medium text-stone-900"
                            >
                              {lotesConStock.map(le => {
                                const codPuesta = getCodigoPuestaDeLote(le);
                                return (
                                  <option key={le.id} value={le.id}>
                                    Lote Puesta: {codPuesta} · {le.nombreFormato} ({le.estuchesDisponibles} disp.)
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          <div className="col-span-4 sm:col-span-2">
                            <label className="text-[10px] font-bold text-stone-500 uppercase block mb-1">
                              Cant. (est.):
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={l.cantidadEstuches}
                              onChange={e => updateLinea(index, 'cantidadEstuches', parseInt(e.target.value) || 0)}
                              className="w-full text-xs font-bold rounded-lg border border-stone-300 p-2 text-stone-900"
                            />
                          </div>

                          <div className="col-span-4 sm:col-span-2">
                            <label className="text-[10px] font-bold text-stone-500 uppercase block mb-1">
                              Precio (€):
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={l.precioUnitario}
                              onChange={e => updateLinea(index, 'precioUnitario', parseFloat(e.target.value) || 0)}
                              className="w-full text-xs font-bold rounded-lg border border-stone-300 p-2 text-stone-900"
                            />
                          </div>

                          <div className="col-span-4 sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 pt-3 sm:pt-4">
                            <span className="font-mono font-bold text-stone-900 text-xs">
                              {subtotalLinea.toFixed(2)} €
                            </span>
                            {lineasVenta.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeLinea(index)}
                                className="text-stone-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors"
                                title="Eliminar línea"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-1 border-t border-stone-100 text-[11px] text-stone-500">
                          <span>
                            D.C.P. Lote: <strong className="text-red-700 font-mono">{formatearFechaES(lote?.fechaConsumoPreferente)}</strong>
                          </span>
                          <span>
                            Línea por Lote individualizada para albarán y factura
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Resumen de totales */}
                <div className="pt-2 border-t border-stone-200 flex justify-between items-center text-xs">
                  <span className="text-stone-600">
                    Base: <strong>{totalesCalculados.baseImponible.toFixed(2)} €</strong> · IVA: <strong>{totalesCalculados.cuotaIva.toFixed(2)} €</strong>
                  </span>
                  <span className="text-sm font-black text-amber-900">
                    Total: {totalesCalculados.totalDocumento.toFixed(2)} €
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Notas u Observaciones
                </label>
                <input
                  type="text"
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  placeholder="Ej: Entregado en muelle de carga central..."
                  className="w-full text-xs rounded-xl border border-stone-300 p-2.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setMostrarModalNuevoDoc(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!stockVentaSuficiente || lineasVenta.some(l => l.cantidadEstuches <= 0)}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm cursor-pointer"
                >
                  Guardar y Emitir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>

      {/* 6. MODAL IMPRIMIBLE FORMAL DE ALBARÁN / FACTURA */}
      {documentoImprimir && (
        <div
          id="modal-impresion-container"
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible print:block print:w-full"
        >
          <div
            id="modal-impresion-card"
            className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 border border-stone-200 my-auto print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full print:bg-white"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3 no-print">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-amber-700" />
                <h3 className="font-bold text-stone-900">
                  {documentoImprimir.tipo === 'albaran' ? 'Albarán Oficial de Entrega' : 'Factura Oficial de Venta'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDocumentoImprimir(null)}
                className="text-stone-400 hover:text-stone-700 text-lg font-bold px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div
              id="hoja-documento-impresion"
              className="p-6 border border-stone-300 rounded-xl bg-white text-stone-900 font-sans space-y-5 print:border-none print:p-0 print:m-0 print:w-full"
            >
              {/* Encabezado oficial */}
              <div className="flex justify-between items-start border-b-2 border-stone-900 pb-4">
                <div>
                  <h2 className="text-2xl font-black text-stone-950 tracking-tight">{config.nombreEmpresa}</h2>
                  <p className="text-xs text-stone-600 mt-1">CIF / NIF: <strong className="font-mono">{config.cifEmpresa}</strong></p>
                  <p className="text-xs text-stone-600">{config.direccionEmpresa}</p>
                  <p className="text-xs text-stone-600">RGSEAA / Núm. Sanitario: <strong className="font-mono text-stone-900">{config.registroSanitario}</strong></p>
                  {config.telefonoEmpresa && <p className="text-xs text-stone-500">Teléfono: {config.telefonoEmpresa}</p>}
                </div>
                <div className="text-right">
                  <span className="text-xs uppercase font-black bg-stone-900 text-white px-3 py-1.5 rounded inline-block tracking-wider">
                    {documentoImprimir.tipo === 'albaran' ? 'ALBARÁN OFICIAL DE ENTREGA' : 'FACTURA COMERCIAL'}
                  </span>
                  <span className="text-base font-mono font-bold text-stone-900 block mt-2">
                    {'numeroAlbaran' in documentoImprimir.doc ? documentoImprimir.doc.numeroAlbaran : documentoImprimir.doc.numeroFactura}
                  </span>
                  <span className="text-xs text-stone-600 block mt-0.5">Fecha de Emisión: <strong>{formatearFechaES(documentoImprimir.doc.fecha)}</strong></span>
                  {'formaPago' in documentoImprimir.doc && (
                    <span className="text-xs text-stone-600 block mt-0.5">Forma de Pago: <span className="uppercase font-semibold">{documentoImprimir.doc.formaPago}</span></span>
                  )}
                </div>
              </div>

              {/* Datos del cliente destinatario */}
              <div className="grid grid-cols-2 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-200 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">Destinatario / Facturar a:</span>
                  <strong className="text-sm text-stone-900 block mt-0.5">{documentoImprimir.doc.clienteNombre}</strong>
                  <span className="text-stone-700 block mt-0.5 font-mono">CIF/NIF: {documentoImprimir.doc.clienteCif}</span>
                  <span className="text-stone-600 block mt-0.5">{documentoImprimir.doc.clienteDireccion}</span>
                </div>
                <div className="text-right space-y-1">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block tracking-wider">Régimen Fiscal:</span>
                  <span className="inline-block px-2 py-0.5 text-[11px] rounded font-medium bg-stone-200 text-stone-800">
                    {documentoImprimir.doc.clienteRecargoEquivalencia ? 'Recargo de Equivalencia (IVA 4% + RE 0.5%)' : 'Régimen General IVA (4%)'}
                  </span>
                  {'albaranesAsociados' in documentoImprimir.doc && documentoImprimir.doc.albaranesAsociados?.length > 0 && (
                    <p className="text-[11px] text-stone-600 pt-1">
                      Albaranes referenciados: {documentoImprimir.doc.albaranesAsociados.map(a => `${a.numeroAlbaran} (${formatearFechaES(a.fecha)})`).join(', ')}
                    </p>
                  )}
                </div>
              </div>

              {/* Mención obligatoria de Rectificación si es Factura Rectificativa */}
              {documentoImprimir.tipo === 'factura' && ('esRectificativa' in documentoImprimir.doc) && (documentoImprimir.doc as Factura).esRectificativa && (
                <div className="p-3 bg-amber-50/80 rounded-xl border-2 border-amber-300 text-xs text-amber-950 space-y-1">
                  <div className="font-black uppercase tracking-wider text-[10px] text-amber-900 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                    <span>Factura Rectificativa conforme a la Ley Antifraude y Art. 15 RD 1619/2012</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-stone-500">Factura Original Rectificada: </span>
                      <strong className="font-mono text-stone-900">{(documentoImprimir.doc as Factura).facturaRectificadaNumero}</strong>
                      {(documentoImprimir.doc as Factura).facturaRectificadaFecha && (
                        <span className="text-stone-600 font-mono"> ({formatearFechaES((documentoImprimir.doc as Factura).facturaRectificadaFecha)})</span>
                      )}
                    </div>
                    <div>
                      <span className="text-stone-500">Modalidad: </span>
                      <strong className="text-stone-900">
                        {((documentoImprimir.doc as Factura).tipoRectificativa === 'sustitucion' || (documentoImprimir.doc as Factura).tipoRectificativa === 'por_sustitucion') ? 'Por Sustitución' : 'Por Diferencias'}
                      </strong>
                    </div>
                  </div>
                  {(documentoImprimir.doc as Factura).motivoRectificativa && (
                    <div className="text-[11px] pt-0.5 border-t border-amber-200/60">
                      <span className="text-stone-500">Causa de rectificación: </span>
                      <span className="italic text-stone-800">{(documentoImprimir.doc as Factura).motivoRectificativa}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tabla de líneas y trazabilidad sanitaria - Una línea por lote */}
              <div>
                <table className="w-full text-xs text-left border-collapse border border-stone-300">
                  <thead>
                    <tr className="border-b-2 border-stone-800 bg-stone-100 font-bold text-stone-900">
                      <th className="py-2.5 px-2">Descripción del Producto</th>
                      <th className="py-2.5 px-2 font-mono">Código de Puesta (Lote)</th>
                      <th className="py-2.5 px-2 text-center">D.C.P.</th>
                      <th className="py-2.5 px-2 text-right">Cantidad</th>
                      <th className="py-2.5 px-2 text-right">Precio Unit.</th>
                      <th className="py-2.5 px-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {desglosarLineasPorLote(documentoImprimir.doc.lineas).map((l, i) => (
                      <tr key={i} className="hover:bg-stone-50">
                        <td className="py-2 px-2">
                          <span className="font-bold text-stone-950 block">{l.nombreFormato}</span>
                        </td>
                        <td className="py-2 px-2 font-mono font-bold text-stone-900">
                          {l.codigoLotePuesta}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-red-700">
                          {formatearFechaES(l.fechaConsumoPreferente)}
                        </td>
                        <td className="py-2 px-2 text-right font-semibold text-stone-800">{l.cantidadEstuches} est.</td>
                        <td className="py-2 px-2 text-right">{l.precioUnitario.toFixed(2)} €</td>
                        <td className="py-2 px-2 text-right font-bold text-stone-950">{l.subtotal.toFixed(2)} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Desglose Fiscal Completo */}
              <div className="flex justify-end pt-2">
                <div className="w-72 space-y-1.5 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                  <div className="flex justify-between text-stone-600">
                    <span>Base Imponible:</span>
                    <span className="font-mono font-semibold">{documentoImprimir.doc.totales.baseImponible.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>IVA ({documentoImprimir.doc.totales.porcentajeIva}%):</span>
                    <span className="font-mono font-semibold">{documentoImprimir.doc.totales.cuotaIva.toFixed(2)} €</span>
                  </div>
                  {documentoImprimir.doc.clienteRecargoEquivalencia && (
                    <div className="flex justify-between text-stone-600">
                      <span>Recargo Eq. ({documentoImprimir.doc.totales.porcentajeRecargo}%):</span>
                      <span className="font-mono font-semibold">{documentoImprimir.doc.totales.cuotaRecargo.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between text-stone-950 pt-2 border-t-2 border-stone-800 text-sm font-black">
                    <span>TOTAL A PAGAR:</span>
                    <span className="font-mono text-amber-950 text-base">{documentoImprimir.doc.totales.totalDocumento.toFixed(2)} €</span>
                  </div>
                </div>
              </div>

              {documentoImprimir.doc.notas && (
                <div className="text-xs text-stone-600 p-2.5 bg-stone-50 rounded-lg border border-stone-200">
                  <strong className="text-stone-800">Observaciones:</strong> {documentoImprimir.doc.notas}
                </div>
              )}

              {/* SECCIÓN OFICIAL VERI*FACTU CON CÓDIGO QR Y HUELLA CRIPTOGRÁFICA (Solo en Facturas) */}
              {documentoImprimir.tipo === 'factura' && (
                <div className="p-4 bg-stone-50 rounded-xl border-2 border-stone-300 grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
                  {/* Código QR Veri*Factu (35mm x 35mm conforme a Orden HAC/1177/2024) */}
                  <div className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-stone-300 shadow-2xs">
                    {(documentoImprimir.doc as Factura).qrDataUri ? (
                      <img
                        src={(documentoImprimir.doc as Factura).qrDataUri}
                        alt="Código QR Veri*Factu AEAT"
                        className="w-28 h-28 object-contain"
                      />
                    ) : (
                      <div className="w-28 h-28 bg-stone-100 flex flex-col items-center justify-center text-center p-2 text-stone-400">
                        <QrCode className="w-8 h-8 mb-1 text-stone-500" />
                        <span className="text-[10px] font-mono">QR AEAT</span>
                      </div>
                    )}
                    <span className="text-[9px] font-mono text-stone-500 mt-1">Sede AEAT</span>
                  </div>

                  {/* Texto Legal Oficial y Hash Encadenado */}
                  <div className="sm:col-span-3 space-y-1.5 text-left">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-stone-900 text-white font-black font-mono text-[11px] rounded tracking-wider">
                        «VERI*FACTU»
                      </span>
                      <span className="font-bold text-[11px] text-stone-800">
                        Factura verificable en la sede electrónica de la AEAT
                      </span>
                    </div>

                    <p className="text-[10px] text-stone-600 leading-tight">
                      Este documento ha sido generado por un Sistema Informático de Facturación certificado conforme a la Ley 11/2021 de medidas de prevención del fraude fiscal y la Orden Ministerial HAC/1177/2024.
                    </p>

                    <div className="pt-1 text-[10px] font-mono space-y-0.5 text-stone-700 bg-white p-2 rounded border border-stone-200">
                      <div className="truncate">
                        <span className="text-stone-400 font-sans">Huella SHA-256: </span>
                        <strong className="text-stone-950 select-all">
                          {(documentoImprimir.doc as Factura).hashActual || 'Sellado criptográfico encadenado'}
                        </strong>
                      </div>
                      <div className="truncate text-stone-500">
                        <span className="text-stone-400 font-sans">Hash Anterior: </span>
                        <span>
                          {(documentoImprimir.doc as Factura).hashAnterior || '0000000000000000000000000000000000000000 (GÉNESIS)'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Trazabilidad Sanitaria y Firmas Legales */}
              <div className="pt-4 grid grid-cols-2 gap-8 text-[11px] text-stone-600 border-t border-stone-200">
                <div className="border-t border-stone-400 pt-3 text-center">
                  <p className="font-bold text-stone-800">Por la Explotación Avícola / Emisor</p>
                  <p className="text-[10px] text-stone-500 mt-1">Firma y Sello Oficial</p>
                </div>
                <div className="border-t border-stone-400 pt-3 text-center">
                  <p className="font-bold text-stone-800">Conforme Receptor / Cliente</p>
                  <p className="text-[10px] text-stone-500 mt-1">Firma, Nombre y DNI</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 no-print">
              <button
                type="button"
                onClick={() => setDocumentoImprimir(null)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Guardar PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Factura Rectificativa */}
      {facturaARectificar && (
        <ModalFacturaRectificativa
          facturaOriginal={facturaARectificar}
          contadorRectificativa={contadorRectificativa}
          config={config}
          fiscalRecordRefs={fiscalRecordRefs}
          fiscalConfig={fiscalConfig}
          onClose={() => setFacturaARectificar(null)}
          onEmitirRectificativa={async (rectificativa, reingresarStock, nuevoFiscalRecord) => {
            await onAddFacturaRectificativa(rectificativa, reingresarStock, nuevoFiscalRecord);
            setFacturaARectificar(null);
            setDocumentoImprimir({ tipo: 'factura', doc: rectificativa });
          }}
        />
      )}

      {/* Modal Auditoría de Integridad Veri*Factu */}
      {mostrarModalAuditoria && (
        <ModalAuditoriaVeriFactu
          facturas={facturas}
          config={config}
          onClose={() => setMostrarModalAuditoria(false)}
        />
      )}
    </>
  );
};
