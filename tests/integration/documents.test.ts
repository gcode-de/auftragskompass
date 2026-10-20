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
  await documentLayoutRepository(pool, tenantId).save(actorId, {
    senderName: 'Fictional Studio',
    senderStreet: 'Synthetic Street 1',
    senderPostalCode: '12345',
    senderCity: 'Fictional Town',
    primaryColor: '#2f6f4f',
    textColor: '#1b1b1b',
    fontFamily: 'sans',
    showPageNumbers: true,
    showPositionNumbers: true,
  });
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
  expect(draft).toMatchObject({
    kind: 'offer',
    state: 'draft',
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
  registerDocumentRoutes(app, pool, tenantId, dependencies().deps);
  const cookies = { '__Host-ak-session': 'synthetic-documents' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-documents'),
    };
  try {
    expect(
      (await app.inject('/api/v1/documents/' + randomUUID())).statusCode,
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
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents/' + id + '/finalize',
          cookies,
          headers,
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
    const pdf = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + id + '/pdf',
      cookies,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('.pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
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
