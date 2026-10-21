import { expect, test } from 'vitest';
import {
  calendarHeading,
  eventSpanText,
  calendarRangeText,
  calendarViewFromUrl,
  viewLabel,
} from '../../apps/admin/src/calendar-range.js';

test('calendar keeps month as default unless the URL asks for another view', () => {
  expect(calendarViewFromUrl('')).toBe('month');
  expect(calendarViewFromUrl('?view=week')).toBe('week');
  expect(calendarViewFromUrl('?view=day')).toBe('day');
  expect(calendarViewFromUrl('?view=month')).toBe('month');
  // Unknown or stale values fall back to the calm month default.
  expect(calendarViewFromUrl('?view=year')).toBe('month');
  expect(calendarViewFromUrl('?view=')).toBe('month');
});

test('calendar view labels are the only visible view names', () => {
  expect(viewLabel('day')).toBe('Tag');
  expect(viewLabel('week')).toBe('Woche');
  expect(viewLabel('month')).toBe('Monat');
});

test('month and week headings name the actual local range', () => {
  expect(calendarHeading('2030-11-01', '2030-11-30', 'month')).toEqual({
    title: 'November 2030',
    range: '1.–30. November 2030',
  });
  expect(calendarHeading('2030-10-21', '2030-10-27', 'week')).toEqual({
    title: 'Woche 43',
    range: '21.–27. Oktober 2030',
  });
  // A week that crosses a month and a year names both ends truthfully.
  expect(calendarHeading('2030-12-30', '2031-01-05', 'week')).toEqual({
    title: 'Woche 1',
    range: '30. Dezember 2030 – 5. Januar 2031',
  });
  expect(calendarHeading('2032-02-29', '2032-02-29', 'day')).toEqual({
    title: 'Sonntag, 29. Februar 2032',
    range: '29. Februar 2032',
  });
});

test('range text stays date-only and never invent a clock time', () => {
  expect(calendarRangeText('2030-03-31', '2030-03-31')).toBe('31. März 2030');
  expect(calendarRangeText('2030-10-26', '2030-10-27')).toBe(
    '26.–27. Oktober 2030',
  );
  expect(calendarRangeText('2030-11-01', '2030-11-30')).toBe(
    '1.–30. November 2030',
  );
});
test('list text keeps date-only bookings free of invented times', async () => {
  const { listScheduleText } =
    await import('../../apps/admin/src/calendar-range.js');
  const localDate = (instant: string) =>
    instant.slice(0, 10).split('-').reverse().join('.');
  const formatTime = (instant: string) =>
    instant === '2030-10-26T19:30:00Z' ? '21:30' : '00:00';
  expect(
    listScheduleText(
      { eventDate: '2030-10-26', startsAt: null },
      localDate,
      formatTime,
    ),
  ).toBe('26. Oktober 2030 · Tagesbuchung, ohne Uhrzeit');
  expect(
    listScheduleText(
      { eventDate: null, startsAt: null },
      localDate,
      formatTime,
    ),
  ).toBe('Ohne Datum');
  expect(
    listScheduleText(
      { eventDate: '2030-10-26', startsAt: '2030-10-26T19:30:00Z' },
      localDate,
      formatTime,
    ),
  ).toBe('26. Oktober 2030, 26.10.2030 21:30 Uhr');
  // A real 00:00 start keeps its genuine time instead of a date-only label.
  expect(
    listScheduleText(
      { eventDate: '2030-10-28', startsAt: '2030-10-27T23:00:00Z' },
      () => '28.10.2030',
      formatTime,
    ),
  ).toBe('28. Oktober 2030, 28.10.2030 00:00 Uhr');
});

test('a multi-day booking keeps its original interval in every day cell', () => {
  const localDay = (instant: string) =>
    instant === '2030-10-26T20:00:00Z' ? '2030-10-26' : '2030-10-28';
  const localTime = (instant: string) =>
    instant === '2030-10-26T20:00:00Z'
      ? '22:00'
      : instant === '2030-10-27T23:00:00Z'
        ? '00:00'
        : instant === '2030-10-28T04:00:00Z'
          ? '05:00'
          : '01:00';
  const event = {
    startsAt: '2030-10-26T20:00:00Z',
    endsAt: '2030-10-28T23:00:00Z',
  };
  // Start and end cells must both describe the whole original interval and
  // never claim the visible cell's date as the original start.
  const localDateText = (day: string) =>
    day === '2030-10-26' ? '26. Oktober 2030' : '28. Oktober 2030';
  expect(eventSpanText(event, localDay, localTime, localDateText)).toBe(
    '26. Oktober 2030 22:00 Uhr – 28. Oktober 2030 01:00 Uhr',
  );
});

test('a same-day booking shows only its real clock times', () => {
  const localDay = () => '2030-10-27';
  const localTime = (instant: string) =>
    instant === '2030-10-27T10:00:00Z' ? '12:00' : '14:00';
  expect(
    eventSpanText(
      { startsAt: '2030-10-27T10:00:00Z', endsAt: '2030-10-27T12:00:00Z' },
      localDay,
      localTime,
      () => '27. Oktober 2030',
    ),
  ).toBe('12:00 Uhr – 14:00 Uhr');
});

test('list text never invents a time and keeps a genuine midnight', async () => {
  const { listScheduleText } =
    await import('../../apps/admin/src/calendar-range.js');
  const localDate = (instant: string) =>
    instant === '2030-10-27T23:00:00Z' ? '28.10.2030' : '26.10.2030';
  const localTime = (instant: string) =>
    instant === '2030-10-27T23:00:00Z' ? '00:00' : '21:30';
  // Date-only and undated rows carry no clock time at all.
  expect(
    listScheduleText(
      { eventDate: '2030-10-26', startsAt: null },
      localDate,
      localTime,
    ),
  ).toBe('26. Oktober 2030 · Tagesbuchung, ohne Uhrzeit');
  expect(
    listScheduleText({ eventDate: null, startsAt: null }, localDate, localTime),
  ).toBe('Ohne Datum');
  // A real 00:00 start keeps its genuine time, because only NULL means untimed.
  expect(
    listScheduleText(
      { eventDate: '2030-10-28', startsAt: '2030-10-27T23:00:00Z' },
      localDate,
      localTime,
    ),
  ).toBe('28. Oktober 2030, 28.10.2030 00:00 Uhr');
});
