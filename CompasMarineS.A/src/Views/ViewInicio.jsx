import React, { useEffect, useMemo, useState } from 'react';
import { Search, User, Clock, PenTool, Globe, ShieldAlert } from 'lucide-react';

// Fallbacks de integración local
const getApiUrl = (path) => `/api${path}`;
const readControlDocSnapshot = () => {
  try {
    const raw = localStorage.getItem('controlDocSnapshot');
    return raw ? { data: JSON.parse(raw) } : null;
  } catch {
    return null;
  }
};
const evaluateDocumentNotificationRules = () => Promise.resolve();

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = new Date(dateString);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const normalizeText = (value) => (value || '').toString().trim().toLowerCase();
const normalizeIdentifier = (value) => normalizeText(value).replace(/[^a-z0-9]/g, '');

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

const toArray = (value, fallbackKeys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of fallbackKeys) {
    if (Array.isArray(value[key])) return value[key];
  }
  const dynamicArrayKey = Object.keys(value).find((key) => Array.isArray(value[key]));
  return dynamicArrayKey ? value[dynamicArrayKey] : [];
};

const getEntityDisplayName = (entity) => {
  if (!entity) return 'Usuario';
  return entity.full_name || entity.name || entity.email || `Usuario ${entity.id || ''}`;
};

