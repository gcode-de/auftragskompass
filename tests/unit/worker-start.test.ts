import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  startWorkerRuntime,
  type WorkerRuntimeDependencies,
} from '../../apps/worker/src/worker-start.js';

const tenantId = '11111111-1111-4111-8111-111111111111',
  actorId = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  delete process.env.AK_GATEWAY_ORIGIN;
  delete process.env.AK_INQUIRY_TENANT_ID;
  delete process.env.AK_INQUIRY_OPERATOR_ID;
  delete process.env.AK_INQUIRY_DEFAULT_CONTACT_COUNTRY;
});

type Fixture = {
  calls: string[];
  ready: boolean;
  expiryReady: boolean;
  drainReady: boolean;
  syncReady: boolean;
  reports: string[];
};

function fixture(overrides: Partial<Fixture> = {}) {
  const state: Fixture = {
    calls: [],
    ready: true,
    expiryReady: true,
    drainReady: true,
    syncReady: true,
    reports: [],
    ...overrides,
  };
  const app = {
    log: {
      error: (code: string) => state.calls.push('log:' + code),
      warn: (code: string) => state.calls.push('warn:' + code),
    },
  } as unknown as FastifyInstance;
  const dependencies: WorkerRuntimeDependencies = {
    createServer: () => app,
    probe: async () => state.ready,
    startExpiry: (report) => {
      void report;
      state.calls.push('startExpiry');
      return {
        ready: () => state.expiryReady,
        stop: async () => {
          state.calls.push('stopExpiry');
        },
      };
    },
    loadOptionConfig: () => ({
      tenantId,
      actorId,
      newContactCountry: 'DE',
      intervalMs: 15000,
    }),
    startDrain: (_pool, _dependencies, config, log, report) => {
      state.calls.push('startDrain:' + String(config.newContactCountry));
      void log;
      void report;
      return {
        ready: () => state.drainReady,
        stop: async () => {
          state.calls.push('stopDrain');
        },
      };
    },
    loadSyncConfig: () => ({
      tenantId,
      actorId,
      origin: 'https://fictional.example.invalid',
      requestKey: { id: 'sync-a', secret: new Uint8Array(32) } as never,
      responseKeys: [],
      intervalMs: 30000,
    }),
    startSync: (_pool, _config, report) => {
      void report;
      state.calls.push('startSync');
      return {
        ready: () => state.syncReady,
        stop: async () => {
          state.calls.push('stopSync');
        },
      };
    },
  };
  return { state, dependencies };
}

