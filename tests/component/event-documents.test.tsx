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
  // BKP019.0: the same final offer after the operator marked it as sent.
  sentOffer = {
    ...finalized,
    offerStatus: 'sent' as const,
    validUntil: '2030-11-09',
    offerExpired: false,
    version: 3,
  },
  templates = [
    { id: 'tpl-1', kind: 'offer', name: 'Fictional offer', state: 'active' },
    { id: 'tpl-2', kind: 'offer', name: 'Archived offer', state: 'archived' },
    { id: 'tpl-3', kind: 'invoice', name: 'Invoice', state: 'active' },
  ],
  // BKP013.2: the stored row of a create must never be the row the list request
  // already returned, otherwise a test cannot tell which response put it on
  // screen. Same event and contact, own id, own amount.
  created = {
    ...draft,
    id: 'doc-new',
    issuedAt: '2030-10-26T11:30:00Z',
    netMinor: 10925,
    taxMinor: 2075,
    grossMinor: 13000,
  };
function setup(
  options: {
    documents?: unknown[];
    templates?: unknown[];
    finalize?: () => Response;
    create?: (url: string) => Response;
    offerStatus?: () => Response;
  } = {},
) {
  const calls: {
      url: string;
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
    }[] = [],
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
      if (
        url === '/api/v1/documents' ||
        url === '/api/v1/documents/blank-offer'
      ) {
        calls.push({ url, method, body: JSON.parse(String(init!.body)) });
        if (options.create) return options.create(url);
        return Response.json(
          url === '/api/v1/documents/blank-offer'
            ? { ...created, templateId: null }
            : created,
          { status: 201 },
        );
      }
      if (url.endsWith('/offer-status')) {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        });
        if (options.offerStatus) return options.offerStatus();
        return Response.json(sentOffer);
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
    'Ohne Vorlage',
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
test('no template permits blank creation, while a missing contact disables it', async () => {
  setup({ documents: [], templates: [] });
  const view = render(<EventDocuments {...props} contactId={null} />);
  expect(await screen.findByText(/Keine aktive Angebotsvorlage/)).toBeTruthy();
  expect(screen.getByText(/zuerst einen Hauptkontakt/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset')!
      .disabled,
  ).toBe(true);
  view.unmount();
  cleanup();
  setup({ documents: [], templates: [] });
  render(<EventDocuments {...props} />);
  expect(await screen.findByText(/Keine aktive Angebotsvorlage/)).toBeTruthy();
  expect(screen.queryByText(/zuerst einen Hauptkontakt/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset')!
      .disabled,
  ).toBe(false);
  expect(screen.getByRole('option', { name: 'Ohne Vorlage' })).toBeTruthy();
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
  expect(
    screen.getByRole('button', { name: 'Dateien erneut laden' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset')!
      .disabled,
  ).toBe(true);
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

// BKP019.0: the business status is its own line, finalization keeps its own,
// and only a legal next step becomes a button.
test('a finalized offer shows its status, deadline and next steps', async () => {
  const { calls } = setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  // The event file asks for the offer projection explicitly.
  expect(calls[0]!.url).toContain('include=offer');
  expect(
    within(row).getByText('Finalisiert', { selector: '.document-row span' }),
  ).toBeTruthy();
  expect(within(row).getByText(/Gültig bis/)).toBeTruthy();
  expect(within(row).getByText('09.11.2030')).toBeTruthy();
  expect(within(row).queryByText('Abgelaufen')).toBeNull();
  expect(
    within(row).getByRole('link', {
      name: 'Angebot AN-2030-0001 als PDF öffnen',
    }),
  ).toBeTruthy();
  expect(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  ).toBeTruthy();
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 zurückziehen',
    }),
  ).toBeTruthy();
  // No jump back to "sent" and no invented reopening.
  expect(
    within(row).queryByRole('button', { name: /versendet markieren/ }),
  ).toBeNull();
});

test('an expired offer reads as expired without losing its status', async () => {
  setup({ documents: [{ ...sentOffer, offerExpired: true }] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  expect(within(row).getByText('Abgelaufen')).toBeTruthy();
  // The deadline stays visible, so "expired" is checkable, not a claim.
  expect(within(row).getByText('09.11.2030')).toBeTruthy();
});

test('a final offer without a claim offers only send and withdraw', async () => {
  setup({
    documents: [
      {
        ...finalized,
        offerStatus: null,
        validUntil: '2030-11-09',
        offerExpired: false,
        version: 3,
      },
    ],
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Noch nicht versendet')).closest(
    'li',
  ) as HTMLElement;
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 versendet markieren',
    }),
  ).toBeTruthy();
  expect(within(row).queryByRole('button', { name: /annehmen/ })).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 zurückziehen',
    }),
  ).toBeTruthy();
});

