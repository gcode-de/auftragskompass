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
  // BKP019.b: the same offer after the customer accepted it, and the draft
  // confirmation an operator created from it.
  acceptedOffer = {
    ...sentOffer,
    offerStatus: 'accepted' as const,
    version: 4,
  },
  confirmationDraft = {
    id: 'doc-ab-1',
    kind: 'order_confirmation',
    templateId: null,
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:10:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
    sourceDocumentId: 'doc-2',
    sourceNumber: 'AN-2030-0001',
  },
  finalizedConfirmation = {
    ...confirmationDraft,
    number: 'AB-2030-0001',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:15:00Z',
    version: 2,
  },
  // BKP019.c1: the invoice copied from that finalized confirmation.
  invoiceDraft = {
    id: 'doc-re-1',
    kind: 'invoice',
    templateId: null,
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:20:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
    sourceDocumentId: 'doc-ab-1',
    sourceNumber: 'AB-2030-0001',
  },
  invoiceWording = {
    subject: 'Rechnung für {{contact}}',
    introText: 'Vielen Dank für Ihren Auftrag.',
    outroText: 'Freundliche Grüße',
    validityDays: 14,
  },
  // BKP019.b2: the stored draft detail the editor reads, and the wording each
  // kind owns. A confirmation names itself, so no offer wording can leak in.
  storedLine = {
    id: 'line-1',
    position: 0,
    productId: null,
    description: 'Fiktives Fotobox-Paket',
    quantity: 1,
    unit: 'Pauschale',
    unitPriceMinor: 24900,
    taxBasisPoints: 1900,
    discountBasisPoints: 0,
  },
  offerWording = {
    subject: 'Angebot für {{contact}}',
    introText: 'Guten Tag, hier ein Beispiel.',
    outroText: 'Viele Grüße',
    validityDays: 14,
  },
  confirmationWording = {
    subject: 'Auftragsbestätigung für {{contact}}',
    introText: 'Vielen Dank für Ihren Auftrag.',
    outroText: 'Freundliche Grüße',
    validityDays: 14,
  },
  // BKP019.a: the library a signed acceptance may attach; one row is already
  // archived, so it must never be offered as a choice.
  libraryFiles = [
    {
      id: 'file-1',
      displayName: 'synthetic-signed-offer.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 42,
      state: 'available',
      scanState: 'not_scanned',
      uploadedAt: '2030-10-26T09:00:00Z',
      uploadedDate: '2030-10-26',
      archivedAt: null,
    },
    {
      id: 'file-2',
      displayName: 'synthetic-archived-offer.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 42,
      state: 'archived',
      scanState: 'not_scanned',
      uploadedAt: '2030-10-26T09:00:00Z',
      uploadedDate: '2030-10-26',
      archivedAt: '2030-10-26T09:30:00Z',
    },
  ],
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
    library?: () => Response;
    orderConfirmation?: () => Response;
    invoice?: () => Response;
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
    // BKP019.b2: the one draft detail the editor reads, keyed by its own id.
    drafts: Record<string, Record<string, unknown>> = {
      'doc-1': { ...draft, ...offerWording, lines: [storedLine] },
      'doc-ab-1': {
        ...confirmationDraft,
        ...confirmationWording,
        lines: [storedLine],
      },
      'doc-re-1': { ...invoiceDraft, ...invoiceWording, lines: [storedLine] },
    },
    fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/documents?eventId=')) {
        calls.push({ url, method });
        return Response.json(state.documents);
      }
      if (url === '/api/v1/library-files') {
        calls.push({ url, method });
        if (options.library) return options.library();
        return Response.json(libraryFiles);
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
      if (url.endsWith('/order-confirmation')) {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        });
        if (options.orderConfirmation) return options.orderConfirmation();
        // The confirmed row replaces the old list on the following reload.
        state.documents = [acceptedOffer, confirmationDraft];
        return Response.json(confirmationDraft, { status: 201 });
      }
      if (url.endsWith('/invoice')) {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        });
        if (options.invoice) return options.invoice();
        state.documents = [acceptedOffer, finalizedConfirmation, invoiceDraft];
        return Response.json(invoiceDraft, { status: 201 });
      }
      if (url.endsWith('/finalize')) {
        calls.push({ url, method });
        if (options.finalize) return options.finalize();
        state.documents = [finalized];
        return Response.json(finalized);
      }
      // BKP019.b2: the shared draft editor reads and writes one document. The
      // answer echoes the submitted texts at the next version, like the server.
      if (method === 'PUT' && url.endsWith('/draft')) {
        const id = url.split('/').slice(-2)[0]!,
          body = JSON.parse(String(init!.body)) as {
            version: number;
            lines: Record<string, unknown>[];
          };
        calls.push({
          url,
          method,
          body,
          headers: init!.headers as Record<string, string>,
        });
        const current = drafts[id];
        if (!current) throw new Error('unexpected ' + url);
        const saved = {
          ...current,
          ...body,
          version: (current.version as number) + 1,
          lines: body.lines.map((line, position) => ({
            ...line,
            id: 'line-saved-' + position,
            position,
          })),
        };
        drafts[id] = saved;
        return Response.json(saved);
      }
      if (method === 'GET' && /^\/api\/v1\/documents\/[^/?]+$/.test(url)) {
        const detail = drafts[url.slice('/api/v1/documents/'.length)];
        if (!detail) throw new Error('unexpected ' + url);
        calls.push({ url, method });
        return Response.json(detail);
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
  fireEvent.change(within(row).getByLabelText('Kanal'), {
    target: { value: 'phone' },
  });
  fireEvent.submit(within(row).getByRole('form', { name: 'Annahme erfassen' }));
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
      if (url === '/api/v1/library-files') return Response.json(libraryFiles);
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
  fireEvent.change(within(row).getByLabelText('Kanal'), {
    target: { value: 'email' },
  });
  fireEvent.submit(within(row).getByRole('form', { name: 'Annahme erfassen' }));
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
  fireEvent.change(within(row).getByLabelText('Kanal'), {
    target: { value: 'other' },
  });
  fireEvent.submit(within(row).getByRole('form', { name: 'Annahme erfassen' }));
  expect(
    await screen.findByText('Dieser Statuswechsel ist nicht zulässig.'),
  ).toBeTruthy();
});

