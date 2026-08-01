import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  handleAuthMe,
  handleLogin,
  handleLogout,
  handleRegister,
  handleResetPassword,
  handleVerifyResetIdentity
} from '../server/services/auth.service.js';

function request({ method = 'POST', body = '', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  req.socket = { remoteAddress: '127.0.0.1' };

  process.nextTick(() => {
    if (body) req.emit('data', body);
    req.emit('end');
  });

  return req;
}

function response() {
  return {
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; this.headers = { ...this.headers, ...headers }; },
    end(body) { this.body = body || ''; }
  };
}

test('auth handlers validan método, JSON y campos antes de tocar la base de datos', async () => {
  const wrongMethodResponse = response();
  await handleLogin(request({ method: 'GET' }), wrongMethodResponse);
  assert.equal(wrongMethodResponse.status, 405);

  const invalidJsonResponse = response();
  await handleLogin(request({ body: '{' }), invalidJsonResponse);
  assert.equal(invalidJsonResponse.status, 400);

  const missingFieldsResponse = response();
  await handleLogin(request({ body: '{}' }), missingFieldsResponse);
  assert.equal(missingFieldsResponse.status, 400);
});

test('auth handlers conservan respuestas de acceso y registro no autorizados', async () => {
  const registerResponse = response();
  await handleRegister(request(), registerResponse);
  assert.equal(registerResponse.status, 403);

  const authMeResponse = response();
  await handleAuthMe(request({ method: 'GET' }), authMeResponse);
  assert.equal(authMeResponse.status, 401);
});

test('logout y recuperación rechazan solicitudes inválidas sin efectos laterales', async () => {
  const logoutResponse = response();
  await handleLogout(request({
    headers: {
      origin: 'http://localhost:8787',
      host: 'localhost:8787'
    }
  }), logoutResponse);
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers['Set-Cookie'], /Max-Age=0/);

  const verifyResponse = response();
  await handleVerifyResetIdentity(request({ body: '{}' }), verifyResponse);
  assert.equal(verifyResponse.status, 400);

  const resetResponse = response();
  await handleResetPassword(request({ body: '{}' }), resetResponse);
  assert.equal(resetResponse.status, 400);
});