test('an accepted offer cannot be accepted or sent again', async () => {
  setup({ documents: [{ ...sentOffer, offerStatus: 'accepted', version: 4 }] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Angenommen')).closest(
    'li',
  ) as HTMLElement;
  expect(within(row).queryByRole('button', { name: /annehmen/ })).toBeNull();
  expect(
    within(row).queryByRole('button', { name: /versendet markieren/ }),
  ).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 zurückziehen',
    }),
  ).toBeTruthy();
});

test('a withdrawn offer keeps its PDF and offers no status action', async () => {
  setup({
    documents: [{ ...sentOffer, offerStatus: 'withdrawn', version: 5 }],
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Zurückgezogen')).closest(
    'li',
  ) as HTMLElement;
  // The posted PDF is archive, not content: it stays reachable.
  expect(
    within(row).getByRole('link', {
      name: 'Angebot AN-2030-0001 als PDF öffnen',
    }),
  ).toBeTruthy();
  for (const name of [
    /versendet markieren/,
    /annehmen/,
    /zurückziehen/,
    /Rückzug/,
  ])
    expect(within(row).queryByRole('button', { name })).toBeNull();
});

test('withdrawing asks once and then posts the status with the version', async () => {
  const { calls } = setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 zurückziehen',
    }),
  );
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Rückzug bestätigen',
    }),
  ).toBeTruthy();
  // Nothing leaves the browser before the confirmation.
  expect(calls.some((call) => call.url.endsWith('/offer-status'))).toBe(false);
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Rückzug bestätigen',
    }),
  );
  expect(
    await screen.findByText('Angebotsstatus aktualisiert: Zurückgezogen.'),
  ).toBeTruthy();
  expect(
    calls.find((call) => call.url.endsWith('/offer-status')),
  ).toMatchObject({
    url: '/api/v1/documents/doc-2/offer-status',
    method: 'POST',
    body: { status: 'withdrawn', version: 3 },
    headers: { 'x-csrf-token': 'fictional-csrf' },
  });
});

test('cancelling a withdrawal sends nothing and keeps the actions', async () => {
  const { calls } = setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 zurückziehen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Rückzug abbrechen',
    }),
  );
  expect(within(row).queryByRole('button', { name: /Rückzug/ })).toBeNull();
  expect(calls.some((call) => call.url.endsWith('/offer-status'))).toBe(false);
});

test('marking an offer as sent posts the status with the current version', async () => {
  const { calls } = setup({
    documents: [
      {
        ...finalized,
        offerStatus: null,
        validUntil: '2030-11-09',
        offerExpired: false,
        version: 3,
      },
    ],
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Noch nicht versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 versendet markieren',
    }),
  );
  expect(
    await screen.findByText('Angebotsstatus aktualisiert: Versendet.'),
  ).toBeTruthy();
  expect(
    calls.find((call) => call.url.endsWith('/offer-status')),
  ).toMatchObject({
    url: '/api/v1/documents/doc-2/offer-status',
    body: { status: 'sent', version: 3 },
  });
});

test('a broken connection while changing the status is reported', async () => {
  setup({
    documents: [sentOffer],
    offerStatus: () => {
      throw new TypeError('offline');
    },
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  expect(
    await screen.findByText(
      'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
    ),
  ).toBeTruthy();
});

test('a status change that cannot be reloaded warns instead of hiding the row', async () => {
  let listFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/document-templates') return Response.json(templates);
      if (url.startsWith('/api/v1/documents?eventId='))
        return listFails
          ? new Response(null, { status: 500 })
          : Response.json([sentOffer]);
      if (url.endsWith('/offer-status')) {
        listFails = true;
        return Response.json({ ...sentOffer, offerStatus: 'accepted' });
      }
      throw new Error('unexpected ' + url);
    }),
  );
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  expect(
    await screen.findByText(/Dateiliste konnte nicht neu geladen werden/),
  ).toBeTruthy();
});

