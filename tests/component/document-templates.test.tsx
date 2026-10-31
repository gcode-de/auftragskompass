import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  DocumentTemplatesPanel,
  templatePlaceholderOffers,
} from '../../apps/admin/src/DocumentTemplatesPanel.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
import { templatePlaceholders } from '../../packages/core/src/document-templates.js';

afterEach(() => {
  cleanup();
  document.querySelector('[data-archive-focus-sentinel]')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const position = {
  id: 'fictional-position',
  productId: null,
  description: 'Fictional box',
  quantity: 1,
  unit: 'Stück',
  unitPriceMinor: 19900,
  taxBasisPoints: 1900,
  discountBasisPoints: 0,
};
const template = {
  id: 'fictional-template',
  version: 1,
  kind: 'offer',
  name: 'Fictional offer',
  subject: 'Angebot für {{contact}}',
  introText: 'Hallo {{contact}}',
  outroText: 'Termin am {{date}}',
  validityDays: 14,
  state: 'active',
  positions: [position],
};
const product = {
  id: 'fictional-product',
  name: 'Fictional product',
  unit: 'Stück',
  priceMinor: 10000,
  priceBasis: 'net',
  taxBasisPoints: 1900,
  state: 'active',
};
const grossProduct = {
    ...product,
    id: 'fictional-gross-product',
    name: 'Fictional gross product',
    priceMinor: 12345,
    priceBasis: 'gross',
  },
  archivedProduct = {
    ...product,
    id: 'fictional-archived-product',
    name: 'Fictional archived product',
    state: 'archived',
  },
  overflowProduct = {
    ...product,
    id: 'fictional-overflow-product',
    name: 'Fictional oversized net product',
    priceMinor: Number.MAX_SAFE_INTEGER,
    taxBasisPoints: 1,
  };
const products = [product, grossProduct, archivedProduct, overflowProduct];
function setup(
  reply: (body: Record<string, unknown>) => Response | Promise<Response> = (
    body,
  ) => Response.json(savedBody(body)),
  readList?: () => Response | Promise<Response>,
) {
  let currentRows: unknown[] = [template];
  const writes: {
    url: string;
    method: string;
    body: Record<string, unknown>;
    headers: HeadersInit | undefined;
  }[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/products') return Response.json(products);
    if (!options) return readList ? readList() : Response.json(currentRows);
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    writes.push({
      url,
      method: String(options.method),
      body,
      headers: options.headers,
    });
    const response = await reply(body);
    if (response.ok && !readList) {
      try {
        const saved = (await response.clone().json()) as Record<
          string,
          unknown
        >;
        currentRows = [
          ...currentRows.filter(
            (row) =>
              !row ||
              typeof row !== 'object' ||
              (row as Record<string, unknown>).id !== saved.id,
          ),
          saved,
        ];
      } catch {
        // Malformed success responses remain available to the component tests.
      }
    }
    return response;
  });
  vi.stubGlobal('fetch', fetcher);
  return writes;
}
function setupPreview(
  preview: (body: Record<string, unknown>) => Response | Promise<Response>,
) {
  const requests: {
    url: string;
    options?: RequestInit;
    body?: unknown;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/products') return Response.json(products);
      if (url === '/api/v1/document-templates')
        return Response.json([template]);
      if (url === '/api/v1/document-templates/preview') {
        const body = JSON.parse(String(options?.body)) as Record<
          string,
          unknown
        >;
        requests.push({ url, options: options!, body });
        return preview(body);
      }
      requests.push(options ? { url, options } : { url });
      throw new Error(`Unexpected template write: ${String(options?.method)}`);
    }),
  );
  return requests;
}
function pdfResponse() {
  return new Response('%PDF-1.4 fictional preview', {
    headers: { 'content-type': 'application/pdf' },
  });
}
function archivedResponse(body: Record<string, unknown>) {
  const sentPositions = body.positions as Array<Record<string, unknown>>;
  return Response.json({
    ...template,
    ...body,
    id: template.id,
    version: Number(body.version) + 1,
    state: 'archived',
    positions: sentPositions.map((position, index) => ({
      ...position,
      id: `fictional-archived-position-${index}`,
    })),
  });
}
function savedBody(
  body: Record<string, unknown>,
  id = typeof body.version === 'number'
    ? 'fictional-template'
    : 'fictional-created-template',
): Record<string, unknown> {
  const sentPositions = body.positions as Array<Record<string, unknown>>;
  const payload = { ...body };
  delete payload.requestId;
  const version = payload.version;
  delete payload.version;
  return {
    ...payload,
    id,
    version: Number(version ?? 0) + 1,
    positions: sentPositions.map((position, index) => ({
      ...position,
      id: `fictional-created-position-${index}`,
    })),
  };
}
function createdBody(body: Record<string, unknown>) {
  return savedBody(body, 'fictional-created-template');
}
function createdResponse(body: Record<string, unknown>) {
  return Response.json(createdBody(body));
}
function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage anlegen' }));
}
test('template closing text follows the positions', async () => {
  setup(() => Response.json(template));
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findByRole('button', { name: 'Vorlage anlegen' });
  openCreate();
  const position = screen.getByRole('heading', { name: 'Positionen' });
  expect(
    position.compareDocumentPosition(screen.getByLabelText('Schlusstext')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
function openRowActions(name: string) {
  const toggle = screen.getByRole('button', {
    name: `Weitere Aktionen für ${name}`,
  });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return toggle;
}
function getArchiveButton(name: string) {
  openRowActions(name);
  return screen.getByRole('button', {
    name: `Vorlage archivieren: ${name}`,
  });
}
function getDuplicateButton(name: string) {
  openRowActions(name);
  return screen.getByRole('button', {
    name: `Vorlage duplizieren: ${name}`,
  });
}
test('document templates are grouped by supported kind and retain unknown kinds', async () => {
  const invoice = {
    ...template,
    id: 'fictional-invoice-template',
    kind: 'invoice',
    name: 'Fictional invoice template',
    state: 'archived',
  };
  const unknown = {
    ...template,
    id: 'fictional-unknown-template',
    kind: 'custom_confirmation',
    name: 'Fictional custom template',
  };
  setup(
    () => Response.json(template),
    () => Response.json([template, invoice, unknown]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);

  const offers = screen.getByRole('region', { name: 'Angebote' });
  const invoices = screen.getByRole('region', { name: 'Rechnungen' });
  const otherKinds = screen.getByRole('region', {
    name: 'Weitere Dokumentarten',
  });
  expect(within(offers).getByText(/Angebot: Fictional offer/)).toBeTruthy();
  expect(
    within(invoices).getByText(
      /Rechnung: Fictional invoice template.*Archiviert/,
    ),
  ).toBeTruthy();
  expect(
    within(otherKinds).getByText(
      /custom_confirmation: Fictional custom template/,
    ),
  ).toBeTruthy();
  expect(
    within(invoices).getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional invoice template',
    }),
  ).toBeTruthy();
});
test('an empty document-template list explains how to begin', async () => {
  setup(
    () => Response.json(template),
    () => Response.json([]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);

  expect(
    await screen.findByText('Noch keine Dokumentvorlagen vorhanden.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Vorlage anlegen' })).toBeTruthy();
});
// The toolbar in the template list is an explicit user requirement, not an
// observed Bookitup function (B35 showed no search or archive filters). It
// narrows the loaded list client-side, so the list endpoint stays queryless.
function filterRows() {
  return [
    template,
    {
      ...template,
      id: 'fictional-inactive-invoice',
      kind: 'invoice',
      name: 'Fictional invoice template',
      state: 'inactive',
    },
    {
      ...template,
      id: 'fictional-archived-correction',
      kind: 'correction',
      name: 'Fictional correction template',
      state: 'archived',
    },
    {
      ...template,
      id: 'fictional-unknown-template',
      kind: 'custom_confirmation',
      name: 'Fictional custom template',
      state: 'active',
    },
  ];
}
function filterSetup(
  reply: (body: Record<string, unknown>) => Response | Promise<Response> = (
    body,
  ) => Response.json(savedBody(body)),
) {
  let rows: Array<Record<string, unknown>> = filterRows();
  const writes = setup(reply, () => Response.json(rows));
  return {
    writes,
    setRows: (next: Array<Record<string, unknown>>) => (rows = next),
  };
}
async function renderFilteredTemplates() {
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
}
test('the template toolbar starts unfiltered and keeps every populated group', async () => {
  filterSetup();
  await renderFilteredTemplates();

  const search = screen.getByLabelText('Vorlagen suchen') as HTMLInputElement;
  const kindFilter = screen.getByLabelText('Art filtern') as HTMLSelectElement;
  const stateFilter = screen.getByLabelText(
    'Zustand filtern',
  ) as HTMLSelectElement;
  expect(search.value).toBe('');
  expect(kindFilter.value).toBe('');
  expect(stateFilter.value).toBe('');
  expect(search.closest('.resource-toolbar')).not.toBeNull();
  expect(
    Array.from(kindFilter.options).map((option) => option.textContent),
  ).toEqual([
    'Alle Dokumentarten',
    'Angebote',
    'Auftragsbestätigungen',
    'Anzahlungsrechnungen',
    'Rechnungen',
    'Rechnungskorrekturen',
    'Weitere Dokumentarten',
  ]);
  expect(
    Array.from(stateFilter.options).map((option) => option.textContent),
  ).toEqual(['Alle Zustände', 'Aktiv', 'Inaktiv', 'Archiviert']);
  for (const name of [
    'Angebote',
    'Rechnungen',
    'Rechnungskorrekturen',
    'Weitere Dokumentarten',
  ])
    expect(screen.getByRole('region', { name })).toBeTruthy();
  expect(
    screen.getAllByRole('button', { name: /Vorlage bearbeiten:/ }),
  ).toHaveLength(4);
});
test('template search narrows the list by name and hides empty groups', async () => {
  filterSetup();
  await renderFilteredTemplates();

  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'fictional INVOICE' },
  });
  expect(screen.getByRole('region', { name: 'Rechnungen' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Angebote' })).toBeNull();
  expect(
    screen.getAllByRole('button', { name: /Vorlage bearbeiten:/ }),
  ).toHaveLength(1);

  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'custom' },
  });
  expect(
    within(
      screen.getByRole('region', { name: 'Weitere Dokumentarten' }),
    ).getByText(/custom_confirmation: Fictional custom template/),
  ).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Rechnungen' })).toBeNull();
});
test('the kind filter narrows groups and keeps unknown kinds reachable', async () => {
  filterSetup();
  await renderFilteredTemplates();

  fireEvent.change(screen.getByLabelText('Art filtern'), {
    target: { value: 'invoice' },
  });
  expect(screen.getByRole('region', { name: 'Rechnungen' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Angebote' })).toBeNull();
  expect(
    screen.queryByRole('region', { name: 'Weitere Dokumentarten' }),
  ).toBeNull();

  fireEvent.change(screen.getByLabelText('Art filtern'), {
    target: { value: 'other' },
  });
  expect(
    within(
      screen.getByRole('region', { name: 'Weitere Dokumentarten' }),
    ).getByText(/Fictional custom template/),
  ).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Rechnungen' })).toBeNull();

  fireEvent.change(screen.getByLabelText('Art filtern'), {
    target: { value: '' },
  });
  expect(screen.getByRole('region', { name: 'Rechnungen' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Angebote' })).toBeTruthy();
});
test('the state filter names inactive rows without changing active ones', async () => {
  filterSetup();
  await renderFilteredTemplates();

  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'inactive' },
  });
  expect(
    screen.getByText(/Fictional invoice template – 1 Position\(en\) – Inaktiv/),
  ).toBeTruthy();
  expect(screen.queryByText(/Fictional offer/)).toBeNull();

  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'archived' },
  });
  expect(
    screen.getByText(
      /Fictional correction template – 1 Position\(en\) – Archiviert/,
    ),
  ).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'active' },
  });
  expect(screen.getByText(/Angebot: Fictional offer/)).toBeTruthy();
  expect(screen.queryByText(/– Inaktiv|– Archiviert/)).toBeNull();
});
test('empty inventory and a filtered-out list read differently and can reset', async () => {
  setup(
    () => Response.json(template),
    () => Response.json([]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  expect(
    await screen.findByText('Noch keine Dokumentvorlagen vorhanden.'),
  ).toBeTruthy();
  expect(
    screen.queryByText('Keine Treffer für die aktuellen Filter.'),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Filter zurücksetzen' }),
  ).toBeNull();
  cleanup();

  filterSetup();
  await renderFilteredTemplates();
  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'no such synthetic template' },
  });
  fireEvent.change(screen.getByLabelText('Art filtern'), {
    target: { value: 'invoice' },
  });
  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'archived' },
  });
  expect(
    screen.getByText('Keine Treffer für die aktuellen Filter.'),
  ).toBeTruthy();
  expect(
    screen.queryByText('Noch keine Dokumentvorlagen vorhanden.'),
  ).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(
    (screen.getByLabelText('Vorlagen suchen') as HTMLInputElement).value,
  ).toBe('');
  expect(
    (screen.getByLabelText('Art filtern') as HTMLSelectElement).value,
  ).toBe('');
  expect(
    (screen.getByLabelText('Zustand filtern') as HTMLSelectElement).value,
  ).toBe('');
  expect(
    screen.queryByText('Keine Treffer für die aktuellen Filter.'),
  ).toBeNull();
  expect(screen.getByRole('region', { name: 'Angebote' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Rechnungen' })).toBeTruthy();
});
test('a filter survives opening and closing the template editor', async () => {
  filterSetup();
  await renderFilteredTemplates();

  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'Fictional invoice' },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional invoice template',
    }),
  );
  expect(
    (screen.getByLabelText('Vorlagen suchen') as HTMLInputElement).value,
  ).toBe('Fictional invoice');
  expect(screen.getByRole('region', { name: 'Rechnungen' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(
    (screen.getByLabelText('Vorlagen suchen') as HTMLInputElement).value,
  ).toBe('Fictional invoice');
  expect(screen.getByRole('region', { name: 'Rechnungen' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Angebote' })).toBeNull();
});
test('a filter survives creating a template preview', async () => {
  setupPreview(() => pdfResponse());
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:fictional-preview',
    revokeObjectURL: () => {},
  });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);

  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'Fictional offer' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  expect(await screen.findByText('PDF-Vorschau erstellt.')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText('Vorlagen suchen') as HTMLInputElement).value,
  ).toBe('Fictional offer');
  expect(screen.getByRole('region', { name: 'Angebote' })).toBeTruthy();
});
test('archiving under the active filter hides the row and keeps the filter', async () => {
  const other = {
    ...template,
    id: 'fictional-other-template',
    name: 'Fictional other offer',
  };
  let rows: Array<Record<string, unknown>> = [template, other];
  setup(
    (body) => {
      rows = rows.map((row) =>
        row.id === template.id
          ? { ...row, ...body, version: 2, state: 'archived' }
          : row,
      );
      return archivedResponse(body);
    },
    () => Response.json(rows),
  );
  await renderFilteredTemplates();
  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'active' },
  });
  expect(screen.getByText(/Fictional offer/)).toBeTruthy();

  fireEvent.click(getArchiveButton('Fictional offer'));
  await screen.findByText('Vorlage archiviert.');
  expect(screen.queryByText(/Angebot: Fictional offer/)).toBeNull();
  expect(screen.getByText(/Fictional other offer/)).toBeTruthy();
  expect(
    (screen.getByLabelText('Zustand filtern') as HTMLSelectElement).value,
  ).toBe('active');
  expect(document.activeElement).toBe(
    screen.getByRole('heading', { level: 2 }),
  );

  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: '' },
  });
  expect(
    screen.getByText(/Fictional offer – 1 Position\(en\) – Archiviert/),
  ).toBeTruthy();
});
test('focus falls back to create when a saved edit leaves the kind filter', async () => {
  const writes = setup();
  await renderFilteredTemplates();
  fireEvent.change(screen.getByLabelText('Art filtern'), {
    target: { value: 'offer' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Dokumentart'), {
    target: { value: 'invoice' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes[0]!.body.kind).toBe('invoice');
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Vorlage anlegen' }),
  );
  expect(
    (screen.getByLabelText('Art filtern') as HTMLSelectElement).value,
  ).toBe('offer');
  expect(
    screen.getByText('Keine Treffer für die aktuellen Filter.'),
  ).toBeTruthy();
});
test('a disclosure cannot stay expanded on a filtered-out template row', async () => {
  const other = {
    ...template,
    id: 'fictional-other-template',
    name: 'Fictional other offer',
  };
  setup(
    () => Response.json(template),
    () => Response.json([template, other]),
  );
  await renderFilteredTemplates();
  openRowActions('Fictional offer');
  expect(
    screen
      .getByRole('button', { name: 'Weitere Aktionen für Fictional offer' })
      .getAttribute('aria-expanded'),
  ).toBe('true');

  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'Fictional other' },
  });
  expect(
    screen.queryByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Weitere Aktionen für Fictional offer',
    }),
  ).toBeNull();

  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: '' },
  });
  expect(
    screen
      .getByRole('button', { name: 'Weitere Aktionen für Fictional offer' })
      .getAttribute('aria-expanded'),
  ).toBe('false');
  expect(
    screen.queryByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  ).toBeNull();
});
test('template filters stay client-side and never query the list endpoint', async () => {
  filterSetup();
  await renderFilteredTemplates();
  const fetcher = vi.mocked(fetch);
  const reads = () =>
    fetcher.mock.calls
      .filter(
        ([url, options]) =>
          !options && String(url).includes('document-templates'),
      )
      .map(([url]) => String(url));

  expect(reads()).toEqual(['/api/v1/document-templates']);
  fireEvent.change(screen.getByLabelText('Vorlagen suchen'), {
    target: { value: 'Fictional' },
  });
  fireEvent.change(screen.getByLabelText('Art filtern'), {
    target: { value: 'offer' },
  });
  fireEvent.change(screen.getByLabelText('Zustand filtern'), {
    target: { value: 'active' },
  });
  expect(reads()).toEqual(['/api/v1/document-templates']);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes('?')),
  ).toEqual([]);
});
test('secondary template actions open one row at a time and dismiss accessibly', async () => {
  const other = {
    ...template,
    id: 'fictional-other-template',
    name: 'Fictional other offer',
  };
  setup(
    () => Response.json(template),
    () => Response.json([template, other]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);

  const firstToggle = screen.getByRole('button', {
    name: 'Weitere Aktionen für Fictional offer',
  });
  const secondToggle = screen.getByRole('button', {
    name: 'Weitere Aktionen für Fictional other offer',
  });
  expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
  expect(
    screen.queryByRole('button', {
      name: 'Vorlage duplizieren: Fictional offer',
    }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  ).toBeNull();
  expect(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  ).toBeTruthy();

  fireEvent.click(firstToggle);
  expect(firstToggle.getAttribute('aria-expanded')).toBe('true');
  expect(
    screen.getByRole('button', {
      name: 'Vorlage duplizieren: Fictional offer',
    }),
  ).toBeTruthy();
  fireEvent.click(secondToggle);
  expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
  expect(secondToggle.getAttribute('aria-expanded')).toBe('true');

  const secondDuplicate = screen.getByRole('button', {
    name: 'Vorlage duplizieren: Fictional other offer',
  });
  secondDuplicate.focus();
  fireEvent.keyDown(secondDuplicate, { key: 'Escape' });
  expect(secondToggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(secondToggle);

  fireEvent.click(firstToggle);
  const outside = document.createElement('button');
  outside.textContent = 'Fictional outside action';
  document.body.append(outside);
  fireEvent.pointerDown(outside);
  expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).not.toBe(firstToggle);

  fireEvent.click(firstToggle);
  firstToggle.focus();
  expect(firstToggle.getAttribute('aria-expanded')).toBe('true');
  outside.focus();
  fireEvent.focusIn(outside);
  expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(outside);
  outside.remove();
});
test('a confirmed create remains saved when the following list GET fails', async () => {
  let listReads = 0;
  const writes = setup(createdResponse, () =>
    listReads++ === 0
      ? Response.json([template])
      : Response.json({ error: 'unavailable' }, { status: 503 }),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional persisted template' },
  });
  const form = screen
    .getByRole('button', { name: 'Vorlage speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(writes).toHaveLength(1);

  expect(
    await screen.findByText(
      'Vorlage gespeichert. Die Liste konnte nicht aktualisiert werden.',
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  expect(
    screen.getByText('Angebot: Fictional persisted template – 0 Position(en)'),
  ).toBeTruthy();
  const reload = screen.getByRole('button', { name: 'Vorlagen neu laden' });
  expect(reload).toBeTruthy();
  expect(document.activeElement).toBe(reload);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.method).toBe('POST');
});
test('an unknown create can only retry the same request id and frozen body', async () => {
  let postCount = 0;
  let created: Record<string, unknown> | null = null;
  const writes = setup(
    async (body) => {
      postCount++;
      if (postCount === 1) throw new Error('response lost');
      created = createdBody(body);
      return Response.json(created);
    },
    () => Response.json(created ? [template, created] : [template]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional persisted template' },
  });
  const form = screen
    .getByRole('button', { name: 'Vorlage speichern' })
    .closest('form')!;
  fireEvent.submit(form);

  expect(
    await screen.findByText(
      'Der Speicherauftrag ist unklar. Bitte denselben Auftrag sicher wiederholen.',
    ),
  ).toBeTruthy();
  const retry = screen.getByRole('button', {
    name: 'Speicherauftrag wiederholen',
  });
  expect(document.activeElement).toBe(retry);
  expect(screen.getByLabelText('Bezeichnung').matches(':disabled')).toBe(true);
  fireEvent.click(retry);

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes).toHaveLength(2);
  expect(writes[0]!.body).toEqual(writes[1]!.body);
  expect(writes[0]!.body.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});
test('a late initial list response cannot erase a confirmed create', async () => {
  let releaseInitial!: (response: Response) => void;
  const initialList = new Promise<Response>((resolve) => {
    releaseInitial = resolve;
  });
  let listReads = 0;
  let created: Record<string, unknown> | null = null;
  const writes = setup(
    (body) => {
      created = createdBody(body);
      return Response.json(created);
    },
    () => {
      listReads++;
      return listReads === 1
        ? initialList
        : Response.json(created ? [created] : []);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional persisted template' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  await act(async () => {
    releaseInitial(Response.json([template]));
  });

  expect(
    await screen.findByText(
      'Angebot: Fictional persisted template – 0 Position(en)',
    ),
  ).toBeTruthy();
  expect(writes).toHaveLength(1);
  expect(listReads).toBe(2);
});
test('a late initial list failure cannot replace the confirmed save message', async () => {
  let rejectInitial!: (response: Response) => void;
  const initialList = new Promise<Response>((resolve) => {
    rejectInitial = resolve;
  });
  let listReads = 0;
  let created: Record<string, unknown> | null = null;
  setup(
    (body) => {
      created = createdBody(body);
      return Response.json(created);
    },
    () => {
      listReads++;
      return listReads === 1
        ? initialList
        : Response.json(created ? [created] : []);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional confirmed template' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  await act(async () => {
    rejectInitial(Response.json({ error: 'unavailable' }, { status: 503 }));
  });
  await vi.waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe('Gespeichert.'),
  );
  expect(
    screen.getByText('Angebot: Fictional confirmed template – 0 Position(en)'),
  ).toBeTruthy();
});
test.each([400, 401, 403])(
  'a known POST rejection (%i) keeps the draft editable',
  async (status) => {
    const writes = setup(() =>
      Response.json({ error: 'rejected' }, { status }),
    );
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    openCreate();
    fireEvent.change(screen.getByLabelText('Bezeichnung'), {
      target: { value: 'Fictional unsaved template' },
    });
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Vorlage speichern' })
        .closest('form')!,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (screen.getByLabelText('Bezeichnung') as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Speicherauftrag wiederholen' }),
    ).toBeNull();
    expect(writes).toHaveLength(1);
  },
);
test.each([
  'id',
  'version',
  'state',
  'content',
  'position id',
  'malformed JSON',
])(
  'an implausible create response (%s) stays in safe retry state',
  async (mutation) => {
    const writes = setup((body) => {
      if (mutation === 'malformed JSON')
        return new Response('{', { status: 201 });
      const saved = createdBody(body);
      if (mutation === 'id') saved.id = template.id;
      if (mutation === 'version') saved.version = 2;
      if (mutation === 'state') saved.state = 'inactive';
      if (mutation === 'content') saved.subject = 'Unexpected subject';
      if (mutation === 'position id')
        (saved.positions as Array<Record<string, unknown>>)[0]!.id = '';
      return Response.json(saved);
    });
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    openCreate();
    fireEvent.change(screen.getByLabelText('Bezeichnung'), {
      target: { value: 'Fictional pending template' },
    });
    fireEvent.change(screen.getByLabelText('Beschreibung'), {
      target: { value: 'Fictional position' },
    });
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Vorlage speichern' })
        .closest('form')!,
    );

    expect(
      await screen.findByText(
        mutation === 'malformed JSON'
          ? 'Der Speicherauftrag ist unklar. Bitte denselben Auftrag sicher wiederholen.'
          : 'Die Speicherantwort war unplausibel. Bitte denselben Auftrag sicher wiederholen.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Speicherauftrag wiederholen' }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Bezeichnung') as HTMLInputElement).matches(
        ':disabled',
      ),
    ).toBe(true);
    expect(writes).toHaveLength(1);
  },
);
test('an empty or older list cannot remove a confirmed create until a later GET is current', async () => {
  let reads = 0;
  let created: Record<string, unknown> | null = null;
  const writes = setup(
    (body) => {
      created = createdBody(body);
      return Response.json(created);
    },
    () => {
      reads++;
      if (reads === 1) return Response.json([template]);
      if (reads === 2) return Response.json([]);
      if (reads === 3) return Response.json([template]);
      return Response.json(created ? [created] : []);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional persisted template' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(
    await screen.findByText(
      'Vorlage gespeichert. Der Listenstand ist noch nicht aktuell. Bitte Vorlagen neu laden.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText('Angebot: Fictional persisted template – 0 Position(en)'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  await screen.findByText(/Listenstand ist noch nicht aktuell/);
  expect(
    screen.getByText('Angebot: Fictional persisted template – 0 Position(en)'),
  ).toBeTruthy();
  const reload = screen.getByRole('button', { name: 'Vorlagen neu laden' });
  reload.focus();
  fireEvent.click(reload);
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes).toHaveLength(1);
  expect(reads).toBe(4);
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional persisted template',
    }),
  );
});
test('a newer server version replaces the confirmed receipt after create', async () => {
  let reads = 0;
  let created: Record<string, unknown> | null = null;
  const writes = setup(
    (body) => {
      created = createdBody(body);
      return Response.json(created);
    },
    () => {
      reads++;
      if (reads === 1) return Response.json([template]);
      const newer = {
        ...created,
        version: 2,
        name: 'Fictional newer template from another writer',
      };
      return Response.json(newer ? [newer] : []);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional created template' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(
    await screen.findByText(
      'Vorlage gespeichert. Die Vorlage wurde inzwischen geändert; der aktuelle Stand wurde geladen.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(/Fictional newer template from another writer/),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeNull();
  expect(writes).toHaveLength(1);
});
test('successful reconciliation does not steal focus after the user moves elsewhere', async () => {
  let reads = 0;
  let created: Record<string, unknown> | null = null;
  let updated: Record<string, unknown> | null = null;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const writes = setup(
    (body) => {
      if (typeof body.requestId === 'string') {
        created = createdBody(body);
        return Response.json(created);
      }
      updated = savedBody(body);
      return Response.json(updated);
    },
    () => {
      reads++;
      if (reads === 1) return Response.json([template]);
      if (reads === 2)
        return Response.json({ error: 'unavailable' }, { status: 503 });
      if (reads === 3) return pending;
      return Response.json([
        updated ?? template,
        ...(created ? [created] : []),
      ]);
    },
  );
  render(
    <>
      <button type="button">Fictional external focus target</button>
      <DocumentTemplatesPanel csrfToken="fictional-csrf" />
    </>,
  );
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional created template' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(
    await screen.findByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
  const reload = screen.getByRole('button', { name: 'Vorlagen neu laden' });
  reload.focus();
  fireEvent.click(reload);
  const external = screen.getByRole('button', {
    name: 'Fictional external focus target',
  });
  external.focus();
  finish(Response.json(created ? [template, created] : [template]));

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(document.activeElement).toBe(external);
  const edit = screen.getByRole('button', {
    name: 'Vorlage bearbeiten: Fictional offer',
  });
  fireEvent.click(edit);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional later update' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  await vi.waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Vorlage bearbeiten: Fictional offer',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  expect(writes[1]!.method).toBe('PUT');
});
test('a known rejection of an uncertain retry keeps the original request locked', async () => {
  let attempts = 0;
  const writes = setup(() => {
    attempts++;
    if (attempts === 1)
      return Response.json({ error: 'unknown' }, { status: 503 });
    if (attempts === 2)
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    return Response.json(createdBody(writes[0]!.body));
  });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional retried template' },
  });
  const bodyForm = screen
    .getByRole('button', { name: 'Vorlage speichern' })
    .closest('form')!;
  fireEvent.submit(bodyForm);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Speicherauftrag wiederholen' }),
  );

  expect(
    await screen.findByText(
      'Bitte erneut anmelden, um die Vorlage zu speichern.',
    ),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText('Bezeichnung') as HTMLInputElement).matches(
      ':disabled',
    ),
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: 'Speicherauftrag wiederholen' }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Speicherauftrag wiederholen' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Speicherauftrag wiederholen' }),
  );
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes).toHaveLength(3);
  expect(writes[0]!.body).toEqual(writes[1]!.body);
  expect(writes[0]!.body).toEqual(writes[2]!.body);
  expect(
    screen.getAllByText(
      /Angebot: Fictional retried template – 0 Position\(en\)/,
    ),
  ).toHaveLength(1);
});
test('templates load with their positions, save exact minor units and archive with the current version', async () => {
  let listReads = 0;
  let saved: Record<string, unknown> = template;
  let archived: Record<string, unknown> = template;
  const writes = setup(
    (body) => {
      if (body.state === 'archived') {
        archived = createdBody({ ...body, version: Number(body.version) });
        archived = {
          ...archived,
          id: template.id,
          version: Number(body.version) + 1,
          state: 'archived',
        };
        return archivedResponse(body);
      }
      saved = savedBody(body);
      return Response.json(saved);
    },
    () => {
      const index = listReads++;
      return Response.json(
        index === 0 ? [template] : index === 1 ? [saved] : [archived],
      );
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  expect(
    (await screen.findAllByText(/Fictional offer/)).length,
  ).toBeGreaterThan(0);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  expect(
    (screen.getByLabelText('Beschreibung') as HTMLInputElement).value,
  ).toBe('Fictional box');
  expect(
    (screen.getByLabelText('Einzelpreis (Brutto) in Euro') as HTMLInputElement)
      .value,
  ).toBe('199.00');
  expect(
    screen.getByText(
      /Platzhalter: nur in Betreff, Einleitungstext und Schlusstext/,
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Einzelpreis (Brutto) in Euro'), {
    target: { value: '199.00' },
  });
  fireEvent.change(screen.getByLabelText('Rabatt in Prozent'), {
    target: { value: '5.00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  await screen.findByText('Gespeichert.');
  const save = writes[0]!;
  expect(save.method).toBe('PUT');
  expect(save.url).toBe('/api/v1/document-templates/fictional-template');
  expect(save.body.version).toBe(1);
  expect(save.headers).toMatchObject({ 'x-csrf-token': 'fictional-csrf' });
  expect(save.body.kind).toBe('offer');
  expect(save.body.positions).toEqual([
    {
      productId: null,
      description: 'Fictional box',
      quantity: 1,
      unit: 'Stück',
      unitPriceMinor: 19900,
      taxBasisPoints: 1900,
      discountBasisPoints: 500,
    },
  ]);
  writes.length = 0;
  const archiveButton = getArchiveButton('Fictional offer');
  archiveButton.focus();
  fireEvent.click(archiveButton);
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body.state).toBe('archived');
  expect(writes[0]!.body.version).toBe(2);
  expect((writes[0]!.body.positions as unknown[]).length).toBe(1);
  expect(
    (writes[0]!.body.positions as Array<Record<string, unknown>>)[0],
  ).toMatchObject({
    productId: null,
    description: 'Fictional box',
    quantity: 1,
    unitPriceMinor: 19900,
  });
  expect(
    (await screen.findByText(/Fictional offer – 1 Position\(en\) – Archiviert/))
      .textContent,
  ).toMatch(/Archiviert/);
  expect(
    screen.queryByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'Weitere Aktionen für Fictional offer',
    }),
  );
});

test('archive conflict keeps the open template draft and reports reconciliation', async () => {
  const other = {
    ...template,
    id: 'fictional-other-template',
    name: 'Fictional other offer',
  };
  const writes = setup(
    () => Response.json({ error: 'conflict' }, { status: 409 }),
    () => Response.json([template, other]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional edited subject' },
  });
  fireEvent.change(screen.getByLabelText('Beschreibung'), {
    target: { value: 'Fictional edited position' },
  });

  const archiveButton = getArchiveButton('Fictional offer');
  archiveButton.focus();
  fireEvent.click(archiveButton);

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Vorlage wurde inzwischen geändert.');
  expect(alert.textContent).not.toMatch(/archiviert/i);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional edited subject',
  );
  expect(
    (screen.getByLabelText('Beschreibung') as HTMLInputElement).value,
  ).toBe('Fictional edited position');
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body.version).toBe(1);
  expect(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Weitere Aktionen für Fictional offer',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'Weitere Aktionen für Fictional other offer',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Weitere Aktionen für Fictional other offer',
    }),
  );
  expect(writes).toHaveLength(1);
  const fetcher = vi.mocked(fetch);
  const readsBeforeReconcile = fetcher.mock.calls.filter(
    ([url, options]) => url === '/api/v1/document-templates' && !options,
  ).length;
  const reconcileButton = screen.getByRole('button', {
    name: 'Vorlagen neu laden',
  });
  reconcileButton.focus();
  fireEvent.click(reconcileButton);
  await screen.findByText(
    /Vorlagen neu geladen\. Die Vorlage ist nicht archiviert/,
  );
  expect(writes).toHaveLength(1);
  expect(
    fetcher.mock.calls.filter(
      ([url, options]) => url === '/api/v1/document-templates' && !options,
    ),
  ).toHaveLength(readsBeforeReconcile + 1);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional edited subject',
  );
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'Weitere Aktionen für Fictional offer',
    }),
  );
});

