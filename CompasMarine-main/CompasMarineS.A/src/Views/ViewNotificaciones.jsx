import { useState } from 'react';
import { X, Hand, AlertTriangle, Clock, BellRing, Loader2, Send } from 'lucide-react';
import { enablePushNotifications, sendTestPushNotification } from '../pwa/pushNotifications';
import { runCachedNotificationRules } from '../pwa/notificationRules';

export const ViewNotificaciones = ({ setView }) => {
  const [notificationStatus, setNotificationStatus] = useState('idle');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [testStatus, setTestStatus] = useState('idle');

  const handleEnableNotifications = async () => {
    setNotificationStatus('loading');
    setTestStatus('idle');
    setNotificationMessage('');

    try {
      const mode = await enablePushNotifications();
      const summary = await runCachedNotificationRules();
      setNotificationStatus('enabled');
      setNotificationMessage(
        `${mode === 'push' ? 'Avisos push activos.' : 'Avisos locales activos.'} ${
          summary.shown > 0 ? 'Se enviaron avisos pendientes.' : 'Reglas revisadas.'
        }`
      );
    } catch (error) {
      setNotificationStatus('error');
      setNotificationMessage(error.message);
    }
  };

  const handleSendTestNotification = async () => {
    setTestStatus('loading');
    setNotificationStatus((currentStatus) => currentStatus === 'error' ? 'idle' : currentStatus);
    setNotificationMessage('');

    try {
      await sendTestPushNotification();
      setTestStatus('sent');
      setNotificationMessage('Notificacion push de prueba enviada.');
    } catch (error) {
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

        <div className="bg-white rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-[#921E30]"></div>
          <div className="flex gap-4">
            <div className="bg-red-100 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
              <AlertTriangle className="w-5 h-5 text-[#921E30]" />
            </div>
            <div>
              <h4 className="font-bold text-gray-800 bg-white inline-block mb-1">Alerta de Documento</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                El documento <span className="font-semibold text-[#394049]">Pasaporte Marítimo</span> necesita tu atención.
              </p>
              <button 
                onClick={() => setView('documentos')}
                className="mt-3 text-xs bg-[#921E30] text-white px-4 py-1.5 rounded-full font-medium shadow hover:bg-red-800 transition"
              >
                Ver Documento
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
