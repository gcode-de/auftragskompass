import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const row = {
  id: 'synthetic-event',
  version: 1,
  name: 'Synthetic stored event',
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
  notesHtml: '',
};
const types = [
  { id: 'type-wedding', name: 'Hochzeit', state: 'active' },
  { id: 'type-party', name: 'Firmenfeier', state: 'active' },
];
const contacts = [
  { id: 'contact-main', name: 'Synthetic contact', state: 'active' },
  { id: 'contact-extra', name: 'Synthetic extra', state: 'active' },
];
function setup({
  supplied = {},
  listFailsAfter = 0,
}: {
  supplied?: Record<string, unknown>;
  listFailsAfter?: number;
} = {}) {
  let listLoads = 0,
    rows = [{ ...row, ...supplied }];
  const posts: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      posts.push(body);
      return Response.json({ ...row, ...body, id: 'created-event' });
    }
    if (url.startsWith('/api/v1/events')) {
      listLoads += 1;
      if (listFailsAfter && listLoads > listFailsAfter)
        return new Response(null, { status: 503 });
      return Response.json({ timeZone: 'Europe/Berlin', events: rows });
    }
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    if (url === '/api/v1/master-data/event_type') return Response.json(types);
    if (url === '/api/v1/contacts') return Response.json(contacts);
    if (url === '/api/v1/master-data/package')
      return Response.json([
        { id: 'package-main', name: 'Synthetic package', state: 'active' },
      ]);
    if (url === '/api/v1/locations')
      return Response.json([
        { id: 'location-main', name: 'Synthetic venue', state: 'active' },
      ]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, posts, setRows: (next: typeof rows) => (rows = next) };
}
async function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  return screen.findByRole('dialog', { name: 'Neues Event' });
}
async function ready() {
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic stored event – Ohne Datum – Anfrage');
}
test('a date-only create stores the business date and never invents midnight', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  expect(
    screen.getByText(
      'Datum, Kunde oder Eventart genügen. Alles Weitere ist optional.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByLabelText('Eventdatum').getAttribute('aria-describedby'),
  ).toBe('event-create-date-help');
  const ids = Array.from(document.querySelectorAll('[id]'), (element) =>
    element.getAttribute('id'),
  );
  expect(new Set(ids).size).toBe(ids.length);
  fireEvent.change(screen.getByLabelText('Kunde'), {
    target: { value: 'contact-main' },
  });
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'type-wedding' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2027-05-20' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    name: 'Hochzeit – Synthetic contact',
    status: 'inquiry',
    eventTypeId: 'type-wedding',
    primaryContactId: 'contact-main',
    eventDate: '2027-05-20',
    startsAt: null,
    endsAt: null,
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('the generated name is only a placeholder until a manual override is typed', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  const name = screen.getByLabelText('Eventname') as HTMLInputElement;
  expect(name.value).toBe('');
  expect(name.placeholder).toBe('Neues Event');
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'type-wedding' },
  });
  fireEvent.change(screen.getByLabelText('Kunde'), {
    target: { value: 'contact-main' },
  });
  expect(name.value).toBe('');
  expect(name.placeholder).toBe('Hochzeit – Synthetic contact');
  expect(posts).toHaveLength(0);
  name.focus();
  fireEvent.change(name, { target: { value: 'Synthetic manual name' } });
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'type-party' },
  });
  expect(name.value).toBe('Synthetic manual name');
  expect(name.placeholder).toBe('Firmenfeier – Synthetic contact');
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]!.name).toBe('Synthetic manual name');
});
test('an undated create remains possible and keeps both instants null', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    name: 'Neues Event',
    eventDate: null,
    startsAt: null,
    endsAt: null,
  });
});
test('optional times live under Weitere Angaben and resolve the tenant timezone', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2027-05-20T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2027-05-20T20:00' },
  });
  expect((screen.getByLabelText('Eventdatum') as HTMLInputElement).value).toBe(
    '2027-05-20',
  );
  expect(
    (screen.getByLabelText('Eventdatum') as HTMLInputElement).readOnly,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    eventDate: '2027-05-20',
    startsAt: '2027-05-20T16:00:00Z',
    endsAt: '2027-05-20T18:00:00Z',
  });
});
test('advanced values survive collapsing and expanding without autosave', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  const advanced = screen
    .getByText('Weitere Angaben', { exact: true })
    .closest('details')!;
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  fireEvent.change(screen.getByLabelText('Anfragequelle'), {
    target: { value: 'Synthetic source' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeschreibung'), {
    target: { value: 'Synthetic description' },
  });
  fireEvent.change(screen.getByLabelText('Interne Notizen'), {
    target: { value: '<strong>Fictional</strong>' },
  });
  fireEvent.change(screen.getByLabelText('Fotobox-Paket'), {
    target: { value: 'package-main' },
  });
  fireEvent.change(screen.getByLabelText('Veranstaltungsort'), {
    target: { value: 'location-main' },
  });
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  expect(advanced.open).toBe(false);
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  expect(advanced.open).toBe(true);
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
    (screen.getByLabelText('Fotobox-Paket') as HTMLSelectElement).value,
  ).toBe('package-main');
  expect(
    (screen.getByLabelText('Veranstaltungsort') as HTMLSelectElement).value,
  ).toBe('location-main');
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    packageId: 'package-main',
    locationId: 'location-main',
    source: 'Synthetic source',
    description: 'Synthetic description',
    notesHtml: '<strong>Fictional</strong>',
  });
});
test('Escape and close write nothing, keep the focus trap and return focus', async () => {
  const { posts } = setup();
  await ready();
  const trigger = screen.getByRole('button', { name: 'Event anlegen' });
  await openCreate();
  const date = screen.getByLabelText('Eventdatum');
  await waitFor(() => expect(document.activeElement).toBe(date));
  fireEvent.keyDown(date, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(posts).toHaveLength(0);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await openCreate();
  const close = screen.getByRole('button', { name: 'Dialog schließen' });
  expect(close.getAttribute('title')).toBe('Dialog schließen');
  const save = screen.getByRole('button', { name: 'Event speichern' });
  save.focus();
  fireEvent.keyDown(save, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(save);
  fireEvent.click(close);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(posts).toHaveLength(0);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
test('editing typed text over a placeholder never clears the stored value', async () => {
  const { posts } = setup();
  await ready();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic stored event',
    }),
  );
  const name = screen.getByLabelText('Eventname') as HTMLInputElement;
  expect(name.value).toBe('Synthetic stored event');
  name.focus();
  fireEvent.change(name, {
    target: { value: 'Synthetic stored event – ergänzt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]!.name).toBe('Synthetic stored event – ergänzt');
});
test('a double submission sends exactly one POST', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  const form = screen
    .getByRole('button', { name: 'Event speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText('Event gespeichert.');
  expect(posts).toHaveLength(1);
});
test('a confirmed create closes the dialog even when the list reload fails', async () => {
  const { posts } = setup({ listFailsAfter: 1 });
  await ready();
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  await screen.findByText(/Liste konnte nicht neu geladen werden/);
  expect(posts).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText(/Speichern fehlgeschlagen/)).toBeNull();
});

test('an open edit draft blocks create and duplicate, then focus survives cancel', async () => {
  const { posts } = setup();
  await ready();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic stored event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic dirty draft' },
  });
  const create = screen.getByRole('button', { name: 'Event anlegen' });
  expect((create as HTMLButtonElement).disabled).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'Event duplizieren: Synthetic stored event',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getAllByLabelText('Eventdatum')).toHaveLength(1);
  fireEvent.click(create);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic dirty draft',
  );
  const edit = screen.getByRole('button', {
    name: 'Event bearbeiten: Synthetic stored event',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event abbrechen' }));
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(document.activeElement).toBe(edit);
  expect(posts).toHaveLength(0);
  fireEvent.click(create);
  expect(
    await screen.findByRole('dialog', { name: 'Neues Event' }),
  ).toBeTruthy();
});
test('Escape and close do nothing while the create POST is still pending', async () => {
  let resolvePost!: (response: Response) => void;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options)
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    if (url.startsWith('/api/v1/events'))
      return Promise.resolve(
        Response.json({ timeZone: 'Europe/Berlin', events: [{ ...row }] }),
      );
    if (url === '/api/v1/statuses')
      return Promise.resolve(
        Response.json([{ code: 'inquiry', label: 'Anfrage' }]),
      );
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal('fetch', fetcher);
  await ready();
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  const close = screen.getByRole('button', { name: 'Dialog schließen' });
  expect((close as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('Eventdatum'), { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Neues Event' })).toBeTruthy();
  resolvePost(Response.json({ ...row, id: 'created-event' }));
  await screen.findByText('Event gespeichert.');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('focus returns to the surviving edit trigger after a confirmed edit save', async () => {
  setup();
  await ready();
  const edit = screen.getByRole('button', {
    name: 'Event bearbeiten: Synthetic stored event',
  });
  fireEvent.click(edit);
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic confirmed edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: /Event bearbeiten: Synthetic/ }),
  );
});
test('a failed pending create keeps the dialog open and closeable', async () => {
  let resolvePost!: (response: Response) => void;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options)
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    if (url.startsWith('/api/v1/events'))
      return Promise.resolve(
        Response.json({ timeZone: 'Europe/Berlin', events: [{ ...row }] }),
      );
    if (url === '/api/v1/statuses')
      return Promise.resolve(
        Response.json([{ code: 'inquiry', label: 'Anfrage' }]),
      );
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal('fetch', fetcher);
  await ready();
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  const close = screen.getByRole('button', { name: 'Dialog schließen' });
  expect((close as HTMLButtonElement).disabled).toBe(true);
  resolvePost(Response.json({ error: 'conflict' }, { status: 409 }));
  await screen.findByText(/Inzwischen geändert/);
  expect(screen.getByRole('dialog', { name: 'Neues Event' })).toBeTruthy();
  expect((close as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(close);
  expect(screen.queryByRole('dialog')).toBeNull();
});
