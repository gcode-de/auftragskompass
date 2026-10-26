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
import { ProductPanel } from '../../apps/admin/src/ProductPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
const service = {
  ...row,
  id: 'synthetic-service',
  version: 2,
  name: 'Synthetic service',
  description: 'Stundenweise Betreuung',
  unit: 'Stunde',
  priceMinor: 0,
  priceBasis: 'net',
  taxBasisPoints: 0,
  state: 'inactive',
  position: 1,
};
const retired = {
  ...row,
  id: 'synthetic-retired',
  version: 4,
  name: 'Synthetic retired',
  description: 'Fictional archive',
  unit: 'Pauschale',
  priceMinor: 12345,
  priceBasis: 'gross',
  taxBasisPoints: 700,
  state: 'archived',
  position: 2,
};
const rowText = 'Synthetic product – 19,99 € Brutto – 19 % – Stück – Aktiv';
const serviceText = 'Synthetic service – 0,00 € Netto – 0 % – Stunde – Inaktiv';
const retiredText =
  'Synthetic retired – 123,45 € Brutto – 7 % – Pauschale – Archiviert';
const listFetcher = (rows: (typeof row)[] = [row]) =>
  vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(options ? rows[0] : rows),
  );
function crudFetcher(initial: (typeof row)[], log?: Record<string, unknown>[]) {
  let rows = [...initial];
  let created = 0;
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (!options) return Response.json(rows);
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    log?.push(body);
    if (options.method === 'PUT') {
      const id = String(url).split('/').pop();
      rows = rows.map((entry) =>
        entry.id === id
          ? ({ ...entry, ...body, id: entry.id } as typeof row)
          : entry,
      );
      return Response.json(rows.find((entry) => entry.id === id));
    }
    created += 1;
    const entry = {
      ...row,
      ...body,
      id: 'synthetic-created-' + String(created),
      version: 1,
    } as typeof row;
    rows = [...rows, entry];
    return Response.json(entry);
  });
}
function mutations(fetcher: { mock: { calls: unknown[][] } }) {
  return fetcher.mock.calls.filter((call) => Boolean(call[1]));
}
async function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Produkt anlegen' }));
  return screen.findByRole('dialog', { name: 'Produkt anlegen' });
}
async function openEdit(name: string) {
  const trigger = screen.getByRole('button', {
    name: 'Produkt bearbeiten: ' + name,
  });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole('dialog', { name: 'Produkt bearbeiten' });
}
function form(dialog: HTMLElement) {
  return within(dialog)
    .getByRole('button', { name: /Produkt speichern|Wird gespeichert/ })
    .closest('form')!;
}
function submitSave(dialog: HTMLElement) {
  fireEvent.submit(form(dialog));
}

test('the product page leads with its list, toolbar and no exposed editor', async () => {
  vi.stubGlobal('fetch', listFetcher([row, service, retired]));
  render(<ProductPanel csrfToken="csrf" />);
  const products = screen.getByRole('region', { name: 'Produkte' });
  expect(products.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByText('Produkte werden geladen …')).toBeTruthy();
  await within(products).findByText(rowText);
  expect(products.getAttribute('aria-busy')).toBe('false');
  expect(screen.queryByText('Produkte werden geladen …')).toBeNull();
  expect(within(products).getByRole('heading', { level: 2 })).toBeTruthy();
  // The editor exists only while the dialog is open: nothing of it is in the
  // tab path of the section itself.
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText('Produktname')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Produkt speichern' }),
  ).toBeNull();
  expect(screen.queryByLabelText('Produktbeschreibung')).toBeNull();
  const search = screen.getByLabelText('Produkte suchen');
  expect(search.closest('form')).toBeNull();
  expect(
    search.closest('.product-toolbar')!.nextElementSibling?.localName,
  ).not.toBe('form');
  expect(screen.getByLabelText('Zustand filtern')).toBeTruthy();
  const create = screen.getByRole('button', { name: 'Produkt anlegen' });
  expect(create.getAttribute('title')).toBe('Produkt anlegen');
  expect(create.textContent).toBe('');
  expect(create.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(
    screen.getByRole('button', { name: 'Produkte aktualisieren' }),
  ).toBeTruthy();
});

