import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ResourcePanel } from '../../apps/admin/src/ResourcePanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic box',
  code: 'SYN-1',
  category: 'Fotobox',
  description: 'Fictional',
  quantity: 1,
  beforeDays: 2,
  afterDays: 2,
  position: 0,
  state: 'active',
  blocked: false,
};
const spare = {
  ...row,
  id: 'synthetic-spare',
  version: 2,
  name: 'Synthetic spare',
  code: 'SYN-2',
  category: 'Zubehör',
  quantity: 2,
  position: 1,
  state: 'inactive',
};
const retired = {
  ...row,
  id: 'synthetic-retired',
  version: 4,
  name: 'Synthetic retired',
  code: 'SYN-3',
  quantity: 3,
  position: 2,
  state: 'archived',
  blocked: true,
};
function listFetcher(rows: (typeof row)[] = [row]) {
  return vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(options ? rows[0] : rows),
  );
}
async function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Ressource anlegen' }));
  return screen.findByRole('dialog', { name: 'Ressource anlegen' });
}
async function openEdit(name: string) {
  const trigger = screen.getByRole('button', {
    name: 'Ressource bearbeiten: ' + name,
  });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole('dialog', { name: 'Ressource bearbeiten' });
}
function submitSave(dialog: HTMLElement) {
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Ressource speichern' })
      .closest('form')!,
  );
}
function mutations(fetcher: ReturnType<typeof listFetcher>) {
  return fetcher.mock.calls.filter(([, options]) => Boolean(options));
}

test('the resource page starts with the compact toolbar and the list, without an exposed editor', async () => {
  const list = listFetcher([row, spare, retired]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) =>
      String(url) === '/api/v1/resource-blocks'
        ? Response.json({ timeZone: 'Europe/Berlin', units: [], blocks: [] })
        : list(url, options),
    ),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  const resources = screen.getByRole('region', { name: 'Ressourcen' });
  await within(resources).findByText(
    'Synthetic box – 1 Stück – Fotobox – Aktiv',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Ressource speichern' }),
  ).toBeNull();
  const search = screen.getByLabelText('Ressourcen suchen');
  expect(search.closest('form')).toBeNull();
  expect(
    search.closest('.resource-toolbar')!.nextElementSibling?.localName,
  ).not.toBe('form');
  expect(screen.getByLabelText('Kategorie filtern')).toBeTruthy();
  expect(screen.getByLabelText('Zustand filtern')).toBeTruthy();
  const create = screen.getByRole('button', { name: 'Ressource anlegen' });
  expect(create.getAttribute('title')).toBe('Ressource anlegen');
  expect(create.textContent).toBe('');
  expect(create.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  // The list states name, quantity, category, state and the block flag.
  expect(
    screen.getByText('Synthetic spare – 2 Stück – Zubehör – Inaktiv'),
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Synthetic retired – 3 Stück – Fotobox – Archiviert – Gesperrt',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Ressourcen' })).toBeTruthy();
  // The unchanged block management stays reachable below the list, but only as
  // a deliberate disclosure: the region and its label exist, while the form,
  // its primary action and the overview are not mounted before the opening.
  const blocks = screen.getByRole('region', {
    name: 'Zeitweise Ressourcensperren',
  });
  expect(blocks).toBeTruthy();
  await within(blocks).findByText(/^Sperrverwaltung öffnen$/);
  expect(within(blocks).queryByLabelText('Sperrgrund')).toBeNull();
  expect(
    within(blocks).queryByRole('button', { name: 'Zeitraum sperren' }),
  ).toBeNull();
  expect(
    within(blocks).getByRole('button', { name: 'Sperren aktualisieren' }),
  ).toBeTruthy();
});

test('the plus action opens an accessible dialog with focus, focus trap, cancel and Escape return', async () => {
  vi.stubGlobal('fetch', listFetcher());
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  const create = screen.getByRole('button', { name: 'Ressource anlegen' });
  create.focus();
  const dialog = await openCreate();
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  const labelledBy = dialog.getAttribute('aria-labelledby')!;
  expect(document.getElementById(labelledBy)?.textContent).toBe(
    'Ressource anlegen',
  );
  expect(screen.getByLabelText('Bezeichnung')).toBe(document.activeElement);
  const close = within(dialog).getByRole('button', {
    name: 'Dialog schließen',
  });
  expect(close.getAttribute('title')).toBe('Dialog schließen');
  const save = within(dialog).getByRole('button', {
    name: 'Ressource speichern',
  });
  // Focus that sits on the dialog itself is moved to the first control, and
  // Shift+Tab from there wraps to the last one.
  dialog.focus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(close).toBe(document.activeElement);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(save).toBe(document.activeElement);
  save.focus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(close).toBe(document.activeElement);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(save).toBe(document.activeElement);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Ressource abbrechen' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).toBe(document.activeElement);
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  const second = await openCreate();
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).toBe(document.activeElement);
});

