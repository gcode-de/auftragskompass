import { useEffect, useRef, useState, type FormEvent } from 'react';
import { OfferDraftEditor } from './OfferDraftEditor.js';
import { exactMinorUnits } from './FilesPanel.js';

type DocumentRow = {
  id: string;
  kind: string;
  templateId: string | null;
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
  // BKP019.0: the business axis of an offer, only present with include=offer.
  offerStatus?: OfferStatus | null;
  validUntil?: string | null;
  offerExpired?: boolean;
  // BKP019.a: how and when the customer accepted; it outlives a withdrawal.
  acceptedAt?: string | null;
  acceptanceChannel?: AcceptanceChannel | null;
  acceptanceNote?: string | null;
  acceptanceFileId?: string | null;
  acceptanceFileName?: string | null;
  acceptanceFileState?: 'available' | 'archived' | null;
};
type OfferStatus = 'sent' | 'accepted' | 'withdrawn';
type AcceptanceChannel = 'email' | 'phone' | 'pdf' | 'other';
type TemplateRow = { id: string; kind: string; name: string; state: string };
type LibraryFileRow = {
  id: string;
  displayName: string;
  state: 'available' | 'archived' | 'rejected';
};
const stateLabels: Record<DocumentRow['state'], string> = {
  draft: 'Entwurf',
  final: 'Finalisiert',
  withdrawn: 'Zurückgezogen',
};
// The business status is a second, independent line: a finalized offer can be
// sent, accepted or withdrawn and keeps its number and its PDF unchanged.
const offerStatusLabels: Record<OfferStatus | 'unset', string> = {
  unset: 'Noch nicht versendet',
  sent: 'Versendet',
  accepted: 'Angenommen',
  withdrawn: 'Zurückgezogen',
};
// AG-06 names the four channels a customer can say yes through.
const acceptanceChannelLabels: Record<AcceptanceChannel, string> = {
  email: 'E-Mail',
  phone: 'Telefon',
  pdf: 'Unterschriebenes PDF',
  other: 'Sonstiges',
};
const acceptanceChannels = Object.keys(
  acceptanceChannelLabels,
) as AcceptanceChannel[];
// One wording per rejected status change, shared by send/withdraw and accept.
function statusChangeMessage(error: string): string {
  switch (error) {
    case 'conflict':
      return 'Der Stand wurde geändert. Bitte Liste aktualisieren, dann erneut wählen.';
    case 'invalid_transition':
      return 'Dieser Statuswechsel ist nicht zulässig.';
    case 'invalid_kind':
      return 'Nur ein finalisiertes Angebot hat einen Angebotsstatus.';
    case 'acceptance_conflict':
      return 'Für dieses Angebot ist bereits eine andere Annahme gespeichert. Bitte Liste aktualisieren.';
    case 'invalid_channel':
      return 'Bitte einen gültigen Annahmekanal wählen.';
    case 'invalid_time':
      return 'Der Annahmezeitpunkt ist ungültig oder liegt in der Zukunft.';
    case 'invalid_note':
      return 'Die Notiz ist zu lang oder enthält unzulässige Zeichen.';
    case 'invalid_attachment':
      return 'Der Anhang ist nicht mehr verfügbar. Bitte eine andere Datei wählen.';
    case 'not_found':
      return 'Die Datei wurde nicht gefunden. Bitte Liste aktualisieren.';
    default:
      return 'Statuswechsel nicht möglich.';
  }
}
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
    [initialLoadFailed, setInitialLoadFailed] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false),
    [createUncertain, setCreateUncertain] = useState(false),
    [confirmWithdrawId, setConfirmWithdrawId] = useState(''),
    // BKP019.a: the compact acceptance form of exactly one row.
    [acceptanceId, setAcceptanceId] = useState(''),
    [acceptanceChannel, setAcceptanceChannel] = useState<
      '' | AcceptanceChannel
    >(''),
    [acceptanceTime, setAcceptanceTime] = useState(''),
    [acceptanceNoteText, setAcceptanceNoteText] = useState(''),
    [acceptanceFileId, setAcceptanceFileId] = useState(''),
    [libraryFiles, setLibraryFiles] = useState<LibraryFileRow[]>([]),
    [libraryState, setLibraryState] = useState<
      'idle' | 'loading' | 'ready' | 'failed'
    >('idle'),
    mutating = useRef(false),
    editorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (editorId || !editorTrigger.current) return;
    editorTrigger.current.focus();
    editorTrigger.current = null;
  }, [editorId]);
  async function load() {
    const [documentReply, templateReply] = await Promise.all([
      fetch(
        '/api/v1/documents?eventId=' +
          encodeURIComponent(eventId) +
          '&include=offer',
      ),
      fetch('/api/v1/document-templates'),
    ]);
    if (!documentReply.ok || !templateReply.ok) throw new Error('load');
    const offers = ((await templateReply.json()) as TemplateRow[]).filter(
      (entry) => entry.kind === 'offer' && entry.state === 'active',
    );
    setDocuments(await validDocuments(documentReply));
    setTemplates(offers);
    setTemplateId((current) => current || offers[0]?.id || '');
    setInitialLoadFailed(false);
  }
  useEffect(() => {
    void load()
      .catch(() => setInitialLoadFailed(true))
      .finally(() => setLoading(false));
  }, [eventId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || createUncertain || mutating.current) return;
    const isBlank = templateId === '',
      expectedTemplateId = templateId || null;
    const createTrigger =
      event.currentTarget.querySelector<HTMLButtonElement>('button');
    mutating.current = true;
    setBusy('create');
    setMessage('');
    try {
      const reply = await fetch(
        templateId ? '/api/v1/documents' : '/api/v1/documents/blank-offer',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            ...(templateId ? { templateId } : {}),
            eventId,
            contactId,
          }),
        },
      );
      if (!reply.ok) {
        if (reply.status >= 500) throw new Error('uncertain-create');
        setMessage(
          'Entwurf konnte nicht angelegt werden. Vorlage, Kontakt und Anmeldung prüfen.',
        );
        return;
      }
      const created = (await reply.json()) as DocumentRow;
      if (
        typeof created.id !== 'string' ||
        created.id.length === 0 ||
        created.kind !== 'offer' ||
        created.state !== 'draft' ||
        created.eventId !== eventId ||
        created.contactId !== contactId ||
        created.templateId !== expectedTemplateId ||
        !Number.isSafeInteger(created.grossMinor) ||
        created.grossMinor < 0 ||
        !Number.isSafeInteger(created.version) ||
        created.version < 1
      )
        throw new Error('uncertain-create');
      if (isBlank) {
        editorTrigger.current = createTrigger;
      }
      // BKP013.2: a confirmed create is real stored data, so both paths show
      // the row at once instead of waiting for the list. A failed reload can
      // then never hide a draft that already exists, and the reload below
      // replaces this row with the server's version of the same id.
      setDocuments((current) => [
        created,
        ...current.filter((row) => row.id !== created.id),
      ]);
      // Confirmed write: report it before the list reload. A later GET failure
      // must never read as a reason to create the draft again.
      setMessage(
        isBlank ? 'Leerer Angebotsentwurf angelegt.' : 'Entwurf angelegt.',
      );
      if (isBlank) setEditorId(created.id);
      try {
        await load();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage('');
      setCreateUncertain(true);
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
  // BKP019.0: an explicit operator action. The content never changes here, so a
  // status switch can neither rewrite the PDF nor the number.
  async function changeStatus(
    id: string,
    status: OfferStatus,
    version: number,
  ) {
    if (mutating.current || editorBusy || editorDirty) return;
    mutating.current = true;
    setBusy(id);
    setMessage('');
    setConfirmWithdrawId('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/offer-status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ status, version }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(statusChangeMessage(result.error));
        if (
          result.error === 'conflict' ||
          result.error === 'invalid_transition'
        )
          try {
            await load();
          } catch {
            // The message above already says what to do.
          }
        return;
      }
      await reply.json();
      setMessage(
        'Angebotsstatus aktualisiert: ' + offerStatusLabels[status] + '.',
      );
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
  // BKP019.a: the library the acceptance may reference. Only an own, available
  // row is selectable; the "not scanned" fact stays visible instead of a scan
  // promise we cannot keep.
  async function loadLibraryFiles() {
    setLibraryState('loading');
    try {
      const reply = await fetch('/api/v1/library-files');
      if (!reply.ok) throw new Error('library');
      const rows = (await reply.json()) as LibraryFileRow[];
      setLibraryFiles(
        Array.isArray(rows)
          ? rows.filter(
              (row) => row && typeof row.id === 'string' && !!row.displayName,
            )
          : [],
      );
      setLibraryState('ready');
    } catch {
      // The typed input stays; only the optional picker is unavailable.
      setLibraryState('failed');
    }
  }
  function openAcceptance(id: string) {
    if (mutating.current) return;
    setMessage('');
    setAcceptanceId(id);
    setAcceptanceChannel('');
    setAcceptanceTime('');
    setAcceptanceNoteText('');
    setAcceptanceFileId('');
    void loadLibraryFiles();
  }
  function closeAcceptance() {
    setAcceptanceId('');
  }
  // The acceptance is a record of the customer's yes: the channel is required,
  // the instant defaults to the server clock, note and file are optional.
  async function accept(
    event: FormEvent<HTMLFormElement>,
    id: string,
    version: number,
  ) {
    event.preventDefault();
    if (mutating.current || busy !== '') return;
    if (!acceptanceChannel) {
      setMessage('Bitte einen Annahmekanal wählen.');
      return;
    }
    mutating.current = true;
    setBusy(id);
    setMessage('');
    try {
      const reply = await fetch('/api/v1/documents/' + id + '/offer-status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          status: 'accepted',
          version,
          channel: acceptanceChannel,
          // A datetime-local value is a wall-clock time; the server reads it in
          // the tenant zone, so the browser's own zone never decides.
          ...(acceptanceTime ? { acceptedAt: acceptanceTime } : {}),
          ...(acceptanceNoteText.trim()
            ? { note: acceptanceNoteText.trim() }
            : {}),
          ...(acceptanceFileId ? { attachmentFileId: acceptanceFileId } : {}),
        }),
      });
      if (!reply.ok) {
        const result = (await reply.json()) as { error: string };
        setMessage(statusChangeMessage(result.error));
        if (
          result.error === 'conflict' ||
          result.error === 'invalid_transition' ||
          result.error === 'not_found'
        )
          try {
            await load();
          } catch {
            // The message above already says what to do.
          }
        return;
      }
      await reply.json();
      setAcceptanceId('');
      setMessage('Angebotsstatus aktualisiert: Angenommen.');
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
  function retryLoad() {
    if (mutating.current) return;
    mutating.current = true;
    setBusy('reload');
    void load()
      .then(() => {
        setReloadWarning(false);
        setInitialLoadFailed(false);
        if (createUncertain) {
          setCreateUncertain(false);
          setMessage(
            'Liste aktualisiert. Bitte prüfen Sie vorhandene Angebote, bevor Sie erneut anlegen.',
          );
        }
      })
      .catch(() => {
        if (!createUncertain && !initialLoadFailed) setReloadWarning(true);
      })
      .finally(() => {
        mutating.current = false;
        setBusy('');
      });
  }
  function date(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeZone,
    }).format(new Date(value));
  }
  // A stored deadline is already a tenant-local calendar day. Parsing it as an
  // instant would shift it west of UTC, so it is formatted from its parts.
  function plainDate(value: string) {
    const [year, month, day] = value.split('-');
    return day + '.' + month + '.' + year;
  }
  // An acceptance instant is a real point in time, read in the tenant zone.
  function stamp(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
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
              {exactMinorUnits(entry.grossMinor) ?? '—'} €
            </p>
            {entry.kind === 'offer' && entry.state === 'final' && (
              <p className="document-offer-status">
                <span>{offerStatusLabels[entry.offerStatus ?? 'unset']}</span>
                {entry.validUntil && (
                  <>
                    {' · Gültig bis '}
                    <time dateTime={entry.validUntil}>
                      {plainDate(entry.validUntil)}
                    </time>
                  </>
                )}
                {entry.offerExpired && (
                  <>
                    {' · '}
                    <strong className="document-offer-expired">
                      Abgelaufen
                    </strong>
                  </>
                )}
              </p>
            )}
            {/* BKP019.a: the recorded acceptance stays readable, also after a
                withdrawal - only the archived attachment loses its link. */}
            {entry.kind === 'offer' && entry.acceptedAt && (
              <p className="document-meta">
                <span>Angenommen am </span>
                <time dateTime={entry.acceptedAt}>
                  {stamp(entry.acceptedAt)}
                </time>
                {entry.acceptanceChannel && (
                  <span>
                    {' · '}
                    {acceptanceChannelLabels[entry.acceptanceChannel]}
                  </span>
                )}
                {entry.acceptanceNote && (
                  <span>{' · ' + entry.acceptanceNote}</span>
                )}
                {entry.acceptanceFileId && (
                  <>
                    {' · Anhang: '}
                    {entry.acceptanceFileState === 'available' ? (
                      <a
                        href={
                          '/api/v1/library-files/' +
                          entry.acceptanceFileId +
                          '/content'
                        }
                        target="_blank"
                        rel="noreferrer"
                        aria-label={
                          'Anhang ' +
                          (entry.acceptanceFileName ?? 'Datei') +
                          ' öffnen'
                        }
                      >
                        {entry.acceptanceFileName ?? 'Datei'}
                      </a>
                    ) : (
                      <span>
                        {(entry.acceptanceFileName ?? 'Datei') +
                          ' (nicht mehr verfügbar)'}
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
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
              {/* Only a legal next step is offered: no button invents a jump
                  such as final → accepted or a reopened withdrawn offer. */}
              {entry.state === 'final' &&
                entry.kind === 'offer' &&
                entry.offerStatus !== 'withdrawn' && (
                  <>
                    {(entry.offerStatus ?? null) === null && (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy !== ''}
                        aria-label={
                          'Angebot ' +
                          (entry.number ?? '') +
                          ' versendet markieren'
                        }
                        onClick={() =>
                          void changeStatus(entry.id, 'sent', entry.version)
                        }
                      >
                        Versendet markieren
                      </button>
                    )}
                    {entry.offerStatus === 'sent' && (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy !== ''}
                        aria-label={
                          'Angebot ' + (entry.number ?? '') + ' annehmen'
                        }
                        aria-expanded={acceptanceId === entry.id}
                        onClick={() => openAcceptance(entry.id)}
                      >
                        Angenommen
                      </button>
                    )}
                    {confirmWithdrawId === entry.id ? (
                      <>
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={busy !== ''}
                          aria-label={
                            'Angebot ' +
                            (entry.number ?? '') +
                            ' Rückzug bestätigen'
                          }
                          onClick={() =>
                            void changeStatus(
                              entry.id,
                              'withdrawn',
                              entry.version,
                            )
                          }
                        >
                          Ja, zurückziehen
                        </button>
                        <button
                          type="button"
                          className="tertiary-action"
                          disabled={busy !== ''}
                          aria-label={
                            'Angebot ' +
                            (entry.number ?? '') +
                            ' Rückzug abbrechen'
                          }
                          onClick={() => setConfirmWithdrawId('')}
                        >
                          Abbrechen
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy !== ''}
                        aria-label={
                          'Angebot ' + (entry.number ?? '') + ' zurückziehen'
                        }
                        onClick={() => setConfirmWithdrawId(entry.id)}
                      >
                        Zurückziehen
                      </button>
                    )}
                  </>
                )}
            </div>
            {entry.kind === 'offer' &&
              entry.state === 'final' &&
              entry.offerStatus === 'sent' &&
              acceptanceId === entry.id && (
                <form
                  className="offer-draft-editor"
                  aria-label="Annahme erfassen"
                  onSubmit={(event) =>
                    void accept(event, entry.id, entry.version)
                  }
                >
                  <fieldset disabled={busy !== ''}>
                    <legend>Annahme erfassen</legend>
                    <p className="document-hint">
                      Wie hat der Kunde zugesagt? Pflicht ist nur der Kanal;
                      Zeitpunkt, Notiz und Anhang sind freiwillig.
                    </p>
                    <div className="offer-draft-fields">
                      <label>
                        Kanal
                        <select
                          value={acceptanceChannel}
                          onChange={(event) =>
                            setAcceptanceChannel(
                              event.target.value as '' | AcceptanceChannel,
                            )
                          }
                        >
                          <option value="">Bitte wählen</option>
                          {acceptanceChannels.map((channel) => (
                            <option key={channel} value={channel}>
                              {acceptanceChannelLabels[channel]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Zeitpunkt (optional)
                        <input
                          type="datetime-local"
                          value={acceptanceTime}
                          onChange={(event) =>
                            setAcceptanceTime(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Notiz (optional)
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={acceptanceNoteText}
                          onChange={(event) =>
                            setAcceptanceNoteText(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Anhang (optional)
                        <select
                          value={acceptanceFileId}
                          onChange={(event) =>
                            setAcceptanceFileId(event.target.value)
                          }
                        >
                          <option value="">Kein Anhang</option>
                          {libraryFiles
                            .filter((file) => file.state === 'available')
                            .map((file) => (
                              <option key={file.id} value={file.id}>
                                {file.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {libraryState === 'loading' && (
                      <p role="status">Anhänge werden geladen …</p>
                    )}
                    {libraryState === 'failed' && (
                      <p role="alert">
                        Anhänge konnten nicht geladen werden. Die Annahme ist
                        auch ohne Anhang möglich; Eingaben bleiben erhalten.
                      </p>
                    )}
                    <p className="document-hint">
                      Bibliotheksdateien sind hochgeladen und unverprüft: es
                      findet keine Prüfung auf Schadsoftware statt.
                    </p>
                    <div className="document-actions">
                      <button className="primary-action" disabled={busy !== ''}>
                        Annahme speichern
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy !== ''}
                        onClick={closeAcceptance}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
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
                  onSavedMetadata={(metadata) =>
                    setDocuments((current) =>
                      current.map((row) =>
                        row.id === entry.id ? { ...row, ...metadata } : row,
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
      {createUncertain && (
        <div className="reload-warning">
          <p role="alert">
            Der Angebotsstatus ist unklar. Bitte Angebote aktualisieren und
            vorhandene Einträge prüfen, bevor Sie erneut anlegen.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy !== ''}
            onClick={retryLoad}
          >
            Angebote aktualisieren
          </button>
        </div>
      )}
      {initialLoadFailed && (
        <div className="reload-warning">
          <p role="alert">Dateien konnten nicht geladen werden.</p>
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
              Ein Angebot entsteht als Entwurf aus einer Vorlage oder ohne
              Vorlage. Beim Finalisieren erhält es seine Nummer und eine
              unveränderliche PDF.
            </p>
            {offers.length ? (
              rows(offers)
            ) : (
              <p>Noch kein Angebot zu diesem Event.</p>
            )}
            {!templates.length && (
              <p className="document-hint">
                Keine aktive Angebotsvorlage. Sie können auch ohne Vorlage
                starten oder unter Einstellungen → Dokumentvorlagen eine Vorlage
                anlegen.
              </p>
            )}
            {!contactId && (
              <p className="document-hint">
                Für ein Angebot zuerst einen Hauptkontakt zuordnen.
              </p>
            )}
            <form onSubmit={create}>
              <fieldset
                disabled={
                  busy !== '' ||
                  !contactId ||
                  createUncertain ||
                  initialLoadFailed ||
                  reloadWarning
                }
              >
                <legend>Neues Angebot</legend>
                <label>
                  Vorlage
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                  >
                    <option value="">Ohne Vorlage</option>
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
