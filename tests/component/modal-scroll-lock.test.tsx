import { describe, expect, test, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import {
  installModalScrollLock,
  useModalScrollLock,
} from '../../apps/admin/src/modalScrollLock.js';

// UI-SCROLL-01: the page behind an open modal dialog must not scroll. The
// lock follows the DOM - a native <dialog open> or a [role="dialog"]
// element - so no dialog can be missed and stacked dialogs need no counter.

const releases: Array<() => void> = [];

afterEach(() => {
  while (releases.length) releases.pop()!();
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

function install() {
  releases.push(installModalScrollLock());
}

function openNativeDialog() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.append(dialog);
  return dialog;
}

function openRoleDialog() {
  const div = document.createElement('div');
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-modal', 'true');
  document.body.append(div);
  return div;
}

describe('modal scroll lock', () => {
  test('an open native dialog freezes body scrolling and closing restores it', async () => {
    install();
    const dialog = openNativeDialog();
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    dialog.remove();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  test('an open role="dialog" element locks the same way', async () => {
    install();
    const div = openRoleDialog();
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    div.remove();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  test('stacked dialogs keep the lock until the last one closes', async () => {
    install();
    const outer = openRoleDialog();
    const inner = openRoleDialog();
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    inner.remove();
    // Still one dialog open: the page stays put.
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    outer.remove();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  test('a dialog that opens and closes in one step leaves no lock behind', async () => {
    install();
    const dialog = openNativeDialog();
    dialog.remove();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  test('the lock preserves and restores an existing body overflow value', async () => {
    document.body.style.overflow = 'scroll';
    install();
    const div = openRoleDialog();
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    div.remove();
    await waitFor(() => expect(document.body.style.overflow).toBe('scroll'));
  });

  test('closing the native dialog via the open attribute releases the lock', async () => {
    install();
    const dialog = openNativeDialog();
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    dialog.removeAttribute('open');
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  test('the hook installs and releases with its component', async () => {
    function Shell() {
      useModalScrollLock();
      return null;
    }
    const view = render(<Shell />);
    openNativeDialog();
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));
    act(() => view.unmount());
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });
});
