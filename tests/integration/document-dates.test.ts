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
  registerDocumentRoutes,
  type DocumentDraftContent,
} from '../../packages/core/src/documents.js';
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

let container: StartedPostgreSqlContainer, pool: Pool;
const site = 'https://admin.example.invalid';
// 27.10.2030, 00:30 in Europe/Berlin: the tenant day is the one that matters,
// never the UTC day that is still the 26th.
const issueDay = new Date('2030-10-26T22:30:00Z');

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
  at: Date;
  rendered: string[];
  repo: ReturnType<typeof documentRepository>;
};

// Every test builds its own tenant, so nothing here depends on the order of the
// suite or on a fixture another slice happens to own.
async function scenario(
  at: Date = issueDay,
  zone = 'Europe/Berlin',
): Promise<Scenario> {
  const scope = randomUUID(),
    email = 'dates-' + scope + '@example.invalid';
  await bootstrapAccess(pool, scope, email, 'Synthetic invoice dates', zone);
  // The bootstrap account is unclaimed until its own first session binds it.
  await accessRepository(pool, scope).issueSession(
    { subject: 'dates-' + scope, email },
    digest('dates-' + scope),
  );
  const actor = (await accessRepository(pool, scope).list())[0]!.userId!,
    contactId = randomUUID(),
    eventId = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional Invoice Customer','Robin Example','Example Street 2',
      '12345','Fictional Town','DE','dates@example.invalid','','','','','active',1)`,
    [scope, contactId],
  );
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,event_type_id,package_id,location_id,source,
      event_date,starts_at,ends_at,time_zone,description,notes_html,version)
     VALUES ($1,$2,'Fictional Invoice Wedding','option',NULL,NULL,NULL,'synthetic','2030-11-14',
      NULL,NULL,$3,'','',1)`,
    [scope, eventId, zone],
  );
  const templateId = (
    await documentTemplateRepository(pool, scope).save(actor, {
      kind: 'offer',
      name: 'Fictional invoice offer',
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
  const rendered: string[] = [];
  return {
    scope,
    actor,
    templateId,
    contactId,
    eventId,
    at,
    rendered,
    repo: documentRepository(pool, scope, {
      origin: site,
      store: memoryStore(),
      now: () => at,
      render: async (html: string) => {
        rendered.push(html);
        return Buffer.from('%PDF-1.4 synthetic ' + html.length);
      },
    }),
  };
}

// The real chain an invoice needs: offer -> accepted -> confirmation -> invoice.
async function invoiceDraft(s: Scenario) {
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
    accepted = await s.repo.changeOfferStatus(s.actor, offerFinal.id, {
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
    ),
    invoice = await s.repo.createInvoice(
      s.actor,
      confirmationFinal.id,
      confirmationFinal.version,
    );
  return { offer: accepted, confirmation: confirmationFinal, invoice };
}

function draftContent(
  version: number,
  extra: Partial<DocumentDraftContent> = {},
): DocumentDraftContent {
  return {
    version,
    subject: 'Rechnung für {{contact}}',
    introText: 'Fiktive Einleitung',
    outroText: 'Fiktiver Schluss',
    validityDays: 14,
    ...extra,
  };
}

async function storedDates(scope: string, id: string) {
  return (
    await pool.query<{
      service_date: string | null;
      payment_term_days: number | null;
      due_date: string | null;
    }>(
      `SELECT to_char(service_date,'YYYY-MM-DD') AS service_date,
              payment_term_days,
              to_char(due_date,'YYYY-MM-DD') AS due_date
         FROM documents WHERE tenant_id=$1 AND id=$2`,
      [scope, id],
    )
  ).rows[0]!;
}

// The one place a PostgreSQL error code is answered instead of thrown.
async function sqlState(query: string, values: unknown[]) {
  return pool
    .query(query, values)
    .then(() => 'accepted')
    .catch((error: { code?: string }) => error.code ?? 'rejected');
}

test('an invoice draft keeps its service day and payment term and freezes the due day', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s);
  expect((await storedDates(s.scope, chain.invoice.id)).due_date).toBeNull();

  const saved = await s.repo.updateDraftContent(
    s.actor,
    chain.invoice.id,
    draftContent(chain.invoice.version, {
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
    }),
  );
  expect(saved).toMatchObject({
    serviceDate: '2030-10-25',
    paymentTermDays: 14,
    dueDate: null,
  });
  // A draft stores the input, never a computed deadline: the invoice day does not
  // exist yet, so a due day would be a guess.
  expect(await storedDates(s.scope, chain.invoice.id)).toEqual({
    service_date: '2030-10-25',
    payment_term_days: 14,
    due_date: null,
  });

  const changed = await s.repo.updateDraftContent(
    s.actor,
    chain.invoice.id,
    draftContent(saved.version, {
      serviceDate: '2030-10-24',
      paymentTermDays: 0,
    }),
  );
  expect(changed).toMatchObject({
    serviceDate: '2030-10-24',
    paymentTermDays: 0,
    dueDate: null,
  });
  await s.repo.updateDraftContent(
    s.actor,
    chain.invoice.id,
    draftContent(changed.version, {
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
    }),
  );

  const finalized = await s.repo.finalize(s.actor, chain.invoice.id);
  // 27.10.2030 + 14 days in the tenant calendar.
  expect(finalized.state).toBe('final');
  expect(await storedDates(s.scope, chain.invoice.id)).toEqual({
    service_date: '2030-10-25',
    payment_term_days: 14,
    due_date: '2030-11-10',
  });
  expect((await s.repo.get(chain.invoice.id))!).toMatchObject({
    serviceDate: '2030-10-25',
    paymentTermDays: 14,
    dueDate: '2030-11-10',
  });
  const printed = s.rendered.at(-1)!;
  expect(printed).toContain('Leistungsdatum 25.10.2030');
  expect(printed).toContain('Zahlungsziel: 14 Tage, fällig 10.11.2030');

  // Frozen means frozen: no second content write and no second finalization.
  await expect(
    s.repo.updateDraftContent(
      s.actor,
      chain.invoice.id,
      draftContent(finalized.version, { paymentTermDays: 30 }),
    ),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  await expect(
    s.repo.finalize(s.actor, chain.invoice.id),
  ).rejects.toMatchObject({ reason: 'invalid_state' });
  expect(await storedDates(s.scope, chain.invoice.id)).toEqual({
    service_date: '2030-10-25',
    payment_term_days: 14,
    due_date: '2030-11-10',
  });
});

test('the HTTP draft route accepts the two fields and answers them on read', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s),
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
    now: () => s.at,
    render: async (html: string) => {
      s.rendered.push(html);
      return Buffer.from('%PDF-1.4 synthetic ' + html.length);
    },
  });
  const cookies = { '__Host-ak-session': 'dates-' + s.scope },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:dates-' + s.scope),
    };
  try {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + chain.invoice.id + '/draft',
      cookies,
      headers,
      payload: draftContent(chain.invoice.version, {
        serviceDate: '2030-10-25',
        paymentTermDays: 14,
      }),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
      dueDate: null,
    });
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/' + chain.invoice.id,
      cookies,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
      dueDate: null,
    });
    // A body without the fields leaves them untouched: an older client must not
    // wipe a number it never knew about.
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + chain.invoice.id + '/draft',
      cookies,
      headers,
      payload: draftContent(saved.json().version),
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
    });
    // An explicit null is how an operator clears it.
    const nulled = await app.inject({
      method: 'PUT',
      url: '/api/v1/documents/' + chain.invoice.id + '/draft',
      cookies,
      headers,
      payload: draftContent(cleared.json().version, {
        serviceDate: null,
        paymentTermDays: null,
      }),
    });
    expect(nulled.statusCode).toBe(200);
    expect(nulled.json()).toMatchObject({
      serviceDate: null,
      paymentTermDays: null,
      dueDate: null,
    });
    expect(await storedDates(s.scope, chain.invoice.id)).toEqual({
      service_date: null,
      payment_term_days: null,
      due_date: null,
    });
  } finally {
    await app.close();
  }
});

