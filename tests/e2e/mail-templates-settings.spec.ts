import { expect, test } from '@playwright/test';
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
import {
  mailTemplateRepository,
  registerMailTemplateRoutes,
} from '../../packages/core/src/mail-templates.js';

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

    await page.setViewportSize({ width: 320, height: 720 });
    expect(await overflow()).toBe(true);
    await section.screenshot({
      path: 'tests/test-results/mail-templates-settings-320.png',
    });
  } finally {
    await context.close();
    await pool?.end();
    await container?.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
