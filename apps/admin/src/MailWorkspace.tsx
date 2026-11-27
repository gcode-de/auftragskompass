import { useEffect, useRef, useState } from 'react';
import { MailBodyEditor } from './MailBodyEditor.js';
import { Snackbar } from './Snackbar.js';
import { WebsiteInbox } from './WebsiteInbox.js';
import { mailDeliveryFailureText } from './EventMails.js';
import { useAutoRefresh } from './auto-refresh.js';
import { registerUnsavedChanges } from './unsaved-changes.js';

const folders = [
  ['Posteingang', 'folder=inbox'],
  ['Gesendet', 'folder=sent'],
  ['Entwürfe', 'folder=drafts&stateGroup=draft'],
  ['Geplant', 'folder=drafts&stateGroup=planned'],
  ['Fehlgeschlagen', 'folder=drafts&stateGroup=failed'],
  ['Papierkorb', 'folder=trash'],
] as const;
type Folder = (typeof folders)[number][0];
type Mail = {
  id: string;
  subject: string;
  direction: 'in' | 'out';
  sendState: 'none' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'uncertain';
  from: string;
  to: string;
  sentAt: string | null;
  createdAt: string;
  scheduledFor: string | null;
  sendErrorCode: string | null;
  eventId: string | null;
};
type Detail = {
  revision: string;
  bodyText: string;
  bodyHtml: string | null;
  cc: string;
};
type Draft = {
  to: string;
  subject: string;
  bodyHtml: string;
  revision?: string;
};

