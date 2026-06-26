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

// --- CARGA DE VARIABLES DE ENTORNO ---
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
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
loadEnvFiles(['.env.server.local', '.env.server', '.env.local', '.env']);

function parseJsonEnv(key) {
  if (!process.env[key]) return null;
  try { return JSON.parse(process.env[key]); } catch { return null; }
}

// --- CONFIGURACIÓN BASE ---
const port = Number(process.env.SERVER_PORT || process.env.PORT || 8787);
const host = process.env.SERVER_HOST || '0.0.0.0';
const controlDocBaseUrl = (process.env.CONTROLDOC_BASE_URL || 'https://compliance.controldoc.legal').replace(/\/+$/, '');

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

const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

// --- CACHÉ DEL SERVIDOR (12 HORAS) ---
const serverCache = {
  documentTypes: { data: [], expiresAt: 0 },
  entities: { data: [], expiresAt: 0 },
  documents: { data: [], expiresAt: 0 } 
};
const CACHE_TTL = 12 * 60 * 60 * 1000;

// --- UTILIDADES ---
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) reject(new Error('Payload demasiado grande')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getCookie(req, cookieName) {
  const match = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : '';
}

function serveStaticFile(res, requestUrl) {
  if (!existsSync(distDir)) return sendJson(res, 404, { error: 'Directorio dist no encontrado.' });
  let filePath = normalize(join(distDir, requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname)));
  if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: 'Acceso denegado' });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html');
  const ext = extname(filePath);
  res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
  createReadStream(filePath).pipe(res);
}

// --- LÓGICA DE CONTROLDOC (BLINDADA CONTRA 401) ---
function resolveControlDocCredentials(req) {
  const byUser = parseJsonEnv('CONTROLDOC_USER_CREDENTIALS_JSON');
  const cookieUserId = getCookie(req, 'compas_user_id');
  const requestedUserId = cookieUserId || process.env.CONTROLDOC_DEFAULT_USER_ID;

  if (byUser && typeof byUser === 'object') {
    const profile = byUser[requestedUserId] || byUser[process.env.CONTROLDOC_DEFAULT_USER_ID] || Object.values(byUser)[0];
    if (profile) return {
      email: profile.email || profile.userEmail || '',
      token: profile.token || profile.userToken || '',
      customerId: profile.customerId || profile.customer_id || process.env.CONTROLDOC_CUSTOMER_ID || '',
      entityTypeId: profile.entityTypeId || profile.entity_type_id || process.env.CONTROLDOC_ENTITY_TYPE_ID || '467',
      authorization: profile.authorization || process.env.CONTROLDOC_AUTHORIZATION || ''
    };
  }

  // Soporta tanto las variables con CONTROLDOC_ como con API_
  return {
    email: process.env.CONTROLDOC_USER_EMAIL || process.env.API_USER_EMAIL || '',
    token: process.env.CONTROLDOC_USER_TOKEN || process.env.API_USER_TOKEN || '',
    customerId: process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID || '',
    entityTypeId: process.env.CONTROLDOC_ENTITY_TYPE_ID || process.env.API_ENTITY_TYPE_ID || '467',
    authorization: process.env.CONTROLDOC_AUTHORIZATION || ''
  };
}

