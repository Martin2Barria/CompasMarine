import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, getCookie } from '../utils/http.js';
import { fetchAllControlDocPages, resolveControlDocCredentials } from '../utils/controldoc.js';

// --- CACHÉ ULTRA RÁPIDA (BLINDADA) ---
const serverCache = {
  documentTypes: { data: [], expiresAt: 0 },
  entities: { data: [], expiresAt: 0 },
  documents: { data: [], expiresAt: 0 } 
};
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 horas

export const controlDocRoutes = new Map([
  ['/api/controldoc/document-types', '/api/v1/abstract/document_types'],
  ['/api/controldoc/entities', '/api/v1/abstract/entities'],
  ['/api/controldoc/documents', '/api/v1/abstract/documents']
]);

export async function proxyControlDocRequest(req, res, requestUrl, cleanPath) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado. Inicia sesión.' });

  let userEmail = '';
  let isAdmin = false;

  try {
    const [userRows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario inválido.' });
    userEmail = userRows[0].email;
    const rolStr = userRows[0].rol || '';
    isAdmin = rolStr.toLowerCase() === 'admin';
  } catch (error) {
    return sendJson(res, 200, []); // Fallback seguro
  }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  if (!upstreamPath) return sendJson(res, 200, []);

  const credentials = resolveControlDocCredentials(req);
  const now = Date.now();

  try {
    // 🚀 STALE-WHILE-REVALIDATE: Retorna caché instantánea y actualiza en fondo
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
      return sendJson(res, 200, await serveWithSWR('documentTypes', upstreamPath));
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
    console.warn(`[Proxy Controlado] Error recuperando datos. Retornando lista vacía de seguridad.`);
    return sendJson(res, 200, []); // ESCUDO ANTI 500
  }
}

export async function handleSyncUsersToDB(req, res) {
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
      
      // Asignamos el ID de entidad que le corresponda
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

export async function handleDocumentsSync(req, res) {
  serverCache.documents.data = []; serverCache.entities.data = []; serverCache.documentTypes.data = [];
  sendJson(res, 200, { ok: true, message: 'Caché limpio.' });
}