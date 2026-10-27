import { registerWebsiteInboxRoutes } from '../../packages/core/src/website-inbox-routes.js';
import { registerWebsiteInquiryRoutes } from '../../packages/core/src/website-inquiry-routes.js';
import { registerInquiryPreviewRoute } from '../../packages/core/src/inquiry-gateway.js';
import AxeBuilder from '@axe-core/playwright';
import { registerCalendarFeedRoutes } from '../../packages/core/src/calendar-feeds.js';
import { registerImportRoutes } from '../../packages/core/src/import-routes.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
import { expect, test, type Browser, type Route } from '@playwright/test';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import {
  stageWebsiteInquiry,
  importStagedWebsiteInquiry,
} from '../../packages/core/src/website-inquiry-deliveries.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import { registerAccessRoutes } from '../../packages/core/src/access-routes.js';
import { registerEventRoutes } from '../../packages/core/src/events.js';
import { registerLocationRoutes } from '../../packages/core/src/locations.js';
import { registerContactRoutes } from '../../packages/core/src/contacts.js';
import { registerProductRoutes } from '../../packages/core/src/products.js';
import { registerResourceRoutes } from '../../packages/core/src/resources.js';
import { registerMasterDataRoutes } from '../../packages/core/src/master-data.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { registerDocumentRoutes } from '../../packages/core/src/documents.js';
import { registerDocumentPaymentRoutes } from '../../packages/core/src/document-payments.js';
import { registerDocumentTemplateRoutes } from '../../packages/core/src/document-templates.js';
import { registerLibraryFileRoutes } from '../../packages/core/src/library-files.js';
import { StorageError } from '../../packages/core/src/storage.js';
import { syntheticGoogle } from '../helpers/oidc.js';
// RG-07: the due day of an invoice is its invoice day in the tenant calendar
// plus the agreed term. The browser test recomputes it with the same tenant zone
// the server uses, so the printed line and the stored row must agree.
function tenantDay(date: Date, timeZone = 'Europe/Berlin') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return part('year') + '-' + part('month') + '-' + part('day');
}
function addDays(day: string, days: number) {
  return new Date(Date.parse(day + 'T00:00:00Z') + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
function germanDay(day: string) {
  return day.split('-').reverse().join('.');
}
async function signInScenario(
  browser: Browser,
  mode: 'google' | 'password',
  filesAudit = false,
) {
  // The separate files matrix has its own budget; the remaining journey keeps
  // its original budget and still exercises both authentication modes.
  test.setTimeout(filesAudit ? 180000 : mode === 'password' ? 240000 : 180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-tls-'));
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
  let callbackFor: (url: string) => string;
  const server = createServer(
    {
      key: await readFile(join(dir, 'key')),
      cert: await readFile(join(dir, 'cert')),
    },
    (req, res) => {
      void (async () => {
        if (req.url!.startsWith('/synthetic-google?')) {
          res.writeHead(302, {
            location: callbackFor(
              'https://accounts.google.com/authorize?' +
                req.url!.split('?')[1]!,
            ),
          });
          res.end();
          return;
        }
        if (
          req.url!.startsWith('/auth/') ||
          req.url!.startsWith('/api/') ||
          req.url!.startsWith('/feeds/')
        ) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks);
          const result = await app.inject({
            method: req.method as 'GET' | 'POST',
            url: req.url!,
            headers: { ...req.headers, 'x-forwarded-proto': 'https' },
            ...(body.length ? { payload: body } : {}),
          });
          res.writeHead(result.statusCode, {
            ...result.headers,
            ...adminHeaders,
          });
          res.end(result.rawPayload);
        } else {
          const result = await fetch(
            'http://127.0.0.1:' +
              (process.env.AK_E2E_PORT ?? '14873') +
              req.url!,
          );
          res.writeHead(result.status, {
            'content-type': result.headers.get('content-type')!,
            ...adminHeaders,
          });
          res.end(Buffer.from(await result.arrayBuffer()));
        }
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    },
  );
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const root = document.documentElement;
      root.dataset.fictionalCspViolations =
        (root.dataset.fictionalCspViolations ?? '') +
        event.effectiveDirective +
        ',';
    });
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = {
      origin,
      tenantId: randomUUID(),
      clientId: 'synthetic',
      clientSecret: 'synthetic-secret',
    };
    await migrate(pool);
    await bootstrapAccess(
      pool,
      config.tenantId,
      'synthetic@example.invalid',
      'Synthetic auth',
      'Europe/Berlin',
    );
    if (mode === 'password') {
      await bootstrapPassword(
        pool,
        config.tenantId,
        'synthetic@example.invalid',
        'fictional.owner',
        () => 'Fictional password 123!',
      );
      await registerAuth(app, pool, {
        mode,
        origin,
        tenantId: config.tenantId,
      });
    } else {
      const google = await syntheticGoogle(config);
      callbackFor = google.code;
      await registerAuth(app, pool, config, {
        ...google.provider,
        async authorization(attempt) {
          const url = new URL(await google.provider.authorization(attempt));
          return origin + '/synthetic-google' + url.search;
        },
      });
    }
    registerAccessRoutes(app, pool, config.tenantId, mode);
    registerMasterDataRoutes(app, pool, config.tenantId);
    registerResourceRoutes(app, pool, config.tenantId);
    registerProductRoutes(app, pool, config.tenantId);
    registerContactRoutes(app, pool, config.tenantId);
    registerLocationRoutes(app, pool, config.tenantId);
    registerEventRoutes(app, pool, config.tenantId);
    // H035: the Dateien area reads the real, protected document list; the steps
    // below intercept its metadata request with synthetic rows instead of
    // touching any document, PDF or storage key.
    // BKP019.0: the offer status flow needs real artefact bytes, so the store
    // keeps the synthetic PDF in memory instead of pretending a write.
    const documentArtifacts = new Map<string, Buffer>();
    // BKP019.c3.2: the settlement block is a printed fact, and the synthetic
    // renderer would only keep its length. The HTML is captured here so the end
    // of the flow can assert the block that the PDF of this run was made from.
    const renderedHtml: string[] = [];
    registerDocumentRoutes(app, pool, config.tenantId, {
      origin,
      store: {
        async put(key: string, bytes: Buffer) {
          documentArtifacts.set(key, Buffer.from(bytes));
        },
        async read(key: string) {
          const bytes = documentArtifacts.get(key);
          if (!bytes) throw new StorageError('missing');
          return bytes;
        },
        async remove(key: string) {
          documentArtifacts.delete(key);
        },
      },
      render: async (html: string) => {
        renderedHtml.push(html);
        return Buffer.from('%PDF-1.4 synthetic ' + html.length);
      },
    });
    // BKP019.d: incoming payments are their own route pair next to the document
    // routes, guarded by the same auth and CSRF hook.
    registerDocumentPaymentRoutes(app, pool, config.tenantId);
    // BKP019.0: the offer card reads the real template list, so the seeded
    // template is selectable instead of failing the whole panel load.
    registerDocumentTemplateRoutes(app, pool, config.tenantId);
    // BKP020.1: the library runs on an in-memory adapter, so the browser
    // uploads and downloads real synthetic bytes without touching the disk.
    const libraryBytes = new Map<string, Buffer>();
    registerLibraryFileRoutes(app, pool, config.tenantId, {
      async put(key, bytes) {
        libraryBytes.set(key, Buffer.from(bytes));
      },
      async read(key) {
        const bytes = libraryBytes.get(key);
        if (!bytes) throw new StorageError('missing');
        return bytes;
      },
      async remove(key) {
        libraryBytes.delete(key);
      },
    });
    registerImportRoutes(app, pool, config.tenantId);
    registerInquiryPreviewRoute(app);
    registerWebsiteInquiryRoutes(app, pool, config.tenantId);
    registerWebsiteInboxRoutes(app, pool, config.tenantId);
    registerCalendarFeedRoutes(app, pool, config.tenantId, origin);
    const page = await context.newPage();
    // Headless Chromium has no foreground tab, so a real tab switch keeps
    // every page visible. Trigger the same visibility/focus transition in the
    // built page instead of sleeping or calling the removed refresh controls.
    const returnToApp = async () => {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
    };
    const policyErrors: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().includes('Content Security Policy')
      )
        policyErrors.push('blocked');
    });
    page.setDefaultTimeout(10000);
    let auditIndex = 0;
    const audit = async (state: string) => {
      const result = await new AxeBuilder({ page })
        .withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22aa',
          'best-practice',
        ])
        .analyze();
      const violations = result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      }));
      const report = test.info().outputPath(`a11y-${auditIndex++}.json`);
      await writeFile(
        report,
        JSON.stringify(
          {
            state,
            mode,
            viewport: page.viewportSize(),
            theme: await page.locator('html').getAttribute('data-theme'),
            violations,
            incomplete: result.incomplete.map(({ id, nodes }) => ({
              id,
              nodes: nodes.map(({ target, failureSummary }) => ({
                target,
                failureSummary,
              })),
            })),
          },
          null,
          2,
        ),
      );
      await test.info().attach(`${mode}-${state}-a11y`, {
        contentType: 'application/json',
        path: report,
      });
      expect(violations, `${mode}: ${state}`).toEqual([]);
    };

    // H035: Dateien is a real main area over the existing document list. The
    // metadata request is answered with synthetic rows, so no business data is
    // read and the real PDF route is never called.
    const syntheticFiles = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        kind: 'offer',
        templateId: '22222222-2222-4222-8222-222222222222',
        eventId: '33333333-3333-4333-8333-333333333333',
        contactId: null,
        number: null,
        state: 'draft',
        issuedAt: '2031-05-01T20:30:00.000Z',
        finalizedAt: null,
        netMinor: 0,
        taxMinor: 0,
        grossMinor: 0,
        version: 1,
        eventName: 'Synthetic browser wedding',
        issuedDate: '2031-05-01',
        pdfAvailable: false,
        // An offer is no claim: the derived payment facts are honestly empty.
        dueDate: null,
        paymentState: null,
        openMinor: null,
        overdue: null,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        kind: 'invoice',
        templateId: '22222222-2222-4222-8222-222222222222',
        eventId: null,
        contactId: null,
        number: 'RE-2031-0001',
        state: 'final',
        issuedAt: '2031-05-02T10:00:00.000Z',
        finalizedAt: '2031-05-02T10:00:00.000Z',
        netMinor: 123456,
        taxMinor: 0,
        grossMinor: 9007199254740991,
        version: 1,
        eventName: null,
        issuedDate: '2031-05-02',
        pdfAvailable: true,
        // A claim with money missing and its due day passed: the index shows the
        // payment state, the due day and the late badge from these four values.
        dueDate: '2031-05-16',
        paymentState: 'partial',
        openMinor: 100000,
        overdue: true,
      },
    ];
    const filesRequested: string[] = [];
    const documentsRoute = async (route: Route) => {
      filesRequested.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(syntheticFiles),
      });
    };
    // A pathname matcher, not a URL regex: the real request carries
    // ?include=metadata&limit=… and must never fall through to the server. It is
    // installed before the first page load because the panel can mount from a
    // restored hash, not only from a click.
    await page.route(
      (url) =>
        url.pathname === '/api/v1/documents' &&
        url.searchParams.get('include') === 'metadata',
      documentsRoute,
    );
    // A network observer from the very first request, to prove no PDF is fetched.
    const pdfRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/documents/'))
        pdfRequests.push(request.url());
    });
    const loadedDocument = await page.goto(origin);
    expect(loadedDocument!.headers()['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    await expect(
      mode === 'password'
        ? page.getByLabel('E-Mail oder Benutzername')
        : page.getByRole('link', { name: 'Mit Google anmelden' }),
    ).toBeVisible();
    expect(
      (
        await page.request.get(
          origin + '/api/v1/website-inquiries/form-definition',
        )
      ).status(),
    ).toBe(401);
    await audit('login');
    if (mode === 'password') {
      await page.setViewportSize({ width: 320, height: 740 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(321);
      await audit('login-mobile-light');
      await page.setViewportSize({ width: 1280, height: 720 });
      const identifierBox = await page
        .getByLabel('E-Mail oder Benutzername')
        .boundingBox();
      expect(identifierBox!.height).toBeGreaterThanOrEqual(44);
      await page.getByLabel('E-Mail oder Benutzername').fill('FICTIONAL.OWNER');
      await page.getByLabel('Passwort', { exact: true }).fill('incorrect');
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
      await expect(page.getByText(/Zugangsdaten prüfen/)).toBeVisible();
      await page
        .getByLabel('Passwort', { exact: true })
        .fill('Fictional password 123!');
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    } else
      await page.getByRole('link', { name: 'Mit Google anmelden' }).click();
    await expect(
      page.getByText('synthetic@example.invalid', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Abmelden', exact: true }),
    ).toBeInViewport();
    await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await audit('events-desktop-dark');
    await page.reload();
    await expect(
      page.getByRole('button', { name: /modus aktivieren/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(
      page.getByRole('button', { name: 'Abmelden', exact: true }),
    ).toHaveAttribute('title', 'Abmelden');
    await expect(
      page.getByRole('button', { name: /modus aktivieren/ }),
    ).toHaveAttribute('title', /modus aktivieren/);
    const sidebar = page.getByRole('complementary', {
      name: 'Arbeitsbereiche',
    });
    const collapse = sidebar.getByRole('button', {
      name: 'Navigation einklappen',
    });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.click();
    await expect(sidebar).toHaveClass(/collapsed/);
    await expect(
      sidebar.getByRole('button', { name: 'Navigation ausklappen' }),
    ).toBeFocused();
    await expect(
      sidebar.getByRole('link', { name: 'Events', exact: true }),
    ).toHaveAttribute('title', 'Events');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1281);
    await page.reload();
    await expect(sidebar).toHaveClass(/collapsed/);
    const expand = sidebar.getByRole('button', {
      name: 'Navigation ausklappen',
    });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(
      sidebar.getByRole('link', {
        name: 'AuftragsKompass – zur Eventübersicht',
      }),
    ).toHaveAttribute('title', 'AuftragsKompass – zur Eventübersicht');
    await expand.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
    const resizeToggle = sidebar.getByRole('button', {
      name: 'Navigation einklappen',
    });
    await resizeToggle.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('button', { name: 'Menü öffnen' }),
    ).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 720 });
    await resizeToggle.focus();
    // BKP006: real browser geometry instead of a class assertion — the brand
    // and the collapse control must share one compact row, never overlap, wrap
    // or cover a link, at desktop widths and at a 200 % zoom layout viewport.
    const brandRowOrder = () =>
      page.evaluate(() => {
        const row = document.querySelector(
          '.desktop-sidebar .sidebar-brand-row',
        );
        return row
          ? Array.from(row.children).map(
              (child) => child.getAttribute('class') ?? '',
            )
          : [];
      });
    const brandRowReport = () =>
      page.evaluate(() => {
        const shown = (element: Element | null): element is HTMLElement => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(element).visibility !== 'hidden'
          );
        };
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const covered = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== element && !element.contains(hit);
        };
        const sidebar = document.querySelector('.desktop-sidebar');
        const row = document.querySelector(
          '.desktop-sidebar .sidebar-brand-row',
        );
        const brand = document.querySelector(
          '.desktop-sidebar .sidebar-brand-row a.menu-brand',
        );
        const toggle = document.querySelector(
          '.desktop-sidebar .sidebar-brand-row .sidebar-toggle',
        );
        const name = document.querySelector(
          '.desktop-sidebar .sidebar-brand-row .brand-name',
        );
        const mark = document.querySelector(
          '.desktop-sidebar .sidebar-brand-row .brand-mark',
        );
        return {
          sidebarVisible: shown(sidebar),
          sidebar: shown(sidebar) ? box(sidebar) : null,
          row: shown(row) ? box(row) : null,
          brand: shown(brand) ? box(brand) : null,
          toggle: shown(toggle) ? box(toggle) : null,
          name: shown(name)
            ? {
                ...box(name),
                clipped: name.scrollWidth > name.clientWidth + 1,
                whiteSpace: getComputedStyle(name).whiteSpace,
              }
            : null,
          mark: shown(mark) ? box(mark) : null,
          brandCovered: shown(brand) ? covered(brand) : null,
          toggleCovered: shown(toggle) ? covered(toggle) : null,
          linksCovered: Array.from(
            document.querySelectorAll('.desktop-sidebar nav a'),
          )
            .filter(shown)
            .map((link) => covered(link)),
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
    const expectSharedBrandRow = async () => {
      // Keyboard activation can leave the button's active transform easing out
      // after keyup, so measure the 44px touch target after that transition.
      await sidebar.locator('.sidebar-toggle').evaluate(async (button) => {
        await Promise.all(
          button
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      const report = await brandRowReport();
      expect(report.row).not.toBeNull();
      const row = report.row!;
      const brand = report.brand!;
      const toggle = report.toggle!;
      const name = report.name;
      // Both controls stay inside the one shared row box.
      for (const part of [brand, toggle]) {
        expect(part.top).toBeGreaterThanOrEqual(row.top - 1);
        expect(part.bottom).toBeLessThanOrEqual(row.bottom + 1);
      }
      // No label may sit on top of the control, in either state.
      const horizontal =
        Math.min(brand.right, toggle.right) - Math.max(brand.left, toggle.left);
      const vertical =
        Math.min(brand.bottom, toggle.bottom) - Math.max(brand.top, toggle.top);
      expect(horizontal > 0 && vertical > 0).toBe(false);
      expect(toggle.left).toBeGreaterThanOrEqual(report.sidebar!.left);
      expect(toggle.right).toBeLessThanOrEqual(report.sidebar!.right);
      expect(toggle.width).toBeGreaterThanOrEqual(44);
      expect(toggle.height).toBeGreaterThanOrEqual(44);
      // The wordmark stays on one line; collapsed it gives way to the AK mark.
      if (name) {
        expect(name.whiteSpace).toBe('nowrap');
        expect(name.height).toBeLessThanOrEqual(30);
        // Layout guarantee independent of the viewer's font: the shared row
        // leaves the wordmark link at least 168px, which also fits wide system
        // fonts uncut (the CI Linux stack clipped it at 156px before).
        expect(brand.width).toBeGreaterThanOrEqual(168);
      } else expect(report.mark).not.toBeNull();
      expect(report.brandCovered).toBe(false);
      expect(report.toggleCovered).toBe(false);
      expect(report.linksCovered.every((value) => value === false)).toBe(true);
      expect(report.overflow).toBeLessThanOrEqual(0);
      return report;
    };

    // Expanded at 1280 light: mark at the row start, control at its end.
    const expandedRow = await expectSharedBrandRow();
    expect(expandedRow.brand!.left).toBeLessThanOrEqual(
      expandedRow.row!.left + 1,
    );
    expect(expandedRow.toggle!.right).toBeGreaterThanOrEqual(
      expandedRow.row!.right - 1,
    );
    expect(expandedRow.name!.clipped).toBe(false);
    expect(await brandRowOrder()).toEqual(['menu-brand', 'sidebar-toggle']);

    // Keyboard only: Enter collapses, Space expands, same node keeps focus.
    await page.keyboard.press('Enter');
    await expect(sidebar).toHaveClass(/collapsed/);
    const collapsedRow = await expectSharedBrandRow();
    expect(collapsedRow.toggle!.top).toBeGreaterThanOrEqual(
      collapsedRow.brand!.bottom - 1,
    );
    expect(
      collapsedRow.toggle!.left + collapsedRow.toggle!.width / 2,
    ).toBeCloseTo(collapsedRow.brand!.left + collapsedRow.brand!.width / 2, 0);
    expect(await brandRowOrder()).toEqual(['menu-brand', 'sidebar-toggle']);
    await expect(
      sidebar.getByRole('button', { name: 'Navigation ausklappen' }),
    ).toBeFocused();
    await page.keyboard.press('Space');
    await expect(sidebar).not.toHaveClass(/collapsed/);
    await expect(
      sidebar.getByRole('button', { name: 'Navigation einklappen' }),
    ).toBeFocused();

    // 1920 px at 200 % zoom leaves 960 CSS px, 2048 px leaves 1024.
    for (const width of [960, 1024]) {
      await page.setViewportSize({ width, height: 720 });
      await expectSharedBrandRow();
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await expectSharedBrandRow();

    // A preference change from another tab keeps the control as focus target.
    await resizeToggle.focus();
    await page.evaluate(() => {
      localStorage.setItem('ak-sidebar', 'collapsed');
      window.dispatchEvent(new StorageEvent('storage', { key: 'ak-sidebar' }));
    });
    await expect(sidebar).toHaveClass(/collapsed/);
    await expect(
      sidebar.getByRole('button', { name: 'Navigation ausklappen' }),
    ).toBeFocused();
    await page.evaluate(() => {
      localStorage.setItem('ak-sidebar', 'expanded');
      window.dispatchEvent(new StorageEvent('storage', { key: 'ak-sidebar' }));
    });
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Dark theme keeps the same row geometry and a visible control.
    await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectSharedBrandRow();
    expect(
      await sidebar
        .locator('.sidebar-toggle')
        .evaluate((element) => getComputedStyle(element).color),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // 768, 640 (1280 at 200 %), 390 and 320: one menu access, no collapse.
    for (const width of [768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole('button', { name: 'Menü öffnen' }),
      ).toHaveCount(1);
      await expect(sidebar).toBeHidden();
      await expect(
        page.getByRole('button', { name: /Navigation (ein|aus)klappen/ }),
      ).toBeHidden();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: 'Menü öffnen' }).click();
      const menu = page.getByRole('dialog', { name: 'Menü' });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole('button', { name: /Navigation (ein|aus)klappen/ }),
      ).toHaveCount(0);
      await expect(menu.locator('.sidebar-toggle')).toHaveCount(0);
      const drawerBrand = menu.getByRole('link', {
        name: 'AuftragsKompass – zur Eventübersicht',
      });
      await expect(drawerBrand).toBeVisible();
      const drawerBrandBox = await drawerBrand.boundingBox();
      const closeBox = await menu
        .getByRole('button', { name: 'Menü schließen' })
        .boundingBox();
      // The drawer shares one line with its close control: neither may cover
      // the other, and the brand must stay inside the narrow viewport.
      const drawerOverlapX =
        Math.min(
          drawerBrandBox!.x + drawerBrandBox!.width,
          closeBox!.x + closeBox!.width,
        ) - Math.max(drawerBrandBox!.x, closeBox!.x);
      const drawerOverlapY =
        Math.min(
          drawerBrandBox!.y + drawerBrandBox!.height,
          closeBox!.y + closeBox!.height,
        ) - Math.max(drawerBrandBox!.y, closeBox!.y);
      expect(drawerOverlapX > 0 && drawerOverlapY > 0).toBe(false);
      expect(drawerBrandBox!.x + drawerBrandBox!.width).toBeLessThanOrEqual(
        width,
      );
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(sidebar).toBeVisible();
    await expect(sidebar).not.toHaveClass(/collapsed/);
    expect(
      (await context.cookies()).find((c) => c.name === '__Host-ak-session'),
    ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    const sessionExpiry = (await context.cookies()).find(
      (cookie) => cookie.name === '__Host-ak-session',
    )!.expires;
    expect(
      Math.abs(sessionExpiry - Date.now() / 1000 - 90 * 24 * 60 * 60),
    ).toBeLessThan(120);
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      'ak-session',
    );
    const navigate = async (label: string, setting?: string) => {
      await page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: label, exact: true })
        .click();
      if (setting)
        await page
          .getByRole('navigation', { name: 'Einstellungen', exact: true })
          .getByRole('link', { name: setting, exact: true })
          .click();
      await expect(
        page
          .getByRole('navigation', { name: 'Hauptnavigation' })
          .getByRole('link', { name: label, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await audit(label + (setting ?? ''));
    };
    // The linked event is real so its details can really open; it exists only
    // for this step and is removed again before the later import assertions.
    await pool.query(
      "INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html) VALUES ($1::uuid,'33333333-3333-4333-8333-333333333333','Synthetic browser wedding','option','Fictional browser files fixture',DATE '2031-05-01','Europe/Berlin','','') ON CONFLICT DO NOTHING",
      [config.tenantId],
    );
    await navigate('Dateien');
    const files = page.getByRole('region', { name: 'Dateien' });
    await expect(files).toBeVisible();

    // Exactly one page heading in the whole document, owned by the shell; the
    // panel itself adds none and repeats no visible "Dateien" title.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Dateien – zur Eventübersicht',
      }),
    ).toBeVisible();
    await expect(files.getByRole('heading')).toHaveCount(0);
    await expect(files.getByText('Angebot · Entwurf')).toBeVisible();
    await expect(files.getByText('01.05.2031')).toBeVisible();
    await expect(files.getByText('0,00 €')).toBeVisible();
    // The largest exact amount would print ,90 if it were divided by 100.
    await expect(files.getByText('90.071.992.547.409,91 €')).toBeVisible();
    await expect(
      files.getByRole('button', { name: 'Vorherige Seite' }),
    ).toBeDisabled();
    await expect(
      files.getByRole('link', { name: 'Rechnung RE-2031-0001 als PDF öffnen' }),
    ).toHaveAttribute(
      'href',
      '/api/v1/documents/88888888-8888-4888-8888-888888888888/pdf',
    );
    expect(filesRequested.some((url) => url.includes('/pdf'))).toBe(false);
    await files.getByLabel('Dokumentart').selectOption('invoice');
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .toContain('kind=invoice');
    expect(new URL(filesRequested.at(-1)!).searchParams.get('limit')).toBe(
      '26',
    );
    const resetButton = files.getByRole('button', {
      name: 'Filter zurücksetzen',
    });
    expect((await resetButton.boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
    await resetButton.click();
    await expect.poll(() => filesRequested.at(-1) ?? '').not.toContain('kind=');
    // UI-01: the payment and due axes are one folded subgroup of the context
    // column, so they are opened by a real click instead of covering the list.
    await files.getByText('Zahlung und Frist', { exact: true }).click();
    await expect(files.getByLabel('Zahlungsstand')).toBeVisible();
    // BKP019.e: the payment and due filters are real deep-link state. A control
    // writes the `df_*` key, the request carries the API name, and the row shows
    // the derived facts the server filtered on.
    await files.getByLabel('Zahlungsstand').selectOption('partial');
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .toContain('payment=partial');
    await files.getByLabel('Überfällig').selectOption('true');
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .toContain('overdue=true');
    await files.getByLabel('Fällig bis').fill('2031-05-31');
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .toContain('due_to=2031-05-31');
    const claimRow = files
      .getByRole('row')
      .filter({ hasText: 'Rechnung RE-2031-0001' });
    await expect(claimRow.getByText('Teilweise bezahlt')).toBeVisible();
    await expect(
      claimRow.getByText('Überfällig', { exact: true }),
    ).toBeVisible();
    await expect(claimRow.getByText('16.05.2031')).toBeVisible();
    // The same filter set restored from the URL: a copied link is the view.
    const deepLink = new URL(page.url());
    await page.goto(deepLink.toString());
    await expect(files.getByLabel('Zahlungsstand')).toHaveValue('partial');
    await expect(files.getByLabel('Überfällig')).toHaveValue('true');
    await expect(files.getByLabel('Fällig bis')).toHaveValue('2031-05-31');
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .toContain('payment=partial');
    await expect(
      files
        .getByRole('row')
        .filter({ hasText: 'Rechnung RE-2031-0001' })
        .getByText('Überfällig', { exact: true }),
    ).toBeVisible();
    await files.getByLabel('Zahlungsstand').selectOption('');
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .not.toContain('payment=');
    const pdfLink = files.getByRole('link', {
      name: 'Rechnung RE-2031-0001 als PDF öffnen',
    });
    await pdfLink.focus();
    expect(
      await pdfLink.evaluate((element) => element === document.activeElement),
    ).toBe(true);
    // UI-01: the observed frame has a measured breakpoint. At 1280 px the
    // context column and the 40rem table share one row; below it the compact
    // access and its sheet take over. Every size keeps the body free of
    // sideways scroll, in both themes.
    const filesThemeToggle = page.getByRole('button', {
      name: /modus aktivieren/,
    });
    const setTheme = async (theme: 'light' | 'dark') => {
      if (
        (await filesThemeToggle.getAttribute('aria-pressed')) !==
        String(theme === 'dark')
      )
        await filesThemeToggle.click();
    };
    const compactAccess = page.getByRole('button', {
      name: /^Filter, \d+ aktive Kriterien$/,
    });
    if (filesAudit) {
      for (const [width, height] of [
        [320, 740],
        [390, 844],
        [768, 900],
        [1280, 720],
      ] as const)
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height });
          await setTheme(theme);
          await expect(files.locator('.files-table')).toBeVisible();
          await expect(files.getByText('Angebot · Entwurf')).toBeVisible();
          await expect(
            files.getByRole('button', { name: 'Nächste Seite' }),
          ).toBeVisible();
          if (width < 1280) {
            // Nothing but one access stands between the reader and the list.
            await expect(files.locator('.files-context')).toHaveCount(0);
            await expect(compactAccess).toBeVisible();
            expect(
              (await compactAccess.boundingBox())!.height,
            ).toBeGreaterThanOrEqual(44);
            await expect(files.getByTestId('file-filter-count')).toHaveText(
              '2',
            );
          } else {
            await expect(files.locator('.files-context')).toBeVisible();
            await expect(compactAccess).toHaveCount(0);
            // Measured, not guessed: the column leaves the table its full width.
            const geometry = await page.evaluate(() => {
              const shell =
                document.querySelector<HTMLElement>('.files-table-shell')!;
              const context =
                document.querySelector<HTMLElement>('.files-context')!;
              return {
                viewport: window.innerWidth,
                context: Math.round(context.getBoundingClientRect().width),
                shellClient: shell.clientWidth,
                shellScroll: shell.scrollWidth,
              };
            });
            console.log('UI-01 files geometry@1280', geometry);
            // Measured 684/684: the eight columns fit the track. The 8 px
            // tolerance only absorbs font-metric differences of another OS.
            expect(geometry.shellScroll).toBeLessThanOrEqual(
              geometry.shellClient + 8,
            );
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width + 1);
          await audit(`dateien-${width}-${theme}`);
          // Evidence for the hand-off lives in the ignored test-results folder.
          await page.screenshot({
            path: test.info().outputPath(`dateien-${width}-${theme}.png`),
          });
        }
      await page.setViewportSize({ width: 1280, height: 720 });
      await setTheme('light');
      await page.setViewportSize({ width: 1024, height: 768 });
      // The measured 1024 px case: 18rem sidebar + 2.5rem shell + 1.75rem page
      // padding leave 640 px, and a 216 px column plus the 40rem table would need
      // 872 px. The compact access is the honest frame there.
      const narrowGeometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        section: Math.round(
          document.querySelector<HTMLElement>('#files')!.clientWidth,
        ),
      }));
      console.log('UI-01 files geometry@1024', narrowGeometry);
      await expect(files.locator('.files-context')).toHaveCount(0);
      await expect(compactAccess).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(1025);
      await audit('dateien-1024-light');
      await page.screenshot({
        path: test.info().outputPath('dateien-1024-light.png'),
      });
      return;
    }
    await setTheme('light');
    await page.setViewportSize({ width: 1024, height: 768 });
    // The sheet is opened by a real click, keeps one draft and writes the URL
    // only on „Ergebnisse anzeigen“.
    const urlBeforeSheet = page.url();
    await compactAccess.click();
    await expect(
      page.getByRole('dialog', { name: 'Dateifilter' }),
    ).toBeVisible();
    expect(page.url()).toBe(urlBeforeSheet);
    await files.getByLabel('Dokumentart').selectOption('invoice');
    await files.getByLabel('Status').selectOption('draft');
    expect(page.url()).toBe(urlBeforeSheet);
    await files.getByRole('button', { name: 'Ergebnisse anzeigen' }).click();
    await expect(page.getByRole('dialog', { name: 'Dateifilter' })).toHaveCount(
      0,
    );
    expect(
      await compactAccess.evaluate(
        (element) => element === document.activeElement,
      ),
    ).toBe(true);
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .toContain('state=draft');
    await expect(files.getByTestId('file-filter-count')).toHaveText('4');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goBack();
    await expect
      .poll(() => filesRequested.at(-1) ?? '')
      .not.toContain('state=draft');
    await page.setViewportSize({ width: 1280, height: 720 });
    await audit('dateien');
    // A real Event filter that would hide the linked event, plus a file filter.
    const filesUrlBefore = page.url();
    await page.evaluate(() => {
      const url = new URL(location.href);
      // An Event filter that really would hide the linked event.
      url.searchParams.set('status', 'option');
      url.searchParams.set('df_kind', 'offer');
      history.pushState(null, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    const eventLink = files.getByRole('link', {
      name: 'Synthetic browser wedding',
    });
    const targetHref = await eventLink.getAttribute('href');
    const target = new URL(targetHref!, origin);
    expect(target.searchParams.get('status')).toBeNull();
    expect(target.searchParams.get('df_kind')).toBe('offer');
    expect(target.hash).toBe('#event-33333333-3333-4333-8333-333333333333');
    // Modifier clicks never change the current route or filters.
    await eventLink.click({ modifiers: ['ControlOrMeta'] });
    expect(new URL(page.url()).hash).toBe('#files');
    // BKP019.0: the offer validity and status flow, run against the real
    // document routes of this tenant. Only synthetic fixtures are seeded: one
    // contact, one offer template with one position, a layout and a number
    // range. The event is the one the stubbed Dateien row already links to.
    const offerContactId = randomUUID(),
      offerTemplateId = randomUUID(),
      offerEventId = '33333333-3333-4333-8333-333333333333';
    await pool.query(
      `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
        email,phone,mobile,phone_key,mobile_key,state,version)
       VALUES ($1,$2,'private','Fictional Offer Recipient','Robin Example','Fictional Way 1','00000',
        'Example City','DE','offer-recipient@example.invalid','','','','','active',1)`,
      [config.tenantId, offerContactId],
    );
    await pool.query(
      `INSERT INTO event_contacts (tenant_id,event_id,contact_id,role)
       VALUES ($1,$2,$3,'primary')`,
      [config.tenantId, offerEventId, offerContactId],
    );
    await pool.query(
      `INSERT INTO document_templates (tenant_id,id,kind,name,subject,intro_text,outro_text,
        validity_days,state,version)
       VALUES ($1,$2,'offer','Fictional browser offer','Angebot für {{contact}}','Hallo','Ende',
        14,'active',1)`,
      [config.tenantId, offerTemplateId],
    );
    await pool.query(
      `INSERT INTO document_template_positions (tenant_id,template_id,id,position,product_id,
        description,quantity,unit,unit_price_minor,tax_basis_points,discount_basis_points)
       VALUES ($1,$2,$3,0,NULL,'Fictional browser service',1,'Stück',10000,1900,0)`,
      [config.tenantId, offerTemplateId, randomUUID()],
    );
    await pool.query(
      `INSERT INTO document_layouts (tenant_id,sender_name,sender_street,sender_postal_code,
        sender_city,primary_color,text_color,font_family,show_page_numbers,show_position_numbers,
        version)
       VALUES ($1,'Fictional Studio','Fictional Way 1','00000','Example City','#234f3b','#202020',
        'system',true,true,1) ON CONFLICT DO NOTHING`,
      [config.tenantId],
    );
    await pool.query(
      `INSERT INTO document_number_sequences (tenant_id,kind,pattern,min_length,next_value,version)
       VALUES ($1,'offer','AN-{YYYY}-{SEQ}',4,1,1) ON CONFLICT DO NOTHING`,
      [config.tenantId],
    );
    // A plain click is ordinary SPA navigation and opens the event details.
    await eventLink.click();
    await expect(page).toHaveURL(
      /#event-33333333-3333-4333-8333-333333333333$/,
    );
    await expect(
      page.locator('#event-33333333-3333-4333-8333-333333333333'),
    ).toBeVisible();
    // BKP019.0: the offer validity and status flow, seeded above before the
    // event details load, because the panel reads the event's primary contact.
    await page
      .getByRole('navigation', { name: 'Bereiche des Events' })
      .getByRole('button', { name: 'Dateien' })
      .click();
    const eventOffers = page.getByRole('region', { name: 'Angebote' });
    await eventOffers
      .getByLabel('Vorlage')
      .selectOption({ label: 'Fictional browser offer' });
    await eventOffers.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByText('Entwurf angelegt.')).toBeVisible();
    // One explicit finalization: it freezes number, PDF and the deadline.
    await eventOffers
      .getByRole('button', { name: 'Angebot Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als/)).toBeVisible();
    // Finalization and the business status stay two separate facts.
    await expect(
      eventOffers.getByText('Finalisiert', { exact: true }),
    ).toBeVisible();
    await expect(
      eventOffers.getByText('Noch nicht versendet', { exact: true }),
    ).toBeVisible();
    await expect(eventOffers.getByText(/Gültig bis/)).toBeVisible();
    await expect(eventOffers.getByText('Abgelaufen')).toHaveCount(0);
    const offer = (
      await pool.query<{
        id: string;
        number: string;
        valid_until: string;
        offer_status: string | null;
      }>(
        `SELECT id, number, to_char(valid_until,'DD.MM.YYYY') AS valid_until, offer_status
           FROM documents WHERE tenant_id=$1 AND event_id=$2`,
        [config.tenantId, offerEventId],
      )
    ).rows[0]!;
    expect(offer.offer_status).toBeNull();
    // The visible deadline is the stored one, not a second computation.
    await expect(
      eventOffers.getByText(offer.valid_until, { exact: true }),
    ).toBeVisible();
    const pdfOf = async () =>
      await page.request.get(origin + '/api/v1/documents/' + offer.id + '/pdf');
    const firstPdf = await pdfOf();
    expect(firstPdf.status()).toBe(200);
    const firstBytes = await firstPdf.body();
    expect(firstBytes.subarray(0, 5).toString()).toBe('%PDF-');
    // BKP019.0: three explicit operator actions, each one a separate step.
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' versendet markieren',
      })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Versendet.'),
    ).toBeVisible();
    await expect(
      eventOffers.getByText('Versendet', { exact: true }),
    ).toBeVisible();
    // A sent offer offers "accepted", never "sent" again.
    await expect(
      eventOffers.getByRole('button', {
        name: 'Angebot ' + offer.number + ' versendet markieren',
      }),
    ).toHaveCount(0);
    // BKP019.a: the acceptance is a compact record, not a one-click jump. A
    // real synthetic library file stands in for the signed PDF and is uploaded
    // through the real route, so the download below is a real download.
    const signedPdf = Buffer.from(
        '%PDF-1.4 synthetic signed acceptance\n%%EOF\n',
        'latin1',
      ),
      csrf = (
        (await (await page.request.get(origin + '/auth/me')).json()) as {
          csrfToken: string;
        }
      ).csrfToken,
      uploaded = await page.request.post(origin + '/api/v1/library-files', {
        headers: { origin, 'x-csrf-token': csrf },
        data: {
          displayName: 'synthetic-signed-offer.pdf',
          mediaType: 'application/pdf',
          contentBase64: signedPdf.toString('base64'),
        },
      });
    expect(uploaded.status()).toBe(201);
    const signedFile = (await uploaded.json()) as { id: string };
    await eventOffers
      .getByRole('button', { name: 'Angebot ' + offer.number + ' annehmen' })
      .click();
    // Opening the form writes nothing: the channel is a real operator choice.
    const acceptanceForm = eventOffers.getByRole('form', {
      name: 'Annahme erfassen',
    });
    await expect(acceptanceForm).toBeVisible();
    await acceptanceForm.getByLabel('Kanal').selectOption({ label: 'Telefon' });
    await acceptanceForm
      .getByLabel('Notiz (optional)')
      .fill('Mündliche Zusage, unterschriebene Fassung liegt vor.');
    await acceptanceForm
      .getByLabel('Anhang (optional)')
      .selectOption({ label: 'synthetic-signed-offer.pdf' });
    await acceptanceForm
      .getByRole('button', { name: 'Annahme speichern' })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Angenommen.'),
    ).toBeVisible();
    await expect(
      eventOffers.getByText('Angenommen', { exact: true }),
    ).toBeVisible();
    // The record reads back with its own instant, channel, note and file.
    await expect(eventOffers.getByText(/Angenommen am/)).toBeVisible();
    await expect(eventOffers.getByText(/Telefon/)).toBeVisible();
    await expect(
      eventOffers.getByText(/Mündliche Zusage, unterschriebene Fassung/),
    ).toBeVisible();
    await expect(
      eventOffers.getByRole('link', { name: /synthetic-signed-offer\.pdf/ }),
    ).toBeVisible();
    const signedDownload = await page.request.get(
      origin + '/api/v1/library-files/' + signedFile.id + '/content',
    );
    expect(signedDownload.status()).toBe(200);
    expect((await signedDownload.body()).equals(signedPdf)).toBe(true);
    // No invented jump: an accepted offer cannot be accepted again.
    await expect(
      eventOffers.getByRole('button', { name: /annehmen$/ }),
    ).toHaveCount(0);
    await audit('event-angebot-angenommen');
    // BKP019.b: the accepted offer becomes an order confirmation without a
    // single retyped position. It owns a separate number range, so the offer's
    // number and bytes can never move.
    // The confirmation owns its number range; this server seeds number ranges
    // directly (the settings routes are not part of this scenario).
    await pool.query(
      `INSERT INTO document_number_sequences
        (tenant_id,kind,pattern,min_length,next_value,version)
       VALUES ($1,'order_confirmation','AB-{YYYY}-{SEQ}',4,1,1)`,
      [config.tenantId],
    );
    const confirmationCount = async () =>
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM documents
            WHERE tenant_id=$1 AND kind='order_confirmation'`,
          [config.tenantId],
        )
      ).rows[0]!.count;
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' Auftragsbestätigung erstellen',
      })
      .click();
    // The step asks once and writes nothing before the confirmation.
    await expect(
      eventOffers.getByRole('button', {
        name: 'Angebot ' + offer.number + ' Auftragsbestätigung anlegen',
      }),
    ).toBeVisible();
    expect(await confirmationCount()).toBe(0);
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' Auftragsbestätigung anlegen',
      })
      .click();
    await expect(
      page.getByText('Auftragsbestätigung als Entwurf angelegt.'),
    ).toBeVisible();
    const orders = page.getByRole('region', { name: 'Auftragsbestätigungen' });
    await expect(orders.getByRole('listitem')).toHaveCount(1);
    // A draft has no number, so "Entwurf" appears twice in its row: as the
    // number placeholder and as the state. The state is what is asserted here.
    await expect(orders.locator('.document-row span').first()).toHaveText(
      'Entwurf',
    );
    const confirmation = (
      await pool.query<{
        id: string;
        number: string | null;
        source_document_id: string;
        gross_minor: string;
      }>(
        `SELECT id, number, source_document_id, gross_minor FROM documents
          WHERE tenant_id=$1 AND kind='order_confirmation'`,
        [config.tenantId],
      )
    ).rows[0]!;
    // The link is durable, the number is not yet allocated, and the amount is
    // the offer's own - no retyping happened, so no second sum either.
    expect(confirmation.source_document_id).toBe(offer.id);
    expect(confirmation.number).toBeNull();
    const offerGross = (
      await pool.query<{ gross_minor: string }>(
        'SELECT gross_minor FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, offer.id],
      )
    ).rows[0]!.gross_minor;
    expect(confirmation.gross_minor).toBe(offerGross);
    // The copied positions are the offer's own, read through the real API.
    type Detail = {
      subject: string;
      lines: {
        description: string;
        quantity: number;
        unit: string;
        unitPriceMinor: number;
        taxBasisPoints: number;
        discountBasisPoints: number;
      }[];
    };
    // The copy has its own line ids; what must be identical is the content.
    const copied = (lines: Detail['lines']) =>
      lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceMinor: line.unitPriceMinor,
        taxBasisPoints: line.taxBasisPoints,
        discountBasisPoints: line.discountBasisPoints,
      }));
    const confirmationDetail = (await (
      await page.request.get(origin + '/api/v1/documents/' + confirmation.id)
    ).json()) as Detail;
    const offerDetail = (await (
      await page.request.get(origin + '/api/v1/documents/' + offer.id)
    ).json()) as Detail;
    expect(copied(confirmationDetail.lines)).toEqual(copied(offerDetail.lines));
    expect(confirmationDetail.lines.length).toBeGreaterThan(0);
    expect(confirmationDetail.subject).toBe(
      'Auftragsbestätigung für {{contact}}',
    );
    expect(offerDetail.subject).toBe('Angebot für {{contact}}');
    // The source is readable and linked.
    await expect(
      orders.locator('.document-meta', { hasText: 'Aus Angebot' }),
    ).toBeVisible();
    await expect(
      orders.getByRole('link', {
        name: 'Angebot ' + offer.number + ' als PDF öffnen',
      }),
    ).toHaveAttribute('href', '/api/v1/documents/' + offer.id + '/pdf');
    // A second attempt is explained, never silently written twice.
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' Auftragsbestätigung erstellen',
      })
      .click();
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' Auftragsbestätigung anlegen',
      })
      .click();
    await expect(
      page.getByText(
        'Für dieses Angebot gibt es bereits eine Auftragsbestätigung.',
      ),
    ).toBeVisible();
    expect(await confirmationCount()).toBe(1);
    // BKP019.b2: the copied wording is correctable before it is frozen. The
    // confirmation opens the same editor an offer draft uses, under its own name.
    const editedIntro =
      'Fiktive Einleitung der Bestätigung, vor der Finalisierung korrigiert.';
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung Entwurf bearbeiten',
      })
      .click();
    const confirmationEditor = orders.locator('.offer-draft-editor');
    await expect(
      confirmationEditor.getByRole('heading', {
        name: 'Auftragsbestätigung bearbeiten',
      }),
    ).toBeVisible();
    // The offer heading of the shared editor never labels a confirmation.
    await expect(
      confirmationEditor.getByRole('heading', { name: 'Angebot bearbeiten' }),
    ).toHaveCount(0);
    await expect(confirmationEditor.getByLabel('Einleitung')).toHaveValue(
      'Hallo',
    );
    await confirmationEditor.getByLabel('Einleitung').fill(editedIntro);
    await confirmationEditor
      .getByRole('button', { name: 'Änderungen speichern' })
      .click();
    await expect(
      confirmationEditor.getByText('Änderungen gespeichert.'),
    ).toBeVisible();
    // The correction lands on the confirmation's own row; the offer it was
    // copied from keeps its wording and its version.
    const editedDraft = (
      await pool.query<{ intro_text: string; version: number }>(
        'SELECT intro_text, version FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, confirmation.id],
      )
    ).rows[0]!;
    expect(editedDraft).toEqual({ intro_text: editedIntro, version: 2 });
    const offerIntroAfterEdit = (
      await pool.query<{ intro_text: string }>(
        'SELECT intro_text FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, offer.id],
      )
    ).rows[0]!.intro_text;
    expect(offerIntroAfterEdit).toBe('Hallo');
    // Finalizing uses the confirmation's own number range.
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung Entwurf finalisieren',
      })
      .click();
    await expect(page.getByText(/Finalisiert als AB-/)).toBeVisible();
    // The frozen version carries the corrected wording, and its own PDF.
    const frozenConfirmation = (await (
      await page.request.get(origin + '/api/v1/documents/' + confirmation.id)
    ).json()) as { state: string; introText: string; pdfHash: string | null };
    expect(frozenConfirmation.state).toBe('final');
    expect(frozenConfirmation.introText).toBe(editedIntro);
    expect(frozenConfirmation.pdfHash).toBeTruthy();
    const frozenPdf = await page.request.get(
      origin + '/api/v1/documents/' + confirmation.id + '/pdf',
    );
    expect(frozenPdf.status()).toBe(200);
    expect((await frozenPdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const confirmedNumber = (
      await pool.query<{ number: string }>(
        'SELECT number FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, confirmation.id],
      )
    ).rows[0]!.number;
    expect(confirmedNumber).toMatch(/^AB-\d{4}-\d{4}$/);
    await expect(
      orders.getByText(confirmedNumber, { exact: true }),
    ).toBeVisible();
    await expect(
      orders.getByRole('link', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' als PDF öffnen',
      }),
    ).toBeVisible();
    await expect(
      orders.locator('.document-meta', { hasText: 'Aus Angebot' }),
    ).toBeVisible();
    // BKP019.c1: the finalized confirmation becomes an invoice draft with the
    // same positions. The invoice owns the invoice number range, so neither the
    // offer nor the confirmation can lose its number or its bytes.
    const confirmationPdfBytes = await (
      await page.request.get(
        origin + '/api/v1/documents/' + confirmation.id + '/pdf',
      )
    ).body();
    await pool.query(
      `INSERT INTO document_number_sequences
        (tenant_id,kind,pattern,min_length,next_value,version)
       VALUES ($1,'invoice','RE-{YYYY}-{SEQ}',4,1,1)`,
      [config.tenantId],
    );
    const invoiceCount = async () =>
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM documents
            WHERE tenant_id=$1 AND kind='invoice'`,
          [config.tenantId],
        )
      ).rows[0]!.count;
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Rechnung erstellen',
      })
      .click();
    // The step asks once and writes nothing before the confirmation.
    await expect(
      orders.getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Rechnung anlegen',
      }),
    ).toBeVisible();
    expect(await invoiceCount()).toBe(0);
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Rechnung anlegen',
      })
      .click();
    await expect(
      page.getByText('Rechnung als Entwurf angelegt.'),
    ).toBeVisible();
    const invoices = page.getByRole('region', { name: 'Rechnungen' });
    await expect(invoices.getByRole('listitem')).toHaveCount(1);
    await expect(invoices.locator('.document-row span').first()).toHaveText(
      'Entwurf',
    );
    const invoice = (
      await pool.query<{
        id: string;
        number: string | null;
        source_document_id: string;
        gross_minor: string;
      }>(
        `SELECT id, number, source_document_id, gross_minor FROM documents
          WHERE tenant_id=$1 AND kind='invoice'`,
        [config.tenantId],
      )
    ).rows[0]!;
    // The link points at the confirmation, no number is allocated yet and the
    // amount is the confirmation's own - nothing was retyped or recomputed.
    expect(invoice.source_document_id).toBe(confirmation.id);
    expect(invoice.number).toBeNull();
    expect(invoice.gross_minor).toBe(confirmation.gross_minor);
    const invoiceDetail = (await (
      await page.request.get(origin + '/api/v1/documents/' + invoice.id)
    ).json()) as Detail;
    expect(copied(invoiceDetail.lines)).toEqual(
      copied(confirmationDetail.lines),
    );
    expect(invoiceDetail.subject).toBe('Rechnung für {{contact}}');
    await expect(
      invoices.locator('.document-meta', {
        hasText: 'Aus Auftragsbestätigung',
      }),
    ).toBeVisible();
    await expect(
      invoices.getByRole('link', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' als PDF öffnen',
      }),
    ).toHaveAttribute('href', '/api/v1/documents/' + confirmation.id + '/pdf');
    // A second invoice is impossible, and the screen says so instead of offering
    // a step that can only end in a conflict: BKP019.c3.2 makes the one-invoice
    // rule visible, because a confirmation now carries either the standard or the
    // final invoice.
    await expect(
      orders.getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Rechnung erstellen',
      }),
    ).toHaveCount(0);
    await expect(
      orders.getByRole('button', {
        name:
          'Auftragsbestätigung ' +
          confirmedNumber +
          ' Schlussrechnung erstellen',
      }),
    ).toHaveCount(0);
    await expect(orders.getByText(/trägt bereits eine Rechnung/)).toBeVisible();
    expect(await invoiceCount()).toBe(1);
    // RG-07: the service day and the payment term are entered in the draft and
    // frozen at finalization. The service day is a fixed past day, so the
    // assertion does not depend on the calendar of the run.
    await invoices
      .getByRole('button', { name: 'Rechnung Entwurf bearbeiten' })
      .click();
    const invoiceEditor = invoices.locator('.offer-draft-editor');
    await expect(
      invoiceEditor.getByRole('heading', { name: 'Rechnung bearbeiten' }),
    ).toBeVisible();
    await invoiceEditor.getByLabel(/Leistungsdatum/).fill('2020-02-29');
    await invoiceEditor.getByLabel(/Zahlungsziel in Tagen/).fill('14');
    // RG-07b: the account is free text and printed word for word, so this run
    // types two lines and expects both on the paper and on screen.
    await invoiceEditor
      .getByLabel(/Bankverbindung/)
      .fill('Fiktive Bank\nIBAN DE00 0000 0000 0000 0000 00');
    await invoiceEditor
      .getByRole('button', { name: 'Änderungen speichern' })
      .click();
    await expect(
      invoiceEditor.getByText('Änderungen gespeichert.'),
    ).toBeVisible();
    // The draft knows the agreed term but no due day: it is not printed yet.
    const draftDates = invoices.locator('.document-invoice-dates');
    await expect(draftDates).toContainText('Leistungsdatum 29.02.2020');
    await expect(draftDates).toContainText('Zahlungsziel 14 Tage');
    await expect(draftDates).not.toContainText('fällig');
    // The account is already on the row, with its line break kept.
    const draftBank = invoices.locator('.document-invoice-bank');
    await expect(draftBank).toContainText('Fiktive Bank');
    await expect(draftBank).toContainText('IBAN DE00 0000 0000 0000 0000 00');
    await invoiceEditor
      .getByRole('button', { name: 'Bearbeitung schließen' })
      .click();
    // Finalizing uses the invoice's own number range.
    await invoices
      .getByRole('button', { name: 'Rechnung Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als RE-/)).toBeVisible();
    const invoiceNumber = (
      await pool.query<{ number: string }>(
        'SELECT number FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, invoice.id],
      )
    ).rows[0]!.number;
    expect(invoiceNumber).toMatch(/^RE-\d{4}-\d{4}$/);
    await expect(
      invoices.getByText(invoiceNumber, { exact: true }),
    ).toBeVisible();
    await expect(
      invoices.getByRole('link', {
        name: 'Rechnung ' + invoiceNumber + ' als PDF öffnen',
      }),
    ).toBeVisible();
    const invoicePdf = await page.request.get(
      origin + '/api/v1/documents/' + invoice.id + '/pdf',
    );
    expect(invoicePdf.status()).toBe(200);
    expect((await invoicePdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    // RG-07: the two dates survive the finalization, and the due day is the
    // invoice day in the tenant calendar plus the agreed term - once, frozen.
    const invoiceDates = (
      await pool.query<{
        issued_at: Date;
        service_date: string;
        payment_term_days: number;
        due_date: string;
        bank_account: string;
      }>(
        `SELECT issued_at, to_char(service_date,'YYYY-MM-DD') AS service_date,
                payment_term_days, to_char(due_date,'YYYY-MM-DD') AS due_date,
                bank_account
           FROM documents WHERE tenant_id=$1 AND id=$2`,
        [config.tenantId, invoice.id],
      )
    ).rows[0]!;
    expect(invoiceDates.service_date).toBe('2020-02-29');
    expect(invoiceDates.payment_term_days).toBe(14);
    // RG-07b: the account is stored exactly as typed, line break included, and
    // finalization neither reformats nor clears it.
    expect(invoiceDates.bank_account).toBe(
      'Fiktive Bank\nIBAN DE00 0000 0000 0000 0000 00',
    );
    const dueDay = addDays(tenantDay(invoiceDates.issued_at), 14);
    expect(invoiceDates.due_date).toBe(dueDay);
    // The printed paper of this very run carries both lines, with the term and
    // the frozen day - and the row names the same day.
    const invoiceHtml = renderedHtml.at(-1)!;
    expect(invoiceHtml).toContain('Leistungsdatum 29.02.2020');
    expect(invoiceHtml).toContain(
      'Zahlungsziel: 14 Tage, fällig ' + germanDay(dueDay),
    );
    // RG-07b: the printed account keeps its line break as a real break - and it
    // stands under the due line it follows.
    expect(invoiceHtml).toContain(
      'Bankverbindung: Fiktive Bank<br>IBAN DE00 0000 0000 0000 0000 00',
    );
    expect(invoiceHtml.indexOf('Zahlungsziel:')).toBeLessThan(
      invoiceHtml.indexOf('Bankverbindung:'),
    );
    const finalDates = invoices.locator('.document-invoice-dates');
    await expect(finalDates).toContainText('Leistungsdatum 29.02.2020');
    await expect(finalDates).toContainText(
      'Zahlungsziel 14 Tage, fällig ' + germanDay(dueDay),
    );
    // The confirmation it was copied from keeps its number and its bytes.
    expect(
      (
        await (
          await page.request.get(
            origin + '/api/v1/documents/' + confirmation.id + '/pdf',
          )
        ).body()
      ).equals(confirmationPdfBytes),
    ).toBe(true);
    // The offer keeps its own bytes and its own number.
    const offerPdfAfterConfirmation = await pdfOf();
    expect((await offerPdfAfterConfirmation.body()).equals(firstBytes)).toBe(
      true,
    );
    // RG-07: neither the confirmation nor the offer prints a date line, so the
    // two invoice lines cannot have changed their bytes or their hashes.
    const confirmationHtml = renderedHtml.filter((html) =>
      html.includes(confirmedNumber),
    );
    expect(confirmationHtml.length).toBeGreaterThan(0);
    for (const html of confirmationHtml) {
      expect(html).not.toContain('Leistungsdatum');
      expect(html).not.toContain('Zahlungsziel');
      // RG-07b: and no account line either - a confirmation prints none.
      expect(html).not.toContain('Bankverbindung');
    }
    await audit('event-auftragsbestaetigung');
    // BKP019.c2: the finalized invoice becomes a credit note of its own. The
    // correction owns the correction number range and the direction; the invoice
    // keeps its number, its state and its bytes, and its cancellation state is
    // derived from the credit notes instead of being stored on it.
    await pool.query(
      `INSERT INTO document_number_sequences
        (tenant_id,kind,pattern,min_length,next_value,version)
       VALUES ($1,'correction','KO-{YYYY}-{SEQ}',4,1,1)`,
      [config.tenantId],
    );
    const invoicePdfBytes = await (
      await page.request.get(
        origin + '/api/v1/documents/' + invoice.id + '/pdf',
      )
    ).body();
    await invoices
      .getByRole('button', {
        name: 'Rechnung ' + invoiceNumber + ' korrigieren',
      })
      .click();
    const correctionForm = invoices.getByRole('form', {
      name: 'Rechnungskorrektur anlegen',
    });
    await expect(correctionForm).toBeVisible();
    // The derived state and the open amount are visible before the write.
    await expect(invoices.getByText('Nicht storniert')).toBeVisible();
    await expect(
      invoices.getByText(/Noch kreditierbar: 100,00 €/),
    ).toBeVisible();
    await expect(correctionForm.getByLabel('Richtung')).toHaveValue('credit');
    await correctionForm.getByLabel('Richtung').selectOption('credit');
    await correctionForm
      .getByRole('button', { name: 'Korrektur anlegen' })
      .click();
    await expect(
      page.getByText('Rechnungskorrektur als Entwurf angelegt.'),
    ).toBeVisible();
    const corrections = page.getByRole('region', {
      name: 'Rechnungskorrekturen',
    });
    await expect(corrections.getByRole('listitem')).toHaveCount(1);
    // The correction names the invoice it corrects, as a real link.
    await expect(
      corrections.getByRole('link', {
        name: 'Beleg ' + invoiceNumber + ' als PDF öffnen',
      }),
    ).toHaveAttribute('href', '/api/v1/documents/' + invoice.id + '/pdf');
    const correction = (
      await pool.query<{
        id: string;
        number: string | null;
        correction_direction: string;
        source_document_id: string;
        gross_minor: string;
        state: string;
      }>(
        `SELECT id, number, correction_direction, source_document_id, gross_minor, state
           FROM documents WHERE tenant_id=$1 AND kind='correction'`,
        [config.tenantId],
      )
    ).rows[0]!;
    // Stored as a magnitude with a direction, never as a negative amount.
    expect(correction.correction_direction).toBe('credit');
    expect(correction.source_document_id).toBe(invoice.id);
    expect(correction.gross_minor).toBe(invoice.gross_minor);
    expect(correction.number).toBeNull();
    // BKP019.c2b: the copied position text is correctable in the UI before it is
    // frozen - a wrong position is not only fixable through the API.
    const editedCorrectionDescription =
      'Fiktive Korrekturposition nach Rücksprache, vor der Finalisierung korrigiert.';
    await corrections
      .getByRole('button', {
        name: 'Rechnungskorrektur Entwurf bearbeiten',
      })
      .click();
    const correctionEditor = corrections.locator('.offer-draft-editor');
    await expect(
      correctionEditor.getByRole('heading', {
        name: 'Rechnungskorrektur bearbeiten',
      }),
    ).toBeVisible();
    // Neither the invoice's nor the offer's heading labels the correction.
    await expect(
      correctionEditor.getByRole('heading', { name: 'Rechnung bearbeiten' }),
    ).toHaveCount(0);
    await expect(
      correctionEditor.getByRole('heading', { name: 'Angebot bearbeiten' }),
    ).toHaveCount(0);
    await expect(correctionEditor.getByLabel('Beschreibung')).toHaveValue(
      'Fictional browser service',
    );
    await correctionEditor
      .getByLabel('Beschreibung')
      .fill(editedCorrectionDescription);
    await correctionEditor
      .getByRole('button', { name: 'Änderungen speichern' })
      .click();
    await expect(
      correctionEditor.getByText('Änderungen gespeichert.'),
    ).toBeVisible();
    // The correction owns the change; its amount stays the invoice's magnitude.
    const editedCorrection = (await (
      await page.request.get(origin + '/api/v1/documents/' + correction.id)
    ).json()) as Detail;
    expect(editedCorrection.lines.map((line) => line.description)).toEqual([
      editedCorrectionDescription,
    ]);
    expect(editedCorrection.subject).toBe('Rechnungskorrektur für {{contact}}');
    await correctionEditor
      .getByRole('button', { name: 'Bearbeitung schließen' })
      .click();
    await expect(correctionEditor).toHaveCount(0);
    // Finalizing uses the correction's own number range.
    await corrections
      .getByRole('button', {
        name: 'Rechnungskorrektur Entwurf finalisieren',
      })
      .click();
    await expect(page.getByText(/Finalisiert als KO-/)).toBeVisible();
    const correctionNumber = (
      await pool.query<{ number: string }>(
        'SELECT number FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, correction.id],
      )
    ).rows[0]!.number;
    expect(correctionNumber).toMatch(/^KO-\d{4}-\d{4}$/);
    await expect(
      corrections.getByText(correctionNumber, { exact: true }),
    ).toBeVisible();
    await expect(
      corrections.getByRole('link', {
        name: 'Rechnungskorrektur ' + correctionNumber + ' als PDF öffnen',
      }),
    ).toBeVisible();
    const correctionPdf = await page.request.get(
      origin + '/api/v1/documents/' + correction.id + '/pdf',
    );
    expect(correctionPdf.status()).toBe(200);
    expect((await correctionPdf.body()).subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    // The frozen correction shows the edited position, not the copied one.
    const frozenCorrection = (await (
      await page.request.get(origin + '/api/v1/documents/' + correction.id)
    ).json()) as Detail & { state: string; pdfHash: string | null };
    expect(frozenCorrection.state).toBe('final');
    expect(frozenCorrection.pdfHash).toBeTruthy();
    expect(frozenCorrection.lines.map((line) => line.description)).toEqual([
      editedCorrectionDescription,
    ]);
    // The invoice it corrects keeps its own position text.
    const invoiceAfterCorrection = (await (
      await page.request.get(origin + '/api/v1/documents/' + invoice.id)
    ).json()) as Detail;
    expect(
      invoiceAfterCorrection.lines.map((line) => line.description),
    ).toEqual(['Fictional browser service']);
    // The full credit reads as "storniert", derived from the credit note.
    await expect(
      invoices.getByText('Storniert', { exact: true }),
    ).toBeVisible();
    await expect(invoices.getByText(/Noch kreditierbar: 0,00 €/)).toBeVisible();
    // The corrected invoice and everything above it keep their bytes.
    expect(
      (
        await (
          await page.request.get(
            origin + '/api/v1/documents/' + invoice.id + '/pdf',
          )
        ).body()
      ).equals(invoicePdfBytes),
    ).toBe(true);
    expect(
      (
        await (
          await page.request.get(
            origin + '/api/v1/documents/' + confirmation.id + '/pdf',
          )
        ).body()
      ).equals(confirmationPdfBytes),
    ).toBe(true);
    expect((await (await pdfOf()).body()).equals(firstBytes)).toBe(true);
    await audit('event-rechnungskorrektur');
    // A second credit is refused by the finalization guard: the draft stays a
    // draft, the invoice keeps its number, and the operator is told why.
    await invoices
      .getByRole('button', {
        name: 'Rechnung ' + invoiceNumber + ' korrigieren',
      })
      .click();
    // The form warns before the write; the guard is still the server's.
    await expect(
      invoices.getByText(/bereits vollständig gutgeschrieben/),
    ).toBeVisible();
    await invoices.getByRole('button', { name: 'Korrektur anlegen' }).click();
    await expect(
      page.getByText('Rechnungskorrektur als Entwurf angelegt.'),
    ).toBeVisible();
    await corrections
      .getByRole('button', {
        name: 'Rechnungskorrektur Entwurf finalisieren',
      })
      .click();
    await expect(
      page.getByText(
        'Die Gutschrift übersteigt den Rechnungsbetrag. Bitte Betrag prüfen.',
      ),
    ).toBeVisible();
    expect(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM documents
            WHERE tenant_id=$1 AND kind='correction' AND state='final'`,
          [config.tenantId],
        )
      ).rows[0]!.count,
    ).toBe(1);
    // BKP019.c3.1: the same finalized confirmation is also billed in advance. The
    // advance owns the AZ number range, names its confirmation and stays its own
    // claim - it is paid and corrected on its own, and the invoice above keeps
    // its state, its number and its bytes.
    await pool.query(
      `INSERT INTO document_number_sequences
        (tenant_id,kind,pattern,min_length,next_value,version)
       VALUES ($1,'deposit_invoice','AZ-{YYYY}-{SEQ}',4,1,1)`,
      [config.tenantId],
    );
    const depositCount = async () =>
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM documents
            WHERE tenant_id=$1 AND kind='deposit_invoice'`,
          [config.tenantId],
        )
      ).rows[0]!.count;
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Anzahlung erstellen',
      })
      .click();
    // The step asks once and writes nothing before the confirmation.
    await expect(
      orders.getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Anzahlung anlegen',
      }),
    ).toBeVisible();
    expect(await depositCount()).toBe(0);
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' Anzahlung anlegen',
      })
      .click();
    await expect(
      page.getByText('Anzahlungsrechnung als Entwurf angelegt.'),
    ).toBeVisible();
    const deposits = page.getByRole('region', {
      name: 'Anzahlungsrechnungen',
    });
    await expect(deposits.getByRole('listitem')).toHaveCount(1);
    // The rule is named, not implied away: the final invoice takes the billed
    // advances over, and until then every advance stays its own open claim.
    await expect(
      deposits.getByText(/Verrechnung übernimmt die Schlussrechnung/),
    ).toBeVisible();
    const deposit = (
      await pool.query<{
        id: string;
        number: string | null;
        source_document_id: string;
        gross_minor: string;
      }>(
        `SELECT id, number, source_document_id, gross_minor::text AS gross_minor
           FROM documents WHERE tenant_id=$1 AND kind='deposit_invoice'`,
        [config.tenantId],
      )
    ).rows[0]!;
    expect(deposit.source_document_id).toBe(confirmation.id);
    expect(deposit.number).toBeNull();
    // The advance copies the order 1:1 - the operator cuts it down in the draft.
    expect(deposit.gross_minor).toBe(confirmation.gross_minor);
    const depositDetail = (await (
      await page.request.get(origin + '/api/v1/documents/' + deposit.id)
    ).json()) as Detail;
    expect(copied(depositDetail.lines)).toEqual(
      copied(confirmationDetail.lines),
    );
    expect(depositDetail.subject).toBe('Anzahlungsrechnung für {{contact}}');
    await expect(
      deposits.locator('.document-meta', {
        hasText: 'Aus Auftragsbestätigung',
      }),
    ).toBeVisible();
    await expect(
      deposits.getByRole('link', {
        name: 'Auftragsbestätigung ' + confirmedNumber + ' als PDF öffnen',
      }),
    ).toHaveAttribute('href', '/api/v1/documents/' + confirmation.id + '/pdf');
    // Its own number circle: the invoice's RE number is never borrowed.
    await deposits
      .getByRole('button', { name: 'Anzahlungsrechnung Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als AZ-/)).toBeVisible();
    const depositNumber = (
      await pool.query<{ number: string }>(
        'SELECT number FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, deposit.id],
      )
    ).rows[0]!.number;
    expect(depositNumber).toMatch(/^AZ-\d{4}-\d{4}$/);
    await expect(
      deposits.getByRole('link', {
        name: 'Anzahlungsrechnung ' + depositNumber + ' als PDF öffnen',
      }),
    ).toBeVisible();
    const depositPdfBytes = await (
      await page.request.get(
        origin + '/api/v1/documents/' + deposit.id + '/pdf',
      )
    ).body();
    expect(depositPdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    // The advance is a claim of its own: it is open until money arrives, and a
    // partial payment changes the derived state and the open amount.
    const depositRow = deposits
      .getByRole('listitem')
      .filter({ hasText: depositNumber });
    await expect(depositRow.getByText('Offen', { exact: true })).toBeVisible();
    await expect(
      depositRow.getByText(/Offener Betrag: 100,00 €/),
    ).toBeVisible();
    await depositRow
      .getByRole('button', {
        name: 'Anzahlungsrechnung ' + depositNumber + ' Zahlung erfassen',
      })
      .click();
    const depositPayment = deposits.getByRole('form', {
      name: 'Zahlung erfassen',
    });
    await expect(depositPayment).toBeVisible();
    await depositPayment.getByLabel('Betrag in €').fill('30,00');
    await depositPayment.getByLabel('Zahlweg').selectOption('bank_transfer');
    await depositPayment
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(page.getByText('Zahlung erfasst.')).toBeVisible();
    await expect(
      depositRow.getByText('Teilweise bezahlt', { exact: true }),
    ).toBeVisible();
    await expect(depositRow.getByText(/Offener Betrag: 70,00 €/)).toBeVisible();
    // Money never rewrites the advance, and it never settles the invoice either.
    expect(
      (
        await (
          await page.request.get(
            origin + '/api/v1/documents/' + deposit.id + '/pdf',
          )
        ).body()
      ).equals(depositPdfBytes),
    ).toBe(true);
    await expect(
      invoices
        .getByRole('listitem')
        .filter({ hasText: invoiceNumber })
        .getByText('Storniert', { exact: true }),
    ).toBeVisible();
    // A wrong advance is correctable: its own correction names the AZ number.
    await deposits
      .getByRole('button', {
        name: 'Anzahlungsrechnung ' + depositNumber + ' korrigieren',
      })
      .click();
    const depositCorrectionForm = deposits.getByRole('form', {
      name: 'Rechnungskorrektur anlegen',
    });
    await expect(depositCorrectionForm).toBeVisible();
    await depositCorrectionForm
      .getByRole('button', { name: 'Korrektur anlegen' })
      .click();
    await expect(
      page.getByText('Rechnungskorrektur als Entwurf angelegt.'),
    ).toBeVisible();
    await expect(
      corrections.getByRole('link', {
        name: 'Beleg ' + depositNumber + ' als PDF öffnen',
      }),
    ).toHaveAttribute('href', '/api/v1/documents/' + deposit.id + '/pdf');
    const depositCorrection = (
      await pool.query<{ id: string; source_document_id: string }>(
        `SELECT id, source_document_id FROM documents
          WHERE tenant_id=$1 AND kind='correction' AND source_document_id=$2`,
        [config.tenantId, deposit.id],
      )
    ).rows[0]!;
    expect(depositCorrection.source_document_id).toBe(deposit.id);
    // The documents above the advance are untouched: same numbers, same bytes.
    expect(
      (
        await (
          await page.request.get(
            origin + '/api/v1/documents/' + confirmation.id + '/pdf',
          )
        ).body()
      ).equals(confirmationPdfBytes),
    ).toBe(true);
    expect(
      (
        await (
          await page.request.get(
            origin + '/api/v1/documents/' + invoice.id + '/pdf',
          )
        ).body()
      ).equals(invoicePdfBytes),
    ).toBe(true);
    await audit('event-anzahlungsrechnung');
    // Withdrawing asks once, and only then writes.
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' zurückziehen',
      })
      .click();
    await expect(
      eventOffers.getByRole('button', {
        name: 'Angebot ' + offer.number + ' Rückzug bestätigen',
      }),
    ).toBeVisible();
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + offer.number + ' Rückzug bestätigen',
      })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Zurückgezogen.'),
    ).toBeVisible();
    await expect(
      eventOffers.getByText('Zurückgezogen', { exact: true }),
    ).toBeVisible();
    // The withdrawal overwrites `status_changed_at`, so the acceptance record
    // must stay readable: same instant, same channel, same note and file.
    await expect(eventOffers.getByText(/Angenommen am/)).toBeVisible();
    await expect(eventOffers.getByText(/Telefon/)).toBeVisible();
    await expect(
      eventOffers.getByText(/Mündliche Zusage, unterschriebene Fassung/),
    ).toBeVisible();
    await expect(
      eventOffers.getByRole('link', { name: /synthetic-signed-offer\.pdf/ }),
    ).toBeVisible();
    // A withdrawn offer is terminal: no status action and still its PDF.
    await expect(
      eventOffers.getByRole('button', {
        name: /versendet markieren|annehmen$|zurückziehen$/,
      }),
    ).toHaveCount(0);
    await expect(
      eventOffers.getByRole('link', {
        name: 'Angebot ' + offer.number + ' als PDF öffnen',
      }),
    ).toBeVisible();
    // Every status change kept the same bytes and the same deadline.
    const secondPdf = await pdfOf();
    expect(secondPdf.status()).toBe(200);
    expect((await secondPdf.body()).equals(firstBytes)).toBe(true);
    const after = (
      await pool.query<{
        state: string;
        offer_status: string;
        valid_until: string;
        number: string;
      }>(
        `SELECT state, offer_status, to_char(valid_until,'DD.MM.YYYY') AS valid_until, number
           FROM documents WHERE tenant_id=$1 AND id=$2`,
        [config.tenantId, offer.id],
      )
    ).rows[0]!;
    expect(after).toEqual({
      state: 'final',
      offer_status: 'withdrawn',
      valid_until: offer.valid_until,
      number: offer.number,
    });
    // BKP019.d: incoming payments are recorded against a finalized invoice, and
    // "offen / teilweise bezahlt / bezahlt" is derived only from those records.
    // A second, independent invoice is used because the first one is already
    // fully credited - a paid invoice may no longer be credited at all.
    await eventOffers
      .getByLabel('Vorlage')
      .selectOption({ label: 'Fictional browser offer' });
    await eventOffers.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByText('Entwurf angelegt.')).toBeVisible();
    await eventOffers
      .getByRole('button', { name: 'Angebot Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als AN-/)).toBeVisible();
    const secondOfferNumber = (
      await pool.query<{ number: string }>(
        `SELECT number FROM documents
          WHERE tenant_id=$1 AND event_id=$2 AND kind='offer' AND number IS NOT NULL
          ORDER BY number DESC LIMIT 1`,
        [config.tenantId, offerEventId],
      )
    ).rows[0]!.number;
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + secondOfferNumber + ' versendet markieren',
      })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Versendet.'),
    ).toBeVisible();
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + secondOfferNumber + ' annehmen',
      })
      .click();
    const secondAcceptance = eventOffers.getByRole('form', {
      name: 'Annahme erfassen',
    });
    await secondAcceptance.getByLabel('Kanal').selectOption('email');
    await secondAcceptance
      .getByRole('button', { name: 'Annahme speichern' })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Angenommen.'),
    ).toBeVisible();
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + secondOfferNumber + ' Auftragsbestätigung erstellen',
      })
      .click();
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + secondOfferNumber + ' Auftragsbestätigung anlegen',
      })
      .click();
    await expect(
      page.getByText('Auftragsbestätigung als Entwurf angelegt.'),
    ).toBeVisible();
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung Entwurf finalisieren',
      })
      .click();
    await expect(page.getByText(/Finalisiert als AB-/)).toBeVisible();
    const secondConfirmationNumber = (
      await pool.query<{ number: string }>(
        `SELECT number FROM documents
          WHERE tenant_id=$1 AND event_id=$2 AND kind='order_confirmation'
            AND state='final'
          ORDER BY number DESC LIMIT 1`,
        [config.tenantId, offerEventId],
      )
    ).rows[0]!.number;
    await orders
      .getByRole('button', {
        name:
          'Auftragsbestätigung ' +
          secondConfirmationNumber +
          ' Rechnung erstellen',
      })
      .click();
    await orders
      .getByRole('button', {
        name:
          'Auftragsbestätigung ' +
          secondConfirmationNumber +
          ' Rechnung anlegen',
      })
      .click();
    await expect(
      page.getByText('Rechnung als Entwurf angelegt.'),
    ).toBeVisible();
    await invoices
      .getByRole('button', { name: 'Rechnung Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als RE-/)).toBeVisible();
    const secondInvoice = (
      await pool.query<{
        id: string;
        number: string;
        gross_minor: string;
        pdf_hash: string;
      }>(
        `SELECT id, number, gross_minor::text AS gross_minor, pdf_hash
           FROM documents
          WHERE tenant_id=$1 AND event_id=$2 AND kind='invoice' AND state='final'
          ORDER BY number DESC LIMIT 1`,
        [config.tenantId, offerEventId],
      )
    ).rows[0]!;
    const secondInvoiceRow = invoices
      .getByRole('listitem')
      .filter({ hasText: secondInvoice.number });
    // The open claim of a fresh invoice is its own gross, and the state before
    // any payment is "Offen" - not "bezahlt", not "teilweise".
    await expect(
      secondInvoiceRow.getByText('Offen', { exact: true }),
    ).toBeVisible();
    await expect(
      secondInvoiceRow.getByText(/Offener Betrag: 100,00 €/),
    ).toBeVisible();
    // RG-08: a document created today can never be late - it carries no due day
    // at all, so the derived badge is absent.
    await expect(secondInvoiceRow.getByText('Überfällig')).toHaveCount(0);
    // RG-08: the lateness is a comparison against the tenant day, so this test
    // needs a due day that lies before today. The one `due_date` written here is
    // a pure test fixture - no product path writes a due day after finalization,
    // and none is added for this test. The CHECK of 0047 stays satisfied: the row
    // is final and names a term.
    await pool.query(
      `UPDATE documents SET due_date = CURRENT_DATE - 1, payment_term_days = 1
        WHERE tenant_id=$1 AND id=$2`,
      [config.tenantId, secondInvoice.id],
    );
    // A payment is recorded by hand: day, amount, method and an optional note.
    await secondInvoiceRow
      .getByRole('button', {
        name: 'Rechnung ' + secondInvoice.number + ' Zahlung erfassen',
      })
      .click();
    const paymentForm = invoices.getByRole('form', {
      name: 'Zahlung erfassen',
    });
    await expect(paymentForm).toBeVisible();
    await expect(
      paymentForm.getByText(/unveränderlicher Eingang/),
    ).toBeVisible();
    await expect(paymentForm.getByText(/nie aus einem Ausdruck/)).toBeVisible();
    await expect(paymentForm.getByLabel('Zahlungsdatum')).toHaveValue(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    await expect(
      paymentForm.getByText('Noch keine Zahlung erfasst.'),
    ).toBeVisible();
    await paymentForm.getByLabel('Betrag in €').fill('40,00');
    await paymentForm.getByLabel('Zahlweg').selectOption('bank_transfer');
    await paymentForm
      .getByLabel('Notiz (optional)')
      .fill('Synthetische Teilzahlung');
    await paymentForm
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(page.getByText('Zahlung erfasst.')).toBeVisible();
    // A partial payment changes the derived state and the open amount, and the
    // recorded row is listed with its day, amount, method and note.
    await expect(
      secondInvoiceRow.getByText('Teilweise bezahlt', { exact: true }),
    ).toBeVisible();
    await expect(
      secondInvoiceRow.getByText(/Offener Betrag: 60,00 €/),
    ).toBeVisible();
    // RG-08: the due day of the fixture lies before today and 60,00 EUR are still
    // open, so the row is late - as its own badge next to the payment state, not
    // instead of it.
    await expect(
      secondInvoiceRow.getByText('Überfällig', { exact: true }),
    ).toBeVisible();
    const paymentList = paymentForm.getByRole('list', {
      name: 'Erfasste Zahlungen',
    });
    await expect(paymentList.getByText(/40,00 €/)).toBeVisible();
    await expect(paymentList.getByText(/Überweisung/)).toBeVisible();
    await expect(
      paymentList.getByText(/Synthetische Teilzahlung/),
    ).toBeVisible();
    // The rest is paid in cash: the invoice is paid only because two payments
    // were recorded, never because a PDF was printed.
    await paymentForm.getByLabel('Betrag in €').fill('60');
    await paymentForm.getByLabel('Zahlweg').selectOption('cash');
    await paymentForm
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(
      secondInvoiceRow.getByText('Bezahlt', { exact: true }),
    ).toBeVisible();
    await expect(
      secondInvoiceRow.getByText(/Offener Betrag: 0,00 €/),
    ).toBeVisible();
    await expect(paymentList.getByText(/60,00 €/)).toBeVisible();
    await expect(paymentList.getByText(/Bar/)).toBeVisible();
    // Overpaying is refused by the server: no row, no derived state change, the
    // operator sees why, and the typed amount stays for correction.
    await paymentForm.getByLabel('Betrag in €').fill('1,00');
    await paymentForm
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(
      page.getByText(
        'Der Betrag übersteigt den offenen Restbetrag. Bitte Betrag prüfen.',
      ),
    ).toBeVisible();
    await expect(paymentForm.getByLabel('Betrag in €')).toHaveValue('1,00');
    await expect(
      secondInvoiceRow.getByText('Bezahlt', { exact: true }),
    ).toBeVisible();
    const storedPayments = (
      await pool.query<{
        amount_minor: string;
        method: string;
        note: string | null;
        recorded_by: string;
      }>(
        `SELECT amount_minor::text AS amount_minor, method, note, recorded_by
           FROM document_payments
          WHERE tenant_id=$1 AND document_id=$2
          ORDER BY received_on, recorded_at, id`,
        [config.tenantId, secondInvoice.id],
      )
    ).rows;
    expect(storedPayments).toEqual([
      {
        amount_minor: '4000',
        method: 'bank_transfer',
        note: 'Synthetische Teilzahlung',
        recorded_by: expect.any(String),
      },
      {
        amount_minor: '6000',
        method: 'cash',
        note: null,
        recorded_by: expect.any(String),
      },
    ]);
    // Every payment is audited once, and the projection carries the derived
    // axis for the invoice - both are read from the same server.
    expect(
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM audit_events
            WHERE tenant_id=$1 AND action='payment.recorded' AND record_id IN
              (SELECT id FROM document_payments WHERE document_id=$2)`,
          [config.tenantId, secondInvoice.id],
        )
      ).rows[0]!.count,
    ).toBe(2);
    const projectedInvoices = (await (
      await page.request.get(
        origin + '/api/v1/documents?eventId=' + offerEventId + '&include=offer',
      )
    ).json()) as {
      id: string;
      paymentState: string | null;
      openMinor: number | null;
    }[];
    expect(
      projectedInvoices.find((row) => row.id === secondInvoice.id),
    ).toMatchObject({ paymentState: 'paid', openMinor: 0 });
    // Money never rewrites the invoice: same number, same amount, same bytes.
    const invoiceAfterPayments = (
      await pool.query<{
        number: string;
        gross_minor: string;
        pdf_hash: string;
      }>(
        'SELECT number, gross_minor::text AS gross_minor, pdf_hash FROM documents WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, secondInvoice.id],
      )
    ).rows[0]!;
    expect(invoiceAfterPayments).toEqual({
      number: secondInvoice.number,
      gross_minor: secondInvoice.gross_minor,
      pdf_hash: secondInvoice.pdf_hash,
    });
    const paidInvoicePdf = await page.request.get(
      origin + '/api/v1/documents/' + secondInvoice.id + '/pdf',
    );
    expect(paidInvoicePdf.status()).toBe(200);
    // A direct edit or deletion of a payment does not exist: with a valid CSRF
    // token the router itself answers 404, so this is not just a CSRF refusal.
    for (const method of ['PATCH', 'DELETE'] as const) {
      const refused = await page.request.fetch(
        origin + '/api/v1/documents/' + secondInvoice.id + '/payments',
        {
          method,
          headers: { origin, 'x-csrf-token': csrf },
          failOnStatusCode: false,
        },
      );
      expect(refused.status(), method).toBe(404);
    }
    // BKP019.c3.2: the same order is also billed as the *final* invoice, which
    // settles the advances already billed on it. A third chain is used because a
    // confirmation carries exactly one invoice, standard or final.
    await eventOffers
      .getByLabel('Vorlage')
      .selectOption({ label: 'Fictional browser offer' });
    await eventOffers.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByText('Entwurf angelegt.')).toBeVisible();
    await eventOffers
      .getByRole('button', { name: 'Angebot Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als AN-/)).toBeVisible();
    const settlementOfferNumber = (
      await pool.query<{ number: string }>(
        `SELECT number FROM documents
          WHERE tenant_id=$1 AND event_id=$2 AND kind='offer' AND number IS NOT NULL
          ORDER BY number DESC LIMIT 1`,
        [config.tenantId, offerEventId],
      )
    ).rows[0]!.number;
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + settlementOfferNumber + ' versendet markieren',
      })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Versendet.'),
    ).toBeVisible();
    await eventOffers
      .getByRole('button', {
        name: 'Angebot ' + settlementOfferNumber + ' annehmen',
      })
      .click();
    const settlementAcceptance = eventOffers.getByRole('form', {
      name: 'Annahme erfassen',
    });
    await settlementAcceptance.getByLabel('Kanal').selectOption('email');
    await settlementAcceptance
      .getByRole('button', { name: 'Annahme speichern' })
      .click();
    await expect(
      page.getByText('Angebotsstatus aktualisiert: Angenommen.'),
    ).toBeVisible();
    await eventOffers
      .getByRole('button', {
        name:
          'Angebot ' + settlementOfferNumber + ' Auftragsbestätigung erstellen',
      })
      .click();
    await eventOffers
      .getByRole('button', {
        name:
          'Angebot ' + settlementOfferNumber + ' Auftragsbestätigung anlegen',
      })
      .click();
    await expect(
      page.getByText('Auftragsbestätigung als Entwurf angelegt.'),
    ).toBeVisible();
    await orders
      .getByRole('button', {
        name: 'Auftragsbestätigung Entwurf finalisieren',
      })
      .click();
    await expect(page.getByText(/Finalisiert als AB-/)).toBeVisible();
    const settlementConfirmation = (
      await pool.query<{ id: string; number: string }>(
        `SELECT id, number FROM documents
          WHERE tenant_id=$1 AND event_id=$2 AND kind='order_confirmation'
            AND state='final'
          ORDER BY number DESC LIMIT 1`,
        [config.tenantId, offerEventId],
      )
    ).rows[0]!;
    expect(settlementConfirmation.number).toMatch(/^AB-\d{4}-\d{4}$/);
    const payloadOf = async (id: string) =>
        await (
          await page.request.get(origin + '/api/v1/documents/' + id + '/pdf')
        ).body(),
      settlementConfirmationPdf = await payloadOf(settlementConfirmation.id);
    // One advance is created through the UI, reduced to the agreed amount in the
    // shared draft editor - the amount is the operator's decision, not a
    // percentage - and then frozen with its own number.
    const settlementDeposit = async (price: string) => {
      await orders
        .getByRole('button', {
          name:
            'Auftragsbestätigung ' +
            settlementConfirmation.number +
            ' Anzahlung erstellen',
        })
        .click();
      await orders
        .getByRole('button', {
          name:
            'Auftragsbestätigung ' +
            settlementConfirmation.number +
            ' Anzahlung anlegen',
        })
        .click();
      await expect(
        page.getByText('Anzahlungsrechnung als Entwurf angelegt.'),
      ).toBeVisible();
      const draftId = (
        await pool.query<{ id: string }>(
          `SELECT id FROM documents
            WHERE tenant_id=$1 AND kind='deposit_invoice' AND state='draft'
              AND source_document_id=$2
            ORDER BY issued_at DESC LIMIT 1`,
          [config.tenantId, settlementConfirmation.id],
        )
      ).rows[0]!.id;
      await deposits
        .getByRole('button', {
          name: 'Anzahlungsrechnung Entwurf bearbeiten',
        })
        .click();
      const depositEditor = deposits.locator('.offer-draft-editor');
      await expect(
        depositEditor.getByRole('heading', {
          name: 'Anzahlungsrechnung bearbeiten',
        }),
      ).toBeVisible();
      await depositEditor
        .getByLabel('Einzelpreis (Brutto) in Euro')
        .fill(price);
      await depositEditor
        .getByRole('button', { name: 'Änderungen speichern' })
        .click();
      await expect(
        depositEditor.getByText('Änderungen gespeichert.'),
      ).toBeVisible();
      await deposits
        .getByRole('button', {
          name: 'Anzahlungsrechnung Entwurf finalisieren',
        })
        .click();
      await expect(page.getByText(/Finalisiert als AZ-/)).toBeVisible();
      const number = (
        await pool.query<{ number: string }>(
          'SELECT number FROM documents WHERE tenant_id=$1 AND id=$2',
          [config.tenantId, draftId],
        )
      ).rows[0]!.number;
      return { id: draftId, number, pdf: await payloadOf(draftId) };
    };
    const firstAdvance = await settlementDeposit('30,00'),
      secondAdvance = await settlementDeposit('10,00');
    // 20,00 EUR of the first 30,00 EUR advance arrived: the printed block will
    // show 40,00 EUR billed and 20,00 EUR paid.
    await deposits
      .getByRole('listitem')
      .filter({ hasText: firstAdvance.number })
      .getByRole('button', {
        name: 'Anzahlungsrechnung ' + firstAdvance.number + ' Zahlung erfassen',
      })
      .click();
    const advancePayment = deposits.getByRole('form', {
      name: 'Zahlung erfassen',
    });
    await advancePayment.getByLabel('Betrag in €').fill('20,00');
    await advancePayment.getByLabel('Zahlweg').selectOption('bank_transfer');
    await advancePayment
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(page.getByText('Zahlung erfasst.')).toBeVisible();
    // The final invoice is one explicit step, and it writes nothing before the
    // operator confirms it.
    const finalInvoiceCount = async () =>
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM documents
            WHERE tenant_id=$1 AND kind='invoice' AND invoice_role='final'`,
          [config.tenantId],
        )
      ).rows[0]!.count;
    await orders
      .getByRole('button', {
        name:
          'Auftragsbestätigung ' +
          settlementConfirmation.number +
          ' Schlussrechnung erstellen',
      })
      .click();
    await expect(
      orders.getByRole('button', {
        name:
          'Auftragsbestätigung ' +
          settlementConfirmation.number +
          ' Schlussrechnung anlegen',
      }),
    ).toBeVisible();
    expect(await finalInvoiceCount()).toBe(0);
    await orders
      .getByRole('button', {
        name:
          'Auftragsbestätigung ' +
          settlementConfirmation.number +
          ' Schlussrechnung anlegen',
      })
      .click();
    await expect(
      page.getByText('Schlussrechnung als Entwurf angelegt.'),
    ).toBeVisible();
    // The invoice card already lists more than one invoice, so the new row is
    // found by its role instead of by position - the same way an operator reads
    // it, and never by "the last one".
    const settlementRow = invoices
      .getByRole('listitem')
      .filter({ hasText: 'Schlussrechnung' });
    // The role, the source and the rule are visible before the print; the
    // amounts appear only when the deduction is frozen.
    await expect(settlementRow.getByText('Schlussrechnung')).toBeVisible();
    await expect(
      settlementRow.getByText(/Aus Auftragsbestätigung/),
    ).toBeVisible();
    await expect(
      settlementRow.getByText(/werden beim Finalisieren brutto verrechnet/),
    ).toBeVisible();
    await expect(
      settlementRow.getByRole('button', {
        name: 'Schlussrechnung Entwurf finalisieren',
      }),
    ).toBeVisible();
    expect(
      await (
        await page.request.get(
          origin + '/api/v1/documents/' + settlementConfirmation.id + '/pdf',
        )
      ).status(),
    ).toBe(200);
    await settlementRow
      .getByRole('button', { name: 'Schlussrechnung Entwurf finalisieren' })
      .click();
    await expect(page.getByText(/Finalisiert als RE-/)).toBeVisible();
    const settlementInvoice = (
      await pool.query<{
        id: string;
        number: string;
        invoice_role: string;
        deposit_applied_minor: string;
        gross_minor: string;
      }>(
        `SELECT id, number, invoice_role, deposit_applied_minor::text AS deposit_applied_minor,
                gross_minor::text AS gross_minor
           FROM documents
          WHERE tenant_id=$1 AND kind='invoice' AND invoice_role='final'`,
        [config.tenantId],
      )
    ).rows[0]!;
    // The deduction is frozen at finalization, the gross stays the order's own.
    expect(settlementInvoice.invoice_role).toBe('final');
    expect(settlementInvoice.deposit_applied_minor).toBe('4000');
    expect(settlementInvoice.gross_minor).toBe(
      (
        await pool.query<{ gross_minor: string }>(
          'SELECT gross_minor::text AS gross_minor FROM documents WHERE tenant_id=$1 AND id=$2',
          [config.tenantId, settlementConfirmation.id],
        )
      ).rows[0]!.gross_minor,
    );
    // The row now names the frozen deduction and what arrived on the advances.
    await expect(
      settlementRow.getByText(/Anzahlungen verrechnet: 40,00 €/),
    ).toBeVisible();
    await expect(
      settlementRow.getByText(/davon geleistet: 20,00 €/),
    ).toBeVisible();
    // The printed block is the one this run rendered: 40,00 EUR billed advances,
    // 20,00 EUR of them paid, 60,00 EUR to pay.
    const settlementBlock = (
      renderedHtml.at(-1)!.split('Anzahlungen gesamt')[1] ?? ''
    ).split('</table>')[0]!;
    expect(settlementBlock).toContain('40,00 €');
    expect(settlementBlock).toContain('davon geleistet');
    expect(settlementBlock).toContain('20,00 €');
    expect(settlementBlock).toContain('Zu zahlender Betrag');
    expect(settlementBlock).toContain('60,00 €');
    // A partial payment up to the printed remainder, then one cent too much.
    const printedRow = invoices
      .getByRole('listitem')
      .filter({ hasText: settlementInvoice.number });
    await expect(printedRow.getByText('Offen', { exact: true })).toBeVisible();
    await expect(printedRow.getByText(/Offener Betrag: 60,00 €/)).toBeVisible();
    await printedRow
      .getByRole('button', {
        name:
          'Schlussrechnung ' + settlementInvoice.number + ' Zahlung erfassen',
      })
      .click();
    const settlementPayment = invoices.getByRole('form', {
      name: 'Zahlung erfassen',
    });
    await settlementPayment.getByLabel('Betrag in €').fill('30,00');
    await settlementPayment.getByLabel('Zahlweg').selectOption('cash');
    await settlementPayment
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(page.getByText('Zahlung erfasst.')).toBeVisible();
    await expect(
      printedRow.getByText('Teilweise bezahlt', { exact: true }),
    ).toBeVisible();
    await expect(printedRow.getByText(/Offener Betrag: 30,00 €/)).toBeVisible();
    await settlementPayment.getByLabel('Betrag in €').fill('30,01');
    await settlementPayment
      .getByRole('button', { name: 'Zahlung speichern' })
      .click();
    await expect(
      page.getByText(
        'Der Betrag übersteigt den offenen Restbetrag. Bitte Betrag prüfen.',
      ),
    ).toBeVisible();
    await expect(printedRow.getByText(/Offener Betrag: 30,00 €/)).toBeVisible();
    // Nothing above moved: the confirmation and both advances keep their bytes,
    // and the final invoice itself is frozen too.
    expect(
      (await payloadOf(settlementConfirmation.id)).equals(
        settlementConfirmationPdf,
      ),
    ).toBe(true);
    expect((await payloadOf(firstAdvance.id)).equals(firstAdvance.pdf)).toBe(
      true,
    );
    expect((await payloadOf(secondAdvance.id)).equals(secondAdvance.pdf)).toBe(
      true,
    );
    const settlementInvoicePdf = await payloadOf(settlementInvoice.id);
    expect(settlementInvoicePdf.subarray(0, 5).toString()).toBe('%PDF-');
    await audit('event-schlussrechnung');
    // The fixture is removed by hand and in dependency order: the application
    // deliberately has no delete path for money, and the foreign key does not
    // cascade.
    await pool.query(
      `DELETE FROM document_payments WHERE tenant_id=$1 AND document_id IN
        (SELECT id FROM documents WHERE tenant_id=$1 AND event_id=$2)`,
      [config.tenantId, offerEventId],
    );
    // The observer below reports the Dateien list only, so the PDF reads and
    // the three status writes of this step are cleared here.
    pdfRequests.length = 0;
    // Nothing of this step may outlive it: the event is deleted further below.
    await pool.query(
      'DELETE FROM documents WHERE tenant_id=$1 AND event_id=$2',
      [config.tenantId, offerEventId],
    );
    // The acceptance's signed copy goes with it, so the library step below
    // still starts from an empty, honest library.
    await pool.query('DELETE FROM library_files WHERE tenant_id=$1 AND id=$2', [
      config.tenantId,
      signedFile.id,
    ]);
    await pool.query(
      'DELETE FROM event_contacts WHERE tenant_id=$1 AND event_id=$2',
      [config.tenantId, offerEventId],
    );
    await pool.query('DELETE FROM contacts WHERE tenant_id=$1 AND id=$2', [
      config.tenantId,
      offerContactId,
    ]);
    await pool.query(
      'DELETE FROM document_templates WHERE tenant_id=$1 AND id=$2',
      [config.tenantId, offerTemplateId],
    );
    await page.goBack();
    await expect(page).toHaveURL(/status=option/);
    await page.goBack();
    await expect(page).toHaveURL(filesUrlBefore);
    await expect(files.getByText('Angebot · Entwurf')).toBeVisible();
    await expect(files.getByLabel('Dokumentart')).toHaveValue('');
    // The document list never downloaded a PDF on its own.
    expect(pdfRequests).toEqual([]);
    await pool.query(
      "DELETE FROM event_contacts WHERE tenant_id=$1::uuid AND event_id='33333333-3333-4333-8333-333333333333'",
      [config.tenantId],
    );
    await pool.query(
      "DELETE FROM events WHERE tenant_id=$1::uuid AND id='33333333-3333-4333-8333-333333333333'",
      [config.tenantId],
    );
    // BKP020.1: uploading, downloading and archiving a synthetic library file.
    // The library is its own named region beside the document index, with its
    // own heading and endpoint.
    const library = page.getByRole('region', { name: 'Dateibibliothek' });
    await expect(library).toBeVisible();
    await expect(
      library.getByRole('heading', { level: 2, name: 'Dateibibliothek' }),
    ).toBeVisible();
    await expect(
      library.getByText(/nicht auf Schadsoftware geprüft/),
    ).toBeVisible();
    await expect(
      library.getByText('Noch keine Dateien hochgeladen.'),
    ).toBeVisible();
    const syntheticPdf = Buffer.from(
      '%PDF-1.4 synthetic library invoice\n%%EOF\n',
      'latin1',
    );
    await library.getByLabel('Datei auswählen').setInputFiles({
      name: 'synthetic-invoice.pdf',
      mimeType: 'application/pdf',
      buffer: syntheticPdf,
    });
    await library.getByRole('button', { name: 'Hochladen' }).click();
    await expect(library.getByText(/wurde hochgeladen/)).toBeVisible();
    const libraryRow = library.getByRole('row', {
      name: /synthetic-invoice\.pdf/,
    });
    await expect(libraryRow).toContainText('PDF');
    await expect(libraryRow).toContainText('Verfügbar');
    await expect(libraryRow).toContainText('Unverprüft');
    const downloadLink = library.getByRole('link', {
      name: 'Herunterladen: synthetic-invoice.pdf',
    });
    await downloadLink.focus();
    expect(
      await downloadLink.evaluate(
        (element) => element === document.activeElement,
      ),
    ).toBe(true);
    const downloadEvent = page.waitForEvent('download');
    await downloadLink.click();
    const libraryDownload = await downloadEvent;
    expect(libraryDownload.suggestedFilename()).toBe('synthetic-invoice.pdf');
    expect(
      (await readFile((await libraryDownload.path())!)).equals(syntheticPdf),
    ).toBe(true);
    await library
      .getByRole('button', { name: 'Archivieren: synthetic-invoice.pdf' })
      .click();
    await expect(
      library.getByRole('group', {
        name: 'Datei synthetic-invoice.pdf archivieren?',
      }),
    ).toBeVisible();
    await library
      .getByRole('button', { name: 'Archivieren bestätigen' })
      .click();
    await expect(library.getByText(/wurde archiviert/)).toBeVisible();
    await expect(libraryRow).toContainText('Archiviert');
    await expect(
      library.getByRole('link', { name: /Herunterladen/ }),
    ).toHaveCount(0);
    for (const [width, height, theme] of [
      [320, 740, 'light'],
      [1440, 900, 'dark'],
    ] as const) {
      await page.setViewportSize({ width, height });
      const toggle = page.getByRole('button', { name: /modus aktivieren/ });
      if (
        (await toggle.getAttribute('aria-pressed')) !== String(theme === 'dark')
      )
        await toggle.click();
      await audit(`dateibibliothek-${width}-${theme}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const libraryThemeToggle = page.getByRole('button', {
      name: /modus aktivieren/,
    });
    if ((await libraryThemeToggle.getAttribute('aria-pressed')) === 'true')
      await libraryThemeToggle.click();
    await navigate('Einstellungen', 'Konto & Zugriff');
    if (mode === 'google') {
      await page
        .getByLabel('Google-E-Mail-Adresse')
        .fill('pending-browser@example.invalid');
      await page.getByRole('button', { name: 'Konto freigeben' }).click();
      await expect(
        page.getByText(
          'pending-browser@example.invalid – Erste Anmeldung ausstehend',
        ),
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: 'Sperren: synthetic@example.invalid',
          exact: true,
        })
        .click();
      await expect(
        page.getByText(
          'Der letzte aktive Administrator darf nicht gesperrt werden.',
        ),
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: 'Sperren: pending-browser@example.invalid',
          exact: true,
        })
        .click();
      await expect(
        page.getByText('pending-browser@example.invalid – Gesperrt'),
      ).toBeVisible();
    } else await expect(page.getByText(/Weitere Passwortkonten/)).toBeVisible();
    await navigate('Einstellungen', 'Datenimport');
    const importPreview = page.getByRole('region', {
      name: 'Bookitup-Importvorschau',
    });
    const invalidImport = fictionalImport();
    invalidImport.contacts[0]!.data.phone = 'Fictional invalid phone';
    await importPreview
      .getByLabel('Normalisierte Importdaten')
      .fill(JSON.stringify(invalidImport));
    await importPreview
      .getByRole('button', { name: 'Importvorschau prüfen' })
      .click();
    await expect(
      importPreview.getByText(/Kontakte · Zeile 1 · Telefonnummer:/),
    ).toBeVisible();
    if (mode === 'password') {
      for (const [width, theme] of [
        [1280, 'light'],
        [390, 'light'],
        [390, 'dark'],
        [1280, 'dark'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await audit(`import-field-${width}-${theme}`);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `tests/test-results/import-field-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
    }
    await importPreview
      .getByLabel('Normalisierte Importdaten')
      .fill(JSON.stringify(fictionalImport()));
    await importPreview
      .getByRole('button', { name: 'Importvorschau prüfen' })
      .click();
    await expect(
      importPreview.getByText(
        'Vorschau geprüft. Es wurden keine Daten übernommen.',
      ),
    ).toBeVisible();
    await expect(
      importPreview.getByText('Ungeprüfte Bestandszusage', { exact: true }),
    ).toBeVisible();
    expect(
      (await pool.query('SELECT count(*) FROM events')).rows[0].count,
    ).toBe('0');
    await importPreview.screenshot({
      path: 'tests/test-results/import-preview.png',
    });
    await navigate('Einstellungen', 'Stammdaten');
    const packages = page.getByRole('region', { name: 'Paketwerte' });
    await packages
      .getByLabel('Bezeichnung', { exact: true })
      .fill('Synthetic browser package');
    await packages
      .getByRole('button', { name: 'Speichern', exact: true })
      .click();
    await packages
      .getByRole('button', {
        name: 'Bearbeiten: Synthetic browser package',
        exact: true,
      })
      .click();
    await packages
      .getByLabel('Zustand', { exact: true })
      .selectOption('archived');
    await packages
      .getByRole('button', { name: 'Speichern', exact: true })
      .click();
    await expect(
      packages.getByText('Synthetic browser package – Archiviert'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Auftragsstatus' })
        .getByText('Gebucht', { exact: true }),
    ).toBeVisible();
    const reasons = page.getByRole('region', { name: 'Absagegründe' });
    await reasons
      .getByRole('button', { name: 'Bearbeiten: Termin belegt', exact: true })
      .click();
    await reasons
      .getByLabel('Zustand', { exact: true })
      .selectOption('archived');
    await reasons
      .getByRole('button', { name: 'Speichern', exact: true })
      .click();
    await expect(reasons.getByText('Termin belegt – Archiviert')).toBeVisible();
    await navigate('Einstellungen', 'Ressourcen');
    const settingsNavigation = page.getByRole('navigation', {
      name: 'Einstellungen',
      exact: true,
    });
    const settingsSelect = settingsNavigation.locator(
      'select[aria-label="Einstellungsbereich"]',
    );
    await expect(settingsSelect).toBeHidden();
    await expect(
      settingsNavigation.getByRole('link', {
        name: 'Ressourcen',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Ressourcen', exact: true }),
    ).toHaveCount(0);
    const resources = page.getByRole('region', {
      name: 'Ressourcen',
      exact: true,
    });
    await resources
      .getByRole('button', { name: 'Ressource bearbeiten: FB1', exact: true })
      .click();
    await resources.getByLabel('Gesperrt', { exact: true }).check();
    await resources
      .getByRole('button', { name: 'Ressource speichern' })
      .click();
    await expect(
      resources.getByRole('listitem').filter({ hasText: /^FB1 –/ }),
    ).toContainText('FB1 – 1 Stück – Fotobox – Aktiv – Gesperrt');
    const blocks = resources.getByRole('region', {
      name: 'Zeitweise Ressourcensperren',
    });
    // BKP009.2: the maintenance management is a deliberate disclosure. Its
    // form, its list and its primary action are only mounted once it is
    // opened; the area itself, its heading and its refresh control stay.
    const blocksSummary = blocks.locator('summary');
    const blocksDetails = blocks.locator('details');
    await expect(blocksSummary).toHaveText('Sperrverwaltung öffnen');
    await expect(blocksDetails).toHaveJSProperty('open', false);
    await expect(blocks.getByLabel('Sperrgrund')).toHaveCount(0);
    await expect(
      blocks.getByRole('button', { name: 'Zeitraum sperren', exact: true }),
    ).toHaveCount(0);
    // Keyboard: the native summary is reachable and opens on Enter and Space;
    // Escape never closes a disclosure.
    await blocksSummary.focus();
    await page.keyboard.press('Escape');
    await expect(blocksDetails).toHaveJSProperty('open', false);
    await page.keyboard.press('Enter');
    await expect(blocksDetails).toHaveJSProperty('open', true);
    await expect(blocksSummary).toHaveText('Sperrverwaltung schließen');
    await page.keyboard.press('Space');
    await expect(blocksDetails).toHaveJSProperty('open', false);
    await page.keyboard.press('Space');
    await expect(blocksDetails).toHaveJSProperty('open', true);
    // The route scan above only saw the closed state, so the opened management
    // gets its own full scan (including best-practice rules).
    await audit('EinstellungenRessourcenSperren');
    await blocks
      .getByRole('combobox', { name: 'Zu sperrende Einheit', exact: true })
      .selectOption({ label: 'FB2 · Einheit 1 (FB2)' });
    await blocks.getByLabel('Sperrgrund').fill('Fictional browser maintenance');
    await blocks
      .getByLabel('Sperrbeginn', { exact: true })
      .fill('2030-11-10T10:00');
    await blocks
      .getByLabel('Sperrende', { exact: true })
      .fill('2030-11-11T18:00');
    // H040: the block form takes local times only; no offset fields remain.
    await expect(blocks.getByText(/UTC-Versatz/)).toHaveCount(0);
    await blocks
      .getByRole('button', { name: 'Zeitraum sperren', exact: true })
      .click();
    await expect(
      blocks.getByText('Zeitraum gesperrt.', { exact: true }),
    ).toBeVisible();
    await blocks
      .getByRole('button', {
        name: 'Sperre freigeben: Fictional browser maintenance',
      })
      .click();
    await expect(
      blocks.getByText(/Fictional browser maintenance.*Freigegeben/),
    ).toBeVisible();
    // BKP009 acceptance: 320, 390, 768 and 1280px in both themes. Neither the
    // resource section, the document, nor the settings navigation may overflow
    // horizontally. The settings sub-navigation collapses into its select at
    // the 900px breakpoint, so the compact assertions stay on the narrow
    // widths and the desktop links are checked on 1280px.
    const themeToggle = page.getByRole('button', { name: /modus aktivieren/ });
    // BKP009.2: the whole matrix runs in both disclosure states. The opened
    // management must not overflow either, and the closed one is the state the
    // page loads in.
    const layoutMatrix = async (state: 'open' | 'closed') => {
      for (const [width, theme] of [
        [320, 'light'],
        [320, 'dark'],
        [390, 'light'],
        [390, 'dark'],
        [768, 'light'],
        [768, 'dark'],
        [1280, 'light'],
        [1280, 'dark'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        if (
          (await themeToggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await themeToggle.click();
        await expect(themeToggle).toHaveAttribute(
          'aria-pressed',
          String(theme === 'dark'),
        );
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(
          await resources.evaluate(
            (section) => section.scrollWidth <= section.clientWidth + 1,
          ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        expect(
          await settingsNavigation.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
        if (width > 900) {
          await expect(settingsSelect).toBeHidden();
          await expect(
            settingsNavigation.getByRole('link', {
              name: 'Ressourcen',
              exact: true,
            }),
          ).toHaveAttribute('aria-current', 'page');
        } else {
          await expect(settingsSelect).toBeVisible();
          await expect(
            settingsNavigation.getByRole('combobox', {
              name: 'Einstellungsbereich',
              exact: true,
            }),
          ).toBeVisible();
          await expect(settingsSelect).toHaveValue('#settings-resources');
          await expect(
            settingsNavigation.getByRole('link', {
              name: 'Ressourcen',
              exact: true,
            }),
          ).toHaveCount(0);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path:
            state === 'open'
              ? `tests/test-results/resource-${width}-${theme}.png`
              : `tests/test-results/resource-blocks-closed-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    };
    await layoutMatrix('open');
    // Closing asks nothing here: the save reset the draft. The closed matrix
    // proves the deliberate opening is not what keeps the page from overflowing.
    await blocksSummary.click();
    await expect(blocksDetails).toHaveJSProperty('open', false);
    await layoutMatrix('closed');
    // Leave the run in the light theme the rest of the scenario asserts in.
    if ((await themeToggle.getAttribute('aria-pressed')) !== 'false')
      await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Reopen it: the hash switch below must keep the panel and its state.
    await blocksSummary.click();
    await expect(blocksDetails).toHaveJSProperty('open', true);
    await page.setViewportSize({ width: 1280, height: 720 });
    const resourcesTimeOrigin = await page.evaluate(
      () => performance.timeOrigin,
    );
    await page.evaluate(() => {
      window.location.hash = 'resources';
    });
    await expect(page).toHaveURL(/#resources$/);
    await expect(resources).toBeVisible();
    await expect(settingsSelect).toHaveValue('#settings-resources');
    await expect(
      settingsNavigation.getByRole('link', {
        name: 'Ressourcen',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      resourcesTimeOrigin,
    );
    // The disclosure survived the hash switch: no remount, no reload.
    await expect(blocksDetails).toHaveJSProperty('open', true);
    await expect(blocksSummary).toHaveText('Sperrverwaltung schließen');
    // Leave the page in its default state for the steps below.
    await blocksSummary.click();
    await expect(blocksDetails).toHaveJSProperty('open', false);
    await navigate('Einstellungen', 'Produkte');
    await expect(
      settingsNavigation.getByRole('link', {
        name: 'Produkte',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Produkte', exact: true }),
    ).toHaveCount(0);
    const products = page.getByRole('region', { name: 'Produkte' });
    await expect(
      products.getByRole('heading', {
        level: 2,
        name: 'Produkte',
        exact: true,
      }),
    ).toHaveCount(1);
    // BKP010.1: the product page leads with its list; its editor is a dialog
    // that is mounted on demand, so no form field sits in the tab path.
    await expect(
      products.getByLabel('Produktname', { exact: true }),
    ).toHaveCount(0);
    const productCreate = products.getByRole('button', {
      name: 'Produkt anlegen',
    });
    await expect(productCreate).toHaveAttribute('title', 'Produkt anlegen');
    await productCreate.click();
    const productDialog = products.getByRole('dialog', {
      name: 'Produkt anlegen',
    });
    await expect(productDialog).toBeVisible();
    await expect(
      products.getByLabel('Produktname', { exact: true }),
    ).toBeFocused();
    await products
      .getByLabel('Produktname', { exact: true })
      .fill('Synthetic browser product');
    await products.getByLabel('Preis in Euro').fill('19,99');
    await products.getByRole('button', { name: 'Produkt speichern' }).click();
    await expect(productDialog).toBeHidden();
    await expect(
      products.getByText(
        'Synthetic browser product – 19,99 € Brutto – 19 % – Stück – Aktiv',
        { exact: true },
      ),
    ).toBeVisible();
    // The compact toolbar narrows the list client-side; it never refetches.
    const productSearch = products.getByLabel('Produkte suchen');
    await productSearch.fill('no-such-synthetic-product');
    await expect(
      products.getByText('Keine Treffer für die aktuellen Filter.'),
    ).toBeVisible();
    await products.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await products.getByLabel('Zustand filtern').selectOption('archived');
    await expect(products.getByText(/Synthetic browser product/)).toHaveCount(
      0,
    );
    await products.getByLabel('Zustand filtern').selectOption('');
    await expect(products.getByText(/Synthetic browser product/)).toBeVisible();
    // BKP010.2: duplicating and archiving stay behind the row's named
    // disclosure. Escape closes it and returns focus to its trigger.
    const productActions = products.getByRole('button', {
      name: 'Weitere Aktionen für Synthetic browser product',
    });
    await expect(productActions).toHaveAttribute('aria-expanded', 'false');
    await expect(
      products.getByRole('button', {
        name: 'Produkt duplizieren: Synthetic browser product',
      }),
    ).toHaveCount(0);
    await productActions.click();
    await expect(productActions).toHaveAttribute('aria-expanded', 'true');
    await expect(
      products.getByRole('button', {
        name: 'Produkt archivieren: Synthetic browser product',
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(productActions).toHaveAttribute('aria-expanded', 'false');
    await expect(productActions).toBeFocused();
    // BKP010 acceptance: 320, 390 and 1280px in both themes. Neither the
    // product section, its toolbar nor the document may overflow
    // horizontally.
    for (const [width, theme] of [
      [320, 'light'],
      [320, 'dark'],
      [390, 'light'],
      [390, 'dark'],
      [1280, 'light'],
      [1280, 'dark'],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      if (
        (await themeToggle.getAttribute('aria-pressed')) !==
        String(theme === 'dark')
      )
        await themeToggle.click();
      await expect(themeToggle).toHaveAttribute(
        'aria-pressed',
        String(theme === 'dark'),
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await products.evaluate(
          (section) => section.scrollWidth <= section.clientWidth + 1,
        ),
      ).toBe(true);
      expect(
        await products
          .locator('.product-toolbar')
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await settingsNavigation.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      if (width <= 900) {
        await expect(settingsSelect).toBeVisible();
        await expect(settingsSelect).toHaveValue('#settings-products');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `tests/test-results/product-${width}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    // The editor fits the narrowest viewport as well; it is untouched, so
    // Escape closes it without a discard prompt.
    await page.setViewportSize({ width: 320, height: 844 });
    await productCreate.click();
    await expect(productDialog).toBeVisible();
    const mobileProductDialog = (await productDialog.boundingBox())!;
    expect(mobileProductDialog.x).toBeGreaterThanOrEqual(0);
    expect(
      mobileProductDialog.x + mobileProductDialog.width,
    ).toBeLessThanOrEqual(320);
    expect(
      await productDialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(productDialog).toBeHidden();
    // Leave the run in the light theme the rest of the scenario asserts in.
    if ((await themeToggle.getAttribute('aria-pressed')) !== 'false')
      await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.setViewportSize({ width: 1280, height: 720 });
    const productsTimeOrigin = await page.evaluate(
      () => performance.timeOrigin,
    );
    await page.evaluate(() => {
      window.location.hash = 'products';
    });
    await expect(page).toHaveURL(/#products$/);
    await expect(products).toBeVisible();
    await expect(settingsSelect).toHaveValue('#settings-products');
    await expect(
      settingsNavigation.getByRole('link', {
        name: 'Produkte',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      productsTimeOrigin,
    );

    // Keyboard activation and focus of the settings sub-navigation.
    await settingsNavigation
      .getByRole('link', { name: 'Stammdaten', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings$/);
    const resourceLink = settingsNavigation.getByRole('link', {
      name: 'Ressourcen',
      exact: true,
    });
    await resourceLink.focus();
    await expect(resourceLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#settings-resources$/);
    await expect(resourceLink).toBeFocused();
    await expect(resources).toBeVisible();

    // Back and Forward across canonical and legacy hashes keep query, drafts
    // and the single mounted panels.
    const historyTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    const queryBeforeHistory = await page.evaluate(() => location.search);
    let productApiRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/products')
        productApiRequests += 1;
    });
    await settingsNavigation
      .getByRole('link', { name: 'Produkte', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings-products$/);
    // BKP010.1: the product editor is mounted on demand. Open the row's
    // dialog so the draft below is typed into a real form field.
    await products
      .getByRole('button', {
        name: 'Produkt bearbeiten: Synthetic browser product',
        exact: true,
      })
      .click();
    await expect(
      products.getByRole('dialog', { name: 'Produkt bearbeiten' }),
    ).toBeVisible();
    await products
      .getByLabel('Produktname', { exact: true })
      .fill('Synthetic draft product');
    // The open dialog covers the sub-navigation, so the hash switch is made
    // the way the browser makes it.
    await page.evaluate(() => {
      window.location.hash = 'settings-resources';
    });
    await expect(page).toHaveURL(/#settings-resources$/);
    // BKP009: the resource editor is mounted on demand. Open the row's dialog
    // so the draft below is typed into a real form field.
    await resources
      .getByRole('button', { name: 'Ressource bearbeiten: FB1', exact: true })
      .click();
    await expect(
      resources.getByRole('dialog', { name: 'Ressource bearbeiten' }),
    ).toBeVisible();
    await resources
      .getByLabel('Bezeichnung', { exact: true })
      .fill('Synthetic draft box');
    await page.evaluate(() => {
      window.location.hash = 'resources';
    });
    await expect(page).toHaveURL(/#resources$/);
    await expect(
      resources.getByLabel('Bezeichnung', { exact: true }),
    ).toHaveValue('Synthetic draft box');
    await page.goBack();
    await expect(page).toHaveURL(/#settings-resources$/);
    await expect(
      resources.getByLabel('Bezeichnung', { exact: true }),
    ).toHaveValue('Synthetic draft box');
    await page.goForward();
    await expect(page).toHaveURL(/#resources$/);
    await expect(
      resources.getByLabel('Bezeichnung', { exact: true }),
    ).toHaveValue('Synthetic draft box');
    // The dialog is still open and dirty, so it must be dismissed through its
    // documented discard prompt before the sub-navigation is clickable again.
    page.once('dialog', (prompt) => void prompt.accept());
    await resources
      .getByRole('button', { name: 'Ressource abbrechen', exact: true })
      .click();
    await expect(
      resources.getByRole('dialog', { name: 'Ressource bearbeiten' }),
    ).toBeHidden();
    await page.goBack();
    await settingsNavigation
      .getByRole('link', { name: 'Produkte', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings-products$/);
    await expect(
      products.getByLabel('Produktname', { exact: true }),
    ).toHaveValue('Synthetic draft product');
    expect(productApiRequests).toBe(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      historyTimeOrigin,
    );
    expect(await page.evaluate(() => location.search)).toBe(queryBeforeHistory);
    // The product dialog is still open and dirty; dismiss it through its
    // documented discard prompt so the mobile drawer below is reachable.
    page.once('dialog', (prompt) => void prompt.accept());
    await products
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
    await expect(
      products.getByRole('dialog', { name: 'Produkt bearbeiten' }),
    ).toBeHidden();
    expect(productApiRequests).toBe(0);

    // The same sub-navigation is keyboard reachable from the mobile drawer.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Menü öffnen' }).click();
    const mobileDrawer = page.getByRole('dialog', {
      name: 'Menü',
      exact: true,
    });
    await expect(
      mobileDrawer.getByRole('link', { name: 'Ressourcen', exact: true }),
    ).toHaveCount(0);
    await mobileDrawer
      .getByRole('link', { name: 'Einstellungen', exact: true })
      .click();
    await expect(mobileDrawer).toBeHidden();
    await expect(settingsSelect).toBeVisible();
    await expect(page).toHaveURL(/#settings$/);
    await expect(settingsSelect).toHaveValue('#settings');
    await expect(
      settingsNavigation.getByRole('link', {
        name: 'Produkte',
        exact: true,
      }),
    ).toHaveCount(0);
    await settingsSelect.focus();
    await expect(settingsSelect).toBeFocused();
    // Local macOS headless Chromium does not expose the native popup to arrow
    // keys; use the native option typeahead for a real keyboard selection.
    await page.keyboard.press('r');
    await expect(page).toHaveURL(/#settings-resources$/);
    await expect(settingsSelect).toHaveValue('#settings-resources');
    await expect(resources).toBeVisible();
    await expect(settingsSelect).toBeFocused();
    await settingsSelect.selectOption('#settings-products');
    await expect(page).toHaveURL(/#settings-products$/);
    await expect(settingsSelect).toHaveValue('#settings-products');
    await expect(products).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#settings-resources$/);
    await expect(settingsSelect).toHaveValue('#settings-resources');
    await page.goForward();
    await expect(page).toHaveURL(/#settings-products$/);
    await expect(settingsSelect).toHaveValue('#settings-products');
    await expect(settingsSelect).toBeFocused();
    await expect(products).toBeVisible();
    expect(await page.evaluate(() => location.search)).toBe(queryBeforeHistory);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await settingsNavigation.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await navigate('Kontakte');
    const contacts = page.getByRole('region', { name: 'Kontakte' });
    await expect(contacts.locator('ul.contact-list')).toBeAttached();
    expect(
      await contacts.evaluate((section) => {
        const form = section.querySelector('.contact-toolbar form');
        const list = section.querySelector('ul.contact-list');
        return Boolean(
          form &&
          list &&
          form.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    await expect(contacts.getByLabel('Name / Firma')).toHaveCount(0);
    const contactCreate = contacts.getByRole('button', {
      name: 'Kontakt anlegen',
    });
    await expect(contactCreate).toHaveAttribute('title', 'Kontakt anlegen');
    await contactCreate.click();
    const contactDialog = contacts.getByRole('dialog', {
      name: 'Kontakt anlegen',
    });
    await expect(contactDialog).toBeVisible();
    await expect(contacts.getByLabel('Kontaktart')).toBeFocused();
    const desktopContactDialog = (await contactDialog.boundingBox())!;
    expect(desktopContactDialog.x).toBeGreaterThanOrEqual(0);
    expect(
      desktopContactDialog.x + desktopContactDialog.width,
    ).toBeLessThanOrEqual(1280);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const mobileContactDialog = (await contactDialog.boundingBox())!;
      expect(mobileContactDialog.x).toBeGreaterThanOrEqual(0);
      expect(
        mobileContactDialog.x + mobileContactDialog.width,
      ).toBeLessThanOrEqual(width);
      expect(mobileContactDialog.width).toBeGreaterThan(280);
      expect(
        await contactDialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      expect(
        await contacts
          .locator('.contact-toolbar')
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true);
      expect(
        await contacts.evaluate(
          (section) => section.scrollWidth <= section.clientWidth + 1,
        ),
      ).toBe(true);
      await page.keyboard.press('Tab');
      expect(
        await contactDialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await contacts.getByLabel('Name / Firma').fill('Synthetic browser contact');
    await contacts.getByLabel('Kontaktart').selectOption('company');
    await contacts.getByLabel('E-Mail-Adresse').fill('browser@example.invalid');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(contactDialog).toBeHidden();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
    const contactSearch = contacts.getByLabel('Kontakte suchen');
    await contactSearch.fill('no-such-synthetic-contact');
    await contacts
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .click();
    await expect(contacts.getByText('Keine Kontakte gefunden.')).toBeVisible();
    await contactSearch.fill('Synthetic browser contact');
    await contacts
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .click();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
    await navigate('Kontakte');
    const contactEdit = contacts.getByRole('button', {
      name: 'Kontakt bearbeiten: Synthetic browser contact',
    });
    // BKP011.1: the row keeps one icon action. The reading record opens from
    // the contact name itself, so the old "Events anzeigen" button is gone.
    await expect(
      contacts.getByRole('link', {
        name: 'Synthetic browser contact',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      contacts.getByRole('button', { name: /Events anzeigen/ }),
    ).toHaveCount(0);
    await expect(contactEdit).toHaveAttribute('title', 'Kontakt bearbeiten');
    await expect(contactEdit).toHaveText('');
    const contactActionBox = (await contactEdit.boundingBox())!;
    expect(contactActionBox.width).toBeGreaterThanOrEqual(44);
    expect(contactActionBox.height).toBeGreaterThanOrEqual(44);
    await contactEdit.click();
    const contactEditDialog = contacts.getByRole('dialog', {
      name: 'Kontakt bearbeiten',
    });
    await expect(contactEditDialog).toBeVisible();
    await expect(contacts.getByLabel('Name / Firma')).toHaveValue(
      'Synthetic browser contact',
    );
    await page.keyboard.press('Escape');
    await expect(contactEditDialog).toBeHidden();
    await expect(contactEdit).toBeFocused();
    await contactEdit.click();
    let discardPrompt = '';
    page.once('dialog', (dialog) => {
      discardPrompt = dialog.message();
      void dialog.dismiss();
    });
    await contacts.getByLabel('Name / Firma').fill('Synthetic browser dirty');
    await page.keyboard.press('Escape');
    await expect(contactEditDialog).toBeVisible();
    await expect(contacts.getByLabel('Name / Firma')).toHaveValue(
      'Synthetic browser dirty',
    );
    expect(discardPrompt).toContain('Ungespeicherte Eingaben verwerfen');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Escape');
    await expect(contactEditDialog).toBeHidden();
    await contactEdit.click();
    await expect(contacts.getByLabel('Name / Firma')).toHaveValue(
      'Synthetic browser contact',
    );
    let releaseSave: (() => void) | undefined;
    const contactMutationUrl = (url: URL) =>
      url.pathname.startsWith('/api/v1/contacts/');
    const failContactMutation = async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid' }),
      });
    };
    await page.route(contactMutationUrl, failContactMutation);
    await contacts.getByLabel('Name / Firma').fill('Synthetic browser pending');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(contactEditDialog).toHaveAttribute('aria-busy', 'true');
    expect(
      await contactEditDialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press('Tab');
    expect(
      await contactEditDialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(
      await contactEditDialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(contactEditDialog).toBeVisible();
    releaseSave!();
    await expect(contacts.getByText(/Speichern fehlgeschlagen/)).toBeVisible();
    await expect(contacts.getByRole('alert')).toBeFocused();
    await expect(contacts.getByLabel('Name / Firma')).toHaveValue(
      'Synthetic browser pending',
    );
    await page.unroute(contactMutationUrl, failContactMutation);
    await contacts.getByLabel('Name / Firma').fill('Synthetic browser contact');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(contactEditDialog).toBeHidden();
    await contactEdit.click();
    await expect(contactEditDialog).toBeVisible();
    await contacts.getByRole('button', { name: 'Dubletten prüfen' }).click();
    const duplicateSuccess = contacts.getByText(
      'Keine möglichen Dubletten gefunden.',
    );
    await expect(duplicateSuccess).toBeVisible();
    await expect(duplicateSuccess).toHaveAttribute('role', 'status');
    const contactListUrl = (url: URL) => url.pathname === '/api/v1/contacts';
    let failNextList = true;
    const failContactList = async (route: Route) => {
      if (route.request().method() !== 'GET' || !failNextList)
        return route.continue();
      failNextList = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unavailable' }),
      });
    };
    await page.route(contactListUrl, failContactList);
    await contacts.getByLabel('Kontaktzustand').selectOption('archived');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(contactEditDialog).toBeHidden();
    await expect(
      contacts.getByText(
        'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
      ),
    ).toBeVisible();
    await page.unroute(contactListUrl, failContactList);
    const contactRetry = contacts.getByRole('button', {
      name: 'Kontakte erneut laden',
    });
    await expect(contactRetry).toBeVisible();
    await contactRetry.click();
    await expect(
      contacts.getByRole('link', {
        name: 'Synthetic browser contact',
        exact: true,
      }),
    ).toBeVisible();
    // The archive state is its own labelled text next to the name link.
    await expect(
      contacts.getByText('Archiviert', { exact: true }),
    ).toBeVisible();
    await expect(contactRetry).toBeHidden();
    const download = page.waitForEvent('download');
    await contacts
      .getByRole('link', { name: 'Kontakte als CSV exportieren' })
      .click();
    expect((await download).suggestedFilename()).toBe('contacts.csv');
    // H034: locations are no longer an area of their own. The retired deep
    // link lands on the events overview with the same query and no new entry.
    await page.evaluate(() => {
      window.location.hash = 'locations';
    });
    // Navigating to the retired hash itself may add one entry; the
    // normalization must not add another.
    const historyAfterRetiredHash = await page.evaluate(() => history.length);
    await expect(
      page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Events', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => location.hash)).toBe('#events');
    expect(await page.evaluate(() => history.length)).toBe(
      historyAfterRetiredHash,
    );
    await expect(page.getByRole('region', { name: 'Locations' })).toHaveCount(
      0,
    );
    await navigate('Kontakte');
    await contactEdit.click();
    await contacts.getByLabel('Kontaktzustand').selectOption('active');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
    await navigate('Events');
    const events = page.getByRole('region', { name: 'Events' });
    // BKP014.1: a dated card names its day, its short month and its real time
    // window. These assertions replace the former flat name–date–status string.
    const expectEventCard = async (
      day: string,
      month: string,
      time = '18:00–01:00 Uhr',
    ) => {
      const card = events.getByRole('link', {
        name: /Synthetic browser event/,
      });
      await expect(card.locator('.event-date-day')).toHaveText(day);
      await expect(card.locator('.event-date-label')).toHaveText(month);
      await expect(card.locator('.event-time')).toHaveText(time);
    };
    // A real tab return refreshes the list without a manual control. Stammdaten
    // created earlier must be available in the create dialog afterwards.
    let eventListRequests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        request.url().includes('/api/v1/events')
      )
        eventListRequests += 1;
    });
    const listRequestsBeforeReturn = eventListRequests;
    const refreshedList = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/events') &&
        response.request().method() === 'GET',
    );
    await returnToApp();
    await refreshedList;
    expect(eventListRequests).toBe(listRequestsBeforeReturn + 1);
    await expect(
      events.getByLabel('Eventname', { exact: true }),
    ).not.toBeVisible();
    const createTrigger = events.getByRole('button', {
      name: 'Event anlegen',
      exact: true,
    });
    await expect(createTrigger).toHaveAttribute('title', 'Event anlegen');
    await createTrigger.click();
    const createDialog = events.getByRole('dialog', { name: 'Neues Event' });
    await expect(createDialog).toBeVisible();
    await expect(events.getByLabel('Eventdatum')).toBeFocused();
    const desktopDialog = (await createDialog.boundingBox())!;
    expect(desktopDialog.x).toBeGreaterThanOrEqual(0);
    expect(desktopDialog.x + desktopDialog.width).toBeLessThanOrEqual(1280);
    expect(desktopDialog.width).toBeGreaterThan(500);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDialog = (await createDialog.boundingBox())!;
    expect(mobileDialog.x).toBeGreaterThanOrEqual(0);
    expect(mobileDialog.x + mobileDialog.width).toBeLessThanOrEqual(390);
    expect(mobileDialog.width).toBeGreaterThan(300);
    expect(
      await createDialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    const createClose = events.getByRole('button', {
      name: 'Dialog schließen',
    });
    const createSave = events.getByRole('button', {
      name: 'Event speichern',
      exact: true,
    });
    await createSave.focus();
    await page.keyboard.press('Tab');
    await expect(createClose).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(createSave).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(createDialog).toBeHidden();
    await expect(createTrigger).toBeFocused();
    await createTrigger.click();
    await expect(createDialog).toBeVisible();
    // The contact form is a view inside this dialog box, never a second dialog
    // level: the filled draft stays mounted and comes back untouched.
    await events.getByLabel('Eventdatum').fill('2026-10-16');
    await events.getByRole('button', { name: 'Neuen Kunden anlegen' }).click();
    const inlineContact = events.getByRole('dialog', {
      name: 'Kontakt anlegen',
    });
    await expect(inlineContact).toBeVisible();
    await expect(events.getByRole('dialog')).toHaveCount(1);
    await expect(events.getByLabel('Eventdatum')).toBeHidden();
    await expect(events.getByLabel('Kunde suchen')).toBeHidden();
    await expect(events.getByLabel('Kontaktart')).toBeFocused();
    await audit('event-create-inline-contact');
    await events
      .getByRole('button', { name: 'Kontaktanlage schließen' })
      .click();
    await expect(inlineContact).toBeHidden();
    await expect(events.getByLabel('Eventdatum')).toHaveValue('2026-10-16');
    await expect(events.getByLabel('Kunde suchen')).toBeFocused();
    // BKP012.1: the create dialog searches for the stored contact instead of
    // listing every one of them.
    const pickerSearch = events.getByLabel('Kunde suchen');
    await pickerSearch.fill('Synthetic browser');
    const browserContact = events.getByRole('button', {
      name: /Synthetic browser contact/,
    });
    await expect(browserContact).toBeEnabled();
    await audit('event-create-contact-picker');
    await expect(events.getByLabel('Eventname', { exact: true })).toBeHidden();
    await expect(
      events.getByLabel('Eventbeginn', { exact: true }),
    ).toBeHidden();
    await expect(events.getByLabel('Ort / Adresse')).toBeHidden();
    await expect(events.getByLabel('Interne Notizen')).toBeHidden();
    await expect(
      events.getByRole('combobox', { name: 'Eventart', exact: true }),
    ).toBeVisible();
    await events.getByText('Weitere Angaben', { exact: true }).click();
    await expect(events.getByLabel('Eventname', { exact: true })).toBeVisible();
    await events
      .getByLabel('Eventname', { exact: true })
      .fill('Synthetic browser event');
    await browserContact.click();
    await events
      .getByRole('combobox', { name: 'Eventart', exact: true })
      .selectOption({ label: 'Hochzeit' });
    await events.getByLabel('Eventdatum').fill('2026-10-16');
    await events.getByLabel('Eventbeginn').fill('2026-10-16T18:00');
    await events.getByLabel('Eventende').fill('2026-10-17T01:00');
    await events
      .getByLabel('Ort / Adresse')
      .fill('Synthetic Browser Hall\nSide entrance');
    await events
      .getByLabel('Interne Notizen')
      .fill(
        '<strong>Fictional browser note</strong><script>window.syntheticBad=true</script>',
      );
    await createSave.click();
    await expectEventCard('16', 'Fr / Okt');
    await expect(
      events.getByRole('link', {
        name: /Synthetic browser event/,
      }),
    ).toHaveAttribute('href', /#event-/);
    await expect(
      events.getByRole('link', { name: /Synthetic browser event/ }),
    ).toContainText('Synthetic Browser Hall');
    const editIcon = events.getByRole('button', {
      name: 'Event bearbeiten: Synthetic browser event',
    });
    await expect(editIcon).toHaveAttribute('title', 'Event bearbeiten');
    await expect(editIcon).toHaveText('');
    const editBox = await editIcon.boundingBox();
    expect(editBox!.width).toBeGreaterThanOrEqual(44);
    expect(editBox!.height).toBeGreaterThanOrEqual(44);
    const recordLink = events.getByRole('link', {
      name: /Synthetic browser event/,
    });
    await recordLink.focus();
    await page.keyboard.press('Enter');
    await expect(recordLink).not.toBeVisible();
    await page.goBack();
    await expect(
      events.getByRole('link', {
        name: /Synthetic browser event/,
      }),
    ).toBeVisible();
    // BKP014.1: the overview reads as cards. On desktop and mobile, in both
    // themes, date/status/type/name/place are separate blocks in that reading
    // order, the month heading keeps its count, and the one open action still
    // opens the record and comes back.
    for (const [width, theme] of [
      [1280, 'light'],
      [1280, 'dark'],
      [390, 'dark'],
      [390, 'light'],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      const themeToggle = page.getByRole('button', {
        name: /modus aktivieren/,
      });
      if (
        (await themeToggle.getAttribute('aria-pressed')) !==
        String(theme === 'dark')
      )
        await themeToggle.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const card = events
        .locator('li.event-card')
        .filter({
          has: page.getByRole('link', { name: /Synthetic browser event/ }),
        })
        .first();
      await expect(card).toBeVisible();
      const day = card.locator('.event-date-day');
      const status = card.locator('.event-status');
      const type = card.locator('.event-type');
      const name = card.locator('.event-title');
      const place = card.locator('.event-place');
      for (const part of [day, status, type, name, place])
        await expect(part).toHaveCount(1);
      const [dayBox, statusBox, typeBox, nameBox, placeBox] = await Promise.all(
        [day, status, type, name, place].map((part) => part.boundingBox()),
      );
      // The date column sits left of the text block; status, type and name
      // stack above the place instead of being one glued string.
      expect(dayBox!.x + dayBox!.width).toBeLessThanOrEqual(nameBox!.x);
      expect(statusBox!.y).toBeLessThan(typeBox!.y);
      expect(typeBox!.y).toBeLessThan(nameBox!.y);
      expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(placeBox!.y);
      await expect(name).toHaveText('Synthetic browser event');
      await expect(name).toHaveCSS('white-space', 'normal');
      await expect(status).toHaveText('Anfrage');
      await expect(day).toHaveText('16');
      await expect(card.locator('.event-date-label')).toHaveText('Fr / Okt');
      await expect(type).toHaveText('Hochzeit');
      await expect(place).toContainText('Synthetic Browser Hall');
      // BKP014.2: this event holds no unit, and the card says so instead of
      // leaving the reader with an unanswered question.
      await expect(card.locator('.event-resources')).toHaveText(
        'Noch keine Ressource',
      );
      // No technical resource instruction survives in a row.
      await expect(events.locator('.event-resource-hint')).toHaveCount(0);
      await expect(
        events.getByRole('heading', { name: /Oktober 2026/ }),
      ).toContainText(/· \d+ Events?/);
      // One primary link per row, no button inside it, and the row's quiet
      // actions stay outside the link.
      await expect(card.locator('a')).toHaveCount(1);
      expect(await card.locator('a button').count()).toBe(0);
      await expect(
        card.getByRole('button', {
          name: 'Event bearbeiten: Synthetic browser event',
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      await audit(`event-cards-${width}-${theme}`);
      await card
        .getByRole('link', { name: /Öffnen: .*Synthetic browser event/ })
        .click();
      await expect(
        events.getByRole('region', { name: 'Event-Details' }),
      ).toBeVisible();
      // BKP013.1: the head names date, title and status in every work area,
      // the documents live in Dateien instead of the details overview, and a
      // status draft survives the area switch without being saved.
      const openRecord = events.getByRole('region', {
        name: 'Event-Details',
        exact: true,
      });
      await expect(openRecord.locator('.event-record-date')).toHaveText(
        '16. Oktober 2026',
      );
      await expect(openRecord.locator('.event-record-head h2')).toHaveText(
        'Event: Synthetic browser event',
      );
      await expect(
        openRecord.locator('.event-record-facts .event-status'),
      ).toHaveText('Anfrage');
      // Wide frames keep contact and place beside the main information.
      const [mainBox, asideBox] = await Promise.all([
        openRecord.locator('.event-detail-main').boundingBox(),
        openRecord.locator('.event-detail-aside').boundingBox(),
      ]);
      if (width === 1280)
        expect(asideBox!.x).toBeGreaterThanOrEqual(mainBox!.x + mainBox!.width);
      else expect(asideBox!.y).toBeGreaterThan(mainBox!.y);
      await expect(
        openRecord.getByRole('region', { name: 'Angebote' }),
      ).toHaveCount(0);
      await openRecord
        .getByRole('button', { name: 'Dateien', exact: true })
        .click();
      await expect(
        openRecord.getByRole('region', { name: 'Dateien' }),
      ).toBeVisible();
      await expect(
        openRecord.getByRole('region', { name: 'Angebote' }),
      ).toBeVisible();
      await expect(openRecord.locator('.event-record-head h2')).toHaveText(
        'Event: Synthetic browser event',
      );
      await openRecord
        .getByRole('button', { name: 'Details', exact: true })
        .click();
      await openRecord
        .getByRole('combobox', { name: 'Status des Events', exact: true })
        .selectOption('option');
      for (const area of ['Dateien', 'Notizen', 'Logbuch', 'Details'])
        await openRecord
          .getByRole('button', { name: area, exact: true })
          .click();
      await expect(
        openRecord.getByRole('combobox', { name: 'Status des Events' }),
      ).toHaveValue('option');
      // The chosen area keeps the keyboard focus for the next Tab press.
      await openRecord
        .getByRole('button', { name: 'Dateien', exact: true })
        .click();
      await expect(
        openRecord.getByRole('region', { name: 'Dateien' }),
      ).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      await audit(`event-record-${width}-${theme}`);
      await page.goBack();
      await expect(
        events.getByRole('region', { name: 'Event-Details' }),
      ).toHaveCount(0);
      await expect(card).toBeVisible();
    }
    // The card keeps its shape across the supported range: no page overflow,
    // the date column stays left of a wrapping title.
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const card = events
        .locator('li.event-card')
        .filter({
          has: page.getByRole('link', { name: /Synthetic browser event/ }),
        })
        .first();
      const [dateBox, titleBox, cardBox] = await Promise.all([
        card.locator('.event-date-day').boundingBox(),
        card.locator('.event-title').boundingBox(),
        card.boundingBox(),
      ]);
      expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(titleBox!.x);
      expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
    }
    // BKP013.1: the narrow frame keeps the record usable in both themes — the
    // head stays visible, all five areas fit one row, contact and place wait
    // behind one deliberate disclosure, and nothing overflows sideways. The
    // loop ends in the light theme again, which the following blocks expect.
    for (const theme of ['dark', 'light'] as const) {
      await page.setViewportSize({ width: 320, height: 844 });
      const toggle = page.getByRole('button', { name: /modus aktivieren/ });
      if (
        (await toggle.getAttribute('aria-pressed')) !== String(theme === 'dark')
      )
        await toggle.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await events
        .getByRole('link', { name: /Synthetic browser event/ })
        .click();
      const narrowRecord = events.getByRole('region', {
        name: 'Event-Details',
        exact: true,
      });
      await expect(narrowRecord.locator('.event-record-head h2')).toBeVisible();
      await expect(narrowRecord.locator('.event-record-date')).toBeVisible();
      const areaBar = narrowRecord.getByRole('navigation', {
        name: 'Bereiche des Events',
      });
      await expect(areaBar.getByRole('button')).toHaveCount(5);
      expect((await areaBar.boundingBox())!.height).toBeLessThan(100);
      const aside = narrowRecord.locator('details.event-aside');
      await expect(aside).not.toHaveAttribute('open', '');
      await aside.locator('summary').click();
      await expect(
        aside.getByRole('heading', { name: 'Ort / Adresse' }),
      ).toBeVisible();
      await narrowRecord
        .getByRole('button', { name: 'Dateien', exact: true })
        .click();
      await expect(
        narrowRecord.getByRole('region', { name: 'Angebote' }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(321);
      await audit(`event-record-320-${theme}`);
      await page.goBack();
      await expect(
        events.getByRole('region', { name: 'Event-Details' }),
      ).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await events
      .getByRole('link', {
        name: /Synthetic browser event/,
      })
      .click();
    await events.getByRole('button', { name: 'Notizen', exact: true }).click();
    await expect(
      events.getByLabel('Notizen: Synthetic browser event').locator('strong'),
    ).toHaveText('Fictional browser note');
    expect(
      await page.evaluate(() => Object.hasOwn(window, 'syntheticBad')),
    ).toBe(false);
    const record = events.getByRole('region', {
      name: 'Event-Details',
      exact: true,
    });
    await record.getByRole('button', { name: 'Details', exact: true }).click();
    await record
      .getByRole('combobox', { name: 'Status des Events', exact: true })
      .selectOption('option');
    await record.getByRole('button', { name: 'Status speichern' }).click();
    await expect(
      events.getByText('Eventstatus gespeichert.', { exact: true }),
    ).toBeVisible();
    await record.getByRole('button', { name: 'Logbuch', exact: true }).click();
    await expect(
      record.getByText(/Status von Anfrage auf Option geändert/),
    ).toBeVisible();
    // BKP013.2: a confirmed create is stored data. Its row has to stay
    // reachable when the following list read fails, so an operator never loses
    // a draft that already exists — and the retry only re-reads. Both answers
    // come from stubs with different rows so the row on screen has a source.
    const storedEvent = (
      await pool.query<{ id: string; contactId: string | null }>(
        'SELECT e.id, ec.contact_id AS "contactId" FROM events e LEFT JOIN event_contacts ec ON ec.tenant_id=e.tenant_id AND ec.event_id=e.id AND ec.role=$3 WHERE e.tenant_id=$1 AND e.name=$2',
        [config.tenantId, 'Synthetic browser event', 'primary'],
      )
    ).rows[0]!;
    expect(storedEvent.contactId).toBeTruthy();
    const offerTemplateRow = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'offer',
      name: 'Synthetic fallback offer',
      state: 'active',
    };
    const eventFileRow = {
      id: '99999999-9999-4999-8999-999999999999',
      kind: 'offer',
      templateId: offerTemplateRow.id,
      eventId: storedEvent.id,
      contactId: storedEvent.contactId,
      number: null,
      state: 'draft',
      issuedAt: '2031-05-03T09:00:00.000Z',
      finalizedAt: null,
      netMinor: 10925,
      taxMinor: 2075,
      grossMinor: 13000,
      version: 1,
    };
    let failEventFileRead = false,
      eventFilePosts = 0,
      eventFileRows: unknown[] = [];
    const isEventFileRequest = (url: URL) =>
      url.pathname === '/api/v1/documents' &&
      url.searchParams.get('include') !== 'metadata';
    const eventFilesRoute = async (route: Route) => {
      if (route.request().method() === 'POST') {
        eventFilePosts += 1;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(eventFileRow),
        });
        return;
      }
      await route.fulfill(
        failEventFileRead
          ? { status: 503, body: '' }
          : {
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(eventFileRows),
            },
      );
    };
    const offerTemplatesRoute = async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([offerTemplateRow]),
      });
    };
    await page.route(isEventFileRequest, eventFilesRoute);
    await page.route(
      (url) => url.pathname === '/api/v1/document-templates',
      offerTemplatesRoute,
    );
    // The record has to mount again, otherwise its file area already read the
    // list before these stubs existed.
    await page.goBack();
    await expect(
      events.getByRole('region', { name: 'Event-Details' }),
    ).toHaveCount(0);
    await events.getByRole('link', { name: /Synthetic browser event/ }).click();
    await expect(record.locator('.event-record-head h2')).toBeVisible();
    await record.getByRole('button', { name: 'Dateien', exact: true }).click();
    const createdOffer = record.getByRole('region', { name: 'Angebote' });
    await expect(createdOffer).toBeVisible();
    await expect(
      record.getByText('Noch kein Angebot zu diesem Event.'),
    ).toBeVisible();
    await expect(record.getByLabel('Vorlage')).toHaveValue(offerTemplateRow.id);
    failEventFileRead = true;
    await record.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(
      record.getByText('Entwurf angelegt.', { exact: true }),
    ).toBeVisible();
    await expect(
      record.getByText(
        /Gespeichert, aber die Dateiliste konnte nicht neu geladen werden/,
      ),
    ).toBeVisible();
    // The row from the create answer is readable and operable although the
    // list read failed: no lost draft, no blind second create.
    await expect(createdOffer.getByText('130,00 €')).toBeVisible();
    const createdOfferEdit = createdOffer.getByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    });
    await expect(createdOfferEdit).toBeEnabled();
    expect(eventFilePosts).toBe(1);
    // The retry re-reads. The stored row replaces the local one exactly once.
    failEventFileRead = false;
    eventFileRows = [{ ...eventFileRow, version: 2 }];
    await record.getByRole('button', { name: 'Dateien erneut laden' }).click();
    await expect(
      record.getByText(/Dateiliste konnte nicht neu geladen werden/),
    ).toHaveCount(0);
    await expect(createdOffer.locator('li')).toHaveCount(1);
    await expect(createdOfferEdit).toBeVisible();
    expect(eventFilePosts).toBe(1);
    await page.unroute(isEventFileRequest, eventFilesRoute);
    await page.unroute(
      (url) => url.pathname === '/api/v1/document-templates',
      offerTemplatesRoute,
    );
    await page.goBack();
    await expect(
      events.getByRole('region', { name: 'Event-Details' }),
    ).toHaveCount(0);
    await navigate('Kontakte');
    const contactNameLink = contacts.getByRole('link', {
      name: 'Synthetic browser contact',
      exact: true,
    });
    await expect(contactNameLink).toHaveAttribute('href', /^#contact-/);
    const contactHref = (await contactNameLink.getAttribute('href'))!;
    await contactNameLink.click();
    const contactRecord = contacts.getByRole('region', {
      name: 'Kontakt-Details',
    });
    await expect(contactRecord).toBeVisible();
    await expect(
      contactRecord.getByRole('link', { name: 'Synthetic browser event' }),
    ).toBeVisible();
    const contactRecordClose = contactRecord.getByRole('button', {
      name: 'Kontakt-Details schließen',
    });
    // BKP011.1b: the opened record is measured, not assumed. At 320, 390 and
    // 1280px in both themes neither the record, its list row nor the document
    // may scroll sideways, every value and event line wraps inside the record
    // instead of colliding, and the one close control stays visible and
    // operable. A line that cannot break would show up as a clipped box here,
    // not only as a hidden page overflow.
    const contactRecordReport = () =>
      contactRecord.evaluate((record) => {
        const overflow = (element: Element) =>
          element.scrollWidth - element.clientWidth;
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const recordBox = box(record);
        const inside = (element: Element) => {
          const rect = box(element);
          return (
            rect.left >= recordBox.left - 1 && rect.right <= recordBox.right + 1
          );
        };
        const collides = (first: Element, second: Element) => {
          const a = box(first);
          const b = box(second);
          return (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          );
        };
        const textLines = Array.from(
          record.querySelectorAll(
            '.contact-record-head h2, dl dd, .contact-record-address address > span, .contact-record-address p',
          ),
        );
        const eventRows = Array.from(
          record.querySelectorAll('.contact-event-list > li'),
        );
        const eventParts = eventRows.flatMap((row) => Array.from(row.children));
        const collisions: boolean[] = [];
        for (const row of eventRows) {
          const parts = Array.from(row.children);
          for (let first = 0; first < parts.length; first += 1)
            for (let second = first + 1; second < parts.length; second += 1)
              collisions.push(collides(parts[first]!, parts[second]!));
        }
        const address = record.querySelector('.contact-record-address');
        // BKP011.1d: the heading rename moved the record from h3 to h2 without
        // the stylesheet. The measured style is the regression guard: an h2 the
        // sheet does not select keeps the UA 24px/margins, has no jump offset
        // and no explicit overflow-wrap.
        const heading = record.querySelector<HTMLElement>(
          '.contact-record-head h2',
        );
        const headingStyle = heading ? getComputedStyle(heading) : null;
        const events = record.querySelector('.contact-record-events');
        const close = record.querySelector(
          '.contact-record-actions .tertiary-action',
        );
        let closeCovered = true;
        if (close) {
          const rect = box(close);
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          closeCovered = hit !== close && !close.contains(hit);
        }
        return {
          record: overflow(record),
          row: record.parentElement ? overflow(record.parentElement) : -1,
          document:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          textLines: textLines.length,
          textLinesInside: textLines.every(inside),
          textLinesClipped: textLines.some((element) => overflow(element) > 1),
          headingPresent: Boolean(heading),
          headingInside: heading ? inside(heading) : false,
          headingClipped: heading ? overflow(heading) > 1 : true,
          headingWrap: headingStyle?.overflowWrap ?? '',
          headingJump: headingStyle?.scrollMarginTop ?? '',
          headingSize: headingStyle?.fontSize ?? '',
          headingMargins: headingStyle
            ? `${headingStyle.marginBlockStart} ${headingStyle.marginBlockEnd}`
            : '',
          eventParts: eventParts.length,
          eventPartsInside: eventParts.every(inside),
          eventPartsClipped: eventParts.some(
            (element) => overflow(element) > 1,
          ),
          eventRowsWrap: eventRows.every(
            (row) => getComputedStyle(row).flexWrap === 'wrap',
          ),
          eventCollisions: collisions.some(Boolean),
          addressEventsCollide: Boolean(
            address && events && collides(address, events),
          ),
          closeCovered,
        };
      });
    for (const [width, theme] of [
      [320, 'light'],
      [320, 'dark'],
      [390, 'light'],
      [390, 'dark'],
      [1280, 'light'],
      [1280, 'dark'],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      if (
        (await themeToggle.getAttribute('aria-pressed')) !==
        String(theme === 'dark')
      )
        await themeToggle.click();
      await expect(themeToggle).toHaveAttribute(
        'aria-pressed',
        String(theme === 'dark'),
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(contactRecord).toBeVisible();
      // The close control is reached the way a reader reaches it, so the
      // element-from-point check below measures a control that is in view.
      await contactRecordClose.scrollIntoViewIfNeeded();
      await expect(contactRecordClose).toBeVisible();
      await expect(contactRecordClose).toBeEnabled();
      const recordCloseBox = (await contactRecordClose.boundingBox())!;
      expect(recordCloseBox.x).toBeGreaterThanOrEqual(0);
      expect(recordCloseBox.x + recordCloseBox.width).toBeLessThanOrEqual(
        width,
      );
      const report = await contactRecordReport();
      expect(report.record).toBeLessThanOrEqual(1);
      expect(report.row).toBeLessThanOrEqual(1);
      expect(report.document).toBeLessThanOrEqual(1);
      expect(report.textLines).toBeGreaterThan(2);
      expect(report.textLinesInside).toBe(true);
      expect(report.textLinesClipped).toBe(false);
      expect(report.headingPresent).toBe(true);
      expect(report.headingInside).toBe(true);
      expect(report.headingClipped).toBe(false);
      expect(report.headingWrap).toBe('anywhere');
      // The documented 6rem jump offset and the record sizes, not the UA h2.
      expect(report.headingJump).toBe('96px');
      expect(report.headingSize).toBe('19.2px');
      expect(report.headingMargins).toBe('0px 0px');
      expect(report.eventParts).toBeGreaterThan(2);
      expect(report.eventPartsInside).toBe(true);
      expect(report.eventPartsClipped).toBe(false);
      expect(report.eventRowsWrap).toBe(true);
      expect(report.eventCollisions).toBe(false);
      expect(report.addressEventsCollide).toBe(false);
      expect(report.closeCovered).toBe(false);
      // The screenshot lands before the scan, so a failing audit still leaves
      // the visual evidence of the state that failed.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `tests/test-results/contact-record-${width}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await audit(`contact-record-${width}-${theme}`);
    }
    // Leave the run in the light theme the contact steps assert in.
    if ((await themeToggle.getAttribute('aria-pressed')) !== 'false')
      await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Closing returns to the list and the record stays a real deep link.
    await contactRecord
      .getByRole('button', { name: 'Kontakt-Details schließen' })
      .click();
    await expect(contactRecord).toBeHidden();
    await expect(page).toHaveURL(/#contacts$/);
    await page.goto(new URL(contactHref, page.url()).href);
    await page.reload();
    await expect(
      contacts.getByRole('region', { name: 'Kontakt-Details' }),
    ).toBeVisible();
    await navigate('Events');
    await events
      .getByRole('button', {
        name: 'Event bearbeiten: Synthetic browser event',
      })
      .click();
    await events.getByLabel('Eventstatus').selectOption('cancelled');
    await events.getByRole('button', { name: 'Event speichern' }).click();
    await expectEventCard('16', 'Fr / Okt');
    // Real DST change: 16.10. is CEST, 16.11. is CET. The browser only edits
    // wall-clock fields; the instant must follow the tenant timezone.
    await events
      .getByRole('button', {
        name: 'Event bearbeiten: Synthetic browser event',
      })
      .click();
    // The business date is read-only while a start exists: it follows the
    // local start day instead of silently ignoring a second date input.
    await expect(events.getByLabel('Eventdatum')).toHaveAttribute(
      'readonly',
      '',
    );
    await events.getByLabel('Eventbeginn').fill('2026-11-16T18:00');
    await expect(events.getByLabel('Eventdatum')).toHaveValue('2026-11-16');
    await events.getByLabel('Eventende').fill('2026-11-17T01:00');
    await expect(events.getByLabel(/UTC-Versatz/)).toHaveCount(0);
    await events.getByRole('button', { name: 'Event speichern' }).click();
    await expectEventCard('16', 'Mo / Nov');
    await events
      .getByRole('button', {
        name: 'Event bearbeiten: Synthetic browser event',
      })
      .click();
    await expect(events.getByLabel('Eventbeginn')).toHaveValue(
      /^2026-11-16T18:00/,
    );
    await expect(events.getByLabel('Eventende')).toHaveValue(
      /^2026-11-17T01:00/,
    );
    await events.getByLabel('Eventbeginn').fill('2026-10-16T18:00');
    await events.getByLabel('Eventende').fill('2026-10-17T01:00');
    await events.getByRole('button', { name: 'Event speichern' }).click();
    await expectEventCard('16', 'Fr / Okt');
    await events.getByRole('button', { name: 'Event anlegen' }).click();
    await events.getByText('Weitere Angaben', { exact: true }).click();
    await events
      .getByLabel('Eventname', { exact: true })
      .fill('Fictional resource booking');
    await events.getByLabel('Eventdatum').fill('2030-10-16');
    await events
      .getByLabel('Eventbeginn', { exact: true })
      .fill('2030-10-16T18:00');
    await events
      .getByLabel('Eventende', { exact: true })
      .fill('2030-10-16T20:00');
    await events
      .getByRole('button', { name: 'Event speichern', exact: true })
      .click();
    await events
      .getByRole('link', {
        name: /Fictional resource booking/,
      })
      .click();
    await record
      .getByRole('button', { name: 'Ressourcen', exact: true })
      .click();
    const assignment = record.getByRole('region', {
      name: 'Ressourcenzuweisung',
    });
    await assignment
      .getByLabel('FB2 · Einheit 1 zuweisen', { exact: true })
      .check();
    await assignment
      .getByLabel('Glamour-Paket · Einheit 1 zuweisen', { exact: true })
      .check();
    await assignment
      .getByRole('combobox', { name: 'Buchungsstatus', exact: true })
      .selectOption('booked');
    await assignment
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .click();
    await expect(
      events.getByText('Ressourcen und Termin gespeichert.', { exact: true }),
    ).toBeVisible();
    await expect(
      assignment.getByLabel('FB2 · Einheit 1 zuweisen', { exact: true }),
    ).toBeChecked();
    await expect(
      assignment.getByRole('combobox', {
        name: 'Buchungsstatus',
        exact: true,
      }),
    ).toHaveValue('booked');
    // The business date follows the local start day and is read-only.
    const assignmentDate = assignment.getByLabel('Eventdatum');
    await expect(assignmentDate).toHaveAttribute('readonly', '');
    await expect(assignment.getByLabel(/UTC-Versatz/)).toHaveCount(0);
    const fb2 = assignment.getByRole('group', { name: /FB2 · Einheit 1/ });
    await fb2.getByText(/^Erweitert: eigener Dispositionszeitraum/).click();
    await expect(fb2.getByLabel('Zeitraum: FB2 · Einheit 1')).toBeVisible();
    await fb2.getByText(/^Erweitert: eigener Dispositionszeitraum/).click();
    await assignment
      .getByLabel('Eventbeginn', { exact: true })
      .fill('2030-10-20T18:00');
    await assignment
      .getByLabel('Eventende', { exact: true })
      .fill('2030-10-20T20:00');
    await expect(assignmentDate).toHaveValue('2030-10-20');
    await assignment
      .getByRole('button', {
        name: 'Verfügbarkeit prüfen: FB2 · Einheit 1',
        exact: true,
      })
      .click();
    await expect(
      assignment.getByText('Verfügbarkeit aktualisiert.', { exact: true }),
    ).toBeVisible();
    await assignment
      .getByRole('button', { name: 'Zuweisung und Termin speichern' })
      .click();
    await expect(
      events.getByText('Ressourcen und Termin gespeichert.', { exact: true }),
    ).toBeVisible();
    await record.getByRole('button', { name: 'Logbuch', exact: true }).click();
    await expect(
      record.getByText(/Ressourcenzuordnung und Dispositionszeitraum geändert/),
    ).toBeVisible();
    // H037/BKP014.1: the card names the stored day and time window explicitly.
    const resourceRow = events
      .locator('li.event-card')
      .filter({ hasText: 'Fictional resource booking' });
    await expect(resourceRow.locator('.event-date-day')).toHaveText('20');
    await expect(resourceRow.locator('.event-date-label')).toHaveText(
      'So / Okt',
    );
    await expect(resourceRow.locator('.event-time')).toHaveText(
      '18:00–20:00 Uhr',
    );
    // BKP014.2: the same card names the stored assignment without leaving the
    // list, in the wording of the assignment view — both the box and the
    // package unit that this scenario assigned.
    await expect(resourceRow.locator('.event-resources')).toHaveText(
      'FB2 · Einheit 1 · Gebucht, Glamour-Paket · Einheit 1 · Gebucht',
    );
    await record
      .getByRole('button', { name: 'Ressourcen', exact: true })
      .click();
    await expect(assignment).toHaveAttribute('aria-busy', 'false');
    await assignment.screenshot({
      path: 'tests/test-results/resource-assignment.png',
    });
    await navigate('Kalender');
    const calendar = page.getByRole('region', {
      name: 'Kalender',
      exact: true,
    });
    // H037: the overview opens on the month, the occupancy is a collapsed
    // secondary disclosure, and the icon navigation carries the range.
    await expect(
      calendar.getByRole('combobox', { name: 'Kalenderansicht', exact: true }),
    ).toHaveValue('month');
    for (const name of [
      'Vorheriger Zeitraum',
      'Heute im Kalender',
      'Nächster Zeitraum',
    ]) {
      const button = calendar.getByRole('button', { name });
      await expect(button).toHaveAttribute('title', name);
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(
      calendar.getByRole('group', { name: 'Kalenderzeitraum' }),
    ).toContainText('Oktober');
    const occupancy = calendar.locator('summary', {
      hasText: 'Ressourcenbelegung',
    });
    const timeline = calendar.getByRole('table', {
      name: 'Ressourcen-Zeitleiste',
    });
    // Real summary interaction: the native disclosure hides its mounted
    // content while closed and reveals it on click/keyboard, with no refetch.
    await expect(occupancy).not.toHaveAttribute('aria-expanded', 'true');
    await expect(timeline).toBeHidden();
    await occupancy.click();
    await expect(timeline).toBeVisible();
    await expect(occupancy).toBeFocused();
    await expect(timeline).toBeVisible();
    await occupancy.click();
    await expect(timeline).toBeHidden();
    await expect(occupancy).toBeFocused();
    await occupancy.focus();
    await page.keyboard.press('Enter');
    await expect(timeline).toBeVisible();
    // The month overview fits its container: seven columns, no inner scroll
    // and no body overflow while the occupancy is open.
    const monthGeometry = await calendar.evaluate((element) => {
      const events = element.querySelector('.calendar-events')!;
      const cells = element.querySelectorAll('.calendar-day');
      return {
        view: events.getAttribute('data-view'),
        cells: cells.length,
        innerOverflow: events.scrollWidth - events.clientWidth,
        bodyOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    expect(monthGeometry.view).toBe('month');
    expect(monthGeometry.cells).toBe(31);
    expect(monthGeometry.innerOverflow).toBeLessThanOrEqual(1);
    expect(monthGeometry.bodyOverflow).toBeLessThanOrEqual(0);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const narrow = await calendar.evaluate((element) => {
        const events = element.querySelector('.calendar-events')!;
        return {
          innerOverflow: events.scrollWidth - events.clientWidth,
          bodyOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      expect(narrow.bodyOverflow).toBeLessThanOrEqual(0);
      for (const name of [
        'Vorheriger Zeitraum',
        'Heute im Kalender',
        'Nächster Zeitraum',
      ]) {
        const box = (await calendar
          .getByRole('button', { name })
          .boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await calendar.getByLabel('Kalenderdatum').fill('2030-10-20');
    await calendar
      .getByRole('combobox', { name: 'Kalenderansicht', exact: true })
      .selectOption('day');
    await expect(
      calendar.getByRole('table', { name: 'Ressourcen-Zeitleiste' }),
    ).toBeVisible();
    await expect(
      calendar
        .getByRole('link', { name: 'Fictional resource booking' })
        .first(),
    ).toBeVisible();
    await calendar.screenshot({
      path: 'tests/test-results/calendar-day.png',
    });
    if (mode === 'password') {
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      const contrasts = await calendar
        .locator('.calendar-state')
        .evaluateAll((elements) =>
          elements.map((el) => {
            const luminance = (value: string) => {
              const parts = value
                .match(/[\d.]+/g)!
                .map(Number)
                .map((channel) => channel / 255)
                .map((v) =>
                  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
                );
              return (
                parts[0]! * 0.2126 + parts[1]! * 0.7152 + parts[2]! * 0.0722
              );
            };
            const foreground = luminance(getComputedStyle(el).color);
            const background = luminance(getComputedStyle(el).backgroundColor);
            return (
              (Math.max(foreground, background) + 0.05) /
              (Math.min(foreground, background) + 0.05)
            );
          }),
        );
      expect(contrasts.length).toBeGreaterThan(0);
      expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
      await calendar.screenshot({
        path: 'tests/test-results/admin-calendar-dark.png',
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await calendar
        .getByRole('heading', {
          name: 'Event- und Ressourcenkalender',
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-calendar-dark.png',
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
    }

    await calendar
      .getByRole('combobox', { name: 'Kalenderansicht', exact: true })
      .selectOption('week');
    await expect(
      calendar
        .getByRole('table', { name: 'Ressourcen-Zeitleiste' })
        .getByRole('columnheader'),
    ).toHaveCount(8);
    await calendar
      .getByRole('combobox', { name: 'Kalenderansicht', exact: true })
      .selectOption('month');
    await expect(
      calendar
        .getByRole('table', { name: 'Ressourcen-Zeitleiste' })
        .getByRole('columnheader'),
    ).toHaveCount(32);
    await calendar.screenshot({
      path: 'tests/test-results/calendar-month.png',
    });

    await navigate('Events');
    // BKP007: the H041 filters sit in a context column left of the list, so
    // nothing has to be opened before they are used.
    const filterContext = events.locator('.event-context');
    const filterAccess = events.getByRole('button', { name: /^Filter(,|$)/ });
    await expect(filterContext).toBeVisible();
    const column = (await filterContext.boundingBox())!;
    expect(column.width).toBeGreaterThanOrEqual(238);
    expect(column.width).toBeLessThanOrEqual(282);
    const list = (await events.locator('.event-month').first().boundingBox())!;
    expect(column.x + column.width).toBeLessThanOrEqual(list.x + 1);
    await events.getByLabel('Events suchen', { exact: true }).fill('browser');
    // H041: the exact bounds live in the collapsible custom range.
    await events.getByText('Eigener Zeitraum', { exact: true }).click();
    await events.getByLabel('Filter von').fill('2026-10-16');
    await events.getByLabel('Filter bis').fill('2026-10-16');
    await events
      .getByRole('combobox', { name: 'Filterstatus', exact: true })
      .selectOption('cancelled');
    await events.getByRole('button', { name: 'Events filtern' }).click();
    await expect(page).toHaveURL(/status=cancelled/);
    await expectEventCard('16', 'Fr / Okt');
    // The column is the desktop frame, the compact access with its sheet the
    // narrow one; both read the same applied filter, and neither overflows.
    for (const width of [1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      if (width >= 1024) {
        await expect(filterContext).toBeVisible();
        await expect(filterAccess).toHaveCount(0);
        const box = (await filterContext.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(238);
        expect(box.width).toBeLessThanOrEqual(282);
        const month = (await events
          .locator('.event-month')
          .first()
          .boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(month.x + 1);
        await expect(
          events.getByLabel('Events suchen', { exact: true }),
        ).toBeVisible();
        // Every preset and sort row keeps a 44px target.
        for (const target of await filterContext
          .locator(
            '.date-presets button, .event-sorting label, .event-quick-filters button',
          )
          .all())
          expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          );
        await page.screenshot({
          path: `tests/test-results/event-context-${width}.png`,
          animations: 'disabled',
        });
      } else {
        await expect(filterContext).toHaveCount(0);
        await expect(filterAccess).toBeVisible();
        await expect(filterAccess).toHaveAttribute('aria-expanded', 'false');
        // The list comes first: no filter form before the results.
        await expect(
          events.getByLabel('Events suchen', { exact: true }),
        ).toHaveCount(0);
        await expect(
          events.getByRole('button', { name: 'Event anlegen' }),
        ).toBeVisible();
        await filterAccess.click();
        await expect(filterAccess).toHaveAttribute('aria-expanded', 'true');
        const sheet = events.getByRole('dialog', { name: 'Eventfilter' });
        await expect(sheet).toBeVisible();
        const sheetBox = (await sheet.boundingBox())!;
        expect(sheetBox.width).toBeLessThanOrEqual(width);
        expect(sheetBox.height).toBeLessThanOrEqual(844);
        // The same groups and the same applied values, no horizontal strip.
        await expect(sheet.getByLabel('Events suchen')).toHaveValue('browser');
        expect(
          await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        for (const target of await sheet
          .locator(
            '.date-presets button, .event-sorting label, .event-quick-filters button',
          )
          .all())
          expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          );
        await page.screenshot({
          path: `tests/test-results/event-filter-drawer-${width}.png`,
          animations: 'disabled',
        });
        // The modal keeps Tab inside the sheet: no focus escapes to the list.
        for (let step = 0; step < 24; step += 1)
          await page.keyboard.press('Tab');
        expect(
          await page.evaluate(() =>
            Boolean(
              document
                .querySelector('dialog.event-filter-drawer')
                ?.contains(document.activeElement),
            ),
          ),
        ).toBe(true);
        // Escape closes the sheet and focuses the access again.
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(filterAccess).toBeFocused();
        // Cancelling discards the draft and keeps the applied filter.
        await filterAccess.click();
        await sheet.getByLabel('Events suchen').fill('Synthetic draft');
        await sheet.getByRole('button', { name: 'Filter schließen' }).click();
        await expect(sheet).toHaveCount(0);
        await expect(page).toHaveURL(/q=browser/);
        await expect(filterAccess).toBeFocused();
        // One completion is one history entry: the applied filter is recorded
        // once, so a single back returns to exactly the previous URL.
        const appliedUrl = page.url();
        await filterAccess.click();
        await sheet.getByLabel('Events suchen').fill('Synthetic mobile filter');
        await sheet
          .getByRole('button', { name: 'Ergebnisse anzeigen' })
          .click();
        await expect(page).toHaveURL(/q=Synthetic\+mobile\+filter/);
        await expect(sheet).toHaveCount(0);
        await expect(filterAccess).toBeFocused();
        // Back restores the previous applied filter in the same sheet.
        await page.goBack();
        await expect(page).toHaveURL(appliedUrl);
        await filterAccess.click();
        await expect(sheet.getByLabel('Events suchen')).toHaveValue('browser');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await events.evaluate(
          (section) => section.scrollWidth <= section.clientWidth + 1,
        ),
      ).toBe(true);
    }
    // Both themes keep the column and the sheet intact.
    await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({
      path: 'tests/test-results/event-context-1280-dark.png',
      animations: 'disabled',
    });
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 740 });
      await filterAccess.click();
      const darkSheet = events.getByRole('dialog', { name: 'Eventfilter' });
      await expect(darkSheet).toBeVisible();
      await page.screenshot({
        path: `tests/test-results/event-filter-drawer-${width}-dark.png`,
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(darkSheet).toHaveCount(0);
      if (width === 390) {
        // BKP007.3: the draft rule holds in the dark sheet as well — mixed
        // choices keep the typed search and write no history entry.
        await filterAccess.click();
        const darkDraftUrl = page.url();
        await darkSheet
          .getByLabel('Events suchen')
          .fill('Synthetic dark draft');
        await darkSheet.getByRole('button', { name: 'Nächster Monat' }).click();
        await darkSheet.getByRole('radio', { name: /^Ohne Datum/ }).check();
        await expect(darkSheet.getByLabel('Events suchen')).toHaveValue(
          'Synthetic dark draft',
        );
        await expect(
          darkSheet.getByRole('radio', { name: /^Ohne Datum/ }),
        ).toBeChecked();
        expect(page.url()).toBe(darkDraftUrl);
        await page.screenshot({
          path: 'tests/test-results/event-filter-drawer-390-dark-draft.png',
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await expect(darkSheet).toHaveCount(0);
        await expect(filterAccess).toBeFocused();
        expect(page.url()).toBe(darkDraftUrl);
        await expectEventCard('16', 'Fr / Okt');
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: /modus aktivieren/ }).click();
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-theme',
      'dark',
    );
    // BKP007.3: the sheet is one draft. Mixing search, a preset and the undated
    // sort writes nothing, so a cancel is a real cancel and a completion is one
    // history entry. The column below stays the contrasted immediate writer.
    await page.setViewportSize({ width: 390, height: 844 });
    const appliedBeforeDraft = page.url();
    await filterAccess.click();
    const draftSheet = events.getByRole('dialog', { name: 'Eventfilter' });
    await draftSheet.getByLabel('Events suchen').fill('Synthetic mixed draft');
    await draftSheet.getByRole('button', { name: 'Dieser Monat' }).click();
    await draftSheet.getByRole('radio', { name: /^Ohne Datum/ }).check();
    // Neither the preset nor the sort resets the typed search, and the sheet
    // still mirrors the draft.
    await expect(draftSheet.getByLabel('Events suchen')).toHaveValue(
      'Synthetic mixed draft',
    );
    await expect(
      draftSheet.getByRole('radio', { name: /^Ohne Datum/ }),
    ).toBeChecked();
    expect(page.url()).toBe(appliedBeforeDraft);
    await page.keyboard.press('Escape');
    await expect(draftSheet).toHaveCount(0);
    await expect(filterAccess).toBeFocused();
    expect(page.url()).toBe(appliedBeforeDraft);
    // The results never listened to the draft.
    await expectEventCard('16', 'Fr / Okt');
    // Reopening starts from the applied filter, not from the abandoned draft.
    await filterAccess.click();
    await expect(draftSheet.getByLabel('Events suchen')).toHaveValue('browser');
    await expect(
      draftSheet.getByRole('radio', { name: /^Chronologisch/ }),
    ).toBeChecked();
    const mixedFetches: string[] = [];
    const watchMixed = (request: { url: () => string }) => {
      if (/\/api\/v1\/events(\?|$)/.test(request.url()))
        mixedFetches.push(request.url());
    };
    page.on('request', watchMixed);
    await draftSheet.getByLabel('Events suchen').fill('Synthetic mixed draft');
    await draftSheet.getByRole('button', { name: 'Dieser Monat' }).click();
    await draftSheet.getByRole('radio', { name: /^Ohne Datum/ }).check();
    await draftSheet
      .getByRole('button', { name: 'Ergebnisse anzeigen' })
      .click();
    await expect(page).toHaveURL(/undated=true/);
    const mixedUrl = new URL(page.url());
    expect(mixedUrl.searchParams.get('undated')).toBe('true');
    expect(mixedUrl.searchParams.get('from')).toBeNull();
    expect(mixedUrl.searchParams.get('to')).toBeNull();
    expect(mixedUrl.searchParams.get('q')).toBe('Synthetic mixed draft');
    await expect(draftSheet).toHaveCount(0);
    await expect(filterAccess).toBeFocused();
    await expect(events).toHaveAttribute('aria-busy', 'false');
    await expect(events.getByText('Keine Events gefunden.')).toBeVisible();
    page.off('request', watchMixed);
    // One completion, one result fetch.
    expect(mixedFetches).toHaveLength(1);
    expect(mixedFetches[0]).toContain('undated=true');
    // A single back returns to exactly the URL applied before the draft.
    await page.goBack();
    await expect(page).toHaveURL(appliedBeforeDraft);
    await expectEventCard('16', 'Fr / Okt');
    await expect(events).toHaveAttribute('aria-busy', 'false');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await events.evaluate(
        (section) => section.scrollWidth <= section.clientWidth + 1,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    // The column is the contrast: each preset/sort/quick-filter choice writes
    // exactly one history entry immediately — the draft rule is mobile only.
    // The quick preset is a single history entry with the tenant month.
    await events.getByRole('button', { name: 'Dieser Monat' }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);
    await expect(page).toHaveURL(/to=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveURL(/status=cancelled/);
    await expect(
      events.getByRole('button', { name: 'Dieser Monat' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(events.getByLabel('Filter von', { exact: true })).toHaveValue(
      '2026-10-16',
    );
    // The undated sort replaces the old checkbox and keeps `undated=true`.
    await events.getByRole('radio', { name: /^Ohne Datum/ }).check();
    await expect(page).toHaveURL(/undated=true/);
    await expect(page).not.toHaveURL(/from=/);
    await expect(events.getByText('Keine Events gefunden.')).toBeVisible();
    // „Anfragen“ is a quick filter outside the sort group: it keeps the range.
    await events.getByRole('button', { name: 'Dieser Monat' }).click();
    await expect(
      events.getByRole('button', { name: 'Dieser Monat' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await events
      .getByRole('group', { name: 'Schnellfilter' })
      .getByRole('button', { name: /^Anfragen/ })
      .click();
    await expect(page).toHaveURL(/status=inquiry/);
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);
    await expect(
      events
        .getByRole('group', { name: 'Schnellfilter' })
        .getByRole('button', { name: /^Anfragen/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      events.getByRole('group', { name: 'Sortieren' }).getByRole('radio'),
    ).toHaveCount(2);
    await expect(
      events.getByRole('button', { name: 'Dieser Monat' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Two history entries were added (preset, then quick filter); the earlier
    // custom range is still three steps back. Back returns through them.
    await page.goBack();
    await expect(page).not.toHaveURL(/status=inquiry/);
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);
    await expect(page).toHaveURL(/status=cancelled/);
    await page.goBack();
    await page.goBack();
    await expectEventCard('16', 'Fr / Okt');
    await page.reload();
    await expect(events.getByLabel('Filter von')).toHaveValue('2026-10-16');
    await expect(
      events.getByRole('combobox', { name: 'Filterstatus', exact: true }),
    ).toHaveValue('cancelled');
    // The month heading names its own count in muted text.
    await expect(
      events.getByRole('heading', { name: /Oktober 2026 · \d+ Events?/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Suche öffnen' }).click();
    await expect(page.getByLabel('Globale Suche')).toBeFocused();
    await page.getByLabel('Globale Suche').fill('Synthetic missing search');
    await page
      .getByRole('button', { name: 'Events und Kontakte suchen' })
      .click();
    await expect(events.getByText('Keine Events gefunden.')).toBeVisible();
    await expect(contacts.getByText('Keine Kontakte gefunden.')).toBeVisible();
    await page.getByLabel('Globale Suche').fill('browser');
    await page
      .getByRole('button', { name: 'Events und Kontakte suchen' })
      .click();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
    await events.getByRole('radio', { name: /^Ohne Datum/ }).check();
    await expect(events.getByText('Keine Events gefunden.')).toBeVisible();
    await contacts
      .getByRole('link', { name: 'Synthetic browser contact', exact: true })
      .click();
    const searchRecord = contacts.getByRole('region', {
      name: 'Kontakt-Details',
    });
    await expect(searchRecord).toBeVisible();
    await searchRecord
      .getByRole('link', { name: 'Synthetic browser event' })
      .click();
    await expect(
      events.getByRole('heading', {
        name: 'Event: Synthetic browser event',
        exact: true,
      }),
    ).toBeInViewport();
    await navigate('Einstellungen', 'Datenimport');
    await importPreview
      .getByLabel('Normalisierte Importdaten')
      .fill(JSON.stringify(fictionalImport()));
    await importPreview
      .getByRole('button', { name: 'Importvorschau prüfen' })
      .click();
    await expect(
      importPreview.getByText(
        'Vorschau geprüft. Es wurden keine Daten übernommen.',
      ),
    ).toBeVisible();
    await importPreview
      .getByRole('button', { name: 'Transaktionalen Probelauf starten' })
      .click();
    await expect(
      importPreview.getByText(
        'Transaktionaler Probelauf bestanden. Alle Änderungen wurden zurückgenommen.',
      ),
    ).toBeVisible();
    expect(
      (await pool.query('SELECT count(*) FROM import_records')).rows[0].count,
    ).toBe('0');
    await importPreview
      .getByLabel(
        'Mengen, Zuordnungen und Änderungen geprüft; diese Daten jetzt übernehmen',
      )
      .check();
    await importPreview
      .getByRole('button', { name: 'Geprüfte Daten übernehmen', exact: true })
      .click();
    await expect(
      importPreview.getByText(
        'Daten übernommen. Altzusagen benötigen weiterhin Ressourcenprüfung.',
      ),
    ).toBeVisible();
    const imported = page.getByRole('region', {
      name: 'Importbestand und Ressourcen-Prüfliste',
    });
    await expect(
      imported.getByText('Fictional Future Event', { exact: true }).first(),
    ).toBeVisible();
    await navigate('Kalender');
    await expect(calendar.getByRole('alert')).toContainText(
      '1 ungeprüfte Bestandszusagen',
    );
    await expect(calendar.getByText('Frei', { exact: true })).toHaveCount(0);
    await expect(calendar.getByText('Bestand ungeprüft').first()).toBeVisible();
    await navigate('Einstellungen', 'Datenimport');
    const reportDownload = page.waitForEvent('download');
    await imported
      .getByRole('button', { name: 'Privaten Prüfbericht herunterladen' })
      .click();
    const reportFile = await reportDownload;
    expect(reportFile.suggestedFilename()).toBe(
      'auftragskompass-importbericht.json',
    );
    const reconciliation = JSON.parse(
      await readFile((await reportFile.path())!, 'utf8'),
    );
    expect(reconciliation.pendingPromises).toBe(1);
    expect(reconciliation.counts.events).toBe(1);
    expect(reconciliation.mappings).toHaveLength(5);
    expect(
      (await pool.query('SELECT count(*) FROM import_promises')).rows[0].count,
    ).toBe('1');
    await imported.screenshot({
      path: 'tests/test-results/import-reconciliation.png',
    });
    await imported
      .getByRole('button', {
        name: 'Ressourcen prüfen: Fictional Future Event',
      })
      .click();
    const review = imported.getByRole('region', {
      name: 'Bestandszusage prüfen',
      exact: true,
    });
    await review
      .getByLabel('Eventbeginn', { exact: true })
      .fill('2030-10-27T18:00');
    await review
      .getByLabel('Eventende', { exact: true })
      .fill('2030-10-27T20:00');
    await review
      .getByLabel('FB2 · Einheit 1 zuweisen', { exact: true })
      .check();
    await review
      .getByLabel('Glamour-Paket · Einheit 1 zuweisen', { exact: true })
      .check();
    await review
      .getByRole('button', {
        name: 'Verfügbarkeit prüfen: FB2 · Einheit 1',
        exact: true,
      })
      .click();
    await expect(
      review.getByText('Verfügbarkeit aktualisiert.', { exact: true }),
    ).toBeVisible();
    await review.screenshot({
      path: 'tests/test-results/import-resource-review.png',
    });
    await review
      .getByRole('button', {
        name: 'Geprüfte Bestandszusage übernehmen',
        exact: true,
      })
      .click();
    await expect(
      imported.getByText(/Keine ungeprüften Bestandszusagen vorhanden/),
    ).toBeVisible();
    await navigate('Kalender');
    await expect(calendar.getByRole('alert')).toHaveCount(0);
    const importedEvent = (
      await pool.query(
        "SELECT id,status FROM events WHERE tenant_id=$1 AND name='Fictional Future Event'",
        [config.tenantId],
      )
    ).rows[0];
    expect(importedEvent.status).toBe('booked');
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM reservations WHERE tenant_id=$1 AND event_id=$2 AND state='booked'",
          [config.tenantId, importedEvent.id],
        )
      ).rows[0].count,
    ).toBe('2');
    await calendar.getByLabel('Kalenderdatum').fill('2030-10-27');
    await expect(
      calendar.getByRole('link', { name: 'Fictional Future Event' }).first(),
    ).toBeVisible();
    await calendar
      .getByRole('link', { name: 'Fictional Future Event' })
      .first()
      .click();
    await expect(
      events.getByRole('region', { name: 'Event-Details', exact: true }),
    ).toBeVisible();
    await expect(
      events
        .getByRole('region', { name: 'Event-Details', exact: true })
        .getByRole('heading', {
          name: 'Event: Fictional Future Event',
          exact: true,
        }),
    ).toBeVisible();

    if (mode === 'password') {
      await page.setViewportSize({ width: 390, height: 844 });
      const currentRecord = events.getByRole('region', {
        name: 'Event-Details',
        exact: true,
      });
      await currentRecord
        .getByRole('button', { name: 'Ressourcen', exact: true })
        .click();
      const dispositionStart = currentRecord.getByLabel('Eventbeginn', {
        exact: true,
      });
      await dispositionStart.fill('2030-10-27T16:30');
      await currentRecord
        .getByRole('button', { name: 'Notizen', exact: true })
        .click();
      await expect(dispositionStart).not.toBeVisible();
      await currentRecord
        .getByRole('button', { name: 'Ressourcen', exact: true })
        .click();
      await expect(dispositionStart).toHaveValue('2030-10-27T16:30');
      // BKP013.1: the documents sit in Dateien, the head stays visible there,
      // and the narrow frame keeps contact and place behind one disclosure.
      await expect(
        currentRecord.locator('details.event-aside'),
      ).not.toHaveAttribute('open', '');
      await currentRecord
        .getByRole('button', { name: 'Dateien', exact: true })
        .click();
      await expect(
        currentRecord.getByRole('region', { name: 'Angebote' }),
      ).toBeVisible();
      await expect(
        currentRecord.locator('.event-record-head h2'),
      ).toBeVisible();
      await currentRecord
        .getByRole('button', { name: 'Ressourcen', exact: true })
        .click();
      await expect(dispositionStart).toHaveValue('2030-10-27T16:30');
      await currentRecord
        .getByRole('heading', {
          name: 'Event: Fictional Future Event',
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      const recordNav = currentRecord.getByRole('navigation', {
        name: 'Bereiche des Events',
      });
      expect((await recordNav.boundingBox())!.height).toBeLessThan(100);
      await currentRecord
        .getByRole('heading', {
          name: 'Event: Fictional Future Event',
          exact: true,
        })
        .click({ trial: true });
      await audit('admin-mobile-record-resources');
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-record-resources.png',
        animations: 'disabled',
      });
      await currentRecord
        .getByRole('button', { name: 'Details', exact: true })
        .click();
      await audit('admin-mobile-record-overview');
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-record-overview.png',
        animations: 'disabled',
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    if (mode === 'password') {
      for (const [width, theme] of [
        [390, 'light'],
        [390, 'dark'],
        [1280, 'dark'],
        [1280, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await audit(`record-${width}-${theme}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `tests/test-results/record-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await navigate('Einstellungen', 'Datenexport');
    const exports = page.getByRole('region', {
      name: 'Datenexport',
      exact: true,
    });
    await expect(exports).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Einstellungen', exact: true })
        .getByRole('link', { name: 'Datenexport', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    for (const [label, file, content] of [
      [
        'Kontakte als CSV herunterladen',
        'contacts.csv',
        'Synthetic browser contact',
      ],
      [
        'Alle Events als CSV herunterladen',
        'events.csv',
        'Fictional Future Event',
      ],
      [
        'Produktkatalog als CSV herunterladen',
        'products.csv',
        'Synthetic browser product',
      ],
    ] as const) {
      const pending = page.waitForEvent('download');
      await exports.getByRole('link', { name: label, exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(file);
      expect(await readFile((await download.path())!, 'utf8')).toContain(
        content!,
      );
    }
    if (mode === 'password') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await audit('exports-desktop-light');
      await page.screenshot({
        path: 'tests/test-results/exports-desktop-light.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await audit('exports-desktop-dark');
      await page.screenshot({
        path: 'tests/test-results/exports-desktop-dark.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await audit('exports-mobile-dark');
      await page.screenshot({
        path: 'tests/test-results/exports-mobile-dark.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await audit('exports-mobile-light');
      await page.screenshot({
        path: 'tests/test-results/exports-mobile-light.png',
        fullPage: true,
        animations: 'disabled',
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await navigate('Einstellungen', 'Website-Formular');
    const inquiryPreview = page.getByRole('region', {
      name: 'Website-Formularvorschau',
    });
    await expect(
      inquiryPreview.getByLabel('Vorname *', { exact: true }),
    ).toBeVisible();
    const previewPosts: string[] = [];
    const recordPreviewPost = (request: import('@playwright/test').Request) => {
      if (request.method() !== 'GET') previewPosts.push(request.url());
    };
    page.on('request', recordPreviewPost);
    await inquiryPreview
      .getByRole('button', { name: 'Eingaben prüfen' })
      .click();
    await expect(inquiryPreview.getByRole('status')).toHaveCount(0);
    await inquiryPreview
      .getByLabel('Vorname *', { exact: true })
      .fill('Fictional');
    await inquiryPreview
      .getByLabel('Nachname *', { exact: true })
      .fill('Example');
    await inquiryPreview
      .getByLabel('E-Mail *', { exact: true })
      .fill('fictional@example.invalid');
    await inquiryPreview
      .getByLabel('Veranstaltungsdatum *', { exact: true })
      .fill('2030-10-27');
    await inquiryPreview
      .getByLabel('Gewünschtes Fotobox-Paket (optional)', { exact: true })
      .selectOption('easy-print-plus');
    await inquiryPreview
      .getByRole('button', { name: 'Eingaben prüfen' })
      .click();
    await expect(inquiryPreview.getByRole('status')).toContainText(
      'nichts versendet',
    );
    expect(previewPosts).toEqual([]);
    page.off('request', recordPreviewPost);
    // Navigating away drops the unsaved preview inputs.
    await navigate('Einstellungen', 'Datenexport');
    await navigate('Einstellungen', 'Website-Formular');
    await expect(
      inquiryPreview.getByLabel('Vorname *', { exact: true }),
    ).toHaveValue('');
    if (mode === 'password') {
      for (const [width, theme] of [
        [1280, 'light'],
        [1280, 'dark'],
        [390, 'dark'],
        [390, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        await audit(`inquiry-preview-${width}-${theme}`);
        await page.screenshot({
          path: `tests/test-results/inquiry-preview-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await navigate('Einstellungen', 'Kalender-Abos');
    const subscriptions = page.getByRole('region', {
      name: 'Kalender-Abos',
      exact: true,
    });
    await subscriptions
      .getByRole('button', { name: 'Abo erstellen', exact: true })
      .click();
    const calendarLink = subscriptions.getByLabel(
      'Neuer Kalenderlink (nur jetzt sichtbar)',
    );
    await expect(calendarLink).toBeVisible();
    const originalLink = await calendarLink.inputValue();
    const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const calendar = await anonymous.request.get(originalLink);
      expect(calendar.status()).toBe(200);
      expect(await calendar.text()).toContain('Fictional Future Event');
      expect(
        (await anonymous.request.get(origin + '/api/v1/events')).status(),
      ).toBe(401);
      await subscriptions
        .getByRole('button', { name: 'Link erneuern', exact: true })
        .click();
      await expect(calendarLink).not.toHaveValue(originalLink);
      const rotated = await calendarLink.inputValue();
      expect((await anonymous.request.get(originalLink)).status()).toBe(404);
      expect((await anonymous.request.get(rotated)).status()).toBe(200);
      await subscriptions
        .getByRole('button', { name: 'Abo widerrufen', exact: true })
        .click();
      await expect(
        subscriptions.getByText('Keine aktiven Kalender-Abos.'),
      ).toBeVisible();
      expect((await anonymous.request.get(rotated)).status()).toBe(404);
    } finally {
      await anonymous.close();
    }

    if (mode === 'password') {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      await expect(
        page.getByRole('button', { name: /Navigation (ein|aus)klappen/ }),
      ).toBeHidden();
      await page.getByRole('button', { name: 'Suche öffnen' }).click();
      const search = page.getByLabel('Globale Suche');
      await expect(search).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      expect(
        await search.evaluate((el) =>
          parseFloat(getComputedStyle(el).outlineWidth),
        ),
      ).toBeGreaterThanOrEqual(2);
      await search.fill('Synthetic mobile draft');
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Suche öffnen' }),
      ).toBeFocused();
      await page.getByRole('button', { name: 'Suche öffnen' }).click();
      await expect(page.getByLabel('Globale Suche')).toHaveValue(
        'Synthetic mobile draft',
      );
      await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'tests/test-results/admin-mobile.png' });
      const menuButton = page.getByRole('button', { name: 'Menü öffnen' });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await menuButton.click();
      const menu = page.getByRole('dialog', { name: 'Menü', exact: true });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole('button', { name: 'Abmelden', exact: true }),
      ).toBeVisible();
      await expect(
        menu.getByRole('link', { name: 'Ressourcen', exact: true }),
      ).toHaveCount(0);
      await expect(
        menu.getByRole('link', { name: 'Produkte', exact: true }),
      ).toHaveCount(0);
      await expect(menu).toHaveCSS('opacity', '1');
      expect(
        await menu.evaluate((el) =>
          getComputedStyle(el).transitionDuration.split(',').map(parseFloat),
        ),
      ).toEqual([0.22, 0.22]);
      await audit('mobile-menu-light');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await menuButton.click();
      await expect(menu).toHaveCSS('opacity', '1');
      await audit('mobile-menu-dark');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await menuButton.click();
      await expect(menu).toHaveCSS('opacity', '1');

      await page.screenshot({
        path: 'tests/test-results/admin-mobile-menu.png',
      });
      await page.keyboard.press('Escape');
      await expect(menu).not.toBeVisible();
      await expect(menuButton).toBeFocused();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(menuButton).toHaveCSS('transition-duration', '0s');
      await page.keyboard.down('Space');
      await expect(menuButton).toHaveCSS('transform', 'none');
      await page.keyboard.up('Space');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('transition-duration', '0s');
      await expect(menu).toHaveCSS('transform', 'none');
      await page.keyboard.press('Escape');
      await expect(menuButton).toBeFocused();
      await menuButton.hover();
      await page.mouse.down();
      await expect(menuButton).toHaveCSS('transform', 'none');
      await page.mouse.up();
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('transition-duration', '0s');
      await expect(menu).toHaveCSS('transform', 'none');
      await page.keyboard.press('Escape');
      await expect(menuButton).toBeFocused();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await menuButton.press('Enter');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('transition-duration', '0s');
      await page.keyboard.press('Escape');
      await expect(menuButton).toBeFocused();
      await menuButton.click();
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(menu).not.toBeVisible();
      await expect(page.getByLabel('Globale Suche')).toBeFocused();
      const sidebar = page.getByRole('complementary', {
        name: 'Arbeitsbereiche',
      });
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width: 1280, height: 420 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        const logout = sidebar.getByRole('button', {
          name: 'Abmelden',
          exact: true,
        });
        await logout.scrollIntoViewIfNeeded();
        await expect(logout).toBeInViewport();
        await logout.click({ trial: true });
        await page.screenshot({
          path: `tests/test-results/sidebar-short-${theme}.png`,
          animations: 'disabled',
        });
        const firstLink = sidebar.getByRole('link', {
          name: 'Events',
          exact: true,
        });
        await firstLink.scrollIntoViewIfNeeded();
        await expect(firstLink).toBeInViewport();
        await firstLink.click({ trial: true });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: 'tests/test-results/menu-resize-desktop.png',
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await menuButton.click();
      await expect(menu).toBeVisible();
      await page.screenshot({
        path: 'tests/test-results/menu-resize-mobile.png',
        fullPage: false,
        animations: 'disabled',
      });
      await page.mouse.click(380, 400);
      await expect(menu).not.toBeVisible();
      await menuButton.click();
      await menu.getByRole('link', { name: 'Events', exact: true }).click();
      await expect(events).toBeVisible();
      // BKP007: the narrow frame starts with the compact filter access, so the
      // list is the first thing on screen.
      await expect(
        events.getByRole('button', { name: /^Filter(,|$)/ }),
      ).toBeVisible();
      await expect(events.getByLabel('Events suchen')).toHaveCount(0);
      await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
      await expect(contacts).not.toBeVisible();
      await expect(calendar).not.toBeVisible();
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-events.png',
      });
      await page
        .getByRole('button', { name: /modus aktivieren/ })
        .scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-dark.png',
        animations: 'disabled',
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: 'tests/test-results/admin-desktop-dark.png',
        animations: 'disabled',
      });
      await page.getByRole('button', { name: /modus aktivieren/ }).click();
      await page.screenshot({ path: 'tests/test-results/admin-desktop.png' });
    }
    if (mode === 'password') {
      await navigate('Einstellungen', 'Konto & Zugriff');
      const change = page.getByRole('region', {
        name: 'Eigenes Passwort',
        exact: true,
      });
      const next = 'Fictional browser replacement password';
      await change
        .getByLabel('Aktuelles Passwort', { exact: true })
        .fill('Fictional password 123!');
      await change.getByLabel('Neues Passwort', { exact: true }).fill(next);
      await change
        .getByLabel('Neues Passwort wiederholen', { exact: true })
        .fill(next);
      await change
        .getByRole('button', { name: 'Passwort ändern', exact: true })
        .click();
      await expect(
        page.getByText('Passwort geändert. Bitte erneut anmelden.', {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByLabel('E-Mail oder Benutzername').fill('fictional.owner');
      await page
        .getByLabel('Passwort', { exact: true })
        .fill('Fictional password 123!');
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
      await expect(page.getByText(/Zugangsdaten prüfen/)).toBeVisible();
      await page.getByLabel('Passwort', { exact: true }).fill(next);
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Abmelden', exact: true }),
      ).toBeVisible();
    }
    await audit('signed-in-final');
    const controls = await page
      .locator('.menu-trigger')
      .getAttribute('aria-controls');
    expect(await page.locator(`[id="${controls}"]`).count()).toBe(1);
    if (mode === 'password') {
      await pool.query(
        "INSERT INTO contacts(tenant_id,id,kind,name,contact_person,street,postal_code,city,country,email,phone,mobile,phone_key,mobile_key,state) SELECT $1::uuid,gen_random_uuid(),'private','Fictional browser volume '||n,'','','','','DE','','','','','','active' FROM generate_series(1,500) AS n",
        [config.tenantId],
      );
      await pool.query(
        "INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html) SELECT $1::uuid,gen_random_uuid(),'Fictional browser volume '||n,'inquiry','Fictional browser load fixture',DATE '2030-01-01','UTC','Fictional browser load fixture','' FROM generate_series(1,500) AS n",
        [config.tenantId],
      );
      const measurements = [];
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const [route, label, role, action] of [
          ['events', 'Events', 'link', /Fictional browser volume/],
          [
            'contacts',
            'Kontakte',
            'button',
            /^Kontakt bearbeiten: Fictional browser volume /,
          ],
        ] as const) {
          // A hash-only navigation would reuse the previous performance time origin.
          await page.goto('about:blank');
          await page.goto(origin + '/?q=Fictional+browser+volume#' + route);
          const list = page.getByRole('region', { name: label, exact: true });
          await expect(list).toHaveAttribute('aria-busy', 'false');
          const actions = list.getByRole(role, { name: action });
          await expect(actions).toHaveCount(500);
          await actions.first().click({ trial: true });
          const readyMs = await page.evaluate(
            () =>
              new Promise<number>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve(performance.now())),
                ),
              ),
          );
          expect(readyMs).toBeLessThan(2000);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width + 1);
          measurements.push({
            route,
            width,
            records: 500,
            readyMs: Math.ceil(readyMs),
          });
        }
      }
      const volumeReport = test
        .info()
        .outputPath('fictional-browser-volume.json');
      await writeFile(volumeReport, JSON.stringify(measurements, null, 2));
      await test.info().attach('fictional-browser-volume', {
        contentType: 'application/json',
        path: volumeReport,
      });
    }
    // Synthetic local intake fixture; no public endpoint or real booking is used.
    const receivedAt = new Date('2030-10-26T10:00:00.000Z');
    const websiteInquiryId = randomUUID();
    const owner = (await accessRepository(pool, config.tenantId).list()).find(
      (row) => row.email === 'synthetic@example.invalid',
    )!.userId!;
    await stageWebsiteInquiry(
      pool,
      config.tenantId,
      owner,
      {
        id: websiteInquiryId,
        receivedAt: receivedAt.toISOString(),
        expiresAt: new Date(receivedAt.getTime() + 86400000).toISOString(),
        submission: {
          formId: 'fotobox-bw-main',
          formVersion: 1,
          fields: {
            firstName: 'Fictional Website',
            lastName: 'Browser',
            email: 'fictional.website@example.invalid',
            eventDate: '2031-10-27',
            phone: '+49 555 02000',
            location: 'Fictional Website Hall',
            package: 'easy-print-plus',
            comment:
              'Fictional original <script>text</script>\n' + 'x'.repeat(300),
          },
        },
        privacyNotice: inquiryFormV1.privacyNotice,
        privacyUrl: inquiryFormV1.privacyUrl,
      },
      receivedAt,
    );
    // BKP004.2: the diagnosis of technical delivery backlog lives in settings,
    // not as a second queue under Events.
    await navigate('Einstellungen', 'Website-Eingänge');
    const websiteInbox = page.getByRole('region', {
      name: 'Website-Eingänge (Diagnose)',
    });
    await expect(
      websiteInbox.getByRole('heading', {
        level: 2,
        name: 'Website-Eingänge (Diagnose)',
      }),
    ).toBeVisible();
    await expect(websiteInbox.getByText(/Technische Diagnose/)).toBeVisible();
    // The unresolved entry stays visible with its statement of the backlog.
    const inboxEntry = websiteInbox.locator('details.website-inquiry');
    await expect(inboxEntry).toHaveCount(1);
    await expect(
      websiteInbox.getByText(/nicht automatisch angelegt/).first(),
    ).toBeVisible();
    await inboxEntry.locator('summary').focus();
    await inboxEntry.locator('summary').press('Enter');
    const country = inboxEntry.getByLabel(
      'Land für einen neuen Kontakt (2-Buchstaben-Code)',
    );
    // The country stays an operator decision; nothing is prefilled.
    await expect(country).toHaveValue('');
    await expect(inboxEntry.locator('dt')).toHaveCount(8);
    if (mode === 'password') {
      for (const [width, theme] of [
        [1280, 'light'],
        [1280, 'dark'],
        [390, 'dark'],
        [390, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        await page.evaluate(() => window.scrollTo(0, 0));
        await audit(`website-diagnosis-${width}-${theme}`);
        await page.screenshot({
          path: `tests/test-results/website-diagnosis-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await inboxEntry.locator('summary').focus();
    await inboxEntry.locator('summary').press('Space');
    await expect(inboxEntry).not.toHaveAttribute('open', '');
    await inboxEntry.locator('summary').press('Enter');
    await expect(country).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await inboxEntry
      .getByRole('button', { name: 'Als Option übernehmen' })
      .click();
    // BKP002: a valid entry without an operator country becomes a contactless
    // Option at once; "Kontakt noch offen" is a normal open state, not an
    // exception, and the untouched country field stays an operator decision.
    await expect(websiteInbox.getByText(/Kontakt noch offen/)).toBeVisible();
    await expect(inboxEntry).toHaveCount(0);
    await expect(
      websiteInbox.getByText(/Keine offenen Ausnahmen/),
    ).toBeVisible();
    // A second identical recovery is idempotent: same assignment, and the
    // receipt contact stays null even though the event exists.
    const recovered = (
      await pool.query<{ eventId: string; contactId: string | null }>(
        'SELECT event_id AS "eventId", contact_id AS "contactId" FROM website_inquiries WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, websiteInquiryId],
      )
    ).rows[0]!;
    expect(recovered.contactId).toBeNull();
    const repeat = await importStagedWebsiteInquiry(
      pool,
      config.tenantId,
      owner,
      websiteInquiryId,
      {},
    );
    expect(repeat).toEqual({
      status: 'duplicate',
      eventId: recovered.eventId,
      contactId: recovered.contactId,
    });
    // The later contact is created before the list reload so the normal event
    // editor can offer it; the assignment itself stays a normal event edit.
    const laterContact = randomUUID();
    await pool.query(
      "INSERT INTO contacts(tenant_id,id,kind,name,contact_person,street,postal_code,city,country,email,phone,mobile,phone_key,mobile_key,state) VALUES ($1::uuid,$2::uuid,'private','Fictional later contact','','','','','DE','fictional.later@example.invalid','','','','','active')",
      [config.tenantId, laterContact],
    );
    // The option itself is a normal event row; its origin is a quiet label.
    await navigate('Events');
    await page.goto(origin + '/?q=Fictional%20Website%20Browser#events');
    const eventList = page.getByRole('region', {
      name: 'Events',
      exact: true,
    });
    const websiteOptionLink = eventList.getByRole('link', {
      name: /Fictional Website Browser/,
    });
    await expect(websiteOptionLink).toBeVisible();
    const originLabel = eventList.locator('.event-source-quiet');
    await expect(originLabel).toHaveCount(1);
    await expect(originLabel).toHaveText('Website');
    // No exceptions queue survives under Events.
    await expect(eventList.getByText('Website-Eingänge')).toHaveCount(0);
    if (mode === 'password') {
      for (const [width, theme] of [
        [1280, 'light'],
        [1280, 'dark'],
        [390, 'dark'],
        [390, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        await page.evaluate(() => window.scrollTo(0, 0));
        await audit(`website-option-list-${width}-${theme}`);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await websiteOptionLink.click();
    const websiteRecord = page.getByRole('region', {
      name: 'Event-Details',
      exact: true,
    });
    await expect(
      websiteRecord.getByRole('heading', {
        name: 'Event: Fictional Website Browser',
        exact: true,
      }),
    ).toBeVisible();
    // A missing link is the normal open state, not an error or a blocked step.
    await expect(
      websiteRecord.getByText('Kontakt noch offen.', { exact: true }),
    ).toBeVisible();
    // The recovered website entry is an Option, never a booking.
    await expect(websiteRecord.getByLabel('Status des Events')).toHaveValue(
      'option',
    );
    expect(
      (
        await pool.query(
          'SELECT count(*) FROM reservations r JOIN events e ON e.id=r.event_id AND e.tenant_id=r.tenant_id WHERE e.source=$1',
          ['Website: fotobox-bw-main (v1)'],
        )
      ).rows[0].count,
    ).toBe('0');
    await audit('website-option-event');
    await websiteRecord
      .getByRole('button', { name: 'Logbuch', exact: true })
      .click();
    await expect(
      websiteRecord.getByRole('listitem').filter({
        hasText: 'Website-Anfrage empfangen: fotobox-bw-main (v1).',
      }),
    ).toBeVisible();
    await websiteRecord
      .getByRole('button', { name: 'Details', exact: true })
      .click();
    const original = websiteRecord.locator('details.website-inquiry');
    await expect(original.locator('summary')).toHaveText('Website-Anfrage');
    await expect(original).not.toHaveAttribute('open', '');
    await original.locator('summary').click();
    await expect(
      original.getByText('Fictional Website', { exact: true }),
    ).toBeVisible();
    await expect(original.locator('dt')).toHaveCount(8);
    await expect(
      original.getByText(/Fictional original <script>text/),
    ).toBeVisible();
    await expect(original.locator('script')).toHaveCount(0);
    await expect(
      original.getByText('easy print+ (400 Ausdrucke, Drucklayout)', {
        exact: true,
      }),
    ).toBeVisible();
    if (mode === 'password') {
      for (const [width, theme] of [
        [1280, 'light'],
        [1280, 'dark'],
        [390, 'dark'],
        [390, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);
        await audit(`website-original-${width}-${theme}`);
        await page.screenshot({
          path: `tests/test-results/website-original-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    // The later contact arrives through the normal event edit; status and
    // version stay as they are, and the stored receipt keeps its null contact.
    const beforeAssignment = (
      await pool.query<{ version: number }>(
        'SELECT version FROM events WHERE tenant_id=$1 AND id=$2',
        [config.tenantId, recovered.eventId],
      )
    ).rows[0]!;
    await websiteRecord
      .getByRole('button', {
        name: 'Stammdaten bearbeiten: Fictional Website Browser',
      })
      .click();
    // BKP012.2: the main contact is picked through the same search the create
    // dialog uses. The stored assignment stays a deliberate edit.
    const editorContact = page.getByRole('group', { name: 'Hauptkontakt' });
    const editorContactSearch = editorContact.getByLabel('Kunde suchen');
    await editorContactSearch.fill('Fictional later contact');
    const laterContactHit = editorContact.getByRole('button', {
      name: /Fictional later contact/,
    });
    await expect(laterContactHit).toBeEnabled();
    await audit('event-editor-contact-picker');
    // The contact form is a view inside the editor: no backdrop, no dialog
    // role, and the filled event draft stays mounted behind it.
    await editorContact
      .getByRole('button', { name: 'Neuen Kunden anlegen' })
      .click();
    const editorContactForm = page.locator('.contact-dialog-inline');
    await expect(
      editorContactForm.getByRole('heading', { name: 'Kontakt anlegen' }),
    ).toBeVisible();
    await expect(page.locator('#event-editor')).toBeHidden();
    expect(
      await editorContactForm.evaluate((element) =>
        element.closest('[role="dialog"]'),
      ),
    ).toBeNull();
    await audit('event-editor-inline-contact');
    await editorContactForm
      .getByRole('button', { name: 'Kontaktanlage schließen' })
      .click();
    await expect(editorContactForm).toHaveCount(0);
    await expect(page.locator('#event-editor')).toBeVisible();
    await expect(editorContactSearch).toBeFocused();
    await expect(
      page.locator('#event-editor').getByLabel('Eventname', { exact: true }),
    ).toHaveValue('Fictional Website Browser');
    // BKP012.2b: the inline contact view is a real surface of the editor, so it
    // is measured at the three frame widths in both themes. Every cycle opens
    // the view, leaves it, and re-reads the untouched event draft.
    if (mode === 'password') {
      for (const [width, theme] of [
        [1280, 'light'],
        [1280, 'dark'],
        [390, 'dark'],
        [390, 'light'],
        [320, 'dark'],
        [320, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: 844 });
        const toggle = page.getByRole('button', { name: /modus aktivieren/ });
        if (
          (await toggle.getAttribute('aria-pressed')) !==
          String(theme === 'dark')
        )
          await toggle.click();
        await expect(toggle).toHaveAttribute(
          'aria-pressed',
          String(theme === 'dark'),
        );
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await editorContact
          .getByRole('button', { name: 'Neuen Kunden anlegen' })
          .click();
        const narrowContactView = page.locator('.contact-dialog-inline');
        await expect(
          narrowContactView.getByRole('heading', { name: 'Kontakt anlegen' }),
        ).toBeVisible();
        // Neither the view nor the document scrolls sideways in the frame.
        expect(
          await narrowContactView.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        // Every field and button of the view stays inside the frame and keeps
        // its whole content: nothing is cut off at the narrow widths.
        const viewControls = narrowContactView.locator('input, select, button');
        const viewControlCount = await viewControls.count();
        expect(viewControlCount).toBeGreaterThan(0);
        for (let index = 0; index < viewControlCount; index += 1) {
          const viewControl = viewControls.nth(index);
          const box = (await viewControl.boundingBox())!;
          expect(box.width).toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          expect(
            await viewControl.evaluate(
              (element) => element.scrollWidth <= element.clientWidth + 1,
            ),
          ).toBe(true);
        }
        if (width === 320)
          await audit(`event-editor-contact-${width}-${theme}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `tests/test-results/event-editor-contact-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
        await narrowContactView
          .getByRole('button', { name: 'Kontaktanlage schließen' })
          .click();
        await expect(narrowContactView).toHaveCount(0);
        await expect(page.locator('#event-editor')).toBeVisible();
        await expect(
          page
            .locator('#event-editor')
            .getByLabel('Eventname', { exact: true }),
        ).toHaveValue('Fictional Website Browser');
        await expect(editorContactSearch).toHaveValue(
          'Fictional later contact',
        );
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await laterContactHit.click();
    await expect(
      editorContact.getByText(/Kunde: Fictional later contact/),
    ).toBeVisible();
    await page
      .locator('#event-editor')
      .getByRole('button', { name: 'Event speichern', exact: true })
      .click();
    await expect(
      page.getByText('Event gespeichert.', { exact: true }),
    ).toBeVisible();
    const afterAssignment = (
      await pool.query<{
        version: number;
        status: string;
        contactId: string | null;
      }>(
        'SELECT e.version, e.status, (SELECT c.contact_id FROM event_contacts c WHERE c.tenant_id=e.tenant_id AND c.event_id=e.id AND c.role=$3) AS "contactId" FROM events e WHERE e.tenant_id=$1 AND e.id=$2',
        [config.tenantId, recovered.eventId, 'primary'],
      )
    ).rows[0]!;
    expect(afterAssignment).toMatchObject({
      status: 'option',
      contactId: laterContact,
    });
    expect(afterAssignment.version).toBe(beforeAssignment.version + 1);
    expect(
      (
        await pool.query<{ contactId: string | null }>(
          'SELECT contact_id AS "contactId" FROM website_inquiries WHERE tenant_id=$1 AND id=$2',
          [config.tenantId, websiteInquiryId],
        )
      ).rows[0]!.contactId,
    ).toBeNull();
    await page.goto(
      origin + '/?q=Fictional%20Website%20Browser#event-' + recovered.eventId,
    );
    await expect(
      websiteRecord.getByRole('heading', {
        name: 'Event: Fictional Website Browser',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      websiteRecord.getByText('Hauptkontakt: Fictional later contact'),
    ).toBeVisible();
    await expect(
      websiteRecord.getByText('Kontakt noch offen.', { exact: true }),
    ).toHaveCount(0);
    await audit('website-option-contact');

    // H031: the brand is a real fragment link. It must not reload the
    // document, and a dirty event detail asks before discarding its input.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      document.documentElement.dataset.fictionalH031 = 'kept';
    });
    const desktopBrand = page.getByRole('link', {
      name: 'AuftragsKompass – zur Eventübersicht',
    });
    await expect(desktopBrand).toBeVisible();
    await expect(desktopBrand).toHaveAttribute('href', '#events');
    const detailStatus = page.getByLabel('Status des Events');
    await detailStatus.selectOption('option');
    let homePrompt = '';
    page.once('dialog', (dialog) => {
      homePrompt = dialog.message();
      void dialog.dismiss();
    });
    await desktopBrand.click();
    await expect(page).toHaveURL(/#event-/);
    await expect(detailStatus).toHaveValue('option');
    expect(homePrompt).toContain('Ungespeicherte Eingaben verwerfen');
    page.once('dialog', (dialog) => void dialog.accept());
    await desktopBrand.click();
    await expect(page).toHaveURL(/#events$/);
    expect(
      await page.evaluate(() => document.documentElement.dataset.fictionalH031),
    ).toBe('kept');
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Kalender', exact: true })
      .click();
    await expect(page).toHaveURL(/#calendar$/);
    await desktopBrand.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(desktopBrand).toBeFocused();
    expect(
      await desktopBrand.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#events$/);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTitle = page.getByRole('link', {
      name: 'Kalender – zur Eventübersicht',
    });
    await page.evaluate(() => {
      window.location.hash = 'calendar';
    });
    await expect(page).toHaveURL(/#calendar$/);
    await expect(mobileTitle).toBeVisible();
    await expect(page.getByLabel('Arbeitsbereiche')).toBeHidden();
    await mobileTitle.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#events$/);
    await page.getByRole('button', { name: 'Menü öffnen' }).click();
    const menu = page.getByRole('dialog', { name: 'Menü' });
    const mobileBrand = menu.getByRole('link', {
      name: 'AuftragsKompass – zur Eventübersicht',
    });
    await expect(mobileBrand).toBeVisible();
    await mobileBrand.click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/#events$/);
    expect(
      await page.evaluate(() => document.documentElement.dataset.fictionalH031),
    ).toBe('kept');
    await page.setViewportSize({ width: 1280, height: 720 });

    await sidebar
      .getByRole('button', { name: 'Navigation einklappen' })
      .click();
    await page.route('**/auth/logout', (route) =>
      route.fulfill({ status: 500, body: '' }),
    );
    const sidebarLogout = sidebar.getByRole('button', {
      name: 'Abmelden',
      exact: true,
    });
    await sidebarLogout.click();
    const logoutFailure = sidebar.getByText(/Abmelden fehlgeschlagen/);
    await expect(logoutFailure).toBeVisible();
    await expect(logoutFailure).toHaveAttribute('role', 'status');
    await expect(
      sidebar.getByText('synthetic@example.invalid', { exact: true }),
    ).toBeHidden();
    await page.unroute('**/auth/logout');
    await sidebarLogout.click();
    await expect(page.getByText('Abgemeldet')).toBeVisible();
    expect((await pool.query('SELECT * FROM sessions')).rowCount).toBe(0);
    const violations = () =>
      page.evaluate(
        () => document.documentElement.dataset.fictionalCspViolations ?? '',
      );
    expect(policyErrors).toEqual([]);
    expect(await violations()).toBe('');
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent =
        "document.documentElement.dataset.fictionalInlineExecuted = 'yes'";
      document.head.append(script);
    });
    await expect.poll(violations).toContain('script-src-elem');
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.fictionalInlineExecuted,
      ),
    ).toBeUndefined();
    const framingPage = await context.newPage();
    const refused = framingPage.waitForEvent('console', {
      predicate: (message) =>
        /frame-ancestors|X-Frame-Options/.test(message.text()),
    });
    await framingPage.setContent(
      `<iframe title="Fictional framing probe" src="${origin}"></iframe>`,
    );
    await refused;
    expect(
      framingPage.frames().some((frame) => frame.url() === origin + '/'),
    ).toBe(false);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    await pool.end();
    await container.stop();
    await rm(dir, { recursive: true, force: true });
  }
}
for (const mode of ['google', 'password'] as const) {
  test(`HTTPS browser signs in with ${mode}, receives HttpOnly cookie and signs out`, async ({
    browser,
  }) => signInScenario(browser, mode));
}

for (const mode of ['google', 'password'] as const) {
  test(`Dateien responsive accessibility with ${mode} authentication`, async ({
    browser,
  }) => signInScenario(browser, mode, true));
}
