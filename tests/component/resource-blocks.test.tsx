import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
import { ResourceAssignments } from '../../apps/admin/src/ResourceAssignments.js';
import { ResourceBlocks } from '../../apps/admin/src/ResourceBlocks.js';
import { ResourcePanel } from '../../apps/admin/src/ResourcePanel.js';
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
const resourceRow = {
  id: 'synthetic-resource',
  version: 1,
  name: 'Synthetic box',
  code: 'SYN-1',
  category: 'Fotobox',
  description: 'Fictional',
  quantity: 1,
  beforeDays: 2,
  afterDays: 2,
  position: 0,
  state: 'active',
  blocked: false,
};
// BKP009.2: the rare maintenance management is one deliberate disclosure. The
// list, the creation form and the empty hint only exist once it is open, so
// every existing test opens it the way an operator does.
//
// `summary` is a native disclosure control, but `testing-library` resolves
// roles through `aria-query`, whose element-role table has no `summary` entry
// (only `dom-accessibility-api` maps it to `button`). The disclosure is
// therefore addressed by its region and its visible label; Chromium asserts
// the real role and the keyboard behaviour in the e2e spec.
function blocksRegion() {
  return screen.getByRole('region', { name: 'Zeitweise Ressourcensperren' });
}
function blockSummary() {
  return within(blocksRegion()).getByText(
    /^Sperrverwaltung (öffnen|schließen)$/,
  );
}
function blockDetails() {
  return blockSummary().closest('details')!;
}
function openBlocks() {
  const summary = blockSummary();
  expect(summary.textContent).toBe('Sperrverwaltung öffnen');
  fireEvent.click(summary);
}
function closeBlocks() {
  const summary = blockSummary();
  expect(summary.textContent).toBe('Sperrverwaltung schließen');
  fireEvent.click(summary);
}
async function renderBlocks() {
  render(<ResourceBlocks csrfToken="csrf" />);
  // The disclosure only exists once the overview loaded; a failed load keeps
  // the error and the refresh control as its only offered steps.
  await screen.findByText(/^Sperrverwaltung öffnen$/);
  openBlocks();
}
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
  await renderBlocks();
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
  await renderBlocks();
  await fill();
  submit();
  await screen.findByText(text);
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    'Fictional maintenance',
  );
});
test('an uncertain creation retry retains its request ID until the input actually changes', async () => {
  const bodies: string[] = [];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      bodies.push(String(options.body));
      throw Error('synthetic transport failure');
    }
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
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
    target: { value: '2030-10-16T17:00' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-16T21:00' },
  });
  submit();
  await screen.findByText(/Verbindung fehlgeschlagen. Vor erneutem/);
  expect(JSON.parse(bodies[2]!).startsAt).toBe('2030-10-16T15:00:00Z');
  expect(JSON.parse(bodies[2]!).endsAt).toBe('2030-10-16T19:00:00Z');
  expect(JSON.parse(bodies[2]!).requestId).not.toBe(
    JSON.parse(bodies[0]!).requestId,
  );
});
const ambiguousBlock = {
  ...block,
  startsAt: '2030-10-27T00:30:00.500Z',
  endsAt: '2030-10-27T01:45:00.750Z',
};
test('manual UTC offset fields are gone from the visible block form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...overview, blocks: [] })),
  );
  await renderBlocks();
  await screen.findByRole('option', {
    name: 'Fictional box · Einheit 1 (SYNTH)',
  });
  expect(screen.queryByLabelText(/UTC-Versatz/)).toBeNull();
  const start = screen.getByLabelText('Sperrbeginn', {
    exact: true,
  }) as HTMLInputElement;
  expect(start.name).toBe('start');
  expect(start.type).toBe('datetime-local');
});
test('a spring gap is reported at the block field, focuses it and sends nothing', async () => {
  const fetcher = vi.fn(async (...call: unknown[]) => {
    void call;
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
  await fill();
  const start = screen.getByLabelText('Sperrbeginn', { exact: true }),
    end = screen.getByLabelText('Sperrende', { exact: true });
  fireEvent.change(start, { target: { value: '2030-03-31T02:30' } });
  fireEvent.change(end, { target: { value: '2030-03-31T04:00' } });
  expect(start.getAttribute('aria-invalid')).toBe('true');
  expect(start.getAttribute('aria-describedby')).toBe(
    'block-start-start-error',
  );
  await screen.findByText(/existiert an diesem Tag nicht/);
  submit();
  await screen.findByText(/Sperrzeiten prüfen/);
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(0);
  expect(document.activeElement).toBe(start);
  expect((start as HTMLInputElement).value).toBe('2030-03-31T02:30');
});
test('a spring gap at the end focuses the end field instead', async () => {
  const fetcher = vi.fn(async (...call: unknown[]) => {
    void call;
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
  await fill();
  const end = screen.getByLabelText('Sperrende', { exact: true });
  fireEvent.change(end, { target: { value: '2030-03-31T02:45' } });
  expect(end.getAttribute('aria-describedby')).toBe('block-end-end-error');
  submit();
  await screen.findByText(/Sperrzeiten prüfen/);
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(0);
  expect(document.activeElement).toBe(end);
});
test('new repetitions of the autumn hour need an explicit choice before sending', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(block);
      }
      return Response.json({ ...overview, blocks: [] });
    }),
  );
  await renderBlocks();
  await fill();
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-10-27T02:15' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-27T02:45' },
  });
  const startChoice = screen.getByLabelText('Uhrzeitwahl Sperrbeginn'),
    endChoice = screen.getByLabelText('Uhrzeitwahl Sperrende');
  expect((startChoice as HTMLSelectElement).value).toBe('');
  expect((endChoice as HTMLSelectElement).value).toBe('');
  submit();
  await screen.findByText(/Sperrzeiten prüfen/);
  expect(bodies).toHaveLength(0);
  expect(document.activeElement).toBe(startChoice);
  expect(startChoice.getAttribute('aria-describedby')).toBe(
    'block-start-start-error',
  );
  await screen.findAllByText(/gibt es an diesem Tag zweimal/);
  fireEvent.change(startChoice, { target: { value: 'earlier' } });
  fireEvent.change(endChoice, { target: { value: 'later' } });
  submit();
  await screen.findByText('Zeitraum gesperrt.');
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!)).toMatchObject({
    startsAt: '2030-10-27T00:15:00Z',
    endsAt: '2030-10-27T01:45:00Z',
  });
});
test('an unchanged ambiguous block keeps its exact instant including seconds', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(ambiguousBlock);
      }
      return Response.json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [ambiguousBlock],
      });
    }),
  );
  await renderBlocks();
  await screen.findByText(/Fictional maintenance.*Gesperrt/);
  // A fresh form stays empty; reviewing the stored block is an explicit step.
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional maintenance',
    }),
  );
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2030-10-27T02:30:00.5');
  // The saved occurrence is preselected so an edit can still switch it.
  expect(
    (screen.getByLabelText('Uhrzeitwahl Sperrbeginn') as HTMLSelectElement)
      .value,
  ).toBe('earlier');
  expect(
    (screen.getByLabelText('Uhrzeitwahl Sperrende') as HTMLSelectElement).value,
  ).toBe('later');
  // The draft still holds the adopted window while unit and reason are entered.
  fireEvent.change(screen.getByLabelText('Zu sperrende Einheit'), {
    target: { value: unit.id },
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Fictional maintenance' },
  });
  submit();
  await waitFor(() => expect(bodies).toHaveLength(1));
  await screen.findByText('Zeitraum gesperrt.');
  // Byte for byte the stored instants, including seconds and milliseconds.
  expect(JSON.parse(bodies[0]!).startsAt).toBe(ambiguousBlock.startsAt);
  expect(JSON.parse(bodies[0]!).endsAt).toBe(ambiguousBlock.endsAt);
  // The confirmed save clears form and prefill; adopt the block again to show
  // that an explicit choice for the same wall clock wins over the saved instant.
  await screen.findByText(/Fictional maintenance.*Gesperrt/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional maintenance',
    }),
  );
  fireEvent.change(screen.getByLabelText('Zu sperrende Einheit'), {
    target: { value: unit.id },
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Fictional maintenance' },
  });
  fireEvent.change(screen.getByLabelText('Uhrzeitwahl Sperrbeginn'), {
    target: { value: 'later' },
  });
  submit();
  await waitFor(() => expect(bodies).toHaveLength(2));
  await screen.findByText('Zeitraum gesperrt.');
  expect(JSON.parse(bodies[1]!).startsAt).toBe('2030-10-27T01:30:00.5Z');
  // The end keeps its stored occurrence and therefore its exact instant.
  expect(JSON.parse(bodies[1]!).endsAt).toBe(ambiguousBlock.endsAt);
});
test('a changed date never reuses the previous summer or winter offset', async () => {
  const summer = {
    ...block,
    startsAt: '2030-07-15T16:00:00Z',
    endsAt: '2030-07-15T18:00:00Z',
  };
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(summer);
      }
      return Response.json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [],
      });
    }),
  );
  await renderBlocks();
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
    target: { value: '2030-12-15T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-12-15T20:00' },
  });
  submit();
  await screen.findByText('Zeitraum gesperrt.');
  expect(JSON.parse(bodies[0]!)).toMatchObject({
    startsAt: '2030-12-15T17:00:00Z',
    endsAt: '2030-12-15T19:00:00Z',
  });
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-07-16T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-07-16T20:00' },
  });
  submit();
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(JSON.parse(bodies[1]!)).toMatchObject({
    startsAt: '2030-07-16T16:00:00Z',
    endsAt: '2030-07-16T18:00:00Z',
  });
});
test('block time error ids stay unique next to the event editor and assignment form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/availability')) return Response.json([]);
      if (url === '/api/v1/events')
        return Response.json({
          timeZone: 'Europe/Berlin',
          events: [
            {
              id: 'synthetic-event',
              version: 1,
              name: 'Fictional booking',
              status: 'inquiry',
              eventTypeId: null,
              packageId: null,
              locationId: null,
              venue: null,
              venueOverride: false,
              primaryContactId: null,
              additionalContactIds: [],
              source: 'Synthetic',
              eventDate: null,
              startsAt: null,
              endsAt: null,
              timeZone: 'Europe/Berlin',
              description: '',
              notesHtml: '',
            },
          ],
        });
      if (url.startsWith('/api/v1/statuses'))
        return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
      if (
        url.startsWith('/api/v1/master-data/') ||
        url.includes('/api/v1/locations') ||
        url.includes('/api/v1/contacts')
      )
        return Response.json([]);
      return Response.json({ ...overview, blocks: [] });
    }),
  );
  render(
    <>
      <EventPanel csrfToken="csrf" />
      <ResourceAssignments
        event={{
          id: 'synthetic-event',
          version: 1,
          name: 'Fictional booking',
          status: 'inquiry',
          eventTypeId: null,
          packageId: null,
          locationId: null,
          venue: null,
          venueOverride: false,
          primaryContactId: null,
          additionalContactIds: [],
          source: 'Synthetic',
          eventDate: null,
          startsAt: null,
          endsAt: null,
          timeZone: 'Europe/Berlin',
          description: '',
          notesHtml: '',
        }}
        csrfToken="csrf"
        onChanged={async () => {}}
      />
      <ResourceBlocks csrfToken="csrf" />
    </>,
  );
  await screen.findByText(/^Sperrverwaltung öffnen$/);
  openBlocks();
  await screen.findByRole('option', {
    name: 'Fictional box · Einheit 1 (SYNTH)',
  });
  const blockStart = screen.getByLabelText('Sperrbeginn', { exact: true });
  fireEvent.change(blockStart, { target: { value: '2030-03-31T02:30' } });
  await screen.findAllByText(/existiert an diesem Tag nicht/);
  const describedBy = blockStart.getAttribute('aria-describedby')!;
  expect(describedBy).toBe('block-start-start-error');
  const target = document.getElementById(describedBy);
  expect(target).not.toBeNull();
  expect(target!.textContent).toMatch(/existiert an diesem Tag nicht/);
  // The neighbouring forms keep their own prefixes instead of sharing one.
  expect(describedBy.startsWith('block-')).toBe(true);
  expect(describedBy.startsWith('assignment-')).toBe(false);
  expect(describedBy.startsWith('event-')).toBe(false);
  expect(
    document.querySelectorAll('[id="block-start-start-error"]'),
  ).toHaveLength(1);
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
  // The overview is available now, so the deliberate opening is offered.
  await screen.findByText(/^Sperrverwaltung öffnen$/);
  openBlocks();
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
test('incomplete or reversed block periods are explained per field and never sent', async () => {
  const fetcher = vi.fn(async (...call: unknown[]) => {
    void call;
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
  await fill();
  const start = screen.getByLabelText('Sperrbeginn', {
    exact: true,
  }) as HTMLInputElement;
  const end = screen.getByLabelText('Sperrende', {
    exact: true,
  }) as HTMLInputElement;
  // Clearing now precedes the edit on purpose: a stale focus from a previous
  // save must never swallow a corrected field.
  fireEvent.change(end, { target: { value: '' } });
  submit();
  expect(await screen.findByText('Bitte ein Sperrende angeben.')).toBeTruthy();
  expect(document.activeElement).toBe(end);
  fireEvent.change(start, { target: { value: '' } });
  submit();
  expect(
    await screen.findByText('Bitte einen Sperrbeginn angeben.'),
  ).toBeTruthy();
  expect(document.activeElement).toBe(start);
  fireEvent.change(start, { target: { value: '2030-10-16T21:00' } });
  fireEvent.change(end, { target: { value: '2030-10-16T20:00' } });
  submit();
  expect(
    await screen.findByText('Das Sperrende muss nach dem Beginn liegen.'),
  ).toBeTruthy();
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(0);
  // Correcting a reported field clears its message without a second attempt.
  fireEvent.change(end, { target: { value: '2030-10-16T22:00' } });
  await waitFor(() =>
    expect(screen.queryByText(/Sperrende muss nach dem Beginn/)).toBeNull(),
  );
});

test('a confirmed block stays saved when only the reload fails and keeps the draft otherwise', async () => {
  const bodies: string[] = [];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      bodies.push(String(options.body));
      return Response.json(block, { status: 201 });
    }
    if (bodies.length === 1)
      return Response.json({ error: 'synthetic' }, { status: 500 });
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
  await fill();
  submit();
  await screen.findByText('Zeitraum gesperrt.');
  expect(
    await screen.findByText(/Sperre gespeichert, aber die Sperrliste/),
  ).toBeTruthy();
  // A reload failure is a refresh problem: exactly one POST, no resubmission.
  expect(bodies).toHaveLength(1);
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    '',
  );
  fetcher.mockImplementation(async () =>
    Response.json({ ...overview, blocks: [{ ...block, id: 'new-block' }] }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Sperrliste erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Sperre gespeichert, aber die Sperrliste/),
    ).toBeNull(),
  );
  expect(bodies).toHaveLength(1);
  expect(screen.getByText(/Fictional maintenance.*Gesperrt/)).toBeTruthy();
});