test('the plus action opens one accessible dialog with focus, trap, dirty guard and focus return', async () => {
  vi.stubGlobal('fetch', listFetcher());
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  const create = screen.getByRole('button', { name: 'Produkt anlegen' });
  create.focus();
  const dialog = await openCreate();
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  const labelledBy = dialog.getAttribute('aria-labelledby')!;
  expect(document.getElementById(labelledBy)?.textContent).toBe(
    'Produkt anlegen',
  );
  expect(screen.getByLabelText('Produktname')).toBe(document.activeElement);
  const close = within(dialog).getByRole('button', {
    name: 'Dialog schließen',
  });
  expect(close.getAttribute('title')).toBe('Dialog schließen');
  const save = within(dialog).getByRole('button', {
    name: 'Produkt speichern',
  });
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
  // An untouched dialog closes without asking and returns focus to its trigger.
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).toBe(document.activeElement);
  const second = await openCreate();
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).toBe(document.activeElement);
  // A changed draft needs the explicit discard confirmation.
  const third = await openCreate();
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.change(within(third).getByLabelText('Produktname'), {
    target: { value: 'Fictional unsaved product' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  const deny = vi.fn(() => false);
  vi.stubGlobal('confirm', deny);
  fireEvent.click(within(third).getByRole('button', { name: 'Abbrechen' }));
  expect(deny).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und den Produktdialog schließen?',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((screen.getByLabelText('Produktname') as HTMLInputElement).value).toBe(
    'Fictional unsaved product',
  );
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  fireEvent.keyDown(third, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
});

test('duplicate opens a new record and copies the state one to one', async () => {
  const fetcher = crudFetcher([row, retired]);
  vi.stubGlobal('fetch', fetcher);
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  let dialog = await openEdit('Synthetic product');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Produkt duplizieren: Synthetic product',
    }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Produkt anlegen' });
  expect(
    (within(dialog).getByLabelText('Produktname') as HTMLInputElement).value,
  ).toBe('Synthetic product (Kopie)');
  fireEvent.change(within(dialog).getByLabelText('Preis in Euro'), {
    target: { value: '0,01' },
  });
  fireEvent.change(within(dialog).getByLabelText('Preisbasis'), {
    target: { value: 'net' },
  });
  submitSave(dialog);
  await screen.findByText('Produkt gespeichert.');
  await screen.findByText(
    'Synthetic product (Kopie) – 0,01 € Netto – 19 % – Stück – Aktiv',
  );
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
  // The original row is untouched by its copy.
  expect(screen.getByText(rowText)).toBeTruthy();
  dialog = await openEdit('Synthetic product (Kopie)');
  fireEvent.change(within(dialog).getByLabelText('Produktzustand'), {
    target: { value: 'archived' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Synthetic product (Kopie) – 0,01 € Netto – 19 % – Stück – Archiviert',
  );
  // A copy of an archived product stays archived: no invented activation rule.
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Produkt duplizieren: Synthetic retired',
    }),
  );
  const archivedCopy = await screen.findByRole('dialog', {
    name: 'Produkt anlegen',
  });
  expect(
    (within(archivedCopy).getByLabelText('Produktzustand') as HTMLSelectElement)
      .value,
  ).toBe('archived');
  expect(
    (within(archivedCopy).getByLabelText('Produktname') as HTMLInputElement)
      .value,
  ).toBe('Synthetic retired (Kopie)');
});

