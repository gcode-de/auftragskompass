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
import { EventDetails } from '../../apps/admin/src/EventDetails.js';
import { Navigation } from '../../apps/admin/src/Navigation.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function returnToApp() {
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
}
function detailLoads(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(
    ([url, options]) =>
      String(url).startsWith('/api/v1/events/') &&
      !String(url).endsWith('/availability') &&
      options === undefined,
  ).length;
}
const statuses = [
  { code: 'inquiry', label: 'Anfrage' },
  { code: 'option', label: 'Option' },
  { code: 'booked', label: 'Gebucht' },
];
const event = {
  id: 'synthetic-event',
  version: 1,
  name: 'Synthetic detail event',
  status: 'inquiry',
  eventDate: '2026-10-16',
  startsAt: '2026-10-16T16:00:00Z',
  endsAt: '2026-10-16T18:00:00Z',
  timeZone: 'Europe/Berlin',
  source: 'Fictional source',
  description: 'Synthetic description',
  notesHtml: '<strong>Fictional note</strong>',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue: null as string | null,
  venueOverride: false,
  primaryContactId: null,
  additionalContactIds: [],
};
const detail = {
  event,
  contacts: [
    {
      id: 'synthetic-contact',
      name: 'Fictional contact',
      contactPerson: 'Fictional representative',
      email: 'detail@example.invalid',
      phone: '030 000000',
      mobile: '',
      role: 'primary',
    },
  ],
  location: {
    id: 'synthetic-location',
    name: 'Fictional venue',
    street: '',
    postalCode: '00000',
    city: 'Fictional city',
    country: 'DE',
  },
  eventType: { id: 'synthetic-type', name: 'Fictional type' },
  package: { id: 'synthetic-package', name: 'Fictional package' },
  activities: [
    {
      id: '1',
      kind: 'created',
      eventVersion: null,
      occurredAt: '2026-10-15T12:00:00Z',
      description: 'Event angelegt.',
    },
  ],
};
test('event details collect contacts, venue, notes and activities and save status with current version', async () => {
  const freshDetail = structuredClone(detail);
  const changed = vi.fn().mockResolvedValue(undefined),
    edit = vi.fn(),
    close = vi.fn();
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      Object.assign(freshDetail.event, JSON.parse(String(options.body)));
      freshDetail.event.version = 2;
      return Response.json(freshDetail.event);
    }
    return Response.json(freshDetail);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={changed}
      onEdit={edit}
      onClose={close}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
    level: 2,
  });
  expect(
    screen
      .getByRole('link', { name: 'detail@example.invalid' })
      .getAttribute('href'),
  ).toBe('mailto:detail%40example.invalid');
  expect(
    screen.getByRole('link', { name: '030 000000' }).getAttribute('href'),
  ).toBe('tel:030000000');
  expect(screen.getByText('Fictional venue')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Logbuch' }));
  expect(screen.getByText(/Event angelegt\./)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  fireEvent.change(screen.getByLabelText('Status des Events'), {
    target: { value: 'option' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText('Status gespeichert.');
  expect(changed).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/synthetic-event',
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }),
      body: expect.stringContaining('"version":1'),
    }),
  );
  const editButton = screen.getByRole('button', {
    name: 'Stammdaten bearbeiten: Synthetic detail event',
  });
  expect(editButton.getAttribute('title')).toBe('Event bearbeiten');
  expect(editButton.textContent).toBe('');
  fireEvent.click(editButton);
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details schließen' }),
  );
  expect(close).toHaveBeenCalledOnce();
});
test('event detail errors preserve loaded data and allow retries', async () => {
  let error = 'conflict';
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options
      ? Response.json({ error }, { status: error === 'conflict' ? 409 : 400 })
      : Response.json({
          ...detail,
          contacts: [],
          location: null,
          eventType: null,
          package: null,
          activities: [],
          event: { ...event, eventDate: null, startsAt: null, endsAt: null },
        }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByText('Ohne Datum');
  await screen.findByText('Noch keine Aktivitäten.');
  const statusSelect = screen.getByLabelText(
    'Status des Events',
  ) as HTMLSelectElement;
  fireEvent.change(statusSelect, { target: { value: 'option' } });
  for (const [code, text] of [
    ['invalid', /Status konnte nicht gespeichert/],
    ['import_review_required', /Ungeprüfte Bestandszusagen zuerst/],
  ] as const) {
    error = code;
    fireEvent.submit(
      screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
    );
    await screen.findByText(text);
    expect(statusSelect.value).toBe('option');
    error = 'invalid';
  }
  fetcher.mockRejectedValue(Error('offline'));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText(/Verbindung fehlgeschlagen/);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  returnToApp();
  await screen.findByText(/Aktualisierung steht aus/);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Neu laden und Eingaben verwerfen',
    }),
  );
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und neu laden?',
  );
  await screen.findByText(/Event-Details konnte nicht geladen/);
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  );
  render(
    <EventDetails
      statuses={statuses}
      id="missing"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByText(/Event-Details konnte nicht geladen/);
});

