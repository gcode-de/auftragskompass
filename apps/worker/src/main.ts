import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  createHealthServer,
  loadInquirySyncConfig,
  loadRuntimeConfig,
  migrate,
  startReservationExpiry,
  startWebsiteInquirySync,
} from '@auftragskompass/core';
const readSecret = (path: string): string => readFileSync(path, 'utf8');
try {
  const config = loadRuntimeConfig(process.env, readSecret);
  const pool = new Pool({
    host: config.host,
    port: config.dbPort,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionTimeoutMillis: 800,
    statement_timeout: 800,
    max: 5,
  });
  pool.on('error', () => {});
  await migrate(pool).catch(async (error: unknown) => {
    await pool.end();
    throw error;
  });
  let sync: ReturnType<typeof startWebsiteInquirySync> | null = null;
  const app = createHealthServer(config, {
    database: async () => {
      await pool.query('SELECT 1');
      return true;
    },
    worker: async () => expiry.ready() && (!sync || sync.ready()),
  });
  const expiry = startReservationExpiry(pool, () =>
    app.log.error('reservation_expiry_failed'),
  );
  // Website inquiries stay inert until a gateway origin is configured (M2).
  if (process.env.AK_GATEWAY_ORIGIN)
    sync = startWebsiteInquirySync(
      pool,
      loadInquirySyncConfig(process.env, readSecret),
      () => app.log.error('inquiry_sync_failed'),
    );
  app.addHook('onClose', async () => {
    if (sync) await sync.stop();
    await expiry.stop();
    await pool.end();
  });
  await app
    .listen({ host: config.listenHost, port: config.port })
    .catch(async (error: unknown) => {
      await app.close();
      throw error;
    });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => void app.close());
} catch {
  console.error(JSON.stringify({ level: 'error', event: 'startup_failed' }));
  process.exitCode = 1;
}
