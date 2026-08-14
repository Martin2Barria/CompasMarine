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

test('la app intenta activar push al autenticar y ofrece activación y prueba por separado', async () => {
  const [appSource, notificationView, activationPrompt, installPrompt, styles, pushNotifications, notificationRules] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Views/ViewNotificaciones.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Components/PushActivationPrompt.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Components/PwaInstallPrompt.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/pwa/pushNotifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pwa/notificationRules.js', import.meta.url), 'utf8')
  ]);

  assert.match(appSource, /enablePushNotifications\(\)/);
  assert.match(appSource, /PushActivationPrompt/);
  assert.match(appSource, /fixed left-3 right-3 bottom-\[6\.75rem\]/);
  assert.match(installPrompt, /pwa-install-prompt-visible/);
  assert.match(styles, /\.pwa-install-prompt-visible \.pwa-scroll-content/);
  assert.match(notificationView, /Reactivar notificaciones/);
  assert.match(notificationView, /Probar push/);
  assert.match(notificationView, /disabled=\{!canTestPush/);
  assert.match(activationPrompt, /Activa las notificaciones/);
  assert.match(activationPrompt, /El navegador conservará el permiso/);
  assert.match(pushNotifications, /forceResubscribe: true/);
  assert.match(pushNotifications, /existingSubscription\.unsubscribe/);
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
  assert.match(documentsView, /getDocumentExpirationDate\(doc\)/);
  assert.match(documentsView, /Registro en ControlDoc:/);
  assert.doesNotMatch(documentsView, /doc\.created_at \|\| doc\.issued_at/);
  assert.doesNotMatch(documentsView, /Ver \/ Bajar/);
  assert.doesNotMatch(documentsView, /download_base64_url/);
  assert.doesNotMatch(documentsView, /daysRemaining === null\) statusMatch = statusFilter === 'valid'/);
  assert.match(documentsView, /Busca un colaborador por nombre o RUT/);
  assert.match(documentsView, /identifierStartsWith\(entityRut/);
  assert.doesNotMatch(documentsView, /Todos los usuarios/);
  assert.doesNotMatch(documentsView, /documentMatch/);
  assert.match(documentsView, /focusedCollaborator/);
  assert.match(documentsView, /Documentos de/);
});

test('el perfil administrativo abre documentos contextualizados y oculta el acceso global', async () => {
  const [appSource, homeView, bottomNav] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Views/ViewInicio.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Components/BottomNav.jsx', import.meta.url), 'utf8')
  ]);

  assert.match(homeView, /Ver documentos/);
  assert.match(homeView, /onOpenCollaboratorDocuments/);
  assert.match(appSource, /adminCollaboratorContext/);
  assert.match(appSource, /hideDocuments=/);
  assert.match(bottomNav, /item\.id === 'documentos' && hideDocuments/);
});
