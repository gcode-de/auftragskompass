import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentTemplatesPanel } from '../../apps/admin/src/DocumentTemplatesPanel.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';

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
  reply: (body: Record<string, unknown>) => Response | Promise<Response> = () =>
    Response.json(template),
  readList: () => Response = () => Response.json([template]),
) {
  const writes: {
    url: string;
    method: string;
    body: Record<string, unknown>;
    headers: HeadersInit | undefined;
  }[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/products') return Response.json(products);
    if (!options) return readList();
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    writes.push({
      url,
      method: String(options.method),
      body,
      headers: options.headers,
    });
    return reply(body);
  });
  vi.stubGlobal('fetch', fetcher);
  return writes;
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
function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage anlegen' }));
}
test('templates load with their positions, save exact minor units and archive with the current version', async () => {
  let listReads = 0;
  const archived = {
    ...template,
    version: 2,
    state: 'archived',
    positions: [{ ...position, id: 'fictional-archived-position-0' }],
  };
  const writes = setup(
    (body) =>
      body.state === 'archived'
        ? archivedResponse(body)
        : Response.json(template),
    () => Response.json(listReads++ < 2 ? [template] : [archived]),
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
  expect(screen.getByText(/\{\{documentLink\}\}/)).toBeTruthy();
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
  const archiveButton = screen.getByRole('button', {
    name: 'Vorlage archivieren: Fictional offer',
  });
  archiveButton.focus();
  fireEvent.click(archiveButton);
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.body.state).toBe('archived');
  expect(writes[0]!.body.version).toBe(1);
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
      name: 'Vorlage bearbeiten: Fictional offer',
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

  const archiveButton = screen.getByRole('button', {
    name: 'Vorlage archivieren: Fictional offer',
  });
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
    screen
      .getByRole('button', { name: 'Vorlage archivieren: Fictional offer' })
      .hasAttribute('disabled'),
  ).toBe(true);
  expect(
    screen
      .getByRole('button', {
        name: 'Vorlage archivieren: Fictional other offer',
      })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional other offer',
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
      name: 'Vorlage archivieren: Fictional offer',
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

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );

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
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage archivieren: Fictional offer',
      }),
    );
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
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
  const archiveButton = screen.getByRole('button', {
    name: 'Vorlage archivieren: Fictional offer',
  });
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
      name: 'Vorlage archivieren: Fictional offer',
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
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
  const archiveButton = screen.getByRole('button', {
    name: 'Vorlage archivieren: Fictional offer',
  });
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
  const archiveButton = screen.getByRole('button', {
    name: 'Vorlage archivieren: Fictional offer',
  });
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
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
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Vorlage archivieren: Fictional offer',
      }),
    );
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
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.queryByLabelText('Bezeichnung')).toBeNull();
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage duplizieren: Fictional other offer',
    }),
  );
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Vorlage archivieren: Fictional offer',
    }),
  );
  expect(hasUnsavedChanges()).toBe(false);
  finish(
    archivedResponse({
      ...template,
      state: 'archived',
      version: template.version,
    }),
  );
  expect(
    await screen.findByText(/Vorlage archiviert\. Der Listenstand weicht ab/),
  ).toBeTruthy();
});

test('a successful delayed save does not steal focus from another control', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  setup(() => pending);
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
  finish(Response.json(template));
  await screen.findByText('Gespeichert.');
  expect(document.activeElement).toBe(external);
});
