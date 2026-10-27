import { expect, test } from '@playwright/test';

test('an event can link and remove a library file', async ({ page }) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const file = {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Synthetic.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 42,
    state: 'available',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: null,
  };
  const event = {
    id,
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
  let linked = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    if (path === `/api/v1/events/${id}/library-files/${file.id}`) {
      linked = method === 'PUT';
      return route.fulfill(method === 'PUT' ? { json: file } : { status: 204 });
    }
    const result =
      path === '/api/v1/events'
        ? { events: [event], timeZone: 'Europe/Berlin' }
        : path === `/api/v1/events/${id}`
          ? {
              event,
              contacts: [],
              location: null,
              eventType: null,
              package: null,
              activities: [],
              websiteInquiryAvailable: false,
            }
          : path === `/api/v1/events/${id}/library-files`
            ? linked
              ? [file]
              : []
            : path === '/api/v1/library-files'
              ? [file]
              : path === '/api/v1/statuses'
                ? [{ code: 'inquiry', label: 'Anfrage' }]
                : [];
    return route.fulfill({ json: result });
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
  await page
    .getByRole('navigation', { name: 'Bereiche des Events' })
    .getByRole('button', { name: 'Dateien' })
    .click();
  const files = page.getByRole('region', {
    name: 'Eventdateien aus der Bibliothek',
  });
  const picker = files.getByLabel('Datei aus der Bibliothek');
  await picker.selectOption(file.id);
  await picker.focus();
  await page.keyboard.press('Tab');
  const assign = files.getByRole('button', { name: 'Datei zuordnen' });
  await expect(assign).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    files.getByRole('link', { name: 'Herunterladen: Synthetic.pdf' }),
  ).toBeVisible();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: test.info().outputPath(`event-files-${width}.png`),
      fullPage: true,
    });
  }
  await files
    .getByRole('button', { name: 'Zuordnung entfernen: Synthetic.pdf' })
    .click();
  await expect(files.getByText('Zuordnung entfernt.')).toBeVisible();
});
