import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, User, Clock, PenTool, Globe, ShieldAlert, KeyRound, Eye, EyeOff, RotateCcw } from 'lucide-react';

// --- STUBS INTEGRADOS ---
const getApiUrl = (path) => path.startsWith('http') ? path : `/api${path}`;

const isControlDocSnapshotFresh = (snapshot, maxAgeMs) => {
  if (!snapshot || !snapshot.savedAt) return false;
  return (Date.now() - new Date(snapshot.savedAt).getTime()) < maxAgeMs;
};

const readControlDocSnapshotAsync = async (key) => {
  try {
    const stored = localStorage.getItem(`controlDocSnapshot_${key}`);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
};

const saveControlDocSnapshotAsync = async (data, key) => {
  try {
    localStorage.setItem(`controlDocSnapshot_${key}`, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
  } catch (error) {
    console.warn('No se pudo guardar el respaldo local de ControlDoc:', error);
  }
};

const getUserSnapshotKey = (user) => user?.id ? `user_${user.id}` : 'global';

// EL CANDADO DEFINITIVO DE ROLES CON TUS IDs EXACTOS
const hasAdminRole = (user) => {
  if (!user) return false;
  if (user.rol_id !== undefined && user.rol_id !== null) {
    return [2, 10, 11, 13].includes(Number(user.rol_id));
  }
  const roleName = (user?.rol || user?.role || '').toLowerCase().trim();
  return ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(roleName) || roleName.includes('admin');
};

const canAccessAdminPanel = (user) => {
  if (!user) return false;
  if (user.rol_id !== undefined && user.rol_id !== null) {
    return [2, 10, 11, 13].includes(Number(user.rol_id));
  }
  const roleName = (user?.rol || user?.role || '').toLowerCase().trim();
  return ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(roleName) || roleName.includes('admin');
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

const parseControlDocDate = (dateString) => {
  if (!dateString) return null;
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const parsedDate = parseControlDocDate(dateString);
  return parsedDate
    ? parsedDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'N/A';
};

const getDocumentExpirationDate = (doc) => doc.expires_at;

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = parseControlDocDate(dateString);
  if (!expirationDate) return null;
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const isBlockedDocument = (doc) => doc.aasm_state === 'blocked' && !doc.blocked_description?.toLowerCase().includes('cargo');
const getDocumentStatusText = (doc) => doc.aasm_state;
const hasNonCompliantDocumentStatus = (doc) => ['rejected', 'expired'].includes(doc.aasm_state);

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
const getEntityCorporateEmail = (entity) => getEntityFieldValue(entity, ['correo_electronico_corporativo', 'correo electronico corporativo', 'email_corporativo', 'email corporativo', 'corporate_email', 'corporateEmail', 'work_email', 'workEmail', 'correo_empresa', 'correo empresa']);
const getEntityPhone = (entity) => getEntityFieldValue(entity, ['telefono', 'teléfono', 'phone', 'mobile', 'celular', 'telefono_movil', 'telefono movil', 'numero_telefono', 'numero telefono', 'phone_number', 'phoneNumber', 'contact_phone', 'contactPhone']);
const SNAPSHOT_FRESH_MS = 15 * 60 * 1000;
const SEVERITY_COLORS = {
  red: '#921E30',
  orange: '#D94A00',
  yellow: '#B8860B',
  green: '#22c55e'
};

const getProgressColor = (percentage) => {
  if (percentage <= 30) return SEVERITY_COLORS.red;
  if (percentage <= 50) return SEVERITY_COLORS.orange;
  if (percentage <= 70) return SEVERITY_COLORS.yellow;
  return SEVERITY_COLORS.green;
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
      lower === 'true' || lower === '1' || lower === 'pending' || lower === 'pendiente' ||
      lower.includes('pendiente') || lower.includes('pending') || lower.includes('por firmar') ||
      lower.includes('sin firmar') || lower.includes('to sign') || lower.includes('needs signature') ||
      (lower.includes('signature') && lower.includes('pending'))
    );
  };
  const keysToCheck = [
    'pending_signature', 'signature_pending', 'pending_signatures', 'pending_signatures_count',
    'signature_status', 'signature_state', 'aasm_state', 'state', 'status', 'workflow_state'
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

const getDocumentEntityIds = (doc) => {
  if (!doc) return [];
  const ids = [doc.entity_id, doc.abstract_entity_id, doc.employee_id].filter(id => id !== undefined && id !== null);
  return [...new Set(ids.map(id => id.toString()))];
}

// COMPONENTE PRINCIPAL
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
  const [serverNotice, setServerNotice] = useState('');
  
  // Modals auth
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordStep, setPasswordStep] = useState('verify');
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [passwordVerificationToken, setPasswordVerificationToken] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const snapshotOwnerKey = getUserSnapshotKey(currentUser);

  const processData = useCallback((docs, entities, types) => {
    const normalizedDocs = toArray(docs, ['documents', 'data', 'items']);
    const normalizedEntities = toArray(entities, ['entities', 'data', 'items']);
    const normalizedTypes = toArray(types, ['documentTypes', 'document_types', 'data', 'items']);

    console.log("🧩 Procesando datos servidos por backend:", { docsLen: normalizedDocs.length, entLen: normalizedEntities.length });
    setAllDocs(normalizedDocs);
    setAllEntities(normalizedEntities);
    setAllTypes(normalizedTypes);
  }, []);

  const handleForceHardReset = async () => {
    localStorage.clear();
    sessionStorage.clear();
    
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
          await registration.unregister();
        }
      } catch (e) { console.error(e); }
    }
    
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (let key of keys) {
          await caches.delete(key);
        }
      } catch (e) { console.error(e); }
    }
    
    window.location.reload(true);
  };

  useEffect(() => {
    let isCancelled = false;

    const fetchFreshData = async () => {
      setIsSyncing(true);
      setServerNotice('');
      onLoadingProgress?.({ percent: 15 });
      
      try {
        const requestOptions = { 
            method: 'GET', 
            credentials: 'same-origin', 
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        };
        
        const fetchJson = async (url) => {
          const separator = url.includes('?') ? '&' : '?';
          const bypassUrl = `${url}${separator}_t=${Date.now()}`;
          
          const response = await fetch(bypassUrl, requestOptions);
          if (response.status === 502) throw new Error("502_BACKGROUND_TASK");
          if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
          return await response.json();
        };

        const [docsData, entitiesData, typesData] = await Promise.all([
          fetchJson(getApiUrl('/controldoc/documents')),
          fetchJson(getApiUrl('/controldoc/entities')),
          fetchJson(getApiUrl('/controldoc/document-types'))
        ]);

        onLoadingProgress?.({ percent: 90 });
        if (isCancelled) return;

        const nextData = {
          documents: docsData,
          entities: toArray(entitiesData, ['entities', 'data', 'items']),
          documentTypes: toArray(typesData, ['documentTypes', 'document_types', 'data', 'items']),
          meta: { documents: { totalItems: (docsData || []).length } }
        };

        setSyncStats({ source: 'api', totalItems: nextData.documents.length, complete: true });
        processData(nextData.documents, nextData.entities, nextData.documentTypes);
        
        // Guardamos el snapshot validado
        if (!hasAdminRole(currentUser)) void saveControlDocSnapshotAsync(nextData, snapshotOwnerKey);
        
        onLoadingProgress?.({ percent: 100, done: true });
      } catch (error) {
        onLoadingProgress?.({ active: false });
        if (error.message === "502_BACKGROUND_TASK") {
             setServerNotice("El servidor está procesando una actualización masiva. Espera 1 minuto y presiona 'Actualizar'.");
        } else {
             console.error('❌ Error fatal de Red/Servidor:', error);
        }
      } finally {
        if (!isCancelled) setIsSyncing(false);
      }
    };

    const loadData = async () => {
      const snapshot = await readControlDocSnapshotAsync(snapshotOwnerKey);
      if (isCancelled) return;

      if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        processData(snapshot.documents || [], snapshot.entities || [], snapshot.documentTypes || []);
        setSyncStats({ source: 'cache', totalItems: (snapshot.documents || []).length, complete: true });
      }

      if (refreshToken === 0 && isControlDocSnapshotFresh(snapshot, SNAPSHOT_FRESH_MS, { requireComplete: hasAdminRole(currentUser) })) {
        setIsSyncing(false);
        return;
      }

      await fetchFreshData();
    };

    loadData();
    return () => { isCancelled = true; };
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

  const isAdminUser = hasAdminRole(currentUser);
  
  // 1. Confianza ciega en la API: allEntities viene filtrado para tripulantes
  const selectedEntity = useMemo(() => {
    if (isAdminUser) {
      return selectedUserId ? allEntities.find((item) => item.id?.toString() === selectedUserId.toString()) : null;
    }
    return allEntities.length > 0 ? allEntities[0] : null;
  }, [allEntities, isAdminUser, selectedUserId]);

  const displayEntity = selectedEntity || (!isAdminUser ? {
    name: getCurrentUserDisplayName(currentUser), 
    email: currentUser?.email || '', 
    rut: currentUser?.rut || ''
  } : null);
  
  const isGlobalView = isAdminUser && !selectedEntity;

  const appRoleText = currentUser?.rol || 'Tripulante';
  const fullNameText = isAdminUser ? getCurrentUserDisplayName(currentUser) : getEntityDisplayName(displayEntity);
  const cargoHeader = isAdminUser ? 'Gestión Central' : formatInfoValue(getEntityFieldValue(displayEntity, ['cargo', 'position', 'job_title', 'puesto']));

  const detailCargo = formatInfoValue(getEntityFieldValue(displayEntity, ['cargo', 'position', 'job_title', 'puesto']));
  const detailEmpresa = formatInfoValue(getEntityFieldValue(displayEntity, ['empresa', 'company', 'organization', 'razon_social']));
  const rawContractDate = getEntityFieldValue(displayEntity, ['fecha_contrato', 'contract_date', 'hired_at', 'fecha_ingreso']);
  const detailFechaContrato = rawContractDate ? formatDate(rawContractDate) : 'No informado';
  const profileEmail = currentUser?.email || getEntityEmail(displayEntity);
  const profileCorporateEmail = getEntityCorporateEmail(displayEntity);
  const profilePhone = getEntityPhone(displayEntity);

  // 2. Confianza ciega en la API: allDocs viene filtrado para tripulantes
  const selectedUserDocs = useMemo(() => {
    if (!isAdminUser) return allDocs; 
    if (!selectedUserId) return []; // Admin viendo vista global
    
    return allDocs.filter(doc => {
      const docEntityId = doc.entity_id?.toString() || doc.abstract_entity_id?.toString() || doc.employee_id?.toString();
      return docEntityId === selectedUserId;
    });
  }, [isAdminUser, selectedUserId, allDocs]);

  const selectedPendingSignatures = useMemo(() =>
    selectedUserDocs.filter(hasPendingSignature).map((doc) => ({ ...doc, displayName: getDocName(doc) })), [selectedUserDocs, getDocName]
  );

  const selectedExpiringDocs = useMemo(() =>
    selectedUserDocs.map((doc) => ({
      ...doc, daysRemaining: getDaysRemaining(getDocumentExpirationDate(doc)), expirationDate: getDocumentExpirationDate(doc), displayName: getDocName(doc)
    })).filter((doc) => doc.daysRemaining !== null && doc.daysRemaining <= 60).sort((a, b) => a.daysRemaining - b.daysRemaining), [selectedUserDocs, getDocName]
  );

  const selectedHealthyDocsCount = useMemo(() =>
    selectedUserDocs.filter((doc) => getDocumentComplianceBucket(doc) === 'healthy').length, [selectedUserDocs]
  );

  const selectedDocPercentage = useMemo(() => {
    if (selectedUserDocs.length === 0) return 0;
    return Math.round((selectedHealthyDocsCount / selectedUserDocs.length) * 100);
  }, [selectedHealthyDocsCount, selectedUserDocs.length]);

  const globalMetrics = useMemo(() => {
    const totalDocsCount = allDocs.length;
    let docsAlDia = 0, docsCaducados = 0, docsEn30Dias = 0, docsEn3060Dias = 0;

    const collaboratorStatusMap = {};
    allEntities.forEach(ent => { collaboratorStatusMap[ent.id?.toString()] = 'healthy'; });

    allDocs.forEach((doc) => {
      const entityIds = getDocumentEntityIds(doc);
      const bucket = getDocumentComplianceBucket(doc);

      if (bucket === 'nonCompliant') {
        docsCaducados++;
        entityIds.forEach((entId) => { if (collaboratorStatusMap[entId]) collaboratorStatusMap[entId] = 'caducado'; });
      } else if (bucket === 'critical') {
        docsEn30Dias++;
        entityIds.forEach((entId) => { if (collaboratorStatusMap[entId] && collaboratorStatusMap[entId] !== 'caducado') collaboratorStatusMap[entId] = 'critical'; });
      } else if (bucket === 'warning') {
        docsEn3060Dias++;
        entityIds.forEach((entId) => { if (collaboratorStatusMap[entId] && !['caducado', 'critical'].includes(collaboratorStatusMap[entId])) collaboratorStatusMap[entId] = 'warning'; });
      } else { docsAlDia++; }
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

    return { totalColabs, cumplimientoColaboradores, colabsAlDia, colabCaducados, colabEn30Dias, colabEn3060Dias, totalDocsCount, cumplimientoDocumental, docsAlDia, docsCaducados, docsEn30Dias, docsEn3060Dias };
  }, [allDocs, allEntities]);

  const searchSuggestions = useMemo(() => {
    const query = normalizeText(searchTerm);
    const identifierQuery = normalizeIdentifier(searchTerm);
    const isIdentifierSearch = /\d/.test(searchTerm);
    const textTokens = splitSearchTokens(searchTerm);
    if (!isAdminUser || !query) return [];

    return allEntities.map((entity) => {
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
        return { entity, score: startsWithQuery ? 2 : tokenStartsWithQuery ? 3 : 4, label: nameText };
      }).filter(Boolean).sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, 'es')).map((item) => item.entity).slice(0, 8);
  }, [allEntities, isAdminUser, searchTerm]);

  const handleSelectSuggestion = (entity) => {
    onLoadingProgress?.({ percent: 35 });
    const entityId = entity?.id?.toString() || '';
    setSelectedUserId(entityId);
    setSearchTerm(getEntityDisplayName(entity));
    setIsAutocompleteOpen(false);
    window.setTimeout(() => { onLoadingProgress?.({ percent: 100, done: true }); }, 220);
  };

  const handleClearSelection = () => {
    setSearchTerm('');
    setSelectedUserId('');
    setIsAutocompleteOpen(false);
  };

  const syncSourceText = syncStats?.source === 'cache' ? 'celular' : 'servidor';
  const syncStatusText = isSyncing ? 'cargando' : 'completada';
  const passwordEmail = (currentUser?.email || getEntityEmail(displayEntity) || '').trim().toLowerCase();

  const resetPasswordFlow = useCallback(() => {
    setPasswordStep('verify'); setCurrentPasswordInput(''); setNewPasswordInput(''); setConfirmPasswordInput('');
    setPasswordVerificationToken(''); setPasswordError(''); setPasswordSuccess(''); setPasswordLoading(false);
    setShowCurrentPassword(false); setShowNewPassword(false); setShowConfirmPassword(false);
  }, []);

  const handleOpenPasswordModal = useCallback(() => { resetPasswordFlow(); setIsPasswordModalOpen(true); }, [resetPasswordFlow]);
  const handleClosePasswordModal = useCallback(() => { setIsPasswordModalOpen(false); resetPasswordFlow(); }, [resetPasswordFlow]);

  const handleVerifyCurrentPassword = useCallback(async (e) => {
    e.preventDefault(); setPasswordError(''); setPasswordSuccess('');
    if (!passwordEmail) return setPasswordError('No se pudo identificar el correo del usuario autenticado.');
    if (!currentPasswordInput) return setPasswordError('Ingresa tu contraseña actual.');

    setPasswordLoading(true); onLoadingProgress?.({ percent: 18 });
    try {
      const response = await fetch(getApiUrl('/auth/verify-reset-identity'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: passwordEmail, password: currentPasswordInput })
      });
      onLoadingProgress?.({ percent: 68 });
      const data = await response.json();
      onLoadingProgress?.({ percent: 92 });
      if (!response.ok) throw new Error(data.error || 'No se pudo validar tu contraseña actual.');
      setPasswordVerificationToken(data.verificationToken || '');
      setCurrentPasswordInput('');
      setPasswordStep('reset');
      onLoadingProgress?.({ percent: 100, done: true });
    } catch (error) {
      onLoadingProgress?.({ active: false }); setPasswordError(error.message || 'No se pudo validar tu contraseña actual.');
    } finally { setPasswordLoading(false); }
  }, [currentPasswordInput, onLoadingProgress, passwordEmail]);

  const handleUpdatePassword = useCallback(async (e) => {
    e.preventDefault(); setPasswordError(''); setPasswordSuccess('');
    if (!passwordEmail) return setPasswordError('No se pudo identificar el correo del usuario autenticado.');
    if (!newPasswordInput) return setPasswordError('Ingresa una nueva contraseña.');
    if (newPasswordInput.length < 8) return setPasswordError('La nueva contraseña debe tener al menos 8 caracteres.');
    if (newPasswordInput !== confirmPasswordInput) return setPasswordError('La confirmación de contraseña no coincide.');
    if (!passwordVerificationToken) return setPasswordError('Primero valida tu contraseña actual.');

    setPasswordLoading(true); onLoadingProgress?.({ percent: 18 });
    try {
      const response = await fetch(getApiUrl('/auth/reset-password'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: passwordEmail, password: newPasswordInput, verificationToken: passwordVerificationToken })
      });
      onLoadingProgress?.({ percent: 68 });
      const data = await response.json();
      onLoadingProgress?.({ percent: 92 });
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la contraseña.');
      setPasswordSuccess('Tu contraseña fue actualizada correctamente.');
      setNewPasswordInput(''); setConfirmPasswordInput(''); setPasswordVerificationToken(''); setPasswordStep('verify');
      onLoadingProgress?.({ percent: 100, done: true });
    } catch (error) {
      onLoadingProgress?.({ active: false }); setPasswordError(error.message || 'No se pudo actualizar la contraseña.');
    } finally { setPasswordLoading(false); }
  }, [confirmPasswordInput, newPasswordInput, onLoadingProgress, passwordEmail, passwordVerificationToken]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] rounded-2xl p-4 sm:p-6 md:px-10 relative overflow-hidden flex-shrink-0 text-left shadow-lg">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 blur-2xl pointer-events-none"></div>

        <div className="mx-auto w-full max-w-6xl flex flex-row flex-wrap sm:flex-nowrap items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg overflow-hidden">
              {isAdminUser ? <Globe className="w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 text-gray-400" /> : <User className="w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 text-gray-400" />}
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-white text-xs font-bold tracking-wider uppercase opacity-75">Bienvenido</span>
              <span className="text-xs font-bold text-[#e1575f] tracking-wide uppercase">{appRoleText}</span>
              <h2 className="text-white text-lg sm:text-xl md:text-2xl font-bold tracking-wide leading-tight truncate">{fullNameText}</h2>
              <span className="text-gray-300 text-xs italic font-light truncate">{cargoHeader}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canAccessAdminPanel(currentUser) && (
              <button onClick={() => setView('admin')} className="relative z-10 bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl border border-white/20 backdrop-blur-sm transition-all shadow-sm flex flex-col items-center justify-center shrink-0 cursor-pointer" title="Panel de Administración">
                <ShieldAlert className="w-5 h-5 mb-0.5" />
                <span className="text-[9px] font-bold uppercase tracking-wider">Admin</span>
              </button>
            )}
            <button type="button" onClick={handleOpenPasswordModal} className="relative z-10 bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl border border-white/20 backdrop-blur-sm transition-all shadow-sm flex flex-col items-center justify-center shrink-0 cursor-pointer" title="Cambiar contraseña">
              <KeyRound className="w-5 h-5 mb-0.5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">Clave</span>
            </button>
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
        {serverNotice && (
            <div className="bg-yellow-50 text-yellow-800 p-4 mx-4 sm:mx-6 mt-4 rounded-xl text-xs font-medium border border-yellow-200 shadow-sm max-w-6xl md:mx-auto">
                {serverNotice}
            </div>
        )}

        {isAdminUser && (
          <div className="p-4 sm:p-6 pb-2 max-w-6xl mx-auto w-full">
            <div className="relative">
                <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setSelectedUserId(''); setIsAutocompleteOpen(true); }}
                    onFocus={() => setIsAutocompleteOpen(true)} placeholder="Busca un tripulante por nombre o RUT..."
                    className="w-full bg-transparent py-4 pl-12 pr-10 focus:outline-none text-sm"
                  />
                {searchTerm && (
                  <button type="button" onClick={handleClearSelection} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 hover:text-[#921E30]">✕</button>
                )}
              </div>
              {isAutocompleteOpen && searchSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto">
                  {searchSuggestions.map((entity) => (
                    <button key={entity.id} type="button" onClick={() => handleSelectSuggestion(entity)} className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                      <p className="text-sm font-semibold text-[#394049]">{getEntityDisplayName(entity)}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500">
                        <span className="font-semibold text-[#921E30]">RUT: {getEntityRut(entity) || 'Sin RUT'}</span>
                        <span>Email: {getEntityEmail(entity) || 'Sin email'}</span>
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

        <div className="px-4 sm:px-6 pb-4 pt-2 max-w-6xl mx-auto w-full">
          {isGlobalView ? (
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="text-white p-6 text-center flex flex-col justify-center items-center flex-1 min-h-[160px]" style={{ backgroundColor: getProgressColor(globalMetrics.cumplimientoColaboradores) }}>
                    <h4 className="text-sm font-semibold uppercase tracking-wider opacity-90">Cumplimiento Colaboradores</h4>
                    <p className="text-5xl font-black my-2">{globalMetrics.cumplimientoColaboradores} %</p>
                    <p className="text-xs opacity-75">De {globalMetrics.totalColabs} Colaboradores</p>
                  </div>
                  <div className="p-4 bg-white text-center border-t border-gray-50">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Estado de Colaboradores</p>
                    <div className="grid grid-cols-4 gap-1">
                      <div><p className="text-base font-bold text-[#921E30]">{globalMetrics.colabCaducados}</p><p className="text-[10px] text-gray-400 leading-tight">Caducado</p></div>
                      <div><p className="text-base font-bold text-[#D94A00]">{globalMetrics.colabEn30Dias}</p><p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 días</p></div>
                      <div><p className="text-base font-bold text-[#B8860B]">{globalMetrics.colabEn3060Dias}</p><p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 a 60 días</p></div>
                      <div><p className="text-base font-bold text-green-600">{globalMetrics.colabsAlDia}</p><p className="text-[10px] text-gray-400 leading-tight">Al<br/>día</p></div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                  <div className="text-white p-6 text-center flex flex-col justify-center items-center flex-1 min-h-[160px]" style={{ backgroundColor: getProgressColor(globalMetrics.cumplimientoDocumental) }}>
                    <h4 className="text-sm font-semibold uppercase tracking-wider opacity-90">Cumplimiento Documental</h4>
                    <p className="text-5xl font-black my-2">{globalMetrics.cumplimientoDocumental} %</p>
                    <p className="text-xs opacity-75">De {globalMetrics.totalDocsCount} Documentos</p>
                  </div>
                  <div className="p-4 bg-white text-center border-t border-gray-50">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Estado de Documentos</p>
                    <div className="grid grid-cols-4 gap-1">
                      <div><p className="text-base font-bold text-[#921E30]">{globalMetrics.docsCaducados}</p><p className="text-[10px] text-gray-400 leading-tight">Caducado</p></div>
                      <div><p className="text-base font-bold text-[#D94A00]">{globalMetrics.docsEn30Dias}</p><p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 días</p></div>
                      <div><p className="text-base font-bold text-[#B8860B]">{globalMetrics.docsEn3060Dias}</p><p className="text-[10px] text-gray-400 leading-tight">Caduca en<br/>30 a 60 días</p></div>
                      <div><p className="text-base font-bold text-green-600">{globalMetrics.docsAlDia}</p><p className="text-[10px] text-gray-400 leading-tight">Al<br/>día</p></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">Carga {syncStatusText} desde {syncSourceText}: {syncStats?.totalItems ?? globalMetrics.totalDocsCount} documentos.</span>
                
                <div className="flex items-center gap-3">
                    <button type="button" onClick={handleForceHardReset} className="shrink-0 text-gray-400 hover:text-red-500 font-bold flex items-center transition" title="Destruir Caché y Recargar">
                      <RotateCcw className="w-3 h-3 inline mr-1" /> Reparar
                    </button>
                    <button type="button" onClick={() => { setSyncStats(null); setRefreshToken((value) => value + 1); }} disabled={isSyncing} className="shrink-0 text-[#921E30] font-bold disabled:opacity-50 flex items-center">
                      {isSyncing ? <Clock className="w-3 h-3 animate-spin inline mr-1" /> : ''} Actualizar
                    </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <p className="text-xs uppercase font-semibold text-[#921E30]">{!isAdminUser ? 'Mi Perfil' : 'Usuario seleccionado'}</p>
                  {isAdminUser && <h3 className="text-base font-bold text-[#394049]">{getEntityDisplayName(displayEntity)}</h3>}
                  <p className="text-xs text-gray-500 mb-2">RUT: {formatInfoValue(getEntityRut(displayEntity))}</p>
                  <p className="text-xs text-gray-500 mb-2">Email: {profileEmail || 'No registrado'}</p>
                  <p className="text-xs text-gray-500 mb-2">Correo corporativo: {profileCorporateEmail || 'No registrado'}</p>
                  <p className="text-xs text-gray-500 mb-2">Teléfono: {profilePhone || 'No registrado'}</p>
                  <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                    {isAdminUser && <p className="text-xs text-gray-600"><span className="font-semibold text-gray-700">Cargo:</span> {detailCargo}</p>}
                    <p className="text-xs text-gray-600"><span className="font-semibold text-gray-700">Empresa:</span> {detailEmpresa}</p>
                    <p className="text-xs text-gray-600"><span className="font-semibold text-gray-700">Fecha de Contrato:</span> {detailFechaContrato}</p>
                  </div>
                </div>
                {isAdminUser && selectedEntity && (
                  <button type="button" onClick={handleClearSelection} className="text-xs font-semibold text-[#921E30] shrink-0 bg-red-50 px-2 py-1 rounded-md">Ver General</button>
                )}
              </div>
              
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
                <div className="rounded-xl bg-gray-50 p-2 text-center"><p className="text-[10px] uppercase text-gray-500">Docs</p><p className="text-base font-bold text-[#394049]">{selectedUserDocs.length}</p></div>
                <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[10px] uppercase text-gray-500">Firmas</p><p className="text-base font-bold text-[#921E30]">{selectedPendingSignatures.length}</p></div>
                <div className="rounded-xl bg-amber-50 p-2 text-center"><p className="text-[10px] uppercase text-gray-500">Alertas</p><p className="text-base font-bold text-[#B8860B]">{selectedExpiringDocs.length}</p></div>
              </div>

              {displayEntity && selectedUserDocs.length === 0 && !isSyncing && (
                <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-500">La API no entrega documentos asociados para esta persona.</div>
              )}

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Avance del Trabajador</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Documentos vigentes del colaborador seleccionado</p>
                  </div>
                  <div className="flex items-baseline sm:text-right gap-2 sm:flex-col sm:gap-0">
                    <span className="text-2xl font-black" style={{ color: getProgressColor(selectedDocPercentage) }}>{selectedDocPercentage}%</span>
                    <p className="text-xs font-semibold text-gray-400">{selectedHealthyDocsCount} de {selectedUserDocs.length} docs</p>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 mt-3 overflow-hidden">
                  <div className="h-3 rounded-full transition-all duration-1000 ease-out" style={{ width: `${selectedDocPercentage}%`, backgroundColor: getProgressColor(selectedDocPercentage) }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isGlobalView && (
          <div className="px-4 sm:px-6 max-w-6xl mx-auto w-full lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
            <div className="mb-4 mt-2 lg:mb-0 lg:mt-0">
            <div className="pt-2 pb-2 flex justify-between items-end">
              <h3 className="font-bold text-[#394049] text-base border-b-2 border-[#921E30] pb-0.5">{isAdminUser ? 'Firmas Pendientes' : 'Mis Firmas Pendientes'}</h3>
              <button onClick={() => setView('firmas')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
            </div>

            <div className="mt-2">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                {selectedPendingSignatures.length > 0 ? (
                  <div className="space-y-3">
                    {selectedPendingSignatures.slice(0, 5).map((doc) => (
                      <div key={doc.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mb-2 hover:shadow-md transition">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <PenTool className="w-5 h-5 text-[#921E30] shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                            <p className="text-[11px] text-gray-500 truncate">{isAdminUser ? 'Requiere firma digital' : 'Requiere tu firma digital'}</p>
                          </div>
                        </div>
                        <a href={`https://compliance.controldoc.legal/documentos/${doc.id}`} target="_blank" rel="noopener noreferrer" className="bg-[#921E30] text-white text-xs px-3 py-1.5 rounded-md font-semibold shadow-sm hover:bg-red-800 transition-colors ml-2 shrink-0">Firmar</a>
                      </div>
                    ))}
                    {selectedPendingSignatures.length > 5 && (<p className="text-center text-xs text-gray-400 pt-1">Y {selectedPendingSignatures.length - 5} firmas más pendientes...</p>)}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">{isSyncing ? 'Verificando firmas...' : 'No hay firmas pendientes registradas.'}</div>
                )}
              </div>
            </div>
            </div>

            <div className="mb-6 lg:mb-0">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs uppercase font-semibold text-[#921E30]">Alertas</p>
                    <h4 className="text-base font-bold text-[#394049]">Documentos Próximos a Vencer</h4>
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                    {isSyncing ? (<span className="flex items-center text-blue-500 animate-pulse"><Clock className="w-3 h-3 mr-1" /> Sincronizando...</span>) : (<><Clock className="w-4 h-4" /> Alertas activas</>)}
                  </div>
                </div>

                {selectedExpiringDocs.length > 0 ? (
                  <div className="space-y-3">
                    {selectedExpiringDocs.slice(0, 5).map((doc) => {
                      const isExpired = doc.daysRemaining <= 0;
                      const isCritical = doc.daysRemaining >= 1 && doc.daysRemaining <= 30;
                      const isWarning = doc.daysRemaining >= 31 && doc.daysRemaining <= 60;
                      let borderClass = 'border-gray-100', pillClass = '', statusText = '';

                      if (isExpired) {
                        borderClass = 'border-red-200';
                        pillClass = 'severity-pill-red';
                        statusText = doc.daysRemaining === 0 ? 'Expira hoy' : `Expirado (${Math.abs(doc.daysRemaining)}d)`;
                      } else if (isCritical) {
                        borderClass = 'border-orange-200';
                        pillClass = 'severity-pill-orange';
                        statusText = `Expira en ${doc.daysRemaining}d`;
                      } else if (isWarning) {
                        borderClass = 'border-amber-200';
                        pillClass = 'severity-pill-amber';
                        statusText = `Expira en ${doc.daysRemaining}d`;
                      }

                      return (
                        <div key={doc.id} className={`rounded-xl border p-3 bg-white shadow-sm hover:shadow transition ${borderClass}`}>
                          <div className="flex justify-between items-start gap-3">
                            <div className="flex-1 overflow-hidden">
                              <p className="text-sm font-semibold text-[#394049] truncate">{doc.displayName}</p>
                              <p className="text-[11px] text-gray-500">Vence el {formatDate(doc.expirationDate)}</p>
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${pillClass}`}>{statusText}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">{isSyncing ? 'Buscando alertas...' : 'No se registran alertas urgentes de vencimiento.'}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button type="button" aria-label="Cerrar modal" onClick={handleClosePasswordModal} className="absolute inset-0 bg-black/40" />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-bold text-[#921E30]">Seguridad</p>
                <h3 className="text-lg font-bold text-[#394049]">Cambiar contraseña</h3>
                <p className="text-xs text-gray-500 mt-1">{passwordStep === 'verify' ? 'Paso 1: valida tu contraseña actual.' : 'Paso 2: define tu nueva contraseña.'}</p>
              </div>
              <button type="button" onClick={handleClosePasswordModal} className="text-xs font-bold text-gray-500 hover:text-[#921E30]">Cerrar</button>
            </div>

            {passwordStep === 'verify' && (
              <form onSubmit={handleVerifyCurrentPassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Correo</label>
                  <input type="email" value={passwordEmail} disabled readOnly className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Contraseña actual</label>
                  <div className="relative">
                    <input type={showCurrentPassword ? 'text' : 'password'} value={currentPasswordInput} onChange={(e) => setCurrentPasswordInput(e.target.value)} autoComplete="current-password" placeholder="Ingresa tu contraseña actual" className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#921E30]/40" />
                    <button type="button" onClick={() => setShowCurrentPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500">{showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                {passwordError && (<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{passwordError}</div>)}
                {passwordSuccess && (<div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{passwordSuccess}</div>)}
                <button type="submit" disabled={passwordLoading} className="w-full bg-[#394049] hover:bg-gray-800 text-white text-sm font-bold py-2.5 rounded-lg disabled:opacity-60">{passwordLoading ? 'Validando...' : 'Continuar'}</button>
              </form>
            )}

            {passwordStep === 'reset' && (
              <form onSubmit={handleUpdatePassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nueva contraseña</label>
                  <div className="relative">
                    <input type={showNewPassword ? 'text' : 'password'} value={newPasswordInput} onChange={(e) => setNewPasswordInput(e.target.value)} autoComplete="new-password" placeholder="Mínimo 8 caracteres" className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#921E30]/40" />
                    <button type="button" onClick={() => setShowNewPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500">{showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Confirmar nueva contraseña</label>
                  <div className="relative">
                    <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPasswordInput} onChange={(e) => setConfirmPasswordInput(e.target.value)} autoComplete="new-password" placeholder="Repite tu nueva contraseña" className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#921E30]/40" />
                    <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500">{showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                {passwordError && (<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{passwordError}</div>)}
                {passwordSuccess && (<div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{passwordSuccess}</div>)}
                <button type="submit" disabled={passwordLoading} className="w-full bg-[#921E30] hover:bg-[#7c1928] text-white text-sm font-bold py-2.5 rounded-lg disabled:opacity-60">{passwordLoading ? 'Actualizando...' : 'Cambiar contraseña'}</button>
                <button type="button" onClick={() => { setPasswordStep('verify'); setNewPasswordInput(''); setConfirmPasswordInput(''); setPasswordVerificationToken(''); setPasswordError(''); setPasswordSuccess(''); }} className="w-full text-xs font-semibold text-[#921E30]">Volver al paso anterior</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
