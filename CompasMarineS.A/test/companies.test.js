import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_COMPANIES_KEY,
  CONTROL_DOC_COMPANIES,
  buildComplianceDataByCompany,
  buildCompanyOptions,
  filterComplianceDataByCompany,
  getCompanyKey,
  getControlDocSourceId,
  getEntityCompanyName
} from '../src/controldoc/companies.js';

test('prioriza el tag de origen de ControlDoc sobre variantes de entity_type_id', () => {
  const record = {
    entity_type_id: 468,
    fields: [{ name: 'control_doc_source_entity_type_id', value: 467 }]
  };

  assert.equal(getControlDocSourceId(record), '467');
  assert.equal(getControlDocSourceId({ custom_fields: { entityTypeId: 468 } }), '468');
  assert.equal(getCompanyKey(record), 'source:467');
});

test('extrae nombres de empresa desde campos y objetos anidados', () => {
  assert.equal(
    getEntityCompanyName({ custom_fields: { empresa: 'Naviera Uno SpA' } }),
    'Naviera Uno SpA'
  );
  assert.equal(
    getEntityCompanyName({ fields: [{ name: 'razón social', value: 'Naviera Dos S.A.' }] }),
    'Naviera Dos S.A.'
  );
  assert.equal(
    getEntityCompanyName({ profile: { employer: { legal_name: 'Naviera Tres Ltda.' } } }),
    'Naviera Tres Ltda.'
  );
  assert.equal(
    getCompanyKey({ company: { name: 'Compañía del Sur' } }),
    'name:compania del sur'
  );
  assert.equal(
    getCompanyKey({ empresa: 'Compas Marine Trabajos Marítimos SA' }),
    'source:468'
  );
});

test('construye las tres empresas base, usa el nombre más frecuente y conserva empresas vacías', () => {
  const entities = [
    { id: 1, control_doc_source_entity_type_id: 468, empresa: 'Nombre ocasional' },
    { id: 2, control_doc_source_entity_type_id: 467, company: { name: 'Servicios Uno' } },
    { id: 3, control_doc_source_entity_type_id: 467, custom_fields: { organization: 'Servicios Uno' } },
    { id: 4, control_doc_source_entity_type_id: 467, empresa: 'Otro nombre' },
    { id: 5, control_doc_source_entity_type_id: 470 },
    { id: 6, empresa: 'Empresa sin source' }
  ];

  assert.deepEqual(CONTROL_DOC_COMPANIES, {
    467: 'Compas Marine Servicios Acuícolas SpA',
    468: 'Compas Marine Trabajos Marítimos S.A.',
    469: 'Compas Marine Servicios Acuícolas SA'
  });
  assert.deepEqual(buildCompanyOptions(entities), [
    { key: ALL_COMPANIES_KEY, label: 'Todos', sourceId: '' },
    { key: 'source:467', label: 'Servicios Uno', sourceId: '467' },
    { key: 'source:468', label: 'Nombre ocasional', sourceId: '468' },
    {
      key: 'source:469',
      label: 'Compas Marine Servicios Acuícolas SA',
      sourceId: '469'
    },
    { key: 'source:470', label: 'Empresa 470', sourceId: '470' },
    { key: 'name:empresa sin source', label: 'Empresa sin source', sourceId: '' }
  ]);
});

test('ordena numéricamente los source adicionales después del catálogo', () => {
  const options = buildCompanyOptions([
    { control_doc_source_entity_type_id: 1000 },
    { control_doc_source_entity_type_id: 7 },
    { control_doc_source_entity_type_id: 50 }
  ]);

  assert.deepEqual(
    options.map((option) => option.key),
    ['all', 'source:467', 'source:468', 'source:469', 'source:7', 'source:50', 'source:1000']
  );
});

test('filtra entidades y documentos por tag, asociando los documentos sin tag por entidad', () => {
  const entities = [
    { id: 101, control_doc_source_entity_type_id: 467, empresa: 'Uno' },
    { id: 102, control_doc_source_entity_type_id: 467, empresa: 'Uno' },
    { id: 201, control_doc_source_entity_type_id: 468, empresa: 'Dos' },
    { id: 301, control_doc_source_entity_type_id: 469, empresa: 'Tres' }
  ];
  const documents = [
    { id: 'tag-uno', control_doc_source_entity_type_id: 467, entity_id: 101 },
    { id: 'tag-dos', control_doc_source_entity_type_id: 468, entity_id: 201 },
    { id: 'sin-tag-uno', entity_id: 102 },
    { id: 'sin-tag-dos', custom_fields: { collaborator_id: 201 } },
    {
      id: 'tag-manda',
      control_doc_source_entity_type_id: 468,
      entity_id: 101
    },
    { id: 'sin-relacion', entity_id: 999 }
  ];

  const filtered = filterComplianceDataByCompany(entities, documents, 'source:467');

  assert.deepEqual(filtered.entities.map((entity) => entity.id), [101, 102]);
  assert.deepEqual(filtered.documents.map((document) => document.id), ['tag-uno', 'sin-tag-uno']);
});

test('Todos devuelve las colecciones completas sin copiarlas', () => {
  const entities = [{ id: 1 }];
  const documents = [{ id: 2 }];
  const filtered = filterComplianceDataByCompany(entities, documents, ALL_COMPANIES_KEY);

  assert.strictEqual(filtered.entities, entities);
  assert.strictEqual(filtered.documents, documents);
});

test('no atribuye un documento legacy sin empresa cuando el ID existe en dos empresas', () => {
  const entities = [
    { id: 123, control_doc_source_entity_type_id: 467 },
    { id: 123, control_doc_source_entity_type_id: 468 }
  ];
  const documents = [
    { id: 'ambiguo', entity_id: 123 },
    { id: 'etiquetado', entity_id: 123, control_doc_source_entity_type_id: 467 }
  ];

  const filtered = filterComplianceDataByCompany(entities, documents, 'source:467');

  assert.deepEqual(filtered.documents.map((document) => document.id), ['etiquetado']);
});

test('indexa todas las empresas en una pasada con el mismo resultado que el filtro individual', () => {
  const entities = [
    { id: 101, control_doc_source_entity_type_id: 467 },
    { id: 102, control_doc_source_entity_type_id: 467 },
    { id: 201, control_doc_source_entity_type_id: 468 },
    { id: 301, control_doc_source_entity_type_id: 469 },
    { id: 555, control_doc_source_entity_type_id: 467 },
    { id: 555, control_doc_source_entity_type_id: 468 }
  ];
  const documents = [
    { id: 'uno', control_doc_source_entity_type_id: 467, entity_id: 101 },
    { id: 'dos', control_doc_source_entity_type_id: 468, entity_id: 201 },
    { id: 'legacy-uno', entity_id: 102 },
    { id: 'legacy-ambiguo', entity_id: 555 },
    { id: 'tag-prioritario', control_doc_source_entity_type_id: 468, entity_id: 101 },
    { id: 'sin-relacion', entity_id: 999 }
  ];
  const companyKeys = ['all', 'source:467', 'source:468', 'source:469'];
  const indexed = buildComplianceDataByCompany(entities, documents, companyKeys);

  companyKeys.forEach((companyKey) => {
    assert.deepEqual(
      indexed.get(companyKey),
      filterComplianceDataByCompany(entities, documents, companyKey)
    );
  });
  assert.strictEqual(indexed.get(ALL_COMPANIES_KEY).documents, documents);
});
