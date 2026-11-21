import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

/**
 * EDITOR-ACTIONS-01: one confirmed removal of a document or template position.
 * It reuses the established form dialog (backdrop, dialog box, footer) instead
 * of a new overlay: Escape, the backdrop and "Abbrechen" all keep the position
 * and hand the focus back to the action that asked, while only "Entfernen"
 * removes it.
 */
export function PositionRemoveDialog({
  position,
  message,
  onConfirm,
  onCancel,
}: {
  /** Visible row name, for example "Position 1". */
  position: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    headingId = useId();

  // The safe choice owns the first focus, so Enter never deletes by accident.
  useEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, []);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // The editor itself closes on Escape; this question stops that.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (!focusable.length) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = focusable[0]!,
      last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="form-dialog-backdrop"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialog}
        className="form-dialog position-remove-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <header className="form-dialog-header">
          <h3 id={headingId}>{position} entfernen?</h3>
        </header>
        <p>{message}</p>
        <div className="form-dialog-footer">
          <button
            ref={cancel}
            type="button"
            className="secondary-action"
            onClick={onCancel}
          >
            Abbrechen
          </button>
          <button type="button" className="primary-action" onClick={onConfirm}>
            Entfernen
          </button>
        </div>
      </div>
    </div>
  );
}
