import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { LibraryFiles } from '../../apps/admin/src/LibraryFiles.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const availableId = '44444444-4444-4444-8444-444444444444',
  archivedId = '55555555-5555-4555-8555-555555555555';

const available = {
    id: availableId,
    displayName: 'synthetic-invoice.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 2048,
    state: 'available',
    scanState: 'not_scanned',
    uploadedAt: '2031-05-01T10:00:00.000Z',
    uploadedDate: '2031-05-01',
    archivedAt: null,
  },
  archived = {
    ...available,
    id: archivedId,
    displayName: 'synthetic-contract.zip',
    mediaType: 'application/zip',
    sizeBytes: 512,
    state: 'archived',
    uploadedAt: '2031-04-02T10:00:00.000Z',
    uploadedDate: '2031-04-02',
    archivedAt: '2031-04-03T10:00:00.000Z',
  };

type Call = { url: string; method: string; body: string | null };

function api(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      const call = {
        url: String(input),
        method: options?.method ?? 'GET',
        body: typeof options?.body === 'string' ? options.body : null,
      };
      calls.push(call);
      return handler(call);
    },
  );
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

const listOnly = (rows: unknown) => (call: Call) =>
  call.method === 'GET'
    ? Response.json(rows)
    : Response.json({ error: 'unexpected_write' }, { status: 500 });

test('lists name, type, size, date and an honest state per row', async () => {
  const calls = api(listOnly([available, archived]));
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  const library = await screen.findByRole('region', {
    name: 'Dateibibliothek',
  });
  expect(
    within(library).getByRole('heading', {
      level: 2,
      name: 'Dateibibliothek',
    }),
  ).toBeTruthy();
  // The page title belongs to the shell; this region adds no second one.
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  await within(library).findByText('synthetic-invoice.pdf');
  expect(within(library).getByText('PDF')).toBeTruthy();
  expect(within(library).getByText('2,0 KB')).toBeTruthy();
  expect(within(library).getByText('01.05.2031')).toBeTruthy();
  const availableRow = within(library).getByRole('row', {
    name: /synthetic-invoice\.pdf/,
  });
  expect(within(availableRow).getByText('Verfügbar')).toBeTruthy();
  expect(within(availableRow).getByText('Unverprüft')).toBeTruthy();
  const download = within(availableRow).getByRole('link', {
    name: 'Herunterladen: synthetic-invoice.pdf',
  });
  expect(download.getAttribute('href')).toBe(
    '/api/v1/library-files/' + availableId + '/content',
  );
  const archivedRow = within(library).getByRole('row', {
    name: /synthetic-contract\.zip/,
  });
  expect(within(archivedRow).getByText('Archiviert')).toBeTruthy();
  expect(within(archivedRow).queryByRole('link')).toBeNull();
  expect(within(archivedRow).queryByRole('button')).toBeNull();
  expect(
    within(library).getByText(/nicht auf Schadsoftware geprüft/),
  ).toBeTruthy();
  expect(calls.map((call) => call.method)).toEqual(['GET']);
});

test('keeps the last good rows, names the failure and retries with GET only', async () => {
  let failed = false;
  const calls = api((call) => {
    if (call.method !== 'GET') return Response.json({}, { status: 500 });
    return failed
      ? Response.json({ error: 'internal_error' }, { status: 500 })
      : Response.json([available]);
  });
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('synthetic-invoice.pdf');
  failed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Liste aktualisieren' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(
    'Dateibibliothek konnte nicht geladen werden.',
  );
  expect(screen.getByText('synthetic-invoice.pdf')).toBeTruthy();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Dateien erneut laden' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('separates the empty state from a load failure', async () => {
  let fail = false;
  api(() =>
    fail
      ? Response.json({ error: 'internal_error' }, { status: 500 })
      : Response.json([]),
  );
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  expect(
    await screen.findByText('Noch keine Dateien hochgeladen.'),
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  cleanup();
  fail = true;
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Noch keine Dateien hochgeladen.')).toBeNull();
});