// BKP019.a: an acceptance is a compact record, not a one-click guess: the
// channel is mandatory, the instant, note and attachment are optional.
test('accepting opens a form instead of writing immediately', async () => {
  const { calls } = setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  expect(within(row).getByLabelText('Kanal')).toBeTruthy();
  expect(within(row).getByLabelText('Zeitpunkt (optional)')).toBeTruthy();
  expect(within(row).getByLabelText('Notiz (optional)')).toBeTruthy();
  expect(
    within(row).getByRole('button', { name: 'Annahme speichern' }),
  ).toBeTruthy();
  // Nothing left the browser yet - the status is not set by opening a form.
  expect(calls.some((call) => call.url.endsWith('/offer-status'))).toBe(false);
  // The library is read once, when the form asks for it.
  expect(
    calls.filter((call) => call.url === '/api/v1/library-files'),
  ).toHaveLength(1);
});

test('the acceptance form refuses to send without a channel', async () => {
  const { calls } = setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  fireEvent.submit(within(row).getByRole('form', { name: 'Annahme erfassen' }));
  expect(
    await screen.findByText('Bitte einen Annahmekanal wählen.'),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/offer-status'))).toBe(false);
});

test('an acceptance sends channel, time, note and attachment and reads them back', async () => {
  const { calls } = setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  fireEvent.change(within(row).getByLabelText('Kanal'), {
    target: { value: 'phone' },
  });
  fireEvent.change(within(row).getByLabelText('Zeitpunkt (optional)'), {
    target: { value: '2030-10-26T10:30' },
  });
  fireEvent.change(within(row).getByLabelText('Notiz (optional)'), {
    target: { value: '  Zusage am Telefon.  ' },
  });
  // The picker fills from the library request, so its option must exist first.
  await waitFor(() =>
    expect(
      within(row).getByRole('option', { name: 'synthetic-signed-offer.pdf' }),
    ).toBeTruthy(),
  );
  fireEvent.change(within(row).getByLabelText('Anhang (optional)'), {
    target: { value: 'file-1' },
  });
  fireEvent.submit(within(row).getByRole('form', { name: 'Annahme erfassen' }));
  expect(
    await screen.findByText('Angebotsstatus aktualisiert: Angenommen.'),
  ).toBeTruthy();
  expect(
    calls.find((call) => call.url.endsWith('/offer-status')),
  ).toMatchObject({
    url: '/api/v1/documents/doc-2/offer-status',
    method: 'POST',
    body: {
      status: 'accepted',
      version: 3,
      channel: 'phone',
      acceptedAt: '2030-10-26T10:30',
      note: 'Zusage am Telefon.',
      attachmentFileId: 'file-1',
    },
    headers: { 'x-csrf-token': 'fictional-csrf' },
  });
  // The form closes after a confirmed write; the row shows the reloaded state.
  expect(
    within(row).queryByRole('form', { name: 'Annahme erfassen' }),
  ).toBeNull();
});

test('an accepted offer reads in tenant time with channel, note and file', async () => {
  setup({
    documents: [
      {
        ...sentOffer,
        offerStatus: 'accepted',
        version: 4,
        acceptedAt: '2030-10-26T08:30:00Z',
        acceptanceChannel: 'phone',
        acceptanceNote: 'Kurz notiert.',
        acceptanceFileId: 'file-1',
        acceptanceFileName: 'synthetic-signed-offer.pdf',
        acceptanceFileState: 'available',
      },
    ],
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Angenommen')).closest(
    'li',
  ) as HTMLElement;
  // 08:30 UTC is 10:30 in the tenant zone: the record reads in tenant time.
  const when = within(row).getByText(/10:30/);
  expect((when.closest('time') as HTMLTimeElement).dateTime).toBe(
    '2030-10-26T08:30:00Z',
  );
  expect(within(row).getByText(/Telefon/)).toBeTruthy();
  expect(within(row).getByText(/Kurz notiert\./)).toBeTruthy();
  expect(
    within(row)
      .getByRole('link', { name: /synthetic-signed-offer\.pdf/ })
      .getAttribute('href'),
  ).toBe('/api/v1/library-files/file-1/content');
  expect(within(row).queryByText(/nicht mehr verfügbar/)).toBeNull();
});

test('only available library files are offered as an attachment', async () => {
  setup({ documents: [sentOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  const picker = within(row).getByLabelText('Anhang (optional)');
  await waitFor(() =>
    expect(
      Array.from((picker as HTMLSelectElement).options).map(
        (option) => option.text,
      ),
    ).toContain('synthetic-signed-offer.pdf'),
  );
  expect(
    Array.from((picker as HTMLSelectElement).options).map(
      (option) => option.text,
    ),
  ).not.toContain('synthetic-archived-offer.pdf');
  // The scan fact stays visible: attached bytes are uploaded, not checked.
  expect(within(row).getByText(/unverprüft/)).toBeTruthy();
});

test('a failed library load keeps the acceptance input', async () => {
  setup({
    documents: [sentOffer],
    library: () => new Response(null, { status: 500 }),
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Versendet')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot AN-2030-0001 annehmen' }),
  );
  fireEvent.change(within(row).getByLabelText('Kanal'), {
    target: { value: 'pdf' },
  });
  fireEvent.change(within(row).getByLabelText('Notiz (optional)'), {
    target: { value: 'Unterschrift liegt vor.' },
  });
  expect(
    await screen.findByText(/Anhänge konnten nicht geladen werden/),
  ).toBeTruthy();
  expect((within(row).getByLabelText('Kanal') as HTMLSelectElement).value).toBe(
    'pdf',
  );
  expect(
    (within(row).getByLabelText('Notiz (optional)') as HTMLTextAreaElement)
      .value,
  ).toBe('Unterschrift liegt vor.');
});

test('an archived attachment stays readable without a dead link', async () => {
  setup({
    documents: [
      {
        ...sentOffer,
        offerStatus: 'withdrawn',
        version: 6,
        acceptedAt: '2030-10-26T08:30:00Z',
        acceptanceChannel: 'pdf',
        acceptanceNote: 'Unterschriebene Fassung lag vor.',
        acceptanceFileId: 'file-2',
        acceptanceFileName: 'synthetic-archived-offer.pdf',
        acceptanceFileState: 'archived',
      },
    ],
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Zurückgezogen')).closest(
    'li',
  ) as HTMLElement;
  // The acceptance survives the withdrawal; only the file is gone.
  expect(within(row).getByText(/Angenommen am/)).toBeTruthy();
  expect(within(row).getByText(/Unterschriebenes PDF/)).toBeTruthy();
  expect(within(row).getByText(/synthetic-archived-offer\.pdf/)).toBeTruthy();
  expect(within(row).getByText(/nicht mehr verfügbar/)).toBeTruthy();
  expect(
    within(row).queryByRole('link', { name: /synthetic-archived-offer\.pdf/ }),
  ).toBeNull();
});

// BKP019.b: an accepted offer can be confirmed without retyping a position. The
// action exists exactly there - a draft, a sent or a withdrawn offer has none.
test('only an accepted offer offers the confirmation action', async () => {
  setup({ documents: [acceptedOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Angenommen')).closest(
    'li',
  ) as HTMLElement;
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung erstellen',
    }),
  ).toBeTruthy();
  // Nothing writes before the operator confirms the step.
  expect(row.querySelector('form')).toBeNull();
  cleanup();
  for (const entry of [
    { ...finalized, offerStatus: null },
    sentOffer,
    { ...acceptedOffer, offerStatus: 'withdrawn' as const },
  ]) {
    setup({ documents: [entry] });
    const other = render(<EventDocuments {...props} />);
    await screen.findByText(/Angelegt am|Finalisiert am/);
    expect(
      screen.queryByRole('button', { name: /Auftragsbestätigung erstellen/ }),
    ).toBeNull();
    other.unmount();
    cleanup();
  }
});

test('creating the confirmation asks once and posts the offer version', async () => {
  const { calls } = setup({ documents: [acceptedOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Angenommen')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung erstellen',
    }),
  );
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung anlegen',
    }),
  ).toBeTruthy();
  // Nothing left the browser before the confirmation.
  expect(calls.some((call) => call.url.endsWith('/order-confirmation'))).toBe(
    false,
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung anlegen',
    }),
  );
  expect(
    await screen.findByText('Auftragsbestätigung als Entwurf angelegt.'),
  ).toBeTruthy();
  expect(
    calls.find((call) => call.url.endsWith('/order-confirmation')),
  ).toMatchObject({
    url: '/api/v1/documents/doc-2/order-confirmation',
    method: 'POST',
    body: { version: 4 },
    headers: { 'x-csrf-token': 'fictional-csrf' },
  });
  // The created confirmation is on screen after the confirmed reload, and its
  // row names the source offer.
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const source = within(orders).getByRole('link', {
    name: 'Angebot AN-2030-0001 als PDF öffnen',
  });
  expect(source.getAttribute('href')).toBe('/api/v1/documents/doc-2/pdf');
  expect(source.textContent).toBe('AN-2030-0001');
});

