import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, getCookie } from '../utils/http.js';

// --- CACHÉ PERSISTENTE GLOBAL ---
global.serverCache = global.serverCache || {
  documentTypes: { data: [], expiresAt: 0, isFetching: false },
  entities: { data: [], expiresAt: 0, isFetching: false },
  documents: { data: [], expiresAt: 0, isFetching: false } 
};
const CACHE_TTL = 12 * 60 * 60 * 1000;

export const controlDocRoutes = new Map([
  ['/api/controldoc/document-types', '/api/v1/abstract/document_types'],
  ['/api/controldoc/entities', '/api/v1/abstract/entities'],
  ['/api/controldoc/documents', '/api/v1/abstract/documents']
]);

function resolveCredentials() {
    return {
        email: process.env.API_USER_EMAIL || process.env.CONTROLDOC_USER_EMAIL || '',
        token: process.env.API_USER_TOKEN || process.env.CONTROLDOC_USER_TOKEN || '',
        customerId: process.env.API_CUSTOMER_ID || process.env.CONTROLDOC_CUSTOMER_ID || '',
        entityTypeIds: ['467', '468', '469'] 
    };
}

async function fetchAllControlDocPages(upstreamPath, credentials) {
    let globalItems = [];
    const baseUrl = (process.env.CONTROLDOC_BASE_URL || 'https://compliance.controldoc.legal').replace(/\/+$/, '');
    
    try {
        for (const entityTypeId of credentials.entityTypeIds) {
            let allItems = [];
            let currentPage = 1;
            let hasMore = true;
            
            const headers = {
                'Content-Type': 'application/json',
                'X-User-Email': credentials.email,
                'X-User-Token': credentials.token,
                'Customer-Id': credentials.customerId,
                'Entity-Type-Id': entityTypeId
            };

            while (hasMore && currentPage <= 30) {
                const batchPromises = [];
                for (let i = 0; i < 3; i++) {
                    const page = currentPage + i;
                    const url = new URL(upstreamPath, baseUrl);
                    url.searchParams.append('page', page);
                    url.searchParams.append('per_page', '100');
                    
                    batchPromises.push(
                        fetch(url, { method: 'GET', headers, redirect: 'follow' })
                        .then(res => res.ok ? res.json() : null)
                        .catch(() => null)
                    );
                }
                const batchResults = await Promise.all(batchPromises);
                for (const json of batchResults) {
                    if (!json) { hasMore = false; continue; }
                    let items = Array.isArray(json) ? json : (Object.values(json).find(v => Array.isArray(v)) || []);
                    if (items.length === 0) hasMore = false;
                    else {
                        allItems.push(...items);
                        if (items.length < 25) hasMore = false;
                    }
                }
                currentPage += 3;
                if (hasMore) await new Promise(r => setTimeout(r, 150));
            }
            globalItems.push(...allItems);
        }
    } catch (err) {
        console.error("[ControlDoc] Error en descarga masiva:", err);
    }
    return Array.from(new Map(globalItems.filter(i => i && i.id).map(item => [item.id, item])).values());
}

