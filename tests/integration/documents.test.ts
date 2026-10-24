import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import { documentTemplateRepository } from '../../packages/core/src/document-templates.js';
import { documentLayoutRepository } from '../../packages/core/src/document-layouts.js';
import { documentNumberRepository } from '../../packages/core/src/document-numbers.js';
import {
  documentRepository,
  registerDocumentRoutes,
  type DocumentDependencies,
} from '../../packages/core/src/documents.js';
import { readDocumentPdf } from '../../packages/core/src/document-artifacts.js';
import {
  StorageError,
  type StorageAdapter,
} from '../../packages/core/src/storage.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';

let container: StartedPostgreSqlContainer,
  pool: Pool,
  actorId: string,
  otherActorId: string,
  templateId: string,
  otherTemplateId: string;
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  contactId = randomUUID(),
  otherContactId = randomUUID(),
  eventId = randomUUID(),
  locationId = randomUUID(),
  now = new Date('2030-10-26T10:00:00Z');
const site = 'https://admin.example.invalid';

function memoryStore() {
  const files = new Map<string, Buffer>();
  const store: StorageAdapter = {
    async put(key, bytes) {
      files.set(key, Buffer.from(bytes));
    },
    async read(key) {
      const bytes = files.get(key);
      if (!bytes) throw new StorageError('missing');
      return bytes;
    },
    async remove(key) {
      files.delete(key);
    },
  };
  return { store, files };
}