test('the due day follows the tenant calendar across the 25-hour DST day', async () => {
  // 27.10.2029 23:59:59.999 local is still the 27th; one second later the
  // tenant is on the 28th. A UTC-based computation would answer both with the
  // same day and be a day late on the second.
  const before = await scenario(new Date('2029-10-27T21:59:59.999Z')),
    after = await scenario(new Date('2029-10-27T22:00:00.000Z'));
  for (const [s, expected] of [
    [before, '2029-11-10'],
    [after, '2029-11-11'],
  ] as const) {
    const chain = await invoiceDraft(s),
      saved = await s.repo.updateDraftContent(
        s.actor,
        chain.invoice.id,
        draftContent(chain.invoice.version, {
          serviceDate: '2029-10-20',
          paymentTermDays: 14,
        }),
      );
    expect(saved.dueDate).toBeNull();
    await s.repo.finalize(s.actor, chain.invoice.id);
    expect(
      (await storedDates(s.scope, chain.invoice.id)).due_date,
      String(s.at),
    ).toBe(expected);
    expect((await s.repo.get(chain.invoice.id))!.dueDate, String(s.at)).toBe(
      expected,
    );
  }
  expect(before.rendered.at(-1)).toContain('fällig 10.11.2029');
  expect(after.rendered.at(-1)).toContain('fällig 11.11.2029');
});

