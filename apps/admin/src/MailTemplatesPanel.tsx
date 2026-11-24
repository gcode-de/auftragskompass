import { useEffect, useState, type FormEvent } from 'react';
import { MailBodyEditor } from './MailBodyEditor.js';

// MAIL-TPL-01b: mail templates in the settings. The panel mirrors the sending
// account panel; the body editor and its placeholder picker are the shared
// ones of the mail editor (docs/mail-templates.md).
type MailTemplateSummary = {
  id: string;
  name: string;
  subject: string;
  state: 'active' | 'inactive' | 'archived';
  version: number;
};
type TemplatePreview = {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  missing: string[];
};
// MAIL-TPL-01e: one selectable library file for the standard attachments.
type LibraryFile = {
  id: string;
  displayName: string;
  mediaType: string;
  sizeBytes: number;
  state: string;
};

const stateLabels = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
  archived: 'Archiviert',
} as const;

function errorText(code: string | undefined) {
  switch (code) {
    case 'invalid_name':
      return 'Der Name ist nicht gültig.';
    case 'invalid_subject':
      return 'Der Betreff ist nicht gültig. Erlaubt sind einzeilige Texte ohne Steuerzeichen.';
    case 'invalid_body':
      return 'Der Text ist zu lang.';
    case 'invalid_state':
      return 'Der Zustand ist nicht gültig.';
    case 'invalid_content':
      return 'Unbekannter Platzhalter. Nur die Platzhalter aus der Auswahl verwenden; die Eingaben bleiben erhalten.';
    case 'attachment_unavailable':
      return 'Eine ausgewählte Datei ist nicht mehr verfügbar. Bitte die Anhänge prüfen.';
    case 'conflict':
      return 'Die Vorlage wurde inzwischen geändert. Bitte neu laden und erneut bearbeiten.';
    case 'not_found':
      return 'Die Vorlage wurde nicht gefunden.';
    default:
      return 'Speichern nicht bestätigt. Zustand prüfen, bevor du erneut speicherst.';
  }
}

const emptyForm = {
  name: '',
  subject: '',
  bodyHtml: '',
  state: 'active' as 'active' | 'inactive' | 'archived',
};

