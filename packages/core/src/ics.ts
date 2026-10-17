import { eventStatuses } from './master-data.js';
import { createHash } from 'node:crypto';
export type IcsOptions = {
  description: boolean;
  eventType: boolean;
  internalLink: boolean;
};
export type IcsEvent = {
  id: string;
  name: string;
  status: string;
  eventDate: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  location: string;
  description: string;
  eventType: string | null;
  resources: string[];
};
const labels = Object.fromEntries(
  eventStatuses.map(({ code, label }) => [code, label]),
);
function text(value: string) {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      // eslint-disable-next-line no-control-regex -- RFC TEXT excludes nonprinting controls.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  );
}
function fold(line: string) {
  let result = '',
    length = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    if (length + bytes > 75) {
      result += '\r\n ';
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}
const timestamp = (value: Date) =>
  value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
export function renderIcs(
  tenantId: string,
  events: IcsEvent[],
  sequence: number,
  changedAt: Date,
  options: IcsOptions,
  origin: string,
) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AuftragsKompass//Calendar//DE',
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    if (!event.eventDate) continue;
    const uid = createHash('sha256')
      .update(tenantId + ':' + event.id)
      .digest('hex');
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid + '@auftragskompass',
      'DTSTAMP:' + timestamp(changedAt),
      'LAST-MODIFIED:' + timestamp(changedAt),
      'SEQUENCE:' + sequence,
    );
    if (event.startsAt && event.endsAt)
      lines.push(
        'DTSTART:' + timestamp(event.startsAt),
        'DTEND:' + timestamp(event.endsAt),
      );
    else
      lines.push(
        'DTSTART;VALUE=DATE:' + event.eventDate.replace(/-/g, ''),
        'DURATION:P1D',
      );
    const status = labels[event.status]!;
    const description = [
      status,
      'Ressourcen: ' + (event.resources.join(', ') || 'Keine zugewiesen'),
    ];
    if (options.description) description.push(event.description);
    if (options.eventType)
      description.push('Eventart: ' + (event.eventType ?? 'Offen'));
    lines.push(
      'SUMMARY:' + text(status + ' · ' + event.name),
      'LOCATION:' + text(event.location),
      'DESCRIPTION:' + text(description.join('\n')),
      'STATUS:' +
        (event.status === 'booked'
          ? 'CONFIRMED'
          : ['cancelled', 'unavailable'].includes(event.status)
            ? 'CANCELLED'
            : 'TENTATIVE'),
      'TRANSP:OPAQUE',
    );
    if (options.internalLink)
      lines.push('URL:' + origin + '/#event-' + event.id);
    lines.push('END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
