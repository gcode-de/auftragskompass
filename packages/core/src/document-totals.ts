export class DocumentTotalsError extends Error {
  constructor(readonly reason: 'invalid' | 'overflow') {
    super('Document totals rejected');
  }
}

// Every position price is a gross amount in minor units, so a discount reduces
// the gross and the tax is extracted from it. All arithmetic stays integral.
export type TotalsLine = {
  quantity: number;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
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
  if (
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1 ||
    !Number.isSafeInteger(line.unitPriceMinor) ||
    line.unitPriceMinor < 0 ||
    !Number.isSafeInteger(line.discountBasisPoints) ||
    line.discountBasisPoints < 0 ||
    line.discountBasisPoints > 10000 ||
    !Number.isSafeInteger(line.taxBasisPoints) ||
    line.taxBasisPoints < 0 ||
    line.taxBasisPoints > 10000
  )
    throw new DocumentTotalsError('invalid');
  const grossExact = roundedRatio(
    BigInt(line.quantity) *
      BigInt(line.unitPriceMinor) *
      BigInt(10000 - line.discountBasisPoints),
    10000n,
  );
  const grossMinor = safeMinor(grossExact);
  const netMinor = safeMinor(
    roundedRatio(grossExact * 10000n, BigInt(10000 + line.taxBasisPoints)),
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
