import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { encryptTelegramToken, decryptTelegramToken } from './telegram.js';
import { readDocumentPdf } from './document-artifacts.js';
import {
  assertMailPlaceholders,
  escapeMailHtmlText,
  mailBodyTextFromHtml,
  mailPlaceholderValues,
  resolveMailPlaceholders,
  resolveMailSubject,
  sanitizeMailHtml,
  type MailPlaceholder,
  type MailValueSources,
} from './mail-content.js';
import type { StorageAdapter } from './storage.js';
import type {
  MailSendAttachment,
  MailSendContent,
  MailSendEnvelope,
  MailSendFailureCode,
  MailSendResult,
  MailSender,
  MailSenderAccount,
  MailSmtpSecurity,
} from './mail-sender.js';

// MAIL-021-A: the durable mail core. Rows and the outbox live in reviewed SQL
// (0067) like the payment and file tables; there is no ORM mirror for them.
// MAIL-021-B adds the one external effect: a claimed job is handed to a
// MailSender adapter (`mail-sender.ts`), and the pass records exactly what came
// back - sent, definitively failed, or unclear. Without an adapter nothing
// leaves the machine and a job ends as `failed`/`provider_missing`.
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
  | 'invalid_sender'
  | 'invalid_security'
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
  | 'not_retryable'
  | 'not_final'
  | 'attachment_unavailable'
  | 'forward_unavailable'
  | 'invalid_content'
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

