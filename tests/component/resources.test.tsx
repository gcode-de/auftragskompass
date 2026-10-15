import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResourcePanel } from '../../apps/admin/src/ResourcePanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic box',
  code: 'TEST',
  category: 'Synthetic',
  description: '',
  quantity: 1,
  beforeDays: 2,
  afterDays: 2,
  position: 0,
  state: 'active',
  blocked: false,
};
test('resource create/edit, archive, cancel and loading failures', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) rows = [{ ...row, ...JSON.parse(String(options.body)) }];
    return Response.json(options ? rows[0] : rows);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ResourcePanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Ressource bearbeiten: Synthetic box',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'New synthetic' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Ressource speichern' })
      .closest('form')!,
  );
  await screen.findByText('New synthetic – 1 Stück');
  fireEvent.click(
    screen.getByRole('button', { name: 'Ressource bearbeiten: New synthetic' }),
  );
  fireEvent.click(screen.getByLabelText('Gesperrt'));
  fireEvent.change(screen.getByLabelText('Zustand'), {
    target: { value: 'archived' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Ressource speichern' })
      .closest('form')!,
  );
  await screen.findByText('New synthetic – 1 Stück – Gesperrt – Archiviert');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/resources/synthetic',
    expect.objectContaining({ method: 'PUT' }),
  );
});
test('resource failures preserve edits and permit reload', async () => {
  const errors = ['conflict', 'invalid', 'resource_in_use'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options) return Response.json([row]);
      if (!errors.length) throw new Error('offline');
      return Response.json({ error: errors.shift() }, { status: 409 });
    }),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByRole('button', {
    name: 'Ressource bearbeiten: Synthetic box',
  });
  for (const text of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /künftig reserviert/,
    /Verbindung fehlgeschlagen/,
  ]) {
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Ressource speichern' })
        .closest('form')!,
    );
    await screen.findByText(text);
  }
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText(/konnten nicht geladen/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Ressourcen aktualisieren' }),
  );
  await screen.findByText(/konnten nicht geladen/);
});
