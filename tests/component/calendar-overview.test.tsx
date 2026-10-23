import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalendarPanel } from '../../apps/admin/src/CalendarPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const event = (
  overrides: Partial<{
    id: string;
    name: string;
    value: string;
    eventDate: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }> = {},
) => ({
  id: 'synthetic-date-only',
  name: 'Fictional day booking',
  status: 'option',
  eventDate: '2030-10-26' as string | null,
  startsAt: null as string | null,
  endsAt: null as string | null,
  eventType: 'Fictional type',
  contact: 'Fictional contact',
  location: 'Fictional venue',
  ...overrides,
});
const fixture = (overrides: Record<string, unknown> = {}) => ({
  pendingPromises: 0,
  date: '2030-10-26',
  view: 'month',
  timeZone: 'Europe/Berlin',
  from: '2030-10-01',
  to: '2030-10-31',
  previousDate: '2030-09-26',
  nextDate: '2030-11-26',
  days: [
    {
      date: '2030-10-26',
      startsAt: '2030-10-25T22:00:00Z',
      endsAt: '2030-10-26T23:00:00Z',
    },
    {
      date: '2030-10-27',
      startsAt: '2030-10-26T22:00:00Z',
      endsAt: '2030-10-27T23:00:00Z',
    },
    {
      date: '2030-10-28',
      startsAt: '2030-10-27T23:00:00Z',
      endsAt: '2030-10-28T23:00:00Z',
    },
  ],
  events: [event()],
  units: [
    {
      id: 'synthetic-unit',
      name: 'Fictional box',
      code: 'SYNTH',
      ordinal: 1,
      enabled: true,
      blocked: false,
    },
  ],
  reservations: [],
  ...overrides,
});
function stub(value: unknown) {
  const fetcher = vi.fn((input: RequestInfo | URL) => {
    void input;
    return Promise.resolve(Response.json(value));
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function findRange(title: string) {
  await vi.waitFor(() => {
    const group = screen.getByRole('group', { name: 'Kalenderzeitraum' });
    expect(group.textContent).toContain(title);
  });
  const group = screen.getByRole('group', { name: 'Kalenderzeitraum' });
  return group;
}
function calendarCalls(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(([url]) =>
    String(url).startsWith('/api/v1/calendar'),
  ).length;
}
test('without a saved choice the calendar opens in month view', async () => {
  const fetcher = stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  expect(
    (screen.getByLabelText('Kalenderansicht') as HTMLSelectElement).value,
  ).toBe('month');
  expect(fetcher.mock.calls[0]![0]).toContain('view=month');
  expect(
    screen.getByRole('group', { name: 'Kalenderzeitraum' }).textContent,
  ).toContain('1.–31. Oktober 2030');
});

test('an explicit URL view is respected instead of the month default', async () => {
  window.history.replaceState(null, '', '/?view=week');
  const fetcher = stub(
    fixture({
      view: 'week',
      date: '2030-10-27',
      from: '2030-10-26',
      to: '2030-11-01',
    }),
  );
  render(<CalendarPanel />);
  await findRange('Woche 43');
  expect(
    (screen.getByLabelText('Kalenderansicht') as HTMLSelectElement).value,
  ).toBe('week');
  expect(fetcher.mock.calls[0]![0]).toContain('view=week');
  expect(
    screen.getByRole('group', { name: 'Kalenderzeitraum' }).textContent,
  ).toContain('26. Oktober 2030 – 1. November 2030');
});

test('a user-chosen view survives collapsing the calendar away and back', async () => {
  // The panel stays mounted behind `hidden` when the user switches areas, so
  // the chosen view must still win over the month default on return.
  const fetcher = stub(fixture());
  const { rerender } = render(
    <div>
      <CalendarPanel />
    </div>,
  );
  await findRange('Oktober 2030');
  fetcher.mockImplementation(async () =>
    Response.json(
      fixture({ view: 'day', from: '2030-10-26', to: '2030-10-26' }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Kalenderansicht'), {
    target: { value: 'day' },
  });
  await findRange('26. Oktober 2030');
  fireEvent.change(screen.getByLabelText('Kalenderdatum'), {
    target: { value: '2030-10-28' },
  });
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).toContain('date=2030-10-28'),
  );
  rerender(
    <div hidden>
      <CalendarPanel />
    </div>,
  );
  rerender(
    <div>
      <CalendarPanel />
    </div>,
  );
  await findRange('26. Oktober 2030');
  expect(
    (screen.getByLabelText('Kalenderansicht') as HTMLSelectElement).value,
  ).toBe('day');
  expect(
    (screen.getByLabelText('Kalenderdatum') as HTMLInputElement).value,
  ).toBe('2030-10-28');
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes('view=month')),
  ).toHaveLength(1);
});

