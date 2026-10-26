import { useEffect, useRef, useState } from 'react';

/** A contact as the search answers it: the stored row, never a projection. */
export type ContactHit = {
  id: string;
  name: string;
  state: string;
  kind?: string;
  contactPerson?: string;
  city?: string;
};

/** The visible result count stays small enough to stay readable. */
export const contactHitLimit = 20;

export type ContactSearchState = 'idle' | 'loading' | 'ready' | 'failed';

/** The search state one picker keeps, so the caller can reset or repeat it. */
export type ContactSearch = {
  query: string;
  state: ContactSearchState;
  hits: ContactHit[];
  search: (value: string) => void;
  reset: () => void;
};

/**
 * BKP012.2: the search behind every contact picker. It lives here once, so the
 * event dialog and the event editor cannot drift apart in query handling, the
 * sequence guard or the "nothing found" wording. A late answer of an older
 * request is void.
 */
export function useContactSearch(): ContactSearch {
  const sequence = useRef(0),
    [query, setQuery] = useState(''),
    [state, setState] = useState<ContactSearchState>('idle'),
    [hits, setHits] = useState<ContactHit[]>([]);
  function search(value: string) {
    setQuery(value);
    const current = ++sequence.current,
      trimmed = value.trim();
    if (!trimmed) {
      setHits([]);
      setState('idle');
      return;
    }
    setState('loading');
    void fetch('/api/v1/contacts?q=' + encodeURIComponent(trimmed))
      .then(async (response) => {
        if (!response.ok) throw Error('search');
        return (await response.json()) as ContactHit[];
      })
      .then((rows) => {
        // Only the newest request may write the list; a late answer is void.
        if (current !== sequence.current) return;
        setHits(Array.isArray(rows) ? rows : []);
        setState('ready');
      })
      .catch(() => {
        if (current !== sequence.current) return;
        setHits([]);
        setState('failed');
      });
  }
  function reset() {
    // A new editing context starts empty: no stale hits, no stale note, and no
    // late answer may fill the list of the next event.
    sequence.current += 1;
    setQuery('');
    setHits([]);
    setState('idle');
  }
  return { query, state, hits, search, reset };
}

/** The quiet second line of a hit: company form, person and town. */
export function contactLine(hit: ContactHit) {
  const parts = [
    hit.kind === 'company' ? 'Firma' : '',
    hit.contactPerson ?? '',
    hit.city ?? '',
  ].filter(Boolean);
  if (hit.state !== 'active') parts.push('Archiviert/Inaktiv');
  return parts.length ? parts.join(' · ') : 'Privatperson';
}

/**
 * One contact search for every place that assigns a main contact: search, take
 * a hit, remove the choice, or deliberately create a new contact.
 *
 * `value` is the id that the surrounding form submits and `selected` is the
 * resolved row that is shown. They travel separately, because a stored
 * assignment stays readable (and unchanged) even when the loaded list does not
 * contain it any more.
 */
export function ContactPicker({
  search,
  idPrefix,
  label = 'Kunde suchen',
  value,
  selected,
  hiddenName,
  onSelect,
  onClear,
  onCreate,
  disabled = false,
  focusRequest = 0,
}: {
  search: ContactSearch;
  // A prefix keeps every id unique when two forms share the document.
  idPrefix: string;
  label?: string;
  value: string;
  selected: ContactHit | null;
  hiddenName: string;
  onSelect: (row: ContactHit) => void;
  onClear: () => void;
  onCreate: () => void;
  disabled?: boolean;
  // A counter, not a ref: the caller focuses the search after a view change.
  focusRequest?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  const helpId = `${idPrefix}-contact-help`,
    hitsId = `${idPrefix}-contact-hits`;
  return (
    <div className="contact-picker">
      <label>
        {label}
        <input
          ref={input}
          name="contactSearch"
          type="search"
          maxLength={200}
          autoComplete="off"
          value={search.query}
          aria-describedby={helpId}
          aria-controls={hitsId}
          onChange={(event) => search.search(event.currentTarget.value)}
          // Enter belongs to the surrounding form, not to a search that runs
          // while typing: it must never save the event by accident.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </label>
      <p id={helpId}>Sucht nach Name, Ansprechpartner, Ort und Kontaktdaten.</p>
      <input type="hidden" name={hiddenName} value={value} />
      <p className="contact-picker-current">
        <span>
          {value
            ? `Kunde: ${selected?.name ?? 'Zugeordneter Kontakt'}${
                selected && selected.state !== 'active'
                  ? ' (Archiviert/Inaktiv)'
                  : ''
              }`
            : 'Kein Kunde ausgewählt – das Event bleibt ohne Kundenbezug.'}
        </span>
        {value && (
          <button type="button" className="tertiary-action" onClick={onClear}>
            Kunde entfernen
          </button>
        )}
      </p>
      {search.state === 'loading' && (
        <p role="status">Kontakte werden gesucht …</p>
      )}
      {search.state === 'ready' && search.hits.length === 0 && (
        <p role="status">Keine Kontakte gefunden.</p>
      )}
      {search.state === 'failed' && (
        <p role="status">
          Kontakte konnten nicht gesucht werden. Die bisherige Auswahl bleibt
          bestehen.
        </p>
      )}
      {search.hits.length > 0 && (
        <ul
          className="contact-picker-hits"
          id={hitsId}
          aria-label="Kontakte gefunden"
        >
          {search.hits.slice(0, contactHitLimit).map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="contact-picker-hit"
                aria-pressed={row.id === value}
                disabled={row.state !== 'active'}
                onClick={() => onSelect(row)}
              >
                <span className="contact-picker-name">{row.name}</span>
                <span className="contact-picker-detail">
                  {contactLine(row)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.hits.length > contactHitLimit && (
        <p>
          {`Suche eingrenzen: nur die ersten ${contactHitLimit} Treffer werden angezeigt.`}
        </p>
      )}
      <button
        type="button"
        className="secondary-action"
        disabled={disabled}
        onClick={onCreate}
      >
        Neuen Kunden anlegen
      </button>
    </div>
  );
}
