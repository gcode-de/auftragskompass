import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { documents, tenants } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';

// BKP019.d: an operator records money that arrived - nothing here talks to a
// bank, a card terminal or a payment provider. RG-09 names the four fields
// (date, amount, method, note); the method list is our own documented
// convention because the requirement names no value set.
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'other';
export const paymentMethods = [
  'bank_transfer',
  'cash',
  'card',
  'other',
] as const;
export const paymentNoteMaxLength = 2000;
// The same magnitude bound as every other stored amount.
export const maxPaymentMinor = 9007199254740991;
// Derived, never stored: "offen" is the absence of a payment, not a status an
// operator or a print can write. "Überfällig" is deliberately absent - without a
// payment term (RG-07, its own slice) a due date would be invented.
export type PaymentState = 'none' | 'partial' | 'paid';
export const paymentStates = ['none', 'partial', 'paid'] as const;

export class DocumentPaymentError extends Error {
  constructor(
    readonly reason:
      // Not this tenant's document, or no document at all.
      | 'not_found'
      // Only an invoice or a deposit invoice is a claim; a confirmation or a
      // correction is not.
      | 'invalid_kind'
      // A draft can still move, so it carries no claim to pay.
      | 'invalid_state'
      | 'invalid_date'
      | 'invalid_amount'
      | 'invalid_method'
      | 'invalid_note'
      // More than what is still open: no negative balance, no overpayment row.
      | 'overpaid',
  ) {
    super('Payment rejected');
  }
}

export type PaymentInput = {
  /** Tenant-local calendar day `YYYY-MM-DD`, never in the future. */
  receivedOn: string;
  /** Positive magnitude in minor units. */
  amountMinor: number;
  method: string;
  note?: string | null;
};
export type PaymentRow = {
  id: string;
  documentId: string;
  receivedOn: string;
  amountMinor: number;
  method: PaymentMethod;
  note: string | null;
  recordedAt: string;
};
/** What one finalized invoice is owed under its final corrections. */
export type PaymentBalance = {
  grossMinor: number;
  creditedMinor: number;
  debitedMinor: number;
  paidMinor: number;
  /** `gross + debits - credits`, never negative by the guards. */
  claimMinor: number;
  /** `claim - payments`, never negative by the overpayment guard. */
  openMinor: number;
};

// The status is a comparison of two magnitudes, not an event: a partial payment
// is `partial`, an invoice paid to the cent is `paid`. A defensive `>=` keeps a
// historical row readable if a later slice ever allows a refund to overshoot.
export function paymentState(
  claimMinor: number,
  paidMinor: number,
): PaymentState {
  if (paidMinor <= 0) return 'none';
  return paidMinor >= claimMinor ? 'paid' : 'partial';
}
// A magnitude, never a signed amount: the guards above refuse an overpayment, so
// the clamp only protects the display of a row that predates a later rule.
export function openMinorOf(claimMinor: number, paidMinor: number): number {
  return Math.max(0, claimMinor - paidMinor);
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
// A payment day is a tenant-local calendar day. A rolled-over date such as
// 2031-02-30 and any day after today are typing mistakes, never a guess.
function receivedOnOf(value: unknown, zone: string, at: Date): string {
  if (typeof value !== 'string' || !isoDatePattern.test(value.trim()))
    throw new DocumentPaymentError('invalid_date');
  let day: Temporal.PlainDate;
  try {
    day = Temporal.PlainDate.from(value.trim());
  } catch {
    throw new DocumentPaymentError('invalid_date');
  }
  const today = Temporal.Instant.fromEpochMilliseconds(
    at.getTime(),
  ).toZonedDateTimeISO(zone);
  if (Temporal.PlainDate.compare(day, today.toPlainDate()) > 0)
    throw new DocumentPaymentError('invalid_date');
  return day.toString();
}
// The amount is a magnitude the operator typed: a positive safe integer. 0, a
// negative value, a fraction and anything above the stored bound are refused
// before a row exists.
function amountMinorOf(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maxPaymentMinor
  )
    throw new DocumentPaymentError('invalid_amount');
  return value;
}
// The closed set is repeated by the database; the domain names the mistake.
function methodOf(value: unknown): PaymentMethod {
  if (
    typeof value !== 'string' ||
    !(paymentMethods as readonly string[]).includes(value)
  )
    throw new DocumentPaymentError('invalid_method');
  return value as PaymentMethod;
}
// A note is text an operator typed: trimmed, bounded, no control characters.
function noteOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new DocumentPaymentError('invalid_note');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    trimmed.length > paymentNoteMaxLength ||
    [...trimmed].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f);
    })
  )
    throw new DocumentPaymentError('invalid_note');
  return trimmed;
}