test('shows one record section and retains the selected section on a refreshed event version', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(detail)),
  );
  const props = {
    statuses,
    id: 'synthetic-event',
    csrfToken: 'csrf',
    onChanged: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<EventDetails {...props} revision={1} />);
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  expect(screen.queryByRole('heading', { name: 'Logbuch' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Notizen' }));
  expect(
    screen.queryByRole('combobox', { name: 'Status des Events' }),
  ).toBeNull();
  expect(
    screen.getByLabelText('Notizen: Synthetic detail event').textContent,
  ).toContain('Fictional note');
  view.rerender(<EventDetails {...props} revision={2} />);
  await vi.waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Notizen' })
        .getAttribute('aria-current'),
    ).toBe('location'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Logbuch' }));
  expect(screen.getByText(/Event angelegt\./)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  expect(screen.queryByRole('heading', { name: 'Logbuch' })).toBeNull();
});

test('a confirmed status save is reported even when the reload fails and can be retried', async () => {
  let failGet = false,
    puts = 0;
  const changed = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      puts += 1;
      return Response.json({ ...event, status: 'option', version: 2 });
    }
    if (failGet) return new Response(null, { status: 503 });
    return Response.json(detail);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={changed}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  failGet = true;
  fireEvent.change(screen.getByLabelText('Status des Events'), {
    target: { value: 'option' },
  });
  const form = screen
    .getByRole('button', { name: 'Status speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText('Status gespeichert.');
  await screen.findByText(/Event-Details konnten nicht neu geladen werden/);
  expect(puts).toBe(1);
  expect(changed).not.toHaveBeenCalled();
  failGet = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Event-Details konnten nicht neu geladen werden/),
    ).toBeNull(),
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(puts).toBe(1);
});

test('a slower older event file response never overwrites the newer state', async () => {
  const pending: ((reply: Response) => void)[] = [];
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options) return Promise.resolve(Response.json(event));
    if (url === '/api/v1/events/synthetic-event')
      return new Promise<Response>((resolve) => pending.push(resolve));
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal('fetch', fetcher);
  const props = {
    statuses,
    id: 'synthetic-event',
    csrfToken: 'csrf',
    onChanged: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<EventDetails {...props} revision={1} />);
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender(<EventDetails {...props} revision={2} />);
  // The running request is not duplicated; the newer revision is loaded
  // immediately after it instead.
  expect(pending).toHaveLength(1);
  await act(async () =>
    pending[0]!(
      Response.json({
        ...detail,
        event: { ...event, name: 'Synthetic stale state', version: 1 },
      }),
    ),
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!(
    Response.json({
      ...detail,
      event: { ...event, name: 'Synthetic newer state', version: 2 },
    }),
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic newer state',
  });
  expect(screen.queryByText(/Synthetic stale state/)).toBeNull();
});