test('a background list refresh keeps an unsaved block draft and the saved preselection', async () => {
  let resolveReload: ((value: Response) => void) | undefined;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) return Response.json(block, { status: 201 });
    if (fetcher.mock.calls.filter(([, o]) => !o).length === 1)
      return Response.json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [ambiguousBlock],
      });
    return new Promise<Response>((resolve) => {
      resolveReload = resolve;
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
  await screen.findByText(/Fictional maintenance.*Gesperrt/);
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Unsaved fictional draft' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Sperren aktualisieren' }),
  );
  await waitFor(() => expect(resolveReload).toBeDefined());
  resolveReload!(
    Response.json({
      timeZone: 'Europe/Berlin',
      units: [unit],
      blocks: [{ ...ambiguousBlock, id: 'other-block' }],
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Sperrbeginn', { exact: true })).toBeTruthy(),
  );
  // The draft survives the refresh and no stored window is written into the
  // form behind the operator's back.
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    'Unsaved fictional draft',
  );
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('');
  expect(screen.queryByLabelText('Uhrzeitwahl Sperrbeginn')).toBeNull();
  // Looking at the stored block is an explicit action; then its own occurrence
  // is preselected so an unchanged value keeps the exact instant.
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional maintenance',
    }),
  );
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2030-10-27T02:30:00.5');
  expect(
    (screen.getByLabelText('Uhrzeitwahl Sperrbeginn') as HTMLSelectElement)
      .value,
  ).toBe('earlier');
});

