import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { afterEach, expect, test, vi } from 'vitest';
import { clickLink } from '../helpers/click-link.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
import { Navigation } from '../../apps/admin/src/Navigation.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
function returnToApp() {
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
}
function listLoads(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(
    ([url, options]) =>
      String(url).startsWith('/api/v1/events') && options === undefined,
  ).length;
}
const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic event',
  status: 'inquiry',
  eventDate: null,
  startsAt: null,
  endsAt: null,
  timeZone: 'Europe/Berlin',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue: null as string | null,
  venueOverride: false,
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  description: '',
  notesHtml: '<strong>Fictional</strong>',
};
function mocker(errors: string[] = [], supplied: Record<string, unknown> = {}) {
  let rows = [{ ...row, ...supplied }];
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      if (errors.length)
        return Response.json({ error: errors.shift() }, { status: 409 });
      rows = [{ ...row, ...supplied, ...JSON.parse(String(options.body)) }];
      return Response.json(rows[0]);
    }
    if (url.startsWith('/api/v1/events'))
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: rows,
        // BKP007.2: the counters travel with the list as a server aggregate.
        filterCounts: {
          undated: rows.filter((entry) => !entry.eventDate).length,
          inquiries: rows.filter((entry) => entry.status === 'inquiry').length,
        },
      });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'cancelled', label: 'Annulliert' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    return Response.json([
      { id: 'fictional-option', name: 'Synthetic choice', state: 'active' },
    ]);
  });
}
// BKP014.1: every row is a card with one open action, so a test waits for the
// row's link instead of the former flat name–date–status string.
async function findRow(name: string | RegExp = /Synthetic event/) {
  const links = await screen.findAllByRole('link', { name });
  return links[0]!;
}

function showForms() {
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
}
test('events create without date, retain formatted notes and edit/cancel with version checks', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic new event' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await findRow(/Synthetic new event/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic new event',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Event abbrechen' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic new event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Eventstatus'), {
    target: { value: 'cancelled' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-07-01' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-07-01T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-07-02T01:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  // H037/BKP014.1: the card names the real start and end time in its meta
  // line instead of only the date. A newly dated row moves into its month
  // group, so the card is queried again after the refresh.
  await vi.waitFor(() => {
    const timed = screen.getByRole('link', { name: /Synthetic new event/ });
    expect(timed.querySelector('.event-time')?.textContent).toBe(
      '18:00–01:00 Uhr',
    );
    expect(timed.querySelector('.event-date-day')?.textContent).toBe('1');
    expect(timed.querySelector('.event-date-label')?.textContent).toBe(
      'Mi / Jul',
    );
  });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/synthetic',
    expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('2026-07-01T16:00:00Z'),
    }),
  );
});
test('events show invalid dates, conflicts, server and transport failures while retaining draft', async () => {
  const fetcher = mocker([
    'conflict',
    'invalid_reference',
    'reservations_need_review',
    'import_review_required',
  ]);
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-03-29T02:30' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Termin prüfen/);
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '' },
  });
  for (const message of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /gemeinsam geprüft/,
    /Ungeprüfte Bestandszusagen zuerst/,
  ]) {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
    );
    await screen.findByText(message);
  }
  fetcher.mockRejectedValue(Error('offline'));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Verbindung fehlgeschlagen/);
  returnToApp();
  await screen.findByText(/Events konnten nicht geladen/);
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await screen.findByText(/Events konnten nicht geladen/);
});
test('duplicating an event creates a new inquiry and does not update its source', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event duplizieren: Synthetic event',
    }),
  );
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic event (Kopie)',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await findRow(/Synthetic event \(Kopie\)/);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Synthetic event (Kopie)'),
    }),
  );
});

test('event copies retain active references and require new choices for archived records', async () => {
  const fetcher = mocker([], {
    status: 'cancelled',
    eventTypeId: 'fictional-option',
    packageId: 'archived-option',
    locationId: 'fictional-option',
    primaryContactId: 'archived-option',
    additionalContactIds: ['fictional-option', 'archived-option'],
    eventDate: '2026-07-01',
    startsAt: '2026-07-01T16:00:00.123Z',
    endsAt: '2026-07-01T18:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event duplizieren: Synthetic event',
    }),
  );
  expect(
    (screen.getByLabelText('Eventstatus') as HTMLSelectElement).value,
  ).toBe('inquiry');
  expect(
    (screen.getByLabelText('Fotobox-Paket') as HTMLSelectElement).value,
  ).toBe('');
  expect((screen.getByLabelText('Eventart') as HTMLSelectElement).value).toBe(
    'fictional-option',
  );
  expect((screen.getByLabelText('Eventbeginn') as HTMLInputElement).value).toBe(
    '2026-07-01T18:00:00.123',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await findRow(/Synthetic event \(Kopie\)/);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('2026-07-01T16:00:00.123Z'),
    }),
  );
});

test('event filters restore URL values, combine and clear filters, and show empty results', async () => {
  window.history.replaceState(
    null,
    '',
    '/?q=Synthetic&status=inquiry&other=keep',
  );
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
  fireEvent.change(screen.getByLabelText('Filter von'), {
    target: { value: '2026-07-01' },
  });
  fireEvent.change(screen.getByLabelText('Filter bis'), {
    target: { value: '2026-07-31' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Events filtern' }).closest('form')!,
  );
  expect(window.location.search).toContain('from=2026-07-01');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events?q=Synthetic&from=2026-07-01&to=2026-07-31&status=inquiry',
  );
  // H041: the undated switch is the sort choice; it replaces the old checkbox
  // and keeps the same `undated=true` URL meaning.
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Sortieren' })).getByRole(
      'radio',
      {
        name: /^Ohne Datum/,
      },
    ),
  );
  expect(window.location.search).toContain('undated=true');
  expect(window.location.search).not.toContain('from=');
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventfilter zurücksetzen' }),
  );
  expect(window.location.search).toBe('?other=keep');
  fetcher.mockImplementation(async (url: string) =>
    url.startsWith('/api/v1/events')
      ? Response.json({ timeZone: 'Europe/Berlin', events: [] })
      : Response.json([]),
  );
  await vi.waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Events' }).getAttribute('aria-busy'),
    ).toBe('false'),
  );
  returnToApp();
  await screen.findByText('Keine Events gefunden.');
});

test('older event search responses and failures cannot overwrite a newer result', async () => {
  for (const fail of [false, true]) {
    let resolveOld!: (response: Response) => void,
      rejectOld!: (error: Error) => void;
    const old = new Promise<Response>((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/events') return old;
        if (url.startsWith('/api/v1/events?'))
          return Response.json({
            timeZone: 'Europe/Berlin',
            events: [{ ...row, name: 'Synthetic fresh' }],
          });
        return Response.json([]);
      }),
    );
    render(<EventPanel csrfToken="csrf" />);
    fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
    act(() => updateUrlSearch({ q: 'fresh' }));
    await findRow(/Synthetic fresh/);
    await act(async () => {
      if (fail) rejectOld(Error('stale offline'));
      else
        resolveOld(Response.json({ timeZone: 'Europe/Berlin', events: [row] }));
    });
    expect(screen.queryByRole('link', { name: /Synthetic event/ })).toBeNull();
    expect(screen.queryByText(/Events konnten nicht geladen/)).toBeNull();
    cleanup();
    window.history.replaceState(null, '', '/');
  }
});

test('a completed import refreshes visible events without discarding an unfinished draft', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  const view = render(<EventPanel csrfToken="fictional" revision={0} />);
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname', { exact: true }), {
    target: { value: 'Fictional retained draft' },
  });
  const count = fetcher.mock.calls.filter(
    ([url]) => url === '/api/v1/events',
  ).length;
  view.rerender(<EventPanel csrfToken="fictional" revision={1} />);
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => url === '/api/v1/events').length,
    ).toBe(count + 1),
  );
  expect(
    (screen.getByLabelText('Eventname', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('Fictional retained draft');
});

test('opens a compact create dialog without disturbing the grouped list', async () => {
  vi.stubGlobal('fetch', mocker([], { eventDate: '2026-10-24' }));
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByRole('heading', { name: /Oktober 2026/ });
  expect(screen.queryByRole('dialog')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'Event anlegen' });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  expect(within(dialog).getByLabelText('Eventdatum')).toBeTruthy();
  expect(within(dialog).getByLabelText('Kunde suchen')).toBeTruthy();
  expect(within(dialog).getByLabelText('Eventart')).toBeTruthy();
  expect(within(dialog).queryByLabelText('Eventbeginn')).toBeTruthy();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Dialog schließen' }),
  );
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole('heading', { name: /Oktober 2026/ })).toBeTruthy();
});

test('groups multiple events in the same month and keeps undated events separate', async () => {
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/v1/events'
        ? Response.json({
            timeZone: 'Europe/Berlin',
            events: [
              { ...row, id: 'fictional-oct-a', eventDate: '2026-10-24' },
              { ...row, id: 'fictional-oct-b', eventDate: '2026-10-31' },
              { ...row, id: 'fictional-nov', eventDate: '2026-11-05' },
              { ...row, id: 'fictional-undated' },
            ],
          })
        : base(url),
    ),
  );
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByRole('heading', { name: 'Oktober 2026 · 2 Events' });
  expect(
    screen.getByRole('heading', { name: 'November 2026 · 1 Event' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: 'Ohne Datum · 1 Event' }),
  ).toBeTruthy();
});

test('direct record links hide list controls and an unknown link never keeps an unrelated record open', async () => {
  window.history.replaceState(null, '', '/#event-synthetic');
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/v1/events/synthetic'
        ? Response.json({
            event: row,
            contacts: [],
            location: null,
            eventType: null,
            package: null,
            activities: [],
          })
        : base(url),
    ),
  );
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  expect(screen.queryByRole('button', { name: 'Event anlegen' })).toBeNull();
  window.history.replaceState(null, '', '/#event-unlisted');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(
    screen.queryByRole('heading', { name: 'Event: Synthetic event' }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Event anlegen' })).toBeTruthy();
});

