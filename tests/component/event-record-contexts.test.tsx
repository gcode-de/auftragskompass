import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { EventDetails } from '../../apps/admin/src/EventDetails.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';

// BKP013.1: the event file is one record with a stable head and focused work
// areas. These tests prove the user-facing criteria; the storage contract
// stays with the resource, status and document tests.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const statuses = [
  { code: 'inquiry', label: 'Anfrage' },
  { code: 'option', label: 'Option' },
  { code: 'booked', label: 'Gebucht' },
];
const event = {
  id: 'synthetic-record',
  version: 3,
  name: 'Fictional record event',
  status: 'option',
  eventDate: '2026-10-16',
  startsAt: '2026-10-16T16:00:00Z',
  endsAt: '2026-10-16T18:00:00Z',
  timeZone: 'Europe/Berlin',
  source: 'Fictional source',
  description: 'Synthetic description',
  notesHtml: '<strong>Fictional record note</strong>',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue: null as string | null,
  venueOverride: false,
  primaryContactId: 'synthetic-contact',
  additionalContactIds: [],
};
const detail = {
  event,
  contacts: [
    {
      id: 'synthetic-contact',
      name: 'Fictional contact',
      contactPerson: 'Fictional representative',
      email: 'record@example.invalid',
      phone: '030 000000',
      mobile: '',
      role: 'primary',
    },
  ],
  location: null,
  eventType: { id: 'synthetic-type', name: 'Fictional type' },
  package: null,
  activities: [
    {
      id: '1',
      kind: 'created',
      eventVersion: 1,
      occurredAt: '2026-10-15T12:00:00Z',
      description: 'Event angelegt.',
    },
  ],
};
const unit = {
  unitId: 'synthetic-unit',
  resourceId: 'synthetic-resource',
  name: 'Fictional box',
  code: 'SYNTH',
  category: 'Fotobox',
  ordinal: 1,
  selected: false,
  periodSource: 'event',
  baseStart: event.startsAt,
  baseEnd: event.endsAt,
  beforeDays: 0,
  afterDays: 0,
  startsAt: null,
  endsAt: null,
  available: true,
  reason: null,
  conflicts: [],
};
const offer = {
  id: 'document-offer',
  kind: 'offer',
  templateId: 'template-offer',
  eventId: event.id,
  contactId: 'synthetic-contact',
  number: 'AN-2030-0007',
  state: 'final',
  issuedAt: '2030-10-20T10:00:00Z',
  finalizedAt: '2030-10-20T10:05:00Z',
  netMinor: 20925,
  taxMinor: 3975,
  grossMinor: 24900,
  version: 2,
};
const invoice = {
  ...offer,
  id: 'document-invoice',
  kind: 'invoice',
  number: 'RE-2030-0002',
};
const templates = [
  {
    id: 'template-offer',
    kind: 'offer',
    name: 'Fictional offer',
    state: 'active',
  },
];

function mockRecord(
  options: {
    detail?: unknown;
    documents?: unknown[];
    onLoad?: (url: string, init?: RequestInit) => Response | null;
  } = {},
) {
  const calls: { url: string; method: string }[] = [];
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const override = options.onLoad?.(url, init);
      if (override) return override;
      if (url === '/api/v1/document-templates') return Response.json(templates);
      if (url.startsWith('/api/v1/documents?eventId='))
        return Response.json(options.documents ?? [offer, invoice]);
      if (url === '/api/v1/documents' && init?.method === 'POST')
        return Response.json(
          {
            ...offer,
            id: 'document-created',
            number: null,
            state: 'draft',
            finalizedAt: null,
            version: 1,
          },
          { status: 201 },
        );
      if (url.endsWith('/availability')) return Response.json([unit]);
      if (url === '/api/v1/events/' + event.id) {
        if (init) return Response.json({ ...event, version: 4 });
        return Response.json(options.detail ?? detail);
      }
      return Response.json([]);
    },
  );
  vi.stubGlobal('fetch', fetcher);
  const loads = () =>
    calls.filter(
      (call) =>
        call.url === '/api/v1/events/' + event.id && call.method === 'GET',
    ).length;
  return { calls, fetcher, loads };
}

