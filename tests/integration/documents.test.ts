import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
  type DocumentOfferRow,
} from '../../packages/core/src/documents.js';
import { documentPaymentRepository } from '../../packages/core/src/document-payments.js';
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
  const logo = await layoutRepo.saveLogo(actorId, png, 'image/png');
  const repo = documentRepository(pool, tenantId, run.deps),
    draft = await repo.createDraft(actorId, { templateId, contactId, eventId }),
    finalized = await repo.finalize(actorId, draft.id);
  expect(finalized.state).toBe('final');
  expect(run.rendered[0]).toContain(
    'data:image/png;base64,' + png.toString('base64'),
  );
  await run.deps.store.remove(logo.logoKey!);
  const missing = await repo.createDraft(actorId, {
    templateId,
    contactId,
    eventId,
  });
  await expect(repo.finalize(actorId, missing.id)).rejects.toMatchObject({
    reason: 'missing_reference',
  });
});

test('replacing the layout logo leaves finalized PDFs unchanged and updates draft previews', async () => {
  const run = dependencies(),
    firstLogo = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('synthetic original logo'),
    ]),
    nextLogo = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('synthetic replacement logo'),
    ]),
    layoutRepo = documentLayoutRepository(pool, tenantId, run.deps.store),
    repo = documentRepository(pool, tenantId, run.deps);
  await layoutRepo.saveLogo(actorId, firstLogo, 'image/png');
  const draft = await repo.createDraft(actorId, {
      templateId,
      contactId,
      eventId,
    }),
    finalized = await repo.finalize(actorId, draft.id),
    originalPdf = await readDocumentPdf(run.deps.store, finalized.pdfHash!);
  expect(run.rendered[0]).toContain(
    'data:image/png;base64,' + firstLogo.toString('base64'),
  );

  await layoutRepo.saveLogo(actorId, nextLogo, 'image/png');
  const unchanged = await repo.get(finalized.id);
  expect(unchanged).toMatchObject({
    state: 'final',
    snapshotHash: finalized.snapshotHash,
    pdfHash: finalized.pdfHash,
  });
  expect(await readDocumentPdf(run.deps.store, unchanged!.pdfHash!)).toEqual(
    originalPdf,
  );

  const previewDraft = await repo.createDraft(actorId, {
    templateId,
    contactId,
    eventId,
  });
  await repo.preview(previewDraft.id);
  expect(run.rendered[1]).toContain(
    'data:image/png;base64,' + nextLogo.toString('base64'),
  );
  expect(run.rendered[1]).not.toContain(
    'data:image/png;base64,' + firstLogo.toString('base64'),
  );
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
    // BKP019.c2: a correction row is only legal with a source and a direction.
    sourceId?: string;
    direction?: 'credit' | 'debit';
  }[],
) {
  for (const row of rows)
    await connection.query(
      `INSERT INTO documents (tenant_id,id,kind,template_id,event_id,contact_id,number,state,
        issued_at,finalized_at,snapshot_hash,pdf_hash,net_minor,tax_minor,gross_minor,version,
        source_document_id,correction_direction)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,0,$12,1,$13,$14)`,
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
        row.sourceId ?? null,
        row.direction ?? null,
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
// BKP019.a: how an offer was accepted travels with the offer projection.
const acceptanceKeys = [
  'acceptedAt',
  'acceptanceChannel',
  'acceptanceNote',
  'acceptanceFileId',
  'acceptanceFileName',
  'acceptanceFileState',
];
// BKP019.b: a confirmation names the offer it was copied from. The two keys
// belong to the projection only; the unpaged list keeps its old shape.
const confirmationKeys = ['sourceDocumentId', 'sourceNumber'];
// BKP019.c2: the correction axis. `correctionDirection` is this row's own
// direction, `correctionState` and `remainingCredit` are derived for a finalized
// source document and NULL for every other row. Three keys, deliberately pinned
// here: the projection grows only where a correction needs it.
const correctionKeys = [
  'correctionDirection',
  'correctionState',
  'remainingCredit',
];
// BKP019.d: the payment axis of the same projection. `paymentState` and
// `openMinor` are derived for a finalized invoice and NULL for every other row -
// three keys were not enough for the payment slice, two more are all it needs.
const paymentKeys = ['paymentState', 'openMinor'];

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
      // BKP019.c2: a correction is only legal with a source and a direction.
      sourceId: finalWithPdf,
      direction: 'credit',
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

// BKP019.0: the second axis. Every case below starts from a really finalized
// offer, because a business status without frozen content is not a reachable
// state - and because the printed deadline must be the frozen one.
async function seedFinalOffer(scope: string, at: Date) {
  await bootstrapAccess(
    pool,
    scope,
    'offer-status-' + scope + '@example.invalid',
    'Synthetic offer status',
    'Europe/Berlin',
  );
  const seed = await seedIssuingContext(scope),
    contact = randomUUID(),
    run = dependencies({ now: () => at }),
    repo = documentRepository(pool, scope, run.deps);
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Offer Customer','Robin Example','Example Street 2','12345',
      'Fictional Town','DE','offer-status@example.invalid','','','','','active',1)`,
    [scope, contact],
  );
  const draft = await repo.createDraft(seed.actor, {
      templateId: seed.templateId,
      contactId: contact,
    }),
    finalized = await repo.finalize(seed.actor, draft.id);
  return {
    actor: seed.actor,
    repo,
    run,
    id: finalized.id,
    version: finalized.version,
    number: finalized.number!,
  };
}

async function offerState(scope: string, id: string) {
  const { rows } = await pool.query<{
    valid_until: string | null;
    offer_status: string | null;
    status_changed_at: Date | null;
    state: string;
    number: string | null;
    snapshot_hash: string | null;
    pdf_hash: string | null;
    gross_minor: string;
    version: number;
  }>(
    `SELECT to_char(valid_until,'YYYY-MM-DD') AS valid_until, offer_status,
            status_changed_at, state, number, snapshot_hash, pdf_hash,
            gross_minor, version
       FROM documents WHERE tenant_id=$1 AND id=$2`,
    [scope, id],
  );
  return rows[0]!;
}

async function offerAudit(scope: string, id: string) {
  const { rows } = await pool.query<{ action: string }>(
    `SELECT action FROM audit_events
      WHERE tenant_id=$1 AND record_id=$2 AND action LIKE 'document.%'
      ORDER BY action`,
    [scope, id],
  );
  return rows.map((row) => row.action);
}

// The projected list at one injected instant, so expiry is reproducible.
async function listedOffer(scope: string, now: string, id: string) {
  const rows = (await documentRepository(
    pool,
    scope,
    dependencies({ now: () => new Date(now) }).deps,
  ).list({ include: 'offer' })) as DocumentOfferRow[];
  return rows.find((row) => row.id === id)!;
}

test('finalizing an offer freezes exactly the deadline the PDF prints', async () => {
  const scope = randomUUID(),
    // 26 October 2030, 12:00 local in Europe/Berlin (still summer time).
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    frozen = await offerState(scope, offer.id);
  // 26.10.2030 + 14 tenant-local calendar days.
  expect(frozen.valid_until).toBe('2030-11-09');
  // A finalized offer that was never sent carries no claim and no instant.
  expect(frozen.offer_status).toBeNull();
  expect(frozen.status_changed_at).toBeNull();
  // The stored day is the day the bytes show; one computation, two outputs.
  expect(offer.run.rendered.at(-1)).toContain('Gültig bis');
  expect(offer.run.rendered.at(-1)).toContain('09.11.2030');

  const listAt = async (now: string) => listedOffer(scope, now, offer.id);
  // 9 November 23:59:59 local is the last minute that is still valid.
  expect(await listAt('2030-11-09T22:59:59Z')).toMatchObject({
    validUntil: '2030-11-09',
    offerStatus: null,
    offerExpired: false,
  });
  // One second later the tenant day has moved on; the deadline did not move.
  expect(await listAt('2030-11-09T23:00:00Z')).toMatchObject({
    validUntil: '2030-11-09',
    offerExpired: true,
  });
  expect(await offerState(scope, offer.id)).toEqual(frozen);
});

test('the derived expiry follows the tenant calendar day across a DST change', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2029-03-10T10:00:00Z'));
  // 25 March 2029 is the 23-hour spring day in Europe/Berlin.
  await pool.query(
    "UPDATE documents SET valid_until = DATE '2029-03-25' WHERE tenant_id=$1 AND id=$2",
    [scope, offer.id],
  );
  const listAt = async (now: string) => listedOffer(scope, now, offer.id);
  // 23:59:59 local (CEST, +02:00) on the deadline day is still valid.
  expect((await listAt('2029-03-25T21:59:59Z')).offerExpired).toBe(false);
  // The next local midnight starts the day after the deadline.
  expect((await listAt('2029-03-25T22:00:00Z')).offerExpired).toBe(true);
  // Deriving writes nothing: status, instant and version stay untouched.
  const stored = await offerState(scope, offer.id);
  expect(stored.offer_status).toBeNull();
  expect(stored.status_changed_at).toBeNull();
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.created',
    'document.finalized',
  ]);
});

test('every allowed offer transition moves the axis, the version and the audit', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    before = await offerState(scope, offer.id),
    sent = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'sent',
      version: offer.version,
    });
  expect(sent).toMatchObject({
    state: 'final',
    offerStatus: 'sent',
    validUntil: '2030-11-09',
    offerExpired: false,
    version: offer.version + 1,
  });
  const accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'accepted',
    version: offer.version + 1,
    channel: 'email',
  });
  expect(accepted).toMatchObject({
    offerStatus: 'accepted',
    version: offer.version + 2,
  });
  // An accepted offer is never "expired", even long after the deadline.
  expect(accepted.offerExpired).toBe(false);
  const withdrawn = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'withdrawn',
    version: offer.version + 2,
  });
  expect(withdrawn).toMatchObject({
    offerStatus: 'withdrawn',
    version: offer.version + 3,
  });
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.accepted',
    'document.created',
    'document.finalized',
    'document.sent',
    'document.withdrawn',
  ]);
  const after = await offerState(scope, offer.id);
  // `state` stays the content axis and the final content is untouched.
  expect(after.state).toBe('final');
  expect(after.number).toBe(before.number);
  expect(after.snapshot_hash).toBe(before.snapshot_hash);
  expect(after.pdf_hash).toBe(before.pdf_hash);
  expect(after.gross_minor).toBe(before.gross_minor);
  expect(after.status_changed_at).toBeInstanceOf(Date);
});

test('a final offer may be sent or withdrawn directly, a sent one also withdrawn', async () => {
  const direct = await seedFinalOffer(
      randomUUID(),
      new Date('2030-10-26T10:00:00Z'),
    ),
    sentThenWithdrawn = await seedFinalOffer(
      randomUUID(),
      new Date('2030-10-26T10:00:00Z'),
    );
  expect(
    await direct.repo.changeOfferStatus(direct.actor, direct.id, {
      status: 'withdrawn',
      version: direct.version,
    }),
  ).toMatchObject({ offerStatus: 'withdrawn' });
  await sentThenWithdrawn.repo.changeOfferStatus(
    sentThenWithdrawn.actor,
    sentThenWithdrawn.id,
    { status: 'sent', version: sentThenWithdrawn.version },
  );
  expect(
    await sentThenWithdrawn.repo.changeOfferStatus(
      sentThenWithdrawn.actor,
      sentThenWithdrawn.id,
      { status: 'withdrawn', version: sentThenWithdrawn.version + 1 },
    ),
  ).toMatchObject({ offerStatus: 'withdrawn' });
});

test('an illegal offer transition is refused without changing anything', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    before = await offerState(scope, offer.id);
  // No silent jump: a final offer cannot be accepted before it was sent.
  await expect(
    offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_transition' });
  await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'withdrawn',
    version: offer.version,
  });
  // `withdrawn` is terminal: a correction is a new document.
  for (const status of ['sent', 'accepted'] as const)
    await expect(
      offer.repo.changeOfferStatus(offer.actor, offer.id, {
        status,
        version: offer.version + 1,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_transition' });
  expect(await offerState(scope, offer.id)).toMatchObject({
    offer_status: 'withdrawn',
    number: before.number,
    version: offer.version + 1,
  });
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.created',
    'document.finalized',
    'document.withdrawn',
  ]);
});

test('the identical status again is an idempotent no-op without a second audit', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    sent = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'sent',
      version: offer.version,
    }),
    again = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'sent',
      version: sent.version,
    });
  expect(again).toMatchObject({
    offerStatus: 'sent',
    version: sent.version,
  });
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.created',
    'document.finalized',
    'document.sent',
  ]);
});

test('a stale version is a conflict and leaves status, instant and audit alone', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    before = await offerState(scope, offer.id);
  await expect(
    offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'sent',
      version: offer.version - 1,
    }),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await offerState(scope, offer.id)).toEqual(before);
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.created',
    'document.finalized',
  ]);
  await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'sent',
    version: offer.version,
  });
  // The winning write moved the version, so the same input is now stale.
  await expect(
    offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
    }),
  ).rejects.toMatchObject({ reason: 'conflict' });
});

test('only a final offer of this tenant gets a business status', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    repo = documentRepository(pool, scope, dependencies().deps),
    // A draft offer has no claim yet; an invoice never has one.
    draft = await repo.createDraft(offer.actor, {
      templateId: (await documentTemplateRepository(pool, scope).list())[0]!.id,
      lines: [
        {
          description: 'Fictional draft line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
    invoice = randomUUID();
  await pool.query(
    `INSERT INTO documents (tenant_id,id,kind,template_id,event_id,contact_id,number,state,
      issued_at,finalized_at,snapshot_hash,pdf_hash,net_minor,tax_minor,gross_minor,version)
     VALUES ($1,$2,'invoice',$3,NULL,NULL,'RE-2030-0001','final',$4,$4,$5,$5,1000,0,1000,1)`,
    [
      scope,
      invoice,
      draft.templateId,
      new Date('2030-10-26T10:00:00Z'),
      'b'.repeat(64),
    ],
  );
  for (const [id, version] of [
    [draft.id, draft.version],
    [invoice, 1],
  ] as const)
    await expect(
      repo.changeOfferStatus(offer.actor, id, { status: 'sent', version }),
    ).rejects.toMatchObject({ reason: 'invalid_kind' });
  // A foreign tenant and an unknown actor see nothing and may do nothing.
  await expect(
    documentRepository(
      pool,
      otherTenantId,
      dependencies().deps,
    ).changeOfferStatus(otherActorId, offer.id, {
      status: 'sent',
      version: offer.version,
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    repo.changeOfferStatus(randomUUID(), offer.id, {
      status: 'sent',
      version: offer.version,
    }),
  ).rejects.toThrow('forbidden');
});

test('the database itself refuses a status outside a final offer', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    repo = documentRepository(pool, scope, dependencies().deps),
    draft = await repo.createDraft(offer.actor, {
      templateId: (await documentTemplateRepository(pool, scope).list())[0]!.id,
      lines: [
        {
          description: 'Fictional draft line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
    code = (query: Promise<unknown>) =>
      query
        .then(() => 'accepted')
        .catch((error: { code?: string }) => error.code);
  // A draft offer has no business status.
  expect(
    await code(
      pool.query(
        "UPDATE documents SET offer_status='accepted', status_changed_at=now() WHERE tenant_id=$1 AND id=$2",
        [scope, draft.id],
      ),
    ),
  ).toBe('23514');
  // A status without its instant is not a state, it is half a state.
  expect(
    await code(
      pool.query(
        "UPDATE documents SET offer_status='sent' WHERE tenant_id=$1 AND id=$2",
        [scope, offer.id],
      ),
    ),
  ).toBe('23514');
  // A deadline exists only on a final offer.
  expect(
    await code(
      pool.query(
        "UPDATE documents SET valid_until = DATE '2031-01-01' WHERE tenant_id=$1 AND id=$2",
        [scope, draft.id],
      ),
    ),
  ).toBe('23514');
  // The honest state still works: no claim means two NULLs.
  expect((await offerState(scope, offer.id)).offer_status).toBeNull();
});

test('the PDF of a finalized offer stays byte-identical across every status', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    before = await offer.repo.pdf(offer.id),
    rendersBefore = offer.run.rendered.length,
    stored = await offerState(scope, offer.id);
  await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'sent',
    version: offer.version,
  });
  await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'accepted',
    version: offer.version + 1,
    channel: 'pdf',
  });
  await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'withdrawn',
    version: offer.version + 2,
  });
  const after = await offer.repo.pdf(offer.id);
  expect(after.bytes.equals(before.bytes)).toBe(true);
  expect(after.number).toBe(offer.number);
  // A status is data, not content: nothing was re-rendered or re-stored.
  expect(offer.run.rendered.length).toBe(rendersBefore);
  expect(await offerState(scope, offer.id)).toMatchObject({
    pdf_hash: stored.pdf_hash,
    snapshot_hash: stored.snapshot_hash,
    number: stored.number,
  });
});

test('the offer status route keeps auth, CSRF, projection and error contracts', async () => {
  const scope = randomUUID(),
    offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z'));
  await accessRepository(pool, scope).issueSession(
    {
      // seedIssuingContext already bound the grant; its subject must be reused.
      subject: 'seed-' + scope,
      email: (await accessRepository(pool, scope).list())[0]!.email,
    },
    digest('synthetic-offer-status'),
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
  registerDocumentRoutes(app, pool, scope, offer.run.deps);
  const url = '/api/v1/documents/' + offer.id + '/offer-status',
    cookies = { '__Host-ak-session': 'synthetic-offer-status' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-offer-status'),
    };
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { status: 'sent', version: offer.version },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          cookies,
          payload: { status: 'sent', version: offer.version },
        })
      ).statusCode,
    ).toBe(403);
    for (const payload of [
      { status: 'expired', version: offer.version },
      { status: 'sent' },
      { status: 'sent', version: 0 },
      { status: 'sent', version: -1 },
      {},
    ])
      expect(
        (await app.inject({ method: 'POST', url, cookies, headers, payload }))
          .statusCode,
        JSON.stringify(payload),
      ).toBe(400);
    const refused = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: { status: 'accepted', version: offer.version },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'invalid_transition' });
    // A draft has no claim yet, so the operator gets a plain 400 and a reason.
    const draftOffer = await documentRepository(
      pool,
      scope,
      dependencies().deps,
    ).createDraft(offer.actor, {
      templateId: (await documentTemplateRepository(pool, scope).list())[0]!.id,
      lines: [
        {
          description: 'Fictional draft line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    });
    const notAnOffer = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/' + draftOffer.id + '/offer-status',
      cookies,
      headers,
      payload: { status: 'sent', version: draftOffer.version },
    });
    expect(notAnOffer.statusCode).toBe(400);
    expect(notAnOffer.json()).toEqual({ error: 'invalid_kind' });
    const sent = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: { status: 'sent', version: offer.version },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({
      id: offer.id,
      state: 'final',
      number: offer.number,
      offerStatus: 'sent',
      validUntil: '2030-11-09',
      offerExpired: false,
      version: offer.version + 1,
    });
    // The single-document GET keeps its old shape; only the new route adds keys.
    const single = await app.inject({
      url: '/api/v1/documents/' + offer.id,
      cookies,
    });
    const singleKeys = Object.keys(single.json()).sort();
    expect(singleKeys).toContain('subject');
    expect(singleKeys).not.toContain('offerStatus');
    expect(Object.keys(sent.json()).sort()).toEqual(
      [
        ...singleKeys,
        'offerStatus',
        'validUntil',
        'offerExpired',
        ...acceptanceKeys,
        ...confirmationKeys,
      ].sort(),
    );
    const projected = await app.inject({
      url: '/api/v1/documents?include=offer',
      cookies,
    });
    expect(projected.statusCode).toBe(200);
    const projectedRow = projected
      .json()
      .find((row: { id: string }) => row.id === offer.id);
    expect(Object.keys(projectedRow).sort()).toEqual(
      [
        ...oldListKeys,
        'offerStatus',
        'validUntil',
        'offerExpired',
        ...acceptanceKeys,
        ...confirmationKeys,
        ...correctionKeys,
        ...paymentKeys,
      ].sort(),
    );
    expect(projectedRow).toMatchObject({
      offerStatus: 'sent',
      validUntil: '2030-11-09',
      offerExpired: false,
      // BKP019.c2: an offer is no correction source, so it answers NULL.
      correctionDirection: null,
      correctionState: null,
      remainingCredit: null,
    });
    expect(projected.body).not.toContain('pdfHash');
    expect(projected.body).not.toContain('snapshotHash');
    // The unprojected list and the metadata list keep exactly their old keys.
    const plain = await app.inject({ url: '/api/v1/documents', cookies });
    expect(Object.keys(plain.json()[0]).sort()).toEqual(oldListKeys);
    const meta = await app.inject({
      url: '/api/v1/documents?include=metadata',
      cookies,
    });
    expect(Object.keys(meta.json()[0]).sort()).toEqual(
      [...oldListKeys, 'eventName', 'issuedDate', 'pdfAvailable'].sort(),
    );
    // `state` stays the content axis: `sent` is still not a state value.
    expect(
      (await app.inject({ url: '/api/v1/documents?state=sent', cookies }))
        .statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

test('migration 0039 backfills exactly the deadline that was printed before', async () => {
  const uri = new URL(container.getConnectionUri());
  uri.pathname = '/offer_status_backfill';
  await pool.query('CREATE DATABASE offer_status_backfill');
  const backfill = new Pool({ connectionString: uri.toString() }),
    directory = new URL('../../packages/core/migrations/', import.meta.url),
    migrations = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map(async (name) => ({
          name,
          sql: await readFile(new URL(name, directory), 'utf8'),
        })),
    ),
    scope = randomUUID(),
    template = randomUUID(),
    legacyFinal = randomUUID(),
    legacyDraft = randomUUID(),
    legacyNoDays = randomUUID();
  try {
    // The state a running installation was in before this slice.
    await migrate(
      backfill,
      migrations.filter((entry) => entry.name < '0039_offer_status.sql'),
    );
    await backfill.query(
      "INSERT INTO tenants (id,name,timezone) VALUES ($1,'Synthetic backfill','Europe/Berlin')",
      [scope],
    );
    await backfill.query(
      `INSERT INTO document_templates (tenant_id,id,kind,name,subject,intro_text,outro_text,
        validity_days,state,version)
       VALUES ($1,$2,'offer','Synthetic backfill','Angebot','','',14,'active',1)`,
      [scope, template],
    );
    // 23:30 UTC on 30 March 2030 is already 31 March in Berlin (CET), so the
    // printed deadline used the tenant day, not the UTC day: 31.03 + 14 days.
    await backfill.query(
      `INSERT INTO documents (tenant_id,id,kind,template_id,state,issued_at,finalized_at,number,
        snapshot_hash,pdf_hash,validity_days,subject,intro_text,outro_text,
        net_minor,tax_minor,gross_minor,version)
       VALUES ($1,$2,'offer',$3,'final',$4,$4,'AN-2030-0001',$5,$5,14,'Angebot','','',0,0,0,2)`,
      [
        scope,
        legacyFinal,
        template,
        new Date('2030-03-30T23:30:00Z'),
        'b'.repeat(64),
      ],
    );
    await backfill.query(
      `INSERT INTO documents (tenant_id,id,kind,template_id,state,issued_at,number,validity_days,
        subject,intro_text,outro_text,net_minor,tax_minor,gross_minor,version)
       VALUES ($1,$2,'offer',$3,'draft',$4,NULL,14,'Angebot','','',0,0,0,1)`,
      [scope, legacyDraft, template, new Date('2030-03-30T23:30:00Z')],
    );
    // A final offer whose days were never recorded keeps an honest NULL.
    await backfill.query(
      `INSERT INTO documents (tenant_id,id,kind,template_id,state,issued_at,finalized_at,number,
        snapshot_hash,pdf_hash,net_minor,tax_minor,gross_minor,version)
       VALUES ($1,$2,'offer',$3,'final',$4,$4,'AN-2030-0002',$5,$5,0,0,0,2)`,
      [
        scope,
        legacyNoDays,
        template,
        new Date('2030-03-30T23:30:00Z'),
        'c'.repeat(64),
      ],
    );
    await migrate(backfill, migrations);
    const deadline = async (id: string) =>
      (
        await backfill.query<{ valid_until: string | null }>(
          "SELECT to_char(valid_until,'YYYY-MM-DD') AS valid_until FROM documents WHERE tenant_id=$1 AND id=$2",
          [scope, id],
        )
      ).rows[0]!.valid_until;
    // 31.03.2030 + 14 days, exactly the value the old rendering computed - and
    // one day later than a naive UTC calculation would have produced.
    expect(await deadline(legacyFinal)).toBe('2030-04-14');
    // Everything without a claim stays NULL instead of inventing a date.
    expect(await deadline(legacyDraft)).toBeNull();
    expect(await deadline(legacyNoDays)).toBeNull();
    const statuses = (
      await backfill.query<{
        offer_status: string | null;
        status_changed_at: Date | null;
      }>(
        'SELECT offer_status, status_changed_at FROM documents WHERE tenant_id=$1',
        [scope],
      )
    ).rows;
    expect(statuses).toEqual([
      { offer_status: null, status_changed_at: null },
      { offer_status: null, status_changed_at: null },
      { offer_status: null, status_changed_at: null },
    ]);
  } finally {
    await backfill.end();
  }
});

// BKP019.a: an acceptance is its own record - channel, own instant, optional
// note, optional own library file - and it must survive a later withdrawal,
// which overwrites `status_changed_at` but never the acceptance.
async function seedLibraryFile(
  scope: string,
  actor: string,
  options: { state?: 'available' | 'archived'; name?: string } = {},
) {
  const id = randomUUID(),
    state = options.state ?? 'available';
  await pool.query(
    `INSERT INTO library_files (tenant_id,id,display_name,media_type,size_bytes,sha256,
       storage_key,state,scan_state,uploaded_at,uploaded_by,archived_at)
     VALUES ($1,$2,$3,'application/pdf',12,$4,$5,$6,'not_scanned',$7,$8,$9)`,
    [
      scope,
      id,
      options.name ?? 'synthetic-signed-offer.pdf',
      'a'.repeat(64),
      'library-' + id + '.pdf',
      state,
      new Date('2030-10-26T09:00:00Z'),
      actor,
      state === 'archived' ? new Date('2030-10-26T09:30:00Z') : null,
    ],
  );
  return id;
}

async function sentFinalOffer(scope: string) {
  const offer = await seedFinalOffer(scope, new Date('2030-10-26T10:00:00Z')),
    sent = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'sent',
      version: offer.version,
    });
  return { ...offer, version: sent.version };
}

async function acceptanceState(scope: string, id: string) {
  const { rows } = await pool.query<{
    accepted_at: Date | null;
    acceptance_channel: string | null;
    acceptance_note: string | null;
    acceptance_file_id: string | null;
    status_changed_at: Date | null;
    offer_status: string | null;
    version: number;
  }>(
    `SELECT accepted_at, acceptance_channel, acceptance_note, acceptance_file_id,
            status_changed_at, offer_status, version
       FROM documents WHERE tenant_id=$1 AND id=$2`,
    [scope, id],
  );
  return rows[0]!;
}

test('an acceptance records its channel, its own instant, note and attachment', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    fileId = await seedLibraryFile(scope, offer.actor),
    before = await offerState(scope, offer.id),
    accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
      channel: 'phone',
      acceptedAt: '2030-10-26T08:30:00Z',
      note: '  Telefonische Zusage, unterschriebene Fassung folgt.  ',
      attachmentFileId: fileId,
    });
  expect(accepted).toMatchObject({
    offerStatus: 'accepted',
    acceptanceChannel: 'phone',
    acceptanceNote: 'Telefonische Zusage, unterschriebene Fassung folgt.',
    acceptanceFileId: fileId,
    acceptanceFileName: 'synthetic-signed-offer.pdf',
    acceptanceFileState: 'available',
    version: offer.version + 1,
  });
  expect((accepted.acceptedAt as Date).toISOString()).toBe(
    '2030-10-26T08:30:00.000Z',
  );
  const stored = await acceptanceState(scope, offer.id);
  expect(stored).toMatchObject({
    acceptance_channel: 'phone',
    acceptance_note: 'Telefonische Zusage, unterschriebene Fassung folgt.',
    acceptance_file_id: fileId,
    offer_status: 'accepted',
  });
  // The acceptance instant is not `status_changed_at`: they are two facts.
  expect(stored.accepted_at!.toISOString()).toBe('2030-10-26T08:30:00.000Z');
  expect(stored.status_changed_at!.toISOString()).toBe(
    '2030-10-26T10:00:00.000Z',
  );
  // An acceptance is data, not content: the frozen document stays untouched.
  const after = await offerState(scope, offer.id);
  expect(after).toMatchObject({
    state: before.state,
    number: before.number,
    snapshot_hash: before.snapshot_hash,
    pdf_hash: before.pdf_hash,
    gross_minor: before.gross_minor,
  });
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.accepted',
    'document.created',
    'document.finalized',
    'document.sent',
  ]);
});

test('an acceptance without note or attachment is complete and defaults to now', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
      channel: 'email',
    });
  expect(accepted).toMatchObject({
    acceptanceChannel: 'email',
    acceptanceNote: null,
    acceptanceFileId: null,
    acceptanceFileName: null,
    acceptanceFileState: null,
  });
  // Without an operator time the transaction clock is the honest value.
  expect((accepted.acceptedAt as Date).toISOString()).toBe(
    '2030-10-26T10:00:00.000Z',
  );
});

test('a channel is mandatory and only the four documented values are valid', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    before = await offerState(scope, offer.id);
  for (const payload of [
    {},
    { channel: '' },
    { channel: 'fax' },
    { channel: 'EMAIL' },
    { channel: 'pdf ' },
  ])
    await expect(
      offer.repo.changeOfferStatus(offer.actor, offer.id, {
        status: 'accepted',
        version: offer.version,
        ...payload,
      }),
      JSON.stringify(payload),
    ).rejects.toMatchObject({ reason: 'invalid_channel' });
  expect(await offerState(scope, offer.id)).toEqual(before);
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.created',
    'document.finalized',
    'document.sent',
  ]);
});

test('the acceptance instant must be a real instant and never in the future', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    before = await offerState(scope, offer.id);
  for (const acceptedAt of [
    '2030-10-27T10:00:00Z',
    '2030-10-26T10:00:01Z',
    'not-a-time',
    '2030-02-30T10:00',
    '2030-10-26',
  ])
    await expect(
      offer.repo.changeOfferStatus(offer.actor, offer.id, {
        status: 'accepted',
        version: offer.version,
        channel: 'phone',
        acceptedAt,
      }),
      acceptedAt,
    ).rejects.toMatchObject({ reason: 'invalid_time' });
  expect(await offerState(scope, offer.id)).toEqual(before);
  // Exactly now is still an acceptance; only the future is refused.
  const accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
    status: 'accepted',
    version: offer.version,
    channel: 'phone',
    acceptedAt: '2030-10-26T12:00:00+02:00',
  });
  expect((accepted.acceptedAt as Date).toISOString()).toBe(
    '2030-10-26T10:00:00.000Z',
  );
});

test('the note is trimmed, bounded and free of control characters', async () => {
  const long = 'x'.repeat(2000),
    tooLong = 'x'.repeat(2001),
    scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
      channel: 'other',
      note: long,
    });
  expect(accepted.acceptanceNote).toBe(long);

  const other = await sentFinalOffer(randomUUID());
  for (const note of [tooLong, 'Annahme\u0001mit Steuerzeichen'])
    await expect(
      other.repo.changeOfferStatus(other.actor, other.id, {
        status: 'accepted',
        version: other.version,
        channel: 'email',
        note,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_note' });

  // Whitespace only is no note, not an empty string in the record.
  const blank = await sentFinalOffer(randomUUID()),
    cleared = await blank.repo.changeOfferStatus(blank.actor, blank.id, {
      status: 'accepted',
      version: blank.version,
      channel: 'email',
      note: '   ',
    });
  expect(cleared.acceptanceNote).toBeNull();
});

// A second real tenant with one own library file: the account has to be bound
// to a user first, exactly like every other seeded actor.
async function foreignTenantFile() {
  const scope = randomUUID();
  await bootstrapAccess(
    pool,
    scope,
    'acceptance-other-' + scope + '@example.invalid',
    'Synthetic other acceptance',
    'Europe/Berlin',
  );
  const grant = (await accessRepository(pool, scope).list())[0]!;
  await accessRepository(pool, scope).issueSession(
    { subject: 'seed-' + scope, email: grant.email },
    'seed-hash-' + scope,
  );
  const actor = (await accessRepository(pool, scope).list())[0]!.userId!;
  return { scope, fileId: await seedLibraryFile(scope, actor) };
}

test('an attachment must be an own, available library file', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    // A second real tenant owns a file that must stay invisible here.
    foreign = await foreignTenantFile(),
    archived = await seedLibraryFile(scope, offer.actor, {
      state: 'archived',
      name: 'synthetic-archived-signed-offer.pdf',
    });
  for (const [attachmentFileId, reason] of [
    [foreign.fileId, 'not_found'],
    [randomUUID(), 'not_found'],
    [archived, 'invalid_attachment'],
  ] as const)
    await expect(
      offer.repo.changeOfferStatus(offer.actor, offer.id, {
        status: 'accepted',
        version: offer.version,
        channel: 'pdf',
        attachmentFileId,
      }),
      attachmentFileId,
    ).rejects.toMatchObject({ reason });
  expect((await offerState(scope, offer.id)).offer_status).toBe('sent');
});

test('acceptance details only exist together with an acceptance', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope);
  for (const status of ['sent', 'withdrawn'] as const)
    await expect(
      offer.repo.changeOfferStatus(offer.actor, offer.id, {
        status,
        version: offer.version,
        channel: 'email',
        note: 'Should not be stored',
      }),
      status,
    ).rejects.toMatchObject({ reason: 'invalid_content' });
  expect(await offerState(scope, offer.id)).toMatchObject({
    offer_status: 'sent',
    version: offer.version,
  });
  expect(await acceptanceState(scope, offer.id)).toMatchObject({
    accepted_at: null,
    acceptance_channel: null,
    acceptance_note: null,
    acceptance_file_id: null,
  });
});

test('an identical acceptance again is a no-op, a different one is a conflict', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    fileId = await seedLibraryFile(scope, offer.actor),
    details = {
      channel: 'phone',
      acceptedAt: '2030-10-26T08:30:00Z',
      note: 'Telefonische Zusage.',
      attachmentFileId: fileId,
    } as const,
    accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
      ...details,
    }),
    again = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: accepted.version,
      ...details,
    });
  expect(again).toMatchObject({
    offerStatus: 'accepted',
    acceptanceChannel: 'phone',
    version: accepted.version,
  });
  expect(await offerAudit(scope, offer.id)).toEqual([
    'document.accepted',
    'document.created',
    'document.finalized',
    'document.sent',
  ]);
  // A silently swallowed correction would be a lie: a changed detail is 409.
  for (const changed of [
    { ...details, note: 'Andere Notiz.' },
    { ...details, acceptedAt: '2030-10-26T09:00:00Z' },
    { ...details, channel: 'email' as const },
  ])
    await expect(
      offer.repo.changeOfferStatus(offer.actor, offer.id, {
        status: 'accepted',
        version: accepted.version,
        ...changed,
      }),
      JSON.stringify(changed),
    ).rejects.toMatchObject({ reason: 'acceptance_conflict' });
  expect(await acceptanceState(scope, offer.id)).toMatchObject({
    acceptance_channel: 'phone',
    acceptance_note: 'Telefonische Zusage.',
    acceptance_file_id: fileId,
    version: accepted.version,
  });
  expect(await offerAudit(scope, offer.id)).toHaveLength(4);
});

// The regression this slice exists for: withdrawing overwrites
// `status_changed_at`, so the acceptance needs its own instant to stay true.
test('a withdrawal keeps the acceptance readable', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    fileId = await seedLibraryFile(scope, offer.actor),
    accepted = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'accepted',
      version: offer.version,
      channel: 'pdf',
      acceptedAt: '2030-10-26T08:30:00Z',
      note: 'Unterschriebene Fassung liegt vor.',
      attachmentFileId: fileId,
    }),
    withdrawn = await offer.repo.changeOfferStatus(offer.actor, offer.id, {
      status: 'withdrawn',
      version: accepted.version,
    });
  expect(withdrawn).toMatchObject({
    offerStatus: 'withdrawn',
    acceptanceChannel: 'pdf',
    acceptanceNote: 'Unterschriebene Fassung liegt vor.',
    acceptanceFileId: fileId,
    acceptanceFileName: 'synthetic-signed-offer.pdf',
  });
  expect((withdrawn.acceptedAt as Date).toISOString()).toBe(
    '2030-10-26T08:30:00.000Z',
  );
  const stored = await acceptanceState(scope, offer.id);
  expect(stored).toMatchObject({
    offer_status: 'withdrawn',
    acceptance_channel: 'pdf',
    acceptance_note: 'Unterschriebene Fassung liegt vor.',
    acceptance_file_id: fileId,
  });
  expect(stored.accepted_at!.toISOString()).toBe('2030-10-26T08:30:00.000Z');
  expect(stored.status_changed_at!.getTime()).toBeGreaterThan(
    stored.accepted_at!.getTime(),
  );
  const listed = await listedOffer(scope, '2031-01-01T10:00:00Z', offer.id);
  expect(listed).toMatchObject({
    offerStatus: 'withdrawn',
    acceptanceChannel: 'pdf',
    acceptanceNote: 'Unterschriebene Fassung liegt vor.',
    acceptanceFileId: fileId,
    acceptanceFileName: 'synthetic-signed-offer.pdf',
    acceptanceFileState: 'available',
    offerExpired: false,
  });
});

test('the database refuses an acceptance outside a final offer', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    repo = documentRepository(pool, scope, dependencies().deps),
    draft = await repo.createDraft(offer.actor, {
      templateId: (await documentTemplateRepository(pool, scope).list())[0]!.id,
      lines: [
        {
          description: 'Fictional draft line',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
    fileId = await seedLibraryFile(scope, offer.actor),
    code = (query: Promise<unknown>) =>
      query
        .then(() => 'accepted')
        .catch((error: { code?: string }) => error.code);
  await pool.query(
    "UPDATE documents SET offer_status='accepted', status_changed_at=now() WHERE tenant_id=$1 AND id=$2",
    [scope, offer.id],
  );
  // Acceptance data on a draft has no accepted offer behind it.
  expect(
    await code(
      pool.query(
        "UPDATE documents SET accepted_at=now(), acceptance_channel='email' WHERE tenant_id=$1 AND id=$2",
        [scope, draft.id],
      ),
    ),
  ).toBe('23514');
  // Channel and instant only exist together.
  expect(
    await code(
      pool.query(
        'UPDATE documents SET accepted_at=now() WHERE tenant_id=$1 AND id=$2',
        [scope, offer.id],
      ),
    ),
  ).toBe('23514');
  // A note and a file belong to an acceptance, never to a bare status.
  expect(
    await code(
      pool.query(
        "UPDATE documents SET acceptance_note='ohne Annahme' WHERE tenant_id=$1 AND id=$2",
        [scope, offer.id],
      ),
    ),
  ).toBe('23514');
  expect(
    await code(
      pool.query(
        'UPDATE documents SET acceptance_file_id=$3 WHERE tenant_id=$1 AND id=$2',
        [scope, offer.id, fileId],
      ),
    ),
  ).toBe('23514');
  // The channel enum lives in the database, not only in the request schema.
  expect(
    await code(
      pool.query(
        "UPDATE documents SET accepted_at=now(), acceptance_channel='fax' WHERE tenant_id=$1 AND id=$2",
        [scope, offer.id],
      ),
    ),
  ).toBe('23514');
  // A foreign tenant's file cannot be attached, even with a correct id.
  const foreign = await foreignTenantFile();
  expect(
    await code(
      pool.query(
        "UPDATE documents SET accepted_at=now(), acceptance_channel='pdf', acceptance_file_id=$3 WHERE tenant_id=$1 AND id=$2",
        [scope, offer.id, foreign.fileId],
      ),
    ),
  ).toBe('23503');
  // The honest record still works and stays readable after a withdrawal.
  await pool.query(
    "UPDATE documents SET accepted_at=now(), acceptance_channel='pdf', acceptance_file_id=$3 WHERE tenant_id=$1 AND id=$2",
    [scope, offer.id, fileId],
  );
  expect((await acceptanceState(scope, offer.id)).acceptance_file_id).toBe(
    fileId,
  );
});

test('the offer status route accepts the acceptance details and refuses bad ones', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    fileId = await seedLibraryFile(scope, offer.actor);
  await accessRepository(pool, scope).issueSession(
    {
      subject: 'seed-' + scope,
      email: (await accessRepository(pool, scope).list())[0]!.email,
    },
    digest('synthetic-acceptance'),
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
  registerDocumentRoutes(app, pool, scope, offer.run.deps);
  const url = '/api/v1/documents/' + offer.id + '/offer-status',
    cookies = { '__Host-ak-session': 'synthetic-acceptance' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-acceptance'),
    },
    post = (payload: Record<string, unknown>, secured = true) =>
      app.inject({
        method: 'POST',
        url,
        cookies,
        ...(secured ? { headers } : {}),
        payload: { status: 'accepted', version: offer.version, ...payload },
      });
  try {
    expect(
      (await app.inject({ method: 'POST', url, payload: {} })).statusCode,
    ).toBe(401);
    expect((await post({ channel: 'email' }, false)).statusCode).toBe(403);
    const invalidChannel = await post({ channel: 'fax' });
    expect(invalidChannel.statusCode).toBe(400);
    expect(invalidChannel.json()).toEqual({ error: 'invalid_channel' });
    const invalidNote = await post({
      channel: 'email',
      note: 'x'.repeat(2001),
    });
    expect(invalidNote.statusCode).toBe(400);
    expect(invalidNote.json()).toEqual({ error: 'invalid_note' });
    const invalidTime = await post({
      channel: 'email',
      acceptedAt: '2031-01-01T00:00:00Z',
    });
    expect(invalidTime.statusCode).toBe(400);
    expect(invalidTime.json()).toEqual({ error: 'invalid_time' });
    const foreignFile = await post({
      channel: 'pdf',
      attachmentFileId: randomUUID(),
    });
    expect(foreignFile.statusCode).toBe(404);
    expect(foreignFile.json()).toEqual({ error: 'not_found' });
    // A stale version stays a conflict before any detail is judged.
    const stale = await post({ channel: 'email', version: offer.version - 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'conflict' });

    const accepted = await post({
      channel: 'phone',
      acceptedAt: '2030-10-26T08:30:00Z',
      note: 'Zusage am Telefon.',
      attachmentFileId: fileId,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      id: offer.id,
      offerStatus: 'accepted',
      acceptanceChannel: 'phone',
      acceptanceNote: 'Zusage am Telefon.',
      acceptanceFileId: fileId,
      acceptanceFileName: 'synthetic-signed-offer.pdf',
      version: offer.version + 1,
    });
    expect(accepted.json().acceptedAt).toBe('2030-10-26T08:30:00.000Z');
    // The projection carries the same record; no hash or artefact key leaks.
    const projected = await app.inject({
      url: '/api/v1/documents?include=offer',
      cookies,
    });
    const row = projected
      .json()
      .find((entry: { id: string }) => entry.id === offer.id);
    expect(row).toMatchObject({
      offerStatus: 'accepted',
      acceptanceChannel: 'phone',
      acceptanceNote: 'Zusage am Telefon.',
      acceptanceFileId: fileId,
      acceptanceFileName: 'synthetic-signed-offer.pdf',
      acceptanceFileState: 'available',
    });
    expect(projected.body).not.toContain('pdfHash');
    expect(projected.body).not.toContain('snapshotHash');
    // The rows without an acceptance still answer every key with NULL.
    const plainRow = (
      await app.inject({ url: '/api/v1/documents?include=offer', cookies })
    )
      .json()
      .find((entry: { id: string }) => entry.id === offer.id);
    expect(Object.keys(plainRow).sort()).toEqual(
      [
        ...oldListKeys,
        'offerStatus',
        'validUntil',
        'offerExpired',
        'acceptedAt',
        'acceptanceChannel',
        'acceptanceNote',
        'acceptanceFileId',
        'acceptanceFileName',
        'acceptanceFileState',
        'sourceDocumentId',
        'sourceNumber',
        ...correctionKeys,
        ...paymentKeys,
      ].sort(),
    );
    // Repeating the identical details is a no-op, a changed one is refused.
    const repeat = await post({
      channel: 'phone',
      acceptedAt: '2030-10-26T08:30:00Z',
      note: 'Zusage am Telefon.',
      attachmentFileId: fileId,
      version: offer.version + 1,
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().version).toBe(offer.version + 1);
    const divergent = await post({
      channel: 'phone',
      note: 'Andere Notiz.',
      version: offer.version + 1,
    });
    expect(divergent.statusCode).toBe(409);
    expect(divergent.json()).toEqual({ error: 'acceptance_conflict' });
    // The withdrawal keeps the record and needs no acceptance details.
    const withdrawn = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: { status: 'withdrawn', version: offer.version + 1 },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({
      offerStatus: 'withdrawn',
      acceptanceChannel: 'phone',
      acceptanceNote: 'Zusage am Telefon.',
      acceptanceFileId: fileId,
    });
  } finally {
    await app.close();
  }
});

// BKP019.b: an accepted offer becomes an order confirmation without retyping a
// single position. Every case below starts from a really finalized, really
// accepted offer, because confirming a mere draft would be a lie.
const confirmationLines = [
  {
    productId: null,
    description: 'Fictional photo box',
    quantity: 2,
    unit: 'Stück',
    unitPriceMinor: 24900,
    taxBasisPoints: 1900,
    discountBasisPoints: 500,
  },
  {
    productId: null,
    description: 'Fictional delivery',
    quantity: 1,
    unit: 'Pauschale',
    unitPriceMinor: 5000,
    taxBasisPoints: 700,
    discountBasisPoints: 0,
  },
];
const confirmationTexts = {
  subject: 'Angebot für {{contact}}',
  introText: 'Fiktive Feier {{event}} am {{date}}.',
  outroText: 'Gesamt {{total}}. Wir freuen uns auf die Feier.',
  validityDays: 14,
};

async function confirmationContext(scope: string) {
  await bootstrapAccess(
    pool,
    scope,
    'confirmation-' + scope + '@example.invalid',
    'Synthetic confirmation',
    'Europe/Berlin',
  );
  const seed = await seedIssuingContext(scope),
    contact = randomUUID(),
    event = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Confirmation Customer','Robin Example','Example Street 2',
      '12345','Fictional Town','DE','confirmation@example.invalid','','','','','active',1)`,
    [scope, contact],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Confirmation Wedding','option',NULL,NULL,NULL,'synthetic','2030-11-14',
      NULL,NULL,'Europe/Berlin','','',1)`,
    [scope, event],
  );
  const run = dependencies();
  return {
    scope,
    actor: seed.actor,
    run,
    repo: documentRepository(pool, scope, { ...run.deps, store: seed.store }),
    contact,
    event,
    templateId: seed.templateId,
  };
}

async function confirmationDraft(
  context: Awaited<ReturnType<typeof confirmationContext>>,
) {
  const draft = await context.repo.createDraft(context.actor, {
    templateId: context.templateId,
    eventId: context.event,
    contactId: context.contact,
  });
  return context.repo.updateDraftContent(context.actor, draft.id, {
    version: draft.version,
    ...confirmationTexts,
    lines: confirmationLines,
  });
}

async function confirmedOffer(scope: string) {
  const context = await confirmationContext(scope),
    draft = await confirmationDraft(context),
    finalized = await context.repo.finalize(
      context.actor,
      draft.id,
      draft.version,
    ),
    sent = await context.repo.changeOfferStatus(context.actor, finalized.id, {
      status: 'sent',
      version: finalized.version,
    }),
    accepted = await context.repo.changeOfferStatus(
      context.actor,
      finalized.id,
      { status: 'accepted', version: sent.version, channel: 'email' },
    );
  return {
    ...context,
    draft,
    offerId: accepted.id,
    version: accepted.version,
    number: accepted.number!,
  };
}

async function storedDocument(scope: string, id: string) {
  return (
    await pool.query<Record<string, unknown>>(
      `SELECT kind, template_id, event_id, contact_id, number, state, subject, intro_text,
              outro_text, validity_days, snapshot_hash, pdf_hash, net_minor, tax_minor,
              gross_minor, version, source_document_id, offer_status,
              to_char(valid_until,'YYYY-MM-DD') AS valid_until
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

async function storedLines(scope: string, id: string) {
  return (
    await pool.query<Record<string, unknown>>(
      `SELECT position, product_id, description, quantity, unit, unit_price_minor,
              tax_basis_points, discount_basis_points
         FROM document_lines WHERE tenant_id=$1 AND document_id=$2 ORDER BY position`,
      [scope, id],
    )
  ).rows;
}

async function confirmationCount(scope: string) {
  return (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM documents
        WHERE tenant_id=$1 AND kind='order_confirmation'`,
      [scope],
    )
  ).rows[0]!.count;
}

test('the confirmation copies every position, price, tax and discount of the offer', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
    stored = await storedDocument(offer.scope, confirmation.id);
  // 1:1: same descriptions, quantities, units, gross prices and both
  // basis-point rates - no conversion, no second rounding of its own.
  expect(await storedLines(offer.scope, confirmation.id)).toEqual(
    await storedLines(offer.scope, offer.offerId),
  );
  expect(stored).toMatchObject({
    kind: 'order_confirmation',
    template_id: null,
    event_id: offer.event,
    contact_id: offer.contact,
    number: null,
    state: 'draft',
    // A confirmation is addressed as one; the rest is the offer's own wording.
    subject: 'Auftragsbestätigung für {{contact}}',
    intro_text: confirmationTexts.introText,
    outro_text: confirmationTexts.outroText,
    validity_days: 14,
    snapshot_hash: null,
    pdf_hash: null,
    version: 1,
    source_document_id: offer.offerId,
    offer_status: null,
    valid_until: null,
  });
  // The sums are recomputed from the copied gross prices and equal the offer's.
  const source = await offer.repo.get(offer.offerId);
  expect(confirmation).toMatchObject({
    netMinor: source!.netMinor,
    taxMinor: source!.taxMinor,
    grossMinor: source!.grossMinor,
  });
  expect(confirmation.grossMinor).toBe(52310);
  expect(confirmation.grossMinor).toBe(
    confirmation.netMinor + confirmation.taxMinor,
  );
});

test('the confirmation needs a final offer the customer accepted', async () => {
  const context = await confirmationContext(randomUUID()),
    draft = await confirmationDraft(context);
  // A draft is not an offer anybody could have accepted.
  await expect(
    context.repo.createOrderConfirmation(
      context.actor,
      draft.id,
      draft.version,
    ),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  const finalized = await context.repo.finalize(
    context.actor,
    draft.id,
    draft.version,
  );
  // Final, but never sent and never accepted.
  await expect(
    context.repo.createOrderConfirmation(
      context.actor,
      finalized.id,
      finalized.version,
    ),
  ).rejects.toMatchObject({ reason: 'offer_not_accepted' });
  const sent = await context.repo.changeOfferStatus(
    context.actor,
    finalized.id,
    {
      status: 'sent',
      version: finalized.version,
    },
  );
  await expect(
    context.repo.createOrderConfirmation(
      context.actor,
      finalized.id,
      sent.version,
    ),
  ).rejects.toMatchObject({ reason: 'offer_not_accepted' });
  const accepted = await context.repo.changeOfferStatus(
      context.actor,
      finalized.id,
      { status: 'accepted', version: sent.version, channel: 'phone' },
    ),
    withdrawn = await context.repo.changeOfferStatus(
      context.actor,
      finalized.id,
      { status: 'withdrawn', version: accepted.version },
    );
  // A withdrawn offer is no order, even though its acceptance stays readable.
  await expect(
    context.repo.createOrderConfirmation(
      context.actor,
      finalized.id,
      withdrawn.version,
    ),
  ).rejects.toMatchObject({ reason: 'offer_not_accepted' });
  expect(await confirmationCount(context.scope)).toBe(0);
});

test('only offers can become a confirmation', async () => {
  const context = await confirmationContext(randomUUID()),
    invoiceTemplate = await documentTemplateRepository(
      pool,
      context.scope,
    ).save(context.actor, {
      kind: 'invoice',
      name: 'Fictional invoice',
      subject: 'Rechnung {{contact}}',
      introText: '',
      outroText: '',
      validityDays: 14,
      state: 'active',
      positions: [],
    }),
    invoice = await context.repo.createDraft(context.actor, {
      templateId: invoiceTemplate.id,
      eventId: context.event,
      contactId: context.contact,
      lines: [confirmationLines[0]!],
    });
  await expect(
    context.repo.createOrderConfirmation(
      context.actor,
      invoice.id,
      invoice.version,
    ),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  // A confirmation is never the source of another confirmation.
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    );
  await expect(
    offer.repo.createOrderConfirmation(
      offer.actor,
      confirmation.id,
      confirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
});

test('a confirmation of another tenant, actor or unknown offer is invisible', async () => {
  const offer = await confirmedOffer(randomUUID());
  await expect(
    documentRepository(
      pool,
      otherTenantId,
      dependencies().deps,
    ).createOrderConfirmation(otherActorId, offer.offerId, offer.version),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    offer.repo.createOrderConfirmation(
      randomUUID(),
      offer.offerId,
      offer.version,
    ),
  ).rejects.toThrow('forbidden');
  await expect(
    offer.repo.createOrderConfirmation(offer.actor, randomUUID(), 1),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect(await confirmationCount(offer.scope)).toBe(0);
});

test('a stale offer version is a conflict and writes nothing', async () => {
  const offer = await confirmedOffer(randomUUID()),
    auditBefore = await offerAudit(offer.scope, offer.offerId);
  await expect(
    offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version - 1,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await confirmationCount(offer.scope)).toBe(0);
  expect(await offerAudit(offer.scope, offer.offerId)).toEqual(auditBefore);
});

test('a second confirmation is refused without consuming a number', async () => {
  const offer = await confirmedOffer(randomUUID()),
    first = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    );
  await expect(
    offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
  ).rejects.toMatchObject({ reason: 'duplicate' });
  const rows = (
    await pool.query<{ id: string }>(
      `SELECT id FROM documents WHERE tenant_id=$1 AND kind='order_confirmation'`,
      [offer.scope],
    )
  ).rows;
  expect(rows.map((row) => row.id)).toEqual([first.id]);
  // Only the confirmation is audited as created; the offer keeps its own trail.
  expect(await offerAudit(offer.scope, first.id)).toEqual(['document.created']);
  expect(await offerAudit(offer.scope, offer.offerId)).toEqual([
    'document.accepted',
    'document.created',
    'document.finalized',
    'document.sent',
    'document.updated',
  ]);
  // No number was allocated: the confirmation has no range yet, and creating one
  // never wrote one.
  expect(
    (
      await pool.query(
        'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
        [offer.scope, 'order_confirmation'],
      )
    ).rows,
  ).toEqual([]);
});

test('two simultaneous confirmations produce exactly one document', async () => {
  const offer = await confirmedOffer(randomUUID()),
    results = await Promise.allSettled([
      offer.repo.createOrderConfirmation(
        offer.actor,
        offer.offerId,
        offer.version,
      ),
      offer.repo.createOrderConfirmation(
        offer.actor,
        offer.offerId,
        offer.version,
      ),
    ]),
    fulfilled = results.filter((result) => result.status === 'fulfilled'),
    rejected = results.filter((result) => result.status === 'rejected');
  // The unique index decides, not an application-side "check first" query.
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    reason: 'duplicate',
  });
  expect(
    (
      await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM documents
          WHERE tenant_id=$1 AND source_document_id=$2 AND kind='order_confirmation'`,
        [offer.scope, offer.offerId],
      )
    ).rows[0]!.count,
  ).toBe(1);
});

