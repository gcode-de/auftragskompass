import { expect, test } from 'vitest';
import {
  sanitizeNotes,
  validateSchedule,
} from '../../packages/core/src/events.js';
import { toInstant, fromInstant } from '../../apps/admin/src/event-time.js';
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
test('local event times use tenant timezone, reject DST gaps and require offsets for repeated hours', () => {
  expect(toInstant('', 'Europe/Berlin')).toBeNull();
  expect(fromInstant(null, 'Europe/Berlin')).toEqual({ value: '', offset: '' });
  expect(toInstant('2026-07-01T18:00', 'Europe/Berlin')).toBe(
    '2026-07-01T16:00:00Z',
  );
  expect(() => toInstant('2026-03-29T02:30', 'Europe/Berlin')).toThrow();
  expect(() => toInstant('2026-10-25T02:30', 'Europe/Berlin')).toThrow();
  expect(toInstant('2026-10-25T02:30', 'Europe/Berlin', '+02:00')).toBe(
    '2026-10-25T00:30:00Z',
  );
  expect(toInstant('2026-10-25T02:30', 'Europe/Berlin', '+01:00')).toBe(
    '2026-10-25T01:30:00Z',
  );
  expect(fromInstant('2026-10-25T01:30:00Z', 'Europe/Berlin')).toEqual({
    value: '2026-10-25T02:30:00',
    offset: '+01:00',
  });
});

test('oversized sanitized notes fail safely', () => {
  expect(() => sanitizeNotes('&'.repeat(20000))).toThrow('invalid_notes');
});
