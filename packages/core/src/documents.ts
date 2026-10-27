import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import {
  contacts,
  documentLayouts,
  documentLines,
  documentTemplatePositions,
  documentTemplates,
  documents,
  events,
  locations,
  masterData,
  products,
  tenants,
} from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import {
  assertTemplateText,
  documentKinds,
  DocumentTemplateError,
  type DocumentKind,
  type TemplatePlaceholder,
} from './document-templates.js';
import {
  documentTotals,
  DocumentTotalsError,
  formatDocumentDate,
  formatMinorUnits,
  type TotalsLine,
} from './document-totals.js';
import {
  assertTransition,
  buildDocumentSnapshot,
  DocumentSnapshotError,
  type DocumentState,
  validityDate,
} from './document-snapshot.js';
import {
  allocateDocumentNumber,
  DocumentNumberError,
} from './document-numbers.js';
import {
  DocumentPdfError,
  renderDocumentPdf,
  type PdfRenderer,
} from './document-pdf.js';
import { storeDocumentPdf, readDocumentPdf } from './document-artifacts.js';
import { StorageError, type StorageAdapter } from './storage.js';
import type {
  DocumentDepositReference,
  DocumentInvoiceDates,
} from './document-layouts.js';
import {
  openMinorOf,
  orderPaidMinorOf,
  paidMinorOf,
  paymentState,
  paymentStates,
  type PaymentState,
} from './document-payments.js';

export class DocumentError extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'invalid_state'
      | 'invalid_line'
      | 'empty_lines'
      | 'missing_reference'
      | 'number_not_configured'
      | 'invalid_content'
      | 'artifact_failed'
      | 'invalid_filter'
      | 'invalid_transition'
      | 'invalid_kind'
      | 'conflict'
      | 'invalid_channel'
      | 'invalid_time'
      | 'invalid_note'
      | 'invalid_attachment'
      | 'acceptance_conflict'
      | 'offer_not_accepted'
      | 'order_withdrawn'
      // BKP019.c2: a credit note may never exceed the corrected document's gross.
      | 'credit_exceeds_invoice'
      // BKP019.c3.2b: the finalized advances of an order add up to more than the
      // order claims - there is no refund path that could settle a negative
      // "Zu zahlender Betrag".
      | 'deposits_exceed_order'
      | 'duplicate',
  ) {
    super('Document rejected');
  }
}

export type DocumentLineDraft = TotalsLine & {
  productId?: string | null;
  description: string;
  unit: string;
  discountBasisPoints: number;
};
export type DocumentDraftInput = {
  templateId: string;
  eventId?: string | null;
  contactId?: string | null;
  /** Omitted lines copy the template positions; an empty list is a mistake. */
  lines?: DocumentLineDraft[];
};
export type BlankOfferInput = { eventId: string; contactId: string };
export type DocumentDraftContent = {
  version: number;
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
  /**
   * RG-07: the day the service happened, as a tenant-local `YYYY-MM-DD`.
   * `undefined` leaves a stored value untouched, `null` clears it.
   */
  serviceDate?: string | null;
  /**
   * RG-07: the agreed payment term in days (0 = due immediately). The due day
   * itself is never an input - it is frozen at finalization from this number.
   */
  paymentTermDays?: number | null;
  /**
   * RG-07b: the account the invoice prints, as free text. `undefined` leaves a
   * stored value untouched, `null` (or a blank text) clears it. Not validated
   * as a bank account - this slice prints what an operator wrote.
   */
  bankAccount?: string | null;
  lines?: DocumentLineDraft[];
};
export type DocumentFilters = {
  eventId?: string;
  kind?: DocumentKind;
  state?: DocumentState;
  /** Inclusive tenant-local issue days, `YYYY-MM-DD`, on `issued_at`. */
  from?: string;
  to?: string;
  /** Explicit page size; omitted keeps the full, unbounded list. */
  limit?: number;
  offset?: number;
  /** Opt-in projection; omitted keeps the old, unchanged list shape. */
  include?: 'metadata' | 'offer';
};
// The business status of an offer is a second axis next to `state`: the content
// stays final and byte-identical while the offer is sent, accepted or withdrawn.
export type OfferStatus = 'sent' | 'accepted' | 'withdrawn';
export const offerStatuses = ['sent', 'accepted', 'withdrawn'] as const;
// `null` is "no claim yet" (final, never sent). `withdrawn` is terminal: a
// correction is a new document, exactly like a corrected final document.
// `expired` is deliberately absent - it is a date comparison, not an event.
// BKP019.a: how the customer said yes. AG-06 names the four channels; the
// internal codes are ours, the wording on screen is German.
export type AcceptanceChannel = 'email' | 'phone' | 'pdf' | 'other';
export const acceptanceChannels = ['email', 'phone', 'pdf', 'other'] as const;
// BKP019.c2: a correction carries a direction, never a negative amount. `credit`
// is a credit note (it reduces the claim), `debit` is a follow-up charge.
export type CorrectionDirection = 'credit' | 'debit';
export const correctionDirections = ['credit', 'debit'] as const;
// The cancellation state of a corrected document is derived from its finalized
// credit notes and never stored - the same pattern as an expired offer.
export type CorrectionState = 'none' | 'partial' | 'full';
export const correctionStates = ['none', 'partial', 'full'] as const;
// BKP019.c3.2: the role of an invoice. `NULL` is the ordinary invoice of
// BKP019.c1; `final` is the same kind that settles the advances of its order.
export type InvoiceRole = 'final';
export const invoiceRoles = ['final'] as const;
export const acceptanceNoteMaxLength = 2000;
// RG-07b: the printed account is bounded like every other typed text; the same
// bound is repeated by the CHECK in 0048 and by the route's `maxLength`.
export const bankAccountMaxLength = 500;
export type OfferStatusChange = {
  status: OfferStatus;
  version: number;
  /** Mandatory for `accepted`; refused for every other status. */
  channel?: string;
  /** Operator-entered instant; omitted means the transaction clock. */
  acceptedAt?: string;
  note?: string;
  attachmentFileId?: string;
};
const offerTransitions: Record<OfferStatus | 'unset', readonly OfferStatus[]> =
  {
    unset: ['sent', 'withdrawn'],
    sent: ['accepted', 'withdrawn'],
    accepted: ['withdrawn'],
    withdrawn: [],
  };
export function assertOfferTransition(
  from: OfferStatus | null,
  to: OfferStatus,
): void {
  if (!offerTransitions[from ?? 'unset'].includes(to))
    throw new DocumentError('invalid_transition');
}
// Migration 0039 allows `document.sent|accepted|withdrawn`; the shared
// `AuditAction` union does not name them yet. The one documented widening keeps
// `appendAudit` the single audit write path instead of repeating its insert
// here. A later slice can extend the union and drop this helper unchanged.
function offerAuditAction(
  status: OfferStatus,
): Parameters<typeof appendAudit>[2] {
  return `document.${status}` as unknown as Parameters<typeof appendAudit>[2];
}
// Expiry is derived in the tenant's own calendar day, so a 23- or 25-hour DST
// day and a late-evening finalization can never shift the deadline by a day.
export function offerExpired(
  validUntil: string | null,
  status: OfferStatus | null,
  at: Date,
  timeZone: string,
): boolean {
  if (!validUntil || status === 'accepted' || status === 'withdrawn')
    return false;
  const today = Temporal.Instant.fromEpochMilliseconds(
    at.getTime(),
  ).toZonedDateTimeISO(timeZone);
  return (
    Temporal.PlainDate.compare(
      Temporal.PlainDate.from(validUntil),
      today.toPlainDate(),
    ) < 0
  );
}
// RG-08: "überfällig" is a date comparison on an open claim, never a stored
// status - like `offerExpired`, the tenant calendar decides where "today" ends.
// The due day itself is not yet late (strict `<`), and a claim without a due day
// invents no deadline: only an open amount on a payable document can be late.
export function invoiceOverdue(
  dueDate: string | null,
  claimMinor: number,
  paidMinor: number,
  at: Date,
  timeZone: string,
): boolean {
  if (!dueDate || paidMinor >= claimMinor) return false;
  const today = Temporal.Instant.fromEpochMilliseconds(
    at.getTime(),
  ).toZonedDateTimeISO(timeZone);
  return (
    Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      today.toPlainDate(),
    ) < 0
  );
}
export type DocumentListRow = {
  id: string;
  kind: DocumentKind;
  templateId: string | null;
  eventId: string | null;
  contactId: string | null;
  number: string | null;
  state: DocumentState;
  issuedAt: Date;
  finalizedAt: Date | null;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  version: number;
};
export type DocumentMetadataRow = DocumentListRow & {
  /** Tenant-scoped event name; null while unlinked or for a foreign id. */
  eventName: string | null;
  /** `issued_at` as a tenant-local plain date, the same basis as the filters. */
  issuedDate: string;
  /** Exactly the eligibility of `GET /api/v1/documents/:id/pdf`. */
  pdfAvailable: boolean;
};
export type DocumentOfferRow = DocumentListRow & {
  /** NULL is the honest value for a row without any status claim. */
  offerStatus: OfferStatus | null;
  /** Tenant-local plain date the printed PDF shows, fixed at finalization. */
  validUntil: string | null;
  /** Derived from `validUntil` and the tenant clock; never stored. */
  offerExpired: boolean;
  // BKP019.a: the acceptance record. It outlives a withdrawal, so a reader can
  // still see how and when the customer accepted.
  acceptedAt: Date | null;
  acceptanceChannel: AcceptanceChannel | null;
  acceptanceNote: string | null;
  acceptanceFileId: string | null;
  acceptanceFileName: string | null;
  acceptanceFileState: 'available' | 'archived' | null;
  // BKP019.b: the offer a confirmation was copied from. NULL for every other
  // row, including the offer itself.
  sourceDocumentId: string | null;
  sourceNumber: string | null;
  // BKP019.c2: the direction of a correction (NULL for every other kind) and the
  // state of the document it corrects. Both are projection-only: nothing here is
  // stored on the row, and `state` of a corrected invoice never moves.
  correctionDirection: CorrectionDirection | null;
  correctionState: CorrectionState | null;
  /** What is still creditable, as a magnitude; NULL for every other row. */
  remainingCredit: number | null;
  // BKP019.d: how much money arrived and what is still open on a finalized
  // invoice. Both are derived from `document_payments` and the final
  // corrections - nothing here is ever written back to the document.
  paymentState: PaymentState | null;
  /** `gross + debits - credits - deposit_applied - payments`; NULL otherwise. */
  openMinor: number | null;
  // BKP019.c3.2: the role of this invoice (NULL for a standard invoice), the
  // frozen deduction of a final invoice and what arrived on the settled
  // advances. The last value is a display figure and never reduces a claim.
  invoiceRole: InvoiceRole | null;
  depositAppliedMinor: number | null;
  depositPaidMinor: number | null;
  // RG-07: the service day and the agreed term are inputs, the due day is the
  // value frozen at finalization. All three are NULL outside the invoice family.
  serviceDate: string | null;
  paymentTermDays: number | null;
  dueDate: string | null;
  // RG-08: derived from `dueDate`, the open claim and the tenant day - never
  // stored. `null` is the honest value for a document that is no claim at all
  // (offer, confirmation, correction, withdrawn row), `false` for a claim that
  // is not late (yet). "Were late once" is deliberately not answered: no status
  // history exists, so a settled invoice reads `false`.
  overdue: boolean | null;
  // RG-07b: the free-text account the invoice prints. NULL outside the family
  // and NULL where an operator entered none.
  bankAccount: string | null;
};
export type DocumentDependencies = {
  /** Marks the PDF; injected so tests never start Chromium. */
  render: PdfRenderer;
  /** Content-addressed artefact storage. */
  store: StorageAdapter;
  /** Admin origin for the {{documentLink}} placeholder. */
  origin: string;
  now?: () => Date;
};

type DocumentLineDraftRow = {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
};

const lineColumns = {
  id: documentLines.id,
  position: documentLines.position,
  productId: documentLines.productId,
  description: documentLines.description,
  quantity: documentLines.quantity,
  unit: documentLines.unit,
  unitPriceMinor: documentLines.unitPriceMinor,
  taxBasisPoints: documentLines.taxBasisPoints,
  discountBasisPoints: documentLines.discountBasisPoints,
};

function assertLine(line: DocumentLineDraft, index: number): void {
  if (
    typeof line.description !== 'string' ||
    !line.description.trim() ||
    line.description.length > 300 ||
    typeof line.unit !== 'string' ||
    !line.unit.trim() ||
    line.unit.length > 40 ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1 ||
    line.quantity > 100000 ||
    !Number.isSafeInteger(line.unitPriceMinor) ||
    line.unitPriceMinor < 0 ||
    line.unitPriceMinor > Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(line.taxBasisPoints) ||
    line.taxBasisPoints < 0 ||
    line.taxBasisPoints > 10000 ||
    !Number.isSafeInteger(line.discountBasisPoints) ||
    line.discountBasisPoints < 0 ||
    line.discountBasisPoints > 10000
  )
    throw new DocumentError('invalid_line');
  if (index > 999) throw new DocumentError('invalid_line');
}

function recipientOf(contact: {
  name: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
}) {
  const person = contact.contactPerson.trim(),
    street = contact.street.trim(),
    place = [contact.postalCode.trim(), contact.city.trim()]
      .filter(Boolean)
      .join(' ');
  return {
    name: person ? contact.name + '\n' + person : contact.name,
    address: [street, place].filter(Boolean).join('\n'),
  };
}

// The artefact is content addressed, so a failed write can leave at most an
// unreferenced file behind; the database row is still the source of truth.
function translate(error: unknown): never {
  if (error instanceof AccessError || error instanceof DocumentError)
    throw error;
  if (error instanceof DocumentNumberError)
    throw new DocumentError(
      error.reason === 'not_configured'
        ? 'number_not_configured'
        : 'invalid_content',
    );
  if (error instanceof DocumentSnapshotError)
    throw new DocumentError('invalid_content');
  if (error instanceof DocumentTemplateError)
    throw new DocumentError('invalid_content');
  if (error instanceof DocumentPdfError || error instanceof StorageError)
    throw new DocumentError('artifact_failed');
  throw error;
}

// Drizzle wraps driver errors, so the PostgreSQL code travels in `cause`.
// The only unique index a confirmation insert can hit is the partial one on
// `(tenant_id, source_document_id)`; numbers are still NULL at that point.
function uniqueViolation(error: unknown): boolean {
  return (
    (error as { cause?: { code?: string } } | null)?.cause?.code === '23505'
  );
}

