import { useEffect, useRef, useState } from 'react';
import { useAutoRefresh } from './auto-refresh.js';

// MAIL-STATUS-01: the real outcome of every send order. The send dialogs only
// confirm that the order exists; the worker decides later, so this list reads
// the stored state and keeps asking while a mail is still on its way.

type MailRow = {
  id: string;
  direction: 'in' | 'out';
  sendState: 'none' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'uncertain';
  subject: string;
  to: string;
  eventId: string | null;
  createdAt: string;
  sentAt: string | null;
  sendErrorCode: string | null;
  // QW5: a planned order's time; null when it is due or already gone.
  scheduledFor?: string | null;
};

// The reading pane shows the stored plain text only; the HTML part of a mail
// is never rendered here.
type MailReading = { id: string; bodyText: string; cc: string };

const pollMs = 3000,
  // About two minutes; a longer run is shown as such instead of polling on.
  maxPolls = 40;

const stateLabels: Record<MailRow['sendState'], string> = {
  // QW5: an outgoing message without an order is a withdrawn planned send.
  none: 'Nicht gesendet',
  scheduled: 'In der Warteschlange',
  sending: 'Wird gesendet',
  sent: 'Gesendet',
  failed: 'Nicht gesendet',
  uncertain: 'Zustellung unklar',
};

/** The worker's failure codes, worded as the operator's next step. */
export function mailDeliveryFailureText(code: string | null): string {
  switch (code) {
    case 'attachment_unavailable':
      return 'Ein Anhang war beim Versand nicht lesbar. Bitte den Betrieb prüfen (Dokumentablage des Workers).';
    case 'provider_auth_failed':
      return 'Der Mailserver hat die Anmeldung abgelehnt. Bitte Benutzername und Passwort des E-Mail-Kontos prüfen.';
    case 'provider_recipient_rejected':
      return 'Der Mailserver hat die Empfängeradresse abgelehnt. Bitte die Adresse prüfen.';
    case 'provider_rejected':
      return 'Der Mailserver hat die Mail abgelehnt.';
    case 'provider_timeout':
      return 'Der Mailserver war nicht erreichbar.';
    case 'provider_tls_required':
      return 'Der Mailserver verlangt eine verschlüsselte Verbindung. Bitte die Sicherheitseinstellung des E-Mail-Kontos prüfen.';
    case 'provider_missing':
      return 'Es ist kein aktives E-Mail-Konto eingerichtet.';
    case 'encryption_unavailable':
      return 'Das Passwort des E-Mail-Kontos ist nicht lesbar. Bitte den Betrieb prüfen.';
    case 'provider_uncertain':
      return 'Die Verbindung brach während des Versands ab. Bitte im Postfach unter „Gesendet“ prüfen, ob die Mail angekommen ist.';
    case null:
      return 'Ohne Fehlercode.';
    default:
      return 'Fehlercode: ' + code;
  }
}

const inFlight = (row: MailRow) =>
  row.sendState === 'scheduled' || row.sendState === 'sending';
// QW5: a planned mail waits on purpose - the list does not poll for it.
const planned = (row: MailRow) =>
  row.sendState === 'scheduled' && Boolean(row.scheduledFor);

// UI-PARITY-02: Bookitup's mail folders that exist here, derived from the
// stored send state; an inbox, drafts and a trash do not exist yet.
const folders = [
  { value: 'all', label: 'Alle', match: () => true },
  { value: 'queued', label: 'Geplant', match: inFlight },
  {
    value: 'failed',
    label: 'Fehlgeschlagen',
    match: (row: MailRow) =>
      row.sendState === 'failed' || row.sendState === 'uncertain',
  },
  {
    value: 'sent',
    label: 'Gesendet',
    match: (row: MailRow) => row.sendState === 'sent',
  },
] as const;

