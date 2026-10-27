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
  // BKP019.c2: the finalized invoice with the derived cancellation state, and the
  // correction draft an operator creates from it.
  invoiceFinal = {
    ...invoiceDraft,
    number: 'RE-2030-0001',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:25:00Z',
    version: 2,
    correctionDirection: null,
    correctionState: 'none' as const,
    remainingCredit: 24900,
    paymentState: 'none' as const,
    openMinor: 24900,
  },
  correctionDraft = {
    id: 'doc-ko-1',
    kind: 'correction',
    templateId: null,
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:30:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
    sourceDocumentId: 'doc-re-1',
    sourceNumber: 'RE-2030-0001',
    correctionDirection: 'credit' as const,
    correctionState: null,
    remainingCredit: null,
  },
  // BKP019.c3.1: the advance payment copied from the final confirmation, and the
  // same document after it was finalized with its own AZ number.
  depositDraft = {
    id: 'doc-az-1',
    kind: 'deposit_invoice',
    templateId: null,
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:18:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
    sourceDocumentId: 'doc-ab-1',
    sourceNumber: 'AB-2030-0001',
  },
  depositFinal = {
    ...depositDraft,
    number: 'AZ-2030-0001',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:19:00Z',
    version: 2,
    correctionDirection: null,
    correctionState: null,
    remainingCredit: null,
    paymentState: 'none' as const,
    openMinor: 24900,
  },
  depositPartiallyPaid = {
    ...depositFinal,
    paymentState: 'partial' as const,
    openMinor: 14900,
  },
  depositWording = {
    subject: 'Anzahlungsrechnung für {{contact}}',
    introText: 'Anzahlung auf den Auftrag.',
    outroText: 'Der Rest wird mit der Schlussrechnung abgerechnet.',
    validityDays: 14,
  },
  // BKP019.c3.2: the final invoice copied from the same confirmation. It settles
  // the 100,00 EUR advance, so its claim is 149,00 EUR - the row shows the role,
  // the source and the two settlement amounts, never only the gross.
  finalInvoiceDraft = {
    id: 'doc-re-2',
    kind: 'invoice',
    templateId: null,
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:26:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
    sourceDocumentId: 'doc-ab-1',
    sourceNumber: 'AB-2030-0001',
    invoiceRole: 'final' as const,
    depositAppliedMinor: 10000,
    depositPaidMinor: 4000,
  },
  finalInvoiceFinal = {
    ...finalInvoiceDraft,
    number: 'RE-2030-0002',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:27:00Z',
    version: 2,
    correctionDirection: null,
    correctionState: 'none' as const,
    remainingCredit: 14900,
    paymentState: 'none' as const,
    openMinor: 14900,
  },
  // BKP019.d: the same invoice after money arrived, and the payments an operator
  // recorded. The status is derived on the server; the row only displays it.
  invoicePartiallyPaid = {
    ...invoiceFinal,
    paymentState: 'partial' as const,
    openMinor: 14900,
  },
  invoicePaid = {
    ...invoiceFinal,
    paymentState: 'paid' as const,
    openMinor: 0,
  },
  paymentRows = [
    {
      id: 'payment-1',
      documentId: 'doc-re-1',
      receivedOn: '2030-10-26',
      amountMinor: 10000,
      method: 'bank_transfer',
      note: 'Erste Rate',
      recordedAt: '2030-10-26T12:00:00Z',
    },
  ],
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
    // BKP019.c3.2: the answer to a final invoice created from a confirmation.
    finalInvoice?: () => Response;
    // BKP019.c3.1: the answer to a deposit created from a confirmation.
    deposit?: () => Response | Promise<Response>;
    correction?: () => Response;
    // BKP019.d: the payments of a document, and the answer to a recorded one.
    payments?: () => Response | Promise<Response>;
    recordPayment?: () => Response;
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
      // BKP019.c2b: the correction draft owns the texts the server copied, so
      // the shared editor can read and rewrite it like any other draft.
      'doc-ko-1': {
        ...correctionDraft,
        ...invoiceWording,
        subject: 'Rechnungskorrektur für {{contact}}',
        lines: [storedLine],
      },
      // BKP019.c3.1: the deposit draft reads and rewrites its own texts.
      'doc-az-1': {
        ...depositDraft,
        ...depositWording,
        lines: [storedLine],
      },
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
      // BKP019.c3.1: the advance payment is created from a finalized
      // confirmation. It is its own endpoint, so no invoice answer is reused.
      if (url.endsWith('/deposit-invoice')) {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        });
        if (options.deposit) return await options.deposit();
        state.documents = [finalizedConfirmation, depositDraft];
        return Response.json(depositDraft, { status: 201 });
      }
      // BKP019.c3.2: the final invoice is its own endpoint on the same
      // confirmation; its answer carries the role, because the role is part of
      // the document and not of the route.
      if (url.endsWith('/final-invoice')) {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        });
        if (options.finalInvoice) return options.finalInvoice();
        state.documents = [finalizedConfirmation, finalInvoiceDraft];
        return Response.json(finalInvoiceDraft, { status: 201 });
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
      // BKP019.c2: the correction is created from a finalized invoice.
      if (url.endsWith('/correction')) {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init!.body)),
          headers: init!.headers as Record<string, string>,
        });
        if (options.correction) return options.correction();
        state.documents = [invoiceFinal, correctionDraft];
        return Response.json(correctionDraft, { status: 201 });
      }
      // BKP019.d: only a finalized invoice has this endpoint pair; the list and
      // the write are separate calls on purpose.
      if (/\/api\/v1\/documents\/[^/]+\/payments$/.test(url)) {
        calls.push({
          url,
          method,
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
          headers: init?.headers as Record<string, string>,
        });
        if (method === 'GET') {
          if (options.payments) return await options.payments();
          return Response.json([]);
        }
        if (options.recordPayment) return options.recordPayment();
        return Response.json(paymentRows[0]!, { status: 201 });
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
  // The remaining gap is named instead of implying complete invoicing, and a
  // correction is described as its own document (BKP019.c2).
  // BKP019.c3.2: a final invoice exists now, so the card names the two roles of
  // one invoice and the one-invoice rule instead of a missing feature.
  expect(
    within(invoices).getByText(/als Standardrechnung oder als Schlussrechnung/),
  ).toBeTruthy();
  expect(within(invoices).getByText(/je Bestätigung genau eine/)).toBeTruthy();
  expect(
    within(invoices).queryByText(
      /Eine Schlussrechnung ist noch nicht verfügbar/,
    ),
  ).toBeNull();
  expect(
    within(invoices).queryByText(
      /Anzahlungs- und Schlussrechnungen sind noch nicht/,
    ),
  ).toBeNull();
  expect(
    within(invoices).getByText(/sondern nur durch eine Rechnungskorrektur/),
  ).toBeTruthy();
});

