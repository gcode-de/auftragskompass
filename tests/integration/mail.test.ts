import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStorageAdapter } from '../../packages/core/src/storage.js';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { accessRepository } from '../../packages/core/src/access.js';
import { decryptTelegramToken } from '../../packages/core/src/telegram.js';
import { registerMailForwardSettingsRoutes } from '../../packages/core/src/mail-forward.js';
import {
  claimMailOutboxJob,
  mailRepository,
  registerMailRoutes,
  runMailOutboxPass,
  startMailOutbox,
} from '../../packages/core/src/mail.js';
import { escapeMailHtmlText } from '../../packages/core/src/mail-content.js';
import type {
  MailSendContent,
  MailSendEnvelope,
  MailSendResult,
  MailSender,
  MailSenderAccount,
} from '../../packages/core/src/mail-sender.js';

// MAIL-021-A: synthetic tenant, contact, event and mail only. No provider is
// contacted and every address ends in @example.invalid.
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  email = 'mail.owner@example.invalid',
  password = 'Fictional password 123!',
  encryptionKey = Buffer.alloc(32, 5);
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
let container: StartedPostgreSqlContainer,
  pool: Pool,
  app: FastifyInstance,
  actorId: string,
  otherActorId: string,
  accountId: string,
  otherAccountId: string,
  contactId: string,
  eventId: string,
  otherContactId: string,
  // MAIL-DOC-01: one synthetic finalized invoice with a content-addressed PDF
  // artefact, its draft and withdrawn siblings, and a finalized row of the
  // other tenant. No real document, no real customer, no real PDF.
  mailStore: ReturnType<typeof localStorageAdapter>,
  mailStoreRoot: string,
  syntheticPdf: Buffer,
  pdfHash: string,
  finalDocumentId: string,
  draftDocumentId: string,
  withdrawnDocumentId: string,
  foreignFinalDocumentId: string,
  missingArtifactDocumentId: string;

