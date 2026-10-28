import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
test('additional contact selection saves on blur and Escape discards a later draft', async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) =>
    url.startsWith('/api/v1/contacts?')
      ? Response.json([
          { id: 'new', name: 'Fictional additional', state: 'active' },
        ])
      : Response.json({
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
  const search = screen.getByLabelText('Weitere Kontakte suchen');
  fireEvent.change(search, { target: { value: 'Fictional' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional additional/ }),
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
  ).toHaveLength(0);
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
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
  ).toMatchObject({ version: 1, additionalContactIds: ['new'] });
  await screen.findByText(/Alle Änderungen gespeichert/);
  fireEvent.click(
    screen.getByRole('button', { name: /Fictional additional entfernen/ }),
  );
  fireEvent.keyDown(search, { key: 'Escape' });
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT'),
  ).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: /Fictional additional entfernen/ }),
  ).toBeTruthy();
});
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
  expect(screen.getByRole('group', { name: 'Weitere Kontakte' })).toBeTruthy();
});

test('additional contact conflict rebases the submitted removal over remote additions', async () => {
  const base = { ...event, additionalContactIds: ['old', 'keep'] };
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        return bodies.length === 1
          ? Response.json({}, { status: 409 })
          : Response.json({ ...base, ...body, version: 3 });
      }
      return Response.json({
        event: {
          ...base,
          additionalContactIds: ['old', 'keep', 'remote'],
          version: 2,
        },
      });
    }),
  );
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[
        { id: 'old', name: 'Fictional old' },
        { id: 'keep', name: 'Fictional keep' },
      ]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
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
    additionalContactIds: ['keep', 'remote'],
  });
  await screen.findByText(/Alle Änderungen gespeichert/);
});

test('reconciliation rebases an unsubmitted draft over remote additions and removals', async () => {
  const base = { ...event, additionalContactIds: ['old', 'gone'] };
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/v1/contacts?'))
        return Response.json([
          { id: 'draft', name: 'Fictional draft', state: 'active' },
        ]);
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        return bodies.length === 1
          ? Response.json({}, { status: 409 })
          : Response.json({ ...base, ...body, version: bodies.length + 1 });
      }
      return Response.json({
        event: { ...base, additionalContactIds: ['old', 'remote'], version: 2 },
      });
    }),
  );
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[
        { id: 'old', name: 'Fictional old' },
        { id: 'gone', name: 'Fictional gone' },
      ]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Changed' },
  });
  fireEvent.blur(screen.getByLabelText('Eventname'));
  await screen.findByText(/Event wurde inzwischen geändert/);
  fireEvent.change(screen.getByLabelText('Weitere Kontakte suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fictional draft/ }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Meine abgeschlossenen Änderungen anwenden',
    }),
  );
  await waitFor(() => expect(bodies).toHaveLength(2));
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2]).toMatchObject({
    additionalContactIds: ['old', 'remote', 'draft'],
  });
});

test('a remote contact removed while a rebased write is in flight remains removed', async () => {
  const base = { ...event, additionalContactIds: ['old'] };
  const bodies: Record<string, unknown>[] = [];
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        if (bodies.length === 1) return Response.json({}, { status: 409 });
        return bodies.length === 2
          ? pending
          : Response.json({ ...base, ...body, version: 4 });
      }
      return Response.json({
        event: { ...base, additionalContactIds: ['old', 'remote'], version: 2 },
      });
    }),
  );
  render(
    <EventInlineEditor
      event={base}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[
        { id: 'old', name: 'Fictional old' },
        { id: 'remote', name: 'Fictional remote' },
      ]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
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
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional remote entfernen' }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
  release(Response.json({ ...base, ...bodies[1], version: 3 }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2]).toMatchObject({ version: 3, additionalContactIds: [] });
  await screen.findByText(/Alle Änderungen gespeichert/);
});