describe('worker runtime wiring', () => {
  test('registers health checks, starts the drain, and stops drain, sync and pool in that order', async () => {
    const subject = fixture(),
      checks: Record<string, () => Promise<boolean>> = {};
    subject.dependencies.createServer = (_config, probes) => {
      checks.database = probes.database;
      checks.worker = probes.worker;
      return {
        log: {
          error: (code: string) => subject.state.calls.push('log:' + code),
        },
      } as unknown as FastifyInstance;
    };
    const runtime = await startWorkerRuntime(
      { logLevel: 'silent' } as never,
      { query: () => 0 } as never,
      subject.dependencies,
      { AK_GATEWAY_ORIGIN: 'https://fictional.example.invalid' },
      () => '',
      async () => {
        subject.state.calls.push('endPool');
      },
    );
    expect(await runtime.refreshSync()).toBe(true);
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'startDrain:DE',
      'startSync',
    ]);
    expect(await checks.database!()).toBe(true);
    expect(await checks.worker!()).toBe(true);
    subject.state.drainReady = false;
    expect(await checks.worker!()).toBe(false);
    subject.state.drainReady = true;
    subject.state.expiryReady = false;
    expect(await checks.worker!()).toBe(false);
    subject.state.expiryReady = true;
    expect(await runtime.refreshSync()).toBe(false);
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'startDrain:DE',
      'startSync',
    ]);
    expect(await checks.worker!()).toBe(true);
    subject.state.syncReady = false;
    expect(await checks.worker!()).toBe(false);
    await runtime.close();
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'startDrain:DE',
      'startSync',
      'stopDrain',
      'stopSync',
      'stopExpiry',
      'endPool',
    ]);
  });
  test('stays inert without a gateway origin and still drains local options', async () => {
    const subject = fixture({ syncReady: false });
    const runtime = await startWorkerRuntime(
      { logLevel: 'silent' } as never,
      { query: () => 0 } as never,
      subject.dependencies,
      { AK_GATEWAY_ORIGIN: 'https://fictional.example.invalid' },
      () => '',
      async () => {
        subject.state.calls.push('endPool');
      },
    );
    expect(await runtime.refreshSync()).toBe(true);
    expect(await runtime.refreshSync()).toBe(false);
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'startDrain:DE',
      'startSync',
    ]);
    await runtime.close();
    expect(subject.state.calls.at(-1)).toBe('endPool');
  });
  test('an unconfigured option drain is skipped once and leaves the worker ready', async () => {
    const subject = fixture(),
      checks: Record<string, () => Promise<boolean>> = {};
    subject.dependencies.createServer = (_config, probes) => {
      checks.worker = probes.worker;
      return {
        log: {
          error: (code: string) => subject.state.calls.push('log:' + code),
          warn: (code: string) => subject.state.calls.push('warn:' + code),
        },
      } as unknown as FastifyInstance;
    };
    subject.dependencies.loadOptionConfig = vi.fn(() => null);
    const runtime = await startWorkerRuntime(
      { logLevel: 'silent' } as never,
      { query: () => 0 } as never,
      subject.dependencies,
      {},
      () => '',
      async () => {
        subject.state.calls.push('endPool');
      },
    );
    // No drain, no timer, one warning: entries simply stay visible exceptions.
    expect(runtime.drain).toBeNull();
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'warn:website_option_drain_unconfigured',
    ]);
    expect(await checks.worker!()).toBe(true);
    await runtime.close();
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'warn:website_option_drain_unconfigured',
      'stopExpiry',
      'endPool',
    ]);
  });
  test('a present but invalid option identity stays an error and keeps readiness down', async () => {
    const subject = fixture(),
      checks: Record<string, () => Promise<boolean>> = {};
    subject.dependencies.createServer = (_config, probes) => {
      checks.worker = probes.worker;
      return {
        log: {
          error: (code: string) => subject.state.calls.push('log:' + code),
          warn: (code: string) => subject.state.calls.push('warn:' + code),
        },
      } as unknown as FastifyInstance;
    };
    subject.dependencies.loadOptionConfig = vi.fn(() => {
      throw new Error('Invalid AK_INQUIRY_OPERATOR_ID');
    });
    const runtime = await startWorkerRuntime(
      { logLevel: 'silent' } as never,
      { query: () => 0 } as never,
      subject.dependencies,
      {},
      () => '',
      async () => {
        subject.state.calls.push('endPool');
      },
    );
    expect(subject.state.calls).toEqual([
      'startExpiry',
      'log:website_option_config_invalid',
    ]);
    expect(await checks.worker!()).toBe(false);
    await runtime.close();
    expect(subject.state.calls.slice(-2)).toEqual(['stopExpiry', 'endPool']);
  });
  test('a broken sync configuration cannot crash startup and keeps the worker healthy', async () => {
    const subject = fixture(),
      checks: Record<string, () => Promise<boolean>> = {};
    subject.dependencies.createServer = (_config, probes) => {
      checks.worker = probes.worker;
      return {
        log: {
          error: (code: string) => subject.state.calls.push('log:' + code),
          warn: (code: string) => subject.state.calls.push('warn:' + code),
        },
      } as unknown as FastifyInstance;
    };
    subject.dependencies.loadSyncConfig = vi.fn(() => {
      throw new Error('Missing configuration: AK_INQUIRY_SYNC_KEYS_FILE');
    });
    const runtime = await startWorkerRuntime(
      { logLevel: 'silent' } as never,
      { query: () => 0 } as never,
      subject.dependencies,
      { AK_GATEWAY_ORIGIN: 'https://fictional.example.invalid' },
      () => '',
      async () => {
        subject.state.calls.push('endPool');
      },
    );
    await expect(runtime.refreshSync()).resolves.toBe(false);
    expect(subject.state.calls).toContain('log:inquiry_sync_config_invalid');
    expect(subject.state.calls.filter((c) => c === 'startSync')).toEqual([]);
    expect(await checks.worker!()).toBe(true);
    await runtime.close();
  });
});
