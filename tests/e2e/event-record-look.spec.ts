import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI-BKP-03: the event record in Bookitup's shape with a fictional booked
// event - the vertical record navigation with duplicate and delete at its
// foot, the card grid and the shadowed contact and location column.
const id = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const event = {
  id,
  version: 3,
  name: 'Fiktive Sommerhochzeit',
  status: 'booked',
  eventDate: '2031-07-12',
  startsAt: '2031-07-12T16:00:00.000Z',
  endsAt: '2031-07-12T22:00:00.000Z',
  timeZone: 'Europe/Berlin',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue: 'Fiktivhof\nMusterweg 1\n12345 Beispielstadt',
  venueOverride: true,
  primaryContactId: contactId,
  additionalContactIds: [],
  source: 'Empfehlung',
  description: 'Fiktive Beschreibung für den Test.',
  notesHtml: '',
  cancellationReasonId: null,
};

async function openRecord(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/v1/events/${id}`)
      return route.fulfill({
        json: {
          event,
          contacts: [
            {
              id: contactId,
              role: 'primary',
              name: 'Fiktive Kundin',
              contactPerson: '',
              email: 'kundin@example.invalid',
              phone: '+49 30 000000',
              mobile: '',
              detailsUnavailable: false,
            },
          ],
          location: null,
          eventType: null,
          package: null,
          activities: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              kind: 'created',
              description: 'Event angelegt',
              occurredAt: '2031-01-02T10:00:00.000Z',
              eventVersion: 1,
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              kind: 'status_changed',
              nextStatus: 'booked',
              description: 'Status auf Gebucht geändert',
              occurredAt: '2031-02-03T10:00:00.000Z',
              eventVersion: 3,
            },
          ],
          websiteInquiryAvailable: false,
        },
      });
    if (path === '/api/v1/mail/messages')
      return route.fulfill({
        json: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            accountId: '77777777-7777-4777-8777-777777777777',
            direction: 'out',
            folder: 'sent',
            editState: 'open',
            sendState: 'sent',
            subject: 'Fiktives Angebot zur Sommerhochzeit',
            from: 'fictional.sender@example.invalid',
            to: 'kundin@example.invalid',
            contactId: null,
            eventId: id,
            threadKey: null,
            createdAt: '2031-02-03T10:00:00.000Z',
            sentAt: '2031-02-03T10:00:05.000Z',
            sendErrorCode: null,
          },
        ],
      });
    if (path === '/api/v1/mail/messages/99999999-9999-4999-8999-999999999999')
      return route.fulfill({
        json: {
          bodyText: 'Hallo,\nanbei das fiktive Angebot.\nViele Grüße',
          cc: '',
        },
      });
    if (path === '/api/v1/events')
      return route.fulfill({
        json: { events: [event], timeZone: 'Europe/Berlin' },
      });
    if (path === '/api/v1/statuses')
      return route.fulfill({
        json: [
          { code: 'inquiry', label: 'Anfrage' },
          { code: 'option', label: 'Option' },
          { code: 'booked', label: 'Gebucht' },
          { code: 'cancelled', label: 'Abgesagt' },
        ],
      });
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
  await page.goto('/#event-' + id);
  await expect(
    page.getByRole('heading', { name: 'Event: Fiktive Sommerhochzeit' }),
  ).toBeVisible();
}

test('the event record reads like Bookitup in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRecord(page);
  const record = page.getByRole('region', {
    name: 'Event-Details',
    exact: true,
  });
  const side = record.locator('.event-record-side');
  const nav = record.getByRole('navigation', { name: 'Bereiche des Events' });
  // The record column stands left of the work area; the areas are a list.
  const [sideBox, bodyBox] = [
    (await side.boundingBox())!,
    (await record.locator('.event-record-body').boundingBox())!,
  ];
  expect(sideBox.x + sideBox.width).toBeLessThan(bodyBox.x);
  const [first, second] = [
    (await nav.getByRole('button').nth(0).boundingBox())!,
    (await nav.getByRole('button').nth(1).boundingBox())!,
  ];
  expect(second.y).toBeGreaterThan(first.y);
  // Duplicate and delete are quiet links below the areas, delete in red.
  const remove = side.getByRole('button', { name: 'Event löschen' });
  expect((await remove.boundingBox())!.y).toBeGreaterThan(second.y);
  expect(
    await remove.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  // Fields, then status/notes/logbook, then the shadowed contact column.
  const [fields, status, aside] = await Promise.all(
    [
      '.event-detail-primary',
      '.event-detail-overview',
      '.event-detail-aside',
    ].map(async (selector) => (await record.locator(selector).boundingBox())!),
  );
  expect(fields!.x).toBeLessThan(status!.x);
  expect(status!.x).toBeLessThan(aside!.x);
  // Status sits on top of notes and logbook in the middle column.
  expect(Math.abs(status!.y - fields!.y)).toBeLessThan(2);
  const contact = record.locator('.event-aside-contact');
  expect(
    await contact.evaluate((el) => getComputedStyle(el).boxShadow),
  ).not.toBe('none');
  await expect(record.getByText('Kontakt und Ort')).toBeHidden();
  // Logbook markers: creation in the accent, a change to booked in green.
  const marker = (index: number) =>
    record
      .locator('.event-logbook li')
      .nth(index)
      .evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
  expect(await marker(0)).toBe('rgb(78, 191, 70)');
  expect(await marker(1)).toBe('rgb(29, 81, 145)');
  // The status choice shows its dot; the current area its 5px marker.
  expect(
    await record
      .getByLabel('Status des Events')
      .evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain('radial-gradient');
  expect(
    await nav
      .getByRole('button', { name: 'Details', exact: true })
      .evaluate((el) => getComputedStyle(el, '::before').width),
  ).toBe('5px');
  expect(
    await nav
      .getByRole('button', { name: 'Details', exact: true })
      .evaluate((el) => getComputedStyle(el).borderTopColor),
  ).toBe('rgba(0, 0, 0, 0)');
  // Every contact link is a 44px row.
  for (const link of await contact.getByRole('link').all())
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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
      path: test.info().outputPath(`event-record-1440-${theme}.png`),
      fullPage: true,
    });
  }
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // On every width the rare actions come after the areas' content.
    if (width === 390)
      expect((await remove.boundingBox())!.y).toBeGreaterThan(
        (await record.locator('.event-detail-aside').boundingBox())!.y,
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`event-record-${width}.png`),
      fullPage: true,
    });
  }
});

test('the event mails read in two panes like Bookitup', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRecord(page);
  const record = page.getByRole('region', {
    name: 'Event-Details',
    exact: true,
  });
  await record.getByRole('button', { name: 'E-Mails', exact: true }).click();
  const open = record.getByRole('button', { name: /Fiktives Angebot/ });
  await open.click();
  const reader = record.getByRole('article', { name: 'Gewählte Mail' });
  await expect(reader.getByText(/anbei das fiktive Angebot/)).toBeVisible();
  const [list, pane] = [
    (await open.boundingBox())!,
    (await reader.boundingBox())!,
  ];
  expect(list.x + list.width).toBeLessThan(pane.x);
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
      path: test.info().outputPath(`event-mails-1440-${theme}.png`),
      fullPage: true,
    });
  }
  // UI-BKP-07: a new mail opens inline in the reading pane, not as a modal.
  await record.getByRole('button', { name: 'Neue Mail schreiben' }).click();
  const compose = record.getByRole('dialog', { name: 'Neue Mail schreiben' });
  await expect(compose).toBeVisible();
  await expect(reader).toBeHidden();
  const composeBox = (await compose.boundingBox())!;
  expect(composeBox.x).toBeGreaterThan(list.x + list.width);
  expect(await compose.getAttribute('aria-modal')).toBeNull();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('event-mail-compose-1440.png'),
    fullPage: true,
  });
  await compose.getByLabel('Betreff').press('Escape');
  await expect(compose).toBeHidden();
  await expect(reader).toBeVisible();
  await expect(
    record.getByRole('button', { name: 'Neue Mail schreiben' }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
