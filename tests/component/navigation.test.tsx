import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Navigation } from '../../apps/admin/src/Navigation.js';
import {
  useUrlSearch,
  eventQuery,
  updateUrlSearch,
} from '../../apps/admin/src/url-state.js';
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
function Result() {
  return <p>{useUrlSearch()}</p>;
}
test('shared search preserves unrelated URL state, resets event filters and supports browser navigation', () => {
  window.history.replaceState(
    null,
    '',
    '/?status=option&from=2026-10-10&other=keep',
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
