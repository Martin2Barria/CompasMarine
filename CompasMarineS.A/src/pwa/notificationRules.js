import { readControlDocSnapshot, readControlDocSnapshotAsync } from '../storage/controlDocOffline';
import { getApiUrl } from '../config/api';
import { getDocumentExpirationDate, getDocumentStatusText, hasPendingSignature, parseControlDocDate } from '../controldoc/fields';
import { showAppNotification } from './pushNotifications';

const SENT_EVENTS_KEY = 'compas:notifications:sent-events:v2';
const LAST_PROGRESS_BUCKET_KEY = 'compas:notifications:last-progress-bucket:v1';
const ALERT_RECORDS_KEY = 'compas:notifications:alert-records:v2';
const ALERT_RULE_VERSION = 4;
const MAX_STORED_EVENTS = 800;
const MAX_STORED_ALERTS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCachedNotificationRules(ownerKey) {
  const snapshotData = await readCurrentSnapshotData(ownerKey);
  if (!snapshotData) {
    return {
      checked: false,
      shown: 0,
      records: [],
      reason: 'No hay datos offline para revisar.'
    };
  }

  return evaluateDocumentNotificationRules({
    documents: snapshotData.documents || [],
    documentTypes: snapshotData.documentTypes || [],
    percentage: calculateHealthyPercentage(snapshotData.documents || []),
    ownerKey
  });
}

export async function getCachedNotificationRecords(ownerKey) {
  const snapshotData = await readCurrentSnapshotData(ownerKey);
  const existingRecords = readAlertRecords(ownerKey);

  if (!snapshotData) return existingRecords;

  const records = buildDocumentAlertRecords({
    documents: snapshotData.documents || [],
    documentTypes: snapshotData.documentTypes || []
  });

  return mergeAlertRecords(ownerKey, records);
}

export async function evaluateDocumentNotificationRules({
  documents = [],
  documentTypes = [],
  percentage = null,
  ownerKey = null
}) {
  const records = buildDocumentAlertRecords({ documents, documentTypes });
  mergeAlertRecords(ownerKey, records);

  if (!canNotify()) {
    return {
      checked: true,
      shown: 0,
      records,
      reason: 'Las notificaciones no estan activadas.'
    };
  }

  const sentEvents = readSentEvents();
  const now = Date.now();
  const expiredDocs = records.filter((record) => record.group === 'expired' && shouldNotifyRecord(record, sentEvents, now));
  const criticalDocs = records.filter((record) => record.group === 'critical' && shouldNotifyRecord(record, sentEvents, now));
  const warningDocs = records.filter((record) => record.group === 'warning' && shouldNotifyRecord(record, sentEvents, now));
  const signatureDocs = records.filter((record) => record.group === 'signature' && shouldNotifyRecord(record, sentEvents, now));

  let shown = 0;

  if (await notifyRecordGroup({
    records: expiredDocs,
    title: expiredDocs.length === 1 ? 'Documento vencido' : 'Documentos vencidos',
    group: 'expired',
    tag: 'compas-docs-expired'
  })) {
    markEventsAsSent(expiredDocs.map((item) => item.id));
    shown += 1;
  }

  if (await notifyRecordGroup({
    records: criticalDocs,
    title: criticalDocs.length === 1 ? 'Documento critico' : 'Documentos criticos',
    group: 'critical',
    tag: 'compas-docs-expiring-30'
  })) {
    markEventsAsSent(criticalDocs.map((item) => item.id));
    shown += 1;
  }

  if (await notifyRecordGroup({
    records: warningDocs,
    title: warningDocs.length === 1 ? 'Documento por vencer' : 'Documentos por vencer',
    group: 'warning',
    tag: 'compas-docs-expiring-60'
  })) {
    markEventsAsSent(warningDocs.map((item) => item.id));
    shown += 1;
  }

  if (await notifyRecordGroup({
    records: signatureDocs,
    title: signatureDocs.length === 1 ? 'Firma pendiente' : 'Firmas pendientes',
    group: 'signature',
    tag: 'compas-docs-signatures'
  })) {
    markEventsAsSent(signatureDocs.map((item) => item.id));
    shown += 1;
  }

  if (await notifyProgressDrop(percentage)) {
    shown += 1;
  }

  return {
    checked: true,
    shown,
    records
  };
}

