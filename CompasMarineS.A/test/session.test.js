import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  getSessionUserId,
  validateSessionConfiguration,
  verifySessionToken
} from '../server/utils/session.js';

const TEST_ENV = Object.freeze({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-random-like-bytes',
  SESSION_MAX_AGE_SECONDS: '2592000'
});

test('la cookie contiene una sesión firmada y conserva sus atributos de seguridad', () => {
  const localRequest = { headers: { host: 'localhost:8787' } };
  const secureRequest = { headers: { host: 'app.compasmarine.cl', 'x-forwarded-proto': 'https' } };
  const options = { env: TEST_ENV, nowSeconds: 1_800_000_000 };
  const localCookie = buildSessionCookie(localRequest, 42, options);
  const secureCookie = buildSessionCookie(secureRequest, 42, options);

  assert.match(localCookie, /compas_user_id=v1\./);
  assert.doesNotMatch(localCookie, /compas_user_id=42(?:;|$)/);
  assert.match(localCookie, /Max-Age=2592000/);
  assert.match(localCookie, /HttpOnly/);
  assert.doesNotMatch(localCookie, /Secure/);
  assert.match(secureCookie, /Secure/);

  const requestWithCookie = {
    headers: { cookie: localCookie.split(';', 1)[0] }
  };
  assert.equal(getSessionUserId(requestWithCookie, options), '42');
});

test('la firma rechaza tokens manipulados y cookies antiguas sin firma', () => {
  const options = { env: TEST_ENV, nowSeconds: 1_800_000_000 };
  const token = createSessionToken(42, options);
  const parts = token.split('.');
  const alteredPayload = `${parts[1][0] === 'A' ? 'B' : 'A'}${parts[1].slice(1)}`;
  const tamperedToken = `${parts[0]}.${alteredPayload}.${parts[2]}`;

  assert.equal(verifySessionToken(token, options), '42');
  assert.equal(verifySessionToken(tamperedToken, options), '');
  assert.equal(verifySessionToken('42', options), '');
  assert.equal(getSessionUserId({ headers: { cookie: 'compas_user_id=42' } }, options), '');
});

test('la sesión expira según SESSION_MAX_AGE_SECONDS', () => {
  const env = { ...TEST_ENV, SESSION_MAX_AGE_SECONDS: '10' };
  const token = createSessionToken(7, { env, nowSeconds: 1000 });

  assert.equal(verifySessionToken(token, { env, nowSeconds: 1009 }), '7');
  assert.equal(verifySessionToken(token, { env, nowSeconds: 1010 }), '');
});

test('producción exige un SESSION_SECRET fuerte', () => {
  assert.throws(
    () => validateSessionConfiguration({ NODE_ENV: 'production' }),
    /SESSION_SECRET no está configurado/
  );
  assert.throws(
    () => validateSessionConfiguration({ NODE_ENV: 'production', SESSION_SECRET: 'muy-corto' }),
    /SESSION_SECRET es demasiado corto/
  );
  assert.throws(
    () => validateSessionConfiguration({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(48) }),
    /SESSION_SECRET no tiene suficiente variedad/
  );
  assert.doesNotThrow(() => validateSessionConfiguration({
    NODE_ENV: 'production',
    SESSION_SECRET: 'production-secret-with-more-than-thirty-two-bytes'
  }));
});

test('desarrollo usa un secreto efímero explícito cuando no se configura uno', () => {
  const env = { NODE_ENV: 'development', SESSION_MAX_AGE_SECONDS: '60' };
  const config = validateSessionConfiguration(env);
  const token = createSessionToken(8, { env, nowSeconds: 2000 });

  assert.equal(config.usingDevelopmentFallback, true);
  assert.equal(verifySessionToken(token, { env, nowSeconds: 2001 }), '8');
});

test('logout invalida la cookie persistente', () => {
  const cookie = buildClearSessionCookie({ headers: { host: 'app.compasmarine.cl', 'x-forwarded-proto': 'https' } });

  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
  assert.match(cookie, /Secure/);
});
