import { getApiUrl } from '../config/api';

export const toArray = (value, fallbackKeys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of fallbackKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  const dynamicArrayKey = Object.keys(value).find((key) => Array.isArray(value[key]));
  return dynamicArrayKey ? value[dynamicArrayKey] : [];
};

const DEFAULT_PAGE_SIZE = 500;

export async function fetchControlDocCollection(path, {
  fallbackKeys = ['data', 'items'],
  pageSize = DEFAULT_PAGE_SIZE,
  requestOptions = {},
  forceRefresh = false,
  clientPagination = true,
  onPageLoaded
} = {}) {
  const allItems = [];
  const seenItems = new Set();
  const seenPages = new Set();
  const stats = {
    path,
    complete: false,
    pagesLoaded: 0,
    totalItems: 0,
    totalPages: null,
    totalCount: null,
    stopReason: ''
  };

  for (let page = 1; ; page += 1) {
    const response = await fetch(getPagedApiUrl(path, page, pageSize, forceRefresh), {
      ...requestOptions,
      cache: forceRefresh ? 'no-store' : 'default',
      headers: {
        ...(forceRefresh ? { 'Cache-Control': 'no-cache' } : {}),
        ...(requestOptions.headers || {})
      }
    });

    if (response.status === 401) {
      throw new Error('Acceso denegado. Por favor, inicia sesión.');
    }
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const items = toArray(data, fallbackKeys);
    if (items.length === 0) {
      stats.complete = true;
      stats.stopReason = 'empty-page';
      break;
    }

    const pageSignature = buildPageSignature(items);
    if (seenPages.has(pageSignature)) {
      stats.complete = false;
      stats.stopReason = 'repeated-page';
      console.warn('[ControlDoc] La API/proxy repitió una página de resultados; la colección puede estar incompleta.', {
        path,
        page,
        totalItems: allItems.length
      });
      break;
    }
    seenPages.add(pageSignature);

    items.forEach((item) => {
      const key = getItemKey(item);
      if (seenItems.has(key)) return;
      seenItems.add(key);
      allItems.push(item);
    });

    onPageLoaded?.({ page, pageItems: items.length, totalItems: allItems.length });
    stats.pagesLoaded = page;
    stats.totalItems = allItems.length;

    if (!clientPagination) {
      stats.complete = null;
      stats.stopReason = 'single-proxy-response';
      break;
    }

    const totalPages = readNumericHeader(response.headers, ['x-total-pages', 'total-pages', 'x-pagination-pages'])
      || readNumericValue(data, ['total_pages', 'totalPages', 'last_page', 'lastPage', 'pages', 'page_count', 'pageCount']);
    const totalCount = readNumericHeader(response.headers, ['x-total-count', 'total-count', 'x-pagination-total'])
      || readNumericValue(data, ['total_count', 'totalCount', 'total', 'recordsTotal']);
    stats.totalPages = totalPages;
    stats.totalCount = totalCount;

    if (totalPages && page >= totalPages) {
      stats.complete = true;
      stats.stopReason = 'total-pages';
      break;
    }
    if (totalCount && allItems.length >= totalCount) {
      stats.complete = true;
      stats.stopReason = 'total-count';
      break;
    }
  }

  Object.defineProperty(allItems, '__controlDocStats', {
    value: stats,
    enumerable: false
  });

  return allItems;
}

export function getControlDocCollectionStats(collection) {
  return collection?.__controlDocStats || null;
}

export async function clearControlDocProxyCache(requestOptions = {}) {
  try {
    await fetch(getApiUrl(`/controldoc/documents/sync?cache=no-store&_=${Date.now()}`), {
      ...requestOptions,
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        ...(requestOptions.headers || {})
      }
    });
  } catch (error) {
    console.warn('[ControlDoc] No se pudo limpiar el cache del proxy antes de refrescar:', error);
  }
}

function getPagedApiUrl(path, page, pageSize, forceRefresh) {
  const separator = path.includes('?') ? '&' : '?';
  const refreshParams = forceRefresh ? '&refresh=1&cache=no-store&_=' + Date.now() : '';
  return getApiUrl(`${path}${separator}page=${page}&per_page=${pageSize}${refreshParams}`);
}

function getItemKey(item) {
  return (item?.id ?? item?.external_id ?? JSON.stringify(item)).toString();
}

function buildPageSignature(items) {
  return items.map(getItemKey).join('|');
}

function readNumericHeader(headers, names) {
  for (const name of names) {
    const value = Number(headers.get(name));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function readNumericValue(json, names) {
  const sources = [
    json,
    json?.meta,
    json?.pagination,
    json?.meta?.pagination,
    json?.data?.pagination
  ].filter((source) => source && typeof source === 'object' && !Array.isArray(source));

  for (const source of sources) {
    for (const name of names) {
      const value = Number(source[name]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
}
