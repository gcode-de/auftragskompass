import { expect, test } from '@playwright/test';

test('contact field Escape cancels and blur saves normalized values', async ({
  page,
}) => {
  const id = '44444444-4444-4444-8444-444444444444';
  let row = {
    id,
    version: 1,
    kind: 'private',
    name: 'Synthetic Person',
    contactPerson: '',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    email: '',
    phone: '',
    mobile: '',
    state: 'active',
  };
  let writes = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      path === `/api/v1/contacts/${id}` &&
      route.request().method() === 'PUT'
    ) {
      const body = route.request().postDataJSON();
      writes++;
      row = {
        ...row,
        ...body,
        email: String(body.email).trim().toLowerCase(),
        version: row.version + 1,
      };
      return route.fulfill({ json: row });
    }
    if (path === '/api/v1/contacts') return route.fulfill({ json: [row] });
    if (path === `/api/v1/contacts/${id}`) return route.fulfill({ json: row });
    if (path === '/api/v1/events')
      return route.fulfill({ json: { events: [], timeZone: 'Europe/Berlin' } });
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
  await page.goto('/#contacts');
  await page
    .getByRole('link', { name: 'Synthetic Person', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp('#contact-' + id));
  const editor = page.getByRole('region', {
    name: 'Kontaktdaten direkt bearbeiten',
  });
  const email = editor.getByLabel('E-Mail-Adresse');
  await email.fill('discard@example.invalid');
  await email.press('Escape');
  await expect(email).toHaveValue('');
  expect(writes).toBe(0);
  await email.fill(' FICTIONAL@EXAMPLE.INVALID ');
  await email.press('Tab');
  await expect.poll(() => writes).toBe(1);
  await expect(email).toHaveValue('fictional@example.invalid');
  await expect(
    page.getByRole('link', { name: 'fictional@example.invalid' }),
  ).toBeVisible();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: test.info().outputPath(`contact-inline-${width}.png`),
      fullPage: true,
    });
  }
  await email.fill('invalid');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Kalender', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp('#contact-' + id));
  await expect(email).toHaveValue('invalid');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('#contact-' + id));
  await expect(email).toHaveValue('invalid');
  expect(writes).toBe(1);
  await email.press('Escape');
  await expect(email).toHaveValue('fictional@example.invalid');
  await page.goBack();
  await expect(page).toHaveURL(/#contacts$/);
});
