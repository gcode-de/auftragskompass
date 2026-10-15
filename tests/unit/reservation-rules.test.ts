import { expect, test } from 'vitest';
import {
  bufferedPeriod,
  effectiveState,
  stateAfterEvent,
} from '../../packages/core/src/reservation-rules.js';
test('buffers use tenant calendar days once across both DST transitions and multiday periods', () => {
  const spring = bufferedPeriod(
    '2026-03-30T10:00:00Z',
    '2026-03-31T10:00:00Z',
    'Europe/Berlin',
    2,
    2,
  );
  expect(spring).toEqual({
    startsAt: new Date('2026-03-28T11:00:00Z'),
    endsAt: new Date('2026-04-02T10:00:00Z'),
  });
  const autumn = bufferedPeriod(
    '2026-10-26T11:00:00Z',
    '2026-10-27T11:00:00Z',
    'Europe/Berlin',
    2,
    2,
  );
  expect(autumn.startsAt.toISOString()).toBe('2026-10-24T10:00:00.000Z');
  expect(
    bufferedPeriod(
      '2026-10-16T10:00:00Z',
      '2026-10-16T12:00:00Z',
      'Europe/Berlin',
      0,
      0,
    ).startsAt.toISOString(),
  ).toBe('2026-10-16T10:00:00.000Z');
  for (const [start, end, before, after] of [
    [null, null, 2, 2],
    ['bad', 'bad', 2, 2],
    ['2026-10-16T10:00:00Z', '2026-10-16T10:00:00Z', 2, 2],
    ['2026-10-16T10:00:00Z', '2026-10-16T12:00:00Z', -1, 2],
    ['2026-10-16T10:00:00Z', '2026-10-16T12:00:00Z', 2, 366],
    ['2026-10-16T10:00:00Z', '2026-10-16T12:00:00Z', 1.5, 0],
  ] as const)
    expect(() =>
      bufferedPeriod(start, end, 'Europe/Berlin', before, after),
    ).toThrow('invalid_period');
});
test('expiry and event transitions preserve history and release only future capacity', () => {
  const now = new Date('2026-10-15T12:00:00Z'),
    future = new Date('2026-10-16T12:00:00Z');
  expect(effectiveState('hold', now, now)).toBe('expired');
  expect(effectiveState('hold', future, now)).toBe('hold');
  expect(effectiveState('hold', null, now)).toBe('hold');
  expect(effectiveState('booked', null, now)).toBe('booked');
  for (const target of ['cancelled', 'unavailable'])
    for (const state of ['hold', 'booked', 'blocked'] as const)
      expect(stateAfterEvent('option', target, state, future, now)).toBe(
        'released',
      );
  for (const target of ['inquiry', 'option'])
    expect(stateAfterEvent('booked', target, 'booked', future, now)).toBe(
      'hold',
    );
  expect(stateAfterEvent('booked', 'cancelled', 'booked', now, now)).toBe(
    'booked',
  );
  expect(stateAfterEvent('option', 'cancelled', 'expired', future, now)).toBe(
    'expired',
  );
  expect(stateAfterEvent('option', 'cancelled', 'released', future, now)).toBe(
    'released',
  );
  expect(stateAfterEvent('option', 'option', 'hold', future, now)).toBe('hold');
  expect(stateAfterEvent('booked', 'booked', 'booked', future, now)).toBe(
    'booked',
  );
  expect(stateAfterEvent('option', 'inquiry', 'hold', future, now)).toBe(
    'hold',
  );
});

test('reversed or incomplete base periods and invalid zones fail without a reservation', () => {
  for (const [start, end] of [
    ['2026-10-16T12:00:00Z', '2026-10-16T10:00:00Z'],
    ['2026-10-16T12:00:00Z', null],
  ] as const)
    expect(() => bufferedPeriod(start, end, 'Europe/Berlin', 0, 0)).toThrow(
      'invalid_period',
    );
  expect(() =>
    bufferedPeriod(
      '2026-10-16T10:00:00Z',
      '2026-10-16T12:00:00Z',
      'Synthetic/Invalid',
      0,
      0,
    ),
  ).toThrow('invalid_period');
  expect(
    stateAfterEvent(
      'booked',
      'option',
      'hold',
      new Date('2030-01-02'),
      new Date('2030-01-01'),
    ),
  ).toBe('hold');
});
