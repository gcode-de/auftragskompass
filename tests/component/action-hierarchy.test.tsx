import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthPanel } from '../../apps/admin/src/AuthPanel.js';
import { CalendarFeedsPanel } from '../../apps/admin/src/CalendarFeedsPanel.js';
import { CalendarPanel } from '../../apps/admin/src/CalendarPanel.js';
import { ContactPanel } from '../../apps/admin/src/ContactPanel.js';
import { EventCreateDialog } from '../../apps/admin/src/EventCreateDialog.js';
import { EventDetails } from '../../apps/admin/src/EventDetails.js';
import { EventDocuments } from '../../apps/admin/src/EventDocuments.js';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
import { FilesPanel } from '../../apps/admin/src/FilesPanel.js';
import { DocumentNumbersPanel } from '../../apps/admin/src/DocumentNumbersPanel.js';
import { DocumentTemplatesPanel } from '../../apps/admin/src/DocumentTemplatesPanel.js';
import { ImportPanel } from '../../apps/admin/src/ImportPanel.js';
import { MasterDataPanel } from '../../apps/admin/src/MasterDataPanel.js';
import { PasswordPanel } from '../../apps/admin/src/PasswordPanel.js';
import { ProductPanel } from '../../apps/admin/src/ProductPanel.js';
import { ResourceAssignments } from '../../apps/admin/src/ResourceAssignments.js';
import { ResourceBlocks } from '../../apps/admin/src/ResourceBlocks.js';
import { ResourcePanel } from '../../apps/admin/src/ResourcePanel.js';
import { WebsiteInbox } from '../../apps/admin/src/WebsiteInbox.js';

// H036: one visually dominant primary action per section or dialog; every other
// visible action stays reachable but names a quieter tier. jsdom has no layout
// engine or cascade, so the component checks read the shipped class contract
// and the stylesheet itself is asserted structurally below instead of faking a
// measurement.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function tier(control: Element | null): string | null {
  if (!control) return null;
  const classes = control.getAttribute('class') ?? '';
  if (classes.includes('primary-action')) return 'primary-action';
  if (classes.includes('secondary-action')) return 'secondary-action';
  if (classes.includes('tertiary-action')) return 'tertiary-action';
  if (classes.includes('icon-action')) return 'icon-action';
  return null;
}

/** Icon-only controls are a tier of their own: 44px glyph targets that stay
 * quiet unless the section's single creating action marks them dominant. */
function iconTier(control: Element | null, name: string) {
  expect(tier(control), `${name} is an icon-only action`).toBe('icon-action');
}

function classify(scope: Element) {
  const result: {
    label: string;
    tier: string | null;
    dominant?: boolean;
  }[] = [];
  for (const control of Array.from(
    scope.querySelectorAll(
      'button, a.primary-action, a.secondary-action, a.tertiary-action',
    ),
  )) {
    if (control.closest('[hidden]')) continue;
    // The record's section navigation is a navigation, not an action tier.
    if (control.closest('.record-navigation')) continue;
    // Chrome of the shell itself: the sidebar drawer's own open/close and
    // collapse controls belong to the navigation, not to a page frame. Their
    // geometry is covered by the navigation and Chromium tests.
    if (
      control.closest(
        '.desktop-sidebar, .mobile-menu, .workspace-toolbar .menu-trigger',
      )
    )
      continue;
    // Hidden record sections stay mounted (H025); only the open section counts.
    if (control.closest('[hidden]')) continue;
    result.push({
      label:
        control.getAttribute('aria-label') ??
        control.textContent?.trim() ??
        control.getAttribute('title') ??
        '',
      // An icon-only creating action keeps its 44px glyph shape and names its
      // dominance through the modifier class, not a text-button tier.
      tier: tier(control),
      dominant: (control.getAttribute('class') ?? '').includes(
        'tier-primary-icon',
      ),
    });
  }
  return result;
}

/** Exactly one primary action, and no unnamed visible button. */
function expectHierarchy(scope: Element, name: string) {
  const controls = classify(scope);
  expect(controls.length, `${name}: actions present`).toBeGreaterThan(0);
  expect(
    controls.filter((entry) => entry.tier === null),
    `${name}: every visible action names its tier`,
  ).toEqual([]);
  expect(
    controls.filter(
      (entry) => entry.tier === 'primary-action' || entry.dominant,
    ),
    `${name}: exactly one primary action`,
  ).toHaveLength(1);
}

/** The documented ceiling: no frame carries more than one primary action. A
 * frame may legitimately carry none (a read-only list, a navigation block). */
function expectAtMostOnePrimary(scope: Element, name: string) {
  const primaries = classify(scope).filter(
    (entry) => entry.tier === 'primary-action' || entry.dominant,
  );
  expect(
    primaries.length,
    `${name}: at most one primary action per frame (${primaries
      .map((entry) => entry.label)
      .join(', ')})`,
  ).toBeLessThanOrEqual(1);
  expect(
    classify(scope).filter((entry) => entry.tier === null),
    `${name}: every visible action names its tier`,
  ).toEqual([]);
}

/** The dominant actions of one frame, by their accessible label. */
function primaryLabels(scope: Element) {
  return classify(scope)
    .filter((entry) => entry.tier === 'primary-action' || entry.dominant)
    .map((entry) => entry.label);
}

const json = (body: unknown) => Response.json(body);

