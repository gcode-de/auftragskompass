import { expect, test } from 'vitest';
import {
  activeDatePreset,
  activeFilterCriteria,
  datePresetRange,
  monthGroups,
} from '../../apps/admin/src/event-filters.js';

// BKP007: the mobile filter access names how many filter dimensions the applied
// URL sets. It counts criteria, never rows: the result counters stay untouched.
test('the active criteria count the filter dimensions of the applied url', () => {
  expect(activeFilterCriteria('')).toBe(0);
  expect(activeFilterCriteria('?other=keep&df_kind=offer')).toBe(0);
  expect(activeFilterCriteria('?q=Synthetic')).toBe(1);
  expect(activeFilterCriteria('?q=Synthetic&status=inquiry')).toBe(2);
  expect(activeFilterCriteria('?status=inquiry&eventTypeId=type-a')).toBe(2);
  // A lower bound, an upper bound and the undated sort are one criterion.
  expect(activeFilterCriteria('?from=2026-10-01')).toBe(1);
  expect(activeFilterCriteria('?from=2026-10-01&to=2026-10-31')).toBe(1);
  expect(activeFilterCriteria('?undated=true')).toBe(1);
  expect(
    activeFilterCriteria(
      '?q=x&from=2026-10-01&to=2026-10-31&status=inquiry&eventTypeId=type-a',
    ),
  ).toBe(4);
});

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

// BKP007.2: the two result counters are no longer counted from the loaded rows
// — that hid every undated event and every inquiry outside the applied date
// window. They are the server's tenant-wide aggregate of the list answer, so
// their semantics (q/status/eventTypeId narrow, dates do not, tenancy) is
// proven against the real repository and route in
// tests/integration/event-search.test.ts ("the event list counters never depend
// on the date bounds and stay tenant scoped"). The mobile criteria counter
// below still counts criteria instead of rows and stays client-side.
test('the criteria counter stays a count of dimensions, not of rows', () => {
  expect(
    activeFilterCriteria('?q=Synthetic&from=2031-11-01&to=2031-11-30'),
  ).toBe(2);
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

test('month groups keep the server order and put the undated bucket last', () => {
  const rows = [
    dated('undated-1', null),
    { ...dated('undated-2', null), status: 'booked' },
    dated('month', '2031-11-03'),
  ];
  expect(monthGroups(rows).map((group) => [group.month, group.count])).toEqual([
    ['2031-11', 1],
    ['', 2],
  ]);
});
