import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { formatHundredths } from './decimal.js';

/**
 * EDITOR-PICKER-01: one catalog picker for the document editor and the template
 * editor. The observed Bookitup dialog is a modal with a search field, a
 * multi-select list of the active products and one deliberate add action; a
 * close without that action discards the selection. The catalog contract is
 * unchanged - both callers still read GET /api/v1/products and keep exactly the
 * active rows this list showed before.
 */
export type CatalogProduct = {
  id: string;
  name: string;
  description?: string;
  unit: string;
  priceMinor: number;
  priceBasis: string;
  taxBasisPoints: number;
  state: string;
};

export type CatalogState = 'idle' | 'loading' | 'ready' | 'error';

/** The stored catalog rows, narrowed to the ones a position may copy. */
export function catalogProductsOf(value: unknown): CatalogProduct[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (product): product is CatalogProduct =>
      product &&
      typeof product.id === 'string' &&
      typeof product.name === 'string' &&
      (product.description === undefined ||
        typeof product.description === 'string') &&
      typeof product.unit === 'string' &&
      typeof product.priceBasis === 'string' &&
      typeof product.state === 'string' &&
      product.state === 'active' &&
      Number.isSafeInteger(product.priceMinor) &&
      Number.isInteger(product.taxBasisPoints),
  );
}

function basisText(priceBasis: string) {
  return priceBasis === 'net' ? 'Netto' : 'Brutto';
}

// The search narrows the loaded list in place; it never changes the query or
// the stored rows.
function matchesSearch(product: CatalogProduct, needle: string) {
  if (!needle) return true;
  return (
    product.name.toLowerCase().includes(needle) ||
    (product.description ?? '').toLowerCase().includes(needle)
  );
}

export function ProductPickerDialog({
  products,
  state,
  message,
  busy = false,
  onRetry,
  onAdd,
  onClose,
}: {
  /** The active catalog products in their list order. */
  products: CatalogProduct[];
  state: CatalogState;
  /** A catalog failure or refusal that belongs to this dialog. */
  message: string;
  busy?: boolean;
  onRetry: () => void;
  /** Receives the chosen products in list order, never in click order. */
  onAdd: (products: CatalogProduct[]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    headingId = useId(),
    [needle, setNeedle] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    // A click and its double never become two batches: the first add closes the
    // dialog and the parent opens a new one with a fresh selection.
    adding = useRef(false),
    visible = useMemo(() => {
      const query = needle.trim().toLowerCase();
      return products.filter((product) => matchesSearch(product, query));
    }, [needle, products]);

  useEffect(() => {
    search.current?.focus({ preventScroll: true });
  }, []);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // The editors close themselves on Escape; this dialog owns it instead.
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      ),
    );
    if (!focusable.length) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = focusable[0]!,
      last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function add() {
    if (adding.current || busy) return;
    const chosen = products.filter((product) => selected.includes(product.id));
    if (!chosen.length) return;
    adding.current = true;
    onAdd(chosen);
  }

  return (
    <div
      className="form-dialog-backdrop"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="form-dialog product-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <header className="form-dialog-header">
          <h3 id={headingId}>Produkt auswählen</h3>
          <button
            type="button"
            className="tertiary-action form-dialog-close"
            aria-label="Schließen"
            title="Schließen"
            disabled={busy}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {(state === 'idle' || state === 'loading') && (
          <p role="status">Produktkatalog wird geladen.</p>
        )}
        {state === 'error' && (
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={onRetry}
          >
            Katalog erneut laden
          </button>
        )}
        {state === 'ready' && products.length === 0 && (
          <p role="status">Keine aktiven Produkte im Katalog.</p>
        )}
        {state === 'ready' && products.length > 0 && (
          <>
            <label>
              Produkt suchen
              <input
                ref={search}
                type="search"
                value={needle}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setNeedle(event.target.value)}
              />
            </label>
            {visible.length === 0 ? (
              <p role="status">Keine Produkte gefunden.</p>
            ) : (
              <ul className="product-picker-list">
                {visible.map((product) => {
                  const detail = [
                    `${formatHundredths(product.priceMinor)} €`,
                    basisText(product.priceBasis),
                    `${formatHundredths(product.taxBasisPoints)} %`,
                  ].join(' · ');
                  return (
                    <li key={product.id}>
                      <label className="product-picker-option">
                        <input
                          type="checkbox"
                          checked={selected.includes(product.id)}
                          disabled={busy}
                          onChange={() => toggle(product.id)}
                        />
                        <span className="product-picker-text">
                          <span className="product-picker-name">
                            {product.name}
                          </span>
                          <span className="product-picker-detail">
                            {detail}
                          </span>
                          {product.description?.trim() && (
                            <span className="product-picker-description">
                              {product.description}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {message && <p role="alert">{message}</p>}
        <div className="product-picker-footer">
          <button
            type="button"
            className="primary-action"
            disabled={busy || selected.length === 0}
            onClick={add}
          >
            Hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}
