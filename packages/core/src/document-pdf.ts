import { createHash } from 'node:crypto';

export class DocumentPdfError extends Error {
  constructor(readonly reason: 'invalid' | 'render_failed' | 'empty') {
    super('Document PDF rejected');
  }
}

export type PdfArtifact = {
  bytes: Buffer;
  hash: string;
  byteLength: number;
};
export type PdfRenderer = (html: string) => Promise<Buffer>;

export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Orchestration only: the renderer is injected so the hash and the failure
// contract stay testable without a browser.
export async function renderDocumentPdf(
  html: string,
  render: PdfRenderer,
): Promise<PdfArtifact> {
  if (typeof html !== 'string' || !html.trim())
    throw new DocumentPdfError('invalid');
  let bytes: Buffer;
  try {
    bytes = await render(html);
  } catch {
    throw new DocumentPdfError('render_failed');
  }
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0)
    throw new DocumentPdfError('empty');
  return { bytes, hash: contentHash(bytes), byteLength: bytes.byteLength };
}

export type ChromiumOptions = {
  executablePath: string;
  timeoutMs?: number;
};

// Chromium runs inside the container, so the sandbox is disabled: keep this
// renderer on inert HTML that the document layer produced, never on input.
export function chromiumPdfRenderer(options: ChromiumOptions): PdfRenderer {
  const timeout = options.timeoutMs ?? 20_000;
  return async (html: string) => {
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: options.executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout });
      // The native Chromium template repeats the escaped HTML footer in the
      // page margin. Its counters stay below every column, including wrapped text.
      const footer = await page.evaluate(() => {
        const element = document.querySelector('footer.document-footer');
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          html: element.outerHTML,
          fontFamily: style.fontFamily,
          color: style.color,
          showPageNumbers: element.getAttribute('data-page-numbers') === 'true',
        };
      });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        margin: {
          top: '18mm',
          right: '20mm',
          bottom: footer ? '50mm' : '18mm',
          left: '20mm',
        },
        ...(footer
          ? {
              displayHeaderFooter: true,
              headerTemplate: '<div></div>',
              footerTemplate: `<style>
                #footer { padding: 0 !important; }
                .print-footer { width: 100%; margin: 0 20mm 3mm; color: ${footer.color}; font-family: ${footer.fontFamily}; font-size: 8pt; line-height: 1.1; }
                .document-footer { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2mm; overflow-wrap: anywhere; }
                .document-footer div:nth-child(2), .page-count { text-align: center; }
                .page-count { margin-top: 2mm; }
                </style>
                <div class="print-footer">
                  ${footer.html}
                  ${footer.showPageNumbers ? '<div class="page-count">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>' : ''}
                </div>`,
            }
          : {}),
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close().catch(() => {});
    }
  };
}
