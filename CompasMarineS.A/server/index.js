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

const dbPool = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

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

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

// --- CACHÉ ULTRA RÁPIDA (BLINDADA) ---
const serverCache = {
  documentTypes: { data: [], expiresAt: 0 },
  entities: { data: [], expiresAt: 0 },
  documents: { data: [], expiresAt: 0 } 
};
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 horas

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
    const cleanPath = requestUrl.pathname.replace(/\/$/, ''); // Limpiamos slashes finales

    if (cleanPath === '/api/health') return sendJson(res, 200, { ok: true });
    if (cleanPath === '/api/auth/register') return await handleRegister(req, res);
    if (cleanPath === '/api/auth/login') return await handleLogin(req, res);
    if (cleanPath === '/api/auth/me') return await handleAuthMe(req, res);
    if (cleanPath === '/api/notifications/vapid-public-key') return sendJson(res, 200, { publicKey: process.env.VAPID_PUBLIC_KEY || null, ready: hasVapidConfig() });
    if (cleanPath === '/api/notifications/subscriptions') return await handlePushSubscription(req, res);
    if (cleanPath === '/api/notifications/test') return await handlePushTest(req, res);
    if (cleanPath === '/api/admin/setup-db') return await handleSetupDB(req, res);
    if (cleanPath === '/api/admin/sync-users') return await handleSyncUsersToDB(req, res);
    if (cleanPath === '/api/controldoc/documents/sync') return await handleDocumentsSync(req, res);

    if (controlDocRoutes.has(cleanPath)) {
      return await proxyControlDocRequest(req, res, requestUrl, cleanPath);
    }

    if (cleanPath.startsWith('/api/')) return sendJson(res, 404, { error: 'API route not found' });

    serveStaticFile(res, requestUrl);
  } catch (error) {
    console.error("Error crítico global:", error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, host, () => {
  console.log(`Compas Marine server listening on http://${host}:${port}`);
});

// --- DESCARGA CONCURRENTE SEGURA ---
async function fetchAllControlDocPages(upstreamPath, credentials) {
  let allItems = [];
  try {
    let currentPage = 1;
    let hasMore = true;
    
    const headers = {
      'Content-Type': 'application/json',
      'X-User-Email': credentials.email || '',
      'X-User-Token': credentials.token || '',
      'Customer-Id': credentials.customerId || '',
      'Entity-Type-Id': credentials.entityTypeId || ''
    };
    if (credentials.authorization) headers.AUTHORIZATION = credentials.authorization;

    while (hasMore && currentPage <= 30) { // Límite de seguridad
      const batchPromises = [];
      
      for (let i = 0; i < 3; i++) { // Max 3 a la vez para no bloquear API
        const page = currentPage + i;
        const url = new URL(upstreamPath, controlDocBaseUrl);
        url.searchParams.append('page', page);
        url.searchParams.append('per_page', '100');

        batchPromises.push(
          fetch(url, { method: 'GET', headers, redirect: 'follow' })
            .then(async res => {
              if (res.status === 429) {
                await new Promise(r => setTimeout(r, 1500));
                return fetch(url, { method: 'GET', headers }).then(r => r.ok ? r.json() : null).catch(() => null);
              }
              if (!res.ok) return null;
              return res.json().catch(() => null);
            })
            .catch(() => null)
        );
      }

      const batchResults = await Promise.all(batchPromises);
      
      for (const json of batchResults) {
        if (!json) { hasMore = false; continue; }
        
        let items = [];
        if (Array.isArray(json)) {
          items = json;
        } else if (typeof json === 'object') {
          const foundArray = Object.values(json).find(v => Array.isArray(v));
          items = foundArray || [];
        }

        if (items.length === 0) {
          hasMore = false;
        } else {
          allItems.push(...items);
          if (items.length < 25) hasMore = false; 
        }
      }
      
      currentPage += 3;
      if (hasMore) await new Promise(r => setTimeout(r, 200)); 
    }
  } catch (err) {
    console.error("Error en fetchAllControlDocPages:", err);
  }
  
  // Siempre retornamos un array limpio, pase lo que pase
  return Array.from(new Map(allItems.filter(i => i && i.id).map(item => [item.id, item])).values());
}

async function handleSyncUsersToDB(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const credentials = resolveControlDocCredentials(req);
    const allEntities = await fetchAllControlDocPages('/api/v1/abstract/entities', credentials);

    let insertados = 0;
    for (const entity of allEntities) {
      if (!entity.id) continue;
      const external_id = entity.id.toString();
      const identifier = entity.identifier || entity.custom_fields?.numero_de_documento || null;
      const nombre = entity.name || entity.custom_fields?.nombre || entity.full_name || 'Sin Nombre';
      const sexo = entity.custom_fields?.sexo || entity.sexo || null;
      const rut = entity.identifier || entity.custom_fields?.numero_de_documento || entity.rut || null;
      const telefono = entity.custom_fields?.telefono || entity.telefono || null;
      let emailRaw = entity.custom_fields?.correo_electronico_personal || entity.custom_fields?.correo_electronico_corporativo || entity.email || '';
      const email = emailRaw ? emailRaw.trim().toLowerCase() : null;
      const jsonString = JSON.stringify(entity);

      await dbPool.execute(`
        INSERT INTO entidades_api (external_id, identifier, nombre, sexo, rut, email, telefono, customer_id, entity_type_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE identifier=VALUES(identifier), nombre=VALUES(nombre), sexo=VALUES(sexo), rut=VALUES(rut), email=VALUES(email), telefono=VALUES(telefono), data_json=VALUES(data_json), sincronizado_en=CURRENT_TIMESTAMP
      `, [external_id, identifier, nombre, sexo, rut, email, telefono, credentials.customerId, credentials.entityTypeId, jsonString]);
      insertados++;
    }
    sendJson(res, 200, { ok: true, message: `Sincronizados ${insertados} usuarios.` });
  } catch (error) {
    sendJson(res, 500, { error: 'Fallo al sincronizar' });
  }
}

