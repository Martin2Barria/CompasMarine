import { getDocumentEntityIds } from './fields.js';

export const ALL_COMPANIES_KEY = 'all';

export const CONTROL_DOC_COMPANIES = Object.freeze({
  467: 'Compas Marine Servicios Acuícolas SpA',
  468: 'Compas Marine Trabajos Marítimos S.A.',
  469: 'Compas Marine Servicios Acuícolas SA'
});

const PRIMARY_SOURCE_ID_KEYS = [
  'control_doc_source_entity_type_id',
  'controlDocSourceEntityTypeId'
];

const ENTITY_TYPE_ID_KEYS = [
  'entity_type_id',
  'entityTypeId',
  'source_entity_type_id',
  'sourceEntityTypeId',
  'abstract_entity_type_id',
  'abstractEntityTypeId',
  'control_doc_entity_type_id',
  'controlDocEntityTypeId'
];

const COMPANY_FIELD_KEYS = [
  'empresa',
  'company',
  'organization',
  'razon_social',
  'razonSocial',
  'sociedad',
  'employer'
];

const FIELD_DESCRIPTOR_KEYS = ['key', 'name', 'label', 'field', 'slug'];
const FIELD_DESCRIPTOR_VALUE_KEYS = ['value', 'content', 'text', 'data'];
const COMPANY_OBJECT_NAME_KEYS = [
  'name',
  'nombre',
  'razon_social',
  'razonSocial',
  'legal_name',
  'legalName',
  'company_name',
  'companyName',
  'organization_name',
  'organizationName',
  'label',
  'title',
  'text',
  'value'
];

const normalizeFieldKey = (value) =>
  (value ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeCompanyName = (value) =>
  (value ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const CONTROL_DOC_COMPANY_SOURCE_BY_NAME = new Map(
  Object.entries(CONTROL_DOC_COMPANIES).map(([sourceId, companyName]) => [
    normalizeCompanyName(companyName),
    sourceId
  ])
);

const normalizeText = (value) => {
  if (value === undefined || value === null || typeof value === 'boolean') return '';
  if (typeof value === 'object') return '';
  return value.toString().trim();
};

const getDescriptorFieldName = (record) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return '';

  for (const key of FIELD_DESCRIPTOR_KEYS) {
    const value = normalizeText(record[key]);
    if (value) return value;
  }
  return '';
};

const getDescriptorFieldValue = (record) => {
  for (const key of FIELD_DESCRIPTOR_VALUE_KEYS) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
};

function findNestedFieldValue(record, preferredKeys, matchesKey, convertValue) {
  if (!record || typeof record !== 'object') return '';

  const preferredNormalizedKeys = preferredKeys.map(normalizeFieldKey);
  const queue = [record];
  const visited = new WeakSet();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    if (!Array.isArray(current)) {
      const descriptorName = normalizeFieldKey(getDescriptorFieldName(current));
      if (descriptorName && matchesKey(descriptorName)) {
        const converted = convertValue(getDescriptorFieldValue(current));
        if (converted) return converted;
      }

      const entries = Object.entries(current);
      for (const preferredKey of preferredNormalizedKeys) {
        for (const [rawKey, rawValue] of entries) {
          if (normalizeFieldKey(rawKey) !== preferredKey) continue;
          const converted = convertValue(rawValue);
          if (converted) return converted;
        }
      }

      for (const [rawKey, rawValue] of entries) {
        const normalizedKey = normalizeFieldKey(rawKey);
        if (preferredNormalizedKeys.includes(normalizedKey) || !matchesKey(normalizedKey)) continue;
        const converted = convertValue(rawValue);
        if (converted) return converted;
      }
    }

    const nestedValues = Array.isArray(current) ? current : Object.values(current);
    nestedValues.forEach((value) => {
      if (value && typeof value === 'object') queue.push(value);
    });
  }

  return '';
}

function toSourceId(value) {
  const directValue = normalizeText(value);
  if (directValue) return directValue;
  if (!value || typeof value !== 'object') return '';

  for (const key of ['id', 'value', ...PRIMARY_SOURCE_ID_KEYS, ...ENTITY_TYPE_ID_KEYS]) {
    const nestedValue = normalizeText(value[key]);
    if (nestedValue) return nestedValue;
  }
  return '';
}

function toCompanyName(value) {
  const directValue = normalizeText(value);
  if (directValue) return directValue;
  if (!value || typeof value !== 'object') return '';

  const queue = [value];
  const visited = new WeakSet();
  const companyKeys = new Set(COMPANY_FIELD_KEYS.map(normalizeFieldKey));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    if (!Array.isArray(current)) {
      const descriptorName = normalizeFieldKey(getDescriptorFieldName(current));
      if (companyKeys.has(descriptorName)) {
        const descriptorValue = toCompanyName(getDescriptorFieldValue(current));
        if (descriptorValue) return descriptorValue;
      }

      for (const key of COMPANY_OBJECT_NAME_KEYS) {
        const candidate = current[key];
        const candidateText = normalizeText(candidate);
        if (candidateText) return candidateText;
      }
    }

    const nestedValues = Array.isArray(current) ? current : Object.values(current);
    nestedValues.forEach((nestedValue) => {
      if (nestedValue && typeof nestedValue === 'object') queue.push(nestedValue);
    });
  }

  return '';
}

