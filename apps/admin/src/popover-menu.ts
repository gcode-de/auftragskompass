import type { FocusEvent, ToggleEvent } from 'react';

// Modern web guidance: a ⋯ menu is a native popover. The browser puts it in
// the top layer (no clipping by scrolling lists), closes it on a press
// elsewhere or Escape and keeps one auto popover open at a time; CSS anchor
// positioning keeps it under its toggle (one anchor name, scoped per row in
// CSS, so 500 rows carry no inline styles). The caller keeps the open state so
// labels and focus hand-back stay in React; the popover's toggle event feeds
// light dismiss back into that state. Without popover support (jsdom) the
// panel falls back to `hidden` and the toggle's own click.
const supported = () =>
  typeof HTMLElement === 'function' &&
  typeof HTMLElement.prototype.showPopover === 'function';

const shownState = new WeakMap<HTMLElement, boolean>();

export function menuToggleProps(
  id: string,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  return supported()
    ? { popoverTarget: id, 'aria-expanded': open }
    : { 'aria-expanded': open, onClick: () => setOpen(!open) };
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
      next.getAttribute('aria-controls') !== id &&
      next.getAttribute('popovertarget') !== id
    )
      setOpen(false);
  };
  if (!supported()) return { id, hidden: !open, onBlur };
  return {
    id,
    onBlur,
    popover: 'auto' as const,
    onToggle: (event: ToggleEvent<HTMLElement>) => {
      const next = event.newState === 'open';
      if (next !== open) setOpen(next);
    },
    // A chosen action closes the menu through the state; mirror it here.
    // Only a real open → closed change hides: a render caused by another
    // menu may arrive before this one's own open event.
    ref: (element: HTMLElement | null) => {
      if (!element) return;
      if (!open && shownState.get(element) && element.matches(':popover-open'))
        element.hidePopover();
      shownState.set(element, open);
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
