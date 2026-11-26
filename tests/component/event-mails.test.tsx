import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  EventMails,
  UndeliveredMailNotice,
  mailDeliveryFailureText,
} from '../../apps/admin/src/EventMails.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const eventId = '55555555-5555-4555-8555-555555555555';
function mail(overrides: Record<string, unknown>) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    accountId: '77777777-7777-4777-8777-777777777777',
    direction: 'out',
    folder: 'drafts',
    editState: 'open',
    sendState: 'scheduled',
    subject: 'Fiktives Angebot',
    from: 'synthetic.sender@example.invalid',
    to: 'synthetic.contact@example.invalid',
    contactId: null,
    eventId,
    threadKey: null,
    createdAt: '2030-10-26T10:00:00.000Z',
    sentAt: null,
    sendErrorCode: null,
    ...overrides,
  };
}

test('a scheduled mail is followed until the worker settles it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const answers = [
    [mail({})],
    [
      mail({
        sendState: 'sent',
        folder: 'sent',
        sentAt: '2030-10-26T10:00:05.000Z',
      }),
    ],
  ];
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async () =>
    Response.json(answers.shift() ?? []),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  expect(await screen.findByText('In der Warteschlange')).toBeTruthy();
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    '/api/v1/mail/messages?eventId=' + eventId,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(await screen.findByText('Gesendet')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(
    'Mail „Fiktives Angebot“ wurde gesendet.',
  );
  // A settled list stops asking.
  const calls = fetcher.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(fetcher.mock.calls.length).toBe(calls);
});

test('a failure turning up while the list is open is announced with its cause', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const answers = [
    [mail({ sendState: 'sending' })],
    [mail({ sendState: 'failed', sendErrorCode: 'attachment_unavailable' })],
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(answers.shift() ?? [])),
  );
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  await screen.findByText('Wird gesendet');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Mail „Fiktives Angebot“: Nicht gesendet. Die Ursache steht in der Liste.',
  );
});

test('a failed mail names its cause and can be queued again', async () => {
  let resent = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      resent = true;
      return Response.json({}, { status: 201 });
    }
    return Response.json([
      resent
        ? mail({})
        : mail({
            sendState: 'failed',
            sendErrorCode: 'provider_recipient_rejected',
          }),
      // Incoming mail belongs to the inbox, not to the delivery list.
      mail({
        id: '88888888-8888-4888-8888-888888888888',
        direction: 'in',
        subject: 'Eingang',
      }),
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventMails eventId={eventId} csrfToken="csrf-token" active revision={0} />,
  );
  const row = (await screen.findByText('Nicht gesendet')).closest('li')!;
  expect(screen.queryByText('Eingang')).toBeNull();
  expect(
    within(row).getByText(
      mailDeliveryFailureText('provider_recipient_rejected'),
    ),
  ).toBeTruthy();
  fireEvent.click(within(row).getByRole('button', { name: 'Erneut senden' }));
  expect(
    await screen.findByText('Mail erneut in der Warteschlange.'),
  ).toBeTruthy();
  expect(await screen.findByText('In der Warteschlange')).toBeTruthy();
  const post = fetcher.mock.calls.find((call) => call[1]?.method === 'POST')!;
  expect(post[0]).toBe(
    '/api/v1/mail/messages/66666666-6666-4666-8666-666666666666/send',
  );
  expect((post[1]!.headers as Record<string, string>)['x-csrf-token']).toBe(
    'csrf-token',
  );
  expect(JSON.parse(String(post[1]!.body)).idempotencyKey).toBeTruthy();
});

test('a refused resend and a failed load are named', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ error: 'not_sendable' }, { status: 409 })
        : Response.json([
            mail({ sendState: 'failed', sendErrorCode: 'x_new' }),
          ]),
    ),
  );
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  // An unknown code is quoted, never hidden.
  expect(await screen.findByText('Fehlercode: x_new')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut senden' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'nicht erneut in die Warteschlange',
  );
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 500 })),
  );
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Mails konnten nicht geladen werden',
  );
});

