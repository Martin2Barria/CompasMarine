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

<<<<<<< Updated upstream
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
=======
const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = new Date(dateString);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const getCookie = (name) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

export const ViewInicio = ({ setView }) => {
  const [expiringDocs, setExpiringDocs] = useState([]);
  const [pendingSignatures, setPendingSignatures] = useState([]);
  const [currentEntityName, setCurrentEntityName] = useState('');
  const [docPercentage, setDocPercentage] = useState(100);
  const [isSyncing, setIsSyncing] = useState(false);

  const displayName = currentEntityName || 'Usuario';

  useEffect(() => {
    const currentEntityId = getCookie('compas_user_id');
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const processData = (allDocs, allEntities, allTypes) => {
      
      const getDocName = (doc) => {
        let typeName = '';
        if (allTypes && allTypes.length > 0) {
          const type = allTypes.find(t => t.id?.toString() === doc.document_type_id?.toString());
          if (type) typeName = type.name || type.label || '';
        }
        const docLabel = doc.label || '';
        const combinedName = `${typeName} ${docLabel}`.trim();
        return combinedName !== '' ? combinedName : 'Documento sin nombre';
      };

      if (currentEntityId && allEntities) {
        const entity = allEntities.find((e) => e.id?.toString() === currentEntityId.toString());
        if (entity) setCurrentEntityName(entity.full_name || entity.name || entity.email);
      }

      const userDocs = currentEntityId 
        ? allDocs.filter((doc) => doc.entity_id?.toString() === currentEntityId.toString())
        : allDocs;

      // FIRMAS PENDIENTES (Usa require_signers)
      const signatures = allDocs
        .filter(doc => doc.require_signers === true || doc.aasm_state === 'pending')
        .map(doc => ({ ...doc, displayName: getDocName(doc) }));
      
      setPendingSignatures(signatures);

      // ALERTAS CRÍTICAS DEL USUARIO
      const alerts = userDocs
        .map(doc => ({ 
          ...doc, 
          daysRemaining: getDaysRemaining(doc.expires_at),
          displayName: getDocName(doc) 
        }))
        .filter(doc => doc.daysRemaining !== null && doc.daysRemaining <= 60) 
        .sort((a, b) => a.daysRemaining - b.daysRemaining) 
        .slice(0, 5); 

      setExpiringDocs(alerts);

      // SALUD DOCUMENTAL
      if (userDocs.length > 0) {
        const healthyDocs = userDocs.filter(d => {
           const days = getDaysRemaining(d.expires_at);
           return days === null || days > 30;
        }).length;
        setDocPercentage(Math.round((healthyDocs / userDocs.length) * 100));
      }
    };

    const snapshot = readControlDocSnapshot();
    if (snapshot?.data) {
      processData(snapshot.data.documents || [], snapshot.data.entities || [], snapshot.data.documentTypes || []);
    }

    const fetchFreshData = async () => {
      setIsSyncing(true);
      try {
        // 1. Polling protegido para los documentos (espera si hay 503)
        let allDocs = [];
        let syncSuccess = false;
        let attempts = 0;

        while (!syncSuccess && attempts < 6) {
            const syncResponse = await fetch(getApiUrl('/controldoc/documents/sync'));
            if (syncResponse.status === 503) {
                console.warn("Railway ocupado. Esperando 5 segundos...");
                await delay(5000);
                attempts++;
                continue;
            }
            if (syncResponse.ok) {
                allDocs = await syncResponse.json();
                syncSuccess = true;
            } else {
                throw new Error("Fallo al descargar documentos");
            }
        }

        if (!syncSuccess) return; // Si después de 30 segs no pudo, se rinde y deja la caché

        // 2. Traer diccionarios de Nombres y Usuarios
        const [entitiesRes, typesRes] = await Promise.all([
          fetch(getApiUrl('/controldoc/entities?page=1&per_page=100')),
          fetch(getApiUrl('/controldoc/document-types?page=1&per_page=100'))
        ]);

        if (entitiesRes.ok && typesRes.ok) {
          const rawEntities = await entitiesRes.json();
          const rawTypes = await typesRes.json();
          
          const freshEntities = Array.isArray(rawEntities) ? rawEntities : (Object.keys(rawEntities).find(k => Array.isArray(rawEntities[k])) ? rawEntities[Object.keys(rawEntities).find(k => Array.isArray(rawEntities[k]))] : []);
          const freshTypes = Array.isArray(rawTypes) ? rawTypes : (Object.keys(rawTypes).find(k => Array.isArray(rawTypes[k])) ? rawTypes[Object.keys(rawTypes).find(k => Array.isArray(rawTypes[k]))] : []);

          processData(allDocs, freshEntities, freshTypes);
        }
      } catch (error) {
        console.error("Error sincronizando inicio:", error);
      } finally {
        setIsSyncing(false);
      }
    };

    fetchFreshData();
  }, []);

  return (
    /*mejorar pendiente*/
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in w-full max-w-md mx-auto">
      <div className="bg-[#394049] p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-2 sm:gap-4 relative overflow-hidden flex-shrink-0">
        <div className="absolute -right-10 -top-10 w-32 sm:w-40 h-32 sm:h-40 bg-white opacity-5 rounded-full blur-2xl pointer-events-none"></div>

        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto flex-1">
          <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg relative z-10 overflow-hidden">
            <User className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-gray-300 mt-1.5" />
          </div>

          <div className="relative z-10 min-w-0 flex-1">
            <p className="text-white text-[10px] sm:text-xs md:text-sm font-bold tracking-wider mb-0.5 sm:mb-1 uppercase truncate">Bienvenido</p>
            <h2 className="text-white text-lg sm:text-xl md:text-2xl font-semibold tracking-wide truncate">{displayName}</h2>
          </div>
        </div>
        <div className="relative z-10 flex flex-col items-center justify-center w-full sm:w-auto sm:ml-auto pt-2 sm:pt-0 border-t border-gray-600/30 sm:border-t-0">
          <div 
            className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full border-4 sm:border-[6px] flex items-center justify-center shadow-lg bg-[#2A3037] flex-shrink-0" 
            style={{ borderColor: docPercentage >= 80 ? '#22c55e' : docPercentage >= 50 ? '#B8860B' : '#FF0000' }}
          >
            <span className="text-white text-xs sm:text-sm md:text-base font-extrabold">{docPercentage}%</span>
          </div>
          <span className="text-white text-[9px] sm:text-[10px] md:text-xs mt-1.5 sm:mt-2.5 uppercase font-bold tracking-wider whitespace-nowrap">
            Al día
          </span>
        </div>
      </div>
      {/*=========================*/}
      
      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
        
        <div className="p-6 pb-2">
          <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
            <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar alertas..." className="w-full bg-transparent py-4 pl-12 pr-4 focus:outline-none text-sm" />
          </div>
        </div>
>>>>>>> Stashed changes

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