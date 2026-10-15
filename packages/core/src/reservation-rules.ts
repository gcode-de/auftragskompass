import { Temporal } from '@js-temporal/polyfill';
export type ReservationState =
  'hold' | 'booked' | 'blocked' | 'released' | 'expired';
export function bufferedPeriod(
  start: string | null,
  end: string | null,
  timeZone: string,
  beforeDays: number,
  afterDays: number,
) {
  try {
    if (
      !start ||
      !end ||
      ![beforeDays, afterDays].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 365,
      )
    )
      throw Error();
    const first = Temporal.Instant.from(start),
      last = Temporal.Instant.from(end);
    if (first.epochMilliseconds >= last.epochMilliseconds) throw Error();
    return {
      startsAt: new Date(
        first.toZonedDateTimeISO(timeZone).subtract({ days: beforeDays })
          .epochMilliseconds,
      ),
      endsAt: new Date(
        last.toZonedDateTimeISO(timeZone).add({ days: afterDays })
          .epochMilliseconds,
      ),
    };
  } catch {
    throw Error('invalid_period');
  }
}
export function effectiveState(
  state: ReservationState,
  expiresAt: Date | null,
  now: Date,
): ReservationState {
  return state === 'hold' && expiresAt && expiresAt <= now ? 'expired' : state;
}
export function stateAfterEvent(
  previous: string,
  next: string,
  state: ReservationState,
  endsAt: Date,
  now: Date,
): ReservationState {
  if (endsAt <= now || state === 'released' || state === 'expired')
    return state;
  if (next === 'cancelled' || next === 'unavailable') return 'released';
  if (
    previous === 'booked' &&
    (next === 'inquiry' || next === 'option') &&
    state === 'booked'
  )
    return 'hold';
  return state;
}
