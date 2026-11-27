import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ModalDialog } from './ModalDialog.js';

// RES-BKP-04: the right-hand cards of Bookitup's resource record and their
// pickers ("Zubehör hinzufügen": search, type, category, then save).

type Linked = { id: string; name: string; kind: string; category: string };
type Product = { id: string; name: string };
export type ResourceLinksValue = {
  accessories: Linked[];
  alternatives: Linked[];
  components: Linked[];
  inCases: Linked[];
  inSets: Linked[];
  products: Product[];
};
type Editable = 'accessories' | 'alternatives' | 'components' | 'products';
export type Candidate = {
  id: string;
  name: string;
  kind: string;
  category: string;
  state: string;
};

const kindNames: Record<string, string> = {
  item: 'Item',
  set: 'Set',
  case: 'Case',
};
const titles: Record<Editable, [card: string, picker: string]> = {
  accessories: ['Zubehör', 'Zubehör hinzufügen'],
  alternatives: ['Alternativen', 'Alternativen hinzufügen'],
  components: ['Bestandteile', 'Bestandteile hinzufügen'],
  products: ['Verknüpfte Produkte', 'Produkte verknüpfen'],
};
const errors: Record<string, string> = {
  not_a_collection: 'Nur ein Set oder ein Case hat Bestandteile.',
  component_cycle:
    'Das geht nicht: die Auswahl enthält diese Ressource bereits selbst.',
  unknown_target: 'Ein Eintrag existiert nicht mehr. Bitte neu laden.',
};

const keys = [
  'accessories',
  'alternatives',
  'components',
  'inCases',
  'inSets',
  'products',
] as const;
/** Only a complete answer fills the cards. */
function isLinks(value: unknown): value is ResourceLinksValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    keys.every((key) => Array.isArray((value as Record<string, unknown>)[key]))
  );
}