async function seedContact(tenant: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,
       city,country,email,phone,mobile,phone_key,mobile_key,state)
     VALUES ($1,$2,'private','Fictional Mail Contact','','','','','DE',
             'synthetic.contact@example.invalid','','','','','active')`,
    [tenant, id],
  );
  return id;
}
async function seedEvent(tenant: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO events (tenant_id,id,name,status,source,time_zone,description,notes_html)
     VALUES ($1,$2,'Fictional mail event','inquiry','manual','Europe/Berlin','','')`,
    [tenant, id],
  );
  return id;
}
async function seedTemplate(tenant: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO document_templates
       (tenant_id,id,kind,name,subject,intro_text,outro_text,validity_days,state,version)
     VALUES ($1,$2,'invoice','Fictional invoice template','Ihr Beleg','','',14,'active',1)`,
    [tenant, id],
  );
  return id;
}
// A final row needs a number, the frozen snapshot hash and the PDF hash; a
// draft must carry none of them. The row is only a projection - the mail slice
// reads the artefact through the same content-addressed store as the PDF route.
async function seedDocument(input: {
  tenant: string;
  templateId: string;
  kind: 'invoice' | 'offer';
  state: 'draft' | 'final' | 'withdrawn';
  number: string | null;
  pdfHash: string | null;
  contactId?: string | null;
  eventId?: string | null;
}) {
  const id = randomUUID(),
    final = input.state === 'final';
  await pool.query(
    `INSERT INTO documents
       (tenant_id,id,kind,template_id,event_id,contact_id,number,state,issued_at,
        finalized_at,snapshot_hash,pdf_hash,net_minor,tax_minor,gross_minor,version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),
             CASE WHEN $9 THEN now() ELSE NULL END,
             CASE WHEN $9 THEN $10 ELSE NULL END,$11,10000,1900,11900,1)`,
    [
      input.tenant,
      id,
      input.kind,
      input.templateId,
      input.eventId ?? null,
      input.contactId ?? null,
      input.number,
      input.state,
      final,
      'a'.repeat(64),
      input.pdfHash,
    ],
  );
  return id;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    email,
    'Fictional tenant',
    'Europe/Berlin',
  );
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other.mail.owner@example.invalid',
    'Fictional other tenant',
    'Europe/Berlin',
  );
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.mail.owner',
    () => password,
  );
  await bootstrapPassword(
    pool,
    otherTenantId,
    'other.mail.owner@example.invalid',
    'fictional.other.mail.owner',
    () => password,
  );
  const owners = await pool.query<{ tenant_id: string; user_id: string }>(
    'SELECT tenant_id,user_id FROM allowed_accounts WHERE tenant_id=ANY($1)',
    [[tenantId, otherTenantId]],
  );
  actorId = owners.rows.find((row) => row.tenant_id === tenantId)!.user_id;
  otherActorId = owners.rows.find(
    (row) => row.tenant_id === otherTenantId,
  )!.user_id;

  contactId = await seedContact(tenantId);
  otherContactId = await seedContact(otherTenantId);
  eventId = await seedEvent(tenantId);
  const otherEventId = await seedEvent(otherTenantId);

  // MAIL-DOC-01: a synthetic PDF artefact, hash-addressed exactly like a real
  // final document. The bytes are the fixture the mail attachment must carry
  // unchanged; nothing is re-rendered for the mail.
  mailStoreRoot = mkdtempSync(join(tmpdir(), 'ak-mail-documents-'));
  mailStore = localStorageAdapter({ root: mailStoreRoot });
  syntheticPdf = Buffer.from(
    '%PDF-1.4\n% fictional synthetic document for the mail fixture\n' +
      '1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n',
    'latin1',
  );
  pdfHash = createHash('sha256').update(syntheticPdf).digest('hex');
  await mailStore.put(pdfHash + '.pdf', syntheticPdf);
  const templateId = await seedTemplate(tenantId),
    otherTemplateId = await seedTemplate(otherTenantId);
  finalDocumentId = await seedDocument({
    tenant: tenantId,
    templateId,
    kind: 'invoice',
    state: 'final',
    number: 'RE-2030-0001',
    pdfHash,
    contactId,
    eventId,
  });
  draftDocumentId = await seedDocument({
    tenant: tenantId,
    templateId,
    kind: 'invoice',
    state: 'draft',
    number: null,
    pdfHash: null,
    contactId,
    eventId,
  });
  withdrawnDocumentId = await seedDocument({
    tenant: tenantId,
    templateId,
    kind: 'offer',
    state: 'withdrawn',
    number: 'AN-2030-0009',
    pdfHash: null,
    contactId,
    eventId,
  });
  // Final, but its artefact was never stored: an attachment must not be
  // invented from the row.
  missingArtifactDocumentId = await seedDocument({
    tenant: tenantId,
    templateId,
    kind: 'invoice',
    state: 'final',
    number: 'RE-2030-0002',
    pdfHash: 'b'.repeat(64),
    contactId,
    eventId,
  });
  foreignFinalDocumentId = await seedDocument({
    tenant: otherTenantId,
    templateId: otherTemplateId,
    kind: 'invoice',
    state: 'final',
    number: 'RE-2099-0001',
    pdfHash,
    contactId: otherContactId,
    eventId: otherEventId,
  });

  accountId = (
    await mailRepository(pool, tenantId, encryptionKey).saveAccount(actorId, {
      name: 'Fictional business mailbox',
      provider: 'imap-smtp',
      imapHost: 'imap.example.invalid',
      imapPort: 993,
      smtpHost: 'smtp.example.invalid',
      smtpPort: 465,
      username: 'synthetic.sender@example.invalid',
      secret: 'synthetic-smtp-secret',
    })
  ).id;
  otherAccountId = (
    await mailRepository(pool, otherTenantId, encryptionKey).saveAccount(
      otherActorId,
      {
        name: 'Fictional other mailbox',
        provider: 'imap-smtp',
        username: 'other.sender@example.invalid',
        secret: 'synthetic-other-secret',
        enabled: false,
      },
    )
  ).id;

  app = Fastify();
  await registerAuth(app, pool, config);
  registerMailForwardSettingsRoutes(app, pool, tenantId);
  registerMailRoutes(app, pool, tenantId, {
    store: mailStore,
    origin: config.origin,
  });
}, 120000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
  if (mailStoreRoot) rmSync(mailStoreRoot, { recursive: true, force: true });
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    accountId,
    direction: 'out' as const,
    folder: 'drafts' as const,
    subject: 'Fictional offer follow-up',
    bodyText: 'Synthetic body text.',
    from: 'synthetic.sender@example.invalid',
    to: 'synthetic.contact@example.invalid',
    ...overrides,
  };
}

// MAIL-021-B: one adapter stub per test instead of a provider. It records what
// it was asked to send and answers with the outcome the test needs.
function stubSender(result: MailSendResult, delayMs = 0) {
  const calls: { envelope: MailSendEnvelope; content: MailSendContent }[] = [];
  const accounts: MailSenderAccount[] = [];
  const createSender = (account: MailSenderAccount): MailSender => {
    accounts.push(account);
    return {
      async send(envelope, content) {
        calls.push({ envelope, content });
        if (delayMs)
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        return result;
      },
    };
  };
  return { calls, accounts, createSender };
}

async function signedIn() {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.mail.owner', password },
  });
  const cookie = login.cookies[0]!,
    headers = {
      cookie: `${cookie.name}=${cookie.value}`,
      origin: config.origin,
    };
  const csrf = {
    'x-csrf-token': (await app.inject({ url: '/auth/me', headers })).json()
      .csrfToken,
  };
  return { headers, csrf };
}

test('keeps edit, folder and send state separate and links contact and event of the same tenant', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, {
    ...draft(),
    cc: 'synthetic.copy@example.invalid',
    bcc: 'synthetic.blind@example.invalid',
    contactId,
    eventId,
    threadKey: 'fictional-thread-1',
  });
  expect(message).toMatchObject({
    accountId,
    direction: 'out',
    folder: 'drafts',
    editState: 'open',
    sendState: 'none',
    contactId,
    eventId,
    threadKey: 'fictional-thread-1',
    sentAt: null,
  });
  // A second mail of the same thread is its own message.
  const reply = await repo.createMessage(actorId, {
    ...draft({ subject: 'Re: Fictional offer follow-up' }),
    contactId,
    threadKey: 'fictional-thread-1',
  });
  expect(reply.id).not.toBe(message.id);
  expect((await repo.get(reply.id)).contactId).toBe(contactId);

  // Scheduling moves the send state and mirrors the outbox claim, but the
  // editorial state stays untouched - exactly the separation BKP021.a asks for.
  await repo.scheduleSend(actorId, message.id, 'fictional-key-axes');
  expect((await repo.get(message.id)).sendState).toBe('scheduled');
  expect((await repo.get(message.id)).editState).toBe('open');
  expect((await repo.get(message.id)).folder).toBe('drafts');

  await pool.query(
    "UPDATE mail_messages SET edit_state='done', folder='trash' WHERE tenant_id=$1 AND id=$2",
    [tenantId, message.id],
  );
  const moved = await repo.get(message.id);
  expect(moved).toMatchObject({
    editState: 'done',
    folder: 'trash',
    sendState: 'scheduled',
  });

  // Lists filter by folder, contact and event without leaking another tenant.
  expect((await repo.list({ folder: 'trash' })).map((row) => row.id)).toEqual([
    message.id,
  ]);
  expect((await repo.list({ contactId })).map((row) => row.id).sort()).toEqual(
    [message.id, reply.id].sort(),
  );
  expect((await repo.list({ eventId })).map((row) => row.id)).toEqual([
    message.id,
  ]);
  const foreign = mailRepository(pool, otherTenantId, encryptionKey);
  expect(await foreign.list()).toEqual([]);
  await expect(foreign.get(message.id)).rejects.toMatchObject({
    reason: 'not_found',
  });
});

test('rejects a contact or event of another tenant and an inconsistent direction', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  await expect(
    repo.createMessage(actorId, { ...draft(), contactId: otherContactId }),
  ).rejects.toMatchObject({ reason: 'invalid_link' });
  await expect(
    mailRepository(pool, otherTenantId, encryptionKey).createMessage(
      otherActorId,
      { ...draft(), accountId: otherAccountId, contactId, eventId },
    ),
  ).rejects.toMatchObject({ reason: 'invalid_link' });
  // An incoming mail lives in the inbox and has no send state of its own.
  await expect(
    repo.createMessage(actorId, {
      ...draft(),
      direction: 'in',
      folder: 'drafts',
      to: '',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_folder' });
  const incoming = await repo.createMessage(actorId, {
    ...draft(),
    direction: 'in',
    folder: 'inbox',
  });
  expect(incoming.sendState).toBe('none');
  // A header cannot smuggle a second header.
  await expect(
    repo.createMessage(actorId, {
      ...draft(),
      subject: 'Fictional\r\nBcc: sneaky@example.invalid',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_subject' });
  await expect(
    repo.createMessage(actorId, {
      ...draft(),
      to: 'not-an-address',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_recipients' });
  await expect(
    repo.createMessage(actorId, {
      ...draft(),
      to: 'synthetic.one@example.invalid,,synthetic.two@example.invalid',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_recipients' });
  await expect(
    repo.createMessage(actorId, {
      ...draft(),
      direction: 'sideways' as never,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_direction' });
  await expect(
    repo.createMessage(actorId, { ...draft(), folder: 'sent' }),
  ).rejects.toMatchObject({ reason: 'invalid_folder' });
  await expect(
    repo.createMessage(actorId, {
      ...draft(),
      bodyText: 'control \u0000 byte',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_body' });
  // An account is not created twice under the same name, and a port is a port.
  await expect(
    repo.saveAccount(actorId, {
      name: 'Fictional business mailbox',
      secret: 'synthetic-duplicate',
    }),
  ).rejects.toMatchObject({ reason: 'already_exists' });
  await expect(
    repo.saveAccount(actorId, {
      name: 'Fictional invalid port',
      imapPort: 0,
      secret: 'synthetic-port',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_port' });
  await expect(
    repo.saveAccount(actorId, { name: 'Fictional keyless enabled account' }),
  ).rejects.toMatchObject({ reason: 'secret_required' });
  const disabled = await repo.saveAccount(actorId, {
    name: 'Fictional paused mailbox',
    enabled: false,
  });
  expect(disabled.enabled).toBe(false);
  expect((await repo.listAccounts()).map((row) => row.id)).toContain(
    disabled.id,
  );
});

test('stores an SMTP secret only in the same encrypted envelope as the Telegram token', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const sealed = await pool.query<{ token: Buffer }>(
    'SELECT secret_ciphertext AS token FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
    [tenantId, accountId],
  );
  const row = (
    await pool.query(
      'SELECT to_jsonb(a) AS value FROM mail_accounts a WHERE tenant_id=$1 AND id=$2',
      [tenantId, accountId],
    )
  ).rows[0]!.value;
  expect(JSON.stringify(row)).not.toContain('synthetic-smtp-secret');
  // Same envelope, same helper: no second crypto exists for mail credentials.
  expect(
    decryptTelegramToken(
      {
        ciphertext: sealed.rows[0]!.token,
        nonce: (
          await pool.query(
            'SELECT secret_nonce AS value FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
            [tenantId, accountId],
          )
        ).rows[0]!.value,
        tag: (
          await pool.query(
            'SELECT secret_tag AS value FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
            [tenantId, accountId],
          )
        ).rows[0]!.value,
      },
      encryptionKey,
    ),
  ).toBe('synthetic-smtp-secret');
  const listed = await repo.listAccounts();
  expect(JSON.stringify(listed)).not.toContain('synthetic-smtp-secret');
  await expect(
    mailRepository(pool, tenantId, null).saveAccount(actorId, {
      ...draft(),
      name: 'Fictional keyless mailbox',
      provider: 'imap-smtp',
      username: 'keyless@example.invalid',
      secret: 'must-not-be-stored',
    }),
  ).rejects.toMatchObject({ reason: 'encryption_unavailable' });
});

test('creates exactly one outbox job per idempotency key, also under parallel requests', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  const first = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-once',
  );
  expect(first.created).toBe(true);
  expect(first.job).toMatchObject({
    messageId: message.id,
    idempotencyKey: 'fictional-key-once',
    state: 'pending',
    attempts: 0,
    lastErrorCode: null,
    sentAt: null,
  });
  const repeat = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-once',
  );
  expect(repeat.created).toBe(false);
  expect(repeat.job.id).toBe(first.job.id);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM mail_outbox WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, message.id],
      )
    ).rows[0]!.count,
  ).toBe(1);
  // A second key while the first job is still open would be a second send.
  await expect(
    repo.scheduleSend(actorId, message.id, 'fictional-key-second'),
  ).rejects.toMatchObject({ reason: 'not_sendable' });

  const parallelMessage = await repo.createMessage(actorId, draft());
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      repo.scheduleSend(actorId, parallelMessage.id, 'fictional-key-parallel'),
    ),
  );
  expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM mail_outbox WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, parallelMessage.id],
      )
    ).rows[0]!.count,
  ).toBe(1);
  // The same key belongs to one message only; reusing it elsewhere is a conflict.
  const otherMessage = await repo.createMessage(actorId, draft());
  await expect(
    repo.scheduleSend(actorId, otherMessage.id, 'fictional-key-once'),
  ).rejects.toMatchObject({ reason: 'idempotency_conflict' });

  const audits = await pool.query<{ action: string; record_id: string }>(
    "SELECT action,record_id::text FROM audit_events WHERE tenant_id=$1 AND action IN ('mail.message_created','mail.send_scheduled')",
    [tenantId],
  );
  expect(
    audits.rows.filter((row) => row.action === 'mail.message_created').length,
  ).toBeGreaterThanOrEqual(4);
  expect(
    audits.rows.filter(
      (row) =>
        row.action === 'mail.send_scheduled' && row.record_id === first.job.id,
    ),
  ).toHaveLength(1);
});

test('claims a due job once, survives a restart and reports provider_missing honestly', async () => {
  // Earlier tests leave their own queued jobs behind; this test owns the queue.
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  const { job } = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-worker',
  );

  const one: PoolClient = await pool.connect(),
    two: PoolClient = await pool.connect();
  try {
    await one.query('BEGIN');
    await two.query('BEGIN');
    expect(await claimMailOutboxJob(one)).toMatchObject({
      id: job.id,
      messageId: message.id,
      attempts: 1,
    });
    // The row is locked for the first claimer: no double send from a second loop.
    expect(await claimMailOutboxJob(two)).toBeNull();
    await one.query('ROLLBACK');
    await two.query('ROLLBACK');
  } finally {
    one.release();
    two.release();
  }
  expect((await repo.get(message.id)).sendState).toBe('scheduled');

  // Without a provider adapter the worker does not pretend to have sent: the
  // message stays failed with a redacted category and no sent timestamp.
  expect(await runMailOutboxPass(pool)).toBe(true);
  const failed = (
    await pool.query(
      'SELECT state,attempts,last_error_code,next_attempt_at,sent_at,locked_at FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.id],
    )
  ).rows[0]!;
  expect(failed).toMatchObject({
    state: 'failed',
    attempts: 1,
    last_error_code: 'provider_missing',
    sent_at: null,
    locked_at: null,
  });
  expect(new Date(failed.next_attempt_at).getTime()).toBeGreaterThan(
    Date.now(),
  );
  expect((await repo.get(message.id)).sendState).toBe('failed');

  // The backoff holds: an immediate second pass finds nothing to claim.
  expect(await runMailOutboxPass(pool)).toBe(false);
  expect(
    (
      await pool.query(
        'SELECT attempts FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0]!.attempts,
  ).toBe(1);

  // After the backoff the retry is an explicit forward step, still failed.
  await pool.query(
    "UPDATE mail_outbox SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
    [tenantId, job.id],
  );
  expect(await runMailOutboxPass(pool)).toBe(true);
  expect(
    (
      await pool.query(
        'SELECT state,attempts,last_error_code,last_error_code IS NOT NULL AS categorized FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({
    state: 'failed',
    attempts: 2,
    last_error_code: 'provider_missing',
  });

  // A crashed claim leaves a stale lease; only after the lease expires may a
  // restarted worker pick the same job up again.
  await pool.query(
    `UPDATE mail_outbox
        SET state='sending', locked_at=now()-interval '3 minutes',
            last_error_code=NULL, next_attempt_at=now()-interval '1 second'
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, job.id],
  );
  expect(await runMailOutboxPass(pool)).toBe(true);
  expect(
    (
      await pool.query(
        'SELECT attempts FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0]!.attempts,
  ).toBe(3);

  // A delivered job is terminal: never claimed again, never re-sent.
  await pool.query(
    "UPDATE mail_outbox SET state='sent', sent_at=now(), last_error_code=NULL, locked_at=NULL WHERE tenant_id=$1 AND id=$2",
    [tenantId, job.id],
  );
  expect(await runMailOutboxPass(pool)).toBe(false);
});

