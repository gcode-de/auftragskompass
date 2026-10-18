import AjvCompiler from '@fastify/ajv-compiler';
import { Temporal } from '@js-temporal/polyfill';
import { contactFields, type ContactInput } from './contacts.js';
import { locationFields, type LocationInput } from './locations.js';
import {
  masterFields,
  eventStatuses,
  type MasterInput,
} from './master-data.js';
import {
  eventFields,
  sanitizeNotes,
  validateSchedule,
  type EventInput,
} from './events.js';

export const importSections = [
  'contacts',
  'locations',
  'eventTypes',
  'packages',
  'events',
] as const;
type Section = (typeof importSections)[number];
type Entry<T> = { externalId: string; data: T };
export type ImportManifest = {
  formatVersion: 1;
  source: 'bookitup';
  contacts: Entry<ContactInput>[];
  locations: Entry<LocationInput>[];
  eventTypes: Entry<MasterInput>[];
  packages: Entry<MasterInput>[];
  events: Entry<
    Omit<EventInput, 'status'> & {
      status: (typeof eventStatuses)[number]['label'];
    }
  >[];
};
type Issue = {
  section: Section | 'manifest';
  row: number;
  code: string;
  field?: string;
};
export type ImportPreview = {
  valid: boolean;
  checkedAt: string;
  timeZone: string;
  pendingPromises: number;
  counts: Record<
    Section,
    { total: number; accepted: number; excluded: number; invalid: number }
  >;
  errors: Issue[];
  warnings: Issue[];
  events: {
    row: number;
    status: EventInput['status'];
    sourceStatus: string;
    requiresResourceReview: boolean;
  }[];
};
type ValidationError = {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
};
type ImportValidator = {
  (input: unknown): unknown;
  errors?: ValidationError[] | null;
};
// Reuse Fastify's installed validator with mutation/coercion disabled for imports.
export const compileImportSchema: (definition: {
  schema: object;
}) => ImportValidator = AjvCompiler()(
  {},
  {
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    },
  },
);
const externalId = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
  pattern: '^\\S(?:.*\\S)?$',
};
const reference = { anyOf: [externalId, { type: 'null' }] };
const fields = {
  contacts: contactFields,
  locations: locationFields,
  eventTypes: masterFields,
  packages: masterFields,
  events: {
    ...eventFields,
    status: { type: 'string', enum: eventStatuses.map((s) => s.label) },
    eventTypeId: reference,
    packageId: reference,
    locationId: reference,
    primaryContactId: reference,
    additionalContactIds: {
      ...eventFields.additionalContactIds,
      items: externalId,
    },
  },
};
export const importManifestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['formatVersion', 'source', ...importSections],
  properties: {
    formatVersion: { const: 1 },
    source: { const: 'bookitup' },
    ...Object.fromEntries(
      importSections.map((section) => [
        section,
        { type: 'array', maxItems: 10000 },
      ]),
    ),
  },
};
export const importFieldNames = [
  ...new Set([
    'externalId',
    ...Object.values(fields).flatMap((section) => Object.keys(section)),
  ]),
];
function invalidField(section: Section, error?: ValidationError) {
  const path = error?.instancePath ?? '';
  if (path === '/externalId') return 'externalId';
  const field = path.startsWith('/data/')
    ? path.split('/')[2]
    : path === '/data' && error?.keyword === 'required'
      ? error.params.missingProperty
      : undefined;
  return typeof field === 'string' && Object.hasOwn(fields[section], field)
    ? field
    : undefined;
}
const validManifest = compileImportSchema({ schema: importManifestSchema });
const validators = Object.fromEntries(
  importSections.map((section) => [
    section,
    compileImportSchema({
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['externalId', 'data'],
        properties: {
          externalId,
          data: {
            type: 'object',
            additionalProperties: false,
            required: Object.keys(fields[section]),
            properties: fields[section],
          },
        },
      },
    }),
  ]),
);

