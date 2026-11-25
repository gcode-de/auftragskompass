import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import { eventRepository } from '../../packages/core/src/events.js';

// QW2 (C071): a cancelled event names one active cancellation reason of its
// own tenant; the database keeps a reason off every other status.
let container: StartedPostgreSqlContainer;
let pool: Pool;
const tenantId = randomUUID(),
  otherTenantId = randomUUID();
let actorId: string;

const input = {
  name: 'Synthetic cancelled event',
  status: 'inquiry' as 'inquiry' | 'cancelled' | 'option',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  primaryContactId: null,
  additionalContactIds: [],
  source: 'Manual synthetic fixture',
  eventDate: null,
  startsAt: null,
  endsAt: null,
  description: 'Fictional event',
  notesHtml: '',
};

async function createTenant(id: string, email: string) {
  await bootstrapAccess(pool, id, email, 'Synthetic tenant', 'Europe/Berlin');
  await accessRepository(pool, id).issueSession(
    { subject: email, email },
    `${email}-digest`,
  );
  return (await accessRepository(pool, id).list())[0]!.userId!;
}
async function reasons(tenant: string) {
  return (
    await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM master_data
        WHERE tenant_id = $1 AND kind = 'cancellation_reason'
        ORDER BY position`,
      [tenant],
    )
  ).rows;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  actorId = await createTenant(tenantId, 'cancel@example.invalid');
  await createTenant(otherTenantId, 'other-cancel@example.invalid');
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('a cancelled event keeps its reason until it leaves the status', async () => {
  const repo = eventRepository(pool, tenantId);
  const [price, other] = await reasons(tenantId);
  const created = await repo.save(actorId, input);
  expect(created.cancellationReasonId).toBeNull();

  const cancelled = await repo.save(
    actorId,
    { ...input, status: 'cancelled', cancellationReasonId: price!.id },
    created.id,
    created.version,
  );
  expect(cancelled.cancellationReasonId).toBe(price!.id);

  // A writer that does not send the field (inline edit, older bundle) keeps
  // the stored reason.
  const renamed = await repo.save(
    actorId,
    { ...input, status: 'cancelled', name: 'Synthetic renamed event' },
    cancelled.id,
    cancelled.version,
  );
  expect(renamed.cancellationReasonId).toBe(price!.id);

  const changed = await repo.save(
    actorId,
    { ...input, status: 'cancelled', cancellationReasonId: other!.id },
    renamed.id,
    renamed.version,
  );
  expect(changed.cancellationReasonId).toBe(other!.id);

  const cleared = await repo.save(
    actorId,
    { ...input, status: 'cancelled', cancellationReasonId: null },
    changed.id,
    changed.version,
  );
  expect(cleared.cancellationReasonId).toBeNull();

  const again = await repo.save(
    actorId,
    { ...input, status: 'cancelled', cancellationReasonId: price!.id },
    cleared.id,
    cleared.version,
  );
  const reopened = await repo.save(
    actorId,
    { ...input, status: 'option' },
    again.id,
    again.version,
  );
  expect(reopened.cancellationReasonId).toBeNull();
});

test('foreign, archived, wrong-kind and misplaced reasons are refused', async () => {
  const repo = eventRepository(pool, tenantId);
  const [own, archived] = (await reasons(tenantId)).slice(2);
  const [foreign] = await reasons(otherTenantId);
  const created = await repo.save(actorId, input);
  const refused = (cancellationReasonId: string, status = 'cancelled') =>
    repo.save(
      actorId,
      {
        ...input,
        status: status as 'cancelled',
        cancellationReasonId,
      },
      created.id,
      created.version,
    );

  await expect(refused(foreign!.id)).rejects.toMatchObject({
    message: 'invalid_reference',
  });
  await expect(refused(randomUUID())).rejects.toMatchObject({
    message: 'invalid_reference',
  });
  const [eventType] = (
    await pool.query<{ id: string }>(
      `INSERT INTO master_data (tenant_id, id, kind, name, position, state)
       VALUES ($1, gen_random_uuid(), 'event_type', 'Synthetic type', 99,
               'active') RETURNING id`,
      [tenantId],
    )
  ).rows;
  await expect(refused(eventType!.id)).rejects.toMatchObject({
    message: 'invalid_reference',
  });
  await expect(refused(own!.id, 'option')).rejects.toMatchObject({
    message: 'invalid_fields',
  });

  // A reason archived after it was chosen stays on the event, but cannot be
  // newly chosen.
  const cancelled = await repo.save(
    actorId,
    { ...input, status: 'cancelled', cancellationReasonId: archived!.id },
    created.id,
    created.version,
  );
  await pool.query(
    `UPDATE master_data SET state = 'archived'
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, archived!.id],
  );
  const kept = await repo.save(
    actorId,
    { ...input, status: 'cancelled', cancellationReasonId: archived!.id },
    cancelled.id,
    cancelled.version,
  );
  expect(kept.cancellationReasonId).toBe(archived!.id);
  const second = await repo.save(actorId, input);
  await expect(
    repo.save(
      actorId,
      { ...input, status: 'cancelled', cancellationReasonId: archived!.id },
      second.id,
      second.version,
    ),
  ).rejects.toMatchObject({ message: 'invalid_reference' });
});

test('the database keeps a reason off other statuses and other tenants', async () => {
  const repo = eventRepository(pool, tenantId);
  const [own] = await reasons(tenantId);
  const [foreign] = await reasons(otherTenantId);
  const created = await repo.save(actorId, input);
  await expect(
    pool.query(
      `UPDATE events SET cancellation_reason_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, created.id, own!.id],
    ),
  ).rejects.toMatchObject({
    constraint: 'events_cancellation_reason_status_check',
  });
  await expect(
    pool.query(
      `UPDATE events SET status = 'cancelled', cancellation_reason_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, created.id, foreign!.id],
    ),
  ).rejects.toMatchObject({ constraint: 'events_cancellation_reason_fk' });
});