const masterRow = {
  id: 'synthetic-id',
  name: 'Synthetic entry',
  state: 'active',
  position: 0,
  version: 1,
};
const blockUnit = {
  id: 'synthetic-unit',
  name: 'Fictional box',
  code: 'SYNTH',
  ordinal: 1,
  enabled: true,
  state: 'active',
};
const blockRow = {
  id: 'synthetic-block',
  unitId: blockUnit.id,
  startsAt: '2030-10-16T16:00:00Z',
  endsAt: '2030-10-16T18:00:00Z',
  timeZone: 'Europe/Berlin',
  state: 'blocked',
  reason: 'Fictional maintenance',
};
// A real block overview: the earlier `[masterRow]` fallback made the panel
// abort its load, so the frame contract below was never really exercised
// (BKP009.2).
const blockOverview = {
  timeZone: 'Europe/Berlin',
  units: [blockUnit],
  blocks: [blockRow],
};
const resourceRow = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic box',
  code: 'TEST',
  category: 'Synthetic',
  description: '',
  quantity: 1,
  beforeDays: 2,
  afterDays: 2,
  position: 0,
  state: 'active',
  blocked: false,
};
const productRow = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic product',
  description: 'Fictional',
  unit: 'Stück',
  priceMinor: 1999,
  priceBasis: 'gross',
  taxBasisPoints: 1900,
  state: 'active',
  position: 0,
};
const contactRow = {
  id: 'synthetic',
  version: 1,
  kind: 'company',
  name: 'Synthetic Company',
  contactPerson: 'Fictional',
  street: 'Synthetic Street 1',
  postalCode: '00000',
  city: 'Fictional City',
  country: 'DE',
  email: 'synthetic@example.invalid',
  phone: '030 000000',
  mobile: '',
  state: 'active',
};
const eventRow = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic event',
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
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  description: '',
  notesHtml: '',
};
const calendarRange = {
  pendingPromises: 0,
  date: '2030-10-26',
  view: 'month',
  timeZone: 'Europe/Berlin',
  from: '2030-10-01',
  to: '2030-10-31',
  previousDate: '2030-09-26',
  nextDate: '2030-11-26',
  days: ['2030-10-26', '2030-10-27'].map((date) => ({
    date,
    startsAt: date + 'T00:00:00Z',
    endsAt: date + 'T23:59:59Z',
  })),
  events: [],
  reservations: [],
  units: [],
};
const filesRow = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'offer',
  templateId: '22222222-2222-4222-8222-222222222222',
  eventId: null,
  contactId: null,
  number: null,
  state: 'draft',
  issuedAt: '2031-05-01T20:30:00.000Z',
  finalizedAt: null,
  netMinor: 0,
  taxMinor: 0,
  grossMinor: 0,
  version: 1,
  eventName: null,
  issuedDate: '2031-05-01',
  pdfAvailable: false,
};
const inquiryItem = {
  id: 'fictional-inquiry',
  original: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    receivedAt: '2030-10-26T10:00:00.000Z',
    privacyNotice: 'Fictional original privacy',
    privacyUrl: 'https://fictional.example.invalid/privacy',
    fields: [
      { label: 'Vorname', value: 'Fictional' },
      { label: 'Nachname', value: 'Inbox' },
      { label: 'E-Mail', value: 'fictional@example.invalid' },
      { label: 'Veranstaltungsdatum', value: '27.10.2030' },
      { label: 'Telefonnummer', value: '' },
      { label: 'Veranstaltungsort', value: '' },
      { label: 'Gewünschtes Fotobox-Paket', value: '' },
      { label: 'Kommentar', value: 'Fictional note' },
    ],
  },
};

test('settings lists render one primary action and name every other tier', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes('/resource-blocks')) return json(blockOverview);
      if (path.includes('/resources')) return json([resourceRow]);
      if (path.includes('/products')) return json([productRow]);
      return json([masterRow]);
    }),
  );
  render(
    <MasterDataPanel kind="package" title="Paketwerte" csrfToken="csrf" />,
  );
  const master = screen.getByRole('region', { name: 'Paketwerte' });
  await within(master).findByText(/Synthetic entry/);
  expectHierarchy(master, 'Stammdaten');
  expect(tier(within(master).getByRole('button', { name: 'Speichern' }))).toBe(
    'primary-action',
  );
  expect(
    tier(within(master).getByRole('button', { name: 'Liste aktualisieren' })),
  ).toBe('tertiary-action');
  expect(
    tier(
      within(master).getByRole('button', {
        name: 'Bearbeiten: Synthetic entry',
      }),
    ),
  ).toBe('secondary-action');
  cleanup();

  render(<ResourcePanel csrfToken="csrf" />);
  const resources = screen.getByRole('region', { name: 'Ressourcen' });
  await within(resources).findByText(/Synthetic box/);
  // BKP009: the page leads with its list. The dialog is mounted on demand, so
  // the frame's one primary action is the create glyph in the toolbar; the
  // editor's save primary only exists once the dialog is open.
  expectHierarchy(resources, 'Ressourcen');
  expect(
    primaryLabels(resources),
    'Ressourcen is closed: exactly the create action is dominant',
  ).toEqual(['Ressource anlegen']);
  const create = within(resources).getByRole('button', {
    name: 'Ressource anlegen',
  });
  expect(tier(create), 'Ressource anlegen is an icon-only action').toBe(
    'icon-action',
  );
  expect(
    create.getAttribute('class'),
    'Ressource anlegen carries the dominant icon modifier',
  ).toContain('tier-primary-icon');
  expect(
    within(resources).queryByRole('button', { name: 'Ressource speichern' }),
    'the editor is not mounted until it is opened',
  ).toBeNull();
  expect(
    tier(
      within(resources).getByRole('button', {
        name: 'Ressourcen aktualisieren',
      }),
    ),
  ).toBe('tertiary-action');
  expect(
    tier(
      within(resources).getByRole('button', {
        name: 'Ressource bearbeiten: Synthetic box',
      }),
    ),
  ).toBe('secondary-action');
  // BKP009.2: the maintenance management is a disclosure of its own. Closed,
  // it mounts no form and contributes no action to the page frame; opened, it
  // is a separate frame with exactly one primary and nothing unnamed.
  const blocksFrame = within(resources).getByRole('region', {
    name: 'Zeitweise Ressourcensperren',
  });
  expect(
    primaryLabels(blocksFrame),
    'closed management: no dominant action at all',
  ).toEqual([]);
  expect(
    within(blocksFrame).queryByRole('button', { name: 'Zeitraum sperren' }),
  ).toBeNull();
  fireEvent.click(within(blocksFrame).getByText('Sperrverwaltung öffnen'));
  expectHierarchy(blocksFrame, 'Sperren geöffnet');
  expect(
    primaryLabels(blocksFrame),
    'opened management: its own frame carries the only primary',
  ).toEqual(['Zeitraum sperren']);
  fireEvent.click(within(blocksFrame).getByText('Sperrverwaltung schließen'));
  expect(
    primaryLabels(resources),
    'closing the management returns the page frame to one primary',
  ).toEqual(['Ressource anlegen']);
  cleanup();

  render(<ProductPanel csrfToken="csrf" />);
  const products = screen.getByRole('region', { name: 'Produkte' });
  await within(products).findByText(/Synthetic product/);
  expectHierarchy(products, 'Produkte');
  expect(
    tier(within(products).getByRole('button', { name: 'Produkt speichern' })),
  ).toBe('primary-action');
  expect(
    tier(
      within(products).getByRole('button', {
        name: 'Produkt bearbeiten: Synthetic product',
      }),
    ),
  ).toBe('secondary-action');
  expect(
    tier(
      within(products).getByRole('button', {
        name: 'Produkt duplizieren: Synthetic product',
      }),
    ),
  ).toBe('secondary-action');
});