function dateText(value: string) {
  return new Date(value).toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
function plainAsHtml(text: string) {
  return (
    '<p>' +
    text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replace(/\r?\n/g, '<br>') +
    '</p>'
  );
}
const discard = 'Ungespeicherte Änderungen an der Mail verwerfen?';

export function MailWorkspace({
  csrfToken,
  onInquiryImported,
}: {
  csrfToken: string;
  onInquiryImported: () => Promise<void>;
}) {
  const [folder, setFolder] = useState<Folder>('Posteingang');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Mail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Mail | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sendAt, setSendAt] = useState('');
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0),
    readSequence = useRef(0);
  const requestId = useRef('');
  const dirty = useRef(false),
    working = useRef(false);
  const backTo = useRef<HTMLButtonElement | null>(null);
  const reader = useRef<HTMLElement>(null);
  const restoreFocusOnClose = useRef(false);

  useEffect(
    () => registerUnsavedChanges(() => dirty.current || working.current, true),
    [],
  );
  useEffect(() => {
    if (selected || draft) reader.current?.focus();
    else if (restoreFocusOnClose.current) {
      restoreFocusOnClose.current = false;
      backTo.current?.focus();
    }
  }, [selected?.id, Boolean(draft)]);

  async function load(target = folder) {
    const current = ++loadSequence.current;
    setLoading(true);
    try {
      const query = folders.find(([value]) => value === target)![1];
      const response = await fetch(
        '/api/v1/mail/messages?' + query + (offset ? '&offset=' + offset : ''),
      );
      if (!response.ok) throw Error('list');
      const next = (await response.json()) as Mail[];
      if (current === loadSequence.current) setRows(next);
    } catch {
      if (current === loadSequence.current)
        setError('Mails konnten nicht geladen werden.');
    } finally {
      if (current === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load(folder);
    return () => {
      ++loadSequence.current;
    };
  }, [folder, offset]);
  useAutoRefresh(
    () => void load(),
    () => working.current || dirty.current,
  );

  function closeReader(restoreFocus = true) {
    if (working.current || (dirty.current && !window.confirm(discard)))
      return false;
    ++readSequence.current;
    dirty.current = false;
    setSelected(null);
    setDetail(null);
    setDraft(null);
    setPlanning(false);
    setSendAt('');
    setError('');
    restoreFocusOnClose.current = restoreFocus;
    return true;
  }
  function switchFolder(value: Folder) {
    if (value === folder || !closeReader(false)) return;
    setRows([]);
    setOffset(0);
    setFolder(value);
  }
  async function open(row: Mail, trigger: HTMLButtonElement) {
    if (!closeReader(false)) return;
    backTo.current = trigger;
    const current = ++readSequence.current;
    setSelected(row);
    try {
      const result = (await request('/messages/' + row.id)) as Detail;
      if (current === readSequence.current) setDetail(result);
    } catch {
      if (current === readSequence.current)
        setError('Der Mailtext konnte nicht geladen werden.');
    }
  }
  function beginEditing(trigger: HTMLButtonElement, newMail = false) {
    if (newMail) {
      if (!closeReader(false)) return;
      backTo.current = trigger;
    }
    requestId.current = crypto.randomUUID();
    setDraft(
      !newMail && detail && selected
        ? {
            subject: selected.subject,
            to: selected.to,
            bodyHtml: detail.bodyHtml ?? plainAsHtml(detail.bodyText),
            revision: detail.revision,
          }
        : { subject: '', to: '', bodyHtml: '' },
    );
  }

  async function request(path: string, method = 'GET', payload?: object) {
    const response = await fetch('/api/v1/mail' + path, {
      method,
      ...(method !== 'GET'
        ? {
            headers: {
              'x-csrf-token': csrfToken,
              ...(payload ? { 'content-type': 'application/json' } : {}),
            },
          }
        : {}),
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (body?.error === 'invalid_send_at')
        throw Error('Bitte eine Uhrzeit in der Zukunft wählen.');
      if (body?.error === 'not_scheduled' || body?.error === 'not_sendable')
        throw Error(
          'Der Versandstatus hat sich geändert. Bitte die Mail erneut öffnen.',
        );
      if (body?.error === 'invalid_recipients')
        throw Error('Bitte eine gültige Empfängeradresse eingeben.');
      if (body?.error === 'invalid_subject')
        throw Error('Bitte einen Betreff eingeben.');
      if (body?.error === 'invalid_account')
        throw Error(
          'Unter Einstellungen → E-Mail bitte ein aktives Versandkonto einrichten.',
        );
      if (body?.error === 'missing_placeholder')
        throw Error(
          'Bitte fehlende Platzhalterwerte in Betreff und Nachricht ergänzen.',
        );
      throw Error(
        'Die Mailaktion konnte nicht abgeschlossen werden. Bitte den aktuellen Stand prüfen.',
      );
    }
    return response.status === 204 ? null : await response.json();
  }

  async function action(run: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Mailaktion fehlgeschlagen.',
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function finish(message: string, to?: Folder) {
    dirty.current = false;
    working.current = false;
    closeReader();
    setNotice(message);
    if (to && to !== folder) {
      setRows([]);
      setOffset(0);
      setFolder(to);
    } else {
      await load();
    }
  }

  function save(send: boolean) {
    if (!draft) return;
    void action(async () => {
      const at = sendAt ? new Date(sendAt).toISOString() : undefined;
      const content = {
        to: draft.to,
        subject: draft.subject,
        bodyHtml: draft.bodyHtml,
      };
      if (send && (!draft.to.trim() || !draft.subject.trim()))
        throw Error('Bitte Empfänger und Betreff eingeben.');
      if (selected) {
        const saved = (await request('/messages/' + selected.id, 'PUT', {
          ...content,
          revision: draft.revision,
        })) as Detail;
        setDraft({ ...draft, revision: saved.revision });
        if (send)
          await request('/messages/' + selected.id + '/send', 'POST', {
            idempotencyKey: requestId.current,
            revision: saved.revision,
            sendAt: at,
          });
      } else {
        await request('/compose', 'POST', {
          ...content,
          requestId: requestId.current,
          ...(send ? { sendAt: at } : { saveAsDraft: true }),
        });
      }
      await finish(
        send ? 'Versand eingeplant.' : 'Entwurf gespeichert.',
        send ? 'Geplant' : 'Entwürfe',
      );
    });
  }

  const failureText =
    selected &&
    (selected.sendState === 'failed' || selected.sendState === 'uncertain')
      ? mailDeliveryFailureText(selected.sendErrorCode)
      : '';
  return (
    <section className="mail-workspace" aria-label="Postfach">
      <nav className="mail-workspace-folders" aria-label="Mailordner">
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={(event) => beginEditing(event.currentTarget, true)}
        >
          Neue Mail
        </button>
        {folders.map(([value]) => (
          <button
            key={value}
            type="button"
            className="nav-action"
            aria-current={value === folder ? 'page' : undefined}
            disabled={busy}
            onClick={() => switchFolder(value)}
          >
            {value}
          </button>
        ))}
      </nav>
      <div
        className="mail-workspace-list"
        data-reading={Boolean(selected || draft)}
      >
        <h2>{folder}</h2>
        {folder === 'Posteingang' && (
          <WebsiteInbox
            mailbox
            csrfToken={csrfToken}
            onImported={onInquiryImported}
          />
        )}
        <button
          type="button"
          className="tertiary-action"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          Mails aktualisieren
        </button>
        {loading && !rows.length && <p role="status">Mails werden geladen …</p>}
        {!loading && !rows.length && !error && (
          <p>Keine Mails in diesem Ordner.</p>
        )}
        {error && !selected && !draft && <p role="alert">{error}</p>}
        <ul className="document-list event-mail-list">
          {rows.map((row) => (
            <li className="event-mail" key={row.id}>
              <button
                type="button"
                className="event-mail-open"
                aria-pressed={selected?.id === row.id}
                disabled={busy}
                onClick={(event) => void open(row, event.currentTarget)}
              >
                <strong>{row.subject || '(ohne Betreff)'}</strong>
                <span className="event-mail-meta">
                  {row.direction === 'in' ? row.from : row.to} ·{' '}
                  {dateText(row.sentAt ?? row.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {(offset > 0 || rows.length === 100) && (
          <div className="form-actions">
            <button
              className="tertiary-action"
              type="button"
              disabled={loading || busy || offset === 0}
              onClick={() => {
                if (closeReader(false)) setOffset(offset - 100);
              }}
            >
              Neuere Mails
            </button>
            <button
              className="tertiary-action"
              type="button"
              disabled={loading || busy || rows.length < 100}
              onClick={() => {
                if (closeReader(false)) setOffset(offset + 100);
              }}
            >
              Ältere Mails
            </button>
          </div>
        )}
      </div>
      {(selected || draft) && (
        <article
          className="event-mail-reader mail-workspace-reader"
          ref={reader}
          tabIndex={-1}
          aria-label="Gewählte Mail"
        >
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={() => closeReader()}
          >
            ← Zurück
          </button>
          {error && <p role="alert">{error}</p>}
          {draft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save(true);
              }}
            >
              <h2>{selected ? 'Mail bearbeiten' : 'Neue Mail'}</h2>
              <fieldset disabled={busy}>
                <label>
                  Empfänger
                  <input
                    value={draft.to}
                    maxLength={4000}
                    onChange={(event) => {
                      dirty.current = true;
                      setDraft({ ...draft, to: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Betreff
                  <input
                    value={draft.subject}
                    maxLength={998}
                    onChange={(event) => {
                      dirty.current = true;
                      setDraft({ ...draft, subject: event.target.value });
                    }}
                  />
                </label>
                <MailBodyEditor
                  label="Nachricht"
                  value={draft.bodyHtml}
                  replaceKey={0}
                  disabled={busy}
                  withPlaceholderPicker={false}
                  onChange={(bodyHtml) => {
                    dirty.current = true;
                    setDraft({ ...draft, bodyHtml });
                  }}
                />
                <label>
                  Senden am (optional)
                  <input
                    type="datetime-local"
                    value={sendAt}
                    onChange={(event) => setSendAt(event.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button className="primary-action" type="submit">
                    {sendAt ? 'Senden planen' : 'Senden'}
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => save(false)}
                  >
                    Als Entwurf speichern
                  </button>
                  <button
                    className="tertiary-action"
                    type="button"
                    onClick={() => closeReader()}
                  >
                    Abbrechen
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            selected && (
              <>
                <h2>{selected.subject || '(ohne Betreff)'}</h2>
                <dl className="event-mail-head">
                  <dt>{selected.direction === 'in' ? 'Von' : 'An'}</dt>
                  <dd>
                    {selected.direction === 'in'
                      ? selected.from
                      : selected.to || '–'}
                  </dd>
                  {detail?.cc && (
                    <>
                      <dt>CC</dt>
                      <dd>{detail.cc}</dd>
                    </>
                  )}
                  <dt>Datum</dt>
                  <dd>{dateText(selected.sentAt ?? selected.createdAt)}</dd>
                </dl>
                {selected.eventId && (
                  <a href={'#event-' + selected.eventId}>Zum Event</a>
                )}
                {failureText && (
                  <p className="event-mail-error">{failureText}</p>
                )}
                {detail && (
                  <div className="event-mail-body">
                    {detail.bodyText || '(ohne Text)'}
                  </div>
                )}
                {selected.scheduledFor && (
                  <p>Geplant für {dateText(selected.scheduledFor)}</p>
                )}
                <div className="form-actions">
                  {detail &&
                    (folder === 'Entwürfe' ||
                      (selected.sendState === 'failed' &&
                        folder === 'Fehlgeschlagen')) && (
                      <button
                        type="button"
                        className="primary-action"
                        disabled={busy}
                        onClick={(event) => beginEditing(event.currentTarget)}
                      >
                        {selected.sendState === 'failed'
                          ? 'Überarbeiten und erneut senden'
                          : 'Entwurf bearbeiten'}
                      </button>
                    )}
                  {selected.scheduledFor && folder === 'Geplant' && (
                    <>
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busy}
                        onClick={() => setPlanning(true)}
                      >
                        Planung ändern
                      </button>
                      <button
                        type="button"
                        className="tertiary-action"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await request(
                              '/messages/' + selected.id + '/unschedule',
                              'POST',
                            );
                            await finish(
                              'Planung aufgehoben. Die Mail liegt in den Entwürfen.',
                              'Entwürfe',
                            );
                          })
                        }
                      >
                        Planung aufheben
                      </button>
                    </>
                  )}
                  {[
                    'Posteingang',
                    'Gesendet',
                    'Entwürfe',
                    'Papierkorb',
                  ].includes(folder) && (
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await request(
                            '/messages/' + selected.id + '/trash',
                            'POST',
                            { restore: folder === 'Papierkorb' },
                          );
                          await finish(
                            folder === 'Papierkorb'
                              ? 'Mail wiederhergestellt.'
                              : 'Mail in den Papierkorb verschoben.',
                          );
                        })
                      }
                    >
                      {folder === 'Papierkorb'
                        ? 'Wiederherstellen'
                        : 'In den Papierkorb'}
                    </button>
                  )}
                </div>
                {planning && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action(async () => {
                        await request(
                          '/messages/' + selected.id + '/reschedule',
                          'POST',
                          { sendAt: new Date(sendAt).toISOString() },
                        );
                        await finish('Versandzeit geändert.');
                      });
                    }}
                  >
                    <label>
                      Neue Versandzeit
                      <input
                        type="datetime-local"
                        value={sendAt}
                        required
                        onChange={(event) => setSendAt(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="primary-action"
                      disabled={busy}
                    >
                      Zeit speichern
                    </button>
                  </form>
                )}
              </>
            )
          )}
        </article>
      )}
      <Snackbar message={notice} />
    </section>
  );
}
