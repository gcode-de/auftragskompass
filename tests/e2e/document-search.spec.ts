import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function mockDocuments(page: Page) {
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
            : // QW4: the receivables line above the list.
              url.pathname === '/api/v1/documents/receivables'
              ? {
                  count: 1,
                  openMinor: 123456,
                  overdueCount: 1,
                  overdueMinor: 123456,
                }
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

  return documentRequests;
}

test('document search filters the list and preserves its own URL state', async ({
  page,
}) => {
  const documentRequests = await mockDocuments(page);
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

for (const theme of ['light', 'dark'] as const) {
  test(`document workspace stays flat and usable in ${theme} mode`, async ({
    page,
  }) => {
    await mockDocuments(page);
    await page.addInitScript(
      (value) => localStorage.setItem('ak-theme', value),
      theme,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#documents');

    const documents = page.getByRole('region', {
      name: 'Dokumente',
      exact: true,
    });
    const filters = documents.getByRole('complementary', {
      name: 'Dokumentfilter',
    });
    const table = documents.getByRole('table');
    await expect(
      table.getByRole('rowheader', { name: 'Rechnung RE-2031-0001' }),
    ).toBeVisible();
    await expect(filters.getByRole('searchbox')).toBeVisible();
    await expect(documents.getByText(/Offene Posten:/)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const themeSurfaces = {
      section: documents,
      filters,
      table: documents.locator('.files-table-shell'),
    };
    for (const [name, surface] of Object.entries(themeSurfaces)) {
      await expect
        .soft(surface, name)
        .toHaveCSS('background-color', 'rgba(0, 0, 0, 0)', { timeout: 750 });
      await expect
        .soft(surface, name)
        .toHaveCSS('border-top-width', '0px', { timeout: 750 });
    }
    const filterBox = (await filters.boundingBox())!;
    const tableBox = (await table.boundingBox())!;
    // The filter column and the results column start on one line; the
    // results open with the receivables line (QW4) above the table.
    const resultsBox = (await documents
      .locator('.files-results')
      .boundingBox())!;
    expect(filterBox.x + filterBox.width).toBeLessThan(tableBox.x);
    expect.soft(filterBox.y).toBeCloseTo(resultsBox.y, 0);

    for (const width of [1440, 1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(table).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      if (width === 1440 || width === 390) {
        await page.screenshot({
          path: test.info().outputPath(`documents-${theme}-${width}.png`),
          fullPage: true,
        });
        const accessibility = await new AxeBuilder({ page })
          .include('#files')
          .analyze();
        expect(accessibility.violations).toEqual([]);
      }
    }

    const trigger = documents.getByRole('button', { name: /^Filter,/ });
    const dialog = documents.getByRole('dialog', { name: 'Dokumentfilter' });
    await trigger.focus();
    const scrollRegion = documents.getByRole('region', {
      name: 'Dokumenttabelle',
    });
    // QW4: the two receivables shortcuts sit between the filter access and
    // the table, in reading order.
    await page.keyboard.press('Tab');
    await expect(
      documents.getByRole('button', { name: 'Offene anzeigen' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      documents.getByRole('button', { name: 'Überfällige anzeigen' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(scrollRegion).toBeFocused();
    await expect(scrollRegion).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => scrollRegion.evaluate((region) => region.scrollLeft))
      .toBeGreaterThan(0);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('searchbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#files');
    const files = page.getByRole('region', { name: 'Dateien', exact: true });
    await expect(files).toHaveCSS('border-top-width', '1px');
    await expect(
      files.getByRole('complementary', { name: 'Dateifilter' }),
    ).toHaveCSS('border-top-width', '1px');
  });
}
