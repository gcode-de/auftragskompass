import { expect, test, type Browser, type Route } from '@playwright/test';
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
import { registerDocumentRoutes } from '../../packages/core/src/documents.js';
import { registerCalendarFeedRoutes } from '../../packages/core/src/calendar-feeds.js';

const login = 'fictional.offer@example.invalid';
const password = 'Fictional password 123!';

async function offerDraftScenario(browser: Browser) {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-offer-e2e-'));
  const container = await new PostgreSqlContainer(
    'postgres:17.6-alpine',
  ).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const app = Fastify();
  const nginx = await readFile('infrastructure/nginx.conf', 'utf8');
  const adminHeaders = Object.fromEntries(
    [
      ...nginx.matchAll(/add_header ([\w-]+) (?:"([^"]+)"|([^; ]+)) always;/g),
    ].map((match) => [match[1]!, match[2] ?? match[3]!]),
  );
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
            ...adminHeaders,
          });
          res.end(result.rawPayload);
          return;
        }
        const result = await fetch(
          'http://127.0.0.1:' + (process.env.AK_E2E_PORT ?? '14873') + req.url!,
        );
        res.writeHead(result.status, {
          'content-type': result.headers.get('content-type')!,
          ...adminHeaders,
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
    registerDocumentTemplateRoutes(app, pool, tenantId);
    registerDocumentNumberRoutes(app, pool, tenantId);
    const renderSynthetic = async (html: string) => {
      renderCount++;
      renderedHtml.push(html);
      return Buffer.from('%PDF-1.4 synthetic offer preview');
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
    await expect(page.getByText(login, { exact: true })).toBeVisible();
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
    await expect(offers.getByLabel('Betreff')).toHaveValue(
      'Template subject before draft',
    );
    await expect(offers.getByLabel('Einleitung')).toHaveValue(
      'Template introduction before draft',
    );
    await expect(offers.getByLabel('Schlusstext')).toHaveValue(
      'Template conclusion before draft',
    );
    await expect(offers.getByLabel('Gültigkeit in Tagen')).toHaveValue('14');
    const positions = offers.getByRole('region', { name: 'Positionen' });
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
    await expect(position2.getByLabel('Beschreibung')).toHaveValue(
      'Fictional delivery',
    );
    await offers.getByLabel('Betreff').fill('Fictional saved subject');
    await offers.getByLabel('Einleitung').fill('Fictional saved introduction');
    await offers.getByLabel('Schlusstext').fill('Fictional saved conclusion');
    await offers.getByLabel('Gültigkeit in Tagen').fill('27');
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
    await offers.getByRole('button', { name: 'Produkt hinzufügen' }).click();
    await catalogRequestStarted;
    await expect(
      offers.getByText('Produktkatalog wird geladen.'),
    ).toBeVisible();
    await position1
      .getByLabel('Beschreibung')
      .fill('Fictional edited booth during catalog load');
    releaseCatalogFailure();
    await expect(offers.getByRole('alert')).toContainText(
      'Produktkatalog konnte nicht geladen werden.',
    );
    await expect(position1.getByLabel('Beschreibung')).toHaveValue(
      'Fictional edited booth during catalog load',
    );
    await offers.getByRole('button', { name: 'Katalog erneut laden' }).click();
    const productPicker = offers.getByLabel('Produkt aus Katalog');
    await expect(productPicker).toBeVisible();
    await expect(productPicker.getByRole('option')).toHaveCount(3);
    await expect(
      productPicker.getByRole('option', {
        name: /Fictional archived product/,
      }),
    ).toHaveCount(0);
    await productPicker.selectOption(netProduct.id);
    await offers
      .getByRole('button', { name: 'Als Position hinzufügen' })
      .click();
    const netPosition = positions.getByRole('group', { name: 'Position 3' });
    await expect(netPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional net product',
    );
    await expect(netPosition.getByLabel('Beschreibung')).toBeFocused();
    await expect(netPosition.getByLabel('Menge')).toHaveValue('1');
    await expect(netPosition.getByLabel('Einheit')).toHaveValue('Stück');
    await expect(
      netPosition.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('119.00');
    await expect(netPosition.getByLabel('Steuer in Prozent')).toHaveValue(
      '19.00',
    );
    await expect(netPosition.getByLabel('Rabatt in Prozent')).toHaveValue(
      '0.00',
    );
    await productPicker.selectOption(grossProduct.id);
    await offers
      .getByRole('button', { name: 'Als Position hinzufügen' })
      .click();
    const grossPosition = positions.getByRole('group', { name: 'Position 4' });
    await expect(grossPosition.getByLabel('Beschreibung')).toHaveValue(
      'Fictional gross product',
    );
    await expect(grossPosition.getByLabel('Beschreibung')).toBeFocused();
    await expect(
      grossPosition.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('119.00');
    await expect(grossPosition.getByLabel('Einheit')).toHaveValue('Pauschale');

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
    await position6
      .getByRole('button', { name: 'Position 6 entfernen' })
      .click();
    await expect(positions.getByRole('group')).toHaveCount(5);
    await expect(
      positions.getByText('Änderungen werden beim Speichern neu berechnet.'),
    ).toBeVisible();
    await expect(
      offers.getByRole('button', { name: 'Vorschau öffnen' }),
    ).toBeDisabled();
    await expect(
      offers.getByText('Gespeicherter Gesamtbetrag: 195,00 €'),
    ).toBeVisible();
    await offers.getByRole('button', { name: 'Änderungen speichern' }).click();
    await expect(offers.getByRole('status')).toContainText(
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
        }>(
          'SELECT subject,intro_text,outro_text,validity_days,net_minor,tax_minor,gross_minor,version,state,number,pdf_hash,snapshot_hash FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
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
    });
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
        }>(
          'SELECT position,product_id,description,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points FROM document_lines WHERE tenant_id=$1::uuid AND document_id=$2::uuid ORDER BY position',
          [tenantId, draftId],
        )
      ).rows,
    ).toEqual([
      {
        position: 0,
        product_id: null,
        description: 'Fictional edited booth during catalog load',
        quantity: 2,
        unit: 'Stück',
        unit_price_minor: '12550',
        tax_basis_points: 1900,
        discount_basis_points: 1000,
      },
      {
        position: 1,
        product_id: null,
        description: 'Fictional edited delivery',
        quantity: 3,
        unit: 'Stunde',
        unit_price_minor: '3000',
        tax_basis_points: 700,
        discount_basis_points: 500,
      },
      {
        position: 2,
        product_id: netProduct.id,
        description: 'Fictional net product',
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '11900',
        tax_basis_points: 1900,
        discount_basis_points: 0,
      },
      {
        position: 3,
        product_id: grossProduct.id,
        description: 'Fictional gross product',
        quantity: 1,
        unit: 'Pauschale',
        unit_price_minor: '11900',
        tax_basis_points: 1900,
        discount_basis_points: 0,
      },
      {
        position: 4,
        product_id: null,
        description: 'Fictional extra cable',
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '2500',
        tax_basis_points: 0,
        discount_basis_points: 0,
      },
    ]);
    await expect(
      offers.getByText('Gespeicherter Gesamtbetrag: 574,40 €'),
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
        }>(
          'SELECT position,product_id,description,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points FROM document_template_positions WHERE tenant_id=$1::uuid AND template_id=$2::uuid ORDER BY position',
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
    const reopenedOffers = page.getByRole('region', { name: 'Angebote' });
    await reopenedOffers
      .getByRole('button', { name: 'Angebot Entwurf bearbeiten' })
      .click();
    await expect(reopenedOffers.getByLabel('Betreff')).toHaveValue(
      'Fictional saved subject',
    );
    await expect(reopenedOffers.getByLabel('Einleitung')).toHaveValue(
      'Fictional saved introduction',
    );
    await expect(reopenedOffers.getByLabel('Schlusstext')).toHaveValue(
      'Fictional saved conclusion',
    );
    await expect(reopenedOffers.getByLabel('Gültigkeit in Tagen')).toHaveValue(
      '27',
    );
    const reopenedPositions = reopenedOffers.getByRole('region', {
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
    await expect(reopenedPosition2.getByLabel('Rabatt in Prozent')).toHaveValue(
      '5.00',
    );
    await expect(reopenedPosition3.getByLabel('Beschreibung')).toHaveValue(
      'Fictional net product',
    );
    await expect(reopenedPosition3.getByLabel('Menge')).toHaveValue('1');
    await expect(reopenedPosition3.getByLabel('Einheit')).toHaveValue('Stück');
    await expect(
      reopenedPosition3.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('119.00');
    await expect(reopenedPosition4.getByLabel('Beschreibung')).toHaveValue(
      'Fictional gross product',
    );
    await expect(reopenedPosition4.getByLabel('Menge')).toHaveValue('1');
    await expect(reopenedPosition4.getByLabel('Einheit')).toHaveValue(
      'Pauschale',
    );
    await expect(
      reopenedPosition4.getByLabel('Einzelpreis (Brutto) in Euro'),
    ).toHaveValue('119.00');
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
      reopenedOffers.getByText('Gespeicherter Gesamtbetrag: 574,40 €'),
    ).toBeVisible();

    const emptyCatalogRoute = (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    await context.route('**/api/v1/products', emptyCatalogRoute);
    await reopenedOffers
      .getByRole('button', { name: 'Produkt hinzufügen' })
      .click();
    await expect(
      reopenedOffers.getByText('Keine aktiven Produkte im Katalog.'),
    ).toBeVisible();
    const emptyCatalogAxe = await new AxeBuilder({ page })
      .include('.offer-draft-editor')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(emptyCatalogAxe.violations).toEqual([]);
    await context.unroute('**/api/v1/products', emptyCatalogRoute);
    await expect(
      reopenedOffers.locator('.document-list > li .document-meta'),
    ).toContainText('574,40 €');
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
    await reopenedOffers.getByRole('link', { name: 'Vorschau öffnen' }).click();
    const preview = await previewResponse;
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toContain('application/pdf');
    expect(previewBytes?.subarray(0, 5).toString()).toBe('%PDF-');
    await expect.poll(() => renderCount).toBe(1);
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
    const blankEditor = blankOffers.locator('.offer-draft-editor');
    const blankRow = blankEditor.locator('xpath=ancestor::li[1]');
    await expect(blankEditor).toBeVisible();
    await expect(blankEditor.getByLabel('Betreff')).toHaveValue('Angebot');
    await expect(blankEditor.getByLabel('Einleitung')).toHaveValue('');
    await expect(blankEditor.getByLabel('Schlusstext')).toHaveValue('');
    await expect(blankEditor.getByLabel('Gültigkeit in Tagen')).toHaveValue(
      '14',
    );
    await expect(
      blankEditor.getByText(
        'Noch keine Positionen. Fügen Sie eine freie Position hinzu oder wählen Sie ein Produkt aus dem Katalog.',
      ),
    ).toBeVisible();
    await expect(
      blankEditor.getByRole('button', { name: 'Vorschau öffnen' }),
    ).toBeDisabled();
    await expect(
      blankRow.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toBeDisabled();
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

    await blankEditor
      .getByRole('button', { name: 'Freie Position hinzufügen' })
      .click();
    const blankPosition = blankEditor.getByRole('group', {
      name: 'Position 1',
    });
    await blankEditor.getByLabel('Betreff').fill('Fictional standalone offer');
    await blankEditor
      .getByLabel('Einleitung')
      .fill('Fictional standalone introduction');
    await blankEditor
      .getByLabel('Schlusstext')
      .fill('Fictional standalone conclusion');
    await blankEditor.getByLabel('Gültigkeit in Tagen').fill('21');
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
    await blankEditor
      .getByRole('button', { name: 'Änderungen speichern' })
      .click();
    await expect(blankEditor.getByRole('status')).toContainText(
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
        }>(
          'SELECT template_id,contact_id,subject,intro_text,outro_text,validity_days,net_minor,tax_minor,gross_minor,version,number,state,pdf_hash,snapshot_hash FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
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
    });
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
        }>(
          'SELECT position,product_id,description,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points FROM document_lines WHERE tenant_id=$1::uuid AND document_id=$2::uuid ORDER BY position',
          [tenantId, blankCreated.id],
        )
      ).rows,
    ).toEqual([
      {
        position: 0,
        product_id: null,
        description: 'Fictional standalone service',
        quantity: 1,
        unit: 'Stück',
        unit_price_minor: '11900',
        tax_basis_points: 1900,
        discount_basis_points: 0,
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
    const blankEditorAfterReload = blankRowAfterReload.locator(
      '.offer-draft-editor',
    );
    await expect(blankEditorAfterReload.getByLabel('Betreff')).toHaveValue(
      'Fictional standalone offer',
    );
    await expect(blankEditorAfterReload.getByLabel('Einleitung')).toHaveValue(
      'Fictional standalone introduction',
    );
    await expect(blankEditorAfterReload.getByLabel('Schlusstext')).toHaveValue(
      'Fictional standalone conclusion',
    );
    await expect(
      blankEditorAfterReload
        .getByRole('group', { name: 'Position 1' })
        .getByLabel('Beschreibung'),
    ).toHaveValue('Fictional standalone service');
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
    await blankEditorAfterReload
      .getByRole('link', { name: 'Vorschau öffnen' })
      .click();
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
    expect(renderedHtml[1]).toContain('Fictional standalone service');
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
    await blankRowAfterReload
      .getByRole('button', { name: 'Angebot Entwurf finalisieren' })
      .click();
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
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    await pool.end();
    await container.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test('real Chromium saves an offer draft, preserves its template snapshot after reload, and previews without side effects', async ({
  browser,
}) => offerDraftScenario(browser));