async function handleSetupDB(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const queries = [
      `CREATE TABLE IF NOT EXISTS usuarios (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE, descripcion VARCHAR(255))`,
      `CREATE TABLE IF NOT EXISTS usuarios_roles (usuario_id INT NOT NULL, rol_id INT NOT NULL, PRIMARY KEY (usuario_id, rol_id), FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS entidades_api (id INT AUTO_INCREMENT PRIMARY KEY, external_id VARCHAR(100) NOT NULL, identifier VARCHAR(150), nombre VARCHAR(255), sexo VARCHAR(50), rut VARCHAR(50), email VARCHAR(150), telefono VARCHAR(50), customer_id VARCHAR(50), entity_type_id VARCHAR(50), data_json JSON NOT NULL, sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE (external_id, customer_id, entity_type_id))`,
      `CREATE TABLE IF NOT EXISTS tipos_documento_api (id INT AUTO_INCREMENT PRIMARY KEY, external_id VARCHAR(100) NOT NULL UNIQUE, nombre VARCHAR(255) NOT NULL, descripcion TEXT, data_json JSON NOT NULL, sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS documentos_api (id INT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, tipo_documento_id INT NULL, external_id VARCHAR(100) NOT NULL UNIQUE, entidad_external_id VARCHAR(100), nombre VARCHAR(255), estado VARCHAR(100), fecha_emision DATE NULL, fecha_vencimiento DATE NULL, data_json JSON NOT NULL, disponible_offline BOOLEAN NOT NULL DEFAULT FALSE, sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (tipo_documento_id) REFERENCES tipos_documento_api(id) ON DELETE RESTRICT ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS respaldos_documentos (id INT AUTO_INCREMENT PRIMARY KEY, documento_id INT NOT NULL, ruta_archivo VARCHAR(500) NOT NULL, nombre_archivo VARCHAR(255), mime_type VARCHAR(100), peso_bytes BIGINT, hash_archivo VARCHAR(128), descargado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (documento_id) REFERENCES documentos_api(id) ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS sync_logs (id INT AUTO_INCREMENT PRIMARY KEY, tipo VARCHAR(100) NOT NULL, estado ENUM('exitoso', 'fallido') NOT NULL, mensaje TEXT, registros_procesados INT DEFAULT 0, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `INSERT IGNORE INTO roles (nombre, descripcion) VALUES ('Admin', 'Administrador del sistema')`,
      `INSERT IGNORE INTO roles (nombre, descripcion) VALUES ('Usuario', 'Tripulante / Usuario estándar')`
    ];
    for (const query of queries) await dbPool.query(query);

    const [adminCheck] = await dbPool.execute('SELECT id FROM usuarios WHERE email = "admin@compasmarine.cl"');
    if (adminCheck.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      const [insertUser] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', ['Super Administrador', 'admin@compasmarine.cl', hash]);
      const [roleCheck] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Admin"');
      if (roleCheck.length > 0) await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [insertUser.insertId, roleCheck[0].id]);
    }
    sendJson(res, 200, { ok: true, message: 'Tablas creadas' });
  } catch (error) { sendJson(res, 500, { error: 'Fallo DB' }); }
}

async function handleAuthMe(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado' });

  try {
    const [userRows] = await dbPool.execute(`SELECT u.id, u.nombre, u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario no encontrado' });
    return sendJson(res, 200, { user: userRows[0] });
  } catch (error) { return sendJson(res, 500, { error: 'Error interno' }); }
}

