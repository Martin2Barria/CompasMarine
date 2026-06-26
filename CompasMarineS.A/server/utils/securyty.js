import { sendJson } from './http.js';

const rateLimitBuckets = new Map();
const configuredAllowedOrigins = parseOriginList(process.env.APP_ALLOWED_ORIGINS);

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

export function consumeRateLimit(req, res, bucketName, limit, windowMs) {
  const now = Date.now();
  const key = `${bucketName}:${getClientIp(req)}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    res.writeHead(429, {
      ...securityHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000))
    });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return false;
  }

  bucket.count += 1;
  return true;
}

export function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function requireSameOriginRequest(req, res) {
  if (isAllowedRequestOrigin(req)) return true;
  sendJson(res, 403, { error: 'Forbidden origin' });
  return false;
}

function isAllowedRequestOrigin(req) {
  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) {
    return process.env.NODE_ENV !== 'production';
  }
  return getAllowedOriginsForRequest(req).has(requestOrigin);
}

function getRequestOrigin(req) {
  if (typeof req.headers.origin === 'string') return req.headers.origin;
  if (typeof req.headers.referer === 'string') {
    try { return new URL(req.headers.referer).origin; } catch { return ''; }
  }
  return '';
}

function getAllowedOriginsForRequest(req) {
  const allowedOrigins = new Set(configuredAllowedOrigins);
  const requestHost = req.headers['x-forwarded-host'] || req.headers.host;

  if (requestHost) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : 'https';
    allowedOrigins.add(`${protocol}://${requestHost}`);
    allowedOrigins.add(`https://${requestHost}`);
    allowedOrigins.add(`http://${requestHost}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  return allowedOrigins;
}

function parseOriginList(value = '') {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}