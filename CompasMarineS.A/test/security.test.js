import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { consumeRateLimit, requireSameOriginRequest } from '../server/utils/security.js';

function response() {
  return {
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test('same-origin permite el host de desarrollo y rechaza un origen externo', () => {
  const allowed = response();
  assert.equal(requireSameOriginRequest({
    headers: { origin: 'http://localhost:5173', host: 'localhost:8787' }
  }, allowed), true);

  const rejected = response();
  assert.equal(requireSameOriginRequest({
    headers: { origin: 'https://sitio-malicioso.example', host: 'localhost:8787' }
  }, rejected), false);
  assert.equal(rejected.status, 403);
});

test('rate limit bloquea después del límite configurado', () => {
  const request = { headers: {}, socket: { remoteAddress: '198.51.100.10' } };
  const firstResponse = response();
  const secondResponse = response();

  assert.equal(consumeRateLimit(request, firstResponse, 'test-suite', 1, 60_000), true);
  assert.equal(consumeRateLimit(request, secondResponse, 'test-suite', 1, 60_000), false);
  assert.equal(secondResponse.status, 429);
  assert.ok(secondResponse.headers['Retry-After']);
});

test('mantenimiento de base de datos no crea credenciales predeterminadas', async () => {
  const serverSource = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

  assert.doesNotMatch(serverSource, /admin123/);
});

test('los límites de autenticación permiten 10 intentos y bloquean el siguiente por 15 minutos', () => {
  const request = { headers: {}, socket: { remoteAddress: '198.51.100.11' } };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(
      consumeRateLimit(request, response(), 'auth-login-test', 10, 15 * 60_000),
      true
    );
  }

  const blockedResponse = response();
  assert.equal(
    consumeRateLimit(request, blockedResponse, 'auth-login-test', 10, 15 * 60_000),
    false
  );
  assert.equal(blockedResponse.status, 429);
  assert.match(blockedResponse.body, /Too many requests/);
  assert.ok(Number(blockedResponse.headers['Retry-After']) > 0);
  assert.ok(Number(blockedResponse.headers['Retry-After']) <= 15 * 60);
});
