import {
  chromium,
  expect,
  test,
  type Browser,
  type Locator,
  type Route,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { registerAccessRoutes } from '../../packages/core/src/access-routes.js';
import { registerMasterDataRoutes } from '../../packages/core/src/master-data.js';
import { registerResourceRoutes } from '../../packages/core/src/resources.js';
import {
  productRepository,
  registerProductRoutes,
} from '../../packages/core/src/products.js';
import {
  registerContactRoutes,
  contactRepository,
} from '../../packages/core/src/contacts.js';
import { registerLocationRoutes } from '../../packages/core/src/locations.js';
import { registerEventNoteRoutes } from '../../packages/core/src/event-notes.js';
import {
  registerEventRoutes,
  eventRepository,
} from '../../packages/core/src/events.js';
import {
  documentTemplateRepository,
  registerDocumentTemplateRoutes,
} from '../../packages/core/src/document-templates.js';
import { registerDocumentNumberRoutes } from '../../packages/core/src/document-numbers.js';
import {
  documentLayoutRepository,
  registerDocumentLayoutRoutes,
} from '../../packages/core/src/document-layouts.js';
import { chromiumPdfRenderer } from '../../packages/core/src/document-pdf.js';
import { registerDocumentRoutes } from '../../packages/core/src/documents.js';
import { registerCalendarFeedRoutes } from '../../packages/core/src/calendar-feeds.js';
import { nginxHeaders } from '../helpers/nginx-headers.js';

const login = 'fictional.offer@example.invalid';
const password = 'Fictional password 123!';

async function offerDraftScenario(browser: Browser) {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-offer-e2e-'));
  const container = await new PostgreSqlContainer(
    'postgres:17.6-alpine',
  ).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  // A stopping test container can still deliver one last error on an idle
  // connection ("terminating connection due to administrator command").
  // That is teardown noise, never a test result - awaited queries still
  // reject exactly where the tests look at them.
  pool.on('error', () => undefined);

  const app = Fastify();
  const nginx = await readFile('infrastructure/nginx.conf', 'utf8');
  const adminHeaders = nginxHeaders(nginx);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key'),
      '-out',
      join(dir, 'cert'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  const server = createServer(
    {
      key: await readFile(join(dir, 'key')),
      cert: await readFile(join(dir, 'cert')),
    },
    (req, res) => {
      void (async () => {
        if (req.url!.startsWith('/auth/') || req.url!.startsWith('/api/')) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks);
          const result = await app.inject({
            method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
            url: req.url!,
            headers: { ...req.headers, 'x-forwarded-proto': 'https' },
            ...(body.length ? { payload: body } : {}),
          });
          res.writeHead(result.statusCode, {
            ...result.headers,
            ...adminHeaders(req.url!),
          });
          res.end(result.rawPayload);
          return;
        }
        const result = await fetch(
          'http://127.0.0.1:' + (process.env.AK_E2E_PORT ?? '14873') + req.url!,
        );
        res.writeHead(result.status, {
          'content-type': result.headers.get('content-type')!,
          ...adminHeaders(req.url!),
        });
        res.end(Buffer.from(await result.arrayBuffer()));
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    },
  );
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  let renderCount = 0;
  let storedArtifactCount = 0;
  const renderedHtml: string[] = [];
  const storedArtifacts = new Map<string, Buffer>();

  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tenantId = randomUUID();
    await migrate(pool);
    await bootstrapAccess(
      pool,
      tenantId,
      login,
      'Synthetic offer E2E',
      'Europe/Berlin',
    );
    await bootstrapPassword(
      pool,
      tenantId,
      login,
      'fictional.offer',
      () => password,
    );
    const actorId = (
      await pool.query<{ user_id: string }>(
        'SELECT user_id FROM allowed_accounts WHERE tenant_id=$1::uuid',
        [tenantId],
      )
    ).rows[0]!.user_id;
    const products = productRepository(pool, tenantId);
    const netProduct = await products.save(actorId, {
      name: 'Fictional net product',
      description: 'Synthetic net-priced product',
      unit: 'Stück',
      priceMinor: 10000,
      priceBasis: 'net',
      taxBasisPoints: 1900,
      state: 'active',
      position: 0,
    });
    const grossProduct = await products.save(actorId, {
      name: 'Fictional gross product',
      description: 'Synthetic gross-priced product',
      unit: 'Pauschale',
      priceMinor: 11900,
      priceBasis: 'gross',
      taxBasisPoints: 1900,
      state: 'active',
      position: 1,
    });
    await products.save(actorId, {
      name: 'Fictional archived product',
      description: 'Synthetic archived product',
      unit: 'Stück',
      priceMinor: 77700,
      priceBasis: 'gross',
      taxBasisPoints: 1900,
      state: 'archived',
      position: 2,
    });
    const productSnapshot = await products.list();
    const config = { origin, tenantId, mode: 'password' as const };
    const storage = {
      async put(key: string, bytes: Buffer) {
        storedArtifactCount++;
        storedArtifacts.set(key, Buffer.from(bytes));
      },
      async read(key: string) {
        const bytes = storedArtifacts.get(key);
        if (!bytes) throw new Error('synthetic E2E artifact is missing');
        return Buffer.from(bytes);
      },
      async remove(key: string) {
        storedArtifacts.delete(key);
      },
    };
    await registerAuth(app, pool, config);
    registerAccessRoutes(app, pool, tenantId, 'password');
    registerMasterDataRoutes(app, pool, tenantId);
    registerResourceRoutes(app, pool, tenantId);
    registerProductRoutes(app, pool, tenantId);
    registerContactRoutes(app, pool, tenantId);
    registerLocationRoutes(app, pool, tenantId);
    registerEventRoutes(app, pool, tenantId);
    registerEventNoteRoutes(app, pool, tenantId);
    registerDocumentTemplateRoutes(app, pool, tenantId);
    registerDocumentNumberRoutes(app, pool, tenantId);
    const renderPdf = chromiumPdfRenderer({
      executablePath: chromium.executablePath(),
      timeoutMs: 30000,
    });
    const renderSynthetic = async (html: string) => {
      const bytes = await renderPdf(html);
      renderCount++;
      renderedHtml.push(html);
      return bytes;
    };
    registerDocumentLayoutRoutes(app, pool, tenantId, storage, renderSynthetic);
    registerDocumentRoutes(app, pool, tenantId, {
      origin,
      store: storage,
      render: renderSynthetic,
    });
    registerCalendarFeedRoutes(app, pool, tenantId, origin);

    const contact = await contactRepository(pool, tenantId).save(actorId, {
      kind: 'private',
      name: 'Fictional Offer Recipient',
      firstName: '',
      contactPerson: '',
      street: 'Fictional Way 1',
      postalCode: '00000',
      city: 'Example City',
      country: 'DE',
      email: 'recipient@example.invalid',
      phone: '',
      mobile: '',
      state: 'active',
    });
    const event = await eventRepository(pool, tenantId).save(actorId, {
      name: 'Fictional Offer Event',
      status: 'option',
      eventTypeId: null,
      packageId: null,
      locationId: null,
      venue: 'Fictional Event Hall',
      venueOverride: true,
      primaryContactId: contact.id,
      additionalContactIds: [],
      source: 'Synthetic BKP016.1 E2E fixture',
      eventDate: '2031-05-01',
      startsAt: null,
      endsAt: null,
      description: '',
      notesHtml: '',
    });
    const templates = documentTemplateRepository(pool, tenantId);
    const template = await templates.save(actorId, {
      kind: 'offer',
      name: 'Fictional E2E offer template',
      subject: 'Template subject before draft',
      introText: 'Template introduction before draft',
      outroText: 'Template conclusion before draft',
      validityDays: 14,
      state: 'active',
      positions: [
        {
          description: 'Fictional photo booth service',
          quantity: 1,
          unit: 'Tag',
          unitPriceMinor: 10000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
        {
          description: 'Fictional delivery',
          quantity: 2,
          unit: 'Stunde',
          unitPriceMinor: 5000,
          taxBasisPoints: 700,
          discountBasisPoints: 500,
        },
      ],
    });
    await documentLayoutRepository(pool, tenantId, storage).save(actorId, {
      senderName: 'Fictional Fotobox',
      senderStreet: '',
      senderPostalCode: '',
      senderCity: '',
      primaryColor: '#234f3b',
      textColor: '#202020',
      fontFamily: 'system',
      showPageNumbers: true,
      showPositionNumbers: true,
    });
    await pool.query(
      "INSERT INTO document_number_sequences(tenant_id,kind,pattern,min_length,next_value,version) VALUES ($1::uuid,'offer','OF-{YYYY}-{SEQ}',4,37,1)",
      [tenantId],
    );

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const productWrites: string[] = [];
    const templateWrites: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/v1/products') && request.method() !== 'GET')
        productWrites.push(`${request.method()} ${pathname}`);
      if (
        pathname === '/api/v1/document-templates' &&
        request.method() !== 'GET'
      )
        templateWrites.push(`${request.method()} ${pathname}`);
    });
    const loaded = await page.goto(origin);
    expect(loaded?.status()).toBe(200);
    await page.getByLabel('E-Mail oder Benutzername').fill('fictional.offer');
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByText(login, { exact: true })).toBeAttached();
    await expect(
      page.getByRole('button', { name: 'Abmelden', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Events', exact: true })
      .click();
    const eventLink = page.getByRole('link', {
      name: /Fictional Offer Event/,
    });
    await expect(eventLink).toBeVisible();
    await eventLink.click();
    await page
      .getByRole('navigation', { name: 'Bereiche des Events' })
      .getByRole('button', { name: 'Dateien' })
      .click();
    const offers = page.getByRole('region', { name: 'Angebote' });
    await expect(
      offers.getByRole('button', { name: 'Entwurf anlegen' }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 844 });
    const createButton = offers.getByRole('button', {
      name: 'Dokument anlegen',
    });
    await createButton.focus();
    await page.keyboard.press('Enter');
    await expect(
      offers.getByRole('button', { name: 'Entwurf anlegen' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(321);
    await expect(
      offers.getByRole('dialog', { name: 'Angebot anlegen' }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('offer-create-mobile.png'),
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await offers.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(
      offers.getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
    ).toBeVisible();
    const draftId = (
      await pool.query<{ id: string }>(
        'SELECT id FROM documents WHERE tenant_id=$1::uuid AND event_id=$2::uuid AND kind=$3',
        [tenantId, event.id, 'offer'],
      )
    ).rows[0]!.id;

    // Change the source template after creation to prove the draft owns a snapshot.
    await templates.save(
      actorId,
      {
        kind: 'offer',
        name: template.name,
        subject: 'Later template subject',
        introText: 'Later template introduction',
        outroText: 'Later template conclusion',
        validityDays: 90,
        state: 'active',
        positions: template.positions.map((position) => ({
          productId: position.productId,
          description: position.description,
          quantity: position.quantity,
          unit: position.unit,
          unitPriceMinor: position.unitPriceMinor,
          taxBasisPoints: position.taxBasisPoints,
          discountBasisPoints: position.discountBasisPoints,
        })),
      },
      template.id,
      template.version,
    );

    await offers
      .getByRole('button', { name: 'Angebot Entwurf bearbeiten' })
      .click();
    const editor = page.getByRole('region', { name: 'Angebot bearbeiten' });
    await expect(offers).toHaveCount(0);
    await expect(editor.getByLabel('Betreff')).toHaveValue(
      'Template subject before draft',
    );
    await expect(editor.getByLabel('Einleitung')).toHaveValue(
      'Template introduction before draft',
    );
    await expect(editor.getByLabel('Schlusstext')).toHaveValue(
      'Template conclusion before draft',
    );
    await expect(editor.getByLabel('Gültigkeit in Tagen')).toHaveValue('14');
    const positions = editor.getByRole('region', { name: 'Positionen' });
    const position1 = positions.getByRole('group', { name: 'Position 1' });
    const position2 = positions.getByRole('group', { name: 'Position 2' });
    await expect(position1.getByLabel('Beschreibung')).toHaveValue(
      'Fictional photo booth service',
    );
    await expect(position1.getByLabel('Menge')).toHaveValue('1');
    await expect(position1.getByLabel('Einheit')).toHaveValue('Tag');
    await expect(
      position1.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('100.00');
    await expect(position1.getByLabel('Steuer in Prozent')).toHaveValue(
      '19.00',
    );
    await expect(position1.getByLabel('Rabatt in Prozent')).toHaveValue('0.00');
    // DOC-PRODUCT-01.4 / EDITOR-LAYOUT-01: a stored line without an amount is a
    // percentage line, so its single discount field carries the percentage.
    await expect(position1.getByLabel('Rabattart')).toHaveValue('percent');
    await expect(position1.getByLabel(/^Rabatt in /)).toHaveCount(1);
    await expect(position2.getByLabel('Beschreibung')).toHaveValue(
      'Fictional delivery',
    );
    // DOC-PRODUCT-01.5: a draft without a discount says so explicitly, and no
    // amount, note or second total is shown for it. Since EDITOR-LAYOUT-01 the
    // document discount is its own group beside the position list.
    const totalDiscount = editor.getByRole('group', {
      name: 'Gesamtrabatt',
    });
    await expect(totalDiscount.getByLabel('Art des Gesamtrabatts')).toHaveValue(
      '',
    );
    await expect(
      totalDiscount.getByRole('option', { name: 'Kein Gesamtrabatt' }),
    ).toHaveCount(1);
    await expect(
      totalDiscount.getByLabel(/Gesamtrabatt in (Prozent|Euro)/),
    ).toHaveCount(0);
    await expect(
      totalDiscount.getByText(
        'Der Gesamtrabatt mindert den Zahlbetrag und wird anteilig auf die Steuersätze verteilt; das PDF zeigt Netto und Umsatzsteuer nach Rabatt.',
      ),
    ).toBeVisible();
    // A narrow editor can be embedded in a wide viewport.
    const fields = position1.locator(
      '.offer-draft-position-fields input, .offer-draft-position-fields textarea',
    );
    // Since DOC-PRODUCT-01.4 the discount mode and the euro amount follow the
    // percentage field, so the keyboard walk covers every enabled control.
    const fieldControls = position1.locator(
      '.offer-draft-position-fields input:not([disabled]), .offer-draft-position-fields select:not([disabled]), .offer-draft-position-fields textarea:not([disabled])',
    );
    const positionOptional = position1.getByRole('checkbox', {
      name: 'Optionale Position',
    });
    const optionLabel = position1.locator('label').filter({
      has: page.getByRole('checkbox', { name: 'Optionale Position' }),
    });
    const itemInfo = position1.getByLabel('Infotext (optional)');
    // EDITOR-VISUAL-02 (B37 deviation 1): the four row actions are one menu per
    // position. The toggle is the only visible row action and keeps the target
    // size; its group is hidden while it is closed.
    const rowActions = position1.getByRole('group', {
      name: 'Aktionen dieser Zeile',
    });
    const actionsToggle = position1.getByRole('button', {
      name: 'Aktionen für Position 1',
    });
    const positionList = positions.locator('.offer-draft-position-list');
    // EDITOR-MOBILE-01: the six value fields of a position are one disclosure.
    // Its summary is only offered below 44rem; above it the group is open and
    // the summary is not part of the layout.
    const priceGroup = position1.locator('.offer-draft-position-price-group');
    const priceSummary = priceGroup.locator('summary');
    const pageTheme = page.locator('html');
    const positionOriginalTheme = await pageTheme.getAttribute('data-theme');
    const positionThemeToggle = page.getByRole('button', {
      name: /modus aktivieren/,
    });
    for (const theme of ['light', 'dark'] as const) {
      if ((await pageTheme.getAttribute('data-theme')) !== theme)
        await positionThemeToggle.click();
      await expect(pageTheme).toHaveAttribute('data-theme', theme);
      for (const [width, maxWidth] of [
        [1440, ''],
        [1440, '22rem'],
        [768, ''],
        [390, ''],
        [320, ''],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        // EDITOR-MOBILE-01: below 44rem the value group folds. The geometry
        // below still measures every field, so the group is opened through its
        // own summary first - exactly what an operator on a phone does.
        if (width <= 390) {
          await expect(priceSummary).toBeVisible();
          if (
            !(await priceGroup.evaluate(
              (element) => (element as HTMLDetailsElement).open,
            ))
          )
            await priceSummary.click();
        } else {
          await expect(priceSummary).toBeHidden();
        }
        await expect(priceGroup).toHaveAttribute('open', '');
        // EDITOR-LAYOUT-01: the grouped form and the wrapping position fields
        // never push the page sideways at any of these widths.
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        await positionList.evaluate((list, value) => {
          list.style.maxWidth = value;
        }, maxWidth);
        await position1.evaluate((position) =>
          window.scrollBy(0, position.getBoundingClientRect().top - 120),
        );
        await position1.screenshot({
          path: test
            .info()
            .outputPath(
              `document-position-${theme}-${maxWidth ? 'narrow-container' : width}.png`,
            ),
        });
        const boxes = await fields.evaluateAll((inputs) =>
          inputs.map((input) => {
            const { x, y, width, height, right, bottom } =
              input.getBoundingClientRect();
            const label = input.parentElement!;
            const fits = label.scrollWidth <= label.clientWidth + 1;
            return { x, y, width, height, right, bottom, fits };
          }),
        );
        // EDITOR-LAYOUT-01: one discount number field instead of a percent and a
        // euro field of which one was always disabled.
        expect(boxes).toHaveLength(6);
        expect(boxes.every((box) => box.height >= 44 && box.fits)).toBe(true);
        expect(
          (await optionLabel.boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
        const actionsBox = (await actionsToggle.boundingBox())!;
        const groupBox = (await position1.boundingBox())!;
        const infoBox = (await itemInfo.boundingBox())!;
        const modeBox = (await position1
          .getByLabel('Rabattart')
          .boundingBox())!;
        expect(modeBox.height).toBeGreaterThanOrEqual(44);
        expect(modeBox.x + modeBox.width).toBeLessThanOrEqual(
          groupBox.x + groupBox.width,
        );
        expect(infoBox.y).toBeGreaterThanOrEqual(
          actionsBox.y + actionsBox.height,
        );
        expect(infoBox.x + infoBox.width).toBeLessThanOrEqual(
          groupBox.x + groupBox.width,
        );
        expect(actionsBox.width).toBeGreaterThanOrEqual(44);
        expect(actionsBox.height).toBeGreaterThanOrEqual(44);
        expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(
          groupBox.x + groupBox.width,
        );
        const lastField = boxes.at(-1)!;
        // EDITOR-VISUAL-02: one visible toggle sits in the row header above the
        // fields and never claims a field track of its own. The closed group is
        // neither visible nor a Tab stop.
        await expect(rowActions.getByRole('button')).toHaveCount(1);
        expect
          .soft(actionsBox.y + actionsBox.height)
          .toBeLessThanOrEqual(boxes[0]!.y);
        if (width === 1440 && !maxWidth) {
          // EDITOR-LAYOUT-01: the wide list wraps onto further rows instead of
          // squeezing nine tracks into one line. Every input keeps the 9rem
          // track minimum, so no label and no value is cut off.
          expect.soft(boxes.every((box) => box.width >= 128)).toBe(true);
          expect
            .soft(
              boxes.every(
                (box) => box.right <= groupBox.x + groupBox.width + 1,
              ),
            )
            .toBe(true);
        } else {
          expect.soft(lastField.y).toBeGreaterThan(boxes[0]!.y);
        }
      }
    }
    // EDITOR-MOBILE-01: at phone width the folded group closes and reopens
    // without losing a value, keeps its 44px touch target and stays reachable by
    // keyboard. The wide tab walk below is unchanged because the summary is not
    // displayed there.
    for (const phoneWidth of [390, 320] as const) {
      await page.setViewportSize({ width: phoneWidth, height: 900 });
      await expect(priceSummary).toBeVisible();
      await expect(priceGroup).toHaveAttribute('open', '');
      await expect(priceSummary).toContainText('1 Tag · 100.00 € · 19.00 %');
      expect((await priceSummary.boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
      await priceSummary.click();
      await expect(priceGroup).not.toHaveAttribute('open', '');
      await expect(position1.getByLabel('Menge')).toBeHidden();
      await expect(position1.getByLabel('Menge')).toHaveValue('1');
      await priceSummary.click();
      await expect(priceGroup).toHaveAttribute('open', '');
      await expect(position1.getByLabel('Menge')).toBeVisible();
      await expect(position1.getByLabel('Menge')).toHaveValue('1');
      await priceSummary.focus();
      await expect(priceSummary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(priceGroup).not.toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
      await expect(priceGroup).toHaveAttribute('open', '');
      await page.keyboard.press('Tab');
      await expect(position1.getByLabel('Menge')).toBeFocused();
    }
    if ((await pageTheme.getAttribute('data-theme')) !== positionOriginalTheme)
      await positionThemeToggle.click();
    await page.setViewportSize({ width: 1280, height: 720 });
    // EDITOR-VISUAL-02: the row menu toggle is the first Tab stop of the
    // position. Its closed group adds no stop; the fields follow it.
    await expect(actionsToggle).toHaveCount(1);
    await actionsToggle.focus();
    await expect(actionsToggle).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(fields.first()).toBeFocused();
    for (const field of (await fieldControls.all()).slice(1)) {
      await page.keyboard.press('Tab');
      await expect(field).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(positionOptional).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(itemInfo).toBeFocused();

    await editor.getByLabel('Betreff').fill('Fictional saved subject');
    await editor.getByLabel('Einleitung').fill('Fictional saved introduction');
    await editor.getByLabel('Schlusstext').fill('Fictional saved conclusion');
    await editor.getByLabel('Gültigkeit in Tagen').fill('27');
    await position1
      .getByLabel('Beschreibung')
      .fill('Fictional edited booth before catalog load');
    await position1.getByLabel('Menge').fill('2');
    await position1.getByLabel('Einheit').fill('Stück');
    await position1.getByLabel('Einzelpreis (Brutto) in Euro').fill('125.50');
    await position1.getByLabel('Steuer in Prozent').fill('19');
    await position1.getByLabel('Rabatt in Prozent').fill('10');
    await position2
      .getByLabel('Beschreibung')
      .fill('Fictional edited delivery');
    await position2.getByLabel('Menge').fill('3');
    await position2.getByLabel('Einheit').fill('Stunde');
    await position2.getByLabel('Einzelpreis (Brutto) in Euro').fill('30.00');
    await position2.getByLabel('Steuer in Prozent').fill('7');
    await position2.getByLabel('Rabatt in Prozent').fill('5');
    // DOC-PRODUCT-01.4: position 2 keeps its percentage but takes a fixed
    // amount instead. 4,50 € minus 90,00 € line sum equals the stored 5 %
    // discount, so every total below stays the same.
    await position2.getByLabel('Rabattart').selectOption('amount');
    await position2.getByLabel('Rabatt in Euro').fill('4,50');
    // EDITOR-LAYOUT-01: one number field, named by its unit. The percentage
    // typed before stays in the form and returns with its own mode.
    await expect(position2.getByLabel(/^Rabatt in /)).toHaveCount(1);
    await expect(position2.getByLabel('Rabatt in Euro')).toHaveValue('4,50');

    let releaseCatalogFailure!: () => void;
    let signalCatalogRequest!: () => void;
    const catalogRequestStarted = new Promise<void>((resolve) => {
      signalCatalogRequest = resolve;
    });
    const waitToFailCatalog = new Promise<void>((resolve) => {
      releaseCatalogFailure = resolve;
    });
    let failCatalogRequest = true;
    await context.route('**/api/v1/products', async (route) => {
      if (failCatalogRequest) {
        failCatalogRequest = false;
        signalCatalogRequest();
        await waitToFailCatalog;
        await route.abort();
        return;
      }
      await route.continue();
    });
    await editor.getByRole('button', { name: 'Produkt hinzufügen' }).click();
    await catalogRequestStarted;
    const productDialog = editor.getByRole('dialog', {
      name: 'Produkt auswählen',
    });
    await expect(productDialog).toBeVisible();
    await expect(
      editor.getByText('Produktkatalog wird geladen.'),
    ).toBeVisible();
    releaseCatalogFailure();
    await expect(editor.getByRole('alert')).toContainText(
      'Produktkatalog konnte nicht geladen werden.',
    );
    // The modal is the only catalog surface now. Closing it keeps the draft
    // editable; reopening retries the failed load and lists the active rows.
    await productDialog.getByRole('button', { name: 'Schließen' }).click();
    await expect(productDialog).toHaveCount(0);
    await position1
      .getByLabel('Beschreibung')
      .fill('Fictional edited booth during catalog load');
    await expect(position1.getByLabel('Beschreibung')).toHaveValue(
      'Fictional edited booth during catalog load',
    );
    await editor.getByRole('button', { name: 'Produkt hinzufügen' }).click();
    await expect(productDialog).toBeVisible();
    const productChoices = productDialog.getByRole('checkbox');
    await expect(productChoices).toHaveCount(2);
    await expect(
      productDialog.getByRole('checkbox', {
        name: /Fictional archived product/,
      }),
    ).toHaveCount(0);
    await productDialog.getByLabel('Produkt suchen').fill('gross');
    await expect(productChoices).toHaveCount(1);
    await productDialog.getByLabel('Produkt suchen').fill('');
    await expect(productChoices).toHaveCount(2);
    // One deliberate batch: the catalog order decides, not the click order.
    await productDialog
      .getByRole('checkbox', { name: /Fictional gross product/ })
      .check();
    await productDialog
      .getByRole('checkbox', { name: /Fictional net product/ })
      .check();
    await productDialog
      .getByRole('button', { name: 'Hinzufügen', exact: true })
      .click();
    await expect(productDialog).toHaveCount(0);
    const netPosition = positions.getByRole('group', { name: 'Position 3' });
    const grossPosition = positions.getByRole('group', { name: 'Position 4' });
    await expect(netPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional net product',
    );
    await expect(netPosition.getByLabel('Beschreibung')).toBeFocused();
    await expect(netPosition.getByLabel('Menge')).toHaveValue('1');
    await expect(netPosition.getByLabel('Einheit')).toHaveValue('Stück');
    // The catalog price is copied with its basis, not converted to gross.
    await expect(
      netPosition.getByLabel('Einzelpreis (Netto) in Euro'),
    ).toHaveValue('100.00');
    // EDITOR-VISUAL-01: the stored basis is a Brutto/Netto switch in the row
    // header (B37 deviation 2), not a select beside the price field.
    await expect(
      netPosition.getByRole('radio', { name: 'Netto' }),
    ).toBeChecked();
    await expect(netPosition.getByLabel('Steuer in Prozent')).toHaveValue(
      '19.00',
    );
    await expect(netPosition.getByLabel('Rabatt in Prozent')).toHaveValue(
      '0.00',
    );
    await expect(grossPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional gross product',
    );
    await expect(
      grossPosition.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('119.00');
    await expect(
      grossPosition.getByRole('radio', { name: 'Brutto' }),
    ).toBeChecked();
    await expect(grossPosition.getByLabel('Einheit')).toHaveValue('Pauschale');
    await expect(netPosition.getByLabel('Infotext (optional)')).toHaveValue(
      'Synthetic net-priced product',
    );
    await expect(grossPosition.getByLabel('Infotext (optional)')).toHaveValue(
      'Synthetic gross-priced product',
    );
    await netPosition
      .getByLabel('Infotext (optional)')
      .fill('Fictional edited product information\nSecond line');

    await page.setViewportSize({ width: 1280, height: 1000 });
    await netPosition.scrollIntoViewIfNeeded();
    await grossPosition
      .locator('.offer-draft-position-grip')
      .dragTo(netPosition.getByLabel('Beschreibung'));
    await expect(netPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional gross product',
    );
    await page.setViewportSize({ width: 320, height: 844 });
    // EDITOR-VISUAL-02: the moves are entries of the row menu. The toggle is the
    // 44px touch and keyboard target of the row, the entries keep their names.
    const earlierToggle = grossPosition.getByRole('button', {
      name: /^Aktionen für /,
    });
    const laterToggle = netPosition.getByRole('button', {
      name: /^Aktionen für /,
    });
    const moveTarget = await earlierToggle.boundingBox();
    expect(moveTarget?.width).toBeGreaterThanOrEqual(44);
    expect(moveTarget?.height).toBeGreaterThanOrEqual(44);
    await earlierToggle.click();
    await grossPosition
      .getByRole('button', { name: /nach oben schieben$/ })
      .press('Enter');
    await expect(netPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional net product',
    );
    // EDITOR-VISUAL-02: focus returns to the toggle of the row that moved; the
    // row numbers follow the order, so after the move this row is "Position 3"
    // and the earlier name-based locator points at the other row.
    await expect(
      netPosition.getByRole('button', { name: /^Aktionen für / }),
    ).toBeFocused();
    const touch = await context.newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await expect(
      netPosition.locator('.offer-draft-position-grip'),
    ).toBeHidden();
    // A tap on the toggle opens the group; a tap on its downward entry moves
    // the row, exactly as the former icon did.
    await laterToggle.scrollIntoViewIfNeeded();
    await laterToggle.click();
    const later = netPosition.getByRole('button', {
      name: /nach unten schieben$/,
    });
    await later.scrollIntoViewIfNeeded();
    const { x, y, width, height } = (await later.boundingBox())!;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x + width / 2, y: y + height / 2 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await touch.detach();
    await expect(netPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional gross product',
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    await positions
      .getByRole('button', { name: 'Freie Position hinzufügen' })
      .click();
    const position5 = positions.getByRole('group', { name: 'Position 5' });
    await position5.getByLabel('Beschreibung').fill('Fictional extra cable');
    await position5.getByLabel('Menge').fill('1');
    await position5.getByLabel('Einheit').fill('Stück');
    await position5.getByLabel('Einzelpreis (Brutto) in Euro').fill('25.00');
    await position5.getByLabel('Steuer in Prozent').fill('0');
    await position5.getByLabel('Rabatt in Prozent').fill('0');
    await positions
      .getByRole('button', { name: 'Freie Position hinzufügen' })
      .click();
    const position6 = positions.getByRole('group', { name: 'Position 6' });
    // EDITOR-VISUAL-02: removal is one entry of the row menu. Cancelling keeps
    // the row and the focus on the row toggle that opened the menu.
    const sixthToggle = position6.getByRole('button', {
      name: 'Aktionen für Position 6',
    });
    await sixthToggle.click();
    await position6
      .getByRole('button', { name: 'Position 6: Position entfernen' })
      .click();
    const removeDialog = editor.getByRole('dialog', {
      name: 'Position 6 entfernen?',
    });
    await expect(removeDialog).toBeVisible();
    await expect(position6).toBeVisible();
    await removeDialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(removeDialog).toBeHidden();
    await expect(
      positions.getByRole('group', { name: /^Position / }),
    ).toHaveCount(6);
    await expect(sixthToggle).toBeFocused();
    await sixthToggle.click();
    await position6
      .getByRole('button', { name: 'Position 6: Position entfernen' })
      .click();
    await editor
      .getByRole('dialog', { name: 'Position 6 entfernen?' })
      .getByRole('button', { name: 'Entfernen' })
      .click();
    await expect(
      positions.getByRole('group', { name: /^Position / }),
    ).toHaveCount(5);
    await expect(
      positions.getByRole('group', { name: 'Infotext' }),
    ).toHaveCount(0);
    await expect(
      positions.getByText('Änderungen werden beim Speichern neu berechnet.'),
    ).toBeVisible();
    await expect(
      editor.getByRole('button', { name: 'Vorschau öffnen' }),
    ).toBeDisabled();
    await expect(
      editor.getByText('Gespeicherter Gesamtbetrag: 195,00 €'),
    ).toBeVisible();
    // DOC-PRODUCT-01.5: one discount for the whole document, with its comment.
    // The stored position sums stay untouched - only the payable amount moves.
    await totalDiscount
      .getByLabel('Art des Gesamtrabatts')
      .selectOption('amount');
    await totalDiscount.getByLabel('Gesamtrabatt in Euro').fill('24,40');
    await totalDiscount
      .getByLabel('Anmerkung zum Gesamtrabatt (optional)')
      .fill('Fictional total discount');
    const draftSaveRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
          `/api/v1/documents/${draftId}/draft` && request.method() === 'PUT',
    );
    await editor.getByRole('button', { name: 'Änderungen speichern' }).click();
    const savedDraft = (await draftSaveRequest).postDataJSON() as {
      lines: Array<Record<string, unknown>>;
      totalDiscountKind: string | null;
      totalDiscountValue: number | null;
      totalDiscountNote: string | null;
    };
    // DOC-PRODUCT-01.5: kind and value travel together, the note as typed.
    expect(savedDraft).toMatchObject({
      totalDiscountKind: 'amount',
      totalDiscountValue: 2440,
      totalDiscountNote: 'Fictional total discount',
    });
    // DOC-PRODUCT-01.4: the percentage line names null (never 0) and the euro
    // line sends its exact minor amount.
    expect(savedDraft.lines[0]).toMatchObject({
      discountBasisPoints: 1000,
      discountAmountMinor: null,
    });
    expect(savedDraft.lines[1]).toMatchObject({
      discountBasisPoints: 500,
      discountAmountMinor: 450,
    });
    await expect(editor.getByRole('status')).toContainText(
      'Änderungen gespeichert.',
    );

    const persisted = async () =>
      (
        await pool.query<{
          subject: string | null;
          intro_text: string | null;
          outro_text: string | null;
          validity_days: number | null;
          net_minor: string;
          tax_minor: string;
          gross_minor: string;
          version: number;
          state: string;
          number: string | null;
          pdf_hash: string | null;
          snapshot_hash: string | null;
          total_discount_kind: string | null;
          total_discount_value: string | null;
          total_discount_note: string | null;
        }>(
          'SELECT subject,intro_text,outro_text,validity_days,net_minor,tax_minor,gross_minor,version,state,number,pdf_hash,snapshot_hash,total_discount_kind,total_discount_value,total_discount_note FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
          [tenantId, draftId],
        )
      ).rows[0]!;
    expect(await persisted()).toMatchObject({
      subject: 'Fictional saved subject',
      intro_text: 'Fictional saved introduction',
      outro_text: 'Fictional saved conclusion',
      validity_days: 27,
      net_minor: '49474',
      tax_minor: '7966',
      gross_minor: '57440',
      version: 2,
      state: 'draft',
      number: null,
      pdf_hash: null,
      snapshot_hash: null,
      // DOC-PRODUCT-01.5: the discount is stored beside the untouched sums.
      total_discount_kind: 'amount',
      total_discount_value: '2440',
      total_discount_note: 'Fictional total discount',
    });
    expect(
      (
        await pool.query<{
          position: number;
          product_id: string | null;
          description: string;
          info_text: string | null;
          quantity: number;
          unit: string;
          unit_price_minor: string;
          tax_basis_points: number;
          discount_basis_points: number;
          discount_amount_minor: string | null;
          price_basis: string;
        }>(
          'SELECT position,product_id,description,info_text,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points,discount_amount_minor,price_basis FROM document_lines WHERE tenant_id=$1::uuid AND document_id=$2::uuid ORDER BY position',
          [tenantId, draftId],
        )
      ).rows,
    ).toEqual([
      {
        position: 0,
        product_id: null,
        description: 'Fictional edited booth during catalog load',
        info_text: null,
        quantity: 2,
        unit: 'Stück',
        unit_price_minor: '12550',
        tax_basis_points: 1900,
        discount_basis_points: 1000,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
      {
        position: 1,
        product_id: null,
        description: 'Fictional edited delivery',
        info_text: null,
        quantity: 3,
        unit: 'Stunde',
        unit_price_minor: '3000',
        tax_basis_points: 700,
        discount_basis_points: 500,
        discount_amount_minor: '450',
        price_basis: 'gross',
      },
      {
        position: 2,
        product_id: grossProduct.id,
        description: 'Fictional gross product',
        info_text: 'Synthetic gross-priced product',
        quantity: 1,
        unit: 'Pauschale',
        unit_price_minor: '11900',
        tax_basis_points: 1900,
        discount_basis_points: 0,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
      {
        position: 3,
        product_id: netProduct.id,
        description: 'Fictional net product',
        info_text: 'Fictional edited product information\nSecond line',
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '10000',
        tax_basis_points: 1900,
        discount_basis_points: 0,
        discount_amount_minor: null,
        price_basis: 'net',
      },
      {
        position: 4,
        product_id: null,
        description: 'Fictional extra cable',
        info_text: null,
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '2500',
        tax_basis_points: 0,
        discount_basis_points: 0,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
    ]);
    await expect(
      editor.getByText('Gespeicherter Gesamtbetrag: 574,40 €'),
    ).toBeVisible();
    await expect(position1.getByLabel('Beschreibung')).toHaveValue(
      'Fictional edited booth during catalog load',
    );
    expect(
      (
        await pool.query<{
          subject: string;
          validity_days: number;
        }>(
          'SELECT subject,validity_days FROM document_templates WHERE tenant_id=$1::uuid AND id=$2::uuid',
          [tenantId, template.id],
        )
      ).rows,
    ).toEqual([{ subject: 'Later template subject', validity_days: 90 }]);
    expect(
      (
        await pool.query<{
          position: number;
          product_id: string | null;
          description: string;
          quantity: number;
          unit: string;
          unit_price_minor: string;
          tax_basis_points: number;
          discount_basis_points: number;
          discount_amount_minor: string | null;
          price_basis: string;
        }>(
          'SELECT position,product_id,description,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points,discount_amount_minor,price_basis FROM document_template_positions WHERE tenant_id=$1::uuid AND template_id=$2::uuid ORDER BY position',
          [tenantId, template.id],
        )
      ).rows,
    ).toEqual([
      {
        position: 0,
        product_id: null,
        description: 'Fictional photo booth service',
        quantity: 1,
        unit: 'Tag',
        unit_price_minor: '10000',
        tax_basis_points: 1900,
        discount_basis_points: 0,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
      {
        position: 1,
        product_id: null,
        description: 'Fictional delivery',
        quantity: 2,
        unit: 'Stunde',
        unit_price_minor: '5000',
        tax_basis_points: 700,
        discount_basis_points: 500,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
    ]);

    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/ }).click();
      for (const width of [320, 390, 768, 1280] as const) {
        await page.setViewportSize({
          width,
          height: width <= 390 ? 844 : 900,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        if (width === 390) {
          const accessibility = await new AxeBuilder({ page })
            .include('.offer-draft-editor')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          expect(accessibility.violations).toEqual([]);
        }
        await page.screenshot({
          path: test.info().outputPath(`offer-draft-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }

    await page.reload();
    await expect(page.locator('#event-' + event.id)).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Bereiche des Events' })
      .getByRole('button', { name: 'Dateien' })
      .click();
    await offers
      .getByRole('button', { name: 'Angebot Entwurf bearbeiten' })
      .click();
    await expect(editor.getByLabel('Betreff')).toHaveValue(
      'Fictional saved subject',
    );
    await expect(editor.getByLabel('Einleitung')).toHaveValue(
      'Fictional saved introduction',
    );
    await expect(editor.getByLabel('Schlusstext')).toHaveValue(
      'Fictional saved conclusion',
    );
    await expect(editor.getByLabel('Gültigkeit in Tagen')).toHaveValue('27');
    const reopenedPositions = editor.getByRole('region', {
      name: 'Positionen',
    });
    const reopenedPosition1 = reopenedPositions.getByRole('group', {
      name: 'Position 1',
    });
    const reopenedPosition2 = reopenedPositions.getByRole('group', {
      name: 'Position 2',
    });
    const reopenedPosition3 = reopenedPositions.getByRole('group', {
      name: 'Position 3',
    });
    const reopenedPosition4 = reopenedPositions.getByRole('group', {
      name: 'Position 4',
    });
    const reopenedPosition5 = reopenedPositions.getByRole('group', {
      name: 'Position 5',
    });
    await expect(reopenedPosition1.getByLabel('Beschreibung')).toHaveValue(
      'Fictional edited booth during catalog load',
    );
    await expect(reopenedPosition1.getByLabel('Menge')).toHaveValue('2');
    await expect(reopenedPosition1.getByLabel('Einheit')).toHaveValue('Stück');
    await expect(
      reopenedPosition1.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('125.50');
    await expect(reopenedPosition1.getByLabel('Steuer in Prozent')).toHaveValue(
      '19.00',
    );
    await expect(reopenedPosition1.getByLabel('Rabatt in Prozent')).toHaveValue(
      '10.00',
    );
    await expect(reopenedPosition2.getByLabel('Beschreibung')).toHaveValue(
      'Fictional edited delivery',
    );
    await expect(reopenedPosition2.getByLabel('Menge')).toHaveValue('3');
    await expect(reopenedPosition2.getByLabel('Einheit')).toHaveValue('Stunde');
    await expect(
      reopenedPosition2.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('30.00');
    await expect(reopenedPosition2.getByLabel('Steuer in Prozent')).toHaveValue(
      '7.00',
    );
    // DOC-PRODUCT-01.4 / EDITOR-LAYOUT-01: the stored amount decides the mode
    // after a reload, so the one field shows the amount. The untouched
    // percentage is still in the form and returns with its own mode.
    await expect(reopenedPosition2.getByLabel('Rabattart')).toHaveValue(
      'amount',
    );
    await expect(reopenedPosition2.getByLabel('Rabatt in Euro')).toHaveValue(
      '4.50',
    );
    await expect(reopenedPosition2.getByLabel(/^Rabatt in /)).toHaveCount(1);
    await reopenedPosition2.getByLabel('Rabattart').selectOption('percent');
    await expect(reopenedPosition2.getByLabel('Rabatt in Prozent')).toHaveValue(
      '5.00',
    );
    await reopenedPosition2.getByLabel('Rabattart').selectOption('amount');
    await expect(reopenedPosition2.getByLabel('Rabatt in Euro')).toHaveValue(
      '4.50',
    );
    await expect(reopenedPosition1.getByLabel('Rabattart')).toHaveValue(
      'percent',
    );
    await expect(reopenedPosition1.getByLabel(/^Rabatt in /)).toHaveCount(1);
    // DOC-PRODUCT-01.5: the reloaded draft shows the stored discount and its
    // comment, and its saved position sums are still the same. Since
    // EDITOR-LAYOUT-01 the discount is its own group outside the position list.
    const reopenedDiscount = editor.getByRole('group', {
      name: 'Gesamtrabatt',
    });
    await expect(
      reopenedDiscount.getByLabel('Art des Gesamtrabatts'),
    ).toHaveValue('amount');
    await expect(
      reopenedDiscount.getByLabel('Gesamtrabatt in Euro'),
    ).toHaveValue('24.40');
    await expect(
      reopenedDiscount.getByLabel('Anmerkung zum Gesamtrabatt (optional)'),
    ).toHaveValue('Fictional total discount');
    await expect(
      editor.getByText('Gespeicherter Gesamtbetrag: 574,40 €'),
    ).toBeVisible();
    await expect(reopenedPosition4.getByLabel('Beschreibung')).toHaveValue(
      'Fictional net product',
    );
    await expect(
      reopenedPosition4.getByLabel('Infotext (optional)'),
    ).toHaveValue('Fictional edited product information\nSecond line');
    await expect(reopenedPosition4.getByLabel('Menge')).toHaveValue('1');
    await expect(reopenedPosition4.getByLabel('Einheit')).toHaveValue('Stück');
    await expect(
      reopenedPosition4.getByLabel('Einzelpreis (Netto) in Euro'),
    ).toHaveValue('100.00');
    // EDITOR-VISUAL-01: the basis survives the reload as the checked switch.
    await expect(
      reopenedPosition4.getByRole('radio', { name: 'Netto' }),
    ).toBeChecked();
    await expect(reopenedPosition3.getByLabel('Beschreibung')).toHaveValue(
      'Fictional gross product',
    );
    await expect(reopenedPosition3.getByLabel('Menge')).toHaveValue('1');
    await expect(reopenedPosition3.getByLabel('Einheit')).toHaveValue(
      'Pauschale',
    );
    await expect(
      reopenedPosition3.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('119.00');
    await expect(
      reopenedPosition3.getByRole('radio', { name: 'Brutto' }),
    ).toBeChecked();
    await expect(reopenedPosition5.getByLabel('Beschreibung')).toHaveValue(
      'Fictional extra cable',
    );
    await expect(reopenedPosition5.getByLabel('Menge')).toHaveValue('1');
    await expect(reopenedPosition5.getByLabel('Einheit')).toHaveValue('Stück');
    await expect(
      reopenedPosition5.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('25.00');
    await expect(reopenedPosition5.getByLabel('Steuer in Prozent')).toHaveValue(
      '0.00',
    );
    await expect(reopenedPosition5.getByLabel('Rabatt in Prozent')).toHaveValue(
      '0.00',
    );
    await expect(
      editor.getByText('Gespeicherter Gesamtbetrag: 574,40 €'),
    ).toBeVisible();

    const emptyCatalogRoute = (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    await context.route('**/api/v1/products', emptyCatalogRoute);
    await editor.getByRole('button', { name: 'Produkt hinzufügen' }).click();
    await expect(
      editor.getByText('Keine aktiven Produkte im Katalog.'),
    ).toBeVisible();
    const emptyCatalogAxe = await new AxeBuilder({ page })
      .include('.offer-draft-editor')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(emptyCatalogAxe.violations).toEqual([]);
    await editor
      .getByRole('dialog', { name: 'Produkt auswählen' })
      .getByRole('button', { name: 'Schließen' })
      .click();
    await expect(
      editor.getByRole('dialog', { name: 'Produkt auswählen' }),
    ).toHaveCount(0);
    await context.unroute('**/api/v1/products', emptyCatalogRoute);
    let previewBytes: Buffer | undefined;
    await context.route(
      '**/api/v1/documents/' + draftId + '/preview',
      async (route) => {
        const response = await route.fetch();
        previewBytes = await response.body();
        await route.fulfill({ response });
      },
    );
    const previewResponse = page
      .context()
      .waitForEvent('response', (response) =>
        response.url().includes('/api/v1/documents/' + draftId + '/preview'),
      );
    await editor.getByRole('link', { name: 'Vorschau öffnen' }).click();
    const preview = await previewResponse;
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toContain('application/pdf');
    expect(previewBytes?.subarray(0, 5).toString()).toBe('%PDF-');
    await expect.poll(() => renderCount).toBe(1);
    expect(renderedHtml[0]).toContain('Fictional gross product');
    expect(renderedHtml[0]).toContain('Fictional net product');
    expect(renderedHtml[0]!.indexOf('Fictional gross product')).toBeLessThan(
      renderedHtml[0]!.indexOf('Fictional net product'),
    );
    expect(renderedHtml[0]).toContain('Fictional edited product information');
    // The printed discount follows the stored mode: a percentage rate stays a
    // rate, a fixed amount prints as a euro amount.
    expect(renderedHtml[0]).toContain('Rabatt 10 %');
    expect(renderedHtml[0]).toContain('Rabatt 4,50 €');
    // DOC-PRODUCT-01.5: the paper prints the one total discount with its comment
    // and the reduced payable amount; the position discounts stay as they were.
    expect(renderedHtml[0]).toContain(
      'Gesamtrabatt (Fictional total discount)',
    );
    expect(renderedHtml[0]).toContain('-24,40 €');
    expect(renderedHtml[0]).toContain('Zu zahlender Betrag');
    expect(renderedHtml[0]).toContain('550,00 €');
    expect(storedArtifactCount).toBe(0);
    expect(productWrites).toEqual([]);
    expect(await products.list()).toEqual(productSnapshot);
    expect(await persisted()).toMatchObject({
      state: 'draft',
      number: null,
      pdf_hash: null,
      snapshot_hash: null,
      version: 2,
    });
    expect(
      (
        await pool.query<{ next_value: number }>(
          "SELECT next_value FROM document_number_sequences WHERE tenant_id=$1::uuid AND kind='offer'",
          [tenantId],
        )
      ).rows[0]!.next_value,
    ).toBe(37);

    await editor.getByRole('button', { name: 'Bearbeitung schließen' }).click();
    await expect(
      offers.locator('.document-list > li .document-meta'),
    ).toContainText('574,40 €');

    const currentTemplate = await templates.get(template.id);
    expect(currentTemplate).not.toBeNull();
    await templates.save(
      actorId,
      {
        kind: 'offer',
        name: template.name,
        subject: currentTemplate!.subject,
        introText: currentTemplate!.introText,
        outroText: currentTemplate!.outroText,
        validityDays: currentTemplate!.validityDays,
        state: 'archived',
        positions: currentTemplate!.positions.map((position) => ({
          productId: position.productId,
          description: position.description,
          quantity: position.quantity,
          unit: position.unit,
          unitPriceMinor: position.unitPriceMinor,
          taxBasisPoints: position.taxBasisPoints,
          discountBasisPoints: position.discountBasisPoints,
        })),
      },
      template.id,
      currentTemplate!.version,
    );
    const templatesBeforeBlankOffer = await templates.list();
    expect(templatesBeforeBlankOffer).toHaveLength(1);
    expect(templatesBeforeBlankOffer[0]!.state).toBe('archived');
    expect(
      templatesBeforeBlankOffer.filter(
        (candidate) =>
          candidate.kind === 'offer' && candidate.state === 'active',
      ),
    ).toHaveLength(0);

    await page.reload();
    await expect(page.locator('#event-' + event.id)).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Bereiche des Events' })
      .getByRole('button', { name: 'Dateien' })
      .click();
    const blankOffers = page.getByRole('region', { name: 'Angebote' });
    await blankOffers.getByText('Dokument anlegen', { exact: true }).click();
    const templatePicker = blankOffers.getByLabel('Vorlage');
    await expect(templatePicker).toHaveValue('');
    await expect(templatePicker.locator('option')).toHaveText(['Ohne Vorlage']);
    const blankRequestPromise = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/v1/documents/blank-offer' &&
        request.method() === 'POST',
    );
    const blankResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/documents/blank-offer' &&
        response.request().method() === 'POST',
    );
    await blankOffers.getByRole('button', { name: 'Entwurf anlegen' }).click();
    const [blankRequest, blankResponse] = await Promise.all([
      blankRequestPromise,
      blankResponsePromise,
    ]);
    expect(blankRequest.postDataJSON()).toEqual({
      eventId: event.id,
      contactId: contact.id,
    });
    expect(blankResponse.status()).toBe(201);
    const blankCreated = (await blankResponse.json()) as {
      id: string;
      kind: string;
      templateId: string | null;
      eventId: string | null;
      contactId: string | null;
      number: string | null;
      state: string;
      subject: string | null;
      introText: string | null;
      outroText: string | null;
      validityDays: number | null;
      netMinor: number;
      taxMinor: number;
      grossMinor: number;
      version: number;
      lines: unknown[];
    };
    expect(blankCreated).toMatchObject({
      kind: 'offer',
      templateId: null,
      eventId: event.id,
      contactId: contact.id,
      number: null,
      state: 'draft',
      subject: 'Angebot',
      introText: '',
      outroText: '',
      validityDays: 14,
      netMinor: 0,
      taxMinor: 0,
      grossMinor: 0,
      version: 1,
      lines: [],
    });
    const finalizeButton = page
      .locator('.event-document-editor')
      .getByRole('button', { name: 'Angebot Entwurf finalisieren' });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Betreff')).toHaveValue('Angebot');
    await expect(editor.getByLabel('Einleitung')).toHaveValue('');
    await expect(editor.getByLabel('Schlusstext')).toHaveValue('');
    await expect(editor.getByLabel('Gültigkeit in Tagen')).toHaveValue('14');
    await expect(
      editor.getByText(
        'Noch keine Positionen. Fügen Sie eine freie Position oder ein Produkt hinzu.',
      ),
    ).toBeVisible();
    await expect(
      editor.getByRole('button', { name: 'Vorschau öffnen' }),
    ).toBeDisabled();
    await expect(finalizeButton).toBeDisabled();
    const blankOriginalTheme = await page
      .locator('html')
      .getAttribute('data-theme');
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/ }).click();
      for (const width of [320, 1280] as const) {
        await page.setViewportSize({
          width,
          height: width === 320 ? 844 : 900,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        if (width === 320) {
          const emptyAccessibility = await new AxeBuilder({ page })
            .include('.offer-draft-editor')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          expect(emptyAccessibility.violations).toEqual([]);
        }
        await page.screenshot({
          path: test
            .info()
            .outputPath(`blank-offer-empty-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    if (
      blankOriginalTheme &&
      (await page.locator('html').getAttribute('data-theme')) !==
        blankOriginalTheme
    )
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(renderCount).toBe(1);
    expect(storedArtifactCount).toBe(0);
    expect(
      (
        await pool.query<{ id: string }>(
          'SELECT id FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid AND template_id IS NULL AND event_id=$3::uuid AND contact_id=$4::uuid AND state=$5 AND number IS NULL AND subject=$6 AND intro_text=$7 AND outro_text=$8 AND validity_days=$9 AND net_minor=0 AND tax_minor=0 AND gross_minor=0 AND version=1 AND pdf_hash IS NULL AND snapshot_hash IS NULL',
          [
            tenantId,
            blankCreated.id,
            event.id,
            contact.id,
            'draft',
            'Angebot',
            '',
            '',
            14,
          ],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM document_lines WHERE tenant_id=$1::uuid AND document_id=$2::uuid',
          [tenantId, blankCreated.id],
        )
      ).rows[0]!.count,
    ).toBe('0');

    const note = 'Fictional information <b>as text</b>\nSecond line';
    const addPosition = editor.getByRole('button', {
      name: 'Freie Position hinzufügen',
    });
    await addPosition.focus();
    await page.keyboard.press('Enter');
    const blankPosition = editor.getByRole('group', {
      name: 'Position 1',
    });
    await expect(blankPosition.getByLabel('Beschreibung')).toBeFocused();
    const blankOptional = blankPosition.getByRole('checkbox', {
      name: 'Optionale Position',
    });
    await expect(blankOptional).not.toBeChecked();
    const infoInput = blankPosition.getByLabel('Infotext (optional)');
    await expect(infoInput).toHaveValue('');
    await infoInput.fill(note);
    await editor.getByLabel('Betreff').fill('Fictional standalone offer');
    await editor
      .getByLabel('Einleitung')
      .fill('Fictional standalone introduction');
    await editor
      .getByLabel('Schlusstext')
      .fill('Fictional standalone conclusion');
    await editor.getByLabel('Gültigkeit in Tagen').fill('21');
    await blankPosition
      .getByLabel('Beschreibung')
      .fill('Fictional standalone service');
    await blankPosition.getByLabel('Menge').fill('1');
    await blankPosition.getByLabel('Einheit').fill('Stück');
    await blankPosition
      .getByLabel('Einzelpreis (Brutto) in Euro')
      .fill('119.00');
    await blankPosition.getByLabel('Steuer in Prozent').fill('19');
    await blankPosition.getByLabel('Rabatt in Prozent').fill('0');
    // A free position starts as a percentage position, so its one discount
    // field carries the percentage and no euro field exists.
    await expect(blankPosition.getByLabel('Rabattart')).toHaveValue('percent');
    await expect(blankPosition.getByLabel(/^Rabatt in /)).toHaveCount(1);
    for (const [theme, width] of [
      ['light', 1280],
      ['dark', 320],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /modus aktivieren/ }).click();
      const infoBox = (await blankPosition.boundingBox())!;
      const textBox = (await infoInput.boundingBox())!;
      expect(textBox.x + textBox.width).toBeLessThanOrEqual(
        infoBox.x + infoBox.width,
      );
      expect((await addPosition.boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      await blankPosition.evaluate((position) =>
        window.scrollBy(0, position.getBoundingClientRect().top - 120),
      );
      await blankPosition.screenshot({
        path: test.info().outputPath(`offer-information-${theme}-${width}.png`),
      });
    }
    if (
      (await page.locator('html').getAttribute('data-theme')) !==
      blankOriginalTheme
    )
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await addPosition.click();
    const secondBlankPosition = editor.getByRole('group', {
      name: 'Position 2',
    });
    await secondBlankPosition
      .getByLabel('Beschreibung')
      .fill('Fictional extra briefing');
    await secondBlankPosition
      .getByLabel('Einzelpreis (Brutto) in Euro')
      .fill('59.50');
    const extraOptional = secondBlankPosition.getByRole('checkbox', {
      name: 'Optionale Position',
    });
    await extraOptional.focus();
    await page.keyboard.press('Space');
    await expect(extraOptional).toBeChecked();

    // EDITOR-VISUAL-02: the upward move is one entry of the row menu.
    await secondBlankPosition
      .getByRole('button', { name: /^Aktionen für / })
      .click();
    await secondBlankPosition
      .getByRole('button', { name: /nach oben schieben$/ })
      .click();
    const blankSaveRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
          `/api/v1/documents/${blankCreated.id}/draft` &&
        request.method() === 'PUT',
    );
    await editor.getByRole('button', { name: 'Änderungen speichern' }).click();
    // DOC-PRODUCT-01.5: a draft saved without a discount names all three halves
    // as null instead of omitting them silently.
    expect((await blankSaveRequest).postDataJSON()).toMatchObject({
      totalDiscountKind: null,
      totalDiscountValue: null,
      totalDiscountNote: null,
    });
    await expect(editor.getByRole('status')).toContainText(
      'Änderungen gespeichert.',
    );
    expect(
      (
        await pool.query<{
          template_id: string | null;
          contact_id: string | null;
          subject: string;
          intro_text: string;
          outro_text: string;
          validity_days: number;
          net_minor: string;
          tax_minor: string;
          gross_minor: string;
          version: number;
          number: string | null;
          state: string;
          pdf_hash: string | null;
          snapshot_hash: string | null;
          total_discount_kind: string | null;
          total_discount_value: string | null;
          total_discount_note: string | null;
        }>(
          'SELECT template_id,contact_id,subject,intro_text,outro_text,validity_days,net_minor,tax_minor,gross_minor,version,number,state,pdf_hash,snapshot_hash,total_discount_kind,total_discount_value,total_discount_note FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
          [tenantId, blankCreated.id],
        )
      ).rows[0],
    ).toMatchObject({
      template_id: null,
      contact_id: contact.id,
      subject: 'Fictional standalone offer',
      intro_text: 'Fictional standalone introduction',
      outro_text: 'Fictional standalone conclusion',
      validity_days: 21,
      net_minor: '10000',
      tax_minor: '1900',
      gross_minor: '11900',
      version: 2,
      number: null,
      state: 'draft',
      pdf_hash: null,
      snapshot_hash: null,
      // DOC-PRODUCT-01.5: a draft without a discount stores no discount.
      total_discount_kind: null,
      total_discount_value: null,
      total_discount_note: null,
    });
    expect(
      (
        await pool.query<{
          position: number;
          product_id: string | null;
          description: string;
          info_text: string | null;
          quantity: number;
          unit: string;
          unit_price_minor: string;
          tax_basis_points: number;
          discount_basis_points: number;
          discount_amount_minor: string | null;
          price_basis: string;
        }>(
          'SELECT position,product_id,description,info_text,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points,discount_amount_minor,price_basis FROM document_lines WHERE tenant_id=$1::uuid AND document_id=$2::uuid ORDER BY position',
          [tenantId, blankCreated.id],
        )
      ).rows,
    ).toEqual([
      {
        position: 0,
        product_id: null,
        description: 'Fictional extra briefing',
        info_text: null,
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '5950',
        tax_basis_points: 1900,
        discount_basis_points: 0,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
      {
        position: 1,
        product_id: null,
        description: 'Fictional standalone service',
        info_text: note,
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '11900',
        tax_basis_points: 1900,
        discount_basis_points: 0,
        discount_amount_minor: null,
        price_basis: 'gross',
      },
    ]);
    expect(await templates.list()).toEqual(templatesBeforeBlankOffer);
    expect(templateWrites).toEqual([]);

    await page.reload();
    await expect(page.locator('#event-' + event.id)).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Bereiche des Events' })
      .getByRole('button', { name: 'Dateien' })
      .click();
    const blankOffersAfterReload = page.getByRole('region', {
      name: 'Angebote',
    });
    const blankRowAfterReload = blankOffersAfterReload
      .locator('.document-list > li')
      .filter({ hasText: '119,00 €' });
    await expect(blankRowAfterReload).toHaveCount(1);
    await blankRowAfterReload
      .getByRole('button', { name: 'Angebot Entwurf bearbeiten' })
      .click();
    await expect(editor.getByLabel('Betreff')).toHaveValue(
      'Fictional standalone offer',
    );
    await expect(editor.getByLabel('Einleitung')).toHaveValue(
      'Fictional standalone introduction',
    );
    await expect(editor.getByLabel('Schlusstext')).toHaveValue(
      'Fictional standalone conclusion',
    );
    await expect(
      editor
        .getByRole('group', { name: 'Position 2' })
        .getByLabel('Beschreibung'),
    ).toHaveValue('Fictional standalone service');
    await expect(
      secondBlankPosition.getByLabel('Infotext (optional)'),
    ).toHaveValue(note);
    await expect(
      blankPosition.getByRole('checkbox', { name: 'Optionale Position' }),
    ).toBeChecked();
    await expect(
      secondBlankPosition.getByRole('checkbox', { name: 'Optionale Position' }),
    ).not.toBeChecked();
    let blankPreviewBytes: Buffer | undefined;
    await context.route(
      '**/api/v1/documents/' + blankCreated.id + '/preview',
      async (route) => {
        const response = await route.fetch();
        blankPreviewBytes = await response.body();
        await route.fulfill({ response });
      },
    );
    const blankPreviewResponsePromise = page
      .context()
      .waitForEvent('response', (response) =>
        response
          .url()
          .includes('/api/v1/documents/' + blankCreated.id + '/preview'),
      );
    await editor.getByRole('link', { name: 'Vorschau öffnen' }).click();
    const blankPreviewResponse = await blankPreviewResponsePromise;
    expect(blankPreviewResponse.status()).toBe(200);
    expect(blankPreviewResponse.headers()['content-type']).toContain(
      'application/pdf',
    );
    expect(blankPreviewBytes?.subarray(0, 5).toString()).toBe('%PDF-');
    await expect.poll(() => renderCount).toBe(2);
    expect(renderedHtml[1]).toContain('Fictional standalone offer');
    expect(renderedHtml[1]).toContain('Fictional standalone introduction');
    expect(renderedHtml[1]).toContain('Fictional standalone conclusion');
    expect(renderedHtml[1]).toContain(
      'Fictional information &lt;b&gt;as text&lt;/b&gt;',
    );
    expect(renderedHtml[1]).toContain('Second line');
    expect(renderedHtml[1]!.indexOf('Fictional information')).toBeGreaterThan(
      renderedHtml[1]!.indexOf('Fictional standalone service'),
    );
    expect(renderedHtml[1]).toContain('Fictional standalone service');
    expect(renderedHtml[1]).toContain('Optional: Fictional extra briefing');
    expect(renderedHtml[1]).toContain(
      'Optionale Positionen sind nicht in der Gesamtsumme berücksichtigt.',
    );
    // DOC-PRODUCT-01.5: without a discount the paper prints no discount block.
    expect(renderedHtml[1]).not.toContain('Gesamtrabatt');
    expect(storedArtifactCount).toBe(0);
    expect(productWrites).toEqual([]);
    expect(templateWrites).toEqual([]);
    expect(await products.list()).toEqual(productSnapshot);
    expect(await templates.list()).toEqual(templatesBeforeBlankOffer);
    expect(
      (
        await pool.query<{
          state: string;
          number: string | null;
          pdf_hash: string | null;
          snapshot_hash: string | null;
          version: number;
        }>(
          'SELECT state,number,pdf_hash,snapshot_hash,version FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
          [tenantId, blankCreated.id],
        )
      ).rows[0],
    ).toEqual({
      state: 'draft',
      number: null,
      pdf_hash: null,
      snapshot_hash: null,
      version: 2,
    });
    expect(
      (
        await pool.query<{ next_value: number }>(
          "SELECT next_value FROM document_number_sequences WHERE tenant_id=$1::uuid AND kind='offer'",
          [tenantId],
        )
      ).rows[0]!.next_value,
    ).toBe(37);
    const blankFinalizeRequestPromise = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
          `/api/v1/documents/${blankCreated.id}/finalize` &&
        request.method() === 'POST',
    );
    const blankFinalizeResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        `/api/v1/documents/${blankCreated.id}/finalize`,
    );
    await finalizeButton.click();
    const [blankFinalizeRequest, blankFinalizeResponse] = await Promise.all([
      blankFinalizeRequestPromise,
      blankFinalizeResponsePromise,
    ]);
    expect(blankFinalizeRequest.postDataJSON()).toEqual({ version: 2 });
    expect(blankFinalizeResponse.status()).toBe(200);
    const blankFinalized = (await blankFinalizeResponse.json()) as {
      id: string;
      state: string;
      number: string | null;
      version: number;
    };
    expect(blankFinalized).toMatchObject({
      id: blankCreated.id,
      state: 'final',
      version: 3,
    });
    expect(blankFinalized.number).toMatch(/^OF-\d{4}-0037$/);
    await expect(
      page.getByText(`Finalisiert als ${blankFinalized.number}.`, {
        exact: true,
      }),
    ).toBeVisible();
    expect(renderCount).toBe(3);
    expect(renderedHtml[2]).toContain('Fictional standalone offer');
    expect(renderedHtml[2]).toContain('Fictional standalone introduction');
    expect(renderedHtml[2]).toContain('Fictional standalone conclusion');
    expect(renderedHtml[2]).toContain('Fictional standalone service');
    expect(renderedHtml[2]).toContain('Optional: Fictional extra briefing');
    expect(renderedHtml[2]).toContain(
      'Optionale Positionen sind nicht in der Gesamtsumme berücksichtigt.',
    );
    expect(renderedHtml[2]!.indexOf('Fictional extra briefing')).toBeLessThan(
      renderedHtml[2]!.indexOf('Fictional standalone service'),
    );
    expect(storedArtifactCount).toBe(1);
    expect(storedArtifacts.size).toBe(1);
    expect(await products.list()).toEqual(productSnapshot);
    expect(await templates.list()).toEqual(templatesBeforeBlankOffer);
    expect(productWrites).toEqual([]);
    expect(templateWrites).toEqual([]);
    expect(
      (
        await pool.query<{
          state: string;
          number: string | null;
          subject: string;
          intro_text: string;
          outro_text: string;
          net_minor: string;
          tax_minor: string;
          gross_minor: string;
          pdf_hash: string | null;
          snapshot_hash: string | null;
          version: number;
        }>(
          'SELECT state,number,subject,intro_text,outro_text,net_minor,tax_minor,gross_minor,pdf_hash,snapshot_hash,version FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
          [tenantId, blankCreated.id],
        )
      ).rows[0],
    ).toMatchObject({
      state: 'final',
      number: blankFinalized.number,
      subject: 'Fictional standalone offer',
      intro_text: 'Fictional standalone introduction',
      outro_text: 'Fictional standalone conclusion',
      net_minor: '10000',
      tax_minor: '1900',
      gross_minor: '11900',
      pdf_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshot_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      version: 3,
    });
    await expect(
      blankOffersAfterReload
        .locator('.document-list > li')
        .filter({ hasText: '119,00 €' })
        .getByRole('link', {
          name: `Angebot ${blankFinalized.number} als PDF öffnen`,
        }),
    ).toBeVisible();
    let finalPdfBytes: Buffer | undefined;
    await context.route(
      '**/api/v1/documents/' + blankCreated.id + '/pdf',
      async (route) => {
        const response = await route.fetch();
        finalPdfBytes = await response.body();
        await route.fulfill({ response });
      },
    );
    const finalPdfResponsePromise = page
      .context()
      .waitForEvent(
        'response',
        (response) =>
          new URL(response.url()).pathname ===
          `/api/v1/documents/${blankCreated.id}/pdf`,
      );
    await blankOffersAfterReload
      .getByRole('link', {
        name: `Angebot ${blankFinalized.number} als PDF öffnen`,
      })
      .click();
    const finalPdfResponse = await finalPdfResponsePromise;
    expect(finalPdfResponse.status()).toBe(200);
    expect(finalPdfResponse.headers()['content-type']).toContain(
      'application/pdf',
    );
    expect(finalPdfBytes?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (
        await pool.query<{ next_value: number }>(
          "SELECT next_value FROM document_number_sequences WHERE tenant_id=$1::uuid AND kind='offer'",
          [tenantId],
        )
      ).rows[0]!.next_value,
    ).toBe(38);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1281);
    const blankInvoiceEndpoint = '**/api/v1/documents/blank-invoice';
    const invoiceRequests: unknown[] = [];
    await context.route(blankInvoiceEndpoint, async (route) => {
      invoiceRequests.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (invoiceRequests.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });

    const openDocuments = blankOffersAfterReload.getByRole('button', {
      name: 'Dokument anlegen',
    });
    const invoiceDialog = page.getByRole('dialog', {
      name: 'Rechnung ohne Auftragsbestätigung anlegen',
    });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await openDocuments.click();
      const kind = page.getByLabel('Dokumentenart');
      await expect(kind).toBeFocused();
      await kind.selectOption({ label: 'Rechnung ohne Auftragsbestätigung' });
      await expect(invoiceDialog.getByText(/Eventkontakt/)).toBeVisible();
      expect(
        await invoiceDialog.evaluate((dialog) => dialog.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await invoiceDialog.screenshot({
        path: test.info().outputPath(`blank-invoice-${width}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(invoiceDialog).toBeHidden();
      await expect(openDocuments).toBeFocused();
    }
    expect(invoiceRequests).toHaveLength(0);

    await openDocuments.click();
    await page.getByLabel('Dokumentenart').selectOption('blank_invoice');
    await invoiceDialog
      .getByRole('button', { name: 'Rechnungsentwurf anlegen' })
      .click();
    await expect(invoiceDialog.getByRole('alert')).toContainText(
      'Ausgang der Anlage ist unklar',
    );
    const retryInvoice = invoiceDialog.getByRole('button', {
      name: 'Anlage erneut versuchen',
    });
    await expect(retryInvoice).toBeFocused();
    await retryInvoice.click();
    const invoiceEditor = page.getByRole('region', {
      name: 'Rechnung bearbeiten',
    });
    const library = page.getByRole('region', {
      name: 'Eventdateien aus der Bibliothek',
    });
    await expect(invoiceEditor).toBeVisible();
    await expect(blankOffersAfterReload).toBeHidden();
    await expect(library).toBeHidden();
    const closeEditor = invoiceEditor.getByRole('button', {
      name: 'Bearbeitung schließen',
    });
    await expect(closeEditor).toHaveText('Schließen');
    const header = invoiceEditor.locator('.offer-draft-editor-heading');
    const title = invoiceEditor.getByRole('heading', {
      name: 'Rechnung bearbeiten',
    });
    const initialTheme = await page.locator('html').getAttribute('data-theme');
    const toggleTheme = page.getByRole('button', { name: /modus aktivieren/ });
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await toggleTheme.click();
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 850 });
        const titleBox = (await title.boundingBox())!;
        const closeBox = (await closeEditor.boundingBox())!;
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
        expect(titleBox.y).toBeLessThan(closeBox.y + closeBox.height);
        expect(closeBox.y).toBeLessThan(titleBox.y + titleBox.height);
        expect(closeBox.width).toBeGreaterThanOrEqual(44);
        expect(closeBox.height).toBeGreaterThanOrEqual(44);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await header.screenshot({
          path: test.info().outputPath(`invoice-heading-${theme}-${width}.png`),
        });
      }
    }
    if (
      (await page.locator('html').getAttribute('data-theme')) !== initialTheme
    )
      await toggleTheme.click();
    await page.setViewportSize({ width: 320, height: 850 });
    await closeEditor.press('Enter');
    await expect(invoiceEditor).toBeHidden();
    await expect(blankOffersAfterReload).toBeVisible();
    await expect(library).toBeVisible();
    await expect(openDocuments).toBeFocused();
    expect(invoiceRequests).toHaveLength(2);
    expect(invoiceRequests[0]).toMatchObject({
      eventId: event.id,
      contactId: contact.id,
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
    expect(invoiceRequests[1]).toEqual(invoiceRequests[0]);
    expect(
      (
        await pool.query(
          "SELECT state, number, template_id FROM documents WHERE tenant_id=$1 AND event_id=$2 AND kind='invoice'",
          [tenantId, event.id],
        )
      ).rows,
    ).toEqual([{ state: 'draft', number: null, template_id: null }]);
    const revise = blankOffersAfterReload.getByRole('button', {
      name: `Angebot ${blankFinalized.number} überarbeiten`,
    });
    let revisionCalls = 0;
    await page.route(
      '**/api/v1/documents/' + blankCreated.id + '/revision',
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        revisionCalls++;
        if (revisionCalls === 1) await route.abort();
        else await route.fulfill({ response });
      },
    );
    await revise.press('Enter');
    await expect(editor.getByLabel('Betreff')).toHaveValue(
      'Fictional standalone offer',
    );
    await expect(
      editor
        .getByRole('group', { name: 'Position 2' })
        .getByLabel('Infotext (optional)'),
    ).toHaveValue(note);
    await expect(
      editor
        .getByRole('group', { name: 'Position 1' })
        .getByRole('checkbox', { name: 'Optionale Position' }),
    ).toBeChecked();
    const originalPdf = page.getByRole('link', {
      name: `Vorgängerangebot ${blankFinalized.number} als PDF öffnen`,
    });
    await expect(originalPdf).toHaveAttribute(
      'href',
      `/api/v1/documents/${blankCreated.id}/pdf`,
    );
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: test.info().outputPath(`offer-revision-${width}.png`),
      });
    }
    await editor
      .getByRole('button', { name: 'Bearbeitung schließen' })
      .press('Enter');
    await expect(revise).toBeFocused();
    await revise.click();
    await expect(editor.getByLabel('Betreff')).toHaveValue(
      'Fictional standalone offer',
    );
    await editor.getByRole('button', { name: 'Bearbeitung schließen' }).click();
    await expect(originalPdf).toHaveCount(1);
    await expect(revise).toBeFocused();
    expect(revisionCalls).toBe(2);

    // DOC-PRODUCT-01.6: a position becomes a real product master record. An
    // unclear answer is never repeated blindly: the product list is read and
    // shown first, and only a missing product unlocks another attempt.
    await page.setViewportSize({ width: 1280, height: 900 });
    await revise.click();
    await expect(editor.getByLabel('Betreff')).toHaveValue(
      'Fictional standalone offer',
    );
    const productPosition = editor.getByRole('group', { name: 'Position 1' });
    await productPosition
      .getByLabel('Beschreibung')
      .fill('Fictional reconciled booth product');
    await productPosition.getByLabel('Menge').fill('2');
    await productPosition.getByLabel('Einheit').fill('Pauschale');
    await productPosition
      .getByLabel('Einzelpreis (Brutto) in Euro')
      .fill('119.00');
    await productPosition.getByLabel('Steuer in Prozent').fill('19');
    await productPosition.getByLabel('Rabatt in Prozent').fill('10');
    await productPosition
      .getByLabel('Infotext (optional)')
      .fill('Fictional product description from the position');
    let productInterception: 'lose' | 'drop' | 'pass' = 'lose';
    await context.route('**/api/v1/products', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      if (productInterception === 'lose') {
        productInterception = 'pass';
        await route.fetch();
        await route.abort();
        return;
      }
      if (productInterception === 'drop') {
        productInterception = 'pass';
        await route.abort();
        return;
      }
      await route.continue();
    });
    // EDITOR-VISUAL-02: the product action is one entry of the row menu. The
    // status line sits in the row outside the group, so every check reopens the
    // menu and reads the entry by its unchanged name.
    const productEntry = async (row: Locator) => {
      const toggle = row.getByRole('button', { name: /^Aktionen für / });
      if ((await toggle.getAttribute('aria-expanded')) !== 'true')
        await toggle.click();
      return toggle;
    };
    await productEntry(productPosition);
    await productPosition
      .getByRole('button', { name: 'Position 1 als Produkt speichern' })
      .click();
    await expect(productPosition.getByRole('alert')).toContainText(
      'Ausgang unklar.',
    );
    await productEntry(productPosition);
    await expect(
      productPosition.getByRole('button', {
        name: 'Position 1 als Produkt speichern',
      }),
    ).toBeDisabled();
    await expect(
      productPosition.getByRole('button', { name: 'Bestand prüfen' }),
    ).toBeVisible();
    const reconciledProduct = (await products.list()).filter(
      (row) => row.name === 'Fictional reconciled booth product',
    );
    expect(reconciledProduct).toHaveLength(1);
    expect(reconciledProduct[0]).toMatchObject({
      unit: 'Pauschale',
      priceMinor: 11900,
      priceBasis: 'gross',
      taxBasisPoints: 1900,
      state: 'active',
    });
    await productPosition
      .getByRole('button', { name: 'Bestand prüfen' })
      .click();
    await expect(
      productPosition.getByText(
        /Bereits vorhanden: Fictional reconciled booth product/,
      ),
    ).toBeVisible();
    // The found product does not unlock a second, identical creation.
    await productEntry(productPosition);
    await expect(
      productPosition.getByRole('button', {
        name: 'Position 1 als Produkt speichern',
      }),
    ).toBeDisabled();
    expect(
      (await products.list()).filter(
        (row) => row.name === 'Fictional reconciled booth product',
      ),
    ).toHaveLength(1);
    await expect(productPosition.getByLabel('Menge')).toHaveValue('2');
    await expect(productPosition.getByLabel('Rabatt in Prozent')).toHaveValue(
      '10',
    );
    await expect(productPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional reconciled booth product',
    );

    // A dropped request never reached the server; after the explicit check the
    // row may create the product again.
    const positionGroups = editor.getByRole('group', {
      name: /^Position \d+$/,
    });
    const positionCount = await positionGroups.count();
    await editor
      .getByRole('button', { name: 'Freie Position hinzufügen' })
      .click();
    await expect(positionGroups).toHaveCount(positionCount + 1);
    const recreatedPosition = positionGroups.nth(positionCount);
    await recreatedPosition
      .getByLabel('Beschreibung')
      .fill('Fictional recreated position product');
    await recreatedPosition.getByLabel('Einheit').fill('Stück');
    await recreatedPosition
      .getByLabel('Einzelpreis (Brutto) in Euro')
      .fill('95.00');
    await recreatedPosition.getByLabel('Steuer in Prozent').fill('7');
    productInterception = 'drop';
    await productEntry(recreatedPosition);
    await recreatedPosition
      .getByRole('button', { name: /als Produkt speichern$/ })
      .click();
    await expect(recreatedPosition.getByRole('alert')).toContainText(
      'Ausgang unklar.',
    );
    expect(
      (await products.list()).filter(
        (row) => row.name === 'Fictional recreated position product',
      ),
    ).toHaveLength(0);
    await recreatedPosition
      .getByRole('button', { name: 'Bestand prüfen' })
      .click();
    await expect(
      recreatedPosition.getByText(
        'Kein identisches Produkt gefunden. Die Anlage kann erneut gestartet werden.',
      ),
    ).toBeVisible();
    await productEntry(recreatedPosition);
    await recreatedPosition
      .getByRole('button', { name: /als Produkt speichern$/ })
      .click();
    await expect(
      recreatedPosition.getByText(
        'Als Produkt gespeichert: Fictional recreated position product.',
      ),
    ).toBeVisible();
    const recreatedProduct = (await products.list()).filter(
      (row) => row.name === 'Fictional recreated position product',
    );
    expect(recreatedProduct).toHaveLength(1);
    expect(recreatedProduct[0]).toMatchObject({
      unit: 'Stück',
      priceMinor: 9500,
      priceBasis: 'gross',
      taxBasisPoints: 700,
      state: 'active',
    });
    expect(productWrites).toEqual([
      'POST /api/v1/products',
      'POST /api/v1/products',
      'POST /api/v1/products',
    ]);
    await context.unroute('**/api/v1/products');
    page.once('dialog', (dialog) => void dialog.accept());
    await editor.getByRole('button', { name: 'Bearbeitung schließen' }).click();
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Einstellungen', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Einstellungen', exact: true })
      .getByRole('link', { name: 'Produkte', exact: true })
      .click();
    // The products panel loads its list once when the workspace mounts; its own
    // refresh action reads the stock the two new rows were written to.
    await page.getByRole('button', { name: 'Produkte aktualisieren' }).click();
    const reconciledRow = page
      .locator('.product-row')
      .filter({ hasText: 'Fictional reconciled booth product' });
    await expect(reconciledRow).toBeVisible();
    await expect(reconciledRow).toContainText('119,00 € Brutto');
    await expect(
      page
        .locator('.product-row')
        .filter({ hasText: 'Fictional recreated position product' }),
    ).toContainText('95,00 € Brutto');
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    await pool.end().catch(() => undefined);
    await container.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

test('real Chromium edits offers and opens one free invoice after a lost response', async ({
  browser,
}) => offerDraftScenario(browser));
