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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const event = {
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
  eventDate: '2030-10-16',
  startsAt: '2030-10-16T16:00:00Z',
  endsAt: '2030-10-16T18:00:00Z',
  timeZone: 'Europe/Berlin',
  description: '',
  notesHtml: '',
};
const resource = {
  unitId: 'synthetic-box',
  resourceId: 'synthetic-resource',
  name: 'Fictional box',
  code: 'SYNTH-BOX',
  category: 'Fotobox',
  ordinal: 1,
  selected: false,
  periodSource: 'event',
  baseStart: event.startsAt,
  baseEnd: event.endsAt,
  beforeDays: 2,
  afterDays: 2,
  startsAt: '2030-10-14T16:00:00Z',
  endsAt: '2030-10-18T18:00:00Z',
  reason: null,
  conflicts: [],
  available: true,
};
test('resource assignment shows buffers, previews availability and books with event version and CSRF', async () => {
  const changed = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options ? Response.json(event) : Response.json([resource]),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ResourceAssignments event={event} csrfToken="csrf" onChanged={changed} />,
  );
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  expect(screen.getByText(/2 Tage vorher/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Fictional box · Einheit 1 zuweisen'));
  fireEvent.change(screen.getByLabelText('Buchungsstatus'), {
    target: { value: 'booked' },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Verfügbarkeit prüfen: Fictional box · Einheit 1',
    }),
  );
  await screen.findByText('Verfügbarkeit aktualisiert.');
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await screen.findByText('Zuweisung und Termin gespeichert.');
  expect(changed).toHaveBeenCalledOnce();
  const call = fetcher.mock.calls.find(
    ([, options]) => options?.method === 'PUT',
  )!;
  expect(call[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf' });
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({
    status: 'booked',
    version: 1,
    eventDate: '2030-10-16',
    startsAt: '2030-10-16T16:00:00Z',
    endsAt: '2030-10-16T18:00:00Z',
    assignments: [{ unitId: 'synthetic-box', periodSource: 'event' }],
  });
  expect(
    (screen.getByLabelText('Eventdatum') as HTMLInputElement).readOnly,
  ).toBe(true);
});

const mount = (changed = async () => {}) =>
  render(
    <ResourceAssignments event={event} csrfToken="csrf" onChanged={changed} />,
  );
const submit = () =>
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
test('manual resource times use the tenant timezone and preserve per-unit periods', async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options
      ? Response.json(event)
      : Response.json([
          { ...resource, selected: true, periodSource: 'manual' },
        ]),
  );
  vi.stubGlobal('fetch', fetcher);
  mount();
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  const payload = JSON.parse(
    String(fetcher.mock.calls.find(([, options]) => options)?.[1]?.body),
  );
  expect(payload.assignments[0]).toEqual({
    unitId: 'synthetic-box',
    periodSource: 'manual',
    baseStart: '2030-10-16T16:00:00Z',
    baseEnd: '2030-10-16T18:00:00Z',
  });
});
test.each([
  ['conflict', /Inzwischen geändert/],
  ['import_review_required', /Ungeprüfte Bestandszusagen zuerst/],
  ['resource_conflict', /Belegungskonflikt/],
  ['booking_required', /Mindestens eine verfügbare/],
  ['unit_unavailable', /Eine gewählte Einheit/],
  ['event_unavailable', /alle Zuweisungen abwählen/],
  ['invalid_period', /vollständigen, gültigen/],
  ['past_reservation', /Beendete Dispositionszeiträume/],
  ['forbidden', /Speichern fehlgeschlagen/],
])(
  'assignment failure %s keeps the selection for correction',
  async (error, text) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options?: RequestInit) =>
        options
          ? Response.json({ error }, { status: 409 })
          : Response.json([{ ...resource, selected: true }]),
      ),
    );
    mount();
    await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
    submit();
    await screen.findByText(text);
    expect(
      (
        screen.getByLabelText(
          'Fictional box · Einheit 1 zuweisen',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  },
);
test.each([
  [
    { reason: 'import_review_required' },
    'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.',
  ],
  [{ reason: 'unit_unavailable' }, 'Einheit nicht verfügbar.'],
  [{ reason: 'invalid_period' }, 'Zeitraum noch offen oder ungültig.'],
  [
    {
      available: false,
      conflicts: [
        {
          id: 'synthetic-block',
          eventId: null,
          state: 'blocked',
          startsAt: resource.startsAt,
          endsAt: resource.endsAt,
        },
      ],
    },
    'Belegt oder zeitweise gesperrt.',
  ],
  [
    {
      available: true,
      conflicts: [
        {
          id: 'synthetic-hold',
          eventId: 'fictional-other',
          state: 'hold',
          startsAt: resource.startsAt,
          endsAt: resource.endsAt,
        },
      ],
    },
    'Konkurrierende Vormerkungen vorhanden.',
  ],
  [
    {
      available: false,
      conflicts: [
        {
          id: 'synthetic-booked',
          eventId: 'fictional-other',
          state: 'booked',
          startsAt: resource.startsAt,
          endsAt: resource.endsAt,
        },
      ],
    },
    'Belegt oder zeitweise gesperrt.',
  ],
])(
  'resource conflicts and unavailable states are visible',
  async (overrides, text) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json([{ ...resource, ...overrides }])),
    );
    mount();
    await screen.findByText(text);
  },
);
test('load errors, empty resource lists, and unavailable periods remain explicit', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 500 }));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await screen.findByText(/Ressourcen konnten nicht geladen/);
  expect(
    (
      screen.getByRole('button', {
        name: 'Zuweisung und Termin speichern',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('group', { name: 'Termin' }) as HTMLFieldSetElement)
      .disabled,
  ).toBe(true);
  cleanup();
  fetcher.mockResolvedValue(Response.json({ invalid: 'synthetic' }));
  mount();
  await screen.findByText(/Ressourcen konnten nicht geladen/);
  cleanup();
  fetcher.mockResolvedValue(Response.json([]));
  mount();
  await screen.findByText(/Keine physischen Einheiten/);
  cleanup();
  fetcher.mockResolvedValue(
    Response.json([
      {
        ...resource,
        baseStart: null,
        baseEnd: null,
        startsAt: null,
        endsAt: null,
      },
    ]),
  );
  mount();
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  expect(screen.getByText(/Einschließlich Puffer: Offen – Offen/)).toBeTruthy();
  fireEvent.change(
    screen.getByLabelText('Zeitraum: Fictional box · Einheit 1'),
    { target: { value: 'manual' } },
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Verfügbarkeit prüfen: Fictional box · Einheit 1',
    }),
  );
  await screen.findByText(
    'Für die Prüfung zuerst einen vollständigen, gültigen Zeitraum angeben.',
  );
});
test('preview failures and invalid or ambiguous time input do not claim availability', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json([resource]));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const preview = screen.getByRole('button', {
    name: 'Verfügbarkeit prüfen: Fictional box · Einheit 1',
  });
  fetcher.mockResolvedValue(new Response(null, { status: 500 }));
  fireEvent.click(preview);
  await screen.findByText('Verfügbarkeit konnte nicht geprüft werden.');
  fetcher.mockResolvedValue(Response.json([]));
  fireEvent.click(preview);
  await screen.findByText('Verfügbarkeit konnte nicht geprüft werden.');
  fetcher.mockRejectedValue(Error('offline'));
  submit();
  await screen.findByText(/Verbindung fehlgeschlagen/);
  const start = screen.getByLabelText('Eventbeginn', { exact: true });
  const callsBefore = fetcher.mock.calls.length;
  fireEvent.change(start, { target: { value: '2030-03-31T02:30' } });
  submit();
  await screen.findByText(/existiert an diesem Tag nicht/);
  expect(fetcher.mock.calls).toHaveLength(callsBefore);
  expect(document.activeElement).toBe(start);
  expect((start as HTMLInputElement).value).toBe('2030-03-31T02:30');
});

