import AxeBuilder from '@axe-core/playwright';
import { registerCalendarFeedRoutes } from '../../packages/core/src/calendar-feeds.js';
import { registerImportRoutes } from '../../packages/core/src/import-routes.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
import { expect, test, type Browser } from '@playwright/test';
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
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { registerAccessRoutes } from '../../packages/core/src/access-routes.js';
import { registerEventRoutes } from '../../packages/core/src/events.js';
import { registerLocationRoutes } from '../../packages/core/src/locations.js';
import { registerContactRoutes } from '../../packages/core/src/contacts.js';
import { registerProductRoutes } from '../../packages/core/src/products.js';
import { registerResourceRoutes } from '../../packages/core/src/resources.js';
import { registerMasterDataRoutes } from '../../packages/core/src/master-data.js';
import { registerAuth } from '../../packages/core/src/auth.js';
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
          const result = await fetch('http://127.0.0.1:14873' + req.url!);
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
    registerImportRoutes(app, pool, config.tenantId);
    registerCalendarFeedRoutes(app, pool, config.tenantId, origin);
    const page = await context.newPage();
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

    const loadedDocument = await page.goto(origin);
    expect(loadedDocument!.headers()['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    await expect(
      mode === 'password'
        ? page.getByLabel('E-Mail oder Benutzername')
        : page.getByRole('link', { name: 'Mit Google anmelden' }),
    ).toBeVisible();
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
    await page.getByRole('button', { name: 'Dunkelmodus' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await audit('events-desktop-dark');
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Dunkelmodus' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Dunkelmodus' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(
      (await context.cookies()).find((c) => c.name === '__Host-ak-session'),
    ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
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
    await navigate('Ressourcen');
    const resources = page.getByRole('region', { name: 'Ressourcen' });
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
    await navigate('Produkte');
    const products = page.getByRole('region', { name: 'Produkte' });
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
    await navigate('Kontakte');
    const contacts = page.getByRole('region', { name: 'Kontakte' });
    await contacts.getByLabel('Name / Firma').fill('Synthetic browser contact');
    await contacts.getByLabel('Kontaktart').selectOption('company');
    await contacts.getByLabel('E-Mail-Adresse').fill('browser@example.invalid');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
    await navigate('Kontakte');
    await contacts
      .getByRole('button', {
        name: 'Kontakt bearbeiten: Synthetic browser contact',
      })
      .click();
    await contacts.getByRole('button', { name: 'Dubletten prüfen' }).click();
    await expect(
      contacts.getByText('Keine möglichen Dubletten gefunden.'),
    ).toBeVisible();
    await contacts.getByLabel('Kontaktzustand').selectOption('archived');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(
      contacts.getByText('Synthetic browser contact – Archiviert'),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await contacts
      .getByRole('link', { name: 'Kontakte als CSV exportieren' })
      .click();
    expect((await download).suggestedFilename()).toBe('contacts.csv');
    await navigate('Locations');
    const locations = page.getByRole('region', { name: 'Locations' });
    await locations.getByLabel('Locationname').fill('Synthetic browser venue');
    await locations.getByLabel('Locationort').fill('Fictional city');
    await locations.getByRole('button', { name: 'Location speichern' }).click();
    await expect(
      locations.getByText('Synthetic browser venue', { exact: true }),
    ).toBeVisible();
    await locations
      .getByRole('button', {
        name: 'Location bearbeiten: Synthetic browser venue',
      })
      .click();
    await locations.getByLabel('Locationzustand').selectOption('archived');
    await locations.getByRole('button', { name: 'Location speichern' }).click();
    await expect(
      locations.getByText('Synthetic browser venue – Archiviert'),
    ).toBeVisible();
    await navigate('Kontakte');
    await contacts
      .getByRole('button', {
        name: 'Kontakt bearbeiten: Synthetic browser contact',
      })
      .click();
    await contacts.getByLabel('Kontaktzustand').selectOption('active');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
    await navigate('Events');
    const events = page.getByRole('region', { name: 'Events' });
    await events.getByRole('button', { name: 'Events aktualisieren' }).click();
    await expect(
      events.getByLabel('Eventname', { exact: true }),
    ).not.toBeVisible();
    await events.getByText('Event anlegen', { exact: true }).click();
    await expect(
      events
        .getByLabel('Hauptkontakt')
        .getByRole('option', { name: 'Synthetic browser contact' }),
    ).toBeEnabled();
    await events
      .getByLabel('Eventname', { exact: true })
      .fill('Synthetic browser event');
    await events
      .getByLabel('Hauptkontakt')
      .selectOption({ label: 'Synthetic browser contact' });
    await events
      .getByRole('combobox', { name: 'Eventart', exact: true })
      .selectOption({ label: 'Hochzeit' });
    await events.getByLabel('Eventdatum').fill('2026-10-16');
    await events.getByLabel('Eventbeginn').fill('2026-10-16T18:00');
    await events.getByLabel('Eventende').fill('2026-10-17T01:00');
    await events
      .getByLabel('Interne Notizen')
      .fill(
        '<strong>Fictional browser note</strong><script>window.syntheticBad=true</script>',
      );
    await events.getByRole('button', { name: 'Event speichern' }).click();
    await expect(
      events.getByText('Synthetic browser event – 16.10.2026 – Anfrage'),
    ).toBeVisible();
    await events
      .getByRole('button', {
        name: 'Eventakte öffnen: Synthetic browser event',
      })
      .click();
    await expect(
      events.getByRole('button', {
        name: 'Eventakte öffnen: Synthetic browser event',
      }),
    ).not.toBeVisible();
    await page.goBack();
    await expect(
      events.getByRole('button', {
        name: 'Eventakte öffnen: Synthetic browser event',
      }),
    ).toBeVisible();
    await events
      .getByRole('button', {
        name: 'Eventakte öffnen: Synthetic browser event',
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
      name: 'Eventakte',
      exact: true,
    });
    await record
      .getByRole('button', { name: 'Übersicht', exact: true })
      .click();
    await record
      .getByRole('combobox', { name: 'Status in der Eventakte', exact: true })
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
      events.getByText('Synthetic browser event – 16.10.2026 – Annulliert'),
    ).toBeVisible();
    await events.getByText('Event anlegen', { exact: true }).click();
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
      .getByRole('button', {
        name: 'Eventakte öffnen: Fictional resource booking',
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
    await assignment.getByLabel('Buchungsdatum').fill('2030-10-20');
    await assignment
      .getByLabel('Eventbeginn für die Disposition', { exact: true })
      .fill('2030-10-20T18:00');
    await assignment
      .getByLabel('Eventende für die Disposition', { exact: true })
      .fill('2030-10-20T20:00');
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
    await expect(
      events.getByText('Fictional resource booking – 20.10.2030 – Gebucht', {
        exact: true,
      }),
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
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
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
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
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
    await events.getByLabel('Filter von').fill('2026-10-16');
    await events.getByLabel('Filter bis').fill('2026-10-16');
    await events
      .getByRole('combobox', { name: 'Filterstatus', exact: true })
      .selectOption('cancelled');
    await events.getByRole('button', { name: 'Events filtern' }).click();
    await expect(page).toHaveURL(/status=cancelled/);
    await expect(
      events.getByText('Synthetic browser event – 16.10.2026 – Annulliert'),
    ).toBeVisible();
    await events.getByLabel('Nur Events ohne Datum').check();
    await events.getByRole('button', { name: 'Events filtern' }).click();
    await expect(events.getByText('Keine Events gefunden.')).toBeVisible();
    await page.goBack();
    await expect(
      events.getByText('Synthetic browser event – 16.10.2026 – Annulliert'),
    ).toBeVisible();
    await page.reload();
    await expect(events.getByLabel('Filter von')).toHaveValue('2026-10-16');
    await expect(
      events.getByRole('combobox', { name: 'Filterstatus', exact: true }),
    ).toHaveValue('cancelled');
    await page.getByRole('link', { name: 'Suche', exact: true }).click();
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
    await events.getByLabel('Nur Events ohne Datum').check();
    await events.getByRole('button', { name: 'Events filtern' }).click();
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
        name: 'Eventakte: Synthetic browser event',
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
      .getByLabel('Eventbeginn für die Disposition', { exact: true })
      .fill('2030-10-27T18:00');
    await review
      .getByLabel('Eventende für die Disposition', { exact: true })
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
      events.getByRole('region', { name: 'Eventakte', exact: true }),
    ).toBeVisible();
    await expect(
      events
        .getByRole('region', { name: 'Eventakte', exact: true })
        .getByRole('heading', {
          name: 'Eventakte: Fictional Future Event',
          exact: true,
        }),
    ).toBeVisible();

    if (mode === 'password') {
      await page.setViewportSize({ width: 390, height: 844 });
      const currentRecord = events.getByRole('region', {
        name: 'Eventakte',
        exact: true,
      });
      await currentRecord
        .getByRole('button', { name: 'Ressourcen', exact: true })
        .click();
      const dispositionStart = currentRecord.getByLabel(
        'Eventbeginn für die Disposition',
        { exact: true },
      );
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
          name: 'Eventakte: Fictional Future Event',
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      const recordNav = currentRecord.getByRole('navigation', {
        name: 'Bereiche der Eventakte',
      });
      expect((await recordNav.boundingBox())!.height).toBeLessThan(100);
      await currentRecord
        .getByRole('heading', {
          name: 'Eventakte: Fictional Future Event',
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
        const toggle = page.getByRole('button', { name: 'Dunkelmodus' });
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
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
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
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
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
      await page.getByRole('link', { name: 'Suche', exact: true }).click();
      const search = page.getByLabel('Globale Suche');
      await search.focus();
      expect(
        await search.evaluate((el) =>
          parseFloat(getComputedStyle(el).outlineWidth),
        ),
      ).toBeGreaterThanOrEqual(2);
      await page
        .getByRole('heading', { name: 'AuftragsKompass', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'tests/test-results/admin-mobile.png' });
      const menuButton = page.getByRole('button', { name: 'Menü öffnen' });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await menuButton.click();
      const menu = page.getByRole('dialog', { name: 'Menü', exact: true });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole('button', { name: 'Abmelden', exact: true }),
      ).toBeVisible();
      await expect(menu).toHaveCSS('opacity', '1');
      expect(
        await menu.evaluate((el) =>
          getComputedStyle(el).transitionDuration.split(',').map(parseFloat),
        ),
      ).toEqual([0.22, 0.22]);
      await audit('mobile-menu-light');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
      await menuButton.click();
      await expect(menu).toHaveCSS('opacity', '1');
      await audit('mobile-menu-dark');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
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
      await expect(
        page.getByRole('link', { name: 'Suche', exact: true }),
      ).toBeFocused();
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
      await page
        .getByRole('heading', { name: 'AuftragsKompass', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(contacts).not.toBeVisible();
      await expect(calendar).not.toBeVisible();
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-events.png',
      });
      await page
        .getByRole('button', { name: 'Dunkelmodus' })
        .scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.screenshot({
        path: 'tests/test-results/admin-mobile-dark.png',
        animations: 'disabled',
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page
        .getByRole('heading', { name: 'AuftragsKompass', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: 'tests/test-results/admin-desktop-dark.png',
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Dunkelmodus' }).click();
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
        for (const [route, label, action] of [
          ['events', 'Events', /^Eventakte öffnen: Fictional browser volume /],
          [
            'contacts',
            'Kontakte',
            /^Kontakt bearbeiten: Fictional browser volume /,
          ],
        ] as const) {
          // A hash-only navigation would reuse the previous performance time origin.
          await page.goto('about:blank');
          await page.goto(origin + '/?q=Fictional+browser+volume#' + route);
          const list = page.getByRole('region', { name: label, exact: true });
          await expect(list).toHaveAttribute('aria-busy', 'false');
          const actions = list.getByRole('button', { name: action });
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
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
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
