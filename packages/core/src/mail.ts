import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { encryptTelegramToken } from './telegram.js';

// MAIL-021-A: the durable mail core. Rows and the outbox live in reviewed SQL
// (0067) like the payment and file tables; there is no ORM mirror for them.
// This slice stores, links and queues mail. It sends nothing: no IMAP reader and
// no SMTP adapter exist yet, so an outbox job ends as `failed`/`provider_missing`
// instead of pretending to be delivered.
export type MailDirection = 'in' | 'out';
export type MailFolder = 'inbox' | 'drafts' | 'sent' | 'trash';
/** EM-04: the editorial state, independent of folder and delivery. */
export type MailEditState = 'open' | 'done';
export type MailSendState =
  'none' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'uncertain';
export type MailOutboxState =
  'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
export const mailDirections = ['in', 'out'] as const;
export const mailFolders = ['inbox', 'drafts', 'sent', 'trash'] as const;
export const mailEditStates = ['open', 'done'] as const;
export const mailSendStates = [
  'none',
  'scheduled',
  'sending',
  'sent',
  'failed',
  'uncertain',
] as const;
export const mailOutboxStates = [
  'pending',
  'sending',
  'sent',
  'failed',
  'uncertain',
] as const;

export type MailErrorReason =
  | 'not_found'
  | 'invalid_account'
  | 'invalid_direction'
  | 'invalid_folder'
  | 'invalid_subject'
  | 'invalid_body'
  | 'invalid_recipients'
  | 'invalid_link'
  | 'invalid_port'
  | 'already_exists'
  | 'secret_required'
  | 'encryption_unavailable'
  | 'not_sendable'
  | 'idempotency_conflict';
export class MailError extends Error {
  constructor(readonly reason: MailErrorReason) {
    super('Mail rejected');
  }
}

// The outbox moves forward only. `sending` may end in `sent`, `failed` or
// `uncertain`; `failed` may be retried; `sent` and `uncertain` are terminal
// (BKP021: an unclear provider outcome is never re-sent automatically).
const outboxTransitions: Record<MailOutboxState, readonly MailOutboxState[]> = {
  pending: ['sending'],
  sending: ['sent', 'failed', 'uncertain'],
  failed: ['sending'],
  sent: [],
  uncertain: [],
};
export function canTransitionMailOutbox(
  from: MailOutboxState,
  to: MailOutboxState,
): boolean {
  return outboxTransitions[from].includes(to);
}
// Same spacing as the Telegram queue: 15s doubling, six hour ceiling.
export function mailOutboxRetryDelaySeconds(attempts: number): number {
  const bounded = Math.max(0, Math.min(Math.trunc(attempts), 20));
  return Math.min(21600, 15 * 2 ** bounded);
}

export type MailAccountInput = {
  name: string;
  provider?: string;
  imapHost?: string;
  imapPort?: number | null;
  smtpHost?: string;
  smtpPort?: number | null;
  username?: string;
  /** Sealed with the existing AES-256-GCM envelope; never stored as text. */
  secret?: string;
  enabled?: boolean;
};
export type MailAccountRow = {
  id: string;
  name: string;
  provider: string;
  imapHost: string;
  imapPort: number | null;
  smtpHost: string;
  smtpPort: number | null;
  username: string;
  enabled: boolean;
};
// Addresses are a documented text form: comma-separated, trimmed, each one
// validated before a row exists. Empty means "no recipient yet" (a draft).
export type MailMessageInput = {
  accountId: string;
  direction: MailDirection;
  folder: MailFolder;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  messageId?: string | null;
  imapUid?: number | null;
  threadKey?: string | null;
  contactId?: string | null;
  eventId?: string | null;
};
export type MailOutboxRow = {
  id: string;
  messageId: string;
  idempotencyKey: string;
  state: MailOutboxState;
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  createdAt: string;
  sentAt: string | null;
};
export type MailMessageSummary = {
  id: string;
  accountId: string;
  direction: MailDirection;
  folder: MailFolder;
  editState: MailEditState;
  sendState: MailSendState;
  subject: string;
  from: string;
  to: string;
  contactId: string | null;
  eventId: string | null;
  threadKey: string | null;
  createdAt: string;
  sentAt: string | null;
};
export type MailMessageDetail = MailMessageSummary & {
  bodyText: string;
  bodyHtml: string | null;
  cc: string;
  bcc: string;
  messageId: string | null;
  imapUid: number | null;
  outbox: MailOutboxRow | null;
};
export type ClaimedMailOutboxJob = {
  tenantId: string;
  id: string;
  messageId: string;
  attempts: number;
};
export type MailOutboxFailure =
  | { type: 'database'; stage: 'claim' | 'finalize' }
  | { type: 'provider_missing' };