// RG-07: the service day and the payment term are invoice fields. They are shown
// only where a value exists, and the due day only on a finalized document - a
// draft names the agreed term and leaves the day to the finalization.
test('the invoice dates are shown per kind and only where they are set', async () => {
  const finalizedInvoice = {
      ...invoiceFinal,
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
      dueDate: '2030-11-10',
    },
    draftInvoice = {
      ...invoiceDraft,
      id: 'doc-re-2',
      serviceDate: null,
      paymentTermDays: 0,
      dueDate: null,
    },
    plainInvoice = { ...invoiceFinal, id: 'doc-re-3', number: 'RE-2030-0003' };
  setup({
    documents: [finalizedInvoice, draftInvoice, plainInvoice, finalized],
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const rows = within(invoices).getAllByRole('listitem');
  // The finalized invoice prints both values and the frozen due day.
  expect(within(rows[0]!).getByText(/Leistungsdatum/)).toBeTruthy();
  expect(within(rows[0]!).getByText('25.10.2030')).toBeTruthy();
  expect(
    within(rows[0]!).getByText(/Zahlungsziel 14 Tage, fällig/),
  ).toBeTruthy();
  expect(within(rows[0]!).getByText('10.11.2030')).toBeTruthy();
  // 0 days is "due immediately" and stays a real term, not an empty value.
  expect(within(rows[1]!).getByText(/Zahlungsziel 0 Tage/)).toBeTruthy();
  expect(within(rows[1]!).queryByText(/fällig/)).toBeNull();
  expect(within(rows[1]!).queryByText(/Leistungsdatum/)).toBeNull();
  // An invoice without dates shows no empty placeholder.
  expect(within(rows[2]!).queryByText(/Leistungsdatum/)).toBeNull();
  expect(within(rows[2]!).queryByText(/Zahlungsziel/)).toBeNull();
  // An offer owns none of them, and an invoice still prints no "Gültig bis".
  const offerRow = screen.getByText('AN-2030-0001').closest('li')!;
  expect(
    within(offerRow as HTMLElement).queryByText(/Leistungsdatum/),
  ).toBeNull();
  expect(
    within(offerRow as HTMLElement).queryByText(/Zahlungsziel/),
  ).toBeNull();
  expect(within(rows[0]!).queryByText(/Gültig bis/)).toBeNull();
});

// RG-07: the shared editor offers the two dates only for an invoice family draft,
// and a save carries exactly them; an offer keeps the body it always sent.
test('the shared editor shows the invoice dates only for an invoice and saves them', async () => {
  const { calls } = setup({ documents: [invoiceDraft, draft] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const invoiceRow = within(invoices).getByRole('listitem');
  fireEvent.click(
    await within(invoiceRow).findByRole('button', {
      name: 'Rechnung Entwurf bearbeiten',
    }),
  );
  const serviceDay = await within(invoiceRow).findByLabelText(/Leistungsdatum/);
  fireEvent.change(serviceDay, { target: { value: '2030-10-25' } });
  fireEvent.change(within(invoiceRow).getByLabelText(/Zahlungsziel in Tagen/), {
    target: { value: '14' },
  });
  fireEvent.click(
    within(invoiceRow).getByRole('button', { name: 'Änderungen speichern' }),
  );
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
    }),
  );
  // The same editor on the offer shows neither field - an offer has no invoice
  // day, and the server would refuse one.
  fireEvent.click(
    await within(invoiceRow).findByRole('button', {
      name: 'Bearbeitung schließen',
    }),
  );
  const offerRow = screen
    .getByRole('button', { name: 'Angebot Entwurf bearbeiten' })
    .closest('li')!;
  fireEvent.click(
    within(offerRow as HTMLElement).getByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Angebot bearbeiten' }),
  ).toBeTruthy();
  expect(screen.queryByLabelText(/Leistungsdatum/)).toBeNull();
  expect(screen.queryByLabelText(/Zahlungsziel in Tagen/)).toBeNull();
});

test('the bank account is shown multiline per kind and only where it is set', async () => {
  const withBank = {
      ...invoiceFinal,
      serviceDate: '2030-10-25',
      paymentTermDays: 14,
      dueDate: '2030-11-10',
      bankAccount: 'Fiktive Bank\nIBAN DE00 0000 0000\nBIC TESTDEFFXXX',
    },
    plainInvoice = { ...invoiceFinal, id: 'doc-re-3', number: 'RE-2030-0003' },
    // Even if a payload named an account on an offer, the row is no invoice and
    // prints none: the family decides, not the value.
    offerWithBank = { ...finalized, bankAccount: 'Fiktive Bank' };
  setup({ documents: [withBank, plainInvoice, offerWithBank] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const rows = within(invoices).getAllByRole('listitem');
  const bank = rows[0]!.querySelector('.document-invoice-bank')!;
  // The text is printed word for word, and every typed break is a real break.
  expect(bank.textContent).toBe(
    'Bankverbindung Fiktive BankIBAN DE00 0000 0000BIC TESTDEFFXXX',
  );
  expect(bank.querySelectorAll('br')).toHaveLength(2);
  // It stands under the two date lines of the same row.
  expect(rows[0]!.textContent!.indexOf('Bankverbindung')).toBeGreaterThan(
    rows[0]!.textContent!.indexOf('Leistungsdatum'),
  );
  // An invoice without an account shows no empty placeholder.
  expect(rows[1]!.querySelector('.document-invoice-bank')).toBeNull();
  expect(rows[1]!.textContent).not.toContain('Bankverbindung');
  // An offer owns none of them.
  const offerRow = screen.getByText('AN-2030-0001').closest('li')!;
  expect(
    within(offerRow as HTMLElement).queryByText(/Bankverbindung/),
  ).toBeNull();
});

// RG-07b: the shared editor offers the account field only for an invoice family
// draft, keeps its line breaks and shows the saved value again after a reload.
test('the shared editor shows the bank account field only for an invoice and saves it', async () => {
  const { calls } = setup({ documents: [invoiceDraft, draft] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const invoiceRow = within(invoices).getByRole('listitem');
  fireEvent.click(
    await within(invoiceRow).findByRole('button', {
      name: 'Rechnung Entwurf bearbeiten',
    }),
  );
  const bank = await within(invoiceRow).findByLabelText(/Bankverbindung/);
  fireEvent.change(bank, {
    target: { value: 'Fiktive Bank\nIBAN DE00 0000 0000' },
  });
  fireEvent.click(
    within(invoiceRow).getByRole('button', { name: 'Änderungen speichern' }),
  );
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      bankAccount: 'Fiktive Bank\nIBAN DE00 0000 0000',
    }),
  );
  // The row shows the saved account without another list request.
  await waitFor(() =>
    expect(
      invoiceRow.querySelector('.document-invoice-bank')?.textContent,
    ).toBe('Bankverbindung Fiktive BankIBAN DE00 0000 0000'),
  );
  // Closing and reopening loads the stored value into the field again - a save
  // that never touched it may not clear it.
  fireEvent.click(
    await within(invoiceRow).findByRole('button', {
      name: 'Bearbeitung schließen',
    }),
  );
  fireEvent.click(
    within(invoiceRow).getByRole('button', {
      name: 'Rechnung Entwurf bearbeiten',
    }),
  );
  expect(
    (
      (await within(invoiceRow).findByLabelText(
        /Bankverbindung/,
      )) as HTMLTextAreaElement
    ).value,
  ).toBe('Fiktive Bank\nIBAN DE00 0000 0000');
  fireEvent.click(
    within(invoiceRow).getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  // The same editor on the offer shows no account field - the server would
  // refuse one.
  const offerRow = screen
    .getByRole('button', { name: 'Angebot Entwurf bearbeiten' })
    .closest('li')!;
  fireEvent.click(
    within(offerRow as HTMLElement).getByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Angebot bearbeiten' }),
  ).toBeTruthy();
  expect(screen.queryByLabelText(/Bankverbindung/)).toBeNull();
});

// BKP019.c3.1: the advance payment is a second explicit step on the same
// finalized confirmation. It never appears as a side effect of invoicing, and it
// never borrows the invoice wording.
test('only a finalized confirmation offers the deposit action', async () => {
  setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Anzahlung erstellen',
    }),
  ).toBeTruthy();
  // The invoice step is still there: the two are independent, not exclusive.
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  ).toBeTruthy();
  // Nothing writes before the operator confirms the step.
  expect(row.querySelector('form')).toBeNull();
  cleanup();
  for (const entry of [
    confirmationDraft,
    acceptedOffer,
    finalized,
    depositDraft,
    invoiceFinal,
  ]) {
    setup({ documents: [entry] });
    const other = render(<EventDocuments {...props} />);
    await screen.findByText(/Angelegt am|Finalisiert am/);
    expect(
      screen.queryByRole('button', { name: /Anzahlung erstellen/ }),
    ).toBeNull();
    other.unmount();
    cleanup();
  }
});