test('a retry keeps a dirty status selection until discarding it is confirmed', async () => {
  let failGet = false,
    gets = 0,
    server = { ...event, version: 1 };
  const changed = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/events/synthetic-event' && !options) gets += 1;
    if (options) {
      server = {
        ...server,
        ...JSON.parse(String(options.body)),
        version: server.version + 1,
      };
      return Response.json(server);
    }
    if (failGet) return new Response(null, { status: 503 });
    return Response.json({ ...detail, event: server });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={changed}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  const select = () =>
    screen.getByLabelText('Status des Events') as HTMLSelectElement;
  failGet = true;
  fireEvent.change(select(), { target: { value: 'option' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText('Status gespeichert.');
  await screen.findByText(/Event-Details konnten nicht neu geladen werden/);
  // A second, still unsaved choice made after the failed reload must survive a
  // declined retry and must not be submitted against an unseen version.
  fireEvent.change(select(), { target: { value: 'inquiry' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const requests = gets;
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und neu laden?',
  );
  expect(gets).toBe(requests);
  expect(select().value).toBe('inquiry');
  await screen.findByText(/Event-Details konnten nicht neu geladen werden/);
  failGet = false;
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Event-Details konnten nicht neu geladen werden/),
    ).toBeNull(),
  );
  expect(gets).toBe(requests + 1);
  expect(select().value).toBe('option');
  expect(changed).toHaveBeenCalledOnce();
  fireEvent.change(select(), { target: { value: 'inquiry' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText('Status gespeichert.');
  const puts = fetcher.mock.calls.filter(([, options]) => options);
  expect(JSON.parse(String(puts.at(-1)![1]!.body))).toMatchObject({
    status: 'inquiry',
    version: 2,
  });
});

test('a clean detail refreshes on return, while a dirty detail defers without a background confirmation', async () => {
  let server = { ...event, version: 1 };
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      server = {
        ...server,
        ...JSON.parse(String(options.body)),
        version: server.version + 1,
      };
      return Response.json(server);
    }
    return Response.json({ ...detail, event: server });
  });
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm');
  const props = {
    statuses,
    id: 'synthetic-event',
    csrfToken: 'csrf',
    onChanged: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<EventDetails {...props} />);
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  expect(
    screen.queryByRole('button', { name: 'Eventakte aktualisieren' }),
  ).toBeNull();
  const loads = detailLoads(fetcher);
  returnToApp();
  await vi.waitFor(() => expect(detailLoads(fetcher)).toBe(loads + 1));
  fireEvent.change(screen.getByLabelText('Status des Events'), {
    target: { value: 'option' },
  });
  server = { ...server, name: 'Synthetic newer detail', version: 2 };
  const dirtyLoads = detailLoads(fetcher);
  view.rerender(<EventDetails {...props} revision={2} />);
  await screen.findByText(/Aktualisierung steht aus/);
  expect(detailLoads(fetcher)).toBe(dirtyLoads);
  expect(confirm).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText('Status des Events') as HTMLSelectElement).value,
  ).toBe('option');
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Neu laden und Eingaben verwerfen',
    }),
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic newer detail',
  });
  fireEvent.change(screen.getByLabelText('Status des Events'), {
    target: { value: 'inquiry' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText('Status gespeichert.');
  const puts = fetcher.mock.calls.filter(([, options]) => options);
  expect(JSON.parse(String(puts.at(-1)![1]!.body))).toMatchObject({
    version: 2,
  });
});

test('a failed background detail load keeps the prior data and retries without a mutation', async () => {
  let fail = false,
    puts = 0,
    name = 'Synthetic detail event';
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      puts += 1;
      return Response.json(event);
    }
    if (fail) return new Response(null, { status: 503 });
    return Response.json({
      ...detail,
      event: { ...event, name, version: name === event.name ? 1 : 2 },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  fail = true;
  returnToApp();
  await screen.findByText(/Event-Details konnte nicht geladen werden/);
  expect(
    screen.getByRole('heading', { name: 'Event: Synthetic detail event' }),
  ).toBeTruthy();
  fail = false;
  name = 'Synthetic retried detail';
  fireEvent.click(
    screen.getByRole('button', { name: 'Event-Details erneut laden' }),
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic retried detail',
  });
  expect(puts).toBe(0);
});

test('dirty resource assignment values survive the automatic background refresh', async () => {
  const unit = {
    unitId: 'synthetic-unit',
    resourceId: 'synthetic-resource',
    name: 'Fictional box',
    code: 'SYNTH',
    category: 'Fotobox',
    ordinal: 1,
    selected: false,
    periodSource: 'event',
    baseStart: event.startsAt,
    baseEnd: event.endsAt,
    beforeDays: 0,
    afterDays: 0,
    startsAt: null,
    endsAt: null,
    available: true,
    reason: null,
    conflicts: [],
  };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) return Response.json(event);
    if (url.endsWith('/availability')) return Response.json([unit]);
    if (url.startsWith('/api/v1/documents')) return Response.json([]);
    if (url === '/api/v1/document-templates') return Response.json([]);
    if (url === '/api/v1/events/synthetic-event') return Response.json(detail);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm');
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  await screen.findByLabelText('Fictional box · Einheit 1 zuweisen');
  const start = screen.getByLabelText('Eventbeginn', {
    exact: true,
  }) as HTMLInputElement;
  fireEvent.change(start, { target: { value: '2026-10-18T18:00' } });
  const loads = detailLoads(fetcher);
  returnToApp();
  await screen.findByText(/Aktualisierung steht aus/);
  expect(detailLoads(fetcher)).toBe(loads);
  expect(start.value).toBe('2026-10-18T18:00');
  expect(confirm).not.toHaveBeenCalled();
});