test('opening, closing and editing a record returns to the correct list and editor controls', async () => {
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/v1/events/synthetic'
        ? Response.json({
            event: row,
            contacts: [],
            location: null,
            eventType: null,
            package: null,
            activities: [],
          })
        : base(url),
    ),
  );
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('link', {
      name: /Synthetic event/,
    }),
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details schließen' }),
  );
  await vi.waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Event: Synthetic event' }),
    ).toBeNull(),
  );
  const open = screen.getByRole('link', {
    name: /Synthetic event/,
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(open));
  fireEvent.click(open);
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  const detailEdit = screen.getByRole('button', {
    name: 'Stammdaten bearbeiten: Synthetic event',
  });
  expect(detailEdit.getAttribute('title')).toBe('Event bearbeiten');
  expect(detailEdit.textContent).toBe('');
  fireEvent.click(detailEdit);
  expect(
    screen.queryByRole('heading', { name: 'Event: Synthetic event' }),
  ).toBeNull();
  expect(screen.getByLabelText('Eventname').closest('details')!.open).toBe(
    true,
  );
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic event',
  );
});

test('event rows are direct links and their icon actions stay independent', async () => {
  window.history.replaceState(null, '', '/#events');
  let detailCalls = 0;
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/events/synthetic') {
        detailCalls += 1;
        return Response.json({
          event: row,
          contacts: [],
          location: null,
          eventType: null,
          package: null,
          activities: [],
        });
      }
      return base(url);
    }),
  );
  render(<EventPanel csrfToken="csrf" />);
  const link = await screen.findByRole('link', {
    name: /Synthetic event/,
  });
  expect(link.getAttribute('href')).toBe('#event-synthetic');
  expect(link.textContent).toContain('Synthetic event');
  expect(link.querySelector('a,button')).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Eventakte öffnen: Synthetic event',
    }),
  ).toBeNull();
  for (const [name, title] of [
    ['Event anlegen', 'Event anlegen'],
    ['Event bearbeiten: Synthetic event', 'Event bearbeiten'],
    ['Event duplizieren: Synthetic event', 'Event duplizieren'],
  ] as const) {
    const action = screen.getByRole('button', { name });
    expect(action.getAttribute('title')).toBe(title);
    expect(action.textContent).toBe('');
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Event bearbeiten: Synthetic event' }),
  );
  expect(window.location.hash).toBe('#events');
  expect(
    screen.queryByRole('heading', { name: 'Event: Synthetic event' }),
  ).toBeNull();
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic event',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Event abbrechen' }));
  for (const init of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    expect(clickLink(link, 1, init)).toBe(false);
    expect(window.location.hash).toBe('#events');
    expect(detailCalls).toBe(0);
  }
  const selection = vi
    .spyOn(window, 'getSelection')
    .mockReturnValue({ toString: () => 'Synthetic' } as Selection);
  expect(clickLink(link)).toBe(true);
  selection.mockRestore();
  expect(window.location.hash).toBe('#events');
  expect(detailCalls).toBe(0);
  // detail 0 is the keyboard activation shape; Chromium uses a real Enter in E2E.
  expect(clickLink(link, 0)).toBe(false);
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  expect(detailCalls).toBe(1);
});

test('global search submitted from an open event record closes the record and shows results', async () => {
  window.history.replaceState(null, '', '/#event-synthetic');
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/v1/events/synthetic'
        ? Response.json({
            event: row,
            contacts: [],
            location: null,
            eventType: null,
            package: null,
            activities: [],
          })
        : base(url),
    ),
  );
  render(
    <>
      <Navigation />
      <EventPanel csrfToken="csrf" />
    </>,
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  fireEvent.click(screen.getByRole('button', { name: 'Suche öffnen' }));
  fireEvent.change(screen.getByLabelText('Globale Suche'), {
    target: { value: 'Synthetic global query' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Events und Kontakte suchen' })
      .closest('form')!,
  );
  await vi.waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Event: Synthetic event' }),
    ).toBeNull(),
  );
  expect(window.location.hash).toBe('#search');
  expect(window.location.search).toContain('q=Synthetic+global+query');
  expect(
    screen.getByRole('link', {
      name: /Synthetic event/,
    }),
  ).toBeTruthy();
});

function savedBody(fetcher: ReturnType<typeof mocker>) {
  const call = fetcher.mock.calls.find(([, options]) => options);
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<
    string,
    unknown
  >;
}

test('moving an event time from summer to winter resolves the new local time without the old offset', async () => {
  const fetcher = mocker([], {
    eventDate: '2026-07-01',
    startsAt: '2026-07-01T16:00:00Z',
    endsAt: '2026-07-01T18:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  expect(screen.queryByLabelText(/UTC-Versatz/)).toBeNull();
  expect((screen.getByLabelText('Eventbeginn') as HTMLInputElement).value).toBe(
    '2026-07-01T18:00',
  );
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-10-26' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-10-26T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-10-27T01:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved.startsAt).toBe('2026-10-26T17:00:00Z');
  expect(saved.endsAt).toBe('2026-10-27T00:00:00Z');
  expect(saved.eventDate).toBe('2026-10-26');
});

test('moving an event time from winter to summer resolves the new local time without the old offset', async () => {
  const fetcher = mocker([], {
    eventDate: '2026-01-15',
    startsAt: '2026-01-15T17:00:00Z',
    endsAt: '2026-01-15T19:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-07-01' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-07-01T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-07-02T01:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved.startsAt).toBe('2026-07-01T16:00:00Z');
  expect(saved.endsAt).toBe('2026-07-01T23:00:00Z');
});

test('a repeated fall-back hour offers both daylight and standard time choices', async () => {
  for (const [choice, expected] of [
    ['earlier', '2026-10-25T00:30:00Z'],
    ['later', '2026-10-25T01:30:00Z'],
  ] as const) {
    const fetcher = mocker();
    vi.stubGlobal('fetch', fetcher);
    render(<EventPanel csrfToken="csrf" />);
    showForms();
    await findRow();
    fireEvent.change(screen.getByLabelText('Eventdatum'), {
      target: { value: '2026-10-25' },
    });
    fireEvent.change(screen.getByLabelText('Eventbeginn'), {
      target: { value: '2026-10-25T02:30' },
    });
    fireEvent.change(screen.getByLabelText('Eventende'), {
      target: { value: '2026-10-25T04:00' },
    });
    const selector = screen.getByLabelText(
      'Uhrzeitwahl Eventbeginn',
    ) as HTMLSelectElement;
    expect(selector.value).toBe('');
    expect(screen.getByRole('option', { name: 'Bitte wählen' })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'Sommerzeit (UTC+02:00)' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'Normalzeit (UTC+01:00)' }),
    ).toBeTruthy();
    fireEvent.change(selector, { target: { value: choice } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
    );
    await screen.findByText('Event gespeichert.');
    expect(savedBody(fetcher).startsAt).toBe(expected);
    cleanup();
  }
});

test('a nonexistent spring-gap time shows a field error and is never submitted', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic gap event' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-03-29' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-03-29T02:30' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-03-29T04:00' },
  });
  const start = screen.getByLabelText('Eventbeginn');
  expect(start.getAttribute('aria-invalid')).toBe('true');
  expect(start.getAttribute('aria-describedby')).toBe(
    'event-create-startsAt-error',
  );
  await screen.findByText(/existiert an diesem Tag nicht/);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Termin prüfen/);
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
});

test('an unchanged repeated hour preselects the saved offset and keeps its instant', async () => {
  const fetcher = mocker([], {
    eventDate: '2026-10-25',
    startsAt: '2026-10-25T01:30:00Z',
    endsAt: '2026-10-25T03:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  expect((screen.getByLabelText('Eventbeginn') as HTMLInputElement).value).toBe(
    '2026-10-25T02:30',
  );
  const selector = screen.getByLabelText(
    'Uhrzeitwahl Eventbeginn',
  ) as HTMLSelectElement;
  expect(selector.value).toBe('later');
  expect(screen.getByRole('option', { name: 'Bitte wählen' })).toBeTruthy();
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved.startsAt).toBe('2026-10-25T01:30:00Z');
  expect(saved.endsAt).toBe('2026-10-25T03:00:00Z');
});

test('a new repeated start hour requires an explicit choice before saving', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic ambiguous start' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-10-25' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-10-25T02:30' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-10-25T04:00' },
  });
  const selector = screen.getByLabelText(
    'Uhrzeitwahl Eventbeginn',
  ) as HTMLSelectElement;
  expect(selector.value).toBe('');
  expect(screen.getByRole('option', { name: 'Bitte wählen' })).toBeTruthy();
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/zweimal vor/);
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
  expect(document.activeElement).toBe(screen.getByLabelText('Eventbeginn'));
  fireEvent.change(selector, { target: { value: 'earlier' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher).startsAt).toBe('2026-10-25T00:30:00Z');
});

test('a repeated end hour also requires its own explicit choice', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic ambiguous end' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-10-25' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-10-25T00:30' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-10-25T02:30' },
  });
  const selector = screen.getByLabelText(
    'Uhrzeitwahl Eventende',
  ) as HTMLSelectElement;
  expect(selector.value).toBe('');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/zweimal vor/);
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
  expect(document.activeElement).toBe(screen.getByLabelText('Eventende'));
  fireEvent.change(selector, { target: { value: 'later' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved.startsAt).toBe('2026-10-24T22:30:00Z');
  expect(saved.endsAt).toBe('2026-10-25T01:30:00Z');
});

test('a spring gap in the end time is reported on the end field and blocks saving', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic gap end' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-03-29' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-03-29T01:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-03-29T02:30' },
  });
  const end = screen.getByLabelText('Eventende');
  expect(end.getAttribute('aria-invalid')).toBe('true');
  expect(end.getAttribute('aria-describedby')).toBe(
    'event-create-endsAt-error',
  );
  await screen.findByText(/existiert an diesem Tag nicht/);
  expect(
    screen.getByLabelText('Eventbeginn').getAttribute('aria-invalid'),
  ).toBe('false');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Termin prüfen/);
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
  expect(document.activeElement).toBe(end);
});

