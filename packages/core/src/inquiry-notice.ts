import { Temporal } from '@js-temporal/polyfill';
import { sql } from 'drizzle-orm';
import type { Connection } from './database.js';
import { database } from './database.js';
import { bufferedPeriod } from './reservation-rules.js';

// INQUIRY-INFO-01: the facts a website-inquiry notification carries beside
// the form fields: how many units per resource category are free on the
// event date, where the event (or its day) lives in the admin, and a
// one-click answer mail to the inquirer. Both notification channels (the
// Telegram message and the e-mail) use the same extras, so they can never
// disagree.
//
// The counting reuses `bufferedPeriod`, the single derivation of the
// blocking semantics - a unit counts as free exactly when no active
// reservation with its buffered period reaches the day.

export type InquiryNoticeExtras = {
  freeUnits: Array<{ category: string; free: number; total: number }>;
  /** Where the event lives in the admin; `exact` names the event itself. */
  eventLink: { href: string; exact: boolean } | null;
  /** A mailto: link that opens an answer to the inquirer. */
  replyLink: string | null;
};

const blockingStates = ['hold', 'booked', 'blocked'] as const;

type UnitRow = {
  unitId: string;
  category: string;
  beforeDays: number;
  afterDays: number;
};

type ReservationRow = {
  unitId: string;
  startsAt: string;
  endsAt: string;
  state: string;
};

/**
 * Pure counting: units are grouped by their resource category, and a unit
 * is free when no blocking reservation's buffered period reaches the day.
 * `day` is a plain calendar date in `timeZone` (the tenant's zone).
 */
export function countFreeUnits(
  units: readonly UnitRow[],
  reservations: readonly ReservationRow[],
  day: string,
  timeZone: string,
): Array<{ category: string; free: number; total: number }> {
  const dayStart = Temporal.PlainDate.from(day)
      .toZonedDateTime(timeZone)
      .toInstant(),
    dayEnd = Temporal.PlainDate.from(day)
      .add({ days: 1 })
      .toZonedDateTime(timeZone)
      .toInstant();
  const blockedUnits = new Set<string>();
  for (const reservation of reservations) {
    if (!(blockingStates as readonly string[]).includes(reservation.state))
      continue;
    const unit = units.find((row) => row.unitId === reservation.unitId);
    if (!unit) continue;
    let period: ReturnType<typeof bufferedPeriod> | null;
    try {
      period = bufferedPeriod(
        reservation.startsAt,
        reservation.endsAt,
        timeZone,
        unit.beforeDays,
        unit.afterDays,
      );
    } catch {
      // The create path refuses such rows; a stored one that still fails to
      // parse is treated as blocking - a wrongly "free" box is worse than a
      // conservative count.
      period = null;
    }
    const reachesDay =
      period === null
        ? true
        : period.startsAt.getTime() < dayEnd.epochMilliseconds &&
          period.endsAt.getTime() > dayStart.epochMilliseconds;
    if (reachesDay) blockedUnits.add(reservation.unitId);
  }
  const groups = new Map<string, { free: number; total: number }>();
  for (const unit of units) {
    const group = groups.get(unit.category) ?? { free: 0, total: 0 };
    group.total += 1;
    if (!blockedUnits.has(unit.unitId)) group.free += 1;
    groups.set(unit.category, group);
  }
  return [...groups.entries()]
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((a, b) => a.category.localeCompare(b.category, 'de'));
}

/** 2030-10-26 -> 26.10.2030, the date form the rest of the app speaks. */
export function formatNoticeDate(day: string): string {
  return day.split('-').reverse().join('.');
}

function isSafeMailtoAddress(value: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>".]+\.[^\s@,;<>".]+$/.test(value);
}

/**
 * The extras for one inquiry. `origin` is the admin address (no trailing
 * slash needed); without it no link line can honestly exist and both links
 * are null. The event link points at the event itself once the import has
 * created it; before that it points at the day in the events view.
 */
export async function inquiryNoticeExtras(
  connection: Connection,
  tenantId: string,
  options: { origin: string },
  inquiry: { id: string; eventDate?: string | null; email?: string | null },
): Promise<InquiryNoticeExtras> {
  const origin = options.origin.replace(/\/+$/, '');
  const base: InquiryNoticeExtras = {
    freeUnits: [],
    eventLink: null,
    replyLink: null,
  };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(inquiry.eventDate ?? '')
    ? (inquiry.eventDate as string)
    : null;
  if (!day && !origin) return base;
  const eventId = await database(connection).transaction(async (tx) => {
    if (day) {
      const { rows } = await tx.execute<{
        unit_id: string;
        category: string;
        before_days: number;
        after_days: number;
      }>(
        sql`SELECT u.id AS unit_id, r.category, r.before_days, r.after_days
              FROM resource_units u
              JOIN resources r
                ON r.tenant_id = u.tenant_id AND r.id = u.resource_id
             WHERE u.tenant_id = ${tenantId}
               AND u.enabled = true
               AND r.state = 'active'
               AND r.blocked = false`,
      );
      const units: UnitRow[] = rows.map((row) => ({
        unitId: row.unit_id,
        category: row.category,
        beforeDays: row.before_days,
        afterDays: row.after_days,
      }));
      const reservations: ReservationRow[] = units.length
        ? (
            await tx.execute<{
              unit_id: string;
              starts_at: Date;
              ends_at: Date;
              state: string;
            }>(
              sql`SELECT unit_id, starts_at::text AS starts_at,
                         ends_at::text AS ends_at, state
                    FROM reservations
                   WHERE tenant_id = ${tenantId}
                     AND state IN ('hold','booked','blocked')`,
            )
          ).rows.map((row) => ({
            unitId: row.unit_id,
            // Raw SQL answers timestamps as strings; `bufferedPeriod` wants
            // parseable instants.
            startsAt: new Date(row.starts_at).toISOString(),
            endsAt: new Date(row.ends_at).toISOString(),
            state: row.state,
          }))
        : [];
      const { rows: tenantRows } = await tx.execute<{
        timezone: string;
      }>(sql`SELECT timezone FROM tenants WHERE id = ${tenantId}`);
      base.freeUnits = countFreeUnits(
        units,
        reservations,
        day,
        tenantRows[0]?.timezone ?? 'Europe/Berlin',
      );
    }
    if (!origin) return null;
    const { rows: inquiryRows } = await tx.execute<{ event_id: string }>(
      sql`SELECT event_id FROM website_inquiries
           WHERE tenant_id = ${tenantId} AND id = ${inquiry.id}`,
    );
    return inquiryRows[0]?.event_id ?? null;
  });
  if (!origin) return base;
  base.eventLink = eventId
    ? { href: `${origin}/#event-${eventId}`, exact: true }
    : day
      ? {
          href: `${origin}/?from=${day}&to=${day}#events`,
          exact: false,
        }
      : null;
  const email = (inquiry.email ?? '').trim();
  base.replyLink = isSafeMailtoAddress(email)
    ? `mailto:${email}?subject=${encodeURIComponent('Ihre Anfrage')}`
    : null;
  return base;
}
