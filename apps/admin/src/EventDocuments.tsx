import { useEffect, useRef, useState, type FormEvent } from 'react';
import { OfferDraftEditor } from './OfferDraftEditor.js';

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
// BKP013.1: the event file owns one card per document kind that actually
// exists. The offer card is always shown because it also carries the existing
// creation surface; any other kind appears only with real stored rows, so no
// empty contract or questionnaire card is invented.
const kindOrder = [
  'offer',
  'order_confirmation',
  'deposit_invoice',
  'invoice',
  'correction',
] as const;
const kindLabels: Record<string, string> = {
  offer: 'Angebote',
  order_confirmation: 'Auftragsbestätigungen',
  deposit_invoice: 'Anzahlungsrechnungen',
  invoice: 'Rechnungen',
  correction: 'Rechnungskorrekturen',
};
const otherKindLabel = 'Weitere Dateien';
const knownKinds = new Set<string>(kindOrder);

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
    [editorId, setEditorId] = useState(''),
    [editorDirty, setEditorDirty] = useState(false),
    [editorBusy, setEditorBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [reloadWarning, setReloadWarning] = useState(false),
    mutating = useRef(false),
    editorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (editorId || !editorTrigger.current) return;
    editorTrigger.current.focus();
    editorTrigger.current = null;
  }, [editorId]);
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
      .catch(() => setMessage('Dateien konnten nicht geladen werden.'))
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
  async function finalize(id: string, version: number) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/finalize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(
          result.error === 'invalid_state'
            ? 'Bereits finalisiert. Die Liste wird aktualisiert.'
            : result.error === 'conflict'
              ? 'Der Entwurf wurde geändert. Bitte erneut laden und prüfen.'
              : result.error === 'artifact_failed'
                ? 'PDF konnte nicht erzeugt werden. Bitte Betreiber informieren.'
                : 'Finalisieren nicht möglich: Nummernkreis und Pflichtangaben prüfen.',
        );
        if (result.error === 'conflict') setEditorId('');
        // Refresh a possibly stale row, but keep the explanatory message.
        try {
          await load();
        } catch {
          // The retry affordance for confirmed writes does not apply here.
        }
      } else {
        const result = (await reply.json()) as { number?: string };
        setEditorId('');
        setEditorDirty(false);
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
  function rows(entries: DocumentRow[]) {
    return (
      <ul className="document-list">
        {entries.map((entry) => (
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
                dateTime={(entry.finalizedAt ?? entry.issuedAt).split('T')[0]}
              >
                {date(entry.finalizedAt ?? entry.issuedAt)}
              </time>
              {' · '}
              {money.format(entry.grossMinor / 100)}
            </p>
            <div className="document-actions">
              {entry.state === 'draft' && (
                <>
                  {entry.kind === 'offer' && (
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy !== '' || editorBusy || editorId !== ''}
                      aria-label={
                        'Angebot ' + (entry.number ?? 'Entwurf') + ' bearbeiten'
                      }
                      aria-expanded={editorId === entry.id}
                      onClick={(event) => {
                        editorTrigger.current = event.currentTarget;
                        setEditorDirty(false);
                        setEditorId(entry.id);
                      }}
                    >
                      Bearbeiten
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== '' || editorBusy || editorDirty}
                    aria-label={
                      'Angebot ' + (entry.number ?? 'Entwurf') + ' finalisieren'
                    }
                    onClick={() => void finalize(entry.id, entry.version)}
                  >
                    Finalisieren
                  </button>
                </>
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
            {entry.kind === 'offer' &&
              editorId === entry.id &&
              entry.state === 'draft' && (
                <OfferDraftEditor
                  documentId={entry.id}
                  csrfToken={csrfToken}
                  onClose={() => {
                    setEditorDirty(false);
                    setEditorId('');
                  }}
                  onDirtyChange={setEditorDirty}
                  onBusyChange={setEditorBusy}
                  onVersionChange={(version) =>
                    setDocuments((current) =>
                      current.map((row) =>
                        row.id === entry.id ? { ...row, version } : row,
                      ),
                    )
                  }
                />
              )}
          </li>
        ))}
      </ul>
    );
  }
  const offers = documents.filter((entry) => entry.kind === 'offer'),
    otherGroups = kindOrder
      .filter((kind) => kind !== 'offer')
      .map((kind) => ({
        kind,
        label: kindLabels[kind]!,
        rows: documents.filter((entry) => entry.kind === kind),
      }))
      .filter((group) => group.rows.length),
    unknownRows = documents.filter((entry) => !knownKinds.has(entry.kind));
  return (
    <div className="event-documents">
      <p role="status">{message}</p>
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Gespeichert, aber die Dateiliste konnte nicht neu geladen werden.
            Nichts erneut anlegen.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Dateien erneut laden
          </button>
        </div>
      )}
      {loading ? (
        <p>Dateien werden geladen …</p>
      ) : (
        <div className="document-cards">
          <section
            className="document-card"
            aria-labelledby="event-documents-heading"
          >
            <h4 id="event-documents-heading">Angebote</h4>
            <p className="document-card-hint">
              Ein Angebot entsteht als Entwurf aus einer Vorlage. Beim
              Finalisieren erhält es seine Nummer und eine unveränderliche PDF.
            </p>
            {offers.length ? (
              rows(offers)
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
              <fieldset
                disabled={busy !== '' || !templates.length || !contactId}
              >
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
          </section>
          {otherGroups.map((group) => (
            <section
              key={group.kind}
              className="document-card"
              aria-labelledby={'event-documents-kind-' + group.kind}
            >
              <h4 id={'event-documents-kind-' + group.kind}>{group.label}</h4>
              {rows(group.rows)}
            </section>
          ))}
          {unknownRows.length > 0 && (
            <section
              className="document-card"
              aria-labelledby="event-documents-kind-other"
            >
              <h4 id="event-documents-kind-other">{otherKindLabel}</h4>
              {rows(unknownRows)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
