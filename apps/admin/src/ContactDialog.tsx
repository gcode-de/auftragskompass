import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ContactRecord } from './ContactDetails.js';
import { registerUnsavedChanges } from './unsaved-changes.js';

export type Contact = ContactRecord & { version: number };
type ContactInput = Omit<Contact, 'id' | 'version'>;

const fields = [
  ['name', 'Name / Firma', 200],
  ['contactPerson', 'Ansprechpartner', 200],
  ['street', 'Straße und Hausnummer', 200],
  ['postalCode', 'Postleitzahl', 20],
  ['city', 'Ort', 120],
  ['country', 'Ländercode', 2],
  ['email', 'E-Mail-Adresse', 254],
  ['phone', 'Festnetz', 60],
  ['mobile', 'Mobilnummer', 60],
] as const;

export const contactDiscardMessage =
  'Ungespeicherte Eingaben verwerfen und den Kontaktdialog schließen?';

/** The title id is shared with whoever labels the surrounding dialog box. */
export function contactDialogTitleId(idPrefix = 'contact') {
  return `${idPrefix}-contact-dialog-title`;
}

function blankContact(): ContactInput {
  return {
    kind: 'private',
    name: '',
    contactPerson: '',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    email: '',
    phone: '',
    mobile: '',
    state: 'active',
  };
}

function contactInput(row: Contact): ContactInput {
  return {
    kind: row.kind,
    name: row.name,
    contactPerson: row.contactPerson,
    street: row.street,
    postalCode: row.postalCode,
    city: row.city,
    country: row.country,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    state: row.state,
  };
}

/**
 * The one contact form of the admin: the contacts panel opens it as its own
 * dialog, the event create flow shows it inline inside the event dialog box.
 * Both share the same fields, the same single validation contract (HTML
 * `required`/`maxLength` plus the server-side `contactFields`) and the same
 * save request, so no second validator exists.
 */