test('a stored block is not adopted behind an unsaved draft without confirmation', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(block, { status: 201 });
      }
      return Response.json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [block, pastBlock],
      });
    }),
  );
  await renderBlocks();
  await screen.findByText(/Fictional maintenance.*Gesperrt/);
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Unsaved fictional draft' },
  });
  const confirmation = vi.fn(() => false);
  vi.stubGlobal('confirm', confirmation);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional past maintenance',
    }),
  );
  expect(confirmation).toHaveBeenCalledTimes(1);
  // A declined confirmation keeps the draft exactly as it was.
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    'Unsaved fictional draft',
  );
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('');
  // An untouched form adopts without asking.
  // Clearing the text is itself an edit, so the form still counts as a draft
  // and keeps asking; only a confirmed adoption replaces it.
  confirmation.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional past maintenance',
    }),
  );
  expect(confirmation).toHaveBeenCalledTimes(2);
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2020-01-01T11:00');
  expect(bodies).toHaveLength(0);
});

const pastBlock = {
  ...block,
  id: 'synthetic-past-block',
  startsAt: '2020-01-01T10:00:00Z',
  endsAt: '2020-01-01T12:00:00Z',
  reason: 'Fictional past maintenance',
};
test('a fresh block form starts empty even when the list holds a past and a blocked block', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [block, pastBlock],
      }),
    ),
  );
  await renderBlocks();
  await screen.findByText(/Fictional maintenance.*Gesperrt/);
  const start = screen.getByLabelText('Sperrbeginn', {
    exact: true,
  }) as HTMLInputElement;
  const end = screen.getByLabelText('Sperrende', {
    exact: true,
  }) as HTMLInputElement;
  // Nothing is being corrected, so no existing window may leak into the
  // creation form — neither the newest block nor the older one.
  expect(start.value).toBe('');
  expect(end.value).toBe('');
  expect(start.required || end.required || start.value === '').toBe(true);
  expect(screen.queryByLabelText('Uhrzeitwahl Sperrbeginn')).toBeNull();
  // Saving with only unit and reason selected sends no invented window.
  fireEvent.change(screen.getByLabelText('Zu sperrende Einheit'), {
    target: { value: unit.id },
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Fictional new maintenance' },
  });
  submit();
  expect(
    await screen.findByText('Bitte einen Sperrbeginn angeben.'),
  ).toBeTruthy();
  expect(document.activeElement).toBe(start);
  // The required field would also stop a native submit; the explicit check
  // above proves the form never carried the neighbouring window into a POST.
  expect((start as HTMLInputElement).value).toBe('');
});
test('only an explicitly adopted block fills the form; that window is sent once', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(block, { status: 201 });
      }
      return Response.json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [block, pastBlock],
      });
    }),
  );
  await renderBlocks();
  await screen.findByText(/Fictional maintenance.*Gesperrt/);
  const start = screen.getByLabelText('Sperrbeginn', {
    exact: true,
  }) as HTMLInputElement;
  expect(start.value).toBe('');
  // Adopting a past window stays possible, but only through the explicit action,
  // which names the block it copies so the operator cannot copy it by accident.
  const adopt = screen.getByRole('button', {
    name: 'Zeiten übernehmen: Fictional past maintenance',
  });
  const confirmation = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmation);
  fireEvent.click(adopt);
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2020-01-01T11:00');
  expect(
    (screen.getByLabelText('Sperrende', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2020-01-01T13:00');
  fireEvent.change(screen.getByLabelText('Zu sperrende Einheit'), {
    target: { value: unit.id },
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Fictional repeated maintenance' },
  });
  submit();
  await screen.findByText('Zeitraum gesperrt.');
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!)).toMatchObject({
    startsAt: pastBlock.startsAt,
    endsAt: pastBlock.endsAt,
  });
});
test('the end field switches to Normalzeit in the repeated hour as well', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(block, { status: 201 });
      }
      return Response.json({ ...overview, blocks: [] });
    }),
  );
  await renderBlocks();
  await fill();
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-10-27T01:15' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-27T02:45' },
  });
  const endChoice = screen.getByLabelText('Uhrzeitwahl Sperrende');
  expect(
    Array.from(
      (endChoice as HTMLSelectElement).options,
      (option) => option.text,
    ),
  ).toEqual([
    'Bitte wählen',
    'Sommerzeit (UTC+02:00)',
    'Normalzeit (UTC+01:00)',
  ]);
  fireEvent.change(endChoice, { target: { value: 'later' } });
  submit();
  await screen.findByText('Zeitraum gesperrt.');
  expect(JSON.parse(bodies[0]!)).toMatchObject({
    // 01:15 CEST is unique; the end is the second, winter occurrence.
    startsAt: '2030-10-26T23:15:00Z',
    endsAt: '2030-10-27T01:45:00Z',
  });
  // The same wall clock as Sommerzeit is an hour earlier in UTC.
  fireEvent.change(screen.getByLabelText('Sperrbeginn', { exact: true }), {
    target: { value: '2030-10-27T01:15' },
  });
  fireEvent.change(screen.getByLabelText('Sperrende', { exact: true }), {
    target: { value: '2030-10-27T02:45' },
  });
  fireEvent.change(screen.getByLabelText('Uhrzeitwahl Sperrende'), {
    target: { value: 'earlier' },
  });
  submit();
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(JSON.parse(bodies[1]!)).toMatchObject({
    startsAt: '2030-10-26T23:15:00Z',
    endsAt: '2030-10-27T00:45:00Z',
  });
});

