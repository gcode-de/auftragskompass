import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SavePositionAsProduct } from '../../apps/admin/src/SavePositionAsProduct.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// DOC-PRODUCT-01.6: a position becomes one product master record through the
// existing POST /api/v1/products. These fixtures are synthetic and match the
// stored position values exactly.
const position: {
  description: string;
  infoText?: string;
  unit: string;
  price: string;
  priceBasis: 'gross' | 'net';
  tax: string;
} = {
  description: 'Fiktive Fotobox-Stunde',
  infoText: 'Fiktiver Infotext mit Details.',
  unit: 'Stunde',
  price: '119.00',
  priceBasis: 'gross',
  tax: '19.00',
};
const createdProduct = {
  id: 'fictional-created-product',
  version: 1,
  name: 'Fiktive Fotobox-Stunde',
  description: 'Fiktiver Infotext mit Details.',
  unit: 'Stunde',
  priceMinor: 11900,
  priceBasis: 'gross',
  taxBasisPoints: 1900,
  state: 'active',
  position: 0,
};

function setup(
  options: {
    post?: (body: Record<string, unknown>) => Response | Promise<Response>;
    stock?: () => Response | Promise<Response>;
  } = {},
) {
  const writes: { body: Record<string, unknown>; headers: HeadersInit }[] = [];
  let reads = 0;
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      if (url === '/api/v1/products' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        writes.push({ body, headers: init?.headers ?? {} });
        return options.post
          ? options.post(body)
          : Response.json(
              { ...body, id: createdProduct.id, version: 1 },
              { status: 201 },
            );
      }
      if (url === '/api/v1/products' && method === 'GET') {
        reads += 1;
        return options.stock
          ? options.stock()
          : Response.json([createdProduct]);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  );
  vi.stubGlobal('fetch', fetcher);
  return {
    writes,
    reads: () => reads,
  };
}

function renderAction(overrides: Partial<typeof position> = {}) {
  render(
    <SavePositionAsProduct
      label="Position 1"
      csrfToken="fictional-csrf"
      position={{ ...position, ...overrides }}
    />,
  );
  return screen.getByRole('button', {
    name: 'Position 1 als Produkt speichern',
  });
}

test('the row action copies description, info text, unit, price, basis and tax exactly', async () => {
  const { writes } = setup();
  const button = renderAction();
  fireEvent.click(button);

  await screen.findByText('Als Produkt gespeichert: Fiktive Fotobox-Stunde.');
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body).toEqual({
    name: 'Fiktive Fotobox-Stunde',
    description: 'Fiktiver Infotext mit Details.',
    unit: 'Stunde',
    priceMinor: 11900,
    priceBasis: 'gross',
    taxBasisPoints: 1900,
    state: 'active',
    position: 0,
  });
  expect(writes[0]!.headers).toMatchObject({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
});

test('a net position keeps its stored basis and an empty info text stays an empty description', async () => {
  const { writes } = setup({
    post: (body) => Response.json({ ...body, id: 'p-net', version: 1 }),
  });
  const button = renderAction({
    infoText: '',
    priceBasis: 'net',
    price: '100.00',
    tax: '0.00',
  });
  fireEvent.click(button);

  await screen.findByText('Als Produkt gespeichert: Fiktive Fotobox-Stunde.');
  expect(writes[0]!.body).toEqual({
    name: 'Fiktive Fotobox-Stunde',
    description: '',
    unit: 'Stunde',
    priceMinor: 10000,
    priceBasis: 'net',
    taxBasisPoints: 0,
    state: 'active',
    position: 0,
  });
});

test('a double click sends exactly one product and keeps the action locked while pending', async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const { writes } = setup({ post: () => pending });
  const button = renderAction();
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.click(button);

  expect(writes).toHaveLength(1);
  expect(button).toHaveProperty('disabled', true);
  release(Response.json(createdProduct, { status: 201 }));
  await screen.findByText('Als Produkt gespeichert: Fiktive Fotobox-Stunde.');
  expect(writes).toHaveLength(1);
});

test.each([
  [400, 'Das Produkt wurde abgelehnt.'],
  [401, 'Anmeldung erforderlich.'],
  [403, 'Keine Berechtigung, Produkte anzulegen.'],
  [409, 'Der Vorgang wurde abgelehnt, weil sich der Bestand geändert hat.'],
])(
  'a known %s rejection names the problem and keeps the action usable',
  async (status, expected) => {
    const { writes } = setup({
      post: () => Response.json({ error: 'rejected' }, { status }),
    });
    const button = renderAction();
    fireEvent.click(button);

    const message = await screen.findByRole('alert');
    expect(message.textContent).toContain(expected);
    expect(button).toHaveProperty('disabled', false);
    expect(writes).toHaveLength(1);

    fireEvent.click(button);
    await waitFor(() => expect(writes).toHaveLength(2));
  },
);

test('an unclear network outcome is shown as unclear and never resends by itself', async () => {
  const { writes } = setup({
    post: () => Promise.reject(new Error('network')),
  });
  const button = renderAction();
  fireEvent.click(button);

  const message = await screen.findByRole('alert');
  expect(message.textContent).toBe(
    'Ausgang unklar. Das Produkt kann angelegt worden sein. Prüfen Sie den Bestand, bevor Sie erneut anlegen.',
  );
  expect(button).toHaveProperty('disabled', true);
  expect(writes).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(writes).toHaveLength(1);
});

test('a plausible-looking but wrong success answer is treated as unclear', async () => {
  const { writes } = setup({
    post: () =>
      Response.json(
        { ...createdProduct, priceMinor: 999, name: 'Falsches Produkt' },
        { status: 201 },
      ),
  });
  const button = renderAction();
  fireEvent.click(button);

  expect((await screen.findByRole('alert')).textContent).toContain(
    'Ausgang unklar.',
  );
  expect(button).toHaveProperty('disabled', true);
  expect(writes).toHaveLength(1);
});

