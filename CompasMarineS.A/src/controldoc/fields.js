const normalizeValue = (value) => (value || '').toString().trim().toLowerCase();
const DAY_MS = 24 * 60 * 60 * 1000;
const normalizeFieldKey = (value) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

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
  'personId',
  'worker_id',
  'workerId',
  'trabajador_id',
  'trabajadorId'
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
  'workers',
  'trabajadores'
];

const DOCUMENT_EXPIRATION_DATE_KEYS = [
  'expires_at',
  'expiresAt',
  'expires_on',
  'expiresOn',
  'expiration_date',
  'expirationDate',
  'expiration',
  'valid_until',
  'validUntil',
  'valid_to',
  'validTo',
  'validity_end_at',
  'validityEndAt',
  'due_date',
  'dueDate',
  'deadline',
  'fecha_vencimiento',
  'fecha vencimiento',
  'fecha_de_vencimiento',
  'fecha_expiracion',
  'fecha expiracion',
  'fecha_expiración',
  'fecha expiración',
  'fecha_caducidad',
  'fecha caducidad',
  'vencimiento',
  'vigencia_hasta',
  'vigencia hasta'
];

const DOCUMENT_ISSUE_DATE_KEYS = [
  'issued_at',
  'issuedAt',
  'issued_on',
  'issuedOn',
  'issue_date',
  'issueDate',
  'date_of_issue',
  'dateOfIssue',
  'emission_date',
  'emissionDate',
  'fecha_emision',
  'fecha emisión',
  'fecha_de_emision',
  'fecha de emisión',
  'fecha_expedicion',
  'fecha expedición',
  'fecha_de_expedicion',
  'fecha de expedición'
];

const DOCUMENT_REGISTRATION_DATE_KEYS = [
  'created_at',
  'createdAt',
  'created_on',
  'createdOn'
];

const DOCUMENT_STATUS_KEYS = [
  'aasm_state',
  'aasmState',
  'state',
  'status',
  'document_state',
  'documentState',
  'document_status',
  'documentStatus',
  'estado'
];

const NESTED_FIELD_SOURCES = [
  'custom_fields',
  'customFields',
  'fields',
  'attributes',
  'metadata',
  'meta',
  'data',
  'details',
  'properties'
];

function normalizeEntityId(value) {
  if (value === undefined || value === null || value === '') return '';

  if (typeof value === 'object') {
    for (const key of ['id', 'external_id', 'externalId', 'value', ...DOCUMENT_ENTITY_ID_KEYS]) {
      const nestedValue = value?.[key];
      if (nestedValue !== undefined && nestedValue !== null && nestedValue !== '') {
        return nestedValue.toString();
      }
    }
    return '';
  }

  return value.toString();
}

function getNestedFieldValue(record, candidateKeys) {
  if (!record || typeof record !== 'object') return '';

  const normalizedCandidates = candidateKeys.map(normalizeFieldKey);
  const readFromObject = (source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return '';

    for (const key of candidateKeys) {
      const value = source[key];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') return value;
    }

    for (const [rawKey, value] of Object.entries(source)) {
      if (!normalizedCandidates.includes(normalizeFieldKey(rawKey))) continue;
      if (value !== undefined && value !== null && `${value}`.trim() !== '') return value;
    }

    return '';
  };

  const directValue = readFromObject(record);
  if (directValue) return directValue;

  for (const sourceKey of NESTED_FIELD_SOURCES) {
    const source = record[sourceKey];
    if (!source) continue;

    if (Array.isArray(source)) {
      for (const item of source) {
        const rawKey = item?.key || item?.name || item?.label || item?.field || item?.slug;
        if (!normalizedCandidates.includes(normalizeFieldKey(rawKey))) continue;
        const value = item?.value ?? item?.content ?? item?.text ?? item?.data ?? item?.date;
        if (value !== undefined && value !== null && `${value}`.trim() !== '') return value;
      }
      continue;
    }

    const nestedValue = readFromObject(source);
    if (nestedValue) return nestedValue;
  }

  return '';
}

