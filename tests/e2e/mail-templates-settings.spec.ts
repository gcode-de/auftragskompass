import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import {
  mailTemplateRepository,
  registerMailTemplateRoutes,
} from '../../packages/core/src/mail-templates.js';
import { registerLibraryFileRoutes } from '../../packages/core/src/library-files.js';
import { registerMailSignatureRoutes } from '../../packages/core/src/mail-signatures.js';

// MAIL-TPL-01b: the mail template settings in real Chromium against the real
// routes - open the area, create a template with a placeholder, save it, axe
// clean, 1280/320. Synthetic data only; nothing is ever sent.
const login = 'fictional.tplsettings@example.invalid';
const password = 'Fictional template password 123!';

test('mail templates are managed in the settings in Chromium', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-mail-tpl-e2e-'));
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
      'Synthetic template settings E2E',
      'Europe/Berlin',
    );
    await bootstrapPassword(
      pool,
      tenantId,
      login,
      'fictional.tpl',
      () => password,
    );
    const actorId = (
      await pool.query<{ user_id: string }>(
        'SELECT user_id FROM allowed_accounts WHERE tenant_id=$1::uuid',
        [tenantId],
      )
    ).rows[0]!.user_id;
    await registerAuth(app, pool, {
      origin,
      tenantId,
      mode: 'password' as const,
    });
    registerMailTemplateRoutes(app, pool, tenantId);
    // MAIL-TPL-01e: one available library file for the attachment chooser.
    const storedFiles = new Map<string, Buffer>();
    const memoryStore = {
      async put(key: string, bytes: Buffer) {
        storedFiles.set(key, Buffer.from(bytes));
      },
      async read(key: string) {
        const bytes = storedFiles.get(key);
        if (!bytes) throw new Error('synthetic E2E artifact is missing');
        return Buffer.from(bytes);
      },
      async remove(key: string) {
        storedFiles.delete(key);
      },
    };
    registerLibraryFileRoutes(app, pool, tenantId, memoryStore);
    // MAIL-SIG-01a: signatures share the synthetic store for their logo.
    registerMailSignatureRoutes(app, pool, tenantId, memoryStore);
    await pool.query(
      `INSERT INTO library_files
         (tenant_id,id,display_name,media_type,size_bytes,sha256,storage_key,
          scan_state,state,uploaded_at,uploaded_by)
       VALUES ($1::uuid,$2::uuid,'Fictional Datei','application/pdf',29,
               $3,$4,'not_scanned','available',now(),$5::uuid)`,
      [
        tenantId,
        randomUUID(),
        createHash('sha256')
          .update(Buffer.from('%PDF-1.4 synthetic library file\n', 'latin1'))
          .digest('hex'),
        'file-fixture.pdf',
        actorId,
      ],
    );
    // One existing template so the list and the edit flow have a row.
    await mailTemplateRepository(pool, tenantId).save(actorId, {
      name: 'Fictional Bestätigung',
      subject: 'Bestätigung für {{contact}}',
      bodyHtml: '<p>Hallo {{contactFirstName}}</p>',
    });

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    await page.getByLabel('E-Mail oder Benutzername').fill('fictional.tpl');
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByText(login, { exact: true })).toBeAttached();

    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Einstellungen', exact: true })
      .click();
    const settingsNavigation = page.getByRole('navigation', {
      name: 'Einstellungen',
      exact: true,
    });
    await settingsNavigation
      .getByRole('link', { name: 'E-Mail-Vorlagen', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings-mail-templates$/);
    const section = page.getByRole('region', { name: 'E-Mail-Vorlagen' });

    // The stored template is listed with its state; editing opens the form
    // with the fetched body in the editor.
    await expect(
      section.getByText('Fictional Bestätigung (Aktiv)'),
    ).toBeVisible();
    await section
      .getByRole('button', { name: 'Fictional Bestätigung bearbeiten' })
      .click();
    await expect(section.getByLabel('Betreff')).toHaveValue(
      'Bestätigung für {{contact}}',
    );
    await expect(
      section.getByRole('textbox', { name: 'Text (optional)' }),
    ).toContainText('{{contactFirstName}}');

    const violations = await new AxeBuilder({ page })
      .include('section[aria-label="E-Mail-Vorlagen"]')
      .analyze();
    expect(violations.violations).toEqual([]);
    await section.screenshot({
      path: 'tests/test-results/mail-templates-settings-1280.png',
    });
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    expect(await overflow()).toBe(true);

    // Abbrechen leaves the form without a write; creating starts from the
    // list again.
    await section.getByRole('button', { name: 'Abbrechen' }).click();
    await section
      .getByRole('button', { name: 'E-Mail-Vorlage anlegen' })
      .click();
    await section.getByLabel('Name').fill('Fictionale Erinnerung');
    await section.getByLabel('Betreff').fill('Erinnerung für {{contact}}');
    await section.getByRole('button', { name: 'Platzhalter einfügen' }).click();
    await section
      .getByRole('group', { name: 'Platzhalter für den Begleittext' })
      .getByRole('combobox')
      .selectOption('contactFirstName');
    await section.getByRole('button', { name: 'Einfügen' }).click();
    await section.getByRole('button', { name: 'Vorlage speichern' }).click();
    await expect(
      section.getByText('E-Mail-Vorlage gespeichert.'),
    ).toBeVisible();
    await expect(
      section.getByText('Fictionale Erinnerung (Aktiv)'),
    ).toBeVisible();

    // The example preview says clearly what it is.
    await section.getByRole('button', { name: 'Vorschau anzeigen' }).click();
    await expect(
      section.getByText(
        /Beispielvorschau – Betreff: Erinnerung für Alex Beispiel/,
      ),
    ).toBeVisible();

    // MAIL-TPL-01e: the standard attachment chooser lists available library
    // files; checking one travels with the save and survives a reopen.
    await section.getByRole('checkbox', { name: /Fictional Datei/ }).check();
    await section.getByRole('button', { name: 'Vorlage speichern' }).click();
    await expect(
      section.getByText('E-Mail-Vorlage gespeichert.'),
    ).toBeVisible();
    // The stored choice survives closing and reopening the editor.
    await section.getByRole('button', { name: 'Abbrechen' }).click();
    await section
      .getByRole('button', { name: 'Fictionale Erinnerung bearbeiten' })
      .click();
    await expect(
      section.getByRole('checkbox', { name: /Fictional Datei/ }),
    ).toBeChecked();

    await page.setViewportSize({ width: 320, height: 720 });
    expect(await overflow()).toBe(true);
    await section.screenshot({
      path: 'tests/test-results/mail-templates-settings-320.png',
    });

    // MAIL-SIG-01a: a signature with an uploaded logo, shown back as image.
    await page.setViewportSize({ width: 1280, height: 900 });
    const signatures = page.getByRole('region', { name: 'E-Mail-Signaturen' });
    await signatures.getByRole('button', { name: 'Signatur anlegen' }).click();
    await signatures.getByLabel('Bezeichnung').fill('Fiktive Signatur');
    await signatures
      .getByRole('textbox', { name: 'Signaturtext' })
      .fill('Viele Grüße');
    await signatures
      .getByLabel('Logo verlinkt auf (optional)')
      .fill('https://example.invalid/');
    const logoPath = join(dir, 'logo.png');
    await writeFile(
      logoPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    await signatures.getByLabel(/Logo hochladen/).setInputFiles(logoPath);
    await signatures
      .getByRole('button', { name: 'Signatur speichern' })
      .click();
    await expect(signatures.getByText('Signatur gespeichert.')).toBeVisible();
    await expect(
      signatures.getByText('Fiktive Signatur (Standard) · mit Logo'),
    ).toBeVisible();
    await signatures
      .getByRole('button', { name: 'Fiktive Signatur bearbeiten' })
      .click();
    const preview = signatures.getByRole('img', {
      name: 'Aktuelles Logo von Fiktive Signatur',
    });
    await expect(preview).toBeVisible();
    expect(
      await preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBe(1);
    expect(
      (await new AxeBuilder({ page }).include('#settings').analyze())
        .violations,
    ).toEqual([]);
    await signatures.screenshot({
      path: 'tests/test-results/mail-signatures-settings-1280.png',
    });
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await overflow()).toBe(true);
    await signatures.screenshot({
      path: 'tests/test-results/mail-signatures-settings-320.png',
    });
  } finally {
    await context.close();
    await app.close();
    await pool?.end().catch(() => undefined);
    await container?.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