function dateText(value: string) {
  return new Date(value).toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function EventMails({
  eventId,
  csrfToken,
  active,
  revision,
}: {
  eventId: string;
  csrfToken: string;
  active: boolean;
  // Raised by the send dialogs so a new order shows up at once.
  revision: number;
}) {
  const sequence = useRef(0),
    polls = useRef(0),
    previous = useRef(new Map<string, MailRow['sendState']>());
  const [rows, setRows] = useState<MailRow[]>([]),
    [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState(''),
    [alert, setAlert] = useState(''),
    // UI-BKP-07: the reading pane - the chosen mail and its stored text.
    [selected, setSelected] = useState(''),
    [reading, setReading] = useState<MailReading | null>(null),
    [readFailed, setReadFailed] = useState(false);
  const readSequence = useRef(0);

  async function open(id: string) {
    const current = ++readSequence.current;
    setSelected(id);
    setReading(null);
    setReadFailed(false);
    try {
      const reply = await fetch('/api/v1/mail/messages/' + id);
      if (!reply.ok) throw Error('read');
      const body = (await reply.json()) as Partial<MailReading>;
      if (typeof body.bodyText !== 'string' || typeof body.cc !== 'string')
        throw Error('shape');
      if (current === readSequence.current)
        setReading({ id, bodyText: body.bodyText, cc: body.cc });
    } catch {
      if (current === readSequence.current) setReadFailed(true);
    }
  }

  async function load() {
    const current = ++sequence.current;
    try {
      const reply = await fetch(
        '/api/v1/mail/messages?eventId=' + encodeURIComponent(eventId),
      );
      if (!reply.ok) throw Error('load');
      const next = ((await reply.json()) as MailRow[]).filter(
        (row) => row.direction === 'out',
      );
      if (current !== sequence.current) return;
      // A mail that settles while the list is open is announced once.
      for (const row of next) {
        const before = previous.current.get(row.id);
        if (!before || !['scheduled', 'sending'].includes(before)) continue;
        const name = row.subject.trim() || 'ohne Betreff';
        if (row.sendState === 'sent')
          setMessage(`Mail „${name}“ wurde gesendet.`);
        if (row.sendState === 'failed' || row.sendState === 'uncertain')
          setAlert(
            `Mail „${name}“: ${stateLabels[row.sendState]}. Die Ursache steht in der Liste.`,
          );
      }
      previous.current = new Map(next.map((row) => [row.id, row.sendState]));
      setRows(next);
      setFailed(false);
    } catch {
      if (current === sequence.current) setFailed(true);
    } finally {
      if (current === sequence.current) setLoaded(true);
    }
  }

  useEffect(() => {
    if (!active) return;
    polls.current = 0;
    void load();
  }, [active, eventId, revision]);

  const waiting = rows.some((row) => inFlight(row) && !planned(row));
  const [folder, setFolder] =
    useState<(typeof folders)[number]['value']>('all');
  const shown = rows.filter(
    folders.find((entry) => entry.value === folder)!.match,
  );
  useEffect(() => {
    if (!active || !waiting || polls.current >= maxPolls) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      void load();
    }, pollMs);
    return () => window.clearTimeout(timer);
  }, [active, waiting, rows]);

  useAutoRefresh(
    () => {
      if (!active) return;
      polls.current = 0;
      void load();
    },
    () => busy !== '',
  );

  async function unschedule(row: MailRow) {
    if (busy) return;
    setBusy(row.id);
    setMessage('');
    setAlert('');
    try {
      const reply = await fetch(
        '/api/v1/mail/messages/' + row.id + '/unschedule',
        { method: 'POST', headers: { 'x-csrf-token': csrfToken } },
      );
      if (!reply.ok) {
        setAlert(
          'Die Planung konnte nicht aufgehoben werden; die Mail ist vielleicht schon unterwegs. Bitte die Liste aktualisieren.',
        );
        return;
      }
      setMessage('Planung aufgehoben. Die Mail wird nicht gesendet.');
      await load();
    } catch {
      setAlert(
        'Der Ausgang ist unklar. Bitte die Liste aktualisieren, bevor du es erneut versuchst.',
      );
    } finally {
      setBusy('');
    }
  }

  async function resend(row: MailRow) {
    if (busy) return;
    setBusy(row.id);
    setMessage('');
    setAlert('');
    try {
      const reply = await fetch('/api/v1/mail/messages/' + row.id + '/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      if (!reply.ok) {
        setAlert(
          'Die Mail konnte nicht erneut in die Warteschlange gestellt werden. Bitte die Liste aktualisieren.',
        );
        return;
      }
      setMessage('Mail erneut in der Warteschlange.');
      polls.current = 0;
      await load();
    } catch {
      setAlert(
        'Der Ausgang ist unklar. Bitte die Liste aktualisieren, bevor du es erneut versuchst.',
      );
    } finally {
      setBusy('');
    }
  }

  return (
    <section
      className="document-card event-mails"
      aria-labelledby="event-mails-heading"
    >
      <h4 id="event-mails-heading">Ausgehende Mails</h4>
      <div className="event-mail-folders" role="group" aria-label="Ordner">
        {folders.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="nav-action"
            aria-pressed={folder === entry.value}
            onClick={() => setFolder(entry.value)}
          >
            {entry.label} ({rows.filter(entry.match).length})
          </button>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
      {alert && <p role="alert">{alert}</p>}
      {failed && (
        <p role="alert">
          Mails konnten nicht geladen werden. Der letzte Stand bleibt sichtbar.
        </p>
      )}
      {waiting && polls.current >= maxPolls && (
        <p className="document-card-hint">
          Der Versand dauert länger als üblich. „Mails aktualisieren“ lädt den
          aktuellen Stand.
        </p>
      )}
      {loaded && !failed && !rows.length && (
        <p className="document-card-hint">
          Noch keine Mail zu diesem Event gesendet.
        </p>
      )}
      {rows.length > 0 && !shown.length && (
        <p className="document-card-hint">Keine Mail in diesem Ordner.</p>
      )}
      <div className="event-mail-panes">
        {shown.length > 0 && (
          <ul className="document-list event-mail-list">
            {shown.map((row) => (
              <li
                key={row.id}
                className="event-mail"
                data-state={row.sendState}
              >
                <div className="document-row">
                  <button
                    type="button"
                    className="event-mail-open"
                    aria-pressed={selected === row.id}
                    onClick={() => void open(row.id)}
                  >
                    <strong>{row.subject.trim() || '(ohne Betreff)'}</strong>
                    <span className="event-mail-meta">
                      an {row.to} · {dateText(row.sentAt ?? row.createdAt)}
                    </span>
                  </button>
                  <strong className="event-mail-state">
                    {planned(row)
                      ? 'Geplant für ' + dateText(row.scheduledFor!)
                      : stateLabels[row.sendState]}
                  </strong>
                </div>
                {(row.sendState === 'failed' ||
                  row.sendState === 'uncertain') && (
                  <p className="event-mail-error">
                    {mailDeliveryFailureText(row.sendErrorCode)}
                  </p>
                )}
                {(row.sendState === 'failed' || row.sendState === 'none') && (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy !== ''}
                    onClick={() => void resend(row)}
                  >
                    {busy === row.id
                      ? 'Wird eingereiht …'
                      : row.sendState === 'none'
                        ? 'Jetzt senden'
                        : 'Erneut senden'}
                  </button>
                )}
                {planned(row) && (
                  <button
                    type="button"
                    className="tertiary-action"
                    disabled={busy !== ''}
                    onClick={() => void unschedule(row)}
                  >
                    Planung aufheben
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* UI-BKP-07: Bookitup's reading pane beside the list. */}
        <article className="event-mail-reader" aria-label="Gewählte Mail">
          {(() => {
            const row = rows.find((entry) => entry.id === selected);
            if (!row)
              return (
                <p className="document-card-hint">
                  Wähle eine Mail aus, um sie hier zu lesen.
                </p>
              );
            return (
              <>
                <h5>{row.subject.trim() || '(ohne Betreff)'}</h5>
                <dl className="event-mail-head">
                  <dt>An</dt>
                  <dd>{row.to}</dd>
                  {reading?.id === row.id && reading.cc && (
                    <>
                      <dt>CC</dt>
                      <dd>{reading.cc}</dd>
                    </>
                  )}
                  <dt>Datum</dt>
                  <dd>{dateText(row.sentAt ?? row.createdAt)}</dd>
                  <dt>Status</dt>
                  <dd>
                    {planned(row)
                      ? 'Geplant für ' + dateText(row.scheduledFor!)
                      : stateLabels[row.sendState]}
                  </dd>
                </dl>
                {readFailed ? (
                  <p role="alert">
                    Der Mailtext konnte nicht geladen werden.{' '}
                    <button
                      type="button"
                      className="tertiary-action"
                      onClick={() => void open(row.id)}
                    >
                      Erneut laden
                    </button>
                  </p>
                ) : reading?.id === row.id ? (
                  <div className="event-mail-body">
                    {reading.bodyText.trim() || '(ohne Text)'}
                  </div>
                ) : (
                  <p role="status">Mailtext wird geladen …</p>
                )}
              </>
            );
          })()}
        </article>
      </div>
      <button
        type="button"
        className="tertiary-action"
        disabled={busy !== ''}
        onClick={() => {
          polls.current = 0;
          void load();
        }}
      >
        Mails aktualisieren
      </button>
    </section>
  );
}

/**
 * MAIL-STATUS-01: a failure in the worker happens after the dialog closed,
 * so every page names the mails that did not go out and links their event.
 */
export function UndeliveredMailNotice() {
  const [rows, setRows] = useState<MailRow[]>([]);
  async function load() {
    try {
      const reply = await fetch('/api/v1/mail/messages');
      if (!reply.ok) return;
      setRows(
        ((await reply.json()) as MailRow[]).filter(
          (row) =>
            row.direction === 'out' &&
            (row.sendState === 'failed' || row.sendState === 'uncertain'),
        ),
      );
    } catch {
      // shortcut: a failed read keeps the last notice; the event list names its own error.
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useAutoRefresh(() => void load());
  if (!rows.length) return null;
  return (
    <section
      className="undelivered-mails"
      aria-labelledby="undelivered-mails-heading"
    >
      <h2 id="undelivered-mails-heading">
        {rows.length === 1
          ? '1 Mail wurde nicht zugestellt'
          : `${rows.length} Mails wurden nicht zugestellt`}
      </h2>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.eventId ? (
              <a href={'#event-' + row.eventId}>
                {row.subject.trim() || '(ohne Betreff)'}
              </a>
            ) : (
              <span>{row.subject.trim() || '(ohne Betreff)'}</span>
            )}{' '}
            · {stateLabels[row.sendState]}:{' '}
            {mailDeliveryFailureText(row.sendErrorCode)}
          </li>
        ))}
      </ul>
    </section>
  );
}
