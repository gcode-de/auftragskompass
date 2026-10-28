import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { EventInlineEditor } from '../../apps/admin/src/EventInlineEditor.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const event = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  name: 'Synthetic event',
  status: 'inquiry',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue: null,
  venueOverride: false,
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  eventDate: null,
  startsAt: null,
  endsAt: null,
  timeZone: 'Europe/Berlin',
  description: '',
  notesHtml: 'private note',
};
test('Escape discards one field and blurred changes send a full versioned whitelist', async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) =>
      Response.json({
        ...event,
        ...JSON.parse(String(options?.body)),
        version: 2,
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const name = screen.getByLabelText('Eventname');
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: 'Discarded' } });
  fireEvent.keyDown(name, { key: 'Escape' });
  fireEvent.blur(name);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: 'Changed' } });
  fireEvent.blur(name);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
  expect(body).toMatchObject({
    name: 'Changed',
    version: 1,
    status: 'inquiry',
    notesHtml: 'private note',
  });
  expect(body).not.toHaveProperty('id');
  expect(body).not.toHaveProperty('timeZone');
  expect(body).not.toHaveProperty('resources');
});

test('serializes blurred fields and preserves location override semantics', async () => {
  const bodies: Record<string, unknown>[] = [];
  let finish!: (response: Response) => void;
  const first = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      return bodies.length === 1
        ? first
        : Response.json({ ...event, ...body, version: 3 });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={{
        ...event,
        locationId: 'location-old',
        venue: 'Older override',
        venueOverride: false,
      }}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[
        { id: 'location-old', name: 'Old place', state: 'active' },
        { id: 'location-new', name: 'New place', state: 'active' },
      ]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const name = screen.getByLabelText('Eventname'),
    location = screen.getByLabelText('Gespeicherter Ort');
  fireEvent.change(name, { target: { value: 'Changed' } });
  fireEvent.blur(name);
  fireEvent.change(location, { target: { value: 'location-new' } });
  fireEvent.blur(location);
  expect(bodies).toHaveLength(1);
  finish(
    Response.json({
      ...event,
      locationId: 'location-old',
      venue: 'Older override',
      venueOverride: false,
      name: 'Changed',
      version: 2,
    }),
  );
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    locationId: 'location-new',
    venueOverride: false,
    venue: 'Older override',
    name: 'Changed',
  });
});

test('a conflict preserves the draft until an explicit reconciliation', async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) =>
      options?.method === 'PUT'
        ? Response.json({ error: 'conflict' }, { status: 409 })
        : Response.json({
            event: { ...event, name: 'Server name', version: 2 },
          }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const name = screen.getByLabelText('Eventname') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'My draft' } });
  fireEvent.blur(name);
  expect(
    await screen.findByText(/Event wurde inzwischen geändert/),
  ).toBeTruthy();
  expect(name.value).toBe('My draft');
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  expect(await screen.findByText(/Serverstand: Server name/)).toBeTruthy();
  expect(name.value).toBe('My draft');
});

test('returns to the already assigned saved location without deleting the old override', async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) =>
      Response.json({
        ...event,
        ...JSON.parse(String(options?.body)),
        version: 2,
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={{
        ...event,
        locationId: 'location-old',
        venue: 'Individual address',
        venueOverride: true,
      }}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[{ id: 'location-old', name: 'Saved hall', state: 'active' }]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Gespeicherten Ort verwenden' }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
  expect(body).toMatchObject({
    locationId: 'location-old',
    venue: 'Individual address',
    venueOverride: false,
  });
});

test('invalid names and synchronous write locks prevent saves', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const canEdit = vi.fn(() => true);
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={canEdit}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const name = screen.getByLabelText('Eventname');
  fireEvent.change(name, { target: { value: '   ' } });
  fireEvent.blur(name);
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('alert').textContent).toContain('markierte Feld');
  canEdit.mockReturnValue(false);
  fireEvent.change(name, { target: { value: 'Ignored' } });
  fireEvent.blur(name);
  expect(fetcher).not.toHaveBeenCalled();
});

test('malformed confirmed responses pause and require an explicit successful read before using server state', async () => {
  let readFail = true;
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT')
        return Response.json({ id: event.id, version: 2 });
      return readFail
        ? new Response(null, { status: 503 })
        : Response.json({
            event: { ...event, name: 'Server version', version: 2 },
          });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const onConfirmed = vi.fn();
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={onConfirmed}
    />,
  );
  const name = screen.getByLabelText('Eventname') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'My draft' } });
  fireEvent.blur(name);
  expect(await screen.findByText(/Speichern nicht bestätigt/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  expect(
    await screen.findByText(/Serverstand konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(name.value).toBe('My draft');
  readFail = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  await screen.findByText(/Serverstand: Server version/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Serverstand übernehmen' }),
  );
  await waitFor(() => expect(name.value).toBe('Server version'));
  expect(onConfirmed).toHaveBeenCalledWith(
    expect.objectContaining({ version: 2, name: 'Server version' }),
  );
});

test('network failure retains the draft until applying it to an explicitly read server version', async () => {
  let writes = 0;
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        writes++;
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        if (writes === 1) throw Error('offline');
        return Response.json({ ...event, ...body, version: 3 });
      }
      return Response.json({
        event: { ...event, source: 'Remote source', version: 2 },
      });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const name = screen.getByLabelText('Eventname') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'My draft' } });
  fireEvent.blur(name);
  await screen.findByText(/Speichern nicht bestätigt/);
  expect(writes).toBe(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  await screen.findByRole('button', {
    name: 'Meine abgeschlossenen Änderungen anwenden',
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Meine abgeschlossenen Änderungen anwenden',
    }),
  );
  await waitFor(() => expect(writes).toBe(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    name: 'My draft',
    source: 'Remote source',
  });
});

