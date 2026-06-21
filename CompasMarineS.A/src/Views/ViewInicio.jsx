import { useEffect, useMemo, useState } from 'react';
import { Search, User, Clock, PenTool } from 'lucide-react';
import { readControlDocSnapshot } from '../storage/controlDocOffline';
import { getApiUrl } from '../config/api';
import { evaluateDocumentNotificationRules } from '../pwa/notificationRules';

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

const getCookie = (name) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
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
    entity?.custom_fields,
    entity?.customFields,
    entity?.fields,
    entity?.attributes,
    entity?.metadata,
    entity?.meta,
    entity?.profile,
    entity?.data
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

const getEntityDisplayName = (entity) =>
  entity?.full_name || entity?.name || entity?.email || `Usuario ${entity?.id || ''}`;

export const ViewInicio = ({ setView }) => {
  const [allDocs, setAllDocs] = useState([]);
  const [allEntities, setAllEntities] = useState([]);
  const [allTypes, setAllTypes] = useState([]);
  const [currentEntityName, setCurrentEntityName] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const currentEntityId = getCookie('compas_user_id');
  const displayName = currentEntityName || 'Usuario';

  useEffect(() => {
    if (currentEntityId && !selectedUserId) {
      setSelectedUserId(currentEntityId);
    }
  }, [currentEntityId, selectedUserId]);

  const processData = (docs, entities, types) => {
    const normalizedDocs = toArray(docs, ['documents', 'data', 'items']);
    const normalizedEntities = toArray(entities, ['entities', 'data', 'items']);
    const normalizedTypes = toArray(types, ['documentTypes', 'document_types', 'data', 'items']);

    if (currentEntityId && normalizedEntities.length > 0) {
      const entity = normalizedEntities.find((item) => item.id?.toString() === currentEntityId.toString());
      if (entity) {
        setCurrentEntityName(getEntityDisplayName(entity));
      }
    }

    setAllDocs(normalizedDocs);
    setAllEntities(normalizedEntities);
    setAllTypes(normalizedTypes);

    void evaluateDocumentNotificationRules({
      documents: normalizedDocs,
      documentTypes: normalizedTypes,
      percentage: 100
    });

    if (!selectedUserId && currentEntityId) {
      setSelectedUserId(currentEntityId);
    }
  };

  useEffect(() => {
    const snapshot = readControlDocSnapshot();
    if (snapshot?.data) {
      processData(snapshot.data.documents || [], snapshot.data.entities || [], snapshot.data.documentTypes || []);
    }

    const fetchFreshData = async () => {
      setIsSyncing(true);
      const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };

      // Motor de descarga paginado seguro
      const fetchAllPages = async (baseUrl) => {
        let allItems = [];
        let page = 1;
        let hasMore = true;
        let retries = 0;

        while (hasMore && page <= 50) {
          try {
            const separator = baseUrl.includes('?') ? '&' : '?';
            const response = await fetch(`${baseUrl}${separator}page=${page}&per_page=100`, requestOptions);
            
            if (response.status === 401) throw new Error("Sesión expirada");
            
            if (response.status === 429) {
                 retries++;
                 if (retries > 3) break;
                 await new Promise(r => setTimeout(r, 2000));
                 continue; 
            }
            retries = 0;

            if (!response.ok) throw new Error(`HTTP: ${response.status}`);
            
            const json = await response.json();
            let items = Array.isArray(json) ? json : (Object.keys(json).find(k => Array.isArray(json[k])) ? json[Object.keys(json).find(k => Array.isArray(json[k]))] : []);
            
            if (!items || items.length === 0) {
              hasMore = false;
            } else {
              allItems.push(...items);
              page++;
              if (items.length < 100) hasMore = false;
              await new Promise(r => setTimeout(r, 100)); 
            }
          } catch (e) {
             hasMore = false;
             console.error("Error fetching:", e);
          }
        }
        return allItems;
      };

      try {
        const [types, entities, docs] = await Promise.all([
          fetchAllPages(getApiUrl('/controldoc/document-types')),
          fetchAllPages(getApiUrl('/controldoc/entities')),
          fetchAllPages(getApiUrl('/controldoc/documents')) // <- Cambio CLAVE al Proxy Seguro
        ]);

        processData(docs, entities, types);
      } catch (error) {
        console.error('Error sincronizando inicio:', error);
      } finally {
        setIsSyncing(false);
      }
    };

    fetchFreshData();
  }, []); // Cierre correcto del useEffect

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

  const activeUserId = selectedUserId || currentEntityId || '';
  const selectedEntity = allEntities.find((item) => item.id?.toString() === activeUserId.toString());
  const selectedEntityLabel = selectedEntity ? getEntityDisplayName(selectedEntity) : displayName;
  const selectedEntityIdentifier = formatInfoValue(
    getEntityFieldValue(selectedEntity, ['identifier'])
  );
  const selectedEntitySex = formatInfoValue(
    getEntityFieldValue(selectedEntity, ['sexo'])
  );
  const selectedEntityPersonalEmail = formatInfoValue(
    getEntityFieldValue(selectedEntity, ['correo_electronico_personal'])
  );
  const selectedEntityCorporateEmail = formatInfoValue(
    getEntityFieldValue(selectedEntity, ['correo_electronico_corporativo'])
  );

  const selectedUserDocs = useMemo(() => {
    const docs = Array.isArray(allDocs) ? allDocs : [];
    if (!activeUserId) return docs.filter((doc) => doc.aasm_state !== 'blocked');
    return docs.filter(
      (doc) => doc.entity_id?.toString() === activeUserId.toString() && doc.aasm_state !== 'blocked'
    );
  }, [activeUserId, allDocs]);

  const selectedPendingSignatures = useMemo(() =>
    selectedUserDocs
      .filter((doc) => doc.require_signers === true || doc.aasm_state === 'pending')
      .map((doc) => ({ ...doc, displayName: getDocName(doc) })),
    [selectedUserDocs]
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
    [selectedUserDocs]
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
    [selectedUserDocs]
  );

  const selectedDocPercentage = useMemo(() => {
    if (selectedUserDocs.length === 0) return 100;
    const healthyDocs = selectedUserDocs.filter((doc) => {
      const days = getDaysRemaining(doc.expires_at);
      return days === null || days > 30;
    }).length;
    return Math.round((healthyDocs / selectedUserDocs.length) * 100);
  }, [selectedUserDocs]);

  const searchSuggestions = useMemo(() => {
    const query = normalizeText(searchTerm);
    const identifierQuery = normalizeIdentifier(searchTerm);
    if (!query) return [];

    return allEntities
      .filter((entity) => {
        const entityIdentifier = getEntityFieldValue(entity, ['identifier']);
        const normalizedEntityIdentifier = normalizeIdentifier(entityIdentifier);

        const searchable = [
          entity?.full_name,
          entity?.name,
          entity?.email,
          entityIdentifier,
          entity?.document_number,
          entity?.identification,
          entity?.legal_id
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        const textMatch = searchable.includes(query);
        const identifierMatch = identifierQuery !== '' && normalizedEntityIdentifier.includes(identifierQuery);
        return textMatch || identifierMatch;
      })
      .slice(0, 6);
  }, [allEntities, searchTerm]);

  const handleSelectSuggestion = (entity) => {
    const entityId = entity?.id?.toString() || '';
    setSelectedUserId(entityId);
    setSearchTerm(getEntityDisplayName(entity));
    setIsAutocompleteOpen(false);
  };

  const handleClearSelection = () => {
    setSearchTerm('');
    setSelectedUserId(currentEntityId || '');
    setIsAutocompleteOpen(false);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] p-6 flex flex-row items-center gap-4 relative overflow-hidden flex-shrink-0 text-left shadow-lg">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 blur-2xl pointer-events-none"></div>
        <div className="w-16 h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg relative z-10 overflow-hidden">
          <User className="w-8 h-8 text-gray-300" />
        </div>
        <div className="relative z-10">
          <p className="text-white text-xs font-bold tracking-wider uppercase opacity-90 mb-1">
            Bienvenido
          </p>
          <h2 className="text-white text-2xl font-semibold tracking-wide">
            {displayName}
          </h2>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
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
                placeholder="Busca por nombre o RUT"
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
                      {getEntityFieldValue(entity, ['identifier']) || entity.document_number || entity.email || 'Sin identificación'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pb-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase font-semibold text-[#921E30]">Usuario seleccionado</p>
                <h3 className="text-base font-bold text-[#394049]">{selectedEntityLabel}</h3>
                <p className="text-xs text-gray-500">
                  {selectedEntityIdentifier}
                </p>
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-gray-600">
                    <span className="font-semibold text-gray-700">Sexo:</span> {selectedEntitySex}
                  </p>
                  <p className="text-xs text-gray-600 break-all">
                    <span className="font-semibold text-gray-700">Correo personal:</span> {selectedEntityPersonalEmail}
                  </p>
                  <p className="text-xs text-gray-600 break-all">
                    <span className="font-semibold text-gray-700">Correo corporativo:</span> {selectedEntityCorporateEmail}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-xs font-semibold text-[#921E30] shrink-0"
              >
                Mi perfil
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
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
        </div>

        <div className="px-6 pt-2 pb-2 flex justify-between items-end">
          <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">
            Porcentaje de documentos
          </h3>
        </div>

        <div className="flex flex-col items-center justify-center py-6 px-8 bg-white">
          <div className="w-full max-w-md bg-gray-800 rounded-full h-6 shadow-lg overflow-hidden">
            <div
              className="h-6 rounded-full transition-all duration-500"
              style={{
                width: `${selectedDocPercentage}%`,
                backgroundColor:
                  selectedDocPercentage >= 80
                    ? '#22c55e'
                    : selectedDocPercentage >= 50
                    ? '#B8860B'
                    : '#FF0000'
              }}
            ></div>
          </div>
          <span className="text-doc-percentage text-lg mt-2.5 uppercase font-bold tracking-wider text-gray-800">
            {selectedDocPercentage}%
          </span>
        </div>

        <div className="px-6 pt-4 pb-2 flex justify-between items-end">
          <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Firmas Pendientes</h3>
          <button onClick={() => setView('firmas')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
        </div>

        <div className="px-6 mb-4 mt-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            {selectedPendingSignatures.length > 0 ? (
              <div className="space-y-3">
                {selectedPendingSignatures.map((doc) => (
                  <div key={doc.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mb-2 hover:shadow-md transition">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <PenTool className="w-5 h-5 text-[#921E30] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
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
              <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                {isSyncing ? 'Verificando firmas pendientes...' : 'No hay firmas pendientes para este usuario.'}
              </div>
            )}
          </div>
        </div>

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

            {selectedExpiringDocs.length > 0 ? (
              <div className="space-y-3">
                {selectedExpiringDocs.map((doc) => {
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
                          <p className="text-[11px] text-gray-500">Expira {formatDate(doc.expires_at)}</p>
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
                {isSyncing ? 'Buscando alertas...' : '¡Excelente! No hay documentos próximos a expirar para este usuario.'}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase font-semibold text-[#22c55e]">Vigentes</p>
                <h4 className="text-base font-bold text-[#394049]">Documentos Vigentes</h4>
              </div>
              <span className="text-xs text-gray-500">
                {selectedValidDocs.length} vigentes
              </span>
            </div>

            {selectedValidDocs.length > 0 ? (
              <div className="space-y-3">
                {selectedValidDocs.map((doc) => {
                  const statusText =
                    doc.daysRemaining === null
                      ? 'Sin fecha de expiración'
                      : `Vigente por ${doc.daysRemaining} días`;

                  return (
                    <div key={doc.id} className="rounded-2xl border border-green-200 p-3 bg-green-50/40 shadow-sm hover:shadow transition">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                          <p className="text-[11px] text-gray-500">
                            {doc.expires_at ? `Expira ${formatDate(doc.expires_at)}` : 'Sin expiración registrada'}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-green-300 bg-green-100 text-green-700 flex-shrink-0">
                          {statusText}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                {isSyncing ? 'Buscando documentos vigentes...' : 'No hay documentos vigentes para este usuario.'}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};