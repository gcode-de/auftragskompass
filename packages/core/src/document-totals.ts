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
  const grossMinor = safe(
    Math.round(
      (line.quantity *
        line.unitPriceMinor *
        (10000 - line.discountBasisPoints)) /
        10000,
    ),
    'overflow',
  );
  const netMinor = safe(
    Math.round((grossMinor * 10000) / (10000 + line.taxBasisPoints)),
    'overflow',
  );
  return { grossMinor, netMinor, taxMinor: grossMinor - netMinor };
}

export function documentTotals(lines: readonly TotalsLine[]): DocumentTotals {
  const computed = lines.map(lineTotals),
    groups = new Map<number, TaxGroup>();
  let netMinor = 0,
    taxMinor = 0,
    grossMinor = 0;
  lines.forEach((line, index) => {
    const totals = computed[index]!,
      group = groups.get(line.taxBasisPoints) ?? {
        taxBasisPoints: line.taxBasisPoints,
        netMinor: 0,
        taxMinor: 0,
        grossMinor: 0,
      };
    group.netMinor += totals.netMinor;
    group.taxMinor += totals.taxMinor;
    group.grossMinor += totals.grossMinor;
    groups.set(line.taxBasisPoints, group);
    netMinor += totals.netMinor;
    taxMinor += totals.taxMinor;
    grossMinor += totals.grossMinor;
  });
  return {
    lines: computed,
    taxGroups: [...groups.values()].sort(
      (a, b) => a.taxBasisPoints - b.taxBasisPoints,
    ),
    netMinor: safe(netMinor, 'overflow'),
    taxMinor: safe(taxMinor, 'overflow'),
    grossMinor: safe(grossMinor, 'overflow'),
  };
}

// The cross-check that keeps a printed document consistent with itself.
export function assertTotalsConsistent(totals: DocumentTotals): void {
  if (totals.netMinor + totals.taxMinor !== totals.grossMinor)
    throw new DocumentTotalsError('invalid');
  const net = totals.taxGroups.reduce((sum, group) => sum + group.netMinor, 0),
    tax = totals.taxGroups.reduce((sum, group) => sum + group.taxMinor, 0);
  if (net !== totals.netMinor || tax !== totals.taxMinor)
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
