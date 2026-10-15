import { useEffect, useState } from 'react';
type Row = { id: string; version: number; name: string } & Record<
  string,
  string | number | boolean
>;
const texts = [
  ['name', 'Bezeichnung', 120],
  ['code', 'Interner Code', 40],
  ['category', 'Kategorie', 120],
  ['description', 'Beschreibung', 2000],
] as const;
const numbers = [
  ['quantity', 'Bestand', 1, 10000],
  ['beforeDays', 'Puffer vorher (Tage)', 2, 365],
  ['afterDays', 'Puffer nachher (Tage)', 2, 365],
  ['position', 'Sortierung', 0, 9999],
] as const;
export function ResourcePanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Row[]>([]),
    [editing, setEditing] = useState<Row | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch('/api/v1/resources');
    if (!response.ok) throw new Error('load');
    setRows((await response.json()) as Row[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Ressourcen konnten nicht geladen werden.'),
    );
  }, []);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    const data = new FormData(form);
    const input: Record<string, unknown> = {
      state: data.get('state'),
      blocked: data.has('blocked'),
    };
    for (const [key] of texts) input[key] = String(data.get(key));
    for (const [key] of numbers) input[key] = Number(data.get(key));
    if (editing) input.version = editing.version;
    try {
      const response = await fetch(
        editing ? `/api/v1/resources/${editing.id}` : '/api/v1/resources',
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        const result = (await response.json()) as { error: string };
        setMessage(
          result.error === 'conflict'
            ? 'Inzwischen geändert. Liste aktualisieren und erneut bearbeiten.'
            : result.error === 'resource_in_use'
              ? 'Die Ressource ist künftig reserviert. Bestand oder Archiv erst nach Prüfung ändern.'
              : 'Speichern fehlgeschlagen. Code, Eingabe und Anmeldung prüfen.',
        );
        return;
      }
      await refresh();
      setEditing(null);
      form.reset();
      setMessage('Gespeichert.');
    } catch {
      setMessage('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="resources" aria-label="Ressourcen">
      <h2>Ressourcen</h2>
      <form
        key={editing ? `${editing.id}:${editing.version}` : 'new'}
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>{editing ? 'Ressource bearbeiten' : 'Neue Ressource'}</legend>
          {texts.map(([key, label, max]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                required={key !== 'description'}
                maxLength={max}
                defaultValue={String(editing?.[key] ?? '')}
              />
            </label>
          ))}
          {numbers.map(([key, label, value, max]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                type="number"
                min={0}
                max={max}
                required
                defaultValue={String(editing?.[key] ?? value)}
              />
            </label>
          ))}
          <label>
            Zustand
            <select
              name="state"
              defaultValue={String(editing?.state ?? 'active')}
            >
              <option value="active">Aktiv</option>
              <option value="inactive">Inaktiv</option>
              <option value="archived">Archiviert</option>
            </select>
          </label>
          <label>
            <input
              name="blocked"
              type="checkbox"
              defaultChecked={Boolean(editing?.blocked)}
            />
            Gesperrt
          </label>
          <button>Ressource speichern</button>
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
          )}
        </fieldset>
      </form>
      <button
        disabled={busy}
        onClick={() =>
          void refresh().catch(() =>
            setMessage('Ressourcen konnten nicht geladen werden.'),
          )
        }
      >
        Ressourcen aktualisieren
      </button>
      <p role="status">{message}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.name} – {String(row.quantity)} Stück
            {row.blocked ? ' – Gesperrt' : ''}
            {row.state === 'archived' ? ' – Archiviert' : ''}{' '}
            <button
              disabled={busy}
              aria-label={`Ressource bearbeiten: ${row.name}`}
              onClick={() => setEditing(row)}
            >
              Bearbeiten
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
