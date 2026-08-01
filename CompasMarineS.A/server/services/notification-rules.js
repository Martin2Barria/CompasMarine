import {
  getDocumentExpirationDate,
  hasPendingSignature,
  parseControlDocDate
} from '../../src/controldoc/fields.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_RULE_VERSION = 1;

export const NOTIFICATION_RULES = Object.freeze({
  warning: { threshold: 60, cooldownMs: 5 * DAY_MS },
  critical: { threshold: 30, cooldownMs: DAY_MS },
  urgent: { threshold: 1, cooldownMs: 6 * 60 * 60 * 1000 }
});

const EMAIL_NOTIFICATION_ORDER = ['warning', 'critical', 'urgent'];
export const EMAIL_EXPIRATION_THRESHOLDS = Object.freeze([60, 30]);

export function buildScheduledNotificationRecords({ documents = [], documentTypes = [] }) {
  const records = [];

  for (const doc of documents) {
    const docName = getDocName(doc, documentTypes);
    if (isInvalidNotificationDocName(docName)) continue;

    const expirationDate = getDocumentExpirationDate(doc);
    const daysRemaining = getDaysRemaining(expirationDate);

    if (daysRemaining !== null && daysRemaining <= 60) {
      const threshold = daysRemaining < 0
        ? 0
        : daysRemaining <= 1
          ? 1
          : daysRemaining <= 30
            ? 30
            : 60;
      const group = threshold === 0
        ? 'expired'
        : threshold === 1
          ? 'urgent'
          : threshold === 30
            ? 'critical'
            : 'warning';

      records.push({
        id: buildDocumentEventId(doc, threshold),
        ruleVersion: NOTIFICATION_RULE_VERSION,
        group,
        once: threshold === 0,
        threshold,
        cooldownMs: NOTIFICATION_RULES[group]?.cooldownMs || null,
        docName,
        title: threshold === 0 ? 'Documento vencido' : threshold === 1 ? 'Documento por expirar' : threshold === 30 ? 'Documento crítico' : 'Documento por vencer',
        body: buildDocumentExpirationBody({ docName, threshold, daysRemaining, expirationDate }),
        daysRemaining,
        expirationDate: expirationDate || '',
        url: '/documentos'
      });
    }

    if (hasPendingSignature(doc)) {
      records.push({
        id: buildSignatureEventId(doc),
        ruleVersion: NOTIFICATION_RULE_VERSION,
        group: 'signature',
        once: false,
        cooldownMs: 7 * DAY_MS,
        docName,
        title: 'Firma pendiente',
        body: `${docName} tiene una firma pendiente.`,
        daysRemaining: null,
        expirationDate: expirationDate || '',
        url: '/documentos'
      });
    }
  }

  return records.sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));
}

export function groupDueRecords(records) {
  const groups = new Map();

  for (const record of records) {
    if (!groups.has(record.group)) groups.set(record.group, []);
    groups.get(record.group).push(record);
  }

  return ['warning', 'critical', 'urgent', 'expired', 'signature']
    .map((group) => ({ group, records: groups.get(group) || [] }))
    .filter((item) => item.records.length > 0);
}

export function buildPushPayloadForGroup(user, group) {
  const count = group.records.length;
  const firstRecord = group.records[0];
  const titles = {
    expired: count === 1 ? 'Documento vencido' : 'Documentos vencidos',
    urgent: count === 1 ? 'Documento por expirar' : 'Documentos por expirar',
    critical: count === 1 ? 'Documento crítico' : 'Documentos críticos',
    warning: count === 1 ? 'Documento por vencer' : 'Documentos por vencer',
    signature: count === 1 ? 'Firma pendiente' : 'Firmas pendientes'
  };

  const pluralBodies = {
    expired: `${count} documentos estan vencidos. Revisa tus documentos.`,
    urgent: `${count} documentos expiran en 1 dia o menos. Revisa tus documentos.`,
    critical: `${count} documentos vencen dentro de 30 días. Revisa tus documentos.`,
    warning: `${count} documentos vencen dentro de 60 días. Revisa tus documentos.`,
    signature: `${count} documentos tienen firmas pendientes. Revisa tus documentos.`
  };

  return {
    title: titles[group.group] || 'Alerta documental',
    body: count === 1 ? firstRecord.body : pluralBodies[group.group],
    url: firstRecord.url || '/documentos',
    tag: `compas-${group.group}-${user.id}`
  };
}

