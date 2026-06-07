import { Home, GraduationCap, FolderOpen, Bell } from 'lucide-react';

export const BottomNav = ({ currentView, setCurrentView }) => {
  const navItems = [
    { id: 'inicio', icon: Home, label: 'Inicio' },
    { id: 'capacitaciones', icon: GraduationCap, label: 'Cursos' },
    { id: 'documentos', icon: FolderOpen, label: 'Docs' },
    { id: 'notificaciones', icon: Bell, label: 'Notif' }
  ];

  return (
    <nav className="bg-white p-2 flex justify-between items-center absolute bottom-0 w-full border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20 rounded-t-2xl px-4">
      {navItems.map(({ id, icon: Icon, label }) => {
        const isActive = currentView === id;
        return (
          <button 
            key={id}
            onClick={() => setCurrentView(id)}
            className={`flex flex-col items-center justify-center p-2 flex-1 focus:outline-none group transition-all relative ${isActive ? '' : 'opacity-60 hover:opacity-100'}`}
          >
            <div className={`p-2 rounded-xl mb-1 transition-all relative ${isActive ? 'bg-[#921E30] text-white shadow-md' : 'text-[#394049]'}`}>
              <Icon className="w-5 h-5" />
              {id === 'notificaciones' && !isActive && (
                <div className="absolute top-1 right-2 w-3 h-3 bg-[#921E30] rounded-full border-2 border-white"></div>
              )}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-[#921E30]' : 'text-[#394049]'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
