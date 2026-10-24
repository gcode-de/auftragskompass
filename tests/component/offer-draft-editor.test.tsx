import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { EventDocuments } from '../../apps/admin/src/EventDocuments.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type TestLine = {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
};

const draft = {
    id: 'doc-1',
    kind: 'offer',
    templateId: 'tpl-1',
    eventId: 'event-1',
    contactId: 'contact-1',
    number: null,
    state: 'draft' as const,
    issuedAt: '2030-10-26T10:00:00Z',
    finalizedAt: null,
    netMinor: 20925,
    taxMinor: 3975,
    grossMinor: 24900,
    version: 1,
  },
  finalized = {
    ...draft,
    number: 'AN-2030-0001',
    state: 'final' as const,
    finalizedAt: '2030-10-26T10:05:00Z',
    version: 3,
  },
  content = {
    subject: 'Fiktives Angebot',
    introText: 'Guten Tag, hier ein Beispiel.',
    outroText: 'Viele Grüße',
    validityDays: 14,
  },
  line: TestLine = {
    id: 'line-1',
    position: 0,
    productId: null,
    description: 'Fiktives Fotobox-Paket',
    quantity: 1,
    unit: 'Pauschale',
    unitPriceMinor: 24900,
    taxBasisPoints: 1900,
    discountBasisPoints: 0,
  },
  template = {
    id: 'tpl-1',
    kind: 'offer',
    name: 'Fiktive Angebotsvorlage',
    state: 'active',
    ...content,
  };

function detail(values: typeof content | null = content, version = 1) {
  return {
    ...draft,
    version,
    subject: values?.subject ?? null,
    introText: values?.introText ?? null,
    outroText: values?.outroText ?? null,
    validityDays: values?.validityDays ?? null,
    lines: [line],
  };
}

function setup(
  options: {
    documents?: unknown[];
    initial?: ReturnType<typeof detail>;
    template?: typeof template | null;
    put?: (body: Record<string, unknown>) => Response | Promise<Response>;
    detailGet?: () => Response | Promise<Response>;
    finalize?: (body: unknown) => Response;
  } = {},
) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let current = options.initial ?? detail(),
    getAttempts = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET',
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.startsWith('/api/v1/documents?eventId='))
      return Response.json(
        options.documents ?? [
          {
            ...draft,
            version: current.version,
            netMinor: current.netMinor,
            taxMinor: current.taxMinor,
            grossMinor: current.grossMinor,
          },
        ],
      );
    if (url === '/api/v1/document-templates')
      return Response.json(
        options.template === null ? [] : [options.template ?? template],
      );
    if (url === '/api/v1/documents/doc-1' && method === 'GET') {
      getAttempts += 1;
      if (options.detailGet) return options.detailGet();
      return Response.json(current);
    }
    if (url === '/api/v1/documents/doc-1/draft' && method === 'PUT') {
      if (options.put) {
        const result = await options.put(body as Record<string, unknown>);
        if (result.ok)
          current = (await result.clone().json()) as typeof current;
        return result;
      }
      current = {
        ...current,
        ...body,
        version: current.version + 1,
        lines: (body.lines as Array<Record<string, unknown>>).map(
          (entry, position) => ({
            ...entry,
            id: current.lines[position]?.id ?? `line-created-${position}`,
            position,
          }),
        ),
      };
      return Response.json(current);
    }
    if (url === '/api/v1/documents/doc-1/finalize' && method === 'POST') {
      if (options.finalize) return options.finalize(body);
      return Response.json(finalized);
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher, getAttempts };
}

const props = {
  eventId: 'event-1',
  contactId: 'contact-1',
  timeZone: 'Europe/Berlin',
  csrfToken: 'fictional-csrf',
};
function fieldValue(label: string) {
  return (
    screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement
  ).value;
}

