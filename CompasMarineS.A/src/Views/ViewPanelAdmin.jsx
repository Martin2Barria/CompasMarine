import { useState } from 'react';
import { ShieldAlert, Database, RefreshCw, Users, ServerCrash, CheckCircle2 } from 'lucide-react';

export const ViewAdmin = ({ onLoadingProgress }) => {
  const [syncStatus, setSyncStatus] = useState(null); // 'loading', 'success', 'error'
  const [dbStatus, setDbStatus] = useState(null);
  const [message, setMessage] = useState('');

  const startProgressTicker = (initialPercent = 10) => {
    let currentPercent = initialPercent;
    onLoadingProgress?.({ percent: currentPercent });

    return window.setInterval(() => {
      currentPercent = Math.min(92, currentPercent + (currentPercent < 60 ? 8 : 3));
      onLoadingProgress?.({ percent: currentPercent });
    }, 700);
  };

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

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in bg-gray-50 w-full">
      {/* Banner de Cabecera Responsivo */}
      <div className="bg-[#921E30] p-4 md:p-6 flex flex-row items-center gap-3 md:gap-4 relative overflow-hidden flex-shrink-0 shadow-md">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-10 blur-2xl pointer-events-none"></div>
        
        {/* Ícono Ajustado */}
        <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-white/20 border border-white/30 flex-shrink-0 flex items-center justify-center shadow-inner relative z-10 backdrop-blur-sm">
          <ShieldAlert className="w-6 h-6 md:w-8 md:h-8 text-white" />
        </div>
        
        <div className="relative z-10 min-w-0">
          <p className="text-white/70 text-[10px] md:text-xs font-bold tracking-wider uppercase mb-0.5">
            Modo Superusuario
          </p>
          <h2 className="text-white text-xl md:text-2xl font-semibold tracking-wide truncate">
            Panel Admin
          </h2>
        </div>
      </div>

      {/* Contenedor Principal */}
      <main className="flex-1 overflow-y-auto scrollable-content pb-24 p-4 md:p-6 max-w-3xl mx-auto w-full">
        
        {/* Banner de Mensajes Dinámicos */}
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

        {/* Tarjetas de Operaciones */}
        <div className="space-y-4">
          
          {/* Card: Sincronización */}
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
                disabled={syncStatus === 'loading'}
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

          {/* Card: Base de Datos */}
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
                disabled={dbStatus === 'loading'}
                className="w-full bg-white border-2 border-gray-200 hover:border-purple-300 text-gray-700 font-bold py-3 px-4 rounded-xl transition active:scale-[0.99] flex justify-center items-center gap-2 text-xs md:text-sm min-h-[44px]"
              >
                Verificar Tablas
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};