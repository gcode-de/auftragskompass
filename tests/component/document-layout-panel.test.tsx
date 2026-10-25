import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { DocumentLayoutPanel } from '../../apps/admin/src/DocumentLayoutPanel.js';
import {
  SettingsNavigation,
  isSettingsRoute,
} from '../../apps/admin/src/Navigation.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const initial = {
  senderName: '',
  senderStreet: '',
  senderPostalCode: '',
  senderCity: '',
  primaryColor: '#2f6f4f',
  textColor: '#1b1b1b',
  fontFamily: 'system',
  showPageNumbers: true,
  showPositionNumbers: true,
} as const;
const saved = {
  ...initial,
  senderName: 'Fictional Studio',
  senderStreet: 'Synthetic Street 1',
  senderPostalCode: '12345',
  senderCity: 'Fictional Town',
  version: 3,
  logoKey: null,
  logoMediaType: null,
};
function api(
  handler: (url: string, options?: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; options?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      calls.push({ url, ...(options ? { options } : {}) });
      return handler(url, options);
    }),
  );
  return calls;
}

test('a 404 shows explicit unsaved setup defaults and creates only after Save', async () => {
  const calls = api((_url, options) =>
    options?.method === 'POST'
      ? Response.json({
          ...saved,
          ...JSON.parse(String(options.body)),
          version: 1,
        })
      : Response.json({ error: 'not_found' }, { status: 404 }),
  );
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  expect(
    await screen.findByText('Noch kein Dokumentlayout eingerichtet.'),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Absendername')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
  );
  expect((screen.getByLabelText('Primärfarbe') as HTMLInputElement).value).toBe(
    initial.primaryColor,
  );
  expect(calls.filter((call) => call.options?.method)).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Fictional Studio' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  const create = calls.find((call) => call.options?.method === 'POST')!;
  expect(create.url).toBe('/api/v1/document-layout');
  expect(create.options?.headers).toMatchObject({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(JSON.parse(String(create.options?.body))).toEqual({
    ...initial,
    senderName: 'Fictional Studio',
  });
  expect(
    calls.filter((call) => call.url === '/api/v1/document-layout'),
  ).toHaveLength(2);
});

test('a saved layout is summarized, then updated with its server version and no reload', async () => {
  const calls = api((_url, options) =>
    options?.method === 'PUT'
      ? Response.json({
          ...saved,
          ...JSON.parse(String(options.body)),
          version: 4,
        })
      : Response.json(saved),
  );
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  expect(await screen.findByText(/Fictional Studio/)).toBeTruthy();
  expect(screen.queryByLabelText('Absendername')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText('Straße'), {
    target: { value: 'Synthetic Avenue 2' },
  });
  fireEvent.change(screen.getByLabelText('Postleitzahl'), {
    target: { value: '54321' },
  });
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Example City' },
  });
  fireEvent.change(screen.getByLabelText('Primärfarbe'), {
    target: { value: '#123456' },
  });
  fireEvent.change(screen.getByLabelText('Textfarbe'), {
    target: { value: '#abcdef' },
  });
  fireEvent.change(screen.getByLabelText('Schrift'), {
    target: { value: 'sans' },
  });
  fireEvent.click(screen.getByLabelText('Seitennummern anzeigen'));
  fireEvent.click(screen.getByLabelText('Positionsnummern anzeigen'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  const update = calls.find((call) => call.options?.method === 'PUT')!;
  expect(update.url).toBe('/api/v1/document-layout');
  expect(JSON.parse(String(update.options?.body))).toEqual({
    senderName: saved.senderName,
    senderStreet: 'Synthetic Avenue 2',
    senderPostalCode: '54321',
    senderCity: 'Example City',
    primaryColor: '#123456',
    textColor: '#abcdef',
    fontFamily: 'sans',
    showPageNumbers: false,
    showPositionNumbers: false,
    version: 3,
  });
  expect(
    calls.filter((call) => call.url === '/api/v1/document-layout'),
  ).toHaveLength(2);
  expect(await screen.findByText(/Example City/)).toBeTruthy();
});

test('a selected logo is uploaded only after explicit confirmation and updates the saved version', async () => {
  const withLogo = {
    ...saved,
    version: 4,
    logoKey: 'logo-fictional-layout-1.png',
    logoMediaType: 'image/png',
  };
  const originalLogo = {
    ...saved,
    logoKey: 'logo-fictional-layout-old.png',
    logoMediaType: 'image/png' as const,
  };
  const calls = api((url, options) => {
    if (url.endsWith('/preview'))
      return new Response('%PDF-1.4 fictional preview', {
        headers: { 'content-type': 'application/pdf' },
      });
    if (url.endsWith('/logo')) return Response.json(withLogo);
    if (options?.method === 'PUT')
      return Response.json({
        ...withLogo,
        ...JSON.parse(String(options.body)),
        version: 5,
      });
    if (options?.method === 'POST')
      return Response.json({
        ...saved,
        ...JSON.parse(String(options.body)),
        version: 4,
      });
    return Response.json(originalLogo);
  });
  const revoke = vi.fn();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:old-layout-preview'),
    revokeObjectURL: revoke,
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau erstellen' }));
  await screen.findByRole('link', { name: 'Vorschau öffnen' });

  fireEvent.click(screen.getByRole('button', { name: 'Logo ersetzen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(0);
  expect(hasUnsavedChanges()).toBe(true);
  expect(
    screen.queryByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Vorschau erstellen' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Logo ersetzen' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:old-layout-preview');
  expect(await screen.findByText('Logo gespeichert.')).toBeTruthy();
  expect(await screen.findByText('Ein Logo ist eingerichtet.')).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Logo ersetzen' }),
  );
  expect(hasUnsavedChanges()).toBe(false);
  const upload = calls.find((call) => call.url.endsWith('/logo'))!;
  expect(upload.options?.method).toBe('PUT');
  expect(upload.options?.body).toBe(file);
  expect(
    Array.from(
      new Uint8Array(await (upload.options?.body as File).arrayBuffer()),
    ),
  ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(upload.options?.headers).toMatchObject({
    'content-type': 'image/png',
    'x-csrf-token': 'fictional-csrf',
  });

  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Updated after logo' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(screen.queryByLabelText('Logodatei')).toBeNull();
  const layoutSave = calls.find(
    (call) =>
      call.url === '/api/v1/document-layout' && call.options?.method === 'PUT',
  )!;
  expect(JSON.parse(String(layoutSave.options?.body))).toMatchObject({
    version: 4,
    senderCity: 'Updated after logo',
  });
  expect(
    calls.filter((call) => call.url === '/api/v1/document-layout'),
  ).toHaveLength(2);
});

test('an uncertain logo upload preserves the selected file and offers GET reconciliation in summary', async () => {
  let uploadCount = 0;
  let readCount = 0;
  api((_url, options) => {
    if (options?.method === 'PUT') {
      uploadCount++;
      return Response.json({ error: 'unavailable' }, { status: 500 });
    }
    readCount++;
    return readCount === 1 || readCount > 2
      ? Response.json(saved)
      : (Promise.reject(new Error('offline')) as unknown as Response);
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  expect(await screen.findByText(/Uploadstand ist unklar/)).toBeTruthy();
  expect(screen.getByText('fictional-logo.png')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Logoauswahl verwerfen und neu laden' }),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Logo hochladen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(uploadCount).toBe(1);

  fireEvent.click(
    screen.getByRole('button', { name: 'Logoauswahl verwerfen und neu laden' }),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Logoauswahl verwerfen und neu laden',
    }),
  ).toBeTruthy();
  expect(screen.getByText('fictional-logo.png')).toBeTruthy();
  expect(uploadCount).toBe(1);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Logoauswahl verwerfen und neu laden',
    }),
  );
  expect(await screen.findByText('Dokumentlayout neu geladen.')).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Logo hinzufügen' }),
  );
  expect(screen.queryByText('fictional-logo.png')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(uploadCount).toBe(1);
});

test.each(['network failure', 'invalid JSON'] as const)(
  'an upload with %s must be reconciled before another PUT',
  async (failure) => {
    const calls = api((url) => {
      if (url.endsWith('/logo'))
        return failure === 'network failure'
          ? Promise.reject(new Error('synthetic disconnected response'))
          : new Response('synthetic incomplete JSON', {
              headers: { 'content-type': 'application/json' },
            });
      return Response.json(saved);
    });
    render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
    await screen.findByText(/Fictional Studio/);
    fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
    fireEvent.change(screen.getByLabelText('Logodatei'), {
      target: {
        files: [
          new File(['synthetic'], 'fictional-logo.png', { type: 'image/png' }),
        ],
      },
    });
    const submit = screen.getByRole('button', { name: 'Logo hochladen' });
    fireEvent.click(submit);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Uploadstand ist unklar/,
    );
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(submit.closest('form')!);
    expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(1);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Logoauswahl verwerfen und neu laden',
      }),
    );
    await screen.findByText('Dokumentlayout neu geladen.');
    expect(screen.queryByText('fictional-logo.png')).toBeNull();
    expect(hasUnsavedChanges()).toBe(false);
    expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(1);
  },
);

