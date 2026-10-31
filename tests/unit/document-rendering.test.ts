import { describe, expect, test } from 'vitest';
import {
  assertTotalsConsistent,
  documentTotals,
  DocumentTotalsError,
  formatDocumentDate,
  formatMinorUnits,
  lineTotals,
} from '../../packages/core/src/document-totals.js';
import {
  escapeHtml,
  renderDocumentHtml,
  type DocumentRenderInput,
} from '../../packages/core/src/document-layouts.js';

const line = {
  quantity: 1,
  unitPriceMinor: 19900,
  taxBasisPoints: 1900,
  discountBasisPoints: 0,
};
describe('lineTotals', () => {
  test('extracts the tax from a gross price without drifting a cent', () => {
    expect(lineTotals(line)).toEqual({
      grossMinor: 19900,
      netMinor: 16723,
      taxMinor: 3177,
    });
  });
  test('applies the discount to the gross before the tax', () => {
    expect(
      lineTotals({ ...line, unitPriceMinor: 10000, discountBasisPoints: 500 }),
    ).toEqual({ grossMinor: 9500, netMinor: 7983, taxMinor: 1517 });
  });
  test('multiplies quantity before rounding', () => {
    expect(
      lineTotals({
        quantity: 3,
        unitPriceMinor: 333,
        taxBasisPoints: 700,
        discountBasisPoints: 0,
      }),
    ).toEqual({ grossMinor: 999, netMinor: 934, taxMinor: 65 });
  });
  test('handles a zero rate and a full discount', () => {
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: 5000,
        taxBasisPoints: 0,
        discountBasisPoints: 0,
      }),
    ).toEqual({ grossMinor: 5000, netMinor: 5000, taxMinor: 0 });
    expect(lineTotals({ ...line, discountBasisPoints: 10000 })).toEqual({
      grossMinor: 0,
      netMinor: 0,
      taxMinor: 0,
    });
  });
  test('rejects impossible input instead of guessing', () => {
    for (const broken of [
      { ...line, quantity: 0 },
      { ...line, quantity: -1 },
      { ...line, quantity: 1.5 },
      { ...line, unitPriceMinor: -1 },
      { ...line, discountBasisPoints: 10001 },
      { ...line, discountBasisPoints: -1 },
      { ...line, taxBasisPoints: 10001 },
      { ...line, quantity: 2, unitPriceMinor: Number.MAX_SAFE_INTEGER },
    ])
      expect(() => lineTotals(broken)).toThrow(DocumentTotalsError);
  });
});
describe('documentTotals', () => {
  test('sums lines and groups them by tax rate in ascending order', () => {
    const totals = documentTotals([
      {
        quantity: 1,
        unitPriceMinor: 19900,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
      {
        quantity: 2,
        unitPriceMinor: 5000,
        taxBasisPoints: 700,
        discountBasisPoints: 0,
      },
      {
        quantity: 1,
        unitPriceMinor: 1000,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ]);
    expect(totals.taxGroups.map((group) => group.taxBasisPoints)).toEqual([
      700, 1900,
    ]);
    expect(totals.netMinor + totals.taxMinor).toBe(totals.grossMinor);
    expect(totals.grossMinor).toBe(19900 + 10000 + 1000);
    expect(totals.lines).toHaveLength(3);
    expect(() => assertTotalsConsistent(totals)).not.toThrow();
  });
  test('an empty document is consistently zero', () => {
    const totals = documentTotals([]);
    expect(totals).toMatchObject({ netMinor: 0, taxMinor: 0, grossMinor: 0 });
    expect(totals.taxGroups).toEqual([]);
    expect(() => assertTotalsConsistent(totals)).not.toThrow();
  });
});
describe('formatMinorUnits', () => {
  test('groups thousands and keeps two decimals', () => {
    expect(formatMinorUnits(0)).toBe('0,00');
    expect(formatMinorUnits(5)).toBe('0,05');
    expect(formatMinorUnits(123456)).toBe('1.234,56');
    expect(formatMinorUnits(123456789)).toBe('1.234.567,89');
    expect(formatMinorUnits(-123456)).toBe('-1.234,56');
  });
  test('rejects a value that cannot represent an exact amount', () => {
    expect(() => formatMinorUnits(1.5)).toThrow(DocumentTotalsError);
  });
});
describe('formatDocumentDate', () => {
  test('renders the day in the tenant timezone across a year boundary', () => {
    expect(
      formatDocumentDate(new Date('2030-12-31T23:30:00Z'), 'Europe/Berlin'),
    ).toBe('01.01.2031');
    expect(formatDocumentDate(new Date('2030-12-31T23:30:00Z'), 'UTC')).toBe(
      '31.12.2030',
    );
  });
});
describe('escapeHtml', () => {
  test('neutralises every character that could break out of markup', () => {
    expect(escapeHtml('<script>"a"&b\'c\'</script>')).toBe(
      '&lt;script&gt;&quot;a&quot;&amp;b&#39;c&#39;&lt;/script&gt;',
    );
  });
});
describe('renderDocumentHtml', () => {
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
    },
    base: DocumentRenderInput = {
      layout,
      documentNumber: 'AN-2030-0001',
      issuedAt: new Date('2030-10-26T10:00:00Z'),
      timeZone: 'Europe/Berlin',
      recipientName: 'Fictional Customer',
      recipientAddress: 'Example Street 2\n67890 Example Town',
      subject: 'Angebot für {{contact}}',
      introText: 'Hallo {{contact}},',
      outroText: 'Termin am {{date}}.',
      lines: [{ ...line, description: 'Fictional box', unit: 'Stück' }],
      values: {
        contact: 'Fictional Customer',
        date: '27.10.2030',
      },
    };
  test('renders a deterministic document with number, date and totals', () => {
    const html = renderDocumentHtml(base);
    expect(html).toBe(renderDocumentHtml(base));
    expect(html).toContain('Nummer AN-2030-0001');
    expect(html).toContain('Datum 26.10.2030');
    expect(html).toContain('Angebot für Fictional Customer');
    expect(html).toContain(
      'Fictional Studio · Synthetic Street 1 · 12345 Fictional Town',
    );
    expect(html).not.toMatch(/undefined|NaN/);
    expect(html).toContain('199,00');
    expect(html).toContain('167,23');
    expect(html).toContain('31,77');
    expect(html).toContain('Umsatzsteuer 19 %');
    expect(html).toContain('@bottom-right');
    expect(html).toContain('counter(page)');
    expect(html).toContain('counter(pages)');
    expect(html).not.toContain('Seite 1');
  });
  test('embeds a logo as a data uri only when one is configured', () => {
    expect(renderDocumentHtml(base)).not.toContain('class="logo"');
    const html = renderDocumentHtml({
      ...base,
      logoDataUri: 'data:image/png;base64,QUJD',
    });
    expect(html).toContain(
      '<img class="logo" src="data:image/png;base64,QUJD" alt="">',
    );
  });
  test('uses a restrained print layout with a right-aligned, bounded logo', () => {
    const html = renderDocumentHtml(base);
    expect(html).toContain('margin-left: auto');
    expect(html).toContain('max-width: 50mm');
    expect(html).toContain('thead { background: #eeeeee; }');
    expect(html).toContain('.totals tr:last-child { background: #eeeeee;');
  });
  test('escapes description, recipient and placeholders so nothing breaks out', () => {
    const html = renderDocumentHtml({
      ...base,
      recipientName: '<img src=x onerror=alert(1)>',
      lines: [
        {
          ...line,
          description: '<b>Fictional</b> & "box"',
          unit: 'Stück',
        },
      ],
      values: { contact: '<script>boom</script>', date: '27.10.2030' },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain(
      '&lt;b&gt;Fictional&lt;/b&gt; &amp; &quot;box&quot;',
    );
    expect(html).toContain('Angebot für &lt;script&gt;boom&lt;/script&gt;');
  });
  test('omits position numbers and page numbers when the layout disables them', () => {
    const html = renderDocumentHtml({
      ...base,
      layout: {
        ...layout,
        showPageNumbers: false,
        showPositionNumbers: false,
      },
    });
    expect(html).not.toContain('<th>Pos.</th>');
    expect(html).not.toContain('@page');
    expect(html).not.toContain('Seite 1');
  });
  test('lists one tax row per rate and shows the discount column value', () => {
    const html = renderDocumentHtml({
      ...base,
      lines: [
        { ...line, description: 'Fictional box', unit: 'Stück' },
        {
          quantity: 2,
          unitPriceMinor: 5000,
          taxBasisPoints: 700,
          discountBasisPoints: 500,
          description: 'Fictional extra',
          unit: 'Stunde',
        },
      ],
    });
    expect(html).toContain('Umsatzsteuer 7 %');
    expect(html).toContain('Umsatzsteuer 19 %');
    expect(html).toContain('<td>5 %</td>');
    expect(html).toContain('<td>95,00</td>');
  });
  test('refuses to render when a referenced placeholder has no value', () => {
    expect(() =>
      renderDocumentHtml({ ...base, values: { contact: 'Fictional' } }),
    ).toThrow();
  });
});
