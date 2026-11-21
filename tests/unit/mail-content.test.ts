import { expect, test } from 'vitest';
import {
  MailContentError,
  assertMailPlaceholders,
  escapeMailHtmlText,
  mailBodyTextFromHtml,
  mailPlaceholderValues,
  mailPlaceholders,
  resolveMailPlaceholders,
  sanitizeMailHtml,
} from '../../packages/core/src/mail-content.js';

// MAIL-EDITOR-01b: the mail body contract. The editor may only produce the
// allowlist below; the server keeps it anyway, so nothing here trusts the
// client. Every fixture is synthetic.

test('the mail allowlist keeps editor formatting and nothing else', () => {
  const clean = sanitizeMailHtml(
    '<p>Hi <strong>bold</strong> <em>e</em> <u>u</u></p>' +
      '<ul><li>a</li></ul><ol><li>b</li></ol>' +
      '<br><a href="https://example.invalid">link</a>',
  );
  expect(clean).toBe(
    '<p>Hi <strong>bold</strong> <em>e</em> <u>u</u></p>' +
      '<ul><li>a</li></ul><ol><li>b</li></ol>' +
      '<br /><a href="https://example.invalid">link</a>',
  );
});

test.each([
  ['<script>alert(1)</script><p>t</p>', '<p>t</p>'],
  ['<img src="x" onerror="alert(1)">', ''],
  ['<p onclick="x">t</p>', '<p>t</p>'],
  ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
  ['<a href="data:text/html,x">x</a>', '<a>x</a>'],
  [
    '<a href="mailto:a@example.invalid">x</a>',
    '<a href="mailto:a@example.invalid">x</a>',
  ],
  ['<a href="//example.invalid">x</a>', '<a>x</a>'],
  ['<style>p{}</style><p>kept</p>', '<p>kept</p>'],
  ['<iframe src="https://example.invalid"></iframe><p>kept</p>', '<p>kept</p>'],
  ['<div><p onclick="">ok</p></div>', '<p>ok</p>'],
  ['<p>unclosed', '<p>unclosed</p>'],
  ['<svg><script>x</script></svg><p>kept</p>', '<p>kept</p>'],
  ['<p style="color:red">t</p>', '<p>t</p>'],
  [
    '<a href="https://x.invalid" target="_blank">x</a>',
    '<a href="https://x.invalid">x</a>',
  ],
])('sanitize removes attack surface: %j', (input, expected) => {
  expect(sanitizeMailHtml(input)).toBe(expected);
});

