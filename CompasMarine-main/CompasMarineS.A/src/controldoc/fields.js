const normalizeValue = (value) => (value || '').toString().trim().toLowerCase();

const DOCUMENT_ENTITY_ID_KEYS = [
  'entity_id',
  'entityId',
  'entity_external_id',
  'entityExternalId',
  'entidad_external_id',
  'entidadExternalId',
  'abstract_entity_id',
  'abstractEntityId',
  'abstract_entity_external_id',
  'abstractEntityExternalId',
  'owner_entity_id',
  'ownerEntityId',
  'employee_id',
  'employeeId',
  'employee_external_id',
  'employeeExternalId',
  'collaborator_id',
  'collaboratorId',
  'colaborador_id',
  'colaboradorId',
  'person_id',
  'personId'
];

const DOCUMENT_ENTITY_OBJECT_KEYS = [
  'entity',
  'abstract_entity',
  'abstractEntity',
  'entidad',
  'owner',
  'employee',
  'collaborator',
  'colaborador',
  'person',
  'worker'
];

const DOCUMENT_ENTITY_COLLECTION_KEYS = [
  'entities',
  'entity_ids',
  'entityIds',
  'abstract_entities',
  'abstractEntities',
  'employees',
  'collaborators',
  'colaboradores',
  'people',
  'workers'
];

function normalizeEntityId(value) {
  if (value === undefined || value === null || value === '') return '';

  if (typeof value === 'object') {
    for (const key of ['id', 'external_id', 'externalId', ...DOCUMENT_ENTITY_ID_KEYS]) {
      const nestedValue = value?.[key];
      if (nestedValue !== undefined && nestedValue !== null && nestedValue !== '') {
        return nestedValue.toString();
      }
    }
    return '';
  }

  return value.toString();
}

export function getDocumentEntityIds(doc) {
  if (!doc || typeof doc !== 'object') return [];

  const ids = [];
  const pushId = (value) => {
    const id = normalizeEntityId(value);
    if (id && !ids.includes(id)) ids.push(id);
  };

  DOCUMENT_ENTITY_ID_KEYS.forEach((key) => pushId(doc[key]));
  DOCUMENT_ENTITY_OBJECT_KEYS.forEach((key) => pushId(doc[key]));

  DOCUMENT_ENTITY_COLLECTION_KEYS.forEach((key) => {
    const collection = doc[key];
    if (!Array.isArray(collection)) return;
    collection.forEach(pushId);
  });

  return ids;
}

export function getDocumentEntityId(doc) {
  return getDocumentEntityIds(doc)[0] || '';
}

export function getDocumentExpirationDate(doc) {
  return (
    doc?.expires_at ??
    doc?.expiresAt ??
    doc?.expiration_date ??
    doc?.expirationDate ??
    doc?.valid_until ??
    doc?.validUntil ??
    doc?.validity_end_at ??
    doc?.fecha_vencimiento ??
    doc?.vencimiento ??
    ''
  );
}

export function isBlockedDocument(doc) {
  const state = normalizeValue(doc?.aasm_state || doc?.state || doc?.status);
  const isBlocked = state === 'blocked' || state === 'bloqueado';
  const blockedDescription = normalizeValue(doc?.blocked_description);

  return isBlocked && !blockedDescription.includes('cargo');
}

export function hasPendingSignature(doc) {
  if (!doc || typeof doc !== 'object') return false;

  const matchesPendingText = (value) => {
    const lower = normalizeValue(value);
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
      (lower.includes('signature') && lower.includes('pending')) ||
      (lower.includes('firma') && lower.includes('pendiente'))
    );
  };

  const keysToCheck = [
    'require_signers',
    'requires_signers',
    'require_signature',
    'requires_signature',
    'pending_signature',
    'signature_pending',
    'pending_signatures',
    'pending_signatures_count',
    'signature_status',
    'signature_state',
    'firmas_pendientes',
    'firmantes_pendientes',
    'aasm_state',
    'state',
    'status',
    'workflow_state'
  ];

  for (const key of keysToCheck) {
    const value = doc[key];
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    if (Array.isArray(value) && value.length > 0) return true;
    if (matchesPendingText(value)) return true;
  }

  return Object.entries(doc).some(([key, value]) => {
    if (!/pending.*sign|sign.*pending|signature.*pending|pending.*signature|firma|firmas|firmante/i.test(key)) {
      return false;
    }

    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    if (Array.isArray(value) && value.length > 0) return true;
    return matchesPendingText(value);
  });
}
