import { describe, expect, test } from 'vitest';
import {
  contentHash,
  DocumentPdfError,
  renderDocumentPdf,
} from '../../packages/core/src/document-pdf.js';

const pdf = Buffer.from('%PDF-1.7\nfictional document\n%%EOF');

describe('contentHash', () => {
  test('is stable for identical bytes and changes with the content', () => {
    const hash = contentHash(pdf);
    expect(hash).toBe(contentHash(Buffer.from(pdf)));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(contentHash(Buffer.from('%PDF-1.7\nother\n%%EOF')));
    expect(hash).not.toBe(contentHash(Buffer.alloc(pdf.byteLength)));
  });
});

describe('renderDocumentPdf', () => {
  test('returns the bytes, their length and a sha256 over exactly those bytes', async () => {
    const artifact = await renderDocumentPdf('<html></html>', async () => pdf);
    expect(artifact.byteLength).toBe(pdf.byteLength);
    expect(artifact.bytes.equals(pdf)).toBe(true);
    expect(artifact.hash).toBe(contentHash(pdf));
    expect(artifact.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  test('rejects empty input before touching the renderer', async () => {
    let called = false;
    for (const html of ['', '   '])
      await expect(
        renderDocumentPdf(html, async () => {
          called = true;
          return pdf;
        }),
      ).rejects.toBeInstanceOf(DocumentPdfError);
    expect(called).toBe(false);
  });
  test('turns a renderer failure into a typed error instead of leaking it', async () => {
    await expect(
      renderDocumentPdf('<html></html>', async () => {
        throw new Error('chromium crashed');
      }),
    ).rejects.toMatchObject({ reason: 'render_failed' });
  });
  test('rejects an empty or non-buffer renderer result', async () => {
    await expect(
      renderDocumentPdf('<html></html>', async () => Buffer.alloc(0)),
    ).rejects.toMatchObject({ reason: 'empty' });
    await expect(
      renderDocumentPdf('<html></html>', async () => 'not a buffer' as never),
    ).rejects.toMatchObject({ reason: 'empty' });
  });
});
