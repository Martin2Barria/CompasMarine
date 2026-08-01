import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClearSessionCookie, buildSessionCookie } from '../server/utils/session.js';

test('la cookie de sesión persiste por defecto y conserva sus atributos de seguridad', () => {
  const localRequest = { headers: { host: 'localhost:8787' } };
  const secureRequest = { headers: { host: 'app.compasmarine.cl', 'x-forwarded-proto': 'https' } };

  assert.match(buildSessionCookie(localRequest, 42), /compas_user_id=42/);
  assert.match(buildSessionCookie(localRequest, 42), /Max-Age=2592000/);
  assert.doesNotMatch(buildSessionCookie(localRequest, 42), /Secure/);
  assert.match(buildSessionCookie(secureRequest, 42), /Secure/);
});

test('logout invalida la cookie persistente', () => {
  const cookie = buildClearSessionCookie({ headers: { host: 'app.compasmarine.cl', 'x-forwarded-proto': 'https' } });

  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
  assert.match(cookie, /Secure/);
});
