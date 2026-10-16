import { registerImportRoutes } from '../../packages/core/src/import-routes.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
import { expect, test, type Browser } from '@playwright/test';
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
  test.setTimeout(120000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-tls-'));
  const container = await new PostgreSqlContainer(
    'postgres:17.6-alpine',
  ).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const app = Fastify();
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
        if (req.url!.startsWith('/auth/') || req.url!.startsWith('/api/')) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks);
          const result = await app.inject({
            method: req.method as 'GET' | 'POST',
            url: req.url!,
            headers: req.headers,
            ...(body.length ? { payload: body } : {}),
          });
          res.writeHead(result.statusCode, result.headers);
          res.end(result.rawPayload);
        } else {
          const result = await fetch('http://127.0.0.1:14873' + req.url!);
          res.writeHead(result.status, {
            'content-type': result.headers.get('content-type')!,
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
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    if (mode === 'password') {
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
    expect(
      (await context.cookies()).find((c) => c.name === '__Host-ak-session'),
    ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      'ak-session',
    );
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
    const contacts = page.getByRole('region', { name: 'Kontakte' });
    await contacts.getByLabel('Name / Firma').fill('Synthetic browser contact');
    await contacts.getByLabel('Kontaktart').selectOption('company');
    await contacts.getByLabel('E-Mail-Adresse').fill('browser@example.invalid');
    await contacts.getByRole('button', { name: 'Kontakt speichern' }).click();
    await expect(
      contacts.getByText('Synthetic browser contact', { exact: true }),
    ).toBeVisible();
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
    const events = page.getByRole('region', { name: 'Events' });
    await events.getByRole('button', { name: 'Events aktualisieren' }).click();
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
      .getByRole('combobox', { name: 'Status in der Eventakte', exact: true })
      .selectOption('option');
    await record.getByRole('button', { name: 'Status speichern' }).click();
    await expect(
      events.getByText('Eventstatus gespeichert.', { exact: true }),
    ).toBeVisible();
    await expect(
      record.getByText(/Status von Anfrage auf Option geändert/),
    ).toBeVisible();
    await contacts
      .getByRole('button', {
        name: 'Events anzeigen: Synthetic browser contact',
      })
      .click();
    await expect(
      contacts.getByRole('link', { name: 'Synthetic browser event' }),
    ).toBeVisible();
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
    await expect(
      record.getByText(/Ressourcenzuordnung und Dispositionszeitraum geändert/),
    ).toBeVisible();
    await assignment.screenshot({
      path: 'tests/test-results/resource-assignment.png',
    });
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

    await record.getByRole('button', { name: 'Eventakte schließen' }).click();
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
      events.getByText('Synthetic browser event – 16.10.2026 – Annulliert'),
    ).toBeInViewport();
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
    await expect(calendar.getByRole('alert')).toContainText(
      '1 ungeprüfte Bestandszusagen',
    );
    await expect(calendar.getByText('Frei', { exact: true })).toHaveCount(0);
    await expect(calendar.getByText('Bestand ungeprüft').first()).toBeVisible();
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
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(391);
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
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.screenshot({ path: 'tests/test-results/admin-desktop.png' });
    }
    if (mode === 'password') {
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
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await expect(page.getByText('Abgemeldet')).toBeVisible();
    expect((await pool.query('SELECT * FROM sessions')).rowCount).toBe(0);
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
