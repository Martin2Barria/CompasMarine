import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  getSessionUserId,
  validateSessionConfiguration
} from './utils/session.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '..');
const distDir = resolve(appRoot, 'dist');

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

const sessionConfiguration = validateSessionConfiguration();
if (sessionConfiguration.usingDevelopmentFallback) {
  console.warn('[Session] Usando secreto temporal exclusivo para desarrollo. Configura SESSION_SECRET antes de producción.');
}

const { consumeRateLimit } = await import('./utils/security.js');

const {
  handlePushSubscription,
  handlePushTest,
  handlePushNotificationHistory,
  handleEmailAlerts,
  handleEmailNotificationHistory,
  getEmailSchedulerStatus,
  runScheduledEmailNotifications,
  startNotificationScheduler
} = await import('./services/notifications.service.js');

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

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8'
};

// --- CACHÉ DEL SERVIDOR ---
const serverCache = {
  documentTypes: { data: null, expiresAt: 0, fetchPromise: null },
  entities: { data: null, expiresAt: 0, fetchPromise: null },
  documents: { data: null, expiresAt: 0, fetchPromise: null } 
};
const CACHE_TTL = 12 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL = 10 * 60 * 1000;
const passwordResetTokens = new Map();

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

function requireSameOriginRequest(req, res) {
  if (isAllowedRequestOrigin(req)) return true;
  return sendJson(res, 403, { error: 'Origen no permitido' });
}

function isAllowedRequestOrigin(req) {
  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) return process.env.NODE_ENV !== 'production';

  const allowedOrigins = getAllowedOrigins(req);
  return allowedOrigins.has(requestOrigin);
}

function getRequestOrigin(req) {
  if (typeof req.headers.origin === 'string') return req.headers.origin;
  if (typeof req.headers.referer === 'string') {
    try { return new URL(req.headers.referer).origin; } catch { return ''; }
  }
  return '';
}

