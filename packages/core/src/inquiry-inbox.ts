import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { gatewayInquiries } from './gateway-schema.js';
import {
  inquiryFormV1,
  isInquirySubmission,
  type InquirySubmission,
} from './inquiry-form.js';

type StorageKey = { id: string; secret: Uint8Array };
export type InquiryInboxConfig = {
  tenantId: string;
  keys: readonly StorageKey[];
  activeKeyId: string;
  retentionHours: number;
  maxStored: number;
};
export class InquiryInboxError extends Error {
  constructor(
    readonly reason:
      'invalid' | 'conflict' | 'capacity' | 'expired' | 'unavailable',
  ) {
    super('Inquiry unavailable');
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
type Row = typeof gatewayInquiries.$inferSelect;

function canonical(input: InquirySubmission) {
  return JSON.stringify({
    formId: input.formId,
    formVersion: input.formVersion,
    fields: Object.fromEntries(
      inquiryFormV1.fields
        .filter((f) => Object.hasOwn(input.fields, f.name))
        .map((f) => [f.name, input.fields[f.name]]),
    ),
  });
}
function requireTime(at: Date) {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    throw new InquiryInboxError('invalid');
}
async function guarded<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InquiryInboxError) throw error;
    throw new InquiryInboxError('unavailable');
  }
}

