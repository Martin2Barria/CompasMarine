import { getCookie } from './http.js';

export function getControlDocBaseUrl() {
  const url = process.env.CONTROLDOC_BASE_URL || 'https://compliance.controldoc.legal';
  return url.replace(/\/+$/, '');
}

export function resolveControlDocCredentials(req) {
  // 1. PRIORIDAD MÁXIMA: Leemos directamente de tus variables en Railway
  const email = process.env.API_USER_EMAIL || process.env.CONTROLDOC_USER_EMAIL || '';
  const token = process.env.API_USER_TOKEN || process.env.CONTROLDOC_USER_TOKEN || '';
  const customerId = process.env.API_CUSTOMER_ID || process.env.CONTROLDOC_CUSTOMER_ID || '';
  const globalEntityTypes = process.env.API_ENTITY_TYPE_IDS || process.env.CONTROLDOC_ENTITY_TYPE_IDS || '467, 468, 469';
  const authorization = process.env.CONTROLDOC_AUTHORIZATION || '';

  const entityTypeIds = String(globalEntityTypes).split(',').map(id => id.trim()).filter(Boolean);

  return {
    email,
    token,
    customerId,
    entityTypeIds: entityTypeIds.length > 0 ? entityTypeIds : ['467', '468', '469'],
    authorization
  };
}

export async function fetchAllControlDocPages(upstreamPath, credentials, extraParams = {}) {
  let globalItems = [];
  const baseUrl = getControlDocBaseUrl();

  try {
    console.log(`[ControlDoc] Iniciando Mega-Descarga. IDs a procesar: [ ${credentials.entityTypeIds.join(', ')} ]`);

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
            allItems.push(...items);
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
  
  return Array.from(new Map(globalItems.filter(i => i && i.id).map(item => [item.id, item])).values());
}