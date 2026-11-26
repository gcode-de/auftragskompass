import { afterEach, expect, test, vi } from 'vitest';
import type { ToggleEvent } from 'react';
import {
  menuPanelProps,
  menuRendered,
  menuToggleProps,
  rowMenuState,
} from '../../apps/admin/src/popover-menu.js';

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
});

test('without popover support the panel stays rendered with hidden and the click', () => {
  const setOpen = vi.fn();
  expect(menuRendered(false)).toBe(true);
  const toggle = menuToggleProps('menu-a', false, setOpen);
  expect(toggle).not.toHaveProperty('onPointerDown');
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
  const blur = (relatedTarget: EventTarget | null) =>
    onBlur({ currentTarget: panel, relatedTarget } as never);
  for (const target of [inside, toggle, null]) blur(target);
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

test('with popover support only the open menu is rendered and shows itself', () => {
  HTMLElement.prototype.showPopover = () => {};
  expect(menuRendered(false)).toBe(false);
  expect(menuRendered(true)).toBe(true);
  const setOpen = vi.fn();
  const panel = menuPanelProps('menu-a', true, setOpen) as {
    popover: string;
    onToggle: (event: ToggleEvent<HTMLElement>) => void;
    ref: (element: HTMLElement | null) => void;
  };
  expect(panel.popover).toBe('auto');
  // Mounting shows it once; an already shown one is left alone.
  const showPopover = vi.fn();
  panel.ref({ matches: () => false, showPopover } as unknown as HTMLElement);
  panel.ref({ matches: () => true, showPopover } as unknown as HTMLElement);
  panel.ref(null);
  expect(showPopover).toHaveBeenCalledOnce();
  // Light dismiss and Escape arrive as the toggle event.
  panel.onToggle({ newState: 'open' } as ToggleEvent<HTMLElement>);
  expect(setOpen).not.toHaveBeenCalled();
  panel.onToggle({ newState: 'closed' } as ToggleEvent<HTMLElement>);
  expect(setOpen).toHaveBeenCalledWith(false);
});

test('a press on the open toggle that light-dismissed the menu does not reopen it', () => {
  HTMLElement.prototype.showPopover = () => {};
  const setOpen = vi.fn();
  const button = document.createElement('button');
  type Toggle = {
    'aria-controls'?: string;
    onPointerDown: (event: { currentTarget: Element }) => void;
    onClick: (event: { currentTarget: Element }) => void;
  };
  const closed = menuToggleProps('menu-a', false, setOpen) as Toggle;
  expect(closed['aria-controls']).toBe('menu-a');
  closed.onPointerDown({ currentTarget: button });
  closed.onClick({ currentTarget: button });
  expect(setOpen).toHaveBeenLastCalledWith(true);
  const open = menuToggleProps('menu-a', true, setOpen) as Toggle;
  expect(open['aria-controls']).toBe('menu-a');
  open.onPointerDown({ currentTarget: button });
  // The dismiss already reported closed; the click arrives on a closed menu.
  const after = menuToggleProps('menu-a', false, setOpen) as Toggle;
  after.onClick({ currentTarget: button });
  expect(setOpen).toHaveBeenLastCalledWith(false);
  // Keyboard: no press, the click closes the open menu.
  open.onClick({ currentTarget: button });
  expect(setOpen).toHaveBeenLastCalledWith(false);
});

test('closing clears the open row only while it is still that row', () => {
  expect(rowMenuState('a', true, '')('b')).toBe('a');
  expect(rowMenuState('a', false, '')('a')).toBe('');
  // Another menu opened in the same moment keeps its claim.
  expect(rowMenuState('a', false, null)('b')).toBe('b');
});
