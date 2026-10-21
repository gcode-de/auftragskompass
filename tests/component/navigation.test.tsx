import { afterEach, expect, test, vi } from 'vitest';
import { clickLink } from '../helpers/click-link.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  Navigation,
  SettingsNavigation,
  useWorkspaceRoute,
} from '../../apps/admin/src/Navigation.js';
import {
  useUrlSearch,
  eventQuery,
  updateUrlSearch,
} from '../../apps/admin/src/url-state.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
function Result() {
  return <p>{useUrlSearch()}</p>;
}
test('shared search preserves unrelated URL state, resets event filters and supports browser navigation', () => {
  window.history.replaceState(
    null,
    '',
    '/?status=option&from=2026-10-10&other=keep#search',
  );
  render(
    <>
      <Navigation />
      <Result />
    </>,
  );
  fireEvent.change(screen.getByLabelText('Globale Suche'), {
    target: { value: 'Synthetic & search' },
  });
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Events und Kontakte suchen' })
      .closest('form')!,
  );
  expect(window.location.search).toBe('?other=keep&q=Synthetic+%26+search');
  expect(eventQuery(window.location.search)).toBe('?q=Synthetic+%26+search');
  expect(eventQuery('?other=ignored')).toBe('');
  window.history.replaceState(null, '', '/?q=Fictional');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(screen.getByText('?q=Fictional')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Kontakte' }).getAttribute('href'),
  ).toBe('#contacts');
  cleanup();
  updateUrlSearch({ q: '' });
  expect(window.location.search).toBe('');
});

function Workspace() {
  const route = useWorkspaceRoute();
  return (
    <>
      <Navigation />
      <output aria-label="Arbeitsbereich">{route}</output>
    </>
  );
}
test('resolves deep links, settings and browser history without losing search', () => {
  window.history.replaceState(null, '', '/?q=Fictional#event-synthetic');
  render(<Workspace />);
  expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe('events');
  for (const [hash, section] of [
    ['#calendar', 'calendar'],
    ['#settings-calendar', 'subscriptions'],
    ['#settings', 'settings'],
    ['#search', 'search'],
    ['#products', 'products'],
    ['#import-review', 'import'],
    ['#settings-security', 'security'],
    ['#settings-export', 'export'],
    ['#settings-inquiry', 'inquiry'],
    ['#settings-resources', 'resources'],
    ['#settings-products', 'products'],
    ['#contact-synthetic', 'contacts'],
    ['#unknown', 'events'],
  ]) {
    window.history.replaceState(null, '', '/?q=Fictional' + hash);
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe(section);
  }
  window.history.replaceState(null, '', '/?q=Fictional#resources');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe('resources');
  expect(window.location.search).toBe('?q=Fictional');
  window.history.replaceState(null, '', '/?q=Fictional#settings-products');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe('products');
  expect(window.location.search).toBe('?q=Fictional');
});