export const ViewInicio = ({ setView }) => {
  const [allDocs, setAllDocs] = useState([]);
  const [allEntities, setAllEntities] = useState([]);
  const [allTypes, setAllTypes] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const processData = (docs, entities, types) => {
    const normalizedDocs = toArray(docs, ['documents', 'data', 'items']);
    const normalizedEntities = toArray(entities, ['entities', 'data', 'items']);
    const normalizedTypes = toArray(types, ['documentTypes', 'document_types', 'data', 'items']);

    setAllDocs(normalizedDocs);
    setAllEntities(normalizedEntities);
    setAllTypes(normalizedTypes);

    void evaluateDocumentNotificationRules({
      documents: normalizedDocs,
      documentTypes: normalizedTypes,
      percentage: 100
    });
  };

  useEffect(() => {
    const snapshot = readControlDocSnapshot();
    if (snapshot?.data) {
      processData(snapshot.data.documents || [], snapshot.data.entities || [], snapshot.data.documentTypes || []);
    }

    const fetchFreshData = async () => {
      setIsSyncing(true);
      try {
        const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };
        
        const [docsRes, entitiesRes, typesRes] = await Promise.all([
          fetch(getApiUrl('/controldoc/documents'), requestOptions),
          fetch(getApiUrl('/controldoc/entities'), requestOptions),
          fetch(getApiUrl('/controldoc/document-types'), requestOptions)
        ]);

        if (docsRes.ok && entitiesRes.ok && typesRes.ok) {
          processData(await docsRes.json(), await entitiesRes.json(), await typesRes.json());
        }
      } catch (error) {
        console.error('Error sincronizando inicio:', error);
      } finally {
        setIsSyncing(false);
      }
    };

    fetchFreshData();
  }, []);

  const getDocName = (doc) => {
    let typeName = '';
    if (allTypes && allTypes.length > 0) {
      const type = allTypes.find((t) => t.id?.toString() === doc.document_type_id?.toString());
      if (type) typeName = type.name || type.label || '';
    }
    const docLabel = doc.label || '';
    const combinedName = `${typeName} ${docLabel}`.trim();
    return combinedName !== '' ? combinedName : 'Documento sin nombre';
  };

  // --- LÓGICA DE ROLES E IDENTIFICACIÓN ---
  const isAdminUser = allEntities.length > 1;
  
  let selectedEntity = null;
  if (isAdminUser) {
    selectedEntity = selectedUserId ? allEntities.find((item) => item.id?.toString() === selectedUserId.toString()) : null;
  } else {
    selectedEntity = allEntities.length > 0 ? allEntities[0] : null;
  }
  
  const activeExternalId = selectedEntity?.id?.toString() || '';
  const isGlobalView = isAdminUser && !selectedEntity;

  // --- LÓGICA DE TEXTOS DE CABECERA ---
  const appRoleText = isGlobalView ? 'Administrador' : 'Tripulante';
  const fullNameText = isGlobalView ? 'Panel General de la Empresa' : getEntityDisplayName(selectedEntity);
  const cargoHeader = isGlobalView 
    ? 'Gestión Central' 
    : formatInfoValue(getEntityFieldValue(selectedEntity, ['cargo', 'position', 'job_title', 'puesto']));

  // --- NUEVOS CAMPOS DEL DETALLE REQUERIDOS ---
  const detailCargo = formatInfoValue(getEntityFieldValue(selectedEntity, ['cargo', 'position', 'job_title', 'puesto']));
  const detailEmpresa = formatInfoValue(getEntityFieldValue(selectedEntity, ['empresa', 'company', 'organization', 'razon_social']));
  const rawContractDate = getEntityFieldValue(selectedEntity, ['fecha_contrato', 'contract_date', 'hired_at', 'fecha_ingreso']);
  const detailFechaContrato = rawContractDate ? formatDate(rawContractDate) : 'No informado';

  const selectedUserDocs = useMemo(() => {
    const docs = Array.isArray(allDocs) ? allDocs : [];
    if (isGlobalView) return docs.filter((doc) => doc.aasm_state !== 'blocked');
    if (!activeExternalId) return [];
    return docs.filter(
      (doc) => doc.entity_id?.toString() === activeExternalId && doc.aasm_state !== 'blocked'
    );
  }, [isGlobalView, activeExternalId, allDocs]);

  const selectedPendingSignatures = useMemo(() =>
    selectedUserDocs
      .filter((doc) => doc.require_signers === true || doc.aasm_state === 'pending')
      .map((doc) => ({ ...doc, displayName: getDocName(doc) })),
    [selectedUserDocs, allTypes]
  );

  const selectedExpiringDocs = useMemo(() =>
    selectedUserDocs
      .map((doc) => ({
        ...doc,
        daysRemaining: getDaysRemaining(doc.expires_at),
        displayName: getDocName(doc)
      }))
      .filter((doc) => doc.daysRemaining !== null && doc.daysRemaining <= 60)
      .sort((a, b) => a.daysRemaining - b.daysRemaining),
    [selectedUserDocs, allTypes]
  );

  const selectedValidDocs = useMemo(() =>
    selectedUserDocs
      .map((doc) => ({
        ...doc,
        daysRemaining: getDaysRemaining(doc.expires_at),
        displayName: getDocName(doc)
      }))
      .filter((doc) => doc.daysRemaining === null || doc.daysRemaining > 60)
      .sort((a, b) => {
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
        return a.daysRemaining - b.daysRemaining;
      }),
    [selectedUserDocs, allTypes]
  );

  const selectedDocPercentage = useMemo(() => {
    if (selectedUserDocs.length === 0) return 100;
    const healthyDocs = selectedUserDocs.filter((doc) => {
      const days = getDaysRemaining(doc.expires_at);
      return days === null || days > 0; // Documento no caducado
    }).length;
    return Math.round((healthyDocs / selectedUserDocs.length) * 100);
  }, [selectedUserDocs]);

  // --- NUEVA LÓGICA DE MÉTRICAS GLOBALES (VISTA MODERADOR) ---
  const globalMetrics = useMemo(() => {
    const totalDocsCount = allDocs.filter((doc) => doc.aasm_state !== 'blocked').length;
    
    // Contadores de documentos globales
    let docsCaducados = 0;
    let docsEn30Dias = 0;
    let docsEn3060Dias = 0;

    // Mapa para trazar el estado de salud de cada colaborador
    // Estructura: { [entity_id]: 'healthy' | 'warning' | 'critical' | 'caducado' }
    const collaboratorStatusMap = {};
    allEntities.forEach(ent => {
      collaboratorStatusMap[ent.id?.toString()] = 'healthy';
    });

    allDocs.forEach((doc) => {
      if (doc.aasm_state === 'blocked') return;
      const days = getDaysRemaining(doc.expires_at);
      const entId = doc.entity_id?.toString();

      if (days !== null) {
        if (days < 0) {
          docsCaducados++;
          if (entId && collaboratorStatusMap[entId]) {
            collaboratorStatusMap[entId] = 'caducado';
          }
        } else if (days >= 0 && days <= 30) {
          docsEn30Dias++;
          if (entId && collaboratorStatusMap[entId] && collaboratorStatusMap[entId] !== 'caducado') {
            collaboratorStatusMap[entId] = 'critical';
          }
        } else if (days > 30 && days <= 60) {
          docsEn3060Dias++;
          if (entId && collaboratorStatusMap[entId] && !['caducado', 'critical'].includes(collaboratorStatusMap[entId])) {
            collaboratorStatusMap[entId] = 'warning';
          }
        }
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
    const colabsAlDia = totalColabs - colabCaducados;
    
    const cumplimientoColaboradores = totalColabs > 0 ? Math.round((colabsAlDia / totalColabs) * 100) : 100;
    const cumplimientoDocumental = totalDocsCount > 0 ? Math.round(((totalDocsCount - docsCaducados) / totalDocsCount) * 100) : 100;

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
    if (!query) return [];

    return allEntities
      .filter((entity) => {
        const entityIdentifier = getEntityFieldValue(entity, ['identifier']);
        const normalizedEntityIdentifier = normalizeIdentifier(entityIdentifier);

        const searchable = [
          entity?.full_name, entity?.name, entity?.email, entityIdentifier,
          entity?.document_number, entity?.identification, entity?.legal_id
        ].filter(Boolean).join(' ').toLowerCase();

        const textMatch = searchable.includes(query);
        const identifierMatch = identifierQuery !== '' && normalizedEntityIdentifier.includes(identifierQuery);
        return textMatch || identifierMatch;
      })
      .slice(0, 6);
  }, [allEntities, searchTerm]);

  const handleSelectSuggestion = (entity) => {
    const entityId = entity?.id?.toString() || '';
    setSelectedUserId(entityId);
    setSearchTerm('');
    setIsAutocompleteOpen(false);
  };

  const handleClearSelection = () => {
    setSearchTerm('');
    setSelectedUserId('');
    setIsAutocompleteOpen(false);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      {/* CABECERA */}
      <div className="bg-[#394049] p-6 flex flex-row items-center justify-between relative overflow-hidden flex-shrink-0 text-left shadow-lg">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 blur-2xl pointer-events-none"></div>
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-16 h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg overflow-hidden">
            {isGlobalView ? <Globe className="w-8 h-8 text-gray-400" /> : <User className="w-8 h-8 text-gray-400" />}
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
                    setIsAutocompleteOpen(true);
                  }}
                  onFocus={() => setIsAutocompleteOpen(true)}
                  placeholder="Busca un tripulante por nombre o RUT..."
                  className="w-full bg-transparent py-4 pl-12 pr-4 focus:outline-none text-sm"
                />
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
                      <p className="text-xs text-gray-500">
                        {getEntityFieldValue(entity, ['identifier']) || entity.email || 'Sin identificación'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sección de Perfil o Panel Resumen Combinado */}
        <div className="px-6 pb-4 pt-2">
          {isGlobalView ? (
            /* NUEVO COMPONENTE DE CUMPLIMIENTO GLOBAL ASOCIADO A LA IMAGEN REQUERIDA */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
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
                    {formatInfoValue(getEntityFieldValue(selectedEntity, ['identifier']))}
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
            </div>
          )}
        </div>

        {/* Barra de Porcentaje Individual (Se muestra siempre para un tripulante o como métrica complementaria) */}
        {!isGlobalView && (
          <>
            <div className="px-6 pt-2 pb-2 flex justify-between items-end">
              <h3 className="font-bold text-[#394049] text-sm uppercase tracking-wide opacity-75">
                Porcentaje de documentos
              </h3>
            </div>

            <div className="flex flex-col items-center justify-center py-4 px-8 bg-white border-y border-gray-100 mb-4">
              <div className="w-full max-w-md bg-gray-200 rounded-full h-4 shadow-inner overflow-hidden">
                <div
                  className="h-4 rounded-full transition-all duration-500"
                  style={{
                    width: `${selectedDocPercentage}%`,
                    backgroundColor: selectedDocPercentage === 100 ? '#22c55e' : '#f96302'
                  }}
                ></div>
              </div>
              <span className="text-sm mt-1.5 font-bold text-gray-700">
                {selectedDocPercentage}%
              </span>
            </div>
          </>
        )}

        {/* Listado de Firmas Pendientes */}
        <div className="px-6 pt-2 pb-2 flex justify-between items-end">
          <h3 className="font-bold text-[#394049] text-base border-b-2 border-[#921E30] pb-0.5">
            {isGlobalView ? 'Firmas Pendientes Globales' : 'Mis Firmas Pendientes'}
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
                          {isGlobalView ? `Asignado a: Ente ID ${doc.entity_id}` : 'Requiere tu firma digital'}
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
                          <p className="text-[11px] text-gray-500">Vence el {formatDate(doc.expires_at)}</p>
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
      </main>
    </div>
  );
};