test('the block management opens deliberately and keeps the existing overview reachable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(overview)),
  );
  render(<ResourceBlocks csrfToken="csrf" />);
  const region = await screen.findByRole('region', {
    name: 'Zeitweise Ressourcensperren',
  });
  // The heading, the status line and the refresh control stay outside the
  // disclosure, so the area keeps its name and its error path without a click.
  expect(within(region).getByText('Zeitweise Ressourcensperren')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Sperren aktualisieren' }),
  ).toBeTruthy();
  await screen.findByText(/^Sperrverwaltung öffnen$/);
  const summary = blockSummary();
  expect(summary.localName).toBe('summary');
  expect(blockDetails().hasAttribute('open')).toBe(false);
  // Nothing of the management is mounted or tabbable before the deliberate
  // opening: no form control, no primary action, no overview entry.
  expect(screen.queryByLabelText('Sperrgrund')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Zeitraum sperren' })).toBeNull();
  expect(screen.queryByText(/Fictional maintenance.*Gesperrt/)).toBeNull();
  openBlocks();
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect(screen.getByLabelText('Sperrgrund')).toBeTruthy();
  // The existing overview appears unchanged: same wording, same actions.
  expect(screen.getByText(/Fictional maintenance.*Gesperrt/)).toBeTruthy();
  expect(
    screen.getByRole('button', {
      name: 'Sperre freigeben: Fictional maintenance',
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional maintenance',
    }),
  ).toBeTruthy();
  // The label follows the state; the native element carries the state itself.
  expect(blockSummary()).toBe(summary);
  expect(summary.textContent).toBe('Sperrverwaltung schließen');
  expect(summary.getAttribute('aria-expanded')).toBeNull();
});

