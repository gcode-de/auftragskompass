import { expect, test } from 'vitest';
import {
  activeDatePreset,
  datePresetRange,
  eventFilterCounts,
  filterRows,
  monthGroups,
} from '../../apps/admin/src/event-filters.js';

// H041: the quick presets are tenant-local calendar dates. The instant picks
// the tenant day, never the browser day.
test('date presets use the tenant-local day, not the browser day', () => {
  // 23:30 UTC on 31 October is already 1 November in Berlin (UTC+1).
  const instant = '2031-10-31T23:30:00.000Z';
  expect(datePresetRange('this-month', instant, 'Europe/Berlin')).toEqual({
    from: '2031-11-01',
    to: '2031-11-30',
  });
  expect(datePresetRange('next-month', instant, 'Europe/Berlin')).toEqual({
    from: '2031-12-01',
    to: '2031-12-31',
  });
  // The same instant is still October in UTC and in a western zone.
  expect(datePresetRange('this-month', instant, 'UTC')).toEqual({
    from: '2031-10-01',
    to: '2031-10-31',
  });
  expect(
    datePresetRange('next-month', '2031-12-31T12:00:00.000Z', 'Europe/Berlin'),
  ).toEqual({ from: '2032-01-01', to: '2032-01-31' });
  expect(
    datePresetRange('this-month', '2032-02-15T12:00:00.000Z', 'Europe/Berlin'),
  ).toEqual({ from: '2032-02-01', to: '2032-02-29' });
});

test('upcoming has a lower bound only and an unknown zone yields no range', () => {
  expect(
    datePresetRange('upcoming', '2031-11-07T09:00:00.000Z', 'America/New_York'),
  ).toEqual({ from: '2031-11-07', to: '' });
  expect(
    datePresetRange('this-month', '2031-11-07T09:00:00.000Z', ''),
  ).toBeNull();
  expect(
    datePresetRange('this-month', 'not-an-instant', 'Europe/Berlin'),
  ).toBeNull();
});

test('a preset is only selected when the URL matches its exact range', () => {
  const instant = '2031-11-07T09:00:00.000Z',
    zone = 'Europe/Berlin';
  expect(
    activeDatePreset('?from=2031-11-01&to=2031-11-30', instant, zone),
  ).toBe('this-month');
  expect(
    activeDatePreset('?from=2031-11-01&to=2031-11-30&q=x', instant, zone),
  ).toBe('this-month');
  expect(
    activeDatePreset('?from=2031-12-01&to=2031-12-31', instant, zone),
  ).toBe('next-month');
  expect(activeDatePreset('?from=2031-11-07', instant, zone)).toBe('upcoming');
  // A custom range or an extra bound selects no date preset.
  expect(
    activeDatePreset('?from=2031-11-02&to=2031-11-30', instant, zone),
  ).toBeNull();
  expect(activeDatePreset('?from=2031-11-01', instant, zone)).not.toBe(
    'this-month',
  );
  expect(activeDatePreset('', instant, zone)).toBeNull();
  // The undated sort is the fourth choice and a stale bound next to it keeps
  // the meaning the switch already had (undated=true wins over dates).
  expect(activeDatePreset('?undated=true', instant, zone)).toBe('undated');
  expect(
    activeDatePreset(
      '?from=2031-11-01&to=2031-11-30&undated=true',
      instant,
      zone,
    ),
  ).toBe('undated');
  expect(activeDatePreset('?undated=true', instant, '')).toBe('undated');
});

// A dated row is not undated; `startsAt` stays null on purpose so only the
// event date decides the undated bucket, exactly like the server list.
const dated = (id: string, eventDate: string | null) => ({
  id,
  name: 'Synthetic ' + id,
  eventDate,
  startsAt: null,
  status: 'inquiry',
  eventTypeId: null as string | null,
});

test('counters come from the loaded list and ignore the option itself', () => {
  const rows = [
    dated('a', null),
    dated('b', null),
    dated('c', null),
    dated('e', '2031-11-03'),
    { ...dated('f', '2031-11-04'), status: 'booked' },
  ];
  expect(eventFilterCounts(rows, '?status=inquiry')).toEqual({
    undated: 3,
    inquiries: 4,
  });
  // The undated sort and the date bounds never narrow the counters; q/status/type do.
  expect(eventFilterCounts(rows, '?undated=true')).toEqual({
    undated: 3,
    inquiries: 4,
  });
  // q does narrow, and the date bounds of the current view do not.
  expect(
    eventFilterCounts(
      [
        { ...dated('g', null), name: 'Synthetic undated' },
        { ...dated('h', '2031-11-03'), name: 'Other event' },
      ],
      '?from=2031-11-01&to=2031-11-30&q=synthetic',
    ),
  ).toEqual({ undated: 1, inquiries: 1 });
  expect(
    eventFilterCounts(
      [
        { ...dated('e', null), eventTypeId: 'type-a' },
        { ...dated('f', null), eventTypeId: 'type-b' },
      ],
      '?eventTypeId=type-a',
    ),
  ).toEqual({ undated: 1, inquiries: 1 });
});

test('filter rows apply everything but the undated switch and the sort is a view', () => {
  const rows = [
    dated('undated-1', null),
    { ...dated('undated-2', null), status: 'booked' },
    dated('month', '2031-11-03'),
  ];
  expect(
    filterRows(rows, '?undated=true&status=booked').map((row) => row.id),
  ).toEqual(['undated-2']);
  expect(filterRows(rows, '?eventTypeId=type-a').map((row) => row.id)).toEqual(
    [],
  );
  expect(monthGroups(rows).map((group) => [group.month, group.count])).toEqual([
    ['2031-11', 1],
    ['', 2],
  ]);
});