test('the outbox loop stops cleanly and logs only redacted categories', async () => {
  const failures: unknown[] = [];
  const loop = startMailOutbox(pool, (failure) => failures.push(failure));
  await loop.stop();
  expect(loop.ready()).toBe(true);
  expect(JSON.stringify(failures)).not.toContain('@example.invalid');
});

test('refuses a send order that is not an outgoing draft with a recipient', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const incoming = await repo.createMessage(actorId, {
    ...draft(),
    direction: 'in',
    folder: 'inbox',
  });
  await expect(
    repo.scheduleSend(actorId, incoming.id, 'fictional-incoming-key'),
  ).rejects.toMatchObject({ reason: 'not_sendable' });

  const recipientless = await repo.createMessage(actorId, draft({ to: '' }));
  await expect(
    repo.scheduleSend(actorId, recipientless.id, 'fictional-recipientless-key'),
  ).rejects.toMatchObject({ reason: 'invalid_recipients' });

  const trashed = await repo.createMessage(actorId, draft());
  await pool.query(
    "UPDATE mail_messages SET folder='trash' WHERE tenant_id=$1 AND id=$2",
    [tenantId, trashed.id],
  );
  await expect(
    repo.scheduleSend(actorId, trashed.id, 'fictional-trashed-key'),
  ).rejects.toMatchObject({ reason: 'not_sendable' });
  // Unbekannte Ordner sind ein Tippfehler, kein leerer Filter.
  await expect(repo.list({ folder: 'spam' })).rejects.toMatchObject({
    reason: 'invalid_folder',
  });
});

test('worker reports database failures instead of inventing a delivery', async () => {
  const claimFailures: unknown[] = [];
  const brokenClaim = {
    connect: async () => ({
      query: async (text: string) => {
        if (text === 'BEGIN') throw new Error('fictional database outage');
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  expect(
    await runMailOutboxPass(brokenClaim as never, (failure) =>
      claimFailures.push(failure),
    ),
  ).toBe(false);
  expect(claimFailures).toEqual([{ type: 'database', stage: 'claim' }]);

  const finalizeFailures: unknown[] = [];
  const brokenWrite = {
    connect: async () => ({
      query: async (text: string) => {
        if (text === 'BEGIN') return {};
        if (text.includes('WITH picked'))
          return {
            rows: [
              {
                tenant_id: tenantId,
                id: randomUUID(),
                message_id: randomUUID(),
                attempts: 1,
              },
            ],
          };
        if (text.includes("state='failed'"))
          throw new Error('fictional write outage');
        return {};
      },
      release: () => {},
    }),
  };
  expect(
    await runMailOutboxPass(brokenWrite as never, (failure) =>
      finalizeFailures.push(failure),
    ),
  ).toBe(false);
  expect(finalizeFailures).toEqual([{ type: 'database', stage: 'finalize' }]);

  // The loop never crashes when even the pool cannot hand out a client.
  const loopFailures: unknown[] = [];
  const loop = startMailOutbox(
    {
      connect: async () => {
        throw new Error('fictional pool outage');
      },
    } as never,
    (failure) => loopFailures.push(failure),
    60000,
  );
  await vi.waitFor(() =>
    expect(loopFailures).toEqual([{ type: 'database', stage: 'claim' }]),
  );
  await loop.stop();
  expect(JSON.stringify(loopFailures)).not.toContain('fictional pool outage');
});

test('routes require a session and CSRF, list and detail stay tenant-scoped, send schedules once', async () => {
  expect((await app.inject('/api/v1/mail/messages')).statusCode).toBe(401);
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.mail.owner', password },
  });
  expect(login.statusCode).toBe(204);
  const cookie = login.cookies[0]!;
  const headers = {
    cookie: `${cookie.name}=${cookie.value}`,
    origin: config.origin,
  };
  const csrf = {
    'x-csrf-token': (await app.inject({ url: '/auth/me', headers })).json()
      .csrfToken,
  };

  const message = await mailRepository(
    pool,
    tenantId,
    encryptionKey,
  ).createMessage(actorId, draft({ subject: 'Fictional routed mail' }));
  const list = await app.inject({ url: '/api/v1/mail/messages', headers });
  expect(list.statusCode).toBe(200);
  expect(list.json().map((row: { id: string }) => row.id)).toContain(
    message.id,
  );
  expect(list.body).not.toContain('Synthetic body text.');
  const detail = await app.inject({
    url: `/api/v1/mail/messages/${message.id}`,
    headers,
  });
  expect(detail.json()).toMatchObject({
    id: message.id,
    subject: 'Fictional routed mail',
    bodyText: 'Synthetic body text.',
    outbox: null,
  });
  expect(
    (
      await app.inject({
        url: `/api/v1/mail/messages/${randomUUID()}`,
        headers,
      })
    ).statusCode,
  ).toBe(404);
  // A mutation without CSRF never schedules a send.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/mail/messages/${message.id}/send`,
        headers,
        payload: { idempotencyKey: 'fictional-route-key' },
      })
    ).statusCode,
  ).toBe(403);
  const scheduled = await app.inject({
    method: 'POST',
    url: `/api/v1/mail/messages/${message.id}/send`,
    headers: { ...headers, ...csrf },
    payload: { idempotencyKey: 'fictional-route-key' },
  });
  expect(scheduled.statusCode).toBe(201);
  expect(scheduled.json()).toMatchObject({
    state: 'pending',
    messageId: message.id,
  });
  const repeated = await app.inject({
    method: 'POST',
    url: `/api/v1/mail/messages/${message.id}/send`,
    headers: { ...headers, ...csrf },
    payload: { idempotencyKey: 'fictional-route-key' },
  });
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json().id).toBe(scheduled.json().id);
  // A second key on the same pending message is a second send: refused.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/mail/messages/${message.id}/send`,
        headers: { ...headers, ...csrf },
        payload: { idempotencyKey: 'fictional-route-key-second' },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await app.inject({ url: '/api/v1/mail/messages?folder=spam', headers }))
      .statusCode,
  ).toBe(400);
  // Validation stays server-side: an empty key is not an idempotency key.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/mail/messages/${message.id}/send`,
        headers: { ...headers, ...csrf },
        payload: { idempotencyKey: '' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({ url: `/api/v1/mail/messages/${message.id}`, headers })
    ).json().outbox,
  ).toMatchObject({ id: scheduled.json().id, state: 'pending' });
});

