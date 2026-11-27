import { ResourceBlocks } from './ResourceBlocks.js';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog.js';
import {
  ResourceRecord,
  recordTabs,
  type RecordTab,
} from './ResourceRecord.js';
import { registerUnsavedChanges } from './unsaved-changes.js';

type Resource = {
  id: string;
  version: number;
  name: string;
  code: string;
  category: string;
  kind: string;
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
  kind: string;
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
// RES-BKP-02: Bookitup's resource types and its explanations of them.
const kinds = [
  [
    'item',
    'Item',
    'Eine einzelne Ressource, wie eine Fotobox oder ein Lautsprecher.',
  ],
  [
    'set',
    'Set',
    'Eine logische Sammlung von Ressourcen, wie ein Hochzeitspaket.',
  ],
  [
    'case',
    'Case',
    'Ressourcen, die nur zusammen genutzt werden, wie eine Fotobox mit verbauter Kamera.',
  ],
] as const;
const kindLabel = (kind: string) =>
  kinds.find(([value]) => value === kind)?.[1] ?? kind;
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
    kind: 'item',
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
    kind: row.kind ?? 'item',
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
  const dialog = useRef<HTMLDialogElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const filterGroup = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [wideFilters, setWideFilters] = useState(
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(min-width: 960px)').matches,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  // RES-BKP-03: `#resource-<id>` opens the resource's record.
  const readRecord = () =>
    window.location.hash.startsWith('#resource-')
      ? window.location.hash.slice('#resource-'.length)
      : null;
  const [recordId, setRecordId] = useState<string | null>(readRecord);
  const [recordTab, setRecordTab] = useState<RecordTab>('details');
  const shownRecord = useRef(recordId);
  useEffect(() => {
    const changed = () => {
      const next = readRecord();
      if (next !== shownRecord.current) setRecordTab('details');
      shownRecord.current = next;
      setRecordId(next);
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, []);
  const [rows, setRows] = useState<Resource[]>([]),
    [editing, setEditing] = useState<Resource | null>(null),
    [open, setOpen] = useState(false),
    [values, setValues] = useState<Draft>(blankDraft),
    [baseline, setBaseline] = useState<Draft>(blankDraft),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [kind, setKind] = useState(''),
    [showArchived, setShowArchived] = useState(false),
    [knownCategories, setKnownCategories] = useState<string[]>([]),
    [message, setMessage] = useState(''),
    [formError, setFormError] = useState(''),
    [errorFocus, setErrorFocus] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [reloadFailed, setReloadFailed] = useState(false);
  const filterCount =
    Number(Boolean(search.trim())) +
    Number(Boolean(category)) +
    Number(Boolean(kind)) +
    Number(showArchived);
  const dirty = open && JSON.stringify(values) !== JSON.stringify(baseline);
  const needle = search.trim().toLowerCase();
  const categories = Array.from(
    new Set([...knownCategories, ...rows.map((row) => row.category)]),
  ).sort((left, right) => left.localeCompare(right, 'de'));
  // Like Bookitup, archived resources only show on request.
  const filtered = rows.filter((row) => {
    if (category && row.category !== category) return false;
    if (kind && row.kind !== kind) return false;
    if (!showArchived && row.state === 'archived') return false;
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
  // RES-BKP-02: the managed categories feed the filter and the suggestions;
  // without them the list's own categories still work.
  async function loadCategories() {
    try {
      const response = await fetch('/api/v1/resource-categories');
      if (!response.ok) return;
      const list = (await response.json()) as unknown;
      // Only a real category list counts (name and parent per row).
      if (
        Array.isArray(list) &&
        list.every(
          (row) =>
            typeof row?.name === 'string' && 'parentId' in (row as object),
        )
      )
        setKnownCategories(list.map((row: { name: string }) => row.name));
    } catch {
      // The list's own categories remain.
    }
  }
  useEffect(() => {
    void loadCategories();
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia('(min-width: 960px)');
    const changed = () => {
      if (
        !viewport.matches &&
        filterGroup.current?.contains(document.activeElement)
      )
        setFiltersOpen(true);
      const moveFocus =
        viewport.matches && document.activeElement === filterTrigger.current;
      setWideFilters(viewport.matches);
      if (moveFocus)
        requestAnimationFrame(() => {
          if (viewport.matches)
            filterGroup.current
              ?.querySelector<HTMLInputElement>('input')
              ?.focus();
        });
    };
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
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
      kind: values.kind,
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
  const title = editing ? 'Ressource bearbeiten' : 'Ressource anlegen';
  const record = rows.find((row) => row.id === recordId) ?? null;
  // Closing the record returns to the list and to the resource's name, once
  // the list is shown again.
  const focusName = useRef<string | null>(null);
  function closeRecord() {
    focusName.current = recordId;
    window.location.hash = 'resources';
    shownRecord.current = null;
    setRecordId(null);
  }
  useEffect(() => {
    const id = focusName.current;
    if (recordId || !id) return;
    focusName.current = null;
    document
      .querySelector<HTMLElement>(`a[href="#resource-${id}"]`)
      ?.focus({ preventScroll: true });
  }, [recordId]);
  return (
    <section
      id="resources"
      aria-label="Ressourcen"
      aria-busy={loading || busy}
      data-record={record ? '' : undefined}
    >
      {/* UI-BKP-14: like Bookitup the page title, the plus and the filters
          form the context column beside the rail; the list fills the canvas. */}
      <div className="resource-layout">
        <div className="resource-filter-column">
          {record && (
            // RES-BKP-03: like Bookitup the column names the open resource
            // and switches between its areas.
            <nav className="record-context" aria-label="Ressourcen-Akte">
              <p className="record-context-title">
                <span>Ressource</span>
                <strong>{record.name}</strong>
              </p>
              {recordTabs.map(([value, text]) => (
                <a
                  key={value}
                  href={'#resource-' + record.id}
                  aria-current={recordTab === value ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setRecordTab(value);
                  }}
                >
                  {text}
                </a>
              ))}
            </nav>
          )}
          <div className="resource-filter-body" hidden={Boolean(record)}>
            <div className="section-heading">
              <h2>Ressourcen</h2>
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
            {!wideFilters && (
              <button
                ref={filterTrigger}
                type="button"
                className="secondary-action resource-filter-trigger"
                aria-label={`Filter, aktive Kriterien: ${filterCount}`}
                aria-expanded={filtersOpen}
                aria-controls="resource-filter-panel"
                onClick={() => setFiltersOpen((current) => !current)}
              >
                Filter <span className="event-count">{filterCount}</span>
              </button>
            )}
            <div
              ref={filterGroup}
              id="resource-filter-panel"
              className="resource-toolbar"
              role="group"
              aria-label="Ressourcenfilter"
              hidden={!wideFilters && !filtersOpen}
            >
              <label>
                Ressourcen suchen
                <input
                  value={search}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div
                className="resource-filter-list"
                role="group"
                aria-labelledby="resource-kind-filter"
              >
                <span
                  id="resource-kind-filter"
                  className="resource-filter-label"
                >
                  Typ
                </span>
                {[...kinds]
                  .sort(
                    ([a], [b]) =>
                      // Bookitup's order: Set, Case, Item.
                      ['set', 'case', 'item'].indexOf(a) -
                      ['set', 'case', 'item'].indexOf(b),
                  )
                  .map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      className="tertiary-action"
                      aria-pressed={kind === value}
                      onClick={() =>
                        setKind((current) => (current === value ? '' : value))
                      }
                    >
                      {text}
                    </button>
                  ))}
              </div>
              <div
                className="resource-filter-list"
                role="group"
                aria-labelledby="resource-category-filter"
              >
                <span
                  id="resource-category-filter"
                  className="resource-filter-label"
                >
                  Kategorie
                  <a
                    className="icon-action tier-quiet-icon"
                    href="#settings-resources"
                    aria-label="Kategorien bearbeiten"
                    title="Kategorien bearbeiten"
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
                  </a>
                </span>
                {categories.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="tertiary-action"
                    aria-pressed={category === entry}
                    onClick={() =>
                      setCategory((current) => (current === entry ? '' : entry))
                    }
                  >
                    {entry}
                  </button>
                ))}
              </div>
              <label className="resource-archive-filter">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                Archivierte anzeigen
              </label>
            </div>
          </div>
        </div>
        <div className="resource-results">
          {record && (
            <ResourceRecord
              resource={record}
              tab={recordTab}
              candidates={rows}
              csrfToken={csrfToken}
              onEdit={() => openEdit(record)}
              onClose={closeRecord}
            />
          )}
          <div className="resource-list-body" hidden={Boolean(record)}>
            <p className="resource-intro">
              Ressourcen lassen sich Events zuweisen und auf Verfügbarkeit
              prüfen.
            </p>
            {loading && <p role="status">Ressourcen werden geladen …</p>}
            {!loading && !loadFailed && !rows.length && (
              <p>
                Noch keine Ressourcen. Über „Ressource anlegen“ die erste
                Ressource erfassen.
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
                    setKind('');
                    setShowArchived(false);
                  }}
                >
                  Filter zurücksetzen
                </button>
              </>
            )}
            {filtered.length > 0 && (
              <div className="resource-list-head" aria-hidden="true">
                <span>Typ</span>
                <span>Name</span>
                <span>Bestand</span>
                <span>Kategorie</span>
                <span>Zustand</span>
              </div>
            )}
            <ul className="resource-list">
              {filtered.map((row) => (
                <li key={row.id} className="resource-row">
                  <span className="resource-cell-kind">
                    {kindLabel(row.kind ?? 'item')}
                    <span className="sr-only">: </span>
                  </span>
                  <span className="resource-summary">
                    <a
                      className="resource-name-link"
                      href={'#resource-' + row.id}
                    >
                      <strong>{row.name}</strong>
                    </a>
                    <span className="sr-only"> – </span>
                    {/* One accessible line, shown as table cells. */}
                    <span className="resource-cell-quantity">
                      {String(row.quantity)} Stück
                    </span>
                    <span className="sr-only"> – </span>
                    <span className="resource-cell-category">
                      {row.category}
                    </span>
                    <span className="sr-only"> – </span>
                    <span className="resource-cell-state">
                      {label(row.state)}
                      {row.blocked && (
                        <>
                          <span className="sr-only"> – </span>
                          <span className="resource-blocked">Gesperrt</span>
                        </>
                      )}
                    </span>
                  </span>{' '}
                  <button
                    type="button"
                    className="icon-action tier-quiet-icon"
                    disabled={busy}
                    aria-label={`Ressource bearbeiten: ${row.name}`}
                    title="Ressource bearbeiten"
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
          </div>
        </div>
      </div>
      {open && (
        <ModalDialog
          className="form-dialog resource-dialog"
          aria-busy={busy}
          aria-labelledby="resource-dialog-title"
          ref={dialog}
          tabIndex={-1}
          busy={busy}
          onDismiss={close}
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
                <Fragment key={key}>
                  <label>
                    {fieldLabel}
                    <input
                      name={key}
                      required={key !== 'description'}
                      maxLength={max}
                      value={values[key]}
                      // RES-BKP-02: Bookitup suggests the known categories.
                      {...(key === 'category'
                        ? {
                            list: 'resource-category-options',
                            'aria-describedby': 'resource-category-hint',
                          }
                        : {})}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  </label>
                  {key === 'category' && (
                    <p id="resource-category-hint" className="field-hint">
                      Eine neue Kategorie wird automatisch angelegt.
                    </p>
                  )}
                </Fragment>
              ))}
              <datalist id="resource-category-options">
                {categories.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
              <label>
                Typ
                <select
                  name="kind"
                  value={values.kind}
                  aria-describedby="resource-kind-hint"
                  onChange={(event) => update('kind', event.target.value)}
                >
                  {kinds.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <p id="resource-kind-hint" className="field-hint">
                {kinds.find(([value]) => value === values.kind)?.[2]}
              </p>
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
                  onChange={(event) => update('blocked', event.target.checked)}
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
        </ModalDialog>
      )}
      <div hidden={Boolean(record)}>
        <ResourceBlocks csrfToken={csrfToken} />
      </div>
    </section>
  );
}
