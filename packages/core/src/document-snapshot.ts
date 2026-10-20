import { DocumentTotalsError, documentTotals } from './document-totals.js';
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
  timeZone: string;
  recipientName: string;
  recipientAddress: string;
  lines: readonly DocumentLineInput[];
  values: Parameters<typeof renderDocumentHtml>[0]['values'];
};

export type DocumentSnapshot = {
  html: string;
  hash: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  byteLength: number;
};

// Everything a printed document needs, fixed at one instant: the same input
// must always produce the same bytes and therefore the same hash.
export function buildDocumentSnapshot(input: SnapshotInput): DocumentSnapshot {
  if (!input.recipientName.trim())
    throw new DocumentSnapshotError('missing_reference');
  if (!input.documentNumber.trim())
    throw new DocumentSnapshotError('missing_reference');
  if (!input.lines.length) throw new DocumentSnapshotError('empty_lines');
  let html: string;
  try {
    assertTemplateText(
      input.template.subject,
      input.template.introText,
      input.template.outroText,
    );
    html = renderDocumentHtml({
      layout: input.layout,
      documentNumber: input.documentNumber,
      issuedAt: input.issuedAt,
      timeZone: input.timeZone,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress,
      subject: input.template.subject,
      introText: input.template.introText,
      outroText: input.template.outroText,
      lines: input.lines,
      values: input.values,
    });
  } catch (error) {
    if (
      error instanceof DocumentTemplateError ||
      error instanceof DocumentLayoutError ||
      error instanceof DocumentTotalsError
    )
      throw new DocumentSnapshotError('missing_reference');
    throw error;
  }
  const totals = documentTotals(input.lines),
    bytes = Buffer.from(html, 'utf8');
  return {
    html,
    hash: contentHash(bytes),
    netMinor: totals.netMinor,
    taxMinor: totals.taxMinor,
    grossMinor: totals.grossMinor,
    byteLength: bytes.byteLength,
  };
}
