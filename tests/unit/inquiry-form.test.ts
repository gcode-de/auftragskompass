import { expect, test } from 'vitest';
import {
  inquiryFormV1,
  isInquirySubmission,
} from '../../packages/core/src/inquiry-form.js';

const submission = () => ({
  formId: 'fotobox-bw-main',
  formVersion: 1,
  fields: {
    firstName: 'Fictional',
    lastName: 'Example',
    email: 'fictional@example.invalid',
    eventDate: '2030-10-27',
  },
});

test('the first form preserves all eight observed fields and required labels', () => {
  expect(
    inquiryFormV1.fields.map(({ name, required }) => [name, required]),
  ).toEqual([
    ['firstName', true],
    ['lastName', true],
    ['email', true],
    ['eventDate', true],
    ['phone', false],
    ['location', false],
    ['package', false],
    ['comment', false],
  ]);
  const packages = inquiryFormV1.fields.find((f) => f.name === 'package')!;
  expect('options' in packages && packages.options.map((o) => o.label)).toEqual(
    [
      'easy digital (Bilder zum Download)',
      'easy print (zusätzlich 200 Ausdrucke)',
      'easy print+ (400 Ausdrucke, Drucklayout)',
    ],
  );
  expect(inquiryFormV1.privacyUrl).toBe(
    'https://fotobox-bw.de/impressum-datenschutz/',
  );
});

test('valid input stays unchanged, including optional text and Unicode', () => {
  for (const fields of [
    {},
    {
      phone: '+49 (0) 123 456',
      location: 'Fictional venue',
      package: 'easy-print-plus',
      comment: 'Fictional first line\nZweite Zeile – Grüße',
    },
    { phone: '', location: '', package: '', comment: '' },
  ]) {
    const input = {
      ...submission(),
      fields: { ...submission().fields, ...fields },
    };
    const before = structuredClone(input);
    expect(isInquirySubmission(input)).toBe(true);
    expect(input).toEqual(before);
  }
  expect(
    isInquirySubmission({
      ...submission(),
      fields: { ...submission().fields, eventDate: '2032-02-29' },
    }),
  ).toBe(true);
});

test.each([
  null,
  [],
  {},
  { ...submission(), formId: 'unknown' },
  { ...submission(), formVersion: 2 },
  { ...submission(), formVersion: '1' },
  { ...submission(), tenantId: 'fictional-tenant' },
  { ...submission(), fields: { ...submission().fields, status: 'booked' } },
  { ...submission(), fields: { ...submission().fields, firstName: '' } },
  { ...submission(), fields: { ...submission().fields, lastName: '  ' } },
  {
    ...submission(),
    fields: { ...submission().fields, email: 'fictional-invalid' },
  },
  {
    ...submission(),
    fields: { ...submission().fields, eventDate: '2030-02-29' },
  },
  {
    ...submission(),
    fields: { ...submission().fields, eventDate: '27.10.2030' },
  },
  {
    ...submission(),
    fields: { ...submission().fields, eventDate: '0000-01-01' },
  },
  {
    ...submission(),
    fields: {
      ...submission().fields,
      package: 'comfort-Paket (mit Fotodruck)',
    },
  },
  {
    ...submission(),
    fields: { ...submission().fields, phone: 'fictional-not-a-phone' },
  },
  {
    ...submission(),
    fields: { ...submission().fields, comment: 'x'.repeat(5001) },
  },
  {
    ...submission(),
    fields: { ...submission().fields, firstName: 'x'.repeat(101) },
  },
  { ...submission(), fields: { ...submission().fields, location: null } },
])(
  'rejects malformed, incompatible or privileged input without mutating it (%#)',
  (input) => {
    const before = structuredClone(input);
    expect(isInquirySubmission(input)).toBe(false);
    expect(input).toEqual(before);
  },
);

test.each(['firstName', 'lastName', 'email', 'eventDate'])(
  'requires %s independently',
  (name) => {
    const input = submission();
    Reflect.deleteProperty(input.fields, name);
    expect(isInquirySubmission(input)).toBe(false);
  },
);
