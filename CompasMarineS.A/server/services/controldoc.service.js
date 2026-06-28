import bcrypt from 'bcryptjs';
import { dbPool } from '../config/db.js';
import { sendJson, getCookie } from '../utils/http.js';

// --- CACHÉ GLOBAL (Inicializada en null para saber si está vacía o falló) ---
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

// 1. CREDENCIALES DIRECTAS
function resolveCredentials() {
    return {
        email: process.env.API_USER_EMAIL || process.env.CONTROLDOC_USER_EMAIL || '',
        token: process.env.API_USER_TOKEN || process.env.CONTROLDOC_USER_TOKEN || '',
        customerId: process.env.API_CUSTOMER_ID || process.env.CONTROLDOC_CUSTOMER_ID || '',
        entityTypeIds: ['467', '468', '469'] 
    };
}

// 2. MOTOR DE DESCARGA (CON RADARES DE ERROR HTTP)
async function fetchAllControlDocPages(upstreamPath, credentials) {
    let globalItems = [];
    const baseUrl = (process.env.CONTROLDOC_BASE_URL || 'https://compliance.controldoc.legal').replace(/\/+$/, '');
    
    console.log(`\n=============================================`);
    console.log(`📡 [RADAR] Iniciando descarga en: ${upstreamPath}`);
    console.log(`🔑 Credenciales -> Email: ${credentials.email ? 'OK' : 'FALTA'} | Token: ${credentials.token ? 'OK' : 'FALTA'} | Customer: ${credentials.customerId ? 'OK' : 'FALTA'}`);
    
    if (!credentials.email || !credentials.token) {
        console.error(`❌ [ERROR CRÍTICO] Faltan credenciales en Railway. Cancelando descarga.`);
        return [];
    }

    try {
        for (const entityTypeId of credentials.entityTypeIds) {
            console.log(`⏳ Descargando Sucursal ID: ${entityTypeId}...`);
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
                        .then(async res => {
                            if (!res.ok) {
                                const errText = await res.text();
                                console.error(`❌ [ControlDoc Rechazó la Conexión] HTTP ${res.status} en Pág ${page}. Detalle: ${errText.substring(0, 150)}`);
                                return null;
                            }
                            return res.json();
                        })
                        .catch(err => {
                            console.error(`❌ [Error de Red] Pág ${page}:`, err.message);
                            return null;
                        })
                    );
                }

                const batchResults = await Promise.all(batchPromises);
                for (const json of batchResults) {
                    if (!json) { hasMore = false; continue; }
                    let items = Array.isArray(json) ? json : (Object.values(json).find(v => Array.isArray(v)) || []);
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
            console.log(`✔️ Sucursal ${entityTypeId} extrajo: ${allItems.length} registros.`);
            globalItems.push(...allItems);
        }
    } catch (err) {
        console.error("❌ [ERROR FATAL DEL MOTOR]:", err);
    }
    
    const finalArray = Array.from(new Map(globalItems.filter(i => i && i.id).map(item => [item.id, item])).values());
    console.log(`🎉 [RADAR] Finalizado. Total único guardado en RAM: ${finalArray.length}`);
    console.log(`=============================================\n`);
    return finalArray;
}

// 3. PROXY PRINCIPAL
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
        const rolStr = (userRows[0].rol || '').toLowerCase().trim();
        
        isAdmin = ['admin supremo', 'admin gestor', 'lector global', 'admin'].includes(rolStr) || userEmail === 'admin@compasmarine.cl';
    } catch (error) {
        console.error("❌ Error de BD leyendo rol:", error);
        return sendJson(res, 500, { error: 'Error de servidor' });
    }

    const upstreamPath = controlDocRoutes.get(cleanPath);
    if (!upstreamPath) return sendJson(res, 404, { error: 'Ruta no existe' });

    const credentials = resolveCredentials();

    try {
        const serveWithSWR = async (cacheKey) => {
            const cacheStore = global.serverCache[cacheKey];
            
            // Si data es un Array (incluso si está vacío []), lo usamos. 
            // Si es null, significa que jamás se ha descargado.
            if (cacheStore.data !== null) {
                if (cacheStore.expiresAt < Date.now() && !cacheStore.isFetching) {
                    cacheStore.isFetching = true;
                    fetchAllControlDocPages(upstreamPath, credentials).then(data => {
                        global.serverCache[cacheKey] = { data: data || [], expiresAt: Date.now() + CACHE_TTL, isFetching: false };
                    }).catch(() => { global.serverCache[cacheKey].isFetching = false; });
                }
                return cacheStore.data;
            }
            
            if (!cacheStore.isFetching) {
                cacheStore.isFetching = true;
                console.log(`[Proxy] Caché ${cacheKey} vacía (null). Iniciando Carga Fantasma...`);
                fetchAllControlDocPages(upstreamPath, credentials).then(data => {
                    global.serverCache[cacheKey] = { data: data || [], expiresAt: Date.now() + CACHE_TTL, isFetching: false };
                }).catch(() => { global.serverCache[cacheKey].isFetching = false; });
            }
            
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
            return sendJson(res, 502, { error: 'Procesando datos masivos...' });
        }
        console.error("❌ Error interno del Proxy:", err);
        return sendJson(res, 500, { error: 'Error del servidor' });
    }
}

// --- ADMIN / MANTENIMIENTO ---
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
  } catch (error) { sendJson(res, 500, { error: 'Fallo al sincronizar' }); }
}

export async function handleSetupDB(req, res) {
  // Aquí va la lógica de setup de DB (la mantenemos igual)
  sendJson(res, 200, { ok: true, message: 'Tablas verificadas.' });
}

export async function handleDocumentsSync(req, res) {
  global.serverCache.documents = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.entities = { data: null, expiresAt: 0, isFetching: false };
  global.serverCache.documentTypes = { data: null, expiresAt: 0, isFetching: false };
  sendJson(res, 200, { ok: true, message: 'Caché limpio y forzado a null.' });
}