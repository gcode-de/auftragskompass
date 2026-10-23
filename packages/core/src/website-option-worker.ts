import { Pool } from 'pg';
import { and, asc, eq, gt, notExists, or } from 'drizzle-orm';
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

// One bounded page of the pending backlog in (staged_at, id) order; the cursor
// continues that order so a tick can reach entries behind a full page.
export type WebsiteOptionPendingEntry = { id: string; stagedAt: Date };
export type WebsiteOptionCursor = { stagedAt: Date; id: string };

// Both calls receive the worker's transaction-capable connection so that a
// single entry still commits or rolls back atomically.
export type WebsiteOptionDrainDependencies = {
  listPending(
    connection: Connection,
    tenantId: string,
    after?: WebsiteOptionCursor,
  ): Promise<WebsiteOptionPendingEntry[]>;
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

// The identities above only say where the drain writes. Because an automatic
// image update can replace the binary, the automatic timer needs its own
// operator decision as well: absent or `off` pauses only the timer, while
// staging, acknowledgement, sync and manual takeover keep working.
export function loadWebsiteOptionDrainActivation(
  env: NodeJS.ProcessEnv,
): boolean {
  const value = env.AK_INQUIRY_OPTION_DRAIN;
  // No trimming on purpose: `on ` is a typo the operator has to see, not a
  // value to interpret generously.
  if (value === undefined || value === 'off') return false;
  if (value === 'on') return true;
  throw new Error('Invalid AK_INQUIRY_OPTION_DRAIN');
}

export const websiteOptionDependencies: WebsiteOptionDrainDependencies = {
  async listPending(connection, tenantId, after) {
    const db = database(connection);
    return db
      .select({
        id: websiteInquiryDeliveries.id,
        stagedAt: websiteInquiryDeliveries.stagedAt,
      })
      .from(websiteInquiryDeliveries)
      .where(
        and(
          eq(websiteInquiryDeliveries.tenantId, tenantId),
          notExists(
            db
              .select({ id: websiteInquiries.id })
              .from(websiteInquiries)
              .where(
                and(
                  eq(websiteInquiries.tenantId, tenantId),
                  eq(websiteInquiries.id, websiteInquiryDeliveries.id),
                ),
              ),
          ),
          after
            ? or(
                gt(websiteInquiryDeliveries.stagedAt, after.stagedAt),
                and(
                  eq(websiteInquiryDeliveries.stagedAt, after.stagedAt),
                  gt(websiteInquiryDeliveries.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        asc(websiteInquiryDeliveries.stagedAt),
        asc(websiteInquiryDeliveries.id),
      )
      .limit(batchSize);
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

// Each tick works through the whole pending backlog page by page; every entry is
// its own transaction, so a broken entry cannot roll back its neighbours and
// stays pending for a later attempt.
export function startWebsiteOptionDrain(
  // Only the real dependencies use this pool; tests may pass a stub.
  connection: Pool,
  dependencies: WebsiteOptionDrainDependencies,
  config: WebsiteOptionConfig,
  reportEntryFailure: (code: string) => void,
  reportError: () => void,
) {
  // Entries whose own data is wrong are reported once and then held back for
  // this process instead of being retried on every tick. Everything else is
  // retried by the next tick without a restart.
  const held = new Set<string>();
  let stopping = false,
    healthy = false,
    pending: Promise<void> | null = null;
  const drain = async () => {
    let after: WebsiteOptionCursor | undefined,
      infrastructureFailure = false;
    for (;;) {
      let page: WebsiteOptionPendingEntry[];
      try {
        page = await dependencies.listPending(
          connection,
          config.tenantId,
          after,
        );
      } catch {
        // Infrastructure failures leave readiness false; they are retried next tick.
        healthy = false;
        reportError();
        return;
      }
      if (page.length === 0) break;
      for (const { id } of page) {
        if (held.has(id)) continue;
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
          if (reason && entryReasons.has(reason)) {
            held.add(id);
            reportEntryFailure('website_option_' + reason);
          } else if (!infrastructureFailure) {
            infrastructureFailure = true;
            reportError();
          }
        }
      }
      const last = page[page.length - 1]!;
      after = { stagedAt: last.stagedAt, id: last.id };
    }
    if (!infrastructureFailure) healthy = true;
  };
  const run = () => {
    // After stop() no new listing or page may begin.
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
