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

// BKP007.2: both result counters are the server's tenant-wide aggregate of the
// list answer (`filterCounts`), so they also name the undated events and the
// inquiries that the applied date bounds keep out of the loaded rows. The client
// never counts rows itself; the only local default is the empty answer before
// the first list arrives.
export type FilterCounts = { undated: number; inquiries: number };
export const emptyFilterCounts: FilterCounts = { undated: 0, inquiries: 0 };

// BKP007: the mobile filter access names how many filter dimensions the applied
// URL sets. It counts criteria, not rows — the two result counters above come
// from the server and stay the only place that counts events.
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