test('an empty list says so and an inactive area does not load', async () => {
  const fetcher = vi.fn(async () => Response.json([]));
  vi.stubGlobal('fetch', fetcher);
  const { rerender } = render(
    <EventMails
      eventId={eventId}
      csrfToken="csrf"
      active={false}
      revision={0}
    />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  rerender(
    <EventMails eventId={eventId} csrfToken="csrf" active revision={0} />,
  );
  expect(
    await screen.findByText('Noch keine Mail zu diesem Event gesendet.'),
  ).toBeTruthy();
});

test('every page names undelivered mails and links their event', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        mail({ sendState: 'failed', sendErrorCode: 'provider_timeout' }),
        mail({
          id: '99999999-9999-4999-8999-999999999999',
          sendState: 'uncertain',
          eventId: null,
          subject: '',
          sendErrorCode: 'provider_uncertain',
        }),
        mail({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sendState: 'sent' }),
      ]),
    ),
  );
  render(<UndeliveredMailNotice />);
  const notice = await screen.findByRole('region', {
    name: '2 Mails wurden nicht zugestellt',
  });
  expect(
    within(notice).getByRole('link', { name: 'Fiktives Angebot' }),
  ).toHaveProperty('hash', '#event-' + eventId);
  expect(notice.textContent).toContain('(ohne Betreff)');
  expect(notice.textContent).toContain(
    mailDeliveryFailureText('provider_uncertain'),
  );
});

test('the notice stays away while every mail went out', async () => {
  const fetcher = vi.fn(async () =>
    Response.json([mail({ sendState: 'sent' })]),
  );
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<UndeliveredMailNotice />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(fetcher).toHaveBeenCalledWith('/api/v1/mail/messages');
  expect(container.textContent).toBe('');
});

test('every worker failure code has its own wording', () => {
  const codes = [
    'attachment_unavailable',
    'provider_auth_failed',
    'provider_recipient_rejected',
    'provider_rejected',
    'provider_timeout',
    'provider_tls_required',
    'provider_missing',
    'encryption_unavailable',
    'provider_uncertain',
  ];
  const texts = new Set(codes.map((code) => mailDeliveryFailureText(code)));
  expect(texts.size).toBe(codes.length);
  for (const text of texts) expect(text).not.toMatch(/^Fehlercode/);
  expect(mailDeliveryFailureText(null)).toBe('Ohne Fehlercode.');
});

// UI-PARITY-02: Bookitup's folders, derived from the stored send state.
test('the folders filter the mails by their delivery state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        mail({
          id: 'a1111111-1111-4111-8111-111111111111',
          subject: 'Unterwegs',
          sendState: 'sent',
          sentAt: '2030-10-26T10:00:05.000Z',
        }),
        mail({
          id: 'a2222222-2222-4222-8222-222222222222',
          subject: 'Klappte nicht',
          sendState: 'failed',
          sendErrorCode: 'provider_timeout',
        }),
        mail({
          id: 'a3333333-3333-4333-8333-333333333333',
          subject: 'Unklar',
          sendState: 'uncertain',
          sendErrorCode: 'provider_uncertain',
        }),
      ]),
    ),
  );
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  const folders = await screen.findByRole('group', { name: 'Ordner' });
  await screen.findByText('Unterwegs');
  expect(
    within(folders)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Alle (3)', 'Geplant (0)', 'Fehlgeschlagen (2)', 'Gesendet (1)']);
  fireEvent.click(
    within(folders).getByRole('button', { name: 'Fehlgeschlagen (2)' }),
  );
  expect(
    within(folders)
      .getByRole('button', { name: 'Fehlgeschlagen (2)' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  expect(screen.queryByText('Unterwegs')).toBeNull();
  expect(screen.getByText('Klappte nicht')).toBeTruthy();
  expect(screen.getByText('Unklar')).toBeTruthy();
  fireEvent.click(within(folders).getByRole('button', { name: 'Geplant (0)' }));
  expect(screen.getByText('Keine Mail in diesem Ordner.')).toBeTruthy();
});

// QW5: a planned mail names its time, is not polled and can be withdrawn;
// the withdrawn draft can then be sent at once.
test('a planned mail shows its time and its planning can be withdrawn', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let state: 'scheduled' | 'none' = 'scheduled';
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/unschedule')) {
      state = 'none';
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/send')) return Response.json({}, { status: 201 });
    void options;
    return Response.json([
      mail({
        sendState: state,
        scheduledFor: state === 'scheduled' ? '2030-10-28T08:00:00.000Z' : null,
      }),
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  expect(await screen.findByText(/^Geplant für /)).toBeTruthy();
  const loads = fetcher.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(10000);
  });
  expect(fetcher.mock.calls.length).toBe(loads);
  fireEvent.click(screen.getByRole('button', { name: 'Planung aufheben' }));
  expect(
    await screen.findByText(
      'Planung aufgehoben. Die Mail wird nicht gesendet.',
    ),
  ).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/mail/messages/66666666-6666-4666-8666-666666666666/unschedule',
    { method: 'POST', headers: { 'x-csrf-token': 'csrf' } },
  );
  expect(screen.getByText('Nicht gesendet')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt senden' }));
  expect(
    await screen.findByText('Mail erneut in der Warteschlange.'),
  ).toBeTruthy();
});

test('a refused or unclear withdrawal is named', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/unschedule'))
      return Response.json({ error: 'not_scheduled' }, { status: 409 });
    return Response.json([mail({ scheduledFor: '2030-10-28T08:00:00.000Z' })]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Planung aufheben' }),
  );
  expect(await screen.findByText(/vielleicht schon unterwegs/)).toBeTruthy();
  fetcher.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Planung aufheben' }));
  expect(await screen.findByText(/Der Ausgang ist unklar/)).toBeTruthy();
});

