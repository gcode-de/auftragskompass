import { expect, test, type Page } from '@playwright/test';

// BKP008: the narrow month grid stays a real Mo–So grid (short day number,
// explicit today/selection, compact count) and the chosen day reveals a
// complete agenda. Fictional, self-contained fixture: the built admin bundle
// runs against stubbed APIs, so no database and no real business data.
const TIME_ZONE = 'Europe/Berlin';
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const LONG_NAME =
  'Fiktive Feier mit außergewöhnlich langem Namen für die Prüfung des Zeilenumbruchs';
const FIVE = [
  { id: 'fictional-3a', name: 'Fiktives Event drei A', status: 'booked' },
  { id: 'fictional-3b', name: 'Fiktives Event drei B', status: 'booked' },
  { id: 'fictional-3c', name: 'Fiktives Event drei C', status: 'option' },
  { id: 'fictional-3d', name: 'Fiktives Event drei D', status: 'option' },
  { id: 'fictional-3e', name: 'Fiktives Event drei E', status: 'blocked' },
];

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayCount(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The API returns every real day of the month — no padding days, no invented
// times. November 2030 is the DST-free month used for the geometry pass.
function monthFixture(
  year: number,
  month: number,
  selectedDay: number,
  withEvents = true,
) {
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
    day: number,
    from: number,
    to: number,
    status: string,
    location: string | null = null,
  ) => {
    const date = isoDate(year, month, day);
    return {
      id,
      name,
      status,
      eventDate: date,
      startsAt: `2030-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(from).padStart(2, '0')}:00:00.000Z`,
      endsAt: `2030-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(to).padStart(2, '0')}:00:00.000Z`,
      eventType: 'Fiktive Art',
      contact: 'Fiktiver Kontakt',
      location,
    };
  };
  return {
    pendingPromises: 0,
    date: isoDate(year, month, selectedDay),
    view: 'month',
    timeZone: TIME_ZONE,
    from: isoDate(year, month, 1),
    to: isoDate(year, month, dayCount(year, month)),
    previousDate: null,
    nextDate: null,
    days,
    events: withEvents
      ? [
          // Day 2: a date-only booking whose title must never be clipped.
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
          ...FIVE.map((event, index) =>
            timed(
              event.id,
              event.name,
              index < 2 ? 3 : 3,
              8 + index * 2,
              10 + index * 2,
              event.status,
              index === 0 ? 'Festsaal' : null,
            ),
          ),
          // Day 4 into day 5: one booking that occupies both days.
          {
            id: 'fictional-overnight',
            name: 'Fiktive Übernachtung',
            status: 'booked',
            eventDate: isoDate(year, month, 4),
            startsAt: `${isoDate(year, month, 4)}T20:00:00.000Z`,
            endsAt: `${isoDate(year, month, 5)}T04:00:00.000Z`,
            eventType: 'Fiktive Art',
            contact: null,
            location: null,
          },
        ]
      : [],
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

async function stubApis(page: Page, calendar: unknown) {
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

async function readGrid(page: Page) {
  return page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('.calendar-events')!;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      head: Array.from(
        document.querySelectorAll('.calendar-weekday-head ol > li'),
      ).map((node) => ({ ...box(node), text: node.textContent ?? '' })),
      cells: Array.from(document.querySelectorAll('.calendar-day')).map(
        (cell) => {
          const node = cell as HTMLElement;
          const button = node.querySelector<HTMLElement>(
            '.calendar-day-button',
          )!;
          const buttonBox = button.getBoundingClientRect();
          return {
            ...box(cell),
            date: cell.querySelector('time')!.getAttribute('datetime')!,
            number: cell.querySelector('time')!.textContent!.trim(),
            buttonWidth: buttonBox.width,
            buttonHeight: buttonBox.height,
            count:
              cell.querySelector('.calendar-day-count')?.textContent ?? null,
            selected: node.dataset.selected === 'true',
            today: node.dataset.today === 'true',
          };
        },
      ),
      innerOverflow: region.scrollWidth - region.clientWidth,
      bodyOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      theme: document.documentElement.dataset.theme,
    };
  });
}

