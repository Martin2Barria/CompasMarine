import { useCallback, useEffect, useRef, useState } from 'react';

// Importaciones de Componentes de Autenticación
import { Header } from './Components/Header';
import { BottomNav } from './Components/BottomNav';
import { Login } from './Components/login';
import { OlvidastePassword } from './Components/olvidastePassword'; // ← Nueva importación
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
  
  // Estado para controlar qué pantalla de autenticación se muestra ('login', 'forgot')
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

  // SI NO ESTÁ AUTENTICADO: Evaluamos cuál pantalla mostrar
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

  // SI ESTÁ AUTENTICADO: Flujo principal de la aplicación
  return (
    <div className="bg-[#333] flex justify-center min-h-screen m-0 font-sans">
      <div className="w-full max-w-[414px] bg-white min-h-screen shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col relative overflow-hidden pb-20">
        <SyncProgressOverlay active={syncProgress.active} percent={syncProgress.percent} />
        
        <Header />

        {visitedViews.has('inicio') && (
          <div className={currentView === 'inicio' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <ViewInicio setView={handleViewChange} currentUser={currentUser} onLoadingProgress={reportLoadingProgress} />
          </div>
        )}

        {visitedViews.has('documentos') && (
          <div className={currentView === 'documentos' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <ViewDocumentos currentUser={currentUser} onLoadingProgress={reportLoadingProgress} />
          </div>
        )}

        {visitedViews.has('notificaciones') && (
          <div className={currentView === 'notificaciones' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <ViewNotificaciones setView={handleViewChange} currentUser={currentUser} onLoadingProgress={reportLoadingProgress} />
          </div>
        )}

        {visitedViews.has('admin') && (
          <div className={currentView === 'admin' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <ViewAdmin onLoadingProgress={reportLoadingProgress} />
          </div>
        )}

        <BottomNav currentView={currentView} setCurrentView={handleViewChange} />
        <PwaInstallPrompt className="absolute left-4 right-4 bottom-24" />

      </div>
    </div>
  );
}
