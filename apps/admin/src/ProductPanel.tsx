import { useEffect, useState } from 'react';
import { parseHundredths, formatHundredths } from './decimal.js';
type Product = {
  id: string;
  version: number;
  name: string;
  description: string;
  unit: string;
  priceMinor: number;
  priceBasis: string;
  taxBasisPoints: number;
  state: string;
  position: number;
};
export function ProductPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Product[]>([]),
    [draft, setDraft] = useState<Product | null>(null),
    [editing, setEditing] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch('/api/v1/products');
    if (!response.ok) throw new Error('load');
    setRows((await response.json()) as Product[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Produkte konnten nicht geladen werden.'),
    );
  }, []);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData(form);
      const input = {
        name: String(data.get('name')),
        description: String(data.get('description')),
        unit: String(data.get('unit')),
        priceMinor: parseHundredths(String(data.get('price'))),
        priceBasis: String(data.get('priceBasis')),
        taxBasisPoints: parseHundredths(String(data.get('tax'))),
        position: Number(data.get('position')),
        state: String(data.get('state')),
        ...(editing ? { version: draft!.version } : {}),
      };
      const response = await fetch(
        editing ? `/api/v1/products/${draft!.id}` : '/api/v1/products',
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
            ? 'Inzwischen geändert. Produkte aktualisieren und erneut bearbeiten.'
            : 'Speichern fehlgeschlagen. Preis, Steuer und Anmeldung prüfen.',
        );
        return;
      }
      await refresh();
      setDraft(null);
      setEditing(false);
      form.reset();
      setMessage('Gespeichert.');
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'Ungültiger Dezimalwert'
          ? 'Preis und Steuer mit höchstens zwei Nachkommastellen eingeben.'
          : 'Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="products" aria-label="Produkte">
      <form
        key={`${draft?.id ?? 'new'}:${draft?.version ?? 0}:${editing}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>{editing ? 'Produkt bearbeiten' : 'Neues Produkt'}</legend>
          <label>
            Produktname
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={draft?.name ?? ''}
            />
          </label>
          <label>
            Produktbeschreibung
            <textarea
              name="description"
              maxLength={2000}
              defaultValue={draft?.description ?? ''}
            />
          </label>
          <label>
            Einheit
            <input
              name="unit"
              required
              maxLength={40}
              defaultValue={draft?.unit ?? 'Stück'}
            />
          </label>
          <label>
            Preis in Euro
            <input
              name="price"
              inputMode="decimal"
              required
              maxLength={17}
              defaultValue={formatHundredths(draft?.priceMinor ?? 0)}
            />
          </label>
          <label>
            Preisbasis
            <select
              name="priceBasis"
              defaultValue={draft?.priceBasis ?? 'gross'}
            >
              <option value="gross">Brutto</option>
              <option value="net">Netto</option>
            </select>
          </label>
          <label>
            Steuersatz in Prozent
            <input
              name="tax"
              inputMode="decimal"
              required
              maxLength={6}
              defaultValue={formatHundredths(draft?.taxBasisPoints ?? 1900)}
            />
          </label>
          <label>
            Produktsortierung
            <input
              name="position"
              type="number"
              min={0}
              max={9999}
              required
              defaultValue={draft?.position ?? 0}
            />
          </label>
          <label>
            Produktzustand
            <select name="state" defaultValue={draft?.state ?? 'active'}>
              <option value="active">Aktiv</option>
              <option value="inactive">Inaktiv</option>
              <option value="archived">Archiviert</option>
            </select>
          </label>
          <button>Produkt speichern</button>
          {draft && (
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setEditing(false);
              }}
            >
              Abbrechen
            </button>
          )}
        </fieldset>
      </form>
      <button
        disabled={busy}
        onClick={() =>
          void refresh().catch(() =>
            setMessage('Produkte konnten nicht geladen werden.'),
          )
        }
      >
        Produkte aktualisieren
      </button>
      <p role="status">{message}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {row.name} – {formatHundredths(row.priceMinor).replace('.', ',')}{' '}
              € {row.priceBasis === 'gross' ? 'Brutto' : 'Netto'}
              {row.state === 'archived' ? ' – Archiviert' : ''}
            </span>{' '}
            <button
              disabled={busy}
              aria-label={`Produkt bearbeiten: ${row.name}`}
              onClick={() => {
                setDraft(row);
                setEditing(true);
              }}
            >
              Bearbeiten
            </button>
            <button
              disabled={busy}
              aria-label={`Produkt duplizieren: ${row.name}`}
              onClick={() => {
                setDraft({ ...row, name: `${row.name.slice(0, 112)} (Kopie)` });
                setEditing(false);
              }}
            >
              Duplizieren
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
