import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identifierStartsWith,
  matchesSearchTokenPrefixes,
  normalizeSearchIdentifier
} from '../src/utils/search.js';

test('las sugerencias por nombre desaparecen cuando dejan de coincidir con el prefijo', () => {
  assert.equal(matchesSearchTokenPrefixes('a', 'Alberto Soto'), true);
  assert.equal(matchesSearchTokenPrefixes('ac', 'Alberto Soto'), false);
  assert.equal(matchesSearchTokenPrefixes('ac', 'Andrea Acuña'), true);
  assert.equal(matchesSearchTokenPrefixes('and acu', 'Andrea Acuña'), true);
});

test('la búsqueda de RUT ignora formato pero exige coincidencia desde el inicio', () => {
  assert.equal(normalizeSearchIdentifier('11.222.333-4'), '112223334');
  assert.equal(identifierStartsWith('11.222.333-4', '1122'), true);
  assert.equal(identifierStartsWith('11.222.333-4', '2233'), false);
});