test('closing with an unsaved block draft asks first and discards only on approval', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return Response.json(block, { status: 201 });
      }
      return Response.json({ ...overview, blocks: [] });
    }),
  );
  await renderBlocks();
  await screen.findByRole('option', {
    name: 'Fictional box · Einheit 1 (SYNTH)',
  });
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Unsaved fictional draft' },
  });
  const confirmation = vi.fn((...call: unknown[]) => {
    void call;
    return false;
  });
  vi.stubGlobal('confirm', confirmation);
  closeBlocks();
  expect(confirmation).toHaveBeenCalledTimes(1);
  expect(confirmation.mock.calls[0]![0]).toBe(
    'Ungespeicherte Sperrzeiten verwerfen und die Sperrverwaltung schließen?',
  );
  // A declined confirmation leaves the disclosure open and the draft untouched.
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    'Unsaved fictional draft',
  );
  expect(bodies).toHaveLength(0);
  confirmation.mockReturnValue(true);
  closeBlocks();
  expect(confirmation).toHaveBeenCalledTimes(2);
  expect(blockDetails().hasAttribute('open')).toBe(false);
  expect(screen.queryByLabelText('Sperrgrund')).toBeNull();
  expect(
    screen.getByRole('region', { name: 'Zeitweise Ressourcensperren' }),
  ).toBeTruthy();
  // Focus returns to the control that closed the disclosure.
  expect(document.activeElement).toBe(blockSummary());
  expect(bodies).toHaveLength(0);
  // The discarded draft is gone, not merely hidden.
  openBlocks();
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    '',
  );
});

