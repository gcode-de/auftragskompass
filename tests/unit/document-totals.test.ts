import { describe, expect, test } from 'vitest';
import {
  assertTotalsConsistent,
  DocumentTotalsError,
  documentTotals,
  lineTotals,
} from '../../packages/core/src/document-totals.js';

function expectOverflow(operation: () => unknown) {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DocumentTotalsError);
  expect(error).toMatchObject({ reason: 'overflow' });
}

describe('exact document totals', () => {
  test('keeps a maximum safe gross amount exact with no discount', () => {
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
        taxBasisPoints: 0,
        discountBasisPoints: 0,
        priceBasis: 'gross' as const,
      }),
    ).toEqual({
      grossMinor: Number.MAX_SAFE_INTEGER,
      netMinor: Number.MAX_SAFE_INTEGER,
      taxMinor: 0,
    });
  });

  test('extracts tax from a large gross amount without losing a cent', () => {
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: Number.MAX_SAFE_INTEGER - 1,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
        priceBasis: 'gross' as const,
      }),
    ).toEqual({
      grossMinor: Number.MAX_SAFE_INTEGER - 1,
      netMinor: 7569075003984025,
      taxMinor: 1438124250756965,
    });
  });

  test('rounds a large gross discount using the full integer product', () => {
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
        taxBasisPoints: 0,
        discountBasisPoints: 5000,
        priceBasis: 'gross' as const,
      }),
    ).toEqual({
      grossMinor: 4503599627370496,
      netMinor: 4503599627370496,
      taxMinor: 0,
    });
  });

  test('rounds discount and tax half-cents away from zero', () => {
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: 3,
        taxBasisPoints: 10000,
        discountBasisPoints: 5000,
        priceBasis: 'gross' as const,
      }),
    ).toEqual({ grossMinor: 2, netMinor: 1, taxMinor: 1 });
  });

  test('rounds tax with the odd 10001 denominator at the half-cent boundary', () => {
    const totals = (gross: number) =>
      lineTotals({
        quantity: 1,
        unitPriceMinor: gross,
        taxBasisPoints: 1,
        discountBasisPoints: 0,
        priceBasis: 'gross' as const,
      });

    expect(totals(5000)).toEqual({
      grossMinor: 5000,
      netMinor: 5000,
      taxMinor: 0,
    });
    expect(totals(5001)).toEqual({
      grossMinor: 5001,
      netMinor: 5000,
      taxMinor: 1,
    });
  });

  test('calculates optional line amounts without totaling their discounts or taxes', () => {
    const service = {
      quantity: 1,
      unitPriceMinor: 11900,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
      priceBasis: 'gross' as const,
    };
    const optional = {
      ...service,
      quantity: 2,
      unitPriceMinor: 10000,
      taxBasisPoints: 700,
      discountBasisPoints: 2000,
      priceBasis: 'gross' as const,
      optional: true,
    };
    expect(documentTotals([service, optional])).toEqual({
      lines: [
        { grossMinor: 11900, netMinor: 10000, taxMinor: 1900 },
        { grossMinor: 16000, netMinor: 14953, taxMinor: 1047 },
      ],
      taxGroups: [
        {
          taxBasisPoints: 1900,
          grossMinor: 11900,
          netMinor: 10000,
          taxMinor: 1900,
        },
      ],
      grossMinor: 11900,
      netMinor: 10000,
      taxMinor: 1900,
    });
    expectOverflow(() =>
      documentTotals([
        { ...optional, unitPriceMinor: Number.MAX_SAFE_INTEGER },
      ]),
    );
  });

  test('rejects unsafe tax-group and document sums', () => {
    const line = {
      quantity: 1,
      unitPriceMinor: Number.MAX_SAFE_INTEGER,
      taxBasisPoints: 0,
      discountBasisPoints: 0,
      priceBasis: 'gross' as const,
    };
    expectOverflow(() =>
      documentTotals([line, { ...line, unitPriceMinor: 1 }]),
    );
  });

  test('rejects aggregate overflow across individually safe tax groups', () => {
    expectOverflow(() =>
      documentTotals([
        {
          quantity: 1,
          unitPriceMinor: Number.MAX_SAFE_INTEGER,
          taxBasisPoints: 0,
          discountBasisPoints: 0,
          priceBasis: 'gross' as const,
        },
        {
          quantity: 1,
          unitPriceMinor: 1,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
          priceBasis: 'gross' as const,
        },
      ]),
    );
  });

  test('adds multiple large lines exactly while the result remains safe', () => {
    const line = {
      quantity: 1,
      unitPriceMinor: 4_500_000_000_000_000,
      taxBasisPoints: 0,
      discountBasisPoints: 0,
      priceBasis: 'gross' as const,
    };
    expect(documentTotals([line, line])).toMatchObject({
      netMinor: 9_000_000_000_000_000,
      taxMinor: 0,
      grossMinor: 9_000_000_000_000_000,
      taxGroups: [
        {
          taxBasisPoints: 0,
          netMinor: 9_000_000_000_000_000,
          taxMinor: 0,
          grossMinor: 9_000_000_000_000_000,
        },
      ],
    });
  });
});

