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
import { syntheticGoogle } from '../helpers/oidc.js';
async function signInScenario(browser: Browser, mode: 'google' | 'password') {
  test.setTimeout(180000);
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
    registerDocumentRoutes(app, pool, config.tenantId, {
      origin,
      store: {
        async put() {},
        async read() {
          throw new Error('synthetic');
        },
        async remove() {},
      },
      render: async () => Buffer.from('%PDF-1.4 synthetic'),
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
    const auditFailures: {
      state: string;
      ids: string[];
      targets: unknown[];
    }[] = [];
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
      if (violations.length)
        auditFailures.push({
          state,
          ids: violations.map((v) => v.id),
          targets: violations.map((v) => v.targets),
        });
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
    const pdfLink = files.getByRole('link', {
      name: 'Rechnung RE-2031-0001 als PDF öffnen',
    });
    await pdfLink.focus();
    expect(
      await pdfLink.evaluate((element) => element === document.activeElement),
    ).toBe(true);
    for (const [width, height] of [
      [1280, 720],
      [390, 844],
      [320, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
    }
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
    // A plain click is ordinary SPA navigation and opens the event details.
    await eventLink.click();
    await expect(page).toHaveURL(
      /#event-33333333-3333-4333-8333-333333333333$/,
    );
    await expect(
      page.locator('#event-33333333-3333-4333-8333-333333333333'),
    ).toBeVisible();
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
    ).toContainText('FB1 – 1 Stück – Gesperrt');
    const blocks = resources.getByRole('region', {
      name: 'Zeitweise Ressourcensperren',
    });
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
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
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
      await expect(
        settingsNavigation.getByRole('link', {
          name: 'Ressourcen',
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await settingsNavigation.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const resourcesTimeOrigin = await page.evaluate(
      () => performance.timeOrigin,
    );
    await page.evaluate(() => {
      window.location.hash = 'resources';
    });
    await expect(page).toHaveURL(/#resources$/);
    await expect(resources).toBeVisible();
    await expect(
      settingsNavigation.getByRole('link', {
        name: 'Ressourcen',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      resourcesTimeOrigin,
    );
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
    await products
      .getByLabel('Produktname', { exact: true })
      .fill('Synthetic browser product');
    await products.getByLabel('Preis in Euro').fill('19,99');
    await products.getByRole('button', { name: 'Produkt speichern' }).click();
    await expect(
      products.getByText('Synthetic browser product – 19,99 € Brutto', {
        exact: true,
      }),
    ).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await products.evaluate(
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
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const productsTimeOrigin = await page.evaluate(
      () => performance.timeOrigin,
    );
    await page.evaluate(() => {
      window.location.hash = 'products';
    });
    await expect(page).toHaveURL(/#products$/);
    await expect(products).toBeVisible();
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
    await products
      .getByLabel('Produktname', { exact: true })
      .fill('Synthetic draft product');
    await settingsNavigation
      .getByRole('link', { name: 'Ressourcen', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings-resources$/);
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
    const mobileProductsLink = settingsNavigation.getByRole('link', {
      name: 'Produkte',
      exact: true,
    });
    await mobileProductsLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#settings-products$/);
    await expect(mobileProductsLink).toBeFocused();
    await expect(products).toBeVisible();
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
    const contactEvents = contacts.getByRole('button', {
      name: 'Events anzeigen: Synthetic browser contact',
    });
    for (const [action, title] of [
      [contactEdit, 'Kontakt bearbeiten'],
      [contactEvents, 'Events anzeigen'],
    ] as const) {
      await expect(action).toHaveAttribute('title', title);
      await expect(action).toHaveText('');
      const actionBox = (await action.boundingBox())!;
      expect(actionBox.width).toBeGreaterThanOrEqual(44);
      expect(actionBox.height).toBeGreaterThanOrEqual(44);
    }
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
      contacts.getByText('Synthetic browser contact – Archiviert'),
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
    await expect(
      events
        .getByLabel('Kunde')
        .getByRole('option', { name: 'Synthetic browser contact' }),
    ).toBeEnabled();
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
    await events
      .getByLabel('Kunde')
      .selectOption({ label: 'Synthetic browser contact' });
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
    await expect(
      events.getByText(/Synthetic browser event – 16\. Oktober 2026, /),
    ).toBeVisible();
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
    await record
      .getByRole('button', { name: 'Übersicht', exact: true })
      .click();
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
    await navigate('Kontakte');
    await contacts
      .getByRole('button', {
        name: 'Events anzeigen: Synthetic browser contact',
      })
      .click();
    await expect(
      contacts.getByRole('link', { name: 'Synthetic browser event' }),
    ).toBeVisible();
    await navigate('Events');
    await events
      .getByRole('button', {
        name: 'Event bearbeiten: Synthetic browser event',
      })
      .click();
    await events.getByLabel('Eventstatus').selectOption('cancelled');
    await events.getByRole('button', { name: 'Event speichern' }).click();
    await expect(
      events.getByText(/Synthetic browser event – 16\. Oktober 2026, /),
    ).toBeVisible();
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
    await expect(
      events.getByText(/Synthetic browser event – 16\. November 2026, /),
    ).toBeVisible();
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
    await expect(
      events.getByText(/Synthetic browser event – 16\. Oktober 2026, /),
    ).toBeVisible();
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
    // H037: the list names the stored start time explicitly.
    await expect(
      events.getByText(/Fictional resource booking – 20\. Oktober 2030, /),
    ).toBeAttached();
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
    await events.getByText('Filter', { exact: true }).click();
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
    await expect(
      events.getByText(/Synthetic browser event – 16\. Oktober 2026, /),
    ).toBeVisible();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
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
      // Every preset and sort row keeps a 44px target.
      for (const target of await events
        .locator(
          '.date-presets button, .event-sorting label, .event-quick-filters button',
        )
        .all())
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
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
    await expect(
      events.getByText(/Synthetic browser event – 16\. Oktober 2026, /),
    ).toBeVisible();
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
      .getByRole('button', {
        name: 'Events anzeigen: Synthetic browser contact',
      })
      .click();
    await contacts
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
        .getByRole('button', { name: 'Übersicht', exact: true })
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
      const filters = events.locator('.event-filters');
      if ((await filters.getAttribute('open')) !== null)
        await filters.locator('summary').click();
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
    expect(auditFailures).toEqual([]);
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
      .getByRole('button', { name: 'Übersicht', exact: true })
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
    await page.getByLabel('Hauptkontakt').selectOption(laterContact);
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
    await page.getByRole('link', { name: 'Kalender', exact: true }).click();
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