async function open() {
  const props = {
    statuses,
    id: event.id,
    csrfToken: 'csrf',
    onChanged: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<EventDetails {...props} />);
  await screen.findByRole('heading', {
    name: 'Event: Fictional record event',
    level: 2,
  });
  const panel = screen.getByRole('region', { name: 'Event-Details' });
  const area = (name: string) => within(panel).getByRole('region', { name });
  const tab = (name: string) => within(panel).getByRole('button', { name });
  return { ...view, props, panel, area, tab };
}

test('the record head keeps date, title and status in every work area', async () => {
  mockRecord();
  const { panel, tab } = await open();
  const head = panel.querySelector('.event-record-head') as HTMLElement;
  expect(head).toBeTruthy();
  const headChecks = () => {
    expect(within(head).getByText('16. Oktober 2026')).toBeTruthy();
    expect(within(head).getByText(/18:00–20:00 Uhr/)).toBeTruthy();
    expect(
      within(head).getByRole('heading', {
        name: 'Event: Fictional record event',
      }),
    ).toBeTruthy();
    expect(within(head).getByText('Option')).toBeTruthy();
  };
  headChecks();
  for (const name of ['Dateien', 'Ressourcen', 'E-Mails', 'Details']) {
    fireEvent.click(tab(name));
    headChecks();
  }
});