test('import review reuses assignment controls through its own protected endpoint and strips read-only metadata', async () => {
  const changed = vi.fn().mockResolvedValue(undefined),
    fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? Response.json({ eventId: 'fictional-target', excluded: false })
        : Response.json([resource]),
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ResourceAssignments
      event={event}
      csrfToken="fictional-csrf"
      onChanged={changed}
      importReview
    />,
  );
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Verfügbarkeit prüfen: Fictional box · Einheit 1',
    }),
  );
  await screen.findByText('Verfügbarkeit aktualisiert.');
  fireEvent.click(screen.getByLabelText('Fictional box · Einheit 1 zuweisen'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Geprüfte Bestandszusage übernehmen' }),
  );
  await screen.findByText('Zuweisung und Termin gespeichert.');
  const [url, options] = fetcher.mock.calls.find(
    ([, options]) => options?.method === 'PUT',
  )!;
  expect(url).toBe('/api/v1/imports/bookitup/promises/synthetic-event');
  const body = JSON.parse(options!.body as string);
  expect(body.version).toBe(1);
  expect(body).not.toHaveProperty('id');
  expect(body).not.toHaveProperty('timeZone');
  expect(
    fetcher.mock.calls.some(([url]) =>
      url.startsWith(
        '/api/v1/imports/bookitup/promises/synthetic-event/availability?',
      ),
    ),
  ).toBe(true);
  expect(changed).toHaveBeenCalledOnce();
});

