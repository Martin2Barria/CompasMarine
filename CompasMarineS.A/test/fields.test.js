import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDocumentEntityIds,
  getDocumentExpirationDate,
  hasPendingSignature,
  parseControlDocDate
} from '../src/controldoc/fields.js';

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
