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
import { FilesPanel } from '../../apps/admin/src/FilesPanel.js';
import {
  filesFilterQuery,
  updateUrlSearch,
} from '../../apps/admin/src/url-state.js';
import { clickLink } from '../helpers/click-link.js';
import { exactMinorUnits } from '../../apps/admin/src/FilesPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const draft = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'offer',
  templateId: '22222222-2222-4222-8222-222222222222',
  eventId: '33333333-3333-4333-8333-333333333333',
  contactId: null,
  number: null,
  state: 'draft',
  issuedAt: '2031-05-01T20:30:00.000Z',
  finalizedAt: null,
  netMinor: 0,
  taxMinor: 0,
  grossMinor: 0,
  version: 1,
  eventName: 'Fictional Wedding',
  issuedDate: '2031-05-01',
  pdfAvailable: false,
};
const finalRow = {
  ...draft,
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'invoice',
  number: 'RE-2031-0001',
  state: 'final',
  finalizedAt: '2031-05-02T10:00:00.000Z',
  issuedAt: '2031-05-02T10:00:00.000Z',
  issuedDate: '2031-05-02',
  netMinor: 123456,
  taxMinor: 0,
  grossMinor: 123456,
  pdfAvailable: true,
};
const orphan = {
  ...draft,
  id: '55555555-5555-4555-8555-555555555555',
  eventId: null,
  eventName: null,
};
const malformedEvent = {
  ...draft,
  id: '66666666-6666-4666-8666-666666666666',
  eventId: 'not-an-id',
  eventName: 'Fictional But Unreachable',
};

function pageFetcher(pages: Record<string, unknown[]>) {
  return vi.fn(async (url: string) => {
    const body = pages[url] ?? pages['*'] ?? [];
    return Response.json(body);
  });
}
const listUrl = (query = '') =>
  '/api/v1/documents?include=metadata&limit=26&offset=0' + query;

function urlsOf(fetcher: ReturnType<typeof pageFetcher>) {
  return fetcher.mock.calls.map((call) => String(call[0]));
}

test('the panel asks the server for the whole filtered result, never a client-filtered page', async () => {
  window.history.replaceState(null, '', '/?q=keep');
  const fetcher = pageFetcher({
    '*': [draft, finalRow, orphan, malformedEvent],
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await screen.findByRole('region', { name: 'Dateien' });
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  // The page title belongs to the parent shell, so the panel adds none: no
  // second level-one heading and no duplicate visible "Dateien" label.
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  expect(urlsOf(fetcher)).toEqual([listUrl()]);

  fireEvent.change(screen.getByLabelText('Dokumentart'), {
    target: { value: 'invoice' },
  });
  await waitFor(() =>
    expect(urlsOf(fetcher).at(-1)).toBe(listUrl('&kind=invoice')),
  );
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'final' },
  });
  await waitFor(() =>
    expect(urlsOf(fetcher).at(-1)).toBe(listUrl('&kind=invoice&state=final')),
  );
  fireEvent.change(screen.getByLabelText('Von'), {
    target: { value: '2031-05-01' },
  });
  fireEvent.change(screen.getByLabelText('Bis'), {
    target: { value: '2031-05-31' },
  });
  await waitFor(() =>
    expect(urlsOf(fetcher).at(-1)).toBe(
      listUrl('&kind=invoice&state=final&from=2031-05-01&to=2031-05-31'),
    ),
  );
  // The unrelated global search parameter stays untouched.
  expect(new URLSearchParams(window.location.search).get('q')).toBe('keep');
  expect(filesFilterQuery('?q=keep')).toBe('');
  window.history.replaceState(
    null,
    '',
    '/?q=keep&df_kind=invoice&df_state=draft&df_from=2031-05-01&other=1',
  );
  expect(filesFilterQuery(window.location.search)).toBe(
    '?kind=invoice&state=draft&from=2031-05-01',
  );
});

