import AjvCompiler from '@fastify/ajv-compiler';
import { Temporal } from '@js-temporal/polyfill';
import { contactFields } from './contacts.js';

// Observed on the public website on 2026-10-18; this is not a booking form.
export const inquiryFormV1 = {
  id: 'fotobox-bw-main',
  version: 1,
  title: 'Jetzt unverbindlich anfragen für unkomplizierten Foto-Spaß!',
  submitLabel: 'Anfrage senden',
  privacyNotice:
    'Wir speichern und verarbeiten Ihre Angaben und Daten entsprechend unserer Datenschutzerklärung um Ihre Anfrage zu bearbeiten.',
  privacyUrl: 'https://fotobox-bw.de/impressum-datenschutz/',
  fields: [
    { name: 'firstName', label: 'Vorname', type: 'text', required: true },
    { name: 'lastName', label: 'Nachname', type: 'text', required: true },
    { name: 'email', label: 'E-Mail', type: 'email', required: true },
    {
      name: 'eventDate',
      label: 'Veranstaltungsdatum',
      type: 'date',
      required: true,
    },
    { name: 'phone', label: 'Telefonnummer', type: 'tel', required: false },
    {
      name: 'location',
      label: 'Veranstaltungsort',
      type: 'text',
      required: false,
    },
    {
      name: 'package',
      label: 'Gewünschtes Fotobox-Paket',
      type: 'select',
      required: false,
      options: [
        { value: 'easy-digital', label: 'easy digital (Bilder zum Download)' },
        { value: 'easy-print', label: 'easy print (zusätzlich 200 Ausdrucke)' },
        {
          value: 'easy-print-plus',
          label: 'easy print+ (400 Ausdrucke, Drucklayout)',
        },
      ],
    },
    { name: 'comment', label: 'Kommentar', type: 'textarea', required: false },
  ],
} as const;

export type InquirySubmission = {
  formId: typeof inquiryFormV1.id;
  formVersion: typeof inquiryFormV1.version;
  fields: {
    firstName: string;
    lastName: string;
    email: string;
    eventDate: string;
    phone?: string;
    location?: string;
    package?: '' | 'easy-digital' | 'easy-print' | 'easy-print-plus';
    comment?: string;
  };
};

const requiredName = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  pattern: '\\S',
};
export const inquirySubmissionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['formId', 'formVersion', 'fields'],
  properties: {
    formId: { const: inquiryFormV1.id, type: 'string' },
    formVersion: { const: inquiryFormV1.version, type: 'integer' },
    fields: {
      type: 'object',
      additionalProperties: false,
      required: inquiryFormV1.fields
        .filter((f) => f.required)
        .map((f) => f.name),
      properties: {
        firstName: requiredName,
        lastName: requiredName,
        email: {
          type: 'string',
          minLength: 1,
          maxLength: 254,
          format: 'email',
        },
        eventDate: {
          type: 'string',
          pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$',
        },
        phone: contactFields.phone,
        location: { type: 'string', maxLength: 200 },
        package: {
          type: 'string',
          enum: [
            '',
            ...inquiryFormV1.fields
              .filter((f) => f.type === 'select')
              .flatMap((f) => f.options.map((o) => o.value)),
          ],
        },
        comment: { type: 'string', maxLength: 5000 },
      },
    },
  },
};
const validate = AjvCompiler()(
  {},
  {
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    },
  },
)({ schema: inquirySubmissionSchema });

export function isInquirySubmission(
  input: unknown,
): input is InquirySubmission {
  if (!validate(input)) return false;
  try {
    Temporal.PlainDate.from((input as InquirySubmission).fields.eventDate, {
      overflow: 'reject',
    });
    return true;
  } catch {
    return false;
  }
}
