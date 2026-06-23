import React, { useState } from 'react';
import { ShieldAlert, Database, RefreshCw, Users, ServerCrash, CheckCircle2 } from 'lucide-react';

export const ViewAdmin = () => {
  const [syncStatus, setSyncStatus] = useState(null); // 'loading', 'success', 'error'
  const [dbStatus, setDbStatus] = useState(null);
  const [message, setMessage] = useState('');

  const handleSyncUsers = async () => {
    setSyncStatus('loading');
    setMessage('Descargando usuarios desde ControlDoc. Esto puede tomar un minuto...');
    try {
      const res = await fetch('/api/admin/sync-users');
      const data = await res.json();
      if (res.ok) {
        setSyncStatus('success');
        setMessage(data.message || 'Sincronización completada con éxito.');
      } else {
        throw new Error(data.error || 'Fallo desconocido');
      }
    } catch (err) {
      setSyncStatus('error');
      setMessage(err.message);
    }
  };

  const handleSetupDb = async () => {
    if (!window.confirm('¿Estás seguro? Esto verificará y recreará las tablas necesarias en MySQL.')) return;
    
    setDbStatus('loading');
    try {
      const res = await fetch('/api/admin/setup-db');
      const data = await res.json();
      if (res.ok) {
        setDbStatus('success');
        setMessage(data.message || 'Tablas configuradas correctamente.');
      } else {
        throw new Error(data.error || 'Fallo desconocido');
      }
    } catch (err) {
      setDbStatus('error');
      setMessage(err.message);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in bg-gray-50">
      <div className="bg-[#921E30] p-6 flex flex-row items-center gap-4 relative overflow-hidden flex-shrink-0 shadow-lg">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-10 blur-2xl pointer-events-none"></div>
        <div className="w-16 h-16 rounded-2xl bg-white/20 border border-white/30 flex-shrink-0 flex items-center justify-center shadow-inner relative z-10 backdrop-blur-sm">
          <ShieldAlert className="w-8 h-8 text-white" />
        </div>
        <div className="relative z-10">
          <p className="text-white/80 text-xs font-bold tracking-wider uppercase mb-1">
            Modo Superusuario
          </p>
          <h2 className="text-white text-2xl font-semibold tracking-wide">
            Panel Admin
          </h2>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 p-6">
        
        {message && (
          <div className={`p-4 mb-6 rounded-xl border text-sm font-medium flex items-start gap-3 ${
            syncStatus === 'error' || dbStatus === 'error' 
              ? 'bg-red-50 border-red-200 text-red-700' 
              : 'bg-green-50 border-green-200 text-green-700'
          }`}>
            {syncStatus === 'loading' || dbStatus === 'loading' ? (
              <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
            ) : syncStatus === 'error' || dbStatus === 'error' ? (
              <ServerCrash className="w-5 h-5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            )}
            <p>{message}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-bold text-gray-800 text-lg">Sincronizar Usuarios</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4 pl-11">
              Descarga la lista más reciente de trabajadores desde ControlDoc hacia tu base de datos MySQL local para permitirles iniciar sesión.
            </p>
            <button 
              onClick={handleSyncUsers}
              disabled={syncStatus === 'loading'}
              className="w-full bg-[#394049] hover:bg-gray-800 text-white font-bold py-3 px-4 rounded-xl transition shadow-md disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {syncStatus === 'loading' ? <><RefreshCw className="w-4 h-4 animate-spin"/> Procesando...</> : 'Iniciar Sincronización'}
            </button>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-purple-100 p-2 rounded-lg">
                <Database className="w-5 h-5 text-purple-600" />
              </div>
              <h3 className="font-bold text-gray-800 text-lg">Mantenimiento de BD</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4 pl-11">
              Verifica que todas las tablas existan. Útil si has migrado el servidor o borrado la base de datos por accidente.
            </p>
            <button 
              onClick={handleSetupDb}
              disabled={dbStatus === 'loading'}
              className="w-full bg-white border-2 border-gray-200 hover:border-purple-300 text-gray-700 font-bold py-3 px-4 rounded-xl transition flex justify-center items-center gap-2"
            >
              Verificar Tablas
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};