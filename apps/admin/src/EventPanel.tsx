import { WebsiteInbox } from './WebsiteInbox.js';
import { EventDetails } from './EventDetails.js';
import {
  useUrlSearch,
  updateUrlSearch,
  eventQuery,
  emptyEventFilters,
} from './url-state.js';
import { useEffect, useState, useRef } from 'react';
import { localDateTime, resolveEventTime } from './event-time.js';
import { EventTimeField } from './EventTimeField.js';
import { EventCreateDialog } from './EventCreateDialog.js';
type Choice = { id: string; name: string; state: string };
export type EventRow = {
  id: string;
  version: number;
  name: string;
  status: string;
  eventTypeId: string | null;
  packageId: string | null;
  locationId: string | null;
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
export function EventPanel({
  csrfToken,
  revision = 0,
}: {
  csrfToken: string;
  revision?: number;
}) {
  const urlSearch = useUrlSearch(),
    filters = new URLSearchParams(urlSearch),
    sequence = useRef(0),
    saving = useRef(false),
    editor = useRef<HTMLDetailsElement>(null),
    createTrigger = useRef<HTMLButtonElement>(null),
    createReturnFocus = useRef<HTMLElement | null>(null),
    editReturnFocus = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<EventRow[]>([]),
    [draft, setDraft] = useState<EventRow | null>(null),
    [editing, setEditing] = useState(false),
    [detailId, setDetailId] = useState<string | null>(null),
    [timeZone, setTimeZone] = useState(''),
    [types, setTypes] = useState<Choice[]>([]),
    [packages, setPackages] = useState<Choice[]>([]),
    [locations, setLocations] = useState<Choice[]>([]),
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
    void refresh().catch(() =>
      setMessage('Events konnten nicht geladen werden.'),
    );
  }, [urlSearch, revision]);
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
        locationId: value('locationId') || null,
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
            ? 'Inzwischen geändert. Events aktualisieren und erneut bearbeiten.'
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
  const showingDetail = rows.some((row) => row.id === detailId);
  const groups = new Map<string, EventRow[]>();
  for (const row of rows) {
    const month = row.eventDate?.slice(0, 7) ?? '';
    const group = groups.get(month);
    if (group) group.push(row);
    else groups.set(month, [row]);
  }
  return (
    <section id="events" aria-label="Events" aria-busy={loading}>
      <div hidden={showingDetail}>
        <div className="section-heading">
          <h2>Events</h2>
          <div className="section-actions">
            <button
              className="secondary-action"
              disabled={busy}
              onClick={() =>
                void refresh().catch(() =>
                  setMessage('Events konnten nicht geladen werden.'),
                )
              }
            >
              Events aktualisieren
            </button>
            <button
              ref={createTrigger}
              disabled={busy || editing || Boolean(draft)}
              onClick={() => openCreate()}
            >
              Event anlegen
            </button>
          </div>
        </div>
        <WebsiteInbox
          csrfToken={csrfToken}
          timeZone={timeZone || 'Europe/Berlin'}
          onImported={refresh}
        />
        <details
          className="event-filters"
          open={Object.keys(emptyEventFilters).some((key) => filters.get(key))}
        >
          <summary>
            Filter
            {Object.keys(emptyEventFilters).some((key) => filters.get(key))
              ? ' · aktiv'
              : ''}
          </summary>
          <form
            key={urlSearch + ':' + timeZone}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget),
                undated = data.get('undated') === 'on';
              updateUrlSearch({
                q: String(data.get('q') ?? ''),
                status: String(data.get('status') ?? ''),
                eventTypeId: String(data.get('eventTypeId') ?? ''),
                from: undated ? '' : String(data.get('from') ?? ''),
                to: undated ? '' : String(data.get('to') ?? ''),
                undated: undated ? 'true' : '',
              });
            }}
          >
            <fieldset disabled={busy || !timeZone}>
              <legend>Eventfilter</legend>
              <label>
                Events suchen
                <input
                  name="q"
                  maxLength={200}
                  defaultValue={filters.get('q') ?? ''}
                />
              </label>
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
              <label>
                Filterstatus
                <select
                  name="status"
                  defaultValue={filters.get('status') ?? ''}
                >
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
              <label>
                Nur Events ohne Datum
                <input
                  name="undated"
                  type="checkbox"
                  defaultChecked={filters.get('undated') === 'true'}
                />
              </label>
              <p>Ohne Datum setzt die Datumsgrenzen zurück.</p>
              <button>Events filtern</button>
              <button
                type="button"
                onClick={() => updateUrlSearch(emptyEventFilters)}
              >
                Eventfilter zurücksetzen
              </button>
            </fieldset>
          </form>
          <p className="event-timezone">Zeitzone: {zone || 'Wird geladen'}</p>
        </details>

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
                <legend>{editing ? 'Event bearbeiten' : 'Neues Event'}</legend>
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
                          option.code === 'booked' && draft?.status !== 'booked'
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
                    Beginn und Ende gemeinsam oder gar nicht. Das Ende muss nach
                    dem Beginn liegen.
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
                      Veranstaltungsort
                      <select
                        name="locationId"
                        defaultValue={draft?.locationId ?? ''}
                      >
                        <option value="">Noch offen</option>
                        {options(locations, draft?.locationId ?? null)}
                      </select>
                    </label>
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
                <button>Event speichern</button>
                {editing && draft?.id && (
                  <a className="secondary-action" href={'#event-' + draft.id}>
                    Ressourcen zuweisen
                  </a>
                )}
                {draft && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setEditing(false);
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
      </div>
      <p role="status">{message}</p>
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Gespeichert, aber die Liste konnte nicht neu geladen werden. Die
            Eingabe wurde nicht verloren.
          </p>
          <button
            type="button"
            className="secondary-action"
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
      {loading && <p role="status">Events werden geladen …</p>}
      {!loading && !loadFailed && !rows.length && <p>Keine Events gefunden.</p>}
      {[...groups].map(([month, entries]) => {
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
            <h3 hidden={showingDetail}>
              {label}{' '}
              <span>
                {entries.length} {entries.length === 1 ? 'Event' : 'Events'}
              </span>
            </h3>
            <ul className="event-list">
              {entries.map((row) => (
                <li
                  key={row.id}
                  id={'event-' + row.id}
                  hidden={showingDetail && row.id !== detailId}
                >
                  <span hidden={showingDetail}>
                    {row.name} –{' '}
                    {row.eventDate
                      ? row.eventDate.split('-').reverse().join('.')
                      : 'Ohne Datum'}{' '}
                    –{' '}
                    {statuses.find((s) => s.code === row.status)?.label ??
                      row.status}
                  </span>{' '}
                  <span hidden={showingDetail}>
                    {types.find((type) => type.id === row.eventTypeId)?.name ??
                      'Eventart offen'}{' '}
                    {contacts.find((c) => c.id === row.primaryContactId)?.name}{' '}
                    {locations.find((l) => l.id === row.locationId)?.name}
                  </span>
                  <p className="event-resource-hint" hidden={showingDetail}>
                    Ressourcen in der Eventakte prüfen.
                  </p>
                  <button
                    hidden={showingDetail}
                    aria-label={`Eventakte öffnen: ${row.name}`}
                    aria-expanded={detailId === row.id}
                    onClick={() => {
                      setDetailId(row.id);
                      window.location.hash = 'event-' + row.id;
                    }}
                  >
                    Eventakte öffnen
                  </button>
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
                            ?.querySelector<HTMLButtonElement>('button')
                            ?.focus(),
                        );
                      }}
                    />
                  )}
                  <button
                    disabled={busy || editing}
                    hidden={showingDetail}
                    aria-label={`Event duplizieren: ${row.name}`}
                    onClick={() => {
                      const active = (choices: Choice[], id: string | null) =>
                        choices.some(
                          (choice) =>
                            choice.id === id && choice.state === 'active',
                        )
                          ? id
                          : null;
                      const duplicatePrimary = active(
                        contacts,
                        row.primaryContactId,
                      );
                      openCreate({
                        ...row,
                        name: row.name.slice(0, 192) + ' (Kopie)',
                        status: 'inquiry',
                        timeZone,
                        eventDate: row.startsAt
                          ? localDateTime(row.startsAt, timeZone).slice(0, 10)
                          : row.eventDate,
                        eventTypeId: active(types, row.eventTypeId),
                        packageId: active(packages, row.packageId),
                        locationId: active(locations, row.locationId),
                        primaryContactId: duplicatePrimary,
                        additionalContactIds: row.additionalContactIds.filter(
                          (id) =>
                            id !== duplicatePrimary && active(contacts, id),
                        ),
                      });
                    }}
                  >
                    Duplizieren
                  </button>
                  <button
                    disabled={busy}
                    hidden={showingDetail}
                    aria-label={`Event bearbeiten: ${row.name}`}
                    onClick={(event) => {
                      editReturnFocus.current = event.currentTarget;
                      setCreating(false);
                      setCreateInitial(null);
                      setDraft(row);
                      setEditing(true);
                    }}
                  >
                    Bearbeiten
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
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
