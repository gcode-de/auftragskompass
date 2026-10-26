import { describe, expect, test } from 'vitest';
import {
  checkLibraryBytes,
  contentDispositionHeader,
  decodeLibraryBase64,
  libraryFileMaxBytes,
  libraryStorageKey,
  normalizeLibraryDisplayName,
  sniffLibraryMediaType,
  LibraryFileError,
} from '../../packages/core/src/library-files.js';

const pdf = Buffer.from('%PDF-1.4 synthetic\n%%EOF\n', 'latin1'),
  png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]),
  jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0,
  ]),
  zip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('../synthetic-escape.txt'),
  ]);

function reason(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof LibraryFileError
      ? error.reason
      : 'not_a_library_error';
  }
  return 'accepted';
}

describe('signature detection', () => {
  test('recognises exactly the four allowed signatures', () => {
    expect(sniffLibraryMediaType(pdf)).toBe('application/pdf');
    expect(sniffLibraryMediaType(png)).toBe('image/png');
    expect(sniffLibraryMediaType(jpeg)).toBe('image/jpeg');
    expect(sniffLibraryMediaType(zip)).toBe('application/zip');
    expect(sniffLibraryMediaType(Buffer.from('synthetic text'))).toBeNull();
    expect(sniffLibraryMediaType(Buffer.alloc(0))).toBeNull();
    expect(sniffLibraryMediaType(Buffer.from('%PDF'))).toBeNull();
  });

  test('declared type only counts when the bytes agree with it', () => {
    expect(checkLibraryBytes(pdf, 'application/pdf')).toBe('application/pdf');
    expect(checkLibraryBytes(png, 'image/png')).toBe('image/png');
    expect(checkLibraryBytes(jpeg, 'image/jpeg')).toBe('image/jpeg');
    expect(checkLibraryBytes(zip, 'application/zip')).toBe('application/zip');
    // A ZIP renamed to PNG is the classic spoofing attempt.
    expect(() => checkLibraryBytes(zip, 'image/png')).toThrow(LibraryFileError);
    expect(reason(() => checkLibraryBytes(zip, 'image/png'))).toBe(
      'type_mismatch',
    );
    expect(reason(() => checkLibraryBytes(pdf, 'text/html'))).toBe(
      'type_mismatch',
    );
    expect(
      reason(() => checkLibraryBytes(Buffer.from('html'), 'application/pdf')),
    ).toBe('invalid_content');
  });

  test('enforces the single 10 MiB limit, exact size included', () => {
    const exact = Buffer.concat([
      pdf,
      Buffer.alloc(libraryFileMaxBytes - pdf.byteLength, 0x20),
    ]);
    expect(exact.byteLength).toBe(libraryFileMaxBytes);
    expect(checkLibraryBytes(exact, 'application/pdf')).toBe('application/pdf');
    const over = Buffer.concat([exact, Buffer.from('!')]);
    expect(over.byteLength).toBe(libraryFileMaxBytes + 1);
    expect(reason(() => checkLibraryBytes(over, 'application/pdf'))).toBe(
      'too_large',
    );
    expect(
      reason(() => checkLibraryBytes(Buffer.alloc(0), 'application/pdf')),
    ).toBe('invalid_content');
    expect(
      reason(() => checkLibraryBytes('not bytes', 'application/pdf')),
    ).toBe('invalid_content');
  });
});