test('queued rebased additions preserve remote removal and Escape during the first write', async () => {
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
          { id: 'a', name: 'Fictional A', state: 'active' },
          { id: 'b', name: 'Fictional B', state: 'active' },
        ]);
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        if (bodies.length === 1) return Response.json({}, { status: 409 });
        return bodies.length === 2
          ? pending
          : Response.json({ ...event, ...body, version: bodies.length + 1 });
      }
      return Response.json({
        event: { ...event, additionalContactIds: ['remote'], version: 2 },
      });
    }),
  );
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[{ id: 'remote', name: 'Fictional remote' }]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const search = screen.getByLabelText('Weitere Kontakte suchen');
  const group = screen.getByRole('group', { name: 'Weitere Kontakte' });
  fireEvent.change(search, { target: { value: 'Fictional' } });
  fireEvent.click(await screen.findByRole('button', { name: /Fictional A/ }));
  fireEvent.blur(group);
  await screen.findByText(/Event wurde inzwischen geändert/);
  fireEvent.click(screen.getByRole('button', { name: /Fictional B/ }));
  fireEvent.blur(group);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Meine abgeschlossenen Änderungen anwenden',
    }),
  );
  await waitFor(() => expect(bodies).toHaveLength(2));
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional remote entfernen' }),
  );
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(
    screen.getByRole('button', { name: 'Fictional remote entfernen' }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional remote entfernen' }),
  );
  fireEvent.blur(group);
  release(Response.json({ ...event, ...bodies[1], version: 3 }));
  await waitFor(() => expect(bodies).toHaveLength(4));
  expect(bodies[3]).toMatchObject({
    version: 4,
    additionalContactIds: ['a', 'b'],
  });
  await screen.findByText(/Alle Änderungen gespeichert/);
});

test('a second conflict does not restore a remote contact removed on the server', async () => {
  const bodies: Record<string, unknown>[] = [];
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/v1/contacts?'))
        return Response.json([
          { id: 'a', name: 'Fictional A', state: 'active' },
          { id: 'b', name: 'Fictional B', state: 'active' },
          { id: 'c', name: 'Fictional C', state: 'active' },
        ]);
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        return bodies.length <= 2
          ? Response.json({}, { status: 409 })
          : Response.json({ ...event, ...body, version: bodies.length + 1 });
      }
      reads++;
      return Response.json({
        event: {
          ...event,
          additionalContactIds: reads === 1 ? ['remote'] : [],
          version: reads + 1,
        },
      });
    }),
  );
  render(
    <EventInlineEditor
      event={event}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[{ id: 'remote', name: 'Fictional remote' }]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const search = screen.getByLabelText('Weitere Kontakte suchen');
  const group = screen.getByRole('group', { name: 'Weitere Kontakte' });
  fireEvent.change(search, { target: { value: 'Fictional' } });
  fireEvent.click(await screen.findByRole('button', { name: /Fictional A/ }));
  fireEvent.blur(group);
  await screen.findByText(/Event wurde inzwischen geändert/);
  fireEvent.click(screen.getByRole('button', { name: /Fictional B/ }));
  fireEvent.blur(group);
  for (let i = 0; i < 2; i++) {
    fireEvent.click(
      screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Meine abgeschlossenen Änderungen anwenden',
      }),
    );
    if (i === 0) {
      await screen.findByText(/Event wurde inzwischen geändert/);
      fireEvent.click(screen.getByRole('button', { name: /Fictional C/ }));
    }
  }
  await waitFor(() => expect(bodies).toHaveLength(4));
  expect(
    screen.queryByRole('button', { name: 'Fictional remote entfernen' }),
  ).toBeNull();
  fireEvent.blur(group);
  await waitFor(() => expect(bodies).toHaveLength(5));
  expect(bodies.at(-1)).toMatchObject({
    additionalContactIds: ['a', 'b', 'c'],
  });
  await screen.findByText(/Alle Änderungen gespeichert/);
});

test('queued additional changes and Escape retain the earlier submission', async () => {
  const base = { ...event, additionalContactIds: ['old'] };
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
          { id: 'one', name: 'Fictional one', state: 'active' },
          { id: 'two', name: 'Fictional two', state: 'active' },
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
      contacts={[{ id: 'old', name: 'Fictional old' }]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const group = screen.getByRole('group', { name: 'Weitere Kontakte' });
  const search = screen.getByLabelText('Weitere Kontakte suchen');
  fireEvent.change(search, { target: { value: 'Fictional' } });
  fireEvent.click(await screen.findByRole('button', { name: /Fictional one/ }));
  fireEvent.blur(group);
  fireEvent.click(screen.getByRole('button', { name: /Fictional two/ }));
  fireEvent.blur(group);
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  );
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  ).toBeTruthy();
  release(Response.json({ ...base, ...bodies[0], version: 2 }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    additionalContactIds: ['old', 'one', 'two'],
  });
  await screen.findByText(/Alle Änderungen gespeichert/);
});