test('a confirmed booking stays saved when the reload fails and the reload can be retried', async () => {
  let failReload = true,
    puts = 0;
  const changed = vi.fn(async () => {
    if (failReload) throw Error('reload');
  });
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      puts += 1;
      return Response.json(event);
    }
    return Response.json([resource]);
  });
  vi.stubGlobal('fetch', fetcher);
  mount(changed);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const form = screen
    .getByRole('button', { name: 'Zuweisung und Termin speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText('Zuweisung und Termin gespeichert.');
  await screen.findByText(/Event-Details konnten nicht neu geladen werden/);
  expect(puts).toBe(1);
  expect(changed).toHaveBeenCalledOnce();
  failReload = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Event-Details konnten nicht neu geladen werden/),
    ).toBeNull(),
  );
  expect(changed).toHaveBeenCalledTimes(2);
});

test('a retry keeps unsaved resource input and reports the dirty state upward', async () => {
  let failReload = true;
  const changed = vi.fn(async () => {
    if (failReload) throw Error('reload');
  });
  const dirty = vi.fn();
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options ? Response.json(event) : Response.json([resource]),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ResourceAssignments
      event={event}
      csrfToken="csrf"
      onChanged={changed}
      onDirtyChange={dirty}
    />,
  );
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  await screen.findByText(/Event-Details konnten nicht neu geladen werden/);
  const start = screen.getByLabelText('Eventbeginn', {
    exact: true,
  }) as HTMLInputElement;
  fireEvent.change(start, { target: { value: '2030-10-18T18:00' } });
  expect(dirty).toHaveBeenLastCalledWith(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und neu laden?',
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(start.value).toBe('2030-10-18T18:00');
  failReload = false;
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Event-Details konnten nicht neu geladen werden/),
    ).toBeNull(),
  );
  expect(changed).toHaveBeenCalledTimes(2);
  expect(dirty).toHaveBeenLastCalledWith(false);
});

const payload = (fetcher: ReturnType<typeof vi.fn>) =>
  JSON.parse(
    String(
      fetcher.mock.calls.find(([, options]) => options?.method === 'PUT')?.[1]
        ?.body,
    ),
  );
const mountFor = (rows: unknown[], changed = vi.fn(async () => {})) => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options ? Response.json(event) : Response.json(rows),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ResourceAssignments event={event} csrfToken="csrf" onChanged={changed} />,
  );
  return { fetcher, changed };
};
const openAdvanced = () =>
  fireEvent.click(screen.getByText(/Erweitert: eigener Dispositionszeitraum/));