test('mail routes answer 403 for a session without an active membership', async () => {
  const forbidden = Fastify();
  forbidden.decorateRequest('authSession', null);
  forbidden.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  registerMailRoutes(forbidden, pool, tenantId);
  expect((await forbidden.inject('/api/v1/mail/messages')).statusCode).toBe(
    403,
  );
  expect(
    (
      await forbidden.inject({
        method: 'POST',
        url: `/api/v1/mail/messages/${randomUUID()}/send`,
        payload: { idempotencyKey: 'fictional-forbidden-key' },
      })
    ).statusCode,
  ).toBe(403);
  // MAIL-021-B: the retry is an administrator action as well.
  expect(
    (
      await forbidden.inject({
        method: 'POST',
        url: `/api/v1/mail/outbox/${randomUUID()}/retry`,
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  await forbidden.close();
});

// MAIL-UX-02: an unexpected failure answers the stable `internal` code - the
// full error stays in the server log, the reply is never a foreign body.
test('an unexpected failure answers the stable internal code', async () => {
  const broken = Fastify();
  broken.decorateRequest('authSession', null);
  broken.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  const brokenPool = {
    query: () => {
      throw new Error('Synthetischer Datenbankausfall');
    },
    connect: () => {
      throw new Error('Synthetischer Datenbankausfall');
    },
  } as unknown as Parameters<typeof registerMailRoutes>[1];
  registerMailRoutes(broken, brokenPool, tenantId);
  const reply = await broken.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send/preview',
    payload: { documentId: randomUUID() },
  });
  expect(reply.statusCode).toBe(500);
  expect(reply.json()).toEqual({ error: 'internal' });
  await broken.close();
});

// MAIL-021-B: from here on the pass runs with an adapter. Every case still uses
// the synthetic tenant and a stub sender, never a provider.
test('delivers a claimed job once, records sent_at and audits mail.sent', async () => {
  // Earlier tests leave their own queued jobs behind; this test owns the queue.
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, {
    ...draft(),
    cc: 'synthetic.copy@example.invalid',
    bcc: 'synthetic.blind@example.invalid',
  });
  const { job } = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-sent',
  );
  const { calls, accounts, createSender } = stubSender('sent');
  const failures: unknown[] = [];
  expect(
    await runMailOutboxPass(pool, (failure) => failures.push(failure), {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(failures).toEqual([]);
  expect(calls).toHaveLength(1);
  // The account reaches the adapter with the sealed secret decrypted - the only
  // place the plaintext exists is this attempt. MAIL-ACCOUNT-01: the stored
  // transport choice travels with it ('starttls' is the stored default for
  // accounts created without one).
  expect(accounts).toEqual([
    {
      host: 'smtp.example.invalid',
      port: 465,
      username: 'synthetic.sender@example.invalid',
      secret: 'synthetic-smtp-secret',
      security: 'starttls',
    },
  ]);
  // The adapter receives the sealed secret decrypted, addresses as a list and
  // BCC in the envelope - never in the visible header fields.
  expect(calls[0]!.envelope).toEqual({
    from: 'synthetic.sender@example.invalid',
    to: ['synthetic.contact@example.invalid'],
    cc: ['synthetic.copy@example.invalid'],
    bcc: ['synthetic.blind@example.invalid'],
  });
  expect(calls[0]!.content).toEqual({
    subject: 'Fictional offer follow-up',
    text: 'Synthetic body text.',
    html: null,
    messageId: null,
  });
  const row = (
    await pool.query(
      'SELECT state,sent_at,last_error_code,locked_at FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.id],
    )
  ).rows[0]!;
  expect(row).toMatchObject({
    state: 'sent',
    last_error_code: null,
    locked_at: null,
  });
  expect(row.sent_at).not.toBeNull();
  const sent = await repo.get(message.id);
  expect(sent).toMatchObject({ sendState: 'sent', folder: 'sent' });
  expect(sent.sentAt).not.toBeNull();
  // The audit names the outbox job and no operator: the worker acted, and no
  // address, subject or provider answer is recorded.
  const audit = await pool.query<{
    actor_id: string | null;
    record_id: string;
  }>(
    "SELECT actor_id,record_id::text FROM audit_events WHERE tenant_id=$1 AND action='mail.sent'",
    [tenantId],
  );
  expect(audit.rows).toEqual([{ actor_id: null, record_id: job.id }]);
  // A delivered job is terminal: a second pass sends nothing.
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(false);
  expect(calls).toHaveLength(1);
});

test('a definitely refused attempt is failed with a redacted category and retried by backoff', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  const { job } = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-rejected',
  );
  const { createSender } = stubSender({
    failed: 'provider_recipient_rejected',
  });
  const failures: unknown[] = [];
  expect(
    await runMailOutboxPass(pool, (failure) => failures.push(failure), {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(failures).toEqual([
    { type: 'failed', code: 'provider_recipient_rejected' },
  ]);
  // Redaction: the closed category, never a server answer or an address.
  expect(JSON.stringify(failures)).not.toContain('@');
  const row = (
    await pool.query(
      'SELECT state,attempts,last_error_code,next_attempt_at,sent_at,locked_at FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.id],
    )
  ).rows[0]!;
  expect(row).toMatchObject({
    state: 'failed',
    attempts: 1,
    last_error_code: 'provider_recipient_rejected',
    sent_at: null,
    locked_at: null,
  });
  expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
  expect((await repo.get(message.id)).sendState).toBe('failed');
  // A safe failure is retried by the existing backoff, not on the next second.
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(false);
  expect(
    (
      await pool.query(
        'SELECT attempts FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0]!.attempts,
  ).toBe(1);
});

test('an unclear outcome is terminal until an operator retries it explicitly', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  const { job } = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-uncertain',
  );
  const { createSender } = stubSender('uncertain');
  const failures: unknown[] = [];
  expect(
    await runMailOutboxPass(pool, (failure) => failures.push(failure), {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(failures).toEqual([{ type: 'uncertain' }]);
  const row = (
    await pool.query(
      'SELECT state,last_error_code,sent_at,locked_at FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.id],
    )
  ).rows[0]!;
  expect(row).toMatchObject({
    state: 'uncertain',
    last_error_code: 'provider_uncertain',
    sent_at: null,
    locked_at: null,
  });
  expect((await repo.get(message.id)).sendState).toBe('uncertain');
  // Even a due, unlocked row is never picked up again automatically: a second
  // attempt could duplicate a mail the provider already accepted.
  await pool.query(
    "UPDATE mail_outbox SET next_attempt_at=now()-interval '1 hour' WHERE tenant_id=$1 AND id=$2",
    [tenantId, job.id],
  );
  const { calls, createSender: afterUncertain } = stubSender('sent');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender: afterUncertain,
      key: encryptionKey,
    }),
  ).toBe(false);
  expect(calls).toEqual([]);
  // And a second send order for the same message is refused, not queued.
  await expect(
    repo.scheduleSend(actorId, message.id, 'fictional-key-uncertain-second'),
  ).rejects.toMatchObject({ reason: 'not_sendable' });
});

test('the explicit retry moves only an uncertain job back to pending', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  const { job } = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-retry',
  );
  const { headers, csrf } = await signedIn();
  const retry = (id: string, withCsrf = true) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/mail/outbox/${id}/retry`,
      headers: withCsrf ? { ...headers, ...csrf } : headers,
      payload: {},
    });
  // Only an unclear outcome may be repeated; a pending order is not.
  expect((await retry(job.id)).statusCode).toBe(409);
  // A mutation without CSRF never touches the job.
  expect((await retry(job.id, false)).statusCode).toBe(403);
  expect((await retry(randomUUID())).statusCode).toBe(404);

  const { createSender } = stubSender('uncertain');
  await runMailOutboxPass(pool, () => {}, {
    createSender,
    key: encryptionKey,
  });
  const repeated = await retry(job.id);
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json()).toMatchObject({
    id: job.id,
    messageId: message.id,
    state: 'pending',
    lastErrorCode: null,
  });
  // The retry is the same job: no second order, and the attempt count stays a
  // record of what already happened.
  expect(repeated.json().attempts).toBe(1);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM mail_outbox WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, message.id],
      )
    ).rows[0]!.count,
  ).toBe(1);
  expect((await repo.get(message.id)).sendState).toBe('scheduled');
  const audit = await pool.query<{ actor_id: string }>(
    "SELECT actor_id FROM audit_events WHERE tenant_id=$1 AND action='mail.send_retry' AND record_id=$2",
    [tenantId, job.id],
  );
  expect(audit.rows).toEqual([{ actor_id: actorId }]);

  // The next pass sends the very same job and closes it.
  const { calls, createSender: sending } = stubSender('sent');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender: sending,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(1);
  expect(
    (
      await pool.query(
        'SELECT state,attempts FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({ state: 'sent', attempts: 2 });
  // A sent job is not repeatable any more.
  expect((await retry(job.id)).statusCode).toBe(409);
  // Neither is a job of another tenant, which is simply not there.
  const foreign = await mailRepository(
    pool,
    otherTenantId,
    encryptionKey,
  ).createMessage(otherActorId, {
    ...draft(),
    accountId: otherAccountId,
    subject: 'Fictional foreign retry',
  });
  const foreignJob = await mailRepository(
    pool,
    otherTenantId,
    encryptionKey,
  ).scheduleSend(otherActorId, foreign.id, 'fictional-key-foreign');
  expect((await retry(foreignJob.job.id)).statusCode).toBe(404);
});

test('without a key or a usable account the pass fails closed instead of sending', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  const { job } = await repo.scheduleSend(
    actorId,
    message.id,
    'fictional-key-keyless',
  );
  const { calls, createSender } = stubSender('sent');
  const failures: unknown[] = [];
  expect(
    await runMailOutboxPass(pool, (failure) => failures.push(failure), {
      createSender,
      key: null,
    }),
  ).toBe(true);
  expect(failures).toEqual([{ type: 'encryption_unavailable' }]);
  expect(calls).toEqual([]);
  expect(
    (
      await pool.query(
        'SELECT state,last_error_code FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({
    state: 'failed',
    last_error_code: 'encryption_unavailable',
  });

  // A paused account is no provider either: the job says so instead of guessing.
  const paused = await repo.saveAccount(actorId, {
    name: 'Fictional paused sender',
    enabled: false,
  });
  const pausedMessage = await repo.createMessage(
    actorId,
    draft({ accountId: paused.id }),
  );
  const pausedJob = await repo.scheduleSend(
    actorId,
    pausedMessage.id,
    'fictional-key-paused',
  );
  const pausedFailures: unknown[] = [];
  expect(
    await runMailOutboxPass(pool, (failure) => pausedFailures.push(failure), {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(pausedFailures).toEqual([{ type: 'provider_missing' }]);
  expect(calls).toEqual([]);
  expect(
    (
      await pool.query(
        'SELECT state,last_error_code FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, pausedJob.job.id],
      )
    ).rows[0],
  ).toMatchObject({ state: 'failed', last_error_code: 'provider_missing' });
});

test('parallel workers and a restarted worker never send the same job twice', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const message = await repo.createMessage(actorId, draft());
  await repo.scheduleSend(actorId, message.id, 'fictional-key-parallel-send');
  const { calls, createSender } = stubSender('sent', 25);
  const passes = await Promise.all(
    Array.from({ length: 5 }, () =>
      runMailOutboxPass(pool, () => {}, {
        createSender,
        key: encryptionKey,
      }),
    ),
  );
  expect(passes.filter(Boolean)).toHaveLength(1);
  expect(calls).toHaveLength(1);

  // A worker that claims and then dies leaves a lease. Only after it expires
  // does the restarted worker resume the same job - and it sends exactly once.
  const crashed = await repo.createMessage(actorId, draft());
  const { job } = await repo.scheduleSend(
    actorId,
    crashed.id,
    'fictional-key-crashed',
  );
  await pool.query(
    `UPDATE mail_outbox
        SET state='sending', attempts=1, locked_at=now()-interval '3 minutes',
            next_attempt_at=now()-interval '1 second'
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, job.id],
  );
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(2);
  expect(
    (
      await pool.query(
        'SELECT state,attempts FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({ state: 'sent', attempts: 2 });
});

// MAIL-DOC-01: a deliberately chosen, already finalized document travels as an
// attachment. The row keeps the frozen artefact hash, the outbox is the same
// durable order as every other send, and the bytes are read again from the
// content-addressed store for the single attempt. No real document exists.
const documentRequest = {
  requestId: 'fictional-document-request-1',
  to: 'synthetic.contact@example.invalid',
  bodyText: 'Anbei das fiktive Dokument.',
};

test('schedules exactly one document mail with the frozen PDF as its attachment', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
  });
  const first = await repo.scheduleDocumentSend(actorId, {
    ...documentRequest,
    documentId: finalDocumentId,
  });
  expect(first.created).toBe(true);
  expect(first.attachment).toEqual({
    documentId: finalDocumentId,
    filename: 'Dokument-RE-2030-0001.pdf',
    mediaType: 'application/pdf',
    sizeBytes: syntheticPdf.byteLength,
  });
  expect(first.job).toMatchObject({
    messageId: first.messageId,
    state: 'pending',
    attempts: 0,
  });

  // The mail itself is a normal outgoing draft that the outbox marked as
  // scheduled; the document link is carried over, nothing is invented.
  const detail = await repo.get(first.messageId);
  expect(detail).toMatchObject({
    direction: 'out',
    folder: 'drafts',
    sendState: 'scheduled',
    contactId,
    eventId,
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Anbei das fiktive Dokument.',
  });
  expect(detail.subject).toContain('RE-2030-0001');

  // The attachment row references the artefact by hash and records its size;
  // the bytes themselves stay in the store.
  const attachment = (
    await pool.query(
      `SELECT document_id::text, pdf_hash, filename, media_type, size_bytes
         FROM mail_attachments WHERE tenant_id=$1 AND message_id=$2`,
      [tenantId, first.messageId],
    )
  ).rows[0]!;
  expect(attachment).toMatchObject({
    document_id: finalDocumentId,
    pdf_hash: pdfHash,
    filename: 'Dokument-RE-2030-0001.pdf',
    media_type: 'application/pdf',
  });
  expect(Number(attachment.size_bytes)).toBe(syntheticPdf.byteLength);

  // One gesture, one order: the same request answers the very same job.
  const repeat = await repo.scheduleDocumentSend(actorId, {
    ...documentRequest,
    documentId: finalDocumentId,
  });
  expect(repeat.created).toBe(false);
  expect(repeat.job.id).toBe(first.job.id);
  expect(repeat.messageId).toBe(first.messageId);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM mail_outbox WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, first.messageId],
      )
    ).rows[0]!.count,
  ).toBe(1);
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM mail_attachments WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, first.messageId],
      )
    ).rows[0]!.count,
  ).toBe(1);

  const audits = await pool.query<{ action: string; record_id: string }>(
    "SELECT action,record_id::text FROM audit_events WHERE tenant_id=$1 AND action='mail.document_send_scheduled'",
    [tenantId],
  );
  expect(
    audits.rows.filter((row) => row.record_id === first.job.id),
  ).toHaveLength(1);
});