// --- PROXY A PRUEBA DE BALAS ---
async function proxyControlDocRequest(req, res, requestUrl, cleanPath) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado.' });

  let userEmail = '';
  let isAdmin = false;

  try {
    const [userRows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario inválido.' });
    userEmail = userRows[0].email;
    const rolStr = userRows[0].rol || ''; // Prevención contra nulos absolutos
    isAdmin = rolStr.toLowerCase() === 'admin';
  } catch (error) {
    return sendJson(res, 200, []); // Fallback seguro para no romper UI
  }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  if (!upstreamPath) return sendJson(res, 200, []);

  const credentials = resolveControlDocCredentials(req);
  const now = Date.now();

  try {
    const serveWithSWR = async (cacheKey, fetchPath) => {
      const cacheStore = serverCache[cacheKey];
      if (cacheStore && cacheStore.data && cacheStore.data.length > 0) {
        if (cacheStore.expiresAt < now) {
          fetchAllControlDocPages(fetchPath, credentials)
            .then(data => { if(data.length > 0) serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL }; })
            .catch(() => {});
        }
        return cacheStore.data;
      }
      
      const data = await fetchAllControlDocPages(fetchPath, credentials);
      if (data && data.length > 0) {
        serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL };
      }
      return data || [];
    };

    if (upstreamPath === '/api/v1/abstract/document_types') {
      const data = await serveWithSWR('documentTypes', upstreamPath);
      return sendJson(res, 200, data);
    }

    if (upstreamPath === '/api/v1/abstract/entities') {
      const allEntities = await serveWithSWR('entities', upstreamPath);
      if (isAdmin) return sendJson(res, 200, allEntities);
      
      let myExternalId = null;
      try {
        const [rows] = await dbPool.execute('SELECT external_id FROM entidades_api WHERE email = ?', [userEmail]);
        if (rows.length > 0) myExternalId = rows[0].external_id?.toString();
      } catch(e) {}
      
      const filtered = allEntities.filter(item => item && item.id?.toString() === myExternalId);
      return sendJson(res, 200, filtered);
    }

    if (upstreamPath === '/api/v1/abstract/documents') {
      const allDocs = await serveWithSWR('documents', upstreamPath);
      if (isAdmin) return sendJson(res, 200, allDocs);
      
      let myExternalId = null;
      try {
        const [rows] = await dbPool.execute('SELECT external_id FROM entidades_api WHERE email = ?', [userEmail]);
        if (rows.length > 0) myExternalId = rows[0].external_id?.toString();
      } catch(e) {}

      const filtered = allDocs.filter(doc => doc && doc.entity_id?.toString() === myExternalId);
      return sendJson(res, 200, filtered);
    }

    return sendJson(res, 200, []);

  } catch (err) {
    console.error(`Error en proxy request controlado:`, err);
    return sendJson(res, 200, []); // Nunca arrojará 500, siempre un array vacío de fallback
  }
}

async function handleDocumentsSync(req, res) { sendJson(res, 200, { message: "Sync mantenido" }); }

function resolveControlDocCredentials(req) {
  const byUser = parseJsonEnv('CONTROLDOC_USER_CREDENTIALS_JSON');
  const cookieUserId = getCookie(req, 'compas_user_id');
  const requestedUserId = cookieUserId || process.env.CONTROLDOC_DEFAULT_USER_ID;

  if (byUser && typeof byUser === 'object') {
    const profile = byUser[requestedUserId] || byUser[process.env.CONTROLDOC_DEFAULT_USER_ID] || Object.values(byUser)[0];
    if (profile) return normalizeCredentialProfile(profile);
  }

  return normalizeCredentialProfile({
    email: process.env.CONTROLDOC_USER_EMAIL || process.env.API_USER_EMAIL,
    token: process.env.CONTROLDOC_USER_TOKEN || process.env.API_USER_TOKEN,
    customerId: process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID,
    entityTypeId: process.env.CONTROLDOC_ENTITY_TYPE_ID || '467',
    authorization: process.env.CONTROLDOC_AUTHORIZATION
  });
}

