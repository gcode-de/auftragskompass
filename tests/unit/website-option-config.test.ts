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

// Mirrors the real keyset query: one bounded page in (stagedAt, id) order plus a
// cursor, so a test can prove that entries behind a full page are still reached.
function fixtures() {
  const calls: Call[] = [],
    logs: string[] = [],
    backlog: { id: string; stagedAt: Date }[] = [],
    failures = new Set<string>(),
    outages = new Set<string>();
  let listError: Error | null = null,
    listed = 0,
    staged = 0;
  const dependencies: WebsiteOptionDrainDependencies = {
    async listPending(_connection, tenant, after) {
      if (tenant !== tenantId) throw new Error('wrong tenant');
      if (listError) throw listError;
      listed++;
      return backlog
        .slice()
        .sort(
          (left, right) =>
            left.stagedAt.getTime() - right.stagedAt.getTime() ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .filter(
          (row) =>
            !after ||
            row.stagedAt > after.stagedAt ||
            (row.stagedAt.getTime() === after.stagedAt.getTime() &&
              row.id > after.id),
        )
        .slice(0, 10);
    },
    async processPending(_connection, tenant, actor, id, options) {
      calls.push({ tenantId: tenant, actorId: actor, id, ...options });
      // Durable entry reasons describe the entry; an outage is infrastructure.
      if (outages.has(id))
        throw Object.assign(new Error('fictional'), { reason: 'failed' });
      if (failures.has(id))
        throw Object.assign(new Error('fictional'), {
          reason: 'contact_review',
        });
    },
  };
  return {
    dependencies,
    calls,
    logs,
    failures,
    outages,
    pages: () => listed,
    stage: (...ids: string[]) =>
      ids.forEach((id) =>
        backlog.push({
          id,
          stagedAt: new Date(Date.UTC(2030, 9, 26, 10, staged++)),
        }),
      ),
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
  test('one tick works through the whole backlog in order, without overlap, and stop waits for it', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = fixtures();
    fixture.dependencies.processPending = async (
      _connection,
      tenant,
      actor,
      id,
      options,
    ) => {
      fixture.calls.push({ tenantId: tenant, actorId: actor, id, ...options });
      await blocked;
    };
    fixture.stage('a', 'b', 'c', 'd');
    const drain = fixture.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.calls).toEqual([
      { tenantId, actorId, id: 'a', newContactCountry: 'DE' },
    ]);
    // A tick during the blocked run does not start a second, parallel run.
    await vi.advanceTimersByTimeAsync(15000);
    expect(fixture.calls.map((call) => call.id)).toEqual(['a']);
    const stopping = drain.stop();
    release();
    await stopping;
    // stop() waits for the running tick; the tick still finishes its backlog.
    expect(fixture.calls.map((call) => call.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(drain.ready()).toBe(true);
    expect(fixture.logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(120000);
    expect(fixture.calls.map((call) => call.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  test('a stopping drain never begins another page', async () => {
    const fixture = fixtures();
    let resolveList!: (ids: { id: string; stagedAt: Date }[]) => void,
      listed = 0;
    fixture.dependencies.listPending = () => {
      listed++;
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    };
    const drain = fixture.start();
    await vi.waitFor(() => expect(listed).toBe(1));
    const stopping = drain.stop();
    resolveList([]);
    await stopping;
    // The first page completed during stop; no further page or tick may start.
    await vi.advanceTimersByTimeAsync(120000);
    expect(listed).toBe(1);
    expect(fixture.calls).toEqual([]);
  });

  test('a failing entry is logged with a fixed code and never blocks the rest of the batch or readiness', async () => {
    const fixture = fixtures(),
      report = vi.fn();
    fixture.failures.add('poison');
    fixture.stage('poison', 'good');
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

  // BKP003 replaces the former blanket rule "a known entry is attempted once per
  // process". Only a durable entry reason is held back; temporary and
  // infrastructure failures are retried by the next tick, as the next test shows.
  test('a durable entry reason is reported once per entry and process, later entries stay reachable', async () => {
    const fixture = fixtures(),
      report = vi.fn();
    fixture.failures.add('poison');
    fixture.stage('poison', 'good');
    const drain = fixture.start(report);
    await vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(15000);
    // The held entry is neither retried nor reported again; the valid one still
    // runs on every tick because the fixture keeps it pending.
    expect(fixture.calls.map((call) => call.id)).toEqual([
      'poison',
      'good',
      'good',
      'good',
    ]);
    expect(fixture.logs).toEqual(['website_option_contact_review']);
    expect(report).not.toHaveBeenCalled();
    expect(drain.ready()).toBe(true);
    await drain.stop();
  });
  test('a temporary failure is retried on the next tick without a restart and can then succeed', async () => {
    const fixture = fixtures(),
      report = vi.fn();
    fixture.outages.add('flaky');
    fixture.stage('flaky');
    const drain = fixture.start(report);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.calls.map((call) => call.id)).toEqual(['flaky']);
    expect(report).toHaveBeenCalledOnce();
    expect(drain.ready()).toBe(false);
    fixture.outages.delete('flaky');
    await vi.advanceTimersByTimeAsync(15000);
    // The same process, no restart: the entry is attempted again and succeeds.
    expect(fixture.calls.map((call) => call.id)).toEqual(['flaky', 'flaky']);
    expect(fixture.logs).toEqual([]);
    expect(drain.ready()).toBe(true);
    await drain.stop();
  });
  test('ten durably failing entries do not starve the eleventh: the cursor reaches the next page', async () => {
    const fixture = fixtures(),
      poison = Array.from({ length: 10 }, (_, index) => 'poison' + index);
    for (const id of poison) fixture.failures.add(id);
    fixture.stage(...poison, 'good');
    const drain = fixture.start();
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(11));
    expect(fixture.calls.map((call) => call.id)).toEqual([...poison, 'good']);
    expect(fixture.logs).toEqual(
      poison.map(() => 'website_option_contact_review'),
    );
    // Ten, then one, then the empty page that ends the run.
    expect(fixture.pages()).toBe(3);
    expect(drain.ready()).toBe(true);
    await drain.stop();
  });
});
