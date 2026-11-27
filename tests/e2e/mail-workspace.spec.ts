import { expect, test } from '@playwright/test';

test('the mailbox has its own main navigation and returns from the mobile reader', async ({
  page,
}, info) => {
  const id = '77777777-7777-4777-8777-777777777777';
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/events')
      return route.fulfill({ json: { events: [], timeZone: 'Europe/Berlin' } });
    if (url.pathname === '/api/v1/website-inquiries')
      return route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 25 },
      });
    if (
      url.pathname === '/api/v1/mail/messages' &&
      url.searchParams.get('folder') === 'sent'
    ) {
      return route.fulfill({
        json: [
          {
            id,
            direction: 'out',
            sendState: 'sent',
            subject: 'Fiktives Angebot',
            to: 'fictional@example.invalid',
            createdAt: '2030-07-12T14:30:00Z',
            sentAt: '2030-07-12T14:32:00Z',
          },
        ],
      });
    }
    if (url.pathname === '/api/v1/mail/messages/' + id)
      return route.fulfill({
        json: { bodyText: 'Hallo, hier ist das fiktive Angebot.', cc: '' },
      });
    return route.fulfill({ json: [] });
  });
  await page.route('**/auth/**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      headers: { 'x-auth-mode': 'password' },
      json: { email: 'fictional@example.invalid', csrfToken: 'synthetic' },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#events');
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Mails', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Website-Anfragen' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Gesendet', exact: true }).click();
  const mail = page.getByRole('button', { name: /Fiktives Angebot/ });
  await mail.click();
  await expect(
    page.getByText('Hallo, hier ist das fiktive Angebot.'),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('postfach-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mail).toBeHidden();
  await page.screenshot({ path: info.outputPath('postfach-mobil.png') });
  await page.getByRole('button', { name: '← Zurück' }).click();
  await expect(mail).toBeVisible();
  await expect(mail).toBeFocused();
});