type ReviewedSql = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};
function reviewed(connection: Connection): ReviewedSql {
  return database(connection) as unknown as ReviewedSql;
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}
function plainText(
  value: unknown,
  max: number,
  reason: MailErrorReason,
): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new MailError(reason);
  const trimmed = value.trim();
  if (trimmed.length > max || hasControlCharacters(trimmed))
    throw new MailError(reason);
  return trimmed;
}
// Bodies may contain line breaks and tabs, nothing else below space.
function bodyText(
  value: unknown,
  max: number,
  reason: MailErrorReason,
): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new MailError(reason);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new MailError(reason);
  for (const character of trimmed) {
    const code = character.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f))
      throw new MailError(reason);
  }
  return trimmed;
}
const addressPattern = /^[^\s@,<>"'\\]+@[^\s@,<>"'\\]+\.[^\s@,<>"'\\]+$/;
function addressList(
  value: unknown,
  reason: MailErrorReason = 'invalid_recipients',
): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new MailError(reason);
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(',').map((part) => part.trim());
  if (parts.length > 50) throw new MailError(reason);
  for (const part of parts)
    if (
      !part ||
      part.length > 254 ||
      hasControlCharacters(part) ||
      !addressPattern.test(part)
    )
      throw new MailError(reason);
  return parts.join(', ');
}
function portOf(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  )
    throw new MailError('invalid_port');
  return value;
}
function idempotencyKeyOf(value: unknown): string {
  if (typeof value !== 'string') throw new MailError('idempotency_conflict');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200)
    throw new MailError('idempotency_conflict');
  return trimmed;
}

const messageColumns = sql`m.id::text AS id, m.account_id::text AS account_id,
  m.direction, m.folder, m.edit_state, m.send_state, m.subject,
  m.body_text, m.body_html, m.from_address, m.to_addresses,
  m.cc_addresses, m.bcc_addresses, m.message_id, m.imap_uid::text AS imap_uid,
  m.thread_key, m.contact_id::text AS contact_id, m.event_id::text AS event_id,
  to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(m.sent_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at`;
const outboxColumns = sql`o.id::text AS id, o.message_id::text AS message_id,
  o.idempotency_key, o.state, o.attempts,
  to_char(o.next_attempt_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS next_attempt_at,
  o.last_error_code,
  to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(o.sent_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at`;
const accountColumns = sql`a.id::text AS id, a.name, a.provider,
  a.imap_host, a.imap_port, a.smtp_host, a.smtp_port, a.username, a.enabled`;

