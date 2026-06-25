import { readControlDocSnapshot, readControlDocSnapshotAsync } from '../storage/controlDocOffline';
import { getDocumentExpirationDate, getDocumentStatusText, hasExpiredDocumentStatus, hasNonCompliantDocumentStatus, isBlockedDocument, parseControlDocDate } from '../controldoc/fields';
import { showAppNotification } from './pushNotifications';

const SENT_EVENTS_KEY = 'compas:notifications:sent-events:v1';
const LAST_PROGRESS_BUCKET_KEY = 'compas:notifications:last-progress-bucket:v1';
const ALERT_RECORDS_KEY = 'compas:notifications:alert-records:v1';
const MAX_STORED_EVENTS = 800;
const MAX_STORED_ALERTS = 120;

export async function runCachedNotificationRules(ownerKey) {
  const snapshot = await readControlDocSnapshotAsync(ownerKey) || readControlDocSnapshot(ownerKey);
  if (!snapshot?.data) {
    return {
      checked: false,
      shown: 0,
      records: [],
      reason: 'No hay datos offline para revisar.'
    };
  }

  return evaluateDocumentNotificationRules({
    documents: snapshot.data.documents || [],
    documentTypes: snapshot.data.documentTypes || [],
    percentage: calculateHealthyPercentage(snapshot.data.documents || []),
    ownerKey
  });
}

export async function getCachedNotificationRecords(ownerKey) {
  const snapshot = await readControlDocSnapshotAsync(ownerKey) || readControlDocSnapshot(ownerKey);
  const existingRecords = readAlertRecords(ownerKey);

  if (!snapshot?.data) return existingRecords;

  const records = buildDocumentAlertRecords({
    documents: snapshot.data.documents || [],
    documentTypes: snapshot.data.documentTypes || []
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
  const expiredDocs = records.filter((record) => record.threshold === 0 && !sentEvents[record.id]);
  const criticalDocs = records.filter((record) => record.threshold === 30 && !sentEvents[record.id]);
  const warningDocs = records.filter((record) => record.threshold === 60 && !sentEvents[record.id]);

  let shown = 0;

  if (await notifyDocumentGroup({
    records: expiredDocs,
    title: expiredDocs.length === 1 ? 'Documento vencido' : 'Documentos vencidos',
    thresholdDays: 0,
    tag: 'compas-docs-expired'
  })) {
    markEventsAsSent(expiredDocs.map((item) => item.id));
    shown += 1;
  }

  if (await notifyDocumentGroup({
    records: criticalDocs,
    title: criticalDocs.length === 1 ? 'Documento critico' : 'Documentos criticos',
    thresholdDays: 30,
    tag: 'compas-docs-expiring-30'
  })) {
    markEventsAsSent(criticalDocs.map((item) => item.id));
    shown += 1;
  }

  if (await notifyDocumentGroup({
    records: warningDocs,
    title: warningDocs.length === 1 ? 'Documento por vencer' : 'Documentos por vencer',
    thresholdDays: 60,
    tag: 'compas-docs-expiring-60'
  })) {
    markEventsAsSent(warningDocs.map((item) => item.id));
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
    .map((doc) => {
      const expirationDate = getDocumentExpirationDate(doc);
      const daysRemaining = getDaysRemaining(expirationDate);
      const expiredByStatus = hasExpiredDocumentStatus(doc);
      const blocked = isBlockedDocument(doc) || hasNonCompliantDocumentStatus(doc);
      const expired = blocked || expiredByStatus || (daysRemaining !== null && daysRemaining < 0);
      const threshold = expired
        ? 0
        : daysRemaining !== null && daysRemaining <= 30
          ? 30
          : daysRemaining !== null && daysRemaining <= 60
            ? 60
            : null;

      if (threshold === null) return null;

      const docName = getDocName(doc, documentTypes);
      const id = buildDocumentEventId(doc, threshold);
      const severity = threshold === 0 ? 'expired' : threshold === 30 ? 'critical' : 'warning';
      const title = threshold === 0 ? 'Documento vencido' : threshold === 30 ? 'Documento critico' : 'Documento por vencer';
      const body = threshold === 0
        ? `${docName} esta vencido o bloqueado.`
        : `${docName} vence en ${daysRemaining} dias.`;

      return {
        id,
        type: 'document',
        severity,
        threshold,
        title,
        body,
        docName,
        documentId: doc.id || doc.uuid || '',
        daysRemaining,
        expirationDate: expirationDate || '',
        url: '/documentos',
        createdAt: new Date().toISOString()
      };
    })
    .filter(Boolean)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.daysRemaining ?? -9999) - (b.daysRemaining ?? -9999));
}

async function notifyDocumentGroup({ records, title, thresholdDays, tag }) {
  if (records.length === 0) return false;

  const body = records.length === 1
    ? records[0].body
    : thresholdDays === 0
      ? `${records.length} documentos estan vencidos o bloqueados. Revisa tus documentos.`
      : `${records.length} documentos vencen dentro de ${thresholdDays} dias. Revisa tus documentos.`;

  return showAppNotification({
    title,
    body,
    url: '/documentos',
    tag
  });
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
    if (isBlockedDocument(doc) || hasNonCompliantDocumentStatus(doc)) return false;
    if (days === null && !status) return false;
    if (days === null && hasExpiredDocumentStatus(doc)) return false;
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
    mergedById.set(record.id, record);
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
    return JSON.parse(window.localStorage.getItem(getAlertRecordsKey(ownerKey)) || '[]');
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
  return 3;
}

function readStoredNumber(key) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : null;
}
