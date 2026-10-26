import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
import { EventCreateDialog } from '../../apps/admin/src/EventCreateDialog.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
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
  venue: null as string | null,
  venueOverride: false,
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
type ContactHit = {
  id: string;
  name: string;
  state: string;
  kind?: string;
  contactPerson?: string;
  city?: string;
};
const hit = (
  id: string,
  name: string,
  extra: Partial<ContactHit> = {},
): ContactHit => ({
  id,
  name,
  state: 'active',
  kind: 'company',
  contactPerson: '',
  city: 'Fictional Town',
  ...extra,
});
const dialogProps = {
  csrfToken: 'csrf',
  timeZone: 'Europe/Berlin',
  statuses: [{ code: 'inquiry', label: 'Anfrage' }],
  types,
  packages: [],
  locations: [],
  contacts,
  initial: null,
  onClose: vi.fn(),
  onCreated: vi.fn().mockResolvedValue(undefined),
};
function setup({
  supplied = {},
  listFailsAfter = 0,
  locationChoices = [
    { id: 'location-main', name: 'Synthetic venue', state: 'active' },
  ],
  contactRows = contacts,
  contactPost,
}: {
  supplied?: Record<string, unknown>;
  listFailsAfter?: number;
  locationChoices?: Record<string, unknown>[];
  contactRows?: ContactHit[];
  contactPost?: (body: Record<string, unknown>) => Response;
} = {}) {
  let listLoads = 0,
    rows = [{ ...row, ...supplied }],
    searchFails = false;
  const posts: Record<string, unknown>[] = [];
  const contactPosts: Record<string, unknown>[] = [];
  const searches: string[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/v1/contacts')) {
      if (options) {
        const body = JSON.parse(String(options.body)) as Record<
          string,
          unknown
        >;
        contactPosts.push(body);
        return (
          contactPost?.(body) ??
          Response.json({ ...body, id: 'contact-created', version: 1 })
        );
      }
      searches.push(url);
      if (searchFails) return new Response(null, { status: 503 });
      const query = decodeURIComponent(
        new URL(url, 'https://synthetic.invalid').searchParams.get('q') ?? '',
      ).toLowerCase();
      return Response.json(
        contactRows.filter(
          (entry) => !query || entry.name.toLowerCase().includes(query),
        ),
      );
    }
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
    if (url === '/api/v1/master-data/package')
      return Response.json([
        { id: 'package-main', name: 'Synthetic package', state: 'active' },
      ]);
    if (url === '/api/v1/locations') return Response.json(locationChoices);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  return {
    fetcher,
    posts,
    contactPosts,
    searches,
    failSearch: () => {
      searchFails = true;
    },
    setRows: (next: typeof rows) => (rows = next),
  };
}
async function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Event anlegen' }));
  return screen.findByRole('dialog', { name: 'Neues Event' });
}
/** The picker is the only way to a stored contact: search, then choose. */
async function pickContact(name: string) {
  fireEvent.change(screen.getByLabelText('Kunde suchen'), {
    target: { value: name },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(name) }),
  );
}
function submitContact(form: HTMLElement) {
  fireEvent.submit(form);
}
async function ready() {
  render(<EventPanel csrfToken="csrf" />);
  // BKP014.1: the row is a card with one open action.
  await screen.findByRole('link', { name: /Synthetic stored event/ });
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
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'type-wedding' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2027-05-20' },
  });
  await pickContact('Synthetic contact');
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
  await pickContact('Synthetic contact');
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
  fireEvent.change(screen.getByLabelText('Ort / Adresse'), {
    target: { value: 'Fictional Hall\nSide entrance' },
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
    (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
  ).toBe('Fictional Hall\nSide entrance');
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    packageId: 'package-main',
    locationId: null,
    venue: 'Fictional Hall\nSide entrance',
    venueOverride: true,
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

test('a duplicate keeps the visible free-form place and raw legacy link', async () => {
  const { posts } = setup({
    supplied: {
      locationId: 'location-main',
      venue: 'Fictional Copy Hall',
      venueOverride: true,
    },
  });
  await ready();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event duplizieren: Synthetic stored event',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  fireEvent.click(within(dialog).getByText('Weitere Angaben', { exact: true }));
  expect(
    (within(dialog).getByLabelText('Ort / Adresse') as HTMLTextAreaElement)
      .value,
  ).toBe('Fictional Copy Hall');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Event speichern' }),
  );
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    locationId: 'location-main',
    venue: 'Fictional Copy Hall',
    venueOverride: true,
  });
});

