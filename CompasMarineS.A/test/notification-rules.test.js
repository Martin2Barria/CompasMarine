import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPushPayloadForGroup,
  buildScheduledNotificationRecords,
  compareEmailRecords,
  groupEmailRecordsByExpirationThreshold,
  groupDueRecords,
  isScheduledNotificationRecordDue,
  NOTIFICATION_RULES
} from '../server/services/notification-rules.js';

function dateAfterDays(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function document(id, days, extra = {}) {
  return {
    id,
    document_type_id: 1,
    name: `Documento ${id}`,
    expiration_date: dateAfterDays(days),
    ...extra
  };
}

test('construye los umbrales de expiración sin alterar sus frecuencias', () => {
  const records = buildScheduledNotificationRecords({
    documents: [
      document('warning', 60),
      document('critical', 30),
      document('urgent', 1),
      document('expired', -1),
      document('outside', 61)
    ]
  });

  const byId = new Map(records.map((record) => [record.documentId || record.id, record]));
  const warning = records.find((record) => record.id.includes('warning'));
  const critical = records.find((record) => record.id.includes('critical'));
  const urgent = records.find((record) => record.id.includes('urgent'));
  const expired = records.find((record) => record.id.includes('expired'));

  assert.equal(records.length, 4);
  assert.equal(warning?.threshold, 60);
  assert.equal(warning?.cooldownMs, 5 * 24 * 60 * 60 * 1000);
  assert.equal(critical?.threshold, 30);
  assert.equal(critical?.cooldownMs, 24 * 60 * 60 * 1000);
  assert.equal(urgent?.threshold, 1);
  assert.equal(urgent?.cooldownMs, 6 * 60 * 60 * 1000);
  assert.equal(expired?.once, true);
  assert.equal(byId.size, 4);
  assert.equal(NOTIFICATION_RULES.warning.threshold, 60);
  assert.match(warning?.body || '', /vence en 60 días/);
  assert.match(critical?.body || '', /vence en 30 días/);
  assert.match(urgent?.body || '', /vence mañana/);
});

test('agrupa push en el orden 60, 30, 1 y conserva el payload visible', () => {
  const records = buildScheduledNotificationRecords({
    documents: [document('urgent', 1), document('warning', 60), document('critical', 30)]
  });
  const groups = groupDueRecords(records);

  assert.deepEqual(groups.map((group) => group.group), ['warning', 'critical', 'urgent']);
  assert.equal(buildPushPayloadForGroup({ id: 10 }, groups[0]).title, 'Documento por vencer');
  assert.equal(buildPushPayloadForGroup({ id: 10 }, groups[2]).tag, 'compas-urgent-10');
});

test('ordena un correo-resumen por umbral y luego por días restantes', () => {
  const alerts = [
    { group: 'urgent', docName: 'Z', daysRemaining: 1 },
    { group: 'warning', docName: 'B', daysRemaining: 60 },
    { group: 'critical', docName: 'C', daysRemaining: 30 }
  ];

  assert.deepEqual([...alerts].sort(compareEmailRecords).map((alert) => alert.group), [
    'warning',
    'critical',
    'urgent'
  ]);
});

test('agrupa los correos por usuario en lotes de 60 dias, 30 dias y vencidos', () => {
  const records = [
    { id: '30-a', threshold: 30, group: 'critical', daysRemaining: 12 },
    { id: '1-a', threshold: 1, group: 'urgent', daysRemaining: 1 },
    { id: 'expired-b', threshold: 0, group: 'expired', daysRemaining: -8 },
    { id: '60-b', threshold: 60, group: 'warning', daysRemaining: 55 },
    { id: '60-a', threshold: 60, group: 'warning', daysRemaining: 40 },
    { id: '30-b', threshold: 30, group: 'critical', daysRemaining: 25 },
    { id: 'expired-a', threshold: 0, group: 'expired', daysRemaining: -2 }
  ];

  const groups = groupEmailRecordsByExpirationThreshold(records);

  assert.deepEqual(groups.map((group) => group.threshold), [60, 30, 0]);
  assert.deepEqual(groups[0].records.map((record) => record.id), ['60-a', '60-b']);
  assert.deepEqual(groups[1].records.map((record) => record.id), ['30-a', '30-b']);
  assert.deepEqual(groups[2].records.map((record) => record.id), ['expired-b', 'expired-a']);
  assert.equal(groups.flatMap((group) => group.records).some((record) => record.threshold === 1), false);
});

test('respeta los cooldowns completos de 5 dias, 24 horas y 6 horas', () => {
  const now = Date.now();
  const previousEvent = (elapsedMs) => ({ lastSentAt: new Date(now - elapsedMs).toISOString() });
  const records = buildScheduledNotificationRecords({
    documents: [document('warning', 60), document('critical', 30), document('urgent', 1)]
  });
  const warning = records.find((record) => record.threshold === 60);
  const critical = records.find((record) => record.threshold === 30);
  const urgent = records.find((record) => record.threshold === 1);

  assert.equal(isScheduledNotificationRecordDue(warning, previousEvent(warning.cooldownMs - 1), now), false);
  assert.equal(isScheduledNotificationRecordDue(warning, previousEvent(warning.cooldownMs), now), true);
  assert.equal(isScheduledNotificationRecordDue(critical, previousEvent(critical.cooldownMs - 1), now), false);
  assert.equal(isScheduledNotificationRecordDue(critical, previousEvent(critical.cooldownMs), now), true);
  assert.equal(isScheduledNotificationRecordDue(urgent, previousEvent(urgent.cooldownMs - 1), now), false);
  assert.equal(isScheduledNotificationRecordDue(urgent, previousEvent(urgent.cooldownMs), now), true);
});

test('envia el aviso de documento vencido una sola vez', () => {
  const now = Date.now();
  const [expired] = buildScheduledNotificationRecords({
    documents: [document('expired-once', -1)]
  });

  assert.equal(expired.group, 'expired');
  assert.equal(expired.threshold, 0);
  assert.equal(expired.once, true);
  assert.equal(NOTIFICATION_RULES.expired.once, true);
  assert.equal(isScheduledNotificationRecordDue(expired, null, now), true);
  assert.equal(isScheduledNotificationRecordDue(
    expired,
    { lastSentAt: new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString() },
    now
  ), false);
});