test('closing an untouched block form asks nothing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...overview, blocks: [] })),
  );
  await renderBlocks();
  await screen.findByRole('option', {
    name: 'Fictional box · Einheit 1 (SYNTH)',
  });
  const confirmation = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmation);
  closeBlocks();
  expect(confirmation).not.toHaveBeenCalled();
  expect(blockDetails().hasAttribute('open')).toBe(false);
  expect(screen.queryByLabelText('Sperrgrund')).toBeNull();
});

test('a running block request keeps the disclosure open and sends exactly once', async () => {
  let resolveSave: ((value: Response) => void) | undefined;
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(String(options.body));
        return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
      }
      return Response.json({ ...overview, blocks: [] });
    }),
  );
  await renderBlocks();
  await fill();
  submit();
  await waitFor(() => expect(bodies).toHaveLength(1));
  closeBlocks();
  // Unmounting mid-flight would drop the form and its retry identity.
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect(screen.getByLabelText('Sperrgrund')).toBeTruthy();
  resolveSave!(Response.json(block, { status: 201 }));
  await screen.findByText('Zeitraum gesperrt.');
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!).requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect((screen.getByLabelText('Sperrgrund') as HTMLInputElement).value).toBe(
    '',
  );
});

test('a confirmed save leaves no draft, so closing afterwards asks nothing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? Response.json(block, { status: 201 })
        : Response.json({ ...overview, blocks: [] }),
    ),
  );
  await renderBlocks();
  await fill();
  submit();
  await screen.findByText('Zeitraum gesperrt.');
  const confirmation = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmation);
  closeBlocks();
  expect(confirmation).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Sperrgrund')).toBeNull();
  openBlocks();
  const start = screen.getByLabelText('Sperrbeginn', {
    exact: true,
  }) as HTMLInputElement;
  expect(start.value).toBe('');
  expect(
    (screen.getByLabelText('Sperrende', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('');
  expect(screen.queryByLabelText('Uhrzeitwahl Sperrbeginn')).toBeNull();
});

test('adopting stored times keeps the management open and focuses the first field', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(overview)),
  );
  await renderBlocks();
  await screen.findByRole('button', {
    name: 'Zeiten übernehmen: Fictional maintenance',
  });
  const confirmation = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmation);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional maintenance',
    }),
  );
  expect(confirmation).not.toHaveBeenCalled();
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2030-10-16T18:00');
  // The adopted window is only useful once it is actually in view.
  expect(document.activeElement).toBe(
    screen.getByLabelText('Zu sperrende Einheit'),
  );
  // A second adoption still asks exactly once and a declined confirmation
  // leaves both the draft and the open state untouched.
  confirmation.mockReturnValue(false);
  fireEvent.change(screen.getByLabelText('Sperrgrund'), {
    target: { value: 'Unsaved fictional draft' },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Zeiten übernehmen: Fictional maintenance',
    }),
  );
  expect(confirmation).toHaveBeenCalledTimes(1);
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect(
    (screen.getByLabelText('Sperrbeginn', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('2030-10-16T18:00');
});

test('the management is a native summary that Escape never closes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...overview, blocks: [] })),
  );
  await renderBlocks();
  await screen.findByLabelText('Sperrgrund');
  const summary = blockSummary();
  // Keyboard activation (Enter/Space) is the native behaviour of this element;
  // adding a second handler would fire twice in a real browser.
  expect(summary.localName).toBe('summary');
  expect(summary.parentElement).toBe(blockDetails());
  expect(summary.getAttribute('tabindex')).toBeNull();
  fireEvent.keyDown(summary, { key: 'Escape' });
  expect(blockDetails().hasAttribute('open')).toBe(true);
  expect(screen.getByLabelText('Sperrgrund')).toBeTruthy();
});