export function buildDocumentAlertRecords({ documents = [], documentTypes = [] }) {
  return documents
    .flatMap((doc) => {
      const records = [];
      const docName = getDocName(doc, documentTypes);
      if (isInvalidNotificationDocName(docName)) return records;

      const expirationDate = getDocumentExpirationDate(doc);
      const daysRemaining = getDaysRemaining(expirationDate);

      if (daysRemaining !== null && daysRemaining <= 60) {
        const threshold = daysRemaining < 0
          ? 0
          : daysRemaining <= 30
            ? 30
            : 60;

        const id = buildDocumentEventId(doc, threshold);
        const severity = threshold === 0 ? 'expired' : threshold === 30 ? 'critical' : 'warning';
        const group = threshold === 0 ? 'expired' : threshold === 30 ? 'critical' : 'warning';
        const title = threshold === 0 ? 'Documento vencido' : threshold === 30 ? 'Documento critico' : 'Documento por vencer';
        const body = threshold === 0
          ? `${docName} se vencio.`
          : `${docName} esta por vencer.`;

        records.push({
          id,
          ruleVersion: ALERT_RULE_VERSION,
          type: 'document',
          severity,
          group,
          threshold,
          title,
          body,
          docName,
          documentId: doc.id || doc.uuid || '',
          daysRemaining,
          expirationDate: expirationDate || '',
          url: '/documentos',
          createdAt: new Date().toISOString()
        });
      }

      if (hasPendingSignature(doc)) {
        records.push({
          id: buildSignatureEventId(doc),
          ruleVersion: ALERT_RULE_VERSION,
          type: 'signature',
          severity: 'signature',
          group: 'signature',
          threshold: null,
          title: 'Firma pendiente',
          body: `${docName} tiene una firma pendiente.`,
          docName,
          documentId: doc.id || doc.uuid || '',
          daysRemaining: null,
          expirationDate: expirationDate || '',
          url: '/documentos',
          createdAt: new Date().toISOString()
        });
      }

      return records;
    })
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.daysRemaining ?? -9999) - (b.daysRemaining ?? -9999));
}

async function notifyRecordGroup({ records, title, group, tag }) {
  if (records.length === 0) return false;

  const body = records.length === 1
    ? records[0].body
    : getGroupedNotificationBody(records.length, group);

  return showAppNotification({
    title,
    body,
    url: '/documentos',
    tag
  });
}

function getGroupedNotificationBody(count, group) {
  if (group === 'expired') return `${count} documentos estan vencidos. Revisa tus documentos.`;
  if (group === 'signature') return `${count} documentos tienen firmas pendientes. Revisa tus documentos.`;
  return `${count} documentos estan por vencer. Revisa tus documentos.`;
}

async function notifyProgressDrop(percentage) {
  if (!Number.isFinite(percentage)) return false;

  const currentBucket = Math.max(0, Math.min(100, Math.floor(percentage / 10) * 10));
  const previousBucket = readStoredNumber(LAST_PROGRESS_BUCKET_KEY);

  window.localStorage.setItem(LAST_PROGRESS_BUCKET_KEY, String(currentBucket));

  if (!Number.isFinite(previousBucket) || currentBucket >= previousBucket) {
    return false;
  }

  return showAppNotification({
    title: 'Avance documental bajo',
    body: `Tu avance bajo a ${currentBucket}%. Revisa tus documentos pendientes.`,
    url: '/',
    tag: `compas-progress-${currentBucket}`
  });
}

function calculateHealthyPercentage(documents) {
  if (documents.length === 0) return 100;

  const healthyDocs = documents.filter((doc) => {
    const days = getDaysRemaining(getDocumentExpirationDate(doc));
    const status = getDocumentStatusText(doc);
    if (days === null && !status) return false;
    return days === null || days > 30;
  }).length;

  return Math.round((healthyDocs / documents.length) * 100);
}

function getDaysRemaining(dateString) {
  if (!dateString) return null;

  const expirationDate = parseControlDocDate(dateString);
  if (!expirationDate) return null;

  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();

  return Math.ceil(diff / (1000 * 3600 * 24));
}

function getDocName(doc, documentTypes) {
  const type = documentTypes.find((item) => (
    item.id?.toString() === doc.document_type_id?.toString()
  ));
  const typeName = type?.name || type?.label || '';
  const docLabel = doc.label || doc.name || '';
  const combinedName = `${typeName} ${docLabel}`.trim();

  return combinedName || 'Documento sin nombre';
}

function buildDocumentEventId(doc, threshold) {
  const docId = doc.id || doc.uuid || [
    doc.entity_id,
    doc.document_type_id,
    doc.label || doc.name || 'documento'
  ].join('-');

  return `document:${threshold}:${docId}:${getDocumentExpirationDate(doc) || 'sin-fecha'}`;
}

function buildSignatureEventId(doc) {
  const docId = doc.id || doc.uuid || [
    doc.entity_id,
    doc.document_type_id,
    doc.label || doc.name || 'documento'
  ].join('-');

  return `signature:${docId}`;
}

function canNotify() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted' &&
    Boolean(window.localStorage)
  );
}

