import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(__dirname, '..');
const distDir = resolve(appRoot, 'dist');

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

const pushSubscriptions = new Map();

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

    if (requestUrl.pathname === '/api/notifications/vapid-public-key') {
      sendJson(res, 200, { publicKey: process.env.VAPID_PUBLIC_KEY || null });
      return;
    }

    if (requestUrl.pathname === '/api/notifications/subscriptions') {
      await handlePushSubscription(req, res);
      return;
    }

    // --- NUEVA RUTA INTERCEPTADA: Sincronización Masiva ---
    if (requestUrl.pathname === '/api/controldoc/documents/sync') {
      await handleDocumentsSync(req, res, requestUrl);
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
async function handleDocumentsSync(req, res, requestUrl) {
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
  requestUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });

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

async function handlePushSubscription(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, { count: pushSubscriptions.size });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rawBody = await readRequestBody(req);
  let subscription;

  try {
    subscription = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!subscription.endpoint) {
    sendJson(res, 400, { error: 'Invalid push subscription' });
    return;
  }

  pushSubscriptions.set(subscription.endpoint, subscription);

  sendJson(res, 202, {
    ok: true,
    count: pushSubscriptions.size,
    message: 'Subscription stored. Configure a push sender with VAPID keys before production delivery.'
  });
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
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
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