type MessageQueryRow = {
  id: string;
  account_id: string;
  direction: MailDirection;
  folder: MailFolder;
  edit_state: MailEditState;
  send_state: MailSendState;
  subject: string;
  body_text: string;
  body_html: string | null;
  from_address: string;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  message_id: string | null;
  imap_uid: string | null;
  thread_key: string | null;
  contact_id: string | null;
  event_id: string | null;
  created_at: string;
  sent_at: string | null;
};
type OutboxQueryRow = {
  id: string;
  message_id: string;
  idempotency_key: string;
  state: MailOutboxState;
  attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  created_at: string;
  sent_at: string | null;
};
function toSummary(row: MessageQueryRow): MailMessageSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    direction: row.direction,
    folder: row.folder,
    editState: row.edit_state,
    sendState: row.send_state,
    subject: row.subject,
    from: row.from_address,
    to: row.to_addresses,
    contactId: row.contact_id,
    eventId: row.event_id,
    threadKey: row.thread_key,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  };
}
function toDetail(
  row: MessageQueryRow,
  outbox: MailOutboxRow | null,
): MailMessageDetail {
  return {
    ...toSummary(row),
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    cc: row.cc_addresses,
    bcc: row.bcc_addresses,
    messageId: row.message_id,
    imapUid: row.imap_uid === null ? null : Number(row.imap_uid),
    outbox,
  };
}
function toOutbox(row: OutboxQueryRow): MailOutboxRow {
  return {
    id: row.id,
    messageId: row.message_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    attempts: row.attempts,
    nextAttemptAt: new Date(row.next_attempt_at).toISOString(),
    lastErrorCode: row.last_error_code,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  };
}

