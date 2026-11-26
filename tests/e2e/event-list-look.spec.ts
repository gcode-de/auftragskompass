import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI-BKP-02: the event list in Bookitup's shape with fictional events in
// every status - month bands, shadowed cards with a status bar, the row menu
// and the booking-status multi-select that starts without cancelled and
// unavailable events.
const statuses = [
  { code: 'inquiry', label: 'Anfrage' },
  { code: 'option', label: 'Option' },
  { code: 'booked', label: 'Gebucht' },
  { code: 'unavailable', label: 'Nicht verfügbar' },
  { code: 'cancelled', label: 'Abgesagt' },
];
const event = (
  id: number,
  name: string,
  status: string,
  eventDate: string,
  venue: string,
) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  version: 1,
  name,
  status,
  eventDate,
  startsAt: null,
  endsAt: null,
  timeZone: 'Europe/Berlin',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue,
  venueOverride: true,
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  description: '',
  notesHtml: '',
});
const events = [
  event(1, 'Fiktive Firmenfeier', 'booked', '2031-12-07', 'Fiktivhalle'),
  event(2, 'Fiktive Hochzeit', 'inquiry', '2031-12-11', 'Musterhof'),
  event(3, 'Fiktiver Winterball', 'option', '2031-12-12', ''),
  event(4, 'Fiktiv abgesagt', 'cancelled', '2031-12-20', 'Testsaal'),
  event(5, 'Fiktiv belegt', 'unavailable', '2032-02-20', ''),
  event(6, 'Fiktives Sommerfest', 'booked', '2032-07-02', 'Beispielort'),
];

async function open(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/events')
      return route.fulfill({
        json: {
          events,
          timeZone: 'Europe/Berlin',
          filterCounts: { undated: 0, inquiries: 1 },
        },
      });
    if (path === '/api/v1/statuses') return route.fulfill({ json: statuses });
    return route.fulfill({ json: [] });
  });
  await page.route('**/auth/**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'x-auth-mode': 'password' },
      json: { email: 'fictional@example.invalid', csrfToken: 'synthetic' },
    }),
  );
  await page.goto('/#events');
}

test('the event list reads like Bookitup in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const list = page.getByRole('region', { name: 'Events', exact: true });
  await expect(list.getByText('Fiktive Firmenfeier')).toBeVisible();
  // Cancelled and unavailable events stay out until chosen.
  await expect(list.getByText('Fiktiv abgesagt')).toHaveCount(0);
  await expect(list.getByText('Fiktiv belegt')).toHaveCount(0);
  // UI-BKP-08: a 60px rail, then the full-height context column with the
  // page title and the plus; the top bar keeps the h1 only for screen readers.
  const rail = (await page.locator('.desktop-sidebar').boundingBox())!;
  expect(rail.width).toBe(60);
  const column = page.getByRole('complementary', { name: 'Eventfilter' });
  const columnBox = (await column.boundingBox())!;
  expect(columnBox.x).toBe(rail.width);
  expect(columnBox.y).toBe(0);
  expect(columnBox.height).toBe(1000);
  await expect(column.locator('.context-title')).toHaveText('Events');
  await expect(
    column.getByRole('button', { name: 'Event anlegen' }),
  ).toBeVisible();
  expect(
    await page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(1);
  const card = list.locator('.event-card').first();
  await expect(card).toHaveCSS('border-radius', '10px');
  expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(
    'none',
  );
  expect(
    await card.evaluate((el) => getComputedStyle(el, '::before').width),
  ).toBe('5px');
  // The card shows no action icons; the actions sit behind the row menu.
  await expect(card.getByRole('button')).toHaveCount(1);
  await card.getByLabel('Weitere Aktionen: Fiktive Firmenfeier').click();
  await expect(
    card.getByRole('button', {
      name: 'Event duplizieren: Fiktive Firmenfeier',
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    card.getByRole('button', {
      name: 'Event duplizieren: Fiktive Firmenfeier',
    }),
  ).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await page.getByRole('button', { name: /modus aktivieren/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`event-list-1440-${theme}.png`),
      fullPage: true,
    });
  }
  // Choosing "Abgesagt" adds the cancelled event; the choice is in the URL.
  const status = page.getByRole('group', { name: 'Buchungsstatus' });
  await status.getByRole('button', { name: 'Abgesagt' }).click();
  await expect(list.getByText('Fiktiv abgesagt')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('statuses')).toBe(
    'inquiry,option,booked,cancelled',
  );
  // Turning a default status off hides its events.
  await status.getByRole('button', { name: 'Gebucht' }).click();
  await expect(list.getByText('Fiktive Firmenfeier')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('event-list-390.png'),
    fullPage: true,
  });
});