function getAllowedOrigins(req) {
  const allowedOrigins = new Set(
    String(process.env.APP_ALLOWED_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  );
  const requestHost = req.headers['x-forwarded-host'] || req.headers.host;

  if (requestHost) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    allowedOrigins.add(`${forwardedProto}://${requestHost}`);
    allowedOrigins.add(`https://${requestHost}`);
    allowedOrigins.add(`http://${requestHost}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  return allowedOrigins;
}

function createPasswordResetToken(email, userId) {
  const now = Date.now();
  for (const [token, tokenData] of passwordResetTokens.entries()) {
    if (tokenData.expiresAt <= now) passwordResetTokens.delete(token);
  }

  const token = randomUUID();
  passwordResetTokens.set(token, {
    email,
    userId,
    expiresAt: now + PASSWORD_RESET_TOKEN_TTL
  });
  return token;
}

function consumePasswordResetToken(token, email) {
  if (!token) return null;
  const tokenData = passwordResetTokens.get(token);
  if (!tokenData) return null;

  passwordResetTokens.delete(token);
  const isExpired = tokenData.expiresAt <= Date.now();
  const sameEmail = tokenData.email === email;
  if (isExpired || !sameEmail) return null;

  return tokenData;
}

function serveStaticFile(res, requestUrl) {
  if (!existsSync(distDir)) return sendJson(res, 404, { error: 'Directorio dist no encontrado.' });
  let filePath = normalize(join(distDir, requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname)));
  if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: 'Acceso denegado' });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html');
  const ext = extname(filePath);
  const fileName = filePath.slice(distDir.length).replaceAll('\\', '/');
  const mustRevalidate = ext === '.html' || fileName === '/sw.js' || fileName === '/manifest.webmanifest';
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': mustRevalidate ? 'no-cache' : 'public, max-age=31536000, immutable'
  });
  createReadStream(filePath).pipe(res);
}

function extractControlDocItems(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];

  for (const key of ['data', 'items', 'documents', 'entities', 'document_types']) {
    if (Array.isArray(json[key])) return json[key];
  }
  for (const sourceKey of ['data', 'result', 'response', 'payload']) {
    const source = json[sourceKey];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of ['data', 'items', 'documents', 'entities', 'document_types', 'records', 'results']) {
      if (Array.isArray(source[key])) return source[key];
    }
  }
  return Object.values(json).find((value) => Array.isArray(value)) || [];
}

// --- LÓGICA DE CONTROLDOC MULTI-EMPRESA ---
function resolveControlDocCredentials(req) {
  const byUser = parseJsonEnv('CONTROLDOC_USER_CREDENTIALS_JSON');
  const cookieUserId = req ? getSessionUserId(req) : null;
  const requestedUserId = cookieUserId || process.env.CONTROLDOC_DEFAULT_USER_ID;

  const rawEntityTypes = process.env.API_ENTITY_TYPE_IDS || process.env.CONTROLDOC_ENTITY_TYPE_IDS || process.env.CONTROLDOC_ENTITY_TYPE_ID || '467, 468, 469';
  const entityTypeIds = String(rawEntityTypes).split(',').map(id => id.trim()).filter(Boolean);

  if (byUser && typeof byUser === 'object') {
    const profile = byUser[requestedUserId] || byUser[process.env.CONTROLDOC_DEFAULT_USER_ID] || Object.values(byUser)[0];
    if (profile) {
       const explicitGlobalEntityTypes = process.env.API_ENTITY_TYPE_IDS || process.env.CONTROLDOC_ENTITY_TYPE_IDS;
       const profileRawTypes = explicitGlobalEntityTypes || profile.entityTypeIds || profile.entity_type_ids || profile.entityTypeId || rawEntityTypes;
       
       const profileTypeIds = String(profileRawTypes).split(',').map(id => id.trim()).filter(Boolean);
       return {
         email: profile.email || profile.userEmail || '',
         token: profile.token || profile.userToken || '',
         customerId: profile.customerId || profile.customer_id || process.env.API_CUSTOMER_ID || process.env.CONTROLDOC_CUSTOMER_ID || '',
         entityTypeIds: profileTypeIds.length > 0 ? profileTypeIds : ['467', '468', '469'],
         authorization: profile.authorization || process.env.CONTROLDOC_AUTHORIZATION || ''
       };
    }
  }

  return {
    email: process.env.CONTROLDOC_USER_EMAIL || process.env.API_USER_EMAIL || '',
    token: process.env.CONTROLDOC_USER_TOKEN || process.env.API_USER_TOKEN || '',
    customerId: process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID || '',
    entityTypeIds: entityTypeIds.length > 0 ? entityTypeIds : ['467', '468', '469'],
    authorization: process.env.CONTROLDOC_AUTHORIZATION || ''
  };
}

async function fetchWithRetry(url, headers, maxRetries = 8) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET', headers });
      const isRateLimit = response.status === 429 || (response.status === 401 && url.searchParams.get('page') !== '1') || response.status === 403;
      
      if (isRateLimit) {
        const waitTime = attempt * 3000 + Math.random() * 2000;
        await new Promise(res => setTimeout(res, waitTime));
        continue;
      }
      
      if (!response.ok) {
        if (response.status >= 500) {
           await new Promise(res => setTimeout(res, attempt * 2000));
           continue;
        }
        return null; 
      }
      
      return await response.json();
    } catch {
      await new Promise(res => setTimeout(res, attempt * 2000));
    }
  }
  return null;
}

async function fetchAllControlDocPages(upstreamPath, credentials, extraParams = {}) {
  let globalItems = [];
  
  try {
    const baseHeaders = { 
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Content-Type': 'application/json',
      'User-Agent': 'PostmanRuntime/7.36.3'
    };

    if (credentials.email) baseHeaders['X-User-Email'] = credentials.email.trim();
    if (credentials.token) baseHeaders['X-User-Token'] = credentials.token.trim();
    if (credentials.customerId) baseHeaders['Customer-Id'] = credentials.customerId.trim();
    if (credentials.authorization) baseHeaders['Authorization'] = credentials.authorization.trim();

    const MAX_PAGES = 500; 
    const CONCURRENCY = 3; 

    for (const entityTypeId of credentials.entityTypeIds) {
      console.log(`[ControlDoc] Iniciando descarga masiva en ${upstreamPath} para Empresa ID: ${entityTypeId}...`);
      let allItems = [];
      let currentPage = 1, hasMore = true;
      
      const headers = { ...baseHeaders, 'Entity-Type-Id': entityTypeId };

      while (hasMore && currentPage <= MAX_PAGES) {
        const batchPromises = [];
        for (let i = 0; i < CONCURRENCY; i++) {
          const page = currentPage + i;
          if (page > MAX_PAGES) {
             hasMore = false;
             break;
          }

          const url = new URL(upstreamPath, controlDocBaseUrl);
          url.searchParams.append('page', page);
          url.searchParams.append('per_page', '150'); 
          for (const [key, value] of Object.entries(extraParams)) {
            url.searchParams.append(key, value);
          }
          
          batchPromises.push(fetchWithRetry(url, headers));
        }

        const batchResults = await Promise.all(batchPromises);
        let emptyPageDetected = false;

        for (const json of batchResults) {
          if (!json) continue; 
          const items = extractControlDocItems(json);
          if (items.length === 0) {
              emptyPageDetected = true;
          } else {
              allItems.push(...items);
          }
        }

        if (emptyPageDetected) hasMore = false;
        currentPage += CONCURRENCY;
        if (hasMore) await new Promise(r => setTimeout(r, 400));
      }
      
      console.log(`[ControlDoc] Terminó descarga ID ${entityTypeId}. Extraídos: ${allItems.length}`);
      globalItems.push(...allItems);
    }

    console.log(`[ControlDoc] Finalizada descarga global en ${upstreamPath}. Total acumulado: ${globalItems.length}`);
  } catch (err) { console.error("Error paginando:", err); }
  
  return Array.from(new Map(globalItems.filter(i => i && i.id).map(item => [item.id, item])).values());
}

async function serveWithSWR(cacheKey, upstreamPath, credentials, extraParams = {}) {
  if (!serverCache[cacheKey]) {
      serverCache[cacheKey] = { data: null, expiresAt: 0, fetchPromise: null };
  }
  const cacheStore = serverCache[cacheKey];
  
  if (cacheStore.fetchPromise) {
    await cacheStore.fetchPromise;
    return cacheStore.data || [];
  }

  if (cacheStore.data && cacheStore.data.length > 0) {
    if (cacheStore.expiresAt < Date.now()) {
      cacheStore.fetchPromise = fetchAllControlDocPages(upstreamPath, credentials, extraParams)
        .then(data => { 
            if(data && data.length > 0) {
               cacheStore.data = data;
               cacheStore.expiresAt = Date.now() + CACHE_TTL;
            }
        })
        .catch(e => console.error(e))
        .finally(() => { cacheStore.fetchPromise = null; });
    }
    return cacheStore.data;
  }
  
  cacheStore.fetchPromise = fetchAllControlDocPages(upstreamPath, credentials, extraParams)
    .then(data => { 
        if(data && data.length > 0) {
           cacheStore.data = data;
           cacheStore.expiresAt = Date.now() + CACHE_TTL;
        }
    })
    .catch(e => console.error(e))
    .finally(() => { cacheStore.fetchPromise = null; });
    
  await cacheStore.fetchPromise;
  return cacheStore.data || [];
}

async function proxyControlDocRequest(req, res, cleanPath) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'No permitido' });
  const cookieUserId = getSessionUserId(req);
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado' });

  let userEmail = '';
  let isAdmin;
  try {
    const [rows] = await dbPool.execute(`SELECT u.email, r.nombre as rol, r.id as rol_id FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (rows.length === 0) return sendJson(res, 401, { error: 'Usuario inactivo.' });
    
    userEmail = rows[0].email;
    const rolId = rows[0].rol_id ? Number(rows[0].rol_id) : null;
    const rolStr = (rows[0].rol || '').toLowerCase().trim();

    if (userEmail === 'admin@compasmarine.cl' || (rolId !== null && [2, 10, 11, 13].includes(rolId))) {
      isAdmin = true;
    } else {
      isAdmin = ['admin', 'admin supremo', 'admin gestor', 'lector global'].includes(rolStr) || rolStr.includes('admin');
    }
  } catch (error) {
    console.error('Error validando usuario para ControlDoc:', error.message);
    return sendJson(res, 500, { error: 'No se pudo validar el usuario para ControlDoc.' });
  }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  const credentials = resolveControlDocCredentials(req);
  if (!credentials.email || !credentials.token) {
    return sendJson(res, 503, { error: 'Faltan credenciales de ControlDoc.' });
  }

  try {
    if (upstreamPath === '/api/v1/abstract/document_types') {
      return sendJson(res, 200, await serveWithSWR('documentTypes', upstreamPath, credentials));
    }

    const isUsersEndpoint = upstreamPath === '/api/v1/abstract/entities';
    const isDocsEndpoint = upstreamPath === '/api/v1/abstract/documents';
    
    if (isUsersEndpoint || isDocsEndpoint) {
      if (isAdmin) {
          const cacheKey = isUsersEndpoint ? 'entities' : 'documents';
          return sendJson(res, 200, await serveWithSWR(cacheKey, upstreamPath, credentials));
      }

      console.log(`🔒 [API] Tripulante detectado. Filtrando información en memoria...`);
      let dbRut = '';
      try {
        const [rows] = await dbPool.execute('SELECT rut FROM entidades_api WHERE email = ?', [userEmail]);
        if (rows.length > 0) dbRut = (rows[0].rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
      } catch {
        dbRut = '';
      }

      const allEntities = await serveWithSWR('entities', controlDocRoutes.get('/api/controldoc/entities'), credentials);
      
      const myEntity = allEntities.find(e => {
         const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
         const eRut = (e.identifier || e.custom_fields?.numero_de_documento || e.rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
         return (eEmail && eEmail === userEmail.toLowerCase()) || (dbRut && eRut && eRut === dbRut);
      });

      const myExternalId = myEntity ? myEntity.id?.toString() : null;

      if (!myExternalId) {
          console.log(`⚠️ [API] No se encontró entidad para el tripulante ${userEmail}.`);
          return sendJson(res, 200, []);
      }

      if (isUsersEndpoint) {
          const filteredEntities = allEntities.filter(e => e.id?.toString() === myExternalId);
          return sendJson(res, 200, filteredEntities);
      }

      if (isDocsEndpoint) {
          const allDocs = await serveWithSWR('documents', upstreamPath, credentials);
          const filteredDocs = allDocs.filter(item => {
              const docEntityId = item.entity_id?.toString() || item.abstract_entity_id?.toString() || item.employee_id?.toString();
              return docEntityId === myExternalId;
          });
          console.log(`👤 [API] Enviando ${filteredDocs.length} documentos filtrados al tripulante ${userEmail}.`);
          return sendJson(res, 200, filteredDocs);
      }
    }
    return sendJson(res, 200, []);
  } catch (err) {
    console.error("Error en proxy request:", err);
    return sendJson(res, 502, { error: 'No se pudo obtener información desde ControlDoc.' });
  }
}

// --- SERVICIOS DE AUTENTICACIÓN ---
async function handleLogin(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!consumeRateLimit(req, res, 'auth-login', 10, 15 * 60 * 1000)) return;
  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
  
  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || ''; 
  if (!email || !password) return sendJson(res, 400, { error: 'Faltan credenciales.' });

  try {
    const [rows] = await dbPool.execute('SELECT * FROM usuarios WHERE email = ? AND activo = TRUE', [email]);
    if (rows.length > 0) {
        if (await bcrypt.compare(password, rows[0].password_hash)) {
            const [roles] = await dbPool.execute('SELECT r.id as rol_id, r.nombre as rol FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [rows[0].id]);
            
            const rol = roles.length > 0 ? roles[0].rol : 'Usuario';
            const rol_id = roles.length > 0 ? roles[0].rol_id : null;

            res.setHeader('Set-Cookie', buildSessionCookie(req, rows[0].id));
            return sendJson(res, 200, { ok: true, user: { id: rows[0].id, nombre: rows[0].nombre, email, rol, rol_id } });
        }
      return sendJson(res, 401, { error: 'Credenciales incorrectas.' });
    }

    const [entityRows] = await dbPool.execute(`SELECT * FROM entidades_api WHERE email = ?`, [email]);
    if (entityRows.length > 0) {
        let matchedEntidad = entityRows.find(e => (e.rut || '').replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '') === password.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, ''));
        if (matchedEntidad) {
            const hash = await bcrypt.hash(password, 12); 
            const [insertRes] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', [matchedEntidad.nombre || email, email, hash]);
            let assignedRolId = null;
            try {
                const [roles] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Usuario" LIMIT 1');
                if (roles.length > 0) {
                  assignedRolId = roles[0].id;
                  await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [insertRes.insertId, assignedRolId]);
                }
            } catch (error) {
                console.warn('No se pudo asignar el rol Usuario automáticamente:', error.message);
            }
            res.setHeader('Set-Cookie', buildSessionCookie(req, insertRes.insertId));
            return sendJson(res, 200, { ok: true, user: { id: insertRes.insertId, nombre: matchedEntidad.nombre, email, rol: 'Usuario', rol_id: assignedRolId } });
        } else return sendJson(res, 401, { error: 'Tu contraseña de activación debe ser tu RUT.' });
    }
    sendJson(res, 401, { error: 'Credenciales incorrectas.' });
  } catch (error) {
    console.error('Error en login:', error.message);
    sendJson(res, 500, { error: 'No se pudo iniciar sesión.', ok: false });
  }
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;
  res.setHeader('Set-Cookie', buildClearSessionCookie(req));
  return sendJson(res, 200, { ok: true });
}