test('a payment term is a whole number of days between 0 and 365', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s);
  // 0 is "due immediately": the invoice day itself, printed with the same term.
  const immediately = await s.repo.updateDraftContent(
    s.actor,
    chain.invoice.id,
    draftContent(chain.invoice.version, { paymentTermDays: 0 }),
  );
  await s.repo.finalize(s.actor, chain.invoice.id);
  expect(await storedDates(s.scope, chain.invoice.id)).toEqual({
    service_date: null,
    payment_term_days: 0,
    due_date: '2030-10-27',
  });
  expect(s.rendered.at(-1)).toContain(
    'Zahlungsziel: 0 Tage, fällig 27.10.2030',
  );
  expect(immediately.paymentTermDays).toBe(0);

  for (const refused of [366, -1, 1.5, Number.NaN]) {
    const other = await scenario(),
      otherChain = await invoiceDraft(other);
    await expect(
      other.repo.updateDraftContent(
        other.actor,
        otherChain.invoice.id,
        draftContent(otherChain.invoice.version, {
          paymentTermDays: refused,
        }),
      ),
      String(refused),
    ).rejects.toMatchObject({ reason: 'invalid_content' });
    expect(await storedDates(other.scope, otherChain.invoice.id)).toEqual({
      service_date: null,
      payment_term_days: null,
      due_date: null,
    });
  }
  // The upper bound itself is legal: one year of payment term.
  const year = await scenario(),
    yearChain = await invoiceDraft(year),
    yearSaved = await year.repo.updateDraftContent(
      year.actor,
      yearChain.invoice.id,
      draftContent(yearChain.invoice.version, { paymentTermDays: 365 }),
    );
  expect(yearSaved.paymentTermDays).toBe(365);
  await year.repo.finalize(year.actor, yearChain.invoice.id);
  expect((await storedDates(year.scope, yearChain.invoice.id)).due_date).toBe(
    '2031-10-27',
  );
});

test('a service day is a real calendar day that has already happened', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s);
  // 27.10.2030 is the tenant's own today; anything later is a typing mistake.
  const today = await s.repo.updateDraftContent(
    s.actor,
    chain.invoice.id,
    draftContent(chain.invoice.version, { serviceDate: '2030-10-27' }),
  );
  expect(today.serviceDate).toBe('2030-10-27');
  for (const refused of [
    '2030-10-28',
    '2031-02-30',
    '31.10.2030',
    '',
    '2030-10-27T00:00:00Z',
  ]) {
    await expect(
      s.repo.updateDraftContent(
        s.actor,
        chain.invoice.id,
        draftContent(today.version, { serviceDate: refused }),
      ),
      refused,
    ).rejects.toMatchObject({ reason: 'invalid_content' });
  }
  expect((await s.repo.get(chain.invoice.id))!.serviceDate).toBe('2030-10-27');
  // A leap day in the past is a real day and stays legal.
  await s.repo.updateDraftContent(
    s.actor,
    chain.invoice.id,
    draftContent(today.version, { serviceDate: '2028-02-29' }),
  );
  expect((await s.repo.get(chain.invoice.id))!.serviceDate).toBe('2028-02-29');
});

