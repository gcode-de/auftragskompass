import { expect, test } from 'vitest';
import {
  sanitizeNotes,
  validateSchedule,
} from '../../packages/core/src/events.js';
import {
  localDateTime,
  fromInstant,
  resolveEventTime,
  resolveLocalTime,
  savedAmbiguousChoice,
} from '../../apps/admin/src/event-time.js';
test('event notes retain simple formatting and safe links but strip active content', () => {
  expect(
    sanitizeNotes(
      '<p><strong>Fictional</strong> <a href="https://example.invalid" onclick="bad()">link</a><img src="https://example.invalid/pixel"><script>bad()</script><a href="javascript:bad()">bad</a></p>',
    ),
  ).toBe(
    '<p><strong>Fictional</strong> <a href="https://example.invalid">link</a><a>bad</a></p>',
  );
  expect(
    sanitizeNotes('<svg><a xlink:href="javascript:bad()">bad</a></svg>'),
  ).not.toContain('javascript');
});
test('event schedules accept missing dates and date-only but reject partial, reversed and mismatched times', () => {
  validateSchedule(null, null, null, 'Europe/Berlin');
  validateSchedule('2026-10-16', null, null, 'Europe/Berlin');
  validateSchedule(
    '2026-10-16',
    '2026-10-16T18:00:00Z',
    '2026-10-17T01:00:00Z',
    'Europe/Berlin',
  );
  for (const args of [
    [null, '2026-10-16T18:00:00Z', '2026-10-17T01:00:00Z'],
    ['2026-02-30', null, null],
    ['0000-01-01', null, null],
    ['2026-10-16', '2026-10-16T18:00:00Z', null],
    ['2026-10-16', null, '2026-10-16T18:00:00Z'],
    ['2026-10-16', '2026-10-16T18:00:00Z', '2026-10-16T18:00:00Z'],
    ['2026-10-15', '2026-10-16T18:00:00Z', '2026-10-17T01:00:00Z'],
  ] as const)
    expect(() =>
      validateSchedule(args[0], args[1], args[2], 'Europe/Berlin'),
    ).toThrow('invalid_schedule');
});
test('unique local event times resolve in the tenant timezone without a manual offset', () => {
  expect(resolveLocalTime('', 'Europe/Berlin')).toEqual({ kind: 'empty' });
  expect(resolveLocalTime('no-time', 'Europe/Berlin')).toEqual({
    kind: 'invalid',
  });
  expect(resolveLocalTime('2026-07-01T18:00', '')).toEqual({
    kind: 'invalid',
  });
  expect(resolveLocalTime('2026-07-01T18:00', 'Europe/Berlin')).toEqual({
    kind: 'unique',
    instant: '2026-07-01T16:00:00Z',
  });
  expect(resolveLocalTime('2026-10-26T18:00', 'Europe/Berlin')).toEqual({
    kind: 'unique',
    instant: '2026-10-26T17:00:00Z',
  });
  expect(resolveLocalTime('2026-01-15T18:00', 'Europe/Berlin')).toEqual({
    kind: 'unique',
    instant: '2026-01-15T17:00:00Z',
  });
  expect(localDateTime(null, 'Europe/Berlin')).toBe('');
  expect(localDateTime('2026-10-25T01:30:00Z', 'Europe/Berlin')).toBe(
    '2026-10-25T02:30:00',
  );
  expect(localDateTime('2026-07-01T16:00:00.123Z', 'Europe/Berlin')).toBe(
    '2026-07-01T18:00:00.123',
  );
  expect(fromInstant('2026-10-25T01:30:00Z', 'Europe/Berlin')).toEqual({
    value: '2026-10-25T02:30:00',
    offset: '+01:00',
  });
});

test('DST edge local times are detected instead of guessed', () => {
  expect(resolveLocalTime('2026-03-29T02:30', 'Europe/Berlin')).toEqual({
    kind: 'nonexistent',
  });
  expect(resolveLocalTime('2026-03-29T03:00', 'Europe/Berlin')).toEqual({
    kind: 'unique',
    instant: '2026-03-29T01:00:00Z',
  });
  const ambiguous = resolveLocalTime('2026-10-25T02:30', 'Europe/Berlin');
  expect(ambiguous.kind).toBe('ambiguous');
  if (ambiguous.kind !== 'ambiguous') throw Error('expected ambiguous');
  expect(ambiguous.options).toEqual([
    {
      choice: 'earlier',
      instant: '2026-10-25T00:30:00Z',
      offset: '+02:00',
      label: 'Sommerzeit (UTC+02:00)',
    },
    {
      choice: 'later',
      instant: '2026-10-25T01:30:00Z',
      offset: '+01:00',
      label: 'Normalzeit (UTC+01:00)',
    },
  ]);
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', {
      choice: 'earlier',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-10-25T00:30:00Z' });
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', {
      choice: 'later',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-10-25T01:30:00Z' });
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', { choice: '' }),
  ).toEqual(ambiguous);
});