test('a double click on the deposit confirms exactly one draft', async () => {
  const { calls } = setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Anzahlung erstellen',
    }),
  );
  const confirm = within(row).getByRole('button', {
    name: 'Auftragsbestätigung AB-2030-0001 Anzahlung anlegen',
  });
  expect(confirm).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/deposit-invoice'))).toBe(
    false,
  );
  // Several advances per order are legitimate, so the server has no duplicate
  // rule: the saving guard is what keeps a double click from writing two.
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(
    await screen.findByText('Anzahlungsrechnung als Entwurf angelegt.'),
  ).toBeTruthy();
  expect(
    calls.filter((call) => call.url.endsWith('/deposit-invoice')),
  ).toHaveLength(1);
  expect(
    calls.find((call) => call.url.endsWith('/deposit-invoice')),
  ).toMatchObject({
    url: '/api/v1/documents/doc-ab-1/deposit-invoice',
    method: 'POST',
    body: { version: 2 },
    headers: { 'x-csrf-token': 'fictional-csrf' },
  });
  // The new draft lands in its own card and names the confirmation it came from.
  const deposits = await screen.findByRole('region', {
    name: 'Anzahlungsrechnungen',
  });
  const source = within(deposits).getByRole('link', {
    name: 'Auftragsbestätigung AB-2030-0001 als PDF öffnen',
  });
  expect(source.getAttribute('href')).toBe('/api/v1/documents/doc-ab-1/pdf');
  expect(within(deposits).getByText(/Aus Auftragsbestätigung/)).toBeTruthy();
});

test('cancelling the deposit sends nothing', async () => {
  const { calls } = setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Anzahlung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Anzahlung abbrechen',
    }),
  );
  expect(
    within(row).queryByRole('button', { name: /Anzahlung anlegen/ }),
  ).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Anzahlung erstellen',
    }),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/deposit-invoice'))).toBe(
    false,
  );
});

test('a refused deposit is explained instead of retried', async () => {
  for (const [error, message] of [
    [
      'order_withdrawn',
      'Der Auftrag wurde zurückgezogen. Eine Anzahlungsrechnung ist nicht möglich.',
    ],
    [
      'number_not_configured',
      'Für Anzahlungsrechnungen ist kein Nummernkreis hinterlegt. Bitte in den Einstellungen anlegen.',
    ],
  ] as const) {
    const { calls } = setup({
      documents: [finalizedConfirmation],
      deposit: () => Response.json({ error }, { status: 409 }),
    });
    render(<EventDocuments {...props} />);
    const orders = await screen.findByRole('region', {
      name: 'Auftragsbestätigungen',
    });
    const row = within(orders).getByRole('listitem');
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Auftragsbestätigung AB-2030-0001 Anzahlung erstellen',
      }),
    );
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Auftragsbestätigung AB-2030-0001 Anzahlung anlegen',
      }),
    );
    expect(await screen.findByText(message)).toBeTruthy();
    expect(
      calls.filter((call) => call.url.endsWith('/deposit-invoice')),
    ).toHaveLength(1);
    cleanup();
  }
});

test('a finalized deposit shows its source, its payment state and the open gap', async () => {
  const { calls } = setup({
    documents: [finalizedConfirmation, depositPartiallyPaid],
  });
  render(<EventDocuments {...props} />);
  const deposits = await screen.findByRole('region', {
    name: 'Anzahlungsrechnungen',
  });
  const row = within(deposits).getByRole('listitem');
  expect(within(row).getByText('AZ-2030-0001')).toBeTruthy();
  // The source is the confirmation, linked to its PDF.
  expect(within(row).getByText(/Aus Auftragsbestätigung/)).toBeTruthy();
  expect(
    within(row)
      .getByRole('link', {
        name: 'Auftragsbestätigung AB-2030-0001 als PDF öffnen',
      })
      .getAttribute('href'),
  ).toBe('/api/v1/documents/doc-ab-1/pdf');
  // Money that arrived is derived, never written: the row only displays it.
  expect(within(row).getByText('Teilweise bezahlt')).toBeTruthy();
  expect(within(row).getByText(/Offener Betrag: 149,00 €/)).toBeTruthy();
  // A finalized deposit is corrected and paid, not edited.
  expect(
    within(row).getByRole('button', {
      name: 'Anzahlungsrechnung AZ-2030-0001 korrigieren',
    }),
  ).toBeTruthy();
  expect(
    within(row).getByRole('button', {
      name: 'Anzahlungsrechnung AZ-2030-0001 Zahlung erfassen',
    }),
  ).toBeTruthy();
  expect(
    within(row).queryByRole('button', { name: /Entwurf bearbeiten/ }),
  ).toBeNull();
  expect(
    within(row).getByRole('link', {
      name: 'Anzahlungsrechnung AZ-2030-0001 als PDF öffnen',
    }),
  ).toBeTruthy();
  // BKP019.c3.2: the netting exists now. A deposit stays its own claim, and the
  // final invoice takes the billed amount over - named, not implied away.
  expect(
    within(deposits).getByText(/Verrechnung übernimmt die Schlussrechnung/),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/deposit-invoice'))).toBe(
    false,
  );
});

