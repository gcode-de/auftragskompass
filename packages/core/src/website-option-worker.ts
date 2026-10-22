import { Pool } from 'pg';
import { asc, notExists, eq, and } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { websiteInquiryDeliveries, websiteInquiries } from './schema.js';
import { importStagedWebsiteInquiry } from './website-inquiry-deliveries.js';
import type { WebsiteInquiryError } from './website-inquiries.js';

export type WebsiteOptionConfig = {
  tenantId: string;
  actorId: string;
  // Absent means no operator decision: new contacts stay in human review.
  newContactCountry?: string;
  intervalMs: number;
};

// Both calls receive the worker's transaction-capable connection so that a
// single entry still commits or rolls back atomically.
export type WebsiteOptionDrainDependencies = {
  listPending(connection: Connection, tenantId: string): Promise<string[]>;
  processPending(
    connection: Connection,
    tenantId: string,
    actorId: string,
    inquiryId: string,
    options: { newContactCountry?: string },
  ): Promise<unknown>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const batchSize = 10;
// Per-entry reasons that describe the entry, not the infrastructure. Everything
// else stays retryable through the next tick.
const entryReasons = new Set([
  'contact_review',
  'expired',
  'conflict',
  'invalid',
]);

// Null means "not configured": the drain is optional, so a deployment without
// the inquiry identities keeps running and leaves every entry in the inbox.
// Both identities absent is a deliberate opt-out; half or malformed is a bug.
export function loadWebsiteOptionConfig(
  env: NodeJS.ProcessEnv,
): WebsiteOptionConfig | null {
  const rawTenant = env.AK_INQUIRY_TENANT_ID?.trim() ?? '',
    rawOperator = env.AK_INQUIRY_OPERATOR_ID?.trim() ?? '';
  if (!rawTenant && !rawOperator) return null;
  const required = (key: string, value: string) => {
    if (!value) throw new Error(`Missing configuration: ${key}`);
    if (!uuid.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const tenantId = required('AK_INQUIRY_TENANT_ID', rawTenant),
    actorId = required('AK_INQUIRY_OPERATOR_ID', rawOperator);
  const country = env.AK_INQUIRY_DEFAULT_CONTACT_COUNTRY?.trim() ?? '';
  if (country && !/^[A-Z]{2}$/.test(country))
    throw new Error('Invalid AK_INQUIRY_DEFAULT_CONTACT_COUNTRY');
  const intervalMs = Number(env.AK_INQUIRY_OPTION_INTERVAL_MS ?? '30000');
  if (!Number.isInteger(intervalMs) || intervalMs < 5000 || intervalMs > 600000)
    throw new Error('Invalid AK_INQUIRY_OPTION_INTERVAL_MS');
  return {
    tenantId,
    actorId,
    ...(country ? { newContactCountry: country } : {}),
    intervalMs,
  };
}

export const websiteOptionDependencies: WebsiteOptionDrainDependencies = {
  async listPending(connection, tenantId) {
    return (
      await database(connection)
        .select({ id: websiteInquiryDeliveries.id })
        .from(websiteInquiryDeliveries)
        .where(
          and(
            eq(websiteInquiryDeliveries.tenantId, tenantId),
            notExists(
              database(connection)
                .select({ id: websiteInquiries.id })
                .from(websiteInquiries)
                .where(
                  and(
                    eq(websiteInquiries.tenantId, tenantId),
                    eq(websiteInquiries.id, websiteInquiryDeliveries.id),
                  ),
                ),
            ),
          ),
        )
        .orderBy(
          asc(websiteInquiryDeliveries.stagedAt),
          asc(websiteInquiryDeliveries.id),
        )
        .limit(batchSize)
    ).map((row) => row.id);
  },
  processPending(connection, tenantId, actorId, inquiryId, options) {
    return importStagedWebsiteInquiry(
      connection,
      tenantId,
      actorId,
      inquiryId,
      options,
    );
  },
};

// One bounded batch per tick; each entry is its own transaction, so a broken
// entry cannot roll back its neighbours and simply stays pending.
export function startWebsiteOptionDrain(
  // Only the real dependencies use this pool; tests may pass a stub.
  connection: Pool,
  dependencies: WebsiteOptionDrainDependencies,
  config: WebsiteOptionConfig,
  reportEntryFailure: (code: string) => void,
  reportError: () => void,
) {
  const attempted = new Set<string>();
  let stopping = false,
    healthy = false,
    pending: Promise<void> | null = null;
  const drain = async () => {
    // Infrastructure failures leave readiness false; they are retried next tick.
    const ids = await dependencies
      .listPending(connection, config.tenantId)
      .catch((error: unknown) => {
        healthy = false;
        reportError();
        throw error;
      });
    let infrastructureFailure = false;
    for (const id of ids) {
      if (attempted.has(id)) continue;
      attempted.add(id);
      try {
        await dependencies.processPending(
          connection,
          config.tenantId,
          config.actorId,
          id,
          {
            ...(config.newContactCountry === undefined
              ? {}
              : { newContactCountry: config.newContactCountry }),
          },
        );
      } catch (error) {
        const reason = (error as Partial<WebsiteInquiryError> | null)?.reason;
        if (reason && entryReasons.has(reason))
          reportEntryFailure('website_option_' + reason);
        else {
          infrastructureFailure = true;
          reportError();
        }
      }
    }
    if (!infrastructureFailure) healthy = true;
  };
  const run = () => {
    // After stop() no new listing or batch may begin.
    if (stopping || pending) return;
    const work = Promise.resolve()
      .then(drain)
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
    pending = work;
  };
  run();
  const timer = setInterval(run, config.intervalMs);
  timer.unref();
  return {
    ready: () => healthy,
    stop: async () => {
      stopping = true;
      clearInterval(timer);
      await pending;
    },
  };
}
