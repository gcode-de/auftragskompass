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
  type DocumentDraftContent,
} from '../../packages/core/src/documents.js';
import {
  documentPaymentRepository,
  paymentBalance,
} from '../../packages/core/src/document-payments.js';
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

// DOC-PRODUCT-01.5: one discount for the whole document - a rate in basis points
// or a fixed amount, with one optional note. It never touches a position, a tax
// group or the stored net/tax/gross: it only lowers the amount the document asks
// for. Everything below proves the same claim from three sides - the stored row,
// the printed bytes and the payment balance - because a second arithmetic would
// be a second truth.

let container: StartedPostgreSqlContainer, pool: Pool;
const site = 'https://admin.example.invalid',
  // One fixed document clock: numbers, issue days and rendered dates are
  // deterministic. The payment clock stays real ("not in the future").
  documentNow = new Date('2030-10-26T10:00:00Z');

function memoryStore(): StorageAdapter {
  const files = new Map<string, Buffer>();
  return {
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
}

// A tenant-local calendar day, so a payment is judged against the tenant's today.
function tenantDay(offsetDays = 0): string {
  const [day, month, year] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(new Date(Date.now() + offsetDays * 86_400_000))
    .split('/');
  return `${year}-${month}-${day}`;
}

type Tenant = {
  id: string;
  actor: string;
  contact: string;
  event: string;
  templateId: string;
  rendered: string[];
  repo: ReturnType<typeof documentRepository>;
  payments: ReturnType<typeof documentPaymentRepository>;
};

// A tenant with everything a document needs: contact, event, one offer template
// whose two positions sum to 249,00 EUR, all number circles and one layout.
async function seedTenant(label: string): Promise<Tenant> {
  const id = randomUUID();
  await bootstrapAccess(
    pool,
    id,
    `${label}@example.invalid`,
    `Synthetic ${label}`,
    'Europe/Berlin',
  );
  await accessRepository(pool, id).issueSession(
    { subject: label, email: `${label}@example.invalid` },
    digest(`synthetic-${label}`),
  );
  const actor = (await accessRepository(pool, id).list())[0]!.userId!,
    contact = randomUUID(),
    event = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Discount Customer','Robin Example','Example Street 5',
      '12345','Fictional Town','DE','discount@example.invalid','','','','','active',1)`,
    [id, contact],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Discount Wedding','inquiry',NULL,NULL,NULL,'synthetic','2030-11-14',
      NULL,NULL,'Europe/Berlin','','',1)`,
    [id, event],
  );
  const templateId = (
    await documentTemplateRepository(pool, id).save(actor, {
      kind: 'offer',
      name: 'Fictional discount offer',
      subject: 'Angebot für {{contact}}',
      introText: 'Synthetische Feier am {{date}}.',
      outroText: 'Gesamt {{total}}.',
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
    })
  ).id as string;
  for (const [kind, pattern] of [
    ['offer', 'AN-{YYYY}-{SEQ}'],
    ['order_confirmation', 'AB-{YYYY}-{SEQ}'],
    ['deposit_invoice', 'AZ-{YYYY}-{SEQ}'],
    ['invoice', 'RE-{YYYY}-{SEQ}'],
    ['correction', 'KO-{YYYY}-{SEQ}'],
  ] as const)
    await documentNumberRepository(pool, id).save(actor, kind, {
      pattern,
      minLength: 4,
      nextValue: 1,
    });
  const store = memoryStore();
  await documentLayoutRepository(pool, id, store).save(actor, {
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
  const rendered: string[] = [];
  return {
    id,
    actor,
    contact,
    event,
    templateId,
    rendered,
    repo: documentRepository(pool, id, {
      origin: site,
      store,
      now: () => documentNow,
      render: async (html: string) => {
        rendered.push(html);
        return Buffer.from('%PDF-1.4 synthetic ' + html.length);
      },
    }),
    payments: documentPaymentRepository(pool, id),
  };
}

const baseContent = {
  subject: 'Angebot für {{contact}}',
  introText: 'Synthetische Feier am {{date}}.',
  outroText: 'Gesamt {{total}}.',
  validityDays: 14,
};

// A fresh draft of the 249,00 EUR template, optionally with the one document
// discount under test.
async function draftOf(
  tenant: Tenant,
  discount?: {
    kind: 'percent' | 'amount' | null;
    value?: number | null;
    note?: string | null;
  },
  content: Partial<DocumentDraftContent> = {},
) {
  const draft = await tenant.repo.createDraft(tenant.actor, {
    templateId: tenant.templateId,
    eventId: tenant.event,
    contactId: tenant.contact,
  });
  return tenant.repo.updateDraftContent(tenant.actor, draft.id, {
    version: draft.version,
    ...baseContent,
    ...(discount
      ? {
          totalDiscountKind: discount.kind,
          totalDiscountValue: discount.value ?? null,
          totalDiscountNote: discount.note ?? null,
        }
      : {}),
    ...content,
  });
}

// The accepted offer a follow-up document is copied from.
async function acceptedOffer(
  tenant: Tenant,
  discount?: Parameters<typeof draftOf>[1],
) {
  const draft = await draftOf(tenant, discount),
    offer = await tenant.repo.finalize(tenant.actor, draft.id, draft.version),
    sent = await tenant.repo.changeOfferStatus(tenant.actor, offer.id, {
      status: 'sent',
      version: offer.version,
    });
  return tenant.repo.changeOfferStatus(tenant.actor, offer.id, {
    status: 'accepted',
    version: sent.version,
    channel: 'email',
  });
}

async function storedDiscount(scope: string, id: string) {
  return (
    await pool.query<{
      kind: string | null;
      value: string | null;
      note: string | null;
      gross: string;
      net: string;
      tax: string;
      version: number;
      hash: string | null;
      state: string;
    }>(
      `SELECT total_discount_kind AS kind, total_discount_value::text AS value,
              total_discount_note AS note, gross_minor::text AS gross,
              net_minor::text AS net, tax_minor::text AS tax, version,
              snapshot_hash AS hash, state
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

// The two axes that live only in the reviewed-SQL projection, read straight
// from the row: the single-document answer never carried them.
async function storedAxes(scope: string, id: string) {
  return (
    await pool.query<{
      role: string | null;
      applied: string | null;
      direction: string | null;
    }>(
      `SELECT invoice_role AS role, deposit_applied_minor::text AS applied,
              correction_direction AS direction
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

// The one printed final line, read back from the bytes: the paper must name the
// same amount the payment balance derives.
function printedPayable(html: string): number | null {
  const match = html.match(
    /Zu zahlender Betrag<\/td><td>(-?\d{1,3}(?:\.\d{3})*|\d+),(\d\d) €/,
  );
  if (!match) return null;
  const magnitude =
    Number(match[1]!.replace(/\./g, '')) * 100 + Number(match[2]);
  return match[1]!.startsWith('-') ? -magnitude : magnitude;
}

let alpha: Tenant, beta: Tenant;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  alpha = await seedTenant('discount-alpha');
  beta = await seedTenant('discount-beta');
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('a discount is stored as one decision on the row, never on a position', async () => {
  const draft = await draftOf(alpha, {
    kind: 'percent',
    value: 1000,
    note: 'Treuerabatt',
  });
  expect(draft).toMatchObject({
    state: 'draft',
    // The stored sums are the position sums - the discount changes neither.
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
    totalDiscountNote: 'Treuerabatt',
  });
  expect(draft.lines.map((line) => line.description)).toEqual([
    'Fictional box',
    'Fictional delivery',
  ]);
  expect(await storedDiscount(alpha.id, draft.id)).toMatchObject({
    kind: 'percent',
    value: '1000',
    note: 'Treuerabatt',
    gross: '24900',
    net: '20925',
    tax: '3975',
  });
  // The draft preview is the same paper the finalization will print.
  await alpha.repo.preview(draft.id);
  const html = alpha.rendered.at(-1)!;
  expect(html).toContain(
    '<tr><td>Gesamtrabatt (Treuerabatt)</td><td>-24,90 €</td></tr>',
  );
  expect(html).toContain(
    '<tr><td>Zu zahlender Betrag</td><td>224,10 €</td></tr>',
  );
  // The sum block itself keeps every position figure.
  expect(html).toContain('<td>Brutto</td><td>249,00 €</td>');
  expect(html).toContain('<td>Netto</td><td>209,25 €</td>');
});

test('a fixed amount is stored without inventing a note', async () => {
  const draft = await draftOf(alpha, { kind: 'amount', value: 2000 });
  expect(draft).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 2000,
    // Absent note stays absent, never an empty string.
    totalDiscountNote: null,
  });
  await alpha.repo.preview(draft.id);
  const html = alpha.rendered.at(-1)!;
  expect(html).toContain('<tr><td>Gesamtrabatt</td><td>-20,00 €</td></tr>');
  expect(html).toContain(
    '<tr><td>Zu zahlender Betrag</td><td>229,00 €</td></tr>',
  );
});

test('an amount equal to the gross is allowed; one cent more is refused unclamped', async () => {
  const full = await draftOf(alpha, { kind: 'amount', value: 24900 });
  expect(full.totalDiscountValue).toBe(24900);
  await alpha.repo.preview(full.id);
  const html = alpha.rendered.at(-1)!;
  expect(html).toContain('<tr><td>Gesamtrabatt</td><td>-249,00 €</td></tr>');
  expect(html).toContain(
    '<tr><td>Zu zahlender Betrag</td><td>0,00 €</td></tr>',
  );
  const before = await storedDiscount(alpha.id, full.id);
  await expect(
    alpha.repo.updateDraftContent(alpha.actor, full.id, {
      version: full.version,
      ...baseContent,
      totalDiscountKind: 'amount',
      totalDiscountValue: 24901,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  // A refusal writes nothing: no clamped zero, no new version, no new bytes.
  expect(await storedDiscount(alpha.id, full.id)).toEqual(before);
  // Shrinking the positions below a stored amount is refused on the same rule,
  // so no draft can ever hold a deduction above its own sum.
  await expect(
    alpha.repo.updateDraftContent(alpha.actor, full.id, {
      version: full.version,
      ...baseContent,
      lines: [
        {
          productId: null,
          description: 'Fictional smaller box',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 1000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  const unchanged = (await alpha.repo.get(full.id))!;
  expect(unchanged.lines).toHaveLength(2);
  expect(unchanged.grossMinor).toBe(24900);
  expect(unchanged).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 24900,
  });
});

test('a rate is rounded once, half away from zero, like the stored claim', async () => {
  const draft = await draftOf(alpha, { kind: 'percent', value: 1250 });
  // 24900 * 12,5 % = 3112,5 -> 3113; the payable is the difference, not a
  // second rounding of 24900.
  await alpha.repo.preview(draft.id);
  const html = alpha.rendered.at(-1)!;
  expect(html).toContain('<tr><td>Gesamtrabatt</td><td>-31,13 €</td></tr>');
  expect(html).toContain(
    '<tr><td>Zu zahlender Betrag</td><td>217,87 €</td></tr>',
  );
  const finalized = await alpha.repo.finalize(
    alpha.actor,
    draft.id,
    draft.version,
  );
  expect((await paymentBalance(pool, alpha.id, finalized.id)).claimMinor).toBe(
    21787,
  );
});

test('the note is trimmed, bounded and free of control characters', async () => {
  const trimmed = await draftOf(alpha, {
    kind: 'percent',
    value: 1000,
    note: '  Treuerabatt \r\n zweite Zeile  ',
  });
  expect(trimmed.totalDiscountNote).toBe('Treuerabatt \n zweite Zeile');
  const blank = await draftOf(alpha, {
    kind: 'percent',
    value: 1000,
    note: '   ',
  });
  expect(blank.totalDiscountNote).toBeNull();
  const longest = await draftOf(alpha, {
    kind: 'amount',
    value: 1,
    note: 'a'.repeat(500),
  });
  expect(longest.totalDiscountNote).toBe('a'.repeat(500));
  await expect(
    draftOf(alpha, { kind: 'amount', value: 1, note: 'a'.repeat(501) }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    draftOf(alpha, { kind: 'amount', value: 1, note: 'Treuerabatt\u0007' }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  // A note without a discount is meaningless and never stored alone.
  await expect(
    draftOf(alpha, { kind: null, value: null, note: 'Nur eine Notiz' }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
});

test('a lone half of the decision is refused instead of guessed', async () => {
  await expect(
    draftOf(alpha, { kind: 'percent', value: null }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    draftOf(alpha, { kind: null, value: 1000 }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    draftOf(alpha, {
      kind: 'rate' as unknown as 'percent',
      value: 1000,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    draftOf(alpha, { kind: 'percent', value: 10001 }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    draftOf(alpha, { kind: 'amount', value: -1 }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    draftOf(alpha, { kind: 'amount', value: 10.5 }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  // An omitted discount keeps the stored one; only an explicit null clears it.
  const set = await draftOf(alpha, { kind: 'amount', value: 1000 });
  const kept = await alpha.repo.updateDraftContent(alpha.actor, set.id, {
    version: set.version,
    ...baseContent,
  });
  expect(kept).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 1000,
  });
  const cleared = await alpha.repo.updateDraftContent(alpha.actor, set.id, {
    version: kept.version,
    ...baseContent,
    totalDiscountKind: null,
    totalDiscountValue: null,
    totalDiscountNote: null,
  });
  expect(cleared).not.toHaveProperty('totalDiscountKind');
  expect(cleared).not.toHaveProperty('totalDiscountValue');
  expect(cleared).not.toHaveProperty('totalDiscountNote');
  expect(await storedDiscount(alpha.id, set.id)).toMatchObject({
    kind: null,
    value: null,
    note: null,
  });
});

test('finalization freezes the discount and leaves no later write path', async () => {
  const draft = await draftOf(alpha, {
      kind: 'percent',
      value: 1000,
      note: 'Treuerabatt',
    }),
    final = await alpha.repo.finalize(alpha.actor, draft.id, draft.version);
  expect(final).toMatchObject({
    state: 'final',
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
    totalDiscountNote: 'Treuerabatt',
    // The frozen sums stay the position sums.
    grossMinor: 24900,
  });
  const row = await storedDiscount(alpha.id, final.id);
  expect(row).toMatchObject({
    kind: 'percent',
    value: '1000',
    note: 'Treuerabatt',
    gross: '24900',
    state: 'final',
  });
  expect(row.hash).toBe(final.snapshotHash);
  await expect(
    alpha.repo.updateDraftContent(alpha.actor, final.id, {
      version: final.version,
      ...baseContent,
      totalDiscountKind: 'amount',
      totalDiscountValue: 100,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // Nothing moved: same columns, same hash, same version.
  expect(await storedDiscount(alpha.id, final.id)).toEqual(row);
  const balance = await paymentBalance(pool, alpha.id, final.id);
  expect(balance.grossMinor).toBe(24900);
  expect(balance.claimMinor).toBe(22410);
  expect(balance.openMinor).toBe(22410);
});

test('a document without a discount keeps its exact bytes and its old keys', async () => {
  const plain = await draftOf(alpha),
    twice = await draftOf(alpha);
  expect(plain).not.toHaveProperty('totalDiscountKind');
  expect(plain).not.toHaveProperty('totalDiscountValue');
  expect(plain).not.toHaveProperty('totalDiscountNote');
  // Two drafts of the same content and layout: identical preview bytes (the
  // preview is numbered `VORSCHAU`, so no issue number can mask a difference).
  await alpha.repo.preview(plain.id);
  const firstHtml = alpha.rendered.at(-1)!;
  await alpha.repo.preview(twice.id);
  expect(alpha.rendered.at(-1)).toBe(firstHtml);
  expect(firstHtml).not.toContain('Gesamtrabatt');
  expect(firstHtml).not.toContain('Zu zahlender Betrag');
  const first = await alpha.repo.finalize(alpha.actor, plain.id, plain.version);
  expect(first.snapshotHash).not.toBeNull();
  // Clearing a stored discount returns the document to exactly those bytes.
  const once = await draftOf(alpha, {
      kind: 'percent',
      value: 1000,
      note: 'Zwischenstand',
    }),
    cleared = await alpha.repo.updateDraftContent(alpha.actor, once.id, {
      version: once.version,
      ...baseContent,
      totalDiscountKind: null,
      totalDiscountValue: null,
    });
  await alpha.repo.preview(cleared.id);
  expect(alpha.rendered.at(-1)).toBe(firstHtml);
  const again = await alpha.repo.finalize(
    alpha.actor,
    cleared.id,
    cleared.version,
  );
  expect((await paymentBalance(pool, alpha.id, again.id)).claimMinor).toBe(
    24900,
  );
});

test('a rate above the whole document is refused, the database repeats it', async () => {
  const draft = await draftOf(alpha, { kind: 'percent', value: 10000 });
  // 100 % is the whole document; the payable is exactly zero, not negative.
  await alpha.repo.preview(draft.id);
  expect(alpha.rendered.at(-1)).toContain(
    '<tr><td>Zu zahlender Betrag</td><td>0,00 €</td></tr>',
  );
  // The CHECKs of 0063 are the second line of defence for direct writers.
  for (const [columns, constraint] of [
    [
      "total_discount_kind='percent', total_discount_value=NULL",
      'documents_total_discount_pair_check',
    ],
    [
      "total_discount_kind='rate', total_discount_value=100",
      'documents_total_discount_kind_check',
    ],
    [
      "total_discount_kind='percent', total_discount_value=10001",
      'documents_total_discount_percent_check',
    ],
    [
      "total_discount_kind='amount', total_discount_value=-1",
      'documents_total_discount_value_check',
    ],
    [
      "total_discount_kind=NULL, total_discount_value=NULL, total_discount_note='Note ohne Rabatt'",
      'documents_total_discount_note_check',
    ],
    ["total_discount_note='  Rand  '", 'documents_total_discount_note_check'],
  ] as const)
    await expect(
      pool.query(
        `UPDATE documents SET ${columns} WHERE tenant_id=$1 AND id=$2`,
        [alpha.id, draft.id],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint });
});

test('the route answers 400 for an unpayable discount and keeps the draft', async () => {
  const config = {
      origin: site,
      tenantId: alpha.id,
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
  registerDocumentRoutes(app, pool, alpha.id, {
    origin: site,
    store: memoryStore(),
    now: () => documentNow,
    render: async (html: string) => Buffer.from('%PDF-1.4 synthetic ' + html),
  });
  const cookies = { '__Host-ak-session': 'synthetic-discount-alpha' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-discount-alpha'),
    },
    draft = await draftOf(alpha);
  try {
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${draft.id}/draft`,
      cookies,
      headers,
      payload: {
        ...baseContent,
        version: draft.version,
        totalDiscountKind: 'percent',
        totalDiscountValue: 1000,
        totalDiscountNote: 'Treuerabatt',
      },
    });
    expect(saved.statusCode).toBe(200);
    // The answer names what the editor must show again after a reload.
    expect(saved.json()).toMatchObject({
      totalDiscountKind: 'percent',
      totalDiscountValue: 1000,
      totalDiscountNote: 'Treuerabatt',
      grossMinor: 24900,
    });
    const overSum = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${draft.id}/draft`,
      cookies,
      headers,
      payload: {
        ...baseContent,
        version: saved.json().version,
        totalDiscountKind: 'amount',
        totalDiscountValue: 24901,
      },
    });
    expect(overSum.statusCode).toBe(400);
    expect(overSum.json()).toEqual({ error: 'invalid_content' });
    // A malformed kind is a schema refusal, a lone half is a domain refusal.
    const malformed = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${draft.id}/draft`,
      cookies,
      headers,
      payload: {
        ...baseContent,
        version: saved.json().version,
        totalDiscountKind: 'rate',
        totalDiscountValue: 100,
      },
    });
    expect(malformed.statusCode).toBe(400);
    const loneHalf = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${draft.id}/draft`,
      cookies,
      headers,
      payload: {
        ...baseContent,
        version: saved.json().version,
        totalDiscountKind: 'percent',
      },
    });
    expect(loneHalf.statusCode).toBe(400);
    expect(loneHalf.json()).toEqual({ error: 'invalid_content' });
    // Every refusal left the stored decision of the successful write alone.
    expect(await storedDiscount(alpha.id, draft.id)).toMatchObject({
      kind: 'percent',
      value: '1000',
      note: 'Treuerabatt',
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${draft.id}`,
          cookies,
        })
      ).json(),
    ).toMatchObject({
      totalDiscountKind: 'percent',
      totalDiscountValue: 1000,
      totalDiscountNote: 'Treuerabatt',
    });
  } finally {
    await app.close();
  }
});

test('an order confirmation and its invoice carry the offered discount', async () => {
  const offer = await acceptedOffer(alpha, {
      kind: 'percent',
      value: 1000,
      note: 'Treuerabatt',
    }),
    confirmationDraft = await alpha.repo.createOrderConfirmation(
      alpha.actor,
      offer.id,
      offer.version,
    );
  expect(confirmationDraft).toMatchObject({
    kind: 'order_confirmation',
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
    totalDiscountNote: 'Treuerabatt',
    grossMinor: 24900,
  });
  const confirmation = await alpha.repo.finalize(
      alpha.actor,
      confirmationDraft.id,
      confirmationDraft.version,
    ),
    invoiceDraft = await alpha.repo.createInvoice(
      alpha.actor,
      confirmation.id,
      confirmation.version,
    );
  expect(invoiceDraft).toMatchObject({
    kind: 'invoice',
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
    totalDiscountNote: 'Treuerabatt',
  });
  const invoice = await alpha.repo.finalize(
    alpha.actor,
    invoiceDraft.id,
    invoiceDraft.version,
  );
  expect(invoice).toMatchObject({
    state: 'final',
    grossMinor: 24900,
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
  });
  const html = alpha.rendered.at(-1)!;
  expect(html).toContain(
    '<tr><td>Gesamtrabatt (Treuerabatt)</td><td>-24,90 €</td></tr>',
  );
  expect(printedPayable(html)).toBe(22410);
  // The paper and the balance name the same claim - one rule, no side path.
  expect((await paymentBalance(pool, alpha.id, invoice.id)).claimMinor).toBe(
    22410,
  );
});

test('a deposit and a final invoice settle on the discounted claims', async () => {
  const offer = await acceptedOffer(beta, {
      kind: 'percent',
      value: 1000,
    }),
    confirmationDraft = await beta.repo.createOrderConfirmation(
      beta.actor,
      offer.id,
      offer.version,
    ),
    confirmation = await beta.repo.finalize(
      beta.actor,
      confirmationDraft.id,
      confirmationDraft.version,
    ),
    depositDraft = await beta.repo.createDepositInvoice(
      beta.actor,
      confirmation.id,
      confirmation.version,
    ),
    // The operator reduces the copied order to the agreed advance; the copied
    // ten percent stay on the deposit, so its claim is 90,00 EUR of 100,00 EUR.
    deposit = await beta.repo.updateDraftContent(beta.actor, depositDraft.id, {
      version: depositDraft.version,
      ...baseContent,
      lines: [
        {
          productId: null,
          description: 'Fictional advance',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 10000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    }),
    finalizedDeposit = await beta.repo.finalize(
      beta.actor,
      deposit.id,
      deposit.version,
    );
  expect(finalizedDeposit).toMatchObject({
    kind: 'deposit_invoice',
    grossMinor: 10000,
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
  });
  expect(
    (await paymentBalance(pool, beta.id, finalizedDeposit.id)).claimMinor,
  ).toBe(9000);
  const finalDraft = await beta.repo.createFinalInvoice(
      beta.actor,
      confirmation.id,
      confirmation.version,
    ),
    finalInvoice = await beta.repo.finalize(
      beta.actor,
      finalDraft.id,
      finalDraft.version,
    );
  expect(finalInvoice).toMatchObject({
    kind: 'invoice',
    grossMinor: 24900,
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
  });
  // The role and the frozen deduction live in the opt-in projection; the row is
  // what the claim reads, so it is asserted directly.
  expect(await storedAxes(beta.id, finalInvoice.id)).toMatchObject({
    role: 'final',
    applied: '9000',
  });
  const html = beta.rendered.at(-1)!;
  // One printed payable line: the discounted order minus the discounted advance.
  expect(html.match(/Zu zahlender Betrag/g)).toHaveLength(1);
  expect(printedPayable(html)).toBe(13410);
  expect(
    (await paymentBalance(pool, beta.id, finalInvoice.id)).claimMinor,
  ).toBe(13410);
});

test('a credit note is bounded by the discounted claim, not by the gross', async () => {
  const offer = await acceptedOffer(beta, { kind: 'percent', value: 1000 }),
    confirmationDraft = await beta.repo.createOrderConfirmation(
      beta.actor,
      offer.id,
      offer.version,
    ),
    confirmation = await beta.repo.finalize(
      beta.actor,
      confirmationDraft.id,
      confirmationDraft.version,
    ),
    invoiceDraft = await beta.repo.createInvoice(
      beta.actor,
      confirmation.id,
      confirmation.version,
    ),
    invoice = await beta.repo.finalize(
      beta.actor,
      invoiceDraft.id,
      invoiceDraft.version,
    );
  // A credit of the full stored gross would be more than the invoice asks for;
  // the copied discount makes the first credit exactly acceptable.
  const creditDraft = await beta.repo.createCorrection(
      beta.actor,
      invoice.id,
      invoice.version,
      'credit',
    ),
    credit = await beta.repo.finalize(
      beta.actor,
      creditDraft.id,
      creditDraft.version,
    );
  expect(credit).toMatchObject({
    totalDiscountKind: 'percent',
    totalDiscountValue: 1000,
  });
  expect(await storedAxes(beta.id, credit.id)).toMatchObject({
    direction: 'credit',
  });
  const balance = await paymentBalance(pool, beta.id, invoice.id);
  expect(balance.creditedMinor).toBe(22410);
  expect(balance.claimMinor).toBe(0);
  // Without the discount the same credit note exceeds the claim and is refused.
  const secondDraft = await beta.repo.createCorrection(
      beta.actor,
      invoice.id,
      invoice.version,
      'credit',
      [
        {
          productId: null,
          description: 'Fictional box',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 24900,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    ),
    undiscounted = await beta.repo.updateDraftContent(
      beta.actor,
      secondDraft.id,
      {
        version: secondDraft.version,
        ...baseContent,
        totalDiscountKind: null,
        totalDiscountValue: null,
      },
    );
  await expect(
    beta.repo.finalize(beta.actor, undiscounted.id, undiscounted.version),
  ).rejects.toMatchObject({ reason: 'credit_exceeds_invoice' });
});

test('the open amount and the overpayment guard use the discounted payable', async () => {
  const offer = await acceptedOffer(beta, { kind: 'amount', value: 2000 }),
    confirmationDraft = await beta.repo.createOrderConfirmation(
      beta.actor,
      offer.id,
      offer.version,
    ),
    confirmation = await beta.repo.finalize(
      beta.actor,
      confirmationDraft.id,
      confirmationDraft.version,
    ),
    invoiceDraft = await beta.repo.createInvoice(
      beta.actor,
      confirmation.id,
      confirmation.version,
    ),
    invoice = await beta.repo.finalize(
      beta.actor,
      invoiceDraft.id,
      invoiceDraft.version,
    ),
    balance = await paymentBalance(pool, beta.id, invoice.id);
  expect(balance).toMatchObject({
    grossMinor: 24900,
    claimMinor: 22900,
    paidMinor: 0,
    openMinor: 22900,
  });
  await expect(
    beta.payments.record(beta.actor, invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 22901,
      method: 'bank_transfer',
    }),
  ).rejects.toMatchObject({ reason: 'overpaid' });
  const paid = await beta.payments.record(beta.actor, invoice.id, {
    receivedOn: tenantDay(),
    amountMinor: 22900,
    method: 'bank_transfer',
  });
  expect(paid.amountMinor).toBe(22900);
  expect(await paymentBalance(pool, beta.id, invoice.id)).toMatchObject({
    claimMinor: 22900,
    paidMinor: 22900,
    openMinor: 0,
  });
});

test('another tenant neither reads nor changes a discount', async () => {
  const draft = await draftOf(alpha, { kind: 'amount', value: 500 }),
    foreign = await beta.repo.get(draft.id);
  expect(foreign).toBeNull();
  await expect(
    beta.repo.updateDraftContent(beta.actor, draft.id, {
      version: draft.version,
      ...baseContent,
      totalDiscountKind: 'amount',
      totalDiscountValue: 1,
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(paymentBalance(pool, beta.id, draft.id)).rejects.toMatchObject({
    reason: 'not_found',
  });
  expect((await beta.repo.list()).some((row) => row.id === draft.id)).toBe(
    false,
  );
  // The owning tenant still reads exactly what it wrote.
  expect(await alpha.repo.get(draft.id)).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 500,
  });
});

test('documents written before 0063 keep their sums, their claim and their bytes', async () => {
  await pool.query('CREATE DATABASE synthetic_total_discount_upgrade');
  const url = new URL(container.getConnectionUri());
  url.pathname = '/synthetic_total_discount_upgrade';
  const upgrade = new Pool({ connectionString: url.href });
  try {
    const directory = new URL(
        '../../packages/core/migrations/',
        import.meta.url,
      ),
      names = (await readdir(directory))
        .filter((name) => name.endsWith('.sql'))
        .sort(),
      before = names.filter((name) => name < '0063');
    expect(before.at(-1)).toBe('0062_document_position_discount_amount.sql');
    await migrate(
      upgrade,
      await Promise.all(
        before.map(async (name) => ({
          name,
          sql: await readFile(new URL(name, directory), 'utf8'),
        })),
      ),
    );
    const upgradeTenant = randomUUID(),
      template = randomUUID(),
      document = randomUUID(),
      line = randomUUID();
    await upgrade.query(
      'INSERT INTO tenants (id,name,timezone) VALUES ($1,$2,$3)',
      [upgradeTenant, 'Synthetic total discount upgrade', 'Europe/Berlin'],
    );
    await upgrade.query(
      `INSERT INTO document_templates
         (tenant_id,id,kind,name,subject,intro_text,outro_text,validity_days,state,version)
       VALUES ($1,$2,'offer','Fictional legacy template','','','',14,'active',1)`,
      [upgradeTenant, template],
    );
    await upgrade.query(
      `INSERT INTO documents (tenant_id,id,kind,template_id,issued_at,gross_minor,net_minor,tax_minor)
       VALUES ($1,$2,'offer',$3,$4,19900,16723,3177)`,
      [upgradeTenant, document, template, documentNow],
    );
    await upgrade.query(
      `INSERT INTO document_lines
         (tenant_id,document_id,id,position,description,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points)
       VALUES ($1,$2,$3,0,'Fictional legacy line',1,'Stück',19900,1900,0)`,
      [upgradeTenant, document, line],
    );
    await migrate(upgrade);
    const legacy = await upgrade.query<{
      kind: string | null;
      value: string | null;
      note: string | null;
    }>(
      `SELECT total_discount_kind AS kind, total_discount_value::text AS value,
              total_discount_note AS note
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [upgradeTenant, document],
    );
    // An old row keeps NULL - never a zero that would read as a discount.
    expect(legacy.rows[0]).toEqual({ kind: null, value: null, note: null });
    // And the one claim expression answers exactly the stored gross.
    expect(
      (await paymentBalance(upgrade, upgradeTenant, document)).claimMinor,
    ).toBe(19900);
  } finally {
    await upgrade.end();
  }
});