test('contact list and dialog keep exactly one primary action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      json(options ? contactRow : [contactRow]),
    ),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText(/Synthetic Company/);
  const section = document.querySelector('section')!;
  expectHierarchy(section, 'Kontakte');
  expect(
    screen
      .getByRole('button', { name: 'Kontakt anlegen' })
      .getAttribute('class'),
  ).toContain('tier-primary-icon');
  expect(
    tier(screen.getByRole('link', { name: 'Kontakte als CSV exportieren' })),
  ).toBe('secondary-action');
  for (const name of [
    'Events anzeigen: Synthetic Company',
    'Kontakt bearbeiten: Synthetic Company',
  ])
    iconTier(within(section).getByRole('button', { name }), name);
  fireEvent.click(screen.getByRole('button', { name: 'Kontakt anlegen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Kontakt anlegen' });
  expectHierarchy(dialog, 'Kontakt-Dialog');
  expect(
    tier(within(dialog).getByRole('button', { name: 'Kontakt speichern' })),
  ).toBe('primary-action');
  for (const name of ['Dubletten prüfen', 'Kontakt abbrechen']) {
    expect(tier(within(dialog).getByRole('button', { name }))).toBe(
      'secondary-action',
    );
  }
  expect(
    tier(within(dialog).getByRole('button', { name: 'Dialog schließen' })),
  ).toBe('tertiary-action');
});

test('the reload warning retries the list without a second mutation', async () => {
  // H036 touched this retry button's tier, so its branch is exercised here: the
  // saved-but-not-reloaded warning retries the list and stays a quiet action.
  let failList = false,
    saved = false;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      saved = true;
      return json({ ...contactRow, name: 'Synthetic saved' });
    }
    if (failList) {
      failList = false;
      throw Error('offline');
    }
    return json([
      saved ? { ...contactRow, name: 'Synthetic saved' } : contactRow,
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText(/Synthetic Company/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Kontakt bearbeiten: Synthetic Company',
    }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Kontakt bearbeiten',
  });
  fireEvent.change(within(dialog).getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic saved' },
  });
  failList = true;
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Kontakt speichern' })
      .closest('form')!,
  );
  const retry = await screen.findByRole('button', {
    name: 'Kontakte erneut laden',
  });
  expect(tier(retry), 'the retry stays a quiet, reachable action').toBe(
    'tertiary-action',
  );
  const posts = () => fetcher.mock.calls.filter(([, options]) => options);
  expect(posts().length).toBe(1);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      screen.queryByText(
        'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
      ),
      'the retry clears the warning',
    ).toBeNull(),
  );
  await screen.findByText(/Synthetic saved/);
  expect(posts().length, 'a retry never repeats the mutation').toBe(1);
  expect(
    screen.queryByText(
      'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
    ),
  ).toBeNull();
});

test('event list, editor and filter block share one primary action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options) return json(eventRow);
      if (String(url) === '/api/v1/statuses')
        return json([{ code: 'inquiry', label: 'Anfrage' }]);
      if (String(url).startsWith('/api/v1/events'))
        return json({ timeZone: 'Europe/Berlin', events: [eventRow] });
      return json([]);
    }),
  );
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByRole('link', { name: /Synthetic event/ });
  const section = document.querySelector('section')!;
  expectHierarchy(section, 'Events');
  expect(
    screen.getByRole('button', { name: 'Event anlegen' }).getAttribute('class'),
  ).toContain('tier-primary-icon');
  for (const name of [
    'Event bearbeiten: Synthetic event',
    'Event duplizieren: Synthetic event',
  ])
    iconTier(within(section).getByRole('button', { name }), name);

  fireEvent.click(
    screen.getByRole('button', { name: 'Event bearbeiten: Synthetic event' }),
  );
  const editor = document.querySelector('#event-editor')!;
  await within(editor as HTMLElement).findByText('Event speichern');
  expectHierarchy(editor, 'Event-Editor');
  expect(
    tier(
      within(editor as HTMLElement).getByRole('button', {
        name: 'Event speichern',
      }),
    ),
  ).toBe('primary-action');
  expect(
    tier(
      within(editor as HTMLElement).getByRole('button', {
        name: 'Event abbrechen',
      }),
    ),
  ).toBe('tertiary-action');
  const filters = document.querySelector('.event-filters')!;
  expect(
    tier(
      within(filters as HTMLElement).getByRole('button', {
        name: 'Eventfilter zurücksetzen',
      }),
    ),
    'event filter reset',
  ).toBe('tertiary-action');
  expect(
    tier(
      within(filters as HTMLElement).getByRole('button', {
        name: 'Events filtern',
      }),
    ),
    'event filter submit',
  ).toBe('secondary-action');
});

test('event create dialog keeps save primary and close tertiary', async () => {
  render(
    <EventCreateDialog
      csrfToken="csrf"
      timeZone="Europe/Berlin"
      statuses={[{ code: 'inquiry', label: 'Anfrage' }]}
      types={[{ id: 'type-wedding', name: 'Hochzeit', state: 'active' }]}
      packages={[]}
      contacts={[]}
      locations={[]}
      initial={null}
      onClose={vi.fn()}
      onCreated={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Neues Event' });
  expectHierarchy(dialog, 'Event-Dialog');
  expect(
    tier(within(dialog).getByRole('button', { name: 'Event speichern' })),
  ).toBe('primary-action');
  expect(
    tier(within(dialog).getByRole('button', { name: 'Dialog schließen' })),
  ).toBe('tertiary-action');
});

test('event details keep status save primary and quiet the rest', async () => {
  const detail = {
    event: { ...eventRow, eventDate: '2030-10-16', name: 'Synthetic detail' },
    contacts: [],
    location: null,
    eventType: null,
    package: null,
    activities: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      json(options ? detail.event : detail),
    ),
  );
  render(
    <EventDetails
      statuses={[{ code: 'inquiry', label: 'Anfrage' }]}
      id="synthetic"
      csrfToken="csrf"
      onChanged={vi.fn()}
      onEdit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Event: Synthetic detail',
    level: 2,
  });
  const section = document.querySelector('section')!;
  // Hidden record sections stay mounted (H025), so the loaded hierarchy is
  // counted on the open section only: the status form.
  await waitFor(() => expect(section.getAttribute('aria-busy')).toBe('false'));
  // Hidden record sections stay mounted (H025), so the loaded hierarchy is
  // counted on the open overview only. The offers section and the assignment
  // surface are asserted as their own surfaces in the next test.
  const overview = Array.from(section.children).find(
    (child) => child.localName === 'div' && !child.hasAttribute('hidden'),
  )!;
  // Each open frame of the overview keeps one primary action; the offers
  // section below it is its own surface and is asserted separately.
  const frames = Array.from(overview.children).filter((child) =>
    child.querySelector('button.primary-action, button.tier-primary-icon'),
  );
  // Event-Details deliberately keeps two primaries in separate frames: "Status
  // speichern" owns the status form, "Entwurf anlegen" owns the offers section.
  // The durable rule is the ceiling per frame, so a future section cannot break
  // the contract merely by existing.
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) expectAtMostOnePrimary(frame, 'Event-Details');
  const navigation = section.querySelector('.record-navigation')!;
  for (const control of Array.from(navigation.querySelectorAll('button')))
    expect(
      control.getAttribute('aria-current') === 'location' ||
        control.getAttribute('class')?.includes('nav-action'),
      'record navigation marks its current section and keeps a quiet tier',
    ).toBe(true);
  expect(tier(screen.getByRole('button', { name: 'Status speichern' }))).toBe(
    'primary-action',
  );
  expect(
    tier(screen.getByRole('button', { name: 'Event-Details schließen' })),
  ).toBe('tertiary-action');
});

