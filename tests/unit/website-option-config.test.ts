import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  loadWebsiteOptionConfig,
  startWebsiteOptionDrain,
  type WebsiteOptionDrainDependencies,
} from '../../packages/core/src/index.js';

const tenantId = '11111111-1111-4111-8111-111111111111',
  actorId = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  delete process.env.AK_INQUIRY_DEFAULT_CONTACT_COUNTRY;
});

describe('loadWebsiteOptionConfig', () => {
  test('reads an explicitly configured two-letter country and an opt-in interval', () => {
    expect(
      loadWebsiteOptionConfig({
        AK_INQUIRY_TENANT_ID: tenantId,
        AK_INQUIRY_OPERATOR_ID: actorId,
        AK_INQUIRY_DEFAULT_CONTACT_COUNTRY: 'DE',
        AK_INQUIRY_OPTION_INTERVAL_MS: '45000',
      }),
    ).toEqual({
      tenantId,
      actorId,
      newContactCountry: 'DE',
      intervalMs: 45000,
    });
  });
  test('an absent country stays undefined so new contacts need human review', () => {
    const config = loadWebsiteOptionConfig({
      AK_INQUIRY_TENANT_ID: tenantId,
      AK_INQUIRY_OPERATOR_ID: actorId,
      AK_INQUIRY_DEFAULT_CONTACT_COUNTRY: '',
    });
    expect(config).toEqual({ tenantId, actorId, intervalMs: 30000 });
    expect(config?.newContactCountry).toBeUndefined();
  });
  test('rejects malformed countries instead of guessing one', () => {
    for (const country of ['de', 'DEU', '1D', ' D', 'D E', '🇩🇪'])
      expect(() =>
        loadWebsiteOptionConfig({
          AK_INQUIRY_TENANT_ID: tenantId,
          AK_INQUIRY_OPERATOR_ID: actorId,
          AK_INQUIRY_DEFAULT_CONTACT_COUNTRY: country,
        }),
      ).toThrow(/AK_INQUIRY_DEFAULT_CONTACT_COUNTRY/);
  });
  test('skips the drain when both identities are absent, as a fresh install does', () => {
    // The operator id is a per-install bootstrap user: a restored deployment
    // cannot be expected to carry it, and that must not make the worker sick.
    expect(loadWebsiteOptionConfig({})).toBeNull();
    expect(
      loadWebsiteOptionConfig({
        AK_INQUIRY_TENANT_ID: '  ',
        AK_INQUIRY_OPERATOR_ID: '',
        AK_INQUIRY_DEFAULT_CONTACT_COUNTRY: 'DE',
      }),
    ).toBeNull();
  });
  test('rejects a half-configured or malformed identity instead of skipping', () => {
    for (const env of [
      // Half an identity is a configuration mistake, not an opt-out.
      { AK_INQUIRY_OPERATOR_ID: actorId },
      { AK_INQUIRY_TENANT_ID: tenantId },
      { AK_INQUIRY_TENANT_ID: tenantId, AK_INQUIRY_OPERATOR_ID: '  ' },
      { AK_INQUIRY_TENANT_ID: 'fictional', AK_INQUIRY_OPERATOR_ID: actorId },
      { AK_INQUIRY_TENANT_ID: tenantId, AK_INQUIRY_OPERATOR_ID: 'fictional' },
      {
        AK_INQUIRY_TENANT_ID: 'fictional',
        AK_INQUIRY_OPERATOR_ID: 'fictional',
      },
    ])
      expect(() => loadWebsiteOptionConfig(env)).toThrow(/AK_INQUIRY_/);
    for (const interval of ['0', '4999', '600001', '1.5', 'soon'])
      expect(() =>
        loadWebsiteOptionConfig({
          AK_INQUIRY_TENANT_ID: tenantId,
          AK_INQUIRY_OPERATOR_ID: actorId,
          AK_INQUIRY_OPTION_INTERVAL_MS: interval,
        }),
      ).toThrow(/AK_INQUIRY_OPTION_INTERVAL_MS/);
  });
});

type Call = { tenantId: string; actorId: string; id: string; country?: string };