export function ContactDialog({
  csrfToken,
  contact = null,
  idPrefix = 'contact',
  inline = false,
  discardMessage = contactDiscardMessage,
  onBusyChange,
  onClose,
  onSaved,
}: {
  csrfToken: string;
  contact?: Contact | null;
  // A prefix keeps every id unique when the event form is mounted beside it.
  idPrefix?: string;
  // Inline renders the same body inside a surrounding dialog box instead of
  // opening a second dialog level with its own backdrop.
  inline?: boolean;
  discardMessage?: string;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onSaved: (row: Contact) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const [values, setValues] = useState<ContactInput>(() =>
      contact ? contactInput(contact) : blankContact(),
    ),
    [baseline] = useState<ContactInput>(() =>
      contact ? contactInput(contact) : blankContact(),
    ),
    [formError, setFormError] = useState(''),
    [formStatus, setFormStatus] = useState(''),
    [errorFocus, setErrorFocus] = useState(0),
    [duplicates, setDuplicates] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const title = contact ? 'Kontakt bearbeiten' : 'Kontakt anlegen';
  const titleId = contactDialogTitleId(idPrefix);
  useEffect(() => registerUnsavedChanges(() => dirty), [dirty]);
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>('select[name="kind"], input[name="name"]')
      ?.focus();
  }, []);
  useEffect(() => {
    if (!errorFocus) return;
    errorMessage.current?.focus({ preventScroll: true });
  }, [errorFocus]);
  function focusableElements() {
    if (!dialog.current) return [];
    return Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], summary',
      ),
    ).filter(
      (element) =>
        !(element as HTMLButtonElement).disabled &&
        !element.closest('fieldset[disabled]'),
    );
  }
  function focusErrorSoon() {
    setErrorFocus((value) => value + 1);
  }
  function close() {
    if (saving.current || busy) return;
    if (dirty && !window.confirm(discardMessage)) return;
    onClose();
  }
  function update(key: keyof ContactInput, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setFormStatus('');
    setDuplicates([]);
  }
  async function submit() {
    if (saving.current) return;
    saving.current = true;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true);
    onBusyChange?.(true);
    setFormError('');
    setFormStatus('');
    setDuplicates([]);
    const input = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    ) as ContactInput;
    try {
      const response = await fetch(
        contact ? '/api/v1/contacts/' + contact.id : '/api/v1/contacts',
        {
          method: contact ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            ...input,
            ...(contact ? { version: contact.version } : {}),
          }),
        },
      );
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setFormError(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Kontakte suchen und erneut bearbeiten.'
            : 'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
        );
        focusErrorSoon();
        return;
      }
      // The stored row is the only source of a new selection: the caller may
      // hand it straight to its own state instead of trusting a later list.
      onSaved((await response.json()) as Contact);
    } catch {
      setFormError('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
      focusErrorSoon();
    } finally {
      saving.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function checkDuplicates() {
    if (saving.current) return;
    saving.current = true;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true);
    onBusyChange?.(true);
    setFormError('');
    setFormStatus('');
    setDuplicates([]);
    try {
      const response = await fetch('/api/v1/contacts/duplicates', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          email: values.email.trim(),
          phone: values.phone.trim(),
          mobile: values.mobile.trim(),
          country: values.country.trim(),
          ...(contact ? { excludeId: contact.id } : {}),
        }),
      });
      if (!response.ok) {
        setFormError('Dublettenprüfung fehlgeschlagen.');
        focusErrorSoon();
        return;
      }
      const matches = (await response.json()) as Contact[];
      setDuplicates(matches.map((row) => row.name));
      setFormStatus(
        matches.length ? '' : 'Keine möglichen Dubletten gefunden.',
      );
    } catch {
      setFormError('Dublettenprüfung fehlgeschlagen.');
      focusErrorSoon();
    } finally {
      saving.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Inline the surrounding event dialog keeps its draft, so the key must
      // not continue into the outer handler.
      if (inline) event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = focusableElements();
    if (!focusable.length) {
      // While a request is pending every control is disabled. Keep Tab on the
      // dialog instead of letting focus escape into the background.
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = focusable[0]!,
      last = focusable[focusable.length - 1]!;
    if (document.activeElement === dialog.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  const body = (
    <>
      <header className="form-dialog-header">
        {/* The dialog title is the top heading of its own box: on the event page
            it follows the page h1 directly, so it must not skip a level. */}
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="tertiary-action form-dialog-close"
          aria-label={inline ? 'Kontaktanlage schließen' : 'Dialog schließen'}
          title={inline ? 'Kontaktanlage schließen' : 'Dialog schließen'}
          disabled={busy}
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">{title}</legend>
          <label>
            Kontaktart
            <select
              name="kind"
              value={values.kind}
              onChange={(event) => update('kind', event.target.value)}
            >
              <option value="private">Privatperson</option>
              <option value="company">Firma</option>
            </select>
          </label>
          {fields.map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                maxLength={maxLength}
                required={key === 'name' || key === 'country'}
                value={values[key]}
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
          <label>
            Kontaktzustand
            <select
              name="state"
              value={values.state}
              onChange={(event) => update('state', event.target.value)}
            >
              <option value="active">Aktiv</option>
              <option value="archived">Archiviert</option>
            </select>
          </label>
          {formError && (
            <p
              className="field-error"
              role="alert"
              tabIndex={-1}
              ref={errorMessage}
            >
              {formError}
            </p>
          )}
          {formStatus && <p role="status">{formStatus}</p>}
          {duplicates.length > 0 && (
            <p role="status">Mögliche Dubletten: {duplicates.join(', ')}</p>
          )}
          <p className="sr-only" role="status">
            {busy
              ? contact
                ? 'Kontakt wird gespeichert …'
                : 'Kontakt wird angelegt …'
              : ''}
          </p>
        </fieldset>
        <div className="form-dialog-footer">
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => void checkDuplicates()}
          >
            Dubletten prüfen
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={close}
          >
            Kontakt abbrechen
          </button>
          <button className="primary-action" disabled={busy}>
            {busy ? 'Wird gespeichert …' : 'Kontakt speichern'}
          </button>
        </div>
      </form>
    </>
  );
  if (inline)
    return (
      <div
        className="contact-dialog-inline"
        aria-busy={busy}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        {body}
      </div>
    );
  return (
    <div className="form-dialog-backdrop">
      <div
        className="form-dialog contact-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        {body}
      </div>
    </div>
  );
}