test('a deposit draft opens the shared editor under its own heading', async () => {
  setup({ documents: [finalizedConfirmation, depositDraft] });
  render(<EventDocuments {...props} />);
  const deposits = await screen.findByRole('region', {
    name: 'Anzahlungsrechnungen',
  });
  const row = within(deposits).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Anzahlungsrechnung Entwurf bearbeiten',
    }),
  );
  // The heading names the advance; neither the invoice nor the offer wording
  // may label it.
  expect(
    await within(row).findByRole('heading', {
      name: 'Anzahlungsrechnung bearbeiten',
    }),
  ).toBeTruthy();
  expect(
    within(row).queryByRole('heading', { name: 'Rechnung bearbeiten' }),
  ).toBeNull();
  expect(
    within(row).queryByRole('heading', { name: 'Angebot bearbeiten' }),
  ).toBeNull();
  // The copied order is there, so the operator can cut it down to the advance.
  expect(
    ((await within(row).findByLabelText('Einleitung')) as HTMLTextAreaElement)
      .value,
  ).toBe('Anzahlung auf den Auftrag.');
});

// BKP019.c3.2: the final invoice is a third explicit step on the same finalized
// confirmation. It writes nothing before the operator confirms it, and it never
// reuses the standard invoice answer.
test('only a finalized confirmation offers the final invoice action', async () => {
  const { calls } = setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  ).toBeTruthy();
  // The standard invoice step is still there: the two are alternatives, not
  // replacements - the database allows exactly one of them per confirmation.
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Rechnung erstellen',
    }),
  ).toBeTruthy();
  expect(row.querySelector('form')).toBeNull();
  expect(calls.some((call) => call.url.endsWith('/final-invoice'))).toBe(false);
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  );
  // The step asks once; the confirming button is the only write.
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung anlegen',
    }),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/final-invoice'))).toBe(false);
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung anlegen',
    }),
  );
  expect(
    await screen.findByText('Schlussrechnung als Entwurf angelegt.'),
  ).toBeTruthy();
  const write = calls.find((call) => call.url.endsWith('/final-invoice'))!;
  expect(write.method).toBe('POST');
  expect(write.body).toEqual({ version: finalizedConfirmation.version });
  expect(write.headers!['x-csrf-token']).toBe('fictional-csrf');
  // The new row is listed as a final invoice, not as a standard one.
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const created = within(invoices).getByRole('listitem');
  expect(within(created).getByText('Schlussrechnung')).toBeTruthy();
  cleanup();
  for (const entry of [
    confirmationDraft,
    acceptedOffer,
    finalized,
    depositDraft,
  ]) {
    setup({ documents: [entry] });
    const other = render(<EventDocuments {...props} />);
    await screen.findByText(/Angelegt am|Finalisiert am/);
    expect(
      screen.queryByRole('button', { name: /Schlussrechnung erstellen$/ }),
    ).toBeNull();
    other.unmount();
    cleanup();
  }
});

// The one-invoice rule is a database fact, so the screen explains it instead of
// offering a step that can only end in a 409.
test('a confirmation that already carries an invoice offers no second one', async () => {
  setup({ documents: [finalizedConfirmation, invoiceDraft] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  expect(
    within(row).queryByRole('button', { name: /Rechnung erstellen$/ }),
  ).toBeNull();
  expect(
    within(row).queryByRole('button', { name: /Schlussrechnung erstellen$/ }),
  ).toBeNull();
  expect(within(row).getByText(/trägt bereits eine Rechnung/)).toBeTruthy();
  // A deposit is independent of that rule and stays offered.
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Anzahlung erstellen',
    }),
  ).toBeTruthy();
});

test('the final invoice step warns when the advances exceed the order', async () => {
  // 260,00 EUR billed in advance against a 249,00 EUR order. Finalizing would be
  // refused, so the step says it before the operator clicks - creating the draft
  // stays possible, because only the finalization is guarded.
  const overBilled = {
      ...depositFinal,
      id: 'doc-az-2',
      number: 'AZ-2030-0002',
      grossMinor: 26000,
      openMinor: 26000,
    },
    atLimit = {
      ...depositFinal,
      id: 'doc-az-3',
      number: 'AZ-2030-0003',
      grossMinor: 24900,
    };
  setup({ documents: [finalizedConfirmation, overBilled] });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  expect(within(row).getByText(/übersteigen den Auftrag/)).toBeTruthy();
  expect(
    within(row).getByText(
      /Bitte die Anzahlungen vor dem Finalisieren per Korrektur reduzieren/,
    ),
  ).toBeTruthy();
  // The step stays offered: the guard bites at the finalization, not here.
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  );
  expect(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung anlegen',
    }),
  ).toBeTruthy();
  expect(within(row).getByText(/übersteigen den Auftrag/)).toBeTruthy();
  cleanup();

  // Exactly at the claim there is nothing to warn about.
  setup({ documents: [finalizedConfirmation, atLimit] });
  render(<EventDocuments {...props} />);
  const fitting = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  expect(
    within(within(fitting).getByRole('listitem')).queryByText(
      /übersteigen den Auftrag/,
    ),
  ).toBeNull();
  cleanup();

  // A second advance tips the same order over that claim again.
  setup({ documents: [finalizedConfirmation, atLimit, overBilled] });
  render(<EventDocuments {...props} />);
  const again = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  expect(
    within(within(again).getByRole('listitem')).getByText(
      /übersteigen den Auftrag/,
    ),
  ).toBeTruthy();
  cleanup();

  // A debit note on the confirmation raises the claim, so the warning goes away
  // without touching a single advance.
  setup({
    documents: [
      finalizedConfirmation,
      overBilled,
      {
        ...correctionDraft,
        id: 'doc-ko-2',
        number: 'KO-2030-0002',
        state: 'final' as const,
        finalizedAt: '2030-10-26T10:28:00Z',
        grossMinor: 1100,
        sourceDocumentId: 'doc-ab-1',
        sourceNumber: 'AB-2030-0001',
        correctionDirection: 'debit' as const,
      },
    ],
  });
  render(<EventDocuments {...props} />);
  const raised = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  expect(
    within(within(raised).getByRole('listitem')).queryByText(
      /übersteigen den Auftrag/,
    ),
  ).toBeNull();
});

