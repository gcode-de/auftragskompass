import { prepareWebsiteInquiryAcknowledgement } from './packages/core/dist/website-inquiry-ack.js';
import { stageWebsiteInquiry } from './packages/core/dist/website-inquiry-deliveries.js';
// Fed to Node over stdin in the disposable runtime image, whose cwd is /app.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import Fastify from 'fastify';
import { loadRuntimeConfig } from './packages/core/dist/runtime.js';
import { migrate } from './packages/core/dist/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from './packages/core/dist/access.js';
import {
  bootstrapPassword,
  passwordAccess,
} from './packages/core/dist/password-access.js';
import { registerAuth, digest } from './packages/core/dist/auth.js';
import { contactRepository } from './packages/core/dist/contacts.js';
import { eventRepository } from './packages/core/dist/events.js';
import { productRepository } from './packages/core/dist/products.js';
import { resourceRepository } from './packages/core/dist/resources.js';
import { receiveWebsiteInquiry } from './packages/core/dist/website-inquiries.js';
import { inquiryFormV1 } from './packages/core/dist/inquiry-form.js';
import { reservationRepository } from './packages/core/dist/reservations.js';

const mode = process.argv[2];
assert.ok(['seed', 'verify'].includes(mode));
const config = loadRuntimeConfig(process.env, (path) =>
  readFileSync(path, 'utf8'),
);
const expectedHost =
  process.argv[3] ?? (mode === 'seed' ? 'database' : 'restore-database');
