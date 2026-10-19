import { afterEach, expect, test, vi } from 'vitest';
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
  fireEvent.click(screen.getByRole('link', { name: 'Events' }));
  fireEvent.click(trigger, { detail: 1 });
  const dialog = screen.getByRole('dialog', { name: 'Menü' });
  expect(dialog.hasAttribute('open')).toBe(true);
  fireEvent.click(within(dialog).getByRole('link', { name: 'Kontakte' }));
  expect(dialog.hasAttribute('open')).toBe(false);
  fireEvent.click(trigger);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Menü schließen' }),
  );
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
        ? screen.getByRole('link', { name: 'Suche' })
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
test('shows the running version next to the brand without disturbing navigation', () => {
  render(<Navigation />);
  const sidebar = within(screen.getByLabelText('Arbeitsbereiche'));
  expect(sidebar.getByText(/^Version /)).toBeTruthy();
  expect(sidebar.getByText(/^Version /).textContent).toBe(
    'Version Entwicklung',
  );
  expect(sidebar.getByRole('link', { name: 'Events' })).toBeTruthy();
});
