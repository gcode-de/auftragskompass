import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artifactKey,
  readDocumentPdf,
  storeDocumentPdf,
} from '../../packages/core/src/document-artifacts.js';
import {
  localStorageAdapter,
  StorageError,
} from '../../packages/core/src/storage.js';
import { contentHash } from '../../packages/core/src/document-pdf.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ak-artifacts-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('artifactKey', () => {
  test('accepts a sha256 and rejects anything else', () => {
    const hash = 'a'.repeat(64);
    expect(artifactKey(hash)).toBe(hash + '.pdf');
    for (const bad of ['abc', 'A'.repeat(64), '../' + 'a'.repeat(61)])
      expect(() => artifactKey(bad)).toThrow(StorageError);
  });
});
describe('storeDocumentPdf', () => {
  test('stores by content hash and reads the identical bytes back', async () => {
    const store = localStorageAdapter({ root }),
      bytes = Buffer.from('%PDF-1.7 fictional document', 'utf8'),
      artifact = {
        bytes,
        hash: contentHash(bytes),
        byteLength: bytes.byteLength,
      };
    const stored = await storeDocumentPdf(store, artifact);
    expect(stored.key).toBe(artifact.hash + '.pdf');
    expect(stored.byteLength).toBe(bytes.byteLength);
    expect((await readDocumentPdf(store, artifact.hash)).equals(bytes)).toBe(
      true,
    );
  });
  test('is idempotent for identical content', async () => {
    const store = localStorageAdapter({ root }),
      bytes = Buffer.from('%PDF-1.7 same', 'utf8'),
      artifact = {
        bytes,
        hash: contentHash(bytes),
        byteLength: bytes.byteLength,
      };
    await storeDocumentPdf(store, artifact);
    await expect(storeDocumentPdf(store, artifact)).resolves.toMatchObject({
      key: artifact.hash + '.pdf',
    });
  });
  test('reports a missing artefact', async () => {
    const store = localStorageAdapter({ root });
    await expect(readDocumentPdf(store, 'b'.repeat(64))).rejects.toMatchObject({
      reason: 'missing',
    });
  });
});
