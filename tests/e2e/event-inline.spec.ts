import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openContactEditor(page: Page) {
  const aside = page.locator('.event-aside');
  await expect(aside).toBeAttached();
  const toggle = aside.locator(':scope > summary');
  if (await toggle.isVisible()) await toggle.click();
  const contact = aside.locator('.event-aside-contact');
  await contact.getByText('Kontakte bearbeiten', { exact: true }).click();
  return contact;
}

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
  // The record must have loaded before editing: Escape restores the loaded
  // value, and typing earlier raced the load on slower CI runners.
  await expect(name).toHaveValue('Synthetic event');
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
  const contact = await openContactEditor(page);
  const contactSearch = contact.getByLabel('Hauptkontakt suchen');
  await contactSearch.fill('Fictional');
  await contact.getByRole('button', { name: /Fictional contact/ }).click();
  await contactSearch.press('Escape');
  await expect(contact.getByText(/Kein Kunde ausgewählt/)).toBeVisible();
  await contactSearch.fill('Fictional');
  await contact.getByRole('button', { name: /Fictional contact/ }).click();
  await editor.getByLabel('Eventart').focus();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({
    primaryContactId: '22222222-2222-4222-8222-222222222222',
    version: 2,
  });
  await contact.getByRole('button', { name: 'Kunde entfernen' }).focus();
  await contact.getByRole('button', { name: 'Kunde entfernen' }).press('Enter');
  await expect(contactSearch).toBeFocused();
  expect(writes).toHaveLength(2);
  await editor.getByLabel('Eventart').focus();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toMatchObject({ primaryContactId: null, version: 3 });
  // QW1, UI-BKP-03: the record offers its own copy beside the removal, as
  // quiet links at the foot of the record column.
  await expect(
    page.getByRole('button', { name: 'Event duplizieren' }),
  ).toBeEnabled();
  await page.locator('.event-record-side').screenshot({
    path: test.info().outputPath('event-record-actions.png'),
  });
  for (const width of [320, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    if (width === 1600) {
      const first = await page.locator('.event-detail-primary').boundingBox();
      const middle = await page.locator('.event-detail-overview').boundingBox();
      const aside = await page.locator('.event-detail-aside').boundingBox();
      expect(first!.x).toBeLessThan(middle!.x);
      expect(middle!.x).toBeLessThan(aside!.x);
      expect(Math.abs(first!.y - aside!.y)).toBeLessThan(2);
    }
    await page.screenshot({
      path: test.info().outputPath(`event-inline-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Dunkelmodus aktivieren' }).click();
  for (const width of [320, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`event-layout-dark-${width}.png`),
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
    const contact = await openContactEditor(page);
    const group = contact.getByRole('group', { name: 'Weitere Kontakte' });
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

// QW3: dated notes - the shared rich editor writes a note, the list shows it
// newest first with time and author, and a confirmed removal takes it out.
test('plain event notes are added and removed after confirmation', async ({
  page,
}) => {
  const id = '88888888-8888-4888-8888-888888888888';
  const event = {
    id,
    version: 1,
    name: 'Synthetic notes event',
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
  let notes = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      bodyHtml:
        '<p>Fictional <strong>existing</strong> <a href="https://example.invalid">link</a></p>',
      createdAt: '2026-11-20T09:00:00Z',
      author: null as string | null,
    },
  ];
  const posted: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === `/api/v1/events/${id}/notes` && request.method() === 'POST') {
      const { bodyHtml } = request.postDataJSON() as { bodyHtml: string };
      posted.push(bodyHtml);
      notes = [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          bodyHtml,
          createdAt: '2026-11-25T10:00:00Z',
          author: 'fictional@example.invalid',
        },
        ...notes,
      ];
      return route.fulfill({ status: 201, json: notes });
    }
    if (path.startsWith(`/api/v1/events/${id}/notes/`)) {
      notes = notes.filter((note) => !path.endsWith(note.id));
      return route.fulfill({ json: notes });
    }
    if (path === `/api/v1/events/${id}/notes`)
      return route.fulfill({ json: notes });
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
  const region = page.getByRole('region', { name: 'Notizen', exact: true });
  await expect(region.locator('.event-note-body strong')).toHaveText(
    'existing',
  );
  await expect(region.getByText('Übernommen')).toBeVisible();
  const editor = region.getByRole('textbox', { name: 'Neue Notiz' });
  await expect(editor).toHaveAttribute('rows', '1');
  await editor.click();
  await expect(editor).toHaveAttribute('rows', '4');
  await editor.fill('Rückruf morgen');
  await region.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(region.getByText('Notiz hinzugefügt.')).toBeVisible();
  expect(posted[0]).toBe('<p>Rückruf morgen</p>');
  await expect(region.getByRole('listitem').first()).toContainText(
    'fictional@example.invalid',
  );
  await expect(editor).toHaveValue('');
  await expect(editor).toHaveAttribute('rows', '1');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/i }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await region.screenshot({
        path: test.info().outputPath(`event-notes-${width}-${theme}.png`),
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
    }
  }
  page.once('dialog', (dialog) => void dialog.accept());
  await region
    .getByRole('button', { name: /^Event-Notiz löschen: Notiz vom / })
    .first()
    .click();
  await expect(region.getByText('Notiz gelöscht.')).toBeVisible();
  await expect(region.getByRole('listitem')).toHaveCount(1);
});
