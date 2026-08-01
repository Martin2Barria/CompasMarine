import test from 'node:test';
import assert from 'node:assert/strict';
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
