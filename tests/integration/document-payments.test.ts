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
  type DocumentOfferRow,
} from '../../packages/core/src/documents.js';
import {
  documentPaymentRepository,
  openMinorOf,
  paymentBalance,
  paymentState,
  registerDocumentPaymentRoutes,
  DocumentPaymentError,
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

// BKP019.d: an incoming payment is a record against a finalized invoice. Every
// amount and every claim below is a magnitude in minor units; the derived status
// (offen / teilweise bezahlt / bezahlt) and the open amount are never stored.
// No bank, card or payment provider is involved - this suite only proves the
// manual record and the rules around it.

let container: StartedPostgreSqlContainer, pool: Pool;
const site = 'https://admin.example.invalid';

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

// The payment day is a tenant-local calendar day. `0` is today in Europe/Berlin,
// `1` is tomorrow - the one day a payment may never carry.
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

type Context = Awaited<ReturnType<typeof tenantContext>>;

// One tenant with the whole chain an invoice needs: contact, event, offer
// template, number ranges, layout. The invoice is finalized, so it carries a
// claim of exactly 249,00 EUR.
async function tenantContext(scope: string) {
  await bootstrapAccess(
    pool,
    scope,
    'payments-' + scope + '@example.invalid',
    'Synthetic payments',
    'Europe/Berlin',
  );
  const grant = (await accessRepository(pool, scope).list())[0]!;
  await accessRepository(pool, scope).issueSession(
    { subject: 'seed-' + scope, email: grant.email },
    digest('seed-hash-' + scope),
  );
  const actor = (await accessRepository(pool, scope).list())[0]!.userId!,
    contact = randomUUID(),
    event = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Payment Customer','Robin Example','Example Street 2','12345',
      'Fictional Town','DE','payments@example.invalid','','','','','active',1)`,
    [scope, contact],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Payment Wedding','option',NULL,NULL,NULL,'synthetic','2030-11-14',
      NULL,NULL,'Europe/Berlin','','',1)`,
    [scope, event],
  );
  const templateId = (
    await documentTemplateRepository(pool, scope).save(actor, {
      kind: 'offer',
      name: 'Fictional payment offer',
      subject: 'Angebot für {{contact}}',
      introText: 'Fiktive Feier {{event}}.',
      outroText: 'Gesamt {{total}}.',
      validityDays: 14,
      state: 'active',
      positions: [
        {
          productId: null,
          description: 'Fictional photo box',
          quantity: 1,
          unit: 'Stück',
          unitPriceMinor: 24900,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    })
  ).id as string;
  for (const [kind, pattern] of [
    ['offer', 'AN-{YYYY}-{SEQ}'],
    ['order_confirmation', 'AB-{YYYY}-{SEQ}'],
    ['invoice', 'RE-{YYYY}-{SEQ}'],
    ['correction', 'KO-{YYYY}-{SEQ}'],
  ] as const)
    await documentNumberRepository(pool, scope).save(actor, kind, {
      pattern,
      minLength: 4,
      nextValue: 1,
    });
  const store = memoryStore();
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
  const repo = documentRepository(pool, scope, {
      origin: site,
      store,
      // The document clock is fixed, so numbers and dates are deterministic. The
      // payment clock stays real: "not in the future" is judged against today.
      now: () => new Date('2030-10-26T10:00:00Z'),
      render: async (html: string) =>
        Buffer.from('%PDF-1.4 synthetic ' + html.length),
    }),
    draft = await repo.createDraft(actor, {
      templateId,
      eventId: event,
      contactId: contact,
    }),
    offer = await repo.finalize(actor, draft.id, draft.version),
    sent = await repo.changeOfferStatus(actor, offer.id, {
      status: 'sent',
      version: offer.version,
    }),
    accepted = await repo.changeOfferStatus(actor, offer.id, {
      status: 'accepted',
      version: sent.version,
      channel: 'email',
    }),
    confirmationDraft = await repo.createOrderConfirmation(
      actor,
      accepted.id,
      accepted.version,
    ),
    confirmation = await repo.finalize(
      actor,
      confirmationDraft.id,
      confirmationDraft.version,
    ),
    invoiceDraft = await repo.createInvoice(
      actor,
      confirmation.id,
      confirmation.version,
    ),
    invoice = await repo.finalize(actor, invoiceDraft.id, invoiceDraft.version);
  return {
    scope,
    actor,
    repo,
    payments: documentPaymentRepository(pool, scope),
    contact,
    event,
    templateId,
    offer: accepted,
    confirmation,
    invoice,
  };
}

// A second chain in the same tenant, stopped before the invoice is finalized:
// only such a row is a real draft invoice, because finalizing is what makes the
// first one a claim.
async function draftInvoice(context: Context) {
  const draft = await context.repo.createDraft(context.actor, {
      templateId: context.templateId,
      eventId: context.event,
      contactId: context.contact,
    }),
    offer = await context.repo.finalize(context.actor, draft.id, draft.version),
    sent = await context.repo.changeOfferStatus(context.actor, offer.id, {
      status: 'sent',
      version: offer.version,
    }),
    accepted = await context.repo.changeOfferStatus(context.actor, offer.id, {
      status: 'accepted',
      version: sent.version,
      channel: 'email',
    }),
    confirmationDraft = await context.repo.createOrderConfirmation(
      context.actor,
      accepted.id,
      accepted.version,
    ),
    confirmation = await context.repo.finalize(
      context.actor,
      confirmationDraft.id,
      confirmationDraft.version,
    );
  return context.repo.createInvoice(
    context.actor,
    confirmation.id,
    confirmation.version,
  );
}

async function storedPayment(scope: string, id: string) {
  return (
    await pool.query<{
      document_id: string;
      received_on: string;
      amount_minor: string;
      method: string;
      note: string | null;
      recorded_by: string;
      recorded_at: Date;
    }>(
      `SELECT document_id, to_char(received_on,'YYYY-MM-DD') AS received_on,
              amount_minor::text AS amount_minor, method, note, recorded_by, recorded_at
         FROM document_payments WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0];
}

async function paymentCount(scope: string, documentId?: string) {
  return (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM document_payments
        WHERE tenant_id=$1 AND ($2::uuid IS NULL OR document_id=$2::uuid)`,
      [scope, documentId ?? null],
    )
  ).rows[0]!.count;
}

async function paymentAudit(scope: string, recordId: string) {
  return (
    await pool.query<{ action: string }>(
      'SELECT action FROM audit_events WHERE tenant_id=$1 AND record_id=$2 ORDER BY id',
      [scope, recordId],
    )
  ).rows.map((row) => row.action);
}

async function invoiceRow(scope: string, id: string) {
  return (
    await pool.query<Record<string, unknown>>(
      `SELECT state, number, gross_minor, version, snapshot_hash, pdf_hash
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

// The one projection that carries the payment axis.
async function projectedInvoice(context: Context) {
  const rows = (await context.repo.list({
    include: 'offer',
  })) as DocumentOfferRow[];
  return rows.find((row) => row.id === context.invoice.id)!;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('records an incoming payment on a finalized invoice and audits it once', async () => {
  const context = await tenantContext(randomUUID()),
    before = await invoiceRow(context.scope, context.invoice.id),
    payment = await context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 10000,
      method: 'bank_transfer',
      note: '  Erste Rate per Überweisung  ',
    });
  // The answer is the stored row: a tenant-local day, an exact magnitude, the
  // documented method and the trimmed note.
  expect(payment).toMatchObject({
    documentId: context.invoice.id,
    receivedOn: tenantDay(),
    amountMinor: 10000,
    method: 'bank_transfer',
    note: 'Erste Rate per Überweisung',
  });
  expect(payment.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(payment.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  const stored = (await storedPayment(context.scope, payment.id))!;
  expect(stored).toMatchObject({
    document_id: context.invoice.id,
    received_on: tenantDay(),
    amount_minor: '10000',
    method: 'bank_transfer',
    note: 'Erste Rate per Überweisung',
    recorded_by: context.actor,
  });
  expect(stored.recorded_at).toBeInstanceOf(Date);
  expect(await paymentAudit(context.scope, payment.id)).toEqual([
    'payment.recorded',
  ]);
  // Recording money never rewrites the immutable invoice: same state, number,
  // hashes, amount and - importantly - not even a new version.
  expect(await invoiceRow(context.scope, context.invoice.id)).toEqual(before);
});

test('partial payments add up to bezahlt and never bump the invoice version', async () => {
  const context = await tenantContext(randomUUID()),
    version = (await invoiceRow(context.scope, context.invoice.id)).version;
  const first = await context.payments.record(
    context.actor,
    context.invoice.id,
    { receivedOn: tenantDay(), amountMinor: 10000, method: 'bank_transfer' },
  );
  // "Offen" is the absence of a payment, "teilweise" is a claim not yet covered.
  let row = await projectedInvoice(context);
  expect(row).toMatchObject({
    paymentState: 'partial',
    openMinor: 14900,
    correctionState: 'none',
    remainingCredit: 24900,
  });
  const second = await context.payments.record(
    context.actor,
    context.invoice.id,
    {
      receivedOn: tenantDay(),
      amountMinor: 14900,
      method: 'card',
      note: 'Rest per Karte',
    },
  );
  row = await projectedInvoice(context);
  expect(row).toMatchObject({ paymentState: 'paid', openMinor: 0 });
  expect((await invoiceRow(context.scope, context.invoice.id)).version).toBe(
    version,
  );
  // The list is oldest first, carries exactly the documented keys and is
  // tenant-bound.
  const listed = await context.payments.list(context.invoice.id);
  expect(listed.map((entry) => entry.id)).toEqual([first.id, second.id]);
  expect(Object.keys(listed[0]!).sort()).toEqual([
    'amountMinor',
    'documentId',
    'id',
    'method',
    'note',
    'receivedOn',
    'recordedAt',
  ]);
  expect(listed[1]).toMatchObject({ amountMinor: 14900, method: 'card' });
});

test('a payment above the open claim is refused as overpaid', async () => {
  const context = await tenantContext(randomUUID());
  // One cent above the invoice is refused before any row or audit entry exists.
  await expect(
    context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 24901,
      method: 'cash',
    }),
  ).rejects.toMatchObject({ reason: 'overpaid' });
  expect(await paymentCount(context.scope)).toBe(0);
  // No payment, no audit entry: a refused attempt leaves no trace of money.
  expect(
    (
      await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_events
          WHERE tenant_id=$1 AND action='payment.recorded'`,
        [context.scope],
      )
    ).rows[0]!.count,
  ).toBe(0);
  // The exact claim is accepted, and one more cent is not.
  const paid = await context.payments.record(
    context.actor,
    context.invoice.id,
    { receivedOn: tenantDay(), amountMinor: 24900, method: 'cash' },
  );
  await expect(
    context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 1,
      method: 'cash',
    }),
  ).rejects.toMatchObject({ reason: 'overpaid' });
  expect(await paymentCount(context.scope)).toBe(1);
  expect(await paymentAudit(context.scope, paid.id)).toEqual([
    'payment.recorded',
  ]);
  expect(await projectedInvoice(context)).toMatchObject({
    paymentState: 'paid',
    openMinor: 0,
  });
});