test('only the invoice family carries a service day or a payment term', async () => {
  const s = await scenario(),
    offer = await s.repo.createDraft(s.actor, {
      templateId: s.templateId,
      eventId: s.eventId,
      contactId: s.contactId,
    });
  // An offer has no invoice day, so a term on it would print a deadline nobody
  // agreed to. Refused, never silently dropped.
  for (const extra of [
    { serviceDate: '2030-10-25' },
    { paymentTermDays: 14 },
  ] as Partial<DocumentDraftContent>[]) {
    await expect(
      s.repo.updateDraftContent(
        s.actor,
        offer.id,
        draftContent(offer.version, extra),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_content' });
  }
  expect((await s.repo.get(offer.id))!.serviceDate).toBeNull();
  expect((await s.repo.get(offer.id))!.paymentTermDays).toBeNull();
  // The database repeats the rule, so no other write path can invent it.
  expect(
    await sqlState(
      'UPDATE documents SET service_date=$3::date WHERE tenant_id=$1 AND id=$2',
      [s.scope, offer.id, '2030-10-25'],
    ),
  ).toBe('23514');
  expect(
    await sqlState(
      'UPDATE documents SET payment_term_days=$3 WHERE tenant_id=$1 AND id=$2',
      [s.scope, offer.id, 14],
    ),
  ).toBe('23514');
  // An advance invoice belongs to the same family: it carries its own service
  // day and its own term, exactly like the invoice it settles into.
  const depositScope = await scenario(),
    depositChain = await invoiceDraft(depositScope),
    deposit = await depositScope.repo.createDepositInvoice(
      depositScope.actor,
      depositChain.confirmation.id,
      depositChain.confirmation.version,
    ),
    depositSaved = await depositScope.repo.updateDraftContent(
      depositScope.actor,
      deposit.id,
      draftContent(deposit.version, {
        serviceDate: '2030-10-25',
        paymentTermDays: 7,
      }),
    );
  expect(depositSaved).toMatchObject({
    kind: 'deposit_invoice',
    serviceDate: '2030-10-25',
    paymentTermDays: 7,
    dueDate: null,
  });
});

test('a due day exists only on a final document with a payment term', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s);
  // A draft may keep the input, never the computed deadline.
  expect(
    await sqlState(
      'UPDATE documents SET due_date=$3::date WHERE tenant_id=$1 AND id=$2',
      [s.scope, chain.invoice.id, '2030-11-10'],
    ),
  ).toBe('23514');
  // A term is a precondition: without one the day would be invented.
  expect(
    await sqlState(
      `UPDATE documents SET state='final', number='RE-2030-0002', finalized_at=now(),
              snapshot_hash=$3, pdf_hash=$3, due_date=$4::date
        WHERE tenant_id=$1 AND id=$2`,
      [s.scope, chain.invoice.id, 'd'.repeat(64), '2030-11-10'],
    ),
  ).toBe('23514');
  // Out-of-range values are refused by the database as well as by the domain.
  expect(
    await sqlState(
      'UPDATE documents SET payment_term_days=$3 WHERE tenant_id=$1 AND id=$2',
      [s.scope, chain.invoice.id, 366],
    ),
  ).toBe('23514');
  expect(
    await sqlState(
      `INSERT INTO documents (tenant_id,id,kind,template_id,contact_id,issued_at,
        source_document_id,correction_direction,service_date,payment_term_days)
       VALUES ($1,$2,'correction',$3,$4,$5,$6,'credit',DATE '2030-10-25',14)`,
      [
        s.scope,
        randomUUID(),
        s.templateId,
        s.contactId,
        issueDay,
        randomUUID(),
      ],
    ),
  ).toBe('23503');
});

