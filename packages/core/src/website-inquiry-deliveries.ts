import { and, eq, sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { websiteInquiryDeliveries } from './schema.js';
import {
  isWebsiteInquiry,
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
      return { status: 'stored' as const };
    });
  } catch (error) {
    if (error instanceof WebsiteInquiryError) throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}
