const STORAGE_KEY = 'compas:controldoc:last-snapshot:v1';

export function saveControlDocSnapshot(data) {
  if (!canUseStorage()) return;

  const snapshot = {
    savedAt: new Date().toISOString(),
    data: {
      documents: data.documents.map(sanitizeDocument),
      entities: data.entities,
      documentTypes: data.documentTypes
    }
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function readControlDocSnapshot() {
  if (!canUseStorage()) return null;

  const rawSnapshot = window.localStorage.getItem(STORAGE_KEY);
  if (!rawSnapshot) return null;

  try {
    const snapshot = JSON.parse(rawSnapshot);
    if (!snapshot?.data?.documents || !snapshot?.data?.entities || !snapshot?.data?.documentTypes) {
      return null;
    }

    return snapshot;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function sanitizeDocument(document) {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => !isPrivateUrlKey(key))
  );
}

function isPrivateUrlKey(key) {
  const normalizedKey = key.toLowerCase();
  return normalizedKey.includes('download') || normalizedKey === 'url' || normalizedKey.endsWith('_url');
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}
