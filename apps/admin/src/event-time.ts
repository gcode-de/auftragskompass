import { Temporal } from '@js-temporal/polyfill';
export function toInstant(value: string, timeZone: string, offset = '') {
  if (!value) return null;
  return Temporal.ZonedDateTime.from(`${value}${offset}[${timeZone}]`, {
    disambiguation: 'reject',
    offset: 'reject',
  })
    .toInstant()
    .toString();
}
export function fromInstant(value: string | null, timeZone: string) {
  if (!value) return { value: '', offset: '' };
  const zoned = Temporal.Instant.from(value).toZonedDateTimeISO(timeZone);
  return {
    value: zoned.toPlainDateTime().toString(),
    offset: zoned.offset,
  };
}