export function MailTemplatesPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<MailTemplateSummary[] | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [version, setVersion] = useState(1);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewState, setPreviewState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [libraryFiles, setLibraryFiles] = useState<LibraryFile[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);

  async function load(): Promise<MailTemplateSummary[]> {
    const response = await fetch('/api/v1/mail-templates');
    if (!response.ok) throw Error('load');
    return (await response.json()) as MailTemplateSummary[];
  }

  useEffect(() => {
    let active = true;
    // The chooser lists the available library files; a failed list leaves
    // the chooser empty and never invents an entry.
    void fetch('/api/v1/library-files')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const files = (await response.json()) as LibraryFile[];
        if (active) setLibraryFiles(files);
      })
      .catch(() => {
        if (active) setLibraryFiles([]);
      });
    void load()
      .then((result) => {
        if (active) setRows(result);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage('E-Mail-Vorlagen konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // MAIL-UX-02: bump to let the editor adopt an externally replaced body.
  const [editorReplace, setEditorReplace] = useState(0);
  function startEdit(summary: MailTemplateSummary) {
    setEditing(summary.id);
    setVersion(summary.version);
    setEditorReplace((count) => count + 1);
    setForm({
      name: summary.name,
      subject: summary.subject,
      // The body travels only in the detail; it is fetched on open.
      bodyHtml: '',
      state: summary.state,
    });
    setMessage('');
    setError(false);
    setPreview(null);
    setPreviewState('idle');
    setBusy(true);
    void fetch(`/api/v1/mail-templates/${summary.id}`)
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const detail = (await response.json()) as {
          bodyHtml: string;
          version: number;
          attachments: { libraryFileId: string }[];
        };
        setForm((current) => ({ ...current, bodyHtml: detail.bodyHtml }));
        setEditorReplace((count) => count + 1);
        setVersion(detail.version);
        setAttachmentIds(
          (detail.attachments ?? []).map((entry) => entry.libraryFileId),
        );
      })
      .catch(() => {
        setError(true);
        setMessage('Die Vorlage konnte nicht geladen werden.');
        setEditing(null);
      })
      .finally(() => setBusy(false));
  }

  function createTemplate() {
    setEditing('new');
    setVersion(1);
    setForm(emptyForm);
    setAttachmentIds([]);
    setMessage('');
    setError(false);
    setPreview(null);
    setPreviewState('idle');
  }

  // Abbrechen leaves the form; nothing is written and the list returns.
  function cancel() {
    setEditing(null);
    setMessage('');
    setError(false);
    setPreview(null);
    setPreviewState('idle');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError(false);
    const updating = editing !== null && editing !== 'new';
    try {
      const response = await fetch(
        updating
          ? `/api/v1/mail-templates/${editing}`
          : '/api/v1/mail-templates',
        {
          method: updating ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            name: form.name.trim(),
            subject: form.subject,
            bodyHtml: form.bodyHtml,
            state: form.state,
            // The editor knows the full set: an explicit list replaces the
            // stored attachments deterministically.
            attachmentFileIds: attachmentIds,
            ...(updating ? { version } : {}),
          }),
        },
      );
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(true);
        setMessage(errorText(answer.error));
        return;
      }
      const saved = (await response.json()) as MailTemplateSummary;
      setEditing(saved.id);
      setVersion(saved.version);
      try {
        setRows(await load());
      } catch {
        // The save is confirmed; the list is not. Keep the form as it is.
        setError(true);
        setMessage(
          'Gespeichert, aber die Liste konnte nicht neu geladen werden.',
        );
        return;
      }
      setMessage('E-Mail-Vorlage gespeichert.');
    } catch {
      setError(true);
      setMessage(
        'Speichern nicht bestätigt. Zustand prüfen, bevor du erneut speicherst.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      setRows(await load());
    } catch {
      setError(true);
      setMessage('E-Mail-Vorlagen konnten nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }

  // The read-only synthetic preview: the same assembly as the server, with
  // the documented example values and no write of any kind.
  async function loadPreview() {
    if (previewState === 'loading') return;
    setPreviewState('loading');
    setPreview(null);
    try {
      const response = await fetch('/api/v1/mail-templates/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          subject: form.subject,
          bodyHtml: form.bodyHtml || '<p></p>',
        }),
      });
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(true);
        setMessage(errorText(answer.error));
        setPreviewState('error');
        return;
      }
      setPreview((await response.json()) as TemplatePreview);
      setPreviewState('ready');
    } catch {
      setError(true);
      setMessage('Die Vorschau konnte nicht geladen werden.');
      setPreviewState('error');
    }
  }

  const availableFiles = libraryFiles.filter(
    (file) => file.state === 'available',
  );
  const unavailableFiles = libraryFiles.filter(
    (file) => attachmentIds.includes(file.id) && file.state !== 'available',
  );

  return (
    <section aria-label="E-Mail-Vorlagen" aria-busy={busy}>
      <h2>E-Mail-Vorlagen</h2>
      <p>
        Hier werden wiederverwendbare E-Mail-Vorlagen gepflegt – Betreff und
        formatierter Text mit den Platzhaltern des Mail-Editors. Das Speichern
        versendet keine E-Mail.
      </p>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {rows === null ? (
        <>
          {busy && <p>Lade E-Mail-Vorlagen …</p>}
          {error && (
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => void reload()}
            >
              Vorlagen neu laden
            </button>
          )}
        </>
      ) : (
        <>
          {rows.length > 0 && (
            <>
              <h3>Vorlagen</h3>
              <ul className="master-data-list">
                {rows.map((row) => (
                  <li key={row.id}>
                    <span>
                      {row.name} ({stateLabels[row.state]})
                    </span>{' '}
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={busy || editing === row.id}
                      onClick={() => startEdit(row)}
                    >
                      {row.name} bearbeiten
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {editing === null ? (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={createTemplate}
            >
              E-Mail-Vorlage anlegen
            </button>
          ) : (
            <form onSubmit={(event) => void save(event)}>
              <h3>
                {editing === 'new'
                  ? 'E-Mail-Vorlage anlegen'
                  : 'E-Mail-Vorlage bearbeiten'}
              </h3>
              <label>
                Name
                <input
                  type="text"
                  maxLength={120}
                  required
                  value={form.name}
                  disabled={busy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Betreff
                <input
                  type="text"
                  maxLength={998}
                  value={form.subject}
                  disabled={busy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      subject: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Zustand
                <select
                  value={form.state}
                  disabled={busy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      state: event.target.value as typeof form.state,
                    }))
                  }
                >
                  <option value="active">Aktiv</option>
                  <option value="inactive">Inaktiv</option>
                  <option value="archived">Archiviert</option>
                </select>
              </label>
              <div className="mail-editor-field">
                <span className="mail-editor-label">Text (optional)</span>
                <MailBodyEditor
                  value={form.bodyHtml}
                  onChange={(bodyHtml) =>
                    setForm((current) => ({ ...current, bodyHtml }))
                  }
                  disabled={busy}
                  label="Text (optional)"
                  replaceKey={editorReplace}
                />
              </div>
              {/* MAIL-TPL-01e: the standard attachments are chosen from the
              available library files; a file that became unavailable stays
              named and removable instead of vanishing silently. */}
              <fieldset className="mail-attachment-chooser">
                <legend>Standard-Anhänge</legend>
                <p className="document-hint">
                  Ausgewählte Dateien der Bibliothek reisen mit jeder Mail aus
                  dieser Vorlage; beim Versand sind sie sichtbar und einzeln
                  entfernbar.
                </p>
                {availableFiles.length === 0 && (
                  <p>Keine verfügbaren Dateien in der Bibliothek.</p>
                )}
                {availableFiles.map((file) => (
                  <label key={file.id}>
                    <input
                      type="checkbox"
                      checked={attachmentIds.includes(file.id)}
                      disabled={busy}
                      onChange={(event) =>
                        setAttachmentIds((current) =>
                          event.target.checked
                            ? [...current, file.id]
                            : current.filter((id) => id !== file.id),
                        )
                      }
                    />
                    {file.displayName} ({file.mediaType}, {file.sizeBytes}{' '}
                    Bytes)
                  </label>
                ))}
                {unavailableFiles.map((file) => (
                  <p role="status" key={file.id}>
                    {file.displayName} ist nicht mehr verfügbar und kann nicht
                    gespeichert werden.{' '}
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy}
                      onClick={() =>
                        setAttachmentIds((current) =>
                          current.filter((id) => id !== file.id),
                        )
                      }
                    >
                      {file.displayName} entfernen
                    </button>
                  </p>
                ))}
              </fieldset>
              <div className="document-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy}
                  onClick={() => void loadPreview()}
                >
                  Vorschau anzeigen
                </button>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={busy}
                >
                  Vorlage speichern
                </button>
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={busy}
                  onClick={cancel}
                >
                  Abbrechen
                </button>
              </div>
              {previewState === 'loading' && (
                <p role="status">Vorschau wird geladen …</p>
              )}
              {preview && (
                <div className="mail-preview">
                  <p className="document-hint">
                    {'Beispielvorschau – Betreff: ' + preview.subject}
                  </p>
                  <div className="mail-preview-body">
                    {preview.bodyHtml ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
                      />
                    ) : (
                      <p>{preview.bodyText}</p>
                    )}
                  </div>
                  {preview.missing.length > 0 && (
                    <p role="status">
                      {'Ohne Beispielwert bleiben sichtbar: ' +
                        preview.missing
                          .map((name) => `{{${name}}}`)
                          .join(', ') +
                        '.'}
                    </p>
                  )}
                </div>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