test('one navigation row carries previous, today, next and the visible range', async () => {
  const fetcher = stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  const today = screen.getByRole('button', { name: 'Heute im Kalender' });
  const previous = screen.getByRole('button', { name: 'Vorheriger Zeitraum' });
  const next = screen.getByRole('button', { name: 'Nächster Zeitraum' });
  for (const control of [previous, today, next]) {
    expect(control.getAttribute('title')).toBeTruthy();
    expect(control.closest('fieldset')).toBeNull();
    expect(control.parentElement).toBe(today.parentElement);
  }
  expect(screen.getByLabelText('Kalenderansicht')).toBeTruthy();
  expect(
    screen.getByRole('group', { name: 'Kalenderzeitraum' }).textContent,
  ).toContain('1.–31. Oktober 2030');
  fireEvent.click(next);
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).toContain('date=2030-11-26'),
  );
  fireEvent.click(previous);
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).toContain('date=2030-09-26'),
  );
  fireEvent.click(today);
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).not.toContain('date='),
  );
});

test('date-only events say so without a synthetic 00:00 time', async () => {
  stub(
    fixture({
      events: [
        event(),
        event({
          id: 'synthetic-midnight',
          name: 'Fictional midnight event',
          eventDate: '2030-10-28',
          startsAt: '2030-10-27T23:00:00Z',
          endsAt: '2030-10-28T04:00:00Z',
        }),
      ],
    }),
  );
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  await vi.waitFor(() =>
    expect(
      Array.from(document.querySelectorAll('.calendar-note')).map(
        (node) => node.textContent,
      ),
    ).toContain('00:00 Uhr – 05:00 Uhr'),
  );
  expect(
    screen.getAllByText(/Tagesbuchung, ohne Uhrzeit/).length,
  ).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(/Tagesbuchung[^]{0,40}00:00/);
});

test('the resource occupancy is a collapsed, accessible secondary disclosure', async () => {
  const fetcher = stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  const summary = screen.getByText('Ressourcenbelegung', {
    selector: 'summary',
  });
  const details = summary.closest('details')!;
  expect(details.open).toBe(false);
  // Native disclosure: the content stays mounted and the browser hides it
  // while closed. jsdom has no layout engine for `details`, so the closed
  // state itself is asserted here; Chromium proves the real visibility.
  expect(details.querySelector('table')).not.toBeNull();
  const before = calendarCalls(fetcher);
  fireEvent.click(summary);
  await vi.waitFor(() => expect(details.open).toBe(true));
  summary.focus();
  fireEvent.click(summary);
  await vi.waitFor(() => expect(details.open).toBe(false));
  expect(document.activeElement).toBe(summary);
  expect(details.querySelector('table')).not.toBeNull();
  fireEvent.click(summary);
  await vi.waitFor(() => expect(details.open).toBe(true));
  expect(calendarCalls(fetcher)).toBe(before);
  expect(
    (screen.getByLabelText('Kalenderdatum') as HTMLInputElement).value,
  ).toBe('2030-10-26');
});

test('critical warnings stay outside the collapsed resource disclosure', async () => {
  stub(fixture({ pendingPromises: 2 }));
  render(<CalendarPanel />);
  const warning = await screen.findByRole('alert');
  expect(warning.textContent).toContain('2 ungeprüfte Bestandszusagen');
  expect(warning.closest('details')).toBeNull();
  expect(screen.getAllByText('Bestand ungeprüft').length).toBeGreaterThan(0);
});

test('a failed reload stays visible while the occupancy is collapsed', async () => {
  const fetcher = stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  fetcher.mockImplementation(async () => new Response(null, { status: 500 }));
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
  const alert = await screen.findByText(/Kalender konnte nicht geladen/);
  expect(alert.closest('details')).toBeNull();
});

test('a calendar event link opens its own details and does not bubble', async () => {
  stub(fixture());
  render(<CalendarPanel />);
  // BKP008: the same event is a month-cell chip and a day-agenda entry, and
  // both must open exactly its own record.
  const links = await screen.findAllByRole('link', {
    name: 'Fictional day booking',
  });
  expect(links.length).toBeGreaterThan(0);
  for (const link of links)
    expect(link.getAttribute('href')).toBe('#event-synthetic-date-only');
});

