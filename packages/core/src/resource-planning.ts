import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

// RES-BKP-03: Bookitup's "Planung" of one resource - every live planning of
// its units, per event and period: how many units, whether they are firmly
// booked, and the event with its status. The units themselves form the
// "Bestand". Reading only; planning stays in the event (and its database
// guarantees).

export type ResourcePlan = {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  eventStatus: string;
  startsAt: string;
  endsAt: string;
  quantity: number;
  confirmed: boolean;
};

export function registerResourcePlanningRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/resources/:id/planning',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      const db = drizzle(pool),
        { id } = request.params;
      const resource = await db.execute<{ time_zone: string }>(sql`
        SELECT t.timezone AS time_zone
          FROM resources r JOIN tenants t ON t.id = r.tenant_id
         WHERE r.tenant_id = ${tenantId} AND r.id = ${id}`);
      if (!resource.rows.length)
        return reply.code(404).send({ error: 'not_found' });
      const units = await db.execute<{
        id: string;
        ordinal: number;
        enabled: boolean;
      }>(sql`
        SELECT id, ordinal, enabled FROM resource_units
         WHERE tenant_id = ${tenantId} AND resource_id = ${id}
         ORDER BY ordinal`);
      const plans = await db.execute<{
        event_id: string;
        event_name: string;
        event_date: string | null;
        event_status: string;
        starts_at: Date;
        ends_at: Date;
        quantity: number;
        confirmed: boolean;
      }>(sql`
        SELECT e.id AS event_id, e.name AS event_name,
               to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
               e.status AS event_status,
               r.base_start AS starts_at, r.base_end AS ends_at,
               count(*)::int AS quantity,
               bool_and(r.state = 'booked') AS confirmed
          FROM reservations r
          JOIN resource_units u
            ON u.tenant_id = r.tenant_id AND u.id = r.unit_id
          JOIN events e
            ON e.tenant_id = r.tenant_id AND e.id = r.event_id
         WHERE r.tenant_id = ${tenantId} AND u.resource_id = ${id}
           AND reservation_is_active(r.state, r.expires_at, now())
           AND r.state IN ('hold', 'booked')
         GROUP BY e.id, e.name, e.event_date, e.status,
                  r.base_start, r.base_end
         ORDER BY r.base_start, e.name`);
      return {
        timeZone: resource.rows[0]!.time_zone,
        units: units.rows,
        plans: plans.rows.map((row): ResourcePlan => ({
          eventId: row.event_id,
          eventName: row.event_name,
          eventDate: row.event_date,
          eventStatus: row.event_status,
          startsAt: new Date(row.starts_at).toISOString(),
          endsAt: new Date(row.ends_at).toISOString(),
          quantity: row.quantity,
          confirmed: row.confirmed,
        })),
      };
    },
  );
}
