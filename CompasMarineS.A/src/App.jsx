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

  // --- 2. FLUJO AUTENTICADO: Se libera el max-width para volverse 100% responsivo ---
  return (
    <div className="bg-[#f3f4f6] md:bg-[#333] flex justify-center min-h-screen m-0 font-sans">
      {/* CAMBIO CLAVE: Cambiamos max-w-[414px] por max-w-none en pantallas grandes y agregamos un layout centralizado */}
      <div className="w-full max-w-none md:max-w-6xl lg:max-w-7xl bg-white min-h-screen shadow-[0_0_30px_rgba(0,0,0,0.15)] flex flex-col relative overflow-hidden pb-20">
        <SyncProgressOverlay active={syncProgress.active} percent={syncProgress.percent} />
        
        <Header />

        {/* Contenedor wrapper para las vistas internas */}
        <div className="flex-1 flex flex-col min-h-0 w-full mx-auto">
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

        {/* Navegación y Prompts */}
        <div className="w-full fixed bottom-0 left-0 right-0 md:absolute z-30 bg-white border-t border-gray-150">
          <div className="max-w-none md:max-w-6xl lg:max-w-7xl mx-auto">
            <BottomNav currentView={currentView} setCurrentView={handleViewChange} />
          </div>
        </div>

        <PwaInstallPrompt className="absolute left-4 right-4 bottom-24 z-40" />
      </div>
    </div>
  );
}