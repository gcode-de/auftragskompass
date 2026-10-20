import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertStorageKey,
  localStorageAdapter,
  StorageError,
} from '../../packages/core/src/storage.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ak-storage-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('assertStorageKey', () => {
  test('accepts plain file names and rejects anything that could escape', () => {
    for (const key of ['doc-1.pdf', 'a_b.c', 'x9'])
      expect(() => assertStorageKey(key)).not.toThrow();
    for (const key of ['../x', 'a/b', '', '.hidden', 'Upper.pdf', 'a..b'])
      expect(() => assertStorageKey(key)).toThrow(StorageError);
  });
});
describe('localStorageAdapter', () => {
  test('round-trips bytes and writes owner-only files', async () => {
    const store = localStorageAdapter({ root }),
      bytes = Buffer.from('%PDF-1.7 fictional', 'utf8');
    await store.put('doc-1.pdf', bytes);
    expect((await store.read('doc-1.pdf')).equals(bytes)).toBe(true);
    expect((await stat(join(root, 'doc-1.pdf'))).mode & 0o777).toBe(0o600);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
  });
  test('reports a missing object without leaking the path', async () => {
    const store = localStorageAdapter({ root });
    await expect(store.read('missing.pdf')).rejects.toMatchObject({
      reason: 'missing',
    });
  });
  test('refuses oversized writes and leaves no temporary file behind', async () => {
    const store = localStorageAdapter({ root, maxBytes: 4 });
    await expect(store.put('big.pdf', Buffer.alloc(5))).rejects.toMatchObject({
      reason: 'too_large',
    });
    expect(await readdir(root)).toEqual([]);
  });
  test('refuses a traversal key before touching the filesystem', async () => {
    const store = localStorageAdapter({ root });
    await expect(store.put('../x', Buffer.alloc(1))).rejects.toMatchObject({
      reason: 'invalid_key',
    });
    expect(await readdir(root)).toEqual([]);
  });
  test('removes idempotently', async () => {
    const store = localStorageAdapter({ root });
    await store.put('doc.pdf', Buffer.alloc(1));
    await store.remove('doc.pdf');
    await expect(store.remove('doc.pdf')).resolves.toBeUndefined();
    expect(await readdir(root)).toEqual([]);
  });
});