// UI-BKP-07: Bookitup's reading pane beside the list.
test('a chosen mail opens in the reading pane with its head and plain text', async () => {
  const second = '88888888-8888-4888-8888-888888888888';
  let detailFails = true;
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async (url) => {
    if (url.endsWith('/' + second))
      return Response.json({ bodyText: 7, cc: '' });
    if (url.includes('/api/v1/mail/messages/')) {
      if (detailFails) return new Response(null, { status: 500 });
      return Response.json({
        bodyText: 'Hallo,\n<b>kein HTML</b>\nGrüße',
        cc: 'synthetic.cc@example.invalid',
      });
    }
    return Response.json([
      mail({ sendState: 'sent', sentAt: '2030-10-26T10:00:05.000Z' }),
      mail({ id: second, subject: 'Zweite fiktive Mail' }),
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  const reader = screen.getByRole('article', { name: 'Gewählte Mail' });
  expect(within(reader).getByText(/Wähle eine Mail aus/)).toBeTruthy();
  const open = await screen.findByRole('button', { name: /Fiktives Angebot/ });
  fireEvent.click(open);
  expect(open.getAttribute('aria-pressed')).toBe('true');
  expect(
    within(reader).getByRole('heading', { name: 'Fiktives Angebot' }),
  ).toBeTruthy();
  // A failed read says so and can be retried in place.
  const retry = await within(reader).findByRole('button', {
    name: 'Erneut laden',
  });
  detailFails = false;
  fireEvent.click(retry);
  const body = await within(reader).findByText(/kein HTML/);
  // The stored text is shown as text: markup stays visible characters.
  expect(body.textContent).toBe('Hallo,\n<b>kein HTML</b>\nGrüße');
  expect(reader.querySelector('b')).toBeNull();
  expect(within(reader).getByText('synthetic.cc@example.invalid')).toBeTruthy();
  expect(within(reader).getByText('Gesendet')).toBeTruthy();
  // A malformed answer is refused instead of showing a wrong text.
  fireEvent.click(screen.getByRole('button', { name: /Zweite fiktive Mail/ }));
  expect(await within(reader).findByRole('alert')).toBeTruthy();
  expect(within(reader).queryByText(/kein HTML/)).toBeNull();
});

test('a late answer for an earlier mail never replaces the chosen one', async () => {
  const second = '88888888-8888-4888-8888-888888888888';
  let releaseFirst: (response: Response) => void = () => {};
  let failFirst: () => void = () => {};
  let round = 0;
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async (url) => {
    if (url.endsWith('/' + second))
      return Response.json({ bodyText: 'Zweiter Text', cc: '' });
    if (url.includes('/api/v1/mail/messages/'))
      return new Promise<Response>((resolve, reject) => {
        round += 1;
        if (round === 1) releaseFirst = resolve;
        else failFirst = () => reject(new Error('late'));
      });
    return Response.json([
      mail({}),
      mail({ id: second, subject: 'Zweite fiktive Mail' }),
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventMails eventId={eventId} csrfToken="csrf" active revision={0} />);
  const reader = screen.getByRole('article', { name: 'Gewählte Mail' });
  fireEvent.click(
    await screen.findByRole('button', { name: /Fiktives Angebot/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: /Fiktives Angebot/ }));
  fireEvent.click(screen.getByRole('button', { name: /Zweite fiktive Mail/ }));
  await within(reader).findByText('Zweiter Text');
  await act(async () => {
    releaseFirst(Response.json({ bodyText: 'Alter Text', cc: '' }));
    failFirst();
  });
  expect(within(reader).getByText('Zweiter Text')).toBeTruthy();
  expect(within(reader).queryByText('Alter Text')).toBeNull();
  expect(within(reader).queryByRole('alert')).toBeNull();
});
