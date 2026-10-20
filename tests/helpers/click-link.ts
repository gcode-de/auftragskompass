import { fireEvent } from '@testing-library/react';

/**
 * Dispatches a real click while suppressing jsdom's unimplemented fragment
 * navigation. Returns whether the application cancelled the navigation.
 */
export function clickLink(
  link: HTMLElement,
  detail = 1,
  init: MouseEventInit = {},
): boolean {
  let cancelled = true;
  const guard = (event: Event) => {
    cancelled = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('click', guard);
  try {
    fireEvent.click(link, { detail, ...init });
  } finally {
    window.removeEventListener('click', guard);
  }
  return cancelled;
}
