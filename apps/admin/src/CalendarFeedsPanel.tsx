import { useEffect, useState } from 'react';
type Feed = {
  id: string;
  resourceId: string | null;
  description: boolean;
  eventType: boolean;
  internalLink: boolean;
  // FEED-02: the filters and the on-site content of a feed.
  contact: boolean;
  notes: boolean;
  // An answer from before FEED-02 may lack the filters.
  statuses?: string[];
  eventTypeIds?: string[];
  expiresAt: string | null;
};
type Resource = { id: string; name: string };
type EventType = { id: string; name: string; state?: string };
// The same order and words as the event list; cancelled and unavailable
// events stay out unless chosen.
const feedStatuses = [
  ['inquiry', 'Anfrage', true],
  ['option', 'Option', true],
  ['booked', 'Gebucht', true],
  ['unavailable', 'Nicht verfügbar', false],
  ['cancelled', 'Annulliert', false],
] as const;
function feedSummary(feed: Feed, types: EventType[]) {
  const statuses = feedStatuses
      .filter(([code]) => (feed.statuses ?? []).includes(code))
      .map(([, label]) => label)
      .join(', '),
    kinds = feed.eventTypeIds?.length
      ? feed.eventTypeIds
          .map((id) => types.find((type) => type.id === id)?.name ?? 'Eventart')
          .join(', ')
      : 'alle Eventarten',
    extras = [
      feed.contact && 'Kontakt',
      feed.notes && 'Notizen',
      feed.description && 'Beschreibung',
      feed.eventType && 'Eventart/Paket',
      feed.internalLink && 'Link',
    ].filter(Boolean);
  return (
    statuses +
    ' · ' +
    kinds +
    (extras.length ? ' · mit ' + extras.join(', ') : '')
  );
}
export function CalendarFeedsPanel({ csrfToken }: { csrfToken: string }) {
  const [feeds, setFeeds] = useState<Feed[]>([]),
    [resources, setResources] = useState<Resource[]>([]),
    [types, setTypes] = useState<EventType[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(true),
    [url, setUrl] = useState('');
  async function load() {
    const [a, b, c] = await Promise.all([
      fetch('/api/v1/calendar-feeds'),
      fetch('/api/v1/resources'),
      fetch('/api/v1/master-data/event_type'),
    ]);
    if (!a.ok || !b.ok) throw Error();
    // The event types only label and narrow; without them every type counts.
    const typeRows = c.ok ? ((await c.json()) as EventType[]) : [];
    setTypes(Array.isArray(typeRows) ? typeRows : []);
    return {
      feeds: (await a.json()) as Feed[],
      resources: (await b.json()) as Resource[],
    };
  }
  useEffect(() => {
    let active = true;
    void load()
      .then((data) => {
        if (active) {
          setFeeds(data.feeds);
          setResources(data.resources);
        }
      })
      .catch(() => {
        if (active) setMessage('Kalender-Abos konnten nicht geladen werden.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(
    method: 'POST' | 'PUT' | 'DELETE',
    input?: Omit<Feed, 'id' | 'expiresAt'>,
    id?: string,
  ) {
    setBusy(true);
    setUrl('');
    setMessage('');
    try {
      const response = await fetch(
        '/api/v1/calendar-feeds' + (id ? '/' + id : ''),
        {
          method,
          headers: {
            ...(input ? { 'content-type': 'application/json' } : {}),
            'x-csrf-token': csrfToken,
          },
          ...(input ? { body: JSON.stringify(input) } : {}),
        },
      );
      if (!response.ok) throw Error();
      const result =
        method === 'DELETE'
          ? null
          : ((await response.json()) as { url: string });
      const data = await load();
      setFeeds(data.feeds);
      setResources(data.resources);
      setUrl(result?.url ?? '');
      setMessage(
        method === 'DELETE'
          ? 'Abo widerrufen. Bereits heruntergeladene Einträge können im Kalenderclient verbleiben.'
          : 'Gespeichert. Den neuen Link jetzt im Kalenderclient sichern; er wird nur einmal angezeigt.',
      );
    } catch {
      setMessage(
        'Änderung nicht bestätigt. Liste neu laden und Zustand prüfen, bevor du erneut speicherst.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Kalender-Abos">
      <h2>Kalender abonnieren</h2>
      <p>
        Der Link erlaubt jedem Besitzer Zugriff auf Termindaten. Nur mit deinem
        gewünschten Kalenderdienst teilen. Der Link läuft nicht ab; erst das
        Erneuern macht den alten Link sofort ungültig. Abrufintervalle bestimmt
        dein Kalenderclient.
      </p>
      <p role="status">{message}</p>
      {url && (
        <label>
          Neuer Kalenderlink (nur jetzt sichtbar)
          <input readOnly value={url} autoComplete="off" />
        </label>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const statuses = f.getAll('statuses').map(String);
          if (!statuses.length) {
            setMessage('Bitte mindestens einen Buchungsstatus wählen.');
            return;
          }
          void change('POST', {
            resourceId: String(f.get('resourceId')) || null,
            description: f.has('description'),
            eventType: f.has('eventType'),
            internalLink: f.has('internalLink'),
            contact: f.has('contact'),
            notes: f.has('notes'),
            statuses,
            eventTypeIds: f.getAll('eventTypeIds').map(String),
          });
        }}
      >
        <fieldset disabled={busy}>
          <legend>Neues Kalender-Abo</legend>
          <label>
            Kalenderumfang
            <select name="resourceId">
              <option value="">Alle Events</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="feed-choices">
            <legend>Buchungsstatus</legend>
            {feedStatuses.map(([code, label, preset]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  name="statuses"
                  value={code}
                  defaultChecked={preset}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {types.length > 0 && (
            <fieldset className="feed-choices">
              <legend>Eventarten (keine Auswahl = alle)</legend>
              {types
                .filter((type) => type.state !== 'archived')
                .map((type) => (
                  <label key={type.id}>
                    <input
                      type="checkbox"
                      name="eventTypeIds"
                      value={type.id}
                    />
                    {type.name}
                  </label>
                ))}
            </fieldset>
          )}
          <fieldset className="feed-choices">
            <legend>Inhalt der Termine</legend>
            <p className="document-hint">
              Uhrzeit, Status und Ressourcen stehen immer im Termin.
            </p>
            <label>
              <input type="checkbox" name="contact" />
              Ansprechpartner mit Telefon und E-Mail aufnehmen
            </label>
            <label>
              <input type="checkbox" name="notes" />
              Notizen aufnehmen (die zehn neuesten)
            </label>
            <label>
              <input type="checkbox" name="description" />
              Eventbeschreibung aufnehmen
            </label>
            <label>
              <input type="checkbox" name="eventType" />
              Eventart und Paket aufnehmen
            </label>
            <label>
              <input type="checkbox" name="internalLink" />
              Internen Eventlink aufnehmen
            </label>
            <p className="document-hint">
              Mit Kontakt oder Notizen enthält der Link personenbezogene Daten –
              nur in deinem eigenen Kalender verwenden.
            </p>
          </fieldset>
          <button className="primary-action">Abo erstellen</button>
        </fieldset>
      </form>
      {!busy && !feeds.length && <p>Keine aktiven Kalender-Abos.</p>}
      <ul>
        {feeds.map((feed) => (
          <li key={feed.id}>
            {feed.resourceId
              ? (resources.find((r) => r.id === feed.resourceId)?.name ??
                'Ressource')
              : 'Alle Events'}{' '}
            · {feedSummary(feed, types)} · läuft nicht ab
            <button
              className="tertiary-action"
              disabled={busy}
              onClick={() =>
                void change(
                  'PUT',
                  {
                    resourceId: feed.resourceId,
                    description: feed.description,
                    eventType: feed.eventType,
                    internalLink: feed.internalLink,
                    contact: feed.contact,
                    notes: feed.notes,
                    statuses: feed.statuses,
                    eventTypeIds: feed.eventTypeIds,
                  },
                  feed.id,
                )
              }
            >
              Link erneuern
            </button>
            <button
              className="secondary-action"
              disabled={busy}
              onClick={() => void change('DELETE', undefined, feed.id)}
            >
              Abo widerrufen
            </button>
          </li>
        ))}
      </ul>
      <button
        className="tertiary-action"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setUrl('');
          void load()
            .then((data) => {
              setFeeds(data.feeds);
              setResources(data.resources);
              setMessage('');
            })
            .catch(() =>
              setMessage('Kalender-Abos konnten nicht geladen werden.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        Abos neu laden
      </button>
    </section>
  );
}
