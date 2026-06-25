const SNAPSHOT_VERSION = 4;
const STORAGE_KEY = 'compas:controldoc:last-snapshot:v4';
const DB_NAME = 'compas-control-doc-cache';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const LEGACY_STORAGE_KEYS = [
  'compas:controldoc:last-snapshot:v3',
  'compas:controldoc:last-snapshot:v2',
  'compas:controldoc:last-snapshot:v1',
  'controlDocSnapshot'
];

export function saveControlDocSnapshot(data, ownerKey) {
  if (!canUseStorage() || !ownerKey) return;

  const snapshot = createSnapshot(data, ownerKey);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('No se pudo guardar la copia offline de ControlDoc:', error);
  }
}

export async function saveControlDocSnapshotAsync(data, ownerKey) {
  if (!ownerKey) return;

  const snapshot = createSnapshot(data, ownerKey);

  try {
    const db = await openSnapshotDb();
    await runSnapshotTransaction(db, 'readwrite', (store) => store.put(snapshot));
    return;
  } catch (error) {
    console.warn('No se pudo guardar la copia offline grande de ControlDoc:', error);
  }

  saveControlDocSnapshot(data, ownerKey);
}

export function readControlDocSnapshot(ownerKey) {
  if (!canUseStorage() || !ownerKey) return null;

  clearLegacyControlDocSnapshots();

  const rawSnapshot = window.localStorage.getItem(STORAGE_KEY);
  if (!rawSnapshot) return null;

  try {
    const snapshot = JSON.parse(rawSnapshot);
    return isValidSnapshot(snapshot, ownerKey) ? snapshot : null;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function readControlDocSnapshotAsync(ownerKey) {
  if (!ownerKey) return null;

  try {
    const db = await openSnapshotDb();
    const snapshot = await runSnapshotTransaction(db, 'readonly', (store) => store.get(ownerKey));
    if (isValidSnapshot(snapshot, ownerKey)) return snapshot;
  } catch (error) {
    console.warn('No se pudo leer la copia offline grande de ControlDoc:', error);
  }

  return readControlDocSnapshot(ownerKey);
}

export function isControlDocSnapshotFresh(snapshot, maxAgeMs, options = {}) {
  if (!snapshot?.savedAt || !Number.isFinite(maxAgeMs)) return false;
  if (options.requireComplete && snapshot?.meta?.documents?.complete === false) return false;
  const savedAtMs = new Date(snapshot.savedAt).getTime();
  if (!Number.isFinite(savedAtMs)) return false;
  return Date.now() - savedAtMs < maxAgeMs;
}

function createSnapshot(data, ownerKey) {
  return {
    ownerKey,
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    meta: data.meta || {},
    data: {
      documents: data.documents.map(sanitizeDocument),
      entities: data.entities,
      documentTypes: data.documentTypes
    }
  };
}

function isValidSnapshot(snapshot, ownerKey) {
  return (
    snapshot?.ownerKey === ownerKey &&
    snapshot?.version === SNAPSHOT_VERSION &&
    Array.isArray(snapshot?.data?.documents) &&
    Array.isArray(snapshot?.data?.entities) &&
    Array.isArray(snapshot?.data?.documentTypes)
  );
}

function clearLegacyControlDocSnapshots() {
  LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
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

function canUseIndexedDb() {
  return typeof window !== 'undefined' && Boolean(window.indexedDB);
}

function openSnapshotDb() {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error('IndexedDB no disponible'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'ownerKey' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runSnapshotTransaction(db, mode, getRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE, mode);
    const store = transaction.objectStore(SNAPSHOT_STORE);
    const request = getRequest(store);
    let result;

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  });
}
