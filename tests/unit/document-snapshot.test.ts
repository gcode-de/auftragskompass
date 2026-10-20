import { describe, expect, test } from 'vitest';
import {
  assertTransition,
  buildDocumentSnapshot,
  DocumentSnapshotError,
  type SnapshotInput,
} from '../../packages/core/src/document-snapshot.js';

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
};
const input = (): SnapshotInput => ({
  layout,
  template: {
    subject: 'Angebot für {{contact}}',
    introText: 'Hallo {{contact}}',
    outroText: 'Termin am {{date}}',
  },
  documentNumber: 'AN-2030-0001',
  issuedAt: new Date('2030-10-26T10:00:00Z'),
  timeZone: 'Europe/Berlin',
  recipientName: 'Fictional Customer',
  recipientAddress: 'Example Street 2',
  lines: [
    {
      description: 'Fictional box',
      unit: 'Stück',
      quantity: 1,
      unitPriceMinor: 19900,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
  ],
  values: { contact: 'Fictional Customer', date: '27.10.2030' },
});

describe('assertTransition', () => {
  test('allows a draft to become final or withdrawn and freezes the rest', () => {
    expect(() => assertTransition('draft', 'final')).not.toThrow();
    expect(() => assertTransition('draft', 'withdrawn')).not.toThrow();
    for (const [from, to] of [
      ['final', 'draft'],
      ['final', 'withdrawn'],
      ['withdrawn', 'draft'],
    ] as const)
      expect(() => assertTransition(from, to)).toThrow(DocumentSnapshotError);
  });
});

describe('buildDocumentSnapshot', () => {
  test('is deterministic and carries the exact totals', () => {
    const first = buildDocumentSnapshot(input()),
      second = buildDocumentSnapshot(input());
    expect(first.hash).toBe(second.hash);
    expect(first.html).toBe(second.html);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.byteLength).toBe(Buffer.byteLength(first.html, 'utf8'));
    expect(first).toMatchObject({
      netMinor: 16723,
      taxMinor: 3177,
      grossMinor: 19900,
    });
  });
  test('changes the hash when a single character of content changes', () => {
    const base = buildDocumentSnapshot(input()),
      changed = buildDocumentSnapshot({
        ...input(),
        template: { ...input().template, introText: 'Hallo {{contact}}!' },
      });
    expect(changed.hash).not.toBe(base.hash);
  });
  test('refuses a document without recipient, number or lines', () => {
    expect(() =>
      buildDocumentSnapshot({ ...input(), recipientName: '  ' }),
    ).toThrow(DocumentSnapshotError);
    expect(() =>
      buildDocumentSnapshot({ ...input(), documentNumber: '' }),
    ).toThrow(DocumentSnapshotError);
    expect(() => buildDocumentSnapshot({ ...input(), lines: [] })).toThrow(
      DocumentSnapshotError,
    );
  });
  test('surfaces a template or placeholder problem as a snapshot error', () => {
    expect(() =>
      buildDocumentSnapshot({
        ...input(),
        template: { ...input().template, subject: 'Angebot {{kontakt}}' },
      }),
    ).toThrow(DocumentSnapshotError);
    expect(() =>
      buildDocumentSnapshot({
        ...input(),
        values: { contact: 'Fictional' },
      }),
    ).toThrow(DocumentSnapshotError);
  });
});

test('passes an unexpected failure through instead of hiding it', () => {
  expect(() =>
    buildDocumentSnapshot({ ...input(), layout: undefined as never }),
  ).toThrow(TypeError);
});
