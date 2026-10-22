import { afterEach, test, expect, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { WebsiteInbox } from '../../apps/admin/src/WebsiteInbox.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const item = {
  id: 'fictional-inquiry',
  original: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    receivedAt: '2030-10-26T10:00:00.000Z',
    privacyNotice: 'Fictional original privacy',
    privacyUrl: 'https://fictional.example.invalid/privacy',
    fields: [
      { label: 'Vorname', value: 'Fictional' },
      { label: 'Nachname', value: 'Inbox' },
      { label: 'E-Mail', value: 'fictional@example.invalid' },
      { label: 'Veranstaltungsdatum', value: '27.10.2030' },
      { label: 'Telefonnummer', value: '' },
      { label: 'Veranstaltungsort', value: '' },
      { label: 'Gewünschtes Fotobox-Paket', value: '' },
      {
        label: 'Kommentar',
        value: 'Fictional <script>text</script>\n' + 'x'.repeat(5000),
      },
    ],
  },
};
function open() {
  const d = screen
    .getByText('Website-Eingänge (Ausnahmen)')
    .closest('details')!;
  d.open = true;
  fireEvent(d, new Event('toggle'));
}
test('inbox loads on demand, leaves the new-contact country to the operator and preserves a review failure until the retry succeeds', async () => {
  let imported = false,
    attempt = 0;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (!options)
      return Response.json({
        items: imported ? [] : [item],
        total: imported ? 0 : 1,
        offset: 0,
        limit: 25,
      });
    attempt++;
    if (attempt === 1)
      return Response.json({ error: 'contact_review' }, { status: 409 });
    imported = true;
    return Response.json({
      status: 'created',
      eventId: 'fictional-event',
      contactId: 'fictional-contact',
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const onImported = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <WebsiteInbox
      csrfToken="fictional-csrf"
      timeZone="Europe/Berlin"
      onImported={onImported}
    />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  open();
  await screen.findByText(/Fictional Inbox/);
  const row = screen.getByText(/Fictional Inbox/).closest('details')!;
  row.open = true;
  fireEvent(row, new Event('toggle'));
  expect(
    (
      within(row).getByLabelText(
        'Land für einen neuen Kontakt (2-Buchstaben-Code)',
      ) as HTMLInputElement
    ).value,
  ).toBe('');
  expect(row.querySelectorAll('dt')).toHaveLength(8);
  expect(view.container.querySelector('script')).toBeNull();
  fireEvent.submit(
    within(row)
      .getByRole('button', { name: 'Als Option übernehmen' })
      .closest('form')!,
  );
  await screen.findByRole('alert');
  expect(screen.getByText(/Fictional Inbox/)).toBeTruthy();
  expect(onImported).not.toHaveBeenCalled();
  fireEvent.change(
    within(row).getByLabelText(
      'Land für einen neuen Kontakt (2-Buchstaben-Code)',
    ),
    { target: { value: 'AT' } },
  );
  fireEvent.submit(
    within(row)
      .getByRole('button', { name: 'Als Option übernehmen' })
      .closest('form')!,
  );
  await screen.findByText(
    'Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch als Option angelegt.',
  );
  expect(onImported).toHaveBeenCalledOnce();
  const writes = fetcher.mock.calls.filter((call) => call[1]);
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[1]![1]!.body as string)).toEqual({
    newContactCountry: 'AT',
  });
  expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({});
  expect(writes[1]![1]!.headers).toEqual({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
});
test('inbox retries failed reads and pages through bounded results', async () => {
  let requests = 0;
  const fetcher = vi.fn(async (url: string) => {
    requests++;
    if (requests === 1) throw new Error('offline');
    return Response.json({
      items: [item],
      total: 26,
      offset: url.endsWith('25') ? 25 : 0,
      limit: 25,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <WebsiteInbox csrfToken="fictional" timeZone="UTC" onImported={vi.fn()} />,
  );
  open();
  await screen.findByRole('alert');
  fireEvent.click(
    screen.getByRole('button', { name: 'Website-Eingänge aktualisieren' }),
  );
  await screen.findByText(/Fictional Inbox/);
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Eingänge' }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/v1/website-inquiries?offset=25',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vorherige Eingänge' }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/v1/website-inquiries?offset=0',
    ),
  );
});

test('failed and malformed import responses keep values; a confirmed duplicate survives a failed event-list refresh', async () => {
  let imported = false,
    attempt = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options)
        return Response.json({
          items: imported ? [] : [item],
          total: imported ? 0 : 1,
          offset: 0,
          limit: 25,
        });
      attempt++;
      if (attempt === 1) return new Response('offline', { status: 503 });
      if (attempt === 2) throw new Error('offline');
      if (attempt === 3) return Response.json({ status: 'unrecognized' });
      if (attempt === 4)
        return Response.json({ error: 'conflict' }, { status: 409 });
      imported = true;
      return Response.json({ status: 'duplicate' });
    }),
  );
  const onImported = vi.fn().mockRejectedValue(new Error('event list offline'));
  render(
    <WebsiteInbox
      csrfToken="fictional"
      timeZone="UTC"
      onImported={onImported}
    />,
  );
  open();
  await screen.findByText(/Fictional Inbox/);
  const row = screen.getByText(/Fictional Inbox/).closest('details')!;
  row.open = true;
  fireEvent(row, new Event('toggle'));
  const country = within(row).getByLabelText(
    'Land für einen neuen Kontakt (2-Buchstaben-Code)',
  );
  fireEvent.change(country, { target: { value: 'DE' } });
  for (let i = 0; i < 4; i++) {
    fireEvent.submit(
      within(row)
        .getByRole('button', { name: 'Als Option übernehmen' })
        .closest('form')!,
    );
    await screen.findByRole('alert');
    expect(onImported).not.toHaveBeenCalled();
  }
  expect((country as HTMLInputElement).value).toBe('DE');
  fireEvent.submit(
    within(row)
      .getByRole('button', { name: 'Als Option übernehmen' })
      .closest('form')!,
  );
  await screen.findByText(
    'Als Option übernommen. Die Eventliste konnte nicht neu geladen werden; sie wird bei der nächsten Rückkehr aktualisiert.',
  );
  await screen.findByText(
    'Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch als Option angelegt.',
  );
});

