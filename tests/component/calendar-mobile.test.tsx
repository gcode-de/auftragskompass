import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalendarPanel } from '../../apps/admin/src/CalendarPanel.js';

// BKP008: the narrow month grid must stay a real Mo–So grid with a short day
// number and a compact event summary, and the selected day must reveal a
// complete, readable agenda below the grid. jsdom has no layout engine, so
// these tests pin the DOM/semantics; Chromium proves the 320/390 geometry,
// wrapping and focus ring in calendar-mobile.spec.ts.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const LONG_NAME =
  'Fiktive Feier mit außergewöhnlich langem Namen für die Prüfung des Zeilenumbruchs';

type FixtureEvent = {
  id: string;
  name: string;
  status: string;
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  eventType: string | null;
  contact: string | null;
  location: string | null;
};

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayCount(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Synthetic month with every real day, like the API returns: no padding days,
// no invented times. Tenant zone is UTC so the rendered clock times are exact.
function month(year: number, month: number, selected: number) {
  const days = Array.from({ length: dayCount(year, month) }, (_, index) => {
    const date = isoDate(year, month, index + 1);
    const start = new Date(date + 'T00:00:00Z');
    return {
      date,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 86_400_000).toISOString(),
    };
  });
  const timed = (
    id: string,
    name: string,
    date: string,
    from: number,
    to: number,
    status: string,
    location: string | null = null,
  ): FixtureEvent => ({
    id,
    name,
    status,
    eventDate: date,
    startsAt: `${date}T${String(from).padStart(2, '0')}:00:00.000Z`,
    endsAt: `${date}T${String(to).padStart(2, '0')}:00:00.000Z`,
    eventType: 'Fiktive Art',
    contact: 'Fiktiver Kontakt',
    location,
  });
  const events: FixtureEvent[] = [
    // One date-only booking with the long name on day 2.
    {
      id: 'fictional-long',
      name: LONG_NAME,
      status: 'option',
      eventDate: isoDate(year, month, 2),
      startsAt: null,
      endsAt: null,
      eventType: 'Fiktive Art',
      contact: 'Fiktiver Kontakt',
      location: 'Fiktiver Ort',
    },
    // Five bookings on day 3, mixing statuses and one venue.
    timed(
      'fictional-3a',
      'Fiktives Event drei A',
      isoDate(year, month, 3),
      8,
      10,
      'booked',
      'Festsaal',
    ),
    timed(
      'fictional-3b',
      'Fiktives Event drei B',
      isoDate(year, month, 3),
      10,
      12,
      'booked',
    ),
    timed(
      'fictional-3c',
      'Fiktives Event drei C',
      isoDate(year, month, 3),
      12,
      14,
      'option',
    ),
    timed(
      'fictional-3d',
      'Fiktives Event drei D',
      isoDate(year, month, 3),
      14,
      16,
      'option',
    ),
    timed(
      'fictional-3e',
      'Fiktives Event drei E',
      isoDate(year, month, 3),
      16,
      18,
      'blocked',
    ),
    // One overnight booking that occupies two days.
    {
      id: 'fictional-overnight',
      name: 'Fiktive Übernachtung',
      status: 'booked',
      eventDate: isoDate(year, month, 4),
      startsAt: isoDate(year, month, 4) + 'T20:00:00.000Z',
      endsAt: isoDate(year, month, 5) + 'T04:00:00.000Z',
      eventType: 'Fiktive Art',
      contact: null,
      location: null,
    },
  ];
  return {
    pendingPromises: 0,
    date: isoDate(year, month, selected),
    view: 'month',
    timeZone: 'UTC',
    from: isoDate(year, month, 1),
    to: isoDate(year, month, dayCount(year, month)),
    previousDate: null,
    nextDate: null,
    days,
    events,
    units: [
      {
        id: 'fictional-unit',
        name: 'Fiktive Box',
        code: 'FICT',
        ordinal: 1,
        enabled: true,
        blocked: false,
      },
    ],
    reservations: [],
  };
}

function stub(value: unknown) {
  const fetcher = vi.fn(() => Promise.resolve(Response.json(value)));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

async function renderMonth(value: ReturnType<typeof month>) {
  stub(value);
  render(<CalendarPanel />);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-day')).toHaveLength(
      value.days.length,
    ),
  );
}