// BKP019.c3.2c: the pre-warning must read the same corrected claims the server
// reads - `gross + debits - credits` per advance. Otherwise the hint would name
// a remedy ("per Korrektur reduzieren") that does not move the amount it shows.
test('the advance warning follows the corrected claims of the advances', async () => {
  const overBilled = {
      ...depositFinal,
      id: 'doc-az-2',
      number: 'AZ-2030-0002',
      grossMinor: 26000,
      openMinor: 26000,
    },
    creditOnAdvance = {
      ...correctionDraft,
      id: 'doc-ko-3',
      number: 'KO-2030-0003',
      state: 'final' as const,
      finalizedAt: '2030-10-26T10:29:00Z',
      grossMinor: 1100,
      sourceDocumentId: 'doc-az-2',
      sourceNumber: 'AZ-2030-0002',
      correctionDirection: 'credit' as const,
    };
  const warning = async () => {
    const orders = await screen.findByRole('region', {
      name: 'Auftragsbestätigungen',
    });
    return within(within(orders).getByRole('listitem')).queryByText(
      /übersteigen den Auftrag/,
    );
  };
  // 260,00 EUR advance, 11,00 EUR credited on that advance: 249,00 EUR left, so
  // the order is covered again and the warning disappears.
  setup({ documents: [finalizedConfirmation, overBilled, creditOnAdvance] });
  render(<EventDocuments {...props} />);
  expect(await warning()).toBeNull();
  cleanup();

  // One cent less credited leaves 250,00 EUR and tips the same order over the
  // claim again - the warning reacts to the amount, not to the existence of a
  // correction.
  setup({
    documents: [
      finalizedConfirmation,
      overBilled,
      { ...creditOnAdvance, grossMinor: 1099 },
    ],
  });
  render(<EventDocuments {...props} />);
  expect(await warning()).toBeTruthy();
  cleanup();

  // A draft correction is no claim yet: it moves nothing, exactly like on the
  // server.
  setup({
    documents: [
      finalizedConfirmation,
      overBilled,
      { ...creditOnAdvance, state: 'draft' as const, finalizedAt: null },
    ],
  });
  render(<EventDocuments {...props} />);
  expect(await warning()).toBeTruthy();
});

test('the final invoice row names its role, its source and the settled advances', async () => {
  setup({ documents: [finalizedConfirmation, finalInvoiceFinal] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  // The role is visible next to the number, and the source stays linked.
  expect(within(row).getByText('Schlussrechnung')).toBeTruthy();
  expect(within(row).getByText('RE-2030-0002')).toBeTruthy();
  expect(within(row).getByText(/Aus Auftragsbestätigung/)).toBeTruthy();
  expect(
    within(row)
      .getByRole('link', {
        name: 'Auftragsbestätigung AB-2030-0001 als PDF öffnen',
      })
      .getAttribute('href'),
  ).toBe('/api/v1/documents/doc-ab-1/pdf');
  // The three settlement values are named: what was netted, what arrived on it
  // and what is still open. The gross stays the order's own.
  expect(
    within(row).getByText(/Anzahlungen verrechnet: 100,00 €/),
  ).toBeTruthy();
  expect(within(row).getByText(/davon geleistet: 40,00 €/)).toBeTruthy();
  expect(within(row).getByText('Offen')).toBeTruthy();
  expect(within(row).getByText(/Offener Betrag: 149,00 €/)).toBeTruthy();
  // A final invoice is paid, corrected and printed like any other claim - only
  // its wording names the role.
  expect(
    within(row).getByRole('button', {
      name: 'Schlussrechnung RE-2030-0002 Zahlung erfassen',
    }),
  ).toBeTruthy();
  expect(
    within(row).getByRole('button', {
      name: 'Schlussrechnung RE-2030-0002 korrigieren',
    }),
  ).toBeTruthy();
  expect(
    within(row).getByRole('link', {
      name: 'Schlussrechnung RE-2030-0002 als PDF öffnen',
    }),
  ).toBeTruthy();
});

// BKP019.c3.2: every rejection of the new step has its own wording, an unclear
// answer is never listed, and the confirmation step can be cancelled without a
// write.
test('a rejected, unclear or cancelled final invoice never writes twice', async () => {
  for (const [error, message] of [
    [
      'order_withdrawn',
      'Der Auftrag wurde zurückgezogen. Eine Schlussrechnung ist nicht möglich.',
    ],
    [
      'invalid_kind',
      'Nur eine finalisierte Auftragsbestätigung lässt sich als Schlussrechnung abrechnen.',
    ],
    [
      'conflict',
      'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.',
    ],
  ] as const) {
    setup({
      documents: [finalizedConfirmation],
      finalInvoice: () => Response.json({ error }, { status: 409 }),
    });
    render(<EventDocuments {...props} />);
    const orders = await screen.findByRole('region', {
      name: 'Auftragsbestätigungen',
    });
    const row = within(orders).getByRole('listitem');
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
      }),
    );
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung anlegen',
      }),
    );
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Rechnungen' })).toBeNull();
    cleanup();
  }
  // An answer that does not describe a draft of this event is unclear.
  setup({
    documents: [finalizedConfirmation],
    finalInvoice: () =>
      Response.json(
        { ...finalInvoiceDraft, eventId: 'event-2' },
        { status: 201 },
      ),
  });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung anlegen',
    }),
  );
  expect(
    await screen.findByText(
      'Schlussrechnung angelegt, aber die Antwort war unklar. Bitte Dateien erneut laden.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Rechnungen' })).toBeNull();
  cleanup();
  // Cancelling returns to the plain row and writes nothing.
  const { calls } = setup({ documents: [finalizedConfirmation] });
  render(<EventDocuments {...props} />);
  const ordersAgain = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const rowAgain = within(ordersAgain).getByRole('listitem');
  fireEvent.click(
    within(rowAgain).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  );
  fireEvent.click(
    within(rowAgain).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung abbrechen',
    }),
  );
  expect(
    within(rowAgain).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/final-invoice'))).toBe(false);
});

test('a duplicate final invoice is explained and never listed twice', async () => {
  setup({
    documents: [finalizedConfirmation],
    finalInvoice: () => Response.json({ error: 'duplicate' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const orders = await screen.findByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  const row = within(orders).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung erstellen',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Auftragsbestätigung AB-2030-0001 Schlussrechnung anlegen',
    }),
  );
  expect(
    await screen.findByText(
      'Für diese Auftragsbestätigung gibt es bereits eine Rechnung.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Rechnungen' })).toBeNull();
});

