import test from 'node:test';
import assert from 'node:assert/strict';
import { getCookie, requireJsonRequest, sendJson } from '../server/utils/http.js';

test('getCookie obtiene cookies codificadas sin confundir prefijos', () => {
  const request = { headers: { cookie: 'other=value; compas_user_id=usuario%201; compas_user=wrong' } };
  assert.equal(getCookie(request, 'compas_user_id'), 'usuario 1');
  assert.equal(getCookie(request, 'missing'), '');
});

test('sendJson entrega JSON sin caché y content type correcto', () => {
  const response = {
    headers: null,
    body: '',
    setHeader() {},
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };

  sendJson(response, 202, { ok: true });

  assert.equal(response.status, 202);
  assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test('requireJsonRequest rechaza tipos de contenido no JSON', () => {
  const response = {
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); }
  };

  assert.equal(requireJsonRequest({ headers: { 'content-type': 'text/plain' } }, response), false);
  assert.equal(response.status, 415);
  assert.match(response.body.error, /application\/json/);
});