test('withdrawing the offer never changes the confirmation', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
    beforeDocument = await storedDocument(offer.scope, confirmation.id),
    beforeLines = await storedLines(offer.scope, confirmation.id),
    withdrawn = await offer.repo.changeOfferStatus(offer.actor, offer.offerId, {
      status: 'withdrawn',
      version: offer.version,
    });
  expect(withdrawn.offerStatus).toBe('withdrawn');
  expect(await storedDocument(offer.scope, confirmation.id)).toEqual(
    beforeDocument,
  );
  expect(await storedLines(offer.scope, confirmation.id)).toEqual(beforeLines);
  // The offer itself stays final and immutable; only its status axis moved.
  expect(await storedDocument(offer.scope, offer.offerId)).toMatchObject({
    state: 'final',
    offer_status: 'withdrawn',
    number: offer.number,
  });
});

test('editing the confirmation never changes the offer', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
    beforeOffer = await storedDocument(offer.scope, offer.offerId),
    beforeLines = await storedLines(offer.scope, offer.offerId),
    pdfBefore = await offer.repo.pdf(offer.offerId),
    edited = await offer.repo.updateDraftContent(offer.actor, confirmation.id, {
      version: confirmation.version,
      subject: 'Auftragsbestätigung, korrigiert',
      introText: 'Korrigierte Einleitung.',
      outroText: 'Korrigierter Schluss.',
      validityDays: 30,
      lines: [
        {
          productId: null,
          description: 'Korrigierte Position',
          quantity: 3,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 700,
          discountBasisPoints: 0,
        },
      ],
    });
  // The confirmation draft is editable, exactly like an offer draft.
  expect(edited).toMatchObject({
    kind: 'order_confirmation',
    subject: 'Auftragsbestätigung, korrigiert',
    version: confirmation.version + 1,
    grossMinor: 3000,
  });
  expect(await storedDocument(offer.scope, offer.offerId)).toEqual(beforeOffer);
  expect(await storedLines(offer.scope, offer.offerId)).toEqual(beforeLines);
  // The offer's bytes are the frozen ones, not a re-render of the new text.
  expect(
    (await offer.repo.pdf(offer.offerId)).bytes.equals(pdfBefore.bytes),
  ).toBe(true);
});

