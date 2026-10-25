import { execFile as execute, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import pg from 'pg';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';

const run = promisify(execute);
type ReadinessResponse = { status: number; body: unknown };
const readinessAttempts = 100;
const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitUntilReady(
  probe: () => Promise<ReadinessResponse | null>,
  wait: () => Promise<void> = () => pause(200),
): Promise<ReadinessResponse | null> {
  let lastResponse: ReadinessResponse | null = null;
  for (let attempt = 0; attempt < readinessAttempts; attempt++) {
    try {
      const response = await probe();
      if (response?.status === 200) return response;
      if (response) lastResponse = response;
    } catch {
      // The listener may not accept connections until startup completes.
    }
    if (attempt + 1 < readinessAttempts) await wait();
  }
  return lastResponse;
}

const execFileAsync = async (...args: [string, string[], { cwd: string }]) => {
    try {
      return await run(args[0], args[1], args[2]);
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      throw new Error(
        'step failed: ' +
          args[0] +
          ' ' +
          String(failure.stdout) +
          String(failure.stderr),
        { cause: error },
      );
    }
  },
  root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let container: StartedPostgreSqlContainer | undefined;
afterEach(async () => {
  await container?.stop();
  container = undefined;
});

// Shared by both entrypoint cases: one disposable database, one real worker
// process, and the same readiness probe.
async function startWorker(
  env: { tenantId: string; operatorId?: string },
  run: (probe: {
    ready: () => Promise<{ status: number; body: unknown } | null>;
    output: () => string;
    port: number;
    shutdown: () => Promise<{ code: number | null; tookMs: number }>;
  }) => Promise<void>,
) {
  container = await new PostgreSqlContainer('postgres:17.6-alpine')
    .withUsername('test')
    .withPassword('fictional')
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ])
    .start();
  const url = new URL(container.getConnectionUri());
  const pool = new pg.Pool({ connectionString: url.href });
  await migrate(pool);
  const tenantId = '11111111-1111-4111-8111-111111111111';
  await bootstrapAccess(
    pool,
    tenantId,
    'fictional.owner@example.invalid',
    'Fictional business',
    'Europe/Berlin',
  );
  // A dedicated role keeps the password policy honest: the worker needs a
  // mode-restricted file with at least 16 characters, not the test user's
  // arbitrary container password.
  await pool.query(
    "CREATE ROLE fictional_worker LOGIN PASSWORD 'fictional-worker-password'",
  );
  await pool.query('GRANT ALL ON SCHEMA public TO fictional_worker');
  await pool.query(
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO fictional_worker',
  );
  await pool.end();
  // The worker only reads its database password from a mode-restricted file.
  const secrets = await mkdtemp(join(tmpdir(), 'ak-worker-')),
    passwordFile = join(secrets, 'db-password');
  // The runtime rejects short passwords; the fixture stays visibly fictional.
  // The runtime requires at least 16 characters; the fixture stays fictional.
  await writeFile(passwordFile, 'fictional-worker-password\n', { mode: 0o600 });
  // The workspace imports resolve through the built core package, exactly as
  // they do for the production entrypoint.
  await execFileAsync(
    'pnpm',
    [
      '--use-node-version=24.15.0',
      '--filter',
      '@auftragskompass/core',
      'build',
    ],
    { cwd: root },
  );
  // Node 24 strips types without rewriting specifiers, so the unit test
  // compiles the same entry graph with tsc into a scratch directory first.
  // The scratch build sits inside the app directory so that workspace
  // dependency resolution matches the production layout.
  const build = await mkdtemp(join(root, 'apps/worker/dist-test-'));
  await execFileAsync(
    join(root, 'node_modules/.bin/tsc'),
    [
      '--project',
      join(root, 'apps/worker/tsconfig.json'),
      '--outDir',
      build,
      '--rootDir',
      join(root, 'apps/worker/src'),
    ],
    { cwd: root },
  );
  const port = 31000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [join(build, 'main.js')], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? '',
      // 'warn' instead of 'silent': the skip notice is exactly what this test
      // has to observe, and it must be a warning, not an error.
      AK_LOG_LEVEL: 'warn',
      AK_DB_HOST: url.hostname,
      AK_DB_PORT: url.port,
      AK_DB_NAME: url.pathname.slice(1),
      AK_DB_USER: 'fictional_worker',
      AK_DB_PASSWORD_FILE: passwordFile,
      AK_HOST: '127.0.0.1',
      AK_PORT: String(port),
      ...(env.operatorId
        ? {
            AK_INQUIRY_TENANT_ID: env.tenantId,
            AK_INQUIRY_OPERATOR_ID: env.operatorId,
            // BKP004.1: identities alone start no timer; this case is the
            // "drain wired in" one, so it needs the explicit activation.
            AK_INQUIRY_OPTION_DRAIN: 'on',
          }
        : {}),
      // No country configured: the drain must run and still leave new
      // contacts to human review instead of inventing one.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  // SIGTERM closes the app; the process must then end promptly even though the
  // drain's interval is still scheduled. A referenced timer would keep Node
  // alive after close(), so a slow exit is a real defect, not a slow machine.
  const shutdown = async () => {
    const started = Date.now();
    if (child.exitCode !== null || child.signalCode !== null)
      return { code: child.exitCode, tookMs: 0 };
    const closed = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code)),
    );
    child.kill('SIGTERM');
    return { code: await closed, tookMs: Date.now() - started };
  };
  const ready = () =>
    waitUntilReady(async () => {
      const response = await fetch(
        'http://127.0.0.1:' + port + '/health/ready',
      );
      return { status: response.status, body: await response.json() };
    });
  try {
    await run({
      ready,
      output: () => output.join(''),
      port,
      shutdown,
    });
  } finally {
    // A failed worker may have exited already; never wait on a stale event.
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((resolve) =>
        child.on('exit', () => resolve()),
      );
      child.kill('SIGTERM');
      await closed;
    }
    await rm(secrets, { recursive: true, force: true });
    await rm(build, { recursive: true, force: true });
  }
  // SIGTERM closes the app, which stops the drain before the pool ends.
  expect(child.signalCode).toBeNull();
}