export type { MailSmtpSecurity } from './mail-sender.js';
export const mailSmtpSecurities = ['starttls', 'implicit', 'none'] as const;
export type MailAccountInput = {
  name: string;
  provider?: string;
  imapHost?: string;
  imapPort?: number | null;
  smtpHost?: string;
  smtpPort?: number | null;
  /** Display name of the sender identity; kept out of the envelope address. */
  fromName?: string;
  /** Sender address; a message without its own falls back to this one. */
  fromAddress?: string;
  /** Transport encryption; `none` is only valid without a username. */
  smtpSecurity?: MailSmtpSecurity;
  username?: string;
  /** Sealed with the existing AES-256-GCM envelope; never stored as text.
   *  Absent or empty keeps an existing secret untouched. */
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
  fromName: string;
  fromAddress: string;
  smtpSecurity: MailSmtpSecurity;
  username: string;
  enabled: boolean;
  /** Never the secret itself: only whether one is sealed for this account. */
  hasSecret: boolean;
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
// MAIL-EVENT-01: a free mail composed at the event - no document, no
// attachments, no placeholders. The request id plays the same idempotency
// role as for the document send.
export type MailComposeInput = {
  requestId: string;
  to: string;
  subject?: string | null;
  bodyHtml?: string | null;
  contactId?: string | null;
  eventId?: string | null;
  accountId?: string | null;
  // MAIL-FWD-01: switches only - every forwarded address is resolved on the
  // server from the stored setting and this tenant's own users.
  forwardAccounting?: boolean;
  forwardUserIds?: readonly string[];
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
  // MAIL-STATUS-01: the error code of the latest send order, null otherwise.
  sendErrorCode: string | null;
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
/**
 * MAIL-DOC-01: the reference of an attachment, never its bytes. `pdfHash` names
 * the frozen artefact of the finalized document; the worker reads it again from
 * the same store the PDF route uses.
 */
export type MailAttachmentSummary = {
  documentId: string;
  filename: string;
  mediaType: 'application/pdf';
  sizeBytes: number;
};
export type MailDocumentSendInput = {
  documentId: string;
  /** Client-generated once per gesture: same id, same order. */
  requestId: string;
  to: string;
  /** MAIL-TPL-01c: plain-text subject with placeholders; empty keeps the
   *  automatic document subject. Values resolve to one line, never a header. */
  subject?: string | null;
  /** Legacy plain cover text; resolved like `bodyHtml`, never HTML. */
  bodyText?: string | null;
  /** MAIL-EDITOR-01: formatted cover text with the documented placeholders. */
  bodyHtml?: string | null;
  /** MAIL-TPL-01d: chosen library files; an unavailable file refuses the
   *  whole order and is never silently dropped. */
  fileIds?: string[];
  /** ATTACH-01a: whether the chosen document itself travels; default true.
   *  Removing it is an explicit decision, never a silent drop. */
  attachDocument?: boolean;
  /** ATTACH-01a: other final documents of the event to carry along. An
   *  unavailable one refuses the whole order like every other attachment. */
  documentIds?: string[];
  accountId?: string | null;
  // MAIL-FWD-01: switches only - every forwarded address is resolved on the
  // server from the stored setting and this tenant's own users.
  forwardAccounting?: boolean;
  forwardUserIds?: readonly string[];
};
// MAIL-EDITOR-01: the read-only twin of a document send. It runs the very
// same checks and content assembly and stores nothing.
export type MailDocumentPreviewInput = {
  documentId: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
};
export type MailDocumentPreview = {
  subject: string;
  bodyHtml: string | null;
  bodyText: string;
  /** Names of known placeholders without a value; they stay visible. */
  missing: string[];
};
// MAIL-TPL-01d: one carried library file, referenced by its frozen storage
// key - the bytes are never copied into the database.
export type MailFileAttachmentSummary = {
  libraryFileId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
};
export type MailDocumentSendResult = {
  job: MailOutboxRow;
  messageId: string;
  /** ATTACH-01a: null when the chosen document does not travel. */
  attachment: MailAttachmentSummary | null;
  files: MailFileAttachmentSummary[];
  created: boolean;
};
/** The storage limit is the same one an artefact may have on disk. */
export const maxMailAttachmentBytes = 10 * 1024 * 1024;
/** MAIL-021-B: the outbox needs an adapter factory and the key, nothing else. */
export type MailOutboxConfig = {
  /** Builds one adapter per account; absent means no provider is configured. */
  createSender?: (account: MailSenderAccount) => MailSender;
  /** Key for the sealed account secret, same envelope as the Telegram token. */
  key?: Uint8Array | null;
  /** MAIL-DOC-01: content-addressed store the attachment bytes come from. */
  store?: StorageAdapter | null;
};
/** MAIL-EDITOR-01: the repository may resolve {{documentLink}}. */
export type MailRepositoryOptions = {
  store?: StorageAdapter | null;
  /** Admin origin; empty leaves {{documentLink}} without a value. */
  origin?: string;
};
export type MailOutboxFailure =
  | { type: 'database'; stage: 'claim' | 'finalize' }
  | { type: 'provider_missing' }
  | { type: 'encryption_unavailable' }
  | { type: 'failed'; code: MailSendFailureCode }
  | { type: 'uncertain' };

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
// MAIL-EDITOR-01: formatted body content. Markup is allowed here - the
// sanitizer decides what survives - only the size is bounded.
function htmlBody(
  value: unknown,
  max: number,
  reason: MailErrorReason,
): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new MailError(reason);
  if (value.length > max) throw new MailError(reason);
  return value.trim();
}
const addressPattern = /^[^\s@,<>"'\\]+@[^\s@,<>"'\\]+\.[^\s@,<>"'\\]+$/;
// Shared by the mail core and the notification settings: one address form.
export function mailAddressList(
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
// MAIL-FWD-01: the cc list for an outgoing mail - the stored accounting
// address when its switch is on (an unconfigured switch refuses), and the
// e-mail addresses of the named app users of this tenant (an unknown id
// refuses). A requested forwarding that cannot be fulfilled never becomes
// a silently dropped copy.
export async function resolveForwardCc(
  connection: Connection,
  tenantId: string,
  forward: {
    accounting?: boolean | undefined;
    userIds?: readonly string[] | undefined;
  },
): Promise<string> {
  return database(connection).transaction(async (tx) => {
    const cc: string[] = [];
    if (forward.accounting) {
      const { rows } = await tx.execute<{ accounting_recipient: string }>(
        sql`SELECT accounting_recipient FROM mail_forward_settings
             WHERE tenant_id = ${tenantId}`,
      );
      const configured = (rows[0]?.accounting_recipient ?? '').trim();
      if (!configured) throw new MailError('forward_unavailable');
      cc.push(...mailAddressList(configured).split(','));
    }
    const userIds = [...new Set(forward.userIds ?? [])];
    if (userIds.length > 5) throw new MailError('forward_unavailable');
    if (userIds.length) {
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      if (!userIds.every((id) => uuid.test(id)))
        throw new MailError('invalid_link');
      // The ids come from the access list (`/api/v1/access`): they are
      // allowed-account ids, not user ids. Resolving against the wrong id
      // space refused every forwarded mail with `invalid_link`.
      const { rows } = await tx.execute<{ email: string }>(
        sql`SELECT email FROM allowed_accounts
             WHERE tenant_id = ${tenantId}
               AND id IN (${sql.join(
                 userIds.map((id) => sql`${id}::uuid`),
                 sql`, `,
               )})`,
      );
      // Every requested user must exist in this tenant - a half-fulfilled
      // forwarding would be a silent drop.
      if (rows.length !== userIds.length) throw new MailError('invalid_link');
      for (const row of rows) cc.push(...mailAddressList(row.email).split(','));
    }
    return [...new Set(cc.filter(Boolean))].join(',');
  });
}

function idempotencyKeyOf(value: unknown): string {
  if (typeof value !== 'string') throw new MailError('idempotency_conflict');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200)
    throw new MailError('idempotency_conflict');
  return trimmed;
}
// One validation path for creating and changing an account. The sender name
// goes into a mail header, so angle brackets, quotes and backslashes would let
// it break out of the display form; they are refused here, never escaped later.
function accountFields(input: MailAccountInput) {
  const name = plainText(input.name, 200, 'invalid_account');
  if (!name) throw new MailError('invalid_account');
  const fromName = plainText(input.fromName, 200, 'invalid_sender');
  if (/[<>"\\]/.test(fromName)) throw new MailError('invalid_sender');
  const fromAddress = (input.fromAddress ?? '').trim();
  if (
    fromAddress &&
    (fromAddress.length > 254 ||
      hasControlCharacters(fromAddress) ||
      !addressPattern.test(fromAddress))
  )
    throw new MailError('invalid_sender');
  const smtpSecurity = input.smtpSecurity ?? 'starttls';
  if (!(mailSmtpSecurities as readonly string[]).includes(smtpSecurity))
    throw new MailError('invalid_security');
  const username = plainText(input.username, 255, 'invalid_account');
  // MAIL-021-B2: a password never travels without TLS; 'none' is the local
  // relay case and must not carry a username into a clear-text AUTH.
  if (smtpSecurity === 'none' && username)
    throw new MailError('invalid_security');
  return {
    name,
    provider: plainText(input.provider, 100, 'invalid_account'),
    imapHost: plainText(input.imapHost, 255, 'invalid_account'),
    imapPort: portOf(input.imapPort),
    smtpHost: plainText(input.smtpHost, 255, 'invalid_account'),
    smtpPort: portOf(input.smtpPort),
    fromName,
    fromAddress,
    smtpSecurity,
    username,
    enabled: input.enabled ?? true,
  };
}
// The stored file name is ours: one fixed prefix, the document number reduced to
// characters that cannot break a MIME header, one extension. No operator input
// ever becomes a name or a path here.
function attachmentFileName(number: string): string {
  const base = `Dokument-${number}`.replace(/[^A-Za-z0-9._-]/g, '_');
  return base.slice(0, 120) + '.pdf';
}
// MAIL-TPL-01d: the same rule for library files - the display name never
// becomes a path or a MIME header as typed, only safe characters survive and
// the derived extension is always present.
const fileExtensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/zip': 'zip',
};
function libraryFileName(displayName: string, mediaType: string): string {
  const extension = fileExtensions[mediaType] ?? 'bin';
  const base =
    displayName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'Datei';
  const named = base.toLowerCase().endsWith('.' + extension)
    ? base
    : base + '.' + extension;
  return named.slice(0, 121);
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
  a.imap_host, a.imap_port, a.smtp_host, a.smtp_port,
  a.from_name, a.from_address, a.smtp_security, a.username, a.enabled,
  (a.secret_ciphertext IS NOT NULL) AS has_secret`;
type AccountQueryRow = {
  id: string;
  name: string;
  provider: string;
  imap_host: string;
  imap_port: number | null;
  smtp_host: string;
  smtp_port: number | null;
  from_name: string;
  from_address: string;
  smtp_security: MailSmtpSecurity;
  username: string;
  enabled: boolean;
  has_secret: boolean;
};
function toAccount(row: AccountQueryRow): MailAccountRow {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    fromName: row.from_name,
    fromAddress: row.from_address,
    smtpSecurity: row.smtp_security,
    username: row.username,
    enabled: row.enabled,
    hasSecret: row.has_secret,
  };
}

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
  send_error_code?: string | null;
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
    sendErrorCode: row.send_error_code ?? null,
  };
}
function toDetail(
  row: MessageQueryRow,
  outbox: MailOutboxRow | null,
): MailMessageDetail {
  return {
    ...toSummary(row),
    sendErrorCode: outbox?.lastErrorCode ?? null,
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
  options: MailRepositoryOptions = {},
) {
  const db = database(pool),
    store = options.store ?? null,
    origin = options.origin ?? '';

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

  // One mail account takes the order. An explicit choice must be an enabled
  // account of this tenant; without one the first enabled account is used, and
  // when none exists the order is refused instead of inventing a sender.
  async function usableAccount(
    connection: Connection,
    accountId: string | null | undefined,
  ): Promise<string> {
    const result = (await reviewed(connection).execute(
      accountId
        ? sql`SELECT id::text AS id FROM mail_accounts
               WHERE tenant_id=${tenantId} AND id=${accountId}::uuid
                 AND enabled`
        : sql`SELECT id::text AS id FROM mail_accounts
               WHERE tenant_id=${tenantId} AND enabled
               ORDER BY name, id LIMIT 1`,
    )) as { rows: { id: string }[] };
    const row = result.rows[0];
    if (!row) throw new MailError('invalid_account');
    return row.id;
  }

  // The reference of a scheduled document send: the order plus the stored
  // attachment row. The bytes are deliberately not part of this answer.
  async function documentSendOf(
    connection: Connection,
    job: MailOutboxRow,
    created: boolean,
    // ATTACH-01a: the gesture's document is the definition of "the main
    // attachment"; it travels only when the order said so.
    mainDocumentId: string,
  ): Promise<MailDocumentSendResult> {
    const result = (await reviewed(connection).execute(sql`
      SELECT a.document_id::text AS document_id, a.filename, a.media_type,
             a.size_bytes
        FROM mail_attachments a
       WHERE a.tenant_id=${tenantId} AND a.message_id=${job.messageId}::uuid
         AND a.document_id=${mainDocumentId}::uuid`)) as {
      rows: {
        document_id: string;
        filename: string;
        media_type: 'application/pdf';
        size_bytes: string;
      }[];
    };
    const reference = result.rows[0];
    // MAIL-TPL-01d: the carried library files belong to the same answer.
    const fileRows = (await reviewed(connection).execute(sql`
      SELECT library_file_id::text AS library_file_id, filename, media_type,
             size_bytes
        FROM mail_file_attachments
       WHERE tenant_id=${tenantId} AND message_id=${job.messageId}::uuid
       ORDER BY filename`)) as {
      rows: {
        library_file_id: string;
        filename: string;
        media_type: string;
        size_bytes: string;
      }[];
    };
    return {
      job,
      messageId: job.messageId,
      attachment: reference
        ? {
            documentId: reference.document_id,
            filename: reference.filename,
            mediaType: reference.media_type,
            sizeBytes: Number(reference.size_bytes),
          }
        : null,
      files: fileRows.rows.map((row) => ({
        libraryFileId: row.library_file_id,
        filename: row.filename,
        mediaType: row.media_type,
        sizeBytes: Number(row.size_bytes),
      })),
      created,
    };
  }

  // MAIL-EDITOR-01: the placeholder values of one document, read from the
  // structured fields only - a first name never comes from the full name and
  // a missing field stays a missing value.
  async function mailValueSources(
    connection: Connection,
    document: {
      id: string;
      grossMinor: number;
      contactId: string | null;
      eventId: string | null;
    },
  ): Promise<MailValueSources> {
    let contact: MailValueSources['contact'] = null;
    if (document.contactId) {
      const result = (await reviewed(connection).execute(sql`
        SELECT name, first_name FROM contacts
         WHERE tenant_id=${tenantId} AND id=${document.contactId}::uuid`)) as {
        rows: { name: string; first_name: string }[];
      };
      const row = result.rows[0];
      if (row) contact = { name: row.name, firstName: row.first_name };
    }
    let event: MailValueSources['event'] = null;
    if (document.eventId) {
      const result = (await reviewed(connection).execute(sql`
        SELECT name, event_date::text AS event_date, venue, venue_override,
               location_id::text AS location_id,
               event_type_id::text AS event_type_id,
               package_id::text AS package_id
          FROM events
         WHERE tenant_id=${tenantId} AND id=${document.eventId}::uuid`)) as {
        rows: {
          name: string;
          event_date: string | null;
          venue: string | null;
          venue_override: boolean;
          location_id: string | null;
          event_type_id: string | null;
          package_id: string | null;
        }[];
      };
      const row = result.rows[0];
      if (row) {
        let locationName: string | null = null;
        if (row.location_id) {
          const location = (await reviewed(connection).execute(sql`
            SELECT name FROM locations
             WHERE tenant_id=${tenantId} AND id=${row.location_id}::uuid`)) as {
            rows: { name: string }[];
          };
          locationName = location.rows[0]?.name ?? null;
        }
        let eventTypeName: string | null = null,
          packageName: string | null = null;
        const kindIds = [row.event_type_id, row.package_id].filter(
          (value): value is string => Boolean(value),
        );
        if (kindIds.length) {
          // An explicit IN list, never an array parameter: drizzle's raw
          // parameter serialisation cannot feed `::uuid[]` (it answers
          // "cannot coerce" and used to 500 every real event with a type or
          // package - the root of the long-unclear send refusals).
          const names = (await reviewed(connection).execute(sql`
            SELECT id::text AS id, name FROM master_data
             WHERE tenant_id=${tenantId}
               AND id IN (${sql.join(
                 kindIds.map((id) => sql`${id}::uuid`),
                 sql`, `,
               )})`)) as {
            rows: { id: string; name: string }[];
          };
          const byId = new Map(
            names.rows.map((entry) => [entry.id, entry.name]),
          );
          eventTypeName = row.event_type_id
            ? (byId.get(row.event_type_id) ?? null)
            : null;
          packageName = row.package_id
            ? (byId.get(row.package_id) ?? null)
            : null;
        }
        event = {
          name: row.name,
          eventDate: row.event_date,
          venue: row.venue,
          venueOverride: row.venue_override,
          locationName,
          eventTypeName,
          packageName,
        };
      }
    }
    const tenant = (await reviewed(connection).execute(sql`
      SELECT timezone FROM tenants WHERE id=${tenantId}`)) as {
      rows: { timezone: string }[];
    };
    return {
      origin,
      document: { id: document.id, grossMinor: document.grossMinor },
      contact,
      event,
      timezone: tenant.rows[0]?.timezone ?? 'UTC',
    };
  }

  // MAIL-EDITOR-01: the body of a document mail. Unknown placeholders are
  // invalid content; known ones without a value stay visible instead of
  // being silently emptied. The HTML is always sanitized and the text
  // alternative is always derived on the server.
  async function documentMailContent(
    connection: Connection,
    document: {
      id: string;
      number: string;
      grossMinor: number;
      contactId: string | null;
      eventId: string | null;
    },
    input: {
      subject?: string | null;
      bodyHtml: string | null;
      bodyText: string | null;
    },
  ): Promise<{
    subject: string;
    bodyHtml: string | null;
    bodyText: string;
    missing: string[];
  }> {
    const raw = input.bodyHtml ?? input.bodyText ?? '',
      rawSubject = input.subject ?? '';
    try {
      assertMailPlaceholders(raw, rawSubject);
    } catch {
      throw new MailError('invalid_content');
    }
    // MAIL-TPL-01c: the subject is plain text - a value may never split a
    // header line - and an empty one keeps the automatic document subject.
    if (rawSubject.length > 998 || hasControlCharacters(rawSubject))
      throw new MailError('invalid_subject');
    const values = mailPlaceholderValues(
      await mailValueSources(connection, document),
    );
    const fallback = `Anbei erhalten Sie das Dokument ${document.number} als PDF.`;
    const subject = rawSubject
      ? resolveMailSubject(rawSubject, values)
      : { subject: `Dokument ${document.number}`, missing: [] };
    if (subject.subject.length > 998) throw new MailError('invalid_subject');
    const missing = [...subject.missing];
    if (input.bodyHtml) {
      // Values are text: escaped for the HTML, raw for the text alternative.
      const escaped = Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          escapeMailHtmlText(value),
        ]),
      ) as Partial<Record<MailPlaceholder, string>>;
      const resolved = resolveMailPlaceholders(input.bodyHtml, escaped),
        html = sanitizeMailHtml(resolved.text);
      return {
        subject: subject.subject,
        bodyHtml: html,
        bodyText: mailBodyTextFromHtml(html),
        missing: [...new Set([...missing, ...resolved.missing])],
      };
    }
    const resolved = resolveMailPlaceholders(input.bodyText ?? '', values);
    return {
      subject: subject.subject,
      bodyHtml: null,
      bodyText: resolved.text || fallback,
      missing: [...new Set([...missing, ...resolved.missing])],
    };
  }

  return {
    requireMember,

    async listAccounts(): Promise<MailAccountRow[]> {
      const result = (await reviewed(db).execute(sql`
        SELECT ${accountColumns} FROM mail_accounts a
         WHERE a.tenant_id=${tenantId} ORDER BY a.name`)) as {
        rows: AccountQueryRow[];
      };
      return result.rows.map(toAccount);
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
        const fields = accountFields(input);
        const sealed =
          input.secret === undefined || input.secret === ''
            ? null
            : encryptTelegramToken(input.secret, requireKey(encryptionKey));
        if (fields.enabled && !sealed) throw new MailError('secret_required');
        try {
          const result = (await reviewed(tx).execute(sql`
            INSERT INTO mail_accounts AS a
              (tenant_id,id,name,provider,imap_host,imap_port,smtp_host,smtp_port,
               from_name,from_address,smtp_security,username,secret_ciphertext,
               secret_nonce,secret_tag,enabled)
            VALUES (${tenantId},${randomUUID()}::uuid,${fields.name},
                    ${fields.provider},${fields.imapHost},${fields.imapPort},
                    ${fields.smtpHost},${fields.smtpPort},${fields.fromName},
                    ${fields.fromAddress},${fields.smtpSecurity},
                    ${fields.username},${sealed?.ciphertext ?? null},
                    ${sealed?.nonce ?? null},${sealed?.tag ?? null},
                    ${fields.enabled})
            RETURNING ${accountColumns}`)) as { rows: AccountQueryRow[] };
          const row = result.rows[0]!;
          await appendAudit(
            tx,
            tenantId,
            'mail.account_saved',
            actorId,
            row.id,
          );
          return toAccount(row);
        } catch (error) {
          const code =
            (error as { code?: string }).code ??
            (error as { cause?: { code?: string } }).cause?.code;
          if (code === '23505') throw new MailError('already_exists');
          throw error;
        }
      });
    },

    // Changing an account never touches its secret unless a new one is handed
    // in: an empty or missing password keeps the sealed one. Enabling needs a
    // secret to exist, the one already sealed is enough.
    async updateAccount(
      actorId: string,
      id: string,
      input: MailAccountInput,
    ): Promise<MailAccountRow> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const fields = accountFields(input);
        const found = await tx.execute<{ secret_ciphertext: Buffer | null }>(
          sql`SELECT secret_ciphertext FROM mail_accounts
               WHERE tenant_id=${tenantId} AND id=${id}::uuid FOR UPDATE`,
        );
        const existing = found.rows[0];
        // Another tenant's account is missing, never forbidden: no leak.
        if (!existing) throw new MailError('not_found');
        const sealed =
          input.secret === undefined || input.secret === ''
            ? null
            : encryptTelegramToken(input.secret, requireKey(encryptionKey));
        if (fields.enabled && !sealed && !existing.secret_ciphertext)
          throw new MailError('secret_required');
        try {
          const result = (await reviewed(tx).execute(sql`
            UPDATE mail_accounts AS a
               SET name=${fields.name}, provider=${fields.provider},
                   imap_host=${fields.imapHost}, imap_port=${fields.imapPort},
                   smtp_host=${fields.smtpHost}, smtp_port=${fields.smtpPort},
                   from_name=${fields.fromName},
                   from_address=${fields.fromAddress},
                   smtp_security=${fields.smtpSecurity},
                   username=${fields.username},
                   secret_ciphertext=COALESCE(${sealed?.ciphertext ?? null}, secret_ciphertext),
                   secret_nonce=COALESCE(${sealed?.nonce ?? null}, secret_nonce),
                   secret_tag=COALESCE(${sealed?.tag ?? null}, secret_tag),
                   enabled=${fields.enabled}, updated_at=now()
             WHERE a.tenant_id=${tenantId} AND a.id=${id}::uuid
             RETURNING ${accountColumns}`)) as { rows: AccountQueryRow[] };
          const row = result.rows[0]!;
          await appendAudit(
            tx,
            tenantId,
            'mail.account_saved',
            actorId,
            row.id,
          );
          return toAccount(row);
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
          from = mailAddressList(input.from),
          to = mailAddressList(input.to),
          cc = mailAddressList(input.cc),
          bcc = mailAddressList(input.bcc);
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
        SELECT ${messageColumns},
               (SELECT o.last_error_code FROM mail_outbox o
                 WHERE o.tenant_id=m.tenant_id AND o.message_id=m.id
                 ORDER BY o.created_at DESC, o.id DESC LIMIT 1) AS send_error_code
          FROM mail_messages m
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

    // MAIL-EVENT-01: a free mail is one explicit gesture like the document
    // send - the request id is the idempotency key, so a repeat or an
    // unclear answer can never become a second order. The body runs through
    // the same allowlist sanitizer and text derivation as the document
    // mail; subject and addresses go through the same plain-text and
    // address validation, so no header line can be split.
    async scheduleCompose(
      actorId: string,
      input: MailComposeInput,
    ): Promise<{ job: MailOutboxRow; created: boolean }> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const key = `mail-compose:${idempotencyKeyOf(input.requestId)}`;
        const existing = (await reviewed(tx).execute(sql`
          SELECT ${outboxColumns} FROM mail_outbox o
           WHERE o.tenant_id=${tenantId} AND o.idempotency_key=${key}`)) as {
          rows: OutboxQueryRow[];
        };
        if (existing.rows[0])
          return { job: toOutbox(existing.rows[0]), created: false };
        const to = mailAddressList(input.to);
        if (!to) throw new MailError('invalid_recipients');
        const subject = plainText(input.subject ?? '', 998, 'invalid_subject');
        if (!subject) throw new MailError('invalid_subject');
        // The same sanitizer as the document mail: only the mail allowlist
        // leaves the server, and the text alternative is derived here.
        const html = sanitizeMailHtml(
          htmlBody(input.bodyHtml, 200000, 'invalid_body'),
        );
        const text = mailBodyTextFromHtml(html);
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
        // MAIL-FWD-01: the forwarding switches resolve their addresses here;
        // an unconfigured switch refuses instead of dropping a copy.
        const cc = await resolveForwardCc(tx, tenantId, {
          accounting: input.forwardAccounting,
          userIds: input.forwardUserIds,
        });
        const account = await usableAccount(tx, input.accountId),
          messageId = randomUUID();
        await reviewed(tx).execute(sql`
          INSERT INTO mail_messages AS m
            (tenant_id,id,account_id,direction,folder,subject,body_text,
             body_html,to_addresses,cc_addresses,contact_id,event_id,
             send_state)
          VALUES (${tenantId},${messageId}::uuid,${account}::uuid,'out','drafts',
                  ${subject},${text},${html || null},${to},${cc || ''},
                  ${input.contactId ?? null}::uuid,${input.eventId ?? null}::uuid,
                  'scheduled')`);
        await appendAudit(
          tx,
          tenantId,
          'mail.message_created',
          actorId,
          messageId,
        );
        const job = (await reviewed(tx).execute(sql`
          INSERT INTO mail_outbox AS o (tenant_id,id,message_id,idempotency_key)
          VALUES (${tenantId},${randomUUID()}::uuid,${messageId}::uuid,${key})
          ON CONFLICT (tenant_id,idempotency_key) DO NOTHING
          RETURNING ${outboxColumns}`)) as { rows: OutboxQueryRow[] };
        // The tenant lock serialises this path; a conflict can only mean a
        // request id that already belongs to another message.
        if (!job.rows[0]) throw new MailError('idempotency_conflict');
        await appendAudit(
          tx,
          tenantId,
          'mail.send_scheduled',
          actorId,
          job.rows[0].id,
        );
        return { job: toOutbox(job.rows[0]), created: true };
      });
    },

    // MAIL-DOC-01: a document send is one explicit gesture: a client request id
    // is the idempotency key, so the same gesture can never become a second
    // order - also after an unclear answer. The attachment references the frozen
    // artefact of a finalized, tenant-owned document; the bytes are read once
    // here to prove they exist and to record their size, and again for every
    // attempt. Nothing is rendered, copied into the database or taken from a
    // user-provided path.
    async scheduleDocumentSend(
      actorId: string,
      input: MailDocumentSendInput,
    ): Promise<MailDocumentSendResult> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const requestId = idempotencyKeyOf(input.requestId),
          key = `document-send:${input.documentId}:${requestId}`;
        // A replay answers the very same order, even if the document was
        // withdrawn in between: the job already exists and is not re-decided.
        const existing = (await reviewed(tx).execute(sql`
          SELECT ${outboxColumns} FROM mail_outbox o
           WHERE o.tenant_id=${tenantId} AND o.idempotency_key=${key}`)) as {
          rows: OutboxQueryRow[];
        };
        if (existing.rows[0])
          return await documentSendOf(
            tx,
            toOutbox(existing.rows[0]),
            false,
            input.documentId,
          );

        const to = mailAddressList(input.to),
          text = bodyText(input.bodyText ?? '', 20000, 'invalid_body'),
          html = htmlBody(input.bodyHtml, 200000, 'invalid_body');
        // At most one body kind: the formatted body wins nothing silently.
        if (html && text) throw new MailError('invalid_body');
        if (!to) throw new MailError('invalid_recipients');
        const found = await tx.execute<{
          number: string | null;
          state: 'draft' | 'final' | 'withdrawn';
          pdf_hash: string | null;
          gross_minor: string;
          contact_id: string | null;
          event_id: string | null;
        }>(
          sql`SELECT number, state, pdf_hash, gross_minor,
                     contact_id::text AS contact_id, event_id::text AS event_id
                FROM documents
               WHERE tenant_id=${tenantId} AND id=${input.documentId}::uuid`,
        );
        const document = found.rows[0];
        // Another tenant's row is missing, never forbidden: no leak.
        if (!document) throw new MailError('not_found');
        // Only the frozen artefact of a final row may travel. A draft has none,
        // a withdrawn document is no longer a valid document to hand out.
        if (
          document.state !== 'final' ||
          !document.number ||
          !document.pdf_hash
        )
          throw new MailError('not_final');
        if (!store) throw new MailError('attachment_unavailable');
        let bytes: Buffer;
        try {
          bytes = await readDocumentPdf(store, document.pdf_hash);
        } catch {
          throw new MailError('attachment_unavailable');
        }
        if (!bytes.byteLength || bytes.byteLength > maxMailAttachmentBytes)
          throw new MailError('attachment_unavailable');

        // MAIL-TPL-01d: every chosen library file is checked again here and
        // frozen by its storage key. An unavailable file refuses the whole
        // order - the transaction leaves no message behind - and is never
        // silently dropped.
        const attachDocument = input.attachDocument ?? true,
          fileIds = [...new Set(input.fileIds ?? [])];
        if (fileIds.length > 20) throw new MailError('attachment_unavailable');
        const files: {
          libraryFileId: string;
          filename: string;
          mediaType: string;
          sizeBytes: number;
          storageKey: string;
          sha256: string;
        }[] = [];
        for (const fileId of fileIds) {
          const found = await tx.execute<{
            id: string;
            display_name: string;
            media_type: string;
            size_bytes: string;
            storage_key: string;
            sha256: string;
          }>(
            sql`SELECT id::text AS id, display_name, media_type, size_bytes,
                       storage_key, sha256
                  FROM library_files
                 WHERE tenant_id=${tenantId} AND id=${fileId}::uuid
                   AND state='available' AND scan_state='not_scanned'`,
          );
          const row = found.rows[0];
          if (!row) throw new MailError('attachment_unavailable');
          files.push({
            libraryFileId: row.id,
            filename: libraryFileName(row.display_name, row.media_type),
            mediaType: row.media_type,
            sizeBytes: Number(row.size_bytes),
            storageKey: row.storage_key,
            sha256: row.sha256,
          });
        }

        // ATTACH-01a: other final documents of the event travel on request;
        // each is re-checked and read once here like the main document, and
        // an unavailable one refuses the whole order.
        const extraDocumentIds = [...new Set(input.documentIds ?? [])].filter(
          (id) => id !== input.documentId,
        );
        if (extraDocumentIds.length > 10)
          throw new MailError('attachment_unavailable');
        const extraDocuments: {
          id: string;
          number: string;
          pdfHash: string;
          sizeBytes: number;
        }[] = [];
        for (const documentId of extraDocumentIds) {
          const found = await tx.execute<{
            number: string | null;
            state: 'draft' | 'final' | 'withdrawn';
            pdf_hash: string | null;
          }>(
            sql`SELECT number, state, pdf_hash FROM documents
                 WHERE tenant_id=${tenantId} AND id=${documentId}::uuid`,
          );
          const row = found.rows[0];
          if (!row || row.state !== 'final' || !row.number || !row.pdf_hash)
            throw new MailError('attachment_unavailable');
          let sizeBytes: number;
          try {
            sizeBytes = (await readDocumentPdf(store!, row.pdf_hash))
              .byteLength;
          } catch {
            throw new MailError('attachment_unavailable');
          }
          if (!sizeBytes || sizeBytes > maxMailAttachmentBytes)
            throw new MailError('attachment_unavailable');
          extraDocuments.push({
            id: documentId,
            number: row.number,
            pdfHash: row.pdf_hash,
            sizeBytes,
          });
        }

        const account = await usableAccount(tx, input.accountId),
          messageId = randomUUID(),
          filename = attachmentFileName(document.number),
          // MAIL-EDITOR-01/MAIL-TPL-01c: resolve subject and body, sanitize
          // and derive - on the server.
          content = await documentMailContent(
            tx,
            {
              id: input.documentId,
              number: document.number,
              grossMinor: Number(document.gross_minor),
              contactId: document.contact_id,
              eventId: document.event_id,
            },
            {
              subject: input.subject ?? null,
              bodyHtml: html || null,
              bodyText: text || null,
            },
          );
        // MAIL-FWD-01: the forwarding switches resolve their addresses here;
        // an unconfigured switch refuses instead of dropping a copy.
        const cc = await resolveForwardCc(tx, tenantId, {
          accounting: input.forwardAccounting,
          userIds: input.forwardUserIds,
        });
        const inserted = (await reviewed(tx).execute(sql`
          INSERT INTO mail_messages AS m
            (tenant_id,id,account_id,direction,folder,subject,body_text,
             body_html,to_addresses,cc_addresses,contact_id,event_id)
          VALUES (${tenantId},${messageId}::uuid,${account}::uuid,'out','drafts',
                  ${content.subject},${content.bodyText},${content.bodyHtml},${to},
                  ${cc || ''},
                  ${document.contact_id}::uuid,${document.event_id}::uuid)
          RETURNING ${messageColumns}`)) as { rows: MessageQueryRow[] };
        // ATTACH-01a: the document itself travels only on request - removing
        // it is an explicit decision and never a silent drop.
        if (attachDocument)
          await reviewed(tx).execute(sql`
            INSERT INTO mail_attachments
              (tenant_id,message_id,document_id,pdf_hash,filename,media_type,size_bytes)
            VALUES (${tenantId},${messageId}::uuid,${input.documentId}::uuid,
                    ${document.pdf_hash},${filename},'application/pdf',
                    ${bytes.byteLength})`);
        for (const doc of extraDocuments) {
          await reviewed(tx).execute(sql`
            INSERT INTO mail_attachments
              (tenant_id,message_id,document_id,pdf_hash,filename,media_type,size_bytes)
            VALUES (${tenantId},${messageId}::uuid,${doc.id}::uuid,
                    ${doc.pdfHash},${attachmentFileName(doc.number)},
                    'application/pdf',${doc.sizeBytes})`);
        }
        for (const file of files) {
          await reviewed(tx).execute(sql`
            INSERT INTO mail_file_attachments
              (tenant_id,message_id,library_file_id,filename,media_type,
               size_bytes,storage_key,sha256)
            VALUES (${tenantId},${messageId}::uuid,${file.libraryFileId}::uuid,
                    ${file.filename},${file.mediaType},${file.sizeBytes},
                    ${file.storageKey},${file.sha256})`);
        }
        const job = (await reviewed(tx).execute(sql`
          INSERT INTO mail_outbox AS o (tenant_id,id,message_id,idempotency_key)
          VALUES (${tenantId},${randomUUID()}::uuid,${messageId}::uuid,${key})
          ON CONFLICT (tenant_id,idempotency_key) DO NOTHING
          RETURNING ${outboxColumns}`)) as { rows: OutboxQueryRow[] };
        // The tenant lock serialises this path; a conflict can only mean a
        // request id that already belongs to another message. Rolling back
        // removes the message and attachment again.
        if (!job.rows[0]) throw new MailError('idempotency_conflict');
        await tx.execute(
          sql`UPDATE mail_messages SET send_state='scheduled', updated_at=now()
               WHERE tenant_id=${tenantId} AND id=${messageId}::uuid`,
        );
        await appendAudit(
          tx,
          tenantId,
          'mail.document_send_scheduled',
          actorId,
          job.rows[0].id,
        );
        return {
          job: toOutbox(job.rows[0]),
          messageId: inserted.rows[0]!.id,
          attachment: attachDocument
            ? {
                documentId: input.documentId,
                filename,
                mediaType: 'application/pdf' as const,
                sizeBytes: bytes.byteLength,
              }
            : null,
          files: files.map(
            ({ libraryFileId, filename: name, mediaType, sizeBytes }) => ({
              libraryFileId,
              filename: name,
              mediaType,
              sizeBytes,
            }),
          ),
          created: true,
        };
      });
    },

    // MAIL-EDITOR-01: the read-only twin of the send above. The same document
    // checks and the same content assembly - but no order, no attachment
    // check, no audit and no row of any kind.
    async previewDocumentSend(
      input: MailDocumentPreviewInput,
    ): Promise<MailDocumentPreview> {
      return db.transaction(async (tx) => {
        const text = bodyText(input.bodyText ?? '', 20000, 'invalid_body'),
          html = htmlBody(input.bodyHtml, 200000, 'invalid_body');
        if (html && text) throw new MailError('invalid_body');
        const found = await tx.execute<{
          number: string | null;
          state: 'draft' | 'final' | 'withdrawn';
          gross_minor: string;
          contact_id: string | null;
          event_id: string | null;
        }>(
          sql`SELECT number, state, gross_minor,
                     contact_id::text AS contact_id, event_id::text AS event_id
                FROM documents
               WHERE tenant_id=${tenantId} AND id=${input.documentId}::uuid`,
        );
        const document = found.rows[0];
        // Another tenant's row is missing, never forbidden: no leak.
        if (!document) throw new MailError('not_found');
        // A draft has no final content to preview honestly.
        if (document.state !== 'final' || !document.number)
          throw new MailError('not_final');
        const content = await documentMailContent(
          tx,
          {
            id: input.documentId,
            number: document.number,
            grossMinor: Number(document.gross_minor),
            contactId: document.contact_id,
            eventId: document.event_id,
          },
          {
            subject: input.subject ?? null,
            bodyHtml: html || null,
            bodyText: text || null,
          },
        );
        return {
          subject: content.subject,
          bodyHtml: content.bodyHtml,
          bodyText: content.bodyText,
          missing: content.missing,
        };
      });
    },

    // MAIL-021-B: the only way out of `uncertain`. A terminal unclear outcome is
    // never restarted by the loop, so an operator must decide it - and that
    // decision is audited on its own. The same job goes back to `pending`; no
    // second order and no second idempotency key exists for this attempt.
    async retryUncertainSend(
      actorId: string,
      outboxId: string,
    ): Promise<MailOutboxRow> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const found = await tx.execute<{
          state: MailOutboxState;
          message_id: string;
        }>(
          sql`SELECT state, message_id::text AS message_id FROM mail_outbox
               WHERE tenant_id=${tenantId} AND id=${outboxId}::uuid FOR UPDATE`,
        );
        const current = found.rows[0];
        // Another tenant's job is missing, never forbidden: no leak.
        if (!current) throw new MailError('not_found');
        if (current.state !== 'uncertain') throw new MailError('not_retryable');
        const updated = (await reviewed(tx).execute(sql`
          UPDATE mail_outbox o
             SET state='pending', next_attempt_at=now(), locked_at=NULL,
                 last_error_code=NULL, updated_at=now()
           WHERE o.tenant_id=${tenantId} AND o.id=${outboxId}::uuid
             AND o.state='uncertain'
          RETURNING ${outboxColumns}`)) as { rows: OutboxQueryRow[] };
        const row = updated.rows[0];
        if (!row) throw new MailError('not_retryable');
        await tx.execute(
          sql`UPDATE mail_messages SET send_state='scheduled', updated_at=now()
               WHERE tenant_id=${tenantId} AND id=${current.message_id}::uuid`,
        );
        await appendAudit(tx, tenantId, 'mail.send_retry', actorId, outboxId);
        return toOutbox(row);
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

// One attempt of this tenant's job: everything the adapter needs, read in a
// single statement so a message or account removed in between cannot produce a
// half attempt.
type MailAttempt =
  | {
      account: MailSenderAccount;
      envelope: MailSendEnvelope;
      content: MailSendContent;
    }
  | {
      problem:
        MailSendFailureCode | 'provider_missing' | 'encryption_unavailable';
    };

type AttemptRow = {
  subject: string;
  body_text: string;
  body_html: string | null;
  from_address: string;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  message_id: string | null;
  enabled: boolean;
  smtp_host: string;
  smtp_port: number | null;
  smtp_security: MailSmtpSecurity;
  from_name: string;
  account_from_address: string;
  username: string;
  secret_ciphertext: Buffer | null;
  secret_nonce: Buffer | null;
  secret_tag: Buffer | null;
};

function addressesOf(value: string): string[] {
  return value.trim()
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

type AttemptAttachmentRow = {
  document_id: string;
  pdf_hash: string;
  filename: string;
  media_type: string;
};

async function prepareMailAttempt(
  client: PoolClient,
  job: ClaimedMailOutboxJob,
  key: Uint8Array | null,
  store: StorageAdapter | null,
): Promise<MailAttempt> {
  const { rows } = await client.query<AttemptRow>(
    `SELECT m.subject, m.body_text, m.body_html, m.from_address, m.to_addresses,
            m.cc_addresses, m.bcc_addresses, m.message_id,
            a.enabled, a.smtp_host, a.smtp_port, a.smtp_security, a.from_name,
            a.from_address AS account_from_address, a.username,
            a.secret_ciphertext, a.secret_nonce, a.secret_tag
       FROM mail_outbox o
       JOIN mail_messages m ON m.tenant_id=o.tenant_id AND m.id=o.message_id
       JOIN mail_accounts a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
      WHERE o.tenant_id=$1 AND o.id=$2`,
    [job.tenantId, job.id],
  );
  const row = rows[0];
  if (!row) return { problem: 'internal' };
  // A paused or hostless account is not a provider: say so instead of guessing.
  if (!row.enabled || !row.smtp_host) return { problem: 'provider_missing' };
  if (!row.secret_ciphertext || !row.secret_nonce || !row.secret_tag || !key)
    return { problem: 'encryption_unavailable' };
  let secret: string;
  try {
    // Same AES-256-GCM envelope as the Telegram token: one crypto, one key.
    secret = decryptTelegramToken(
      {
        ciphertext: row.secret_ciphertext,
        nonce: row.secret_nonce,
        tag: row.secret_tag,
      },
      key,
    );
  } catch {
    return { problem: 'encryption_unavailable' };
  }
  // The sender identity: the message's own address first, then the account's
  // configured one, then the username. The display name decorates the header
  // only; the envelope always carries the bare address.
  const from =
    row.from_address.trim() ||
    row.account_from_address.trim() ||
    row.username.trim();
  const to = addressesOf(row.to_addresses);
  if (!from) return { problem: 'provider_missing' };
  if (!to.length) return { problem: 'internal' };
  // MAIL-DOC-01: an attachment is a reference to one frozen artefact. The bytes
  // are read here, once per attempt, from the content-addressed store - never
  // from a path, never from a second rendering of the document.
  const references = await client.query<AttemptAttachmentRow>(
    `SELECT document_id::text, pdf_hash, filename, media_type
       FROM mail_attachments
      WHERE tenant_id=$1 AND message_id=$2
      ORDER BY filename`,
    [job.tenantId, job.messageId],
  );
  const attachments: MailSendAttachment[] = [];
  if (references.rows.length && !store)
    return { problem: 'attachment_unavailable' };
  for (const reference of references.rows) {
    try {
      attachments.push({
        filename: reference.filename,
        content: await readDocumentPdf(store!, reference.pdf_hash),
        contentType: reference.media_type,
      });
    } catch {
      // A referenced document that cannot be read is a definite non-delivery:
      // the mail must not go out without the document it announces.
      return { problem: 'attachment_unavailable' };
    }
  }
  // MAIL-TPL-01d: library files travel from the same store through their
  // frozen key, and every attempt verifies the recorded hash - a replaced or
  // corrupted file is a named failure and never the wrong bytes.
  const fileReferences = await client.query<{
    filename: string;
    media_type: string;
    storage_key: string;
    sha256: string;
  }>(
    `SELECT filename, media_type, storage_key, sha256
       FROM mail_file_attachments
      WHERE tenant_id=$1 AND message_id=$2
      ORDER BY filename`,
    [job.tenantId, job.messageId],
  );
  if (fileReferences.rows.length && !store)
    return { problem: 'attachment_unavailable' };
  for (const reference of fileReferences.rows) {
    try {
      const content = await store!.read(reference.storage_key);
      if (
        content.byteLength <= 0 ||
        content.byteLength > maxMailAttachmentBytes ||
        createHash('sha256').update(content).digest('hex') !== reference.sha256
      )
        return { problem: 'attachment_unavailable' };
      attachments.push({
        filename: reference.filename,
        content,
        contentType: reference.media_type,
      });
    } catch {
      return { problem: 'attachment_unavailable' };
    }
  }
  return {
    account: {
      host: row.smtp_host,
      port: row.smtp_port,
      username: row.username,
      secret,
      security: row.smtp_security,
    },
    envelope: {
      from,
      fromName: row.from_name.trim() || undefined,
      to,
      cc: addressesOf(row.cc_addresses),
      bcc: addressesOf(row.bcc_addresses),
    },
    content: {
      subject: row.subject,
      text: row.body_text,
      html: row.body_html,
      messageId: row.message_id,
      ...(attachments.length ? { attachments } : {}),
    },
  };
}

type MailOutcome =
  | { state: 'sent' }
  | { state: 'failed'; code: string }
  | { state: 'uncertain' };

function failureOf(code: string): MailOutboxFailure {
  if (code === 'provider_missing') return { type: 'provider_missing' };
  if (code === 'encryption_unavailable')
    return { type: 'encryption_unavailable' };
  return { type: 'failed', code: code as MailSendFailureCode };
}

// The row and the message state move in one transaction. A claimed job whose
// lease was taken over by a restarted worker keeps what the other worker wrote:
// every statement is bound to `state='sending'`, so an old attempt can never
// overwrite a newer outcome.
async function finalizeMailOutboxAttempt(
  client: PoolClient,
  job: ClaimedMailOutboxJob,
  outcome: MailOutcome,
): Promise<void> {
  if (outcome.state === 'sent') {
    const closed = await client.query(
      `UPDATE mail_outbox
          SET state='sent', sent_at=now(), locked_at=NULL,
              last_error_code=NULL, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND state='sending'`,
      [job.tenantId, job.id],
    );
    await client.query(
      `UPDATE mail_messages m
          SET send_state='sent', sent_at=now(), updated_at=now(),
              folder=CASE WHEN m.folder='drafts' THEN 'sent' ELSE m.folder END
         FROM mail_outbox o
        WHERE o.tenant_id=$1 AND o.id=$2 AND o.state='sent'
          AND m.tenant_id=o.tenant_id AND m.id=o.message_id`,
      [job.tenantId, job.id],
    );
    // Only the worker that really closed the job records the delivery.
    if (closed.rowCount)
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_id, action, record_id)
         VALUES ($1, NULL, 'mail.sent', $2)`,
        [job.tenantId, job.id],
      );
    return;
  }
  if (outcome.state === 'failed')
    await client.query(
      `UPDATE mail_outbox
          SET state='failed', last_error_code=$3, locked_at=NULL,
              next_attempt_at=now()+make_interval(secs=>$4::int),
              updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND state='sending'`,
      [
        job.tenantId,
        job.id,
        outcome.code,
        mailOutboxRetryDelaySeconds(job.attempts),
      ],
    );
  else
    await client.query(
      `UPDATE mail_outbox
          SET state='uncertain', last_error_code='provider_uncertain',
              locked_at=NULL, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND state='sending'`,
      [job.tenantId, job.id],
    );
  await client.query(
    `UPDATE mail_messages m SET send_state=$3, updated_at=now()
       FROM mail_outbox o
      WHERE o.tenant_id=$1 AND o.id=$2 AND o.state=$3
        AND m.tenant_id=o.tenant_id AND m.id=o.message_id`,
    [job.tenantId, job.id, outcome.state],
  );
}

