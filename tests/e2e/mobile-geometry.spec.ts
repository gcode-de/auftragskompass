import { createServer, type ViteDevServer } from 'vite';
import { expect, test } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// H042 measures real browser geometry for the mobile workflow fixes: a
// readable month day list, a save button that stays in the dialog, and 44px
// tap targets. The routes are synthetic; no API, database or fixture data of
// the running environment is touched.
const root = fileURLToPath(new URL('../../apps/admin', import.meta.url));
const entriesDirectory = join(root, 'h042-synthetic');

const stub = `
const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('/auth/me'))
    return json({ email: 'synthetic-operator@example.invalid', csrfToken: 'synthetic-csrf' });
  if (url.startsWith('/api/v1/events?') || url === '/api/v1/events')
    return json({ timeZone: 'Europe/Berlin', events: [
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Fictional autumn wedding', status: 'booked', eventDate: '2030-10-12', startsAt: '2030-10-12T14:00:00.000Z', endsAt: '2030-10-12T22:00:00.000Z', eventTypeId: null, packageId: null, locationId: null, primaryContactId: null, additionalContactIds: [], source: '', description: '', notesHtml: '', version: 1 },
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Fictional summer party', status: 'inquiry', eventDate: null, startsAt: null, endsAt: null, eventTypeId: null, packageId: null, locationId: null, primaryContactId: null, additionalContactIds: [], source: '', description: '', notesHtml: '', version: 1 },
    ] });
  if (url.startsWith('/api/v1/statuses'))
    return json([{ code: 'inquiry', label: 'Anfrage' }, { code: 'option', label: 'Option' }, { code: 'booked', label: 'Gebucht' }, { code: 'cancelled', label: 'Annulliert' }]);
  if (url.startsWith('/api/v1/master-data/') || url.startsWith('/api/v1/locations') || url.startsWith('/api/v1/resources') || url.startsWith('/api/v1/products') || url.startsWith('/api/v1/resource-blocks') || url.startsWith('/api/v1/calendar-feeds') || url.startsWith('/api/v1/document-templates') || url.startsWith('/api/v1/documents') || url.startsWith('/api/v1/document-numbers') || url.startsWith('/api/v1/access')) return json([]);
  if (url.startsWith('/api/v1/cancellation-reasons')) return json([]);
  if (url.startsWith('/api/v1/events/'))
    return json({
      event: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Fictional autumn wedding', status: 'booked', eventDate: '2030-10-12', startsAt: '2030-10-12T14:00:00.000Z', endsAt: '2030-10-12T22:00:00.000Z', eventTypeId: null, packageId: null, locationId: null, primaryContactId: null, additionalContactIds: [], source: '', description: '', notesHtml: '', venue: null, venueOverride: false, version: 1, timeZone: 'Europe/Berlin' },
      contacts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic company', contactPerson: 'Synthetic person', email: 'synthetic@example.invalid', phone: '0300000001', mobile: '01700000002', role: 'primary' }],
      location: null,
      eventType: null,
      package: null,
      activities: [],
    });
  if (url.startsWith('/api/v1/contacts'))
    return json([
      { id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic company', contactPerson: 'Synthetic person', email: 'synthetic@example.invalid', phone: '0300000001', mobile: '01700000002', state: 'active', version: 1 },
    ]);
  if (url.startsWith('/api/v1/calendar')) {
    const requested = new URL(url, 'http://127.0.0.1').searchParams.get('view') ?? 'month';
    const monthDays = (first, count) =>
      Array.from({ length: count }, (_, index) => {
        const date =
          '2030-10-' + String(first + index).padStart(2, '0');
        return {
          date,
          startsAt: date + 'T00:00:00.000Z',
          endsAt: date + 'T23:00:00.000Z',
        };
      });
    return json({
      pendingPromises: 0,
      date: '2030-10-15',
      view: requested,
      timeZone: 'Europe/Berlin',
      from: '2030-10-01',
      to: '2030-10-31',
      previousDate: '2030-09-15',
      nextDate: '2030-11-15',
      days:
        requested === 'week'
          ? monthDays(12, 7)
          : requested === 'day'
            ? monthDays(12, 1)
            : monthDays(1, 31),
      events: [
        { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Fictional autumn wedding celebration', status: 'booked', eventDate: '2030-10-12', startsAt: '2030-10-12T14:00:00.000Z', endsAt: '2030-10-12T22:00:00.000Z', eventType: 'Hochzeit', contact: 'Synthetic contact', location: 'Fictional venue' },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Fictional company summer party', status: 'option', eventDate: '2030-10-12', startsAt: null, endsAt: null, eventType: 'Firmenfeier', contact: 'Synthetic contact', location: null },
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Fictional birthday party', status: 'inquiry', eventDate: '2030-10-20', startsAt: null, endsAt: null, eventType: 'Geburtstag', contact: null, location: null },
      ],
      units: [],
      reservations: [],
    });
  }
  return json({});
};
`;

