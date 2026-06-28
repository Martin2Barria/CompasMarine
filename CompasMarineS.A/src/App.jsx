import { useCallback, useEffect, useRef, useState } from 'react';

// Importaciones de Componentes de Autenticación
import { Header } from './Components/Header';
import { BottomNav } from './Components/BottomNav';
import { Login } from './Components/login';
import { OlvidastePassword } from './Components/olvidastePassword'; 
import { PwaInstallPrompt } from './Components/PwaInstallPrompt';
import { SyncProgressOverlay } from './Components/SyncProgressOverlay';

// Importaciones de Vistas
import { ViewInicio } from './Views/ViewInicio';
import { ViewDocumentos } from './Views/ViewDocumentos';
import { ViewNotificaciones } from './Views/ViewNotificaciones';
import { ViewAdmin } from './Views/ViewPanelAdmin';

export default function App() {
  const [currentView, setCurrentView] = useState('inicio');
  const [visitedViews, setVisitedViews] = useState(() => new Set(['inicio']));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [syncProgress, setSyncProgress] = useState({ active: false, percent: 0 });
  const hideProgressTimer = useRef(null);
  
  const [authScreen, setAuthScreen] = useState('login');

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

  const handleLoginSuccess = (user = null) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleViewChange = (view) => {
    const nextView = view === 'firmas' ? 'documentos' : view;

    setVisitedViews((views) => {
      if (views.has(nextView)) return views;

      const nextViews = new Set(views);
      nextViews.add(nextView);
      return nextViews;
    });
    setCurrentView(nextView);
  };

  // --- 1. FLUJO NO AUTENTICADO: Se mantiene fijo tipo "móvil" por estética de formulario ---
  if (!isAuthenticated) {
    return (
      <div className="bg-[#333] flex justify-center min-h-screen m-0 font-sans">
        <div className="w-full max-w-[414px] bg-white min-h-screen shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col justify-center relative overflow-hidden">
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
        <SyncProgressOverlay active={syncProgress.active} percent={syncProgress.percent} />
        
        <Header />

        {/* Contenedor wrapper flexible para que los elementos internos respiren en pantallas grandes */}
        <div className="flex-1 flex flex-col min-h-0 w-full mx-auto px-4 sm:px-6 md:px-8">
          {visitedViews.has('inicio') && (
            <div className={currentView === 'inicio' ? 'flex flex-col flex-1 min-h-0 w-full' : 'hidden'}>
              <ViewInicio setView={handleViewChange} currentUser={currentUser} onLoadingProgress={reportLoadingProgress} />
            </div>
          )}

          {visitedViews.has('documentos') && (
            <div className={currentView === 'documentos' ? 'flex flex-col flex-1 min-h-0 w-full' : 'hidden'}>
              <ViewDocumentos currentUser={currentUser} onLoadingProgress={reportLoadingProgress} />
            </div>
          )}

          {visitedViews.has('notificaciones') && (
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
          <BottomNav currentView={currentView} setCurrentView={handleViewChange} />
        </div>

        {/* Se subió un poco el cartel de PWA para que no pise los botones en celulares */}
        <PwaInstallPrompt className="absolute left-4 right-4 bottom-28 z-40" />
      </div>
    </div>
  );
}