test('a draft opens focused with editable saved positions and previews only persisted values', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );

  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktives Angebot');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Betreff')),
  );
  expect(fieldValue('Einleitung')).toBe('Guten Tag, hier ein Beispiel.');
  expect(fieldValue('Schlusstext')).toBe('Viele Grüße');
  expect(fieldValue('Gültigkeit in Tagen')).toBe('14');
  const firstPosition = screen.getByRole('group', { name: 'Position 1' });
  expect(
    (
      screen.getByLabelText('Beschreibung', {
        selector: 'input',
      }) as HTMLInputElement
    ).value,
  ).toBe('Fiktives Fotobox-Paket');
  expect(
    (screen.getByLabelText('Einzelpreis (Brutto) in Euro') as HTMLInputElement)
      .value,
  ).toBe('249.00');
  expect(firstPosition).toBeTruthy();
  expect(screen.queryByText(/Positionsbearbeitung folgt separat/)).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Vorschau öffnen' }).getAttribute('href'),
  ).toBe('/api/v1/documents/doc-1/preview');

  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Noch nicht gespeichert' },
  });
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  expect(
    screen.getByText('Bitte zuerst speichern, damit die Vorschau stimmt.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toHaveProperty('disabled', true);
  expect(hasUnsavedChanges()).toBe(true);
  expect(calls.some((call) => call.url.endsWith('/preview'))).toBe(false);
});