test('archive network failure keeps the open template draft and does not reject unhandled', async () => {
  const writes = setup(() => {
    throw new Error('fictional connection failure');
  });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional offline subject' },
  });

  fireEvent.click(getArchiveButton('Fictional offer'));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/unklar|Verbindung/i);
  expect(alert.textContent).not.toMatch(/archiviert/i);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional offline subject',
  );
  expect(writes).toHaveLength(1);
  const writeCount = writes.length;
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  await screen.findByText(
    /Vorlagen neu geladen\. Die Vorlage ist nicht archiviert/,
  );
  expect(writes).toHaveLength(writeCount);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional offline subject',
  );
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(1);
});

test.each([
  [404, /Vorlage ist nicht mehr verfügbar/],
  [503, /Archivierungsstand ist unklar/],
])(
  'archive HTTP %i waits for an explicit GET and preserves the open draft',
  async (status, copy) => {
    let listReads = 0;
    const writes = setup(
      () => Response.json({ error: 'fictional' }, { status }),
      () => {
        listReads += 1;
        return Response.json([template]);
      },
    );
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage bearbeiten: Fictional offer',
      }),
    );
    fireEvent.change(screen.getByLabelText('Betreff'), {
      target: { value: 'Fictional draft survives HTTP failure' },
    });
    fireEvent.click(getArchiveButton('Fictional offer'));
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(listReads).toBe(1);
    expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
      'Fictional draft survives HTTP failure',
    );
    expect(
      screen.getByRole('button', { name: 'Vorlagen neu laden' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
    expect(
      await screen.findByText(
        /Vorlagen neu geladen\. Die Vorlage ist nicht archiviert/,
      ),
    ).toBeTruthy();
    expect(listReads).toBe(2);
    expect(writes).toHaveLength(1);
    expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
      'Fictional draft survives HTTP failure',
    );
  },
);