function cell(date: string) {
  return document.querySelector<HTMLElement>(
    `.calendar-day:has(time[datetime="${date}"])`,
  )!;
}

const today = new Date().toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));
const monthNumber = Number(today.slice(5, 7));

test('the narrow month grid keeps one short day number per cell', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const numbers = Array.from(
    document.querySelectorAll('.calendar-day time'),
  ).map((node) => node.textContent);
  // One line, digits only — never "Do., 01.10." in every 40-px cell.
  expect(numbers).toEqual(
    Array.from({ length: value.days.length }, (_, index) => String(index + 1)),
  );
  for (const node of Array.from(
    document.querySelectorAll('.calendar-day time'),
  ))
    expect(node.textContent!.length).toBeLessThanOrEqual(2);
  // The real month stays complete: no hidden empty day, no invented cell.
  expect(document.querySelectorAll('.calendar-day')).toHaveLength(
    value.days.length,
  );
  expect(
    document.querySelectorAll('.calendar-day[aria-hidden="true"]'),
  ).toHaveLength(0);
});

test('today and the selected day stay distinguishable without a green area', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const todayCells = document.querySelectorAll(
    '.calendar-day[data-today="true"]',
  );
  expect(todayCells).toHaveLength(1);
  expect(cell(today).dataset.today).toBe('true');
  const todayButton = todayCells[0]!.querySelector('button')!;
  expect(todayButton.getAttribute('aria-current')).toBe('date');
  expect(todayButton.getAttribute('aria-pressed')).toBe('false');
  // Today carries a word plus a border, not just a colour.
  expect(todayCells[0]!.querySelector('.calendar-day-today')!.textContent).toBe(
    'Heute',
  );
  const selected = document.querySelectorAll(
    '.calendar-day[data-selected="true"]',
  );
  expect(selected).toHaveLength(1);
  expect(selected[0]!.querySelector('time')!.getAttribute('datetime')).toBe(
    value.date,
  );
  expect(
    selected[0]!.querySelector('button')!.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(cell(value.date).dataset.selected).toBe('true');
  expect(cell(today).dataset.selected).toBe('false');
});

test('the day name starts with the words the cell visibly shows', async () => {
  // WCAG 2.5.3 / axe `label-content-name-mismatch`: the accessible name must
  // contain the visible label. The cell shows "3 5", so the name starts there.
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-zäöüß0-9]+/g, ' ')
      .trim();
  const day = cell(isoDate(year, monthNumber, 3));
  const label = day.querySelector('button')!.getAttribute('aria-label')!;
  const visible = Array.from(
    day.querySelectorAll('button > time, button > span'),
  )
    .map((node) => node.textContent!.trim())
    .filter(Boolean)
    .join(' ');
  expect(visible).toBe('3 5');
  expect(normalize(label).startsWith(normalize(visible))).toBe(true);
  // Same rule for the today cell: number, then the word "Heute".
  const todayCell = document.querySelector('.calendar-day[data-today="true"]')!;
  expect(
    normalize(todayCell.querySelector('button')!.getAttribute('aria-label')!),
  ).toMatch(/^\d{1,2} heute /);
});

test('each day shows a compact event summary with a visible count', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const five = cell(isoDate(year, monthNumber, 3));
  expect(five.querySelector('.calendar-day-count')!.textContent).toBe('5');
  expect(five.querySelector('button')!.getAttribute('aria-label')).toContain(
    '5 Events',
  );
  // Status stays a named indicator, not colour alone.
  expect(five.querySelector('button')!.getAttribute('aria-label')).toContain(
    'Gebucht',
  );
  expect(five.querySelectorAll('.calendar-day-mark').length).toBeGreaterThan(0);
  const empty = cell(isoDate(year, monthNumber, 1));
  expect(empty.querySelector('.calendar-day-count')).toBeNull();
  expect(empty.querySelector('button')!.getAttribute('aria-label')).toContain(
    'keine Events',
  );
  const single = cell(isoDate(year, monthNumber, 2));
  expect(single.querySelector('button')!.getAttribute('aria-label')).toContain(
    '1 Event',
  );
});

