import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const prefix = 'scrypt:131072:8:1';
// OWASP scrypt baseline; fixed parameters also bound work for malformed stored hashes.
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 160 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export function normalizeUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized))
    throw new Error('Invalid username');
  return normalized;
}
export async function hashPassword(password: string) {
  if ([...password].length < 15 || password.length > 128)
    throw new Error('Password must contain 15–128 characters');
  const salt = randomBytes(16).toString('hex');
  return `${prefix}:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
// Unknown accounts take the same expensive path without creating database rows.
const dummy = `${prefix}:${'0'.repeat(32)}:${'0'.repeat(128)}`;
export async function verifyPassword(password: string, encoded = dummy) {
  const valid = /^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded);
  const parts = (valid ? encoded : dummy).split(':');
  const key = await derive(password, parts[4]!);
  return timingSafeEqual(key, Buffer.from(parts[5]!, 'hex')) && valid;
}
