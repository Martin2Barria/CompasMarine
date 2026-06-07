import { useState } from 'react';

// Importaciones de Componentes y Vistas
import { Header } from './Components/Header';
import { BottomNav } from './Components/BottomNav';
import { ViewInicio } from './Views/ViewInicio';
import { ViewCapacitaciones } from './Views/ViewCapacitaciones';
import { ViewDocumentos } from './Views/ViewDocumentos';
import { ViewNotificaciones } from './Views/ViewNotificaciones';

export default function App() {
  const [currentView, setCurrentView] = useState('inicio');

  return (
    <div className="bg-[#333] flex justify-center min-h-screen m-0 font-sans">
      <div className="w-full max-w-[414px] bg-white min-h-screen shadow-[0_0_20px_rgba(0,0,0,0.5)] flex flex-col relative overflow-hidden">
        
        {/* Encabezado Fijo */}
        <Header />

        {/* Renderizado Condicional de Vistas */}
        {currentView === 'inicio' && <ViewInicio setView={setCurrentView} />}
        {currentView === 'capacitaciones' && <ViewCapacitaciones />}
        {currentView === 'documentos' && <ViewDocumentos />}
        {currentView === 'notificaciones' && <ViewNotificaciones setView={setCurrentView} />}

        {/* Barra de Navegación Inferior */}
        <BottomNav currentView={currentView} setCurrentView={setCurrentView} />

      </div>
    </div>
  );
}
