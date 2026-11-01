import { useEffect, useRef, useState } from 'react';
import { registerUnsavedChanges } from './unsaved-changes.js';
type Entry = {
  id: string;
  name: string;
  position: number;
  state: string;
  version: number;
};
const empty = { name: '', position: 0, state: 'active' };
export function MasterDataPanel({
  kind,
  title,
  csrfToken,
  primary = true,
}: {
  kind: string;
  title: string;
  csrfToken: string;
  /** H036: the settings entry stacks several catalogs, so only the first one
   * carries that page's single dominant save action. */
  primary?: boolean;
}) {
  const editor = useRef<HTMLDetailsElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [rows, setRows] = useState<Entry[]>([]),
    [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [reloadFailed, setReloadFailed] = useState(false);
  const baseline = editing ?? empty;
  const dirty =
    draft.name !== baseline.name ||
    draft.position !== baseline.position ||
    draft.state !== baseline.state;
  useEffect(() => registerUnsavedChanges(() => dirty), [dirty]);
  const url = '/api/v1/master-data/' + kind;
  async function refresh() {
    const response = await fetch(url);
    if (!response.ok) throw new Error('load');
    setRows((await response.json()) as Entry[]);
    setReloadFailed(false);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Liste konnte nicht geladen werden.'),
    );
  }, [kind]);
  async function save() {
    if (saving.current || reloadFailed) return;
    saving.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(editing ? `${url}/${editing.id}` : url, {
        method: editing ? 'PUT' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          ...draft,
          ...(editing ? { version: editing.version } : {}),
        }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error: string };
        setMessage(
          result.error === 'conflict'
            ? 'Inzwischen geändert. Liste aktualisieren und erneut bearbeiten.'
            : result.error === 'name_exists'
              ? 'Diese Bezeichnung ist bereits vorhanden.'
              : 'Speichern fehlgeschlagen. Bitte Eingabe und Anmeldung prüfen.',
        );
        return;
      }
      let refreshed = true;
      try {
        await refresh();
      } catch {
        refreshed = false;
        setReloadFailed(true);
      }
      setEditing(null);
      setDraft(empty);
      if (editor.current) {
        const restoreFocus = editor.current.contains(document.activeElement);
        editor.current.open = false;
        if (restoreFocus) editor.current.querySelector('summary')?.focus();
      }
      setMessage(
        refreshed
          ? 'Gespeichert.'
          : 'Gespeichert, aber die Liste konnte nicht aktualisiert werden. Bitte Liste aktualisieren.',
      );
    } catch {
      setMessage('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <button
        className="tertiary-action"
        disabled={busy}
        onClick={() =>
          void refresh()
            .then(() => setMessage('Liste aktualisiert.'))
            .catch(() => setMessage('Liste konnte nicht geladen werden.'))
        }
      >
        Liste aktualisieren
      </button>
      <p role="status">{message}</p>
      <ul className="master-data-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {row.name} –{' '}
              {row.state === 'active'
                ? 'Aktiv'
                : row.state === 'inactive'
                  ? 'Inaktiv'
                  : 'Archiviert'}
            </span>{' '}
            <button
              className="secondary-action"
              disabled={busy || reloadFailed}
              aria-label={`Bearbeiten: ${row.name}`}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm('Ungespeicherte Eingaben verwerfen?')
                )
                  return;
                if (editor.current) editor.current.open = true;
                setEditing(row);
                setDraft({
                  name: row.name,
                  position: row.position,
                  state: row.state,
                });
                nameInput.current?.focus();
              }}
            >
              Bearbeiten
            </button>
          </li>
        ))}
      </ul>
      <details className="master-data-editor" ref={editor}>
        <summary>
          {editing ? 'Eintrag bearbeiten' : 'Eintrag hinzufügen'}
          {dirty && <span> · Ungespeichert</span>}
        </summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy || reloadFailed}>
            <legend>{editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</legend>
            <label htmlFor={`${kind}-name`}>Bezeichnung</label>
            <input
              ref={nameInput}
              id={`${kind}-name`}
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
            <label htmlFor={`${kind}-position`}>Sortierung</label>
            <input
              id={`${kind}-position`}
              type="number"
              min={0}
              max={9999}
              required
              value={draft.position}
              onChange={(event) =>
                setDraft({ ...draft, position: Number(event.target.value) })
              }
            />
            <label htmlFor={`${kind}-state`}>Zustand</label>
            <select
              id={`${kind}-state`}
              value={draft.state}
              onChange={(event) =>
                setDraft({ ...draft, state: event.target.value })
              }
            >
              <option value="active">Aktiv</option>
              <option value="inactive">Inaktiv</option>
              <option value="archived">Archiviert</option>
            </select>
            <button className={primary ? 'primary-action' : 'secondary-action'}>
              Speichern
            </button>
            {editing && (
              <button
                type="button"
                className="tertiary-action"
                onClick={() => {
                  setEditing(null);
                  setDraft(empty);
                }}
              >
                Abbrechen
              </button>
            )}
          </fieldset>
        </form>
      </details>
      <p>Archivierte Einträge bleiben für bestehende Zuordnungen erhalten.</p>
    </section>
  );
}
export function MasterDataSettings({ csrfToken }: { csrfToken: string }) {
  const [statuses, setStatuses] = useState<{ code: string; label: string }[]>(
    [],
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    void fetch('/api/v1/statuses')
      .then(async (response) => {
        if (!response.ok) throw new Error('load');
        setStatuses(
          (await response.json()) as { code: string; label: string }[],
        );
      })
      .catch(() => setError(true));
  }, []);
  return (
    <>
      <MasterDataPanel
        kind="event_type"
        title="Eventarten"
        csrfToken={csrfToken}
      />
      <MasterDataPanel
        kind="package"
        title="Paketwerte"
        csrfToken={csrfToken}
        primary={false}
      />
      <MasterDataPanel
        kind="cancellation_reason"
        title="Absagegründe"
        csrfToken={csrfToken}
        primary={false}
      />
      <section aria-label="Auftragsstatus">
        <h2>Auftragsstatus</h2>
        {error ? (
          <p role="alert">Status konnten nicht geladen werden.</p>
        ) : (
          <ul>
            {statuses.map((status) => (
              <li key={status.code}>{status.label}</li>
            ))}
          </ul>
        )}
        <p>Die fünf Auftragsstatus sind fest vorgegeben.</p>
      </section>
    </>
  );
}
