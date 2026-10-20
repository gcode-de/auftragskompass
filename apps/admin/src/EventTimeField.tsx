import { useState } from 'react';
import {
  localDateTime,
  resolveEventTime,
  type AmbiguousTimeChoice,
} from './event-time.js';

export function EventTimeField({
  name,
  label,
  timeZone,
  instant,
}: {
  name: 'startsAt' | 'endsAt';
  label: string;
  timeZone: string;
  instant: string | null;
}) {
  const [value, setValue] = useState(localDateTime(instant, timeZone)),
    [choice, setChoice] = useState<AmbiguousTimeChoice | ''>(''),
    resolution = resolveEventTime(value, timeZone, {
      originalInstant: instant,
    }),
    options = resolution.kind === 'ambiguous' ? resolution.options : [],
    errorId = `event-${name}-error`,
    invalid =
      resolution.kind === 'nonexistent' || resolution.kind === 'invalid';
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
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
      {options.length > 0 && (
        <label>
          {`Uhrzeitwahl ${label}`}
          <select
            name={`${name}Choice`}
            value={choice || options[0]!.choice}
            onChange={(event) =>
              setChoice(event.currentTarget.value as AmbiguousTimeChoice)
            }
          >
            {options.map((option) => (
              <option key={option.choice} value={option.choice}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
