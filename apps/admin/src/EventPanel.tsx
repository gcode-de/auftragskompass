import { EventDetails } from './EventDetails.js';
import {
  useUrlSearch,
  updateUrlSearch,
  eventQuery,
  emptyEventFilters,
} from './url-state.js';
import { useEffect, useState, useRef } from 'react';
import { toInstant, fromInstant } from './event-time.js';
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
    editor = useRef<HTMLDetailsElement>(null);
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
    [loadFailed, setLoadFailed] = useState(false);
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
      if (
        id.startsWith('event-') &&
        rows.some((row) => 'event-' + row.id === id)
      ) {
        setDetailId(id.slice(6));
        document.getElementById(id)?.scrollIntoView();
      }
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [rows]);
  useEffect(() => {
    if (draft) {
      editor.current!.open = true;
      document.getElementById('event-editor')?.scrollIntoView?.();
      document
        .querySelector<HTMLInputElement>('#event-editor input[name="name"]')
        ?.focus({ preventScroll: true });
    }
  }, [draft]);
  function closeEditor() {
    if (editor.current) {
      editor.current.open = false;
      editor.current.querySelector('summary')?.focus({ preventScroll: true });
    }
  }
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData(form),
        value = (key: string) => String(data.get(key) ?? ''),
        zone = draft?.timeZone ?? timeZone;
      const input = {
        name: value('name'),
        status: value('status'),
        eventTypeId: value('eventTypeId') || null,
        packageId: value('packageId') || null,
        locationId: value('locationId') || null,
        primaryContactId: value('primaryContactId') || null,
        additionalContactIds: data.getAll('additionalContactIds').map(String),
        source: value('source'),
        eventDate: value('eventDate') || null,
        startsAt: toInstant(value('startsAt'), zone, value('startOffset')),
        endsAt: toInstant(value('endsAt'), zone, value('endOffset')),
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
      await refresh();
      setDraft(null);
      setEditing(false);
      form.reset();
      closeEditor();
      setMessage('Event gespeichert.');
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? 'Termin prüfen: Uhrzeit muss existieren; bei doppelten Uhrzeiten den UTC-Versatz angeben.'
          : 'Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.',
      );
    } finally {
      setBusy(false);
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
  const zone = draft?.timeZone ?? timeZone,
    start = fromInstant(draft?.startsAt ?? null, zone),
    end = fromInstant(draft?.endsAt ?? null, zone);
  const groups = new Map<string, EventRow[]>();
  for (const row of rows) {
    const month = row.eventDate?.slice(0, 7) ?? '';
    const group = groups.get(month);
    if (group) group.push(row);
    else groups.set(month, [row]);
  }
  return (
    <section id="events" aria-label="Events" aria-busy={loading}>
      <div className="section-heading">
        <h2>Events</h2>
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
      </div>
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

      <details className="event-editor" ref={editor}>
        <summary>{editing ? 'Event bearbeiten' : 'Event anlegen'}</summary>
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
              <select name="status" defaultValue={draft?.status ?? 'inquiry'}>
                {statuses.map((status) => (
                  <option
                    key={status.code}
                    value={status.code}
                    disabled={status.code === 'booked'}
                  >
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Gebucht wird mit einer konkreten Ressourcenzuweisung verfügbar.
            </p>
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
              <select name="packageId" defaultValue={draft?.packageId ?? ''}>
                <option value="">Noch offen</option>
                {options(packages, draft?.packageId ?? null)}
              </select>
            </label>
            <label>
              Veranstaltungsort
              <select name="locationId" defaultValue={draft?.locationId ?? ''}>
                <option value="">Noch offen</option>
                {options(locations, draft?.locationId ?? null)}
              </select>
            </label>
            <label>
              Hauptkontakt
              <select
                name="primaryContactId"
                defaultValue={draft?.primaryContactId ?? ''}
              >
                <option value="">Noch offen</option>
                {options(contacts, draft?.primaryContactId ?? null)}
              </select>
            </label>
            <label>
              Weitere Kontakte
              <select
                name="additionalContactIds"
                multiple
                defaultValue={draft?.additionalContactIds ?? []}
              >
                {options(contacts, draft?.additionalContactIds ?? [])}
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
              Eventdatum
              <input
                name="eventDate"
                type="date"
                defaultValue={draft?.eventDate ?? ''}
              />
            </label>
            <label>
              Eventbeginn
              <input
                name="startsAt"
                type="datetime-local"
                step="0.001"
                onChange={(event) => {
                  (
                    event.currentTarget.form!.elements.namedItem(
                      event.currentTarget.name === 'startsAt'
                        ? 'startOffset'
                        : 'endOffset',
                    ) as HTMLInputElement
                  ).value = '';
                }}
                defaultValue={start.value}
              />
            </label>
            <label>
              UTC-Versatz Beginn
              <input
                name="startOffset"
                placeholder="Automatisch, z. B. +02:00 bei Zeitumstellung"
                defaultValue={start.offset}
              />
            </label>
            <label>
              Eventende
              <input
                name="endsAt"
                type="datetime-local"
                step="0.001"
                onChange={(event) => {
                  (
                    event.currentTarget.form!.elements.namedItem(
                      event.currentTarget.name === 'startsAt'
                        ? 'startOffset'
                        : 'endOffset',
                    ) as HTMLInputElement
                  ).value = '';
                }}
                defaultValue={end.value}
              />
            </label>
            <label>
              UTC-Versatz Ende
              <input
                name="endOffset"
                placeholder="Automatisch, z. B. +01:00 bei Zeitumstellung"
                defaultValue={end.offset}
              />
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
              Einfache HTML-Formatierung: &lt;strong&gt;fett&lt;/strong&gt;,
              &lt;em&gt;kursiv&lt;/em&gt; und &lt;a
              href="https://…"&gt;Link&lt;/a&gt;. Die gespeicherte Vorschau
              erscheint am Event.
            </p>
            <button>Event speichern</button>
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setEditing(false);
                  closeEditor();
                }}
              >
                Event abbrechen
              </button>
            )}
          </fieldset>
        </form>
      </details>
      <p role="status">{message}</p>
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
          <section className="event-month" key={month} aria-label={label}>
            <h3>
              {label}{' '}
              <span>
                {entries.length} {entries.length === 1 ? 'Event' : 'Events'}
              </span>
            </h3>
            <ul className="event-list">
              {entries.map((row) => (
                <li key={row.id} id={'event-' + row.id}>
                  <span>
                    {row.name} –{' '}
                    {row.eventDate
                      ? row.eventDate.split('-').reverse().join('.')
                      : 'Ohne Datum'}{' '}
                    –{' '}
                    {statuses.find((s) => s.code === row.status)?.label ??
                      row.status}
                  </span>{' '}
                  <span>
                    {types.find((type) => type.id === row.eventTypeId)?.name ??
                      'Eventart offen'}{' '}
                    {contacts.find((c) => c.id === row.primaryContactId)?.name}{' '}
                    {locations.find((l) => l.id === row.locationId)?.name}
                  </span>
                  <p className="event-resource-hint">
                    Ressourcen in der Eventakte prüfen.
                  </p>
                  <button
                    aria-label={`Eventakte öffnen: ${row.name}`}
                    aria-expanded={detailId === row.id}
                    onClick={() => {
                      setDetailId(row.id);
                      window.history.replaceState(null, '', '#event-' + row.id);
                    }}
                  >
                    Eventakte öffnen
                  </button>
                  {detailId === row.id && (
                    <EventDetails
                      key={`${row.id}:${row.version}`}
                      id={row.id}
                      csrfToken={csrfToken}
                      statuses={statuses}
                      onChanged={async (
                        message = 'Eventstatus gespeichert.',
                      ) => {
                        await refresh();
                        setMessage(message);
                      }}
                      onEdit={(event) => {
                        setDraft(event);
                        setEditing(true);
                      }}
                      onClose={() => {
                        setDetailId(null);
                        window.history.replaceState(null, '', '#events');
                      }}
                    />
                  )}
                  <button
                    disabled={busy}
                    aria-label={`Event duplizieren: ${row.name}`}
                    onClick={() => {
                      const active = (choices: Choice[], id: string | null) =>
                        choices.some(
                          (choice) =>
                            choice.id === id && choice.state === 'active',
                        )
                          ? id
                          : null;
                      setEditing(false);
                      setDraft({
                        ...row,
                        name: row.name.slice(0, 192) + ' (Kopie)',
                        status: 'inquiry',
                        timeZone,
                        eventDate: row.startsAt
                          ? fromInstant(row.startsAt, timeZone).value.slice(
                              0,
                              10,
                            )
                          : row.eventDate,
                        eventTypeId: active(types, row.eventTypeId),
                        packageId: active(packages, row.packageId),
                        locationId: active(locations, row.locationId),
                        primaryContactId: active(
                          contacts,
                          row.primaryContactId,
                        ),
                        additionalContactIds: row.additionalContactIds.filter(
                          (id) => active(contacts, id),
                        ),
                      });
                    }}
                  >
                    Duplizieren
                  </button>
                  <button
                    disabled={busy}
                    aria-label={`Event bearbeiten: ${row.name}`}
                    onClick={() => {
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
    </section>
  );
}
