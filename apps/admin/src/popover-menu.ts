import type { FocusEvent, PointerEvent, ToggleEvent } from 'react';

// Modern web guidance: a ⋯ menu is a native popover. The browser puts it in
// the top layer (no clipping by scrolling lists), closes it on a press
// elsewhere or Escape and keeps one auto popover open at a time; CSS anchor
// positioning keeps it under its toggle (one anchor name, scoped per row in
// CSS). The caller keeps the open state and renders a panel only while it is
// open (`menuRendered`), so a list of 500 rows carries no closed popovers and
// no per-row listeners (PERF-MENU-01). The panel shows itself when mounted;
// its toggle event feeds light dismiss and Escape back into the state.
// Without popover support (jsdom) the panel stays rendered with `hidden`.
const supported = () =>
  typeof HTMLElement === 'function' &&
  typeof HTMLElement.prototype.showPopover === 'function';

/** Whether the caller renders the menu panel at all. */
export function menuRendered(open: boolean) {
  return open || !supported();
}

// The press on an open menu's toggle light-dismisses it before the click
// arrives; the click must then not open it again.
const pressedWhileOpen = new WeakSet<Element>();

export function menuToggleProps(
  id: string,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  if (!supported())
    return { 'aria-expanded': open, onClick: () => setOpen(!open) };
  return {
    'aria-expanded': open,
    // Names the menu even while it is not rendered (aria-expanded=false).
    'aria-controls': id,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (open) pressedWhileOpen.add(event.currentTarget);
    },
    onClick: (event: { currentTarget: Element }) => {
      const pressed = pressedWhileOpen.delete(event.currentTarget);
      setOpen(!(open || pressed));
    },
  };
}

export function menuPanelProps(
  id: string,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  // Focus moving on past the menu closes it, as the former disclosures did;
  // a move back to its own toggle leaves the toggle in charge.
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (
      open &&
      next instanceof Element &&
      !event.currentTarget.contains(next) &&
      next.getAttribute('aria-controls') !== id
    )
      setOpen(false);
  };
  if (!supported()) return { id, hidden: !open, onBlur };
  return {
    id,
    onBlur,
    popover: 'auto' as const,
    onToggle: (event: ToggleEvent<HTMLElement>) => {
      if (event.newState === 'closed') setOpen(false);
    },
    // Mounted only while open: show it at once.
    ref: (element: HTMLElement | null) => {
      if (element && !element.matches(':popover-open')) element.showPopover();
    },
  };
}

/**
 * The next "which row's menu is open" value: opening names the row, closing
 * clears it only while it is still that row's (another menu may already have
 * taken over in the same moment).
 */
export function rowMenuState<T>(row: T, open: boolean, none: T) {
  return (current: T) => (open ? row : current === row ? none : current);
}