test('refuses every document that is not a finalized row of this tenant', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
  });
  const send = (documentId: string, overrides = {}) =>
    repo.scheduleDocumentSend(actorId, {
      ...documentRequest,
      documentId,
      ...overrides,
    });
  await expect(send(draftDocumentId)).rejects.toMatchObject({
    reason: 'not_final',
  });
  await expect(send(withdrawnDocumentId)).rejects.toMatchObject({
    reason: 'not_final',
  });
  // Another tenant's final document is missing here, never forbidden: no leak.
  await expect(send(foreignFinalDocumentId)).rejects.toMatchObject({
    reason: 'not_found',
  });
  await expect(send(randomUUID())).rejects.toMatchObject({
    reason: 'not_found',
  });
  // A final row without a stored artefact never becomes an empty attachment.
  await expect(send(missingArtifactDocumentId)).rejects.toMatchObject({
    reason: 'attachment_unavailable',
  });
  // The same without any storage adapter configured: fail closed.
  await expect(
    mailRepository(pool, tenantId, encryptionKey).scheduleDocumentSend(
      actorId,
      {
        ...documentRequest,
        requestId: 'fictional-document-request-no-store-adapter',
        documentId: finalDocumentId,
      },
    ),
  ).rejects.toMatchObject({ reason: 'attachment_unavailable' });
  // Recipients, body and request key are validated like every other mail; each
  // case is its own gesture, so each carries its own request id.
  await expect(
    send(finalDocumentId, {
      requestId: 'fictional-doc-invalid-recipient',
      to: 'not-an-address',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_recipients' });
  await expect(
    send(finalDocumentId, {
      requestId: 'fictional-doc-empty-recipient',
      to: '',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_recipients' });
  await expect(
    send(finalDocumentId, {
      requestId: 'fictional-doc-bad-body',
      bodyText: 'control \u0000 byte',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_body' });
  await expect(send(finalDocumentId, { requestId: '' })).rejects.toMatchObject({
    reason: 'idempotency_conflict',
  });
  // Nothing of the refusals created an order.
  expect(
    (
      await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM mail_outbox WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0]!.count,
  ).toBe(1);
  // The database itself refuses an attachment that names a non-final document,
  // so no second code path can bypass the rule.
  const message = (
    await pool.query<{ id: string }>(
      'SELECT id::text AS id FROM mail_messages WHERE tenant_id=$1 ORDER BY created_at LIMIT 1',
      [tenantId],
    )
  ).rows[0]!;
  await expect(
    pool.query(
      `INSERT INTO mail_attachments
         (tenant_id,message_id,document_id,pdf_hash,filename,media_type,size_bytes)
       VALUES ($1,$2,$3,$4,'Dokument-Entwurf.pdf','application/pdf',1)`,
      [tenantId, message.id, draftDocumentId, pdfHash],
    ),
  ).rejects.toThrow(/not final/);
});

test('the worker sends the stored PDF bytes unchanged and audits the delivery', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
  });
  const { job, messageId } = await repo.scheduleDocumentSend(actorId, {
    ...documentRequest,
    requestId: 'fictional-document-request-bytes',
    documentId: finalDocumentId,
  });
  const { calls, createSender } = stubSender('sent');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(1);
  const attachments = calls[0]!.content.attachments ?? [];
  expect(attachments).toHaveLength(1);
  const [attachment] = attachments;
  expect(attachment!.filename).toBe('Dokument-RE-2030-0001.pdf');
  expect(attachment!.contentType).toBe('application/pdf');
  // Byte for byte the artefact that was frozen at finalization: the mail path
  // never renders a second PDF.
  expect(Buffer.compare(attachment!.content, syntheticPdf)).toBe(0);
  expect(
    (
      await pool.query(
        'SELECT state,sent_at FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({ state: 'sent' });
  expect((await repo.get(messageId)).sendState).toBe('sent');
});

test('a missing store or artefact fails the attempt without inventing a mail', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
  });
  const { job } = await repo.scheduleDocumentSend(actorId, {
    ...documentRequest,
    requestId: 'fictional-document-request-no-store',
    documentId: finalDocumentId,
  });
  const { calls, createSender } = stubSender('sent');
  // The job was ordered with a store, but this worker has none: the attachment
  // cannot be read, so nothing leaves the machine.
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(0);
  expect(
    (
      await pool.query(
        'SELECT state,last_error_code FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({
    state: 'failed',
    last_error_code: 'attachment_unavailable',
  });
  // The artefact is referenced by a stored hash: a file that disappeared is a
  // definite failure, not a reason to send the mail without its document.
  await mailStore.remove(pdfHash + '.pdf');
  await pool.query(
    "UPDATE mail_outbox SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
    [tenantId, job.id],
  );
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(0);
  expect(
    (
      await pool.query(
        'SELECT state,last_error_code FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({
    state: 'failed',
    last_error_code: 'attachment_unavailable',
  });
  await mailStore.put(pdfHash + '.pdf', syntheticPdf);
});

test('an unclear document delivery stays terminal until an operator decides', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
  });
  const { job } = await repo.scheduleDocumentSend(actorId, {
    ...documentRequest,
    requestId: 'fictional-document-request-uncertain',
    documentId: finalDocumentId,
  });
  const { calls, createSender } = stubSender('uncertain');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(1);
  expect(
    (
      await pool.query(
        'SELECT state,attempts,last_error_code FROM mail_outbox WHERE tenant_id=$1 AND id=$2',
        [tenantId, job.id],
      )
    ).rows[0],
  ).toMatchObject({
    state: 'uncertain',
    attempts: 1,
    last_error_code: 'provider_uncertain',
  });
  // The loop never re-sends an unclear outcome: no second claim, no second mail.
  await pool.query(
    "UPDATE mail_outbox SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
    [tenantId, job.id],
  );
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(false);
  expect(calls).toHaveLength(1);
});

test('the document send route needs a session and CSRF and replays the same order', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail/document-send',
        payload: { documentId: finalDocumentId },
      })
    ).statusCode,
  ).toBe(401);
  const { headers, csrf } = await signedIn();
  const payload = {
    documentId: finalDocumentId,
    requestId: 'fictional-route-document-request',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Anbei das fiktive Dokument.',
  };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail/document-send',
        headers,
        payload,
      })
    ).statusCode,
  ).toBe(403);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send',
    headers: { ...headers, ...csrf },
    payload,
  });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({
    messageId: expect.any(String),
    job: { state: 'pending', idempotencyKey: expect.any(String) },
    attachment: {
      documentId: finalDocumentId,
      filename: 'Dokument-RE-2030-0001.pdf',
      mediaType: 'application/pdf',
      sizeBytes: syntheticPdf.byteLength,
    },
  });
  // The answer carries the reference, never the artefact or its text.
  expect(created.body).not.toContain('%PDF');
  expect(created.body).not.toContain('synthetic document for the mail fixture');
  expect(created.body).not.toContain('Katalog');

  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send',
    headers: { ...headers, ...csrf },
    payload,
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().job.id).toBe(created.json().job.id);

  // A draft is a conflict, an unknown document is missing, a bad recipient is
  // a rejected request - each with a redacted category only.
  const refused = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send',
    headers: { ...headers, ...csrf },
    payload: { ...payload, documentId: draftDocumentId },
  });
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toEqual({ error: 'not_final' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail/document-send',
        headers: { ...headers, ...csrf },
        payload: { ...payload, documentId: randomUUID() },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail/document-send',
        headers: { ...headers, ...csrf },
        // A new gesture: only then is the recipient validated again.
        payload: {
          ...payload,
          requestId: 'fictional-route-invalid',
          to: 'synthetic.invalid',
        },
      })
    ).statusCode,
  ).toBe(400);
  // A foreign tenant's final document is not addressable from here.
  const foreign = await mailRepository(pool, otherTenantId, encryptionKey, {
    store: mailStore,
  });
  await expect(
    foreign.scheduleDocumentSend(otherActorId, {
      ...documentRequest,
      documentId: finalDocumentId,
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
});

// MAIL-EDITOR-01: a formatted document mail carries the documented
// placeholders. The server resolves them from structured data, sanitizes the
// HTML and derives the text alternative. Everything here is synthetic.

test('document mail content is resolved from structured data, sanitized and stored with its derived text', async () => {
  await pool.query('DELETE FROM mail_outbox');
  await pool.query(
    "UPDATE contacts SET first_name='Erika' WHERE tenant_id=$1 AND id=$2",
    [tenantId, contactId],
  );
  await pool.query(
    `UPDATE events SET event_date='2030-06-15', venue_override=true,
            venue='Fictional Hall 1'
       WHERE tenant_id=$1 AND id=$2`,
    [tenantId, eventId],
  );
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
    origin: 'https://admin.example.invalid',
  });
  const sent = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-html-request-1',
    to: 'synthetic.contact@example.invalid',
    bodyHtml:
      '<p>Hallo <strong>{{contactFirstName}}</strong> {{contact}},</p>' +
      '<p>{{event}} am {{date}} in {{location}}.</p>' +
      '<ul><li>{{total}}</li><li>{{package}}</li></ul>' +
      '<p><a href="{{documentLink}}">Dokument</a></p>' +
      '<p onclick="x">X</p><script>bad()</script>',
  });
  const link = 'https://admin.example.invalid/#document-' + finalDocumentId;
  const detail = await repo.get(sent.messageId);
  // The stored HTML is resolved and sanitized; the missing package value
  // stays visible instead of being silently emptied.
  expect(detail.bodyHtml).toBe(
    '<p>Hallo <strong>Erika</strong> Fictional Mail Contact,</p>' +
      '<p>Fictional mail event am 15.06.2030 in Fictional Hall 1.</p>' +
      '<ul><li>119,00 €</li><li>{{package}}</li></ul>' +
      `<p><a href="${link}">Dokument</a></p><p>X</p>`,
  );
  expect(detail.bodyText).toBe(
    'Hallo Erika Fictional Mail Contact,\n' +
      '\nFictional mail event am 15.06.2030 in Fictional Hall 1.\n' +
      '\n- 119,00 €\n- {{package}}\n' +
      `\nDokument (${link})\n\nX`,
  );
  // The mail remains an ordinary scheduled draft with its frozen attachment.
  expect(detail).toMatchObject({
    direction: 'out',
    folder: 'drafts',
    sendState: 'scheduled',
  });
});

