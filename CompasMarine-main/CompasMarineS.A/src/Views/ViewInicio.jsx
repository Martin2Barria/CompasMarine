import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, User, Clock, PenTool, Globe, ShieldAlert } from 'lucide-react';
import { getApiUrl } from '../config/api';
import {
  isControlDocSnapshotFresh,
  readControlDocSnapshotAsync,
  saveControlDocSnapshotAsync
} from '../storage/controlDocOffline';
import { findEntityForUser, getScopedDocuments, getUserSnapshotKey, isAdminUser as hasAdminRole } from '../auth/userScope';
import { evaluateDocumentNotificationRules } from '../pwa/notificationRules';
import { clearControlDocProxyCache, fetchControlDocCollection, getControlDocCollectionStats, toArray } from '../controldoc/api';
import { getDocumentEntityIds, getDocumentExpirationDate, hasPendingSignature, isBlockedDocument } from '../controldoc/fields';

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = new Date(dateString);
  if (Number.isNaN(expirationDate.getTime())) return null;
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const calculateHealthyPercentage = (documents) => {
  if (!documents.length) return 100;

  const healthyDocs = documents.filter((doc) => {
    const days = getDaysRemaining(getDocumentExpirationDate(doc));
    return days === null || days > 30;
  }).length;

  return Math.round((healthyDocs / documents.length) * 100);
};

const normalizeText = (value) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const normalizeIdentifier = (value) => normalizeText(value).replace(/[^a-z0-9]/g, '');
const splitSearchTokens = (value) => normalizeText(value).split(/\s+/).filter(Boolean);

const ENTITY_RUT_KEYS = [
  'rut',
  'run',
  'identifier',
  'numero_de_documento',
  'numero documento',
  'numero_de_identificacion',
  'document_number',
  'identification',
  'legal_id',
  'dni'
];

const normalizeFieldKey = (value) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const getEntityFieldValue = (entity, candidateKeys) => {
  if (!entity) return '';
  for (const key of candidateKeys) {
    const directValue = entity?.[key];
    if (directValue !== undefined && directValue !== null && `${directValue}`.trim() !== '') {
      return directValue;
    }
  }
  const normalizedCandidates = candidateKeys.map(normalizeFieldKey);
  const nestedSources = [
    entity?.custom_fields, entity?.customFields, entity?.fields,
    entity?.attributes, entity?.metadata, entity?.meta,
    entity?.profile, entity?.data
  ].filter(Boolean);

  for (const source of nestedSources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const rawKey = item?.key || item?.name || item?.label || item?.field || item?.slug;
        const rawValue = item?.value ?? item?.content ?? item?.text ?? item?.data;
        const normalizedKey = normalizeFieldKey(rawKey);
        if (normalizedCandidates.includes(normalizedKey) && rawValue !== undefined && rawValue !== null && `${rawValue}`.trim() !== '') {
          return rawValue;
        }
      }
      continue;
    }
    if (typeof source === 'object') {
      for (const [rawKey, rawValue] of Object.entries(source)) {
        const normalizedKey = normalizeFieldKey(rawKey);
        if (normalizedCandidates.includes(normalizedKey) && rawValue !== undefined && rawValue !== null && `${rawValue}`.trim() !== '') {
          return rawValue;
        }
      }
    }
  }
  return '';
};

const formatInfoValue = (value) => {
  if (value === undefined || value === null) return 'No informado';
  const normalized = `${value}`.trim();
  return normalized === '' ? 'No informado' : normalized;
};

const getEntityDisplayName = (entity) => {
  if (!entity) return 'Usuario';
  return entity.full_name || entity.name || entity.email || `Usuario ${entity.id || ''}`;
};

const getCurrentUserDisplayName = (user) => {
  if (!user) return 'Usuario';
  return user.nombre || user.name || user.full_name || user.email || `Usuario ${user.id || ''}`;
};

const getEntityRut = (entity) => getEntityFieldValue(entity, ENTITY_RUT_KEYS);
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;

