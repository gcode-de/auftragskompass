import { Temporal } from '@js-temporal/polyfill';

export type AmbiguousTimeChoice = 'earlier' | 'later';
export type AmbiguousTimeOption = {
  choice: AmbiguousTimeChoice;
  instant: string;
  offset: string;
  label: string;
};
export type LocalTime =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'unique'; instant: string; preserved?: boolean }
  | { kind: 'ambiguous'; options: AmbiguousTimeOption[] }
  | { kind: 'nonexistent' };

// Explicit-offset helpers stay for the disposition surfaces; the event form
// resolves local times itself so no offset has to be entered by hand.
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

export function localDateTime(value: string | null, timeZone: string) {
  return fromInstant(value, timeZone).value;
}

// Browsers normalise `datetime-local` values (e.g. "18:00" instead of
// "18:00:00"), so unchanged input is compared on the parsed wall clock.
function wallClock(value: string) {
  return Temporal.PlainDateTime.from(value).toString();
}

function ambiguousOptions(
  local: Temporal.PlainDateTime,
  timeZone: string,
): AmbiguousTimeOption[] {
  const options = (['earlier', 'later'] as const).map((choice) => {
    const zoned = local.toZonedDateTime(timeZone, { disambiguation: choice });
    return {
      choice,
      instant: zoned.toInstant().toString(),
      offset: zoned.offset,
    };
  });
  // The repeated hour starts with the larger offset: daylight saving time ends.
  const daylightFirst = options[0]!.offset > options[1]!.offset;
  return options.map((option, index) => {
    const daylight = (index === 0) === daylightFirst;
    return {
      ...option,
      label: `${daylight ? 'Sommerzeit' : 'Normalzeit'} (UTC${option.offset})`,
    };
  });
}

export function resolveLocalTime(value: string, timeZone: string): LocalTime {
  if (!value) return { kind: 'empty' };
  if (!timeZone) return { kind: 'invalid' };
  try {
    const local = Temporal.PlainDateTime.from(value),
      earlier = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' }),
      later = local.toZonedDateTime(timeZone, { disambiguation: 'later' });
    if (
      !earlier.toPlainDateTime().equals(local) ||
      !later.toPlainDateTime().equals(local)
    )
      return { kind: 'nonexistent' };
    if (Temporal.ZonedDateTime.compare(earlier, later) === 0)
      return { kind: 'unique', instant: earlier.toInstant().toString() };
    return { kind: 'ambiguous', options: ambiguousOptions(local, timeZone) };
  } catch {
    return { kind: 'invalid' };
  }
}

export function resolveEventTime(
  value: string,
  timeZone: string,
  options: {
    originalInstant?: string | null;
    choice?: AmbiguousTimeChoice | '';
  } = {},
): LocalTime {
  const resolution = resolveLocalTime(value, timeZone);
  if (!value) return resolution;
  const original = options.originalInstant ?? null;
  if (original) {
    try {
      if (wallClock(localDateTime(original, timeZone)) === wallClock(value))
        return { kind: 'unique', instant: original, preserved: true };
    } catch {
      return { kind: 'invalid' };
    }
  }
  if (resolution.kind !== 'ambiguous') return resolution;
  const picked = resolution.options.find(
    (option) => option.choice === options.choice,
  );
  return picked ? { kind: 'unique', instant: picked.instant } : resolution;
}
