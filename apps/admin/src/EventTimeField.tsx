import { useState } from 'react';
import {
  localDateTime,
  resolveEventTime,
  resolveLocalTime,
  savedAmbiguousChoice,
  type AmbiguousTimeChoice,
} from './event-time.js';

export function EventTimeField({
  name,
  label,
  timeZone,
  instant,
  error,
  onChange,
}: {
  name: 'startsAt' | 'endsAt';
  label: string;
  timeZone: string;
  instant: string | null;
  error?: string | undefined;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(localDateTime(instant, timeZone)),
    [picked, setPicked] = useState<{
      value: string;
      choice: AmbiguousTimeChoice;
    } | null>(null),
    savedChoice = savedAmbiguousChoice(value, timeZone, instant),
    choice = picked?.value === value ? picked.choice : savedChoice,
    local = resolveLocalTime(value, timeZone),
    options = local.kind === 'ambiguous' ? local.options : [],
    unresolved = local.kind === 'ambiguous' && choice === '',
    resolution = resolveEventTime(value, timeZone, {
      originalInstant: instant,
      choice,
    }),
    errorId = `event-${name}-error`,
    invalid =
      resolution.kind === 'nonexistent' ||
      resolution.kind === 'invalid' ||
      unresolved ||
      Boolean(error);
  return (
    <>
      <label>
        {label}
        <input
          name={name}
          type="datetime-local"
          step="0.001"
          value={value}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setValue(next);
            setPicked((current) =>
              current && current.value === next ? current : null,
            );
            onChange?.(next);
          }}
        />
      </label>
      {options.length > 0 && (
        <label>
          {`Uhrzeitwahl ${label}`}
          <select
            name={`${name}Choice`}
            value={choice}
            aria-invalid={unresolved}
            aria-describedby={unresolved ? errorId : undefined}
            onChange={(event) =>
              setPicked({
                value,
                choice: event.currentTarget.value as AmbiguousTimeChoice,
              })
            }
          >
            <option value="">Bitte wählen</option>
            {options.map((option) => (
              <option key={option.choice} value={option.choice}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      {unresolved && (
        <p className="field-error" id={errorId} role="alert">
          Diese Uhrzeit gibt es an diesem Tag zweimal. Bitte Sommerzeit oder
          Normalzeit wählen.
        </p>
      )}
      {resolution.kind === 'nonexistent' && (
        <p className="field-error" id={errorId} role="alert">
          Diese Uhrzeit existiert an diesem Tag nicht, weil die Uhr auf
          Sommerzeit umgestellt wird. Bitte eine andere Uhrzeit wählen.
        </p>
      )}
      {resolution.kind === 'invalid' && (
        <p className="field-error" id={errorId} role="alert">
          Bitte eine gültige Uhrzeit eingeben.
        </p>
      )}
    </>
  );
}