test('the confirmation finalizes with its own number and its own PDF', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
    offerPdf = await offer.repo.pdf(offer.offerId);
  await documentNumberRepository(pool, offer.scope).save(
    offer.actor,
    'order_confirmation',
    { pattern: 'AB-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await offer.repo.finalize(
      offer.actor,
      confirmation.id,
      confirmation.version,
    ),
    stored = await storedDocument(offer.scope, confirmation.id);
  expect(finalized.number).toBe('AB-2030-0001');
  expect(stored).toMatchObject({
    kind: 'order_confirmation',
    state: 'final',
    number: 'AB-2030-0001',
    offer_status: null,
    // Only an offer carries a deadline; a confirmation carries none.
    valid_until: null,
    source_document_id: offer.offerId,
  });
  // The offer keeps its own number, its own status and its own bytes.
  expect(await storedDocument(offer.scope, offer.offerId)).toMatchObject({
    number: offer.number,
    state: 'final',
    offer_status: 'accepted',
  });
  expect(
    (await offer.repo.pdf(offer.offerId)).bytes.equals(offerPdf.bytes),
  ).toBe(true);
  const confirmationPdf = await offer.repo.pdf(confirmation.id);
  expect(confirmationPdf.number).toBe('AB-2030-0001');
  expect(confirmationPdf.bytes.equals(offerPdf.bytes)).toBe(false);
});

