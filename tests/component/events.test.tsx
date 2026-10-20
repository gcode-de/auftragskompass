import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { afterEach, expect, test, vi } from 'vitest';
import { clickLink } from '../helpers/click-link.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
import { Navigation } from '../../apps/admin/src/Navigation.js';
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
      rows = [{ ...row, ...JSON.parse(String(options.body)) }];
      return Response.json(rows[0]);
    }
    if (url.startsWith('/api/v1/events'))
      return Response.json({ timeZone: 'Europe/Berlin', events: rows });
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
function showForms() {
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  screen.getByText(/^Filter(?: · aktiv)?$/).closest('details')!.open = true;
}
test('events create without date, retain formatted notes and edit/cancel with version checks', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic new event' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic new event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic new event – 01.07.2026 – Annulliert');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event (Kopie) – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event (Kopie) – 01.07.2026 – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  fireEvent.click(screen.getByLabelText('Nur Events ohne Datum'));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Events filtern' }).closest('form')!,
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
    const filter = screen
      .getByText(/^Filter(?: · aktiv)?$/)
      .closest('details')!;
    filter.open = true;
    act(() => updateUrlSearch({ q: 'fresh' }));
    await screen.findByText('Synthetic fresh – Ohne Datum – inquiry');
    await act(async () => {
      if (fail) rejectOld(Error('stale offline'));
      else
        resolveOld(Response.json({ timeZone: 'Europe/Berlin', events: [row] }));
    });
    expect(
      screen.queryByText('Synthetic event – Ohne Datum – inquiry'),
    ).toBeNull();
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  expect(within(dialog).getByLabelText('Kunde')).toBeTruthy();
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
  await screen.findByRole('heading', { name: 'Oktober 2026 2 Events' });
  expect(
    screen.getByRole('heading', { name: 'November 2026 1 Event' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: 'Ohne Datum 1 Event' }),
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
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
  expect(screen.queryByRole('button', { name: 'Event anlegen' })).toBeNull();
  window.history.replaceState(null, '', '/#event-unlisted');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(
    screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
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
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
  fireEvent.click(screen.getByRole('button', { name: 'Eventakte schließen' }));
  await vi.waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
    ).toBeNull(),
  );
  const open = screen.getByRole('link', {
    name: /Synthetic event/,
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(open));
  fireEvent.click(open);
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
  const detailEdit = screen.getByRole('button', {
    name: 'Stammdaten bearbeiten: Synthetic event',
  });
  expect(detailEdit.getAttribute('title')).toBe('Event bearbeiten');
  expect(detailEdit.textContent).toBe('');
  fireEvent.click(detailEdit);
  expect(
    screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
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
    screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
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
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
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
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
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
      screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
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
    await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic reloaded event – Ohne Datum – Anfrage');
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
  expect(screen.getByLabelText('Hauptkontakt')).toBeTruthy();
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
    (screen.getByLabelText('Veranstaltungsort') as HTMLSelectElement).value,
  ).toBe('fictional-option');
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
  expect(savedBody(fetcher)).toMatchObject({
    name: 'Synthetic edited name',
    eventTypeId: 'fictional-option',
    packageId: 'fictional-option',
    locationId: 'fictional-option',
    primaryContactId: 'fictional-option',
    source: 'Synthetic source',
    description: 'Synthetic description',
    notesHtml: '<strong>Fictional</strong>',
  });
});

test('the business date is derived from the local start across midnight and the DST day', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
    if (url === '/api/v1/contacts') return Response.json(contacts);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic contact event' },
  });
  fireEvent.change(screen.getByLabelText('Kunde'), {
    target: { value: 'contact-main' },
  });
  const additional = screen.getByLabelText(
    'Weitere Kontakte',
  ) as HTMLSelectElement;
  expect(
    within(additional).queryByRole('option', { name: 'Synthetic main' }),
  ).toBeNull();
  fireEvent.change(additional, { target: { value: 'contact-extra' } });
  expect(additional.value).toBe('contact-extra');
  fireEvent.change(screen.getByLabelText('Kunde'), {
    target: { value: 'contact-extra' },
  });
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
    (screen.getByLabelText('Veranstaltungsort') as HTMLSelectElement).value,
  ).toBe('fictional-option');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic saved event – Ohne Datum – Anfrage');
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
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  failList = true;
  returnToApp();
  await screen.findByText(/Events konnten nicht geladen werden/);
  expect(
    screen.getByText('Synthetic event – Ohne Datum – Anfrage'),
  ).toBeTruthy();
  failList = false;
  refreshed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Events erneut laden' }));
  await screen.findByText('Synthetic refreshed event – Ohne Datum – Anfrage');
  expect(mutations).toBe(0);
});

test('a cancelled editor is refreshed automatically on the next return', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  showForms();
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
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
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
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
    name: 'Eventakte: Synthetic newer event',
  });
  expect(detailCalls).toBe(2);
  expect(screen.queryByText(/Eventakte konnte nicht geladen/)).toBeNull();
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
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  failList = true;
  returnToApp();
  await screen.findByText(/Events konnten nicht geladen werden/);
  failList = false;
  refreshed = true;
  fireEvent(window, new Event('blur'));
  returnToApp();
  await screen.findByText('Synthetic another return – Ohne Datum – Anfrage');
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
