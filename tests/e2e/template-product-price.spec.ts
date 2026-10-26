import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const templateId = '11111111-1111-4111-8111-111111111111';
const netProductId = '22222222-2222-4222-8222-222222222222';
const grossProductId = '33333333-3333-4333-8333-333333333333';
const overflowProductId = '44444444-4444-4444-8444-444444444444';
const duplicateTemplateId = '66666666-6666-4666-8666-666666666666';

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

function templateForKind(
  kind: string,
  name: string,
  id: string,
  positionId: string,
  state: 'active' | 'inactive' | 'archived' = 'active',
) {
  return {
    ...structuredClone(originalTemplate),
    id,
    kind,
    name,
    state,
    positions: originalTemplate.positions.map((position) => ({
      ...position,
      id: positionId,
    })),
  };
}

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
  rawBody?: string;
};
type PreviewRequest = Write & { headers: Record<string, string> };

type TemplateStubOptions = {
  conflictArchiveOnce?: boolean;
  failListGetAfterArchiveOnce?: boolean;
  loseFirstCreateResponse?: boolean;
  initialTemplates?: (typeof originalTemplate)[];
  previewResponses?: Array<{
    status: number;
    body: string | Buffer;
    contentType: string;
    headers?: Record<string, string>;
  }>;
  deferFirstPreview?: boolean;
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
  const initialTemplates = options.initialTemplates ?? [originalTemplate];
  let savedTemplate = structuredClone(initialTemplates[0] ?? originalTemplate);
  const createdTemplates = initialTemplates
    .slice(1)
    .map((template) => structuredClone(template));
  const createReceipts = new Map<
    string,
    { payload: string; response: typeof originalTemplate }
  >();
  const writes: Write[] = [];
  const previewRequests: PreviewRequest[] = [];
  const unexpectedApiWrites: string[] = [];
  const queuedTemplateLists: unknown[] = [];
  let listGets = 0;
  let archiveAttempts = 0;
  let archived = false;
  let createAttempts = 0;
  let failNextTemplateListGet = false;
  let previewAttempts = 0;
  let previewFulfillCount = 0;
  let releaseDeferredPreview: (() => void) | null = null;

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
  await page.route('**/api/v1/document-templates/preview', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    previewRequests.push({
      method: route.request().method(),
      path: '/api/v1/document-templates/preview',
      body: route.request().postDataJSON() as Record<string, unknown>,
      rawBody: route.request().postData() ?? '',
      headers: route.request().headers(),
    });
    previewAttempts += 1;
    if (options.deferFirstPreview && previewAttempts === 1) {
      await new Promise<void>((resolve) => {
        releaseDeferredPreview = resolve;
      });
    }
    const response = options.previewResponses?.[previewAttempts - 1] ?? {
      status: 500,
      body: JSON.stringify({ error: 'unexpected synthetic preview request' }),
      contentType: 'application/json',
    };
    await route.fulfill({
      status: response.status,
      contentType: response.contentType,
      ...(response.headers ? { headers: response.headers } : {}),
      body: response.body,
    });
    previewFulfillCount++;
  });
  await page.route('**/api/v1/document-templates', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      createAttempts += 1;
      writes.push({
        method: 'POST',
        path: '/api/v1/document-templates',
        body,
        rawBody: route.request().postData() ?? '',
      });
      const payload = Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== 'requestId'),
      );
      const payloadText = JSON.stringify(payload);
      const requestId =
        typeof body.requestId === 'string' ? body.requestId : null;
      const receipt = requestId ? createReceipts.get(requestId) : undefined;
      if (receipt) {
        if (receipt.payload !== payloadText) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'conflict' }),
          });
          return;
        }
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(receipt.response),
        });
        return;
      }
      const positions = body.positions as Array<Record<string, unknown>>;
      const created = {
        ...payload,
        id: duplicateTemplateId,
        version: 1,
        positions: positions.map((position, index) => ({
          ...position,
          id: `77777777-7777-4777-8777-77777777777${index}`,
        })),
      } as typeof originalTemplate;
      createdTemplates.push(created);
      if (requestId) {
        createReceipts.set(requestId, {
          payload: payloadText,
          response: created,
        });
      }
      if (options.loseFirstCreateResponse && createAttempts === 1) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    listGets += 1;
    if (failNextTemplateListGet) {
      failNextTemplateListGet = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic list unavailable' }),
      });
      return;
    }
    if (queuedTemplateLists.length > 0) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(queuedTemplateLists.shift()),
      });
      return;
    }
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
      body: JSON.stringify([savedTemplate, ...createdTemplates]),
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
      const positions = Array.isArray(body.positions)
        ? (body.positions as Array<Record<string, unknown>>).map(
            (position, index) => ({
              ...position,
              id:
                savedTemplate.positions[index]?.id ??
                `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`,
            }),
          )
        : savedTemplate.positions;
      savedTemplate = {
        ...savedTemplate,
        ...body,
        positions,
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
    previewRequests,
    unexpectedApiWrites,
    products: structuredClone(catalog),
    getListGets: () => listGets,
    getArchiveAttempts: () => archiveAttempts,
    getCreateAttempts: () => createAttempts,
    getCreateReceipts: () => createReceipts,
    getCreatedTemplates: () => createdTemplates,
    getPreviewFulfillCount: () => previewFulfillCount,
    failNextTemplateListGet: () => {
      failNextTemplateListGet = true;
    },
    queueTemplateList: (response: unknown) => {
      queuedTemplateLists.push(response);
    },
    releaseDeferredPreview: () => {
      releaseDeferredPreview?.();
      releaseDeferredPreview = null;
    },
  };
}