test('a missing number range keeps the confirmation a draft', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    );
  await expect(
    offer.repo.finalize(offer.actor, confirmation.id, confirmation.version),
  ).rejects.toMatchObject({ reason: 'number_not_configured' });
  expect(await storedDocument(offer.scope, confirmation.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
    snapshot_hash: null,
    pdf_hash: null,
  });
  expect(
    (
      await pool.query(
        'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
        [offer.scope, 'order_confirmation'],
      )
    ).rows,
  ).toEqual([]);
  // Nothing was consumed: the first real finalization still gets 0001.
  await documentNumberRepository(pool, offer.scope).save(
    offer.actor,
    'order_confirmation',
    { pattern: 'AB-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  expect(
    (
      await offer.repo.finalize(
        offer.actor,
        confirmation.id,
        confirmation.version,
      )
    ).number,
  ).toBe('AB-2030-0001');
});

test('a failing renderer rolls the confirmation number back', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    );
  await documentNumberRepository(pool, offer.scope).save(
    offer.actor,
    'order_confirmation',
    { pattern: 'AB-{YYYY}-{SEQ}', minLength: 4, nextValue: 7 },
  );
  const failing = documentRepository(pool, offer.scope, {
    ...dependencies().deps,
    render: async () => {
      throw new Error('synthetic confirmation renderer failure');
    },
  });
  await expect(
    failing.finalize(offer.actor, confirmation.id, confirmation.version),
  ).rejects.toMatchObject({ reason: 'artifact_failed' });
  expect(await storedDocument(offer.scope, confirmation.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
  });
  expect(
    await documentNumberRepository(pool, offer.scope).preview(
      'order_confirmation',
      new Date('2030-10-26T10:00:00Z'),
    ),
  ).toBe('AB-2030-0007');
});

