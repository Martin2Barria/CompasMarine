import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';
import { dbPool } from '../config/db.js';
import { sendJson, readRequestBody, getCookie, requireJsonRequest } from '../utils/http.js';
import { requireSameOriginRequest, consumeRateLimit } from '../utils/security.js';
import { escapeHtml, isValidEmail, resolveEmailConfig, sendEmail } from '../utils/email.js';
import {
  getDocumentEntityIds,
  getDocumentExpirationDate,
  hasPendingSignature,
  parseControlDocDate
} from '../../src/controldoc/fields.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '../..');
const notificationsStorePath = resolve(appRoot, 'server', 'notifications.json');
const WORKER_NOTIFICATION_ROLE_IDS = [3, 12];
const SERVER_ALERT_RULE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const MAX_STORED_SENT_EVENTS = 4000;

let schedulerTimer = null;
let schedulerRunning = false;
let notificationPersistencePromise = null;
let notificationPersistenceReady = false;

function loadNotificationsStore() {
  if (!existsSync(notificationsStorePath)) return { subscriptions: [], sentEvents: {} };
  try {
    const parsed = JSON.parse(readFileSync(notificationsStorePath, 'utf8'));
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      sentEvents: normalizeSentEvents(parsed.sentEvents)
    };
  } catch {
    return { subscriptions: [], sentEvents: {} };
  }
}

const initialNotificationsStore = loadNotificationsStore();
const pushSubscriptions = new Map(initialNotificationsStore.subscriptions.map((record) => [record.endpoint, record]));
let sentEvents = initialNotificationsStore.sentEvents;

function saveNotificationsStore() {
  try {
    writeFileSync(
      notificationsStorePath,
      JSON.stringify({
        subscriptions: [...pushSubscriptions.values()],
        sentEvents
      }, null, 2),
      'utf8'
    );
  } catch (error) {
    console.warn('[Push Persistence] No se pudo escribir respaldo JSON:', error.message);
  }
}

async function tryEnsureNotificationPersistence() {
  try {
    await ensureNotificationPersistence();
    return true;
  } catch (error) {
    console.warn('[Push Persistence] Usando respaldo JSON. MySQL no disponible:', error.message);
    return false;
  }
}

async function ensureNotificationPersistence() {
  if (notificationPersistenceReady) return;

  if (!notificationPersistencePromise) {
    notificationPersistencePromise = initializeNotificationPersistence()
      .then(() => {
        notificationPersistenceReady = true;
      })
      .catch((error) => {
        notificationPersistencePromise = null;
        notificationPersistenceReady = false;
        throw error;
      });
  }

  await notificationPersistencePromise;
}

