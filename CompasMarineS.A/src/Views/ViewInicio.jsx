import { Search, User, Clock, PenTool } from 'lucide-react'; // <-- IMPORTANTE: Añadidos Clock y PenTool
import { PassportCard } from '../Components/PassportCard';

// CORRECCIÓN: Ahora el componente recibe todas las variables necesarias como props
export const ViewInicio = ({ 
  setView, 
  pendingSignatures = [], 
  isSyncing = false, 
  expiringDocs = [], 
  formatDate 
}) => (
  <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
    {/* Banner de Bienvenida */}
    <div className="bg-[#394049] p-6 flex items-center gap-4 relative overflow-hidden flex-shrink-0">
      <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 rounded-full blur-2xl"></div>
      <div className="w-16 h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg relative z-10 overflow-hidden">
        <User className="w-8 h-8 text-gray-300 mt-2" />
      </div>
      <div className="relative z-10">
        <p className="text-[#921E30] text-xs font-bold tracking-wider mb-1 uppercase">Bienvenido</p>
        <h2 className="text-white text-2xl font-semibold tracking-wide">Juan Pérez</h2>
      </div>
    </div>

    {/* Contenido Principal */}
    <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
      {/* Buscador */}
      <div className="p-6 pb-2">
        <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
          <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Buscar documentos, cursos..." className="w-full bg-transparent py-4 pl-12 pr-4 focus:outline-none text-sm" />
        </div>
      </div>

      {/* Sección: Mis Documentos */}
      <div className="px-6 pt-4 pb-2 flex justify-between items-end">
        <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Documentos</h3>
        <button onClick={() => setView('documentos')} className="text-xs font-semibold text-[#921E30]">Ver todos</button>
      </div>
      <div className="px-6 mb-4 mt-3">
        <PassportCard />
      </div>

      {/* Sección: Mis Capacitaciones */}
      <div className="px-6 pt-2">
        <div className="flex justify-between items-end mb-4">
          <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Capacitaciones</h3>
          <button onClick={() => setView('capacitaciones')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
        </div>
      </div>

      {/* Sección: Mis Firmas Pendientes */}
      <div className="px-6 pt-4 pb-2 flex justify-between items-end">
        <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Firmas Pendientes</h3>
        <button onClick={() => setView('firmas')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
      </div>
      
      <div className="px-6 mb-4 mt-2">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          {pendingSignatures.length > 0 ? (
            <div className="space-y-3">
              {pendingSignatures.map((doc) => (
                <div key={doc.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mb-2 hover:shadow-md transition">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <PenTool className="w-5 h-5 text-[#921E30] shrink-0" />
                    <div className="min-w-0">
                      {/* Solución al Modo Oscuro: Usamos #394048 para evadir tu CSS global */}
                      <p className="text-sm font-semibold text-[#394048] truncate">{doc.displayName}</p>
                      <p className="text-[11px] text-gray-500 truncate">Requiere firma digital vía CDOC</p>
                    </div>
                  </div>
                  <a 
                    href={`https://compliance.controldoc.legal/documentos/${doc.id}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="bg-[#921E30] text-white text-xs px-3 py-1.5 rounded-md font-semibold shadow-sm hover:bg-red-800 transition-colors ml-2 shrink-0"
                  >
                    Firmar
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500 ">
              {isSyncing ? 'Verificando firmas pendientes...' : 'No tienes firmas pendientes.'}
            </div>
          )}
        </div>
      </div>

      {/* Sección: Alertas de Vencimiento */}
      <div className="px-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs uppercase font-semibold text-[#921E30]">Alertas</p>
              <h4 className="text-base font-bold text-[#394049]">Documentos por Vencer</h4>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-gray-500">
              {isSyncing ? (
                 <span className="flex items-center text-blue-500 animate-pulse"><Clock className="w-3 h-3 mr-1" /> Actualizando...</span>
              ) : (
                 <><Clock className="w-4 h-4" /> Alertas activas</>
              )}
            </div>
          </div>

          {expiringDocs.length > 0 ? (
            <div className="space-y-3">
              {expiringDocs.map((doc) => {
                const isExpired = doc.daysRemaining < 0;
                const isCritical = doc.daysRemaining >= 0 && doc.daysRemaining <= 30;
                const isWarning = doc.daysRemaining > 30 && doc.daysRemaining <= 60;
                
                let colorClass = '';
                let textColor = '';
                let statusText = '';

                if (isExpired || isCritical) {
                  colorClass = 'bg-[#FF0000]/10 border-[#FF0000]';
                  textColor = 'text-[#FF0000]';
                  statusText = isExpired ? `Expirado hace ${Math.abs(doc.daysRemaining)} días` : `Expira en ${doc.daysRemaining} días`;
                } else if (isWarning) {
                  colorClass = 'bg-[#B8860B]/10 border-[#B8860B]';
                  textColor = 'text-[#B8860B]';
                  statusText = `Expira en ${doc.daysRemaining} días`;
                }

                return (
                  <div key={doc.id} className="rounded-2xl border border-gray-200 p-3 bg-white shadow-sm hover:shadow transition">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                        <p className="text-[11px] text-gray-500">Expira {formatDate ? formatDate(doc.expires_at) : doc.expires_at}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${colorClass} ${textColor}`}>
                        {statusText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
              {isSyncing ? 'Buscando alertas...' : '¡Excelente! No tienes documentos próximos a expirar.'}
            </div>
          )}
        </div>
      </div>

    </main>
  </div>
);