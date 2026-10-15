import { expect, test } from 'vitest';
import { phoneKey, csv } from '../../packages/core/src/contacts.js';
test('phone comparison normalizes German and international notation without matching empty values', () => {
  for (const value of ['030 000000', '+49 (0)30 000000', '0049 30 000000'])
    expect(phoneKey(value, 'DE')).toBe('4930000000');
  expect(phoneKey('030 000000', 'AT')).toBe('030000000');
  expect(phoneKey('', 'DE')).toBe('');
});
test('CSV quotes fields, retains multiline text and neutralizes spreadsheet formulas', () => {
  expect(
    csv([
      ['name', 'email'],
      ['=1+1', '"Synthetic",\nfixture'],
      [' +cmd', '@bad'],
    ]),
  ).toBe(
    '\uFEFF"name","email"\r\n"\'=1+1","""Synthetic"",\nfixture"\r\n"\' +cmd","\'@bad"\r\n',
  );
});
