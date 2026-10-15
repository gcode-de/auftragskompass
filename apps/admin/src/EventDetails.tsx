import { useEffect, useState } from 'react';
import type { EventRow } from './EventPanel.js';
type Detail = {
  event: EventRow;
  contacts: {
    id: string;
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    mobile: string;
    role: string;
  }[];
  location: {
    id: string;
    name: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
  } | null;
  eventType: { id: string; name: string } | null;
  package: { id: string; name: string } | null;
  activities: {
    id: string;
    kind: string;
    eventVersion: number | null;
    occurredAt: string;
    description: string;
  }[];
};
export function EventDetails({
  id,
  csrfToken,
  statuses,
  onChanged,
  onEdit,
  onClose,
}: {
  id: string;
  csrfToken: string;
  statuses: { code: string; label: string }[];
  onChanged: () => Promise<void>;
  onEdit: (event: EventRow) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/events/' + id);
      if (!response.ok) throw Error('load');
      setData((await response.json()) as Detail);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load().catch(() =>
      setMessage('Eventakte konnte nicht geladen werden.'),
    );
  }, [id]);
  async function saveStatus(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const status = String(new FormData(form).get('status'));
      const response = await fetch('/api/v1/events/' + id, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ ...data!.event, status }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Eventakte aktualisieren und erneut prüfen.'
            : 'Status konnte nicht gespeichert werden. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      await load();
      await onChanged();
      setMessage('Status gespeichert.');
    } catch {
      setMessage(
        'Verbindung fehlgeschlagen. Aktuellen Stand vor einem erneuten Versuch laden.',
      );
    } finally {
      setBusy(false);
    }
  }
  function time(value: string | null) {
    return value
      ? new Intl.DateTimeFormat('de-DE', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: data!.event.timeZone,
        }).format(new Date(value))
      : 'Noch offen';
  }
  return (
    <section aria-label="Eventakte" aria-busy={loading}>
      <button type="button" onClick={onClose}>
        Eventakte schließen
      </button>
      <button
        type="button"
        disabled={busy || loading}
        onClick={() =>
          void load().catch(() =>
            setMessage('Eventakte konnte nicht geladen werden.'),
          )
        }
      >
        Eventakte aktualisieren
      </button>
      <p role="status">{message}</p>
      {loading && <p>Eventakte wird geladen …</p>}
      {data && (
        <>
          <h3>Eventakte: {data.event.name}</h3>
          <dl>
            <dt>Datum</dt>
            <dd>
              {data.event.eventDate
                ? data.event.eventDate.split('-').reverse().join('.')
                : 'Ohne Datum'}
            </dd>
            <dt>Beginn</dt>
            <dd>{time(data.event.startsAt)}</dd>
            <dt>Ende</dt>
            <dd>{time(data.event.endsAt)}</dd>
            <dt>Zeitzone</dt>
            <dd>{data.event.timeZone}</dd>
            <dt>Eventart</dt>
            <dd>{data.eventType?.name ?? 'Noch offen'}</dd>
            <dt>Fotobox-Paket</dt>
            <dd>{data.package?.name ?? 'Noch offen'}</dd>
            <dt>Anfragequelle</dt>
            <dd>{data.event.source || 'Noch offen'}</dd>
            <dt>Beschreibung</dt>
            <dd>{data.event.description || 'Keine Beschreibung'}</dd>
          </dl>
          <form
            key={data.event.version}
            onSubmit={(event) => {
              event.preventDefault();
              void saveStatus(event.currentTarget);
            }}
          >
            <fieldset disabled={busy || loading}>
              <legend>Status ändern</legend>
              <label>
                Status in der Eventakte
                <select name="status" defaultValue={data.event.status}>
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
              <button>Status speichern</button>
            </fieldset>
          </form>
          <button disabled={busy || loading} onClick={() => onEdit(data.event)}>
            Stammdaten bearbeiten
          </button>
          <h4>Kontakte</h4>
          {!data.contacts.length && <p>Noch keine Kontakte zugeordnet.</p>}
          <ul>
            {data.contacts.map((person) => (
              <li key={person.id}>
                {person.role === 'primary'
                  ? 'Hauptkontakt'
                  : 'Weiterer Kontakt'}
                : {person.name} {person.contactPerson}{' '}
                {person.email && (
                  <a href={'mailto:' + encodeURIComponent(person.email)}>
                    {person.email}
                  </a>
                )}{' '}
                {[person.phone, person.mobile]
                  .filter(Boolean)
                  .map((number, index) => (
                    <a
                      key={index}
                      href={'tel:' + number.replace(/[^+0-9]/g, '')}
                    >
                      {number}{' '}
                    </a>
                  ))}
              </li>
            ))}
          </ul>
          <h4>Location</h4>
          {data.location ? (
            <>
              <p>{data.location.name}</p>
              <p>
                {[
                  data.location.street,
                  data.location.postalCode,
                  data.location.city,
                  data.location.country,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </>
          ) : (
            <p>Noch kein Veranstaltungsort zugeordnet.</p>
          )}
          <h4>Interne Notizen</h4>
          <div
            aria-label={'Notizen: ' + data.event.name}
            dangerouslySetInnerHTML={{ __html: data.event.notesHtml }}
          />
          <h4>Logbuch</h4>
          {!data.activities.length && <p>Noch keine Aktivitäten.</p>}
          <ol>
            {data.activities.map((activity) => (
              <li key={activity.id}>
                <time dateTime={activity.occurredAt}>
                  {time(activity.occurredAt)}
                </time>{' '}
                {activity.description}
                {activity.eventVersion === null
                  ? ' (Historischer Eintrag; frühere Details unbekannt)'
                  : ''}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
