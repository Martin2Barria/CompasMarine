import { useState } from 'react';

// Importaciones de Componentes de Autenticación
import { Header } from './Components/Header';
import { BottomNav } from './Components/BottomNav';
import { Login } from './Components/login';
import { Registro } from './Components/registro'; // ← Nueva importación
import { OlvidastePassword } from './Components/olvidastePassword'; // ← Nueva importación
import { PwaInstallPrompt } from './Components/PwaInstallPrompt';

// Importaciones de Vistas
import { ViewInicio } from './Views/ViewInicio';
import { ViewCapacitaciones } from './Views/ViewCapacitaciones';
import { ViewDocumentos } from './Views/ViewDocumentos';
import { ViewNotificaciones } from './Views/ViewNotificaciones';
import { ViewAdmin } from './Views/ViewPanelAdmin';

export default function App() {
  const [currentView, setCurrentView] = useState('inicio');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Estado para controlar qué pantalla de autenticación se muestra ('login', 'register', 'forgot')
  const [authScreen, setAuthScreen] = useState('login');

  // SI NO ESTÁ AUTENTICADO: Evaluamos cuál de las 3 pantallas mostrar
  if (!isAuthenticated) {
    return (
      <div className="bg-[#333] flex justify-center min-h-screen m-0 font-sans">
        <div className="w-full max-w-[414px] bg-white min-h-screen shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col justify-center relative overflow-hidden">
          
          {authScreen === 'login' && (
            <Login 
              onLoginSuccess={() => setIsAuthenticated(true)} 
              onNavigate={setAuthScreen} 
            />
          )}

          {authScreen === 'register' && (
            <Registro onNavigate={setAuthScreen} />
          )}

          {authScreen === 'forgot' && (
            <OlvidastePassword onNavigate={setAuthScreen} />
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
        
        <Header />

        {currentView === 'inicio' && <ViewInicio setView={setCurrentView} />}
        {currentView === 'capacitaciones' && <ViewCapacitaciones />}
        {currentView === 'documentos' && <ViewDocumentos />}
        {currentView === 'notificaciones' && <ViewNotificaciones setView={setCurrentView} />}
        {currentView === 'admin' && <ViewAdmin />}

        <BottomNav currentView={currentView} setCurrentView={setCurrentView} />
        <PwaInstallPrompt className="absolute left-4 right-4 bottom-24" />

      </div>
    </div>
  );
}