test('the text alternative follows the documented conversion rules', () => {
  expect(mailBodyTextFromHtml('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
  expect(mailBodyTextFromHtml('<p>a<br />b</p>')).toBe('a\nb');
  expect(mailBodyTextFromHtml('<ul><li>first</li><li>second</li></ul>')).toBe(
    '- first\n- second',
  );
  expect(mailBodyTextFromHtml('<ol><li>x</li><li>y</li></ol>')).toBe(
    '1. x\n2. y',
  );
  expect(
    mailBodyTextFromHtml('<p><a href="https://x.invalid">Seite</a></p>'),
  ).toBe('Seite (https://x.invalid)');
  expect(
    mailBodyTextFromHtml('<a href="https://x.invalid">https://x.invalid</a>'),
  ).toBe('https://x.invalid');
  expect(mailBodyTextFromHtml('<p>A &amp; B &lt;c&gt;</p>')).toBe('A & B <c>');
  expect(mailBodyTextFromHtml('<p><strong>bo</strong>ld</p>')).toBe('bold');
  expect(
    mailBodyTextFromHtml('<p>Intro</p><ul><li>a</li></ul><p>Ende</p>'),
  ).toBe('Intro\n\n- a\n\nEnde');
  expect(mailBodyTextFromHtml('<p>a</p><p></p><p>b</p>')).toBe('a\n\nb');
  expect(mailBodyTextFromHtml(' <p> a </p> ')).toBe('a');
});

test('the placeholder set is the document set plus the contact first name', () => {
  expect([...mailPlaceholders].sort()).toEqual(
    [
      'contact',
      'contactFirstName',
      'date',
      'documentLink',
      'event',
      'eventType',
      'location',
      'package',
      'total',
    ].sort(),
  );
});

test('unknown placeholders are invalid content, known ones are accepted', () => {
  expect(() => assertMailPlaceholders('{{contact}}')).not.toThrow();
  expect(() => assertMailPlaceholders('{{contactFirstName}}')).not.toThrow();
  expect(() => assertMailPlaceholders('{{ contact }}')).not.toThrow();
  expect(() => assertMailPlaceholders('{{contactFirstNameX}}')).toThrow(
    MailContentError,
  );
  expect(() => assertMailPlaceholders('{{nope}}')).toThrow(MailContentError);
  expect(() => assertMailPlaceholders('{{}}')).toThrow(MailContentError);
  try {
    assertMailPlaceholders('{{nope}}');
  } catch (error) {
    expect((error as MailContentError).reason).toBe('invalid_content');
  }
});

test('resolution replaces known values and keeps missing ones transparent', () => {
  const resolved = resolveMailPlaceholders(
    'Hallo {{contactFirstName}}, {{contact}} und {{nope}}!',
    { contactFirstName: 'Erika', contact: 'Fictional' },
  );
  expect(resolved.text).toBe('Hallo Erika, Fictional und {{nope}}!');
  expect(resolved.missing).toEqual([]);
  const missing = resolveMailPlaceholders(
    'Hallo {{contactFirstName}} für {{contact}} ({{contact}})',
    { contact: 'Fictional' },
  );
  expect(missing.text).toBe(
    'Hallo {{contactFirstName}} für Fictional (Fictional)',
  );
  expect(missing.missing).toEqual(['contactFirstName']);
});

test('values are escaped once for HTML insertion', () => {
  expect(escapeMailHtmlText('<b>&"\'</b>')).toBe(
    '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;',
  );
  const resolved = resolveMailPlaceholders('{{contact}}', {
    contact: '<script>x</script>',
  });
  expect(resolved.text).toBe('<script>x</script>');
  const html = sanitizeMailHtml(
    '<p>' + escapeMailHtmlText('<script>x</script>') + '</p>',
  );
  expect(html).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
});

test('placeholder values come from structured fields only', () => {
  const sources = {
    origin: 'https://admin.example.invalid',
    document: { id: 'doc-1', grossMinor: 11900 },
    contact: { name: 'Fictional', firstName: 'Erika' },
    event: {
      name: 'Fictional event',
      eventDate: '2030-06-15',
      venue: 'Fictional Hall 1',
      venueOverride: true,
      locationName: 'Fictional stock location',
      eventTypeName: 'Fictional type',
      packageName: 'Fictional package',
    },
    timezone: 'Europe/Berlin',
  } satisfies Parameters<typeof mailPlaceholderValues>[0];
  expect(mailPlaceholderValues(sources)).toEqual({
    contact: 'Fictional',
    contactFirstName: 'Erika',
    event: 'Fictional event',
    date: '15.06.2030',
    location: 'Fictional Hall 1',
    eventType: 'Fictional type',
    package: 'Fictional package',
    total: '119,00 €',
    documentLink: 'https://admin.example.invalid/#document-doc-1',
  });
  // An emptied free-text venue is transparently missing, never the stock
  // location; without a first name the token keeps standing; a missing
  // origin means no document link.
  expect(
    mailPlaceholderValues({
      ...sources,
      origin: '',
      contact: { name: 'Fictional', firstName: '' },
      event: { ...sources.event, venue: '  ' },
    }),
  ).toEqual({
    contact: 'Fictional',
    event: 'Fictional event',
    date: '15.06.2030',
    eventType: 'Fictional type',
    package: 'Fictional package',
    total: '119,00 €',
  });
  // Without the override the stock location name is the effective place.
  expect(
    mailPlaceholderValues({
      ...sources,
      contact: null,
      event: { ...sources.event, venueOverride: false },
    }),
  ).toMatchObject({ location: 'Fictional stock location' });
  expect(
    mailPlaceholderValues({ ...sources, contact: null, event: null }),
  ).toEqual({
    total: '119,00 €',
    documentLink: 'https://admin.example.invalid/#document-doc-1',
  });
});