test('keeps the field contract, its defaults and the 0 and maximum amounts', async () => {
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', crudFetcher([row, retired], posted));
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  let dialog = await openCreate();
  const fields: [string, string, string][] = [
    ['Produktname', '', '120'],
    ['Produktbeschreibung', '', '2000'],
    ['Einheit', 'Stück', '40'],
    ['Preis in Euro', '0.00', '17'],
    ['Steuersatz in Prozent', '19.00', '6'],
  ];
  for (const [label, value, maxLength] of fields) {
    const input = within(dialog).getByLabelText(label) as HTMLInputElement;
    expect(input.value).toBe(value);
    expect(input.maxLength).toBe(Number(maxLength));
    if (label !== 'Produktbeschreibung') expect(input.required).toBe(true);
  }
  expect(
    (within(dialog).getByLabelText('Preisbasis') as HTMLSelectElement).value,
  ).toBe('gross');
  const position = within(dialog).getByLabelText(
    'Produktsortierung',
  ) as HTMLInputElement;
  expect(position.value).toBe('0');
  expect(position.type).toBe('number');
  expect(position.min).toBe('0');
  expect(position.max).toBe('9999');
  expect(position.required).toBe(true);
  expect(
    (within(dialog).getByLabelText('Produktzustand') as HTMLSelectElement)
      .value,
  ).toBe('active');
  // Zero price and zero tax are valid and stay exact.
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic free' },
  });
  fireEvent.change(within(dialog).getByLabelText('Produktbeschreibung'), {
    target: { value: 'Fictional free note' },
  });
  fireEvent.change(within(dialog).getByLabelText('Einheit'), {
    target: { value: 'Pauschale' },
  });
  fireEvent.change(within(dialog).getByLabelText('Produktsortierung'), {
    target: { value: '7' },
  });
  fireEvent.change(within(dialog).getByLabelText('Preis in Euro'), {
    target: { value: '0,00' },
  });
  fireEvent.change(within(dialog).getByLabelText('Steuersatz in Prozent'), {
    target: { value: '0' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Synthetic free – 0,00 € Brutto – 0 % – Pauschale – Aktiv',
  );
  expect(posted[0]).toMatchObject({
    name: 'Synthetic free',
    description: 'Fictional free note',
    unit: 'Pauschale',
    priceMinor: 0,
    priceBasis: 'gross',
    taxBasisPoints: 0,
    position: 7,
    state: 'active',
  });
  // The largest exact amount and the 100 % ceiling survive unchanged.
  dialog = await openCreate();
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic maximum' },
  });
  fireEvent.change(within(dialog).getByLabelText('Preis in Euro'), {
    target: { value: '90071992547409.91' },
  });
  fireEvent.change(within(dialog).getByLabelText('Steuersatz in Prozent'), {
    target: { value: '100' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Synthetic maximum – 90071992547409,91 € Brutto – 100 % – Stück – Aktiv',
  );
  expect(posted[1]!.priceMinor).toBe(Number.MAX_SAFE_INTEGER);
  expect(posted[1]!.taxBasisPoints).toBe(10000);
  expect(posted[1]!.version).toBeUndefined();
  // Editing sends the read version and the chosen state.
  dialog = await openEdit('Synthetic product');
  fireEvent.change(within(dialog).getByLabelText('Produktzustand'), {
    target: { value: 'inactive' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Synthetic product – 19,99 € Brutto – 19 % – Stück – Inaktiv',
  );
  expect(posted[2]!.version).toBe(1);
  expect(posted[2]!.state).toBe('inactive');
});

test('reports invalid decimal values per field and never sends a request', async () => {
  const fetcher = crudFetcher([row]);
  vi.stubGlobal('fetch', fetcher);
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  const dialog = await openCreate();
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic decimal' },
  });
  const price = within(dialog).getByLabelText(
    'Preis in Euro',
  ) as HTMLInputElement;
  for (const [value, text] of [
    ['1.001', 'Preis in Euro: höchstens zwei Nachkommastellen erlaubt.'],
    [
      '12,3,4',
      'Preis in Euro: gültige Zahl mit höchstens zwei Nachkommastellen eingeben.',
    ],
    ['999999999999999', 'Preis in Euro: Wert zu groß.'],
    [
      '-1',
      'Preis in Euro: gültige Zahl mit höchstens zwei Nachkommastellen eingeben.',
    ],
  ] as const) {
    fireEvent.change(price, { target: { value } });
    submitSave(dialog);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(text);
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(price.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('dialog')).toBeTruthy();
  }
  expect(mutations(fetcher)).toHaveLength(0);
  fireEvent.change(price, { target: { value: '19,99' } });
  expect(price.hasAttribute('aria-invalid')).toBe(false);
  const tax = within(dialog).getByLabelText(
    'Steuersatz in Prozent',
  ) as HTMLInputElement;
  fireEvent.change(tax, { target: { value: '1.001' } });
  submitSave(dialog);
  const taxAlert = await screen.findByRole('alert');
  expect(taxAlert.textContent).toBe(
    'Steuersatz in Prozent: höchstens zwei Nachkommastellen erlaubt.',
  );
  expect(tax.getAttribute('aria-invalid')).toBe('true');
  expect(price.hasAttribute('aria-invalid')).toBe(false);
  expect(mutations(fetcher)).toHaveLength(0);
  fireEvent.change(tax, { target: { value: '19' } });
  submitSave(dialog);
  await screen.findByText('Produkt gespeichert.');
  expect(mutations(fetcher)).toHaveLength(1);
});

