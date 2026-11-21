import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { websiteInquiryDeliveries } from './schema.js';
import { inquiryEmailKey, renderWebsiteInquiryEmail } from './inquiry-email.js';
import {
  isWebsiteInquiry,
  receiveWebsiteInquiry,
  WebsiteInquiryError,
  type WebsiteInquiry,
} from './website-inquiries.js';

// This private service accepts only entries authenticated by the outgoing sync caller.
export async function stageWebsiteInquiry(
  connection: Connection,
  tenantId: string,
  actorId: string,
  input: unknown,
  at: Date,
): Promise<{ status: 'stored' | 'duplicate' }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !uuid.test(tenantId) ||
    !uuid.test(actorId) ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime()) ||
    !isWebsiteInquiry(input)
  )
    throw new WebsiteInquiryError('invalid');
  const value = JSON.parse(JSON.stringify(input)) as WebsiteInquiry,
    clock = at.getTime();
  if (Date.parse(value.receivedAt) > clock + 30000)
    throw new WebsiteInquiryError('invalid');
  try {
    return await database(connection).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      const hash = (
        await tx.execute<{ hash: string }>(
          sql`SELECT encode(sha256(convert_to(${JSON.stringify(value)}::jsonb::text,'UTF8')),'hex') AS hash`,
        )
      ).rows[0]!.hash;
      const [previous] = await tx
        .select()
        .from(websiteInquiryDeliveries)
        .where(
          and(
            eq(websiteInquiryDeliveries.tenantId, tenantId),
            eq(websiteInquiryDeliveries.id, value.id),
          ),
        );
      if (previous) {
        if (previous.payloadHash !== hash)
          throw new WebsiteInquiryError('conflict');
        return { status: 'duplicate' as const };
      }
      if (Date.parse(value.expiresAt) <= clock)
        throw new WebsiteInquiryError('expired');
      await tx.insert(websiteInquiryDeliveries).values({
        tenantId,
        id: value.id,
        payload: value,
        payloadHash: hash,
        receivedAt: new Date(value.receivedAt),
        expiresAt: new Date(value.expiresAt),
        stagedAt: new Date(clock),
        stagedBy: actorId,
      });
      // Snapshot opt-in at first local receipt; later activation never backfills old inquiries.
      await tx.execute(sql`INSERT INTO telegram_notification_jobs (tenant_id, inquiry_id)
        SELECT ${tenantId}, ${value.id} WHERE EXISTS (
          SELECT 1 FROM telegram_settings WHERE tenant_id=${tenantId} AND enabled=true
        ) ON CONFLICT (tenant_id, inquiry_id) DO NOTHING`);
      // MAIL-NOTIFY-01: the same receipt also orders the e-mail notification -
      // a second, independent order with its own idempotency key. The savepoint
      // keeps a mail problem out of the intake path; the mail core alone owns
      // retries and honest failure states. No enabled mail account means no
      // honest sender, so nothing is ordered then.
      const mail = renderWebsiteInquiryEmail(value),
        key = inquiryEmailKey(value.id);
      try {
        await tx.transaction(async (mailTx) => {
          await mailTx.execute(sql`WITH chosen AS (
              SELECT a.id AS account_id, a.username, s.recipients
                FROM inquiry_email_settings s
                JOIN mail_accounts a
                  ON a.tenant_id=s.tenant_id AND a.enabled=true
               WHERE s.tenant_id=${tenantId} AND s.enabled=true
               ORDER BY a.name, a.id
               LIMIT 1
            ), created AS (
              INSERT INTO mail_messages
                (tenant_id,id,account_id,direction,folder,send_state,subject,
                 body_text,from_address,to_addresses)
              SELECT ${tenantId},${randomUUID()}::uuid,c.account_id,'out','drafts',
                     'scheduled',${mail.subject},${mail.text},c.username,c.recipients
                FROM chosen c
               WHERE NOT EXISTS (SELECT 1 FROM mail_outbox o
                                  WHERE o.tenant_id=${tenantId}
                                    AND o.idempotency_key=${key})
              RETURNING id
            )
            INSERT INTO mail_outbox(tenant_id,id,message_id,idempotency_key)
            SELECT ${tenantId},${randomUUID()}::uuid,id,${key} FROM created
            ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`);
        });
      } catch {
        // The inquiry stays received; only its optional mail order is missing.
      }
      return { status: 'stored' as const };
    });
  } catch (error) {
    if (error instanceof WebsiteInquiryError) throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}

export async function importStagedWebsiteInquiry(
  connection: Connection,
  tenantId: string,
  actorId: string,
  inquiryId: string,
  options: { newContactCountry?: string },
): Promise<{
  status: 'created' | 'duplicate';
  eventId: string;
  contactId: string | null;
}> {
  // H032: the same auto semantics as the drain, so recovery also yields an Option.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (![tenantId, actorId, inquiryId].every((value) => uuid.test(value)))
    throw new WebsiteInquiryError('invalid');
  const country = options.newContactCountry;
  try {
    return await database(connection).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      const [row] = await tx
        .select()
        .from(websiteInquiryDeliveries)
        .where(
          and(
            eq(websiteInquiryDeliveries.tenantId, tenantId),
            eq(websiteInquiryDeliveries.id, inquiryId),
          ),
        );
      if (!row) throw new WebsiteInquiryError('not_found');
      if (
        !isWebsiteInquiry(row.payload) ||
        row.payload.id !== row.id ||
        row.payload.receivedAt !== row.receivedAt.toISOString() ||
        row.payload.expiresAt !== row.expiresAt.toISOString()
      )
        throw new WebsiteInquiryError('invalid');
      // The durable receipt proves timely arrival; gateway expiry must not discard a review backlog.
      return receiveWebsiteInquiry(
        tx,
        tenantId,
        actorId,
        row.payload,
        row.stagedAt,
        {
          status: 'option',
          ...(country === undefined ? {} : { newContactCountry: country }),
        },
      );
    });
  } catch (error) {
    if (error instanceof WebsiteInquiryError) throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}