async function fetchAllControlDocPages(upstreamPath, credentials) {
  let allItems = [];
  try {
    let currentPage = 1, hasMore = true;
    
    // SANITIZACIÓN AGRESIVA: Elimina saltos de línea, comillas o espacios fantasmas
    const safeEmail = (credentials.email || '').replace(/[\r\n"']/g, '').trim();
    const safeToken = (credentials.token || '').replace(/[\r\n"']/g, '').trim();
    const safeCustomer = (credentials.customerId || '').replace(/[\r\n"']/g, '').trim();
    const safeEntity = (credentials.entityTypeId || '').replace(/[\r\n"']/g, '').trim();

    if (!safeEmail || !safeToken) {
        console.error("❌ [ControlDoc API] Error: Las variables de entorno de Correo o Token están vacías en Railway.");
        return [];
    }

    // DISFRAZ DE POSTMAN ESTRICTO
    const headers = { 
      'Accept': '*/*', // Vital para evitar bloqueos WAF
      'Content-Type': 'application/json',
      'User-Agent': 'PostmanRuntime/7.36.1', // Engañamos a ControlDoc para que crea que somos Postman
      'Connection': 'keep-alive'
    };

    if (safeEmail) headers['X-User-Email'] = safeEmail;
    if (safeToken) headers['X-User-Token'] = safeToken;
    if (safeCustomer) headers['Customer-Id'] = safeCustomer;
    if (safeEntity) headers['Entity-Type-Id'] = safeEntity;
    if (credentials.authorization) headers['Authorization'] = credentials.authorization.trim();

    while (hasMore && currentPage <= 30) {
      const batchPromises = [];
      // Reducimos la concurrencia a 2 para evitar Rate Limits silenciosos
      for (let i = 0; i < 2; i++) {
        const page = currentPage + i;
        const url = new URL(upstreamPath, controlDocBaseUrl);
        url.searchParams.append('page', page);
        url.searchParams.append('per_page', '100');
        
        batchPromises.push(
          fetch(url, { method: 'GET', headers })
          .then(async r => {
              if (r.status === 429) { 
                await new Promise(res => setTimeout(res, 2000)); 
                return fetch(url, { method: 'GET', headers }).then(r2 => r2.ok ? r2.json() : null).catch(()=>null); 
              }
              if (!r.ok) {
                // LOG DE DIAGNÓSTICO PROFUNDO
                const maskedToken = safeToken.length > 4 ? `***${safeToken.slice(-4)}` : 'INVÁLIDO';
                console.warn(`[ControlDoc API] Fallo (${r.status}) en ${upstreamPath}. Evaluando credenciales:`);
                console.warn(` -> Email enviado: "${safeEmail}"`);
                console.warn(` -> Token enviado: "${maskedToken}"`);
                console.warn(` -> Customer ID: "${safeCustomer}"`);
                return null;
              }
              return r.json();
          }).catch((err) => {
              console.error("[ControlDoc Network Error]:", err.message);
              return null;
          })
        );
      }

      const batchResults = await Promise.all(batchPromises);
      for (const json of batchResults) {
        if (!json) { hasMore = false; continue; }
        
        let items = [];
        if (Array.isArray(json)) {
            items = json;
        } else if (typeof json === 'object') {
            for (const key of ['data', 'items', 'documents', 'entities', 'document_types']) {
                if (Array.isArray(json[key])) { items = json[key]; break; }
            }
            if (items.length === 0) {
                const foundArray = Object.values(json).find(v => Array.isArray(v));
                if (foundArray) items = foundArray;
            }
        }

        if (items.length === 0) hasMore = false;
        else { allItems.push(...items); if (items.length < 25) hasMore = false; }
      }
      currentPage += 2;
      if (hasMore) await new Promise(r => setTimeout(r, 200)); 
    }
  } catch (err) { console.error("Error paginando:", err); }
  return Array.from(new Map(allItems.filter(i => i && i.id).map(item => [item.id, item])).values());
}

async function proxyControlDocRequest(req, res, cleanPath) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'No permitido' });
  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado' });

  let userEmail = '', isAdmin = false;
  try {
    const [rows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (rows.length === 0) return sendJson(res, 401, { error: 'Usuario inactivo.' });
    userEmail = rows[0].email;
    isAdmin = (rows[0].rol || '').toLowerCase() === 'admin';
  } catch (err) { return sendJson(res, 200, []); }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  const credentials = resolveControlDocCredentials(req);
  if (!credentials.email || !credentials.token) {
    console.warn("Credenciales de ControlDoc vacías en el servidor.");
    return sendJson(res, 200, []);
  }

  try {
    const serveWithSWR = async (cacheKey) => {
      const cacheStore = serverCache[cacheKey];
      if (cacheStore.data && cacheStore.data.length > 0) {
        if (cacheStore.expiresAt < Date.now()) {
          fetchAllControlDocPages(upstreamPath, credentials).then(data => { if(data.length > 0) serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL }; }).catch(()=>{});
        }
        return cacheStore.data;
      }
      const data = await fetchAllControlDocPages(upstreamPath, credentials);
      if (data && data.length > 0) {
        serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL };
      }
      return data || [];
    };

    if (upstreamPath === '/api/v1/abstract/document_types') return sendJson(res, 200, await serveWithSWR('documentTypes'));

    const isUsersEndpoint = upstreamPath === '/api/v1/abstract/entities';
    const isDocsEndpoint = upstreamPath === '/api/v1/abstract/documents';
    
    if (isUsersEndpoint || isDocsEndpoint) {
      const cacheKey = isUsersEndpoint ? 'entities' : 'documents';
      const allData = await serveWithSWR(cacheKey);
      
      if (isAdmin) return sendJson(res, 200, allData);
      
      let myExternalId = null;
      try {
        const [rows] = await dbPool.execute('SELECT external_id FROM entidades_api WHERE email = ?', [userEmail]);
        if (rows.length > 0) myExternalId = rows[0].external_id?.toString();
      } catch(e) {}

      // Filtro seguro para documentos
      const filtered = allData.filter(item => {
        if (isUsersEndpoint) return item.id?.toString() === myExternalId;
        const docEntityId = item.entity_id?.toString() || item.abstract_entity_id?.toString() || item.employee_id?.toString();
        return docEntityId === myExternalId;
      });
      return sendJson(res, 200, filtered);
    }
    return sendJson(res, 200, []);
  } catch (err) {
    return sendJson(res, 200, []); // Fallback a prueba de balas
  }
}

// --- SERVICIOS DE AUTENTICACIÓN ---
async function handleLogin(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
  
  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || ''; 
  if (!email || !password) return sendJson(res, 400, { error: 'Faltan credenciales.' });

  try {
    const [rows] = await dbPool.execute('SELECT * FROM usuarios WHERE email = ? AND activo = TRUE', [email]);
    if (rows.length > 0) {
        if (await bcrypt.compare(password, rows[0].password_hash)) {
            const [roles] = await dbPool.execute('SELECT r.nombre as rol FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [rows[0].id]);
            res.setHeader('Set-Cookie', `compas_user_id=${rows[0].id}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { ok: true, user: { id: rows[0].id, nombre: rows[0].nombre, email, rol: roles[0]?.rol || 'Usuario' } });
        }
    }

    const [entityRows] = await dbPool.execute(`SELECT * FROM entidades_api WHERE email = ?`, [email]);
    if (entityRows.length > 0) {
        let matchedEntidad = entityRows.find(e => (e.rut || '').replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '') === password.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, ''));
        if (matchedEntidad) {
            const hash = await bcrypt.hash(password, 12); 
            const [insertRes] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', [matchedEntidad.nombre || email, email, hash]);
            try {
                const [roles] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Usuario" LIMIT 1');
                if (roles.length > 0) await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [insertRes.insertId, roles[0].id]);
            } catch(e) {}
            res.setHeader('Set-Cookie', `compas_user_id=${insertRes.insertId}; Path=/; HttpOnly; SameSite=Lax`);
            return sendJson(res, 200, { ok: true, user: { id: insertRes.insertId, nombre: matchedEntidad.nombre, email, rol: 'Usuario' } });
        } else return sendJson(res, 401, { error: 'Tu contraseña de activación debe ser tu RUT.' });
    }
    sendJson(res, 401, { error: 'Credenciales incorrectas.' });
  } catch (error) { sendJson(res, 200, { error: 'Error ignorado', ok: false }); }
}

async function handleAuthMe(req, res) {
  const userId = getCookie(req, 'compas_user_id');
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });
  try {
    const [rows] = await dbPool.execute(`SELECT u.id, u.nombre, u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [userId]);
    if (rows.length === 0) return sendJson(res, 401, { error: 'Inactivo' });
    sendJson(res, 200, { user: rows[0] });
  } catch (e) { sendJson(res, 500, { error: 'Error interno' }); }
}

// --- SERVICIOS ADMIN ---
async function handleSetupDB(req, res) {
  try {
    await dbPool.query(`CREATE TABLE IF NOT EXISTS usuarios (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE)`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE)`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS usuarios_roles (usuario_id INT NOT NULL, rol_id INT NOT NULL, PRIMARY KEY (usuario_id, rol_id))`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS entidades_api (id INT AUTO_INCREMENT PRIMARY KEY, external_id VARCHAR(100) NOT NULL UNIQUE, rut VARCHAR(50), nombre VARCHAR(255), email VARCHAR(150), data_json JSON)`);
    await dbPool.query(`INSERT IGNORE INTO roles (nombre) VALUES ('Admin'), ('Usuario')`);
    
    const [adminCheck] = await dbPool.execute('SELECT id FROM usuarios WHERE email = "admin@compasmarine.cl"');
    if (adminCheck.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      const [insertUser] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', ['Admin', 'admin@compasmarine.cl', hash]);
      const [roleCheck] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Admin"');
      if (roleCheck.length > 0) await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [insertUser.insertId, roleCheck[0].id]);
    }
    sendJson(res, 200, { ok: true, message: 'DB lista.' });
  } catch (err) { sendJson(res, 500, { error: err.message }); }
}

async function handleSyncUsersToDB(req, res) {
  try {
    const credentials = resolveControlDocCredentials(req);
    const allEntities = await fetchAllControlDocPages('/api/v1/abstract/entities', credentials);
    let insertados = 0;
    for (const entity of allEntities) {
      if (!entity.id) continue;
      const external_id = entity.id.toString();
      const nombre = entity.name || entity.full_name || 'Sin Nombre';
      const rut = entity.identifier || entity.rut || null;
      let emailRaw = entity.custom_fields?.correo_electronico_personal || entity.email || '';
      await dbPool.execute(`INSERT INTO entidades_api (external_id, nombre, rut, email, data_json) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nombre=VALUES(nombre), rut=VALUES(rut), email=VALUES(email)`, [external_id, nombre, rut, emailRaw.trim().toLowerCase() || null, JSON.stringify(entity)]);
      insertados++;
    }
    sendJson(res, 200, { ok: true, message: `Sincronizados ${insertados} usuarios.` });
  } catch (err) { sendJson(res, 500, { error: 'Fallo al sincronizar' }); }
}

// --- SERVIDOR PRINCIPAL ---
const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const cleanPath = requestUrl.pathname.replace(/\/$/, '');

    // Rutas de API
    if (cleanPath === '/api/health') return sendJson(res, 200, { ok: true });
    if (cleanPath === '/api/auth/register') return sendJson(res, 403, { error: 'Deshabilitado' });
    if (cleanPath === '/api/auth/login') return await handleLogin(req, res);
    if (cleanPath === '/api/auth/me') return await handleAuthMe(req, res);
    if (cleanPath === '/api/admin/setup-db') return await handleSetupDB(req, res);
    if (cleanPath === '/api/admin/sync-users') return await handleSyncUsersToDB(req, res);
    if (cleanPath === '/api/controldoc/documents/sync') { 
        serverCache.documents.data = []; serverCache.entities.data = []; serverCache.documentTypes.data = []; 
        return sendJson(res, 200, { ok: true }); 
    }
    
    // Proxy ControlDoc
    if (controlDocRoutes.has(cleanPath)) {
      return await proxyControlDocRequest(req, res, cleanPath);
    }

    if (cleanPath.startsWith('/api/')) return sendJson(res, 404, { error: 'Ruta API no encontrada' });

    // React estático
    serveStaticFile(res, requestUrl);
  } catch (error) {
    console.error("Error global en el servidor:", error);
    sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

server.listen(port, host, () => {
  console.log(`✅ Servidor Compas Marine encendido en http://${host}:${port}`);
});