test('an older read cannot reintroduce an entry after confirmed import and a newer refresh', async () => {
  let reads = 0,
    resolveOld!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) return Response.json({ status: 'created' });
      reads++;
      if (reads === 2)
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      return Response.json({
        items: reads === 1 ? [item] : [],
        total: reads === 1 ? 1 : 0,
        offset: 0,
        limit: 25,
      });
    }),
  );
  render(
    <WebsiteInbox
      csrfToken="fictional"
      timeZone="UTC"
      onImported={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  open();
  await screen.findByText(/Fictional Inbox/);
  const row = screen.getByText(/Fictional Inbox/).closest('details')!;
  row.open = true;
  fireEvent(row, new Event('toggle'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Website-Eingänge aktualisieren' }),
  );
  fireEvent.submit(
    within(row)
      .getByRole('button', { name: 'Als Option übernehmen' })
      .closest('form')!,
  );
  await screen.findByText(
    'Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch als Option angelegt.',
  );
  resolveOld(Response.json({ items: [item], total: 1, offset: 0, limit: 25 }));
});

test('the exceptions view explains that normal entries need no click and only lists what still needs review', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ items: [], total: 0, offset: 0, limit: 25 }),
    ),
  );
  render(
    <WebsiteInbox csrfToken="fictional" timeZone="UTC" onImported={vi.fn()} />,
  );
  const panel = screen
    .getByText('Website-Eingänge (Ausnahmen)')
    .closest('details')!;
  expect(
    within(panel).getByText(/automatisch als Option angelegt/),
  ).toBeTruthy();
  // Only the recovery button changes entries; loading is triggered by opening.
  expect(
    within(panel)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Website-Eingänge aktualisieren']);
  open();
  await screen.findByText(
    'Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch als Option angelegt.',
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

test('without a country field the operator can retry an identity exception unchanged', async () => {
  let imported = false;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options)
      return Response.json({
        items: imported ? [] : [item],
        total: imported ? 0 : 1,
        offset: 0,
        limit: 25,
      });
    imported = true;
    return Response.json({
      status: 'created',
      eventId: 'fictional-event',
      contactId: 'fictional-contact',
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const onImported = vi.fn().mockResolvedValue(undefined);
  render(
    <WebsiteInbox
      csrfToken="fictional-csrf"
      timeZone="UTC"
      onImported={onImported}
    />,
  );
  open();
  await screen.findByText(/Fictional Inbox/);
  const row = screen.getByText(/Fictional Inbox/).closest('details')!;
  row.open = true;
  fireEvent(row, new Event('toggle'));
  fireEvent.click(
    within(row).getByRole('button', { name: 'Als Option übernehmen' }),
  );
  await screen.findByText(
    'Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch als Option angelegt.',
  );
  expect(onImported).toHaveBeenCalledOnce();
  const writes = fetcher.mock.calls.filter((call) => call[1]);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({});
});

test('returning to the window refreshes only an open exceptions view', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      reads++;
      return Response.json({
        items: reads === 1 ? [item] : [],
        total: reads === 1 ? 1 : 0,
        offset: 0,
        limit: 25,
      });
    }),
  );
  render(
    <WebsiteInbox csrfToken="fictional" timeZone="UTC" onImported={vi.fn()} />,
  );
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  // Closed: a foreground return does not read anything.
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
  expect(reads).toBe(0);
  open();
  await screen.findByText(/Fictional Inbox/);
  // Open: the same return re-reads once, without polling.
  fireEvent.blur(window);
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByText(/Keine offenen Ausnahmen/)).toBeTruthy();
});
