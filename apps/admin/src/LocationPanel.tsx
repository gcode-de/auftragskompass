import { useEffect, useState } from 'react';
type Location = {
  id: string;
  version: number;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  state: string;
};
const fields = [
  ['name', 'Locationname', 200],
  ['street', 'Locationstraße', 200],
  ['postalCode', 'Location-Postleitzahl', 20],
  ['city', 'Locationort', 120],
  ['country', 'Location-Ländercode', 2],
] as const;
export function LocationPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Location[]>([]),
    [draft, setDraft] = useState<Location | null>(null),
    [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh(query = '') {
    const response = await fetch(
      '/api/v1/locations' + (query ? '?q=' + encodeURIComponent(query) : ''),
    );
    if (!response.ok) throw Error('load');
    setRows((await response.json()) as Location[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Locations konnten nicht geladen werden.'),
    );
  }, []);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const input: Record<string, string | number> = {};
      new FormData(form).forEach((value, key) => {
        input[key] = String(value).trim();
      });
      if (draft) input.version = draft.version;
      const response = await fetch(
        draft ? '/api/v1/locations/' + draft.id : '/api/v1/locations',
        {
          method: draft ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Locations suchen und erneut bearbeiten.'
            : 'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      await refresh(search);
      setDraft(null);
      form.reset();
      setMessage('Location gespeichert.');
    } catch {
      setMessage('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="locations" aria-label="Locations">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void refresh(search).catch(() =>
            setMessage('Locations konnten nicht geladen werden.'),
          );
        }}
      >
        <label>
          Locations suchen
          <input
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button disabled={busy}>Locations suchen</button>
      </form>
      <form
        key={`${draft?.id ?? 'new'}:${draft?.version ?? 0}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>{draft ? 'Location bearbeiten' : 'Neue Location'}</legend>
          {fields.map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                required={key === 'name' || key === 'country'}
                maxLength={maxLength}
                defaultValue={draft?.[key] ?? (key === 'country' ? 'DE' : '')}
              />
            </label>
          ))}
          <label>
            Locationzustand
            <select name="state" defaultValue={draft?.state ?? 'active'}>
              <option value="active">Aktiv</option>
              <option value="archived">Archiviert</option>
            </select>
          </label>
          <button>Location speichern</button>
          {draft && (
            <button type="button" onClick={() => setDraft(null)}>
              Location abbrechen
            </button>
          )}
        </fieldset>
      </form>
      <p role="status">{message}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {row.name}
              {row.state === 'archived' ? ' – Archiviert' : ''}
            </span>{' '}
            <span>
              {[row.street, row.postalCode, row.city, row.country]
                .filter(Boolean)
                .join(', ')}
            </span>{' '}
            <button
              disabled={busy}
              aria-label={`Location bearbeiten: ${row.name}`}
              onClick={() => setDraft(row)}
            >
              Bearbeiten
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
