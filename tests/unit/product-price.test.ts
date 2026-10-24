import { expect, test } from 'vitest';
import { grossProductPrice } from '../../apps/admin/src/product-price.js';

test('net product price converts to gross with exact integer tax', () => {
  expect(grossProductPrice(10000, 'net', 1900)).toBe(11900);
  expect(grossProductPrice(10000, 'net', 0)).toBe(10000);
  expect(grossProductPrice(0, 'net', 1900)).toBe(0);
});

test('gross product price remains unchanged regardless of its tax rate', () => {
  expect(grossProductPrice(11900, 'gross', 1900)).toBe(11900);
  expect(grossProductPrice(11900, 'gross', 0)).toBe(11900);
});

test('net product conversion rounds half cents up exactly', () => {
  expect(grossProductPrice(1, 'net', 5000)).toBe(2);
  expect(grossProductPrice(1, 'net', 4999)).toBe(1);
});

test('gross price at the safe integer boundary remains exact', () => {
  expect(grossProductPrice(Number.MAX_SAFE_INTEGER, 'gross', 1900)).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  expect(grossProductPrice(Number.MAX_SAFE_INTEGER, 'net', 0)).toBe(
    Number.MAX_SAFE_INTEGER,
  );
});

test('net conversion overflow and invalid product money values are rejected', () => {
  expect(() => grossProductPrice(Number.MAX_SAFE_INTEGER, 'net', 1)).toThrow();
  expect(() => grossProductPrice(-1, 'gross', 0)).toThrow();
  expect(() =>
    grossProductPrice(Number.MAX_SAFE_INTEGER + 1, 'gross', 0),
  ).toThrow();
  expect(() => grossProductPrice(1.5, 'gross', 0)).toThrow();
  expect(() => grossProductPrice(100, 'net', -1)).toThrow();
  expect(() => grossProductPrice(100, 'net', 1.5)).toThrow();
  expect(() => grossProductPrice(100, 'net', 10001)).toThrow();
  expect(() => grossProductPrice(100, 'other', 0)).toThrow();
});