test('cancelling the confirmation sends nothing', async () => {
  const { calls } = setup({ documents: [acceptedOffer] });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Angenommen')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung abbrechen',
    }),
  );
  expect(
    within(row).queryByRole('button', { name: /Auftragsbestätigung anlegen/ }),
  ).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung erstellen',
    }),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/order-confirmation'))).toBe(
    false,
  );
});

test('an existing confirmation is explained instead of retried', async () => {
  const { calls } = setup({
    documents: [acceptedOffer],
    orderConfirmation: () =>
      Response.json({ error: 'duplicate' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const row = (await screen.findByText('Angenommen')).closest(
    'li',
  ) as HTMLElement;
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Angebot AN-2030-0001 Auftragsbestätigung anlegen',
    }),
  );
  expect(
    await screen.findByText(
      'Für dieses Angebot gibt es bereits eine Auftragsbestätigung.',
    ),
  ).toBeTruthy();
  // Exactly one attempt: a duplicate is never posted a second time.
  expect(
    calls.filter((call) => call.url.endsWith('/order-confirmation')),
  ).toHaveLength(1);
});

test('a confirmation row names its source offer and its own kind', async () => {
  setup({ documents: [acceptedOffer, finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  expect(within(orders).getByText('AB-2030-0001')).toBeTruthy();
  // The confirmation names the offer it was copied from, as a real link.
  const source = within(orders).getByRole('link', {
    name: 'Angebot AN-2030-0001 als PDF öffnen',
  });
  expect(source.getAttribute('href')).toBe('/api/v1/documents/doc-2/pdf');
  expect(within(orders).getByText(/Aus Angebot/)).toBeTruthy();
  // Its own PDF action is labelled as a confirmation, not as an offer.
  expect(
    within(orders).getByRole('link', {
      name: 'Auftragsbestätigung AB-2030-0001 als PDF öffnen',
    }),
  ).toBeTruthy();
  expect(within(orders).queryByText(/Gültig bis/)).toBeNull();
});

// BKP019.c1: the invoice is copied from a finalized confirmation. The step asks
// once, writes nothing before the confirmation and retypes no position.
test('only a finalized confirmation offers the invoice action', async () => {
  setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  ).toBeTruthy();
  // Nothing writes before the operator confirms the step.
  expect(row.querySelector('form')).toBeNull();
  cleanup();
  for (const entry of [confirmationDraft, acceptedOffer, finalized]) {
    setup({ documents: [entry] });
    const other = render(<EventDocuments {...props} />);
    await screen.findByText(/Angelegt am|Finalisiert am/);
    expect(
      screen.queryByRole('button', { name: /Rechnung erstellen/ }),
    ).toBeNull();
    other.unmount();
    cleanup();
  }
});

test('creating the invoice asks once and posts the confirmation version', async () => {
  const { calls } = setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  );
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung anlegen',
    }),
  ).toBeTruthy();
  // Nothing left the browser before the confirmation.
  expect(calls.some((call) => call.url.endsWith('/invoice'))).toBe(false);
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung anlegen',
    }),
  );
  expect(
    await screen.findByText('Rechnung als Entwurf angelegt.'),
  ).toBeTruthy();
  expect(calls.find((call) => call.url.endsWith('/invoice'))).toMatchObject({
    url: '/api/v1/documents/doc-ab-1/invoice',
    method: 'POST',
    body: { version: 2 },
    headers: { 'x-csrf-token': 'fictional-csrf' },
  });
  // The invoice lands in its own card and names the confirmation it came from.
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const source = within(invoices).getByRole('link', {
    name: 'Auftragsbestätigung AB-2030-0001 als PDF öffnen',
  });
  expect(source.getAttribute('href')).toBe('/api/v1/documents/doc-ab-1/pdf');
  expect(within(invoices).getByText(/Aus Auftragsbestätigung/)).toBeTruthy();
});

