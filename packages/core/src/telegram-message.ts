import { inquiryFormV1 } from './inquiry-form-definition.js';
import { isWebsiteInquiry } from './website-inquiries.js';
import { toUSVString } from 'node:util';
import {
  formatNoticeDate,
  type InquiryNoticeExtras,
} from './inquiry-notice.js';

const maxMessageLength = 4096;
const truncationMarker = '[Text gekürzt]';

// INQUIRY-INFO-01: the extras sit between the bounded fields and the long
// comment, so the tail truncation below still shortens only the comment.
export function renderInquiryNoticeLines(
  extras: InquiryNoticeExtras | null | undefined,
  day: string | null,
): string[] {
  if (!extras) return [];
  const lines: string[] = [];
  if (day && extras.freeUnits.length)
    lines.push(
      `Freie Einheiten am ${formatNoticeDate(day)}: ` +
        extras.freeUnits
          .map((unit) => `${unit.category} ${unit.free}/${unit.total}`)
          .join(', '),
    );
  if (extras.eventLink)
    lines.push(
      `${extras.eventLink.exact ? 'Event' : `Events am ${day ? formatNoticeDate(day) : '—'}`}: ${extras.eventLink.href}`,
    );
  if (extras.replyLink) lines.push(`Antwort-Mail: ${extras.replyLink}`);
  return lines;
}

export function renderWebsiteInquiryTelegramMessage(
  input: unknown,
  extras?: InquiryNoticeExtras | null,
): string {
  if (!isWebsiteInquiry(input))
    return 'Neue Website-Anfrage ist im AuftragsKompass eingegangen. Details sind in der App verfügbar.';

  const fields = input.submission.fields;
  const comment = inquiryFormV1.fields.find(
    (field) => field.name === 'comment',
  );
  const lineOf = (field: (typeof inquiryFormV1.fields)[number]) => {
    const raw = fields[field.name] ?? '';
    const value =
      field.type === 'select'
        ? (field.options.find((option) => option.value === raw)?.label ?? '')
        : field.type === 'date'
          ? raw.split('-').reverse().join('.')
          : raw;
    return `${field.label}: ${(value || '—').replace(/\r\n|\r|\n/g, '\n  ')}`;
  };
  const bounded = inquiryFormV1.fields
    .filter((field) => field.name !== 'comment')
    .map(lineOf);
  const notice = renderInquiryNoticeLines(
    extras,
    typeof fields.eventDate === 'string' && fields.eventDate
      ? fields.eventDate
      : null,
  );
  const tail = comment ? [lineOf(comment)] : [];
  const prefix = 'Neue Website-Anfrage\n';
  const full = prefix + [...bounded, ...notice, ...tail].join('\n');
  if (full.length <= maxMessageLength) return full;

  // The bounded fields precede the long comment, so only its tail is shortened.
  return `${toUSVString(full.slice(0, maxMessageLength - truncationMarker.length - 1))}\n${truncationMarker}`;
}
