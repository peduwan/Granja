import React, { useState, useEffect } from 'react';
import {
  Building2,
  Save,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  Hash,
  MapPin,
  Phone,
  Mail,
  UserCheck,
  FileText,
  AlertCircle
} from 'lucide-react';
import { ConfiguracionEmpresa } from '../types';

interface CentroEnvasadoViewProps {
  config: ConfiguracionEmpresa;
  onUpdateConfig: (cfg: ConfiguracionEmpresa) => void;
}

export const CentroEnvasadoView: React.FC<CentroEnvasadoViewProps> = ({
  config,
  onUpdateConfig
}) => {
  // Estado local para los datos
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

  const [guardadoExitoso, setGuardadoExitoso] = useState(false);

  // Sincronizar si cambian las props
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

  const handleGuardar = (e: React.FormEvent) => {
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
    setGuardadoExitoso(true);
    setTimeout(() => setGuardadoExitoso(false), 3500);
  };

  const handleReset = () => {
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
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Tarjeta de Resumen Legal */}
      <div className="bg-gradient-to-r from-stone-900 via-amber-950 to-stone-900 rounded-2xl p-6 text-white shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="w-6 h-6 text-amber-400" />
              <h3 className="text-xl font-bold tracking-tight text-white">
                {config.nombreEmpresa || 'Centro de Embalaje Autorizado'}
              </h3>
            </div>
            <p className="text-xs text-amber-200/80 flex flex-wrap items-center gap-2">
              <span>CIF: {config.cifEmpresa}</span>
              <span>•</span>
              <span className="font-bold text-amber-300">RGSEAA: {config.registroSanitario}</span>
              <span>•</span>
              <span>Cód. Centro: {config.codigoCentroEnvasado}</span>
            </p>
          </div>

          <div className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-400/30 px-3.5 py-2 rounded-xl text-xs text-amber-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Homologación RD 226/2008 & Reglamento UE</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleGuardar} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-4">
          <div>
            <h4 className="font-bold text-base text-stone-900">
              Parámetros Oficiales del Centro de Envasado
            </h4>
            <p className="text-xs text-stone-500 mt-0.5">
              Información obligatoria impresa en etiquetas de estuches, albaranes, facturas y libros oficiales de trazabilidad
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer</span>
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Guardar Cambios</span>
            </button>
          </div>
        </div>

        {guardadoExitoso && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
            <span>¡Datos del Centro de Envasado guardados y sincronizados correctamente!</span>
          </div>
        )}

        {/* Sección 1: Identificación y Registros Sanitarios */}
        <div className="space-y-3">
          <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
            <span>1. Registros Sanitarios y Autorización Sanitaria</span>
          </h5>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-stone-700 mb-1">
                Razón Social / Titular de la Explotación *
              </label>
              <input
                type="text"
                value={empresaNombre}
                onChange={e => setEmpresaNombre(e.target.value)}
                placeholder="Granja Avícola El Molino S.L."
                className="w-full rounded-xl border border-stone-300 p-2.5 font-bold text-stone-900 focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                CIF / NIF Oficial *
              </label>
              <input
                type="text"
                value={empresaCif}
                onChange={e => setEmpresaCif(e.target.value.toUpperCase())}
                placeholder="B45123456"
                className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase font-bold focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Registro Sanitario (RGSEAA) *
              </label>
              <input
                type="text"
                value={empresaSanitario}
                onChange={e => setEmpresaSanitario(e.target.value)}
                placeholder="21.000123/TO"
                className="w-full rounded-xl border border-stone-300 p-2.5 font-mono font-bold text-amber-950 focus:ring-2 focus:ring-amber-500"
                required
              />
              <span className="text-[10px] text-stone-400">
                Imprescindible en el etiquetado del estuche (clave 21 para huevos)
              </span>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Código del Centro de Embalaje Autorizado
              </label>
              <input
                type="text"
                value={empresaCentroCod}
                onChange={e => setEmpresaCentroCod(e.target.value)}
                placeholder="45.12345/TO"
                className="w-full rounded-xl border border-stone-300 p-2.5 font-mono font-medium focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-[10px] text-stone-400">Código de envasador asignado por Agricultura</span>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Código REGA General de la Explotación
              </label>
              <input
                type="text"
                value={empresaRega}
                onChange={e => setEmpresaRega(e.target.value.toUpperCase())}
                placeholder="ES45000189"
                className="w-full rounded-xl border border-stone-300 p-2.5 font-mono uppercase font-medium focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-[10px] text-stone-400">Identificador ganadero provincial</span>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-stone-700 mb-1">
                Responsable Técnico / Titular del Centro
              </label>
              <input
                type="text"
                value={empresaResponsable}
                onChange={e => setEmpresaResponsable(e.target.value)}
                placeholder="Juan Pérez García"
                className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Sección 2: Dirección y Contacto */}
        <div className="space-y-3 pt-3 border-t border-stone-100">
          <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-amber-700" />
            <span>2. Dirección de las Instalaciones y Contacto Comercial</span>
          </h5>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-xs">
            <div className="sm:col-span-3">
              <label className="block font-semibold text-stone-700 mb-1">Dirección / Polígono / Carretera</label>
              <input
                type="text"
                value={empresaDir}
                onChange={e => setEmpresaDir(e.target.value)}
                placeholder="Carretera de la Sierra, Km 4,2"
                className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Población / Municipio</label>
              <input
                type="text"
                value={empresaPob}
                onChange={e => setEmpresaPob(e.target.value)}
                placeholder="Talavera de la Reina"
                className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Provincia</label>
              <input
                type="text"
                value={empresaProv}
                onChange={e => setEmpresaProv(e.target.value)}
                placeholder="Toledo"
                className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Código Postal</label>
              <input
                type="text"
                value={empresaCp}
                onChange={e => setEmpresaCp(e.target.value)}
                placeholder="45600"
                className="w-full rounded-xl border border-stone-300 p-2.5 font-mono focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-1">
              <label className="block font-semibold text-stone-700 mb-1">Teléfono de Contacto</label>
              <input
                type="tel"
                value={empresaTel}
                onChange={e => setEmpresaTel(e.target.value)}
                placeholder="+34 600 000 000"
                className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-stone-700 mb-1">Correo Electrónico (Facturación y Notificaciones)</label>
              <input
                type="email"
                value={empresaEmail}
                onChange={e => setEmpresaEmail(e.target.value)}
                placeholder="info@granjaavicola.com"
                className="w-full rounded-xl border border-stone-300 p-2.5 focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Sección 3: Contadores de Series Correlativas */}
        <div className="space-y-3 pt-3 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-amber-700" />
              <span>3. Series Correlativas y Numeración Oficial</span>
            </h5>
            <span className="text-[10px] font-semibold text-stone-500">
              Ley Antifraude 11/2021 & Veri*Factu
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-xs">
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <label className="block font-bold text-stone-800 mb-1">
                Próximo Albarán
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-stone-400 font-bold">ALB-</span>
                <input
                  type="number"
                  min="1"
                  value={empresaContadorAlb}
                  onChange={e => setEmpresaContadorAlb(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 p-1.5 font-mono font-bold bg-white focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <span className="text-[10px] text-stone-500 mt-1 block">Correlativo albaranes de entrega</span>
            </div>

            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <label className="block font-bold text-stone-800 mb-1">
                Próxima Factura Ordinaria
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-stone-400 font-bold">F{new Date().getFullYear()}-</span>
                <input
                  type="number"
                  min="1"
                  value={empresaContadorFact}
                  onChange={e => setEmpresaContadorFact(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 p-1.5 font-mono font-bold bg-white focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <span className="text-[10px] text-stone-500 mt-1 block">Serie oficial numerada continua</span>
            </div>

            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200">
              <label className="block font-bold text-stone-800 mb-1">
                Próximo Envasado
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-stone-400 font-bold">ENV-{new Date().getFullYear()}-</span>
                <input
                  type="number"
                  min="1"
                  value={empresaContadorEnv}
                  onChange={e => setEmpresaContadorEnv(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 p-1.5 font-mono font-bold bg-white focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <span className="text-[10px] text-stone-500 mt-1 block">Lote de envasado en centro</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-stone-100 flex justify-end gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer hover:shadow"
          >
            <Save className="w-4 h-4" />
            <span>Guardar Parámetros del Centro</span>
          </button>
        </div>
      </form>
    </div>
  );
};
