import { useEffect, useState } from 'react';
import { Download, Share2, Smartphone, X } from 'lucide-react';

const DISMISSED_KEY = 'compas:pwa-install-dismissed-at:v1';

export const PwaInstallPrompt = ({ className = '' }) => {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => isRunningStandalone());
  const [isDismissed, setIsDismissed] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(() => isMobileOrTabletDevice());
  const [showManualSteps, setShowManualSteps] = useState(false);
  const isManualInstall = !installPrompt;
  const shouldShow = isMobileDevice && !isInstalled && !isDismissed;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const refreshInstallState = () => {
      const nextInstalled = isRunningStandalone();
      setIsInstalled(nextInstalled);
      setIsMobileDevice(isMobileOrTabletDevice());
      if (!nextInstalled) {
        setIsDismissed(false);
        window.localStorage.removeItem(DISMISSED_KEY);
      }
    };
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setIsDismissed(false);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      window.localStorage.removeItem(DISMISSED_KEY);
    };

    refreshInstallState();
    mediaQuery.addEventListener('change', refreshInstallState);
    window.addEventListener('focus', refreshInstallState);
    document.addEventListener('visibilitychange', refreshInstallState);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener('change', refreshInstallState);
      window.removeEventListener('focus', refreshInstallState);
      document.removeEventListener('visibilitychange', refreshInstallState);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('pwa-install-prompt-visible', shouldShow);
    return () => document.documentElement.classList.remove('pwa-install-prompt-visible');
  }, [shouldShow]);

  if (!shouldShow) return null;

  const handleInstall = async () => {
    if (!installPrompt) {
      setShowManualSteps((current) => !current);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);

    if (choice?.outcome === 'accepted') {
      setIsInstalled(true);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  return (
    <div className={`z-[60] ${className}`}>
      <div className="bg-[#394049] text-white rounded-xl shadow-lg border border-white/10 p-3 max-h-[min(58vh,30rem)] overflow-y-auto scrollable-content">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight">Acceso directo</p>
            <p className="text-[11px] text-white/80 leading-snug">
              Abre Compas Marine como app desde la pantalla principal.
            </p>
          </div>

          <button
            type="button"
            onClick={handleInstall}
            className="bg-white text-[#394049] rounded-lg px-3 py-2 text-[11px] font-bold flex items-center gap-1.5 flex-shrink-0"
          >
            {isManualInstall ? <Share2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
            Agregar
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Ocultar acceso directo"
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isManualInstall && showManualSteps && (
          <div className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/85">
            <ManualInstallSteps />
          </div>
        )}
      </div>
    </div>
  );
};

function isRunningStandalone() {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isIosDevice() {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent.toLowerCase();
  const isClassicIos = /iphone|ipad|ipod/.test(userAgent);
  const isIpadOs = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;

  return isClassicIos || isIpadOs;
}

function isMobileOrTabletDevice() {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent.toLowerCase();
  const hasTouch = window.navigator.maxTouchPoints > 0;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const smallScreen = window.matchMedia('(max-width: 900px)').matches;

  return /android|iphone|ipad|ipod|mobile|tablet/.test(userAgent) || (hasTouch && coarsePointer && smallScreen);
}

function ManualInstallSteps() {
  if (isIosDevice()) {
    return (
      <div className="space-y-2">
        <p className="font-bold text-white">iPhone: agregar a pantalla de inicio</p>
        <ol className="list-decimal pl-4 space-y-1.5">
          <li>Abre esta pagina en Safari. Si estas en Chrome, Gmail, WhatsApp u otra app, toca el boton para abrir en Safari.</li>
          <li>Verifica que la pagina haya cargado correctamente y que estes en el inicio de sesion de Compas Marine.</li>
          <li>Toca el boton Compartir de Safari. Es el icono de un cuadrado con una flecha hacia arriba.</li>
          <li>Desliza hacia abajo en el menu hasta encontrar Agregar a pantalla de inicio.</li>
          <li>Si no aparece, toca Editar acciones, busca Agregar a pantalla de inicio y activalo.</li>
          <li>Toca Agregar a pantalla de inicio.</li>
          <li>Deja el nombre como Compas Marine o escribe uno mas corto, por ejemplo Compas.</li>
          <li>Toca Agregar en la esquina superior derecha.</li>
          <li>Vuelve a la pantalla principal del iPhone y abre Compas Marine desde el nuevo icono.</li>
        </ol>
        <p className="text-white/70">
          Nota: en iPhone este acceso directo solo se puede crear desde Safari. Si no aparece la opcion, actualiza iOS o revisa que Safari no tenga restricciones.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-bold text-white">Android: agregar acceso directo</p>
      <ol className="list-decimal pl-4 space-y-1.5">
        <li>Toca el menu del navegador.</li>
        <li>Elige Instalar app o Agregar a pantalla principal.</li>
        <li>Confirma con Instalar o Agregar.</li>
      </ol>
    </div>
  );
}
