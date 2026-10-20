import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { ThemeToggle } from '../../apps/admin/src/ThemeToggle.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
function system(dark: boolean) {
  const media = Object.assign(new EventTarget(), { matches: dark });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return media;
}
test('follows the system until an explicit choice, then persists and restores it', () => {
  const media = system(false);
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe('light');
  media.matches = true;
  act(() => {
    media.dispatchEvent(new Event('change'));
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  const light = screen.getByRole('button', {
    name: 'Hellmodus aktivieren',
  });
  expect(light.getAttribute('title')).toBe('Hellmodus aktivieren');
  fireEvent.click(light);
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('ak-theme')).toBe('light');
  expect(
    screen
      .getByRole('button', { name: 'Dunkelmodus aktivieren' })
      .getAttribute('title'),
  ).toBe('Dunkelmodus aktivieren');
  media.matches = false;
  act(() => {
    media.dispatchEvent(new Event('change'));
  });
  media.matches = true;
  act(() => {
    media.dispatchEvent(new Event('change'));
  });
  expect(document.documentElement.dataset.theme).toBe('light');
  cleanup();
  render(<ThemeToggle />);
  expect(
    screen
      .getByRole('button', { name: 'Dunkelmodus aktivieren' })
      .getAttribute('aria-pressed'),
  ).toBe('false');
});
test('ignores invalid preferences and synchronizes another tab or cleared preferences', () => {
  system(true);
  localStorage.setItem('ak-theme', 'invalid');
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe('dark');
  localStorage.setItem('ak-theme', 'light');
  fireEvent(window, new StorageEvent('storage', { key: 'ak-theme' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  localStorage.clear();
  fireEvent(window, new StorageEvent('storage', { key: null }));
  expect(document.documentElement.dataset.theme).toBe('dark');
});
test('still switches when browser storage is unavailable', () => {
  const media = system(false);
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<ThemeToggle />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Dunkelmodus aktivieren' }),
  );
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(
    screen.getByRole('button', { name: 'Hellmodus aktivieren' }),
  ).toBeTruthy();
  act(() => {
    media.dispatchEvent(new Event('change'));
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  get.mockRestore();
  set.mockRestore();
});

test.each(['light', 'dark'])(
  'restores saved %s regardless of system appearance',
  (saved) => {
    system(saved !== 'dark');
    localStorage.setItem('ak-theme', saved);
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe(saved);
    fireEvent(window, new StorageEvent('storage', { key: 'unrelated' }));
    expect(document.documentElement.dataset.theme).toBe(saved);
  },
);
