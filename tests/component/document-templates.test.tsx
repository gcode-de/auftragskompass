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
  priceMinor: 5000,
  taxBasisPoints: 1900,
  state: 'active',
};
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
    if (url === '/api/v1/products') return Response.json([product]);
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
    (screen.getByLabelText('Einzelpreis in Euro') as HTMLInputElement).value,
  ).toBe('199.00');
  fireEvent.change(screen.getByLabelText('Einzelpreis in Euro'), {
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
test('choosing a product fills its unit, price and tax into the position', async () => {
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
  const prices = screen.getAllByLabelText('Einzelpreis in Euro');
  expect((prices[prices.length - 1] as HTMLInputElement).value).toBe('50.00');
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
