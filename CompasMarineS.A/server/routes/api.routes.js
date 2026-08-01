import { sendJson } from '../utils/http.js';
import { authRouter } from './auth.routes.js';
import { adminRouter } from './admin.routes.js';
import { 
  handleDocumentsSync, proxyControlDocRequest, controlDocRoutes 
} from '../services/controldoc.service.js';
import {
  handlePushSubscription,
  handlePushTest,
  handlePushNotificationHistory,
  handleEmailAlerts,
  handleEmailNotificationHistory,
  hasVapidConfig
} from '../services/notifications.service.js';

export async function apiRouter(req, res, requestUrl) {
  const cleanPath = requestUrl.pathname.replace(/\/$/, ''); // Limpiamos slashes finales

  // 1. Health Check
  if (cleanPath === '/api/health') return sendJson(res, 200, { ok: true, status: 'blindado' });

  // 2. Sub-Enrutadores (Delegan la responsabilidad)
  if (cleanPath.startsWith('/api/auth')) {
    const handled = await authRouter(req, res, cleanPath);
    if (handled) return;
  }

  if (cleanPath.startsWith('/api/admin')) {
    const handled = await adminRouter(req, res, cleanPath);
    if (handled) return;
  }

  // 3. Rutas directas: Notificaciones
  if (cleanPath === '/api/notifications/vapid-public-key') {
    return sendJson(res, 200, {
      publicKey: hasVapidConfig() ? process.env.VAPID_PUBLIC_KEY : null,
      ready: hasVapidConfig()
    });
  }
  if (cleanPath === '/api/notifications/subscriptions') return await handlePushSubscription(req, res);
  if (cleanPath === '/api/notifications/test') return await handlePushTest(req, res);
  if (cleanPath === '/api/notifications/push-history') return await handlePushNotificationHistory(req, res);
  if (cleanPath === '/api/notifications/email-alerts') return await handleEmailAlerts(req, res);
  if (cleanPath === '/api/notifications/email-history') return await handleEmailNotificationHistory(req, res);

  // 4. Rutas directas: ControlDoc
  if (cleanPath === '/api/controldoc/documents/sync') return await handleDocumentsSync(req, res);

  if (controlDocRoutes.has(cleanPath)) {
    return await proxyControlDocRequest(req, res, requestUrl, cleanPath);
  }

  // 5. Fallback: Si llegó hasta aquí, la ruta API no existe
  return sendJson(res, 404, { error: 'Ruta API no encontrada' });
}
