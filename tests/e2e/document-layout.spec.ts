import { chromium, expect, test } from '@playwright/test';
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
import {
  documentLayoutRepository,
  registerDocumentLayoutRoutes,
  type DocumentLayoutInput,
} from '../../packages/core/src/document-layouts.js';
import { chromiumPdfRenderer } from '../../packages/core/src/document-pdf.js';

const login = 'fictional.layout@example.invalid';
const username = 'fictional.layout';
const password = 'Fictional layout password 123!';

test('document layout setup, preview, conflict recovery, and persistence work in Chromium', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-layout-e2e-'));
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
  const storage = new Map<string, Buffer>();
  const store = {
    async put(key: string, bytes: Buffer) {
      storage.set(key, Buffer.from(bytes));
    },
    async read(key: string) {
      const bytes = storage.get(key);
      if (!bytes) throw new Error('synthetic E2E logo is missing');
      return Buffer.from(bytes);
    },
    async remove(key: string) {
      storage.delete(key);
    },
  };
  const chromiumRenderer = chromiumPdfRenderer({
    executablePath: chromium.executablePath(),
    timeoutMs: 30000,
  });
  let renderedPdfLength = 0;
  let relayedPdfLength = 0;
  const renderer = async (html: string) => {
    const bytes = await chromiumRenderer(html);
    renderedPdfLength = bytes.length;
    return bytes;
  };
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
          if (req.url!.startsWith('/api/v1/document-layout/preview'))
            relayedPdfLength = result.rawPayload.length;
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
      'Synthetic document-layout E2E',
      'Europe/Berlin',
    );
    await bootstrapPassword(
      pool,
      tenantId,
      login,
      'fictional.layout',
      () => password,
    );
    const actorId = (
      await pool.query<{ user_id: string }>(
        'SELECT user_id FROM allowed_accounts WHERE tenant_id=$1::uuid',
        [tenantId],
      )
    ).rows[0]!.user_id;
    const config = { origin, tenantId, mode: 'password' as const };
    await registerAuth(app, pool, config);
    registerAccessRoutes(app, pool, tenantId, 'password');
    registerDocumentLayoutRoutes(app, pool, tenantId, store, renderer);

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const loaded = await page.goto(origin);
    expect(loaded?.status()).toBe(200);
    await page.getByLabel('E-Mail oder Benutzername').fill(username);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByText(login, { exact: true })).toBeVisible();

    // A temporary read failure must offer retry, while the real initial 404
    // below leads to explicit setup instead of disguising an API outage.
    let failFirstRead = true;
    await page.route('**/api/v1/document-layout', async (route) => {
      if (failFirstRead && route.request().method() === 'GET') {
        failFirstRead = false;
        await route.fulfill({
          status: 503,
          json: { error: 'synthetic_outage' },
        });
      } else {
        await route.continue();
      }
    });
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Einstellungen', exact: true })
      .click();
    const settingsNavigation = page.getByRole('navigation', {
      name: 'Einstellungen',
      exact: true,
    });
    const settingsSelect = settingsNavigation.locator(
      'select[aria-label="Einstellungsbereich"]',
    );
    await expect(settingsSelect).toBeHidden();
    await settingsNavigation
      .getByRole('link', { name: 'Dokumentlayout', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings-document-layout$/);
    const layout = page.getByRole('region', { name: 'Dokumentlayout' });

    await expect(
      layout.getByRole('button', { name: 'Dokumentlayout erneut laden' }),
    ).toBeVisible();
    const missingLayoutResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/document-layout') &&
        response.request().method() === 'GET',
    );
    await layout
      .getByRole('button', { name: 'Dokumentlayout erneut laden' })
      .click();
    expect((await missingLayoutResponse).status()).toBe(404);
    await layout
      .getByRole('button', { name: 'Dokumentlayout einrichten', exact: true })
      .click();
    await page.locator('.document-layout-display > summary').click();

    await layout.getByLabel('Absendername').fill('Fictional Layout Studio');
    await layout.getByLabel('Straße').fill('Synthetic Straße 4');
    await layout.getByLabel('Postleitzahl').fill('12345');
    await layout.getByLabel('Ort').fill('Example City');
    for (const [label, color] of [
      ['Primärfarbe', '#2f6f4f'],
      ['Textfarbe', '#202020'],
    ] as const) {
      await layout.getByLabel(label).evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, color);
    }
    await layout.getByLabel('Schrift').selectOption('sans');
    await layout.getByLabel('Seitennummern anzeigen').check();
    await layout.getByLabel('Positionsnummern anzeigen').check();
    await layout
      .getByRole('button', { name: 'Dokumentlayout speichern', exact: true })
      .click();
    await expect(
      layout.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
    ).toBeVisible();

    const initialRow = await documentLayoutRepository(
      pool,
      tenantId,
      store,
    ).get();
    expect(initialRow).toMatchObject({
      senderName: 'Fictional Layout Studio',
      senderStreet: 'Synthetic Straße 4',
      senderPostalCode: '12345',
      senderCity: 'Example City',
      version: 1,
    });
    const initialAuditCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE tenant_id=$1::uuid AND action LIKE 'document_layout.%'",
      [tenantId],
    );

    // Reopen the saved form before checking its responsive states and preview.
    await layout
      .getByRole('button', { name: 'Dokumentlayout bearbeiten', exact: true })
      .click();
    await page.locator('.document-layout-display > summary').click();
    const widths = [320, 390, 768, 1280];
    for (const theme of ['light', 'dark'] as const) {
      const currentTheme = await page
        .locator('html')
        .getAttribute('data-theme');
      if (currentTheme !== theme) {
        await page
          .getByRole('button', { name: /Dunkelmodus|Hellmodus/ })
          .click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 844 });
        if (width <= 900) {
          await expect(settingsSelect).toBeVisible();
          await expect(
            settingsNavigation.getByRole('combobox', {
              name: 'Einstellungsbereich',
              exact: true,
            }),
          ).toBeVisible();
          await expect(settingsSelect).toHaveValue('#settings-document-layout');
          await expect(settingsSelect.locator('option')).toHaveCount(12);
          await expect(
            settingsNavigation.getByRole('link', {
              name: 'Dokumentlayout',
              exact: true,
            }),
          ).toHaveCount(0);
          if (width === 320) {
            const selectBox = await settingsSelect.boundingBox();
            const navBox = await settingsNavigation.boundingBox();
            const headingBox = await layout
              .getByRole('heading', { name: 'Dokumentlayout', exact: true })
              .boundingBox();
            const senderBox = await layout
              .getByLabel('Absendername')
              .boundingBox();
            expect(selectBox).not.toBeNull();
            expect(navBox).not.toBeNull();
            expect(headingBox).not.toBeNull();
            expect(senderBox).not.toBeNull();
            expect(selectBox!.height).toBeGreaterThanOrEqual(44);
            expect(navBox!.height).toBeLessThan(110);
            expect(headingBox!.y).toBeLessThan(350);
            expect(selectBox!.y + selectBox!.height).toBeLessThanOrEqual(844);
            expect(senderBox!.y + senderBox!.height).toBeLessThanOrEqual(844);
            await testInfo.attach(`settings-navigation-${theme}-320-geometry`, {
              body: JSON.stringify(
                {
                  width,
                  theme,
                  navigationHeight: navBox!.height,
                  selectHeight: selectBox!.height,
                  headingY: headingBox!.y,
                  senderFieldBottom: senderBox!.y + senderBox!.height,
                },
                null,
                2,
              ),
              contentType: 'application/json',
            });
          }
        } else {
          await expect(settingsSelect).toBeHidden();
          await expect(
            settingsNavigation.getByRole('link', {
              name: 'Dokumentlayout',
              exact: true,
            }),
          ).toBeVisible();
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(width + 1);
        await page.screenshot({
          path: testInfo.outputPath(`layout-${theme}-${width}.png`),
          fullPage: true,
        });
        if (width === 320 || width === 1280) {
          const result = await new AxeBuilder({ page })
            .include('#document-layout')
            .analyze();
          expect(result.violations, `${theme} at ${width}px`).toEqual([]);
        }
      }
      await page.setViewportSize({ width: 900, height: 844 });
      await expect(settingsSelect).toBeVisible();
      await expect(settingsNavigation.getByRole('link')).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(901);
      await page.setViewportSize({ width: 901, height: 844 });
      await expect(settingsSelect).toBeHidden();
      await expect(
        settingsNavigation.getByRole('link', {
          name: 'Dokumentlayout',
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(902);
    }
    await page.setViewportSize({ width: 1280, height: 844 });

    // Preview uses the real Chromium PDF renderer. The controlled GET outage
    // route is removed after setup and does not intercept its dedicated route.
    await page.unroute('**/api/v1/document-layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await layout.getByLabel('Absendername').fill('Unsaved Fictional Preview');
    await settingsSelect.selectOption('#settings-products');
    await expect(page).toHaveURL(/#settings-products$/);
    await expect(page.getByRole('region', { name: 'Produkte' })).toBeVisible();
    await settingsSelect.selectOption('#settings-document-layout');
    await expect(page).toHaveURL(/#settings-document-layout$/);
    await expect(layout.getByLabel('Absendername')).toHaveValue(
      'Unsaved Fictional Preview',
    );
    const navigationDialog = page.waitForEvent('dialog');
    page.once('dialog', (event) => void event.dismiss());
    await page.setViewportSize({ width: 1280, height: 844 });
    await page
      .getByRole('link', { name: 'AuftragsKompass – zur Eventübersicht' })
      .click();
    const dialog = await navigationDialog;
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toMatch(/Ungespeicherte Eingaben verwerfen/);
    await expect(page).toHaveURL(/#settings-document-layout$/);
    await expect(layout.getByLabel('Absendername')).toHaveValue(
      'Unsaved Fictional Preview',
    );
    const beforePreview = await documentLayoutRepository(
      pool,
      tenantId,
      store,
    ).get();
    const auditBeforePreview = await pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE tenant_id=$1::uuid AND action LIKE 'document_layout.%'",
      [tenantId],
    );
    const previewResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/document-layout/preview') &&
        response.request().method() === 'POST',
    );
    await layout
      .getByRole('button', { name: 'Vorschau erstellen', exact: true })
      .click();
    const response = await previewResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/application\/pdf/i);
    expect(renderedPdfLength).toBeGreaterThan(5);
    expect(relayedPdfLength).toBe(renderedPdfLength);
    expect(Number(response.headers()['content-length'])).toBe(
      renderedPdfLength,
    );
    await expect(
      layout.getByRole('link', { name: 'Vorschau öffnen' }),
    ).toHaveAttribute('target', '_blank');
    await expect(
      layout.getByRole('link', { name: 'Vorschau öffnen' }),
    ).toHaveAttribute('rel', /noopener.*noreferrer|noreferrer.*noopener/);
    await expect(
      layout.getByRole('link', { name: 'Vorschau öffnen' }),
    ).toHaveAttribute('href', /^blob:/);
    await expect(page.locator('iframe')).toHaveCount(0);
    const previewTabPromise = page.waitForEvent('popup');
    const previewOpenDownloadPromise = page.waitForEvent('download');
    await layout.getByRole('link', { name: 'Vorschau öffnen' }).click();
    const previewTab = await previewTabPromise;
    const previewOpenDownload = await previewOpenDownloadPromise;
    const downloadedPdf = testInfo.outputPath('layout-preview-open.pdf');
    await previewOpenDownload.saveAs(downloadedPdf);
    expect(
      (await readFile(downloadedPdf)).subarray(0, 5).toString('ascii'),
    ).toBe('%PDF-');
    await previewTab.close();
    const downloadPromise = page.waitForEvent('download');
    await layout
      .getByRole('link', { name: 'Vorschau-PDF herunterladen' })
      .click();
    const download = await downloadPromise;
    const downloadablePdf = testInfo.outputPath('layout-preview-download.pdf');
    await download.saveAs(downloadablePdf);
    const previewBytes = await readFile(downloadablePdf);
    expect(previewBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    await testInfo.attach('layout-unsaved-preview.pdf', {
      path: downloadablePdf,
      contentType: 'application/pdf',
    });
    expect(await documentLayoutRepository(pool, tenantId, store).get()).toEqual(
      beforePreview,
    );
    expect(
      (
        await pool.query<{ count: string }>(
          "SELECT count(*) FROM audit_events WHERE tenant_id=$1::uuid AND action LIKE 'document_layout.%'",
          [tenantId],
        )
      ).rows[0]!.count,
    ).toBe(auditBeforePreview.rows[0]!.count);
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM documents WHERE tenant_id=$1::uuid',
          [tenantId],
        )
      ).rows[0]!.count,
    ).toBe('0');
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM document_number_sequences WHERE tenant_id=$1::uuid',
          [tenantId],
        )
      ).rows[0]!.count,
    ).toBe('0');
    expect(storage.size).toBe(0);

    // A save transport failure is an uncertain outcome, so typed values stay
    // visible and an explicit reload is required before another save.
    let failSaveOnce = true;
    await page.route('**/api/v1/document-layout', async (route) => {
      if (failSaveOnce && route.request().method() === 'PUT') {
        failSaveOnce = false;
        await route.fulfill({
          status: 503,
          json: { error: 'synthetic_outage' },
        });
      } else {
        await route.continue();
      }
    });
    await layout
      .getByRole('button', { name: 'Dokumentlayout speichern', exact: true })
      .click();
    await expect(layout.getByRole('alert')).toContainText(
      /Speicherstand ist unklar/,
    );
    await expect(layout.getByLabel('Absendername')).toHaveValue(
      'Unsaved Fictional Preview',
    );
    await layout
      .getByRole('button', {
        name: 'Änderungen verwerfen und neu laden',
        exact: true,
      })
      .click();
    await expect(
      layout.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
    ).toBeVisible();
    await page.unroute('**/api/v1/document-layout');
    await layout
      .getByRole('button', { name: 'Dokumentlayout bearbeiten', exact: true })
      .click();
    await layout.getByLabel('Absendername').fill('Unsaved Fictional Preview');

    await layout
      .getByRole('button', { name: 'Dokumentlayout speichern', exact: true })
      .click();
    await expect(page.getByText('Unsaved Fictional Preview')).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/#settings-document-layout$/);
    await expect(
      layout.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
    ).toBeVisible();
    await layout
      .getByRole('button', { name: 'Dokumentlayout bearbeiten', exact: true })
      .click();
    await expect(layout.getByLabel('Absendername')).toHaveValue(
      'Unsaved Fictional Preview',
    );

    // Simulate a second administrator saving the same synthetic tenant while
    // the browser has a dirty version-2 edit. The stale save must keep input.
    await page
      .getByLabel('Absendername')
      .fill('Browser edit kept after conflict');
    const current = await documentLayoutRepository(pool, tenantId, store).get();
    if (!current) throw new Error('synthetic layout unexpectedly missing');
    if (
      current.fontFamily !== 'system' &&
      current.fontFamily !== 'sans' &&
      current.fontFamily !== 'serif'
    )
      throw new Error('synthetic layout has an invalid font family');
    const concurrentLayout: DocumentLayoutInput = {
      senderName: 'Concurrent synthetic edit',
      senderStreet: current.senderStreet,
      senderPostalCode: current.senderPostalCode,
      senderCity: current.senderCity,
      primaryColor: current.primaryColor,
      textColor: current.textColor,
      fontFamily: current.fontFamily,
      showPageNumbers: current.showPageNumbers,
      showPositionNumbers: current.showPositionNumbers,
    };
    await documentLayoutRepository(pool, tenantId, store).save(
      actorId,
      concurrentLayout,
      current.version,
    );
    await layout
      .getByRole('button', { name: 'Dokumentlayout speichern', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Änderungen verwerfen und neu laden',
      }),
    ).toBeVisible();
    await expect(layout.getByLabel('Absendername')).toHaveValue(
      'Browser edit kept after conflict',
    );
    await layout
      .getByRole('button', {
        name: 'Änderungen verwerfen und neu laden',
      })
      .click();
    await layout
      .getByRole('button', { name: 'Dokumentlayout bearbeiten', exact: true })
      .click();
    await expect(layout.getByLabel('Absendername')).toHaveValue(
      'Concurrent synthetic edit',
    );
    const finalRow = await documentLayoutRepository(
      pool,
      tenantId,
      store,
    ).get();
    expect(finalRow?.version).toBe(3);

    // The preview response uses the same headers that nginx serves in the
    // deployed admin path; a browser security error here is a test failure.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1281);
    expect(initialAuditCount.rows[0]!.count).toBe('1');
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    await pool.end();
    await container.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