test('malformed successful archive JSON stays unknown until a list GET succeeds', async () => {
  let listReads = 0;
  const writes = setup(
    () => new Response('{ not valid json', { status: 200 }),
    () => {
      listReads += 1;
      return Response.json([template]);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional draft survives malformed success' },
  });
  fireEvent.click(getArchiveButton('Fictional offer'));
  expect(await screen.findByText(/Archivierungsstand ist unklar/)).toBeTruthy();
  expect(listReads).toBe(1);
  expect(writes).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  expect(
    await screen.findByText(
      /Vorlagen neu geladen\. Die Vorlage ist nicht archiviert/,
    ),
  ).toBeTruthy();
  expect(listReads).toBe(2);
  expect(writes).toHaveLength(1);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional draft survives malformed success',
  );
});

test('confirmed archive remains confirmed when list reload fails and retry is GET only', async () => {
  let listReads = 0;
  const archived = {
    ...template,
    version: 2,
    state: 'archived',
    positions: [{ ...position, id: 'fictional-archived-position-0' }],
  };
  const writes = setup(
    (body) => archivedResponse(body),
    () => {
      listReads += 1;
      if (listReads === 2)
        return Response.json({ error: 'offline' }, { status: 503 });
      return Response.json(listReads === 1 ? [template] : [archived]);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional subject during confirmed archive' },
  });
  fireEvent.click(getArchiveButton('Fictional offer'));
  expect(
    await screen.findByText(
      /Vorlage archiviert\. Die Liste konnte nicht aktualisiert werden/,
    ),
  ).toBeTruthy();
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional subject during confirmed archive',
  );
  expect(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
  expect(writes).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  expect(
    await screen.findByText(
      /Vorlagen neu geladen\. Die Archivierung ist bestätigt/,
    ),
  ).toBeTruthy();
  expect(writes).toHaveLength(1);
  expect(
    (await screen.findByText(/Fictional offer – 1 Position\(en\) – Archiviert/))
      .textContent,
  ).toMatch(/Archiviert/);
});