export function inquiryInbox(
  connection: Connection,
  config: InquiryInboxConfig,
) {
  if (
    typeof config.tenantId !== 'string' ||
    !uuid.test(config.tenantId) ||
    !Number.isInteger(config.retentionHours) ||
    config.retentionHours < 1 ||
    config.retentionHours > 168 ||
    !Number.isInteger(config.maxStored) ||
    config.maxStored < 1 ||
    config.maxStored > 10_000 ||
    !Array.isArray(config.keys) ||
    config.keys.length < 1 ||
    config.keys.length > 16 ||
    config.keys.some(
      (k) =>
        !k ||
        typeof k.id !== 'string' ||
        !keyId.test(k.id) ||
        !(k.secret instanceof Uint8Array) ||
        k.secret.byteLength !== 32,
    ) ||
    new Set(config.keys.map((k) => k.id)).size !== config.keys.length ||
    !config.keys.some((k) => k.id === config.activeKeyId)
  )
    throw new Error('Invalid inquiry inbox configuration');
  const { tenantId, retentionHours, maxStored, activeKeyId } = config;
  const keys = config.keys.map((k) => ({
    id: k.id,
    secret: Buffer.from(k.secret),
  }));
  const db = database(connection),
    table = gatewayInquiries;
  function findKey(id: string) {
    const key = keys.find((k) => k.id === id);
    if (!key) throw new InquiryInboxError('unavailable');
    return key;
  }
  function derived(key: StorageKey, purpose: 'encryption' | 'fingerprint') {
    return Buffer.from(
      hkdfSync('sha256', key.secret, tenantId, 'AK-INQUIRY-V1-' + purpose, 32),
    );
  }
  function fingerprint(source: string, key: StorageKey) {
    return createHmac('sha256', derived(key, 'fingerprint'))
      .update(source)
      .digest('hex');
  }
  function aad(
    row: Pick<
      Row,
      | 'id'
      | 'tenantId'
      | 'formId'
      | 'formVersion'
      | 'keyId'
      | 'payloadHash'
      | 'receivedAt'
      | 'expiresAt'
    >,
  ) {
    return Buffer.from(
      JSON.stringify([
        'AK-INQUIRY-V1',
        row.tenantId,
        row.id,
        row.formId,
        row.formVersion,
        row.keyId,
        row.payloadHash,
        row.receivedAt.toISOString(),
        row.expiresAt.toISOString(),
      ]),
    );
  }
  function open(row: Row) {
    const key = findKey(row.keyId);
    if (!row.ciphertext || !row.iv || !row.tag)
      throw new InquiryInboxError('unavailable');
    const [ciphertext, iv, tag] = [row.ciphertext, row.iv, row.tag].map((s) =>
      Buffer.from(s, 'base64url'),
    );
    if (
      ciphertext!.toString('base64url') !== row.ciphertext ||
      iv!.toString('base64url') !== row.iv ||
      tag!.toString('base64url') !== row.tag
    )
      throw new InquiryInboxError('unavailable');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      derived(key, 'encryption'),
      iv!,
    );
    decipher.setAAD(aad(row));
    decipher.setAuthTag(tag!);
    const parsed = JSON.parse(
      Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString(
        'utf8',
      ),
    ) as { submission: unknown; privacyNotice: unknown; privacyUrl: unknown };
    if (
      !parsed ||
      !isInquirySubmission(parsed.submission) ||
      parsed.submission.formId !== row.formId ||
      parsed.submission.formVersion !== row.formVersion ||
      typeof parsed.privacyNotice !== 'string' ||
      typeof parsed.privacyUrl !== 'string'
    )
      throw new InquiryInboxError('unavailable');
    return {
      id: row.id,
      receivedAt: row.receivedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      submission: parsed.submission,
      privacyNotice: parsed.privacyNotice,
      privacyUrl: parsed.privacyUrl,
    };
  }
  return {
    async receive(id: string, input: unknown, at: Date) {
      requireTime(at);
      if (
        typeof id !== 'string' ||
        !uuid.test(id) ||
        !isInquirySubmission(input) ||
        Buffer.byteLength(JSON.stringify(input), 'utf8') > 32_768
      )
        throw new InquiryInboxError('invalid');
      const source = canonical(input),
        submission = JSON.parse(source) as InquirySubmission;
      const receivedAt = new Date(at.getTime()),
        expiresAt = new Date(at.getTime() + retentionHours * 3_600_000);
      requireTime(expiresAt);
      return guarded(() =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${'AK-INQUIRY-V1:' + tenantId}, 0))`,
          );
          const [previous] = await tx
            .select()
            .from(table)
            .where(and(eq(table.tenantId, tenantId), eq(table.id, id)));
          if (previous) {
            if (previous.expiresAt.getTime() <= receivedAt.getTime())
              throw new InquiryInboxError('expired');
            if (previous.acknowledgedAt === null) open(previous);
            const expected = fingerprint(source, findKey(previous.keyId));
            if (
              !timingSafeEqual(
                Buffer.from(previous.payloadHash, 'hex'),
                Buffer.from(expected, 'hex'),
              )
            )
              throw new InquiryInboxError('conflict');
            return { status: 'received' as const };
          }
          const [stored] = await tx
            .select({ n: count() })
            .from(table)
            .where(eq(table.tenantId, tenantId));
          if (stored!.n >= maxStored) throw new InquiryInboxError('capacity');
          const key = findKey(activeKeyId);
          const row = {
            tenantId,
            id,
            formId: submission.formId,
            formVersion: submission.formVersion,
            keyId: key.id,
            payloadHash: fingerprint(source, key),
            receivedAt,
            expiresAt,
          };
          const iv = randomBytes(12),
            cipher = createCipheriv(
              'aes-256-gcm',
              derived(key, 'encryption'),
              iv,
            );
          cipher.setAAD(aad(row));
          const plaintext = JSON.stringify({
            submission,
            privacyNotice: inquiryFormV1.privacyNotice,
            privacyUrl: inquiryFormV1.privacyUrl,
          });
          const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
          ]);
          await tx.insert(table).values({
            ...row,
            ciphertext: ciphertext.toString('base64url'),
            iv: iv.toString('base64url'),
            tag: cipher.getAuthTag().toString('base64url'),
          });
          return { status: 'received' as const };
        }),
      );
    },
    async pending(limit: number, at: Date) {
      requireTime(at);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new InquiryInboxError('invalid');
      return guarded(async () => {
        const rows = await db
          .select()
          .from(table)
          .where(
            and(
              eq(table.tenantId, tenantId),
              isNull(table.acknowledgedAt),
              gt(table.expiresAt, at),
            ),
          )
          .orderBy(asc(table.receivedAt), asc(table.id))
          .limit(limit);
        return rows.map(open);
      });
    },
    async acknowledge(ids: readonly string[], at: Date) {
      requireTime(at);
      if (
        !Array.isArray(ids) ||
        ids.length > 100 ||
        ids.some((id) => typeof id !== 'string' || !uuid.test(id))
      )
        throw new InquiryInboxError('invalid');
      if (!ids.length) return 0;
      return guarded(
        async () =>
          (
            await db
              .update(table)
              .set({
                ciphertext: null,
                iv: null,
                tag: null,
                acknowledgedAt: at,
              })
              .where(
                and(
                  eq(table.tenantId, tenantId),
                  inArray(table.id, [...new Set(ids)]),
                  isNull(table.acknowledgedAt),
                ),
              )
              .returning({ id: table.id })
          ).length,
      );
    },
    async prune(at: Date) {
      requireTime(at);
      return guarded(async () => {
        const rows = await db
          .delete(table)
          .where(and(eq(table.tenantId, tenantId), lte(table.expiresAt, at)))
          .returning({ acknowledgedAt: table.acknowledgedAt });
        return {
          removed: rows.length,
          unacknowledged: rows.filter((row) => row.acknowledgedAt === null)
            .length,
        };
      });
    },
  };
}