function dependencies(overrides: Partial<DocumentDependencies> = {}) {
  const { store, files } = memoryStore(),
    rendered: string[] = [];
  return {
    files,
    rendered,
    deps: {
      origin: site,
      store,
      now: () => now,
      render: async (html: string) => {
        rendered.push(html);
        return Buffer.from('%PDF-1.4 synthetic ' + html.length);
      },
      ...overrides,
    } satisfies DocumentDependencies,
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'documents@example.invalid',
    'Synthetic documents',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'documents', email: 'documents@example.invalid' },
    digest('synthetic-documents'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other-documents@example.invalid',
    'Synthetic other documents',
    'Europe/Berlin',
  );
  await accessRepository(pool, otherTenantId).issueSession(
    { subject: 'other-documents', email: 'other-documents@example.invalid' },
    digest('synthetic-other-documents'),
  );
  otherActorId = (await accessRepository(pool, otherTenantId).list())[0]!
    .userId!;
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Customer','Robin Example','Example Street 2','12345',
      'Fictional Town','DE','customer@example.invalid','','','','','active',1)`,
    [tenantId, contactId],
  );
  await pool.query(
    `INSERT INTO locations (tenant_id,id,name,street,postal_code,city,country,state,version)
     VALUES ($1,$2,'Fictional Hall','Hall Street 3','12345','Fictional Town','DE','active',1)`,
    [tenantId, locationId],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Wedding','inquiry',NULL,NULL,$3,'synthetic','2030-11-14',NULL,NULL,
      'Europe/Berlin','','',1)`,
    [tenantId, eventId, locationId],
  );
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Other Customer','Alex Example','Other Street 4','54321',
      'Other Town','DE','other@example.invalid','','','','','active',1)`,
    [otherTenantId, otherContactId],
  );
  const positions = [
    {
      productId: null,
      description: 'Fictional box',
      quantity: 1,
      unit: 'Stück',
      unitPriceMinor: 19900,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
    {
      productId: null,
      description: 'Fictional delivery',
      quantity: 1,
      unit: 'Pauschale',
      unitPriceMinor: 5000,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
  ];
  templateId = (
    await documentTemplateRepository(pool, tenantId).save(actorId, {
      kind: 'offer',
      name: 'Fictional offer',
      subject: 'Angebot für {{contact}}',
      introText: 'Veranstaltung {{event}} am {{date}} in {{location}}.',
      outroText: 'Gesamt {{total}}. Link: {{documentLink}}',
      validityDays: 14,
      state: 'active',
      positions,
    })
  ).id;
  otherTemplateId = (
    await documentTemplateRepository(pool, otherTenantId).save(otherActorId, {
      kind: 'offer',
      name: 'Other offer',
      subject: 'Angebot für {{contact}}',
      introText: 'Other {{contact}}',
      outroText: 'Other end',
      validityDays: 14,
      state: 'active',
      positions: [positions[0]!],
    })
  ).id;
  await documentNumberRepository(pool, tenantId).save(actorId, 'offer', {
    pattern: 'AN-{YYYY}-{SEQ}',
    minLength: 4,
    nextValue: 1,
  });
  await documentLayoutRepository(pool, tenantId, memoryStore().store).save(
    actorId,
    {
      senderName: 'Fictional Studio',
      senderStreet: 'Synthetic Street 1',
      senderPostalCode: '12345',
      senderCity: 'Fictional Town',
      primaryColor: '#2f6f4f',
      textColor: '#1b1b1b',
      fontFamily: 'sans',
      showPageNumbers: true,
      showPositionNumbers: true,
    },
  );
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('a draft copies the template positions and exposes the exact totals', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, {
      templateId,
      eventId,
      contactId,
    });
  await expect(
    pool.query(
      'UPDATE documents SET validity_days=NULL WHERE tenant_id=$1 AND id=$2',
      [tenantId, draft.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(draft).toMatchObject({
    kind: 'offer',
    state: 'draft',
    subject: 'Angebot für {{contact}}',
    introText: 'Veranstaltung {{event}} am {{date}} in {{location}}.',
    outroText: 'Gesamt {{total}}. Link: {{documentLink}}',
    validityDays: 14,
    number: null,
    finalizedAt: null,
    snapshotHash: null,
    pdfHash: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
  });
  expect(draft.lines.map((line) => line.description)).toEqual([
    'Fictional box',
    'Fictional delivery',
  ]);
  expect(draft.lines.map((line) => line.position)).toEqual([0, 1]);
});

test('a blank offer starts without a template or positions and cannot be saved or finalized empty', async () => {
  const run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    blank = await repo.createBlankOffer(actorId, { eventId, contactId });
  expect(blank).toMatchObject({
    kind: 'offer',
    templateId: null,
    eventId,
    contactId,
    subject: 'Angebot',
    introText: '',
    outroText: '',
    validityDays: 14,
    number: null,
    state: 'draft',
    netMinor: 0,
    taxMinor: 0,
    grossMinor: 0,
    version: 1,
    lines: [],
  });

  const before = (
    await pool.query<{ next_value: number }>(
      'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
      [tenantId, 'offer'],
    )
  ).rows[0]!.next_value;
  await expect(repo.preview(blank.id)).rejects.toMatchObject({
    reason: 'empty_lines',
  });
  await expect(repo.finalize(actorId, blank.id)).rejects.toMatchObject({
    reason: 'empty_lines',
  });
  await expect(
    repo.updateDraftContent(actorId, blank.id, {
      version: 1,
      subject: 'Eigenes Angebot',
      introText: '',
      outroText: '',
      validityDays: 14,
    }),
  ).rejects.toMatchObject({ reason: 'empty_lines' });
  expect(
    (
      await pool.query<{ next_value: number }>(
        'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
        [tenantId, 'offer'],
      )
    ).rows[0]!.next_value,
  ).toBe(before);
  await expect(
    pool.query(
      `INSERT INTO documents
        (tenant_id,id,kind,template_id,event_id,contact_id,issued_at)
       VALUES ($1,$2,'invoice',NULL,$3,$4,$5)`,
      [tenantId, randomUUID(), eventId, contactId, now],
    ),
  ).rejects.toMatchObject({
    code: '23514',
    constraint: 'documents_blank_offer_context',
  });
  await expect(
    pool.query(
      `INSERT INTO documents
        (tenant_id,id,kind,template_id,event_id,contact_id,issued_at)
       VALUES ($1,$2,'offer',NULL,$3,$4,$5)`,
      [tenantId, randomUUID(), eventId, contactId, now],
    ),
  ).rejects.toMatchObject({
    code: '23514',
    constraint: 'documents_blank_offer_context',
  });
  expect(await repo.get(blank.id)).toMatchObject({
    templateId: null,
    version: 1,
    lines: [],
    subject: 'Angebot',
  });

  const saved = await repo.updateDraftContent(actorId, blank.id, {
    version: 1,
    subject: 'Eigenes Blankoangebot',
    introText: 'Eigene Einleitung',
    outroText: 'Eigener Schlusstext',
    validityDays: 14,
    lines: [
      {
        productId: null,
        description: 'Fiktive Blankoposition',
        quantity: 1,
        unit: 'Pauschale',
        unitPriceMinor: 10000,
        taxBasisPoints: 0,
        discountBasisPoints: 0,
      },
    ],
  });
  expect(saved).toMatchObject({
    templateId: null,
    version: 2,
    grossMinor: 10000,
    lines: [{ description: 'Fiktive Blankoposition' }],
  });
  await repo.preview(blank.id);
  expect(run.rendered[0]).toContain('Eigenes Blankoangebot');
  expect(run.rendered[0]).toContain('Eigene Einleitung');
  expect(run.rendered[0]).not.toContain('Fictional offer');

  const finalized = await repo.finalize(actorId, blank.id, saved.version);
  expect(finalized).toMatchObject({
    templateId: null,
    kind: 'offer',
    state: 'final',
    number: 'AN-2030-0001',
    version: 3,
    subject: 'Eigenes Blankoangebot',
    introText: 'Eigene Einleitung',
    outroText: 'Eigener Schlusstext',
    grossMinor: 10000,
  });
  expect(finalized.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  expect(finalized.pdfHash).toMatch(/^[a-f0-9]{64}$/);
  const pdf = await readDocumentPdf(run.deps.store, finalized.pdfHash!);
  expect(pdf).toEqual(run.files.get(finalized.pdfHash! + '.pdf'));
  expect(run.rendered.at(-1)).toContain('Eigenes Blankoangebot');
  expect(run.rendered.at(-1)).toContain('Eigene Einleitung');
  expect(run.rendered.at(-1)).toContain('Fiktive Blankoposition');
  expect(run.rendered.at(-1)).not.toContain('Fictional offer');

  await expect(
    repo.updateDraftContent(actorId, blank.id, {
      version: finalized.version,
      subject: 'Nachträgliche Änderung',
      introText: '',
      outroText: '',
      validityDays: 14,
      lines: saved.lines.map((line) => ({
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceMinor: line.unitPriceMinor,
        taxBasisPoints: line.taxBasisPoints,
        discountBasisPoints: line.discountBasisPoints,
      })),
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  await expect(
    repo.finalize(actorId, blank.id, finalized.version),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  expect(await repo.get(blank.id)).toMatchObject({
    state: 'final',
    number: finalized.number,
    version: finalized.version,
    snapshotHash: finalized.snapshotHash,
    pdfHash: finalized.pdfHash,
  });
  expect(
    (
      await pool.query<{ next_value: number }>(
        'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
        [tenantId, 'offer'],
      )
    ).rows[0]!.next_value,
  ).toBe(before + 1);

  // Keep the shared numbering sequence deterministic for later tests.
  await run.deps.store.remove(finalized.pdfHash! + '.pdf');
  await pool.query('DELETE FROM documents WHERE tenant_id=$1 AND id=$2', [
    tenantId,
    blank.id,
  ]);
  await pool.query(
    "UPDATE document_number_sequences SET next_value=$1, version=1 WHERE tenant_id=$2 AND kind='offer'",
    [before, tenantId],
  );
});

test('defaults the issue time to the wall clock without an injected clock', async () => {
  const before = Date.now(),
    draft = await documentRepository(pool, tenantId, {
      origin: site,
      store: memoryStore().store,
      render: async () => Buffer.from('%PDF-1.4 synthetic'),
    }).createDraft(actorId, { templateId, contactId, eventId });
  expect(draft.issuedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect(draft.issuedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
});

test('finalizing allocates one number, freezes the snapshot and stores the pdf', async () => {
  const run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, eventId, contactId }),
    finalized = await repo.finalize(actorId, draft.id);
  expect(finalized).toMatchObject({
    state: 'final',
    number: 'AN-2030-0001',
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 2,
  });
  expect(finalized.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  expect(finalized.pdfHash).toMatch(/^[a-f0-9]{64}$/);
  expect(finalized.finalizedAt?.toISOString()).toBe(now.toISOString());
  expect(finalized.issuedAt.toISOString()).toBe(now.toISOString());
  const pdfBytes = Buffer.from('%PDF-1.4 synthetic ' + run.rendered[0]!.length);
  expect(run.files.get(finalized.pdfHash! + '.pdf')).toEqual(pdfBytes);
  expect(await readDocumentPdf(run.deps.store, finalized.pdfHash!)).toEqual(
    pdfBytes,
  );
  const html = run.rendered[0]!;
  expect(html).toContain('Fictional Customer');
  expect(html).toContain('Fictional Wedding');
  expect(html).toContain('14.11.2030');
  expect(html).toContain('Fictional Hall');
  expect(html).toContain('249,00');
  expect(html).toContain(site + '/#document-' + draft.id);
  const actions = (
    await pool.query<{ action: string }>(
      'SELECT action FROM audit_events WHERE tenant_id=$1 AND record_id=$2 ORDER BY id',
      [tenantId, draft.id],
    )
  ).rows.map((row) => row.action);
  expect(actions).toEqual(['document.created', 'document.finalized']);
});

test('finalization uses the draft text snapshot after the template changes', async () => {
  const run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, eventId, contactId });
  try {
    await documentTemplateRepository(pool, tenantId).save(
      actorId,
      {
        kind: 'offer',
        name: 'Fictional offer revised',
        subject: 'Changed after draft',
        introText: 'Changed intro',
        outroText: 'Changed outro',
        validityDays: 30,
        state: 'active',
        positions: [
          {
            productId: null,
            description: 'Fictional box',
            quantity: 1,
            unit: 'Stück',
            unitPriceMinor: 19900,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
          {
            productId: null,
            description: 'Fictional delivery',
            quantity: 1,
            unit: 'Pauschale',
            unitPriceMinor: 5000,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
        ],
      },
      templateId,
      1,
    );
    const legacyDraft = await repo.createDraft(actorId, {
      templateId,
      eventId,
      contactId,
    });
    await pool.query(
      'UPDATE documents SET subject=NULL,intro_text=NULL,outro_text=NULL,validity_days=NULL WHERE tenant_id=$1 AND id=$2',
      [tenantId, legacyDraft.id],
    );
    await repo.preview(legacyDraft.id);
    expect(run.rendered.at(-1)).toContain('Changed after draft');
    expect(run.rendered.at(-1)).toContain('Gültig bis 25.11.2030');
    const finalized = await repo.finalize(actorId, draft.id);
    const finalHtml = run.rendered.at(-1)!;
    expect(finalized.subject).toBe('Angebot für {{contact}}');
    expect(finalHtml).toContain('Angebot für Fictional Customer');
    expect(finalHtml).not.toContain('Changed after draft');
    expect(finalHtml).toContain('Gültig bis 09.11.2030');
  } finally {
    await documentTemplateRepository(pool, tenantId).save(
      actorId,
      {
        kind: 'offer',
        name: 'Fictional offer',
        subject: 'Angebot für {{contact}}',
        introText: 'Veranstaltung {{event}} am {{date}} in {{location}}.',
        outroText: 'Gesamt {{total}}. Link: {{documentLink}}',
        validityDays: 14,
        state: 'active',
        positions: [
          {
            productId: null,
            description: 'Fictional box',
            quantity: 1,
            unit: 'Stück',
            unitPriceMinor: 19900,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
          {
            productId: null,
            description: 'Fictional delivery',
            quantity: 1,
            unit: 'Pauschale',
            unitPriceMinor: 5000,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
        ],
      },
      templateId,
      2,
    );
  }
});

test('editing a draft can replace its positions and recompute saved totals', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    productId = randomUUID();
  await pool.query(
    `INSERT INTO products (tenant_id,id,name,description,unit,price_minor,price_basis,
      tax_basis_points,state,position,version)
     VALUES ($1,$2,'Fictional archived product','','Stück',1000,'gross',1900,'archived',999,1)`,
    [tenantId, productId],
  );

  const saved = await repo.updateDraftContent(actorId, draft.id, {
    version: draft.version,
    subject: draft.subject!,
    introText: draft.introText!,
    outroText: draft.outroText!,
    validityDays: draft.validityDays!,
    lines: [
      {
        productId,
        description: 'Edited archived product position',
        quantity: 2,
        unit: 'Stück',
        unitPriceMinor: 1000,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
      {
        productId: null,
        description: 'Edited free position',
        quantity: 1,
        unit: 'Pauschale',
        unitPriceMinor: 500,
        taxBasisPoints: 0,
        discountBasisPoints: 1000,
      },
    ],
  });

  expect(saved).toMatchObject({
    version: 2,
    netMinor: 2131,
    taxMinor: 319,
    grossMinor: 2450,
    lines: [
      {
        position: 0,
        productId,
        description: 'Edited archived product position',
      },
      { position: 1, productId: null, description: 'Edited free position' },
    ],
  });
  expect(saved.lines.map((line) => line.id)).not.toEqual(
    draft.lines.map((line) => line.id),
  );
  expect(await repo.get(draft.id)).toMatchObject(saved);
});

test('editing draft content without lines preserves existing line ids and values', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    saved = await repo.updateDraftContent(actorId, draft.id, {
      version: draft.version,
      subject: draft.subject!,
      introText: draft.introText!,
      outroText: draft.outroText!,
      validityDays: draft.validityDays!,
    });
  expect(saved.version).toBe(draft.version + 1);
  expect(saved.lines).toEqual(draft.lines);
  expect(saved).toMatchObject({
    netMinor: draft.netMinor,
    taxMinor: draft.taxMinor,
    grossMinor: draft.grossMinor,
  });
});

test('invalid, overflowing and foreign-product edits leave the draft untouched', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    otherProductId = randomUUID(),
    content = {
      version: draft.version,
      subject: draft.subject!,
      introText: draft.introText!,
      outroText: draft.outroText!,
      validityDays: draft.validityDays!,
    },
    line = {
      description: 'Replacement line',
      quantity: 1,
      unit: 'Stück',
      unitPriceMinor: 1000,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    };
  await pool.query(
    `INSERT INTO products (tenant_id,id,name,description,unit,price_minor,price_basis,
      tax_basis_points,state,position,version)
     VALUES ($1,$2,'Other fictional product','','Stück',1000,'gross',1900,'active',998,1)`,
    [otherTenantId, otherProductId],
  );
  await expect(
    repo.updateDraftContent(actorId, draft.id, { ...content, lines: [] }),
  ).rejects.toMatchObject({ reason: 'empty_lines' });
  await expect(
    repo.updateDraftContent(actorId, draft.id, {
      ...content,
      lines: [{ ...line, description: ' '.repeat(301) }],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_line' });
  await expect(
    repo.updateDraftContent(actorId, draft.id, {
      ...content,
      lines: [
        { ...line, unitPriceMinor: Number.MAX_SAFE_INTEGER },
        { ...line, unitPriceMinor: 1 },
      ],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_line' });
  await expect(
    repo.updateDraftContent(actorId, draft.id, {
      ...content,
      lines: [{ ...line, productId: otherProductId }],
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect(await repo.get(draft.id)).toEqual(draft);
  const updates = await pool.query(
    "SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='document.updated' AND record_id=$2",
    [tenantId, draft.id],
  );
  expect(updates.rows[0].count).toBe('0');
});

test('concurrent position edits accept one version and audit it once', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    edit = (description: string) =>
      repo.updateDraftContent(actorId, draft.id, {
        version: draft.version,
        subject: draft.subject!,
        introText: draft.introText!,
        outroText: draft.outroText!,
        validityDays: draft.validityDays!,
        lines: [
          {
            description,
            quantity: 1,
            unit: 'Pauschale',
            unitPriceMinor: 1000,
            taxBasisPoints: 0,
            discountBasisPoints: 0,
          },
        ],
      }),
    results = await Promise.allSettled([
      edit('Concurrent edit A'),
      edit('Concurrent edit B'),
    ]);
  expect(results.map((result) => result.status).sort()).toEqual([
    'fulfilled',
    'rejected',
  ]);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected).toMatchObject({ reason: { reason: 'conflict' } });
  const saved = await repo.get(draft.id);
  expect(saved).toMatchObject({ version: 2, grossMinor: 1000 });
  expect(saved!.lines[0]!.description).toMatch(/^Concurrent edit [AB]$/);
  await expect(
    repo.updateDraftContent(actorId, draft.id, {
      version: draft.version,
      subject: draft.subject!,
      introText: draft.introText!,
      outroText: draft.outroText!,
      validityDays: draft.validityDays!,
      lines: [
        {
          description: 'Stale retried edit',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 2000,
          taxBasisPoints: 0,
          discountBasisPoints: 0,
        },
      ],
    }),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await repo.get(draft.id)).toEqual(saved);
  const updates = await pool.query(
    "SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='document.updated' AND record_id=$2",
    [tenantId, draft.id],
  );
  expect(updates.rows[0].count).toBe('1');
});

test('a concurrent position edit and finalization preserve the winning version', async () => {
  const run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    edit = repo.updateDraftContent(actorId, draft.id, {
      version: draft.version,
      subject: draft.subject!,
      introText: draft.introText!,
      outroText: draft.outroText!,
      validityDays: draft.validityDays!,
      lines: [
        {
          description: 'Concurrent final line',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 1000,
          taxBasisPoints: 0,
          discountBasisPoints: 0,
        },
      ],
    }),
    [updated, finalized] = await Promise.allSettled([
      edit,
      repo.finalize(actorId, draft.id),
    ]);
  expect(finalized.status).toBe('fulfilled');
  if (finalized.status !== 'fulfilled') throw finalized.reason;
  if (updated.status === 'fulfilled') {
    expect(finalized.value).toMatchObject({ version: 3, grossMinor: 1000 });
    expect(finalized.value.lines[0]!.description).toBe('Concurrent final line');
  } else {
    expect(updated.reason).toMatchObject({ reason: 'invalid_state' });
    expect(finalized.value).toMatchObject({ version: 2, grossMinor: 24900 });
  }
  expect(run.rendered).toHaveLength(1);
});

test('a second finalize is rejected and never consumes another number', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    finalized = await repo.finalize(actorId, draft.id),
    preview = await documentNumberRepository(pool, tenantId).preview(
      'offer',
      now,
    );
  await expect(repo.finalize(actorId, draft.id)).rejects.toMatchObject({
    reason: 'invalid_state',
  });
  expect((await repo.get(draft.id))?.number).toBe(finalized.number);
  expect(
    await documentNumberRepository(pool, tenantId).preview('offer', now),
  ).toBe(preview);
});

test('a failing renderer rolls the number back and leaves a draft', async () => {
  const run = dependencies({
      render: async () => {
        throw new Error('synthetic renderer failure');
      },
    }),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    before = await documentNumberRepository(pool, tenantId).preview(
      'offer',
      now,
    );
  await expect(repo.finalize(actorId, draft.id)).rejects.toMatchObject({
    reason: 'artifact_failed',
  });
  const stored = await repo.get(draft.id);
  expect(stored).toMatchObject({
    state: 'draft',
    number: null,
    snapshotHash: null,
    pdfHash: null,
    version: 1,
  });
  expect(
    await documentNumberRepository(pool, tenantId).preview('offer', now),
  ).toBe(before);
  expect(run.files.size).toBe(0);
});

test('a storage failure is reported and the document stays a draft', async () => {
  const run = dependencies({
      store: {
        async put() {
          throw new StorageError('too_large');
        },
        async read() {
          throw new StorageError('missing');
        },
        async remove() {},
      },
    }),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId });
  await expect(repo.finalize(actorId, draft.id)).rejects.toMatchObject({
    reason: 'artifact_failed',
  });
  expect((await repo.get(draft.id))?.state).toBe('draft');
});

test('documents never cross a tenant boundary', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    other = documentRepository(pool, otherTenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId });
  expect(await other.get(draft.id)).toBeNull();
  await expect(other.finalize(otherActorId, draft.id)).rejects.toMatchObject({
    reason: 'not_found',
  });
  await expect(
    other.updateDraftContent(otherActorId, draft.id, {
      version: 1,
      subject: 'Foreign edit',
      introText: '',
      outroText: '',
      validityDays: 14,
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    other.createDraft(otherActorId, { templateId, contactId }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    repo.createDraft(actorId, { templateId: otherTemplateId, contactId }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    repo.createDraft(actorId, { templateId, contactId: otherContactId }),
  ).rejects.toMatchObject({ reason: 'not_found' });
});

test('a tenant without layout, contact or number sequence is rejected cleanly', async () => {
  const other = documentRepository(pool, otherTenantId, dependencies().deps),
    draft = await other.createDraft(otherActorId, {
      templateId: otherTemplateId,
      contactId: otherContactId,
    });
  await expect(other.finalize(otherActorId, draft.id)).rejects.toMatchObject({
    reason: 'missing_reference',
  });
  const missingContact = await documentRepository(
    pool,
    tenantId,
    dependencies().deps,
  ).createDraft(actorId, { templateId });
  await expect(
    documentRepository(pool, tenantId, dependencies().deps).finalize(
      actorId,
      missingContact.id,
    ),
  ).rejects.toMatchObject({ reason: 'missing_reference' });
  const invoiceTemplate = await documentTemplateRepository(pool, tenantId).save(
    actorId,
    {
      kind: 'invoice',
      name: 'Fictional invoice',
      subject: 'Rechnung {{contact}}',
      introText: '',
      outroText: '',
      validityDays: 14,
      state: 'active',
      positions: [],
    },
  );
  const invoice = await documentRepository(
    pool,
    tenantId,
    dependencies().deps,
  ).createDraft(actorId, {
    templateId: invoiceTemplate.id,
    contactId,
    lines: [
      {
        description: 'Fictional invoice line',
        quantity: 1,
        unit: 'Stück',
        unitPriceMinor: 1000,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ],
  });
  await expect(
    documentRepository(pool, tenantId, dependencies().deps).finalize(
      actorId,
      invoice.id,
    ),
  ).rejects.toMatchObject({ reason: 'number_not_configured' });
});

test('event type, package and a missing event date fill the remaining placeholders', async () => {
  const typeId = randomUUID(),
    packageId = randomUUID(),
    eventId2 = randomUUID();
  await pool.query(
    `INSERT INTO master_data (tenant_id,id,kind,name,position,state,version)
     VALUES ($1,$2,'event_type','Fictional Wedding Type',0,'active',1),
       ($1,$3,'package','Fictional Package',1,'active',1)`,
    [tenantId, typeId, packageId],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Undated Event','inquiry',$3,$4,NULL,'synthetic',NULL,NULL,NULL,
      'Europe/Berlin','','',1)`,
    [tenantId, eventId2, typeId, packageId],
  );
  const template = await documentTemplateRepository(pool, tenantId).save(
      actorId,
      {
        kind: 'offer',
        name: 'Fictional package offer',
        subject: 'Paket {{package}}',
        introText: 'Art {{eventType}} für {{event}}',
        outroText: 'Ende',
        validityDays: 14,
        state: 'active',
        positions: [],
      },
    ),
    run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, {
      templateId: template.id,
      contactId,
      eventId: eventId2,
      lines: [
        {
          description: 'Fictional package line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
    finalized = await repo.finalize(actorId, draft.id);
  expect(finalized.state).toBe('final');
  expect(run.rendered[0]).toContain('Fictional Package');
  expect(run.rendered[0]).toContain('Fictional Wedding Type');
  expect(run.rendered[0]).toContain('Fictional Undated Event');
});

test('a template placeholder without a value rejects the document', async () => {
  const template = await documentTemplateRepository(pool, tenantId).save(
      actorId,
      {
        kind: 'offer',
        name: 'Fictional package only',
        subject: 'Paket {{package}}',
        introText: '',
        outroText: '',
        validityDays: 14,
        state: 'active',
        positions: [],
      },
    ),
    repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, {
      templateId: template.id,
      contactId,
      lines: [
        {
          description: 'Fictional line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    });
  await expect(repo.finalize(actorId, draft.id)).rejects.toMatchObject({
    reason: 'invalid_content',
  });
});

test('an unexpected storage failure passes through untouched and rolls back', async () => {
  const run = dependencies({
      store: {
        async put() {
          throw new TypeError('synthetic adapter bug');
        },
        async read() {
          throw new TypeError('synthetic adapter bug');
        },
        async remove() {},
      },
    }),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId });
  await expect(repo.finalize(actorId, draft.id)).rejects.toThrow(TypeError);
  expect((await repo.get(draft.id))?.state).toBe('draft');
});

test('a contact without a person still becomes a clean recipient', async () => {
  const plainContactId = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'company','Fictional Company','','Company Street 5','12345',
      'Fictional Town','DE','company@example.invalid','','','','','active',1)`,
    [tenantId, plainContactId],
  );
  const template = await documentTemplateRepository(pool, tenantId).save(
      actorId,
      {
        kind: 'offer',
        name: 'Fictional plain offer',
        subject: 'Angebot {{contact}}',
        introText: 'Hallo',
        outroText: 'Ende',
        validityDays: 14,
        state: 'active',
        positions: [],
      },
    ),
    run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, {
      templateId: template.id,
      contactId: plainContactId,
      lines: [
        {
          description: 'Fictional line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    });
  await repo.finalize(actorId, draft.id);
  expect(run.rendered[0]).toContain('Fictional Company');
  expect(run.rendered[0]).not.toContain('undefined');
});

test('a draft refuses empty and malformed lines', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps);
  await expect(
    repo.createDraft(actorId, { templateId, contactId, lines: [] }),
  ).rejects.toMatchObject({ reason: 'empty_lines' });
  await expect(
    repo.createDraft(actorId, {
      templateId,
      contactId,
      lines: [
        {
          description: ' ',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_line' });
  await expect(
    repo.createDraft(actorId, {
      templateId,
      contactId,
      lines: [
        {
          description: 'Fictional line',
          quantity: 1,
          unit: ' ',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_line' });
});

test('the pdf download refuses drafts, missing artefacts and broken stores', async () => {
  const run = dependencies(),
    repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId });
  await expect(repo.pdf(draft.id)).rejects.toMatchObject({
    reason: 'not_found',
  });
  const finalized = await repo.finalize(actorId, draft.id);
  await expect(repo.pdf(finalized.id)).resolves.toMatchObject({
    number: finalized.number,
  });
  await run.deps.store.remove(finalized.pdfHash! + '.pdf');
  await expect(repo.pdf(finalized.id)).rejects.toMatchObject({
    reason: 'not_found',
  });
  const broken = documentRepository(pool, tenantId, {
    ...run.deps,
    store: {
      async put() {},
      async read() {
        throw new StorageError('failed');
      },
      async remove() {},
    },
  });
  await expect(broken.pdf(finalized.id)).rejects.toMatchObject({
    reason: 'artifact_failed',
  });
});

test('the overview lists documents per tenant and filters by event, kind and state', async () => {
  const repo = documentRepository(pool, tenantId, dependencies().deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    finalized = await repo.finalize(actorId, draft.id);
  const all = await repo.list();
  expect(all.map((row) => row.id)).toContain(finalized.id);
  expect(all.every((row) => !('lines' in row))).toBe(true);
  expect(all[0]!.issuedAt).toBeInstanceOf(Date);
  const byEvent = await repo.list({ eventId });
  expect(byEvent.map((row) => row.id)).toContain(finalized.id);
  expect(byEvent.every((row) => row.eventId === eventId)).toBe(true);
  const finals = await repo.list({ state: 'final' });
  expect(finals.every((row) => row.state === 'final')).toBe(true);
  const drafts = await repo.list({ kind: 'offer', state: 'draft' });
  expect(
    drafts.every((row) => row.state === 'draft' && row.kind === 'offer'),
  ).toBe(true);
  const foreign = await documentRepository(
    pool,
    otherTenantId,
    dependencies().deps,
  ).list();
  expect(foreign.map((row) => row.id)).not.toContain(finalized.id);
});

test('the document API requires auth and enforces the final state', async () => {
  const config = {
    origin: site,
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  const app = createHealthServer(
    loadRuntimeConfig(
      {
        AK_DB_HOST: 'synthetic',
        AK_DB_NAME: 'synthetic',
        AK_DB_USER: 'synthetic',
        AK_DB_PASSWORD_FILE: 'synthetic',
        AK_LOG_LEVEL: 'silent',
      },
      () => 'synthetic-long-secret',
    ),
    { database: async () => true, worker: async () => true },
  );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  const run = dependencies();
  registerDocumentRoutes(app, pool, tenantId, run.deps);
  const cookies = { '__Host-ak-session': 'synthetic-documents' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-documents'),
    };
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/blank-offer',
          payload: { eventId, contactId },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject('/api/v1/documents/' + randomUUID())).statusCode,
    ).toBe(401);
    expect(
      (await app.inject('/api/v1/documents/' + randomUUID() + '/preview'))
        .statusCode,
    ).toBe(401);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      cookies,
      headers,
      payload: { templateId, contactId, eventId },
    });
    expect(created.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          cookies,
          payload: { templateId },
        })
      ).statusCode,
    ).toBe(403);
    const id = created.json().id as string;
    expect(created.json().state).toBe('draft');
    expect(created.json().subject).toBe('Angebot für {{contact}}');
    await pool.query(
      'UPDATE documents SET subject=NULL,intro_text=NULL,outro_text=NULL,validity_days=NULL WHERE tenant_id=$1 AND id=$2',
      [tenantId, id],
    );
    const legacy = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + id,
      cookies,
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toMatchObject({
      subject: null,
      introText: null,
      outroText: null,
      validityDays: null,
    });
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + id + '/draft',
      cookies,
      headers,
      payload: {
        version: 1,
        subject: 'Eigenes Angebot für {{contact}}',
        introText: 'Persönliche Einleitung',
        outroText: 'Gültig für {{total}}',
        validityDays: 21,
        lines: [
          {
            productId: null,
            description: 'API edited line',
            quantity: 2,
            unit: 'Stück',
            unitPriceMinor: 2500,
            taxBasisPoints: 0,
            discountBasisPoints: 0,
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      version: 2,
      subject: 'Eigenes Angebot für {{contact}}',
      validityDays: 21,
      grossMinor: 5000,
      lines: [{ position: 0, description: 'API edited line', quantity: 2 }],
    });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/documents/' + id + '/draft',
          cookies,
          payload: {
            version: 2,
            subject: 'No CSRF',
            introText: '',
            outroText: '',
            validityDays: 21,
          },
        })
      ).statusCode,
    ).toBe(403);
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + id + '/draft',
      cookies,
      headers,
      payload: {
        version: 1,
        subject: 'Stale',
        introText: '',
        outroText: '',
        validityDays: 14,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('conflict');
    const invalidContent = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + id + '/draft',
      cookies,
      headers,
      payload: {
        version: 2,
        subject: '{{unknown}}',
        introText: '',
        outroText: '',
        validityDays: 21,
      },
    });
    expect(invalidContent.statusCode).toBe(400);
    expect(invalidContent.json().error).toBe('invalid_content');
    const beforePreview = await pool.query(
      'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
      [tenantId, 'offer'],
    );
    const invalidFinalizeBody = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/' + id + '/finalize',
      cookies,
      headers,
      payload: [],
    });
    expect(invalidFinalizeBody.statusCode).toBe(400);
    expect(invalidFinalizeBody.json().error).toBe('invalid_content');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + id,
          cookies,
        })
      ).json(),
    ).toMatchObject({ state: 'draft', version: 2, number: null });
    const beforeAudit = await pool.query(
      "SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='document.updated' AND record_id=$2",
      [tenantId, id],
    );
    const preview = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + id + '/preview',
      cookies,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(run.rendered.at(-1)).toContain(
      'Eigenes Angebot für Fictional Customer',
    );
    expect(run.rendered.at(-1)).toContain('Gültig bis');
    expect(run.files.size).toBe(0);
    const renderer = run.deps.render;
    run.deps.render = async () => {
      throw new Error('synthetic renderer failure');
    };
    const failedPreview = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + id + '/preview',
      cookies,
    });
    expect(failedPreview.statusCode).toBe(500);
    expect(failedPreview.json().error).toBe('artifact_failed');
    run.deps.render = renderer;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + id + '/finalize',
          cookies,
          headers,
          payload: { version: 1 },
        })
      ).json().error,
    ).toBe('conflict');
    expect(
      (
        await pool.query(
          'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
          [tenantId, 'offer'],
        )
      ).rows,
    ).toEqual(beforePreview.rows);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='document.updated' AND record_id=$2",
          [tenantId, id],
        )
      ).rows,
    ).toEqual(beforeAudit.rows);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + id + '/finalize',
          cookies,
          headers,
          payload: { version: 2 },
        })
      ).statusCode,
    ).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/' + id + '/finalize',
      cookies,
      headers,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('invalid_state');
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + id,
      cookies,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().number).toMatch(/^AN-\d{4}-\d{4}$/);
    expect(read.json().subject).toBe('Eigenes Angebot für {{contact}}');
    expect(run.rendered.at(-1)).toContain(
      'Eigenes Angebot für Fictional Customer',
    );
    const immutable = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + id + '/draft',
      cookies,
      headers,
      payload: {
        version: 2,
        subject: 'Changed finalized',
        introText: '',
        outroText: '',
        validityDays: 21,
        lines: [
          {
            productId: null,
            description: 'Must remain immutable',
            quantity: 1,
            unit: 'Pauschale',
            unitPriceMinor: 1,
            taxBasisPoints: 0,
            discountBasisPoints: 0,
          },
        ],
      },
    });
    expect(immutable.statusCode).toBe(409);
    expect(immutable.json().error).toBe('invalid_state');
    const pdf = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + id + '/pdf',
      cookies,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('.pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?kind=offer',
      cookies,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().some((row: { id: string }) => row.id === id)).toBe(
      true,
    );
    expect((await app.inject('/api/v1/documents')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents?kind=unknown',
          cookies,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + randomUUID(),
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    const withoutContact = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      cookies,
      headers,
      payload: { templateId },
    });
    expect(withoutContact.statusCode).toBe(201);
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/' + withoutContact.json().id + '/finalize',
      cookies,
      headers,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe('missing_reference');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + withoutContact.json().id + '/pdf',
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + randomUUID() + '/pdf',
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + id + '/pdf',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          cookies,
          headers,
          payload: { templateId: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + randomUUID() + '/finalize',
          cookies,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          cookies,
          headers,
          payload: { templateId: 'not-a-uuid' },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

test('the blank-offer API requires CSRF, event, and tenant contact context', async () => {
  const config = {
    origin: site,
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  const app = createHealthServer(
    loadRuntimeConfig(
      {
        AK_DB_HOST: 'synthetic',
        AK_DB_NAME: 'synthetic',
        AK_DB_USER: 'synthetic',
        AK_DB_PASSWORD_FILE: 'synthetic',
        AK_LOG_LEVEL: 'silent',
      },
      () => 'synthetic-long-secret',
    ),
    { database: async () => true, worker: async () => true },
  );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerDocumentRoutes(app, pool, tenantId, dependencies().deps);
  const cookies = { '__Host-ak-session': 'synthetic-documents' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-documents'),
    };
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/blank-offer',
          cookies,
          headers,
          payload: { eventId },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/blank-offer',
          cookies,
          payload: { eventId, contactId },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/blank-offer',
          cookies,
          headers,
          payload: { eventId: randomUUID(), contactId },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/blank-offer',
          cookies,
          headers,
          payload: { eventId, contactId: otherContactId },
        })
      ).statusCode,
    ).toBe(404);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/blank-offer',
      cookies,
      headers,
      payload: { eventId, contactId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      kind: 'offer',
      templateId: null,
      eventId,
      contactId,
      subject: 'Angebot',
      introText: '',
      outroText: '',
      validityDays: 14,
      netMinor: 0,
      taxMinor: 0,
      grossMinor: 0,
      version: 1,
      lines: [],
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + created.json().id,
          cookies,
        })
      ).json().templateId,
    ).toBeNull();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + created.json().id + '/preview',
          cookies,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + created.json().id + '/finalize',
          cookies,
          headers,
        })
      ).json().error,
    ).toBe('empty_lines');
  } finally {
    await app.close();
  }
});

test('a failing artefact store surfaces as a server error', async () => {
  const config = {
    origin: site,
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  const app = createHealthServer(
    loadRuntimeConfig(
      {
        AK_DB_HOST: 'synthetic',
        AK_DB_NAME: 'synthetic',
        AK_DB_USER: 'synthetic',
        AK_DB_PASSWORD_FILE: 'synthetic',
        AK_LOG_LEVEL: 'silent',
      },
      () => 'synthetic-long-secret',
    ),
    { database: async () => true, worker: async () => true },
  );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerDocumentRoutes(app, pool, tenantId, {
    origin: site,
    now: () => now,
    render: async () => Buffer.from('%PDF-1.4 synthetic'),
    store: {
      async put() {
        throw new StorageError('failed');
      },
      async read() {
        throw new StorageError('missing');
      },
      async remove() {},
    },
  });
  const cookies = { '__Host-ak-session': 'synthetic-documents' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-documents'),
    };
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      cookies,
      headers,
      payload: { templateId, contactId, eventId },
    });
    expect(created.statusCode).toBe(201);
    const failed = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/' + created.json().id + '/finalize',
      cookies,
      headers,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error).toBe('artifact_failed');
  } finally {
    await app.close();
  }
});

test('a configured logo is embedded into the final html', async () => {
  const run = dependencies(),
    png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('synthetic logo'),
    ]),
    layoutRepo = documentLayoutRepository(pool, tenantId, run.deps.store);
  await layoutRepo.saveLogo(actorId, png, 'image/png');
  const repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    finalized = await repo.finalize(actorId, draft.id);
  expect(finalized.state).toBe('final');
  expect(run.rendered[0]).toContain(
    'data:image/png;base64,' + png.toString('base64'),
  );
  await run.deps.store.remove(`logo-${tenantId}.png`);
  const missing = await repo.createDraft(actorId, {
    templateId,
    contactId,
    eventId,
  });
  await expect(repo.finalize(actorId, missing.id)).rejects.toMatchObject({
    reason: 'missing_reference',
  });
});

test('a free-form place feeds {{location}}, clears honestly and never rewrites final documents', async () => {
  const run = dependencies(),
    png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('synthetic place logo'),
    ]),
    repo = documentRepository(pool, tenantId, run.deps),
    place = (venue: string | null, venueOverride: boolean) =>
      pool.query(
        'UPDATE events SET venue=$1, venue_override=$2 WHERE tenant_id=$3 AND id=$4',
        [venue, venueOverride, tenantId, eventId],
      );
  await documentLayoutRepository(pool, tenantId, run.deps.store).saveLogo(
    actorId,
    png,
    'image/png',
  );
  await place('Fictional <b>Garden</b>\nZweiter Eingang', true);
  const draft = await repo.createDraft(actorId, {
      templateId,
      eventId,
      contactId,
    }),
    finalized = await repo.finalize(actorId, draft.id),
    html = run.rendered[0]!;
  expect(html).toContain(
    'Fictional &lt;b&gt;Garden&lt;/b&gt;<br>Zweiter Eingang',
  );
  expect(html).not.toContain('Fictional Hall');
  expect(html).not.toContain('<b>Garden</b>');
  const frozen = (await repo.get(finalized.id))!;
  expect(frozen.snapshotHash).toBe(finalized.snapshotHash);
  const pdfBefore = await readDocumentPdf(run.deps.store, finalized.pdfHash!);
  await place('Fictional Later Hall', true);
  const after = (await repo.get(finalized.id))!;
  expect(after.snapshotHash).toBe(finalized.snapshotHash);
  expect(after.pdfHash).toBe(finalized.pdfHash);
  expect(await readDocumentPdf(run.deps.store, after.pdfHash!)).toEqual(
    pdfBefore,
  );
  await place('', true);
  const cleared = await repo.createDraft(actorId, {
    templateId,
    eventId,
    contactId,
  });
  await expect(repo.finalize(actorId, cleared.id)).rejects.toMatchObject({
    reason: 'invalid_content',
  });
  await place(null, false);
});

// H035: the Dateien overview is the same document list with optional, additive
// filters. These tests pin the old contract first and the new parameters second.
// Synthetic rows are inserted directly: only issuedAt and the eligibility
// columns matter for the list contract, and no PDF must be rendered.
async function listRows(
  connection: Pool,
  scope: string,
  rows: {
    id: string;
    issuedAt: string;
    kind?: string;
    state?: string;
    number?: string | null;
    pdfHash?: string | null;
    finalized?: boolean;
    grossMinor?: number;
    eventId?: string | null;
    templateId: string;
  }[],
) {
  for (const row of rows)
    await connection.query(
      `INSERT INTO documents (tenant_id,id,kind,template_id,event_id,contact_id,number,state,
        issued_at,finalized_at,snapshot_hash,pdf_hash,net_minor,tax_minor,gross_minor,version)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,0,$12,1)`,
      [
        scope,
        row.id,
        row.kind ?? 'offer',
        row.templateId,
        row.eventId ?? null,
        row.number ?? null,
        row.state ?? 'draft',
        new Date(row.issuedAt),
        row.finalized ? new Date(row.issuedAt) : null,
        row.finalized ? 'b'.repeat(64) : null,
        // Without an explicit artefact a final row is only a skeleton; the test
        // that needs exactly that state drops the hash afterwards.
        row.pdfHash ?? (row.finalized ? 'c'.repeat(64) : null),
        row.grossMinor ?? 0,
      ],
    );
}

// The tenant must be able to issue documents for this test: a template with a
// position plus a number range and a layout, all synthetic.
async function seedIssuingContext(scope: string) {
  // The bootstrap account is unclaimed until its own first session binds it.
  const grant = (await accessRepository(pool, scope).list())[0]!;
  if (!grant.userId)
    await accessRepository(pool, scope).issueSession(
      { subject: 'seed-' + scope, email: grant.email },
      'seed-hash-' + scope,
    );
  const actor = (await accessRepository(pool, scope).list())[0]!.userId!;
  const saved = await documentTemplateRepository(pool, scope).save(actor, {
    kind: 'offer',
    name: 'Fictional files offer',
    subject: 'Angebot',
    introText: '',
    outroText: '',
    validityDays: 14,
    state: 'active',
    positions: [
      {
        productId: null,
        description: 'Fictional box',
        quantity: 1,
        unit: 'Stück',
        unitPriceMinor: 19900,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ],
  });
  const sequences = await documentNumberRepository(pool, scope).list();
  if (!sequences.some((row) => row.kind === 'offer'))
    await documentNumberRepository(pool, scope).save(actor, 'offer', {
      pattern: 'AN-{YYYY}-{SEQ}',
      minLength: 4,
      nextValue: 1,
    });
  const store = memoryStore().store;
  if (!(await documentLayoutRepository(pool, scope, store).get()))
    await documentLayoutRepository(pool, scope, store).save(actor, {
      senderName: 'Fictional Studio',
      senderStreet: 'Example Street 1',
      senderPostalCode: '12345',
      senderCity: 'Fictional Town',
      primaryColor: '#2f6f4f',
      textColor: '#1b1b1b',
      fontFamily: 'sans',
      showPageNumbers: true,
      showPositionNumbers: true,
    });
  return { actor, templateId: saved.id as string, store };
}

const oldListKeys = [
  'contactId',
  'eventId',
  'finalizedAt',
  'grossMinor',
  'id',
  'issuedAt',
  'kind',
  'netMinor',
  'number',
  'state',
  'taxMinor',
  'templateId',
  'version',
].sort();

test('the omitted-pagination list keeps every row, the exact old shape and its order', async () => {
  const scope = randomUUID(),
    ids: string[] = [],
    base = Date.parse('2031-03-01T09:00:00Z');
  await bootstrapAccess(
    pool,
    scope,
    'files-old@example.invalid',
    'Synthetic files old',
    'Europe/Berlin',
  );
  const template = (await seedIssuingContext(scope)).templateId;
  for (let index = 0; index < 61; index++) {
    const id = randomUUID();
    ids.push(id);
    await listRows(pool, scope, [
      {
        id,
        templateId: template,
        issuedAt: new Date(base + index * 60_000).toISOString(),
      },
    ]);
  }
  const listed = await documentRepository(
    pool,
    scope,
    dependencies().deps,
  ).list();
  expect(listed).toHaveLength(61);
  // Newest first, exactly as before: no silent default page size.
  expect(listed[0]!.id).toBe(ids[60]);
  expect(listed[60]!.id).toBe(ids[0]);
  expect(Object.keys(listed[0]!).sort()).toEqual(oldListKeys);
});

test('explicit limit and offset page the whole result without a plus one', async () => {
  const scope = randomUUID(),
    ids: string[] = [],
    base = Date.parse('2031-04-01T09:00:00Z');
  await bootstrapAccess(
    pool,
    scope,
    'files-page@example.invalid',
    'Synthetic files page',
    'Europe/Berlin',
  );
  const template = (await seedIssuingContext(scope)).templateId;
  for (let index = 0; index < 7; index++) {
    const id = randomUUID();
    ids.push(id);
    await listRows(pool, scope, [
      {
        id,
        templateId: template,
        issuedAt: new Date(base + index * 60_000).toISOString(),
      },
    ]);
  }
  const repo = documentRepository(pool, scope, dependencies().deps),
    first = await repo.list({ limit: 3 }),
    second = await repo.list({ limit: 3, offset: 3 }),
    last = await repo.list({ limit: 3, offset: 6 }),
    beyond = await repo.list({ limit: 3, offset: 9 });
  // The limit is a maximum: at most exactly what was asked for.
  expect(first.map((row) => row.id)).toEqual([ids[6], ids[5], ids[4]]);
  expect(second.map((row) => row.id)).toEqual([ids[3], ids[2], ids[1]]);
  expect(last.map((row) => row.id)).toEqual([ids[0]]);
  expect(beyond).toEqual([]);
  expect((await repo.list({ limit: 100 })).length).toBe(7);
});

test('the metadata projection adds event name, local date and PDF eligibility only when asked', async () => {
  const scope = randomUUID(),
    ownEvent = randomUUID(),
    foreignEvent = randomUUID(),
    draft = randomUUID(),
    finalWithPdf = randomUUID(),
    withdrawn = randomUUID(),
    orphan = randomUUID();
  await bootstrapAccess(
    pool,
    scope,
    'files-meta@example.invalid',
    'Synthetic files meta',
    'Europe/Berlin',
  );
  const template = (await seedIssuingContext(scope)).templateId;
  await bootstrapAccess(
    pool,
    otherTenantId,
    'files-meta-other@example.invalid',
    'Synthetic files meta other',
    'Europe/Berlin',
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Files Wedding','option',NULL,NULL,NULL,'synthetic','2031-05-02',
      NULL,NULL,'Europe/Berlin','','',1)`,
    [scope, ownEvent],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Foreign private event','option',NULL,NULL,NULL,'synthetic','2031-05-02',
      NULL,NULL,'Europe/Berlin','','',1)`,
    [otherTenantId, foreignEvent],
  );
  // 23:30 UTC on 1 May is already 2 May in Berlin.
  const seed = await seedIssuingContext(scope),
    repo = documentRepository(pool, scope, {
      ...dependencies().deps,
      store: seed.store,
    });
  await listRows(pool, scope, [
    {
      id: draft,
      templateId: template,
      kind: 'offer',
      state: 'draft',
      issuedAt: '2031-05-01T23:30:00Z',
      eventId: ownEvent,
      grossMinor: 0,
    },
    {
      id: finalWithPdf,
      templateId: template,
      kind: 'invoice',
      state: 'final',
      number: 'RE-2031-0001',
      pdfHash: 'a'.repeat(64),
      finalized: true,
      issuedAt: '2031-05-02T10:00:00Z',
      eventId: ownEvent,
      grossMinor: 123456,
    },
    {
      id: withdrawn,
      templateId: template,
      kind: 'correction',
      state: 'withdrawn',
      issuedAt: '2031-05-04T10:00:00Z',
    },
    {
      id: orphan,
      templateId: template,
      kind: 'offer',
      state: 'draft',
      issuedAt: '2031-05-05T10:00:00Z',
      eventId: null,
    },
  ]);
  // A real final document whose artefact metadata was lost afterwards: the PDF
  // route answers 404 for it, so the list must not advertise a download either.
  const filesContact = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Files Customer','Robin Example','Example Street 2',
      '12345','Fictional Town','DE','files@example.invalid','','','','','active',1)`,
    [scope, filesContact],
  );
  const seeded = await repo.createDraft(seed.actor, {
      templateId: seed.templateId,
      eventId: ownEvent,
      contactId: filesContact,
    }),
    legacySeed = (await repo.finalize(seed.actor, seeded.id)).id;
  // The schema forbids a final row without number, snapshot and pdf hash, so
  // that state cannot exist; the flag still derives eligibility, as this
  // constraint check documents.
  expect(
    await pool
      .query(
        `UPDATE documents SET pdf_hash=NULL WHERE tenant_id=$1 AND id=$2`,
        [scope, legacySeed],
      )
      .then(() => 'accepted')
      .catch((error: { code?: string }) => error.code ?? 'rejected'),
  ).toBe('23514');
  expect(
    (await repo.list({ include: 'metadata' })).find(
      (row) => row.id === legacySeed,
    ),
  ).toMatchObject({ pdfAvailable: true });
  const plain = await repo.list(),
    meta = await repo.list({ include: 'metadata' }),
    byId = (rows: { id: string }[], id: string) =>
      rows.find((row) => row.id === id)!;
  // Without include the shape is byte-identical to the old contract.
  expect(Object.keys(byId(plain, draft)!).sort()).toEqual(oldListKeys);
  expect(Object.keys(byId(meta, draft)!).sort()).toEqual(
    [...oldListKeys, 'eventName', 'issuedDate', 'pdfAvailable'].sort(),
  );
  expect(byId(meta, draft)).toMatchObject({
    eventName: 'Fictional Files Wedding',
    issuedDate: '2031-05-02',
    pdfAvailable: false,
    grossMinor: 0,
  });
  expect(byId(meta, finalWithPdf)).toMatchObject({
    issuedDate: '2031-05-02',
    pdfAvailable: true,
  });
  // A final row without artefact metadata must not advertise a download.

  expect(byId(meta, withdrawn)).toMatchObject({
    eventName: null,
    pdfAvailable: false,
  });
  // A foreign event is never named, even though the row already carries no
  // readable foreign data; the join stays tenant-scoped.
  expect(byId(meta, orphan)).toMatchObject({ eventName: null });
  const serialised = JSON.stringify(meta);
  expect(serialised).not.toContain('a'.repeat(64));
  expect(serialised).not.toContain('snapshot');
  expect(serialised).not.toContain('pdfHash');
});

