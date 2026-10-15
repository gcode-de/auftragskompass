import { expect, test } from '@playwright/test';
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
import { registerAccessRoutes } from '../../packages/core/src/access-routes.js';
import { registerProductRoutes } from '../../packages/core/src/products.js';
import { registerResourceRoutes } from '../../packages/core/src/resources.js';
import { registerMasterDataRoutes } from '../../packages/core/src/master-data.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';
test('HTTPS browser signs in with OIDC, receives HttpOnly cookie and signs out', async ({
  browser,
}) => {
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
    const google = await syntheticGoogle(config);
    callbackFor = google.code;
    await registerAuth(app, pool, config, {
      ...google.provider,
      async authorization(attempt) {
        const url = new URL(await google.provider.authorization(attempt));
        return origin + '/synthetic-google' + url.search;
      },
    });
    registerAccessRoutes(app, pool, config.tenantId);
    registerMasterDataRoutes(app, pool, config.tenantId);
    registerResourceRoutes(app, pool, config.tenantId);
    registerProductRoutes(app, pool, config.tenantId);
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByRole('link', { name: 'Mit Google anmelden' }).click();
    await expect(
      page.getByText('synthetic@example.invalid', { exact: true }),
    ).toBeVisible();
    expect(
      (await context.cookies()).find((c) => c.name === '__Host-ak-session'),
    ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      'ak-session',
    );
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
});