function fixtures() {
  const calls: Call[] = [],
    logs: string[] = [],
    reports: string[] = [],
    pending: string[][] = [],
    failures = new Set<string>();
  let listError: Error | null = null;
  const dependencies: WebsiteOptionDrainDependencies = {
    async listPending(_connection, tenant) {
      if (tenant !== tenantId) throw new Error('wrong tenant');
      if (listError) throw listError;
      return pending.shift() ?? [];
    },
    async processPending(_connection, tenant, actor, id, options) {
      calls.push({ tenantId: tenant, actorId: actor, id, ...options });
      if (failures.has(id))
        throw Object.assign(new Error('fictional'), {
          reason: failures.has(id + ':infra') ? 'failed' : 'contact_review',
        });
    },
  };
  return {
    dependencies,
    calls,
    logs,
    reports,
    pending,
    failures,
    failListing: () => {
      listError = new Error('synthetic offline');
    },
    healListing: () => {
      listError = null;
    },
    start: (report = () => {}) =>
      startWebsiteOptionDrain(
        {} as never,
        dependencies,
        { tenantId, actorId, intervalMs: 15000, newContactCountry: 'DE' },
        (code) => logs.push(code),
        report,
      ),
  };
}

describe('website option drain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  test('one bounded batch per tick, ordered per listing, zero overlap and clean stop', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = fixtures(),
      calls: Call[] = [];
    fixture.dependencies.processPending = async (
      _connection,
      tenant,
      actor,
      id,
      options,
    ) => {
      calls.push({ tenantId: tenant, actorId: actor, id, ...options });
      await blocked;
    };
    fixture.pending.push(['a', 'b', 'c'], ['d']);
    const drain = fixture.start();
    const settle = vi.advanceTimersByTimeAsync(0);
    await settle;
    expect(calls).toEqual([
      { tenantId, actorId, id: 'a', newContactCountry: 'DE' },
    ]);
    // A tick during the blocked batch does not start a second batch.
    await vi.advanceTimersByTimeAsync(15000);
    expect(calls.map((call) => call.id)).toEqual(['a']);
    const stopping = drain.stop();
    release();
    await stopping;
    expect(calls.map((call) => call.id)).toEqual(['a', 'b', 'c']);
    expect(drain.ready()).toBe(true);
    expect(fixture.logs).toEqual([]);
  });
  test('a stopping drain never begins another batch', async () => {
    const fixture = fixtures();
    let resolveList!: (ids: string[]) => void,
      listed = 0;
    fixture.dependencies.listPending = () => {
      listed++;
      return new Promise<string[]>((resolve) => {
        resolveList = resolve;
      });
    };
    const drain = fixture.start();
    await vi.waitFor(() => expect(listed).toBe(1));
    const stopping = drain.stop();
    resolveList([]);
    await stopping;
    // The first tick completed during stop; no further tick may start.
    await vi.advanceTimersByTimeAsync(120000);
    expect(listed).toBe(1);
    expect(fixture.calls).toEqual([]);
  });

  test('a failing entry is logged with a fixed code and never blocks the rest of the batch or readiness', async () => {
    const fixture = fixtures(),
      report = vi.fn();
    fixture.failures.add('poison');
    fixture.pending.push(['poison', 'good']);
    const drain = fixture.start(report);
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(2));
    expect(fixture.calls.map((call) => call.id)).toEqual(['poison', 'good']);
    expect(fixture.logs).toEqual(['website_option_contact_review']);
    expect(report).not.toHaveBeenCalled();
    await drain.stop();
    expect(drain.ready()).toBe(true);
  });
  test('listing failures mark readiness down while the next tick recovers it', async () => {
    const fixture = fixtures(),
      report = vi.fn();
    let tick = 0;
    fixture.dependencies.listPending = async (_connection, tenant) => {
      if (tenant !== tenantId) throw new Error('wrong tenant');
      tick++;
      if (tick === 2) throw new Error('synthetic offline');
      return [];
    };
    const drain = fixture.start(report);
    await vi.advanceTimersByTimeAsync(15000);
    expect(tick).toBe(2);
    expect(report).toHaveBeenCalledOnce();
    expect(drain.ready()).toBe(false);
    await vi.advanceTimersByTimeAsync(15000);
    expect(tick).toBe(3);
    expect(report).toHaveBeenCalledOnce();
    expect(drain.ready()).toBe(true);
    await drain.stop();
  });
  test('a known entry is attempted once per process, not on every tick', async () => {
    const fixture = fixtures(),
      report = vi.fn();
    fixture.failures.add('poison');
    fixture.pending.push(['poison'], ['poison']);
    const drain = fixture.start(report);
    await vi.advanceTimersByTimeAsync(15000);
    expect(fixture.calls.map((call) => call.id)).toEqual(['poison']);
    await vi.advanceTimersByTimeAsync(15000);
    expect(fixture.calls.map((call) => call.id)).toEqual(['poison']);
    expect(report).not.toHaveBeenCalled();
    expect(drain.ready()).toBe(true);
    await drain.stop();
  });
});