export function mailRepository(
  pool: Pool,
  tenantId: string,
  encryptionKey: Uint8Array | null,
) {
  const db = database(pool);

  // Reads are tenant-bound by this closure; routes add the membership check.
  async function requireMember(actorId: string) {
    await db.transaction((tx) => requireAdministrator(tx, tenantId, actorId));
  }

  async function outboxOf(
    connection: Connection,
    messageId: string,
  ): Promise<MailOutboxRow | null> {
    const result = (await reviewed(connection).execute(sql`
      SELECT ${outboxColumns} FROM mail_outbox o
       WHERE o.tenant_id=${tenantId} AND o.message_id=${messageId}::uuid
       ORDER BY o.created_at DESC, o.id DESC LIMIT 1`)) as {
      rows: OutboxQueryRow[];
    };
    return result.rows[0] ? toOutbox(result.rows[0]) : null;
  }

  return {
    requireMember,

    async listAccounts(): Promise<MailAccountRow[]> {
      const result = (await reviewed(db).execute(sql`
        SELECT ${accountColumns} FROM mail_accounts a
         WHERE a.tenant_id=${tenantId} ORDER BY a.name`)) as {
        rows: {
          id: string;
          name: string;
          provider: string;
          imap_host: string;
          imap_port: number | null;
          smtp_host: string;
          smtp_port: number | null;
          username: string;
          enabled: boolean;
        }[];
      };
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        imapHost: row.imap_host,
        imapPort: row.imap_port,
        smtpHost: row.smtp_host,
        smtpPort: row.smtp_port,
        username: row.username,
        enabled: row.enabled,
      }));
    },

    // The secret is sealed with the same key file and envelope as the Telegram
    // token. Without a key nothing is stored (fail closed), never in plaintext.
    async saveAccount(
      actorId: string,
      input: MailAccountInput,
    ): Promise<MailAccountRow> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const name = plainText(input.name, 200, 'invalid_account');
        if (!name) throw new MailError('invalid_account');
        const enabled = input.enabled ?? true;
        const sealed =
          input.secret === undefined
            ? null
            : encryptTelegramToken(input.secret, requireKey(encryptionKey));
        if (enabled && !sealed) throw new MailError('secret_required');
        try {
          const result = (await reviewed(tx).execute(sql`
            INSERT INTO mail_accounts AS a
              (tenant_id,id,name,provider,imap_host,imap_port,smtp_host,smtp_port,
               username,secret_ciphertext,secret_nonce,secret_tag,enabled)
            VALUES (${tenantId},${randomUUID()}::uuid,${name},
                    ${plainText(input.provider, 100, 'invalid_account')},
                    ${plainText(input.imapHost, 255, 'invalid_account')},
                    ${portOf(input.imapPort)},
                    ${plainText(input.smtpHost, 255, 'invalid_account')},
                    ${portOf(input.smtpPort)},
                    ${plainText(input.username, 255, 'invalid_account')},
                    ${sealed?.ciphertext ?? null},${sealed?.nonce ?? null},
                    ${sealed?.tag ?? null},${enabled})
            RETURNING ${accountColumns}`)) as {
            rows: {
              id: string;
              name: string;
              provider: string;
              imap_host: string;
              imap_port: number | null;
              smtp_host: string;
              smtp_port: number | null;
              username: string;
              enabled: boolean;
            }[];
          };
          const row = result.rows[0]!;
          return {
            id: row.id,
            name: row.name,
            provider: row.provider,
            imapHost: row.imap_host,
            imapPort: row.imap_port,
            smtpHost: row.smtp_host,
            smtpPort: row.smtp_port,
            username: row.username,
            enabled: row.enabled,
          };
        } catch (error) {
          const code =
            (error as { code?: string }).code ??
            (error as { cause?: { code?: string } }).cause?.code;
          if (code === '23505') throw new MailError('already_exists');
          throw error;
        }
      });
    },

    async createMessage(
      actorId: string,
      input: MailMessageInput,
    ): Promise<MailMessageDetail> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const direction = input.direction;
        if (!(mailDirections as readonly string[]).includes(direction))
          throw new MailError('invalid_direction');
        const folder = input.folder;
        if (!(mailFolders as readonly string[]).includes(folder))
          throw new MailError('invalid_folder');
        // Incoming mail is in the inbox; outgoing mail starts as a draft. A
        // directly "sent" row only comes from the outbox transition below.
        if (direction === 'in' && folder !== 'inbox')
          throw new MailError('invalid_folder');
        if (direction === 'out' && folder !== 'drafts')
          throw new MailError('invalid_folder');
        const subject = plainText(input.subject, 998, 'invalid_subject'),
          text = bodyText(input.bodyText, 200000, 'invalid_body'),
          html =
            input.bodyHtml === undefined || input.bodyHtml === null
              ? null
              : bodyText(input.bodyHtml, 400000, 'invalid_body'),
          from = addressList(input.from),
          to = addressList(input.to),
          cc = addressList(input.cc),
          bcc = addressList(input.bcc);
        const account = await tx.execute<{ id: string }>(
          sql`SELECT id::text AS id FROM mail_accounts
               WHERE tenant_id=${tenantId} AND id=${input.accountId}::uuid`,
        );
        if (!account.rows[0]) throw new MailError('invalid_account');
        // A contact or event of another tenant is not a link this tenant owns.
        if (input.contactId) {
          const linked = await tx.execute<{ id: string }>(
            sql`SELECT id::text AS id FROM contacts
                 WHERE tenant_id=${tenantId} AND id=${input.contactId}::uuid`,
          );
          if (!linked.rows[0]) throw new MailError('invalid_link');
        }
        if (input.eventId) {
          const linked = await tx.execute<{ id: string }>(
            sql`SELECT id::text AS id FROM events
                 WHERE tenant_id=${tenantId} AND id=${input.eventId}::uuid`,
          );
          if (!linked.rows[0]) throw new MailError('invalid_link');
        }
        const result = (await reviewed(tx).execute(sql`
          INSERT INTO mail_messages AS m
            (tenant_id,id,account_id,direction,folder,subject,body_text,body_html,
             from_address,to_addresses,cc_addresses,bcc_addresses,message_id,
             imap_uid,thread_key,contact_id,event_id)
          VALUES (${tenantId},${randomUUID()}::uuid,${input.accountId}::uuid,
                  ${direction},${folder},${subject},${text},${html},${from},${to},
                  ${cc},${bcc},${input.messageId ?? null},${input.imapUid ?? null},
                  ${input.threadKey ?? null},${input.contactId ?? null}::uuid,
                  ${input.eventId ?? null}::uuid)
          RETURNING ${messageColumns}`)) as { rows: MessageQueryRow[] };
        const id = result.rows[0]!.id;
        await appendAudit(tx, tenantId, 'mail.message_created', actorId, id);
        return toDetail(result.rows[0]!, null);
      });
    },

    async get(id: string): Promise<MailMessageDetail> {
      const result = (await reviewed(db).execute(sql`
        SELECT ${messageColumns} FROM mail_messages m
         WHERE m.tenant_id=${tenantId} AND m.id=${id}::uuid`)) as {
        rows: MessageQueryRow[];
      };
      const row = result.rows[0];
      // A foreign tenant's message is missing, never forbidden: no leak.
      if (!row) throw new MailError('not_found');
      return toDetail(row, await outboxOf(db, id));
    },

    async list(
      filter: {
        folder?: string;
        contactId?: string;
        eventId?: string;
        accountId?: string;
      } = {},
    ): Promise<MailMessageSummary[]> {
      const conditions = [sql`m.tenant_id=${tenantId}`];
      if (filter.folder !== undefined) {
        if (!(mailFolders as readonly string[]).includes(filter.folder))
          throw new MailError('invalid_folder');
        conditions.push(sql`m.folder=${filter.folder}`);
      }
      if (filter.contactId !== undefined)
        conditions.push(sql`m.contact_id=${filter.contactId}::uuid`);
      if (filter.eventId !== undefined)
        conditions.push(sql`m.event_id=${filter.eventId}::uuid`);
      if (filter.accountId !== undefined)
        conditions.push(sql`m.account_id=${filter.accountId}::uuid`);
      const result = (await reviewed(db).execute(sql`
        SELECT ${messageColumns} FROM mail_messages m
         WHERE ${sql.join(conditions, sql` AND `)}
         ORDER BY m.created_at DESC, m.id DESC LIMIT 100`)) as {
        rows: MessageQueryRow[];
      };
      return result.rows.map(toSummary);
    },

    // The only external effect a message can cause is a durable send order.
    // Same key = same job; one open job per message; no second send.
    async scheduleSend(
      actorId: string,
      messageId: string,
      idempotencyKey: string,
    ): Promise<{ job: MailOutboxRow; created: boolean }> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const key = idempotencyKeyOf(idempotencyKey);
        const message = await tx.execute<{
          direction: MailDirection;
          folder: MailFolder;
          send_state: MailSendState;
          to_addresses: string;
        }>(
          sql`SELECT direction, folder, send_state, to_addresses FROM mail_messages
               WHERE tenant_id=${tenantId} AND id=${messageId}::uuid FOR UPDATE`,
        );
        const found = message.rows[0];
        if (!found) throw new MailError('not_found');
        const existing = (await reviewed(tx).execute(sql`
          SELECT ${outboxColumns} FROM mail_outbox o
           WHERE o.tenant_id=${tenantId} AND o.idempotency_key=${key}`)) as {
          rows: OutboxQueryRow[];
        };
        if (existing.rows[0]) {
          if (existing.rows[0].message_id !== messageId)
            throw new MailError('idempotency_conflict');
          return { job: toOutbox(existing.rows[0]), created: false };
        }
        if (found.direction !== 'out') throw new MailError('not_sendable');
        if (!['none', 'failed'].includes(found.send_state))
          throw new MailError('not_sendable');
        if (found.folder !== 'drafts') throw new MailError('not_sendable');
        if (!found.to_addresses.trim())
          throw new MailError('invalid_recipients');
        const open = await tx.execute<{ id: string }>(
          sql`SELECT id::text AS id FROM mail_outbox
               WHERE tenant_id=${tenantId} AND message_id=${messageId}::uuid
                 AND state IN ('pending','sending','failed') LIMIT 1`,
        );
        if (open.rows[0]) throw new MailError('not_sendable');
        const inserted = (await reviewed(tx).execute(sql`
          INSERT INTO mail_outbox AS o (tenant_id,id,message_id,idempotency_key)
          VALUES (${tenantId},${randomUUID()}::uuid,${messageId}::uuid,${key})
          ON CONFLICT (tenant_id,idempotency_key) DO NOTHING
          RETURNING ${outboxColumns}`)) as { rows: OutboxQueryRow[] };
        const row = inserted.rows[0];
        // A parallel request with the same key won the insert: answer with it.
        if (!row) {
          const raced = (await reviewed(tx).execute(sql`
            SELECT ${outboxColumns} FROM mail_outbox o
             WHERE o.tenant_id=${tenantId} AND o.idempotency_key=${key}`)) as {
            rows: OutboxQueryRow[];
          };
          const job = raced.rows[0]!;
          if (job.message_id !== messageId)
            throw new MailError('idempotency_conflict');
          return { job: toOutbox(job), created: false };
        }
        await tx.execute(
          sql`UPDATE mail_messages SET send_state='scheduled', updated_at=now()
               WHERE tenant_id=${tenantId} AND id=${messageId}::uuid`,
        );
        await appendAudit(tx, tenantId, 'mail.send_scheduled', actorId, row.id);
        return { job: toOutbox(row), created: true };
      });
    },
  };
}

