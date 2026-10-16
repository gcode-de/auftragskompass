import { expect, test } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  normalizeUsername,
} from '../../packages/core/src/password.js';
test('scrypt stores salted hashes and rejects invalid passwords without truncation', async () => {
  const password = 'Fictional long password 🔐';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword(password + ' ', first)).toBe(false);
  expect(await verifyPassword(password, 'corrupt')).toBe(false);
  expect(
    await verifyPassword(password, first.replace('131072', '999999999')),
  ).toBe(false);
  for (const invalid of ['short', 'x'.repeat(129)])
    await expect(hashPassword(invalid)).rejects.toThrow();
  expect(normalizeUsername(' Fictional.Owner ')).toBe('fictional.owner');
  for (const invalid of ['', 'ab', 'has space', 'a@b.invalid', 'x'.repeat(65)])
    expect(() => normalizeUsername(invalid)).toThrow();
});
