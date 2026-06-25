import { useState, useEffect, useMemo } from 'react';
import { FolderOpen, Loader2, FileText, AlertCircle, Filter } from 'lucide-react';
import { getApiUrl } from '../config/api';
import {
  isControlDocSnapshotFresh,
  readControlDocSnapshotAsync,
  saveControlDocSnapshotAsync
} from '../storage/controlDocOffline';
import { findEntityForUser, getScopedDocuments, getUserSnapshotKey, isAdminUser } from '../auth/userScope';
import { ApiDocumentCard } from './ApiDocumentCard'; 
import { clearControlDocProxyCache, fetchControlDocCollection, getControlDocCollectionStats, toArray } from '../controldoc/api';
import { getDocumentEntityIds, getDocumentExpirationDate, getDocumentStatusText, hasExpiredDocumentStatus, hasNonCompliantDocumentStatus, hasPendingSignature, isBlockedDocument, parseControlDocDate } from '../controldoc/fields';

const urls = {
  entities: getApiUrl('/controldoc/entities?refresh=1'),
  documentTypes: getApiUrl('/controldoc/document-types?refresh=1')
};
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = parseControlDocDate(dateString);
  if (!expirationDate) return null;
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const normalizeApiData = (rawData) => {
  const raw = rawData || {};
  return {
    documents: toArray(raw.documents, ['documents', 'items', 'data']),
    entities: toArray(raw.entities, ['entities', 'items', 'data']),
    documentTypes: toArray(raw.documentTypes || raw.document_types, ['documentTypes', 'document_types', 'items', 'data'])
  };
};

const getDocumentComplianceBucket = (doc) => {
  const days = getDaysRemaining(getDocumentExpirationDate(doc));
  const status = getDocumentStatusText(doc);

  if (isBlockedDocument(doc) || hasNonCompliantDocumentStatus(doc) || (days !== null && days < 0)) {
    return 'nonCompliant';
  }

  if (days !== null && days <= 30) return 'critical';
  if (days !== null && days <= 60) return 'warning';
  if (days === null && !status) return 'nonCompliant';
  return 'healthy';
};

