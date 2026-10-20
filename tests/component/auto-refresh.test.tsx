import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAutoRefresh } from '../../apps/admin/src/auto-refresh.js';

afterEach(() => {
  cleanup();
  setVisibility('visible');
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => state === 'hidden',
  });
}

function returnToApp() {
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
}

function Probe({
  onReturn,
  busy = false,
}: {
  onReturn: () => void;
  busy?: boolean;
}) {
  const [count, setCount] = useState(0);
  useAutoRefresh(onReturn, () => busy);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

test('focus and visibility of the same return trigger exactly one refresh', () => {
  const refreshed = vi.fn();
  render(<Probe onReturn={refreshed} />);
  setVisibility('visible');
  returnToApp();
  expect(refreshed).toHaveBeenCalledOnce();
  // The next return only starts after the document was left again.
  fireEvent(window, new Event('blur'));
  returnToApp();
  expect(refreshed).toHaveBeenCalledTimes(2);
});

test('focus arriving before visibility still yields one refresh', () => {
  const refreshed = vi.fn();
  render(<Probe onReturn={refreshed} />);
  setVisibility('visible');
  fireEvent(window, new Event('focus'));
  fireEvent(document, new Event('visibilitychange'));
  expect(refreshed).toHaveBeenCalledOnce();
});

test('a hidden document never refreshes', () => {
  const refreshed = vi.fn();
  render(<Probe onReturn={refreshed} />);
  setVisibility('hidden');
  returnToApp();
  expect(refreshed).not.toHaveBeenCalled();
});

test('an in-flight refresh is not started a second time', () => {
  const refreshed = vi.fn();
  const view = render(<Probe onReturn={refreshed} busy />);
  returnToApp();
  expect(refreshed).not.toHaveBeenCalled();
  view.rerender(<Probe onReturn={refreshed} busy={false} />);
  fireEvent(window, new Event('blur'));
  returnToApp();
  expect(refreshed).toHaveBeenCalledOnce();
});

test('state updates do not retrigger a refresh and unmounting removes the listeners', () => {
  const refreshed = vi.fn();
  const view = render(<Probe onReturn={refreshed} />);
  returnToApp();
  expect(refreshed).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button'));
  expect(refreshed).toHaveBeenCalledOnce();
  view.unmount();
  fireEvent(window, new Event('blur'));
  returnToApp();
  expect(refreshed).toHaveBeenCalledOnce();
});
