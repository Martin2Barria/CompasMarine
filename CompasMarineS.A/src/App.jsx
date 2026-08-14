import { useCallback, useEffect, useRef, useState } from 'react';

// Importaciones de Componentes de Autenticación
import { Header } from './Components/Header';
import { BottomNav } from './Components/BottomNav';
import { Login } from './Components/login';
//unico cambio 28 Domingo
import { OlvidastePassword } from './Components/olvidastePassword';
import { PwaInstallPrompt } from './Components/PwaInstallPrompt';
import { PushActivationPrompt } from './Components/PushActivationPrompt';
import { SyncProgressOverlay } from './Components/SyncProgressOverlay';

// Importaciones de Vistas
import { ViewInicio } from './Views/ViewInicio';
import { ViewDocumentos } from './Views/ViewDocumentos';
import { ViewNotificaciones } from './Views/ViewNotificaciones';
import { ViewAdmin } from './Views/ViewPanelAdmin';
import { isAdminUser } from './auth/userScope';
import { disablePushNotifications, enablePushNotifications } from './pwa/pushNotifications';

// <-- IMPORTACIÓN CORREGIDA AQUÍ -->
import { getApiUrl } from './config/api'; 

const getInitialDarkMode = () => {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem('theme');
  if (stored) return stored === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const getViewFromPath = (pathname = '') => pathname.startsWith('/documentos') ? 'documentos' : 'inicio';

export default function App() {
  const [currentView, setCurrentView] = useState(() => getViewFromPath(window.location.pathname));
  const [visitedViews, setVisitedViews] = useState(() => new Set([getViewFromPath(window.location.pathname)]));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [syncProgress, setSyncProgress] = useState({ active: false, percent: 0 });
  const hideProgressTimer = useRef(null);
  const [authScreen, setAuthScreen] = useState('login');
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const [adminCollaboratorContext, setAdminCollaboratorContext] = useState(null);
  
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    window.localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleTheme = useCallback(() => {
    setDarkMode((value) => !value);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !currentUser || isAdminUser(currentUser)) return;

    // Al entrar se solicita el permiso pendiente o se revalida la suscripción ya concedida.
    enablePushNotifications().catch((error) => {
      console.warn('[Push] No se pudo activar automáticamente:', error.message);
    });
  }, [isAuthenticated, currentUser]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type !== 'compas:navigate') return;
      const targetUrl = typeof event.data.url === 'string' ? event.data.url : '/';
      const nextView = getViewFromPath(targetUrl);

      window.history.pushState({}, '', targetUrl);
      setVisitedViews((views) => new Set([...views, nextView]));
      setCurrentView(nextView);
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
  }, []);

  const reportLoadingProgress = useCallback((next = {}) => {
    const payload = typeof next === 'number' ? { percent: next } : next;
    const percent = Math.max(0, Math.min(100, Math.round(payload.percent ?? 0)));

    if (hideProgressTimer.current) {
      clearTimeout(hideProgressTimer.current);
      hideProgressTimer.current = null;
    }

    if (payload.active === false) {
      setSyncProgress({ active: false, percent: 0 });
      return;
    }

    setSyncProgress({ active: true, percent });

    if (payload.done || percent >= 100) {
      hideProgressTimer.current = window.setTimeout(() => {
        setSyncProgress({ active: false, percent: 0 });
        hideProgressTimer.current = null;
      }, 650);
    }
  }, []);

  useEffect(() => () => {
    if (hideProgressTimer.current) {
      clearTimeout(hideProgressTimer.current);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    // <-- RUTA CORREGIDA AQUÍ -->
    fetch(getApiUrl('/auth/me'), { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (isCancelled || !data?.user) return;
        setCurrentUser(data.user);
        setIsAuthenticated(true);
      })
      .catch(() => null)
      .finally(() => {
        if (!isCancelled) setIsCheckingAuth(false);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleLoginSuccess = (user = null) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await disablePushNotifications();
    } catch {
      // Una suscripción inválida será eliminada por el backend cuando Web Push la rechace.
    }

    try {
      await fetch(getApiUrl('/auth/logout'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    } catch {
      // El estado local se limpia igualmente para mantener la salida inmediata.
    }

    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentView('inicio');
    setVisitedViews(new Set(['inicio']));
    setSyncProgress({ active: false, percent: 0 });
    setAdminCollaboratorContext(null);
  };

  const handleViewChange = (view) => {
    const nextView = view === 'firmas' ? 'documentos' : view;
    if (nextView === 'notificaciones' && isAdminUser(currentUser)) {
      setCurrentView('inicio');
      return;
    }

    const nextPath = nextView === 'documentos' ? '/documentos' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.replaceState({}, '', nextPath);
    }

    setVisitedViews((views) => {
      if (views.has(nextView)) return views;

      const nextViews = new Set(views);
      nextViews.add(nextView);
      return nextViews;
    });
    setCurrentView(nextView);
  };

  const handleOpenCollaboratorDocuments = (collaborator) => {
    if (!collaborator?.id) return;
    setAdminCollaboratorContext(collaborator);
    handleViewChange('documentos');
  };

  if (isCheckingAuth) {
    return (
      <div className="bg-[#333] flex justify-center min-h-screen m-0 font-sans">
        <div className="w-full max-w-[414px] md:max-w-none bg-white min-h-screen shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col justify-center relative overflow-hidden">
          <SyncProgressOverlay active percent={18} />
        </div>
      </div>
    );
  }

  // --- 1. FLUJO NO AUTENTICADO: Se mantiene fijo tipo "móvil" por estética de formulario ---
  if (!isAuthenticated) {
    return (
      <div className="bg-[#333] flex justify-center min-h-screen m-0 font-sans">
        {/*unico cambio 28 Domingo */}
        <div className="w-full max-w-[414px] md:max-w-none bg-white min-h-screen shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col justify-center relative overflow-hidden">
          <SyncProgressOverlay active={syncProgress.active} percent={syncProgress.percent} />
          
          {authScreen === 'login' && (
            <Login 
              onLoginSuccess={handleLoginSuccess} 
              onNavigate={setAuthScreen} 
              onLoadingProgress={reportLoadingProgress}
            />
          )}

          {authScreen === 'forgot' && (
            <OlvidastePassword onNavigate={setAuthScreen} onLoadingProgress={reportLoadingProgress} />
          )}

          <PwaInstallPrompt className="absolute left-4 right-4 bottom-4" />
        </div>
      </div>
    );
  }

  // --- 2. FLUJO AUTENTICADO: 100% RESPONSIVO PARA PC Y MÓVIL ---
  return (
    <div className="bg-gray-50 flex justify-center min-h-screen m-0 font-sans w-full">
      {/* SOLUCIÓN AL PROBLEMA 1: Quitamos max-w-[414px] o max-w-6xl. Ahora la app toma 'w-full' (ancho completo) */}
      <div className="w-full bg-white min-h-screen flex flex-col relative overflow-hidden pb-24">
        <PushActivationPrompt enabled={!isAdminUser(currentUser)} />
        <SyncProgressOverlay active={syncProgress.active} percent={syncProgress.percent} />
        
        <Header onLogout={handleLogout} darkMode={darkMode} onToggleTheme={toggleTheme} />

        {/* Contenedor wrapper flexible para que los elementos internos respiren en pantallas grandes */}
        <div className="flex-1 flex flex-col min-h-0 w-full mx-auto px-4 sm:px-6 md:px-8">
          {visitedViews.has('inicio') && (
            <div className={currentView === 'inicio' ? 'flex flex-col flex-1 min-h-0 w-full' : 'hidden'}>
              <ViewInicio
                setView={handleViewChange}
                currentUser={currentUser}
                onLoadingProgress={reportLoadingProgress}
                onAdminCollaboratorChange={setAdminCollaboratorContext}
                onOpenCollaboratorDocuments={handleOpenCollaboratorDocuments}
              />
            </div>
          )}

          {visitedViews.has('documentos') && (
            <div className={currentView === 'documentos' ? 'flex flex-col flex-1 min-h-0 w-full' : 'hidden'}>
              <ViewDocumentos
                currentUser={currentUser}
                onLoadingProgress={reportLoadingProgress}
                focusedCollaborator={adminCollaboratorContext}
                onCollaboratorChange={setAdminCollaboratorContext}
              />
            </div>
          )}

          {!isAdminUser(currentUser) && visitedViews.has('notificaciones') && (
            <div className={currentView === 'notificaciones' ? 'flex flex-col flex-1 min-h-0 w-full' : 'hidden'}>
              <ViewNotificaciones setView={handleViewChange} currentUser={currentUser} onLoadingProgress={reportLoadingProgress} />
            </div>
          )}

          {visitedViews.has('admin') && (
            <div className={currentView === 'admin' ? 'flex flex-col flex-1 min-h-0 w-full' : 'hidden'}>
              <ViewAdmin onLoadingProgress={reportLoadingProgress} />
            </div>
          )}
        </div>

        {/* Contenedor limpio para la barra inferior */}
        <div className="w-full fixed bottom-0 left-0 right-0 z-30">
          <BottomNav
            currentView={currentView}
            setCurrentView={handleViewChange}
            currentUser={currentUser}
            hideDocuments={isAdminUser(currentUser) && Boolean(adminCollaboratorContext)}
          />
        </div>

        {/* Se subió un poco el cartel de PWA para que no pise los botones en celulares */}
        <PwaInstallPrompt className="fixed left-3 right-3 bottom-[6.75rem] mx-auto max-w-lg z-[60]" />
      </div>
    </div>
  );
}