async function readAgenda(page: Page) {
  return page.evaluate(() => {
    const agenda = document.querySelector<HTMLElement>('.calendar-agenda')!;
    const width = agenda.getBoundingClientRect().width;
    return {
      heading: agenda.querySelector('h4')!.textContent!.trim(),
      count: agenda
        .querySelector('.calendar-agenda-count')!
        .textContent!.trim(),
      items: Array.from(
        agenda.querySelectorAll<HTMLElement>('.calendar-agenda-item'),
      ).map((item) => {
        const link = item.querySelector('a')!;
        const linkBox = link.getBoundingClientRect();
        return {
          text: item.textContent ?? '',
          title: link.textContent ?? '',
          href: link.getAttribute('href')!,
          linkWidth: linkBox.width,
          linkHeight: linkBox.height,
          // A wrapped title never overflows its own line box.
          clipped: link.scrollWidth - link.clientWidth,
          linkOverflow: linkBox.right - width,
        };
      }),
      empty:
        agenda.querySelector('.calendar-agenda-empty')?.textContent ?? null,
    };
  });
}

const WIDTHS = [320, 390, 720, 768, 1280, 1440] as const;

// Chromium's date input owns three inner sub-fields, so the number of tab
// presses to the grid is not stable across builds; the day button is.
async function tabToDayButton(page: Page) {
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    if (
      await page.evaluate(() =>
        (document.activeElement as HTMLElement).classList.contains(
          'calendar-day-button',
        ),
      )
    )
      return;
  }
  throw new Error('the keyboard never reached a calendar day button');
}

test('the month grid stays readable and the day agenda complete at every width', async ({
  page,
}) => {
  test.setTimeout(180000);
  const calendar = monthFixture(2030, 11, 15);
  const days = dayCount(2030, 11);
  await stubApis(page, calendar);
  const region = page.getByRole('region', { name: 'Kalender', exact: true });
  await page.goto('/#calendar');
  await expect(region.locator('.calendar-day')).toHaveCount(days);
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(
      (value) => localStorage.setItem('ak-theme', value),
      theme,
    );
    await page.reload();
    await expect(region.locator('.calendar-day')).toHaveCount(days);
    for (const width of WIDTHS) {
      // 720 CSS px is the layout proxy for a 1440 window at 200 % browser
      // zoom; a pinch-zoom gesture is not covered by any viewport test.
      await page.setViewportSize({ width, height: 900 });
      const grid = await readGrid(page);
      const where = `@${width} ${theme}`;
      expect(grid.theme, where).toBe(theme);
      expect(
        grid.head.map((column) => column.text),
        where,
      ).toEqual(WEEKDAYS);
      expect(grid.cells, where).toHaveLength(days);
      // A one-line day number, never "Do., 01.10." in a 40-px cell.
      expect(
        grid.cells.map((cell) => cell.number),
        where,
      ).toEqual(Array.from({ length: days }, (_, index) => String(index + 1)));
      // 1 November 2030 is a Friday, so day 1 sits in column 5 (index 4) and
      // day 4 starts the second row: the alignment stays the BKP001 one.
      const rows: number[] = [];
      for (const cell of grid.cells)
        if (!rows.some((y) => Math.abs(y - cell.y) < 1.5)) rows.push(cell.y);
      rows.sort((left, right) => left - right);
      grid.cells.forEach((cell, index) => {
        const column = (4 + index) % 7;
        const row = Math.floor((4 + index) / 7);
        const head = grid.head[column]!;
        expect(cell.x, `${where} day ${cell.date}`).toBeGreaterThanOrEqual(
          head.x - 1.5,
        );
        expect(
          cell.x + cell.width,
          `${where} day ${cell.date}`,
        ).toBeLessThanOrEqual(head.x + head.width + 1.5);
        expect(
          rows.findIndex((y) => Math.abs(y - cell.y) < 1.5),
          `${where} day ${cell.date}`,
        ).toBe(row);
      });
      // No body overflow and no hidden horizontal scroll in the month grid.
      expect(grid.bodyOverflow, where).toBeLessThanOrEqual(0);
      expect(grid.innerOverflow, where).toBeLessThanOrEqual(1);
      for (const cell of grid.cells) {
        // 44-px height and the full column width: seven columns at 320 leave
        // less than 44 px of width, so the height and the whole cell are the
        // touch target.
        expect(
          cell.buttonHeight,
          `${where} ${cell.date}`,
        ).toBeGreaterThanOrEqual(44);
        // Seven columns of a 320-px viewport leave ~33 px per cell; the
        // button fills its column and keeps the full 44-px height.
        expect(
          cell.buttonWidth,
          `${where} ${cell.date}`,
        ).toBeGreaterThanOrEqual(30);
      }
      // Visible count on the busy day, nothing invented on the empty one.
      expect(grid.cells[2]!.count, where).toBe('5');
      expect(grid.cells[0]!.count, where).toBeNull();

      // Day with five events: the agenda lists all five, fully readable.
      await region.locator(`#calendar-day-${isoDate(2030, 11, 3)}`).click();
      await expect(region.locator('.calendar-agenda-item')).toHaveCount(5);
      const five = await readAgenda(page);
      expect(five.heading, where).toContain('3. November 2030');
      expect(five.count, where).toBe('5 Events');
      for (const item of five.items) {
        expect(item.href, where).toMatch(/^#event-fictional-3/);
        expect(item.clipped, where).toBeLessThanOrEqual(1);
        expect(item.linkOverflow, where).toBeLessThanOrEqual(1);
        expect(item.linkHeight, where).toBeGreaterThanOrEqual(44);
      }
      expect(
        five.items.map((item) => item.title),
        where,
      ).toEqual(FIVE.map((event) => event.name));
      expect(five.items.map((item) => item.text).join(' '), where).toContain(
        'Festsaal',
      );
      // Stored UTC instants, displayed in the tenant zone: 08:00Z is 09:00
      // in Berlin in November, and no cell invents another time.
      expect(five.items.map((item) => item.text).join(' '), where).toContain(
        '09:00 Uhr – 11:00 Uhr',
      );
      // Clicking a day must not fetch again: the loaded month is enough.
      // Long title wraps instead of being cut.
      await region.locator(`#calendar-day-${isoDate(2030, 11, 2)}`).click();
      await expect(region.locator('.calendar-agenda-item')).toHaveCount(1);
      const long = await readAgenda(page);
      expect(long.items[0]!.title, where).toBe(LONG_NAME);
      expect(long.items[0]!.clipped, where).toBeLessThanOrEqual(1);
      expect(long.items[0]!.text, where).toContain(
        'Tagesbuchung, ohne Uhrzeit',
      );
      // A day without events says so explicitly.
      await region.locator(`#calendar-day-${isoDate(2030, 11, 1)}`).click();
      await expect(region.locator('.calendar-agenda-item')).toHaveCount(0);
      expect((await readAgenda(page)).empty, where).toBe(
        'Keine Events an diesem Tag.',
      );
    }
  }
});

