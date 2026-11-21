import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import { migrateGateway } from '../../packages/core/src/gateway-operations.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import { digest } from '../../packages/core/src/auth.js';
import {
  signGatewayMessage,
  type GatewayKey,
} from '../../packages/core/src/gateway-message.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form.js';
import { receiveWebsiteInquiryBatch } from '../../packages/core/src/website-inquiry-sync.js';
import {
  mailRepository,
  runMailOutboxPass,
} from '../../packages/core/src/mail.js';
import type {
  MailSendContent,
  MailSendEnvelope,
  MailSender,
  MailSenderAccount,
} from '../../packages/core/src/mail-sender.js';
import {
  encryptTelegramToken,
  startTelegramNotifications,
} from '../../packages/core/src/telegram.js';

// MAIL-NOTIFY-01: one synthetic tenant per test, addresses end in
// @example.invalid, the SMTP boundary is always a stub or absent.
let container: StartedPostgreSqlContainer,
  pool: Pool,
  tenantId: string,
  actorId: string,
  gatewayKey: GatewayKey;
const now = new Date('2030-11-02T10:00:00.000Z');
const telegramKey = Buffer.alloc(32, 11);
const encryptionKey = Buffer.alloc(32, 13);
const telegramToken = '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF';
const senderAddress = 'synthetic.sender@example.invalid';
const inboxAddress = 'fictional.inbox@example.invalid';

const entry = () => ({
  id: randomUUID(),
  receivedAt: now.toISOString(),
  expiresAt: '2030-11-03T10:00:00.000Z',
  submission: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    fields: {
      firstName: 'Fictional',
      lastName: 'Notify',
      email: 'notify@example.invalid',
      eventDate: '2030-11-14',
      package: 'easy-print',
      comment: 'Synthetic inquiry note.',
    },
  },
  privacyNotice: inquiryFormV1.privacyNotice,
  privacyUrl: inquiryFormV1.privacyUrl,
});
function batch(
  inquiries: unknown[] = [entry()],
  requestId = randomUUID(),
  operationId = randomUUID(),
) {
  const message = {
    version: 1 as const,
    tenantId,
    messageId: randomUUID(),
    operationId,
    issuedAt: now.getTime() / 1000,
    kind: 'inquiries.batch' as const,
    payload: { requestId, inquiries },
  };
  return {
    packet: signGatewayMessage(message, gatewayKey),
    message,
    requestId,
  };
}
const receive = (b: ReturnType<typeof batch>) =>
  receiveWebsiteInquiryBatch(pool, tenantId, actorId, b.packet, {
    requestId: b.requestId,
    keys: [gatewayKey],
    at: now,
  });

