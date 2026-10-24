import { chromium, expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { renderDocumentHtml } from '../../packages/core/src/document-layouts.js';
import { chromiumPdfRenderer } from '../../packages/core/src/document-pdf.js';

const layout = {
  senderName: 'Fictional Studio',
  senderStreet: 'Synthetic Street 1',
  senderPostalCode: '12345',
  senderCity: 'Fictional Town',
  primaryColor: '#2f6f4f',
  textColor: '#1b1b1b',
  fontFamily: 'sans' as const,
  showPageNumbers: true,
  showPositionNumbers: true,
};

function renderSample(linesCount: number, showPageNumbers: boolean) {
  return renderDocumentHtml({
    layout: { ...layout, showPageNumbers },
    documentNumber: 'AN-2030-0001',
    issuedAt: new Date('2030-10-26T10:00:00Z'),
    timeZone: 'Europe/Berlin',
    recipientName: 'Fictional Customer',
    recipientAddress: 'Example Street 2\n67890 Example Town',
    subject: 'Synthetic pagination diagnostic',
    introText: 'Synthetic intro.',
    outroText: 'Synthetic outro.',
    lines: Array.from({ length: linesCount }, (_, index) => ({
      description: `Fictional line ${String(index + 1).padStart(3, '0')}`,
      unit: 'Stück',
      quantity: 1,
      unitPriceMinor: 10000,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    })),
    values: {},
  });
}

test('Chromium renders conditional native page counters in generated PDFs', async ({
  page,
}) => {
  test.setTimeout(90000);
  const render = chromiumPdfRenderer({
    executablePath: chromium.executablePath(),
  });
  const enabledHtml = renderSample(140, true);
  await page.emulateMedia({ media: 'print' });
  await page.setContent(enabledHtml);
  const enabledPageRules = await page.evaluate(() =>
    Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules)
        .filter((rule) => rule.constructor.name === 'CSSPageRule')
        .map((rule) => rule.cssText),
    ),
  );
  expect(enabledPageRules).toHaveLength(1);
  expect(enabledPageRules[0]).toContain('@bottom-right');
  expect(enabledPageRules[0]).toContain('counter(page)');
  expect(enabledPageRules[0]).toContain('counter(pages)');
  expect(enabledPageRules[0]).toContain('rgb(47, 111, 79)');
  expect(enabledPageRules[0]).toContain('Helvetica Neue');
  expect(enabledPageRules[0]).toContain('padding-right: 16mm');

  const attachPdf = async (name: string, bytes: Buffer) => {
    const path = test.info().outputPath(name);
    await writeFile(path, bytes);
    await test.info().attach(name, { path, contentType: 'application/pdf' });
  };
  const multipage = await render(enabledHtml);
  expect(multipage.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  await attachPdf('pagination-enabled-multipage.pdf', multipage);

  const onePage = await render(renderSample(1, true));
  expect(onePage.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  await attachPdf('pagination-enabled-one-page.pdf', onePage);

  const disabledHtml = renderSample(140, false);
  await page.setContent(disabledHtml);
  const disabledPageRules = await page.evaluate(() =>
    Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules).filter(
        (rule) => rule.constructor.name === 'CSSPageRule',
      ),
    ),
  );
  expect(disabledPageRules).toHaveLength(0);
  const disabled = await render(disabledHtml);
  expect(disabled.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  await attachPdf('pagination-disabled-multipage.pdf', disabled);
});