test('an older version returned by the server does not create a request loop', async () => {
  let detailLoadsCounter = 0;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) return Response.json(event);
    if (url === '/api/v1/events/synthetic-event') {
      detailLoadsCounter += 1;
      return Response.json({ ...detail, event: { ...event, version: 1 } });
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  const props = {
    statuses,
    id: 'synthetic-event',
    csrfToken: 'csrf',
    onChanged: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<EventDetails {...props} revision={1} />);
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  view.rerender(<EventDetails {...props} revision={2} />);
  await vi.waitFor(() => expect(detailLoadsCounter).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(detailLoadsCounter).toBe(2);
});

test('changing the event id with the same version still loads the other file', async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) return Response.json(event);
    if (url === '/api/v1/events/synthetic-event') return Response.json(detail);
    if (url === '/api/v1/events/synthetic-other')
      return Response.json({
        ...detail,
        event: {
          ...event,
          id: 'synthetic-other',
          name: 'Synthetic other file',
        },
      });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  const props = {
    statuses,
    csrfToken: 'csrf',
    onChanged: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <EventDetails {...props} id="synthetic-event" revision={1} />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  view.rerender(<EventDetails {...props} id="synthetic-other" revision={1} />);
  await screen.findByRole('heading', {
    name: 'Event: Synthetic other file',
  });
});

test('home links ask before discarding a dirty event detail and cancel keeps route and input', async () => {
  window.history.replaceState(null, '', '/#event-synthetic');
  const fetcher = vi.fn(async () => Response.json(detail));
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(
    <>
      <Navigation />
      <EventDetails
        statuses={statuses}
        id="synthetic-event"
        csrfToken="csrf"
        onChanged={vi.fn()}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />
    </>,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  const brand = within(screen.getByLabelText('Arbeitsbereiche')).getByRole(
    'link',
    { name: 'AuftragsKompass – zur Eventübersicht' },
  );
  const title = screen.getByRole('link', {
    name: 'Events – zur Eventübersicht',
  });
  expect(clickLink(brand)).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/#event-synthetic');
  fireEvent(window, new HashChangeEvent('hashchange'));
  const status = () =>
    screen.getByLabelText('Status des Events') as HTMLSelectElement;
  fireEvent.change(status(), { target: { value: 'option' } });
  for (const link of [brand, title]) {
    confirm.mockClear();
    expect(clickLink(link)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      'Ungespeicherte Eingaben verwerfen und zur Eventübersicht wechseln?',
    );
    expect(window.location.hash).toBe('#event-synthetic');
    expect(status().value).toBe('option');
  }
  confirm.mockReturnValue(true);
  expect(clickLink(title)).toBe(false);
});

test('global search asks before leaving a dirty event detail', async () => {
  window.history.replaceState(null, '', '/#event-synthetic');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(detail)),
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(
    <>
      <Navigation />
      <EventDetails
        statuses={statuses}
        id="synthetic-event"
        csrfToken="csrf"
        onChanged={vi.fn()}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />
    </>,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
  });
  fireEvent.change(screen.getByLabelText('Status des Events'), {
    target: { value: 'option' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Suche öffnen' }));
  const query = screen.getByLabelText('Globale Suche') as HTMLInputElement;
  fireEvent.change(query, { target: { value: 'Synthetic search draft' } });
  const form = screen
    .getByRole('button', { name: 'Events und Kontakte suchen' })
    .closest('form')!;
  fireEvent.submit(form);
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und zur Suche wechseln?',
  );
  expect(window.location.hash).toBe('#event-synthetic');
  expect(
    (screen.getByLabelText('Status des Events') as HTMLSelectElement).value,
  ).toBe('option');
  expect(query.value).toBe('Synthetic search draft');
  confirm.mockReturnValue(true);
  fireEvent.submit(form);
  expect(window.location.hash).toBe('#search');
});

test('the details show only the effective place and keep it on a status save', async () => {
  const replaced = {
    ...detail,
    event: {
      ...event,
      locationId: 'synthetic-location',
      venue: 'Fictional Terrace\nNebeneingang',
      venueOverride: true,
    },
  };
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        bodies.push(
          JSON.parse(String(options.body)) as Record<string, unknown>,
        );
        return Response.json({
          ...replaced.event,
          status: 'option',
          version: 2,
        });
      }
      return Response.json(replaced);
    }),
  );
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={vi.fn()}
      onEdit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic detail event' });
  expect(screen.getByRole('heading', { name: 'Ort / Adresse' })).toBeTruthy();
  // BKP013.1: the effective place is named in the Ort block and in the record
  // head; the stored location name behind the override still never appears.
  expect(
    screen.getByText(/Fictional Terrace/, { selector: '.event-venue' }),
  ).toBeTruthy();
  expect(
    screen.getByText(/Fictional Terrace/, { selector: '.event-record-place' }),
  ).toBeTruthy();
  expect(screen.queryByText('Fictional venue')).toBeNull();
  fireEvent.change(screen.getByLabelText('Status des Events'), {
    target: { value: 'option' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText('Status gespeichert.');
  expect(bodies[0]).toMatchObject({
    status: 'option',
    venue: 'Fictional Terrace\nNebeneingang',
    venueOverride: true,
    locationId: 'synthetic-location',
  });
});

test('a deliberate clear shows no place at all in the details', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...detail,
        event: {
          ...event,
          locationId: 'synthetic-location',
          venue: '',
          venueOverride: true,
        },
      }),
    ),
  );
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={vi.fn()}
      onEdit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic detail event' });
  expect(screen.getByText('Kein Veranstaltungsort hinterlegt.')).toBeTruthy();
  expect(screen.queryByText('Fictional venue')).toBeNull();
  expect(screen.queryByText('Fictional city')).toBeNull();
});

