import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  accessRepository,
  bootstrapAccess,
} from '../../packages/core/src/access.js';
import { documentTemplateRepository } from '../../packages/core/src/document-templates.js';
import { documentLayoutRepository } from '../../packages/core/src/document-layouts.js';
import { documentNumberRepository } from '../../packages/core/src/document-numbers.js';
import {
  documentRepository,
  invoiceOverdue,
  registerDocumentRoutes,
  type DocumentDraftContent,
  type DocumentOfferRow,
} from '../../packages/core/src/documents.js';
import { documentPaymentRepository } from '../../packages/core/src/document-payments.js';
import {
  StorageError,
  type StorageAdapter,
} from '../../packages/core/src/storage.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { digest, registerAuth } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';

// RG-08: "überfällig" is derived, never stored. A claim is late when its frozen
// due day lies strictly before the tenant's today and money is still open. The
// suite drives one mutable clock per tenant, so every comparison is reproducible
// and no test has to wait for a real day to pass.
// The reference is the Lastenheft (RG-08 names "überfällig" as a document status)
// only: this suite states no legal claim, no dunning step and no interest.

let container: StartedPostgreSqlContainer, pool: Pool;
const site = 'https://admin.example.invalid';
// 10 March 2031, 11:00 in Europe/Berlin (CET) - a plain winter day.
const issueDay = '2031-03-10T10:00:00Z';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

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

type Scenario = {
  scope: string;
  actor: string;
  templateId: string;
  contactId: string;
  eventId: string;
  timeZone: string;
  rendered: string[];
  repo: ReturnType<typeof documentRepository>;
  payments: ReturnType<typeof documentPaymentRepository>;
  /** One clock for writes and reads: a day boundary is moved, not waited for. */
  setClock(instant: string): void;
};