test('lost response followed by an already applied server change clears the queue', async () => {
  const base = { ...event, additionalContactIds: ['old'] };
  let puts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/v1/contacts?'))
        return Response.json([
          { id: 'new', name: 'Fictional new', state: 'active' },
        ]);
      if (options?.method === 'PUT') {
        puts++;
        throw Error('lost');
      }
      return Response.json({
        event: {
          ...base,
          additionalContactIds: ['old', 'new', 'remote'],
          version: 2,
        },
      });
    }),
  );
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
  fireEvent.change(screen.getByLabelText('Weitere Kontakte suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(await screen.findByRole('button', { name: /Fictional new/ }));
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
  await screen.findByText(/Speichern nicht bestätigt/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Meine abgeschlossenen Änderungen anwenden',
    }),
  );
  await screen.findByText(/Alle Änderungen gespeichert/);
  expect(puts).toBe(1);
  expect(screen.getAllByRole('button', { name: /entfernen/ })).toHaveLength(3);
});

test('a queued primary change cannot restore a previously removed additional contact', async () => {
  const base = {
    ...event,
    primaryContactId: 'primary',
    additionalContactIds: ['old', 'new'],
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
          { id: 'new', name: 'Fictional new', state: 'active' },
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
      contacts={[
        { id: 'old', name: 'Fictional old' },
        { id: 'new', name: 'Fictional new' },
      ]}
      locked={false}
      canEdit={() => true}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Weitere Kontakte' }));
  fireEvent.change(screen.getByLabelText('Hauptkontakt suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.click(
    await within(
      screen.getByRole('group', { name: 'Hauptkontakt' }),
    ).findByRole('button', { name: /Fictional new/ }),
  );
  fireEvent.blur(screen.getByRole('group', { name: 'Hauptkontakt' }));
  release(Response.json({ ...base, ...bodies[0], version: 2 }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    primaryContactId: 'new',
    additionalContactIds: [],
  });
  await screen.findByText(/Alle Änderungen gespeichert/);
});

test('search explains excluded contacts and blocks additions at the server limit', async () => {
  const ids = Array.from({ length: 50 }, (_, index) => `id-${index}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.includes('other')
          ? [{ id: 'new', name: 'Fictional other', state: 'active' }]
          : [{ id: 'id-0', name: 'Fictional assigned', state: 'active' }],
      ),
    ),
  );
  render(
    <EventInlineEditor
      event={{ ...event, additionalContactIds: ids }}
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
  fireEvent.change(screen.getByLabelText('Weitere Kontakte suchen'), {
    target: { value: 'Fictional' },
  });
  await screen.findByText('Keine weiteren Kontakte gefunden.');
  expect(screen.getByText('Maximal 50 weitere Kontakte möglich.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Weitere Kontakte suchen'), {
    target: { value: 'other' },
  });
  expect(
    (
      (await screen.findByRole('button', {
        name: /Fictional other/,
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test('additional contact search failure and keyboard guards preserve the draft', async () => {
  let editable = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('fail')
        ? Response.json({}, { status: 500 })
        : Response.json([
            { id: 'new', name: 'Fictional new', state: 'active' },
          ]),
    ),
  );
  render(
    <EventInlineEditor
      event={{ ...event, additionalContactIds: ['old'] }}
      csrfToken="synthetic"
      types={[]}
      packages={[]}
      locations={[]}
      contacts={[{ id: 'old', name: 'Fictional old' }]}
      locked={false}
      canEdit={() => editable}
      onDirtyChange={() => {}}
      onConfirmed={() => {}}
    />,
  );
  const group = screen.getByRole('group', { name: 'Weitere Kontakte' });
  const search = screen.getByLabelText('Weitere Kontakte suchen');
  fireEvent.change(search, { target: { value: 'fail' } });
  await screen.findByText(/Kontakte konnten nicht gesucht werden/);
  fireEvent.change(search, { target: { value: 'new' } });
  const choice = await screen.findByRole('button', { name: /Fictional new/ });
  editable = false;
  fireEvent.click(choice);
  fireEvent.click(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  );
  fireEvent.blur(group);
  expect(
    screen.getByRole('button', { name: 'Fictional old entfernen' }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Fictional new entfernen' }),
  ).toBeNull();
  editable = true;
  fireEvent.click(choice);
  fireEvent.blur(group, { relatedTarget: search });
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect(
    screen.getByRole('button', { name: 'Fictional new entfernen' }),
  ).toBeTruthy();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(
    screen.queryByRole('button', { name: 'Fictional new entfernen' }),
  ).toBeNull();
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