test('details name a date-only booking instead of inventing a start time', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      ...detail,
      event: { ...event, startsAt: null, endsAt: null },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail event',
    level: 2,
  });
  const term = screen.getByText('Beginn', { selector: 'dt' });
  expect(term.nextElementSibling?.textContent).toBe(
    'Tagesbuchung, ohne Uhrzeit',
  );
  expect(document.body.textContent).not.toContain('Noch offen Uhr');
});

test('a contactless website option shows an open contact and its original request as escaped text', async () => {
  const edit = vi.fn();
  const websiteOriginal = {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    receivedAt: '2030-10-26T10:00:00.000Z',
    fields: [
      { label: 'Vorname', value: 'Fictional' },
      { label: 'Nachname', value: 'Website' },
      { label: 'E-Mail', value: 'fictional.website@example.invalid' },
      { label: 'Veranstaltungsdatum', value: '27.10.2030' },
      { label: 'Telefonnummer', value: '' },
      { label: 'Veranstaltungsort', value: 'Fictional hall' },
      { label: 'Gewünschtes Fotobox-Paket', value: 'easy print+' },
      {
        label: 'Kommentar',
        value: '<script>fictional</script>\n' + 'x'.repeat(300),
      },
    ],
    privacyNotice: 'Fictional original privacy notice',
    privacyUrl: 'https://fictional.example.invalid/privacy',
  };
  const contactless = {
    ...detail,
    event: {
      ...event,
      status: 'option',
      source: 'Website: fotobox-bw-main (v1)',
      primaryContactId: null,
    },
    contacts: [],
    websiteInquiryAvailable: true,
  };
  const fetcher = vi.fn(async (url: string) =>
    String(url).endsWith('/website-inquiry')
      ? Response.json(websiteOriginal)
      : Response.json(contactless),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={vi.fn()}
      onEdit={edit}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole('heading', { name: 'Event: Synthetic detail event' });
  // A missing link is a normal open state, never an error or a blocked step.
  expect(screen.getByText('Kontakt noch offen.')).toBeTruthy();
  const request = screen.getByText('Website-Anfrage').closest('details')!;
  expect(request.open).toBe(false);
  request.open = true;
  fireEvent(request, new Event('toggle'));
  await screen.findByText('Fictional original privacy notice');
  expect(within(request).getAllByRole('definition')).toHaveLength(8);
  expect(within(request).getByText(/<script>fictional/)).toBeTruthy();
  expect(view.container.querySelector('script')).toBeNull();
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/synthetic-event/website-inquiry',
  );
  // Later assignment stays the normal, deliberate event edit.
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Stammdaten bearbeiten: Synthetic detail event',
    }),
  );
  expect(edit).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'synthetic-event',
      // The shared fixture keeps the version of its last confirmed save; the
      // point here is that editing starts from the stored status and version.
      version: contactless.event.version,
      status: 'option',
      primaryContactId: null,
    }),
  );
});

