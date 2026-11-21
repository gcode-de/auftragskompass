import { expect, test } from 'vitest';
import {
  inquiryEmailSubject,
  inquiryEmailKey,
  renderWebsiteInquiryEmail,
} from '../../packages/core/src/inquiry-email.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form-definition.js';

// MAIL-NOTIFY-01: synthetic inquiry only. No provider, no real address.
const id = '11111111-2222-4333-8444-555555555555';
const value = () => ({
  id,
  receivedAt: '2030-11-02T10:00:00.000Z',
  expiresAt: '2030-11-03T10:00:00.000Z',
  submission: {
    formId: 'fotobox-bw-main' as const,
    formVersion: 1 as const,
    fields: {
      firstName: 'Fictional',
      lastName: 'Mail',
      email: 'mail.notify@example.invalid',
      eventDate: '2030-11-14',
      package: 'easy-print' as const,
      comment: 'Synthetic note.',
    },
  },
  privacyNotice: inquiryFormV1.privacyNotice,
  privacyUrl: inquiryFormV1.privacyUrl,
});

test('renders the same bounded field summary as Telegram plus the inquiry reference', () => {
  const mail = renderWebsiteInquiryEmail(value());
  expect(mail.subject).toBe(inquiryEmailSubject);
  expect(mail.subject).toBe('Neue Website-Anfrage');
  expect(mail.text).toContain('Vorname: Fictional');
  expect(mail.text).toContain('E-Mail: mail.notify@example.invalid');
  expect(mail.text).toContain('Veranstaltungsdatum: 14.11.2030');
  expect(mail.text).toContain(
    'Gewünschtes Fotobox-Paket: easy print (zusätzlich 200 Ausdrucke)',
  );
  expect(mail.text).toContain('Anfrage-ID: ' + id);
});

test('falls back to a neutral notice for unknown input, without a reference', () => {
  expect(renderWebsiteInquiryEmail({ fixture: 'fictional' })).toEqual({
    subject: 'Neue Website-Anfrage',
    text: 'Neue Website-Anfrage ist im AuftragsKompass eingegangen. Details sind in der App verfügbar.',
  });
});

test('bounds a long body exactly like the Telegram message', () => {
  const long = value();
  const mail = renderWebsiteInquiryEmail({
    ...long,
    submission: {
      ...long.submission,
      fields: { ...long.submission.fields, comment: 'x'.repeat(5000) },
    },
  });
  expect(mail.text).toContain('[Text gekürzt]');
  expect(mail.text.length).toBeLessThanOrEqual(4096 + 60);
});

test('the idempotency key names one inquiry and stays stable', () => {
  expect(inquiryEmailKey(id)).toBe('inquiry-notification:' + id);
  expect(inquiryEmailKey(id)).toBe(inquiryEmailKey(id));
  expect(inquiryEmailKey(id)).not.toBe(
    inquiryEmailKey('11111111-2222-4333-8444-666666666666'),
  );
});
