import { Buffer } from 'node:buffer';
import os from 'node:os';
import tls from 'node:tls';

const DEFAULT_SMTP_TIMEOUT_MS = 15000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value || '').trim());
}

export function resolveEmailConfig(env = process.env) {
  const gmailUser = env.GMAIL_USER || env.GMAIL_EMAIL || '';
  const gmailPassword = env.GMAIL_APP_PASSWORD || '';
  const smtpUser = env.SMTP_USER || gmailUser;
  const smtpPassword = env.SMTP_PASS || gmailPassword;
  const smtpHost = env.SMTP_HOST || (gmailUser || gmailPassword ? 'smtp.gmail.com' : '');
  const smtpPort = Number(env.SMTP_PORT || 465);
  const smtpSecure = parseBoolean(env.SMTP_SECURE, true);
  const fromAddress = env.SMTP_FROM || env.MAIL_FROM || smtpUser;
  const fromName = env.SMTP_FROM_NAME || env.MAIL_FROM_NAME || 'Compas Marine';

  const missing = [];
  if (!smtpHost) missing.push('SMTP_HOST o GMAIL_USER');
  if (!smtpUser) missing.push('SMTP_USER o GMAIL_USER');
  if (!smtpPassword) missing.push('SMTP_PASS o GMAIL_APP_PASSWORD');
  if (!fromAddress) missing.push('SMTP_FROM o MAIL_FROM');

  return {
    ready: missing.length === 0,
    missing,
    provider: smtpHost.includes('gmail') ? 'gmail-smtp' : 'smtp',
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUser,
    password: smtpPassword,
    from: formatAddress(fromName, fromAddress),
    envelopeFrom: extractEmailAddress(fromAddress) || smtpUser,
    timeoutMs: Number(env.SMTP_TIMEOUT_MS || DEFAULT_SMTP_TIMEOUT_MS)
  };
}

export async function sendEmail({ to, subject, text, html, config = resolveEmailConfig() }) {
  if (!config.ready) {
    throw new Error(`Proveedor de email no configurado. Faltan: ${config.missing.join(', ')}`);
  }

  const recipient = String(to || '').trim().toLowerCase();
  if (!isValidEmail(recipient)) {
    throw new Error('El correo destinatario no es válido.');
  }

  if (!config.secure) {
    throw new Error('SMTP no seguro deshabilitado. Usa Gmail/SMTP con TLS en puerto 465.');
  }

  const client = await createTlsSmtpClient(config);

  try {
    await client.expect([220]);
    await client.command(`EHLO ${sanitizeEhloName(os.hostname())}`, [250]);
    await client.command('AUTH LOGIN', [334]);
    await client.command(Buffer.from(config.user).toString('base64'), [334]);
    await client.command(Buffer.from(config.password).toString('base64'), [235]);
    await client.command(`MAIL FROM:<${config.envelopeFrom}>`, [250]);
    await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await client.command('DATA', [354]);
    client.write(`${buildMimeMessage({ from: config.from, to: recipient, subject, text, html })}\r\n.\r\n`);
    await client.expect([250]);
    await client.command('QUIT', [221]).catch(() => null);

    return {
      ok: true,
      provider: config.provider,
      accepted: [recipient]
    };
  } finally {
    client.close();
  }
}

function createTlsSmtpClient(config) {
  return new Promise((resolveConnection, rejectConnection) => {
    let buffer = '';
    let settled = false;
    const pendingReaders = [];
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      timeout: config.timeoutMs
    });

    const fail = (error) => {
      if (!settled) {
        settled = true;
        rejectConnection(error);
      }
      while (pendingReaders.length > 0) {
        pendingReaders.shift().reject(error);
      }
    };

    socket.setEncoding('utf8');
    socket.on('secureConnect', () => {
      settled = true;
      resolveConnection({
        expect: (codes) => expectResponse(socket, pendingReaders, () => buffer, (value) => { buffer = value; }, codes, config.timeoutMs),
        command: async (command, codes) => {
          socket.write(`${command}\r\n`);
          return expectResponse(socket, pendingReaders, () => buffer, (value) => { buffer = value; }, codes, config.timeoutMs);
        },
        write: (value) => socket.write(value),
        close: () => socket.destroy()
      });
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      flushReaders(pendingReaders, () => buffer, (value) => { buffer = value; });
    });
    socket.on('timeout', () => fail(new Error('Timeout conectando con SMTP.')));
    socket.on('error', fail);
  });
}

function expectResponse(socket, pendingReaders, getBuffer, setBuffer, expectedCodes, timeoutMs) {
  return new Promise((resolveResponse, rejectResponse) => {
    const reader = {
      resolve: (response) => {
        clearTimeout(timeout);
        if (!expectedCodes.includes(response.code)) {
          rejectResponse(new Error(`Respuesta SMTP inesperada ${response.code}: ${response.text}`));
          return;
        }
        resolveResponse(response);
      },
      reject: (error) => {
        clearTimeout(timeout);
        rejectResponse(error);
      }
    };
    const timeout = setTimeout(() => {
      const index = pendingReaders.indexOf(reader);
      if (index !== -1) pendingReaders.splice(index, 1);
      rejectResponse(new Error('Timeout esperando respuesta SMTP.'));
      socket.destroy();
    }, timeoutMs);

    pendingReaders.push(reader);
    flushReaders(pendingReaders, getBuffer, setBuffer);
  });
}

function flushReaders(pendingReaders, getBuffer, setBuffer) {
  while (pendingReaders.length > 0) {
    const response = readSmtpResponse(getBuffer(), setBuffer);
    if (!response) return;
    pendingReaders.shift().resolve(response);
  }
}

function readSmtpResponse(buffer, setBuffer) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const endIndex = lines.findIndex((line) => /^\d{3} /.test(line));

  if (endIndex === -1) return null;

  const responseLines = lines.slice(0, endIndex + 1).filter(Boolean);
  const remainder = lines.slice(endIndex + 1).join('\n');
  setBuffer(remainder);

  const lastLine = responseLines[responseLines.length - 1] || '';
  return {
    code: Number(lastLine.slice(0, 3)),
    text: responseLines.join('\n')
  };
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const safeSubject = sanitizeHeader(subject || 'Notificaciones Compas Marine');
  const plainText = normalizeBody(text || '');
  const htmlBody = normalizeBody(html || escapeHtml(plainText).replace(/\r?\n/g, '<br>'));
  const boundary = `compas-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return dotStuff([
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${safeSubject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@compasmarine.local>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    plainText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`
  ].join('\r\n'));
}

function formatAddress(name, email) {
  const address = extractEmailAddress(email) || String(email || '').trim();
  if (!name) return address;
  return `"${sanitizeHeader(name)}" <${address}>`;
}

function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeEhloName(value) {
  return String(value || 'localhost').replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
}

function normalizeBody(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n');
}

function dotStuff(value) {
  return value.replace(/^\./gm, '..');
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
