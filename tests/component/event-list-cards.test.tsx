import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
// BKP014.1: the overview rows are cards, not flat name–date–status strings.
// Every card names its date in a column, its status as marker plus written
// label, its event type above the full title and its effective place below it.
const base = {
  version: 1,
  packageId: null,
  primaryContactId: null,
  additionalContactIds: [],
  description: '',
  notesHtml: '',
  timeZone: 'Europe/Berlin',
  venueOverride: false,
  locationId: null,
  venue: null as string | null,
  source: '',
};
const rows = [
  {
    ...base,
    id: 'fictional-timed',
    name: 'Fiktive Hochzeit mit einem sehr langen Titel ohne Kürzung',
    status: 'booked',
    eventTypeId: 'fictional-wedding',
    eventDate: '2026-10-24',
    startsAt: '2026-10-24T16:00:00.000Z',
    endsAt: '2026-10-24T21:30:00.000Z',
    venue: 'Fiktive Scheune am See',
    venueOverride: true,
    primaryContactId: 'fictional-contact',
  },
  {
    ...base,
    id: 'fictional-day',
    name: 'Fiktive Tagesbuchung',
    status: 'option',
    eventTypeId: null,
    eventDate: '2026-10-25',
    startsAt: null,
    endsAt: null,
  },
  {
    ...base,
    id: 'fictional-undated',
    name: 'Fiktive Anfrage ohne Termin',
    status: 'inquiry',
    eventTypeId: null,
    eventDate: null,
    startsAt: null,
    endsAt: null,
  },
  {
    ...base,
    id: 'fictional-open-end',
    name: 'Fiktiver Beginn ohne Ende',
    status: 'option',
    eventTypeId: null,
    eventDate: '2026-11-02',
    startsAt: '2026-11-02T17:00:00.000Z',
    endsAt: null,
  },
];
function fetcher(events: Record<string, unknown>[] = rows) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/v1/events'))
      return Response.json({
        timeZone: 'Europe/Berlin',
        events,
        filterCounts: {
          undated: events.filter((event) => !event.eventDate).length,
          inquiries: events.filter((event) => event.status === 'inquiry')
            .length,
        },
      });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'option', label: 'Option' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    if (url === '/api/v1/master-data/event_type')
      return Response.json([
        { id: 'fictional-wedding', name: 'Hochzeit', state: 'active' },
      ]);
    if (url === '/api/v1/contacts')
      return Response.json([
        {
          id: 'fictional-contact',
          name: 'Fiktive Kontaktperson',
          state: 'active',
        },
      ]);
    return Response.json([]);
  });
}
async function findRow(name: RegExp = /Fiktive Hochzeit/) {
  return screen.findByRole('link', { name });
}
function cardOf(link: HTMLElement) {
  const card = link.closest('li');
  expect(card, 'the open action sits in its list card').not.toBeNull();
  return card as HTMLElement;
}
// The reading order of the shipped markup, not just the presence of parts.
function expectOrder(container: Element, selectors: string[]) {
  const nodes = selectors.map((selector) => {
    const node = container.querySelector(selector);
    expect(node, `card part ${selector}`).not.toBeNull();
    return node!;
  });
  for (let index = 1; index < nodes.length; index += 1)
    expect(
      Boolean(
        nodes[index - 1]!.compareDocumentPosition(nodes[index]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      `${selectors[index - 1]} comes before ${selectors[index]}`,
    ).toBe(true);
}
// jsdom does not evaluate the cascade, so the shipped rules are read and
// asserted instead of faking a layout.
const css = readFileSync(
  resolve(process.cwd(), 'apps/admin/src/styles.css'),
  'utf8',
);
function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(
    css,
  );
  expect(match, `stylesheet rule for ${selector}`).not.toBeNull();
  return match![1]!;
}
function rem(declarations: string, property: string) {
  return Number(
    new RegExp(`${property}\\s*:\\s*([\\d.]+)rem`).exec(declarations)?.[1],
  );
}
test('a card keeps date, status, type, title and place in that reading order', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  const link = await findRow();
  expect(link.getAttribute('href')).toBe('#event-fictional-timed');
  expectOrder(link, [
    '.event-date',
    '.event-status',
    '.event-type',
    '.event-title',
    '.event-place',
  ]);
  // Date column: the day number is the dominant element, weekday and short
  // month stay small beside it.
  expect(link.querySelector('.event-date-day')?.textContent).toBe('24');
  expect(link.querySelector('.event-date-label')?.textContent).toBe('Sa / Okt');
  expectOrder(link, ['.event-date-day', '.event-date-label']);
  expect(rem(rule('.event-date-day'), 'font-size')).toBeGreaterThan(
    rem(rule('.event-date-label'), 'font-size'),
  );
  expect(
    Number(/font-weight\s*:\s*(\d+)/.exec(rule('.event-date-day'))?.[1]),
  ).toBe(700);
  // Status: a visible marker plus the written name, never colour alone.
  const marker = link.querySelector('.event-status-mark');
  expect(marker?.getAttribute('aria-hidden')).toBe('true');
  expect(link.querySelector('.event-status')?.textContent?.trim()).toBe(
    'Gebucht',
  );
  // Type above the title, the title complete and the effective place below it.
  expect(link.querySelector('.event-type')?.textContent).toBe('Hochzeit');
  expect(link.querySelector('.event-title')?.textContent).toBe(
    'Fiktive Hochzeit mit einem sehr langen Titel ohne Kürzung',
  );
  expect(link.querySelector('.event-place')?.textContent).toBe(
    'Fiktive Scheune am See',
  );
  // The time stays on the meta line, not inside the title chain.
  expect(link.querySelector('.event-meta')?.textContent).toContain(
    '18:00–23:30 Uhr',
  );
  expect(link.querySelector('.event-title')?.textContent).not.toContain(
    '18:00',
  );
  expect(link.querySelector('.event-meta')?.textContent).toContain(
    'Fiktive Kontaktperson',
  );
});
test('a row has exactly one primary link and no nested button', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  const link = await findRow();
  const card = cardOf(link);
  expect(card.querySelectorAll('a')).toHaveLength(1);
  expect(link.querySelector('button')).toBeNull();
  expect(link.querySelector('input, select, textarea')).toBeNull();
  const edit = screen.getByRole('button', {
    name: 'Event bearbeiten: Fiktive Hochzeit mit einem sehr langen Titel ohne Kürzung',
  });
  const duplicate = screen.getByRole('button', {
    name: 'Event duplizieren: Fiktive Hochzeit mit einem sehr langen Titel ohne Kürzung',
  });
  for (const action of [edit, duplicate]) {
    expect(card.contains(action)).toBe(true);
    expect(action.closest('a')).toBeNull();
    expect(action.getAttribute('class')).toContain('tier-quiet-icon');
  }
  // The open action names itself; the whole card is the one target.
  expect(link.textContent?.startsWith('Öffnen: ')).toBe(true);
});
test('the month heading keeps its visible count above the cards', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  await findRow();
  const october = screen.getByRole('heading', { name: /Oktober 2026/ });
  expect(october.textContent).toContain('· 2 Events');
  const undated = screen.getByRole('heading', { name: /^Ohne Datum/ });
  expect(undated.textContent).toContain('· 1 Event');
  // Cards live in the section their heading names.
  expect(
    october.closest('section')?.querySelectorAll('.event-list > li.event-card'),
  ).toHaveLength(2);
});
test('no technical resource instruction sits in a row', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  const card = cardOf(await findRow());
  expect(card.textContent).not.toContain(
    'Ressourcen in den Event-Details prüfen',
  );
  expect(document.querySelector('.event-resource-hint')).toBeNull();
  expect(document.body.textContent).not.toContain(
    'Ressourcen in den Event-Details prüfen',
  );
});
test('an undated card states the gap instead of inventing a date', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  const card = cardOf(await findRow(/Fiktive Anfrage ohne Termin/));
  expect(card.querySelector('.event-date-day')?.textContent).toBe('–');
  expect(card.querySelector('.event-date-label')?.textContent).toBe(
    'ohne Datum',
  );
  expect(card.textContent).not.toMatch(/\d{2}:\d{2}/);
  expect(card.querySelector('.event-type')?.textContent).toBe('Art offen');
  expect(card.querySelector('.event-place')?.textContent).toBe('Ort offen');
  expect(
    screen.getByRole('heading', { name: /^Ohne Datum/ }).closest('section'),
  ).toBe(card.closest('section'));
});
test('a date-only card keeps the existing honest wording', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  const card = cardOf(await findRow(/Fiktive Tagesbuchung/));
  expect(card.querySelector('.event-meta')?.textContent).toContain(
    'Tagesbuchung, ohne Uhrzeit',
  );
  expect(card.textContent).not.toMatch(/00:00/);
  expect(card.querySelector('.event-type')?.textContent).toBe('Art offen');
});
test('the shipped title rule wraps instead of clipping', () => {
  const title = rule('.event-title');
  expect(title).not.toMatch(/text-overflow/);
  expect(title).not.toMatch(/line-clamp|overflow\s*:\s*hidden/);
  expect(title).toMatch(/white-space\s*:\s*normal/);
  expect(title).toMatch(/overflow-wrap\s*:\s*anywhere/);
  for (const match of css.matchAll(/[^}]*\.event-title[^{]*\{([^}]*)\}/g))
    expect(match[1]).not.toMatch(/text-overflow\s*:\s*ellipsis/);
});
test('an open end names the start without inventing an end', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<EventPanel csrfToken="csrf" />);
  const card = cardOf(await findRow(/Fiktiver Beginn ohne Ende/));
  expect(card.querySelector('.event-time')?.textContent).toBe('ab 18:00 Uhr');
  expect(card.textContent).not.toMatch(/–.*Uhr/);
});
test('an empty answer still says so instead of rendering a bare frame', async () => {
  vi.stubGlobal('fetch', fetcher([]));
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText('Keine Events gefunden.');
  expect(document.querySelector('.event-card')).toBeNull();
});
// BKP014.2: the card also names the physical units the event holds, as the
// server projected them. The text only repeats stored facts: a lapsed hold and
// an archived unit are marked, an overlap is named, nothing claims availability.
type ProjectedUnit = {
  unitId: string;
  name: string;
  code: string;
  ordinal: number;
  state: 'hold' | 'booked';
  stale: boolean;
  unitEnabled: boolean;
  resourceState: string;
  resourceBlocked: boolean;
  conflict: boolean;
};
function projectedUnit(overrides: Partial<ProjectedUnit> = {}): ProjectedUnit {
  return {
    unitId: 'fictional-unit-1',
    name: 'FB9',
    code: 'FB9',
    ordinal: 1,
    state: 'booked',
    stale: false,
    unitEnabled: true,
    resourceState: 'active',
    resourceBlocked: false,
    conflict: false,
    ...overrides,
  };
}
function projected(units: ProjectedUnit[], conflict = false) {
  return {
    units,
    assigned: units.filter((unit) => !unit.stale).length,
    booked: units.filter((unit) => !unit.stale && unit.state === 'booked')
      .length,
    hold: units.filter((unit) => !unit.stale && unit.state === 'hold').length,
    conflict,
  };
}
const resourceRow = (id: string, name: string, resources?: unknown) => ({
  ...base,
  id,
  name,
  status: 'booked',
  eventTypeId: null,
  eventDate: '2026-12-01',
  startsAt: null,
  endsAt: null,
  resources,
});
async function resourceText(
  rowsToServe: Record<string, unknown>[],
  name: RegExp,
) {
  cleanup();
  vi.stubGlobal('fetch', fetcher(rowsToServe));
  render(<EventPanel csrfToken="csrf" />);
  const card = cardOf(await screen.findByRole('link', { name }));
  return card.querySelector('.event-resources')?.textContent ?? '';
}
test('a card names its assigned unit and otherwise says there is none', async () => {
  const rowsToServe = [
    resourceRow(
      'fictional-no-unit',
      'Fiktives Event ohne Einheit',
      projected([]),
    ),
    resourceRow(
      'fictional-one-box',
      'Fiktives Event mit Box',
      projected([projectedUnit()]),
    ),
    // A payload from before this projection stays an honest empty answer.
    resourceRow('fictional-no-projection', 'Fiktives Event ohne Projektion'),
  ];
  expect(await resourceText(rowsToServe, /Fiktives Event ohne Einheit/)).toBe(
    'Noch keine Ressource',
  );
  expect(
    await resourceText(rowsToServe, /Fiktives Event ohne Projektion/),
  ).toBe('Noch keine Ressource');
  cleanup();
  vi.stubGlobal('fetch', fetcher(rowsToServe));
  render(<EventPanel csrfToken="csrf" />);
  const card = cardOf(
    await screen.findByRole('link', { name: /Fiktives Event mit Box/ }),
  );
  // The resource line belongs to the meta block, below the place, and stays
  // plain text: no second link, no new column.
  const resources = card.querySelector('.event-resources');
  expect(resources?.textContent).toBe('FB9 · Einheit 1 · Gebucht');
  expect(resources?.closest('.event-meta')).not.toBeNull();
  expectOrder(card, ['.event-place', '.event-resources']);
  expect(resources?.querySelector('a, button')).toBeNull();
});
test('a card with two units names both in the plan order', async () => {
  const text = await resourceText(
    [
      resourceRow(
        'fictional-two-units',
        'Fiktives Event mit zwei Einheiten',
        projected([
          projectedUnit({ unitId: 'unit-a', ordinal: 2 }),
          projectedUnit({
            unitId: 'unit-b',
            name: 'LAMP9',
            code: 'LAMP9',
            state: 'hold',
          }),
        ]),
      ),
    ],
    /Fiktives Event mit zwei Einheiten/,
  );
  expect(text).toBe(
    'FB9 · Einheit 2 · Gebucht, LAMP9 · Einheit 1 · Vormerkung',
  );
});
test('a lapsed hold and an archived unit are marked instead of reading current', async () => {
  expect(
    await resourceText(
      [
        resourceRow(
          'fictional-stale',
          'Fiktives Event mit abgelaufener Vormerkung',
          projected([
            projectedUnit({
              state: 'hold',
              stale: true,
              name: 'LAMP9',
              code: 'LAMP9',
            }),
          ]),
        ),
      ],
      /Fiktives Event mit abgelaufener Vormerkung/,
    ),
  ).toBe('LAMP9 · Einheit 1 · Vormerkung (abgelaufen)');
  cleanup();
  expect(
    await resourceText(
      [
        resourceRow(
          'fictional-archived',
          'Fiktives Event auf archivierter Einheit',
          projected([
            projectedUnit({ unitEnabled: false, resourceState: 'archived' }),
          ]),
        ),
      ],
      /Fiktives Event auf archivierter Einheit/,
    ),
  ).toBe('FB9 · Einheit 1 · Gebucht (archiviert)');
});
test('an overlap is named only where the answer reports one', async () => {
  expect(
    await resourceText(
      [
        resourceRow(
          'fictional-overlap',
          'Fiktives Event mit Ueberschneidung',
          projected([projectedUnit({ conflict: true })], true),
        ),
      ],
      /Fiktives Event mit Ueberschneidung/,
    ),
  ).toBe('FB9 · Einheit 1 · Gebucht · Überschneidung offen');
  cleanup();
  expect(
    await resourceText(
      [
        resourceRow(
          'fictional-clear',
          'Fiktives Event ohne Konflikt',
          projected([projectedUnit()]),
        ),
      ],
      /Fiktives Event ohne Konflikt/,
    ),
  ).toBe('FB9 · Einheit 1 · Gebucht');
});
