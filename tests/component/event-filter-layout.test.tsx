import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EventPanel } from '../../apps/admin/src/EventPanel.js';

// BKP007: the event filters keep their H041 fields, presets, counters and URL
// rules, but get the Bookitup frame: one context column beside the list on wide
// screens and one modal sheet behind a compact access on small ones. Both share
// the applied URL state, so these tests work on one form and one writer.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic event',
  status: 'inquiry',
  eventDate: null as string | null,
  startsAt: null,
  endsAt: null,
  timeZone: 'Europe/Berlin',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  venue: null,
  venueOverride: false,
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  description: '',
  notesHtml: '',
};

function mocker(events = [row]) {
  return vi.fn(async (url: string) =>
    String(url).startsWith('/api/v1/events')
      ? Response.json({
          timeZone: 'Europe/Berlin',
          events,
          // BKP007.2: the counters are the server aggregate of the answer.
          filterCounts: {
            undated: events.filter((entry) => !entry.eventDate).length,
            inquiries: events.filter((entry) => entry.status === 'inquiry')
              .length,
          },
        })
      : url === '/api/v1/statuses'
        ? Response.json([
            { code: 'inquiry', label: 'Anfrage' },
            { code: 'booked', label: 'Gebucht' },
          ])
        : Response.json([]),
  );
}

// jsdom reports no viewport preference; the panel asks `(min-width: 1024px)`.
// Denying it renders the compact access and the sheet, exactly like a phone.
function mobileLayout() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

// jsdom has no dialog implementation; this shim reflects the visible state.
function shimDialog() {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
}

function sheet() {
  return document.querySelector<HTMLDialogElement>(
    'dialog.event-filter-drawer',
  )!;
}

test('the filter groups form one context column left of the results', async () => {
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText(/Synthetic event – /);
  const context = document.querySelector<HTMLElement>('.event-context')!;
  expect(context).toBeTruthy();
  expect(context.getAttribute('aria-label')).toBe('Eventfilter');
  const results =
    context.parentElement!.querySelector<HTMLElement>('.event-results')!;
  // One panel, one form, one writer: no second filter copy over the results.
  expect(context.querySelectorAll('form')).toHaveLength(1);
  expect(results.querySelector('.event-filters')).toBeNull();
  expect(results.querySelector('form')).toBeNull();
  expect(screen.getAllByLabelText('Events suchen')).toHaveLength(1);
  // Desktop keeps the column open: no toggle row and no modal sheet.
  expect(document.querySelector('dialog.event-filter-drawer')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Filter' })).toBeNull();
  expect(
    context.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The group order follows the design contract; a view is only offered with a
  // real target, and no optional group is invented.
  const fieldset = context.querySelector('fieldset')!;
  const groups = Array.from(fieldset.children)
    .filter((child) => child.tagName !== 'LEGEND')
    .map((child) => {
      if (child.querySelector('input[name="q"]')) return 'suche';
      if (child.tagName === 'NAV') return 'ansicht';
      if (child.classList.contains('event-sorting')) return 'sortieren';
      if (child.classList.contains('event-quick-filters')) return 'anfragen';
      if (child.classList.contains('date-presets')) return 'zeitraum';
      if (child.classList.contains('custom-range')) return 'eigener-zeitraum';
      if (child.querySelector('[name="status"]')) return 'status';
      if (child.querySelector('[name="eventTypeId"]')) return 'art';
      if (child.classList.contains('event-filter-actions')) return 'aktionen';
      return 'unbekannt';
    });
  expect(groups).toEqual([
    'suche',
    'ansicht',
    'sortieren',
    'anfragen',
    'zeitraum',
    'eigener-zeitraum',
    'status',
    'art',
    'aktionen',
  ]);
  const views = within(context).getByRole('navigation', { name: 'Ansicht' });
  expect(
    within(views)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href')),
  ).toEqual(['#events', '#calendar']);
  expect(
    within(views)
      .getByRole('link', { name: 'Liste' })
      .getAttribute('aria-current'),
  ).toBe('page');
  // The existing controls keep their labels and their meanings.
  expect(within(context).getByLabelText('Filterstatus')).toBeTruthy();
  expect(within(context).getByLabelText('Filtereventart')).toBeTruthy();
  expect(
    within(context)
      .getByRole('group', { name: 'Sortieren' })
      .querySelectorAll('input[type="radio"]'),
  ).toHaveLength(2);
  expect(within(context).getByTestId('undated-count').textContent).toBe('1');
  expect(within(context).getByTestId('inquiry-count').textContent).toBe('1');
});

test('the mobile access names the active criteria and resets the applied filter', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic&status=inquiry');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByTestId('active-filter-count').textContent).toBe('2');
  // Nothing stands between the access and the list: the sheet is closed.
  expect(sheet().open).toBe(false);
  expect(screen.queryByLabelText('Events suchen')).toBeNull();
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
  expect(pushes).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('');
  expect(screen.getByTestId('active-filter-count').textContent).toBe('0');
  expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).toBeNull();
});

