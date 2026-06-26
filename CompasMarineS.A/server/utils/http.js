const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

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

export function requireJsonRequest(req, res) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.toLowerCase().includes('application/json')) return true;

  sendJson(res, 415, { error: 'Se requiere Content-Type application/json' });
  return false;
}