test('reconciliation accepts and presents a strictly newer server template version', async () => {
  const newer = {
    ...template,
    version: 3,
    state: 'active',
    subject: 'Fictional changed in another session',
  };
  let listReads = 0;
  const writes = setup(
    (body) => archivedResponse(body),
    () => {
      listReads += 1;
      if (listReads === 2)
        return Response.json(
          { error: 'fictional temporary failure' },
          { status: 503 },
        );
      return Response.json(listReads === 1 ? [template] : [newer]);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional unsaved subject during concurrent edit' },
  });
  fireEvent.click(getArchiveButton('Fictional offer'));
  expect(
    await screen.findByText(
      /Vorlage archiviert\. Die Liste konnte nicht aktualisiert werden/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional unsaved subject during concurrent edit',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  expect(
    await screen.findByText(
      /Archivierung bestätigt\. Die Vorlage wurde inzwischen erneut geändert/,
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeNull();
  expect(writes).toHaveLength(1);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional unsaved subject during concurrent edit',
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  expect(confirm).toHaveBeenCalledWith('Ungespeicherte Änderungen verwerfen?');
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional unsaved subject during concurrent edit',
  );
  confirm.mockReturnValue(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional changed in another session',
  );
});

test('automatic list refresh accepts a newer valid server template snapshot', async () => {
  let listReads = 0;
  const newer = {
    ...template,
    version: 3,
    state: 'active',
    subject: 'Fictional changed before refresh completed',
  };
  const writes = setup(
    (body) => archivedResponse(body),
    () => Response.json(listReads++ === 0 ? [template] : [newer]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  const archiveButton = getArchiveButton('Fictional offer');
  archiveButton.focus();
  fireEvent.click(archiveButton);
  expect(
    await screen.findByText(
      /Vorlage archiviert\. Die Vorlage wurde inzwischen erneut geändert/,
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeNull();
  expect(writes).toHaveLength(1);
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'Weitere Aktionen für Fictional offer',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage bearbeiten: Fictional offer',
    }),
  );
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional changed before refresh completed',
  );
});

test('malformed archive success stays locked until a validated list is loaded', async () => {
  let listReads = 0;
  const writes = setup(
    () => Response.json({ ...template, state: 'archived' }),
    () =>
      Response.json(
        listReads++ === 0 ? [template] : [{ ...template, version: 0 }],
      ),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(getArchiveButton('Fictional offer'));
  expect(
    await screen.findByText(/Archivierungsantwort war unplausibel/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  expect(
    await screen.findByText(/Serverstand konnte nicht abgeglichen werden/),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
  expect(writes).toHaveLength(1);
});

test('a contradictory automatic list response keeps confirmed archive locked', async () => {
  let listReads = 0;
  const writes = setup(
    (body) => archivedResponse(body),
    () => {
      listReads += 1;
      return Response.json([template]);
    },
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(getArchiveButton('Fictional offer'));
  expect(
    await screen.findByText(/Vorlage archiviert\. Der Listenstand weicht ab/),
  ).toBeTruthy();
  expect(listReads).toBe(2);
  expect(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
  expect(
    screen.getByText(/Fictional offer – 1 Position\(en\) – Archiviert/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  expect(
    await screen.findByText(
      /Archivierung ist bestätigt\. Der Listenstand weicht ab/,
    ),
  ).toBeTruthy();
  expect(listReads).toBe(3);
  expect(writes).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Vorlagen neu laden' }),
  ).toBeTruthy();
});

test('archive ignores a duplicate click while the PUT is pending', async () => {
  let finish!: (response: Response) => void;
  let listReads = 0;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const archived = { ...template, version: 2, state: 'archived' };
  const writes = setup(
    (body) => (body.state === 'archived' ? pending : Response.json(template)),
    () => Response.json(listReads++ === 0 ? [template] : [archived]),
  );
  render(
    <>
      <button type="button">Fictional external focus target</button>
      <DocumentTemplatesPanel csrfToken="fictional-csrf" />
    </>,
  );
  await screen.findAllByText(/Fictional offer/);
  const archiveButton = getArchiveButton('Fictional offer');
  archiveButton.focus();
  fireEvent.click(archiveButton);
  fireEvent.click(archiveButton);
  expect(writes).toHaveLength(1);
  expect(archiveButton.hasAttribute('disabled')).toBe(true);
  const externalFocusTarget = screen.getByRole('button', {
    name: 'Fictional external focus target',
  });
  externalFocusTarget.focus();
  finish(
    archivedResponse({
      kind: template.kind,
      name: template.name,
      subject: template.subject,
      introText: template.introText,
      outroText: template.outroText,
      validityDays: template.validityDays,
      positions: [position],
      version: template.version,
    }),
  );
  await screen.findByText('Vorlage archiviert.');
  expect(document.activeElement).toBe(externalFocusTarget);
});

test('unmount during an archive request removes the temporary focus listener', async () => {
  let finish!: (response: Response) => void;
  let listReads = 0;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const removeEventListener = vi.spyOn(document, 'removeEventListener');
  setup(
    () => pending,
    () => {
      listReads += 1;
      return Response.json([template]);
    },
  );
  const outside = document.createElement('button');
  outside.textContent = 'Fictional focus outside panel';
  outside.setAttribute('data-archive-focus-sentinel', '');
  document.body.append(outside);
  const { unmount } = render(
    <DocumentTemplatesPanel csrfToken="fictional-csrf" />,
  );
  await screen.findAllByText(/Fictional offer/);
  const archiveButton = getArchiveButton('Fictional offer');
  archiveButton.focus();
  fireEvent.click(archiveButton);
  unmount();
  expect(
    removeEventListener.mock.calls.some(([type]) => type === 'focusin'),
  ).toBe(true);
  outside.focus();
  finish(
    archivedResponse({
      kind: template.kind,
      name: template.name,
      subject: template.subject,
      introText: template.introText,
      outroText: template.outroText,
      validityDays: template.validityDays,
      positions: [position],
      version: template.version,
    }),
  );
  await vi.waitFor(() => expect(listReads).toBe(2));
  expect(document.activeElement).toBe(outside);
});

test('archive carries the stored archived product reference and exact version', async () => {
  const stored = {
    ...template,
    positions: [{ ...position, productId: archivedProduct.id }],
  };
  const archived = {
    ...stored,
    version: 2,
    state: 'archived',
    positions: [
      { ...stored.positions[0]!, id: 'fictional-replaced-position-id' },
    ],
  };
  let listReads = 0;
  const writes = setup(
    (body) => archivedResponse(body),
    () => Response.json(listReads++ === 0 ? [stored] : [archived]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(getArchiveButton('Fictional offer'));
  await screen.findByText('Vorlage archiviert.');
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body.version).toBe(1);
  expect(writes[0]!.headers).toMatchObject({
    'x-csrf-token': 'fictional-csrf',
  });
  expect(writes[0]!.body.positions).toEqual([
    {
      productId: archivedProduct.id,
      description: 'Fictional box',
      quantity: 1,
      unit: 'Stück',
      unitPriceMinor: 19900,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
  ]);
});

test.each([
  [400, /Archivierung abgelehnt/],
  [401, /Bitte erneut anmelden/],
  [403, /Berechtigung prüfen/],
])(
  'known archive rejection %i preserves the draft without a reconciliation lock',
  async (status, copy) => {
    const writes = setup(() =>
      Response.json({ error: 'rejected' }, { status }),
    );
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage bearbeiten: Fictional offer',
      }),
    );
    fireEvent.change(screen.getByLabelText('Betreff'), {
      target: { value: 'Fictional preserved rejection draft' },
    });
    fireEvent.click(getArchiveButton('Fictional offer'));
    expect(await screen.findByText(copy)).toBeTruthy();
    expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
      'Fictional preserved rejection draft',
    );
    expect(
      screen.queryByRole('button', { name: 'Vorlagen neu laden' }),
    ).toBeNull();
    expect(writes).toHaveLength(1);
  },
);

test('an unknown placeholder is reported instead of being saved silently', async () => {
  setup(() => Response.json({ error: 'unknown_placeholder' }, { status: 400 }));
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Angebot für {{kontakt}}' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(await screen.findByText(/Unbekannter Platzhalter/)).toBeTruthy();
});
test('choosing a net product fills its gross price, unit and tax into the position', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Position hinzufügen' }));
  const selects = screen.getAllByLabelText('Produkt');
  fireEvent.change(selects[selects.length - 1]!, {
    target: { value: 'fictional-product' },
  });
  const descriptions = screen.getAllByLabelText('Beschreibung');
  expect(
    (descriptions[descriptions.length - 1] as HTMLInputElement).value,
  ).toBe('Fictional product');
  const prices = screen.getAllByLabelText('Einzelpreis (Brutto) in Euro');
  expect((prices[prices.length - 1] as HTMLInputElement).value).toBe('119.00');
});

test('gross product prices stay unchanged, archived choices stay hidden, and free selection preserves edits', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  const productSelect = screen.getByLabelText('Produkt');
  expect(
    screen.queryByRole('option', { name: 'Fictional archived product' }),
  ).toBeNull();
  fireEvent.change(productSelect, { target: { value: grossProduct.id } });
  expect(
    (screen.getByLabelText('Einzelpreis (Brutto) in Euro') as HTMLInputElement)
      .value,
  ).toBe('123.45');
  fireEvent.change(screen.getByLabelText('Beschreibung'), {
    target: { value: 'Fictional custom override' },
  });
  fireEvent.change(screen.getByLabelText('Einzelpreis (Brutto) in Euro'), {
    target: { value: '135.79' },
  });
  fireEvent.change(productSelect, { target: { value: '' } });
  expect(
    (screen.getByLabelText('Beschreibung') as HTMLInputElement).value,
  ).toBe('Fictional custom override');
  expect(
    (screen.getByLabelText('Einzelpreis (Brutto) in Euro') as HTMLInputElement)
      .value,
  ).toBe('135.79');
});

test('a net product conversion saves the gross minor-unit price', async () => {
  const writes = setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Produkt'), {
    target: { value: product.id },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  await screen.findByText('Gespeichert.');
  expect(
    (writes[0]!.body.positions as Array<Record<string, unknown>>)[0],
  ).toMatchObject({
    productId: product.id,
    unitPriceMinor: 11900,
    taxBasisPoints: 1900,
  });
});

test('overflowing net product conversion preserves the previous position and explains recovery', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Beschreibung'), {
    target: { value: 'Fictional custom position' },
  });
  fireEvent.change(screen.getByLabelText('Menge'), {
    target: { value: '7' },
  });
  fireEvent.change(screen.getByLabelText('Einheit'), {
    target: { value: 'Paket' },
  });
  fireEvent.change(screen.getByLabelText('Einzelpreis (Brutto) in Euro'), {
    target: { value: '222.22' },
  });
  fireEvent.change(screen.getByLabelText('Steuersatz in Prozent'), {
    target: { value: '8.00' },
  });
  fireEvent.change(screen.getByLabelText('Rabatt in Prozent'), {
    target: { value: '5.00' },
  });
  fireEvent.change(screen.getByLabelText('Produkt'), {
    target: { value: overflowProduct.id },
  });
  expect((screen.getByLabelText('Produkt') as HTMLSelectElement).value).toBe(
    '',
  );
  expect(
    (screen.getByLabelText('Beschreibung') as HTMLInputElement).value,
  ).toBe('Fictional custom position');
  expect(
    (screen.getByLabelText('Einzelpreis (Brutto) in Euro') as HTMLInputElement)
      .value,
  ).toBe('222.22');
  expect((screen.getByLabelText('Menge') as HTMLInputElement).value).toBe('7');
  expect((screen.getByLabelText('Einheit') as HTMLInputElement).value).toBe(
    'Paket',
  );
  expect(
    (screen.getByLabelText('Steuersatz in Prozent') as HTMLInputElement).value,
  ).toBe('8.00');
  expect(
    (screen.getByLabelText('Rabatt in Prozent') as HTMLInputElement).value,
  ).toBe('5.00');
  expect((await screen.findByRole('alert')).textContent).toMatch(
    /sicheren Bruttobetrag/,
  );
});
test('opening another template draft clears the previous product conversion error', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Produkt'), {
    target: { value: overflowProduct.id },
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(getDuplicateButton('Fictional offer'));
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'Weitere Aktionen für Fictional offer',
    }),
  );
});
test('edits every position field, removes a row and cancels the draft', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Position hinzufügen' }));
  fireEvent.change(screen.getAllByLabelText('Beschreibung')[0]!, {
    target: { value: 'Fictional box updated' },
  });
  fireEvent.change(screen.getAllByLabelText('Menge')[0]!, {
    target: { value: '3' },
  });
  fireEvent.change(screen.getAllByLabelText('Einheit')[0]!, {
    target: { value: 'Paket' },
  });
  fireEvent.change(screen.getAllByLabelText('Steuersatz in Prozent')[0]!, {
    target: { value: '7.00' },
  });
  expect(screen.getAllByLabelText('Beschreibung')).toHaveLength(2);
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Position entfernen' })[1]!,
  );
  expect(screen.getAllByLabelText('Beschreibung')).toHaveLength(1);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
});
test('duplicating opens a copy with the stored positions intact', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(getDuplicateButton('Fictional offer'));
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    'Fictional offer (Kopie)',
  );
  expect(
    (screen.getByLabelText('Beschreibung') as HTMLInputElement).value,
  ).toBe('Fictional box');
});
test('a failed product list still leaves free positions usable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/products') throw new Error('offline');
      return Response.json(options ? template : [template]);
    }),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  expect((screen.getByLabelText('Produkt') as HTMLSelectElement).value).toBe(
    '',
  );
});
test('a conflicting version is reported so the operator reloads first', async () => {
  setup(() => Response.json({ error: 'conflict' }, { status: 409 }));
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(await screen.findByText(/Inzwischen geändert/)).toBeTruthy();
});
test.each(['id', 'version', 'state', 'content'])(
  'an implausible update response (%s) keeps the edited input for GET reconciliation',
  async (mutation) => {
    const writes = setup((body) => {
      const saved = savedBody(body);
      if (mutation === 'id') saved.id = 'fictional-other-template';
      if (mutation === 'version') saved.version = Number(body.version) + 2;
      if (mutation === 'state') saved.state = 'archived';
      if (mutation === 'content') saved.subject = 'Different server content';
      return Response.json(saved);
    });
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage bearbeiten: Fictional offer',
      }),
    );
    fireEvent.change(screen.getByLabelText('Betreff'), {
      target: { value: 'Fictional intended update' },
    });
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Vorlage speichern' })
        .closest('form')!,
    );

    expect(
      await screen.findByText(
        'Die Speicherantwort war unplausibel. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.',
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
      'Fictional intended update',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
    await screen.findByText(/Serverstand geladen/);
    expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
      'Fictional intended update',
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body.version).toBe(template.version);
  },
);
test('a deleted update target requires GET reconciliation and keeps the draft', async () => {
  const writes = setup(() =>
    Response.json({ error: 'missing' }, { status: 404 }),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional retained draft' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(
    await screen.findByText(/Vorlage ist nicht mehr verfügbar/),
  ).toBeTruthy();
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional retained draft',
  );
  const reload = screen.getByRole('button', { name: 'Vorlagen neu laden' });
  reload.focus();
  fireEvent.click(reload);
  await screen.findByText(/Serverstand geladen/);
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional retained draft',
  );
  expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung'));
  expect(writes).toHaveLength(1);
});
test('a failed template list is reported without breaking the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/products') return Response.json([product]);
      throw new Error('offline');
    }),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  expect(
    await screen.findByText('Vorlagen konnten nicht geladen werden.'),
  ).toBeTruthy();
  openCreate();
  expect(
    screen.getByRole('button', { name: 'Vorlage speichern' }),
  ).toBeTruthy();
});

