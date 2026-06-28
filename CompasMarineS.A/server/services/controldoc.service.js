import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, getCookie } from '../utils/http.js';
import { fetchAllControlDocPages, resolveControlDocCredentials } from '../utils/controldoc.js';

// --- CACHÉ ULTRA RÁPIDA Y GLOBAL (V2 BLINDADA) ---
// Forzamos el reinicio si viene del script antiguo
if (!global.serverCache || !global.serverCache._isV2) {
  global.serverCache = {
    _isV2: true,
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
  console.log(`\n🚨 [API] Petición interceptada por el backend: ${cleanPath}`);
  
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const cookieUserId = getCookie(req, 'compas_user_id');
  if (!cookieUserId) return sendJson(res, 401, { error: 'No autorizado. Inicia sesión.' });

  let userEmail = '';
  let isAdmin = false;

  try {
    const [userRows] = await dbPool.execute(`SELECT u.email, r.nombre as rol FROM usuarios u LEFT JOIN usuarios_roles ur ON u.id = ur.usuario_id LEFT JOIN roles r ON ur.rol_id = r.id WHERE u.id = ? AND u.activo = TRUE`, [cookieUserId]);
    if (userRows.length === 0) return sendJson(res, 401, { error: 'Usuario inválido.' });
    
    userEmail = userRows[0].email;
    const rolStr = (userRows[0].rol || '').toLowerCase().trim();
    
    isAdmin = ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(rolStr) || userEmail === 'admin@compasmarine.cl';
    console.log(`➡️ [API] Validado: ${userEmail} | Es Admin: ${isAdmin}`);
  } catch (error) {
    console.error("❌ [API] Error BD Usuarios:", error);
    return sendJson(res, 500, { error: 'Error interno de BD' }); 
  }

  const upstreamPath = controlDocRoutes.get(cleanPath);
  if (!upstreamPath) return sendJson(res, 404, { error: 'Ruta no mapeada' });

  const credentials = resolveControlDocCredentials(req);
  if (!credentials.email || !credentials.token) {
    console.error("❌ [API] Faltan credenciales API_USER_EMAIL o TOKEN.");
    return sendJson(res, 500, { error: 'Error de configuración del servidor' });
  }

  const now = Date.now();

  try {
    const serveWithSWR = async (cacheKey) => {
      const cacheStore = global.serverCache[cacheKey];
      
      // Si la caché está poblada y tiene datos reales, devolver la data inmediatamente
      if (cacheStore.data !== null && Array.isArray(cacheStore.data) && cacheStore.data.length > 0) {
        console.log(`🟢 [Caché] Sirviendo ${cacheStore.data.length} items de ${cacheKey} desde RAM.`);
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
      
      // Si la caché está vacía (0 items o null), bloqueamos e iniciamos descarga
      if (!cacheStore.isFetching) {
         cacheStore.isFetching = true;
         console.log(`🟡 [Caché] Memoria vacía para ${cacheKey}. Iniciando descarga obligatoria...`);
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
      
      const myEntity = allEntities.find(e => {
         const eEmail = (e.email || e.custom_fields?.correo_electronico_personal || '').trim().toLowerCase();
         return eEmail === userEmail.toLowerCase();
      });
      const myExternalId = myEntity ? myEntity.id?.toString() : null;
      
      dataToSend = allEntities.filter(item => item && item.id?.toString() === myExternalId);
      return sendJson(res, 200, dataToSend);
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

      dataToSend = allDocs.filter(doc => doc && doc.entity_id?.toString() === myExternalId);
      return sendJson(res, 200, dataToSend);
    }

    return sendJson(res, 404, { error: 'Endpoint no soportado' });
  } catch (err) {
    if (err.message === '502_BACKGROUND_TASK') {
        return sendJson(res, 502, { error: 'El servidor está procesando datos masivos en 2do plano.' });
    }
    console.error(`❌ [API] Error grave procesando request:`, err);
    return sendJson(res, 500, { error: 'Error procesando la solicitud' });
  }
}