test('settings own resource and product management in desktop and mobile navigation', () => {
  window.history.replaceState(null, '', '/#resources');
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  render(
    <>
      <Navigation />
      <SettingsNavigation />
    </>,
  );
  const sidebar = screen.getByLabelText('Arbeitsbereiche');
  expect(
    within(sidebar).queryByRole('link', { name: 'Ressourcen' }),
  ).toBeNull();
  expect(within(sidebar).queryByRole('link', { name: 'Produkte' })).toBeNull();
  expect(
    within(sidebar)
      .getByRole('link', { name: 'Einstellungen' })
      .getAttribute('aria-current'),
  ).toBe('page');
  const settingsNavigation = screen.getByRole('navigation', {
    name: 'Einstellungen',
  });
  const resourcesLink = within(settingsNavigation).getByRole('link', {
    name: 'Ressourcen',
  });
  const productsLink = within(settingsNavigation).getByRole('link', {
    name: 'Produkte',
  });
  expect(resourcesLink.getAttribute('href')).toBe('#settings-resources');
  expect(productsLink.getAttribute('href')).toBe('#settings-products');
  expect(resourcesLink.getAttribute('aria-current')).toBe('page');
  expect(productsLink.getAttribute('aria-current')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Menü öffnen' }));
  const drawer = screen.getByRole('dialog', { name: 'Menü' });
  expect(
    within(drawer).queryByRole('link', {
      name: 'Ressourcen',
      hidden: true,
    }),
  ).toBeNull();
  expect(
    within(drawer).queryByRole('link', { name: 'Produkte', hidden: true }),
  ).toBeNull();
  expect(
    within(drawer)
      .getByRole('link', { name: 'Einstellungen' })
      .getAttribute('aria-current'),
  ).toBe('page');

  for (const [hash, current, other] of [
    ['#settings-products', 'Produkte', 'Ressourcen'],
    ['#products', 'Produkte', 'Ressourcen'],
    ['#resources', 'Ressourcen', 'Produkte'],
    ['#settings-resources', 'Ressourcen', 'Produkte'],
  ] as const) {
    window.history.replaceState(null, '', '/' + hash);
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(
      within(settingsNavigation)
        .getByRole('link', { name: current })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(settingsNavigation)
        .getByRole('link', { name: other })
        .getAttribute('aria-current'),
    ).toBeNull();
    expect(
      within(sidebar)
        .getByRole('link', { name: 'Einstellungen' })
        .getAttribute('aria-current'),
    ).toBe('page');
  }
});
test('mobile menu opens as a modal and closes on selection or Escape', () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  render(<Workspace />);
  const trigger = screen.getByRole('button', { name: 'Menü öffnen' });
  expect(trigger.getAttribute('title')).toBe('Menü öffnen');
  fireEvent.click(screen.getByRole('link', { name: 'Events' }));
  fireEvent.click(trigger, { detail: 1 });
  const dialog = screen.getByRole('dialog', { name: 'Menü' });
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(
    within(dialog)
      .getByRole('button', { name: 'Menü schließen' })
      .getAttribute('title'),
  ).toBe('Menü schließen');
  fireEvent.click(within(dialog).getByRole('link', { name: 'Kontakte' }));
  expect(dialog.hasAttribute('open')).toBe(false);
  fireEvent.click(trigger);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Menü schließen' }),
  );
  expect(dialog.hasAttribute('open')).toBe(false);
  fireEvent.click(trigger);
  window.history.replaceState(null, '', '/#events');
  const menuBrand = within(dialog).getByRole('link', {
    name: 'AuftragsKompass – zur Eventübersicht',
  });
  expect(menuBrand.getAttribute('href')).toBe('#events');
  expect(clickLink(menuBrand)).toBe(true);
  expect(dialog.hasAttribute('open')).toBe(false);
  fireEvent.click(trigger);
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  fireEvent(dialog, new Event('close'));
  fireEvent.click(trigger);
  fireEvent.click(dialog, { clientX: 400, clientY: 10 });
  expect(dialog.hasAttribute('open')).toBe(false);
  expect(
    screen
      .getByRole('button', { name: 'Menü öffnen' })
      .getAttribute('aria-expanded'),
  ).toBe('false');
});

