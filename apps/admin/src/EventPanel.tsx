import { EventDetails } from './EventDetails.js';
import {
  useUrlSearch,
  updateUrlSearch,
  eventQuery,
  emptyEventFilters,
} from './url-state.js';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import { localDateTime, resolveEventTime } from './event-time.js';
import { listScheduleText } from './calendar-range.js';
import { EventTimeField } from './EventTimeField.js';
import { EventCreateDialog } from './EventCreateDialog.js';
import {
  initialVenueText,
  legacyPlaceText,
  shownVenue,
  venueMaxLength,
  venuePayload,
  type VenueChoice,
} from './venue.js';
import { useAutoRefresh } from './auto-refresh.js';
import {
  activeDatePreset,
  activeFilterCriteria,
  datePresetRange,
  datePresets,
  eventFilterCounts,
  monthGroups,
  type PresetId,
} from './event-filters.js';
type Choice = VenueChoice;
export type EventRow = {
  id: string;
  version: number;
  name: string;
  status: string;
  eventTypeId: string | null;
  packageId: string | null;
  locationId: string | null;
  venue: string | null;
  venueOverride: boolean;
  primaryContactId: string | null;
  additionalContactIds: string[];
  source: string;
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  description: string;
  notesHtml: string;
};
type Status = { code: string; label: string };