test('the payment date must be a real tenant-local day and never in the future', async () => {
  const context = await tenantContext(randomUUID());
  // The domain names every malformed date the same way.
  await expect(
    context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(1),
      amountMinor: 100,
      method: 'cash',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_date' });
  for (const receivedOn of [
    '2030-02-30',
    '26.10.2026',
    '',
    'morgen',
    '2030-2-3',
  ]) {
    await expect(
      context.payments.record(context.actor, context.invoice.id, {
        receivedOn,
        amountMinor: 100,
        method: 'cash',
      }),
      receivedOn,
    ).rejects.toMatchObject({ reason: 'invalid_date' });
  }
  expect(await paymentCount(context.scope)).toBe(0);
  // An old day is legal: money can arrive late and be recorded now.
  const late = await context.payments.record(
    context.actor,
    context.invoice.id,
    { receivedOn: '2020-01-01', amountMinor: 100, method: 'cash' },
  );
  expect(late.receivedOn).toBe('2020-01-01');
});

test('only a positive safe integer is an amount', async () => {
  const context = await tenantContext(randomUUID());
  for (const amountMinor of [0, -1, 1.5, 9007199254740992, Number.NaN]) {
    await expect(
      context.payments.record(context.actor, context.invoice.id, {
        receivedOn: tenantDay(),
        amountMinor,
        method: 'cash',
      }),
      String(amountMinor),
    ).rejects.toMatchObject({ reason: 'invalid_amount' });
  }
  expect(await paymentCount(context.scope)).toBe(0);
  // The smallest legal magnitude is one cent.
  expect(
    await context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 1,
      method: 'cash',
    }),
  ).toMatchObject({ amountMinor: 1 });
});

