import { expect, test, type Browser } from '@playwright/test';
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
import { registerProductRoutes } from '../../packages/core/src/products.js';
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
    const config = { origin, tenantId, mode: 'password' as const };
    const storage = {
      async put() {
        storedArtifactCount++;
      },
      async read() {
        throw new Error('synthetic E2E storage has no artifacts');
      },
      async remove() {},
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
    registerDocumentLayoutRoutes(app, pool, tenantId, storage);
    registerDocumentRoutes(app, pool, tenantId, {
      origin,
      store: storage,
      render: async () => {
        renderCount++;
        return Buffer.from('%PDF-1.4 synthetic offer preview');
      },
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
    const positions = offers.locator('.offer-draft-positions');
    await expect(
      positions.getByText('Fictional photo booth service'),
    ).toBeVisible();
    await expect(positions.locator('input, textarea, select')).toHaveCount(0);
    await offers.getByLabel('Betreff').fill('Fictional saved subject');
    await offers.getByLabel('Einleitung').fill('Fictional saved introduction');
    await offers.getByLabel('Schlusstext').fill('Fictional saved conclusion');
    await offers.getByLabel('Gültigkeit in Tagen').fill('27');
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
          version: number;
          state: string;
          number: string | null;
          pdf_hash: string | null;
          snapshot_hash: string | null;
        }>(
          'SELECT subject,intro_text,outro_text,validity_days,version,state,number,pdf_hash,snapshot_hash FROM documents WHERE tenant_id=$1::uuid AND id=$2::uuid',
          [tenantId, draftId],
        )
      ).rows[0]!;
    expect(await persisted()).toMatchObject({
      subject: 'Fictional saved subject',
      intro_text: 'Fictional saved introduction',
      outro_text: 'Fictional saved conclusion',
      validity_days: 27,
      version: 2,
      state: 'draft',
      number: null,
      pdf_hash: null,
      snapshot_hash: null,
    });
    expect(
      (
        await pool.query<{ description: string; unit_price_minor: string }>(
          'SELECT description,unit_price_minor FROM document_lines WHERE tenant_id=$1::uuid AND document_id=$2::uuid',
          [tenantId, draftId],
        )
      ).rows,
    ).toEqual([
      {
        description: 'Fictional photo booth service',
        unit_price_minor: '10000',
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