function readSentEvents() {
  try {
    return JSON.parse(window.localStorage.getItem(SENT_EVENTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function shouldNotifyRecord(record, sentEvents, now) {
  const previous = sentEvents[record.id];
  if (!previous) return true;
  if (record.group === 'expired') return false;

  const cooldownMs = getRecordCooldownMs(record);
  if (!Number.isFinite(cooldownMs)) return false;

  const previousDate = typeof previous === 'string'
    ? previous
    : previous.lastSentAt || previous.sentAt || '';
  const lastSentAt = Date.parse(previousDate);

  if (!Number.isFinite(lastSentAt)) return true;
  return now - lastSentAt >= cooldownMs;
}

function getRecordCooldownMs(record) {
  if (record.group === 'critical') return DAY_MS;
  if (record.group === 'warning') return 5 * DAY_MS;
  if (record.group === 'signature') return 7 * DAY_MS;
  return null;
}

function markEventsAsSent(eventIds) {
  if (eventIds.length === 0) return;

  const sentEvents = readSentEvents();
  const sentAt = new Date().toISOString();

  eventIds.forEach((eventId) => {
    sentEvents[eventId] = sentAt;
  });

  const prunedEvents = Object.fromEntries(
    Object.entries(sentEvents)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, MAX_STORED_EVENTS)
  );

  window.localStorage.setItem(SENT_EVENTS_KEY, JSON.stringify(prunedEvents));
}

function mergeAlertRecords(ownerKey, records) {
  const key = getAlertRecordsKey(ownerKey);
  const previousRecords = readAlertRecords(ownerKey);
  const mergedById = new Map();

  [...records, ...previousRecords].forEach((record) => {
    if (!record?.id || mergedById.has(record.id)) return;
    const normalizedRecord = normalizeStoredAlertRecord(record);
    if (!normalizedRecord) return;
    mergedById.set(normalizedRecord.id, normalizedRecord);
  });

  const mergedRecords = [...mergedById.values()]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_STORED_ALERTS);

  try {
    window.localStorage.setItem(key, JSON.stringify(mergedRecords));
  } catch {
    return mergedRecords;
  }

  return mergedRecords;
}

function readAlertRecords(ownerKey) {
  try {
    const records = JSON.parse(window.localStorage.getItem(getAlertRecordsKey(ownerKey)) || '[]');
    return Array.isArray(records) ? records.map(normalizeStoredAlertRecord).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getAlertRecordsKey(ownerKey) {
  return ownerKey ? `${ALERT_RECORDS_KEY}:${ownerKey}` : ALERT_RECORDS_KEY;
}

function severityRank(severity) {
  if (severity === 'expired') return 0;
  if (severity === 'critical') return 1;
  if (severity === 'warning') return 2;
  if (severity === 'signature') return 3;
  return 4;
}

function readStoredNumber(key) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : null;
}

async function readSnapshotData(ownerKey) {
  if (!ownerKey) return null;

  const snapshot = await readControlDocSnapshotAsync(ownerKey) || readControlDocSnapshot(ownerKey);
  if (snapshot?.data) return normalizeSnapshotData(snapshot.data);

  return readLegacySnapshotData(ownerKey);
}

async function readCurrentSnapshotData(ownerKey) {
  if (!ownerKey) return null;

  const liveData = await readLiveSnapshotData();
  if (liveData) return liveData;

  return readSnapshotData(ownerKey);
}

async function readLiveSnapshotData() {
  try {
    const requestOptions = {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    const [documents, documentTypes] = await Promise.all([
      fetchJsonNoStore(getApiUrl('/controldoc/documents'), requestOptions),
      fetchJsonNoStore(getApiUrl('/controldoc/document-types'), requestOptions)
    ]);

    return normalizeSnapshotData({ documents, documentTypes });
  } catch {
    return null;
  }
}

async function fetchJsonNoStore(url, requestOptions) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}_t=${Date.now()}`, requestOptions);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function readLegacySnapshotData(ownerKey) {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  const legacyOwnerKey = ownerKey.replace(':', '_');
  const candidates = [
    `controlDocSnapshot_${legacyOwnerKey}`,
    `controlDocSnapshot_${ownerKey}`
  ];

  for (const key of candidates) {
    try {
      const snapshot = JSON.parse(window.localStorage.getItem(key) || 'null');
      const data = normalizeSnapshotData(snapshot);
      if (data) return data;
    } catch {
      // Probar la siguiente llave disponible.
    }
  }

  return null;
}

function normalizeSnapshotData(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const documentTypes = Array.isArray(snapshot.documentTypes)
    ? snapshot.documentTypes
    : Array.isArray(snapshot.document_types)
      ? snapshot.document_types
      : [];

  return { documents, documentTypes };
}

function normalizeStoredAlertRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.ruleVersion !== ALERT_RULE_VERSION) return null;

  const docName = (record.docName || '').toString().trim();
  const body = (record.body || '').toString().trim();
  const lowerText = `${docName} ${body}`.toLowerCase();
  const daysRemaining = Number(record.daysRemaining);
  const threshold = Number(record.threshold);

  if (!docName || lowerText.includes('no hay contenido')) return null;
  if (isInvalidNotificationDocName(docName)) return null;
  if (record.type === 'signature') return record;
  if (threshold === 0 && (!Number.isFinite(daysRemaining) || daysRemaining >= 0)) return null;

  if (body.includes('bloqueado')) {
    return {
      ...record,
      body: body.replace(/\s+o bloqueado/gi, '').replace(/\s+bloqueado/gi, '').trim()
    };
  }

  return record;
}

function isInvalidNotificationDocName(docName) {
  const normalizedName = (docName || '').toString().trim().toLowerCase();
  return !normalizedName || normalizedName.includes('no hay contenido');
}