test('resource assignment, blocks, documents and website inbox stay on one primary', async () => {
  const unit = {
    id: 'synthetic-unit',
    name: 'Fictional box',
    code: 'SYNTH',
    ordinal: 1,
    enabled: true,
    state: 'active',
  };
  const block = {
    id: 'synthetic-block',
    unitId: unit.id,
    startsAt: '2030-10-16T16:00:00Z',
    endsAt: '2030-10-16T18:00:00Z',
    timeZone: 'Europe/Berlin',
    state: 'blocked',
    reason: 'Fictional maintenance',
  };
  const assignmentEvent = {
    ...eventRow,
    eventDate: '2030-10-16',
    startsAt: '2030-10-16T16:00:00Z',
    endsAt: '2030-10-16T18:00:00Z',
  };
  const assignmentUnit = {
    unitId: unit.id,
    resourceId: 'synthetic-resource',
    name: 'Fictional box',
    code: 'SYNTH-BOX',
    category: 'Fotobox',
    ordinal: 1,
    selected: false,
    periodSource: 'event',
    baseStart: assignmentEvent.startsAt,
    baseEnd: assignmentEvent.endsAt,
    beforeDays: 2,
    afterDays: 2,
    startsAt: '2030-10-14T16:00:00Z',
    endsAt: '2030-10-18T18:00:00Z',
    reason: null,
    conflicts: [],
    available: true,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes('/availability')) return json([assignmentUnit]);
      if (path.includes('/resources')) return json([resourceRow]);
      return json({
        timeZone: 'Europe/Berlin',
        units: [unit],
        blocks: [block],
      });
    }),
  );
  render(
    <ResourceAssignments
      event={assignmentEvent}
      csrfToken="csrf"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  const assignments = await screen.findByRole('region', {
    name: /Ressourcen/,
  });
  // The fixture's box label intentionally appears in both the legend and the
  // unit name, so the control itself is the readiness marker here.
  await within(assignments).findByRole('button', {
    name: /Verfügbarkeit prüfen/,
  });
  expectHierarchy(assignments, 'Ressourcenzuweisung');
  expect(
    classifiedPrimaryLabel(assignments),
    'Ressourcenzuweisung: the save action is the primary',
  ).toMatch(/Zuweisung und Termin speichern/);
  cleanup();

  render(<ResourceBlocks csrfToken="csrf" />);
  const blocks = await screen.findByRole('region', { name: /Zeitweise/ });
  // BKP009.2: the management mounts its list and form only after a deliberate
  // opening; the frame contract is asserted in that state.
  fireEvent.click(await within(blocks).findByText('Sperrverwaltung öffnen'));
  await within(blocks).findByRole('button', {
    name: /^Sperre freigeben: Fictional maintenance$/,
  });
  expectHierarchy(blocks, 'Sperren');
  expect(
    tier(within(blocks).getByRole('button', { name: 'Zeitraum sperren' })),
  ).toBe('primary-action');
  expect(
    tier(
      within(blocks).getByRole('button', {
        name: /^Zeiten übernehmen: Fictional maintenance$/,
      }),
    ),
  ).toBe('tertiary-action');
  expect(
    tier(
      within(blocks).getByRole('button', {
        name: /^Sperre freigeben: Fictional maintenance$/,
      }),
    ),
  ).toBe('secondary-action');
  cleanup();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).startsWith('/api/v1/document-templates')
        ? json([
            {
              id: 'synthetic-template',
              version: 1,
              kind: 'offer',
              name: 'Synthetic offer template',
              state: 'active',
              subject: 'Synthetic',
              introText: '',
              closingText: '',
              taxBasisPoints: 0,
              positions: [],
            },
          ])
        : json([]),
    ),
  );
  render(
    <EventDocuments
      eventId="synthetic-event"
      contactId="synthetic-contact"
      timeZone="Europe/Berlin"
      csrfToken="csrf"
    />,
  );
  const documents = await screen.findByRole('region', { name: /Angebote/ });
  await within(documents).findByRole('button', { name: 'Entwurf anlegen' });
  expectHierarchy(documents, 'Angebote');
  expect(
    tier(within(documents).getByRole('button', { name: 'Entwurf anlegen' })),
  ).toBe('primary-action');
});

function classifiedPrimaryLabel(scope: Element) {
  const primary = classify(scope).find(
    (entry) => entry.tier === 'primary-action',
  );
  return primary?.label ?? '';
}

test('website inbox keeps the adoption action primary', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({ items: [inquiryItem], total: 1, offset: 0, limit: 25 }),
    ),
  );
  render(
    <WebsiteInbox
      csrfToken="fictional-csrf"
      timeZone="Europe/Berlin"
      onImported={vi.fn()}
    />,
  );
  // The former exceptions block is a settings section now; its action tiers
  // travel with it.
  const region = screen.getByRole('region', {
    name: 'Website-Eingänge (Diagnose)',
  });
  await within(region).findByText(/Fictional Inbox/);
  expectHierarchy(region, 'Website-Eingänge');
  expect(
    tier(within(region).getByRole('button', { name: 'Als Option übernehmen' })),
  ).toBe('primary-action');
  expect(
    tier(
      within(region).getByRole('button', {
        name: 'Website-Eingänge aktualisieren',
      }),
    ),
  ).toBe('tertiary-action');
});

test('calendar, files and feeds keep navigation and reload quiet', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/v1/documents')) return json([filesRow]);
      if (String(url).startsWith('/api/v1/calendar'))
        return json(calendarRange);
      return json([]);
    }),
  );
  render(<CalendarPanel />);
  const calendar = screen.getByRole('region', { name: 'Kalender' });
  await waitFor(() => expect(calendar.textContent).toContain('Oktober 2030'));
  for (const name of [
    'Vorheriger Zeitraum',
    'Heute im Kalender',
    'Nächster Zeitraum',
  ])
    iconTier(within(calendar).getByRole('button', { name }), name);
  cleanup();

  render(<FilesPanel />);
  await waitFor(() =>
    expect(screen.getAllByText(/Angebot|Entwurf|RE-/).length).toBeGreaterThan(
      0,
    ),
  );
  const files = document.querySelector('section')!;
  for (const name of [
    'Filter zurücksetzen',
    'Vorherige Seite',
    'Nächste Seite',
  ])
    iconTier(within(files).getByRole('button', { name }), name);
  cleanup();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === '/api/v1/calendar-feeds'
        ? json([])
        : json([] as unknown[]),
    ),
  );
  render(<CalendarFeedsPanel csrfToken="fictional-csrf" />);
  const feeds = await screen.findByRole('region', { name: /Kalender-Abos/ });
  expectHierarchy(feeds, 'Kalender-Abos');
  expect(
    tier(within(feeds).getByRole('button', { name: 'Abo erstellen' })),
  ).toBe('primary-action');
  expect(
    tier(within(feeds).getByRole('button', { name: 'Abos neu laden' })),
  ).toBe('tertiary-action');
});

