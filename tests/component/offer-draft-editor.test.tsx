import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { EventDocuments } from '../../apps/admin/src/EventDocuments.js';
import { EventDetails } from '../../apps/admin/src/EventDetails.js';
import {
  hasUnsavedChanges,
  installUnsavedNavigationGuard,
} from '../../apps/admin/src/unsaved-changes.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type TestLine = {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  infoText?: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
  /** DOC-PRODUCT-01.4: absent or null means the percentage is the discount. */
  discountAmountMinor?: number | null;
  optional?: boolean;
  priceBasis?: 'gross' | 'net';
};

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
    number: 'AN-2030-0001',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:05:00Z',
    version: 3,
  },
  content = {
    subject: 'Fiktives Angebot',
    introText: 'Guten Tag, hier ein Beispiel.',
    outroText: 'Viele Grüße',
    validityDays: 14,
  },
  line: TestLine = {
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
  template = {
    id: 'tpl-1',
    kind: 'offer',
    name: 'Fiktive Angebotsvorlage',
    state: 'active',
    ...content,
  };

const catalogProducts = [
  {
    id: 'product-net',
    name: 'Fiktives Nettoprodukt',
    unit: 'Paket',
    priceMinor: 10000,
    priceBasis: 'net',
    taxBasisPoints: 1900,
    state: 'active',
  },
  {
    id: 'product-gross',
    name: 'Fiktives Bruttoprodukt',
    unit: 'Stunde',
    priceMinor: 12345,
    priceBasis: 'gross',
    taxBasisPoints: 700,
    state: 'active',
  },
  {
    id: 'product-archived',
    name: 'Fiktives Archivprodukt',
    unit: 'Stück',
    priceMinor: 500,
    priceBasis: 'gross',
    taxBasisPoints: 1900,
    state: 'archived',
  },
];

// DOC-PRODUCT-01.5: a draft may carry one discount for the whole document. The
// absent case is the normal one, so the fields stay optional here.
type TestTotalDiscount = {
  totalDiscountKind?: 'percent' | 'amount';
  totalDiscountValue?: number;
  totalDiscountNote?: string | null;
};

function detail(
  values: typeof content | null = content,
  version = 1,
  discount: TestTotalDiscount = {},
) {
  return {
    ...draft,
    version,
    subject: values?.subject ?? null,
    introText: values?.introText ?? null,
    outroText: values?.outroText ?? null,
    validityDays: values?.validityDays ?? null,
    ...discount,
    lines: [line] as (
      | TestLine
      | { kind: 'info'; id: string; position: number; description: string }
    )[],
  };
}
function blankDetail() {
  return {
    ...detail(),
    id: 'blank-doc',
    templateId: null,
    subject: 'Angebot',
    introText: '',
    outroText: '',
    validityDays: 14,
    netMinor: 0,
    taxMinor: 0,
    grossMinor: 0,
    lines: [] as TestLine[],
  };
}

function setup(
  options: {
    documents?: unknown[];
    initial?: ReturnType<typeof detail>;
    template?: typeof template | null;
    put?: (body: Record<string, unknown>) => Response | Promise<Response>;
    detailGet?: () => Response | Promise<Response>;
    products?: unknown[];
    productsGet?: () => Response | Promise<Response>;
    blankCreate?: () => Response | Promise<Response>;
    initialLoadFail?: boolean;
    finalize?: (body: unknown) => Response | Promise<Response>;
    eventDetail?: object;
    eventRemove?: () => Promise<Response>;
  } = {},
) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let current = options.initial ?? detail(),
    createdBlank: ReturnType<typeof blankDetail> | null = null,
    createdRows: unknown[] = [],
    getAttempts = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET',
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (
      options.eventRemove &&
      url === '/api/v1/events/event-1' &&
      method === 'DELETE'
    )
      return options.eventRemove();
    if (options.eventDetail && url === '/api/v1/events/event-1')
      return Response.json(options.eventDetail);
    if (options.eventDetail && url.startsWith('/api/v1/library-files'))
      return Response.json([]);
    if (options.eventDetail && url === '/api/v1/events/event-1/library-files')
      return Response.json([]);
    if (url.startsWith('/api/v1/documents?eventId=')) {
      if (options.initialLoadFail && getAttempts++ === 0)
        return Response.json({ error: 'unavailable' }, { status: 503 });
      return Response.json([
        ...(options.documents ?? [
          {
            ...draft,
            version: current.version,
            netMinor: current.netMinor,
            taxMinor: current.taxMinor,
            grossMinor: current.grossMinor,
          },
        ]),
        ...createdRows,
      ]);
    }
    if (url === '/api/v1/document-templates')
      return Response.json(
        options.template === null ? [] : [options.template ?? template],
      );
    if (url === '/api/v1/products') {
      return options.productsGet
        ? options.productsGet()
        : Response.json(options.products ?? catalogProducts);
    }
    if (url === '/api/v1/documents/blank-offer' && method === 'POST') {
      const response = options.blankCreate
        ? await options.blankCreate()
        : Response.json(blankDetail(), { status: 201 });
      if (response.ok)
        createdBlank = (await response.clone().json()) as ReturnType<
          typeof blankDetail
        >;
      if (response.ok)
        createdRows = [
          ...createdRows,
          {
            ...createdBlank,
            eventId: 'event-1',
            contactId: 'contact-1',
            number: null,
            state: 'draft',
            issuedAt: '2030-10-26T10:00:00Z',
            finalizedAt: null,
          },
        ];
      return response;
    }
    if (url === '/api/v1/documents' && method === 'POST') {
      const created = {
        ...draft,
        id: 'doc-1',
        templateId: template.id,
      };
      createdRows = [...createdRows, created];
      return Response.json(created, { status: 201 });
    }
    if (url === '/api/v1/documents/blank-doc' && method === 'GET') {
      return Response.json(createdBlank ?? blankDetail());
    }
    if (url === '/api/v1/documents/blank-doc/draft' && method === 'PUT') {
      const submitted = body as { lines: Array<Record<string, unknown>> };
      createdBlank = {
        ...(createdBlank ?? blankDetail()),
        ...body,
        version: (createdBlank?.version ?? 1) + 1,
        lines: submitted.lines.map((entry, position) => ({
          ...entry,
          id: `blank-line-${position + 1}`,
          position,
        })) as TestLine[],
      } as ReturnType<typeof blankDetail>;
      return Response.json(createdBlank);
    }
    if (url === '/api/v1/documents/doc-1' && method === 'GET') {
      getAttempts += 1;
      if (options.detailGet) return options.detailGet();
      return Response.json(current);
    }
    if (url === '/api/v1/documents/doc-1/draft' && method === 'PUT') {
      if (options.put) {
        const result = await options.put(body as Record<string, unknown>);
        if (result.ok)
          current = (await result.clone().json()) as typeof current;
        return result;
      }
      current = {
        ...current,
        ...body,
        version: current.version + 1,
        lines: (body.lines as Array<Record<string, unknown>>).map(
          (entry, position) => ({
            ...entry,
            id: current.lines[position]?.id ?? `line-created-${position}`,
            position,
          }),
        ),
      };
      return Response.json(current);
    }
    if (url === '/api/v1/documents/doc-1/finalize' && method === 'POST') {
      if (options.finalize) return options.finalize(body);
      return Response.json(finalized);
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher, getAttempts };
}

const props = {
  eventId: 'event-1',
  contactId: 'contact-1',
  timeZone: 'Europe/Berlin',
  csrfToken: 'fictional-csrf',
};
function fieldValue(label: string) {
  return (
    screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement
  ).value;
}

async function openOfferCreate() {
  const trigger = await screen.findByRole('button', {
    name: 'Dokument anlegen',
  });
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: 'Angebot anlegen' });
  return trigger;
}

test('offer creation opens in a labelled dialog', async () => {
  setup({ documents: [] });
  render(<EventDocuments {...props} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  const trigger = await screen.findByRole('button', {
    name: 'Dokument anlegen',
  });
  fireEvent.click(trigger);
  expect(
    await screen.findByRole('dialog', { name: 'Angebot anlegen' }),
  ).toBeTruthy();
  expect(screen.getByText('Eventkontakt: Zugeordneter Kontakt')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('Dokumentenart'));
});

test('a draft opens focused with editable saved positions and previews only persisted values', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );

  await screen.findByLabelText('Betreff');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Betreff')),
  );
  expect(fieldValue('Betreff')).toBe('Fiktives Angebot');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Betreff')),
  );
  expect(fieldValue('Einleitung')).toBe('Guten Tag, hier ein Beispiel.');
  expect(fieldValue('Schlusstext')).toBe('Viele Grüße');
  expect(fieldValue('Gültigkeit in Tagen')).toBe('14');
  const firstPosition = screen.getByRole('group', { name: 'Position 1' });
  expect(
    firstPosition.compareDocumentPosition(
      screen.getByLabelText('Schlusstext'),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    (
      screen.getByLabelText('Beschreibung', {
        selector: 'input',
      }) as HTMLInputElement
    ).value,
  ).toBe('Fiktives Fotobox-Paket');
  expect(
    (screen.getByLabelText('Einzelpreis (Brutto) in Euro') as HTMLInputElement)
      .value,
  ).toBe('249.00');
  expect(firstPosition).toBeTruthy();
  expect(screen.queryByText(/Positionsbearbeitung folgt separat/)).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Vorschau öffnen' }).getAttribute('href'),
  ).toBe('/api/v1/documents/doc-1/preview');

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Noch nicht gespeichert' },
  });
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  expect(
    screen.getByText('Bitte zuerst speichern, damit die Vorschau stimmt.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toHaveProperty('disabled', true);
  expect(hasUnsavedChanges()).toBe(true);
  expect(calls.some((call) => call.url.endsWith('/preview'))).toBe(false);
});

