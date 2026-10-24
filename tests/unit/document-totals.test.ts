import { describe, expect, test } from 'vitest';
import {
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

  test('rejects unsafe tax-group and document sums', () => {
    const line = {
      quantity: 1,
      unitPriceMinor: Number.MAX_SAFE_INTEGER,
      taxBasisPoints: 0,
      discountBasisPoints: 0,
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
        },
        {
          quantity: 1,
          unitPriceMinor: 1,
          taxBasisPoints: 1900,
          discountBasisPoints: 0,
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
