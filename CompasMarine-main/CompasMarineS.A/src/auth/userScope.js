import { getDocumentEntityIds } from '../controldoc/fields';

export function isAdminUser(user) {
  return (user?.rol || '').toString().trim().toLowerCase() === 'admin';
}

export function getUserSnapshotKey(user) {
  return user?.id ? `user:${user.id}` : null;
}

export function findEntityForUser(entities = [], user) {
  if (!Array.isArray(entities) || entities.length === 0) return null;
  if (isAdminUser(user)) return null;

  const userEmail = normalizeText(user?.email);
  if (!userEmail) return entities.length === 1 ? entities[0] : null;

  return entities.find((entity) => entityMatchesEmail(entity, userEmail))
    || (entities.length === 1 ? entities[0] : null);
}

export function getScopedDocuments(documents = [], entities = [], user) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  if (isAdminUser(user)) return safeDocuments;

  const entityId = findEntityForUser(entities, user)?.id?.toString();
  if (!entityId) return [];

  return safeDocuments.filter((doc) => getDocumentEntityIds(doc).includes(entityId));
}

function entityMatchesEmail(entity, userEmail) {
  if (!entity || !userEmail) return false;

  const directValues = [
    entity.email,
    entity?.custom_fields?.correo_electronico_personal,
    entity?.custom_fields?.correo_electronico_corporativo
  ];

  if (directValues.some((value) => normalizeText(value) === userEmail)) {
    return true;
  }

  try {
    return JSON.stringify(entity).toLowerCase().includes(userEmail);
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return (value || '').toString().trim().toLowerCase();
}
