import { useEffect, useState } from 'react';
import { parseHundredths, formatHundredths } from './decimal.js';

type Position = {
  id?: string;
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
};
type Template = {
  id: string;
  version: number;
  kind: string;
  name: string;
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
  state: string;
  positions: Position[];
};
type Product = {
  id: string;
  name: string;
  unit: string;
  priceMinor: number;
  taxBasisPoints: number;
  state: string;
};
type DraftPosition = {
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  tax: string;
  discount: string;
};
const kinds: [string, string][] = [
  ['offer', 'Angebot'],
  ['order_confirmation', 'Auftragsbestätigung'],
  ['deposit_invoice', 'Anzahlungsrechnung'],
  ['invoice', 'Rechnung'],
  ['correction', 'Rechnungskorrektur'],
];
const states: [string, string][] = [
  ['active', 'Aktiv'],
  ['inactive', 'Inaktiv'],
  ['archived', 'Archiviert'],
];
const placeholders = [
  'contact',
  'event',
  'date',
  'location',
  'eventType',
  'package',
  'total',
  'documentLink',
];
const emptyPosition = (): DraftPosition => ({
  productId: '',
  description: '',
  quantity: '1',
  unit: 'Stück',
  price: '0,00',
  tax: '19,00',
  discount: '0,00',
});
const toDraft = (position: Position): DraftPosition => ({
  productId: position.productId ?? '',
  description: position.description,
  quantity: String(position.quantity),
  unit: position.unit,
  price: formatHundredths(position.unitPriceMinor),
  tax: formatHundredths(position.taxBasisPoints),
  discount: formatHundredths(position.discountBasisPoints),
});

