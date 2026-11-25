import { describe, expect, test } from 'vitest';
import {
  allocateTotalDiscount,
  applyTotalDiscount,
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

// DOC-PRODUCT-01.4: a position may carry its discount as a fixed amount on the
// stored basis instead of a percentage. NULL keeps the old percentage meaning,
// so the two modes are told apart by the field alone - never by a zero.
describe('amount discount', () => {
  const gross = {
      quantity: 1,
      unitPriceMinor: 10000,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
      priceBasis: 'gross' as const,
    },
    net = { ...gross, priceBasis: 'net' as const };

  function expectInvalid(operation: () => unknown) {
    let error: unknown;
    try {
      operation();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentTotalsError);
    expect(error).toMatchObject({ reason: 'invalid' });
  }

  test('subtracts the amount from the gross sum before the tax is extracted', () => {
    expect(lineTotals({ ...gross, discountAmountMinor: 1000 })).toEqual({
      grossMinor: 9000,
      netMinor: 7563,
      taxMinor: 1437,
    });
  });

  test('subtracts the amount from the net sum before the tax is added', () => {
    expect(lineTotals({ ...net, discountAmountMinor: 2000 })).toEqual({
      grossMinor: 9520,
      netMinor: 8000,
      taxMinor: 1520,
    });
  });

  test('keeps a zero amount and a full amount exact', () => {
    expect(lineTotals({ ...gross, discountAmountMinor: 0 })).toEqual(
      lineTotals(gross),
    );
    expect(lineTotals({ ...gross, discountAmountMinor: 10000 })).toEqual({
      grossMinor: 0,
      netMinor: 0,
      taxMinor: 0,
    });
  });

  test('multiplies the quantity before subtracting the amount', () => {
    expect(
      lineTotals({
        ...net,
        quantity: 3,
        taxBasisPoints: 700,
        discountAmountMinor: 5000,
      }),
    ).toEqual({ grossMinor: 26750, netMinor: 25000, taxMinor: 1750 });
    expect(
      lineTotals({
        ...gross,
        quantity: 3,
        unitPriceMinor: 333,
        taxBasisPoints: 700,
        discountAmountMinor: 100,
      }),
    ).toEqual({ grossMinor: 899, netMinor: 840, taxMinor: 59 });
  });

  test('keeps a zero rate exact in both bases', () => {
    expect(
      lineTotals({ ...gross, taxBasisPoints: 0, discountAmountMinor: 2000 }),
    ).toEqual({ grossMinor: 8000, netMinor: 8000, taxMinor: 0 });
    expect(
      lineTotals({ ...net, taxBasisPoints: 0, discountAmountMinor: 2000 }),
    ).toEqual({ grossMinor: 8000, netMinor: 8000, taxMinor: 0 });
  });

  test('rejects an amount above the line sum, a negative and a fractional one', () => {
    for (const broken of [
      { ...gross, discountAmountMinor: 10001 },
      { ...gross, discountAmountMinor: -1 },
      { ...gross, discountAmountMinor: 100.5 },
      { ...gross, discountAmountMinor: Number.NaN },
      { ...gross, discountAmountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { ...net, quantity: 3, unitPriceMinor: 1000, discountAmountMinor: 3001 },
    ])
      expectInvalid(() => lineTotals(broken));
  });

  test('lets the amount win over a stored rate, never combined with it', () => {
    // The column pair is exclusive by meaning: a stored amount means the basis
    // points are not the discount, so they cannot shave a second time.
    expect(
      lineTotals({
        ...gross,
        discountBasisPoints: 5000,
        discountAmountMinor: 1000,
      }),
    ).toEqual({ grossMinor: 9000, netMinor: 7563, taxMinor: 1437 });
  });

  test('leaves the percentage mode unchanged when the amount is absent', () => {
    const percent = lineTotals({ ...gross, discountBasisPoints: 500 });
    expect(
      lineTotals({
        ...gross,
        discountBasisPoints: 500,
        discountAmountMinor: null,
      }),
    ).toEqual(percent);
    expect(percent).toEqual({
      grossMinor: 9500,
      netMinor: 7983,
      taxMinor: 1517,
    });
  });

  test('keeps the maximum safe amount exact with a zero discount', () => {
    expect(
      lineTotals({
        quantity: 1,
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
        taxBasisPoints: 0,
        discountBasisPoints: 0,
        priceBasis: 'gross',
        discountAmountMinor: 0,
      }),
    ).toEqual({
      grossMinor: Number.MAX_SAFE_INTEGER,
      netMinor: Number.MAX_SAFE_INTEGER,
      taxMinor: 0,
    });
  });

  test('rejects an amount line whose sum leaves the safe range', () => {
    expectOverflow(() =>
      lineTotals({
        ...gross,
        quantity: 2,
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
        discountAmountMinor: 0,
      }),
    );
  });

  test('sums mixed amount and percentage lines into exact tax groups', () => {
    const totals = documentTotals([
      { ...gross, discountAmountMinor: 1000 },
      {
        quantity: 1,
        unitPriceMinor: 20000,
        taxBasisPoints: 700,
        discountBasisPoints: 1000,
        priceBasis: 'gross',
      },
    ]);
    expect(totals).toEqual({
      lines: [
        { grossMinor: 9000, netMinor: 7563, taxMinor: 1437 },
        { grossMinor: 18000, netMinor: 16822, taxMinor: 1178 },
      ],
      taxGroups: [
        {
          taxBasisPoints: 700,
          netMinor: 16822,
          taxMinor: 1178,
          grossMinor: 18000,
        },
        {
          taxBasisPoints: 1900,
          netMinor: 7563,
          taxMinor: 1437,
          grossMinor: 9000,
        },
      ],
      netMinor: 24385,
      taxMinor: 2615,
      grossMinor: 27000,
    });
    expect(() => assertTotalsConsistent(totals)).not.toThrow();
  });

  test('keeps an optional amount line out of the sums but not out of its own row', () => {
    const totals = documentTotals([
      { ...gross, discountAmountMinor: 1000 },
      { ...gross, optional: true, discountAmountMinor: 4000 },
    ]);
    expect(totals.lines[1]).toEqual({
      grossMinor: 6000,
      netMinor: 5042,
      taxMinor: 958,
    });
    expect(totals.grossMinor).toBe(9000);
    expect(totals.taxGroups).toHaveLength(1);
  });
});

// DOC-PRODUCT-01.5: one discount for the whole document. It never touches the
// position sums, the tax groups or the stored net/tax/gross - it only turns the
// gross into the amount the document asks for.
describe('total document discount', () => {
  const totals = documentTotals([
    {
      quantity: 1,
      unitPriceMinor: 10000,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
      priceBasis: 'gross',
      discountAmountMinor: 1000,
    },
    {
      quantity: 2,
      unitPriceMinor: 5000,
      taxBasisPoints: 700,
      discountBasisPoints: 1000,
      priceBasis: 'gross',
    },
    {
      quantity: 1,
      unitPriceMinor: 4000,
      taxBasisPoints: 700,
      discountBasisPoints: 0,
      priceBasis: 'gross',
      optional: true,
    },
  ]);

  function expectInvalid(operation: () => unknown) {
    let error: unknown;
    try {
      operation();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentTotalsError);
    expect(error).toMatchObject({ reason: 'invalid' });
  }

  test('keeps the position sums and the tax groups exactly as they were', () => {
    // 9000 at 19 % and 9000 at 7 %; the optional 4000 stays outside the sums.
    expect(totals).toMatchObject({
      netMinor: 7563 + 8411,
      taxMinor: 1437 + 589,
      grossMinor: 18000,
      taxGroups: [
        {
          taxBasisPoints: 700,
          netMinor: 8411,
          taxMinor: 589,
          grossMinor: 9000,
        },
        {
          taxBasisPoints: 1900,
          netMinor: 7563,
          taxMinor: 1437,
          grossMinor: 9000,
        },
      ],
    });
    expect(totals.lines[2]).toEqual({
      grossMinor: 4000,
      netMinor: 3738,
      taxMinor: 262,
    });
  });

  test('subtracts a rate from the gross without redistributing the tax', () => {
    expect(
      applyTotalDiscount(totals, { kind: 'percent', value: 1000 }),
    ).toEqual({ discountMinor: 1800, payableMinor: 16200 });
    // The rate applies to the whole document, never to one position.
    expect(
      applyTotalDiscount(totals, { kind: 'percent', value: 10000 }),
    ).toEqual({ discountMinor: 18000, payableMinor: 0 });
  });

  test('subtracts a fixed amount and keeps a zero and a full one exact', () => {
    expect(applyTotalDiscount(totals, { kind: 'amount', value: 2500 })).toEqual(
      { discountMinor: 2500, payableMinor: 15500 },
    );
    expect(applyTotalDiscount(totals, { kind: 'amount', value: 0 })).toEqual({
      discountMinor: 0,
      payableMinor: 18000,
    });
    expect(
      applyTotalDiscount(totals, { kind: 'amount', value: 18000 }),
    ).toEqual({ discountMinor: 18000, payableMinor: 0 });
  });

  test('rounds a rate half a cent up from the full integer product', () => {
    expect(
      applyTotalDiscount({ grossMinor: 999 }, { kind: 'percent', value: 5000 }),
    ).toEqual({ discountMinor: 500, payableMinor: 499 });
    expect(
      applyTotalDiscount(
        { grossMinor: 3335 },
        { kind: 'percent', value: 1000 },
      ),
    ).toEqual({ discountMinor: 334, payableMinor: 3001 });
    expect(
      applyTotalDiscount(
        { grossMinor: 3333 },
        { kind: 'percent', value: 1000 },
      ),
    ).toEqual({ discountMinor: 333, payableMinor: 3000 });
  });

  test('answers no discount for an absent one instead of inventing a zero row', () => {
    expect(applyTotalDiscount(totals, null)).toEqual({
      discountMinor: 0,
      payableMinor: 18000,
    });
    expect(applyTotalDiscount({ grossMinor: 0 }, undefined)).toEqual({
      discountMinor: 0,
      payableMinor: 0,
    });
  });

  test('rejects a deduction above the gross instead of clamping it', () => {
    expectInvalid(() =>
      applyTotalDiscount({ grossMinor: 1000 }, { kind: 'amount', value: 1001 }),
    );
    expectInvalid(() =>
      applyTotalDiscount(
        { grossMinor: 1000 },
        { kind: 'percent', value: 10001 },
      ),
    );
  });

  test('rejects a negative, fractional, unsafe or unknown discount', () => {
    for (const broken of [
      { kind: 'amount' as const, value: -1 },
      { kind: 'amount' as const, value: 100.5 },
      { kind: 'amount' as const, value: Number.NaN },
      { kind: 'amount' as const, value: Number.MAX_SAFE_INTEGER + 1 },
      { kind: 'percent' as const, value: 1.5 },
      { kind: 'rate' as unknown as 'percent', value: 100 },
    ])
      expectInvalid(() => applyTotalDiscount({ grossMinor: 1000 }, broken));
  });

  test('keeps the maximum safe gross exact with zero and with a full amount', () => {
    expect(
      applyTotalDiscount(
        { grossMinor: Number.MAX_SAFE_INTEGER },
        { kind: 'amount', value: 0 },
      ),
    ).toEqual({
      discountMinor: 0,
      payableMinor: Number.MAX_SAFE_INTEGER,
    });
    expect(
      applyTotalDiscount({ grossMinor: 0 }, { kind: 'amount', value: 0 }),
    ).toEqual({ discountMinor: 0, payableMinor: 0 });
    expect(
      applyTotalDiscount(
        { grossMinor: Number.MAX_SAFE_INTEGER - 1 },
        { kind: 'amount', value: Number.MAX_SAFE_INTEGER - 1 },
      ),
    ).toEqual({
      discountMinor: Number.MAX_SAFE_INTEGER - 1,
      payableMinor: 0,
    });
  });

  test('rejects a gross outside the safe range rather than computing it', () => {
    expectInvalid(() =>
      applyTotalDiscount(
        { grossMinor: Number.MAX_SAFE_INTEGER + 1 },
        { kind: 'amount', value: 0 },
      ),
    );
  });
});

// QW7: the document discount lowers every rate in proportion to its gross; the
// shares always add up to the discount and every rate splits its reduced gross
// like a gross position.
describe('allocateTotalDiscount', () => {
  const group = (taxBasisPoints: number, grossMinor: number) => ({
    taxBasisPoints,
    grossMinor,
    netMinor: 0,
    taxMinor: 0,
  });

  test('one rate takes the whole discount and recomputes net and tax', () => {
    expect(allocateTotalDiscount([group(1900, 11900)], 1190)).toEqual({
      taxGroups: [
        {
          taxBasisPoints: 1900,
          discountMinor: 1190,
          grossMinor: 10710,
          netMinor: 9000,
          taxMinor: 1710,
        },
      ],
      netMinor: 9000,
      taxMinor: 1710,
      grossMinor: 10710,
    });
  });

  test('mixed rates share the discount by gross and the shares add up', () => {
    const result = allocateTotalDiscount(
      [group(700, 10700), group(1900, 11900)],
      1000,
    );
    // 10700/22600 of 1000 = 473.45..., 11900/22600 = 526.54...: the larger
    // remainder gets the last unit.
    expect(result.taxGroups.map((row) => row.discountMinor)).toEqual([
      473, 527,
    ]);
    expect(result.grossMinor).toBe(22600 - 1000);
    expect(result.netMinor + result.taxMinor).toBe(result.grossMinor);
    expect(result.taxGroups[0]).toMatchObject({
      grossMinor: 10227,
      netMinor: 9558,
      taxMinor: 669,
    });
  });

  test('equal remainders go to the first rate, so the split is stable', () => {
    expect(
      allocateTotalDiscount(
        [group(700, 100), group(1900, 100)],
        1,
      ).taxGroups.map((row) => row.discountMinor),
    ).toEqual([1, 0]);
  });

  test('no discount, a whole discount and an empty document', () => {
    expect(
      allocateTotalDiscount([group(1900, 11900)], 0).taxGroups[0],
    ).toMatchObject({ discountMinor: 0, netMinor: 10000, taxMinor: 1900 });
    expect(allocateTotalDiscount([group(1900, 11900)], 11900)).toMatchObject({
      netMinor: 0,
      taxMinor: 0,
      grossMinor: 0,
    });
    expect(allocateTotalDiscount([], 0)).toEqual({
      taxGroups: [],
      netMinor: 0,
      taxMinor: 0,
      grossMinor: 0,
    });
    expect(
      allocateTotalDiscount([group(0, 0), group(1900, 1190)], 119).taxGroups,
    ).toMatchObject([{ discountMinor: 0 }, { discountMinor: 119 }]);
  });

  test('a discount above the gross or a broken amount is refused', () => {
    expect(() => allocateTotalDiscount([group(1900, 100)], 101)).toThrow(
      DocumentTotalsError,
    );
    expect(() => allocateTotalDiscount([group(1900, 100)], -1)).toThrow(
      DocumentTotalsError,
    );
    expect(() => allocateTotalDiscount([group(1900, 100)], 0.5)).toThrow(
      DocumentTotalsError,
    );
  });
});