export function compareEmailRecords(a, b) {
  const orderA = EMAIL_NOTIFICATION_ORDER.indexOf(a.group || getAlertGroupFromThreshold(a.threshold, a.severity));
  const orderB = EMAIL_NOTIFICATION_ORDER.indexOf(b.group || getAlertGroupFromThreshold(b.threshold, b.severity));
  return (orderA - orderB)
    || ((a.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.daysRemaining ?? Number.MAX_SAFE_INTEGER))
    || String(a.docName || '').localeCompare(String(b.docName || ''), 'es');
}

export function groupEmailRecordsByExpirationThreshold(records = []) {
  const groupedRecords = new Map(
    EMAIL_EXPIRATION_THRESHOLDS.map((threshold) => [threshold, []])
  );

  for (const record of [...records].sort(compareEmailRecords)) {
    const threshold = Number(record?.threshold);
    if (!groupedRecords.has(threshold)) continue;
    groupedRecords.get(threshold).push(record);
  }

  return EMAIL_EXPIRATION_THRESHOLDS
    .map((threshold) => ({
      threshold,
      group: threshold === 60 ? 'warning' : 'critical',
      records: groupedRecords.get(threshold)
    }))
    .filter((item) => item.records.length > 0);
}

export function isScheduledNotificationRecordDue(record, previousEvent, now = Date.now()) {
  if (!previousEvent) return true;
  if (record?.once) return false;

  const cooldownMs = Number(record?.cooldownMs);
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return false;

  const lastSentAt = Date.parse(
    previousEvent?.lastSentAt || previousEvent?.sentAt || previousEvent
  );
  if (!Number.isFinite(lastSentAt)) return true;

  return now - lastSentAt >= cooldownMs;
}

function getAlertGroupFromThreshold(threshold, severity = '') {
  if (severity === 'warning' || Number(threshold) === 60) return 'warning';
  if (severity === 'critical' || Number(threshold) === 30) return 'critical';
  if (severity === 'urgent' || Number(threshold) === 1) return 'urgent';
  return severity;
}

function getDaysRemaining(dateString) {
  if (!dateString) return null;

  const expirationDate = parseControlDocDate(dateString);
  if (!expirationDate) return null;

  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();

  return Math.ceil(diff / DAY_MS);
}

function buildDocumentExpirationBody({ docName, threshold, daysRemaining, expirationDate }) {
  const formattedDate = formatNotificationDate(expirationDate);
  const dateSuffix = formattedDate ? `, el ${formattedDate}` : '';

  if (threshold === 0) return `${docName} venció${dateSuffix}.`;
  if (daysRemaining === 0) return `${docName} vence hoy${dateSuffix}.`;
  if (daysRemaining === 1) return `${docName} vence mañana${dateSuffix}.`;
  return `${docName} vence en ${daysRemaining} días${dateSuffix}.`;
}

function formatNotificationDate(value) {
  const date = parseControlDocDate(value);
  if (!date) return '';

  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear()
  ].join('/');
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

function groupRank(group) {
  if (group === 'expired') return 0;
  if (group === 'urgent') return 1;
  if (group === 'critical') return 2;
  if (group === 'warning') return 3;
  if (group === 'signature') return 4;
  return 4;
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

function isInvalidNotificationDocName(docName) {
  const normalizedName = (docName || '').toString().trim().toLowerCase();
  return !normalizedName || normalizedName.includes('no hay contenido');
}
