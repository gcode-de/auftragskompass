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

function renderSample(
  linesCount: number,
  showPageNumbers: boolean,
  withFooter = false,
  { showPositionNumbers = true, longPosition = false } = {},
) {
  return renderDocumentHtml({
    layout: {
      ...layout,
      showPageNumbers,
      showPositionNumbers,
      ...(withFooter
        ? {
            footerLeft:
              'Fictional footer left\nSynthetic second\nSynthetic third\nSynthetic fourth',
            footerCenter: Array<string>(4).fill('W'.repeat(48)).join('\n'),
            footerRight: [
              'Fictional footer right',
              'https://example.invalid/' + 'W'.repeat(24),
              'W'.repeat(48),
              'W'.repeat(48),
            ].join('\n'),
          }
        : {}),
    },
    documentNumber: 'AN-2030-0001',
    issuedAt: new Date('2030-10-26T10:00:00Z'),
    timeZone: 'Europe/Berlin',
    recipientName: 'Fictional Customer',
    recipientAddress: 'Example Street 2\n67890 Example Town',
    subject: 'Synthetic pagination diagnostic',
    introText: 'Synthetic intro.',
    outroText: 'Synthetic outro.',
    lines: Array.from({ length: linesCount }, (_, index) => ({
      description: longPosition
        ? `Fictional position ${'W'.repeat(150)}`
        : `Fictional line ${String(index + 1).padStart(3, '0')}`,
      unit: 'Stück',
      quantity: 1,
      unitPriceMinor: longPosition ? Number.MAX_SAFE_INTEGER : 10000,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
      priceBasis: 'gross' as const,
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
  expect(enabledPageRules[0]).toContain('@bottom-center');
  expect(enabledPageRules[0]).toContain('counter(page)');
  expect(enabledPageRules[0]).toContain('counter(pages)');
  expect(enabledPageRules[0]).toContain('rgb(47, 111, 79)');
  expect(enabledPageRules[0]).toContain('Open Sans');

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

  const footerHtml = renderSample(140, true, true);
  await page.setContent(footerHtml);
  const footer = page.locator('.document-footer');
  await expect(footer).toHaveAttribute('data-page-numbers', 'true');
  await expect(footer.locator(':scope > div')).toHaveCount(3);
  await expect(footer).toBeHidden();
  const withFooter = await render(footerHtml);
  expect(withFooter.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  await attachPdf('pagination-with-business-footer.pdf', withFooter);

  const footerWithoutNumbers = await render(renderSample(1, false, true));
  expect(footerWithoutNumbers.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  await attachPdf(
    'pagination-business-footer-without-numbers.pdf',
    footerWithoutNumbers,
  );

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

for (const showPositionNumbers of [true, false]) {
  test(`Chromium fits long prices with position numbers ${showPositionNumbers ? 'visible' : 'hidden'}`, async ({
    page,
  }, testInfo) => {
    const html = renderSample(1, false, false, {
      showPositionNumbers,
      longPosition: true,
    });
    // A4 minus the left and right margins of the PDF renderer.
    await page.setViewportSize({
      width: Math.floor((170 * 96) / 25.4),
      height: 900,
    });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    await expect(page.locator('.positions th')).toHaveText([
      ...(showPositionNumbers ? ['Pos.'] : []),
      'Beschreibung',
      'Einzelpreis',
      'Menge',
      'Preis',
    ]);
    const cellLayouts = await page
      .locator(
        '.positions th:nth-last-child(5), .positions tbody td:nth-last-child(3), .positions tbody td:last-child',
      )
      .evaluateAll((cells) =>
        cells.map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const text = range.getBoundingClientRect();
          const bounds = cell.getBoundingClientRect();
          return {
            lines: range.getClientRects().length,
            fits:
              text.left >= bounds.left &&
              text.right <= bounds.right &&
              bounds.right <= document.documentElement.clientWidth,
          };
        }),
      );
    expect(cellLayouts).toEqual(
      Array.from({ length: showPositionNumbers ? 3 : 2 }, () => ({
        lines: 1,
        fits: true,
      })),
    );

    const render = chromiumPdfRenderer({
      executablePath: chromium.executablePath(),
    });
    const bytes = await render(html);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const path = testInfo.outputPath('positions.pdf');
    await writeFile(path, bytes);
    await testInfo.attach('positions.pdf', {
      path,
      contentType: 'application/pdf',
    });
  });
}
