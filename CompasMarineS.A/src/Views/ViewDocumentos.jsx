import { useState, useEffect } from 'react';
import { FolderOpen, Loader2, FileText, AlertCircle, Filter } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { readControlDocSnapshot, saveControlDocSnapshot } from '../storage/controlDocOffline';
import { ApiDocumentCard } from './ApiDocumentCard'; 

const urls = {
  documentsSync: getApiUrl('/controldoc/documents/sync'), 
  entities: getApiUrl('/controldoc/entities'),
  documentTypes: getApiUrl('/controldoc/document-types')
};

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = new Date(dateString);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

export const ViewDocumentos = () => {
  const [apiData, setApiData] = useState({ documents: [], entities: [], documentTypes: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progressInfo, setProgressInfo] = useState('');
  const [cacheNotice, setCacheNotice] = useState('');
  
  const [selectedType, setSelectedType] = useState('all');
  const [selectedEntityId, setSelectedEntityId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [signatureFilter, setSignatureFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');

  const [visibleCount, setVisibleCount] = useState(50);

  // 1. Resetear el contador al filtrar
  useEffect(() => {
    setVisibleCount(50);
  }, [selectedType, selectedEntityId, statusFilter, signatureFilter, sortBy]);

  // 2. Carga principal de datos
  useEffect(() => {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const showCachedSnapshot = () => {
      const snapshot = readControlDocSnapshot();
      if (!snapshot) return false;

      setApiData(snapshot.data);
      const savedAt = new Date(snapshot.savedAt).toLocaleString('es-CL', {
        dateStyle: 'short', timeStyle: 'short'
      });
      setCacheNotice(`Modo offline: mostrando última sincronización (${savedAt}).`);
      return true;
    };

    const fetchAllData = async () => {
      const hasCachedData = showCachedSnapshot();
      setIsLoading(!hasCachedData); 
      setError(null);
      setCacheNotice('');
      
      const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };
      let hadFetchError = false;

      // --- Paginación protegida para diccionarios (Entidades y Tipos) ---
      const fetchAllPages = async (baseUrl, name) => {
        let allItems = [];
        let page = 1;
        let hasMore = true;
        while (hasMore && page <= 50) {
          try {
            if(!hasCachedData) setProgressInfo(`Cargando diccionarios ${name}...`);
            const separator = baseUrl.includes('?') ? '&' : '?';
            const response = await fetch(`${baseUrl}${separator}page=${page}&per_page=100`, requestOptions);
            
            if (response.status === 429) {
                console.warn(`Límite 429 en diccionario ${name}. Pausando...`);
                await delay(2000);
                continue;
            }

            if (!response.ok) throw new Error(`HTTP: ${response.status}`);
            const json = await response.json();
            let items = Array.isArray(json) ? json : (Object.keys(json).find(k => Array.isArray(json[k])) ? json[Object.keys(json).find(k => Array.isArray(json[k]))] : []);
            
            if (!items || items.length === 0) {
                hasMore = false;
            } else { 
                allItems.push(...items); 
                page++; 
                await delay(200); 
            }
          } catch (error) {
             hadFetchError = true; hasMore = false; 
          }
        }
        return allItems;
      };

      try {
        const allTypes = await fetchAllPages(urls.documentTypes, "Tipos");
        const allEntities = await fetchAllPages(urls.entities, "Usuarios");
        
        // --- Sincronización Masiva con espera (Polling para el 503) ---
        let allDocs = [];
        let syncSuccess = false;
        let attempts = 0;
        const maxAttempts = 6; 

        while (!syncSuccess && attempts < maxAttempts) {
            try {
                if(!hasCachedData) setProgressInfo(`Sincronizando base de datos masiva... (Intento ${attempts + 1}/${maxAttempts})`);
                const syncResponse = await fetch(urls.documentsSync, requestOptions);
                
                if (syncResponse.status === 503) {
                    console.warn("Railway ocupado descargando (503). Esperando 5 segundos...");
                    await delay(5000);
                    attempts++;
                    continue; 
                }

                if (syncResponse.ok) {
                    allDocs = await syncResponse.json();
                    syncSuccess = true;
                } else {
                    throw new Error(`Error Sync: ${syncResponse.status}`);
                }
            } catch (syncErr) {
                console.error("Fallo endpoint de sincronización", syncErr);
                await delay(3000); 
                attempts++;
                if (attempts >= maxAttempts) hadFetchError = true;
            }
        }

        if (!syncSuccess) {
            throw new Error("Tiempo de espera agotado sincronizando documentos. Intenta recargar la página.");
        }

        const excludedKeywords = [
            
        ];

        const validTypes = allTypes.filter(type => {
          const rawName = type.name || type.label || '';
          const normalizedName = rawName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          return !excludedKeywords.some(keyword => normalizedName.includes(keyword));
        });
        
        const validTypeIds = validTypes.map(t => t.id?.toString());
        const validDocs = allDocs.filter(doc => validTypeIds.includes(doc.document_type_id?.toString()));
        
        const nextApiData = {
          documents: validDocs,
          entities: allEntities,
          documentTypes: validTypes
        };

        if (hadFetchError && validDocs.length === 0 && hasCachedData) {
          setProgressInfo('');
          return;
        }
        
        setApiData(nextApiData);
        if (!hadFetchError) saveControlDocSnapshot(nextApiData);
        
        setProgressInfo('');
      } catch (err) {
        if (!hasCachedData) setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []); // Cierre correcto del useEffect de carga

  const activeEntityIds = [...new Set(apiData.documents.map(d => d.entity_id?.toString()))];
  const relevantEntities = apiData.entities.filter(e => activeEntityIds.includes(e.id?.toString()));

  let processedDocuments = apiData.documents.filter(doc => {
    const docTypeId = doc.document_type_id?.toString();
    const docEntityId = doc.entity_id?.toString();
    const daysRemaining = getDaysRemaining(doc.expires_at);
    
    const typeMatch = selectedType === 'all' || docTypeId === selectedType;
    const entityMatch = selectedEntityId === 'all' || docEntityId === selectedEntityId;
    const signatureMatch = signatureFilter === 'all' || (signatureFilter === 'pending' && doc.pending_signature === true);

    let statusMatch = true;
    if (statusFilter !== 'all') {
      if (statusFilter === 'non_expiring') statusMatch = daysRemaining === null;
      else if (daysRemaining === null) statusMatch = false; 
      else if (statusFilter === 'expired') statusMatch = daysRemaining < 0;
      else if (statusFilter === 'critical') statusMatch = daysRemaining >= 0 && daysRemaining <= 30;
      else if (statusFilter === 'warning') statusMatch = daysRemaining > 30 && daysRemaining <= 60;
      else if (statusFilter === 'valid') statusMatch = daysRemaining > 60;
    }
    
    return typeMatch && entityMatch && signatureMatch && statusMatch;
  });

  if (sortBy === 'days_expired') {
    processedDocuments.sort((a, b) => {
      const daysA = getDaysRemaining(a.expires_at);
      const daysB = getDaysRemaining(b.expires_at);
      if (daysA === null) return 1;
      if (daysB === null) return -1;
      return daysA - daysB;
    });
  }

  const documentsToRender = processedDocuments.slice(0, visibleCount);

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
                <span className="text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded-full font-bold shadow-sm">
                  Mostrando {documentsToRender.length} de {processedDocuments.length} filtrados (Total: {apiData.documents.length})
                </span>
            )}
          </div>

          {cacheNotice && (
            <div className="bg-yellow-50 text-yellow-800 p-3 rounded-xl text-xs font-medium border border-yellow-200 mb-4">
              {cacheNotice}
            </div>
          )}

          {apiData.documents.length > 0 && (
            <div className="bg-white rounded-xl p-4 mb-4 border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3 border-b pb-2">
                <Filter className="w-4 h-4 text-[#921E30]" />
                <h3 className="text-sm font-bold text-[#394049]">Filtros de Búsqueda</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Tipo</label>
                  <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate">
                    <option value="all">Todos los tipos</option>
                    {apiData.documentTypes.map(type => <option key={type.id} value={type.id?.toString()}>{type.name || type.label || `Tipo ${type.id}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Usuario</label>
                  <select value={selectedEntityId} onChange={(e) => setSelectedEntityId(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate">
                    <option value="all">Todos los usuarios</option>
                    {relevantEntities.map(entity => <option key={entity.id} value={entity.id?.toString()}>{entity.name || entity.full_name || entity.email || `Usuario ${entity.id}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Estado</label>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white">
                    <option value="all">Todos los estados</option>
                    <option value="expired">Ya vencidos</option>
                    <option value="critical">Vencen en 30 días</option>
                    <option value="warning">Vencen en 30 a 60 días</option>
                    <option value="valid">Vigentes (+60 días)</option>
                    <option value="non_expiring">No caducables</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Firmas</label>
                  <select value={signatureFilter} onChange={(e) => setSignatureFilter(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white">
                    <option value="all">Todas</option>
                    <option value="pending">Firmas Pendientes</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Ordenar por</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white">
                    <option value="default">Por defecto</option>
                    <option value="days_expired">Días Vencidos (Críticos primero)</option>
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

          {documentsToRender.length > 0 && (
            <div className="space-y-4">
              {documentsToRender.map((doc) => (
                <ApiDocumentCard key={doc.id} doc={doc} entities={apiData.entities} documentTypes={apiData.documentTypes} />
              ))}
              
              {visibleCount < processedDocuments.length && (
                <div className="text-center py-6">
                  <p className="text-xs text-gray-500 mb-3">
                    Mostrando {visibleCount} de {processedDocuments.length} documentos
                  </p>
                  <button 
                    onClick={() => setVisibleCount(prev => prev + 50)}
                    className="bg-white border-2 border-[#921E30] text-[#921E30] px-6 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-red-50 transition-colors"
                  >
                    Cargar más documentos...
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};