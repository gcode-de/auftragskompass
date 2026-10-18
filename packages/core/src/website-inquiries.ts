import AjvCompiler from '@fastify/ajv-compiler';
import { toUSVString } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { contactRepository } from './contacts.js';
import { eventRepository } from './events.js';
import { eventActivities, websiteInquiries } from './schema.js';
import {
  inquiryFormV1,
  inquirySubmissionSchema,
  isInquirySubmission,
  type InquirySubmission,
} from './inquiry-form.js';

export type WebsiteInquiry = {
  id: string;
  receivedAt: string;
  expiresAt: string;
  submission: InquirySubmission;
  privacyNotice: string;
  privacyUrl: string;
};
export class WebsiteInquiryError extends Error {
  constructor(
    readonly reason:
      | 'invalid'
      | 'not_found'
      | 'expired'
      | 'conflict'
      | 'contact_review'
      | 'forbidden'
      | 'failed',
  ) {
    super('Website inquiry unavailable');
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validate = AjvCompiler()(
  {},
  {
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    },
  },
)({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'receivedAt',
      'expiresAt',
      'submission',
      'privacyNotice',
      'privacyUrl',
    ],
    properties: {
      id: { type: 'string', pattern: uuid.source },
      receivedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' },
      submission: inquirySubmissionSchema,
      privacyNotice: { type: 'string', minLength: 1, maxLength: 2000 },
      privacyUrl: { type: 'string', format: 'uri', maxLength: 2048 },
    },
  },
});
export function isWebsiteInquiry(input: unknown): input is WebsiteInquiry {
  try {
    if (!validate(input)) return false;
    const value = input as WebsiteInquiry;
    return (
      isInquirySubmission(value.submission) &&
      [value.privacyNotice, value.privacyUrl].every(
        (text) => !text.includes('\0') && toUSVString(text) === text,
      ) &&
      new URL(value.privacyUrl).protocol === 'https:' &&
      [value.receivedAt, value.expiresAt].every(
        (text) => new Date(text).toISOString() === text,
      ) &&
      Date.parse(value.expiresAt) > Date.parse(value.receivedAt) &&
      Date.parse(value.expiresAt) - Date.parse(value.receivedAt) <=
        168 * 3600000 &&
      Buffer.byteLength(JSON.stringify(input), 'utf8') <= 65536
    );
  } catch {
    return false;
  }
}
export async function receiveWebsiteInquiry(
  connection: Connection,
  tenantId: string,
  actorId: string,
  input: unknown,
  at: Date,
  options: { newContactCountry?: string },
): Promise<{
  status: 'created' | 'duplicate';
  eventId: string;
  contactId: string;
}> {
  const country = options.newContactCountry;
  if (
    !uuid.test(tenantId) ||
    !uuid.test(actorId) ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime()) ||
    (country !== undefined && !/^[A-Z]{2}$/.test(country)) ||
    !isWebsiteInquiry(input)
  )
    throw new WebsiteInquiryError('invalid');
  // Snapshot before awaiting database work; callers cannot mutate the validated delivery.
  const value = JSON.parse(JSON.stringify(input)) as WebsiteInquiry,
    clock = at.getTime();
  if (Date.parse(value.receivedAt) > clock + 30000)
    throw new WebsiteInquiryError('invalid');
  try {
    return await database(connection).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      const hash = (
        await tx.execute<{ hash: string }>(
          sql`SELECT encode(sha256(convert_to(${JSON.stringify(value)}::jsonb::text,'UTF8')),'hex') AS hash`,
        )
      ).rows[0]!.hash;
      const [previous] = await tx
        .select()
        .from(websiteInquiries)
        .where(
          and(
            eq(websiteInquiries.tenantId, tenantId),
            eq(websiteInquiries.id, value.id),
          ),
        );
      if (previous) {
        if (previous.payloadHash !== hash)
          throw new WebsiteInquiryError('conflict');
        return {
          status: 'duplicate' as const,
          eventId: previous.eventId,
          contactId: previous.contactId,
        };
      }
      if (Date.parse(value.expiresAt) <= clock)
        throw new WebsiteInquiryError('expired');
      const fields = value.submission.fields,
        name = fields.firstName.trim() + ' ' + fields.lastName.trim(),
        email = fields.email.trim().toLowerCase();
      const repo = contactRepository(tx, tenantId),
        candidates = await repo.duplicates({
          email,
          phone: fields.phone ?? '',
          mobile: '',
          country: country ?? '',
        });
      let contactId: string;
      if (candidates.length) {
        const match = candidates[0]!;
        if (
          candidates.length !== 1 ||
          match.kind !== 'private' ||
          match.state !== 'active' ||
          match.email !== email ||
          match.name.trim().toLowerCase() !== name.toLowerCase()
        )
          throw new WebsiteInquiryError('contact_review');
        contactId = match.id;
      } else {
        if (!country) throw new WebsiteInquiryError('contact_review');
        contactId = (await repo.save(actorId, {
          kind: 'private',
          name,
          contactPerson: '',
          street: '',
          postalCode: '',
          city: '',
          country,
          email,
          phone: fields.phone ?? '',
          mobile: '',
          state: 'active',
        }))!.id;
      }
      const source =
        value.submission.formId + ' (v' + value.submission.formVersion + ')';
      const packageLabel =
        inquiryFormV1.fields
          .find((field) => field.type === 'select')!
          .options.find((option) => option.value === fields.package)?.label ??
        'Nicht angegeben';
      const summary =
        'Veranstaltungsort: ' +
        (fields.location ?? 'Nicht angegeben') +
        '\nPaketwunsch: ' +
        packageLabel;
      const comment = '\nKommentar: ' + (fields.comment ?? 'Nicht angegeben');
      const description =
        Array.from(summary + comment).length <= 4000
          ? summary + comment
          : summary + '\nKommentar in der vollständigen Anfrage erhalten.';
      const event = await eventRepository(tx, tenantId).save(actorId, {
        name,
        status: 'inquiry',
        eventTypeId: null,
        packageId: null,
        locationId: null,
        primaryContactId: contactId,
        additionalContactIds: [],
        source: 'Website: ' + source,
        eventDate: fields.eventDate,
        startsAt: null,
        endsAt: null,
        description,
        notesHtml: '',
      });
      await tx.insert(websiteInquiries).values({
        tenantId,
        id: value.id,
        contactId,
        eventId: event.id,
        payload: value,
        payloadHash: hash,
        receivedAt: new Date(value.receivedAt),
        expiresAt: new Date(value.expiresAt),
      });
      await tx.insert(eventActivities).values({
        tenantId,
        eventId: event.id,
        actorId,
        eventVersion: 1,
        kind: 'website_received',
        source,
        nextStatus: 'inquiry',
      });
      return { status: 'created' as const, eventId: event.id, contactId };
    });
  } catch (error) {
    if (error instanceof WebsiteInquiryError) throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}
