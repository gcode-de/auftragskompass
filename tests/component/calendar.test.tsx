import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalendarPanel } from '../../apps/admin/src/CalendarPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function returnToApp() {
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
}
function calendarLoads(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(([url]) =>
    String(url).startsWith('/api/v1/calendar'),
  ).length;
}
const data = {
  pendingPromises: 0,
  date: '2030-10-27',
  view: 'day',
  timeZone: 'Europe/Berlin',
  from: '2030-10-27',
  to: '2030-10-27',
  previousDate: '2030-10-26',
  nextDate: '2030-10-28',
  days: [
    {
      date: '2030-10-27',
      startsAt: '2030-10-26T22:00:00Z',
      endsAt: '2030-10-27T23:00:00Z',
    },
  ],
  events: [
    {
      id: 'synthetic-event',
      name: 'Fictional calendar event',
      status: 'option',
      eventDate: '2030-10-27',
      startsAt: null,
      endsAt: null,
      eventType: 'Fictional type',
      contact: 'Fictional contact',
      location: 'Fictional venue',
    },
  ],
  units: [
    {
      id: 'synthetic-unit',
      name: 'Fictional box',
      code: 'SYNTH',
      ordinal: 1,
      enabled: true,
      blocked: false,
    },
  ],
  reservations: [
    {
      id: 'synthetic-hold',
      eventId: 'synthetic-event',
      eventName: 'Fictional calendar event',
      unitId: 'synthetic-unit',
      state: 'hold',
      startsAt: '2030-10-27T10:00:00Z',
      endsAt: '2030-10-27T12:00:00Z',
      baseStart: '2030-10-27T10:00:00Z',
      baseEnd: '2030-10-27T12:00:00Z',
      reason: '',
      conflict: true,
    },
  ],
};
test('calendar displays events, soft conflicts and resource periods and changes view/date', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(data));
  vi.stubGlobal('fetch', fetcher);
  render(<CalendarPanel />);
  await screen.findByRole('table', { name: 'Ressourcen-Zeitleiste' });
  expect(screen.getByRole('group', { name: 'Kalenderlegende' })).toBeTruthy();
  expect(
    screen.getAllByText(/Fictional calendar event/).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByText(/Fictional type.*Fictional contact.*Fictional venue/),
  ).toBeTruthy();
  expect(screen.getByText(/Konflikt: Vormerkung/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kalenderansicht'), {
    target: { value: 'month' },
  });
  await screen.findByRole('table', { name: 'Ressourcen-Zeitleiste' });
  expect(fetcher.mock.calls.at(-1)![0]).toContain('view=month');
});

