import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FolderOpen, Loader2, FileText, AlertCircle, Filter, Search } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { readControlDocSnapshot, saveControlDocSnapshot } from '../storage/controlDocOffline';
import { ApiDocumentCard } from './ApiDocumentCard'; 

const urls = {
  documents: getApiUrl('/controldoc/documents'), 
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

const toArray = (value, fallbackKeys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of fallbackKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  const dynamicArrayKey = Object.keys(value).find((key) => Array.isArray(value[key]));
  return dynamicArrayKey ? value[dynamicArrayKey] : [];
};

const normalizeApiData = (rawData) => {
  const raw = rawData || {};
  return {
    documents: toArray(raw.documents, ['documents', 'items', 'data']),
    entities: toArray(raw.entities, ['entities', 'items', 'data']),
    documentTypes: toArray(raw.documentTypes || raw.document_types, ['documentTypes', 'document_types', 'items', 'data'])
  };
};

const normalizeText = (value) => (value || '').toString().trim().toLowerCase();

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
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);

  const [visibleCount, setVisibleCount] = useState(50);

  const isAdmin = apiData.entities.length > 1;

  useEffect(() => {
    setVisibleCount(50);
  }, [selectedType, selectedEntityId, statusFilter, signatureFilter]);

  useEffect(() => {
    const showCachedSnapshot = () => {
      const snapshot = readControlDocSnapshot();
      if (!snapshot) return false;

      setApiData(normalizeApiData(snapshot.data));
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

      const fetchData = async (url) => {
        try {
          const response = await fetch(url, requestOptions);
          if (response.status === 401) {
            throw new Error("Acceso denegado. Por favor, inicia sesión.");
          }
          if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
          return await response.json();
        } catch (e) {
          hadFetchError = true;
          throw e;
        }
      };

      try {
        if (!hasCachedData) setProgressInfo("Conectando con Compas Marine...");
        
        const [allTypes, allEntities, allDocs] = await Promise.all([
          fetchData(urls.documentTypes),
          fetchData(urls.entities),
          fetchData(urls.documents)
        ]);

        const validTypes = allTypes || [];
        const validTypeIds = validTypes.map(t => t.id?.toString());
        const validDocs = (allDocs || []).filter(doc => validTypeIds.includes(doc.document_type_id?.toString()));
        
        const nextApiData = {
          documents: validDocs,
          entities: allEntities || [],
          documentTypes: validTypes
        };

        if (hadFetchError && validDocs.length === 0 && hasCachedData) {
          setProgressInfo('');
          return;
        }
        
        setApiData(normalizeApiData(nextApiData));
        if (!hadFetchError) saveControlDocSnapshot(nextApiData);
        
        setProgressInfo('');
      } catch (err) {
        if (!hasCachedData) setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []);

  const relevantEntities = useMemo(() => {
    const activeEntityIds = new Set(
      apiData.documents
        .map(d => d.entity_id?.toString())
        .filter(id => id && id !== 'undefined' && id !== 'null')
    );

    const usersMap = new Map();
    
    apiData.entities.forEach(e => {
      if (e && e.id) {
        usersMap.set(e.id.toString(), {
          id: e.id.toString(),
          name: e.full_name || e.name || e.email || `Usuario ${e.id}`
        });
      }
    });

    const finalUsers = [];
    activeEntityIds.forEach(id => {
      if (usersMap.has(id)) {
        finalUsers.push(usersMap.get(id));
      } else {
        finalUsers.push({ id: id, name: `ID ControlDoc: ${id}` });
      }
    });

    return finalUsers.sort((a, b) => a.name.localeCompare(b.name));
  }, [apiData.documents, apiData.entities]);

  const entityById = useMemo(
    () => new Map(apiData.entities.map(entity => [entity.id?.toString(), entity])),
    [apiData.entities]
  );

  const documentTypeById = useMemo(
    () => new Map(apiData.documentTypes.map(type => [type.id?.toString(), type])),
    [apiData.documentTypes]
  );

  const getDocumentDisplayName = useCallback((doc) => {
    const type = documentTypeById.get(doc.document_type_id?.toString());
    const typeName = type?.name || type?.label || '';
    const docLabel = doc.label || doc.name || '';
    return `${typeName} ${docLabel}`.trim() || `Documento ${doc.id || ''}`;
  }, [documentTypeById]);

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

    const query = normalizeText(searchTerm);

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
        const isNotBlocked = doc.aasm_state !== 'blocked';
        const searchableText = [
          getDocumentDisplayName(doc),
          doc.label,
          doc.name,
          doc.id,
          doc.document_type_id
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const searchMatch = query === '' || searchableText.includes(query);

        let statusMatch = true;
        if (statusFilter !== 'all') {
          if (daysRemaining === null) {
            statusMatch = statusFilter === 'valid';
          } else if (statusFilter === 'expired') statusMatch = daysRemaining < 0;
          else if (statusFilter === 'critical') statusMatch = daysRemaining >= 0 && daysRemaining <= 30;
          else if (statusFilter === 'warning') statusMatch = daysRemaining > 30 && daysRemaining <= 60;
          else if (statusFilter === 'valid') statusMatch = daysRemaining > 60;
        }

        return typeMatch && entityMatch && signatureMatch && statusMatch && isNotBlocked && searchMatch;
      })
      .sort((a, b) => urgencyValue(a.daysRemaining) - urgencyValue(b.daysRemaining))
      .map(({ doc }) => doc);
  }, [apiData.documents, selectedType, selectedEntityId, statusFilter, signatureFilter, searchTerm, getDocumentDisplayName]);

  const documentsToRender = useMemo(
    () => processedDocuments.slice(0, visibleCount),
    [processedDocuments, visibleCount]
  );

  const totalDocumentsWithoutBlocked = useMemo(
    () => apiData.documents.filter((doc) => doc.aasm_state !== 'blocked').length,
    [apiData.documents]
  );

  const searchSuggestions = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return processedDocuments.slice(0, 6);
  }, [processedDocuments, searchTerm]);

  const handleSelectSuggestion = (doc) => {
    setSearchTerm(getDocumentDisplayName(doc));
    setIsAutocompleteOpen(false);
  };

  const handleClearSelection = () => {
    setSearchTerm('');
    setIsAutocompleteOpen(false);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in w-full">
      {/* Cabecera Responsiva */}
      <div className="bg-[#394049] p-4 md:p-5 flex items-center justify-between flex-shrink-0 shadow-md">
        <h2 className="text-white text-lg md:text-xl font-semibold flex items-center">
          <FolderOpen className="w-5 h-5 md:w-6 md:h-6 mr-2 shrink-0 text-gray-300" /> 
          <span>Mis Documentos</span>
        </h2>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-4 md:p-6 max-w-7xl mx-auto w-full">
        <div className="space-y-4">
          
          {/* Indicadores de Conteo y Avance del Trabajador */}
          <div className="flex flex-col gap-4">
            {totalDocumentsWithoutBlocked > 0 && (
              <span className="text-[11px] md:text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded-full font-bold shadow-sm inline-flex items-center w-fit">
                 Mostrando {documentsToRender.length} de {processedDocuments.length} (Total: {totalDocumentsWithoutBlocked} documentos)
              </span>
            )}

            {selectedEntityId !== 'all' && (
              <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Avance del Trabajador</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Documentos vigentes del colaborador seleccionado</p>
                  </div>
                  <div className="flex items-baseline sm:text-right gap-2 sm:flex-col sm:gap-0">
                    <span className="text-2xl font-black text-[#921E30]">{progressMetrics.percentage}%</span>
                    <p className="text-xs font-semibold text-gray-400">{progressMetrics.count} de {progressMetrics.total} docs</p>
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
            <div className="bg-yellow-50 text-yellow-800 p-3 rounded-xl text-xs font-medium border border-yellow-100 shadow-sm">
              {cacheNotice}
            </div>
          )}

          {/* Panel Rediseñado de Filtros de Búsqueda */}
          {apiData.documents.length > 0 && (
            <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-50 pb-2">
                <Filter className="w-4 h-4 text-[#921E30]" />
                <h3 className="text-sm font-bold text-gray-800">Filtros de Búsqueda</h3>
              </div>
              
              {/* Bloque de entrada del Buscador */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Buscar Documento</label>
                <div className="relative">
                  <div className="relative bg-white rounded-xl border border-gray-200 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setIsAutocompleteOpen(true);
                      }}
                      onFocus={() => setIsAutocompleteOpen(true)}
                      placeholder="Busca por nombre o tipo de documento..."
                      className="w-full bg-transparent py-2.5 pl-10 pr-10 focus:outline-none text-sm text-gray-700 placeholder-gray-400"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={handleClearSelection}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {isAutocompleteOpen && searchSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto">
                      {searchSuggestions.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => handleSelectSuggestion(doc)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-b-0"
                        >
                          <p className="text-sm font-semibold text-gray-700 truncate">{getDocumentDisplayName(doc)}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">ID: {doc.id}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Selectores Adaptables (Móvil vertical, Desktop horizontal) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider">Tipo</label>
                  <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate">
                    <option value="all">Todos los tipos</option>
                    {apiData.documentTypes.map(type => <option key={type.id} value={type.id?.toString()}>{type.name || type.label || `Tipo ${type.id}`}</option>)}
                  </select>
                </div>
                
                {isAdmin && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider">Usuario</label>
                    <select value={selectedEntityId} onChange={(e) => setSelectedEntityId(e.target.value)} className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate">
                      <option value="all">Todos los usuarios</option>
                      {relevantEntities.map(entity => <option key={entity.id} value={entity.id?.toString()}>{entity.name}</option>)}
                    </select>
                  </div>
                )}
                
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider">Estado</label>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white">
                    <option value="all">Todos los estados</option>
                    <option value="expired">Ya vencidos</option>
                    <option value="critical">Vencen en 30 días</option>
                    <option value="warning">Vencen en 30 a 60 días</option>
                    <option value="valid">Vigentes (+60 días)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider">Firmas</label>
                  <select value={signatureFilter} onChange={(e) => setSignatureFilter(e.target.value)} className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white">
                    <option value="all">Todas</option>
                    <option value="pending">Firmas Pendientes</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Indicadores de Carga y Errores */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin text-[#921E30] mb-3" />
              <p className="text-sm font-medium">{progressInfo}</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-xs font-medium border border-red-100 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-bold text-sm">Problema de conexión</span>
              </div>
              <p>{error}</p>
            </div>
          )}

          {!isLoading && apiData.documents.length === 0 && !error && (
            <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100 shadow-sm">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">No tienes documentos cargados.</p>
            </div>
          )}

          {/* Listado de Tarjetas de Documentos */}
          {documentsToRender.length > 0 && (
            <div className="space-y-3">
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
            </div>
          )}
          
          {/* Botón Paginador */}
          {visibleCount < processedDocuments.length && (
            <div className="text-center py-4">
              <button 
                onClick={() => setVisibleCount(prev => prev + 50)}
                className="w-full sm:w-auto bg-white border border-gray-200 text-[#921E30] px-6 py-2.5 rounded-xl text-xs font-bold shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                Cargar más documentos...
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};