test('non-invoice documents print neither line and keep their exact bytes', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s);
  // Golden hashes captured from the rendering before this slice: an offer, a
  // confirmation and an invoice without a term must still produce exactly those
  // bytes, because the print option is only ever set where a value exists.
  const finalized = await s.repo.finalize(s.actor, chain.invoice.id);
  expect(chain.offer.snapshotHash).toBe(
    'fb3ab8369022aa5fb048e1b9996688e5b3e9354124b45fc9b742eebdf2fff86f',
  );
  expect(chain.confirmation.snapshotHash).toBe(
    'a543e89f35f9265e4854844e25e37975f332f5f52a249cb665578fa22c0ce336',
  );
  expect(finalized.snapshotHash).toBe(
    '1cd17ed94accdb0a53af00cd148acea98c670576ddcf3656a6c0372ecef72d58',
  );
  const invoiceHtml = s.rendered.at(-1)!;
  expect(invoiceHtml).not.toContain('Leistungsdatum');
  expect(invoiceHtml).not.toContain('Zahlungsziel');
  // The offer and the confirmation keep the only deadline they ever printed.
  expect(s.rendered.find((html) => html.includes('Gültig bis'))).toBeDefined();
  const confirmationHtml = s.rendered.filter((html) =>
      html.includes('AB-2030-0001'),
    ),
    offerHtml = s.rendered.filter((html) => html.includes('AN-2030-0001'));
  expect(offerHtml.length).toBeGreaterThan(0);
  for (const html of [...offerHtml, ...confirmationHtml])
    expect(html).not.toContain('Leistungsdatum');
  for (const html of [...offerHtml, ...confirmationHtml])
    expect(html).not.toContain('Zahlungsziel');
});

test('another tenant neither reads nor changes the dates of an invoice', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s),
    saved = await s.repo.updateDraftContent(
      s.actor,
      chain.invoice.id,
      draftContent(chain.invoice.version, {
        serviceDate: '2030-10-25',
        paymentTermDays: 14,
      }),
    ),
    other = await scenario();
  // A foreign id is not found, never a leak of another tenant's dates.
  expect(await other.repo.get(chain.invoice.id)).toBeNull();
  await expect(
    other.repo.updateDraftContent(
      other.actor,
      chain.invoice.id,
      draftContent(1, { paymentTermDays: 30 }),
    ),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect(await storedDates(s.scope, chain.invoice.id)).toEqual({
    service_date: '2030-10-25',
    payment_term_days: 14,
    due_date: null,
  });
  expect(saved.version).toBe(2);
  // The projection of the other tenant carries the same keys and no values.
  const foreign = await other.repo.list({ include: 'offer' });
  expect(foreign.map((row) => row.id)).not.toContain(chain.invoice.id);
});

test('the opt-in projection carries the three invoice keys', async () => {
  const s = await scenario(),
    chain = await invoiceDraft(s),
    saved = await s.repo.updateDraftContent(
      s.actor,
      chain.invoice.id,
      draftContent(chain.invoice.version, {
        serviceDate: '2030-10-25',
        paymentTermDays: 14,
      }),
    );
  expect(saved.dueDate).toBeNull();
  const rows = await s.repo.list({ include: 'offer' }),
    invoiceRow = rows.find((row) => row.id === chain.invoice.id)!,
    offerRow = rows.find((row) => row.id === chain.offer.id)!,
    confirmationRow = rows.find((row) => row.id === chain.confirmation.id)!;
  expect(invoiceRow).toMatchObject({
    serviceDate: '2030-10-25',
    paymentTermDays: 14,
    dueDate: null,
  });
  await s.repo.finalize(s.actor, chain.invoice.id);
  const finalizedRow = (await s.repo.list({ include: 'offer' })).find(
    (row) => row.id === chain.invoice.id,
  )!;
  expect(finalizedRow).toMatchObject({
    serviceDate: '2030-10-25',
    paymentTermDays: 14,
    dueDate: '2030-11-10',
  });
  // Outside the invoice family the three keys are present and empty: no reader
  // has to guess a shape.
  for (const row of [offerRow, confirmationRow])
    expect(row).toMatchObject({
      serviceDate: null,
      paymentTermDays: null,
      dueDate: null,
    });
  // The metadata projection stays exactly as narrow as it was.
  const metadata = await s.repo.list({ include: 'metadata' });
  expect(Object.keys(metadata[0]!).sort()).not.toContain('dueDate');
});