// One honest pass. The job is claimed, handed to the adapter once, and the
// outcome is written down: `sent` for an accepted message, `failed` with a
// redacted category and the usual backoff for a definite refusal, and
// `uncertain` - terminal - when the provider may have taken the message.
export async function runMailOutboxPass(
  pool: Pool,
  reportError: (failure: MailOutboxFailure) => void = () => {},
  config: MailOutboxConfig = {},
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
    const claimed = job;
    const conclude = async (
      outcome: MailOutcome,
      failure: MailOutboxFailure | null,
    ) => {
      try {
        await client.query('BEGIN');
        await finalizeMailOutboxAttempt(client, claimed, outcome);
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => {});
        reportError({ type: 'database', stage: 'finalize' });
        return false;
      }
      if (failure) reportError(failure);
      return true;
    };
    const { createSender, key, store } = config;
    // Without an adapter nothing can leave the machine: the job says so.
    if (!createSender)
      return conclude(
        { state: 'failed', code: 'provider_missing' },
        {
          type: 'provider_missing',
        },
      );
    let attempt: MailAttempt;
    try {
      attempt = await prepareMailAttempt(
        client,
        claimed,
        key ?? null,
        store ?? null,
      );
    } catch {
      // The attempt never began. The job keeps its lease and is retried after
      // it expires, exactly like a crashed worker.
      reportError({ type: 'database', stage: 'finalize' });
      return false;
    }
    if ('problem' in attempt)
      return conclude(
        { state: 'failed', code: attempt.problem },
        failureOf(attempt.problem),
      );
    let result: MailSendResult;
    try {
      result = await createSender(attempt.account).send(
        attempt.envelope,
        attempt.content,
      );
    } catch {
      // An adapter that throws did not tell us what happened: never retry blind.
      result = 'uncertain';
    }
    if (result === 'sent') return conclude({ state: 'sent' }, null);
    if (result === 'uncertain')
      return conclude({ state: 'uncertain' }, { type: 'uncertain' });
    return conclude(
      { state: 'failed', code: result.failed },
      {
        type: 'failed',
        code: result.failed,
      },
    );
  } finally {
    client.release();
  }
}

