import { useState, useEffect } from 'react';
import { FolderOpen, Loader2, FileText, AlertCircle, Download, User, Tag } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { readControlDocSnapshot, saveControlDocSnapshot } from '../storage/controlDocOffline';


const urls = {
  documents: getApiUrl('/controldoc/documents'),
  entities: getApiUrl('/controldoc/entities'),
  documentTypes: getApiUrl('/controldoc/document-types')
};

// --- COMPONENTE: Tarjeta Dinámica ---
const ApiDocumentCard = ({ doc, entities, documentTypes }) => {
  const entity = entities.find(e => e.id?.toString() === doc.entity_id?.toString());
  const docType = documentTypes.find(t => t.id?.toString() === doc.document_type_id?.toString());
  
  const entityName = entity?.full_name || entity?.name || entity?.label || entity?.email || doc.entity_id;
  const typeName = docType?.name || docType?.label || docType?.id || doc.document_type_id;

  let status = { text: 'Sin Fecha', days: '--', bgClass: 'bg-gray-100 text-gray-600', borderClass: 'border-gray-500', textClass: 'text-gray-600', glowClass: 'bg-gray-500' };
  const isBlocked = doc.aasm_state === 'blocked';

  if (doc.expires_at) {
    const expirationDate = new Date(doc.expires_at);
    const currentDate = new Date(); 
    currentDate.setHours(0, 0, 0, 0);

    const timeDifference = expirationDate.getTime() - currentDate.getTime();
    const daysRemaining = Math.ceil(timeDifference / (1000 * 3600 * 24));

    if (isBlocked) {
       status = { text: 'Bloqueado', days: daysRemaining > 0 ? daysRemaining : '0', bgClass: 'bg-red-50 text-[#921E30] border-red-200', borderClass: 'border-[#921E30]', textClass: 'text-[#921E30]', glowClass: 'bg-[#921E30]' };
    } else if (daysRemaining > 30) {
      status = { text: 'Vigente', days: daysRemaining, bgClass: 'bg-green-50 text-green-700 border-green-200', borderClass: 'border-green-500', textClass: 'text-green-600', glowClass: 'bg-green-500' };
    } else if (daysRemaining > 0) {
      status = { text: 'Próximo a vencer', days: daysRemaining, bgClass: 'bg-yellow-50 text-yellow-700 border-yellow-200', borderClass: 'border-yellow-400', textClass: 'text-yellow-600', glowClass: 'bg-yellow-400' };
    } else {
      const expired = Math.abs(daysRemaining);
      status = { text: daysRemaining === 0 ? 'Expira hoy' : `Expirado`, days: daysRemaining === 0 ? '0' : `-${expired}`, bgClass: 'bg-red-50 text-[#921E30] border-red-200', borderClass: 'border-[#921E30]', textClass: 'text-[#921E30]', glowClass: 'bg-[#921E30]' };
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="bg-white rounded-2xl p-5 relative overflow-hidden shadow-sm border border-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 mb-4">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-bl-full z-0"></div>
      
      <div className="flex justify-between items-start relative z-10">
        <div className="flex-1 pr-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-[#394049] flex-shrink-0" />
            <h3 className="font-bold text-[#394049] text-sm leading-tight uppercase">{doc.label || 'Documento'}</h3>
          </div>
          
          <div className="space-y-1.5 mb-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
            <p className="text-xs text-gray-600 flex items-center">
              <User className="w-3 h-3 mr-1.5 text-gray-400" />
              <span className="font-semibold text-gray-800 truncate">{entityName}</span>
            </p>
            <p className="text-xs text-gray-600 flex items-center">
              <Tag className="w-3 h-3 mr-1.5 text-gray-400" />
              <span className="truncate">{typeName}</span>
            </p>
          </div>
          
          <div className="space-y-1 mb-3 text-xs">
            <p className="text-gray-500 flex justify-between pr-4">
              <span>Emisión:</span> <span className="font-medium text-gray-700">{formatDate(doc.created_at)}</span>
            </p>
            <p className="text-gray-500 flex justify-between pr-4">
              <span>Expiración:</span> <span className="font-medium text-gray-700">{formatDate(doc.expires_at)}</span>
            </p>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <p className={`text-[10px] font-bold inline-block px-2 py-1 rounded border ${status.bgClass} uppercase`}>
              {status.text}
            </p>
            {doc.download_base64_url && (
              <a href={doc.download_base64_url} target="_blank" rel="noreferrer" className="text-[10px] font-bold bg-[#394049] text-white px-2 py-1 rounded flex items-center hover:bg-gray-700 transition">
                <Download className="w-3 h-3 mr-1" /> Ver/Bajar
              </a>
            )}
          </div>

          {isBlocked && doc.blocked_description && (
            <div className="mt-3 bg-red-50 border border-red-200 p-2 rounded flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-700 font-medium leading-tight">{doc.blocked_description}</p>
            </div>
          )}
        </div>

        <div className="relative flex-shrink-0 mt-1">
          <div className={`absolute inset-0 rounded-full blur-md opacity-20 ${status.glowClass}`}></div>
          <div className={`w-16 h-16 rounded-full border-4 bg-white flex flex-col items-center justify-center text-center p-1 relative z-10 shadow-inner ${status.borderClass}`}>
            <span className={`font-black text-xl leading-none tracking-tight ${status.textClass}`}>{status.days}</span>
            <span className="text-[7px] font-semibold uppercase tracking-wider text-gray-500 mt-1 leading-tight text-center">Días<br/>Restantes</span>
          </div>
        </div>
      </div>
    </div>
  );
};


export const ViewDocumentos = () => {
  const [apiData, setApiData] = useState({ documents: [], entities: [], documentTypes: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progressInfo, setProgressInfo] = useState('');
  const [cacheNotice, setCacheNotice] = useState('');
  
  const [selectedType, setSelectedType] = useState('all');
  const [selectedEntityId, setSelectedEntityId] = useState('all');

  // Utilidad para pausar la ejecución (evitar error 429)
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  useEffect(() => {
    const showCachedSnapshot = () => {
      const snapshot = readControlDocSnapshot();
      if (!snapshot) return false;

      setApiData(snapshot.data);
      const savedAt = new Date(snapshot.savedAt).toLocaleString('es-CL', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
      setCacheNotice(`Modo offline: mostrando ultima sincronizacion (${savedAt}).`);
      return true;
    };

    const fetchAllData = async () => {
      setIsLoading(true);
      setError(null);
      setCacheNotice('');
      
      const requestOptions = {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'follow'
      };
      let hadFetchError = false;

      // Función resiliente que respeta los límites de la API
      const fetchAllPages = async (baseUrl, name) => {
        let allItems = [];
        let page = 1;
        let hasMore = true;
        const MAX_PAGES = 40; 

        while (hasMore && page <= MAX_PAGES) {
          try {
            setProgressInfo(`Descargando ${name} (Pág. ${page})...`);
            const separator = baseUrl.includes('?') ? '&' : '?';
            const url = `${baseUrl}${separator}page=${page}&per_page=100`;
            const response = await fetch(url, requestOptions);
            
            // Si nos bloquean por ir muy rápido, esperamos 2 segundos y reintentamos la misma página
            if (response.status === 429) {
                 console.warn(`Límite 429 en ${name}. Pausa de seguridad...`);
                 await delay(2000);
                 continue; 
            }
            if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
            
            const json = await response.json();
            
            let items = [];
            if (Array.isArray(json)) {
              items = json;
            } else {
              const arrayKey = Object.keys(json).find(key => Array.isArray(json[key]));
              if (arrayKey) items = json[arrayKey];
            }

            if (items.length === 0) {
              hasMore = false;
            } else {
              allItems = [...allItems, ...items];
              page++;
              
              // Si nos dan menos de 20 resultados, asumimos que es la última página
              if (items.length < 20) hasMore = false; 
              
              // Micropausa de cortesía de 200ms entre cada página para no enojar al servidor
              await delay(200);
            }
          } catch (error) {
             console.error(`Error en ${name}:`, error);
             hadFetchError = true;
             hasMore = false; // Guardamos lo que ya bajamos y detenemos
          }
        }
        return allItems;
      };

      try {
        // Ejecución SECUENCIAL (uno tras otro) para no saturar la API
        setProgressInfo("Iniciando Diccionarios...");
        const allTypes = await fetchAllPages(urls.documentTypes, "Tipos");
        
        // Filtramos los tipos de documentos para excluir cursos, capacitaciones y la lista personalizada
        const excludedKeywords = [
          'curso', 'capacitaci', 'autocuidado', 'higiene y manipulacion', 'oxicorte',
          'manejo manual de carga', 'navegacion segura', 'uso de extintores',
          'uso de winches', 'uso y cuidado epp', 'uso epp buceo', 
          'pts fondeo de robot', 'supervision en faenas', 'primeros auxilios',
          'uso de bote auxiliar', 'uso de grua hidraulica', 'uso de art', 'induccion mow'
        ];

        const validTypes = allTypes.filter(type => {
          const rawName = type.name || type.label || '';
          // Normalizamos el texto (sin mayúsculas y sin tildes) para una comparación segura
          const normalizedName = rawName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          
          // Verificamos si contiene alguna de las palabras excluidas
          return !excludedKeywords.some(keyword => normalizedName.includes(keyword));
        });
        
        const validTypeIds = validTypes.map(t => t.id?.toString());

        const allEntities = await fetchAllPages(urls.entities, "Usuarios");
        const allDocs = await fetchAllPages(urls.documents, "Documentos");
        
        // Guardamos solo los documentos que pertenecen a los tipos válidos (excluyendo la lista personalizada)
        const validDocs = allDocs.filter(doc => validTypeIds.includes(doc.document_type_id?.toString()));
        
        const nextApiData = {
          documents: validDocs,
          entities: allEntities,
          documentTypes: validTypes
        };

        if (hadFetchError && validDocs.length === 0 && showCachedSnapshot()) {
          setProgressInfo('');
          return;
        }
        
        setApiData(nextApiData);
        if (!hadFetchError) {
          saveControlDocSnapshot(nextApiData);
        }
        
        setProgressInfo('');
      } catch (err) {
        const hasCachedData = showCachedSnapshot();
        if (!hasCachedData) {
          setError(err.message);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []);

  // FILTRADO INTELIGENTE PARA EL MENÚ DESPLEGABLE
  // 1. Obtenemos los IDs de usuarios que SÍ tienen documentos en nuestra lista bajada
  const activeEntityIds = [...new Set(apiData.documents.map(d => d.entity_id?.toString()))];
  // 2. Filtramos la lista de entidades para mostrar solo a los involucrados
  const relevantEntities = apiData.entities.filter(e => activeEntityIds.includes(e.id?.toString()));

  // Lógica de filtrado de las tarjetas
  const filteredDocuments = apiData.documents.filter(doc => {
    const docTypeId = doc.document_type_id?.toString();
    const docEntityId = doc.entity_id?.toString();
    
    const typeMatch = selectedType === 'all' || docTypeId === selectedType;
    const entityMatch = selectedEntityId === 'all' || docEntityId === selectedEntityId;
    
    return typeMatch && entityMatch;
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] p-5 flex items-center justify-between flex-shrink-0">
        <h2 className="text-white text-xl font-semibold flex items-center">
          <FolderOpen className="w-6 h-6 mr-2" /> Mis Documentos
        </h2>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-6">
        
        
        <div className="border-t border-gray-200 pt-6">
          <div className="flex justify-between items-center mb-4">
            {apiData.documents.length > 0 && (
                <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full font-bold">
                {filteredDocuments.length} / {apiData.documents.length}
                </span>
            )}
          </div>

          {cacheNotice && (
            <div className="bg-yellow-50 text-yellow-800 p-3 rounded-xl text-xs font-medium border border-yellow-200 mb-4">
              {cacheNotice}
            </div>
          )}

          {/* FILTROS DINÁMICOS */}
          {apiData.documents.length > 0 && (
            <div className="bg-white rounded-xl p-4 mb-4 border border-gray-200 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Filtro por Tipo */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase">Tipo de Documento</label>
                  <select 
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate"
                  >
                    <option value="all">Todos los tipos</option>
                    {apiData.documentTypes.map(type => (
                      <option key={type.id} value={type.id?.toString()}>
                        {type.name || type.label || `Tipo ${type.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filtro por Usuario (Solo relevantes) */}
                <div>
                  
                {/*elimine entidad para que no aparesca al lado del buscador */}
                  <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase">Usuario</label>
                  <select 
                    value={selectedEntityId}
                    onChange={(e) => setSelectedEntityId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate"
                  >
                    <option value="all">Todos los usuarios</option>
                    {relevantEntities.map(entity => (
                      <option key={entity.id} value={entity.id?.toString()}>
                        {entity.name || entity.full_name || entity.email || `Usuario ${entity.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-[#921E30] mb-3" />
              <p className="text-sm font-medium">{progressInfo}</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-xs font-medium border border-red-200">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4" />
                <span className="font-bold text-sm">Problema de conexión</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          {!isLoading && apiData.documents.length === 0 && !error && (
            <div className="text-center py-10 text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p>No tienes documentos cargados.</p>
            </div>
          )}

          {/* Tarjetas de Documentos */}
          {filteredDocuments.length > 0 && (
            <div className="space-y-4">
              {filteredDocuments.map((doc) => (
                <ApiDocumentCard 
                  key={doc.id} 
                  doc={doc} 
                  entities={apiData.entities} 
                  documentTypes={apiData.documentTypes} 
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