test('a keyboard user selects days, keeps the focus ring and reaches the agenda', async ({
  page,
}) => {
  test.setTimeout(120000);
  await stubApis(page, monthFixture(2030, 11, 3));
  await page.goto('/#calendar');
  const region = page.getByRole('region', { name: 'Kalender', exact: true });
  await expect(region.locator('.calendar-day')).toHaveCount(dayCount(2030, 11));
  await page.setViewportSize({ width: 390, height: 844 });
  // The grid is one tab stop: from the date field it passes the native
  // date sub-fields and the scroll region, then reaches the selected day.
  await page.getByLabel('Kalenderdatum').focus();
  await tabToDayButton(page);
  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement;
    const style = getComputedStyle(active);
    return {
      className: active.className,
      date: active.querySelector('time')?.getAttribute('datetime') ?? null,
      visible: active.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      pressed: active.getAttribute('aria-pressed'),
    };
  });
  expect(focused.className).toContain('calendar-day-button');
  expect(focused.date).toBe('2030-11-03');
  expect(focused.visible).toBe(true);
  expect(focused.outlineStyle).toBe('solid');
  expect(Number.parseFloat(focused.outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(focused.pressed).toBe('true');

  // Arrow keys move the selection and keep the focus in the grid.
  await page.keyboard.press('ArrowRight');
  await expect(
    region.getByRole('heading', { name: /4\. November 2030/ }),
  ).toBeVisible();
  await expect(region.locator('#calendar-day-2030-11-04')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    region.getByRole('heading', { name: /11\. November 2030/ }),
  ).toBeVisible();
  await expect(region.locator('#calendar-day-2030-11-11')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(region.locator('#calendar-day-2030-11-04')).toBeFocused();
  // Enter/Space are native button activation; the agenda follows the press.
  await page.keyboard.press('Enter');
  await expect(region.locator('#calendar-day-2030-11-04')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(region.locator('.calendar-agenda-item')).toHaveCount(1);
  // One more Tab leaves the grid and lands on the first agenda link.
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement;
    const style = getComputedStyle(active);
    return {
      inAgenda: Boolean(active.closest('.calendar-agenda')),
      tag: active.tagName,
      outlineWidth: style.outlineWidth,
      visible: active.matches(':focus-visible'),
    };
  });
  expect(next.inAgenda).toBe(true);
  expect(next.tag).toBe('A');
  expect(next.visible).toBe(true);
  expect(Number.parseFloat(next.outlineWidth)).toBeGreaterThanOrEqual(2);

  // Reload keeps the same single tab stop and the ring.
  await page.reload();
  await expect(region.locator('.calendar-day')).toHaveCount(dayCount(2030, 11));
  await expect(
    region.locator('.calendar-day-button[tabindex="0"]'),
  ).toHaveCount(1);
  await page.getByLabel('Kalenderdatum').focus();
  await tabToDayButton(page);
  expect(
    await page.evaluate(() =>
      (document.activeElement as HTMLElement).matches(':focus-visible'),
    ),
  ).toBe(true);
});

