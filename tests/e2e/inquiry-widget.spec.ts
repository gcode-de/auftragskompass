import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { createInquiryGateway } from '../../packages/core/src/inquiry-gateway.js';
import { migrateGateway } from '../../packages/core/src/gateway-operations.js';
import {
  inquiryInbox,
  type InquiryInboxConfig,
} from '../../packages/core/src/inquiry-inbox.js';
import type { GatewayKey } from '../../packages/core/src/gateway-message.js';
const origin = 'https://fictional-site.example.invalid',
  gatewayOrigin = 'https://fictional-gateway.example.invalid',
  tenantId = '00000000-0000-4000-8000-000000000291',
  now = new Date('2030-10-26T10:00:00.000Z');
const storage: InquiryInboxConfig = {
  tenantId,
  keys: [{ id: 'fictional-storage', secret: Buffer.alloc(32, 41) }],
  activeKeyId: 'fictional-storage',
  retentionHours: 24,
  maxStored: 100,
};
const key: GatewayKey = {
  id: 'fictional-request',
  tenantId,
  direction: 'core-to-gateway',
  secret: Buffer.alloc(32, 42),
  notBefore: now.getTime() / 1000 - 60,
  expiresAt: now.getTime() / 1000 + 3600,
};
let container: StartedPostgreSqlContainer,
  pool: Pool,
  app: Awaited<ReturnType<typeof createInquiryGateway>>,
  address: string;
test.setTimeout(120000);
test.use({ locale: 'de-DE' });
test.beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateGateway(pool);
  app = await createInquiryGateway({
    pool,
    storage,
    syncKeys: [
      key,
      {
        ...key,
        id: 'fictional-response',
        direction: 'gateway-to-core',
        secret: Buffer.alloc(32, 43),
      },
    ],
    responseKeyId: 'fictional-response',
    allowedOrigins: [origin],
    now: () => now,
  });
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
test.afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});
test('isolated public form is accessible in both themes at mobile, tablet and desktop widths and safely retries a lost public receipt', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const html =
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fictional Anfrageprüfung</title><style>body{margin:0;background:#e8eee9}main{max-width:56rem;margin:auto;padding:1rem}body.dark{background:#151d19}input,button{font-size:2px!important;background:red!important}</style></head><body><main aria-label="Fotobox-Anfrage"><div id="inquiry"></div></main><script type="module">import {mountInquiryForm} from "/inquiry-widget.js"; window.widget=mountInquiryForm(document.getElementById("inquiry"),{gatewayOrigin:"' +
    gatewayOrigin +
    '"});</script></body></html>';
  await page.route(origin + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html,
      });
    if (path === '/inquiry-widget.js' || path === '/inquiry-widget.css')
      return route.fulfill({
        status: 200,
        contentType: path.endsWith('.css')
          ? 'text/css'
          : 'application/javascript',
        body: await readFile('apps/widget/dist' + path),
      });
    return route.fulfill({ status: 404, body: '' });
  });
  let sends = 0,
    lose = true;
  const bodies: string[] = [];
  await page.route(gatewayOrigin + '/**', async (route) => {
    const request = route.request(),
      response = await route.fetch({
        url: address + new URL(request.url()).pathname,
      });
    if (request.method() === 'POST') {
      sends++;
      bodies.push(request.postData()!);
      if (lose) {
        lose = false;
        expect(response.status()).toBe(202);
        return route.abort('failed');
      }
    }
    return route.fulfill({ response });
  });
  await page.goto(origin);
  await expect(page.getByLabel('Vorname *')).toBeVisible();
  await expect(page.getByLabel('Vorname *')).toHaveCSS('font-size', '16px');
  let audit = 0;
  async function inspect(name: string) {
    await expect(page.locator('#inquiry')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(name + '.png'),
      fullPage: true,
    });
    await (
      await import('node:fs/promises')
    ).writeFile(
      test.info().outputPath('a11y-widget-' + audit++ + '.json'),
      JSON.stringify({ state: name, violations: result.violations }),
    );
  }
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('#inquiry')).toHaveCSS('color-scheme', 'light');
    await page.evaluate(
      (dark) => document.body.classList.toggle('dark', dark),
      theme === 'dark',
    );
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await inspect('widget-' + theme + '-' + width);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.body.classList.remove('dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Anfrage senden' }).click();
  expect(sends).toBe(0);
  await page.getByLabel('Vorname *').fill('Fictional');
  await page.getByLabel('Nachname *').fill('Visitor');
  await page.getByLabel('E-Mail *').fill('visitor@example.invalid');
  await page.getByLabel('Veranstaltungsdatum *').fill('2030-10-27');
  await page.getByLabel('Telefonnummer (optional)').fill('+49 000 000000');
  await page
    .getByLabel('Veranstaltungsort (optional)')
    .fill('Fictional demonstration hall');
  await page
    .getByLabel('Gewünschtes Fotobox-Paket (optional)')
    .selectOption('easy-print-plus');
  await page
    .getByLabel('Details zur Veranstaltung (optional)')
    .fill(
      'Fictional original <message> ' + 'Long fictional comment '.repeat(40),
    );
  await page.getByRole('button', { name: 'Anfrage senden' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Eingang ist noch unklar',
  );
  await expect(page.getByLabel('Vorname *')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('.ak-package-choice')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeFocused();
  await inspect('widget-uncertain-mobile');
  expect(await inquiryInbox(pool, storage).pending(10, now)).toHaveLength(1);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Erneut senden' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'Ihre Anfrage ist eingegangen',
  );
  await expect(page.getByRole('status')).toBeFocused();
  await inspect('widget-received-mobile');
  expect(sends).toBe(2);
  expect(bodies[0]).toBe(bodies[1]);
  const [original] = await inquiryInbox(pool, storage).pending(10, now);
  expect(original!.submission.fields).toMatchObject({
    firstName: 'Fictional',
    lastName: 'Visitor',
    email: 'visitor@example.invalid',
    eventDate: '2030-10-27',
    phone: '+49 000 000000',
    location: 'Fictional demonstration hall',
    package: 'easy-print-plus',
  });
  expect(original!.submission.fields.comment).toContain('<message>');
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