export async function proxyControlDocRequest(req, res, requestUrl, cleanPath) {
    console.log(`\n➡️ [Proxy API] Petición entrante desde Frontend a: ${cleanPath}`);

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    
    const cookieUserId = getCookie(req, 'compas_user_id');
    if (!cookieUserId) {
        console.warn("⚠️ [Proxy API] No hay cookie de sesión.");
        return sendJson(res, 401, { error: 'No autorizado. Inicia sesión.' });
    }

    let userEmail = '';
    let isAdmin = false;

    try {
        const [userRows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
        if (userRows.length === 0) {
            console.warn(`⚠️ [Proxy API] Usuario ID ${cookieUserId} no encontrado en MySQL.`);
            return sendJson(res, 401, { error: 'Usuario inválido.' });
        }
        
        userEmail = userRows[0].email;
        const rolStr = (userRows[0].rol || '').toLowerCase().trim();
        
        isAdmin = ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(rolStr) || userEmail === 'admin@compasmarine.cl';
        console.log(`👤 [Proxy API] Validado en MySQL: ${userEmail} | Rol: ${rolStr} | Es Admin: ${isAdmin}`);
    } catch (error) {
        console.error("❌ [Proxy API] Falló conexión con BD MySQL al validar usuario:", error.message);
        return sendJson(res, 500, { error: 'Error de base de datos local' });
    }

    const upstreamPath = controlDocRoutes.get(cleanPath);
    if (!upstreamPath) return sendJson(res, 404, { error: 'Not found' });

    const credentials = resolveCredentials();
    if (!credentials.email || !credentials.token) {
        console.error("❌ [Proxy API] Faltan credenciales API_USER_EMAIL o TOKEN en variables de entorno.");
        return sendJson(res, 200, []);
    }

    try {
        const serveWithSWR = async (cacheKey) => {
            const cacheStore = global.serverCache[cacheKey];
            
            if (cacheStore.data && cacheStore.data.length > 0) {
                console.log(`🟢 [Caché] Entregando ${cacheStore.data.length} registros de ${cacheKey} directo desde RAM.`);
                return cacheStore.data;
            }
            
            console.warn(`🟡 [Caché] Memoria vacía para ${cacheKey}. Lanzando aviso 502 al Frontend.`);
            
            if (!cacheStore.isFetching) {
                cacheStore.isFetching = true;
                console.log(`📥 [Caché] Iniciando auto-rescate: descargando ${cacheKey} en 2do plano...`);
                fetchAllControlDocPages(upstreamPath, credentials).then(data => {
                    if (data && data.length > 0) {
                        global.serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL, isFetching: false };
                        console.log(`✅ [Caché] Rescate exitoso: ${cacheKey} cargó ${data.length} en RAM.`);
                    } else {
                        global.serverCache[cacheKey].isFetching = false;
                    }
                }).catch(() => { global.serverCache[cacheKey].isFetching = false; });
            }
            
            throw new Error('502_BACKGROUND_TASK');
        };

        if (upstreamPath === '/api/v1/abstract/document_types') {
            const types = await serveWithSWR('documentTypes');
            return sendJson(res, 200, types);
        }

        if (upstreamPath === '/api/v1/abstract/entities') {
            const allEntities = await serveWithSWR('entities');
            if (isAdmin) {
                console.log(`🚀 [Proxy API] Entregando TODOS los ${allEntities.length} usuarios al Admin.`);
                return sendJson(res, 200, allEntities);
            }
            
            const myEntity = allEntities.find(e => {
                const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
                return eEmail === userEmail.toLowerCase();
            });
            const myExternalId = myEntity ? myEntity.id?.toString() : null;
            
            const filtered = allEntities.filter(item => item && item.id?.toString() === myExternalId);
            return sendJson(res, 200, filtered);
        }

        if (upstreamPath === '/api/v1/abstract/documents') {
            const allDocs = await serveWithSWR('documents');
            if (isAdmin) {
                console.log(`🚀 [Proxy API] Entregando TODOS los ${allDocs.length} documentos al Admin.`);
                return sendJson(res, 200, allDocs);
            }
            
            const allEntities = await serveWithSWR('entities');
            const myEntity = allEntities.find(e => {
                const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
                return eEmail === userEmail.toLowerCase();
            });
            const myExternalId = myEntity ? myEntity.id?.toString() : null;

            const filtered = allDocs.filter(doc => doc && doc.entity_id?.toString() === myExternalId);
            return sendJson(res, 200, filtered);
        }

        return sendJson(res, 200, []);
    } catch (err) {
        if (err.message === '502_BACKGROUND_TASK') {
            return sendJson(res, 502, { error: 'El servidor está procesando datos masivos en 2do plano.' });
        }
        console.error(`❌ [Proxy API] Error no controlado:`, err.stack);
        return sendJson(res, 500, { error: 'Error interno procesando datos.' });
    }
}

export async function handleSyncUsersToDB(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const credentials = resolveCredentials();
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
      
      const entityTypeToSave = entity.entity_type_id || credentials.entityTypeIds[0];

      await dbPool.execute(`
        INSERT INTO entidades_api (external_id, identifier, nombre, sexo, rut, email, telefono, customer_id, entity_type_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE identifier=VALUES(identifier), nombre=VALUES(nombre), sexo=VALUES(sexo), rut=VALUES(rut), email=VALUES(email), telefono=VALUES(telefono), data_json=VALUES(data_json), sincronizado_en=CURRENT_TIMESTAMP
      `, [external_id, identifier, nombre, sexo, rut, email, telefono, credentials.customerId, entityTypeToSave, jsonString]);
      insertados++;
    }
    sendJson(res, 200, { ok: true, message: `Sincronizados ${insertados} usuarios.` });
  } catch (error) {
    sendJson(res, 500, { error: 'Fallo al sincronizar' });
  }
}

export async function handleSetupDB(req, res) {
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
      `CREATE TABLE IF NOT EXISTS sync_logs (id INT AUTO_INCREMENT PRIMARY KEY, tipo VARCHAR(100) NOT NULL, estado ENUM('exitoso', 'fallido') NOT NULL, mensaje TEXT, registros_procesados INT DEFAULT 0, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const query of queries) await dbPool.query(query);

    sendJson(res, 200, { ok: true, message: 'Tablas verificadas.' });
  } catch (error) { sendJson(res, 500, { error: 'Fallo DB' }); }
}

export async function handleDocumentsSync(req, res) {
  global.serverCache.documents = { data: [], expiresAt: 0, isFetching: false };
  global.serverCache.entities = { data: [], expiresAt: 0, isFetching: false };
  global.serverCache.documentTypes = { data: [], expiresAt: 0, isFetching: false };
  sendJson(res, 200, { ok: true, message: 'Caché limpio.' });
}