test('unchanged event instants survive edits in repeated hours and keep seconds', () => {
  expect(
    resolveEventTime('2026-10-25T02:30:00', 'Europe/Berlin', {
      originalInstant: '2026-10-25T01:30:00Z',
    }),
  ).toEqual({
    kind: 'unique',
    instant: '2026-10-25T01:30:00Z',
    preserved: true,
  });
  expect(
    resolveEventTime('2026-10-25T02:45:00', 'Europe/Berlin', {
      originalInstant: '2026-10-25T01:30:00Z',
    }).kind,
  ).toBe('ambiguous');
  expect(
    resolveEventTime('2026-07-01T18:00:00.123', 'Europe/Berlin', {
      originalInstant: '2026-07-01T16:00:00.123Z',
    }),
  ).toEqual({
    kind: 'unique',
    instant: '2026-07-01T16:00:00.123Z',
    preserved: true,
  });
  expect(
    resolveEventTime('2026-11-01T18:00', 'Europe/Berlin', {
      originalInstant: '2026-07-01T16:00:00Z',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-11-01T17:00:00Z' });
  expect(
    resolveEventTime('', 'Europe/Berlin', {
      originalInstant: '2026-07-01T16:00:00Z',
    }),
  ).toEqual({ kind: 'empty' });
});

test('oversized sanitized notes fail safely', () => {
  expect(() => sanitizeNotes('&'.repeat(20000))).toThrow('invalid_notes');
});

test('an explicit ambiguous choice overrides the saved instant but keeps its seconds when unchanged', () => {
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', {
      originalInstant: '2026-10-25T01:30:00Z',
      choice: 'later',
    }),
  ).toEqual({
    kind: 'unique',
    instant: '2026-10-25T01:30:00Z',
    preserved: true,
  });
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', {
      originalInstant: '2026-10-25T01:30:00Z',
      choice: 'earlier',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-10-25T00:30:00Z' });
  expect(
    resolveEventTime('2026-10-25T02:30:00.456', 'Europe/Berlin', {
      originalInstant: '2026-10-25T01:30:00.456Z',
      choice: 'later',
    }),
  ).toEqual({
    kind: 'unique',
    instant: '2026-10-25T01:30:00.456Z',
    preserved: true,
  });
});

test('saved ambiguous instants preselect their offset and changed wall clocks do not', () => {
  expect(
    savedAmbiguousChoice(
      '2026-10-25T02:30',
      'Europe/Berlin',
      '2026-10-25T01:30:00Z',
    ),
  ).toBe('later');
  expect(
    savedAmbiguousChoice(
      '2026-10-25T02:30',
      'Europe/Berlin',
      '2026-10-25T00:30:00Z',
    ),
  ).toBe('earlier');
  expect(
    savedAmbiguousChoice(
      '2026-10-25T02:45',
      'Europe/Berlin',
      '2026-10-25T01:30:00Z',
    ),
  ).toBe('');
  expect(
    savedAmbiguousChoice(
      '2026-07-01T18:00',
      'Europe/Berlin',
      '2026-07-01T16:00:00Z',
    ),
  ).toBe('');
});

test('an unparsable original timestamp never rejects a valid wall clock', () => {
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', {
      originalInstant: 'not-an-instant',
    }),
  ).toEqual(resolveLocalTime('2026-10-25T02:30', 'Europe/Berlin'));
  expect(
    resolveEventTime('2026-10-25T02:30', 'Europe/Berlin', {
      originalInstant: 'not-an-instant',
      choice: 'later',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-10-25T01:30:00Z' });
  expect(
    savedAmbiguousChoice('2026-10-25T02:30', 'Europe/Berlin', 'broken'),
  ).toBe('');
});

test('resource block times resolve over a date change without reusing an offset', () => {
  // Same helpers as the event form; blocks are only wall clocks plus a zone.
  expect(
    resolveEventTime('2026-11-10T10:00', 'Europe/Berlin', {
      originalInstant: '2026-10-16T16:00:00Z',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-11-10T09:00:00Z' });
  expect(
    resolveEventTime('2026-07-16T10:00', 'Europe/Berlin', {
      originalInstant: '2026-11-10T09:00:00Z',
    }),
  ).toEqual({ kind: 'unique', instant: '2026-07-16T08:00:00Z' });
  // A stored block in the repeated hour keeps its exact second-boundary
  // instant and still preselects the saved occurrence for a deliberate switch.
  expect(
    resolveEventTime('2026-10-25T02:30:00', 'Europe/Berlin', {
      originalInstant: '2026-10-25T00:30:00Z',
    }),
  ).toEqual({
    kind: 'unique',
    instant: '2026-10-25T00:30:00Z',
    preserved: true,
  });
  expect(
    savedAmbiguousChoice(
      '2026-10-25T02:30:00',
      'Europe/Berlin',
      '2026-10-25T00:30:00Z',
    ),
  ).toBe('earlier');
  expect(resolveLocalTime('2026-03-29T02:30', 'Europe/Berlin')).toEqual({
    kind: 'nonexistent',
  });
});
