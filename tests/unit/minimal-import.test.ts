import { expect, test } from 'vitest';
import { previewImport } from '../../packages/core/src/minimal-import.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
const now = new Date('2030-10-26T12:00:00Z');
const preview = (input: unknown) => previewImport(input, 'Europe/Berlin', now);
test('preview keeps source promises explicit, maps all five statuses, and never mutates input', () => {
  const input = fictionalImport();
  input.events = [
    'Anfrage',
    'Option',
    'Gebucht',
    'Nicht verfügbar',
    'Annulliert',
  ].map((status, i) => ({
    externalId: 'fictional-event-' + i,
    data: { ...input.events[0]!.data, status },
  }));
  const original = structuredClone(input);
  const result = preview(input);
  expect(result.valid).toBe(true);
  expect(result.counts.events).toEqual({
    total: 5,
    accepted: 5,
    excluded: 0,
    invalid: 0,
  });
  expect(result.events.map((e) => e.status)).toEqual([
    'inquiry',
    'option',
    'booked',
    'unavailable',
    'cancelled',
  ]);
  expect(result.pendingPromises).toBe(1);
  expect(result.events[2]).toMatchObject({
    row: 3,
    sourceStatus: 'Gebucht',
    requiresResourceReview: true,
  });
  expect(input).toEqual(original);
  expect(JSON.stringify(result)).not.toContain('fictional@example.invalid');
});

test.each([
  null,
  [],
  {},
  { ...fictionalImport(), tenantId: 'fictional' },
  { ...fictionalImport(), source: 'other' },
  { ...fictionalImport(), formatVersion: '1' },
  { ...fictionalImport(), formatVersion: 2 },
  { ...fictionalImport(), contacts: {} },
  { ...fictionalImport(), contacts: Array(10001).fill({}) },
])('rejects invalid or excessive manifests without echoing input', (input) => {
  expect(preview(input).errors).toEqual([
    { section: 'manifest', row: 0, code: 'invalid_format' },
  ]);
});

test('reports every invalid row without coercing types or removing unknown fields', () => {
  const input = fictionalImport();
  const bad: unknown = {
    ...input,
    contacts: [
      null,
      { ...input.contacts[0], tenantId: 'private-value' },
      { ...input.contacts[0], data: { ...input.contacts[0]!.data, name: 12 } },
    ],
    events: [
      null,
      {
        ...input.events[0],
        data: { ...input.events[0]!.data, status: 'unknown private-value' },
      },
    ],
  };
  const result = preview(bad);
  expect(result.counts.contacts.invalid).toBe(3);
  expect(result.counts.events.invalid).toBe(2);
  expect(result.errors).toHaveLength(5);
  expect(JSON.stringify(result)).not.toContain('private-value');
});

test('rejects duplicates, missing and inactive references and repeated primary contacts', () => {
  const input = fictionalImport();
  input.contacts.push(structuredClone(input.contacts[0]!));
  input.locations[0]!.data.state = 'archived';
  input.eventTypes[0]!.data.state = 'inactive';
  input.events[0]!.data.packageId = 'fictional-missing';
  input.events[0]!.data.additionalContactIds = ['fictional-contact'];
  const result = preview(input);
  expect(
    result.errors.filter((e) => e.code === 'duplicate_external_id'),
  ).toHaveLength(2);
  expect(result.errors.map((e) => e.code)).toEqual(
    expect.arrayContaining([
      'inactive_reference',
      'missing_reference',
      'duplicate_contact',
    ]),
  );
  expect(result.counts.events).toEqual({
    total: 1,
    accepted: 0,
    excluded: 0,
    invalid: 1,
  });
  expect(result.valid).toBe(false);
  expect(result.pendingPromises).toBe(0);
});

test('future filtering uses local dates, actual end instants and strict schedule rules', () => {
  const input = fictionalImport();
  const base = input.events[0]!.data;
  input.events = [
    { ...base, eventDate: '2030-10-25' }, // past date only
    { ...base, eventDate: '2030-10-26' }, // today without guessed time
    {
      ...base,
      eventDate: '2030-10-25',
      startsAt: '2030-10-25T18:00:00Z',
      endsAt: '2030-10-27T01:00:00Z',
    }, // still running
    {
      ...base,
      eventDate: '2030-10-26',
      startsAt: '2030-10-26T08:00:00Z',
      endsAt: now.toISOString(),
    }, // ended exactly now
    { ...base, eventDate: null },
    { ...base, startsAt: '2030-10-27T10:00:00Z' },
    { ...base, eventDate: '2030-02-30' },
    { ...base, eventDate: '0000-01-01' },
  ].map((data, i) => ({ externalId: 'fictional-event-' + i, data }));
  const result = preview(input);
  expect(result.counts.events).toEqual({
    total: 8,
    accepted: 2,
    excluded: 2,
    invalid: 4,
  });
  expect(result.events.map((e) => e.row)).toEqual([2, 3]);
  expect(result.errors.map((e) => e.code)).toEqual(
    expect.arrayContaining(['missing_date', 'invalid_schedule']),
  );
  const midnight = new Date('2030-10-26T23:30:00Z');
  input.events = [
    {
      externalId: 'fictional-midnight',
      data: { ...base, eventDate: '2030-10-26' },
    },
  ];
  expect(
    previewImport(input, 'Europe/Berlin', midnight).counts.events.excluded,
  ).toBe(1);
  expect(previewImport(input, 'UTC', midnight).counts.events.accepted).toBe(1);
});

test('notes are checked by the same sanitizer as event forms', () => {
  const input = fictionalImport();
  input.events[0]!.data.notesHtml =
    '<strong>Fictional</strong><script>private-value</script>';
  expect(preview(input).warnings).toEqual([
    { section: 'events', row: 1, code: 'notes_sanitized' },
  ]);
  input.events[0]!.data.notesHtml = '&'.repeat(20000);
  expect(preview(input).errors).toContainEqual({
    section: 'events',
    row: 1,
    code: 'invalid_notes',
  });
});

test.each([
  { name: ' ' },
  { country: 'de' },
  { email: 'bad' },
  { phone: 'letters' },
  { mobile: 'letters' },
  { name: 'x'.repeat(201) },
])('shares contact form field limits: %j', (change) => {
  const input = fictionalImport();
  Object.assign(input.contacts[0]!.data, change);
  expect(preview(input).errors).toContainEqual({
    section: 'contacts',
    row: 1,
    code: 'invalid_fields',
  });
});
