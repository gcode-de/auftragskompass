import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ResourceAssignments } from '../../apps/admin/src/ResourceAssignments.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const event = {
  id: 'synthetic-event',
  version: 1,
  name: 'Fictional booking',
  status: 'inquiry',
  eventTypeId: null,
  packageId: null,
  locationId: null,
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
    assignments: [{ unitId: 'synthetic-box', periodSource: 'event' }],
  });
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
      screen
        .getByRole('button', {
          name: 'Zuweisung und Termin speichern',
        })
        .closest('fieldset') as HTMLFieldSetElement
    ).disabled,
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
  await screen.findByText('Zeitraum und UTC-Versatz prüfen.');
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
  fireEvent.change(
    screen.getByLabelText('Eventbeginn für die Disposition', { exact: true }),
    { target: { value: '2030-03-31T02:30' } },
  );
  submit();
  await screen.findByText('Zeitraum und UTC-Versatz prüfen.');
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
  await screen.findByText(/Eventakte konnte nicht neu geladen werden/);
  expect(puts).toBe(1);
  expect(changed).toHaveBeenCalledOnce();
  failReload = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventakte erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Eventakte konnte nicht neu geladen werden/),
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
  await screen.findByText(/Eventakte konnte nicht neu geladen werden/);
  const date = screen.getByLabelText('Buchungsdatum') as HTMLInputElement;
  fireEvent.change(date, { target: { value: '2030-10-17' } });
  expect(dirty).toHaveBeenLastCalledWith(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventakte erneut laden' }),
  );
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und neu laden?',
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(date.value).toBe('2030-10-17');
  failReload = false;
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventakte erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Eventakte konnte nicht neu geladen werden/),
    ).toBeNull(),
  );
  expect(changed).toHaveBeenCalledTimes(2);
  expect(dirty).toHaveBeenLastCalledWith(false);
});
