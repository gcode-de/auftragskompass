import { fireEvent, screen } from '@testing-library/react';

/**
 * Opens an event card's ⋯ menu (a native popover; in jsdom its `hidden`
 * fallback) so its actions are reachable. An open menu stays open.
 */
export async function openRowMenu(name: string) {
  const toggle = await screen.findByRole('button', {
    name: 'Weitere Aktionen: ' + name,
  });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}
