import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { ModalDialog } from '../../apps/admin/src/ModalDialog.js';

// jsdom has no top layer; a minimal showModal/close stands in for the browser
// so the browser branch (page visibility, focus hand-back) is exercised.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((step) => {
    step(0);
    return 1;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});

function Host({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" id="trigger">
        Öffnen
      </button>
      {open && (
        <ModalDialog
          aria-label="Synthetic dialog"
          busy={busy}
          dismissOnBackdrop
          onDismiss={() => {
            // the caller hands the focus back while the page is still inert
            document.getElementById('trigger')!.focus();
            setOpen(false);
          }}
        >
          <button type="button">Inside</button>
        </ModalDialog>
      )}
    </div>
  );
}

test('a native modal opens, dismisses on Escape and hands the focus back', () => {
  const { container } = render(<Host />);
  const dialog = container.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  // a focus inside the dialog is not taken for a hand-back request
  dialog.querySelector('button')!.focus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement?.id).toBe('trigger');
  expect(HTMLElement.prototype.focus.name).toBe('focus');
});

test('only a press outside the box dismisses, and never while busy', () => {
  const { container, rerender } = render(<Host busy />);
  const dialog = container.querySelector('dialog')!;
  fireEvent.mouseDown(dialog, { clientX: -10, clientY: -10 });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(container.querySelector('dialog')).not.toBeNull();
  rerender(<Host />);
  fireEvent.mouseDown(dialog, { clientX: 0, clientY: 0 });
  fireEvent.mouseDown(dialog.querySelector('button')!);
  expect(container.querySelector('dialog')).not.toBeNull();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(container.querySelector('dialog')).toBeNull();
});

test('a modal on a hidden page leaves the top layer and returns with it', () => {
  const { container } = render(
    <section>
      <ModalDialog aria-label="Waiting draft" onDismiss={() => {}}>
        Draft
      </ModalDialog>
    </section>,
  );
  const page = container.querySelector('section')!;
  const dialog = container.querySelector('dialog')!;
  page.hidden = true;
  act(() => {
    window.dispatchEvent(new Event('hashchange'));
  });
  expect(dialog.open).toBe(false);
  page.hidden = false;
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(dialog.open).toBe(true);
});
