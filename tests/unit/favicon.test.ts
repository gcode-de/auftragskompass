import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const html = () => read('../../apps/admin/index.html').toString('utf8');

test('admin HTML declares the original SVG compass favicon and PNG fallback', () => {
  const source = html();
  expect(source).toContain(
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
  );
  expect(source).toContain(
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />',
  );
  expect(source).toContain('<title>AuftragsKompass</title>');
});

test('SVG favicon is self-contained 32-unit compass geometry with a title', () => {
  const svg = read('../../apps/admin/public/favicon.svg').toString('utf8');
  expect(svg).toContain('viewBox="0 0 32 32"');
  expect(svg).toContain('<title>AuftragsKompass</title>');
  expect(svg).not.toMatch(/<image\b|href=|url\(/i);
  expect(svg).toMatch(/<path[^>]+M16 5/);
  expect(svg).toMatch(/<path[^>]+M16 26/);
});

test('PNG fallback is a real 32x32 PNG', () => {
  const png = read('../../apps/admin/public/favicon-32.png');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(32);
  expect(png.readUInt32BE(20)).toBe(32);
});