test('metadata and status edits lock each other and adopt the confirmed version without a reload', async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === 'PUT' ? pending : Response.json(detail),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={vi.fn()}
      onEdit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const name = (await screen.findByLabelText('Eventname')) as HTMLInputElement;
  const status = screen.getByLabelText(
    'Status des Events',
  ) as HTMLSelectElement;
  await waitFor(() => expect(name.closest('fieldset')?.disabled).toBe(false));
  name.focus();
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: 'Unfinished' } });
  expect(status.closest('fieldset')?.disabled).toBe(true);
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'PUT'),
  ).toBe(false);
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'PUT'),
  ).toBe(false);
  await waitFor(() => expect(status.closest('fieldset')?.disabled).toBe(false));
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === 'PUT'),
  ).toBe(false);
  fireEvent.change(status, { target: { value: 'option' } });
  expect(name.closest('fieldset')?.disabled).toBe(true);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  expect(name.closest('fieldset')?.disabled).toBe(true);
  complete(Response.json({ ...event, status: 'option', version: 2 }));
  await screen.findByText('Status gespeichert.');
  await waitFor(() => expect(name.closest('fieldset')?.disabled).toBe(false));
  fireEvent.change(name, { target: { value: 'Next name' } });
  expect(status.closest('fieldset')?.disabled).toBe(true);
});

test('resource draft locks metadata, and a confirmed resource version survives failed reload', async () => {
  const unit = {
    unitId: 'synthetic-unit',
    resourceId: 'synthetic-resource',
    name: 'Fictional box',
    code: 'SYNTH',
    category: 'Fotobox',
    ordinal: 1,
    selected: false,
    periodSource: 'event',
    baseStart: event.startsAt,
    baseEnd: event.endsAt,
    beforeDays: 0,
    afterDays: 0,
    startsAt: null,
    endsAt: null,
    available: true,
    reason: null,
    conflicts: [],
  };
  let saved = false;
  let releaseMetadata!: (response: Response) => void;
  const metadataSave = new Promise<Response>((resolve) => {
    releaseMetadata = resolve;
  });
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body));
      bodies.push(body);
      if (bodies.length === 1) return metadataSave;
      saved = true;
      return Response.json({ ...event, ...body, version: bodies.length + 1 });
    }
    if (url.endsWith('/availability')) return Response.json([unit]);
    if (url === '/api/v1/events/synthetic-event')
      return saved
        ? new Response(null, { status: 503 })
        : Response.json(detail);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={vi.fn()}
      onEdit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const name = (await screen.findByLabelText('Eventname')) as HTMLInputElement;
  name.focus();
  fireEvent.change(name, { target: { value: 'Pending' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  let assignment = await screen.findByRole('region', {
    name: 'Ressourcenzuweisung',
  });
  let box = await within(assignment).findByLabelText(
    'Fictional box · Einheit 1 zuweisen',
  );
  expect(box.closest('fieldset')?.disabled).toBe(true);
  releaseMetadata(Response.json({ ...event, name: 'Pending', version: 2 }));
  await waitFor(() => expect(assignment.isConnected).toBe(false));
  assignment = await screen.findByRole('region', {
    name: 'Ressourcenzuweisung',
  });
  box = await within(assignment).findByLabelText(
    'Fictional box · Einheit 1 zuweisen',
  );
  await waitFor(() => expect(box.closest('fieldset')?.disabled).toBe(false));
  fireEvent.click(box);
  expect(name.closest('fieldset')?.disabled).toBe(true);
  fireEvent.submit(
    within(assignment)
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await screen.findByText(/Gespeichert, aber/);
  await waitFor(() => expect(name.closest('fieldset')?.disabled).toBe(false));
  fireEvent.change(name, { target: { value: 'After resource' } });
  fireEvent.blur(name);
  await waitFor(() => expect(bodies.length).toBe(3));
  expect(bodies[2]).toMatchObject({ version: 3, name: 'After resource' });
});

test.each(['malformed', 'conflict'])(
  'status %s blocks writes until the server is explicitly reloaded',
  async (failure) => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? failure === 'conflict'
          ? Response.json({ error: 'conflict' }, { status: 409 })
          : Response.json({})
        : Response.json(detail),
    );
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <EventDetails
        statuses={statuses}
        id="synthetic-event"
        csrfToken="csrf"
        onChanged={async () => {}}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByLabelText('Status des Events');
    const button = screen.getByRole('button', {
      name: 'Status speichern',
    }) as HTMLButtonElement;
    fireEvent.submit(button.closest('form')!);
    await screen.findByText(
      failure === 'conflict'
        ? /Inzwischen geändert/
        : /Verbindung fehlgeschlagen/,
    );
    expect(button.matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Eventname').matches(':disabled')).toBe(true);
    fireEvent.submit(button.closest('form')!);
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Serverstand prüfen und Eingaben verwerfen',
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Status speichern' })
          .matches(':disabled'),
      ).toBe(false),
    );
  },
);

