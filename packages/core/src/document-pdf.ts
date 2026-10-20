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
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close().catch(() => {});
    }
  };
}
