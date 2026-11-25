import {
  allocateTotalDiscount,
  applyTotalDiscount,
  DocumentTotalsError,
  documentTotals,
  type TotalDiscount,
} from './document-totals.js';
import { Temporal } from '@js-temporal/polyfill';
import {
  DocumentLayoutError,
  renderDocumentHtml,
  type DocumentLayoutInput,
  type DocumentLineInput,
} from './document-layouts.js';
import {
  assertTemplateText,
  DocumentTemplateError,
} from './document-templates.js';
import { contentHash } from './document-pdf.js';

export class DocumentSnapshotError extends Error {
  constructor(
    readonly reason:
      'invalid_transition' | 'missing_reference' | 'empty_lines' | 'not_final',
  ) {
    super('Document snapshot rejected');
  }
}

export type DocumentState = 'draft' | 'final' | 'withdrawn';

export function validityDate(
  issuedAt: Date,
  validityDays: number,
  timeZone: string,
): Temporal.PlainDate {
  return Temporal.Instant.from(issuedAt.toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ days: validityDays });
}

// DV/AG: a final document is immutable; corrections create a new document.
const transitions: Record<DocumentState, readonly DocumentState[]> = {
  draft: ['final', 'withdrawn'],
  final: [],
  withdrawn: [],
};

export function assertTransition(from: DocumentState, to: DocumentState): void {
  if (!transitions[from]?.includes(to))
    throw new DocumentSnapshotError('invalid_transition');
}

export type SnapshotInput = {
  layout: DocumentLayoutInput;
  template: { subject: string; introText: string; outroText: string };
  documentNumber: string;
  issuedAt: Date;
  validUntil?: string;
  timeZone: string;
  recipientName: string;
  recipientAddress: string;
  lines: readonly DocumentLineInput[];
  values: Parameters<typeof renderDocumentHtml>[0]['values'];
  logoDataUri?: string;
  /**
   * DOC-PRODUCT-01.5: the stored comment-level discount. Omitted keeps the
   * document byte-identical to one written before this slice.
   */
  totalDiscount?: TotalDiscount & { note?: string | null };
};

export type DocumentSnapshot = {
  html: string;
  hash: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  byteLength: number;
  /**
   * DOC-PRODUCT-01.5: the discounted amount the paper asks for. Absent for a
   * document without a discount, so its old shape stays exactly as it was.
   */
  payableMinor?: number;
};

// Everything a printed document needs, fixed at one instant: the same input
// must always produce the same bytes and therefore the same hash.
export function buildDocumentSnapshot(input: SnapshotInput): DocumentSnapshot {
  if (!input.recipientName.trim())
    throw new DocumentSnapshotError('missing_reference');
  if (!input.documentNumber.trim())
    throw new DocumentSnapshotError('missing_reference');
  if (!input.lines.length) throw new DocumentSnapshotError('empty_lines');
  try {
    assertTemplateText(
      input.template.subject,
      input.template.introText,
      input.template.outroText,
    );
    const totals = documentTotals(
        input.lines.filter((line) => line.kind !== 'info'),
      ),
      // DOC-PRODUCT-01.5: one discount for the whole document, resolved here so
      // the block and the returned payable amount are the same arithmetic. The
      // stored net/tax/gross stay the position sums; the print adds net and tax
      // after the discount per rate (QW7).
      discount = applyTotalDiscount(totals, input.totalDiscount ?? null),
      html = renderDocumentHtml({
        layout: {
          ...input.layout,
          ...(input.totalDiscount
            ? {
                totalDiscount: {
                  kind: input.totalDiscount.kind,
                  value: input.totalDiscount.value,
                  ...(input.totalDiscount.note
                    ? { note: input.totalDiscount.note }
                    : {}),
                  discountMinor: discount.discountMinor,
                  payableMinor: discount.payableMinor,
                  // QW7: the discount lowers net and tax of every rate.
                  taxGroups: allocateTotalDiscount(
                    totals.taxGroups,
                    discount.discountMinor,
                  ).taxGroups,
                },
              }
            : {}),
        },
        documentNumber: input.documentNumber,
        issuedAt: input.issuedAt,
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
        timeZone: input.timeZone,
        recipientName: input.recipientName,
        recipientAddress: input.recipientAddress,
        subject: input.template.subject,
        introText: input.template.introText,
        outroText: input.template.outroText,
        lines: input.lines,
        values: input.values,
        ...(input.logoDataUri ? { logoDataUri: input.logoDataUri } : {}),
      }),
      bytes = Buffer.from(html, 'utf8');
    return {
      html,
      hash: contentHash(bytes),
      netMinor: totals.netMinor,
      taxMinor: totals.taxMinor,
      grossMinor: totals.grossMinor,
      byteLength: bytes.byteLength,
      ...(input.totalDiscount ? { payableMinor: discount.payableMinor } : {}),
    };
  } catch (error) {
    if (
      error instanceof DocumentTemplateError ||
      error instanceof DocumentLayoutError ||
      error instanceof DocumentTotalsError
    )
      throw new DocumentSnapshotError('missing_reference');
    throw error;
  }
}