test('date filters use inclusive tenant-local issued dates around DST changes', async () => {
  const scope = randomUUID(),
    beforeDst = randomUUID(),
    dstDay = randomUUID(),
    afterDst = randomUUID();
  await bootstrapAccess(
    pool,
    scope,
    'files-dates@example.invalid',
    'Synthetic files dates',
    'Europe/Berlin',
  );
  const template = (await seedIssuingContext(scope)).templateId;
  // 2029-03-25 is the spring DST day in Europe/Berlin (23-hour day).
  await listRows(pool, scope, [
    {
      id: beforeDst,
      templateId: template,
      issuedAt: '2029-03-24T22:59:59Z', // 23:59:59 local on 24 March
    },
    {
      id: dstDay,
      templateId: template,
      issuedAt: '2029-03-25T21:59:59Z', // 23:59:59 local on 25 March
    },
    {
      id: afterDst,
      templateId: template,
      issuedAt: '2029-03-25T22:00:00Z', // 00:00 local on 26 March
    },
  ]);
  const repo = documentRepository(pool, scope, dependencies().deps),
    oneDay = await repo.list({ from: '2029-03-25', to: '2029-03-25' }),
    fromSecond = await repo.list({ from: '2029-03-26' }),
    untilFirst = await repo.list({ to: '2029-03-24' });
  expect(oneDay.map((row) => row.id)).toEqual([dstDay]);
  expect(fromSecond.map((row) => row.id)).toEqual([afterDst]);
  expect(untilFirst.map((row) => row.id)).toEqual([beforeDst]);
});

