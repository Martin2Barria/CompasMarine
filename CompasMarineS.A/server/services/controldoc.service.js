import { dbPool } from '../config/db.js';
import { sendJson } from '../utils/http.js';
import { getSessionUserId } from '../utils/session.js';
import { fetchAllControlDocPages, resolveControlDocCredentials } from '../utils/controldoc.js';
import { requireSameOriginRequest } from '../utils/security.js';

// --- CACHÉ PERSISTENTE GLOBAL (V4 - BACKEND GATEKEEPER) ---
if (!global.serverCache || !global.serverCache._v4) {
    global.serverCache = {
        _v4: true,
        documentTypes: { data: null, expiresAt: 0, isFetching: false },
        entities: { data: null, expiresAt: 0, isFetching: false },
        documents: { data: null, expiresAt: 0, isFetching: false }
    };
}
const CACHE_TTL = 12 * 60 * 60 * 1000;

export const controlDocRoutes = new Map([
    ['/api/controldoc/document-types', '/api/v1/abstract/document_types'],
    ['/api/controldoc/entities', '/api/v1/abstract/entities'],
    ['/api/controldoc/documents', '/api/v1/abstract/documents']
]);

export async function proxyControlDocRequest(req, res, requestUrl, cleanPath) {
    console.log(`\n======================================================`);
    console.log(`🚨 [API GATEKEEPER] Petición entrante: ${cleanPath}`);

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

    const cookieUserId = getSessionUserId(req);
    if (!cookieUserId) {
        console.warn(`❌ [API] No autorizado. Faltan cookies.`);
        return sendJson(res, 401, { error: 'No autorizado' });
    }

    let userEmail = '';
    let isAdmin;

    try {
        const [userRows] = await dbPool.execute(
            `SELECT u.email, r.nombre as rol, r.id as rol_id 
             FROM usuarios u 
             LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id 
             LEFT JOIN roles r ON ur.rol_id = r.id 
             WHERE u.id = ? AND u.activo = TRUE`, 
            [cookieUserId]
        );
        
        if (userRows.length === 0) {
            console.warn(`❌ [API] Usuario ID ${cookieUserId} no encontrado.`);
            return sendJson(res, 401, { error: 'Usuario inactivo.' });
        }
        
        userEmail = userRows[0].email;
        const rolStr = (userRows[0].rol || '').toLowerCase().trim();
        const rolId = userRows[0].rol_id ? Number(userRows[0].rol_id) : null;
        
        // --- LA LLAVE MAESTRA (FILTRO CENTRALIZADO EN EL SERVIDOR) ---
        // IDs Administradores: 2 (Lector Global), 10 (Admin Supremo), 11 (Admin Gestor), 13 (Admin)
        // IDs Usuarios normales: 3 (Usuario), 12 (UsuarioPrueba)
        if (userEmail === 'admin@compasmarine.cl' || (rolId !== null && [2, 10, 11, 13].includes(rolId))) {
            isAdmin = true;
        } else {
            // Fallback por nombre por si la BD falla
            isAdmin = ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(rolStr) || rolStr.includes('admin');
        }
        
        console.log(`➡️ [API] Validado: ${userEmail} | ID Rol: ${rolId} | Nombre Rol: "${rolStr}" | Es Admin: ${isAdmin}`);
    } catch (err) { 
        console.error("❌ [API] Error BD:", err.message);
        return sendJson(res, 500, { error: 'Error interno de BD' }); 
    }

    const upstreamPath = controlDocRoutes.get(cleanPath);
    if (!upstreamPath) return sendJson(res, 404, { error: 'Ruta no mapeada' });

    const credentials = resolveControlDocCredentials(req);
    if (!credentials.email || !credentials.token) {
        console.warn("❌ [Proxy] Faltan credenciales en Railway (API_USER_EMAIL o TOKEN)");
        return sendJson(res, 500, { error: 'Faltan credenciales de ControlDoc' });
    }

    const getCacheKey = (path) => {
        if (path.includes('document-types')) return 'documentTypes';
        if (path.includes('entities')) return 'entities';
        return 'documents';
    };
    const cacheKey = getCacheKey(cleanPath);

    try {
        const cacheStore = global.serverCache[cacheKey];
        
        if (cacheStore.data !== null && Array.isArray(cacheStore.data) && cacheStore.data.length > 0) {
            console.log(`🟢 [Caché] Sirviendo ${cacheStore.data.length} items de ${cacheKey} desde RAM.`);
            
            let dataToSend = cacheStore.data;

            // Los tipos de documento (metadatos) son públicos para todos
            if (cacheKey === 'documentTypes') {
                return sendJson(res, 200, dataToSend);
            }

            // SI ES ADMIN (IDs 2, 10, 11, 13), SE ENVÍA TODO SIN FILTRAR NADA
            if (isAdmin) {
                console.log(`🚀 [API] Bypass de Admin activado. Enviando TODOS los datos (${dataToSend.length}).`);
                return sendJson(res, 200, dataToSend);
            }
            
            // --- FILTRADO ESTRICTO PARA TRIPULANTES (IDs 3, 12) ---
            console.log(`🔒 [API] Tripulante detectado. Filtrando información confidencial...`);
            const allEntities = global.serverCache['entities'].data || [];
            let dbRut = '';
            try {
                const [entRows] = await dbPool.execute('SELECT rut FROM entidades_api WHERE email = ?', [userEmail]);
                if (entRows.length > 0) dbRut = (entRows[0].rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
            } catch (error) {
                console.warn('No se pudo leer el RUT local para filtrar ControlDoc:', error.message);
            }

            const myEntity = allEntities.find(e => {
                const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
                const eRut = (e.identifier || e.custom_fields?.numero_de_documento || e.rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
                return (eEmail && eEmail === userEmail.toLowerCase()) || (dbRut && eRut && eRut === dbRut);
            });
            
            const myExternalId = myEntity ? myEntity.id?.toString() : null;
            const mySourceEntityTypeId = myEntity?.control_doc_source_entity_type_id?.toString() || '';

            if (!myExternalId) {
                return sendJson(res, 200, []);
            }
            
            if (cacheKey === 'entities') {
                dataToSend = allEntities.filter((item) => item && (
                    item.id?.toString() === myExternalId &&
                    (!mySourceEntityTypeId || item.control_doc_source_entity_type_id?.toString() === mySourceEntityTypeId)
                ));
            } else if (cacheKey === 'documents') {
                dataToSend = cacheStore.data.filter((item) => item && (
                    item.entity_id?.toString() === myExternalId &&
                    (!mySourceEntityTypeId || item.control_doc_source_entity_type_id?.toString() === mySourceEntityTypeId)
                ));
            }
            
            console.log(`👤 [API] Enviando solo ${dataToSend.length} registros que le pertenecen a ${userEmail}.`);
            return sendJson(res, 200, dataToSend);
        }
        
        if (!cacheStore.isFetching) {
            cacheStore.isFetching = true;
            console.log(`🟡 [Caché] RAM vacía para ${cacheKey}. Iniciando descarga masiva obligatoria...`);
            fetchAllControlDocPages(upstreamPath, credentials)
                .then(data => { 
                    if(data && data.length > 0) {
                        global.serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL, isFetching: false }; 
                        console.log(`✅ [Caché] ÉXITO. ${cacheKey} guardó ${data.length} items en RAM.`);
                    } else {
                        global.serverCache[cacheKey].isFetching = false;
                    }
                })
                .catch(err => {
                    console.error(`❌ [Caché] Error descargando ${cacheKey}:`, err);
                    global.serverCache[cacheKey].isFetching = false;
                });
        }
        
        console.log(`⏳ [API] Avisando al Frontend que espere (502) para ${cacheKey}...`);
        return sendJson(res, 502, { error: 'El servidor está procesando datos masivos en 2do plano.' });
    } catch (err) {
        console.error(`❌ [API] Error grave procesando request:`, err);
        return sendJson(res, 500, { error: 'Error procesando la solicitud' });
    }
}

export async function handleDocumentsSync(req, res) {
  if (!requireSameOriginRequest(req, res)) return;
  global.serverCache.documents = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.entities = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.documentTypes = { data: null, expiresAt: 0, isFetching: false };
  sendJson(res, 200, { ok: true, message: 'Caché limpio.' });
}

export async function handleSyncUsersToDB(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;
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
      const entityTypeToSave = entity.control_doc_source_entity_type_id || entity.entity_type_id || credentials.entityTypeIds[0];

      await dbPool.execute(`
        INSERT INTO entidades_api (external_id, identifier, nombre, sexo, rut, email, telefono, customer_id, entity_type_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE identifier=VALUES(identifier), nombre=VALUES(nombre), sexo=VALUES(sexo), rut=VALUES(rut), email=VALUES(email), telefono=VALUES(telefono), data_json=VALUES(data_json), sincronizado_en=CURRENT_TIMESTAMP
      `, [external_id, identifier, nombre, sexo, rut, email, telefono, credentials.customerId, entityTypeToSave, jsonString]);
      insertados++;
    }
    sendJson(res, 200, { ok: true, message: `Sincronizados ${insertados} usuarios.` });
  } catch (error) {
    console.error('Error sincronizando usuarios:', error.message);
    sendJson(res, 500, { error: 'Fallo al sincronizar' });
  }
}

