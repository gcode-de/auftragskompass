import { updateUrlSearch } from '../../apps/admin/src/url-state.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ContactPanel } from '../../apps/admin/src/ContactPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
const row = {
  id: 'synthetic',
  version: 1,
  kind: 'company',
  name: 'Synthetic Company',
  contactPerson: 'Fictional',
  street: 'Synthetic Street 1',
  postalCode: '00000',
  city: 'Fictional City',
  country: 'DE',
  email: 'synthetic@example.invalid',
  phone: '030 000000',
  mobile: '',
  state: 'active',
};
const person = {
  id: 'fictional-person',
  version: 3,
  kind: 'private',
  name: 'Fictional Person',
  contactPerson: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'AT',
  email: 'person@example.invalid',
  phone: '',
  mobile: '',
  state: 'archived',
};
function listFetcher(rows: (typeof row)[] = [row]) {
  return vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(options ? rows[0] : rows),
  );
}
async function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Kontakt anlegen' }));
  return screen.findByRole('dialog', { name: 'Kontakt anlegen' });
}
async function openEdit(name: string) {
  const trigger = screen.getByRole('button', {
    name: 'Kontakt bearbeiten: ' + name,
  });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole('dialog', { name: 'Kontakt bearbeiten' });
}
function submitSave(dialog: HTMLElement) {
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Kontakt speichern' })
      .closest('form')!,
  );
}
test('the contact page starts with the search toolbar and the list directly below, without an exposed form', async () => {
  vi.stubGlobal('fetch', listFetcher());
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const search = screen.getByLabelText('Kontakte suchen');
  const list = screen.getByRole('list');
  expect(search.closest('form')!.parentElement!.nextElementSibling).toBe(list);
  expect(screen.queryByLabelText('Name / Firma')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Kontakt speichern' }),
  ).toBeNull();
  const create = screen.getByRole('button', { name: 'Kontakt anlegen' });
  expect(create.getAttribute('title')).toBe('Kontakt anlegen');
  expect(create.getAttribute('aria-label')).toBe('Kontakt anlegen');
  expect(create.textContent).toBe('');
  const rowActions: [string, string][] = [
    ['Events anzeigen: Synthetic Company', 'Events anzeigen'],
    ['Kontakt bearbeiten: Synthetic Company', 'Kontakt bearbeiten'],
  ];
  for (const [name, title] of rowActions) {
    const action = screen.getByRole('button', { name });
    expect(action.getAttribute('title')).toBe(title);
    expect(action.textContent).toBe('');
    expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  }
  expect(screen.getByRole('region', { name: 'Kontakte' })).toBeTruthy();
});
test('the plus action opens an accessible dialog with focus, focus trap, cancel and focus return', async () => {
  vi.stubGlobal('fetch', listFetcher());
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const create = screen.getByRole('button', { name: 'Kontakt anlegen' });
  create.focus();
  const dialog = await openCreate();
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  const labelledBy = dialog.getAttribute('aria-labelledby')!;
  expect(document.getElementById(labelledBy)?.textContent).toBe(
    'Kontakt anlegen',
  );
  expect(screen.getByLabelText('Kontaktart')).toBe(document.activeElement);
  const close = within(dialog).getByRole('button', {
    name: 'Dialog schließen',
  });
  expect(close.getAttribute('title')).toBe('Dialog schließen');
  const save = within(dialog).getByRole('button', {
    name: 'Kontakt speichern',
  });
  save.focus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(close).toBe(document.activeElement);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(save).toBe(document.activeElement);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).toBe(document.activeElement);
  expect(screen.queryByLabelText('Name / Firma')).toBeNull();
});
test('creates private and company contacts with the existing fields and country default', async () => {
  const mutations: {
    url: string;
    method: string | undefined;
    body: Record<string, string>;
    csrf: string | null;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options) {
        mutations.push({
          url,
          method: options.method,
          body: JSON.parse(String(options.body)),
          csrf: new Headers(options.headers).get('x-csrf-token'),
        });
        return Response.json({ ...row, id: 'synthetic-new', version: 1 });
      }
      return Response.json([]);
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Keine Kontakte gefunden.');
  let dialog = await openCreate();
  expect((screen.getByLabelText('Ländercode') as HTMLInputElement).value).toBe(
    'DE',
  );
  expect((screen.getByLabelText('Kontaktart') as HTMLSelectElement).value).toBe(
    'private',
  );
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Fictional Private' },
  });
  submitSave(dialog);
  await screen.findByText('Kontakt gespeichert.');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Kontakt anlegen' })).toBe(
      document.activeElement,
    ),
  );
  expect(mutations[0]).toEqual({
    url: '/api/v1/contacts',
    method: 'POST',
    csrf: 'csrf',
    body: {
      kind: 'private',
      name: 'Fictional Private',
      contactPerson: '',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      email: '',
      phone: '',
      mobile: '',
      state: 'active',
    },
  });
  dialog = await openCreate();
  fireEvent.change(screen.getByLabelText('Kontaktart'), {
    target: { value: 'company' },
  });
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Fictional Company' },
  });
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), {
    target: { value: 'company@example.invalid' },
  });
  submitSave(dialog);
  await screen.findByText('Kontakt gespeichert.');
  expect(mutations[1]!.body).toMatchObject({
    kind: 'company',
    name: 'Fictional Company',
    email: 'company@example.invalid',
  });
  expect(mutations[1]!.body.version).toBeUndefined();
});
test('edits a contact with its version and never reuses stale values when switching targets', async () => {
  const mutations: {
    url: string;
    method: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options) {
        mutations.push({
          url,
          method: options.method,
          body: JSON.parse(String(options.body)),
        });
        return Response.json(row);
      }
      return Response.json([row, person]);
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText(/Fictional Person/);
  let dialog = await openEdit('Fictional Person');
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Fictional Person');
  expect((screen.getByLabelText('Ländercode') as HTMLInputElement).value).toBe(
    'AT',
  );
  expect(
    (screen.getByLabelText('Kontaktzustand') as HTMLSelectElement).value,
  ).toBe('archived');
  fireEvent.change(screen.getByLabelText('Ort'), {
    target: { value: 'Fictional Town' },
  });
  submitSave(dialog);
  await screen.findByText('Kontakt gespeichert.');
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Kontakt bearbeiten: Fictional Person',
      }),
    ).toBe(document.activeElement),
  );
  expect(mutations[0]!.url).toBe('/api/v1/contacts/fictional-person');
  expect(mutations[0]!.method).toBe('PUT');
  expect(mutations[0]!.body).toMatchObject({
    version: 3,
    kind: 'private',
    name: 'Fictional Person',
    country: 'AT',
    city: 'Fictional Town',
    state: 'archived',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  dialog = await openCreate();
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('');
  expect((screen.getByLabelText('Ländercode') as HTMLInputElement).value).toBe(
    'DE',
  );
  fireEvent.keyDown(dialog, { key: 'Escape' });
  dialog = await openEdit('Synthetic Company');
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic Company');
  expect((screen.getByLabelText('Ländercode') as HTMLInputElement).value).toBe(
    'DE',
  );
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('keeps the search text, result list and list state while the dialog opens and closes', async () => {
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.includes('q=Person')
        ? [{ ...person, name: 'Fictional Person' }]
        : [row, person],
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'Person' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await screen.findByText(/Fictional Person/);
  expect(screen.queryByText(/Synthetic Company/)).toBeNull();
  const before = fetcher.mock.calls.length;
  const dialog = await openEdit('Fictional Person');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(
    (screen.getByLabelText('Kontakte suchen') as HTMLInputElement).value,
  ).toBe('Person');
  expect(screen.getByText(/Fictional Person/)).toBeTruthy();
  expect(screen.queryByText(/Synthetic Company/)).toBeNull();
  expect(fetcher.mock.calls.length).toBe(before);
});
test('an untouched dialog is not dirty and a changed draft needs an explicit discard confirmation', async () => {
  vi.stubGlobal('fetch', listFetcher());
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  let dialog = await openCreate();
  expect(hasUnsavedChanges()).toBe(false);
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Fictional unsaved' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Kontakt abbrechen' }));
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und den Kontaktdialog schließen?',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Fictional unsaved');
  confirm.mockReturnValue(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  dialog = await openCreate();
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('');
  fireEvent.keyDown(dialog, { key: 'Escape' });
});
test('keeps entered values after validation, conflict, load and connection errors', async () => {
  const errors = ['conflict', 'invalid'];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options) return Response.json([row]);
      if (!errors.length) throw Error('offline');
      return Response.json({ error: errors.shift() }, { status: 409 });
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic draft' },
  });
  for (const text of [
    /Inzwischen geändert/,
    /Speichern fehlgeschlagen/,
    /Verbindung fehlgeschlagen/,
  ]) {
    submitSave(dialog);
    await screen.findByText(text);
  }
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic draft');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dubletten prüfen' }));
  await screen.findByText(/Dublettenprüfung fehlgeschlagen/);
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText(/Kontakte konnten nicht geladen/);
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await screen.findByText(/Kontakte konnten nicht geladen/);
});
test('keeps focus inside the modal while a save is pending and accepts no close or Escape', async () => {
  let finish: (response: Response) => void = () => {};
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json([row]),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic pending' },
  });
  const form = within(dialog)
    .getByRole('button', { name: 'Kontakt speichern' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(dialog);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Dialog schließen' }),
  );
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(fetcher.mock.calls.filter(([, options]) => options).length).toBe(1);
  await act(async () =>
    finish(Response.json({ error: 'invalid' }, { status: 500 })),
  );
  await screen.findByText(/Speichern fehlgeschlagen/);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic pending');
  const alert = screen.getByRole('alert');
  expect(dialog.contains(alert)).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(alert));
});
test('reports a saved contact honestly when the following list load fails and retries with GET only', async () => {
  let listCalls = 0;
  let failList = false;
  let saved = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      saved = true;
      return Response.json({ ...row, name: 'Synthetic saved' });
    }
    listCalls += 1;
    if (failList && listCalls > 1) throw Error('offline');
    return Response.json([saved ? { ...row, name: 'Synthetic saved' } : row]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  failList = true;
  const dialog = await openEdit('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic saved' },
  });
  submitSave(dialog);
  await screen.findByText(
    'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  const posts = () => fetcher.mock.calls.filter(([, options]) => options);
  expect(posts().length).toBe(1);
  failList = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Kontakte erneut laden' }),
  );
  await screen.findByText('Synthetic saved');
  expect(posts().length).toBe(1);
  expect(
    screen.queryByText(
      'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
    ),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Kontakte erneut laden' }),
  ).toBeNull();
});
test('a successful filter reload clears a saved-but-not-reloaded warning', async () => {
  let saved = false;
  let failNextList = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options) {
      saved = true;
      return Response.json({ ...row, name: 'Synthetic saved' });
    }
    if (failNextList) {
      failNextList = false;
      throw Error('offline');
    }
    return Response.json([saved ? { ...row, name: 'Synthetic saved' } : row]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic saved' },
  });
  failNextList = true;
  submitSave(dialog);
  await screen.findByText(
    'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
  );
  expect(
    screen.getByRole('button', { name: 'Kontakte erneut laden' }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'Synthetic' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await screen.findByText('Synthetic saved');
  expect(
    screen.queryByText(
      'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
    ),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Kontakte erneut laden' }),
  ).toBeNull();
});
test('a stale list response cannot clear a newer reload warning', async () => {
  let finishSave: (response: Response) => void = () => {};
  let finishStale: (response: Response) => void = () => {};
  let listCalls = 0;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options)
      return new Promise<Response>((resolve) => {
        finishSave = resolve;
      });
    if (url.includes('q=stale'))
      return new Promise<Response>((resolve) => {
        finishStale = resolve;
      });
    listCalls += 1;
    if (listCalls === 1) return Promise.resolve(Response.json([row]));
    return Promise.reject(Error('offline'));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic changed' },
  });
  submitSave(dialog);
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'stale' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await act(async () => finishSave(Response.json(row)));
  await screen.findByText(
    'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
  );
  await act(async () =>
    finishStale(Response.json([{ ...row, name: 'Stale list' }])),
  );
  expect(
    screen.getByText(
      'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Kontakte erneut laden' }),
  ).toBeTruthy();
  expect(screen.queryByText('Stale list')).toBeNull();
  expect(screen.getByText('Synthetic Company')).toBeTruthy();
});
test('duplicate-check success is a polite status while failures stay alerts', async () => {
  let duplicateCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (!url.endsWith('/duplicates'))
        return Response.json(options ? row : [row]);
      duplicateCalls += 1;
      if (duplicateCalls > 1)
        return Response.json({ error: 'unavailable' }, { status: 503 });
      return Response.json([]);
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  fireEvent.click(screen.getByRole('button', { name: 'Dubletten prüfen' }));
  const success = await screen.findByText(
    'Keine möglichen Dubletten gefunden.',
  );
  expect(success.getAttribute('role')).toBe('status');
  expect(success.classList.contains('field-error')).toBe(false);
  expect(success.closest('[role="alert"]')).toBeNull();
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), {
    target: { value: 'changed@example.invalid' },
  });
  expect(screen.queryByText('Keine möglichen Dubletten gefunden.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dubletten prüfen' }));
  const failure = await screen.findByText('Dublettenprüfung fehlgeschlagen.');
  expect(failure.getAttribute('role')).toBe('alert');
  expect(failure.classList.contains('field-error')).toBe(true);
  expect(dialog.contains(failure)).toBe(true);
});
test('returns focus to the plus action when the edited row disappears after saving', async () => {
  let saved = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options) {
        saved = true;
        return Response.json(row);
      }
      return Response.json(saved ? [] : [row]);
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic gone' },
  });
  submitSave(dialog);
  await screen.findByText('Kontakt gespeichert.');
  expect(screen.getByText('Keine Kontakte gefunden.')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Kontakt anlegen' })).toBe(
      document.activeElement,
    ),
  );
});
test('deep links without a matching row stay honest and never open a stale editor', async () => {
  vi.stubGlobal('fetch', listFetcher());
  window.history.replaceState(null, '', '/#contact-does-not-exist');
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  expect(screen.queryByRole('dialog')).toBeNull();
  cleanup();
  window.history.replaceState(null, '', '/?q=nomatch#contact-synthetic');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Keine Kontakte gefunden.');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Synthetic Company')).toBeNull();
});
test('contacts reveal related events and handle empty or unavailable relations', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!url.endsWith('/events')) return Response.json([row]);
      if (calls++ === 0)
        return Response.json([
          { id: 'synthetic-event', name: 'Fictional linked event' },
        ]);
      if (calls === 2) return Response.json([]);
      return new Response(null, { status: 500 });
    }),
  );
  render(<ContactPanel csrfToken="csrf" />);
  const button = await screen.findByRole('button', {
    name: 'Events anzeigen: Synthetic Company',
  });
  fireEvent.click(button);
  expect(
    (
      await screen.findByRole('link', { name: 'Fictional linked event' })
    ).getAttribute('href'),
  ).toBe('#event-synthetic-event');
  fireEvent.click(button);
  await screen.findByText('Keine zugeordneten Events.');
  fireEvent.click(button);
  await screen.findByText(/Zugeordnete Events konnten nicht geladen/);
});
test('contact search keeps the newest result when an older request finishes later', async () => {
  let resolveOld!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/v1/contacts'
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(
            Response.json([{ ...row, name: 'Synthetic fresh contact' }]),
          ),
    ),
  );
  render(<ContactPanel csrfToken="csrf" />);
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'fresh' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  await screen.findByText('Synthetic fresh contact');
  await act(async () => resolveOld(Response.json([row])));
  expect(screen.queryByText('Synthetic Company')).toBeNull();
});
test('reapplying the global query resets a local contact search even when the URL is unchanged', async () => {
  window.history.replaceState(null, '', '/?q=Synthetic');
  const fetcher = vi.fn().mockImplementation(async () => Response.json([row]));
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'local' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Kontakte durchsuchen' })
      .closest('form')!,
  );
  act(() => updateUrlSearch({ q: 'Synthetic' }));
  expect(
    (screen.getByLabelText('Kontakte suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
});
test('a contact deep link reaches the matching existing list entry and its editor', async () => {
  window.history.replaceState(null, '', '/#contact-synthetic');
  vi.stubGlobal('fetch', listFetcher());
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  expect(document.getElementById('contact-synthetic')).toBeTruthy();
  const dialog = await openEdit('Synthetic Company');
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic Company');
  fireEvent.keyDown(dialog, { key: 'Escape' });
});
test('typed placeholders never replace stored contact input on focus', async () => {
  vi.stubGlobal('fetch', listFetcher([row]));
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  const email = screen.getByLabelText('E-Mail-Adresse') as HTMLInputElement;
  const name = screen.getByLabelText('Name / Firma') as HTMLInputElement;
  const street = screen.getByLabelText(
    'Straße und Hausnummer',
  ) as HTMLInputElement;
  expect([name.placeholder, email.placeholder, street.placeholder]).toEqual([
    '',
    '',
    '',
  ]);
  name.focus();
  email.focus();
  fireEvent.change(email, {
    target: { value: email.value + '.extra' },
  });
  expect(name.value).toBe('Synthetic Company');
  expect(street.value).toBe('Synthetic Street 1');
  expect(email.value).toBe('synthetic@example.invalid.extra');
  fireEvent.keyDown(dialog, { key: 'Escape' });
});
test('retains the existing CSV export in the quiet toolbar', async () => {
  vi.stubGlobal('fetch', listFetcher());
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  expect(
    screen
      .getByRole('link', { name: 'Kontakte als CSV exportieren' })
      .getAttribute('href'),
  ).toBe('/api/v1/contacts/export.csv');
});
test('contacts suggest duplicates and archive through the edit dialog with direct communication links', async () => {
  let rows = [row];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/duplicates')) return Response.json([row]);
    if (options) rows = [{ ...row, ...JSON.parse(String(options.body)) }];
    return Response.json(options ? rows[0] : rows);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  const dialog = await openEdit('Synthetic Company');
  expect(
    screen
      .getByRole('link', { name: 'E-Mail: Synthetic Company' })
      .getAttribute('href'),
  ).toBe('mailto:synthetic%40example.invalid');
  expect(
    screen
      .getByRole('link', { name: 'Anrufen: Synthetic Company' })
      .getAttribute('href'),
  ).toBe('tel:030000000');
  fireEvent.click(screen.getByRole('button', { name: 'Dubletten prüfen' }));
  await screen.findByText('Mögliche Dubletten: Synthetic Company');
  fireEvent.change(screen.getByLabelText('Kontaktzustand'), {
    target: { value: 'archived' },
  });
  submitSave(dialog);
  await screen.findByText('Synthetic Company – Archiviert');
  expect(screen.queryByRole('dialog')).toBeNull();
});
