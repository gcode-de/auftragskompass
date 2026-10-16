import { expect, test } from 'vitest';
import { calendarWindow } from '../../packages/core/src/calendar.js';
test('calendar windows use Monday weeks and exact local days across both DST changes', () => {
  expect(calendarWindow('2030-10-27', 'week', 'Europe/Berlin')).toMatchObject({
    from: '2030-10-21',
    to: '2030-10-27',
    previousDate: '2030-10-20',
    nextDate: '2030-11-03',
  });
  const march = calendarWindow('2030-03-31', 'day', 'Europe/Berlin');
  expect(
    Date.parse(march.days[0]!.endsAt) - Date.parse(march.days[0]!.startsAt),
  ).toBe(23 * 3600000);
  expect(
    calendarWindow('2032-02-29', 'month', 'Europe/Berlin').days,
  ).toHaveLength(29);
  expect(calendarWindow('2030-12-31', 'week', 'Europe/Berlin').to).toBe(
    '2031-01-05',
  );
  expect(calendarWindow('0001-01-01', 'month', 'UTC').previousDate).toBeNull();
  expect(calendarWindow('9999-12-31', 'day', 'UTC').nextDate).toBeNull();
  expect(() => calendarWindow('0000-01-01', 'day', 'UTC')).toThrow(
    'invalid_calendar_period',
  );
  expect(() => calendarWindow('9999-12-31', 'week', 'UTC')).toThrow(
    'invalid_calendar_period',
  );
  expect(() => calendarWindow('invalid', 'day', 'UTC')).toThrow(
    'invalid_calendar_period',
  );
});
