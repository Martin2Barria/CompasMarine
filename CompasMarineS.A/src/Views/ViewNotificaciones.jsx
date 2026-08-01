import { useCallback, useEffect, useState } from 'react';
import { X, Hand, AlertTriangle, Clock, BellRing, Loader2, Send, Mail } from 'lucide-react';
import {
  enablePushNotifications,
  fetchEmailNotificationHistory,
  fetchPushNotificationHistory,
  getNotificationPermissionState,
  getPushNotificationStatus,
  PUSH_STATUS_CHANGED_EVENT,
  sendTestPushNotification
} from '../pwa/pushNotifications';
import { getCachedNotificationRecords } from '../pwa/notificationRules';
import { getUserSnapshotKey } from '../auth/userScope';

export const ViewNotificaciones = ({ setView, currentUser, onLoadingProgress }) => {
  const [notificationStatus, setNotificationStatus] = useState('idle');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [testStatus, setTestStatus] = useState('idle');
  const [alerts, setAlerts] = useState([]);
  const [showGuideNotif, setShowGuideNotif] = useState(true);
  const [pushStatus, setPushStatus] = useState({
    supported: getNotificationPermissionState() !== 'unsupported',
    permission: getNotificationPermissionState(),
    active: false
  });
  const snapshotOwnerKey = getUserSnapshotKey(currentUser);
  const permissionState = pushStatus.permission;
  const canTestPush = pushStatus.active && permissionState === 'granted';

  const loadAlertHistory = useCallback(async () => {
    const [records, emailEvents, pushEvents] = await Promise.all([
      getCachedNotificationRecords(snapshotOwnerKey),
      fetchEmailNotificationHistory().catch(() => []),
      fetchPushNotificationHistory().catch(() => [])
    ]);
    const recordsById = new Map(records.map((record) => [record.id, record]));

    pushEvents.forEach((event) => {
      if (!event.eventId) return;
      const previous = recordsById.get(event.eventId) || {};
      recordsById.set(event.eventId, {
        id: event.eventId,
        type: event.group === 'signature' ? 'signature' : 'document',
        severity: event.group,
        group: event.group,
        threshold: event.threshold,
        title: event.title,
        body: event.body,
        docName: event.docName,
        expirationDate: event.expirationDate,
        daysRemaining: event.daysRemaining,
        createdAt: event.sentAt,
        ...previous,
        pushSentAt: event.lastSentAt || event.sentAt
      });
    });

    const sentByEventId = new Map(emailEvents.map((event) => [event.eventId, event.sentAt]));
    const mergedRecords = [...recordsById.values()]
      .map((record) => ({
        ...record,
        emailSentAt: sentByEventId.get(record.id) || record.emailSentAt || null
      }))
      .sort((a, b) => getAlertRecordTime(b) - getAlertRecordTime(a));

    setAlerts(mergedRecords);
  }, [snapshotOwnerKey]);

  const refreshPushStatus = useCallback(async () => {
    setPushStatus(await getPushNotificationStatus());
  }, []);

  useEffect(() => {
    void loadAlertHistory();
    void refreshPushStatus();

    const handleStatusChanged = (event) => {
      if (event.detail) setPushStatus((current) => ({ ...current, ...event.detail }));
      else void refreshPushStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshPushStatus();
    };
    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type !== 'compas:push-received') return;
      window.setTimeout(() => void loadAlertHistory(), 800);
    };

    window.addEventListener(PUSH_STATUS_CHANGED_EVENT, handleStatusChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      window.removeEventListener(PUSH_STATUS_CHANGED_EVENT, handleStatusChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [loadAlertHistory, refreshPushStatus]);

  const handleEnableNotifications = async () => {
    setNotificationStatus('loading');
    setTestStatus('idle');
    setNotificationMessage('');
    onLoadingProgress?.({ percent: 14 });

    try {
      await enablePushNotifications();
      onLoadingProgress?.({ percent: 72 });
      await Promise.all([refreshPushStatus(), loadAlertHistory()]);
      onLoadingProgress?.({ percent: 100, done: true });
      setNotificationStatus('enabled');
      setNotificationMessage('Avisos push activos en este celular. Llegarán aunque la app esté cerrada o el teléfono esté bloqueado, según la configuración del sistema.');
    } catch (error) {
      onLoadingProgress?.({ active: false });
      await refreshPushStatus();
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
      setPushStatus((current) => ({ ...current, active: false }));
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
        
        {/* Guía breve para Notificaciones */}
        {showGuideNotif && (
          <div 
            onClick={() => setShowGuideNotif(false)}
            className="bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 p-2.5 rounded-lg text-xs font-medium flex items-center justify-between cursor-pointer transition-all hover:bg-zinc-200 dark:hover:bg-zinc-800 select-none"
            title="Haz clic para descartar"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0">ℹ️</span>
                <span className="leading-snug break-words">🔔 Activa las notificaciones push de este celular para recibir alertas aunque la app esté cerrada. El sistema revisa 60 días cada 5 días, 30 días cada día y 1 día cada 6 horas.</span>
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold ml-2 shrink-0">✕</span>
          </div>
        )}
        
        {/* Card: Configuración de Alertas PWA */}
        <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm relative overflow-hidden border border-gray-100">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#394049]"></div>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="bg-gray-200 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-gray-800">
              <BellRing className="w-5 h-5" />
            </div>
            <div className="flex-1 w-full">
              <h4 className="font-bold text-gray-800 text-sm md:text-base mb-1">Avisos de documentos</h4>
              <p className="text-xs text-gray-400 mb-3.5 leading-normal">
                Al entrar a la aplicación se intenta activar este celular. Si el navegador exige una acción manual, usa el botón de activación.
              </p>
              
              <div className="w-full">
                <button
                  onClick={canTestPush ? handleSendTestNotification : handleEnableNotifications}
                  disabled={testStatus === 'loading' || notificationStatus === 'loading'}
                  className={`w-full sm:w-auto text-white text-xs px-5 py-2.5 rounded-xl font-bold shadow-sm transition disabled:opacity-70 flex items-center justify-center min-h-[40px] sm:min-h-0 ${canTestPush ? 'bg-[#921E30] hover:bg-red-800 active:bg-red-900' : 'bg-[#394049] hover:bg-gray-700 active:bg-gray-800'}`}
                >
                  {testStatus === 'loading' || notificationStatus === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  ) : canTestPush ? (
                    <Send className="w-3.5 h-3.5 mr-2" />
                  ) : (
                    <BellRing className="w-3.5 h-3.5 mr-2" />
                  )}
                  {canTestPush ? 'Probar push' : 'Activar notificaciones'}
                </button>
              </div>

              {notificationMessage && (
                <p className={`text-xs font-semibold mt-3 p-2.5 rounded-lg bg-opacity-10 ${notificationStatus === 'error' || testStatus === 'error' ? 'text-[#921E30] bg-[#921E30]/5' : 'text-green-700 bg-green-50'}`}>
                  {notificationMessage}
                </p>
              )}
              {permissionState === 'denied' && (
                <p className="text-xs text-amber-700 bg-amber-50 mt-3 p-2.5 rounded-lg leading-relaxed">
                  El navegador bloqueó el permiso. Abre los ajustes del sitio desde el ícono de candado o configuración de la barra de direcciones, permite “Notificaciones” y vuelve a pulsar este botón. Una web no puede activar un permiso bloqueado sin tu autorización.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Card: Historial / Registro de Alertas */}
        <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm relative overflow-hidden border border-gray-100">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#921E30]"></div>
          <div className="flex gap-4 items-start">
            <div className="severity-pill-red w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
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
                    <div key={alert.id} className="notification-record-card rounded-xl border border-gray-100 p-3 md:p-4 transition-all">
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
                        {alert.emailSentAt && (
                          <p className="text-[10px] text-green-700 font-semibold mb-2 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> Correo enviado por el sistema
                          </p>
                        )}
                        {alert.pushSentAt && (
                          <p className="text-[10px] text-blue-700 font-semibold mb-2 flex items-center gap-1">
                            <BellRing className="w-3 h-3" /> Notificación enviada el {formatNotificationTimestamp(alert.pushSentAt)}
                          </p>
                        )}
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
  if (severity === 'urgent') return 'Expira pronto';
  if (severity === 'signature') return 'Firma pendiente';
  return 'Por vencer';
}

function getSeverityClass(severity) {
  if (severity === 'expired') return 'severity-pill-red border';
  if (severity === 'urgent') return 'severity-pill-red border';
  if (severity === 'critical') return 'severity-pill-orange border';
  if (severity === 'signature') return 'severity-pill-amber border';
  return 'severity-pill-amber border';
}

function getAlertRecordTime(record) {
  const value = record?.pushSentAt || record?.emailSentAt || record?.createdAt;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNotificationTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'fecha no disponible';

  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
