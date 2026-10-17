import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  loadRuntimeConfig,
  createHealthServer,
} from '../../packages/core/src/runtime.js';
const env = {
  AK_DB_HOST: 'database',
  AK_DB_NAME: 'auftragskompass',
  AK_DB_USER: 'ak',
  AK_DB_PASSWORD_FILE: '/synthetic/password',
};
test('runtime configuration rejects missing values without echoing secrets', () => {
  expect(() => loadRuntimeConfig({}, () => 'synthetic-secret-value')).toThrow(
    'AK_DB_HOST',
  );
});
test('liveness survives dependency failures while readiness reports them', async () => {
  const config = loadRuntimeConfig(env, () => 'synthetic-secret-value');
  const app = createHealthServer(config, {
    database: async () => {
      throw new Error('synthetic-secret-value');
    },
    worker: async () => true,
  });
  try {
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    const reply = await app.inject('/health/ready');
    expect(reply.statusCode).toBe(503);
    expect(reply.json().dependencies).toEqual({
      database: 'down',
      worker: 'up',
    });
    expect(reply.body).not.toContain('synthetic-secret-value');
  } finally {
    await app.close();
  }
});
import { Writable } from 'node:stream';
test('configuration validates every boundary', () => {
  for (const key of Object.keys(env)) {
    const invalid: Record<string, string> = { ...env };
    delete invalid[key];
    expect(() =>
      loadRuntimeConfig(invalid, () => 'synthetic-password'),
    ).toThrow(key);
  }
  for (const [key, value] of [
    ['AK_PORT', '0'],
    ['AK_DB_PORT', '65536'],
    ['AK_PORT', 'abc'],
    ['AK_PORT', '2.1'],
    ['AK_LOG_LEVEL', 'secret'],
    ['AK_TIMEZONE', 'invalid'],
    ['AK_BUILD_REVISION', 'secret'],
    ['AK_HOST', 'example.invalid'],
  ])
    expect(() =>
      loadRuntimeConfig({ ...env, [key!]: value! }, () => 'synthetic-password'),
    ).toThrow();
  expect(() =>
    loadRuntimeConfig(env, () => {
      throw new Error('synthetic-secret');
    }),
  ).toThrow('Cannot read');
  expect(() => loadRuntimeConfig(env, () => 'short')).toThrow(
    'Invalid AK_DB_PASSWORD_FILE',
  );
  expect(
    loadRuntimeConfig(
      {
        ...env,
        AK_PORT: '4000',
        AK_DB_PORT: '5433',
        AK_LOG_LEVEL: 'silent',
        AK_HOST: '0.0.0.0',
        AK_BUILD_REVISION: 'abcdef0',
        AK_TIMEZONE: 'UTC',
      },
      () => 'synthetic-password',
    ).revision,
  ).toBe('abcdef0');
});
test('readiness distinguishes worker failure and bounds stalled dependencies; logs are minimal', async () => {
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs.push(String(chunk));
      callback();
    },
  });
  const config = loadRuntimeConfig(env, () => 'synthetic-secret-value');
  for (const [database, worker, status] of [
    [true, true, 200],
    [true, false, 503],
    [false, false, 503],
  ] as const) {
    const app = createHealthServer(
      config,
      { database: async () => database, worker: async () => worker },
      stream,
    );
    expect((await app.inject('/health/ready')).statusCode).toBe(status);
    await app.close();
  }
  const app = createHealthServer(
    config,
    { database: () => new Promise(() => {}), worker: async () => true },
    stream,
    5,
  );
  app.log.info(
    {
      req: { url: 'synthetic-private-token' },
      res: { headers: { cookie: 'synthetic-private-token' } },
      err: new Error('synthetic-private-message'),
    },
    'serialization_test',
  );
  app.post('/throw', () => {
    throw new Error('synthetic-private-message');
  });
  try {
    expect((await app.inject('/health/ready')).statusCode).toBe(503);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/throw?token=synthetic-private-token',
          headers: {
            authorization: 'Bearer synthetic-private-authorization',
            cookie: 'synthetic-private-cookie',
          },
          payload: { note: 'synthetic-private-body' },
        })
      ).statusCode,
    ).toBe(500);
    expect(
      (await app.inject('/unknown?token=synthetic-private-token')).statusCode,
    ).toBe(404);
    expect(logs.join('')).not.toContain('synthetic-private');
    const completed = logs
      .flatMap((chunk) => chunk.trim().split('\n'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'request_completed');
    expect(completed).toHaveLength(6);
    for (const entry of completed)
      expect(Object.keys(entry).sort()).toEqual([
        'hostname',
        'level',
        'msg',
        'pid',
        'statusCode',
        'time',
      ]);
  } finally {
    await app.close();
  }
});

test('runtime starts in a fresh process without deprecated request logging', () => {
  const moduleUrl = new URL(
    '../../packages/core/src/runtime.ts',
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import { createHealthServer, loadRuntimeConfig } from ${JSON.stringify(moduleUrl)};
    const app = createHealthServer(
      loadRuntimeConfig(${JSON.stringify(env)}, () => 'synthetic-secret-value'),
      { database: async () => true, worker: async () => true },
    );
    await app.inject('/health/live');
    await app.close();
  `,
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
  expect(child.status, child.stderr).toBe(0);
  expect(child.stderr).not.toContain('FSTDEP023');
});