test('uploads the selected bytes as strict base64 with one request id', async () => {
  const bytes = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x20, 0x73, 0x79, 0x6e,
  ]);
  const uploads: Call[] = [];
  api((call) => {
    if (call.method === 'POST') {
      uploads.push(call);
      return Response.json(
        {
          ...available,
          displayName: 'synthetic-offer.pdf',
          sizeBytes: bytes.byteLength,
        },
        { status: 201 },
      );
    }
    return Response.json([]);
  });
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('Noch keine Dateien hochgeladen.');
  fireEvent.change(screen.getByLabelText('Datei auswählen'), {
    target: {
      files: [
        new File([bytes], 'synthetic-offer.pdf', { type: 'application/pdf' }),
      ],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  expect(await screen.findByText('synthetic-offer.pdf')).toBeTruthy();
  expect(uploads).toHaveLength(1);
  const payload = JSON.parse(uploads[0]!.body!) as Record<string, string>;
  expect(payload.displayName).toBe('synthetic-offer.pdf');
  expect(payload.mediaType).toBe('application/pdf');
  expect(Buffer.from(payload.contentBase64!, 'base64')).toEqual(
    Buffer.from(bytes),
  );
  expect(payload.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(screen.getByRole('status').textContent).toContain(
    'synthetic-offer.pdf wurde hochgeladen',
  );
  // The unverified state stays visible next to the new row.
  expect(screen.getByText('Unverprüft')).toBeTruthy();
});

test('warns before sending files that are too large or of the wrong type', async () => {
  const calls = api(listOnly([]));
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  const input = screen.getByLabelText('Datei auswählen');
  await screen.findByText('Noch keine Dateien hochgeladen.');
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf', {
          type: 'application/pdf',
        }),
      ],
    },
  });
  expect(screen.getByRole('alert').textContent).toContain('10 MiB');
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

  fireEvent.change(input, {
    target: {
      files: [new File(['synthetic'], 'notes.txt', { type: 'text/plain' })],
    },
  });
  expect(screen.getByRole('alert').textContent).toContain('PDF');
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('translates server rejections and never invents a row', async () => {
  let status = 415;
  api((call) =>
    call.method === 'POST'
      ? Response.json(
          { error: status === 415 ? 'media_type_mismatch' : 'file_too_large' },
          { status },
        )
      : Response.json([]),
  );
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  const input = screen.getByLabelText('Datei auswählen');
  const pdf = () =>
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'fake.pdf', {
      type: 'application/pdf',
    });
  fireEvent.change(input, { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'passt nicht zum Dateityp',
  );
  expect(screen.queryByText('synthetic-invoice.pdf')).toBeNull();
  status = 413;
  fireEvent.change(input, { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('10 MiB'),
  );
});

test('archiving needs a confirmation and updates the row in place', async () => {
  const writes: Call[] = [];
  api((call) => {
    if (call.method === 'POST') {
      writes.push(call);
      return Response.json({
        ...available,
        state: 'archived',
        archivedAt: '2031-05-02T10:00:00.000Z',
      });
    }
    return Response.json([available]);
  });
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('synthetic-invoice.pdf');
  fireEvent.click(
    screen.getByRole('button', { name: 'Archivieren: synthetic-invoice.pdf' }),
  );
  expect(
    screen.getByRole('group', {
      name: 'Datei synthetic-invoice.pdf archivieren?',
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(writes).toHaveLength(0);
  fireEvent.click(
    screen.getByRole('button', { name: 'Archivieren: synthetic-invoice.pdf' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Archivieren bestätigen' }),
  );
  await waitFor(() => expect(screen.getByText('Archiviert')).toBeTruthy());
  expect(writes).toHaveLength(1);
  expect(writes[0]!.url).toBe(
    '/api/v1/library-files/' + availableId + '/archive',
  );
  expect(screen.queryByRole('link', { name: /Herunterladen/ })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain(
    'synthetic-invoice.pdf wurde archiviert',
  );
});

test('does not load while the section is hidden and rejects off-shape rows', async () => {
  const calls = api(listOnly([{ ...available, mediaType: 'text/html' }]));
  const view = render(
    <LibraryFiles csrfToken="fictional-csrf" active={false} />,
  );
  expect(screen.getByRole('region', { name: 'Dateibibliothek' })).toBeTruthy();
  expect(calls).toHaveLength(0);
  view.rerender(<LibraryFiles csrfToken="fictional-csrf" active />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(calls).toHaveLength(1);
});

test('prints byte, kilobyte and megabyte sizes exactly', async () => {
  api(
    listOnly([
      {
        ...available,
        id: '66666666-6666-4666-8666-666666666666',
        displayName: 'synthetic-recording.png',
        mediaType: 'image/png',
        sizeBytes: 5 * 1024 * 1024,
      },
      {
        ...available,
        id: '77777777-7777-4777-8777-777777777777',
        displayName: 'synthetic-tiny.pdf',
        sizeBytes: 900,
      },
    ]),
  );
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('5,0 MB');
  expect(screen.getByText('900 B')).toBeTruthy();
});

test('derives a missing browser type from the extension and ignores empty picks', async () => {
  const uploads: Call[] = [];
  api((call) => {
    if (call.method === 'POST') {
      uploads.push(call);
      return Response.json(
        {
          ...available,
          displayName: 'SCAN.PNG',
          mediaType: 'image/png',
          sizeBytes: 4,
        },
        { status: 201 },
      );
    }
    return Response.json([]);
  });
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('Noch keine Dateien hochgeladen.');
  const input = screen.getByLabelText('Datei auswählen');
  fireEvent.change(input, { target: { files: [] } });
  expect(
    (screen.getByRole('button', { name: 'Hochladen' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.submit(input.closest('form')!);
  expect(uploads).toHaveLength(0);
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([1, 2, 3, 4])], 'SCAN.PNG', { type: '' }),
      ],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  expect(await screen.findByText('SCAN.PNG')).toBeTruthy();
  const payload = JSON.parse(uploads[0]!.body!) as { mediaType: string };
  expect(payload.mediaType).toBe('image/png');
});

test('names every upload and archive rejection it can meet', async () => {
  let uploadStatus = 400,
    uploadBody: unknown = { error: 'invalid_name' },
    archiveStatus = 409;
  let uploadBodyOverride: unknown = null;
  api((call) => {
    if (call.method === 'GET') return Response.json([available]);
    if (call.url.endsWith('/archive'))
      return Response.json({ error: 'conflict' }, { status: archiveStatus });
    if (uploadBodyOverride)
      return Response.json(uploadBodyOverride, { status: uploadStatus });
    return Response.json(uploadBody, { status: uploadStatus });
  });
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('synthetic-invoice.pdf');
  const input = screen.getByLabelText('Datei auswählen');
  const pick = () =>
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'fake.pdf', {
            type: 'application/pdf',
          }),
        ],
      },
    });
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Dateiname');
  uploadBody = { error: 'invalid_content' };
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'konnte nicht gelesen werden',
    ),
  );
  uploadStatus = 401;
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Anmeldung'),
  );
  uploadStatus = 500;
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'Uploadstand ist unklar',
    ),
  );
  // A 201 with an off-shape row is as uncertain as a transport failure.
  uploadStatus = 201;
  uploadBodyOverride = { id: availableId, displayName: 'fake.pdf' };
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'Uploadstand ist unklar',
    ),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Archivieren: synthetic-invoice.pdf' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Archivieren bestätigen' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'konnte nicht archiviert werden',
    ),
  );
  archiveStatus = 500;
  fireEvent.click(
    screen.getByRole('button', { name: 'Archivieren bestätigen' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'Archivstand ist unklar',
    ),
  );
});

test('renders every row of a long list without truncation', async () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    ...available,
    id: '44444444-4444-4444-8444-' + String(index).padStart(12, '0'),
    displayName: 'synthetic-' + index + '.pdf',
  }));
  api(listOnly(many));
  render(<LibraryFiles csrfToken="fictional-csrf" active />);
  await screen.findByText('synthetic-0.pdf');
  expect(screen.getAllByRole('row')).toHaveLength(many.length + 1);
  expect(screen.getByText('synthetic-39.pdf')).toBeTruthy();
});
