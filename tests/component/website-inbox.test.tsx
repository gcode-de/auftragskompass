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
function panel() {
  return screen.getByRole('region', { name: 'Website-Eingänge (Diagnose)' });
}
function openEntry() {
  const row = within(panel())
    .getByText(/Fictional Inbox/)
    .closest('details')!;
  row.open = true;
  fireEvent(row, new Event('toggle'));
  return row;
}
test('the diagnosis section loads itself, leaves the new-contact country to the operator and preserves a review failure until the retry succeeds', async () => {
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
  // The settings section is its own diagnosis surface: it reads on mount.
  expect(fetcher).toHaveBeenCalledTimes(1);
  await within(panel()).findByText(/Fictional Inbox/);
  const row = openEntry();
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
  expect(within(panel()).getByText(/Fictional Inbox/)).toBeTruthy();
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
test('the diagnosis section retries failed reads and pages through bounded results', async () => {
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
  await screen.findByRole('alert');
  fireEvent.click(
    within(panel()).getByRole('button', {
      name: 'Website-Eingänge aktualisieren',
    }),
  );
  await within(panel()).findByText(/Fictional Inbox/);
  fireEvent.click(
    within(panel()).getByRole('button', { name: 'Weitere Eingänge' }),
  );
  await waitFor(() =>
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/v1/website-inquiries?offset=25',
    ),
  );
  fireEvent.click(
    within(panel()).getByRole('button', { name: 'Vorherige Eingänge' }),
  );
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
      return Response.json({
        status: 'duplicate',
        contactId: 'fictional-contact',
      });
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
  await within(panel()).findByText(/Fictional Inbox/);
  const row = openEntry();
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
      if (options)
        return Response.json({
          status: 'created',
          contactId: 'fictional-contact',
        });
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
  await within(panel()).findByText(/Fictional Inbox/);
  const row = openEntry();
  fireEvent.click(
    within(panel()).getByRole('button', {
      name: 'Website-Eingänge aktualisieren',
    }),
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

test('the diagnosis section explains that normal entries need no click and only lists what still needs review', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ items: [], total: 0, offset: 0, limit: 25 }),
    ),
  );
  render(
    <WebsiteInbox csrfToken="fictional" timeZone="UTC" onImported={vi.fn()} />,
  );
  expect(
    screen.getByRole('heading', {
      level: 2,
      name: 'Website-Eingänge (Diagnose)',
    }),
  ).toBeTruthy();
  const view = panel();
  expect(within(view).getByText(/Technische Diagnose/)).toBeTruthy();
  expect(within(view).getByText(/ohne Klick zur Option/)).toBeTruthy();
  expect(within(view).getByText(/kein Pflichtschritt/)).toBeTruthy();
  await within(view).findByText(
    'Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch als Option angelegt.',
  );
  // Only the diagnosis refresh changes entries; the section reads on mount.
  expect(
    within(view)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Website-Eingänge aktualisieren']);
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
  await within(panel()).findByText(/Fictional Inbox/);
  const row = openEntry();
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

test('a contactless import is reported as an open contact instead of an undefined value', async () => {
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
      contactId: null,
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
  await within(panel()).findByText(/Fictional Inbox/);
  const row = openEntry();
  fireEvent.click(
    within(row).getByRole('button', { name: 'Als Option übernehmen' }),
  );
  // A missing contact is a calm normal state, never an "undefined" artefact.
  await screen.findByText(/Kontakt noch offen/);
  expect(screen.queryByText(/undefined/)).toBeNull();
  expect(onImported).toHaveBeenCalledOnce();
});

test('returning to the window refreshes the diagnosis view without polling', async () => {
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
  await within(panel()).findByText(/Fictional Inbox/);
  // The single mount read is enough until the operator returns.
  expect(reads).toBe(1);
  fireEvent.blur(window);
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByText(/Keine offenen Ausnahmen/)).toBeTruthy();
});