test('filter changes reset pagination atomically and the extra row only means hasMore', async () => {
  let requests = 0;
  const fetcher = vi.fn(async () => {
    requests++;
    // First page reports a 26th row: there is more. The second page is short.
    return Response.json(
      requests === 1
        ? [...Array(26)].map((_, i) => ({ ...draft, id: `row-${i}` }))
        : [{ ...draft, id: 'tail' }],
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await screen.findByRole('button', { name: 'Nächste Seite' });
  // No invented total anywhere.
  expect(screen.queryByText(/von \d+ Dokumenten/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
  await waitFor(() =>
    expect(urlsOf(fetcher as never).at(-1)).toBe(
      '/api/v1/documents?include=metadata&limit=26&offset=25',
    ),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Nächste Seite',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'draft' },
  });
  await waitFor(() =>
    expect(urlsOf(fetcher as never).at(-1)).toBe(
      '/api/v1/documents?include=metadata&limit=26&offset=0&state=draft',
    ),
  );
});

test('rows show honest metadata, a real PDF link only when eligible and a native event link', async () => {
  const fetcher = pageFetcher({
    '*': [draft, finalRow, orphan, malformedEvent],
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  const rows = await screen.findAllByRole('row');
  // Header plus four records.
  expect(rows).toHaveLength(5);
  const draftRow = screen
    .getAllByText('Angebot · Entwurf')
    .map((node) => node.closest('tr')!)
    .find((tr) =>
      within(tr).queryByRole('link', { name: 'Fictional Wedding' }),
    )!;
  expect(within(draftRow).getByText('01.05.2031')).toBeTruthy();
  expect(within(draftRow).getByText('0,00 €')).toBeTruthy();
  // A draft offers no PDF and links to its real event instead.
  expect(within(draftRow).queryByRole('link', { name: /PDF/ })).toBeNull();
  const eventLink = within(draftRow).getByRole('link', {
    name: 'Fictional Wedding',
  });
  // The target clears the Event filter namespace so the details really open.
  expect(eventLink.getAttribute('href')).toBe(
    '/#event-33333333-3333-4333-8333-333333333333',
  );
  const finalRowElement = screen
    .getByText('Rechnung RE-2031-0001')
    .closest('tr')!;
  const pdf = within(finalRowElement).getByRole('link', {
    name: 'Rechnung RE-2031-0001 als PDF öffnen',
  });
  expect(pdf.getAttribute('href')).toBe(
    '/api/v1/documents/44444444-4444-4444-8444-444444444444/pdf',
  );
  expect(pdf.getAttribute('rel')).toBe('noreferrer');
  expect(pdf.getAttribute('target')).toBe('_blank');
  expect(within(finalRowElement).getByText('1.234,56 €')).toBeTruthy();
  // A malformed event id never becomes a link.
  expect(
    screen.queryByRole('link', { name: 'Fictional But Unreachable' }),
  ).toBeNull();
  // An unlinked document names the absence instead of inventing an event.
  expect(screen.getAllByText('Kein Event')).toHaveLength(2);
  // Nothing downloaded the PDF while listing.
  expect(urlsOf(fetcher).every((url) => !url.endsWith('/pdf'))).toBe(true);
});

test('a failed request keeps the last good rows and reports the applied filter state', async () => {
  let fail = false;
  const fetcher = vi.fn(async () =>
    fail ? new Response(null, { status: 503 }) : Response.json([draft]),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await screen.findByText('Angebot · Entwurf');
  fail = true;
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'final' },
  });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('letzte Stand');
  // The old row stays visible, but the controls show the requested filter.
  expect(screen.getAllByText('Angebot · Entwurf').length).toBeGreaterThan(0);
  expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe(
    'final',
  );
  fail = false;
  fetcher.mockImplementation(async () => Response.json([]));
  fireEvent.click(screen.getByRole('button', { name: 'Dateien erneut laden' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(await screen.findByText(/Keine Dokumente/)).toBeTruthy();
});

test('an empty result is distinguished from an error and the reset only clears its own filters', async () => {
  window.history.replaceState(
    null,
    '',
    '/?q=keep&df_kind=invoice&df_state=final&df_from=2031-05-01&df_page=3',
  );
  const fetcher = pageFetcher({ '*': [] });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  expect(await screen.findByText(/Keine Dokumente/)).toBeTruthy();
  // df_page=3 is the fourth page: 3 × 25 = 75, never a guessed total.
  expect(urlsOf(fetcher)[0]).toBe(
    '/api/v1/documents?include=metadata&limit=26&offset=75&kind=invoice&state=final&from=2031-05-01',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  await waitFor(() =>
    expect(urlsOf(fetcher).at(-1)).toBe(
      '/api/v1/documents?include=metadata&limit=26&offset=0',
    ),
  );
  expect(window.location.search).toBe('?q=keep');
});

test('a slow older response never overwrites a newer one', async () => {
  const resolvers: ((rows: unknown[]) => void)[] = [];
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolvers.push((rows) => resolve(Response.json(rows)));
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await waitFor(() => expect(resolvers).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'final' },
  });
  await waitFor(() => expect(resolvers).toHaveLength(2));
  await act(async () => resolvers[1]!([finalRow]));
  await screen.findByText('Rechnung RE-2031-0001');
  await act(async () => resolvers[0]!([draft]));
  expect(screen.getByText('Rechnung RE-2031-0001')).toBeTruthy();
  expect(screen.queryByText('Angebot · Entwurf')).toBeNull();
});

test('returning to the tab refreshes once and hidden panels do not request repeatedly', async () => {
  const fetcher = pageFetcher({ '*': [draft] });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await screen.findByText('Angebot · Entwurf');
  const before = fetcher.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(fetcher.mock.calls.length).toBe(before + 1));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  // The same transition does not trigger a second request.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetcher.mock.calls.length).toBe(before + 1);
});

test('filter and pager actions are quiet, named and reachable by keyboard', async () => {
  const fetcher = pageFetcher({
    '*': [...Array(26)].map((_, index) => ({ ...draft, id: `row-${index}` })),
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  const reset = await screen.findByRole('button', {
    name: 'Filter zurücksetzen',
  });
  expect(reset.getAttribute('title')).toBe('Filter zurücksetzen');
  const next = screen.getByRole('button', { name: 'Nächste Seite' });
  expect(next.getAttribute('title')).toBe('Nächste Seite');
  next.focus();
  expect(document.activeElement).toBe(next);
  fireEvent.keyDown(next, { key: 'Enter' });
  expect(document.activeElement).toBe(next);
  // A button is activated by Enter natively; jsdom needs the click it implies.
  next.focus();
  fireEvent.click(next);
  await waitFor(() => expect(urlsOf(fetcher).at(-1)).toContain('offset=25'));
  // First page is not offered while already on it.
  expect(screen.getByRole('button', { name: 'Vorherige Seite' })).toBeTruthy();
});

test('minor units are formatted exactly, including the largest safe value', () => {
  expect(exactMinorUnits(0)).toBe('0,00');
  expect(exactMinorUnits(1)).toBe('0,01');
  expect(exactMinorUnits(999)).toBe('9,99');
  expect(exactMinorUnits(123456)).toBe('1.234,56');
  expect(exactMinorUnits(19900)).toBe('199,00');
  // Dividing by 100 first would print ,90 here: the formatter must not.
  expect(exactMinorUnits(9007199254740991)).toBe('90.071.992.547.409,91');
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_VALUE])
    expect(exactMinorUnits(invalid)).toBeNull();
});

test('a namespaced URL write never deletes global search or event filters', () => {
  window.history.replaceState(
    null,
    '',
    '/?q=keep&from=2031-05-01&status=option&df_kind=invoice&df_page=2',
  );
  // An attempted off-namespace write is ignored instead of applied.
  updateUrlSearch({ q: 'new', df_page: '', df_kind: '' }, undefined, [
    'df_kind',
    'df_state',
    'df_from',
    'df_to',
    'df_page',
  ]);
  expect(window.location.search).toBe('?q=keep&from=2031-05-01&status=option');
  // Without the guard the established behaviour stays: the value is written.
  updateUrlSearch({ q: 'changed' });
  expect(new URLSearchParams(window.location.search).get('q')).toBe('changed');
});

test('an invalid row shape is an honest failure instead of a broken table', async () => {
  for (const broken of [
    [{ ...draft, kind: 'constructor' }],
    [{ ...draft, state: 'toString' }],
    [{ ...draft, issuedDate: undefined }],
    [{ ...draft, grossMinor: 1.5 }],
    [{ ...draft, grossMinor: -5 }],
    [{ ...draft, pdfAvailable: 'yes' }],
    { notAnArray: true },
  ]) {
    const fetcher = vi.fn(async () => Response.json(broken));
    vi.stubGlobal('fetch', fetcher);
    render(<FilesPanel />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();
  }
});

test('a withdrawn document without a number is never labelled as a draft', async () => {
  const fetcher = pageFetcher({
    '*': [{ ...draft, state: 'withdrawn', number: null }],
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  const row = (await screen.findByText('Angebot · Zurückgezogen')).closest(
    'tr',
  )!;
  expect(within(row).getByText('Zurückgezogen')).toBeTruthy();
  expect(within(row).queryByText(/Entwurf/)).toBeNull();
  expect(within(row).getByText('Keine PDF')).toBeTruthy();
});

test('an invalid event id never becomes a link anywhere in the table', async () => {
  const fetcher = pageFetcher({
    '*': [
      { ...draft, eventId: 'null' },
      { ...draft, id: 'second', eventId: 'undefined' },
      {
        ...draft,
        id: 'third',
        eventId: '55555555-5555-0555-8555-555555555555',
      },
    ],
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await screen.findAllByText('Kein Event');
  const html = document.body.innerHTML;
  expect(html).not.toContain('#event-null');
  expect(html).not.toContain('#event-undefined');
  // A v0-style uuid is not a v1-v8 id and must not be turned into a route.
  expect(html).not.toContain('55555555-5555-0555-8555-555555555555');
});

test('returning focus during a running request does not start a second load', async () => {
  let resolveFirst: ((rows: unknown[]) => void) | undefined;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveFirst = (rows) => resolve(Response.json(rows));
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The busy guard swallows the return while the first GET is still open.
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => resolveFirst!([draft]));
  await screen.findByText('Angebot · Entwurf');
  // Every list request is a plain GET on the metadata route.
  for (const call of fetcher.mock.calls)
    expect(String((call as unknown[])[0])).toMatch(
      /^\/api\/v1\/documents\?include=metadata&/,
    );
});

test('the pager disables the previous action on the first page', async () => {
  const fetcher = pageFetcher({ '*': [draft] });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  const previous = await screen.findByRole('button', {
    name: 'Vorherige Seite',
  });
  expect((previous as HTMLButtonElement).disabled).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Nächste Seite' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test('an event link clears only the Event filter namespace and keeps file state', async () => {
  window.history.replaceState(
    null,
    '',
    '/?q=keep&from=2031-05-01&to=2031-05-31&status=option&eventTypeId=abc&undated=1&df_kind=invoice&other=1#files',
  );
  const fetcher = pageFetcher({ '*': [draft] });
  vi.stubGlobal('fetch', fetcher);
  render(<FilesPanel />);
  const link = await screen.findByRole('link', {
    name: 'Fictional Wedding',
  });
  const target = new URL(link.getAttribute('href')!, window.location.origin);
  // Event filters are gone, so the details can actually open on that row.
  for (const key of ['q', 'from', 'to', 'status', 'eventTypeId', 'undated'])
    expect(target.searchParams.get(key), key).toBeNull();
  // Dateien filters and unrelated state survive the trip.
  expect(target.searchParams.get('df_kind')).toBe('invoice');
  expect(target.searchParams.get('other')).toBe('1');
  expect(target.hash).toBe('#event-33333333-3333-4333-8333-333333333333');
  // A plain left click is a real navigation, so the element stays a native
  // link and nothing here intercepts it.
  expect(clickLink(link)).toBe(false);
  expect(window.location.hash).toBe('#files');
});
