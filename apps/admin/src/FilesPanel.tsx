import { useEffect, useRef, useState } from 'react';
import { useAutoRefresh } from './auto-refresh.js';
import {
  eventTargetHref,
  filesPage,
  filesRequest,
  updateUrlSearch,
  useUrlSearch,
} from './url-state.js';

// H035: the Dateien page lists the existing business documents. It shows only
// what the document list actually knows; uploaded files live in the separate
// library region below (BKP020.1).
export const fileKinds = [
  ['', 'Alle Arten'],
  ['offer', 'Angebot'],
  ['order_confirmation', 'Auftragsbestätigung'],
  ['deposit_invoice', 'Anzahlungsrechnung'],
  ['invoice', 'Rechnung'],
  ['correction', 'Rechnungskorrektur'],
] as const;
export const fileStates = [
  ['', 'Alle Zustände'],
  ['draft', 'Entwurf'],
  ['final', 'Finalisiert'],
  ['withdrawn', 'Zurückgezogen'],
] as const;
// BKP019.e: the derived payment state of a claim, labelled like the event file.
// "Überfällig" is deliberately its own axis (a date comparison), never merged
// into the payment state.
export const filePayments = [
  ['', 'Alle Zahlungsstände'],
  ['none', 'Offen'],
  ['partial', 'Teilweise bezahlt'],
  ['paid', 'Bezahlt'],
] as const;
// The tri-state of the late filter. Absent means "every document", so the third
// value is a real filter and not a synonym for leaving the field empty.
export const fileOverdueOptions = [
  ['', 'Alle Fälligkeiten'],
  ['true', 'Nur überfällig'],
  ['false', 'Nicht überfällig'],
] as const;
// The label maps are only for display. Validation uses the explicit enum lists
// below, so a row claiming `constructor` or `toString` is rejected instead of
// matching an inherited object key.
const kindLabels = Object.fromEntries(
    fileKinds.filter(([value]) => value),
  ) as Record<string, string>,
  stateLabels = Object.fromEntries(
    fileStates.filter(([value]) => value),
  ) as Record<string, string>;
const kindList: readonly string[] = fileKinds
    .map(([value]) => value)
    .filter(Boolean),
  stateList: readonly string[] = fileStates
    .map(([value]) => value)
    .filter(Boolean),
  paymentList: readonly string[] = filePayments
    .map(([value]) => value)
    .filter(Boolean);