function requireKey(key: Uint8Array | null): Uint8Array {
  if (!key) throw new MailError('encryption_unavailable');
  return key;
}

// Claims one due job with a two minute lease and SKIP LOCKED. A `sending` row is
// only reclaimable after its lease expired, so a crashed worker's job resumes
// on restart, while a parallel worker never touches the same row.
export async function claimMailOutboxJob(
  client: PoolClient,
): Promise<ClaimedMailOutboxJob | null> {
  const claim = await client.query<{
    tenant_id: string;
    id: string;
    message_id: string;
    attempts: number;
  }>(
    `WITH picked AS (
       SELECT o.tenant_id, o.id FROM mail_outbox o
        WHERE o.state IN ('pending','sending','failed')
          AND o.next_attempt_at <= now()
          AND (o.locked_at IS NULL OR o.locked_at < now()-interval '2 minutes')
        ORDER BY o.created_at
        FOR UPDATE SKIP LOCKED LIMIT 1)
     UPDATE mail_outbox o
        SET state='sending', attempts=o.attempts+1, locked_at=now(),
            last_error_code=NULL, updated_at=now()
       FROM picked p
      WHERE o.tenant_id=p.tenant_id AND o.id=p.id
        AND o.state IN ('pending','sending','failed')
     RETURNING o.tenant_id, o.id, o.message_id, o.attempts`,
  );
  const row = claim.rows[0];
  if (!row) return null;
  await client.query(
    `UPDATE mail_messages SET send_state='sending', updated_at=now()
      WHERE tenant_id=$1 AND id=$2
        AND send_state IN ('none','scheduled','failed')`,
    [row.tenant_id, row.message_id],
  );
  return {
    tenantId: row.tenant_id,
    id: row.id,
    messageId: row.message_id,
    attempts: row.attempts,
  };
}