type ReviewedSql = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};
// `document_payments` is deliberately not mirrored in `schema.ts`: like the
// correction link of BKP019.c2, the reviewed SQL below is the one place the new
// table and its CHECKs are named, and no other row contract changes with it.
function reviewed(connection: Connection): ReviewedSql {
  return database(connection) as unknown as ReviewedSql;
}

// Only finalized corrections of this source move its claim, and only finalized
// rows of this tenant are visible.
export async function paymentBalance(
  connection: Connection,
  tenantId: string,
  documentId: string,
): Promise<PaymentBalance> {
  const result = (await reviewed(connection).execute(sql`
    SELECT d.gross_minor::text AS gross,
           (SELECT coalesce(sum(c.gross_minor), 0)::text FROM documents c
             WHERE c.tenant_id = d.tenant_id
               AND c.source_document_id = d.id
               AND c.kind = 'correction'
               AND c.state = 'final'
               AND c.correction_direction = 'credit') AS credited,
           (SELECT coalesce(sum(c.gross_minor), 0)::text FROM documents c
             WHERE c.tenant_id = d.tenant_id
               AND c.source_document_id = d.id
               AND c.kind = 'correction'
               AND c.state = 'final'
               AND c.correction_direction = 'debit') AS debited,
           (SELECT coalesce(sum(p.amount_minor), 0)::text FROM document_payments p
             WHERE p.tenant_id = d.tenant_id
               AND p.document_id = d.id) AS paid
      FROM documents d
     WHERE d.tenant_id = ${tenantId} AND d.id = ${documentId}::uuid`)) as {
    rows: {
      gross: string;
      credited: string;
      debited: string;
      paid: string;
    }[];
  };
  const row = result.rows[0];
  if (!row) throw new DocumentPaymentError('not_found');
  const grossMinor = Number(row.gross),
    creditedMinor = Number(row.credited),
    debitedMinor = Number(row.debited),
    paidMinor = Number(row.paid),
    claimMinor = grossMinor + debitedMinor - creditedMinor;
  return {
    grossMinor,
    creditedMinor,
    debitedMinor,
    paidMinor,
    claimMinor,
    openMinor: openMinorOf(claimMinor, paidMinor),
  };
}

// The credit guard of BKP019.c2 needs the same sum: money that already arrived
// cannot be credited again while no refund exists.
export async function paidMinorOf(
  connection: Connection,
  tenantId: string,
  documentId: string,
): Promise<number> {
  return (await paymentBalance(connection, tenantId, documentId)).paidMinor;
}

type PaymentQueryRow = {
  id: string;
  document_id: string;
  received_on: string;
  amount_minor: string;
  method: PaymentMethod;
  note: string | null;
  recorded_at: string;
};
function toPaymentRow(row: PaymentQueryRow): PaymentRow {
  return {
    id: row.id,
    documentId: row.document_id,
    receivedOn: row.received_on,
    // `bigint` arrives as text; the magnitude is exact below 2^53.
    amountMinor: Number(row.amount_minor),
    method: row.method,
    note: row.note,
    recordedAt: new Date(row.recorded_at).toISOString(),
  };
}
// `date` is cast to text and the instant to UTC text, so no driver guess can
// shift a tenant-local day or a recorded instant.
const paymentColumns = sql`p.id, p.document_id,
  to_char(p.received_on, 'YYYY-MM-DD') AS received_on,
  p.amount_minor::text AS amount_minor, p.method, p.note,
  to_char(p.recorded_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at`;

