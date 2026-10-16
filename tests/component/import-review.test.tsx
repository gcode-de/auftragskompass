import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportPromiseReview } from '../../apps/admin/src/ImportPromiseReview.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
test('closed reviews link to the resulting event instead of offering another confirmation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        event: { name: 'Fictional reviewed promise' },
        reviewAction: 'event',
        reviewedEventId: 'fictional-event',
        canExcludePast: false,
      }),
    ),
  );
  render(
    <ImportPromiseReview
      id="fictional-promise"
      csrfToken="fictional"
      onReviewed={async () => {}}
      onClose={() => {}}
    />,
  );
  expect(
    (
      await screen.findByRole('link', { name: 'Geprüften Auftrag öffnen' })
    ).getAttribute('href'),
  ).toBe('#event-fictional-event');
  expect(
    screen.queryByRole('button', {
      name: 'Geprüfte Bestandszusage übernehmen',
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('link', { name: 'Geprüften Auftrag öffnen' }),
  );
  await vi.waitFor(() =>
    expect(window.location.hash).toBe('#event-fictional-event'),
  );
});

const detail = {
  event: {
    id: 'fictional-promise',
    name: 'Fictional old promise',
    version: 2,
    status: 'booked',
    eventDate: '2000-01-01',
    startsAt: null,
    endsAt: null,
    timeZone: 'Europe/Berlin',
  },
  reviewAction: null,
  reviewedEventId: null,
  canExcludePast: true,
};
function mount(
  onReviewed = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
) {
  render(
    <ImportPromiseReview
      id="fictional-promise"
      csrfToken="fictional-csrf"
      onReviewed={onReviewed}
      onClose={onClose}
    />,
  );
  return { onReviewed, onClose };
}
test('explicit exclusion requires confirmation and carries source version and CSRF', async () => {
  let closed = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/availability')) return Response.json([]);
    if (init) {
      closed = true;
      return Response.json({ eventId: null, excluded: true });
    }
    return Response.json({
      ...detail,
      reviewAction: closed ? 'excluded_past' : null,
      canExcludePast: !closed,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const { onReviewed, onClose } = mount();
  const button = await screen.findByRole('button', {
    name: 'Vergangene Zusage mit Nachweis ausschließen',
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByLabelText(
      'Termin und Originalauftrag geprüft: nicht mehr operativ übernehmen',
    ),
  );
  fireEvent.click(button);
  await screen.findByText(
    /Nach Zeitablauf aus dem operativen Bestand ausgeschlossen/,
  );
  expect(onReviewed).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/imports/bookitup/promises/fictional-promise/exclude-past',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'fictional-csrf',
      },
      body: JSON.stringify({ version: 2 }),
    },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prüfung schließen' }));
  expect(onClose).toHaveBeenCalledOnce();
});
test.each(['http', 'offline'])(
  'exclusion %s failure leaves the draft available for review',
  async (kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/availability')) return Response.json([]);
        if (init) {
          if (kind === 'offline') throw Error('fictional-private');
          return new Response(null, { status: 409 });
        }
        return Response.json(detail);
      }),
    );
    mount();
    await screen.findByRole('button', {
      name: 'Vergangene Zusage mit Nachweis ausschließen',
    });
    fireEvent.click(
      screen.getByLabelText(
        'Termin und Originalauftrag geprüft: nicht mehr operativ übernehmen',
      ),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vergangene Zusage mit Nachweis ausschließen',
      }),
    );
    await screen.findByText(/Ausschluss fehlgeschlagen/);
    expect(
      (
        screen.getByRole('button', {
          name: 'Bestandszusage aktualisieren',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  },
);
test.each(['http', 'offline', 'shape'])(
  'review load handles %s failures and refreshes safely',
  async (kind) => {
    const fetcher = vi.fn(async () => {
      if (kind === 'offline') throw Error('fictional-private');
      return kind === 'http'
        ? new Response(null, { status: 404 })
        : Response.json({});
    });
    vi.stubGlobal('fetch', fetcher);
    mount();
    await screen.findByText(/Bestandszusage konnte nicht geladen/);
    fetcher.mockResolvedValue(
      Response.json({ ...detail, reviewAction: 'excluded_past' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Bestandszusage aktualisieren' }),
    );
    await screen.findByText(
      /Nach Zeitablauf aus dem operativen Bestand ausgeschlossen/,
    );
  },
);