test('calendar navigation, empty views, free and unavailable resources, and refresh failures are explicit', async () => {
  const fetcher = vi.fn().mockImplementation(async () =>
    Response.json({
      ...data,
      events: [],
      reservations: [],
      units: [
        ...data.units,
        { ...data.units[0]!, id: 'synthetic-blocked', blocked: true },
        { ...data.units[0]!, id: 'synthetic-inactive', enabled: false },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<CalendarPanel />);
  await screen.findByText('Keine Events in diesem Zeitraum.');
  expect(screen.getAllByText('Frei').length).toBeGreaterThan(0);
  expect(screen.getByText('Allgemein gesperrt')).toBeTruthy();
  expect(screen.getByText('Inaktive Einheit')).toBeTruthy();
  for (const [label, expected] of [
    ['Nächster Zeitraum', 'date=2030-10-28'],
    ['Vorheriger Zeitraum', 'date=2030-10-26'],
    ['Heute im Kalender', 'view=week'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await screen.findByText('Keine Events in diesem Zeitraum.');
    expect(fetcher.mock.calls.at(-1)![0]).toContain(expected);
  }
  fireEvent.change(screen.getByLabelText('Kalenderdatum'), {
    target: { value: '2030-12-01' },
  });
  await screen.findByText('Keine Events in diesem Zeitraum.');
  expect(fetcher.mock.calls.at(-1)![0]).toContain('date=2030-12-01');
  fetcher.mockResolvedValue(new Response(null, { status: 500 }));
  returnToApp();
  await screen.findByText(/Kalender konnte nicht geladen/);
  expect(
    screen.getByRole('table', { name: 'Ressourcen-Zeitleiste' }),
  ).toBeTruthy();
  fetcher.mockImplementation(async () => Response.json([]));
  fireEvent.click(
    screen.getByRole('button', { name: 'Kalender erneut laden' }),
  );
  await screen.findByText(/Kalender konnte nicht geladen/);
  fetcher.mockRejectedValue(Error('offline'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Kalender erneut laden' }),
  );
  await screen.findByText(/Kalender konnte nicht geladen/);
  cleanup();
  fetcher.mockImplementation(async () =>
    Response.json({
      ...data,
      events: [],
      reservations: [],
      units: [],
      previousDate: null,
      nextDate: null,
    }),
  );
  render(<CalendarPanel />);
  await screen.findByText('Keine physischen Einheiten vorhanden.');
  expect(
    (
      screen.getByRole('button', {
        name: 'Nächster Zeitraum',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
test.each(['booked', 'hold', 'blocked'])(
  'timeline shows %s periods without relying on color alone',
  async (state) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json({
          ...data,
          events: [
            {
              ...data.events[0]!,
              startsAt: '2030-10-27T10:00:00Z',
              endsAt: '2030-10-27T12:00:00Z',
              eventType: null,
              contact: null,
              location: null,
            },
          ],
          reservations: [
            {
              ...data.reservations[0]!,
              state,
              conflict: false,
              eventId: state === 'blocked' ? null : 'synthetic-event',
              eventName: null,
              reason: '',
            },
          ],
        }),
      ),
    );
    render(<CalendarPanel />);
    await screen.findByRole('table', { name: 'Ressourcen-Zeitleiste' });
    expect(screen.getByText(/Einschließlich Puffer:/)).toBeTruthy();
    if (state === 'blocked')
      expect(screen.getByText('Zeitweise Sperre')).toBeTruthy();
    else
      expect(
        screen.getByRole('link', { name: 'Eventreservierung' }),
      ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('link', { name: 'Fictional calendar event' }),
    );
  },
);

test('unreviewed imported promises prevent any unqualified free-capacity display', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...data, pendingPromises: 2, reservations: [] }),
      ),
  );
  render(<CalendarPanel />);
  await screen.findByText(/2 ungeprüfte Bestandszusagen/);
  expect(screen.queryByText('Frei', { exact: true })).toBeNull();
  expect(screen.getAllByText('Bestand ungeprüft').length).toBeGreaterThan(0);
});

test('the calendar refreshes on return without a manual control and does not loop', async () => {
  const fetcher = vi.fn(async () => Response.json(data));
  vi.stubGlobal('fetch', fetcher);
  render(<CalendarPanel />);
  await screen.findByRole('table', { name: 'Ressourcen-Zeitleiste' });
  expect(
    screen.queryByRole('button', { name: 'Kalender aktualisieren' }),
  ).toBeNull();
  const before = calendarLoads(fetcher);
  returnToApp();
  await vi.waitFor(() => expect(calendarLoads(fetcher)).toBe(before + 1));
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(calendarLoads(fetcher)).toBe(before + 1);
});

test('a failed first calendar load offers an error-only retry that works', async () => {
  let fail = true;
  const fetcher = vi.fn(async () =>
    fail ? new Response(null, { status: 503 }) : Response.json(data),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<CalendarPanel />);
  await screen.findByText(/Kalender konnte nicht geladen werden/);
  expect(screen.queryByRole('table')).toBeNull();
  fail = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Kalender erneut laden' }),
  );
  await screen.findByRole('table', { name: 'Ressourcen-Zeitleiste' });
});

test('a slower earlier calendar response cannot overwrite the newer period', async () => {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn(
    () => new Promise<Response>((resolve) => pending.push(resolve)),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<CalendarPanel />);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Kalenderansicht'), {
    target: { value: 'month' },
  });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!(
    Response.json({ ...data, events: [{ ...data.events[0]!, name: 'Newer' }] }),
  );
  await screen.findByText('Newer');
  pending[0]!(
    Response.json({ ...data, events: [{ ...data.events[0]!, name: 'Older' }] }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(screen.queryByText('Older')).toBeNull();
  expect(screen.getAllByText('Newer').length).toBeGreaterThan(0);
});
