import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { AuthPanel } from '../../apps/admin/src/AuthPanel.js';
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
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
  const logout = await screen.findByRole('button', { name: 'Abmelden' });
  expect(logout.getAttribute('title')).toBe('Abmelden');
  fireEvent.click(logout);
  expect(await screen.findByText(/Abmelden fehlgeschlagen/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
  expect(await screen.findByText('Abgemeldet')).toBeTruthy();
  expect(fetcher).toHaveBeenLastCalledWith('/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': 'synthetic-csrf' },
  });
});

test('collapsed sidebar keeps a failed logout status visible and announced', async () => {
  localStorage.setItem('ak-sidebar', 'collapsed');
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
  await screen.findByText('synthetic@example.invalid');
  const sidebar = screen.getByLabelText('Arbeitsbereiche');
  expect(sidebar.className).toContain('collapsed');
  const logout = screen.getByRole('button', { name: 'Abmelden' });
  fireEvent.click(logout);
  const failure = await screen.findByText(/Abmelden fehlgeschlagen/);
  expect(failure.getAttribute('role')).toBe('status');
  expect(failure.className).not.toContain('account-email');
  expect(failure.closest('.account-bar')).toBeTruthy();
  expect(screen.getByText('synthetic@example.invalid').className).toContain(
    'account-email',
  );
  expect(logout.isConnected).toBe(true);
  fireEvent.click(logout);
  expect(await screen.findByText('Abgemeldet')).toBeTruthy();
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
  window.history.replaceState(null, '', '/#settings-security');
  fireEvent(window, new HashChangeEvent('hashchange'));
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

test.each([204, 401])(
  'native password result %s returns the parent to login',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/auth/me'
          ? Response.json(
              {
                email: 'fictional.owner@example.invalid',
                csrfToken: 'fictional-csrf',
              },
              { headers: { 'x-auth-mode': 'password' } },
            )
          : url === '/auth/password'
            ? new Response(null, { status })
            : url === '/api/v1/events'
              ? Response.json({ timeZone: 'Europe/Berlin', events: [] })
              : Response.json([]),
      ),
    );
    window.history.replaceState(null, '', '/#settings-security');
    render(<AuthPanel />);
    fireEvent.change(
      await screen.findByLabelText('Aktuelles Passwort', { exact: true }),
      { target: { value: 'Fictional old password' } },
    );
    for (const label of ['Neues Passwort', 'Neues Passwort wiederholen'])
      fireEvent.change(screen.getByLabelText(label, { exact: true }), {
        target: { value: 'Fictional new password' },
      });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Passwort ändern' }).closest('form')!,
    );
    expect(
      await screen.findByLabelText('E-Mail oder Benutzername'),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      status === 204 ? 'Passwort geändert' : 'Sitzung beendet',
    );
  },
);

test('shows one workspace and preserves unsaved input across section changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/auth/me'
        ? Response.json({
            email: 'fictional.owner@example.invalid',
            csrfToken: 'fictional-csrf',
          })
        : url === '/api/v1/events'
          ? Response.json({ timeZone: 'Europe/Berlin', events: [] })
          : Response.json([]),
    ),
  );
  render(<AuthPanel />);
  await screen.findByRole('region', { name: 'Events' });
  expect(screen.queryByRole('region', { name: 'Kontakte' })).toBeNull();
  window.history.replaceState(null, '', '/#contacts');
  fireEvent(window, new HashChangeEvent('hashchange'));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Kontakt anlegen' }),
  );
  const input = await screen.findByLabelText('Name / Firma');
  fireEvent.change(input, { target: { value: 'Fictional unsaved contact' } });
  window.history.replaceState(null, '', '/#calendar');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(screen.queryByRole('region', { name: 'Kontakte' })).toBeNull();
  window.history.replaceState(null, '', '/#contacts');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Fictional unsaved contact');
});

test('the Dateien area renders in the shell with exactly one page heading', async () => {
  window.history.replaceState(
    null,
    '',
    '/?q=keep&from=2031-05-01&status=option&df_kind=invoice#files',
  );
  const requested: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/auth/me')
      return Response.json({
        email: 'synthetic@example.invalid',
        csrfToken: 'synthetic-csrf',
      });
    if (url.startsWith('/api/v1/documents'))
      requested.push(url.replace(/^.*\/api\/v1\/documents/, ''));
    if (url === '/api/v1/events')
      return Response.json({ timeZone: 'Europe/Berlin', events: [] });
    if (url.startsWith('/api/')) return Response.json([]);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AuthPanel />);
  const files = await screen.findByRole('region', { name: 'Dateien' });
  // The shell's toolbar heading is the only page heading, and the panel does
  // not repeat the label as a second one.
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  // One visible page title; its accessible name names the home link too.
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Dateien – zur Eventübersicht',
    }),
  ).toBe(headings[0]);
  expect(within(files).queryByRole('heading')).toBeNull();
  // The file filters are server-side; the unrelated Event filter stays in the
  // URL but is not sent to the document list.
  await waitFor(() =>
    expect(requested.some((query) => query.includes('kind=invoice'))).toBe(
      true,
    ),
  );
  for (const query of requested) {
    expect(query).not.toContain('status=');
    expect(query).not.toContain('from=2031-05-01');
  }
  expect(new URLSearchParams(window.location.search).get('q')).toBe('keep');
});