test('keeps the complete field contract and edits with the row version', async () => {
  const saved: {
    url: string;
    method: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (!options) return Response.json([row]);
      saved.push({
        url,
        method: options.method,
        body: JSON.parse(String(options.body)) as Record<string, unknown>,
      });
      return Response.json(row);
    }),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  let dialog = await openCreate();
  const fields: [string, string, string][] = [
    ['Bezeichnung', '', '120'],
    ['Interner Code', '', '40'],
    ['Kategorie', '', '120'],
    ['Beschreibung', '', '2000'],
    ['Bestand', '1', ''],
    ['Puffer vorher (Tage)', '2', ''],
    ['Puffer nachher (Tage)', '2', ''],
    ['Sortierung', '0', ''],
  ];
  for (const [label, value, maxLength] of fields) {
    const input = within(dialog).getByLabelText(label) as HTMLInputElement;
    expect(input.value).toBe(value);
    if (maxLength) expect(input.maxLength).toBe(Number(maxLength));
  }
  expect(
    (within(dialog).getByLabelText('Zustand') as HTMLSelectElement).value,
  ).toBe('active');
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic new box' },
  });
  fireEvent.change(within(dialog).getByLabelText('Interner Code'), {
    target: { value: 'SYN-9' },
  });
  fireEvent.change(within(dialog).getByLabelText('Kategorie'), {
    target: { value: 'Fotobox' },
  });
  fireEvent.change(within(dialog).getByLabelText('Beschreibung'), {
    target: { value: 'Fictional note' },
  });
  fireEvent.change(within(dialog).getByLabelText('Bestand'), {
    target: { value: '4' },
  });
  submitSave(dialog);
  await screen.findByText('Ressource gespeichert.');
  expect(saved[0]!.url).toBe('/api/v1/resources');
  expect(saved[0]!.method).toBe('POST');
  expect(saved[0]!.body).toMatchObject({
    name: 'Synthetic new box',
    code: 'SYN-9',
    category: 'Fotobox',
    description: 'Fictional note',
    quantity: 4,
    beforeDays: 2,
    afterDays: 2,
    position: 0,
    state: 'active',
    blocked: false,
  });
  expect(saved[0]!.body.version).toBeUndefined();
  dialog = await openEdit('Synthetic box');
  expect(
    (within(dialog).getByLabelText('Interner Code') as HTMLInputElement).value,
  ).toBe('SYN-1');
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic box renamed' },
  });
  submitSave(dialog);
  await screen.findByText('Ressource gespeichert.');
  expect(saved[1]!.url).toBe('/api/v1/resources/synthetic');
  expect(saved[1]!.method).toBe('PUT');
  expect(saved[1]!.body.version).toBe(1);
});

test('returns focus to the plus action when the edited row disappears after saving', async () => {
  let saved = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        saved = true;
        return Response.json(row);
      }
      return Response.json(saved ? [] : [row]);
    }),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  const dialog = await openEdit('Synthetic box');
  fireEvent.change(within(dialog).getByLabelText('Zustand'), {
    target: { value: 'archived' },
  });
  submitSave(dialog);
  await screen.findByText('Ressource gespeichert.');
  expect(screen.getByText(/Noch keine Ressourcen/)).toBeTruthy();
  const create = screen.getByRole('button', { name: 'Ressource anlegen' });
  await waitFor(() => expect(create).toBe(document.activeElement));
});

test('an untouched dialog is not dirty and a changed draft needs an explicit discard confirmation', async () => {
  vi.stubGlobal('fetch', listFetcher());
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  let dialog = await openEdit('Synthetic box');
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional unsaved box' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Ressource abbrechen' }),
  );
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und den Ressourcendialog schließen?',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    'Fictional unsaved box',
  );
  confirm.mockReturnValue(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  dialog = await openCreate();
  expect(
    (within(dialog).getByLabelText('Bezeichnung') as HTMLInputElement).value,
  ).toBe('');
  fireEvent.keyDown(dialog, { key: 'Escape' });
});

test('a double submit sends exactly one mutation and holds the dialog open while saving', async () => {
  let finish: (response: Response) => void = () => {};
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json([row]),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  const dialog = await openEdit('Synthetic box');
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic pending box' },
  });
  const form = within(dialog)
    .getByRole('button', { name: 'Ressource speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(dialog);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Dialog schließen' }),
  );
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(1);
  await act(async () =>
    finish(Response.json({ ...row, name: 'Synthetic pending box' })),
  );
  await screen.findByText('Ressource gespeichert.');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetcher.mock.calls.filter(([, options]) => options)).toHaveLength(1);
});

