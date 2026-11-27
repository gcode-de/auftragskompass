import { useEffect, useRef, useState } from 'react';
import { Snackbar } from './Snackbar.js';
import { MailBodyEditor } from './MailBodyEditor.js';
import { registerUnsavedChanges } from './unsaved-changes.js';

// QW3: Bookitup's dated notes - a composer above, the notes newest first with
// time and author below, each removable after a confirmation. The server
// sanitizes every note; the list renders only what it answered.
type Note = {
  id: string;
  bodyHtml: string;
  createdAt: string;
  author: string | null;
  updatedAt?: string | null;
};
const errors: Record<string, string> = {
  empty_note: 'Die Notiz ist leer.',
  invalid_note: 'Die Notiz ist zu lang.',
  not_found: 'Das Event oder die Notiz gibt es nicht mehr.',
  forbidden: 'Keine Berechtigung. Bitte neu anmelden.',
};
function hasText(html: string) {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() !== '';
}
function when(value: string) {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function EventNotes({
  eventId,
  csrfToken,
}: {
  eventId: string;
  csrfToken: string;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null),
    [loadFailed, setLoadFailed] = useState(false),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [composerFocused, setComposerFocused] = useState(false),
    [editingId, setEditingId] = useState(''),
    [editDraft, setEditDraft] = useState('');
  const expanded = composerFocused || Boolean(draft.trim());
  const draftRef = useRef(''),
    editRef = useRef('');
  draftRef.current = draft;
  editRef.current = editingId ? editDraft : '';
  useEffect(
    () =>
      registerUnsavedChanges(
        () => Boolean(draftRef.current.trim()) || hasText(editRef.current),
        true,
      ),
    [],
  );
  async function load() {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/v1/events/' + eventId + '/notes');
      const rows: unknown = response.ok ? await response.json() : null;
      if (!Array.isArray(rows)) throw Error('load');
      setNotes(rows as Note[]);
    } catch {
      setLoadFailed(true);
    }
  }
  useEffect(() => {
    void load();
  }, [eventId]);
  async function write(
    path: string,
    method: 'POST' | 'PUT' | 'DELETE',
    done: string,
    body?: string,
  ) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        '/api/v1/events/' + eventId + '/notes' + path,
        {
          method,
          headers: {
            'x-csrf-token': csrfToken,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body } : {}),
        },
      );
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setMessage(
          errors[error?.error ?? ''] ??
            'Die Notiz konnte nicht gespeichert werden. Bitte erneut versuchen.',
        );
        return false;
      }
      setNotes((await response.json()) as Note[]);
      setMessage(done);
      return true;
    } catch {
      setMessage(
        'Verbindung fehlgeschlagen. Die Notizen bitte neu laden und prüfen.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    const plain = draft.trim();
    if (!plain || busy) return;
    const escaped = plain
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('\n', '<br>');
    if (
      await write(
        '',
        'POST',
        'Notiz hinzugefügt.',
        JSON.stringify({ bodyHtml: '<p>' + escaped + '</p>' }),
      )
    ) {
      setDraft('');
      setComposerFocused(false);
    }
  }
  async function saveEdit(id: string) {
    if (
      await write(
        '/' + id,
        'PUT',
        'Notiz gespeichert.',
        JSON.stringify({ bodyHtml: editDraft }),
      )
    )
      setEditingId('');
  }
  return (
    <div
      className="event-detail-section"
      role="region"
      aria-labelledby="event-panel-notes"
      tabIndex={-1}
    >
      <h4 id="event-panel-notes">Notizen</h4>
      <form
        className="event-note-composer"
        onFocus={() => setComposerFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setComposerFocused(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="sr-only" htmlFor="new-event-note">
          Neue Notiz
        </label>
        <textarea
          id="new-event-note"
          placeholder="Neue Notiz"
          rows={expanded ? 4 : 1}
          value={draft}
          readOnly={busy}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        {expanded && (
          <div className="event-note-actions">
            <button
              type="submit"
              className="primary-action"
              disabled={busy || !draft.trim()}
            >
              Notiz speichern
            </button>
            <button
              type="button"
              className="tertiary-action"
              disabled={busy}
              onClick={() => {
                setDraft('');
                setComposerFocused(false);
              }}
            >
              Abbrechen
            </button>
          </div>
        )}
      </form>
      <Snackbar message={message} />
      {loadFailed ? (
        <div role="alert">
          <p>Die Notizen konnten nicht geladen werden.</p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => void load()}
          >
            Erneut laden
          </button>
        </div>
      ) : !notes ? (
        <p role="status">Notizen werden geladen …</p>
      ) : !notes.length ? (
        <p>Noch keine Notizen.</p>
      ) : (
        <ol className="event-note-list">
          {notes.map((note) => (
            <li key={note.id}>
              <p className="event-note-meta">
                <time dateTime={note.createdAt}>{when(note.createdAt)}</time>
                <span>
                  {note.author ?? 'Übernommen'}
                  {note.updatedAt ? ' · bearbeitet' : ''}
                </span>
                {editingId !== note.id && (
                  <button
                    type="button"
                    className="icon-action tier-quiet-icon"
                    disabled={busy || Boolean(editingId)}
                    aria-label={'Bearbeiten: Notiz vom ' + when(note.createdAt)}
                    title="Notiz bearbeiten"
                    onClick={() => {
                      setEditDraft(note.bodyHtml);
                      setEditingId(note.id);
                    }}
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
                )}
              </p>
              {editingId === note.id ? (
                <div className="event-note-composer">
                  <MailBodyEditor
                    label="Notiz bearbeiten"
                    value={editDraft}
                    onChange={setEditDraft}
                    withPlaceholderPicker={false}
                    disabled={busy}
                  />
                  <div className="event-note-actions">
                    <button
                      type="button"
                      className="primary-action"
                      disabled={busy || !hasText(editDraft)}
                      onClick={() => void saveEdit(note.id)}
                    >
                      Änderungen speichern
                    </button>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy}
                      onClick={() => setEditingId('')}
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="event-note-body"
                  dangerouslySetInnerHTML={{ __html: note.bodyHtml }}
                />
              )}
              <button
                type="button"
                className="tertiary-action danger-link"
                disabled={busy}
                aria-label={
                  'Event-Notiz löschen: Notiz vom ' + when(note.createdAt)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      'Notiz löschen? Sie verschwindet aus der Akte; das Protokoll behält den Vorgang.',
                    )
                  )
                    void write('/' + note.id, 'DELETE', 'Notiz gelöscht.');
                }}
              >
                Event-Notiz löschen
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
