import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRouter } from '../server/routes/api.routes.js';

function response() {
  return {
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test('apiRouter conserva health check y fallback 404', async () => {
  const healthResponse = response();
  await apiRouter({ method: 'GET', headers: {} }, healthResponse, new URL('http://localhost/api/health'));
  assert.equal(healthResponse.status, 200);
  const healthPayload = JSON.parse(healthResponse.body);
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.email.from, 'noreply@compasmarinenotificaciones.com');
  assert.equal(typeof healthPayload.email.ready, 'boolean');

  const notFoundResponse = response();
  await apiRouter({ method: 'GET', headers: {} }, notFoundResponse, new URL('http://localhost/api/not-found'));
  assert.equal(notFoundResponse.status, 404);
});

test('apiRouter no expone la clave pública cuando VAPID no está listo', async () => {
  const previousPublicKey = process.env.VAPID_PUBLIC_KEY;
  const previousPrivateKey = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

  try {
    const responseObject = response();
    await apiRouter({ method: 'GET', headers: {} }, responseObject, new URL('http://localhost/api/notifications/vapid-public-key'));
    const payload = JSON.parse(responseObject.body);

    assert.equal(responseObject.status, 200);
    assert.equal(payload.ready, false);
    assert.equal(payload.publicKey, null);
  } finally {
    if (previousPublicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = previousPublicKey;
    if (previousPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = previousPrivateKey;
  }
});

test('el historial push exige una sesión autenticada', async () => {
  const responseObject = response();
  await apiRouter(
    { method: 'GET', headers: {} },
    responseObject,
    new URL('http://localhost/api/notifications/push-history')
  );

  assert.equal(responseObject.status, 401);
});
