export type CalendarView = 'day' | 'week' | 'month';

const views: CalendarView[] = ['day', 'week', 'month'];
// H037: the overview opens as a month unless an explicit URL choice says
// otherwise. There is no new preference store; the URL is the only source.
export function calendarViewFromUrl(search: string): CalendarView {
  const value = new URLSearchParams(search).get('view');
  return views.find((view) => view === value) ?? 'month';
}
export function viewLabel(view: CalendarView) {
  return view === 'day' ? 'Tag' : view === 'week' ? 'Woche' : 'Monat';
}
// Calendar days are plain tenant-local dates, never instants. Formatting the
// parsed date parts in UTC keeps midnight, DST days and year boundaries exact.
function parts(date: string) {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}
function format(
  date: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'de-DE',
) {
  const { year, month, day } = parts(date);
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
export function plainDateText(date: string) {
  return format(date, { day: 'numeric', month: 'long', year: 'numeric' });
}
export function calendarRangeText(from: string, to: string) {
  if (from === to) return plainDateText(from);
  const { year: fromYear, month: fromMonth } = parts(from);
  const { year: toYear, month: toMonth } = parts(to);
  // Same month and year collapse to "21.–27. Oktober 2030"; a month overlap
  // such as an end-of-month week keeps both ends explicit.
  if (fromYear === toYear && fromMonth === toMonth)
    return (
      parts(from).day +
      '.–' +
      parts(to).day +
      '. ' +
      format(to, { month: 'long', year: 'numeric' })
    );
  return plainDateText(from) + ' – ' + plainDateText(to);
}
function isoWeek(date: string) {
  const day = new Date(date + 'T12:00:00Z');
  const weekday = (day.getUTCDay() + 6) % 7;
  const thursday = new Date(day.getTime());
  thursday.setUTCDate(day.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  return (
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000)
  );
}
export function calendarHeading(
  from: string,
  to: string,
  view: CalendarView,
): { title: string; range: string } {
  const range = calendarRangeText(from, to);
  if (view === 'month')
    return {
      title: format(from, { month: 'long', year: 'numeric' }),
      range,
    };
  if (view === 'week') return { title: 'Woche ' + isoWeek(from), range };
  return {
    title: format(from, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    range,
  };
}
// H037: only the stored schedule decides whether an event has a time. A
// date-only booking keeps its date and gets an explicit, non-invented label.
export function eventDateLabel(event: {
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
}) {
  if (event.startsAt && event.endsAt) return null;
  return event.eventDate ? 'Tagesbuchung, ohne Uhrzeit' : 'Ohne Datum';
}
// Calendar chip: the original stored interval is shown once, also in later
// day cells of a multi-day booking. Nothing is re-dated to the visible cell.
export function eventSpanText(
  event: { startsAt: string | null; endsAt: string | null },
  localDay: (instant: string) => string,
  localTime: (instant: string) => string,
  localDateText: (day: string) => string,
) {
  const startDay = localDay(event.startsAt!);
  const endDay = localDay(event.endsAt!);
  const start = localDateText(startDay) + ' ' + localTime(event.startsAt!);
  const end = localDateText(endDay) + ' ' + localTime(event.endsAt!);
  return startDay === endDay
    ? localTime(event.startsAt!) + ' Uhr – ' + localTime(event.endsAt!) + ' Uhr'
    : start + ' Uhr – ' + end + ' Uhr';
}
// List display: the list rows carry the same nullable start/end as the
// calendar, so the date-only case is decided from those fields only.
export function listScheduleText(
  event: { eventDate: string | null; startsAt: string | null },
  localDateText: (instant: string) => string,
  formatTime: (instant: string) => string,
) {
  if (!event.eventDate) return 'Ohne Datum';
  const date = plainDateText(event.eventDate);
  return event.startsAt
    ? date +
        ', ' +
        localDateText(event.startsAt) +
        ' ' +
        formatTime(event.startsAt) +
        ' Uhr'
    : date + ' · Tagesbuchung, ohne Uhrzeit';
}
