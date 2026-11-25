import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import {
  migrate,
  identityRepository,
} from '../../packages/core/src/identity.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('migrations serialize, restart safely and detect changed history', async () => {
  const directory = new URL('../../packages/core/migrations/', import.meta.url),
    names = (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort(),
    expected = await Promise.all(
      names.map(async (name) => ({
        name,
        checksum: createHash('sha256')
          .update(await readFile(new URL(name, directory), 'utf8'))
          .digest('hex'),
      })),
    );
  await Promise.all([migrate(pool), migrate(pool)]);
  const applied = (
    await pool.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM ak_migrations ORDER BY name',
    )
  ).rows;
  expect(applied).toEqual(expected);
  // Event file links are additive; existing document constraints and indexes
  // below must survive the new relationship and audit column unchanged.
  expect(applied.map((migration) => migration.name)).toContain(
    '0050_event_library_files.sql',
  );
  // DOC-PRODUCT-01.5: the document discount migration adds three additive,
  // NULL-able columns, so every row written before it keeps its stored sums and
  // its claim.
  expect(
    (
      await pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name='documents'
            AND column_name IN
              ('total_discount_kind','total_discount_value','total_discount_note')
          ORDER BY column_name`,
      )
    ).rows,
  ).toEqual([
    { column_name: 'total_discount_kind', is_nullable: 'YES' },
    { column_name: 'total_discount_note', is_nullable: 'YES' },
    { column_name: 'total_discount_value', is_nullable: 'YES' },
  ]);
  // DOC-RG04-01: the newest migration adds one optional, NULL-able column to the
  // layout, so every stored layout keeps printing exactly as it did.
  // DOC-ACCEPT-FIX-01 (0066) then only widens the audit action list, so no
  // column and no existing action changes meaning.
  // MAIL-021-A (0067) adds the three new mail tables and two audit actions; it
  // changes no existing row either.
  // MAIL-021-B (0068) only widens two closed vocabularies: the audit actions and
  // the redacted outbox error codes. No table and no column changes.
  // MAIL-021-B2 (0069) widens the outbox error vocabulary by one code and leaves
  // every existing table, column and code untouched.
  // MAIL-NOTIFY-01 (0070) adds one tenant-bound settings table; no existing row
  // and no mail or Telegram contract changes.
  // MAIL-DOC-01 (0071) adds one tenant-bound attachment table plus a trigger
  // that only allows finalized documents; no existing row changes.
  // MAIL-ACCOUNT-01 (0072) adds three columns to mail_accounts (sender
  // identity and transport choice) with one table-level check, and widens the
  // audit vocabulary by one action; every existing row keeps its meaning.
  // MAIL-EDITOR-01a (0073) adds one optional column to contacts (the separate
  // first name of MAIL-EDITOR-01); every existing row keeps its meaning.
  // MAIL-TPL-01a (0074) adds one tenant-bound template table and one audit
  // action; no existing row and no existing contract changes.
  // MAIL-TPL-01d (0075) adds two tenant-bound attachment reference tables
  // with their availability triggers; the document attachment contract
  // (0071) stays byte-identical.
  // MAIL-FWD-01 (0076) adds one tenant-bound settings row for the
  // accounting address; no existing row and no existing contract changes.
  // MAIL-SIG-01a (0077) adds one tenant-bound signature table, a partial
  // unique index for the one standard and one audit action.
  // MAIL-SIG-01b (0078) adds one tenant-bound table for the inline logo a
  // mail freezes; no existing row and no existing contract changes.
  // QW2 (0079) adds one nullable cancellation reason reference to events;
  // existing rows keep NULL and every other contract stays unchanged.
  // QW3 (0080) adds the tenant-bound event notes, moves each non-empty single
  // note into one note and widens the audit vocabulary by two actions.
  // QW5 (0081) widens the audit vocabulary by the withdrawn planned send.
  expect(applied.at(-1)!.name).toBe('0081_mail_send_later.sql');
  expect(
    (
      await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name='inquiry_email_settings'`,
      )
    ).rows,
  ).toEqual([{ table_name: 'inquiry_email_settings' }]);
  expect(
    (
      await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name IN
              ('mail_accounts','mail_messages','mail_outbox','mail_attachments')
          ORDER BY table_name`,
      )
    ).rows.map((row) => row.table_name),
  ).toEqual([
    'mail_accounts',
    'mail_attachments',
    'mail_messages',
    'mail_outbox',
  ]);
  // MAIL-DOC-01: the attachment row is tenant-bound on both sides - the message
  // and the finalized document - and the frozen artefact hash must be one.
  const attachmentForeignKeys = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='mail_attachments'::regclass AND contype='f' ORDER BY def",
    )
  ).rows.map((row) => row.def);
  expect(
    attachmentForeignKeys.some((def) =>
      def.startsWith(
        'FOREIGN KEY (tenant_id, document_id) REFERENCES documents(tenant_id, id)',
      ),
    ),
  ).toBe(true);
  expect(attachmentForeignKeys).toContain(
    'FOREIGN KEY (tenant_id, message_id) REFERENCES mail_messages(tenant_id, id) ON DELETE CASCADE',
  );
  // The database, not only the repository, refuses a non-final document.
  const attachmentTrigger = (
    await pool.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgrelid='mail_attachments'::regclass AND NOT tgisinternal",
    )
  ).rows.map((row) => row.tgname);
  expect(attachmentTrigger).toEqual(['mail_attachments_final']);
  expect(
    (
      await pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name='document_layouts' AND column_name='tax_number'`,
      )
    ).rows,
  ).toEqual([{ column_name: 'tax_number', is_nullable: 'YES' }]);
  // DOC-ACCEPT-FIX-01: the corrective action is part of the closed list, and the
  // actions this slice builds on keep their meaning next to it.
  const auditActionCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='audit_events'::regclass AND conname='audit_events_action_check'",
    )
  ).rows[0]!.def;
  expect(auditActionCheck).toContain('document.acceptance_corrected');
  expect(auditActionCheck).toContain('mail.message_created');
  expect(auditActionCheck).toContain('mail.send_scheduled');
  // MAIL-021-B: the accepted message and the deliberate retry are their own
  // actions; the closed list grows by exactly these two.
  expect(auditActionCheck).toContain('mail.sent');
  expect(auditActionCheck).toContain('mail.send_retry');
  // MAIL-DOC-01: the explicit order that carries a finalized document.
  expect(auditActionCheck).toContain('mail.document_send_scheduled');
  expect(auditActionCheck).toContain('document.accepted');
  expect(auditActionCheck).toContain('product.deleted');
  // MAIL-021-B: the redacted outbox vocabulary stays closed and grows additively;
  // every MAIL-021-A code keeps its meaning.
  const outboxCodeCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='mail_outbox'::regclass AND conname='mail_outbox_last_error_code_check'",
    )
  ).rows[0]!.def;
  for (const code of [
    'provider_missing',
    'provider_timeout',
    'provider_rejected',
    'provider_uncertain',
    'internal',
    'provider_auth_failed',
    'provider_recipient_rejected',
    'encryption_unavailable',
    'provider_tls_required',
    // MAIL-DOC-01: an unreadable referenced artefact is its own category.
    'attachment_unavailable',
  ])
    expect(outboxCodeCheck).toContain(`'${code}'::text`);
  expect(outboxCodeCheck).not.toContain('%');
  const fileLinkForeignKeys = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='event_library_files'::regclass AND contype='f'",
    )
  ).rows.map((row) => row.def);
  expect(fileLinkForeignKeys).toContain(
    'FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, id)',
  );
  expect(fileLinkForeignKeys).toContain(
    'FOREIGN KEY (tenant_id, file_id) REFERENCES library_files(tenant_id, id)',
  );
  // The index answers exactly the filter the file index sends: this tenant, this
  // kind, this due window. No predicate, no expression, no backfill.
  const dueIndex = (
    await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='documents_due_date'",
    )
  ).rows[0]!.indexdef;
  expect(dueIndex).toContain('(tenant_id, kind, due_date)');
  // The source is a document of the same tenant, never another tenant's row.
  const sourceForeignKey = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%source_document_id%'",
    )
  ).rows.map((row) => row.def);
  expect(sourceForeignKey).toContain(
    'FOREIGN KEY (tenant_id, source_document_id) REFERENCES documents(tenant_id, id)',
  );
  // Exactly one confirmation per offer, independent of the confirmation's state.
  const confirmationIndex = (
    await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='documents_one_order_confirmation'",
    )
  ).rows[0]!.indexdef;
  expect(confirmationIndex).toContain('(tenant_id, source_document_id)');
  expect(confirmationIndex).toContain(
    "WHERE (kind = 'order_confirmation'::text)",
  );
  // BKP019.c1: exactly one invoice per confirmation, and the source CHECK grew
  // from confirmations to confirmations and invoices - no other kind.
  const invoiceIndex = (
    await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='documents_one_invoice'",
    )
  ).rows[0]!.indexdef;
  expect(invoiceIndex).toContain('(tenant_id, source_document_id)');
  expect(invoiceIndex).toContain("WHERE (kind = 'invoice'::text)");
  // BKP019.c3.2: the final invoice is the same kind with a role, so the
  // one-invoice rule is deliberately NOT split: one confirmation carries exactly
  // one invoice, standard or final. Only two columns and three CHECKs are new.
  const roleCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND conname='documents_invoice_role_check'",
    )
  ).rows[0]!.def;
  expect(roleCheck).toContain('(invoice_role IS NULL)');
  expect(roleCheck).toContain(
    "((invoice_role = 'final'::text) AND (kind = 'invoice'::text))",
  );
  const appliedCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND conname='documents_deposit_applied_check'",
    )
  ).rows[0]!.def;
  expect(appliedCheck).toContain('deposit_applied_minor >= 0');
  expect(appliedCheck).toContain(
    "deposit_applied_minor <= '9007199254740991'::bigint",
  );
  // The CASE keeps the rule NULL-safe: without a role no amount may exist, with
  // the role the amount is a bounded magnitude or still unfrozen.
  expect(appliedCheck).toContain(
    'WHEN (invoice_role IS NULL) THEN (deposit_applied_minor IS NULL)',
  );
  const appliedFinalCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND conname='documents_deposit_applied_final_check'",
    )
  ).rows[0]!.def;
  expect(appliedFinalCheck).toContain(
    "deposit_applied_minor IS NULL) OR (state = 'final'::text)",
  );
  const settlementColumns = (
    await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='documents'
          AND column_name IN ('invoice_role','deposit_applied_minor')
        ORDER BY column_name`,
    )
  ).rows;
  expect(settlementColumns).toEqual([
    {
      column_name: 'deposit_applied_minor',
      data_type: 'bigint',
      is_nullable: 'YES',
      column_default: null,
    },
    {
      column_name: 'invoice_role',
      data_type: 'text',
      is_nullable: 'YES',
      column_default: null,
    },
  ]);
  const sourceKindCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND conname='documents_source_kind_check'",
    )
  ).rows[0]!.def;
  // BKP019.c2: the same link now also carries a correction, and only these four
  // kinds ever own a source.
  expect(sourceKindCheck).toContain(
    "kind = ANY (ARRAY['order_confirmation'::text, 'invoice'::text, 'correction'::text, 'deposit_invoice'::text])",
  );
  // BKP019.c3.1: several deposits per order are legitimate, so the one-document
  // rule of invoices and confirmations is deliberately not repeated for them.
  const depositUnique = (
    await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='documents'
          AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%deposit_invoice%'`,
    )
  ).rows;
  expect(depositUnique).toEqual([]);
  // A correction carries its direction on the document, never as a sign.
  const correctionDirectionCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND conname='documents_correction_direction_check'",
    )
  ).rows[0]!.def;
  expect(correctionDirectionCheck).toContain(
    "(kind = 'correction'::text) = (correction_direction IS NOT NULL)",
  );
  expect(correctionDirectionCheck).toContain("'credit'::text, 'debit'::text");
  // At most one *open* correction per source; finalized partial credits stay
  // legal, so the index is partial in both dimensions.
  const correctionIndex = (
    await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='documents_one_open_correction'",
    )
  ).rows[0]!.indexdef;
  expect(correctionIndex).toContain('(tenant_id, source_document_id)');
  expect(correctionIndex).toContain(
    "WHERE ((kind = 'correction'::text) AND (state = 'draft'::text))",
  );
  // BKP019.d: a payment belongs to one document of the same tenant, carries a
  // positive magnitude and a closed method set, and is never cascaded away.
  const paymentForeignKey = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='document_payments'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%document_id%'",
    )
  ).rows.map((row) => row.def);
  expect(paymentForeignKey).toEqual([
    'FOREIGN KEY (tenant_id, document_id) REFERENCES documents(tenant_id, id)',
  ]);
  const paymentAmountCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='document_payments'::regclass AND conname='document_payments_amount_minor_check'",
    )
  ).rows[0]!.def;
  expect(paymentAmountCheck).toContain('amount_minor >= 1');
  expect(paymentAmountCheck).toContain(
    "amount_minor <= '9007199254740991'::bigint",
  );
  const paymentMethodCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='document_payments'::regclass AND conname='document_payments_method_check'",
    )
  ).rows[0]!.def;
  expect(paymentMethodCheck).toContain(
    "ARRAY['bank_transfer'::text, 'cash'::text, 'card'::text, 'other'::text]",
  );
  // Partial payments are legitimate, so nothing about the new table is unique
  // beyond its own key; the audit CHECK names the one new action.
  const paymentUnique = (
    await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname='public' AND tablename='document_payments' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%document_id%'",
    )
  ).rows[0]!.count;
  expect(paymentUnique).toBe(0);
  const auditCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='audit_events'::regclass AND conname='audit_events_action_check'",
    )
  ).rows[0]!.def;
  expect(auditCheck).toContain("'payment.recorded'::text");
  expect(auditCheck).toContain("'document.finalized'::text");
  // BKP019.a records how an offer was accepted after the status axis.
  // The acceptance references an own library file through the composite key,
  // so a foreign tenant's file can never be attached.
  const acceptanceForeignKey = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%acceptance_file_id%'",
    )
  ).rows.map((row) => row.def);
  expect(acceptanceForeignKey).toContain(
    'FOREIGN KEY (tenant_id, acceptance_file_id) REFERENCES library_files(tenant_id, id)',
  );
  const templateColumn = (
    await pool.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='template_id'",
    )
  ).rows[0];
  expect(templateColumn?.is_nullable).toBe('YES');
  const templateForeignKey = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%template_id%'",
    )
  ).rows.map((row) => row.def);
  expect(templateForeignKey).toContain(
    'FOREIGN KEY (tenant_id, template_id) REFERENCES document_templates(tenant_id, id)',
  );
  // H034 adds the optional place without touching existing data.
  const columns = (
    await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name IN ('venue','venue_override') ORDER BY column_name",
    )
  ).rows;
  expect(columns).toEqual([
    {
      column_name: 'venue',
      data_type: 'text',
      is_nullable: 'YES',
      column_default: null,
    },
    {
      column_name: 'venue_override',
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    },
  ]);
  const constraints = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='events'::regclass AND pg_get_constraintdef(oid) ILIKE '%venue%'",
    )
  ).rows.map((row) => row.def);
  expect(constraints).toContain(
    'CHECK (((venue IS NULL) OR (length(venue) <= 1000)))',
  );
  await migrate(pool);
  expect((await pool.query('SELECT * FROM ak_migrations')).rowCount).toBe(
    names.length,
  );
  await pool.query("UPDATE ak_migrations SET checksum = 'tampered'");
  await expect(migrate(pool)).rejects.toThrow('Migration checksum mismatch');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await expect(
    migrate(pool, [
      {
        name: 'broken.sql',
        sql: 'CREATE TABLE partial(id int); SELECT missing FROM partial',
      },
    ]),
  ).rejects.toThrow();
  expect(
    (await pool.query("SELECT to_regclass('partial') AS table")).rows[0].table,
  ).toBeNull();
  const migrations = await Promise.all(
      names
        .filter((name) => name < '0036_document_layout_logo_keys.sql')
        .map(async (name) => ({
          name,
          sql: await readFile(new URL(name, directory), 'utf8'),
        })),
    ),
    logoMigration = {
      name: '0036_document_layout_logo_keys.sql',
      sql: await readFile(
        new URL('0036_document_layout_logo_keys.sql', directory),
        'utf8',
      ),
    },
    legacyTenantId = randomUUID();
  await migrate(pool, migrations);
  await pool.query('INSERT INTO tenants (id,name,timezone) VALUES ($1,$2,$3)', [
    legacyTenantId,
    'Synthetic logo tenant',
    'Europe/Berlin',
  ]);
  await pool.query(
    `INSERT INTO document_layouts (
      tenant_id,sender_name,sender_street,sender_postal_code,sender_city,
      primary_color,text_color,font_family,logo_key,logo_media_type
    ) VALUES ($1,'Synthetic sender','','','Synthetic city','#123456','#123456','system',$2,'image/png')`,
    [legacyTenantId, `logo-${legacyTenantId}.png`],
  );
  await migrate(pool, [logoMigration]);
  expect(
    (
      await pool.query(
        'SELECT logo_key,logo_media_type FROM document_layouts WHERE tenant_id=$1',
        [legacyTenantId],
      )
    ).rows[0],
  ).toEqual({
    logo_key: `logo-${legacyTenantId}.png`,
    logo_media_type: 'image/png',
  });
  await migrate(pool);
});
test('repositories isolate tenants, enforce uniqueness and compound foreign keys', async () => {
  const a = identityRepository(pool, randomUUID());
  const b = identityRepository(pool, randomUUID());
  await a.createTenant('Synthetic A', 'Europe/Berlin');
  await b.createTenant('Synthetic B', 'Europe/Berlin');
  const user = await a.addAdministrator(
    'synthetic-subject',
    'synthetic@example.invalid',
  );
  expect(await a.findAdministrator('synthetic-subject')).toEqual(user);
  expect(await b.findAdministrator('synthetic-subject')).toBeUndefined();
  await b.addAdministrator('synthetic-subject', 'synthetic@example.invalid');
  await expect(
    a.addAdministrator('other', 'synthetic@example.invalid'),
  ).rejects.toThrow();
  await expect(
    a.addAdministrator('synthetic-subject', 'other@example.invalid'),
  ).rejects.toThrow();
  await expect(
    pool.query('INSERT INTO memberships (tenant_id, user_id) VALUES ($1, $2)', [
      b.tenantId,
      user!.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query(
      'INSERT INTO users (tenant_id, id, google_subject, email) VALUES ($1,$2,$3,$4)',
      [a.tenantId, randomUUID(), 'bad', 'UPPER@example.invalid'],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await pool.query(
    'UPDATE memberships SET active = false WHERE tenant_id = $1',
    [a.tenantId],
  );
  expect(await a.findAdministrator('synthetic-subject')).toBeUndefined();
});
