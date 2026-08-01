import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';
import { Resend } from 'resend';
import { dbPool } from '../config/db.js';
import { sendJson, readRequestBody, getCookie, requireJsonRequest } from '../utils/http.js';
import { requireSameOriginRequest, consumeRateLimit } from '../utils/security.js';
import { escapeHtml, isValidEmail } from '../utils/email.js';
import {
  getDocumentEntityIds
} from '../../src/controldoc/fields.js';
import {
  buildPushPayloadForGroup,
  buildScheduledNotificationRecords,
  compareEmailRecords,
  groupEmailRecordsByExpirationThreshold,
  groupDueRecords,
  isScheduledNotificationRecordDue,
  NOTIFICATION_RULE_VERSION
} from './notification-rules.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '../..');
const notificationsStorePath = resolve(appRoot, 'server', 'notifications.json');
const WORKER_NOTIFICATION_ROLE_IDS = [3, 12];
const SERVER_ALERT_RULE_VERSION = NOTIFICATION_RULE_VERSION;
const DEFAULT_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_EMAIL_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const RESEND_API_KEY_PLACEHOLDER = 're_xxxxxxxxx';
const MAX_STORED_SENT_EVENTS = 4000;

let schedulerTimer = null;
let emailSchedulerTimer = null;
let schedulerRunning = false;
let emailSchedulerRunning = false;
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

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS push_notification_history (
      event_hash CHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      event_id VARCHAR(1024) NOT NULL,
      notification_group VARCHAR(32) NOT NULL,
      threshold TINYINT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      doc_name VARCHAR(255) NOT NULL,
      expiration_date VARCHAR(100) NULL,
      days_remaining INT NULL,
      sent_at DATETIME NOT NULL,
      last_sent_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_push_notification_history_user_id (user_id),
      INDEX idx_push_notification_history_last_sent_at (last_sent_at)
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS email_notification_events (
      event_hash CHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      event_key VARCHAR(1024) NOT NULL,
      event_id VARCHAR(1024) NOT NULL,
      threshold TINYINT NOT NULL,
      provider_id VARCHAR(255) NULL,
      sent_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_email_notification_events_user_id (user_id),
      INDEX idx_email_notification_events_sent_at (sent_at)
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
  await Promise.all(events.map(([eventKey, event]) => persistPushNotificationHistory(eventKey, event)));
}

async function persistNotificationState({ removedEndpoints = [] } = {}) {
  const databaseReady = await tryEnsureNotificationPersistence();

  if (databaseReady) {
    await Promise.all([...pushSubscriptions.values()].map((record) => persistPushSubscription(record)));
    await Promise.all(Object.entries(sentEvents).map(([eventKey, event]) => persistSentEvent(eventKey, event)));
    await Promise.all(Object.entries(sentEvents).map(([eventKey, event]) => persistPushNotificationHistory(eventKey, event)));
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

async function persistPushNotificationHistory(eventKey, event) {
  const alert = event?.alert;
  const userId = extractUserIdFromEventKey(eventKey);
  if (!alert || !userId || !alert.id || !alert.group) return;

  await dbPool.execute(`
    INSERT INTO push_notification_history
      (event_hash, user_id, event_id, notification_group, threshold, title, body, doc_name,
       expiration_date, days_remaining, sent_at, last_sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      notification_group = VALUES(notification_group),
      threshold = VALUES(threshold),
      title = VALUES(title),
      body = VALUES(body),
      doc_name = VALUES(doc_name),
      expiration_date = VALUES(expiration_date),
      days_remaining = VALUES(days_remaining),
      last_sent_at = VALUES(last_sent_at)
  `, [
    hashValue(eventKey),
    userId,
    String(alert.id).slice(0, 1024),
    String(alert.group).slice(0, 32),
    toNullableNumber(alert.threshold),
    String(alert.title || 'Alerta documental').slice(0, 255),
    String(alert.body || ''),
    String(alert.docName || 'Documento').slice(0, 255),
    String(alert.expirationDate || '').slice(0, 100) || null,
    toNullableNumber(alert.daysRemaining),
    toMysqlDateTime(event.sentAt || event.lastSentAt),
    toMysqlDateTime(event.lastSentAt || event.sentAt)
  ]);
}

async function getSentEmailEventIds(userId) {
  const [rows] = await dbPool.execute(
    'SELECT event_id FROM email_notification_events WHERE user_id = ?',
    [userId]
  );
  return new Set(rows.map((row) => String(row.event_id || '').trim()).filter(Boolean));
}

async function markEmailRecordsAsSent({ userId, records, providerId, sentAt }) {
  const sentDate = toMysqlDateTime(sentAt);
  await Promise.all(records.map((record) => {
    const eventKey = buildEmailEventKey(userId, record.id);
    return dbPool.execute(`
      INSERT IGNORE INTO email_notification_events
        (event_hash, user_id, event_key, event_id, threshold, provider_id, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      hashValue(eventKey),
      userId,
      eventKey,
      record.id,
      Number(record.threshold),
      providerId || null,
      sentDate
    ]);
  }));
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

export function resolveResendConfig(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || RESEND_API_KEY_PLACEHOLDER).trim();
  const from = String(env.RESEND_FROM || 'onboarding@resend.dev').trim();
  const ready = Boolean(apiKey && apiKey !== RESEND_API_KEY_PLACEHOLDER && isValidEmail(from));

  return {
    ready,
    apiKey,
    from,
    missing: [
      ...(apiKey === RESEND_API_KEY_PLACEHOLDER ? ['RESEND_API_KEY'] : []),
      ...(!isValidEmail(from) ? ['RESEND_FROM'] : [])
    ]
  };
}

async function sendResendEmail({ to, subject, text, html, config = resolveResendConfig() }) {
  if (!config.ready) {
    throw new Error(`Resend no está configurado. Faltan: ${config.missing.join(', ')}`);
  }

  const recipient = String(to || '').trim().toLowerCase();
  if (!isValidEmail(recipient)) throw new Error('El correo destinatario no es válido.');

  const resend = new Resend(config.apiKey);
  const { data, error } = await resend.emails.send({
    from: config.from,
    to: recipient,
    subject,
    text,
    html
  });

  if (error) throw new Error(error.message || 'Resend rechazó el envío.');

  return {
    ok: true,
    provider: 'resend',
    id: data?.id || null,
    accepted: [recipient]
  };
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
  if (!['POST', 'DELETE'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'push-subscription', 20, 15 * 60 * 1000)) return;

  const rawBody = await readRequestBody(req);
  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

  const subscription = payload.subscription || payload;
  if (!subscription || !subscription.endpoint) return sendJson(res, 400, { error: 'Invalid push subscription' });

  const userId = getCookie(req, 'compas_user_id') || 'demo';
  if (req.method === 'DELETE') {
    const storedRecord = pushSubscriptions.get(subscription.endpoint);
    const canRemove = storedRecord && String(storedRecord.userId) === String(userId);
    if (canRemove) {
      pushSubscriptions.delete(subscription.endpoint);
      await persistNotificationState({ removedEndpoints: [subscription.endpoint] });
    }
    return sendJson(res, 200, { ok: true, removed: Boolean(canRemove) });
  }

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
  if (!hasVapidConfig()) return sendJson(res, 503, { ok: false, reason: 'VAPID no configurado' });
  configureWebPush();
  await tryEnsureNotificationPersistence();

  const records = [...pushSubscriptions.values()].filter(r => r.userId === userId);
  if (records.length === 0) return sendJson(res, 409, { ok: false, reason: 'Sin subscripciones' });

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
  if (schedulerTimer || emailSchedulerTimer) return { started: false, reason: 'already-running' };
  if (typeof getControlDocData !== 'function') return { started: false, reason: 'missing-control-doc-provider' };
  const pushReady = hasVapidConfig();
  const emailReady = resolveResendConfig().ready;

  if (!pushReady && !emailReady) {
    console.warn('[Notification Scheduler] VAPID y Resend no configurados. No se iniciaran notificaciones automaticas.');
    return { started: false, reason: 'vapid-missing' };
  }

  if (pushReady) configureWebPush();

  const resolvedIntervalMs = normalizePositiveMs(
    intervalMs || process.env.NOTIFICATION_SCHEDULER_INTERVAL_MS,
    DEFAULT_SCHEDULER_INTERVAL_MS
  );
  const initialDelayMs = normalizePositiveMs(
    process.env.NOTIFICATION_SCHEDULER_INITIAL_DELAY_MS,
    30 * 1000
  );

  if (pushReady) {
    const runPush = () => {
      runScheduledPushNotifications({ getControlDocData }).catch((error) => {
        console.error('[Push Scheduler] Error ejecutando notificaciones automaticas:', error.message);
      });
    };

    const initialPushTimer = setTimeout(runPush, initialDelayMs);
    initialPushTimer.unref?.();
    schedulerTimer = setInterval(runPush, resolvedIntervalMs);
    schedulerTimer.unref?.();
    console.log(`[Push Scheduler] Activo. Intervalo: ${Math.round(resolvedIntervalMs / 60000)} min.`);
  } else {
    console.warn('[Push Scheduler] VAPID no configurado. Solo se ejecutaran correos automaticos.');
  }

  if (emailReady) {
    const emailIntervalMs = normalizePositiveMs(
      process.env.EMAIL_NOTIFICATION_SCHEDULER_INTERVAL_MS,
      DEFAULT_EMAIL_SCHEDULER_INTERVAL_MS
    );
    const runEmail = () => {
      runScheduledEmailNotifications({ getControlDocData }).catch((error) => {
        console.error('[Email Scheduler] Error ejecutando correos automaticos:', error.message);
      });
    };

    const initialEmailTimer = setTimeout(runEmail, initialDelayMs);
    initialEmailTimer.unref?.();
    emailSchedulerTimer = setInterval(runEmail, emailIntervalMs);
    emailSchedulerTimer.unref?.();
    console.log(`[Email Scheduler] Activo para rol 12. Intervalo de revisión: ${Math.round(emailIntervalMs / 60000)} min.`);
  } else {
    console.warn('[Email Scheduler] RESEND_API_KEY no configurada. No se enviaran correos automaticos.');
  }

  return { started: true, pushReady, emailReady, intervalMs: resolvedIntervalMs };
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

export async function runScheduledEmailNotifications({ getControlDocData } = {}) {
  if (emailSchedulerRunning) return { skipped: true, reason: 'already-running' };
  if (!resolveResendConfig().ready) return { skipped: true, reason: 'resend-missing' };
  if (typeof getControlDocData !== 'function') return { skipped: true, reason: 'missing-control-doc-provider' };

  await tryEnsureNotificationPersistence();
  emailSchedulerRunning = true;

  try {
    const users = await getEmailNotificationUsers();
    if (users.length === 0) return { checked: true, sent: 0, users: 0 };

    const controlDocData = await getControlDocData();
    const documents = toArray(controlDocData?.documents);
    const entities = toArray(controlDocData?.entities);
    const documentTypes = toArray(controlDocData?.documentTypes || controlDocData?.document_types);
    const config = resolveResendConfig();
    const now = Date.now();
    let sent = 0;

    for (const user of users) {
      if (!isValidEmail(user.email)) continue;

      const scopedDocuments = getDocumentsForUser({ documents, entities, user });
      const sentEventIds = await getSentEmailEventIds(user.id);
      const dueRecords = buildScheduledNotificationRecords({ documents: scopedDocuments, documentTypes })
        .filter((record) => !sentEventIds.has(record.id))
        .sort(compareEmailRecords);
      const emailGroups = groupEmailRecordsByExpirationThreshold(dueRecords);

      for (const emailGroup of emailGroups) {
        const alerts = emailGroup.records.map((record) => ({
          id: record.id,
          threshold: record.threshold,
          title: record.title,
          body: record.body,
          docName: record.docName,
          severity: record.group,
          expirationDate: record.expirationDate,
          daysRemaining: record.daysRemaining
        }));
        const message = buildAlertDigestEmail({
          alerts,
          user,
          notificationGroup: emailGroup.group
        });

        try {
          const result = await sendResendEmail({
            to: user.email,
            subject: message.subject,
            text: message.text,
            html: message.html,
            config
          });

          await markEmailRecordsAsSent({
            userId: user.id,
            records: emailGroup.records,
            providerId: result.id,
            sentAt: now
          });
          sent += 1;
        } catch (error) {
          console.error(
            `[Email Scheduler] No se pudo enviar el aviso de ${emailGroup.threshold} dias a ${user.email}:`,
            error.message
          );
        }
      }
    }

    return { checked: true, sent, users: users.length };
  } finally {
    emailSchedulerRunning = false;
  }
}

export async function handleEmailAlerts(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'email-alerts', 5, 60 * 60 * 1000)) return;

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

  const alerts = normalizeAlertPayload(payload.alerts)
    .filter((alert) => [60, 30].includes(alert.threshold));
  if (alerts.length === 0) {
    return sendJson(res, 400, { error: 'No hay avisos de expiracion de 60 o 30 dias para enviar.' });
  }

  const userId = getCookie(req, 'compas_user_id');
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });

  let user = null;
  try {
    const [rows] = await dbPool.execute(`
      SELECT u.id, u.nombre, u.email, r.id as rol_id
      FROM usuarios u
      INNER JOIN usuarios_roles ur ON u.id = ur.usuario_id
      INNER JOIN roles r ON ur.rol_id = r.id
      WHERE u.id = ? AND u.activo = TRUE AND r.id = 12
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

  const emailConfig = resolveResendConfig();
  if (!emailConfig.ready) {
    return sendJson(res, 503, {
      ok: false,
      error: 'Resend no está configurado.',
      missing: emailConfig.missing
    });
  }

  await tryEnsureNotificationPersistence();
  const sentEventIds = await getSentEmailEventIds(userId);
  const pendingAlerts = alerts.filter((alert) => !sentEventIds.has(alert.id));
  if (pendingAlerts.length === 0) {
    return sendJson(res, 200, { ok: true, sent: 0, skipped: alerts.length, reason: 'Los avisos ya fueron enviados.' });
  }

  const emailGroups = groupEmailRecordsByExpirationThreshold(pendingAlerts);
  let sent = 0;
  let recorded = 0;
  const failedThresholds = [];

  for (const emailGroup of emailGroups) {
    try {
      const message = buildAlertDigestEmail({
        alerts: emailGroup.records,
        user,
        notificationGroup: emailGroup.group
      });
      const result = await sendResendEmail({
        to: userEmail,
        subject: message.subject,
        text: message.text,
        html: message.html,
        config: emailConfig
      });

      await markEmailRecordsAsSent({
        userId,
        records: emailGroup.records.map((alert) => ({
          id: alert.id,
          threshold: alert.threshold
        })),
        providerId: result.id,
        sentAt: Date.now()
      });
      sent += result.accepted.length;
      recorded += emailGroup.records.length;
    } catch (error) {
      failedThresholds.push(emailGroup.threshold);
      console.error(
        `[Email Alerts] No se pudo enviar el aviso de ${emailGroup.threshold} dias a ${userEmail}:`,
        error.message
      );
    }
  }

  if (sent === 0) {
    return sendJson(res, 502, {
      ok: false,
      error: 'No se pudieron enviar los correos de alertas.',
      failedThresholds
    });
  }

  return sendJson(res, 202, {
    ok: true,
    sent,
    recorded,
    skipped: alerts.length - pendingAlerts.length,
    failedThresholds,
    provider: 'resend',
    to: userEmail
  });
}

export async function handleEmailNotificationHistory(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;

  const userId = getCookie(req, 'compas_user_id');
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });

  try {
    await tryEnsureNotificationPersistence();
    const [rows] = await dbPool.execute(`
      SELECT event_id, threshold, provider_id, sent_at
      FROM email_notification_events
      WHERE user_id = ?
      ORDER BY sent_at DESC
      LIMIT 200
    `, [userId]);

    return sendJson(res, 200, {
      ok: true,
      events: rows.map((row) => ({
        eventId: row.event_id,
        threshold: Number(row.threshold),
        providerId: row.provider_id || null,
        sentAt: toIsoDate(row.sent_at)
      }))
    });
  } catch (error) {
    console.error('[Email History] No se pudo consultar el registro:', error.message);
    return sendJson(res, 500, { ok: false, error: 'No se pudo consultar el registro de correos.' });
  }
}

export async function handlePushNotificationHistory(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;

  const userId = getCookie(req, 'compas_user_id');
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });

  const databaseReady = await tryEnsureNotificationPersistence();
  if (!databaseReady) {
    return sendJson(res, 200, {
      ok: true,
      source: 'local-fallback',
      events: getPushNotificationHistoryFromMemory(userId)
    });
  }

  try {
    const [rows] = await dbPool.execute(`
      SELECT event_id, notification_group, threshold, title, body, doc_name,
             expiration_date, days_remaining, sent_at, last_sent_at
      FROM push_notification_history
      WHERE user_id = ?
      ORDER BY last_sent_at DESC
      LIMIT 200
    `, [userId]);

    return sendJson(res, 200, {
      ok: true,
      source: 'database',
      events: rows.map(normalizePushHistoryRow)
    });
  } catch (error) {
    console.error('[Push History] No se pudo consultar el respaldo:', error.message);
    return sendJson(res, 200, {
      ok: true,
      source: 'local-fallback',
      events: getPushNotificationHistoryFromMemory(userId)
    });
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

async function getEmailNotificationUsers() {
  const [rows] = await dbPool.execute(`
    SELECT u.id, u.nombre, u.email, r.id as rol_id, r.nombre as rol
    FROM usuarios u
    INNER JOIN usuarios_roles ur ON ur.usuario_id = u.id
    INNER JOIN roles r ON r.id = ur.rol_id
    WHERE u.activo = TRUE AND r.id = 12 AND u.email IS NOT NULL AND u.email <> ''
  `);

  const usersById = new Map();
  for (const row of rows) {
    const id = String(row.id);
    if (!usersById.has(id)) {
      usersById.set(id, {
        id: row.id,
        nombre: row.nombre,
        email: row.email,
        roleIds: [12],
        roleNames: [row.rol || 'UsuarioPrueba'],
        rut: ''
      });
    }
  }

  const users = [...usersById.values()];
  await hydrateUserRutsFromEntities(users);
  return users;
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
  return isScheduledNotificationRecordDue(record, previous, now);
}

function markScheduledRecordAsSent(userId, record, now) {
  const eventKey = buildSentEventKey(userId, record.id);
  const previous = sentEvents[eventKey];
  const sentAt = new Date(now).toISOString();

  sentEvents[eventKey] = {
    ruleVersion: SERVER_ALERT_RULE_VERSION,
    sentAt: previous?.sentAt || sentAt,
    lastSentAt: sentAt,
    alert: {
      id: record.id,
      group: record.group,
      threshold: toNullableNumber(record.threshold),
      title: record.title || 'Alerta documental',
      body: record.body || '',
      docName: record.docName || 'Documento',
      expirationDate: record.expirationDate || '',
      daysRemaining: toNullableNumber(record.daysRemaining),
      url: record.url || '/documentos'
    }
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
          lastSentAt: event.lastSentAt || event.sentAt || new Date(0).toISOString(),
          ...(event.alert && typeof event.alert === 'object' ? { alert: event.alert } : {})
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

function buildEmailEventKey(userId, eventId) {
  return `email:user:${userId}:${eventId}`;
}

function getPushNotificationHistoryFromMemory(userId) {
  const prefix = `user:${userId}:`;

  return Object.entries(sentEvents)
    .filter(([eventKey, event]) => eventKey.startsWith(prefix) && event?.alert)
    .map(([, event]) => normalizePushHistoryRow({
      event_id: event.alert.id,
      notification_group: event.alert.group,
      threshold: event.alert.threshold,
      title: event.alert.title,
      body: event.alert.body,
      doc_name: event.alert.docName,
      expiration_date: event.alert.expirationDate,
      days_remaining: event.alert.daysRemaining,
      sent_at: event.sentAt,
      last_sent_at: event.lastSentAt
    }))
    .sort((a, b) => Date.parse(b.lastSentAt) - Date.parse(a.lastSentAt))
    .slice(0, 200);
}

function normalizePushHistoryRow(row) {
  return {
    eventId: String(row.event_id || '').trim(),
    group: String(row.notification_group || '').trim(),
    threshold: toNullableNumber(row.threshold),
    title: String(row.title || 'Alerta documental'),
    body: String(row.body || ''),
    docName: String(row.doc_name || 'Documento'),
    expirationDate: String(row.expiration_date || ''),
    daysRemaining: toNullableNumber(row.days_remaining),
    sentAt: toIsoDate(row.sent_at),
    lastSentAt: toIsoDate(row.last_sent_at)
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of ['data', 'items', 'documents', 'entities', 'documentTypes', 'document_types']) {
    if (Array.isArray(value[key])) return value[key];
  }

  return Object.values(value).find((item) => Array.isArray(item)) || [];
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return (value || '').toString().trim().toLowerCase();
}

function normalizeRut(value) {
  return (value || '').toString().replace(/[^0-9kK]/g, '').toLowerCase();
}

function normalizeAlertPayload(alerts) {
  if (!Array.isArray(alerts)) return [];

  return alerts
    .slice(0, 200)
    .map((alert) => ({
      id: String(alert?.id || '').trim() || `manual:${hashValue(JSON.stringify(alert || {}))}`,
      title: String(alert?.title || 'Alerta documental').trim(),
      body: String(alert?.body || '').trim(),
      docName: String(alert?.docName || 'Documento').trim(),
      severity: String(alert?.severity || '').trim(),
      threshold: getAlertThreshold(alert),
      expirationDate: String(alert?.expirationDate || '').trim(),
      daysRemaining: Number.isFinite(Number(alert?.daysRemaining)) ? Number(alert.daysRemaining) : null
    }))
    .filter((alert) => alert.body || alert.docName);
}

function getAlertThreshold(alert) {
  const threshold = Number(alert?.threshold);
  if ([1, 30, 60].includes(threshold)) return threshold;
  if (alert?.severity === 'urgent') return 1;
  if (alert?.severity === 'critical') return 30;
  return 60;
}

function buildAlertDigestEmail({ alerts, user, notificationGroup = '' }) {
  const orderedAlerts = [...alerts].sort(compareEmailRecords);
  const userName = user?.nombre || user?.email || 'Usuario';
  const groupLabel = getNotificationGroupLabel(notificationGroup);
  const subject = `Compas Marine: ${orderedAlerts.length} alerta${orderedAlerts.length === 1 ? '' : 's'} documental${orderedAlerts.length === 1 ? '' : 'es'}${groupLabel ? ` - ${groupLabel}` : ''}`;
  const summary = groupLabel
    ? `Tienes ${orderedAlerts.length} documento${orderedAlerts.length === 1 ? '' : 's'} en la categoria "${groupLabel}".`
    : `Tienes ${orderedAlerts.length} alerta${orderedAlerts.length === 1 ? '' : 's'} documental${orderedAlerts.length === 1 ? '' : 'es'} en Compas Marine.`;

  const textLines = [
    `Hola ${userName},`,
    '',
    summary,
    '',
    ...orderedAlerts.map((alert, index) => `${index + 1}. ${alert.docName}: ${alert.body}`),
    '',
    'Ingresa a la app de Compas Marine para revisar el detalle.'
  ];

  const rows = orderedAlerts.map((alert) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#394049;">${escapeHtml(alert.docName)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#4b5563;">${escapeHtml(alert.body)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#921E30;font-weight:700;">${escapeHtml(getSeverityLabel(alert.severity))}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#394049;max-width:680px;margin:0 auto;">
      <h2 style="margin:0 0 12px;color:#921E30;">Alertas documentales</h2>
      <p>Hola <strong>${escapeHtml(userName)}</strong>, ${escapeHtml(summary)}</p>
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
  if (severity === 'urgent') return 'Expira pronto';
  if (severity === 'critical') return 'Critico';
  if (severity === 'warning') return 'Por vencer';
  return 'Alerta';
}

function getNotificationGroupLabel(group) {
  if (group === 'urgent') return 'expira en 1 día';
  if (group === 'critical') return 'aviso de 30 días';
  if (group === 'warning') return 'aviso de 60 días';
  return '';
}
