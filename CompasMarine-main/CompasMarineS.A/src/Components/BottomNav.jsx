import { Home, GraduationCap, FolderOpen, Bell } from 'lucide-react';

export const BottomNav = ({ currentView, setCurrentView }) => {
  const navItems = [
    { id: 'inicio', icon: Home, label: 'Inicio' },
    { id: 'capacitaciones', icon: GraduationCap, label: 'Capacitaciones' },
    { id: 'documentos', icon: FolderOpen, label: 'Docs' },
    { id: 'notificaciones', icon: Bell, label: 'Notif' }
  ];

  return (
    // el nav className se encarga del tamaño de el nav' 
    <nav className="bg-white pt-4 pb-5 flex justify-between items-center fixed bottom-0 w-[inherit] max-w-[inherit] rounded-t-[28px] shadow-[0_-8px_30px_rgba(0,0,0,0.06)] z-50 px-6 border-t border-gray-100">
      {navItems.map(({ id, icon: Icon, label }) => {
        const isActive = currentView === id;
        return (
          <button 
            key={id}
            onClick={() => setCurrentView(id)}
            className="flex flex-col items-center justify-center flex-1 focus:outline-none transition-all relative"
          >
            {/* Contenedor del Icono */}
            <div className={`relative mb-1.5 transition-colors duration-200 ${isActive ? 'text-[#921E30]' : 'text-[#7C848B]'}`}>
              <Icon className="w-6 h-6" strokeWidth={1.8} />
              
              {/* Punto de notificación estilizado */}
              {id === 'notificaciones' && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#C2636F] rounded-full" />
              )}
            </div>
            
            {/* Texto del Botón */}
            <span className={`text-[11px] font-bold uppercase tracking-wider transition-colors duration-200 ${isActive ? 'text-[#921E30]' : 'text-[#7C848B]'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