test('readiness polling waits through a startup 503 until the worker is ready', async () => {
  const responses: ReadinessResponse[] = [
    { status: 503, body: { status: 'unavailable' } },
    { status: 200, body: { status: 'ready' } },
  ];
  let probes = 0,
    waits = 0;
  const result = await waitUntilReady(
    async () => responses[probes++] ?? null,
    async () => {
      waits++;
    },
  );
  expect(result).toEqual(responses[1]);
  expect(probes).toBe(2);
  expect(waits).toBe(1);
});

test('readiness polling returns the last 503 instead of treating it as ready', async () => {
  const response = { status: 503, body: { status: 'unavailable' } };
  let probes = 0,
    waits = 0;
  const result = await waitUntilReady(
    async () => {
      probes++;
      return response;
    },
    async () => {
      waits++;
    },
  );
  expect(probes).toBe(readinessAttempts);
  expect(waits).toBe(readinessAttempts - 1);
  expect(result).toEqual(response);
  expect(result?.status).not.toBe(200);
});

test('readiness polling recovers from a transient connection failure', async () => {
  const ready = { status: 200, body: { status: 'ready' } };
  let probes = 0,
    waits = 0;
  const result = await waitUntilReady(
    async () => {
      probes++;
      if (probes === 1) throw new Error('connection refused');
      return ready;
    },
    async () => {
      waits++;
    },
  );
  expect(result).toEqual(ready);
  expect(probes).toBe(2);
  expect(waits).toBe(1);
});

test('the real worker entrypoint serves readiness with the option drain wired in', async () => {
  await startWorker(
    {
      tenantId: '11111111-1111-4111-8111-111111111111',
      operatorId: '22222222-2222-4222-8222-222222222222',
    },
    async ({ ready, output, shutdown }) => {
      const result = await ready();
      // A failed start reports only its fixed startup event, never details.
      expect(output()).not.toContain('startup_failed');
      expect(result).toEqual({
        status: 200,
        body: {
          status: 'ready',
          dependencies: { database: 'up', worker: 'up' },
          revision: 'development',
        },
      });
      expect(output()).not.toContain('website_option_drain_unconfigured');
      const ended = await shutdown();
      expect(ended.code).toBe(0);
      expect(ended.tookMs).toBeLessThan(10000);
    },
  );
}, 240000);

test('without the optional inquiry identities the real worker stays ready and only skips the drain', async () => {
  await startWorker(
    { tenantId: '11111111-1111-4111-8111-111111111111' },
    async ({ ready, output, port, shutdown }) => {
      const result = await ready();
      expect(output()).not.toContain('startup_failed');
      expect(result).toEqual({
        status: 200,
        body: {
          status: 'ready',
          dependencies: { database: 'up', worker: 'up' },
          revision: 'development',
        },
      });
      const live = await fetch('http://127.0.0.1:' + port + '/health/live');
      expect(live.status).toBe(200);
      // Exactly one warning tells the operator the drain is off, not broken.
      const warnings =
        output().match(/website_option_drain_unconfigured/g) ?? [];
      expect(warnings).toHaveLength(1);
      expect(output()).not.toContain('website_option_config_invalid');
      expect(output()).not.toContain('website_option_drain_failed');
      const ended = await shutdown();
      expect(ended.code).toBe(0);
      expect(ended.tookMs).toBeLessThan(10000);
    },
  );
}, 240000);
