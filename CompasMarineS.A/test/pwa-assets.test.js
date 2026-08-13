import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest mantiene la aplicación instalable como standalone', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.length >= 2);
});

test('service worker conserva los manejadores de push y click', async () => {
  const [serviceWorker, serverSource] = await Promise.all([
    readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/index.js', import.meta.url), 'utf8')
  ]);

  assert.match(serviceWorker, /addEventListener\(['"]push['"]/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\(['"]notificationclick['"]/);
  assert.match(serviceWorker, /compas:push-received/);
  assert.match(serviceWorker, /compas:navigate/);
  assert.match(serviceWorker, /compas-marine-app-v5/);
  assert.match(serverSource, /fileName === '\/sw\.js'/);
  assert.match(serverSource, /mustRevalidate \? 'no-cache'/);
});

test('la app intenta activar push al autenticar y ofrece activación cuando no está listo', async () => {
  const [appSource, notificationView, notificationRules] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Views/ViewNotificaciones.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pwa/notificationRules.js', import.meta.url), 'utf8')
  ]);

  assert.match(appSource, /enablePushNotifications\(\)/);
  assert.match(notificationView, /canTestPush \? 'Probar push' : 'Activar notificaciones'/);
  assert.match(notificationView, /fetchPushNotificationHistory/);
  assert.match(notificationView, /Avisado el/);
  assert.match(notificationView, /formatNotificationTimestamp/);
  assert.match(notificationView, /normalizeHistoryRecord/);
  assert.doesNotMatch(notificationView, /alerts\.slice\(0, 20\)/);
  assert.match(notificationRules, /return attachLocalPushTimestamps\(readAlertRecords\(ownerKey\)\)/);
  assert.doesNotMatch(notificationRules, /mergeAlertRecords\(ownerKey, records\);\s*\n\s*if \(!canNotify\(\)\)/);
});

test('inicio muestra solo vencimientos próximos y excluye documentos ya vencidos', async () => {
  const homeView = await readFile(new URL('../src/Views/ViewInicio.jsx', import.meta.url), 'utf8');

  assert.match(homeView, /doc\.daysRemaining >= 0 && doc\.daysRemaining <= 60/);
  assert.match(homeView, /!hasExpiredDocumentStatus\(doc\)/);
  assert.match(homeView, /sort\(compareExpirationUrgency\)/);
  assert.doesNotMatch(homeView, /Expirado \(/);
});

test('documentos diferencia emisión real de fecha de registro en ControlDoc', async () => {
  const documentsView = await readFile(new URL('../src/Views/ViewDocumentos.jsx', import.meta.url), 'utf8');

  assert.match(documentsView, /getDocumentIssueDate\(doc\)/);
  assert.match(documentsView, /Registro en ControlDoc:/);
  assert.doesNotMatch(documentsView, /doc\.created_at \|\| doc\.issued_at/);
  assert.doesNotMatch(documentsView, /daysRemaining === null\) statusMatch = statusFilter === 'valid'/);
});
