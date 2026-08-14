import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, X } from 'lucide-react';
import {
  enablePushNotifications,
  getPushNotificationStatus,
  PUSH_STATUS_CHANGED_EVENT
} from '../pwa/pushNotifications';

export function PushActivationPrompt({ enabled }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [message, setMessage] = useState('');

  const refreshStatus = useCallback(async () => {
    const nextStatus = await getPushNotificationStatus();
    setStatus(nextStatus);
    if (nextStatus.active) setDismissed(false);
    return nextStatus;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setDismissed(false);
      setMessage('');
      return undefined;
    }

    void refreshStatus();

    const handleStatusChanged = (event) => {
      if (event.detail) setStatus((current) => ({ ...current, ...event.detail }));
      else void refreshStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };

    window.addEventListener(PUSH_STATUS_CHANGED_EVENT, handleStatusChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener(PUSH_STATUS_CHANGED_EVENT, handleStatusChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, refreshStatus]);

  if (!enabled || !status || status.active || dismissed) return null;

  const permissionDenied = status.permission === 'denied';
  const unsupported = !status.supported;

  const handleActivate = async () => {
    setIsActivating(true);
    setMessage('');
    try {
      await enablePushNotifications();
      await refreshStatus();
    } catch (error) {
      await refreshStatus();
      setMessage(error.message);
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div className="fixed inset-x-3 top-3 z-50 mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#394049] text-white">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[#394049]">Activa las notificaciones</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            {permissionDenied
              ? 'El permiso está bloqueado. Permite las notificaciones desde los ajustes del sitio y vuelve a intentarlo.'
              : unsupported
                ? 'Este navegador o este modo de apertura no admite notificaciones push.'
                : 'Actívalas una sola vez para recibir avisos de tus documentos. El navegador conservará el permiso en este dispositivo.'}
          </p>
          {message && <p className="mt-2 text-xs font-semibold text-[#921E30]">{message}</p>}
          {!unsupported && (
            <button
              type="button"
              onClick={handleActivate}
              disabled={isActivating}
              className="mt-3 inline-flex min-h-[38px] items-center justify-center rounded-xl bg-[#921E30] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-red-800 disabled:opacity-60"
            >
              {isActivating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <BellRing className="mr-2 h-3.5 w-3.5" />}
              {permissionDenied ? 'Volver a comprobar' : 'Activar notificaciones'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          aria-label="Cerrar aviso de notificaciones"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