test('documents live in the files area instead of the details overview', async () => {
  mockRecord();
  const { area, tab } = await open();
  const details = area('Details');
  // The negative half is the finding this slice fixes: no offer list, no offer
  // form and no document numbers inside the main information area.
  expect(
    within(details).queryByRole('region', { name: 'Angebote' }),
  ).toBeNull();
  expect(
    within(details).queryByRole('button', { name: 'Entwurf anlegen' }),
  ).toBeNull();
  expect(within(details).queryByText('AN-2030-0007')).toBeNull();
  // The positive half: the same documents are reachable in Dateien.
  fireEvent.click(tab('Dateien'));
  const files = area('Dateien');
  const offers = await within(files).findByRole('region', { name: 'Angebote' });
  expect(await within(offers).findByText('AN-2030-0007')).toBeTruthy();
  const library = within(files).getByRole('region', {
    name: 'Eventdateien aus der Bibliothek',
  });
  expect(
    offers.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(
    within(offers).getByRole('button', { name: 'Dokument anlegen' }),
  );
  const dialog = await within(offers).findByRole('dialog', {
    name: 'Angebot anlegen',
  });
  expect(
    within(dialog).getByText('Eventkontakt: Fictional contact'),
  ).toBeTruthy();
  expect(
    await within(offers).findByRole('button', { name: 'Entwurf anlegen' }),
  ).toBeTruthy();
});

test('the files area labels every document by its actual kind', async () => {
  mockRecord();
  const { area, tab } = await open();
  fireEvent.click(tab('Dateien'));
  const files = area('Dateien');
  const offers = await within(files).findByRole('region', { name: 'Angebote' });
  const invoices = within(files).getByRole('region', { name: 'Rechnungen' });
  expect(within(offers).getByText('AN-2030-0007')).toBeTruthy();
  expect(within(invoices).getByText('RE-2030-0002')).toBeTruthy();
  // A kind label is not decoration: every row stays in its own card.
  expect(within(offers).queryByText('RE-2030-0002')).toBeNull();
  expect(within(invoices).queryByText('AN-2030-0007')).toBeNull();
});

// UI-PARITY-02: Bookitup's event record areas, including E-Mails with
// the event's outgoing mail and the new-mail action.
test('the record offers the Bookitup areas including E-Mails', async () => {
  mockRecord();
  const { panel, area, tab } = await open();
  const navigation = within(panel).getByRole('navigation', {
    name: 'Bereiche des Events',
  });
  expect(
    within(navigation)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Details', 'Ressourcen', 'Dateien', 'E-Mails']);
  fireEvent.click(tab('E-Mails'));
  const mails = area('E-Mails');
  expect(
    within(mails).getByRole('button', { name: 'Neue Mail schreiben' }),
  ).toBeTruthy();
  expect(
    within(mails).getByRole('region', { name: 'Ausgehende Mails' }),
  ).toBeTruthy();
  // The new mail opens the compose dialog although the files area is hidden.
  fireEvent.click(
    within(mails).getByRole('button', { name: 'Neue Mail schreiben' }),
  );
  expect(
    await screen.findByRole('dialog', { name: 'Neue Mail schreiben' }),
  ).toBeTruthy();
});

test('a dirty status or resource draft survives every work area switch', async () => {
  mockRecord();
  const { area, tab } = await open();
  const status = screen.getByLabelText(
    'Status des Events',
  ) as HTMLSelectElement;
  fireEvent.change(status, { target: { value: 'inquiry' } });
  fireEvent.click(tab('Ressourcen'));
  const start = (await screen.findByLabelText('Eventbeginn', {
    exact: true,
  })) as HTMLInputElement;
  fireEvent.change(start, { target: { value: '2026-10-18T18:00' } });
  for (const name of ['Dateien', 'E-Mails', 'Details', 'Dateien'])
    fireEvent.click(tab(name));
  fireEvent.click(tab('Ressourcen'));
  expect(start.value).toBe('2026-10-18T18:00');
  fireEvent.click(tab('Details'));
  expect(status.value).toBe('inquiry');
  // The notes stand under the details, like in Bookitup.
  expect(area('Notizen')).toBeTruthy();
});

test('a background refresh never replaces a draft that waits in another area', async () => {
  const { loads } = mockRecord();
  const { panel, tab } = await open();
  fireEvent.click(tab('Dateien'));
  const status = screen.getByLabelText(
    'Status des Events',
  ) as HTMLSelectElement;
  fireEvent.change(status, { target: { value: 'inquiry' } });
  const before = loads();
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
  await screen.findByText(/Aktualisierung steht aus/);
  expect(loads()).toBe(before);
  expect(status.value).toBe('inquiry');
  // A background refresh must also not decide the area for the user.
  expect(
    within(panel)
      .getByRole('button', { name: 'Dateien' })
      .getAttribute('aria-current'),
  ).toBe('location');
});

test('a confirmed document success stays visible when the list reload fails', async () => {
  let failDocuments = false;
  mockRecord({
    onLoad: (url) =>
      failDocuments && url.startsWith('/api/v1/documents?eventId=')
        ? new Response(null, { status: 503 })
        : null,
  });
  const { tab, area } = await open();
  fireEvent.click(tab('Dateien'));
  const files = area('Dateien');
  const offers = await within(files).findByRole('region', { name: 'Angebote' });
  fireEvent.click(
    within(offers).getByRole('button', { name: 'Dokument anlegen' }),
  );
  const create = await within(offers).findByRole('button', {
    name: 'Entwurf anlegen',
  });
  failDocuments = true;
  fireEvent.submit(create.closest('form')!);
  expect(await screen.findByText('Entwurf angelegt.')).toBeTruthy();
  expect(
    await within(files).findByText(
      /Dateiliste konnte nicht neu geladen werden/,
    ),
  ).toBeTruthy();
  // The confirmed success and the previously loaded row stay readable; the
  // failing reload is an explicit warning, not a silent empty list.
  expect(within(offers).getByText('AN-2030-0007')).toBeTruthy();
});

test('the chosen work area receives the keyboard focus', async () => {
  mockRecord();
  const { area, tab } = await open();
  fireEvent.click(tab('Dateien'));
  expect(document.activeElement).toBe(area('Dateien'));
  fireEvent.click(tab('E-Mails'));
  expect(document.activeElement).toBe(area('E-Mails'));
});

test('an incomplete website event is a normal open state, not an error area', async () => {
  mockRecord({
    detail: {
      ...detail,
      event: {
        ...event,
        source: 'Website: fictional-form (v1)',
        primaryContactId: null,
      },
      contacts: [],
      location: null,
    },
  });
  const { area, panel } = await open();
  const details = area('Details');
  expect(within(details).getByText('Kontakt noch offen.')).toBeTruthy();
  expect(within(details).getByText('Ort offen.')).toBeTruthy();
  const head = panel.querySelector('.event-record-head') as HTMLElement;
  expect(within(head).getByText('Ort offen')).toBeTruthy();
  expect(within(head).getByText('Website')).toBeTruthy();
  expect(panel.querySelector('[role="alert"]')).toBeNull();
});

test('the narrow frame offers contact and place as one deliberate disclosure', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mockRecord();
  const { area } = await open();
  const aside = area('Details').querySelector(
    'details.event-aside',
  ) as HTMLDetailsElement;
  expect(aside).toBeTruthy();
  expect(aside.open).toBe(false);
  expect(
    within(aside).getByText('Kontakt und Ort', { selector: 'summary' }),
  ).toBeTruthy();
  aside.open = true;
  fireEvent(aside, new Event('toggle'));
  expect(within(aside).getByRole('heading', { name: 'Kontakt' })).toBeTruthy();
  expect(
    within(aside).getByRole('heading', { name: 'Ort / Adresse' }),
  ).toBeTruthy();
});

test('creates a reusable location in the record and assigns it using the current event version', async () => {
  const location = {
    id: 'synthetic-location-new',
    name: 'Fiktiver Festsaal',
    street: 'Musterweg 1',
    postalCode: '12345',
    city: 'Beispielstadt',
    country: 'DE',
    state: 'active',
    version: 1,
  };
  const { fetcher } = mockRecord({
    onLoad: (url, init) => {
      if (url === '/api/v1/locations')
        return Response.json(location, { status: 201 });
      if (init?.method === 'PUT' && url === '/api/v1/events/' + event.id)
        return Response.json({
          ...event,
          locationId: location.id,
          version: event.version + 1,
        });
      return null;
    },
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Location anlegen' }));
  const dialog = screen.getByRole('dialog', { name: 'Location anlegen' });
  for (const [label, value] of [
    ['Name', location.name],
    ['Straße und Hausnummer', location.street],
    ['PLZ', location.postalCode],
    ['Ort', location.city],
  ]) {
    fireEvent.change(within(dialog).getByLabelText(label!), {
      target: { value },
    });
  }
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Anlegen und zuordnen' }),
  );
  const card = screen.getByRole('region', { name: 'Ort / Adresse' });
  expect(await within(card).findByText(location.name)).toBeTruthy();
  expect(within(card).getByText(/Musterweg 1/)).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Location anlegen' })).toBeNull();
  expect(
    (screen.getByLabelText('Gespeicherter Ort') as HTMLSelectElement).value,
  ).toBe(location.id);
  const requests = fetcher.mock.calls.filter(([, init]) => init?.method);
  expect(requests.map(([url, init]) => [url, init?.method])).toEqual([
    ['/api/v1/locations', 'POST'],
    ['/api/v1/events/' + event.id, 'PUT'],
  ]);
  expect(requests[0]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf' });
  expect(JSON.parse(requests[0]?.[1]?.body as string)).toEqual({
    name: location.name,
    street: location.street,
    postalCode: location.postalCode,
    city: location.city,
    country: 'DE',
    state: 'active',
  });
  expect(JSON.parse(requests[1]?.[1]?.body as string)).toMatchObject({
    version: event.version,
    locationId: location.id,
    venueOverride: false,
  });
});

test('keeps the location draft on a rejected write and asks before discarding it', async () => {
  const { fetcher } = mockRecord({
    onLoad: (url) =>
      url === '/api/v1/locations'
        ? Response.json({ error: 'forbidden' }, { status: 403 })
        : null,
  });
  await open();
  const trigger = screen.getByRole('button', { name: 'Location anlegen' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Location anlegen' });
  const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
  const submit = within(dialog).getByRole('button', {
    name: 'Anlegen und zuordnen',
  });
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.change(name, { target: { value: '   ' } });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(submit);
  expect(await within(dialog).findByText(/Bitte einen Namen/)).toBeTruthy();
  fireEvent.change(name, { target: { value: 'Fiktiver Festsaal' } });
  fireEvent.click(submit);
  expect(await within(dialog).findByText(/keine Berechtigung/)).toBeTruthy();
  expect(name.value).toBe('Fiktiver Festsaal');
  const confirm = vi
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Location anlegen' })).toBe(dialog);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog', { name: 'Location anlegen' })).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(
    fetcher.mock.calls
      .filter(([, init]) => init?.method)
      .map(([, init]) => init?.method),
  ).toEqual(['POST']);
});

test('keeps uncertain location creation in the dialog and prevents duplicate submissions', async () => {
  const { fetcher } = mockRecord();
  let rejectWrite: ((error: Error) => void) | undefined;
  const request = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, init) => {
    if (url !== '/api/v1/locations') return request(url, init);
    if (rejectWrite)
      return Promise.resolve(
        Response.json({ error: 'invalid' }, { status: 400 }),
      );
    return new Promise((_, reject) => {
      rejectWrite = reject;
    });
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Location anlegen' }));
  const dialog = screen.getByRole('dialog', { name: 'Location anlegen' });
  const name = within(dialog).getByLabelText('Name') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Fiktiver Saal' } });
  const submit = within(dialog).getByRole('button', {
    name: 'Anlegen und zuordnen',
  });
  fireEvent.click(submit);
  fireEvent.submit(submit.closest('form')!);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(
    fetcher.mock.calls.filter(([url]) => url === '/api/v1/locations'),
  ).toHaveLength(1);
  rejectWrite!(new Error('synthetic connection failure'));
  expect(
    await within(dialog).findByText(/Anlage nicht bestätigt/),
  ).toBeTruthy();
  expect(name.value).toBe('Fiktiver Saal');
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(submit);
  expect(
    await within(dialog).findByText(/Location konnte nicht angelegt werden/),
  ).toBeTruthy();
  expect(name.value).toBe('Fiktiver Saal');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(
    false,
  );
});

test('keeps a created location selectable when the event version conflicts', async () => {
  const location = {
    id: 'synthetic-location-conflict',
    name: 'Fiktiver Saal',
    state: 'active',
  };
  const { fetcher } = mockRecord({
    onLoad: (url, init) => {
      if (url === '/api/v1/locations')
        return Response.json(location, { status: 201 });
      if (init?.method === 'PUT')
        return Response.json({ error: 'conflict' }, { status: 409 });
      return null;
    },
  });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Location anlegen' }));
  const dialog = screen.getByRole('dialog', { name: 'Location anlegen' });
  fireEvent.change(within(dialog).getByLabelText('Name'), {
    target: { value: location.name },
  });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Anlegen und zuordnen' }),
  );
  expect(
    await screen.findByText(/Event wurde inzwischen geändert/),
  ).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: 'Ort / Adresse' })).getByText(
      'Ort offen.',
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByLabelText('Gespeicherter Ort')).getByRole('option', {
      name: location.name,
    }),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.filter(([url]) => url === '/api/v1/locations'),
  ).toHaveLength(1);
});

