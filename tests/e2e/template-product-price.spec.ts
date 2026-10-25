import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const templateId = '11111111-1111-4111-8111-111111111111';
const netProductId = '22222222-2222-4222-8222-222222222222';
const grossProductId = '33333333-3333-4333-8333-333333333333';
const overflowProductId = '44444444-4444-4444-8444-444444444444';

const originalTemplate = {
  id: templateId,
  version: 1,
  kind: 'offer',
  name: 'Fiktive Bruttopreisvorlage',
  subject: 'Fiktives Angebot für {{contact}}',
  introText: 'Fiktive Einleitung',
  outroText: 'Fiktiver Schlusstext',
  validityDays: 14,
  state: 'active',
  positions: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      productId: null,
      description: 'Fiktive bestehende Position',
      quantity: 1,
      unit: 'Pauschale',
      unitPriceMinor: 8888,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
  ],
};

const sourceProducts = [
  {
    id: netProductId,
    name: 'Fiktives Nettoprodukt',
    unit: 'Stück',
    priceMinor: 10000,
    priceBasis: 'net',
    taxBasisPoints: 1900,
    state: 'active',
  },
  {
    id: grossProductId,
    name: 'Fiktives Bruttoprodukt',
    unit: 'Stück',
    priceMinor: 11900,
    priceBasis: 'gross',
    taxBasisPoints: 1900,
    state: 'active',
  },
  {
    id: overflowProductId,
    name: 'Fiktives übergroßes Nettoprodukt',
    unit: 'Stück',
    priceMinor: Number.MAX_SAFE_INTEGER,
    priceBasis: 'net',
    taxBasisPoints: 1,
    state: 'active',
  },
];

type Write = {
  method: string;
  path: string;
  body: Record<string, unknown>;
};

type TemplateStubOptions = {
  conflictArchiveOnce?: boolean;
  failListGetAfterArchiveOnce?: boolean;
};

async function stubTemplateApis(
  page: Page,
  catalog = sourceProducts,
  options: TemplateStubOptions = {},
) {
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL must be configured for this E2E');
  }
  const allowedOrigin = new URL(baseURL).origin;
  let savedTemplate = structuredClone(originalTemplate);
  const writes: Write[] = [];
  const unexpectedApiWrites: string[] = [];
  let listGets = 0;
  let archiveAttempts = 0;
  let archived = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      writes.push({
        method: request.method(),
        path,
        body: request.postDataJSON() as Record<string, unknown>,
      });
      unexpectedApiWrites.push(`${request.method()} ${path}`);
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unexpected synthetic API request' }),
    });
  });
  await page.route('**/auth/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unexpected synthetic auth request' }),
    }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'x-auth-mode': 'password' },
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'fictional.owner@example.invalid',
        csrfToken: 'fictional-template-csrf',
      }),
    }),
  );
  await page.route('**/api/v1/products', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(catalog),
        })
      : route.fulfill({ status: 405, body: '' }),
  );
  await page.route('**/api/v1/document-templates', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    listGets += 1;
    if (archived && options.failListGetAfterArchiveOnce) {
      options.failListGetAfterArchiveOnce = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic list unavailable' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([savedTemplate]),
    });
  });
  await page.route(
    `**/api/v1/document-templates/${templateId}`,
    async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.fulfill({ status: 405, body: '' });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({
        method: 'PUT',
        path: `/api/v1/document-templates/${templateId}`,
        body,
      });
      if (body.state === 'archived') {
        archiveAttempts += 1;
        if (options.conflictArchiveOnce && archiveAttempts === 1) {
          savedTemplate = {
            ...savedTemplate,
            version: savedTemplate.version + 1,
            subject: 'Fiktiv extern geänderte Vorlage',
          };
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'conflict' }),
          });
          return;
        }
        archived = true;
      }
      savedTemplate = {
        ...savedTemplate,
        ...body,
        version: savedTemplate.version + 1,
      } as typeof originalTemplate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(savedTemplate),
      });
    },
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== allowedOrigin) {
      await route.abort();
      return;
    }
    await route.fallback();
  });

  return {
    writes,
    unexpectedApiWrites,
    products: structuredClone(catalog),
    getListGets: () => listGets,
    getArchiveAttempts: () => archiveAttempts,
  };
}

