import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import webPush from 'web-push';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '..');
const distDir = resolve(appRoot, 'dist');
const usersStorePath = resolve(appRoot, 'server', 'users.json');
const notificationsStorePath = resolve(appRoot, 'server', 'notifications.json');

loadEnvFiles([
  '.env.server.local',
  '.env.server',
  '.env.local',
  '.env'
]);

const port = Number(process.env.SERVER_PORT || process.env.PORT || 8787);
const host = process.env.SERVER_HOST || '0.0.0.0';
const controlDocBaseUrl = trimTrailingSlash(
  process.env.CONTROLDOC_BASE_URL || 'https://compliance.controldoc.legal'
);

const controlDocRoutes = new Map([
  ['/api/controldoc/document-types', '/api/v1/abstract/document_types'],
  ['/api/controldoc/entities', '/api/v1/abstract/entities'],
  ['/api/controldoc/documents', '/api/v1/abstract/documents']
]);

configureWebPush();

const notificationStore = loadNotificationsStore();
const pushSubscriptions = new Map(
  notificationStore.subscriptions.map((record) => [record.endpoint, record])
);
const configuredAllowedOrigins = parseOriginList(process.env.APP_ALLOWED_ORIGINS);
const pushTestEndpointEnabled = process.env.ENABLE_PUSH_TEST_ENDPOINT === 'true';
const rateLimitBuckets = new Map();

const MAX_NOTIFICATION_TITLE_LENGTH = 80;
const MAX_NOTIFICATION_BODY_LENGTH = 180;
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

// --- VARIABLES GLOBALES DE CACHÉ PARA SINCRONIZACIÓN MASIVA ---
let documentsSyncCache = null;
let lastDocumentsSyncTime = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos
let isSyncing = false;
// --------------------------------------------------------------

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === '/api/auth/register') {
      await handleRegister(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/auth/login') {
      await handleLogin(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/notifications/vapid-public-key') {
      sendJson(res, 200, {
        publicKey: process.env.VAPID_PUBLIC_KEY || null,
        ready: hasVapidConfig()
      });
      return;
    }

    if (requestUrl.pathname === '/api/notifications/subscriptions') {
      await handlePushSubscription(req, res);
      return;
    }

    if (requestUrl.pathname === '/api/notifications/test') {
      await handlePushTest(req, res);
      return;
    }

    // --- NUEVA RUTA INTERCEPTADA: Sincronización Masiva ---
    if (requestUrl.pathname === '/api/controldoc/documents/sync') {
      await handleDocumentsSync(req, res);
      return;
    }
    // ------------------------------------------------------

    if (controlDocRoutes.has(requestUrl.pathname)) {
      await proxyControlDocRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'API route not found' });
      return;
    }

    serveStaticFile(res, requestUrl);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, host, () => {
  console.log(`Compas Marine server listening on http://${host}:${port}`);
});

