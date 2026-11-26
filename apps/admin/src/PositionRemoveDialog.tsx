import { useEffect, useId, useRef } from 'react';
import { ModalDialog } from './ModalDialog.js';

/**
 * EDITOR-ACTIONS-01 / PRODUCTS-DELETE-01: one confirmed removal. It reuses the
 * established form dialog (backdrop, dialog box, footer) instead of a new
 * overlay: Escape, the backdrop and "Abbrechen" all keep the record and hand
 * the focus back to the action that asked, while only the destructive button
 * removes it. A caller that removes a whole record (a product) sets its own
 * `heading` and `confirmLabel`; while the request is pending both choices are
 * disabled so the dialog cannot be confirmed twice.
 */
export function PositionRemoveDialog({
  position,
  heading,
  confirmLabel = 'Entfernen',
  busy = false,
  message,
  onConfirm,
  onCancel,
}: {
  /** Visible row name, for example "Position 1"; ignored when `heading` is set. */
  position: string;
  /** Full question for a record that is not a document position. */
  heading?: string;
  confirmLabel?: string;
  busy?: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    headingId = useId();

  // The safe choice owns the first focus, so Enter never deletes by accident.
  useEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, []);
  // A pending request disables both buttons; keep the focus inside the dialog
  // instead of letting it drop onto the document body.
  useEffect(() => {
    if (busy) dialog.current?.focus({ preventScroll: true });
  }, [busy]);

  return (
    <ModalDialog
      ref={dialog}
      className="form-dialog position-remove-dialog"
      aria-busy={busy}
      aria-labelledby={headingId}
      tabIndex={-1}
      busy={busy}
      dismissOnBackdrop
      onDismiss={onCancel}
    >
      <header className="form-dialog-header">
        <h3 id={headingId}>{heading ?? `${position} entfernen?`}</h3>
      </header>
      <p>{message}</p>
      <div className="form-dialog-footer">
        <button
          ref={cancel}
          type="button"
          className="secondary-action"
          disabled={busy}
          onClick={onCancel}
        >
          Abbrechen
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalDialog>
  );
}