export function getDocumentEntityIds(doc) {
  if (!doc || typeof doc !== 'object') return [];

  const ids = [];
  const pushId = (value) => {
    const id = normalizeEntityId(value);
    if (id && !ids.includes(id)) ids.push(id);
  };

  DOCUMENT_ENTITY_ID_KEYS.forEach((key) => pushId(getNestedFieldValue(doc, [key])));
  DOCUMENT_ENTITY_OBJECT_KEYS.forEach((key) => pushId(getNestedFieldValue(doc, [key])));

  DOCUMENT_ENTITY_COLLECTION_KEYS.forEach((key) => {
    const collection = getNestedFieldValue(doc, [key]);
    if (!Array.isArray(collection)) return;
    collection.forEach(pushId);
  });

  return ids;
}

export function getDocumentEntityId(doc) {
  return getDocumentEntityIds(doc)[0] || '';
}

export function getDocumentExpirationDate(doc) {
  return getNestedFieldValue(doc, DOCUMENT_EXPIRATION_DATE_KEYS);
}

export function getDocumentIssueDate(doc) {
  return getNestedFieldValue(doc, DOCUMENT_ISSUE_DATE_KEYS);
}

export function getDocumentRegistrationDate(doc) {
  return getNestedFieldValue(doc, DOCUMENT_REGISTRATION_DATE_KEYS);
}

export function getDocumentStatusText(doc) {
  return normalizeValue(getNestedFieldValue(doc, DOCUMENT_STATUS_KEYS));
}

export function hasExpiredDocumentStatus(doc) {
  const status = getDocumentStatusText(doc);
  return (
    status === 'expired' ||
    status === 'vencido' ||
    status === 'caducado' ||
    status.includes('expired') ||
    status.includes('vencid') ||
    status.includes('caduc')
  );
}

export function hasBlockedDocumentStatus(doc) {
  const status = getDocumentStatusText(doc);
  return (
    status === 'blocked' ||
    status === 'bloqueado' ||
    status.includes('blocked') ||
    status.includes('bloquead')
  );
}

export function hasNonCompliantDocumentStatus(doc) {
  const status = getDocumentStatusText(doc);
  return (
    hasExpiredDocumentStatus(doc) ||
    hasBlockedDocumentStatus(doc) ||
    status === 'pending' ||
    status === 'pendiente' ||
    status === 'rejected' ||
    status === 'rechazado' ||
    status === 'refused' ||
    status === 'denied' ||
    status === 'observed' ||
    status === 'observado' ||
    status === 'draft' ||
    status.includes('pending') ||
    status.includes('pendient') ||
    status.includes('rechaz') ||
    status.includes('reject') ||
    status.includes('observ') ||
    status.includes('denied') ||
    status.includes('refused')
  );
}

export function parseControlDocDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const rawValue = value.toString().trim();
  if (!rawValue) return null;

  const localDate = rawValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s|$)/);
  if (localDate) {
    const [, day, month, rawYear] = localDate;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return buildCalendarDate(Number(year), Number(month), Number(day));
  }

  const isoDate = rawValue.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s|T|$)/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return buildCalendarDate(Number(year), Number(month), Number(day));
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getCalendarDaysRemaining(value, now = new Date()) {
  const expirationDate = parseControlDocDate(value);
  const currentDate = now instanceof Date ? now : new Date(now);

  if (!expirationDate || Number.isNaN(currentDate.getTime())) return null;

  const expirationDay = Date.UTC(
    expirationDate.getFullYear(),
    expirationDate.getMonth(),
    expirationDate.getDate()
  );
  const currentDay = Date.UTC(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate()
  );

  return Math.round((expirationDay - currentDay) / DAY_MS);
}

function buildCalendarDate(year, month, day) {
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function isBlockedDocument(doc) {
  return hasBlockedDocumentStatus(doc);
}

export function compareExpirationUrgency(a, b) {
  const rawDaysA = a?.daysRemaining;
  const rawDaysB = b?.daysRemaining;
  const daysA = rawDaysA === null || rawDaysA === undefined || rawDaysA === '' ? Number.NaN : Number(rawDaysA);
  const daysB = rawDaysB === null || rawDaysB === undefined || rawDaysB === '' ? Number.NaN : Number(rawDaysB);
  const safeDaysA = Number.isFinite(daysA) ? daysA : Number.MAX_SAFE_INTEGER;
  const safeDaysB = Number.isFinite(daysB) ? daysB : Number.MAX_SAFE_INTEGER;

  return (safeDaysA - safeDaysB)
    || String(a?.displayName || a?.name || '').localeCompare(
      String(b?.displayName || b?.name || ''),
      'es'
    );
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