test('the method is a closed set and the note is trimmed, bounded and plain', async () => {
  const context = await tenantContext(randomUUID());
  for (const method of ['sepa', '', 'BAR', 'bank-transfer']) {
    await expect(
      context.payments.record(context.actor, context.invoice.id, {
        receivedOn: tenantDay(),
        amountMinor: 100,
        method,
      }),
      method,
    ).rejects.toMatchObject({ reason: 'invalid_method' });
  }
  for (const note of ['x'.repeat(2001), 'Rate\u0001eins', 'Rate\u007feins']) {
    await expect(
      context.payments.record(context.actor, context.invoice.id, {
        receivedOn: tenantDay(),
        amountMinor: 100,
        method: 'cash',
        note,
      }),
      note.slice(0, 8),
    ).rejects.toMatchObject({ reason: 'invalid_note' });
  }
  // An empty note and an explicit NULL are no note, and the longest legal note
  // is stored trimmed.
  expect(
    await context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 100,
      method: 'cash',
      note: '   ',
    }),
  ).toMatchObject({ note: null });
  expect(
    await context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 100,
      method: 'card',
      note: null,
    }),
  ).toMatchObject({ note: null });
  expect(
    await context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 100,
      method: 'other',
      note: ' ' + 'x'.repeat(2000) + ' ',
    }),
  ).toMatchObject({ note: 'x'.repeat(2000), method: 'other' });
  expect(await paymentCount(context.scope)).toBe(3);
});

