import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCookie } from './http.js';

export const SESSION_COOKIE_NAME = 'compas_user_id';

const SESSION_TOKEN_VERSION = 'v1';
const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MIN_SESSION_SECRET_BYTES = 32;
const DEVELOPMENT_SESSION_SECRET = randomBytes(MIN_SESSION_SECRET_BYTES);
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 5 * 60;

export function validateSessionConfiguration(env = process.env) {
  const configuredSecret = readConfiguredSessionSecret(env);
  const weakReason = getWeakSecretReason(configuredSecret);
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && weakReason) {
    throw new Error(
      `[Session] SESSION_SECRET ${weakReason}. En producción debe ser un secreto aleatorio de al menos ${MIN_SESSION_SECRET_BYTES} bytes.`
    );
  }

  return {
    maxAgeSeconds: getSessionMaxAgeSeconds(env),
    usingDevelopmentFallback: Boolean(weakReason)
  };
}

export function createSessionToken(userId, { env = process.env, nowSeconds = currentUnixTime() } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) throw new TypeError('El identificador de sesión debe ser un entero positivo.');

  const issuedAt = normalizeUnixTime(nowSeconds);
  const payload = Buffer.from(JSON.stringify({
    sub: normalizedUserId,
    iat: issuedAt,
    exp: issuedAt + getSessionMaxAgeSeconds(env)
  }), 'utf8').toString('base64url');
  const signingInput = `${SESSION_TOKEN_VERSION}.${payload}`;
  const signature = signSessionValue(signingInput, env).toString('base64url');

  return `${signingInput}.${signature}`;
}

export function verifySessionToken(token, { env = process.env, nowSeconds = currentUnixTime() } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return '';

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_VERSION) return '';

  const [, encodedPayload, encodedSignature] = parts;
  if (!isBase64Url(encodedPayload) || !isBase64Url(encodedSignature)) return '';

  const expectedSignature = signSessionValue(`${SESSION_TOKEN_VERSION}.${encodedPayload}`, env);
  let receivedSignature;
  try {
    receivedSignature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return '';
  }

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return '';
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return '';
  }

  const userId = normalizeUserId(payload?.sub);
  const issuedAt = Number(payload?.iat);
  const expiresAt = Number(payload?.exp);
  const now = normalizeUnixTime(nowSeconds);

  if (!userId || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return '';
  if (expiresAt <= issuedAt || expiresAt <= now) return '';
  if (issuedAt > now + MAX_FUTURE_CLOCK_SKEW_SECONDS) return '';

  return userId;
}

export function getSessionUserId(req, options) {
  try {
    return verifySessionToken(getCookie(req, SESSION_COOKIE_NAME), options);
  } catch {
    return '';
  }
}

export function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader);
  return process.env.NODE_ENV === 'production' || forwardedProto === 'https' || (hostHeader && !isLocalHost);
}

export function buildSessionCookie(req, userId, options = {}) {
  const env = options.env || process.env;
  const token = createSessionToken(userId, { ...options, env });
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${getSessionMaxAgeSeconds(env)}`
  ];

  if (isSecureRequest(req)) cookieParts.push('Secure');
  return cookieParts.join('; ');
}

export function buildClearSessionCookie(req) {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (isSecureRequest(req)) cookieParts.push('Secure');
  return cookieParts.join('; ');
}

function getSessionMaxAgeSeconds(env) {
  const configuredSessionAge = Number(env.SESSION_MAX_AGE_SECONDS);
  return Number.isFinite(configuredSessionAge) && configuredSessionAge > 0
    ? Math.floor(configuredSessionAge)
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

function getSessionSecret(env) {
  const configuredSecret = readConfiguredSessionSecret(env);
  const configuration = validateSessionConfiguration(env);
  return configuration.usingDevelopmentFallback
    ? DEVELOPMENT_SESSION_SECRET
    : configuredSecret;
}

function getWeakSecretReason(secret) {
  if (!secret) return 'no está configurado';
  if (Buffer.byteLength(secret, 'utf8') < MIN_SESSION_SECRET_BYTES) {
    return `es demasiado corto (mínimo ${MIN_SESSION_SECRET_BYTES} bytes)`;
  }
  if (new Set(secret).size < 8) return 'no tiene suficiente variedad de caracteres';
  return '';
}

function readConfiguredSessionSecret(env) {
  return String(env.SESSION_SECRET || '').trim();
}

function signSessionValue(value, env) {
  return createHmac('sha256', getSessionSecret(env)).update(value).digest();
}

function normalizeUserId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return '';
  return Number.isSafeInteger(Number(normalized)) ? normalized : '';
}

function normalizeUnixTime(value) {
  const normalized = Math.floor(Number(value));
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError('La fecha de sesión no es válida.');
  }
  return normalized;
}

function currentUnixTime() {
  return Math.floor(Date.now() / 1000);
}

function isBase64Url(value) {
  return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}