export const ViewDocumentos = ({ currentUser, onLoadingProgress }) => {
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
  const snapshotOwnerKey = getUserSnapshotKey(currentUser);
  const canSeeAllUsers = isAdminUser(currentUser);

  useEffect(() => {
    setVisibleCount(50);
  }, [selectedType, selectedEntityId, statusFilter, signatureFilter]);

  useEffect(() => {
    let isCancelled = false;

    const showCachedSnapshot = async () => {
      const snapshot = await readControlDocSnapshotAsync(snapshotOwnerKey);
      if (!snapshot) return false;

      if (isCancelled) return false;
      setApiData(normalizeApiData(snapshot.data));
      const savedAt = new Date(snapshot.savedAt).toLocaleString('es-CL', {
        dateStyle: 'short', timeStyle: 'short'
      });
      setCacheNotice(`Modo offline: mostrando última sincronización (${savedAt}).`);
      return isControlDocSnapshotFresh(snapshot, SNAPSHOT_FRESH_MS, { requireComplete: canSeeAllUsers }) ? 'fresh' : 'stale';
    };

    const fetchAllData = async () => {
      setCacheNotice('');
      const cacheState = await showCachedSnapshot();
      const hasCachedData = Boolean(cacheState);
      if (cacheState === 'fresh') {
        setIsLoading(false);
        return;
      }

      setIsLoading(!hasCachedData); 
      setError(null);
      onLoadingProgress?.({ percent: 8 });
      
      const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };
      let hadFetchError = false;
      let completedRequests = 0;

      const fetchData = async (url) => {
        try {
          const response = await fetch(url, requestOptions);
          if (response.status === 401) {
            throw new Error("Acceso denegado. Por favor, inicia sesión.");
          }
          if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
          const data = await response.json();
          completedRequests += 1;
          onLoadingProgress?.({ percent: 12 + completedRequests * 24 });
          return data;
        } catch (e) {
          hadFetchError = true;
          throw e;
        }
      };

      try {
        if (!hasCachedData) setProgressInfo("Conectando con Compas Marine...");
        await clearControlDocProxyCache(requestOptions);
        
        // El backend ahora emite diccionarios completos y unificados en una sola petición gracias a la optimización
        const [allTypes, allEntities, allDocs] = await Promise.all([
          fetchData(urls.documentTypes),
          fetchData(urls.entities),
          fetchControlDocCollection('/controldoc/documents', {
            fallbackKeys: ['documents', 'items', 'data'],
            requestOptions,
            forceRefresh: true,
            clientPagination: false,
            onPageLoaded: ({ totalItems }) => {
              setProgressInfo(`Cargando documentos... ${totalItems} recibidos`);
              onLoadingProgress?.({ percent: Math.min(88, 12 + Math.floor(totalItems / 100)) });
            }
          })
        ]);

        const documentStats = getControlDocCollectionStats(allDocs);
        const nextApiData = {
          documents: allDocs,
          entities: allEntities,
          documentTypes: allTypes,
          meta: { documents: documentStats }
        };

        if (hadFetchError && toArray(allDocs, ['documents', 'items', 'data']).length === 0 && hasCachedData) {
          setProgressInfo('');
          onLoadingProgress?.({ active: false });
          return;
        }
        
        onLoadingProgress?.({ percent: 90 });
        if (isCancelled) return;
        setApiData(normalizeApiData(nextApiData));
        if (!hadFetchError && (!canSeeAllUsers || documentStats?.complete !== false)) {
          void saveControlDocSnapshotAsync(nextApiData, snapshotOwnerKey);
        }
        onLoadingProgress?.({ percent: 100, done: true });
        
        setProgressInfo('');
      } catch (err) {
        onLoadingProgress?.({ active: false });
        if (!hasCachedData) setError(err.message);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    fetchAllData();

    return () => {
      isCancelled = true;
    };
  }, [snapshotOwnerKey, onLoadingProgress, canSeeAllUsers]);

  const scopedDocuments = useMemo(
    () => getScopedDocuments(apiData.documents, apiData.entities, currentUser),
    [apiData.documents, apiData.entities, currentUser]
  );

  const currentUserEntity = useMemo(
    () => findEntityForUser(apiData.entities, currentUser),
    [apiData.entities, currentUser]
  );

  const inferredUserEntityId = useMemo(() => {
    if (canSeeAllUsers || currentUserEntity?.id) return '';
    return scopedDocuments.flatMap(getDocumentEntityIds)[0] || '';
  }, [canSeeAllUsers, currentUserEntity, scopedDocuments]);

  const activeEntityId = canSeeAllUsers
    ? selectedEntityId
    : currentUserEntity?.id?.toString() || inferredUserEntityId || 'all';

  const relevantEntities = useMemo(() => {
    if (!canSeeAllUsers) {
      return currentUserEntity ? [currentUserEntity] : [];
    }

    const activeEntityIds = new Set(scopedDocuments.flatMap(getDocumentEntityIds));
    return apiData.entities.filter(e => activeEntityIds.has(e.id?.toString()));
  }, [apiData.entities, canSeeAllUsers, currentUserEntity, scopedDocuments]);

  const entityById = useMemo(
    () => new Map(apiData.entities.map(entity => [entity.id?.toString(), entity])),
    [apiData.entities]
  );

  const documentTypeById = useMemo(
    () => new Map(apiData.documentTypes.map(type => [type.id?.toString(), type])),
    [apiData.documentTypes]
  );

  const progressMetrics = useMemo(() => {
    if (canSeeAllUsers && (!activeEntityId || activeEntityId === 'all')) {
      return { percentage: 0, count: 0, total: 0 };
    }

    const userDocs = !canSeeAllUsers || activeEntityId === 'all'
      ? scopedDocuments
      : scopedDocuments.filter(doc => getDocumentEntityIds(doc).includes(activeEntityId));
    const total = userDocs.length;
    const count = userDocs.filter((doc) => {
      return getDocumentComplianceBucket(doc) === 'healthy';
    }).length;

    return {
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      count,
      total,
    };
  }, [activeEntityId, canSeeAllUsers, scopedDocuments]);

  const processedDocuments = useMemo(() => {
    const urgencyValue = (days) => {
      if (days === null) return 10000;
      if (days < 0) return days;
      if (days <= 60) return days;
      return 1000 + days;
    };

    return scopedDocuments
      .map(doc => ({
        doc,
        daysRemaining: getDaysRemaining(getDocumentExpirationDate(doc))
      }))
      .filter(({ doc, daysRemaining }) => {
        const docTypeId = doc.document_type_id?.toString();
        const docEntityIds = getDocumentEntityIds(doc);

        const typeMatch = selectedType === 'all' || docTypeId === selectedType;
        const entityMatch = !canSeeAllUsers || activeEntityId === 'all' || docEntityIds.includes(activeEntityId);
        const signatureMatch = signatureFilter === 'all' || hasPendingSignature(doc);
        const isNotBlocked = !isBlockedDocument(doc);

        let statusMatch = true;
        if (statusFilter !== 'all') {
          if (daysRemaining === null) {
            statusMatch = hasExpiredDocumentStatus(doc)
              ? statusFilter === 'expired'
              : statusFilter === 'valid';
          } else if (statusFilter === 'expired') statusMatch = daysRemaining < 0;
          else if (statusFilter === 'critical') statusMatch = daysRemaining >= 0 && daysRemaining <= 30;
          else if (statusFilter === 'warning') statusMatch = daysRemaining > 30 && daysRemaining <= 60;
          else if (statusFilter === 'valid') statusMatch = daysRemaining > 60;
        }

          return typeMatch && entityMatch && signatureMatch && statusMatch && isNotBlocked;
      })
      .sort((a, b) => urgencyValue(a.daysRemaining) - urgencyValue(b.daysRemaining))
      .map(({ doc }) => doc);
  }, [activeEntityId, canSeeAllUsers, scopedDocuments, selectedType, statusFilter, signatureFilter]);

  const documentsToRender = useMemo(
    () => processedDocuments.slice(0, visibleCount),
    [processedDocuments, visibleCount]
  );

  const totalDocumentsWithoutBlocked = useMemo(
    () => scopedDocuments.filter((doc) => !isBlockedDocument(doc)).length,
    [scopedDocuments]
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
            {totalDocumentsWithoutBlocked > 0 && (
              <span className="text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded-full font-bold shadow-sm inline-flex items-center w-fit">
                 Mostrando {documentsToRender.length} de {processedDocuments.length} (total: {totalDocumentsWithoutBlocked} documentos)
              </span>
            )}

            {activeEntityId && activeEntityId !== 'all' && (
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

          {scopedDocuments.length > 0 && (
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
                {canSeeAllUsers && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Usuario</label>
                    <select value={selectedEntityId} onChange={(e) => setSelectedEntityId(e.target.value)} className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate">
                      <option value="all">Todos los usuarios</option>
                      {relevantEntities.map(entity => <option key={entity.id} value={entity.id?.toString()}>{entity.name || entity.full_name || entity.email || `Usuario ${entity.id}`}</option>)}
                    </select>
                  </div>
                )}
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

          {!isLoading && scopedDocuments.length === 0 && !error && (
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
            </div>
          )}
          
          {visibleCount < processedDocuments.length && (
            <div className="text-center py-6">
              <button 
                onClick={() => setVisibleCount(prev => prev + 50)}
                className="bg-white border border-gray-300 text-[#921E30] px-6 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-red-50 transition-colors"
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