test('duplicating a saved repeated hour keeps the original instant unless changed', async () => {
  const fetcher = mocker([], {
    eventDate: '2026-10-25',
    startsAt: '2026-10-25T00:30:00.123Z',
    endsAt: '2026-10-25T01:30:00.500Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event duplizieren: Synthetic event',
    }),
  );
  expect(
    (screen.getByLabelText('Uhrzeitwahl Eventbeginn') as HTMLSelectElement)
      .value,
  ).toBe('earlier');
  expect(
    (screen.getByLabelText('Uhrzeitwahl Eventende') as HTMLSelectElement).value,
  ).toBe('later');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved.name).toBe('Synthetic event (Kopie)');
  expect(saved.startsAt).toBe('2026-10-25T00:30:00.123Z');
  expect(saved.endsAt).toBe('2026-10-25T01:30:00.500Z');
});

test('changing a saved repeated hour back into the repeated range requires a new choice', async () => {
  const fetcher = mocker([], {
    eventDate: '2026-10-25',
    startsAt: '2026-10-25T01:30:00Z',
    endsAt: '2026-10-25T03:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  expect(
    (screen.getByLabelText('Uhrzeitwahl Eventbeginn') as HTMLSelectElement)
      .value,
  ).toBe('later');
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-10-25T02:45' },
  });
  expect(
    (screen.getByLabelText('Uhrzeitwahl Eventbeginn') as HTMLSelectElement)
      .value,
  ).toBe('');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/zweimal vor/);
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
});

test('changing the saved offset of a repeated hour is an explicit, honoured choice', async () => {
  const fetcher = mocker([], {
    eventDate: '2026-10-25',
    startsAt: '2026-10-25T01:30:00Z',
    endsAt: '2026-10-25T03:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Uhrzeitwahl Eventbeginn'), {
    target: { value: 'earlier' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher).startsAt).toBe('2026-10-25T00:30:00Z');
});

test('a confirmed save closes the editor and survives a failed list reload', async () => {
  let listLoads = 0,
    failReload = true,
    mutations = 0;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      mutations += 1;
      return Response.json({
        ...row,
        ...JSON.parse(String(options.body)),
        version: 2,
      });
    }
    if (url.startsWith('/api/v1/events')) {
      listLoads += 1;
      if (listLoads > 1 && failReload)
        return new Response(null, { status: 503 });
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: [
          {
            ...row,
            name: listLoads > 1 ? 'Synthetic reloaded event' : row.name,
          },
        ],
      });
    }
    if (url === '/api/v1/statuses')
      return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic saved event' },
  });
  const form = screen
    .getByRole('button', { name: 'Event speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText('Event gespeichert.');
  await screen.findByText(/Liste konnte nicht neu geladen werden/);
  expect(mutations).toBe(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  failReload = false;
  fireEvent.click(screen.getByRole('button', { name: 'Events erneut laden' }));
  await findRow(/Synthetic reloaded event/);
  expect(
    screen.queryByText(/Liste konnte nicht neu geladen werden/),
  ).toBeNull();
  expect(mutations).toBe(1);
});

test('the normal editor keeps advanced values in Weitere Angaben and preserves them', async () => {
  const fetcher = mocker([], {
    eventTypeId: 'fictional-option',
    packageId: 'fictional-option',
    locationId: 'fictional-option',
    primaryContactId: 'fictional-option',
    source: 'Synthetic source',
    description: 'Synthetic description',
    notesHtml: '<strong>Fictional</strong>',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  const advanced = screen
    .getByText('Weitere Angaben', { exact: true })
    .closest('details')!;
  expect(advanced.open).toBe(false);
  expect(screen.getByLabelText('Eventname')).toBeTruthy();
  expect(screen.getByLabelText('Eventstatus')).toBeTruthy();
  // BKP012.2: the main contact is a labelled search group, not a full list.
  expect(screen.getByRole('group', { name: 'Hauptkontakt' })).toBeTruthy();
  expect(screen.getByLabelText('Kunde suchen')).toBeTruthy();
  expect(screen.getByLabelText('Eventdatum')).toBeTruthy();
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  expect(advanced.open).toBe(true);
  expect((screen.getByLabelText('Eventart') as HTMLSelectElement).value).toBe(
    'fictional-option',
  );
  expect(
    (screen.getByLabelText('Fotobox-Paket') as HTMLSelectElement).value,
  ).toBe('fictional-option');
  expect(
    (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
  ).toBe('Synthetic choice');
  expect(
    (screen.getByLabelText('Anfragequelle') as HTMLInputElement).value,
  ).toBe('Synthetic source');
  expect(
    (screen.getByLabelText('Eventbeschreibung') as HTMLTextAreaElement).value,
  ).toBe('Synthetic description');
  expect(
    (screen.getByLabelText('Interne Notizen') as HTMLTextAreaElement).value,
  ).toBe('<strong>Fictional</strong>');
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic edited name' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved).toMatchObject({
    name: 'Synthetic edited name',
    eventTypeId: 'fictional-option',
    packageId: 'fictional-option',
    locationId: 'fictional-option',
    primaryContactId: 'fictional-option',
    source: 'Synthetic source',
    description: 'Synthetic description',
    notesHtml: '<strong>Fictional</strong>',
  });
  // The prefilled legacy place is displayed, never promoted by an unrelated
  // edit, and no location master data is written.
  expect(saved).not.toHaveProperty('venue');
  expect(saved).not.toHaveProperty('venueOverride');
  expect(
    fetcher.mock.calls
      .filter(([, options]) => options)
      .map(([url]) => String(url))
      .filter((url) => url.includes('/locations')),
  ).toEqual([]);
});

test('the business date is derived from the local start across midnight and the DST day', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic midnight event' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-10-24T23:30' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-10-26T04:00' },
  });
  expect((screen.getByLabelText('Eventdatum') as HTMLInputElement).value).toBe(
    '2026-10-24',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher).eventDate).toBe('2026-10-24');
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic DST event' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-03-29T01:30' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-03-29T04:00' },
  });
  expect((screen.getByLabelText('Eventdatum') as HTMLInputElement).value).toBe(
    '2026-03-29',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const mutations = fetcher.mock.calls.filter(([, options]) => options);
  expect(mutations).toHaveLength(2);
  expect(JSON.parse(String(mutations[1]![1]!.body)).eventDate).toBe(
    '2026-03-29',
  );
});

test('partial and reversed times keep the draft and explain the affected field', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic invalid schedule' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-10-26T02:30' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Bitte auch das Ende angeben.');
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
  expect(document.activeElement).toBe(screen.getByLabelText('Eventende'));
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-10-26T01:30' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Das Ende muss nach dem Beginn liegen.');
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-10-26T04:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Bitte auch den Beginn angeben.');
  expect(fetcher.mock.calls.some(([, options]) => options)).toBe(false);
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic invalid schedule',
  );
});

test('the main contact is excluded from further contacts and changing it clears the overlap', async () => {
  const contacts = [
    { id: 'contact-main', name: 'Synthetic main', state: 'active' },
    { id: 'contact-extra', name: 'Synthetic extra', state: 'active' },
  ];
  let rows = [{ ...row }];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      rows = [{ ...row, ...JSON.parse(String(options.body)) }];
      return Response.json(rows[0]);
    }
    if (url.startsWith('/api/v1/events'))
      return Response.json({ timeZone: 'Europe/Berlin', events: rows });
    if (url === '/api/v1/statuses')
      return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
    if (url.startsWith('/api/v1/contacts')) return Response.json(contacts);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic contact event' },
  });
  // BKP012.1: the create dialog searches instead of listing every contact; the
  // exclusion rule between main and further contacts stays exactly the same.
  const search = screen.getByLabelText('Kunde suchen');
  fireEvent.change(search, { target: { value: 'Synthetic main' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Synthetic main/ }),
  );
  const additional = screen.getByLabelText(
    'Weitere Kontakte',
  ) as HTMLSelectElement;
  expect(
    within(additional).queryByRole('option', { name: 'Synthetic main' }),
  ).toBeNull();
  fireEvent.change(additional, { target: { value: 'contact-extra' } });
  expect(additional.value).toBe('contact-extra');
  fireEvent.change(search, { target: { value: 'Synthetic extra' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Synthetic extra/ }),
  );
  expect(additional.value).toBe('');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    primaryContactId: 'contact-extra',
    additionalContactIds: [],
  });
});

test('a stored duplicate between main and further contacts is normalised instead of trapping the save', async () => {
  const fetcher = mocker([], {
    primaryContactId: 'fictional-option',
    additionalContactIds: ['fictional-option'],
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  const additional = screen.getByLabelText(
    'Weitere Kontakte',
  ) as HTMLSelectElement;
  expect(
    within(additional).queryByRole('option', { name: 'Synthetic choice' }),
  ).toBeNull();
  expect(additional.value).toBe('');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    primaryContactId: 'fictional-option',
    additionalContactIds: [],
  });
});

test('editing a booked event keeps its status unchanged', async () => {
  const fetcher = mocker([], { status: 'booked' });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  const status = screen.getByLabelText('Eventstatus') as HTMLSelectElement;
  expect(status.value).toBe('booked');
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic booked rename' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    name: 'Synthetic booked rename',
    status: 'booked',
  });
});