test('today is named and marked apart from the selected day at 320', async ({
  page,
}) => {
  test.setTimeout(120000);
  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
  }).format(new Date());
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const selectedDay = Number(todayIso.slice(8, 10)) === 15 ? 16 : 15;
  // No events: the empty days keep their cells and the today marker.
  await stubApis(page, monthFixture(year, month, selectedDay, false));
  await page.goto('/#calendar');
  const region = page.getByRole('region', { name: 'Kalender', exact: true });
  await expect(region.locator('.calendar-day')).toHaveCount(
    dayCount(year, month),
  );
  await page.setViewportSize({ width: 320, height: 844 });
  const marks = await page.evaluate(() => {
    const today = document.querySelector<HTMLElement>(
      '.calendar-day[data-today="true"]',
    )!;
    const selected = document.querySelector<HTMLElement>(
      '.calendar-day[data-selected="true"]',
    )!;
    const describe = (cell: HTMLElement) => {
      const button = cell.querySelector('button')!;
      const style = getComputedStyle(button);
      return {
        date: cell.querySelector('time')!.getAttribute('datetime'),
        borderStyle: style.borderStyle,
        background: style.backgroundColor,
        pressed: button.getAttribute('aria-pressed'),
        current: button.getAttribute('aria-current'),
        label: button.getAttribute('aria-label'),
      };
    };
    return {
      today: describe(today),
      selected: describe(selected),
      todayCount: document.querySelectorAll('.calendar-day[data-today="true"]')
        .length,
      selectedCount: document.querySelectorAll(
        '.calendar-day[data-selected="true"]',
      ).length,
      todayWord: today.querySelector('.calendar-day-today')?.textContent,
      bodyOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(marks.todayCount).toBe(1);
  expect(marks.selectedCount).toBe(1);
  expect(marks.today.date).toBe(todayIso);
  expect(marks.todayWord).toBe('Heute');
  expect(marks.today.current).toBe('date');
  expect(marks.today.pressed).toBe('false');
  expect(marks.today.borderStyle).toBe('dashed');
  expect(marks.selected.date).toBe(
    `${todayIso.slice(0, 8)}${String(selectedDay).padStart(2, '0')}`,
  );
  expect(marks.selected.pressed).toBe('true');
  expect(marks.selected.borderStyle).toBe('solid');
  expect(marks.today.label).toContain('heute');
  expect(marks.bodyOverflow).toBeLessThanOrEqual(0);
  // The word fits its 33-px cell instead of being clipped or pushing the grid.
  const todayWord = (await region
    .locator('.calendar-day-today')
    .boundingBox())!;
  const todayCell = (await region
    .locator('.calendar-day[data-today="true"]')
    .boundingBox())!;
  expect(todayWord.width).toBeGreaterThan(0);
  expect(todayWord.x).toBeGreaterThanOrEqual(todayCell.x - 0.5);
  expect(todayWord.x + todayWord.width).toBeLessThanOrEqual(
    todayCell.x + todayCell.width + 0.5,
  );
  // An empty day is still selectable and still says it is empty.
  await region.locator(`#calendar-day-${todayIso}`).click();
  await expect(region.locator('.calendar-agenda-empty')).toBeVisible();
  await expect(region.locator('#calendar-day-' + todayIso)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