test('status reconciliation keeps the lock when the returned server version is stale', async () => {
  let version = 2;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options
      ? Response.json({ error: 'conflict' }, { status: 409 })
      : Response.json({ ...detail, event: { ...event, version } }),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByLabelText('Status des Events');
  const button = screen.getByRole('button', { name: 'Status speichern' });
  fireEvent.submit(button.closest('form')!);
  await screen.findByText(/Inzwischen geändert/);
  version = 1;
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Serverstand prüfen und Eingaben verwerfen',
    }),
  );
  await screen.findByText(/Aktualisierung steht aus/);
  expect(button.matches(':disabled')).toBe(true);
  version = 3;
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Serverstand prüfen und Eingaben verwerfen',
    }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Status speichern' })
        .matches(':disabled'),
    ).toBe(false),
  );
});

test('resource conflict reconciliation adopts the new version before another booking', async () => {
  let version = 2;
  const changed = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT')
      return Response.json({ error: 'conflict' }, { status: 409 });
    if (url.endsWith('/availability')) return Response.json([]);
    return Response.json({ ...detail, event: { ...event, version } });
  });
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={changed}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByLabelText('Status des Events');
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  await screen.findByText(/Keine physischen Einheiten/);
  const save = () =>
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Zuweisung und Termin speichern' })
        .closest('form')!,
    );
  save();
  await screen.findByText(/Inzwischen geändert/);
  version = 3;
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Serverstand prüfen und Eingaben verwerfen',
    }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Zuweisung und Termin speichern' })
        .matches(':disabled'),
    ).toBe(false),
  );
  expect(changed).toHaveBeenCalledWith('Serverstand aktualisiert.');
  expect(screen.queryByText('Ressourcen und Termin gespeichert.')).toBeNull();
  save();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
    ).toHaveLength(2),
  );
  const puts = fetcher.mock.calls.filter(
    ([, options]) => options?.method === 'PUT',
  );
  expect(JSON.parse(String(puts[1]![1]!.body)).version).toBe(3);
});

test('status reconciliation resets a draft even when the server version is unchanged', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? Response.json({ error: 'conflict' }, { status: 409 })
        : Response.json(detail),
    ),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  const select = await screen.findByLabelText('Status des Events');
  fireEvent.change(select, { target: { value: 'option' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText(/Inzwischen geändert/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Serverstand prüfen und Eingaben verwerfen',
    }),
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Status des Events') as HTMLSelectElement).value,
    ).toBe('inquiry'),
  );
});

test('resource reconciliation resets the selection when the server version is unchanged', async () => {
  const unit = {
    unitId: 'synthetic-box',
    resourceId: 'synthetic-resource',
    name: 'Fictional box',
    code: 'SYNTH',
    category: 'Fotobox',
    ordinal: 1,
    selected: false,
    periodSource: 'event',
    baseStart: event.startsAt,
    baseEnd: event.endsAt,
    beforeDays: 0,
    afterDays: 0,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    reason: null,
    conflicts: [],
    available: true,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) =>
      options
        ? Response.json({ error: 'conflict' }, { status: 409 })
        : url.endsWith('/availability')
          ? Response.json([unit])
          : Response.json(detail),
    ),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByLabelText('Status des Events');
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  const input = await screen.findByLabelText(
    'Fictional box · Einheit 1 zuweisen',
  );
  fireEvent.click(input);
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await screen.findByText(/Inzwischen geändert/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Serverstand prüfen und Eingaben verwerfen',
    }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByLabelText(
          'Fictional box · Einheit 1 zuweisen',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false),
  );
});

test('a failed generic reload cannot release an unresolved status conflict', async () => {
  let fail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) return Response.json({ error: 'conflict' }, { status: 409 });
      if (fail) throw Error('offline');
      return Response.json(detail);
    }),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByLabelText('Status des Events');
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText(/Inzwischen geändert/);
  fail = true;
  returnToApp();
  await screen.findByText(/Aktualisierung steht aus/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Neu laden und Eingaben verwerfen' }),
  );
  await screen.findByText(/Event-Details konnte nicht geladen/);
  expect(screen.getByLabelText('Eventname').matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  expect(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .matches(':disabled'),
  ).toBe(true);
});

