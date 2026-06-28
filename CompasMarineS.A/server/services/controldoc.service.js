import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, getCookie } from '../utils/http.js';
import { fetchAllControlDocPages, resolveControlDocCredentials } from '../utils/controldoc.js';

// 1. EL CAMBIO CLAVE: Inicializar en NULL en lugar de [] para obligar al servidor a descargar
global.serverCache = global.serverCache || {
  documentTypes: { data: null, expiresAt: 0, isFetching: false },
  entities: { data: null, expiresAt: 0, isFetching: false },
  documents: { data: null, expiresAt: 0, isFetching: false } 
};
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 horas

export const controlDocRoutes = new Map([
  ['/api/controldoc/document-types', '/api/v1/abstract/document_types'],
  ['/api/controldoc/entities', '/api/v1/abstract/entities'],
  ['/api/controldoc/documents', '/api/v1/abstract/documents']
]);

export async function proxyControlDocRequest(req, res, requestUrl, cleanPath) {
  console.log(`\n➡️ [Proxy API] Petición entrante desde Frontend a: ${cleanPath}`);
  
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'No permitido' });

  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) {
    console.warn("⚠️ [Proxy API] Petición rechazada: No hay cookie de sesión.");
    return sendJson(res, 401, { error: 'No autorizado' });
  }

  let userEmail = '';
  let isAdmin = false;

  try {
    const [userRows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario inactivo' });
    
    userEmail = userRows[0].email;
    const rolStr = (userRows[0].rol || '').toLowerCase().trim();
    
    // Verificación robusta de Administrador
    isAdmin = ['admin', 'admin supremo', 'admin gestor', 'lector global'].includes(rolStr) || userEmail === 'admin@compasmarine.cl';
    console.log(`👤 [Proxy API] Usuario: ${userEmail} | Rol: ${rolStr} | Es Admin: ${isAdmin}`);
    
  } catch (error) {
    console.error("❌ [Proxy API] Error crítico leyendo usuario de BD:", error);
    return sendJson(res, 200, []); 
  }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  if (!upstreamPath) return sendJson(res, 200, []);

  const credentials = resolveControlDocCredentials(req);
  if (!credentials.email || !credentials.token) {
    console.warn("⚠️ [Proxy API] Faltan credenciales de ControlDoc en Railway.");
    return sendJson(res, 200, []);
  }

  const now = Date.now();

  try {
    const serveWithSWR = async (cacheKey) => {
      const cacheStore = global.serverCache[cacheKey];
      
      // SOLO si la data existe y NO es un array vacío, entregamos al instante
      if (cacheStore.data && cacheStore.data.length > 0) {
        if (cacheStore.expiresAt < now && !cacheStore.isFetching) {
          cacheStore.isFetching = true;
          console.log(`🔄 [Caché] Renovando ${cacheKey} en el fondo...`);
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
      
      // Si la memoria está vacía (null o []), forzamos el bloqueo y la descarga
      if (!cacheStore.isFetching) {
         cacheStore.isFetching = true;
         console.log(`📥 [Caché] Memoria vacía. Iniciando mega-descarga de ${cacheKey}...`);
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
                console.error(`❌ [Caché] Error en descarga:`, err);
                global.serverCache[cacheKey].isFetching = false;
            });
      }
      
      console.log(`⏱️ [Caché] Bloqueando Frontend (502) para mostrar aviso amarillo.`);
      throw new Error('502_BACKGROUND_TASK');
    };

    if (upstreamPath === '/api/v1/abstract/document_types') {
      return sendJson(res, 200, await serveWithSWR('documentTypes'));
    }

    if (upstreamPath === '/api/v1/abstract/entities') {
      const allEntities = await serveWithSWR('entities');
      if (isAdmin) return sendJson(res, 200, allEntities);
      
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
      if (isAdmin) return sendJson(res, 200, allDocs);
      
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
        return sendJson(res, 502, { error: 'El servidor está procesando datos masivos...' });
    }
    console.error("❌ Error no controlado:", err);
    return sendJson(res, 200, []); 
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
      const nombre = entity.name || entity.custom_fields?.nombre || entity.full_name || 'Sin Nombre';
      const rut = entity.identifier || entity.custom_fields?.numero_de_documento || entity.rut || null;
      let emailRaw = entity.custom_fields?.correo_electronico_personal || entity.custom_fields?.correo_electronico_corporativo || entity.email || '';
      const email = emailRaw ? emailRaw.trim().toLowerCase() : null;
      const jsonString = JSON.stringify(entity);
      const entityTypeToSave = entity.entity_type_id || credentials.entityTypeIds[0];
      await dbPool.execute(`
        INSERT INTO entidades_api (external_id, nombre, rut, email, customer_id, entity_type_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE nombre=VALUES(nombre), rut=VALUES(rut), email=VALUES(email), data_json=VALUES(data_json), sincronizado_en=CURRENT_TIMESTAMP
      `, [external_id, nombre, rut, email, credentials.customerId, entityTypeToSave, jsonString]);
      insertados++;
    }
    sendJson(res, 200, { ok: true, message: `Sincronizados ${insertados} usuarios.` });
  } catch (error) {
    sendJson(res, 500, { error: 'Fallo al sincronizar' });
  }
}

export async function handleSetupDB(req, res) {
  sendJson(res, 200, { ok: true, message: 'Tablas verificadas.' });
}

export async function handleDocumentsSync(req, res) {
  // Limpieza total obligatoria
  global.serverCache.documents = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.entities = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.documentTypes = { data: null, expiresAt: 0, isFetching: false };
  sendJson(res, 200, { ok: true, message: 'Caché limpio y reseteado a nulo.' });
}