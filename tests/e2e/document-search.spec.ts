import { expect, test } from '@playwright/test';

test('document search filters the list and preserves its own URL state', async ({
  page,
}) => {
  const documentRequests: URL[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/documents') documentRequests.push(url);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        url.pathname === '/api/v1/documents'
          ? [
              {
                id: '11111111-1111-4111-8111-111111111111',
                kind: 'invoice',
                templateId: null,
                eventId: null,
                contactId: null,
                number: 'RE-2031-0001',
                state: 'final',
                issuedAt: '2031-05-02T10:00:00.000Z',
                finalizedAt: '2031-05-02T10:00:00.000Z',
                netMinor: 123456,
                taxMinor: 0,
                grossMinor: 123456,
                version: 2,
                eventName: null,
                issuedDate: '2031-05-02',
                pdfAvailable: true,
                dueDate: null,
                paymentState: 'none',
                openMinor: 123456,
                overdue: false,
              },
            ]
          : url.pathname === '/api/v1/events'
            ? { events: [], timeZone: 'Europe/Berlin' }
            : [],
      ),
    });
  });
  await page.route('**/auth/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unused synthetic auth request' }),
    }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'x-auth-mode': 'password' },
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'fictional.owner@example.invalid',
        csrfToken: 'fictional-search-csrf',
      }),
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?q=global&df_q=invoice&df_page=1#files');
  const search = page.getByRole('searchbox', {
    name: 'Dokumente durchsuchen',
  });
  await expect(search).toHaveCount(1);
  await expect(search).toBeVisible();
  await expect(search).toHaveValue('invoice');
  await expect
    .poll(() => documentRequests.at(-1)?.searchParams.get('q'))
    .toBe('invoice');
  await expect
    .poll(() => documentRequests.at(-1)?.searchParams.get('offset'))
    .toBe('25');

  await search.fill('');
  await search.click();
  await search.pressSequentially('Max Muster');
  await expect(search).toHaveValue('Max Muster');
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/df_q=Max\+Muster/);
  await expect(page).toHaveURL(/q=global/);
  await expect(page).not.toHaveURL(/df_page=/);
  await expect
    .poll(() => documentRequests.at(-1)?.searchParams.get('q'))
    .toBe('Max Muster');
  await expect
    .poll(() => documentRequests.at(-1)?.searchParams.get('offset'))
    .toBe('0');
  await expect(page.getByText('Rechnung RE-2031-0001')).toBeVisible();

  await page.goBack();
  await expect(search).toHaveValue('Max Muste');
  await search.fill('Max Muster');
  await expect(search).toBeFocused();
  await expect
    .poll(() => documentRequests.at(-1)?.searchParams.get('q'))
    .toBe('Max Muster');

  const screenshot = test.info().outputPath('document-search.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await test.info().attach('document-search.png', {
    path: screenshot,
    contentType: 'image/png',
  });
});