async function openTemplateEditor(page: Page) {
  await page.goto('/#settings-templates');
  await expect(
    page.getByRole('heading', { name: 'Dokumentvorlagen' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    })
    .click();
  return page.getByRole('group', { name: 'Position 1' });
}

test('template copies net product prices as gross, keeps overrides and guards overflow in Chromium', async ({
  page,
}) => {
  test.setTimeout(120000);
  const { writes, unexpectedApiWrites, products } =
    await stubTemplateApis(page);
  const firstPosition = await openTemplateEditor(page);

  await firstPosition.getByLabel('Produkt').selectOption(netProductId);
  const priceLabel = 'Einzelpreis (Brutto) in Euro';
  const price = firstPosition.getByLabel(priceLabel);
  await expect(price).toHaveValue('119.00');
  await firstPosition
    .getByLabel('Beschreibung')
    .fill('Fiktiver eigener Pakettext');
  await price.fill('119.00');

  await page.getByRole('button', { name: 'Position hinzufügen' }).click();
  const secondPosition = page.getByRole('group', { name: 'Position 2' });
  await secondPosition.getByLabel('Produkt').selectOption(grossProductId);
  await expect(secondPosition.getByLabel(priceLabel)).toHaveValue('119.00');

  await page.getByRole('button', { name: 'Position hinzufügen' }).click();
  const thirdPosition = page.getByRole('group', { name: 'Position 3' });
  await thirdPosition
    .getByLabel('Beschreibung')
    .fill('Fiktive vorherige Beschreibung');
  await thirdPosition.getByLabel('Einheit').fill('Pauschale');
  await thirdPosition.getByLabel(priceLabel).fill('88.88');
  await thirdPosition.getByLabel('Steuersatz in Prozent').fill('7.00');
  await thirdPosition.getByLabel('Produkt').selectOption(overflowProductId);
  await expect(page.getByRole('alert')).toContainText(
    'Produktpreis konnte nicht in den sicheren Bruttobetrag umgerechnet werden. Die Position blieb unverändert.',
  );
  await expect(thirdPosition.getByLabel('Produkt')).toHaveValue('');
  await expect(thirdPosition.getByLabel('Beschreibung')).toHaveValue(
    'Fiktive vorherige Beschreibung',
  );
  await expect(thirdPosition.getByLabel('Einheit')).toHaveValue('Pauschale');
  await expect(thirdPosition.getByLabel(priceLabel)).toHaveValue('88.88');
  await expect(thirdPosition.getByLabel('Steuersatz in Prozent')).toHaveValue(
    '7.00',
  );

  for (const theme of ['light', 'dark'] as const) {
    const toggle = page.getByRole('button', { name: /modus aktivieren/i });
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1280, 390, 320] as const) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width + 1);
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations, `${width}px ${theme}`).toEqual([]);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`template-product-price-${width}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }

  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();
  expect(writes).toEqual([
    {
      method: 'PUT',
      path: `/api/v1/document-templates/${templateId}`,
      body: expect.objectContaining({
        version: 1,
        positions: [
          expect.objectContaining({
            productId: netProductId,
            description: 'Fiktiver eigener Pakettext',
            unitPriceMinor: 11900,
            taxBasisPoints: 1900,
          }),
          expect.objectContaining({
            productId: grossProductId,
            unitPriceMinor: 11900,
            taxBasisPoints: 1900,
          }),
          expect.objectContaining({
            productId: null,
            description: 'Fiktive vorherige Beschreibung',
            unit: 'Pauschale',
            unitPriceMinor: 8888,
            taxBasisPoints: 700,
          }),
        ],
      }),
    },
  ]);
  expect(unexpectedApiWrites).toEqual([]);
  expect(products).toEqual(sourceProducts);
});

test('empty product catalog keeps a free template position editable and saveable', async ({
  page,
}) => {
  const { writes, unexpectedApiWrites } = await stubTemplateApis(page, []);
  const position = await openTemplateEditor(page);
  await expect(position.getByLabel('Produkt').locator('option')).toHaveCount(1);
  await expect(
    position.getByLabel('Produkt').locator('option').first(),
  ).toHaveText('Freie Position');
  await position.getByLabel('Beschreibung').fill('Fiktive freie Position');
  await position.getByLabel('Einzelpreis (Brutto) in Euro').fill('12.34');
  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();
  expect(writes).toMatchObject([
    {
      method: 'PUT',
      path: `/api/v1/document-templates/${templateId}`,
      body: {
        positions: [
          {
            productId: null,
            description: 'Fiktive freie Position',
            quantity: 1,
            unit: 'Pauschale',
            unitPriceMinor: 1234,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
        ],
      },
    },
  ]);
  expect(unexpectedApiWrites).toEqual([]);
});

test('archive conflict reconciles by GET while the open template draft stays intact', async ({
  page,
}) => {
  const api = await stubTemplateApis(page, sourceProducts, {
    conflictArchiveOnce: true,
  });
  const position = await openTemplateEditor(page);
  const subject = page.getByLabel('Betreff');
  const description = position.getByLabel('Beschreibung');
  await subject.fill('Fiktiver noch nicht gespeicherter Betreff');
  await description.fill('Fiktive noch nicht gespeicherte Position');

  await page
    .getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
    })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Vorlage wurde inzwischen geändert',
  );
  const reconcileButton = page.getByRole('button', {
    name: 'Vorlagen neu laden',
  });
  await expect(reconcileButton).toBeFocused();
  await expect(subject).toHaveValue(
    'Fiktiver noch nicht gespeicherter Betreff',
  );
  await expect(description).toHaveValue(
    'Fiktive noch nicht gespeicherte Position',
  );
  expect(api.getArchiveAttempts()).toBe(1);
  expect(api.getListGets()).toBe(1);

  await page.setViewportSize({ width: 320, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(321);
  const conflictAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(conflictAccessibility.violations, '320px conflict state').toEqual([]);
  await page.screenshot({
    path: test
      .info()
      .outputPath('template-archive-conflict-before-reload-320.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await reconcileButton.click();
  await expect.poll(api.getListGets).toBe(2);
  await expect(
    page.getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
    }),
  ).toBeFocused();
  await expect(subject).toHaveValue(
    'Fiktiver noch nicht gespeicherter Betreff',
  );
  await expect(description).toHaveValue(
    'Fiktive noch nicht gespeicherte Position',
  );
  expect(api.getArchiveAttempts()).toBe(1);
  expect(api.writes).toHaveLength(1);

  for (const theme of ['light', 'dark'] as const) {
    const toggle = page.getByRole('button', { name: /modus aktivieren/i });
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1280, 320] as const) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width + 1);
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations, `${width}px ${theme}`).toEqual([]);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`template-archive-conflict-${width}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      const bounds = await subject.boundingBox();
      expect(bounds, `subject field visible at ${width}px`).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
  }

  expect(api.unexpectedApiWrites).toEqual([]);
});