test('a finalized confirmation is immutable and has no offer status', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    );
  await documentNumberRepository(pool, offer.scope).save(
    offer.actor,
    'order_confirmation',
    { pattern: 'AB-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await offer.repo.finalize(
      offer.actor,
      confirmation.id,
      confirmation.version,
    ),
    pdf = await offer.repo.pdf(confirmation.id);
  // Final content is final: a correction is a new document.
  await expect(
    offer.repo.updateDraftContent(offer.actor, confirmation.id, {
      version: finalized.version,
      subject: 'Zu spät',
      introText: '',
      outroText: '',
      validityDays: 14,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // A confirmation is no offer: it never gains a business status.
  await expect(
    offer.repo.changeOfferStatus(offer.actor, confirmation.id, {
      status: 'sent',
      version: finalized.version,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  expect((await offer.repo.pdf(confirmation.id)).bytes.equals(pdf.bytes)).toBe(
    true,
  );
});

test('the database keeps the source link inside confirmations of this tenant', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
    code = (query: Promise<unknown>) =>
      query
        .then(() => 'accepted')
        .catch((error: { code?: string }) => error.code),
    invoiceId = randomUUID(),
    foreignId = randomUUID();
  await listRows(pool, offer.scope, [
    {
      id: invoiceId,
      templateId: offer.templateId,
      kind: 'invoice',
      issuedAt: '2030-10-26T10:00:00Z',
    },
  ]);
  await listRows(pool, otherTenantId, [
    {
      id: foreignId,
      templateId: otherTemplateId,
      issuedAt: '2030-10-26T10:00:00Z',
    },
  ]);
  // BKP019.c1: a source is reserved for confirmations and invoices. An invoice
  // may name the confirmation it was copied from ...
  expect(
    await code(
      pool.query(
        'UPDATE documents SET source_document_id=$3 WHERE tenant_id=$1 AND id=$2',
        [offer.scope, invoiceId, offer.offerId],
      ),
    ),
  ).toBe('accepted');
  // ... and a deposit invoice may name the confirmation it was copied from.
  // BKP019.c3.1: the one link column also carries an advance payment, so the
  // kind list grew by a fourth kind - nothing else about the rule changed.
  const depositId = randomUUID();
  await listRows(pool, offer.scope, [
    {
      id: depositId,
      templateId: offer.templateId,
      kind: 'deposit_invoice',
      issuedAt: '2030-10-26T10:00:00Z',
    },
  ]);
  expect(
    await code(
      pool.query(
        'UPDATE documents SET source_document_id=$3 WHERE tenant_id=$1 AND id=$2',
        [offer.scope, depositId, offer.offerId],
      ),
    ),
  ).toBe('accepted');
  // The link alone still does not make a blank deposit: without its texts the
  // row stays refused with the same constraint as a blank invoice.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,source_document_id)
         VALUES ($1,$2,'deposit_invoice',NULL,$3,$4,$5,$6)`,
        [
          offer.scope,
          randomUUID(),
          offer.event,
          offer.contact,
          now,
          offer.offerId,
        ],
      ),
    ),
  ).toBe('23514');
  // The widened kind never widened completeness: without event and contact a
  // template-less document is still refused.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days)
         VALUES ($1,$2,'order_confirmation',NULL,NULL,$3,$4,'Auftragsbestätigung','','',14)`,
        [offer.scope, randomUUID(), offer.contact, now],
      ),
    ),
  ).toBe('23514');
  // The widened kind itself is allowed ...
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days)
         VALUES ($1,$2,'order_confirmation',NULL,$3,$4,$5,'Auftragsbestätigung','','',14)`,
        [offer.scope, randomUUID(), offer.event, offer.contact, now],
      ),
    ),
  ).toBe('accepted');
  // ... and `invoice` still is not, exactly as before this slice.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days)
         VALUES ($1,$2,'invoice',NULL,$3,$4,$5,'Rechnung','','',14)`,
        [offer.scope, randomUUID(), offer.event, offer.contact, now],
      ),
    ),
  ).toBe('23514');
  // Exactly one confirmation per offer - also against a second direct insert.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,source_document_id)
         VALUES ($1,$2,'order_confirmation',NULL,$3,$4,$5,'Auftragsbestätigung','','',14,$6)`,
        [
          offer.scope,
          randomUUID(),
          offer.event,
          offer.contact,
          now,
          offer.offerId,
        ],
      ),
    ),
  ).toBe('23505');
  // A document of another tenant can never become the source.
  expect(
    await code(
      pool.query(
        'UPDATE documents SET source_document_id=$3 WHERE tenant_id=$1 AND id=$2',
        [offer.scope, confirmation.id, foreignId],
      ),
    ),
  ).toBe('23503');
});

test('the offer projection names the source of a confirmation', async () => {
  const offer = await confirmedOffer(randomUUID()),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    ),
    listed = (await offer.repo.list({
      include: 'offer',
    })) as DocumentOfferRow[],
    byId = (id: string) => listed.find((row) => row.id === id)!;
  expect(byId(confirmation.id)).toMatchObject({
    sourceDocumentId: offer.offerId,
    sourceNumber: offer.number,
    offerStatus: null,
    validUntil: null,
  });
  // Every other row answers with the honest NULL instead of a guess.
  expect(byId(offer.offerId)).toMatchObject({
    sourceDocumentId: null,
    sourceNumber: null,
  });
  expect(Object.keys(byId(confirmation.id)).sort()).toEqual(
    [
      ...oldListKeys,
      'offerStatus',
      'validUntil',
      'offerExpired',
      ...acceptanceKeys,
      'sourceDocumentId',
      'sourceNumber',
      ...correctionKeys,
      ...paymentKeys,
    ].sort(),
  );
});

test('the confirmation route validates auth, body and duplicates', async () => {
  const offer = await confirmedOffer(randomUUID()),
    granted = (await accessRepository(pool, offer.scope).list())[0]!;
  await accessRepository(pool, offer.scope).issueSession(
    { subject: 'seed-' + offer.scope, email: granted.email },
    digest('synthetic-confirmation'),
  );
  const config = {
      origin: site,
      tenantId: offer.scope,
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
  registerDocumentRoutes(app, pool, offer.scope, offer.run.deps);
  const url = '/api/v1/documents/' + offer.offerId + '/order-confirmation',
    cookies = { '__Host-ak-session': 'synthetic-confirmation' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-confirmation'),
    },
    post = (payload: Record<string, unknown>, secured = true) =>
      app.inject({
        method: 'POST',
        url,
        cookies,
        ...(secured ? { headers } : {}),
        payload,
      });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { version: offer.version },
        })
      ).statusCode,
    ).toBe(401);
    expect((await post({ version: offer.version }, false)).statusCode).toBe(
      403,
    );
    // Fastify's schema strips unknown keys, exactly like every other document
    // route; a missing or non-integer version is refused with 400.
    for (const payload of [{}, { version: 0 }, { version: 1.5 }])
      expect((await post(payload)).statusCode, JSON.stringify(payload)).toBe(
        400,
      );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + randomUUID() + '/order-confirmation',
          cookies,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(404);
    // A stale version is a conflict before anything is copied.
    expect((await post({ version: 1 })).statusCode).toBe(409);
    expect((await post({ version: 1 })).json()).toEqual({ error: 'conflict' });
    const created = await post({ version: offer.version });
    expect(created.statusCode).toBe(201);
    const single = await app.inject({
      url: '/api/v1/documents/' + (created.json() as { id: string }).id,
      cookies,
    });
    expect(Object.keys(created.json() as object).sort()).toEqual(
      Object.keys(single.json() as object).sort(),
    );
    expect(created.json()).toMatchObject({
      kind: 'order_confirmation',
      state: 'draft',
      number: null,
      templateId: null,
      subject: 'Auftragsbestätigung für {{contact}}',
      grossMinor: 52310,
    });
    // The create answer keeps the old document shape: the offer projection, not
    // this route, names the source.
    expect(created.body).not.toContain('sourceDocumentId');
    const again = await post({ version: offer.version });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'duplicate' });
    expect(await confirmationCount(offer.scope)).toBe(1);
  } finally {
    await app.close();
  }
});

test('an acceptance of another tenant or actor is invisible', async () => {
  const scope = randomUUID(),
    offer = await sentFinalOffer(scope),
    foreignFile = await seedLibraryFile(otherTenantId, otherActorId);
  await expect(
    documentRepository(
      pool,
      otherTenantId,
      dependencies().deps,
    ).changeOfferStatus(otherActorId, offer.id, {
      status: 'accepted',
      version: offer.version,
      channel: 'email',
      attachmentFileId: foreignFile,
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    offer.repo.changeOfferStatus(randomUUID(), offer.id, {
      status: 'accepted',
      version: offer.version,
      channel: 'email',
    }),
  ).rejects.toThrow('forbidden');
  expect((await offerState(scope, offer.id)).offer_status).toBe('sent');
});

// BKP019.c1: a finalized order confirmation becomes an invoice draft without a
// single retyped position. The invoice is its own document, owns the invoice
// number range, and is never a replacement: a finalized document is corrected by
// a later document, not rewritten.
async function invoicedOrder(scope: string) {
  const offer = await confirmedOffer(scope),
    confirmation = await offer.repo.createOrderConfirmation(
      offer.actor,
      offer.offerId,
      offer.version,
    );
  await documentNumberRepository(pool, scope).save(
    offer.actor,
    'order_confirmation',
    { pattern: 'AB-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const confirmationFinal = await offer.repo.finalize(
    offer.actor,
    confirmation.id,
    confirmation.version,
  );
  return { ...offer, confirmation: confirmationFinal };
}

async function invoiceCount(scope: string) {
  return (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM documents
        WHERE tenant_id=$1 AND kind='invoice'`,
      [scope],
    )
  ).rows[0]!.count;
}

async function invoiceSequence(scope: string) {
  return (
    await pool.query<{ next_value: number }>(
      'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
      [scope, 'invoice'],
    )
  ).rows[0]?.next_value;
}

test('the invoice copies every position, price, tax and discount of the confirmation', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    stored = await storedDocument(order.scope, invoice.id);
  // 1:1 from the confirmation: descriptions, quantities, units, gross prices and
  // both basis-point rates - no conversion, no second rounding of its own.
  expect(await storedLines(order.scope, invoice.id)).toEqual(
    await storedLines(order.scope, order.confirmation.id),
  );
  expect(stored).toMatchObject({
    kind: 'invoice',
    template_id: null,
    event_id: order.event,
    contact_id: order.contact,
    number: null,
    state: 'draft',
    // Addressed as an invoice; the rest is the confirmation's own wording.
    subject: 'Rechnung für {{contact}}',
    intro_text: confirmationTexts.introText,
    outro_text: confirmationTexts.outroText,
    validity_days: 14,
    snapshot_hash: null,
    pdf_hash: null,
    version: 1,
    source_document_id: order.confirmation.id,
    // No offer axis, no deadline: an invoice is no offer.
    offer_status: null,
    valid_until: null,
  });
  // The sums are recomputed from the copied gross prices and are exactly the
  // confirmation's own totals, across both tax groups.
  const source = await order.repo.get(order.confirmation.id);
  expect(invoice).toMatchObject({
    netMinor: source!.netMinor,
    taxMinor: source!.taxMinor,
    grossMinor: source!.grossMinor,
  });
  expect(invoice.grossMinor).toBe(52310);
  expect(invoice.grossMinor).toBe(invoice.netMinor + invoice.taxMinor);
});

test('the invoice needs a finalized confirmation as its source', async () => {
  const context = await confirmationContext(randomUUID()),
    offer = await confirmedOffer(randomUUID());
  // A draft confirmation is not billable: its content can still move.
  const draftConfirmation = await offer.repo.createOrderConfirmation(
    offer.actor,
    offer.offerId,
    offer.version,
  );
  await expect(
    offer.repo.createInvoice(
      offer.actor,
      draftConfirmation.id,
      draftConfirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // An offer is invoiced through a confirmation, never directly.
  await expect(
    offer.repo.createInvoice(offer.actor, offer.offerId, offer.version),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  // No chain either: an invoice is not the source of another invoice.
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await expect(
    order.repo.createInvoice(order.actor, invoice.id, invoice.version),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  await expect(
    context.repo.createInvoice(context.actor, randomUUID(), 1),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect(await invoiceCount(context.scope)).toBe(0);
});

test('a withdrawn order is never invoiced', async () => {
  const order = await invoicedOrder(randomUUID()),
    withdrawn = await order.repo.changeOfferStatus(order.actor, order.offerId, {
      status: 'withdrawn',
      version: order.version,
    });
  expect(withdrawn.offerStatus).toBe('withdrawn');
  // The confirmation itself stays final and untouched; the order behind it is
  // gone, so it can no longer be billed.
  await expect(
    order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'order_withdrawn' });
  expect(await invoiceCount(order.scope)).toBe(0);
  // A source whose own content state is withdrawn is refused just the same -
  // the check is on the order, not on a status word.
  await pool.query(
    `UPDATE documents SET state='withdrawn' WHERE tenant_id=$1 AND id=$2`,
    [order.scope, order.confirmation.id],
  );
  await expect(
    order.repo.createInvoice(order.actor, order.confirmation.id, 1),
  ).rejects.toMatchObject({ reason: 'order_withdrawn' });
  expect(await invoiceCount(order.scope)).toBe(0);
  expect(await invoiceSequence(order.scope)).toBeUndefined();
});

test('a second invoice is refused without consuming a number', async () => {
  const order = await invoicedOrder(randomUUID()),
    first = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await expect(
    order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'duplicate' });
  const rows = (
    await pool.query<{ id: string }>(
      `SELECT id FROM documents WHERE tenant_id=$1 AND kind='invoice'`,
      [order.scope],
    )
  ).rows;
  expect(rows.map((row) => row.id)).toEqual([first.id]);
  // Creating never touches the invoice range, so a rejected duplicate cannot
  // burn a number.
  expect(await invoiceSequence(order.scope)).toBeUndefined();
  expect(await offerAudit(order.scope, first.id)).toEqual(['document.created']);
});

test('two simultaneous invoices produce exactly one document', async () => {
  const order = await invoicedOrder(randomUUID()),
    results = await Promise.allSettled([
      order.repo.createInvoice(
        order.actor,
        order.confirmation.id,
        order.confirmation.version,
      ),
      order.repo.createInvoice(
        order.actor,
        order.confirmation.id,
        order.confirmation.version,
      ),
    ]),
    fulfilled = results.filter((result) => result.status === 'fulfilled'),
    rejected = results.filter((result) => result.status === 'rejected');
  // The partial unique index decides, not an application-side "check first".
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    reason: 'duplicate',
  });
  expect(await invoiceCount(order.scope)).toBe(1);
});

test('an invoice of another tenant, actor or unknown confirmation is invisible', async () => {
  const order = await invoicedOrder(randomUUID());
  await expect(
    documentRepository(pool, otherTenantId, dependencies().deps).createInvoice(
      otherActorId,
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    order.repo.createInvoice(
      randomUUID(),
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toThrow('forbidden');
  expect(await invoiceCount(order.scope)).toBe(0);
});

test('a stale confirmation version is a conflict and writes nothing', async () => {
  const order = await invoicedOrder(randomUUID()),
    auditBefore = await offerAudit(order.scope, order.confirmation.id);
  await expect(
    order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version - 1,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await invoiceCount(order.scope)).toBe(0);
  expect(await offerAudit(order.scope, order.confirmation.id)).toEqual(
    auditBefore,
  );
});

test('the invoice finalizes with its own number and its own PDF', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    offerPdf = await order.repo.pdf(order.offerId),
    confirmationPdf = await order.repo.pdf(order.confirmation.id);
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'invoice',
    { pattern: 'RE-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await order.repo.finalize(
      order.actor,
      invoice.id,
      invoice.version,
    ),
    stored = await storedDocument(order.scope, invoice.id);
  expect(finalized.number).toBe('RE-2030-0001');
  expect(stored).toMatchObject({
    kind: 'invoice',
    state: 'final',
    number: 'RE-2030-0001',
    offer_status: null,
    valid_until: null,
    source_document_id: order.confirmation.id,
    // Integer minor units, read back as the driver's exact numeric string.
    gross_minor: '52310',
  });
  // Both originals keep their number, their state and their bytes.
  expect(
    await storedDocument(order.scope, order.confirmation.id),
  ).toMatchObject({ number: 'AB-2030-0001', state: 'final' });
  expect(
    (await order.repo.pdf(order.offerId)).bytes.equals(offerPdf.bytes),
  ).toBe(true);
  expect(
    (await order.repo.pdf(order.confirmation.id)).bytes.equals(
      confirmationPdf.bytes,
    ),
  ).toBe(true);
  const invoicePdf = await order.repo.pdf(invoice.id);
  expect(invoicePdf.number).toBe('RE-2030-0001');
  expect(invoicePdf.bytes.equals(confirmationPdf.bytes)).toBe(false);
});

test('a missing number range keeps the invoice a draft', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await expect(
    order.repo.finalize(order.actor, invoice.id, invoice.version),
  ).rejects.toMatchObject({ reason: 'number_not_configured' });
  expect(await storedDocument(order.scope, invoice.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
    snapshot_hash: null,
    pdf_hash: null,
  });
  expect(await invoiceSequence(order.scope)).toBeUndefined();
  // Nothing was consumed: the first real finalization still gets 0001.
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'invoice',
    { pattern: 'RE-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  expect(
    (await order.repo.finalize(order.actor, invoice.id, invoice.version))
      .number,
  ).toBe('RE-2030-0001');
});

test('a failing renderer rolls the invoice number back', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'invoice',
    { pattern: 'RE-{YYYY}-{SEQ}', minLength: 4, nextValue: 7 },
  );
  const failing = documentRepository(pool, order.scope, {
    ...dependencies().deps,
    render: async () => {
      throw new Error('synthetic invoice renderer failure');
    },
  });
  await expect(
    failing.finalize(order.actor, invoice.id, invoice.version),
  ).rejects.toMatchObject({ reason: 'artifact_failed' });
  expect(await storedDocument(order.scope, invoice.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
  });
  expect(
    await documentNumberRepository(pool, order.scope).preview(
      'invoice',
      new Date('2030-10-26T10:00:00Z'),
    ),
  ).toBe('RE-2030-0007');
});

