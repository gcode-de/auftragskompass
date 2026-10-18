import { afterEach, test, expect, vi } from 'vitest';
import { createInquirySubmission } from '../../apps/widget/src/inquiry-client.js';
const fields = {
  firstName: 'Fictional',
  lastName: 'Visitor',
  email: 'visitor@example.invalid',
  eventDate: '2030-10-27',
  phone: '+49 000 000000',
  location: 'Fictional demonstration hall',
  package: 'easy-print-plus' as const,
  comment: 'Fictional original <message>',
};
const origin = 'https://fictional-gateway.example.invalid';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test('public submission snapshots all original fields, signs no internal identity and uses only the fixed HTTPS route without cookies or redirects', async () => {
  const input = { ...fields },
    attempt = createInquirySubmission(origin, input);
  input.firstName = 'Changed';
  const fetcher = vi.fn(async () =>
    Response.json({ status: 'received' }, { status: 202 }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await attempt.send()).toEqual({ status: 'received' });
  const [url, options] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe(origin + '/public/v1/forms/fotobox-bw-main/inquiries');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
  });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  const payload = JSON.parse(options.body as string);
  expect(payload).toEqual({
    submissionId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    submission: { formId: 'fotobox-bw-main', formVersion: 1, fields },
  });
  expect(await attempt.send()).toEqual({ status: 'received' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('lost replies and parallel retries keep the same immutable submission ID and request body', async () => {
  const attempt = createInquirySubmission(origin, fields, '');
  let rejectRequest!: (reason: unknown) => void;
  const fetcher = vi.fn(
    async () =>
      new Promise<Response>((_resolve, reject) => {
        rejectRequest = reject;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const first = attempt.send(),
    second = attempt.send();
  expect(first).toBe(second);
  const failure = expect(first).rejects.toMatchObject({
    reason: 'unavailable',
    message: 'Inquiry submission unavailable',
  });
  rejectRequest(new Error('fictional private transport details'));
  await failure;
  const originalBody = (
    fetcher.mock.calls[0] as unknown as [string, RequestInit]
  )[1].body;
  const retry = vi.fn(async () =>
    Response.json({ status: 'received' }, { status: 202 }),
  );
  vi.stubGlobal('fetch', retry);
  expect(await attempt.send()).toEqual({ status: 'received' });
  expect(
    (retry.mock.calls[0] as unknown as [string, RequestInit])[1].body,
  ).toBe(originalBody);
});
test('unsafe gateway origins never send; non-success statuses have neutral stable reasons without copying the server body', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const unsafe of [
    'http://fictional.example.invalid',
    'https://user:password@fictional.example.invalid',
    'https://fictional.example.invalid/path',
    'https://fictional.example.invalid/?secret=fictional',
    'https://fictional.example.invalid/#fragment',
    'invalid',
  ])
    expect(() => createInquirySubmission(unsafe, fields)).toThrow(
      'Inquiry submission unavailable',
    );
  expect(fetcher).not.toHaveBeenCalled();
  for (const [status, reason] of [
    [400, 'rejected'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
  ] as const) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('fictional private error', { status })),
    );
    await expect(
      createInquirySubmission(origin, fields).send(),
    ).rejects.toMatchObject({
      reason,
      message: 'Inquiry submission unavailable',
    });
  }
});
test('malformed, unbounded, incomplete or unexpected success responses never claim receipt', async () => {
  for (const response of [
    () =>
      Response.json(
        { status: 'received', internalId: 'fictional' },
        { status: 202 },
      ),
    () => Response.json({ status: 'booked' }, { status: 202 }),
    () => new Response('{}', { status: 200 }),
    () =>
      new Response(null, {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('{}', {
        status: 202,
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('x'.repeat(4097), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('{}', {
        status: 202,
        headers: {
          'content-type': 'application/json',
          'content-length': '4097',
        },
      }),
    () =>
      new Response(new Uint8Array([255]), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('{broken', {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('fictional stream error'));
          },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    await expect(
      createInquirySubmission(origin, fields).send(),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  }
});
test('the fixed ten-second signal aborts a stalled submission without changing its retry ID', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetcher = vi.fn(
    async (_url: unknown, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        options!.signal!.addEventListener(
          'abort',
          () => reject(options!.signal!.reason),
          { once: true },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = createInquirySubmission(origin, fields).send();
  const failure = expect(pending).rejects.toMatchObject({
    reason: 'unavailable',
  });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10000);
  controller.abort();
  await failure;
});
