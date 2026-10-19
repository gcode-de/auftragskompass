import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentNumbersPanel } from '../../apps/admin/src/DocumentNumbersPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const sequence = {
  kind: 'offer',
  pattern: 'AN-{YYYY}-{SEQ}',
  minLength: 4,
  nextValue: 7,
  version: 2,
};
function setup(
  reply?: (url: string, body: Record<string, unknown>) => Response,
) {
  const calls: {
    url: string;
    method: string;
    body?: Record<string, unknown>;
  }[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/preview')) {
      calls.push({ url, method: 'GET' });
      return Response.json({ number: 'AN-2030-0007' });
    }
    if (!options) return Response.json([sequence]);
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    calls.push({ url, method: String(options.method), body });
    if (reply) return reply(url, body);
    return Response.json({ ...sequence, ...body });
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}
test('a configured sequence loads its values, previews without consuming and saves with its version', async () => {
  const calls = setup();
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  expect(
    ((await screen.findByLabelText('Muster (Angebot)')) as HTMLInputElement)
      .value,
  ).toBe('AN-{YYYY}-{SEQ}');
  expect(
    (screen.getByLabelText('Nächste Nummer (Angebot)') as HTMLInputElement)
      .value,
  ).toBe('7');
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau (Angebot)' }));
  expect(await screen.findByText('Nächste Nummer: AN-2030-0007')).toBeTruthy();
  expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Nächste Nummer (Angebot)'), {
    target: { value: '40' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Nummernkreis speichern (Angebot)' }),
  );
  await screen.findByText('Gespeichert.');
  const save = calls.find((call) => call.method === 'PUT')!;
  expect(save.url).toBe('/api/v1/document-numbers/offer');
  expect(save.body).toEqual({
    pattern: 'AN-{YYYY}-{SEQ}',
    minLength: 4,
    nextValue: 40,
    version: 2,
  });
  expect(
    (
      screen.getByRole('button', {
        name: 'Vorschau (Rechnung)',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
test('an unconfigured kind is created with its own pattern', async () => {
  const calls = setup();
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  await screen.findByLabelText('Muster (Angebot)');
  fireEvent.change(screen.getByLabelText('Muster (Rechnung)'), {
    target: { value: 'RE-{YYYY}-{SEQ}' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Nummernkreis speichern (Rechnung)' }),
  );
  await screen.findByText('Gespeichert.');
  const save = calls.find((call) => call.method === 'POST')!;
  expect(save.url).toBe('/api/v1/document-numbers');
  expect(save.body).toEqual({
    pattern: 'RE-{YYYY}-{SEQ}',
    minLength: 4,
    nextValue: 1,
    kind: 'invoice',
  });
});
test('an invalid pattern and a stale version are explained to the operator', async () => {
  setup((_url, body) =>
    Response.json(
      { error: body.nextValue === 40 ? 'conflict' : 'invalid_pattern' },
      { status: 400 },
    ),
  );
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  await screen.findByLabelText('Muster (Angebot)');
  fireEvent.change(screen.getByLabelText('Muster (Angebot)'), {
    target: { value: 'AN-{WW}-{SEQ}' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Nummernkreis speichern (Angebot)' }),
  );
  expect(await screen.findByText(/Muster prüfen/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Nächste Nummer (Angebot)'), {
    target: { value: '40' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Nummernkreis speichern (Angebot)' }),
  );
  expect(await screen.findByText(/Inzwischen geändert/)).toBeTruthy();
});
test('a missing sequence reports that a preview needs saving first', async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/preview'))
      return Response.json({ error: 'not_configured' }, { status: 404 });
    if (options) return Response.json(sequence);
    return Response.json([sequence]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  await screen.findByLabelText('Muster (Angebot)');
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau (Angebot)' }));
  expect(
    await screen.findByText(/Noch kein Nummernkreis eingerichtet/),
  ).toBeTruthy();
});
test('a failed list is reported without losing the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
  render(<DocumentNumbersPanel csrfToken="fictional-csrf" />);
  expect(
    await screen.findByText('Nummernkreise konnten nicht geladen werden.'),
  ).toBeTruthy();
  expect(screen.getByLabelText('Muster (Angebot)')).toBeTruthy();
});