assert.ok(['database', 'restore-database'].includes(expectedHost));
assert.equal(config.host, expectedHost);
const pool = new Pool({
  host: config.host,
  port: config.dbPort,
  user: config.user,
  password: config.password,
  database: config.database,
});
const tenant = '00000000-0000-4000-8000-000000000122';
const foreign = '00000000-0000-4000-8000-000000000123';
const email = 'fictional.restore@example.invalid';
const password = 'Fictional restore password 123!';
const inquiry = {
  id: '00000000-0000-4000-8000-000000000124',
  receivedAt: '2030-10-26T10:00:00.000Z',
  expiresAt: '2030-10-27T10:00:00.000Z',
  submission: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    fields: {
      firstName: 'Fictional restored',
      lastName: 'contact',
      email: 'restore.contact@example.invalid',
      eventDate: '2030-10-27',
      comment: 'Fictional original <restore> inquiry',
    },
  },
  privacyNotice: inquiryFormV1.privacyNotice,
  privacyUrl: inquiryFormV1.privacyUrl,
};
const stagedInquiry = {
  ...inquiry,
  id: '00000000-0000-4000-8000-000000000125',
};
const cookies = { '__Host-ak-session': 'synthetic-restore-session' };
try {
  if (mode === 'seed') {
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM tenants')).rows[0]
        .count,
      0,
      'Only an empty synthetic tenant store may be seeded',
    );
    await bootstrapAccess(
      pool,
      tenant,
      email,
      'Fictional restore tenant',
      'UTC',
    );
    await bootstrapAccess(
      pool,
      foreign,
      'fictional.foreign@example.invalid',
      'Fictional foreign restore tenant',
      'UTC',
    );
    await bootstrapPassword(
      pool,
      tenant,
      email,
      'fictional.restore',
      () => password,
    );
    const actor = (await accessRepository(pool, tenant).list())[0].userId;
    const person = await contactRepository(pool, tenant).save(actor, {
      kind: 'private',
      name: 'Fictional restored contact',
      contactPerson: '',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      email: 'restore.contact@example.invalid',
      phone: '',
      mobile: '',
      state: 'active',
    });
    await productRepository(pool, tenant).save(actor, {
      name: 'Fictional restored product',
      description: 'Synthetic restore fixture',
      unit: 'piece',
      priceMinor: 12345,
      priceBasis: 'gross',
      taxBasisPoints: 1900,
      state: 'active',
      position: 0,
    });
    const box = await resourceRepository(pool, tenant).save(actor, {
      name: 'Fictional restored box',
      code: 'FICTIONAL-RESTORE',
      category: 'Fotobox',
      description: 'Synthetic restore fixture',
      quantity: 1,
      beforeDays: 1,
      afterDays: 1,
      blocked: false,
      state: 'active',
      position: 0,
    });
    const unit = (await reservationRepository(pool, tenant).units(box.id))[0];
    const start = new Date(Date.now() + 10 * 86400000);
    const input = {
      name: 'Fictional restored event',
      status: 'booked',
      eventTypeId: null,
      packageId: null,
      locationId: null,
      primaryContactId: person.id,
      additionalContactIds: [],
      source: 'Synthetic restore fixture',
      eventDate: start.toISOString().slice(0, 10),
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 7200000).toISOString(),
      description: 'Synthetic restore fixture',
      notesHtml: '<p>Fictional restored note</p>',
    };
    await eventRepository(pool, tenant).save(
      actor,
      input,
      undefined,
      undefined,
      [{ unitId: unit.id, periodSource: 'event' }],
    );
    assert.deepEqual(
      await stageWebsiteInquiry(
        pool,
        tenant,
        actor,
        stagedInquiry,
        new Date(inquiry.receivedAt),
      ),
      { status: 'stored' },
    );
    const acknowledgement = await prepareWebsiteInquiryAcknowledgement(
      pool,
      tenant,
      actor,
      new Date(inquiry.receivedAt),
    );
    assert.deepEqual(acknowledgement.inquiryIds, [stagedInquiry.id]);
    await receiveWebsiteInquiry(
      pool,
      tenant,
      actor,
      inquiry,
      new Date(inquiry.receivedAt),
      {},
    );
    assert.equal(
      await passwordAccess(pool, tenant).issueSession(
        'fictional.restore',
        password,
        digest(cookies['__Host-ak-session']),
      ),
      true,
    );
  } else {
    assert.equal(
      (await pool.query("SELECT to_regclass('public.tenants') AS name")).rows[0]
        .name,
      'tenants',
      'Synthetic restore schema missing',
    );
    const people = await contactRepository(pool, tenant).list();
    assert.equal(people.length, 1);
    assert.equal(people[0].name, 'Fictional restored contact');
    const restoredEvents = await eventRepository(pool, tenant).list();
    assert.equal(restoredEvents.length, 2);
    const events = restoredEvents.filter((event) => event.status === 'booked');
    assert.equal(events.length, 1);
    assert.equal(events[0].status, 'booked');
    const detail = await eventRepository(pool, tenant).detail(events[0].id);
    assert.equal(detail.contacts[0].id, people[0].id);
    assert.equal(detail.event.notesHtml, '<p>Fictional restored note</p>');
    const original = (
      await pool.query(
        'SELECT payload,event_id,contact_id FROM website_inquiries WHERE tenant_id=$1 AND id=$2',
        [tenant, inquiry.id],
      )
    ).rows[0];
    const actor = (await accessRepository(pool, tenant).list())[0].userId;
    assert.deepEqual(original.payload, inquiry);
    const staged = (
      await pool.query(
        'SELECT payload,staged_at FROM website_inquiry_deliveries WHERE tenant_id=$1 AND id=$2',
        [tenant, stagedInquiry.id],
      )
    ).rows[0];
    assert.deepEqual(staged.payload, stagedInquiry);
    assert.equal(staged.staged_at.toISOString(), inquiry.receivedAt);
    const previousAck = (
      await pool.query(
        'SELECT id FROM website_inquiry_ack_operations WHERE tenant_id=$1 AND completed_at IS NULL',
        [tenant],
      )
    ).rows[0];
    const retryAck = await prepareWebsiteInquiryAcknowledgement(
      pool,
      tenant,
      actor,
      new Date('2030-11-01T10:00:00.000Z'),
    );
    assert.equal(retryAck.operationId, previousAck.id);
    assert.deepEqual(retryAck.inquiryIds, [stagedInquiry.id]);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*) FROM website_inquiry_ack_attempts WHERE tenant_id=$1',
          [tenant],
        )
      ).rows[0].count,
      '2',
    );
    assert.deepEqual(
      await stageWebsiteInquiry(
        pool,
        tenant,
        actor,
        stagedInquiry,
        new Date('2030-11-01T10:00:00.000Z'),
      ),
      { status: 'duplicate' },
    );

    assert.equal(original.contact_id, people[0].id);
    const received = await eventRepository(pool, tenant).detail(
      original.event_id,
    );
    assert.equal(received.event.status, 'inquiry');
    assert.ok(
      received.activities.some(
        (row) =>
          row.description ===
          'Website-Anfrage empfangen: fotobox-bw-main (v1).',
      ),
    );
    assert.equal(
      (
        await receiveWebsiteInquiry(
          pool,
          tenant,
          actor,
          inquiry,
          new Date('2030-11-01T10:00:00Z'),
          {},
        )
      ).status,
      'duplicate',
    );
    const product = (await productRepository(pool, tenant).list())[0];
    assert.equal(product.priceMinor, 12345);
    assert.equal(product.priceBasis, 'gross');
    assert.equal(product.taxBasisPoints, 1900);
    const booked = await reservationRepository(pool, tenant).list(events[0].id);
    assert.equal(booked.length, 1);
    assert.equal(booked[0].state, 'booked');
    assert.equal(booked[0].beforeDays, 1);
    assert.equal(booked[0].afterDays, 1);
    assert.deepEqual(await contactRepository(pool, foreign).list(), []);
    assert.deepEqual(await eventRepository(pool, foreign).list(), []);
    await assert.rejects(
      pool.query(
        "INSERT INTO event_contacts(tenant_id,event_id,contact_id,role) VALUES($1,$2,$3,'additional')",
        [foreign, events[0].id, people[0].id],
      ),
      { code: '23503' },
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO reservations(tenant_id,id,request_id,request_hash,event_id,unit_id,state,period_source,base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at,expires_at,block_reason) SELECT tenant_id,gen_random_uuid(),gen_random_uuid(),request_hash,NULL,unit_id,'blocked','manual',base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at,NULL,'Fictional restored overlap check' FROM reservations WHERE tenant_id=$1 AND state='booked'",
        [tenant],
      ),
      { code: '23P01' },
    );
    await assert.rejects(
      pool.query('UPDATE audit_events SET action=action WHERE tenant_id=$1', [
        tenant,
      ]),
      { code: '23514' },
    );
    const ledger = (
      await pool.query('SELECT * FROM ak_migrations ORDER BY name')
    ).rows;
    assert.ok(ledger.length > 0);
    await migrate(pool);
    assert.deepEqual(
      (await pool.query('SELECT * FROM ak_migrations ORDER BY name')).rows,
      ledger,
    );
    for (const [scope, status] of [
      [tenant, 200],
      [foreign, 401],
    ]) {
      const app = Fastify();
      try {
        await registerAuth(app, pool, {
          mode: 'password',
          origin: 'https://restore.example.invalid',
          tenantId: scope,
        });
        assert.equal(
          (await app.inject({ url: '/auth/me', cookies })).statusCode,
          status,
        );
        assert.equal((await app.inject('/auth/me')).statusCode, 401);
      } finally {
        await app.close();
      }
    }
    assert.equal(
      await passwordAccess(pool, tenant).issueSession(
        'fictional.restore',
        'Fictional incorrect password',
        digest('synthetic-restored-invalid'),
      ),
      false,
    );
    assert.equal(
      await passwordAccess(pool, tenant).issueSession(
        'fictional.restore',
        password,
        digest('synthetic-restored-new-session'),
      ),
      true,
    );
  }
  console.log(
    mode === 'seed'
      ? 'Fictional domain fixture created'
      : 'Restored domain, authentication and database invariants verified',
  );
} finally {
  await pool.end();
}
