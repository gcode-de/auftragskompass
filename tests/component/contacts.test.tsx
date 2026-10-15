import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContactPanel } from '../../apps/admin/src/ContactPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'Synthetic' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Suchen' }).closest('form')!,
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
    screen.getByRole('button', { name: 'Suchen' }).closest('form')!,
  );
  await screen.findByText(/Kontakte konnten nicht geladen/);
});