test('a finalized invoice is immutable and has no offer status', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'invoice',
    { pattern: 'RE-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await order.repo.finalize(
      order.actor,
      invoice.id,
      invoice.version,
    ),
    pdf = await order.repo.pdf(invoice.id);
  // Final content is final: a correction is a new document, never an edit.
  await expect(
    order.repo.updateDraftContent(order.actor, invoice.id, {
      version: finalized.version,
      subject: 'Zu spät',
      introText: '',
      outroText: '',
      validityDays: 14,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // An invoice is no offer: it never gains a business status.
  await expect(
    order.repo.changeOfferStatus(order.actor, invoice.id, {
      status: 'sent',
      version: finalized.version,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  expect((await order.repo.pdf(invoice.id)).bytes.equals(pdf.bytes)).toBe(true);
});

test('editing the invoice draft never changes the confirmation', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    beforeConfirmation = await storedDocument(
      order.scope,
      order.confirmation.id,
    ),
    beforeLines = await storedLines(order.scope, order.confirmation.id),
    confirmationPdf = await order.repo.pdf(order.confirmation.id),
    edited = await order.repo.updateDraftContent(order.actor, invoice.id, {
      version: invoice.version,
      subject: 'Rechnung, korrigiert',
      introText: 'Korrigierte Einleitung.',
      outroText: 'Korrigierter Schluss.',
      validityDays: 14,
      lines: [
        {
          productId: null,
          description: 'Korrigierte Position',
          quantity: 3,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 700,
          discountBasisPoints: 0,
        },
      ],
    });
  // The invoice draft is editable, exactly like an offer or confirmation draft.
  expect(edited).toMatchObject({
    kind: 'invoice',
    subject: 'Rechnung, korrigiert',
    version: invoice.version + 1,
    grossMinor: 3000,
  });
  expect(await storedDocument(order.scope, order.confirmation.id)).toEqual(
    beforeConfirmation,
  );
  expect(await storedLines(order.scope, order.confirmation.id)).toEqual(
    beforeLines,
  );
  expect(
    (await order.repo.pdf(order.confirmation.id)).bytes.equals(
      confirmationPdf.bytes,
    ),
  ).toBe(true);
});

test('the database keeps the invoice source inside invoices of this tenant', async () => {
  const order = await invoicedOrder(randomUUID()),
    code = (query: Promise<unknown>) =>
      query
        .then(() => 'accepted')
        .catch((error: { code?: string }) => error.code),
    foreignId = randomUUID();
  await listRows(pool, otherTenantId, [
    {
      id: foreignId,
      templateId: otherTemplateId,
      issuedAt: '2030-10-26T10:00:00Z',
    },
  ]);
  // A template-less invoice without a source stays refused - the blank-document
  // rule of this database was not widened, only given its invoice path.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days)
         VALUES ($1,$2,'invoice',NULL,$3,$4,$5,'Rechnung','','',14)`,
        [order.scope, randomUUID(), order.event, order.contact, now],
      ),
    ),
  ).toBe('23514');
  // Copied from a confirmation of this tenant, it is allowed ...
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,source_document_id)
         VALUES ($1,$2,'invoice',NULL,$3,$4,$5,'Rechnung','','',14,$6)`,
        [
          order.scope,
          randomUUID(),
          order.event,
          order.contact,
          now,
          order.confirmation.id,
        ],
      ),
    ),
  ).toBe('accepted');
  // ... exactly once, also against a second direct insert.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,source_document_id)
         VALUES ($1,$2,'invoice',NULL,$3,$4,$5,'Rechnung','','',14,$6)`,
        [
          order.scope,
          randomUUID(),
          order.event,
          order.contact,
          now,
          order.confirmation.id,
        ],
      ),
    ),
  ).toBe('23505');
  // A document of another tenant can never become the source.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,source_document_id)
         VALUES ($1,$2,'invoice',NULL,$3,$4,$5,'Rechnung','','',14,$6)`,
        [order.scope, randomUUID(), order.event, order.contact, now, foreignId],
      ),
    ),
  ).toBe('23503');
});

test('the offer projection names the source of an invoice', async () => {
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    listed = (await order.repo.list({
      include: 'offer',
    })) as DocumentOfferRow[],
    byId = (id: string) => listed.find((row) => row.id === id)!;
  expect(byId(invoice.id)).toMatchObject({
    kind: 'invoice',
    sourceDocumentId: order.confirmation.id,
    sourceNumber: 'AB-2030-0001',
    offerStatus: null,
    validUntil: null,
  });
  // The key set of the pinned projection did not grow: no source kind, no
  // invoice-only field.
  expect(Object.keys(byId(invoice.id)).sort()).toEqual(
    [
      ...oldListKeys,
      'offerStatus',
      'validUntil',
      'offerExpired',
      ...acceptanceKeys,
      ...confirmationKeys,
      ...correctionKeys,
      ...paymentKeys,
    ].sort(),
  );
});

test('the invoice route validates auth, body and duplicates', async () => {
  const order = await invoicedOrder(randomUUID()),
    granted = (await accessRepository(pool, order.scope).list())[0]!;
  await accessRepository(pool, order.scope).issueSession(
    { subject: 'seed-' + order.scope, email: granted.email },
    digest('synthetic-invoice'),
  );
  const config = {
      origin: site,
      tenantId: order.scope,
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
  registerDocumentRoutes(app, pool, order.scope, order.run.deps);
  const url = '/api/v1/documents/' + order.confirmation.id + '/invoice',
    cookies = { '__Host-ak-session': 'synthetic-invoice' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-invoice'),
    },
    post = (payload: Record<string, unknown>, secured = true) =>
      app.inject({
        method: 'POST',
        url,
        cookies,
        ...(secured ? { headers } : {}),
        payload,
      });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { version: order.confirmation.version },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await post({ version: order.confirmation.version }, false)).statusCode,
    ).toBe(403);
    // Fastify's schema strips unknown keys; a missing or non-integer version is
    // refused with 400.
    for (const payload of [{}, { version: 0 }, { version: 1.5 }])
      expect((await post(payload)).statusCode, JSON.stringify(payload)).toBe(
        400,
      );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + randomUUID() + '/invoice',
          cookies,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(404);
    // A stale version is a conflict before anything is copied.
    expect((await post({ version: 1 })).statusCode).toBe(409);
    expect((await post({ version: 1 })).json()).toEqual({ error: 'conflict' });
    const created = await post({ version: order.confirmation.version });
    expect(created.statusCode).toBe(201);
    const single = await app.inject({
      url: '/api/v1/documents/' + (created.json() as { id: string }).id,
      cookies,
    });
    expect(Object.keys(created.json() as object).sort()).toEqual(
      Object.keys(single.json() as object).sort(),
    );
    expect(created.json()).toMatchObject({
      kind: 'invoice',
      state: 'draft',
      number: null,
      templateId: null,
      subject: 'Rechnung für {{contact}}',
      grossMinor: 52310,
    });
    // The create answer keeps the old document shape: the offer projection, not
    // this route, names the source.
    expect(created.body).not.toContain('sourceDocumentId');
    const again = await post({ version: order.confirmation.version });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'duplicate' });
    expect(await invoiceCount(order.scope)).toBe(1);
  } finally {
    await app.close();
  }
});

// BKP019.c3.1: a finalized confirmation can be invoiced in advance. The deposit
// invoice is its own document with its own AZ number range and a link to the
// confirmation; it starts as an editable draft, so the operator decides the
// deposit amount by reducing the copied positions before it is frozen.
// Several deposits per order are legitimate (30 % now, 20 % later), so there is
// deliberately no unique index - unlike the one-invoice rule of BKP019.c1.
async function depositCount(scope: string) {
  return (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM documents
        WHERE tenant_id=$1 AND kind='deposit_invoice'`,
      [scope],
    )
  ).rows[0]!.count;
}

async function depositSequence(scope: string) {
  return (
    await pool.query<{ next_value: number }>(
      'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
      [scope, 'deposit_invoice'],
    )
  ).rows[0]?.next_value;
}

// `invoicedOrder` finalizes the confirmation and creates no invoice: exactly the
// state a deposit invoice needs.
test('the deposit invoice copies every position of the confirmation into its own draft', async () => {
  const order = await invoicedOrder(randomUUID()),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    stored = await storedDocument(order.scope, deposit.id);
  // 1:1 from the confirmation: magnitudes only, no conversion and no second
  // rounding, so the draft can be reduced to the agreed deposit in the editor.
  expect(await storedLines(order.scope, deposit.id)).toEqual(
    await storedLines(order.scope, order.confirmation.id),
  );
  expect(stored).toMatchObject({
    kind: 'deposit_invoice',
    template_id: null,
    event_id: order.event,
    contact_id: order.contact,
    number: null,
    state: 'draft',
    subject: 'Anzahlungsrechnung für {{contact}}',
    intro_text: confirmationTexts.introText,
    outro_text: confirmationTexts.outroText,
    validity_days: 14,
    snapshot_hash: null,
    pdf_hash: null,
    version: 1,
    source_document_id: order.confirmation.id,
    // No offer axis, no deadline: a deposit is no offer.
    offer_status: null,
    valid_until: null,
  });
  const source = await order.repo.get(order.confirmation.id);
  expect(deposit).toMatchObject({
    netMinor: source!.netMinor,
    taxMinor: source!.taxMinor,
    grossMinor: source!.grossMinor,
  });
  expect(deposit.grossMinor).toBe(52310);
  expect(deposit.grossMinor).toBe(deposit.netMinor + deposit.taxMinor);
});

test('the deposit invoice needs a finalized confirmation as its source', async () => {
  const context = await confirmationContext(randomUUID()),
    offer = await confirmedOffer(randomUUID());
  // A draft confirmation can still move.
  const draftConfirmation = await offer.repo.createOrderConfirmation(
    offer.actor,
    offer.offerId,
    offer.version,
  );
  await expect(
    offer.repo.createDepositInvoice(
      offer.actor,
      draftConfirmation.id,
      draftConfirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // An offer is deposited through a confirmation, never directly.
  await expect(
    offer.repo.createDepositInvoice(offer.actor, offer.offerId, offer.version),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  const order = await invoicedOrder(randomUUID()),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  // Neither an invoice nor a deposit is a source of another deposit.
  await expect(
    order.repo.createDepositInvoice(order.actor, invoice.id, invoice.version),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  await expect(
    order.repo.createDepositInvoice(order.actor, deposit.id, deposit.version),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  await expect(
    context.repo.createDepositInvoice(context.actor, randomUUID(), 1),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect(await depositCount(context.scope)).toBe(0);
});

test('a withdrawn order is never deposited', async () => {
  const order = await invoicedOrder(randomUUID()),
    withdrawn = await order.repo.changeOfferStatus(order.actor, order.offerId, {
      status: 'withdrawn',
      version: order.version,
    });
  expect(withdrawn.offerStatus).toBe('withdrawn');
  // The confirmation stays final and readable; only the order behind it is gone.
  await expect(
    order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'order_withdrawn' });
  expect(await depositCount(order.scope)).toBe(0);
  // A source whose own content state is withdrawn is refused just the same.
  await pool.query(
    `UPDATE documents SET state='withdrawn' WHERE tenant_id=$1 AND id=$2`,
    [order.scope, order.confirmation.id],
  );
  await expect(
    order.repo.createDepositInvoice(order.actor, order.confirmation.id, 1),
  ).rejects.toMatchObject({ reason: 'order_withdrawn' });
  expect(await depositCount(order.scope)).toBe(0);
  expect(await depositSequence(order.scope)).toBeUndefined();
});

test('a stale confirmation version is a conflict and writes no deposit', async () => {
  const order = await invoicedOrder(randomUUID()),
    auditBefore = await offerAudit(order.scope, order.confirmation.id);
  await expect(
    order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version - 1,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await depositCount(order.scope)).toBe(0);
  expect(await offerAudit(order.scope, order.confirmation.id)).toEqual(
    auditBefore,
  );
});

test('several deposits on one order are allowed and each names the confirmation', async () => {
  const order = await invoicedOrder(randomUUID()),
    first = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    second = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  expect(second.id).not.toBe(first.id);
  const rows = (
    await pool.query<{ id: string; source_document_id: string }>(
      `SELECT id, source_document_id FROM documents
        WHERE tenant_id=$1 AND kind='deposit_invoice' ORDER BY id`,
      [order.scope],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.source_document_id)).toEqual([
    order.confirmation.id,
    order.confirmation.id,
  ]);
  // The deliberate absence of a unique index is part of the contract: two
  // legitimate instalments must both be storable.
  const unique = (
    await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='documents'
          AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%deposit_invoice%'`,
    )
  ).rows;
  expect(unique).toEqual([]);
  expect(await offerAudit(order.scope, first.id)).toEqual(['document.created']);
  expect(await offerAudit(order.scope, second.id)).toEqual([
    'document.created',
  ]);
});

test('two simultaneous deposits produce two drafts, never an error', async () => {
  const order = await invoicedOrder(randomUUID()),
    results = await Promise.allSettled([
      order.repo.createDepositInvoice(
        order.actor,
        order.confirmation.id,
        order.confirmation.version,
      ),
      order.repo.createDepositInvoice(
        order.actor,
        order.confirmation.id,
        order.confirmation.version,
      ),
    ]);
  expect(results.map((result) => result.status)).toEqual([
    'fulfilled',
    'fulfilled',
  ]);
  expect(await depositCount(order.scope)).toBe(2);
});

test('a deposit of another tenant, actor or unknown confirmation is invisible', async () => {
  const order = await invoicedOrder(randomUUID());
  await expect(
    documentRepository(
      pool,
      otherTenantId,
      dependencies().deps,
    ).createDepositInvoice(
      otherActorId,
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    order.repo.createDepositInvoice(
      randomUUID(),
      order.confirmation.id,
      order.confirmation.version,
    ),
  ).rejects.toThrow('forbidden');
  expect(await depositCount(order.scope)).toBe(0);
});

test('the deposit finalizes with its own AZ number and its source', async () => {
  const order = await invoicedOrder(randomUUID()),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    confirmationPdf = await order.repo.pdf(order.confirmation.id);
  // The invoice range is configured and must stay unused: a deposit is no
  // invoice and never borrows the RE circle.
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'invoice',
    { pattern: 'RE-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  await expect(
    order.repo.finalize(order.actor, deposit.id, deposit.version),
  ).rejects.toMatchObject({ reason: 'number_not_configured' });
  expect(await depositSequence(order.scope)).toBeUndefined();
  expect(await storedDocument(order.scope, deposit.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
    snapshot_hash: null,
    pdf_hash: null,
  });
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'deposit_invoice',
    { pattern: 'AZ-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await order.repo.finalize(
      order.actor,
      deposit.id,
      deposit.version,
    ),
    stored = await storedDocument(order.scope, deposit.id);
  expect(finalized.number).toBe('AZ-2030-0001');
  expect(stored).toMatchObject({
    kind: 'deposit_invoice',
    state: 'final',
    number: 'AZ-2030-0001',
    source_document_id: order.confirmation.id,
    gross_minor: '52310',
    valid_until: null,
  });
  // The confirmation keeps its number and its bytes.
  expect(
    (await storedDocument(order.scope, order.confirmation.id)).number,
  ).toBe('AB-2030-0001');
  expect(
    (await order.repo.pdf(order.confirmation.id)).bytes.equals(
      confirmationPdf.bytes,
    ),
  ).toBe(true);
  const depositPdf = await order.repo.pdf(deposit.id);
  expect(depositPdf.number).toBe('AZ-2030-0001');
  expect(depositPdf.bytes.equals(confirmationPdf.bytes)).toBe(false);
  // A finalized deposit is a claim: the projection carries the payment axis.
  const rows = (await order.repo.list({
      include: 'offer',
    })) as DocumentOfferRow[],
    projected = rows.find((row) => row.id === deposit.id)!;
  expect(projected).toMatchObject({
    kind: 'deposit_invoice',
    sourceDocumentId: order.confirmation.id,
    sourceNumber: 'AB-2030-0001',
    paymentState: 'none',
    openMinor: 52310,
  });
  expect(Object.keys(projected)).toEqual(Object.keys(rows[0]!));
});

test('a failing renderer rolls the deposit number back', async () => {
  const order = await invoicedOrder(randomUUID()),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'deposit_invoice',
    { pattern: 'AZ-{YYYY}-{SEQ}', minLength: 4, nextValue: 7 },
  );
  const failing = documentRepository(pool, order.scope, {
    ...dependencies().deps,
    render: async () => {
      throw new Error('synthetic deposit renderer failure');
    },
  });
  await expect(
    failing.finalize(order.actor, deposit.id, deposit.version),
  ).rejects.toMatchObject({ reason: 'artifact_failed' });
  expect(await storedDocument(order.scope, deposit.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
  });
  expect(
    await documentNumberRepository(pool, order.scope).preview(
      'deposit_invoice',
      new Date('2030-10-26T10:00:00Z'),
    ),
  ).toBe('AZ-2030-0007');
});