test('password, import, template and number panels name a tier for every action', async () => {
  render(
    <PasswordPanel
      csrfToken="fictional-csrf"
      onChanged={vi.fn()}
      onSessionEnded={vi.fn()}
    />,
  );
  const password = screen.getByRole('region', { name: 'Eigenes Passwort' });
  expectHierarchy(password, 'Konto/Passwort');
  expect(
    tier(within(password).getByRole('button', { name: 'Passwort ändern' })),
  ).toBe('primary-action');
  cleanup();

  // The import surface renders two frames: the transfer form and the promise
  // checklist. Both are open at once, so each one keeps its own single primary.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === '/api/v1/imports/bookitup'
        ? json({
            checkedAt: '2030-10-26T10:00:00.000Z',
            counts: { contacts: 0 },
            pendingPromises: 0,
            mappings: [],
            promises: [],
          })
        : json({ sections: [], valid: false }),
    ),
  );
  render(<ImportPanel csrfToken="fictional-csrf" />);
  const importPanel = screen.getByRole('region', {
    name: 'Bookitup-Importvorschau',
  });
  const overview = await screen.findByRole('region', {
    name: 'Importbestand und Ressourcen-Prüfliste',
  });
  await within(overview).findByText(/Ungeprüfte Bestandszusagen:/);
  // The transfer frame is the confirmed fieldset; the preview form above it and
  // the promise checklist below it are separate frames of the same surface.
  const transfer = Array.from(importPanel.querySelectorAll(':scope > *')).find(
    (child) => child.localName === 'fieldset',
  )!;
  expectHierarchy(transfer, 'Import (Austausch)');
  expect(
    tier(
      within(importPanel).getByRole('button', {
        name: 'Importvorschau prüfen',
      }),
    ),
  ).toBe('secondary-action');
  expect(
    tier(
      within(transfer as HTMLElement).getByRole('button', {
        name: 'Transaktionalen Probelauf starten',
      }),
    ),
  ).toBe('secondary-action');
  expect(
    tier(
      within(transfer as HTMLElement).getByRole('button', {
        name: 'Geprüfte Daten übernehmen',
      }),
    ),
  ).toBe('primary-action');
  // The checklist is read-only until a promise is selected: it names a tier for
  // every action and never shows a competing primary.
  expect(
    classify(overview).filter((entry) => entry.tier === null),
    'Importbestand: every visible action names its tier',
  ).toEqual([]);
  expectAtMostOnePrimary(overview, 'Importbestand');
  expect(
    tier(
      within(overview).getByRole('button', {
        name: 'Importbestand aktualisieren',
      }),
    ),
  ).toBe('tertiary-action');
  expect(
    tier(
      within(overview).getByRole('button', {
        name: 'Privaten Prüfbericht herunterladen',
      }),
    ),
  ).toBe('secondary-action');
  cleanup();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === '/api/v1/document-templates'
        ? json([
            {
              id: 'synthetic-template',
              version: 1,
              kind: 'offer',
              name: 'Synthetic offer template',
              state: 'active',
              subject: 'Synthetic',
              introText: '',
              outroText: '',
              validityDays: 14,
              taxBasisPoints: 0,
              positions: [],
            },
          ])
        : json([]),
    ),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  const templates = screen.getByRole('region', { name: 'Dokumentvorlagen' });
  await within(templates).findByText(/Synthetic offer template/);
  expectHierarchy(templates, 'Dokumentvorlagen');
  const createTemplate = within(templates).getByRole('button', {
    name: 'Vorlage anlegen',
  });
  expect(tier(createTemplate)).toBe('primary-action');
  expect(
    within(templates).queryByRole('button', {
      name: 'Vorlage duplizieren: Synthetic offer template',
    }),
  ).toBeNull();
  expect(
    within(templates).queryByRole('button', {
      name: 'Vorlage archivieren: Synthetic offer template',
    }),
  ).toBeNull();
  expect(
    tier(
      within(templates).getByRole('button', {
        name: 'Vorlage bearbeiten: Synthetic offer template',
      }),
    ),
  ).toBe('secondary-action');
  const templateActions = within(templates).getByRole('button', {
    name: 'Weitere Aktionen für Synthetic offer template',
  });
  expect(tier(templateActions)).toBe('tertiary-action');
  expect(
    within(templates).queryByRole('button', { name: 'Vorlage speichern' }),
  ).toBeNull();
  fireEvent.click(templateActions);
  expect(templateActions.getAttribute('aria-expanded')).toBe('true');
  expect(
    tier(
      within(templates).getByRole('button', {
        name: 'Vorlage duplizieren: Synthetic offer template',
      }),
    ),
  ).toBe('secondary-action');
  expect(
    tier(
      within(templates).getByRole('button', {
        name: 'Vorlage archivieren: Synthetic offer template',
      }),
    ),
  ).toBe('tertiary-action');
  fireEvent.click(templateActions);
  fireEvent.click(createTemplate);
  fireEvent.click(templateActions);
  expectHierarchy(templates, 'Dokumentvorlageneditor');
  expect(
    tier(within(templates).getByRole('button', { name: 'Vorlage speichern' })),
  ).toBe('primary-action');
  for (const name of ['Position hinzufügen', 'Position entfernen'])
    expect(tier(within(templates).getByRole('button', { name })), name).toBe(
      'secondary-action',
    );
  for (const name of [
    'Vorlage bearbeiten: Synthetic offer template',
    'Vorlage duplizieren: Synthetic offer template',
  ])
    expect(tier(within(templates).getByRole('button', { name })), name).toBe(
      'secondary-action',
    );
  expect(
    tier(
      within(templates).getByRole('button', {
        name: 'Vorlage archivieren: Synthetic offer template',
      }),
    ),
  ).toBe('tertiary-action');
  cleanup();

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json([])),
  );
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  const numbers = screen.getByRole('region', { name: /Nummernkreise/ });
  await within(numbers).findAllByText(/Nächste Nummer \(/);
  // One range carries the save primary - the range the reader is editing - and
  // every other range keeps an equally usable, quieter save beside its preview.
  expectHierarchy(numbers, 'Nummernkreise');
  const frames = Array.from(numbers.querySelectorAll('fieldset'));
  expect(frames.length, 'Nummernkreise: one frame per document kind').toBe(5);
  expect(
    frames.filter(
      (frame) => frame.querySelector('button.primary-action') !== null,
    ),
    'exactly one number range is the edited one',
  ).toHaveLength(1);
  for (const frame of frames) {
    const [label] = Array.from(frame.querySelectorAll('legend')).map(
      (legend) => legend.textContent?.trim() ?? '',
    );
    expect(
      tier(
        within(frame as HTMLElement).getByRole('button', {
          name: `Nummernkreis speichern (${label})`,
        }),
      ),
      `${label}: save names a tier inside its own frame`,
    ).toMatch(/^(primary|secondary)-action$/);
    expect(
      tier(
        within(frame as HTMLElement).getByRole('button', {
          name: `Vorschau (${label})`,
        }),
      ),
      'a preview never competes with the save action',
    ).toBe('secondary-action');
  }
});

