import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { normalize, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Cargamos entorno y base de datos primero
import { loadEnvFiles } from './config/env.js';
loadEnvFiles();
import './config/db.js';

// 2. Importaciones de nuestro sistema modular
import { sendJson } from './utils/http.js';
import { apiRouter } from './routes/api.routes.js';
import { configureWebPush } from './services/notifications.service.js';

// 3. Variables estáticas del servidor
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(__dirname, '../dist');
const port = Number(process.env.SERVER_PORT || process.env.PORT || 8787);
const host = process.env.SERVER_HOST || '0.0.0.0';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };

// 4. Inicializar notificaciones
configureWebPush();

// 5. Motor estático de React
function serveStaticFile(res, requestUrl) {
  if (!existsSync(distDir)) return sendJson(res, 404, { error: 'No se encontró el build (dist).' });
  let filePath = normalize(join(distDir, requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname)));
  if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: 'Acceso denegado' });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html');
  const ext = extname(filePath);
  res.writeHead(200, { ...securityHeaders, 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
  createReadStream(filePath).pipe(res);
}

// 6. Servidor HTTP
const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    // Todas las peticiones API van al enrutador maestro
    if (requestUrl.pathname.startsWith('/api/')) {
      await apiRouter(req, res, requestUrl);
      return;
    }

    // El resto es la página web (React)
    serveStaticFile(res, requestUrl);
  } catch (error) {
    console.error("🔥 Error global en el servidor:", error);
    sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

server.listen(port, host, () => {
  console.log(`✅ Servidor Compas Marine (Modular) encendido en http://${host}:${port}`);
});