export function documentPaymentRepository(
  pool: Pool,
  tenantId: string,
  now: () => Date = () => new Date(),
) {
  const db = database(pool);

  async function tenantTimeZone(connection: Connection) {
    const [tenant] = await database(connection)
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw new DocumentPaymentError('not_found');
    return tenant.timezone;
  }

  async function listOf(connection: Connection, documentId: string) {
    const result = (await reviewed(connection).execute(sql`
      SELECT ${paymentColumns}
        FROM document_payments p
       WHERE p.tenant_id = ${tenantId} AND p.document_id = ${documentId}::uuid
       ORDER BY p.received_on ASC, p.recorded_at ASC, p.id ASC`)) as {
      rows: PaymentQueryRow[];
    };
    return result.rows.map(toPaymentRow);
  }

  return {
    // Only a finalized invoice or deposit invoice of this tenant takes a payment.
    // The amount is checked against the open balance under the tenant lock, so two
    // simultaneous payments can never both fit into the same claim.
    async record(actorId: string, documentId: string, input: PaymentInput) {
      const at = now();
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [document] = await tx
          .select({ kind: documents.kind, state: documents.state })
          .from(documents)
          .where(
            and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)),
          )
          .for('update');
        // A foreign tenant's invoice is missing, never forbidden: no leak.
        if (!document) throw new DocumentPaymentError('not_found');
        // The order of the checks is the contract, exactly like the document
        // writes: kind, then maturity, then the four typed fields, then money.
        // BKP019.c3.1: a finalized deposit invoice is a claim of its own, so the
        // customer's advance is paid on it - and only on it, never on the order.
        if (document.kind !== 'invoice' && document.kind !== 'deposit_invoice')
          throw new DocumentPaymentError('invalid_kind');
        if (document.state !== 'final')
          throw new DocumentPaymentError('invalid_state');
        const zone = await tenantTimeZone(tx),
          receivedOn = receivedOnOf(input.receivedOn, zone, at),
          amountMinor = amountMinorOf(input.amountMinor),
          method = methodOf(input.method),
          note = noteOf(input.note);
        const balance = await paymentBalance(tx, tenantId, documentId);
        // No overpayment row and no negative balance: what is not owed cannot be
        // recorded here. A real overpayment stays outside this slice.
        if (balance.paidMinor + amountMinor > balance.claimMinor)
          throw new DocumentPaymentError('overpaid');
        const id = randomUUID();
        // The row is read back through the same column list, so the answer of
        // the write is exactly what a later list returns - no second mapping.
        const inserted = (await reviewed(tx).execute(sql`
          INSERT INTO document_payments AS p
            (tenant_id, id, document_id, received_on, amount_minor, method, note,
             recorded_at, recorded_by)
          VALUES (${tenantId}, ${id}::uuid, ${documentId}::uuid,
                  ${receivedOn}::date, ${amountMinor}, ${method}, ${note},
                  ${at}, ${actorId}::uuid)
          RETURNING ${paymentColumns}`)) as { rows: PaymentQueryRow[] };
        // `payment.recorded` is already a DB action of 0044; the shared union in
        // `audit.ts` does not name it yet, and this file may not grow it. The one
        // documented cast keeps `appendAudit` the single audit write path,
        // exactly like the offer status actions of BKP019.0.
        await appendAudit(
          tx,
          tenantId,
          'payment.recorded' as unknown as Parameters<typeof appendAudit>[2],
          actorId,
          id,
        );
        return toPaymentRow(inserted.rows[0]!);
      });
    },
    // The payments of one document, oldest first. A foreign document is missing;
    // a document without payments is an empty list, not an error.
    async list(documentId: string) {
      const [document] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)),
        );
      if (!document) throw new DocumentPaymentError('not_found');
      return listOf(db, documentId);
    },
  };
}

export function registerDocumentPaymentRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = documentPaymentRepository(pool, tenantId),
    params = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
    nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] },
    paymentRow = {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'documentId',
        'receivedOn',
        'amountMinor',
        'method',
        'note',
        'recordedAt',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        documentId: { type: 'string', format: 'uuid' },
        // A tenant-local calendar day, never an instant.
        receivedOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        amountMinor: { type: 'integer', minimum: 1 },
        method: { type: 'string', enum: [...paymentMethods] },
        note: nullableText,
        recordedAt: { type: 'string', format: 'date-time' },
      },
    };
  // One wording per rejected payment, so the client never has to guess.
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof DocumentPaymentError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      // A draft can still move and a correction is no claim: both are conflicts
      // with the current state of the target, not a typing mistake.
      if (error.reason === 'invalid_state')
        return reply.code(409).send({ error: 'invalid_state' });
      if (error.reason === 'overpaid')
        return reply.code(409).send({ error: 'overpaid' });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  // Recording money is a document write: auth and CSRF come from the global
  // hook, the tenant lock and the administrator right from the repository.
  app.post<{ Params: { id: string }; Body: PaymentInput }>(
    '/api/v1/documents/:id/payments',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['receivedOn', 'amountMinor', 'method'],
          properties: {
            // Length, value set and amount are judged by the domain, so every
            // rejected detail answers with one stable error code.
            receivedOn: { type: 'string', maxLength: 40 },
            amountMinor: { type: 'number' },
            method: { type: 'string', maxLength: 40 },
            note: { type: 'string' },
          },
        },
        response: { 201: paymentRow },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.record(
              request.authSession!.userId,
              request.params.id,
              request.body,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // Read-only: there is deliberately no PATCH and no DELETE in this slice. A
  // recorded payment is immutable; a mistake needs its own later concept.
  app.get<{ Params: { id: string } }>(
    '/api/v1/documents/:id/payments',
    {
      schema: {
        params,
        response: { 200: { type: 'array', items: paymentRow } },
      },
    },
    async (request, reply) => {
      try {
        return await repo.list(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