test('keeps entered values after conflict, duplicate code, in-use and connection errors', async () => {
  const errors = ['conflict', 'code_exists', 'resource_in_use'];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options) return Response.json([retired]);
    if (!errors.length) throw Error('offline');
    return Response.json({ error: errors.shift() }, { status: 409 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText(
    'Synthetic retired – 3 Stück – Fotobox – Archiviert – Gesperrt',
  );
  const dialog = await openEdit('Synthetic retired');
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic draft box' },
  });
  for (const text of [
    /Inzwischen geändert/,
    /interne Code ist bereits vergeben/,
    /künftig reserviert/,
    /Verbindung fehlgeschlagen/,
  ]) {
    submitSave(dialog);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(text);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  }
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    'Synthetic draft box',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mutations(fetcher)).toHaveLength(4);
  const body = JSON.parse(String(mutations(fetcher)[0]![1]!.body)) as Record<
    string,
    unknown
  >;
  expect(body.version).toBe(4);
  expect(body.name).toBe('Synthetic draft box');
});

test('reports a saved resource honestly when the following list load fails and retries with GET only', async () => {
  let listCalls = 0;
  let failList = false;
  let saved = false;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      saved = true;
      return Response.json({ ...row, name: 'Synthetic saved box' });
    }
    listCalls += 1;
    if (failList && listCalls > 1) throw Error('offline');
    return Response.json([
      saved ? { ...row, name: 'Synthetic saved box' } : row,
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  failList = true;
  const dialog = await openEdit('Synthetic box');
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic saved box' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Ressource gespeichert, die Liste konnte nicht neu geladen werden.',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mutations(fetcher)).toHaveLength(1);
  expect(screen.getByText('Ressource gespeichert.')).toBeTruthy();
  // A failing retry keeps the warning and still sends no second mutation.
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Ressourcen erneut laden' }),
    );
  });
  expect(
    screen.getByText(
      'Ressource gespeichert, die Liste konnte nicht neu geladen werden.',
    ),
  ).toBeTruthy();
  expect(mutations(fetcher)).toHaveLength(1);
  failList = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Ressourcen erneut laden' }),
  );
  await screen.findByText('Synthetic saved box – 1 Stück – Fotobox – Aktiv');
  expect(mutations(fetcher)).toHaveLength(1);
  expect(
    screen.queryByText(
      'Ressource gespeichert, die Liste konnte nicht neu geladen werden.',
    ),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Ressourcen erneut laden' }),
  ).toBeNull();
});

test('filters by name, code, category and state and keeps the filter state while editing and saving', async () => {
  let rows: (typeof row)[] = [row, spare, retired];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (!options) return Response.json(rows);
      const body = JSON.parse(String(options.body)) as Partial<typeof row>;
      const id = url.split('/').pop();
      rows = rows.map((entry) =>
        entry.id === id ? { ...entry, ...body, id: entry.id } : entry,
      );
      return Response.json(rows.find((entry) => entry.id === id));
    }),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  const search = screen.getByLabelText('Ressourcen suchen') as HTMLInputElement;
  const category = screen.getByLabelText(
    'Kategorie filtern',
  ) as HTMLSelectElement;
  const state = screen.getByLabelText('Zustand filtern') as HTMLSelectElement;
  expect(category.value).toBe('');
  expect(state.value).toBe('');
  expect(
    Array.from(category.options).map((option) => option.textContent),
  ).toEqual(['Alle Kategorien', 'Fotobox', 'Zubehör']);
  fireEvent.change(search, { target: { value: 'SPARE' } });
  expect(screen.queryByText(/Synthetic box –/)).toBeNull();
  expect(
    screen.getByText('Synthetic spare – 2 Stück – Zubehör – Inaktiv'),
  ).toBeTruthy();
  fireEvent.change(search, { target: { value: 'syn-1' } });
  expect(
    screen.getByText('Synthetic box – 1 Stück – Fotobox – Aktiv'),
  ).toBeTruthy();
  expect(screen.queryByText(/Synthetic spare/)).toBeNull();
  fireEvent.change(search, { target: { value: 'zubehör' } });
  expect(
    screen.getByText('Synthetic spare – 2 Stück – Zubehör – Inaktiv'),
  ).toBeTruthy();
  expect(screen.queryByText(/Synthetic box –/)).toBeNull();
  fireEvent.change(search, { target: { value: 'retired' } });
  expect(
    screen.getByText(
      'Synthetic retired – 3 Stück – Fotobox – Archiviert – Gesperrt',
    ),
  ).toBeTruthy();
  let dialog = await openEdit('Synthetic retired');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(search.value).toBe('retired');
  expect(category.value).toBe('');
  expect(state.value).toBe('');
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.change(category, { target: { value: 'Fotobox' } });
  fireEvent.change(state, { target: { value: 'archived' } });
  expect(
    screen.getByText(
      'Synthetic retired – 3 Stück – Fotobox – Archiviert – Gesperrt',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Synthetic spare/)).toBeNull();
  dialog = await openEdit('Synthetic retired');
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic retired renamed' },
  });
  submitSave(dialog);
  await screen.findByText('Ressource gespeichert.');
  expect(search.value).toBe('');
  expect(category.value).toBe('Fotobox');
  expect(state.value).toBe('archived');
  expect(
    screen.getByText(
      'Synthetic retired renamed – 3 Stück – Fotobox – Archiviert – Gesperrt',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Synthetic box –/)).toBeNull();
});

