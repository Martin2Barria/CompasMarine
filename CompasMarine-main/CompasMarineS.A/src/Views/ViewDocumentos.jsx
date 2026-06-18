import { useState, useEffect, useMemo } from 'react';
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

const hasPendingSignature = (doc) => {
  if (!doc || typeof doc !== 'object') return false;

  const normalizedString = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  };

  const matchesPendingText = (value) => {
    const lower = normalizedString(value);
    return (
      lower === 'true' ||
      lower === '1' ||
      lower === 'pending' ||
      lower === 'pendiente' ||
      lower.includes('pendiente') ||
      lower.includes('pending') ||
      lower.includes('por firmar') ||
      lower.includes('sin firmar') ||
      lower.includes('to sign') ||
      lower.includes('needs signature') ||
      lower.includes('signature') && lower.includes('pending')
    );
  };

  const keysToCheck = [
    'pending_signature',
    'signature_pending',
    'pending_signatures',
    'pending_signatures_count',
    'signature_status',
    'signature_state',
    'aasm_state',
    'state',
    'status',
    'workflow_state'
  ];

  for (const key of keysToCheck) {
    const value = doc[key];
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    if (matchesPendingText(value)) return true;
  }

  return Object.entries(doc).some(([key, value]) => {
    if (!/pending.*sign|sign.*pending|signature.*pending|pending.*signature|firma|firmas/i.test(key)) {
      return false;
    }
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    return matchesPendingText(value);
  });
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

  const [visibleCount, setVisibleCount] = useState(50);

  // 1. Resetear el contador al filtrar
  useEffect(() => {
    setVisibleCount(50);
  }, [selectedType, selectedEntityId, statusFilter, signatureFilter]);

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
          } catch {
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

        const validTypes = allTypes;
        
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

  const relevantEntities = useMemo(() => {
    const activeEntityIds = new Set(apiData.documents.map(d => d.entity_id?.toString()));
    return apiData.entities.filter(e => activeEntityIds.has(e.id?.toString()));
  }, [apiData.documents, apiData.entities]);

  const entityById = useMemo(
    () => new Map(apiData.entities.map(entity => [entity.id?.toString(), entity])),
    [apiData.entities]
  );

  const documentTypeById = useMemo(
    () => new Map(apiData.documentTypes.map(type => [type.id?.toString(), type])),
    [apiData.documentTypes]
  );

  const progressMetrics = useMemo(() => {
    if (selectedEntityId === 'all') {
      return { percentage: 0, count: 0, total: 0 };
    }

    const userDocs = apiData.documents.filter(doc => doc.entity_id?.toString() === selectedEntityId);
    const total = userDocs.length;
    const count = userDocs.filter((doc) => {
      const days = getDaysRemaining(doc.expires_at);
      return days === null || days > 30;
    }).length;

    return {
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      count,
      total,
    };
  }, [apiData.documents, selectedEntityId]);

  const processedDocuments = useMemo(() => {
    const urgencyValue = (days) => {
      if (days === null) return 10000;
      if (days < 0) return days;
      if (days <= 60) return days;
      return 1000 + days;
    };

    return apiData.documents
      .map(doc => ({
        doc,
        daysRemaining: getDaysRemaining(doc.expires_at)
      }))
      .filter(({ doc, daysRemaining }) => {
        const docTypeId = doc.document_type_id?.toString();
        const docEntityId = doc.entity_id?.toString();

        const typeMatch = selectedType === 'all' || docTypeId === selectedType;
        const entityMatch = selectedEntityId === 'all' || docEntityId === selectedEntityId;
        const signatureMatch = signatureFilter === 'all' || hasPendingSignature(doc);

        let statusMatch = true;
        if (statusFilter !== 'all') {
          if (daysRemaining === null) {
            statusMatch = statusFilter === 'valid';
          } else if (statusFilter === 'expired') statusMatch = daysRemaining < 0;
          else if (statusFilter === 'critical') statusMatch = daysRemaining >= 0 && daysRemaining <= 30;
          else if (statusFilter === 'warning') statusMatch = daysRemaining > 30 && daysRemaining <= 60;
          else if (statusFilter === 'valid') statusMatch = daysRemaining > 60;
        }

        return typeMatch && entityMatch && signatureMatch && statusMatch;
      })
      .sort((a, b) => urgencyValue(a.daysRemaining) - urgencyValue(b.daysRemaining))
      .map(({ doc }) => doc);
  }, [apiData.documents, selectedType, selectedEntityId, statusFilter, signatureFilter]);

  const documentsToRender = useMemo(
    () => processedDocuments.slice(0, visibleCount),
    [processedDocuments, visibleCount]
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] p-5 flex items-center justify-between flex-shrink-0">
        <h2 className="text-white text-xl font-semibold flex items-center">
          <FolderOpen className="w-6 h-6 mr-2" /> Mis Documentos
        </h2>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-6">
        <div className="border-t border-gray-200 pt-6">
          <div className="flex flex-col gap-4 mb-4">
            {apiData.documents.length > 0 && (
              <span className="text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded-full font-bold shadow-sm inline-flex items-center">
                Mostrando {documentsToRender.length} de {processedDocuments.length} filtrados (Total: {apiData.documents.length})
              </span>
            )}

            {selectedEntityId !== 'all' && (
              <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <h3 className="text-sm font-bold text-[#394049] uppercase">Avance del Trabajador</h3>
                    <p className="text-xs text-gray-500">Documentos vigentes del trabajador seleccionado</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-[#921E30]">{progressMetrics.percentage}%</span>
                    <p className="text-xs font-semibold text-gray-500">{progressMetrics.count} de {progressMetrics.total} documentos</p>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 mt-3 overflow-hidden">
                  <div
                    className="bg-[#921E30] h-3 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${progressMetrics.percentage}%` }}
                  ></div>
                </div>
              </div>
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
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Firmas</label>
                  <select value={signatureFilter} onChange={(e) => setSignatureFilter(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white">
                    <option value="all">Todas</option>
                    <option value="pending">Firmas Pendientes</option>
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
                <ApiDocumentCard
                  key={doc.id}
                  doc={doc}
                  entities={apiData.entities}
                  documentTypes={apiData.documentTypes}
                  entityById={entityById}
                  documentTypeById={documentTypeById}
                />
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