// BKP007: the filter panel is one form with one URL writer; only its frame
// changes — a fixed context column on wide screens, a modal sheet below. The
// query mirrors the stylesheet breakpoint; an environment without matchMedia
// keeps the column.
function useWideFilterLayout() {
  const [wide, setWide] = useState(
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia('(min-width: 1024px)');
    const changed = () => setWide(viewport.matches);
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);
  return wide;
}
export function EventPanel({
  csrfToken,
  revision = 0,
  showHeading = true,
}: {
  csrfToken: string;
  revision?: number;
  showHeading?: boolean;
}) {
  const [now, setNow] = useState(() => new Date().toISOString());
  const wide = useWideFilterLayout();
  const urlSearch = useUrlSearch(),
    filters = new URLSearchParams(urlSearch),
    sequence = useRef(0),
    saving = useRef(false),
    editor = useRef<HTMLDetailsElement>(null),
    createTrigger = useRef<HTMLButtonElement>(null),
    createReturnFocus = useRef<HTMLElement | null>(null),
    editReturnFocus = useRef<HTMLElement | null>(null),
    filterDrawer = useRef<HTMLDialogElement>(null),
    filterTrigger = useRef<HTMLButtonElement>(null),
    filterSearch = useRef<HTMLInputElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState<EventRow[]>([]),
    [draft, setDraft] = useState<EventRow | null>(null),
    [editing, setEditing] = useState(false),
    [detailId, setDetailId] = useState<string | null>(null),
    [timeZone, setTimeZone] = useState(''),
    [types, setTypes] = useState<Choice[]>([]),
    [packages, setPackages] = useState<Choice[]>([]),
    [locations, setLocations] = useState<Choice[]>([]),
    [venue, setVenue] = useState(''),
    [venueEdited, setVenueEdited] = useState(false),
    [contacts, setContacts] = useState<Choice[]>([]),
    [statuses, setStatuses] = useState<Status[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false),
    [creating, setCreating] = useState(false),
    [createInitial, setCreateInitial] = useState<EventRow | null>(null),
    [dateDerived, setDateDerived] = useState(false),
    [eventStatus, setEventStatus] = useState('inquiry'),
    [eventDate, setEventDate] = useState(''),
    [primaryContactId, setPrimaryContactId] = useState(''),
    [additionalContactIds, setAdditionalContactIds] = useState<string[]>([]),
    [scheduleErrors, setScheduleErrors] = useState<{
      startsAt?: string;
      endsAt?: string;
      eventDate?: string;
    }>({});
  async function refresh() {
    const current = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const responses = await Promise.all(
        [
          '/events',
          '/statuses',
          '/master-data/event_type',
          '/master-data/package',
          '/locations',
          '/contacts',
        ].map((path) =>
          fetch(
            '/api/v1' +
              path +
              (path === '/events' ? eventQuery(urlSearch) : ''),
          ),
        ),
      );
      if (responses.some((response) => !response.ok)) throw Error('load');
      const [events, statuses, types, packages, locations, contacts] =
        (await Promise.all(responses.map((response) => response.json()))) as [
          { timeZone: string; events: EventRow[] },
          Status[],
          Choice[],
          Choice[],
          Choice[],
          Choice[],
        ];
      if (current !== sequence.current) return;
      setRows(events.events);
      setTimeZone(events.timeZone);
      setStatuses(statuses);
      setTypes(types);
      setPackages(packages);
      setLocations(locations);
      setContacts(contacts);
      setReloadWarning(false);
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
    if (!draft || venueEdited) return;
    const next = initialVenueText(
      draft,
      locations.find((choice) => choice.id === draft.locationId),
    );
    setVenue((current) => (current === next ? current : next));
  }, [draft, locations, venueEdited]);
  function refreshOnReturn() {
    void refresh().catch(() => {});
  }
  useAutoRefresh(refreshOnReturn, () => loading || busy || saving.current);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [urlSearch, revision]);
  // H041: presets are calendar ranges, so a stale clock would make a range
  // look wrong after midnight. A slow tick keeps them honest without polling
  // data.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(
    () => () => {
      ++sequence.current;
    },
    [],
  );
  useEffect(() => {
    const changed = () => {
      const id = window.location.hash.slice(1);
      if (!id.startsWith('event-')) {
        setDetailId(null);
        return;
      }
      if (
        id.startsWith('event-') &&
        rows.some((row) => 'event-' + row.id === id)
      ) {
        setDetailId(id.slice(6));
        document.getElementById(id)?.scrollIntoView?.();
      } else setDetailId(null);
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [rows]);
  useEffect(() => {
    setEventStatus(draft?.status ?? 'inquiry');
    setEventDate(draft?.eventDate ?? '');
    setPrimaryContactId(draft?.primaryContactId ?? '');
    const primary = draft?.primaryContactId ?? '';
    setAdditionalContactIds(
      (draft?.additionalContactIds ?? []).filter((id) => id !== primary),
    );
    setDateDerived(Boolean(draft?.startsAt));
    setScheduleErrors({});
  }, [draft]);
  function clearScheduleError(field: 'startsAt' | 'endsAt' | 'eventDate') {
    setScheduleErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }
  useEffect(() => {
    if (draft) {
      editor.current!.open = true;
      document.getElementById('event-editor')?.scrollIntoView?.();
      document
        .querySelector<HTMLInputElement>('#event-editor input[name="name"]')
        ?.focus({ preventScroll: true });
    }
  }, [draft]);
  function openCreate(initial: EventRow | null = null) {
    if (editing || draft) return;
    createReturnFocus.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : createTrigger.current;
    setMessage('');
    setCreateInitial(initial);
    setCreating(true);
  }
  function restoreEditorFocus() {
    const target = editReturnFocus.current;
    editReturnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else
      setTimeout(
        () => createTrigger.current?.focus({ preventScroll: true }),
        0,
      );
  }
  function closeCreate() {
    setCreating(false);
    setCreateInitial(null);
    const target = createReturnFocus.current ?? createTrigger.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
  async function created() {
    setCreating(false);
    setCreateInitial(null);
    setMessage('Event gespeichert.');
    createTrigger.current?.focus({ preventScroll: true });
    try {
      await refresh();
      setReloadWarning(false);
    } catch {
      setReloadWarning(true);
    }
  }
  async function save(form: HTMLFormElement) {
    if (saving.current) return;
    setMessage('');
    const data = new FormData(form),
      value = (key: string) => String(data.get(key) ?? ''),
      zone = draft?.timeZone ?? timeZone;
    const choice = (key: string) =>
      value(key) === 'later'
        ? ('later' as const)
        : value(key) === 'earlier'
          ? ('earlier' as const)
          : '';
    const [startTime, endTime] = [
      resolveEventTime(value('startsAt'), zone, {
        originalInstant: draft?.startsAt ?? null,
        choice: choice('startsAtChoice'),
      }),
      resolveEventTime(value('endsAt'), zone, {
        originalInstant: draft?.endsAt ?? null,
        choice: choice('endsAtChoice'),
      }),
    ];
    const times = [startTime, endTime];
    if (
      times.some(
        (time) => time.kind === 'nonexistent' || time.kind === 'invalid',
      )
    ) {
      setMessage(
        'Termin prüfen: Uhrzeit existiert am gewählten Tag nicht. Bitte Beginn und Ende anpassen.',
      );
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (times.some((time) => time.kind === 'ambiguous')) {
      setMessage(
        'Termin prüfen: Die Uhrzeit kommt an diesem Tag zweimal vor. Bitte für Beginn und Ende Sommerzeit oder Normalzeit wählen.',
      );
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const rawStart = value('startsAt'),
      rawEnd = value('endsAt');
    const errors: {
      startsAt?: string;
      endsAt?: string;
      eventDate?: string;
    } = {};
    if (rawStart && !rawEnd) errors.endsAt = 'Bitte auch das Ende angeben.';
    if (!rawStart && rawEnd) errors.startsAt = 'Bitte auch den Beginn angeben.';
    if (
      startTime.kind === 'unique' &&
      endTime.kind === 'unique' &&
      Date.parse(startTime.instant) >= Date.parse(endTime.instant)
    )
      errors.endsAt = 'Das Ende muss nach dem Beginn liegen.';
    if (Object.keys(errors).length) {
      setScheduleErrors(errors);
      const field = errors.startsAt
        ? 'startsAt'
        : errors.endsAt
          ? 'endsAt'
          : 'eventDate';
      form.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    setScheduleErrors({});
    const businessDate = rawStart
      ? rawStart.slice(0, 10)
      : value('eventDate') || null;
    saving.current = true;
    setBusy(true);
    let saved = false;
    try {
      const input = {
        name: value('name'),
        status: value('status'),
        eventTypeId: value('eventTypeId') || null,
        packageId: value('packageId') || null,
        locationId: draft?.locationId ?? null,
        ...venuePayload(venue, venueEdited),
        primaryContactId: value('primaryContactId') || null,
        additionalContactIds: data.getAll('additionalContactIds').map(String),
        source: value('source'),
        eventDate: businessDate,
        startsAt: startTime.kind === 'unique' ? startTime.instant : null,
        endsAt: endTime.kind === 'unique' ? endTime.instant : null,
        description: value('description'),
        notesHtml: value('notesHtml'),
        ...(editing ? { version: draft!.version } : {}),
      };
      const response = await fetch(
        editing ? '/api/v1/events/' + draft!.id : '/api/v1/events',
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.'
            : error.error === 'import_review_required'
              ? 'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.'
              : error.error === 'reservations_need_review'
                ? 'Für diesen Termin gibt es Reservierungen. Änderungen müssen gemeinsam geprüft werden.'
                : 'Speichern fehlgeschlagen. Termin, Zuordnungen und Anmeldung prüfen.',
        );
        return;
      }
      // The write is confirmed. Close the editor and report the save even if
      // the follow-up list request fails; never invite a second submission.
      setDraft(null);
      setEditing(false);
      // A create starts empty again; editing ends with the empty editor too.
      setEventStatus('inquiry');
      setEventDate('');
      setDateDerived(false);
      setPrimaryContactId('');
      setAdditionalContactIds([]);
      setVenue('');
      setVenueEdited(false);
      form.reset();
      saved = true;
      setMessage('Event gespeichert.');
      try {
        await refresh();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? 'Termin prüfen: Bitte gültige Uhrzeiten für Beginn und Ende angeben.'
          : 'Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
      if (saved) setTimeout(restoreEditorFocus, 0);
    }
  }
  function options(choices: Choice[], current: string | string[] | null) {
    return choices.map((choice) => (
      <option
        key={choice.id}
        value={choice.id}
        disabled={
          choice.state !== 'active' &&
          !(Array.isArray(current)
            ? current.includes(choice.id)
            : current === choice.id)
        }
      >
        {choice.name}
        {choice.state === 'active' ? '' : ' (Archiviert/Inaktiv)'}
      </option>
    ));
  }
  const zone = draft?.timeZone ?? timeZone;
  function localDate(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeZone: zone,
    }).format(new Date(value));
  }
  function localTime(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date(value));
  }
  const MonthHeading = showHeading ? 'h3' : 'h2';
  const showingDetail = rows.some((row) => row.id === detailId);
  // The undated sort is a view of the loaded list; dates and the other filters
  // already went to the server.
  const undatedOnly = filters.get('undated') === 'true',
    shown = undatedOnly ? rows.filter((row) => !row.eventDate) : rows,
    counts = eventFilterCounts(rows, urlSearch),
    activeCriteria = activeFilterCriteria(urlSearch),
    preset = activeDatePreset(urlSearch, now, timeZone),
    groups = monthGroups(shown);
  function applyPreset(id: PresetId) {
    const range = datePresetRange(id, now, timeZone);
    if (!range) return;
    updateUrlSearch({
      from: range.from,
      to: range.to,
      undated: '',
      q: filters.get('q') ?? '',
      status: filters.get('status') ?? '',
      eventTypeId: filters.get('eventTypeId') ?? '',
    });
  }
  function applySort(undated: boolean) {
    updateUrlSearch({
      q: filters.get('q') ?? '',
      status: filters.get('status') ?? '',
      eventTypeId: filters.get('eventTypeId') ?? '',
      from: undated ? '' : (filters.get('from') ?? ''),
      to: undated ? '' : (filters.get('to') ?? ''),
      undated: undated ? 'true' : '',
    });
  }
  // A modal sheet makes the list behind it inert, so it is opened only in the
  // narrow frame and closes again when the column returns.
  useEffect(() => {
    if (!filtersOpen || wide) return;
    const drawer = filterDrawer.current;
    if (!drawer) return;
    if (!drawer.open) drawer.showModal();
    filterSearch.current?.focus({ preventScroll: true });
  }, [filtersOpen, wide]);
  useEffect(() => {
    if (wide) setFiltersOpen(false);
  }, [wide]);
  function closeFilters() {
    filterDrawer.current?.close();
    setFiltersOpen(false);
    filterTrigger.current?.focus({ preventScroll: true });
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // The sort choice is its own control, so a submitted custom range is
    // always chronological.
    const values: Record<string, string> = { undated: '' };
    for (const key of ['q', 'status', 'eventTypeId', 'from', 'to'])
      values[key] = [data.get(key)].filter(Boolean).join('');
    updateUrlSearch(values);
    if (filterDrawer.current?.open) closeFilters();
  }
  // The same form in both frames: the applied state is the URL, so a discarded
  // draft, a preset and a completion all keep one meaning.
  function filterPanel(mobile: boolean) {
    return (
      <form
        className="event-filter-form"
        key={urlSearch + ':' + timeZone}
        onSubmit={applyFilters}
      >
        <fieldset disabled={busy || !timeZone}>
          <legend>Eventfilter</legend>
          <label>
            Events suchen
            <input
              ref={filterSearch}
              name="q"
              maxLength={200}
              defaultValue={filters.get('q') ?? ''}
            />
          </label>
          {/* A view is only offered when its route really exists; the timeline
              has no own target yet. */}
          <nav className="event-view-choice" aria-label="Ansicht">
            <a href="#events" aria-current="page">
              Liste
            </a>
            <a href="#calendar">Kalender</a>
          </nav>
          <fieldset className="event-sorting">
            <legend>Sortieren</legend>
            {[
              { undated: false, label: 'Chronologisch', count: null },
              { undated: true, label: 'Ohne Datum', count: counts.undated },
            ].map((choice) => {
              const selected = choice.undated === undatedOnly;
              return (
                <label
                  key={choice.label}
                  className={
                    selected ? 'sort-choice sort-choice-active' : 'sort-choice'
                  }
                >
                  <input
                    type="radio"
                    name="sort"
                    checked={selected}
                    onChange={() => applySort(choice.undated)}
                  />
                  {choice.label}
                  {choice.count === null ? null : (
                    <span className="event-count" data-testid="undated-count">
                      {choice.count}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
          {/* „Anfragen“ is the existing status filter, not a sort: it only
              sets `status` and keeps date range, search and event type. It
              belongs beside the sort choice but stays outside that group. */}
          {(() => {
            const selected = filters.get('status') === 'inquiry';
            return (
              <div
                className="event-quick-filters"
                role="group"
                aria-label="Schnellfilter"
              >
                <button
                  type="button"
                  className={
                    selected
                      ? 'secondary-action quick-filter quick-filter-active'
                      : 'secondary-action quick-filter'
                  }
                  aria-pressed={selected}
                  onClick={() =>
                    updateUrlSearch({
                      q: filters.get('q') ?? '',
                      status: selected ? '' : 'inquiry',
                      eventTypeId: filters.get('eventTypeId') ?? '',
                      from: filters.get('from') ?? '',
                      to: filters.get('to') ?? '',
                      undated: filters.get('undated') ?? '',
                    })
                  }
                >
                  Anfragen
                  <span className="event-count" data-testid="inquiry-count">
                    {counts.inquiries}
                  </span>
                </button>
              </div>
            );
          })()}
          <div className="date-presets" role="group" aria-label="Zeitraum">
            {(datePresets as { id: PresetId; label: string }[]).map(
              (choice) => {
                const selected = preset === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className={
                      selected
                        ? 'secondary-action date-preset date-preset-active'
                        : 'secondary-action date-preset'
                    }
                    aria-pressed={selected}
                    onClick={() => applyPreset(choice.id)}
                  >
                    {choice.label}
                  </button>
                );
              },
            )}
          </div>
          {/* H041: the presets cover the common cases; the exact bounds stay
              available inside „Eigener Zeitraum“. */}
          <details
            className="custom-range"
            open={!preset && Boolean(filters.get('from') || filters.get('to'))}
          >
            <summary>Eigener Zeitraum</summary>
            <label>
              Filter von
              <input
                name="from"
                type="date"
                defaultValue={filters.get('from') ?? ''}
              />
            </label>
            <label>
              Filter bis
              <input
                name="to"
                type="date"
                defaultValue={filters.get('to') ?? ''}
              />
            </label>
          </details>
          <label>
            Filterstatus
            <select name="status" defaultValue={filters.get('status') ?? ''}>
              <option value="">Alle Status</option>
              {statuses.map((status) => (
                <option key={status.code} value={status.code}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filtereventart
            <select
              name="eventTypeId"
              defaultValue={filters.get('eventTypeId') ?? ''}
            >
              <option value="">Alle Eventarten</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <div className="event-filter-actions">
            <button className="secondary-action">
              {mobile ? 'Ergebnisse anzeigen' : 'Events filtern'}
            </button>
            <button
              type="button"
              className="tertiary-action"
              onClick={() => updateUrlSearch(emptyEventFilters)}
            >
              Eventfilter zurücksetzen
            </button>
          </div>
        </fieldset>
        <p className="event-timezone">Zeitzone: {zone || 'Wird geladen'}</p>
      </form>
    );
  }
  return (
    <section id="events" aria-label="Events" aria-busy={loading}>
      <div className="section-heading" hidden={showingDetail}>
        {showHeading && <h2>Events</h2>}
        <div className="section-actions">
          <button
            ref={createTrigger}
            className="icon-action tier-primary-icon"
            aria-label="Event anlegen"
            title="Event anlegen"
            disabled={busy || editing || Boolean(draft)}
            onClick={() => openCreate()}
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
      <div className="event-layout">
        {wide ? (
          <aside
            className="event-context event-filters"
            aria-label="Eventfilter"
            hidden={showingDetail}
          >
            {filterPanel(false)}
          </aside>
        ) : (
          <>
            <div className="event-filter-access" hidden={showingDetail}>
              <button
                ref={filterTrigger}
                type="button"
                className="secondary-action event-filter-trigger"
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                aria-controls="event-filter-panel"
                aria-label={
                  activeCriteria
                    ? `Filter, ${activeCriteria} aktive Kriterien`
                    : 'Filter'
                }
                onClick={() => setFiltersOpen(true)}
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
                Filter
                <span className="event-count" data-testid="active-filter-count">
                  {activeCriteria}
                </span>
              </button>
              {activeCriteria > 0 && (
                <button
                  type="button"
                  className="tertiary-action"
                  onClick={() => updateUrlSearch(emptyEventFilters)}
                >
                  Zurücksetzen
                </button>
              )}
            </div>
            <dialog
              id="event-filter-panel"
              className="event-filter-drawer"
              aria-label="Eventfilter"
              ref={filterDrawer}
              onCancel={(event) => {
                event.preventDefault();
                closeFilters();
              }}
              onClose={() => {
                setFiltersOpen(false);
                filterTrigger.current?.focus({ preventScroll: true });
              }}
            >
              {filtersOpen && (
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
        <div className="event-results">
          {editing && draft && (
            <details className="event-editor" ref={editor}>
              <summary>Event bearbeiten</summary>
              <form
                id="event-editor"
                key={`${draft?.id ?? 'new'}:${draft?.version ?? 0}:${editing}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(event.currentTarget);
                }}
              >
                <fieldset disabled={busy || !timeZone}>
                  <legend>
                    {editing ? 'Event bearbeiten' : 'Neues Event'}
                  </legend>
                  <label>
                    Eventname
                    <input
                      name="name"
                      required
                      maxLength={200}
                      defaultValue={draft?.name ?? ''}
                    />
                  </label>
                  <label>
                    Eventstatus
                    <select
                      name="status"
                      value={eventStatus}
                      onChange={(event) =>
                        setEventStatus(event.currentTarget.value)
                      }
                    >
                      {statuses.map((option) => (
                        <option
                          key={option.code}
                          value={option.code}
                          disabled={
                            option.code === 'booked' &&
                            draft?.status !== 'booked'
                          }
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Gebucht wird mit einer konkreten Ressourcenzuweisung
                    verfügbar.
                  </p>
                  <label>
                    Hauptkontakt
                    <select
                      name="primaryContactId"
                      value={primaryContactId}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        setPrimaryContactId(next);
                        setAdditionalContactIds((current) =>
                          current.filter((id) => id !== next),
                        );
                      }}
                    >
                      <option value="">Noch offen</option>
                      {options(contacts, primaryContactId || null)}
                    </select>
                  </label>
                  <fieldset>
                    <legend>Termin</legend>
                    <label>
                      Eventdatum
                      <input
                        name="eventDate"
                        type="date"
                        value={eventDate}
                        readOnly={dateDerived}
                        aria-invalid={Boolean(scheduleErrors.eventDate)}
                        aria-describedby={
                          scheduleErrors.eventDate
                            ? 'event-date-help event-eventDate-error'
                            : 'event-date-help'
                        }
                        onChange={(event) => {
                          setEventDate(event.currentTarget.value);
                          clearScheduleError('eventDate');
                        }}
                      />
                    </label>
                    <p id="event-date-help">
                      {dateDerived
                        ? 'Wird aus dem Beginn übernommen. Um das Datum zu ändern, den Beginn ändern.'
                        : 'Ohne Uhrzeiten bleibt ein Datum oder ein undatiertes Event möglich. Mit Beginn wird das Datum aus dessen lokalem Starttag übernommen.'}
                    </p>
                    {scheduleErrors.eventDate && (
                      <p
                        className="field-error"
                        id="event-eventDate-error"
                        role="alert"
                      >
                        {scheduleErrors.eventDate}
                      </p>
                    )}
                    <EventTimeField
                      name="startsAt"
                      label="Eventbeginn"
                      timeZone={zone}
                      instant={draft?.startsAt ?? null}
                      error={scheduleErrors.startsAt}
                      onChange={(next) => {
                        setDateDerived(Boolean(next));
                        if (next) {
                          setEventDate(next.slice(0, 10));
                          clearScheduleError('eventDate');
                        }
                        clearScheduleError('startsAt');
                      }}
                    />
                    <EventTimeField
                      name="endsAt"
                      label="Eventende"
                      timeZone={zone}
                      instant={draft?.endsAt ?? null}
                      error={scheduleErrors.endsAt}
                      onChange={() => clearScheduleError('endsAt')}
                    />
                    <p>
                      Beginn und Ende gemeinsam oder gar nicht. Das Ende muss
                      nach dem Beginn liegen.
                    </p>
                  </fieldset>
                  <details className="event-advanced">
                    <summary>Weitere Angaben</summary>
                    <div className="event-advanced-fields">
                      <label>
                        Eventart
                        <select
                          name="eventTypeId"
                          defaultValue={draft?.eventTypeId ?? ''}
                        >
                          <option value="">Noch offen</option>
                          {options(types, draft?.eventTypeId ?? null)}
                        </select>
                      </label>
                      <label>
                        Fotobox-Paket
                        <select
                          name="packageId"
                          defaultValue={draft?.packageId ?? ''}
                        >
                          <option value="">Noch offen</option>
                          {options(packages, draft?.packageId ?? null)}
                        </select>
                      </label>
                      <label>
                        Ort / Adresse
                        <textarea
                          name="venue"
                          maxLength={venueMaxLength}
                          value={venue}
                          aria-describedby="event-venue-help"
                          onChange={(event) => {
                            setVenue(event.currentTarget.value);
                            setVenueEdited(true);
                          }}
                        />
                      </label>
                      <p id="event-venue-help">
                        Optional und frei eintragbar. Ein vorhandener
                        Bestandsort bleibt erhalten, solange das Feld
                        unverändert bleibt.
                      </p>
                      <label>
                        Anfragequelle
                        <input
                          name="source"
                          maxLength={200}
                          defaultValue={draft?.source ?? ''}
                        />
                      </label>
                      <label>
                        Weitere Kontakte
                        <select
                          name="additionalContactIds"
                          multiple
                          value={additionalContactIds}
                          onChange={(event) =>
                            setAdditionalContactIds(
                              Array.from(
                                event.currentTarget.selectedOptions,
                                (option) => option.value,
                              ),
                            )
                          }
                        >
                          {options(
                            contacts.filter(
                              (choice) => choice.id !== primaryContactId,
                            ),
                            additionalContactIds,
                          )}
                        </select>
                      </label>
                      <label>
                        Eventbeschreibung
                        <textarea
                          name="description"
                          maxLength={4000}
                          defaultValue={draft?.description ?? ''}
                        />
                      </label>
                      <label>
                        Interne Notizen
                        <textarea
                          name="notesHtml"
                          maxLength={20000}
                          defaultValue={draft?.notesHtml ?? ''}
                          aria-describedby="event-notes-help"
                        />
                      </label>
                      <p id="event-notes-help">
                        Einfache HTML-Formatierung:
                        &lt;strong&gt;fett&lt;/strong&gt;,
                        &lt;em&gt;kursiv&lt;/em&gt; und &lt;a
                        href="https://…"&gt;Link&lt;/a&gt;. Die gespeicherte
                        Vorschau erscheint am Event.
                      </p>
                    </div>
                  </details>
                  <button className="primary-action">Event speichern</button>
                  {editing && draft?.id && (
                    <a className="secondary-action" href={'#event-' + draft.id}>
                      Ressourcen zuweisen
                    </a>
                  )}
                  {draft && (
                    <button
                      type="button"
                      className="tertiary-action"
                      onClick={() => {
                        setDraft(null);
                        setEditing(false);
                        setVenue('');
                        setVenueEdited(false);
                        restoreEditorFocus();
                      }}
                    >
                      Event abbrechen
                    </button>
                  )}
                </fieldset>
              </form>
            </details>
          )}
          <p role="status">{message}</p>
          {reloadWarning && (
            <div className="reload-warning">
              <p role="alert">
                Gespeichert, aber die Liste konnte nicht neu geladen werden. Die
                Eingabe wurde nicht verloren.
              </p>
              <button
                type="button"
                className="tertiary-action"
                disabled={busy}
                onClick={() => {
                  setReloadWarning(false);
                  void refresh().catch(() => setReloadWarning(true));
                }}
              >
                Events erneut laden
              </button>
            </div>
          )}
          {loadFailed && !reloadWarning && (
            <div className="reload-warning">
              <p role="alert">
                Events konnten nicht geladen werden.{' '}
                {rows.length
                  ? 'Der zuletzt geladene Stand bleibt sichtbar.'
                  : 'Bitte erneut versuchen.'}
              </p>
              <button
                type="button"
                className="tertiary-action"
                disabled={busy || loading}
                onClick={() => void refresh().catch(() => {})}
              >
                Events erneut laden
              </button>
            </div>
          )}
          {loading && <p role="status">Events werden geladen …</p>}
          {!loading && !loadFailed && !shown.length && (
            <p>Keine Events gefunden.</p>
          )}
          {groups.map(({ month, entries }) => {
            const label = month
              ? new Intl.DateTimeFormat('de-DE', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(month + '-01T12:00:00Z'))
              : 'Ohne Datum';
            return (
              <section
                className="event-month"
                key={month}
                aria-label={label}
                hidden={
                  showingDetail && !entries.some((row) => row.id === detailId)
                }
              >
                <MonthHeading hidden={showingDetail}>
                  {label}{' '}
                  <span className="event-month-count">
                    {'\u00b7 '}
                    {entries.length} {entries.length === 1 ? 'Event' : 'Events'}
                  </span>
                </MonthHeading>
                <ul className="event-list">
                  {entries.map((row) => (
                    <li
                      key={row.id}
                      id={'event-' + row.id}
                      hidden={showingDetail && row.id !== detailId}
                    >
                      <div className="event-row" hidden={showingDetail}>
                        <div className="event-summary-block">
                          <a
                            className="event-summary"
                            href={'#event-' + row.id}
                            onClick={(event) => {
                              if (
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                              )
                                return;
                              if (window.getSelection?.()?.toString()) {
                                event.preventDefault();
                                return;
                              }
                              setDetailId(row.id);
                            }}
                          >
                            <span className="event-title">
                              {row.name} –{' '}
                              {/* H037: a date-only booking keeps its date without
                              an invented clock time; a real one shows it. */}
                              {listScheduleText(row, localDate, localTime)} –{' '}
                              {statuses.find((s) => s.code === row.status)
                                ?.label ?? row.status}
                            </span>
                            <span className="event-meta">
                              {types.find((type) => type.id === row.eventTypeId)
                                ?.name ?? 'Eventart offen'}{' '}
                              {
                                contacts.find(
                                  (c) => c.id === row.primaryContactId,
                                )?.name
                              }{' '}
                              <span className="event-venue-inline">
                                {shownVenue(
                                  row,
                                  locations.find(
                                    (l) => l.id === row.locationId,
                                  ),
                                )}
                              </span>
                              {/* A quiet origin label, not a status: the automatic
                              website option stays an ordinary event row. */}
                              {row.source.startsWith('Website:') && (
                                <span className="event-source-quiet">
                                  Website
                                </span>
                              )}
                            </span>
                          </a>
                          <p className="event-resource-hint">
                            Ressourcen in den Event-Details prüfen.
                          </p>
                        </div>
                        <div className="event-actions">
                          <button
                            type="button"
                            className="icon-action tier-quiet-icon"
                            disabled={busy || editing}
                            aria-label={`Event duplizieren: ${row.name}`}
                            title="Event duplizieren"
                            onClick={() => {
                              const active = (
                                choices: Choice[],
                                id: string | null,
                              ) =>
                                choices.some(
                                  (choice) =>
                                    choice.id === id &&
                                    choice.state === 'active',
                                )
                                  ? id
                                  : null;
                              const duplicatePrimary = active(
                                  contacts,
                                  row.primaryContactId,
                                ),
                                legacyPlace = locations.find(
                                  (choice) => choice.id === row.locationId,
                                ),
                                copyLegacy =
                                  legacyPlace?.state === 'active'
                                    ? row.locationId
                                    : null;
                              openCreate({
                                ...row,
                                name: row.name.slice(0, 192) + ' (Kopie)',
                                status: 'inquiry',
                                timeZone,
                                eventDate: row.startsAt
                                  ? localDateTime(row.startsAt, timeZone).slice(
                                      0,
                                      10,
                                    )
                                  : row.eventDate,
                                eventTypeId: active(types, row.eventTypeId),
                                packageId: active(packages, row.packageId),
                                locationId: copyLegacy,
                                // An archived legacy place cannot be referenced by
                                // a new booking; keep what the operator sees as text.
                                venue: row.venueOverride
                                  ? row.venue
                                  : !copyLegacy && legacyPlace
                                    ? legacyPlaceText(legacyPlace)
                                    : null,
                                venueOverride:
                                  row.venueOverride ||
                                  Boolean(!copyLegacy && legacyPlace),
                                primaryContactId: duplicatePrimary,
                                additionalContactIds:
                                  row.additionalContactIds.filter(
                                    (id) =>
                                      id !== duplicatePrimary &&
                                      active(contacts, id),
                                  ),
                              });
                            }}
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
                              <path d="M9 9h10v10H9zM5 15H3V3h12v2" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="icon-action tier-quiet-icon"
                            disabled={busy}
                            aria-label={`Event bearbeiten: ${row.name}`}
                            title="Event bearbeiten"
                            onClick={(event) => {
                              editReturnFocus.current = event.currentTarget;
                              setCreating(false);
                              setCreateInitial(null);
                              setVenue(
                                initialVenueText(
                                  row,
                                  locations.find(
                                    (choice) => choice.id === row.locationId,
                                  ),
                                ),
                              );
                              setVenueEdited(false);
                              setDraft(row);
                              setEditing(true);
                            }}
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
                        </div>
                      </div>
                      {detailId === row.id && (
                        <EventDetails
                          key={row.id}
                          revision={row.version}
                          id={row.id}
                          csrfToken={csrfToken}
                          statuses={statuses}
                          onChanged={async (
                            message = 'Eventstatus gespeichert.',
                          ) => {
                            setMessage(message);
                            try {
                              await refresh();
                            } catch {
                              setReloadWarning(true);
                            }
                          }}
                          onEdit={(event) => {
                            setCreating(false);
                            setCreateInitial(null);
                            setVenue(
                              initialVenueText(
                                event,
                                locations.find(
                                  (choice) => choice.id === event.locationId,
                                ),
                              ),
                            );
                            setVenueEdited(false);
                            setDraft(event);
                            setEditing(true);
                            setDetailId(null);
                            window.history.replaceState(null, '', '#events');
                          }}
                          onClose={() => {
                            setDetailId(null);
                            window.location.hash = 'events';
                            requestAnimationFrame(() =>
                              document
                                .getElementById('event-' + row.id)
                                ?.querySelector<HTMLAnchorElement>(
                                  '.event-summary',
                                )
                                ?.focus(),
                            );
                          }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {creating && (
        <EventCreateDialog
          key={
            createInitial
              ? `copy:${createInitial.id}:${createInitial.version}`
              : 'new'
          }
          csrfToken={csrfToken}
          timeZone={timeZone}
          statuses={statuses}
          types={types}
          packages={packages}
          locations={locations}
          contacts={contacts}
          initial={createInitial}
          onClose={closeCreate}
          onCreated={created}
        />
      )}
    </section>
  );
}