test('opening the management does not steal focus', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...overview, blocks: [] })),
  );
  render(<ResourceBlocks csrfToken="csrf" />);
  const refresh = screen.getByRole('button', { name: 'Sperren aktualisieren' });
  // The refresh control is disabled while the list loads; focus it once the
  // initial read has settled, then open the management from the keyboard state.
  await waitFor(() =>
    expect((refresh as HTMLButtonElement).disabled).toBe(false),
  );
  refresh.focus();
  openBlocks();
  await screen.findByLabelText('Sperrgrund');
  expect(document.activeElement).toBe(refresh);
});

test('opening and closing the management never reloads the list', async () => {
  const fetcher = vi.fn(async (...call: unknown[]) => {
    void call;
    return Response.json({ ...overview, blocks: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  await renderBlocks();
  await screen.findByLabelText('Sperrgrund');
  const reads = () =>
    fetcher.mock.calls.filter(([, options]) => !options).length;
  const before = reads();
  closeBlocks();
  openBlocks();
  closeBlocks();
  openBlocks();
  expect(reads()).toBe(before);
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(0);
});

test('an open management survives resource filters and the editor dialog', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === '/api/v1/resources'
        ? Response.json([resourceRow])
        : Response.json({ ...overview, blocks: [] }),
    ),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText(/Synthetic box/);
  await screen.findByText(/^Sperrverwaltung öffnen$/);
  openBlocks();
  await screen.findByLabelText('Sperrgrund');
  fireEvent.change(screen.getByLabelText('Ressourcen suchen'), {
    target: { value: 'nothing matches' },
  });
  expect(screen.getByLabelText('Sperrgrund')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ressource anlegen' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Ressource anlegen',
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Ressource abbrechen' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText('Sperrgrund')).toBeTruthy();
  expect(blockSummary().textContent).toBe('Sperrverwaltung schließen');
});

test('a failed block load stays visible without an offer to open anything', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ invalid: 'synthetic' })),
  );
  render(<ResourceBlocks csrfToken="csrf" />);
  await screen.findByText('Sperren konnten nicht geladen werden.');
  // Nothing loaded means nothing to disclose: the error and the refresh
  // control stay the only offered steps, and no empty form is mounted.
  expect(screen.queryByText(/^Sperrverwaltung (öffnen|schließen)$/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Sperren aktualisieren' }),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Sperrgrund')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Zeitraum sperren' })).toBeNull();
  expect(
    screen.getByText('Sperren konnten nicht geladen werden.'),
  ).toBeTruthy();
});

test('the empty block list is announced inside the opened management only', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...overview, blocks: [] })),
  );
  await renderBlocks();
  await screen.findByText('Noch keine zeitweisen Sperren.');
  closeBlocks();
  expect(screen.queryByText('Noch keine zeitweisen Sperren.')).toBeNull();
});