test('a programmatic details.open reveals the occupancy without a toggle event', async () => {
  stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  const details = screen
    .getByText('Ressourcenbelegung', { selector: 'summary' })
    .closest('details')!;
  // Assistive/automation code may set `open` directly. Since the disclosure is
  // a native uncontrolled element, the content is revealed by the browser
  // without React state or a toggle handler.
  details.open = true;
  expect(details.open).toBe(true);
  expect(details.querySelector('table')!.closest('details')).toBe(details);
  details.open = false;
  expect(details.open).toBe(false);
});

test('the toolbar keeps its geometry and accessible names on narrow widths', async () => {
  stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  const toolbar = document.querySelector('.calendar-toolbar')!;
  for (const control of [
    'Vorheriger Zeitraum',
    'Heute im Kalender',
    'Nächster Zeitraum',
  ]) {
    const button = screen.getByRole('button', { name: control });
    expect(button.classList.contains('icon-action')).toBe(true);
    expect(button.getAttribute('title')).toBe(control);
    expect(button.textContent).toBe('');
    // The shipped CSS pins icon actions to 44px; jsdom has no layout engine,
    // so the rule itself is asserted instead of a fabricated measurement.
    expect(button.getAttribute('aria-label')).toBe(control);
  }
  expect(toolbar.querySelectorAll('.icon-action')).toHaveLength(3);
  expect(screen.getByLabelText('Kalenderansicht')).toBeTruthy();
  expect(screen.getByLabelText('Kalenderdatum')).toBeTruthy();
});

