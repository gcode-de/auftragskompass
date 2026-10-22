import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  createHealthServer,
  loadInquirySyncConfig,
  startReservationExpiry,
  startWebsiteInquirySync,
  startWebsiteOptionDrain,
  websiteOptionDependencies,
  loadWebsiteOptionConfig,
  type InquirySyncConfig,
  type RuntimeConfig,
  type WebsiteOptionConfig,
  type WebsiteOptionDrainDependencies,
} from '@auftragskompass/core';

type Loop = { ready(): boolean; stop(): Promise<void> };

export type WorkerRuntimeDependencies = {
  createServer(
    config: RuntimeConfig,
    checks: {
      database: () => Promise<boolean>;
      worker: () => Promise<boolean>;
    },
  ): FastifyInstance;
  probe(pool: Pool): Promise<boolean>;
  // Returned loops stop in reverse: the drain first, then sync, expiry, pool.
  startExpiry(pool: Pool, report: () => void): Loop & { stop(): Promise<void> };
  // Null means the drain is deliberately unconfigured, not broken.
  loadOptionConfig(env: NodeJS.ProcessEnv): WebsiteOptionConfig | null;
  startDrain(
    pool: Pool,
    dependencies: WebsiteOptionDrainDependencies,
    config: WebsiteOptionConfig,
    reportEntryFailure: (code: string) => void,
    reportError: () => void,
  ): Loop & { stop(): Promise<void> };
  loadSyncConfig(
    env: NodeJS.ProcessEnv,
    readSecret: (path: string) => string,
  ): InquirySyncConfig;
  startSync(
    pool: Pool,
    config: InquirySyncConfig,
    report: () => void,
  ): Loop & { stop(): Promise<void> };
};

export const workerRuntimeDependencies: WorkerRuntimeDependencies = {
  createServer: (config, checks) => createHealthServer(config, checks),
  async probe(pool) {
    await pool.query('SELECT 1');
    return true;
  },
  startExpiry: (pool, report) => startReservationExpiry(pool, report),
  loadOptionConfig: (env) => loadWebsiteOptionConfig(env),
  startDrain: (pool, dependencies, config, entry, error) =>
    startWebsiteOptionDrain(pool, dependencies, config, entry, error),
  loadSyncConfig: (env, readSecret) => loadInquirySyncConfig(env, readSecret),
  startSync: (pool, config, report) =>
    startWebsiteInquirySync(pool, config, report),
};

// Startup order is the shutdown order reversed: the option drain stops first so
// no inquiry transaction is still open when the pool closes.
export async function startWorkerRuntime(
  config: RuntimeConfig,
  pool: Pool,
  dependencies: WorkerRuntimeDependencies = workerRuntimeDependencies,
  env: NodeJS.ProcessEnv = process.env,
  readSecret: (path: string) => string = () => '',
  endPool: () => Promise<void> = async () => {},
) {
  let sync: Loop | null = null;
  const app = dependencies.createServer(config, {
    database: () => dependencies.probe(pool),
    // Probes resolve the loops at call time. The drain and the sync are
    // optional: when absent they must not pull readiness down, because expiry
    // and the local inbox still work without them.
    worker: async () =>
      expiry.ready() && (!drain || drain.ready()) && (!sync || sync.ready()),
  });
  const expiry = dependencies.startExpiry(pool, () =>
    app.log.error('reservation_expiry_failed'),
  );
  // Without the inquiry identities there is nothing to drain from: skip the
  // timer with one warning so entries stay visible in the inbox. A present but
  // malformed identity stays an error and keeps the drain unhealthy, because
  // that is a configuration bug nobody would notice otherwise.
  const drain = (() => {
    let optionConfig: WebsiteOptionConfig | null;
    try {
      optionConfig = dependencies.loadOptionConfig(env);
    } catch {
      app.log.error('website_option_config_invalid');
      return { ready: () => false, stop: async () => {} };
    }
    if (!optionConfig) {
      app.log.warn('website_option_drain_unconfigured');
      return null;
    }
    return dependencies.startDrain(
      pool,
      websiteOptionDependencies,
      optionConfig,
      (code) => app.log.error(code),
      () => app.log.error('website_option_drain_failed'),
    );
  })();
  const refreshSync = async () => {
    // Website transport stays inert until a gateway origin is configured (M2).
    if (sync || !env.AK_GATEWAY_ORIGIN) return false;
    // A broken sync configuration must not turn into startup_failed: the
    // worker keeps serving expiry and the inbox without transport.
    try {
      sync = dependencies.startSync(
        pool,
        dependencies.loadSyncConfig(env, readSecret),
        () => app.log.error('inquiry_sync_failed'),
      );
    } catch {
      app.log.error('inquiry_sync_config_invalid');
      return false;
    }
    return true;
  };
  return {
    app,
    drain,
    refreshSync,
    async close() {
      if (drain) await drain.stop();
      if (sync) await sync.stop();
      await expiry.stop();
      await endPool();
    },
  };
}
