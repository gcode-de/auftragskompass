import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EventDocuments } from '../../apps/admin/src/EventDocuments.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const draft = {
    id: 'doc-1',
    kind: 'offer',
    templateId: 'tpl-1',
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:00:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
  },
  finalized = {
    ...draft,
    id: 'doc-2',
    number: 'AN-2030-0001',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:05:00Z',
    version: 2,
  },
  templates = [
    { id: 'tpl-1', kind: 'offer', name: 'Fictional offer', state: 'active' },
    { id: 'tpl-2', kind: 'offer', name: 'Archived offer', state: 'archived' },
    { id: 'tpl-3', kind: 'invoice', name: 'Invoice', state: 'active' },
  ];
function setup(
  options: {
    documents?: unknown[];
    templates?: unknown[];
    finalize?: () => Response;
    create?: () => Response;
  } = {},
) {
  const calls: { url: string; method: string; body?: unknown }[] = [],
    state = {
      documents: options.documents ?? [draft],
      templates: options.templates ?? templates,
    },
    fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/documents?eventId=')) {
        calls.push({ url, method });
        return Response.json(state.documents);
      }
      if (url === '/api/v1/document-templates') {
        calls.push({ url, method });
        return Response.json(state.templates);
      }
      if (url === '/api/v1/documents') {
        calls.push({ url, method, body: JSON.parse(String(init!.body)) });
        if (options.create) return options.create();
        return Response.json(draft, { status: 201 });
      }
      if (url.endsWith('/finalize')) {
        calls.push({ url, method });
        if (options.finalize) return options.finalize();
        state.documents = [finalized];
        return Response.json(finalized);
      }
      throw new Error('unexpected ' + url);
    });
  vi.stubGlobal('fetch', fetcher);
  return { calls, state };
}
const props = {
  eventId: 'event-1',
  contactId: 'contact-1',
  timeZone: 'Europe/Berlin',
  csrfToken: 'fictional-csrf',
};
test('lists the offers of the event and only offers active templates', async () => {
  setup();
  render(<EventDocuments {...props} />);
  expect(await screen.findByText(/Angelegt am/)).toBeTruthy();
  expect(
    screen.getByText('Entwurf', { selector: '.document-row span' }),
  ).toBeTruthy();
  expect(screen.getByText(/249,00/)).toBeTruthy();
  const select = screen.getByLabelText('Vorlage') as HTMLSelectElement;
  expect(Array.from(select.options).map((option) => option.text)).toEqual([
    'Fictional offer',
  ]);
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toBeTruthy();
});
test('a draft is created for this event and contact and the list reloads', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText('Entwurf angelegt.')).toBeTruthy();
  const create = calls.find((call) => call.method === 'POST')!;
  expect(create.url).toBe('/api/v1/documents');
  expect(create.body).toEqual({
    templateId: 'tpl-1',
    eventId: 'event-1',
    contactId: 'contact-1',
  });
  expect(
    calls.filter((call) => call.url.startsWith('/api/v1/documents?eventId=')),
  ).toHaveLength(2);
});
test('finalizing shows the number and offers the pdf', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf finalisieren',
    }),
  );
  expect(await screen.findByText('Finalisiert als AN-2030-0001.')).toBeTruthy();
  expect(
    calls.some((call) => call.url === '/api/v1/documents/doc-1/finalize'),
  ).toBe(true);
  const link = (await screen.findByRole('link', {
    name: 'Angebot AN-2030-0001 als PDF öffnen',
  })) as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe('/api/v1/documents/doc-2/pdf');
  expect(link.getAttribute('target')).toBe('_blank');
});
test('a stale finalize is explained and the list refreshed', async () => {
  setup({
    finalize: () => Response.json({ error: 'invalid_state' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf finalisieren',
    }),
  );
  expect(await screen.findByText(/Bereits finalisiert/)).toBeTruthy();
});
test('missing templates or contact disable the form and explain why', async () => {
  setup({ documents: [], templates: [] });
  const view = render(<EventDocuments {...props} contactId={null} />);
  expect(
    await screen.findByText(/Noch keine aktive Angebotsvorlage/),
  ).toBeTruthy();
  expect(screen.getByText(/zuerst einen Hauptkontakt/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset')!
      .disabled,
  ).toBe(true);
  view.unmount();
  cleanup();
  setup({ documents: [], templates: [] });
  render(<EventDocuments {...props} />);
  expect(
    await screen.findByText(/Noch keine aktive Angebotsvorlage/),
  ).toBeTruthy();
  expect(screen.queryByText(/zuerst einen Hauptkontakt/)).toBeNull();
});
test('a failed load is reported', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
  render(<EventDocuments {...props} />);
  expect(
    await screen.findByText('Dateien konnten nicht geladen werden.'),
  ).toBeTruthy();
});

test('a rejected draft and a failed pdf are explained to the operator', async () => {
  setup({
    create: () => Response.json({ error: 'not_found' }, { status: 404 }),
  });
  const view = render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(
    await screen.findByText(/Entwurf konnte nicht angelegt werden/),
  ).toBeTruthy();
  view.unmount();
  cleanup();
  setup({
    finalize: () =>
      Response.json({ error: 'artifact_failed' }, { status: 500 }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf finalisieren',
    }),
  );
  expect(
    await screen.findByText(/PDF konnte nicht erzeugt werden/),
  ).toBeTruthy();
});
test('a withdrawn document is listed without actions', async () => {
  setup({ documents: [{ ...draft, state: 'withdrawn' }] });
  render(<EventDocuments {...props} />);
  expect(await screen.findByText('Zurückgezogen')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /PDF öffnen/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /finalisieren/ })).toBeNull();
});

