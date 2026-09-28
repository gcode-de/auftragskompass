import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthPanel } from '../../apps/admin/src/AuthPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test('offers Google login only when configured', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  render(<AuthPanel />);
  expect(
    (
      await screen.findByRole('link', { name: 'Mit Google anmelden' })
    ).getAttribute('href'),
  ).toBe('/auth/login');
});
test('handles unavailable configuration and transport failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
  );
  render(<AuthPanel />);
  expect(await screen.findByText(/noch nicht eingerichtet/)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<AuthPanel />);
  expect(await screen.findByText(/nicht geprüft/)).toBeTruthy();
});
test('authenticated logout carries CSRF protection and supports retry', async () => {
  let logoutCalls = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/v1/access') return Response.json([]);
    if (url === '/auth/me')
      return Response.json({
        email: 'synthetic@example.invalid',
        csrfToken: 'synthetic-csrf',
      });
    return new Response(null, { status: ++logoutCalls === 1 ? 500 : 204 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AuthPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
  expect(await screen.findByText(/Abmelden fehlgeschlagen/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
  expect(await screen.findByText('Abgemeldet')).toBeTruthy();
  expect(fetcher).toHaveBeenLastCalledWith('/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': 'synthetic-csrf' },
  });
});

test('returns to login when a session expires or own access is blocked', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/auth/me'
        ? Response.json({
            email: 'synthetic@example.invalid',
            csrfToken: 'synthetic-csrf',
          })
        : new Response(null, { status: 401 }),
    ),
  );
  render(<AuthPanel />);
  expect(
    await screen.findByText('Sitzung beendet. Bitte erneut anmelden.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Mit Google anmelden' }),
  ).toBeTruthy();
});
