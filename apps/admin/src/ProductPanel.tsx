import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { parseHundredths, formatHundredths } from './decimal.js';
import { registerUnsavedChanges } from './unsaved-changes.js';

type Product = {
  id: string;
  version: number;
  name: string;
  description: string;
  unit: string;
  priceMinor: number;
  priceBasis: string;
  taxBasisPoints: number;
  state: string;
  position: number;
};
type Draft = {
  name: string;
  description: string;
  unit: string;
  price: string;
  priceBasis: string;
  tax: string;
  position: string;
  state: string;
};
type MoneyField = 'price' | 'tax';
const stateLabels: Record<string, string> = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
  archived: 'Archiviert',
};
const fieldLabels: Record<MoneyField, string> = {
  price: 'Preis in Euro',
  tax: 'Steuersatz in Prozent',
};
const discardMessage =
  'Ungespeicherte Eingaben verwerfen und den Produktdialog schließen?';
const loadFailureMessage = 'Produkte konnten nicht geladen werden.';
const reloadFailureMessage =
  'Produkt gespeichert, die Liste konnte nicht aktualisiert werden.';
const unknownOutcomeMessage =
  'Ausgang unklar. Vor erneutem Speichern die Liste neu laden.';
const reloadedMessage =
  'Liste neu geladen. Prüfe, ob das Produkt gespeichert wurde.';
const conflictMessage =
  'Inzwischen geändert. Produkte aktualisieren und erneut bearbeiten.';
const saveFailureMessage =
  'Speichern fehlgeschlagen. Preis, Steuer und Anmeldung prüfen.';
const archiveFailureMessage =
  'Archivieren fehlgeschlagen. Produkt und Berechtigung prüfen.';
const archiveMissingMessage =
  'Produkt nicht mehr vorhanden. Bitte Produkte aktualisieren.';
const archiveUnclearMessage =
  'Archivierungsstand unklar. Bitte Produkte neu laden, bevor du erneut archivierst.';
// Every message in this set is a failure the user must act on; the rest are
// progress or confirmation and stay a polite status line.
const errorMessages = new Set([
  loadFailureMessage,
  reloadFailureMessage,
  conflictMessage,
  archiveFailureMessage,
  archiveMissingMessage,
  archiveUnclearMessage,
]);
// decimal.ts owns the exact hundredths conversion. These two patterns only
// split its single rejection so the field can name its own problem; the
// arithmetic stays BigInt-based inside parseHundredths.
const decimalPattern = /^\d+(?:[.,]\d{1,2})?$/;
const tooManyDecimalsPattern = /^\d+[.,]\d{3,}$/;

function blankDraft(): Draft {
  return {
    name: '',
    description: '',
    unit: 'Stück',
    price: formatHundredths(0),
    priceBasis: 'gross',
    tax: formatHundredths(1900),
    position: '0',
    state: 'active',
  };
}
function productDraft(row: Product): Draft {
  return {
    name: row.name,
    description: row.description,
    unit: row.unit,
    price: formatHundredths(row.priceMinor),
    priceBasis: row.priceBasis,
    tax: formatHundredths(row.taxBasisPoints),
    position: String(row.position),
    state: row.state,
  };
}
function hundredths(
  field: MoneyField,
  raw: string,
): { value: number } | { error: string } {
  const value = raw.trim();
  if (tooManyDecimalsPattern.test(value))
    return {
      error: `${fieldLabels[field]}: höchstens zwei Nachkommastellen erlaubt.`,
    };
  if (!decimalPattern.test(value))
    return {
      error: `${fieldLabels[field]}: gültige Zahl mit höchstens zwei Nachkommastellen eingeben.`,
    };
  try {
    return { value: parseHundredths(value) };
  } catch {
    return { error: `${fieldLabels[field]}: Wert zu groß.` };
  }
}
function priceText(row: Product) {
  const amount = formatHundredths(row.priceMinor).replace('.', ',');
  return `${amount} € ${row.priceBasis === 'gross' ? 'Brutto' : 'Netto'}`;
}
function taxText(basisPoints: number) {
  const percent = formatHundredths(basisPoints)
    .replace('.', ',')
    .replace(/,00$/, '');
  return `${percent} %`;
}
function label(state: string) {
  return stateLabels[state] ?? state;
}
function summary(row: Product) {
  return `${row.name} – ${priceText(row)} – ${taxText(row.taxBasisPoints)} – ${row.unit} – ${label(row.state)}`;
}