test('keeps account actions in the menu and reveals the mobile copy only while open', () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  render(<Navigation account={<button>Fictional logout</button>} />);
  expect(screen.getAllByText('Fictional logout')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Menü öffnen' }));
  expect(
    within(screen.getByRole('dialog', { name: 'Menü' })).getByRole('button', {
      name: 'Fictional logout',
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Menü schließen' }));
  expect(screen.getAllByText('Fictional logout')).toHaveLength(1);
});

test.each(['#events', '#search'])(
  'desktop switch closes the mobile menu and restores visible focus on %s',
  (hash) => {
    window.history.replaceState(null, '', '/' + hash);
    let changed = () => {};
    const viewport = {
      matches: false,
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        changed = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => viewport),
    );
    HTMLDialogElement.prototype.showModal = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });
    render(<Navigation />);
    viewport.matches = true;
    act(changed);
    viewport.matches = false;
    const trigger = screen.getByRole('button', { name: 'Menü öffnen' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', {
      name: 'Menü',
    }) as HTMLDialogElement;
    act(changed);
    expect(dialog.open).toBe(true);
    viewport.matches = true;
    act(changed);
    expect(dialog.open).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    const target =
      hash === '#search'
        ? screen.getByLabelText('Globale Suche')
        : within(screen.getByLabelText('Arbeitsbereiche')).getByRole('link', {
            name: 'Events',
          });
    expect(document.activeElement).toBe(target);
    cleanup();
    expect(viewport.removeEventListener).toHaveBeenCalledWith(
      'change',
      changed,
    );
  },
);
test('brand and workspace title are real home links from both layouts without dropping filters', () => {
  window.history.replaceState(null, '', '/?q=Fictional#calendar');
  const confirm = vi.spyOn(window, 'confirm');
  render(<Workspace />);
  const brand = within(screen.getByLabelText('Arbeitsbereiche')).getByRole(
    'link',
    { name: 'AuftragsKompass – zur Eventübersicht' },
  );
  const title = screen.getByRole('link', {
    name: 'Kalender – zur Eventübersicht',
  });
  expect(brand.getAttribute('href')).toBe('#events');
  expect(title.getAttribute('href')).toBe('#events');
  brand.focus();
  expect(document.activeElement).toBe(brand);
  // jsdom does not perform fragment navigation itself. The real click must not
  // be cancelled; the following replaceState mirrors the browser's hash step.
  expect(clickLink(brand, 0)).toBe(false);
  window.history.replaceState(null, '', '/?q=Fictional#events');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(window.location.hash).toBe('#events');
  expect(window.location.search).toBe('?q=Fictional');
  expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe('events');
  expect(confirm).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/?q=Fictional#calendar');
  fireEvent(window, new HashChangeEvent('hashchange'));
  const titleLink = screen.getByRole('link', {
    name: 'Kalender – zur Eventübersicht',
  });
  expect(clickLink(titleLink)).toBe(false);
  window.history.replaceState(null, '', '/?q=Fictional#events');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(window.location.hash).toBe('#events');
  expect(window.location.search).toBe('?q=Fictional');
  expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe('events');
  expect(clickLink(brand)).toBe(true);
  expect(window.location.hash).toBe('#events');
  expect(window.location.search).toBe('?q=Fictional');
  expect(confirm).not.toHaveBeenCalled();
});

test('shows the running version next to the brand without disturbing navigation', () => {
  render(<Navigation />);
  const sidebar = within(screen.getByLabelText('Arbeitsbereiche'));
  expect(sidebar.getByText(/^Version /)).toBeTruthy();
  expect(sidebar.getByText(/^Version /).textContent).toBe(
    'Version Entwicklung',
  );
  expect(sidebar.getByRole('link', { name: 'Events' })).toBeTruthy();
});

test('desktop navigation collapses to labelled icons and remembers the preference', () => {
  window.history.replaceState(null, '', '/#events');
  render(<Workspace />);
  const sidebar = screen.getByLabelText('Arbeitsbereiche');
  const collapse = within(sidebar).getByRole('button', {
    name: 'Navigation einklappen',
  });
  expect(collapse.getAttribute('title')).toBe('Navigation einklappen');
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  collapse.focus();
  fireEvent.click(collapse);
  expect(sidebar.className).toContain('collapsed');
  expect(localStorage.getItem('ak-sidebar')).toBe('collapsed');
  const events = within(sidebar).getByRole('link', { name: 'Events' });
  expect(events.getAttribute('title')).toBe('Events');
  expect(events.getAttribute('aria-current')).toBe('page');
  expect(document.activeElement?.getAttribute('aria-label')).toBe(
    'Navigation ausklappen',
  );
  cleanup();
  render(<Workspace />);
  const collapsedSidebar = screen.getByLabelText('Arbeitsbereiche');
  expect(collapsedSidebar.className).toContain('collapsed');
  const expand = within(collapsedSidebar).getByRole('button', {
    name: 'Navigation ausklappen',
  });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(expand);
  expect(collapsedSidebar.className).not.toContain('collapsed');
  expect(localStorage.getItem('ak-sidebar')).toBe('expanded');
  const collapsedBrand = within(collapsedSidebar).getByRole('link', {
    name: 'AuftragsKompass – zur Eventübersicht',
  });
  expect(collapsedBrand.getAttribute('title')).toBe(
    'AuftragsKompass – zur Eventübersicht',
  );
  localStorage.setItem('ak-sidebar', 'collapsed');
  fireEvent(window, new StorageEvent('storage', { key: 'ak-sidebar' }));
  expect(collapsedSidebar.className).toContain('collapsed');
  localStorage.clear();
  fireEvent(window, new StorageEvent('storage', { key: null }));
  expect(collapsedSidebar.className).not.toContain('collapsed');
});

