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
    if (url === '/api/v1/events')
      return Response.json({ timeZone: 'Europe/Berlin', events: [] });
    if (url.startsWith('/api/')) return Response.json([]);
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

test('password login supports retries, clears secrets and sends no CSRF token before login', async () => {
  let attempts = 0;
  let loggedIn = false;
  const fetcher = vi.fn(async (url: string) => {
    if (url.startsWith('/api/'))
      return url === '/api/v1/events'
        ? Response.json({ timeZone: 'Europe/Berlin', events: [] })
        : Response.json([]);
    if (url === '/auth/me')
      return loggedIn
        ? Response.json(
            {
              email: 'fictional.owner@example.invalid',
              csrfToken: 'fictional-csrf',
            },
            { headers: { 'x-auth-mode': 'password' } },
          )
        : new Response(null, {
            status: 401,
            headers: { 'x-auth-mode': 'password' },
          });
    attempts++;
    if (attempts === 1) return new Response(null, { status: 429 });
    if (attempts === 2) return new Response(null, { status: 401 });
    if (attempts === 3) throw new Error('offline');
    loggedIn = true;
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AuthPanel />);
  const identifier = await screen.findByLabelText('E-Mail oder Benutzername');
  const password = screen.getByLabelText('Passwort') as HTMLInputElement;
  expect(password.type).toBe('password');
  expect(screen.queryByText('Mit Google anmelden')).toBeNull();
  fireEvent.change(identifier, { target: { value: 'fictional.owner' } });
  for (const message of [
    /Zu viele Anfragen/,
    /Zugangsdaten prüfen/,
    /Bitte erneut versuchen/,
    /^Angemeldet$/,
  ]) {
    fireEvent.change(password, {
      target: { value: 'Fictional password 123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Anmelden$/ }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(
      (screen.queryByLabelText('Passwort') as HTMLInputElement | null)?.value ??
        '',
    ).toBe('');
  }
  expect(fetcher).toHaveBeenCalledWith('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identifier: 'fictional.owner',
      password: 'Fictional password 123!',
    }),
  });
  expect(await screen.findByText(/Weitere Passwortkonten/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Konto freigeben' })).toBeNull();
});

test('successful password submission still requires a working session', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/auth/login'
        ? new Response(null, { status: 204 })
        : new Response(null, {
            status: ++reads === 1 ? 401 : 500,
            headers: { 'x-auth-mode': 'password' },
          }),
    ),
  );
  render(<AuthPanel />);
  fireEvent.change(await screen.findByLabelText('E-Mail oder Benutzername'), {
    target: { value: 'fictional.owner' },
  });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'Fictional password 123!' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Anmelden$/ }));
  expect(
    await screen.findByText(/Anmeldung fehlgeschlagen. Bitte erneut versuchen/),
  ).toBeTruthy();
});
