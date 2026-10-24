import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentTemplatesPanel } from '../../apps/admin/src/DocumentTemplatesPanel.js';

afterEach(() => {
  cleanup();
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
  reply: (body: Record<string, unknown>) => Response = () =>
    Response.json(template),
) {
  const writes: {
    url: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/products') return Response.json(products);
    if (!options) return Response.json([template]);
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    writes.push({ url, method: String(options.method), body });
    return reply(body);
  });
  vi.stubGlobal('fetch', fetcher);
  return writes;
}
test('templates load with their positions, save exact minor units and archive with the current version', async () => {
  const writes = setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  expect(
    (await screen.findAllByText(/Fictional offer/)).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText(/\{\{documentLink\}\}/)).toBeTruthy();
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body.state).toBe('archived');
  expect(writes[0]!.body.version).toBe(1);
  expect((writes[0]!.body.positions as unknown[]).length).toBe(1);
});
test('an unknown placeholder is reported instead of being saved silently', async () => {
  setup(() => Response.json({ error: 'unknown_placeholder' }, { status: 400 }));
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage duplizieren: Fictional offer',
    }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect((screen.getByLabelText('Bezeichnung') as HTMLInputElement).value).toBe(
    '',
  );
});
test('duplicating opens a copy with the stored positions intact', async () => {
  setup();
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage duplizieren: Fictional offer',
    }),
  );
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
  expect((screen.getByLabelText('Produkt') as HTMLSelectElement).value).toBe(
    '',
  );
});
test('a conflicting version is reported so the operator reloads first', async () => {
  setup(() => Response.json({ error: 'conflict' }, { status: 409 }));
  render(<DocumentTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findAllByText(/Fictional offer/);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Vorlage speichern' }).closest('form')!,
  );
  expect(await screen.findByText(/Inzwischen geändert/)).toBeTruthy();
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
  expect(
    screen.getByRole('button', { name: 'Vorlage speichern' }),
  ).toBeTruthy();
});