export async function handleSetupDB(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!requireSameOriginRequest(req, res)) return;
  try {
    const queries = [
      `CREATE TABLE IF NOT EXISTS usuarios (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE, descripcion VARCHAR(255))`,
      `CREATE TABLE IF NOT EXISTS usuarios_roles (usuario_id INT NOT NULL, rol_id INT NOT NULL, PRIMARY KEY (usuario_id, rol_id), FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS entidades_api (id INT AUTO_INCREMENT PRIMARY KEY, external_id VARCHAR(100) NOT NULL, identifier VARCHAR(150), nombre VARCHAR(255), sexo VARCHAR(50), rut VARCHAR(50), email VARCHAR(150), telefono VARCHAR(50), customer_id VARCHAR(50), entity_type_id VARCHAR(50), data_json JSON NOT NULL, sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE (external_id, customer_id, entity_type_id))`,
      `CREATE TABLE IF NOT EXISTS tipos_documento_api (id INT AUTO_INCREMENT PRIMARY KEY, external_id VARCHAR(100) NOT NULL UNIQUE, nombre VARCHAR(255) NOT NULL, descripcion TEXT, data_json JSON NOT NULL, sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS documentos_api (id INT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, tipo_documento_id INT NULL, external_id VARCHAR(100) NOT NULL UNIQUE, entidad_external_id VARCHAR(100), nombre VARCHAR(255), estado VARCHAR(100), fecha_emision DATE NULL, fecha_vencimiento DATE NULL, data_json JSON NOT NULL, disponible_offline BOOLEAN NOT NULL DEFAULT FALSE, sincronizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (tipo_documento_id) REFERENCES tipos_documento_api(id) ON DELETE RESTRICT ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS respaldos_documentos (id INT AUTO_INCREMENT PRIMARY KEY, documento_id INT NOT NULL, ruta_archivo VARCHAR(500) NOT NULL, nombre_archivo VARCHAR(255), mime_type VARCHAR(100), peso_bytes BIGINT, hash_archivo VARCHAR(128), descargado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (documento_id) REFERENCES documentos_api(id) ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint_hash CHAR(64) PRIMARY KEY, user_id INT NULL, endpoint TEXT NOT NULL, subscription_json JSON NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, INDEX idx_push_subscriptions_user_id (user_id))`,
      `CREATE TABLE IF NOT EXISTS push_notification_events (event_hash CHAR(64) PRIMARY KEY, user_id INT NULL, event_key TEXT NOT NULL, event_id TEXT NOT NULL, rule_version INT NOT NULL DEFAULT 1, sent_at DATETIME NOT NULL, last_sent_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_push_notification_events_user_id (user_id))`,
      `CREATE TABLE IF NOT EXISTS push_notification_history (event_hash CHAR(64) PRIMARY KEY, history_id VARCHAR(96) NOT NULL, user_id INT NOT NULL, event_id VARCHAR(1024) NOT NULL, notification_group VARCHAR(32) NOT NULL, threshold TINYINT NULL, title VARCHAR(255) NOT NULL, body TEXT NOT NULL, doc_name VARCHAR(255) NOT NULL, expiration_date VARCHAR(100) NULL, days_remaining INT NULL, sent_at DATETIME NOT NULL, last_sent_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_push_notification_history_user_id (user_id), INDEX idx_push_notification_history_last_sent_at (last_sent_at))`,
      `CREATE TABLE IF NOT EXISTS email_notification_events (event_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, event_key VARCHAR(1024) NOT NULL, event_id VARCHAR(1024) NOT NULL, threshold TINYINT NOT NULL, notification_group VARCHAR(32) NOT NULL, title VARCHAR(255) NOT NULL, body TEXT NOT NULL, doc_name VARCHAR(255) NOT NULL, expiration_date VARCHAR(100) NULL, days_remaining INT NULL, provider_id VARCHAR(255) NULL, sent_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_email_notification_events_user_id (user_id), INDEX idx_email_notification_events_sent_at (sent_at))`,
      `CREATE TABLE IF NOT EXISTS sync_logs (id INT AUTO_INCREMENT PRIMARY KEY, tipo VARCHAR(100) NOT NULL, estado ENUM('exitoso', 'fallido') NOT NULL, mensaje TEXT, registros_procesados INT DEFAULT 0, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const query of queries) await dbPool.query(query);
    sendJson(res, 200, { ok: true, message: 'Tablas verificadas.' });
  } catch (error) {
    console.error('Error preparando tablas:', error.message);
    sendJson(res, 500, { error: 'Fallo DB' });
  }
}
