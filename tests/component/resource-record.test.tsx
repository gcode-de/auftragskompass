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
import { ResourcePanel } from '../../apps/admin/src/ResourcePanel.js';

// RES-BKP-03: the resource record like Bookitup - Details, Bestand, Planung.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const box = {
  id: 'synthetic-box',
  version: 3,
  name: 'Synthetic box',
  code: 'SYN-1',
  category: 'Fotobox',
  kind: 'case',
  description: '',
  quantity: 2,
  beforeDays: 2,
  afterDays: 1,
  position: 0,
  state: 'active',
  blocked: true,
};
const others = [
  {
    ...box,
    id: 'synthetic-lamp',
    name: 'Synthetic lamp',
    code: 'LAMP',
    kind: 'item',
    category: 'Licht',
  },
  {
    ...box,
    id: 'synthetic-set',
    name: 'Synthetic package',
    code: 'SET',
    kind: 'set',
    category: 'Pakete',
  },
  {
    ...box,
    id: 'synthetic-gone',
    name: 'Synthetic gone',
    code: 'GONE',
    kind: 'item',
    category: 'Licht',
    state: 'archived',
  },
];
const planning = {
  timeZone: 'Europe/Berlin',
  units: [
    { id: 'unit-1', ordinal: 1, enabled: true },
    { id: 'unit-2', ordinal: 2, enabled: false },
  ],
  plans: [
    {
      eventId: 'event-1',
      eventName: 'Fictional wedding',
      eventDate: '2031-10-31',
      eventStatus: 'booked',
      startsAt: '2031-10-31T16:00:00.000Z',
      endsAt: '2031-10-31T22:00:00.000Z',
      quantity: 2,
      confirmed: true,
    },
    {
      eventId: 'event-2',
      eventName: 'Fictional party',
      eventDate: null,
      eventStatus: 'option',
      startsAt: '2031-11-01T16:00:00.000Z',
      endsAt: '2031-11-01T22:00:00.000Z',
      quantity: 1,
      confirmed: false,
    },
  ],
};

const noLinks = {
  accessories: [],
  alternatives: [],
  components: [],
  inCases: [],
  inSets: [],
  products: [],
};
function server(
  answer = () => Response.json(planning),
  links: (url: string, init?: RequestInit) => Response = () =>
    Response.json(noLinks),
) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/resources') return Response.json([box, ...others]);
    if (url === `/api/v1/resources/${box.id}/planning`) return answer();
    if (url.startsWith(`/api/v1/resources/${box.id}/links`))
      return links(url, init);
    if (url === '/api/v1/products')
      return Response.json([
        { id: 'product-1', name: 'Fictional rental', state: 'active' },
        { id: 'product-old', name: 'Fictional old', state: 'archived' },
      ]);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

test('the name opens the record with Bookitup context column and its master data', async () => {
  server();
  render(<ResourcePanel csrfToken="csrf" />);
  const name = await screen.findByRole('link', { name: 'Synthetic box' });
  expect(name.getAttribute('href')).toBe('#resource-synthetic-box');
  act(() => {
    window.history.replaceState(null, '', '/#resource-synthetic-box');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  const record = await screen.findByRole('region', {
    name: 'Ressourcen-Akte',
  });
  const context = screen.getByRole('navigation', { name: 'Ressourcen-Akte' });
  expect(context.textContent).toContain('RessourceSynthetic box');
  expect(
    within(context)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('aria-current')]),
  ).toEqual([
    ['Details', 'page'],
    ['Bestand', null],
    ['Planung', null],
  ]);
  // The list and its filters step aside while the record is open.
  expect(screen.queryByRole('group', { name: 'Typ' })).toBeNull();
  expect(
    within(record).getByRole('heading', { level: 2, name: 'Synthetic box' }),
  ).toBe(document.activeElement);
  const facts = within(record).getByRole('heading', { name: 'Stammdaten' })
    .parentElement!.parentElement!;
  expect(facts.textContent).toContain('TypCase');
  expect(facts.textContent).toContain('BeschreibungKeine Beschreibung.');
  expect(facts.textContent).toContain('Puffer2 Tage vorher, 1 Tage nachher');
  expect(facts.textContent).toContain('ZustandAktiv, gesperrt');
});