async function seedTenant(options: {
  telegram?: boolean;
  email?: { enabled: boolean; recipients: string } | false;
  account?: boolean;
}) {
  tenantId = randomUUID();
  await bootstrapAccess(
    pool,
    tenantId,
    'fictional.notify.owner@example.invalid',
    'Fictional notify',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional', email: 'fictional.notify.owner@example.invalid' },
    digest(randomUUID()),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
  gatewayKey = {
    id: 'fictional-notify',
    tenantId,
    direction: 'gateway-to-core',
    secret: Buffer.alloc(32, 7),
    notBefore: now.getTime() / 1000 - 60,
    expiresAt: now.getTime() / 1000 + 3600,
  };
  if (options.telegram !== false) {
    const sealed = encryptTelegramToken(telegramToken, telegramKey);
    await pool.query(
      'INSERT INTO telegram_settings(tenant_id,token_ciphertext,token_nonce,token_tag,chat_id,enabled) VALUES($1,$2,$3,$4,$5,true)',
      [tenantId, sealed.ciphertext, sealed.nonce, sealed.tag, 'fictional-chat'],
    );
  }
  if (options.account !== false) {
    await mailRepository(pool, tenantId, encryptionKey).saveAccount(actorId, {
      name: 'Fictional notification mailbox',
      provider: 'imap-smtp',
      smtpHost: 'smtp.example.invalid',
      smtpPort: 465,
      username: senderAddress,
      secret: 'synthetic-smtp-secret',
    });
  }
  if (options.email)
    await pool.query(
      'INSERT INTO inquiry_email_settings(tenant_id,recipients,enabled) VALUES($1,$2,$3)',
      [tenantId, options.email.recipients, options.email.enabled],
    );
}

async function state() {
  const rows = async (query: string) =>
    (await pool.query(query, [tenantId])).rows;
  return {
    deliveries: await rows(
      'SELECT id FROM website_inquiry_deliveries WHERE tenant_id=$1 ORDER BY id',
    ),
    telegram: await rows(
      'SELECT inquiry_id,attempts,delivered_at,cancelled_at FROM telegram_notification_jobs WHERE tenant_id=$1 ORDER BY inquiry_id',
    ),
    messages: await rows(
      'SELECT id,direction,folder,send_state,subject,body_text,from_address,to_addresses,sent_at FROM mail_messages WHERE tenant_id=$1 ORDER BY created_at,id',
    ),
    outbox: await rows(
      'SELECT message_id,idempotency_key,state,attempts,last_error_code,sent_at FROM mail_outbox WHERE tenant_id=$1 ORDER BY created_at,id',
    ),
  };
}

// The outbox loop is global; earlier tests' tenants must not be claimed here.
async function isolateOpenMailOrders() {
  await pool.query(
    "DELETE FROM mail_outbox WHERE tenant_id<>$1 AND state IN ('pending','failed','sending')",
    [tenantId],
  );
}

function stubSender() {
  const calls: { envelope: MailSendEnvelope; content: MailSendContent }[] = [];
  const accounts: MailSenderAccount[] = [];
  return {
    calls,
    accounts,
    createSender(account: MailSenderAccount): MailSender {
      accounts.push(account);
      return {
        async send(envelope, content) {
          calls.push({ envelope, content });
          return 'sent';
        },
      };
    },
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await migrateGateway(pool);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
beforeEach(async () => {
  await seedTenant({
    telegram: true,
    email: { enabled: true, recipients: inboxAddress },
    account: true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

test('enabled e-mail notification orders exactly one independent mail next to the one Telegram job', async () => {
  const value = batch();
  const inquiryId = (value.message.payload.inquiries[0] as { id: string }).id;
  expect(await receive(value)).toEqual({ status: 'applied', count: 1 });

  const first = await state();
  expect(first.deliveries).toHaveLength(1);
  // Telegram keeps its own single job; the mail order is a second one.
  expect(first.telegram).toHaveLength(1);
  expect(first.telegram[0]).toMatchObject({
    inquiry_id: inquiryId,
    delivered_at: null,
    cancelled_at: null,
  });
  expect(first.messages).toHaveLength(1);
  expect(first.outbox).toHaveLength(1);
  const message = first.messages[0]!;
  expect(message).toMatchObject({
    direction: 'out',
    folder: 'drafts',
    send_state: 'scheduled',
    subject: 'Neue Website-Anfrage',
    from_address: senderAddress,
    to_addresses: inboxAddress,
  });
  expect(message.body_text).toContain('Vorname: Fictional');
  expect(message.body_text).toContain('E-Mail: notify@example.invalid');
  expect(message.body_text).toContain(
    'Gewünschtes Fotobox-Paket: easy print (zusätzlich 200 Ausdrucke)',
  );
  expect(message.body_text).toContain('Anfrage-ID: ' + inquiryId);
  expect(message.body_text).not.toContain(telegramToken);
  expect(first.outbox[0]).toMatchObject({
    message_id: message.id,
    idempotency_key: 'inquiry-notification:' + inquiryId,
    state: 'pending',
    attempts: 0,
  });

  // A replayed operation and a fresh batch with the same entry both add nothing.
  expect(
    await receive(
      batch(
        value.message.payload.inquiries,
        value.requestId,
        value.message.operationId,
      ),
    ),
  ).toEqual({ status: 'duplicate', count: 1 });
  await receive(batch(value.message.payload.inquiries));
  expect(await state()).toMatchObject({
    telegram: first.telegram,
    outbox: first.outbox,
    messages: first.messages,
  });

  // The MAIL-021-B contract carries the notification out; Telegram stays untouched.
  const sender = stubSender();
  await isolateOpenMailOrders();
  expect(
    await runMailOutboxPass(pool, () => {}, {
      createSender: sender.createSender,
      key: encryptionKey,
    }),
  ).toBe(true);
  expect(sender.calls).toHaveLength(1);
  expect(sender.calls[0]!.envelope).toEqual({
    from: senderAddress,
    to: [inboxAddress],
    cc: [],
    bcc: [],
  });
  expect(sender.calls[0]!.content.subject).toBe('Neue Website-Anfrage');
  expect(sender.calls[0]!.content.text).toContain('Nachname: Notify');
  const sent = await state();
  expect(sent.outbox[0]).toMatchObject({ state: 'sent' });
  expect(sent.messages[0]).toMatchObject({
    folder: 'sent',
    send_state: 'sent',
  });
  expect(sent.messages[0]!.sent_at).not.toBeNull();
  expect(sent.telegram).toEqual(first.telegram);
});

test('disabled, recipient-less or account-less settings order no mail and never touch Telegram', async () => {
  // No settings row at all: Telegram still gets its job, mail gets none.
  await pool.query('DELETE FROM inquiry_email_settings WHERE tenant_id=$1', [
    tenantId,
  ]);
  expect(await receive(batch())).toEqual({ status: 'applied', count: 1 });
  let current = await state();
  expect(current.telegram).toHaveLength(1);
  expect(current.messages).toHaveLength(0);
  expect(current.outbox).toHaveLength(0);

  // Explicitly switched off with a stored address: still nothing.
  await seedTenant({
    telegram: false,
    email: { enabled: false, recipients: inboxAddress },
    account: true,
  });
  await receive(batch());
  current = await state();
  expect(current.telegram).toHaveLength(0);
  expect(current.messages).toHaveLength(0);

  // Enabled, but there is no sending account: no honest order exists, so none.
  await seedTenant({
    telegram: false,
    email: { enabled: true, recipients: inboxAddress },
    account: false,
  });
  await receive(batch());
  current = await state();
  expect(current.messages).toHaveLength(0);
  expect(current.outbox).toHaveLength(0);

  // Enabling after receipt never backfills; only new receipts are notified.
  await seedTenant({
    telegram: false,
    email: false,
    account: true,
  });
  const old = batch();
  await receive(old);
  expect((await state()).messages).toHaveLength(0);
  await pool.query(
    'INSERT INTO inquiry_email_settings(tenant_id,recipients,enabled) VALUES($1,$2,true)',
    [tenantId, inboxAddress],
  );
  expect((await state()).messages).toHaveLength(0);
  await receive(batch());
  const fresh = await state();
  expect(fresh.messages).toHaveLength(1);
  expect(fresh.outbox).toHaveLength(1);
});

test('a failed mail attempt is one job, retried durably, and Telegram still delivers once', async () => {
  const value = batch();
  const inquiryId = (value.message.payload.inquiries[0] as { id: string }).id;
  await receive(value);

  await isolateOpenMailOrders();
  // No adapter configured: the job says so instead of pretending to send.
  expect(await runMailOutboxPass(pool)).toBe(true);
  let current = await state();
  expect(current.outbox).toHaveLength(1);
  expect(current.outbox[0]).toMatchObject({
    idempotency_key: 'inquiry-notification:' + inquiryId,
    state: 'failed',
    attempts: 1,
    last_error_code: 'provider_missing',
  });
  expect(current.messages[0]).toMatchObject({ send_state: 'failed' });
  // A second pass retries the very same job; it never creates another one.
  await pool.query('UPDATE mail_outbox SET next_attempt_at=now()');
  expect(await runMailOutboxPass(pool)).toBe(true);
  current = await state();
  expect(current.outbox).toHaveLength(1);
  expect(current.outbox[0]).toMatchObject({ state: 'failed', attempts: 2 });

  // Independent delivery: the Telegram message goes out exactly once.
  await pool.query(
    'UPDATE telegram_notification_jobs SET cancelled_at=now() WHERE delivered_at IS NULL AND cancelled_at IS NULL AND tenant_id<>$1',
    [tenantId],
  );
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  const worker = startTelegramNotifications(
    pool,
    telegramKey,
    () => {},
    fetcher,
  );
  try {
    await vi.waitFor(async () => {
      expect((await state()).telegram[0]?.delivered_at).not.toBeNull();
    });
  } finally {
    await worker.stop();
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
  const delivered = await state();
  expect(delivered.telegram).toHaveLength(1);
  expect(delivered.telegram[0]).toMatchObject({ attempts: 1 });
  expect(delivered.outbox[0]).toMatchObject({ state: 'failed' });
});
