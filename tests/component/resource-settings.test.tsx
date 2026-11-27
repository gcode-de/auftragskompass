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
import {
  ResourceSettingsPanel,
  categoryTree,
  type ResourceCategory,
} from '../../apps/admin/src/ResourceSettingsPanel.js';
import { Navigation } from '../../apps/admin/src/Navigation.js';
import { resourceSettingsEvent } from '../../apps/admin/src/resource-settings-event.js';
import { openRowMenu } from '../helpers/row-menu.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const fotobox: ResourceCategory = {
  id: 'cat-fotobox',
  name: 'Fotobox',
  parentId: null,
  version: 1,
  usage: 2,
};
const mirror: ResourceCategory = {
  id: 'cat-mirror',
  name: 'Spiegel',
  parentId: 'cat-fotobox',
  version: 1,
  usage: 0,
};
const props: ResourceCategory = {
  id: 'cat-props',
  name: 'Requisiten',
  parentId: null,
  version: 3,
  usage: 1,
};

function server(
  categories: ResourceCategory[] = [fotobox, mirror, props],
  answer: (url: string, init: RequestInit) => Response | undefined = () =>
    undefined,
) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let hidden = false;
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (method !== 'GET')
      calls.push({
        url,
        method,
        ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
    const custom = answer(url, init);
    if (custom) return custom;
    if (url === '/api/v1/resource-categories' && method === 'GET')
      return Response.json(categories);
    if (url === '/api/v1/settings/resources') {
      if (method === 'PUT')
        hidden = (JSON.parse(String(init.body)) as { hideNavigation: boolean })
          .hideNavigation;
      return Response.json({ hideNavigation: hidden });
    }
    if (method === 'POST') return Response.json({}, { status: 201 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

test('categories keep the given order, each followed by its sub-categories', () => {
  expect(
    categoryTree([mirror, props, fotobox]).map(
      ({ row, depth }) => `${depth}:${row.name}`,
    ),
  ).toEqual(['0:Requisiten', '0:Fotobox', '1:Spiegel']);
  // A sub-category whose parent is gone is shown at the top level.
  expect(
    categoryTree([{ ...mirror, parentId: 'gone' }]).map(({ depth }) => depth),
  ).toEqual([0]);
});

test('the page shows the switch and the categories with their usage', async () => {
  server();
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  const region = screen.getByRole('region', {
    name: 'Ressourcen-Einstellungen',
  });
  const list = await within(region).findAllByRole('listitem');
  expect(list.map((item) => item.textContent)).toEqual([
    'Fotobox · 2 Ressourcen',
    'Spiegel, Unterkategorie',
    'Requisiten · 1 Ressource',
  ]);
  const toggle = within(region).getByRole('switch', {
    name: /Ressourcen-Modul in Navigation ausblenden/,
  });
  expect((toggle as HTMLInputElement).checked).toBe(false);
});

test('the switch saves at once, tells the navigation and rolls back on failure', async () => {
  let fail = false;
  const calls = server(undefined, (url, init) =>
    fail && url === '/api/v1/settings/resources' && init.method === 'PUT'
      ? new Response(null, { status: 500 })
      : undefined,
  );
  const announced = vi.fn();
  window.addEventListener(resourceSettingsEvent, announced);
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  await screen.findByText('Fotobox');
  const toggle = screen.getByRole('switch') as HTMLInputElement;
  fireEvent.click(toggle);
  await screen.findByText('Ressourcen sind in der Navigation ausgeblendet.');
  expect(calls).toEqual([
    {
      url: '/api/v1/settings/resources',
      method: 'PUT',
      body: { hideNavigation: true },
    },
  ]);
  expect(announced).toHaveBeenCalledOnce();
  fireEvent.click(toggle);
  await screen.findByText('Ressourcen stehen wieder in der Navigation.');
  fail = true;
  fireEvent.click(toggle);
  await screen.findByRole('alert');
  expect(toggle.checked).toBe(false);
  window.removeEventListener(resourceSettingsEvent, announced);
});

test('a category is created inside another one from the plus dialog', async () => {
  const calls = server();
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  await screen.findByText('Fotobox');
  const plus = screen.getByRole('button', { name: 'Kategorie anlegen' });
  plus.focus();
  fireEvent.click(plus);
  const dialog = screen.getByRole('dialog', { name: 'Kategorie anlegen' });
  const save = within(dialog).getByRole('button', { name: 'Speichern' });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('Name'), {
    target: { value: ' Hintergründe ' },
  });
  fireEvent.change(within(dialog).getByLabelText('Innerhalb Kategorie'), {
    target: { value: 'cat-fotobox' },
  });
  fireEvent.submit(save.closest('form')!);
  await screen.findByText('Kategorie angelegt.');
  expect(calls).toEqual([
    {
      url: '/api/v1/resource-categories',
      method: 'POST',
      body: { name: 'Hintergründe', parentId: 'cat-fotobox' },
    },
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(plus));
});

test('editing offers no parent inside the category itself and sends its version', async () => {
  const calls = server();
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  await screen.findByText('Fotobox');
  await openRowMenu('Fotobox');
  fireEvent.click(
    screen.getByRole('button', { name: 'Kategorie bearbeiten: Fotobox' }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Kategorie bearbeiten' });
  const parent = within(dialog).getByLabelText(
    'Innerhalb Kategorie',
  ) as HTMLSelectElement;
  expect(Array.from(parent.options).map((option) => option.text)).toEqual([
    'Keine (oberste Ebene)',
    'Requisiten',
  ]);
  fireEvent.change(within(dialog).getByLabelText('Name'), {
    target: { value: 'Fotoboxen' },
  });
  fireEvent.submit(parent.closest('form')!);
  await screen.findByText('Kategorie gespeichert.');
  expect(calls[0]).toEqual({
    url: '/api/v1/resource-categories/cat-fotobox',
    method: 'PUT',
    body: { name: 'Fotoboxen', parentId: null, version: 1 },
  });
  // Escape closes an unsaved edit without a request.
  await openRowMenu('Requisiten');
  fireEvent.click(
    screen.getByRole('button', { name: 'Kategorie bearbeiten: Requisiten' }),
  );
  const second = screen.getByRole('dialog', { name: 'Kategorie bearbeiten' });
  expect(
    (within(second).getByLabelText('Name') as HTMLInputElement).value,
  ).toBe('Requisiten');
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls).toHaveLength(1);
});

test('server refusals are explained and a conflict reloads the list', async () => {
  let refusal = 'name_exists';
  const fetcher = server(undefined, (_url, init) =>
    init.method === 'PUT' || init.method === 'DELETE'
      ? Response.json({ error: refusal }, { status: 409 })
      : undefined,
  );
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  await screen.findByText('Fotobox');
  await openRowMenu('Requisiten');
  fireEvent.click(
    screen.getByRole('button', { name: 'Kategorie bearbeiten: Requisiten' }),
  );
  fireEvent.submit(
    within(screen.getByRole('dialog'))
      .getByRole('button', { name: 'Speichern' })
      .closest('form')!,
  );
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Eine Kategorie mit diesem Namen gibt es schon.',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  refusal = 'conflict';
  fireEvent.submit(
    within(screen.getByRole('dialog'))
      .getByRole('button', { name: 'Speichern' })
      .closest('form')!,
  );
  await screen.findByText(/inzwischen geändert/);
  expect(
    (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) =>
        url === '/api/v1/resource-categories' && !(init as RequestInit)?.method,
    ).length,
  ).toBeGreaterThan(1);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  refusal = 'category_in_use';
  await openRowMenu('Fotobox');
  fireEvent.click(
    screen.getByRole('button', { name: 'Kategorie löschen: Fotobox' }),
  );
  expect((await screen.findByRole('alert')).textContent).toMatch(
    /noch Ressourcen zugeordnet/,
  );
  expect(fetcher.at(-1)).toEqual({
    url: '/api/v1/resource-categories/cat-fotobox',
    method: 'DELETE',
  });
});

test('a declined delete sends nothing; a confirmed one reloads and reports', async () => {
  const calls = server();
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  await screen.findByText('Fotobox');
  await openRowMenu('Spiegel');
  fireEvent.click(
    screen.getByRole('button', { name: 'Kategorie löschen: Spiegel' }),
  );
  expect(confirm).toHaveBeenCalledWith('Kategorie „Spiegel“ löschen?');
  expect(calls).toEqual([]);
  confirm.mockReturnValue(true);
  await openRowMenu('Spiegel');
  fireEvent.click(
    screen.getByRole('button', { name: 'Kategorie löschen: Spiegel' }),
  );
  await screen.findByText('Kategorie gelöscht.');
  expect(calls).toEqual([
    { url: '/api/v1/resource-categories/cat-mirror', method: 'DELETE' },
  ]);
});

test('a failed load says so and an empty list is honest', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Die Ressourcen-Einstellungen konnten nicht geladen werden.',
  );
  cleanup();
  server([]);
  render(<ResourceSettingsPanel csrfToken="csrf" />);
  expect(await screen.findByText('Noch keine Kategorien.')).toBeTruthy();
});

test('the navigation hides the resources entry when switched off, but never on its own page', async () => {
  let hidden = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/v1/settings/resources'
        ? Response.json({ hideNavigation: hidden })
        : Response.json([]),
    ),
  );
  window.history.replaceState(null, '', '/#events');
  render(<Navigation />);
  const sidebar = screen.getByLabelText('Arbeitsbereiche');
  await waitFor(() =>
    expect(
      within(sidebar).queryByRole('link', { name: 'Ressourcen' }),
    ).toBeNull(),
  );
  act(() => {
    window.history.replaceState(null, '', '/#resources');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(
    within(sidebar).getByRole('link', { name: 'Ressourcen' }),
  ).toBeTruthy();
  act(() => {
    window.history.replaceState(null, '', '/#events');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  hidden = false;
  await act(async () => {
    window.dispatchEvent(new Event(resourceSettingsEvent));
  });
  await waitFor(() =>
    expect(
      within(sidebar).getByRole('link', { name: 'Ressourcen' }),
    ).toBeTruthy(),
  );
});
