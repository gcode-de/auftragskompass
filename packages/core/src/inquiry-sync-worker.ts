import type { Pool } from 'pg';
import type { InquirySyncConfig } from './inquiry-config.js';
import { pullWebsiteInquiries } from './website-inquiry-pull.js';
import { acknowledgeWebsiteInquiries } from './website-inquiry-ack-send.js';

// One durable cycle: fetch signed batches, then commit prepared receipts.
// Both steps are idempotent, so a restart resumes instead of duplicating.
export function startWebsiteInquirySync(
  pool: Pool,
  config: InquirySyncConfig,
  reportError: () => void,
) {
  const options = {
    origin: config.origin,
    requestKey: config.requestKey,
    responseKeys: config.responseKeys,
  };
  let healthy = false,
    pending: Promise<void> | null = null;
  const run = () => {
    if (pending) return;
    pending = pullWebsiteInquiries(
      pool,
      config.tenantId,
      config.actorId,
      options,
    )
      .then(() =>
        acknowledgeWebsiteInquiries(
          pool,
          config.tenantId,
          config.actorId,
          options,
        ),
      )
      .then(() => {
        healthy = true;
      })
      .catch(() => {
        healthy = false;
        reportError();
      })
      .finally(() => {
        pending = null;
      });
  };
  run();
  const timer = setInterval(run, config.intervalMs);
  timer.unref();
  return {
    ready: () => healthy,
    stop: async () => {
      clearInterval(timer);
      await pending;
    },
  };
}
