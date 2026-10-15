import { expect, test } from 'vitest';
import {
  parseHundredths,
  formatHundredths,
} from '../../apps/admin/src/decimal.js';
test('decimal input uses exact integer hundredths, including the safe-integer boundary', () => {
  for (const [input, value] of [
    ['0', 0],
    ['0,01', 1],
    [' 12.3 ', 1230],
    ['19,99', 1999],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ] as const) {
    expect(parseHundredths(input)).toBe(value);
    expect(parseHundredths(formatHundredths(value))).toBe(value);
  }
  for (const input of [
    '',
    '-1',
    '1.001',
    '1,2.3',
    'NaN',
    'Infinity',
    '1e2',
    '90071992547409.92',
    '99999999999999999999',
  ])
    expect(() => parseHundredths(input)).toThrow('Ungültiger Dezimalwert');
});