test('existing and free positions save exactly, removal/addition persist, and row totals refresh without a detail refetch', async () => {
  const primaryLine = {
      ...line,
      productId: '22222222-2222-4222-8222-222222222222',
    },
    secondLine = {
      ...line,
      id: 'line-2',
      position: 1,
      productId: '11111111-1111-4111-8111-111111111111',
      description: 'Fiktive Zusatzleistung',
      unitPriceMinor: 5000,
    },
    savedLines = [
      {
        productId: '22222222-2222-4222-8222-222222222222',
        description: 'Fiktives aktualisiertes Paket',
        quantity: 2,
        unit: 'Pauschale',
        unitPriceMinor: 123456,
        taxBasisPoints: 770,
        discountBasisPoints: 1250,
      },
      {
        productId: null,
        description: 'Fiktiver Aufbau',
        quantity: 3,
        unit: 'Stunde',
        unitPriceMinor: 2500,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ];
  const { calls } = setup({
    initial: { ...detail(), lines: [primaryLine, secondLine] },
    put: (body) => {
      const returned = {
        ...detail(),
        ...body,
        version: 2,
        netMinor: 23000,
        taxMinor: 4500,
        grossMinor: 27500,
        lines: (body.lines as typeof savedLines).map((entry, position) => ({
          ...entry,
          id: position === 0 ? 'line-1' : 'line-3',
          position,
        })),
      };
      return Response.json(returned);
    },
  });
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByLabelText('Betreff');
  const first = screen.getByRole('group', { name: 'Position 1' });
  fireEvent.change(within(first).getByLabelText('Beschreibung'), {
    target: { value: 'Fiktives aktualisiertes Paket' },
  });
  fireEvent.change(within(first).getByLabelText('Menge'), {
    target: { value: '2' },
  });
  fireEvent.change(
    within(first).getByLabelText('Einzelpreis (Brutto) in Euro'),
    { target: { value: '1234,56' } },
  );
  fireEvent.change(within(first).getByLabelText('Steuer in Prozent'), {
    target: { value: '7,70' },
  });
  fireEvent.change(within(first).getByLabelText('Rabatt in Prozent'), {
    target: { value: '12,50' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Position 2 entfernen' }));
  expect(document.activeElement).toBe(
    within(first).getByLabelText('Beschreibung'),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Freie Position hinzufügen' }),
  );
  const second = screen.getByRole('group', { name: 'Position 2' });
  expect(document.activeElement).toBe(
    within(second).getByLabelText('Beschreibung'),
  );
  fireEvent.change(within(second).getByLabelText('Beschreibung'), {
    target: { value: 'Fiktiver Aufbau' },
  });
  fireEvent.change(within(second).getByLabelText('Menge'), {
    target: { value: '3' },
  });
  fireEvent.change(within(second).getByLabelText('Einheit'), {
    target: { value: 'Stunde' },
  });
  fireEvent.change(
    within(second).getByLabelText('Einzelpreis (Brutto) in Euro'),
    { target: { value: '25' } },
  );

  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      version: 1,
      ...content,
      lines: savedLines,
    }),
  );
  await waitFor(() =>
    expect(document.querySelector('.document-meta')?.textContent).toContain(
      '275,00',
    ),
  );
  expect(
    calls.filter((call) => call.url === '/api/v1/documents/doc-1'),
  ).toHaveLength(1);
  expect(
    calls.filter(
      (call) =>
        call.url.startsWith('/api/v1/documents?eventId=') &&
        call.method === 'GET',
    ),
  ).toHaveLength(1);
  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const persistedPosition = await screen.findByRole('group', {
    name: 'Position 2',
  });
  expect(
    within(persistedPosition).getByLabelText('Beschreibung'),
  ).toHaveProperty('value', 'Fiktiver Aufbau');
});

test('removing the first of three positions focuses the first surviving description', async () => {
  const secondLine = {
      ...line,
      id: 'line-2',
      position: 1,
      description: 'Zweite Leistung',
    },
    thirdLine = {
      ...line,
      id: 'line-3',
      position: 2,
      description: 'Dritte Leistung',
    };
  setup({ initial: { ...detail(), lines: [line, secondLine, thirdLine] } });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByRole('group', { name: 'Position 3' });
  fireEvent.click(screen.getByRole('button', { name: 'Position 1 entfernen' }));
  const remaining = screen.getByRole('group', { name: 'Position 1' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(remaining).getByLabelText('Beschreibung'),
    ),
  );
  expect(within(remaining).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Zweite Leistung',
  );
});

test('removing the middle of three positions focuses the next surviving description', async () => {
  const secondLine = {
      ...line,
      id: 'line-2',
      position: 1,
      description: 'Zweite Leistung',
    },
    thirdLine = {
      ...line,
      id: 'line-3',
      position: 2,
      description: 'Dritte Leistung',
    };
  setup({ initial: { ...detail(), lines: [line, secondLine, thirdLine] } });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  await screen.findByRole('group', { name: 'Position 3' });
  fireEvent.click(screen.getByRole('button', { name: 'Position 2 entfernen' }));
  const remaining = screen.getByRole('group', { name: 'Position 2' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(remaining).getByLabelText('Beschreibung'),
    ),
  );
  expect(within(remaining).getByLabelText('Beschreibung')).toHaveProperty(
    'value',
    'Dritte Leistung',
  );
});

test('saving sends all values with the loaded version, survives reload, and finalizes that version', async () => {
  const { calls } = setup();
  const view = render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  await screen.findByLabelText('Betreff');
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktive aktualisierte Betreffzeile' },
  });
  fireEvent.change(screen.getByLabelText('Einleitung'), {
    target: { value: 'Fiktive aktualisierte Einleitung' },
  });
  fireEvent.change(screen.getByLabelText('Schlusstext'), {
    target: { value: 'Fiktiver aktualisierter Schluss' },
  });
  fireEvent.change(screen.getByLabelText('Gültigkeit in Tagen'), {
    target: { value: '30' },
  });
  const saveButton = screen.getByRole('button', {
    name: 'Änderungen speichern',
  });
  saveButton.focus();
  fireEvent.click(saveButton);

  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      version: 1,
      subject: 'Fiktive aktualisierte Betreffzeile',
      introText: 'Fiktive aktualisierte Einleitung',
      outroText: 'Fiktiver aktualisierter Schluss',
      validityDays: 30,
      lines: [
        {
          productId: null,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceMinor: line.unitPriceMinor,
          taxBasisPoints: line.taxBasisPoints,
          discountBasisPoints: line.discountBasisPoints,
        },
      ],
    }),
  );
  expect(await screen.findByText('Änderungen gespeichert.')).toBeTruthy();
  expect(document.activeElement).toBe(saveButton);
  expect(hasUnsavedChanges()).toBe(false);
  expect(
    screen.getByRole('link', { name: 'Vorschau öffnen' }).getAttribute('href'),
  ).toBe('/api/v1/documents/doc-1/preview');

  view.unmount();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktive aktualisierte Betreffzeile');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Angebot Entwurf finalisieren',
    }),
  );
  await waitFor(() =>
    expect(calls.find((call) => call.url.endsWith('/finalize'))?.body).toEqual({
      version: 2,
    }),
  );
});

