import { useState, useEffect, useMemo } from 'react';
import { FolderOpen, Loader2, FileText, AlertCircle, Filter, Search, Eye, Tag, User as UserIcon } from 'lucide-react';
import { getApiUrl } from '../config/api'; // <-- IMPORTACIÓN CORREGIDA
import {
  getCalendarDaysRemaining,
  getDocumentEntityId,
  getDocumentExpirationDate,
  getDocumentIssueDate,
  getDocumentRegistrationDate,
  hasBlockedDocumentStatus,
  hasExpiredDocumentStatus,
  parseControlDocDate
} from '../controldoc/fields';
import {
  identifierStartsWith,
  matchesSearchTokenPrefixes,
  normalizeSearchIdentifier,
  normalizeSearchText
} from '../utils/search';

const getUserSnapshotKey = (user) => user?.id ? `user_${user.id}` : 'global';
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;
const isControlDocSnapshotFresh = (snapshot, maxAgeMs) => {
  if (!snapshot || !snapshot.savedAt) return false;
  return (Date.now() - new Date(snapshot.savedAt).getTime()) < maxAgeMs;
};

const readControlDocSnapshot = (key) => {
  try {
    const stored = localStorage.getItem(`controlDocSnapshot_${key}`);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
};

const saveControlDocSnapshot = (data, key) => {
  try {
    localStorage.setItem(`controlDocSnapshot_${key}`, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
  } catch (error) {
    console.warn('No se pudo guardar el respaldo local de ControlDoc:', error);
  }
};

// --- VALIDACIÓN POR ID DE ROL ---
const hasAdminRole = (user) => {
  if (!user) return false;
  if (user.rol_id !== undefined && user.rol_id !== null) {
    return [2, 10, 11, 13].includes(Number(user.rol_id));
  }
  const roleName = (user?.rol || user?.role || '').toLowerCase().trim();
  return ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(roleName) || roleName.includes('admin');
};

// --- COMPONENTE DE TARJETA ESTÉTICO ---
const ApiDocumentCard = ({ doc, documentTypeById, entityById, showEntityName = true }) => {
  const docEntityId = getDocumentEntityId(doc);
  const entity = entityById ? entityById.get(docEntityId) : null;
  const docType = documentTypeById ? documentTypeById.get(doc.document_type_id?.toString()) : null;
  
  const entityName = entity?.full_name || entity?.name || entity?.label || entity?.email || docEntityId || 'Sin Nombre';
  const typeName = docType?.name || docType?.label || docType?.id || doc.document_type_id || 'Documento';

  let status = { label: 'Sin Fecha', bgClass: 'bg-gray-100 text-gray-600 border border-gray-200' };
  const expirationDateValue = getDocumentExpirationDate(doc);
  const issueDateValue = getDocumentIssueDate(doc);
  const registrationDateValue = getDocumentRegistrationDate(doc);

  const isBlocked = isRelevantBlockedDocument(doc);
  const hasExpiredStatus = hasExpiredDocumentStatus(doc);

  if (expirationDateValue) {
    const daysRemaining = getCalendarDaysRemaining(expirationDateValue);

    if (daysRemaining === null) {
      status = { label: 'Sin Fecha', bgClass: 'bg-gray-100 text-gray-600 border-2 border-gray-200' };
    } else if (isBlocked) {
      const blockedDays = daysRemaining > 0 ? daysRemaining : 0;
      status = { label: `Bloqueado (${blockedDays} días)`, bgClass: 'severity-pill-red border-2' };
    } else if (daysRemaining > 60) {
      status = { label: `Vigente por ${daysRemaining} días`, bgClass: 'bg-green-50 text-green-700 border-2 border-green-200' };
    } else if (daysRemaining > 30) {
      status = { label: `Próximo a vencer (${daysRemaining} días)`, bgClass: 'severity-pill-amber border-2' };
    } else if (daysRemaining > 0) {
      status = { label: `Próximo a vencer (${daysRemaining} días)`, bgClass: 'severity-pill-orange border-2' };
    } else if (daysRemaining === 0) {
      status = { label: 'Expira hoy', bgClass: 'severity-pill-red border-2' };
    } else {
      const expired = Math.abs(daysRemaining);
      status = { label: `Expirado hace ${expired} días`, bgClass: 'severity-pill-red border-2' };
    }
  }

  if (!expirationDateValue && hasExpiredStatus) {
    status = { label: 'Vencido', bgClass: 'severity-pill-red border-2' };
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const parsedDate = parseControlDocDate(dateString);
    return parsedDate
      ? parsedDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';
  };

  return (
    <div className="bg-white rounded-2xl p-4 md:p-5 relative overflow-hidden shadow-sm border border-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 mb-3 w-full">
      <div className="absolute top-0 right-0 w-20 h-20 md:w-32 md:h-32 bg-gray-50 rounded-bl-full z-0 pointer-events-none"></div>
      
      <div className="relative z-10 w-full">
        <div className="flex items-center gap-2 mb-2.5 pr-12">
          <FileText className="w-4 h-4 md:w-5 md:h-5 text-[#394049] flex-shrink-0" />
          <h3 className="font-bold text-[#394049] text-xs md:text-sm leading-tight uppercase truncate">
            {doc.label || doc.name || 'Documento'}
          </h3>
        </div>

        <div className="space-y-1.5 mb-3 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
          {showEntityName && (
            <div className="text-xs text-gray-600 flex items-center min-w-0">
              <UserIcon className="w-3.5 h-3.5 mr-2 text-gray-400 flex-shrink-0" />
              <span className="font-semibold text-gray-800 truncate max-w-[200px] xs:max-w-[280px] sm:max-w-none">
                {entityName}
              </span>
            </div>
          )}
          <div className="text-xs text-gray-600 flex items-center min-w-0">
            <Tag className="w-3.5 h-3.5 mr-2 text-gray-400 flex-shrink-0" />
            <span className="truncate text-gray-500 font-medium max-w-[200px] xs:max-w-[280px] sm:max-w-none">
              {typeName}
            </span>
          </div>
        </div>

        <div className="space-y-1.5 mb-3.5 text-xs px-0.5">
          <div className="text-gray-400 flex items-baseline justify-start gap-3">
            <span className="shrink-0">Emisión:</span>
            <span className="font-semibold text-gray-600">{issueDateValue ? formatDate(issueDateValue) : 'No informada'}</span>
          </div>
          <div className="text-gray-400 flex items-baseline justify-start gap-3">
            <span className="shrink-0">Expiración:</span>
            <span className="font-semibold text-gray-600">{formatDate(expirationDateValue)}</span>
          </div>
          {registrationDateValue && (
            <div className="text-gray-400 flex items-baseline justify-start gap-3">
              <span className="shrink-0">Registro en ControlDoc:</span>
              <span className="font-semibold text-gray-600">{formatDate(registrationDateValue)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center w-full">
          <div className={`text-xs font-extrabold text-center px-4 py-1.5 rounded-full border whitespace-nowrap sm:inline-block flex-1 sm:flex-initial ${status.bgClass}`}>
            {status.label}
          </div>
          <a href={`https://compliance.controldoc.legal/documentos/${doc.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold bg-[#394049]/10 text-[#394049] border border-[#394049]/20 px-4 py-2 rounded-xl flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 transition shadow-sm text-center">
            <Eye className="w-3.5 h-3.5 mr-1.5 shrink-0" /> Ver API
          </a>
        </div>

        {isBlocked && doc.blocked_description && (
          <div className="mt-3 bg-red-50 border border-red-200 p-2.5 rounded-xl flex items-start gap-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700 font-medium leading-normal">{doc.blocked_description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const urls = {
  documents: getApiUrl('/controldoc/documents'), 
  entities: getApiUrl('/controldoc/entities'),
  documentTypes: getApiUrl('/controldoc/document-types')
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

const getEntityDisplayName = (entity) => (
  entity?.full_name || entity?.name || entity?.nombre || entity?.label || entity?.email || ''
);

const getEntityRut = (entity) => (
  entity?.rut || entity?.run || entity?.identifier || entity?.numero_de_documento ||
  entity?.custom_fields?.rut || entity?.custom_fields?.run ||
  entity?.custom_fields?.numero_de_documento || entity?.custom_fields?.numero_documento || ''
);

const isRelevantBlockedDocument = (doc) => (
  hasBlockedDocumentStatus(doc) &&
  !doc?.blocked_description?.toString().toLowerCase().includes('cargo')
);

const hasPendingSignature = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  const normalizedString = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  };
  const matchesPendingText = (value) => {
    const lower = normalizedString(value);
    return (
      lower === 'true' || lower === '1' || lower === 'pending' || lower === 'pendiente' ||
      lower.includes('pendiente') || lower.includes('pending') || lower.includes('por firmar') ||
      lower.includes('sin firmar') || lower.includes('to sign') || lower.includes('needs signature') ||
      (lower.includes('signature') && lower.includes('pending'))
    );
  };
  const keysToCheck = ['pending_signature', 'signature_pending', 'pending_signatures', 'pending_signatures_count', 'signature_status', 'signature_state', 'aasm_state', 'state', 'status', 'workflow_state'];
  for (const key of keysToCheck) {
    const value = doc[key];
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    if (matchesPendingText(value)) return true;
  }
  return Object.entries(doc).some(([key, value]) => {
    if (!/pending.*sign|sign.*pending|signature.*pending|pending.*signature|firma|firmas/i.test(key)) return false;
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    return matchesPendingText(value);
  });
};

export const ViewDocumentos = ({ currentUser, focusedCollaborator = null, onCollaboratorChange }) => {
  const [apiData, setApiData] = useState({ documents: [], entities: [], documentTypes: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progressInfo, setProgressInfo] = useState('');
  const [cacheNotice, setCacheNotice] = useState('');
  
  const [selectedType, setSelectedType] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [signatureFilter, setSignatureFilter] = useState('all');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchEntityId, setSelectedSearchEntityId] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);

  const [visibleCount, setVisibleCount] = useState(50);

  // Guía visual
  const [showGuideDocs, setShowGuideDocs] = useState(true);

  const isAdmin = currentUser ? hasAdminRole(currentUser) : false;
  const snapshotOwnerKey = getUserSnapshotKey(currentUser);

  useEffect(() => {
    if (!isAdmin || !focusedCollaborator?.id) return;
    setSelectedSearchEntityId(focusedCollaborator.id.toString());
    setSearchTerm(getEntityDisplayName(focusedCollaborator));
    setIsAutocompleteOpen(false);
  }, [focusedCollaborator, isAdmin]);

  useEffect(() => { setVisibleCount(50); }, [selectedType, statusFilter, signatureFilter, searchTerm, selectedSearchEntityId]);

  useEffect(() => {
    let isCancelled = false;

    const fetchAllData = async () => {
      const snapshot = readControlDocSnapshot(snapshotOwnerKey);
      let hasCachedData = false;

      if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        setApiData(normalizeApiData({
          documents: snapshot.documents || [],
          entities: snapshot.entities || [],
          documentTypes: snapshot.documentTypes || []
        }));
        
        if (isControlDocSnapshotFresh(snapshot, SNAPSHOT_FRESH_MS)) {
          setIsLoading(false);
          setCacheNotice('');
          return; 
        } else {
          hasCachedData = true;
          const savedAt = new Date(snapshot.savedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
          setCacheNotice(`Mostrando datos en caché (${savedAt}). Buscando actualizaciones...`);
        }
      } else {
        setIsLoading(true);
        setCacheNotice('');
      }

      setError(null);
      setProgressInfo("Sincronizando documentos...");

      let hadFetchError = false;

      const fetchData = async (url) => {
        try {
          const separator = url.includes('?') ? '&' : '?';
          const bypassUrl = `${url}${separator}_t=${Date.now()}`;
          const response = await fetch(bypassUrl, { 
              method: 'GET', credentials: 'same-origin', cache: 'no-store',
              headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
          });
          if (response.status === 401) throw new Error("Acceso denegado. Por favor, inicia sesión.");
          if (response.status === 502) throw new Error("El servidor está procesando datos masivos. Por favor, espera 1 minuto.");
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

        if (isCancelled) return;

        const validTypes = allTypes || [];
        const validTypeIds = validTypes.map(t => t.id?.toString());
        const validDocs = (allDocs || []).filter(doc => validTypeIds.includes(doc.document_type_id?.toString()));
        
        const nextApiData = { documents: validDocs, entities: allEntities || [], documentTypes: validTypes };

        if (hadFetchError && validDocs.length === 0 && hasCachedData) {
          setProgressInfo('');
          return;
        }
        
        setApiData(normalizeApiData(nextApiData));
        if (!hadFetchError && !isAdmin) saveControlDocSnapshot(nextApiData, snapshotOwnerKey);
        
        setProgressInfo('');
        setCacheNotice('');
      } catch (err) {
        if (!hasCachedData) setError(err.message);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    fetchAllData();

    return () => { isCancelled = true; };
  }, [currentUser, isAdmin, snapshotOwnerKey]);

  // CONFIANZA CIEGA EN EL BACKEND: Lo que llega es lo que se pinta.
  const baseDocuments = apiData.documents;

  const relevantEntities = useMemo(() => {
    if (!isAdmin) return apiData.entities.length > 0 ? [apiData.entities[0]] : [];

    const activeEntityIds = new Set(baseDocuments.map(d => d.entity_id?.toString() || d.abstract_entity_id?.toString()).filter(id => id && id !== 'undefined' && id !== 'null'));
    const usersMap = new Map();
    apiData.entities.forEach(e => {
      if (e && e.id) usersMap.set(e.id.toString(), { ...e, id: e.id.toString(), name: getEntityDisplayName(e) || `Colaborador ${e.id}` });
    });

    const finalUsers = [];
    activeEntityIds.forEach(id => {
      if (usersMap.has(id)) finalUsers.push(usersMap.get(id));
      else finalUsers.push({ id: id, name: `Colaborador ID: ${id}` });
    });

    return finalUsers.sort((a, b) => a.name.localeCompare(b.name));
  }, [isAdmin, baseDocuments, apiData.entities]);

  const entityById = useMemo(() => new Map(apiData.entities.map(entity => [entity.id?.toString(), entity])), [apiData.entities]);
  const documentTypeById = useMemo(() => new Map(apiData.documentTypes.map(type => [type.id?.toString(), type])), [apiData.documentTypes]);

  const processedDocuments = useMemo(() => {
    const urgencyValue = (days) => {
      if (days === null) return 10000;
      if (days < 0) return days;
      if (days <= 60) return days;
      return 1000 + days;
    };

    const query = normalizeSearchText(searchTerm);
    const identifierQuery = normalizeSearchIdentifier(searchTerm);
    const isIdentifierSearch = /\d/.test(searchTerm);

    return baseDocuments
      .map(doc => ({ doc, daysRemaining: getCalendarDaysRemaining(getDocumentExpirationDate(doc)) }))
      .filter(({ doc, daysRemaining }) => {
        const docTypeId = doc.document_type_id?.toString();
        const docEntityId = doc.entity_id?.toString() || doc.abstract_entity_id?.toString();

        const typeMatch = selectedType === 'all' || docTypeId === selectedType;
        const signatureMatch = signatureFilter === 'all' || hasPendingSignature(doc);
        const isNotBlocked = !isRelevantBlockedDocument(doc);
        const hasExpiredStatus = hasExpiredDocumentStatus(doc);
        const entity = entityById.get(docEntityId);
        const entityName = getEntityDisplayName(entity);
        const entityRut = getEntityRut(entity);
        const collaboratorMatch = selectedSearchEntityId
          ? docEntityId === selectedSearchEntityId
          : isIdentifierSearch
            ? identifierStartsWith(entityRut, identifierQuery)
            : matchesSearchTokenPrefixes(query, entityName);
        const searchMatch = query === '' || collaboratorMatch;

        let statusMatch = true;
        if (statusFilter !== 'all') {
          if (statusFilter === 'expired') statusMatch = hasExpiredStatus || (daysRemaining !== null && daysRemaining < 0);
          else if (daysRemaining === null || hasExpiredStatus) statusMatch = false;
          else if (statusFilter === 'critical') statusMatch = daysRemaining >= 0 && daysRemaining <= 30;
          else if (statusFilter === 'warning') statusMatch = daysRemaining > 30 && daysRemaining <= 60;
          else if (statusFilter === 'valid') statusMatch = daysRemaining > 60;
        }

        return typeMatch && signatureMatch && statusMatch && isNotBlocked && searchMatch;
      })
      .sort((a, b) => urgencyValue(a.daysRemaining) - urgencyValue(b.daysRemaining))
      .map(({ doc }) => doc);
  }, [baseDocuments, selectedType, statusFilter, signatureFilter, searchTerm, selectedSearchEntityId, entityById]);

  const documentsToRender = useMemo(() => processedDocuments.slice(0, visibleCount), [processedDocuments, visibleCount]);
  const totalDocumentsWithoutBlocked = useMemo(() => baseDocuments.filter((doc) => !isRelevantBlockedDocument(doc)).length, [baseDocuments]);

  const searchSuggestions = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const identifierQuery = normalizeSearchIdentifier(searchTerm);
    const isIdentifierSearch = /\d/.test(searchTerm);

    return relevantEntities
      .filter((entity) => (
        isIdentifierSearch
          ? identifierStartsWith(getEntityRut(entity), identifierQuery)
          : matchesSearchTokenPrefixes(searchTerm, getEntityDisplayName(entity))
      ))
      .slice(0, 8);
  }, [relevantEntities, searchTerm]);

  const handleSelectSuggestion = (entity) => {
    setSelectedSearchEntityId(entity.id?.toString() || '');
    setSearchTerm(getEntityDisplayName(entity));
    setIsAutocompleteOpen(false);
    onCollaboratorChange?.(entity);
  };
  const handleClearSelection = () => {
    setSearchTerm('');
    setSelectedSearchEntityId('');
    setIsAutocompleteOpen(false);
    onCollaboratorChange?.(null);
  };

  const selectedSearchEntity = entityById.get(selectedSearchEntityId) || focusedCollaborator;
  const documentsTitle = isAdmin
    ? selectedSearchEntity?.id
      ? `Documentos de ${getEntityDisplayName(selectedSearchEntity)}`
      : 'Documentos'
    : 'Mis Documentos';

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in w-full bg-gray-50">
      <div className="bg-[#394049] p-4 md:p-5 flex items-center justify-between flex-shrink-0 shadow-md">
        <h2 className="text-white text-lg md:text-xl font-semibold flex items-center">
          <FolderOpen className="w-5 h-5 md:w-6 md:h-6 mr-2 shrink-0 text-gray-300" /> <span>{documentsTitle}</span>
        </h2>
      </div>

      <main className="pwa-scroll-content flex-1 overflow-y-auto scrollable-content bg-gray-50">
        <div className="p-4 md:p-6 max-w-7xl mx-auto w-full space-y-4">
          
          {showGuideDocs && (
            <div 
              onClick={() => setShowGuideDocs(false)}
              className="bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 p-2.5 rounded-lg text-xs font-medium flex items-center justify-between cursor-pointer transition-all hover:bg-zinc-200 dark:hover:bg-zinc-800 select-none"
              title="Haz clic para descartar"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0">ℹ️</span>
                <span className="leading-snug break-words">
                  {isAdmin 
                    ? '📁 Busca colaboradores por nombre o RUT y combina la búsqueda con los filtros de tipo, estado y firma para encontrar sus documentos.'
                    : '📄 Revisa aquí todos tus documentos. Usa los filtros para encontrar rápidamente lo que necesitas. Descarga copias o visualiza detalles en el portal de ControlDoc.'}
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold ml-2 shrink-0">✕</span>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {totalDocumentsWithoutBlocked > 0 && (
              <span className="text-[11px] md:text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded-full font-bold shadow-sm inline-flex items-center w-fit">
                 Mostrando {documentsToRender.length} de {processedDocuments.length} (Total: {totalDocumentsWithoutBlocked} documentos)
              </span>
            )}
          </div>

          {cacheNotice && (
            <div className="bg-yellow-50 text-yellow-800 p-3 rounded-xl text-xs font-medium border border-yellow-100 shadow-sm">{cacheNotice}</div>
          )}

          {baseDocuments.length > 0 && (
            <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-50 pb-2">
                <Filter className="w-4 h-4 text-[#921E30]" />
                <h3 className="text-sm font-bold text-gray-800">Filtros de Búsqueda</h3>
              </div>
              
              {isAdmin && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Buscar colaborador</label>
                  <div className="relative">
                    <div className="relative bg-white rounded-xl border border-gray-200 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setSelectedSearchEntityId(''); setIsAutocompleteOpen(true); }} onFocus={() => setIsAutocompleteOpen(true)} autoComplete="off" placeholder="Busca un colaborador por nombre o RUT..." className="w-full bg-transparent py-2.5 pl-10 pr-10 focus:outline-none text-sm text-gray-700 placeholder-gray-400" />
                      {searchTerm && (<button type="button" onClick={handleClearSelection} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold text-xs">✕</button>)}
                    </div>
                    {isAutocompleteOpen && searchSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto">
                        {searchSuggestions.map((entity) => (
                          <button key={entity.id} type="button" onClick={() => handleSelectSuggestion(entity)} className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-b-0">
                            <p className="text-sm font-semibold text-gray-700 truncate">{getEntityDisplayName(entity)}</p>
                            <p className="text-[11px] text-[#921E30] mt-0.5">RUT: {getEntityRut(entity) || 'Sin RUT'}</p>
                          </button>
                        ))}
                      </div>
                    )}
                    {isAutocompleteOpen && searchTerm.trim() && searchSuggestions.length === 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 p-4 text-xs text-gray-500">
                        No se encontraron colaboradores con ese nombre o RUT.
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider">Tipo</label>
                  <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate">
                    <option value="all">Todos los tipos</option>
                    {apiData.documentTypes.map(type => <option key={type.id} value={type.id?.toString()}>{type.name || type.label || `Tipo ${type.id}`}</option>)}
                  </select>
                </div>
                
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

          {!isLoading && baseDocuments.length === 0 && !error && (
            <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100 shadow-sm">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">No tienes documentos cargados.</p>
            </div>
          )}

          {documentsToRender.length > 0 && (
            <div className="space-y-3">
              {documentsToRender.map((doc) => (
                <ApiDocumentCard key={doc.id} doc={doc} entityById={entityById} documentTypeById={documentTypeById} showEntityName={isAdmin} />
              ))}
            </div>
          )}
          
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
