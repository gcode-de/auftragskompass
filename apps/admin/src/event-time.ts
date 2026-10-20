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

// A saved instant inside the repeated hour belongs to exactly one offset. The
// editor preselects that offset so the operator sees the saved choice and can
// deliberately switch to the other occurrence of the same wall clock.
export function savedAmbiguousChoice(
  value: string,
  timeZone: string,
  originalInstant: string | null,
): AmbiguousTimeChoice | '' {
  if (!value || !originalInstant) return '';
  const resolution = resolveLocalTime(value, timeZone);
  if (resolution.kind !== 'ambiguous') return '';
  try {
    const original = fromInstant(originalInstant, timeZone);
    if (wallClock(original.value) !== wallClock(value)) return '';
    return (
      resolution.options.find((option) => option.offset === original.offset)
        ?.choice ?? ''
    );
  } catch {
    return '';
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
  if (resolution.kind !== 'ambiguous') {
    if (!value || !options.originalInstant) return resolution;
    try {
      if (
        wallClock(localDateTime(options.originalInstant, timeZone)) ===
        wallClock(value)
      )
        return {
          kind: 'unique',
          instant: options.originalInstant,
          preserved: true,
        };
    } catch {
      // Ignore an unparsable original instant; the wall clock stays decisive.
    }
    return resolution;
  }
  const picked = resolution.options.find(
    (option) => option.choice === options.choice,
  );
  if (picked) {
    // An explicit choice wins over the saved instant. When it still names the
    // saved offset, keep the exact stored instant including seconds.
    const original = options.originalInstant;
    if (original) {
      try {
        const saved = fromInstant(original, timeZone);
        if (
          wallClock(saved.value) === wallClock(value) &&
          saved.offset === picked.offset
        )
          return { kind: 'unique', instant: original, preserved: true };
      } catch {
        // A broken original timestamp must not block a valid wall clock.
      }
    }
    return { kind: 'unique', instant: picked.instant };
  }
  if (!options.originalInstant) return resolution;
  try {
    if (
      wallClock(localDateTime(options.originalInstant, timeZone)) ===
      wallClock(value)
    )
      return {
        kind: 'unique',
        instant: options.originalInstant,
        preserved: true,
      };
  } catch {
    // Ignore an unparsable original instant; the wall clock stays decisive.
  }
  return resolution;
}
