import { getDocumentEntityIds } from '../controldoc/fields';

export function isAdminUser(user) {
  if (!user) return false;

  if (user.rol_id !== undefined && user.rol_id !== null) {
    return [2, 10, 11, 13].includes(Number(user.rol_id));
  }

  const roleName = (user?.rol || user?.role || '').toString().trim().toLowerCase();
  return ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(roleName) || roleName.includes('admin');
}

export function getUserSnapshotKey(user) {
  if (isAdminUser(user)) return null;
  return user?.id ? `user:${user.id}` : null;
}

export function findEntityForUser(entities = [], user) {
  if (!Array.isArray(entities) || entities.length === 0) return null;
  if (isAdminUser(user)) return null;

  const userEmail = normalizeText(user?.email);
  const userName = normalizeText(user?.nombre || user?.name || user?.full_name);
  if (!userEmail && !userName) return entities.length === 1 ? entities[0] : null;

  return entities.find((entity) => entityMatchesEmail(entity, userEmail))
    || entities.find((entity) => entityMatchesName(entity, userName))
    || (entities.length === 1 ? entities[0] : null);
}

export function getScopedDocuments(documents = [], entities = [], user) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  if (isAdminUser(user)) return safeDocuments;
  if (!Array.isArray(entities) || entities.length === 0) return safeDocuments;

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

function entityMatchesName(entity, userName) {
  if (!entity || !userName) return false;

  const directValues = [
    entity.name,
    entity.full_name,
    entity.label,
    entity?.custom_fields?.nombre
  ];

  return directValues.some((value) => normalizeText(value) === userName);
}

function normalizeText(value) {
  return (value || '').toString().trim().toLowerCase();
}