test('without a template an offer is created blank, empty stays calm, and the first saved position reloads', async () => {
  const { calls } = setup({ template: null, documents: [] });
  const view = render(<EventDocuments {...props} />);
  await openOfferCreate();
  expect(screen.getByText(/Sie können auch ohne Vorlage/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Vorlage'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));

  await screen.findByLabelText('Betreff');
  expect(
    await screen.findByText('Leerer Angebotsentwurf angelegt.'),
  ).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Angebot');
  expect(fieldValue('Einleitung')).toBe('');
  expect(fieldValue('Schlusstext')).toBe('');
  expect(fieldValue('Gültigkeit in Tagen')).toBe('14');
  expect(
    screen.getByText(
      'Noch keine Positionen. Fügen Sie eine freie Position oder ein Produkt hinzu.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toHaveProperty('disabled', true);
  expect(
    screen.getByRole('button', { name: 'Vorschau öffnen' }),
  ).toHaveProperty('disabled', true);
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/blank-offer'),
  ).toHaveLength(1);
  expect(
    calls.find((call) => call.url === '/api/v1/documents/blank-offer')?.body,
  ).toEqual({
    eventId: props.eventId,
    contactId: props.contactId,
  });

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Dokument anlegen' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByText(
    'Noch keine Positionen. Fügen Sie eine freie Position oder ein Produkt hinzu.',
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Freie Position hinzufügen' }),
  );
  fireEvent.change(screen.getByLabelText('Beschreibung'), {
    target: { value: 'Fiktiver Startposten' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    lines: [
      {
        productId: null,
        description: 'Fiktiver Startposten',
        quantity: 1,
      },
    ],
  });
  expect(screen.getByRole('link', { name: 'Vorschau öffnen' })).toBeTruthy();

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const reloaded = await screen.findByRole('group', { name: 'Position 1' });
  expect(within(reloaded).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Fiktiver Startposten',
  );
});

test('a lost blank-offer creation response requires checking the list before another create', async () => {
  const { calls } = setup({
    template: null,
    documents: [],
    blankCreate: () => Promise.reject(new Error('connection lost')),
  });
  render(<EventDocuments {...props} />);
  await openOfferCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText(/Angebotsstatus ist unklar/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  expect(
    screen.getByRole('button', { name: 'Angebote aktualisieren' }),
  ).toBeTruthy();
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/blank-offer'),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Angebote aktualisieren' }),
  );
  await screen.findByText(/Liste aktualisiert.*prüfen/);
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset'),
  ).toHaveProperty('disabled', false);
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/blank-offer'),
  ).toHaveLength(1);
});

test('blank creation still requires the event contact', async () => {
  setup({ template: null, documents: [] });
  render(<EventDocuments {...props} contactId={null} />);
  await openOfferCreate();
  expect(
    screen.getByText(/Für ein Angebot zuerst einen Hauptkontakt zuordnen/),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Entwurf anlegen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test('initial list failure disables creation until a successful retry', async () => {
  setup({ documents: [], initialLoadFail: true });
  render(<EventDocuments {...props} />);
  expect(
    await screen.findByText('Dateien konnten nicht geladen werden.'),
  ).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain(
    'Dateien konnten nicht geladen werden',
  );
  await openOfferCreate();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset'),
  ).toHaveProperty('disabled', true);

  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Angebot anlegen' })).getByRole(
      'button',
      { name: 'Dateien erneut laden' },
    ),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Entwurf anlegen' })
        .closest('fieldset'),
    ).toHaveProperty('disabled', false),
  );
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset'),
  ).toHaveProperty('disabled', false);
});

test('a server error from blank creation requires list verification before retry', async () => {
  const { calls } = setup({
    template: null,
    documents: [],
    blankCreate: () =>
      Promise.resolve(Response.json({ error: 'unavailable' }, { status: 503 })),
  });
  render(<EventDocuments {...props} />);
  await openOfferCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText(/Angebotsstatus ist unklar/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/blank-offer'),
  ).toHaveLength(1);
});

test('a client error from blank creation remains a known rejection', async () => {
  const { calls } = setup({
    template: null,
    documents: [],
    blankCreate: () =>
      Promise.resolve(Response.json({ error: 'validation' }, { status: 400 })),
  });
  render(<EventDocuments {...props} />);
  await openOfferCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(
    await screen.findByText(
      'Entwurf konnte nicht angelegt werden. Vorlage, Kontakt und Anmeldung prüfen.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Angebotsstatus ist unklar/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Entwurf anlegen' }).closest('fieldset'),
  ).toHaveProperty('disabled', false);
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/blank-offer'),
  ).toHaveLength(1);
});

test('a template-backed offer keeps the existing create flow when selected', async () => {
  const { calls } = setup({ documents: [] });
  render(<EventDocuments {...props} />);
  await openOfferCreate();
  expect((screen.getByLabelText('Vorlage') as HTMLSelectElement).value).toBe(
    template.id,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  await screen.findByText('Entwurf angelegt.');
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(calls.find((call) => call.method === 'POST')).toMatchObject({
    url: '/api/v1/documents',
    body: {
      templateId: template.id,
      eventId: props.eventId,
      contactId: props.contactId,
    },
  });
});

test('a malformed successful blank-create response is treated as uncertain and is not opened', async () => {
  setup({
    template: null,
    documents: [],
    blankCreate: () =>
      Promise.resolve(
        Response.json(
          { ...blankDetail(), eventId: 'another-event' },
          { status: 201 },
        ),
      ),
  });
  render(<EventDocuments {...props} />);
  await openOfferCreate();
  fireEvent.change(screen.getByLabelText('Vorlage'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));
  expect(await screen.findByText(/Angebotsstatus ist unklar/)).toBeTruthy();
  expect(screen.queryByLabelText('Betreff')).toBeNull();
});

test('existing standalone information text remains editable', async () => {
  const description = 'Fiktiver Hinweis <b>im Klartext</b>\nZweite Zeile';
  const { calls } = setup({
    initial: {
      ...detail(),
      lines: [line, { kind: 'info', id: 'info-1', position: 1, description }],
    },
    finalize: () => Response.json({ error: 'empty_lines' }, { status: 422 }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByRole('group', { name: 'Position 1' });

  expect(
    screen.queryByRole('button', { name: 'Infotext hinzufügen' }),
  ).toBeNull();
  const info = screen.getByRole('group', { name: 'Infotext' });
  const input = within(info).getByRole('textbox', { name: 'Text' });
  const save = screen.getByRole('button', { name: 'Änderungen speichern' });
  expect(input).toHaveProperty('value', description);
  expect(within(info).queryByLabelText('Menge')).toBeNull();
  expect(
    within(info).queryByLabelText('Einzelpreis (Brutto) in Euro'),
  ).toBeNull();
  expect(save).toHaveProperty('disabled', true);

  fireEvent.click(
    screen.getByRole('button', { name: 'Freie Position hinzufügen' }),
  );
  const second = screen.getByRole('group', { name: 'Position 2' });
  fireEvent.change(within(second).getByLabelText('Beschreibung'), {
    target: { value: 'Fiktiver Aufbau' },
  });
  expect(
    info.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.click(save);
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    lines: [
      { description: line.description },
      { kind: 'info', description },
      { description: 'Fiktiver Aufbau' },
    ],
  });
  const submitted = calls.find((call) => call.method === 'PUT')?.body as {
    lines: unknown[];
  };
  expect(submitted.lines[1]).toEqual({ kind: 'info', description });

  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const reloaded = await screen.findByRole('group', { name: 'Infotext' });
  const reloadedText = within(reloaded).getByRole('textbox', { name: 'Text' });
  expect(reloadedText).toHaveProperty('value', description);
  fireEvent.change(reloadedText, { target: { value: ' ' } });
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', true);
  fireEvent.change(reloadedText, { target: { value: 'Geänderter Hinweis' } });

  fireEvent.click(screen.getByRole('button', { name: 'Position 2 entfernen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Position 1 entfernen' }));
  expect(document.activeElement).toBe(
    within(reloaded).getByRole('textbox', { name: 'Text' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(
    calls.filter((call) => call.method === 'PUT').at(-1)?.body,
  ).toMatchObject({
    lines: [{ kind: 'info', description: 'Geänderter Hinweis' }],
  });
  expect(screen.getByRole('link', { name: 'Vorschau öffnen' })).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toHaveProperty('disabled', true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  const listFinalize = screen.getByRole('button', {
    name: 'Angebot Entwurf finalisieren',
  });
  expect(listFinalize).toHaveProperty('disabled', false);
  fireEvent.click(listFinalize);
  await screen.findByText(
    'Zum Finalisieren ist mindestens eine Position erforderlich.',
  );
  expect(calls.some((call) => call.url.endsWith('/finalize'))).toBe(true);
});

test.each([
  ['offer', 'Angebot'],
  ['invoice', 'Rechnung'],
])('saves and reloads optional positions in a %s draft', async (kind, name) => {
  const { calls } = setup({
    documents: [{ ...draft, kind }],
    initial: {
      ...detail(),
      lines: [
        { ...line, productId: 'product-net', infoText: 'Fiktive Zugabe' },
        { kind: 'info', id: 'info-1', position: 1, description: 'Hinweis' },
      ],
    },
  });
  render(<EventDocuments {...props} />);
  const edit = await screen.findByRole('button', {
    name: `${name} Entwurf bearbeiten`,
  });
  fireEvent.click(edit);
  const checkbox = await screen.findByRole('checkbox', {
    name: 'Optionale Position',
  });
  expect(checkbox).toHaveProperty('checked', false);
  expect(
    within(screen.getByRole('group', { name: 'Infotext' })).queryByRole(
      'checkbox',
    ),
  ).toBeNull();

  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    lines: [
      { optional: true, productId: 'product-net', infoText: 'Fiktive Zugabe' },
      { kind: 'info', description: 'Hinweis' },
    ],
  });
  expect(screen.getByRole('link', { name: 'Vorschau öffnen' })).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: `${name} Entwurf finalisieren`,
      }),
    ).toHaveProperty('disabled', false),
  );
  expect(
    screen.getByText(
      'Der Gesamtbetrag wird ohne optionale Positionen berechnet.',
    ),
  ).toBeTruthy();

  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: `${name} Entwurf bearbeiten` }),
  );
  const reloaded = await screen.findByRole('checkbox', {
    name: 'Optionale Position',
  });
  expect(reloaded).toHaveProperty('checked', true);
  fireEvent.click(reloaded);
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const submitted = calls.filter((call) => call.method === 'PUT').at(-1)
    ?.body as {
    lines: object[];
  };
  expect(submitted.lines[0]).not.toHaveProperty('optional');
});

