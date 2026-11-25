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
    [message, setMessage] = useState('');
  const draftRef = useRef('');
  draftRef.current = draft;
  useEffect(
    () => registerUnsavedChanges(() => hasText(draftRef.current), true),
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
    method: 'POST' | 'DELETE',
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
    }
  }
  return (
    <div
      className="event-detail-section"
      role="region"
      aria-labelledby="event-panel-notes"
      tabIndex={-1}
    >
      <h4 id="event-panel-notes">Notizen</h4>
      <div className="event-note-composer">
        <MailBodyEditor
          label="Neue Notiz"
          value={draft}
          onChange={setDraft}
          replaceKey={editorKey}
          withPlaceholderPicker={false}
          disabled={busy}
        />
        <button
          type="button"
          className="secondary-action"
          disabled={busy || !hasText(draft)}
          onClick={() => void add()}
        >
          Notiz hinzufügen
        </button>
      </div>
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
                <span>{note.author ?? 'Übernommen'}</span>
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={busy}
                  aria-label={'Löschen: Notiz vom ' + when(note.createdAt)}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Notiz löschen? Sie verschwindet aus der Akte; das Protokoll behält den Vorgang.',
                      )
                    )
                      void write('/' + note.id, 'DELETE', 'Notiz gelöscht.');
                  }}
                >
                  Löschen
                </button>
              </p>
              <div
                className="event-note-body"
                dangerouslySetInnerHTML={{ __html: note.bodyHtml }}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
