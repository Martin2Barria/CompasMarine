import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import webPush from 'web-push';
import mysql from 'mysql2/promise';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '..');
const distDir = resolve(appRoot, 'dist');
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

// --- CONEXIÓN MYSQL RAILWAY ---
const dbPool = mysql.createPool(
  process.env.DATABASE_URL || 'mysql://root:sGffPxtAzleDJNlqVXzsHNirJmqztYuC@thomas.proxy.rlwy.net:59617/railway'
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

let documentsSyncCache = null;
let lastDocumentsSyncTime = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; 
let isSyncing = false;

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

    // --- NUEVO ENDPOINT: Sincronizar Usuarios a MySQL ---
    if (requestUrl.pathname === '/api/admin/sync-users') {
      await handleSyncUsersToDB(req, res);
      return;
    }
    // --------------------------------------------------

    if (requestUrl.pathname === '/api/controldoc/documents/sync') {
      await handleDocumentsSync(req, res);
      return;
    }

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

// --- SINCRONIZADOR DE USUARIOS (API -> MYSQL) ---
async function handleSyncUsersToDB(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  
  try {
    console.log("Iniciando descarga de usuarios desde ControlDoc...");
    const credentials = resolveControlDocCredentials(req);
    if (!credentials.email || !credentials.token || !credentials.customerId || !credentials.entityTypeId) {
      return sendJson(res, 500, { error: 'Credenciales incompletas.' });
    }

    const upstreamPath = '/api/v1/abstract/entities';
    const headers = {
      'Content-Type': 'application/json',
      'X-User-Email': credentials.email,
      'X-User-Token': credentials.token,
      'Customer-Id': credentials.customerId,
      'Entity-Type-Id': credentials.entityTypeId
    };
    if (credentials.authorization) headers.AUTHORIZATION = credentials.authorization;

    let allEntities = [];
    let page = 1;
    let hasMore = true;

    // 1. Descargar todas las páginas
    while (hasMore && page <= 50) {
      const url = new URL(upstreamPath, controlDocBaseUrl);
      url.searchParams.append('page', page);
      url.searchParams.append('per_page', '100');

      const response = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`);

      const json = await response.json();
      let items = Array.isArray(json) ? json : (json.entities || []);

      if (items.length === 0) {
        hasMore = false;
      } else {
        allEntities.push(...items);
        page++;
        await new Promise(r => setTimeout(r, 200)); 
      }
    }

    console.log(`Descarga completa: ${allEntities.length} usuarios obtenidos. Guardando en MySQL...`);

    // 2. Guardar/Actualizar en MySQL
    let insertados = 0;
    for (const entity of allEntities) {
      const external_id = entity.id?.toString();
      if (!external_id) continue;

      const nombre = entity.full_name || entity.name || 'Sin Nombre';
      // ControlDoc a veces guarda el RUT en "identifier" o "rut"
      const rut = entity.rut || entity.identifier || null;
      const email = entity.email ? entity.email.toLowerCase() : null;
      const jsonString = JSON.stringify(entity);

      // Usamos INSERT ... ON DUPLICATE KEY UPDATE para no crear duplicados si corres esto 2 veces
      await dbPool.execute(`
        INSERT INTO entidades_api (external_id, nombre, rut, email, customer_id, entity_type_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        nombre = VALUES(nombre), rut = VALUES(rut), email = VALUES(email), data_json = VALUES(data_json), sincronizado_en = CURRENT_TIMESTAMP
      `, [external_id, nombre, rut, email, credentials.customerId, credentials.entityTypeId, jsonString]);
      
      insertados++;
    }

    sendJson(res, 200, { ok: true, message: `Sincronización exitosa. ${insertados} usuarios guardados/actualizados en MySQL.` });
  } catch (error) {
    console.error('Error sincronizando usuarios:', error);
    sendJson(res, 500, { error: 'Fallo al sincronizar usuarios.' });
  }
}

// --- PROXY DE CONTROLDOC ULTRA OPTIMIZADO ---

async function proxyControlDocRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado. Inicia sesión.' });

  let userEmail = '';
  let isAdmin = false;

  try {
    const [userRows] = await dbPool.execute(`
      SELECT u.email, r.nombre as rol 
      FROM usuarios u 
      LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id 
      LEFT JOIN roles r ON ur.rol_id = r.id 
      WHERE u.id = ? AND u.activo = TRUE
    `, [cookieUserId]);
    
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario inválido o inactivo.' });
    userEmail = userRows[0].email;
    isAdmin = userRows[0].rol?.toLowerCase() === 'admin';
  } catch (error) {
    console.error('Error validando sesión:', error);
    return sendJson(res, 500, { error: 'Error interno validando sesión' });
  }

  const upstreamPath = controlDocRoutes.get(requestUrl.pathname);
  const upstreamUrl = new URL(upstreamPath, controlDocBaseUrl);
  appendSafeControlDocQueryParams(requestUrl.searchParams, upstreamUrl.searchParams);

  let myExternalId = null;

  // Filtro mágico: Si no es admin, filtramos por URL
  if (!isAdmin) {
    try {
      const [entityRows] = await dbPool.execute('SELECT external_id FROM entidades_api WHERE email = ?', [userEmail]);
      myExternalId = entityRows.length > 0 ? entityRows[0].external_id?.toString() : 'NO_ENTITY';
      
      if (upstreamPath === '/api/v1/abstract/documents') {
        upstreamUrl.searchParams.set('entity_id', myExternalId);
      }
    } catch (e) { console.error("Error buscando external_id", e); }
  }

  const credentials = resolveControlDocCredentials(req);
  if (!credentials.email || !credentials.token || !credentials.customerId || !credentials.entityTypeId) {
    sendJson(res, 500, { error: 'ControlDoc credentials are not configured on the server' });
    return;
  }

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

  const upstreamResponse = await fetch(upstreamUrl, { method: 'GET', headers, redirect: 'follow' });

  // Si no es admin y pidió la lista de usuarios, la recortamos a la fuerza
  if (!isAdmin && upstreamResponse.ok && upstreamPath === '/api/v1/abstract/entities') {
      try {
          const bodyText = await upstreamResponse.text();
          let json = JSON.parse(bodyText);
          const filterItems = (items) => items.filter(item => item.id?.toString() === myExternalId);
          if (Array.isArray(json)) json = filterItems(json);
          else if (json.entities) json.entities = filterItems(json.entities);

          const filteredBody = Buffer.from(JSON.stringify(json));
          res.writeHead(upstreamResponse.status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(filteredBody);
          return; 
      } catch (e) {
          console.error("Error filtrando JSON", e);
      }
  }

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
    customerId: profile.customerId || profile.customer_id || process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID || '',
    entityTypeId: profile.entityTypeId || profile.entity_type_id || process.env.CONTROLDOC_ENTITY_TYPE_ID || process.env.CONTROLDOC_DEFAULT_ENTITY_TYPE_ID || '467',
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

// --- DESACTIVAR REGISTRO MANUAL ---
async function handleRegister(req, res) {
  // Ya no se permite registro manual.
  sendJson(res, 403, { error: 'El registro manual está deshabilitado. Inicie sesión utilizando su Email y RUT.' });
}

// --- LOGIN AUTOMÁTICO VÍA API / RUT ---
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
  const password = payload.password || ''; // En este caso, asumimos que el usuario escribió su RUT aquí

  if (!email || !password) {
    sendJson(res, 400, { error: 'Email y contraseña/RUT son obligatorios.' });
    return;
  }

  try {
    // 1. Verificamos si ya existe en la tabla de usuarios (ej: Administradores)
    const [rows] = await dbPool.execute('SELECT * FROM usuarios WHERE email = ? AND activo = TRUE', [email]);
    
    if (rows.length > 0) {
        const user = rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (isValid) {
            // Login normal de alguien que ya estaba registrado
            const [roles] = await dbPool.execute('SELECT r.nombre as rol FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [user.id]);
            const rol = roles.length > 0 ? roles[0].rol : 'Usuario';
            
            res.setHeader('Set-Cookie', `compas_user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { ok: true, message: 'Inicio de sesión correcto.', user: { id: user.id, nombre: user.nombre, email: user.email, rol } });
        }
    }

    // 2. Si no es Admin o falló, validamos contra la Data de ControlDoc (Login por RUT)
    const [entityRows] = await dbPool.execute('SELECT * FROM entidades_api WHERE email = ?', [email]);
    
    if (entityRows.length > 0) {
        const entidad = entityRows[0];
        
        // Limpiamos formatos para comparar solo letras/numeros (12.345.678-9 pasa a 123456789)
        const rutDB = entidad.rut ? entidad.rut.replace(/[^0-9kK]/g, '').toLowerCase() : null;
        const inputRut = password.replace(/[^0-9kK]/g, '').toLowerCase();

        if (rutDB && rutDB === inputRut) {
            // El RUT ES CORRECTO. Vamos a crearle su sesión automáticamente
            let userIdToLogin;
            
            if (rows.length === 0) {
                // Creamos el registro en la tabla usuarios de forma transparente para que quede guardado
                const hash = await bcrypt.hash(password, 12); // Guardamos el RUT hasheado
                const [insertResult] = await dbPool.execute(
                    'INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', 
                    [entidad.nombre || email, email, hash]
                );
                userIdToLogin = insertResult.insertId;
                
                // Le asignamos el rol básico
                try {
                    const [roles] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Usuario" LIMIT 1');
                    if (roles.length > 0) {
                        await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [userIdToLogin, roles[0].id]);
                    }
                } catch(e) { console.error("Error asignando rol", e); }
            } else {
                userIdToLogin = rows[0].id; // El usuario existía pero usamos su RUT
            }

            res.setHeader('Set-Cookie', `compas_user_id=${userIdToLogin}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { ok: true, message: 'Sesión iniciada.', user: { id: userIdToLogin, nombre: entidad.nombre, email: email, rol: 'Usuario' } });
        }
    }

    // Si todo falla
    sendJson(res, 401, { error: 'Credenciales incorrectas o correo no registrado en ControlDoc.' });
  } catch (error) {
    console.error('Error validando usuario:', error);
    sendJson(res, 500, { error: 'No se pudo iniciar sesión.' });
  }
}

// --- FUNCIONES UTILITARIAS Y DE NOTIFICACIONES ---

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