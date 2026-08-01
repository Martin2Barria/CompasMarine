import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, resolveEmailConfig } from '../server/utils/email.js';

test('validación de correo acepta direcciones normales y rechaza entradas inseguras', () => {
  assert.equal(isValidEmail('usuario@compasmarine.cl'), true);
  assert.equal(isValidEmail('sin-arroba'), false);
  assert.equal(isValidEmail('usuario\n@compasmarine.cl'), false);
});

test('configuración SMTP informa faltantes sin exponer secretos', () => {
  const config = resolveEmailConfig({});

  assert.equal(config.ready, false);
  assert.ok(config.missing.includes('SMTP_HOST o GMAIL_USER'));
  assert.equal(Object.hasOwn(config, 'password'), true);
  assert.equal(config.password, '');
});

test('configuración SMTP lista conserva TLS y remitente configurados', () => {
  const config = resolveEmailConfig({
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'sender@example.com',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'sender@example.com',
    SMTP_SECURE: 'true'
  });

  assert.equal(config.ready, true);
  assert.equal(config.secure, true);
  assert.equal(config.envelopeFrom, 'sender@example.com');
});