describe('net price basis', () => {
  const net = {
    quantity: 1,
    unitPriceMinor: 10000,
    taxBasisPoints: 1900,
    discountBasisPoints: 0,
    priceBasis: 'net' as const,
  };

  test('adds the tax to a net price instead of extracting it', () => {
    expect(lineTotals(net)).toEqual({
      grossMinor: 11900,
      netMinor: 10000,
      taxMinor: 1900,
    });
    // The same numbers as a gross price keep the old meaning.
    expect(lineTotals({ ...net, priceBasis: 'gross' })).toEqual({
      grossMinor: 10000,
      netMinor: 8403,
      taxMinor: 1597,
    });
  });

  test('keeps a zero rate and a full discount exact on a net price', () => {
    expect(lineTotals({ ...net, taxBasisPoints: 0 })).toEqual({
      grossMinor: 10000,
      netMinor: 10000,
      taxMinor: 0,
    });
    expect(lineTotals({ ...net, discountBasisPoints: 10000 })).toEqual({
      grossMinor: 0,
      netMinor: 0,
      taxMinor: 0,
    });
  });

  test('applies the discount to the net price before the tax', () => {
    expect(lineTotals({ ...net, discountBasisPoints: 5000 })).toEqual({
      grossMinor: 5950,
      netMinor: 5000,
      taxMinor: 950,
    });
  });

  test('multiplies the quantity before rounding the net and the tax', () => {
    expect(
      lineTotals({
        ...net,
        quantity: 3,
        unitPriceMinor: 333,
        taxBasisPoints: 700,
      }),
    ).toEqual({ grossMinor: 1069, netMinor: 999, taxMinor: 70 });
  });

  test('rounds a net line where a gross line would round differently', () => {
    // One cent of tax divides evenly out of a gross price but not onto a net one.
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: 3,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
        priceBasis: 'gross' as const,
      }),
    ).toEqual({ grossMinor: 3, netMinor: 3, taxMinor: 0 });
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: 3,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
        priceBasis: 'net',
      }),
    ).toEqual({ grossMinor: 4, netMinor: 3, taxMinor: 1 });
  });

  test('rejects an unknown price basis instead of guessing one', () => {
    expect(() =>
      lineTotals({ ...net, priceBasis: 'netto' as unknown as 'net' }),
    ).toThrow(DocumentTotalsError);
    try {
      lineTotals({ ...net, priceBasis: 'netto' as unknown as 'net' });
    } catch (error) {
      expect(error).toMatchObject({ reason: 'invalid' });
    }
  });

  test('groups mixed bases by rate and sums both exactly', () => {
    const totals = documentTotals([
      { ...net, priceBasis: 'gross' } as const,
      net,
    ]);
    expect(totals).toEqual({
      lines: [
        { grossMinor: 10000, netMinor: 8403, taxMinor: 1597 },
        { grossMinor: 11900, netMinor: 10000, taxMinor: 1900 },
      ],
      taxGroups: [
        {
          taxBasisPoints: 1900,
          grossMinor: 21900,
          netMinor: 18403,
          taxMinor: 3497,
        },
      ],
      grossMinor: 21900,
      netMinor: 18403,
      taxMinor: 3497,
    });
    expect(() => assertTotalsConsistent(totals)).not.toThrow();
  });

  test('rejects a net gross that would leave the safe range', () => {
    expectOverflow(() =>
      lineTotals({ ...net, unitPriceMinor: Number.MAX_SAFE_INTEGER }),
    );
  });
});