test('a refused transition is explained instead of retried', async () => {
  setup({
    documents: [sentOffer],
    offerStatus: () =>
      Response.json({ error: 'invalid_transition' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  expect(
    await screen.findByText('Dieser Statuswechsel ist nicht zulässig.'),
  ).toBeTruthy();
});

// BKP013.2: one controllable harness for the create/reload pair. The list
// request and the confirmed create answer with different rows, so every
// assertion below proves where a row on screen came from.
function reloadHarness(
  options: { stored?: unknown[]; templates?: unknown[] } = {},
) {
  const lists: string[] = [],
    posts: { url: string; body: Record<string, unknown> }[] = [],
    finals: { body: Record<string, unknown> }[] = [],
    control = {
      listReply: () => Response.json(options.stored ?? []),
      createReply: () => Response.json(created, { status: 201 }),
    };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/document-templates')
        return Response.json(options.templates ?? templates);
      if (url.startsWith('/api/v1/documents?eventId=')) {
        lists.push(url);
        return control.listReply();
      }
      if (
        url === '/api/v1/documents' ||
        url === '/api/v1/documents/blank-offer'
      ) {
        posts.push({ url, body: JSON.parse(String(init!.body)) });
        return control.createReply();
      }
      if (url.endsWith('/finalize')) {
        finals.push({ body: JSON.parse(String(init!.body)) });
        return Response.json({
          ...created,
          number: 'AN-2030-0009',
          state: 'final',
          version: 3,
        });
      }
      if (url.startsWith('/api/v1/documents/'))
        return new Response(null, { status: 500 });
      throw new Error('unexpected ' + url);
    }),
  );
  return { lists, posts, finals, control };
}

test('a draft created from a template stays visible when the list reload fails', async () => {
  const { lists, posts, control } = reloadHarness();
  render(<EventDocuments {...props} />);
  expect(
    ((await screen.findByLabelText('Vorlage')) as HTMLSelectElement).value,
  ).toBe('tpl-1');
  control.listReply = () => new Response(null, { status: 500 });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText('Entwurf angelegt.')).toBeTruthy();
  expect(
    await screen.findByText(/Dateiliste konnte nicht neu geladen werden/),
  ).toBeTruthy();
  // The row carries the amount and the reachable edit control of the create
  // answer, which the failing list request never returned.
  const offers = screen.getByRole('region', { name: 'Angebote' });
  expect(within(offers).getByText(/130,00/)).toBeTruthy();
  expect(
    within(offers).getByText('Entwurf', { selector: '.document-row span' }),
  ).toBeTruthy();
  const edit = within(offers).getByRole('button', {
    name: 'Angebot Entwurf bearbeiten',
  }) as HTMLButtonElement;
  expect(edit.disabled).toBe(false);
  expect(posts.map((post) => post.url)).toEqual(['/api/v1/documents']);
  expect(lists).toHaveLength(2);
});

test('a draft created without a template also stays visible when the reload fails', async () => {
  const { posts, control } = reloadHarness();
  render(<EventDocuments {...props} />);
  fireEvent.change(await screen.findByLabelText('Vorlage'), {
    target: { value: '' },
  });
  control.createReply = () =>
    Response.json({ ...created, templateId: null }, { status: 201 });
  control.listReply = () => new Response(null, { status: 500 });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(
    await screen.findByText('Leerer Angebotsentwurf angelegt.'),
  ).toBeTruthy();
  expect(
    await screen.findByText(/Dateiliste konnte nicht neu geladen werden/),
  ).toBeTruthy();
  const offers = screen.getByRole('region', { name: 'Angebote' });
  expect(within(offers).getByText(/130,00/)).toBeTruthy();
  expect(
    within(offers).getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  ).toBeTruthy();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.url).toBe('/api/v1/documents/blank-offer');
  expect(posts[0]!.body).toEqual({
    eventId: 'event-1',
    contactId: 'contact-1',
  });
});

test('retrying the failed list reload only reads and never posts again', async () => {
  const { lists, posts, control } = reloadHarness();
  render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  control.listReply = () => new Response(null, { status: 503 });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  await screen.findByText(/Dateiliste konnte nicht neu geladen werden/);
  fireEvent.click(screen.getByRole('button', { name: 'Dateien erneut laden' }));
  await waitFor(() => expect(lists).toHaveLength(3));
  expect(posts).toHaveLength(1);
  expect(screen.getByText('Entwurf angelegt.')).toBeTruthy();
  expect(
    screen.getByText(/Dateiliste konnte nicht neu geladen werden/),
  ).toBeTruthy();
  // A failed retry is still a read problem: the created row stays reachable.
  expect(screen.getByText(/130,00/)).toBeTruthy();
});