export function previewImport(
  input: unknown,
  timeZone: string,
  now = new Date(),
): ImportPreview {
  const result: ImportPreview = {
    valid: false,
    checkedAt: now.toISOString(),
    timeZone,
    pendingPromises: 0,
    counts: Object.fromEntries(
      importSections.map((section) => [
        section,
        { total: 0, accepted: 0, excluded: 0, invalid: 0 },
      ]),
    ) as ImportPreview['counts'],
    errors: [],
    warnings: [],
    events: [],
  };
  if (!validManifest(input)) {
    result.errors.push({ section: 'manifest', row: 0, code: 'invalid_format' });
    return result;
  }
  const manifest = input as ImportManifest;
  const validRows: Record<Section, Map<string, string | undefined>> = {
    contacts: new Map(),
    locations: new Map(),
    eventTypes: new Map(),
    packages: new Map(),
    events: new Map(),
  };
  const acceptedEvents = new Set<number>();
  for (const section of importSections) {
    const entries = manifest[section],
      counts = result.counts[section];
    counts.total = entries.length;
    const ids = new Map<string, number>();
    const validation = entries.map((entry) => {
      const check = validators[section]!;
      const valid = Boolean(check(entry));
      return {
        valid,
        field: valid ? undefined : invalidField(section, check.errors?.[0]),
      };
    });
    entries.forEach((entry, i) => {
      if (validation[i]!.valid)
        ids.set(entry.externalId, (ids.get(entry.externalId) ?? 0) + 1);
    });
    entries.forEach((entry, i) => {
      const code = !validation[i]!.valid
        ? 'invalid_fields'
        : ids.get(entry.externalId)! > 1
          ? 'duplicate_external_id'
          : null;
      if (code) {
        result.errors.push({
          section,
          row: i + 1,
          code,
          ...(validation[i]!.field ? { field: validation[i]!.field } : {}),
        });
        counts.invalid++;
      } else {
        validRows[section].set(
          entry.externalId,
          'state' in entry.data ? entry.data.state : undefined,
        );
        if (section === 'events') acceptedEvents.add(i);
      }
    });
    counts.accepted = validRows[section].size;
  }
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
  manifest.events.forEach((entry, index) => {
    if (!acceptedEvents.has(index)) return;
    const event = entry.data,
      row = index + 1,
      before = result.errors.length;
    const fail = (code: string) =>
      result.errors.push({ section: 'events', row, code });
    try {
      validateSchedule(event.eventDate, event.startsAt, event.endsAt, timeZone);
    } catch {
      fail('invalid_schedule');
    }
    if (!event.eventDate) fail('missing_date');
    for (const [id, section] of [
      [event.eventTypeId, 'eventTypes'],
      [event.packageId, 'packages'],
      [event.locationId, 'locations'],
      [event.primaryContactId, 'contacts'],
      ...event.additionalContactIds.map((id) => [id, 'contacts'] as const),
    ] as const) {
      if (!id) continue;
      const target = validRows[section];
      if (!target.has(id)) fail('missing_reference');
      else if (target.get(id) !== 'active') fail('inactive_reference');
    }
    if (
      event.primaryContactId &&
      event.additionalContactIds.includes(event.primaryContactId)
    )
      fail('duplicate_contact');
    try {
      if (sanitizeNotes(event.notesHtml) !== event.notesHtml)
        result.warnings.push({
          section: 'events',
          row,
          code: 'notes_sanitized',
        });
    } catch {
      fail('invalid_notes');
    }
    if (result.errors.length > before) {
      result.counts.events.accepted--;
      result.counts.events.invalid++;
      return;
    }
    const future = event.endsAt
      ? Date.parse(event.endsAt) > now.getTime()
      : event.eventDate! >= today;
    if (!future) {
      result.counts.events.accepted--;
      result.counts.events.excluded++;
      result.warnings.push({
        section: 'events',
        row,
        code: 'past_event_excluded',
      });
      return;
    }
    const status = eventStatuses.find((s) => s.label === event.status)!.code;
    if (status === 'booked') result.pendingPromises++;
    result.events.push({
      row,
      status,
      sourceStatus: event.status,
      requiresResourceReview: status === 'booked',
    });
  });
  result.valid = result.errors.length === 0;
  return result;
}
