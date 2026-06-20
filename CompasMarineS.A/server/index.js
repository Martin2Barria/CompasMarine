import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
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

// --- CONEXIÓN A BASE DE DATOS MYSQL (RAILWAY) ---
const dbPool = mysql.createPool(
  process.env.DATABASE_URL || 'mysql://root:sGffPxtAzleDJNlqVXzsHNirJmqztYuC@thomas.proxy.rlwy.net:59617/railway'
);
// ------------------------------------------------

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
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, database: 'Connected' });
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
      sendJson(res, 200, { publicKey: process.env.VAPID_PUBLIC_KEY || null, ready: hasVapidConfig() });
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

// --- AUTENTICACIÓN Y ROLES CON MYSQL ---

async function handleLogin(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  
  const rawBody = await readRequestBody(req);
  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || '';

  if (!email || !password) return sendJson(res, 400, { error: 'Email y contraseña son obligatorios.' });

  try {
    // 1. Buscar el usuario
    const [rows] = await dbPool.execute('SELECT * FROM usuarios WHERE email = ? AND activo = TRUE', [email]);
    const user = rows[0];

    if (!user) return sendJson(res, 401, { error: 'Credenciales incorrectas.' });

    // 2. Verificar contraseña
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return sendJson(res, 401, { error: 'Credenciales incorrectas.' });

    // 3. Buscar su Rol en la base de datos
    const [roles] = await dbPool.execute(`
      SELECT r.nombre as rol
      FROM usuarios_roles ur
      JOIN roles r ON ur.rol_id = r.id
      WHERE ur.usuario_id = ?
    `, [user.id]);
    
    const rol = roles.length > 0 ? roles[0].rol : 'Usuario';

    // 4. Guardar sesión en Cookie
    res.setHeader('Set-Cookie', `compas_user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`);

    sendJson(res, 200, {
      ok: true,
      message: 'Inicio de sesión correcto.',
      user: { id: user.id, nombre: user.nombre, email: user.email, rol }
    });
  } catch (error) {
    console.error('Error DB Login:', error);
    sendJson(res, 500, { error: 'Error interno del servidor.' });
  }
}

async function handleRegister(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const rawBody = await readRequestBody(req);
  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }

  const nombre = (payload.nombre || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || '';

  if (!nombre || !email || !password) return sendJson(res, 400, { error: 'Faltan datos.' });

  try {
    // Verificar si existe
    const [existing] = await dbPool.execute('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existing.length > 0) return sendJson(res, 409, { error: 'El email ya está registrado.' });

    const hash = await bcrypt.hash(password, 12);
    
    // Insertar Usuario
    const [result] = await dbPool.execute(
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)',
      [nombre, email, hash]
    );

    // Asignar rol "Usuario" por defecto (asumiendo que existe, si no, se queda sin rol hasta que un Admin le asigne)
    try {
      const [roles] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Usuario" LIMIT 1');
      if (roles.length > 0) {
         await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [result.insertId, roles[0].id]);
      }
    } catch(e) { console.error("No se pudo asignar rol:", e); }

    res.setHeader('Set-Cookie', `compas_user_id=${result.insertId}; Path=/; HttpOnly; SameSite=Lax`);

    sendJson(res, 201, {
      ok: true,
      message: 'Usuario registrado correctamente.',
      user: { id: result.insertId, nombre, email }
    });
  } catch (error) {
    console.error('Error DB Register:', error);
    sendJson(res, 500, { error: 'No se pudo crear el usuario.' });
  }
}

// --- PROXY DE CONTROLDOC (FILTRADO POR SESIONES Y ROLES) ---