test('a start makes the business date read-only and derived while date-only and undated events stay possible', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  const date = () => screen.getByLabelText('Eventdatum') as HTMLInputElement;
  expect(date().readOnly).toBe(false);
  expect(
    screen.getByText(/Ohne Datum bleibt das Event undatiert/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic date only' },
  });
  fireEvent.change(date(), { target: { value: '2026-12-24' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    eventDate: '2026-12-24',
    startsAt: null,
    endsAt: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic undated event' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const mutations = fetcher.mock.calls.filter(([, options]) => options);
  expect(mutations).toHaveLength(2);
  expect(JSON.parse(String(mutations[1]![1]!.body)).eventDate).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic scheduled event' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-12-31T23:30' },
  });
  expect(date().readOnly).toBe(true);
  expect(date().value).toBe('2026-12-31');
  expect(date().getAttribute('aria-describedby')).toBe(
    'event-create-date-help',
  );
  expect(
    screen.getByText(/Wird aus dem Beginn übernommen.*Beginn ändern/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2027-01-01T00:30' },
  });
  expect(date().value).toBe('2027-01-01');
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '' },
  });
  expect(date().readOnly).toBe(false);
  expect(
    screen.getByText(/Ohne Datum bleibt das Event undatiert/),
  ).toBeTruthy();
});

test('duplicating an event preserves every advanced value for editing', async () => {
  const fetcher = mocker([], {
    eventTypeId: 'fictional-option',
    packageId: 'fictional-option',
    locationId: 'fictional-option',
    primaryContactId: 'fictional-option',
    additionalContactIds: ['fictional-option'],
    source: 'Synthetic source',
    description: 'Synthetic description',
    notesHtml: '<strong>Fictional</strong>',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event duplizieren: Synthetic event',
    }),
  );
  const advanced = screen
    .getByText('Weitere Angaben', { exact: true })
    .closest('details')!;
  expect(advanced.open).toBe(false);
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic event (Kopie)',
  );
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  expect(advanced.open).toBe(true);
  expect((screen.getByLabelText('Eventart') as HTMLSelectElement).value).toBe(
    'fictional-option',
  );
  expect(
    (screen.getByLabelText('Fotobox-Paket') as HTMLSelectElement).value,
  ).toBe('fictional-option');
  expect(
    (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
  ).toBe('Synthetic choice');
  expect(
    (screen.getByLabelText('Anfragequelle') as HTMLInputElement).value,
  ).toBe('Synthetic source');
  expect(
    (screen.getByLabelText('Eventbeschreibung') as HTMLTextAreaElement).value,
  ).toBe('Synthetic description');
  expect(
    (screen.getByLabelText('Interne Notizen') as HTMLTextAreaElement).value,
  ).toBe('<strong>Fictional</strong>');
  expect(
    (screen.getByLabelText('Weitere Kontakte') as HTMLSelectElement).value,
  ).toBe('');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    name: 'Synthetic event (Kopie)',
    eventTypeId: 'fictional-option',
    packageId: 'fictional-option',
    locationId: 'fictional-option',
    primaryContactId: 'fictional-option',
    additionalContactIds: [],
    source: 'Synthetic source',
    description: 'Synthetic description',
    notesHtml: '<strong>Fictional</strong>',
  });
});

test('clearing a free-form place sends an explicit empty value without resurrection', async () => {
  const fetcher = mocker([], {
    locationId: 'fictional-option',
    venue: 'Fictional Hall',
    venueOverride: true,
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  const field = screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement;
  expect(field.value).toBe('Fictional Hall');
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    venue: '',
    venueOverride: true,
    locationId: 'fictional-option',
  });
});

test('editing the prefilled legacy place promotes it to a free-form value', async () => {
  const fetcher = mocker([], { locationId: 'fictional-option' });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  fireEvent.change(screen.getByLabelText('Ort / Adresse'), {
    target: { value: 'Fictional Terrace\nNebeneingang' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  expect(savedBody(fetcher)).toMatchObject({
    venue: 'Fictional Terrace\nNebeneingang',
    venueOverride: true,
    locationId: 'fictional-option',
  });
});

test('the list shows the effective place without the hidden legacy name', async () => {
  const fetcher = mocker([], {
    locationId: 'fictional-option',
    venue: 'Fictional Terrace',
    venueOverride: true,
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  const summary = await findRow();
  expect(summary.textContent).toContain('Fictional Terrace');
  expect(summary.textContent).not.toContain('Synthetic choice');
});

test('an untouched free-form place keeps its raw value and resets between drafts', async () => {
  const fetcher = mocker([], {
    locationId: 'fictional-option',
    venue: null,
    venueOverride: true,
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  const field = screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement;
  expect(field.value).toBe('');
  expect(field.maxLength).toBe(1000);
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic untouched venue' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Event gespeichert.');
  const saved = savedBody(fetcher);
  expect(saved).not.toHaveProperty('venue');
  expect(saved).not.toHaveProperty('venueOverride');
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic untouched venue',
    }),
  );
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  expect(
    (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
  ).toBe('');
});

test('a successful list refresh clears a stale reload warning', async () => {
  let listFails = false;
  let rows = [{ ...row }];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      rows = [{ ...row, ...JSON.parse(String(options.body)) }];
      return Response.json(rows[0]);
    }
    if (listFails) return new Response(null, { status: 503 });
    if (url.startsWith('/api/v1/events'))
      return Response.json({ timeZone: 'Europe/Berlin', events: rows });
    if (url === '/api/v1/statuses')
      return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  listFails = true;
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic saved event' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Liste konnte nicht neu geladen werden/);
  listFails = false;
  fireEvent(window, new Event('blur'));
  returnToApp();
  await findRow(/Synthetic saved event/);
  expect(
    screen.queryByText(/Liste konnte nicht neu geladen werden/),
  ).toBeNull();
});

test('a confirmed resource save stays visible in the list when the parent refresh fails', async () => {
  let listFails = false,
    puts = 0,
    availability = 0;
  const unit = {
    unitId: 'synthetic-unit',
    resourceId: 'synthetic-resource',
    name: 'Synthetic box',
    code: 'SYNTH-1',
    category: 'Fotobox',
    ordinal: 1,
    selected: false,
    periodSource: 'event',
    baseStart: row.startsAt,
    baseEnd: row.endsAt,
    beforeDays: 0,
    afterDays: 0,
    startsAt: null,
    endsAt: null,
    available: true,
    reason: null,
    conflicts: [],
  };
  const base = mocker();
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      puts += 1;
      return Response.json({ ...row, ...JSON.parse(String(options.body)) });
    }
    if (url === '/api/v1/events/synthetic/availability') {
      availability += 1;
      return Response.json([unit]);
    }
    if (url === '/api/v1/events/synthetic')
      return Response.json({
        event: { ...row, version: puts > 0 ? 2 : 1, status: 'booked' },
        contacts: [],
        location: null,
        eventType: null,
        package: null,
        activities: [],
      });
    if (listFails) return new Response(null, { status: 503 });
    return base(url);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('link', {
      name: /Synthetic event/,
    }),
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  fireEvent.click(
    await screen.findByLabelText('Synthetic box · Einheit 1 zuweisen'),
  );
  await vi.waitFor(() => expect(availability).toBe(1));
  listFails = true;
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await screen.findByText('Ressourcen und Termin gespeichert.');
  await screen.findByText(/Liste konnte nicht neu geladen werden/);
  expect(puts).toBe(1);
  expect(availability).toBe(2);
  expect(screen.queryByText(/Speichern fehlgeschlagen/)).toBeNull();
});

test('the event list refreshes automatically on return without a manual control', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  await findRow();
  expect(
    screen.queryByRole('button', { name: 'Events aktualisieren' }),
  ).toBeNull();
  const before = listLoads(fetcher);
  returnToApp();
  await vi.waitFor(() => expect(listLoads(fetcher)).toBe(before + 1));
  expect(
    screen.queryByRole('button', { name: 'Events aktualisieren' }),
  ).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(listLoads(fetcher)).toBe(before + 1);
});

test('a dirty event editor survives an automatic list refresh and never confirms', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm');
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic retained edit' },
  });
  const before = listLoads(fetcher);
  returnToApp();
  await vi.waitFor(() => expect(listLoads(fetcher)).toBe(before + 1));
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic retained edit',
  );
  expect(confirm).not.toHaveBeenCalled();
});

test('a dirty create dialog keeps its values across an automatic list refresh', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm');
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  fireEvent.change(within(dialog).getByLabelText('Eventname'), {
    target: { value: 'Synthetic retained creation' },
  });
  const before = listLoads(fetcher);
  returnToApp();
  await vi.waitFor(() => expect(listLoads(fetcher)).toBe(before + 1));
  expect(
    (within(dialog).getByLabelText('Eventname') as HTMLInputElement).value,
  ).toBe('Synthetic retained creation');
  expect(confirm).not.toHaveBeenCalled();
});

test('a failed automatic list refresh keeps the prior rows and retries without mutation', async () => {
  let failList = false,
    refreshed = false,
    mutations = 0;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      mutations += 1;
      return Response.json(row);
    }
    if (url.startsWith('/api/v1/events')) {
      if (failList) return new Response(null, { status: 503 });
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: [
          refreshed ? { ...row, name: 'Synthetic refreshed event' } : row,
        ],
      });
    }
    if (url === '/api/v1/statuses')
      return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  await findRow();
  failList = true;
  returnToApp();
  await screen.findByText(/Events konnten nicht geladen werden/);
  expect(screen.getByRole('link', { name: /Synthetic event/ })).toBeTruthy();
  failList = false;
  refreshed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Events erneut laden' }));
  await findRow(/Synthetic refreshed event/);
  expect(mutations).toBe(0);
});

test('a cancelled editor is refreshed automatically on the next return', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic cancelled edit' },
  });
  const before = listLoads(fetcher);
  returnToApp();
  await vi.waitFor(() => expect(listLoads(fetcher)).toBe(before + 1));
  await vi.waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Events' }).getAttribute('aria-busy'),
    ).toBe('false'),
  );
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic cancelled edit',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Event abbrechen' }));
  fireEvent(window, new Event('blur'));
  returnToApp();
  await vi.waitFor(() => expect(listLoads(fetcher)).toBe(before + 2));
  expect(screen.queryByLabelText('Eventname')).toBeNull();
});

