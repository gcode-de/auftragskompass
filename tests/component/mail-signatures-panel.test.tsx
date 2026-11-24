import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MailSignaturesPanel } from '../../apps/admin/src/MailSignaturesPanel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const standard = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Fiktive Signatur',
  bodyHtml: '<p>Viele Grüße</p><p>{{logo}}</p>',
  logoLink: 'https://example.invalid/',
  isDefault: true,
  hasLogo: true,
  updatedAt: '2030-10-26T10:00:00.000Z',
};

function harness(
  options: {
    rows?: unknown[];
    save?: (body: unknown) => Response;
    logo?: () => Response;
  } = {},
) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let rows = options.rows ?? [standard];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url === '/api/v1/mail-signatures' && method === 'GET')
        return Response.json(rows);
      if (url.endsWith('/logo') && method === 'PUT')
        return options.logo?.() ?? Response.json({ ...standard, id: 'new-id' });
      if (method === 'POST' || method === 'PUT') {
        const reply =
          options.save?.(body) ??
          Response.json(
            { ...standard, ...(body as object), id: 'new-id', hasLogo: false },
            { status: method === 'POST' ? 201 : 200 },
          );
        if (reply.ok) rows = [...rows, await reply.clone().json()];
        return reply;
      }
      if (method === 'DELETE') {
        rows = [];
        return new Response(null, { status: 204 });
      }
      throw Error('unexpected ' + url);
    }),
  );
  return calls;
}

test('lists signatures with the standard and the logo named', async () => {
  harness();
  render(<MailSignaturesPanel csrfToken="csrf" />);
  expect(
    await screen.findByText('Fiktive Signatur (Standard) · mit Logo'),
  ).toBeTruthy();
});

test('a new signature with logo, link and standard is saved and uploaded', async () => {
  const calls = harness({ rows: [] });
  render(<MailSignaturesPanel csrfToken="csrf-token" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Signatur anlegen' }),
  );
  // The very first signature is offered as the standard.
  expect(
    screen.getByLabelText('Als Standardsignatur verwenden'),
  ).toHaveProperty('checked', true);
  // The editor offers exactly the logo building block.
  fireEvent.click(screen.getByRole('button', { name: 'Platzhalter einfügen' }));
  const options = within(screen.getByLabelText('Platzhalter')).getAllByRole(
    'option',
  );
  expect(options.map((option) => option.textContent)).toEqual([
    'Platzhalter auswählen',
    'Logo — Logo dieser Signatur',
  ]);
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Neue Signatur' },
  });
  fireEvent.change(screen.getByLabelText('Logo verlinkt auf (optional)'), {
    target: { value: 'https://example.invalid/' },
  });
  const logo = new File([new Uint8Array([0x89, 0x50])], 'logo.png', {
    type: 'image/png',
  });
  fireEvent.change(screen.getByLabelText(/Logo hochladen/), {
    target: { files: [logo] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Signatur speichern' }));
  expect(await screen.findByText('Signatur gespeichert.')).toBeTruthy();
  const post = calls.find((call) => call.method === 'POST')!;
  expect(post.body).toMatchObject({
    name: 'Neue Signatur',
    logoLink: 'https://example.invalid/',
    isDefault: true,
  });
  const upload = calls.find(
    (call) => call.method === 'PUT' && call.url.endsWith('/logo'),
  )!;
  expect(upload.url).toBe('/api/v1/mail-signatures/new-id/logo');
  expect(upload.body).toBe(logo);
});

test('a refused save and a refused logo name their cause', async () => {
  harness({
    save: () => Response.json({ error: 'invalid_link' }, { status: 400 }),
  });
  render(<MailSignaturesPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Fiktive Signatur bearbeiten' }),
  );
  // An existing logo is shown with a way to remove it.
  expect(
    screen.getByRole('img', { name: 'Aktuelles Logo von Fiktive Signatur' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Signatur speichern' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Der Link des Logos muss mit http:// oder https:// beginnen.',
  );
  cleanup();
  harness({
    logo: () => Response.json({ error: 'invalid_logo' }, { status: 400 }),
  });
  render(<MailSignaturesPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Fiktive Signatur bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText(/Logo ersetzen/), {
    target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Signatur speichern' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Text gespeichert, Logo nicht: Das Logo muss eine PNG- oder JPEG-Datei sein.',
  );
});

test('a too large logo is refused before anything is sent', async () => {
  const calls = harness();
  render(<MailSignaturesPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Fiktive Signatur bearbeiten' }),
  );
  fireEvent.change(screen.getByLabelText(/Logo ersetzen/), {
    target: {
      files: [
        new File([new Uint8Array(512 * 1024 + 1)], 'big.png', {
          type: 'image/png',
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Signatur speichern' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Das Logo ist größer als 512 KiB.',
  );
  expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
});

test('deleting a signature and its logo asks first', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const calls = harness();
  render(<MailSignaturesPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Fiktive Signatur löschen' }),
  );
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Fiktive Signatur löschen' }),
  );
  expect(await screen.findByText('Signatur gelöscht.')).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Fiktive Signatur löschen' }),
    ).toBeNull(),
  );
});

test('a failed list offers to load again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 500 })),
  );
  render(<MailSignaturesPanel csrfToken="csrf" />);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Die Signaturen konnten nicht geladen werden.',
  );
  expect(
    screen.getByRole('button', { name: 'Signaturen neu laden' }),
  ).toBeTruthy();
});
