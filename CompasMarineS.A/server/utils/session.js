const configuredSessionAge = Number(process.env.SESSION_MAX_AGE_SECONDS);
const SESSION_MAX_AGE_SECONDS = Number.isFinite(configuredSessionAge) && configuredSessionAge > 0
  ? Math.floor(configuredSessionAge)
  : 30 * 24 * 60 * 60;

export function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader);
  return process.env.NODE_ENV === 'production' || forwardedProto === 'https' || (hostHeader && !isLocalHost);
}

export function buildSessionCookie(req, userId) {
  const cookieParts = [
    `compas_user_id=${encodeURIComponent(userId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];

  if (isSecureRequest(req)) cookieParts.push('Secure');
  return cookieParts.join('; ');
}

export function buildClearSessionCookie(req) {
  const cookieParts = [
    'compas_user_id=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (isSecureRequest(req)) cookieParts.push('Secure');
  return cookieParts.join('; ');
}