test('document mail rejects unknown placeholders and mixed bodies and escapes values in HTML', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
    origin: 'https://admin.example.invalid',
  });
  await expect(
    repo.scheduleDocumentSend(actorId, {
      documentId: finalDocumentId,
      requestId: 'fictional-html-request-2',
      to: 'synthetic.contact@example.invalid',
      bodyHtml: '<p>{{nope}} und {{Kontakt_Vorname}}</p>',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  await expect(
    repo.scheduleDocumentSend(actorId, {
      documentId: finalDocumentId,
      requestId: 'fictional-html-request-3',
      to: 'synthetic.contact@example.invalid',
      bodyText: 'Hallo',
      bodyHtml: '<p>x</p>',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_body' });
  // A structured value is text: the HTML escapes it, the text keeps it raw.
  await pool.query(
    "UPDATE contacts SET name='Muster & <b>Co</b>' WHERE tenant_id=$1 AND id=$2",
    [tenantId, contactId],
  );
  const sent = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-html-request-4',
    to: 'synthetic.contact@example.invalid',
    bodyHtml: '<p>{{contact}} / {{contactFirstName}}</p>',
  });
  const detail = await repo.get(sent.messageId);
  expect(detail.bodyHtml).toBe(
    '<p>Muster &amp; &lt;b&gt;Co&lt;/b&gt; / Erika</p>',
  );
  expect(detail.bodyText).toBe('Muster & <b>Co</b> / Erika');
});

test('the document mail subject is plain text with resolved placeholders', async () => {
  await pool.query('DELETE FROM mail_outbox');
  await pool.query(
    "UPDATE contacts SET first_name='Erika' WHERE tenant_id=$1 AND id=$2",
    [tenantId, contactId],
  );
  // The free-text venue can be multiline; a value must never split a header
  // line even where the structured field allows line breaks.
  await pool.query(
    `UPDATE events SET event_date=NULL, venue_override=true, venue=$3
       WHERE tenant_id=$1 AND id=$2`,
    [tenantId, eventId, 'Halle A\nBcc: injiziert@example.invalid'],
  );
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
    origin: 'https://admin.example.invalid',
  });
  const sent = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-subject-request-1',
    to: 'synthetic.contact@example.invalid',
    subject: 'Erinnerung für {{contactFirstName}} {{location}}',
    bodyText: 'Kurz.',
  });
  // The injected line break is flattened to one line, never a second header.
  expect((await repo.get(sent.messageId)).subject).toBe(
    'Erinnerung für Erika Halle A Bcc: injiziert@example.invalid',
  );
  // An unknown placeholder in the subject is invalid content.
  await expect(
    repo.scheduleDocumentSend(actorId, {
      documentId: finalDocumentId,
      requestId: 'fictional-subject-request-2',
      to: 'synthetic.contact@example.invalid',
      subject: '{{Kontakt_Vorname}}',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_content' });
  // A missing subject keeps the automatic document subject.
  const automatic = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-subject-request-3',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Kurz.',
  });
  expect((await repo.get(automatic.messageId)).subject).toBe(
    'Dokument RE-2030-0001',
  );
});

test('the document mail preview resolves like the send and persists nothing', async () => {
  const { headers, csrf } = await signedIn();
  const countRows = async () =>
    (
      await pool.query(
        `SELECT (SELECT count(*) FROM mail_messages) AS messages,
                (SELECT count(*) FROM mail_outbox) AS outbox,
                (SELECT count(*) FROM audit_events) AS audits`,
      )
    ).rows[0];
  const before = await countRows();
  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send/preview',
    headers: { ...headers, ...csrf },
    payload: {
      documentId: finalDocumentId,
      bodyHtml: '<p>Hallo {{contactFirstName}} {{package}}</p>',
    },
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toEqual({
    subject: 'Dokument RE-2030-0001',
    bodyHtml: '<p>Hallo Erika {{package}}</p>',
    bodyText: 'Hallo Erika {{package}}',
    missing: ['package'],
  });
  // MAIL-TPL-01c: an explicit subject resolves with the same values.
  const withSubject = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send/preview',
    headers: { ...headers, ...csrf },
    payload: {
      documentId: finalDocumentId,
      subject: 'Erinnerung für {{contactFirstName}}',
      bodyHtml: '<p>Hallo</p>',
    },
  });
  expect(withSubject.statusCode).toBe(200);
  expect(withSubject.json().subject).toBe('Erinnerung für Erika');
  // Session, CSRF and content rules are the same as the send's.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail/document-send/preview',
        payload: { documentId: finalDocumentId },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail/document-send/preview',
        headers,
        payload: { documentId: finalDocumentId },
      })
    ).statusCode,
  ).toBe(403);
  const refused = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send/preview',
    headers: { ...headers, ...csrf },
    payload: {
      documentId: finalDocumentId,
      bodyHtml: '<p>{{Kontakt_Vorname}}</p>',
    },
  });
  expect(refused.statusCode).toBe(400);
  expect(refused.json()).toEqual({ error: 'invalid_content' });
  const draft = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send/preview',
    headers: { ...headers, ...csrf },
    payload: { documentId: draftDocumentId, bodyHtml: '<p>x</p>' },
  });
  expect(draft.statusCode).toBe(409);
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send/preview',
    headers: { ...headers, ...csrf },
    payload: { documentId: foreignFinalDocumentId, bodyHtml: '<p>x</p>' },
  });
  expect(foreign.statusCode).toBe(404);
  expect(await countRows()).toEqual(before);
});

// MAIL-TPL-01d: library files travel with the mail as frozen, verified
// references. The document attachment contract stays untouched.
async function seedLibraryFile(
  overrides: { state?: string; displayName?: string } = {},
) {
  const id = randomUUID(),
    storageKey = 'file-' + id + '.pdf';
  const bytes = Buffer.from('%PDF-1.4 synthetic library file\n', 'latin1'),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  await pool.query(
    `INSERT INTO library_files
       (tenant_id,id,display_name,media_type,size_bytes,sha256,storage_key,
        scan_state,state,uploaded_at,uploaded_by,archived_at)
     VALUES ($1,$2,$8,'application/pdf',$3,$4,$5,
             'not_scanned',$6,now(),$7,
             CASE WHEN $6='archived' THEN now() ELSE NULL END)`,
    [
      tenantId,
      id,
      bytes.byteLength,
      sha256,
      storageKey,
      overrides.state ?? 'available',
      actorId,
      overrides.displayName ?? 'Fictional Datei',
    ],
  );
  await mailStore.put(storageKey, bytes);
  return { id, storageKey, sha256, bytes };
}

test('library files travel with the mail as frozen verified references', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const file = await seedLibraryFile();
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
    origin: 'https://admin.example.invalid',
  });
  const sent = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-file-request-1',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Mit Anhang.',
    fileIds: [file.id],
  });
  // The server generates the file name and reports the carried files.
  expect(sent.files).toEqual([
    {
      libraryFileId: file.id,
      filename: 'Fictional_Datei.pdf',
      mediaType: 'application/pdf',
      sizeBytes: file.bytes.byteLength,
    },
  ]);
  // The row freezes the exact reference; nothing is copied into the database.
  const row = (
    await pool.query(
      `SELECT library_file_id::text AS library_file_id, storage_key, sha256
         FROM mail_file_attachments
        WHERE tenant_id=$1 AND message_id=$2`,
      [tenantId, sent.messageId],
    )
  ).rows[0];
  expect(row).toMatchObject({
    library_file_id: file.id,
    storage_key: file.storageKey,
    sha256: file.sha256,
  });

  // The worker hands exactly these bytes to the provider.
  const { calls, createSender } = stubSender('sent');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(1);
  const attachments = calls[0]!.content.attachments ?? [];
  const carried = attachments.find(
    (entry) => entry.filename === 'Fictional_Datei.pdf',
  );
  expect(carried).toBeTruthy();
  expect(carried!.content.equals(file.bytes)).toBe(true);

  // An unavailable file refuses the whole order - never a silent drop - and
  // the rolled-back transaction leaves no message behind.
  const archived = await seedLibraryFile({ state: 'archived' });
  await expect(
    repo.scheduleDocumentSend(actorId, {
      documentId: finalDocumentId,
      requestId: 'fictional-file-request-2',
      to: 'synthetic.contact@example.invalid',
      bodyText: 'Darf nicht gespeichert werden.',
      fileIds: [archived.id],
    }),
  ).rejects.toMatchObject({ reason: 'attachment_unavailable' });
  expect(
    (
      await pool.query(
        "SELECT count(*) FROM mail_messages WHERE tenant_id=$1 AND body_text='Darf nicht gespeichert werden.'",
        [tenantId],
      )
    ).rows[0].count,
  ).toBe('0');

  // A replay answers the very same order with the very same files.
  const replay = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-file-request-1',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Mit Anhang.',
    fileIds: [file.id],
  });
  expect(replay.files).toEqual(sent.files);
  expect(replay.messageId).toBe(sent.messageId);
});

test('a replaced or corrupted library file is a named failure, never the wrong bytes', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const file = await seedLibraryFile();
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
    origin: 'https://admin.example.invalid',
  });
  const sent = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-file-request-corrupt',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Mit beschädigtem Anhang.',
    fileIds: [file.id],
  });
  // Something overwrites the stored bytes after the order was made.
  await mailStore.put(
    file.storageKey,
    Buffer.from('%PDF-1.4 replaced by something else\n', 'latin1'),
  );
  const { calls, createSender } = stubSender('sent');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(true);
  // The attempt is a definite non-delivery and the wrong bytes never leave.
  expect(calls).toHaveLength(0);
  expect(
    (
      await pool.query(
        'SELECT state,last_error_code FROM mail_outbox WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, sent.messageId],
      )
    ).rows[0],
  ).toMatchObject({
    state: 'failed',
    last_error_code: 'attachment_unavailable',
  });

  // A display name that sanitises to nothing still becomes a safe file name.
  const odd = await seedLibraryFile({ displayName: '...' });
  const named = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-file-request-odd-name',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Mit seltsam benanntem Anhang.',
    fileIds: [odd.id],
  });
  expect(named.files[0]!.filename).toBe('Datei.pdf');
});

