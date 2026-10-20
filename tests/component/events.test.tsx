import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
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
  fireEvent.click(screen.getByText('Event anlegen', { exact: true }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Events aktualisieren' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Events aktualisieren' }));
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
    fireEvent.click(screen.getByText('Event anlegen', { exact: true }));
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
  fireEvent.click(screen.getByText('Event anlegen', { exact: true }));
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

test('starts with a grouped event list and reveals forms without losing an unfinished draft', async () => {
  vi.stubGlobal('fetch', mocker([], { eventDate: '2026-10-24' }));
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByRole('heading', { name: /Oktober 2026/ });
  expect(
    screen.getByText('Event anlegen', { exact: true }).closest('details')!.open,
  ).toBe(false);
  fireEvent.click(screen.getByText('Event anlegen', { exact: true }));
  const name = screen.getByLabelText('Eventname') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Fictional unfinished event' } });
  fireEvent.click(screen.getByText('Event anlegen', { exact: true }));
  expect(
    screen.getByText('Event anlegen', { exact: true }).closest('details')!.open,
  ).toBe(false);
  fireEvent.click(screen.getByText('Event anlegen', { exact: true }));
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Fictional unfinished event',
  );
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
  expect(
    screen.queryByRole('button', { name: 'Events aktualisieren' }),
  ).toBeNull();
  window.history.replaceState(null, '', '/#event-unlisted');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(
    screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Events aktualisieren' }),
  ).toBeTruthy();
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
    await screen.findByRole('button', {
      name: 'Eventakte öffnen: Synthetic event',
    }),
  );
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
  fireEvent.click(screen.getByRole('button', { name: 'Eventakte schließen' }));
  await vi.waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Eventakte: Synthetic event' }),
    ).toBeNull(),
  );
  const open = screen.getByRole('button', {
    name: 'Eventakte öffnen: Synthetic event',
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(open));
  fireEvent.click(open);
  await screen.findByRole('heading', { name: 'Eventakte: Synthetic event' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Stammdaten bearbeiten' }),
  );
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
  expect(start.getAttribute('aria-describedby')).toBe('event-startsAt-error');
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
  expect(end.getAttribute('aria-describedby')).toBe('event-endsAt-error');
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
  expect(
    screen.getByText('Event anlegen', { exact: true }).closest('details')!.open,
  ).toBe(false);
  failReload = false;
  fireEvent.click(screen.getByRole('button', { name: 'Events erneut laden' }));
  await screen.findByText('Synthetic reloaded event – Ohne Datum – Anfrage');
  expect(
    screen.queryByText(/Liste konnte nicht neu geladen werden/),
  ).toBeNull();
});
