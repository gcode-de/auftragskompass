import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocationPanel } from '../../apps/admin/src/LocationPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic venue',
  street: 'Fictional street',
  postalCode: '00000',
  city: 'Synthetic city',
  country: 'DE',
  state: 'active',
};
test('locations create, search, edit, cancel and archive', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) rows = [{ ...row, ...JSON.parse(String(options.body)) }];
    return Response.json(options ? rows[0] : rows);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<LocationPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Location bearbeiten: Synthetic venue',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Location abbrechen' }));
  fireEvent.change(screen.getByLabelText('Locationname'), {
    target: { value: 'Synthetic new venue' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Location speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic new venue');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Location bearbeiten: Synthetic new venue',
    }),
  );
  fireEvent.change(screen.getByLabelText('Locationzustand'), {
    target: { value: 'archived' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Location speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic new venue – Archiviert');
  fireEvent.change(screen.getByLabelText('Locations suchen'), {
    target: { value: 'Synthetic' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Locations suchen' }).closest('form')!,
  );
  expect(fetcher).toHaveBeenCalledWith('/api/v1/locations?q=Synthetic');
});
test('location errors preserve drafts and expose reload failures', async () => {
  const errors = ['conflict', 'invalid'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options) return Response.json([]);
      if (!errors.length) throw Error('offline');
      return Response.json({ error: errors.shift() }, { status: 409 });
    }),
  );
  render(<LocationPanel csrfToken="csrf" />);
  for (const message of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /Verbindung fehlgeschlagen/,
  ]) {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Location speichern' })
        .closest('form')!,
    );
    await screen.findByText(message);
  }
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  render(<LocationPanel csrfToken="csrf" />);
  await screen.findByText(/Locations konnten nicht geladen/);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Locations suchen' }).closest('form')!,
  );
  await screen.findByText(/Locations konnten nicht geladen/);
});