test('the month grid uses the loaded view for columns after a failed change', async () => {
  let fail = false;
  const fetcher = vi.fn((input: RequestInfo | URL) => {
    void input;
    return Promise.resolve(
      fail ? new Response(null, { status: 503 }) : Response.json(fixture()),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  const countGrid = () =>
    document.querySelector('.calendar-grid')!.children.length;
  // 3 fixture days + 5 leading pads (26 Oct 2030 is a Saturday) + weekday row.
  expect(countGrid()).toBe(3 + 5 + 1);
  expect(
    document.querySelector('.calendar-events')!.getAttribute('data-view'),
  ).toBe('month');
  fail = true;
  fireEvent.change(screen.getByLabelText('Kalenderansicht'), {
    target: { value: 'day' },
  });
  await screen.findByText(/Kalender konnte nicht geladen werden/);
  // The addressable/control state reflects the request honestly...
  expect(
    (screen.getByLabelText('Kalenderansicht') as HTMLSelectElement).value,
  ).toBe('day');
  // ...but the retained month data keeps its month grid and padding.
  expect(countGrid()).toBe(3 + 5 + 1);
  expect(
    document.querySelector('.calendar-events')!.getAttribute('data-view'),
  ).toBe('month');
  fail = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Kalender erneut laden' }),
  );
  await vi.waitFor(() =>
    expect(
      (screen.getByLabelText('Kalenderansicht') as HTMLSelectElement).value,
    ).toBe('day'),
  );
});

test('the month grid puts the weekday head before the leading pads and days', async () => {
  stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  const grid = document.querySelector('.calendar-grid')!;
  const children = Array.from(grid.children);
  // 26 Oct 2030 is a Saturday, so the Monday-based offset is five pads.
  const offset = (new Date('2030-10-26T12:00:00Z').getUTCDay() + 6) % 7;
  expect(offset).toBe(5);
  // DOM order matters, not the child count: a column-spanning head placed
  // after the pads starts a row of its own and shifts day 1 back to Monday.
  expect(children[0]!.className).toBe('calendar-weekday-head');
  expect(children[0]!.querySelectorAll('ol > li')).toHaveLength(7);
  expect(children[1]!.className).not.toBe('calendar-weekday-head');
  const pads = children.slice(1, 1 + offset);
  expect(pads).toHaveLength(offset);
  expect(
    pads.every(
      (node) =>
        node.tagName === 'LI' &&
        node.getAttribute('aria-hidden') === 'true' &&
        node.className === '',
    ),
  ).toBe(true);
  const days = children.slice(1 + offset);
  expect(days.map((node) => node.className)).toEqual([
    'calendar-day',
    'calendar-day',
    'calendar-day',
  ]);
  expect(
    days.map((node) => node.querySelector('time')!.getAttribute('datetime')),
  ).toEqual(['2030-10-26', '2030-10-27', '2030-10-28']);
  expect(
    children.filter((node) => node.className === 'calendar-weekday-head'),
  ).toHaveLength(1);
});

function monthGridOrder() {
  const children = Array.from(
    document.querySelector('.calendar-grid')!.children,
  );
  return {
    first: children[0]!.className,
    heads: children.filter((node) => node.className === 'calendar-weekday-head')
      .length,
    pads: children.filter(
      (node) =>
        node.tagName === 'LI' &&
        node.getAttribute('aria-hidden') === 'true' &&
        node.className === '',
    ).length,
    dayDates: children
      .filter((node) => node.className === 'calendar-day')
      .map((node) => node.querySelector('time')!.getAttribute('datetime')),
  };
}

function expectHeadBeforePadsAndDays() {
  const order = monthGridOrder();
  expect(order.first).toBe('calendar-weekday-head');
  expect(order.heads).toBe(1);
  // The Monday-based offset is derived from the first rendered day itself.
  expect(order.pads).toBe(
    (new Date(order.dayDates[0]! + 'T12:00:00Z').getUTCDay() + 6) % 7,
  );
  expect(order.dayDates).toHaveLength(3);
}

test('the weekday head stays first after range navigation and a view switch', async () => {
  const fetcher = stub(fixture());
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  await vi.waitFor(() =>
    expect(document.querySelector('time[datetime="2030-10-26"]')).toBeTruthy(),
  );
  expectHeadBeforePadsAndDays();
  // Next month: the grid is rebuilt from new data and keeps its order.
  fetcher.mockImplementation(async () =>
    Response.json(
      fixture({
        date: '2030-11-26',
        from: '2030-11-01',
        to: '2030-11-30',
        days: [26, 27, 28].map((day) => ({
          date: `2030-11-${day}`,
          startsAt: `2030-11-${day}T00:00:00.000Z`,
          endsAt: `2030-11-${day}T23:00:00.000Z`,
        })),
      }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Zeitraum' }));
  await vi.waitFor(() =>
    expect(document.querySelector('time[datetime="2030-11-26"]')).toBeTruthy(),
  );
  expectHeadBeforePadsAndDays();
  // And back again.
  fetcher.mockImplementation(async () => Response.json(fixture()));
  fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Zeitraum' }));
  await vi.waitFor(() =>
    expect(document.querySelector('time[datetime="2030-10-26"]')).toBeTruthy(),
  );
  expectHeadBeforePadsAndDays();
  // A week round trip renders the month grid again with the same order.
  fetcher.mockImplementation(async () =>
    Response.json(
      fixture({
        view: 'week',
        date: '2030-10-27',
        from: '2030-10-26',
        to: '2030-11-01',
      }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Kalenderansicht'), {
    target: { value: 'week' },
  });
  await vi.waitFor(() =>
    expect(
      document.querySelector('.calendar-events')!.getAttribute('data-view'),
    ).toBe('week'),
  );
  fetcher.mockImplementation(async () => Response.json(fixture()));
  fireEvent.change(screen.getByLabelText('Kalenderansicht'), {
    target: { value: 'month' },
  });
  await vi.waitFor(() =>
    expect(
      document.querySelector('.calendar-events')!.getAttribute('data-view'),
    ).toBe('month'),
  );
  expectHeadBeforePadsAndDays();
});

test('a multi-day booking is not re-dated to the later day cell', async () => {
  stub(
    fixture({
      days: [
        {
          date: '2030-10-26',
          startsAt: '2030-10-25T22:00:00Z',
          endsAt: '2030-10-26T23:00:00Z',
        },
        {
          date: '2030-10-27',
          startsAt: '2030-10-26T22:00:00Z',
          endsAt: '2030-10-27T23:00:00Z',
        },
        {
          date: '2030-10-28',
          startsAt: '2030-10-27T23:00:00Z',
          endsAt: '2030-10-28T23:00:00Z',
        },
      ],
      events: [
        event({
          name: 'Fictional overnight booking',
          eventDate: '2030-10-26',
          startsAt: '2030-10-26T20:00:00Z',
          endsAt: '2030-10-28T04:00:00Z',
        }),
      ],
    }),
  );
  render(<CalendarPanel />);
  await findRange('Oktober 2030');
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.calendar-chip')).toHaveLength(3),
  );
  const notes = Array.from(
    document.querySelectorAll('.calendar-chip-time'),
  ).map((node) => node.textContent);
  // The original interval is shown identically in every cell it occupies; no
  // cell claims its own date as the booking's start.
  expect(new Set(notes).size).toBe(1);
  expect(notes[0]).toBe(
    '26. Oktober 2030 22:00 Uhr – 28. Oktober 2030 05:00 Uhr',
  );
  expect(document.body.textContent).not.toContain('27. Oktober 2030 22:00');
  expect(document.body.textContent).not.toContain('28. Oktober 2030 00:00');
});
