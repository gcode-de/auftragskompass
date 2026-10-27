import { afterEach, expect, test, vi } from 'vitest';
import {
  confirmNavigation,
  installUnsavedNavigationGuard,
  registerUnsavedChanges,
} from '../../apps/admin/src/unsaved-changes.js';
import { updateUrlSearch } from '../../apps/admin/src/url-state.js';

let stop: (() => void) | undefined;
let unregister: (() => void) | undefined;
afterEach(() => {
  stop?.();
  unregister?.();
  vi.restoreAllMocks();
});
function setup() {
  window.history.replaceState(null, '', '/#contact-synthetic');
  unregister = registerUnsavedChanges(() => true, true);
  stop = installUnsavedNavigationGuard();
}
test('blocks an unguarded internal link before leaving a dirty record', () => {
  setup();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const anchor = document.createElement('a');
  anchor.href = '#calendar';
  document.body.append(anchor);
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  anchor.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  anchor.remove();
});
test('restores a cancelled browser history transition before route subscribers run', () => {
  setup();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const changed = vi.fn();
  window.addEventListener('popstate', changed);
  window.history.pushState(null, '', '/#contacts');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(window.location.hash).toBe('#contact-synthetic');
  expect(changed).not.toHaveBeenCalled();
  window.removeEventListener('popstate', changed);
});
test('does not ask twice when an existing navigation action was explicitly accepted', () => {
  setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  expect(confirmNavigation('Discard?', '#files')).toBe(true);
  window.history.pushState(null, '', '/#files');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(window.location.hash).toBe('#files');
  expect(confirm).toHaveBeenCalledTimes(1);
});
test('preserves modified-click links and allows clean navigation without a dialog', () => {
  setup();
  const confirm = vi.spyOn(window, 'confirm');
  const anchor = document.createElement('a');
  anchor.href = '#calendar';
  document.body.append(anchor);
  anchor.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
  );
  expect(confirm).not.toHaveBeenCalled();
  unregister?.();
  window.history.pushState(null, '', '/#calendar');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(confirm).not.toHaveBeenCalled();
  anchor.remove();
});

test('cancelling an event link also cancels its filter-reset handler', () => {
  setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const anchor = document.createElement('a');
  anchor.href = '#event-other';
  const reset = vi.fn(() => updateUrlSearch({ q: '' }));
  anchor.addEventListener('click', reset);
  document.body.append(anchor);
  anchor.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
  expect(reset).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(1);
  anchor.remove();
});

test('accepted event navigation asks once even when its handler first resets URL filters', () => {
  setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const anchor = document.createElement('a');
  anchor.href = '#event-other';
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    updateUrlSearch({ q: '' });
    window.history.pushState(null, '', '/#event-other');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  document.body.append(anchor);
  anchor.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
  expect(window.location.hash).toBe('#event-other');
  expect(confirm).toHaveBeenCalledTimes(1);
  anchor.remove();
});
