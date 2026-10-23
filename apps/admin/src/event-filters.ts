import { Temporal } from '@js-temporal/polyfill';

// H041: the quick presets are plain tenant-local calendar dates, so the
// server-side `from`/`to` filters stay exactly as they are.
export type DatePreset = 'this-month' | 'next-month' | 'upcoming' | 'undated';
export type PresetId = Exclude<DatePreset, 'undated'>;
export const datePresets: { id: PresetId; label: string }[] = [
  { id: 'this-month', label: 'Dieser Monat' },
  { id: 'next-month', label: 'Nächster Monat' },
  { id: 'upcoming', label: 'Nächste Events' },
];

// The tenant day follows the tenant zone, not the browser zone: an operator in
// a different zone must still see "this month" as the business month.
function tenantDay(instant: string, timeZone: string) {
  try {
    return Temporal.Instant.from(instant)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  } catch {
    return null;
  }
}

export function datePresetRange(
  preset: PresetId,
  instant: string,
  timeZone: string,
): { from: string; to: string } | null {
  const today = timeZone ? tenantDay(instant, timeZone) : null;
  if (!today) return null;
  if (preset === 'upcoming') return { from: today.toString(), to: '' };
  const month =
    preset === 'next-month'
      ? today.add({ months: 1 }).with({ day: 1 })
      : today.with({ day: 1 });
  // `with({ day: 31 })` clamps to the month length, so the range always ends
  // on the real last local day (28/29/30/31) without a hand-written table.
  return { from: month.toString(), to: month.with({ day: 31 }).toString() };
}

// A preset is selected only for its exact range; a custom range or an extra
// bound selects nothing.
export function activeDatePreset(
  search: string,
  instant: string,
  timeZone: string,
): DatePreset | null {
  const params = new URLSearchParams(search),
    from = params.get('from') ?? '',
    to = params.get('to') ?? '';
  // A stale bookmark may still carry a date bound beside `undated`; the sort
  // keeps its meaning, so the switch alone decides.
  if (params.get('undated') === 'true') return 'undated';
  const candidate = (['this-month', 'next-month', 'upcoming'] as const).find(
    (preset) => {
      const range = datePresetRange(preset, instant, timeZone);
      return Boolean(range) && range!.from === from && range!.to === to;
    },
  );
  return candidate ?? null;
}

type FilterRow = {
  id: string;
  name: string;
  description?: string;
  source?: string;
  status: string;
  eventTypeId: string | null;
  eventDate: string | null;
};

// The counters answer "how many would this option show?", so they apply the
// narrowing filters of the query but never the option itself.
export function filterRows<T extends FilterRow>(
  rows: T[],
  search: string,
): T[] {
  const params = new URLSearchParams(search),
    q = (params.get('q') ?? '').toLocaleLowerCase('de-DE'),
    status = params.get('status') ?? '',
    eventTypeId = params.get('eventTypeId') ?? '';
  return rows.filter(
    (row) =>
      (!status || row.status === status) &&
      (!eventTypeId || row.eventTypeId === eventTypeId) &&
      (!q ||
        [row.name, row.description, row.source].some((field) =>
          (field ?? '').toLocaleLowerCase('de-DE').includes(q),
        )),
  );
}

// Every counter answers its own option, so the undated sort and the date
// bounds are switched off while counting; q/status/type still narrow it.
function countable(search: string) {
  const params = new URLSearchParams(search);
  for (const key of ['undated', 'from', 'to']) params.delete(key);
  return '?' + params.toString();
}

export function eventFilterCounts(rows: FilterRow[], search: string) {
  const visible = filterRows(rows, countable(search));
  return {
    undated: visible.filter((row) => !row.eventDate).length,
    // There is no separate "new inquiry" state; `inquiry` is the status of a
    // request that has not become an option yet.
    inquiries: visible.filter((row) => row.status === 'inquiry').length,
  };
}

// BKP007: the mobile filter access names how many filter dimensions the applied
// URL sets. It counts criteria, not rows — the result counters above stay the
// only place that counts events.
const filterCriteria = [
  ['q'],
  ['from', 'to', 'undated'],
  ['status'],
  ['eventTypeId'],
] as const;

export function activeFilterCriteria(search: string) {
  const params = new URLSearchParams(search);
  return filterCriteria.filter((keys) => keys.some((key) => params.get(key)))
    .length;
}

// Undated events keep their own trailing group, exactly like the server list.
export function monthGroups<T extends { eventDate: string | null }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const month = row.eventDate?.slice(0, 7) ?? '';
    const group = groups.get(month);
    if (group) group.push(row);
    else groups.set(month, [row]);
  }
  // Dated months stay chronological; the undated bucket always trails.
  return [...groups]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([month, entries]) => ({
      month,
      entries,
      count: entries.length,
    }));
}
