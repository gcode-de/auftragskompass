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
export const acceptanceNoteMaxLength = 2000;
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
    return { ...document, lines };
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
    return { ...snapshot, validUntil: validUntil?.toString() ?? null };
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
            ...row
          }) => ({
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
            // Derived, never stored: the deadline and the tenant day decide.
            offerExpired: offerExpired(
              validUntil,
              offerStatus as OfferStatus | null,
              at,
              zone,
            ),
          }),
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
        // correcting them is the same right an offer draft has. Every other kind
        // stays refused - this is not a global opening.
        if (
          document.state !== 'draft' ||
          (document.kind !== 'offer' && document.kind !== 'order_confirmation')
        )
          throw new DocumentError('invalid_state');
        if (document.version !== content.version)
          throw new DocumentError('conflict');
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
          // BKP019.0: the deadline the PDF already prints is frozen at this
          // instant and never recalculated. Every later status change keeps the
          // same bytes, and the same number still means the same day.
          if (snapshot.validUntil)
            await tx.execute(
              sql`UPDATE documents SET valid_until = ${snapshot.validUntil}::date
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
  const offerListRow = {
    type: 'object',
    additionalProperties: false,
    required: [...listRow.required, ...Object.keys(offerFields)],
    properties: { ...listRow.properties, ...offerFields },
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
