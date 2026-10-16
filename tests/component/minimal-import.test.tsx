import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportPanel } from '../../apps/admin/src/ImportPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function stubPreview(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url === '/api/v1/imports/bookitup' && !init
      ? Promise.resolve(
          Response.json({
            checkedAt: '2030-01-01T00:00:00Z',
            counts: {},
            mappings: [],
            promises: [],
            pendingPromises: 0,
          }),
        )
      : fetcher(url, init),
  );
}
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
  stubPreview(fetcher);
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
  stubPreview(fetcher);
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
    stubPreview(fetcher);
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
    expect(
      (
        screen.getByRole('button', {
          name: 'Importvorschau prüfen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  },
);

const transfer = {
  applied: false,
  pendingPromises: 1,
  counts: {
    contacts: { created: 1, bound: 0, updated: 0, unchanged: 0, excluded: 0 },
  },
};
const validReport = { ...report, valid: true, errors: [], warnings: [] };
const confirmation =
  'Mengen, Zuordnungen und Änderungen geprüft; diese Daten jetzt übernehmen';
async function ready() {
  submit(
    JSON.stringify({
      contacts: [
        { externalId: 'fictional-contact', data: { name: 'Fictional Person' } },
      ],
    }),
  );
  await screen.findByText(
    'Vorschau geprüft. Es wurden keine Daten übernommen.',
  );
}
async function dryRun() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Transaktionalen Probelauf starten' }),
  );
  await screen.findByText(
    'Transaktionaler Probelauf bestanden. Alle Änderungen wurden zurückgenommen.',
  );
}
test('transfer requires a successful dry-run and explicit approval, then refreshes imported data', async () => {
  const onImported = vi.fn();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/preview')
      ? Response.json(validReport)
      : Response.json({
          ...transfer,
          applied: JSON.parse(init!.body as string).mode === 'apply',
        }),
  );
  stubPreview(fetcher);
  render(<ImportPanel csrfToken="fictional-csrf" onImported={onImported} />);
  const apply = screen.getByRole('button', {
    name: 'Geprüfte Daten übernehmen',
  }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  await ready();
  await dryRun();
  expect(apply.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(confirmation));
  expect(apply.disabled).toBe(false);
  fireEvent.click(apply);
  await screen.findByText(
    'Daten übernommen. Altzusagen benötigen weiterhin Ressourcenprüfung.',
  );
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(apply.disabled).toBe(true);
  expect(
    JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string),
  ).toMatchObject({ mode: 'apply', allowUpdates: false, decisions: [] });
});

test('changes to data, update permission and a renewed preview invalidate transfer approval', async () => {
  const fetcher = vi.fn(async (url: string) =>
    Response.json(url.endsWith('/preview') ? validReport : transfer),
  );
  stubPreview(fetcher);
  render(<ImportPanel csrfToken="fictional" />);
  await ready();
  await dryRun();
  fireEvent.click(screen.getByLabelText(confirmation));
  fireEvent.click(screen.getByLabelText(/Geprüfte Quelldaten dürfen/));
  expect(
    (screen.getByLabelText(confirmation) as HTMLInputElement).disabled,
  ).toBe(true);
  await dryRun();
  fireEvent.click(
    screen.getByRole('button', { name: 'Importvorschau prüfen' }),
  );
  await screen.findByText(
    'Vorschau geprüft. Es wurden keine Daten übernommen.',
  );
  expect(
    (screen.getByLabelText(confirmation) as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Normalisierte Importdaten'), {
    target: { value: '{}' },
  });
  expect(
    (screen.getByLabelText(/Geprüfte Quelldaten dürfen/) as HTMLInputElement)
      .checked,
  ).toBe(false);
});

test.each(['create', 'bind'])(
  'duplicate decisions are explicit and included in the next %s dry-run',
  async (action) => {
    let attempts = 0;
    const fetcher = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async (url: string) => {
      if (url.endsWith('/preview')) return Response.json(validReport);
      if (url.endsWith('/contacts'))
        return Response.json([
          {
            id: 'fictional-target',
            name: '<img src=x onerror=bad()> Fictional existing',
          },
        ]);
      return ++attempts === 1
        ? Response.json(
            {
              error: 'duplicate_review_required',
              section: 'contacts',
              row: 1,
              candidates: [{ id: 'fictional-target', version: 2 }],
            },
            { status: 409 },
          )
        : Response.json(transfer);
    });
    stubPreview(fetcher);
    render(<ImportPanel csrfToken="fictional" />);
    await ready();
    fireEvent.click(
      screen.getByRole('button', { name: 'Transaktionalen Probelauf starten' }),
    );
    await screen.findByRole('group', { name: 'Dublettenentscheidung' });
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name:
          action === 'bind'
            ? /Verknüpfen:.*Fictional existing/
            : 'Bewusst eigenständig anlegen',
      }),
    );
    if (action === 'bind')
      fireEvent.click(screen.getByLabelText(/Geprüfte Quelldaten dürfen/));
    await dryRun();
    expect(
      JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).decisions,
    ).toEqual([
      {
        section: 'contacts',
        externalId: 'fictional-contact',
        action,
        ...(action === 'bind'
          ? { targetId: 'fictional-target', version: 2 }
          : {}),
      },
    ]);
  },
);

test.each(['offline', 'shape', 'server'])(
  'failed %s transfer leaves no approval and uncertain apply refreshes the state',
  async (failure) => {
    let fail = false;
    const onImported = vi.fn();
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/preview')) return Response.json(validReport);
      if (!fail) return Response.json(transfer);
      if (failure === 'offline') throw Error('fictional-private');
      return failure === 'shape'
        ? Response.json({})
        : Response.json({ error: 'unknown' }, { status: 500 });
    });
    stubPreview(fetcher);
    render(<ImportPanel csrfToken="fictional" onImported={onImported} />);
    await ready();
    await dryRun();
    fail = true;
    fireEvent.click(screen.getByLabelText(confirmation));
    fireEvent.click(
      screen.getByRole('button', { name: 'Geprüfte Daten übernehmen' }),
    );
    await screen.findByText(/Übernahme fehlgeschlagen/);
    expect(
      (screen.getByLabelText(confirmation) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('fictional-private')).toBeNull();
  },
);

test.each(['missing', 'unavailable'])(
  'duplicate target %s cannot authorize a stale binding',
  async (state) => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/preview')) return Response.json(validReport);
      if (url.endsWith('/events'))
        return state === 'missing'
          ? Response.json({ events: [] })
          : new Response(null, { status: 503 });
      return Response.json(
        {
          error: 'duplicate_review_required',
          section: 'events',
          row: 1,
          candidates: [{ id: 'fictional-gone', version: 1 }],
        },
        { status: 409 },
      );
    });
    stubPreview(fetcher);
    render(<ImportPanel csrfToken="fictional" />);
    await ready();
    fireEvent.click(
      screen.getByRole('button', { name: 'Transaktionalen Probelauf starten' }),
    );
    if (state === 'missing')
      expect(
        (
          (await screen.findByRole('button', {
            name: /Verknüpfen:.*Zieldatensatz nicht mehr vorhanden/,
          })) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    else await screen.findByText(/Übernahme fehlgeschlagen/);
    expect(
      (screen.getByLabelText(confirmation) as HTMLInputElement).disabled,
    ).toBe(true);
  },
);
