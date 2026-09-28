import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AccessPanel } from '../../apps/admin/src/AccessPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const account = {
  id: 'synthetic-id',
  email: 'synthetic@example.invalid',
  active: true,
  claimed: true,
};
test('loads accounts, grants and blocks with CSRF, then re-enables', async () => {
  let accounts = [account];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options) return Response.json(accounts);
    accounts = [
      { ...account, active: options.method === 'POST', claimed: false },
    ];
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AccessPanel csrfToken="synthetic-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Sperren: synthetic@example.invalid',
    }),
  );
  await screen.findByText('synthetic@example.invalid – Gesperrt');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Freigeben: synthetic@example.invalid',
    }),
  );
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/access/synthetic-id',
      expect.objectContaining({ body: '{"active":true}' }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Google-E-Mail-Adresse'), {
    target: { value: 'new@example.invalid' },
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Konto freigeben',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Konto freigeben' }).closest('form')!,
  );
  await screen.findByText(
    'synthetic@example.invalid – Erste Anmeldung ausstehend',
  );
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/access',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'synthetic-csrf',
      },
      body: '{"email":"new@example.invalid"}',
    }),
  );
});
test('shows lockout, duplicate and other errors without losing existing entries', async () => {
  const errors = ['last_administrator', 'already_exists', 'forbidden'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? Response.json({ error: errors.shift() }, { status: 409 })
        : Response.json([account]),
    ),
  );
  render(<AccessPanel csrfToken="synthetic-csrf" />);
  const button = await screen.findByRole('button', {
    name: 'Sperren: synthetic@example.invalid',
  });
  for (const text of [
    /letzte aktive Administrator/,
    /bereits eingetragen/,
    /Änderung fehlgeschlagen/,
  ]) {
    fireEvent.click(button);
    await screen.findByText(text);
  }
});
test('reports loading and network failures', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error('offline')),
  );
  render(<AccessPanel csrfToken="synthetic-csrf" />);
  await screen.findByText(/nicht geladen/);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Konto freigeben' }).closest('form')!,
  );
  await screen.findByText(/Verbindung fehlgeschlagen/);
});

test('signals lost sessions during a mutation', async () => {
  const ended = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options
        ? Response.json({ error: 'unauthorized' }, { status: 401 })
        : Response.json([account]),
    ),
  );
  render(<AccessPanel csrfToken="synthetic-csrf" onSessionEnded={ended} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Sperren: synthetic@example.invalid',
    }),
  );
  await waitFor(() => expect(ended).toHaveBeenCalledOnce());
});