test('a deposit draft is editable, a finalized one never is', async () => {
  const order = await invoicedOrder(randomUUID()),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    ),
    beforeConfirmation = await storedDocument(
      order.scope,
      order.confirmation.id,
    ),
    beforeLines = await storedLines(order.scope, order.confirmation.id),
    edited = await order.repo.updateDraftContent(order.actor, deposit.id, {
      version: deposit.version,
      subject: 'Anzahlungsrechnung 30 %',
      introText: 'Anzahlung auf den Auftrag.',
      outroText: 'Der Rest wird mit der Schlussrechnung abgerechnet.',
      validityDays: 14,
      // The deposit amount is the operator's decision: it is expressed by the
      // positions, and the sums follow them without a second rounding.
      lines: [
        {
          productId: null,
          description: 'Anzahlung 30 %',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 15693,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    });
  expect(edited).toMatchObject({
    kind: 'deposit_invoice',
    subject: 'Anzahlungsrechnung 30 %',
    version: deposit.version + 1,
    grossMinor: 15693,
    netMinor: 13187,
    taxMinor: 2506,
  });
  // The confirmation it was copied from keeps everything.
  expect(await storedDocument(order.scope, order.confirmation.id)).toEqual(
    beforeConfirmation,
  );
  expect(await storedLines(order.scope, order.confirmation.id)).toEqual(
    beforeLines,
  );
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'deposit_invoice',
    { pattern: 'AZ-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await order.repo.finalize(
    order.actor,
    deposit.id,
    edited.version,
  );
  await expect(
    order.repo.updateDraftContent(order.actor, deposit.id, {
      version: finalized.version,
      subject: 'Zu spät',
      introText: '',
      outroText: '',
      validityDays: 14,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // A deposit is no offer: it never gains a business status.
  await expect(
    order.repo.changeOfferStatus(order.actor, deposit.id, {
      status: 'sent',
      version: finalized.version,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
});

test('a finalized deposit is correctable like any other claim', async () => {
  const order = await invoicedOrder(randomUUID()),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  // A draft is not correctable: only a frozen claim is.
  await expect(
    order.repo.createCorrection(
      order.actor,
      deposit.id,
      deposit.version,
      'credit',
    ),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'deposit_invoice',
    { pattern: 'AZ-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await order.repo.finalize(
      order.actor,
      deposit.id,
      deposit.version,
    ),
    correction = await order.repo.createCorrection(
      order.actor,
      deposit.id,
      finalized.version,
      'credit',
    );
  expect(correction).toMatchObject({
    kind: 'correction',
    state: 'draft',
    grossMinor: finalized.grossMinor,
  });
  expect(
    (
      await pool.query<{ source_document_id: string }>(
        'SELECT source_document_id FROM documents WHERE tenant_id=$1 AND id=$2',
        [order.scope, correction.id],
      )
    ).rows[0]!.source_document_id,
  ).toBe(deposit.id);
});

test('a deposit stays byte-identical while money is recorded against it', async () => {
  const order = await invoicedOrder(randomUUID()),
    deposit = await order.repo.createDepositInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'deposit_invoice',
    { pattern: 'AZ-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
  const finalized = await order.repo.finalize(
      order.actor,
      deposit.id,
      deposit.version,
    ),
    pdfBefore = await order.repo.pdf(deposit.id),
    payments = documentPaymentRepository(pool, order.scope);
  await payments.record(order.actor, deposit.id, {
    receivedOn: tenantToday(),
    amountMinor: 10000,
    method: 'bank_transfer',
  });
  expect((await order.repo.pdf(deposit.id)).bytes.equals(pdfBefore.bytes)).toBe(
    true,
  );
  expect(await storedDocument(order.scope, deposit.id)).toMatchObject({
    number: 'AZ-2030-0001',
    gross_minor: '52310',
  });
  const rows = (await order.repo.list({
      include: 'offer',
    })) as DocumentOfferRow[],
    projected = rows.find((row) => row.id === deposit.id)!;
  expect(projected).toMatchObject({
    paymentState: 'partial',
    openMinor: 42310,
  });
  expect(finalized.number).toBe('AZ-2030-0001');
});

test('the deposit route validates auth, body and allows a second deposit', async () => {
  const order = await invoicedOrder(randomUUID()),
    granted = (await accessRepository(pool, order.scope).list())[0]!;
  await accessRepository(pool, order.scope).issueSession(
    { subject: 'seed-' + order.scope, email: granted.email },
    digest('synthetic-deposit'),
  );
  const config = {
      origin: site,
      tenantId: order.scope,
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
  registerDocumentRoutes(app, pool, order.scope, order.run.deps);
  const url = '/api/v1/documents/' + order.confirmation.id + '/deposit-invoice',
    cookies = { '__Host-ak-session': 'synthetic-deposit' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-deposit'),
    },
    post = (payload: Record<string, unknown>, secured = true) =>
      app.inject({
        method: 'POST',
        url,
        cookies,
        ...(secured ? { headers } : {}),
        payload,
      });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { version: order.confirmation.version },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await post({ version: order.confirmation.version }, false)).statusCode,
    ).toBe(403);
    for (const payload of [{}, { version: 0 }, { version: 1.5 }])
      expect((await post(payload)).statusCode, JSON.stringify(payload)).toBe(
        400,
      );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + randomUUID() + '/deposit-invoice',
          cookies,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(404);
    expect((await post({ version: 1 })).statusCode).toBe(409);
    expect((await post({ version: 1 })).json()).toEqual({ error: 'conflict' });
    const created = await post({ version: order.confirmation.version });
    expect(created.statusCode).toBe(201);
    const single = await app.inject({
      url: '/api/v1/documents/' + (created.json() as { id: string }).id,
      cookies,
    });
    expect(Object.keys(created.json() as object).sort()).toEqual(
      Object.keys(single.json() as object).sort(),
    );
    expect(created.json()).toMatchObject({
      kind: 'deposit_invoice',
      state: 'draft',
      number: null,
      templateId: null,
      subject: 'Anzahlungsrechnung für {{contact}}',
      grossMinor: 52310,
    });
    // The create answer keeps the old document shape.
    expect(created.body).not.toContain('sourceDocumentId');
    // A second instalment is written, not refused: there is no duplicate rule.
    const again = await post({ version: order.confirmation.version });
    expect(again.statusCode).toBe(201);
    expect(await depositCount(order.scope)).toBe(2);
  } finally {
    await app.close();
  }
});

test('a blank deposit is refused and a copied one is accepted by the database', async () => {
  const order = await invoicedOrder(randomUUID()),
    code = (query: Promise<unknown>) =>
      query
        .then(() => 'accepted')
        .catch((error: { code?: string }) => error.code),
    foreignId = randomUUID();
  await listRows(pool, otherTenantId, [
    {
      id: foreignId,
      templateId: otherTemplateId,
      issuedAt: '2030-10-26T10:00:00Z',
    },
  ]);
  // Without a source a template-less deposit stays refused: the blank-document
  // rule of 0042/0043 was not widened, only given its deposit path.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days)
         VALUES ($1,$2,'deposit_invoice',NULL,$3,$4,$5,'Anzahlungsrechnung','','',14)`,
        [order.scope, randomUUID(), order.event, order.contact, now],
      ),
    ),
  ).toBe('23514');
  // The source alone is not enough either: completeness is not widened.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,source_document_id)
         VALUES ($1,$2,'deposit_invoice',NULL,$3,$4,$5,$6)`,
        [
          order.scope,
          randomUUID(),
          order.event,
          order.contact,
          now,
          order.confirmation.id,
        ],
      ),
    ),
  ).toBe('23514');
  // With its source and its texts it is a legal row ...
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,source_document_id)
         VALUES ($1,$2,'deposit_invoice',NULL,$3,$4,$5,'Anzahlungsrechnung',
                 'Einleitung','Schluss',14,$6)`,
        [
          order.scope,
          randomUUID(),
          order.event,
          order.contact,
          now,
          order.confirmation.id,
        ],
      ),
    ),
  ).toBe('accepted');
  // ... and a document of another tenant can never become the source.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,source_document_id)
         VALUES ($1,$2,'deposit_invoice',NULL,$3,$4,$5,'Anzahlungsrechnung',
                 'Einleitung','Schluss',14,$6)`,
        [order.scope, randomUUID(), order.event, order.contact, now, foreignId],
      ),
    ),
  ).toBe('23503');
});

// BKP019.c2: a finalized invoice (or order confirmation) is corrected by its own
// follow-up document. The stored amounts stay magnitudes; the direction on the
// document is what turns them into a credit or a follow-up charge. Every test
// below therefore asserts both: the positive stored sum and the derived meaning.
// BKP019.d: a payment day is a tenant-local calendar day and may never lie in
// the future, so the test computes today in the tenant zone instead of pinning
// a date that would rot.
function tenantToday() {
  const [day, month, year] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(new Date())
    .split('/');
  return `${year}-${month}-${day}`;
}

async function correctableOrder(scope: string) {
  const order = await invoicedOrder(scope),
    invoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await documentNumberRepository(pool, scope).save(order.actor, 'invoice', {
    pattern: 'RE-{YYYY}-{SEQ}',
    minLength: 4,
    nextValue: 1,
  });
  const finalized = await order.repo.finalize(
    order.actor,
    invoice.id,
    invoice.version,
  );
  return { ...order, invoice: finalized };
}

async function correctionRange(
  order: Awaited<ReturnType<typeof correctableOrder>>,
) {
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'correction',
    { pattern: 'KO-{YYYY}-{SEQ}', minLength: 4, nextValue: 1 },
  );
}

// One position with an exact gross amount, so the ceiling can be tested to the
// cent instead of through a copied document.
function correctionLine(unitPriceMinor: number) {
  return [
    {
      productId: null,
      description: 'Fiktive Korrekturposition',
      quantity: 1,
      unit: 'Pauschale',
      unitPriceMinor,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
  ];
}

async function storedCorrection(scope: string, id: string) {
  return (
    await pool.query<Record<string, unknown>>(
      `SELECT kind, state, number, template_id, subject, intro_text, outro_text,
              validity_days, correction_direction, source_document_id,
              gross_minor, net_minor, tax_minor, version, offer_status,
              to_char(valid_until,'YYYY-MM-DD') AS valid_until
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

async function correctionCount(scope: string) {
  return (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM documents
        WHERE tenant_id=$1 AND kind='correction'`,
      [scope],
    )
  ).rows[0]!.count;
}

async function correctionSequence(scope: string) {
  return (
    await pool.query<{ next_value: number }>(
      'SELECT next_value FROM document_number_sequences WHERE tenant_id=$1 AND kind=$2',
      [scope, 'correction'],
    )
  ).rows[0]?.next_value;
}

test('the correction copies every position as a magnitude and links its invoice', async () => {
  const order = await correctableOrder(randomUUID()),
    correction = await order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'credit',
    ),
    stored = await storedCorrection(order.scope, correction.id);
  // 1:1 from the invoice: descriptions, quantities, units, gross prices and both
  // basis-point rates - no conversion, no negation, no second rounding.
  expect(await storedLines(order.scope, correction.id)).toEqual(
    await storedLines(order.scope, order.invoice.id),
  );
  expect(stored).toMatchObject({
    kind: 'correction',
    template_id: null,
    // Neutral in the wording: the direction stands in the document itself.
    subject: 'Rechnungskorrektur für {{contact}}',
    intro_text: confirmationTexts.introText,
    outro_text: confirmationTexts.outroText,
    validity_days: 14,
    state: 'draft',
    number: null,
    version: 1,
    correction_direction: 'credit',
    source_document_id: order.invoice.id,
    // A magnitude, not a sign: the sum of a credit note is stored positively.
    gross_minor: '52310',
    net_minor: '44429',
    tax_minor: '7881',
    // A correction is no offer: it never gets a status or a deadline.
    offer_status: null,
    valid_until: null,
  });
  expect(correction).toMatchObject({
    kind: 'correction',
    templateId: null,
    eventId: order.event,
    contactId: order.contact,
    state: 'draft',
    number: null,
    grossMinor: 52310,
  });
  expect(correction.grossMinor).toBe(order.invoice.grossMinor);
  expect(correction.grossMinor).toBe(correction.netMinor + correction.taxMinor);
  expect(
    (await order.repo.get(correction.id))!.lines.map(
      (line) => line.description,
    ),
  ).toEqual(['Fictional photo box', 'Fictional delivery']);
});

test('only a finalized invoice or confirmation is a correction source', async () => {
  const order = await invoicedOrder(randomUUID()),
    // A draft invoice can still move, so nothing may be corrected from it.
    draftInvoice = await order.repo.createInvoice(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
    );
  await expect(
    order.repo.createCorrection(
      order.actor,
      draftInvoice.id,
      draftInvoice.version,
      'credit',
    ),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // An offer is corrected through its invoice, never directly.
  await expect(
    order.repo.createCorrection(
      order.actor,
      order.offerId,
      order.version,
      'credit',
    ),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  // The finalized order confirmation is a legal source of its own.
  const fromConfirmation = await order.repo.createCorrection(
    order.actor,
    order.confirmation.id,
    order.confirmation.version,
    'credit',
  );
  expect(fromConfirmation).toMatchObject({
    kind: 'correction',
    grossMinor: 52310,
  });
  expect(
    (await storedCorrection(order.scope, fromConfirmation.id))
      .source_document_id,
  ).toBe(order.confirmation.id);
  // No chain in this slice: a correction is not the source of a correction.
  const chained = await correctableOrder(randomUUID()),
    first = await chained.repo.createCorrection(
      chained.actor,
      chained.invoice.id,
      chained.invoice.version,
      'credit',
    );
  await expect(
    chained.repo.createCorrection(
      chained.actor,
      first.id,
      first.version,
      'credit',
    ),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  // An unknown id is a missing row, never a guess.
  await expect(
    order.repo.createCorrection(order.actor, randomUUID(), 1, 'credit'),
  ).rejects.toMatchObject({ reason: 'not_found' });
  // A direction outside the closed set is refused before anything is written.
  await expect(
    order.repo.createCorrection(
      order.actor,
      order.confirmation.id,
      order.confirmation.version,
      'refund' as 'credit',
    ),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
});

test('a second open correction draft for one invoice is refused', async () => {
  const order = await correctableOrder(randomUUID()),
    first = await order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'credit',
    );
  await expect(
    order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'debit',
    ),
  ).rejects.toMatchObject({ reason: 'duplicate' });
  expect(await correctionCount(order.scope)).toBe(1);
  // A refused draft cannot burn a number, because creating never allocates one.
  expect(await correctionSequence(order.scope)).toBeUndefined();
  expect(await offerAudit(order.scope, first.id)).toEqual(['document.created']);
});

test('a credit never exceeds the invoice gross', async () => {
  const order = await correctableOrder(randomUUID());
  await correctionRange(order);
  // Two partial credit notes that add up to the invoice exactly are allowed.
  const first = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(30000),
  );
  expect(
    (await order.repo.finalize(order.actor, first.id, first.version)).number,
  ).toBe('KO-2030-0001');
  const second = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(22310),
  );
  expect(
    (await order.repo.finalize(order.actor, second.id, second.version)).number,
  ).toBe('KO-2030-0002');
  // One cent more is refused, and the draft keeps its number and its state.
  const third = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(1),
  );
  await expect(
    order.repo.finalize(order.actor, third.id, third.version),
  ).rejects.toMatchObject({ reason: 'credit_exceeds_invoice' });
  expect(await storedCorrection(order.scope, third.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
  });
  // Nothing was consumed: the next real credit still gets 0003.
  expect(
    await documentNumberRepository(pool, order.scope).preview(
      'correction',
      now,
    ),
  ).toBe('KO-2030-0003');
  // The invoice itself never moved.
  expect(await storedDocument(order.scope, order.invoice.id)).toMatchObject({
    state: 'final',
    number: 'RE-2030-0001',
    gross_minor: '52310',
  });
});

// BKP019.d: money that already arrived narrows the same ceiling. The old rule
// alone (credits <= gross) would allow the credit below, the extended rule
// (credits + payments <= gross + debits) refuses it.
test('a credit never exceeds what the payments left open', async () => {
  const order = await correctableOrder(randomUUID());
  await correctionRange(order);
  await documentPaymentRepository(pool, order.scope).record(
    order.actor,
    order.invoice.id,
    { receivedOn: tenantToday(), amountMinor: 30000, method: 'bank_transfer' },
  );
  // 523,10 - 300,00 = 223,10 may still be credited, to the cent.
  const credit = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(22310),
  );
  expect(
    (await order.repo.finalize(order.actor, credit.id, credit.version)).number,
  ).toBe('KO-2030-0001');
  // One cent more is refused although it would fit under the invoice gross.
  const over = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(1),
  );
  await expect(
    order.repo.finalize(order.actor, over.id, over.version),
  ).rejects.toMatchObject({ reason: 'credit_exceeds_invoice' });
  expect(await storedCorrection(order.scope, over.id)).toMatchObject({
    state: 'draft',
    number: null,
  });
  // Nothing was consumed by the refused draft.
  expect(
    await documentNumberRepository(pool, order.scope).preview(
      'correction',
      now,
    ),
  ).toBe('KO-2030-0002');
});

