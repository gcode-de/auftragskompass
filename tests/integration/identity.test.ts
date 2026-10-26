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
  // BKP019.c1: an invoice is linked to the confirmation it was copied from.
  expect(applied.at(-1)!.name).toBe('0042_invoice_source.sql');
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
  const sourceKindCheck = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='documents'::regclass AND conname='documents_source_kind_check'",
    )
  ).rows[0]!.def;
  expect(sourceKindCheck).toContain(
    "kind = ANY (ARRAY['order_confirmation'::text, 'invoice'::text])",
  );
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
