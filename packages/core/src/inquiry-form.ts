import AjvCompiler from '@fastify/ajv-compiler';
import { Temporal } from '@js-temporal/polyfill';
import { toUSVString } from 'node:util';
import { contactFields } from './contacts.js';

import {
  inquiryFormV1,
  type InquirySubmission,
} from './inquiry-form-definition.js';
export {
  inquiryFormV1,
  type InquirySubmission,
} from './inquiry-form-definition.js';

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
  const fields = (input as InquirySubmission).fields;
  if (
    Object.values(fields).some(
      (value) =>
        typeof value !== 'string' ||
        value.includes('\0') ||
        toUSVString(value) !== value,
    ) ||
    Array.from(fields.firstName.trim() + ' ' + fields.lastName.trim()).length >
      200
  )
    return false;
  try {
    Temporal.PlainDate.from(fields.eventDate, {
      overflow: 'reject',
    });
    return true;
  } catch {
    return false;
  }
}
