import { useEffect, useRef, useState } from 'react';
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
    [editorKey, setEditorKey] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    // UI-BKP-04: Bookitup opens the composer from the card's plus and edits
    // one note in place.
    [composing, setComposing] = useState(false),
    [editingId, setEditingId] = useState(''),
    [editDraft, setEditDraft] = useState('');
  const draftRef = useRef(''),
    editRef = useRef('');
  draftRef.current = draft;
  editRef.current = editingId ? editDraft : '';
  useEffect(
    () =>
      registerUnsavedChanges(
        () => hasText(draftRef.current) || hasText(editRef.current),
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
    if (
      await write(
        '',
        'POST',
        'Notiz hinzugefügt.',
        JSON.stringify({ bodyHtml: draft }),
      )
    ) {
      setDraft('');
      setEditorKey((key) => key + 1);
      setComposing(false);
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
      <div className="card-head">
        <h4 id="event-panel-notes">Notizen</h4>
        <button
          type="button"
          className="icon-action tier-quiet-icon"
          aria-label="Notiz hinzufügen"
          title="Notiz hinzufügen"
          aria-expanded={composing}
          disabled={busy}
          onClick={() => setComposing((open) => !open)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {composing && (
        <div className="event-note-composer">
          <MailBodyEditor
            label="Neue Notiz"
            value={draft}
            onChange={setDraft}
            replaceKey={editorKey}
            withPlaceholderPicker={false}
            disabled={busy}
          />
          <div className="event-note-actions">
            <button
              type="button"
              className="primary-action"
              disabled={busy || !hasText(draft)}
              onClick={() => void add()}
            >
              Notiz speichern
            </button>
            <button
              type="button"
              className="tertiary-action"
              disabled={busy}
              onClick={() => {
                setComposing(false);
                setDraft('');
                setEditorKey((key) => key + 1);
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <p role="status">{message}</p>
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
