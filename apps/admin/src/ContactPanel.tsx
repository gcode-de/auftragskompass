import { updateUrlSearch, emptyEventFilters } from './url-state.js';
import { useEffect, useState, useRef, type KeyboardEvent } from 'react';
import { registerUnsavedChanges } from './unsaved-changes.js';
type Contact = {
  id: string;
  version: number;
  kind: string;
  name: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  mobile: string;
  state: string;
};
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
const discardMessage =
  'Ungespeicherte Eingaben verwerfen und den Kontaktdialog schließen?';
const loadFailureMessage = 'Kontakte konnten nicht geladen werden.';
const reloadFailureMessage =
  'Kontakt gespeichert, die Liste konnte nicht neu geladen werden.';
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
export function ContactPanel({
  csrfToken,
  showHeading = true,
}: {
  csrfToken: string;
  showHeading?: boolean;
}) {
  const sequence = useRef(0);
  const saving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const query = new URLSearchParams(window.location.search).get('q') ?? '';
  const [rows, setRows] = useState<Contact[]>([]),
    [editing, setEditing] = useState<Contact | null>(null),
    [open, setOpen] = useState(false),
    [values, setValues] = useState<ContactInput>(blankContact),
    [baseline, setBaseline] = useState<ContactInput>(blankContact),
    [search, setSearch] = useState(query),
    [message, setMessage] = useState(''),
    [formError, setFormError] = useState(''),
    [formStatus, setFormStatus] = useState(''),
    [errorFocus, setErrorFocus] = useState(0),
    [duplicates, setDuplicates] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [reloadFailed, setReloadFailed] = useState(false),
    [linkedEvents, setLinkedEvents] = useState<{ id: string; name: string }[]>(
      [],
    );
  const dirty = open && JSON.stringify(values) !== JSON.stringify(baseline);
  async function refresh(query = '') {
    const current = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch(
        '/api/v1/contacts' + (query ? '?q=' + encodeURIComponent(query) : ''),
      );
      if (!response.ok) throw Error('load');
      const rows = (await response.json()) as Contact[];
      if (current === sequence.current) {
        setRows(rows);
        setReloadFailed(false);
        setMessage((text) => (text === loadFailureMessage ? '' : text));
      }
    } catch (error) {
      if (current === sequence.current) {
        setLoadFailed(true);
        throw error;
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    const changed = () => {
      const value = new URLSearchParams(window.location.search).get('q') ?? '';
      setSearch(value);
      void refresh(value).catch(() => setMessage(loadFailureMessage));
    };
    changed();
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  useEffect(() => {
    const changed = () => {
      const id = window.location.hash.slice(1);
      if (!id.startsWith('contact-')) return;
      document.getElementById(id)?.scrollIntoView?.();
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [rows]);
  useEffect(() => registerUnsavedChanges(() => dirty), [dirty]);
  useEffect(() => {
    if (!open) return;
    dialog.current
      ?.querySelector<HTMLElement>('select[name="kind"], input[name="name"]')
      ?.focus();
  }, [open]);
  useEffect(() => {
    if (!open || !errorFocus) return;
    errorMessage.current?.focus({ preventScroll: true });
  }, [errorFocus, open]);
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
  function restoreFocus() {
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else createTrigger.current?.focus({ preventScroll: true });
  }
  function openNew() {
    if (open || saving.current) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : createTrigger.current;
    const next = blankContact();
    setEditing(null);
    setValues(next);
    setBaseline(next);
    setDuplicates([]);
    setFormError('');
    setFormStatus('');
    setMessage('');
    setOpen(true);
  }
  function openEdit(row: Contact) {
    if (open || saving.current) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const next = contactInput(row);
    setEditing(row);
    setValues(next);
    setBaseline(next);
    setDuplicates([]);
    setFormError('');
    setFormStatus('');
    setMessage('');
    setOpen(true);
  }
  function close() {
    if (saving.current || busy) return;
    if (dirty && !window.confirm(discardMessage)) return;
    setOpen(false);
    setEditing(null);
    const next = blankContact();
    setValues(next);
    setBaseline(next);
    setDuplicates([]);
    setFormError('');
    setFormStatus('');
    restoreFocus();
  }
  function update(key: keyof ContactInput, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setFormStatus('');
    setDuplicates([]);
  }
  async function submit() {
    if (saving.current) return;
    saving.current = true;
    let created = false;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true);
    setFormError('');
    setFormStatus('');
    setDuplicates([]);
    const input = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    ) as ContactInput;
    try {
      const response = await fetch(
        editing ? '/api/v1/contacts/' + editing.id : '/api/v1/contacts',
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            ...input,
            ...(editing ? { version: editing.version } : {}),
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
      created = true;
      setOpen(false);
      setEditing(null);
      const next = blankContact();
      setValues(next);
      setBaseline(next);
      setMessage('Kontakt gespeichert.');
      try {
        await refresh(search);
      } catch {
        setReloadFailed(true);
      }
    } catch {
      setFormError('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
      focusErrorSoon();
    } finally {
      saving.current = false;
      setBusy(false);
      // The list actions are disabled while busy; restore focus after React
      // has re-enabled them instead of dropping it onto the document body.
      if (created) setTimeout(restoreFocus, 0);
    }
  }
  async function checkDuplicates() {
    if (saving.current) return;
    saving.current = true;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true);
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
          ...(editing ? { excludeId: editing.id } : {}),
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
    }
  }
  async function retryList() {
    try {
      await refresh(search);
    } catch {
      setMessage(loadFailureMessage);
    }
  }
  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
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
  async function showEvents(id: string) {
    setLinkedEvents([]);
    setMessage('');
    try {
      const response = await fetch('/api/v1/contacts/' + id + '/events');
      if (!response.ok) throw Error('load');
      const rows = (await response.json()) as { id: string; name: string }[];
      setLinkedEvents(rows);
      if (!rows.length) setMessage('Keine zugeordneten Events.');
    } catch {
      setMessage('Zugeordnete Events konnten nicht geladen werden.');
    }
  }
  const title = editing ? 'Kontakt bearbeiten' : 'Kontakt anlegen';
  return (
    <section id="contacts" aria-label="Kontakte" aria-busy={loading}>
      {showHeading && <h2>Kontakte</h2>}
      <div className="contact-toolbar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void refresh(search).catch(() => setMessage(loadFailureMessage));
          }}
        >
          <label>
            Kontakte suchen
            <input
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="icon-action"
            aria-label="Kontakte durchsuchen"
            title="Kontakte durchsuchen"
            disabled={busy}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 5 5" />
            </svg>
          </button>
        </form>
        <div className="section-actions">
          <a href="/api/v1/contacts/export.csv" download>
            Kontakte als CSV exportieren
          </a>
          <button
            ref={createTrigger}
            type="button"
            className="icon-action"
            aria-label="Kontakt anlegen"
            title="Kontakt anlegen"
            disabled={busy}
            onClick={openNew}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
      {loading && <p role="status">Kontakte werden geladen …</p>}
      {!loading && !loadFailed && !rows.length && (
        <p>Keine Kontakte gefunden.</p>
      )}
      <ul className="contact-list">
        {rows.map((row) => (
          <li key={row.id} id={'contact-' + row.id}>
            <span>
              {row.name}
              {row.state === 'archived' ? ' – Archiviert' : ''}
            </span>{' '}
            {row.contactPerson && <span>{row.contactPerson} </span>}
            {row.email && (
              <a
                aria-label={`E-Mail: ${row.name}`}
                href={'mailto:' + encodeURIComponent(row.email)}
              >
                E-Mail
              </a>
            )}{' '}
            {(row.phone || row.mobile) && (
              <a
                aria-label={`Anrufen: ${row.name}`}
                href={
                  'tel:' + (row.phone || row.mobile).replace(/[^+0-9]/g, '')
                }
              >
                Anrufen
              </a>
            )}{' '}
            <button
              type="button"
              className="icon-action"
              disabled={busy}
              title="Events anzeigen"
              aria-label={`Events anzeigen: ${row.name}`}
              onClick={() => void showEvents(row.id)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-action"
              disabled={busy}
              title="Kontakt bearbeiten"
              aria-label={`Kontakt bearbeiten: ${row.name}`}
              onClick={() => openEdit(row)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <p role="status">{message}</p>
      {reloadFailed && (
        <div className="reload-warning">
          <p role="status">{reloadFailureMessage}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void retryList()}
          >
            Kontakte erneut laden
          </button>
        </div>
      )}
      {!reloadFailed && loadFailed && (
        <button type="button" disabled={busy} onClick={() => void retryList()}>
          Kontakte erneut laden
        </button>
      )}
      {linkedEvents.length > 0 && (
        <nav aria-label="Zugeordnete Events">
          {linkedEvents.map((event) => (
            <a
              key={event.id}
              href={'#event-' + event.id}
              onClick={() => updateUrlSearch(emptyEventFilters)}
            >
              {event.name}
            </a>
          ))}
        </nav>
      )}
      {open && (
        <div className="form-dialog-backdrop">
          <div
            className="form-dialog contact-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={busy}
            aria-labelledby="contact-dialog-title"
            ref={dialog}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
          >
            <header className="form-dialog-header">
              <h3 id="contact-dialog-title">{title}</h3>
              <button
                type="button"
                className="secondary-action form-dialog-close"
                aria-label="Dialog schließen"
                title="Dialog schließen"
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
                  <p role="status">
                    Mögliche Dubletten: {duplicates.join(', ')}
                  </p>
                )}
                <p className="sr-only" role="status">
                  {busy
                    ? editing
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
                <button disabled={busy}>
                  {busy ? 'Wird gespeichert …' : 'Kontakt speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
