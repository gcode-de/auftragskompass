import { expect, test, type Page } from '@playwright/test';

// Fictional, self-contained fixture: the built admin bundle runs against
// stubbed APIs, so this test needs no database and no real business data.
const TIME_ZONE = 'Europe/Berlin';
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const EVENT_NAME = 'Fictional month start booking';

// 1 June 2026 is a Monday, 1 October 2026 a Thursday, 1 February 2026 a
// Sunday. Offsets are the shipped Monday-based (getUTCDay() + 6) % 7 rule.
const months = [
  {
    label: 'Juni 2026',
    year: 2026,
    month: 6,
    days: 30,
    offset: 0,
    first: 'Mo',
  },
  {
    label: 'Oktober 2026',
    year: 2026,
    month: 10,
    days: 31,
    offset: 3,
    first: 'Do',
  },
  {
    label: 'Februar 2026',
    year: 2026,
    month: 2,
    days: 28,
    offset: 6,
    first: 'So',
  },
] as const;

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthFixture(year: number, month: number, days: number) {
  const eventId = `fictional-${year}-${String(month).padStart(2, '0')}-start`;
  return {
    eventId,
    calendar: {
      pendingPromises: 0,
      date: isoDate(year, month, 15),
      view: 'month',
      timeZone: TIME_ZONE,
      from: isoDate(year, month, 1),
      to: isoDate(year, month, days),
      previousDate: null,
      nextDate: null,
      days: Array.from({ length: days }, (_, index) => {
        const start = new Date(Date.UTC(year, month - 1, index + 1));
        return {
          date: isoDate(year, month, index + 1),
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 86_400_000).toISOString(),
        };
      }),
      events: [
        {
          id: eventId,
          name: EVENT_NAME,
          status: 'option',
          eventDate: isoDate(year, month, 1),
          startsAt: null,
          endsAt: null,
          eventType: 'Fictional type',
          contact: 'Fictional contact',
          location: 'Fictional venue',
        },
      ],
      units: [
        {
          id: 'fictional-unit',
          name: 'Fictional box',
          code: 'FICT',
          ordinal: 1,
          enabled: true,
          blocked: false,
        },
      ],
      reservations: [],
    },
  };
}

async function stubApis(page: Page, calendar: unknown) {
  // Unused admin areas stay mounted and would hit the static preview server;
  // they get an honest failure instead of HTML. The two routes below win
  // because Playwright runs the last matching route first.
  await page.route(
    (url) =>
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'),
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'fictional stub without this endpoint' }),
      }),
  );
  await page.route(
    (url) => url.pathname === '/auth/me',
    (route) =>
      route.fulfill({
        status: 200,
        headers: { 'x-auth-mode': 'password' },
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'fictional.owner@example.invalid',
          csrfToken: 'fictional-csrf-token',
        }),
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/v1/calendar',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(calendar),
      }),
  );
}

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

function readGrid(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(
      '.calendar-events[data-view="month"] .calendar-grid',
    )!;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        text: element.textContent ?? '',
      };
    };
    return {
      head: Array.from(
        grid.querySelectorAll('.calendar-weekday-head ol > li'),
      ).map(box),
      days: Array.from(grid.querySelectorAll('.calendar-day')).map((cell) => ({
        ...box(cell),
        date: cell.querySelector('time')!.getAttribute('datetime')!,
        chipHref:
          cell.querySelector('.calendar-chip-link')?.getAttribute('href') ??
          null,
        chipName:
          cell.querySelector('.calendar-chip-link')?.textContent ?? null,
      })),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      theme: document.documentElement.dataset.theme,
    };
  });
}

function columnOf(head: Box[], cell: Box) {
  const match = head.findIndex(
    (column) =>
      cell.x >= column.x - 1.5 &&
      cell.x + cell.width <= column.x + column.width + 1.5,
  );
  return match;
}

function rowOf(days: Box[], cell: Box) {
  const rows: number[] = [];
  for (const day of days) {
    if (!rows.some((y) => Math.abs(y - day.y) < 1.5)) rows.push(day.y);
  }
  rows.sort((left, right) => left - right);
  return rows.findIndex((y) => Math.abs(y - cell.y) < 1.5);
}

