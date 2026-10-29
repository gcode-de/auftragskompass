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
    if (path === '/api/v1/contacts')
      return route.fulfill({
        json: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Fictional contact',
            state: 'active',
          },
        ],
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
  const contactSearch = editor.getByLabel('Hauptkontakt suchen');
  await contactSearch.fill('Fictional');
  await editor.getByRole('button', { name: /Fictional contact/ }).click();
  await contactSearch.press('Escape');
  await expect(editor.getByText(/Kein Kunde ausgewählt/)).toBeVisible();
  await contactSearch.fill('Fictional');
  await editor.getByRole('button', { name: /Fictional contact/ }).click();
  await editor.getByLabel('Eventart').focus();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({
    primaryContactId: '22222222-2222-4222-8222-222222222222',
    version: 2,
  });
  await editor.getByRole('button', { name: 'Kunde entfernen' }).focus();
  await editor.getByRole('button', { name: 'Kunde entfernen' }).press('Enter');
  await expect(contactSearch).toBeFocused();
  expect(writes).toHaveLength(2);
  await editor.getByLabel('Eventart').focus();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toMatchObject({ primaryContactId: null, version: 3 });
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

for (const width of [320, 1280]) {
  test(`additional event contacts save by blur and retain keyboard focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const id = '33333333-3333-4333-8333-333333333333';
    const primary = '44444444-4444-4444-8444-444444444444';
    const first = '55555555-5555-4555-8555-555555555555';
    const second = '66666666-6666-4666-8666-666666666666';
    const people = [
      { id: primary, name: 'Fictional primary', state: 'active' },
      { id: first, name: 'Fictional first', state: 'active' },
      { id: second, name: 'Fictional second', state: 'active' },
    ];
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
      primaryContactId: primary,
      additionalContactIds: [] as string[],
      source: '',
      description: '',
      notesHtml: '',
    };
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (
        path === `/api/v1/events/${id}` &&
        route.request().method() === 'PUT'
      ) {
        const input = route.request().postDataJSON();
        writes.push(input);
        event = { ...event, ...input, version: event.version + 1 };
        return route.fulfill({ json: event });
      }
      if (path === `/api/v1/events/${id}`)
        return route.fulfill({
          json: {
            event,
            contacts: [
              {
                ...people[0],
                contactPerson: '',
                email: '',
                phone: '',
                mobile: '',
                role: 'primary',
              },
            ],
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
      if (path === '/api/v1/contacts') return route.fulfill({ json: people });
      if (path === '/api/v1/statuses')
        return route.fulfill({ json: [{ code: 'inquiry', label: 'Anfrage' }] });
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
    const group = editor.getByRole('group', { name: 'Weitere Kontakte' });
    const search = group.getByLabel('Weitere Kontakte suchen');
    await search.fill('Fictional');
    await group.getByRole('button', { name: /Fictional first/ }).click();
    await search.focus();
    await search.press('Escape');
    await expect(
      group.getByRole('button', { name: 'Fictional first entfernen' }),
    ).toHaveCount(0);
    expect(writes).toHaveLength(0);
    await search.fill('Fictional');
    await group.getByRole('button', { name: /Fictional first/ }).click();
    await expect(search).toBeFocused();
    const secondResult = group.getByRole('button', {
      name: /Fictional second/,
    });
    await secondResult.focus();
    await secondResult.press('Enter');
    await expect(search).toBeFocused();
    await editor.getByLabel('Eventart').focus();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      version: 1,
      primaryContactId: primary,
      additionalContactIds: [first, second],
    });
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/i }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await group.screenshot({
        path: test
          .info()
          .outputPath(`additional-contacts-${width}-${theme}.png`),
      });
    }
    const remove = group.getByRole('button', {
      name: 'Fictional first entfernen',
    });
    await remove.focus();
    await remove.press('Enter');
    await expect(search).toBeFocused();
    expect(writes).toHaveLength(1);
    await editor.getByLabel('Eventart').focus();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({
      version: 2,
      primaryContactId: primary,
      additionalContactIds: [second],
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
  });
}

test('event record edits a date-only schedule with Escape and versioned blur save', async ({
  page,
}) => {
  const id = '77777777-7777-4777-8777-777777777777';
  let event = {
    id,
    version: 1,
    name: 'Synthetic schedule event',
    status: 'inquiry',
    eventDate: null as string | null,
    startsAt: null as string | null,
    endsAt: null as string | null,
    timeZone: 'Europe/Berlin',
    eventTypeId: null,
    packageId: null,
    locationId: null,
    venue: null,
    venueOverride: false,
    primaryContactId: null,
    additionalContactIds: [] as string[],
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
    if (path === '/api/v1/contacts') return route.fulfill({ json: [] });
    if (path === '/api/v1/statuses')
      return route.fulfill({
        json: [{ code: 'inquiry', label: 'Anfrage' }],
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
  const schedule = editor.getByRole('group', { name: 'Termin' });
  const date = schedule.getByLabel('Eventdatum');
  await date.fill('2026-11-03');
  await date.press('Escape');
  await expect(date).toHaveValue('');
  expect(writes).toHaveLength(0);
  await date.fill('2026-11-03');
  await editor.getByLabel('Eventname').focus();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    eventDate: '2026-11-03',
    startsAt: null,
    endsAt: null,
    version: 1,
  });
  expect(writes[0]).not.toHaveProperty('assignments');
  await expect(schedule.getByLabel('Eventdatum')).toHaveValue('2026-11-03');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/i }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await schedule.screenshot({
        path: test.info().outputPath(`event-schedule-${width}-${theme}.png`),
      });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
  }
});
