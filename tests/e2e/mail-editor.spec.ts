import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
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
import { registerMasterDataRoutes } from '../../packages/core/src/master-data.js';
import { registerResourceRoutes } from '../../packages/core/src/resources.js';
import { registerProductRoutes } from '../../packages/core/src/products.js';
import {
  registerContactRoutes,
  contactRepository,
} from '../../packages/core/src/contacts.js';
import { registerLocationRoutes } from '../../packages/core/src/locations.js';
import {
  registerEventRoutes,
  eventRepository,
} from '../../packages/core/src/events.js';
import {
  documentTemplateRepository,
  registerDocumentTemplateRoutes,
} from '../../packages/core/src/document-templates.js';
import { registerDocumentNumberRoutes } from '../../packages/core/src/document-numbers.js';
import {
  documentLayoutRepository,
  registerDocumentLayoutRoutes,
} from '../../packages/core/src/document-layouts.js';
import { registerDocumentRoutes } from '../../packages/core/src/documents.js';
import { registerCalendarFeedRoutes } from '../../packages/core/src/calendar-feeds.js';
import {
  registerMailRoutes,
  mailRepository,
} from '../../packages/core/src/mail.js';
import {
  registerMailTemplateRoutes,
  mailTemplateRepository,
} from '../../packages/core/src/mail-templates.js';
import { registerLibraryFileRoutes } from '../../packages/core/src/library-files.js';

// MAIL-EDITOR-01: the formatted document mail in real Chromium against the
// real routes - compose with formatting and placeholders, preview the actual
// resolved content, send the durable order, axe clean, both themes, 1280/320.
// Everything is synthetic; nothing is sent to a provider.
const login = 'fictional.maileditor@example.invalid';
const password = 'Fictional mail editor password 123!';