export function startMailOutbox(
  pool: Pool,
  reportError: (failure: MailOutboxFailure) => void = () => {},
  intervalMs = 5000,
  config: MailOutboxConfig = {},
) {
  let pending: Promise<void> | null = null;
  const run = () => {
    if (pending) return;
    pending = runMailOutboxPass(pool, reportError, config)
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
    'sendErrorCode',
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
    sendErrorCode: nullableText,
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
// MAIL-DOC-01: the answer names the frozen artefact by its document and file
// name - never its bytes, its hash or any content of the document.
const attachmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId', 'filename', 'mediaType', 'sizeBytes'],
  properties: {
    documentId: { type: 'string', format: 'uuid' },
    filename: { type: 'string' },
    mediaType: { type: 'string', const: 'application/pdf' },
    sizeBytes: { type: 'integer', minimum: 1 },
  },
} as const;
const fileAttachmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['libraryFileId', 'filename', 'mediaType', 'sizeBytes'],
  properties: {
    libraryFileId: { type: 'string', format: 'uuid' },
    filename: { type: 'string' },
    mediaType: { type: 'string' },
    sizeBytes: { type: 'integer', minimum: 1 },
  },
} as const;
const documentSendSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['messageId', 'job', 'attachment', 'files'],
  properties: {
    messageId: { type: 'string', format: 'uuid' },
    job: outboxSchema,
    // ATTACH-01a: null when the chosen document does not travel.
    attachment: { anyOf: [attachmentSchema, { type: 'null' }] },
    files: { type: 'array', maxItems: 20, items: fileAttachmentSchema },
  },
} as const;
// MAIL-ACCOUNT-01: an account answer is this whitelist and nothing else - the
// sealed secret columns have no schema entry, so they can never serialize.
const accountSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'provider',
    'imapHost',
    'imapPort',
    'smtpHost',
    'smtpPort',
    'fromName',
    'fromAddress',
    'smtpSecurity',
    'username',
    'enabled',
    'hasSecret',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    provider: { type: 'string' },
    imapHost: { type: 'string' },
    imapPort: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    smtpHost: { type: 'string' },
    smtpPort: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    fromName: { type: 'string' },
    fromAddress: { type: 'string' },
    smtpSecurity: { type: 'string', enum: [...mailSmtpSecurities] },
    username: { type: 'string' },
    enabled: { type: 'boolean' },
    hasSecret: { type: 'boolean' },
  },
} as const;
const accountBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'fromAddress', 'smtpHost', 'smtpPort', 'smtpSecurity'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    provider: { type: 'string', maxLength: 100 },
    imapHost: { type: 'string', maxLength: 255 },
    imapPort: { type: 'integer', minimum: 1, maximum: 65535 },
    smtpHost: { type: 'string', minLength: 1, maxLength: 255 },
    smtpPort: { type: 'integer', minimum: 1, maximum: 65535 },
    fromName: { type: 'string', maxLength: 200 },
    fromAddress: { type: 'string', minLength: 3, maxLength: 254 },
    smtpSecurity: { type: 'string', enum: [...mailSmtpSecurities] },
    username: { type: 'string', maxLength: 255 },
    // Omitted or empty keeps an existing secret; only a non-empty one replaces.
    secret: { type: 'string', maxLength: 512 },
    enabled: { type: 'boolean' },
  },
} as const;

