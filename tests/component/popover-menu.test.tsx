import { afterEach, expect, test, vi } from 'vitest';
import type { ToggleEvent } from 'react';
import {
  menuPanelProps,
  menuToggleProps,
  rowMenuState,
} from '../../apps/admin/src/popover-menu.js';

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
});

test('without popover support the panel falls back to hidden and the click', () => {
  const setOpen = vi.fn();
  const toggle = menuToggleProps('menu-a', false, setOpen);
  expect(toggle).not.toHaveProperty('popoverTarget');
  (toggle as { onClick: () => void }).onClick();
  expect(setOpen).toHaveBeenCalledWith(true);
  expect(menuPanelProps('menu-a', false, setOpen)).toMatchObject({
    id: 'menu-a',
    hidden: true,
  });
});

test('focus moving on past the menu closes it, but not into it or its toggle', () => {
  const setOpen = vi.fn();
  const { onBlur } = menuPanelProps('menu-a', true, setOpen);
  const panel = document.createElement('div');
  const inside = panel.appendChild(document.createElement('button'));
  const toggle = document.createElement('button');
  toggle.setAttribute('aria-controls', 'menu-a');
  const native = document.createElement('button');
  native.setAttribute('popovertarget', 'menu-a');
  const blur = (relatedTarget: EventTarget | null) =>
    onBlur({ currentTarget: panel, relatedTarget } as never);
  for (const target of [inside, toggle, native, null]) blur(target);
  expect(setOpen).not.toHaveBeenCalled();
  blur(document.createElement('button'));
  expect(setOpen).toHaveBeenCalledWith(false);
  setOpen.mockClear();
  menuPanelProps('menu-a', false, setOpen).onBlur({
    currentTarget: panel,
    relatedTarget: document.body,
  } as never);
  expect(setOpen).not.toHaveBeenCalled();
});

test('with popover support the browser owns opening, light dismiss feeds back', () => {
  HTMLElement.prototype.showPopover = () => {};
  const setOpen = vi.fn();
  const toggle = menuToggleProps('menu-a', true, setOpen);
  expect(toggle).toMatchObject({
    popoverTarget: 'menu-a',
    'aria-expanded': true,
  });
  // The anchor is scoped in CSS; no row carries an inline style.
  expect(toggle).not.toHaveProperty('style');
  const panel = menuPanelProps('menu-a', true, setOpen) as {
    popover: string;
    onToggle: (event: ToggleEvent<HTMLElement>) => void;
    ref: (element: HTMLElement | null) => void;
  };
  expect(panel.popover).toBe('auto');
  panel.onToggle({ newState: 'open' } as ToggleEvent<HTMLElement>);
  expect(setOpen).not.toHaveBeenCalled();
  panel.onToggle({ newState: 'closed' } as ToggleEvent<HTMLElement>);
  expect(setOpen).toHaveBeenCalledWith(false);
  // A shown popover whose state has not caught up yet stays shown.
  const hidePopover = vi.fn();
  const shown = { matches: () => true, hidePopover } as unknown as HTMLElement;
  const lagging = menuPanelProps('menu-a', false, setOpen) as typeof panel;
  lagging.ref(shown);
  panel.ref(shown);
  panel.ref(null);
  expect(hidePopover).not.toHaveBeenCalled();
  // A chosen action closed the state: the still shown popover follows.
  const closed = menuPanelProps('menu-a', false, setOpen) as typeof panel;
  closed.ref(shown);
  expect(hidePopover).toHaveBeenCalledOnce();
});

test('closing clears the open row only while it is still that row', () => {
  expect(rowMenuState('a', true, '')('b')).toBe('a');
  expect(rowMenuState('a', false, '')('a')).toBe('');
  // Another menu opened in the same moment keeps its claim.
  expect(rowMenuState('a', false, null)('b')).toBe('b');
});
