import { securityHeaders, mimeTypes } from '../config/constants.js'; // Asumiremos que crearemos este archivo luego

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

export function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        rejectBody(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolveBody(body));
    req.on('error', rejectBody);
  });
}

export function getCookie(req, cookieName) {
  const header = req.headers.cookie || '';
  const cookies = header.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : '';
}

export function requireJsonRequest(res, req) {
    const contentType = req.headers['content-type'] || '';
    if (contentType.toLowerCase().includes('application/json')) return true;
  
    sendJson(res, 415, { error: 'Content-Type must be application/json' });
    return false;
}