test('position fields stay disabled while a save is pending and re-enable after success', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { calls } = setup({ put: () => pending });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.change(subject, { target: { value: 'Fiktiver neuer Betreff' } });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'PUT')).toBe(true),
  );
  expect(screen.getByRole('group', { name: 'Position 1' })).toHaveProperty(
    'disabled',
    true,
  );
  finish(
    Response.json({
      ...detail(),
      subject: 'Fiktiver neuer Betreff',
      version: 2,
    }),
  );
  await screen.findByText('Änderungen gespeichert.');
  expect(screen.getByRole('group', { name: 'Position 1' })).toHaveProperty(
    'disabled',
    false,
  );
});

test('legacy draft values are initialized from the current template only in the editor and disclosed', async () => {
  const archivedTemplate = { ...template, state: 'archived' };
  const { calls } = setup({
    initial: detail(null),
    template: archivedTemplate,
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktives Angebot');
  expect(
    screen.getByText(/Dieser ältere Entwurf enthält keine gespeicherten Texte/),
  ).toBeTruthy();
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'PUT')).toBe(true),
  );
  expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
    version: 1,
    ...content,
    lines: [
      {
        productId: null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceMinor: line.unitPriceMinor,
        taxBasisPoints: line.taxBasisPoints,
        discountBasisPoints: line.discountBasisPoints,
      },
    ],
  });
});