describe('display names are data', () => {
  test('keeps traversal, emoji and RTL text as plain characters', () => {
    expect(normalizeLibraryDisplayName('  ../evil.pdf  ')).toBe('../evil.pdf');
    expect(normalizeLibraryDisplayName('Ünïcode 🎉 مرحبا.pdf')).toBe(
      'Ünïcode 🎉 مرحبا.pdf',
    );
    expect(normalizeLibraryDisplayName('a/b\\c.pdf')).toBe('a/b\\c.pdf');
  });

  test('rejects empty, control characters and more than 200 characters', () => {
    expect(reason(() => normalizeLibraryDisplayName('   '))).toBe(
      'invalid_name',
    );
    expect(reason(() => normalizeLibraryDisplayName(42))).toBe('invalid_name');
    expect(reason(() => normalizeLibraryDisplayName('a\u0000b.pdf'))).toBe(
      'invalid_name',
    );
    expect(reason(() => normalizeLibraryDisplayName('a\u001fb.pdf'))).toBe(
      'invalid_name',
    );
    expect(reason(() => normalizeLibraryDisplayName('x'.repeat(201)))).toBe(
      'invalid_name',
    );
    expect(normalizeLibraryDisplayName('x'.repeat(200))).toBe('x'.repeat(200));
    // Counted in characters, not UTF-16 units: 200 emoji are 200 characters.
    expect(normalizeLibraryDisplayName('🎉'.repeat(200))).toBe(
      '🎉'.repeat(200),
    );
    expect(reason(() => normalizeLibraryDisplayName('🎉'.repeat(201)))).toBe(
      'invalid_name',
    );
  });
});

describe('base64 transport', () => {
  test('round-trips canonical base64', () => {
    const bytes = Buffer.from('synthetic library body');
    expect(decodeLibraryBase64(bytes.toString('base64'))).toEqual(bytes);
    expect(decodeLibraryBase64(pdf.toString('base64'))).toEqual(pdf);
  });

  test('rejects anything that is not strict canonical base64', () => {
    expect(reason(() => decodeLibraryBase64(''))).toBe('invalid_content');
    expect(reason(() => decodeLibraryBase64(null))).toBe('invalid_content');
    expect(reason(() => decodeLibraryBase64('abc'))).toBe('invalid_content');
    expect(reason(() => decodeLibraryBase64('ab$c'))).toBe('invalid_content');
    expect(reason(() => decodeLibraryBase64('AA=A'))).toBe('invalid_content');
    expect(reason(() => decodeLibraryBase64('AB=='))).toBe('invalid_content');
    expect(
      reason(() => decodeLibraryBase64('data:application/pdf;base64,AAAA')),
    ).toBe('invalid_content');
  });
});

describe('storage keys and download names', () => {
  test('keys come from a UUID and the sniffed extension only', () => {
    for (const [type, extension] of [
      ['application/pdf', 'pdf'],
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['application/zip', 'zip'],
    ] as const) {
      const key = libraryStorageKey(type);
      expect(key).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
      expect(key).not.toContain('..');
      expect(key.endsWith('.' + extension)).toBe(true);
      expect(key).not.toContain('invoice');
    }
    expect(libraryStorageKey('application/pdf')).not.toBe(
      libraryStorageKey('application/pdf'),
    );
  });

  test('download headers always attach and keep the sniffed extension', () => {
    expect(
      contentDispositionHeader('synthetic-invoice.pdf', 'application/pdf'),
    ).toBe(
      'attachment; filename="synthetic-invoice.pdf"; filename*=UTF-8\'\'synthetic-invoice.pdf',
    );
    expect(
      contentDispositionHeader('Kundenliste.html', 'application/pdf'),
    ).toBe(
      'attachment; filename="Kundenliste.pdf"; filename*=UTF-8\'\'Kundenliste.pdf',
    );
    const umlaut = contentDispositionHeader('Bühne 🎉.png', 'image/png');
    expect(umlaut).toContain('attachment; filename="B_hne _.png"');
    expect(umlaut).toContain("filename*=UTF-8''B%C3%BChne%20%F0%9F%8E%89.png");
    // Header injection characters never reach the header value.
    const hostile = contentDispositionHeader(
      'a\r\nX-Evil: 1".pdf',
      'application/pdf',
    );
    expect(hostile).not.toContain('\r');
    expect(hostile).not.toContain('\n');
    expect(hostile.startsWith('attachment; filename="')).toBe(true);
  });
});