// Every test builds its own tenant, so no assertion depends on another suite.
async function scenario(
  timeZone = 'Europe/Berlin',
  at = issueDay,
): Promise<Scenario> {
  const scope = randomUUID(),
    email = 'overdue-' + scope + '@example.invalid',
    clock = { at: new Date(at) };
  await bootstrapAccess(
    pool,
    scope,
    email,
    'Synthetic overdue invoices',
    timeZone,
  );
  await accessRepository(pool, scope).issueSession(
    { subject: 'overdue-' + scope, email },
    digest('overdue-' + scope),
  );
  const actor = (await accessRepository(pool, scope).list())[0]!.userId!,
    contactId = randomUUID(),
    eventId = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Overdue Customer','Robin Example','Example Street 2',
      '12345','Fictional Town','DE','overdue@example.invalid','','','','','active',1)`,
    [scope, contactId],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Overdue Wedding','option',NULL,NULL,NULL,'synthetic','2031-04-14',
      NULL,NULL,$3,'','',1)`,
    [scope, eventId, timeZone],
  );
  const templateId = (
    await documentTemplateRepository(pool, scope).save(actor, {
      kind: 'offer',
      name: 'Fictional overdue offer',
      subject: 'Angebot für {{contact}}',
      introText: 'Fiktive Feier am {{date}}.',
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
  ).id;
  for (const [kind, pattern] of [
    ['offer', 'AN-{YYYY}-{SEQ}'],
    ['order_confirmation', 'AB-{YYYY}-{SEQ}'],
    ['deposit_invoice', 'AZ-{YYYY}-{SEQ}'],
    ['invoice', 'RE-{YYYY}-{SEQ}'],
    ['correction', 'KO-{YYYY}-{SEQ}'],
  ] as const)
    await documentNumberRepository(pool, scope).save(actor, kind, {
      pattern,
      minLength: 4,
      nextValue: 1,
    });
  await documentLayoutRepository(pool, scope, memoryStore()).save(actor, {
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
  const rendered: string[] = [],
    store = memoryStore();
  return {
    scope,
    actor,
    templateId,
    contactId,
    eventId,
    timeZone,
    rendered,
    repo: documentRepository(pool, scope, {
      origin: site,
      store,
      now: () => clock.at,
      render: async (html: string) => {
        rendered.push(html);
        return Buffer.from('%PDF-1.4 synthetic ' + html.length);
      },
    }),
    // The payment clock is the same clock: "not in the future" is judged against
    // the injected tenant day, never against the machine's real date.
    payments: documentPaymentRepository(pool, scope, () => clock.at),
    setClock: (instant: string) => {
      clock.at = new Date(instant);
    },
  };
}

function content(
  version: number,
  paymentTermDays?: number,
  lines?: DocumentDraftContent['lines'],
): DocumentDraftContent {
  return {
    version,
    subject: 'Rechnung für {{contact}}',
    introText: 'Fiktive Einleitung',
    outroText: 'Fiktiver Schluss',
    validityDays: 14,
    ...(paymentTermDays === undefined ? {} : { paymentTermDays }),
    ...(lines === undefined ? {} : { lines }),
  };
}

// The real chain a claim needs: offer -> accepted -> confirmation, which is then
// billed through `invoiceFrom`.
async function invoiceChain(s: Scenario) {
  const offer = await s.repo.createDraft(s.actor, {
      templateId: s.templateId,
      eventId: s.eventId,
      contactId: s.contactId,
    }),
    offerFinal = await s.repo.finalize(s.actor, offer.id, offer.version),
    sent = await s.repo.changeOfferStatus(s.actor, offerFinal.id, {
      status: 'sent',
      version: offerFinal.version,
    }),
    accepted = await s.repo.changeOfferStatus(s.actor, sent.id, {
      status: 'accepted',
      version: sent.version,
      channel: 'email',
    }),
    confirmation = await s.repo.createOrderConfirmation(
      s.actor,
      accepted.id,
      accepted.version,
    ),
    confirmationFinal = await s.repo.finalize(
      s.actor,
      confirmation.id,
      confirmation.version,
    );
  return { offer: accepted, confirmation: confirmationFinal };
}

async function invoiceFrom(
  s: Scenario,
  confirmationId: string,
  confirmationVersion: number,
  paymentTermDays?: number,
) {
  const draft = await s.repo.createInvoice(
      s.actor,
      confirmationId,
      confirmationVersion,
    ),
    saved =
      paymentTermDays === undefined
        ? draft
        : await s.repo.updateDraftContent(
            s.actor,
            draft.id,
            content(draft.version, paymentTermDays),
          );
  return s.repo.finalize(s.actor, saved.id, saved.version);
}

async function listed(s: Scenario) {
  return (await s.repo.list({ include: 'offer' })) as DocumentOfferRow[];
}

async function listedById(s: Scenario, id: string) {
  return (await listed(s)).find((row) => row.id === id)!;
}

// The stored facts a derivation must never touch, plus the PDF identity.
async function storedState(scope: string, id: string) {
  return (
    await pool.query<{
      state: string;
      version: number;
      due_date: string | null;
      pdf_hash: string | null;
      snapshot_hash: string | null;
      payment_term_days: number | null;
    }>(
      `SELECT state, version, to_char(due_date,'YYYY-MM-DD') AS due_date,
              pdf_hash, snapshot_hash, payment_term_days
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

async function auditOf(scope: string, id: string) {
  const { rows } = await pool.query<{ action: string }>(
    `SELECT action FROM audit_events
      WHERE tenant_id=$1 AND record_id=$2 AND action LIKE 'document.%'
      ORDER BY action`,
    [scope, id],
  );
  return rows.map((row) => row.action);
}

// 1 + 2: the boundary is strict. A claim due today is not late at 23:59:59 local,
// one tenant day later it is - and the stored due day never moved.
test('a claim is late only after its due day, never on it', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    );
  // Term 0: due on the invoice day itself (10 March 2031 in Europe/Berlin).
  expect(invoice.state).toBe('final');
  expect((await storedState(s.scope, invoice.id)).due_date).toBe('2031-03-10');

  // 23:59:59 local on the due day: still not late.
  s.setClock('2031-03-10T22:59:59Z');
  expect(await listedById(s, invoice.id)).toMatchObject({
    dueDate: '2031-03-10',
    paymentState: 'none',
    openMinor: 24900,
    overdue: false,
  });
  // One second later the tenant day has moved on; the deadline did not.
  s.setClock('2031-03-10T23:00:00Z');
  expect(await listedById(s, invoice.id)).toMatchObject({
    dueDate: '2031-03-10',
    paymentState: 'none',
    openMinor: 24900,
    overdue: true,
  });
  expect((await storedState(s.scope, invoice.id)).due_date).toBe('2031-03-10');
});

// 3: no payment term means no deadline - the derivation invents none.
test('an invoice without a payment term never becomes late', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
    );
  expect((await storedState(s.scope, invoice.id)).due_date).toBeNull();
  s.setClock('2031-06-01T10:00:00Z');
  expect(await listedById(s, invoice.id)).toMatchObject({
    dueDate: null,
    paymentState: 'none',
    openMinor: 24900,
    overdue: false,
  });
});

// 4: money closes the claim, so the date no longer matters - also when the day
// of payment lies after the due day ("were late once" is not claimed).
test('a fully paid invoice is not late although its due day has passed', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    );
  s.setClock('2031-03-20T10:00:00Z');
  expect((await listedById(s, invoice.id)).overdue).toBe(true);
  await s.payments.record(s.actor, invoice.id, {
    receivedOn: '2031-03-20',
    amountMinor: 24900,
    method: 'bank_transfer',
  });
  expect(await listedById(s, invoice.id)).toMatchObject({
    paymentState: 'paid',
    openMinor: 0,
    overdue: false,
  });
});

// 5: the two axes stay independent - partial is not "paid" and still late.
test('a partially paid invoice stays late with its open amount', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    );
  s.setClock('2031-03-12T10:00:00Z');
  await s.payments.record(s.actor, invoice.id, {
    receivedOn: '2031-03-12',
    amountMinor: 10000,
    method: 'cash',
  });
  expect(await listedById(s, invoice.id)).toMatchObject({
    paymentState: 'partial',
    openMinor: 14900,
    overdue: true,
  });
});

// 6: a deposit is a claim of its own, so it ages like one.
test('a finalized deposit invoice becomes late', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    deposit = await s.repo.createDepositInvoice(
      s.actor,
      chain.confirmation.id,
      chain.confirmation.version,
    ),
    saved = await s.repo.updateDraftContent(
      s.actor,
      deposit.id,
      content(deposit.version, 0, [
        {
          productId: null,
          description: 'Fictional advance',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 10000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ]),
    ),
    finalized = await s.repo.finalize(s.actor, saved.id, saved.version);
  expect(finalized).toMatchObject({ kind: 'deposit_invoice', state: 'final' });
  expect((await listedById(s, deposit.id)).overdue).toBe(false);
  s.setClock('2031-03-11T10:00:00Z');
  expect(await listedById(s, deposit.id)).toMatchObject({
    dueDate: '2031-03-10',
    paymentState: 'none',
    openMinor: 10000,
    overdue: true,
  });
});

// 7: only a claim can be late. A correction may carry a due day (the CHECK
// allows it on the invoice family), an offer and a confirmation cannot - none of
// them ever answers `true`.
test('a correction, a confirmation and an offer are never late', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    ),
    correctionDraft = await s.repo.createCorrection(
      s.actor,
      invoice.id,
      invoice.version,
      'debit',
      [
        {
          productId: null,
          description: 'Fictional follow-up charge',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 1900,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    ),
    corrected = await s.repo.updateDraftContent(
      s.actor,
      correctionDraft.id,
      content(correctionDraft.version, 0),
    ),
    correction = await s.repo.finalize(
      s.actor,
      corrected.id,
      corrected.version,
    );
  // The deviating day is a fixture: the correction prints the term it was given,
  // and only payability - not the date - decides the lateness.
  expect((await storedState(s.scope, correction.id)).due_date).toBe(
    '2031-03-10',
  );
  s.setClock('2031-04-01T10:00:00Z');
  const rows = await listed(s);
  expect(rows.find((row) => row.id === correction.id)).toMatchObject({
    kind: 'correction',
    dueDate: '2031-03-10',
    paymentState: null,
    openMinor: null,
    overdue: null,
  });
  expect(rows.find((row) => row.id === chain.confirmation.id)).toMatchObject({
    kind: 'order_confirmation',
    dueDate: null,
    overdue: null,
  });
  expect(rows.find((row) => row.id === chain.offer.id)).toMatchObject({
    kind: 'offer',
    dueDate: null,
    overdue: null,
  });
});

// 8: a final invoice is late on its reduced claim only - the settled advance is
// no longer owed a second time.
test('a final invoice is late exactly on its reduced claim', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    deposit = await s.repo.createDepositInvoice(
      s.actor,
      chain.confirmation.id,
      chain.confirmation.version,
    ),
    depositSaved = await s.repo.updateDraftContent(
      s.actor,
      deposit.id,
      content(deposit.version, 0, [
        {
          productId: null,
          description: 'Fictional advance',
          quantity: 1,
          unit: 'Pauschale',
          unitPriceMinor: 10000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ]),
    );
  await s.repo.finalize(s.actor, depositSaved.id, depositSaved.version);
  const confirmation = (await s.repo.get(chain.confirmation.id))!,
    finalDraft = await s.repo.createFinalInvoice(
      s.actor,
      confirmation.id,
      confirmation.version,
    ),
    finalSaved = await s.repo.updateDraftContent(
      s.actor,
      finalDraft.id,
      content(finalDraft.version, 0),
    ),
    finalInvoice = await s.repo.finalize(
      s.actor,
      finalSaved.id,
      finalSaved.version,
    );
  s.setClock('2031-03-11T10:00:00Z');
  // 249,00 gross minus the 100,00 advance: the claim is 149,00, not the gross.
  expect(await listedById(s, finalInvoice.id)).toMatchObject({
    invoiceRole: 'final',
    depositAppliedMinor: 10000,
    paymentState: 'none',
    openMinor: 14900,
    overdue: true,
  });
  // Settled to the cent, the same document is no longer late.
  await s.payments.record(s.actor, finalInvoice.id, {
    receivedOn: '2031-03-11',
    amountMinor: 14900,
    method: 'card',
  });
  expect(await listedById(s, finalInvoice.id)).toMatchObject({
    paymentState: 'paid',
    openMinor: 0,
    overdue: false,
  });
});

// 9: a full credit note closes the claim; nothing is left to be late.
test('a fully credited invoice is not late', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    ),
    correctionDraft = await s.repo.createCorrection(
      s.actor,
      invoice.id,
      invoice.version,
      'credit',
    ),
    correction = await s.repo.finalize(
      s.actor,
      correctionDraft.id,
      correctionDraft.version,
    );
  expect(correction).toMatchObject({ kind: 'correction', grossMinor: 24900 });
  s.setClock('2031-03-11T10:00:00Z');
  expect(await listedById(s, invoice.id)).toMatchObject({
    correctionState: 'full',
    paymentState: 'none',
    openMinor: 0,
    overdue: false,
  });
});

// 10a: 28 October 2029 is the 25-hour day in Europe/Berlin. The deadline is a
// calendar day, so the extra hour can never shift it.
test('the 25-hour DST day keeps the due day exact', async () => {
  const s = await scenario('Europe/Berlin', '2029-10-27T10:00:00Z'),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      1,
    );
  expect((await storedState(s.scope, invoice.id)).due_date).toBe('2029-10-28');
  // 23:59:59 CET on the due day.
  s.setClock('2029-10-28T22:59:59Z');
  expect((await listedById(s, invoice.id)).overdue).toBe(false);
  // The next local midnight starts the following day.
  s.setClock('2029-10-28T23:00:00Z');
  expect((await listedById(s, invoice.id)).overdue).toBe(true);
});

// 10b: 25 March 2029 is the 23-hour day - the same rule, one hour earlier.
test('the 23-hour DST day keeps the due day exact', async () => {
  const s = await scenario('Europe/Berlin', '2029-03-24T10:00:00Z'),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      1,
    );
  expect((await storedState(s.scope, invoice.id)).due_date).toBe('2029-03-25');
  // 23:59:59 CEST on the due day.
  s.setClock('2029-03-25T21:59:59Z');
  expect((await listedById(s, invoice.id)).overdue).toBe(false);
  s.setClock('2029-03-25T22:00:00Z');
  expect((await listedById(s, invoice.id)).overdue).toBe(true);
});

// 11: the key belongs to the opt-in projection and nowhere else.
test('only the offer projection answers the overdue key', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    ),
    config = {
      origin: site,
      tenantId: s.scope,
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
  registerDocumentRoutes(app, pool, s.scope, {
    origin: site,
    store: memoryStore(),
    now: () => new Date('2031-03-11T10:00:00Z'),
    render: async (html: string) =>
      Buffer.from('%PDF-1.4 synthetic ' + html.length),
  });
  const cookies = { '__Host-ak-session': 'overdue-' + s.scope };
  try {
    const projected = await app.inject({
      url: '/api/v1/documents?include=offer',
      cookies,
    });
    expect(projected.statusCode).toBe(200);
    const projectedRow = projected
      .json()
      .find((row: { id: string }) => row.id === invoice.id);
    expect(projectedRow).toMatchObject({ overdue: true });
    // The plain list and the single document keep their exact old shape: no key,
    // no invented field.
    for (const url of [
      '/api/v1/documents',
      '/api/v1/documents/' + invoice.id,
    ]) {
      const answer = await app.inject({ url, cookies });
      expect(answer.statusCode).toBe(200);
      const body = answer.json(),
        row = Array.isArray(body)
          ? body.find((entry: { id: string }) => entry.id === invoice.id)
          : body;
      expect(Object.keys(row)).not.toContain('overdue');
    }
    // BKP019.e widens exactly one projection - the metadata one the file index
    // reads - so the index can filter and show the same lateness.
    const indexed = await app.inject({
      url: '/api/v1/documents?include=metadata',
      cookies,
    });
    expect(indexed.statusCode).toBe(200);
    expect(
      indexed.json().find((row: { id: string }) => row.id === invoice.id),
    ).toMatchObject({
      dueDate: '2031-03-10',
      paymentState: 'none',
      overdue: true,
    });
  } finally {
    await app.close();
  }
});

// 12: the tenant's own calendar decides - not a UTC day, not another tenant's.
test('the same due day answers differently in two tenant time zones', async () => {
  const berlin = await scenario('Europe/Berlin'),
    auckland = await scenario('Pacific/Auckland'),
    berlinChain = await invoiceChain(berlin),
    aucklandChain = await invoiceChain(auckland),
    berlinInvoice = await invoiceFrom(
      berlin,
      berlinChain.confirmation.id,
      berlinChain.confirmation.version,
      0,
    ),
    aucklandInvoice = await invoiceFrom(
      auckland,
      aucklandChain.confirmation.id,
      aucklandChain.confirmation.version,
      0,
    );
  // 10:00 UTC is 11:00 in Berlin and 23:00 in Auckland: both invoice days are
  // the 10th, so both due days are the same calendar day.
  expect((await storedState(berlin.scope, berlinInvoice.id)).due_date).toBe(
    '2031-03-10',
  );
  expect((await storedState(auckland.scope, aucklandInvoice.id)).due_date).toBe(
    '2031-03-10',
  );
  // One instant, two calendars: 13:00 in Berlin, 01:00 on the 11th in Auckland.
  berlin.setClock('2031-03-10T12:00:00Z');
  auckland.setClock('2031-03-10T12:00:00Z');
  expect((await listedById(berlin, berlinInvoice.id)).overdue).toBe(false);
  expect((await listedById(auckland, aucklandInvoice.id)).overdue).toBe(true);
  // A tenant never sees the other's rows, so no due day leaks across tenants.
  const foreign = await listed(berlin);
  expect(foreign.some((row) => row.id === aucklandInvoice.id)).toBe(false);
});

// 13: deriving is a read. Two list calls leave state, version, dates, audit and
// the PDF identity exactly as they were.
test('deriving the lateness writes nothing', async () => {
  const s = await scenario(),
    chain = await invoiceChain(s),
    invoice = await invoiceFrom(
      s,
      chain.confirmation.id,
      chain.confirmation.version,
      0,
    );
  s.setClock('2031-03-15T10:00:00Z');
  const before = await storedState(s.scope, invoice.id),
    auditBefore = await auditOf(s.scope, invoice.id);
  expect((await listedById(s, invoice.id)).overdue).toBe(true);
  expect((await listedById(s, invoice.id)).overdue).toBe(true);
  expect(await storedState(s.scope, invoice.id)).toEqual(before);
  expect(await auditOf(s.scope, invoice.id)).toEqual(auditBefore);
  expect(auditBefore).toEqual([
    'document.created',
    'document.finalized',
    'document.updated',
  ]);
  expect(before.pdf_hash).not.toBeNull();
});

// The pure rule, answered without a database: no due day, no claim and a settled
// claim all answer false; only an open claim past its day answers true.
test('the derivation function answers the four boundaries alone', () => {
  const at = new Date('2031-03-11T10:00:00Z');
  expect(invoiceOverdue(null, 24900, 0, at, 'Europe/Berlin')).toBe(false);
  expect(invoiceOverdue('2031-03-11', 24900, 0, at, 'Europe/Berlin')).toBe(
    false,
  );
  expect(invoiceOverdue('2031-03-10', 24900, 0, at, 'Europe/Berlin')).toBe(
    true,
  );
  expect(invoiceOverdue('2031-03-10', 24900, 24900, at, 'Europe/Berlin')).toBe(
    false,
  );
});
