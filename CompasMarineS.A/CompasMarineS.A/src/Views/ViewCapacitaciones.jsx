import { GraduationCap, Code, Megaphone, Play } from 'lucide-react';

export const ViewCapacitaciones = () => (
  <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
    <div className="bg-[#394049] p-5 flex items-center justify-between flex-shrink-0">
      <h2 className="text-white text-xl font-semibold flex items-center">
        <GraduationCap className="w-6 h-6 mr-2" /> Capacitaciones
      </h2>
    </div>
    <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-6 space-y-4">
      {/* Curso 1 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#921E30]"></div>
        <h4 className="font-bold text-[#394049] text-base mb-1.5 flex items-center">
          <Code className="w-4 h-4 text-[#921E30] mr-2" /> Diseño Web
        </h4>
        <p className="text-xs text-gray-500 mb-3">Aprende diseño moderno desde cero.</p>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-semibold text-[#921E30] bg-red-50 px-2 py-1 rounded">En progreso 60%</span>
          <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="bg-[#921E30] h-full w-[60%]"></div>
          </div>
        </div>
      </div>

      {/* Curso 2 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#394049]"></div>
        <h4 className="font-bold text-[#394049] text-base mb-1.5 flex items-center">
          <Megaphone className="w-4 h-4 text-[#394049] mr-2" /> Marketing Digital
        </h4>
        <p className="text-xs text-gray-500 mb-3">Estrategias efectivas: SEO, SEM, redes sociales.</p>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">No iniciado</span>
          <button className="bg-[#394049] text-white text-[10px] px-3 py-1 rounded-full flex items-center">
            <Play className="w-3 h-3 mr-1" /> Iniciar
          </button>
        </div>
      </div>
    </main>
  </div>
);