const eventsEntry = `
${stub}
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/styles.css';
import { AuthPanel } from '/src/AuthPanel.tsx';
window.location.hash = '#events';
createRoot(document.getElementById('root')).render(createElement(AuthPanel));
`;

// The synthetic entry is written next to the app so Vite rewrites its bare
// imports and stylesheet; it names no server or business data.
const entries: Record<string, string> = {
  'h042-events.html': `<!doctype html><html lang="de"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AuftragsKompass</title></head><body><div id="root"></div>
<script type="module">${eventsEntry}</script></body></html>`,
};

let server: ViteDevServer;
let baseURL = '';

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root,
    define: { __AK_REVISION__: JSON.stringify('development') },
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  // Vite serves a file-based page only after its own start; the entries are
  // written once the middleware knows the root.
  await mkdir(entriesDirectory, { recursive: true });
  for (const [name, body] of Object.entries(entries))
    await writeFile(join(entriesDirectory, name), body);
  const address = server.httpServer!.address();
  baseURL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(async () => {
  await server?.close();
  await rm(entriesDirectory, { recursive: true, force: true });
});

// The entries are served by the dev server next to the app, so the layout is
// measured against the very stylesheet the admin ships.
async function open(entry: string) {
  return baseURL + '/h042-synthetic/' + entry;
}