test('leaving a dirty event for Dateien asks first and keeps the draft when cancelled', async () => {
  const eventId = '11111111-1111-4111-8111-111111111111';
  window.history.replaceState(null, '', '/#event-' + eventId);
  const writes: string[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method && options.method !== 'GET') writes.push(url);
    if (url === '/auth/me')
      return Response.json({
        email: 'synthetic@example.invalid',
        csrfToken: 'synthetic-csrf',
      });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage', state: 'active' },
        { code: 'option', label: 'Option', state: 'active' },
        { code: 'booked', label: 'Gebucht', state: 'active' },
      ]);
    if (url === '/api/v1/events')
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: [
          {
            id: eventId,
            name: 'Synthetic dirty event',
            status: 'option',
            eventTypeId: null,
            packageId: null,
            locationId: null,
            venue: '',
            venueOverride: false,
            source: '',
            eventDate: '2031-05-01',
            startsAt: null,
            endsAt: null,
            timeZone: 'Europe/Berlin',
            description: '',
            notesHtml: '',
            version: 3,
            primaryContactId: null,
            additionalContactIds: [],
          },
        ],
      });
    if (url.startsWith('/api/v1/events/' + eventId))
      return Response.json({
        event: {
          id: eventId,
          name: 'Synthetic dirty event',
          status: 'option',
          timeZone: 'Europe/Berlin',
          description: '',
          notesHtml: '',
          version: 3,
        },
        contacts: [],
        resources: [],
        activities: [],
      });
    if (url.startsWith('/api/v1/')) return Response.json([]);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AuthPanel />);
  const edit = await screen.findByRole('button', {
    name: 'Event bearbeiten: Synthetic dirty event',
  });
  fireEvent.click(edit);
  // The details' own registered draft is the status field; changing it marks
  // the event file dirty exactly as a real edit would.
  const status = (await screen.findByLabelText(
    'Status des Events',
  )) as HTMLSelectElement;
  fireEvent.change(status, { target: { value: 'inquiry' } });
  expect(status.value).toBe('inquiry');

  const filesLink = screen
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .querySelector<HTMLAnchorElement>('a[href="#files"]')!;
  // Cancel: the hash, the draft and the focus stay exactly where they were.
  const cancelled = vi.fn((message?: string) => {
    void message;
    return false;
  });
  vi.stubGlobal('confirm', cancelled);
  fireEvent.click(filesLink);
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(cancelled.mock.calls[0]![0]).toContain('Ungespeicherte Eingaben');
  expect(window.location.hash).toBe('#event-' + eventId);
  expect(
    (screen.getByLabelText('Status des Events') as HTMLSelectElement).value,
  ).toBe('inquiry');
  // No write happened just from attempting to navigate.
  expect(writes).toEqual([]);

  // Accepting the discard really switches area.
  const accepted = vi.fn(() => true);
  vi.stubGlobal('confirm', accepted);
  fireEvent.click(filesLink);
  expect(accepted).toHaveBeenCalledTimes(1);
  window.history.replaceState(null, '', '/#files');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(await screen.findByRole('region', { name: 'Dateien' })).toBeTruthy();
  expect(writes).toEqual([]);
});

test('the Dateien guard also covers the mobile menu and never triggers on a new-tab click', async () => {
  const eventId = '22222222-2222-4222-8222-222222222222';
  window.history.replaceState(null, '', '/#event-' + eventId);
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/auth/me')
      return Response.json({
        email: 'synthetic@example.invalid',
        csrfToken: 'synthetic-csrf',
      });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage', state: 'active' },
        { code: 'option', label: 'Option', state: 'active' },
      ]);
    if (url === '/api/v1/events')
      return Response.json({
        timeZone: 'Europe/Berlin',
        events: [
          {
            id: eventId,
            name: 'Synthetic mobile event',
            status: 'option',
            eventTypeId: null,
            packageId: null,
            locationId: null,
            venue: '',
            venueOverride: false,
            source: '',
            eventDate: '2031-05-01',
            startsAt: null,
            endsAt: null,
            timeZone: 'Europe/Berlin',
            description: '',
            notesHtml: '',
            version: 1,
            primaryContactId: null,
            additionalContactIds: [],
          },
        ],
      });
    if (url.startsWith('/api/v1/events/' + eventId))
      return Response.json({
        event: {
          id: eventId,
          name: 'Synthetic mobile event',
          status: 'option',
          timeZone: 'Europe/Berlin',
          description: '',
          notesHtml: '',
          version: 1,
        },
        contacts: [],
        resources: [],
        activities: [],
      });
    if (url.startsWith('/api/v1/')) return Response.json([]);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
  // jsdom has no dialog implementation; the established shim opens it.
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  render(<AuthPanel />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic mobile event',
    }),
  );
  fireEvent.change(await screen.findByLabelText('Status des Events'), {
    target: { value: 'inquiry' },
  });

  // A new-tab click is a decision about another tab: never a prompt here.
  const sidebarLink = screen
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .querySelector<HTMLAnchorElement>('a[href="#files"]')!;
  const modifierConfirm = vi.fn(() => false);
  vi.stubGlobal('confirm', modifierConfirm);
  fireEvent.click(sidebarLink, { ctrlKey: true, button: 0 });
  expect(modifierConfirm).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#event-' + eventId);

  // The mobile menu entry is the same guarded action.
  fireEvent.click(screen.getByRole('button', { name: 'Menü öffnen' }));
  const drawer = within(screen.getByRole('dialog', { name: 'Menü' }));
  const mobileLink = drawer
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .querySelector<HTMLAnchorElement>('a[href="#files"]')!;
  const cancel = vi.fn(() => false);
  vi.stubGlobal('confirm', cancel);
  fireEvent.click(mobileLink);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('#event-' + eventId);
  // Cancel keeps the menu open, so the user sees why nothing happened.
  expect(screen.getByRole('dialog', { name: 'Menü' })).toBeTruthy();
});