test('only a finalized invoice takes a payment', async () => {
  const context = await tenantContext(randomUUID());
  // An offer, a confirmation and a correction are no claim of their own.
  for (const documentId of [
    context.offer.id,
    context.confirmation.id,
    (
      await context.repo.createCorrection(
        context.actor,
        context.invoice.id,
        context.invoice.version,
        'credit',
      )
    ).id,
  ])
    await expect(
      context.payments.record(context.actor, documentId, {
        receivedOn: tenantDay(),
        amountMinor: 100,
        method: 'cash',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_kind' });
  // A draft invoice can still move, so it carries no payable claim yet.
  await expect(
    context.payments.record(context.actor, (await draftInvoice(context)).id, {
      receivedOn: tenantDay(),
      amountMinor: 100,
      method: 'cash',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  // A foreign or unknown invoice is missing, never forbidden: no leak.
  await expect(
    context.payments.record(context.actor, randomUUID(), {
      receivedOn: tenantDay(),
      amountMinor: 100,
      method: 'cash',
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect(await paymentCount(context.scope)).toBe(0);
});

test('the balance of an unknown or foreign document is missing', async () => {
  const context = await tenantContext(randomUUID()),
    other = await tenantContext(randomUUID()),
    unknown = randomUUID();
  await expect(
    paymentBalance(pool, context.scope, unknown),
  ).rejects.toMatchObject({ reason: 'not_found' });
  // A foreign invoice is not readable through this tenant either.
  await expect(
    paymentBalance(pool, context.scope, other.invoice.id),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await other.payments.record(other.actor, other.invoice.id, {
    receivedOn: tenantDay(),
    amountMinor: 24900,
    method: 'cash',
  });
  expect(await paymentBalance(pool, other.scope, other.invoice.id)).toEqual({
    grossMinor: 24900,
    creditedMinor: 0,
    debitedMinor: 0,
    paidMinor: 24900,
    claimMinor: 24900,
    openMinor: 0,
  });
});

test('a payment requires the administrator right and a known actor', async () => {
  const context = await tenantContext(randomUUID());
  await expect(
    context.payments.record(randomUUID(), context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 100,
      method: 'cash',
    }),
  ).rejects.toThrow('forbidden');
  expect(await paymentCount(context.scope)).toBe(0);
});

test('two simultaneous payments never both fit into the same claim', async () => {
  const context = await tenantContext(randomUUID());
  const results = await Promise.allSettled([
    context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 15000,
      method: 'bank_transfer',
    }),
    context.payments.record(context.actor, context.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 15000,
      method: 'cash',
    }),
  ]);
  // 2 x 150,00 EUR exceed the 249,00 EUR claim: exactly one row commits, the
  // other is refused by the sum read under the tenant lock.
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const refused = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )!;
  expect(refused.reason).toBeInstanceOf(DocumentPaymentError);
  expect(refused.reason.reason).toBe('overpaid');
  expect(await paymentCount(context.scope)).toBe(1);
  expect(await projectedInvoice(context)).toMatchObject({
    paymentState: 'partial',
    openMinor: 9900,
  });
});

test('the payment routes keep auth, CSRF, shape and refuse edits', async () => {
  const context = await tenantContext(randomUUID());
  // The account is already claimed by the seed subject, so the route session
  // reuses it - a different subject would be denied and yield no session.
  await accessRepository(pool, context.scope).issueSession(
    {
      subject: 'seed-' + context.scope,
      email: 'payments-' + context.scope + '@example.invalid',
    },
    digest('synthetic-payment'),
  );
  const config = {
      origin: site,
      tenantId: context.scope,
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
  registerDocumentRoutes(app, pool, context.scope, {
    origin: site,
    store: memoryStore(),
    render: async (html: string) =>
      Buffer.from('%PDF-1.4 synthetic ' + html.length),
  });
  registerDocumentPaymentRoutes(app, pool, context.scope);
  const url = '/api/v1/documents/' + context.invoice.id + '/payments',
    cookies = { '__Host-ak-session': 'synthetic-payment' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-payment'),
    };
  try {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    // A session without the CSRF token is refused, never silently accepted.
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          cookies,
          payload: {
            receivedOn: tenantDay(),
            amountMinor: 1000,
            method: 'cash',
          },
        })
      ).statusCode,
    ).toBe(403);
    // Fastify's schema refuses a missing field and a value of the wrong shape;
    // the domain names the fractional amount itself. An unknown key is stripped
    // like on every other document route, never stored.
    for (const payload of [
      { receivedOn: tenantDay(), amountMinor: 1000 },
      { amountMinor: 1000, method: 'cash' },
      { receivedOn: tenantDay(), amountMinor: { value: 1000 }, method: 'cash' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            cookies,
            headers,
            payload,
          })
        ).statusCode,
        JSON.stringify(payload),
      ).toBe(400);
    const stripped = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: {
        receivedOn: tenantDay(),
        amountMinor: 1000,
        method: 'cash',
        extra: 1,
      },
    });
    expect(stripped.statusCode).toBe(201);
    expect(stripped.body).not.toContain('extra');
    expect(stripped.json()).toMatchObject({ amountMinor: 1000, note: null });
    const fractional = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: { receivedOn: tenantDay(), amountMinor: 10.5, method: 'cash' },
    });
    expect(fractional.statusCode).toBe(400);
    expect(fractional.json()).toEqual({ error: 'invalid_amount' });
    const created = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: {
        receivedOn: tenantDay(),
        amountMinor: 1000,
        method: 'bank_transfer',
        note: 'Synthetische Anzahlung',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(Object.keys(created.json() as object).sort()).toEqual([
      'amountMinor',
      'documentId',
      'id',
      'method',
      'note',
      'receivedOn',
      'recordedAt',
    ]);
    const overpaid = await app.inject({
      method: 'POST',
      url,
      cookies,
      headers,
      payload: { receivedOn: tenantDay(), amountMinor: 23000, method: 'cash' },
    });
    expect(overpaid.statusCode).toBe(409);
    expect(overpaid.json()).toEqual({ error: 'overpaid' });
    const listed = await app.inject({ method: 'GET', url, cookies });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as unknown[]).length).toBe(2);
    // Append-only: no edit, no delete, no second write route.
    for (const method of ['PATCH', 'DELETE', 'PUT'] as const)
      expect(
        (
          await app.inject({
            method,
            url,
            cookies,
            headers,
            payload: { amountMinor: 1 },
          })
        ).statusCode,
        method,
      ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url, cookies })).json(),
    ).toMatchObject([
      { amountMinor: 1000, documentId: context.invoice.id },
      { amountMinor: 1000, documentId: context.invoice.id },
    ]);
    // A foreign or unknown document is missing here too.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents/' + randomUUID() + '/payments',
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    // A draft invoice still moves, so the route answers with its own 409 code and
    // writes nothing.
    const draft = await draftInvoice(context);
    const draftPayment = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/' + draft.id + '/payments',
      cookies,
      headers,
      payload: { receivedOn: tenantDay(), amountMinor: 100, method: 'cash' },
    });
    expect(draftPayment.statusCode).toBe(409);
    expect(draftPayment.json()).toEqual({ error: 'invalid_state' });
    expect(await paymentCount(context.scope)).toBe(2);
  } finally {
    await app.close();
  }
});