export function ResourceLinks({
  resource,
  candidates,
  csrfToken,
}: {
  resource: { id: string; name: string; kind: string; version: number };
  candidates: readonly Candidate[];
  csrfToken: string;
}) {
  const [links, setLinks] = useState<ResourceLinksValue | null>(null),
    [failed, setFailed] = useState(false),
    [picker, setPicker] = useState<Editable | null>(null),
    [origin, setOrigin] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let current = true;
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/resources/${resource.id}/links`);
        if (!response.ok) throw Error('load');
        const value = (await response.json()) as ResourceLinksValue;
        if (!isLinks(value)) throw Error('shape');
        if (current) setLinks(value);
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [resource.id, resource.version]);

  const cards: [keyof ResourceLinksValue, string, Editable | null][] = [
    ['accessories', titles.accessories[0], 'accessories'],
    ['alternatives', titles.alternatives[0], 'alternatives'],
    ['products', titles.products[0], 'products'],
    ...(resource.kind === 'item'
      ? []
      : [
          ['components', titles.components[0], 'components'] as [
            keyof ResourceLinksValue,
            string,
            Editable | null,
          ],
        ]),
    ['inCases', 'Verbaut in folgenden Cases', null],
    ['inSets', 'Bestandteil folgender Sets', null],
  ];
  function close() {
    setPicker(null);
    if (origin?.isConnected) origin.focus();
  }
  return (
    <aside className="record-side" aria-label="Verknüpfungen">
      {failed && (
        <p role="alert">Die Verknüpfungen konnten nicht geladen werden.</p>
      )}
      {cards.map(([key, title, editable]) => (
        <section
          key={key}
          className="record-card"
          aria-labelledby={`links-${key}`}
        >
          <div className="card-head">
            <h3 id={`links-${key}`}>{title}</h3>
            {editable && (
              <button
                type="button"
                className="icon-action tier-quiet-icon"
                aria-label={titles[editable][1]}
                title={titles[editable][1]}
                disabled={!links}
                onClick={(event) => {
                  setOrigin(event.currentTarget);
                  setPicker(editable);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
          </div>
          {links && !links[key].length && (
            <p className="muted record-empty">Noch nichts hinzugefügt.</p>
          )}
          {links && links[key].length > 0 && (
            <ul className="record-links">
              {links[key].map((entry) => (
                <li key={entry.id}>
                  {key === 'products' ? (
                    entry.name
                  ) : (
                    <a href={'#resource-' + entry.id}>{entry.name}</a>
                  )}
                  {'kind' in entry && (
                    <span className="muted">
                      {' '}
                      · {kindNames[entry.kind] ?? entry.kind} · {entry.category}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {picker && links && (
        <LinkPicker
          relation={picker}
          resource={resource}
          candidates={candidates}
          chosen={links[picker].map((entry) => entry.id)}
          csrfToken={csrfToken}
          onClose={close}
          onSaved={(value) => {
            setLinks(value);
            close();
          }}
        />
      )}
    </aside>
  );
}

function LinkPicker({
  relation,
  resource,
  candidates,
  chosen,
  csrfToken,
  onClose,
  onSaved,
}: {
  relation: Editable;
  resource: { id: string; name: string };
  candidates: readonly Candidate[];
  chosen: string[];
  csrfToken: string;
  onClose: () => void;
  onSaved: (value: ResourceLinksValue) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(chosen)),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState(''),
    [category, setCategory] = useState(''),
    [products, setProducts] = useState<Product[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const isProducts = relation === 'products';
  useEffect(() => {
    if (!isProducts) return;
    void (async () => {
      try {
        const response = await fetch('/api/v1/products');
        if (!response.ok) throw Error('load');
        const rows = (await response.json()) as (Product & {
          state: string;
        })[];
        setProducts(
          rows.filter(
            (row) => row.state !== 'archived' || chosen.includes(row.id),
          ),
        );
      } catch {
        setError('Die Produkte konnten nicht geladen werden.');
        setProducts([]);
      }
    })();
  }, [isProducts]);
  const categories = useMemo(
    () =>
      Array.from(new Set(candidates.map((row) => row.category))).sort((a, b) =>
        a.localeCompare(b, 'de'),
      ),
    [candidates],
  );
  const needle = search.trim().toLowerCase();
  const rows: { id: string; name: string; kind?: string; category?: string }[] =
    isProducts
      ? (products ?? []).filter((row) =>
          row.name.toLowerCase().includes(needle),
        )
      : candidates.filter(
          (row) =>
            row.id !== resource.id &&
            (row.state !== 'archived' || selected.has(row.id)) &&
            (!kind || row.kind === kind) &&
            (!category || row.category === category) &&
            row.name.toLowerCase().includes(needle),
        );
  const changed =
    selected.size !== chosen.length || chosen.some((id) => !selected.has(id));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/resources/${resource.id}/links/${relation}`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ ids: [...selected] }),
        },
      );
      if (!response.ok) {
        const code = (
          (await response.json().catch(() => ({}))) as { error?: string }
        ).error;
        setError(
          (code && errors[code]) ||
            'Speichern fehlgeschlagen. Bitte erneut versuchen.',
        );
        return;
      }
      const value = (await response.json()) as unknown;
      if (!isLinks(value)) throw Error('shape');
      onSaved(value);
    } catch {
      setError('Verbindung fehlgeschlagen. Die Auswahl bleibt erhalten.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalDialog
      className="form-dialog link-picker"
      aria-labelledby="link-picker-title"
      busy={busy}
      dismissOnBackdrop
      onDismiss={onClose}
    >
      <header className="form-dialog-header">
        <h3 id="link-picker-title">{titles[relation][1]}</h3>
        <button
          type="button"
          className="tertiary-action form-dialog-close"
          aria-label="Dialog schließen"
          title="Dialog schließen"
          disabled={busy}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <form onSubmit={(event) => void save(event)}>
        <div className="link-picker-filters">
          <label>
            <span className="sr-only">
              {isProducts ? 'Produkte durchsuchen' : 'Ressourcen durchsuchen'}
            </span>
            <input
              type="search"
              value={search}
              placeholder={
                isProducts ? 'Produkte durchsuchen' : 'Ressourcen durchsuchen'
              }
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {!isProducts && (
            <>
              <label>
                <span className="sr-only">Typ</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  <option value="">Typ</option>
                  <option value="item">Item</option>
                  <option value="set">Set</option>
                  <option value="case">Case</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Kategorie</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">Kategorie</option>
                  {categories.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {isProducts && !products && (
          <p role="status">Produkte werden geladen …</p>
        )}
        {(!isProducts || products) && !rows.length && (
          <p className="muted record-empty">
            {isProducts
              ? 'Keine Produkte vorhanden.'
              : 'Keine Ressourcen vorhanden.'}
          </p>
        )}
        <ul className="link-picker-list">
          {rows.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    })
                  }
                />
                {row.kind && (
                  <span className="muted">
                    {kindNames[row.kind] ?? row.kind}
                  </span>
                )}
                <span>{row.name}</span>
                {row.category && <span className="muted">{row.category}</span>}
              </label>
            </li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        <div className="form-dialog-footer">
          <button className="primary-action" disabled={!changed || busy}>
            {busy ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
