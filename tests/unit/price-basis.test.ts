import { expect, test } from 'vitest';
import { convertMinor } from '../../apps/admin/src/price-basis.js';

test('converts between net and gross in exact cents', () => {
  expect(convertMinor(10000, 1900, 'gross')).toBe(11900);
  expect(convertMinor(11900, 1900, 'net')).toBe(10000);
  // 10,00 € gross at 7 % is 9,3457… € net and rounds to the cent.
  expect(convertMinor(1000, 700, 'net')).toBe(935);
  expect(convertMinor(935, 700, 'gross')).toBe(1000);
  // A zero rate keeps the amount.
  expect(convertMinor(4200, 0, 'net')).toBe(4200);
  expect(convertMinor(0, 1900, 'gross')).toBe(0);
});

test('refuses an amount beyond the safe integer range', () => {
  expect(() => convertMinor(Number.MAX_SAFE_INTEGER, 1900, 'gross')).toThrow();
});
