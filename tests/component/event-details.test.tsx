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
  const changed = vi.fn().mockResolvedValue(undefined),
    edit = vi.fn(),
    close = vi.fn();
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      Object.assign(detail.event, JSON.parse(String(options.body)));
      detail.event.version = 2;
      return Response.json(detail.event);
    }
    return Response.json(detail);
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
  fireEvent.click(screen.getByRole('button', { name: 'Übersicht' }));
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
      ? Response.json({ error }, { status: 409 })
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
    ['conflict', /Inzwischen geändert/],
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