test('logo size and type checks keep the saved layout and never send invalid files', async () => {
  const calls = api((_url, options) =>
    options?.method === 'PUT'
      ? Response.json({ error: 'too_large' }, { status: 413 })
      : Response.json(saved),
  );
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const input = screen.getByLabelText('Logodatei');
  const tooLarge = new File(
    [new Uint8Array(512 * 1024 + 1)],
    'large-logo.png',
    { type: 'image/png' },
  );
  fireEvent.change(input, { target: { files: [tooLarge] } });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  expect(screen.getByRole('alert').textContent).toContain('höchstens 512 KiB');
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(0);
  expect(screen.getByText('large-logo.png')).toBeTruthy();

  const unsupported = new File(['fictional'], 'notes.txt', {
    type: 'text/plain',
  });
  fireEvent.change(input, { target: { files: [unsupported] } });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'PNG- oder JPEG-Datei',
  );
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(0);
});

test('discarding a staged logo closes the form and returns focus without writing', async () => {
  const calls = api((_url, options) =>
    options?.method
      ? Response.json({ error: 'unexpected_write' }, { status: 500 })
      : Response.json(saved),
  );
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const input = screen.getByLabelText('Logodatei');
  expect(document.activeElement).toBe(input);
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(input, { target: { files: [file] } });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Auswahl verwerfen' }));
  expect(screen.queryByText('fictional-logo.png')).toBeNull();
  expect(screen.queryByLabelText('Logodatei')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Logo hinzufügen' }),
  );
  expect(calls.filter((call) => call.options?.method)).toHaveLength(0);
});