test('primary contact selection is a draft until blur and removes only its duplicate', async () => {
  const base = {
    ...event,
    primaryContactId: 'old',
    additionalContactIds: ['new', 'other'],
  };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) =>
    url.startsWith('/api/v1/contacts?')
      ? Response.json([
          { id: 'new', name: 'Fictional customer', state: 'active' },
        ])
      : Response.json({
          ...base,
          ...JSON.parse(String(options?.body)),
          version: 2,
        }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const search = screen.getByLabelText('Hauptkontakt suchen');
  fireEvent.change(search, { target: { value: 'Fictional' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional customer/ }),
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
  ).toHaveLength(0);
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
    ).toHaveLength(1),
  );
  const body = JSON.parse(
    String(
      fetcher.mock.calls.find(([, options]) => options?.method === 'PUT')![1]!
        .body,
    ),
  );
  expect(body).toMatchObject({
    version: 1,
    primaryContactId: 'new',
    additionalContactIds: ['other'],
  });
});

test('Escape discards a new contact choice and restores additional contacts before a later save', async () => {
  const base = {
    ...event,
    primaryContactId: 'old',
    additionalContactIds: ['new', 'other'],
  };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) =>
    url.startsWith('/api/v1/contacts?')
      ? Response.json([
          { id: 'new', name: 'Fictional customer', state: 'active' },
        ])
      : Response.json({
          ...base,
          ...JSON.parse(String(options?.body)),
          version: 2,
        }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[{ id: 'old', name: 'Fictional old' }]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const search = screen.getByLabelText('Hauptkontakt suchen');
  fireEvent.change(search, { target: { value: 'Fictional' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional customer/ }),
  );
  fireEvent.keyDown(search, { key: 'Escape' });
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  expect(screen.getByText(/Kunde: Fictional old/)).toBeTruthy();
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
  ).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Changed' },
  });
  fireEvent.blur(screen.getByLabelText('Eventname'));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
    ).toHaveLength(1),
  );
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find(([, options]) => options?.method === 'PUT')![1]!
          .body,
      ),
    ),
  ).toMatchObject({
    primaryContactId: 'old',
    additionalContactIds: ['new', 'other'],
  });
});

test('primary contact conflict pauses writes until explicit reconciliation', async () => {
  const base = {
    ...event,
    primaryContactId: 'old',
    additionalContactIds: ['new', 'other'],
  };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) =>
    url.startsWith('/api/v1/contacts?')
      ? Response.json([
          { id: 'new', name: 'Fictional customer', state: 'active' },
        ])
      : options?.method === 'PUT'
        ? Response.json({ error: 'conflict' }, { status: 409 })
        : Response.json({ event: { ...base, version: 2 } }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Hauptkontakt suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional customer/ }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  await screen.findByText(/Event wurde inzwischen geändert/);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  await screen.findByRole('button', {
    name: 'Meine abgeschlossenen Änderungen anwenden',
  });
  expect(screen.getByText('Weitere Kontakte')).toBeTruthy();
});

test('contact reconciliation preserves additional contacts added on the server', async () => {
  const base = {
    ...event,
    primaryContactId: 'old',
    additionalContactIds: ['new', 'other'],
  };
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/v1/contacts?'))
      return Response.json([
        { id: 'new', name: 'Fictional customer', state: 'active' },
      ]);
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body));
      bodies.push(body);
      return bodies.length === 1
        ? Response.json({ error: 'conflict' }, { status: 409 })
        : Response.json({ ...base, ...body, version: 3 });
    }
    return Response.json({
      event: {
        ...base,
        additionalContactIds: ['new', 'other', 'remote'],
        version: 2,
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Hauptkontakt suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional customer/ }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  await screen.findByText(/Event wurde inzwischen geändert/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Meine abgeschlossenen Änderungen anwenden',
    }),
  );
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    primaryContactId: 'new',
    additionalContactIds: ['other', 'remote'],
  });
  await screen.findByText(/Alle Änderungen gespeichert/);
  expect(screen.getByText(/Kunde: Fictional customer/)).toBeTruthy();
});

test('existing contact with unknown state is shown neutrally and archived hits cannot be chosen', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        { id: 'archived', name: 'Fictional archived', state: 'archived' },
      ]),
    ),
  );
  render(
    <EventInlineEditor
      event={{ ...event, primaryContactId: 'old' }}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[{ id: 'old', name: 'Fictional existing' }]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  expect(screen.getByText('Kunde: Fictional existing')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Hauptkontakt suchen'), {
    target: { value: 'Fictional' },
  });
  const archived = await screen.findByRole('button', {
    name: /Fictional archived/,
  });
  expect((archived as HTMLButtonElement).disabled).toBe(true);
  expect(
    screen.queryByRole('button', { name: 'Neuen Kunden anlegen' }),
  ).toBeNull();
});

test('queued contact choices use the confirmed version and preserve the other contacts', async () => {
  const base = {
    ...event,
    primaryContactId: 'old',
    additionalContactIds: ['first', 'second', 'other'],
  };
  const bodies: Record<string, unknown>[] = [];
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/v1/contacts?'))
        return Response.json([
          { id: 'first', name: 'Fictional first', state: 'active' },
          { id: 'second', name: 'Fictional second', state: 'active' },
        ]);
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      return bodies.length === 1
        ? pending
        : Response.json({ ...base, ...body, version: 3 });
    }),
  );
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Hauptkontakt suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional first/ }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  fireEvent.click(screen.getByRole('button', { name: /Fictional second/ }));
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  expect(bodies).toHaveLength(1);
  release(Response.json({ ...base, ...bodies[0], version: 2 }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    primaryContactId: 'second',
    additionalContactIds: ['other'],
  });
});