test('filters by name, description, unit and state and keeps the filter across editing', async () => {
  vi.stubGlobal('fetch', crudFetcher([row, service, retired]));
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  const search = screen.getByLabelText('Produkte suchen') as HTMLInputElement;
  const state = screen.getByLabelText('Zustand filtern') as HTMLSelectElement;
  expect(search.value).toBe('');
  expect(state.value).toBe('');
  expect(Array.from(state.options).map((option) => option.textContent)).toEqual(
    ['Alle Zustände', 'Aktiv', 'Inaktiv', 'Archiviert'],
  );
  fireEvent.change(search, { target: { value: 'BETREUUNG' } });
  expect(screen.getByText(serviceText)).toBeTruthy();
  expect(screen.queryByText(rowText)).toBeNull();
  fireEvent.change(search, { target: { value: 'stunde' } });
  expect(screen.getByText(serviceText)).toBeTruthy();
  expect(screen.queryByText(rowText)).toBeNull();
  fireEvent.change(search, { target: { value: 'retired' } });
  expect(screen.getByText(retiredText)).toBeTruthy();
  expect(screen.queryByText(serviceText)).toBeNull();
  fireEvent.change(search, { target: { value: 'No such product' } });
  expect(
    screen.getByText('Keine Treffer für die aktuellen Filter.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(search.value).toBe('');
  expect(screen.getByText(rowText)).toBeTruthy();
  fireEvent.change(state, { target: { value: 'archived' } });
  expect(screen.getByText(retiredText)).toBeTruthy();
  expect(screen.queryByText(rowText)).toBeNull();
  fireEvent.change(state, { target: { value: 'inactive' } });
  expect(screen.getByText(serviceText)).toBeTruthy();
  expect(screen.queryByText(retiredText)).toBeNull();
  fireEvent.change(state, { target: { value: 'archived' } });
  let dialog = await openEdit('Synthetic retired');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(search.value).toBe('');
  expect(state.value).toBe('archived');
  dialog = await openEdit('Synthetic retired');
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic retired renamed' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Synthetic retired renamed – 123,45 € Brutto – 7 % – Pauschale – Archiviert',
  );
  expect(search.value).toBe('');
  expect(state.value).toBe('archived');
  expect(screen.queryByText(rowText)).toBeNull();
});

test('separates an empty catalogue from a filter without matches', async () => {
  vi.stubGlobal('fetch', listFetcher([]));
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(/Noch keine Produkte/);
  expect(screen.queryByText(/Keine Treffer/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Produkt anlegen' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Filter zurücksetzen' }),
  ).toBeNull();
  cleanup();
  vi.stubGlobal('fetch', listFetcher([row, service]));
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  fireEvent.change(screen.getByLabelText('Produkte suchen'), {
    target: { value: 'No such product' },
  });
  await screen.findByText(/Keine Treffer/);
  expect(screen.queryByText(/Noch keine Produkte/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(screen.getByText(rowText)).toBeTruthy();
  expect(screen.queryByText(/Keine Treffer/)).toBeNull();
});

test('names price basis, tax, unit and state in every row', async () => {
  vi.stubGlobal('fetch', listFetcher([row, service, retired]));
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  expect(screen.getByText(serviceText)).toBeTruthy();
  expect(screen.getByText(retiredText)).toBeTruthy();
  for (const item of screen.getAllByRole('listitem'))
    expect(item.textContent).toMatch(/Brutto|Netto/);
});

test('keeps the dialog and its values after a conflict and a rejected save', async () => {
  const errors = ['conflict', 'invalid'];
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options) return Response.json([row]);
    return Response.json({ error: errors.shift() }, { status: 409 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  const dialog = await openEdit('Synthetic product');
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic draft product' },
  });
  for (const text of [/Inzwischen geändert/, /Speichern fehlgeschlagen/]) {
    submitSave(dialog);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(text);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  }
  expect((screen.getByLabelText('Produktname') as HTMLInputElement).value).toBe(
    'Synthetic draft product',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mutations(fetcher)).toHaveLength(2);
  const sent = (mutations(fetcher)[0] as unknown[])[1] as RequestInit;
  expect((JSON.parse(String(sent.body)) as { version: number }).version).toBe(
    1,
  );
});

test('reports a saved product honestly when the list load fails and retries with GET only', async () => {
  let listCalls = 0;
  let failList = false;
  let saved = false;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      saved = true;
      return Response.json({
        ...row,
        name: 'Synthetic saved product',
        version: 2,
      });
    }
    listCalls += 1;
    if (failList && listCalls > 1) throw Error('offline');
    return Response.json([
      saved ? { ...row, name: 'Synthetic saved product', version: 2 } : row,
    ]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  failList = true;
  const dialog = await openEdit('Synthetic product');
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic saved product' },
  });
  submitSave(dialog);
  await screen.findByText('Produkt gespeichert.');
  expect(screen.queryByRole('dialog')).toBeNull();
  // The confirmed row from the response is visible even without the reload.
  expect(
    screen.getByText(
      'Synthetic saved product – 19,99 € Brutto – 19 % – Stück – Aktiv',
    ),
  ).toBeTruthy();
  await screen.findByText(
    'Produkt gespeichert, die Liste konnte nicht aktualisiert werden.',
  );
  expect(mutations(fetcher)).toHaveLength(1);
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Produkt bearbeiten: Synthetic saved product',
      }),
    ).toBe(document.activeElement),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Produkte erneut laden' }),
    );
  });
  expect(
    screen.getByText(
      'Produkt gespeichert, die Liste konnte nicht aktualisiert werden.',
    ),
  ).toBeTruthy();
  expect(mutations(fetcher)).toHaveLength(1);
  failList = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Produkte erneut laden' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Produkte erneut laden' }),
    ).toBeNull(),
  );
  expect(
    screen.getByText(
      'Synthetic saved product – 19,99 € Brutto – 19 % – Stück – Aktiv',
    ),
  ).toBeTruthy();
  expect(mutations(fetcher)).toHaveLength(1);
});

