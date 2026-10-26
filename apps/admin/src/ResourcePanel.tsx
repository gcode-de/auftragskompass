import { ResourceBlocks } from './ResourceBlocks.js';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { registerUnsavedChanges } from './unsaved-changes.js';

type Resource = {
  id: string;
  version: number;
  name: string;
  code: string;
  category: string;
  description: string;
  quantity: number;
  beforeDays: number;
  afterDays: number;
  position: number;
  state: string;
  blocked: boolean;
};
type Draft = {
  name: string;
  code: string;
  category: string;
  description: string;
  quantity: string;
  beforeDays: string;
  afterDays: string;
  position: string;
  state: string;
  blocked: boolean;
};
const texts = [
  ['name', 'Bezeichnung', 120],
  ['code', 'Interner Code', 40],
  ['category', 'Kategorie', 120],
  ['description', 'Beschreibung', 2000],
] as const;
const numbers = [
  ['quantity', 'Bestand', 1, 10000],
  ['beforeDays', 'Puffer vorher (Tage)', 2, 365],
  ['afterDays', 'Puffer nachher (Tage)', 2, 365],
  ['position', 'Sortierung', 0, 9999],
] as const;
const stateLabels: Record<string, string> = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
  archived: 'Archiviert',
};
const discardMessage =
  'Ungespeicherte Eingaben verwerfen und den Ressourcendialog schließen?';
const loadFailureMessage = 'Ressourcen konnten nicht geladen werden.';
const reloadFailureMessage =
  'Ressource gespeichert, die Liste konnte nicht neu geladen werden.';
function blankDraft(): Draft {
  return {
    name: '',
    code: '',
    category: '',
    description: '',
    quantity: String(numbers[0][2]),
    beforeDays: String(numbers[1][2]),
    afterDays: String(numbers[2][2]),
    position: String(numbers[3][2]),
    state: 'active',
    blocked: false,
  };
}
function resourceDraft(row: Resource): Draft {
  return {
    name: row.name,
    code: row.code,
    category: row.category,
    description: row.description,
    quantity: String(row.quantity),
    beforeDays: String(row.beforeDays),
    afterDays: String(row.afterDays),
    position: String(row.position),
    state: row.state,
    blocked: Boolean(row.blocked),
  };
}
function label(state: string): string {
  return stateLabels[state] ?? state;
}