// ATTACH-01a: the document itself travels only on request and other final
// event documents may join - every removal is explicit, never a silent drop.
test('the mail can travel without its document and with additional documents', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
    origin: 'https://admin.example.invalid',
  });

  // Without the document the order carries no document attachment at all.
  const bare = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-attach-request-1',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Ganz ohne Dokument.',
    attachDocument: false,
  });
  expect(bare.attachment).toBeNull();
  expect(
    (
      await pool.query(
        'SELECT count(*) FROM mail_attachments WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, bare.messageId],
      )
    ).rows[0].count,
  ).toBe('0');
  // A replay answers the very same gesture, document-free as well.
  const replay = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-attach-request-1',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Ganz ohne Dokument.',
    attachDocument: true,
  });
  expect(replay.attachment).toBeNull();
  expect(replay.messageId).toBe(bare.messageId);

  // Only the order under test remains in the outbox for the worker below.
  await pool.query('DELETE FROM mail_outbox');
  // A second final document of the event travels next to the main one.
  const templateId = (
    await pool.query<{ id: string }>(
      'SELECT id FROM document_templates WHERE tenant_id=$1 LIMIT 1',
      [tenantId],
    )
  ).rows[0]!.id;
  const extra = await seedDocument({
    tenant: tenantId,
    templateId,
    kind: 'offer',
    state: 'final',
    number: 'AN-2030-0042',
    pdfHash,
    contactId,
    eventId,
  });
  const sent = await repo.scheduleDocumentSend(actorId, {
    documentId: finalDocumentId,
    requestId: 'fictional-attach-request-2',
    to: 'synthetic.contact@example.invalid',
    bodyText: 'Mit Zusatzdokument.',
    documentIds: [extra],
  });
  expect(sent.attachment).toMatchObject({ documentId: finalDocumentId });
  expect(sent.messageId).toBeTruthy();
  const carried = (
    await pool.query<{ filename: string }>(
      'SELECT filename FROM mail_attachments WHERE tenant_id=$1 AND message_id=$2 ORDER BY filename',
      [tenantId, sent.messageId],
    )
  ).rows.map((row) => row.filename);
  expect(carried).toEqual([
    'Dokument-AN-2030-0042.pdf',
    'Dokument-RE-2030-0001.pdf',
  ]);
  // The worker hands both documents to the provider.
  const { calls, createSender } = stubSender('sent');
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender,
      key: encryptionKey,
      store: mailStore,
    }),
  ).toBe(true);
  expect(calls).toHaveLength(1);
  expect(
    (calls[0]!.content.attachments ?? []).map((entry) => entry.filename),
  ).toEqual(['Dokument-AN-2030-0042.pdf', 'Dokument-RE-2030-0001.pdf']);

  // A withdrawn document is refused as a whole - never a silent drop.
  await expect(
    repo.scheduleDocumentSend(actorId, {
      documentId: finalDocumentId,
      requestId: 'fictional-attach-request-3',
      to: 'synthetic.contact@example.invalid',
      bodyText: 'Darf nicht gespeichert werden.',
      documentIds: [withdrawnDocumentId],
    }),
  ).rejects.toMatchObject({ reason: 'attachment_unavailable' });
  expect(
    (
      await pool.query(
        "SELECT count(*) FROM mail_messages WHERE tenant_id=$1 AND body_text='Darf nicht gespeichert werden.'",
        [tenantId],
      )
    ).rows[0].count,
  ).toBe('0');
});

// MAIL-STATUS-01: the event's mail list names the real outcome of the latest
// send order, so a failure in the worker is visible in the dialog's place.
test('the mail list and detail carry the error code of a failed send', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const { headers, csrf } = await signedIn();
  const scheduled = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/compose',
    headers: { ...headers, ...csrf },
    payload: {
      requestId: 'fictional-status-key',
      to: 'synthetic.contact@example.invalid',
      subject: 'Fiktiver Statusbetreff',
      eventId,
    },
  });
  expect(scheduled.statusCode).toBe(201);
  const messageId = scheduled.json().messageId as string;
  const listed = async () =>
    (
      await app.inject({
        url: '/api/v1/mail/messages?eventId=' + eventId,
        headers,
      })
    )
      .json()
      .find((row: { id: string }) => row.id === messageId);
  expect(await listed()).toMatchObject({
    sendState: 'scheduled',
    sendErrorCode: null,
  });
  const { createSender } = stubSender({
    failed: 'provider_recipient_rejected',
  });
  await runMailOutboxPass(pool, () => {}, {
    createSender,
    key: encryptionKey,
    store: mailStore,
  });
  expect(await listed()).toMatchObject({
    sendState: 'failed',
    sendErrorCode: 'provider_recipient_rejected',
  });
  const detail = await app.inject({
    url: '/api/v1/mail/messages/' + messageId,
    headers,
  });
  expect(detail.json()).toMatchObject({
    sendState: 'failed',
    sendErrorCode: 'provider_recipient_rejected',
  });
});

// The route schema must carry the ATTACH-01a fields: Fastify silently strips
// unknown body properties, so a missing entry dropped every extra document.
test('the document send route carries the attachment choice through', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const { headers, csrf } = await signedIn();
  const templateId = (
    await pool.query<{ id: string }>(
      'SELECT id FROM document_templates WHERE tenant_id=$1 LIMIT 1',
      [tenantId],
    )
  ).rows[0]!.id;
  const extra = await seedDocument({
    tenant: tenantId,
    templateId,
    kind: 'offer',
    state: 'final',
    number: 'AN-2030-0077',
    pdfHash,
    contactId,
    eventId,
  });
  const reply = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/document-send',
    headers: { ...headers, ...csrf },
    payload: {
      documentId: finalDocumentId,
      requestId: 'fictional-route-attach-choice',
      to: 'synthetic.contact@example.invalid',
      bodyText: 'Nur das Zusatzdokument.',
      attachDocument: false,
      documentIds: [extra],
    },
  });
  expect(reply.statusCode).toBe(201);
  expect(reply.json().attachment).toBeNull();
  expect(
    (
      await pool.query<{ filename: string }>(
        'SELECT filename FROM mail_attachments WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, reply.json().messageId],
      )
    ).rows.map((row) => row.filename),
  ).toEqual(['Dokument-AN-2030-0077.pdf']);
});

// MAIL-EVENT-02: the free event mail carries the same attachment sources as
// the document mail and resolves template placeholders from contact and
// event - a placeholder without a value is refused, never sent literally.
test('a free event mail carries attachments and resolved placeholders', async () => {
  await pool.query('DELETE FROM mail_outbox');
  const { headers, csrf } = await signedIn();
  const file = await seedLibraryFile({ displayName: 'Preisliste.pdf' });
  const payload = {
    requestId: 'fictional-compose-attachments',
    to: 'synthetic.contact@example.invalid',
    subject: 'Ihr Event {{event}}',
    bodyHtml: '<p>Hallo {{contact}}</p>',
    contactId,
    eventId,
    documentIds: [finalDocumentId],
    fileIds: [file.id],
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/compose',
    headers: { ...headers, ...csrf },
    payload,
  });
  expect(created.statusCode).toBe(201);
  const messageId = created.json().messageId as string;
  const stored = (
    await pool.query<{ subject: string; body_html: string }>(
      'SELECT subject, body_html FROM mail_messages WHERE tenant_id=$1 AND id=$2',
      [tenantId, messageId],
    )
  ).rows[0]!;
  // The contact name is whatever earlier cases left; it arrives escaped.
  const name = (
    await pool.query<{ name: string }>(
      'SELECT name FROM contacts WHERE tenant_id=$1 AND id=$2',
      [tenantId, contactId],
    )
  ).rows[0]!.name;
  expect(stored).toEqual({
    subject: 'Ihr Event Fictional mail event',
    body_html: '<p>Hallo ' + escapeMailHtmlText(name) + '</p>',
  });
  expect(
    (
      await pool.query(
        'SELECT filename FROM mail_attachments WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, messageId],
      )
    ).rows,
  ).toEqual([{ filename: 'Dokument-RE-2030-0001.pdf' }]);
  expect(
    (
      await pool.query(
        'SELECT filename FROM mail_file_attachments WHERE tenant_id=$1 AND message_id=$2',
        [tenantId, messageId],
      )
    ).rows,
  ).toEqual([{ filename: 'Preisliste.pdf' }]);
  // The worker hands both attachments to the provider.
  const { calls, createSender } = stubSender('sent');
  await runMailOutboxPass(pool, () => {}, {
    createSender,
    key: encryptionKey,
    store: mailStore,
  });
  expect(
    (calls[0]!.content.attachments ?? []).map((entry) => entry.filename),
  ).toEqual(['Dokument-RE-2030-0001.pdf', 'Preisliste.pdf']);
  // The same request id answers the very same order.
  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/compose',
    headers: { ...headers, ...csrf },
    payload,
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().id).toBe(created.json().id);

  const count = async () =>
    Number(
      (
        await pool.query(
          'SELECT count(*) FROM mail_messages WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].count,
    );
  const before = await count();
  const refuse = async (extra: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/mail/compose',
      headers: { ...headers, ...csrf },
      payload: {
        requestId: randomUUID(),
        to: 'synthetic.contact@example.invalid',
        subject: 'Fiktiv',
        contactId,
        eventId,
        ...extra,
      },
    });
  // Only a document can fill the total; a free mail refuses it.
  const total = await refuse({ bodyHtml: '<p>Summe {{total}}</p>' });
  expect(total.statusCode).toBe(400);
  expect(total.json()).toEqual({ error: 'missing_placeholder' });
  // Without a linked contact the contact placeholder has no value either.
  const unlinked = await refuse({
    subject: 'Hallo {{contact}}',
    contactId: undefined,
  });
  expect(unlinked.json()).toEqual({ error: 'missing_placeholder' });
  expect((await refuse({ subject: '{{unbekannt}}' })).json()).toEqual({
    error: 'invalid_content',
  });
  // A draft document or an archived file refuses the whole order.
  const draft = await refuse({ documentIds: [draftDocumentId] });
  expect(draft.statusCode).toBe(409);
  expect(draft.json()).toEqual({ error: 'attachment_unavailable' });
  const archived = await seedLibraryFile({ state: 'archived' });
  expect((await refuse({ fileIds: [archived.id] })).statusCode).toBe(409);
  expect(await count()).toBe(before);
});