test('selecting a day reveals the complete agenda below the grid', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const five = cell(isoDate(year, monthNumber, 3));
  const agendaBefore = document.querySelectorAll(
    '.calendar-agenda-item',
  ).length;
  fireEvent.click(five.querySelector('button')!);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-agenda-item')).toHaveLength(5),
  );
  expect(agendaBefore).not.toBe(5);
  expect(cell(isoDate(year, monthNumber, 3)).dataset.selected).toBe('true');
  // Full title, time, venue/status and a reachable link — no hover-only data.
  const titleLinks = screen.getAllByRole('link', {
    name: 'Fiktives Event drei A',
  });
  expect(titleLinks.length).toBeGreaterThan(0);
  for (const link of titleLinks)
    expect(link.getAttribute('href')).toBe('#event-fictional-3a');
  expect(document.body.textContent).toContain('08:00 Uhr – 10:00 Uhr');
  expect(document.body.textContent).toContain('Festsaal');
  expect(document.body.textContent).toContain('Gebucht');
  for (const link of Array.from(
    document.querySelectorAll<HTMLAnchorElement>('.calendar-agenda a'),
  ))
    expect(link.getAttribute('href')).toMatch(/^#event-fictional-3/);
});

test('a long fictional name wraps in the agenda instead of being cut', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  fireEvent.click(cell(isoDate(year, monthNumber, 2)).querySelector('button')!);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-agenda-item')).toHaveLength(1),
  );
  const link = document.querySelector<HTMLAnchorElement>(
    '.calendar-agenda-title a',
  )!;
  expect(link.textContent).toBe(LONG_NAME);
  expect(link.getAttribute('title')).toBeNull();
  expect(
    link
      .closest('.calendar-agenda-item')!
      .querySelector('.calendar-agenda-time')!.textContent,
  ).toBe('Tagesbuchung, ohne Uhrzeit');
});

test('a day without events says so explicitly', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  fireEvent.click(cell(isoDate(year, monthNumber, 1)).querySelector('button')!);
  await vi.waitFor(() =>
    expect(screen.getByText('Keine Events an diesem Tag.')).toBeTruthy(),
  );
  expect(
    screen.getByText('Keine Events an diesem Tag.').closest('.calendar-agenda'),
  ).not.toBeNull();
});

test('every event of the day is reachable, in the cell and in the agenda', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  fireEvent.click(cell(isoDate(year, monthNumber, 3)).querySelector('button')!);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-agenda-item')).toHaveLength(5),
  );
  // Each of the five events has a full agenda entry with the same target as
  // the month cell, so nothing is discoverable only by hover or by clipped
  // cell text.
  for (const name of [
    'Fiktives Event drei A',
    'Fiktives Event drei B',
    'Fiktives Event drei C',
    'Fiktives Event drei D',
    'Fiktives Event drei E',
  ]) {
    const links = screen.getAllByRole('link', { name });
    expect(links.length).toBeGreaterThan(0);
    expect(
      links.filter((link) => link.closest('.calendar-agenda')).length,
    ).toBe(1);
  }
  const chips = cell(isoDate(year, monthNumber, 3)).querySelectorAll(
    '.calendar-chip-link',
  );
  expect(chips).toHaveLength(5);
  for (const chip of Array.from(chips))
    expect(chip.getAttribute('href')).toMatch(/^#event-fictional-3/);
});