test('the claim follows final corrections and the credit guard counts payments', async () => {
  const context = await tenantContext(randomUUID());
  await context.payments.record(context.actor, context.invoice.id, {
    receivedOn: tenantDay(),
    amountMinor: 10000,
    method: 'bank_transfer',
  });
  // A debit raises the claim, so more becomes payable and creditable.
  const debit = await context.repo.createCorrection(
      context.actor,
      context.invoice.id,
      context.invoice.version,
      'debit',
      [
        {
          productId: null,
          description: 'Fiktive Nachbereitung',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 5000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    ),
    debitFinal = await context.repo.finalize(
      context.actor,
      debit.id,
      debit.version,
    );
  expect(debitFinal.number).toBe('KO-2030-0001');
  let row = await projectedInvoice(context);
  expect(row).toMatchObject({ paymentState: 'partial', openMinor: 19900 });
  // Money that already arrived is not creditable again: 249 + 50 - 100 = 199 is
  // the ceiling and is still allowed exactly.
  const credit = await context.repo.createCorrection(
    context.actor,
    context.invoice.id,
    context.invoice.version,
    'credit',
    [
      {
        productId: null,
        description: 'Fiktive Gutschrift',
        quantity: 1,
        unit: 'Pauschale',
        unitPriceMinor: 19900,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ],
  );
  const creditFinal = await context.repo.finalize(
    context.actor,
    credit.id,
    credit.version,
  );
  expect(creditFinal.number).toBe('KO-2030-0002');
  row = await projectedInvoice(context);
  // 249 + 50 - 199 - 100 = 0: the invoice is paid, not overpaid.
  expect(row).toMatchObject({
    paymentState: 'paid',
    openMinor: 0,
    correctionState: 'partial',
    remainingCredit: 5000,
  });
  // The old c2 ceiling alone would allow another 50,00 EUR credit, because
  // 199 + 50 is exactly the invoice gross. The extended rule refuses it: what
  // already arrived as money cannot be credited while no refund exists.
  const tooLarge = await context.repo.createCorrection(
    context.actor,
    context.invoice.id,
    context.invoice.version,
    'credit',
    [
      {
        productId: null,
        description: 'Fiktive Gutschrift',
        quantity: 1,
        unit: 'Pauschale',
        unitPriceMinor: 5000,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ],
  );
  await expect(
    context.repo.finalize(context.actor, tooLarge.id, tooLarge.version),
  ).rejects.toMatchObject({ reason: 'credit_exceeds_invoice' });
  // The draft keeps its state, its version and its number slot.
  expect(
    (
      await pool.query<{ state: string; number: string | null }>(
        'SELECT state, number FROM documents WHERE tenant_id=$1 AND id=$2',
        [context.scope, tooLarge.id],
      )
    ).rows[0],
  ).toEqual({ state: 'draft', number: null });
  expect(
    await documentNumberRepository(pool, context.scope).preview(
      'correction',
      new Date('2030-10-26T10:00:00Z'),
    ),
  ).toBe('KO-2030-0003');
  // A debit is not bounded by the claim at all - the first one was already
  // finalized while money had arrived, because the guard only judges credits.
  // The invoice itself never moved.
  expect(await invoiceRow(context.scope, context.invoice.id)).toMatchObject({
    state: 'final',
    number: 'RE-2030-0001',
  });
});

test('the projection carries the payment axis on invoices only', async () => {
  const context = await tenantContext(randomUUID());
  await context.payments.record(context.actor, context.invoice.id, {
    receivedOn: tenantDay(),
    amountMinor: 5000,
    method: 'card',
  });
  const draft = await draftInvoice(context),
    rows = (await context.repo.list({
      include: 'offer',
    })) as DocumentOfferRow[],
    byId = (id: string) => rows.find((row) => row.id === id)!;
  const invoiceRowProjected = byId(context.invoice.id);
  expect(invoiceRowProjected).toMatchObject({
    paymentState: 'partial',
    openMinor: 19900,
  });
  expect(Object.keys(invoiceRowProjected)).toContain('paymentState');
  expect(Object.keys(invoiceRowProjected)).toContain('openMinor');
  // An offer, a confirmation, an invoice draft and a correction are no payable
  // claim: the two keys are present and honestly NULL.
  for (const id of [context.offer.id, context.confirmation.id, draft.id])
    expect(byId(id), id).toMatchObject({
      paymentState: null,
      openMinor: null,
    });
  const correction = await context.repo.createCorrection(
    context.actor,
    context.invoice.id,
    context.invoice.version,
    'debit',
  );
  const refreshed = (await context.repo.list({
      include: 'offer',
    })) as DocumentOfferRow[],
    correctionRow = refreshed.find((row) => row.id === correction.id)!;
  expect(correctionRow).toMatchObject({
    paymentState: null,
    openMinor: null,
  });
  // The unpaged list without a projection keeps its old shape.
  const plain = (await context.repo.list({})) as Record<string, unknown>[],
    plainInvoice = plain.find((row) => row.id === context.invoice.id)!;
  expect(Object.keys(plainInvoice)).not.toContain('paymentState');
  expect(Object.keys(plainInvoice)).not.toContain('openMinor');
});

test('payments of another tenant never move this claim', async () => {
  const mine = await tenantContext(randomUUID()),
    other = await tenantContext(randomUUID()),
    foreign = await other.payments.record(other.actor, other.invoice.id, {
      receivedOn: tenantDay(),
      amountMinor: 24900,
      method: 'bank_transfer',
    });
  expect(await projectedInvoice(other)).toMatchObject({
    paymentState: 'paid',
    openMinor: 0,
  });
  // The same-looking invoice in the other tenant stays untouched.
  expect(await projectedInvoice(mine)).toMatchObject({
    paymentState: 'none',
    openMinor: 24900,
  });
  // A foreign payment id is not readable through this tenant's repository.
  await expect(mine.payments.list(other.invoice.id)).rejects.toMatchObject({
    reason: 'not_found',
  });
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM document_payments WHERE tenant_id=$1',
        [mine.scope],
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(foreign.documentId).toBe(other.invoice.id);
});

test('the derived state and the open amount are magnitudes, never negative', () => {
  // No payment: nothing is paid and the whole claim is open.
  expect(paymentState(24900, 0)).toBe('none');
  expect(openMinorOf(24900, 0)).toBe(24900);
  // A partial payment, and one cent below the claim, both stay partial.
  expect(paymentState(24900, 10000)).toBe('partial');
  expect(paymentState(24900, 24899)).toBe('partial');
  // To the cent or beyond: paid, and the open amount never goes below zero.
  expect(paymentState(24900, 24900)).toBe('paid');
  expect(paymentState(24900, 24901)).toBe('paid');
  expect(openMinorOf(24900, 24901)).toBe(0);
  // A fully credited claim without any payment is open, not paid.
  expect(paymentState(0, 0)).toBe('none');
  expect(openMinorOf(0, 0)).toBe(0);
});

test('the database itself refuses a zero, a negative or an unknown method', async () => {
  const context = await tenantContext(randomUUID());
  for (const [amount, method] of [
    [0, 'cash'],
    [-1, 'cash'],
    [100, 'sepa'],
  ] as const)
    await expect(
      pool.query(
        `INSERT INTO document_payments
          (tenant_id,id,document_id,received_on,amount_minor,method,recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          context.scope,
          randomUUID(),
          context.invoice.id,
          tenantDay(),
          amount,
          method,
          context.actor,
        ],
      ),
      String(amount) + ' ' + method,
    ).rejects.toThrow(/document_payments/);
  // The tenant-bound foreign key refuses another tenant's invoice, and no
  // cascade can silently delete recorded money.
  await expect(
    pool.query(
      `INSERT INTO document_payments
        (tenant_id,id,document_id,received_on,amount_minor,method,recorded_by)
       VALUES ($1,$2,$3,$4,100,'cash',$5)`,
      [context.scope, randomUUID(), randomUUID(), tenantDay(), context.actor],
    ),
  ).rejects.toThrow(/document_payments/);
  const payment = await context.payments.record(
    context.actor,
    context.invoice.id,
    { receivedOn: tenantDay(), amountMinor: 100, method: 'cash' },
  );
  await expect(
    pool.query('DELETE FROM documents WHERE tenant_id=$1 AND id=$2', [
      context.scope,
      context.invoice.id,
    ]),
  ).rejects.toThrow(/document_payments/);
  expect(await paymentCount(context.scope)).toBe(1);
  expect(payment.note).toBeNull();
  // An untrimmed note is refused by the CHECK, so the raw text never lands.
  await expect(
    pool.query(
      `INSERT INTO document_payments
        (tenant_id,id,document_id,received_on,amount_minor,method,note,recorded_by)
       VALUES ($1,$2,$3,$4,100,'cash','  Rate  ',$5)`,
      [
        context.scope,
        randomUUID(),
        context.invoice.id,
        tenantDay(),
        context.actor,
      ],
    ),
  ).rejects.toThrow(/document_payments/);
});
