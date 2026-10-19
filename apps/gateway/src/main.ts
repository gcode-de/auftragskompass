import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  createInquiryGateway,
  loadRuntimeConfig,
  migrate,
  migrateGateway,
  loadInquiryConfig,
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
  await migrateGateway(pool).catch(async (error: unknown) => {
    await pool.end();
    throw error;
  });
  const inquiry = loadInquiryConfig(process.env, readSecret);
  const app = await createInquiryGateway({
    pool,
    storage: inquiry.storage,
    syncKeys: inquiry.syncKeys,
    responseKeyId: inquiry.responseKeyId,
    allowedOrigins: inquiry.allowedOrigins,
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  await app.listen({ host: config.listenHost, port: config.port });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => void app.close());
} catch {
  console.error(JSON.stringify({ level: 'error', event: 'startup_failed' }));
  process.exitCode = 1;
}