test('a newer list revision loads an open event file exactly once on return', async () => {
  let listVersion = 1,
    rowName = 'Synthetic event';
  const pendingDetail: ((response: Response) => void)[] = [];
  let detailCalls = 0;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options) return Promise.resolve(Response.json(row));
    if (url === '/api/v1/events')
      return Promise.resolve(
        Response.json({
          timeZone: 'Europe/Berlin',
          events: [{ ...row, version: listVersion, name: rowName }],
        }),
      );
    if (url === '/api/v1/events/synthetic') {
      detailCalls += 1;
      return new Promise<Response>((resolve) => pendingDetail.push(resolve));
    }
    if (url === '/api/v1/statuses')
      return Promise.resolve(
        Response.json([{ code: 'inquiry', label: 'Anfrage' }]),
      );
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('link', {
      name: /Synthetic event/,
    }),
  );
  await vi.waitFor(() => expect(pendingDetail).toHaveLength(1));
  await act(async () =>
    pendingDetail[0]!(
      Response.json({
        event: { ...row, name: 'Synthetic event' },
        contacts: [],
        location: null,
        eventType: null,
        package: null,
        activities: [],
      }),
    ),
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic event' });
  listVersion = 2;
  rowName = 'Synthetic newer event';
  returnToApp();
  await vi.waitFor(() => expect(pendingDetail).toHaveLength(2));
  await act(async () =>
    pendingDetail[1]!(
      Response.json({
        event: { ...row, version: 2, name: 'Synthetic newer event' },
        contacts: [],
        location: null,
        eventType: null,
        package: null,
        activities: [],
      }),
    ),
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic newer event',
  });
  expect(detailCalls).toBe(2);
  expect(screen.queryByText(/Event-Details konnte nicht geladen/)).toBeNull();
});

test('a failed return is retried by the next return without a manual control', async () => {
  let failList = false,
    refreshed = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) return Response.json(row);
    if (url.startsWith('/api/v1/events')) {
      if (failList) return new Response(null, { status: 503 });
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: [
          refreshed ? { ...row, name: 'Synthetic another return' } : row,
        ],
      });
    }
    if (url === '/api/v1/statuses')
      return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  await findRow();
  failList = true;
  returnToApp();
  await screen.findByText(/Events konnten nicht geladen werden/);
  failList = false;
  refreshed = true;
  fireEvent(window, new Event('blur'));
  returnToApp();
  await findRow(/Synthetic another return/);
  expect(screen.queryByText(/Events konnten nicht geladen werden/)).toBeNull();
});

test('a return during a running create mutation keeps the draft and reports one save', async () => {
  let resolvePost: ((response: Response) => void) | undefined,
    posts = 0;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options) {
      posts += 1;
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    }
    if (url.startsWith('/api/v1/events'))
      return Promise.resolve(
        Response.json({ timeZone: 'Europe/Berlin', events: [row] }),
      );
    if (url === '/api/v1/statuses')
      return Promise.resolve(
        Response.json([{ code: 'inquiry', label: 'Anfrage' }]),
      );
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  fireEvent.change(within(dialog).getByLabelText('Eventname'), {
    target: { value: 'Synthetic pending create' },
  });
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Event speichern' })
      .closest('form')!,
  );
  await vi.waitFor(() => expect(posts).toBe(1));
  returnToApp();
  expect(
    (within(dialog).getByLabelText('Eventname') as HTMLInputElement).value,
  ).toBe('Synthetic pending create');
  expect(screen.queryByRole('dialog')).toBeTruthy();
  await act(async () =>
    resolvePost!(
      Response.json({ ...row, name: 'Synthetic pending create', version: 2 }),
    ),
  );
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await screen.findByText('Event gespeichert.');
  expect(posts).toBe(1);
  expect(screen.queryByText(/Speichern fehlgeschlagen/)).toBeNull();
  expect(screen.queryByText(/Verbindung fehlgeschlagen/)).toBeNull();
});

test('an already-home brand click keeps an open create dialog and its inputs', async () => {
  window.history.replaceState(null, '', '/#events');
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm');
  render(
    <>
      <Navigation />
      <EventPanel csrfToken="csrf" />
    </>,
  );
  showForms();
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  fireEvent.change(within(dialog).getByLabelText('Eventname'), {
    target: { value: 'Synthetic home draft' },
  });
  fireEvent.change(within(dialog).getByLabelText('Eventdatum'), {
    target: { value: '2026-11-20' },
  });
  const filter = screen.getByLabelText('Events suchen') as HTMLInputElement;
  fireEvent.change(filter, { target: { value: 'Synthetic filter draft' } });
  const mutations = fetcher.mock.calls.filter(([, options]) => options).length;
  expect(
    clickLink(
      within(screen.getByLabelText('Arbeitsbereiche')).getByRole('link', {
        name: 'AuftragsKompass – zur Eventübersicht',
      }),
    ),
  ).toBe(true);
  expect(window.location.hash).toBe('#events');
  expect(screen.getByRole('dialog', { name: 'Neues Event' })).toBe(dialog);
  expect(
    (within(dialog).getByLabelText('Eventname') as HTMLInputElement).value,
  ).toBe('Synthetic home draft');
  expect(
    (within(dialog).getByLabelText('Eventdatum') as HTMLInputElement).value,
  ).toBe('2026-11-20');
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic filter draft');
  expect(confirm).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(
    mutations,
  );
});

test('an already-home brand click keeps a dirty event editor unchanged', async () => {
  window.history.replaceState(null, '', '/#events');
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm');
  render(
    <>
      <Navigation />
      <EventPanel csrfToken="csrf" />
    </>,
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  const editor = screen.getByLabelText('Eventname').closest('details')!;
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic edited draft' },
  });
  expect(
    clickLink(
      within(screen.getByLabelText('Arbeitsbereiche')).getByRole('link', {
        name: 'AuftragsKompass – zur Eventübersicht',
      }),
    ),
  ).toBe(true);
  expect(window.location.hash).toBe('#events');
  expect(editor.open).toBe(true);
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic edited draft',
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(0);
});

// H041: bookitup-inspired list filters. Presets are one history entry, the
// custom range is a collapsible detail, the undated switch became a sort
// choice and the month heading names its own count.
// The browser clock and zone are pinned so every range is deterministic; the
// 2026-10-22 12:00 UTC instant is the same tenant-local day in Berlin.
function pinClock(
  instant = '2026-10-22T12:00:00.000Z',
  zone = 'Europe/Berlin',
) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  const listed = vi.fn(async (url: string) =>
    url.startsWith('/api/v1/events')
      ? Response.json({
          timeZone: zone,
          events: [{ ...row, eventDate: '2026-10-24' }],
        })
      : Response.json([]),
  );
  vi.stubGlobal('fetch', listed);
  return listed;
}
afterEach(() => vi.useRealTimers());
test('a quick date preset writes from/to in one history entry and refetches', async () => {
  const fetcher = pinClock();
  const pushes = vi.spyOn(window.history, 'pushState');
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  const before = pushes.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Dieser Monat' }));
  // Exact tenant-local month of the pinned instant, written atomically.
  const search = new URLSearchParams(window.location.search);
  expect(search.get('from')).toBe('2026-10-01');
  expect(search.get('to')).toBe('2026-10-31');
  expect(search.get('undated')).toBeNull();
  expect(pushes.mock.calls.length - before).toBe(1);
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes('from=2026-10-01'),
      ),
    ).not.toHaveLength(0),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Nächste Events' }));
  expect(window.location.search).toContain('from=2026-10-22');
  expect(window.location.search).not.toContain('to=');
});

// The follow-up month is the next tenant-local calendar month, clamped to its
// real last day (31 -> 30), and it keeps the other filters.
test('the next month preset writes the following tenant-local month', async () => {
  const fetcher = pinClock();
  const pushes = vi.spyOn(window.history, 'pushState');
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  window.history.replaceState(
    null,
    '',
    '/?q=browser&eventTypeId=fictional-type',
  );
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Nächster Monat' })).toBeTruthy(),
  );
  const before = pushes.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  const search = new URLSearchParams(window.location.search);
  expect(search.get('from')).toBe('2026-11-01');
  expect(search.get('to')).toBe('2026-11-30');
  expect(search.get('q')).toBe('browser');
  expect(search.get('eventTypeId')).toBe('fictional-type');
  expect(search.get('undated')).toBeNull();
  expect(pushes.mock.calls.length - before).toBe(1);
  const active = screen.getByRole('button', { name: 'Nächster Monat' });
  expect(active.getAttribute('aria-pressed')).toBe('true');
  expect(active.className).toContain('date-preset-active');
  expect(
    screen
      .getByRole('button', { name: 'Dieser Monat' })
      .getAttribute('aria-pressed'),
  ).toBe('false');
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes('from=2026-11-01'),
      ),
    ).not.toHaveLength(0),
  );
});

test('the active preset is marked selected without relying on colour only', async () => {
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  expect(
    screen
      .getByRole('button', { name: 'Nächste Events' })
      .getAttribute('aria-pressed'),
  ).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Nächste Events' }));
  const active = screen.getByRole('button', { name: 'Nächste Events' });
  expect(active.getAttribute('aria-pressed')).toBe('true');
  expect(active.className).toContain('date-preset-active');
  expect(
    screen
      .getByRole('button', { name: 'Dieser Monat' })
      .getAttribute('aria-pressed'),
  ).toBe('false');
  // A custom range selects no preset (a reload enters through the URL).
  window.history.pushState(null, '', '/?from=2030-01-02&to=2030-01-03');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Nächste Events' })
        .getAttribute('aria-pressed'),
    ).toBe('false'),
  );
});

