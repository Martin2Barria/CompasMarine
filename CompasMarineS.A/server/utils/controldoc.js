import { getSessionUserId } from './session.js';

export function getControlDocBaseUrl() {
  const url = process.env.CONTROLDOC_BASE_URL || 'https://compliance.controldoc.legal';
  return url.replace(/\/+$/, '');
}

export function resolveControlDocCredentials(req) {
  const byUser = parseJsonEnv('CONTROLDOC_USER_CREDENTIALS_JSON');
  const cookieUserId = req ? getSessionUserId(req) : null;
  const requestedUserId = cookieUserId || process.env.CONTROLDOC_DEFAULT_USER_ID;

  // 1. PRIORIDAD MÁXIMA: Leemos la variable global con las comas
  const globalEntityTypes = process.env.API_ENTITY_TYPE_IDS || process.env.CONTROLDOC_ENTITY_TYPE_IDS;

  if (byUser && typeof byUser === 'object') {
    const profile = byUser[requestedUserId] || byUser[process.env.CONTROLDOC_DEFAULT_USER_ID] || Object.values(byUser)[0];
    if (profile) return normalizeCredentialProfile(profile, globalEntityTypes);
  }

  return normalizeCredentialProfile({
    email: process.env.CONTROLDOC_USER_EMAIL || process.env.API_USER_EMAIL,
    token: process.env.CONTROLDOC_USER_TOKEN || process.env.API_USER_TOKEN,
    customerId: process.env.CONTROLDOC_CUSTOMER_ID || process.env.API_CUSTOMER_ID,
    entityTypeId: process.env.CONTROLDOC_ENTITY_TYPE_ID || '467, 468, 469',
    authorization: process.env.CONTROLDOC_AUTHORIZATION
  }, globalEntityTypes);
}

function normalizeCredentialProfile(profile, globalEntityTypes) {
  // 2. MAGIA: Modificamos el fallback por defecto aquí también
  const rawEntityTypes = globalEntityTypes || profile.entityTypeIds || profile.entityTypeId || profile.entity_type_id || '467, 468, 469';
  const entityTypeIds = String(rawEntityTypes).split(',').map(id => id.trim()).filter(Boolean);

  return {
    email: profile.email || profile.userEmail || '',
    token: profile.token || profile.userToken || '',
    customerId: profile.customerId || profile.customer_id || process.env.CONTROLDOC_CUSTOMER_ID || '',
    entityTypeIds: entityTypeIds.length > 0 ? entityTypeIds : ['467', '468', '469'],
    authorization: profile.authorization || process.env.CONTROLDOC_AUTHORIZATION || ''
  };
}

function parseJsonEnv(key) {
  if (!process.env[key]) return null;
  try { return JSON.parse(process.env[key]); } catch { return null; }
}

export async function fetchAllControlDocPages(upstreamPath, credentials, extraParams = {}) {
  let globalItems = [];
  const baseUrl = getControlDocBaseUrl();

  try {
    // 3. Imprimimos los IDs que vamos a procesar para estar 100% seguros
    console.log(`[ControlDoc] Iniciando Mega-Descarga. IDs a procesar: [ ${credentials.entityTypeIds.join(', ')} ]`);

    // 4. Bucle por cada ID de sucursal/empresa
    for (const entityTypeId of credentials.entityTypeIds) {
      console.log(`[ControlDoc] Iniciando descarga en ${upstreamPath} para Entity Type ID: ${entityTypeId}...`);
      let allItems = [];
      let currentPage = 1;
      let hasMore = true;
      
      const headers = {
        'Content-Type': 'application/json',
        'X-User-Email': credentials.email || '',
        'X-User-Token': credentials.token || '',
        'Customer-Id': credentials.customerId || '',
        'Entity-Type-Id': entityTypeId
      };
      if (credentials.authorization) headers.AUTHORIZATION = credentials.authorization;

      while (hasMore && currentPage <= 30) { 
        const batchPromises = [];
        
        for (let i = 0; i < 3; i++) { 
          const page = currentPage + i;
          const url = new URL(upstreamPath, baseUrl);
          url.searchParams.append('page', page);
          url.searchParams.append('per_page', '100');
          
          for (const [k, v] of Object.entries(extraParams)) {
            if (v) url.searchParams.append(k, v);
          }

          batchPromises.push(
            fetch(url, { method: 'GET', headers, redirect: 'follow' })
              .then(async res => {
                if (res.status === 429) {
                  await new Promise(r => setTimeout(r, 1500));
                  return fetch(url, { method: 'GET', headers }).then(r => r.ok ? r.json() : null).catch(() => null);
                }
                if (!res.ok) return null;
                return res.json().catch(() => null);
              })
              .catch(() => null)
          );
        }

        const batchResults = await Promise.all(batchPromises);
        
        for (const json of batchResults) {
          if (!json) { hasMore = false; continue; }
          
          let items = [];
          if (Array.isArray(json)) {
            items = json;
          } else if (typeof json === 'object') {
            const foundArray = Object.values(json).find(v => Array.isArray(v));
            items = foundArray || [];
          }

          if (items.length === 0) {
            hasMore = false;
          } else {
            allItems.push(...items.map((item) => (
              item && typeof item === 'object' && !Array.isArray(item)
                ? { ...item, control_doc_source_entity_type_id: entityTypeId }
                : item
            )));
            if (items.length < 25) hasMore = false; 
          }
        }
        
        currentPage += 3;
        if (hasMore) await new Promise(r => setTimeout(r, 150));
      }
      
      console.log(`[ControlDoc] Finalizada descarga en ${upstreamPath} para ID ${entityTypeId}. Items extraídos: ${allItems.length}`);
      globalItems.push(...allItems);
    }
  } catch (err) {
    console.error("[ControlDoc Engine] Error durante la paginación concurrente:", err);
  }
  
  // Conservamos registros con el mismo ID cuando pertenecen a empresas distintas.
  // Los tipos de documento siguen siendo un catálogo compartido entre empresas.
  const isSharedCatalog = upstreamPath.includes('/document_types');
  return Array.from(new Map(
    globalItems
      .filter((item) => item && item.id)
      .map((item) => [
        isSharedCatalog ? item.id : `${item.control_doc_source_entity_type_id}:${item.id}`,
        item
      ])
  ).values());
}
