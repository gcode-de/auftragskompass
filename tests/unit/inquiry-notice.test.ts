import { describe, expect, test } from 'vitest';
import {
  countFreeUnits,
  formatNoticeDate,
  inquiryNoticeExtras,
} from '../../packages/core/src/inquiry-notice.js';
import { renderWebsiteInquiryEmail } from '../../packages/core/src/inquiry-email.js';

// INQUIRY-INFO-01: the counting is pure and reuses `bufferedPeriod` - a unit
// is free exactly when no active reservation's buffered period reaches the
// day. All rows are synthetic.

const units = [
  {
    unitId: 'u-1',
    category: 'Fotobox',
    beforeDays: 1,
    afterDays: 1,
  },
  {
    unitId: 'u-2',
    category: 'Fotobox',
    beforeDays: 0,
    afterDays: 0,
  },
  {
    unitId: 'u-3',
    category: 'Drucker',
    beforeDays: 0,
    afterDays: 0,
  },
];

function reservation(overrides: {
  unitId: string;
  startsAt: string;
  endsAt: string;
  state?: string;
}) {
  return { state: 'booked', ...overrides };
}

describe('free unit counting', () => {
  test('a day without reservations leaves every unit free', () => {
    expect(countFreeUnits(units, [], '2027-06-12', 'Europe/Berlin')).toEqual([
      { category: 'Drucker', free: 1, total: 1 },
      { category: 'Fotobox', free: 2, total: 2 },
    ]);
  });

  test('a reservation reaching the day blocks its unit only', () => {
    const reservations = [
      reservation({
        unitId: 'u-1',
        startsAt: '2027-06-12T08:00:00.000Z',
        endsAt: '2027-06-12T16:00:00.000Z',
      }),
    ];
    expect(
      countFreeUnits(units, reservations, '2027-06-12', 'Europe/Berlin'),
    ).toEqual([
      { category: 'Drucker', free: 1, total: 1 },
      { category: 'Fotobox', free: 1, total: 2 },
    ]);
  });

  test('the before/after buffer days widen the block like the conflict rule', () => {
    // u-1 buffers one day before and after: its 13.06 reservation reaches
    // the 12.06, while the same reservation on u-2 would not.
    const reservations = [
      reservation({
        unitId: 'u-1',
        startsAt: '2027-06-13T08:00:00.000Z',
        endsAt: '2027-06-13T16:00:00.000Z',
      }),
    ];
    expect(
      countFreeUnits(units, reservations, '2027-06-12', 'Europe/Berlin'),
    ).toEqual([
      { category: 'Drucker', free: 1, total: 1 },
      { category: 'Fotobox', free: 1, total: 2 },
    ]);
  });

  test('released and expired reservations never block', () => {
    const reservations = [
      reservation({
        unitId: 'u-1',
        startsAt: '2027-06-12T08:00:00.000Z',
        endsAt: '2027-06-12T16:00:00.000Z',
        state: 'released',
      }),
      reservation({
        unitId: 'u-2',
        startsAt: '2027-06-12T08:00:00.000Z',
        endsAt: '2027-06-12T16:00:00.000Z',
        state: 'expired',
      }),
    ];
    expect(
      countFreeUnits(units, reservations, '2027-06-12', 'Europe/Berlin'),
    ).toEqual([
      { category: 'Drucker', free: 1, total: 1 },
      { category: 'Fotobox', free: 2, total: 2 },
    ]);
  });

  test('a reservation that cannot be parsed blocks conservatively', () => {
    const reservations = [
      reservation({
        unitId: 'u-1',
        startsAt: '2027-06-12T16:00:00.000Z',
        endsAt: '2027-06-12T08:00:00.000Z',
      }),
    ];
    expect(
      countFreeUnits(units, reservations, '2027-06-12', 'Europe/Berlin'),
    ).toEqual([
      { category: 'Drucker', free: 1, total: 1 },
      { category: 'Fotobox', free: 1, total: 2 },
    ]);
  });

  test('the date format matches the app language', () => {
    expect(formatNoticeDate('2027-06-12')).toBe('12.06.2027');
  });
});

describe('inquiry notice extras and e-mail', () => {
  test('without date and origin nothing is computed at all', async () => {
    // A throwing connection proves the short path: no query is touched when
    // neither the day counts nor a link can exist.
    const throwing = {
      query: () => {
        throw new Error('Synthetischer Datenbankausfall');
      },
    } as never;
    await expect(
      inquiryNoticeExtras(
        throwing,
        '11111111-1111-4111-8111-111111111111',
        { origin: '' },
        { id: '22222222-2222-4222-8222-222222222222', eventDate: null },
      ),
    ).resolves.toEqual({ freeUnits: [], eventLink: null, replyLink: null });
  });

  test('the e-mail carries the same extras as the Telegram message', () => {
    const mail = renderWebsiteInquiryEmail(
      {
        id: '22222222-2222-4222-8222-222222222222',
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
      },
      {
        freeUnits: [{ category: 'Fotobox', free: 2, total: 3 }],
        eventLink: { href: 'https://admin.example/#event-2', exact: true },
        replyLink: 'mailto:ada@example.invalid?subject=Ihre%20Anfrage',
      },
    );
    expect(mail.subject).toBe('Neue Website-Anfrage');
    expect(mail.text).toContain('Freie Einheiten am 12.06.2027: Fotobox 2/3');
    expect(mail.text).toContain('Event: https://admin.example/#event-2');
    expect(mail.text).toContain('Antwort-Mail: mailto:ada@example.invalid');
    expect(mail.text).toContain(
      'Anfrage-ID: 22222222-2222-4222-8222-222222222222',
    );
  });
});
