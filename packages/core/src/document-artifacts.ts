import type { StorageAdapter } from './storage.js';
import { StorageError } from './storage.js';
import type { PdfArtifact } from './document-pdf.js';

export const hashPattern = /^[a-f0-9]{64}$/;

// Content addressing: the hash is the name, so writing the same document twice
// is idempotent and a changed document can never overwrite an older one.
export function artifactKey(hash: string): string {
  if (!hashPattern.test(hash)) throw new StorageError('invalid_key');
  return hash + '.pdf';
}

export async function storeDocumentPdf(
  store: StorageAdapter,
  artifact: PdfArtifact,
): Promise<{ key: string; hash: string; byteLength: number }> {
  const key = artifactKey(artifact.hash);
  await store.put(key, artifact.bytes);
  return { key, hash: artifact.hash, byteLength: artifact.byteLength };
}

export async function readDocumentPdf(
  store: StorageAdapter,
  hash: string,
): Promise<Buffer> {
  return store.read(artifactKey(hash));
}
