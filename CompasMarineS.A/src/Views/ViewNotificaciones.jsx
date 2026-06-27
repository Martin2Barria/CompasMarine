import { useEffect, useState } from 'react';
import { X, Hand, AlertTriangle, Clock, BellRing, Loader2, Send, Mail } from 'lucide-react';
import { enablePushNotifications, sendEmailAlertDigest, sendTestPushNotification } from '../pwa/pushNotifications';
import { getCachedNotificationRecords, runCachedNotificationRules } from '../pwa/notificationRules';
import { getUserSnapshotKey } from '../auth/userScope';

export const ViewNotificaciones = ({ setView, currentUser, onLoadingProgress }) => {
  const [notificationStatus, setNotificationStatus] = useState('idle');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [testStatus, setTestStatus] = useState('idle');
  const [emailStatus, setEmailStatus] = useState('idle');
  const [alerts, setAlerts] = useState([]);
  const snapshotOwnerKey = getUserSnapshotKey(currentUser);

  useEffect(() => {
    let isCancelled = false;

    getCachedNotificationRecords(snapshotOwnerKey).then((records) => {
      if (!isCancelled) setAlerts(records);
    });

    return () => {
      isCancelled = true;
    };
  }, [snapshotOwnerKey]);

  const handleEnableNotifications = async () => {
    setNotificationStatus('loading');
    setTestStatus('idle');
    setNotificationMessage('');
    onLoadingProgress?.({ percent: 14 });

    try {
      const mode = await enablePushNotifications();
      onLoadingProgress?.({ percent: 72 });
      const summary = await runCachedNotificationRules(snapshotOwnerKey);
      const nextAlerts = await getCachedNotificationRecords(snapshotOwnerKey);
      setAlerts(nextAlerts);
      try {
        if (nextAlerts.length > 0) {
          await sendEmailAlertDigest(nextAlerts);
          setEmailStatus('sent');
        }
      } catch (emailError) {
        setEmailStatus('error');
        console.warn('No se pudo enviar correo de alertas:', emailError);
      }
      onLoadingProgress?.({ percent: 100, done: true });
      setNotificationStatus('enabled');
      setNotificationMessage(
        `${mode === 'push' ? 'Avisos push activos.' : 'Avisos locales activos.'} ${
          summary.shown > 0 ? 'Se enviaron avisos pendientes.' : 'Reglas revisadas.'
        }`
      );
    } catch (error) {
      onLoadingProgress?.({ active: false });
      setNotificationStatus('error');
      setNotificationMessage(error.message);
    }
  };

  const handleSendTestNotification = async () => {
    setTestStatus('loading');
    setNotificationStatus((currentStatus) => currentStatus === 'error' ? 'idle' : currentStatus);
    setNotificationMessage('');
    onLoadingProgress?.({ percent: 25 });

    try {
      await sendTestPushNotification();
      onLoadingProgress?.({ percent: 100, done: true });
      setTestStatus('sent');
      setNotificationMessage('Notificación push de prueba enviada.');
    } catch (error) {
      onLoadingProgress?.({ active: false });
      setTestStatus('error');
      setNotificationMessage(error.message);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in w-full">
      {/* Navbar de Notificaciones */}
      <div className="bg-[#394049] p-4 md:p-5 flex justify-between items-center shadow-md relative z-10 flex-shrink-0">
        <h2 className="text-white text-lg md:text-xl font-semibold tracking-wide">Notificaciones</h2>
        <button 
          onClick={() => setView('inicio')}
          className="bg-white text-[#394049] rounded-full w-8 h-8 flex items-center justify-center font-bold hover:bg-gray-100 active:bg-gray-200 transition-colors shadow-sm"
          aria-label="Cerrar notificaciones"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Contenedor Principal */}
      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-4 max-w-4xl mx-auto w-full space-y-4">
        
        {/* Card: Configuración de Alertas PWA */}
        <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm relative overflow-hidden border border-gray-100">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#394049]"></div>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="bg-gray-100 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[#394049]">
              <BellRing className="w-5 h-5" />
            </div>
            <div className="flex-1 w-full">
              <h4 className="font-bold text-gray-800 text-sm md:text-base mb-1">Avisos de documentos</h4>
              <p className="text-xs text-gray-400 mb-3.5 leading-normal">Mantente al día con los vencimientos importantes activando las alertas push en tu dispositivo.</p>
              
              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <button
                  onClick={handleEnableNotifications}
                  disabled={notificationStatus === 'loading'}
                  className="bg-[#394049] text-white text-xs px-5 py-2.5 rounded-xl font-bold shadow-sm hover:bg-gray-700 active:bg-gray-800 transition disabled:opacity-70 flex items-center justify-center min-h-[40px] sm:min-h-0"
                >
                  {notificationStatus === 'loading' && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                  Activar avisos
                </button>
                <button
                  onClick={handleSendTestNotification}
                  disabled={testStatus === 'loading'}
                  className="bg-[#921E30] text-white text-xs px-5 py-2.5 rounded-xl font-bold shadow-sm hover:bg-red-800 active:bg-red-900 transition disabled:opacity-70 flex items-center justify-center min-h-[40px] sm:min-h-0"
                >
                  {testStatus === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 mr-2" />
                  )}
                  Probar push
                </button>
              </div>

              {notificationMessage && (
                <p className={`text-xs font-semibold mt-3 p-2.5 rounded-lg bg-opacity-10 ${notificationStatus === 'error' || testStatus === 'error' ? 'text-[#921E30] bg-[#921E30]/5' : 'text-green-700 bg-green-50'}`}>
                  {notificationMessage}
                </p>
              )}
              {emailStatus !== 'idle' && (
                <p className={`text-xs mt-2.5 flex items-center gap-1.5 font-medium ${emailStatus === 'sent' ? 'text-green-700' : 'text-amber-700'}`}>
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span>{emailStatus === 'sent' ? 'Resumen enviado al correo del usuario.' : 'Correo pendiente: falta configurar proveedor de email.'}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Card: Historial / Registro de Alertas */}
        <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm relative overflow-hidden border border-gray-100">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#921E30]"></div>
          <div className="flex gap-4 items-start">
            <div className="bg-red-50 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-[#921E30]" />
            </div>
            <div className="min-w-0 flex-1 w-full">
              <h4 className="font-bold text-gray-800 text-sm md:text-base mb-2">Registro de alertas</h4>
              {alerts.length === 0 ? (
                <p className="text-xs md:text-sm text-gray-500 leading-relaxed mt-1">
                  No hay alertas documentales registradas por ahora.
                </p>
              ) : (
                <div className="space-y-3 mt-3">
                  {alerts.slice(0, 20).map((alert) => (
                    <div key={alert.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 md:p-4 transition-all">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-[#394049] truncate">{alert.docName}</p>
                          <p className="text-xs text-gray-600 mt-1.5 leading-normal">{alert.body}</p>
                        </div>
                        <span className={`self-start shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full text-center ${getSeverityClass(alert.severity)}`}>
                          {getSeverityLabel(alert.severity)}
                        </span>
                      </div>
                      <div className="mt-3.5 pt-1 border-t border-gray-200/40">
                        <button
                          onClick={() => setView('documentos')}
                          className="w-full sm:w-auto text-center text-xs bg-[#921E30] text-white px-5 py-2 rounded-xl font-bold shadow-sm hover:bg-red-800 active:bg-red-900 transition min-h-[36px] sm:min-h-0"
                        >
                          Ver Documento
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card: Saludo Estático de Bienvenida */}
        <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm relative overflow-hidden border border-gray-100">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-green-500"></div>
          <div className="flex gap-4 items-start">
            <div className="bg-green-50 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <Hand className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-gray-800 text-sm md:text-base mb-1">Bienvenido a Compas Marine</h4>
              <p className="text-xs md:text-sm text-gray-500 leading-relaxed">
                Esperamos que disfrutes tu instancia con nuestros servicios integrales de gestión marina.
              </p>
              <span className="text-[10px] font-semibold text-gray-400 mt-3 flex items-center gap-1">
                <Clock className="w-3 h-3 shrink-0" /> Hace 2 horas
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

function getSeverityLabel(severity) {
  if (severity === 'expired') return 'Vencido';
  if (severity === 'critical') return '30 días';
  return '60 días';
}

function getSeverityClass(severity) {
  if (severity === 'expired') return 'bg-red-100 text-[#921E30] border border-red-200/50';
  if (severity === 'critical') return 'bg-amber-100 text-amber-700 border border-amber-200/50';
  return 'bg-blue-100 text-blue-700 border border-blue-200/50';
}