test('templates stay in a list until create is requested, then focus the editor', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);

  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  expect(screen.queryByText(/Platzhalter:/)).toBeNull();
  const create = screen.getByRole('button', { name: 'Vorlage anlegen' });
  expect(create.className).toContain('primary-action');
  create.focus();
  fireEvent.click(create);

  const name = screen.getByLabelText('Bezeichnung');
  expect(document.activeElement).toBe(name);
  expect(screen.getByText(/Platzhalter:/)).toBeTruthy();
  expect(screen.getByText(/Fictional offer – 1 Position\(en\)/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Vorlage speichern' }),
  ).toBeTruthy();
});
test('saving a changed kind returns focus to the edited template row', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Dokumentart'), {
    target: { value: 'invoice' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
});
test('an unchanged duplicate remains SPA-dirty while its create is pending', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const writes = setup(() => pending);
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(getDuplicateButton('Fictional offer'));
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(hasUnsavedChanges()).toBe(true);
  expect(writes).toHaveLength(1);
  finish(Response.json(createdBody(writes[0]!.body)));
  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(false);
});

test('a confirmed new-template save closes the editor and returns focus', async () => {
  const writes = setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  const create = screen.getByRole('button', { name: 'Vorlage anlegen' });
  create.focus();
  fireEvent.click(create);
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional created template' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes[0]!.method).toBe('POST');
  expect(writes[0]!.body.name).toBe('Fictional created template');
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Vorlage anlegen' }),
  );
});

