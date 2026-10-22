import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { loadRuntimeConfig, migrate } from '@auftragskompass/core';
import { startWorkerRuntime } from './worker-start.js';
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
  const runtime = await startWorkerRuntime(
    config,
    pool,
    undefined,
    process.env,
    readSecret,
    () => pool.end(),
  );
  await runtime.refreshSync();
  const { app } = runtime;
  app.addHook('onClose', () => runtime.close());
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