test('a successful retry replaces the local row with the stored version', async () => {
  const { posts, finals, control } = reloadHarness();
  render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  control.listReply = () => new Response(null, { status: 503 });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  await screen.findByText(/Dateiliste konnte nicht neu geladen werden/);
  // The local row is on screen before the retry; the retry must replace it.
  expect(screen.getByText(/130,00/)).toBeTruthy();
  // The server answers the retry with the same id at a later version and its
  // own amount: the list must show that row once, not beside the local copy.
  control.listReply = () =>
    Response.json([{ ...created, version: 2, grossMinor: 14900 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Dateien erneut laden' }));
  await waitFor(() =>
    expect(
      screen.queryByText(/Dateiliste konnte nicht neu geladen werden/),
    ).toBeNull(),
  );
  expect(screen.queryByText(/130,00/)).toBeNull();
  expect(screen.getAllByText(/149,00/)).toHaveLength(1);
  const offers = screen.getByRole('region', { name: 'Angebote' });
  expect(within(offers).getAllByRole('listitem')).toHaveLength(1);
  expect(posts).toHaveLength(1);
  // The visible row is the server's version, and the next write proves it.
  fireEvent.click(
    within(offers).getByRole('button', {
      name: 'Angebot Entwurf finalisieren',
    }),
  );
  await waitFor(() => expect(finals).toHaveLength(1));
  expect(finals[0]!.body).toEqual({ version: 2 });
});

test('an unanswered create leaves the list exactly as it was', async () => {
  const { posts, control } = reloadHarness({ stored: [] });
  control.createReply = () => new Response(null, { status: 500 });
  render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText(/Der Angebotsstatus ist unklar/)).toBeTruthy();
  const offers = screen.getByRole('region', { name: 'Angebote' });
  expect(
    within(offers).getByText('Noch kein Angebot zu diesem Event.'),
  ).toBeTruthy();
  expect(
    within(offers).queryByRole('button', { name: /bearbeiten/i }),
  ).toBeNull();
  expect(screen.queryByText('Entwurf angelegt.')).toBeNull();
  expect(
    screen.queryByText(/Dateiliste konnte nicht neu geladen werden/),
  ).toBeNull();
  expect(posts).toHaveLength(1);
});

test('a create answer for another event is unclear and never listed', async () => {
  const { control } = reloadHarness({ stored: [] });
  control.createReply = () =>
    Response.json({ ...created, eventId: 'event-2' }, { status: 201 });
  render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText(/Der Angebotsstatus ist unklar/)).toBeTruthy();
  const offers = screen.getByRole('region', { name: 'Angebote' });
  expect(
    within(offers).getByText('Noch kein Angebot zu diesem Event.'),
  ).toBeTruthy();
  expect(screen.queryByText(/130,00/)).toBeNull();
});

test('the new draft joins the offers without disturbing the other cards', async () => {
  const invoice = { ...finalized, kind: 'invoice', number: 'RE-2030-0002' };
  const { control } = reloadHarness({ stored: [draft, invoice] });
  render(<EventDocuments {...props} />);
  expect(await screen.findByText('RE-2030-0002')).toBeTruthy();
  control.listReply = () => new Response(null, { status: 500 });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  await screen.findByText(/Dateiliste konnte nicht neu geladen werden/);
  const offers = screen.getByRole('region', { name: 'Angebote' });
  const invoices = screen.getByRole('region', { name: 'Rechnungen' });
  expect(within(invoices).getByText('RE-2030-0002')).toBeTruthy();
  expect(within(offers).getByText(/249,00/)).toBeTruthy();
  expect(within(offers).getByText(/130,00/)).toBeTruthy();
  expect(within(offers).getAllByRole('listitem')).toHaveLength(2);
});

test('the success message and the reload warning stay truthful', async () => {
  const { control } = reloadHarness();
  render(<EventDocuments {...props} />);
  await screen.findByLabelText('Vorlage');
  control.listReply = () => new Response(null, { status: 500 });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe('Entwurf angelegt.'),
  );
  const warning = screen.getByText(
    /Gespeichert, aber die Dateiliste konnte nicht neu geladen werden/,
  );
  expect(warning.closest('[role="alert"]')).toBeTruthy();
  // A stale list is never announced as current.
  expect(screen.queryByText(/Liste aktualisiert/)).toBeNull();
  // The new draft is operable, not just painted: the control takes focus.
  const edit = within(
    screen.getByRole('region', { name: 'Angebote' }),
  ).getByRole('button', { name: 'Angebot Entwurf bearbeiten' });
  edit.focus();
  expect(document.activeElement).toBe(edit);
  // While the list is stale, a second create is impossible.
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset')!
      .disabled,
  ).toBe(true);
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
