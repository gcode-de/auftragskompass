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
  // The status marker gets its own column and cannot overlap native text.
  const [dot, statusSelect] = await Promise.all([
    record.locator('.event-status-dot').boundingBox(),
    record.getByLabel('Status des Events').boundingBox(),
  ]);
  expect(dot!.x + dot!.width).toBeLessThan(statusSelect!.x);
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

test('the location dialog is keyboard-accessible in both themes and widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openRecord(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const aside = page.locator('details.event-aside');
    if (width === 390) await aside.locator(':scope > summary').click();
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/i }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const trigger = aside.getByRole('button', { name: 'Location anlegen' });
      await trigger.focus();
      await trigger.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Location anlegen' });
      await expect(
        dialog.getByRole('textbox', { name: 'Name', exact: true }),
      ).toBeFocused();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`event-location-${width}-${theme}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  }
});

const suggestion = {
  formatted: 'Fiktiver Festsaal, Musterweg 2, Beispielstadt',
  name: 'Fiktiver Festsaal',
  street: 'Musterweg 2',
  postalCode: '00000',
  city: 'Beispielstadt',
  country: 'DE',
  attribution: 'Geoapify · OpenStreetMap',
};

test('company and location suggestions prefill editable addresses in Chromium', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openRecord(page);
  await page.route('**/api/v1/address-suggestions', (route) =>
    route.fulfill({ json: [suggestion] }),
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const aside = page.locator('details.event-aside');
    if (width === 390) await aside.locator(':scope > summary').click();
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/i }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await aside.getByRole('button', { name: 'Location anlegen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Location anlegen' });
      const name = dialog.getByLabel('Name', { exact: true });
      await name.fill('Fiktiver Fest');
      const result = dialog.getByRole('button', { name: /Fiktiver Festsaal/ });
      await expect(result).toBeVisible();
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await dialog.screenshot({
        path: test
          .info()
          .outputPath(`location-suggestions-${width}-${theme}.png`),
      });
      await name.press('ArrowDown');
      await expect(result).toBeFocused();
      await result.press('Enter');
      await expect(dialog.getByLabel('Straße und Hausnummer')).toHaveValue(
        suggestion.street,
      );
      page.once('dialog', (confirm) => confirm.accept());
      await dialog
        .getByRole('button', { name: 'Abbrechen', exact: true })
        .click();
      await expect(dialog).toBeHidden();
    }
  }
  await page.goto('/#contacts');
  await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
  const contact = page.getByRole('dialog', { name: 'Kontakt anlegen' });
  await contact.getByLabel('Kontaktart').selectOption('company');
  await contact.getByLabel('Name / Firma').fill('Fiktiver Fest');
  await contact.getByRole('button', { name: /Fiktiver Festsaal/ }).click();
  await expect(contact.getByLabel('Postleitzahl')).toHaveValue(
    suggestion.postalCode,
  );
  await contact.getByLabel('Straße und Hausnummer').fill('Fiktive Korrektur');
  await expect(contact.getByLabel('Straße und Hausnummer')).toHaveValue(
    'Fiktive Korrektur',
  );
});

test.describe('address suggestions with touch input', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test('a tap fills both new address forms', async ({ page }) => {
    await openRecord(page);
    await page.route('**/api/v1/address-suggestions', (route) =>
      route.fulfill({ json: [suggestion] }),
    );
    const aside = page.locator('details.event-aside');
    await aside.locator(':scope > summary').tap();
    await aside.getByRole('button', { name: 'Location anlegen' }).tap();
    const location = page.getByRole('dialog', { name: 'Location anlegen' });
    const name = location.getByLabel('Name', { exact: true });
    const result = location.getByRole('button', { name: /Fiktiver Festsaal/ });
    const street = location.getByLabel('Straße und Hausnummer');
    await name.fill('Fiktiver Fes');
    await expect(result).toBeVisible();
    await street.tap();
    await expect(result).toBeHidden();
    await name.fill('Fiktiver Fest');
    await result.tap();
    await expect(street).toHaveValue(suggestion.street);
    await expect(location.getByLabel('PLZ')).toHaveValue(suggestion.postalCode);
    await expect(location.getByLabel('Ort', { exact: true })).toHaveValue(
      suggestion.city,
    );
    page.once('dialog', (confirm) => confirm.accept());
    await location.getByRole('button', { name: 'Abbrechen' }).tap();

    await page.goto('/#contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).tap();
    const contact = page.getByRole('dialog', { name: 'Kontakt anlegen' });
    await contact.getByLabel('Kontaktart').selectOption('company');
    await contact.getByLabel('Name / Firma').fill('Fiktiver Fest');
    await contact.getByRole('button', { name: /Fiktiver Festsaal/ }).tap();
    await expect(contact.getByLabel('Straße und Hausnummer')).toHaveValue(
      suggestion.street,
    );
    await expect(contact.getByLabel('Postleitzahl')).toHaveValue(
      suggestion.postalCode,
    );
    await expect(contact.getByLabel('Ort', { exact: true })).toHaveValue(
      suggestion.city,
    );
  });
});

test('the list clears old deep links and opens the top of a simpler mobile event record', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecord(page);
  await page.goto(
    '/?doc=55555555-5555-4555-8555-555555555555&unused=kept#events',
  );
  await page
    .getByRole('link', { name: /Öffnen:.*Fiktive Sommerhochzeit/ })
    .click();
  await expect(page).not.toHaveURL(/doc=/);
  await expect(page).toHaveURL(/unused=kept#event-/);
  const record = page.getByRole('region', { name: 'Event-Details' });
  const back = record.getByRole('button', { name: 'Zurück', exact: true });
  await expect(back).toBeInViewport();
  await expect(
    record.getByRole('button', { name: 'Details', exact: true }),
  ).toHaveAttribute('aria-current', 'location');
  await expect(record.getByRole('heading', { name: 'Zeitplan' })).toHaveCount(
    0,
  );
  await expect(record.getByLabel('Terminbeginn')).toHaveAttribute('step', '60');
  await expect(record.getByLabel('Terminbeginn')).toHaveValue(
    '2031-07-12T18:00',
  );

  const status = record.getByLabel('Status des Events');
  const marker = record.locator('.event-status-dot');
  expect(
    (await marker.boundingBox())!.x + (await marker.boundingBox())!.width,
  ).toBeLessThan((await status.boundingBox())!.x);

  const aside = record.locator('details.event-aside');
  await aside.locator(':scope > summary').click();
  await aside.getByText('Kontakte bearbeiten', { exact: true }).click();
  await expect(aside.getByLabel('Hauptkontakt suchen')).toBeVisible();
  await expect(aside.getByLabel('Weitere Kontakte suchen')).toBeVisible();
  await expect(
    record.locator('.event-detail-main').getByLabel('Hauptkontakt suchen'),
  ).toHaveCount(0);

  await page.route('**/api/v1/events/*/notes', (route) =>
    route.fulfill({
      json: [
        {
          id: 'fictional-note',
          bodyHtml: '<p>Fiktive Notiz</p>',
          createdAt: '2031-07-12T12:00:00Z',
          author: null,
        },
      ],
      status: 201,
    }),
  );
  const note = record.getByLabel('Neue Notiz');
  await expect(note).toHaveAttribute('rows', '1');
  await note.focus();
  await expect(note).toHaveAttribute('rows', '4');
  await note.fill('Fiktive Notiz');
  await record.getByRole('button', { name: 'Notiz speichern' }).click();
  const notice = record.getByText('Notiz hinzugefügt.');
  await expect(notice).toBeInViewport();
  expect(
    await notice.locator('..').evaluate((el) => getComputedStyle(el).position),
  ).toBe('fixed');
  await expect(note).toHaveAttribute('rows', '1');
  await record.getByRole('button', { name: 'Meldung schließen' }).click();
  await expect(notice).toBeHidden();
  await back.click();
  await expect(page).toHaveURL(/#events$/);
  const listView = page.getByRole('navigation', {
    name: 'Ansicht',
    exact: true,
  });
  await listView.getByRole('link', { name: 'Kalender' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Kalender' })
      .getByRole('link', { name: 'Kalender' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  const menu = page
    .getByRole('dialog')
    .getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(
    menu.getByRole('link', { name: 'Kalender', exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole('link', { name: 'Events', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
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