export const ViewInicio = ({ setView, currentUser, onLoadingProgress }) => {
  const [allDocs, setAllDocs] = useState([]);
  const [allEntities, setAllEntities] = useState([]);
  const [allTypes, setAllTypes] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStats, setSyncStats] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const snapshotOwnerKey = getUserSnapshotKey(currentUser);

  const processData = useCallback((docs, entities, types) => {
    const normalizedDocs = toArray(docs, ['documents', 'data', 'items']);
    const normalizedEntities = toArray(entities, ['entities', 'data', 'items']);
    const normalizedTypes = toArray(types, ['documentTypes', 'document_types', 'data', 'items']);

    setAllDocs(normalizedDocs);
    setAllEntities(normalizedEntities);
    setAllTypes(normalizedTypes);

    if (!hasAdminRole(currentUser)) {
      const notificationDocs = getScopedDocuments(normalizedDocs, normalizedEntities, currentUser);
      void evaluateDocumentNotificationRules({
        documents: notificationDocs,
        documentTypes: normalizedTypes,
        percentage: calculateHealthyPercentage(notificationDocs)
      });
    }
  }, [currentUser]);

  useEffect(() => {
    let isCancelled = false;

    const fetchFreshData = async ({ forceRefresh }) => {
      setIsSyncing(true);
      onLoadingProgress?.({ percent: 8 });
      try {
        const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };
        let completedRequests = 0;

        const fetchJson = async (url) => {
          const response = await fetch(url, requestOptions);
          if (!response.ok) {
            throw new Error(`No se pudo sincronizar inicio (${response.status})`);
          }

          const data = await response.json();
          completedRequests += 1;
          onLoadingProgress?.({ percent: 12 + completedRequests * 24 });
          return data;
        };

        if (forceRefresh) {
          await clearControlDocProxyCache(requestOptions);
        }
        
        const [docs, entities, types] = await Promise.all([
          fetchControlDocCollection('/controldoc/documents', {
            fallbackKeys: ['documents', 'data', 'items'],
            requestOptions,
            forceRefresh,
            clientPagination: false,
            onPageLoaded: ({ page, totalItems }) => {
              setSyncStats({ source: 'api', complete: false, pagesLoaded: page, totalItems, stopReason: 'loading' });
              onLoadingProgress?.({ percent: Math.min(88, 12 + Math.floor(totalItems / 100)) });
            }
          }),
          fetchJson(getApiUrl('/controldoc/entities?refresh=1')),
          fetchJson(getApiUrl('/controldoc/document-types?refresh=1'))
        ]);

        onLoadingProgress?.({ percent: 92 });
        if (isCancelled) return;
        const documentStats = getControlDocCollectionStats(docs);
        setSyncStats({ source: 'api', ...(documentStats || {}), totalItems: docs.length });
        const nextData = {
          documents: docs,
          entities: toArray(entities, ['entities', 'data', 'items']),
          documentTypes: toArray(types, ['documentTypes', 'document_types', 'data', 'items']),
          meta: { documents: documentStats }
        };
        processData(nextData.documents, nextData.entities, nextData.documentTypes);
        if (!hasAdminRole(currentUser) || documentStats?.complete !== false) {
          void saveControlDocSnapshotAsync(nextData, snapshotOwnerKey);
        }
        onLoadingProgress?.({ percent: 100, done: true });
      } catch (error) {
        onLoadingProgress?.({ active: false });
        console.error('Error sincronizando inicio:', error);
      } finally {
        if (!isCancelled) setIsSyncing(false);
      }
    };

    const loadData = async () => {
      const snapshot = await readControlDocSnapshotAsync(snapshotOwnerKey);
      if (isCancelled) return;

      if (snapshot?.data) {
        processData(snapshot.data.documents || [], snapshot.data.entities || [], snapshot.data.documentTypes || []);
        setSyncStats({
          source: 'cache',
          ...(snapshot.meta?.documents || {}),
          totalItems: snapshot.data.documents?.length || 0
        });
      }

      if (refreshToken === 0 && isControlDocSnapshotFresh(snapshot, SNAPSHOT_FRESH_MS, { requireComplete: hasAdminRole(currentUser) })) {
        setIsSyncing(false);
        return;
      }

      await fetchFreshData({ forceRefresh: true });
    };

    loadData();

    return () => {
      isCancelled = true;
    };
  }, [currentUser, snapshotOwnerKey, processData, onLoadingProgress, refreshToken]);

  const getDocName = useCallback((doc) => {
    let typeName = '';
    if (allTypes && allTypes.length > 0) {
      const type = allTypes.find((t) => t.id?.toString() === doc.document_type_id?.toString());
      if (type) typeName = type.name || type.label || '';
    }
    const docLabel = doc.label || '';
    const combinedName = `${typeName} ${docLabel}`.trim();
    return combinedName !== '' ? combinedName : 'Documento sin nombre';
  }, [allTypes]);

  // --- LÓGICA DE ROLES E IDENTIFICACIÓN ---
  const isAdminUser = hasAdminRole(currentUser);
  const scopedDocs = useMemo(
    () => getScopedDocuments(allDocs, allEntities, currentUser),
    [allDocs, allEntities, currentUser]
  );
  
  const selectedEntity = useMemo(() => {
    if (isAdminUser) {
      return selectedUserId ? allEntities.find((item) => item.id?.toString() === selectedUserId.toString()) : null;
    }

    return findEntityForUser(allEntities, currentUser);
  }, [allEntities, currentUser, isAdminUser, selectedUserId]);
  
  const activeExternalId = selectedEntity?.id?.toString() || '';
  const isGlobalView = isAdminUser && !selectedEntity;

  // --- LÓGICA DE TEXTOS DE CABECERA ---
  const appRoleText = isAdminUser ? 'Administrador' : 'Tripulante';
  const fullNameText = isAdminUser ? getCurrentUserDisplayName(currentUser) : getEntityDisplayName(selectedEntity);
  const cargoHeader = isAdminUser
    ? 'Gestión Central' 
    : formatInfoValue(getEntityFieldValue(selectedEntity, ['cargo', 'position', 'job_title', 'puesto']));

  // --- NUEVOS CAMPOS DEL DETALLE REQUERIDOS ---
  const detailCargo = formatInfoValue(getEntityFieldValue(selectedEntity, ['cargo', 'position', 'job_title', 'puesto']));
  const detailEmpresa = formatInfoValue(getEntityFieldValue(selectedEntity, ['empresa', 'company', 'organization', 'razon_social']));
  const rawContractDate = getEntityFieldValue(selectedEntity, ['fecha_contrato', 'contract_date', 'hired_at', 'fecha_ingreso']);
  const detailFechaContrato = rawContractDate ? formatDate(rawContractDate) : 'No informado';

  const selectedUserDocs = useMemo(() => {
    const docs = Array.isArray(scopedDocs) ? scopedDocs : [];
    if (isGlobalView) return [];
    if (!activeExternalId) return [];
    return docs.filter(
      (doc) => getDocumentEntityIds(doc).includes(activeExternalId) && !isBlockedDocument(doc)
    );
  }, [isGlobalView, activeExternalId, scopedDocs]);

  const selectedPendingSignatures = useMemo(() =>
    selectedUserDocs
      .filter(hasPendingSignature)
      .map((doc) => ({ ...doc, displayName: getDocName(doc) })),
    [selectedUserDocs, getDocName]
  );

  const selectedExpiringDocs = useMemo(() =>
    selectedUserDocs
      .map((doc) => ({
        ...doc,
        daysRemaining: getDaysRemaining(getDocumentExpirationDate(doc)),
        expirationDate: getDocumentExpirationDate(doc),
        displayName: getDocName(doc)
      }))
      .filter((doc) => doc.daysRemaining !== null && doc.daysRemaining <= 60)
      .sort((a, b) => a.daysRemaining - b.daysRemaining),
    [selectedUserDocs, getDocName]
  );

  const selectedDocPercentage = useMemo(() => {
    if (selectedUserDocs.length === 0) return 0;
    const healthyDocs = selectedUserDocs.filter((doc) => {
      const days = getDaysRemaining(getDocumentExpirationDate(doc));
      return days === null || days > 30;
    }).length;
    return Math.round((healthyDocs / selectedUserDocs.length) * 100);
  }, [selectedUserDocs]);

  // --- NUEVA LÓGICA DE MÉTRICAS GLOBALES (VISTA MODERADOR) ---
  const globalMetrics = useMemo(() => {
    const activeDocs = allDocs.filter((doc) => !isBlockedDocument(doc));
    const totalDocsCount = activeDocs.length;
    
    // Contadores de documentos globales
    let docsAlDia = 0;
    let docsCaducados = 0;
    let docsEn30Dias = 0;
    let docsEn3060Dias = 0;

    // Mapa para trazar el estado de salud de cada colaborador
    // Estructura: { [entity_id]: 'healthy' | 'warning' | 'critical' | 'caducado' }
    const collaboratorStatusMap = {};
    allEntities.forEach(ent => {
      collaboratorStatusMap[ent.id?.toString()] = 'healthy';
    });

    activeDocs.forEach((doc) => {
      const days = getDaysRemaining(getDocumentExpirationDate(doc));
      const entityIds = getDocumentEntityIds(doc);

      if (days !== null) {
        if (days < 0) {
          docsCaducados++;
          entityIds.forEach((entId) => {
            if (collaboratorStatusMap[entId]) collaboratorStatusMap[entId] = 'caducado';
          });
        } else if (days >= 0 && days <= 30) {
          docsEn30Dias++;
          entityIds.forEach((entId) => {
            if (collaboratorStatusMap[entId] && collaboratorStatusMap[entId] !== 'caducado') {
              collaboratorStatusMap[entId] = 'critical';
            }
          });
        } else if (days > 30 && days <= 60) {
          docsEn3060Dias++;
          entityIds.forEach((entId) => {
            if (collaboratorStatusMap[entId] && !['caducado', 'critical'].includes(collaboratorStatusMap[entId])) {
              collaboratorStatusMap[entId] = 'warning';
            }
          });
        } else {
          docsAlDia++;
        }
      } else {
        docsAlDia++;
      }
    });

    // Contadores de colaboradores basados en su peor documento
    let colabCaducados = 0;
    let colabEn30Dias = 0;
    let colabEn3060Dias = 0;

    Object.values(collaboratorStatusMap).forEach((status) => {
      if (status === 'caducado') colabCaducados++;
      else if (status === 'critical') colabEn30Dias++;
      else if (status === 'warning') colabEn3060Dias++;
    });

    const totalColabs = allEntities.length;
    const colabsAlDia = totalColabs - colabCaducados - colabEn30Dias - colabEn3060Dias;
    
    const cumplimientoColaboradores = totalColabs > 0 ? Math.round((colabsAlDia / totalColabs) * 100) : 100;
    const cumplimientoDocumental = totalDocsCount > 0 ? Math.round((docsAlDia / totalDocsCount) * 100) : 100;

    return {
      totalColabs,
      cumplimientoColaboradores,
      colabCaducados,
      colabEn30Dias,
      colabEn3060Dias,
      totalDocsCount,
      cumplimientoDocumental,
      docsCaducados,
      docsEn30Dias,
      docsEn3060Dias
    };
  }, [allDocs, allEntities]);

  const searchSuggestions = useMemo(() => {
    const query = normalizeText(searchTerm);
    const identifierQuery = normalizeIdentifier(searchTerm);
    const isIdentifierSearch = /\d/.test(searchTerm);
    const textTokens = splitSearchTokens(searchTerm);
    if (!isAdminUser || !query) return [];

    return allEntities
      .map((entity) => {
        const entityRut = getEntityRut(entity);
        const entityIdentifier = getEntityFieldValue(entity, ['identifier', 'document_number', 'identification', 'legal_id']);
        const rutCandidates = [entityRut, entityIdentifier]
          .filter(Boolean)
          .map(normalizeIdentifier);
        const nameText = normalizeText([
          getEntityDisplayName(entity), entity?.full_name, entity?.name, entity?.label
        ].filter(Boolean).join(' '));
        const emailText = normalizeText(entity?.email);

        if (isIdentifierSearch) {
          const exactStart = rutCandidates.some((value) => value.startsWith(identifierQuery));
          const partial = rutCandidates.some((value) => value.includes(identifierQuery));
          if (!partial) return null;
          return { entity, score: exactStart ? 0 : 1, label: nameText };
        }

        const nameMatches = textTokens.every((token) => nameText.includes(token));
        const emailMatches = query.includes('@') && emailText.includes(query);
        if (!nameMatches && !emailMatches) return null;

        const startsWithQuery = nameText.startsWith(query);
        const tokenStartsWithQuery = nameText.split(/\s+/).some((token) => token.startsWith(query));
        const score = startsWithQuery ? 2 : tokenStartsWithQuery ? 3 : 4;
        return { entity, score, label: nameText };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, 'es'))
      .map((item) => item.entity)
      .slice(0, 8);
  }, [allEntities, isAdminUser, searchTerm]);

  const handleSelectSuggestion = (entity) => {
    onLoadingProgress?.({ percent: 35 });
    const entityId = entity?.id?.toString() || '';
    setSelectedUserId(entityId);
    setSearchTerm(getEntityDisplayName(entity));
    setIsAutocompleteOpen(false);
    window.setTimeout(() => {
      onLoadingProgress?.({ percent: 100, done: true });
    }, 220);
  };

  const handleClearSelection = () => {
    setSearchTerm('');
    setSelectedUserId('');
    setIsAutocompleteOpen(false);
  };

  const syncSourceText = syncStats?.source === 'cache' ? 'cache' : 'API';
  const syncStatusText = syncStats?.stopReason === 'loading'
    ? 'cargando'
    : syncStats?.complete === null
      ? `recibida${syncStats.stopReason ? ` (${syncStats.stopReason})` : ''}`
    : syncStats?.complete === false
      ? `incompleta${syncStats.stopReason ? ` (${syncStats.stopReason})` : ''}`
      : 'completa';

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      {/* CABECERA */}
      <div className="bg-[#394049] p-6 flex flex-row items-center justify-between relative overflow-hidden flex-shrink-0 text-left shadow-lg">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 blur-2xl pointer-events-none"></div>
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-16 h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg overflow-hidden">
            {isAdminUser ? <Globe className="w-8 h-8 text-gray-400" /> : <User className="w-8 h-8 text-gray-400" />}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-white text-xs font-bold tracking-wider uppercase opacity-75">
              Bienvenido
            </span>
            <span className="text-xs font-bold text-[#e1575f] tracking-wide uppercase">
              {appRoleText} (ROL)
            </span>
            <h2 className="text-white text-xl font-bold tracking-wide leading-tight">
              {fullNameText}
            </h2>
            <span className="text-gray-300 text-xs italic font-light">
              {cargoHeader}
            </span>
          </div>
        </div>

        {isAdminUser && (
          <button 
            onClick={() => setView('admin')}
            className="relative z-10 bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl border border-white/20 backdrop-blur-sm transition-all shadow-sm flex flex-col items-center justify-center shrink-0 cursor-pointer"
            title="Panel de Administración"
          >
            <ShieldAlert className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Admin</span>
          </button>
        )}
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
        {/* Buscador de Usuarios */}
        {isAdminUser && (
          <div className="p-6 pb-2">
            <div className="relative">
                <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setSelectedUserId('');
                      setIsAutocompleteOpen(true);
                    }}
                    onFocus={() => setIsAutocompleteOpen(true)}
                    placeholder="Busca un tripulante por nombre o RUT..."
                    className="w-full bg-transparent py-4 pl-12 pr-10 focus:outline-none text-sm"
                  />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 hover:text-[#921E30]"
                    aria-label="Limpiar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>
              {isAutocompleteOpen && searchSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto">
                  {searchSuggestions.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => handleSelectSuggestion(entity)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      <p className="text-sm font-semibold text-[#394049]">{getEntityDisplayName(entity)}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500">
                        <span className="font-semibold text-[#921E30]">
                          RUT: {getEntityRut(entity) || 'Sin RUT'}
                        </span>
                        {entity.email && <span>{entity.email}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {isAutocompleteOpen && searchTerm && searchSuggestions.length === 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 p-4 text-xs text-gray-500">
                  No se encontraron tripulantes con ese nombre o RUT.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sección de Perfil o Panel Resumen Combinado */}
        <div className="px-6 pb-4 pt-2">
          {isGlobalView ? (
            /* NUEVO COMPONENTE DE CUMPLIMIENTO GLOBAL ASOCIADO A LA IMAGEN REQUERIDA */
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-1 gap-4">
                {/* Tarjeta Cumplimiento Colaboradores (Naranja) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="bg-[#f96302] text-white p-6 text-center flex flex-col justify-center items-center flex-1 min-h-[160px]">
                    <h4 className="text-sm font-semibold uppercase tracking-wider opacity-90">Cumplimiento Colaboradores</h4>
                    <p className="text-5xl font-black my-2">{globalMetrics.cumplimientoColaboradores} %</p>
                    <p className="text-xs opacity-75">De {globalMetrics.totalColabs} Colaboradores</p>
                  </div>
                  <div className="p-4 bg-white text-center border-t border-gray-50">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Estado de Colaboradores</p>
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <p className="text-base font-bold text-red-600">{globalMetrics.colabCaducados}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caducados</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-amber-600">{globalMetrics.colabEn30Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 días</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-blue-600">{globalMetrics.colabEn3060Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 a 60 días</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tarjeta Cumplimiento Documental (Verde) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="bg-[#008000] text-white p-6 text-center flex flex-col justify-center items-center flex-1 min-h-[160px]">
                    <h4 className="text-sm font-semibold uppercase tracking-wider opacity-90">Cumplimiento Documental</h4>
                    <p className="text-5xl font-black my-2">{globalMetrics.cumplimientoDocumental} %</p>
                    <p className="text-xs opacity-75">De {globalMetrics.totalDocsCount} Documentos</p>
                  </div>
                  <div className="p-4 bg-white text-center border-t border-gray-50">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Estado de Documentos</p>
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <p className="text-base font-bold text-red-600">{globalMetrics.docsCaducados}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caducados</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-amber-600">{globalMetrics.docsEn30Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 días</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-blue-600">{globalMetrics.docsEn3060Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 a 60 días</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500 flex items-center justify-between gap-2">
                <span className="min-w-0">
                  Datos {syncStatusText} desde {syncSourceText}: {syncStats?.totalItems ?? globalMetrics.totalDocsCount} documentos
                  {syncStats?.pagesLoaded ? ` · ${syncStats.pagesLoaded} páginas` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSyncStats(null);
                    setRefreshToken((value) => value + 1);
                  }}
                  disabled={isSyncing}
                  className="shrink-0 text-[#921E30] font-bold disabled:opacity-50"
                >
                  Actualizar API
                </button>
              </div>
            </div>
          ) : (
            /* Vista de Detalle de un Colaborador Específico */
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <p className="text-xs uppercase font-semibold text-[#921E30]">
                    {!isAdminUser ? 'Mi Perfil' : 'Usuario seleccionado'}
                  </p>
                  <h3 className="text-base font-bold text-[#394049]">{getEntityDisplayName(selectedEntity)}</h3>
                  <p className="text-xs text-gray-500 mb-2">
                    RUT: {formatInfoValue(getEntityRut(selectedEntity))}
                  </p>
                  
                  <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold text-gray-700">Cargo:</span> {detailCargo}
                    </p>
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold text-gray-700">Empresa:</span> {detailEmpresa}
                    </p>
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold text-gray-700">Fecha de Contrato:</span> {detailFechaContrato}
                    </p>
                  </div>
                </div>
                {isAdminUser && selectedEntity && (
                  <button type="button" onClick={handleClearSelection} className="text-xs font-semibold text-[#921E30] shrink-0 bg-red-50 px-2 py-1 rounded-md">
                    Ver General
                  </button>
                )}
              </div>
              
                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
                <div className="rounded-xl bg-gray-50 p-2 text-center">
                  <p className="text-[10px] uppercase text-gray-500">Docs</p>
                  <p className="text-base font-bold text-[#394049]">{selectedUserDocs.length}</p>
                </div>
                <div className="rounded-xl bg-red-50 p-2 text-center">
                  <p className="text-[10px] uppercase text-gray-500">Firmas</p>
                  <p className="text-base font-bold text-[#921E30]">{selectedPendingSignatures.length}</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-2 text-center">
                  <p className="text-[10px] uppercase text-gray-500">Alertas</p>
                  <p className="text-base font-bold text-[#B8860B]">{selectedExpiringDocs.length}</p>
                </div>
                </div>

                {selectedEntity && selectedUserDocs.length === 0 && !isSyncing && (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-500">
                    La API no entrega documentos asociados para esta persona.
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wide">Progreso documental</p>
                  <span className="text-sm font-black text-[#921E30]">{selectedDocPercentage}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full transition-all duration-500"
                    style={{
                      width: `${selectedDocPercentage}%`,
                      backgroundColor: selectedDocPercentage === 100 ? '#22c55e' : '#f96302'
                    }}
                  ></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isGlobalView && (
          <>
            {/* Listado de Firmas Pendientes */}
            <div className="px-6 pt-2 pb-2 flex justify-between items-end">
              <h3 className="font-bold text-[#394049] text-base border-b-2 border-[#921E30] pb-0.5">
                {isAdminUser ? 'Firmas Pendientes' : 'Mis Firmas Pendientes'}
              </h3>
              <button onClick={() => setView('firmas')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
            </div>

            <div className="px-6 mb-4 mt-2">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                {selectedPendingSignatures.length > 0 ? (
                  <div className="space-y-3">
                    {selectedPendingSignatures.slice(0, 5).map((doc) => (
                      <div key={doc.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mb-2 hover:shadow-md transition">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <PenTool className="w-5 h-5 text-[#921E30] shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                            <p className="text-[11px] text-gray-500 truncate">
                              {isAdminUser ? 'Requiere firma digital' : 'Requiere tu firma digital'}
                            </p>
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
                    {selectedPendingSignatures.length > 5 && (
                      <p className="text-center text-xs text-gray-400 pt-1">Y {selectedPendingSignatures.length - 5} firmas más pendientes...</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                    {isSyncing ? 'Verificando firmas...' : 'No hay firmas pendientes registradas.'}
                  </div>
                )}
              </div>
            </div>

            {/* Listado de Alertas / Documentos por Vencer */}
            <div className="px-6 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs uppercase font-semibold text-[#921E30]">Alertas</p>
                    <h4 className="text-base font-bold text-[#394049]">Documentos Próximos a Vencer</h4>
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                    {isSyncing ? (
                      <span className="flex items-center text-blue-500 animate-pulse"><Clock className="w-3 h-3 mr-1" /> Sincronizando...</span>
                    ) : (
                      <><Clock className="w-4 h-4" /> Alertas activas</>
                    )}
                  </div>
                </div>

                {selectedExpiringDocs.length > 0 ? (
                  <div className="space-y-3">
                    {selectedExpiringDocs.slice(0, 5).map((doc) => {
                      const isExpired = doc.daysRemaining < 0;
                      const isCritical = doc.daysRemaining >= 0 && doc.daysRemaining <= 30;
                      const isWarning = doc.daysRemaining > 30 && doc.daysRemaining <= 60;

                      let colorClass = '';
                      let textColor = '';
                      let statusText = '';

                      if (isExpired || isCritical) {
                        colorClass = 'bg-red-50 border-red-200';
                        textColor = 'text-red-700';
                        statusText = isExpired ? `Expirado (${Math.abs(doc.daysRemaining)}d)` : `Expira en ${doc.daysRemaining}d`;
                      } else if (isWarning) {
                        colorClass = 'bg-amber-50 border-amber-200';
                        textColor = 'text-amber-700';
                        statusText = `Expira en ${doc.daysRemaining}d`;
                      }

                      return (
                        <div key={doc.id} className={`rounded-xl border p-3 bg-white shadow-sm hover:shadow transition ${colorClass}`}>
                          <div className="flex justify-between items-start gap-3">
                            <div className="flex-1 overflow-hidden">
                              <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                              <p className="text-[11px] text-gray-500">Vence el {formatDate(doc.expirationDate)}</p>
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${textColor}`}>
                              {statusText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                    {isSyncing ? 'Buscando alertas...' : 'No se registran alertas urgentes de vencimiento.'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
