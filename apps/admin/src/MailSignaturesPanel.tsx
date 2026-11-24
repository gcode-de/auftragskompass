import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MailBodyEditor } from './MailBodyEditor.js';

// MAIL-SIG-01a: several named signatures, one of them the standard that new
// mails preselect. The text uses the mail editor; the logo is a building
// block placed anywhere in the text and travels later as an embedded image.

export type MailSignatureRow = {
  id: string;
  name: string;
  bodyHtml: string;
  logoLink: string;
  isDefault: boolean;
  hasLogo: boolean;
  updatedAt: string;
};
type Form = {
  name: string;
  bodyHtml: string;
  logoLink: string;
  isDefault: boolean;
};
const emptyForm: Form = {
  name: '',
  bodyHtml: '',
  logoLink: '',
  isDefault: false,
};

const logoOffer = [
  {
    name: 'logo',
    label: 'Logo',
    meaning: 'Logo dieser Signatur',
    description:
      'Steht an dieser Stelle als eingebettetes Bild in der Mail. Ohne hochgeladenes Logo entfällt die Stelle.',
  },
] as const;
const maxLogoBytes = 512 * 1024;

function failureText(code: string) {
  switch (code) {
    case 'invalid_name':
      return 'Bitte eine Bezeichnung mit höchstens 120 Zeichen eingeben.';
    case 'invalid_content':
      return 'Eine Signatur kennt nur den Baustein Logo. Bitte andere Platzhalter entfernen.';
    case 'invalid_link':
      return 'Der Link des Logos muss mit http:// oder https:// beginnen.';
    case 'invalid_logo':
      return 'Das Logo muss eine PNG- oder JPEG-Datei sein.';
    case 'logo_too_large':
      return 'Das Logo ist größer als 512 KiB.';
    case 'not_found':
      return 'Die Signatur wurde nicht gefunden. Bitte die Liste neu laden.';
    default:
      return 'Die Signatur konnte nicht gespeichert werden (' + code + ').';
  }
}
async function codeOf(reply: Response) {
  try {
    return String(((await reply.json()) as { error?: string }).error ?? '');
  } catch {
    return '';
  }
}

