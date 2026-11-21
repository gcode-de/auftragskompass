import { expect, test } from 'vitest';
import {
  MailTemplateError,
  mailTemplateExampleValues,
  mailTemplateFields,
  previewMailTemplate,
} from '../../packages/core/src/mail-templates.js';
import { resolveMailSubject } from '../../packages/core/src/mail-content.js';

// MAIL-TPL-01a: template content rules and the synthetic preview. All values
// are fictional; the preview never derives anything from real records.

test('template fields validate, sanitize and keep the documented placeholders', () => {
  expect(
    mailTemplateFields({
      name: '  Zahlungserinnerung  ',
      subject: 'Erinnerung für {{contact}}',
      bodyHtml:
        '<p>Hallo <strong>{{contactFirstName}}</strong></p><script>evil()</script>',
      state: 'active',
    }),
  ).toEqual({
    name: 'Zahlungserinnerung',
    subject: 'Erinnerung für {{contact}}',
    bodyHtml: '<p>Hallo <strong>{{contactFirstName}}</strong></p>',
    state: 'active',
  });
  // An omitted state means active.
  expect(
    mailTemplateFields({
      name: 'Vorlage',
      subject: 'Betreff',
      bodyHtml: '<p>x</p>',
    }).state,
  ).toBe('active');
});

test('template fields refuse bad names, subjects, bodies, states and unknown placeholders', () => {
  const base = {
    name: 'Vorlage',
    subject: 'Betreff',
    bodyHtml: '<p>x</p>',
    state: 'active' as const,
  };
  const refused = [
    { ...base, name: ' ' },
    { ...base, name: 'x'.repeat(121) },
    // A newline in the subject would split a header.
    { ...base, subject: 'a\nb' },
    { ...base, subject: 'a\r\nb' },
    { ...base, subject: 'x'.repeat(999) },
    { ...base, bodyHtml: 'x'.repeat(200001) },
    { ...base, state: 'deleted' as const },
    { ...base, subject: '{{Kontakt_Vorname}}' },
    { ...base, subject: '{{nope}}' },
    { ...base, bodyHtml: '<p>{{nope}}</p>' },
  ];
  for (const input of refused)
    expect(() => mailTemplateFields(input)).toThrow(MailTemplateError);
  try {
    mailTemplateFields({ ...base, subject: '{{nope}}' });
  } catch (error) {
    expect((error as MailTemplateError).reason).toBe('invalid_content');
  }
  try {
    mailTemplateFields({ ...base, subject: 'a\nb' });
  } catch (error) {
    expect((error as MailTemplateError).reason).toBe('invalid_subject');
  }
});

test('the template preview resolves with the documented synthetic values', () => {
  expect(
    previewMailTemplate({
      subject: 'Erinnerung für {{contactFirstName}} {{contact}}',
      bodyHtml:
        '<p>Hallo {{contactFirstName}}, {{event}} am {{date}} in {{location}} ' +
        '({{eventType}}/{{package}}): {{total}}. ' +
        '<a href="{{documentLink}}">Dokument</a></p>',
    }),
  ).toEqual({
    subject: 'Erinnerung für Alex Alex Beispiel',
    bodyHtml:
      '<p>Hallo Alex, Fiktives Sommerfest am 26.10.2030 in Beispielsaal ' +
      '(Feier/Paket Beispiel): 119,00 €. ' +
      '<a href="https://example.invalid/vorschau">Dokument</a></p>',
    bodyText:
      'Hallo Alex, Fiktives Sommerfest am 26.10.2030 in Beispielsaal ' +
      '(Feier/Paket Beispiel): 119,00 €. Dokument (https://example.invalid/vorschau)',
    missing: [],
  });
  // Nothing is invented for unknown placeholders; they are refused.
  expect(() =>
    previewMailTemplate({ subject: '{{nope}}', bodyHtml: '<p>x</p>' }),
  ).toThrow(MailTemplateError);
});

test('the example values are complete and clearly fictional', () => {
  expect(Object.keys(mailTemplateExampleValues).sort()).toEqual(
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
  expect(mailTemplateExampleValues.documentLink).toContain('example.invalid');
  expect(mailTemplateExampleValues.contactFirstName).toBe('Alex');
});

test('a resolved subject stays one line whatever a value contains', () => {
  expect(
    resolveMailSubject('Hallo {{contact}}', {
      contact: 'Muster & Co\r\nBcc: injiziert@example.invalid',
    }),
  ).toEqual({
    subject: 'Hallo Muster & Co Bcc: injiziert@example.invalid',
    missing: [],
  });
  expect(resolveMailSubject('{{contact}} / {{package}}', {})).toEqual({
    subject: '{{contact}} / {{package}}',
    missing: ['contact', 'package'],
  });
});