test('returns focus to the create action when the filtered row disappears after saving', async () => {
  vi.stubGlobal('fetch', crudFetcher([row, service]));
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'active' },
  });
  expect(screen.queryByText(serviceText)).toBeNull();
  const dialog = await openEdit('Synthetic product');
  fireEvent.change(within(dialog).getByLabelText('Produktzustand'), {
    target: { value: 'archived' },
  });
  submitSave(dialog);
  await screen.findByText('Produkt gespeichert.');
  // The row no longer matches the filter, so focus falls back to the create
  // action instead of being lost with the removed row.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Produkt anlegen' })).toBe(
      document.activeElement,
    ),
  );
  expect(screen.queryByText(/Synthetic product/)).toBeNull();
  expect(
    (screen.getByLabelText('Zustand filtern') as HTMLSelectElement).value,
  ).toBe('active');
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
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  const dialog = await openEdit('Synthetic product');
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic pending product' },
  });
  const edit = screen.getByRole('button', {
    name: 'Produkt bearbeiten: Synthetic product',
  });
  const creation = screen.getByRole('button', { name: 'Produkt anlegen' });
  fireEvent.submit(form(dialog));
  fireEvent.submit(form(dialog));
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(dialog);
  expect((edit as HTMLButtonElement).disabled).toBe(true);
  expect((creation as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(dialog);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Dialog schließen' }),
  );
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mutations(fetcher)).toHaveLength(1);
  await act(async () =>
    finish(
      Response.json({
        ...row,
        name: 'Synthetic pending product',
        version: 2,
      }),
    ),
  );
  await screen.findByText('Produkt gespeichert.');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mutations(fetcher)).toHaveLength(1);
});

test('locks saving after an unknown outcome and never repeats the mutation', async () => {
  let posted = 0;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options) return Response.json([row]);
    posted += 1;
    throw Error('offline');
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText(rowText);
  const dialog = await openCreate();
  fireEvent.change(within(dialog).getByLabelText('Produktname'), {
    target: { value: 'Synthetic unclear product' },
  });
  fireEvent.submit(form(dialog));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(
    'Ausgang unklar. Vor erneutem Speichern die Liste neu laden.',
  );
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(posted).toBe(1);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((screen.getByLabelText('Produktname') as HTMLInputElement).value).toBe(
    'Synthetic unclear product',
  );
  const save = within(dialog).getByRole('button', {
    name: 'Produkt speichern',
  });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(form(dialog));
  fireEvent.click(save);
  expect(posted).toBe(1);
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Liste neu laden' }),
    );
  });
  expect(posted).toBe(1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    (
      within(dialog).getByRole('button', {
        name: 'Produkt speichern',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    screen.getByText(
      'Liste neu geladen. Prüfe, ob das Produkt gespeichert wurde.',
    ),
  ).toBeTruthy();
});

test('reports loading, list failures and a retry without inventing rows', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fail ? Promise.reject(Error('offline')) : Response.json([row]),
    ),
  );
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText('Produkte konnten nicht geladen werden.');
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.queryByText(/Noch keine Produkte/)).toBeNull();
  fail = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Produkte aktualisieren' }),
  );
  await screen.findByText(rowText);
  expect(
    screen.queryByText('Produkte konnten nicht geladen werden.'),
  ).toBeNull();
  // A failing manual refresh reports the failure and keeps the last known
  // rows instead of pretending the list is empty.
  fail = true;
  fireEvent.click(
    screen.getByRole('button', { name: 'Produkte aktualisieren' }),
  );
  await screen.findByText('Produkte konnten nicht geladen werden.');
  expect(screen.getByText(rowText)).toBeTruthy();
  cleanup();
  // A 403 is reported as a load failure, not as an empty catalogue.
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'forbidden' }, { status: 403 }),
      ),
  );
  render(<ProductPanel csrfToken="csrf" />);
  await screen.findByText('Produkte konnten nicht geladen werden.');
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.queryByText(/Noch keine Produkte/)).toBeNull();
});
