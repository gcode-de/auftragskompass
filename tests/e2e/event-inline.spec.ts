import { expect, test } from '@playwright/test';

test('event details save fields on blur and Escape discards the current edit', async ({
  page,
}) => {
  const id = '11111111-1111-4111-8111-111111111111';
  let event = {
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
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/v1/events/${id}` && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      writes.push(input);
      event = { ...event, ...input, version: event.version + 1 };
      return route.fulfill({ json: event });
    }
    if (path === `/api/v1/events/${id}`)
      return route.fulfill({
        json: {
          event,
          contacts: [],
          location: null,
          eventType: null,
          package: null,
          activities: [],
          websiteInquiryAvailable: false,
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
  const editor = page.getByRole('region', {
    name: 'Eventstammdaten direkt bearbeiten',
  });
  const name = editor.getByLabel('Eventname');
  await name.fill('Discard');
  await name.press('Escape');
  await expect(name).toHaveValue('Synthetic event');
  expect(writes).toHaveLength(0);
  await name.fill('Changed event');
  await name.press('Tab');
  await expect.poll(() => writes.length).toBe(1);
  await expect(
    page.getByRole('heading', { name: 'Event: Changed event' }),
  ).toBeVisible();
  expect(writes[0]).toMatchObject({
    name: 'Changed event',
    version: 1,
    status: 'inquiry',
  });
  expect(writes[0]).not.toHaveProperty('id');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: test.info().outputPath(`event-inline-${width}.png`),
      fullPage: true,
    });
  }
});
