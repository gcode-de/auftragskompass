import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { migrate } from '../../packages/core/src/identity.js';

let container: StartedPostgreSqlContainer, pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('0033 makes only contact_id nullable and preserves legacy rows, FK, unique and hash checks', async () => {
  const database = 'synthetic_inquiry_upgrade';
  await pool.query('CREATE DATABASE ' + database);
  const url = new URL(container.getConnectionUri());
  url.pathname = '/' + database;
  const upgrade = new Pool({ connectionString: url.href });
  try {
    const directory = new URL(
      '../../packages/core/migrations/',
      import.meta.url,
    );
    const names = (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const before = names.filter((name) => name < '0033');
    expect(before.at(-1)).toBe('0032_event_venue.sql');
    await migrate(
      upgrade,
      await Promise.all(
        before.map(async (name) => ({
          name,
          sql: await readFile(new URL(name, directory), 'utf8'),
        })),
      ),
    );
    const tenant = randomUUID(),
      contact = randomUUID(),
      event = randomUUID(),
      inquiry = randomUUID();
    await upgrade.query(
      "INSERT INTO tenants (id,name,timezone) VALUES ($1,'Fictional upgrade','Europe/Berlin')",
      [tenant],
    );
    await upgrade.query(
      `INSERT INTO contacts(tenant_id,id,kind,name,contact_person,street,postal_code,city,country,email,phone,mobile,phone_key,mobile_key,state)
       VALUES($1,$2,'private','Fictional Legacy','','','','','DE','legacy@example.invalid','','','','','active')`,
      [tenant, contact],
    );
    await upgrade.query(
      `INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html)
       VALUES($1,$2,'Fictional legacy event','inquiry','Website: fotobox-bw-main (v1)','2030-10-27','Europe/Berlin','Fictional','')`,
      [tenant, event],
    );
    const payload = { id: inquiry, seed: 'fictional' };
    await upgrade.query(
      `INSERT INTO website_inquiries(tenant_id,id,contact_id,event_id,payload,payload_hash,received_at,expires_at)
       VALUES($1,$2,$3,$4,$5::jsonb,encode(sha256(convert_to(($5::jsonb)::text,'UTF8')),'hex'),'2030-10-26T10:00:00Z','2030-10-27T10:00:00Z')`,
      [tenant, inquiry, contact, event, JSON.stringify(payload)],
    );
    const countBefore = (
      await upgrade.query<{ count: string }>(
        'SELECT count(*) FROM ak_migrations',
      )
    ).rows[0]!.count;

    // Applying the remaining forward migrations twice must succeed and record
    // each file exactly once.
    await migrate(upgrade);
    await migrate(upgrade);
    expect(
      (
        await upgrade.query<{ count: string }>(
          'SELECT count(*) FROM ak_migrations',
        )
      ).rows[0]!.count,
    ).toBe(String(Number(countBefore) + names.length - before.length));
    expect(
      (
        await upgrade.query<{ is_nullable: string }>(
          "SELECT is_nullable FROM information_schema.columns WHERE table_name='website_inquiries' AND column_name='contact_id'",
        )
      ).rows[0]!.is_nullable,
    ).toBe('YES');

    // The legacy receipt is untouched.
    expect(
      (
        await upgrade.query(
          'SELECT contact_id,event_id,payload FROM website_inquiries WHERE tenant_id=$1 AND id=$2',
          [tenant, inquiry],
        )
      ).rows[0],
    ).toEqual({ contact_id: contact, event_id: event, payload });

    const secondEvent = randomUUID(),
      secondInquiry = randomUUID();
    await upgrade.query(
      `INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html)
       VALUES($1,$2,'Fictional open event','option','Website: fotobox-bw-main (v1)','2030-10-27','Europe/Berlin','Fictional','')`,
      [tenant, secondEvent],
    );
    const openPayload = { id: secondInquiry, seed: 'fictional-open' };
    await upgrade.query(
      `INSERT INTO website_inquiries(tenant_id,id,contact_id,event_id,payload,payload_hash,received_at,expires_at)
       VALUES($1,$2,NULL,$3,$4::jsonb,encode(sha256(convert_to(($4::jsonb)::text,'UTF8')),'hex'),'2030-10-26T10:00:00Z','2030-10-27T10:00:00Z')`,
      [tenant, secondInquiry, secondEvent, JSON.stringify(openPayload)],
    );
    await expect(
      upgrade.query(
        'INSERT INTO website_inquiries SELECT * FROM website_inquiries WHERE tenant_id=$1 AND id=$2',
        [tenant, secondInquiry],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const foreign = randomUUID(),
      foreignContact = randomUUID(),
      thirdEvent = randomUUID(),
      thirdInquiry = randomUUID();
    await upgrade.query(
      "INSERT INTO tenants (id,name,timezone) VALUES ($1,'Fictional foreign','UTC')",
      [foreign],
    );
    await upgrade.query(
      `INSERT INTO contacts(tenant_id,id,kind,name,contact_person,street,postal_code,city,country,email,phone,mobile,phone_key,mobile_key,state)
       VALUES($1,$2,'private','Fictional Foreign','','','','','DE','foreign@example.invalid','','','','','active')`,
      [foreign, foreignContact],
    );
    await upgrade.query(
      `INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html)
       VALUES($1,$2,'Fictional third event','option','Website: fotobox-bw-main (v1)','2030-10-27','Europe/Berlin','Fictional','')`,
      [tenant, thirdEvent],
    );
    const thirdPayload = { id: thirdInquiry, seed: 'fictional-tenant' };
    await expect(
      upgrade.query(
        `INSERT INTO website_inquiries(tenant_id,id,contact_id,event_id,payload,payload_hash,received_at,expires_at)
         VALUES($1,$2,$3,$4,$5::jsonb,encode(sha256(convert_to(($5::jsonb)::text,'UTF8')),'hex'),'2030-10-26T10:00:00Z','2030-10-27T10:00:00Z')`,
        [
          tenant,
          thirdInquiry,
          foreignContact,
          thirdEvent,
          JSON.stringify(thirdPayload),
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      upgrade.query(
        "UPDATE website_inquiries SET payload=jsonb_set(payload,'{seed}','\"Fictional tamper\"'::jsonb) WHERE tenant_id=$1 AND id=$2",
        [tenant, secondInquiry],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await upgrade.end();
    await pool.query('DROP DATABASE IF EXISTS ' + database);
  }
});
