export class DocumentTotalsError extends Error {
  constructor(readonly reason: 'invalid' | 'overflow') {
    super('Document totals rejected');
  }
}

// Every position price is a gross or a net amount in minor units. A gross price
// carries the tax inside it, so a discount reduces the gross and the tax is
// extracted; a net price gets the tax added on top. All arithmetic stays
// integral.
export type PriceBasis = 'gross' | 'net';
export type TotalsLine = {
  quantity: number;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
  /**
   * A fixed discount in minor units on the stored basis (quantity x unit
   * price). NULL or absent keeps the percentage meaning of
   * `discountBasisPoints`; a value replaces that percentage instead of adding
   * to it.
   */
  discountAmountMinor?: number | null;
  priceBasis: PriceBasis;
  optional?: boolean;
};
export type LineTotals = {
  grossMinor: number;
  netMinor: number;
  taxMinor: number;
};
export type TaxGroup = {
  taxBasisPoints: number;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
};
export type DocumentTotals = {
  lines: LineTotals[];
  taxGroups: TaxGroup[];
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
};

function safe(value: number, reason: 'invalid' | 'overflow' = 'invalid') {
  if (!Number.isSafeInteger(value)) throw new DocumentTotalsError(reason);
  return value;
}

const maximumMinor = BigInt(Number.MAX_SAFE_INTEGER);

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function safeMinor(value: bigint): number {
  if (value < 0n || value > maximumMinor)
    throw new DocumentTotalsError('overflow');
  return Number(value);
}

export function lineTotals(line: TotalsLine): LineTotals {
  const discountAmount =
    line.discountAmountMinor === undefined ? null : line.discountAmountMinor;
  if (
    (line.priceBasis !== 'gross' && line.priceBasis !== 'net') ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1 ||
    !Number.isSafeInteger(line.unitPriceMinor) ||
    line.unitPriceMinor < 0 ||
    !Number.isSafeInteger(line.discountBasisPoints) ||
    line.discountBasisPoints < 0 ||
    line.discountBasisPoints > 10000 ||
    (discountAmount !== null &&
      (!Number.isSafeInteger(discountAmount) || discountAmount < 0)) ||
    !Number.isSafeInteger(line.taxBasisPoints) ||
    line.taxBasisPoints < 0 ||
    line.taxBasisPoints > 10000
  )
    throw new DocumentTotalsError('invalid');
  // The full sum of the stored basis - gross or net, as stored.
  const sumExact = BigInt(line.quantity) * BigInt(line.unitPriceMinor);
  let basisExact: bigint;
  if (discountAmount === null)
    // The discounted amount of the stored basis, rounded from the full product.
    basisExact = roundedRatio(
      sumExact * BigInt(10000 - line.discountBasisPoints),
      10000n,
    );
  else {
    // A fixed amount is exact by construction and can never exceed its line:
    // a larger one is a typing mistake, not an amount to clamp to zero.
    if (BigInt(discountAmount) > sumExact)
      throw new DocumentTotalsError('invalid');
    basisExact = sumExact - BigInt(discountAmount);
  }
  if (line.priceBasis === 'net') {
    const netMinor = safeMinor(basisExact),
      taxMinor = safeMinor(
        roundedRatio(basisExact * BigInt(line.taxBasisPoints), 10000n),
      ),
      grossMinor = safeMinor(basisExact + BigInt(taxMinor));
    return { grossMinor, netMinor, taxMinor };
  }
  const grossMinor = safeMinor(basisExact),
    netMinor = safeMinor(
      roundedRatio(basisExact * 10000n, BigInt(10000 + line.taxBasisPoints)),
    );
  return { grossMinor, netMinor, taxMinor: grossMinor - netMinor };
}

