import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { decryptTelegramToken } from '../../packages/core/src/telegram.js';
import {
  claimMailOutboxJob,
  mailRepository,
  registerMailRoutes,
  runMailOutboxPass,
  startMailOutbox,
} from '../../packages/core/src/mail.js';
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
  otherContactId: string;

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
  registerMailRoutes(app, pool, tenantId);
}, 120000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
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
  // place the plaintext exists is this attempt.
  expect(accounts).toEqual([
    {
      host: 'smtp.example.invalid',
      port: 465,
      username: 'synthetic.sender@example.invalid',
      secret: 'synthetic-smtp-secret',
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
