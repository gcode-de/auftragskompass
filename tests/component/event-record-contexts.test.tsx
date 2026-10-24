import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { EventDetails } from '../../apps/admin/src/EventDetails.js';

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
    onLoad?: (url: string) => Response | null;
  } = {},
) {
  const calls: { url: string; method: string }[] = [];
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const override = options.onLoad?.(url);
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
  for (const name of [
    'Dateien',
    'Ressourcen',
    'Notizen',
    'Logbuch',
    'Details',
  ]) {
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
  expect(
    within(offers).getByRole('button', { name: 'Entwurf anlegen' }),
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

test('the record offers no mail area while there is no mail function', async () => {
  mockRecord();
  const { panel } = await open();
  const navigation = within(panel).getByRole('navigation', {
    name: 'Bereiche des Events',
  });
  expect(
    within(navigation)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Details', 'Ressourcen', 'Dateien', 'Notizen', 'Logbuch']);
  expect(within(panel).queryAllByRole('button', { name: /e-?mail/i })).toEqual(
    [],
  );
  expect(within(panel).queryAllByRole('link', { name: /e-?mail/i })).toEqual(
    [],
  );
  expect(panel.textContent).not.toMatch(/\bE-Mails?\b/i);
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
  for (const name of ['Dateien', 'Notizen', 'Logbuch', 'Details', 'Dateien'])
    fireEvent.click(tab(name));
  fireEvent.click(tab('Ressourcen'));
  expect(start.value).toBe('2026-10-18T18:00');
  fireEvent.click(tab('Details'));
  expect(status.value).toBe('inquiry');
  // The notes keep their own reachable area instead of being folded away.
  fireEvent.click(tab('Notizen'));
  expect(
    within(area('Interne Notizen')).getByLabelText(
      'Notizen: Fictional record event',
    ).textContent,
  ).toContain('Fictional record note');
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
  fireEvent.click(tab('Notizen'));
  expect(document.activeElement).toBe(area('Interne Notizen'));
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
  expect(
    within(aside).getByRole('link', { name: 'record@example.invalid' }),
  ).toBeTruthy();
});
