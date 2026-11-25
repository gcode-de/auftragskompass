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
import { registerMailRoutes } from '../../packages/core/src/mail.js';
import { nginxHeaders } from '../helpers/nginx-headers.js';

// MAIL-ACCOUNT-01: the sending account settings in real Chromium - create,
// change without a password, secret never visible, axe clean. Synthetic
// account data only; no provider is contacted and nothing is sent.
const login = 'fictional.mailsettings@example.invalid';
const username = 'fictional.mailsettings';
const password = 'Fictional mail settings password 123!';
const encryptionKey = Buffer.alloc(32, 9);

test('the sending account settings create and change an account in Chromium', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-mail-settings-e2e-'));
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
      'Synthetic mail settings E2E',
      'Europe/Berlin',
    );
    await bootstrapPassword(pool, tenantId, login, username, () => password);
    await registerAuth(app, pool, {
      origin,
      tenantId,
      mode: 'password' as const,
    });
    registerMailRoutes(app, pool, tenantId, { key: encryptionKey });

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const accountWrites: { method: string; body: unknown }[] = [];
    const accountBodies: Promise<string>[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/mail/accounts'))
        accountWrites.push({
          method: request.method(),
          body: request.postDataJSON(),
        });
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/mail/accounts'))
        accountBodies.push(response.text());
    });
    await page.goto(origin);
    await page.getByLabel('E-Mail oder Benutzername').fill(username);
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
      .getByRole('link', { name: 'Ein- & Ausgangsserver', exact: true })
      .click();
    await expect(page).toHaveURL(/#settings-mail$/);
    const section = page.getByRole('region', { name: 'E-Mail-Versand' });

    // Without an account the form is the first step; creating seals the
    // password and clears the field right after the confirmed save.
    await section.getByLabel('Kontoname').fill('Fictional Versandkonto');
    await section.getByLabel('Absendername').fill('Fotobox Muster');
    await section.getByLabel('Absenderadresse').fill('versand@example.invalid');
    await section.getByLabel('SMTP-Server').fill('smtp.example.invalid');
    await section.getByLabel('SMTP-Port').fill('587');
    await section
      .getByLabel('Transportverschlüsselung')
      .selectOption('starttls');
    await section
      .getByLabel('Benutzername')
      .fill('synthetic.sender@example.invalid');
    await section.getByLabel('Passwort').fill('fictional-secret-password');
    await section.getByRole('button', { name: 'Speichern' }).click();
    await expect(section.getByText('Versandkonto gespeichert.')).toBeVisible();
    await expect(
      section.getByText(/Fictional Versandkonto – versand@example.invalid/),
    ).toBeVisible();
    await expect(section.getByText('Passwort gesetzt')).toBeVisible();
    expect(await section.getByLabel('Passwort').inputValue()).toBe('');
    const create = accountWrites.find((call) => call.method === 'POST')!;
    expect(create.body).toMatchObject({
      name: 'Fictional Versandkonto',
      fromName: 'Fotobox Muster',
      fromAddress: 'versand@example.invalid',
      smtpHost: 'smtp.example.invalid',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      secret: 'fictional-secret-password',
      enabled: true,
    });

    // Changing with an empty password keeps the sealed one: no secret key.
    // The form stays in edit mode after creating; "Abbrechen" returns to the
    // list so the row's own edit action is exercised as well.
    accountWrites.length = 0;
    await section.getByRole('button', { name: 'Abbrechen' }).click();
    await section
      .getByRole('button', { name: 'Fictional Versandkonto bearbeiten' })
      .click();
    await expect(
      section.getByText('Leer lassen, um es unverändert beizubehalten.'),
    ).toBeVisible();
    await section.getByLabel('Absendername').fill('Neuer Absender');
    await section.getByRole('button', { name: 'Änderungen speichern' }).click();
    await expect(section.getByText('Versandkonto gespeichert.')).toBeVisible();
    const change = accountWrites.find((call) => call.method === 'PUT')!;
    expect((change.body as Record<string, unknown>).fromName).toBe(
      'Neuer Absender',
    );
    expect(change.body).not.toHaveProperty('secret');
    expect(await section.getByLabel('Passwort').inputValue()).toBe('');

    // The sealed secret never comes back: no API answer may contain it.
    for (const body of await Promise.all(accountBodies))
      expect(body).not.toContain('fictional-secret-password');

    // Accessibility and geometry at the sizes the panel ships at.
    const results = await new AxeBuilder({ page })
      .include('section[aria-label="E-Mail-Versand"]')
      .analyze();
    expect(results.violations).toEqual([]);
    const geometry: Record<string, number> = {};
    for (const width of [1280, 320] as const) {
      await page.setViewportSize({ width, height: 900 });
      geometry[String(width)] = await section.evaluate(
        (element) => element.scrollWidth,
      );
      await section.screenshot({
        path: `tests/test-results/mail-account-settings-${width}.png`,
      });
      await testInfo.attach(`mail-account-settings-${width}`, {
        body: await section.screenshot(),
        contentType: 'image/png',
      });
    }
    // At 320px the form stacks without a horizontal overflow of the section.
    expect(geometry['320']).toBeLessThanOrEqual(320);
  } finally {
    await context.close();
    await app.close();
    await pool.end().catch(() => undefined);
    await container.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