// One honest pass without a provider adapter: the job is claimed, then recorded
// as failed with the redacted category `provider_missing` and a growing backoff.
// Nothing is ever marked `sent` here.
export async function runMailOutboxPass(
  pool: Pool,
  reportError: (failure: MailOutboxFailure) => void = () => {},
): Promise<boolean> {
  const client = await pool.connect();
  try {
    let job: ClaimedMailOutboxJob | null = null;
    try {
      await client.query('BEGIN');
      job = await claimMailOutboxJob(client);
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      reportError({ type: 'database', stage: 'claim' });
      return false;
    }
    if (!job) return false;
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE mail_outbox
            SET state='failed', last_error_code='provider_missing',
                next_attempt_at=now()+make_interval(secs=>$3::int),
                locked_at=NULL, updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND state='sending'`,
        [job.tenantId, job.id, mailOutboxRetryDelaySeconds(job.attempts)],
      );
      await client.query(
        `UPDATE mail_messages m SET send_state='failed', updated_at=now()
           FROM mail_outbox o
          WHERE o.tenant_id=$1 AND o.id=$2
            AND m.tenant_id=o.tenant_id AND m.id=o.message_id`,
        [job.tenantId, job.id],
      );
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      reportError({ type: 'database', stage: 'finalize' });
      return false;
    }
    reportError({ type: 'provider_missing' });
    return true;
  } finally {
    client.release();
  }
}

export function startMailOutbox(
  pool: Pool,
  reportError: (failure: MailOutboxFailure) => void = () => {},
  intervalMs = 5000,
) {
  let pending: Promise<void> | null = null;
  const run = () => {
    if (pending) return;
    pending = runMailOutboxPass(pool, reportError)
      .then(() => {})
      .catch(() => reportError({ type: 'database', stage: 'claim' }))
      .finally(() => {
        pending = null;
      });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return {
    // Exactly like the Telegram loop: a provider failure is a job state, not a
    // reason to pull the worker's readiness down.
    ready: () => true,
    stop: async () => {
      clearInterval(timer);
      await pending;
    },
  };
}

const nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] },
  nullableUuid = {
    anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
  };
const summarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'accountId',
    'direction',
    'folder',
    'editState',
    'sendState',
    'subject',
    'from',
    'to',
    'contactId',
    'eventId',
    'threadKey',
    'createdAt',
    'sentAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    direction: { type: 'string', enum: [...mailDirections] },
    folder: { type: 'string', enum: [...mailFolders] },
    editState: { type: 'string', enum: [...mailEditStates] },
    sendState: { type: 'string', enum: [...mailSendStates] },
    subject: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    contactId: nullableUuid,
    eventId: nullableUuid,
    threadKey: nullableText,
    createdAt: { type: 'string', format: 'date-time' },
    sentAt: nullableText,
  },
} as const;
const outboxSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'messageId',
    'idempotencyKey',
    'state',
    'attempts',
    'nextAttemptAt',
    'lastErrorCode',
    'createdAt',
    'sentAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    messageId: { type: 'string', format: 'uuid' },
    idempotencyKey: { type: 'string' },
    state: { type: 'string', enum: [...mailOutboxStates] },
    attempts: { type: 'integer', minimum: 0 },
    nextAttemptAt: { type: 'string', format: 'date-time' },
    lastErrorCode: nullableText,
    createdAt: { type: 'string', format: 'date-time' },
    sentAt: nullableText,
  },
} as const;
const detailSchema = {
  ...summarySchema,
  required: [
    ...summarySchema.required,
    'bodyText',
    'bodyHtml',
    'cc',
    'bcc',
    'messageId',
    'imapUid',
    'outbox',
  ],
  properties: {
    ...summarySchema.properties,
    bodyText: { type: 'string' },
    bodyHtml: nullableText,
    cc: { type: 'string' },
    bcc: { type: 'string' },
    messageId: nullableText,
    imapUid: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    outbox: { anyOf: [outboxSchema, { type: 'null' }] },
  },
} as const;

export function registerMailRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = mailRepository(pool, tenantId, null),
    params = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
    nullableUuidParam = {
      type: 'string',
      format: 'uuid',
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof MailError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      // The target exists but cannot be sent from its current state.
      if (['not_sendable', 'idempotency_conflict'].includes(error.reason))
        return reply.code(409).send({ error: error.reason });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/v1/mail/messages',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            folder: { type: 'string', maxLength: 20 },
            contactId: nullableUuidParam,
            eventId: nullableUuidParam,
            accountId: nullableUuidParam,
          },
        },
        response: { 200: { type: 'array', items: summarySchema } },
      },
    },
    async (request, reply) => {
      try {
        // Reading mail requires an active membership of this tenant.
        await repo.requireMember(request.authSession!.userId);
        return await repo.list(request.query);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/mail/messages/:id',
    { schema: { params, response: { 200: detailSchema } } },
    async (request, reply) => {
      try {
        await repo.requireMember(request.authSession!.userId);
        return await repo.get(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // Only the durable send order: no SMTP call happens in a request, and a
  // repeat with the same key answers 200 with the very same job.
  app.post<{ Params: { id: string }; Body: { idempotencyKey: string } }>(
    '/api/v1/mail/messages/:id/send',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['idempotencyKey'],
          properties: {
            idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        response: { 200: outboxSchema, 201: outboxSchema },
      },
    },
    async (request, reply) => {
      try {
        const { job, created } = await repo.scheduleSend(
          request.authSession!.userId,
          request.params.id,
          request.body.idempotencyKey,
        );
        return reply.code(created ? 201 : 200).send(job);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