test('canceling a dirty editor asks before discard and restores trigger focus', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);

  const create = screen.getByRole('button', { name: 'Vorlage anlegen' });
  create.focus();
  fireEvent.click(create);
  fireEvent.change(screen.getByLabelText('Bezeichnung'), {
    target: { value: 'Fictional unsaved template' },
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(confirm).toHaveBeenCalledWith('Ungespeicherte Änderungen verwerfen?');
  expect(screen.getByLabelText('Bezeichnung')).toBeTruthy();
  expect(screen.getByText(/Fictional offer – 1 Position\(en\)/)).toBeTruthy();

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Vorlage anlegen' }),
  );
});

test('changing to another template asks before discarding the open draft', async () => {
  const other = {
    ...template,
    id: 'fictional-other-template',
    name: 'Fictional other offer',
  };
  setup(
    () => Response.json(template),
    () => Response.json([template, other]),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional edited subject' },
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(getDuplicateButton('Fictional other offer'));
  expect(confirm).toHaveBeenCalledWith('Ungespeicherte Änderungen verwerfen?');
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional edited subject',
  );
});

test('app-wide dirty registration tracks form fields and position changes', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  expect(hasUnsavedChanges()).toBe(false);

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional edited subject' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: template.subject },
  });
  expect(hasUnsavedChanges()).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Position hinzufügen' }));
  expect(hasUnsavedChanges()).toBe(true);
});

