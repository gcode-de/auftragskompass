import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { ContactPanel } from '../../apps/admin/src/ContactPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const row = {
  id: 'synthetic',
  version: 1,
  kind: 'company',
  name: 'Synthetic Company',
  contactPerson: 'Fictional',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
  email: 'synthetic@example.invalid',
  phone: '030 000000',
  mobile: '',
  state: 'active',
};
test('contacts search, suggest duplicates, edit and archive with direct communication links', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/duplicates')) return Response.json([row]);
    if (options) rows = [{ ...row, ...JSON.parse(String(options.body)) }];
    return Response.json(options ? rows[0] : rows);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Kontakt bearbeiten: Synthetic Company',
    }),
  );
  expect(
    screen
      .getByRole('link', { name: 'E-Mail: Synthetic Company' })
      .getAttribute('href'),
  ).toBe('mailto:synthetic%40example.invalid');
  expect(
    screen
      .getByRole('link', { name: 'Anrufen: Synthetic Company' })
      .getAttribute('href'),
  ).toBe('tel:030000000');
  fireEvent.click(screen.getByRole('button', { name: 'Dubletten prüfen' }));
  await screen.findByText('Mögliche Dubletten: Synthetic Company');
  fireEvent.change(screen.getByLabelText('Kontaktzustand'), {
    target: { value: 'archived' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Kontakt speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic Company – Archiviert');
  const searchAction = screen.getByRole('button', {
    name: 'Kontakte durchsuchen',
  });
  expect(searchAction.getAttribute('title')).toBe('Kontakte durchsuchen');
  expect(searchAction.textContent).toBe('');
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'Synthetic' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  expect(fetcher).toHaveBeenCalledWith('/api/v1/contacts?q=Synthetic');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Kontakt bearbeiten: Synthetic Company',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kontakt abbrechen' }));
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('');
  expect(
    screen
      .getByRole('link', { name: 'Kontakte als CSV exportieren' })
      .getAttribute('href'),
  ).toBe('/api/v1/contacts/export.csv');
});
test('contacts retain input after validation, conflict, load and connection errors', async () => {
  const errors = ['conflict', 'invalid'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options) return Response.json([row]);
      if (!errors.length) throw Error('offline');
      return Response.json({ error: errors.shift() }, { status: 409 });
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic draft' },
  });
  for (const text of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /Verbindung fehlgeschlagen/,
  ]) {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Kontakt speichern' })
        .closest('form')!,
    );
    await screen.findByText(text);
  }
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic draft');
  fireEvent.click(screen.getByRole('button', { name: 'Dubletten prüfen' }));
  await screen.findByText(/Dublettenprüfung fehlgeschlagen/);
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText(/Kontakte konnten nicht geladen/);
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await screen.findByText(/Kontakte konnten nicht geladen/);
});

test('contacts reveal related events and handle empty or unavailable relations', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!url.endsWith('/events')) return Response.json([row]);
      if (calls++ === 0)
        return Response.json([
          { id: 'synthetic-event', name: 'Fictional linked event' },
        ]);
      if (calls === 2) return Response.json([]);
      return new Response(null, { status: 500 });
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  const button = await screen.findByRole('button', {
    name: 'Events anzeigen: Synthetic Company',
  });
  fireEvent.click(button);
  expect(
    (
      await screen.findByRole('link', { name: 'Fictional linked event' })
    ).getAttribute('href'),
  ).toBe('#event-synthetic-event');
  fireEvent.click(button);
  await screen.findByText('Keine zugeordneten Events.');
  fireEvent.click(button);
  await screen.findByText(/Zugeordnete Events konnten nicht geladen/);
});

test('contact search keeps the newest result when an older request finishes later', async () => {
  let resolveOld!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/v1/contacts'
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(
            Response.json([{ ...row, name: 'Synthetic fresh contact' }]),
          ),
    ),
  );
  render(<ContactPanel csrfToken="csrf" />);
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'fresh' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await screen.findByText('Synthetic fresh contact');
  await act(async () => resolveOld(Response.json([row])));
  expect(screen.queryByText('Synthetic Company')).toBeNull();
});

test('reapplying the global query resets a local contact search even when the URL is unchanged', async () => {
  window.history.replaceState(null, '', '/?q=Synthetic');
  const fetcher = vi.fn().mockImplementation(async () => Response.json([row]));
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'local' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  act(() => updateUrlSearch({ q: 'Synthetic' }));
  expect(
    (screen.getByLabelText('Kontakte suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
});
