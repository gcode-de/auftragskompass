import { useEffect, useState } from 'react';
type Feed = {
  id: string;
  resourceId: string | null;
  description: boolean;
  eventType: boolean;
  internalLink: boolean;
  expiresAt: string | null;
};
type Resource = { id: string; name: string };
export function CalendarFeedsPanel({ csrfToken }: { csrfToken: string }) {
  const [feeds, setFeeds] = useState<Feed[]>([]),
    [resources, setResources] = useState<Resource[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(true),
    [url, setUrl] = useState('');
  async function load() {
    const [a, b] = await Promise.all([
      fetch('/api/v1/calendar-feeds'),
      fetch('/api/v1/resources'),
    ]);
    if (!a.ok || !b.ok) throw Error();
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
          void change('POST', {
            resourceId: String(f.get('resourceId')) || null,
            description: f.has('description'),
            eventType: f.has('eventType'),
            internalLink: f.has('internalLink'),
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
          <label>
            <input type="checkbox" name="description" />
            Eventbeschreibung aufnehmen
          </label>
          <label>
            <input type="checkbox" name="eventType" />
            Eventart aufnehmen
          </label>
          <label>
            <input type="checkbox" name="internalLink" />
            Internen Eventlink aufnehmen
          </label>
          <button>Abo erstellen</button>
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
            · läuft nicht ab
            <button
              disabled={busy}
              onClick={() =>
                void change(
                  'PUT',
                  {
                    resourceId: feed.resourceId,
                    description: feed.description,
                    eventType: feed.eventType,
                    internalLink: feed.internalLink,
                  },
                  feed.id,
                )
              }
            >
              Link erneuern
            </button>
            <button
              disabled={busy}
              onClick={() => void change('DELETE', undefined, feed.id)}
            >
              Abo widerrufen
            </button>
          </li>
        ))}
      </ul>
      <button
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