test('the custom range is a closed detail that reveals the date inputs', async () => {
  vi.stubGlobal('fetch', mocker([], { eventDate: '2031-11-09' }));
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  const detail = screen
    .getByText('Eigener Zeitraum')
    .closest('details') as HTMLDetailsElement;
  expect(detail.open).toBe(false);
  expect(screen.getByLabelText('Filter von')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter von'), {
    target: { value: '2030-05-01' },
  });
  fireEvent.change(screen.getByLabelText('Filter bis'), {
    target: { value: '2030-05-31' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Events filtern' }).closest('form')!,
  );
  expect(window.location.search).toContain('from=2030-05-01');
  expect(window.location.search).toContain('to=2030-05-31');
});

test('the sort choice replaces the undated checkbox and its explanation', async () => {
  vi.stubGlobal('fetch', mocker([], { eventDate: '2031-11-09' }));
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  expect(screen.queryByLabelText('Nur Events ohne Datum')).toBeNull();
  expect(
    screen.queryByText('Ohne Datum setzt die Datumsgrenzen zurück.'),
  ).toBeNull();
  window.history.replaceState(null, '', '/?from=2031-11-01&to=2031-11-30');
  const group = screen.getByRole('group', { name: 'Sortieren' });
  const chronological = within(group).getByRole('radio', {
    name: /Chronologisch/,
  });
  const undatedChoice = within(group).getByRole('radio', {
    name: /^Ohne Datum/,
  });
  expect((chronological as HTMLInputElement).checked).toBe(true);
  fireEvent.click(undatedChoice);
  expect(window.location.search).toContain('undated=true');
  expect(window.location.search).not.toContain('from=');
  expect(window.location.search).not.toContain('to=');
  await vi.waitFor(() =>
    expect(
      (
        within(screen.getByRole('group', { name: 'Sortieren' })).getByRole(
          'radio',
          {
            name: /^Ohne Datum/,
          },
        ) as HTMLInputElement
      ).checked,
    ).toBe(true),
  );
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Sortieren' })).getByRole(
      'radio',
      {
        name: /Chronologisch/,
      },
    ),
  );
  expect(window.location.search).not.toContain('undated=');
});

// BKP007.2: the counters are a server aggregate beside the list, not a count of
// the loaded rows. They name the undated events and inquiries that the applied
// date window keeps out of the list, and they follow q/status/type because the
// server applies those to the aggregate as well.
test('the counters show the server aggregate and follow the applied filters', async () => {
  const fetcher = mocker(),
    list = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).startsWith('/api/v1/events'))
        return Response.json(
          new URLSearchParams(String(url).split('?')[1] ?? '').get('q')
            ? {
                timeZone: 'Europe/Berlin',
                events: [],
                filterCounts: { undated: 0, inquiries: 0 },
              }
            : {
                timeZone: 'Europe/Berlin',
                events: [
                  { ...row, id: 'fictional-undated-a' },
                  { ...row, id: 'fictional-undated-b' },
                  { ...row, id: 'fictional-dated', eventDate: '2031-11-09' },
                  {
                    ...row,
                    id: 'fictional-booked',
                    status: 'booked',
                    eventDate: '2031-11-10',
                  },
                ],
                // Three inquiries and two undated events in the tenant: one
                // inquiry is in December, outside every loaded month group.
                filterCounts: { undated: 2, inquiries: 3 },
              },
        );
      return fetcher(url, options);
    });
  vi.stubGlobal('fetch', list);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await vi.waitFor(() =>
    expect(screen.queryByTestId('undated-count')).not.toBeNull(),
  );
  const undatedCount = () => screen.getByTestId('undated-count').textContent,
    inquiryCount = () => screen.getByTestId('inquiry-count').textContent,
    loads = () =>
      (list as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        ([url, options]) =>
          String(url).startsWith('/api/v1/events') && options === undefined,
      ).length;
  await vi.waitFor(() => expect(undatedCount()).toBe('2'));
  expect(inquiryCount()).toBe('3');
  const before = loads();
  fireEvent.change(screen.getByLabelText('Events suchen'), {
    target: { value: 'nothing matches' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Events filtern' }).closest('form')!,
  );
  await vi.waitFor(() => expect(undatedCount()).toBe('0'));
  window.history.replaceState(null, '', '/?q=nothing+matches');
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventfilter zurücksetzen' }),
  );
  await vi.waitFor(() => expect(undatedCount()).toBe('2'));
  expect(loads()).toBeGreaterThan(before);
  // Switching the sort to undated reloads the list; the counters still answer
  // the whole tenant instead of the shortened rows.
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Sortieren' })).getByRole(
      'radio',
      {
        name: /^Ohne Datum/,
      },
    ),
  );
  await vi.waitFor(() => expect(undatedCount()).toBe('2'));
  expect(inquiryCount()).toBe('3');
});

// The defect this slice fixes: the loaded rows of a date window cannot name the
// undated events or the inquiries outside it. The counters therefore have to
// come from the answer itself, even when they exceed every visible row.
test('the counters name what the date window keeps out of the rows', async () => {
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/v1/events'))
        return Response.json({
          timeZone: 'Europe/Berlin',
          events: [
            {
              ...row,
              id: 'fictional-window',
              status: 'booked',
              eventDate: '2026-10-24',
            },
          ],
          filterCounts: { undated: 4, inquiries: 7 },
        });
      return base(url);
    }),
  );
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await vi.waitFor(() =>
    expect(screen.getByTestId('undated-count').textContent).toBe('4'),
  );
  expect(screen.getByTestId('inquiry-count').textContent).toBe('7');
  // The single loaded row stays exactly as the server listed it.
  expect(screen.getAllByRole('link', { name: /Synthetic event/ })).toHaveLength(
    1,
  );
});

test('each month group heading names its own event count', async () => {
  const base = mocker();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/v1/events'
        ? Response.json({
            timeZone: 'Europe/Berlin',
            events: [
              { ...row, id: 'fictional-oct-a', eventDate: '2026-10-24' },
              { ...row, id: 'fictional-oct-b', eventDate: '2026-10-31' },
              { ...row, id: 'fictional-nov', eventDate: '2026-11-05' },
            ],
          })
        : base(url),
    ),
  );
  render(<EventPanel csrfToken="csrf" />);
  const october = await screen.findByRole('heading', { name: /Oktober 2026/ });
  expect(october.textContent).toContain('· 2 Events');
  expect(
    screen.getByRole('heading', { name: /November 2026/ }).textContent,
  ).toContain('· 1 Event');
  // The suffix is muted text, not a new heading or link.
  expect(october.querySelector('span')?.className).toContain(
    'event-month-count',
  );
});

test('the filter area stays inside a 320px viewport', async () => {
  vi.stubGlobal('fetch', mocker([], { eventDate: '2031-11-09' }));
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  const filters = document.querySelector('.event-filters') as HTMLElement;
  // jsdom does no layout; the contract is that no control claims a fixed
  // width and every preset row may wrap.
  const controls = Array.from(
    filters.querySelectorAll<HTMLElement>(
      '.date-presets, .date-presets button, .event-sorting label, .event-count',
    ),
  );
  expect(controls.length).toBeGreaterThan(6);
  for (const element of controls)
    expect(element.getAttribute('style') ?? '').not.toContain('width');
  expect(getComputedStyle(filters).overflowX === 'visible').toBe(true);
});

// „Anfragen“ is a quick filter, not a sort: it sets status=inquiry, keeps the
// current from/to/q/eventTypeId and stays out of the sort radio group.
test('the inquiry quick filter sets only the status and keeps the date range', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/v1/events'))
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: [
          { ...row, id: 'fictional-inquiry', eventDate: '2026-10-24' },
          {
            ...row,
            id: 'fictional-booked',
            status: 'booked',
            eventDate: '2026-10-25',
          },
        ],
        // The tenant holds one inquiry and no undated event at all.
        filterCounts: { undated: 0, inquiries: 1 },
      });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  const pushes = vi.spyOn(window.history, 'pushState');
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await vi.waitFor(() =>
    expect(screen.getByTestId('inquiry-count').textContent).toBe('1'),
  );
  // A date preset plus a search term is already active.
  window.history.replaceState(
    null,
    '',
    '/?from=2026-10-01&to=2026-10-31&q=browser&eventTypeId=fictional-type',
  );
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.waitFor(() =>
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Filterstatus',
        }) as HTMLSelectElement
      ).value,
    ).toBe(''),
  );
  const requests = screen.getByRole('button', { name: /^Anfragen/ });
  expect(requests.getAttribute('aria-pressed')).toBe('false');
  const before = pushes.mock.calls.length;
  fireEvent.click(requests);
  expect(pushes.mock.calls.length - before).toBe(1);
  const search = new URLSearchParams(window.location.search);
  expect(search.get('status')).toBe('inquiry');
  expect(search.get('from')).toBe('2026-10-01');
  expect(search.get('to')).toBe('2026-10-31');
  expect(search.get('q')).toBe('browser');
  expect(search.get('eventTypeId')).toBe('fictional-type');
  expect(search.get('undated')).toBeNull();
  await vi.waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: /^Anfragen/ })
        .getAttribute('aria-pressed'),
    ).toBe('true'),
  );
  // The counters answer the filters already applied, then follow the status.
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes('status=inquiry'),
      ),
    ).not.toHaveLength(0),
  );
  // The sort group holds only the two sort choices and hears no inquiry row.
  const sortGroup = screen.getByRole('group', { name: 'Sortieren' });
  const radios = within(sortGroup).getAllByRole('radio');
  expect(radios).toHaveLength(2);
  expect(radios.map((radio) => (radio as HTMLInputElement).name)).toEqual([
    'sort',
    'sort',
  ]);
  // The undated counter answers the applied status: no inquiry is undated.
  expect(
    radios.map((radio) => radio.closest('label')!.textContent!.trim()),
  ).toEqual(['Chronologisch', 'Ohne Datum0']);
  expect(within(sortGroup).queryByText(/Anfragen/)).toBeNull();
  expect(within(sortGroup).queryByRole('button')).toBeNull();
  // The chosen quick filter survives a reload through the URL.
  window.history.replaceState(null, '', '/?status=inquiry');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: /^Anfragen/ })
        .getAttribute('aria-pressed'),
    ).toBe('true'),
  );
});

