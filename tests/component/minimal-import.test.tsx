import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportPanel } from '../../apps/admin/src/ImportPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const report = {
  valid: false,
  checkedAt: '2030-10-26T12:00:00Z',
  timeZone: 'Europe/Berlin',
  pendingPromises: 1,
  counts: {
    contacts: { total: 2, accepted: 1, excluded: 0, invalid: 1 },
    events: { total: 2, accepted: 1, excluded: 1, invalid: 0 },
  },
  errors: [{ section: 'contacts', row: 2, code: 'invalid_fields' }],
  warnings: [{ section: 'events', row: 2, code: 'past_event_excluded' }],
  events: [
    {
      row: 1,
      status: 'booked',
      sourceStatus: 'Gebucht',
      requiresResourceReview: true,
    },
    {
      row: 3,
      status: 'option',
      sourceStatus: 'Option',
      requiresResourceReview: false,
    },
  ],
};
function submit(value = '{}') {
  fireEvent.change(screen.getByLabelText('Normalisierte Importdaten'), {
    target: { value },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Importvorschau prüfen' }),
  );
}
test('preview sends protected JSON and shows counts, source promises and actionable errors', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(report));
  vi.stubGlobal('fetch', fetcher);
  render(<ImportPanel csrfToken="fictional-csrf" />);
  submit();
  await screen.findByText(
    'Vorschau enthält Fehler. Es wurden keine Daten übernommen.',
  );
  expect(fetcher).toHaveBeenCalledWith('/api/v1/imports/bookitup/preview', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': 'fictional-csrf',
    },
    body: '{}',
  });
  expect(screen.getByRole('table', { name: 'Importmengen' })).toBeTruthy();
  expect(screen.getByText('Ungeprüfte Bestandszusage')).toBeTruthy();
  expect(screen.getByText(/Kontakte · Zeile 2: Felder/)).toBeTruthy();
  expect(screen.getByText(/Events · Zeile 2: Vergangenes/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Normalisierte Importdaten'), {
    target: { value: '{' },
  });
  expect(screen.queryByRole('table')).toBeNull();
});
test('invalid JSON remains local and valid empty results make no import claim', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      ...report,
      valid: true,
      errors: [],
      warnings: [],
      events: [],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<ImportPanel csrfToken="fictional" />);
  submit('{');
  await screen.findByText(/Ungültiges JSON/);
  expect(fetcher).not.toHaveBeenCalled();
  submit();
  await screen.findByText(
    'Vorschau geprüft. Es wurden keine Daten übernommen.',
  );
  expect(screen.getByText('Keine Fehler.')).toBeTruthy();
  expect(screen.getByText('Keine Hinweise.')).toBeTruthy();
});
test.each(['http', 'offline', 'shape'])(
  'preview failure %s clears previous report and permits retry',
  async (kind) => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(report));
    vi.stubGlobal('fetch', fetcher);
    render(<ImportPanel csrfToken="fictional" />);
    submit();
    await screen.findByRole('table', { name: 'Importmengen' });
    if (kind === 'offline')
      fetcher.mockRejectedValue(Error('private input must not be shown'));
    else
      fetcher.mockResolvedValue(
        kind === 'http'
          ? new Response(null, { status: 401 })
          : Response.json({}),
      );
    fireEvent.click(
      screen.getByRole('button', { name: 'Importvorschau prüfen' }),
    );
    await screen.findByText(/Vorschau fehlgeschlagen/);
    expect(screen.queryByRole('table')).toBeNull();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false,
    );
  },
);