// The same labels the event file uses, so one document never appears under two
// different names in two places.
const paymentStateLabels: Record<string, string> = Object.fromEntries(
  filePayments.filter(([value]) => value),
);
function knownKind(value: unknown): value is string {
  return typeof value === 'string' && kindList.includes(value);
}
function knownState(value: unknown): value is string {
  return typeof value === 'string' && stateList.includes(value);
}
export const pageSize = 25;
// The URL namespace stays the deep-link contract. The four additive keys are
// validated here rather than in `url-state.ts`, because that module owns the
// established `df_*` set and an invalid value must never reach the server.
const dfKeys = [
  'df_kind',
  'df_state',
  'df_from',
  'df_to',
  'df_due_from',
  'df_due_to',
  'df_overdue',
  'df_payment',
  'df_page',
];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
// A visible control must show exactly what the request uses, so a day the API
// would refuse (31 February, month 13) is dropped instead of displayed.
function validDay(value: string | null): string {
  if (!value || !dayPattern.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
    ? value
    : '';
}
// The list carries exact minor units. Dividing by 100 first would round the
// largest safe value by one cent, so the euro and cent parts are split as
// integers and only the thousands separator is added.
export function exactMinorUnits(minor: number): string | null {
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  const padded = String(minor).padStart(3, '0'),
    euros = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return euros + ',' + padded.slice(-2);
}

type FileRow = {
  id: string;
  kind: string;
  eventId: string | null;
  number: string | null;
  state: string;
  issuedAt: string;
  issuedDate: string;
  eventName: string | null;
  grossMinor: number;
  pdfAvailable: boolean;
  // BKP019.e: the derived payment facts of the index. `null` is the honest value
  // for a row that is no claim - never a derived zero and never "offen".
  dueDate: string | null;
  paymentState: string | null;
  openMinor: number | null;
  overdue: boolean | null;
};
type FileFilters = {
  kind: string;
  state: string;
  from: string;
  to: string;
  dueFrom: string;
  dueTo: string;
  overdue: string;
  payment: string;
};
const emptyFilters: FileFilters = {
  kind: '',
  state: '',
  from: '',
  to: '',
  dueFrom: '',
  dueTo: '',
  overdue: '',
  payment: '',
};
// The one field-to-deep-link map: the column and the sheet write the same keys,
// so no control can invent a name the reader does not know.
const filterKeys: Record<keyof FileFilters, string> = {
  kind: 'df_kind',
  state: 'df_state',
  from: 'df_from',
  to: 'df_to',
  dueFrom: 'df_due_from',
  dueTo: 'df_due_to',
  overdue: 'df_overdue',
  payment: 'df_payment',
};
// One reader for the whole page: the form controls and the request are built from
// the same validated values, so the panel can never send a filter it does not
// show.
function readFilters(search: string): FileFilters {
  const source = new URLSearchParams(search),
    payment = source.get('df_payment') ?? '',
    overdue = source.get('df_overdue') ?? '';
  return {
    kind: source.get('df_kind') ?? '',
    state: source.get('df_state') ?? '',
    from: validDay(source.get('df_from')),
    to: validDay(source.get('df_to')),
    dueFrom: validDay(source.get('df_due_from')),
    dueTo: validDay(source.get('df_due_to')),
    overdue: overdue === 'true' || overdue === 'false' ? overdue : '',
    payment: paymentList.includes(payment) ? payment : '',
  };
}
// UI-01: the compact access names how many criteria are applied. The applied URL
// is counted, never the sheet's draft, so the number always matches the request.
export function activeFileCriteria(filters: FileFilters): number {
  return Object.values(filters).filter(Boolean).length;
}
// The quiet group carries the payment and due axes. It starts folded unless one
// of them is applied, so the first viewport stays a list with four choices.
function hasDueFilters(filters: FileFilters): boolean {
  return Boolean(
    filters.dueFrom || filters.dueTo || filters.overdue || filters.payment,
  );
}
// The additive filters are appended to the established request, in the order the
// API documents them. An unset filter adds no parameter at all.
function filterExtras(filters: FileFilters): string {
  const params = new URLSearchParams();
  if (filters.dueFrom) params.set('due_from', filters.dueFrom);
  if (filters.dueTo) params.set('due_to', filters.dueTo);
  if (filters.overdue) params.set('overdue', filters.overdue);
  if (filters.payment) params.set('payment', filters.payment);
  const query = params.toString();
  return query ? '&' + query : '';
}
function listRequest(search: string, size: number): string {
  return filesRequest(search, size) + filterExtras(readFilters(search));
}
// UI-01: the sheet commits its whole draft in one write. Building the nine keys
// here keeps the one completion a single history entry.
function draftValues(filters: FileFilters): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of Object.keys(filterKeys) as (keyof FileFilters)[])
    values[filterKeys[field]] = filters[field];
  return values;
}
// UI-01: the measured breakpoint. The shell keeps 18rem of sidebar and the page
// 2.5/1.75rem of padding, so 1024 px leave 638 px for the section content; a
// 192 px context column plus the table's 40rem would need 848 px there. Only at
// 1280 px do the column (192 px), the gap (16 px) and the compacted table
// (measured 684 px) share one row without the body or the table scrolling.
export const wideFileFilters = '(min-width: 1280px)';
function useWideFileFilters() {
  const [wide, setWide] = useState(
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia(wideFileFilters).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia(wideFileFilters);
    const changed = () => setWide(viewport.matches);
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);
  return wide;
}
const loadFailure = 'Dateien konnten nicht geladen werden.';
const emptyText = 'Keine Dokumente für diese Filter.';

function validRows(reply: unknown): FileRow[] | null {
  if (!Array.isArray(reply)) return null;
  const rows: FileRow[] = [];
  for (const entry of reply as Partial<FileRow>[]) {
    // Every field is narrowed before it is used, so one off-shape row rejects
    // the answer as a whole instead of throwing halfway through the table.
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !knownKind(entry.kind) ||
      !knownState(entry.state) ||
      typeof entry.issuedDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.issuedDate) ||
      typeof entry.grossMinor !== 'number' ||
      !Number.isSafeInteger(entry.grossMinor) ||
      entry.grossMinor < 0 ||
      typeof entry.pdfAvailable !== 'boolean' ||
      // A missing payment fact is not "nothing is open": the answer is refused
      // instead of being displayed as an invented state.
      (entry.dueDate !== null && !dayPattern.test(String(entry.dueDate))) ||
      (entry.paymentState !== null &&
        !paymentList.includes(String(entry.paymentState))) ||
      (entry.openMinor !== null &&
        (typeof entry.openMinor !== 'number' ||
          !Number.isSafeInteger(entry.openMinor) ||
          entry.openMinor < 0)) ||
      (entry.overdue !== null && typeof entry.overdue !== 'boolean')
    )
      return null;
    rows.push(entry as FileRow);
  }
  return rows;
}