test('a fresh booking never sends a hidden location reference', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2027-06-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({ locationId: null });
  expect(posts[0]).not.toHaveProperty('venue');
});

test('a duplicate of an archived legacy place keeps the visible place as text', async () => {
  const { posts } = setup({
    supplied: {
      locationId: 'location-archived',
      venue: null,
      venueOverride: false,
    },
    locationChoices: [
      {
        id: 'location-archived',
        name: 'Synthetic archived hall',
        state: 'archived',
        street: 'Fictional Street 1',
        postalCode: '12345',
        city: 'Fictional Town',
        country: 'DE',
      },
    ],
  });
  await ready();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event duplizieren: Synthetic stored event',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  fireEvent.click(within(dialog).getByText('Weitere Angaben', { exact: true }));
  expect(
    (within(dialog).getByLabelText('Ort / Adresse') as HTMLTextAreaElement)
      .value,
  ).toBe(
    'Synthetic archived hall\nFictional Street 1\n12345 Fictional Town\nDE',
  );
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Event speichern' }),
  );
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    locationId: null,
    venue:
      'Synthetic archived hall\nFictional Street 1\n12345 Fictional Town\nDE',
    venueOverride: true,
  });
});

test('the dialog prefills the complete legacy address and honours the text bound', async () => {
  const { posts } = setup({
    supplied: { locationId: 'location-main' },
    locationChoices: [
      {
        id: 'location-main',
        name: 'Synthetic venue',
        state: 'active',
        street: 'Fictional Street 5',
        postalCode: '12345',
        city: 'Fictional Town',
        country: 'DE',
      },
    ],
  });
  await ready();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event duplizieren: Synthetic stored event',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  fireEvent.click(within(dialog).getByText('Weitere Angaben', { exact: true }));
  const field = within(dialog).getByLabelText(
    'Ort / Adresse',
  ) as HTMLTextAreaElement;
  expect(field.value).toBe(
    'Synthetic venue\nFictional Street 5\n12345 Fictional Town\nDE',
  );
  expect(field.maxLength).toBe(1000);
  expect(field.tagName).toBe('TEXTAREA');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Event speichern' }),
  );
  await screen.findByText('Event gespeichert.');
  // Untouched legacy stays legacy: no free-form copy is written.
  expect(posts[0]).toMatchObject({ locationId: 'location-main' });
  expect(posts[0]).not.toHaveProperty('venue');
  expect(posts[0]).not.toHaveProperty('venueOverride');
});

test('a duplicate of an inactive legacy place keeps custom or cleared text and drops the id', async () => {
  const archived = [
    {
      id: 'location-archived',
      name: 'Synthetic archived hall',
      state: 'archived',
      street: 'Fictional Street 1',
      postalCode: '12345',
      city: 'Fictional Town',
      country: 'DE',
    },
  ];
  for (const [venue, expected] of [
    ['Fictional Custom Hall', 'Fictional Custom Hall'],
    ['', ''],
  ] as const) {
    const { posts } = setup({
      supplied: {
        locationId: 'location-archived',
        venue,
        venueOverride: true,
      },
      locationChoices: archived,
    });
    await ready();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Event duplizieren: Synthetic stored event',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
    fireEvent.click(
      within(dialog).getByText('Weitere Angaben', { exact: true }),
    );
    expect(
      (within(dialog).getByLabelText('Ort / Adresse') as HTMLTextAreaElement)
        .value,
    ).toBe(expected);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Event speichern' }),
    );
    await screen.findByText('Event gespeichert.');
    expect(posts[0]).toMatchObject({
      locationId: null,
      venue: expected,
      venueOverride: true,
    });
    cleanup();
  }
});