test('a staged logo selection survives deactivation while the settings panel stays mounted', async () => {
  const calls = api((_url, options) =>
    options?.method
      ? Response.json({ error: 'unexpected_write' }, { status: 500 })
      : Response.json(saved),
  );
  const view = render(
    <DocumentLayoutPanel csrfToken="fictional-csrf" active />,
  );
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    { type: 'image/png' },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  view.rerender(
    <DocumentLayoutPanel csrfToken="fictional-csrf" active={false} />,
  );
  expect(screen.getByText('fictional-logo.png')).toBeTruthy();
  view.rerender(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  expect(screen.getByText('fictional-logo.png')).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(true);
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(0);
});

test('a known upload validation response preserves the old logo and allows correction', async () => {
  const current = {
    ...saved,
    logoKey: 'logo-fictional-layout-old.png',
    logoMediaType: 'image/png' as const,
  };
  let uploads = 0;
  const calls = api((url) => {
    if (url.endsWith('/logo')) {
      uploads++;
      return Response.json({ error: 'unsupported' }, { status: 415 });
    }
    return Response.json(current);
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo ersetzen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'replacement.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  expect(await screen.findByText(/gültige PNG- oder JPEG-Datei/)).toBeTruthy();
  expect(screen.getByText('Ein Logo ist eingerichtet.')).toBeTruthy();
  expect(screen.getByText('replacement.png')).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Logo hochladen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    calls.filter((call) => call.url === '/api/v1/document-layout'),
  ).toHaveLength(1);
  expect(uploads).toBe(1);
});

test.each([401, 403] as const)(
  'a known upload authorization response %s preserves the last layout without locking it as uncertain',
  async (status) => {
    const calls = api((url) =>
      url.endsWith('/logo')
        ? Response.json({ error: 'forbidden' }, { status })
        : Response.json(saved),
    );
    render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
    await screen.findByText(/Fictional Studio/);
    fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      'fictional-logo.png',
      { type: 'image/png' },
    );
    fireEvent.change(screen.getByLabelText('Logodatei'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      status === 401 ? /erneut anmelden/ : /Berechtigung prüfen/,
    );
    expect(screen.getByText(/Fictional Studio/)).toBeTruthy();
    expect(screen.getByText('fictional-logo.png')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Logo hochladen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      calls.filter((call) => call.url === '/api/v1/document-layout'),
    ).toHaveLength(1);
  },
);

test('a pending logo upload locks its form and confirms only a matching full row', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => (finish = resolve));
  const calls = api((url) => {
    if (url.endsWith('/logo')) return pending;
    return Response.json(saved);
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  await screen.findByText('Logo wird hochgeladen …');
  expect(
    screen.queryByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Vorschau erstellen' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Logo hinzufügen' })).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: 'Logo hochladen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'Auswahl verwerfen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(1);
  finish(
    Response.json({
      ...saved,
      version: 4,
      logoKey: 'logo-fictional-layout-1.jpg',
      logoMediaType: 'image/jpeg',
    }),
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(
    await screen.findByText(/Uploadantwort war unvollständig/),
  ).toBeTruthy();
  expect(screen.getByText('fictional-logo.png')).toBeTruthy();
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(1);
});

test.each([
  'old key',
  'missing key',
  'wrong MIME',
  'stale version',
  'changed layout fields',
] as const)(
  'an upload response with %s is uncertain and cannot replace the confirmed row',
  async (mismatch) => {
    const current = {
      ...saved,
      ...(mismatch === 'old key'
        ? {
            logoKey: 'logo-fictional-old.png',
            logoMediaType: 'image/png' as const,
          }
        : {}),
    };
    const calls = api((url) => {
      if (url.endsWith('/logo')) {
        return Response.json({
          ...current,
          version: mismatch === 'stale version' ? 3 : 4,
          senderCity:
            mismatch === 'changed layout fields'
              ? 'Unexpected City'
              : current.senderCity,
          logoKey:
            mismatch === 'old key'
              ? current.logoKey
              : mismatch === 'missing key'
                ? null
                : mismatch === 'wrong MIME'
                  ? 'logo-fictional-new.jpg'
                  : 'logo-fictional-new.png',
          logoMediaType:
            mismatch === 'missing key'
              ? null
              : mismatch === 'wrong MIME'
                ? 'image/jpeg'
                : 'image/png',
        });
      }
      return Response.json(current);
    });
    render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
    await screen.findByText(/Fictional Studio/);
    fireEvent.click(
      screen.getByRole('button', {
        name: mismatch === 'old key' ? 'Logo ersetzen' : 'Logo hinzufügen',
      }),
    );
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      'fictional-logo.png',
      { type: 'image/png' },
    );
    fireEvent.change(screen.getByLabelText('Logodatei'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
    expect(
      await screen.findByText(/Uploadantwort war unvollständig/),
    ).toBeTruthy();
    expect(screen.getByText('fictional-logo.png')).toBeTruthy();
    expect(
      calls.filter((call) => call.url === '/api/v1/document-layout'),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(1);
    expect(
      (
        screen.getByRole('button', {
          name: 'Logo hochladen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  },
);

test('a logo 404 reconciles the missing layout before the setup path can resume', async () => {
  let reads = 0;
  let uploads = 0;
  const calls = api((url, options) => {
    if (url.endsWith('/logo')) {
      uploads++;
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (options?.method === 'POST')
      return Response.json({
        ...saved,
        ...JSON.parse(String(options.body)),
        version: 1,
      });
    reads++;
    return reads === 1
      ? Response.json(saved)
      : Response.json({ error: 'not_found' }, { status: 404 });
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  expect(await screen.findByText(/nicht mehr verfügbar/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Logoauswahl verwerfen und neu laden' }),
  );
  expect(
    await screen.findByText('Noch kein Dokumentlayout eingerichtet.'),
  ).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
    ),
  );
  expect(screen.queryByText('fictional-logo.png')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(uploads).toBe(1);
  expect(
    calls.filter((call) => call.url === '/api/v1/document-layout'),
  ).toHaveLength(2);
});

test('a pending logo upload cannot update state or leak work after unmount', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => (finish = resolve));
  const calls = api((url) =>
    url.endsWith('/logo') ? pending : Response.json(saved),
  );
  const create = vi.fn(() => 'blob:must-not-be-created');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  const view = render(
    <DocumentLayoutPanel csrfToken="fictional-csrf" active />,
  );
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(screen.getByRole('button', { name: 'Logo hinzufügen' }));
  const file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'fictional-logo.png',
    {
      type: 'image/png',
    },
  );
  fireEvent.change(screen.getByLabelText('Logodatei'), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Logo hochladen' }));
  await screen.findByText('Logo wird hochgeladen …');
  view.unmount();
  await act(async () => {
    finish(
      Response.json({
        ...saved,
        version: 4,
        logoKey: 'logo-fictional-new.png',
        logoMediaType: 'image/png',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(calls.filter((call) => call.url.endsWith('/logo'))).toHaveLength(1);
  expect(create).not.toHaveBeenCalled();
});

test('a load error is not treated as first-time setup and can be retried', async () => {
  let attempts = 0;
  api(() => {
    attempts++;
    return attempts === 1
      ? (Promise.reject(new Error('offline')) as unknown as Response)
      : Response.json(saved);
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  expect(
    await screen.findByText(/Dokumentlayout konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Absendername')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout erneut laden' }),
  );
  expect(await screen.findByText(/Fictional Studio/)).toBeTruthy();
  expect(attempts).toBe(2);
});

test('a conflict preserves entered values and requires explicit reload before another write', async () => {
  let conflict = true;
  const calls = api((_url, options) => {
    if (options?.method === 'PUT') {
      if (conflict)
        return Response.json({ error: 'conflict' }, { status: 409 });
      return Response.json({ ...saved, version: 4 });
    }
    return Response.json(saved);
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Local edit' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByLabelText('Ort') as HTMLInputElement).value).toBe(
    'Local edit',
  );
  const save = screen.getByRole('button', {
    name: 'Dokumentlayout speichern',
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  conflict = false;
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Änderungen verwerfen und neu laden',
    }),
  );
  expect(await screen.findByText(/Fictional Town/)).toBeTruthy();
  expect(calls.filter((call) => call.options?.method === 'PUT')).toHaveLength(
    1,
  );
});

test('a missing versioned row blocks stale writes and preserves edits until reload', async () => {
  let missing = false;
  const calls = api((_url, options) => {
    if (options?.method === 'PUT') {
      missing = true;
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    return missing
      ? Response.json({ error: 'not_found' }, { status: 404 })
      : Response.json(saved);
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Local edit' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(
    await screen.findByText(
      /nicht mehr verfügbar.*Deine Eingaben bleiben erhalten/,
    ),
  ).toBeTruthy();
  expect((screen.getByLabelText('Ort') as HTMLInputElement).value).toBe(
    'Local edit',
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Dokumentlayout speichern',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Änderungen verwerfen und neu laden',
    }),
  );
  expect(
    await screen.findByText('Noch kein Dokumentlayout eingerichtet.'),
  ).toBeTruthy();
  expect(calls.filter((call) => call.options?.method === 'PUT')).toHaveLength(
    1,
  );
});

test('a lost first-save response stays uncertain and never submits a duplicate create', async () => {
  let created = false;
  const calls = api((_url, options) => {
    if (options?.method === 'POST') {
      created = true;
      return Promise.reject(
        new Error('connection lost'),
      ) as unknown as Response;
    }
    return created
      ? Response.json(saved)
      : Response.json({ error: 'not_found' }, { status: 404 });
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText('Noch kein Dokumentlayout eingerichtet.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
  );
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'New Fictional Studio' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(await screen.findByText(/Speicherstand ist unklar/)).toBeTruthy();
  expect(
    (screen.getByLabelText('Absendername') as HTMLInputElement).value,
  ).toBe('New Fictional Studio');
  expect(
    (
      screen.getByRole('button', {
        name: 'Dokumentlayout speichern',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(calls.filter((call) => call.options?.method === 'POST')).toHaveLength(
    1,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Änderungen verwerfen und neu laden',
    }),
  );
  expect(await screen.findByText(/Fictional Studio/)).toBeTruthy();
  expect(calls.filter((call) => call.options?.method === 'POST')).toHaveLength(
    1,
  );
});

test.each(['network', 'malformed', 'wrong version'] as const)(
  'an uncertain %s save response preserves edits until an explicit reload',
  async (failure) => {
    const calls = api((_url, options) => {
      if (options?.method === 'PUT') {
        if (failure === 'network')
          return Promise.reject(
            new Error('connection lost'),
          ) as unknown as Response;
        if (failure === 'malformed')
          return Response.json({ senderName: 'incomplete' });
        return Response.json({ ...saved, version: 3 });
      }
      return Response.json(saved);
    });
    render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
    await screen.findByText(/Fictional Studio/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
    );
    fireEvent.change(screen.getByLabelText('Ort'), {
      target: { value: 'Local edit' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
    );
    expect(await screen.findByText(/Speicherstand ist unklar/)).toBeTruthy();
    expect((screen.getByLabelText('Ort') as HTMLInputElement).value).toBe(
      'Local edit',
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Dokumentlayout speichern',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Änderungen verwerfen und neu laden',
      }),
    );
    expect(await screen.findByText(/Fictional Town/)).toBeTruthy();
    expect(calls.filter((call) => call.options?.method === 'PUT')).toHaveLength(
      1,
    );
  },
);

test('preview verifies a PDF before exposing an explicit new-tab and download link', async () => {
  api((_url, options) => {
    if (options?.method === 'POST')
      return new Response('%PDF-1.4 fictional preview', {
        headers: {
          'content-type': 'application/pdf',
          'cache-control': 'no-store',
        },
      });
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
  const create = vi.fn(() => 'blob:synthetic-pdf');
  const revoke = vi.fn();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: create,
    revokeObjectURL: revoke,
  });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText('Noch kein Dokumentlayout eingerichtet.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
  );
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Preview Studio' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau erstellen' }));
  const open = await screen.findByRole('link', { name: 'Vorschau öffnen' });
  expect(open.getAttribute('target')).toBe('_blank');
  expect(open.getAttribute('rel')).toContain('noopener');
  expect(open.getAttribute('href')).toBe('blob:synthetic-pdf');
  expect(
    screen
      .getByRole('link', { name: 'Vorschau-PDF herunterladen' })
      .getAttribute('download'),
  ).toBeTruthy();
  expect(create).toHaveBeenCalledOnce();
});

test('a failed or malformed preview exposes no PDF link and retains entered values', async () => {
  const calls = api((_url, options) =>
    options?.method === 'POST'
      ? new Response('not a pdf', {
          headers: { 'content-type': 'application/pdf' },
        })
      : Response.json({ error: 'not_found' }, { status: 404 }),
  );
  const create = vi.fn(() => 'blob:must-not-exist');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText('Noch kein Dokumentlayout eingerichtet.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
  );
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Preview Studio' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau erstellen' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(
    (screen.getByLabelText('Absendername') as HTMLInputElement).value,
  ).toBe('Preview Studio');
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  expect(create).not.toHaveBeenCalled();
  const request = calls.find((call) => call.options?.method === 'POST')!;
  expect(request.url).toBe('/api/v1/document-layout/preview');
  expect(JSON.parse(String(request.options?.body))).toEqual({
    ...initial,
    senderName: 'Preview Studio',
  });
});

test('editing after a preview clears its links and revokes the old blob URL', async () => {
  api((_url, options) =>
    options?.method === 'POST'
      ? new Response('%PDF-1.4 fictional preview', {
          headers: { 'content-type': 'application/pdf' },
        })
      : Response.json({ error: 'not_found' }, { status: 404 }),
  );
  const create = vi.fn(() => 'blob:old-preview'),
    revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText('Noch kein Dokumentlayout eingerichtet.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
  );
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Preview Studio' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau erstellen' }));
  await screen.findByRole('link', { name: 'Vorschau öffnen' });
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Changed Studio' },
  });
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:old-preview');
});

test('a pending preview cannot create a blob URL after the panel unmounts', async () => {
  let finish!: (response: Response) => void;
  api((_url, options) =>
    options?.method === 'POST'
      ? new Promise<Response>((resolve) => (finish = resolve))
      : Response.json({ error: 'not_found' }, { status: 404 }),
  );
  const create = vi.fn(() => 'blob:after-unmount');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  const view = render(
    <DocumentLayoutPanel csrfToken="fictional-csrf" active />,
  );
  await screen.findByText('Noch kein Dokumentlayout eingerichtet.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout einrichten' }),
  );
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Preview Studio' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau erstellen' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(
    (
      screen.getByRole('button', {
        name: 'Dokumentlayout speichern',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  view.unmount();
  await act(async () => {
    finish(
      new Response('%PDF-1.4 fictional preview', {
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(create).not.toHaveBeenCalled();
});

test('a 5xx save stays uncertain until an explicit reload discards local edits', async () => {
  const calls = api((_url, options) =>
    options?.method === 'PUT'
      ? Response.json({ error: 'unavailable' }, { status: 500 })
      : Response.json(saved),
  );
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Local edit' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  expect(await screen.findByText(/Speicherstand ist unklar/)).toBeTruthy();
  expect((screen.getByLabelText('Ort') as HTMLInputElement).value).toBe(
    'Local edit',
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Änderungen verwerfen und neu laden',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Änderungen verwerfen und neu laden' }),
  );
  expect(await screen.findByText(/Fictional Town/)).toBeTruthy();
  expect(calls.filter((call) => call.options?.method === 'PUT')).toHaveLength(
    1,
  );
});

test('all presentation controls stay disabled during a pending save', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => (finish = resolve));
  api((_url, options) =>
    options?.method === 'PUT' ? pending : Response.json(saved),
  );
  render(<DocumentLayoutPanel csrfToken="fictional-csrf" active />);
  await screen.findByText(/Fictional Studio/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout bearbeiten' }),
  );
  fireEvent.click(screen.getByText('Darstellung'));
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Changed' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Dokumentlayout speichern' }),
  );
  await waitFor(() => {
    expect(
      (screen.getByLabelText('Ort') as HTMLInputElement).matches(':disabled'),
    ).toBe(true);
    expect(
      (screen.getByLabelText('Primärfarbe') as HTMLInputElement).matches(
        ':disabled',
      ),
    ).toBe(true);
    expect(
      (screen.getByLabelText('Schrift') as HTMLSelectElement).matches(
        ':disabled',
      ),
    ).toBe(true);
  });
  finish(Response.json({ ...saved, version: 4, senderCity: 'Changed' }));
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
});

test('document layout has a dedicated active settings route', () => {
  window.history.replaceState(null, '', '/#settings-document-layout');
  render(<SettingsNavigation />);
  expect(isSettingsRoute('document-layout')).toBe(true);
  expect(
    screen
      .getByRole('link', { name: 'Dokumentlayout' })
      .getAttribute('aria-current'),
  ).toBe('page');
});