test('a confirmed draft is not recreated when the reload fails and the load can be retried', async () => {
  let failDocuments = false,
    posts = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/v1/document-templates') return Response.json(templates);
    if (url.startsWith('/api/v1/documents?eventId=')) {
      if (failDocuments) return new Response(null, { status: 503 });
      return Response.json([draft]);
    }
    if (url === '/api/v1/documents') {
      posts += 1;
      return Response.json(draft, { status: 201 });
    }
    throw new Error('unexpected ' + url);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventDocuments {...props} />);
  const create = await screen.findByRole('button', { name: 'Entwurf anlegen' });
  failDocuments = true;
  const form = create.closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(await screen.findByText('Entwurf angelegt.')).toBeTruthy();
  expect(
    await screen.findByText(/Dateiliste konnte nicht neu geladen werden/),
  ).toBeTruthy();
  // BKP013.1: the confirmed success and the rows loaded before the failed
  // reload stay readable instead of leaving an unexplained empty list.
  expect(screen.getByText(/Angelegt am/)).toBeTruthy();
  expect(posts).toBe(1);
  failDocuments = false;
  fireEvent.click(screen.getByRole('button', { name: 'Dateien erneut laden' }));
  await waitFor(() =>
    expect(
      screen.queryByText(/Dateiliste konnte nicht neu geladen werden/),
    ).toBeNull(),
  );
});

test('documents are grouped and labelled by their actual kind', async () => {
  setup({
    documents: [
      draft,
      { ...finalized, kind: 'invoice', number: 'RE-2030-0002' },
      {
        ...finalized,
        id: 'doc-3',
        kind: 'order_confirmation',
        number: 'AB-2030-0003',
      },
      {
        ...finalized,
        id: 'doc-4',
        kind: 'unmapped_kind',
        number: 'XX-2030-0004',
      },
    ],
  });
  render(<EventDocuments {...props} />);
  expect(await screen.findByText('AB-2030-0003')).toBeTruthy();
  const offers = screen.getByRole('region', { name: 'Angebote' });
  const invoices = screen.getByRole('region', { name: 'Rechnungen' });
  const orders = screen.getByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const other = screen.getByRole('region', { name: 'Weitere Dateien' });
  expect(
    within(offers).getByText('Entwurf', { selector: '.document-row span' }),
  ).toBeTruthy();
  expect(within(invoices).getByText('RE-2030-0002')).toBeTruthy();
  expect(within(orders).getByText('AB-2030-0003')).toBeTruthy();
  expect(within(other).getByText('XX-2030-0004')).toBeTruthy();
  // Every row stays in exactly one card; the offer form belongs to the offers.
  expect(within(invoices).queryAllByText('Entwurf')).toEqual([]);
  expect(
    within(offers).getByRole('button', { name: 'Entwurf anlegen' }),
  ).toBeTruthy();
  expect(
    within(offers).queryByRole('heading', { name: 'Rechnungen' }),
  ).toBeNull();
});