function normalizeCredentialProfile(profile) {
  return {
    email: profile.email || profile.userEmail || '',
    token: profile.token || profile.userToken || '',
    customerId: profile.customerId || profile.customer_id || process.env.CONTROLDOC_CUSTOMER_ID || '',
    entityTypeId: profile.entityTypeId || profile.entity_type_id || process.env.CONTROLDOC_ENTITY_TYPE_ID || '467',
    authorization: profile.authorization || process.env.CONTROLDOC_AUTHORIZATION || ''
  };
}

async function handleRegister(req, res) { sendJson(res, 403, { error: 'Deshabilitado' }); }

async function handleLogin(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const rawBody = await readRequestBody(req);
  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || ''; 
  if (!email || !password) return sendJson(res, 400, { error: 'Obligatorios.' });

  try {
    const [rows] = await dbPool.execute('SELECT * FROM usuarios WHERE email = ? AND activo = TRUE', [email]);
    if (rows.length > 0) {
        const user = rows[0];
        if (await bcrypt.compare(password, user.password_hash)) {
            const [roles] = await dbPool.execute('SELECT r.nombre as rol FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [user.id]);
            const rol = roles.length > 0 ? roles[0].rol : 'Usuario';
            res.setHeader('Set-Cookie', `compas_user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, rol } });
        }
    }

    const [entityRows] = await dbPool.execute(`SELECT * FROM entidades_api WHERE email = ?`, [email]);
    if (entityRows.length > 0) {
        let matchedEntidad = null;
        for (const entidad of entityRows) {
            const rutDB = entidad.rut ? entidad.rut.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '') : null;
            const inputPasswordRut = password.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '');
            if (rutDB && rutDB === inputPasswordRut) { matchedEntidad = entidad; break; }
        }

        if (matchedEntidad) {
            const hash = await bcrypt.hash(password, 12); 
            const [insertResult] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', [matchedEntidad.nombre || email, email, hash]);
            const userIdToLogin = insertResult.insertId;
            try {
                const [roles] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Usuario" LIMIT 1');
                if (roles.length > 0) await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [userIdToLogin, roles[0].id]);
            } catch(e) {}
            res.setHeader('Set-Cookie', `compas_user_id=${userIdToLogin}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { ok: true, user: { id: userIdToLogin, nombre: matchedEntidad.nombre, email, rol: 'Usuario' } });
        } else {
            return sendJson(res, 401, { error: 'Para activar tu cuenta, tu contraseña debe ser tu RUT.' });
        }
    }
    sendJson(res, 401, { error: 'Credenciales incorrectas.' });
  } catch (error) { sendJson(res, 500, { error: 'Error.' }); }
}

async function handlePushSubscription(req, res) { sendJson(res, 200, { ok: true }); }
async function handlePushTest(req, res) { sendJson(res, 200, { ok: true }); }
function configureWebPush() {}
function hasVapidConfig() { return false; }
function requireSameOriginRequest(req, res) { return true; }
function requireJsonRequest(req, res) { return true; }
function consumeRateLimit(req, res, bucketName, limit, windowMs) { return true; }
function loadNotificationsStore() { return { subscriptions: [] }; }
function saveNotificationsStore() {}
function serveStaticFile(res, requestUrl) {
  if (!existsSync(distDir)) return sendJson(res, 404, { error: 'Build output not found.' });
  let filePath = normalize(join(distDir, requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname)));
  if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html');
  const ext = extname(filePath);
  res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
  createReadStream(filePath).pipe(res);
}
function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); }
function readRequestBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', c => { body += c; if (body.length > 1024 * 1024) reject(new Error('Too large')); }); req.on('end', () => resolve(body)); req.on('error', reject); }); }
function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = join(appRoot, fileName);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim(), sep = trimmed.indexOf('=');
      if (!trimmed || trimmed.startsWith('#') || sep === -1) continue;
      const key = trimmed.slice(0, sep).trim(), val = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
function parseJsonEnv(key) {
  if (!process.env[key]) return null;
  try { return JSON.parse(process.env[key]); } catch { return null; }
}
function getCookie(req, cookieName) {
  const match = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : '';
}
function trimTrailingSlash(value) { return value.replace(/\/+$/, ''); }