function dateText(day: string) {
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}

export function FilesPanel({
  active = true,
  revision = 0,
}: {
  active?: boolean;
  revision?: number;
} = {}) {
  const sequence = useRef(0),
    [rows, setRows] = useState<FileRow[]>([]),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [hasNext, setHasNext] = useState(false),
    [filters, setFilters] = useState<FileFilters>(() =>
      readFilters(window.location.search),
    );
  // UI-01: the filters live in a context column on wide screens and in one modal
  // sheet behind a compact access below that. `null` means no sheet is open; the
  // sheet's copy is taken from the applied URL on open.
  const wide = useWideFileFilters(),
    drawer = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    firstField = useRef<HTMLSelectElement>(null),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<FileFilters | null>(null),
    // The quiet group stays folded unless it is in use; it is opened by a
    // payment filter and never force-closed by an unrelated change.
    [dueOpen, setDueOpen] = useState(() =>
      hasDueFilters(readFilters(window.location.search)),
    ),
    dueApplied = hasDueFilters(filters);
  // The whole page follows the URL, so every filter, page and browser-back
  // step re-reads exactly one source of truth.
  const search = useUrlSearch(),
    { page } = filesPage(search, pageSize),
    criteria = activeFileCriteria(filters);
  async function load() {
    const current = ++sequence.current;
    setLoading(true);
    try {
      // One extra row only decides whether a next page exists; it is never
      // counted as a total and never displayed.
      const reply = await fetch(listRequest(window.location.search, pageSize));
      if (!reply.ok) throw Error('load');
      const parsed = validRows(await reply.json());
      if (!parsed) throw Error('shape');
      if (current !== sequence.current) return;
      setRows(parsed.slice(0, pageSize));
      setHasNext(parsed.length > pageSize);
      setFailed(false);
    } catch {
      // Last good rows stay visible; only the honest failure is added.
      if (current === sequence.current) setFailed(true);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  // Only load while this page is the visible area. The panel stays mounted, so
  // the filters and rows survive a trip into an event and back.
  useEffect(() => {
    if (!active) return;
    setFilters(readFilters(search));
    void load();
    // A hidden page is never re-fetched; coming back re-reads the current URL,
    // and the sequence guard discards a late answer from an older combination.
  }, [active, search, page, revision]);
  // A deep link or an applied payment filter is a reason to unfold the quiet
  // group; closing it by hand stays closed until the next applied change.
  useEffect(() => {
    if (dueApplied) setDueOpen(true);
  }, [dueApplied]);
  useEffect(() => {
    if (!open || wide) return;
    const sheet = drawer.current;
    if (!sheet) return;
    if (!sheet.open) sheet.showModal();
    firstField.current?.focus({ preventScroll: true });
  }, [open, wide]);
  useEffect(() => {
    if (wide) {
      setOpen(false);
      setDraft(null);
    }
  }, [wide]);
  useAutoRefresh(
    () => {
      if (active) void load();
    },
    () => loading,
  );
  useEffect(() => {
    return () => {
      ++sequence.current;
    };
  }, []);
  function apply(changes: Record<string, string>) {
    // A filter change always returns to the first page in one history entry and
    // never touches the global search parameters.
    updateUrlSearch({ ...changes, df_page: '' }, undefined, dfKeys);
  }
  function goToPage(next: number) {
    updateUrlSearch({ df_page: next > 0 ? String(next) : '' });
  }
  function reset() {
    setFilters(emptyFilters);
    updateUrlSearch({
      df_kind: '',
      df_state: '',
      df_from: '',
      df_to: '',
      df_due_from: '',
      df_due_to: '',
      df_overdue: '',
      df_payment: '',
      df_page: '',
    });
  }
  function openFilters() {
    // The sheet starts from what is applied, never from an abandoned draft.
    setDraft(readFilters(window.location.search));
    setOpen(true);
  }
  function closeFilters() {
    drawer.current?.close();
    setOpen(false);
    // Cancel is a real cancel: the sheet's copy dies with the sheet.
    setDraft(null);
    trigger.current?.focus({ preventScroll: true });
  }
  function eventHref(id: string | null) {
    return id && uuidPattern.test(id) ? eventTargetHref(search, id) : null;
  }
  function rowName(row: FileRow) {
    const kind = kindLabels[row.kind];
    if (row.number) return kind + ' ' + row.number;
    // Without a number the real state names the row; a withdrawn document is
    // not a draft just because the number is missing.
    return kind + ' · ' + stateLabels[row.state];
  }
  // The same form in both frames, with opposite writing rules: the column
  // applies every choice immediately (the URL is its state), the sheet keeps one
  // draft until „Ergebnisse anzeigen“.
  function filterPanel(mobile: boolean) {
    const drafting = mobile && draft !== null,
      values = (drafting && draft) || filters;
    function chooseOne(field: keyof FileFilters, value: string) {
      if (drafting) setDraft({ ...values, [field]: value });
      else apply({ [filterKeys[field]]: value });
    }
    return (
      <form
        className="files-filter-form"
        // The column re-initialises from the applied URL after every write; the
        // sheet must not remount while its draft is being edited.
        key={mobile ? 'files-filter-draft' : search}
        onSubmit={(event) => {
          event.preventDefault();
          // BKP007 pattern: the sheet commits its whole draft in one write, one
          // history entry and one reload; then the same close path as cancel.
          if (!drafting) return;
          apply(draftValues(values));
          closeFilters();
        }}
      >
        <fieldset className="files-filter-group">
          <legend>Dokumentart</legend>
          <select
            ref={mobile ? firstField : undefined}
            aria-label="Dokumentart"
            value={values.kind}
            onChange={(event) => chooseOne('kind', event.target.value)}
          >
            {fileKinds.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="files-filter-group">
          <legend>Datumsbereich</legend>
          <label>
            Von
            <input
              type="date"
              value={values.from}
              onChange={(event) => chooseOne('from', event.target.value)}
            />
          </label>
          <label>
            Bis
            <input
              type="date"
              value={values.to}
              onChange={(event) => chooseOne('to', event.target.value)}
            />
          </label>
        </fieldset>
        <fieldset className="files-filter-group">
          <legend>Status</legend>
          <select
            aria-label="Status"
            value={values.state}
            onChange={(event) => chooseOne('state', event.target.value)}
          >
            {fileStates.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </fieldset>
        {/* The quiet subgroup: same four axes, folded away until one is used. */}
        <details
          className="files-filter-group files-filter-quiet"
          open={mobile || dueOpen}
          onToggle={
            mobile ? undefined : (event) => setDueOpen(event.currentTarget.open)
          }
        >
          <summary>Zahlung und Frist</summary>
          <label>
            Fällig von
            <input
              type="date"
              value={values.dueFrom}
              onChange={(event) => chooseOne('dueFrom', event.target.value)}
            />
          </label>
          <label>
            Fällig bis
            <input
              type="date"
              value={values.dueTo}
              onChange={(event) => chooseOne('dueTo', event.target.value)}
            />
          </label>
          <label>
            Überfällig
            <select
              value={values.overdue}
              onChange={(event) => chooseOne('overdue', event.target.value)}
            >
              {fileOverdueOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zahlungsstand
            <select
              value={values.payment}
              onChange={(event) => chooseOne('payment', event.target.value)}
            >
              {filePayments.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </details>
        <div className="files-filter-actions">
          {mobile ? (
            <>
              <button className="secondary-action">Ergebnisse anzeigen</button>
              <button
                type="button"
                className="tertiary-action"
                onClick={closeFilters}
              >
                Abbrechen
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="icon-action tier-quiet-icon"
            aria-label="Filter zurücksetzen"
            title="Filter zurücksetzen"
            // In the sheet the reset clears the draft only; the applied filter
            // changes when the operator completes the draft.
            onClick={() => {
              if (drafting) setDraft(emptyFilters);
              else reset();
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </form>
    );
  }
  return (
    <section id="files" className="files-panel" aria-label="Dateien">
      <p className="files-subtitle">
        Geschäftsdokumente aus Angeboten und Rechnungen. Hochgeladene Dateien
        stehen in der Dateibibliothek darunter.
      </p>
      <div className="files-layout">
        {wide ? (
          <aside
            className="files-context files-filters"
            aria-label="Dateifilter"
          >
            {filterPanel(false)}
          </aside>
        ) : (
          <>
            {/* The narrow frame shows the list first; the whole filter set lives
                behind this one access, with its applied criteria count. */}
            <div className="files-filter-access">
              <button
                ref={trigger}
                type="button"
                className="secondary-action files-filter-trigger"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="file-filter-panel"
                aria-label={`Filter, ${criteria} aktive Kriterien`}
                onClick={() => openFilters()}
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
                  <path d="M4 5h16l-6 7v6l-4 2v-8Z" />
                </svg>
                Filter{' '}
                <span className="event-count" data-testid="file-filter-count">
                  {criteria}
                </span>
              </button>
              {criteria > 0 && (
                <button
                  type="button"
                  className="tertiary-action"
                  onClick={reset}
                >
                  Zurücksetzen
                </button>
              )}
            </div>
            <dialog
              id="file-filter-panel"
              className="event-filter-drawer files-filter-drawer"
              aria-label="Dateifilter"
              ref={drawer}
              onCancel={(event) => {
                event.preventDefault();
                closeFilters();
              }}
              onClose={() => {
                setOpen(false);
                setDraft(null);
                trigger.current?.focus({ preventScroll: true });
              }}
            >
              {open && (
                <>
                  <div className="event-filter-drawer-head">
                    <h2>Filter</h2>
                    <button
                      type="button"
                      className="icon-action tier-quiet-icon"
                      aria-label="Filter schließen"
                      title="Filter schließen"
                      onClick={closeFilters}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                  {filterPanel(true)}
                </>
              )}
            </dialog>
          </>
        )}
        <div className="files-results">
          {failed && (
            <div className="reload-warning">
              <p role="alert">
                {loadFailure} Angezeigt ist der letzte Stand; die Filter zeigen
                den angeforderten Stand.
              </p>
              <button
                type="button"
                className="tertiary-action"
                onClick={() => void load()}
              >
                Dateien erneut laden
              </button>
            </div>
          )}
          {loading && !rows.length ? (
            <p role="status">Dateien werden geladen …</p>
          ) : rows.length ? (
            <div className="files-table-shell">
              <table className="files-table">
                <caption className="sr-only">
                  Geschäftsdokumente mit Status, Art, Datum, Betrag, Fälligkeit,
                  Event und Zahlungsstand
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Dokument</th>
                    <th scope="col">Datum</th>
                    <th scope="col">Betrag</th>
                    <th scope="col">Fällig</th>
                    <th scope="col">Event</th>
                    <th scope="col">Zahlung</th>
                    <th scope="col">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const href = eventHref(row.eventId);
                    return (
                      <tr key={row.id} id={'file-' + row.id}>
                        <td>
                          <span className="files-state">
                            {stateLabels[row.state]}
                          </span>
                        </td>
                        <th scope="row">{rowName(row)}</th>
                        <td>
                          <time dateTime={row.issuedDate}>
                            {dateText(row.issuedDate)}
                          </time>
                        </td>
                        <td className="numeric">
                          {exactMinorUnits(row.grossMinor)} €
                        </td>
                        {/* BKP019.e: the frozen due day, never a guessed one. */}
                        <td>
                          {row.dueDate ? (
                            <span className="files-due">
                              <time dateTime={row.dueDate}>
                                {dateText(row.dueDate)}
                              </time>
                            </span>
                          ) : (
                            <span className="muted">Keine Frist</span>
                          )}
                        </td>
                        <td className="files-event-cell">
                          {href ? (
                            <a href={href}>{row.eventName ?? 'Event öffnen'}</a>
                          ) : (
                            <span className="muted">Kein Event</span>
                          )}
                        </td>
                        {/* The derived payment state and its own late badge,
                            exactly like the event file: "offen" and
                            "überfällig" are two axes, so neither replaces the
                            other. */}
                        <td className="files-payment-cell">
                          {row.paymentState ? (
                            <>
                              <span>
                                {paymentStateLabels[row.paymentState]}
                              </span>
                              {row.overdue === true && (
                                <>
                                  {' · '}
                                  <strong className="document-overdue">
                                    Überfällig
                                  </strong>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {row.pdfAvailable ? (
                            <a
                              href={'/api/v1/documents/' + row.id + '/pdf'}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={rowName(row) + ' als PDF öffnen'}
                            >
                              PDF öffnen
                            </a>
                          ) : row.state === 'draft' ? (
                            <span className="muted">Als Entwurf im Event</span>
                          ) : (
                            <span className="muted">Keine PDF</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{emptyText}</p>
          )}
          <div className="files-pager">
            <button
              type="button"
              className="icon-action tier-quiet-icon"
              aria-label="Vorherige Seite"
              title="Vorherige Seite"
              disabled={page === 0 || loading}
              onClick={() => goToPage(page - 1)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M14 6l-6 6 6 6" />
              </svg>
            </button>
            <span aria-live="polite">Seite {page + 1}</span>
            <button
              type="button"
              className="icon-action tier-quiet-icon"
              aria-label="Nächste Seite"
              title="Nächste Seite"
              disabled={!hasNext || loading}
              onClick={() => goToPage(page + 1)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M10 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
