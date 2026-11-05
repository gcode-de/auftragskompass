import { inquiryFormV1 } from './inquiry-form-definition.js';
import { isWebsiteInquiry } from './website-inquiries.js';
import { toUSVString } from 'node:util';

const maxMessageLength = 4096;
const truncationMarker = '[Text gekürzt]';

export function renderWebsiteInquiryTelegramMessage(input: unknown): string {
  if (!isWebsiteInquiry(input))
    return 'Neue Website-Anfrage ist im AuftragsKompass eingegangen. Details sind in der App verfügbar.';

  const fields = input.submission.fields;
  const lines = inquiryFormV1.fields.map((field) => {
    const raw = fields[field.name] ?? '';
    const value =
      field.type === 'select'
        ? (field.options.find((option) => option.value === raw)?.label ?? '')
        : field.type === 'date'
          ? raw.split('-').reverse().join('.')
          : raw;
    return `${field.label}: ${(value || '—').replace(/\r\n|\r|\n/g, '\n  ')}`;
  });
  const prefix = 'Neue Website-Anfrage\n';
  const full = prefix + lines.join('\n');
  if (full.length <= maxMessageLength) return full;

  // The bounded fields precede the long comment, so only its tail is shortened.
  return `${toUSVString(full.slice(0, maxMessageLength - truncationMarker.length - 1))}\n${truncationMarker}`;
}
