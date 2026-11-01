import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import {
  MasterDataPanel,
  MasterDataSettings,
} from '../../apps/admin/src/MasterDataPanel.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const row = {
  id: 'synthetic-id',
  name: 'Synthetic entry',
  state: 'active',
  position: 0,
  version: 1,
};
test('keeps catalog editors closed until needed and protects a pending draft', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([row])),
  );
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(
    <MasterDataPanel kind="package" title="Paketwerte" csrfToken="csrf" />,
  );
  await screen.findByRole('button', { name: 'Bearbeiten: Synthetic entry' });
  expect(screen.getByText('Eintrag hinzufügen').closest('details')?.open).toBe(
    false,
  );
  fireEvent.click(screen.getByText('Eintrag hinzufügen'));
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Unsaved synthetic' },
  });
  fireEvent.click(screen.getByText('Eintrag hinzufügen'));
  expect(screen.getByText('Ungespeichert', { exact: false })).toBeTruthy();
  expect(screen.getByText('Eintrag hinzufügen').closest('details')?.open).toBe(
    false,
  );
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(screen.getByText('Eintrag hinzufügen'));
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    'Unsaved synthetic',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeiten: Synthetic entry' }),
  );
  expect(confirm).toHaveBeenCalled();
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    'Unsaved synthetic',
  );
});
test('a confirmed save followed by a failed refresh cannot be submitted twice', async () => {
  let failRefresh = false;
  let writes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        writes++;
        failRefresh = true;
        return Response.json(row);
      }
      if (failRefresh) throw new Error('offline');
      return Response.json([row]);
    }),
  );
  render(
    <MasterDataPanel kind="package" title="Paketwerte" csrfToken="csrf" />,
  );
  await screen.findByText('Synthetic entry – Aktiv');
  fireEvent.click(screen.getByText('Eintrag hinzufügen'));
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic new' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Speichern' }).closest('form')!,
  );
  await screen.findByText(/Gespeichert.*Liste konnte nicht aktualisiert/);
  fireEvent.click(screen.getByText('Eintrag hinzufügen'));
  expect(
    screen.getByRole('button', { name: 'Speichern' }).matches(':disabled'),
  ).toBe(true);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Speichern' }).closest('form')!,
  );
  expect(writes).toBe(1);
  failRefresh = false;
  fireEvent.click(screen.getByRole('button', { name: 'Liste aktualisieren' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Speichern' }).matches(':disabled'),
    ).toBe(false),
  );
  expect(writes).toBe(1);
});
test('creates, edits, archives and cancels using native accessible controls', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options) return Response.json(rows);
    const body = JSON.parse(String(options.body));
    rows = [{ ...row, ...body }];
    return Response.json(rows[0]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <MasterDataPanel kind="package" title="Paketwerte" csrfToken="csrf" />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Bearbeiten: Synthetic entry' }),
  );
  expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung'));
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    '',
  );
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'New synthetic' },
  });
  fireEvent.change(screen.getByLabelText('Sortierung'), {
    target: { value: '2' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Speichern' }).closest('form')!,
  );
  await screen.findByText('New synthetic – Aktiv');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/master-data/package',
    expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'csrf' },
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeiten: New synthetic' }),
  );
  fireEvent.change(screen.getByLabelText('Zustand'), {
    target: { value: 'archived' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Speichern' }).closest('form')!,
  );
  await screen.findByText('New synthetic – Archiviert');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/master-data/package/synthetic-id',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        name: 'New synthetic',
        position: 2,
        state: 'archived',
        version: 1,
      }),
    }),
  );
});
test('retains drafts on conflict, duplicate, denied and network errors', async () => {
  const errors = ['conflict', 'name_exists', 'forbidden'];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options) return Response.json([{ ...row, state: 'inactive' }]);
    if (!errors.length) throw new Error('offline');
    return Response.json({ error: errors.shift() }, { status: 409 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <MasterDataPanel kind="package" title="Paketwerte" csrfToken="csrf" />,
  );
  await screen.findByText('Synthetic entry – Inaktiv');
  fireEvent.click(screen.getByText('Eintrag hinzufügen'));
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Keep draft' },
  });
  for (const text of [
    /Inzwischen geändert/,
    /bereits vorhanden/,
    /Speichern fehlgeschlagen/,
    /Verbindung fehlgeschlagen/,
  ]) {
    fireEvent.submit(
      screen.getByRole('button', { name: 'Speichern' }).closest('form')!,
    );
    await screen.findByText(text);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  }
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    'Keep draft',
  );
});
test('settings show fixed statuses and loading errors allow retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('statuses')
        ? Response.json([{ code: 'inquiry', label: 'Anfrage' }])
        : new Response(null, { status: 500 }),
    ),
  );
  render(<MasterDataSettings csrfToken="csrf" />);
  expect(await screen.findByText('Anfrage')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Absagegründe' })).toBeTruthy();
  const packages = within(screen.getByRole('region', { name: 'Paketwerte' }));
  await packages.findByText(/Liste konnte/);
  fireEvent.click(
    packages.getByRole('button', { name: 'Liste aktualisieren' }),
  );
  await packages.findByText(/Liste konnte/);
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<MasterDataSettings csrfToken="csrf" />);
  await screen.findByRole('alert');
});
