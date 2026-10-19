import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  createHealthServer,
  loadRuntimeConfig,
  migrate,
  loadAuthConfig,
  googleProvider,
  registerAuth,
  bootstrapAccess,
  bootstrapPassword,
  registerAccessRoutes,
  registerAuditRoutes,
  registerMasterDataRoutes,
  registerResourceRoutes,
  registerProductRoutes,
  registerContactRoutes,
  registerLocationRoutes,
  registerEventRoutes,
  registerImportRoutes,
  registerCalendarFeedRoutes,
  registerInquiryPreviewRoute,
  registerWebsiteInquiryRoutes,
  registerWebsiteInboxRoutes,
  registerDocumentTemplateRoutes,
  registerDocumentNumberRoutes,
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
  if (auth)
    await bootstrapAccess(
      pool,
      auth.tenantId,
      process.env.AK_BOOTSTRAP_EMAIL,
      process.env.AK_TENANT_NAME ?? 'AuftragsKompass',
      config.timezone,
    );
  if (auth?.mode === 'password')
    await bootstrapPassword(
      pool,
      auth.tenantId,
      process.env.AK_BOOTSTRAP_EMAIL,
      process.env.AK_BOOTSTRAP_USERNAME,
      () => {
        if (!process.env.AK_BOOTSTRAP_PASSWORD_FILE)
          throw new Error('Missing password file');
        return readFileSync(
          process.env.AK_BOOTSTRAP_PASSWORD_FILE,
          'utf8',
        ).replace(/\r?\n$/, '');
      },
    );
  await registerAuth(
    app,
    pool,
    auth,
    auth && auth.mode !== 'password' ? await googleProvider(auth) : undefined,
  );
  if (auth) {
    registerInquiryPreviewRoute(app);
    registerWebsiteInquiryRoutes(app, pool, auth.tenantId);
    registerWebsiteInboxRoutes(app, pool, auth.tenantId);
    registerAccessRoutes(app, pool, auth.tenantId, auth.mode ?? 'google');
    registerAuditRoutes(app, pool, auth.tenantId);
    registerMasterDataRoutes(app, pool, auth.tenantId);
    registerResourceRoutes(app, pool, auth.tenantId);
    registerProductRoutes(app, pool, auth.tenantId);
    registerDocumentTemplateRoutes(app, pool, auth.tenantId);
    registerDocumentNumberRoutes(app, pool, auth.tenantId);
    registerContactRoutes(app, pool, auth.tenantId);
    registerLocationRoutes(app, pool, auth.tenantId);
    registerEventRoutes(app, pool, auth.tenantId);
    registerImportRoutes(app, pool, auth.tenantId);
    registerCalendarFeedRoutes(app, pool, auth.tenantId, auth.origin);
  }
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