// The quick filter also releases the status when it is already selected, and
// works on a bare URL without inventing filter keys.
test('the inquiry quick filter toggles off on a bare url', async () => {
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await vi.waitFor(() =>
    expect(screen.getByTestId('inquiry-count').textContent).toBe('1'),
  );
  expect(window.location.search).toBe('');
  fireEvent.click(screen.getByRole('button', { name: /^Anfragen/ }));
  expect(window.location.search).toBe('?status=inquiry');
  await vi.waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: /^Anfragen/ })
        .getAttribute('aria-pressed'),
    ).toBe('true'),
  );
  // Clearing the status must not leave an empty `status=` behind.
  fireEvent.click(screen.getByRole('button', { name: /^Anfragen/ }));
  expect(window.location.search).toBe('');
  expect(
    screen
      .getByRole('button', { name: /^Anfragen/ })
      .getAttribute('aria-pressed'),
  ).toBe('false');
});

// Without a loaded tenant zone no preset may guess a range; the click is inert.
test('a preset without a tenant zone neither writes nor marks anything', async () => {
  const fetcher = vi.fn(async (url: string) =>
    String(url).startsWith('/api/v1/events')
      ? Response.json({ timeZone: '', events: [row] })
      : Response.json([]),
  );
  vi.stubGlobal('fetch', fetcher);
  const pushes = vi.spyOn(window.history, 'pushState');
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await findRow();
  const before = pushes.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  expect(pushes.mock.calls.length).toBe(before);
  expect(window.location.search).toBe('');
  expect(
    screen
      .getByRole('button', { name: 'Nächster Monat' })
      .getAttribute('aria-pressed'),
  ).toBe('false');
  expect(screen.getByText('Zeitzone: Wird geladen')).toBeTruthy();
});

test('the event list carries website options with a quiet origin label and no exceptions queue', async () => {
  const websiteRow = {
    ...row,
    id: 'fictional-website',
    name: 'Fictional website option',
    status: 'option',
    source: 'Website: fotobox-bw-main (v1)',
    primaryContactId: null,
  };
  let rows = [websiteRow];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      rows = [{ ...websiteRow, ...JSON.parse(String(options.body)) }];
      return Response.json(rows[0]);
    }
    if (url === '/api/v1/events/fictional-website')
      return Response.json({
        event: websiteRow,
        contacts: [],
        location: null,
        eventType: null,
        package: null,
        activities: [],
        websiteInquiryAvailable: true,
      });
    if (url.startsWith('/api/v1/events'))
      return Response.json({ timeZone: 'Europe/Berlin', events: rows });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'option', label: 'Option' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    if (url.startsWith('/api/v1/contacts'))
      return Response.json([
        {
          id: 'fictional-contact',
          name: 'Fictional Contact',
          state: 'active',
        },
      ]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  // The exceptions inbox no longer lives under Events.
  expect(screen.queryByText(/Website-Eingänge/)).toBeNull();
  const link = await screen.findByRole('link', {
    name: /Fictional website option/,
  });
  const badge = screen.getByText('Website');
  // A quiet origin label, not a status: plain text in the row meta.
  expect(badge.getAttribute('class')).toBe('event-source-quiet');
  expect(badge.getAttribute('role')).toBeNull();
  expect(badge.closest('.event-meta')).not.toBeNull();
  expect(badge.closest('.event-title')).toBeNull();
  // A contactless option opens like every other event.
  fireEvent.click(link);
  const card = await screen.findByRole('region', { name: 'Event-Details' });
  expect(
    within(card).getByRole('heading', {
      name: 'Event: Fictional website option',
    }),
  ).toBeTruthy();
  expect(within(card).getByText('Kontakt noch offen.')).toBeTruthy();
  // Later assignment is the normal deliberate edit and keeps status/version.
  fireEvent.click(
    within(card).getByRole('button', {
      name: 'Stammdaten bearbeiten: Fictional website option',
    }),
  );
  // BKP012.2: the later assignment is a deliberate search, not a list choice.
  const editorContact = await screen.findByRole('group', {
    name: 'Hauptkontakt',
  });
  fireEvent.change(within(editorContact).getByLabelText('Kunde suchen'), {
    target: { value: 'Fictional Contact' },
  });
  fireEvent.click(
    await within(editorContact).findByRole('button', {
      name: /Fictional Contact/,
    }),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(
        ([url, options]) =>
          String(url) === '/api/v1/events/fictional-website' &&
          options !== undefined,
      ).length,
    ).toBe(1),
  );
  const write = fetcher.mock.calls.find(
    ([, options]) => options !== undefined,
  )!;
  const body = JSON.parse(String(write[1]!.body));
  expect(body).toMatchObject({
    primaryContactId: 'fictional-contact',
    status: 'option',
    version: 1,
  });
  const saved = await screen.findByRole('link', {
    name: /Fictional website option/,
  });
  expect(saved.querySelector('.event-status')?.textContent?.trim()).toBe(
    'Option',
  );
});

// BKP012.2: the event editor picks its main contact through the same search the
// create dialog uses. These helpers keep one synthetic contact store per test
// and read the editor's own form surfaces, never the page around it.
type EditorContact = {
  id: string;
  name: string;
  state: string;
  kind?: string;
  contactPerson?: string;
  city?: string;
};
const editorContactStore = [
  { id: 'contact-main', name: 'Synthetic main', state: 'active' },
  { id: 'contact-extra', name: 'Synthetic extra', state: 'active' },
];
function editorContacts({
  contacts = editorContactStore,
  supplied = {},
  contactPost,
  eventErrors = [],
}: {
  contacts?: EditorContact[];
  supplied?: Record<string, unknown>;
  contactPost?: (body: Record<string, unknown>) => Response;
  eventErrors?: string[];
} = {}) {
  let rows = [{ ...row, ...supplied }],
    searchFails = false;
  const puts: Record<string, unknown>[] = [],
    contactPosts: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/v1/contacts')) {
      if (options) {
        const body = JSON.parse(String(options.body)) as Record<
          string,
          unknown
        >;
        contactPosts.push(body);
        return (
          contactPost?.(body) ??
          Response.json({ ...body, id: 'contact-created', version: 1 })
        );
      }
      if (searchFails) return new Response(null, { status: 503 });
      const query = decodeURIComponent(
        new URL(url, 'https://synthetic.invalid').searchParams.get('q') ?? '',
      ).toLowerCase();
      return Response.json(
        contacts.filter(
          (entry) => !query || entry.name.toLowerCase().includes(query),
        ),
      );
    }
    if (options) {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      puts.push(body);
      if (eventErrors.length)
        return Response.json({ error: eventErrors.shift() }, { status: 409 });
      rows = [{ ...row, ...supplied, ...body }];
      return Response.json(rows[0]);
    }
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    if (
      url === '/api/v1/master-data/event_type' ||
      url === '/api/v1/master-data/package'
    )
      return Response.json([
        { id: 'fictional-option', name: 'Synthetic choice', state: 'active' },
      ]);
    if (url.startsWith('/api/v1/events'))
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: rows,
        filterCounts: { undated: 0, inquiries: 0 },
      });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  return {
    fetcher,
    puts,
    contactPosts,
    failSearch: () => {
      searchFails = true;
    },
  };
}
async function openEditor(name = 'Synthetic event') {
  fireEvent.click(
    await screen.findByRole('button', { name: `Event bearbeiten: ${name}` }),
  );
  return screen.getByRole('group', { name: 'Hauptkontakt' });
}
/** The picker is the only way to a stored contact: search, then choose. */
async function pickInEditor(group: HTMLElement, query: string) {
  fireEvent.change(within(group).getByLabelText('Kunde suchen'), {
    target: { value: query },
  });
  fireEvent.click(
    await within(group).findByRole('button', { name: new RegExp(query) }),
  );
}
function submitEditor() {
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
}
/** The editor holds at most one active form: the event form or the contact form. */
function activeEditorForms() {
  const details = document.querySelector('.event-editor');
  if (!details) return [];
  return Array.from(details.querySelectorAll('form')).filter(
    (form) => !form.hidden && !form.closest('[hidden]'),
  );
}

test('the editor picks the main contact through the search and keeps the whole draft', async () => {
  const store = editorContacts();
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic kept name' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2027-05-20' },
  });
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  fireEvent.change(screen.getByLabelText('Anfragequelle'), {
    target: { value: 'Synthetic source' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeschreibung'), {
    target: { value: 'Synthetic description' },
  });
  await pickInEditor(group, 'Synthetic main');
  expect(screen.getByText(/Kunde: Synthetic main/)).toBeTruthy();
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts).toHaveLength(1);
  expect(store.puts[0]).toMatchObject({
    name: 'Synthetic kept name',
    primaryContactId: 'contact-main',
    additionalContactIds: [],
    source: 'Synthetic source',
    description: 'Synthetic description',
    eventDate: '2027-05-20',
    version: 1,
  });
});

test('Enter in the editor contact search never saves the event', async () => {
  const store = editorContacts();
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic enter draft' },
  });
  const search = within(group).getByLabelText('Kunde suchen');
  fireEvent.change(search, { target: { value: 'Synthetic main' } });
  await within(group).findByRole('button', { name: /Synthetic main/ });
  // The key is swallowed: Enter belongs to the search, never to the event form.
  expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
  expect(store.puts).toHaveLength(0);
  expect(screen.queryByText('Event gespeichert.')).toBeNull();
  // The deliberate save still works with the same draft.
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts).toHaveLength(1);
});

test('promoting a further contact in the editor removes it from the further contacts', async () => {
  const store = editorContacts({
    supplied: {
      primaryContactId: 'contact-main',
      additionalContactIds: ['contact-extra'],
    },
  });
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  const additional = screen.getByLabelText(
    'Weitere Kontakte',
  ) as HTMLSelectElement;
  expect(additional.value).toBe('contact-extra');
  expect(
    within(additional).queryByRole('option', { name: 'Synthetic main' }),
  ).toBeNull();
  await pickInEditor(group, 'Synthetic extra');
  expect(additional.value).toBe('');
  expect(
    within(additional).queryByRole('option', { name: 'Synthetic extra' }),
  ).toBeNull();
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[0]).toMatchObject({
    primaryContactId: 'contact-extra',
    additionalContactIds: [],
  });
});

