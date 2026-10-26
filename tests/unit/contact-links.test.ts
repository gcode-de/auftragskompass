import { expect, test } from 'vitest';
import {
  addressLines,
  countryLabel,
  mailtoHref,
  telHref,
} from '../../apps/admin/src/contact-links.js';

// BKP011.1: the reading contact record shows the stored value as its text and
// only escapes what would break the link. `@` stays literal (RFC 6068), no
// number is normalised and no address part is invented.
test('an e-mail link keeps the stored address readable instead of over-encoding it', () => {
  expect(mailtoHref('synthetic@example.invalid')).toBe(
    'mailto:synthetic@example.invalid',
  );
  expect(mailtoHref(' synthetic.name+tag@example.invalid ')).toBe(
    'mailto:synthetic.name+tag@example.invalid',
  );
  // Percent, space, query and fragment characters would change the meaning of
  // the URI, so they are escaped; the address itself is not rewritten.
  expect(mailtoHref('a+b%c d@example.invalid')).toBe(
    'mailto:a+b%25c%20d@example.invalid',
  );
  expect(mailtoHref('a?b#c&d@example.invalid')).toBe(
    'mailto:a%3Fb%23c%26d@example.invalid',
  );
});

test('a header injection attempt stays inside the address part', () => {
  const href = mailtoHref('x@example.invalid\r\nBcc:evil@example.invalid');
  expect(href).not.toMatch(/[\r\n]/);
  expect(href).toBe('mailto:x@example.invalid%0D%0ABcc:evil@example.invalid');
});

test('a phone link strips only formatting characters and never changes the number', () => {
  expect(telHref('030 000000')).toBe('tel:030000000');
  // Documented limit of this slice: no national-trunk normalisation, so the
  // stored number reaches the dialler exactly as stored.
  expect(telHref('+49 (0)30 1')).toBe('tel:+490301');
  expect(telHref('')).toBe('');
});

test('a country code is shown as its German name and falls back to the stored code', () => {
  expect(countryLabel('DE')).toBe('Deutschland');
  expect(countryLabel('AT')).toBe('Österreich');
  // Unknown codes stay visible instead of turning into an empty label.
  expect(countryLabel('ZZ')).toBe('ZZ');
  expect(countryLabel('D')).toBe('D');
  expect(countryLabel('')).toBe('');
});

test('the address shows only stored parts and never pretends to be complete', () => {
  expect(
    addressLines({ street: '', postalCode: '', city: '', country: 'DE' }),
  ).toEqual([]);
  expect(
    addressLines({ street: '', postalCode: '', city: '', country: 'ZZ' }),
  ).toEqual([]);
  expect(
    addressLines({
      street: 'Synthetic Street 1',
      postalCode: '',
      city: '',
      country: 'DE',
    }),
  ).toEqual(['Synthetic Street 1', 'Deutschland']);
  expect(
    addressLines({
      street: '',
      postalCode: '00000',
      city: 'Fictional City',
      country: 'DE',
    }),
  ).toEqual(['00000 Fictional City', 'Deutschland']);
  expect(
    addressLines({
      street: 'Synthetic Street 1',
      postalCode: '00000',
      city: 'Fictional City',
      country: 'ZZ',
    }),
  ).toEqual(['Synthetic Street 1', '00000 Fictional City', 'ZZ']);
});
