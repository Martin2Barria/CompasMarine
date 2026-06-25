import { readControlDocSnapshot } from '../storage/controlDocOffline';
import { showAppNotification } from './pushNotifications';

const SENT_EVENTS_KEY = 'compas:notifications:sent-events:v1';
const LAST_PROGRESS_BUCKET_KEY = 'compas:notifications:last-progress-bucket:v1';
const MAX_STORED_EVENTS = 800;

export async function runCachedNotificationRules(ownerKey) {
  const snapshot = readControlDocSnapshot(ownerKey);
  if (!snapshot?.data) {
    return {
      checked: false,
      shown: 0,
      reason: 'No hay datos offline para revisar.'
    };
  }

  return evaluateDocumentNotificationRules({
    documents: snapshot.data.documents || [],
    documentTypes: snapshot.data.documentTypes || [],
    percentage: calculateHealthyPercentage(snapshot.data.documents || [])
  });
}

export async function evaluateDocumentNotificationRules({
  documents = [],
  documentTypes = [],
  percentage = null
}) {
  if (!canNotify()) {
    return {
      checked: false,
      shown: 0,
      reason: 'Las notificaciones no estan activadas.'
    };
  }

  const sentEvents = readSentEvents();
  const criticalDocs = [];
  const warningDocs = [];

  documents.forEach((doc) => {
    const daysRemaining = getDaysRemaining(doc.expires_at);
    if (daysRemaining === null || daysRemaining < 0) return;

    if (daysRemaining <= 30) {
      const eventId = buildDocumentEventId(doc, '30');
      if (!sentEvents[eventId]) {
        criticalDocs.push({ doc, daysRemaining, eventId });
      }
      return;
    }

    if (daysRemaining <= 60) {
      const eventId = buildDocumentEventId(doc, '60');
      if (!sentEvents[eventId]) {
        warningDocs.push({ doc, daysRemaining, eventId });
      }
    }
  });

  let shown = 0;

  if (await notifyDocumentGroup({
    docs: criticalDocs,
    documentTypes,
    title: criticalDocs.length === 1 ? 'Documento critico' : 'Documentos criticos',
    thresholdDays: 30,
    tag: 'compas-docs-expiring-30'
  })) {
    markEventsAsSent(criticalDocs.map((item) => item.eventId));
    shown += 1;
  }

  if (await notifyDocumentGroup({
    docs: warningDocs,
    documentTypes,
    title: warningDocs.length === 1 ? 'Documento por vencer' : 'Documentos por vencer',
    thresholdDays: 60,
    tag: 'compas-docs-expiring-60'
  })) {
    markEventsAsSent(warningDocs.map((item) => item.eventId));
    shown += 1;
  }

  if (await notifyProgressDrop(percentage)) {
    shown += 1;
  }

  return {
    checked: true,
    shown
  };
}

async function notifyDocumentGroup({ docs, documentTypes, title, thresholdDays, tag }) {
  if (docs.length === 0) return false;

  const body = docs.length === 1
    ? `${getDocName(docs[0].doc, documentTypes)} vence en ${docs[0].daysRemaining} dias.`
    : `${docs.length} documentos vencen dentro de ${thresholdDays} dias. Revisa tus documentos.`;

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
    const days = getDaysRemaining(doc.expires_at);
    return days === null || days > 30;
  }).length;

  return Math.round((healthyDocs / documents.length) * 100);
}

function getDaysRemaining(dateString) {
  if (!dateString) return null;

  const expirationDate = new Date(dateString);
  if (Number.isNaN(expirationDate.getTime())) return null;

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

  return `document:${threshold}:${docId}:${doc.expires_at || 'sin-fecha'}`;
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

function readStoredNumber(key) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : null;
}