test('an archived main contact in the editor stays readable and is never offered again', async () => {
  const store = editorContacts({
    contacts: [
      {
        id: 'contact-old',
        name: 'Synthetic archived contact',
        state: 'archived',
      },
      { id: 'contact-live', name: 'Synthetic live contact', state: 'active' },
    ],
    supplied: { primaryContactId: 'contact-old' },
  });
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  expect(
    screen.getByText(/Synthetic archived contact \(Archiviert\/Inaktiv\)/),
  ).toBeTruthy();
  fireEvent.change(within(group).getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic' },
  });
  const archived = await within(group).findByRole('button', {
    name: /Synthetic archived contact/,
  });
  expect((archived as HTMLButtonElement).disabled).toBe(true);
  expect(
    (
      within(group).getByRole('button', {
        name: /Synthetic live contact/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  // An untouched archived assignment is sent unchanged, not silently dropped.
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[0]).toMatchObject({ primaryContactId: 'contact-old' });
});

test('aborting the inline contact form keeps the whole editor draft', async () => {
  const store = editorContacts();
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(<EventPanel csrfToken="csrf" />);
  await openEditor();
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2027-05-20' },
  });
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic kept draft' },
  });
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'fictional-option' },
  });
  fireEvent.change(screen.getByLabelText('Anfragequelle'), {
    target: { value: 'Synthetic source' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  // One form surface only: the contact form is a view inside the editor.
  expect(screen.getByRole('heading', { name: 'Kontakt anlegen' })).toBeTruthy();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(document.querySelector('.contact-dialog-inline')).not.toBeNull();
  const eventForm = screen.getByLabelText('Eventname').closest('form')!;
  expect((eventForm as HTMLFormElement).hidden).toBe(true);
  expect(activeEditorForms()).toHaveLength(1);
  const contactName = screen.getByLabelText('Name / Firma');
  fireEvent.change(contactName, {
    target: { value: 'Synthetic cancelled contact' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.keyDown(contactName, { key: 'Escape' });
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und zur Eventbearbeitung zurückkehren?',
  );
  expect(screen.getByRole('heading', { name: 'Kontakt anlegen' })).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.keyDown(contactName, { key: 'Escape' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Kunde suchen')),
  );
  // The contact detour neither lost nor changed the event draft.
  expect((eventForm as HTMLFormElement).hidden).toBe(false);
  expect(activeEditorForms()).toEqual([eventForm]);
  expect(hasUnsavedChanges()).toBe(false);
  expect((screen.getByLabelText('Eventdatum') as HTMLInputElement).value).toBe(
    '2027-05-20',
  );
  expect((screen.getByLabelText('Eventart') as HTMLSelectElement).value).toBe(
    'fictional-option',
  );
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic kept draft',
  );
  expect(
    (screen.getByLabelText('Anfragequelle') as HTMLInputElement).value,
  ).toBe('Synthetic source');
  expect(store.contactPosts).toHaveLength(0);
  expect(store.puts).toHaveLength(0);
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[0]).toMatchObject({
    name: 'Synthetic kept draft',
    eventDate: '2027-05-20',
    eventTypeId: 'fictional-option',
    source: 'Synthetic source',
    primaryContactId: null,
  });
});

test('a failed contact POST in the editor keeps the contact form, its values and the error focus', async () => {
  const store = editorContacts({
    contactPost: () => Response.json({ error: 'invalid' }, { status: 409 }),
  });
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  await pickInEditor(group, 'Synthetic main');
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic kept contact' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Kontakt speichern' }).closest('form')!,
  );
  await screen.findByText(
    'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
  );
  const alert = screen.getByRole('alert');
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic kept contact');
  expect(activeEditorForms()).toHaveLength(1);
  expect(store.contactPosts).toHaveLength(1);
  expect(store.puts).toHaveLength(0);
});

test('a confirmed contact stays selected in the editor when the following search fails', async () => {
  const store = editorContacts();
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  fireEvent.change(within(group).getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic created' },
  });
  await screen.findByText('Keine Kontakte gefunden.');
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic created contact' },
  });
  store.failSearch();
  fireEvent.submit(
    screen.getByRole('button', { name: 'Kontakt speichern' }).closest('form')!,
  );
  await screen.findByText(/Kunde: Synthetic created contact/);
  await screen.findByText(
    'Kontakte konnten nicht gesucht werden. Die bisherige Auswahl bleibt bestehen.',
  );
  expect(store.contactPosts).toHaveLength(1);
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[0]).toMatchObject({
    primaryContactId: 'contact-created',
  });
});

test('a freshly created contact stays choosable in the editor without a list reload', async () => {
  const store = editorContacts();
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  fireEvent.change(within(group).getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic created' },
  });
  await screen.findByText('Keine Kontakte gefunden.');
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic created contact' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Kontakt speichern' }).closest('form')!,
  );
  await screen.findByText(/Kunde: Synthetic created contact/);
  // The stored row becomes the main contact and is therefore not a further
  // contact; the panel list still does not contain it.
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  const additional = screen.getByLabelText(
    'Weitere Kontakte',
  ) as HTMLSelectElement;
  expect(
    within(additional).queryByRole('option', {
      name: 'Synthetic created contact',
    }),
  ).toBeNull();
  await pickInEditor(group, 'Synthetic main');
  expect(
    within(additional).getByRole('option', {
      name: 'Synthetic created contact',
    }),
  ).toBeTruthy();
  fireEvent.change(additional, { target: { value: 'contact-created' } });
  expect(additional.value).toBe('contact-created');
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[0]).toMatchObject({
    primaryContactId: 'contact-main',
    additionalContactIds: ['contact-created'],
  });
});

test('a double submit in the editor creates exactly one contact', async () => {
  const store = editorContacts();
  render(<EventPanel csrfToken="csrf" />);
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic single contact' },
  });
  const form = screen
    .getByRole('button', { name: 'Kontakt speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText(/Kunde: Synthetic single contact/);
  expect(store.contactPosts).toHaveLength(1);
  expect(store.puts).toHaveLength(0);
});

test('a conflict on the event save keeps the draft and the chosen contact', async () => {
  const store = editorContacts({ eventErrors: ['conflict'] });
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic conflicted name' },
  });
  await pickInEditor(group, 'Synthetic main');
  submitEditor();
  await screen.findByText(
    'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.',
  );
  expect(store.puts).toHaveLength(1);
  expect(store.puts[0]).toMatchObject({
    name: 'Synthetic conflicted name',
    primaryContactId: 'contact-main',
    version: 1,
  });
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic conflicted name',
  );
  expect(screen.getByText(/Kunde: Synthetic main/)).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(false);
});

test('a contactless event stays possible and removing the main contact reopens it', async () => {
  const store = editorContacts();
  render(<EventPanel csrfToken="csrf" />);
  await openEditor();
  expect(screen.getByText(/Kein Kunde ausgewählt/)).toBeTruthy();
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[0]).toMatchObject({ primaryContactId: null });
  const group = await openEditor();
  await pickInEditor(group, 'Synthetic main');
  fireEvent.click(screen.getByRole('button', { name: 'Kunde entfernen' }));
  expect(screen.getByText(/Kein Kunde ausgewählt/)).toBeTruthy();
  expect(screen.queryByText(/Kunde: /)).toBeNull();
  submitEditor();
  await screen.findByText('Event gespeichert.');
  expect(store.puts[1]).toMatchObject({ primaryContactId: null });
});

test('the editor contact search keeps only the newest answer', async () => {
  let resolveOlder!: (response: Response) => void;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options) return Promise.resolve(Response.json(row));
    if (url.startsWith('/api/v1/contacts')) {
      const query = decodeURIComponent(url);
      if (query.endsWith('q=Synt'))
        return Promise.resolve(
          Response.json([
            { id: 'contact-newer', name: 'Synthetic Newer', state: 'active' },
          ]),
        );
      if (query.endsWith('q=Syn'))
        return new Promise<Response>((resolve) => {
          resolveOlder = resolve;
        });
      return Promise.resolve(Response.json([]));
    }
    if (url === '/api/v1/statuses')
      return Promise.resolve(
        Response.json([{ code: 'inquiry', label: 'Anfrage' }]),
      );
    return Promise.resolve(
      Response.json(
        url.startsWith('/api/v1/events')
          ? { timeZone: 'Europe/Berlin', events: [{ ...row }] }
          : [],
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  const group = await openEditor();
  const search = within(group).getByLabelText('Kunde suchen');
  fireEvent.change(search, { target: { value: 'Syn' } });
  fireEvent.change(search, { target: { value: 'Synt' } });
  await within(group).findByRole('button', { name: /Synthetic Newer/ });
  await act(async () =>
    resolveOlder(
      Response.json([
        { id: 'contact-older', name: 'Synthetic Older', state: 'active' },
      ]),
    ),
  );
  expect(
    within(group).queryByRole('button', { name: /Synthetic Older/ }),
  ).toBeNull();
  expect(
    within(group).getByRole('button', { name: /Synthetic Newer/ }),
  ).toBeTruthy();
});

test('opening another event returns from the contact view to the event form', async () => {
  const store = editorContacts({
    supplied: { primaryContactId: 'contact-main' },
  });
  render(<EventPanel csrfToken="csrf" />);
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  expect(screen.getByRole('heading', { name: 'Kontakt anlegen' })).toBeTruthy();
  // The row action is the same deliberate edit the list always allowed.
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  expect(screen.queryByRole('heading', { name: 'Kontakt anlegen' })).toBeNull();
  expect(activeEditorForms()).toHaveLength(1);
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic event',
  );
  expect(screen.getByText(/Kunde: Synthetic main/)).toBeTruthy();
  expect(store.puts).toHaveLength(0);
  expect(store.contactPosts).toHaveLength(0);
});