async function handleVerifyResetIdentity(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;
  if (!consumeRateLimit(req, res, 'auth-reset-identity', 10, 15 * 60 * 1000)) return;

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const currentPassword = payload.password || '';

  if (!email || !currentPassword) {
    return sendJson(res, 400, { error: 'El correo electrónico y la contraseña actual son obligatorios.' });
  }

  try {
    const [rows] = await dbPool.execute('SELECT id, password_hash FROM usuarios WHERE email = ? AND activo = TRUE LIMIT 1', [email]);
    if (rows.length === 0) {
      return sendJson(res, 404, { error: 'No existe un usuario activo registrado con ese correo.' });
    }

    const user = rows[0];
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return sendJson(res, 401, { error: 'La contraseña actual no es válida.' });
    }

    const verificationToken = createPasswordResetToken(email, user.id);
    return sendJson(res, 200, {
      ok: true,
      verificationToken,
      message: 'Identidad validada. Ya puedes definir tu nueva contraseña.'
    });
  } catch (error) {
    console.error('Error validando identidad para restablecer contraseña:', error);
    return sendJson(res, 500, { error: 'No se pudo validar la identidad.' });
  }
}

async function handleResetPassword(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }

  const email = (payload.email || '').trim().toLowerCase();
  const nextPassword = payload.password || '';
  const verificationToken = payload.verificationToken || '';

  if (!email || !nextPassword || !verificationToken) {
    return sendJson(res, 400, { error: 'Debes validar tu identidad antes de cambiar la contraseña.' });
  }

  if (nextPassword.length < 8) {
    return sendJson(res, 400, { error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }

  const verifiedSession = consumePasswordResetToken(verificationToken, email);
  if (!verifiedSession) {
    return sendJson(res, 401, { error: 'La validación expiró o no es válida. Vuelve a verificar tu identidad.' });
  }

  try {
    const [userRows] = await dbPool.execute('SELECT id, password_hash FROM usuarios WHERE email = ? AND activo = TRUE LIMIT 1', [email]);

    if (userRows.length === 0) {
      return sendJson(res, 404, { error: 'El usuario ya no está disponible para actualizar contraseña.' });
    }

    const user = userRows[0];
    const isSamePassword = await bcrypt.compare(nextPassword, user.password_hash);
    if (isSamePassword) {
      return sendJson(res, 400, { error: 'La nueva contraseña no puede ser igual a la actual.' });
    }

    const passwordHash = await bcrypt.hash(nextPassword, 12);
    await dbPool.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
    return sendJson(res, 200, { ok: true, message: 'La contraseña fue actualizada correctamente.' });
  } catch (error) {
    console.error('Error restableciendo contraseña:', error);
    return sendJson(res, 500, { error: 'No se pudo actualizar la contraseña.' });
  }
}

async function handleAuthMe(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) return sendJson(res, 401, { error: 'No autorizado' });
  try {
    const [rows] = await dbPool.execute(`SELECT u.id, u.nombre, u.email, r.nombre as rol, r.id as rol_id FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [userId]);
    if (rows.length === 0) return sendJson(res, 401, { error: 'Inactivo' });
    res.setHeader('Set-Cookie', buildSessionCookie(req, userId));
    sendJson(res, 200, { user: rows[0] });
  } catch { sendJson(res, 500, { error: 'Error interno' }); }
}

// --- SERVICIOS DE GESTIÓN (Roles Centralizados) ---
async function getAdminRoleId(req) {
  const cookieUserId = getSessionUserId(req);
  if (!cookieUserId) return null;
  try {
    const [rows] = await dbPool.execute('SELECT r.id as rol_id FROM usuarios_roles ur JOIN roles r ON ur.rol_id = r.id WHERE ur.usuario_id = ?', [cookieUserId]);
    if (rows.length === 0) return null;
    return Number(rows[0].rol_id);
  } catch { return null; }
}

async function handleGetUsers(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no válido' });
  const roleId = await getAdminRoleId(req);
  if (![10, 11, 13].includes(roleId)) return sendJson(res, 403, { error: 'Acceso denegado. Se requiere nivel de Administrador.' });

  try {
    // 💡 SOLUCIÓN DEFINITIVA A LOS CLONES Y AL ERROR 500
    // Ejecutamos una consulta plana (sin GROUP BY ni MAX) para evitar conflictos estrictos de MySQL
    const [rows] = await dbPool.query(`
      SELECT 
        e.external_id, 
        e.rut,
        e.nombre, 
        e.email, 
        u.id as local_user_id, 
        r.id as rol_id, 
        r.nombre as rol_nombre
      FROM entidades_api e
      LEFT JOIN usuarios u ON e.email = u.email AND e.email IS NOT NULL AND e.email != ''
      LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id
      LEFT JOIN roles r ON ur.rol_id = r.id
    `);

    // Deduplicamos los clones en la memoria de JavaScript (Infinitamente más seguro y rápido)
    const usersMap = new Map();
    for (const row of rows) {
      const extId = row.external_id?.toString();
      if (!extId) continue;

      if (!usersMap.has(extId)) {
        usersMap.set(extId, {
          id: extId,
          local_user_id: row.local_user_id,
          rut: row.rut,
          nombre: row.nombre || 'Sin Nombre',
          email: row.email,
          activo: row.local_user_id ? 1 : 0,
          rol_id: row.rol_id,
          rol_nombre: row.rol_nombre
        });
      } else if (row.local_user_id) {
        // Si ya registramos el usuario, pero este registro SI tiene cuenta creada, lo sobreescribimos
        const existing = usersMap.get(extId);
        existing.local_user_id = row.local_user_id;
        existing.activo = 1;
        existing.rol_id = row.rol_id;
        existing.rol_nombre = row.rol_nombre;
        if (row.rut && !existing.rut) existing.rut = row.rut;
        if (row.email && !existing.email) existing.email = row.email;
      }
    }

    const users = Array.from(usersMap.values());
    users.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); // Ordenar alfabéticamente

    const [roles] = await dbPool.query('SELECT id, nombre FROM roles ORDER BY id ASC');
    return sendJson(res, 200, { users, roles });
  } catch (error) {
    console.error("Error Obteniendo Usuarios:", error);
    return sendJson(res, 500, { error: 'Error al obtener lista de usuarios completos.' });
  }
}

async function handleChangeUserRole(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  const roleIdAuth = await getAdminRoleId(req);
  if (![10, 13].includes(roleIdAuth)) return sendJson(res, 403, { error: 'Acceso denegado. Solo el Admin Supremo puede cambiar roles.' });

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
  
  const { userId, roleId } = payload;
  if (!userId || !roleId) return sendJson(res, 400, { error: 'Faltan datos para procesar la solicitud.' });

  try {
    let targetLocalUserId = null;

    // 1. Buscamos primero al usuario en base de datos.
    const [entities] = await dbPool.execute('SELECT nombre, email, rut FROM entidades_api WHERE external_id = ? LIMIT 1', [userId]);
    if (entities.length === 0) return sendJson(res, 404, { error: 'No se encontró la entidad en ControlDoc.' });
    
    const entidad = entities[0];
    const emailAUsar = entidad.email || `sin-correo-${userId}@temp.com`;

    const [existingUsers] = await dbPool.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [emailAUsar]);

    if (existingUsers.length > 0) {
       targetLocalUserId = existingUsers[0].id;
    } else {
      // 💡 SOLUCIÓN ER_NO_REFERENCED_ROW_2: Si NO existe, creamos su cuenta primero.
      const rutLimpio = entidad.rut ? entidad.rut.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '') : '123456789';
      const hash = await bcrypt.hash(rutLimpio, 12);
      
      const [insertRes] = await dbPool.execute(
        'INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', 
        [entidad.nombre || 'Sin Nombre', emailAUsar, hash]
      );
      targetLocalUserId = insertRes.insertId;
    }

    // Ahora insertamos usando el ID local que SÍ existe en la BD
    await dbPool.execute('DELETE FROM usuarios_roles WHERE usuario_id = ?', [targetLocalUserId]);
    await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [targetLocalUserId, roleId]);
    
    return sendJson(res, 200, { ok: true, message: 'Rol asignado correctamente al tripulante.' });
  } catch (error) {
    console.error("Error al cambiar rol:", error);
    return sendJson(res, 500, { error: 'Error interno al actualizar el rol.' });
  }
}

async function handleResetUserPassword(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no válido' });
  if (!requireSameOriginRequest(req, res)) return;
  const roleIdAuth = await getAdminRoleId(req);
  if (![10, 11, 13].includes(roleIdAuth)) return sendJson(res, 403, { error: 'Acceso denegado. Se requiere nivel de Administrador.' });

  let payload;
  try { payload = JSON.parse(await readRequestBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }

  const { userId } = payload;
  if (!userId) return sendJson(res, 400, { error: 'Falta el identificador del usuario.' });

  try {
    const [entities] = await dbPool.execute('SELECT email, rut FROM entidades_api WHERE external_id = ? LIMIT 1', [userId]);
    if (entities.length === 0) return sendJson(res, 404, { error: 'La entidad no existe en el sistema.' });
    
    const entidad = entities[0];
    const email = entidad.email;
    
    if (!email) return sendJson(res, 400, { error: 'Imposible realizar la acción: El usuario no tiene correo asociado.' });

    const [users] = await dbPool.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [email]);
    if (users.length === 0) return sendJson(res, 400, { error: 'Este usuario aún no ha ingresado al sistema ni tiene cuenta.' });
    
    const localUserId = users[0].id;
    let rut = '';
    if (entidad.rut) {
        rut = entidad.rut.replace(/[^0-9kK]/g, '').toLowerCase().replace(/^0+/, '');
    }

    if (!rut) {
        return sendJson(res, 400, { error: 'Imposible realizar la acción: El usuario no tiene un RUT asociado en ControlDoc.' });
    }

    const hash = await bcrypt.hash(rut, 12);
    await dbPool.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, localUserId]);

    return sendJson(res, 200, { ok: true, message: 'Contraseña restablecida. Ahora su clave es su RUT.' });
  } catch (error) {
    console.error("Error al restablecer contraseña:", error);
    return sendJson(res, 500, { error: 'Error interno del servidor al restablecer contraseña.' });
  }
}

// --- SERVICIOS ADMIN (Generales de Mantenimiento) ---
async function handleSetupDB(req, res) {
  if (!requireSameOriginRequest(req, res)) return;
  const roleId = await getAdminRoleId(req);
  if (![10, 11].includes(roleId)) return sendJson(res, 403, { error: 'Acceso denegado. Mantenimiento exclusivo para administradores.' });
  
  try {
    await dbPool.query(`CREATE TABLE IF NOT EXISTS usuarios (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE)`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE)`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS usuarios_roles (usuario_id INT NOT NULL, rol_id INT NOT NULL, PRIMARY KEY (usuario_id, rol_id))`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS entidades_api (id INT AUTO_INCREMENT PRIMARY KEY, external_id VARCHAR(100) NOT NULL UNIQUE, rut VARCHAR(50), nombre VARCHAR(255), email VARCHAR(150), data_json JSON)`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint_hash CHAR(64) PRIMARY KEY, user_id INT NULL, endpoint TEXT NOT NULL, subscription_json JSON NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, INDEX idx_push_subscriptions_user_id (user_id))`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS push_notification_events (event_hash CHAR(64) PRIMARY KEY, user_id INT NULL, event_key TEXT NOT NULL, event_id TEXT NOT NULL, rule_version INT NOT NULL DEFAULT 1, sent_at DATETIME NOT NULL, last_sent_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_push_notification_events_user_id (user_id))`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS push_notification_history (event_hash CHAR(64) PRIMARY KEY, history_id VARCHAR(96) NOT NULL, user_id INT NOT NULL, event_id VARCHAR(1024) NOT NULL, notification_group VARCHAR(32) NOT NULL, threshold TINYINT NULL, title VARCHAR(255) NOT NULL, body TEXT NOT NULL, doc_name VARCHAR(255) NOT NULL, expiration_date VARCHAR(100) NULL, days_remaining INT NULL, sent_at DATETIME NOT NULL, last_sent_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_push_notification_history_user_id (user_id), INDEX idx_push_notification_history_last_sent_at (last_sent_at))`);
    await dbPool.query(`CREATE TABLE IF NOT EXISTS email_notification_events (event_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, event_key VARCHAR(1024) NOT NULL, event_id VARCHAR(1024) NOT NULL, threshold TINYINT NOT NULL, notification_group VARCHAR(32) NOT NULL, title VARCHAR(255) NOT NULL, body TEXT NOT NULL, doc_name VARCHAR(255) NOT NULL, expiration_date VARCHAR(100) NULL, days_remaining INT NULL, provider_id VARCHAR(255) NULL, sent_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_email_notification_events_user_id (user_id), INDEX idx_email_notification_events_sent_at (sent_at))`);
    await dbPool.query(`INSERT IGNORE INTO roles (nombre) VALUES ('Admin Supremo'), ('Admin Gestor'), ('Admin'), ('Usuario')`);
    sendJson(res, 200, { ok: true, message: 'DB lista.' });
  } catch (err) { sendJson(res, 500, { error: err.message }); }
}

async function handleSyncUsersToDB(req, res) {
  if (!requireSameOriginRequest(req, res)) return;
  const roleId = await getAdminRoleId(req);
  if (![10, 11].includes(roleId)) return sendJson(res, 403, { error: 'Acceso denegado. Mantenimiento exclusivo para administradores.' });
  
  try {
    const credentials = resolveControlDocCredentials(null);
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
  } catch (error) {
    console.error('Error sincronizando usuarios:', error.message);
    sendJson(res, 500, { error: 'Fallo al sincronizar' });
  }
}

// --- SERVIDOR PRINCIPAL ---
const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const cleanPath = requestUrl.pathname.replace(/\/$/, '');

    if (cleanPath === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        email: getEmailSchedulerStatus()
      });
    }
    if (cleanPath === '/api/auth/register') return sendJson(res, 403, { error: 'Deshabilitado' });
    if (cleanPath === '/api/auth/login') return await handleLogin(req, res);
    if (cleanPath === '/api/auth/logout') return await handleLogout(req, res);
    if (cleanPath === '/api/auth/verify-reset-identity') return await handleVerifyResetIdentity(req, res);
    if (cleanPath === '/api/auth/reset-password') return await handleResetPassword(req, res);
    if (cleanPath === '/api/auth/me') return await handleAuthMe(req, res);

    // API de notificaciones (push y correo Resend)
    if (cleanPath === '/api/notifications/vapid-public-key') {
      return sendJson(res, 200, {
        publicKey: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
          ? process.env.VAPID_PUBLIC_KEY
          : null,
        ready: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
      });
    }
    if (cleanPath === '/api/notifications/subscriptions') return await handlePushSubscription(req, res);
    if (cleanPath === '/api/notifications/test') return await handlePushTest(req, res);
    if (cleanPath === '/api/notifications/push-history') return await handlePushNotificationHistory(req, res);
    if (cleanPath === '/api/notifications/email-alerts') return await handleEmailAlerts(req, res);
    if (cleanPath === '/api/notifications/email-history') return await handleEmailNotificationHistory(req, res);

    if (cleanPath === '/api/admin/notifications/email-run') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!requireSameOriginRequest(req, res)) return;
      const roleId = await getAdminRoleId(req);
      if (![10, 11].includes(roleId)) return sendJson(res, 403, { error: 'Acceso denegado' });

      const result = await runScheduledEmailNotifications({
        getControlDocData: getNotificationControlDocData
      });
      return sendJson(res, 200, { ok: true, result });
    }
    
    // API Gestión de Usuarios
    if (cleanPath === '/api/admin/users') return await handleGetUsers(req, res);
    if (cleanPath === '/api/admin/users/role') return await handleChangeUserRole(req, res);
    if (cleanPath === '/api/admin/users/reset-password') return await handleResetUserPassword(req, res);
    
    // API Mantenimiento
    if (cleanPath === '/api/admin/setup-db') return await handleSetupDB(req, res);
    if (cleanPath === '/api/admin/sync-users') return await handleSyncUsersToDB(req, res);
    
    if (cleanPath === '/api/controldoc/documents/sync') { 
        if (!requireSameOriginRequest(req, res)) return;
        if (!getSessionUserId(req)) return sendJson(res, 401, { error: 'No autorizado' });
        serverCache.documents.expiresAt = 0; 
        serverCache.entities.expiresAt = 0; 
        serverCache.documentTypes.expiresAt = 0; 
        
        runBackgroundCachePreload(); 
        
        return sendJson(res, 200, { 
            ok: true, 
            message: 'Actualizando datos. Tu pantalla seguirá mostrando los últimos datos vigentes mientras descargamos las novedades.' 
        }); 
    }
    
    if (controlDocRoutes.has(cleanPath)) {
      return await proxyControlDocRequest(req, res, cleanPath);
    }

    if (cleanPath.startsWith('/api/')) return sendJson(res, 404, { error: 'Ruta API no encontrada' });

    serveStaticFile(res, requestUrl);
  } catch (error) {
    console.error("Error global en el servidor:", error);
    sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

server.listen(port, host, () => {
  console.log(`✅ Servidor Compas Marine encendido en http://${host}:${port}`);
  
  const creds = resolveControlDocCredentials(null);
  console.log(`🔍 [Config] Múltiples Empresas Detectadas (IDs): [ ${creds.entityTypeIds.join(', ')} ]`);

  setTimeout(runBackgroundCachePreload, 5000);
  startNotificationScheduler({ getControlDocData: getNotificationControlDocData });
});