test('separates an empty inventory from a filter without matches and offers a reset', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText(/Noch keine Ressourcen/);
  expect(screen.queryByText(/Keine Treffer/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Ressource anlegen' }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Filter zurücksetzen' }),
  ).toBeNull();
  cleanup();
  vi.stubGlobal('fetch', listFetcher([row, spare]));
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  fireEvent.change(screen.getByLabelText('Ressourcen suchen'), {
    target: { value: 'Synthetic missing' },
  });
  await screen.findByText(/Keine Treffer/);
  expect(screen.queryByText(/Noch keine Ressourcen/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(
    (screen.getByLabelText('Ressourcen suchen') as HTMLInputElement).value,
  ).toBe('');
  expect(
    screen.getByText('Synthetic box – 1 Stück – Fotobox – Aktiv'),
  ).toBeTruthy();
  expect(screen.queryByText(/Keine Treffer/)).toBeNull();
});

test('reports loading until the list is there and keeps a retry on load failures', async () => {
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  const resources = screen.getByRole('region', { name: 'Ressourcen' });
  expect(resources.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByText('Ressourcen werden geladen …')).toBeTruthy();
  await act(async () => finish(Response.json([row])));
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  expect(resources.getAttribute('aria-busy')).toBe('false');
  expect(screen.queryByText('Ressourcen werden geladen …')).toBeNull();
  cleanup();
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fail ? Promise.reject(Error('offline')) : Response.json([row]),
    ),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Ressourcen konnten nicht geladen werden.');
  expect(
    screen.getByRole('button', { name: 'Ressourcen aktualisieren' }),
  ).toBeTruthy();
  fail = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Ressourcen aktualisieren' }),
  );
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  expect(
    screen.queryByText('Ressourcen konnten nicht geladen werden.'),
  ).toBeNull();
});

test('resource create, edit, archive, cancel and loading failures', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) rows = [{ ...row, ...JSON.parse(String(options.body)) }];
    return Response.json(options ? rows[0] : rows);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  let dialog = await openEdit('Synthetic box');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Ressource abbrechen' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  dialog = await openCreate();
  fireEvent.change(within(dialog).getByLabelText('Bezeichnung'), {
    target: { value: 'New synthetic' },
  });
  fireEvent.change(within(dialog).getByLabelText('Interner Code'), {
    target: { value: 'NEW' },
  });
  fireEvent.change(within(dialog).getByLabelText('Kategorie'), {
    target: { value: 'Fotobox' },
  });
  submitSave(dialog);
  await screen.findByText('New synthetic – 1 Stück – Fotobox – Aktiv');
  dialog = await openEdit('New synthetic');
  fireEvent.click(within(dialog).getByLabelText('Gesperrt'));
  fireEvent.change(within(dialog).getByLabelText('Zustand'), {
    target: { value: 'archived' },
  });
  submitSave(dialog);
  await screen.findByText(
    'New synthetic – 1 Stück – Fotobox – Archiviert – Gesperrt',
  );
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
  await screen.findByText('Synthetic box – 1 Stück – Fotobox – Aktiv');
  const dialog = await openEdit('Synthetic box');
  for (const text of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /künftig reserviert/,
    /Verbindung fehlgeschlagen/,
  ]) {
    submitSave(dialog);
    await screen.findByText(text);
  }
  expect(screen.getByRole('dialog')).toBeTruthy();
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  render(<ResourcePanel csrfToken="csrf" />);
  await screen.findByText(/Ressourcen konnten nicht geladen/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Ressourcen aktualisieren' }),
  );
  await screen.findByText(/Ressourcen konnten nicht geladen/);
});
