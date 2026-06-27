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
import { getDocumentEntityIds, getDocumentExpirationDate, getDocumentStatusText, hasNonCompliantDocumentStatus, hasPendingSignature, isBlockedDocument, parseControlDocDate } from '../controldoc/fields';

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const parsedDate = parseControlDocDate(dateString);
  return parsedDate
    ? parsedDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'N/A';
};

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = parseControlDocDate(dateString);
  if (!expirationDate) return null;
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const calculateHealthyPercentage = (documents) => {
  if (!documents.length) return 100;
  const healthyDocs = documents.filter((doc) => getDocumentComplianceBucket(doc) === 'healthy').length;
  return Math.round((healthyDocs / documents.length) * 100);
};

const getDocumentComplianceBucket = (doc) => {
  const days = getDaysRemaining(getDocumentExpirationDate(doc));
  const status = getDocumentStatusText(doc);

  if (isBlockedDocument(doc) || hasNonCompliantDocumentStatus(doc) || (days !== null && days < 0)) return 'nonCompliant';
  if (days !== null && days <= 30) return 'critical';
  if (days !== null && days <= 60) return 'warning';
  if (days === null && !status) return 'nonCompliant';
  return 'healthy';
};

const normalizeText = (value) => (value || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const normalizeIdentifier = (value) => normalizeText(value).replace(/[^a-z0-9]/g, '');
const splitSearchTokens = (value) => normalizeText(value).split(/\s+/).filter(Boolean);

const ENTITY_RUT_KEYS = ['rut', 'run', 'identifier', 'numero_de_documento', 'numero documento', 'numero_de_identificacion', 'document_number', 'identification', 'legal_id', 'dni'];

const normalizeFieldKey = (value) => (value || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getEntityFieldValue = (entity, candidateKeys) => {
  if (!entity) return '';
  for (const key of candidateKeys) {
    const directValue = entity?.[key];
    if (directValue !== undefined && directValue !== null && `${directValue}`.trim() !== '') return directValue;
  }
  const normalizedCandidates = candidateKeys.map(normalizeFieldKey);
  const nestedSources = [entity?.custom_fields, entity?.customFields, entity?.fields, entity?.attributes, entity?.metadata, entity?.meta, entity?.profile, entity?.data].filter(Boolean);

  for (const source of nestedSources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const rawKey = item?.key || item?.name || item?.label || item?.field || item?.slug;
        const rawValue = item?.value ?? item?.content ?? item?.text ?? item?.data;
        const normalizedKey = normalizeFieldKey(rawKey);
        if (normalizedCandidates.includes(normalizedKey) && rawValue !== undefined && rawValue !== null && `${rawValue}`.trim() !== '') return rawValue;
      }
      continue;
    }
    if (typeof source === 'object') {
      for (const [rawKey, rawValue] of Object.entries(source)) {
        const normalizedKey = normalizeFieldKey(rawKey);
        if (normalizedCandidates.includes(normalizedKey) && rawValue !== undefined && rawValue !== null && `${rawValue}`.trim() !== '') return rawValue;
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
  return entity.full_name || entity.name || entity.nombre || entity.email || `Usuario ${entity.id || ''}`;
};

const getCurrentUserDisplayName = (user) => {
  if (!user) return 'Usuario';
  return user.nombre || user.name || user.full_name || user.email || `Usuario ${user.id || ''}`;
};

const getEntityRut = (entity) => getEntityFieldValue(entity, ENTITY_RUT_KEYS);
const getEntityEmail = (entity) => getEntityFieldValue(entity, ['email', 'correo_electronico_personal', 'correo electronico personal', 'correo_electronico_corporativo', 'correo electronico corporativo', 'correo', 'mail']);
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;

const toArray = (value, fallbackKeys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of fallbackKeys) {
    if (Array.isArray(value[key])) return value[key];
  }
  const dynamicArrayKey = Object.keys(value).find((key) => Array.isArray(value[key]));
  return dynamicArrayKey ? value[dynamicArrayKey] : [];
};

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
        percentage: calculateHealthyPercentage(notificationDocs),
        ownerKey: snapshotOwnerKey
      });
    }
  }, [currentUser, snapshotOwnerKey]);

  useEffect(() => {
    let isCancelled = false;

    const fetchFreshData = async ({ forceRefresh }) => {
      setIsSyncing(true);
      onLoadingProgress?.({ percent: 15 });
      try {
        const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };
        const queryParams = forceRefresh ? '?refresh=1' : '';

        // Petición plana: el Backend ya paginó y trajo todo de la RAM
        const [docsRes, entitiesRes, typesRes] = await Promise.all([
          fetch(getApiUrl(`/controldoc/documents${queryParams}`), requestOptions),
          fetch(getApiUrl(`/controldoc/entities${queryParams}`), requestOptions),
          fetch(getApiUrl(`/controldoc/document-types${queryParams}`), requestOptions)
        ]);

        // Manejo específico del 502 de Railway
        if (docsRes.status === 502 || docsRes.status === 504) {
            throw new Error('El servidor está inicializando los datos masivos en segundo plano. Por favor, espera 1 minuto y vuelve a intentar.');
        }

        if (!docsRes.ok || !entitiesRes.ok || !typesRes.ok) {
          throw new Error('Error de conexión con el Backend local.');
        }

        onLoadingProgress?.({ percent: 60 });

        const [docsData, entitiesData, typesData] = await Promise.all([
          docsRes.json(), entitiesRes.json(), typesRes.json()
        ]);

        onLoadingProgress?.({ percent: 90 });
        if (isCancelled) return;

        const nextData = {
          documents: toArray(docsData, ['documents', 'data', 'items']),
          entities: toArray(entitiesData, ['entities', 'data', 'items']),
          documentTypes: toArray(typesData, ['documentTypes', 'document_types', 'data', 'items']),
          meta: { documents: { totalItems: Array.isArray(docsData) ? docsData.length : 0 } }
        };

        setSyncStats({ source: 'api', totalItems: nextData.documents.length, complete: true });
        processData(nextData.documents, nextData.entities, nextData.documentTypes);
        
        if (!hasAdminRole(currentUser)) {
          void saveControlDocSnapshotAsync(nextData, snapshotOwnerKey);
        }
        
        onLoadingProgress?.({ percent: 100, done: true });
      } catch (error) {
        onLoadingProgress?.({ active: false });
        console.error('Error sincronizando inicio:', error);
        alert(error.message); // Notificar al usuario amigablemente
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
          totalItems: snapshot.data.documents?.length || 0,
          complete: true
        });
      }

      if (refreshToken === 0 && isControlDocSnapshotFresh(snapshot, SNAPSHOT_FRESH_MS, { requireComplete: hasAdminRole(currentUser) })) {
        setIsSyncing(false);
        return;
      }

      await fetchFreshData({ forceRefresh: refreshToken > 0 });
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

  // --- LÓGICA DE ROLES E IDENTIFICACIÓN (DOBLE CANDADO) ---
  const isAdminUser = hasAdminRole(currentUser);
  
  // Detección robusta de la entidad del usuario
  const displayEntity = useMemo(() => {
    if (isAdminUser) {
      return selectedUserId ? allEntities.find((item) => item.id?.toString() === selectedUserId.toString()) : null;
    }
    
    // Auto-detección para usuarios normales
    const found = findEntityForUser(allEntities, currentUser);
    if (found) return found;
    
    // Fallback: Si el backend aplicó su propio bypass, allEntities solo tendrá 1 elemento. Ese somos nosotros.
    if (allEntities.length === 1) return allEntities[0];
    
    return {
      id: '',
      name: getCurrentUserDisplayName(currentUser),
      email: currentUser?.email || '',
      rut: currentUser?.rut || ''
    };
  }, [allEntities, currentUser, isAdminUser, selectedUserId]);

  const activeExternalId = displayEntity?.id?.toString() || '';
  const isGlobalView = isAdminUser && !displayEntity;

  const appRoleText = isAdminUser ? 'Administrador' : 'Tripulante';
  const fullNameText = isAdminUser ? getCurrentUserDisplayName(currentUser) : getEntityDisplayName(displayEntity);
  const cargoHeader = isAdminUser
    ? 'Gestión Central' 
    : formatInfoValue(getEntityFieldValue(displayEntity, ['cargo', 'position', 'job_title', 'puesto']));

  const detailCargo = formatInfoValue(getEntityFieldValue(displayEntity, ['cargo', 'position', 'job_title', 'puesto']));
  const detailEmpresa = formatInfoValue(getEntityFieldValue(displayEntity, ['empresa', 'company', 'organization', 'razon_social']));
  const rawContractDate = getEntityFieldValue(displayEntity, ['fecha_contrato', 'contract_date', 'hired_at', 'fecha_ingreso']);
  const detailFechaContrato = rawContractDate ? formatDate(rawContractDate) : 'No informado';

  // --- CANDADO PARA DOCUMENTOS ---
  const selectedUserDocs = useMemo(() => {
    if (isGlobalView) return [];
    if (!activeExternalId) return [];
    
    return allDocs.filter(doc => {
      const entityIds = getDocumentEntityIds(doc);
      return entityIds.includes(activeExternalId);
    });
  }, [isGlobalView, activeExternalId, allDocs]);

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
    const healthyDocs = selectedUserDocs.filter((doc) => getDocumentComplianceBucket(doc) === 'healthy').length;
    return Math.round((healthyDocs / selectedUserDocs.length) * 100);
  }, [selectedUserDocs]);

  const globalMetrics = useMemo(() => {
    const activeDocs = allDocs;
    const totalDocsCount = activeDocs.length;
    
    let docsAlDia = 0, docsCaducados = 0, docsEn30Dias = 0, docsEn3060Dias = 0;

    const collaboratorStatusMap = {};
    allEntities.forEach(ent => {
      collaboratorStatusMap[ent.id?.toString()] = 'healthy';
    });

    activeDocs.forEach((doc) => {
      const entityIds = getDocumentEntityIds(doc);
      const bucket = getDocumentComplianceBucket(doc);

      if (bucket === 'nonCompliant') {
        docsCaducados++;
        entityIds.forEach((entId) => {
          if (collaboratorStatusMap[entId]) collaboratorStatusMap[entId] = 'caducado';
        });
      } else if (bucket === 'critical') {
        docsEn30Dias++;
        entityIds.forEach((entId) => {
          if (collaboratorStatusMap[entId] && collaboratorStatusMap[entId] !== 'caducado') {
            collaboratorStatusMap[entId] = 'critical';
          }
        });
      } else if (bucket === 'warning') {
        docsEn3060Dias++;
        entityIds.forEach((entId) => {
          if (collaboratorStatusMap[entId] && !['caducado', 'critical'].includes(collaboratorStatusMap[entId])) {
            collaboratorStatusMap[entId] = 'warning';
          }
        });
      } else {
        docsAlDia++;
      }
    });

    let colabCaducados = 0, colabEn30Dias = 0, colabEn3060Dias = 0;

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
      totalColabs, cumplimientoColaboradores, colabsAlDia, colabCaducados, colabEn30Dias, colabEn3060Dias,
      totalDocsCount, cumplimientoDocumental, docsAlDia, docsCaducados, docsEn30Dias, docsEn3060Dias
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
        const rutCandidates = [entityRut, entityIdentifier].filter(Boolean).map(normalizeIdentifier);
        const nameText = normalizeText([getEntityDisplayName(entity), entity?.full_name, entity?.name, entity?.label].filter(Boolean).join(' '));
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

  const syncSourceText = syncStats?.source === 'cache' ? 'caché instantáneo' : 'servidor';
  const syncStatusText = isSyncing ? 'cargando' : 'completada';

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
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
              {appRoleText}
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
                        <span>Email: {getEntityEmail(entity) || 'Sin email'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="px-6 pb-4 pt-2">
          {isGlobalView ? (
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="bg-[#f96302] text-white p-6 text-center flex flex-col justify-center items-center flex-1 min-h-[160px]">
                    <h4 className="text-sm font-semibold uppercase tracking-wider opacity-90">Cumplimiento Colaboradores</h4>
                    <p className="text-5xl font-black my-2">{globalMetrics.cumplimientoColaboradores} %</p>
                    <p className="text-xs opacity-75">De {globalMetrics.totalColabs} Colaboradores</p>
                  </div>
                  <div className="p-4 bg-white text-center border-t border-gray-50">
                    <div className="grid grid-cols-4 gap-1">
                      <div>
                        <p className="text-base font-bold text-red-600">{globalMetrics.colabCaducados}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caducado</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-amber-600">{globalMetrics.colabEn30Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">En 30d</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-blue-600">{globalMetrics.colabEn3060Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">En 60d</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-green-600">{globalMetrics.colabsAlDia}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Al día</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="bg-[#008000] text-white p-6 text-center flex flex-col justify-center items-center flex-1 min-h-[160px]">
                    <h4 className="text-sm font-semibold uppercase tracking-wider opacity-90">Cumplimiento Documental</h4>
                    <p className="text-5xl font-black my-2">{globalMetrics.cumplimientoDocumental} %</p>
                    <p className="text-xs opacity-75">De {globalMetrics.totalDocsCount} Documentos</p>
                  </div>
                  <div className="p-4 bg-white text-center border-t border-gray-50">
                    <div className="grid grid-cols-4 gap-1">
                      <div>
                        <p className="text-base font-bold text-red-600">{globalMetrics.docsCaducados}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Caducado</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-amber-600">{globalMetrics.docsEn30Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">En 30d</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-blue-600">{globalMetrics.docsEn3060Dias}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">En 60d</p>
                      </div>
                      <div>
                        <p className="text-base font-bold text-green-600">{globalMetrics.docsAlDia}</p>
                        <p className="text-[10px] text-gray-400 leading-tight">Al día</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500 flex items-center justify-between gap-2">
                <span className="min-w-0">
                  Carga {syncStatusText} desde {syncSourceText}.
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
                  {isSyncing ? <Clock className="w-3 h-3 animate-spin inline mr-1" /> : ''}
                  Actualizar
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mt-4">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <p className="text-xs uppercase font-semibold text-[#921E30]">
                    {!isAdminUser ? 'Mi Perfil' : 'Usuario seleccionado'}
                  </p>
                  <h3 className="text-base font-bold text-[#394049]">{getEntityDisplayName(displayEntity)}</h3>
                  <p className="text-xs text-gray-500 mb-2">
                    RUT: {formatInfoValue(getEntityRut(displayEntity))}
                  </p>
                  
                  <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold text-gray-700">Cargo:</span> {detailCargo}
                    </p>
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold text-gray-700">Empresa:</span> {detailEmpresa}
                    </p>
                  </div>
                </div>
                {isAdminUser && displayEntity && (
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
                      <div key={doc.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mb-2">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <PenTool className="w-5 h-5 text-[#921E30] shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                          </div>
                        </div>
                        <a href={`https://compliance.controldoc.legal/documentos/${doc.id}`} target="_blank" rel="noopener noreferrer" className="bg-[#921E30] text-white text-xs px-3 py-1.5 rounded-md font-semibold">
                          Firmar
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                    No hay firmas pendientes registradas.
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs uppercase font-semibold text-[#921E30]">Alertas</p>
                    <h4 className="text-base font-bold text-[#394049]">Próximos a Vencer</h4>
                  </div>
                </div>

                {selectedExpiringDocs.length > 0 ? (
                  <div className="space-y-3">
                    {selectedExpiringDocs.slice(0, 5).map((doc) => {
                      const isExpired = doc.daysRemaining < 0;
                      const textColor = isExpired || (doc.daysRemaining >= 0 && doc.daysRemaining <= 30) ? 'text-red-700' : 'text-amber-700';
                      const statusText = isExpired ? `Expirado (${Math.abs(doc.daysRemaining)}d)` : `Expira en ${doc.daysRemaining}d`;

                      return (
                        <div key={doc.id} className="rounded-xl border p-3 bg-white shadow-sm hover:shadow transition">
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
                    No se registran alertas urgentes de vencimiento.
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