test('cancelling the invoice sends nothing', async () => {
  const { calls } = setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung abbrechen',
    }),
  );
  expect(
    within(row).queryByRole('button', { name: /Rechnung anlegen/ }),
  ).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/invoice'))).toBe(false);
});

test('an existing invoice is explained instead of retried', async () => {
  const { calls } = setup({
    documents: [finalizedConfirmation],
    invoice: () => Response.json({ error: 'duplicate' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung anlegen',
    }),
  );
  expect(
    await screen.findByText(
      'Für diese Auftragsbestätigung gibt es bereits eine Rechnung.',
    ),
  ).toBeTruthy();
  expect(calls.filter((call) => call.url.endsWith('/invoice'))).toHaveLength(1);
});

test('a withdrawn order cannot be invoiced and says why', async () => {
  const { calls } = setup({
    documents: [finalizedConfirmation],
    invoice: () => Response.json({ error: 'order_withdrawn' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung anlegen',
    }),
  );
  expect(
    await screen.findByText(
      'Der Auftrag wurde zurückgezogen. Eine Rechnung ist nicht möglich.',
    ),
  ).toBeTruthy();
  expect(calls.filter((call) => call.url.endsWith('/invoice'))).toHaveLength(1);
});

test('an invoice refused for another reason names it instead of guessing', async () => {
  for (const [error, message] of [
    [
      'invalid_kind',
      'Nur eine finalisierte Auftragsbestätigung lässt sich abrechnen.',
    ],
    [
      'conflict',
      'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.',
    ],
  ] as const) {
    setup({
      documents: [finalizedConfirmation],
      invoice: () => Response.json({ error }, { status: 409 }),
    });
    render(<EventDocuments {...props} />);
    const orders = await screen.findByRole('region', {
      name: 'Auftragsbestätigungen',
    });
    const row = within(orders).getByRole('listitem');
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
      }),
    );
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Auftragsbestätigung AB-2030-0001 Rechnung anlegen',
      }),
    );
    expect(await screen.findByText(message)).toBeTruthy();
    cleanup();
  }
});