test('the keyboard moves the day selection and keeps the focus on the grid', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const start = cell(isoDate(year, monthNumber, 3)).querySelector('button')!;
  start.focus();
  expect(document.activeElement).toBe(start);
  fireEvent.keyDown(start, { key: 'ArrowRight' });
  const nextDate = isoDate(year, monthNumber, 4);
  await vi.waitFor(() =>
    expect(document.querySelector(`#calendar-day-${nextDate}`)).toBe(
      document.activeElement,
    ),
  );
  expect(cell(nextDate).dataset.selected).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  const weekLater = isoDate(year, monthNumber, 11);
  await vi.waitFor(() =>
    expect(document.querySelector(`#calendar-day-${weekLater}`)).toBe(
      document.activeElement,
    ),
  );
  expect(cell(weekLater).dataset.selected).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  await vi.waitFor(() =>
    expect(document.querySelector(`#calendar-day-${nextDate}`)).toBe(
      document.activeElement,
    ),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  const day3 = `#calendar-day-${isoDate(year, monthNumber, 3)}`;
  await vi.waitFor(() =>
    expect(document.querySelector(day3)).toBe(document.activeElement),
  );
  // A step beyond the rendered range is a no-op instead of a lost focus.
  fireEvent.keyDown(document.querySelector(day3)!, { key: 'ArrowUp' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(document.querySelector(day3)).toBe(document.activeElement);
  expect(cell(isoDate(year, monthNumber, 3)).dataset.selected).toBe('true');
  // One tab stop in the grid; every other day stays reachable by cursor keys.
  expect(
    document.querySelectorAll('.calendar-day-button[tabindex="0"]'),
  ).toHaveLength(1);
});

test('an unknown stored status keeps its mark and its own name', async () => {
  const value = month(year, monthNumber, 10);
  value.events = [
    ...value.events,
    {
      id: 'fictional-unknown',
      name: 'Fiktives Event mit unbekanntem Status',
      status: 'pending_review',
      eventDate: isoDate(year, monthNumber, 6),
      startsAt: null,
      endsAt: null,
      eventType: null,
      contact: null,
      location: null,
    },
  ];
  await renderMonth(value);
  const day = cell(isoDate(year, monthNumber, 6));
  expect(day.querySelector('button')!.getAttribute('aria-label')).toContain(
    'pending_review',
  );
  expect(day.querySelectorAll('.calendar-day-mark')).toHaveLength(1);
  // One event gets no count: the status mark alone names it.
  expect(day.querySelector('.calendar-day-count')).toBeNull();
});

test('a selected date outside the rendered days keeps its bookings reachable', async () => {
  const value = month(year, monthNumber, 10);
  value.days = value.days.slice(5, 8);
  value.date = isoDate(year, monthNumber, 3);
  await renderMonth(value);
  // The agenda still names the day and its stored bookings instead of
  // pretending the day is empty.
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-agenda-item')).toHaveLength(5),
  );
  expect(
    document.querySelector('.calendar-agenda-head h4')!.textContent,
  ).toContain('3.');
  expect(document.querySelector('.calendar-agenda-empty')).toBeNull();
  // And the grid keeps exactly one keyboard entry point.
  expect(
    document.querySelectorAll('.calendar-day-button[tabindex="0"]'),
  ).toHaveLength(1);
});

test('the multi-day booking keeps its original interval on every agenda day', async () => {
  const value = month(year, monthNumber, 10);
  await renderMonth(value);
  const monthName = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  fireEvent.click(cell(isoDate(year, monthNumber, 5)).querySelector('button')!);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-agenda-item')).toHaveLength(1),
  );
  const notes = Array.from(
    document.querySelectorAll('.calendar-agenda-time'),
  ).map((node) => node.textContent);
  // The later agenda day shows the stored interval, not a re-dated start.
  expect(notes).toEqual([
    `4. ${monthName} ${year} 20:00 Uhr – 5. ${monthName} ${year} 04:00 Uhr`,
  ]);
  fireEvent.click(cell(isoDate(year, monthNumber, 4)).querySelector('button')!);
  await vi.waitFor(() =>
    expect(document.querySelector('.calendar-agenda-time')!.textContent).toBe(
      notes[0],
    ),
  );
});

test('a DST day keeps its local start time and its own day', async () => {
  // 30 March 2031 is the Berlin spring-forward day: 02:00 local does not
  // exist, so an interval over it must keep the stored local times.
  const value = month(2031, 3, 30);
  value.timeZone = 'Europe/Berlin';
  value.events = [
    {
      id: 'fictional-dst',
      name: 'Fiktive Nacht über die Zeitumstellung',
      status: 'booked',
      eventDate: '2031-03-30',
      startsAt: '2031-03-29T23:30:00.000Z',
      endsAt: '2031-03-30T03:30:00.000Z',
      eventType: 'Fiktive Art',
      contact: null,
      location: 'Fiktiver Ort',
    },
  ];
  await renderMonth(value);
  fireEvent.click(cell('2031-03-30').querySelector('button')!);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-agenda-item')).toHaveLength(1),
  );
  expect(document.querySelector('.calendar-agenda-time')!.textContent).toBe(
    '00:30 Uhr – 05:30 Uhr',
  );
  expect(cell('2031-03-29').querySelector('.calendar-day-count')).toBeNull();
});
