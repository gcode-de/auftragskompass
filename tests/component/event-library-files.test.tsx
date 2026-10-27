import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventLibraryFiles } from '../../apps/admin/src/EventLibraryFiles.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('links an existing library file to the event', async () => {
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Synthetic.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 42,
    state: 'available',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: null,
  };
  let linked = false;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        linked = true;
        return Response.json(row);
      }
      return Response.json(
        String(input).endsWith('/library-files') &&
          String(input).includes('/events/')
          ? linked
            ? [row]
            : []
          : [row],
      );
    },
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventLibraryFiles
      eventId="11111111-1111-4111-8111-111111111111"
      csrfToken="synthetic"
      active
    />,
  );
  fireEvent.change(await screen.findByLabelText('Datei aus der Bibliothek'), {
    target: { value: row.id },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Datei zuordnen' }));
  expect(
    await screen.findByRole('link', { name: 'Herunterladen: Synthetic.pdf' }),
  ).toBeTruthy();
});

test('keeps a confirmed link visible when refreshing fails', async () => {
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Synthetic.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 42,
    state: 'available',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: null,
  };
  let saved = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        saved = true;
        return Response.json(row);
      }
      if (saved) return new Response(null, { status: 500 });
      return Response.json(String(input).includes('/events/') ? [] : [row]);
    }),
  );
  render(
    <EventLibraryFiles
      eventId="11111111-1111-4111-8111-111111111111"
      csrfToken="synthetic"
      active
    />,
  );
  fireEvent.change(await screen.findByLabelText('Datei aus der Bibliothek'), {
    target: { value: row.id },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Datei zuordnen' }));
  expect(await screen.findByText('Datei zugeordnet.')).toBeTruthy();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Herunterladen: Synthetic.pdf' }),
  ).toBeTruthy();
});

test('shows archived links without a download and can remove them', async () => {
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Synthetic.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 42,
    state: 'archived',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: '2031-05-02T10:00:00.000Z',
  };
  let removed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'DELETE') {
        removed = true;
        return new Response(null, { status: 204 });
      }
      return Response.json(
        String(input).includes('/events/') && !removed ? [row] : [],
      );
    }),
  );
  render(
    <EventLibraryFiles
      eventId="11111111-1111-4111-8111-111111111111"
      csrfToken="synthetic"
      active
    />,
  );
  expect(await screen.findByText(/Archiviert · Ungeprüft/)).toBeTruthy();
  expect(
    screen.queryByRole('link', { name: 'Herunterladen: Synthetic.pdf' }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Zuordnung entfernen: Synthetic.pdf' }),
  );
  expect(await screen.findByText('Zuordnung entfernt.')).toBeTruthy();
});

test('ignores an older load after switching the active event', async () => {
  let resolveOld!: (reply: Response) => void;
  const old = new Promise<Response>((resolve) => {
    resolveOld = resolve;
  });
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Old.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 42,
    state: 'available',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('11111111-1111-4111-8111-111111111111')
        ? old
        : Response.json([]),
    ),
  );
  const view = render(
    <EventLibraryFiles
      key="one"
      eventId="11111111-1111-4111-8111-111111111111"
      csrfToken="synthetic"
      active
    />,
  );
  view.rerender(
    <EventLibraryFiles
      key="two"
      eventId="22222222-2222-4222-8222-222222222222"
      csrfToken="synthetic"
      active
    />,
  );
  expect(
    await screen.findByText('Keine Bibliotheksdateien zugeordnet.'),
  ).toBeTruthy();
  resolveOld(Response.json([row]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('Old.pdf')).toBeNull();
});

test('prevents a mutation while a refresh is in flight and recovers after failure', async () => {
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Synthetic.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 42,
    state: 'available',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: null,
  };
  let delay = false,
    resolveLoad!: (reply: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveLoad = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (delay && String(input).includes('/events/')) return pending;
      return Response.json(String(input).includes('/events/') ? [row] : []);
    }),
  );
  render(
    <EventLibraryFiles
      eventId="11111111-1111-4111-8111-111111111111"
      csrfToken="synthetic"
      active
    />,
  );
  const remove = await screen.findByRole('button', {
    name: 'Zuordnung entfernen: Synthetic.pdf',
  });
  delay = true;
  fireEvent.click(
    screen.getByRole('button', { name: 'Dateien aktualisieren' }),
  );
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  resolveLoad(new Response(null, { status: 500 }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((remove as HTMLButtonElement).disabled).toBe(false);
});
