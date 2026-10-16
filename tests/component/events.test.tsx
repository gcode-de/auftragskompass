import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic event',
  status: 'inquiry',
  eventDate: null,
  startsAt: null,
  endsAt: null,
  timeZone: 'Europe/Berlin',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  description: '',
  notesHtml: '<strong>Fictional</strong>',
};
function mocker(errors: string[] = [], supplied: Record<string, unknown> = {}) {
  let rows = [{ ...row, ...supplied }];
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      if (errors.length)
        return Response.json({ error: errors.shift() }, { status: 409 });
      rows = [{ ...row, ...JSON.parse(String(options.body)) }];
      return Response.json(rows[0]);
    }
    if (url.startsWith('/api/v1/events'))
      return Response.json({ timeZone: 'Europe/Berlin', events: rows });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'cancelled', label: 'Annulliert' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    return Response.json([
      { id: 'fictional-option', name: 'Synthetic choice', state: 'active' },
    ]);
  });
}
test('events create without date, retain formatted notes and edit/cancel with version checks', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Synthetic new event' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic new event – Ohne Datum – Anfrage');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic new event',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Event abbrechen' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Event bearbeiten: Synthetic new event',
    }),
  );
  fireEvent.change(screen.getByLabelText('Eventstatus'), {
    target: { value: 'cancelled' },
  });
  fireEvent.change(screen.getByLabelText('Eventdatum'), {
    target: { value: '2026-07-01' },
  });
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-07-01T18:00' },
  });
  fireEvent.change(screen.getByLabelText('Eventende'), {
    target: { value: '2026-07-02T01:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic new event – 01.07.2026 – Annulliert');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/synthetic',
    expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('2026-07-01T16:00:00Z'),
    }),
  );
});
test('events show invalid dates, conflicts, server and transport failures while retaining draft', async () => {
  const fetcher = mocker([
    'conflict',
    'invalid_reference',
    'reservations_need_review',
    'import_review_required',
  ]);
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '2026-03-29T02:30' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Termin prüfen/);
  fireEvent.change(screen.getByLabelText('Eventbeginn'), {
    target: { value: '' },
  });
  for (const message of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /gemeinsam geprüft/,
    /Ungeprüfte Bestandszusagen zuerst/,
  ]) {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
    );
    await screen.findByText(message);
  }
  fetcher.mockRejectedValue(Error('offline'));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText(/Verbindung fehlgeschlagen/);
  fireEvent.click(screen.getByRole('button', { name: 'Events aktualisieren' }));
  await screen.findByText(/Events konnten nicht geladen/);
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText(/Events konnten nicht geladen/);
});
test('duplicating an event creates a new inquiry and does not update its source', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event duplizieren: Synthetic event',
    }),
  );
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Synthetic event (Kopie)',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic event (Kopie) – Ohne Datum – Anfrage');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Synthetic event (Kopie)'),
    }),
  );
});

test('event copies retain active references and require new choices for archived records', async () => {
  const fetcher = mocker([], {
    status: 'cancelled',
    eventTypeId: 'fictional-option',
    packageId: 'archived-option',
    locationId: 'fictional-option',
    primaryContactId: 'archived-option',
    additionalContactIds: ['fictional-option', 'archived-option'],
    eventDate: '2026-07-01',
    startsAt: '2026-07-01T16:00:00.123Z',
    endsAt: '2026-07-01T18:00:00Z',
  });
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event duplizieren: Synthetic event',
    }),
  );
  expect(
    (screen.getByLabelText('Eventstatus') as HTMLSelectElement).value,
  ).toBe('inquiry');
  expect(
    (screen.getByLabelText('Fotobox-Paket') as HTMLSelectElement).value,
  ).toBe('');
  expect((screen.getByLabelText('Eventart') as HTMLSelectElement).value).toBe(
    'fictional-option',
  );
  expect((screen.getByLabelText('Eventbeginn') as HTMLInputElement).value).toBe(
    '2026-07-01T18:00:00.123',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Event speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic event (Kopie) – 01.07.2026 – Anfrage');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('2026-07-01T16:00:00.123Z'),
    }),
  );
});

test('event filters restore URL values, combine and clear filters, and show empty results', async () => {
  window.history.replaceState(
    null,
    '',
    '/?q=Synthetic&status=inquiry&other=keep',
  );
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
  fireEvent.change(screen.getByLabelText('Filter von'), {
    target: { value: '2026-07-01' },
  });
  fireEvent.change(screen.getByLabelText('Filter bis'), {
    target: { value: '2026-07-31' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Events filtern' }).closest('form')!,
  );
  expect(window.location.search).toContain('from=2026-07-01');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events?q=Synthetic&from=2026-07-01&to=2026-07-31&status=inquiry',
  );
  fireEvent.click(screen.getByLabelText('Nur Events ohne Datum'));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Events filtern' }).closest('form')!,
  );
  expect(window.location.search).toContain('undated=true');
  expect(window.location.search).not.toContain('from=');
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventfilter zurücksetzen' }),
  );
  expect(window.location.search).toBe('?other=keep');
  fetcher.mockImplementation(async (url: string) =>
    url.startsWith('/api/v1/events')
      ? Response.json({ timeZone: 'Europe/Berlin', events: [] })
      : Response.json([]),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Events aktualisieren' }));
  await screen.findByText('Keine Events gefunden.');
});

test('older event search responses and failures cannot overwrite a newer result', async () => {
  for (const fail of [false, true]) {
    let resolveOld!: (response: Response) => void,
      rejectOld!: (error: Error) => void;
    const old = new Promise<Response>((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/events') return old;
        if (url.startsWith('/api/v1/events?'))
          return Response.json({
            timeZone: 'Europe/Berlin',
            events: [{ ...row, name: 'Synthetic fresh' }],
          });
        return Response.json([]);
      }),
    );
    render(<EventPanel csrfToken="csrf" />);
    act(() => updateUrlSearch({ q: 'fresh' }));
    await screen.findByText('Synthetic fresh – Ohne Datum – inquiry');
    await act(async () => {
      if (fail) rejectOld(Error('stale offline'));
      else
        resolveOld(Response.json({ timeZone: 'Europe/Berlin', events: [row] }));
    });
    expect(
      screen.queryByText('Synthetic event – Ohne Datum – inquiry'),
    ).toBeNull();
    expect(screen.queryByText(/Events konnten nicht geladen/)).toBeNull();
    cleanup();
    window.history.replaceState(null, '', '/');
  }
});

test('a completed import refreshes visible events without discarding an unfinished draft', async () => {
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  const view = render(<EventPanel csrfToken="fictional" revision={0} />);
  await screen.findByText('Synthetic event – Ohne Datum – Anfrage');
  fireEvent.change(screen.getByLabelText('Eventname', { exact: true }), {
    target: { value: 'Fictional retained draft' },
  });
  const count = fetcher.mock.calls.filter(
    ([url]) => url === '/api/v1/events',
  ).length;
  view.rerender(<EventPanel csrfToken="fictional" revision={1} />);
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => url === '/api/v1/events').length,
    ).toBe(count + 1),
  );
  expect(
    (screen.getByLabelText('Eventname', { exact: true }) as HTMLInputElement)
      .value,
  ).toBe('Fictional retained draft');
});