test('the pen edits the resource in its dialog and the breadcrumb returns to the name', async () => {
  server();
  window.history.replaceState(null, '', '/#resource-synthetic-box');
  render(<ResourcePanel csrfToken="csrf" />);
  const pen = await screen.findByRole('button', {
    name: 'Stammdaten bearbeiten: Synthetic box',
  });
  fireEvent.click(pen);
  const dialog = await screen.findByRole('dialog', {
    name: 'Ressource bearbeiten',
  });
  expect(
    (within(dialog).getByLabelText('Bezeichnung') as HTMLInputElement).value,
  ).toBe('Synthetic box');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Ressourcen – Akte schließen' }),
  );
  expect(window.location.hash).toBe('#resources');
  expect(screen.queryByRole('region', { name: 'Ressourcen-Akte' })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('link', { name: 'Synthetic box' }),
  );
});

test('Bestand lists the units and Planung the plans per event with their state', async () => {
  server();
  window.history.replaceState(null, '', '/#resource-synthetic-box');
  render(<ResourcePanel csrfToken="csrf" />);
  const context = await screen.findByRole('navigation', {
    name: 'Ressourcen-Akte',
  });
  fireEvent.click(within(context).getByRole('link', { name: 'Bestand' }));
  const record = screen.getByRole('region', { name: 'Ressourcen-Akte' });
  expect(within(record).getByText('2 Stück')).toBeTruthy();
  await waitFor(() =>
    expect(
      within(record)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Synthetic box · Einheit 1 – planbar',
      'Synthetic box · Einheit 2 – stillgelegt',
    ]),
  );
  fireEvent.click(within(context).getByRole('link', { name: 'Planung' }));
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows.map((row) => row.textContent)).toEqual([
    'BestätigtZeitraumMengeEreignis',
    expect.stringMatching(
      /^31\.10\.2031, 17:00 – 31\.10\.2031, 23:00 *2Fictional weddingGebucht · am 31\.10\.2031$/,
    ),
    expect.stringMatching(/1Fictional partyOption$/),
  ]);
  expect(within(rows[1]!).getByRole('img', { name: 'Bestätigt' })).toBeTruthy();
  expect(
    within(rows[2]!).getByRole('img', { name: 'Vorgemerkt' }),
  ).toBeTruthy();
  expect(
    within(rows[1]!)
      .getByRole('link', { name: /Fictional wedding/ })
      .getAttribute('href'),
  ).toBe('#event-event-1');
  // Leaving the record and opening it again starts with its details.
  act(() => {
    window.history.replaceState(null, '', '/#resources');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  act(() => {
    window.history.replaceState(null, '', '/#resource-synthetic-box');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(
    within(screen.getByRole('navigation', { name: 'Ressourcen-Akte' }))
      .getByRole('link', { name: 'Details' })
      .getAttribute('aria-current'),
  ).toBe('page');
});

test('an empty planning says so and a failed one retries', async () => {
  let fail = true;
  server(() =>
    fail
      ? new Response(null, { status: 500 })
      : Response.json({ ...planning, units: [], plans: [] }),
  );
  window.history.replaceState(null, '', '/#resource-synthetic-box');
  render(<ResourcePanel csrfToken="csrf" />);
  const context = await screen.findByRole('navigation', {
    name: 'Ressourcen-Akte',
  });
  fireEvent.click(within(context).getByRole('link', { name: 'Planung' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Planung und Bestand konnten nicht geladen werden.',
  );
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
  expect(await screen.findByText('Noch nichts eingeplant.')).toBeTruthy();
  fireEvent.click(within(context).getByRole('link', { name: 'Bestand' }));
  const stock = screen
    .getByRole('heading', { name: 'Bestand' })
    .closest('section')!;
  expect(within(stock).getByText('Noch nichts hinzugefügt.')).toBeTruthy();
});

test('an unknown resource in the address keeps the list', async () => {
  server();
  window.history.replaceState(null, '', '/#resource-missing');
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByRole('link', { name: 'Synthetic box' });
  expect(screen.queryByRole('region', { name: 'Ressourcen-Akte' })).toBeNull();
});

// RES-BKP-04: the right-hand cards and their pickers.
test('the side cards show the links and a picker replaces one card', async () => {
  const puts: { url: string; body: unknown }[] = [];
  let fail = '';
  server(undefined, (url, init) => {
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) });
      if (fail) return Response.json({ error: fail }, { status: 409 });
      return Response.json({
        ...noLinks,
        inSets: [
          {
            id: 'synthetic-set',
            name: 'Synthetic package',
            kind: 'set',
            category: 'Pakete',
          },
        ],
        accessories: [
          {
            id: 'synthetic-lamp',
            name: 'Synthetic lamp',
            kind: 'item',
            category: 'Licht',
          },
        ],
      });
    }
    return Response.json({
      ...noLinks,
      inSets: [
        {
          id: 'synthetic-set',
          name: 'Synthetic package',
          kind: 'set',
          category: 'Pakete',
        },
      ],
    });
  });
  window.history.replaceState(null, '', '/#resource-synthetic-box');
  render(<ResourcePanel csrfToken="csrf" />);
  const side = await screen.findByRole('complementary', {
    name: 'Verknüpfungen',
  });
  // A case has components; every card names itself, empty ones say so.
  await waitFor(() =>
    expect(
      within(side)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual([
      'Zubehör',
      'Alternativen',
      'Verknüpfte Produkte',
      'Bestandteile',
      'Verbaut in folgenden Cases',
      'Bestandteil folgender Sets',
    ]),
  );
  expect(
    within(side)
      .getByRole('link', { name: 'Synthetic package' })
      .getAttribute('href'),
  ).toBe('#resource-synthetic-set');
  expect(within(side).getAllByText('Noch nichts hinzugefügt.')).toHaveLength(5);
  const plus = within(side).getByRole('button', { name: 'Zubehör hinzufügen' });
  fireEvent.click(plus);
  const dialog = screen.getByRole('dialog', { name: 'Zubehör hinzufügen' });
  const save = within(dialog).getByRole('button', { name: 'Speichern' });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  // The resource itself and archived ones are not offered.
  expect(
    within(dialog)
      .getAllByRole('checkbox')
      .map((box) => box.closest('label')!.textContent),
  ).toEqual(['ItemSynthetic lampLicht', 'SetSynthetic packagePakete']);
  fireEvent.change(within(dialog).getByLabelText('Typ'), {
    target: { value: 'set' },
  });
  expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.change(within(dialog).getByLabelText('Typ'), {
    target: { value: '' },
  });
  fireEvent.change(within(dialog).getByLabelText('Kategorie'), {
    target: { value: 'Licht' },
  });
  fireEvent.change(within(dialog).getByLabelText('Ressourcen durchsuchen'), {
    target: { value: 'lamp' },
  });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fail = 'component_cycle';
  fireEvent.submit(save.closest('form')!);
  expect((await within(dialog).findByRole('alert')).textContent).toMatch(
    /enthält diese Ressource bereits/,
  );
  fail = '';
  fireEvent.submit(save.closest('form')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(puts.at(-1)).toEqual({
    url: '/api/v1/resources/synthetic-box/links/accessories',
    body: { ids: ['synthetic-lamp'] },
  });
  expect(
    within(side).getByRole('link', { name: 'Synthetic lamp' }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(plus);
  // Products come from the catalog; archived ones are left out.
  fireEvent.click(
    within(side).getByRole('button', { name: 'Produkte verknüpfen' }),
  );
  const products = screen.getByRole('dialog', { name: 'Produkte verknüpfen' });
  expect(await within(products).findByText('Fictional rental')).toBeTruthy();
  expect(within(products).queryByText('Fictional old')).toBeNull();
  fireEvent.keyDown(products, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('links that cannot be read say so instead of empty cards', async () => {
  server(undefined, () => new Response(null, { status: 500 }));
  window.history.replaceState(null, '', '/#resource-synthetic-box');
  render(<ResourcePanel csrfToken="csrf" />);
  const side = await screen.findByRole('complementary', {
    name: 'Verknüpfungen',
  });
  expect((await within(side).findByRole('alert')).textContent).toBe(
    'Die Verknüpfungen konnten nicht geladen werden.',
  );
  expect(within(side).queryByText('Noch nichts hinzugefügt.')).toBeNull();
  expect(
    (
      within(side).getByRole('button', {
        name: 'Zubehör hinzufügen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
