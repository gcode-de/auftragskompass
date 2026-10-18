import { expect, test } from 'vitest';
import { isWebsiteInquiry } from '../../packages/core/src/website-inquiries.js';
const valid = () => ({
  id: '00000000-0000-4000-8000-000000000001',
  receivedAt: '2030-10-26T10:00:00.000Z',
  expiresAt: '2030-10-27T10:00:00.000Z',
  submission: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    fields: {
      firstName: 'Fictional',
      lastName: 'Example',
      email: 'fictional@example.invalid',
      eventDate: '2030-10-27',
    },
  },
  privacyNotice: 'Fictional privacy notice',
  privacyUrl: 'https://fictional.example.invalid/privacy',
});
test('validates complete immutable delivery metadata without converting values', () => {
  const value = valid(),
    before = structuredClone(value);
  expect(isWebsiteInquiry(value)).toBe(true);
  expect(value).toEqual(before);
  for (const input of [
    null,
    [],
    { ...value, expiresAt: value.receivedAt },
    { ...value, receivedAt: '2030-10-26T10:00:00+00:00' },
    { ...value, privacyNotice: 'fictional\ud800' },
    { ...value, privacyUrl: 'http://fictional.example.invalid/privacy' },
    {
      ...value,
      submission: {
        ...value.submission,
        fields: { ...value.submission.fields, eventDate: '2030-02-30' },
      },
    },
  ])
    expect(isWebsiteInquiry(input)).toBe(false);
  expect(
    isWebsiteInquiry(
      Object.defineProperty({}, 'id', {
        get: () => {
          throw new Error('fictional-private');
        },
      }),
    ),
  ).toBe(false);
});
