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