test('late location data hydrates an untouched field but never typed text', async () => {
  const late = {
    id: 'location-main',
    name: 'Synthetic late venue',
    state: 'active',
    street: 'Fictional Street 5',
    postalCode: '12345',
    city: 'Fictional Town',
    country: 'DE',
  };
  const initial = {
    ...row,
    locationId: 'location-main',
    venue: null,
    venueOverride: false,
  };
  const props = {
    csrfToken: 'csrf',
    timeZone: 'Europe/Berlin',
    statuses: [{ code: 'inquiry', label: 'Anfrage' }],
    types,
    packages: [],
    contacts,
    initial,
    onClose: vi.fn(),
    onCreated: vi.fn().mockResolvedValue(undefined),
  };
  const { rerender } = render(<EventCreateDialog {...props} locations={[]} />);
  expect(
    (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
  ).toBe('');
  rerender(<EventCreateDialog {...props} locations={[late]} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
    ).toBe(
      'Synthetic late venue\nFictional Street 5\n12345 Fictional Town\nDE',
    ),
  );
  cleanup();
  const typed = render(<EventCreateDialog {...props} locations={[]} />);
  fireEvent.change(screen.getByLabelText('Ort / Adresse'), {
    target: { value: 'Synthetic typed place' },
  });
  typed.rerender(<EventCreateDialog {...props} locations={[late]} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Ort / Adresse') as HTMLTextAreaElement).value,
    ).toBe('Synthetic typed place'),
  );
});

test('the contact search keeps only the newest answer when an older request finishes later', async () => {
  let resolveOlder!: (response: Response) => void;
  const fetcher = vi.fn((url: string) => {
    const query = decodeURIComponent(url);
    if (query.endsWith('q=Synt'))
      return Promise.resolve(
        Response.json([hit('contact-newer', 'Synthetic Newer')]),
      );
    if (query.endsWith('q=Syn'))
      return new Promise<Response>((resolve) => {
        resolveOlder = resolve;
      });
    return Promise.resolve(Response.json([]));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventCreateDialog {...dialogProps} />);
  const search = screen.getByLabelText('Kunde suchen');
  fireEvent.change(search, { target: { value: 'Syn' } });
  fireEvent.change(search, { target: { value: 'Synt' } });
  await screen.findByRole('button', { name: /Synthetic Newer/ });
  await act(async () =>
    resolveOlder(Response.json([hit('contact-older', 'Synthetic Older')])),
  );
  expect(screen.queryByRole('button', { name: /Synthetic Older/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Synthetic Newer/ })).toBeTruthy();
});

test('an empty contact search says so and still offers the deliberate creation', async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    // An empty answer is honest: this store has no matching contact yet.
    if (options) throw Error('unexpected mutation');
    expect(
      new URL(url, 'https://synthetic.invalid').searchParams.get('q'),
    ).toBe('Synthetic missing');
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventCreateDialog {...dialogProps} />);
  fireEvent.change(screen.getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic missing' },
  });
  await screen.findByText('Keine Kontakte gefunden.');
  expect(
    screen.getByRole('button', { name: 'Neuen Kunden anlegen' }),
  ).toBeTruthy();
  expect(screen.getByText(/Kein Kunde ausgewählt/)).toBeTruthy();
  expect(fetcher.mock.calls.every(([, options]) => !options)).toBe(true);
});