// Hash routing renders the area after the panel data arrived; a route hash
// without a slash never reloads the document.
async function go(
  page: import('@playwright/test').Page,
  route: string,
  area: string,
) {
  const visible = () =>
    page
      .locator('.workspace-page:not([hidden]) ' + area)
      .first()
      .isVisible();
  for (
    let attempt = 0;
    attempt < 80 && !(await visible().catch(() => false));
    attempt += 1
  ) {
    await page
      .evaluate((hash) => {
        // The hashchange is what routes; retrying closes a first-load race.
        if (window.location.hash !== '#' + hash) window.location.hash = hash;
      }, route)
      .catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await expect(
    page.locator('.workspace-page:not([hidden]) ' + area).first(),
  ).toBeVisible({ timeout: 20000 });
}

test('month calendar stays a readable day list at 320 and 390', async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(await open('h042-events.html'));
  await go(page, 'events', 'section[aria-label="Events"]');
  await go(page, 'calendar', 'section[aria-label="Kalender"]');
  const grid = page.locator('.calendar-events .calendar-grid');
  await expect(grid.locator('.calendar-day')).toHaveCount(31);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    // The month switch is asynchronous; wait until the day list is on screen.
    await expect(
      page.locator('.calendar-events[data-view="month"] .calendar-day'),
    ).toHaveCount(31);
    const layout = await page.evaluate(() => {
      const rect = (element: Element) => element.getBoundingClientRect().width;
      const events = document.querySelector<HTMLElement>(
        '.calendar-events[data-view="month"]',
      )!;
      const dayEvents = document.querySelectorAll<HTMLElement>(
        '.calendar-events[data-view="month"] .calendar-day',
      );
      const chips = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.calendar-events[data-view="month"] .calendar-chip',
        ),
      );
      const cards = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.calendar-events[data-view="month"] .calendar-day',
        ),
      );
      return {
        columns: getComputedStyle(
          document.querySelector<HTMLElement>(
            '.calendar-events[data-view="month"] .calendar-grid',
          )!,
        ).gridTemplateColumns.split(' ').length,
        headHidden: !document
          .querySelector<HTMLElement>('.calendar-weekday-head')
          ?.getClientRects().length,
        innerOverflow: events.scrollWidth - events.clientWidth,
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
        headings: Array.from(dayEvents)
          .filter((card) => card.querySelector('article'))
          .map((card) => {
            const heading = card.querySelector('h4')!;
            const time = heading.querySelector('time');
            return {
              card: rect(card),
              // The date label spans its card; in a seven-column cell that was
              // ~23px, in a day row it has room for the whole date.
              width: rect(heading),
              // An inline time has no own box; measure its rendered text.
              fits: (() => {
                const range = document.createRange();
                range.selectNodeContents(time ?? heading);
                return (
                  range.getBoundingClientRect().right <=
                  card.getBoundingClientRect().right
                );
              })(),
            };
          }),
        chips: chips.map((chip) => {
          const card = chip.closest<HTMLElement>('.calendar-day')!;
          const link = chip.querySelector<HTMLElement>('.calendar-chip-link')!;
          return {
            card: card.getBoundingClientRect().width,
            chip: chip.clientWidth,
            link: link.getBoundingClientRect().width,
            height: link.getBoundingClientRect().height,
            clipped: link.scrollWidth > link.clientWidth + 1,
          };
        }),
        cardWidths: cards.map(
          (card) => Math.round(card.getBoundingClientRect().width * 10) / 10,
        ),
      };
    });
    expect(layout.bodyOverflow, width + ' body overflow').toBeLessThanOrEqual(
      0,
    );
    expect(
      layout.innerOverflow,
      width + ' calendar overflow',
    ).toBeLessThanOrEqual(1);
    expect(layout.columns, width + ' grid columns').toBeLessThanOrEqual(2);
    expect(layout.headHidden, width + ' weekday head hidden').toBe(true);
    expect(layout.headings.length, width + ' event days').toBeGreaterThan(0);
    for (const day of layout.headings) {
      // A seven-column cell left ~23px for the date; a day row leaves far more.
      expect(day.width, width + ' readable day heading').toBeGreaterThan(80);
      expect(day.fits, width + ' day date clipped ' + JSON.stringify(day)).toBe(
        true,
      );
    }
    // A chip shows its time without turning into a two-line paragraph.
    const chipHeights = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.calendar-events[data-view="month"] .calendar-chip',
        ),
      ).map((chip) => Math.round(chip.getBoundingClientRect().height)),
    );
    for (const height of chipHeights)
      expect(height, width + ' chip height').toBeLessThanOrEqual(120);
    expect(layout.chips.length).toBeGreaterThanOrEqual(3);
    for (const chip of layout.chips) {
      // 9px at 320px before the fix: the link now fills the chip minus its own
      // padding, and the chip spans the day row.
      expect(
        chip.link,
        width + ' chip link fills chip ' + JSON.stringify(chip),
      ).toBeGreaterThanOrEqual(chip.chip - 10);
      expect(chip.link, width + ' chip link width').toBeGreaterThan(
        chip.card / 2,
      );
      expect(chip.height, width + ' chip tap target').toBeGreaterThanOrEqual(
        44,
      );
    }
    // At least one event name is fully readable in its row.
    expect(
      layout.chips.filter((chip) => !chip.clipped).length,
      width + ' unclipped event name',
    ).toBeGreaterThan(0);
  }
  // The week view keeps its own horizontal scroll at the same width.
  // The week and day views keep their own layout and targets at 320px.
  const view = page.getByRole('combobox', { name: 'Kalenderansicht' });
  await view.selectOption('week');
  await expect(page.locator('.calendar-events[data-view="week"]')).toBeVisible({
    timeout: 30000,
  });
  const week = await page.evaluate(() => {
    const events = document.querySelector<HTMLElement>(
      '.calendar-events[data-view="week"]',
    )!;
    return {
      columns: getComputedStyle(
        events.querySelector<HTMLElement>('.calendar-grid')!,
      ).gridTemplateColumns.split(' ').length,
      scrollable: events.scrollWidth > events.clientWidth,
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(week.columns).toBe(7);
  expect(week.scrollable).toBe(true);
  expect(week.bodyOverflow).toBeLessThanOrEqual(0);
  await view.selectOption('day');
  await expect(page.locator('.calendar-events[data-view="day"]')).toBeVisible({
    timeout: 30000,
  });
  const day = (await page
    .locator('.calendar-chip-link')
    .first()
    .boundingBox())!;
  expect(day.height).toBeGreaterThanOrEqual(44);
  expect(day.width).toBeGreaterThan(140);
  await page.setViewportSize({ width: 1280, height: 800 });
  await view.selectOption('month');
  await expect(page.locator('.calendar-events[data-view="month"]')).toBeVisible(
    { timeout: 30000 },
  );
  const desktop = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector<HTMLElement>(
          '.calendar-events[data-view="month"] .calendar-grid',
        )!,
      ).gridTemplateColumns.split(' ').length,
  );
  expect(desktop).toBe(7);
});