test('a failed generic reload cannot release an unresolved resource conflict', async () => {
  let fail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options) return Response.json({ error: 'conflict' }, { status: 409 });
      if (url.endsWith('/availability')) return Response.json([]);
      if (fail) throw Error('offline');
      return Response.json(detail);
    }),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByLabelText('Status des Events');
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  await screen.findByText(/Keine physischen Einheiten/);
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await screen.findByText(/Inzwischen geändert/);
  fail = true;
  returnToApp();
  await screen.findByText(/Aktualisierung steht aus/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Neu laden und Eingaben verwerfen' }),
  );
  await screen.findByText(/Event-Details konnte nicht geladen/);
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByLabelText('Eventname').matches(':disabled')).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Status speichern' })
      .matches(':disabled'),
  ).toBe(true);
});

test('generic reload with a newer version preserves access to resource reconciliation', async () => {
  let version = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options) return Response.json({ error: 'conflict' }, { status: 409 });
      if (url.endsWith('/availability')) return Response.json([]);
      return Response.json({ ...detail, event: { ...event, version } });
    }),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByLabelText('Status des Events');
  fireEvent.click(screen.getByRole('button', { name: 'Ressourcen' }));
  await screen.findByText(/Keine physischen Einheiten/);
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .closest('form')!,
  );
  await screen.findByText(/Inzwischen geändert/);
  version = 2;
  returnToApp();
  await screen.findByText(/Aktualisierung steht aus/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Neu laden und Eingaben verwerfen' }),
  );
  await waitFor(() =>
    expect(screen.queryByText(/Aktualisierung steht aus/)).toBeNull(),
  );
  const reconcile = screen.getByRole('button', {
    name: 'Serverstand prüfen und Eingaben verwerfen',
  });
  expect(
    screen
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .matches(':disabled'),
  ).toBe(true);
  fireEvent.click(reconcile);
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Zuweisung und Termin speichern' })
        .matches(':disabled'),
    ).toBe(false),
  );
});

test('a confirmed primary contact change updates the contact overview without a detail reload', async () => {
  const initial = {
    ...event,
    primaryContactId: 'synthetic-contact',
    additionalContactIds: [],
  };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/v1/contacts?'))
      return Response.json([
        { id: 'fictional-new', name: 'Fictional new contact', state: 'active' },
      ]);
    if (options?.method === 'PUT')
      return Response.json({
        ...initial,
        ...JSON.parse(String(options.body)),
        version: 2,
      });
    return Response.json({ ...detail, event: initial });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  const search = await screen.findByLabelText('Hauptkontakt suchen');
  fireEvent.change(search, { target: { value: 'Fictional new' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional new contact/ }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  await waitFor(() =>
    expect(
      screen.getByText(/Hauptkontakt: Fictional new contact/),
    ).toBeTruthy(),
  );
  expect(screen.getByText(/Kontaktdaten noch nicht geladen/)).toBeTruthy();
  expect(screen.queryByText(/Hauptkontakt: Fictional contact/)).toBeNull();
});

test('contact reconciliation displays the actual details from the adopted server version', async () => {
  const initial = {
    ...event,
    primaryContactId: 'synthetic-contact',
    additionalContactIds: [],
  };
  const remote = {
    ...initial,
    version: 2,
    primaryContactId: 'fictional-remote',
  };
  let getCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/v1/contacts?'))
        return Response.json([
          { id: 'fictional-new', name: 'Fictional new', state: 'active' },
        ]);
      if (options?.method === 'PUT')
        return Response.json({ error: 'conflict' }, { status: 409 });
      getCount++;
      return Response.json(
        getCount === 1
          ? { ...detail, event: initial }
          : {
              ...detail,
              event: remote,
              contacts: [
                {
                  id: 'fictional-remote',
                  name: 'Fictional remote',
                  contactPerson: '',
                  email: 'fictional@example.invalid',
                  phone: '',
                  mobile: '',
                  role: 'primary',
                },
              ],
            },
      );
    }),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Hauptkontakt suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(await screen.findByRole('button', { name: /Fictional new/ }));
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  await screen.findByText(/Event wurde inzwischen geändert/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Serverstand übernehmen' }),
  );
  await screen.findByText(/Hauptkontakt: Fictional remote/);
  expect(
    screen.getByRole('link', { name: 'fictional@example.invalid' }),
  ).toBeTruthy();
});
