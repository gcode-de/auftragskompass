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

  // INQUIRY-INFO-01: the extras name free units, the event and the answer
  // mail - and they survive the tail truncation because they precede the
  // long comment.
  test('the notice extras sit before the comment and name units, event and answer', () => {
    const message = renderWebsiteInquiryTelegramMessage(inquiry, {
      freeUnits: [
        { category: 'Drucker', free: 1, total: 1 },
        { category: 'Fotobox', free: 2, total: 3 },
      ],
      eventLink: { href: 'https://admin.example/#event-2', exact: true },
      replyLink: 'mailto:ada@example.invalid?subject=Ihre%20Anfrage',
    });
    expect(message).toContain(
      'Freie Einheiten am 12.06.2027: Drucker 1/1, Fotobox 2/3',
    );
    expect(message).toContain('Event: https://admin.example/#event-2');
    expect(message).toContain(
      'Antwort-Mail: mailto:ada@example.invalid?subject=Ihre%20Anfrage',
    );
    expect(message.indexOf('Freie Einheiten')).toBeLessThan(
      message.indexOf('Fiktiver Kommentar'),
    );
  });

  test('a day-view event link is labelled as the day, and missing extras add nothing', () => {
    const message = renderWebsiteInquiryTelegramMessage(inquiry, {
      freeUnits: [{ category: 'Fotobox', free: 0, total: 2 }],
      eventLink: {
        href: 'https://admin.example/?from=2027-06-12&to=2027-06-12#events',
        exact: false,
      },
      replyLink: null,
    });
    expect(message).toContain(
      'Events am 12.06.2027: https://admin.example/?from=2027-06-12&to=2027-06-12#events',
    );
    expect(message).not.toContain('Antwort-Mail:');
    expect(message).not.toContain('Event: ');
    const plain = renderWebsiteInquiryTelegramMessage(inquiry, {
      freeUnits: [],
      eventLink: null,
      replyLink: null,
    });
    expect(plain).not.toContain('Freie Einheiten');
    expect(renderWebsiteInquiryTelegramMessage(inquiry)).toBe(plain);
  });

  test('the extras survive the truncation of a long comment', () => {
    const message = renderWebsiteInquiryTelegramMessage(
      {
        ...inquiry,
        submission: {
          ...inquiry.submission,
          fields: { ...inquiry.submission.fields, comment: 'x'.repeat(5000) },
        },
      },
      {
        freeUnits: [{ category: 'Fotobox', free: 2, total: 3 }],
        eventLink: { href: 'https://admin.example/#event-2', exact: true },
        replyLink: 'mailto:ada@example.invalid?subject=Ihre%20Anfrage',
      },
    );
    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message).toContain('[Text gekürzt]');
    expect(message).toContain('Freie Einheiten am 12.06.2027: Fotobox 2/3');
    expect(message).toContain('https://admin.example/#event-2');
    expect(message).toContain('Antwort-Mail:');
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