test('accepting same-row edit confirmation resets the uncontrolled draft', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  const edit = screen.getByRole('button', {
    name: 'Vorlage bearbeiten: Fictional offer',
  });
  fireEvent.click(edit);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional unsaved subject' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(edit);

  expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung'));
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    template.subject,
  );
  expect(hasUnsavedChanges()).toBe(false);
});

test('an unchanged editor stays clean while an archive request disables the form', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  setup((body) =>
    body.state === 'archived' ? pending : Response.json(template),
  );
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.click(getArchiveButton('Fictional offer'));
  expect(hasUnsavedChanges()).toBe(false);
  finish(
    archivedResponse({
      ...template,
      state: 'archived',
      version: template.version,
    }),
  );
  expect(await screen.findByText('Vorlage archiviert.')).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(false);
});

test('a successful delayed save does not steal focus from another control', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const writes = setup(() => pending);
  render(
    <>
      <button type="button">Fictional external focus target</button>
      <DocumentTemplatesPanel csrfToken="fictional-csrf" />
    </>,
  );
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional pending save' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  const external = screen.getByRole('button', {
    name: 'Fictional external focus target',
  });
  external.focus();
  finish(Response.json(savedBody(writes[0]!.body)));
  await screen.findByText('Gespeichert.');
  expect(document.activeElement).toBe(external);
});