// BKP019.c2: a finalized invoice is corrected by its own follow-up document. The
// step asks once, names the direction, and never touches the invoice itself.
test('only a finalized invoice offers the correction action', async () => {
  setup({ documents: [invoiceFinal] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  expect(
    within(row).getByRole('button', {
      name: 'Rechnung RE-2030-0001 korrigieren',
    }),
  ).toBeTruthy();
  // Nothing writes before the operator opens and confirms the step.
  expect(row.querySelector('form')).toBeNull();
  cleanup();
  for (const entry of [invoiceDraft, finalizedConfirmation, finalized]) {
    setup({ documents: [entry] });
    const other = render(<EventDocuments {...props} />);
    await screen.findByText(/Angelegt am|Finalisiert am/);
    expect(screen.queryByRole('button', { name: /korrigieren$/ })).toBeNull();
    other.unmount();
    cleanup();
  }
});

test('the correction form asks for a direction and shows the remaining credit', async () => {
  const { calls } = setup({ documents: [invoiceFinal] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  // The derived state and the open amount are visible before anything happens.
  expect(within(row).getByText('Nicht storniert')).toBeTruthy();
  expect(within(row).getByText(/Noch kreditierbar: 249,00 €/)).toBeTruthy();
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Rechnung RE-2030-0001 korrigieren',
    }),
  );
  const form = within(row).getByRole('form', {
    name: 'Rechnungskorrektur anlegen',
  });
  const direction = within(form).getByLabelText(
    'Richtung',
  ) as HTMLSelectElement;
  // The default direction is the credit note; the operator can switch it.
  expect(direction.value).toBe('credit');
  expect(
    within(form).getByText('Gutschrift (mindert den Betrag)'),
  ).toBeTruthy();
  expect(calls.some((call) => call.url.endsWith('/correction'))).toBe(false);
  fireEvent.change(direction, { target: { value: 'debit' } });
  fireEvent.click(
    within(form).getByRole('button', { name: 'Korrektur anlegen' }),
  );
  expect(
    await screen.findByText('Rechnungskorrektur als Entwurf angelegt.'),
  ).toBeTruthy();
  // Exactly the two facts the server cannot guess are sent.
  expect(calls.find((call) => call.url.endsWith('/correction'))).toMatchObject({
    url: '/api/v1/documents/doc-re-1/correction',
    method: 'POST',
    body: { version: 2, direction: 'debit' },
    headers: { 'x-csrf-token': 'fictional-csrf' },
  });
  const corrections = await screen.findByRole('region', {
    name: 'Rechnungskorrekturen',
  });
  const correctionRow = within(corrections).getByRole('listitem');
  // The correction names the invoice it corrects, as a real link.
  expect(within(correctionRow).getByText(/Korrektur zu/)).toBeTruthy();
  expect(
    within(correctionRow)
      .getByRole('link', { name: 'Beleg RE-2030-0001 als PDF öffnen' })
      .getAttribute('href'),
  ).toBe('/api/v1/documents/doc-re-1/pdf');
});

test('a fully credited invoice warns before a second credit', async () => {
  setup({
    documents: [
      { ...invoiceFinal, correctionState: 'full' as const, remainingCredit: 0 },
    ],
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  // RG-08 reads "storniert" from the derived state, not from a rewritten row.
  expect(within(row).getByText('Storniert')).toBeTruthy();
  expect(within(row).getByText(/Noch kreditierbar: 0,00 €/)).toBeTruthy();
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Rechnung RE-2030-0001 korrigieren',
    }),
  );
  const form = within(row).getByRole('form', {
    name: 'Rechnungskorrektur anlegen',
  });
  // The guard is the server's; the form says so before the round trip.
  expect(within(form).getByRole('alert').textContent).toContain(
    'bereits vollständig gutgeschrieben',
  );
});