test('create dialog keeps its save action reachable while scrolling', async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(await open('h042-events.html'));
  await go(page, 'events', 'section[aria-label="Events"]');
  await page.getByRole('button', { name: 'Event anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neues Event' });
  await dialog.getByText('Weitere Angaben', { exact: true }).click();
  const save = dialog.getByRole('button', {
    name: 'Event speichern',
    exact: true,
  });
  for (const [width, height] of [
    [320, 844],
    [390, 844],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    const geometry = await dialog.evaluate((element) => {
      const footer = element.querySelector<HTMLElement>(
        '.event-create-footer',
      )!;
      const style = getComputedStyle(footer);
      return {
        position: style.position,
        stickyBottom: parseFloat(style.bottom),
        background: style.backgroundColor,
        border: style.borderTopWidth,
        scrollable: element.scrollHeight > element.clientHeight,
        clientHeight: element.clientHeight,
        viewport: window.innerHeight,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(geometry.position, width + ' sticky').toBe('sticky');
    expect(geometry.stickyBottom, width + ' stick to bottom').toBeLessThan(1);
    expect(geometry.border, width + ' top border').not.toBe('0px');
    expect(
      geometry.scrollWidth,
      width + ' dialog horizontal fit',
    ).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(
      geometry.viewport - geometry.clientHeight,
      width + ' dialog fits viewport',
    ).toBeGreaterThan(0);
    if (width < 600) expect(geometry.scrollable).toBe(true);
    // Visible without scrolling the dialog to its very end.
    await save.scrollIntoViewIfNeeded();
    const scrolled = await dialog.evaluate((element) => element.scrollTop);
    expect(
      scrolled,
      width + ' save reachable without scrolling to the end',
    ).toBeLessThanOrEqual(geometry.clientHeight);
    const box = (await save.boundingBox())!;
    expect(box.y, width + ' save top').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, width + ' save bottom').toBeLessThanOrEqual(
      height + 1,
    );
    expect(box.height, width + ' save tap target').toBeGreaterThanOrEqual(44);
  }
  // Escape still closes and the draft protections stay untouched.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('contact mail and phone actions are 44px targets on both surfaces', async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(await open('h042-events.html'));
  const measure = async (links: import('@playwright/test').Locator[]) => {
    for (const link of links) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(
        await link.evaluate((element) => getComputedStyle(element).display),
      ).toMatch(/^(-webkit-)?(inline-)?flex$/);
    }
  };
  const surfaces = [
    {
      name: 'Kontakte',
      async open() {
        // The navigation lives inside the closed mobile drawer below 901px;
        // these routes use the same hash the links use.
        await go(page, 'contacts', 'section[aria-label="Kontakte"]');
        const list = page.locator('.contact-list');
        return [
          list.getByRole('link', { name: 'E-Mail: Synthetic company' }),
          list.getByRole('link', { name: 'Anrufen: Synthetic company' }),
        ];
      },
    },
    {
      name: 'Eventakte',
      async open() {
        await go(page, 'events', 'section[aria-label="Events"]');
        await go(
          page,
          'event-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          'section[aria-label="Event-Details"]',
        );
        const overview = page.getByRole('region', { name: 'Event-Details' });
        return [
          overview.getByRole('link', { name: 'synthetic@example.invalid' }),
          overview.getByRole('link', { name: '0300000001' }),
          overview.getByRole('link', { name: '01700000002' }),
        ];
      },
    },
  ];
  for (const surface of surfaces) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const links = await surface.open();
      expect(
        await links[0]!.isVisible(),
        surface.name + ' ' + width + ' links rendered',
      ).toBe(true);
      await measure(links);
    }
  }
});

test('the sort choice row is a full-height tap target', async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(await open('h042-events.html'));
  await go(page, 'events', 'section[aria-label="Events"]');
  const events = page.getByRole('region', { name: 'Events', exact: true });
  // The filter disclosure stays closed by default; opening it must not shrink
  // the sort rows into icon-size targets.
  const filters = events.locator('details.event-filters');
  await events.getByText('Filter', { exact: true }).first().click();
  await expect(filters).toHaveAttribute('open', '');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const labels = events.locator('.sort-choice');
    await expect(labels).toHaveCount(2);
    // Only an open, rendered filter makes this measurement meaningful.
    expect(
      await labels.first().isVisible(),
      width + ' sort rows rendered',
    ).toBe(true);
    for (let index = 0; index < 2; index += 1) {
      const label = labels.nth(index);
      const box = (await label.boundingBox())!;
      expect(box.height, width + ' sort row height').toBeGreaterThanOrEqual(44);
      expect(box.width, width + ' sort row width').toBeGreaterThanOrEqual(44);
      const radio = await label.locator('input[type=radio]').boundingBox();
      expect(radio!.height, width + ' radio box unchanged').toBeLessThan(44);
    }
  }
});
