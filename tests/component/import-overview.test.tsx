import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportOverview } from '../../apps/admin/src/ImportOverview.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test('shows source provenance, version conflicts and the outstanding resource checklist', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        counts: {
          contacts: 1,
          locations: 0,
          eventTypes: 0,
          packages: 0,
          events: 1,
        },
        pendingPromises: 1,
        mappings: [
          {
            section: 'contacts',
            externalId: 'fictional-source',
            targetId: 'fictional-contact',
            name: 'Fictional Person',
            sourceStatus: '',
            targetVersion: 1,
            currentVersion: 2,
            pendingResourceReview: false,
            locallyChanged: true,
          },
        ],
        promises: [
          {
            id: 'fictional-promise',
            version: 1,
            externalId: 'fictional-event',
            name: 'Fictional promised event',
            eventDate: '2030-10-27',
            startsAt: null,
            endsAt: null,
            timeZone: 'Europe/Berlin',
            contact: 'Fictional Person',
            location: 'Fictional Venue',
            package: 'Fictional package',
            description: '',
            notesHtml: '',
          },
        ],
      }),
    ),
  );
  render(<ImportOverview revision={0} />);
  await screen.findByText('Fictional promised event');
  expect(screen.getByText(/Lokal geändert/)).toBeTruthy();
  expect(screen.getByText(/Box und Zubehör noch prüfen/)).toBeTruthy();
});

test('empty state, refresh errors and successful retries never retain a stale report', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      checkedAt: '2030-01-01T00:00:00Z',
      counts: {},
      mappings: [],
      promises: [],
      pendingPromises: 0,
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<ImportOverview revision={0} />);
  await screen.findByText('Noch keine Daten übernommen.');
  fetcher.mockRejectedValue(Error('fictional-private'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Importbestand aktualisieren' }),
  );
  await screen.findByText(/Importbestand konnte nicht geladen/);
  expect(screen.queryByText('Noch keine Daten übernommen.')).toBeNull();
  fetcher.mockResolvedValue(new Response(null, { status: 401 }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Importbestand aktualisieren' }),
  );
  await screen.findByText(/Importbestand konnte nicht geladen/);
  fetcher.mockResolvedValue(Response.json({}));
  fireEvent.click(
    screen.getByRole('button', { name: 'Importbestand aktualisieren' }),
  );
  await screen.findByText(/Importbestand konnte nicht geladen/);
});

test('private report download is explicit and source notes are escaped text', async () => {
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:fictional'),
    revoke = vi.fn(),
    click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        checkedAt: '2030-01-01T00:00:00Z',
        counts: { events: 1 },
        pendingPromises: 1,
        mappings: [
          {
            section: 'events',
            externalId: 'fictional-event',
            targetId: 'fictional-promise',
            name: 'Fictional promised',
            sourceStatus: 'Gebucht',
            targetVersion: 1,
            currentVersion: 1,
            locallyChanged: false,
            pendingResourceReview: true,
          },
        ],
        promises: [
          {
            id: 'fictional-promise',
            version: 1,
            externalId: null,
            name: 'Fictional promised',
            eventDate: null,
            startsAt: '2030-01-01T12:00:00Z',
            endsAt: '2030-01-01T14:00:00Z',
            timeZone: 'UTC',
            contact: null,
            location: null,
            package: null,
            description: 'Fictional description',
            notesHtml: '<img src=x onerror=bad()>',
          },
        ],
      }),
    ),
  );
  render(<ImportOverview revision={0} />);
  await screen.findByText('Fictional description');
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText(/Zuordnung fehlt/)).toBeTruthy();
  expect(screen.getByText(/Kontakt offen/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Privaten Prüfbericht herunterladen' }),
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]![0]).toBeInstanceOf(Blob);
  expect(click).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith('blob:fictional');
  click.mockRestore();
});