for (const month of months) {
  test(`month calendar aligns ${month.label} under the correct weekday column`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { eventId, calendar } = monthFixture(
      month.year,
      month.month,
      month.days,
    );
    await stubApis(page, calendar);
    const calendarRegion = page.getByRole('region', {
      name: 'Kalender',
      exact: true,
    });
    await page.goto('/#calendar');
    await expect(calendarRegion).toBeVisible();
    await expect(calendarRegion.locator('.calendar-day')).toHaveCount(
      month.days,
    );

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(
        (value) => localStorage.setItem('ak-theme', value),
        theme,
      );
      await page.reload();
      await expect(calendarRegion.locator('.calendar-day')).toHaveCount(
        month.days,
      );
      for (const width of [390, 1440] as const) {
        await page.setViewportSize({ width, height: 900 });
        const grid = await readGrid(page);
        const context = `${month.label} @${width} ${theme}`;
        expect(grid.theme, context).toBe(theme);
        expect(
          grid.head.map((column) => column.text),
          context,
        ).toEqual(WEEKDAYS);
        // Day 1 of this month sits in the column its stored weekday names.
        expect(grid.head[month.offset]!.text, context).toBe(month.first);
        // The real month days are complete, unique and in order — no extra
        // "29 February" cell and no silently missing day.
        expect(grid.days.length, context).toBe(month.days);
        expect(new Set(grid.days.map((day) => day.date)).size, context).toBe(
          month.days,
        );
        expect(
          grid.days.map((day) => day.date),
          context,
        ).toEqual(
          Array.from({ length: month.days }, (_, index) =>
            isoDate(month.year, month.month, index + 1),
          ),
        );
        // Every day cell is inside the x-span of its own weekday heading and
        // in the expected calendar row: this is the actual alignment claim.
        grid.days.forEach((day, index) => {
          const column = (month.offset + index) % 7;
          const row = Math.floor((month.offset + index) / 7);
          const where = `${context} day ${day.date}`;
          expect(columnOf(grid.head, day), where).toBe(column);
          expect(rowOf(grid.days, day), where).toBe(row);
          expect(day.x + day.width, where).toBeLessThanOrEqual(
            grid.head[column]!.x + grid.head[column]!.width + 1.5,
          );
        });
        // Row break: the Sunday that ends week one stays in the last column
        // and the following Monday starts the next row in the first column.
        // For the Monday-start month that is day 7 (column 7) and day 8
        // (column 1); October and February start later, so their row break
        // falls earlier in the month.
        const sundayIndex = 6 - month.offset;
        const mondayIndex = 7 - month.offset;
        expect(columnOf(grid.head, grid.days[sundayIndex]!), context).toBe(6);
        expect(rowOf(grid.days, grid.days[sundayIndex]!), context).toBe(0);
        expect(grid.head[6]!.text, context).toBe('So');
        expect(columnOf(grid.head, grid.days[mondayIndex]!), context).toBe(0);
        expect(rowOf(grid.days, grid.days[mondayIndex]!), context).toBe(1);
        expect(grid.head[0]!.text, context).toBe('Mo');
        expect(grid.days[mondayIndex]!.y, context).toBeGreaterThan(
          grid.days[sundayIndex]!.y,
        );
        // The fictional booking on day 1 keeps its own event link.
        const firstDay = grid.days[0]!;
        expect(firstDay.chipHref, context).toBe('#event-' + eventId);
        expect(firstDay.chipName, context).toBe(EVENT_NAME);
        expect(grid.bodyOverflow, context).toBeLessThanOrEqual(0);
      }
    }

    // The chip is a reachable, named link that opens exactly its event.
    await page.setViewportSize({ width: 1440, height: 900 });
    const chip = calendarRegion.getByRole('link', { name: EVENT_NAME });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('href', '#event-' + eventId);
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`#event-${eventId}$`));
  });
}