test('a spring gap is reported at the field and never submitted', async () => {
  const { fetcher } = mountFor([{ ...resource, selected: true }]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const start = screen.getByLabelText('Eventbeginn', { exact: true });
  fireEvent.change(screen.getByLabelText('Eventende', { exact: true }), {
    target: { value: '2030-03-31T04:00' },
  });
  fireEvent.change(start, { target: { value: '2030-03-31T02:30' } });
  submit();
  await screen.findByText(/existiert an diesem Tag nicht/);
  expect(fetcher.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false);
  expect(document.activeElement).toBe(start);
  expect((start as HTMLInputElement).value).toBe('2030-03-31T02:30');
});

test('both repeated autumn hours need an explicit, distinct choice per field', async () => {
  const { fetcher } = mountFor([resource]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  fireEvent.change(screen.getByLabelText('Eventbeginn', { exact: true }), {
    target: { value: '2030-10-27T02:30' },
  });
  fireEvent.change(screen.getByLabelText('Eventende', { exact: true }), {
    target: { value: '2030-10-27T02:45' },
  });
  const startChoice = screen.getByLabelText('Uhrzeitwahl Eventbeginn');
  const endChoice = screen.getByLabelText('Uhrzeitwahl Eventende');
  submit();
  expect(fetcher.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false);
  expect(document.activeElement).toBe(startChoice);
  await screen.findAllByText(/gibt es an diesem Tag zweimal/);
  fireEvent.change(startChoice, { target: { value: 'earlier' } });
  fireEvent.change(endChoice, { target: { value: 'later' } });
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  const body = payload(fetcher);
  expect(body.startsAt).toBe('2030-10-27T00:30:00Z');
  expect(body.endsAt).toBe('2030-10-27T01:45:00Z');
  expect(body.eventDate).toBe('2030-10-27');
});

test('an unchanged saved time inside the repeated hour keeps its exact instant', async () => {
  const ambiguous = {
    ...event,
    startsAt: '2030-10-27T00:30:00.500Z',
    endsAt: '2030-10-27T01:45:00.750Z',
    eventDate: '2030-10-27',
  };
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options ? Response.json(ambiguous) : Response.json([resource]),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ResourceAssignments
      event={ambiguous}
      csrfToken="csrf"
      onChanged={async () => {}}
    />,
  );
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  expect(
    (screen.getByLabelText('Uhrzeitwahl Eventbeginn') as HTMLSelectElement)
      .value,
  ).toBe('earlier');
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  expect(payload(fetcher)).toMatchObject({
    startsAt: '2030-10-27T00:30:00.500Z',
    endsAt: '2030-10-27T01:45:00.750Z',
    eventDate: '2030-10-27',
  });
  // A deliberate switch to the other occurrence of the same wall clock wins.
  fireEvent.change(screen.getByLabelText('Uhrzeitwahl Eventbeginn'), {
    target: { value: 'later' },
  });
  submit();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, o]) => o?.method === 'PUT'),
    ).toHaveLength(2),
  );
  const puts = fetcher.mock.calls.filter(([, o]) => o?.method === 'PUT');
  expect(JSON.parse(String(puts[1]![1]?.body))).toMatchObject({
    startsAt: '2030-10-27T01:30:00.5Z',
    endsAt: '2030-10-27T01:45:00.750Z',
    eventDate: '2030-10-27',
  });
});

test('a changed date never reuses the previous summer or winter offset', async () => {
  const summer = {
    ...event,
    startsAt: '2030-07-15T16:00:00Z',
    endsAt: '2030-07-15T18:00:00Z',
    eventDate: '2030-07-15',
  };
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options ? Response.json(summer) : Response.json([resource]),
  );
  vi.stubGlobal('fetch', fetcher);
  const changed = vi.fn(async () => {});
  render(
    <ResourceAssignments event={summer} csrfToken="csrf" onChanged={changed} />,
  );
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  fireEvent.change(screen.getByLabelText('Eventbeginn', { exact: true }), {
    target: { value: '2030-12-15T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende', { exact: true }), {
    target: { value: '2030-12-15T20:00' },
  });
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  expect(payload(fetcher)).toMatchObject({
    startsAt: '2030-12-15T17:00:00Z',
    endsAt: '2030-12-15T19:00:00Z',
    eventDate: '2030-12-15',
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn', { exact: true }), {
    target: { value: '2030-07-16T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende', { exact: true }), {
    target: { value: '2030-07-16T20:00' },
  });
  submit();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  const puts = fetcher.mock.calls.filter(([, o]) => o?.method === 'PUT');
  expect(JSON.parse(String(puts[1]![1]?.body))).toMatchObject({
    startsAt: '2030-07-16T16:00:00Z',
    endsAt: '2030-07-16T18:00:00Z',
    eventDate: '2030-07-16',
  });
});

test('the derived business date is read-only until the start is cleared', async () => {
  const { fetcher } = mountFor([resource]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const date = screen.getByLabelText('Eventdatum') as HTMLInputElement;
  expect(date.readOnly).toBe(true);
  expect(date.value).toBe('2030-10-16');
  expect(screen.getByText(/Wird aus dem Beginn übernommen/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Eventbeginn', { exact: true }), {
    target: { value: '2030-10-17T00:30' },
  });
  expect(date.value).toBe('2030-10-17');
  fireEvent.change(screen.getByLabelText('Eventbeginn', { exact: true }), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Eventende', { exact: true }), {
    target: { value: '' },
  });
  expect(date.readOnly).toBe(false);
  fireEvent.change(date, { target: { value: '2030-10-20' } });
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  expect(payload(fetcher)).toMatchObject({
    startsAt: null,
    endsAt: null,
    eventDate: '2030-10-20',
  });
  fireEvent.change(date, { target: { value: '' } });
  submit();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, o]) => o?.method === 'PUT'),
    ).toHaveLength(2),
  );
  const puts = fetcher.mock.calls.filter(([, o]) => o?.method === 'PUT');
  expect(JSON.parse(String(puts[1]![1]?.body))).toMatchObject({
    startsAt: null,
    endsAt: null,
    eventDate: null,
  });
});