export function DocumentTemplatesPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Template[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [draft, setDraft] = useState<Template | null>(null),
    [positions, setPositions] = useState<DraftPosition[]>([emptyPosition()]),
    [editing, setEditing] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch('/api/v1/document-templates');
    if (!response.ok) throw new Error('load');
    setRows((await response.json()) as Template[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Vorlagen konnten nicht geladen werden.'),
    );
    void fetch('/api/v1/products')
      .then((response) => (response.ok ? response.json() : []))
      .then((list: Product[]) =>
        setProducts(list.filter((p) => p.state === 'active')),
      )
      .catch(() => setProducts([]));
  }, []);
  function begin(template: Template | null, copy = false) {
    setDraft(
      template && copy
        ? { ...template, name: `${template.name.slice(0, 112)} (Kopie)` }
        : template,
    );
    setPositions(
      template?.positions.length
        ? template.positions.map(toDraft)
        : [emptyPosition()],
    );
    setEditing(Boolean(template) && !copy);
  }
  function updatePosition(index: number, patch: Partial<DraftPosition>) {
    setPositions((current) =>
      current.map((position, at) =>
        at === index ? { ...position, ...patch } : position,
      ),
    );
  }
  function applyProduct(index: number, productId: string) {
    const product = products.find((row) => row.id === productId);
    updatePosition(
      index,
      product
        ? {
            productId,
            description: product.name,
            unit: product.unit,
            price: formatHundredths(product.priceMinor),
            tax: formatHundredths(product.taxBasisPoints),
          }
        : { productId: '' },
    );
  }
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData(form);
      const input = {
        kind: String(data.get('kind')),
        name: String(data.get('name')),
        subject: String(data.get('subject')),
        introText: String(data.get('introText')),
        outroText: String(data.get('outroText')),
        validityDays: Number(data.get('validityDays')),
        state: String(data.get('state')),
        positions: positions
          .filter((position) => position.description.trim().length > 0)
          .map((position) => ({
            productId: position.productId || null,
            description: position.description,
            quantity: Number(position.quantity),
            unit: position.unit,
            unitPriceMinor: parseHundredths(position.price),
            taxBasisPoints: parseHundredths(position.tax),
            discountBasisPoints: parseHundredths(position.discount),
          })),
        ...(editing ? { version: draft!.version } : {}),
      };
      const response = await fetch(
        editing
          ? `/api/v1/document-templates/${draft!.id}`
          : '/api/v1/document-templates',
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
            ? 'Inzwischen geändert. Vorlagen aktualisieren und erneut bearbeiten.'
            : result.error === 'unknown_placeholder'
              ? 'Unbekannter Platzhalter. Nur die aufgeführten Platzhalter verwenden.'
              : 'Speichern fehlgeschlagen. Angaben, Preise und Anmeldung prüfen.',
        );
        return;
      }
      await refresh();
      setDraft(null);
      setEditing(false);
      setPositions([emptyPosition()]);
      form.reset();
      setMessage('Gespeichert.');
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'Ungültiger Dezimalwert'
          ? 'Preise, Steuer und Rabatt mit höchstens zwei Nachkommastellen eingeben.'
          : 'Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="document-templates" aria-label="Dokumentvorlagen">
      <h2>Dokumentvorlagen</h2>
      <p>
        Platzhalter: {placeholders.map((name) => `{{${name}}}`).join(', ')}.
        Unbekannte Platzhalter werden beim Speichern abgewiesen.
      </p>
      <form
        key={`${draft?.id ?? 'new'}:${draft?.version ?? 0}:${editing}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>{editing ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</legend>
          <label>
            Dokumentart
            <select name="kind" defaultValue={draft?.kind ?? 'offer'}>
              {kinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bezeichnung
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={draft?.name ?? ''}
            />
          </label>
          <label>
            Betreff
            <input
              name="subject"
              maxLength={200}
              defaultValue={draft?.subject ?? ''}
            />
          </label>
          <label>
            Einleitungstext
            <textarea
              name="introText"
              maxLength={4000}
              defaultValue={draft?.introText ?? ''}
            />
          </label>
          <label>
            Schlusstext
            <textarea
              name="outroText"
              maxLength={4000}
              defaultValue={draft?.outroText ?? ''}
            />
          </label>
          <label>
            Angebotsgültigkeit in Tagen
            <input
              name="validityDays"
              type="number"
              min={1}
              max={365}
              required
              defaultValue={draft?.validityDays ?? 14}
            />
          </label>
          <label>
            Zustand
            <select name="state" defaultValue={draft?.state ?? 'active'}>
              {states.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <h3>Positionen</h3>
          {positions.map((position, index) => (
            <fieldset key={index}>
              <legend>Position {index + 1}</legend>
              <label>
                Produkt
                <select
                  value={position.productId}
                  onChange={(event) => applyProduct(index, event.target.value)}
                >
                  <option value="">Freie Position</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Beschreibung
                <input
                  value={position.description}
                  maxLength={300}
                  onChange={(event) =>
                    updatePosition(index, { description: event.target.value })
                  }
                />
              </label>
              <label>
                Menge
                <input
                  inputMode="numeric"
                  value={position.quantity}
                  onChange={(event) =>
                    updatePosition(index, { quantity: event.target.value })
                  }
                />
              </label>
              <label>
                Einheit
                <input
                  value={position.unit}
                  maxLength={40}
                  onChange={(event) =>
                    updatePosition(index, { unit: event.target.value })
                  }
                />
              </label>
              <label>
                Einzelpreis in Euro
                <input
                  inputMode="decimal"
                  value={position.price}
                  onChange={(event) =>
                    updatePosition(index, { price: event.target.value })
                  }
                />
              </label>
              <label>
                Steuersatz in Prozent
                <input
                  inputMode="decimal"
                  value={position.tax}
                  onChange={(event) =>
                    updatePosition(index, { tax: event.target.value })
                  }
                />
              </label>
              <label>
                Rabatt in Prozent
                <input
                  inputMode="decimal"
                  value={position.discount}
                  onChange={(event) =>
                    updatePosition(index, { discount: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="secondary-action"
                disabled={positions.length === 1}
                onClick={() =>
                  setPositions((current) =>
                    current.filter((_row, at) => at !== index),
                  )
                }
              >
                Position entfernen
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              setPositions((current) => [...current, emptyPosition()])
            }
          >
            Position hinzufügen
          </button>
          <button className="primary-action">Vorlage speichern</button>
          {draft && (
            <button
              type="button"
              className="tertiary-action"
              onClick={() => {
                setDraft(null);
                setEditing(false);
                setPositions([emptyPosition()]);
              }}
            >
              Abbrechen
            </button>
          )}
        </fieldset>
      </form>
      <p role="status">{message}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {kinds.find(([value]) => value === row.kind)?.[1] ?? row.kind}:{' '}
              {row.name} – {row.positions.length} Position(en)
              {row.state === 'archived' ? ' – Archiviert' : ''}
            </span>{' '}
            <button
              className="secondary-action"
              disabled={busy}
              aria-label={`Vorlage bearbeiten: ${row.name}`}
              onClick={() => begin(row)}
            >
              Bearbeiten
            </button>
            <button
              className="secondary-action"
              disabled={busy}
              aria-label={`Vorlage duplizieren: ${row.name}`}
              onClick={() => begin(row, true)}
            >
              Duplizieren
            </button>
            <button
              className="tertiary-action"
              disabled={busy || row.state === 'archived'}
              aria-label={`Vorlage archivieren: ${row.name}`}
              onClick={() =>
                void fetch(`/api/v1/document-templates/${row.id}`, {
                  method: 'PUT',
                  headers: {
                    'content-type': 'application/json',
                    'x-csrf-token': csrfToken,
                  },
                  body: JSON.stringify({
                    kind: row.kind,
                    name: row.name,
                    subject: row.subject,
                    introText: row.introText,
                    outroText: row.outroText,
                    validityDays: row.validityDays,
                    state: 'archived',
                    positions: row.positions.map((position) => ({
                      productId: position.productId,
                      description: position.description,
                      quantity: position.quantity,
                      unit: position.unit,
                      unitPriceMinor: position.unitPriceMinor,
                      taxBasisPoints: position.taxBasisPoints,
                      discountBasisPoints: position.discountBasisPoints,
                    })),
                    version: row.version,
                  }),
                }).then(() => refresh())
              }
            >
              Archivieren
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