const maxOffset = 1_000_000;
// A real calendar day, not a rollover such as 2031-02-30.
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const acceptanceUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// BKP019.a: the channel is a closed set, and the database repeats it.
function acceptanceChannelOf(value: unknown): AcceptanceChannel {
  if (
    typeof value !== 'string' ||
    !(acceptanceChannels as readonly string[]).includes(value)
  )
    throw new DocumentError('invalid_channel');
  return value as AcceptanceChannel;
}
// A note is text an operator typed: trimmed, bounded, no control characters.
function acceptanceNoteOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new DocumentError('invalid_note');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    trimmed.length > acceptanceNoteMaxLength ||
    [...trimmed].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f);
    })
  )
    throw new DocumentError('invalid_note');
  return trimmed;
}
// A plain wall-clock value ("2030-10-26T10:30" from a datetime-local field) is
// read in the tenant zone; an explicit offset is taken as the exact instant.
// Anything else, or anything after "now", is a typing mistake - never a guess.
function acceptanceInstantOf(value: unknown, zone: string, at: Date): Date {
  if (typeof value !== 'string' || !value.trim())
    throw new DocumentError('invalid_time');
  const text = value.trim();
  let instant: Temporal.Instant;
  try {
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text))
      instant = Temporal.Instant.from(text);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text))
      instant = Temporal.PlainDateTime.from(text)
        .toZonedDateTime(zone)
        .toInstant();
    else throw new DocumentError('invalid_time');
  } catch {
    throw new DocumentError('invalid_time');
  }
  const acceptedAt = new Date(instant.epochMilliseconds);
  if (acceptedAt.getTime() > at.getTime())
    throw new DocumentError('invalid_time');
  return acceptedAt;
}
function plainDate(day: string): Temporal.PlainDate | null {
  if (!isoDatePattern.test(day)) return null;
  try {
    return Temporal.PlainDate.from(day);
  } catch {
    return null;
  }
}
// RG-07: the service day, the payment term and the due day belong to the
// invoice family. An offer, a confirmation and a blank offer claim nothing of
// them - named once here, repeated by the database.
const invoiceFamily = ['invoice', 'deposit_invoice', 'correction'] as const;
function isInvoiceKind(kind: string): boolean {
  return (invoiceFamily as readonly string[]).includes(kind);
}
// A service day is a tenant-local calendar day that has already happened, the
// same rule a recorded payment follows: a rolled-over date such as 2031-02-30
// and any day after today are typing mistakes, never a guess.
function serviceDateOf(value: unknown, zone: string, at: Date): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !isoDatePattern.test(value))
    throw new DocumentError('invalid_content');
  let day: Temporal.PlainDate;
  try {
    day = Temporal.PlainDate.from(value);
  } catch {
    throw new DocumentError('invalid_content');
  }
  const today = Temporal.Instant.fromEpochMilliseconds(
    at.getTime(),
  ).toZonedDateTimeISO(zone);
  if (Temporal.PlainDate.compare(day, today.toPlainDate()) > 0)
    throw new DocumentError('invalid_content');
  return day.toString();
}
// The term is the input and the due day is the consequence, so only a whole
// number of days is accepted. 0 is "due immediately", 365 is the bound the
// deadline of an offer already uses.
function paymentTermDaysOf(value: unknown): number | null {
  if (value === null) return null;
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 365
  )
    throw new DocumentError('invalid_content');
  return value as number;
}
// RG-07b: the account an invoice prints is free text an operator typed - no
// IBAN check, no BIC, no placeholder: what is stored is printed word for word.
// Trimmed and bounded, with real line breaks as the only control characters; a
// blank text clears the field the same way `null` does.
function bankAccountOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new DocumentError('invalid_content');
  // Every line-ending style becomes the one the printer understands, so a
  // pasted Windows block is not refused for its dialect.
  const trimmed = value.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return null;
  if (
    trimmed.length > bankAccountMaxLength ||
    [...trimmed].some((character) => {
      const code = character.codePointAt(0)!;
      return code !== 0x0a && (code < 0x20 || (code >= 0x7f && code <= 0x9f));
    })
  )
    throw new DocumentError('invalid_content');
  return trimmed;
}
// `dd.mm.yyyy`: a stored plain date is formatted from its parts, exactly like
// the deadline of an offer, never through a time zone.
function printedDay(day: string): string {
  return day.split('-').reverse().join('.');
}
// The route schema already rejects malformed values; this keeps the repository
// honest for direct callers and names the one rule JSON Schema cannot express.
export function assertDocumentFilters(filters: DocumentFilters): void {
  const from = filters.from === undefined ? null : plainDate(filters.from),
    to = filters.to === undefined ? null : plainDate(filters.to);
  if (
    (filters.from !== undefined && !from) ||
    (filters.to !== undefined && !to)
  )
    throw new DocumentError('invalid_filter');
  if (from && to && Temporal.PlainDate.compare(from, to) > 0)
    throw new DocumentError('invalid_filter');
  if (
    filters.limit !== undefined &&
    (!Number.isInteger(filters.limit) ||
      filters.limit < 1 ||
      filters.limit > 100)
  )
    throw new DocumentError('invalid_filter');
  if (
    filters.offset !== undefined &&
    (!Number.isInteger(filters.offset) ||
      filters.offset < 0 ||
      filters.offset > maxOffset)
  )
    throw new DocumentError('invalid_filter');
}