async function initializeNotificationPersistence() {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint_hash CHAR(64) PRIMARY KEY,
      user_id INT NULL,
      endpoint TEXT NOT NULL,
      subscription_json JSON NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_push_subscriptions_user_id (user_id)
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS push_notification_events (
      event_hash CHAR(64) PRIMARY KEY,
      user_id INT NULL,
      event_key TEXT NOT NULL,
      event_id TEXT NOT NULL,
      rule_version INT NOT NULL DEFAULT 1,
      sent_at DATETIME NOT NULL,
      last_sent_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_push_notification_events_user_id (user_id)
    )
  `);

  await hydrateNotificationsFromDatabase();
  await migrateJsonNotificationStoreToDatabase();
}

async function hydrateNotificationsFromDatabase() {
  const [subscriptionRows] = await dbPool.query(`
    SELECT user_id, endpoint, subscription_json, created_at, updated_at
    FROM push_subscriptions
  `);

  for (const row of subscriptionRows) {
    const endpoint = String(row.endpoint || '').trim();
    if (!endpoint || pushSubscriptions.has(endpoint)) continue;

    const subscription = parseDatabaseJson(row.subscription_json);
    if (!subscription?.endpoint) continue;

    pushSubscriptions.set(endpoint, {
      userId: row.user_id ? String(row.user_id) : 'demo',
      endpoint,
      subscription,
      createdAt: toIsoDate(row.created_at),
      updatedAt: toIsoDate(row.updated_at)
    });
  }

  const [eventRows] = await dbPool.query(`
    SELECT event_key, rule_version, sent_at, last_sent_at
    FROM push_notification_events
  `);

  for (const row of eventRows) {
    const eventKey = String(row.event_key || '').trim();
    if (!eventKey || sentEvents[eventKey]) continue;

    sentEvents[eventKey] = {
      ruleVersion: Number(row.rule_version) || SERVER_ALERT_RULE_VERSION,
      sentAt: toIsoDate(row.sent_at),
      lastSentAt: toIsoDate(row.last_sent_at)
    };
  }
}

async function migrateJsonNotificationStoreToDatabase() {
  const subscriptions = [...pushSubscriptions.values()];
  const events = Object.entries(sentEvents);

  await Promise.all(subscriptions.map((record) => persistPushSubscription(record)));
  await Promise.all(events.map(([eventKey, event]) => persistSentEvent(eventKey, event)));
}

async function persistNotificationState({ removedEndpoints = [] } = {}) {
  const databaseReady = await tryEnsureNotificationPersistence();

  if (databaseReady) {
    await Promise.all([...pushSubscriptions.values()].map((record) => persistPushSubscription(record)));
    await Promise.all(Object.entries(sentEvents).map(([eventKey, event]) => persistSentEvent(eventKey, event)));
    if (removedEndpoints.length > 0) await deletePushSubscriptions(removedEndpoints);
  }

  saveNotificationsStore();
}

async function persistPushSubscription(record) {
  if (!record?.endpoint || !record?.subscription) return;

  await dbPool.execute(`
    INSERT INTO push_subscriptions (endpoint_hash, user_id, endpoint, subscription_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      endpoint = VALUES(endpoint),
      subscription_json = VALUES(subscription_json),
      updated_at = VALUES(updated_at)
  `, [
    hashValue(record.endpoint),
    /^\d+$/.test(String(record.userId || '')) ? Number(record.userId) : null,
    record.endpoint,
    JSON.stringify(record.subscription),
    toMysqlDateTime(record.createdAt),
    toMysqlDateTime(record.updatedAt)
  ]);
}

async function persistSentEvent(eventKey, event) {
  if (!eventKey || !event) return;

  await dbPool.execute(`
    INSERT INTO push_notification_events (event_hash, user_id, event_key, event_id, rule_version, sent_at, last_sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      rule_version = VALUES(rule_version),
      sent_at = VALUES(sent_at),
      last_sent_at = VALUES(last_sent_at)
  `, [
    hashValue(eventKey),
    extractUserIdFromEventKey(eventKey),
    eventKey,
    extractEventIdFromEventKey(eventKey),
    Number(event.ruleVersion) || SERVER_ALERT_RULE_VERSION,
    toMysqlDateTime(event.sentAt || event.lastSentAt),
    toMysqlDateTime(event.lastSentAt || event.sentAt)
  ]);
}

async function deletePushSubscriptions(endpoints) {
  const endpointHashes = [...new Set(endpoints.map(hashValue).filter(Boolean))];
  if (endpointHashes.length === 0) return;

  const placeholders = endpointHashes.map(() => '?').join(',');
  await dbPool.execute(
    `DELETE FROM push_subscriptions WHERE endpoint_hash IN (${placeholders})`,
    endpointHashes
  );
}

export function hasVapidConfig() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function configureWebPush() {
  if (!hasVapidConfig()) return;
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:soporte@compasmarine.cl',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export async function handlePushSubscription(req, res) {
  if (!requireSameOriginRequest(req, res)) return;
  await tryEnsureNotificationPersistence();
  if (req.method === 'GET') return sendJson(res, 200, { count: pushSubscriptions.size, pushReady: hasVapidConfig() });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'push-subscription', 20, 15 * 60 * 1000)) return;

  const rawBody = await readRequestBody(req);
  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

  const subscription = payload.subscription || payload;
  if (!subscription || !subscription.endpoint) return sendJson(res, 400, { error: 'Invalid push subscription' });

  const userId = getCookie(req, 'compas_user_id') || 'demo';
  const record = {
    userId, endpoint: subscription.endpoint, subscription,
    createdAt: pushSubscriptions.get(subscription.endpoint)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  pushSubscriptions.set(subscription.endpoint, record);
  await persistNotificationState();

  sendJson(res, 202, { ok: true, userId, count: pushSubscriptions.size, pushReady: hasVapidConfig() });
}

export async function handlePushTest(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'push-test', 5, 10 * 60 * 1000)) return;

  const userId = getCookie(req, 'compas_user_id') || 'demo';
  if (!hasVapidConfig()) return sendJson(res, 200, { ok: false, reason: 'VAPID no configurado' });
  configureWebPush();
  await tryEnsureNotificationPersistence();

  const records = [...pushSubscriptions.values()].filter(r => r.userId === userId);
  if (records.length === 0) return sendJson(res, 200, { ok: false, reason: 'Sin subscripciones' });

  let sent = 0;
  const removedEndpoints = [];
  await Promise.all(records.map(async (record) => {
    try {
      await webPush.sendNotification(record.subscription, JSON.stringify({ title: 'Prueba', body: 'Test' }));
      sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        pushSubscriptions.delete(record.endpoint);
        removedEndpoints.push(record.endpoint);
      }
    }
  }));

  await persistNotificationState({ removedEndpoints });
  sendJson(res, sent > 0 ? 202 : 200, { ok: sent > 0, sent });
}

export function startNotificationScheduler({ getControlDocData, intervalMs } = {}) {
  if (schedulerTimer) return { started: false, reason: 'already-running' };
  if (typeof getControlDocData !== 'function') return { started: false, reason: 'missing-control-doc-provider' };
  if (!hasVapidConfig()) {
    console.warn('[Push Scheduler] VAPID no configurado. No se iniciaran push automaticos.');
    return { started: false, reason: 'vapid-missing' };
  }

  configureWebPush();

  const resolvedIntervalMs = normalizePositiveMs(
    intervalMs || process.env.NOTIFICATION_SCHEDULER_INTERVAL_MS,
    DEFAULT_SCHEDULER_INTERVAL_MS
  );
  const initialDelayMs = normalizePositiveMs(
    process.env.NOTIFICATION_SCHEDULER_INITIAL_DELAY_MS,
    30 * 1000
  );

  const run = () => {
    runScheduledPushNotifications({ getControlDocData }).catch((error) => {
      console.error('[Push Scheduler] Error ejecutando notificaciones automaticas:', error.message);
    });
  };

  const initialTimer = setTimeout(run, initialDelayMs);
  initialTimer.unref?.();
  schedulerTimer = setInterval(run, resolvedIntervalMs);
  schedulerTimer.unref?.();

  console.log(`[Push Scheduler] Activo. Intervalo: ${Math.round(resolvedIntervalMs / 60000)} min.`);
  return { started: true, intervalMs: resolvedIntervalMs };
}

export async function runScheduledPushNotifications({ getControlDocData } = {}) {
  if (schedulerRunning) return { skipped: true, reason: 'already-running' };
  if (!hasVapidConfig()) return { skipped: true, reason: 'vapid-missing' };
  if (typeof getControlDocData !== 'function') return { skipped: true, reason: 'missing-control-doc-provider' };

  await tryEnsureNotificationPersistence();
  const subscriptionsByUser = groupSubscriptionsByUser();
  const subscribedUserIds = [...subscriptionsByUser.keys()];
  if (subscribedUserIds.length === 0) return { checked: true, sent: 0, users: 0 };

  schedulerRunning = true;

  try {
    const users = await getSubscribedWorkerUsers(subscribedUserIds);
    if (users.length === 0) return { checked: true, sent: 0, users: 0 };

    const controlDocData = await getControlDocData();
    const documents = toArray(controlDocData?.documents);
    const entities = toArray(controlDocData?.entities);
    const documentTypes = toArray(controlDocData?.documentTypes || controlDocData?.document_types);

    let sent = 0;
    let touchedStore = false;
    const removedEndpoints = [];
    const now = Date.now();

    for (const user of users) {
      const subscriptions = subscriptionsByUser.get(String(user.id)) || [];
      if (subscriptions.length === 0) continue;

      const scopedDocuments = getDocumentsForUser({ documents, entities, user });
      if (scopedDocuments.length === 0) continue;

      const dueRecords = buildScheduledNotificationRecords({ documents: scopedDocuments, documentTypes })
        .filter((record) => shouldSendScheduledRecord(user.id, record, now));

      const groupedRecords = groupDueRecords(dueRecords);
      for (const group of groupedRecords) {
        const payload = buildPushPayloadForGroup(user, group);
        const result = await sendPushToSubscriptions(subscriptions, payload);
        if (result.removed > 0) {
          touchedStore = true;
          removedEndpoints.push(...result.removedEndpoints);
        }
        if (result.sent === 0) continue;

        sent += result.sent;
        group.records.forEach((record) => markScheduledRecordAsSent(user.id, record, now));
        touchedStore = true;
      }
    }

    if (touchedStore) {
      pruneSentEvents();
      await persistNotificationState({ removedEndpoints });
    }

    return { checked: true, sent, users: users.length };
  } finally {
    schedulerRunning = false;
  }
}

export async function handleEmailAlerts(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'email-alerts', 5, 60 * 60 * 1000)) return;

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

  const alerts = normalizeAlertPayload(payload.alerts);
  if (alerts.length === 0) return sendJson(res, 400, { error: 'No hay alertas para enviar por correo.' });

  const userId = getCookie(req, 'compas_user_id');
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });

  let user = null;
  try {
    const [rows] = await dbPool.execute(`
      SELECT u.id, u.nombre, u.email, r.id as rol_id
      FROM usuarios u
      LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id
      LEFT JOIN roles r ON ur.rol_id = r.id
      WHERE u.id = ? AND u.activo = TRUE
      LIMIT 1
    `, [userId]);
    user = rows[0] || null;
  } catch (error) {
    console.warn('No se pudo resolver el correo del usuario para alertas:', error.message);
  }

  if (Number(user?.rol_id) !== 12) {
    return sendJson(res, 403, {
      ok: false,
      error: 'El envio de correos esta limitado al rol UsuarioPrueba.'
    });
  }

  const userEmail = String(user?.email || '').trim().toLowerCase();
  if (!userEmail) return sendJson(res, 400, { error: 'Correo no resuelto' });
  if (!isValidEmail(userEmail)) return sendJson(res, 400, { error: 'El correo asociado al usuario no es válido.' });

  const emailConfig = resolveEmailConfig();
  if (!emailConfig.ready) {
    return sendJson(res, 503, {
      ok: false,
      error: 'Proveedor de email no configurado.',
      missing: emailConfig.missing
    });
  }

  try {
    const message = buildAlertDigestEmail({ alerts, user });
    const result = await sendEmail({
      to: userEmail,
      subject: message.subject,
      text: message.text,
      html: message.html,
      config: emailConfig
    });

    return sendJson(res, 202, {
      ok: true,
      sent: result.accepted.length,
      provider: result.provider,
      to: userEmail
    });
  } catch (error) {
    console.error('No se pudo enviar correo de alertas:', error.message);
    return sendJson(res, 502, { ok: false, error: 'No se pudo enviar el correo de alertas.' });
  }
}

function normalizePositiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function groupSubscriptionsByUser() {
  const grouped = new Map();

  for (const record of pushSubscriptions.values()) {
    const userId = String(record?.userId || '').trim();
    if (!userId || userId === 'demo') continue;
    if (!grouped.has(userId)) grouped.set(userId, []);
    grouped.get(userId).push(record);
  }

  return grouped;
}

async function getSubscribedWorkerUsers(userIds) {
  const normalizedIds = userIds
    .map((id) => String(id || '').trim())
    .filter((id) => /^\d+$/.test(id));

  if (normalizedIds.length === 0) return [];

  const placeholders = normalizedIds.map(() => '?').join(',');
  const [rows] = await dbPool.execute(`
    SELECT u.id, u.nombre, u.email, r.id as rol_id, r.nombre as rol
    FROM usuarios u
    LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id
    LEFT JOIN roles r ON ur.rol_id = r.id
    WHERE u.id IN (${placeholders}) AND u.activo = TRUE
  `, normalizedIds);

  const usersById = new Map();
  for (const row of rows) {
    const id = String(row.id);
    if (!usersById.has(id)) {
      usersById.set(id, {
        id: row.id,
        nombre: row.nombre,
        email: row.email,
        roleIds: [],
        roleNames: [],
        rut: ''
      });
    }

    const user = usersById.get(id);
    const roleId = Number(row.rol_id);
    if (Number.isFinite(roleId) && !user.roleIds.includes(roleId)) user.roleIds.push(roleId);
    if (row.rol && !user.roleNames.includes(row.rol)) user.roleNames.push(row.rol);
  }

  await hydrateUserRutsFromEntities([...usersById.values()]);

  return [...usersById.values()].filter(isWorkerNotificationUser);
}

async function hydrateUserRutsFromEntities(users) {
  const emails = users
    .map((user) => normalizeText(user.email))
    .filter(Boolean);

  if (emails.length === 0) return;

  const uniqueEmails = [...new Set(emails)];
  const placeholders = uniqueEmails.map(() => '?').join(',');

  try {
    const [rows] = await dbPool.execute(
      `SELECT email, rut FROM entidades_api WHERE email IN (${placeholders})`,
      uniqueEmails
    );
    const rutByEmail = new Map(rows.map((row) => [normalizeText(row.email), row.rut || '']));
    users.forEach((user) => {
      user.rut = rutByEmail.get(normalizeText(user.email)) || '';
    });
  } catch (error) {
    console.warn('[Push Scheduler] No se pudieron cargar RUT locales:', error.message);
  }
}

function isWorkerNotificationUser(user) {
  const roleIds = Array.isArray(user?.roleIds) ? user.roleIds : [];
  return roleIds.some((roleId) => WORKER_NOTIFICATION_ROLE_IDS.includes(Number(roleId)));
}

function getDocumentsForUser({ documents, entities, user }) {
  const entity = findEntityForNotificationUser(entities, user);
  const entityId = entity?.id?.toString();
  if (!entityId) return [];

  return documents.filter((doc) => getDocumentEntityIds(doc).includes(entityId));
}

function findEntityForNotificationUser(entities, user) {
  const userEmail = normalizeText(user?.email);
  const userRut = normalizeRut(user?.rut);

  if (!userEmail && !userRut) return null;

  return entities.find((entity) => entityMatchesUserEmail(entity, userEmail))
    || entities.find((entity) => entityMatchesUserRut(entity, userRut))
    || null;
}

function entityMatchesUserEmail(entity, userEmail) {
  if (!entity || !userEmail) return false;

  const directValues = [
    entity.email,
    entity?.custom_fields?.correo_electronico_personal,
    entity?.custom_fields?.correo_electronico_corporativo
  ];

  if (directValues.some((value) => normalizeText(value) === userEmail)) return true;

  try {
    return JSON.stringify(entity).toLowerCase().includes(userEmail);
  } catch {
    return false;
  }
}

function entityMatchesUserRut(entity, userRut) {
  if (!entity || !userRut) return false;

  const directValues = [
    entity.identifier,
    entity.rut,
    entity?.custom_fields?.numero_de_documento,
    entity?.custom_fields?.rut
  ];

  return directValues.some((value) => normalizeRut(value) === userRut);
}

function buildScheduledNotificationRecords({ documents = [], documentTypes = [] }) {
  const records = [];

  for (const doc of documents) {
    const docName = getDocName(doc, documentTypes);
    if (isInvalidNotificationDocName(docName)) continue;

    const expirationDate = getDocumentExpirationDate(doc);
    const daysRemaining = getDaysRemaining(expirationDate);

    if (daysRemaining !== null && daysRemaining <= 60) {
      const threshold = daysRemaining < 0
        ? 0
        : daysRemaining <= 30
          ? 30
          : 60;
      const group = threshold === 0 ? 'expired' : threshold === 30 ? 'critical' : 'warning';

      records.push({
        id: buildDocumentEventId(doc, threshold),
        ruleVersion: SERVER_ALERT_RULE_VERSION,
        group,
        once: threshold === 0,
        cooldownMs: threshold === 30 ? DAY_MS : threshold === 60 ? 5 * DAY_MS : null,
        docName,
        body: threshold === 0 ? `${docName} se vencio.` : `${docName} esta por vencer.`,
        daysRemaining,
        expirationDate: expirationDate || '',
        url: '/documentos'
      });
    }

    if (hasPendingSignature(doc)) {
      records.push({
        id: buildSignatureEventId(doc),
        ruleVersion: SERVER_ALERT_RULE_VERSION,
        group: 'signature',
        once: false,
        cooldownMs: 7 * DAY_MS,
        docName,
        body: `${docName} tiene una firma pendiente.`,
        daysRemaining: null,
        expirationDate: expirationDate || '',
        url: '/documentos'
      });
    }
  }

  return records.sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));
}

function groupDueRecords(records) {
  const groups = new Map();

  for (const record of records) {
    if (!groups.has(record.group)) groups.set(record.group, []);
    groups.get(record.group).push(record);
  }

  return ['expired', 'critical', 'warning', 'signature']
    .map((group) => ({ group, records: groups.get(group) || [] }))
    .filter((item) => item.records.length > 0);
}

function buildPushPayloadForGroup(user, group) {
  const count = group.records.length;
  const firstRecord = group.records[0];
  const titles = {
    expired: count === 1 ? 'Documento vencido' : 'Documentos vencidos',
    critical: count === 1 ? 'Documento critico' : 'Documentos criticos',
    warning: count === 1 ? 'Documento por vencer' : 'Documentos por vencer',
    signature: count === 1 ? 'Firma pendiente' : 'Firmas pendientes'
  };

  const pluralBodies = {
    expired: `${count} documentos estan vencidos. Revisa tus documentos.`,
    critical: `${count} documentos estan por vencer. Revisa tus documentos.`,
    warning: `${count} documentos estan por vencer. Revisa tus documentos.`,
    signature: `${count} documentos tienen firmas pendientes. Revisa tus documentos.`
  };

  return {
    title: titles[group.group] || 'Alerta documental',
    body: count === 1 ? firstRecord.body : pluralBodies[group.group],
    url: firstRecord.url || '/documentos',
    tag: `compas-${group.group}-${user.id}`
  };
}

async function sendPushToSubscriptions(records, payload) {
  let sent = 0;
  let removed = 0;
  const removedEndpoints = [];

  await Promise.all(records.map(async (record) => {
    try {
      await webPush.sendNotification(record.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        pushSubscriptions.delete(record.endpoint);
        removedEndpoints.push(record.endpoint);
        removed += 1;
        return;
      }

      console.warn('[Push Scheduler] No se pudo enviar push:', error.message);
    }
  }));

  return { sent, removed, removedEndpoints };
}

function shouldSendScheduledRecord(userId, record, now) {
  const eventKey = buildSentEventKey(userId, record.id);
  const previous = sentEvents[eventKey];
  if (!previous) return true;
  if (record.once) return false;

  const lastSentAt = Date.parse(previous.lastSentAt || previous.sentAt || previous);
  if (!Number.isFinite(lastSentAt)) return true;

  return now - lastSentAt >= record.cooldownMs;
}

function markScheduledRecordAsSent(userId, record, now) {
  sentEvents[buildSentEventKey(userId, record.id)] = {
    ruleVersion: SERVER_ALERT_RULE_VERSION,
    sentAt: new Date(now).toISOString(),
    lastSentAt: new Date(now).toISOString()
  };
}

function pruneSentEvents() {
  sentEvents = Object.fromEntries(
    Object.entries(sentEvents)
      .sort((a, b) => getSentEventTime(b[1]) - getSentEventTime(a[1]))
      .slice(0, MAX_STORED_SENT_EVENTS)
  );
}

function normalizeSentEvents(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, event]) => {
        if (!key) return null;
        if (typeof event === 'string') return [key, { sentAt: event, lastSentAt: event }];
        if (!event || typeof event !== 'object') return null;
        return [key, {
          ruleVersion: Number(event.ruleVersion) || SERVER_ALERT_RULE_VERSION,
          sentAt: event.sentAt || event.lastSentAt || new Date(0).toISOString(),
          lastSentAt: event.lastSentAt || event.sentAt || new Date(0).toISOString()
        }];
      })
      .filter(Boolean)
  );
}

function hashValue(value) {
  const rawValue = String(value || '');
  if (!rawValue) return '';
  return createHash('sha256').update(rawValue).digest('hex');
}

function parseDatabaseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIsoDate(value) {
  const parsed = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toMysqlDateTime(value) {
  const parsed = value instanceof Date ? value : new Date(value || Date.now());
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return safeDate.toISOString().slice(0, 19).replace('T', ' ');
}

function extractUserIdFromEventKey(eventKey) {
  const match = String(eventKey || '').match(/^user:(\d+):/);
  return match ? Number(match[1]) : null;
}

function extractEventIdFromEventKey(eventKey) {
  return String(eventKey || '').replace(/^user:\d+:/, '').slice(0, 1024);
}

function getSentEventTime(event) {
  const parsed = Date.parse(event?.lastSentAt || event?.sentAt || event);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSentEventKey(userId, eventId) {
  return `user:${userId}:${eventId}`;
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

function getDaysRemaining(dateString) {
  if (!dateString) return null;

  const expirationDate = parseControlDocDate(dateString);
  if (!expirationDate) return null;

  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();

  return Math.ceil(diff / DAY_MS);
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
  if (group === 'critical') return 1;
  if (group === 'warning') return 2;
  if (group === 'signature') return 3;
  return 4;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of ['data', 'items', 'documents', 'entities', 'documentTypes', 'document_types']) {
    if (Array.isArray(value[key])) return value[key];
  }

  return Object.values(value).find((item) => Array.isArray(item)) || [];
}

function normalizeText(value) {
  return (value || '').toString().trim().toLowerCase();
}

function normalizeRut(value) {
  return (value || '').toString().replace(/[^0-9kK]/g, '').toLowerCase();
}

function isInvalidNotificationDocName(docName) {
  const normalizedName = (docName || '').toString().trim().toLowerCase();
  return !normalizedName || normalizedName.includes('no hay contenido');
}

function normalizeAlertPayload(alerts) {
  if (!Array.isArray(alerts)) return [];

  return alerts
    .slice(0, 20)
    .map((alert) => ({
      title: String(alert?.title || 'Alerta documental').trim(),
      body: String(alert?.body || '').trim(),
      docName: String(alert?.docName || 'Documento').trim(),
      severity: String(alert?.severity || '').trim(),
      expirationDate: String(alert?.expirationDate || '').trim(),
      daysRemaining: Number.isFinite(Number(alert?.daysRemaining)) ? Number(alert.daysRemaining) : null
    }))
    .filter((alert) => alert.body || alert.docName);
}

function buildAlertDigestEmail({ alerts, user }) {
  const userName = user?.nombre || user?.email || 'Usuario';
  const expiredCount = alerts.filter((alert) => alert.severity === 'expired').length;
  const criticalCount = alerts.filter((alert) => alert.severity === 'critical').length;
  const warningCount = alerts.filter((alert) => alert.severity === 'warning').length;
  const subject = `Compas Marine: ${alerts.length} alerta${alerts.length === 1 ? '' : 's'} documental${alerts.length === 1 ? '' : 'es'}`;

  const textLines = [
    `Hola ${userName},`,
    '',
    `Tienes ${alerts.length} alerta${alerts.length === 1 ? '' : 's'} documental${alerts.length === 1 ? '' : 'es'} en Compas Marine.`,
    `Vencidas/bloqueadas: ${expiredCount}`,
    `Criticas (30 dias): ${criticalCount}`,
    `Por vencer (60 dias): ${warningCount}`,
    '',
    ...alerts.map((alert, index) => `${index + 1}. ${alert.docName}: ${alert.body}`),
    '',
    'Ingresa a la app de Compas Marine para revisar el detalle.'
  ];

  const rows = alerts.map((alert) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#394049;">${escapeHtml(alert.docName)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#4b5563;">${escapeHtml(alert.body)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#921E30;font-weight:700;">${escapeHtml(getSeverityLabel(alert.severity))}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#394049;max-width:680px;margin:0 auto;">
      <h2 style="margin:0 0 12px;color:#921E30;">Alertas documentales</h2>
      <p>Hola <strong>${escapeHtml(userName)}</strong>, tienes <strong>${alerts.length}</strong> alerta${alerts.length === 1 ? '' : 's'} documental${alerts.length === 1 ? '' : 'es'} en Compas Marine.</p>
      <table style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #e5e7eb;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:10px;">Documento</th>
            <th style="padding:10px;">Detalle</th>
            <th style="padding:10px;">Estado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#6b7280;font-size:13px;">Ingresa a la app de Compas Marine para revisar el detalle.</p>
    </div>
  `;

  return {
    subject,
    text: textLines.join('\n'),
    html
  };
}

function getSeverityLabel(severity) {
  if (severity === 'expired') return 'Vencido';
  if (severity === 'critical') return 'Critico';
  if (severity === 'warning') return 'Por vencer';
  return 'Alerta';
}
