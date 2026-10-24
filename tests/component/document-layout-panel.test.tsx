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