export function documentTotals(lines: readonly TotalsLine[]): DocumentTotals {
  const computed = lines.map(lineTotals),
    groups = new Map<
      number,
      {
        taxBasisPoints: number;
        netMinor: bigint;
        taxMinor: bigint;
        grossMinor: bigint;
      }
    >();
  let netMinor = 0n,
    taxMinor = 0n,
    grossMinor = 0n;
  lines.forEach((line, index) => {
    if (line.optional) return;
    const totals = computed[index]!,
      group = groups.get(line.taxBasisPoints) ?? {
        taxBasisPoints: line.taxBasisPoints,
        netMinor: 0n,
        taxMinor: 0n,
        grossMinor: 0n,
      };
    group.netMinor += BigInt(totals.netMinor);
    group.taxMinor += BigInt(totals.taxMinor);
    group.grossMinor += BigInt(totals.grossMinor);
    groups.set(line.taxBasisPoints, group);
    netMinor += BigInt(totals.netMinor);
    taxMinor += BigInt(totals.taxMinor);
    grossMinor += BigInt(totals.grossMinor);
  });
  return {
    lines: computed,
    taxGroups: [...groups.values()]
      .sort((a, b) => a.taxBasisPoints - b.taxBasisPoints)
      .map((group) => ({
        taxBasisPoints: group.taxBasisPoints,
        netMinor: safeMinor(group.netMinor),
        taxMinor: safeMinor(group.taxMinor),
        grossMinor: safeMinor(group.grossMinor),
      })),
    netMinor: safeMinor(netMinor),
    taxMinor: safeMinor(taxMinor),
    grossMinor: safeMinor(grossMinor),
  };
}

// The cross-check that keeps a printed document consistent with itself.
export function assertTotalsConsistent(totals: DocumentTotals): void {
  const netMinor = BigInt(safe(totals.netMinor)),
    taxMinor = BigInt(safe(totals.taxMinor)),
    grossMinor = BigInt(safe(totals.grossMinor));
  if (netMinor + taxMinor !== grossMinor)
    throw new DocumentTotalsError('invalid');
  const net = totals.taxGroups.reduce(
      (sum, group) => sum + BigInt(safe(group.netMinor)),
      0n,
    ),
    tax = totals.taxGroups.reduce(
      (sum, group) => sum + BigInt(safe(group.taxMinor)),
      0n,
    );
  if (net !== netMinor || tax !== taxMinor)
    throw new DocumentTotalsError('invalid');
}

// DOC-PRODUCT-01.5: one discount for the whole document. It is deliberately not
// a line: the position sums, the tax groups and the stored net/tax/gross stay
// exactly what the positions say, and only the amount the document asks for
// shrinks. No tax is redistributed or recalculated - that would invent a tax
// rule nobody agreed on. A rate is basis points (1000 = 10 %), an amount is
// minor units, and neither is ever clamped: a deduction above the gross is a
// typing mistake, exactly like a discount above its line.
export type TotalDiscount =
  { kind: 'percent'; value: number } | { kind: 'amount'; value: number };
export type TotalDiscountResult = {
  /** The resolved deduction in minor units. */
  discountMinor: number;
  /** `gross - discount`: what the document asks the customer to pay. */
  payableMinor: number;
};

export function applyTotalDiscount(
  totals: Pick<DocumentTotals, 'grossMinor'>,
  discount: TotalDiscount | null | undefined,
): TotalDiscountResult {
  const grossMinor = safe(totals.grossMinor);
  if (discount === null || discount === undefined)
    return { discountMinor: 0, payableMinor: grossMinor };
  if (
    (discount.kind !== 'percent' && discount.kind !== 'amount') ||
    !Number.isSafeInteger(discount.value) ||
    discount.value < 0 ||
    (discount.kind === 'percent' && discount.value > 10000)
  )
    throw new DocumentTotalsError('invalid');
  const discountMinor =
      discount.kind === 'percent'
        ? Number(
            roundedRatio(BigInt(grossMinor) * BigInt(discount.value), 10000n),
          )
        : discount.value,
    payableMinor = grossMinor - discountMinor;
  // A rate can never exceed the gross (10000 is the whole document), so only a
  // typed amount can overshoot - and it is refused, never clamped to zero.
  if (payableMinor < 0) throw new DocumentTotalsError('invalid');
  return { discountMinor, payableMinor };
}

// Deliberately not Intl: a document must render identically everywhere.
export function formatMinorUnits(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new DocumentTotalsError('invalid');
  const negative = minor < 0,
    absolute = Math.abs(minor),
    euros = String(Math.floor(absolute / 100)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      '.',
    ),
    cents = String(absolute % 100).padStart(2, '0');
  return (negative ? '-' : '') + euros + ',' + cents;
}

export function formatDocumentDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return `${part('day')}.${part('month')}.${part('year')}`;
}
