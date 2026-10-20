import { WebsiteInquiry } from './WebsiteInquiry.js';
import { ResourceAssignments } from './ResourceAssignments.js';
import { EventDocuments } from './EventDocuments.js';
import { useEffect, useRef, useState } from 'react';
import type { EventRow } from './EventPanel.js';
type Detail = {
  event: EventRow;
  websiteInquiryAvailable?: boolean;
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
  revision = 0,
  csrfToken,
  statuses,
  onChanged,
  onEdit,
  onClose,
}: {
  id: string;
  revision?: number;
  csrfToken: string;
  statuses: { code: string; label: string }[];
  onChanged: (message?: string) => Promise<void>;
  onEdit: (event: EventRow) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState('overview');
  const heading = useRef<HTMLHeadingElement>(null),
    loadSequence = useRef(0),
    saving = useRef(false);
  const [data, setData] = useState<Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [reloadWarning, setReloadWarning] = useState(false);
  async function load() {
    const current = ++loadSequence.current;
    setLoading(true);
    try {
      const response = await fetch('/api/v1/events/' + id);
      if (!response.ok) throw Error('load');
      const next = (await response.json()) as Detail;
      // A slower, older request must never overwrite a newer event state.
      if (current !== loadSequence.current) return;
      setData(next);
      setReloadWarning(false);
    } catch (error) {
      if (current === loadSequence.current) throw error;
    } finally {
      if (current === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load().catch(() =>
      setMessage('Eventakte konnte nicht geladen werden.'),
    );
  }, [id, revision]);
  useEffect(() => {
    if (data) {
      heading.current?.scrollIntoView?.();
      heading.current?.focus({ preventScroll: true });
    }
  }, [data?.event.id]);
  async function saveStatus(form: HTMLFormElement) {
    if (saving.current) return;
    saving.current = true;
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
            : error.error === 'import_review_required'
              ? 'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.'
              : 'Status konnte nicht gespeichert werden. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      // The PUT is confirmed; report it before reloading so a failing GET is
      // never mistaken for a failed save.
      setMessage('Status gespeichert.');
      try {
        await load();
        await onChanged();
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage(
        'Verbindung fehlgeschlagen. Aktuellen Stand vor einem erneuten Versuch laden.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function retryLoad() {
    setReloadWarning(false);
    void (async () => {
      try {
        await load();
        await onChanged();
      } catch {
        setReloadWarning(true);
      }
    })();
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
    <section
      className="event-record"
      aria-label="Eventakte"
      aria-busy={loading}
    >
      <button className="secondary-action" type="button" onClick={onClose}>
        Eventakte schließen
      </button>
      <button
        className="secondary-action"
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
      {reloadWarning && (
        <p role="alert">
          Gespeichert, aber die Eventakte konnte nicht neu geladen werden. Es
          wurde nichts doppelt angelegt.{' '}
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={retryLoad}
          >
            Eventakte erneut laden
          </button>
        </p>
      )}
      {loading && <p>Eventakte wird geladen …</p>}
      {data && (
        <>
          <h2 ref={heading} tabIndex={-1}>
            Eventakte: {data.event.name}
          </h2>
          <nav
            className="record-navigation"
            aria-label="Bereiche der Eventakte"
          >
            {[
              ['overview', 'Übersicht'],
              ['resources', 'Ressourcen'],
              ['notes', 'Notizen'],
              ['activity', 'Logbuch'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-current={section === value ? 'location' : undefined}
                onClick={() => {
                  setSection(value!);
                  heading.current?.scrollIntoView?.();
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div hidden={section !== 'overview'}>
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
            <button
              disabled={busy || loading}
              onClick={() => onEdit(data.event)}
            >
              Stammdaten bearbeiten
            </button>
            <EventDocuments
              key={data.event.id}
              eventId={data.event.id}
              contactId={data.event.primaryContactId}
              timeZone={data.event.timeZone}
              csrfToken={csrfToken}
            />
          </div>
          <div hidden={section !== 'resources'}>
            <ResourceAssignments
              key={data.event.id + ':' + data.event.version}
              event={data.event}
              csrfToken={csrfToken}
              onChanged={async () => {
                await load();
                await onChanged('Ressourcen und Termin gespeichert.');
              }}
            />
          </div>
          <div hidden={section !== 'overview'}>
            {data.websiteInquiryAvailable && (
              <WebsiteInquiry
                key={id}
                eventId={id}
                timeZone={data.event.timeZone}
              />
            )}
            <h3>Kontakte</h3>
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
            <h3>Location</h3>
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
          </div>
          <div hidden={section !== 'notes'}>
            <h3>Interne Notizen</h3>
            <div
              aria-label={'Notizen: ' + data.event.name}
              dangerouslySetInnerHTML={{ __html: data.event.notesHtml }}
            />
          </div>
          <div hidden={section !== 'activity'}>
            <h3>Logbuch</h3>
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
          </div>
        </>
      )}
    </section>
  );
}
