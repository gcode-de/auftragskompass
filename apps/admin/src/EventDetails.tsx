import { WebsiteInquiry } from './WebsiteInquiry.js';
import { ResourceAssignments } from './ResourceAssignments.js';
import { EventDocuments } from './EventDocuments.js';
import { EventLibraryFiles } from './EventLibraryFiles.js';
import { useAutoRefresh } from './auto-refresh.js';
import { registerUnsavedChanges } from './unsaved-changes.js';
import { plainDateText } from './calendar-range.js';
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
// BKP013.1: the event file is one record with a stable head and five focused
// work areas. Details holds the main information, Ressourcen keeps the existing
// atomic assignment surface, Dateien owns the documents, Notizen and Logbuch
// stay directly reachable. There is deliberately no mail area while no mail
// module exists.
type Area = 'details' | 'resources' | 'files' | 'notes' | 'activity';
const areas: { value: Area; label: string }[] = [
  { value: 'details', label: 'Details' },
  { value: 'resources', label: 'Ressourcen' },
  { value: 'files', label: 'Dateien' },
  { value: 'notes', label: 'Notizen' },
  { value: 'activity', label: 'Logbuch' },
];
// A wide frame keeps contact and place beside the main information; the narrow
// frame offers the same context behind one deliberate disclosure, so the form
// stays the first thing. Without a media query the context stays visible
// instead of disappearing silently.
function useWideRecord() {
  const [wide, setWide] = useState(
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(min-width: 64rem)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia('(min-width: 64rem)');
    const changed = () => setWide(viewport.matches);
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);
  return wide;
}
function clockText(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(instant));
}
// The head keeps the same stored values as the record body: the genuine
// schedule and the effective place. A date-only booking says so instead of
// inventing a clock time (H037), and a missing place stays open, not an error.
function headSchedule(event: Detail['event']) {
  if (!event.startsAt)
    return event.eventDate ? 'Tagesbuchung, ohne Uhrzeit' : '';
  return event.endsAt
    ? clockText(event.startsAt, event.timeZone) +
        '–' +
        clockText(event.endsAt, event.timeZone) +
        ' Uhr'
    : 'ab ' + clockText(event.startsAt, event.timeZone) + ' Uhr';
}
function effectivePlace(event: Detail['event'], location: Detail['location']) {
  if (event.venueOverride)
    return (event.venue ?? '').trim().replace(/\s*\n\s*/g, ', ');
  if (!location) return '';
  return [
    location.name,
    location.street,
    [location.postalCode, location.city].filter(Boolean).join(' '),
  ]
    .filter((part) => Boolean(part?.trim()))
    .join(', ');
}
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
  const [area, setArea] = useState<Area>('details');
  const wideRecord = useWideRecord();
  const heading = useRef<HTMLHeadingElement>(null),
    detailsPanel = useRef<HTMLDivElement>(null),
    resourcesPanel = useRef<HTMLDivElement>(null),
    filesPanel = useRef<HTMLDivElement>(null),
    notesPanel = useRef<HTMLDivElement>(null),
    activityPanel = useRef<HTMLDivElement>(null),
    focusedArea = useRef<Area>('details'),
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
  // Switching the work area moves the keyboard focus into the chosen area.
  // Nothing is unmounted, so every draft keeps its value.
  useEffect(() => {
    if (focusedArea.current === area) return;
    focusedArea.current = area;
    const panel = {
      details: detailsPanel,
      resources: resourcesPanel,
      files: filesPanel,
      notes: notesPanel,
      activity: activityPanel,
    }[area];
    panel.current?.focus({ preventScroll: true });
  }, [area]);
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
  const schedule = data ? headSchedule(data.event) : '',
    place = data ? effectivePlace(data.event, data.location) : '';
  return (
    <section
      className="event-record"
      aria-label="Event-Details"
      aria-busy={loading}
    >
      <button className="tertiary-action" type="button" onClick={onClose}>
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
          <header className="event-record-head" data-status={data.event.status}>
            <p className="event-record-when">
              <span className="event-record-date">
                {data.event.eventDate
                  ? plainDateText(data.event.eventDate)
                  : 'ohne Datum'}
              </span>
              {schedule && (
                <span className="event-record-time">{schedule}</span>
              )}
            </p>
            <h2 ref={heading} tabIndex={-1}>
              Event: {data.event.name}
            </h2>
            <p className="event-record-facts">
              <span className="event-status">
                <span className="event-status-mark" aria-hidden="true" />
                {statuses.find((status) => status.code === data.event.status)
                  ?.label ?? data.event.status}
              </span>
              <span className="event-record-type">
                {data.eventType?.name ?? 'Art offen'}
              </span>
              <span className="event-record-place">{place || 'Ort offen'}</span>
              {(data.event.source ?? '').startsWith('Website:') && (
                <span className="event-source-quiet">Website</span>
              )}
            </p>
          </header>
          <nav className="record-navigation" aria-label="Bereiche des Events">
            {areas.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="nav-action"
                aria-current={area === entry.value ? 'location' : undefined}
                onClick={() => {
                  setArea(entry.value);
                  heading.current?.scrollIntoView?.();
                }}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-details"
            tabIndex={-1}
            ref={detailsPanel}
            hidden={area !== 'details'}
          >
            <h3 id="event-panel-details">Details</h3>
            <div className="event-detail-layout">
              <div className="event-detail-main">
                <h4>Termin</h4>
                <dl>
                  <dt>Datum</dt>
                  <dd>
                    {data.event.eventDate
                      ? data.event.eventDate.split('-').reverse().join('.')
                      : 'Ohne Datum'}
                  </dd>
                  {/* H037: a date-only booking says so; a real midnight start
                      keeps its genuine clock time from the stored timestamp. */}
                  <dt>Beginn</dt>
                  <dd>
                    {data.event.startsAt
                      ? time(data.event.startsAt)
                      : 'Tagesbuchung, ohne Uhrzeit'}
                  </dd>
                  <dt>Ende</dt>
                  <dd>
                    {data.event.endsAt
                      ? time(data.event.endsAt)
                      : 'Ohne Uhrzeit'}
                  </dd>
                </dl>
                <h4>Allgemein</h4>
                <dl>
                  <dt>Eventart</dt>
                  <dd>{data.eventType?.name ?? 'Noch offen'}</dd>
                  <dt>Fotobox-Paket</dt>
                  <dd>{data.package?.name ?? 'Noch offen'}</dd>
                  <dt>Anfragequelle</dt>
                  <dd>{data.event.source || 'Noch offen'}</dd>
                  <dt>Beschreibung</dt>
                  <dd>{data.event.description || 'Keine Beschreibung'}</dd>
                </dl>
                {data.websiteInquiryAvailable && (
                  <WebsiteInquiry
                    key={id}
                    eventId={id}
                    timeZone={data.event.timeZone}
                  />
                )}
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
                    <button className="primary-action">Status speichern</button>
                  </fieldset>
                </form>
                <button
                  type="button"
                  className="icon-action tier-quiet-icon"
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
              </div>
              <aside className="event-detail-aside">
                <details className="event-aside" open={wideRecord}>
                  <summary>Kontakt und Ort</summary>
                  <h4>Kontakt</h4>
                  {/* A missing link is a normal open state of an option, not an
                      error and not a blocking step before the event exists. */}
                  {!data.contacts.some(
                    (person) => person.role === 'primary',
                  ) && <p>Kontakt noch offen.</p>}
                  <ul>
                    {data.contacts.map((person) => (
                      <li key={person.id}>
                        {person.role === 'primary'
                          ? 'Hauptkontakt'
                          : 'Weiterer Kontakt'}
                        : {person.name} {person.contactPerson}{' '}
                        {person.email && (
                          <a
                            href={'mailto:' + encodeURIComponent(person.email)}
                          >
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
                  <h4>Ort / Adresse</h4>
                  {data.event.venueOverride ? (
                    data.event.venue?.trim() ? (
                      <p className="event-venue">{data.event.venue}</p>
                    ) : (
                      <p>Kein Veranstaltungsort hinterlegt.</p>
                    )
                  ) : data.location ? (
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
                    <p>Ort offen.</p>
                  )}
                </details>
              </aside>
            </div>
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-resources"
            tabIndex={-1}
            ref={resourcesPanel}
            hidden={area !== 'resources'}
          >
            <h3 id="event-panel-resources">Ressourcen</h3>
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
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-files"
            tabIndex={-1}
            ref={filesPanel}
            hidden={area !== 'files'}
          >
            <h3 id="event-panel-files">Dateien</h3>
            <p className="event-panel-hint">
              Dokumente dieses Events, nach ihrer Art getrennt. Was hier fehlt,
              ist noch nicht angelegt.
            </p>
            <EventLibraryFiles
              key={data.event.id}
              eventId={data.event.id}
              csrfToken={csrfToken}
              active={area === 'files'}
            />
            <EventDocuments
              key={data.event.id}
              eventId={data.event.id}
              contactId={data.event.primaryContactId}
              timeZone={data.event.timeZone}
              csrfToken={csrfToken}
            />
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-notes"
            tabIndex={-1}
            ref={notesPanel}
            hidden={area !== 'notes'}
          >
            <h3 id="event-panel-notes">Interne Notizen</h3>
            <div
              className="event-notes"
              aria-label={'Notizen: ' + data.event.name}
              dangerouslySetInnerHTML={{ __html: data.event.notesHtml }}
            />
            <p className="event-panel-hint">
              Notizen bearbeitest du über „Stammdaten bearbeiten“ in den
              Details.
            </p>
          </div>
          <div
            className="event-record-panel"
            role="region"
            aria-labelledby="event-panel-activity"
            tabIndex={-1}
            ref={activityPanel}
            hidden={area !== 'activity'}
          >
            <h3 id="event-panel-activity">Logbuch</h3>
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