export function ResourcePanel({ csrfToken }: { csrfToken: string }) {
  const sequence = useRef(0);
  const saving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<Resource[]>([]),
    [editing, setEditing] = useState<Resource | null>(null),
    [open, setOpen] = useState(false),
    [values, setValues] = useState<Draft>(blankDraft),
    [baseline, setBaseline] = useState<Draft>(blankDraft),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [state, setState] = useState(''),
    [message, setMessage] = useState(''),
    [formError, setFormError] = useState(''),
    [errorFocus, setErrorFocus] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [reloadFailed, setReloadFailed] = useState(false);
  const dirty = open && JSON.stringify(values) !== JSON.stringify(baseline);
  const needle = search.trim().toLowerCase();
  const categories = Array.from(new Set(rows.map((row) => row.category))).sort(
    (left, right) => left.localeCompare(right, 'de'),
  );
  const filtered = rows.filter((row) => {
    if (category && row.category !== category) return false;
    if (state && row.state !== state) return false;
    if (!needle) return true;
    return [row.name, row.code, row.category].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

  async function refresh() {
    const current = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/v1/resources');
      if (!response.ok) throw Error('load');
      const next = (await response.json()) as Resource[];
      if (current === sequence.current) {
        setRows(next);
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
    void refresh().catch(() => setMessage(loadFailureMessage));
  }, []);
  useEffect(() => registerUnsavedChanges(() => dirty), [dirty]);
  useEffect(() => {
    if (!open) return;
    dialog.current
      ?.querySelector<HTMLElement>('input[name="name"]')
      ?.focus({ preventScroll: true });
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
    const next = blankDraft();
    setEditing(null);
    setValues(next);
    setBaseline(next);
    setFormError('');
    setMessage('');
    setOpen(true);
  }
  function openEdit(row: Resource) {
    if (open || saving.current) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const next = resourceDraft(row);
    setEditing(row);
    setValues(next);
    setBaseline(next);
    setFormError('');
    setMessage('');
    setOpen(true);
  }
  function close() {
    if (saving.current || busy) return;
    if (dirty && !window.confirm(discardMessage)) return;
    setOpen(false);
    setEditing(null);
    const next = blankDraft();
    setValues(next);
    setBaseline(next);
    setFormError('');
    restoreFocus();
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  async function submit() {
    if (saving.current) return;
    saving.current = true;
    let saved = false;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true);
    setFormError('');
    const input = {
      name: values.name,
      code: values.code,
      category: values.category,
      description: values.description,
      quantity: Number(values.quantity),
      beforeDays: Number(values.beforeDays),
      afterDays: Number(values.afterDays),
      position: Number(values.position),
      state: values.state,
      blocked: values.blocked,
    };
    try {
      const response = await fetch(
        editing ? '/api/v1/resources/' + editing.id : '/api/v1/resources',
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
        const result = (await response.json()) as { error: string };
        setFormError(
          result.error === 'conflict'
            ? 'Inzwischen geändert. Liste aktualisieren und erneut bearbeiten.'
            : result.error === 'code_exists'
              ? 'Der interne Code ist bereits vergeben. Einen anderen Code wählen.'
              : result.error === 'resource_in_use'
                ? 'Die Ressource ist künftig reserviert oder als Fotobox fest zugewiesen. Bestand, Kategorie und Archiv erst nach Prüfung ändern.'
                : 'Speichern fehlgeschlagen. Code, Eingabe und Anmeldung prüfen.',
        );
        focusErrorSoon();
        return;
      }
      saved = true;
      setOpen(false);
      setEditing(null);
      const next = blankDraft();
      setValues(next);
      setBaseline(next);
      // The POST/PUT is confirmed. Report it first; a failing reload is a
      // refresh problem, not a reason to send the resource again.
      setMessage('Ressource gespeichert.');
      try {
        await refresh();
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
      if (saved) setTimeout(restoreFocus, 0);
    }
  }
  async function retryList() {
    try {
      await refresh();
    } catch {
      setMessage(loadFailureMessage);
    }
  }
  async function retryReload() {
    try {
      await refresh();
    } catch {
      setReloadFailed(true);
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
  const title = editing ? 'Ressource bearbeiten' : 'Ressource anlegen';
  return (
    <section id="resources" aria-label="Ressourcen" aria-busy={loading || busy}>
      <h2>Ressourcen</h2>
      <p>
        Fotoboxen erhalten die Kategorie „Fotobox“. Nur mit einer festen
        Fotobox-Zuweisung kann ein Event gebucht werden.
      </p>
      <div className="resource-toolbar">
        <label>
          Ressourcen suchen
          <input
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Kategorie filtern
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Alle Kategorien</option>
            {categories.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zustand filtern
          <select
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="">Alle Zustände</option>
            <option value="active">Aktiv</option>
            <option value="inactive">Inaktiv</option>
            <option value="archived">Archiviert</option>
          </select>
        </label>
        <div className="section-actions">
          <button
            ref={createTrigger}
            type="button"
            className="icon-action tier-primary-icon"
            aria-label="Ressource anlegen"
            title="Ressource anlegen"
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
      {loading && <p role="status">Ressourcen werden geladen …</p>}
      {!loading && !loadFailed && !rows.length && (
        <p>
          Noch keine Ressourcen. Über „Ressource anlegen“ die erste Ressource
          erfassen.
        </p>
      )}
      {!loading && rows.length > 0 && !filtered.length && (
        <>
          <p>Keine Treffer für die aktuellen Filter.</p>
          <button
            type="button"
            className="tertiary-action"
            onClick={() => {
              setSearch('');
              setCategory('');
              setState('');
            }}
          >
            Filter zurücksetzen
          </button>
        </>
      )}
      <ul>
        {filtered.map((row) => (
          <li key={row.id}>
            <span>
              {row.name} – {String(row.quantity)} Stück – {row.category} –{' '}
              {label(row.state)}
              {row.blocked ? ' – Gesperrt' : ''}
            </span>{' '}
            <button
              className="secondary-action"
              disabled={busy}
              aria-label={`Ressource bearbeiten: ${row.name}`}
              onClick={() => openEdit(row)}
            >
              Bearbeiten
            </button>
          </li>
        ))}
      </ul>
      <p role="status">{message}</p>
      {reloadFailed ? (
        <div className="reload-warning">
          <p role="status">{reloadFailureMessage}</p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={() => void retryReload()}
          >
            Ressourcen erneut laden
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="tertiary-action"
          disabled={busy}
          onClick={() => void retryList()}
        >
          Ressourcen aktualisieren
        </button>
      )}
      {open && (
        <div className="form-dialog-backdrop">
          <div
            className="form-dialog resource-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={busy}
            aria-labelledby="resource-dialog-title"
            ref={dialog}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
          >
            <header className="form-dialog-header">
              <h3 id="resource-dialog-title">{title}</h3>
              <button
                type="button"
                className="tertiary-action form-dialog-close"
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
                {texts.map(([key, fieldLabel, max]) => (
                  <label key={key}>
                    {fieldLabel}
                    <input
                      name={key}
                      required={key !== 'description'}
                      maxLength={max}
                      value={values[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  </label>
                ))}
                {numbers.map(([key, fieldLabel, , max]) => (
                  <label key={key}>
                    {fieldLabel}
                    <input
                      name={key}
                      type="number"
                      min={0}
                      max={max}
                      required
                      value={values[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  </label>
                ))}
                <label>
                  Zustand
                  <select
                    name="state"
                    value={values.state}
                    onChange={(event) => update('state', event.target.value)}
                  >
                    <option value="active">Aktiv</option>
                    <option value="inactive">Inaktiv</option>
                    <option value="archived">Archiviert</option>
                  </select>
                </label>
                <label>
                  <input
                    name="blocked"
                    type="checkbox"
                    checked={values.blocked}
                    onChange={(event) =>
                      update('blocked', event.target.checked)
                    }
                  />
                  Gesperrt
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
                <p className="sr-only" role="status">
                  {busy
                    ? editing
                      ? 'Ressource wird gespeichert …'
                      : 'Ressource wird angelegt …'
                    : ''}
                </p>
              </fieldset>
              <div className="form-dialog-footer">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy}
                  onClick={close}
                >
                  Ressource abbrechen
                </button>
                <button className="primary-action" disabled={busy}>
                  {busy ? 'Wird gespeichert …' : 'Ressource speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ResourceBlocks csrfToken={csrfToken} />
    </section>
  );
}
