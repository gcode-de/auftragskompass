import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type DialogHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

// While a modal is open the page behind is inert, so a caller that hands the
// focus back to its trigger in the same click that closes the dialog would
// focus nothing. Such a request is remembered and fulfilled once the dialog is
// gone; a focus inside an open dialog clears it.
let openModals = 0,
  pendingFocus: HTMLElement | null = null;
const nativeFocus = HTMLElement.prototype.focus;
function rememberFocus(this: HTMLElement, options?: FocusOptions) {
  pendingFocus = this.closest('dialog[open]') ? null : this;
  nativeFocus.call(this, options);
}
function trackFocus() {
  if (openModals++ === 0) HTMLElement.prototype.focus = rememberFocus;
}
function releaseFocus() {
  if (--openModals > 0) return;
  HTMLElement.prototype.focus = nativeFocus;
  const target = pendingFocus;
  pendingFocus = null;
  if (target?.isConnected) nativeFocus.call(target, { preventScroll: true });
}

type ModalDialogProps = Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  'open' | 'onCancel'
> & {
  busy?: boolean;
  /** Close on a press outside the box; off for forms that hold input. */
  dismissOnBackdrop?: boolean;
  onDismiss: () => void;
};

/**
 * Modern web guidance: one native modal dialog for every confirmation and
 * form box. `showModal()` makes the page behind inert, keeps the focus inside
 * and draws `::backdrop`, so no own focus trap or overlay element is needed.
 * Escape and (optionally) a click on the backdrop dismiss it unless `busy`.
 */
export const ModalDialog = forwardRef<HTMLDialogElement, ModalDialogProps>(
  function ModalDialog(
    {
      busy = false,
      dismissOnBackdrop = false,
      onDismiss,
      onKeyDown,
      onMouseDown,
      children,
      ...rest
    },
    ref,
  ) {
    const own = useRef<HTMLDialogElement>(null);
    useImperativeHandle(ref, () => own.current!, []);
    useEffect(() => {
      const dialog = own.current!;
      // jsdom has no showModal; browsers get the real modal behaviour.
      if (typeof dialog.showModal !== 'function') {
        dialog.setAttribute('open', '');
        return;
      }
      // A modal on a hidden workspace page (the operator switched areas and
      // the draft waits) would leave the visible page inert, so it steps out
      // of the top layer while hidden and comes back with its draft.
      let frame = 0;
      const sync = () => {
        const hidden = Boolean(dialog.parentElement?.closest('[hidden]'));
        if (hidden && dialog.open) dialog.close();
        else if (!hidden && !dialog.open) dialog.showModal();
      };
      const later = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(sync);
      };
      trackFocus();
      sync();
      window.addEventListener('hashchange', later);
      window.addEventListener('popstate', later);
      // Unmounting removes the element; no close(), whose focus restoration
      // would override the focus the caller hands back.
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('hashchange', later);
        window.removeEventListener('popstate', later);
        releaseFocus();
      };
    }, []);
    return (
      <dialog
        ref={own}
        {...rest}
        // The browser's own cancel (e.g. a back gesture) takes the same path.
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) onDismiss();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDialogElement>) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== 'Escape') return;
          // Handled here, so an editor behind never reacts to the same key.
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onDismiss();
        }}
        onMouseDown={(event: MouseEvent<HTMLDialogElement>) => {
          onMouseDown?.(event);
          if (!dismissOnBackdrop || busy) return;
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          const inside =
            event.clientX >= box.left &&
            event.clientX <= box.right &&
            event.clientY >= box.top &&
            event.clientY <= box.bottom;
          if (!inside) onDismiss();
        }}
      >
        {children}
      </dialog>
    );
  },
);