test('the picker shows at most twenty hits and points to narrowing the search', async () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    hit(
      `contact-${index}`,
      `Synthetic limit ${String(index).padStart(2, '0')}`,
    ),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(many)),
  );
  render(<EventCreateDialog {...dialogProps} />);
  fireEvent.change(screen.getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic limit' },
  });
  await screen.findByText(/Suche eingrenzen/);
  const list = screen.getByRole('list', { name: 'Kontakte gefunden' });
  expect(within(list).getAllByRole('button')).toHaveLength(20);
  expect(screen.getByText(/nur die ersten 20 Treffer/)).toBeTruthy();
});

test('without a contact the event stays possible and the picker says so', async () => {
  const { posts } = setup();
  await ready();
  await openCreate();
  expect(screen.getByText(/Kein Kunde ausgewählt/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({ primaryContactId: null });
  cleanup();
  const chosen = setup();
  await ready();
  await openCreate();
  await pickContact('Synthetic contact');
  expect(screen.getByText(/Kunde: Synthetic contact/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Kunde entfernen' }));
  expect(screen.getByText(/Kein Kunde ausgewählt/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(chosen.posts[0]).toMatchObject({ primaryContactId: null });
});

test('an archived assignment stays readable but is never offered as a new choice', async () => {
  const archived = [
    hit('contact-old', 'Synthetic archived contact', { state: 'archived' }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        ...archived,
        hit('contact-live', 'Synthetic live contact'),
      ]),
    ),
  );
  render(
    <EventCreateDialog
      {...dialogProps}
      contacts={archived}
      initial={{ ...row, primaryContactId: 'contact-old' }}
    />,
  );
  expect(
    screen.getByText(/Synthetic archived contact \(Archiviert\/Inaktiv\)/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic' },
  });
  const archivedButton = await screen.findByRole('button', {
    name: /Synthetic archived contact/,
  });
  expect((archivedButton as HTMLButtonElement).disabled).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: /Synthetic live contact/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test('cancelling the inline contact form keeps the event draft and the chosen contact', async () => {
  const { posts, contactPosts } = setup();
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  await ready();
  await openCreate();
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2027-05-20' },
  });
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'type-wedding' },
  });
  fireEvent.click(screen.getByText('Weitere Angaben', { exact: true }));
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic kept draft' },
  });
  fireEvent.change(screen.getByLabelText('Anfragequelle'), {
    target: { value: 'Synthetic source' },
  });
  await pickContact('Synthetic contact');
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  await screen.findByRole('dialog', {
    name: 'Kontakt anlegen',
  });
  // One dialog box only: the event draft is hidden, not unmounted.
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect((screen.getByLabelText('Eventdatum') as HTMLInputElement).value).toBe(
    '2027-05-20',
  );
  const contactName = screen.getByLabelText('Name / Firma');
  fireEvent.change(contactName, {
    target: { value: 'Synthetic cancelled contact' },
  });
  fireEvent.keyDown(contactName, { key: 'Escape' });
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und zur Eventanlage zurückkehren?',
  );
  expect(screen.getByRole('dialog', { name: 'Kontakt anlegen' })).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.keyDown(contactName, { key: 'Escape' });
  await screen.findByRole('dialog', { name: 'Neues Event' });
  expect((screen.getByLabelText('Eventdatum') as HTMLInputElement).value).toBe(
    '2027-05-20',
  );
  expect((screen.getByLabelText('Eventart') as HTMLSelectElement).value).toBe(
    'type-wedding',
  );
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic kept draft',
  );
  expect(
    (screen.getByLabelText('Anfragequelle') as HTMLInputElement).value,
  ).toBe('Synthetic source');
  expect(screen.getByText(/Kunde: Synthetic contact/)).toBeTruthy();
  expect(contactPosts).toHaveLength(0);
  expect(posts).toHaveLength(0);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Kunde suchen')),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts[0]).toMatchObject({
    name: 'Synthetic kept draft',
    primaryContactId: 'contact-main',
    eventDate: '2027-05-20',
    eventTypeId: 'type-wedding',
    source: 'Synthetic source',
  });
});

