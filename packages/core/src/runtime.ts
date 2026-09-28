import Fastify, { type FastifyError } from 'fastify';
import type { Writable } from 'node:stream';

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv,
  readSecret: (path: string) => string,
) {
  const required = (key: string) => {
    const value = env[key];
    if (!value?.trim()) throw new Error(`Missing configuration: ${key}`);
    return value;
  };
  const host = required('AK_DB_HOST');
  const database = required('AK_DB_NAME');
  const user = required('AK_DB_USER');
  const passwordFile = required('AK_DB_PASSWORD_FILE');
  let password: string;
  try {
    password = readSecret(passwordFile).trim();
  } catch {
    throw new Error('Cannot read AK_DB_PASSWORD_FILE');
  }
  if (password.length < 16) throw new Error('Invalid AK_DB_PASSWORD_FILE');
  const port = Number(env.AK_PORT ?? '3000');
  const dbPort = Number(env.AK_DB_PORT ?? '5432');
  if (![port, dbPort].every((p) => Number.isInteger(p) && p > 0 && p <= 65535))
    throw new Error('Invalid port configuration');
  const logLevel = env.AK_LOG_LEVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel))
    throw new Error('Invalid AK_LOG_LEVEL');
  const timezone = env.AK_TIMEZONE ?? 'Europe/Berlin';
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: timezone });
  } catch {
    throw new Error('Invalid AK_TIMEZONE');
  }
  const revision = env.AK_BUILD_REVISION ?? 'development';
  if (!/^(development|[a-f0-9]{7,40})$/.test(revision))
    throw new Error('Invalid AK_BUILD_REVISION');
  const listenHost = env.AK_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0', '::1'].includes(listenHost))
    throw new Error('Invalid AK_HOST');
  return {
    host,
    database,
    user,
    password,
    dbPort,
    port,
    logLevel,
    timezone,
    revision,
    listenHost,
  };
}
export type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;
export type Probes = {
  database: () => Promise<boolean>;
  worker: () => Promise<boolean>;
};

async function probe(check: () => Promise<boolean>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(check),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
export function createHealthServer(
  config: RuntimeConfig,
  checks: Probes,
  stream?: Writable,
  timeoutMs = 1000,
) {
  const app = Fastify({
    disableRequestLogging: true,
    logger: {
      level: config.logLevel,
      ...(stream ? { stream } : {}),
      serializers: {
        req: () => ({}),
        res: () => ({}),
        err: () => ({ type: 'Error', message: 'redacted', stack: '' }),
      },
    },
  });
  app.addHook('onResponse', async (_request, reply) => {
    app.log.info({ statusCode: reply.statusCode }, 'request_completed');
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not_found' }),
  );
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.statusCode === 429)
      return reply.code(429).send({ error: 'rate_limited' });
    if (error.statusCode === 415)
      return reply.code(415).send({ error: 'unsupported_media_type' });
    if (error.statusCode === 413)
      return reply.code(413).send({ error: 'request_too_large' });
    if (error.statusCode === 400 || error.validation)
      return reply.code(400).send({ error: 'invalid_request' });
    app.log.error('request_failed');
    void reply.code(500).send({ error: 'internal_error' });
  });
  app.get('/health/live', async () => ({
    status: 'up',
    revision: config.revision,
  }));
  app.get('/health/ready', async (_request, reply) => {
    const [database, worker] = await Promise.all([
      probe(checks.database, timeoutMs),
      probe(checks.worker, timeoutMs),
    ]);
    return reply.code(database && worker ? 200 : 503).send({
      status: database && worker ? 'ready' : 'unavailable',
      dependencies: {
        database: database ? 'up' : 'down',
        worker: worker ? 'up' : 'down',
      },
      revision: config.revision,
    });
  });
  return app;
}