export function getControlDocSourceId(record) {
  const primaryKeys = new Set(PRIMARY_SOURCE_ID_KEYS.map(normalizeFieldKey));
  const primaryId = findNestedFieldValue(
    record,
    PRIMARY_SOURCE_ID_KEYS,
    (key) => primaryKeys.has(key),
    toSourceId
  );
  if (primaryId) return primaryId;

  const entityTypeKeys = new Set(ENTITY_TYPE_ID_KEYS.map(normalizeFieldKey));
  return findNestedFieldValue(
    record,
    ENTITY_TYPE_ID_KEYS,
    (key) => entityTypeKeys.has(key) || key.endsWith('entitytypeid'),
    toSourceId
  );
}

export function getEntityCompanyName(entity) {
  const companyKeys = new Set(COMPANY_FIELD_KEYS.map(normalizeFieldKey));
  return findNestedFieldValue(
    entity,
    COMPANY_FIELD_KEYS,
    (key) => companyKeys.has(key),
    toCompanyName
  );
}

export function getCompanyKey(record) {
  const sourceId = getControlDocSourceId(record);
  if (sourceId) return `source:${sourceId}`;

  const normalizedName = normalizeCompanyName(getEntityCompanyName(record));
  const knownSourceId = CONTROL_DOC_COMPANY_SOURCE_BY_NAME.get(normalizedName);
  if (knownSourceId) return `source:${knownSourceId}`;
  return normalizedName ? `name:${normalizedName}` : '';
}

const createNameCounter = () => new Map();

const addCompanyName = (counter, companyName, sequence) => {
  const label = normalizeText(companyName).replace(/\s+/g, ' ');
  const normalizedName = normalizeCompanyName(label);
  if (!normalizedName) return;

  const current = counter.get(normalizedName);
  if (current) {
    current.count += 1;
    return;
  }
  counter.set(normalizedName, { label, count: 1, sequence });
};

const getMostFrequentName = (counter) => {
  let selected = null;
  for (const candidate of counter.values()) {
    if (
      !selected ||
      candidate.count > selected.count ||
      (candidate.count === selected.count && candidate.sequence < selected.sequence)
    ) {
      selected = candidate;
    }
  }
  return selected?.label || '';
};

const compareSourceIds = (left, right) => {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);
  if (leftIsNumeric && rightIsNumeric) return Number(left) - Number(right);
  if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1;
  return left.localeCompare(right, 'es', { numeric: true, sensitivity: 'base' });
};

export function buildCompanyOptions(entities) {
  const groups = new Map();
  const catalogSourceIds = Object.keys(CONTROL_DOC_COMPANIES);

  catalogSourceIds.forEach((sourceId, catalogIndex) => {
    groups.set(`source:${sourceId}`, {
      key: `source:${sourceId}`,
      sourceId,
      defaultLabel: CONTROL_DOC_COMPANIES[sourceId],
      names: createNameCounter(),
      catalogIndex
    });
  });

  let sequence = 0;
  for (const entity of Array.isArray(entities) ? entities : []) {
    const key = getCompanyKey(entity);
    if (!key) continue;

    const sourceId = getControlDocSourceId(entity);
    const companyName = getEntityCompanyName(entity);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sourceId,
        defaultLabel: sourceId ? `Empresa ${sourceId}` : companyName,
        names: createNameCounter(),
        catalogIndex: null
      });
    }
    addCompanyName(groups.get(key).names, companyName, sequence);
    sequence += 1;
  }

  const groupedOptions = [...groups.values()]
    .sort((left, right) => {
      const leftIsCatalog = left.catalogIndex !== null;
      const rightIsCatalog = right.catalogIndex !== null;
      if (leftIsCatalog && rightIsCatalog) return left.catalogIndex - right.catalogIndex;
      if (leftIsCatalog !== rightIsCatalog) return leftIsCatalog ? -1 : 1;
      if (left.sourceId && right.sourceId) return compareSourceIds(left.sourceId, right.sourceId);
      if (left.sourceId !== right.sourceId) return left.sourceId ? -1 : 1;
      return left.defaultLabel.localeCompare(right.defaultLabel, 'es', { numeric: true, sensitivity: 'base' });
    })
    .map((group) => ({
      key: group.key,
      label: getMostFrequentName(group.names) || group.defaultLabel,
      sourceId: group.sourceId || ''
    }));

  return [
    { key: ALL_COMPANIES_KEY, label: 'Todos', sourceId: '' },
    ...groupedOptions
  ];
}