test('the stock check shows an identical existing product and keeps creation locked', async () => {
  setup({ post: () => Promise.reject(new Error('network')) });
  const button = renderAction();
  fireEvent.click(button);
  await screen.findByRole('alert');

  const check = screen.getByRole('button', { name: 'Bestand prüfen' });
  fireEvent.click(check);

  const message = await screen.findByText(
    'Bereits vorhanden: Fiktive Fotobox-Stunde — 119,00 € Brutto, 19 % Steuer. Es wurde nichts erneut angelegt.',
  );
  expect(message.getAttribute('role')).toBe('status');
  expect(button).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: 'Bestand prüfen' })).toBeTruthy();
});

test('the stock check unlocks a new creation only after it showed nothing', async () => {
  let attempts = 0;
  const { writes, reads } = setup({
    post: (body) => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('network'))
        : Response.json({ ...body, id: 'p-2', version: 1 }, { status: 201 });
    },
    stock: () => Response.json([]),
  });
  const button = renderAction();
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(button).toHaveProperty('disabled', true);

  fireEvent.click(screen.getByRole('button', { name: 'Bestand prüfen' }));
  await screen.findByText(
    'Kein identisches Produkt gefunden. Die Anlage kann erneut gestartet werden.',
  );
  expect(reads()).toBe(1);
  expect(writes).toHaveLength(1);
  expect(button).toHaveProperty('disabled', false);

  fireEvent.click(button);
  await screen.findByText('Als Produkt gespeichert: Fiktive Fotobox-Stunde.');
  expect(writes).toHaveLength(2);
});

test('a failed stock check keeps the unsure state and asks for another check', async () => {
  setup({
    post: () => Promise.reject(new Error('network')),
    stock: () => Response.json({ error: 'unavailable' }, { status: 503 }),
  });
  const button = renderAction();
  fireEvent.click(button);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Bestand prüfen' }));

  expect((await screen.findByRole('alert')).textContent).toBe(
    'Bestand konnte nicht geprüft werden. Bitte erneut prüfen.',
  );
  expect(button).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Bestand prüfen' })).toBeTruthy();
});

test('invalid position values are refused before any request', async () => {
  const { writes } = setup();

  renderAction({ description: '   ' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain(
    'Die Position braucht eine Beschreibung',
  );

  cleanup();
  renderAction({ description: 'x'.repeat(121) });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain(
    'höchstens 120 Zeichen',
  );

  cleanup();
  renderAction({ unit: ' ' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain(
    'Die Einheit fehlt',
  );

  cleanup();
  renderAction({ price: '1,234' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain(
    'Der Einzelpreis ist ungültig',
  );

  cleanup();
  renderAction({ tax: '101.00' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain(
    'Der Steuersatz ist ungültig',
  );

  cleanup();
  renderAction({ infoText: 'y'.repeat(2001) });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain(
    'Der Infotext ist zu lang',
  );

  expect(writes).toHaveLength(0);
});

test('a confirmed product is not created again from the same unchanged values', async () => {
  const { writes } = setup();
  const button = renderAction();
  fireEvent.click(button);
  await screen.findByText('Als Produkt gespeichert: Fiktive Fotobox-Stunde.');
  expect(button).toHaveProperty('disabled', true);
  fireEvent.click(button);
  expect(writes).toHaveLength(1);
});

test('changed values clear an old success or rejection instead of naming the wrong product', async () => {
  const { writes } = setup();
  const view = render(
    <SavePositionAsProduct
      label="Position 1"
      csrfToken="fictional-csrf"
      position={position}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  await screen.findByText('Als Produkt gespeichert: Fiktive Fotobox-Stunde.');

  view.rerender(
    <SavePositionAsProduct
      label="Position 1"
      csrfToken="fictional-csrf"
      position={{ ...position, description: 'Fiktive zweite Leistung' }}
    />,
  );
  expect(screen.queryByText(/Als Produkt gespeichert/)).toBeNull();
  expect(writes).toHaveLength(1);
});

test('an unresolved attempt stays locked even when the row values change', async () => {
  setup({ post: () => Promise.reject(new Error('network')) });
  const view = render(
    <SavePositionAsProduct
      label="Position 1"
      csrfToken="fictional-csrf"
      position={position}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  await screen.findByRole('alert');

  view.rerender(
    <SavePositionAsProduct
      label="Position 1"
      csrfToken="fictional-csrf"
      position={{ ...position, description: 'Fiktive zweite Leistung' }}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  ).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Bestand prüfen' })).toBeTruthy();
});

test('a non-numeric tax and a server failure stay honest', async () => {
  const { writes } = setup();
  renderAction({ tax: 'abc' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Position 1 als Produkt speichern' }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Der Steuersatz ist ungültig',
  );
  expect(writes).toHaveLength(0);

  cleanup();
  setup({ post: () => Response.json({}, { status: 503 }) });
  const button = renderAction();
  fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Ausgang unklar.',
  );
  expect(button).toHaveProperty('disabled', true);
});

test('an unreadable stock answer is never mistaken for a hit', async () => {
  setup({
    post: () => Promise.reject(new Error('network')),
    stock: () => Response.json([{ id: 'broken' }, null, 'unexpected']),
  });
  const button = renderAction();
  fireEvent.click(button);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Bestand prüfen' }));

  expect(
    (await screen.findByText(/Kein identisches Produkt gefunden/)).textContent,
  ).toContain('erneut gestartet werden');
  expect(button).toHaveProperty('disabled', false);
});