test('the wide frame keeps contact and place beside the main information', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  mockRecord();
  const { area } = await open();
  const aside = area('Details').querySelector(
    'details.event-aside',
  ) as HTMLDetailsElement;
  expect(aside.open).toBe(true);
  expect(area('Details').querySelector('.event-detail-primary')).toBeTruthy();
  expect(area('Details').querySelector('.event-detail-overview')).toBeTruthy();
  expect(aside.querySelector('.event-aside-contact')).toBeTruthy();
  expect(aside.querySelector('.event-aside-location')).toBeTruthy();
  expect(
    within(aside).getByRole('link', { name: 'record@example.invalid' }),
  ).toBeTruthy();
});

// A notification's "Antwort in der App" link opens the record in E-Mails with
// the composer, once.
test('a mail request in the address opens the record in E-Mails with the composer', async () => {
  window.history.replaceState(null, '', '/?mail=new#event-' + event.id);
  mockRecord();
  const view = await open();
  expect(view.tab('E-Mails').getAttribute('aria-current')).toBe('location');
  expect(
    await screen.findByRole('dialog', { name: 'Neue Mail schreiben' }),
  ).toBeTruthy();
  window.history.replaceState(null, '', '/');
});

// UI-BKP-10: a link from the document overview opens the record in Dateien.
test('a document named in the address opens the record in Dateien', async () => {
  for (const [doc, area] of [
    ['55555555-5555-4555-8555-555555555555', 'Dateien'],
    ['not-a-document', 'Details'],
  ] as const) {
    window.history.replaceState(
      null,
      '',
      '/?doc=' + doc + '#event-' + event.id,
    );
    mockRecord();
    const view = await open();
    expect(view.tab(area).getAttribute('aria-current')).toBe('location');
    view.unmount();
  }
  window.history.replaceState(null, '', '/');
});