const toEntityId = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    for (const key of ['id', 'external_id', 'externalId', 'value']) {
      const nestedId = toEntityId(value[key]);
      if (nestedId) return nestedId;
    }
    return '';
  }
  return value.toString();
};

const getEntityIdentityIds = (entity) => {
  const ids = new Set(getDocumentEntityIds(entity));
  for (const key of ['id', 'external_id', 'externalId']) {
    const id = toEntityId(entity?.[key]);
    if (id) ids.add(id);
  }
  return ids;
};

const normalizeSelectedCompanyKey = (companyKey) => {
  const selected = normalizeText(companyKey);
  if (!selected || selected === ALL_COMPANIES_KEY || selected.startsWith('source:') || selected.startsWith('name:')) {
    return selected || ALL_COMPANIES_KEY;
  }
  if (/^\d+$/.test(selected) || Object.hasOwn(CONTROL_DOC_COMPANIES, selected)) {
    return `source:${selected}`;
  }
  const normalizedName = normalizeCompanyName(selected);
  return normalizedName ? `name:${normalizedName}` : '';
};

export function filterComplianceDataByCompany(entities, documents, companyKey) {
  const entityList = Array.isArray(entities) ? entities : [];
  const documentList = Array.isArray(documents) ? documents : [];
  const selectedKey = normalizeSelectedCompanyKey(companyKey);

  if (selectedKey === ALL_COMPANIES_KEY) {
    return { entities: entityList, documents: documentList };
  }

  const filteredEntities = entityList.filter((entity) => getCompanyKey(entity) === selectedKey);
  const selectedEntityIds = new Set();
  const companyKeysByEntityId = new Map();

  entityList.forEach((entity) => {
    const entityCompanyKey = getCompanyKey(entity) || 'sin-empresa';
    getEntityIdentityIds(entity).forEach((id) => {
      const companyKeys = companyKeysByEntityId.get(id) || new Set();
      companyKeys.add(entityCompanyKey);
      companyKeysByEntityId.set(id, companyKeys);
    });
  });

  filteredEntities.forEach((entity) => {
    getEntityIdentityIds(entity).forEach((id) => selectedEntityIds.add(id));
  });

  const filteredDocuments = documentList.filter((document) => {
    const documentCompanyKey = getCompanyKey(document);
    if (documentCompanyKey) return documentCompanyKey === selectedKey;

    return getDocumentEntityIds(document).some((id) => (
      selectedEntityIds.has(id) && (companyKeysByEntityId.get(id)?.size || 0) <= 1
    ));
  });

  return { entities: filteredEntities, documents: filteredDocuments };
}

export function buildComplianceDataByCompany(entities, documents, companyKeys = []) {
  const entityList = Array.isArray(entities) ? entities : [];
  const documentList = Array.isArray(documents) ? documents : [];
  const selectedKeys = new Set(
    companyKeys
      .map(normalizeSelectedCompanyKey)
      .filter((key) => key && key !== ALL_COMPANIES_KEY)
  );
  const dataByCompany = new Map([
    [ALL_COMPANIES_KEY, { entities: entityList, documents: documentList }]
  ]);
  const entityIdsByCompany = new Map();
  const companyKeysByEntityId = new Map();

  selectedKeys.forEach((key) => {
    dataByCompany.set(key, { entities: [], documents: [] });
    entityIdsByCompany.set(key, new Set());
  });

  entityList.forEach((entity) => {
    const companyKey = getCompanyKey(entity) || 'sin-empresa';
    const identityIds = getEntityIdentityIds(entity);

    if (selectedKeys.has(companyKey)) {
      dataByCompany.get(companyKey).entities.push(entity);
      identityIds.forEach((id) => entityIdsByCompany.get(companyKey).add(id));
    }

    identityIds.forEach((id) => {
      const keys = companyKeysByEntityId.get(id) || new Set();
      keys.add(companyKey);
      companyKeysByEntityId.set(id, keys);
    });
  });

  documentList.forEach((document) => {
    const documentCompanyKey = getCompanyKey(document);
    if (documentCompanyKey) {
      dataByCompany.get(documentCompanyKey)?.documents.push(document);
      return;
    }

    const matchingCompanyKeys = new Set();
    getDocumentEntityIds(document).forEach((id) => {
      const entityCompanyKeys = companyKeysByEntityId.get(id);
      if (entityCompanyKeys?.size !== 1) return;

      const [companyKey] = entityCompanyKeys;
      if (selectedKeys.has(companyKey) && entityIdsByCompany.get(companyKey).has(id)) {
        matchingCompanyKeys.add(companyKey);
      }
    });

    matchingCompanyKeys.forEach((companyKey) => {
      dataByCompany.get(companyKey).documents.push(document);
    });
  });

  return dataByCompany;
}
