import { useEffect, useState } from 'react';
import { Download, Share2, Smartphone, X } from 'lucide-react';

const DISMISSED_KEY = 'compas:pwa-install-dismissed-at:v1';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export const PwaInstallPrompt = ({ className = '' }) => {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => isRunningStandalone());
  const [isDismissed, setIsDismissed] = useState(() => wasRecentlyDismissed());
  const [showManualSteps, setShowManualSteps] = useState(false);
  const isManualInstall = !installPrompt;
  const shouldShow = !isInstalled && !isDismissed;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = () => setIsInstalled(isRunningStandalone());
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

    mediaQuery.addEventListener('change', handleDisplayModeChange);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener('change', handleDisplayModeChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

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
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setIsDismissed(true);
  };

  return (
    <div className={`z-[60] ${className}`}>
      <div className="bg-[#394049] text-white rounded-xl shadow-lg border border-white/10 p-3">
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
            {getManualInstallText()}
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

function getManualInstallText() {
  if (isIosDevice()) {
    return 'En iPhone: toca Compartir y luego Anadir a pantalla de inicio.';
  }

  return 'Abre el menu del navegador y elige Instalar app o Agregar a pantalla principal.';
}

function wasRecentlyDismissed() {
  if (typeof window === 'undefined') return false;

  const dismissedAt = Number(window.localStorage.getItem(DISMISSED_KEY));
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_DURATION_MS;
}