// MAIL-EVENT-01: a free mail from the event is one gesture and one durable
// order under one request id; the body runs through the mail allowlist.
test('composes a free mail as one idempotent order with sanitized html', async () => {
  const { headers, csrf } = await signedIn();
  const payload = {
    requestId: 'fictional-compose-key',
    to: 'synthetic.contact@example.invalid',
    subject: 'Fiktiver Freie-Mail-Betreff',
    bodyHtml:
      '<p>Hallo <strong>Welt</strong></p><script>alert(1)</script>' +
      '<p><a href="javascript:evil()">Link</a></p>',
  };
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/compose',
    headers: { ...headers, ...csrf },
    payload,
  });
  expect(first.statusCode).toBe(201);
  const job = first.json();
  expect(job.state).toBe('pending');
  const message = (
    await pool.query<{
      subject: string;
      body_html: string;
      body_text: string;
      to_addresses: string;
      send_state: string;
      contact_id: string | null;
      event_id: string | null;
    }>(
      'SELECT subject, body_html, body_text, to_addresses, send_state,' +
        ' contact_id, event_id FROM mail_messages' +
        ' WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.messageId],
    )
  ).rows[0]!;
  expect(message.subject).toBe('Fiktiver Freie-Mail-Betreff');
  expect(message.to_addresses).toBe('synthetic.contact@example.invalid');
  expect(message.send_state).toBe('scheduled');
  // The allowlist owns the outgoing html and the text alternative is real.
  expect(message.body_html).not.toContain('script');
  expect(message.body_html).not.toContain('javascript:');
  expect(message.body_html).toContain('<strong>Welt</strong>');
  expect(message.body_text).toContain('Hallo Welt');
  // The same gesture answers the very same order - and creates no second.
  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/compose',
    headers: { ...headers, ...csrf },
    payload,
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().id).toBe(job.id);
  const jobs = await pool.query(
    'SELECT count(*) FROM mail_outbox WHERE tenant_id=$1' +
      ' AND idempotency_key=$2',
    [tenantId, 'mail-compose:fictional-compose-key'],
  );
  expect(Number(jobs.rows[0].count)).toBe(1);
});

test('refuses a free mail like the document send and names the code', async () => {
  const { headers, csrf } = await signedIn();
  const at = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/mail/compose',
      headers: { ...headers, ...csrf },
      payload,
    });
  // A subject with a line break could split a header line: refused.
  expect(
    (
      await at({
        requestId: 'fictional-compose-refusal-1',
        to: 'synthetic.contact@example.invalid',
        subject: 'Betreff\nmit Zeile',
      })
    ).json().error,
  ).toBe('invalid_subject');
  // No subject at all is refused as honestly as a broken one.
  expect(
    (
      await at({
        requestId: 'fictional-compose-refusal-2',
        to: 'synthetic.contact@example.invalid',
      })
    ).json().error,
  ).toBe('invalid_subject');
  // An address that passes the shape but not the address check.
  expect(
    (
      await at({
        requestId: 'fictional-compose-refusal-3',
        to: 'not-an-address',
        subject: 'Fiktiver Betreff',
      })
    ).json().error,
  ).toBe('invalid_recipients');
  // An event of another tenant is not a link this tenant owns.
  expect(
    (
      await at({
        requestId: 'fictional-compose-refusal-4',
        to: 'synthetic.contact@example.invalid',
        subject: 'Fiktiver Betreff',
        eventId: randomUUID(),
      })
    ).json().error,
  ).toBe('invalid_link');
});

// MAIL-EVENT-01: the quiet corners of the compose order - an empty
// recipient list, a foreign contact link, and the successful order with
// linked contact and event but no body at all.
test('the compose order covers its empty and linked corners', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  await expect(
    repo.scheduleCompose(actorId, {
      requestId: 'fictional-compose-corner-1',
      to: '',
      subject: 'Fiktiver Betreff',
    }),
  ).rejects.toMatchObject({ reason: 'invalid_recipients' });
  // A contact of another tenant is not a link this tenant owns.
  await expect(
    repo.scheduleCompose(actorId, {
      requestId: 'fictional-compose-corner-2',
      to: 'synthetic.contact@example.invalid',
      subject: 'Fiktiver Betreff',
      contactId: otherContactId,
    }),
  ).rejects.toMatchObject({ reason: 'invalid_link' });
  const { job, created } = await repo.scheduleCompose(actorId, {
    requestId: 'fictional-compose-corner-3',
    to: 'synthetic.contact@example.invalid',
    subject: 'Fiktiver Ecken-Betreff',
    contactId,
    eventId,
  });
  expect(created).toBe(true);
  expect(job.state).toBe('pending');
  const message = (
    await pool.query<{
      body_html: string | null;
      body_text: string;
      contact_id: string | null;
      event_id: string | null;
    }>(
      'SELECT body_html, body_text, contact_id, event_id FROM mail_messages' +
        ' WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.messageId],
    )
  ).rows[0]!;
  // No body: nothing to sanitize and nothing to derive - not a blank html.
  expect(message.body_html).toBeNull();
  expect(message.body_text).toBe('');
  expect(message.contact_id).toBe(contactId);
  expect(message.event_id).toBe(eventId);
});

// MAIL-FWD-01: the forwarding switches resolve their addresses on the
// server - from the stored accounting setting and this tenant's users.
test('forwards outgoing mail to accounting and app users under the switches', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey),
    // The dialog lists allowed accounts (`/api/v1/access`): the forwarding
    // resolves exactly those ids - never user ids of another id space.
    account = (await accessRepository(pool, tenantId).list())[0]!;
  // The switch on, nothing configured: refused, never a dropped copy.
  await expect(
    repo.scheduleCompose(actorId, {
      requestId: 'fictional-compose-forward-1',
      to: 'synthetic.contact@example.invalid',
      subject: 'Fiktiver Weiterleitungs-Betreff',
      forwardAccounting: true,
    }),
  ).rejects.toMatchObject({ reason: 'forward_unavailable' });
  await pool.query(
    'INSERT INTO mail_forward_settings(tenant_id,accounting_recipient)' +
      ' VALUES($1,$2)',
    [tenantId, 'synthetic.accounting@example.invalid'],
  );
  const { job } = await repo.scheduleCompose(actorId, {
    requestId: 'fictional-compose-forward-2',
    to: 'synthetic.contact@example.invalid',
    subject: 'Fiktiver Weiterleitungs-Betreff',
    forwardAccounting: true,
    forwardUserIds: [account.id],
  });
  const cc = (
    await pool.query<{ cc_addresses: string }>(
      'SELECT cc_addresses FROM mail_messages WHERE tenant_id=$1 AND id=$2',
      [tenantId, job.messageId],
    )
  ).rows[0]!;
  expect(cc.cc_addresses).toBe(
    `synthetic.accounting@example.invalid,${account.email}`,
  );
  // A user id this tenant does not own refuses the whole order.
  await expect(
    repo.scheduleCompose(actorId, {
      requestId: 'fictional-compose-forward-3',
      to: 'synthetic.contact@example.invalid',
      subject: 'Fiktiver Weiterleitungs-Betreff',
      forwardUserIds: [randomUUID()],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_link' });
});

// MAIL-FWD-01: the accounting setting stores exactly one validated
// address; an empty value only disables the switch.
test('the accounting setting stores one validated address and clears it', async () => {
  const anonymous = await app.inject({
    method: 'GET',
    url: '/api/v1/settings/mail-accounting',
  });
  expect(anonymous.statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/mail-accounting',
        payload: {
          accountingRecipient: 'synthetic.accounting@example.invalid',
        },
      })
    ).statusCode,
  ).toBe(401);
  const { headers, csrf } = await signedIn();
  const put = (accountingRecipient: string) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/settings/mail-accounting',
      headers: { ...headers, ...csrf },
      payload: { accountingRecipient },
    });
  expect((await put('synthetic.accounting@example.invalid')).statusCode).toBe(
    204,
  );
  const saved = await app.inject({
    url: '/api/v1/settings/mail-accounting',
    headers,
  });
  expect(saved.json()).toEqual({
    accountingRecipient: 'synthetic.accounting@example.invalid',
  });
  // The same address validation as every other recipient.
  const refused = await put('not-an-address');
  expect(refused.statusCode).toBe(400);
  expect(refused.json().error).toBe('invalid_recipients');
  // Clearing keeps the row and disables the switch honestly.
  expect((await put('')).statusCode).toBe(204);
  const cleared = await app.inject({
    url: '/api/v1/settings/mail-accounting',
    headers,
  });
  expect(cleared.json()).toEqual({ accountingRecipient: '' });
});

// MAIL-FWD-01: the quiet corners of the forwarding resolution.
test('refuses a forwarding that cannot be fulfilled instead of dropping a copy', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  // More than five users is not a forwarding any more.
  await expect(
    repo.scheduleCompose(actorId, {
      requestId: 'fictional-compose-forward-many',
      to: 'synthetic.contact@example.invalid',
      subject: 'Fiktiver Weiterleitungs-Betreff',
      forwardUserIds: [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ],
    }),
  ).rejects.toMatchObject({ reason: 'forward_unavailable' });
  // A malformed id is a broken link, not a missing user.
  await expect(
    repo.scheduleCompose(actorId, {
      requestId: 'fictional-compose-forward-bad-id',
      to: 'synthetic.contact@example.invalid',
      subject: 'Fiktiver Weiterleitungs-Betreff',
      forwardUserIds: ['not-a-uuid'],
    }),
  ).rejects.toMatchObject({ reason: 'invalid_link' });
});

// MAIL-UX-02 follow-up: the placeholder values of an event with an event
// type and a package resolve from master data. The lookup used to throw on
// its array parameter ("malformed array literal") and answered 500 for
// every real event - the root of the long-unclear
// "Der Auftrag wurde nicht angelegt. Bitte die Eingaben prüfen.".
test('a document mail of an event with type and package resolves its placeholders', async () => {
  const eventTypeId = randomUUID(),
    packageId = randomUUID();
  for (const [id, kind, name] of [
    [eventTypeId, 'event_type', 'Fiktive Eventart'],
    [packageId, 'package', 'Fiktives Paket'],
  ] as const)
    await pool.query(
      'INSERT INTO master_data(tenant_id,id,kind,name,position,state)' +
        ' VALUES($1,$2,$3,$4,1,$5)',
      [tenantId, id, kind, name, 'active'],
    );
  await pool.query(
    'UPDATE events SET event_type_id=$3, package_id=$4' +
      ' WHERE tenant_id=$1 AND id=$2',
    [tenantId, eventId, eventTypeId, packageId],
  );
  const repo = mailRepository(pool, tenantId, encryptionKey, {
    store: mailStore,
  });
  const preview = await repo.previewDocumentSend({
    documentId: finalDocumentId,
    bodyHtml: '<p>{{eventType}} - {{package}}</p>',
  });
  expect(preview.bodyText).toBe('Fiktive Eventart - Fiktives Paket');
  expect(preview.missing).toEqual([]);
});
