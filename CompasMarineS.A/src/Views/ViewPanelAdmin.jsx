import { useCallback, useState, useEffect } from 'react';
import { ShieldAlert, Database, RefreshCw, Users, ServerCrash, CheckCircle2, Search, Key, UserCog, AlertTriangle } from 'lucide-react';

export const ViewAdmin = ({ onLoadingProgress }) => {
  const [activeTab, setActiveTab] = useState('sistema'); // 'sistema' o 'usuarios'
  const [syncStatus, setSyncStatus] = useState(null); // 'loading', 'success', 'error'
  const [dbStatus, setDbStatus] = useState(null);
  const [message, setMessage] = useState('');

  // Estados para la gestión de usuarios
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  
  // Paginación para no congelar el navegador
  const [visibleCount, setVisibleCount] = useState(50);
  
  // Identificador del Admin actual
  const [adminUser, setAdminUser] = useState(null);

  // Cargar perfil del Admin al iniciar
  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.user) setAdminUser(data.user); })
      .catch(() => {});
  }, []);

  const isSupremo = Number(adminUser?.rol_id) === 10;

  // Reiniciar paginación al cambiar pestaña
  useEffect(() => {
    setVisibleCount(50);
  }, [activeTab]);

  // --- LÓGICA DE PROGRESO ANIMADO ---
  const startProgressTicker = (initialPercent = 10) => {
    let currentPercent = initialPercent;
    onLoadingProgress?.({ percent: currentPercent });

    return window.setInterval(() => {
      currentPercent = Math.min(92, currentPercent + (currentPercent < 60 ? 8 : 3));
      onLoadingProgress?.({ percent: currentPercent });
    }, 700);
  };

  // --- MANTENIMIENTO DEL SISTEMA ---
  const handleSyncUsers = async () => {
    const progressTimer = startProgressTicker(10);
    setSyncStatus('loading');
    setMessage('Descargando usuarios desde ControlDoc. Esto puede tomar un minuto...');
    try {
      const res = await fetch('/api/admin/sync-users');
      const data = await res.json();
      if (res.ok) {
        setSyncStatus('success');
        setMessage(data.message || 'Sincronización completada con éxito.');
        onLoadingProgress?.({ percent: 100, done: true });
        if (activeTab === 'usuarios') fetchUsers(); 
      } else {
        throw new Error(data.error || 'Fallo desconocido');
      }
    } catch (err) {
      onLoadingProgress?.({ active: false });
      setSyncStatus('error');
      setMessage(err.message);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const handleSetupDb = async () => {
    if (!window.confirm('¿Estás seguro? Esto verificará y recreará las tablas necesarias en MySQL.')) return;
    
    const progressTimer = startProgressTicker(16);
    setDbStatus('loading');
    try {
      const res = await fetch('/api/admin/setup-db');
      const data = await res.json();
      if (res.ok) {
        setDbStatus('success');
        setMessage(data.message || 'Tablas configuradas correctamente.');
        onLoadingProgress?.({ percent: 100, done: true });
      } else {
        throw new Error(data.error || 'Fallo desconocido');
      }
    } catch (err) {
      onLoadingProgress?.({ active: false });
      setDbStatus('error');
      setMessage(err.message);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  // --- GESTIÓN DE USUARIOS ---
  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    setUsersError('');
    onLoadingProgress?.({ percent: 30 });
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al obtener usuarios. (Revisa tus permisos)');
      setUsers(data.users || []);
      setRoles(data.roles || []);
      onLoadingProgress?.({ percent: 100, done: true });
    } catch (err) {
      onLoadingProgress?.({ active: false });
      setUsersError(err.message);
    } finally {
      setLoadingUsers(false);
    }
  }, [onLoadingProgress]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId, newRoleId) => {
    if (!isSupremo) return alert("Acción denegada: Solo el Admin Supremo puede cambiar roles.");
    if (!window.confirm('¿Estás seguro de que deseas cambiarle el rol a este usuario?')) return;
    
    onLoadingProgress?.({ percent: 20 });
    try {
      const user = users.find(u => u.id === userId);
      const needsAccount = user ? user.activo === 0 : false;

      const res = await fetch('/api/admin/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId: newRoleId, needsAccount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(data.message);
      fetchUsers(); 
    } catch (err) {
      onLoadingProgress?.({ active: false });
      alert('Error: ' + err.message);
    }
  };

  const handleResetPassword = async (userId, userName) => {
    if (!window.confirm(`ATENCIÓN: ¿Restablecer la contraseña de "${userName}"?\n\nSu nueva contraseña será su RUT (solo números y la letra K).`)) return;
    onLoadingProgress?.({ percent: 40 });
    try {
      const res = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onLoadingProgress?.({ percent: 100, done: true });
      alert(data.message);
    } catch (err) {
      onLoadingProgress?.({ active: false });
      alert('Error: ' + err.message);
    }
  };

  // --- ACCIONES MASIVAS (ZONA DE PELIGRO) ---
  const handleAssignAllAsUser = async () => {
    if (!isSupremo) return alert("Acción denegada: Solo el Admin Supremo puede ejecutar esta acción masiva.");

    const defaultRole = roles.find(r => r.nombre.toLowerCase() === 'usuario');
    const defaultRoleId = defaultRole ? defaultRole.id : 3;

    const allToChange = users.filter(u => String(u.id) !== String(adminUser?.id) && Number(u.rol_id) !== Number(defaultRoleId));
    const activeAdminsOnly = allToChange.filter(u => u.rol_id !== null);

    let targetUsers = activeAdminsOnly;

    if (allToChange.length > activeAdminsOnly.length) {
      const wantAll = window.confirm(
        `Hemos detectado ${activeAdminsOnly.length} administradores que pueden ser degradados, y ${allToChange.length - activeAdminsOnly.length} tripulantes nuevos que aún no ingresan al sistema.\n\n` +
        `¿Quieres aplicar el rol "Usuario" TAMBIÉN a los tripulantes nuevos?\n` +
        `(ADVERTENCIA: Esto creará sus cuentas automáticamente y tomará varios minutos).\n\n` +
        `Pulsa Aceptar para inicializar a TODOS. Pulsa Cancelar para degradar SOLO a los administradores actuales.`
      );
      if (wantAll) {
        targetUsers = allToChange;
      }
    }

    if (targetUsers.length === 0) {
      alert("No hay usuarios que necesiten ser modificados.");
      return;
    }

    if (!window.confirm(`Se modificará el rol de ${targetUsers.length} usuarios. Tú (${adminUser?.nombre}) quedarás intacto. ¿Continuar?`)) return;

    onLoadingProgress?.({ percent: 10 });
    setLoadingUsers(true);

    let completed = 0;
    
    for (const u of targetUsers) {
      try {
        await fetch('/api/admin/users/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: u.id, roleId: defaultRoleId, needsAccount: u.activo === 0 })
        });
      } catch (e) {
        console.error(`Error con usuario ${u.id}:`, e);
      }
      completed++;
      onLoadingProgress?.({ percent: 10 + Math.floor((completed / targetUsers.length) * 80) });
    }

    onLoadingProgress?.({ percent: 100, done: true });
    setLoadingUsers(false);
    alert(`✅ Operación masiva completada. Se actualizaron ${completed} usuarios al rol "Usuario".`);
    fetchUsers();
  };

  const handleResetAllPasswords = async () => {
    if (!isSupremo) return alert("Acción denegada: Solo el Admin Supremo puede ejecutar esta acción masiva.");

    // Solo podemos resetear contraseñas de usuarios que YA tienen una cuenta creada en MySQL (activo === 1)
    const targetUsers = users.filter(u => String(u.id) !== String(adminUser?.id) && u.activo === 1);

    if (targetUsers.length === 0) {
      alert("No hay usuarios activos en el sistema para restablecer sus contraseñas.");
      return;
    }

    if (!window.confirm(
      `⚠️ ATENCIÓN PELIGRO ⚠️\n\n` +
      `Vas a restablecer la contraseña de TODOS los usuarios activos (${targetUsers.length} personas).\n` +
      `Su nueva contraseña volverá a ser su RUT.\n\n` +
      `Tú (${adminUser?.nombre}) no te verás afectado.\n\n` +
      `¿Estás absolutamente seguro de continuar?`
    )) return;

    onLoadingProgress?.({ percent: 10 });
    setLoadingUsers(true);

    let completed = 0;
    
    for (const u of targetUsers) {
      try {
        await fetch('/api/admin/users/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: u.id })
        });
      } catch (e) {
        console.error(`Error reseteando clave de ${u.id}:`, e);
      }
      completed++;
      onLoadingProgress?.({ percent: 10 + Math.floor((completed / targetUsers.length) * 80) });
    }

    onLoadingProgress?.({ percent: 100, done: true });
    setLoadingUsers(false);
    alert(`✅ Reseteo masivo completado. Se forzó la contraseña a RUT a ${completed} usuarios.`);
  };

  // Filtrado y Paginación de usuarios
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return u.nombre.toLowerCase().includes(q) || 
           (u.email && u.email.toLowerCase().includes(q)) ||
           (u.rut && u.rut.toLowerCase().includes(q));
  });
  
  const usersToRender = filteredUsers.slice(0, visibleCount);

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in bg-gray-50 w-full">
      {/* Banner de Cabecera Responsivo */}
      <div className="bg-[#921E30] p-4 md:p-6 flex flex-row items-center gap-3 md:gap-4 relative overflow-hidden flex-shrink-0 shadow-md">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-10 blur-2xl pointer-events-none"></div>
        
        <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-white/20 border border-white/30 flex-shrink-0 flex items-center justify-center shadow-inner relative z-10 backdrop-blur-sm">
          <ShieldAlert className="w-6 h-6 md:w-8 md:h-8 text-white" />
        </div>
        
        <div className="relative z-10 min-w-0">
          <p className="text-white/70 text-[10px] md:text-xs font-bold tracking-wider uppercase mb-0.5 flex items-center gap-1.5">
            {isSupremo ? 'Modo Superusuario' : 'Modo Gestor'}
          </p>
          <h2 className="text-white text-xl md:text-2xl font-semibold tracking-wide truncate">
            Panel Admin
          </h2>
        </div>
      </div>

      {/* Navegación de Pestañas */}
      <div className="flex bg-white shadow-sm border-b border-gray-200 z-10 flex-shrink-0">
        <button 
          onClick={() => setActiveTab('sistema')} 
          className={`flex-1 py-3.5 text-xs md:text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'sistema' ? 'border-[#921E30] text-[#921E30]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
        >
          <Database className="w-4 h-4" /> Mantenimiento
        </button>
        <button 
          onClick={() => setActiveTab('usuarios')} 
          className={`flex-1 py-3.5 text-xs md:text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === 'usuarios' ? 'border-[#921E30] text-[#921E30]' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
        >
          <UserCog className="w-4 h-4" /> Usuarios
          <span className={`text-[9px] px-2 py-0.5 rounded-full border ml-1 ${isSupremo ? 'bg-red-100 text-[#921E30] border-red-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
            {isSupremo ? 'Supremo' : 'Gestor'}
          </span>
        </button>
      </div>

      {/* Contenedor Principal */}
      <main className="flex-1 overflow-y-auto scrollable-content pb-24 p-4 md:p-6 max-w-3xl mx-auto w-full">
        
        {/* PESTAÑA 1: MANTENIMIENTO DEL SISTEMA */}
        {activeTab === 'sistema' && (
          <div className="space-y-4 animate-fade-in">
            {message && (
              <div className={`p-4 mb-5 rounded-2xl border text-xs md:text-sm font-medium flex items-start gap-3 transition-all ${
                syncStatus === 'error' || dbStatus === 'error' 
                  ? 'bg-red-50 border-red-200 text-red-700' 
                  : 'bg-green-50 border-green-200 text-green-700'
              }`}>
                {syncStatus === 'loading' || dbStatus === 'loading' ? (
                  <RefreshCw className="w-4 h-4 md:w-5 h-5 animate-spin shrink-0 mt-0.5" />
                ) : syncStatus === 'error' || dbStatus === 'error' ? (
                  <ServerCrash className="w-4 h-4 md:w-5 h-5 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 md:w-5 h-5 shrink-0 mt-0.5" />
                )}
                <p className="leading-relaxed">{message}</p>
              </div>
            )}

            <div className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 p-2 rounded-xl text-blue-600">
                  <Users className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-800 text-base md:text-lg">Sincronizar Usuarios</h3>
              </div>
              <p className="text-xs md:text-sm text-gray-500 leading-relaxed sm:pl-11">
                Descarga la lista más reciente de trabajadores desde ControlDoc hacia tu base de datos MySQL local para permitirles iniciar sesión de manera offline o remota.
              </p>
              <div className="sm:pl-11 pt-1">
                <button 
                  onClick={handleSyncUsers}
                  disabled={syncStatus === 'loading' || loadingUsers}
                  className="w-full bg-[#394049] hover:bg-gray-800 active:scale-[0.99] text-white font-bold py-3 px-4 rounded-xl transition shadow-sm disabled:opacity-50 flex justify-center items-center gap-2 text-xs md:text-sm min-h-[44px]"
                >
                  {syncStatus === 'loading' ? (
                    <><RefreshCw className="w-4 h-4 animate-spin"/> Sincronizando...</>
                  ) : (
                    'Iniciar Sincronización'
                  )}
                </button>
              </div>
            </div>

            <div className="bg-white p-4 md:p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-purple-50 p-2 rounded-xl text-purple-600">
                  <Database className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-800 text-base md:text-lg">Mantenimiento de BD</h3>
              </div>
              <p className="text-xs md:text-sm text-gray-500 leading-relaxed sm:pl-11">
                Verifica y reestructura de forma segura que todas las tablas críticas existan. Útil si has migrado el servidor productivo o limpiado la base de datos.
              </p>
              <div className="sm:pl-11 pt-1">
                <button 
                  onClick={handleSetupDb}
                  disabled={dbStatus === 'loading' || loadingUsers}
                  className="w-full bg-white border-2 border-gray-200 hover:border-purple-300 text-gray-700 font-bold py-3 px-4 rounded-xl transition active:scale-[0.99] flex justify-center items-center gap-2 text-xs md:text-sm min-h-[44px]"
                >
                  Verificar Tablas
                </button>
              </div>
            </div>

            {/* ZONA DE PELIGRO (SOLO SUPREMO) - AHORA EN MANTENIMIENTO */}
            {isSupremo && (
              <div className="bg-[#111827] p-4 md:p-5 rounded-2xl shadow-lg border border-red-900/50 space-y-4 mt-6">
                <div className="flex items-center gap-3 border-b border-gray-800 pb-3">
                  <div className="bg-red-500/20 p-2 rounded-xl text-red-500">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-white text-base md:text-lg">Acciones Masivas (Peligro)</h3>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-bold text-red-400 text-sm">Degradar a todos a "Usuario"</h4>
                    <p className="text-xs text-gray-400 mt-1">Revoca permisos de administrador a terceros y asigna el rol básico a todos.</p>
                  </div>
                  <button 
                    onClick={handleAssignAllAsUser} 
                    disabled={loadingUsers || roles.length === 0} 
                    className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-sm transition-colors shrink-0 w-full sm:w-auto disabled:opacity-50"
                  >
                    Degradar a Usuario
                  </button>
                </div>

                <div className="w-full h-px bg-gray-800"></div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-bold text-red-400 text-sm">Restablecer todas las claves</h4>
                    <p className="text-xs text-gray-400 mt-1">Fuerza a todos los usuarios activos a usar su RUT como contraseña inicial.</p>
                  </div>
                  <button 
                    onClick={handleResetAllPasswords} 
                    disabled={loadingUsers || users.length === 0} 
                    className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-sm transition-colors shrink-0 w-full sm:w-auto disabled:opacity-50"
                  >
                    Claves a RUT
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PESTAÑA 2: GESTIÓN DE USUARIOS */}
        {activeTab === 'usuarios' && (
          <div className="space-y-4 animate-fade-in">
            {usersError ? (
              <div className="bg-red-50 text-red-700 p-4 rounded-2xl border border-red-200 flex items-start gap-3 shadow-sm">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm font-medium">{usersError}</p>
              </div>
            ) : (
              <>
                {/* BUSCADOR OSCURO PREMIUM (ESTILO AUTOCOMPLETADO) */}
                <div className="relative mb-6">
                  <div className="relative bg-[#0f172a] rounded-xl shadow-md border border-gray-800 focus-within:border-[#921E30] focus-within:ring-1 focus-within:ring-[#921E30] transition-all z-20">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type="text" 
                      placeholder="Buscar usuario por nombre, RUT o correo..." 
                      className="w-full bg-transparent pl-11 pr-10 py-3.5 text-sm text-white focus:outline-none placeholder-gray-500" 
                      value={searchQuery} 
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setIsAutocompleteOpen(true);
                      }} 
                      onFocus={() => setIsAutocompleteOpen(true)}
                    />
                    {searchQuery && (
                      <button 
                        type="button" 
                        onClick={() => { setSearchQuery(''); setIsAutocompleteOpen(false); }}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 hover:text-white transition-colors z-30"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Resultados Autocompletado */}
                  {isAutocompleteOpen && searchQuery && filteredUsers.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-[#0f172a] rounded-xl shadow-2xl border border-gray-800 max-h-64 overflow-y-auto scrollable-content">
                      {filteredUsers.slice(0, 8).map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            setSearchQuery(user.nombre); // Al hacer clic, filtra la lista de abajo
                            setIsAutocompleteOpen(false);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-gray-800 border-b border-gray-800/50 last:border-b-0 transition-colors"
                        >
                          <p className="text-sm font-semibold text-white truncate">{user.nombre}</p>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-400">
                            <span className="font-semibold text-[#ef4444]">
                              RUT: {user.rut || 'Sin RUT'}
                            </span>
                            <span className="truncate">Email: {user.email || 'Sin email'}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {isAutocompleteOpen && searchQuery && filteredUsers.length === 0 && !loadingUsers && (
                    <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-[#0f172a] rounded-xl shadow-2xl border border-gray-800 p-4 text-sm text-gray-400 text-center">
                      No se encontraron usuarios con esos datos.
                    </div>
                  )}
                </div>

                {loadingUsers ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin text-[#921E30] mb-2" />
                    <p className="text-xs font-medium uppercase tracking-wider">Cargando Usuarios...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {usersToRender.map(user => (
                      <div key={user.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3 hover:shadow-md transition">
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 pr-2">
                            <h4 className="font-bold text-gray-800 text-sm truncate">{user.nombre}</h4>
                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                          </div>
                          <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md shrink-0 border border-gray-200">
                            ID: {user.id}
                          </span>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-gray-50">
                          <div className="flex-1">
                            {/* Si es Supremo muestra el selector, si es Gestor solo muestra texto */}
                            {isSupremo ? (
                              <select 
                                value={user.rol_id || ''} 
                                onChange={(e) => handleRoleChange(user.id, e.target.value)}
                                className="w-full text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#921E30]"
                              >
                                <option value="" disabled>Sin rol asignado (Pendiente)</option>
                                {roles.map(r => (
                                  <option key={r.id} value={r.id}>{r.nombre}</option>
                                ))}
                              </select>
                            ) : (
                              <div className="w-full text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 flex items-center h-full">
                                {user.rol_nombre ? `Rol: ${user.rol_nombre}` : 'Sin rol asignado (Pendiente)'}
                              </div>
                            )}
                          </div>
                          
                          <button 
                            onClick={() => handleResetPassword(user.id, user.nombre)} 
                            className="text-[11px] font-bold bg-white hover:bg-red-50 hover:text-red-700 text-gray-700 border border-gray-200 hover:border-red-200 px-3 py-2.5 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-colors"
                          >
                            <Key className="w-3.5 h-3.5 mr-1.5 opacity-70" /> Clave a RUT
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {visibleCount < filteredUsers.length && (
                      <div className="text-center py-4">
                        <button 
                          onClick={() => setVisibleCount(v => v + 50)}
                          className="bg-white border border-gray-200 text-[#921E30] px-6 py-2.5 rounded-xl text-xs font-bold shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        >
                          Cargar más usuarios... ({filteredUsers.length - visibleCount} restantes)
                        </button>
                      </div>
                    )}

                    {filteredUsers.length === 0 && !loadingUsers && (
                      <div className="text-center py-10 bg-white border border-gray-100 rounded-2xl shadow-sm">
                        <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No se encontraron usuarios.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
};//fgh
