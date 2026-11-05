import { describe, expect, test } from 'vitest';
import { renderWebsiteInquiryTelegramMessage } from '../../packages/core/src/telegram-message.js';

const inquiry = {
  id: '11111111-1111-4111-8111-111111111111',
  receivedAt: '2026-11-01T12:00:00.000Z',
  expiresAt: '2026-11-02T12:00:00.000Z',
  privacyNotice: 'Fiktiver Hinweis',
  privacyUrl: 'https://example.invalid/privacy',
  submission: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    fields: {
      firstName: 'Ada',
      lastName: 'Beispiel',
      email: 'ada@example.invalid',
      eventDate: '2027-06-12',
      phone: '+49 000 000000',
      location: 'Musterort',
      package: 'easy-print-plus',
      comment: 'Fiktiver Kommentar',
    },
  },
};

describe('website inquiry Telegram message', () => {
  test('renders every stored form field as plain text', () => {
    const message = renderWebsiteInquiryTelegramMessage(inquiry);
    for (const value of [
      'Vorname: Ada',
      'Nachname: Beispiel',
      '12.06.2027',
      'ada@example.invalid',
      '+49 000 000000',
      'Musterort',
      'easy print+ (400 Ausdrucke, Drucklayout)',
      'Fiktiver Kommentar',
    ])
      expect(message).toContain(value);
    expect(message).toContain('Gewünschtes Fotobox-Paket');
  });

  test('validates the stored payload and bounds long messages with a visible truncation marker', () => {
    expect(renderWebsiteInquiryTelegramMessage({})).toContain(
      'Details sind in der App verfügbar',
    );
    const message = renderWebsiteInquiryTelegramMessage({
      ...inquiry,
      submission: {
        ...inquiry.submission,
        fields: { ...inquiry.submission.fields, comment: 'x'.repeat(5000) },
      },
    });
    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message).toContain('[Text gekürzt]');
    expect(message).toContain('Vorname');
    expect(message).toContain('Kommentar');
  });

  test('indents line breaks supplied in a comment', () => {
    const message = renderWebsiteInquiryTelegramMessage({
      ...inquiry,
      submission: {
        ...inquiry.submission,
        fields: {
          ...inquiry.submission.fields,
          comment: 'Hallo\nE-Mail: fictional',
        },
      },
    });
    expect(message).toContain('Hallo\n  E-Mail: fictional');
  });
});
