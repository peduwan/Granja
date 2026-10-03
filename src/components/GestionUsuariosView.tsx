import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  Mail,
  User,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Crown,
  Lock,
  Search,
  Check,
  X,
  Sparkles,
  Info,
  RefreshCw
} from 'lucide-react';
import { UsuarioAutorizado, RolUsuario } from '../types';
import { ROOT_OWNER_EMAIL } from '../utils/storage';
import { syncAuthorizedUserToCloud, deleteAuthorizedUserFromCloud, UserProfile } from '../utils/firebase';

interface GestionUsuariosViewProps {
  usuarios: UsuarioAutorizado[];
  currentUser: UserProfile | null;
  onUpdateUsuarios: (usuarios: UsuarioAutorizado[]) => void;
}

export const GestionUsuariosView: React.FC<GestionUsuariosViewProps> = ({
  usuarios,
  currentUser,
  onUpdateUsuarios
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UsuarioAutorizado | null>(null);

  // Form states
  const [emailInput, setEmailInput] = useState('');
  const [nombreInput, setNombreInput] = useState('');
  const [rolInput, setRolInput] = useState<RolUsuario>('operario');
  const [notasInput, setNotasInput] = useState('');
  const [formError, setFormError] = useState('');
  const [successToast, setSuccessToast] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isOwner = currentUser?.email?.trim().toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase() || currentUser?.isOwner;

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(''), 4000);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFormError('Introduce un correo electrónico de Google válido.');
      return;
    }

    if (cleanEmail === ROOT_OWNER_EMAIL.toLowerCase()) {
      setFormError('Esta cuenta es el Propietario Principal del sistema y ya tiene acceso total.');
      return;
    }

    if (usuarios.some(u => u.email.trim().toLowerCase() === cleanEmail)) {
      setFormError('Ya existe una autorización para este correo electrónico.');
      return;
    }

    setIsSaving(true);

    const newUser: UsuarioAutorizado = {
      id: `usr_${Date.now()}`,
      email: cleanEmail,
      nombre: nombreInput.trim() || cleanEmail.split('@')[0],
      rol: rolInput,
      activo: true,
      agregadoPor: currentUser?.email || ROOT_OWNER_EMAIL,
      fechaAlta: new Date().toISOString(),
      notas: notasInput.trim()
    };

    try {
      // Guardar en Firestore
      await syncAuthorizedUserToCloud(newUser);

      // Actualizar estado local
      const updated = [...usuarios, newUser];
      onUpdateUsuarios(updated);

      showToast(`Usuario ${cleanEmail} autorizado con éxito como ${getRoleLabel(rolInput)}.`);
      setShowAddModal(false);
      setEmailInput('');
      setNombreInput('');
      setRolInput('operario');
      setNotasInput('');
    } catch (err: any) {
      setFormError('Error al guardar el usuario: ' + (err.message || 'Intente de nuevo.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActivo = async (user: UsuarioAutorizado) => {
    if (user.email.trim().toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase()) {
      return; // El propietario siempre está activo
    }

    const newStatus = !user.activo;
    const updatedUser = { ...user, activo: newStatus };

    // Actualizar localmente de inmediato para UX fluida
    const updated = usuarios.map(u => u.id === user.id ? updatedUser : u);
    onUpdateUsuarios(updated);

    // Sincronizar con Firestore
    await syncAuthorizedUserToCloud(updatedUser);

    showToast(
      newStatus
        ? `Acceso reactivado para ${user.email}.`
        : `Acceso pausado para ${user.email}. No podrá iniciar sesión hasta que lo reactives.`
    );
  };

  const handleChangeRole = async (user: UsuarioAutorizado, newRole: RolUsuario) => {
    if (user.email.trim().toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase()) {
      return; // El propietario no cambia de rol
    }

    const updatedUser = { ...user, rol: newRole };
    const updated = usuarios.map(u => u.id === user.id ? updatedUser : u);
    onUpdateUsuarios(updated);

    await syncAuthorizedUserToCloud(updatedUser);
    showToast(`Rol actualizado a "${getRoleLabel(newRole)}" para ${user.email}.`);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    const email = userToDelete.email;
    setIsSaving(true);

    try {
      await deleteAuthorizedUserFromCloud(email);

      const updated = usuarios.filter(u => u.id !== userToDelete.id);
      onUpdateUsuarios(updated);

      showToast(`Autorización de acceso revocada y eliminada para ${email}.`);
      setUserToDelete(null);
    } catch (err: any) {
      alert('Error eliminando usuario: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const getRoleLabel = (role: RolUsuario) => {
    switch (role) {
      case 'propietario':
        return 'Propietario Principal';
      case 'admin':
        return 'Administrador';
      case 'operario':
        return 'Operario de Granja';
      case 'lector':
        return 'Inspector / Solo Lectura';
      default:
        return role;
    }
  };

  const getRoleColor = (role: RolUsuario) => {
    switch (role) {
      case 'propietario':
        return 'bg-amber-100 text-amber-900 border-amber-300 font-bold';
      case 'admin':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'operario':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'lector':
        return 'bg-stone-100 text-stone-700 border-stone-200';
      default:
        return 'bg-stone-100 text-stone-700 border-stone-200';
    }
  };

  // Filtrar usuarios
  const filteredUsers = usuarios.filter(u => {
    const term = searchTerm.toLowerCase();
    return (
      u.email.toLowerCase().includes(term) ||
      (u.nombre && u.nombre.toLowerCase().includes(term)) ||
      u.rol.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* Toast flotante */}
      {successToast && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-900 text-emerald-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-semibold animate-in fade-in slide-in-from-top-3 border border-emerald-700">
          <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Cabecera y Explicación */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-stone-200/90 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-white flex items-center justify-center shadow-md">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-stone-900 tracking-tight">
                Control de Acceso y Usuarios de Google
              </h2>
              <p className="text-xs sm:text-sm text-stone-600">
                Solo el propietario puede conceder permiso a otras cuentas de Google para acceder a la explotación.
              </p>
            </div>
          </div>

          {isOwner && (
            <button
              type="button"
              id="btn-add-authorized-user"
              onClick={() => {
                setFormError('');
                setShowAddModal(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-800 hover:bg-amber-900 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Autorizar Usuario de Google</span>
            </button>
          )}
        </div>

        {/* Banner Informativo */}
        <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">
              Seguridad basada en Lista Blanca (Whitelist) vinculada a Google Identity:
            </p>
            <p className="text-stone-700 leading-relaxed">
              Cualquier operario o veterinario puede usar su cuenta oficial de Google para identificarse. Sin embargo, <strong>no podrá acceder a ningún dato de la granja ni a las naves</strong> a menos que tú como propietario hayas añadido su dirección de correo en esta lista y mantengas su acceso activo.
            </p>
          </div>
        </div>
      </div>

      {/* Tarjeta Destacada del Propietario Raíz */}
      <div className="bg-gradient-to-br from-amber-950 via-[#2e160c] to-[#1a0c06] text-white rounded-2xl p-5 sm:p-6 border border-amber-900 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-amber-950 font-black shadow-lg shrink-0">
              <Crown className="w-6 h-6 fill-amber-950" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40 text-[11px] font-extrabold uppercase tracking-wider mb-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>Titular y Administrador Principal</span>
              </div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>{ROOT_OWNER_EMAIL}</span>
                {currentUser?.email?.toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase() && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-md font-semibold">
                    Sesión Actual (Tú)
                  </span>
                )}
              </h3>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Propietario de la explotación avícola • Acceso ilimitado permanente a producción, facturación, clientes y altas de personal.
              </p>
            </div>
          </div>

          <div className="text-right sm:border-l sm:border-amber-800/60 sm:pl-6 shrink-0 flex sm:flex-col items-center sm:items-end justify-between">
            <span className="text-xs text-amber-300/80 font-medium">Estado del Titular</span>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-700/60 px-2.5 py-1 rounded-lg">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Protegido / Activo</span>
            </span>
          </div>
        </div>
      </div>

      {/* Lista de Usuarios Autorizados */}
      <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm overflow-hidden">
        {/* Barra superior de filtrado */}
        <div className="p-4 border-b border-stone-200/80 bg-stone-50/70 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar por email, nombre o rol..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-stone-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium"
            />
          </div>

          <div className="text-xs text-stone-500 font-medium w-full sm:w-auto text-right">
            <span>{filteredUsers.length} {filteredUsers.length === 1 ? 'usuario registrado' : 'usuarios registrados'}</span>
          </div>
        </div>

        {/* Tabla / Lista */}
        <div className="divide-y divide-stone-100">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-stone-500 text-xs space-y-2">
              <User className="w-8 h-8 text-stone-300 mx-auto" />
              <p className="font-semibold text-stone-700">No hay otros usuarios autorizados todavía.</p>
              <p>
                Solo tú puedes acceder con {ROOT_OWNER_EMAIL}. Haz clic en <strong>"Autorizar Usuario de Google"</strong> para dar acceso a operarios o responsables.
              </p>
            </div>
          ) : (
            filteredUsers.map(user => {
              const isUserOwner = user.email.trim().toLowerCase() === ROOT_OWNER_EMAIL.toLowerCase();

              return (
                <div
                  key={user.id}
                  className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                    !user.activo ? 'bg-stone-50/80 opacity-75' : 'hover:bg-amber-50/20'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                      isUserOwner
                        ? 'bg-amber-500 text-white border-amber-600'
                        : user.activo
                        ? 'bg-amber-100 text-amber-900 border-amber-200'
                        : 'bg-stone-200 text-stone-500 border-stone-300'
                    }`}>
                      <User className="w-5 h-5" />
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-stone-900 text-sm truncate">
                          {user.nombre || user.email.split('@')[0]}
                        </span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getRoleColor(user.rol)}`}>
                          {getRoleLabel(user.rol)}
                        </span>
                        {!user.activo && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                            Acceso Pausado
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-stone-600 font-mono">
                        <Mail className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                        <span className="truncate">{user.email}</span>
                      </div>

                      {user.notas && (
                        <p className="text-[11px] text-stone-500 italic">
                          Nota: {user.notas}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-[11px] text-stone-400 pt-0.5">
                        <span>Alta: {new Date(user.fechaAlta).toLocaleDateString()}</span>
                        {user.ultimoAcceso && (
                          <span>• Último acceso: {new Date(user.ultimoAcceso).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Acciones de Gestión */}
                  {!isUserOwner && isOwner && (
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {/* Selector de Rol */}
                      <select
                        value={user.rol}
                        onChange={e => handleChangeRole(user, e.target.value as RolUsuario)}
                        className="text-xs p-1.5 border border-stone-300 rounded-lg bg-white font-medium text-stone-700 hover:border-amber-400 focus:ring-1 focus:ring-amber-500 cursor-pointer"
                        title="Cambiar nivel de autorización"
                      >
                        <option value="operario">Operario (Puesta y Envasado)</option>
                        <option value="admin">Administrador (Control Total)</option>
                        <option value="lector">Inspector (Solo Lectura)</option>
                      </select>

                      {/* Botón Activar / Suspender */}
                      <button
                        type="button"
                        onClick={() => handleToggleActivo(user)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                          user.activo
                            ? 'bg-stone-100 hover:bg-stone-200 text-stone-700 border-stone-300'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                        }`}
                        title={user.activo ? 'Pausar acceso temporalmente' : 'Reactivar acceso'}
                      >
                        {user.activo ? 'Pausar' : 'Activar'}
                      </button>

                      {/* Botón Eliminar */}
                      <button
                        type="button"
                        onClick={() => setUserToDelete(user)}
                        className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                        title="Eliminar usuario definitivamente"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal: Autorizar Nuevo Usuario */}
      {showAddModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-5 relative">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-stone-900">
                  Autorizar Usuario de Google
                </h3>
                <p className="text-xs text-stone-500">
                  El usuario podrá acceder de inmediato iniciando sesión con su Google
                </p>
              </div>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleAddUser} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  Correo Electrónico de Google *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                    placeholder="ejemplo@gmail.com"
                    className="w-full pl-9 pr-3 py-2.5 border border-stone-300 rounded-xl bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900 font-medium"
                  />
                </div>
                <p className="text-[11px] text-stone-500 mt-1">
                  Debe ser la dirección con la que esa persona inicia sesión en Google.
                </p>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  Nombre Completo / Cargo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={nombreInput}
                    onChange={e => setNombreInput(e.target.value)}
                    placeholder="Ej. Manuel Gutiérrez (Encargado Puesta)"
                    className="w-full pl-9 pr-3 py-2.5 border border-stone-300 rounded-xl bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  Perfil y Permisos de Acceso *
                </label>
                <select
                  value={rolInput}
                  onChange={e => setRolInput(e.target.value as RolUsuario)}
                  className="w-full p-2.5 border border-stone-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                >
                  <option value="operario">Operario (Puesta, Envasado, Naves y Albaranes)</option>
                  <option value="admin">Administrador (Facturación, IVA, Clientes y Catálogos)</option>
                  <option value="lector">Inspector / Veterinario (Solo Lectura y Trazabilidad)</option>
                </select>

                <div className="mt-2 p-2.5 bg-stone-50 rounded-xl border border-stone-200 text-[11px] text-stone-600">
                  {rolInput === 'operario' && 'Permiso para el trabajo de campo y empaque diario. No puede ver facturas oficiales ni alterar la configuración de empresa.'}
                  {rolInput === 'admin' && 'Permiso directivo completo para emitir facturas con Veri*Factu, editar precios de venta y gestionar albaranes.'}
                  {rolInput === 'lector' && 'Permiso de consulta oficial para veterinarios o inspectores sanitarios. No permite editar ni registrar lotes.'}
                </div>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">
                  Notas Internas (Opcional)
                </label>
                <input
                  type="text"
                  value={notasInput}
                  onChange={e => setNotasInput(e.target.value)}
                  placeholder="Ej. Nave 1 y Centro de Clasificación"
                  className="w-full p-2.5 border border-stone-300 rounded-xl bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-medium text-stone-900"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-stone-300 text-stone-700 font-semibold hover:bg-stone-100 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <span>Guardando...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Conceder Acceso</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmación de Eliminación */}
      {userToDelete && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-stone-200 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-stone-900">
                ¿Revocar acceso al usuario?
              </h3>
              <p className="text-xs text-stone-600 mt-1">
                Se eliminará la autorización para <strong>{userToDelete.email}</strong>. Si intenta iniciar sesión con Google, su entrada será bloqueada.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="flex-1 py-2.5 px-3 rounded-xl border border-stone-300 text-stone-700 font-semibold hover:bg-stone-100 transition-colors cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteUser}
                disabled={isSaving}
                className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition-colors cursor-pointer text-xs"
              >
                {isSaving ? 'Eliminando...' : 'Sí, Revocar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
