import { WebsiteInquiry } from './WebsiteInquiry.js';
import { ResourceAssignments } from './ResourceAssignments.js';
import { EventDocuments } from './EventDocuments.js';
import { useAutoRefresh } from './auto-refresh.js';
import { registerUnsavedChanges } from './unsaved-changes.js';
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
    saving = useRef(false),
    // A reload replaces the form values. Both refs mark unsaved input so a
    // retry can never discard it silently.
    dirty = useRef(false),
    resourcesDirty = useRef(false),
    loadedVersion = useRef<number | null>(null),
    loadedId = useRef<string | null>(null),
    attemptedRevision = useRef<number | null>(null);
  const [epoch, setEpoch] = useState(0),
    [data, setData] = useState<Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [refreshDeferred, setRefreshDeferred] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false);
  function mayReplaceDraft() {
    if (!dirty.current && !resourcesDirty.current) return true;
    if (!window.confirm('Ungespeicherte Eingaben verwerfen und neu laden?'))
      return false;
    dirty.current = false;
    resourcesDirty.current = false;
    setEpoch((current) => current + 1);
    return true;
  }
  async function load() {
    const current = ++loadSequence.current;
    attemptedRevision.current = revision;
    setLoading(true);
    try {
      const response = await fetch('/api/v1/events/' + id);
      if (!response.ok) throw Error('load');
      const next = (await response.json()) as Detail;
      // A slower, older request must never overwrite a newer event state.
      if (current !== loadSequence.current) return;
      // The user started editing while this request was in flight. Keep the
      // form untouched and offer the newer data explicitly instead.
      if (dirty.current || resourcesDirty.current) {
        setRefreshDeferred(true);
        return;
      }
      loadedVersion.current = next.event.version;
      loadedId.current = next.event.id;
      setData(next);
      setLoadFailed(false);
      setRefreshDeferred(false);
      setReloadWarning(false);
    } catch (error) {
      if (current === loadSequence.current) {
        setLoadFailed(true);
        throw error;
      }
    } finally {
      if (current === loadSequence.current) setLoading(false);
    }
  }
  function backgroundLoad() {
    if (dirty.current || resourcesDirty.current) {
      setRefreshDeferred(true);
      return;
    }
    void load().catch(() => {});
  }
  useAutoRefresh(backgroundLoad, () => loading || busy || saving.current);
  useEffect(
    () => () => {
      ++loadSequence.current;
    },
    [],
  );
  useEffect(
    () => registerUnsavedChanges(() => dirty.current || resourcesDirty.current),
    [],
  );
  useEffect(() => {
    void load().catch(() => {});
  }, [id]);
  useEffect(() => {
    if (loading || loadFailed) return;
    if (loadedId.current === id && loadedVersion.current === revision) return;
    // A successful response that still carries an older version must not turn
    // the revision check into a request loop.
    if (attemptedRevision.current === revision) return;
    if (dirty.current || resourcesDirty.current) {
      setRefreshDeferred(true);
      return;
    }
    void load().catch(() => {});
  }, [revision, loading, loadFailed]);
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
            ? 'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.'
            : error.error === 'import_review_required'
              ? 'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.'
              : 'Status konnte nicht gespeichert werden. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      // The PUT is confirmed; report it before reloading so a failing GET is
      // never mistaken for a failed save.
      setMessage('Status gespeichert.');
      dirty.current = false;
      setRefreshDeferred(false);
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
    if (!mayReplaceDraft()) return;
    setRefreshDeferred(false);
    void load().catch(() => {});
  }
  function retryAfterSave() {
    if (!mayReplaceDraft()) return;
    setReloadWarning(false);
    setRefreshDeferred(false);
    void (async () => {
      try {
        await load();
        await onChanged();
      } catch {
        setReloadWarning(true);
      }
    })();
  }
  function discardDeferred() {
    if (!mayReplaceDraft()) return;
    setReloadWarning(false);
    setRefreshDeferred(false);
    void load().catch(() => {});
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
      aria-label="Event-Details"
      aria-busy={loading}
    >
      <button className="secondary-action" type="button" onClick={onClose}>
        Event-Details schließen
      </button>
      <p role="status">{message}</p>
      {refreshDeferred && (
        <div className="reload-warning">
          <p role="status">
            Eine Aktualisierung steht aus. Sie wird zurückgehalten, damit deine
            ungespeicherten Eingaben erhalten bleiben.
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy || loading}
            onClick={discardDeferred}
          >
            Neu laden und Eingaben verwerfen
          </button>
        </div>
      )}
      {loadFailed && !reloadWarning && !refreshDeferred && (
        <div className="reload-warning">
          <p role="alert">
            Event-Details konnte nicht geladen werden.{' '}
            {data
              ? 'Der zuletzt geladene Stand bleibt sichtbar.'
              : 'Bitte erneut versuchen.'}
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy || loading}
            onClick={retryLoad}
          >
            Event-Details erneut laden
          </button>
        </div>
      )}
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Gespeichert, aber die Event-Details konnten nicht neu geladen
            werden. Es wurde nichts doppelt angelegt.
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={retryAfterSave}
          >
            Event-Details erneut laden
          </button>
        </div>
      )}
      {loading && <p>Event-Details werden geladen …</p>}
      {data && (
        <>
          <h2 ref={heading} tabIndex={-1}>
            Event: {data.event.name}
          </h2>
          <nav className="record-navigation" aria-label="Bereiche des Events">
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
              key={data.event.version + ':' + epoch}
              onSubmit={(event) => {
                event.preventDefault();
                void saveStatus(event.currentTarget);
              }}
            >
              <fieldset disabled={busy || loading}>
                <legend>Status ändern</legend>
                <label>
                  Status des Events
                  <select
                    name="status"
                    defaultValue={data.event.status}
                    onChange={() => {
                      dirty.current = true;
                    }}
                  >
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
              type="button"
              className="icon-action"
              aria-label={`Stammdaten bearbeiten: ${data.event.name}`}
              title="Event bearbeiten"
              disabled={busy || loading}
              onClick={() => onEdit(data.event)}
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
              key={data.event.id + ':' + data.event.version + ':' + epoch}
              event={data.event}
              csrfToken={csrfToken}
              onDirtyChange={(value) => {
                resourcesDirty.current = value;
              }}
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
