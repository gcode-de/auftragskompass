import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI-BKP-05: the document overview in Bookitup's shape with fictional rows -
// document kinds as list rows, the state as a segmented switch, the deadline
// badge in its three tones, the event pill with its status dot and the row
// actions behind a native ⋯ popover.
const row = (
  id: number,
  kind: string,
  number: string,
  extra: Record<string, unknown>,
) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  kind,
  templateId: null,
  eventId: '10000000-0000-4000-8000-000000000001',
  contactId: null,
  number,
  state: 'final',
  issuedAt: '2031-05-02T10:00:00.000Z',
  finalizedAt: '2031-05-02T10:00:00.000Z',
  netMinor: 100000,
  taxMinor: 19000,
  grossMinor: 119000,
  version: 1,
  eventName: 'Fiktive Firmenfeier',
  eventStatus: 'booked',
  offerStatus: null,
  validUntil: null,
  offerExpired: false,
  issuedDate: '2031-05-02',
  pdfAvailable: true,
  dueDate: null,
  paymentState: null,
  openMinor: null,
  overdue: null,
  ...extra,
});
const rows = [
  row(1, 'offer', 'AN-2031-0001', { validUntil: '2031-05-16' }),
  row(2, 'offer', 'AN-2031-0002', {
    validUntil: '2031-05-16',
    offerStatus: 'accepted',
    eventStatus: 'option',
  }),
  row(3, 'invoice', 'RE-2031-0001', {
    dueDate: '2031-05-16',
    paymentState: 'none',
    openMinor: 119000,
    overdue: true,
    eventStatus: 'inquiry',
  }),
  row(4, 'invoice', 'RE-2031-0002', {
    dueDate: '2031-05-16',
    paymentState: 'paid',
    openMinor: 0,
    overdue: false,
  }),
];

async function open(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/documents') return route.fulfill({ json: rows });
    if (path === '/api/v1/events')
      return route.fulfill({ json: { events: [], timeZone: 'Europe/Berlin' } });
    if (path === '/api/v1/documents/receivables')
      return route.fulfill({
        json: {
          count: 1,
          openMinor: 119000,
          overdueCount: 1,
          overdueMinor: 119000,
        },
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
  await page.goto('/#documents');
}

test('the document overview reads like Bookitup in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const documents = page.getByRole('region', {
    name: 'Dokumente',
    exact: true,
  });
  await expect(documents.getByText('Angebot AN-2031-0001')).toBeVisible();
  // UI-BKP-08: the filters stand as the full-height column beside the rail;
  // the page title stays visible in the top bar.
  const column = (await documents
    .getByRole('complementary', { name: 'Dokumentfilter' })
    .boundingBox())!;
  expect(column.x).toBe(60);
  expect(column.y).toBe(0);
  await expect(
    page.getByRole('heading', { level: 1, name: /Dokumente/ }),
  ).toBeVisible();
  // UI-BKP-10: the document name opens it in its event's Dateien.
  const opener = documents.getByRole('link', { name: 'Angebot AN-2031-0001' });
  expect(
    new URL((await opener.getAttribute('href'))!, page.url()).searchParams.get(
      'doc',
    ),
  ).toBe('00000000-0000-4000-8000-000000000001');
  const kinds = documents.getByRole('group', { name: 'Dokumentart' });
  await expect(
    kinds.getByRole('button', { name: 'Alle Arten' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const badge = (name: string) =>
    documents.getByRole('row').filter({ hasText: name }).locator('.files-due');
  await expect(badge('Angebot AN-2031-0001')).toHaveText(
    'Gültig bis 16.05.2031',
  );
  await expect(badge('Angebot AN-2031-0002')).toHaveAttribute(
    'data-tone',
    'ok',
  );
  await expect(badge('Rechnung RE-2031-0001')).toHaveAttribute(
    'data-tone',
    'late',
  );
  // The pill dot takes the event status colour.
  const dot = await documents
    .getByRole('row')
    .filter({ hasText: 'Rechnung RE-2031-0001' })
    .locator('.files-event-pill')
    .evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
  expect(dot).toBe('rgb(29, 81, 145)');
  // The ⋯ menu opens in the top layer under its toggle and closes on Escape.
  const toggle = documents.getByRole('button', {
    name: 'Weitere Aktionen: Rechnung RE-2031-0002',
  });
  await toggle.click();
  const pdf = documents.getByRole('link', {
    name: 'Rechnung RE-2031-0002 als PDF öffnen',
  });
  await expect(pdf).toBeVisible();
  const [menuBox, toggleBox] = [
    (await pdf.locator('..').boundingBox())!,
    (await toggle.boundingBox())!,
  ];
  expect(menuBox.y).toBeGreaterThanOrEqual(toggleBox.y + toggleBox.height - 1);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
    toggleBox.x + toggleBox.width + 1,
  );
  await page.keyboard.press('Escape');
  await expect(pdf).toBeHidden();
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
      path: test.info().outputPath(`document-list-1440-${theme}.png`),
      fullPage: true,
    });
  }
  // A kind row and a state segment write the filter into the request.
  await kinds.getByRole('button', { name: 'Rechnung', exact: true }).click();
  await expect(
    kinds.getByRole('button', { name: 'Rechnung', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => new URL(page.url()).search)
    .toContain('df_kind=invoice');
  const state = documents.getByRole('group', { name: 'Status' });
  await state.getByRole('button', { name: 'Entwurf' }).click();
  await expect(state.getByRole('button', { name: 'Entwurf' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