test('a fully configured number surface keeps its save primary on the first range', async () => {
  // All five ranges already exist, so the "first unconfigured range" rule has no
  // answer and must fall back to the first range instead of showing none.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json(
        [
          'offer',
          'order_confirmation',
          'deposit_invoice',
          'invoice',
          'correction',
        ].map((kind) => ({
          kind,
          pattern: 'X-{YYYY}-{SEQ}',
          minLength: 4,
          nextValue: 1,
          version: 1,
        })),
      ),
    ),
  );
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  const numbers = screen.getByRole('region', { name: /Nummernkreise/ });
  await within(numbers).findAllByText(/Nächste Nummer \(/);
  await waitFor(() =>
    expect(
      within(numbers).getAllByRole('button', { name: /^Vorschau \(/ }).length,
    ).toBe(5),
  );
  expectHierarchy(numbers, 'Nummernkreise (vollständig)');
  const frames = Array.from(numbers.querySelectorAll('fieldset'));
  expect(
    frames
      .map((frame) => frame.querySelector('legend')?.textContent?.trim())
      .filter((label) => label === 'Angebot'),
    'the first configured range carries the primary',
  ).toHaveLength(1);
  expect(
    tier(
      within(frames[0] as HTMLElement).getByRole('button', {
        name: 'Nummernkreis speichern (Angebot)',
      }),
    ),
  ).toBe('primary-action');
});

test('each mounted workspace route shows at most one primary action in the real shell', async () => {
  // The real application shell: AuthPanel renders Navigation plus one
  // hidden-until-selected workspace page per route with the shipped
  // `[hidden]{display:none!important}` rule. The earlier per-surface tests
  // render panels into an empty div and therefore never see that rule; this
  // test mounts the routes the way a reader does and counts only what is
  // actually displayed.
  const overview = {
    checkedAt: '2030-10-26T10:00:00.000Z',
    counts: { contacts: 0 },
    pendingPromises: 0,
    mappings: [],
    promises: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url);
      if (path === '/auth/me')
        return json({
          email: 'fictional.owner@example.invalid',
          csrfToken: 'fictional-csrf',
        });
      if (options) return json(eventRow);
      if (path === '/api/v1/statuses')
        return json([{ code: 'inquiry', label: 'Anfrage' }]);
      if (path.startsWith('/api/v1/events'))
        return json({ timeZone: 'Europe/Berlin', events: [eventRow] });
      if (path === '/api/v1/imports/bookitup') return json(overview);
      if (path.startsWith('/api/v1/document-templates')) return json([]);
      if (path.startsWith('/api/v1/document-numbers'))
        return json([
          {
            kind: 'offer',
            pattern: 'RE-{YYYY}-{SEQ}',
            minLength: 4,
            nextValue: 1,
            version: 1,
          },
        ]);
      if (path.startsWith('/api/v1/documents')) return json([filesRow]);
      if (path === '/api/v1/calendar-feeds') return json([]);
      if (path.startsWith('/api/v1/calendar')) return json(calendarRange);
      if (path === '/api/v1/resources') return json([resourceRow]);
      if (path.includes('/resources')) return json([resourceRow]);
      if (path.includes('/products')) return json([productRow]);
      if (path.startsWith('/api/v1/website-inquiries'))
        return json({ items: [], total: 0, offset: 0, limit: 25 });
      return json([]);
    }),
  );

  // Every route of the real shell, with the section heading or region name
  // that only that route shows once it has rendered its own data.
  const routes: [string, string, string?][] = [
    ['/#events', 'Events – zur Eventübersicht'],
    ['/#contacts', 'Kontakte – zur Eventübersicht'],
    ['/#files', 'Dateien – zur Eventübersicht'],
    ['/#calendar', 'Kalender – zur Eventübersicht'],
    ['/#settings', 'Einstellungen – zur Eventübersicht', 'Eventarten'],
    [
      '/#settings-resources',
      'Einstellungen – zur Eventübersicht',
      'Ressourcen',
    ],
    ['/#settings-products', 'Einstellungen – zur Eventübersicht', 'Produkte'],
    [
      '/#settings-calendar',
      'Einstellungen – zur Eventübersicht',
      'Kalender-Abos',
    ],
    ['/#import-review', 'Einstellungen – zur Eventübersicht'],
    ['/#settings-templates', 'Einstellungen – zur Eventübersicht'],
    ['/#settings-numbers', 'Einstellungen – zur Eventübersicht'],
    [
      '/#settings-export',
      'Einstellungen – zur Eventübersicht',
      'Daten exportieren',
    ],
    ['/#settings-security', 'Einstellungen – zur Eventübersicht'],
    [
      '/#settings-website',
      'Einstellungen – zur Eventübersicht',
      'Website-Eingänge (Diagnose)',
    ],
  ];

  // Only displayed controls count: the shipped `[hidden]{display:none!important}`
  // rule removes every non-selected workspace page from the paint, so a control
  // inside a `[hidden]` ancestor is not visible and must not be counted.
  const shown = (selector: string) =>
    Array.from(document.body.querySelectorAll(selector)).filter(
      (control) => !control.closest('[hidden]'),
    );
  const primaries = () => shown('.primary-action, .tier-primary-icon');
  const unnamed = () =>
    shown('button, a.primary-action, a.secondary-action, a.tertiary-action')
      .filter((control) => !control.closest('.record-navigation'))
      // BKP008: a calendar day cell is a date selector inside the month grid,
      // not a page action; its pressed/current state is covered by the
      // calendar component and Chromium tests.
      .filter((control) => !control.matches('.calendar-day-button'))
      // The drawer's own open/close/collapse controls and the theme switch are
      // shell and navigation chrome, covered by the navigation and Chromium tests.
      .filter(
        (control) =>
          !control.closest('.desktop-sidebar, .mobile-menu') &&
          !control.matches('.workspace-toolbar .menu-trigger'),
      )
      // Every text action and every icon action names its tier; a bare
      // `icon-action` fails here just like an unclassed button.
      .filter((control) => {
        const classes = control.getAttribute('class') ?? '';
        return !(
          classes.includes('primary-action') ||
          classes.includes('secondary-action') ||
          classes.includes('tertiary-action') ||
          classes.includes('tier-primary-icon') ||
          classes.includes('tier-quiet-icon')
        );
      })
      .map(
        (control) =>
          control.textContent?.trim() ||
          control.getAttribute('aria-label') ||
          control.getAttribute('title') ||
          control.localName,
      );

  render(<AuthPanel />);
  await screen.findByRole('region', { name: 'Events' });

  for (const [hash, title, section] of routes) {
    window.history.replaceState(null, '', hash);
    fireEvent(window, new HashChangeEvent('hashchange'));
    await screen.findByRole('heading', { level: 1, name: title });
    if (section)
      await screen.findByRole(
        section === 'Kalender-Abos' ? 'region' : 'heading',
        {
          ...(section === 'Kalender-Abos'
            ? { name: section }
            : { level: 2, name: section }),
        },
      );
    // The rule this contract protects: the displayed frame shows 0 or 1 primary.
    expect(
      primaries().map(
        (control) =>
          control.textContent?.trim() ||
          control.getAttribute('aria-label') ||
          '',
      ),
      `${hash}: at most one visible primary action`,
    ).toHaveLength(Math.min(primaries().length, 1));
    expect(unnamed(), `${hash}: every visible action names its tier`).toEqual(
      [],
    );
  }
});