export function ProductPanel({ csrfToken }: { csrfToken: string }) {
  const sequence = useRef(0);
  const saving = useRef(false);
  const archiveInFlight = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const actionRowRefs = useRef(new Map<string, HTMLLIElement>());
  const actionToggleRefs = useRef(new Map<string, HTMLButtonElement>());
  const [rows, setRows] = useState<Product[]>([]),
    [editing, setEditing] = useState<Product | null>(null),
    [open, setOpen] = useState(false),
    [values, setValues] = useState<Draft>(blankDraft),
    [baseline, setBaseline] = useState<Draft>(blankDraft),
    [search, setSearch] = useState(''),
    [stateFilter, setStateFilter] = useState(''),
    [message, setMessage] = useState(''),
    [formError, setFormError] = useState(''),
    [invalidField, setInvalidField] = useState<'' | MoneyField>(''),
    [errorFocus, setErrorFocus] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [reloadFailed, setReloadFailed] = useState(false),
    [locked, setLocked] = useState(false),
    [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const dirty = open && JSON.stringify(values) !== JSON.stringify(baseline);
  const messageIsError = errorMessages.has(message);
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (stateFilter && row.state !== stateFilter) return false;
    if (!needle) return true;
    return [row.name, row.description, row.unit].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

  async function refresh() {
    const current = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/v1/products');
      if (!response.ok) throw Error('load');
      const next = (await response.json()) as Product[];
      if (current === sequence.current) {
        setRows(next);
        setReloadFailed(false);
        setLocked(false);
        setMessage((text) => (errorMessages.has(text) ? '' : text));
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
  useEffect(() => {
    if (!openActionsId) return;
    const closeIfOutside = (target: EventTarget | null) => {
      const row = actionRowRefs.current.get(openActionsId);
      if (row && target instanceof Node && !row.contains(target))
        setOpenActionsId(null);
    };
    const onPointerDown = (event: PointerEvent) => closeIfOutside(event.target);
    const onFocusIn = (event: FocusEvent) => closeIfOutside(event.target);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [openActionsId]);
  function usableFocusTarget(
    element: HTMLElement | null | undefined,
  ): element is HTMLElement {
    return Boolean(
      element?.isConnected &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]'),
    );
  }
  function focusActionToggle(id: string) {
    const toggle = actionToggleRefs.current.get(id);
    if (usableFocusTarget(toggle)) toggle.focus({ preventScroll: true });
  }
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
  function rememberTrigger() {
    returnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : createTrigger.current;
  }
  function start(next: Draft, row: Product | null) {
    rememberTrigger();
    setEditing(row);
    setOpenActionsId(null);
    setValues(next);
    setBaseline(next);
    // A previous attempt with an unknown outcome stays explained while the
    // dialog is reopened; saving remains locked until the list is read again.
    setFormError(locked ? unknownOutcomeMessage : '');
    setInvalidField('');
    setMessage('');
    setOpen(true);
  }
  function openNew() {
    if (open || saving.current) return;
    start(blankDraft(), null);
  }
  function openEdit(row: Product) {
    if (open || saving.current) return;
    start(productDraft(row), row);
  }
  function openDuplicate(row: Product) {
    if (open || saving.current) return;
    start(
      { ...productDraft(row), name: `${row.name.slice(0, 112)} (Kopie)` },
      null,
    );
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
    setInvalidField('');
    restoreFocus();
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (invalidField && key === invalidField) setInvalidField('');
  }
  function resetFilters() {
    setSearch('');
    setStateFilter('');
  }
  async function submit() {
    if (saving.current || locked) return;
    const price = hundredths('price', values.price);
    if ('error' in price) {
      setInvalidField('price');
      setFormError(price.error);
      focusErrorSoon();
      return;
    }
    const tax = hundredths('tax', values.tax);
    if ('error' in tax) {
      setInvalidField('tax');
      setFormError(tax.error);
      focusErrorSoon();
      return;
    }
    saving.current = true;
    let saved = false;
    dialog.current?.focus({ preventScroll: true });
    setBusy(true);
    setFormError('');
    setInvalidField('');
    const input = {
      name: values.name,
      description: values.description,
      unit: values.unit,
      priceMinor: price.value,
      priceBasis: values.priceBasis,
      taxBasisPoints: tax.value,
      position: Number(values.position),
      state: values.state,
    };
    try {
      const response = await fetch(
        editing ? '/api/v1/products/' + editing.id : '/api/v1/products',
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
        const result = (await response
          .json()
          .catch(() => ({ error: 'unknown' }))) as { error?: string };
        setFormError(
          result.error === 'conflict' ? conflictMessage : saveFailureMessage,
        );
        focusErrorSoon();
        return;
      }
      saved = true;
      const stored = (await response
        .json()
        .catch(() => null)) as Product | null;
      setOpen(false);
      setEditing(null);
      const next = blankDraft();
      setValues(next);
      setBaseline(next);
      // The POST/PUT is confirmed. Report it first; a failing reload is a
      // refresh problem, not a reason to send the product again.
      setMessage('Produkt gespeichert.');
      if (stored && stored.id)
        setRows((current) => [
          ...current.filter((row) => row.id !== stored.id),
          stored,
        ]);
      try {
        await refresh();
      } catch {
        setReloadFailed(true);
      }
    } catch {
      // No response at all: the mutation may or may not have reached the
      // server. Keep the dialog and its values; saving stays locked until the
      // list has been read again, and no second POST is sent.
      setLocked(true);
      setFormError(unknownOutcomeMessage);
      focusErrorSoon();
    } finally {
      saving.current = false;
      setBusy(false);
      // The list actions are disabled while busy; restore focus after React
      // has re-enabled them instead of dropping it onto the document body.
      if (saved) setTimeout(restoreFocus, 0);
    }
  }
  async function archive(row: Product) {
    if (
      row.state === 'archived' ||
      saving.current ||
      busy ||
      archiveInFlight.current
    )
      return;
    archiveInFlight.current = true;
    // The action belongs to the row's disclosure, which closes on use; the
    // row itself stays visible and reports progress through the status line.
    setOpenActionsId(null);
    setBusy(true);
    setMessage('Produkt wird archiviert …');
    let reopen = false;
    try {
      const response = await fetch('/api/v1/products/' + row.id, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          name: row.name,
          description: row.description,
          unit: row.unit,
          priceMinor: row.priceMinor,
          priceBasis: row.priceBasis,
          taxBasisPoints: row.taxBasisPoints,
          position: row.position,
          state: 'archived',
          version: row.version,
        }),
      });
      if (!response.ok) {
        const result = (await response
          .json()
          .catch(() => ({ error: 'unknown' }))) as { error?: string };
        reopen = true;
        setMessage(
          result.error === 'conflict'
            ? conflictMessage
            : response.status === 404
              ? archiveMissingMessage
              : archiveFailureMessage,
        );
        return;
      }
      const stored = (await response
        .json()
        .catch(() => null)) as Product | null;
      // Only a plausible, versioned archive response replaces the row; an
      // unreadable one keeps the known list and asks for a reload instead.
      if (
        !stored ||
        stored.id !== row.id ||
        stored.state !== 'archived' ||
        stored.version !== row.version + 1
      ) {
        reopen = true;
        setMessage(archiveUnclearMessage);
        return;
      }
      setRows((current) =>
        current.map((entry) => (entry.id === stored.id ? stored : entry)),
      );
      setMessage('Produkt archiviert.');
    } catch {
      reopen = true;
      setMessage(archiveUnclearMessage);
    } finally {
      archiveInFlight.current = false;
      setBusy(false);
      // The action closes its disclosure; a failed one reappears so the user
      // keeps the row and can retry. Focus stays on the trigger, or falls back
      // to the create action when the archived row no longer matches a filter.
      if (reopen) setOpenActionsId(row.id);
      setTimeout(() => {
        const toggle = actionToggleRefs.current.get(row.id);
        const target = usableFocusTarget(toggle)
          ? toggle
          : createTrigger.current;
        if (usableFocusTarget(target)) target.focus({ preventScroll: true });
      }, 0);
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
  async function reloadList() {
    try {
      await refresh();
      setFormError('');
      setMessage(reloadedMessage);
    } catch {
      setFormError(unknownOutcomeMessage);
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
  const title = editing ? 'Produkt bearbeiten' : 'Produkt anlegen';
  return (
    <section id="products" aria-label="Produkte" aria-busy={loading || busy}>
      <h2>Produkte</h2>
      <div className="resource-toolbar product-toolbar">
        <label>
          Produkte suchen
          <input
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Zustand filtern
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
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
            aria-label="Produkt anlegen"
            title="Produkt anlegen"
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
      {loading && <p role="status">Produkte werden geladen …</p>}
      {!loading && !loadFailed && !rows.length && (
        <p>
          Noch keine Produkte. Über „Produkt anlegen“ das erste Produkt
          erfassen.
        </p>
      )}
      {!loading && rows.length > 0 && !filtered.length && (
        <>
          <p>Keine Treffer für die aktuellen Filter.</p>
          <button
            type="button"
            className="tertiary-action"
            onClick={resetFilters}
          >
            Filter zurücksetzen
          </button>
        </>
      )}
      <ul className="product-list">
        {filtered.map((row) => (
          <li
            key={row.id}
            className="product-row"
            ref={(element) => {
              if (element) actionRowRefs.current.set(row.id, element);
              else actionRowRefs.current.delete(row.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || openActionsId !== row.id) return;
              event.preventDefault();
              setOpenActionsId(null);
              focusActionToggle(row.id);
            }}
          >
            <span className="product-summary">{summary(row)}</span>{' '}
            <button
              className="secondary-action"
              disabled={busy}
              aria-label={`Produkt bearbeiten: ${row.name}`}
              onClick={() => openEdit(row)}
            >
              Bearbeiten
            </button>
            <button
              ref={(element) => {
                if (element) actionToggleRefs.current.set(row.id, element);
                else actionToggleRefs.current.delete(row.id);
              }}
              type="button"
              className="tertiary-action"
              disabled={busy}
              aria-label={`Weitere Aktionen für ${row.name}`}
              aria-expanded={openActionsId === row.id}
              aria-controls={`product-secondary-actions-${row.id}`}
              onClick={() =>
                setOpenActionsId((current) =>
                  current === row.id ? null : row.id,
                )
              }
            >
              Aktionen
            </button>
            <span
              id={`product-secondary-actions-${row.id}`}
              role="group"
              aria-label={`Aktionen für ${row.name}`}
              hidden={openActionsId !== row.id}
            >
              <button
                className="secondary-action"
                disabled={busy}
                aria-label={`Produkt duplizieren: ${row.name}`}
                onClick={() => {
                  // The trigger, not the disappearing group, owns the focus
                  // the dialog returns to.
                  focusActionToggle(row.id);
                  openDuplicate(row);
                }}
              >
                Duplizieren
              </button>
              <button
                className="tertiary-action"
                type="button"
                disabled={busy || row.state === 'archived'}
                aria-label={`Produkt archivieren: ${row.name}`}
                onClick={() => {
                  focusActionToggle(row.id);
                  void archive(row);
                }}
              >
                Archivieren
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p role={messageIsError ? 'alert' : 'status'}>{message}</p>
      {reloadFailed ? (
        <div className="reload-warning">
          <p role="status">{reloadFailureMessage}</p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={() => void retryReload()}
          >
            Produkte erneut laden
          </button>
        </div>
      ) : locked && !open ? (
        <div className="reload-warning">
          <p role="status">{unknownOutcomeMessage}</p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={() => void reloadList()}
          >
            Produkte erneut laden
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="tertiary-action"
          disabled={busy}
          onClick={() => void retryList()}
        >
          Produkte aktualisieren
        </button>
      )}
      {open && (
        <div className="form-dialog-backdrop">
          <div
            className="form-dialog product-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={busy}
            aria-labelledby="product-dialog-title"
            ref={dialog}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
          >
            <header className="form-dialog-header">
              <h3 id="product-dialog-title">{title}</h3>
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
                <label>
                  Produktname
                  <input
                    name="name"
                    required
                    maxLength={120}
                    value={values.name}
                    onChange={(event) => update('name', event.target.value)}
                  />
                </label>
                <label>
                  Produktbeschreibung
                  <textarea
                    name="description"
                    maxLength={2000}
                    value={values.description}
                    onChange={(event) =>
                      update('description', event.target.value)
                    }
                  />
                </label>
                <label>
                  Einheit
                  <input
                    name="unit"
                    required
                    maxLength={40}
                    value={values.unit}
                    onChange={(event) => update('unit', event.target.value)}
                  />
                </label>
                <label>
                  Preis in Euro
                  <input
                    name="price"
                    inputMode="decimal"
                    required
                    maxLength={17}
                    aria-invalid={invalidField === 'price' ? true : undefined}
                    aria-describedby={
                      invalidField === 'price'
                        ? 'product-form-error'
                        : undefined
                    }
                    value={values.price}
                    onChange={(event) => update('price', event.target.value)}
                  />
                </label>
                <label>
                  Preisbasis
                  <select
                    name="priceBasis"
                    value={values.priceBasis}
                    onChange={(event) =>
                      update('priceBasis', event.target.value)
                    }
                  >
                    <option value="gross">Brutto</option>
                    <option value="net">Netto</option>
                  </select>
                </label>
                <label>
                  Steuersatz in Prozent
                  <input
                    name="tax"
                    inputMode="decimal"
                    required
                    maxLength={6}
                    aria-invalid={invalidField === 'tax' ? true : undefined}
                    aria-describedby={
                      invalidField === 'tax' ? 'product-form-error' : undefined
                    }
                    value={values.tax}
                    onChange={(event) => update('tax', event.target.value)}
                  />
                </label>
                <label>
                  Produktsortierung
                  <input
                    name="position"
                    type="number"
                    min={0}
                    max={9999}
                    required
                    value={values.position}
                    onChange={(event) => update('position', event.target.value)}
                  />
                </label>
                <label>
                  Produktzustand
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
                {formError && (
                  <p
                    className="field-error"
                    role="alert"
                    id="product-form-error"
                    tabIndex={-1}
                    ref={errorMessage}
                  >
                    {formError}
                  </p>
                )}
                {locked && (
                  <button
                    type="button"
                    className="tertiary-action"
                    disabled={busy}
                    onClick={() => void reloadList()}
                  >
                    Liste neu laden
                  </button>
                )}
                <p className="sr-only" role="status">
                  {busy
                    ? editing
                      ? 'Produkt wird gespeichert …'
                      : 'Produkt wird angelegt …'
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
                  Abbrechen
                </button>
                <button className="primary-action" disabled={busy || locked}>
                  {busy ? 'Wird gespeichert …' : 'Produkt speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