test('reordering keeps unsaved fields and attached text with the moved position', async () => {
  const first = { ...line, infoText: 'Fiktiver Pakettext' };
  const note = {
    kind: 'info' as const,
    id: 'info-1',
    position: 1,
    description: 'Fiktiver Hinweis',
  };
  const last = {
    ...line,
    id: 'line-2',
    position: 2,
    description: 'Fiktiver Aufbau',
  };
  const { calls } = setup({
    initial: { ...detail(), lines: [first, note, last] },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );

  const firstPosition = await screen.findByRole('group', {
    name: 'Position 1',
  });
  const firstInput = within(firstPosition).getByLabelText('Beschreibung');
  const earlier = within(firstPosition).getByRole('button', {
    name: /nach oben verschieben/,
  });
  const later = within(firstPosition).getByRole('button', {
    name: /nach unten verschieben/,
  });
  const save = screen.getByRole('button', { name: 'Änderungen speichern' });
  expect(earlier.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(earlier);
  expect(save).toHaveProperty('disabled', true);
  fireEvent.change(firstInput, {
    target: { value: 'Fiktives bearbeitetes Paket' },
  });
  fireEvent.click(later);
  fireEvent.click(later);
  expect(document.activeElement).toBe(later);
  expect(later.getAttribute('aria-disabled')).toBe('true');
  expect(
    within(screen.getByRole('group', { name: 'Position 2' })).getByLabelText(
      'Beschreibung',
    ),
  ).toBe(firstInput);
  expect(firstInput).toHaveProperty('value', 'Fiktives bearbeitetes Paket');
  expect(
    within(firstPosition).getByLabelText('Infotext (optional)'),
  ).toHaveProperty('value', 'Fiktiver Pakettext');
  expect(save).toHaveProperty('disabled', false);

  fireEvent.click(save);
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    version: 1,
    lines: [
      { kind: 'info', description: note.description },
      { description: last.description },
      {
        description: 'Fiktives bearbeitetes Paket',
        infoText: 'Fiktiver Pakettext',
      },
    ],
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  expect(
    within(
      await screen.findByRole('group', { name: 'Position 2' }),
    ).getByLabelText('Beschreibung'),
  ).toHaveProperty('value', 'Fiktives bearbeitetes Paket');
});

test('consecutive moves between the same slots renew the polite announcement', async () => {
  setup({
    initial: {
      ...detail(),
      lines: [
        line,
        { ...line, id: 'line-2', position: 1, description: 'Fiktiver Aufbau' },
      ],
    },
  });
  const { container } = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByRole('group', { name: 'Position 1' });
  const liveRegion = container.querySelector('[aria-live="polite"]')!;
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 nach oben verschieben' }),
  );
  expect(liveRegion.textContent).toBe('');

  const moveFirstRowDown = () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'Position 1 nach unten verschieben' }),
    );
  moveFirstRowDown();
  const firstAnnouncement = liveRegion.firstChild;
  const expected = 'Zeile von Stelle 1 an Stelle 2 verschoben.';
  expect(firstAnnouncement?.textContent).toBe(expected);

  moveFirstRowDown();
  expect(liveRegion.textContent).toBe(expected);
  expect(liveRegion.firstChild).not.toBe(firstAnnouncement);
});

test('only an active position drag can reorder a draft and saving disables dragging', async () => {
  let releaseSave: (value: Response) => void = () => {};
  const pendingSave = new Promise<Response>((resolve) => {
    releaseSave = resolve;
  });
  const next = {
    ...line,
    id: 'line-2',
    position: 1,
    description: 'Fiktiver Aufbau',
  };
  const { calls } = setup({
    initial: { ...detail(), lines: [line, next] },
    put: () => pendingSave,
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const first = await screen.findByRole('group', { name: 'Position 1' });
  const second = screen.getByRole('group', { name: 'Position 2' });
  const grip = first.querySelector<HTMLElement>('[draggable]')!;
  const transfer = { setData: vi.fn(), dropEffect: 'none' };
  const drag = { dataTransfer: transfer };
  const save = screen.getByRole('button', { name: 'Änderungen speichern' });

  fireEvent.dragOver(second, drag);
  fireEvent.drop(second, drag);
  expect(second.hasAttribute('data-drop-target')).toBe(false);
  expect(save).toHaveProperty('disabled', true);

  fireEvent.dragStart(grip, drag);
  expect(transfer.setData).toHaveBeenCalled();
  fireEvent.dragOver(first, drag);
  expect(first.hasAttribute('data-drop-target')).toBe(false);
  fireEvent.dragOver(second, drag);
  expect(second.hasAttribute('data-drop-target')).toBe(true);
  fireEvent.dragLeave(second);
  expect(second.hasAttribute('data-drop-target')).toBe(false);
  fireEvent.dragOver(second, drag);
  fireEvent.dragEnd(grip, drag);
  expect(second.hasAttribute('data-drop-target')).toBe(false);
  expect(save).toHaveProperty('disabled', true);

  fireEvent.dragStart(grip, drag);
  fireEvent.dragOver(second, drag);
  fireEvent.drop(second, drag);
  expect(second.hasAttribute('data-drop-target')).toBe(false);
  expect(
    within(screen.getByRole('group', { name: 'Position 1' })).getByLabelText(
      'Beschreibung',
    ),
  ).toHaveProperty('value', next.description);
  fireEvent.click(save);
  expect(
    within(first).getByRole('button', { name: /nach oben verschieben/ }),
  ).toHaveProperty('disabled', true);
  expect(grip.draggable).toBe(false);
  transfer.setData.mockClear();
  fireEvent.dragStart(grip, drag);
  expect(transfer.setData).not.toHaveBeenCalled();
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    lines: [
      { description: next.description },
      { description: line.description },
    ],
  });
  releaseSave(
    Response.json({
      ...detail(),
      version: 2,
      lines: [
        { ...next, position: 0 },
        { ...line, position: 1 },
      ],
    }),
  );
  await screen.findByText('Änderungen gespeichert.');
});