test('an unknown sidebar preference falls back to expanded', () => {
  localStorage.setItem('ak-sidebar', 'invalid');
  render(<Workspace />);
  expect(screen.getByLabelText('Arbeitsbereiche').className).not.toContain(
    'collapsed',
  );
  expect(
    screen.getByRole('button', { name: 'Navigation einklappen' }),
  ).toBeTruthy();
});

test('global search expands from an icon, keeps a draft on close and submits with the hash', () => {
  window.history.replaceState(null, '', '/?status=option#calendar');
  render(<Workspace />);
  const open = screen.getByRole('button', { name: 'Suche öffnen' });
  expect(open.getAttribute('title')).toBe('Suche öffnen');
  expect(open.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(open);
  const input = screen.getByLabelText('Globale Suche') as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(
    screen
      .getByRole('button', { name: 'Events und Kontakte suchen' })
      .getAttribute('title'),
  ).toBe('Events und Kontakte suchen');
  expect(
    screen
      .getByRole('button', { name: 'Suche schließen' })
      .getAttribute('title'),
  ).toBe('Suche schließen');
  fireEvent.change(input, { target: { value: 'Synthetic draft search' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByLabelText('Globale Suche')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'Suche öffnen' });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(
    (screen.getByLabelText('Globale Suche') as HTMLInputElement).value,
  ).toBe('Synthetic draft search');
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Events und Kontakte suchen' })
      .closest('form')!,
  );
  expect(window.location.hash).toBe('#search');
  expect(window.location.search).toContain('q=Synthetic+draft+search');
  expect(screen.getByLabelText('Arbeitsbereich').textContent).toBe('search');
  expect(screen.getByLabelText('Globale Suche')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Suche schließen' }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Suche öffnen' }),
  );
});

test('sidebar collapse still works when browser storage is blocked', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<Workspace />);
  const sidebar = screen.getByLabelText('Arbeitsbereiche');
  expect(sidebar.className).not.toContain('collapsed');
  fireEvent.click(
    within(sidebar).getByRole('button', { name: 'Navigation einklappen' }),
  );
  expect(sidebar.className).toContain('collapsed');
  get.mockRestore();
  set.mockRestore();
});

test('shrinking to the mobile breakpoint moves focused sidebar controls to the menu trigger', () => {
  window.history.replaceState(null, '', '/#events');
  let changed = () => {};
  const viewport = {
    matches: true,
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      changed = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => viewport),
  );
  render(<Workspace />);
  const sidebar = screen.getByLabelText('Arbeitsbereiche');
  const toggle = within(sidebar).getByRole('button', {
    name: 'Navigation einklappen',
  });
  toggle.focus();
  expect(document.activeElement).toBe(toggle);
  viewport.matches = false;
  act(changed);
  const trigger = screen.getByRole('button', { name: 'Menü öffnen' });
  expect(document.activeElement).toBe(trigger);
  expect(document.activeElement).not.toBe(document.body);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Suche öffnen' }));
  });
  const input = screen.getByLabelText('Globale Suche');
  expect(document.activeElement).toBe(input);
  viewport.matches = true;
  act(changed);
  viewport.matches = false;
  act(changed);
  expect(document.activeElement).toBe(input);
});