test('malformed detail data is rejected without rendering a blank editor', async () => {
  setup({
    detailGet: () => Response.json({ ...detail(), subject: undefined }),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  expect(
    await screen.findByText(/Entwurf konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Entwurf erneut laden' }),
  ).toBeTruthy();
});

test('an invalid successful PUT response is treated as uncertain and keeps the input', async () => {
  const { calls } = setup({ put: () => Response.json(detail(null)) });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  fireEvent.change(await screen.findByLabelText('Betreff'), {
    target: { value: 'Fiktive Eingabe bleibt sichtbar' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText(/Speicherstatus ist unklar/)).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Fiktive Eingabe bleibt sichtbar');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test('an unchanged legacy snapshot needs an explicit save, and a second Edit click cannot unlock finalization', async () => {
  setup({ initial: detail(null) });
  render(<EventDocuments {...props} />);
  const edit = await screen.findByRole('button', {
    name: 'Angebot Entwurf bearbeiten',
  });
  fireEvent.click(edit);
  await screen.findByLabelText('Betreff');
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', false);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toHaveProperty('disabled', true),
  );

  fireEvent.click(edit);
  expect(edit).toHaveProperty('disabled', true);
  expect(
    screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
  ).toHaveProperty('disabled', true);
});

test('legacy text stays unavailable when its archived template is missing', async () => {
  setup({ initial: detail(null), template: null });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  expect(
    await screen.findByText(/Entwurf konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
});

test('field limits and validity range are explicit and invalid days block saving', async () => {
  setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const subject = await screen.findByLabelText('Betreff'),
    intro = screen.getByLabelText('Einleitung'),
    outro = screen.getByLabelText('Schlusstext'),
    validity = screen.getByLabelText('Gültigkeit in Tagen');
  expect(subject).toHaveProperty('maxLength', 200);
  expect(intro).toHaveProperty('maxLength', 4000);
  expect(outro).toHaveProperty('maxLength', 4000);
  expect(validity).toHaveProperty('min', '1');
  expect(validity).toHaveProperty('max', '365');
  fireEvent.change(validity, { target: { value: '366' } });
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', true);
});

test('blank and invalid position values block saving without sending a request', async () => {
  const { calls } = setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
  const position = await screen.findByRole('group', { name: 'Position 1' });
  const edits = [
    ['Beschreibung', ''],
    ['Beschreibung', 'Fiktives Fotobox-Paket'],
    ['Menge', '-1'],
    ['Menge', '1'],
    ['Einzelpreis (Brutto) in Euro', '-0,01'],
    ['Einzelpreis (Brutto) in Euro', '249,00'],
    ['Steuer in Prozent', '100,01'],
    ['Steuer in Prozent', '19'],
    ['Rabatt in Prozent', 'abc'],
    ['Rabatt in Prozent', '0'],
    ['Einheit', ''],
    ['Einheit', 'Pauschale'],
  ] as const;
  for (const [label, value] of edits) {
    fireEvent.change(within(position).getByLabelText(label), {
      target: { value },
    });
    if (
      !value ||
      value.startsWith('-') ||
      value === '100,01' ||
      value === 'abc'
    ) {
      expect(
        screen.getByRole('button', { name: 'Änderungen speichern' }),
      ).toHaveProperty('disabled', true);
      fireEvent.click(
        screen.getByRole('button', { name: 'Änderungen speichern' }),
      );
    }
  }
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});

test('large stored totals and prices retain every cent in the editor and document row', async () => {
  const large = Number.MAX_SAFE_INTEGER;
  setup({
    initial: {
      ...detail(),
      grossMinor: large,
      lines: [{ ...line, unitPriceMinor: large }],
    },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const total = await screen.findByText(/Gesamtbetrag/);
  expect(total.textContent).toContain('90.071.992.547.409,91 €');
  await waitFor(() =>
    expect(screen.getAllByText(/90\.071\.992\.547\.409,91/)).toHaveLength(2),
  );
});

test('dirty editor keeps route protection and Escape cancellation until discard is confirmed', async () => {
  setup();
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.change(subject, {
    target: { value: 'Fiktiver ungespeicherter Text' },
  });
  expect(hasUnsavedChanges()).toBe(true);

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.keyDown(subject, { key: 'Escape' });
  expect(screen.getByLabelText('Betreff')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Bearbeitung schließen' }),
  );
  expect(screen.getByLabelText('Betreff')).toBeTruthy();

  confirm.mockReturnValue(true);
  fireEvent.keyDown(screen.getByLabelText('Betreff'), { key: 'Escape' });
  expect(screen.queryByLabelText('Betreff')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Angebot Entwurf bearbeiten' }),
  );
});

test('one dirty offer editor disables finalization actions on every draft row', async () => {
  setup({ documents: [draft, { ...draft, id: 'doc-2' }] });
  render(<EventDocuments {...props} />);
  const editButtons = await screen.findAllByRole('button', {
    name: 'Angebot Entwurf bearbeiten',
  });
  fireEvent.click(editButtons[0]!);
  fireEvent.change(await screen.findByLabelText('Betreff'), {
    target: { value: 'Fiktiv, noch nicht gespeichert' },
  });
  const finalizeButtons = screen.getAllByRole('button', {
    name: /Angebot Entwurf finalisieren/,
  });
  expect(finalizeButtons).toHaveLength(2);
  expect(
    finalizeButtons.every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
});

test('a conflict preserves the input and a failed explicit reload never replaces it', async () => {
  let failGet = false;
  const { calls } = setup({
    put: () => Response.json({ error: 'conflict' }, { status: 409 }),
    detailGet: () =>
      failGet ? new Response(null, { status: 503 }) : Response.json(detail()),
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  const subject = await screen.findByLabelText('Betreff');
  fireEvent.change(subject, {
    target: { value: 'Eigener Text bleibt erhalten' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText(/zwischenzeitlich geändert/)).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Eigener Text bleibt erhalten');

  failGet = true;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf neu laden' }));
  expect(
    await screen.findByText(/Entwurf konnte nicht geladen werden/),
  ).toBeTruthy();
  expect(fieldValue('Betreff')).toBe('Eigener Text bleibt erhalten');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toHaveProperty('disabled', true),
  );
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
});

test('an uncertain save result offers reload and prevents blind resubmission', async () => {
  let loseReply = true;
  const { calls } = setup({
    put: async () => {
      if (loseReply) {
        loseReply = false;
        throw new Error('connection lost');
      }
      return Response.json(detail());
    },
  });
  render(<EventDocuments {...props} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Angebot Entwurf bearbeiten',
    }),
  );
  fireEvent.change(await screen.findByLabelText('Betreff'), {
    target: { value: 'Fiktiv, Antwort verloren' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText(/Speicherstatus ist unklar/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Änderungen speichern' }),
  ).toHaveProperty('disabled', true);
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Fiktives Angebot' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Angebot Entwurf finalisieren' }),
    ).toHaveProperty('disabled', true),
  );
  expect(screen.queryByRole('link', { name: 'Vorschau öffnen' })).toBeNull();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf neu laden' }));
  await screen.findByLabelText('Betreff');
  expect(fieldValue('Betreff')).toBe('Fiktives Angebot');
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});