test('template preview renders the unsaved form snapshot without saving or clearing dirty state', async () => {
  const requests = setupPreview(() => pdfResponse());
  const create = vi.fn(() => 'blob:fictional-preview');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  expect(
    screen.getByText(
      'Die Vorschau verwendet Beispieldaten und neutrales Briefpapier. Gespeicherte Geschäftsdaten und Logos werden nicht verwendet.',
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional unsaved preview subject' },
  });
  fireEvent.change(screen.getByLabelText('Einleitungstext'), {
    target: { value: 'Fictional unsaved introduction' },
  });
  fireEvent.change(screen.getByLabelText('Einzelpreis (Brutto) in Euro'), {
    target: { value: '250,00' },
  });
  expect(hasUnsavedChanges()).toBe(true);

  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );

  expect(
    await screen.findByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('/api/v1/document-templates/preview');
  expect(requests[0]!.options?.method).toBe('POST');
  expect(requests[0]!.options?.headers).toEqual({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(requests[0]!.body).toEqual({
    kind: 'offer',
    name: 'Fictional offer',
    subject: 'Fictional unsaved preview subject',
    introText: 'Fictional unsaved introduction',
    outroText: template.outroText,
    validityDays: 14,
    state: 'active',
    positions: [
      {
        productId: null,
        description: position.description,
        quantity: 1,
        unit: position.unit,
        unitPriceMinor: 25000,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ],
  });
  expect(JSON.stringify(requests[0]!.body)).not.toMatch(
    /"(id|version|requestId)"/,
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  expect(hasUnsavedChanges()).toBe(true);
  expect(screen.getByLabelText('Betreff')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Vorlage speichern' }),
  ).toBeTruthy();
});

test.each([
  [
    'wrong MIME',
    () =>
      new Response('%PDF-1.4 fictional preview', {
        headers: { 'content-type': 'text/html' },
      }),
  ],
  [
    'wrong signature',
    () =>
      new Response('not a PDF', {
        headers: { 'content-type': 'application/pdf' },
      }),
  ],
  [
    'oversized content length',
    () =>
      new Response('%PDF-1.4 fictional preview', {
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(10 * 1024 * 1024 + 1),
        },
      }),
  ],
  [
    'oversized PDF body',
    () => {
      const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
      bytes.set(new TextEncoder().encode('%PDF-'));
      return new Response(bytes, {
        headers: { 'content-type': 'application/pdf' },
      });
    },
  ],
])(
  'a preview with %s is rejected without exposing a download',
  async (_name, makeResponse) => {
    setupPreview(() => makeResponse());
    const create = vi.fn(() => 'blob:fictional-preview');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage bearbeiten: Fictional offer',
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Bezeichnung')).toBeTruthy();
  },
);

test('editing a draft invalidates an in-flight preview response', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const requests = setupPreview(() => pending);
  const create = vi.fn(() => 'blob:fictional-preview');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  expect(requests).toHaveLength(1);
  expect(screen.getAllByText('Inhaltsvorschau wird erstellt …')).toHaveLength(
    1,
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Inhaltsvorschau erstellen',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  expect(requests).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fictional changed during preview' },
  });
  expect(
    screen.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.'),
  ).toBeTruthy();
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Fictional changed during preview',
  );
  await act(async () => {
    finish(pdfResponse());
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(
    screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

test('a current preview URL is revoked when the draft changes and when the editor unmounts', async () => {
  const requests = setupPreview(() => pdfResponse());
  const create = vi
    .fn<() => string>()
    .mockReturnValueOnce('blob:fictional-preview-one')
    .mockReturnValueOnce('blob:fictional-preview-two')
    .mockReturnValueOnce('blob:fictional-preview-three');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const view = render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  const previewButton = screen.getByRole('button', {
    name: 'Inhaltsvorschau erstellen',
  });
  fireEvent.click(previewButton);
  expect(
    await screen.findByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Position hinzufügen' }));
  expect(
    screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:fictional-preview-one');
  fireEvent.click(previewButton);
  expect(
    await screen.findByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(requests).toHaveLength(2);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(revoke).toHaveBeenCalledWith('blob:fictional-preview-two');
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  expect(
    await screen.findByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(requests).toHaveLength(3);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:fictional-preview-three');
});

test('closing the editor while preview is pending drops the late PDF response', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const requests = setupPreview(() => pending);
  const create = vi.fn(() => 'blob:fictional-preview');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
  await act(async () => {
    finish(pdfResponse());
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(requests).toHaveLength(1);
  expect(create).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeNull();
});

test('unmounting while preview is pending cannot create a late blob URL', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  setupPreview(() => pending);
  const create = vi.fn(() => 'blob:fictional-preview');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  const view = render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  view.unmount();
  await act(async () => {
    finish(pdfResponse());
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(create).not.toHaveBeenCalled();
});

test.each([
  ['unknown_placeholder', 'unknown'],
  ['invalid_template', 'invalid'],
])(
  'a rejected template preview (%s) keeps the editor draft and creates no link',
  async (error) => {
    const requests = setupPreview(() =>
      Response.json({ error }, { status: 400 }),
    );
    const create = vi.fn(() => 'blob:fictional-preview');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
    await screen.findAllByText(/Fictional offer/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage bearbeiten: Fictional offer',
      }),
    );
    fireEvent.change(screen.getByLabelText('Betreff'), {
      target: { value: `Fictional ${error} draft` },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
    ).toBeNull();
    expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
      `Fictional ${error} draft`,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.options?.method).toBe('POST');
    expect(create).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Vorlage speichern' }),
    ).toBeTruthy();
  },
);

// Placeholder pickers: an explicit user requirement. No Bookitup placeholder
// menu was observed, so the interaction follows the product picker pattern of
// this codebase and only offers the eight server-side tokens.
function openPlaceholderPicker(field: string) {
  fireEvent.click(
    screen.getByRole('button', {
      name: `Platzhalter in den ${field} einfügen`,
    }),
  );
  return screen.getByRole('group', { name: `Platzhalter für den ${field}` });
}
function choosePlaceholder(group: HTMLElement, name: string) {
  fireEvent.change(within(group).getByLabelText('Platzhalter'), {
    target: { value: name },
  });
}
function insertChosenPlaceholder(group: HTMLElement) {
  fireEvent.click(within(group).getByRole('button', { name: 'Einfügen' }));
}

test('the placeholder picker inserts at the caret and leaves a dirty draft', async () => {
  const writes = setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  const subject = screen.getByLabelText('Betreff') as HTMLInputElement;
  const typed = 'Fiktiver Betreff ';
  fireEvent.change(subject, { target: { value: typed } });
  subject.focus();
  subject.setSelectionRange(typed.length, typed.length);
  fireEvent.select(subject);
  expect(hasUnsavedChanges()).toBe(true);

  const group = openPlaceholderPicker('Betreff');
  choosePlaceholder(group, 'contact');
  insertChosenPlaceholder(group);

  expect(subject.value).toBe('Fiktiver Betreff {{contact}}');
  expect(subject.selectionStart).toBe('Fiktiver Betreff {{contact}}'.length);
  expect(subject.selectionEnd).toBe('Fiktiver Betreff {{contact}}'.length);
  expect(document.activeElement).toBe(subject);
  expect(hasUnsavedChanges()).toBe(true);
  expect(writes).toHaveLength(0);
  expect(
    screen.queryByRole('group', { name: 'Platzhalter für den Betreff' }),
  ).toBeNull();
});

test('choosing a placeholder without inserting keeps the draft clean and the preview valid', async () => {
  setupPreview(() => pdfResponse());
  const create = vi.fn(() => 'blob:fictional-preview');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  expect(
    await screen.findByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(false);

  const group = openPlaceholderPicker('Einleitungstext');
  choosePlaceholder(group, 'event');

  expect(
    screen.getByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeTruthy();
  expect(
    screen.queryByText('Entwurf geändert. Bitte Vorschau erneut erstellen.'),
  ).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  expect(hasUnsavedChanges()).toBe(false);

  insertChosenPlaceholder(group);

  expect(
    screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeNull();
  expect(
    screen.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.'),
  ).toBeTruthy();
  expect(revoke).toHaveBeenCalledTimes(1);
});

test('inserting a placeholder invalidates a current preview exactly once', async () => {
  setupPreview(() => pdfResponse());
  const create = vi.fn(() => 'blob:fictional-preview');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Inhaltsvorschau erstellen' }),
  );
  await screen.findByRole('link', { name: 'Vorschau-PDF herunterladen' });

  const group = openPlaceholderPicker('Schlusstext');
  choosePlaceholder(group, 'date');
  insertChosenPlaceholder(group);
  await act(async () => {
    await Promise.resolve();
  });

  expect(revoke).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText('Entwurf geändert. Bitte Vorschau erneut erstellen.'),
  ).toBeTruthy();
  expect(
    screen.queryByRole('link', { name: 'Vorschau-PDF herunterladen' }),
  ).toBeNull();
});

test('inserting into a full field is refused without changing the value', async () => {
  const requests = setupPreview(() => pdfResponse());
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  const subject = screen.getByLabelText('Betreff') as HTMLInputElement;
  const full = 'x'.repeat(200);
  fireEvent.change(subject, { target: { value: full } });

  const group = openPlaceholderPicker('Betreff');
  choosePlaceholder(group, 'contact');
  insertChosenPlaceholder(group);

  expect(subject.value).toBe(full);
  expect(
    screen.getByText(
      'Das Feld ist voll. Der Platzhalter wurde nicht eingefügt.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole('group', { name: 'Platzhalter für den Betreff' }),
  ).toBeTruthy();
  expect(requests).toHaveLength(0);
});

test('inserting without a prior caret appends at the end', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  const intro = screen.getByLabelText('Einleitungstext') as HTMLTextAreaElement;
  expect(intro.value).toBe('');

  const group = openPlaceholderPicker('Einleitungstext');
  choosePlaceholder(group, 'documentLink');
  insertChosenPlaceholder(group);

  expect(intro.value).toBe('{{documentLink}}');
  expect(document.activeElement).toBe(intro);
  expect(intro.selectionStart).toBe('{{documentLink}}'.length);
  expect(hasUnsavedChanges()).toBe(true);
});

test('choosing a placeholder alone never changes the submitted payload', async () => {
  const writes = setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  expect(hasUnsavedChanges()).toBe(false);

  const group = openPlaceholderPicker('Betreff');
  choosePlaceholder(group, 'contact');
  expect(hasUnsavedChanges()).toBe(false);

  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body.subject).toBe(template.subject);
  expect(writes[0]!.body.introText).toBe(template.introText);
  expect(writes[0]!.body.outroText).toBe(template.outroText);
});

test('a saved template carries the inserted placeholder', async () => {
  const writes = setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  const group = openPlaceholderPicker('Betreff');
  choosePlaceholder(group, 'contact');
  insertChosenPlaceholder(group);
  expect(hasUnsavedChanges()).toBe(true);

  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );

  expect(await screen.findByText('Gespeichert.')).toBeTruthy();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body.subject).toBe('Angebot für {{contact}}{{contact}}');
  expect(hasUnsavedChanges()).toBe(false);
});

test('every text field owns a distinct, keyboard reachable picker', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  openCreate();
  expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung'));
  expect(
    screen.getAllByRole('button', { name: /^Platzhalter in den / }).length,
  ).toBe(3);

  const [subjectToggle, introToggle, outroToggle] = [
    'Betreff',
    'Einleitungstext',
    'Schlusstext',
  ].map(
    (field) =>
      screen.getByRole('button', {
        name: `Platzhalter in den ${field} einfügen`,
      }) as HTMLButtonElement,
  );
  for (const toggle of [subjectToggle!, introToggle!, outroToggle!])
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(subjectToggle!);
  expect(subjectToggle!.getAttribute('aria-expanded')).toBe('true');
  const panelId = subjectToggle!.getAttribute('aria-controls')!;
  expect(panelId).toBeTruthy();
  const group = document.getElementById(panelId)!;
  expect(group).toBeTruthy();
  expect(
    screen.getByRole('group', { name: 'Platzhalter für den Betreff' }),
  ).toBe(group);
  expect(within(group).getByLabelText('Platzhalter')).toBeTruthy();
  expect(
    within(group)
      .getByRole('button', { name: 'Einfügen' })
      .hasAttribute('disabled'),
  ).toBe(true);

  fireEvent.click(introToggle!);
  expect(subjectToggle!.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(panelId)).toBeNull();

  const outroGroup = openPlaceholderPicker('Schlusstext');
  expect(outroGroup).toBeTruthy();
  expect(introToggle!.getAttribute('aria-expanded')).toBe('false');

  const introGroup = openPlaceholderPicker('Einleitungstext');
  fireEvent.keyDown(within(introGroup).getByLabelText('Platzhalter'), {
    key: 'Escape',
  });
  expect(
    screen.queryByRole('group', {
      name: 'Platzhalter für den Einleitungstext',
    }),
  ).toBeNull();
  expect(introToggle!.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(introToggle);
});

test('deleting an inserted placeholder makes the draft clean again', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Vorlage bearbeiten: Fictional offer' }),
  );
  expect(hasUnsavedChanges()).toBe(false);

  const group = openPlaceholderPicker('Betreff');
  choosePlaceholder(group, 'contact');
  insertChosenPlaceholder(group);
  expect(hasUnsavedChanges()).toBe(true);

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: template.subject },
  });
  expect(hasUnsavedChanges()).toBe(false);
});

test('the offered placeholders match the server list', () => {
  expect(templatePlaceholderOffers.map((offer) => offer.name)).toEqual([
    ...templatePlaceholders,
  ]);
  for (const offer of templatePlaceholderOffers) {
    expect(offer.label.length).toBeGreaterThan(0);
    expect(offer.meaning.length).toBeGreaterThan(0);
    expect(offer.description.length).toBeGreaterThan(offer.meaning.length);
  }
});
