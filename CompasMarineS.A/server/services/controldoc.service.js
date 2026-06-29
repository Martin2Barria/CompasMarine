import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, getCookie } from '../utils/http.js';
import { fetchAllControlDocPages, resolveControlDocCredentials } from '../utils/controldoc.js';

// --- CACHÉ ULTRA RÁPIDA Y GLOBAL (V4 BLINDADA CON RUT) ---
if (!global.serverCache || !global.serverCache._v4) {
  global.serverCache = {
    _v4: true,
    documentTypes: { data: null, expiresAt: 0, isFetching: false },
    entities: { data: null, expiresAt: 0, isFetching: false },
    documents: { data: null, expiresAt: 0, isFetching: false } 
  };
}
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
  let dbRut = ''; // <-- NUEVO: Guardaremos el RUT desde la base de datos local

  try {
    const [userRows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario inválido.' });
    
    userEmail = userRows[0].email;
    const rolStr = (userRows[0].rol || '').toLowerCase().trim();
    
    // Si la palabra "admin" está en cualquier parte del rol, lo deja pasar.
    isAdmin = rolStr.includes('admin') || rolStr.includes('lector') || userEmail === 'admin@compasmarine.cl';
    
    // Obtenemos el RUT del tripulante desde la base local para buscarlo luego en ControlDoc
    if (!isAdmin) {
      const [entRows] = await dbPool.execute('SELECT rut FROM entidades_api WHERE email = ?', [userEmail]);
      if (entRows.length > 0 && entRows[0].rut) {
          dbRut = entRows[0].rut.replace(/[^0-9kK]/g, '').toLowerCase();
      }
    }

  } catch (error) {
    console.error("❌ [API] Error BD Usuarios:", error);
    return sendJson(res, 500, { error: 'Error interno de BD' }); 
  }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  if (!upstreamPath) return sendJson(res, 404, { error: 'Ruta no mapeada' });

  const credentials = resolveControlDocCredentials(req);
  if (!credentials.email || !credentials.token) {
    return sendJson(res, 500, { error: 'Error de configuración del servidor' });
  }

  const now = Date.now();

  try {
    const serveWithSWR = async (cacheKey) => {
      const cacheStore = global.serverCache[cacheKey];
      
      // Si la caché tiene datos, devolverlos
      if (cacheStore.data !== null && Array.isArray(cacheStore.data) && cacheStore.data.length > 0) {
        if (cacheStore.expiresAt < now && !cacheStore.isFetching) {
          cacheStore.isFetching = true;
          fetchAllControlDocPages(upstreamPath, credentials)
            .then(data => { 
                if(data && data.length > 0) {
                    global.serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL, isFetching: false }; 
                } else {
                    global.serverCache[cacheKey].isFetching = false;
                }
            })
            .catch(() => { global.serverCache[cacheKey].isFetching = false; });
        }
        return cacheStore.data;
      }
      
      // Si la caché está vacía, iniciamos descarga
      if (!cacheStore.isFetching) {
         cacheStore.isFetching = true;
         fetchAllControlDocPages(upstreamPath, credentials)
            .then(data => { 
                if(data && data.length > 0) {
                   global.serverCache[cacheKey] = { data, expiresAt: Date.now() + CACHE_TTL, isFetching: false }; 
                } else {
                   global.serverCache[cacheKey].isFetching = false;
                }
            })
            .catch(err => {
                global.serverCache[cacheKey].isFetching = false;
            });
      }
      
      throw new Error('502_BACKGROUND_TASK');
    };

    let dataToSend = [];

    if (upstreamPath === '/api/v1/abstract/document_types') {
        dataToSend = await serveWithSWR('documentTypes');
        return sendJson(res, 200, dataToSend);
    }

    if (upstreamPath === '/api/v1/abstract/entities') {
      const allEntities = await serveWithSWR('entities');
      if (isAdmin) return sendJson(res, 200, allEntities);
      
      // Búsqueda de Tripulante por Correo o RUT (Evita que se quede en 0)
      const myEntity = allEntities.find(e => {
         const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
         const eRut = (e.identifier || e.custom_fields?.numero_de_documento || e.rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
         return (eEmail && eEmail === userEmail.toLowerCase()) || (dbRut && eRut && eRut === dbRut);
      });
      const myExternalId = myEntity ? myEntity.id?.toString() : null;
      
      dataToSend = allEntities.filter(item => item && item.id?.toString() === myExternalId);
      return sendJson(res, 200, dataToSend);
    }

    if (upstreamPath === '/api/v1/abstract/documents') {
      const allDocs = await serveWithSWR('documents');
      if (isAdmin) return sendJson(res, 200, allDocs);
      
      // Búsqueda de Tripulante por Correo o RUT (Evita que se quede en 0)
      const allEntities = await serveWithSWR('entities'); 
      const myEntity = allEntities.find(e => {
         const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
         const eRut = (e.identifier || e.custom_fields?.numero_de_documento || e.rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
         return (eEmail && eEmail === userEmail.toLowerCase()) || (dbRut && eRut && eRut === dbRut);
      });
      const myExternalId = myEntity ? myEntity.id?.toString() : null;

      dataToSend = allDocs.filter(doc => doc && doc.entity_id?.toString() === myExternalId);
      return sendJson(res, 200, dataToSend);
    }

    return sendJson(res, 404, { error: 'Endpoint no soportado' });
  } catch (err) {
    if (err.message === '502_BACKGROUND_TASK') {
        return sendJson(res, 502, { error: 'El servidor está procesando datos masivos en 2do plano.' });
    }
    return sendJson(res, 500, { error: 'Error procesando la solicitud' });
  }
}

export async function handleDocumentsSync(req, res) {
  global.serverCache.documents = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.entities = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.documentTypes = { data: null, expiresAt: 0, isFetching: false };
  sendJson(res, 200, { ok: true, message: 'Caché limpio.' });
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
      const entityTypeToSave = entity.entity_type_id || credentials.entityTypeIds[0];

      await dbPool.execute(`
        INSERT INTO entidades_api (external_id, identifier, nombre, sexo, rut, email, telefono, customer_id, entity_type_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE identifier=VALUES(identifier), nombre=VALUES(nombre), sexo=VALUES(sexo), rut=VALUES(rut), email=VALUES(email), telefono=VALUES(telefono), data_json=VALUES(data_json), sincronizado_en=CURRENT_TIMESTAMP
      `, [external_id, identifier, nombre, sexo, rut, email, telefono, credentials.customerId, entityTypeToSave, jsonString]);
      insertados++;
    }
    sendJson(res, 200, { ok: true, message: `Sincronizados ${insertados} usuarios.` });
  } catch (error) { sendJson(res, 500, { error: 'Fallo al sincronizar' }); }
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
      `INSERT IGNORE INTO roles (nombre, descripcion) VALUES ('Admin Supremo', 'Administrador del sistema')`,
      `INSERT IGNORE INTO roles (nombre, descripcion) VALUES ('Usuario', 'Tripulante / Usuario estándar')`
    ];
    for (const query of queries) await dbPool.query(query);

    const [adminCheck] = await dbPool.execute('SELECT id FROM usuarios WHERE email = "admin@compasmarine.cl"');
    if (adminCheck.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      const [insertUser] = await dbPool.execute('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)', ['Super Administrador', 'admin@compasmarine.cl', hash]);
      const [roleCheck] = await dbPool.execute('SELECT id FROM roles WHERE nombre = "Admin Supremo"');
      if (roleCheck.length > 0) await dbPool.execute('INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES (?, ?)', [insertUser.insertId, roleCheck[0].id]);
    }
    sendJson(res, 200, { ok: true, message: 'Tablas creadas' });
  } catch (error) { sendJson(res, 500, { error: 'Fallo DB' }); }
}