test('a debit increases the claim without a ceiling', async () => {
  const order = await correctableOrder(randomUUID());
  await correctionRange(order);
  // A follow-up charge is not limited by the invoice amount: it raises it.
  for (const expected of ['KO-2030-0001', 'KO-2030-0002']) {
    const correction = await order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'debit',
    );
    expect(
      (
        await order.repo.finalize(
          order.actor,
          correction.id,
          correction.version,
        )
      ).number,
    ).toBe(expected);
    expect(await storedCorrection(order.scope, correction.id)).toMatchObject({
      correction_direction: 'debit',
      state: 'final',
      // Still a magnitude: the direction carries the sign.
      gross_minor: '52310',
    });
  }
});

test('the correction finalizes with its own KO- number and its own PDF', async () => {
  const order = await correctableOrder(randomUUID());
  await correctionRange(order);
  const invoicePdf = await order.repo.pdf(order.invoice.id),
    confirmationPdf = await order.repo.pdf(order.confirmation.id),
    offerPdf = await order.repo.pdf(order.offerId),
    correction = await order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'credit',
    ),
    finalized = await order.repo.finalize(
      order.actor,
      correction.id,
      correction.version,
    );
  expect(finalized.number).toBe('KO-2030-0001');
  expect(await storedCorrection(order.scope, correction.id)).toMatchObject({
    state: 'final',
    number: 'KO-2030-0001',
    gross_minor: '52310',
  });
  // The invoice and everything above it keep their number, their state and
  // their bytes - a correction is a follow-up document, never an edit.
  expect(await storedDocument(order.scope, order.invoice.id)).toMatchObject({
    state: 'final',
    number: 'RE-2030-0001',
  });
  expect(
    (await order.repo.pdf(order.invoice.id)).bytes.equals(invoicePdf.bytes),
  ).toBe(true);
  expect(
    (await order.repo.pdf(order.confirmation.id)).bytes.equals(
      confirmationPdf.bytes,
    ),
  ).toBe(true);
  expect(
    (await order.repo.pdf(order.offerId)).bytes.equals(offerPdf.bytes),
  ).toBe(true);
  const correctionPdf = await order.repo.pdf(correction.id);
  expect(correctionPdf.number).toBe('KO-2030-0001');
  expect(correctionPdf.bytes.equals(invoicePdf.bytes)).toBe(false);
  // The printed page names its source and prints the signed sum, while the
  // stored sum stays positive.
  const html = order.run.rendered.at(-1)!;
  expect(html).toContain('Korrektur zu RE-2030-0001');
  expect(html).toContain('<tr><td>Rechnungsbetrag</td><td>523,10 €</td></tr>');
  expect(html).toContain(
    '<tr><td>Offene Gutschrift</td><td>-523,10 €</td></tr>',
  );
  expect(html).toContain(
    '<tr><td>Korrigierter Betrag</td><td>0,00 €</td></tr>',
  );
  expect(html).toContain('<tr><td>Brutto</td><td>-523,10 €</td></tr>');
});

test('a failing renderer rolls the correction number back', async () => {
  const order = await correctableOrder(randomUUID()),
    correction = await order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'credit',
    );
  await documentNumberRepository(pool, order.scope).save(
    order.actor,
    'correction',
    { pattern: 'KO-{YYYY}-{SEQ}', minLength: 4, nextValue: 7 },
  );
  const failing = documentRepository(pool, order.scope, {
    ...dependencies().deps,
    render: async () => {
      throw new Error('synthetic correction renderer failure');
    },
  });
  await expect(
    failing.finalize(order.actor, correction.id, correction.version),
  ).rejects.toMatchObject({ reason: 'artifact_failed' });
  expect(await storedCorrection(order.scope, correction.id)).toMatchObject({
    state: 'draft',
    number: null,
    version: 1,
  });
  expect(
    await documentNumberRepository(pool, order.scope).preview(
      'correction',
      new Date('2030-10-26T10:00:00Z'),
    ),
  ).toBe('KO-2030-0007');
});

test('the correction draft is editable, the final correction is not', async () => {
  const order = await correctableOrder(randomUUID());
  await correctionRange(order);
  const invoiceBefore = await storedDocument(order.scope, order.invoice.id),
    invoiceLines = await storedLines(order.scope, order.invoice.id),
    invoicePdf = await order.repo.pdf(order.invoice.id),
    correction = await order.repo.createCorrection(
      order.actor,
      order.invoice.id,
      order.invoice.version,
      'credit',
    ),
    edited = await order.repo.updateDraftContent(order.actor, correction.id, {
      version: correction.version,
      subject: 'Rechnungskorrektur, gekürzt',
      introText: 'Gekürzte Einleitung.',
      outroText: 'Gekürzter Schluss.',
      validityDays: 14,
      lines: correctionLine(20000),
    });
  // A correction draft owns its texts and positions, exactly like every other
  // derived draft; its direction, source and kind are not part of the edit.
  expect(edited).toMatchObject({
    kind: 'correction',
    subject: 'Rechnungskorrektur, gekürzt',
    version: correction.version + 1,
    grossMinor: 20000,
  });
  expect(await storedCorrection(order.scope, correction.id)).toMatchObject({
    correction_direction: 'credit',
    source_document_id: order.invoice.id,
  });
  expect(await storedDocument(order.scope, order.invoice.id)).toEqual(
    invoiceBefore,
  );
  expect(await storedLines(order.scope, order.invoice.id)).toEqual(
    invoiceLines,
  );
  expect(
    (await order.repo.pdf(order.invoice.id)).bytes.equals(invoicePdf.bytes),
  ).toBe(true);
  const finalized = await order.repo.finalize(
    order.actor,
    correction.id,
    edited.version,
  );
  await expect(
    order.repo.updateDraftContent(order.actor, correction.id, {
      version: finalized.version,
      subject: 'Zu spät',
      introText: '',
      outroText: '',
      validityDays: 14,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // A finalized correction is no offer either.
  await expect(
    order.repo.changeOfferStatus(order.actor, correction.id, {
      status: 'sent',
      version: finalized.version,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
});

test('a correction of another tenant, actor or unknown source is invisible', async () => {
  const order = await correctableOrder(randomUUID());
  await expect(
    documentRepository(
      pool,
      otherTenantId,
      dependencies().deps,
    ).createCorrection(
      otherActorId,
      order.invoice.id,
      order.invoice.version,
      'credit',
    ),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    order.repo.createCorrection(
      randomUUID(),
      order.invoice.id,
      order.invoice.version,
      'credit',
    ),
  ).rejects.toThrow('forbidden');
  expect(await correctionCount(order.scope)).toBe(0);
  expect(await correctionSequence(order.scope)).toBeUndefined();
});

test('two simultaneous corrections produce exactly one document', async () => {
  const order = await correctableOrder(randomUUID()),
    results = await Promise.allSettled([
      order.repo.createCorrection(
        order.actor,
        order.invoice.id,
        order.invoice.version,
        'credit',
      ),
      order.repo.createCorrection(
        order.actor,
        order.invoice.id,
        order.invoice.version,
        'debit',
      ),
    ]),
    fulfilled = results.filter((result) => result.status === 'fulfilled'),
    rejected = results.filter((result) => result.status === 'rejected');
  // The partial unique index on open drafts decides, not a \"check first\".
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    reason: 'duplicate',
  });
  expect(await correctionCount(order.scope)).toBe(1);
});

test('the database refuses a correction without source, without direction or with a foreign source', async () => {
  const order = await correctableOrder(randomUUID()),
    code = (query: Promise<unknown>) =>
      query
        .then(() => 'accepted')
        .catch((error: { code?: string }) => error.code),
    foreignId = randomUUID();
  await listRows(pool, otherTenantId, [
    {
      id: foreignId,
      templateId: otherTemplateId,
      issuedAt: '2030-10-26T10:00:00Z',
    },
  ]);
  // A correction without a source is refused even with a template.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,correction_direction)
         VALUES ($1,$2,'correction',$3,$4,$5,$6,'credit')`,
        [
          order.scope,
          randomUUID(),
          order.templateId,
          order.event,
          order.contact,
          now,
        ],
      ),
    ),
  ).toBe('23514');
  // A correction without a direction is not a document.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,source_document_id)
         VALUES ($1,$2,'correction',$3,$4,$5,$6,$7)`,
        [
          order.scope,
          randomUUID(),
          order.templateId,
          order.event,
          order.contact,
          now,
          order.invoice.id,
        ],
      ),
    ),
  ).toBe('23514');
  // No other kind carries a direction.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,source_document_id,
           correction_direction)
         VALUES ($1,$2,'invoice',$3,$4,$5,$6,$7,'credit')`,
        [
          order.scope,
          randomUUID(),
          order.templateId,
          order.event,
          order.contact,
          now,
          order.confirmation.id,
        ],
      ),
    ),
  ).toBe('23514');
  // A blank correction without a template keeps the old blank-document rule.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,subject,intro_text,
           outro_text,validity_days,correction_direction)
         VALUES ($1,$2,'correction',NULL,$3,$4,$5,'Rechnungskorrektur','','',14,'credit')`,
        [order.scope, randomUUID(), order.event, order.contact, now],
      ),
    ),
  ).toBe('23514');
  // A document of another tenant can never become the source.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,source_document_id,
           correction_direction)
         VALUES ($1,$2,'correction',$3,$4,$5,$6,$7,'credit')`,
        [
          order.scope,
          randomUUID(),
          order.templateId,
          order.event,
          order.contact,
          now,
          foreignId,
        ],
      ),
    ),
  ).toBe('23503');
  // The same row with this tenant's invoice is legal.
  expect(
    await code(
      pool.query(
        `INSERT INTO documents
          (tenant_id,id,kind,template_id,event_id,contact_id,issued_at,source_document_id,
           correction_direction)
         VALUES ($1,$2,'correction',$3,$4,$5,$6,$7,'credit')`,
        [
          order.scope,
          randomUUID(),
          order.templateId,
          order.event,
          order.contact,
          now,
          order.invoice.id,
        ],
      ),
    ),
  ).toBe('accepted');
});

test('the projection derives the cancellation state and the remaining credit', async () => {
  const order = await correctableOrder(randomUUID());
  await correctionRange(order);
  const listed = async () =>
      (await order.repo.list({ include: 'offer' })) as DocumentOfferRow[],
    invoiceRow = async () =>
      (await listed()).find((row) => row.id === order.invoice.id)!;
  // Nothing credited yet: the invoice names its confirmation and stays open.
  expect(await invoiceRow()).toMatchObject({
    kind: 'invoice',
    sourceDocumentId: order.confirmation.id,
    sourceNumber: 'AB-2030-0001',
    correctionDirection: null,
    correctionState: 'none',
    remainingCredit: 52310,
  });
  // A draft correction changes nothing: only finalized credit notes count.
  const partial = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(20000),
  );
  expect(await invoiceRow()).toMatchObject({
    correctionState: 'none',
    remainingCredit: 52310,
  });
  // The correction row carries its own direction and no source state.
  expect((await listed()).find((row) => row.id === partial.id)).toMatchObject({
    kind: 'correction',
    correctionDirection: 'credit',
    correctionState: null,
    remainingCredit: null,
    sourceDocumentId: order.invoice.id,
    sourceNumber: 'RE-2030-0001',
  });
  await order.repo.finalize(order.actor, partial.id, partial.version);
  expect(await invoiceRow()).toMatchObject({
    correctionState: 'partial',
    remainingCredit: 32310,
  });
  const full = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'credit',
    correctionLine(32310),
  );
  await order.repo.finalize(order.actor, full.id, full.version);
  // RG-08 reads \"storniert\" without a stored status on the invoice: the state
  // is derived from the credit notes and the invoice keeps its own bytes.
  expect(await invoiceRow()).toMatchObject({
    state: 'final',
    correctionState: 'full',
    remainingCredit: 0,
  });
  // A debit never reduces the creditable remainder.
  const debit = await order.repo.createCorrection(
    order.actor,
    order.invoice.id,
    order.invoice.version,
    'debit',
    correctionLine(500),
  );
  await order.repo.finalize(order.actor, debit.id, debit.version);
  expect(await invoiceRow()).toMatchObject({
    correctionState: 'full',
    remainingCredit: 0,
  });
});

test('the correction route validates auth, body, direction and duplicates', async () => {
  const order = await correctableOrder(randomUUID()),
    granted = (await accessRepository(pool, order.scope).list())[0]!;
  await accessRepository(pool, order.scope).issueSession(
    { subject: 'seed-' + order.scope, email: granted.email },
    digest('synthetic-correction'),
  );
  const config = {
      origin: site,
      tenantId: order.scope,
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
  registerDocumentRoutes(app, pool, order.scope, order.run.deps);
  const url = '/api/v1/documents/' + order.invoice.id + '/correction',
    cookies = { '__Host-ak-session': 'synthetic-correction' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-correction'),
    },
    post = (payload: Record<string, unknown>, secured = true) =>
      app.inject({
        method: 'POST',
        url,
        cookies,
        ...(secured ? { headers } : {}),
        payload,
      });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { version: order.invoice.version, direction: 'credit' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await post(
          { version: order.invoice.version, direction: 'credit' },
          false,
        )
      ).statusCode,
    ).toBe(403);
    // Fastify's schema refuses a missing or unknown direction before the domain
    // sees the body, and a non-integer version with it.
    for (const payload of [
      {},
      { version: order.invoice.version },
      { version: order.invoice.version, direction: 'refund' },
      { version: 0, direction: 'credit' },
      { version: 1.5, direction: 'credit' },
    ])
      expect((await post(payload)).statusCode, JSON.stringify(payload)).toBe(
        400,
      );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + randomUUID() + '/correction',
          cookies,
          headers,
          payload: { version: 1, direction: 'credit' },
        })
      ).statusCode,
    ).toBe(404);
    // A stale version is a conflict before anything is copied.
    expect((await post({ version: 1, direction: 'credit' })).statusCode).toBe(
      409,
    );
    expect((await post({ version: 1, direction: 'credit' })).json()).toEqual({
      error: 'conflict',
    });
    const created = await post({
      version: order.invoice.version,
      direction: 'credit',
    });
    expect(created.statusCode).toBe(201);
    const single = await app.inject({
      url: '/api/v1/documents/' + (created.json() as { id: string }).id,
      cookies,
    });
    expect(Object.keys(created.json() as object).sort()).toEqual(
      Object.keys(single.json() as object).sort(),
    );
    expect(created.json()).toMatchObject({
      kind: 'correction',
      state: 'draft',
      number: null,
      templateId: null,
      subject: 'Rechnungskorrektur für {{contact}}',
      grossMinor: 52310,
    });
    // The create answer keeps the old document shape: the projection, not this
    // route, names the direction and the source.
    expect(created.body).not.toContain('correctionDirection');
    expect(created.body).not.toContain('correctionState');
    const again = await post({
      version: order.invoice.version,
      direction: 'debit',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'duplicate' });
    expect(await correctionCount(order.scope)).toBe(1);
  } finally {
    await app.close();
  }
});

test('a correction template no longer creates a draft', async () => {
  const context = await confirmationContext(randomUUID()),
    template = await documentTemplateRepository(pool, context.scope).save(
      context.actor,
      {
        kind: 'correction',
        name: 'Fiktive Korrekturvorlage',
        subject: 'Rechnungskorrektur für {{contact}}',
        introText: '',
        outroText: '',
        validityDays: 14,
        state: 'active',
        positions: confirmationLines,
      },
    );
  // A correction only exists with a source. The template path is refused with a
  // clear reason instead of running into the database CHECK.
  await expect(
    context.repo.createDraft(context.actor, {
      templateId: template.id,
      eventId: context.event,
      contactId: context.contact,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_kind' });
  expect(await correctionCount(context.scope)).toBe(0);
  // The template stays manageable, so an operator sees why it exists.
  expect(
    (await documentTemplateRepository(pool, context.scope).list()).some(
      (row) => row.id === template.id,
    ),
  ).toBe(true);
});
