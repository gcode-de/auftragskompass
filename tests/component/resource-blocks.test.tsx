import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResourceBlocks } from '../../apps/admin/src/ResourceBlocks.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const unit = {
  id: 'synthetic-unit',
  name: 'Fictional box',
  code: 'SYNTH',
  ordinal: 1,
  enabled: true,
  state: 'active',
};
const block = {
  id: 'synthetic-block',
  unitId: unit.id,
  startsAt: '2030-10-16T16:00:00Z',
  endsAt: '2030-10-16T18:00:00Z',
  timeZone: 'Europe/Berlin',
  state: 'blocked',
  reason: 'Fictional maintenance',
};
test('creates a timed maintenance block with stable request ID and releases it while retaining history', async () => {
  const blocks: (typeof block)[] = [];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      if (_url.endsWith('/release')) blocks[0]!.state = 'released';
      else blocks.push({ ...block, ...JSON.parse(String(options.body)) });
      return Response.json(block);
    }
    return Response.json({ timeZone: 'Europe/Berlin', units: [unit], blocks });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ResourceBlocks csrfToken="csrf" />);
  await screen.findByRole('option', {
    name: 'Fictional box · Einheit 1 (SYNTH)',
  });
  fireEvent.change(screen.getByLabelText('Zu sperrende Einheit'), {
    target: { value: unit.id },
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: block.reason },
  });
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-10-16T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-16T20:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Zeitraum sperren' }).closest('form')!,
  );
  await screen.findByText('Zeitraum gesperrt.');
  const payload = JSON.parse(
    String(fetcher.mock.calls.find(([, options]) => options)?.[1]?.body),
  );
  expect(payload).toMatchObject({
    unitId: unit.id,
    reason: block.reason,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
  });
  expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Sperre freigeben: Fictional maintenance',
    }),
  );
  await screen.findByText('Sperre freigegeben.');
  expect(screen.getByText(/Fictional maintenance.*Freigegeben/)).toBeTruthy();
});

const overview = { timeZone: 'Europe/Berlin', units: [unit], blocks: [block] };
async function fill() {
  await screen.findByRole('option', {
    name: 'Fictional box · Einheit 1 (SYNTH)',
  });
  fireEvent.change(screen.getByLabelText('Zu sperrende Einheit'), {
    target: { value: unit.id },
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Fictional maintenance' },
  });
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-10-16T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-16T20:00' },
  });
}
function submit() {
  fireEvent.submit(
    screen.getByRole('button', { name: 'Zeitraum sperren' }).closest('form')!,
  );
}
test.each([
  ['resource_conflict', /überschneidet sich/],
  ['idempotency_conflict', /anderen Werten/],
  ['unit_unavailable', /inaktiv oder archiviert/],
  ['invalid_period', /gültigen, noch nicht beendeten/],
  ['invalid_reason', /höchstens 200/],
  ['unexpected', /Sperre konnte nicht gespeichert/],
])('block save error %s preserves form data', async (error, text) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? Response.json({ error }, { status: 409 })
        : Response.json(overview),
    ),
  );
  render(<ResourceBlocks csrfToken="csrf" />);
  await fill();
  submit();
  await screen.findByText(text);
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    'Fictional maintenance',
  );
});
test('an uncertain creation retry retains its request ID and accepts explicit offsets for repeated DST hours', async () => {
  const bodies: string[] = [];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      bodies.push(String(options.body));
      throw Error('synthetic transport failure');
    }
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ResourceBlocks csrfToken="csrf" />);
  await fill();
  submit();
  await screen.findByText(/Verbindung fehlgeschlagen. Vor erneutem/);
  submit();
  await screen.findByText(/Verbindung fehlgeschlagen. Vor erneutem/);
  expect(bodies).toHaveLength(2);
  expect(JSON.parse(bodies[0]!).requestId).toBe(
    JSON.parse(bodies[1]!).requestId,
  );
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-10-27T02:15' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-27T02:45' },
  });
  submit();
  await screen.findByText(/Zeitpunkt prüfen/);
  fireEvent.change(screen.getByLabelText('UTC-Versatz: Sperrbeginn'), {
    target: { value: '+01:00' },
  });
  fireEvent.change(screen.getByLabelText('UTC-Versatz: Sperrende'), {
    target: { value: '+01:00' },
  });
  submit();
  await screen.findByText(/Verbindung fehlgeschlagen. Vor erneutem/);
  expect(JSON.parse(bodies[2]!).startsAt).toBe('2030-10-27T01:15:00Z');
  expect(JSON.parse(bodies[2]!).requestId).not.toBe(
    JSON.parse(bodies[0]!).requestId,
  );
});
test('list refresh and release failures remain visible; historical or inactive units are handled', async () => {
  const fetcher = vi.fn().mockRejectedValue(Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  render(<ResourceBlocks csrfToken="csrf" />);
  await screen.findByText('Sperren konnten nicht geladen werden.');
  fetcher.mockResolvedValue(new Response(null, { status: 500 }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Sperren aktualisieren' }),
  );
  await screen.findByText('Sperren konnten nicht geladen werden.');
  fetcher.mockImplementation(async () =>
    Response.json({ invalid: 'synthetic' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Sperren aktualisieren' }),
  );
  await screen.findByText('Sperren konnten nicht geladen werden.');
  fetcher.mockImplementation(async () =>
    Response.json({
      ...overview,
      units: [{ ...unit, enabled: false, state: 'inactive' }],
      blocks: [{ ...block, reason: '', unitId: 'synthetic-old-unit' }],
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Sperren aktualisieren' }),
  );
  await screen.findByText(/Historische Einheit/);
  expect(
    (
      screen.getByRole('option', {
        name: 'Fictional box · Einheit 1 (SYNTH)',
      }) as HTMLOptionElement
    ).disabled,
  ).toBe(true);
  for (const [error, text] of [
    ['not_found', /Sperre nicht gefunden/],
    ['unexpected', /Sperre konnte nicht freigegeben/],
  ] as const) {
    fetcher.mockImplementation(async () =>
      Response.json({ error }, { status: 404 }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Sperre freigeben: Zeitweise Sperre',
      }),
    );
    await screen.findByText(text);
  }
  fetcher.mockRejectedValue(Error('offline'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Sperre freigeben: Zeitweise Sperre' }),
  );
  await screen.findByText(/Den aktuellen Stand vor einer Wiederholung/);
});