test('a stored custom schedule stays visible and is preserved while collapsed', async () => {
  const custom = {
    ...resource,
    selected: true,
    periodSource: 'manual',
    baseStart: '2030-10-01T10:00:00Z',
    baseEnd: '2030-10-02T10:00:00Z',
  };
  const { fetcher } = mountFor([custom]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const details = screen
    .getByText(/Erweitert: eigener Dispositionszeitraum/)
    .closest('details') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(
    screen.getByText(/gespeichert: .*01\.10\.2030.*02\.10\.2030/),
  ).toBeTruthy();
  submit();
  await screen.findByText('Zuweisung und Termin gespeichert.');
  expect(payload(fetcher).assignments[0]).toEqual({
    unitId: 'synthetic-box',
    periodSource: 'manual',
    baseStart: '2030-10-01T10:00:00Z',
    baseEnd: '2030-10-02T10:00:00Z',
  });
});

test('an invalid time hidden in the advanced section is revealed and focused', async () => {
  const custom = {
    ...resource,
    selected: true,
    periodSource: 'manual',
    baseStart: '2030-03-30T10:00:00Z',
    baseEnd: '2030-03-30T18:00:00Z',
  };
  const { fetcher } = mountFor([custom]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  openAdvanced();
  const end = screen.getByLabelText(
    'Dispositionsende: Fictional box · Einheit 1',
  );
  fireEvent.change(end, { target: { value: '2030-03-31T02:30' } });
  fireEvent.click(screen.getByText(/Erweitert: eigener Dispositionszeitraum/));
  const details = screen
    .getByText(/Erweitert: eigener Dispositionszeitraum/)
    .closest('details') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  submit();
  await screen.findByText(/existiert an diesem Tag nicht/);
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(end);
  expect(fetcher.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false);
});

test('incomplete or reversed event and custom periods are explained per field', async () => {
  const custom = {
    ...resource,
    selected: true,
    periodSource: 'manual',
    baseStart: '2030-10-16T10:00:00Z',
    baseEnd: '2030-10-16T12:00:00Z',
  };
  const { fetcher } = mountFor([custom]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const start = screen.getByLabelText('Eventbeginn', { exact: true });
  const end = screen.getByLabelText('Eventende', { exact: true });
  fireEvent.change(end, { target: { value: '' } });
  submit();
  await screen.findByText('Bitte auch das Ende angeben.');
  expect(document.activeElement).toBe(end);
  fireEvent.change(end, { target: { value: '2030-10-15T18:00' } });
  submit();
  await screen.findByText('Das Ende muss nach dem Beginn liegen.');
  fireEvent.change(start, { target: { value: '' } });
  submit();
  await screen.findByText('Bitte auch den Beginn angeben.');
  fireEvent.change(end, { target: { value: '' } });
  openAdvanced();
  fireEvent.change(
    screen.getByLabelText('Dispositionsbeginn: Fictional box · Einheit 1'),
    { target: { value: '' } },
  );
  submit();
  await screen.findByText('Bitte einen Dispositionsbeginn angeben.');
  expect(document.activeElement).toBe(
    screen.getByLabelText('Dispositionsbeginn: Fictional box · Einheit 1'),
  );
  fireEvent.change(
    screen.getByLabelText('Dispositionsbeginn: Fictional box · Einheit 1'),
    { target: { value: '2030-10-16T12:00' } },
  );
  fireEvent.change(
    screen.getByLabelText('Dispositionsende: Fictional box · Einheit 1'),
    { target: { value: '' } },
  );
  submit();
  await screen.findByText('Bitte ein Dispositionsende angeben.');
  fireEvent.change(
    screen.getByLabelText('Dispositionsende: Fictional box · Einheit 1'),
    { target: { value: '2030-10-16T10:00' } },
  );
  submit();
  await screen.findByText('Das Dispositionsende muss nach dem Beginn liegen.');
  expect(fetcher.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false);
});

test('a corrected field drops its stale validation error without saving again', async () => {
  const { fetcher } = mountFor([resource]);
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const end = screen.getByLabelText('Eventende', {
    exact: true,
  }) as HTMLInputElement;
  fireEvent.change(end, { target: { value: '' } });
  submit();
  await screen.findByText('Bitte auch das Ende angeben.');
  expect(end.getAttribute('aria-invalid')).toBe('true');
  expect(
    document.getElementById(end.getAttribute('aria-describedby')!)?.textContent,
  ).toBe('Bitte auch das Ende angeben.');
  fireEvent.change(end, { target: { value: '2030-10-16T19:00' } });
  expect(screen.queryByText('Bitte auch das Ende angeben.')).toBeNull();
  expect(screen.queryByText(/Termin prüfen/)).toBeNull();
  expect(end.getAttribute('aria-invalid')).toBe('false');
  expect(end.getAttribute('aria-describedby')).toBeNull();
  // Reversed times are a pairing error: correcting the start clears the end.
  fireEvent.change(end, { target: { value: '2030-10-16T15:00' } });
  submit();
  await screen.findByText('Das Ende muss nach dem Beginn liegen.');
  expect(end.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText('Eventbeginn', { exact: true }), {
    target: { value: '2030-10-16T14:00' },
  });
  expect(
    screen.queryByText('Das Ende muss nach dem Beginn liegen.'),
  ).toBeNull();
  expect(end.getAttribute('aria-invalid')).toBe('false');
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'PUT'),
  ).toBe(false);
});

test('editor and event file keep their own time error ids at the same time', async () => {
  const row = { ...event, name: 'Fictional booking', endsAt: null };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/availability')) return Response.json([resource]);
    if (options) return Response.json(row);
    if (url === '/api/v1/events')
      return Response.json({ timeZone: 'Europe/Berlin', events: [row] });
    if (url === '/api/v1/statuses')
      return Response.json([{ code: 'inquiry', label: 'Anfrage' }]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <>
      <EventPanel csrfToken="csrf" />
      <ResourceAssignments
        event={row}
        csrfToken="csrf"
        onChanged={async () => {}}
      />
    </>,
  );
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const region = screen.getByRole('region', { name: 'Ressourcenzuweisung' });
  const resourceEnd = region.querySelector<HTMLInputElement>(
    'input[name="endsAt"]',
  )!;
  fireEvent.change(resourceEnd, { target: { value: '' } });
  fireEvent.submit(region.querySelector('form')!);
  await within(region).findByText('Bitte auch das Ende angeben.');

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Fictional booking',
    }),
  );
  const editor = document.getElementById('event-editor') as HTMLFormElement;
  const editorEnd = editor.querySelector<HTMLInputElement>('[name="endsAt"]')!;
  fireEvent.change(editor.querySelector('[name="startsAt"]')!, {
    target: { value: '2030-10-16T19:00' },
  });
  fireEvent.change(editorEnd, { target: { value: '2030-10-16T18:00' } });
  fireEvent.submit(editor);
  await within(editor).findByText('Das Ende muss nach dem Beginn liegen.');

  expect(resourceEnd.getAttribute('aria-describedby')).toBe(
    'assignment-endsAt-error',
  );
  expect(editorEnd.getAttribute('aria-describedby')).toBe('event-endsAt-error');
  const described = (element: HTMLElement) =>
    document.getElementById(element.getAttribute('aria-describedby')!);
  expect(described(resourceEnd)?.textContent).toBe(
    'Bitte auch das Ende angeben.',
  );
  expect(described(editorEnd)?.textContent).toBe(
    'Das Ende muss nach dem Beginn liegen.',
  );
  expect(region.contains(described(resourceEnd))).toBe(true);
  expect(editor.contains(described(editorEnd))).toBe(true);
  expect(document.querySelectorAll('#assignment-endsAt-error')).toHaveLength(1);
  expect(document.querySelectorAll('#event-endsAt-error')).toHaveLength(1);
});

test('a booking write keeps the effective place untouched', async () => {
  const placed = {
      ...event,
      locationId: 'fictional-location',
      venue: 'Fictional Booking Hall',
      venueOverride: true,
    },
    bodies: Record<string, unknown>[] = [],
    fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(
          JSON.parse(String(options.body)) as Record<string, unknown>,
        );
        return Response.json(placed);
      }
      return Response.json([resource]);
    });
  vi.stubGlobal('fetch', fetcher);
  render(
    <ResourceAssignments
      event={placed}
      csrfToken="csrf"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(
    await screen.findByLabelText('Fictional box · Einheit 1 zuweisen'),
  );
  fireEvent.change(screen.getByLabelText('Buchungsstatus'), {
    target: { value: 'booked' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({
    venue: 'Fictional Booking Hall',
    venueOverride: true,
    locationId: 'fictional-location',
  });
});
