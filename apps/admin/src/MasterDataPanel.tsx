import { useEffect, useState } from 'react';
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
  const [rows, setRows] = useState<Entry[]>([]),
    [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const url = '/api/v1/master-data/' + kind;
  async function refresh() {
    const response = await fetch(url);
    if (!response.ok) throw new Error('load');
    setRows((await response.json()) as Entry[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Liste konnte nicht geladen werden.'),
    );
  }, [kind]);
  async function save() {
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
      await refresh();
      setEditing(null);
      setDraft(empty);
      setMessage('Gespeichert.');
    } catch {
      setMessage('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <legend>{editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</legend>
          <label htmlFor={`${kind}-name`}>Bezeichnung</label>
          <input
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
      <button
        className="tertiary-action"
        disabled={busy}
        onClick={() =>
          void refresh().catch(() =>
            setMessage('Liste konnte nicht geladen werden.'),
          )
        }
      >
        Liste aktualisieren
      </button>
      <p role="status">{message}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.name} –{' '}
            {row.state === 'active'
              ? 'Aktiv'
              : row.state === 'inactive'
                ? 'Inaktiv'
                : 'Archiviert'}{' '}
            <button
              className="secondary-action"
              disabled={busy}
              aria-label={`Bearbeiten: ${row.name}`}
              onClick={() => {
                setEditing(row);
                setDraft({
                  name: row.name,
                  position: row.position,
                  state: row.state,
                });
              }}
            >
              Bearbeiten
            </button>
          </li>
        ))}
      </ul>
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
