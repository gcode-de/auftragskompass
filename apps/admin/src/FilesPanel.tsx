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
    .filter(Boolean);
function knownKind(value: unknown): value is string {
  return typeof value === 'string' && kindList.includes(value);
}
function knownState(value: unknown): value is string {
  return typeof value === 'string' && stateList.includes(value);
}
export const pageSize = 25;
const dfKeys = ['df_kind', 'df_state', 'df_from', 'df_to', 'df_page'];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
};
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
      typeof entry.pdfAvailable !== 'boolean'
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
    [filters, setFilters] = useState(() => ({
      kind: new URLSearchParams(window.location.search).get('df_kind') ?? '',
      state: new URLSearchParams(window.location.search).get('df_state') ?? '',
      from: new URLSearchParams(window.location.search).get('df_from') ?? '',
      to: new URLSearchParams(window.location.search).get('df_to') ?? '',
    }));
  // The whole page follows the URL, so every filter, page and browser-back
  // step re-reads exactly one source of truth.
  const search = useUrlSearch(),
    { page } = filesPage(search, pageSize);
  async function load() {
    const current = ++sequence.current;
    setLoading(true);
    try {
      // One extra row only decides whether a next page exists; it is never
      // counted as a total and never displayed.
      const reply = await fetch(filesRequest(window.location.search, pageSize));
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
    const source = new URLSearchParams(search);
    setFilters({
      kind: source.get('df_kind') ?? '',
      state: source.get('df_state') ?? '',
      from: source.get('df_from') ?? '',
      to: source.get('df_to') ?? '',
    });
    void load();
    // A hidden page is never re-fetched; coming back re-reads the current URL,
    // and the sequence guard discards a late answer from an older combination.
  }, [active, search, page, revision]);
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
    const cleared = {
      df_kind: '',
      df_state: '',
      df_from: '',
      df_to: '',
      df_page: '',
    };
    setFilters({ kind: '', state: '', from: '', to: '' });
    updateUrlSearch(cleared);
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
  return (
    <section id="files" className="files-panel" aria-label="Dateien">
      <p className="files-subtitle">
        Geschäftsdokumente aus Angeboten und Rechnungen. Hochgeladene Dateien
        stehen in der Dateibibliothek darunter.
      </p>
      <div className="files-filters" role="group" aria-label="Dateifilter">
        <label>
          Dokumentart
          <select
            value={filters.kind}
            onChange={(event) => apply({ df_kind: event.target.value })}
          >
            {fileKinds.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={filters.state}
            onChange={(event) => apply({ df_state: event.target.value })}
          >
            {fileStates.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Von
          <input
            type="date"
            value={filters.from}
            onChange={(event) => apply({ df_from: event.target.value })}
          />
        </label>
        <label>
          Bis
          <input
            type="date"
            value={filters.to}
            onChange={(event) => apply({ df_to: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="icon-action tier-quiet-icon"
          aria-label="Filter zurücksetzen"
          title="Filter zurücksetzen"
          onClick={reset}
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
      {failed && (
        <div className="reload-warning">
          <p role="alert">
            {loadFailure} Angezeigt ist der letzte Stand; die Filter oben zeigen
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
              Geschäftsdokumente mit Art, Datum, Status und Betrag
            </caption>
            <thead>
              <tr>
                <th scope="col">Dokument</th>
                <th scope="col">Datum</th>
                <th scope="col">Event</th>
                <th scope="col">Betrag</th>
                <th scope="col">Status</th>
                <th scope="col">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = eventHref(row.eventId);
                return (
                  <tr key={row.id} id={'file-' + row.id}>
                    <th scope="row">{rowName(row)}</th>
                    <td>
                      <time dateTime={row.issuedDate}>
                        {dateText(row.issuedDate)}
                      </time>
                    </td>
                    <td>
                      {href ? (
                        <a href={href}>{row.eventName ?? 'Event öffnen'}</a>
                      ) : (
                        <span className="muted">Kein Event</span>
                      )}
                    </td>
                    <td className="numeric">
                      {exactMinorUnits(row.grossMinor)} €
                    </td>
                    <td>{stateLabels[row.state]}</td>
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
    </section>
  );
}