// --- TAREA FANTASMA (BACKGROUND WORKER) ---
async function runBackgroundCachePreload() {
  const creds = resolveControlDocCredentials(null);
  console.log(`⏱️ [Background Task] Iniciando sincronización fantasma masiva para los IDs: ${creds.entityTypeIds.join(', ')}`);
  
  if (!creds.email || !creds.token) {
    console.warn("[Background Task] Faltan credenciales.");
    return;
  }

  try {
    await serveWithSWR('documentTypes', '/api/v1/abstract/document_types', creds);
    await serveWithSWR('entities', '/api/v1/abstract/entities', creds);
    await serveWithSWR('documents', '/api/v1/abstract/documents', creds);
    console.log("✅ [Background Task] ¡RAM cargada y asegurada masivamente!");
  } catch (err) {
    console.error("❌ [Background Task] Falló:", err.message);
  }
}

async function getNotificationControlDocData() {
  const credentials = resolveControlDocCredentials(null);
  const [documentTypes, entities, documents] = await Promise.all([
    serveWithSWR('documentTypes', '/api/v1/abstract/document_types', credentials),
    serveWithSWR('entities', '/api/v1/abstract/entities', credentials),
    serveWithSWR('documents', '/api/v1/abstract/documents', credentials)
  ]);

  return { documentTypes, entities, documents };
}