test('a draft exceeding the UTF-8 request limit stays editable and can be shortened', async () => {
  const longText = '€'.repeat(4000);
  const { calls } = setup({
    detailGet: () =>
      Response.json({
        ...detail(),
        lines: [
          line,
          ...Array.from({ length: 90 }, (_, index) => ({
            id: `info-${index}`,
            position: index + 1,
            kind: 'info',
            description: longText,
          })),
        ],
      }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const firstEdit = await screen.findByLabelText('Betreff');
  fireEvent.change(firstEdit, {
    target: { value: 'Fiktiver Entwurf mit langen Texten' },
  });
  const save = screen.getByRole('button', { name: 'Änderungen speichern' });
  fireEvent.click(save);
  await screen.findByText(
    'Der Entwurf ist zu groß. Bitte kürzen Sie die Texte und speichern Sie erneut.',
  );
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  expect(firstEdit).toHaveProperty(
    'value',
    'Fiktiver Entwurf mit langen Texten',
  );
  const notes = screen.getAllByRole('textbox', { name: /^Text$/ });
  expect(notes[0]).toHaveProperty('value', longText);
  for (const note of notes.slice(0, 4)) {
    fireEvent.change(note, { target: { value: 'Gekürzter Hinweis' } });
  }
  fireEvent.click(save);
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test('existing and free positions save exactly, removal/addition persist, and row totals refresh without a detail refetch', async () => {
  const primaryLine = {
      ...line,
      productId: '22222222-2222-4222-8222-222222222222',
    },
    secondLine = {
      ...line,
      id: 'line-2',
      position: 1,
      productId: '11111111-1111-4111-8111-111111111111',
      description: 'Fiktive Zusatzleistung',
      unitPriceMinor: 5000,
    },
    savedLines = [
      {
        productId: '22222222-2222-4222-8222-222222222222',
        description: 'Fiktives aktualisiertes Paket',
        quantity: 2,
        unit: 'Pauschale',
        unitPriceMinor: 123456,
        taxBasisPoints: 770,
        discountBasisPoints: 1250,
        discountAmountMinor: null,
        priceBasis: 'gross',
      },
      {
        productId: null,
        description: 'Fiktiver Aufbau',
        quantity: 3,
        unit: 'Stunde',
        unitPriceMinor: 2500,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
        discountAmountMinor: null,
        priceBasis: 'gross',
      },
    ];
  const { calls } = setup({
    initial: { ...detail(), lines: [primaryLine, secondLine] },
    put: (body) => {
      const returned = {
        ...detail(),
        ...body,
        version: 2,
        netMinor: 23000,
        taxMinor: 4500,
        grossMinor: 27500,
        lines: (body.lines as typeof savedLines).map((entry, position) => ({
          ...entry,
          id: position === 0 ? 'line-1' : 'line-3',
          position,
        })),
      };
      return Response.json(returned);
    },
  });
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const first = screen.getByRole('group', { name: 'Position 1' });
  fireEvent.change(within(first).getByLabelText('Beschreibung'), {
    target: { value: 'Fiktives aktualisiertes Paket' },
  });
  fireEvent.change(within(first).getByLabelText('Menge'), {
    target: { value: '2' },
  });
  fireEvent.change(
    within(first).getByLabelText('Einzelpreis (Brutto) in Euro'),
    { target: { value: '1234,56' } },
  );
  fireEvent.change(within(first).getByLabelText('Steuer in Prozent'), {
    target: { value: '7,70' },
  });
  fireEvent.change(within(first).getByLabelText('Rabatt in Prozent'), {
    target: { value: '12,50' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Position 2 entfernen' }));
  expect(document.activeElement).toBe(
    within(first).getByLabelText('Beschreibung'),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Freie Position hinzufügen' }),
  );
  const second = screen.getByRole('group', { name: 'Position 2' });
  expect(document.activeElement).toBe(
    within(second).getByLabelText('Beschreibung'),
  );
  fireEvent.change(within(second).getByLabelText('Beschreibung'), {
    target: { value: 'Fiktiver Aufbau' },
  });
  fireEvent.change(within(second).getByLabelText('Menge'), {
    target: { value: '3' },
  });
  fireEvent.change(within(second).getByLabelText('Einheit'), {
    target: { value: 'Stunde' },
  });
  fireEvent.change(
    within(second).getByLabelText('Einzelpreis (Brutto) in Euro'),
    { target: { value: '25' } },
  );

  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      version: 1,
      ...content,
      // DOC-PRODUCT-01.5: an untouched discount names all three halves as null.
      totalDiscountKind: null,
      totalDiscountValue: null,
      totalDiscountNote: null,
      lines: savedLines,
    }),
  );
  await screen.findByText('Änderungen gespeichert.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(document.querySelector('.document-meta')?.textContent).toContain(
    '275,00',
  );
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/doc-1'),
  ).toHaveLength(1);
  expect(
    calls.filter(
      (call) =>
        call.url.startsWith('/api/v1/documents?eventId=') &&
        call.method === 'GET',
    ),
  ).toHaveLength(1);
  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const persistedPosition = await screen.findByRole('group', {
    name: 'Position 2',
  });
  expect(
    within(persistedPosition).getByLabelText('Beschreibung'),
  ).toHaveProperty('value', 'Fiktiver Aufbau');
});

test('the catalog loads on demand and explicitly appends a persisted net product with its price basis', async () => {
  const archivedReference = 'product-archived';
  const { calls } = setup({
    initial: {
      ...detail(),
      lines: [{ ...line, productId: archivedReference }],
    },
  });
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  expect(calls.filter((call) => call.url === '/api/v1/products')).toHaveLength(
    0,
  );
  const original = screen.getByRole('group', { name: 'Position 1' });
  expect(within(original).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    line.description,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  const picker = await screen.findByLabelText('Produkt aus Katalog');
  expect(calls.filter((call) => call.url === '/api/v1/products')).toHaveLength(
    1,
  );
  expect(
    screen.queryByRole('option', { name: 'Fiktives Archivprodukt' }),
  ).toBeNull();
  fireEvent.change(picker, { target: { value: 'product-net' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Katalogauswahl schließen' }),
  );
  expect(
    screen
      .getByRole('button', { name: 'Produkt hinzufügen' })
      .getAttribute('aria-expanded'),
  ).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  expect(
    (screen.getByLabelText('Produkt aus Katalog') as HTMLSelectElement).value,
  ).toBe('product-net');
  expect(calls.filter((call) => call.url === '/api/v1/products')).toHaveLength(
    1,
  );

  // Choosing only stages the source; it does not replace or append anything.
  expect(screen.getAllByRole('group', { name: /^Position / })).toHaveLength(1);
  expect(within(original).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    line.description,
  );
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Als Position hinzufügen' }),
  );

  const added = await screen.findByRole('group', { name: 'Position 2' });
  expect(within(added).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Fiktives Nettoprodukt',
  );
  expect(within(added).getByLabelText('Einheit')).toHaveProperty(
    'value',
    'Paket',
  );
  expect(
    within(added).getByLabelText('Einzelpreis (Netto) in Euro'),
  ).toHaveProperty('value', '100.00');
  expect(within(added).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'net',
  );
  expect(within(added).getByLabelText('Steuer in Prozent')).toHaveProperty(
    'value',
    '19.00',
  );
  expect(within(added).getByLabelText('Menge')).toHaveProperty('value', '1');
  expect(within(added).getByLabelText('Rabatt in Prozent')).toHaveProperty(
    'value',
    '0.00',
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(added).getByLabelText('Beschreibung'),
    ),
  );

  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const savedBody = calls.find((call) => call.method === 'PUT')?.body as {
    lines: Array<Record<string, unknown>>;
  };
  expect(savedBody.lines).toHaveLength(2);
  expect(savedBody.lines[0]).toMatchObject({
    productId: archivedReference,
    description: line.description,
    unitPriceMinor: line.unitPriceMinor,
  });
  expect(savedBody.lines[1]).toMatchObject({
    productId: 'product-net',
    description: 'Fiktives Nettoprodukt',
    quantity: 1,
    unit: 'Paket',
    unitPriceMinor: 10000,
    taxBasisPoints: 1900,
    discountBasisPoints: 0,
    priceBasis: 'net',
  });

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const reloaded = await screen.findByRole('group', { name: 'Position 2' });
  expect(within(reloaded).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Fiktives Nettoprodukt',
  );
  expect(
    within(reloaded).getByLabelText('Einzelpreis (Netto) in Euro'),
  ).toHaveProperty('value', '100.00');
  expect(within(reloaded).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'net',
  );
});

test('gross and net catalog prices are copied unchanged with their basis', async () => {
  setup({
    products: [
      ...catalogProducts,
      {
        id: 'product-overflow',
        name: 'Fiktives Produkt mit Überlauf',
        unit: 'Stück',
        priceMinor: Number.MAX_SAFE_INTEGER,
        priceBasis: 'net',
        taxBasisPoints: 1,
        state: 'active',
      },
    ],
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  const picker = await screen.findByLabelText('Produkt aus Katalog');
  fireEvent.change(picker, { target: { value: 'product-gross' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Als Position hinzufügen' }),
  );
  const grossLine = await screen.findByRole('group', { name: 'Position 2' });
  expect(
    within(grossLine).getByLabelText('Einzelpreis (Brutto) in Euro'),
  ).toHaveProperty('value', '123.45');
  expect(within(grossLine).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'gross',
  );
  expect(
    within(grossLine).getByLabelText('Infotext (optional)'),
  ).toHaveProperty('value', '');

  // The net price is not converted: it stays the stored net amount and keeps
  // its basis, even at the largest safe minor unit.
  fireEvent.change(picker, { target: { value: 'product-overflow' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Als Position hinzufügen' }),
  );
  const netLine = await screen.findByRole('group', { name: 'Position 3' });
  expect(
    within(netLine).getByLabelText('Einzelpreis (Netto) in Euro'),
  ).toHaveProperty('value', '90071992547409.91');
  expect(within(netLine).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'net',
  );
  expect(screen.getAllByRole('group', { name: /^Position / })).toHaveLength(3);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a stored net price basis loads, stays unconverted and saves the chosen basis', async () => {
  const { calls } = setup({
    initial: {
      ...detail(),
      lines: [{ ...line, unitPriceMinor: 10000, priceBasis: 'net' as const }],
    },
  });
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const position = screen.getByRole('group', { name: 'Position 1' });
  expect(within(position).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'net',
  );
  expect(
    within(position).getByLabelText('Einzelpreis (Netto) in Euro'),
  ).toHaveProperty('value', '100.00');

  // Switching the basis renames the price field only; the stored amount is
  // never converted on the client.
  fireEvent.change(within(position).getByLabelText('Preisbasis'), {
    target: { value: 'gross' },
  });
  expect(
    within(position).getByLabelText('Einzelpreis (Brutto) in Euro'),
  ).toHaveProperty('value', '100.00');
  expect(
    within(position).queryByLabelText('Einzelpreis (Netto) in Euro'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const savedBody = calls.find((call) => call.method === 'PUT')?.body as {
    lines: Array<Record<string, unknown>>;
  };
  expect(savedBody.lines[0]).toMatchObject({
    unitPriceMinor: 10000,
    priceBasis: 'gross',
  });
  expect(within(position).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'gross',
  );

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const reloaded = await screen.findByRole('group', { name: 'Position 1' });
  expect(within(reloaded).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'gross',
  );
  expect(
    within(reloaded).getByLabelText('Einzelpreis (Brutto) in Euro'),
  ).toHaveProperty('value', '100.00');
});

test('mixed gross and net positions show and send their basis while the server total stays authoritative', async () => {
  const netLine = {
      ...line,
      id: 'line-2',
      position: 1,
      description: 'Fiktives Nettopaket',
      unit: 'Pauschale',
      unitPriceMinor: 10000,
      priceBasis: 'net' as const,
    },
    mixed = {
      ...detail(),
      netMinor: 30924,
      taxMinor: 5876,
      grossMinor: 36800,
      lines: [line, netLine],
    };
  const { calls } = setup({
    initial: mixed as ReturnType<typeof detail>,
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const gross = screen.getByRole('group', { name: 'Position 1' }),
    net = screen.getByRole('group', { name: 'Position 2' });
  expect(within(gross).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'gross',
  );
  expect(within(net).getByLabelText('Preisbasis')).toHaveProperty(
    'value',
    'net',
  );
  expect(
    within(gross).getByLabelText('Einzelpreis (Brutto) in Euro'),
  ).toHaveProperty('value', '249.00');
  expect(
    within(net).getByLabelText('Einzelpreis (Netto) in Euro'),
  ).toHaveProperty('value', '100.00');
  const total = () =>
    screen.getByText(/Gespeicherter Gesamtbetrag/).textContent;
  expect(total()).toContain('368,00');

  // Doubling the quantity is arithmetic only the core owns; the shown total
  // stays the confirmed server amount until the next save response.
  fireEvent.change(within(net).getByLabelText('Menge'), {
    target: { value: '2' },
  });
  expect(total()).toContain('368,00');
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const savedBody = calls.find((call) => call.method === 'PUT')?.body as {
    lines: Array<Record<string, unknown>>;
  };
  expect(savedBody.lines.map((entry) => entry.priceBasis)).toEqual([
    'gross',
    'net',
  ]);
  expect(savedBody.lines[1]).toMatchObject({
    quantity: 2,
    unitPriceMinor: 10000,
  });
  expect(total()).toContain('368,00');
});

test('catalog failure can be retried and an empty active catalog has a clear state', async () => {
  let attempts = 0;
  setup({
    productsGet: () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(Response.json(catalogProducts));
    },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Produktkatalog konnte nicht geladen werden.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Katalog erneut laden' }));
  expect(await screen.findByLabelText('Produkt aus Katalog')).toBeTruthy();
  expect(attempts).toBe(2);

  cleanup();
  setup({ products: [] });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  expect(
    await screen.findByText('Keine aktiven Produkte im Katalog.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Freie Position hinzufügen' }),
  ).toBeTruthy();
});

test('a delayed catalog response does not replace edits made while it loads', async () => {
  let resolveProducts!: (response: Response) => void;
  setup({
    productsGet: () =>
      new Promise<Response>((resolve) => {
        resolveProducts = resolve;
      }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  expect(await screen.findByText('Produktkatalog wird geladen.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Beschreibung'), {
    target: { value: 'Fiktive eigene Änderung während des Ladens' },
  });
  resolveProducts(Response.json(catalogProducts));
  await screen.findByLabelText('Produkt aus Katalog');
  expect(screen.getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Fiktive eigene Änderung während des Ladens',
  );
});

test('a delayed catalog failure does not replace an offer version-conflict message', async () => {
  let rejectCatalog!: (response: Response) => void;
  setup({
    productsGet: () =>
      new Promise<Response>((resolve) => {
        rejectCatalog = resolve;
      }),
    put: () => Response.json({ error: 'conflict' }, { status: 409 }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktiver geänderter Betreff' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  const conflict = await screen.findByText(/zwischenzeitlich geändert/);
  rejectCatalog(Response.json({ error: 'offline' }, { status: 503 }));
  await screen.findByText('Produktkatalog konnte nicht geladen werden.');
  expect(conflict.textContent).toContain('zwischenzeitlich geändert');
  expect(conflict.closest('[role="alert"]')).toBeTruthy();
});

test('catalog failure remains local when an offer save succeeds', async () => {
  setup({ productsGet: () => Promise.reject(new Error('offline')) });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  await screen.findByText('Produktkatalog konnte nicht geladen werden.');
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktiver gespeicherter Betreff' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  const saved = await screen.findByText('Änderungen gespeichert.');
  expect(saved.closest('[role="status"]')).toBeTruthy();
  expect(
    screen
      .getByText('Produktkatalog konnte nicht geladen werden.')
      .closest('[role="alert"]'),
  ).toBeTruthy();
});

test('removing the first of three positions focuses the first surviving description', async () => {
  const secondLine = {
      ...line,
      id: 'line-2',
      position: 1,
      description: 'Zweite Leistung',
    },
    thirdLine = {
      ...line,
      id: 'line-3',
      position: 2,
      description: 'Dritte Leistung',
    };
  setup({ initial: { ...detail(), lines: [line, secondLine, thirdLine] } });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByRole('group', { name: 'Position 3' });
  fireEvent.click(screen.getByRole('button', { name: 'Position 1 entfernen' }));
  const remaining = screen.getByRole('group', { name: 'Position 1' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(remaining).getByLabelText('Beschreibung'),
    ),
  );
  expect(within(remaining).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Zweite Leistung',
  );
});

test('removing the middle of three positions focuses the next surviving description', async () => {
  const secondLine = {
      ...line,
      id: 'line-2',
      position: 1,
      description: 'Zweite Leistung',
    },
    thirdLine = {
      ...line,
      id: 'line-3',
      position: 2,
      description: 'Dritte Leistung',
    };
  setup({ initial: { ...detail(), lines: [line, secondLine, thirdLine] } });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByRole('group', { name: 'Position 3' });
  fireEvent.click(screen.getByRole('button', { name: 'Position 2 entfernen' }));
  const remaining = screen.getByRole('group', { name: 'Position 2' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(remaining).getByLabelText('Beschreibung'),
    ),
  );
  expect(within(remaining).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Dritte Leistung',
  );
});

test('saving sends all values with the loaded version, survives reload, and finalizes that version', async () => {
  const { calls } = setup();
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktive aktualisierte Betreffzeile' },
  });
  fireEvent.change(screen.getByLabelText('Einleitung'), {
    target: { value: 'Fiktive aktualisierte Einleitung' },
  });
  fireEvent.change(screen.getByLabelText('Schlusstext'), {
    target: { value: 'Fiktiver aktualisierter Schluss' },
  });
  fireEvent.change(screen.getByLabelText('Gültigkeit in Tagen'), {
    target: { value: '30' },
  });
  const saveButton = screen.getByRole('button', {
    name: 'Änderungen speichern',
  });
  saveButton.focus();
  fireEvent.click(saveButton);

  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      version: 1,
      subject: 'Fiktive aktualisierte Betreffzeile',
      introText: 'Fiktive aktualisierte Einleitung',
      outroText: 'Fiktiver aktualisierter Schluss',
      validityDays: 30,
      totalDiscountKind: null,
      totalDiscountValue: null,
      totalDiscountNote: null,
      lines: [
        {
          productId: null,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceMinor: line.unitPriceMinor,
          taxBasisPoints: line.taxBasisPoints,
          discountBasisPoints: line.discountBasisPoints,
          discountAmountMinor: null,
          priceBasis: 'gross',
        },
      ],
    }),
  );
  expect(await screen.findByText('Änderungen gespeichert.')).toBeTruthy();
  expect(document.activeElement).toBe(saveButton);
  expect(hasUnsavedChanges()).toBe(false);
  expect(
    screen.getByRole('link', { name: 'Vorschau öffnen' }).getAttribute('href'),
  ).toBe('/api/v1/documents/doc-1/preview');

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktive aktualisierte Betreffzeile');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Angebot Entwurf finalisieren',
    }),
  );
  await waitFor(() =>
    expect(calls.find((call) => call.url.endsWith('/finalize'))?.body).toEqual({
      version: 2,
    }),
  );
});

test('position fields stay disabled while a save is pending and re-enable after success', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { calls } = setup({ put: () => pending });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.change(subject, { target: { value: 'Fiktiver neuer Betreff' } });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'PUT')).toBe(true),
  );
  expect(screen.getByRole('group', { name: 'Position 1' })).toHaveProperty(
    'disabled',
    true,
  );
  finish(
    Response.json({
      ...detail(),
      subject: 'Fiktiver neuer Betreff',
      version: 2,
    }),
  );
  await screen.findByText('Änderungen gespeichert.');
  expect(screen.getByRole('group', { name: 'Position 1' })).toHaveProperty(
    'disabled',
    false,
  );
});

test('pending finalization locks draft fields, saving and closing until its result', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { calls } = setup({ finalize: () => pending });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.click(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  );
  await screen.findByText('Dokument wird finalisiert …');
  const close = screen.getByRole('button', { name: 'Bearbeitung schließen' });
  const save = screen.getByRole('button', { name: 'Änderungen speichern' });
  expect(subject).toHaveProperty('disabled', true);
  expect(screen.getByRole('group', { name: 'Position 1' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(close).toHaveProperty('disabled', true);
  expect(save).toHaveProperty('disabled', true);
  fireEvent.change(subject, {
    target: { value: 'Fiktive Änderung während Finalisierung' },
  });
  fireEvent.keyDown(subject, { key: 'Escape' });
  fireEvent.click(close);
  fireEvent.submit(save.closest('form')!);
  expect(subject.isConnected).toBe(true);
  expect(fieldValue('Betreff')).toBe(content.subject);
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  finish(Response.json({ error: 'artifact_failed' }, { status: 409 }));
  await screen.findByText(
    'PDF konnte nicht erzeugt werden. Bitte Betreiber informieren.',
  );
  await waitFor(() => expect(subject).toHaveProperty('disabled', false));
  fireEvent.click(close);
  expect(subject.isConnected).toBe(false);
});

test('the document editor guards event removal, closing and browser navigation', async () => {
  let finishRemoval!: (reply: Response) => void;
  const pendingRemoval = new Promise<Response>((resolve) => {
    finishRemoval = resolve;
  });
  const { calls } = setup({
    eventRemove: () => pendingRemoval,
    eventDetail: {
      event: {
        id: 'event-1',
        version: 1,
        name: 'Fiktives Event',
        status: 'inquiry',
        eventDate: null,
        startsAt: null,
        endsAt: null,
        timeZone: 'Europe/Berlin',
        eventTypeId: null,
        packageId: null,
        locationId: null,
        venue: null,
        venueOverride: false,
        primaryContactId: 'contact-1',
        additionalContactIds: [],
        source: '',
        description: '',
        notesHtml: '',
      },
      contacts: [],
      location: null,
      eventType: null,
      package: null,
      activities: [],
    },
  });
  const onClose = vi.fn(),
    onRecordDirtyChange = vi.fn();
  render(
    <EventDetails
      id="event-1"
      csrfToken={props.csrfToken}
      statuses={[]}
      onChanged={async () => {}}
      onEdit={vi.fn()}
      onClose={onClose}
      onRecordDirtyChange={onRecordDirtyChange}
    />,
  );
  await screen.findByRole('heading', { name: 'Event: Fiktives Event' });
  fireEvent.click(screen.getByText('Weitere Eventaktionen'));
  const remove = screen.getByRole('button', { name: 'Event entfernen' });
  expect(remove).toHaveProperty('disabled', false);
  fireEvent.click(screen.getByRole('button', { name: 'Dateien' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const subject = await screen.findByLabelText('Betreff');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const close = screen.getByRole('button', { name: 'Event-Details schließen' });
  expect(remove).toHaveProperty('disabled', true);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(subject, {
    target: { value: 'Fiktive ungespeicherte Eingabe' },
  });
  expect(onRecordDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(remove);
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(close);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(fieldValue('Betreff')).toBe('Fiktive ungespeicherte Eingabe');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  const acceptedUrl = window.location.href;
  const removeGuard = installUnsavedNavigationGuard();
  try {
    window.history.replaceState(null, '', '#event-other');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe(acceptedUrl);
  } finally {
    removeGuard();
    window.history.replaceState(null, '', acceptedUrl);
  }
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(remove).toHaveProperty('disabled', false);
  const edit = screen.getByRole('button', {
    name: 'Angebot Entwurf bearbeiten',
  });
  const create = screen.getByRole('button', { name: 'Dokument anlegen' });
  fireEvent.click(remove);
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  expect(edit).toHaveProperty('disabled', true);
  expect(create).toHaveProperty('disabled', true);
  fireEvent.click(edit);
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  finishRemoval(Response.json({ error: 'conflict' }, { status: 409 }));
  await waitFor(() => expect(edit).toHaveProperty('disabled', false));
});

test('legacy draft values are initialized from the current template only in the editor and disclosed', async () => {
  const archivedTemplate = { ...template, state: 'archived' };
  const { calls } = setup({
    initial: detail(null),
    template: archivedTemplate,
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktives Angebot');
  expect(
    screen.getByText(/Dieser ältere Entwurf enthält keine gespeicherten Texte/),
  ).toBeTruthy();
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'PUT')).toBe(true),
  );
  expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
    version: 1,
    ...content,
    totalDiscountKind: null,
    totalDiscountValue: null,
    totalDiscountNote: null,
    lines: [
      {
        productId: null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceMinor: line.unitPriceMinor,
        taxBasisPoints: line.taxBasisPoints,
        discountBasisPoints: line.discountBasisPoints,
        discountAmountMinor: null,
        priceBasis: 'gross',
      },
    ],
  });
});

test('malformed detail data is rejected without rendering a blank editor', async () => {
  setup({
    detailGet: () => Response.json({ ...detail(), subject: undefined }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  expect(
    await screen.findByText(/Entwurf konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Entwurf erneut laden' }),
  ).toBeTruthy();
});

test('an invalid successful PUT response is treated as uncertain and keeps the input', async () => {
  const { calls } = setup({ put: () => Response.json(detail(null)) });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  fireEvent.change(await screen.findByLabelText('Betreff'), {
    target: { value: 'Fiktive Eingabe bleibt sichtbar' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText(/Speicherstatus ist unklar/)).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Fiktive Eingabe bleibt sichtbar');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test('an unchanged legacy snapshot needs an explicit save and cannot be finalized while open', async () => {
  setup({ initial: detail(null) });
  render(<EventDocuments {...props} />);
  const edit = await screen.findByRole('button', {
    name: 'Angebot Entwurf bearbeiten',
  });
  fireEvent.click(edit);
  await screen.findByLabelText('Betreff');
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', false);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toHaveProperty('disabled', true),
  );

  expect(
    screen.queryByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  ).toBeNull();
});

test('legacy text stays unavailable when its archived template is missing', async () => {
  setup({ initial: detail(null), template: null });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  expect(
    await screen.findByText(/Entwurf konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
});

test('field limits and validity range are explicit and invalid days block saving', async () => {
  setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const subject = await screen.findByLabelText('Betreff'),
    intro = screen.getByLabelText('Einleitung'),
    outro = screen.getByLabelText('Schlusstext'),
    validity = screen.getByLabelText('Gültigkeit in Tagen');
  expect(subject).toHaveProperty('maxLength', 200);
  expect(intro).toHaveProperty('maxLength', 4000);
  expect(outro).toHaveProperty('maxLength', 4000);
  expect(validity).toHaveProperty('min', '1');
  expect(validity).toHaveProperty('max', '365');
  fireEvent.change(validity, { target: { value: '366' } });
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', true);
});

test('blank and invalid position values block saving without sending a request', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const position = await screen.findByRole('group', { name: 'Position 1' });
  const edits = [
    ['Beschreibung', ''],
    ['Beschreibung', 'Fiktives Fotobox-Paket'],
    ['Menge', '-1'],
    ['Menge', '1'],
    ['Einzelpreis (Brutto) in Euro', '-0,01'],
    ['Einzelpreis (Brutto) in Euro', '249,00'],
    ['Steuer in Prozent', '100,01'],
    ['Steuer in Prozent', '19'],
    ['Rabatt in Prozent', 'abc'],
    ['Rabatt in Prozent', '0'],
    ['Einheit', ''],
    ['Einheit', 'Pauschale'],
  ] as const;
  for (const [label, value] of edits) {
    fireEvent.change(within(position).getByLabelText(label), {
      target: { value },
    });
    if (
      !value ||
      value.startsWith('-') ||
      value === '100,01' ||
      value === 'abc'
    ) {
      expect(
        screen.getByRole('button', { name: 'Änderungen speichern' }),
      ).toHaveProperty('disabled', true);
      fireEvent.click(
        screen.getByRole('button', { name: 'Änderungen speichern' }),
      );
    }
  }
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});

test('large stored totals and prices retain every cent in the editor and document row', async () => {
  const large = Number.MAX_SAFE_INTEGER;
  setup({
    initial: {
      ...detail(),
      grossMinor: large,
      lines: [{ ...line, unitPriceMinor: large }],
    },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const total = await screen.findByText(/Gesamtbetrag/);
  expect(total.textContent).toContain('90.071.992.547.409,91 €');
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(document.querySelector('.document-meta')?.textContent).toContain(
    '90.071.992.547.409,91 €',
  );
});

test('dirty editor keeps route protection and Escape cancellation until discard is confirmed', async () => {
  setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.change(subject, {
    target: { value: 'Fiktiver ungespeicherter Text' },
  });
  expect(hasUnsavedChanges()).toBe(true);

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.keyDown(subject, { key: 'Escape' });
  expect(screen.getByLabelText('Betreff')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(screen.getByLabelText('Betreff')).toBeTruthy();

  confirm.mockReturnValue(true);
  fireEvent.keyDown(screen.getByLabelText('Betreff'), { key: 'Escape' });
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
});

test('a dirty offer editor blocks finalization and hides the other draft actions', async () => {
  setup({ documents: [draft, { ...draft, id: 'doc-2' }] });
  render(<EventDocuments {...props} />);
  const editButtons = await screen.findAllByRole('button', {
    name: 'Angebot Entwurf bearbeiten',
  });
  fireEvent.click(editButtons[0]!);
  fireEvent.change(await screen.findByLabelText('Betreff'), {
    target: { value: 'Fiktiv, noch nicht gespeichert' },
  });
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toHaveProperty('disabled', true);
  expect(screen.queryByRole('region', { name: 'Angebote' })).toBeNull();
});

test('a conflict preserves the input and a failed explicit reload never replaces it', async () => {
  let failGet = false;
  const { calls } = setup({
    put: () => Response.json({ error: 'conflict' }, { status: 409 }),
    detailGet: () =>
      failGet ? new Response(null, { status: 503 }) : Response.json(detail()),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.change(subject, {
    target: { value: 'Eigener Text bleibt erhalten' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText(/zwischenzeitlich geändert/)).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Eigener Text bleibt erhalten');

  failGet = true;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf neu laden' }));
  expect(
    await screen.findByText(/Entwurf konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Eigener Text bleibt erhalten');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toHaveProperty('disabled', true),
  );
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
});

test('an uncertain save result offers reload and prevents blind resubmission', async () => {
  let loseReply = true;
  const { calls } = setup({
    put: async () => {
      if (loseReply) {
        loseReply = false;
        throw new Error('connection lost');
      }
      return Response.json(detail());
    },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  fireEvent.change(await screen.findByLabelText('Betreff'), {
    target: { value: 'Fiktiv, Antwort verloren' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText(/Speicherstatus ist unklar/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', true);
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toHaveProperty('disabled', true),
  );
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf neu laden' }));
  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktives Angebot');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test('catalog information belongs to the position through saving, reloading and removal', async () => {
  const { calls } = setup({
    products: [
      {
        ...catalogProducts[0]!,
        description: 'Fiktiver Text\nmit zweiter Zeile',
      },
    ],
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  const picker = await screen.findByLabelText('Produkt aus Katalog');
  fireEvent.change(picker, { target: { value: 'product-net' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Als Position hinzufügen' }),
  );
  const position = await screen.findByRole('group', { name: 'Position 2' });
  const info = within(position).getByLabelText('Infotext (optional)');
  expect(info).toHaveProperty('value', 'Fiktiver Text\nmit zweiter Zeile');
  expect(screen.queryByRole('group', { name: 'Infotext' })).toBeNull();
  fireEvent.change(info, {
    target: { value: 'Bearbeiteter Text\nZweite Zeile' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const body = calls.find((call) => call.method === 'PUT')?.body as {
    lines: Array<Record<string, unknown>>;
  };
  expect(body.lines).toHaveLength(2);
  expect(body.lines[0]).not.toHaveProperty('infoText');
  expect(body.lines[1]).toMatchObject({
    productId: 'product-net',
    infoText: 'Bearbeiteter Text\nZweite Zeile',
  });

  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const reloadedPosition = await screen.findByRole('group', {
    name: 'Position 2',
  });
  expect(
    within(reloadedPosition).getByLabelText('Infotext (optional)'),
  ).toHaveProperty('value', 'Bearbeiteter Text\nZweite Zeile');
  fireEvent.change(
    within(reloadedPosition).getByLabelText('Infotext (optional)'),
    {
      target: { value: '' },
    },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const cleared = calls.filter((call) => call.method === 'PUT').at(-1)
    ?.body as typeof body;
  expect(cleared.lines[1]).not.toHaveProperty('infoText');

  fireEvent.change(
    within(reloadedPosition).getByLabelText('Infotext (optional)'),
    {
      target: { value: 'Fiktiver Text zum Entfernen' },
    },
  );
  fireEvent.click(
    within(reloadedPosition).getByRole('button', {
      name: 'Position 2 entfernen',
    }),
  );
  expect(screen.queryByRole('group', { name: 'Position 2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const removed = calls.filter((call) => call.method === 'PUT').at(-1)
    ?.body as typeof body;
  expect(removed.lines).toHaveLength(1);
  expect(removed.lines[0]).not.toHaveProperty('infoText');
});

test('invalid catalog information does not add a partial product', async () => {
  setup({
    products: [{ ...catalogProducts[0]!, description: 'x'.repeat(4001) }],
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.click(screen.getByRole('button', { name: 'Produkt hinzufügen' }));
  const picker = await screen.findByLabelText('Produkt aus Katalog');
  fireEvent.change(picker, { target: { value: 'product-net' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Als Position hinzufügen' }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Der Infotext des Produkts ist zu lang',
  );
  expect(screen.getAllByRole('group', { name: /^Position / })).toHaveLength(1);
});

// EDITOR-LAYOUT-01: the form is read as named groups instead of one dense
// grid, so every label keeps its room and a narrow editor can stack the fields.
test('the editor names its field groups with legends and keeps the sum apart', async () => {
  setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const head = screen.getByRole('group', { name: 'Kopfdaten und Einleitung' });
  for (const label of ['Betreff', 'Einleitung', 'Gültigkeit in Tagen'])
    expect(within(head).getByLabelText(label)).toBeTruthy();
  const positions = screen.getByRole('region', { name: 'Positionen' });
  expect(
    within(positions).getByRole('group', { name: 'Position 1' }),
  ).toBeTruthy();
  // The document discount and the stored sum are their own groups, not part of
  // the position list.
  expect(
    within(positions).queryByRole('group', { name: 'Gesamtrabatt' }),
  ).toBeNull();
  const totalDiscount = screen.getByRole('group', { name: 'Gesamtrabatt' });
  expect(
    within(totalDiscount).getByLabelText('Art des Gesamtrabatts'),
  ).toBeTruthy();
  const summary = screen.getByRole('group', { name: 'Summen und Hinweise' });
  expect(
    within(summary).getByText(/Gespeicherter Gesamtbetrag: 249,00/),
  ).toBeTruthy();
  // The closing text stays a labelled field of its own.
  expect(screen.getByLabelText('Schlusstext')).toHaveProperty(
    'value',
    'Viele Grüße',
  );
});

// DOC-PRODUCT-01.4 / EDITOR-LAYOUT-01: one discount per position. The mode
// decides which of the two stored values reaches the core; the mode select
// sits beside the one number field instead of a second, disabled field.
test('a position keeps one discount field whose mode never converts either value', async () => {
  const { calls } = setup({
    initial: {
      ...detail(),
      lines: [{ ...line, discountBasisPoints: 1000 }],
    },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const position = await screen.findByRole('group', { name: 'Position 1' });
  const mode = within(position).getByLabelText('Rabattart');
  const percent = within(position).getByLabelText('Rabatt in Prozent');
  expect(mode).toHaveProperty('value', 'percent');
  expect(percent).toHaveProperty('value', '10.00');
  // Exactly one number field: no second, permanently disabled euro field.
  expect(within(position).getAllByLabelText(/^Rabatt in /)).toHaveLength(1);
  expect(within(position).queryByLabelText('Rabatt in Euro')).toBeNull();

  fireEvent.change(percent, { target: { value: '12,50' } });
  fireEvent.change(mode, { target: { value: 'amount' } });
  // The surviving field renames itself to the unit it now holds.
  expect(within(position).queryByLabelText('Rabatt in Prozent')).toBeNull();
  expect(within(position).getAllByLabelText(/^Rabatt in /)).toHaveLength(1);
  const amount = within(position).getByLabelText('Rabatt in Euro');
  // Neither side is derived from the other: no conversion, no reset.
  expect(amount).toHaveProperty('value', '0.00');

  fireEvent.change(amount, { target: { value: '7,25' } });
  fireEvent.change(mode, { target: { value: 'percent' } });
  // The percentage typed before the euro phase was kept, not dropped.
  expect(within(position).getByLabelText('Rabatt in Prozent')).toHaveProperty(
    'value',
    '12,50',
  );
  fireEvent.change(mode, { target: { value: 'amount' } });
  expect(within(position).getByLabelText('Rabatt in Euro')).toHaveProperty(
    'value',
    '7,25',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    lines: [{ discountBasisPoints: 1250, discountAmountMinor: 725 }],
  });
});

test('a stored fixed discount loads in euro mode while a percentage position sends a null amount', async () => {
  const amountLine = {
    ...line,
    discountBasisPoints: 1000,
    discountAmountMinor: 2500,
  };
  const percentLine = {
    ...line,
    id: 'line-2',
    position: 1,
    description: 'Fiktive Prozentposition',
    discountBasisPoints: 500,
  };
  const { calls } = setup({
    initial: { ...detail(), lines: [amountLine, percentLine] },
  });
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const fixed = screen.getByRole('group', { name: 'Position 1' });
  const percentage = screen.getByRole('group', { name: 'Position 2' });
  expect(within(fixed).getByLabelText('Rabattart')).toHaveProperty(
    'value',
    'amount',
  );
  expect(within(fixed).getByLabelText('Rabatt in Euro')).toHaveProperty(
    'value',
    '25.00',
  );
  // The stored percentage survives beside the amount it no longer drives and
  // appears again as soon as its own mode is chosen.
  expect(within(fixed).queryByLabelText('Rabatt in Prozent')).toBeNull();
  fireEvent.change(within(fixed).getByLabelText('Rabattart'), {
    target: { value: 'percent' },
  });
  expect(within(fixed).getByLabelText('Rabatt in Prozent')).toHaveProperty(
    'value',
    '10.00',
  );
  fireEvent.change(within(fixed).getByLabelText('Rabattart'), {
    target: { value: 'amount' },
  });
  expect(within(fixed).getByLabelText('Rabatt in Euro')).toHaveProperty(
    'value',
    '25.00',
  );
  expect(within(percentage).getByLabelText('Rabattart')).toHaveProperty(
    'value',
    'percent',
  );
  expect(within(percentage).queryByLabelText('Rabatt in Euro')).toBeNull();

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot mit Festbetrag' },
  });
  fireEvent.change(within(percentage).getByLabelText('Rabatt in Prozent'), {
    target: { value: '0' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  const saved = calls.find((call) => call.method === 'PUT')?.body as {
    lines: Array<Record<string, unknown>>;
  };
  expect(saved.lines[0]).toMatchObject({
    discountBasisPoints: 1000,
    discountAmountMinor: 2500,
  });
  // A percentage mode always names null, so a zero rate never prints "Rabatt
  // 0,00 €".
  expect(saved.lines[1]).toMatchObject({
    discountBasisPoints: 0,
    discountAmountMinor: null,
  });
  expect(Object.keys(saved.lines[1]!)).toContain('discountAmountMinor');

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const reloaded = await screen.findByRole('group', { name: 'Position 1' });
  expect(within(reloaded).getByLabelText('Rabattart')).toHaveProperty(
    'value',
    'amount',
  );
  expect(within(reloaded).getByLabelText('Rabatt in Euro')).toHaveProperty(
    'value',
    '25.00',
  );
  expect(
    within(
      await screen.findByRole('group', { name: 'Position 2' }),
    ).getByLabelText('Rabattart'),
  ).toHaveProperty('value', 'percent');
});

test('a fixed discount above the line sum stays a visible server refusal', async () => {
  const { calls } = setup({
    put: () => Response.json({ error: 'invalid_line' }, { status: 400 }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const position = await screen.findByRole('group', { name: 'Position 1' });
  fireEvent.change(within(position).getByLabelText('Rabattart'), {
    target: { value: 'amount' },
  });
  fireEvent.change(within(position).getByLabelText('Rabatt in Euro'), {
    target: { value: '249,01' },
  });
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot mit zu hohem Rabatt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Rabattbetrag',
  );
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  expect(within(position).getByLabelText('Rabatt in Euro')).toHaveProperty(
    'value',
    '249,01',
  );
});

// DOC-PRODUCT-01.5: one discount for the whole document. The group names the
// deliberate "no discount" state, keeps the two values apart and never computes
// a second total in the browser.
test('a draft without a total discount offers the deliberate "Kein" state and sends nulls', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const group = screen.getByRole('group', { name: 'Gesamtrabatt' });
  const kind = within(group).getByLabelText('Art des Gesamtrabatts');
  expect(kind).toHaveProperty('value', '');
  expect(
    within(kind).getByRole('option', { name: 'Kein Gesamtrabatt' }),
  ).toBeTruthy();
  expect(within(group).queryByLabelText('Gesamtrabatt in Prozent')).toBeNull();
  expect(within(group).queryByLabelText('Gesamtrabatt in Euro')).toBeNull();
  expect(
    within(group).getByText(
      'Der Gesamtrabatt mindert den Zahlbetrag; Positionssummen und Steuer bleiben unverändert.',
    ),
  ).toBeTruthy();
  expect(screen.getByText(/Gespeicherter Gesamtbetrag: 249,00/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot ohne Gesamtrabatt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    totalDiscountKind: null,
    totalDiscountValue: null,
    totalDiscountNote: null,
  });
});

test('a percent total discount sends basis points and its note, euro sends the exact minor amount', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const group = screen.getByRole('group', { name: 'Gesamtrabatt' });
  fireEvent.change(within(group).getByLabelText('Art des Gesamtrabatts'), {
    target: { value: 'percent' },
  });
  const percent = within(group).getByLabelText('Gesamtrabatt in Prozent');
  // The percentage field carries basis points as percent, like a position.
  expect(percent).toHaveProperty('value', '0.00');
  expect(within(group).queryByLabelText('Gesamtrabatt in Euro')).toBeNull();
  fireEvent.change(percent, { target: { value: '12,50' } });
  fireEvent.change(
    within(group).getByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
    { target: { value: 'Fiktive Aktion\nzweite Zeile' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    totalDiscountKind: 'percent',
    totalDiscountValue: 1250,
    totalDiscountNote: 'Fiktive Aktion\nzweite Zeile',
  });

  fireEvent.change(within(group).getByLabelText('Art des Gesamtrabatts'), {
    target: { value: 'amount' },
  });
  expect(within(group).queryByLabelText('Gesamtrabatt in Prozent')).toBeNull();
  const amount = within(group).getByLabelText('Gesamtrabatt in Euro');
  // Euro mode never reinterprets the percentage as an amount.
  expect(amount).toHaveProperty('value', '0.00');
  fireEvent.change(amount, { target: { value: '25' } });
  // A blank note clears it instead of sending an empty string.
  fireEvent.change(
    within(group).getByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
    { target: { value: '   ' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2),
  );
  expect(calls.filter((call) => call.method === 'PUT')[1]?.body).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 2500,
    totalDiscountNote: null,
  });
});

// EDITOR-LAYOUT-01: the kind and its one number field form a single block; a
// kind switch keeps both typed values instead of resetting the other one.
test('the total discount keeps its percentage and its amount across kind switches', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const group = screen.getByRole('group', { name: 'Gesamtrabatt' });
  const kind = within(group).getByLabelText('Art des Gesamtrabatts');
  fireEvent.change(kind, { target: { value: 'percent' } });
  fireEvent.change(within(group).getByLabelText('Gesamtrabatt in Prozent'), {
    target: { value: '12,50' },
  });
  fireEvent.change(kind, { target: { value: 'amount' } });
  fireEvent.change(within(group).getByLabelText('Gesamtrabatt in Euro'), {
    target: { value: '25' },
  });
  // One number field at a time, named by the kind beside it.
  expect(within(group).queryByLabelText('Gesamtrabatt in Prozent')).toBeNull();
  fireEvent.change(kind, { target: { value: 'percent' } });
  expect(
    within(group).getByLabelText('Gesamtrabatt in Prozent'),
  ).toHaveProperty('value', '12,50');
  expect(within(group).queryByLabelText('Gesamtrabatt in Euro')).toBeNull();
  fireEvent.change(kind, { target: { value: 'amount' } });
  expect(within(group).getByLabelText('Gesamtrabatt in Euro')).toHaveProperty(
    'value',
    '25',
  );

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot mit Gesamtrabattart' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 2500,
  });
});

test('a stored total discount loads into the controls and "Kein Gesamtrabatt" clears all three', async () => {
  const initial = detail(content, 1, {
    totalDiscountKind: 'amount',
    totalDiscountValue: 2500,
    totalDiscountNote: 'Fiktiver Hinweis',
  });
  const { calls } = setup({ initial });
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const group = screen.getByRole('group', { name: 'Gesamtrabatt' });
  expect(within(group).getByLabelText('Art des Gesamtrabatts')).toHaveProperty(
    'value',
    'amount',
  );
  expect(within(group).getByLabelText('Gesamtrabatt in Euro')).toHaveProperty(
    'value',
    '25.00',
  );
  expect(
    within(group).getByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
  ).toHaveProperty('value', 'Fiktiver Hinweis');
  // The discount lowers only the payable amount; the stored position sums stay.
  expect(screen.getByText(/Gespeicherter Gesamtbetrag: 249,00/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot mit Gesamtrabatt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Änderungen gespeichert.');
  expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
    totalDiscountKind: 'amount',
    totalDiscountValue: 2500,
    totalDiscountNote: 'Fiktiver Hinweis',
  });

  fireEvent.change(within(group).getByLabelText('Art des Gesamtrabatts'), {
    target: { value: '' },
  });
  expect(within(group).queryByLabelText('Gesamtrabatt in Euro')).toBeNull();
  expect(
    within(group).queryByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2),
  );
  expect(calls.filter((call) => call.method === 'PUT')[1]?.body).toMatchObject({
    totalDiscountKind: null,
    totalDiscountValue: null,
    totalDiscountNote: null,
  });

  // Switching back never revives what "Kein Gesamtrabatt" dropped.
  fireEvent.change(within(group).getByLabelText('Art des Gesamtrabatts'), {
    target: { value: 'percent' },
  });
  expect(
    within(group).getByLabelText('Gesamtrabatt in Prozent'),
  ).toHaveProperty('value', '0.00');
  expect(
    within(group).getByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
  ).toHaveProperty('value', '');

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  expect(
    within(screen.getByRole('group', { name: 'Gesamtrabatt' })).getByLabelText(
      'Art des Gesamtrabatts',
    ),
  ).toHaveProperty('value', '');
});

test('a rejected total discount stays a visible hint error without losing the input', async () => {
  const { calls } = setup({
    put: () => Response.json({ error: 'invalid_content' }, { status: 400 }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const group = screen.getByRole('group', { name: 'Gesamtrabatt' });
  fireEvent.change(within(group).getByLabelText('Art des Gesamtrabatts'), {
    target: { value: 'amount' },
  });
  fireEvent.change(within(group).getByLabelText('Gesamtrabatt in Euro'), {
    target: { value: '249,01' },
  });
  fireEvent.change(
    within(group).getByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
    { target: { value: 'Fiktiver zu hoher Abzug' } },
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot mit zu hohem Gesamtrabatt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Gesamtrabatt',
  );
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  expect(within(group).getByLabelText('Gesamtrabatt in Euro')).toHaveProperty(
    'value',
    '249,01',
  );
  expect(
    within(group).getByLabelText('Anmerkung zum Gesamtrabatt (optional)'),
  ).toHaveProperty('value', 'Fiktiver zu hoher Abzug');
  expect(
    within(group)
      .getByLabelText('Gesamtrabatt in Euro')
      .getAttribute('aria-invalid'),
  ).toBe('true');
});

test('a total discount percentage above 100 % blocks the save before any request', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const group = screen.getByRole('group', { name: 'Gesamtrabatt' });
  fireEvent.change(within(group).getByLabelText('Art des Gesamtrabatts'), {
    target: { value: 'percent' },
  });
  const percent = within(group).getByLabelText('Gesamtrabatt in Prozent');
  fireEvent.change(percent, { target: { value: '100,01' } });
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot mit zu hohem Prozentsatz' },
  });
  expect(percent.getAttribute('aria-invalid')).toBe('true');
  const save = screen.getByRole('button', { name: 'Änderungen speichern' });
  expect(save).toHaveProperty('disabled', true);
  fireEvent.click(save);
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);

  fireEvent.change(percent, { target: { value: '100' } });
  expect(save).toHaveProperty('disabled', false);
});