test('confirmed archive remains successful when list refresh fails and retry performs GET only', async ({
  page,
}) => {
  const api = await stubTemplateApis(page, sourceProducts, {
    failListGetAfterArchiveOnce: true,
  });
  const position = await openTemplateEditor(page);
  const subject = page.getByLabel('Betreff');
  const description = position.getByLabel('Beschreibung');
  await subject.fill('Fiktiver gespeicherter Entwurf bleibt offen');
  await description.fill('Fiktive offene Positionsbearbeitung');

  await page
    .getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
    })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Vorlage archiviert. Die Liste konnte nicht aktualisiert werden.',
  );
  await expect(
    page.getByText(/Fiktive Bruttopreisvorlage.*Archiviert/),
  ).toBeVisible();
  await expect(subject).toHaveValue(
    'Fiktiver gespeicherter Entwurf bleibt offen',
  );
  await expect(description).toHaveValue('Fiktive offene Positionsbearbeitung');
  expect(api.getArchiveAttempts()).toBe(1);
  expect(api.getListGets()).toBe(2);
  expect(api.writes).toHaveLength(1);

  const reconcileButton = page.getByRole('button', {
    name: 'Vorlagen neu laden',
  });
  await expect(reconcileButton).toBeFocused();
  await expect(
    page.getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
    }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(321);
  const archivedAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    archivedAccessibility.violations,
    '320px confirmed archive state',
  ).toEqual([]);
  await page.screenshot({
    path: test
      .info()
      .outputPath('template-archive-confirmed-before-reload-320.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await reconcileButton.click();
  await expect.poll(api.getListGets).toBe(3);
  await expect(
    page.getByText(/Fiktive Bruttopreisvorlage.*Archiviert/),
  ).toBeVisible();
  await expect(subject).toHaveValue(
    'Fiktiver gespeicherter Entwurf bleibt offen',
  );
  await expect(description).toHaveValue('Fiktive offene Positionsbearbeitung');
  expect(api.getArchiveAttempts()).toBe(1);
  expect(api.writes).toHaveLength(1);
  expect(api.unexpectedApiWrites).toEqual([]);
});