test('resources resolves its create and save primaries through the hidden-page rule', async () => {
  // BKP009: the resource page leads with its list. The toolbar's create action
  // is the only primary of the page frame; the editor is mounted on demand and
  // then carries the save primary inside its own dialog frame. That is the
  // contract: one visible primary per visible frame, never two inside one
  // frame, and `[hidden]{display:none!important}` keeps every unselected
  // settings page out of the paint.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes('/resource-blocks')) return json(blockOverview);
      if (path.includes('/resources')) return json([resourceRow]);
      return json([masterRow]);
    }),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  const resources = screen.getByRole('region', { name: 'Ressourcen' });
  await within(resources).findByText(/Synthetic box/);
  const primaries = () =>
    Array.from(
      resources.querySelectorAll(
        'button.primary-action, button.tier-primary-icon',
      ),
    );
  // Nothing is pre-mounted: the page shows its list plus one create action.
  expect(within(resources).queryByRole('dialog')).toBeNull();
  expect(
    within(resources).queryByRole('button', { name: 'Ressource speichern' }),
  ).toBeNull();
  expect(
    primaries().map(
      (control) =>
        control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
    ),
    'Ressourcen keeps one primary per mounted editor',
  ).toEqual(['Ressource anlegen']);
  // BKP009.2: the maintenance management is a second frame that only exists
  // while it is opened. Closed it adds nothing; opened it owns exactly one
  // primary of its own and leaves the page frame's primary alone.
  const blocksFrame = within(resources).getByRole('region', {
    name: 'Zeitweise Ressourcensperren',
  });
  expect(
    within(blocksFrame).queryByRole('button', { name: 'Zeitraum sperren' }),
    'the closed management mounts no form',
  ).toBeNull();
  fireEvent.click(within(blocksFrame).getByText('Sperrverwaltung öffnen'));
  expectAtMostOnePrimary(blocksFrame, 'Sperrverwaltung (offen)');
  expect(
    primaryLabels(blocksFrame),
    'the opened management carries exactly Zeitraum sperren',
  ).toEqual(['Zeitraum sperren']);
  expect(
    primaries().map(
      (control) =>
        control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
    ),
    'two frames, one primary each',
  ).toEqual(['Ressource anlegen', 'Zeitraum sperren']);
  fireEvent.click(within(blocksFrame).getByText('Sperrverwaltung schließen'));
  expect(
    primaries().map(
      (control) =>
        control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
    ),
    'closing the management removes its primary again',
  ).toEqual(['Ressource anlegen']);
  // Only frames that are not hidden contribute a visible primary.
  const visibleFrames = Array.from(resources.children).filter(
    (child) => child.closest('[hidden]') === null,
  );
  expect(visibleFrames.length, 'one open editor frame').toBeGreaterThan(0);
  for (const frame of visibleFrames)
    expectAtMostOnePrimary(frame, 'Ressourcen (sichtbarer Rahmen)');
  // Opening the editor adds the dialog frame with exactly one save primary.
  fireEvent.click(
    within(resources).getByRole('button', {
      name: 'Ressource bearbeiten: Synthetic box',
    }),
  );
  const dialog = await within(resources).findByRole('dialog', {
    name: 'Ressource bearbeiten',
  });
  expectAtMostOnePrimary(dialog, 'Ressourcen (Editor)');
  expect(
    tier(within(dialog).getByRole('button', { name: 'Ressource speichern' })),
  ).toBe('primary-action');
  expect(
    primaries().map(
      (control) =>
        control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
    ),
    'two visible frames, one primary each',
  ).toEqual(['Ressource anlegen', 'Ressource speichern']);
  const hiddenRule = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(
    readFileSync(resolve(process.cwd(), 'apps/admin/src/styles.css'), 'utf8'),
  );
  expect(hiddenRule, '[hidden] removes the page from the paint').toBe(true);
});

test('sign-in keeps a single primary action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === '/auth/me'
        ? new Response(null, {
            status: 401,
            headers: { 'x-auth-mode': 'password' },
          })
        : json({ mode: 'password' }),
    ),
  );
  render(<AuthPanel />);
  const card = await screen.findByRole('region', { name: 'Anmeldung' });
  await within(card).findByRole('button', { name: 'Anmelden' });
  expectHierarchy(card, 'Anmeldung');
  expect(tier(within(card).getByRole('button', { name: 'Anmelden' }))).toBe(
    'primary-action',
  );
  expect(
    tier(within(card).getByRole('button', { name: 'Dunkelmodus aktivieren' })),
  ).toBe('tertiary-action');
});

// Structural checks on the shipped stylesheet: jsdom does not evaluate the
// cascade, so the tokens are read and asserted instead of faking a render.
const css = readFileSync(
  resolve(process.cwd(), 'apps/admin/src/styles.css'),
  'utf8',
);

