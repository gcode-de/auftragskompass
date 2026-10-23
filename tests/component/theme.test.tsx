import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// BKP005: the palette is one shared token block. jsdom has no cascade, so the
// shipped stylesheet is read directly; the browser measurement of the same
// contract lives in tests/e2e/shell.spec.ts.
const css = readFileSync(
  resolve(process.cwd(), 'apps/admin/src/styles.css'),
  'utf8',
);
const rootBlock = /(?:^|\n):root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

function themed(name: string) {
  const raw = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(rootBlock)?.[1];
  expect(raw, `token --${name}`).toBeTruthy();
  const pair =
    /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/i.exec(
      raw!.trim(),
    );
  expect(pair, `--${name} is one light-dark pair`).not.toBeNull();
  return { light: pair![1]!.toLowerCase(), dark: pair![2]!.toLowerCase() };
}

function fixed(name: string) {
  const raw = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(rootBlock)?.[1];
  expect(raw, `token --${name}`).toBeTruthy();
  const value = /^(#[0-9a-f]{6})$/i.exec(raw!.trim());
  expect(value, `--${name} is a plain colour`).not.toBeNull();
  return value![1]!.toLowerCase();
}

/** How far a colour leans green: the green channel above the red/blue mean. */
function greenness(value: string) {
  const channels = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
  return channels[1]! - (channels[0]! + channels[2]!) / 2;
}

test('neutral surfaces carry no green cast in either theme', () => {
  // The canvases, panels and tints the reader works on every day.
  for (const name of [
    'surface',
    'canvas',
    'field-surface',
    'table-surface',
    'status-surface',
    'hover-surface',
    'selected-surface',
    'selection',
    'disabled-surface',
  ]) {
    const palette = themed(name);
    for (const theme of ['light', 'dark'] as const)
      expect(
        greenness(palette[theme]),
        `--${name} (${theme}) stays neutral`,
      ).toBeLessThanOrEqual(4);
  }
  for (const name of ['sidebar', 'sidebar-hover']) {
    expect(
      greenness(fixed(name)),
      `--${name} is an anthracite`,
    ).toBeLessThanOrEqual(4);
  }
});

test('the restrained green survives only as a tinted accent', () => {
  // Removing every green would flatten the brand; these are the deliberate
  // small accents: links/actions, the pressed nav row and the focus tint.
  for (const name of ['accent', 'action', 'focus']) {
    const palette = themed(name);
    for (const theme of ['light', 'dark'] as const)
      expect(
        greenness(palette[theme]),
        `--${name} (${theme}) keeps a green accent`,
      ).toBeGreaterThanOrEqual(8);
  }
  // The active navigation row is the one tinted surface left in the rail, and
  // it stays a whisper rather than a green block.
  expect(greenness(fixed('sidebar-active'))).toBeLessThanOrEqual(12);
});