// --- FUNCIÓN DE VOLCADO MASIVO Y CACHÉ (NUEVO) ---
async function handleDocumentsSync(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const now = Date.now();
  if (documentsSyncCache && lastDocumentsSyncTime && (now - lastDocumentsSyncTime < CACHE_DURATION_MS)) {
    console.log('Retornando documentos masivos desde la caché de Railway...');
    sendJson(res, 200, documentsSyncCache);
    return;
  }

  if (isSyncing) {
    if (documentsSyncCache) {
      sendJson(res, 200, documentsSyncCache);
    } else {
      sendJson(res, 503, { error: 'Sincronizando base de datos inicial, intenta en 10 segundos.' });
    }
    return;
  }

  isSyncing = true;

  try {
    console.log('Iniciando volcado masivo de documentos desde CDOC...');
    const credentials = resolveControlDocCredentials(req);

    if (!credentials.email || !credentials.token || !credentials.customerId || !credentials.entityTypeId) {
      sendJson(res, 500, { error: 'Credenciales incompletas en el servidor' });
      return;
    }

    const upstreamPath = '/api/v1/abstract/documents';
    const headers = {
      'Content-Type': 'application/json',
      'X-User-Email': credentials.email,
      'X-User-Token': credentials.token,
      'Customer-Id': credentials.customerId,
      'Entity-Type-Id': credentials.entityTypeId
    };

    if (credentials.authorization) {
      headers.AUTHORIZATION = credentials.authorization;
    }

    let allItems = [];
    let page = 1;
    let hasMore = true;
    const MAX_PAGES = 500;

    while (hasMore && page <= MAX_PAGES) {
      const upstreamUrl = new URL(upstreamPath, controlDocBaseUrl);
      upstreamUrl.searchParams.append('page', page);
      upstreamUrl.searchParams.append('per_page', '100');

      const response = await fetch(upstreamUrl, { method: 'GET', headers, redirect: 'follow' });

      if (response.status === 429) {
        console.warn(`Límite 429 en página ${page}. Pausando 2 segundos...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!response.ok) throw new Error(`Error HTTP ${response.status}`);

      const json = await response.json();
      let items = Array.isArray(json) ? json : (Object.keys(json).find(k => Array.isArray(json[k])) ? json[Object.keys(json).find(k => Array.isArray(json[k]))] : []);

      if (!items || items.length === 0) {
        hasMore = false;
      } else {
        allItems.push(...items);
        page++;
        await new Promise(r => setTimeout(r, 150)); 
      }
    }

    documentsSyncCache = allItems;
    lastDocumentsSyncTime = Date.now();
    console.log(`¡Volcado completo! ${allItems.length} documentos en memoria.`);
    
    sendJson(res, 200, allItems);
  } catch (error) {
    console.error('Error sincronización:', error);
    sendJson(res, 500, { error: 'Fallo al sincronizar' });
  } finally {
    isSyncing = false; 
  }
}
// -------------------------------------------------

async function proxyControlDocRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const upstreamPath = controlDocRoutes.get(requestUrl.pathname);
  const credentials = resolveControlDocCredentials(req);

  if (!credentials.email || !credentials.token || !credentials.customerId || !credentials.entityTypeId) {
    sendJson(res, 500, {
      error: 'ControlDoc credentials are not configured on the server'
    });
    return;
  }

  const upstreamUrl = new URL(upstreamPath, controlDocBaseUrl);
  appendSafeControlDocQueryParams(requestUrl.searchParams, upstreamUrl.searchParams);

  const headers = {
    'Content-Type': 'application/json',
    'X-User-Email': credentials.email,
    'X-User-Token': credentials.token,
    'Customer-Id': credentials.customerId,
    'Entity-Type-Id': credentials.entityTypeId
  };

  if (credentials.authorization) {
    headers.AUTHORIZATION = credentials.authorization;
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'GET',
    headers,
    redirect: 'follow'
  });

  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.writeHead(upstreamResponse.status, {
    ...securityHeaders,
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function resolveControlDocCredentials(req) {
  const byUser = parseJsonEnv('CONTROLDOC_USER_CREDENTIALS_JSON');
  const cookieUserId = getCookie(req, 'compas_user_id');
  const requestedUserId = cookieUserId || process.env.CONTROLDOC_DEFAULT_USER_ID;

  if (byUser && typeof byUser === 'object') {
    const profile =
      byUser[requestedUserId] ||
      byUser[process.env.CONTROLDOC_DEFAULT_USER_ID] ||
      Object.values(byUser)[0];

    if (profile) {
      return normalizeCredentialProfile(profile);
    }
  }

  return normalizeCredentialProfile({
    email: process.env.CONTROLDOC_USER_EMAIL || process.env.API_USER_EMAIL,
    token: process.env.CONTROLDOC_USER_TOKEN || process.env.API_USER_TOKEN,
    customerId: process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID,
    entityTypeId:
      process.env.CONTROLDOC_ENTITY_TYPE_ID ||
      process.env.CONTROLDOC_DEFAULT_ENTITY_TYPE_ID ||
      '467',
    authorization: process.env.CONTROLDOC_AUTHORIZATION
  });
}

function normalizeCredentialProfile(profile) {
  return {
    email: profile.email || profile.userEmail || '',
    token: profile.token || profile.userToken || '',
    customerId:
      profile.customerId ||
      profile.customer_id ||
      process.env.CONTROLDOC_CUSTOMER_ID ||
      process.env.API_CUSTOMER_ID ||
      '',
    entityTypeId:
      profile.entityTypeId ||
      profile.entity_type_id ||
      process.env.CONTROLDOC_ENTITY_TYPE_ID ||
      process.env.CONTROLDOC_DEFAULT_ENTITY_TYPE_ID ||
      '467',
    authorization: profile.authorization || process.env.CONTROLDOC_AUTHORIZATION || ''
  };
}

function appendSafeControlDocQueryParams(sourceParams, targetParams) {
  const allowedQueryKeys = new Set(['page', 'per_page', 'q', 'query', 'search']);

  sourceParams.forEach((value, key) => {
    if (!allowedQueryKeys.has(key)) return;

    if (key === 'page') {
      const page = clampInteger(value, 1, 500);
      targetParams.set(key, String(page));
      return;
    }

    if (key === 'per_page') {
      const perPage = clampInteger(value, 1, 100);
      targetParams.set(key, String(perPage));
      return;
    }

    const safeValue = stripControlCharacters(value).trim().slice(0, 120);
    if (safeValue) targetParams.set(key, safeValue);
  });
}

function clampInteger(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

async function handlePushSubscription(req, res) {
  if (!requireSameOriginRequest(req, res)) return;

  if (req.method === 'GET') {
    sendJson(res, 200, {
      count: pushSubscriptions.size,
      pushReady: hasVapidConfig()
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'push-subscription', 20, 15 * 60 * 1000)) return;

  const rawBody = await readRequestBody(req);
  let payload;

  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const subscription = payload.subscription || payload;
  const safeSubscription = normalizePushSubscription(subscription);

  if (!safeSubscription) {
    sendJson(res, 400, { error: 'Invalid push subscription' });
    return;
  }

  const userId = resolveNotificationUserId(req);
  const record = {
    userId,
    endpoint: safeSubscription.endpoint,
    subscription: safeSubscription,
    createdAt: pushSubscriptions.get(safeSubscription.endpoint)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  pushSubscriptions.set(safeSubscription.endpoint, record);
  saveNotificationsStore();

  sendJson(res, 202, {
    ok: true,
    userId,
    count: pushSubscriptions.size,
    pushReady: hasVapidConfig(),
    message: hasVapidConfig()
      ? 'Subscription stored.'
      : 'Subscription stored. Configure VAPID keys before production push delivery.'
  });
}

async function handlePushTest(req, res) {
  if (!pushTestEndpointEnabled) {
    sendJson(res, 404, { error: 'API route not found' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!requireSameOriginRequest(req, res)) return;
  if (!requireJsonRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'push-test', 5, 10 * 60 * 1000)) return;

  let payload;
  const rawBody = await readRequestBody(req);

  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const userId = resolveNotificationUserId(req);
  const result = await sendPushToUser(userId, normalizeNotificationPayload(payload));

  sendJson(res, result.sent > 0 ? 202 : 200, {
    ok: result.sent > 0,
    userId,
    ...result
  });
}

async function sendPushToUser(userId, payload) {
  if (!hasVapidConfig()) {
    return {
      sent: 0,
      failed: 0,
      reason: 'VAPID keys are not configured.'
    };
  }

  const records = [...pushSubscriptions.values()].filter((record) => record.userId === userId);

  if (records.length === 0) {
    return {
      sent: 0,
      failed: 0,
      reason: 'No push subscriptions for this user.'
    };
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(records.map(async (record) => {
    try {
      await webPush.sendNotification(record.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      failed += 1;

      if (error.statusCode === 404 || error.statusCode === 410) {
        pushSubscriptions.delete(record.endpoint);
        removed += 1;
      } else {
        console.warn('Push delivery failed:', error.message);
      }
    }
  }));

  if (removed > 0) saveNotificationsStore();

  return {
    sent,
    failed,
    removed
  };
}

function configureWebPush() {
  if (!hasVapidConfig()) return;

  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:soporte@compasmarine.cl',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function hasVapidConfig() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function resolveNotificationUserId(req) {
  return getCookie(req, 'compas_user_id') || process.env.CONTROLDOC_DEFAULT_USER_ID || 'demo';
}

function normalizePushSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return null;
  if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048) return null;

  let endpointUrl;
  try {
    endpointUrl = new URL(subscription.endpoint);
  } catch {
    return null;
  }

  if (endpointUrl.protocol !== 'https:') return null;

  const keys = subscription.keys || {};
  if (!isReasonablePushKey(keys.p256dh, 40, 512)) return null;
  if (!isReasonablePushKey(keys.auth, 8, 256)) return null;

  return {
    endpoint: endpointUrl.toString(),
    expirationTime: typeof subscription.expirationTime === 'number' ? subscription.expirationTime : null,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth
    }
  };
}

function isReasonablePushKey(value, minLength, maxLength) {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function normalizeNotificationPayload(payload = {}) {
  return {
    title: cleanNotificationText(payload.title, 'Compas Marine', MAX_NOTIFICATION_TITLE_LENGTH),
    body: cleanNotificationText(
      payload.body,
      'Notificacion push de prueba enviada desde el servidor.',
      MAX_NOTIFICATION_BODY_LENGTH
    ),
    url: normalizeNotificationUrl(payload.url)
  };
}

function cleanNotificationText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;

  const cleanValue = value
    .split('')
    .map((character) => isControlCharacter(character) ? ' ' : character)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return cleanValue ? cleanValue.slice(0, maxLength) : fallback;
}

function normalizeNotificationUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/notificaciones';
  }

  try {
    const url = new URL(value, 'https://app.local');
    if (url.origin !== 'https://app.local') return '/notificaciones';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/notificaciones';
  }
}

function requireSameOriginRequest(req, res) {
  if (isAllowedRequestOrigin(req)) return true;

  sendJson(res, 403, { error: 'Forbidden origin' });
  return false;
}

function isAllowedRequestOrigin(req) {
  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) {
    return process.env.NODE_ENV !== 'production';
  }

  return getAllowedOriginsForRequest(req).has(requestOrigin);
}

function getRequestOrigin(req) {
  if (typeof req.headers.origin === 'string') {
    return req.headers.origin;
  }

  if (typeof req.headers.referer === 'string') {
    try {
      return new URL(req.headers.referer).origin;
    } catch {
      return '';
    }
  }

  return '';
}

function getAllowedOriginsForRequest(req) {
  const allowedOrigins = new Set(configuredAllowedOrigins);
  const requestHost = req.headers['x-forwarded-host'] || req.headers.host;

  if (requestHost) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : 'https';
    allowedOrigins.add(`${protocol}://${requestHost}`);
    allowedOrigins.add(`https://${requestHost}`);
    allowedOrigins.add(`http://${requestHost}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  return allowedOrigins;
}

function parseOriginList(value = '') {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function requireJsonRequest(req, res) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.toLowerCase().includes('application/json')) return true;

  sendJson(res, 415, { error: 'Content-Type must be application/json' });
  return false;
}

function consumeRateLimit(req, res, bucketName, limit, windowMs) {
  const now = Date.now();
  const key = `${bucketName}:${getClientIp(req)}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    res.writeHead(429, {
      ...securityHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000))
    });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return false;
  }

  bucket.count += 1;
  return true;
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function stripControlCharacters(value) {
  return value
    .split('')
    .filter((character) => !isControlCharacter(character))
    .join('');
}

function isControlCharacter(character) {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
}

function loadNotificationsStore() {
  if (!existsSync(notificationsStorePath)) {
    return {
      subscriptions: []
    };
  }

  try {
    const fileContent = readFileSync(notificationsStorePath, 'utf8');
    const parsed = JSON.parse(fileContent);

    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []
    };
  } catch {
    return {
      subscriptions: []
    };
  }
}

function saveNotificationsStore() {
  const nextStore = {
    subscriptions: [...pushSubscriptions.values()]
  };

  writeFileSync(notificationsStorePath, JSON.stringify(nextStore, null, 2), 'utf8');
}

async function handleRegister(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rawBody = await readRequestBody(req);
  let payload;

  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const nombre = (payload.nombre || payload.name || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || '';

  if (!nombre || !email || !password) {
    sendJson(res, 400, { error: 'Nombre, email y contraseña son obligatorios.' });
    return;
  }

  if (password.length < 8) {
    sendJson(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
    return;
  }

  const users = loadUsersStore();
  const exists = users.some((user) => user.email === email);

  if (exists) {
    sendJson(res, 409, { error: 'El email ya está registrado.' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = {
      id: Date.now(),
      nombre,
      email,
      passwordHash,
      activo: true,
      creado_en: new Date().toISOString()
    };

    users.push(newUser);
    saveUsersStore(users);

    sendJson(res, 201, {
      ok: true,
      message: 'Usuario registrado correctamente.',
      user: {
        id: newUser.id,
        nombre: newUser.nombre,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Error registrando usuario:', error);
    sendJson(res, 500, { error: 'No se pudo crear el usuario.' });
  }
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rawBody = await readRequestBody(req);
  let payload;

  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || '';

  if (!email || !password) {
    sendJson(res, 400, { error: 'Email y contraseña son obligatorios.' });
    return;
  }

  const users = loadUsersStore();
  const user = users.find((item) => item.email === email);

  if (!user) {
    sendJson(res, 401, { error: 'Credenciales incorrectas.' });
    return;
  }

  try {
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      sendJson(res, 401, { error: 'Credenciales incorrectas.' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      message: 'Inicio de sesión correcto.',
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error validando usuario:', error);
    sendJson(res, 500, { error: 'No se pudo iniciar sesión.' });
  }
}

function loadUsersStore() {
  if (!existsSync(usersStorePath)) {
    return [];
  }

  try {
    const fileContent = readFileSync(usersStorePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUsersStore(users) {
  writeFileSync(usersStorePath, JSON.stringify(users, null, 2), 'utf8');
}

function serveStaticFile(res, requestUrl) {
  if (!existsSync(distDir)) {
    sendJson(res, 404, {
      error: 'Build output not found. Run npm run build before using the production server.'
    });
    return;
  }

  const rawPath = requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname);
  let filePath = normalize(join(distDir, rawPath));

  if (!filePath.startsWith(distDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        rejectBody(new Error('Request body too large'));
      }
    });

    req.on('end', () => resolveBody(body));
    req.on('error', rejectBody);
  });
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = join(appRoot, fileName);
    if (!existsSync(filePath)) continue;

    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseJsonEnv(key) {
  if (!process.env[key]) return null;

  try {
    return JSON.parse(process.env[key]);
  } catch {
    console.warn(`${key} is not valid JSON`);
    return null;
  }
}

function getCookie(req, cookieName) {
  const header = req.headers.cookie || '';
  const cookies = header.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : '';
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