test('cancel discards only the draft and keeps the applied filter', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  trigger.focus();
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(trigger);
  expect(pushes).not.toHaveBeenCalled();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const input = screen.getByLabelText('Events suchen') as HTMLInputElement;
  expect(input.value).toBe('Synthetic');
  fireEvent.change(input, { target: { value: 'Synthetic abandoned draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Filter schließen' }));
  expect(pushes).not.toHaveBeenCalled();
  expect(sheet().open).toBe(false);
  expect(sheet().querySelector('form')).toBeNull();
  expect(window.location.search).toBe('?q=Synthetic');
  expect(document.activeElement).toBe(trigger);
  // Reopening starts from the applied state, never from the abandoned draft.
  fireEvent.click(trigger);
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
});

test('escape closes the sheet and returns focus to the filter access', async () => {
  mobileLayout();
  shimDialog();
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  trigger.focus();
  fireEvent.click(trigger);
  expect(sheet().open).toBe(true);
  // A modal dialog traps focus; Chromium owns the Escape default, the panel
  // turns the cancel event into the same explicit close path.
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  fireEvent(sheet(), new Event('cancel'));
  expect(sheet().open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('one completion writes exactly one history entry and shows the results', async () => {
  mobileLayout();
  shimDialog();
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  fireEvent.click(trigger);
  const form = screen.getByRole('button', { name: 'Ergebnisse anzeigen' });
  expect(form.closest('form')).toBe(sheet().querySelector('form'));
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.change(screen.getByLabelText('Events suchen'), {
    target: { value: 'Synthetic mobile' },
  });
  fireEvent.click(form);
  expect(pushes).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(window.location.search).get('q')).toBe(
    'Synthetic mobile',
  );
  expect(sheet().open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByTestId('active-filter-count').textContent).toBe('1');
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith('/api/v1/events?q=Synthetic+mobile'),
  );
});

test('both presentations read the same applied filter state', async () => {
  window.history.replaceState(
    null,
    '',
    '/?q=Synthetic&status=inquiry&from=2026-10-01',
  );
  vi.stubGlobal('fetch', mocker());
  const first = render(<EventPanel csrfToken="csrf" />);
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
  // The status select only knows its options once the statuses arrived; the
  // panel remounts on the loaded zone, exactly as before.
  await screen.findByText('Zeitzone: Europe/Berlin');
  expect(
    (screen.getByLabelText('Filterstatus') as HTMLSelectElement).value,
  ).toBe('inquiry');
  expect((screen.getByLabelText('Filter von') as HTMLInputElement).value).toBe(
    '2026-10-01',
  );
  first.unmount();
  mobileLayout();
  shimDialog();
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  expect(screen.getByTestId('active-filter-count').textContent).toBe('3');
  fireEvent.click(trigger);
  await screen.findByText('Zeitzone: Europe/Berlin');
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
  expect(
    (screen.getByLabelText('Filterstatus') as HTMLSelectElement).value,
  ).toBe('inquiry');
  expect((screen.getByLabelText('Filter von') as HTMLInputElement).value).toBe(
    '2026-10-01',
  );
  // BKP007.3: the sheet reads the applied filter and edits a draft. A sort
  // choice inside it writes no history entry and leaves the applied URL alone.
  const pushes = vi.spyOn(window.history, 'pushState');
  const undated = within(sheet()).getByRole('radio', { name: /^Ohne Datum/ });
  fireEvent.click(undated);
  expect(pushes).not.toHaveBeenCalled();
  expect(window.location.search).toBe(
    '?q=Synthetic&status=inquiry&from=2026-10-01',
  );
  expect((undated as HTMLInputElement).checked).toBe(true);
  expect(sheet().open).toBe(true);
  // The explicit completion is the one write: one entry, `undated=true` and no
  // leftover date bound, then the sheet closes and returns the focus.
  fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse anzeigen' }));
  expect(pushes).toHaveBeenCalledTimes(1);
  const applied = new URLSearchParams(window.location.search);
  expect(applied.get('undated')).toBe('true');
  expect(applied.get('from')).toBeNull();
  expect(applied.get('q')).toBe('Synthetic');
  expect(applied.get('status')).toBe('inquiry');
  expect(sheet().open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('opening and cancelling the sheet leaves a dirty event editor alone', async () => {
  mobileLayout();
  shimDialog();
  const fetcher = mocker();
  vi.stubGlobal('fetch', fetcher);
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Event bearbeiten: Synthetic event',
    }),
  );
  const editor = screen.getByLabelText('Eventname').closest('details')!;
  fireEvent.change(screen.getByLabelText('Eventname'), {
    target: { value: 'Fictional dirty draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Filter schließen' }));
  expect(editor.open).toBe(true);
  expect((screen.getByLabelText('Eventname') as HTMLInputElement).value).toBe(
    'Fictional dirty draft',
  );
  expect(fetcher.mock.calls.filter((call) => call.length > 1)).toHaveLength(0);
});

test('a tenant zone different from the browser zone still decides the presets', async () => {
  // 13:00 UTC on 31 October is still October in the browser zone (Berlin) but
  // already 1 November in the tenant zone (Auckland).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T13:00:00.000Z'));
  mobileLayout();
  shimDialog();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).startsWith('/api/v1/events')
        ? Response.json({ timeZone: 'Pacific/Auckland', events: [row] })
        : Response.json([]),
    ),
  );
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(screen.getByRole('button', { name: 'Dieser Monat' }));
  // The draft names the month in the tenant zone; nothing is written yet.
  expect(pushes).not.toHaveBeenCalled();
  expect(window.location.search).toBe('');
  expect((screen.getByLabelText('Filter von') as HTMLInputElement).value).toBe(
    '2026-11-01',
  );
  expect((screen.getByLabelText('Filter bis') as HTMLInputElement).value).toBe(
    '2026-11-30',
  );
  expect(
    screen
      .getByRole('button', { name: 'Dieser Monat' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse anzeigen' }));
  const search = new URLSearchParams(window.location.search);
  expect(search.get('from')).toBe('2026-11-01');
  expect(search.get('to')).toBe('2026-11-30');
  // A preset is one applied criterion and one history entry.
  expect(pushes).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('active-filter-count').textContent).toBe('1');
});

