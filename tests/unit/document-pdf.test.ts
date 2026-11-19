import { describe, expect, test, vi } from 'vitest';
import {
  chromiumPdfRenderer,
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

test('the Chromium adapter repeats escaped footers and reserves room independently of the page counter', async () => {
  const pdfOptions = vi.fn<(_options: unknown) => Promise<Buffer>>(
      async () => pdf,
    ),
    close = vi.fn(async () => {}),
    evaluate = async (read: () => unknown) => read(),
    newPage = async () => ({
      setContent: async () => {},
      evaluate,
      pdf: pdfOptions,
    });
  vi.doMock('../../packages/core/node_modules/puppeteer-core', () => ({
    default: { launch: async () => ({ newPage, close }) },
  }));

  const render = chromiumPdfRenderer({ executablePath: '/fictional/chromium' });
  try {
    vi.stubGlobal('document', { querySelector: () => null });
    await expect(render('<html></html>')).resolves.toEqual(pdf);
    expect(pdfOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        margin: expect.objectContaining({ bottom: '18mm' }),
      }),
    );
    vi.stubGlobal('getComputedStyle', () => ({
      fontFamily: '"Open Sans"',
      color: 'rgb(0, 0, 0)',
    }));
    const outerHTML =
      '<footer class="document-footer"><div>&lt;Studio&gt;</div></footer>';
    for (const showPageNumbers of [false, true]) {
      vi.stubGlobal('document', {
        querySelector: () => ({
          outerHTML,
          getAttribute: () => String(showPageNumbers),
        }),
      });
      await expect(render(outerHTML)).resolves.toEqual(pdf);
      const options = pdfOptions.mock.lastCall?.[0] as {
        displayHeaderFooter: boolean;
        headerTemplate: string;
        footerTemplate: string;
        margin: { bottom: string };
      };
      expect(options.displayHeaderFooter).toBe(true);
      expect(options.headerTemplate).toBe('<div></div>');
      expect(options.footerTemplate).toContain(outerHTML);
      expect(options.footerTemplate.includes('class="pageNumber"')).toBe(
        showPageNumbers,
      );
      expect(options.margin.bottom).toBe('50mm');
    }
    expect(close).toHaveBeenCalledTimes(3);
  } finally {
    vi.unstubAllGlobals();
    vi.doUnmock('../../packages/core/node_modules/puppeteer-core');
  }
});