async function openTemplateList(page: Page) {
  await page.goto('/#settings-templates');
  await expect(
    page.getByRole('heading', { name: 'Dokumentvorlagen' }),
  ).toBeVisible();
}

async function openTemplateEditor(page: Page) {
  await openTemplateList(page);
  await page
    .getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    })
    .click();
  return page.getByRole('group', { name: 'Position 1' });
}

async function captureTemplateEvidence(
  page: Page,
  prefix: string,
  visibleTarget?: Locator,
  disclosureTrigger?: Locator,
) {
  for (const theme of ['light', 'dark'] as const) {
    const toggle = page.getByRole('button', { name: /modus aktivieren/i });
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (
      disclosureTrigger &&
      (await disclosureTrigger.getAttribute('aria-expanded')) !== 'true'
    )
      await disclosureTrigger.click();
    for (const width of [1280, 320] as const) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width + 1);
      if (visibleTarget) {
        await visibleTarget.scrollIntoViewIfNeeded();
        const bounds = await visibleTarget.boundingBox();
        expect(bounds, `${prefix} action visible at ${width}px`).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations, `${prefix} ${width}px ${theme}`).toEqual(
        [],
      );
      await page.screenshot({
        path: test.info().outputPath(`${prefix}-${width}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
}

async function templateRowActions(page: Page, templateName: string) {
  const trigger = page.getByRole('button', {
    name: `Weitere Aktionen für ${templateName}`,
    exact: true,
  });
  const controls = await trigger.getAttribute('aria-controls');
  expect(
    controls,
    `${templateName} action disclosure controls a row`,
  ).toBeTruthy();
  return { trigger, menu: page.locator(`#${controls}`) };
}

async function openTemplateRowActions(page: Page, templateName: string) {
  const disclosure = await templateRowActions(page, templateName);
  await disclosure.trigger.click();
  await expect(disclosure.trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure.menu).toBeVisible();
  return disclosure;
}

test('template list groups every populated document kind and preserves unknown and archived rows', async ({
  page,
}) => {
  const templates = [
    structuredClone(originalTemplate),
    templateForKind(
      'order_confirmation',
      'Fiktive Auftragsbestätigungsvorlage',
      '77777777-7777-4777-8777-777777777771',
      '88888888-8888-4888-8888-000000000001',
    ),
    templateForKind(
      'deposit_invoice',
      'Fiktive Anzahlungsrechnungsvorlage',
      '77777777-7777-4777-8777-777777777772',
      '88888888-8888-4888-8888-000000000002',
    ),
    templateForKind(
      'invoice',
      'Fiktive Rechnungsvorlage',
      '77777777-7777-4777-8777-777777777773',
      '88888888-8888-4888-8888-000000000003',
    ),
    templateForKind(
      'correction',
      'Fiktive Rechnungskorrekturvorlage',
      '77777777-7777-4777-8777-777777777774',
      '88888888-8888-4888-8888-000000000004',
      'archived',
    ),
    templateForKind(
      'future_document_kind',
      'Fiktive unbekannte Dokumentart',
      '77777777-7777-4777-8777-777777777775',
      '88888888-8888-4888-8888-000000000005',
    ),
  ];
  const api = await stubTemplateApis(page, sourceProducts, {
    initialTemplates: templates,
  });
  await openTemplateList(page);

  for (const heading of [
    'Angebote',
    'Auftragsbestätigungen',
    'Anzahlungsrechnungen',
    'Rechnungen',
    'Rechnungskorrekturen',
    'Weitere Dokumentarten',
  ]) {
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
  }
  for (const name of templates.map((template) => template.name)) {
    await expect(
      page.getByRole('button', {
        name: `Vorlage bearbeiten: ${name}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    page.getByText(/Fiktive Rechnungskorrekturvorlage.*Archiviert/),
  ).toBeVisible();
  await captureTemplateEvidence(page, 'template-list-grouped-kinds');
  expect(api.writes).toEqual([]);
  expect(api.unexpectedApiWrites).toEqual([]);
});

test('template filters narrow the list, keep unknown kinds reachable and fit every viewport', async ({
  page,
}) => {
  // The toolbar is an explicit user requirement; B35 showed no search or
  // archive filters, so this test claims no reference parity.
  const templates = [
    structuredClone(originalTemplate),
    templateForKind(
      'invoice',
      'Fiktive Rechnungsfiltervorlage',
      '77777777-7777-4777-8777-777777777781',
      '88888888-8888-4888-8888-000000000011',
      'inactive',
    ),
    templateForKind(
      'correction',
      'Fiktive Korrekturfiltervorlage',
      '77777777-7777-4777-8777-777777777782',
      '88888888-8888-4888-8888-000000000012',
      'archived',
    ),
    templateForKind(
      'future_document_kind',
      'Fiktive unbekannte Filtervorlage',
      '77777777-7777-4777-8777-777777777783',
      '88888888-8888-4888-8888-000000000013',
    ),
  ];
  const api = await stubTemplateApis(page, sourceProducts, {
    initialTemplates: templates,
  });
  await openTemplateList(page);
  const templatesRegion = page.getByRole('region', {
    name: 'Dokumentvorlagen',
  });
  const search = templatesRegion.getByLabel('Vorlagen suchen');
  const kindFilter = templatesRegion.getByLabel('Art filtern');
  const stateFilter = templatesRegion.getByLabel('Zustand filtern');
  await expect(search).toHaveValue('');
  await expect(kindFilter).toHaveValue('');
  await expect(stateFilter).toHaveValue('');
  for (const heading of [
    'Angebote',
    'Rechnungen',
    'Rechnungskorrekturen',
    'Weitere Dokumentarten',
  ]) {
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
  }

  await search.fill('fiktive rechnungsfiltervorlage');
  await expect(
    page.getByRole('heading', { name: 'Rechnungen', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Angebote', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Fiktive Rechnungsfiltervorlage.*– Inaktiv/),
  ).toBeVisible();
  await search.fill('');

  await kindFilter.selectOption('other');
  await expect(
    page.getByRole('heading', { name: 'Weitere Dokumentarten', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Rechnungen', exact: true }),
  ).toHaveCount(0);
  await kindFilter.selectOption('');

  await search.fill('keine solchen fiktiven Treffer');
  await expect(
    templatesRegion.getByText('Keine Treffer für die aktuellen Filter.'),
  ).toBeVisible();
  await expect(
    templatesRegion.getByText('Noch keine Dokumentvorlagen vorhanden.'),
  ).toHaveCount(0);
  await templatesRegion
    .getByRole('button', { name: 'Filter zurücksetzen' })
    .click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('heading', { name: 'Angebote', exact: true }),
  ).toBeVisible();

  // Leave one narrowing filter active: the audits below judge the filtered
  // list, not only the unfiltered one.
  await stateFilter.selectOption('active');
  await expect(page.getByText(/Fiktive Korrekturfiltervorlage/)).toHaveCount(0);

  for (const theme of ['light', 'dark'] as const) {
    const toggle = page.getByRole('button', { name: /modus aktivieren/i });
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [320, 390, 1280] as const) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await templatesRegion.evaluate(
          (section) => section.scrollWidth <= section.clientWidth + 1,
        ),
        `template section fits ${width}px ${theme}`,
      ).toBe(true);
      expect(
        await templatesRegion
          .locator('.resource-toolbar')
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        `template toolbar fits ${width}px ${theme}`,
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `document fits ${width}px ${theme}`,
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .include('#document-templates')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        accessibility.violations,
        `template filters ${width}px ${theme}`,
      ).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `tests/test-results/template-filter-${width}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await expect(stateFilter).toHaveValue('active');
  expect(api.writes).toEqual([]);
  expect(api.unexpectedApiWrites).toEqual([]);
});

test('template row action disclosures stay quiet by default and dismiss with stable focus', async ({
  page,
}) => {
  const templates = [
    structuredClone(originalTemplate),
    templateForKind(
      'invoice',
      'Fiktive Rechnungsaktionsvorlage',
      '77777777-7777-4777-8777-777777777771',
      '88888888-8888-4888-8888-000000000001',
    ),
    templateForKind(
      'order_confirmation',
      'Fiktive Auftragsaktionsvorlage',
      '77777777-7777-4777-8777-777777777772',
      '88888888-8888-4888-8888-000000000002',
    ),
  ];
  const api = await stubTemplateApis(page, sourceProducts, {
    initialTemplates: templates,
  });
  await openTemplateList(page);

  const first = await templateRowActions(page, originalTemplate.name);
  await expect(first.trigger).toBeVisible();
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(first.menu).toBeHidden();
  await expect(
    first.menu.getByRole('button', {
      name: `Vorlage duplizieren: ${originalTemplate.name}`,
      exact: true,
    }),
  ).toBeHidden();

  await first.trigger.focus();
  await page.keyboard.press('Enter');
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(
    first.menu.getByRole('button', {
      name: `Vorlage duplizieren: ${originalTemplate.name}`,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(first.trigger).toBeFocused();

  await first.trigger.click();
  const second = await templateRowActions(
    page,
    'Fiktive Rechnungsaktionsvorlage',
  );
  await second.trigger.click();
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(second.trigger).toHaveAttribute('aria-expanded', 'true');
  await first.trigger.click();
  await expect(second.trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'true');
  const firstDuplicate = first.menu.getByRole('button', {
    name: `Vorlage duplizieren: ${originalTemplate.name}`,
    exact: true,
  });
  await firstDuplicate.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Auftragsaktionsvorlage',
      exact: true,
    }),
  ).toBeFocused();
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'false');

  await first.trigger.click();
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'true');
  const outsideButton = page.getByRole('button', { name: /modus aktivieren/i });
  await outsideButton.click();
  await expect(first.trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(outsideButton).toBeFocused();

  const createButton = page.getByRole('button', { name: 'Vorlage anlegen' });
  await createButton.click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(createButton).toBeFocused();

  const { trigger, menu } = await openTemplateRowActions(
    page,
    originalTemplate.name,
  );
  const duplicateAction = menu.getByRole('button', {
    name: `Vorlage duplizieren: ${originalTemplate.name}`,
    exact: true,
  });
  await captureTemplateEvidence(
    page,
    'template-row-actions-open',
    duplicateAction,
    trigger,
  );
  expect(api.writes).toEqual([]);
  expect(api.unexpectedApiWrites).toEqual([]);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('templates start as a list and open a focused on-demand editor with safe cancel and duplication', async ({
  page,
}) => {
  const api = await stubTemplateApis(page);
  await openTemplateList(page);
  const templates = page.getByRole('region', { name: 'Dokumentvorlagen' });
  const createButton = page.getByRole('button', { name: 'Vorlage anlegen' });
  await expect(createButton).toBeVisible();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    }),
  ).toBeVisible();
  await captureTemplateEvidence(page, 'template-list');

  await createButton.click();
  const name = templates.getByLabel('Bezeichnung');
  await expect(name).toBeFocused();
  await expect(
    page.getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    }),
  ).toBeVisible();
  await captureTemplateEvidence(page, 'template-create-editor');

  await name.fill('Fiktiver neuer Entwurf');
  const subject = templates.getByLabel('Betreff');
  await subject.fill('Fiktiver ungespeicherter Betreff');
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('Ungespeicherte Änderungen verwerfen?');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(name).toHaveValue('Fiktiver neuer Entwurf');
  await expect(subject).toHaveValue('Fiktiver ungespeicherter Betreff');
  expect(api.writes).toEqual([]);

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('Ungespeicherte Änderungen verwerfen?');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(createButton).toBeFocused();
  expect(api.writes).toEqual([]);

  const editOriginal = page.getByRole('button', {
    name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    exact: true,
  });
  await editOriginal.click();
  await expect(subject).toHaveValue(originalTemplate.subject);
  await subject.fill('Fiktiver nicht gespeicherter geänderter Betreff');
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('Ungespeicherte Änderungen verwerfen?');
    await dialog.accept();
  });
  await editOriginal.click();
  await expect(subject).toHaveValue(originalTemplate.subject);
  await expect(name).toBeFocused();
  expect(api.writes).toEqual([]);

  const originalActions = await openTemplateRowActions(
    page,
    'Fiktive Bruttopreisvorlage',
  );
  await originalActions.menu
    .getByRole('button', {
      name: 'Vorlage duplizieren: Fiktive Bruttopreisvorlage',
      exact: true,
    })
    .click();
  await expect(name).toHaveValue('Fiktive Bruttopreisvorlage (Kopie)');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(originalActions.trigger).toBeFocused();
  expect(api.writes).toEqual([]);

  const duplicateActions = await openTemplateRowActions(
    page,
    'Fiktive Bruttopreisvorlage',
  );
  await duplicateActions.menu
    .getByRole('button', {
      name: 'Vorlage duplizieren: Fiktive Bruttopreisvorlage',
      exact: true,
    })
    .click();
  await expect(name).toHaveValue('Fiktive Bruttopreisvorlage (Kopie)');
  const duplicatePosition = templates.getByRole('group', {
    name: 'Position 1',
  });
  await expect(duplicatePosition.getByLabel('Beschreibung')).toHaveValue(
    'Fiktive bestehende Position',
  );
  await expect(
    duplicatePosition.getByLabel('Einzelpreis (Brutto) in Euro'),
  ).toHaveValue('88.88');
  await subject.fill('Fiktive Kopie mit eigenem Betreff');
  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(duplicateActions.trigger).toBeFocused();
  expect(api.writes).toMatchObject([
    {
      method: 'POST',
      path: '/api/v1/document-templates',
      body: {
        kind: 'offer',
        name: 'Fiktive Bruttopreisvorlage (Kopie)',
        subject: 'Fiktive Kopie mit eigenem Betreff',
        positions: [
          {
            productId: null,
            description: 'Fiktive bestehende Position',
            quantity: 1,
            unit: 'Pauschale',
            unitPriceMinor: 8888,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
        ],
      },
    },
  ]);
  expect(api.unexpectedApiWrites).toEqual([]);
});

test('confirmed template creation survives failed list refresh and reconciles without losing the saved row', async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = await stubTemplateApis(page);
  await openTemplateList(page);
  const templates = page.getByRole('region', { name: 'Dokumentvorlagen' });
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await templates.getByLabel('Bezeichnung').fill('Fiktiv bestätigte Vorlage');
  await templates.getByLabel('Betreff').fill('Fiktiv bestätigter Betreff');
  api.failNextTemplateListGet();

  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(
    page.getByText(
      'Vorlage gespeichert. Die Liste konnte nicht aktualisiert werden.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(
    page.getByText('Fiktiv bestätigte Vorlage', { exact: false }),
  ).toBeVisible();
  expect(api.getCreateAttempts()).toBe(1);
  expect(api.getCreateReceipts().size).toBe(1);
  expect(api.getCreatedTemplates()).toHaveLength(1);
  expect(api.writes[0]?.body.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await captureTemplateEvidence(page, 'template-confirmed-save-refresh-error');

  const created = api.getCreatedTemplates()[0];
  if (!created) throw new Error('Synthetic create response was not recorded');
  api.queueTemplateList([]);
  await page.getByRole('button', { name: 'Vorlagen neu laden' }).click();
  await expect(
    page.getByText('Fiktiv bestätigte Vorlage', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeVisible();
  expect(api.getCreateAttempts()).toBe(1);

  api.queueTemplateList([
    {
      ...created,
      version: 2,
      name: 'Fiktiv serverseitig aktualisierte Vorlage',
      subject: 'Fiktiv neuer Serverbetreff',
    },
  ]);
  await page.getByRole('button', { name: 'Vorlagen neu laden' }).click();
  await expect(
    page.getByText('Fiktiv serverseitig aktualisierte Vorlage', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktiv serverseitig aktualisierte Vorlage',
      exact: true,
    }),
  ).toBeFocused();
  expect(api.getCreateAttempts()).toBe(1);
  expect(api.writes).toHaveLength(1);
  expect(api.unexpectedApiWrites).toEqual([]);
});

test('confirmed template update survives failed list refresh and keeps the confirmed version over stale GET data', async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = await stubTemplateApis(page);
  await openTemplateList(page);
  const templates = page.getByRole('region', { name: 'Dokumentvorlagen' });
  await page
    .getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    })
    .click();
  await templates
    .getByLabel('Bezeichnung')
    .fill('Fiktiv bestätigte PUT-Vorlage');
  await templates.getByLabel('Betreff').fill('Fiktiv bestätigter PUT-Betreff');
  api.failNextTemplateListGet();

  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(
    page.getByText(
      'Vorlage gespeichert. Die Liste konnte nicht aktualisiert werden.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(
    page.getByText('Fiktiv bestätigte PUT-Vorlage', { exact: false }),
  ).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({
    method: 'PUT',
    path: `/api/v1/document-templates/${templateId}`,
    body: {
      version: 1,
      name: 'Fiktiv bestätigte PUT-Vorlage',
      subject: 'Fiktiv bestätigter PUT-Betreff',
    },
  });
  await captureTemplateEvidence(page, 'template-confirmed-put-refresh-error');

  api.queueTemplateList([structuredClone(originalTemplate)]);
  await page.getByRole('button', { name: 'Vorlagen neu laden' }).click();
  await expect(
    page.getByText('Fiktiv bestätigte PUT-Vorlage', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.unexpectedApiWrites).toEqual([]);
});

test('lost template-create response blocks mutations and safely retries the same idempotent request', async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = await stubTemplateApis(page, sourceProducts, {
    loseFirstCreateResponse: true,
  });
  await openTemplateList(page);
  const templates = page.getByRole('region', { name: 'Dokumentvorlagen' });
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  const name = templates.getByLabel('Bezeichnung');
  const subject = templates.getByLabel('Betreff');
  await name.fill('Fiktiv idempotent gespeicherte Vorlage');
  await subject.fill('Fiktiv unveränderlicher Wiederholungsinhalt');
  await page.getByRole('button', { name: 'Vorlage speichern' }).click();

  await expect(
    page.getByText(
      'Der Speicherauftrag ist unklar. Bitte denselben Auftrag sicher wiederholen.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(name).toHaveValue('Fiktiv idempotent gespeicherte Vorlage');
  await expect(subject).toHaveValue(
    'Fiktiv unveränderlicher Wiederholungsinhalt',
  );
  await expect(
    page.getByRole('button', { name: 'Vorlage speichern' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Speicherauftrag wiederholen' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Vorlage bearbeiten: Fiktive Bruttopreisvorlage',
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', {
      name: 'Weitere Aktionen für Fiktive Bruttopreisvorlage',
    }),
  ).toBeDisabled();
  expect(api.getCreateAttempts()).toBe(1);
  expect(api.getCreateReceipts().size).toBe(1);
  expect(api.getCreatedTemplates()).toHaveLength(1);
  expect(api.getListGets()).toBe(1);
  const firstRequest = structuredClone(api.writes[0]?.body);
  const firstRawBody = api.writes[0]?.rawBody;
  expect(firstRawBody).toBeTruthy();
  expect(firstRequest?.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await captureTemplateEvidence(page, 'template-create-unknown-outcome');

  await page
    .getByRole('button', { name: 'Speicherauftrag wiederholen' })
    .click();
  await expect(templates.getByLabel('Bezeichnung')).toHaveCount(0);
  await expect(
    page.getByText('Fiktiv idempotent gespeicherte Vorlage', {
      exact: false,
    }),
  ).toBeVisible();
  expect(api.getCreateAttempts()).toBe(2);
  expect(api.getCreateReceipts().size).toBe(1);
  expect(api.getCreatedTemplates()).toHaveLength(1);
  expect(api.writes).toHaveLength(2);
  expect(api.writes.map((write) => write.rawBody)).toEqual([
    firstRawBody,
    firstRawBody,
  ]);
  expect(api.writes.map((write) => write.body)).toEqual([
    firstRequest,
    firstRequest,
  ]);
  expect(api.unexpectedApiWrites).toEqual([]);
});

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

test('template content preview uses only the unsaved synthetic draft and preserves edits on error', async ({
  page,
}) => {
  const previewPdf = Buffer.from(
    '%PDF-1.4\n% fictional browser preview\n%%EOF\n',
  );
  const api = await stubTemplateApis(page, sourceProducts, {
    previewResponses: [
      {
        status: 200,
        body: previewPdf,
        contentType: 'application/pdf',
        headers: {
          'cache-control': 'no-store',
          'content-disposition': 'inline; filename="VORSCHAU.pdf"',
        },
      },
      {
        status: 400,
        body: JSON.stringify({ error: 'unknown_placeholder' }),
        contentType: 'application/json',
      },
    ],
  });
  const firstPosition = await openTemplateEditor(page);
  const templateRegion = page.getByRole('region', { name: 'Dokumentvorlagen' });
  const name = templateRegion.getByLabel('Bezeichnung');
  const subject = templateRegion.getByLabel('Betreff');
  const intro = templateRegion.getByLabel('Einleitungstext');
  const outro = templateRegion.getByLabel('Schlusstext');

  await name.fill('Fiktive Vorschauversion');
  await subject.fill('Fiktives Vorschauangebot an {{contact}}');
  await intro.fill('Fiktive geänderte Einleitung');
  await outro.fill('Fiktiver geänderter Schlusstext');
  await templateRegion.getByLabel('Angebotsgültigkeit in Tagen').fill('21');
  await firstPosition
    .getByLabel('Beschreibung')
    .fill('Fiktive geänderte Leistung');
  await firstPosition.getByLabel('Menge').fill('2');
  await firstPosition.getByLabel('Einheit').fill('Stück');
  await firstPosition.getByLabel('Einzelpreis (Brutto) in Euro').fill('123.45');
  await firstPosition.getByLabel('Rabatt in Prozent').fill('5.00');

  await page.getByRole('button', { name: 'Position hinzufügen' }).click();
  const secondPosition = page.getByRole('group', { name: 'Position 2' });
  await secondPosition
    .getByLabel('Beschreibung')
    .fill('Fiktive Zusatzleistung');
  await secondPosition.getByLabel('Einheit').fill('Pauschale');
  await secondPosition.getByLabel('Einzelpreis (Brutto) in Euro').fill('50.00');
  await secondPosition.getByLabel('Steuersatz in Prozent').fill('7.00');

  await expect(
    page.getByText(
      'Die Vorschau verwendet Beispieldaten und neutrales Briefpapier. Gespeicherte Geschäftsdaten und Logos werden nicht verwendet.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Inhaltsvorschau erstellen' }).click();
  await expect(
    page.getByText('PDF-Vorschau erstellt.', { exact: true }),
  ).toBeVisible();
  const downloadLink = page.getByRole('link', {
    name: 'Vorschau-PDF herunterladen',
    exact: true,
  });
  await expect(downloadLink).toBeVisible();

  expect(api.previewRequests).toHaveLength(1);
  expect(api.previewRequests[0]?.path).toBe(
    '/api/v1/document-templates/preview',
  );
  expect(api.previewRequests[0]?.method).toBe('POST');
  expect(api.previewRequests[0]?.headers['x-csrf-token']).toBe(
    'fictional-template-csrf',
  );
  expect(Object.keys(api.previewRequests[0]?.body ?? {}).sort()).toEqual(
    [
      'kind',
      'name',
      'subject',
      'introText',
      'outroText',
      'validityDays',
      'state',
      'positions',
    ].sort(),
  );
  expect(api.previewRequests[0]?.body).toEqual({
    kind: 'offer',
    name: 'Fiktive Vorschauversion',
    subject: 'Fiktives Vorschauangebot an {{contact}}',
    introText: 'Fiktive geänderte Einleitung',
    outroText: 'Fiktiver geänderter Schlusstext',
    validityDays: 21,
    state: 'active',
    positions: [
      {
        productId: null,
        description: 'Fiktive geänderte Leistung',
        quantity: 2,
        unit: 'Stück',
        unitPriceMinor: 12345,
        taxBasisPoints: 1900,
        discountBasisPoints: 500,
      },
      {
        productId: null,
        description: 'Fiktive Zusatzleistung',
        quantity: 1,
        unit: 'Pauschale',
        unitPriceMinor: 5000,
        taxBasisPoints: 700,
        discountBasisPoints: 0,
      },
    ],
  });
  expect(api.writes).toEqual([]);
  expect(api.unexpectedApiWrites).toEqual([]);

  await captureTemplateEvidence(page, 'template-preview-success', downloadLink);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLink.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  await subject.fill('Fiktiver Fehler {{unknownToken}}');
  await expect(downloadLink).toHaveCount(0);
  await expect(
    page.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('PDF-Vorschau erstellt.', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Inhaltsvorschau erstellen' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Unbekannter Platzhalter. Nur die aufgeführten Platzhalter verwenden.',
  );
  await expect(name).toHaveValue('Fiktive Vorschauversion');
  await expect(subject).toHaveValue('Fiktiver Fehler {{unknownToken}}');
  await expect(intro).toHaveValue('Fiktive geänderte Einleitung');
  await expect(outro).toHaveValue('Fiktiver geänderter Schlusstext');
  await expect(secondPosition.getByLabel('Beschreibung')).toHaveValue(
    'Fiktive Zusatzleistung',
  );
  expect(api.previewRequests).toHaveLength(2);
  expect(api.previewRequests[1]?.body.subject).toBe(
    'Fiktiver Fehler {{unknownToken}}',
  );
  expect(api.writes).toEqual([]);
  expect(api.unexpectedApiWrites).toEqual([]);
  await captureTemplateEvidence(page, 'template-preview-error-preserves-draft');
});

test('the template editor inserts a described placeholder and keeps the preview contract', async ({
  page,
}) => {
  const api = await stubTemplateApis(page, sourceProducts, {
    previewResponses: [
      {
        status: 200,
        body: Buffer.from('%PDF-1.4\n% fictional browser preview\n%%EOF\n'),
        contentType: 'application/pdf',
        headers: {
          'cache-control': 'no-store',
          'content-disposition': 'inline; filename="VORSCHAU.pdf"',
        },
      },
    ],
  });
  await openTemplateEditor(page);
  const region = page.getByRole('region', { name: 'Dokumentvorlagen' });
  const subject = region.getByLabel('Betreff');
  const inserted = 'Fiktives Platzhalterangebot an {{contact}}';
  await subject.fill('Fiktives Platzhalterangebot an ');
  await subject.press('End');

  const toggle = region.getByRole('button', {
    name: 'Platzhalter in den Betreff einfügen',
  });
  await toggle.click();
  // The same control renames itself while open, so the open state is asserted
  // through its accessible name.
  const closeToggle = region.getByRole('button', {
    name: 'Platzhalterauswahl schließen',
  });
  await expect(closeToggle).toHaveCount(1);
  await expect(closeToggle).toHaveAttribute('aria-expanded', 'true');
  const panel = region.getByRole('group', {
    name: 'Platzhalter für den Betreff',
  });

  await page.getByRole('button', { name: 'Inhaltsvorschau erstellen' }).click();
  await expect(
    page.getByText('PDF-Vorschau erstellt.', { exact: true }),
  ).toBeVisible();
  const downloadLink = page.getByRole('link', {
    name: 'Vorschau-PDF herunterladen',
  });
  await expect(downloadLink).toBeVisible();

  // Choosing alone is not an edit and must keep the valid preview.
  await panel.getByLabel('Platzhalter').selectOption('contact');
  await expect(
    panel.getByText(
      'Ersetzt durch den Namen des Hauptkontakts, zum Beispiel Alex Beispiel.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(downloadLink).toBeVisible();
  await expect(
    page.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.', {
      exact: true,
    }),
  ).toHaveCount(0);

  await panel.getByRole('button', { name: 'Einfügen' }).click();
  await expect(subject).toHaveValue(inserted);
  await expect(closeToggle).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(downloadLink).toHaveCount(0);
  await expect(
    page.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('PDF-Vorschau erstellt.', { exact: true }),
  ).toHaveCount(0);
  await expect(subject).toBeFocused();
  expect(
    await subject.evaluate(
      (element) => (element as HTMLInputElement).selectionStart,
    ),
  ).toBe(inserted.length);

  // The disclosure is keyboard reachable: Enter opens it, Escape closes it and
  // returns focus to its toggle.
  const introToggle = region.getByRole('button', {
    name: 'Platzhalter in den Einleitungstext einfügen',
  });
  await introToggle.focus();
  await page.keyboard.press('Enter');
  await expect(closeToggle).toHaveCount(1);
  await expect(closeToggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(
    region
      .getByRole('group', { name: 'Platzhalter für den Einleitungstext' })
      .getByLabel('Platzhalter'),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(introToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(introToggle).toBeFocused();

  await page.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({
    method: 'PUT',
    path: `/api/v1/document-templates/${templateId}`,
  });
  expect(api.writes[0]?.body.subject).toBe(inserted);
  expect(api.unexpectedApiWrites).toEqual([]);
});

test('late template preview is ignored after the draft changes while it is pending', async ({
  page,
}) => {
  const api = await stubTemplateApis(page, sourceProducts, {
    deferFirstPreview: true,
    previewResponses: [
      {
        status: 200,
        body: Buffer.from('%PDF-1.4\n% stale fictional preview\n%%EOF\n'),
        contentType: 'application/pdf',
        headers: {
          'cache-control': 'no-store',
          'content-disposition': 'inline; filename="VORSCHAU.pdf"',
        },
      },
    ],
  });
  const position = await openTemplateEditor(page);
  const subject = page.getByLabel('Betreff');
  await subject.fill('Fiktiver vorläufiger Vorschautext');
  const createPreview = page.getByRole('button', {
    name: 'Inhaltsvorschau erstellen',
  });
  await createPreview.click();
  try {
    await expect.poll(() => api.previewRequests.length).toBe(1);
    await subject.fill('Fiktiver neuer Text nach Vorschauaufruf');
    await expect(
      page.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.', {
        exact: true,
      }),
    ).toBeVisible();
    const latePreviewResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/document-templates/preview') &&
        response.request().method() === 'POST',
    );
    api.releaseDeferredPreview();
    const response = await latePreviewResponse;
    expect(response.status()).toBe(200);
    await expect.poll(() => api.getPreviewFulfillCount()).toBe(1);
    await expect(
      page.getByRole('link', { name: 'Vorschau-PDF herunterladen' }),
    ).toHaveCount(0);
    await expect(
      page.getByText('PDF-Vorschau erstellt.', { exact: true }),
    ).toHaveCount(0);
    await expect(subject).toHaveValue(
      'Fiktiver neuer Text nach Vorschauaufruf',
    );
    expect(api.previewRequests[0]?.body.subject).toBe(
      'Fiktiver vorläufiger Vorschautext',
    );
    expect(api.writes).toEqual([]);
    expect(api.unexpectedApiWrites).toEqual([]);
    await captureTemplateEvidence(
      page,
      'template-preview-stale-response-ignored',
    );
    await expect(
      page.getByRole('link', { name: 'Vorschau-PDF herunterladen' }),
    ).toHaveCount(0);
    await expect(
      page.getByText('PDF-Vorschau erstellt.', { exact: true }),
    ).toHaveCount(0);
  } finally {
    api.releaseDeferredPreview();
  }
  await position
    .getByLabel('Beschreibung')
    .fill('Fiktive unveränderte Position');
  await expect(subject).toHaveValue('Fiktiver neuer Text nach Vorschauaufruf');
  expect(api.writes).toEqual([]);
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

  const rowActions = await openTemplateRowActions(
    page,
    'Fiktive Bruttopreisvorlage',
  );
  await rowActions.menu
    .getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
      exact: true,
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
  await expect(rowActions.trigger).toBeFocused();
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

  const rowActions = await openTemplateRowActions(
    page,
    'Fiktive Bruttopreisvorlage',
  );
  await rowActions.menu
    .getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
      exact: true,
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
  await expect(rowActions.trigger).toBeDisabled();
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
  await expect(rowActions.trigger).toBeFocused();
  await expect(rowActions.trigger).toBeEnabled();
  await rowActions.trigger.click();
  await expect(
    rowActions.menu.getByRole('button', {
      name: 'Vorlage archivieren: Fiktive Bruttopreisvorlage',
      exact: true,
    }),
  ).toBeDisabled();
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