export function MailSignaturesPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<MailSignatureRow[] | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [form, setForm] = useState<Form>(emptyForm),
    [editorReplace, setEditorReplace] = useState(0),
    [logoFile, setLogoFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [loadFailed, setLoadFailed] = useState(false),
    // Bumped after a logo change so the preview reads the new bytes.
    [logoVersion, setLogoVersion] = useState(0);
  const nameField = useRef<HTMLInputElement>(null);
  const write = {
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
  };

  async function reload() {
    setBusy(true);
    try {
      const reply = await fetch('/api/v1/mail-signatures');
      if (!reply.ok) throw Error('load');
      setRows((await reply.json()) as MailSignatureRow[]);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      setError(true);
      setMessage('Die Signaturen konnten nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (editing !== null) nameField.current?.focus();
  }, [editing]);

  function startEdit(row: MailSignatureRow | null) {
    setMessage('');
    setError(false);
    setLogoFile(null);
    setEditing(row ? row.id : 'new');
    setForm(
      row
        ? {
            name: row.name,
            bodyHtml: row.bodyHtml,
            logoLink: row.logoLink,
            isDefault: row.isDefault,
          }
        : { ...emptyForm, isDefault: !rows?.length },
    );
    setEditorReplace((count) => count + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || editing === null) return;
    if (logoFile && logoFile.size > maxLogoBytes) {
      setError(true);
      setMessage(failureText('logo_too_large'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const reply = await fetch(
        '/api/v1/mail-signatures' + (editing === 'new' ? '' : '/' + editing),
        {
          method: editing === 'new' ? 'POST' : 'PUT',
          headers: write,
          body: JSON.stringify(form),
        },
      );
      if (!reply.ok) {
        setError(true);
        setMessage(failureText(await codeOf(reply)));
        return;
      }
      const saved = (await reply.json()) as MailSignatureRow;
      // The text is saved; a logo is its own upload against the stored row.
      if (logoFile) {
        const upload = await fetch(
          '/api/v1/mail-signatures/' + saved.id + '/logo',
          {
            method: 'PUT',
            headers: {
              'content-type': logoFile.type,
              'x-csrf-token': csrfToken,
            },
            body: logoFile,
          },
        );
        if (!upload.ok) {
          setEditing(saved.id);
          setError(true);
          setMessage(
            'Text gespeichert, Logo nicht: ' +
              failureText(await codeOf(upload)),
          );
          await reload();
          return;
        }
        setLogoVersion((count) => count + 1);
      }
      setError(false);
      setEditing(null);
      setLogoFile(null);
      setMessage('Signatur gespeichert.');
      await reload();
    } catch {
      setError(true);
      setMessage(
        'Der Speicherstand ist unklar. Bitte die Liste prüfen, bevor du erneut speicherst.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo(id: string) {
    if (busy || !window.confirm('Logo dieser Signatur entfernen?')) return;
    setBusy(true);
    try {
      const reply = await fetch('/api/v1/mail-signatures/' + id + '/logo', {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      setError(!reply.ok);
      setMessage(
        reply.ok ? 'Logo entfernt.' : failureText(await codeOf(reply)),
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: MailSignatureRow) {
    if (busy || !window.confirm(`Signatur „${row.name}“ löschen?`)) return;
    setBusy(true);
    try {
      const reply = await fetch('/api/v1/mail-signatures/' + row.id, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      setError(!reply.ok);
      setMessage(
        reply.ok ? 'Signatur gelöscht.' : failureText(await codeOf(reply)),
      );
      if (editing === row.id) setEditing(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const current = rows?.find((row) => row.id === editing) ?? null;
  return (
    <section aria-label="E-Mail-Signaturen" aria-busy={busy}>
      <h2>E-Mail-Signaturen</h2>
      <p>
        Die Standardsignatur ist in jeder neuen Mail vorausgewählt und lässt
        sich dort durch eine andere oder „Keine Signatur“ ersetzen.
      </p>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {rows === null ? (
        loadFailed && (
          <button
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={() => void reload()}
          >
            Signaturen neu laden
          </button>
        )
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="master-data-list">
              {rows.map((row) => (
                <li key={row.id}>
                  <span>
                    {row.name}
                    {row.isDefault && ' (Standard)'}
                    {row.hasLogo && ' · mit Logo'}
                  </span>{' '}
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy || editing === row.id}
                    onClick={() => startEdit(row)}
                  >
                    {row.name} bearbeiten
                  </button>{' '}
                  <button
                    className="tertiary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(row)}
                  >
                    {row.name} löschen
                  </button>
                </li>
              ))}
            </ul>
          )}
          {editing === null ? (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={() => startEdit(null)}
            >
              Signatur anlegen
            </button>
          ) : (
            <form onSubmit={(event) => void save(event)}>
              <h3>
                {editing === 'new' ? 'Signatur anlegen' : 'Signatur bearbeiten'}
              </h3>
              <label>
                Bezeichnung
                <input
                  ref={nameField}
                  type="text"
                  maxLength={120}
                  required
                  value={form.name}
                  disabled={busy}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <div className="mail-editor-field">
                <span className="mail-editor-label">Signaturtext</span>
                <MailBodyEditor
                  value={form.bodyHtml}
                  onChange={(bodyHtml) =>
                    setForm((value) => ({ ...value, bodyHtml }))
                  }
                  disabled={busy}
                  label="Signaturtext"
                  replaceKey={editorReplace}
                  placeholderOffers={logoOffer}
                />
              </div>
              <fieldset className="signature-logo">
                <legend>Logo</legend>
                {current?.hasLogo && (
                  <p>
                    <img
                      className="signature-logo-preview"
                      src={`/api/v1/mail-signatures/${current.id}/logo?v=${logoVersion}`}
                      alt={'Aktuelles Logo von ' + current.name}
                    />
                    <button
                      className="tertiary-action"
                      type="button"
                      disabled={busy}
                      onClick={() => void removeLogo(current.id)}
                    >
                      Logo entfernen
                    </button>
                  </p>
                )}
                <label>
                  {current?.hasLogo ? 'Logo ersetzen' : 'Logo hochladen'} (PNG
                  oder JPEG, höchstens 512 KiB)
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={busy}
                    onChange={(event) =>
                      setLogoFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
                <label>
                  Logo verlinkt auf (optional)
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={2000}
                    placeholder="https://"
                    value={form.logoLink}
                    disabled={busy}
                    onChange={(event) =>
                      setForm({ ...form, logoLink: event.target.value })
                    }
                  />
                </label>
              </fieldset>
              <label className="signature-default">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  disabled={busy}
                  onChange={(event) =>
                    setForm({ ...form, isDefault: event.target.checked })
                  }
                />
                Als Standardsignatur verwenden
              </label>
              <div className="document-actions">
                <button className="primary-action" disabled={busy}>
                  Signatur speichern
                </button>
                <button
                  className="tertiary-action"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Abbrechen
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