export function documentRepository(
  pool: Pool,
  tenantId: string,
  dependencies: DocumentDependencies,
) {
  const db = database(pool),
    now = dependencies.now ?? (() => new Date()),
    scope = eq(documents.tenantId, tenantId);

  async function readOne(connection: Connection, id: string) {
    const [document] = await database(connection)
      .select()
      .from(documents)
      .where(and(scope, eq(documents.id, id)));
    if (!document) return null;
    const lines = await database(connection)
      .select(lineColumns)
      .from(documentLines)
      .where(
        and(
          eq(documentLines.tenantId, tenantId),
          eq(documentLines.documentId, id),
        ),
      )
      .orderBy(asc(documentLines.position));
    // RG-07: the three date columns are read as reviewed SQL - `schema.ts` stays
    // unchanged for every other row contract, and `date` travels as text so no
    // driver can turn a tenant-local day into a guessing instant.
    const executor = database(connection) as unknown as {
      execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    };
    const dates = (await executor.execute(sql`
      SELECT to_char(d.service_date, 'YYYY-MM-DD') AS service_date,
             d.payment_term_days::text AS payment_term_days,
             to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
             d.bank_account
        FROM documents d
       WHERE d.tenant_id = ${tenantId} AND d.id = ${id}`)) as {
      rows: {
        service_date: string | null;
        payment_term_days: string | null;
        due_date: string | null;
        bank_account: string | null;
      }[];
    };
    const dateRow = dates.rows[0];
    return {
      ...document,
      serviceDate: dateRow?.service_date ?? null,
      paymentTermDays:
        dateRow?.payment_term_days === null ||
        dateRow?.payment_term_days === undefined
          ? null
          : Number(dateRow.payment_term_days),
      dueDate: dateRow?.due_date ?? null,
      // RG-07b: the printed account travels with the same reviewed SQL, so the
      // editor can load and rewrite it without a second route.
      bankAccount: dateRow?.bank_account ?? null,
      lines,
    };
  }

  async function tenantTimeZone(connection: Connection) {
    const [tenant] = await database(connection)
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw new DocumentError('missing_reference');
    return tenant.timezone;
  }

  // BKP019.0 columns are read as reviewed SQL: `date` is cast to text, so the
  // driver can never turn a tenant-local day into a guessing `Date`.
  // BKP019.a adds the acceptance record; the joined file is tenant-scoped, so a
  // foreign id could never surface a name here.
  // BKP019.b adds the source of a confirmation; the joined document is
  // tenant-scoped for the same reason.
  async function offerStateOf(connection: Connection, id: string) {
    // `database()` narrows to the query builder, so the reviewed-SQL hatch is
    // named here, the same shape library-files.ts uses.
    const executor = database(connection) as unknown as {
      execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    };
    const result = (await executor.execute(sql`
      SELECT to_char(d.valid_until, 'YYYY-MM-DD') AS valid_until, d.offer_status,
             to_char(d.accepted_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS accepted_at,
             d.acceptance_channel, d.acceptance_note,
             d.acceptance_file_id, f.display_name AS acceptance_file_name,
             f.state AS acceptance_file_state,
             d.source_document_id, s.number AS source_number
        FROM documents d
        LEFT JOIN library_files f
          ON f.tenant_id = d.tenant_id AND f.id = d.acceptance_file_id
        LEFT JOIN documents s
          ON s.tenant_id = d.tenant_id AND s.id = d.source_document_id
       WHERE d.tenant_id = ${tenantId} AND d.id = ${id}`)) as {
      rows: {
        valid_until: string | null;
        offer_status: OfferStatus | null;
        accepted_at: string | null;
        acceptance_channel: AcceptanceChannel | null;
        acceptance_note: string | null;
        acceptance_file_id: string | null;
        acceptance_file_name: string | null;
        acceptance_file_state: 'available' | 'archived' | null;
        source_document_id: string | null;
        source_number: string | null;
      }[];
    };
    const row = result.rows[0];
    return {
      validUntil: row?.valid_until ?? null,
      offerStatus: row?.offer_status ?? null,
      // UTC text is cast here, so no driver guess can shift the instant.
      acceptedAt: row?.accepted_at ? new Date(row.accepted_at) : null,
      acceptanceChannel: row?.acceptance_channel ?? null,
      acceptanceNote: row?.acceptance_note ?? null,
      acceptanceFileId: row?.acceptance_file_id ?? null,
      acceptanceFileName: row?.acceptance_file_name ?? null,
      acceptanceFileState: row?.acceptance_file_state ?? null,
      sourceDocumentId: row?.source_document_id ?? null,
      // The number of the source, not of the confirmation itself.
      sourceNumber: row?.source_number ?? null,
    };
  }

  // BKP019.c2: the direction of a correction and its source are read as reviewed
  // SQL, for the same reason the link is written that way: `schema.ts` stays
  // unchanged for every other row contract.
  async function correctionOf(connection: Connection, id: string) {
    const executor = database(connection) as unknown as {
      execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    };
    const result = (await executor.execute(sql`
      SELECT correction_direction, source_document_id
        FROM documents
       WHERE tenant_id = ${tenantId} AND id = ${id}`)) as {
      rows: {
        correction_direction: CorrectionDirection | null;
        source_document_id: string | null;
      }[];
    };
    const row = result.rows[0];
    return {
      direction: row?.correction_direction ?? null,
      sourceDocumentId: row?.source_document_id ?? null,
    };
  }

  // Only finalized corrections move a balance: a draft is still allowed to
  // change, so it must not count anywhere. `excludeId` keeps the document being
  // finalized out of its own sum.
  async function correctionSums(
    connection: Connection,
    sourceId: string,
    excludeId?: string,
  ) {
    const executor = database(connection) as unknown as {
      execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    };
    const result = (await executor.execute(sql`
      SELECT coalesce(sum(documents.gross_minor) FILTER (
               WHERE documents.correction_direction = 'credit'), 0)::text AS credited,
             coalesce(sum(documents.gross_minor) FILTER (
               WHERE documents.correction_direction = 'debit'), 0)::text AS debited
        FROM documents
       WHERE documents.tenant_id = ${tenantId}
         AND documents.source_document_id = ${sourceId}::uuid
         AND documents.kind = 'correction'
         AND documents.state = 'final'
         AND (${excludeId ?? null}::uuid IS NULL
              OR documents.id <> ${excludeId ?? null}::uuid)`)) as {
      rows: { credited: string; debited: string }[];
    };
    const row = result.rows[0];
    return {
      credited: Number(row?.credited ?? 0),
      debited: Number(row?.debited ?? 0),
    };
  }

  // BKP019.c3.2: the role and the frozen deduction of one document. Both columns
  // are read as reviewed SQL for the same reason as every other additive column:
  // `schema.ts` stays unchanged.
  async function settlementOf(connection: Connection, documentId: string) {
    const executor = database(connection) as unknown as {
      execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    };
    const result = (await executor.execute(sql`
      SELECT d.invoice_role, d.deposit_applied_minor::text AS applied,
             d.source_document_id
        FROM documents d
       WHERE d.tenant_id = ${tenantId} AND d.id = ${documentId}::uuid`)) as {
      rows: {
        invoice_role: InvoiceRole | null;
        applied: string | null;
        source_document_id: string | null;
      }[];
    };
    const row = result.rows[0];
    return {
      role: row?.invoice_role ?? null,
      // `null` means "not frozen yet" - a draft final invoice previews the
      // advances that would be settled if it were finalized now.
      applied:
        row?.applied === null || row?.applied === undefined
          ? null
          : Number(row.applied),
      // The source link is read here too, because `schema.ts` deliberately does
      // not mirror the additive column of 0042.
      sourceDocumentId: row?.source_document_id ?? null,
    };
  }

  // What the advances of one order are worth: the *corrected* claim of every
  // *finalized* deposit invoice of this tenant - `gross + debits - credits` per
  // advance, the same rule `correctionSums` gives every other claim - and the
  // money recorded against exactly them. A draft is no claim and is therefore
  // not netted at all.
  // BKP019.c3.2c: summing the bare gross made the documented remedy untrue. A
  // credit note on an advance lowers that advance's claim, not the deduction, so
  // an over-settled order could never be untangled and there is no refund path
  // that could settle the difference; a corrected advance plus a final invoice
  // undercharged instead. With the corrected sum the deduction equals what the
  // advances still claim - a credit lowers it, a debit raises it - and an
  // advance without corrections is unchanged, because its claim is its gross.
  async function depositSums(connection: Connection, sourceId: string) {
    const executor = database(connection) as unknown as {
      execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    };
    const result = (await executor.execute(sql`
      SELECT coalesce(sum(d.gross_minor
               + coalesce((SELECT sum(c.gross_minor) FROM documents c
                            WHERE c.tenant_id = d.tenant_id
                              AND c.source_document_id = d.id
                              AND c.kind = 'correction'
                              AND c.state = 'final'
                              AND c.correction_direction = 'debit'), 0)
               - coalesce((SELECT sum(c.gross_minor) FROM documents c
                            WHERE c.tenant_id = d.tenant_id
                              AND c.source_document_id = d.id
                              AND c.kind = 'correction'
                              AND c.state = 'final'
                              AND c.correction_direction = 'credit'), 0)
             ), 0)::text AS applied,
             (SELECT coalesce(sum(p.amount_minor), 0)::text
                FROM document_payments p
                JOIN documents pd
                  ON pd.tenant_id = p.tenant_id AND pd.id = p.document_id
               WHERE p.tenant_id = ${tenantId}
                 AND pd.source_document_id = ${sourceId}::uuid
                 AND pd.kind = 'deposit_invoice'
                 AND pd.state = 'final') AS paid
        FROM documents d
       WHERE d.tenant_id = ${tenantId}
         AND d.source_document_id = ${sourceId}::uuid
         AND d.kind = 'deposit_invoice'
         AND d.state = 'final'`)) as {
      rows: { applied: string; paid: string }[];
    };
    const row = result.rows[0];
    return {
      applied: Number(row?.applied ?? 0),
      paid: Number(row?.paid ?? 0),
    };
  }

  // Everything a final invoice prints about the advances it settles. The frozen
  // deduction wins as soon as it exists, so a later advance can never change what
  // was printed; only "davon geleistet" is read live and stays a display value.
  async function depositPrints(
    connection: Connection,
    document: NonNullable<Awaited<ReturnType<typeof readOne>>>,
    printedGrossMinor: number,
    timeZone: string,
  ): Promise<DocumentDepositReference | undefined> {
    if (document.kind !== 'invoice') return undefined;
    const { role, applied, sourceDocumentId } = await settlementOf(
      connection,
      document.id,
    );
    if (role !== 'final' || !sourceDocumentId) return undefined;
    const [source] = await database(connection)
      .select({ number: documents.number, issuedAt: documents.issuedAt })
      .from(documents)
      .where(and(scope, eq(documents.id, sourceDocumentId)));
    if (!source?.number) throw new DocumentError('missing_reference');
    const sums = await depositSums(connection, sourceDocumentId),
      deduction = applied ?? sums.applied;
    return {
      number: source.number,
      date: formatDocumentDate(source.issuedAt, timeZone),
      appliedMinor: deduction,
      paidMinor: sums.paid,
      payableMinor: printedGrossMinor - deduction,
    };
  }

  // Everything a correction prints about its source. All amounts stay magnitudes;
  // the direction decides the sign in the layout, not in the row.
  async function correctionPrints(
    connection: Connection,
    documentId: string,
    correctionGrossMinor: number,
    timeZone: string,
  ) {
    const { direction, sourceDocumentId } = await correctionOf(
      connection,
      documentId,
    );
    if (!direction || !sourceDocumentId)
      throw new DocumentError('missing_reference');
    const [source] = await database(connection)
      .select({
        number: documents.number,
        issuedAt: documents.issuedAt,
        grossMinor: documents.grossMinor,
      })
      .from(documents)
      .where(and(scope, eq(documents.id, sourceDocumentId)));
    if (!source?.number) throw new DocumentError('missing_reference');
    const { credited, debited } = await correctionSums(
        connection,
        sourceDocumentId,
        documentId,
      ),
      signed =
        direction === 'credit' ? -correctionGrossMinor : correctionGrossMinor;
    return {
      number: source.number,
      date: formatDocumentDate(source.issuedAt, timeZone),
      direction,
      sourceGrossMinor: source.grossMinor,
      correctionGrossMinor,
      correctedGrossMinor: source.grossMinor + debited - credited + signed,
    };
  }

  // BKP019.c2: a credit note is bounded by what is still open on its source. A
  // debit is not: it raises the claim.
  // BKP019.d: money that already arrived is part of "what is still open". As long
  // as no refund exists, crediting a paid invoice would create a balance the
  // system cannot settle, so the guard now reads
  // `sum(credits) + sum(payments) <= gross + sum(debits)`.
  // BKP019.c3.2 closes two holes in that rule: the claim of a *final* invoice is
  // already reduced by its frozen deduction, and a confirmation owns no payments
  // itself - the money arrived on its advances and its invoice, so those are
  // counted instead. Otherwise a fully paid order could be credited again.
  async function assertCorrectionCredit(
    connection: Connection,
    correction: { id: string; grossMinor: number },
  ) {
    const { direction, sourceDocumentId } = await correctionOf(
      connection,
      correction.id,
    );
    if (direction !== 'credit') return;
    if (!sourceDocumentId) throw new DocumentError('missing_reference');
    const [source] = await database(connection)
      .select({ grossMinor: documents.grossMinor, kind: documents.kind })
      .from(documents)
      .where(and(scope, eq(documents.id, sourceDocumentId)));
    if (!source) throw new DocumentError('missing_reference');
    const { credited, debited } = await correctionSums(
        connection,
        sourceDocumentId,
        correction.id,
      ),
      paid =
        source.kind === 'order_confirmation'
          ? await orderPaidMinorOf(connection, tenantId, sourceDocumentId)
          : await paidMinorOf(connection, tenantId, sourceDocumentId),
      settled =
        source.kind === 'invoice'
          ? ((await settlementOf(connection, sourceDocumentId)).applied ?? 0)
          : 0;
    if (
      credited + paid + correction.grossMinor >
      source.grossMinor - settled + debited
    )
      throw new DocumentError('credit_exceeds_invoice');
  }

  // BKP019.c3.2b: the advances of an order may never be netted beyond what the
  // order itself claims. The claim is the one every other reader uses -
  // `gross + debits - credits` of the confirmation - so the print, the projection
  // and the payment balance can never disagree about a "Zu zahlender Betrag" that
  // went negative. BKP019.c3.2c reads the advances themselves the same way: the
  // deduction is the sum of their corrected claims, so a credit note on an
  // advance is exactly the remedy this refusal names. Rejected instead of
  // clamped: without a refund path an overshoot needs a human decision, never an
  // amount swallowed by the system.
  async function assertSettlementWithinOrder(
    connection: Connection,
    invoice: { id: string },
  ) {
    const { role, sourceDocumentId } = await settlementOf(
      connection,
      invoice.id,
    );
    // A standard invoice settles nothing, so it owns no such bound.
    if (role !== 'final' || !sourceDocumentId) return;
    const [source] = await database(connection)
      .select({ grossMinor: documents.grossMinor })
      .from(documents)
      .where(and(scope, eq(documents.id, sourceDocumentId)));
    // The same answer the snapshot gives one step later: without its source a
    // final invoice cannot be printed at all.
    if (!source) throw new DocumentError('missing_reference');
    const { applied } = await depositSums(connection, sourceDocumentId),
      { credited, debited } = await correctionSums(
        connection,
        sourceDocumentId,
      );
    if (applied > source.grossMinor + debited - credited)
      throw new DocumentError('deposits_exceed_order');
  }

  // One document with its two axes: the unchanged content row plus the offer
  // status, the frozen deadline and the derived expiry.
  async function offerRowOf(
    connection: Connection,
    id: string,
    at: Date,
    zone: string,
  ) {
    const row = await readOne(connection, id);
    if (!row) throw new DocumentError('not_found');
    const state = await offerStateOf(connection, id);
    return {
      ...row,
      ...state,
      offerExpired: offerExpired(state.validUntil, state.offerStatus, at, zone),
    };
  }

  async function snapshotFor(
    connection: Connection,
    document: NonNullable<Awaited<ReturnType<typeof readOne>>>,
    documentNumber: string,
    issuedAt: Date,
  ) {
    const tx = database(connection),
      [template] = document.templateId
        ? await tx
            .select()
            .from(documentTemplates)
            .where(
              and(
                eq(documentTemplates.tenantId, tenantId),
                eq(documentTemplates.id, document.templateId),
              ),
            )
        : [];
    if (document.templateId && !template)
      throw new DocumentError('missing_reference');
    const [layout] = await tx
      .select()
      .from(documentLayouts)
      .where(eq(documentLayouts.tenantId, tenantId));
    if (!layout) throw new DocumentError('missing_reference');
    let logoDataUri: string | undefined;
    if (layout.logoKey && layout.logoMediaType) {
      try {
        const logo = await dependencies.store.read(layout.logoKey);
        logoDataUri = `data:${layout.logoMediaType};base64,${logo.toString('base64')}`;
      } catch (error) {
        if (error instanceof StorageError)
          throw new DocumentError('missing_reference');
        throw error;
      }
    }
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw new DocumentError('missing_reference');
    const [contact] = document.contactId
      ? await tx
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              eq(contacts.id, document.contactId),
            ),
          )
      : [];
    if (!contact) throw new DocumentError('missing_reference');
    const [event] = document.eventId
      ? await tx
          .select()
          .from(events)
          .where(
            and(eq(events.tenantId, tenantId), eq(events.id, document.eventId)),
          )
      : [];
    const lines: DocumentLineDraftRow[] = document.lines;
    if (!lines.length) throw new DocumentError('empty_lines');
    const totals = documentTotals(lines),
      recipient = recipientOf(contact),
      values: Partial<Record<TemplatePlaceholder, string>> = {
        contact: contact.name,
        total: formatMinorUnits(totals.grossMinor) + ' €',
        documentLink: dependencies.origin + '/#document-' + document.id,
      };
    if (event) {
      values.event = event.name;
      if (event.eventDate)
        values.date = formatDocumentDate(
          new Date(event.eventDate + 'T12:00:00Z'),
          tenant.timezone,
        );
      if (event.venueOverride) {
        const place = event.venue?.trim();
        if (place) values.location = place;
      } else if (event.locationId) {
        const [location] = await tx
          .select({ name: locations.name })
          .from(locations)
          .where(
            and(
              eq(locations.tenantId, tenantId),
              eq(locations.id, event.locationId),
            ),
          );
        if (location) values.location = location.name;
      }
      const kindIds = [event.eventTypeId, event.packageId].filter(
        (value): value is string => Boolean(value),
      );
      if (kindIds.length) {
        const names = new Map(
          (
            await tx
              .select({ id: masterData.id, name: masterData.name })
              .from(masterData)
              .where(
                and(
                  eq(masterData.tenantId, tenantId),
                  inArray(masterData.id, kindIds),
                ),
              )
          ).map((row) => [row.id, row.name]),
        );
        if (event.eventTypeId && names.has(event.eventTypeId))
          values.eventType = names.get(event.eventTypeId)!;
        if (event.packageId && names.has(event.packageId))
          values.package = names.get(event.packageId)!;
      }
    }
    const subject = document.subject ?? template?.subject,
      introText = document.introText ?? template?.introText,
      outroText = document.outroText ?? template?.outroText,
      validityDays = document.validityDays ?? template?.validityDays;
    if (
      typeof subject !== 'string' ||
      typeof introText !== 'string' ||
      typeof outroText !== 'string' ||
      typeof validityDays !== 'number'
    )
      throw new DocumentError('missing_reference');
    const content = { subject, introText, outroText };
    const validUntil =
      document.kind === 'offer'
        ? validityDate(issuedAt, validityDays, tenant.timezone)
        : undefined;
    const formattedValidUntil = validUntil?.toString().split('-').reverse();
    // RG-07: the due day is the invoice day in the tenant calendar plus the
    // agreed term - the same arithmetic as an offer's deadline, so a 23- or
    // 25-hour DST day can never shift it. It is computed here and nowhere else:
    // finalization freezes exactly this value, so the paper and `due_date`
    // cannot drift apart. A draft has no due day stored, but its preview prints
    // the day it would get.
    const serviceDate = document.serviceDate ?? null,
      paymentTermDays = document.paymentTermDays ?? null,
      // RG-07b: the account is printed word for word - no placeholder, no
      // reformatting. It is part of the same print option, so it appears right
      // under the due line and nowhere else.
      bankAccount = document.bankAccount ?? null,
      dueDate =
        isInvoiceKind(document.kind) && paymentTermDays !== null
          ? validityDate(issuedAt, paymentTermDays, tenant.timezone)
          : null,
      // The print option of the two lines, exactly like the correction and the
      // settlement block: it travels with the layout, so a document without a
      // value keeps byte-identical HTML.
      invoiceDates: DocumentInvoiceDates | undefined =
        isInvoiceKind(document.kind) &&
        (serviceDate !== null || dueDate !== null || bankAccount !== null)
          ? {
              ...(serviceDate ? { serviceDate: printedDay(serviceDate) } : {}),
              ...(dueDate !== null && paymentTermDays !== null
                ? {
                    paymentTermDays,
                    dueDate: printedDay(dueDate.toString()),
                  }
                : {}),
              ...(bankAccount ? { bankAccount } : {}),
            }
          : undefined;
    // BKP019.c2: a correction prints what it corrects. The reference travels with
    // the layout, which the snapshot forwards unchanged, so every other document
    // keeps byte-identical HTML.
    const correctionReference =
      document.kind === 'correction'
        ? await correctionPrints(
            connection,
            document.id,
            totals.grossMinor,
            tenant.timezone,
          )
        : undefined;
    // BKP019.c3.2: a final invoice prints the advances it settles. The same print
    // option pattern as the correction: it travels with the layout, and a
    // document without a role keeps byte-identical HTML.
    const depositReference = await depositPrints(
      connection,
      document,
      totals.grossMinor,
      tenant.timezone,
    );
    const snapshot = buildDocumentSnapshot({
      layout: {
        senderName: layout.senderName,
        senderStreet: layout.senderStreet,
        senderPostalCode: layout.senderPostalCode,
        senderCity: layout.senderCity,
        primaryColor: layout.primaryColor,
        textColor: layout.textColor,
        fontFamily: layout.fontFamily as 'system' | 'sans' | 'serif',
        showPageNumbers: layout.showPageNumbers,
        showPositionNumbers: layout.showPositionNumbers,
        ...(correctionReference ? { correctionReference } : {}),
        ...(depositReference ? { depositReference } : {}),
        ...(invoiceDates ? { invoiceDates } : {}),
      },
      template: content,
      documentNumber,
      issuedAt,
      timeZone: tenant.timezone,
      recipientName: recipient.name,
      recipientAddress: recipient.address,
      lines,
      values,
      ...(formattedValidUntil
        ? { validUntil: formattedValidUntil.join('.') }
        : {}),
      ...(logoDataUri ? { logoDataUri } : {}),
    });
    // The deadline the PDF prints is the one frozen at finalization: one
    // computation feeds both the bytes and `valid_until`, so they cannot drift.
    return {
      ...snapshot,
      validUntil: validUntil?.toString() ?? null,
      // RG-07: the same for the due day - the printed line and the frozen
      // `due_date` are one computation.
      dueDate: dueDate?.toString() ?? null,
    };
  }

  async function assertReference(
    connection: Connection,
    table: 'event' | 'contact' | 'product',
    id: string | null | undefined,
  ) {
    if (!id) return;
    const [row] =
      table === 'event'
        ? await database(connection)
            .select({ id: events.id })
            .from(events)
            .where(and(eq(events.tenantId, tenantId), eq(events.id, id)))
        : table === 'contact'
          ? await database(connection)
              .select({ id: contacts.id })
              .from(contacts)
              .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id)))
          : await database(connection)
              .select({ id: products.id })
              .from(products)
              .where(and(eq(products.tenantId, tenantId), eq(products.id, id)));
    if (!row) throw new DocumentError('not_found');
  }

  return {
    async createBlankOffer(actorId: string, input: BlankOfferInput) {
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        await assertReference(tx, 'event', input.eventId);
        await assertReference(tx, 'contact', input.contactId);
        const at = now();
        await tx.insert(documents).values({
          tenantId,
          id,
          kind: 'offer',
          templateId: null,
          eventId: input.eventId,
          contactId: input.contactId,
          number: null,
          state: 'draft',
          issuedAt: at,
          finalizedAt: null,
          subject: 'Angebot',
          introText: '',
          outroText: '',
          validityDays: 14,
          snapshotHash: null,
          pdfHash: null,
          netMinor: 0,
          taxMinor: 0,
          grossMinor: 0,
          version: 1,
        });
        await appendAudit(tx, tenantId, 'document.created', actorId, id);
      });
      return (await readOne(db, id))!;
    },
    async get(id: string) {
      return readOne(db, id);
    },
    // The overview only needs the header fields; lines stay per document.
    // Filters narrow the whole result in SQL: the UI never filters one page.
    async list(filters: DocumentFilters = {}) {
      assertDocumentFilters(filters);
      const include = filters.include === 'metadata';
      const columns = {
        id: documents.id,
        kind: documents.kind,
        templateId: documents.templateId,
        eventId: documents.eventId,
        contactId: documents.contactId,
        number: documents.number,
        state: documents.state,
        issuedAt: documents.issuedAt,
        finalizedAt: documents.finalizedAt,
        netMinor: documents.netMinor,
        taxMinor: documents.taxMinor,
        grossMinor: documents.grossMinor,
        version: documents.version,
      };
      const where = and(
        scope,
        filters.eventId ? eq(documents.eventId, filters.eventId) : undefined,
        filters.kind ? eq(documents.kind, filters.kind) : undefined,
        filters.state ? eq(documents.state, filters.state) : undefined,
      );
      // Without pagination and projection the query stays the plain select the
      // established clients already rely on.
      if (
        filters.include === undefined &&
        filters.limit === undefined &&
        filters.offset === undefined &&
        !filters.from &&
        !filters.to
      )
        return db
          .select(columns)
          .from(documents)
          .where(where)
          .orderBy(desc(documents.issuedAt), desc(documents.id));
      // One fixed tenant context query, never per row.
      const [tenant] = await db
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (!tenant) throw new DocumentError('missing_reference');
      const zone = tenant.timezone,
        // One clock reading for the whole page: expiry is a day comparison.
        at = now();
      // Inclusive local days become a half-open instant window. The upper bound
      // is the next local midnight, so a 23- or 25-hour DST day stays exact.
      // One offset per boundary comes from `Intl`, not from a fixed +01/+02.
      const localMidnight = (day: string) =>
        Temporal.PlainDate.from(day)
          .toZonedDateTime({ timeZone: zone, plainTime: '00:00' })
          .toInstant();
      const lower = filters.from ? localMidnight(filters.from) : null,
        upper = filters.to
          ? localMidnight(
              Temporal.PlainDate.from(filters.to).add({ days: 1 }).toString(),
            )
          : null;
      const narrowed = and(
        where,
        lower
          ? gte(documents.issuedAt, new Date(lower.epochMilliseconds))
          : undefined,
        upper
          ? lt(documents.issuedAt, new Date(upper.epochMilliseconds))
          : undefined,
      );
      // The offer projection adds the business status, the frozen deadline and
      // the derived expiry, and nothing else - no hashes, no artefact keys.
      if (filters.include === 'offer') {
        const offers = await db
          .select({
            ...columns,
            offerStatus: sql<string | null>`documents.offer_status`.as(
              'offer_status',
            ),
            validUntil: sql<
              string | null
            >`to_char(documents.valid_until, 'YYYY-MM-DD')`.as('valid_until'),
            acceptedAt: sql<
              string | null
            >`to_char(documents.accepted_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('accepted_at'),
            acceptanceChannel: sql<
              string | null
            >`documents.acceptance_channel`.as('acceptance_channel'),
            acceptanceNote: sql<string | null>`documents.acceptance_note`.as(
              'acceptance_note',
            ),
            acceptanceFileId: sql<
              string | null
            >`documents.acceptance_file_id`.as('acceptance_file_id'),
            // BKP019.b: the source of a confirmation, read in the same query -
            // never a lookup per row, and only this tenant's document.
            sourceDocumentId: sql<
              string | null
            >`documents.source_document_id`.as('source_document_id'),
            sourceNumber: sql<string | null>`(
              SELECT s.number FROM documents s
               WHERE s.tenant_id = documents.tenant_id
                 AND s.id = documents.source_document_id
            )`.as('source_number'),
            // BKP019.c2: the direction of this correction, and - for a source -
            // the sum of its finalized credit notes. Both are read in the same
            // query; the state and the remaining credit are derived below.
            correctionDirection: sql<
              string | null
            >`documents.correction_direction`.as('correction_direction'),
            creditedGrossMinor: sql<string>`(
              SELECT coalesce(sum(c.gross_minor), 0)::text FROM documents c
               WHERE c.tenant_id = documents.tenant_id
                 AND c.source_document_id = documents.id
                 AND c.kind = 'correction'
                 AND c.state = 'final'
                 AND c.correction_direction = 'credit'
            )`.as('credited_gross_minor'),
            // BKP019.d: the other half of the balance. Debits raise the claim and
            // payments reduce it; both are read in this one query, so the open
            // amount of a row can never be assembled from two different reads.
            debitedGrossMinor: sql<string>`(
              SELECT coalesce(sum(c.gross_minor), 0)::text FROM documents c
               WHERE c.tenant_id = documents.tenant_id
                 AND c.source_document_id = documents.id
                 AND c.kind = 'correction'
                 AND c.state = 'final'
                 AND c.correction_direction = 'debit'
            )`.as('debited_gross_minor'),
            paidMinor: sql<string>`(
              SELECT coalesce(sum(p.amount_minor), 0)::text FROM document_payments p
               WHERE p.tenant_id = documents.tenant_id
                 AND p.document_id = documents.id
            )`.as('paid_minor'),
            // BKP019.c3.2: the settlement axis of the same query. The role and
            // the frozen deduction are this row's own columns; what arrived on the
            // settled advances is derived from the advances of the same order and
            // stays a display value.
            invoiceRole: sql<string | null>`documents.invoice_role`.as(
              'invoice_role',
            ),
            depositAppliedMinor: sql<
              string | null
            >`documents.deposit_applied_minor::text`.as(
              'deposit_applied_minor',
            ),
            depositPaidMinor: sql<string>`(
              SELECT coalesce(sum(p.amount_minor), 0)::text
                FROM document_payments p
                JOIN documents pd
                  ON pd.tenant_id = p.tenant_id AND pd.id = p.document_id
               WHERE p.tenant_id = documents.tenant_id
                 AND pd.source_document_id = documents.source_document_id
                 AND pd.kind = 'deposit_invoice'
                 AND pd.state = 'final'
            )`.as('deposit_paid_minor'),
            // RG-07: the invoice dates travel with the same projection. A `date`
            // is read as text, so no driver can turn a tenant-local day into a
            // guessing instant; every non-invoice row answers NULL.
            serviceDate: sql<
              string | null
            >`to_char(documents.service_date, 'YYYY-MM-DD')`.as('service_date'),
            paymentTermDays: sql<
              string | null
            >`documents.payment_term_days::text`.as('payment_term_days'),
            dueDate: sql<
              string | null
            >`to_char(documents.due_date, 'YYYY-MM-DD')`.as('due_date'),
            // RG-07b: the printed account of an invoice, answered for every row
            // so no reader has to guess a shape.
            bankAccount: sql<string | null>`documents.bank_account`.as(
              'bank_account',
            ),
          })
          .from(documents)
          .where(narrowed)
          .orderBy(desc(documents.issuedAt), desc(documents.id))
          .limit(filters.limit ?? Number.MAX_SAFE_INTEGER)
          .offset(filters.offset ?? 0);
        // One batched read for the attached file names, never a lookup per row.
        const fileIds = [
            ...new Set(
              offers
                .map((offer) => offer.acceptanceFileId)
                .filter((fileId): fileId is string => fileId !== null),
            ),
          ],
          attached = new Map<
            string,
            { name: string; state: 'available' | 'archived' }
          >();
        if (fileIds.length) {
          const executor = db as unknown as {
            execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
          };
          const found = (await executor.execute(sql`
            SELECT id, display_name, state FROM library_files
             WHERE tenant_id = ${tenantId}
               AND id IN (${sql.join(
                 fileIds.map((fileId) => sql`${fileId}::uuid`),
                 sql`, `,
               )})`)) as {
            rows: {
              id: string;
              display_name: string;
              state: 'available' | 'archived';
            }[];
          };
          for (const file of found.rows)
            attached.set(file.id, {
              name: file.display_name,
              state: file.state,
            });
        }
        return offers.map(
          ({
            offerStatus,
            validUntil,
            acceptedAt,
            acceptanceChannel,
            acceptanceNote,
            acceptanceFileId,
            sourceDocumentId,
            sourceNumber,
            correctionDirection,
            creditedGrossMinor,
            debitedGrossMinor,
            paidMinor: paidGrossMinor,
            invoiceRole,
            depositAppliedMinor,
            depositPaidMinor,
            serviceDate,
            paymentTermDays: paymentTermDaysText,
            dueDate,
            bankAccount,
            ...row
          }) => {
            // BKP019.c2: only a finalized invoice or confirmation owns a
            // cancellation state, and only finalized credit notes count. A draft
            // changes nothing, and RG-08 reads "storniert" from this derivation
            // instead of from a status on the immutable source.
            const correctable =
                row.kind === 'invoice' || row.kind === 'order_confirmation',
              derived = correctable && row.state === 'final',
              credited = Number(creditedGrossMinor ?? 0);
            // BKP019.d: only a finalized invoice is a claim and can be paid. The
            // claim is `gross + debits - credits`; what is open subtracts the
            // payments. Both stay magnitudes and are never stored.
            // BKP019.c3.1: a finalized deposit invoice is a claim of its own, so
            // the same two derived values describe it. Nothing else widened.
            const payable =
                (row.kind === 'invoice' || row.kind === 'deposit_invoice') &&
                row.state === 'final',
              // BKP019.c3.2: a final invoice has already settled the advances
              // billed on its order, so its claim is the reduced amount. The
              // deduction is part of the claim and never a second status.
              settled = Number(depositAppliedMinor ?? 0),
              claim =
                row.grossMinor +
                Number(debitedGrossMinor ?? 0) -
                Number(creditedGrossMinor ?? 0) -
                settled,
              paid = Number(paidGrossMinor ?? 0);
            return {
              ...row,
              offerStatus: offerStatus as OfferStatus | null,
              validUntil,
              acceptedAt: acceptedAt ? new Date(acceptedAt) : null,
              acceptanceChannel: acceptanceChannel as AcceptanceChannel | null,
              acceptanceNote,
              acceptanceFileId,
              // A later archived file stays readable as "no longer available".
              acceptanceFileName: acceptanceFileId
                ? (attached.get(acceptanceFileId)?.name ?? null)
                : null,
              acceptanceFileState: acceptanceFileId
                ? (attached.get(acceptanceFileId)?.state ?? null)
                : null,
              // BKP019.b: a confirmation names the offer it was copied from.
              sourceDocumentId,
              sourceNumber,
              correctionDirection:
                correctionDirection as CorrectionDirection | null,
              correctionState: derived
                ? credited === 0
                  ? 'none'
                  : credited >= row.grossMinor
                    ? 'full'
                    : 'partial'
                : null,
              // A magnitude, never a signed amount: what may still be credited.
              remainingCredit: derived
                ? Math.max(0, row.grossMinor - credited)
                : null,
              // BKP019.d: "bezahlt" is never a print or a written status - it is
              // the sum of the payments that were recorded for this invoice. A
              // NULL is the honest value for every document that is no claim.
              paymentState: payable ? paymentState(claim, paid) : null,
              openMinor: payable ? openMinorOf(claim, paid) : null,
              // BKP019.c3.2: the settlement axis, answered for every row - NULL
              // where it does not apply, so no reader has to guess a shape.
              invoiceRole: (invoiceRole as InvoiceRole | null) ?? null,
              depositAppliedMinor:
                depositAppliedMinor === null ||
                depositAppliedMinor === undefined
                  ? null
                  : Number(depositAppliedMinor),
              // Only a final invoice shows what arrived on its advances; every
              // other row answers NULL instead of a derived zero of its own.
              depositPaidMinor:
                (invoiceRole as InvoiceRole | null) === 'final'
                  ? Number(depositPaidMinor ?? 0)
                  : null,
              // Derived, never stored: the deadline and the tenant day decide.
              offerExpired: offerExpired(
                validUntil,
                offerStatus as OfferStatus | null,
                at,
                zone,
              ),
              // RG-07: the invoice dates, answered for every row so no reader has
              // to guess a shape. `due` is the value frozen at finalization.
              serviceDate: serviceDate ?? null,
              paymentTermDays:
                paymentTermDaysText === null ||
                paymentTermDaysText === undefined
                  ? null
                  : Number(paymentTermDaysText),
              dueDate: dueDate ?? null,
              // RG-08: the same frozen day plus the open claim and the tenant
              // day decide. A row that is no claim answers NULL instead of a
              // derived `false`, exactly like `paymentState`. Nothing is written
              // back: a credit note can heal the lateness without touching the
              // invoice.
              overdue: payable
                ? invoiceOverdue(dueDate ?? null, claim, paid, at, zone)
                : null,
              // RG-07b: the free-text account, NULL where none was entered.
              bankAccount: bankAccount ?? null,
            };
          },
        );
      }
      if (!include)
        return db
          .select(columns)
          .from(documents)
          .where(narrowed)
          .orderBy(desc(documents.issuedAt), desc(documents.id))
          .limit(filters.limit ?? Number.MAX_SAFE_INTEGER)
          .offset(filters.offset ?? 0);
      // One left join, never a lookup per row; the join is tenant-scoped, so a
      // foreign event id yields no name instead of leaking one.
      const rows = await db
        .select({
          ...columns,
          pdfHash: documents.pdfHash,
          eventName: sql<string | null>`${events.name}`.as('event_name'),
        })
        .from(documents)
        .leftJoin(
          events,
          and(eq(events.tenantId, tenantId), eq(events.id, documents.eventId)),
        )
        .where(narrowed)
        .orderBy(desc(documents.issuedAt), desc(documents.id))
        .limit(filters.limit ?? Number.MAX_SAFE_INTEGER)
        .offset(filters.offset ?? 0);

      return rows.map(({ pdfHash, ...row }) => ({
        ...row,
        issuedDate: Temporal.Instant.fromEpochMilliseconds(
          row.issuedAt.getTime(),
        )
          .toZonedDateTimeISO(zone)
          .toPlainDate()
          .toString(),
        // The PDF route also needs a number and the artefact hash; a final row
        // whose metadata was lost must not offer a download that 404s.
        // Only the boolean leaves the server; the artefact key never does.
        pdfAvailable:
          row.state === 'final' && pdfHash !== null && row.number !== null,
      }));
    },
    // Only a final document has an artefact; the hash names it, so the bytes
    // always belong to the recorded snapshot.
    async pdf(id: string) {
      const [document] = await db
        .select({
          number: documents.number,
          pdfHash: documents.pdfHash,
          state: documents.state,
        })
        .from(documents)
        .where(and(scope, eq(documents.id, id)));
      if (!document?.pdfHash || document.state !== 'final' || !document.number)
        throw new DocumentError('not_found');
      try {
        return {
          number: document.number,
          bytes: await readDocumentPdf(dependencies.store, document.pdfHash),
        };
      } catch (error) {
        if (error instanceof StorageError)
          throw new DocumentError(
            error.reason === 'missing' ? 'not_found' : 'artifact_failed',
          );
        throw error;
      }
    },
    async createDraft(actorId: string, input: DocumentDraftInput) {
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [template] = await tx
          .select()
          .from(documentTemplates)
          .where(
            and(
              eq(documentTemplates.tenantId, tenantId),
              eq(documentTemplates.id, input.templateId),
            ),
          );
        if (!template) throw new DocumentError('not_found');
        // BKP019.c2: a correction only exists with a source document, never from
        // a template. The template stays manageable, but it can create nothing -
        // a clear 400 instead of a CHECK violation.
        if (template.kind === 'correction')
          throw new DocumentError('invalid_kind');
        await assertReference(tx, 'event', input.eventId);
        await assertReference(tx, 'contact', input.contactId);
        const source = input.lines
          ? input.lines
          : (
              await tx
                .select()
                .from(documentTemplatePositions)
                .where(
                  and(
                    eq(documentTemplatePositions.tenantId, tenantId),
                    eq(documentTemplatePositions.templateId, template.id),
                  ),
                )
                .orderBy(asc(documentTemplatePositions.position))
            ).map((position) => ({
              productId: position.productId,
              description: position.description,
              quantity: position.quantity,
              unit: position.unit,
              unitPriceMinor: position.unitPriceMinor,
              taxBasisPoints: position.taxBasisPoints,
              discountBasisPoints: position.discountBasisPoints,
            }));
        if (!source.length) throw new DocumentError('empty_lines');
        source.forEach(assertLine);
        const totals = documentTotals(source),
          at = now();
        await tx.insert(documents).values({
          tenantId,
          id,
          kind: template.kind,
          templateId: template.id,
          eventId: input.eventId ?? null,
          contactId: input.contactId ?? null,
          number: null,
          state: 'draft',
          issuedAt: at,
          finalizedAt: null,
          subject: template.subject,
          introText: template.introText,
          outroText: template.outroText,
          validityDays: template.validityDays,
          snapshotHash: null,
          pdfHash: null,
          netMinor: totals.netMinor,
          taxMinor: totals.taxMinor,
          grossMinor: totals.grossMinor,
          version: 1,
        });
        await tx.insert(documentLines).values(
          source.map((line, position) => ({
            tenantId,
            documentId: id,
            id: randomUUID(),
            position,
            productId: line.productId ?? null,
            description: line.description.trim(),
            quantity: line.quantity,
            unit: line.unit.trim(),
            unitPriceMinor: line.unitPriceMinor,
            taxBasisPoints: line.taxBasisPoints,
            discountBasisPoints: line.discountBasisPoints,
          })),
        );
        await appendAudit(tx, tenantId, 'document.created', actorId, id);
      });
      return (await readOne(db, id))!;
    },
    // BKP019.b: an accepted offer becomes a confirmation draft without a single
    // retyped position. The copy is its own document with its own number range;
    // the offer keeps its number, its bytes and its status untouched.
    async createOrderConfirmation(
      actorId: string,
      offerId: string,
      expectedVersion: number,
    ) {
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          // The offer row is locked, so a simultaneous withdrawal can never slip
          // between the status check and the copy.
          const [offer] = await tx
            .select()
            .from(documents)
            .where(and(scope, eq(documents.id, offerId)))
            .for('update');
          if (!offer) throw new DocumentError('not_found');
          if (offer.kind !== 'offer') throw new DocumentError('invalid_kind');
          if (offer.state !== 'final') throw new DocumentError('invalid_state');
          if (offer.version !== expectedVersion)
            throw new DocumentError('conflict');
          const source = await offerStateOf(tx, offerId);
          // Only the customer's yes is an order: an unsent, a merely sent or a
          // withdrawn offer is not.
          if (source.offerStatus !== 'accepted')
            throw new DocumentError('offer_not_accepted');
          // A confirmation lives in the event file, and a template-less document
          // needs both references; an offer without them cannot be copied.
          if (!offer.eventId || !offer.contactId)
            throw new DocumentError('missing_reference');
          // A very old offer may have no stored wording at all. Copying it would
          // produce an unprintable document, so it is refused instead of guessed.
          if (
            offer.introText === null ||
            offer.outroText === null ||
            offer.validityDays === null
          )
            throw new DocumentError('missing_reference');
          const lines = await tx
            .select(lineColumns)
            .from(documentLines)
            .where(
              and(
                eq(documentLines.tenantId, tenantId),
                eq(documentLines.documentId, offerId),
              ),
            )
            .orderBy(asc(documentLines.position));
          if (!lines.length) throw new DocumentError('empty_lines');
          // Sums are recomputed from the copied gross prices, so they cannot
          // drift from the positions that are actually printed.
          const totals = documentTotals(lines),
            at = now();
          await tx.insert(documents).values({
            tenantId,
            id,
            kind: 'order_confirmation',
            // No template: the offer is the source, not a template.
            templateId: null,
            eventId: offer.eventId,
            contactId: offer.contactId,
            number: null,
            state: 'draft',
            issuedAt: at,
            finalizedAt: null,
            // Addressed as a confirmation; the rest is the offer's own wording.
            subject: 'Auftragsbestätigung für {{contact}}',
            introText: offer.introText,
            outroText: offer.outroText,
            // Inert for a confirmation: no deadline is printed or frozen for it,
            // but the content block requires a value.
            validityDays: offer.validityDays,
            snapshotHash: null,
            pdfHash: null,
            netMinor: totals.netMinor,
            taxMinor: totals.taxMinor,
            grossMinor: totals.grossMinor,
            version: 1,
          });
          // `schema.ts` stays unchanged on purpose - every other row contract is
          // keyed to it - so the one new column is written by reviewed SQL in the
          // same transaction. Its CHECK, its tenant-bound FK and the partial
          // unique index decide, not the application.
          await tx.execute(sql`UPDATE documents
                                  SET source_document_id = ${offerId}::uuid
                                WHERE tenant_id = ${tenantId} AND id = ${id}`);
          await tx.insert(documentLines).values(
            lines.map((line, position) => ({
              tenantId,
              documentId: id,
              id: randomUUID(),
              position,
              productId: line.productId,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              // Verbatim: the gross price and both basis-point rates, never a
              // conversion and never a second rounding.
              unitPriceMinor: line.unitPriceMinor,
              taxBasisPoints: line.taxBasisPoints,
              discountBasisPoints: line.discountBasisPoints,
            })),
          );
          await appendAudit(tx, tenantId, 'document.created', actorId, id);
        });
      } catch (error) {
        // The partial unique index is the duplicate guard: a second confirmation
        // is refused, and the first one keeps its number and its bytes.
        if (uniqueViolation(error)) throw new DocumentError('duplicate');
        throw error;
      }
      return (await readOne(db, id))!;
    },
    // BKP019.c1: a finalized confirmation becomes an invoice draft without a
    // single retyped position. The copy is its own document with the invoice
    // number range, so the confirmation and the offer it came from keep their
    // numbers, their bytes and their status untouched.
    // The order of the checks is the contract, not an accident:
    //   1. missing row        -> not_found (a foreign tenant's row is missing)
    //   2. wrong kind         -> invalid_kind (only a confirmation is billable)
    //   3. withdrawn order    -> order_withdrawn (also a withdrawn source state)
    //   4. not final yet      -> invalid_state (a draft can still move)
    //   5. stale version      -> conflict (nothing copied, nothing written)
    //   6. unusable source    -> missing_reference / empty_lines
    //   7. duplicate          -> duplicate, decided by the partial unique index
    async createInvoice(
      actorId: string,
      confirmationId: string,
      expectedVersion: number,
    ) {
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          // The confirmation row is locked, so a simultaneous withdrawal can
          // never slip between the order check and the copy.
          const [confirmation] = await tx
            .select()
            .from(documents)
            .where(and(scope, eq(documents.id, confirmationId)))
            .for('update');
          if (!confirmation) throw new DocumentError('not_found');
          if (confirmation.kind !== 'order_confirmation')
            throw new DocumentError('invalid_kind');
          // A withdrawn order is not billable. The confirmation stays final and
          // readable - only the order behind it is gone.
          if (confirmation.state === 'withdrawn')
            throw new DocumentError('order_withdrawn');
          if (confirmation.state !== 'final')
            throw new DocumentError('invalid_state');
          if (confirmation.version !== expectedVersion)
            throw new DocumentError('conflict');
          // The confirmation keeps no status of its own; the order it was copied
          // from does. A withdrawn offer withdraws the order, so it is refused
          // here even though the confirmation itself says `final`. The status is
          // read as reviewed SQL for the same reason the link is written that
          // way: `schema.ts` stays unchanged.
          const source = await offerStateOf(tx, confirmationId);
          if (source.sourceDocumentId) {
            const executor = database(tx) as unknown as {
              execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
            };
            const withdrawnSource = (await executor.execute(sql`
              SELECT 1 FROM documents c
                JOIN documents o
                  ON o.tenant_id = c.tenant_id
                 AND o.id = c.source_document_id
               WHERE c.tenant_id = ${tenantId} AND c.id = ${confirmationId}
                 AND o.offer_status = 'withdrawn'`)) as { rows: unknown[] };
            if (withdrawnSource.rows.length)
              throw new DocumentError('order_withdrawn');
          }
          // An invoice lives in the event file, and a template-less document
          // needs both references; an unfinalized source cannot supply them.
          if (!confirmation.eventId || !confirmation.contactId)
            throw new DocumentError('missing_reference');
          if (
            confirmation.introText === null ||
            confirmation.outroText === null ||
            confirmation.validityDays === null
          )
            throw new DocumentError('missing_reference');
          const lines = await tx
            .select(lineColumns)
            .from(documentLines)
            .where(
              and(
                eq(documentLines.tenantId, tenantId),
                eq(documentLines.documentId, confirmationId),
              ),
            )
            .orderBy(asc(documentLines.position));
          if (!lines.length) throw new DocumentError('empty_lines');
          // Sums are recomputed from the copied gross prices, so they cannot
          // drift from the positions that are actually printed.
          const totals = documentTotals(lines),
            at = now();
          // The blank-document rule demands the source at insert time, so the
          // row is written as one reviewed-SQL insert instead of an insert plus
          // a later link. `schema.ts` stays unchanged for the same reason as in
          // BKP019.b: its CHECK, its tenant-bound FK and the partial unique index
          // decide, not the application.
          await tx.execute(sql`INSERT INTO documents
              (tenant_id, id, kind, template_id, event_id, contact_id, number,
               state, issued_at, finalized_at, subject, intro_text, outro_text,
               validity_days, snapshot_hash, pdf_hash, net_minor, tax_minor,
               gross_minor, version, source_document_id)
            VALUES (
              ${tenantId}, ${id}::uuid, 'invoice', NULL,
              ${confirmation.eventId}::uuid, ${confirmation.contactId}::uuid,
              NULL, 'draft', ${at}, NULL,
              ${'Rechnung für {{contact}}'}, ${confirmation.introText},
              ${confirmation.outroText}, ${confirmation.validityDays},
              NULL, NULL, ${totals.netMinor}, ${totals.taxMinor},
              ${totals.grossMinor}, 1, ${confirmationId}::uuid)`);
          await tx.insert(documentLines).values(
            lines.map((line, position) => ({
              tenantId,
              documentId: id,
              id: randomUUID(),
              position,
              productId: line.productId,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              // Verbatim: the gross price and both basis-point rates, never a
              // conversion and never a second rounding.
              unitPriceMinor: line.unitPriceMinor,
              taxBasisPoints: line.taxBasisPoints,
              discountBasisPoints: line.discountBasisPoints,
            })),
          );
          await appendAudit(tx, tenantId, 'document.created', actorId, id);
        });
      } catch (error) {
        // The partial unique index is the duplicate guard: a second invoice is
        // refused, and the first one keeps its number and its bytes.
        if (uniqueViolation(error)) throw new DocumentError('duplicate');
        throw error;
      }
      return (await readOne(db, id))!;
    },
    // BKP019.c3.1: a finalized confirmation can also be invoiced in advance. The
    // advance is its own document with the AZ number range and a link to the
    // confirmation; it starts as an editable draft, in which the operator reduces
    // the copied order to the agreed deposit - the amount is the operator's
    // decision, not a derived percentage of this slice.
    // The order of the checks is the contract, exactly like `createInvoice`:
    //   1. missing row      -> not_found
    //   2. wrong kind       -> invalid_kind (only a confirmation is billable)
    //   3. withdrawn order  -> order_withdrawn (also a withdrawn source state)
    //   4. not final yet    -> invalid_state (a draft can still move)
    //   5. stale version    -> conflict (nothing copied, nothing written)
    //   6. unusable source  -> missing_reference / empty_lines
    // There is deliberately no duplicate step: several advances per order are
    // legitimate, so the database has no unique index here and the operator's
    // saving guard is what keeps a double click from writing two drafts.
    async createDepositInvoice(
      actorId: string,
      confirmationId: string,
      expectedVersion: number,
    ) {
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        // The confirmation row is locked, so a simultaneous withdrawal can never
        // slip between the order check and the copy.
        const [confirmation] = await tx
          .select()
          .from(documents)
          .where(and(scope, eq(documents.id, confirmationId)))
          .for('update');
        if (!confirmation) throw new DocumentError('not_found');
        if (confirmation.kind !== 'order_confirmation')
          throw new DocumentError('invalid_kind');
        // A withdrawn order is not billable - in advance or otherwise.
        if (confirmation.state === 'withdrawn')
          throw new DocumentError('order_withdrawn');
        if (confirmation.state !== 'final')
          throw new DocumentError('invalid_state');
        if (confirmation.version !== expectedVersion)
          throw new DocumentError('conflict');
        // The order itself may be withdrawn even though the confirmation is
        // still final; the status is read exactly like `createInvoice` reads it.
        const source = await offerStateOf(tx, confirmationId);
        if (source.sourceDocumentId) {
          const executor = database(tx) as unknown as {
            execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
          };
          const withdrawnSource = (await executor.execute(sql`
            SELECT 1 FROM documents c
              JOIN documents o
                ON o.tenant_id = c.tenant_id
               AND o.id = c.source_document_id
             WHERE c.tenant_id = ${tenantId} AND c.id = ${confirmationId}
               AND o.offer_status = 'withdrawn'`)) as { rows: unknown[] };
          if (withdrawnSource.rows.length)
            throw new DocumentError('order_withdrawn');
        }
        // A deposit lives in the event file, and a template-less document needs
        // both references and the three texts the confirmation owns.
        if (!confirmation.eventId || !confirmation.contactId)
          throw new DocumentError('missing_reference');
        if (
          confirmation.introText === null ||
          confirmation.outroText === null ||
          confirmation.validityDays === null
        )
          throw new DocumentError('missing_reference');
        const lines = await tx
          .select(lineColumns)
          .from(documentLines)
          .where(
            and(
              eq(documentLines.tenantId, tenantId),
              eq(documentLines.documentId, confirmationId),
            ),
          )
          .orderBy(asc(documentLines.position));
        if (!lines.length) throw new DocumentError('empty_lines');
        // Sums are recomputed from the copied gross prices, so they cannot drift
        // from the positions that are actually printed.
        const totals = documentTotals(lines),
          at = now();
        // The blank-document rule demands the source at insert time, so the row
        // is written as one reviewed-SQL insert instead of an insert plus a later
        // link. `schema.ts` stays unchanged for the same reason as in BKP019.b/.c1.
        await tx.execute(sql`INSERT INTO documents
            (tenant_id, id, kind, template_id, event_id, contact_id, number,
             state, issued_at, finalized_at, subject, intro_text, outro_text,
             validity_days, snapshot_hash, pdf_hash, net_minor, tax_minor,
             gross_minor, version, source_document_id)
          VALUES (
            ${tenantId}, ${id}::uuid, 'deposit_invoice', NULL,
            ${confirmation.eventId}::uuid, ${confirmation.contactId}::uuid,
            NULL, 'draft', ${at}, NULL,
            ${'Anzahlungsrechnung für {{contact}}'}, ${confirmation.introText},
            ${confirmation.outroText}, ${confirmation.validityDays},
            NULL, NULL, ${totals.netMinor}, ${totals.taxMinor},
            ${totals.grossMinor}, 1, ${confirmationId}::uuid)`);
        await tx.insert(documentLines).values(
          lines.map((line, position) => ({
            tenantId,
            documentId: id,
            id: randomUUID(),
            position,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            // Verbatim: the gross price and both basis-point rates, never a
            // conversion and never a second rounding.
            unitPriceMinor: line.unitPriceMinor,
            taxBasisPoints: line.taxBasisPoints,
            discountBasisPoints: line.discountBasisPoints,
          })),
        );
        await appendAudit(tx, tenantId, 'document.created', actorId, id);
      });
      return (await readOne(db, id))!;
    },
    // BKP019.c3.2: the same finalized confirmation can be billed as the *final*
    // invoice, which settles the advances already billed on it. The role is the
    // one difference to c1: it stays the same kind of document, owns the same RE
    // number circle and prints the full order amount plus a settlement block, so
    // no second document kind and no second numbering were invented.
    // The order of the checks is the contract, exactly like `createInvoice`:
    //   1. missing row      -> not_found
    //   2. wrong kind       -> invalid_kind (only a confirmation is billable)
    //   3. withdrawn order  -> order_withdrawn (also a withdrawn source state)
    //   4. not final yet    -> invalid_state (a draft can still move)
    //   5. stale version    -> conflict (nothing copied, nothing written)
    //   6. unusable source  -> missing_reference / empty_lines
    //   7. duplicate        -> duplicate, decided by the partial unique index:
    //      `documents_one_invoice` stays untouched, so a confirmation carries
    //      exactly one invoice - the standard one or the final one.
    async createFinalInvoice(
      actorId: string,
      confirmationId: string,
      expectedVersion: number,
    ) {
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          // The confirmation row is locked, so a simultaneous withdrawal can
          // never slip between the order check and the copy.
          const [confirmation] = await tx
            .select()
            .from(documents)
            .where(and(scope, eq(documents.id, confirmationId)))
            .for('update');
          if (!confirmation) throw new DocumentError('not_found');
          if (confirmation.kind !== 'order_confirmation')
            throw new DocumentError('invalid_kind');
          if (confirmation.state === 'withdrawn')
            throw new DocumentError('order_withdrawn');
          if (confirmation.state !== 'final')
            throw new DocumentError('invalid_state');
          if (confirmation.version !== expectedVersion)
            throw new DocumentError('conflict');
          const source = await offerStateOf(tx, confirmationId);
          if (source.sourceDocumentId) {
            const executor = database(tx) as unknown as {
              execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
            };
            const withdrawnSource = (await executor.execute(sql`
              SELECT 1 FROM documents c
                JOIN documents o
                  ON o.tenant_id = c.tenant_id
                 AND o.id = c.source_document_id
               WHERE c.tenant_id = ${tenantId} AND c.id = ${confirmationId}
                 AND o.offer_status = 'withdrawn'`)) as { rows: unknown[] };
            if (withdrawnSource.rows.length)
              throw new DocumentError('order_withdrawn');
          }
          if (!confirmation.eventId || !confirmation.contactId)
            throw new DocumentError('missing_reference');
          if (
            confirmation.introText === null ||
            confirmation.outroText === null ||
            confirmation.validityDays === null
          )
            throw new DocumentError('missing_reference');
          const lines = await tx
            .select(lineColumns)
            .from(documentLines)
            .where(
              and(
                eq(documentLines.tenantId, tenantId),
                eq(documentLines.documentId, confirmationId),
              ),
            )
            .orderBy(asc(documentLines.position));
          if (!lines.length) throw new DocumentError('empty_lines');
          // Sums are recomputed from the copied gross prices, so the printed gross
          // is the order's own amount - the deduction is printed separately and
          // never bends a position.
          const totals = documentTotals(lines),
            at = now();
          await tx.execute(sql`INSERT INTO documents
              (tenant_id, id, kind, template_id, event_id, contact_id, number,
               state, issued_at, finalized_at, subject, intro_text, outro_text,
               validity_days, snapshot_hash, pdf_hash, net_minor, tax_minor,
               gross_minor, version, source_document_id, invoice_role)
            VALUES (
              ${tenantId}, ${id}::uuid, 'invoice', NULL,
              ${confirmation.eventId}::uuid, ${confirmation.contactId}::uuid,
              NULL, 'draft', ${at}, NULL,
              ${'Rechnung für {{contact}}'}, ${confirmation.introText},
              ${confirmation.outroText}, ${confirmation.validityDays},
              NULL, NULL, ${totals.netMinor}, ${totals.taxMinor},
              ${totals.grossMinor}, 1, ${confirmationId}::uuid, 'final')`);
          await tx.insert(documentLines).values(
            lines.map((line, position) => ({
              tenantId,
              documentId: id,
              id: randomUUID(),
              position,
              productId: line.productId,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPriceMinor: line.unitPriceMinor,
              taxBasisPoints: line.taxBasisPoints,
              discountBasisPoints: line.discountBasisPoints,
            })),
          );
          await appendAudit(tx, tenantId, 'document.created', actorId, id);
        });
      } catch (error) {
        // The untouched one-invoice index is the duplicate guard: a confirmation
        // that already carries an invoice - standard or final - is refused, and
        // the first one keeps its number and its bytes.
        if (uniqueViolation(error)) throw new DocumentError('duplicate');
        throw error;
      }
      return (await readOne(db, id))!;
    },
    // BKP019.c2: a finalized invoice (or order confirmation) is corrected by its
    // own follow-up document. The direction lives on the document and every
    // stored amount stays a magnitude, so the original keeps its number, its
    // state and its bytes while the correction prints the signed sum.
    // The order of the checks is the contract, exactly like `createInvoice`:
    //   1. missing row      -> not_found
    //   2. wrong kind       -> invalid_kind (no chain, no blank correction)
    //   3. not final yet    -> invalid_state (a draft can still move)
    //   4. stale version    -> conflict (nothing copied, nothing written)
    //   5. bad direction    -> invalid_content
    //   6. unusable source  -> missing_reference / empty_lines / invalid_line
    //   7. duplicate        -> duplicate, decided by the partial unique index
    async createCorrection(
      actorId: string,
      sourceId: string,
      expectedVersion: number,
      direction: CorrectionDirection,
      lines?: DocumentLineDraft[],
    ) {
      if (!(correctionDirections as readonly string[]).includes(direction))
        throw new DocumentError('invalid_content');
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          const [source] = await tx
            .select()
            .from(documents)
            .where(and(scope, eq(documents.id, sourceId)))
            .for('update');
          if (!source) throw new DocumentError('not_found');
          // Only an invoice, an order confirmation or a deposit invoice is
          // correctable, and only a finalized one. BKP019.c3.1: an advance payment
          // is money the customer already owes, so a wrong one must be correctable
          // like any other claim. A correction of a correction is not part of this
          // slice: the chain rule has to be decided on its own.
          if (
            source.kind !== 'invoice' &&
            source.kind !== 'order_confirmation' &&
            source.kind !== 'deposit_invoice'
          )
            throw new DocumentError('invalid_kind');
          if (source.state !== 'final')
            throw new DocumentError('invalid_state');
          if (source.version !== expectedVersion)
            throw new DocumentError('conflict');
          // A correction lives in the event file and carries no template, so the
          // blank-document rule needs both references and the three texts.
          if (!source.eventId || !source.contactId)
            throw new DocumentError('missing_reference');
          if (
            source.introText === null ||
            source.outroText === null ||
            source.validityDays === null
          )
            throw new DocumentError('missing_reference');
          const positions =
            lines ??
            (await tx
              .select(lineColumns)
              .from(documentLines)
              .where(
                and(
                  eq(documentLines.tenantId, tenantId),
                  eq(documentLines.documentId, sourceId),
                ),
              )
              .orderBy(asc(documentLines.position)));
          if (!positions.length) throw new DocumentError('empty_lines');
          positions.forEach(assertLine);
          // Only positions an operator typed need a product check; a copied
          // position already passed it on its own document.
          if (lines)
            for (const line of positions)
              await assertReference(tx, 'product', line.productId);
          // Sums are recomputed from the magnitudes that are actually printed, so
          // they cannot drift from the positions - and never become negative.
          const totals = documentTotals(positions),
            at = now();
          // The blank-document rule demands the source at insert time, so the row
          // is written as one reviewed-SQL insert. `schema.ts` stays unchanged for
          // the same reason as in BKP019.b/.c1.
          await tx.execute(sql`INSERT INTO documents
              (tenant_id, id, kind, template_id, event_id, contact_id, number,
               state, issued_at, finalized_at, subject, intro_text, outro_text,
               validity_days, snapshot_hash, pdf_hash, net_minor, tax_minor,
               gross_minor, version, source_document_id, correction_direction)
            VALUES (
              ${tenantId}, ${id}::uuid, 'correction', NULL,
              ${source.eventId}::uuid, ${source.contactId}::uuid,
              NULL, 'draft', ${at}, NULL,
              ${'Rechnungskorrektur für {{contact}}'}, ${source.introText},
              ${source.outroText}, ${source.validityDays},
              NULL, NULL, ${totals.netMinor}, ${totals.taxMinor},
              ${totals.grossMinor}, 1, ${sourceId}::uuid, ${direction})`);
          await tx.insert(documentLines).values(
            positions.map((line, position) => ({
              tenantId,
              documentId: id,
              id: randomUUID(),
              position,
              productId: line.productId ?? null,
              description: line.description.trim(),
              quantity: line.quantity,
              unit: line.unit.trim(),
              // Verbatim: the gross price and both basis-point rates, never a
              // conversion, never a negation, never a second rounding.
              unitPriceMinor: line.unitPriceMinor,
              taxBasisPoints: line.taxBasisPoints,
              discountBasisPoints: line.discountBasisPoints,
            })),
          );
          await appendAudit(tx, tenantId, 'document.created', actorId, id);
        });
      } catch (error) {
        // The partial unique index is the duplicate guard: one open correction
        // per source, while finalized partial credits stay legal.
        if (uniqueViolation(error)) throw new DocumentError('duplicate');
        throw error;
      }
      return (await readOne(db, id))!;
    },
    // Number, snapshot, PDF and state are one transaction: either the document
    // is final with all four, or the number goes back to the sequence.
    async updateDraftContent(
      actorId: string,
      id: string,
      content: DocumentDraftContent,
    ) {
      if (
        !Number.isInteger(content.version) ||
        content.version < 1 ||
        content.subject.length > 200 ||
        content.introText.length > 4000 ||
        content.outroText.length > 4000 ||
        !Number.isInteger(content.validityDays) ||
        content.validityDays < 1 ||
        content.validityDays > 365
      )
        throw new DocumentError('invalid_content');
      try {
        assertTemplateText(
          content.subject,
          content.introText,
          content.outroText,
        );
      } catch {
        throw new DocumentError('invalid_content');
      }
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [document] = await tx
          .select()
          .from(documents)
          .where(and(scope, eq(documents.id, id)))
          .for('update');
        if (!document) throw new DocumentError('not_found');
        // BKP019.b: a confirmation draft owns its own texts and positions, so
        // correcting them is the same right an offer draft has.
        // BKP019.c1: an invoice draft copied from a confirmation does too - a
        // finalized document is never edited, its draft is.
        // BKP019.c2: the same right for a correction draft. Its direction and its
        // source are fixed by the create step and are not part of this content.
        // BKP019.c3.1: and for a deposit draft - reducing the copied order to the
        // agreed advance happens here, so this is the one decision it carries.
        // Every other kind stays refused - this is not a global opening.
        if (
          document.state !== 'draft' ||
          (document.kind !== 'offer' &&
            document.kind !== 'order_confirmation' &&
            document.kind !== 'deposit_invoice' &&
            document.kind !== 'invoice' &&
            document.kind !== 'correction')
        )
          throw new DocumentError('invalid_state');
        if (document.version !== content.version)
          throw new DocumentError('conflict');
        // RG-07: the service day and the payment term are invoice fields. An
        // offer or a confirmation that sends them is refused, never silently
        // reduced to nothing - a refused body keeps the draft untouched, so the
        // version and the audit trail stay honest too.
        // RG-07b: the printed account is the same kind of field and follows the
        // same rule.
        if (
          (content.serviceDate !== undefined ||
            content.paymentTermDays !== undefined ||
            content.bankAccount !== undefined) &&
          !isInvoiceKind(document.kind)
        )
          throw new DocumentError('invalid_content');
        // One tenant clock reading for the whole write, and the tenant calendar
        // decides where "today" ends - the same rule the payments follow.
        const zone = await tenantTimeZone(tx),
          at = now(),
          serviceDate =
            content.serviceDate === undefined
              ? undefined
              : serviceDateOf(content.serviceDate, zone, at),
          paymentTermDays =
            content.paymentTermDays === undefined
              ? undefined
              : paymentTermDaysOf(content.paymentTermDays),
          bankAccount =
            content.bankAccount === undefined
              ? undefined
              : bankAccountOf(content.bankAccount);
        if (content.lines === undefined && document.templateId === null) {
          const [line] = await tx
            .select({ id: documentLines.id })
            .from(documentLines)
            .where(
              and(
                eq(documentLines.tenantId, tenantId),
                eq(documentLines.documentId, id),
              ),
            )
            .limit(1);
          if (!line) throw new DocumentError('empty_lines');
        }
        let totals: ReturnType<typeof documentTotals> | undefined;
        if (content.lines !== undefined) {
          if (!content.lines.length) throw new DocumentError('empty_lines');
          content.lines.forEach(assertLine);
          for (const line of content.lines)
            await assertReference(tx, 'product', line.productId);
          try {
            totals = documentTotals(content.lines);
          } catch (error) {
            if (error instanceof DocumentTotalsError)
              throw new DocumentError('invalid_line');
            throw error;
          }
          await tx
            .delete(documentLines)
            .where(
              and(
                eq(documentLines.tenantId, tenantId),
                eq(documentLines.documentId, id),
              ),
            );
          await tx.insert(documentLines).values(
            content.lines.map((line, position) => ({
              tenantId,
              documentId: id,
              id: randomUUID(),
              position,
              productId: line.productId ?? null,
              description: line.description.trim(),
              quantity: line.quantity,
              unit: line.unit.trim(),
              unitPriceMinor: line.unitPriceMinor,
              taxBasisPoints: line.taxBasisPoints,
              discountBasisPoints: line.discountBasisPoints,
            })),
          );
        }
        await tx
          .update(documents)
          .set({
            subject: content.subject,
            introText: content.introText,
            outroText: content.outroText,
            validityDays: content.validityDays,
            ...(totals
              ? {
                  netMinor: totals.netMinor,
                  taxMinor: totals.taxMinor,
                  grossMinor: totals.grossMinor,
                }
              : {}),
            version: document.version + 1,
          })
          .where(and(scope, eq(documents.id, id)));
        // RG-07: the two inputs live in columns `schema.ts` deliberately does not
        // mirror. Only what the body named is written: an omitted field keeps its
        // saved value, `null` clears it.
        // RG-07b: the printed account is written the same way. Finalization does
        // not touch it - there is no later write path, so the stored text is
        // already the frozen one.
        if (
          serviceDate !== undefined ||
          paymentTermDays !== undefined ||
          bankAccount !== undefined
        ) {
          const assignments = [
            ...(serviceDate !== undefined
              ? [sql`service_date = ${serviceDate}::date`]
              : []),
            ...(paymentTermDays !== undefined
              ? [sql`payment_term_days = ${paymentTermDays}::integer`]
              : []),
            ...(bankAccount !== undefined
              ? [sql`bank_account = ${bankAccount}::text`]
              : []),
          ];
          await tx.execute(
            sql`UPDATE documents SET ${sql.join(assignments, sql`, `)}
                 WHERE tenant_id = ${tenantId} AND id = ${id}`,
          );
        }
        await appendAudit(tx, tenantId, 'document.updated', actorId, id);
        return (await readOne(tx, id))!;
      });
    },
    async preview(id: string) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
        );
        const document = await readOne(tx, id);
        if (!document) throw new DocumentError('not_found');
        if (document.state !== 'draft')
          throw new DocumentError('invalid_state');
        try {
          const snapshot = await snapshotFor(tx, document, 'VORSCHAU', now());
          return await renderDocumentPdf(snapshot.html, dependencies.render);
        } catch (error) {
          translate(error);
        }
      });
    },
    async finalize(actorId: string, id: string, expectedVersion?: number) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [document] = await tx
          .select()
          .from(documents)
          .where(and(scope, eq(documents.id, id)))
          .for('update');
        if (!document) throw new DocumentError('not_found');
        if (
          expectedVersion !== undefined &&
          document.version !== expectedVersion
        )
          throw new DocumentError('conflict');
        try {
          assertTransition(document.state as DocumentState, 'final');
        } catch {
          throw new DocumentError('invalid_state');
        }
        // BKP019.c2: a credit note is bounded by what is still open on its
        // source. The check runs under the tenant lock and only here, so a draft
        // stays editable and two partial credits can coexist.
        if (document.kind === 'correction')
          await assertCorrectionCredit(tx, document);
        // BKP019.c3.2b: a settlement is bounded by the claim of its order. The
        // order of the checks is the contract - not found, version, state,
        // content, money - and this one runs after the `conflict` above and
        // before the number, the PDF and the frozen deduction exist. A refusal
        // therefore leaves the draft, its version and the number range untouched.
        if (document.kind === 'invoice')
          await assertSettlementWithinOrder(tx, document);
        const at = now();
        try {
          const completeDocument = await readOne(tx, id);
          if (!completeDocument) throw new DocumentError('not_found');
          if (!completeDocument.lines.length)
            throw new DocumentError('empty_lines');
          const [template] = document.templateId
            ? await tx
                .select({ id: documentTemplates.id })
                .from(documentTemplates)
                .where(
                  and(
                    eq(documentTemplates.tenantId, tenantId),
                    eq(documentTemplates.id, document.templateId),
                  ),
                )
            : [];
          const [layout] = await tx
            .select({ tenantId: documentLayouts.tenantId })
            .from(documentLayouts)
            .where(eq(documentLayouts.tenantId, tenantId));
          const [contact] = document.contactId
            ? await tx
                .select({ id: contacts.id })
                .from(contacts)
                .where(
                  and(
                    eq(contacts.tenantId, tenantId),
                    eq(contacts.id, document.contactId),
                  ),
                )
            : [];
          if ((document.templateId && !template) || !layout || !contact)
            throw new DocumentError('missing_reference');
          const number = await allocateDocumentNumber(
              tx,
              tenantId,
              document.kind as DocumentKind,
              at,
            ),
            snapshot = await snapshotFor(tx, completeDocument!, number, at),
            pdf = await renderDocumentPdf(snapshot.html, dependencies.render);
          await storeDocumentPdf(dependencies.store, pdf);
          await tx
            .update(documents)
            .set({
              number,
              state: 'final',
              issuedAt: at,
              finalizedAt: at,
              snapshotHash: snapshot.hash,
              pdfHash: pdf.hash,
              netMinor: snapshot.netMinor,
              taxMinor: snapshot.taxMinor,
              grossMinor: snapshot.grossMinor,
              version: document.version + 1,
            })
            .where(and(scope, eq(documents.id, id)));
          // BKP019.c3.2: the settlement of a final invoice is frozen here, in the
          // same transaction as the number and the bytes. The sum is the gross of
          // the advances that are *billed* at this instant - never the payments
          // received - so the printed "Zu zahlender Betrag" and the claim of the
          // payment balance can never drift apart. The paper is already printed
          // with the same value, because the render read it under this lock.
          if (document.kind === 'invoice') {
            const settlement = await settlementOf(tx, id);
            if (settlement.role === 'final' && settlement.sourceDocumentId) {
              const sums = await depositSums(tx, settlement.sourceDocumentId);
              await tx.execute(
                sql`UPDATE documents SET deposit_applied_minor = ${sums.applied}
                     WHERE tenant_id = ${tenantId} AND id = ${id}`,
              );
            }
          }
          // BKP019.0: the deadline the PDF already prints is frozen at this
          // instant and never recalculated. Every later status change keeps the
          // same bytes, and the same number still means the same day.
          if (snapshot.validUntil)
            await tx.execute(
              sql`UPDATE documents SET valid_until = ${snapshot.validUntil}::date
                  WHERE tenant_id = ${tenantId} AND id = ${id}`,
            );
          // RG-07: the due day the PDF already prints is frozen in the same
          // transaction as the number and the bytes. A final document has no
          // update path, so "Ziel vor Rechnungsdatum" cannot be written later
          // either - and a draft can never carry a due day at all (0047).
          if (snapshot.dueDate)
            await tx.execute(
              sql`UPDATE documents SET due_date = ${snapshot.dueDate}::date
                  WHERE tenant_id = ${tenantId} AND id = ${id}`,
            );
        } catch (error) {
          translate(error);
        }
        await appendAudit(tx, tenantId, 'document.finalized', actorId, id);
        return (await readOne(tx, id))!;
      });
    },
    // BKP019.0: an explicit operator action and never a reaction to mail, print
    // or the clock. The content stays final and byte-identical; only the
    // business axis, its instant and the version move.
    // BKP019.a: accepting records *how* the customer said yes. It stays the one
    // lock/audit path: no second route, no second transaction.
    async changeOfferStatus(
      actorId: string,
      id: string,
      input: OfferStatusChange,
    ) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [document] = await tx
          .select()
          .from(documents)
          .where(and(scope, eq(documents.id, id)))
          .for('update');
        if (!document) throw new DocumentError('not_found');
        // Only a finalized offer owns a business status: a draft has no claim
        // yet and every other kind never gets one.
        if (document.kind !== 'offer' || document.state !== 'final')
          throw new DocumentError('invalid_kind');
        if (document.version !== input.version)
          throw new DocumentError('conflict');
        const current = await offerStateOf(tx, id),
          zone = await tenantTimeZone(tx),
          at = now(),
          accepting = input.status === 'accepted',
          hasDetails =
            input.channel !== undefined ||
            input.acceptedAt !== undefined ||
            input.note !== undefined ||
            input.attachmentFileId !== undefined;
        // A record that belongs to an acceptance is never attached to any other
        // status: nothing is silently dropped.
        if (!accepting && hasDetails)
          throw new DocumentError('invalid_content');
        // An illegal transition is illegal before any detail is judged, so the
        // existing 409 contract stays exactly as it was.
        if (current.offerStatus !== input.status)
          assertOfferTransition(current.offerStatus, input.status);
        // Validated before the no-op branch, so a repeat is judged on the same
        // rules as the first write and no rejection changes the row.
        const channel = accepting ? acceptanceChannelOf(input.channel) : null,
          acceptedAt = accepting
            ? input.acceptedAt === undefined
              ? at
              : acceptanceInstantOf(input.acceptedAt, zone, at)
            : null,
          note = accepting ? acceptanceNoteOf(input.note) : null;
        // The identical action again is an idempotent no-op: no second audit
        // entry and no new version, so a double click is harmless. A changed
        // record is a conflict instead of a silent overwrite.
        if (current.offerStatus === input.status) {
          if (!accepting) return await offerRowOf(tx, id, at, zone);
          const same =
            current.acceptanceChannel === channel &&
            (input.acceptedAt === undefined ||
              current.acceptedAt?.getTime() === acceptedAt!.getTime()) &&
            (input.note === undefined || current.acceptanceNote === note) &&
            (input.attachmentFileId === undefined ||
              current.acceptanceFileId === input.attachmentFileId);
          if (!same) throw new DocumentError('acceptance_conflict');
          return await offerRowOf(tx, id, at, zone);
        }
        // The referenced file is read only now: an archived or foreign file can
        // never become an acceptance, and a repeat above stays a no-op.
        let attachmentFileId: string | null = null;
        if (accepting && input.attachmentFileId !== undefined) {
          const candidate = input.attachmentFileId;
          if (
            typeof candidate !== 'string' ||
            !acceptanceUuidPattern.test(candidate)
          )
            throw new DocumentError('invalid_attachment');
          const executor = database(tx) as unknown as {
            execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
          };
          const files = (await executor.execute(sql`
            SELECT state FROM library_files
             WHERE tenant_id = ${tenantId} AND id = ${candidate}`)) as {
            rows: { state: 'available' | 'archived' }[];
          };
          const file = files.rows[0];
          if (!file) throw new DocumentError('not_found');
          if (file.state !== 'available')
            throw new DocumentError('invalid_attachment');
          attachmentFileId = candidate;
        }
        // One statement keeps status, instant and record atomic; a later status
        // change leaves the acceptance columns exactly as they were.
        await tx.execute(
          sql`UPDATE documents
                 SET offer_status = ${input.status},
                     status_changed_at = ${at},
                     accepted_at = coalesce(${acceptedAt}::timestamptz, accepted_at),
                     acceptance_channel = coalesce(${channel}::text, acceptance_channel),
                     acceptance_note = coalesce(${note}::text, acceptance_note),
                     acceptance_file_id = coalesce(${attachmentFileId}::uuid, acceptance_file_id),
                     version = version + 1
               WHERE tenant_id = ${tenantId} AND id = ${id}`,
        );
        await appendAudit(
          tx,
          tenantId,
          offerAuditAction(input.status),
          actorId,
          id,
        );
        return await offerRowOf(tx, id, at, zone);
      });
    },
  };
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  dependencies: DocumentDependencies,
) {
  const repo = documentRepository(pool, tenantId, dependencies);
  const line = {
    type: 'object',
    additionalProperties: false,
    required: [
      'description',
      'quantity',
      'unit',
      'unitPriceMinor',
      'taxBasisPoints',
      'discountBasisPoints',
    ],
    properties: {
      productId: {
        anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
      },
      description: {
        type: 'string',
        minLength: 1,
        maxLength: 300,
        pattern: '\\S',
      },
      quantity: { type: 'integer', minimum: 1, maximum: 100000 },
      unit: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' },
      unitPriceMinor: {
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      taxBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
      discountBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
    },
  };
  const nullableUuid = {
      anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
    },
    nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] },
    params = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    };
  // BKP019.0: the offer axis, shared by the single-document answer and the
  // opt-in list projection, so both always describe the same values.
  // BKP019.a adds the acceptance record to the same shared shape.
  const offerFields = {
    offerStatus: {
      anyOf: [{ type: 'string', enum: [...offerStatuses] }, { type: 'null' }],
    },
    validUntil: {
      anyOf: [
        { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { type: 'null' },
      ],
    },
    offerExpired: { type: 'boolean' },
    acceptedAt: {
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    acceptanceChannel: {
      anyOf: [
        { type: 'string', enum: [...acceptanceChannels] },
        { type: 'null' },
      ],
    },
    acceptanceNote: nullableText,
    acceptanceFileId: nullableUuid,
    acceptanceFileName: nullableText,
    acceptanceFileState: {
      anyOf: [
        { type: 'string', enum: ['available', 'archived'] },
        { type: 'null' },
      ],
    },
    // BKP019.b: the offer a confirmation was copied from. The two keys are part
    // of the offer projection, so every older route keeps its own shape.
    sourceDocumentId: nullableUuid,
    sourceNumber: nullableText,
  };
  // BKP019.c2: the correction axis belongs to the opt-in projection only. The
  // offer-status routes keep exactly their own shape, like every older route:
  // `offerRow` does not grow, `offerListRow` does.
  const correctionFields = {
    correctionDirection: {
      anyOf: [
        { type: 'string', enum: [...correctionDirections] },
        { type: 'null' },
      ],
    },
    correctionState: {
      anyOf: [
        { type: 'string', enum: [...correctionStates] },
        { type: 'null' },
      ],
    },
    remainingCredit: {
      anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
    },
  };
  // BKP019.d: the payment axis, like the correction axis, belongs to the opt-in
  // projection only. `offerRow` (the status routes) and `listRow` (the metadata
  // projection) do not grow, so no older route changes its shape.
  const paymentFields = {
    paymentState: {
      anyOf: [{ type: 'string', enum: [...paymentStates] }, { type: 'null' }],
    },
    openMinor: {
      anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
    },
  };
  // BKP019.c3.2: the settlement axis, like every axis before it in the opt-in
  // projection only. `invoiceRole` names the role, `depositAppliedMinor` the
  // frozen deduction and `depositPaidMinor` what arrived on the settled advances.
  const settlementFields = {
    invoiceRole: {
      anyOf: [{ type: 'string', enum: [...invoiceRoles] }, { type: 'null' }],
    },
    depositAppliedMinor: {
      anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
    },
    depositPaidMinor: {
      anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }],
    },
  };
  // RG-07: the date axis of an invoice, additive in the same opt-in projection.
  // "Überfällig" lives in its own group: it is a comparison against the tenant's
  // today on top of the open claim, not a stored date field.
  const invoiceFields = {
    serviceDate: {
      anyOf: [
        { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { type: 'null' },
      ],
    },
    paymentTermDays: {
      anyOf: [{ type: 'integer', minimum: 0, maximum: 365 }, { type: 'null' }],
    },
    dueDate: {
      anyOf: [
        { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { type: 'null' },
      ],
    },
    // RG-07b: the printed account, additive in the same opt-in projection. Free
    // text, so the schema only bounds it - it never judges a bank.
    bankAccount: {
      anyOf: [
        { type: 'string', maxLength: bankAccountMaxLength },
        { type: 'null' },
      ],
    },
  };
  // RG-08: the lateness of a claim, additive in the same opt-in projection and
  // nowhere else - the metadata list and the single document keep their shape.
  const overdueFields = {
    overdue: {
      anyOf: [{ type: 'boolean' }, { type: 'null' }],
    },
  };
  const row = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'kind',
      'templateId',
      'eventId',
      'contactId',
      'number',
      'state',
      'issuedAt',
      'finalizedAt',
      'subject',
      'introText',
      'outroText',
      'validityDays',
      'snapshotHash',
      'pdfHash',
      'netMinor',
      'taxMinor',
      'grossMinor',
      'version',
      'lines',
      'serviceDate',
      'paymentTermDays',
      'dueDate',
      'bankAccount',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: [...documentKinds] },
      templateId: nullableUuid,
      eventId: nullableUuid,
      contactId: nullableUuid,
      number: nullableText,
      state: { type: 'string', enum: ['draft', 'final', 'withdrawn'] },
      issuedAt: { type: 'string', format: 'date-time' },
      finalizedAt: {
        anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
      },
      subject: nullableText,
      introText: nullableText,
      outroText: nullableText,
      validityDays: {
        anyOf: [
          { type: 'integer', minimum: 1, maximum: 365 },
          { type: 'null' },
        ],
      },
      snapshotHash: nullableText,
      pdfHash: nullableText,
      netMinor: { type: 'integer' },
      taxMinor: { type: 'integer' },
      grossMinor: { type: 'integer' },
      version: { type: 'integer' },
      // RG-07: the invoice dates of a single document. Every other kind answers
      // NULL, so the editor can load and rewrite them without a second route.
      serviceDate: {
        anyOf: [
          { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          { type: 'null' },
        ],
      },
      paymentTermDays: {
        anyOf: [
          { type: 'integer', minimum: 0, maximum: 365 },
          { type: 'null' },
        ],
      },
      dueDate: {
        anyOf: [
          { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          { type: 'null' },
        ],
      },
      // RG-07b: the account this document prints. Every other kind answers
      // NULL, so the editor can load and rewrite it without a second route.
      bankAccount: {
        anyOf: [
          { type: 'string', maxLength: bankAccountMaxLength },
          { type: 'null' },
        ],
      },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'position',
            'productId',
            'description',
            'quantity',
            'unit',
            'unitPriceMinor',
            'taxBasisPoints',
            'discountBasisPoints',
          ],
          properties: {
            id: { type: 'string', format: 'uuid' },
            position: { type: 'integer' },
            productId: nullableUuid,
            description: { type: 'string' },
            quantity: { type: 'integer' },
            unit: { type: 'string' },
            unitPriceMinor: { type: 'integer' },
            taxBasisPoints: { type: 'integer' },
            discountBasisPoints: { type: 'integer' },
          },
        },
      },
    },
  };
  // A new endpoint owns a new response shape: the unchanged document row plus
  // the offer axis, while every older route keeps exactly its old shape.
  const offerRow = {
    type: 'object',
    additionalProperties: false,
    required: [...row.required, ...Object.keys(offerFields)],
    properties: { ...row.properties, ...offerFields },
  };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof DocumentError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (error.reason === 'invalid_state')
        return reply.code(409).send({ error: 'invalid_state' });
      if (error.reason === 'invalid_transition')
        return reply.code(409).send({ error: 'invalid_transition' });
      if (error.reason === 'conflict')
        return reply.code(409).send({ error: 'conflict' });
      if (error.reason === 'acceptance_conflict')
        return reply.code(409).send({ error: 'acceptance_conflict' });
      // BKP019.b: the offer was not accepted, or the confirmation already exists.
      if (error.reason === 'offer_not_accepted')
        return reply.code(409).send({ error: 'offer_not_accepted' });
      // BKP019.c1: the order behind the confirmation was withdrawn, so there is
      // nothing to invoice - the code names the reason, not just the refusal.
      if (error.reason === 'order_withdrawn')
        return reply.code(409).send({ error: 'order_withdrawn' });
      // BKP019.c2: the credit note would exceed what is still open.
      if (error.reason === 'credit_exceeds_invoice')
        return reply.code(409).send({ error: 'credit_exceeds_invoice' });
      // BKP019.c3.2b: the settlement would exceed the order it settles.
      if (error.reason === 'deposits_exceed_order')
        return reply.code(409).send({ error: 'deposits_exceed_order' });
      if (error.reason === 'duplicate')
        return reply.code(409).send({ error: 'duplicate' });
      if (error.reason === 'artifact_failed')
        return reply.code(500).send({ error: 'artifact_failed' });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  app.post<{ Body: DocumentDraftInput }>(
    '/api/v1/documents',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['templateId'],
          properties: {
            templateId: { type: 'string', format: 'uuid' },
            eventId: nullableUuid,
            contactId: nullableUuid,
            lines: { type: 'array', maxItems: 200, items: line },
          },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createDraft(request.authSession!.userId, request.body),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Body: BlankOfferInput }>(
    '/api/v1/documents/blank-offer',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['eventId', 'contactId'],
          properties: {
            eventId: { type: 'string', format: 'uuid' },
            contactId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createBlankOffer(
              request.authSession!.userId,
              request.body,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { id: string }; Body: DocumentDraftContent }>(
    '/api/v1/documents/:id/draft',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'version',
            'subject',
            'introText',
            'outroText',
            'validityDays',
          ],
          properties: {
            version: { type: 'integer', minimum: 1 },
            subject: { type: 'string', maxLength: 200 },
            introText: { type: 'string', maxLength: 4000 },
            outroText: { type: 'string', maxLength: 4000 },
            validityDays: { type: 'integer', minimum: 1, maximum: 365 },
            // RG-07: both invoice fields are optional. Omitting one keeps the
            // stored value, `null` clears it; the domain judges the calendar day
            // and the range, so every refusal answers with one stable error
            // instead of two different 400 shapes. `null` is named first on
            // purpose: AJV coerces, and a `null` tested against the string branch
            // would arrive as an empty string - "clear it" must not become "a
            // malformed day".
            serviceDate: {
              anyOf: [{ type: 'null' }, { type: 'string', maxLength: 40 }],
            },
            paymentTermDays: {
              anyOf: [{ type: 'null' }, { type: 'integer' }],
            },
            // RG-07b: the printed account is optional free text. `null` (or a
            // blank text, which the domain clears) deletes it; the bound is the
            // only rule JSON Schema owns here - a bank is judged nowhere.
            bankAccount: {
              anyOf: [
                { type: 'null' },
                { type: 'string', maxLength: bankAccountMaxLength },
              ],
            },
            lines: { type: 'array', minItems: 1, maxItems: 1000, items: line },
          },
        },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await repo.updateDraftContent(
          request.authSession!.userId,
          request.params.id,
          request.body,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/documents/:id/preview',
    { schema: { params } },
    async (request, reply) => {
      try {
        const pdf = await repo.preview(request.params.id);
        return reply
          .type('application/pdf')
          .header('Cache-Control', 'no-store')
          .header('Content-Disposition', 'inline; filename="VORSCHAU.pdf"')
          .send(pdf.bytes);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body?: { version?: number } }>(
    '/api/v1/documents/:id/finalize',
    {
      schema: {
        params,
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body;
        if (
          body !== undefined &&
          (!body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).some((key) => key !== 'version') ||
            ('version' in body &&
              (!Number.isInteger(body.version) ||
                (body.version as number) < 1)))
        )
          return reply.code(400).send({ error: 'invalid_content' });
        return await repo.finalize(
          request.authSession!.userId,
          request.params.id,
          (body as { version?: number } | undefined)?.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // BKP019.0: the business status of a finished offer. Auth and CSRF come from
  // the global hook, exactly like every other document write; `version` is the
  // same optimistic guard as PUT /draft.
  app.post<{
    Params: { id: string };
    Body: OfferStatusChange;
  }>(
    '/api/v1/documents/:id/offer-status',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'version'],
          properties: {
            status: { type: 'string', enum: [...offerStatuses] },
            version: { type: 'integer', minimum: 1 },
            // BKP019.a: the acceptance. Length and enum are judged by the
            // domain, so every rejected detail answers with one stable error
            // instead of two different 400 shapes.
            channel: { type: 'string', maxLength: 40 },
            acceptedAt: { type: 'string', maxLength: 40 },
            note: { type: 'string' },
            attachmentFileId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: offerRow },
      },
    },
    async (request, reply) => {
      try {
        return await repo.changeOfferStatus(
          request.authSession!.userId,
          request.params.id,
          request.body,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  const listRow = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'kind',
      'templateId',
      'eventId',
      'contactId',
      'number',
      'state',
      'issuedAt',
      'finalizedAt',
      'netMinor',
      'taxMinor',
      'grossMinor',
      'version',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: [...documentKinds] },
      templateId: nullableUuid,
      eventId: nullableUuid,
      contactId: nullableUuid,
      number: nullableText,
      state: { type: 'string', enum: ['draft', 'final', 'withdrawn'] },
      issuedAt: { type: 'string', format: 'date-time' },
      finalizedAt: {
        anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
      },
      netMinor: { type: 'integer' },
      taxMinor: { type: 'integer' },
      grossMinor: { type: 'integer' },
      version: { type: 'integer' },
    },
  };
  // The opt-in offer projection keeps every old key and adds only the axis.
  // BKP019.c2: the correction axis joins the projection and nowhere else.
  const offerListRow = {
    type: 'object',
    additionalProperties: false,
    required: [
      ...listRow.required,
      ...Object.keys(offerFields),
      ...Object.keys(correctionFields),
      ...Object.keys(paymentFields),
      ...Object.keys(settlementFields),
      ...Object.keys(invoiceFields),
      ...Object.keys(overdueFields),
    ],
    properties: {
      ...listRow.properties,
      ...offerFields,
      ...correctionFields,
      ...paymentFields,
      ...settlementFields,
      ...invoiceFields,
      ...overdueFields,
    },
  };
  app.get<{ Querystring: DocumentFilters }>(
    '/api/v1/documents',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventId: { type: 'string', format: 'uuid' },
            kind: { type: 'string', enum: [...documentKinds] },
            state: { type: 'string', enum: ['draft', 'final', 'withdrawn'] },
            // H035: all new parameters are optional, so an old request keeps the
            // complete, unpaged array with exactly the old fields.
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0, maximum: 1_000_000 },
            include: { type: 'string', enum: ['metadata', 'offer'] },
          },
        },
        response: {
          200: {
            type: 'array',
            items: {
              anyOf: [
                listRow,
                {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    ...listRow.required,
                    'eventName',
                    'issuedDate',
                    'pdfAvailable',
                  ],
                  properties: {
                    ...listRow.properties,
                    eventName: nullableText,
                    issuedDate: {
                      type: 'string',
                      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
                    },
                    pdfAvailable: { type: 'boolean' },
                  },
                },
                offerListRow,
              ],
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await repo.list(request.query);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // BKP019.b: the confirmation is copied from an accepted offer. Same auth,
  // CSRF, tenant lock, version guard and audit path as every other document
  // write; only the source is a document instead of a template.
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/api/v1/documents/:id/order-confirmation',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1 } },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createOrderConfirmation(
              request.authSession!.userId,
              request.params.id,
              request.body.version,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // BKP019.c1: the invoice is copied from a finalized confirmation. Same auth,
  // CSRF, tenant lock, version guard and audit path as every other document
  // write; only the source is a confirmation instead of a template.
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/api/v1/documents/:id/invoice',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1 } },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createInvoice(
              request.authSession!.userId,
              request.params.id,
              request.body.version,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // BKP019.c3.1: an advance payment is derived from a finalized confirmation.
  // Same auth, CSRF, tenant lock, version guard and audit path as every other
  // document write; the body carries only the version, so no amount is invented
  // here - the draft is reduced by the operator.
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/api/v1/documents/:id/deposit-invoice',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1 } },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createDepositInvoice(
              request.authSession!.userId,
              request.params.id,
              request.body.version,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // BKP019.c3.2: the final invoice is derived from a finalized confirmation too.
  // Same auth, CSRF, tenant lock, version guard and audit path as every other
  // document write; the body carries only the version, because the deduction is
  // calculated from the billed advances and never typed.
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/api/v1/documents/:id/final-invoice',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1 } },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createFinalInvoice(
              request.authSession!.userId,
              request.params.id,
              request.body.version,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // BKP019.c2: the correction is derived from a finalized invoice or order
  // confirmation. Same auth, CSRF, tenant lock, version guard and audit path as
  // every other document write; the body names the one extra decision.
  app.post<{
    Params: { id: string };
    Body: {
      version: number;
      direction: CorrectionDirection;
      lines?: DocumentLineDraft[];
    };
  }>(
    '/api/v1/documents/:id/correction',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version', 'direction'],
          properties: {
            version: { type: 'integer', minimum: 1 },
            direction: { type: 'string', enum: [...correctionDirections] },
            // Optional: omitted positions are copied 1:1 from the source.
            lines: { type: 'array', minItems: 1, maxItems: 1000, items: line },
          },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.createCorrection(
              request.authSession!.userId,
              request.params.id,
              request.body.version,
              request.body.direction,
              request.body.lines,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/documents/:id',
    { schema: { params, response: { 200: row } } },
    async (request, reply) =>
      (await repo.get(request.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );
  // Binary response: no JSON schema, and the file name comes from our own
  // number, still reduced to characters that cannot break the header.
  app.get<{ Params: { id: string } }>(
    '/api/v1/documents/:id/pdf',
    { schema: { params } },
    async (request, reply) => {
      try {
        const { number, bytes } = await repo.pdf(request.params.id);
        return reply
          .type('application/pdf')
          .header(
            'Content-Disposition',
            `inline; filename="${number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`,
          )
          .send(bytes);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