function rule(selector: string) {
  const escaped = selector
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace('\\ ', '\\s+'),
    )
    .join('\\s*,\\s*');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(
    css,
  );
  expect(match, `stylesheet rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

function tokens() {
  const light = /(?:^|\n):root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(light).not.toBe('');
  const read = (source: string, name: string) =>
    new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(source)?.[1]?.trim();
  const pair = (name: string) => {
    const value = read(light, name);
    expect(value, `token --${name}`).toBeTruthy();
    const match =
      /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/i.exec(value!);
    expect(match, `--${name} is a light-dark pair`).not.toBeNull();
    return { light: match![1]!.toLowerCase(), dark: match![2]!.toLowerCase() };
  };
  return { read, pair, light };
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('the action tiers are one shared token set with 44px targets and visible focus', () => {
  const { pair } = tokens();
  const primary = rule('.primary-action');
  expect(primary).toContain('background: var(--action)');
  expect(primary).toContain('color: var(--action-ink)');
  expect(primary).toContain('border-color: var(--action-border)');
  expect(primary).toContain('min-height: 44px');
  expect(primary).toContain('font-weight: 650');

  const secondary = rule('.secondary-action');
  expect(secondary).toContain('background: transparent');
  expect(secondary).toContain('min-height: 44px');
  expect(secondary).toContain('color: var(--quiet-ink)');
  expect(secondary).toContain('border-color: var(--quiet-action-border)');
  expect(secondary).toContain('font-weight: 600');

  const tertiary = rule('.tertiary-action');
  expect(tertiary).toContain('background: transparent');
  expect(tertiary).toContain('min-height: 44px');
  expect(tertiary).toContain('color: var(--quiet-ink)');
  expect(tertiary).toContain('border-color: transparent');
  expect(tertiary).toContain('font-weight: 500');

  const icon = rule('.icon-action');
  expect(icon).toContain('width: 44px');
  expect(icon).toContain('min-height: 44px');

  const focus = rule(':focus-visible');
  expect(focus).toContain('outline: 3px solid var(--focus)');
  expect(focus).toContain('outline-offset: 3px');

  const disabled = rule(
    '.primary-action:disabled, .secondary-action:disabled, .tertiary-action:disabled, .icon-action:disabled',
  );
  expect(disabled).toContain('opacity:');
  expect(disabled).toContain('cursor: not-allowed');
  expect(disabled).toContain('border-style: dashed');

  for (const name of [
    'action',
    'action-hover',
    'action-ink',
    'action-border',
    'quiet-ink',
    'quiet-action-border',
  ])
    pair(name);
});

test('primary, secondary and tertiary text keep WCAG AA contrast in both themes', () => {
  const { pair } = tokens();
  const surface = pair('surface');
  const fieldSurface = pair('field-surface');
  const action = pair('action');
  const actionInk = pair('action-ink');
  const actionHover = pair('action-hover');
  const quietInk = pair('quiet-ink');
  const hoverSurface = pair('hover-surface');

  for (const theme of ['light', 'dark'] as const) {
    expect(
      contrast(actionInk[theme], action[theme]),
      `primary ${theme}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(actionInk[theme], actionHover[theme]),
      `primary hover ${theme}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(quietInk[theme], surface[theme]),
      `quiet on surface ${theme}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(quietInk[theme], fieldSurface[theme]),
      `quiet on field surface ${theme}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(quietInk[theme], hoverSurface[theme]),
      `quiet on hover ${theme}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test('quiet tiers keep a hover and stacking state that pairs colour with weight', () => {
  expect(rule('.secondary-action:hover:not(:disabled)')).toContain(
    'background: var(--hover-surface)',
  );
  expect(rule('.tertiary-action:hover:not(:disabled)')).toContain(
    'background: var(--hover-surface)',
  );
  // The 44px floor is declared once, on every tier rule and the icon rule.
  for (const selector of [
    '.primary-action',
    '.secondary-action',
    '.tertiary-action',
    '.icon-action',
  ])
    expect(rule(selector), selector).toContain('min-height: 44px');
  expect(waitFor).toBeTypeOf('function');
});

// BKP005: the neutral palette has to hold its contrast in both themes, not
// only look calmer. The pairs below are the surfaces the reader actually meets:
// body and muted text, the quiet tiers, focus rings, disabled controls, the
// alert surface, status surfaces and the dark navigation rail.
function palette(name: string) {
  const raw = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(
    tokens().light,
  )?.[1];
  expect(raw, `token --${name}`).toBeTruthy();
  const pairMatch =
    /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/i.exec(
      raw!.trim(),
    );
  if (pairMatch)
    return {
      light: pairMatch[1]!.toLowerCase(),
      dark: pairMatch[2]!.toLowerCase(),
    };
  const single = /^(#[0-9a-f]{6})$/i.exec(raw!.trim());
  expect(single, `--${name} is a colour`).not.toBeNull();
  return { light: single![1]!.toLowerCase(), dark: single![1]!.toLowerCase() };
}

test('the neutral palette keeps AA text and 3:1 boundaries in both themes', () => {
  const pairs: [string, string, number][] = [
    ['ink', 'surface', 4.5],
    ['ink', 'canvas', 4.5],
    ['ink', 'field-surface', 4.5],
    ['ink', 'table-surface', 4.5],
    ['ink', 'status-surface', 4.5],
    ['muted', 'surface', 4.5],
    ['muted', 'canvas', 4.5],
    ['accent', 'surface', 4.5],
    ['accent', 'canvas', 4.5],
    ['accent', 'hover-surface', 4.5],
    ['quiet-ink', 'surface', 4.5],
    ['quiet-ink', 'hover-surface', 4.5],
    ['quiet-ink', 'field-surface', 4.5],
    ['action-ink', 'action', 4.5],
    ['action-ink', 'action-hover', 4.5],
    ['selected-ink', 'selected-surface', 4.5],
    ['selection-ink', 'selection', 4.5],
    ['alert-ink', 'alert-surface', 4.5],
    ['disabled-ink', 'disabled-surface', 4.5],
    ['disabled-ink', 'surface', 4.5],
    ['sidebar-ink', 'sidebar', 4.5],
    ['sidebar-link', 'sidebar', 4.5],
    ['sidebar-muted', 'sidebar', 4.5],
    ['sidebar-ink', 'sidebar-active', 4.5],
    ['sidebar-ink', 'sidebar-hover', 4.5],
    ['focus', 'surface', 3],
    ['focus', 'canvas', 3],
    ['focus', 'field-surface', 3],
    ['sidebar-focus', 'sidebar', 3],
    ['quiet-action-border', 'surface', 3],
    ['field-border', 'surface', 3],
    ['menu-close-border', 'sidebar', 3],
  ];
  for (const [foreground, background, minimum] of pairs) {
    const text = palette(foreground);
    const surface = palette(background);
    for (const theme of ['light', 'dark'] as const)
      expect(
        contrast(text[theme], surface[theme]),
        `${foreground} on ${background} (${theme})`,
      ).toBeGreaterThanOrEqual(minimum);
  }
});

test('the disabled tier states its own readable colours instead of a veil', () => {
  // A 0.6 opacity veil halved the label contrast; the palette now carries the
  // state with a neutral fill and a readable label, while the dashed border and
  // the 44px target of the original tier rule stay in force.
  expect(rule('.primary-action:disabled')).toContain(
    'background: var(--disabled-surface)',
  );
  expect(rule('.primary-action:disabled')).toContain(
    'color: var(--disabled-ink)',
  );
  const quiet = rule(
    '.tertiary-action:disabled, .icon-action:disabled, .secondary-action:disabled',
  );
  expect(quiet).toContain('color: var(--disabled-ink)');
  expect(quiet).toContain('border-color: var(--quiet-action-border)');
  const disabled = rule(
    '.primary-action:disabled, .secondary-action:disabled, .tertiary-action:disabled, .icon-action:disabled',
  );
  expect(disabled).toContain('border-style: dashed');
  expect(disabled).toContain('cursor: not-allowed');
});
