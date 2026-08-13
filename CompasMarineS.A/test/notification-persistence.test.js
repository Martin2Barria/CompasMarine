import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildEmailIdempotencyKey,
  buildPushHistoryId,
  handlePushSubscription,
  handlePushTest,
  normalizeEmailHistoryRow,
  pruneNotificationSentEvents
} from '../server/services/notifications.service.js';

test('genera un historyId push estable por ocurrencia y distinto entre reenvíos', () => {
  const eventKey = 'user:12:document:60:abc:2026-10-11';
  const firstOccurrence = '2026-08-12T12:00:00.000Z';
  const secondOccurrence = '2026-08-17T12:00:00.000Z';

  assert.equal(
    buildPushHistoryId(eventKey, firstOccurrence),
    buildPushHistoryId(eventKey, firstOccurrence)
  );
  assert.notEqual(
    buildPushHistoryId(eventKey, firstOccurrence),
    buildPushHistoryId(eventKey, secondOccurrence)
  );
});

test('genera una llave idempotente estable para cada lote de correo', () => {
  const records = [{ id: 'document:60:a' }, { id: 'document:60:b' }];

  assert.equal(
    buildEmailIdempotencyKey(12, records),
    buildEmailIdempotencyKey(12, [...records].reverse())
  );
  assert.notEqual(
    buildEmailIdempotencyKey(12, records),
    buildEmailIdempotencyKey(12, [{ id: 'document:60:c' }])
  );
});

test('la poda conserva todos los eventos vencidos aunque excedan el máximo', () => {
  const events = {
    'user:12:document:0:expired-a:2026-01-01': {
      sentAt: '2026-01-02T12:00:00.000Z',
      lastSentAt: '2026-01-02T12:00:00.000Z'
    },
    'user:12:document:0:expired-b:2026-01-02': event('expired', '2026-01-03T12:00:00.000Z'),
    'user:12:document:60:warning-old:2026-12-01': event('warning', '2026-08-01T12:00:00.000Z'),
    'user:12:document:60:warning-new:2026-12-02': event('warning', '2026-08-02T12:00:00.000Z')
  };

  const pruned = pruneNotificationSentEvents(events, 1);

  assert.deepEqual(Object.keys(pruned).sort(), [
    'user:12:document:0:expired-a:2026-01-01',
    'user:12:document:0:expired-b:2026-01-02',
    'user:12:document:60:warning-new:2026-12-02'
  ].sort());
});

test('normaliza historial de correo con toda la metadata visible', () => {
  const row = normalizeEmailHistoryRow({
    event_id: 'document:0:abc:2026-08-10',
    threshold: 0,
    notification_group: 'expired',
    title: 'Documento vencido',
    body: 'Certificado venció el 10/08/2026.',
    doc_name: 'Certificado',
    expiration_date: '2026-08-10',
    days_remaining: -2,
    provider_id: 'email_123',
    sent_at: '2026-08-12T15:30:00.000Z'
  });

  assert.deepEqual(row, {
    eventId: 'document:0:abc:2026-08-10',
    threshold: 0,
    group: 'expired',
    title: 'Documento vencido',
    body: 'Certificado venció el 10/08/2026.',
    docName: 'Certificado',
    expirationDate: '2026-08-10',
    daysRemaining: -2,
    providerId: 'email_123',
    sentAt: '2026-08-12T15:30:00.000Z'
  });
});

test('el correo no se envía si no puede garantizar su registro persistente', async () => {
  const source = await readFile(new URL('../server/services/notifications.service.js', import.meta.url), 'utf8');

  assert.match(source, /reason: 'persistence-unavailable'/);
  assert.match(source, /no se enviará para evitar duplicados/);
});

test('suscripción y prueba push rechazan solicitudes sin sesión', async () => {
  const request = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      origin: 'http://localhost'
    },
    socket: { remoteAddress: '127.0.0.99' }
  };
  const subscriptionResponse = response();
  const testResponse = response();

  await handlePushSubscription(request, subscriptionResponse);
  await handlePushTest(request, testResponse);

  assert.equal(subscriptionResponse.status, 401);
  assert.equal(testResponse.status, 401);
});

function event(group, lastSentAt) {
  return {
    sentAt: lastSentAt,
    lastSentAt,
    alert: { group }
  };
}

function response() {
  return {
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}