test('an invoice answer for another event is unclear and never listed', async () => {
  const { calls } = setup({
    documents: [finalizedConfirmation],
    invoice: () =>
      Response.json({ ...invoiceDraft, eventId: 'event-2' }, { status: 201 }),
  });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung anlegen',
    }),
  );
  expect(
    await screen.findByText(
      'Rechnung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
    ),
  ).toBeTruthy();
  // The row was not shown as if it belonged to this event, and nothing retries.
  expect(screen.queryByRole('region', { name: 'Rechnungen' })).toBeNull();
  expect(calls.filter((call) => call.url.endsWith('/invoice'))).toHaveLength(1);
});

test('an invoice row names its source confirmation, its own kind and the open steps', async () => {
  setup({ documents: [finalizedConfirmation, invoiceDraft] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  // The source is the confirmation's own number, linked to its PDF.
  expect(within(row).getByText(/Aus Auftragsbestätigung/)).toBeTruthy();
  const source = within(row).getByRole('link', {
    name: 'Auftragsbestätigung AB-2030-0001 als PDF öffnen',
  });
  expect(source.getAttribute('href')).toBe('/api/v1/documents/doc-ab-1/pdf');
  // Its own actions are named as an invoice, not as an offer.
  expect(
    within(row).getByRole('button', { name: 'Rechnung Entwurf finalisieren' }),
  ).toBeTruthy();
  expect(
    within(row).getByRole('button', { name: 'Rechnung Entwurf bearbeiten' }),
  ).toBeTruthy();
  // An invoice is no offer: no deadline, no offer status.
  expect(within(row).queryByText(/Gültig bis/)).toBeNull();
  // The open gaps are named instead of implying a complete invoicing feature.
  expect(
    within(invoices).getByText(
      /Anzahlungs-, Schluss- und Korrekturrechnungen sind noch nicht verfügbar/,
    ),
  ).toBeTruthy();
});

test('an invoice draft opens the shared editor with its own texts', async () => {
  setup({ documents: [invoiceDraft] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', { name: 'Rechnung Entwurf bearbeiten' }),
  );
  const editor = await within(row).findByLabelText('Einleitung');
  expect((editor as HTMLTextAreaElement).value).toBe(
    'Vielen Dank für Ihren Auftrag.',
  );
});

// BKP019.b2: a confirmation draft is correctable in the same editor an offer
// draft uses. Its heading names it, and the saved texts are its own.
test('a confirmation draft opens the shared editor under its own heading and saves its texts', async () => {
  const { calls } = setup({ documents: [confirmationDraft] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  // Nothing opens on its own: the editor appears only when asked for.
  expect(within(row).queryByRole('heading')).toBeNull();
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung Entwurf bearbeiten',
    }),
  );
  expect(
    await within(row).findByRole('heading', {
      name: 'Auftragsbestätigung bearbeiten',
    }),
  ).toBeTruthy();
  // The offer heading of the shared editor is never shown for a confirmation.
  expect(
    within(row).queryByRole('heading', { name: 'Angebot bearbeiten' }),
  ).toBeNull();
  const intro = (await within(row).findByLabelText(
    'Einleitung',
  )) as HTMLTextAreaElement;
  expect(intro.value).toBe('Vielen Dank für Ihren Auftrag.');
  expect(
    (within(row).getByLabelText('Betreff') as HTMLInputElement).value,
  ).toBe('Auftragsbestätigung für {{contact}}');
  fireEvent.change(intro, {
    target: { value: 'Guten Tag, wir bestätigen Ihren Auftrag verbindlich.' },
  });
  fireEvent.click(
    within(row).getByRole('button', { name: 'Änderungen speichern' }),
  );
  expect(await within(row).findByText('Änderungen gespeichert.')).toBeTruthy();
  const writes = calls.filter((call) => call.method === 'PUT');
  // Exactly the confirmation is written; the offer draft of the event is not.
  expect(writes).toHaveLength(1);
  expect(writes[0]!.url).toBe('/api/v1/documents/doc-ab-1/draft');
  expect(writes[0]!.headers).toMatchObject({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(writes[0]!.body).toMatchObject({
    version: 1,
    subject: 'Auftragsbestätigung für {{contact}}',
    introText: 'Guten Tag, wir bestätigen Ihren Auftrag verbindlich.',
    outroText: 'Freundliche Grüße',
    validityDays: 14,
  });
  expect((writes[0]!.body as { lines: unknown[] }).lines).toHaveLength(1);
  expect(
    calls.some((call) => call.url === '/api/v1/documents/doc-1/draft'),
  ).toBe(false);
  // Closing returns to the row exactly like the offer editor does.
  fireEvent.click(
    within(row).getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(
    within(row).queryByRole('heading', {
      name: 'Auftragsbestätigung bearbeiten',
    }),
  ).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung Entwurf bearbeiten',
    }),
  ).toBeTruthy();
});

// BKP019.b2: the offer draft keeps its own wording and its own heading.
test('an offer draft keeps the offer heading and wording', async () => {
  setup();
  render(<EventDocuments {...props} />);
  const offers = await screen.findByRole('region', { name: 'Angebote' });
  const row = within(offers).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  expect(
    await within(row).findByRole('heading', { name: 'Angebot bearbeiten' }),
  ).toBeTruthy();
  expect(
    within(row).queryByRole('heading', {
      name: 'Auftragsbestätigung bearbeiten',
    }),
  ).toBeNull();
  expect(
    (within(row).getByLabelText('Betreff') as HTMLInputElement).value,
  ).toBe('Angebot für {{contact}}');
});

test('a refused or unanswered confirmation is explained and never invented', async () => {
  // One confirmation attempt against a controlled answer, then teardown.
  const attempt = async (answer: () => Response) => {
    setup({ documents: [acceptedOffer], orderConfirmation: answer });
    const view = render(<EventDocuments {...props} />);
    const row = (await screen.findByText('Angenommen')).closest(
      'li',
    ) as HTMLElement;
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Angebot AN-2030-0001 Auftragsbestätigung erstellen',
      }),
    );
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Angebot AN-2030-0001 Auftragsbestätigung anlegen',
      }),
    );
    return view;
  };
  let view = await attempt(() =>
    Response.json({ error: 'offer_not_accepted' }, { status: 409 }),
  );
  expect(
    await screen.findByText(
      'Nur ein angenommenes Angebot lässt sich bestätigen. Bitte Liste aktualisieren.',
    ),
  ).toBeTruthy();
  view.unmount();
  cleanup();

  view = await attempt(() =>
    Response.json({ error: 'conflict' }, { status: 409 }),
  );
  expect(
    await screen.findByText(
      'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.',
    ),
  ).toBeTruthy();
  view.unmount();
  cleanup();

  // A further rejection keeps one honest wording instead of a guess.
  view = await attempt(() =>
    Response.json({ error: 'missing_reference' }, { status: 400 }),
  );
  expect(
    await screen.findByText(
      'Auftragsbestätigung konnte nicht erstellt werden. Bitte Angaben prüfen.',
    ),
  ).toBeTruthy();
  view.unmount();
  cleanup();

  // An answer that is not a draft confirmation is never listed as one.
  view = await attempt(() =>
    Response.json({ ...confirmationDraft, kind: 'invoice' }, { status: 201 }),
  );
  expect(
    await screen.findByText(
      'Auftragsbestätigung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('AB-2030-0001')).toBeNull();
  view.unmount();
  cleanup();

  view = await attempt(() => {
    throw new TypeError('offline');
  });
  expect(
    await screen.findByText(
      'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
    ),
  ).toBeTruthy();
  view.unmount();
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
