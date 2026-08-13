import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareExpirationUrgency,
  getCalendarDaysRemaining,
  getDocumentEntityIds,
  getDocumentExpirationDate,
  getDocumentIssueDate,
  getDocumentRegistrationDate,
  hasPendingSignature,
  parseControlDocDate
} from '../src/controldoc/fields.js';

test('ordena alertas de vencimiento desde menos días a más días', () => {
  const alerts = [
    { displayName: 'Sesenta', daysRemaining: 60 },
    { displayName: 'Treinta', daysRemaining: 30 },
    { displayName: 'Mañana', daysRemaining: 1 },
    { displayName: 'Hoy', daysRemaining: 0 }
  ];

  assert.deepEqual(
    alerts.sort(compareExpirationUrgency).map((alert) => alert.daysRemaining),
    [0, 1, 30, 60]
  );
});

test('parseControlDocDate acepta fechas locales e ISO sin cambiar el día', () => {
  const localDate = parseControlDocDate('31/12/2026');
  const isoDate = parseControlDocDate('2026-12-31T12:00:00Z');

  assert.equal(localDate?.getFullYear(), 2026);
  assert.equal(localDate?.getMonth(), 11);
  assert.equal(localDate?.getDate(), 31);
  assert.equal(isoDate?.getFullYear(), 2026);
  assert.equal(isoDate?.getMonth(), 11);
  assert.equal(isoDate?.getDate(), 31);
  assert.equal(parseControlDocDate('no-es-fecha'), null);
  assert.equal(parseControlDocDate('31/02/2026'), null);
  assert.equal(parseControlDocDate('2026-02-29'), null);
  assert.equal(parseControlDocDate('2024-02-29')?.getDate(), 29);
});

test('calcula días calendario sin alterarse por cambios de horario', () => {
  assert.equal(
    getCalendarDaysRemaining('2026-04-05', new Date(2026, 3, 4, 12)),
    1
  );
  assert.equal(
    getCalendarDaysRemaining('2026-04-04', new Date(2026, 3, 5, 12)),
    -1
  );
  assert.equal(getCalendarDaysRemaining('31/02/2026', new Date(2026, 1, 1)), null);
});

test('extrae identificadores de entidad desde formatos directos y anidados', () => {
  const document = {
    entity_id: 42,
    custom_fields: {
      ownerEntityId: '42',
      collaborator: { external_id: '77' }
    },
    employees: [{ id: 88 }]
  };

  assert.deepEqual(getDocumentEntityIds(document), ['42', '77', '88']);
});

test('detecta vencimiento y firma pendiente en campos alternativos', () => {
  const document = {
    fields: [{ name: 'fecha vencimiento', value: '2026-12-31' }],
    signature_status: 'Pendiente'
  };

  assert.equal(getDocumentExpirationDate(document), '2026-12-31');
  assert.equal(hasPendingSignature(document), true);
});

test('diferencia la fecha real de emisión del registro en ControlDoc', () => {
  const document = {
    created_at: '2026-07-15',
    issued_at: '2023-11-20',
    expires_at: '2024-11-20'
  };

  assert.equal(getDocumentIssueDate(document), '2023-11-20');
  assert.equal(getDocumentRegistrationDate(document), '2026-07-15');
  assert.equal(getDocumentExpirationDate(document), '2024-11-20');
});

test('no interpreta created_at como fecha de emisión', () => {
  const document = { created_at: '2026-07-15', expires_at: '2024-11-20' };

  assert.equal(getDocumentIssueDate(document), '');
  assert.equal(getDocumentRegistrationDate(document), '2026-07-15');
});
