// Las rutas del servidor comienzan en /api. En desarrollo, Vite las
// redirige al backend configurado en vite.config.js.
const DEFAULT_API_BASE_URL = '/api';

export const API_BASE_URL = (
  import.meta.env.VITE_APP_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, '');

export function getApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
