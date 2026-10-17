import { expect, test } from 'vitest';
import { renderIcs, type IcsEvent } from '../../packages/core/src/ics.js';
const event: IcsEvent = {
  id: 'fictional-event',
  name: 'Fictional ä; event, \\ test\r\nATTENDEE:injection',
  status: 'booked',
  eventDate: '2030-03-31',
  startsAt: new Date('2030-03-31T00:00Z'),
  endsAt: new Date('2030-03-31T02:00Z'),
  location: 'Fictional Hall',
  description: 'Fictional description',
  eventType: 'Fictional type',
  resources: ['FB1 #1'],
};
const options = { description: false, eventType: false, internalLink: false };
function parsed(ics: string) {
  return ics
    .replace(/\r\n /g, '')
    .split('\r\n')
    .map((line) => [
      line.slice(0, line.indexOf(':')),
      line.slice(line.indexOf(':') + 1),
    ]);
}
test('ICS uses CRLF, UTF-8-safe folding, escaped text, UTC times and stable private UIDs', () => {
  const text = renderIcs(
    'fictional-tenant',
    [{ ...event, name: event.name + '🎉'.repeat(60) }],
    7,
    new Date('2030-01-01Z'),
    options,
    'https://admin.example.invalid',
  );
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  for (const line of text.split('\r\n'))
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  const values = parsed(text);
  expect(values).toContainEqual(['DTSTART', '20300331T000000Z']);
  expect(values).toContainEqual(['DTEND', '20300331T020000Z']);
  expect(values).toContainEqual(['SEQUENCE', '7']);
  expect(values).toContainEqual(['STATUS', 'CONFIRMED']);
  expect(values.filter(([name]) => name === 'ATTENDEE')).toHaveLength(0);
  expect(text).not.toContain('fictional-tenant');
  expect(text).not.toContain('Fictional description');
  expect(text).not.toContain('Fictional type');
  expect(text).not.toContain('URL:');
  expect(values.find(([key]) => key === 'SUMMARY')![1]).toContain(
    'ä\\; event\\, \\\\ test\\nATTENDEE:injection',
  );
  const again = parsed(
    renderIcs(
      'fictional-tenant',
      [event],
      8,
      new Date('2030-02-01Z'),
      options,
      'https://admin.example.invalid',
    ),
  );
  expect(again.find(([key]) => key === 'UID')).toEqual(
    values.find(([key]) => key === 'UID'),
  );
  expect(
    parsed(
      renderIcs(
        'other-tenant',
        [event],
        7,
        new Date('2030-01-01Z'),
        options,
        'https://admin.example.invalid',
      ),
    ).find(([key]) => key === 'UID'),
  ).not.toEqual(values.find(([key]) => key === 'UID'));
});
test('all-day DST dates, cancellation and selected optional fields remain valid', () => {
  const text = renderIcs(
    'fictional-tenant',
    [
      { ...event, status: 'cancelled', startsAt: null, endsAt: null },
      { ...event, id: 'option', status: 'option' },
      {
        ...event,
        id: 'undated',
        eventDate: null,
        startsAt: null,
        endsAt: null,
      },
      { ...event, id: 'unavailable', status: 'unavailable' },
    ],
    9,
    new Date('2030-02-01Z'),
    { description: true, eventType: true, internalLink: true },
    'https://admin.example.invalid',
  );
  const values = parsed(text);
  expect(values).toContainEqual(['DTSTART;VALUE=DATE', '20300331']);
  expect(values).toContainEqual(['DURATION', 'P1D']);
  expect(values).toContainEqual(['STATUS', 'CANCELLED']);
  expect(values).toContainEqual(['STATUS', 'TENTATIVE']);
  expect(text).toContain('Fictional description');
  expect(text).toContain('Fictional type');
  expect(text).toContain(
    'URL:https://admin.example.invalid/#event-fictional-event',
  );
  expect(
    values.filter(([k, v]) => k === 'BEGIN' && v === 'VEVENT'),
  ).toHaveLength(3);
});