test('the inline contact view keeps focus, the trap and the discard confirmation', async () => {
  setup();
  await ready();
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  const contactView = await screen.findByRole('dialog', {
    name: 'Kontakt anlegen',
  });
  expect(contactView.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(screen.getByLabelText('Kontaktart'));
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic focus draft' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  const save = within(contactView).getByRole('button', {
    name: 'Kontakt speichern',
  });
  save.focus();
  // Tab is pressed on the control that holds the focus, exactly like a
  // browser delivers it.
  fireEvent.keyDown(save, { key: 'Tab' });
  const close = within(contactView).getByRole('button', {
    name: 'Kontaktanlage schließen',
  });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(save);
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  fireEvent.keyDown(save, { key: 'Escape' });
  await screen.findByRole('dialog', { name: 'Neues Event' });
  expect(hasUnsavedChanges()).toBe(false);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Kunde suchen')),
  );
  fireEvent.keyDown(screen.getByLabelText('Eventdatum'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a failed contact POST keeps the contact form, its values and the error focus', async () => {
  const { posts, contactPosts } = setup({
    contactPost: () => Response.json({ error: 'invalid' }, { status: 409 }),
  });
  await ready();
  await openCreate();
  await pickContact('Synthetic contact');
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  const contactView = await screen.findByRole('dialog', {
    name: 'Kontakt anlegen',
  });
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic kept contact' },
  });
  submitContact(
    within(contactView)
      .getByRole('button', { name: 'Kontakt speichern' })
      .closest('form')!,
  );
  await screen.findByText(
    'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
  );
  const alert = screen.getByRole('alert');
  expect(contactView.contains(alert)).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic kept contact');
  expect(contactPosts).toHaveLength(1);
  expect(posts).toHaveLength(0);
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  fireEvent.keyDown(alert, { key: 'Escape' });
  await screen.findByRole('dialog', { name: 'Neues Event' });
  // The attempt changed nothing: the previous choice still stands.
  expect(screen.getByText(/Kunde: Synthetic contact/)).toBeTruthy();
});

test('a confirmed contact stays selected even when the following search fails', async () => {
  const { posts, contactPosts, failSearch } = setup();
  await ready();
  await openCreate();
  fireEvent.change(screen.getByLabelText('Kunde suchen'), {
    target: { value: 'Synthetic created' },
  });
  await screen.findByText('Keine Kontakte gefunden.');
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  const contactView = await screen.findByRole('dialog', {
    name: 'Kontakt anlegen',
  });
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic created contact' },
  });
  failSearch();
  submitContact(
    within(contactView)
      .getByRole('button', { name: 'Kontakt speichern' })
      .closest('form')!,
  );
  await screen.findByText(/Kunde: Synthetic created contact/);
  await screen.findByText(
    'Kontakte konnten nicht gesucht werden. Die bisherige Auswahl bleibt bestehen.',
  );
  expect(contactPosts).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Eventart'), {
    target: { value: 'type-wedding' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Event speichern' }));
  await screen.findByText('Event gespeichert.');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    primaryContactId: 'contact-created',
    name: 'Hochzeit – Synthetic created contact',
  });
  expect(contactPosts).toHaveLength(1);
});

test('a double submit creates exactly one contact', async () => {
  const { contactPosts, posts } = setup();
  await ready();
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Kunden anlegen' }));
  const contactView = await screen.findByRole('dialog', {
    name: 'Kontakt anlegen',
  });
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic single contact' },
  });
  const form = within(contactView)
    .getByRole('button', { name: 'Kontakt speichern' })
    .closest('form')!;
  submitContact(form);
  submitContact(form);
  await screen.findByText(/Kunde: Synthetic single contact/);
  expect(contactPosts).toHaveLength(1);
  expect(posts).toHaveLength(0);
});