test('a refused credit is explained instead of retried', async () => {
  const { calls } = setup({
    documents: [invoiceFinal],
    correction: () =>
      Response.json({ error: 'credit_exceeds_invoice' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getByRole('listitem');
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Rechnung RE-2030-0001 korrigieren',
    }),
  );
  fireEvent.click(
    within(row).getByRole('button', { name: 'Korrektur anlegen' }),
  );
  expect(
    await screen.findByText(
      'Die Gutschrift übersteigt den Rechnungsbetrag. Bitte Betrag prüfen.',
    ),
  ).toBeTruthy();
  // One request, no silent retry, and no invented correction row.
  expect(calls.filter((call) => call.url.endsWith('/correction'))).toHaveLength(
    1,
  );
  expect(
    screen.queryByRole('region', { name: 'Rechnungskorrekturen' }),
  ).toBeNull();
});

test('a partially credited invoice derives its state and its open amount', async () => {
  setup({
    documents: [
      {
        ...invoiceFinal,
        correctionState: 'partial' as const,
        remainingCredit: 10000,
      },
      correctionDraft,
    ],
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  expect(within(invoices).getByText('Teilweise storniert')).toBeTruthy();
  expect(
    within(invoices).getByText(/Noch kreditierbar: 100,00 €/),
  ).toBeTruthy();
  // The correction stays its own draft: finalizing it gets its own number.
  const corrections = await screen.findByRole('region', {
    name: 'Rechnungskorrekturen',
  });
  expect(
    within(corrections).getByRole('button', {
      name: 'Rechnungskorrektur Entwurf finalisieren',
    }),
  ).toBeTruthy();
  expect(
    within(corrections).getByText(/als Gutschrift mindert sie/),
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
  // The invoice keeps exactly the heading it had before the correction became
  // editable - the new kind must not relabel it.
  expect(
    await within(row).findByRole('heading', { name: 'Rechnung bearbeiten' }),
  ).toBeTruthy();
  expect(
    within(row).queryByRole('heading', {
      name: 'Rechnungskorrektur bearbeiten',
    }),
  ).toBeNull();
  const editor = await within(row).findByLabelText('Einleitung');
  expect((editor as HTMLTextAreaElement).value).toBe(
    'Vielen Dank für Ihren Auftrag.',
  );
});

// BKP019.c2b: a correction draft is correctable in the same editor, under its
// own heading. The position text - the part the correction actually exists for -
// is what the write carries; the amount stays a positive magnitude.
test('a correction draft opens the shared editor under its own heading and saves its position text', async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  const { calls } = setup({ documents: [invoiceFinal, correctionDraft] });
  render(<EventDocuments {...props} />);
  const corrections = await screen.findByRole('region', {
    name: 'Rechnungskorrekturen',
  });
  const row = within(corrections).getByRole('listitem');
  // Nothing opens on its own: the editor appears only when asked for.
  expect(within(row).queryByRole('heading')).toBeNull();
  fireEvent.click(
    within(row).getByRole('button', {
      name: 'Rechnungskorrektur Entwurf bearbeiten',
    }),
  );
  expect(
    await within(row).findByRole('heading', {
      name: 'Rechnungskorrektur bearbeiten',
    }),
  ).toBeTruthy();
  // No other kind's heading labels the correction.
  expect(
    within(row).queryByRole('heading', { name: 'Rechnung bearbeiten' }),
  ).toBeNull();
  expect(
    within(row).queryByRole('heading', { name: 'Angebot bearbeiten' }),
  ).toBeNull();
  const description = (await within(row).findByLabelText(
    'Beschreibung',
  )) as HTMLInputElement;
  expect(description.value).toBe('Fiktives Fotobox-Paket');
  fireEvent.change(description, {
    target: {
      value: 'Fiktive Korrekturposition nach Rücksprache mit dem Kunden',
    },
  });
  // Leaving a changed correction asks with the correction's own wording.
  fireEvent.click(
    within(row).getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Änderungen an der Rechnungskorrektur verwerfen?',
  );
  expect(
    within(row).getByRole('heading', {
      name: 'Rechnungskorrektur bearbeiten',
    }),
  ).toBeTruthy();
  fireEvent.click(
    within(row).getByRole('button', { name: 'Änderungen speichern' }),
  );
  expect(await within(row).findByText('Änderungen gespeichert.')).toBeTruthy();
  const writes = calls.filter((call) => call.method === 'PUT');
  // Exactly the correction is written; the invoice it corrects is not.
  expect(writes).toHaveLength(1);
  expect(writes[0]!.url).toBe('/api/v1/documents/doc-ko-1/draft');
  expect(writes[0]!.headers).toMatchObject({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(writes[0]!.body).toMatchObject({
    version: 1,
    subject: 'Rechnungskorrektur für {{contact}}',
    introText: 'Vielen Dank für Ihren Auftrag.',
    outroText: 'Freundliche Grüße',
    validityDays: 14,
  });
  const lines = (
    writes[0]!.body as {
      lines: {
        description: string;
        unitPriceMinor: number;
        quantity: number;
      }[];
    }
  ).lines;
  expect(lines).toHaveLength(1);
  expect(lines[0]!.description).toBe(
    'Fiktive Korrekturposition nach Rücksprache mit dem Kunden',
  );
  // A credit is a direction, never a negative price.
  expect(lines[0]!.unitPriceMinor).toBe(24900);
  expect(lines[0]!.quantity).toBe(1);
  expect(
    calls.some(
      (call) => call.method === 'PUT' && call.url.includes('doc-re-1'),
    ),
  ).toBe(false);
  // Closing an unchanged correction returns to the row without a question.
  fireEvent.click(
    within(row).getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(
    within(row).queryByRole('heading', {
      name: 'Rechnungskorrektur bearbeiten',
    }),
  ).toBeNull();
  expect(
    within(row).getByRole('button', {
      name: 'Rechnungskorrektur Entwurf bearbeiten',
    }),
  ).toBeTruthy();
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

// BKP019.d: money that arrived is a record against the finalized invoice, and
// the row shows the derived state. Nothing here is written by printing.
test('a finalized invoice shows its payment state and the open amount', async () => {
  setup({ documents: [invoicePartiallyPaid, invoicePaid] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const rows = within(invoices).getAllByRole('listitem');
  expect(within(rows[0]!).getByText('Teilweise bezahlt')).toBeTruthy();
  expect(within(rows[0]!).getByText(/Offener Betrag: 149,00 €/)).toBeTruthy();
  expect(within(rows[1]!).getByText('Bezahlt')).toBeTruthy();
  expect(within(rows[1]!).getByText(/Offener Betrag: 0,00 €/)).toBeTruthy();
  // The payment axis never replaces the cancellation state of the invoice.
  expect(within(rows[0]!).getByText('Nicht storniert')).toBeTruthy();
});

// RG-08: the lateness is a third, independent fact. It gets its own element next
// to the payment state, so "teilweise bezahlt" stays readable and is never
// replaced by the badge.
test('an overdue invoice shows the badge beside its payment state', async () => {
  setup({ documents: [{ ...invoicePartiallyPaid, overdue: true }] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const row = within(invoices).getAllByRole('listitem')[0]!;
  expect(within(row).getByText('Teilweise bezahlt')).toBeTruthy();
  expect(within(row).getByText(/Offener Betrag: 149,00 €/)).toBeTruthy();
  const badge = within(row).getByText('Überfällig');
  // Its own <strong>, exactly like "Abgelaufen" - no new stylesheet rule.
  expect(badge.tagName).toBe('STRONG');
});

// A settled or unknown claim shows no badge: only the derived `true` does.
test('a settled invoice shows no overdue badge', async () => {
  setup({ documents: [{ ...invoicePaid, overdue: false }, invoiceFinal] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const rows = within(invoices).getAllByRole('listitem');
  expect(within(rows[0]!).getByText('Bezahlt')).toBeTruthy();
  expect(within(rows[0]!).queryByText('Überfällig')).toBeNull();
  // A row without the key at all (older answer) stays silent too.
  expect(within(rows[1]!).queryByText('Überfällig')).toBeNull();
});

test('only a finalized invoice offers the payment action', async () => {
  setup({
    documents: [invoiceDraft, finalizedConfirmation, invoiceFinal],
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const orders = screen.getByRole('region', {
    name: 'Auftragsbestätigungen',
  });
  // Per row: the draft invoice can still move, so it takes no money yet; the
  // finalized one gets exactly this one payment action.
  const invoiceRows = within(invoices).getAllByRole('listitem');
  expect(invoiceRows).toHaveLength(2);
  const draftRow = invoiceRows.find((row) =>
      row.textContent?.includes('Entwurf'),
    )!,
    finalRow = invoiceRows.find((row) =>
      row.textContent?.includes('RE-2030-0001'),
    )!;
  expect(
    within(draftRow).queryByRole('button', { name: /Zahlung erfassen/ }),
  ).toBeNull();
  expect(
    within(draftRow).getByRole('button', {
      name: 'Rechnung Entwurf finalisieren',
    }),
  ).toBeTruthy();
  expect(
    within(finalRow).getAllByRole('button', { name: /Zahlung erfassen/ }),
  ).toHaveLength(1);
  // A confirmation is no claim of its own, so it never takes a payment either.
  expect(
    within(orders).queryByRole('button', { name: /Zahlung erfassen/ }),
  ).toBeNull();
});

test('the payment form defaults to today and posts the typed values', async () => {
  const { calls } = setup({ documents: [invoiceFinal] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  const open = await within(invoices).findByRole('button', {
    name: 'Rechnung RE-2030-0001 Zahlung erfassen',
  });
  fireEvent.click(open);
  const form = await within(invoices).findByRole('form', {
    name: 'Zahlung erfassen',
  });
  // The immutability and "no print makes it paid" facts are stated, not implied.
  expect(within(form).getByText(/unveränderlicher Eingang/)).toBeTruthy();
  expect(within(form).getByText(/nie aus einem Ausdruck/)).toBeTruthy();
  const date = within(form).getByLabelText('Zahlungsdatum') as HTMLInputElement;
  expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const method = within(form).getByLabelText('Zahlweg') as HTMLSelectElement;
  expect(Array.from(method.options).map((option) => option.text)).toEqual([
    'Überweisung',
    'Bar',
    'Karte',
    'Sonstiges',
  ]);
  // The recorded payments are read from the server, not reconstructed locally.
  expect(
    await within(form).findByText('Noch keine Zahlung erfasst.'),
  ).toBeTruthy();
  fireEvent.change(within(form).getByLabelText('Betrag in €'), {
    target: { value: '100,00' },
  });
  fireEvent.change(method, { target: { value: 'cash' } });
  fireEvent.change(within(form).getByLabelText('Notiz (optional)'), {
    target: { value: '  Erste Rate  ' },
  });
  fireEvent.click(
    within(form).getByRole('button', { name: 'Zahlung speichern' }),
  );
  await waitFor(() =>
    expect(
      calls.filter(
        (call) => call.method === 'POST' && call.url.endsWith('/payments'),
      ),
    ).toHaveLength(1),
  );
  const post = calls.find(
    (call) => call.method === 'POST' && call.url.endsWith('/payments'),
  )!;
  expect(post.url).toBe('/api/v1/documents/doc-re-1/payments');
  expect(post.body).toEqual({
    receivedOn: date.value,
    amountMinor: 10000,
    method: 'cash',
    note: 'Erste Rate',
  });
  expect(await screen.findByText('Zahlung erfasst.')).toBeTruthy();
});

test('an unusable amount never leaves the browser', async () => {
  const { calls } = setup({ documents: [invoiceFinal] });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  fireEvent.click(
    await within(invoices).findByRole('button', {
      name: 'Rechnung RE-2030-0001 Zahlung erfassen',
    }),
  );
  const form = await within(invoices).findByRole('form', {
    name: 'Zahlung erfassen',
  });
  fireEvent.change(within(form).getByLabelText('Betrag in €'), {
    target: { value: '0,00' },
  });
  fireEvent.click(
    within(form).getByRole('button', { name: 'Zahlung speichern' }),
  );
  expect(
    await screen.findByText('Bitte einen Betrag größer als 0 eingeben.'),
  ).toBeTruthy();
  // A negative amount is not a decimal value this field accepts.
  fireEvent.change(within(form).getByLabelText('Betrag in €'), {
    target: { value: '-100' },
  });
  fireEvent.click(
    within(form).getByRole('button', { name: 'Zahlung speichern' }),
  );
  expect(
    await screen.findByText('Bitte einen Betrag größer als 0 eingeben.'),
  ).toBeTruthy();
  expect(
    calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/payments'),
    ),
  ).toHaveLength(0);
});

test('the recorded payments are listed oldest first with method and note', async () => {
  setup({
    documents: [invoicePartiallyPaid],
    payments: () => Response.json(paymentRows),
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  fireEvent.click(
    await within(invoices).findByRole('button', {
      name: 'Rechnung RE-2030-0001 Zahlung erfassen',
    }),
  );
  const list = await within(invoices).findByRole('list', {
    name: 'Erfasste Zahlungen',
  });
  expect(within(list).getByText('26.10.2030')).toBeTruthy();
  expect(within(list).getByText(/100,00 €/)).toBeTruthy();
  expect(within(list).getByText(/Überweisung/)).toBeTruthy();
  expect(within(list).getByText(/Erste Rate/)).toBeTruthy();
});

test('a loading and a failing payment list are named, never invented', async () => {
  let release: (() => void) | undefined;
  setup({
    documents: [invoiceFinal],
    payments: () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(Response.json(paymentRows));
      }),
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  fireEvent.click(
    await within(invoices).findByRole('button', {
      name: 'Rechnung RE-2030-0001 Zahlung erfassen',
    }),
  );
  // Loading is an explicit state, not an empty list.
  expect(
    await within(invoices).findByText('Zahlungen werden geladen …'),
  ).toBeTruthy();
  release!();
  expect(await within(invoices).findByText('26.10.2030')).toBeTruthy();

  cleanup();
  setup({
    documents: [invoiceFinal],
    payments: () => new Response(null, { status: 500 }),
  });
  render(<EventDocuments {...props} />);
  const secondInvoices = await screen.findByRole('region', {
    name: 'Rechnungen',
  });
  fireEvent.click(
    await within(secondInvoices).findByRole('button', {
      name: 'Rechnung RE-2030-0001 Zahlung erfassen',
    }),
  );
  const alert = await within(secondInvoices).findByRole('alert');
  expect(alert.textContent).toContain('Zahlungen konnten nicht geladen werden');
  // The form stays usable: only the list is unavailable.
  expect(
    within(secondInvoices).getByRole('form', { name: 'Zahlung erfassen' }),
  ).toBeTruthy();
});

test('a refused overpayment is explained and never retried', async () => {
  const { calls } = setup({
    documents: [invoicePartiallyPaid],
    recordPayment: () => Response.json({ error: 'overpaid' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  const invoices = await screen.findByRole('region', { name: 'Rechnungen' });
  fireEvent.click(
    await within(invoices).findByRole('button', {
      name: 'Rechnung RE-2030-0001 Zahlung erfassen',
    }),
  );
  const form = await within(invoices).findByRole('form', {
    name: 'Zahlung erfassen',
  });
  fireEvent.change(within(form).getByLabelText('Betrag in €'), {
    target: { value: '200' },
  });
  fireEvent.click(
    within(form).getByRole('button', { name: 'Zahlung speichern' }),
  );
  expect(
    await screen.findByText(
      'Der Betrag übersteigt den offenen Restbetrag. Bitte Betrag prüfen.',
    ),
  ).toBeTruthy();
  // A 409 is a decision of the server, so the amount stays and no second write
  // happens behind the operator's back.
  expect(
    (within(form).getByLabelText('Betrag in €') as HTMLInputElement).value,
  ).toBe('200');
  expect(
    calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/payments'),
    ),
  ).toHaveLength(1);
  expect(screen.queryByText('Zahlung erfasst.')).toBeNull();
});
