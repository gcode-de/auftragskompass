import { describe, expect, test } from 'vitest';
import {
  assertNumberPattern,
  DocumentNumberError,
  formatDocumentNumber,
} from '../../packages/core/src/document-numbers.js';

describe('assertNumberPattern', () => {
  test('accepts every documented placeholder', () => {
    expect(() =>
      assertNumberPattern('AN-{YYYY}-{MM}-{DD}-{SEQ}'),
    ).not.toThrow();
    expect(() => assertNumberPattern('{YY}/{SEQ}')).not.toThrow();
  });
  test('rejects an unknown placeholder', () => {
    expect(() => assertNumberPattern('AN-{WW}-{SEQ}')).toThrow(
      DocumentNumberError,
    );
  });
  test('rejects a pattern without exactly one counter', () => {
    for (const pattern of ['AN-{YYYY}', '{SEQ}-{SEQ}'])
      expect(() => assertNumberPattern(pattern)).toThrow(DocumentNumberError);
  });
});

describe('formatDocumentNumber', () => {
  const patterns = 'AN-{YYYY}-{SEQ}';
  test('pads the counter to the configured minimum length', () => {
    expect(
      formatDocumentNumber(
        patterns,
        4,
        new Date('2030-10-26T10:00:00Z'),
        'Europe/Berlin',
        7,
      ),
    ).toBe('AN-2030-0007');
  });
  test('keeps a counter that outgrows the minimum length untouched', () => {
    expect(
      formatDocumentNumber(
        '{SEQ}',
        2,
        new Date('2030-10-26T10:00:00Z'),
        'Europe/Berlin',
        123456,
      ),
    ).toBe('123456');
  });
  test('renders month, day and short year', () => {
    expect(
      formatDocumentNumber(
        '{YY}{MM}{DD}-{SEQ}',
        3,
        new Date('2030-10-26T10:00:00Z'),
        'Europe/Berlin',
        1,
      ),
    ).toBe('301026-001');
  });
  test('uses the tenant timezone, so a late instant belongs to the next year', () => {
    expect(
      formatDocumentNumber(
        'RE-{YYYY}-{SEQ}',
        4,
        new Date('2030-12-31T23:30:00Z'),
        'Europe/Berlin',
        1,
      ),
    ).toBe('RE-2031-0001');
    expect(
      formatDocumentNumber(
        'RE-{YYYY}-{SEQ}',
        4,
        new Date('2030-12-31T23:30:00Z'),
        'UTC',
        1,
      ),
    ).toBe('RE-2030-0001');
  });
});
