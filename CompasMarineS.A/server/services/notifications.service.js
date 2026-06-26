import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';
import { dbPool } from '../config/db.js';
import { sendJson, readRequestBody, getCookie, requireJsonRequest } from '../utils/http.js';
import { requireSameOriginRequest, consumeRateLimit } from '../utils/security.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '../..');
const notificationsStorePath = resolve(appRoot, 'server', 'notifications.json');

function loadNotificationsStore() {
  if (!existsSync(notificationsStorePath)) return { subscriptions: [] };
  try { return { subscriptions: JSON.parse(readFileSync(notificationsStorePath, 'utf8')).subscriptions || [] }; } 
  catch { return { subscriptions: [] }; }
}

const pushSubscriptions = new Map(loadNotificationsStore().subscriptions.map((record) => [record.endpoint, record]));

function saveNotificationsStore() {
  writeFileSync(notificationsStorePath, JSON.stringify({ subscriptions: [...pushSubscriptions.values()] }, null, 2), 'utf8');
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
  saveNotificationsStore();

  sendJson(res, 202, { ok: true, userId, count: pushSubscriptions.size, pushReady: hasVapidConfig() });
}

export async function handlePushTest(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'push-test', 5, 10 * 60 * 1000)) return;

  const userId = getCookie(req, 'compas_user_id') || 'demo';
  if (!hasVapidConfig()) return sendJson(res, 200, { ok: false, reason: 'VAPID no configurado' });

  const records = [...pushSubscriptions.values()].filter(r => r.userId === userId);
  if (records.length === 0) return sendJson(res, 200, { ok: false, reason: 'Sin subscripciones' });

  let sent = 0;
  await Promise.all(records.map(async (record) => {
    try {
      await webPush.sendNotification(record.subscription, JSON.stringify({ title: 'Prueba', body: 'Test' }));
      sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { pushSubscriptions.delete(record.endpoint); }
    }
  }));

  saveNotificationsStore();
  sendJson(res, sent > 0 ? 202 : 200, { ok: sent > 0, sent });
}

export async function handleEmailAlerts(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'email-alerts', 5, 60 * 60 * 1000)) return;

  const userId = getCookie(req, 'compas_user_id');
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });

  let userEmail = '';
  try {
    const [rows] = await dbPool.execute('SELECT email FROM usuarios WHERE id = ?', [userId]);
    userEmail = rows[0]?.email || '';
  } catch(e) {}

  if (!userEmail) return sendJson(res, 400, { error: 'Correo no resuelto' });

  // Stub de Resend (la lógica de la API la puedes agregar luego si la necesitas)
  sendJson(res, 202, { ok: true, sent: 1, provider: 'stub' });
}