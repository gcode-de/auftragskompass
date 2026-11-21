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
  priceBasis: 'gross' as const,
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
        priceBasis: 'gross' as const,
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
        priceBasis: 'gross' as const,
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
        priceBasis: 'gross' as const,
      },
      {
        quantity: 2,
        unitPriceMinor: 5000,
        taxBasisPoints: 700,
        discountBasisPoints: 0,
        priceBasis: 'gross' as const,
      },
      {
        quantity: 1,
        unitPriceMinor: 1000,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
        priceBasis: 'gross' as const,
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
    expect(html).toContain(
      '<th>Pos.</th><th>Beschreibung</th><th>Einzelpreis</th><th>Menge</th><th>Preis</th>',
    );
    expect(html).not.toContain('Rabatt');
    expect(html).toContain('font-size: 16pt');
    expect(html).toContain('font-size: 9pt');
    expect(html).toContain('167,23');
    expect(html).toContain('31,77');
    expect(html).toContain('Umsatzsteuer 19 %');
    expect(html).toContain('@bottom-center');
    expect(html).toContain('counter(page)');
    expect(html).toContain('counter(pages)');
    expect(html).not.toContain('Seite 1');
  });
  test('renders multiline position info with its service and preserves tax and numbering', () => {
    const html = renderDocumentHtml({
      ...base,
      lines: [
        {
          ...line,
          description: 'First service',
          unit: 'Stück',
          infoText: '<detail>\r\n& follow-up',
        },
        { ...line, description: 'Second service', unit: 'Stück' },
      ],
    });
    expect(html).toContain(
      '<tr><td>1</td><td>First service<br><span class="position-info-text">&lt;detail&gt;<br>&amp; follow-up</span></td><td>199,00 €</td>',
    );
    expect(html).toContain('<tr><td>2</td><td>Second service</td>');
    expect(html).toContain('398,00 €');
    expect(html).toContain('63,54 €');
  });
  test('marks optional prices and excludes them from the printed tax and totals', () => {
    const optional = {
      ...line,
      description: '<Fictional extra>',
      infoText: 'Second service detail',
      unit: 'Stück',
      taxBasisPoints: 700,
      discountBasisPoints: 5000,
      priceBasis: 'gross' as const,
      optional: true,
    };
    const note =
      'Optionale Positionen sind nicht in der Gesamtsumme berücksichtigt.';
    const html = renderDocumentHtml({
      ...base,
      lines: [...base.lines, optional],
    });
    expect(html).toContain('<td>Optional: &lt;Fictional extra&gt;');
    expect(html).toContain('Second service detail');
    expect(html).toContain('Rabatt 50 %');
    expect(html).toContain('<td>99,50 €</td>');
    expect(html).toContain(
      '<caption class="totals-note">' + note + '</caption>',
    );
    expect(html).toContain('<td>Brutto</td><td>199,00 €</td>');
    expect(html).toContain('<td>Netto</td><td>167,23 €</td>');
    expect(html).toContain('<td>Umsatzsteuer 19 %</td><td>31,77 €</td>');
    expect(html).not.toContain('Umsatzsteuer 7 %');
    expect(renderDocumentHtml(base)).not.toContain(note);

    const preview = renderDocumentHtml({ ...base, lines: [optional] });
    expect(preview).toContain(note);
    expect(preview).toContain('<td>Brutto</td><td>0,00 €</td>');
    expect(preview).not.toContain('Umsatzsteuer');
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
  test('lists one tax row per rate and keeps the discount with its position', () => {
    const html = renderDocumentHtml({
      ...base,
      lines: [
        { ...line, description: 'Fictional box', unit: 'Stück' },
        {
          quantity: 2,
          unitPriceMinor: 5000,
          taxBasisPoints: 700,
          discountBasisPoints: 500,
          priceBasis: 'gross' as const,
          description: 'Fictional extra',
          unit: 'Stunde',
        },
      ],
    });
    expect(html).toContain('Umsatzsteuer 7 %');
    expect(html).toContain('Umsatzsteuer 19 %');
    expect(html).toContain('Rabatt 5 %');
    expect(html).not.toContain('<th>Rabatt</th>');
    expect(html).toContain('<td>50,00 €</td><td>2 Stunde</td><td>95,00 €</td>');
  });
  test('prints a net position with its stored price in the unchanged layout', () => {
    const html = renderDocumentHtml({
      ...base,
      lines: [
        {
          ...line,
          priceBasis: 'net',
          description: 'Fictional net service',
          unit: 'Stück',
        },
      ],
    });
    // The printed unit price is the stored net, the row and the block stay gross.
    expect(html).toContain(
      '<td>199,00 €</td><td>1 Stück</td><td>236,81 €</td>',
    );
    expect(html).toContain('<td>Netto</td><td>199,00 €</td>');
    expect(html).toContain('<td>Umsatzsteuer 19 %</td><td>37,81 €</td>');
    expect(html).toContain('<td>Brutto</td><td>236,81 €</td>');
    // A net position adds no CSS rule: the style block stays byte-identical.
    const styles = (markup: string) =>
      markup.slice(markup.indexOf('<style>'), markup.indexOf('</style>'));
    expect(styles(html)).toBe(styles(renderDocumentHtml(base)));
  });
  test('prints an amount discount in place of the percentage, without a new style', () => {
    const html = renderDocumentHtml({
      ...base,
      lines: [
        {
          ...line,
          description: 'Fictional amount discount',
          unit: 'Stück',
          discountAmountMinor: 1234,
        },
      ],
    });
    // DOC-PRODUCT-01.4: the same span as the percentage, only the amount.
    expect(html).toContain(
      '<span class="position-discount">Rabatt 12,34 €</span>',
    );
    expect(html).not.toContain('Rabatt 0 %');
    // The row prints the reduced price and the block the same reduced totals.
    expect(html).toContain('<td>186,66 €</td>');
    expect(html).toContain('<td>Brutto</td><td>186,66 €</td>');
    const styles = (markup: string) =>
      markup.slice(markup.indexOf('<style>'), markup.indexOf('</style>'));
    expect(styles(html)).toBe(styles(renderDocumentHtml(base)));
  });
  test('keeps a percentage position byte-identical to the amount-free render', () => {
    const percentLine = {
        ...line,
        taxBasisPoints: 700,
        discountBasisPoints: 500,
        description: 'Fictional percent',
        unit: 'Stück',
      },
      withoutField = renderDocumentHtml({
        ...base,
        lines: [percentLine],
      });
    expect(withoutField).toContain('Rabatt 5 %');
    expect(withoutField).not.toContain('Rabatt 0,00 €');
    expect(
      renderDocumentHtml({
        ...base,
        lines: [{ ...percentLine, discountAmountMinor: null }],
      }),
    ).toBe(withoutField);
  });
  test('escapes footer text in HTML and passes through the page-number setting', () => {
    const html = renderDocumentHtml({
      ...base,
      layout: {
        ...layout,
        showPageNumbers: false,
        footerLeft: 'Example & Fictional\nFictional Town',
        footerCenter: '',
        footerRight: '</style><script>bad</script>"\\',
      },
    });
    expect(html).toContain('data-page-numbers="false"');
    expect(html).toContain('<div></div>');
    expect(html).toContain('Example &amp; Fictional<br>Fictional Town');
    expect(html).toContain('&lt;/style&gt;&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('counter(page)');
  });
  test('refuses to render when a referenced placeholder has no value', () => {
    expect(() =>
      renderDocumentHtml({ ...base, values: { contact: 'Fictional' } }),
    ).toThrow();
  });
  // DOC-PRODUCT-01.5: the comment-level discount prints below the sum block.
  // Without one, not a single byte moves - not one CSS rule either.
  describe('total document discount', () => {
    const discounted = {
      ...base,
      layout: {
        ...layout,
        totalDiscount: {
          kind: 'amount' as const,
          value: 1900,
          discountMinor: 1900,
          payableMinor: 18000,
        },
      },
    };
    const styles = (markup: string) =>
      markup.slice(markup.indexOf('<style>'), markup.indexOf('</style>'));

    test('prints the discount and the payable amount under the sum block', () => {
      const html = renderDocumentHtml(discounted);
      expect(html).toContain(
        '      <tr><td>Gesamtrabatt</td><td>-19,00 €</td></tr>',
      );
      expect(html).toContain(
        '      <tr><td>Zu zahlender Betrag</td><td>180,00 €</td></tr>',
      );
      // The position sums stay exactly where they were.
      expect(html).toContain('<td>Netto</td><td>167,23 €</td>');
      expect(html).toContain('<td>Brutto</td><td>199,00 €</td>');
      expect(styles(html)).toBe(styles(renderDocumentHtml(base)));
    });

    test('keeps a document without a discount byte-identical', () => {
      expect(renderDocumentHtml({ ...base })).toBe(renderDocumentHtml(base));
      expect(renderDocumentHtml(base)).not.toContain('Gesamtrabatt');
      expect(renderDocumentHtml(base)).not.toContain('Zu zahlender Betrag');
    });

    test('escapes a multi-line note and breaks it like the printed account', () => {
      const html = renderDocumentHtml({
        ...discounted,
        layout: {
          ...discounted.layout,
          totalDiscount: {
            ...discounted.layout.totalDiscount,
            note: '<Treuerabatt>\nZeile & zwei',
          },
        },
      });
      expect(html).toContain(
        '<tr><td>Gesamtrabatt (&lt;Treuerabatt&gt;<br>Zeile &amp; zwei)</td><td>-19,00 €</td></tr>',
      );
      expect(html).not.toContain('<Treuerabatt>');
    });

    test('leaves the final payable line to a settlement or correction block', () => {
      const settled = renderDocumentHtml({
        ...discounted,
        layout: {
          ...discounted.layout,
          depositReference: {
            number: 'AB-2030-0001',
            date: '26.10.2030',
            appliedMinor: 5000,
            paidMinor: 0,
            payableMinor: 13000,
          },
        },
      });
      expect(settled).toContain(
        '<tr><td>Gesamtrabatt</td><td>-19,00 €</td></tr>',
      );
      // One authoritative payable line, not two contradicting ones.
      expect(settled.match(/Zu zahlender Betrag/g)).toHaveLength(1);
      expect(settled).toContain(
        '<tr><td>Zu zahlender Betrag</td><td>130,00 €</td></tr>',
      );
      const corrected = renderDocumentHtml({
        ...discounted,
        layout: {
          ...discounted.layout,
          correctionReference: {
            number: 'RE-2030-0001',
            date: '26.10.2030',
            direction: 'credit',
            sourcePayableMinor: 19900,
            correctionPayableMinor: 18000,
            correctedPayableMinor: 1900,
          },
        },
      });
      expect(corrected).toContain(
        '<tr><td>Gesamtrabatt</td><td>19,00 €</td></tr>',
      );
      expect(corrected).not.toContain('Zu zahlender Betrag');
    });
  });
  // DOC-EVENTINFO-01: the event line under the heading. The observed reference
  // only ever showed the day; the name and the place are the GOAL requirement,
  // and every part that is not known stays away instead of being invented.
  describe('event line', () => {
    const plain: DocumentRenderInput = {
        ...base,
        subject: 'Angebot',
        introText: 'Einleitung',
        outroText: 'Schluss',
        values: {},
      },
      lineOf = (html: string) => {
        const match = html.match(/<p>(für das Event[^<]*)<\/p>/);
        return match ? match[1]! : null;
      },
      render = (values: DocumentRenderInput['values']) =>
        renderDocumentHtml({ ...plain, values });

    test('prints name, day and place in that order under the heading', () => {
      const html = render({
        event: 'Fiktive Hochzeit',
        date: '14.11.2030',
        location: 'Fiktiver Saal',
      });
      expect(lineOf(html)).toBe(
        'für das Event Fiktive Hochzeit am 14.11.2030 in Fiktiver Saal',
      );
      // Below the heading and above the intro, never inside the title line.
      expect(html.indexOf('für das Event')).toBeGreaterThan(
        html.indexOf('</h1>'),
      );
      expect(html.indexOf('für das Event')).toBeLessThan(
        html.indexOf('<p>Einleitung</p>'),
      );
    });

    test('prints only the parts that are known', () => {
      expect(lineOf(render({ date: '14.11.2030' }))).toBe(
        'für das Event am 14.11.2030',
      );
      expect(lineOf(render({ event: 'Fiktive Hochzeit' }))).toBe(
        'für das Event Fiktive Hochzeit',
      );
      expect(lineOf(render({ location: 'Fiktiver Saal' }))).toBe(
        'für das Event in Fiktiver Saal',
      );
      expect(
        lineOf(render({ event: 'Fiktive Hochzeit', date: '14.11.2030' })),
      ).toBe('für das Event Fiktive Hochzeit am 14.11.2030');
      expect(
        lineOf(
          render({ event: 'Fiktive Hochzeit', location: 'Fiktiver Saal' }),
        ),
      ).toBe('für das Event Fiktive Hochzeit in Fiktiver Saal');
      expect(
        lineOf(render({ date: '14.11.2030', location: 'Fiktiver Saal' })),
      ).toBe('für das Event am 14.11.2030 in Fiktiver Saal');
    });

    test('trims and escapes every part like any other printed text', () => {
      const html = render({
        event: '  <Fiktive> & "Hochzeit"  ',
        date: ' 14.11.2030 ',
        location: '\n Saal & 1 \n',
      });
      expect(lineOf(html)).toBe(
        'für das Event &lt;Fiktive&gt; &amp; &quot;Hochzeit&quot; am 14.11.2030 in Saal &amp; 1',
      );
      expect(html).not.toContain('<Fiktive>');
    });

    test('prints no line and moves not one byte without event data', () => {
      const html = render({ contact: 'Fictional Customer' });
      expect(lineOf(html)).toBeNull();
      expect(html).not.toContain('für das Event');
      // The insertion point stays untouched: the heading, then the intro.
      expect(html).toContain('    </div>\n    <p>Einleitung</p>');
      expect(html).toBe(
        renderDocumentHtml({
          ...plain,
          values: { contact: 'Fictional Customer' },
        }),
      );
    });
  });
});