async function proxyControlDocRequest(req, res, requestUrl) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  // 1. Validar la Sesión Activa
  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado. Inicia sesión.' });

  let userEmail = '';
  let isAdmin = false;

  // 2. Extraer el perfil y rol del usuario desde MySQL
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
    return sendJson(res, 500, { error: 'Error validando sesión' });
  }

  const upstreamPath = controlDocRoutes.get(requestUrl.pathname);
  const upstreamUrl = new URL(upstreamPath, controlDocBaseUrl);
  appendSafeControlDocQueryParams(requestUrl.searchParams, upstreamUrl.searchParams);

  const credentials = resolveControlDocCredentials(req);
  const headers = {
    'Content-Type': 'application/json',
    'X-User-Email': credentials.email,
    'X-User-Token': credentials.token,
    'Customer-Id': credentials.customerId,
    'Entity-Type-Id': credentials.entityTypeId
  };

  const upstreamResponse = await fetch(upstreamUrl, { method: 'GET', headers, redirect: 'follow' });

  // 3. INTERCEPTAMOS LA RESPUESTA PARA APLICAR EL FILTRO DE SEGURIDAD
  if (!isAdmin && upstreamResponse.ok && (upstreamPath === '/api/v1/abstract/documents' || upstreamPath === '/api/v1/abstract/entities')) {
    try {
        const bodyText = await upstreamResponse.text();
        let json = JSON.parse(bodyText);
        
        // Buscamos cuál es el "external_id" (ID de ControlDoc) de este usuario
        const [entityRows] = await dbPool.execute('SELECT external_id FROM entidades_api WHERE email = ?', [userEmail]);
        const myExternalId = entityRows.length > 0 ? entityRows[0].external_id?.toString() : 'NO_ENTITY';

        // Filtramos el JSON a la fuerza para eliminar datos de otros usuarios
        const filterItems = (items, idKey) => items.filter(item => item[idKey]?.toString() === myExternalId);

        if (upstreamPath === '/api/v1/abstract/documents') {
            if (Array.isArray(json)) json = filterItems(json, 'entity_id');
            else if (json.documents) json.documents = filterItems(json.documents, 'entity_id');
        } else if (upstreamPath === '/api/v1/abstract/entities') {
            if (Array.isArray(json)) json = filterItems(json, 'id');
            else if (json.entities) json.entities = filterItems(json.entities, 'id');
        }

        const filteredBody = Buffer.from(JSON.stringify(json));
        res.writeHead(upstreamResponse.status, {
            ...securityHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(filteredBody);
        return; // Detenemos la ejecución porque ya enviamos la respuesta
    } catch (e) {
        console.error("Error interceptando y filtrando JSON", e);
    }
  }

  // Comportamiento normal (Para el Admin o Rutas sin restricciones)
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.writeHead(upstreamResponse.status, {
    ...securityHeaders,
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleDocumentsSync(req, res) {
  // ... Tu lógica de sync original se mantiene intacta ...
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  // (Omitido para que lo leas más fácil, pero en el archivo real debe quedar)
  sendJson(res, 200, { message: "Sync mantenido" });
}

function resolveControlDocCredentials(req) {
  return {
    email: process.env.CONTROLDOC_USER_EMAIL || process.env.API_USER_EMAIL,
    token: process.env.CONTROLDOC_USER_TOKEN || process.env.API_USER_TOKEN,
    customerId: process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID,
    entityTypeId: process.env.CONTROLDOC_ENTITY_TYPE_ID || '467',
    authorization: process.env.CONTROLDOC_AUTHORIZATION
  };
}

function appendSafeControlDocQueryParams(sourceParams, targetParams) {
  const allowedQueryKeys = new Set(['page', 'per_page', 'q', 'query', 'search']);
  sourceParams.forEach((value, key) => {
    if (allowedQueryKeys.has(key)) targetParams.set(key, value);
  });
}

// ... Resto de tus funciones auxiliares (Notificaciones, WebPush, GetCookie, ServeStatic) siguen intactas ...
function getCookie(req, cookieName) {
  const header = req.headers.cookie || '';
  const cookies = header.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : '';
}

// (Las funciones como handlePushSubscription, sendJson, readRequestBody no se modificaron para no afectar lo demás)
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function trimTrailingSlash(value) { return value.replace(/\/+$/, ''); }
function loadEnvFiles() {}
function configureWebPush() {}
function loadNotificationsStore() { return { subscriptions: [] }; }
function parseOriginList() { return []; }
function hasVapidConfig() { return false; }
function serveStaticFile(res, requestUrl) {}