test('the list API validates every new filter and keeps auth, tenant and PDF routes intact', async () => {
  const scope = randomUUID(),
    own = randomUUID();
  await bootstrapAccess(
    pool,
    scope,
    'files-api@example.invalid',
    'Synthetic files api',
    'Europe/Berlin',
  );
  // seedIssuingContext binds the bootstrap account; its session then works.
  const template = (await seedIssuingContext(scope)).templateId;
  await accessRepository(pool, scope).issueSession(
    {
      subject: 'seed-' + scope,
      email: (await accessRepository(pool, scope).list())[0]!.email,
    },
    digest('synthetic-files-api'),
  );
  await listRows(pool, scope, [
    {
      id: own,
      templateId: template,
      issuedAt: '2031-06-10T10:00:00Z',
      grossMinor: 0,
    },
  ]);
  const config = {
      origin: site,
      tenantId: scope,
      clientId: 'synthetic',
      clientSecret: 'synthetic',
    },
    app = createHealthServer(
      loadRuntimeConfig(
        {
          AK_DB_HOST: 'synthetic',
          AK_DB_NAME: 'synthetic',
          AK_DB_USER: 'synthetic',
          AK_DB_PASSWORD_FILE: 'synthetic',
          AK_LOG_LEVEL: 'silent',
        },
        () => 'synthetic-long-secret',
      ),
      { database: async () => true, worker: async () => true },
    );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerDocumentRoutes(app, pool, scope, dependencies().deps);
  const cookies = { '__Host-ak-session': 'synthetic-files-api' };
  try {
    expect((await app.inject('/api/v1/documents')).statusCode).toBe(401);
    const plain = await app.inject({ url: '/api/v1/documents', cookies });
    expect(plain.statusCode).toBe(200);
    expect(Array.isArray(plain.json())).toBe(true);
    expect(Object.keys(plain.json()[0]).sort()).toEqual(oldListKeys);
    const meta = await app.inject({
      url: '/api/v1/documents?include=metadata&limit=1&offset=0',
      cookies,
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()[0]).toMatchObject({
      id: own,
      issuedDate: '2031-06-10',
      pdfAvailable: false,
      eventName: null,
    });
    for (const query of [
      'include=everything',
      'from=2031-02-30',
      'to=not-a-date',
      'from=2031-06-11&to=2031-06-10',
      'limit=0',
      'limit=101',
      'limit=2.5',
      'limit=abc',
      'offset=-1',
      'offset=1.5',
      'offset=abc',
      'kind=unknown',
      'state=sent',
      'eventId=not-a-uuid',
    ]) {
      const rejected = await app.inject({
        url: '/api/v1/documents?' + query,
        cookies,
      });
      expect(rejected.statusCode, query).toBe(400);
    }
    const accepted = await app.inject({
      url: '/api/v1/documents?from=2031-06-10&to=2031-06-10&limit=100&offset=0&kind=offer&state=draft',
      cookies,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().map((row: { id: string }) => row.id)).toEqual([own]);
    // A foreign PDF id stays a 404 for this tenant, unchanged by the new list.
    expect(
      (
        await app.inject({
          url: '/api/v1/documents/' + randomUUID() + '/pdf',
          cookies,
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test('date filters pin the inclusive millisecond edges on both DST change days', async () => {
  const scope = randomUUID(),
    beforeSpring = randomUUID(),
    springEdge = randomUUID(),
    beforeAutumn = randomUUID(),
    autumnEdge = randomUUID();
  await bootstrapAccess(
    pool,
    scope,
    'files-edges@example.invalid',
    'Synthetic files edges',
    'Europe/Berlin',
  );
  const template = (await seedIssuingContext(scope)).templateId;
  await listRows(pool, scope, [
    // 2029-03-24 23:59:59.999 local is still the day before the switch.
    {
      id: beforeSpring,
      templateId: template,
      issuedAt: '2029-03-24T22:59:59.999Z',
    },
    // 2029-03-25 00:00:00.000 local starts the 23-hour day.
    {
      id: springEdge,
      templateId: template,
      issuedAt: '2029-03-24T23:00:00.000Z',
    },
    // 2029-10-27 23:59:59.999 local ends the day before the 25-hour day.
    {
      id: beforeAutumn,
      templateId: template,
      issuedAt: '2029-10-27T21:59:59.999Z',
    },
    // 2029-10-28 00:00:00.000 local starts the 25-hour day.
    {
      id: autumnEdge,
      templateId: template,
      issuedAt: '2029-10-27T22:00:00.000Z',
    },
  ]);
  const repo = documentRepository(pool, scope, dependencies().deps),
    spring = await repo.list({ from: '2029-03-25', to: '2029-03-25' }),
    autumn = await repo.list({ from: '2029-10-28', to: '2029-10-28' }),
    untilSpringPrior = await repo.list({ to: '2029-03-24' });
  expect(spring.map((row) => row.id)).toEqual([springEdge]);
  expect(autumn.map((row) => row.id)).toEqual([autumnEdge]);
  expect(untilSpringPrior.map((row) => row.id)).toEqual([beforeSpring]);
  // Everything before the 25-hour day, including the March rows.
  const beforeAutumnDay = (await repo.list({ to: '2029-10-27' })).map(
    (row) => row.id,
  );
  expect(beforeAutumnDay).toContain(beforeAutumn);
  expect(beforeAutumnDay).not.toContain(autumnEdge);
});

test('the HTTP list keeps the legacy volume and shape and pages exactly as asked', async () => {
  const scope = randomUUID(),
    ids: string[] = [],
    base = Date.parse('2031-07-01T09:00:00Z');
  await bootstrapAccess(
    pool,
    scope,
    'files-http@example.invalid',
    'Synthetic files http',
    'Europe/Berlin',
  );
  const seed = await seedIssuingContext(scope);
  for (let index = 0; index < 61; index++) {
    const id = randomUUID();
    ids.push(id);
    await listRows(pool, scope, [
      {
        id,
        templateId: seed.templateId,
        issuedAt: new Date(base + index * 60_000).toISOString(),
        grossMinor: index,
        kind: index % 2 ? 'invoice' : 'offer',
        state: 'draft',
      },
    ]);
  }
  await accessRepository(pool, scope).issueSession(
    {
      subject: 'seed-' + scope,
      email: (await accessRepository(pool, scope).list())[0]!.email,
    },
    digest('synthetic-files-http'),
  );
  const config = {
      origin: site,
      tenantId: scope,
      clientId: 'synthetic',
      clientSecret: 'synthetic',
    },
    app = createHealthServer(
      loadRuntimeConfig(
        {
          AK_DB_HOST: 'synthetic',
          AK_DB_NAME: 'synthetic',
          AK_DB_USER: 'synthetic',
          AK_DB_PASSWORD_FILE: 'synthetic',
          AK_LOG_LEVEL: 'silent',
        },
        () => 'synthetic-long-secret',
      ),
      { database: async () => true, worker: async () => true },
    );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerDocumentRoutes(app, pool, scope, dependencies().deps);
  const cookies = { '__Host-ak-session': 'synthetic-files-http' };
  try {
    // 61 rows over the wire: no hidden default page size, old fields only.
    const legacy = await app.inject({ url: '/api/v1/documents', cookies });
    expect(legacy.statusCode).toBe(200);
    const legacyRows = legacy.json() as { id: string }[];
    expect(legacyRows).toHaveLength(61);
    expect(legacyRows[0]!.id).toBe(ids[60]);
    expect(Object.keys(legacyRows[0]!).sort()).toEqual(oldListKeys);
    // Explicit paging is a maximum of exactly what was asked for.
    const page = await app.inject({
      url: '/api/v1/documents?limit=10&offset=55',
      cookies,
    });
    expect(page.json().map((row: { id: string }) => row.id)).toEqual(
      ids.slice(0, 6).reverse(),
    );
    const beyond = await app.inject({
      url: '/api/v1/documents?limit=10&offset=61',
      cookies,
    });
    expect(beyond.json()).toEqual([]);
    const atCap = await app.inject({
      url: '/api/v1/documents?offset=1000000',
      cookies,
    });
    expect(atCap.statusCode).toBe(200);
    expect(atCap.json()).toEqual([]);
    expect(
      (await app.inject({ url: '/api/v1/documents?offset=1000001', cookies }))
        .statusCode,
    ).toBe(400);
    // Metadata projection over HTTP: extra fields, no private hashes.
    const meta = await app.inject({
      url: '/api/v1/documents?include=metadata&limit=2',
      cookies,
    });
    expect(meta.statusCode).toBe(200);
    const first = meta.json()[0] as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(
      [...oldListKeys, 'eventName', 'issuedDate', 'pdfAvailable'].sort(),
    );
    expect(meta.body).not.toContain('pdfHash');
    expect(meta.body).not.toContain('snapshotHash');
    // Combined filters together with the local-day window.
    const localDay = '2031-07-01';
    const combined = await app.inject({
      url:
        '/api/v1/documents?kind=invoice&state=draft&from=' +
        localDay +
        '&to=' +
        localDay +
        '&limit=100',
      cookies,
    });
    expect(combined.statusCode).toBe(200);
    expect(
      combined
        .json()
        .every(
          (row: { kind: string; state: string; issuedAt: string }) =>
            row.kind === 'invoice' &&
            row.state === 'draft' &&
            new Date(row.issuedAt).toISOString().slice(0, 10) === localDay,
        ),
    ).toBe(true);
    // The old single filters keep working unchanged.
    for (const url of [
      '/api/v1/documents?kind=offer',
      '/api/v1/documents?state=draft',
      '/api/v1/documents?eventId=' + randomUUID(),
    ])
      expect((await app.inject({ url, cookies })).statusCode).toBe(200);
    // Another tenant's session sees nothing of these rows.
    const foreign = await app.inject({
      url: '/api/v1/documents',
      cookies: { '__Host-ak-session': 'synthetic-other-documents' },
    });
    expect(foreign.statusCode).toBe(401);
  } finally {
    await app.close();
  }
});
