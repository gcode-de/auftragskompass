import { useEffect, useState } from 'react';
import { toInstant, fromInstant } from './event-time.js';
type Choice = { id: string; name: string; state: string };
type EventRow = {
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
export function EventPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<EventRow[]>([]),
    [draft, setDraft] = useState<EventRow | null>(null),
    [editing, setEditing] = useState(false),
    [timeZone, setTimeZone] = useState(''),
    [types, setTypes] = useState<Choice[]>([]),
    [packages, setPackages] = useState<Choice[]>([]),
    [locations, setLocations] = useState<Choice[]>([]),
    [contacts, setContacts] = useState<Choice[]>([]),
    [statuses, setStatuses] = useState<Status[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const responses = await Promise.all(
      [
        '/events',
        '/statuses',
        '/master-data/event_type',
        '/master-data/package',
        '/locations',
        '/contacts',
      ].map((path) => fetch('/api/v1' + path)),
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
    setRows(events.events);
    setTimeZone(events.timeZone);
    setStatuses(statuses);
    setTypes(types);
    setPackages(packages);
    setLocations(locations);
    setContacts(contacts);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Events konnten nicht geladen werden.'),
    );
  }, []);
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
            : 'Speichern fehlgeschlagen. Termin, Zuordnungen und Anmeldung prüfen.',
        );
        return;
      }
      await refresh();
      setDraft(null);
      setEditing(false);
      form.reset();
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
  return (
    <section aria-label="Events">
      <h2>Events</h2>
      <p>Zeitzone: {zone || 'Wird geladen'}</p>
      <button
        disabled={busy}
        onClick={() =>
          void refresh().catch(() =>
            setMessage('Events konnten nicht geladen werden.'),
          )
        }
      >
        Events aktualisieren
      </button>
      <form
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
          <p>Gebucht wird mit einer konkreten Ressourcenzuweisung verfügbar.</p>
          <label>
            Eventart
            <select name="eventTypeId" defaultValue={draft?.eventTypeId ?? ''}>
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
              }}
            >
              Event abbrechen
            </button>
          )}
        </fieldset>
      </form>
      <p role="status">{message}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id} id={'event-' + row.id}>
            <span>
              {row.name} – {row.eventDate ?? 'Ohne Datum'} –{' '}
              {statuses.find((s) => s.code === row.status)?.label ?? row.status}
            </span>{' '}
            <span>
              {contacts.find((c) => c.id === row.primaryContactId)?.name}{' '}
              {locations.find((l) => l.id === row.locationId)?.name}
            </span>
            <div
              aria-label={`Notizen: ${row.name}`}
              dangerouslySetInnerHTML={{ __html: row.notesHtml }}
            />
            <button
              disabled={busy}
              aria-label={`Event duplizieren: ${row.name}`}
              onClick={() => {
                const active = (choices: Choice[], id: string | null) =>
                  choices.some(
                    (choice) => choice.id === id && choice.state === 'active',
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
                    ? fromInstant(row.startsAt, timeZone).value.slice(0, 10)
                    : row.eventDate,
                  eventTypeId: active(types, row.eventTypeId),
                  packageId: active(packages, row.packageId),
                  locationId: active(locations, row.locationId),
                  primaryContactId: active(contacts, row.primaryContactId),
                  additionalContactIds: row.additionalContactIds.filter((id) =>
                    active(contacts, id),
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
}