test('the document mail is composed, previewed and ordered in Chromium', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const dir = await mkdtemp(join(tmpdir(), 'ak-mail-editor-e2e-'));
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
  const storedArtifacts = new Map<string, Buffer>();
  const storage = {
    async put(key: string, bytes: Buffer) {
      storedArtifacts.set(key, Buffer.from(bytes));
    },
    async read(key: string) {
      const bytes = storedArtifacts.get(key);
      if (!bytes) throw new Error('synthetic E2E artifact is missing');
      return Buffer.from(bytes);
    },
    async remove(key: string) {
      storedArtifacts.delete(key);
    },
  };

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
      'Synthetic mail editor E2E',
      'Europe/Berlin',
    );
    await bootstrapPassword(
      pool,
      tenantId,
      login,
      'fictional.maileditor',
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
    registerMasterDataRoutes(app, pool, tenantId);
    registerResourceRoutes(app, pool, tenantId);
    registerProductRoutes(app, pool, tenantId);
    registerContactRoutes(app, pool, tenantId);
    registerLocationRoutes(app, pool, tenantId);
    registerEventRoutes(app, pool, tenantId);
    registerDocumentTemplateRoutes(app, pool, tenantId);
    registerDocumentNumberRoutes(app, pool, tenantId);
    registerDocumentLayoutRoutes(app, pool, tenantId, storage, async () =>
      Buffer.from('%PDF-1.4 synthetic layout render\n', 'latin1'),
    );
    registerDocumentRoutes(app, pool, tenantId, {
      origin,
      store: storage,
      render: async () =>
        Buffer.from('%PDF-1.4 synthetic document render\n', 'latin1'),
    });
    registerCalendarFeedRoutes(app, pool, tenantId, origin);
    const mailKey = Buffer.alloc(32, 7);
    registerMailRoutes(app, pool, tenantId, {
      store: storage,
      origin,
      key: mailKey,
    });
    // The durable order needs a sending account; its secret is sealed with
    // the same synthetic key and never leaves the process.
    await mailRepository(pool, tenantId, mailKey).saveAccount(actorId, {
      name: 'Fictional Versandkonto',
      fromName: 'Fotobox Muster',
      fromAddress: 'versand@example.invalid',
      smtpHost: 'smtp.example.invalid',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      username: 'synthetic.sender@example.invalid',
      secret: 'fictional-secret-password',
      enabled: true,
    });

    registerMailTemplateRoutes(app, pool, tenantId);
    // ATTACH-01b: dropped or chosen files upload through the real library
    // endpoint, backed by the in-memory store of this harness.
    registerLibraryFileRoutes(app, pool, tenantId, storage);
    // MAIL-TPL-01c: one active template with a subject placeholder; its body
    // stays empty so the composed draft below is unambiguous.
    await mailTemplateRepository(pool, tenantId).save(actorId, {
      name: 'Fictional Erinnerung',
      subject: 'Erinnerung für {{contact}}',
      bodyHtml: '',
    });

    // Synthetic business data: one contact with a structured first name and
    // one event with a free-text venue - the exact fields the placeholders
    // resolve from.
    const contact = await contactRepository(pool, tenantId).save(actorId, {
      kind: 'private',
      name: 'Fictional Mail Recipient',
      firstName: 'Erika',
      contactPerson: '',
      street: 'Fictional Way 1',
      postalCode: '00000',
      city: 'Example City',
      country: 'DE',
      email: 'recipient@example.invalid',
      phone: '',
      mobile: '',
      state: 'active',
    });
    const event = await eventRepository(pool, tenantId).save(actorId, {
      name: 'Fictional Mail Event',
      status: 'option',
      eventTypeId: null,
      packageId: null,
      locationId: null,
      venue: 'Fictional Event Hall',
      venueOverride: true,
      primaryContactId: contact.id,
      additionalContactIds: [],
      source: 'Synthetic MAIL-EDITOR-01 E2E fixture',
      eventDate: '2031-05-01',
      startsAt: null,
      endsAt: null,
      description: '',
      notesHtml: '',
    });
    const templates = documentTemplateRepository(pool, tenantId);
    const template = await templates.save(actorId, {
      kind: 'offer',
      name: 'Fictional E2E mail template',
      subject: 'Fictional subject',
      introText: '',
      outroText: '',
      validityDays: 14,
      state: 'active',
      positions: [
        {
          description: 'Fictional photo booth service',
          quantity: 1,
          unit: 'Tag',
          unitPriceMinor: 10000,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
        },
      ],
    });
    await documentLayoutRepository(pool, tenantId, storage).save(actorId, {
      senderName: 'Fictional Fotobox',
      senderStreet: '',
      senderPostalCode: '',
      senderCity: '',
      primaryColor: '#234f3b',
      textColor: '#202020',
      fontFamily: 'system',
      showPageNumbers: true,
      showPositionNumbers: true,
    });
    // A finalized offer with its frozen PDF artefact - the document the mail
    // carries unchanged. Seeded directly: no PDF is rendered for a fixture.
    const pdfBytes = Buffer.from(
      '%PDF-1.4\n% fictional synthetic document for the mail editor fixture\n%%EOF\n',
      'latin1',
    );
    const pdfHash = createHash('sha256').update(pdfBytes).digest('hex');
    await storage.put(pdfHash + '.pdf', pdfBytes);
    const number = 'AN-2031-0042';
    await pool.query(
      `INSERT INTO documents
         (tenant_id,id,kind,template_id,event_id,contact_id,number,state,
          issued_at,finalized_at,snapshot_hash,pdf_hash,
          net_minor,tax_minor,gross_minor,version)
       VALUES ($1::uuid,$2::uuid,'offer',$3::uuid,$4::uuid,$5::uuid,$6,'final',
               now(),now(),$7,$8,10000,1900,11900,1)`,
      [
        tenantId,
        randomUUID(),
        template.id,
        event.id,
        contact.id,
        number,
        'a'.repeat(64),
        pdfHash,
      ],
    );

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    await page
      .getByLabel('E-Mail oder Benutzername')
      .fill('fictional.maileditor');
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByText(login, { exact: true })).toBeAttached();
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Events', exact: true })
      .click();
    await page.getByRole('link', { name: /Fictional Mail Event/ }).click();
    // The documents of the event live in its "Dateien" area.
    await page.getByRole('button', { name: 'Dateien', exact: true }).click();

    const sendAction = page.getByRole('button', {
      name: `Angebot ${number} per E-Mail senden`,
    });
    await expect(sendAction).toBeVisible();
    await sendAction.click();
    const dialog = page.getByRole('dialog', {
      name: 'Dokument per E-Mail senden',
    });
    await expect(dialog).toBeVisible();

    // The recipient is prefilled from the stored contact and correctable.
    await expect(dialog.getByLabel(/Empfänger/)).toHaveValue(
      'recipient@example.invalid',
    );

    // MAIL-TPL-01c: applying the active template adopts its subject into the
    // still fully editable draft.
    await dialog
      .getByLabel('Aus Vorlage')
      .selectOption({ label: 'Fictional Erinnerung' });
    await dialog.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(dialog.getByLabel('Betreff')).toHaveValue(
      'Erinnerung für {{contact}}',
    );

    // Compose: real typing, a formatted selection and two placeholders from
    // the described picker - the contact first name and a value that will
    // stay visible because none is stored.
    const editor = dialog.getByRole('textbox', {
      name: 'Begleittext (optional)',
    });
    const insertPlaceholder = async (name: string) => {
      await dialog
        .getByRole('button', { name: 'Platzhalter einfügen' })
        .click();
      // Scope to the picker group: the wrapped label text would also contain
      // every option, and the dialog now has a template combobox as well.
      await dialog
        .getByRole('group', { name: 'Platzhalter für den Begleittext' })
        .getByRole('combobox')
        .selectOption(name);
      await dialog.getByRole('button', { name: 'Einfügen' }).click();
    };
    await editor.click();
    await editor.pressSequentially('Hallo ');
    await insertPlaceholder('contactFirstName');
    // Explicitly continue at the line end: after a trailing space the
    // restored selection may otherwise sit before it and the next insert
    // lands at the wrong place.
    await editor.press('End');
    await editor.pressSequentially(' ');
    await insertPlaceholder('package');
    // Enter starts a new paragraph (its own spacing); Shift+Enter stays in
    // the same paragraph with a plain line break.
    await editor.press('Enter');
    await editor.pressSequentially('Zweiter Absatz');
    await editor.press('Shift+Enter');
    await editor.pressSequentially('Fortsetzung');
    await editor.press('ControlOrMeta+a');
    await dialog.getByRole('button', { name: 'Fett' }).click();
    await expect(dialog.getByRole('button', { name: 'Fett' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The preview is the actual server result: resolved value, visible
    // missing token, real subject.
    await dialog.getByRole('button', { name: 'Vorschau anzeigen' }).click();
    await expect(
      dialog.getByText('Betreff: Erinnerung für Fictional Mail Recipient'),
    ).toBeVisible();
    const previewBody = dialog.locator('.mail-preview-body');
    await expect(previewBody).toContainText('Hallo Erika {{package}}');
    await expect(previewBody).toContainText('Zweiter Absatz');
    await expect(previewBody).toContainText('Fortsetzung');
    await expect(previewBody.locator('strong').first()).toHaveText(
      'Hallo Erika {{package}}',
    );
    await expect(
      dialog.getByText(/Ohne Wert bleiben sichtbar: \{\{package\}\}/),
    ).toBeVisible();

    const violations = await new AxeBuilder({ page })
      .include('.mail-send-dialog')
      .analyze();
    expect(violations.violations).toEqual([]);
    await dialog.screenshot({
      path: 'tests/test-results/mail-editor-dialog-1280-light.png',
    });
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    expect(await overflow()).toBe(true);

    // ATTACH-01b: a file dropped onto the text area is uploaded through the
    // library endpoint and named in the attachment list - in a real browser,
    // past ProseMirror's own drop handling.
    await editor.evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(['%PDF-1.4 fictional drop'], 'Dropped Datei.pdf', {
          type: 'application/pdf',
        }),
      );
      el.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
    await expect(
      dialog.getByText(
        'Dropped Datei.pdf wurde angehängt. Die Datei ist ungeprüft.',
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText('Dropped Datei.pdf', { exact: true }),
    ).toBeVisible();

    // Send: one durable order, resolved and sanitized on the server.
    await dialog.getByRole('button', { name: 'Senden' }).click();
    await expect(
      page.getByText('Dokument als E-Mail-Auftrag vorgemerkt.'),
    ).toBeVisible();
    const message = (
      await pool.query<{
        subject: string;
        body_text: string;
        body_html: string;
      }>(
        'SELECT subject, body_text, body_html FROM mail_messages WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0]!;
    // The template subject arrived resolved from structured data.
    expect(message.subject).toBe('Erinnerung für Fictional Mail Recipient');
    // ProseMirror keeps typed boundary spaces as non-breaking spaces in the
    // HTML (marked `~` here); the text alternative normalizes them. Enter
    // produced the second paragraph, Shift+Enter the plain line break.
    expect(message.body_html.replace(/\u00a0/g, '~')).toBe(
      '<p><strong>Hallo~Erika~{{package}}</strong></p>' +
        '<p><strong>Zweiter Absatz<br />Fortsetzung</strong></p>',
    );
    expect(message.body_text).toBe(
      'Hallo Erika {{package}}\n\nZweiter Absatz\nFortsetzung',
    );
    const job = (
      await pool.query<{ state: string }>(
        'SELECT state FROM mail_outbox WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0]!;
    expect(job.state).toBe('pending');

    // Visual acceptance: both themes and both sizes, dialog always usable.
    const themeToggle = (dark: boolean) =>
      page
        .getByRole('button', {
          name: dark ? 'Dunkelmodus aktivieren' : 'Hellmodus aktivieren',
        })
        .click();
    const openDialog = async () => {
      await sendAction.click();
      const cycleDialog = page.getByRole('dialog', {
        name: 'Dokument per E-Mail senden',
      });
      await expect(cycleDialog).toBeVisible();
      expect(await overflow()).toBe(true);
      return cycleDialog;
    };
    await themeToggle(true);
    {
      const cycleDialog = await openDialog();
      await cycleDialog.screenshot({
        path: 'tests/test-results/mail-editor-dialog-1280-dark.png',
      });
      await cycleDialog.getByRole('button', { name: 'Abbrechen' }).click();
    }
    await page.setViewportSize({ width: 320, height: 720 });
    {
      const cycleDialog = await openDialog();
      await cycleDialog.screenshot({
        path: 'tests/test-results/mail-editor-dialog-320-dark.png',
      });
      await cycleDialog.getByRole('button', { name: 'Abbrechen' }).click();
    }
    await themeToggle(false);
    {
      const cycleDialog = await openDialog();
      await cycleDialog.screenshot({
        path: 'tests/test-results/mail-editor-dialog-320-light.png',
      });
      await cycleDialog.getByRole('button', { name: 'Abbrechen' }).click();
    }
  } finally {
    await context.close();
    await app.close();
    await pool?.end().catch(() => undefined);
    await container?.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