test('a broken custom range keeps its inputs instead of dropping the draft', async () => {
  mobileLayout();
  shimDialog();
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  fireEvent.click(screen.getByText('Eigener Zeitraum'));
  fireEvent.change(screen.getByLabelText('Filter von'), {
    target: { value: '2027-02-01' },
  });
  // A date input ignores an impossible value in Chromium; jsdom keeps the raw
  // string, so the panel must not push an empty or invented bound.
  fireEvent.change(screen.getByLabelText('Filter bis'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse anzeigen' }));
  expect(new URLSearchParams(window.location.search).get('from')).toBe(
    '2027-02-01',
  );
  expect(new URLSearchParams(window.location.search).get('to')).toBeNull();
});

test('updateUrlSearch keeps foreign parameters while the sheet writes its own', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?df_kind=offer&other=keep');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  fireEvent.change(screen.getByLabelText('Events suchen'), {
    target: { value: 'Synthetic namespaced' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse anzeigen' }));
  const search = new URLSearchParams(window.location.search);
  expect(search.get('q')).toBe('Synthetic namespaced');
  expect(search.get('df_kind')).toBe('offer');
  expect(search.get('other')).toBe('keep');
  updateUrlSearch({ q: '' });
  expect(window.location.search).toBe('?df_kind=offer&other=keep');
});

// BKP007.3: the reproduction of the reported regression. A sort choice in the
// sheet is a draft: it must neither remount the form (the search would fall
// back to the applied value) nor write the URL that a cancel cannot undo.
test('review regression: mobile sort preserves draft and cancel leaves applied URL unchanged', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic&from=2026-10-01');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  fireEvent.click(trigger);
  await screen.findByText('Zeitzone: Europe/Berlin');
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.change(screen.getByLabelText('Events suchen'), {
    target: { value: 'Synthetic unsaved search' },
  });
  fireEvent.click(within(sheet()).getByRole('radio', { name: /^Ohne Datum/ }));
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('Synthetic unsaved search');
  expect(pushes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Filter schließen' }));
  expect(window.location.search).toBe('?q=Synthetic&from=2026-10-01');
});

test('the sheet keeps one draft across search, preset, sort and quick filter', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic&from=2026-10-01');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  await screen.findByText('Zeitzone: Europe/Berlin');
  const pushes = vi.spyOn(window.history, 'pushState');
  const search = screen.getByLabelText('Events suchen') as HTMLInputElement;
  fireEvent.change(search, { target: { value: 'Synthetic mixed draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Dieser Monat' }));
  expect(search.value).toBe('Synthetic mixed draft');
  fireEvent.click(within(sheet()).getByRole('radio', { name: /^Ohne Datum/ }));
  expect(search.value).toBe('Synthetic mixed draft');
  fireEvent.click(
    within(sheet()).getByRole('radio', { name: /^Chronologisch/ }),
  );
  expect(search.value).toBe('Synthetic mixed draft');
  fireEvent.click(
    within(
      within(sheet()).getByRole('group', { name: 'Schnellfilter' }),
    ).getByRole('button', { name: /^Anfragen/ }),
  );
  fireEvent.change(screen.getByLabelText('Filterstatus'), {
    target: { value: 'booked' },
  });
  // Every mixed choice stays in the one draft; none of them wrote the URL.
  expect(search.value).toBe('Synthetic mixed draft');
  expect(
    (screen.getByLabelText('Filterstatus') as HTMLSelectElement).value,
  ).toBe('booked');
  expect((screen.getByLabelText('Filter von') as HTMLInputElement).value).toBe(
    '',
  );
  expect(pushes).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?q=Synthetic&from=2026-10-01');
  // The counters stay the server's aggregate and the applied criteria count is
  // still the applied URL, not the draft.
  expect(within(sheet()).getByTestId('undated-count').textContent).toBe('1');
  expect(within(sheet()).getByTestId('inquiry-count').textContent).toBe('1');
  expect(screen.getByTestId('active-filter-count').textContent).toBe('2');
});

test('an undated draft survives the completion and drops the date bounds', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(
    null,
    '',
    '/?q=Synthetic&from=2026-10-01&to=2026-10-31',
  );
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  fireEvent.click(trigger);
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(within(sheet()).getByRole('radio', { name: /^Ohne Datum/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse anzeigen' }));
  expect(pushes).toHaveBeenCalledTimes(1);
  const applied = new URLSearchParams(window.location.search);
  expect(applied.get('undated')).toBe('true');
  expect(applied.get('from')).toBeNull();
  expect(applied.get('to')).toBeNull();
  expect(applied.get('q')).toBe('Synthetic');
  expect(sheet().open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  // Reopening proves the applied state keeps the sort choice.
  fireEvent.click(trigger);
  expect(
    (
      within(sheet()).getByRole('radio', {
        name: /^Ohne Datum/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
});

test('a cancelled preset draft keeps the applied URL and the applied values', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic&from=2026-10-01');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  fireEvent.click(trigger);
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  expect(
    screen
      .getByRole('button', { name: 'Nächster Monat' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  expect(pushes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Filter schließen' }));
  expect(window.location.search).toBe('?q=Synthetic&from=2026-10-01');
  expect(document.activeElement).toBe(trigger);
  // Reopening starts over from the applied URL, not from the preset draft.
  fireEvent.click(trigger);
  expect(
    screen
      .getByRole('button', { name: 'Nächster Monat' })
      .getAttribute('aria-pressed'),
  ).toBe('false');
  expect((screen.getByLabelText('Filter von') as HTMLInputElement).value).toBe(
    '2026-10-01',
  );
  expect(
    (
      within(sheet()).getByRole('radio', {
        name: /^Chronologisch/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
});

test('escape discards a sort draft and keeps the applied filter', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  fireEvent.click(trigger);
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(within(sheet()).getByRole('radio', { name: /^Ohne Datum/ }));
  expect(
    (
      within(sheet()).getByRole('radio', {
        name: /^Ohne Datum/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  fireEvent(sheet(), new Event('cancel'));
  expect(pushes).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?q=Synthetic');
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(
    (
      within(sheet()).getByRole('radio', {
        name: /^Chronologisch/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
});

test('the in-sheet reset clears the draft without a history entry', async () => {
  mobileLayout();
  shimDialog();
  window.history.replaceState(null, '', '/?q=Synthetic&status=inquiry');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  const trigger = await screen.findByRole('button', { name: /^Filter/ });
  fireEvent.click(trigger);
  await screen.findByText('Zeitzone: Europe/Berlin');
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.change(screen.getByLabelText('Events suchen'), {
    target: { value: 'Synthetic reset draft' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventfilter zurücksetzen' }),
  );
  expect(pushes).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?q=Synthetic&status=inquiry');
  expect(
    (screen.getByLabelText('Events suchen') as HTMLInputElement).value,
  ).toBe('');
  expect(
    (screen.getByLabelText('Filterstatus') as HTMLSelectElement).value,
  ).toBe('');
  expect(screen.getByTestId('active-filter-count').textContent).toBe('2');
  // Only the completion applies the emptied draft — still one entry.
  fireEvent.click(screen.getByRole('button', { name: 'Ergebnisse anzeigen' }));
  expect(pushes).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('');
  expect(screen.getByTestId('active-filter-count').textContent).toBe('0');
});

test('the desktop column keeps writing each choice immediately', async () => {
  window.history.replaceState(null, '', '/?q=Synthetic');
  vi.stubGlobal('fetch', mocker());
  render(<EventPanel csrfToken="csrf" />);
  await screen.findByText(/Synthetic event – /);
  const context = document.querySelector<HTMLElement>('.event-context')!;
  const pushes = vi.spyOn(window.history, 'pushState');
  fireEvent.click(
    within(context).getByRole('button', { name: 'Dieser Monat' }),
  );
  expect(pushes).toHaveBeenCalledTimes(1);
  const month = new URLSearchParams(window.location.search);
  expect(month.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
  fireEvent.click(within(context).getByRole('radio', { name: /^Ohne Datum/ }));
  expect(pushes).toHaveBeenCalledTimes(2);
  const undated = new URLSearchParams(window.location.search);
  expect(undated.get('undated')).toBe('true');
  expect(undated.get('from')).toBeNull();
  fireEvent.click(
    within(
      within(context).getByRole('group', { name: 'Schnellfilter' }),
    ).getByRole('button', { name: /^Anfragen/ }),
  );
  expect(pushes).toHaveBeenCalledTimes(3);
  expect(new URLSearchParams(window.location.search).get('status')).toBe(
    'inquiry',
  );
  fireEvent.click(
    within(context).getByRole('button', { name: 'Eventfilter zurücksetzen' }),
  );
  expect(pushes).toHaveBeenCalledTimes(4);
  expect(window.location.search).toBe('');
});
