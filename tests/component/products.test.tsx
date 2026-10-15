import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProductPanel } from '../../apps/admin/src/ProductPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic product',
  description: 'Fictional',
  unit: 'Stück',
  priceMinor: 1999,
  priceBasis: 'gross',
  taxBasisPoints: 1900,
  state: 'active',
  position: 0,
};
test('products duplicate as new rows with exact prices and support archive/cancel', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) rows = [{ ...row, ...JSON.parse(String(options.body)) }];
    return Response.json(options ? rows[0] : rows);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProductPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Produkt bearbeiten: Synthetic product',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Produkt duplizieren: Synthetic product',
    }),
  );
  expect((screen.getByLabelText('Produktname') as HTMLInputElement).value).toBe(
    'Synthetic product (Kopie)',
  );
  fireEvent.change(screen.getByLabelText('Preis in Euro'), {
    target: { value: '0,01' },
  });
  fireEvent.change(screen.getByLabelText('Preisbasis'), {
    target: { value: 'net' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Produkt speichern' }).closest('form')!,
  );
  await screen.findByText('Synthetic product (Kopie) – 0,01 € Netto');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/products',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: 'Synthetic product (Kopie)',
        description: 'Fictional',
        unit: 'Stück',
        priceMinor: 1,
        priceBasis: 'net',
        taxBasisPoints: 1900,
        position: 0,
        state: 'active',
      }),
    }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Produkt bearbeiten: Synthetic product (Kopie)',
    }),
  );
  fireEvent.change(screen.getByLabelText('Produktzustand'), {
    target: { value: 'archived' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Produkt speichern' }).closest('form')!,
  );
  await screen.findByText(/Netto – Archiviert/);
});
test('products preserve input on invalid decimals, conflicts and transport errors', async () => {
  const errors = ['conflict', 'invalid'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options) return Response.json([row]);
      if (!errors.length) throw new Error('offline');
      return Response.json({ error: errors.shift() }, { status: 409 });
    }),
  );
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByRole('button', {
    name: 'Produkt bearbeiten: Synthetic product',
  });
  fireEvent.change(screen.getByLabelText('Preis in Euro'), {
    target: { value: '1.001' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Produkt speichern' }).closest('form')!,
  );
  await screen.findByText(/höchstens zwei/);
  fireEvent.change(screen.getByLabelText('Preis in Euro'), {
    target: { value: '19,99' },
  });
  for (const text of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /Verbindung fehlgeschlagen/,
  ]) {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Produkt speichern' })
        .closest('form')!,
    );
    await screen.findByText(text);
  }
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(/konnten nicht geladen/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Produkte aktualisieren' }),
  );
  await screen.findByText(/konnten nicht geladen/);
});
