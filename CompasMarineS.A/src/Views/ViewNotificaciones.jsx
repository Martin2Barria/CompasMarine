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
      setNotificationMessage('Notificacion push de prueba enviada.');
    } catch (error) {
      onLoadingProgress?.({ active: false });
      setTestStatus('error');
      setNotificationMessage(error.message);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] p-5 flex justify-between items-center shadow-md relative z-10 flex-shrink-0">
        <h2 className="text-white text-xl font-semibold tracking-wide">Notificaciones</h2>
        <button 
          onClick={() => setView('inicio')}
          className="bg-white text-[#394049] rounded-full w-7 h-7 flex items-center justify-center font-bold hover:bg-gray-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-200 p-4 space-y-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-[#394049]"></div>
          <div className="flex gap-4 items-start">
                  {/* arreglo visual al entrar en modo oscuro */}
            <div className="notification-badge-icon flex items-center justify-center flex-shrink-0 mt-1">
              <BellRing className="icon-element" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-800 bg-white inline-block mb-2">Avisos de documentos</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleEnableNotifications}
                  disabled={notificationStatus === 'loading'}
                  className="bg-[#394049] text-white text-xs px-4 py-2 rounded-full font-medium shadow hover:bg-gray-700 transition disabled:opacity-70 flex items-center"
                >
                  {notificationStatus === 'loading' && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                  Activar avisos
                </button>
                <button
                  onClick={handleSendTestNotification}
                  disabled={testStatus === 'loading'}
                  className="bg-[#921E30] text-white text-xs px-4 py-2 rounded-full font-medium shadow hover:bg-red-800 transition disabled:opacity-70 flex items-center"
                >
                  {testStatus === 'loading' ? (
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3 mr-2" />
                  )}
                  Probar push
                </button>
              </div>
              {notificationMessage && (
                <p className={`text-xs mt-3 ${notificationStatus === 'error' || testStatus === 'error' ? 'text-[#921E30]' : 'text-green-700'}`}>
                  {notificationMessage}
                </p>
              )}
              {emailStatus !== 'idle' && (
                <p className={`text-xs mt-2 flex items-center gap-1 ${emailStatus === 'sent' ? 'text-green-700' : 'text-amber-700'}`}>
                  <Mail className="w-3 h-3" />
                  {emailStatus === 'sent' ? 'Resumen enviado al correo del usuario.' : 'Correo pendiente: falta configurar proveedor de email.'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-[#921E30]"></div>
          <div className="flex gap-4">
            <div className="bg-red-100 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
              <AlertTriangle className="w-5 h-5 text-[#921E30]" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-bold text-gray-800 bg-white inline-block mb-2">Registro de alertas</h4>
              {alerts.length === 0 ? (
                <p className="text-sm text-gray-600 leading-relaxed">
                  No hay alertas documentales registradas por ahora.
                </p>
              ) : (
                <div className="space-y-3">
                  {alerts.slice(0, 20).map((alert) => (
                    <div key={alert.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#394049] truncate">{alert.docName}</p>
                          <p className="text-xs text-gray-600 mt-1">{alert.body}</p>
                        </div>
                        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${getSeverityClass(alert.severity)}`}>
                          {getSeverityLabel(alert.severity)}
                        </span>
                      </div>
                      <button
                        onClick={() => setView('documentos')}
                        className="mt-3 text-xs bg-[#921E30] text-white px-4 py-1.5 rounded-full font-medium shadow hover:bg-red-800 transition"
                      >
                        Ver Documento
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-green-500"></div>
          <div className="flex gap-4">
            <div className="bg-green-100 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
              <Hand className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 bg-white inline-block mb-1">Bienvenido a Compas Marine</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                Esperamos y disfrutes tu instancia con nuestros servicios.
              </p>
              <span className="text-[10px] text-gray-400 mt-2 flex items-center">
                <Clock className="w-3 h-3 mr-1" /> Hace 2 horas
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
  if (severity === 'critical') return '30 dias';
  return '60 dias';
}

function getSeverityClass(severity) {
  if (severity === 'expired') return 'bg-red-100 text-[#921E30]';
  if (severity === 'critical') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}
