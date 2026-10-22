import { useEffect, useRef, useState, type FormEvent } from 'react';

type DocumentRow = {
  id: string;
  kind: string;
  templateId: string;
  eventId: string | null;
  contactId: string | null;
  number: string | null;
  state: 'draft' | 'final' | 'withdrawn';
  issuedAt: string;
  finalizedAt: string | null;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  version: number;
};
type TemplateRow = { id: string; kind: string; name: string; state: string };
const stateLabels: Record<DocumentRow['state'], string> = {
  draft: 'Entwurf',
  final: 'Finalisiert',
  withdrawn: 'Zurückgezogen',
};
const money = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

// One off-shape row must never take the whole event file down with it.
async function validDocuments(reply: Response): Promise<DocumentRow[]> {
  const rows = (await reply.json()) as DocumentRow[];
  return Array.isArray(rows)
    ? rows.filter(
        (entry) =>
          entry &&
          stateLabels[entry.state] !== undefined &&
          Number.isFinite(Date.parse(entry.finalizedAt ?? entry.issuedAt)) &&
          Number.isFinite(entry.grossMinor),
      )
    : [];
}

// The event file is where an offer is born: it owns the contact and the date
// that the template placeholders need.
export function EventDocuments({
  eventId,
  contactId,
  timeZone,
  csrfToken,
}: {
  eventId: string;
  contactId: string | null;
  timeZone: string;
  csrfToken: string;
}) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]),
    [templates, setTemplates] = useState<TemplateRow[]>([]),
    [templateId, setTemplateId] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(''),
    [loading, setLoading] = useState(true),
    [reloadWarning, setReloadWarning] = useState(false),
    mutating = useRef(false);
  async function load() {
    const [documentReply, templateReply] = await Promise.all([
      fetch('/api/v1/documents?eventId=' + encodeURIComponent(eventId)),
      fetch('/api/v1/document-templates'),
    ]);
    if (!documentReply.ok || !templateReply.ok) throw new Error('load');
    const offers = ((await templateReply.json()) as TemplateRow[]).filter(
      (entry) => entry.kind === 'offer' && entry.state === 'active',
    );
    setDocuments(await validDocuments(documentReply));
    setTemplates(offers);
    setTemplateId((current) => current || offers[0]?.id || '');
  }
  useEffect(() => {
    void load()
      .catch(() => setMessage('Angebote konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [eventId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateId || !contactId || mutating.current) return;
    mutating.current = true;
    setBusy('create');
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ templateId, eventId, contactId }),
      });
      if (!reply.ok) {
        setMessage(
          'Entwurf konnte nicht angelegt werden. Vorlage, Kontakt und Anmeldung prüfen.',
        );
        return;
      }
      // Confirmed write: report it before the list reload. A later GET failure
      // must never read as a reason to create the draft again.
      setMessage('Entwurf angelegt.');
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  async function finalize(id: string) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/finalize', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'invalid_state'
            ? 'Bereits finalisiert. Die Liste wird aktualisiert.'
            : result.error === 'artifact_failed'
              ? 'PDF konnte nicht erzeugt werden. Bitte Betreiber informieren.'
              : 'Finalisieren nicht möglich: Nummernkreis und Pflichtangaben prüfen.',
        );
        // Refresh a possibly stale row, but keep the explanatory message.
        try {
          await load();
        } catch {
          // The retry affordance for confirmed writes does not apply here.
        }
      } else {
        const result = (await reply.json()) as { number?: string };
        setMessage(
          result.number
            ? 'Finalisiert als ' + result.number + '.'
            : 'Angebot finalisiert.',
        );
        try {
          await load();
          setReloadWarning(false);
        } catch {
          setReloadWarning(true);
        }
      }
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }
  function retryLoad() {
    setReloadWarning(false);
    void load().catch(() => setReloadWarning(true));
  }
  function date(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeZone,
    }).format(new Date(value));
  }
  return (
    <section
      className="event-documents"
      aria-labelledby="event-documents-heading"
    >
      <h3 id="event-documents-heading">Angebote</h3>
      <p>
        Ein Angebot entsteht als Entwurf aus einer Vorlage. Beim Finalisieren
        erhält es seine Nummer und eine unveränderliche PDF.
      </p>
      <p role="status">{message}</p>
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Gespeichert, aber die Angebotsliste konnte nicht neu geladen werden.
            Nichts erneut anlegen.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Angebote erneut laden
          </button>
        </div>
      )}
      {loading ? (
        <p>Angebote werden geladen …</p>
      ) : (
        <>
          {documents.length ? (
            <ul className="document-list">
              {documents.map((entry) => (
                <li key={entry.id}>
                  <div className="document-row">
                    <strong>{entry.number ?? 'Entwurf'}</strong>
                    <span>{stateLabels[entry.state]}</span>
                  </div>
                  <p className="document-meta">
                    {entry.state === 'final' && entry.finalizedAt
                      ? 'Finalisiert am '
                      : 'Angelegt am '}
                    <time
                      dateTime={
                        (entry.finalizedAt ?? entry.issuedAt).split('T')[0]
                      }
                    >
                      {date(entry.finalizedAt ?? entry.issuedAt)}
                    </time>
                    {' · '}
                    {money.format(entry.grossMinor / 100)}
                  </p>
                  <div className="document-actions">
                    {entry.state === 'draft' && (
                      <button
                        type="button"
                        disabled={busy !== ''}
                        aria-label={
                          'Angebot ' +
                          (entry.number ?? 'Entwurf') +
                          ' finalisieren'
                        }
                        onClick={() => void finalize(entry.id)}
                      >
                        Finalisieren
                      </button>
                    )}
                    {entry.state === 'final' && (
                      <a
                        className="document-download"
                        href={'/api/v1/documents/' + entry.id + '/pdf'}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={
                          'Angebot ' + (entry.number ?? '') + ' als PDF öffnen'
                        }
                      >
                        PDF öffnen
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>Noch kein Angebot zu diesem Event.</p>
          )}
          {!templates.length && (
            <p className="document-hint">
              Noch keine aktive Angebotsvorlage. Zuerst unter Einstellungen →
              Dokumentvorlagen eine Vorlage anlegen.
            </p>
          )}
          {!contactId && (
            <p className="document-hint">
              Für ein Angebot zuerst einen Hauptkontakt zuordnen.
            </p>
          )}
          <form onSubmit={create}>
            <fieldset disabled={busy !== '' || !templates.length || !contactId}>
              <legend>Neues Angebot</legend>
              <label>
                Vorlage
                <select
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {templates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-action">Entwurf anlegen</button>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}
