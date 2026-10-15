import { useEffect, useState } from 'react';
type Contact = {
  id: string;
  version: number;
  kind: string;
  name: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  mobile: string;
  state: string;
};
const fields = [
  ['name', 'Name / Firma', 200],
  ['contactPerson', 'Ansprechpartner', 200],
  ['street', 'Straße und Hausnummer', 200],
  ['postalCode', 'Postleitzahl', 20],
  ['city', 'Ort', 120],
  ['country', 'Ländercode', 2],
  ['email', 'E-Mail-Adresse', 254],
  ['phone', 'Festnetz', 60],
  ['mobile', 'Mobilnummer', 60],
] as const;
export function ContactPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Contact[]>([]),
    [draft, setDraft] = useState<Contact | null>(null),
    [search, setSearch] = useState(''),
    [message, setMessage] = useState(''),
    [duplicates, setDuplicates] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  async function refresh(query = '') {
    const response = await fetch(
      '/api/v1/contacts' + (query ? '?q=' + encodeURIComponent(query) : ''),
    );
    if (!response.ok) throw Error('load');
    setRows((await response.json()) as Contact[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Kontakte konnten nicht geladen werden.'),
    );
  }, []);
  async function submit(form: HTMLFormElement, check = false) {
    setBusy(true);
    setMessage('');
    setDuplicates([]);
    try {
      const data = new FormData(form),
        input: Record<string, string> = {};
      data.forEach((value, key) => {
        input[key] = String(value).trim();
      });
      const body = check
        ? {
            email: input.email,
            phone: input.phone,
            mobile: input.mobile,
            country: input.country,
            ...(draft ? { excludeId: draft.id } : {}),
          }
        : { ...input, ...(draft ? { version: draft.version } : {}) };
      const response = await fetch(
        check
          ? '/api/v1/contacts/duplicates'
          : draft
            ? '/api/v1/contacts/' + draft.id
            : '/api/v1/contacts',
        {
          method: check || !draft ? 'POST' : 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          check
            ? 'Dublettenprüfung fehlgeschlagen.'
            : error.error === 'conflict'
              ? 'Inzwischen geändert. Kontakte suchen und erneut bearbeiten.'
              : 'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      if (check) {
        const matches = (await response.json()) as Contact[];
        setDuplicates(matches.map((row) => row.name));
        setMessage(matches.length ? '' : 'Keine möglichen Dubletten gefunden.');
        return;
      }
      await refresh(search);
      setDraft(null);
      form.reset();
      setMessage('Kontakt gespeichert.');
    } catch {
      setMessage(
        check
          ? 'Dublettenprüfung fehlgeschlagen.'
          : 'Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Kontakte">
      <h2>Kontakte</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void refresh(search).catch(() =>
            setMessage('Kontakte konnten nicht geladen werden.'),
          );
        }}
      >
        <label>
          Kontakte suchen
          <input
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button disabled={busy}>Suchen</button>
      </form>
      <a href="/api/v1/contacts/export.csv" download>
        Kontakte als CSV exportieren
      </a>
      <form
        key={`${draft?.id ?? 'new'}:${draft?.version ?? 0}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>{draft ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</legend>
          <label>
            Kontaktart
            <select name="kind" defaultValue={draft?.kind ?? 'private'}>
              <option value="private">Privatperson</option>
              <option value="company">Firma</option>
            </select>
          </label>
          {fields.map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                maxLength={maxLength}
                required={key === 'name' || key === 'country'}
                defaultValue={draft?.[key] ?? (key === 'country' ? 'DE' : '')}
              />
            </label>
          ))}
          <label>
            Kontaktzustand
            <select name="state" defaultValue={draft?.state ?? 'active'}>
              <option value="active">Aktiv</option>
              <option value="archived">Archiviert</option>
            </select>
          </label>
          <button>Kontakt speichern</button>
          <button
            type="button"
            onClick={(event) => void submit(event.currentTarget.form!, true)}
          >
            Dubletten prüfen
          </button>
          {draft && (
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setDuplicates([]);
              }}
            >
              Kontakt abbrechen
            </button>
          )}
        </fieldset>
      </form>
      <p role="status">{message}</p>
      {duplicates.length > 0 && (
        <p role="status">Mögliche Dubletten: {duplicates.join(', ')}</p>
      )}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {row.name}
              {row.state === 'archived' ? ' – Archiviert' : ''}
            </span>{' '}
            {row.contactPerson && <span>{row.contactPerson} </span>}
            {row.email && (
              <a
                aria-label={`E-Mail: ${row.name}`}
                href={'mailto:' + encodeURIComponent(row.email)}
              >
                E-Mail
              </a>
            )}{' '}
            {(row.phone || row.mobile) && (
              <a
                aria-label={`Anrufen: ${row.name}`}
                href={
                  'tel:' + (row.phone || row.mobile).replace(/[^+0-9]/g, '')
                }
              >
                Anrufen
              </a>
            )}{' '}
            <button
              disabled={busy}
              aria-label={`Kontakt bearbeiten: ${row.name}`}
              onClick={() => {
                setDraft(row);
                setDuplicates([]);
              }}
            >
              Bearbeiten
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
