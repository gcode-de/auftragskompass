import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  createHealthServer,
  loadRuntimeConfig,
  migrate,
  loadAuthConfig,
  googleProvider,
  registerAuth,
} from '@auftragskompass/core';
try {
  const config = loadRuntimeConfig(process.env, (path) =>
    readFileSync(path, 'utf8'),
  );
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
  const app = createHealthServer(config, {
    database: async () => {
      await pool.query('SELECT 1');
      return true;
    },
    worker: async () =>
      (
        await fetch('http://worker:3001/health/ready', {
          signal: AbortSignal.timeout(800),
        })
      ).ok,
  });
  const auth = loadAuthConfig(process.env, (path) =>
    readFileSync(path, 'utf8'),
  );
  await registerAuth(
    app,
    pool,
    auth,
    auth ? await googleProvider(auth) : undefined,
  );
  app.addHook('onClose', async () => {
    await pool.end();
  });
  await app.listen({ host: config.listenHost, port: config.port });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => void app.close());
} catch {
  console.error(JSON.stringify({ level: 'error', event: 'startup_failed' }));
  process.exit(1);
}