export function registerMailRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  // MAIL-ACCOUNT-01: the same AES-GCM key that seals the Telegram token seals
  // account secrets; without it the account routes fail closed (503).
  options: {
    store?: StorageAdapter | null;
    key?: Uint8Array | null;
    /** MAIL-EDITOR-01: admin origin for {{documentLink}}. */
    origin?: string;
  } = {},
) {
  const repo = mailRepository(pool, tenantId, options.key ?? null, {
      store: options.store ?? null,
      origin: options.origin ?? '',
    }),
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
      // No key is sealed for this deployment, not a bad request.
      if (error.reason === 'encryption_unavailable')
        return reply.code(503).send({ error: 'encryption_unavailable' });
      // The target exists but cannot be sent from its current state.
      if (
        [
          'not_sendable',
          'not_retryable',
          'not_final',
          'attachment_unavailable',
          'forward_unavailable',
          'idempotency_conflict',
          'already_exists',
        ].includes(error.reason)
      )
        return reply.code(409).send({ error: error.reason });
      return reply.code(400).send({ error: error.reason });
    }
    // MAIL-UX-02: an unexpected failure is neither a bad request nor a
    // foreign Fastify body. The client names every code it knows, so this
    // answer carries a stable `internal` and the full error stays in the
    // server log where it belongs - never in the reply.
    reply.log.error({ err: error }, 'mail route failed unexpectedly');
    return reply.code(500).send({ error: 'internal' });
  }
  // MAIL-ACCOUNT-01: the operator's sending accounts. Every answer is the
  // account whitelist above - the sealed secret never leaves the database, and
  // a missing or empty secret in a change keeps the stored one untouched.
  app.get(
    '/api/v1/mail/accounts',
    {
      schema: {
        response: { 200: { type: 'array', items: accountSchema } },
      },
    },
    async (request, reply) => {
      try {
        await repo.requireMember(request.authSession!.userId);
        return await repo.listAccounts();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Body: MailAccountInput }>(
    '/api/v1/mail/accounts',
    {
      schema: {
        body: accountBodySchema,
        response: { 201: accountSchema },
      },
    },
    async (request, reply) => {
      try {
        const account = await repo.saveAccount(
          request.authSession!.userId,
          request.body,
        );
        return reply.code(201).send(account);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { id: string }; Body: MailAccountInput }>(
    '/api/v1/mail/accounts/:id',
    {
      schema: {
        params,
        body: accountBodySchema,
        response: { 200: accountSchema },
      },
    },
    async (request, reply) => {
      try {
        return await repo.updateAccount(
          request.authSession!.userId,
          request.params.id,
          request.body,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
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
  // MAIL-021-B: the deliberate way out of `uncertain`. No provider is contacted
  // here - the job simply becomes claimable again as the very same job.
  app.post<{ Params: { id: string } }>(
    '/api/v1/mail/outbox/:id/retry',
    { schema: { params, response: { 200: outboxSchema } } },
    async (request, reply) => {
      try {
        return await repo.retryUncertainSend(
          request.authSession!.userId,
          request.params.id,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // MAIL-EVENT-01: a free mail composed at the event - one gesture, one
  // durable order, the same refusal codes as the document send. The reply
  // is the outbox job; a repeat with the same request id answers the very
  // same job.
  app.post<{ Body: MailComposeInput }>(
    '/api/v1/mail/compose',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['requestId', 'to'],
          properties: {
            requestId: { type: 'string', minLength: 1, maxLength: 200 },
            to: { type: 'string', minLength: 3, maxLength: 4000 },
            subject: { type: 'string', maxLength: 998 },
            bodyHtml: { type: 'string', maxLength: 200000 },
            contactId: nullableUuidParam,
            eventId: nullableUuidParam,
            accountId: nullableUuidParam,
            forwardAccounting: { type: 'boolean' },
            forwardUserIds: {
              type: 'array',
              maxItems: 5,
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        response: { 200: outboxSchema, 201: outboxSchema },
      },
    },
    async (request, reply) => {
      try {
        const { job, created } = await repo.scheduleCompose(
          request.authSession!.userId,
          request.body,
        );
        return reply.code(created ? 201 : 200).send(job);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // MAIL-DOC-01: the only route that carries a document. It schedules the same
  // durable order as every other send and answers the same job for the same
  // request id, so an unclear answer can be repeated without a second mail.
  app.post<{ Body: MailDocumentSendInput }>(
    '/api/v1/mail/document-send',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['documentId', 'requestId', 'to'],
          properties: {
            documentId: { type: 'string', format: 'uuid' },
            requestId: { type: 'string', minLength: 1, maxLength: 200 },
            to: { type: 'string', minLength: 3, maxLength: 4000 },
            subject: { type: 'string', maxLength: 998 },
            bodyText: { type: 'string', maxLength: 20000 },
            bodyHtml: { type: 'string', maxLength: 200000 },
            fileIds: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string', format: 'uuid' },
            },
            accountId: { type: 'string', format: 'uuid' },
            forwardAccounting: { type: 'boolean' },
            forwardUserIds: {
              type: 'array',
              maxItems: 5,
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
        response: { 200: documentSendSchema, 201: documentSendSchema },
      },
    },
    async (request, reply) => {
      try {
        const result = await repo.scheduleDocumentSend(
          request.authSession!.userId,
          request.body,
        );
        return reply.code(result.created ? 201 : 200).send({
          messageId: result.messageId,
          job: result.job,
          attachment: result.attachment,
          files: result.files,
        });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // MAIL-EDITOR-01: the read-only twin of the order above. It runs the same
  // checks and content assembly so the preview is the actual result, and it
  // writes nothing - no message, no order, no audit.
  app.post<{ Body: MailDocumentPreviewInput }>(
    '/api/v1/mail/document-send/preview',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['documentId'],
          properties: {
            documentId: { type: 'string', format: 'uuid' },
            subject: { type: 'string', maxLength: 998 },
            bodyText: { type: 'string', maxLength: 20000 },
            bodyHtml: { type: 'string', maxLength: 200000 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['subject', 'bodyHtml', 'bodyText', 'missing'],
            properties: {
              subject: { type: 'string' },
              bodyHtml: nullableText,
              bodyText: { type: 'string' },
              missing: {
                type: 'array',
                maxItems: 9,
                items: { type: 'string', maxLength: 40 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        // Reading the resolved content requires an active membership.
        await repo.requireMember(request.authSession!.userId);
        return await repo.previewDocumentSend(request.body);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
