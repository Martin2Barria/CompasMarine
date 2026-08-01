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
  const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

  assert.match(serviceWorker, /addEventListener\(['"]push['"]/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\(['"]notificationclick['"]/);
  assert.match(serviceWorker, /compas:push-received/);
  assert.match(serviceWorker, /compas:navigate/);
});

test('la app intenta activar push al autenticar y ofrece activación cuando no está listo', async () => {
  const [appSource, notificationView] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Views/ViewNotificaciones.jsx', import.meta.url), 'utf8')
  ]);

  assert.match(appSource, /enablePushNotifications\(\)/);
  assert.match(notificationView, /canTestPush \? 'Probar push' : 'Activar notificaciones'/);
  assert.match(notificationView, /fetchPushNotificationHistory/);
});
