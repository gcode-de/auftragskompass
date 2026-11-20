import { useEffect, useRef, useState } from 'react';
import { formatHundredths, parseHundredths } from './decimal.js';

/**
 * DOC-PRODUCT-01.6: one document position becomes a product master record
 * through the existing POST /api/v1/products. Quantity and discount are not
 * product data and stay out of the request. The action sends exactly one
 * request per gesture and never repeats an unclear outcome by itself: the
 * product list is read and shown first.
 */
export type PositionProductSource = {
  description: string;
  infoText?: string;
  unit: string;
  price: string;
  priceBasis: 'gross' | 'net';
  tax: string;
};

type ProductInput = {
  name: string;
  description: string;
  unit: string;
  priceMinor: number;
  priceBasis: 'gross' | 'net';
  taxBasisPoints: number;
  state: 'active';
  position: 0;
};

type StoredProduct = {
  id: string;
  name: string;
  unit: string;
  priceMinor: number;
  priceBasis: string;
  taxBasisPoints: number;
  state: string;
};

type Phase =
  | 'idle'
  | 'saving'
  | 'created'
  | 'rejected'
  | 'unknown'
  | 'checking'
  | 'found'
  | 'absent';

const nameLimit = 120;
const descriptionLimit = 2000;
const unitLimit = 40;
const unknownMessage =
  'Ausgang unklar. Das Produkt kann angelegt worden sein. Prüfen Sie den Bestand, bevor Sie erneut anlegen.';
const checkFailedMessage =
  'Bestand konnte nicht geprüft werden. Bitte erneut prüfen.';
const missingMessage =
  'Kein identisches Produkt gefunden. Die Anlage kann erneut gestartet werden.';
const priceMessage =
  'Der Einzelpreis ist ungültig. Bitte einen Betrag mit höchstens zwei Nachkommastellen eintragen.';
const taxMessage =
  'Der Steuersatz ist ungültig. Bitte einen Wert zwischen 0 und 100 Prozent eintragen.';

function money(value: number) {
  return formatHundredths(value).replace('.', ',') + ' €';
}
function taxText(basisPoints: number) {
  return (
    formatHundredths(basisPoints).replace('.', ',').replace(/,00$/, '') + ' %'
  );
}
function basisText(priceBasis: string) {
  return priceBasis === 'net' ? 'Netto' : 'Brutto';
}

// The position already carries every product field but the id. Its name is the
// description, its optional product description the info text, and price plus
// tax travel in the basis the position stores.
function productInputOf(
  position: PositionProductSource,
): { input: ProductInput } | { error: string } {
  const name = position.description.trim();
  if (!name)
    return {
      error:
        'Die Position braucht eine Beschreibung; sie wird zum Produktnamen.',
    };
  if (name.length > nameLimit)
    return {
      error: `Der Produktname ist zu lang. Die Beschreibung darf höchstens ${nameLimit} Zeichen haben.`,
    };
  const unit = position.unit.trim();
  if (!unit || unit.length > unitLimit)
    return {
      error: `Die Einheit fehlt oder ist zu lang (höchstens ${unitLimit} Zeichen).`,
    };
  const description = (position.infoText ?? '').trim();
  if (description.length > descriptionLimit)
    return {
      error:
        'Der Infotext ist zu lang für eine Produktbeschreibung (höchstens 2.000 Zeichen).',
    };
  let priceMinor: number, taxBasisPoints: number;
  try {
    priceMinor = parseHundredths(position.price);
  } catch {
    return { error: priceMessage };
  }
  try {
    taxBasisPoints = parseHundredths(position.tax);
  } catch {
    return { error: taxMessage };
  }
  if (taxBasisPoints > 10000) return { error: taxMessage };
  return {
    input: {
      name,
      description,
      unit,
      priceMinor,
      priceBasis: position.priceBasis,
      taxBasisPoints,
      state: 'active',
      position: 0,
    },
  };
}

function storedProduct(value: unknown): StoredProduct | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.name !== 'string' || typeof row.unit !== 'string') return null;
  if (!Number.isSafeInteger(row.priceMinor)) return null;
  if (typeof row.priceBasis !== 'string' || typeof row.state !== 'string')
    return null;
  if (!Number.isInteger(row.taxBasisPoints)) return null;
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    priceMinor: row.priceMinor as number,
    priceBasis: row.priceBasis,
    taxBasisPoints: row.taxBasisPoints as number,
    state: row.state,
  };
}

// The stock check answers the one question an unclear outcome leaves open. It
// compares exactly what the attempt would have created, so a similar product
// with another price is not mistaken for this one.
function isSameProduct(product: StoredProduct, input: ProductInput) {
  return (
    product.name === input.name &&
    product.priceMinor === input.priceMinor &&
    product.priceBasis === input.priceBasis
  );
}

function rejectionText(status: number) {
  if (status === 400)
    return 'Das Produkt wurde abgelehnt. Prüfen Sie Name, Einheit, Preis und Steuersatz der Position.';
  if (status === 401)
    return 'Anmeldung erforderlich. Bitte erneut anmelden und den Vorgang wiederholen.';
  if (status === 403)
    return 'Keine Berechtigung, Produkte anzulegen. Bitte die Berechtigung prüfen.';
  return 'Der Vorgang wurde abgelehnt, weil sich der Bestand geändert hat. Bitte die Produktliste prüfen und erneut versuchen.';
}

export function SavePositionAsProduct({
  label,
  csrfToken,
  position,
  disabled = false,
}: {
  /** Accessible row name, for example "Position 1". */
  label: string;
  csrfToken: string;
  position: PositionProductSource;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<{ phase: Phase; text: string }>({
      phase: 'idle',
      text: '',
    }),
    inFlight = useRef(false),
    attempt = useRef<ProductInput | null>(null),
    signature = [
      position.description,
      position.infoText ?? '',
      position.unit,
      position.price,
      position.priceBasis,
      position.tax,
    ].join('\u0000'),
    lastSignature = useRef(signature);

  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    // An unresolved attempt keeps its lock and its message. Every other state
    // starts over, so no old product name is reported next to new values.
    setStatus((current) =>
      current.phase === 'saving' ||
      current.phase === 'unknown' ||
      current.phase === 'checking'
        ? current
        : { phase: 'idle', text: '' },
    );
  }, [signature]);

  async function create() {
    if (inFlight.current || disabled) return;
    const built = productInputOf(position);
    if ('error' in built) {
      setStatus({ phase: 'rejected', text: built.error });
      return;
    }
    inFlight.current = true;
    attempt.current = built.input;
    setStatus({ phase: 'saving', text: 'Produkt wird angelegt …' });
    try {
      const response = await fetch('/api/v1/products', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(built.input),
      });
      if (!response.ok) {
        setStatus(
          [400, 401, 403, 409].includes(response.status)
            ? { phase: 'rejected', text: rejectionText(response.status) }
            : { phase: 'unknown', text: unknownMessage },
        );
        return;
      }
      const created = await response.json().catch(() => null);
      const row = storedProduct(created);
      if (
        !row ||
        !isSameProduct(row, built.input) ||
        row.unit !== built.input.unit ||
        row.taxBasisPoints !== built.input.taxBasisPoints
      ) {
        setStatus({ phase: 'unknown', text: unknownMessage });
        return;
      }
      setStatus({
        phase: 'created',
        text: `Als Produkt gespeichert: ${row.name}.`,
      });
    } catch {
      setStatus({ phase: 'unknown', text: unknownMessage });
    } finally {
      inFlight.current = false;
    }
  }

  async function checkInventory() {
    if (inFlight.current || disabled) return;
    const input = attempt.current;
    if (!input) return;
    inFlight.current = true;
    setStatus({ phase: 'checking', text: 'Bestand wird geprüft …' });
    try {
      const response = await fetch('/api/v1/products');
      if (!response.ok) throw new Error('stock');
      const loaded: unknown = await response.json();
      if (!Array.isArray(loaded)) throw new Error('stock');
      const match = loaded
        .map(storedProduct)
        .find(
          (row): row is StoredProduct =>
            row !== null && isSameProduct(row, input),
        );
      if (match) {
        setStatus({
          phase: 'found',
          text: `Bereits vorhanden: ${match.name} — ${money(match.priceMinor)} ${basisText(match.priceBasis)}, ${taxText(match.taxBasisPoints)} Steuer. Es wurde nichts erneut angelegt.`,
        });
        return;
      }
      setStatus({ phase: 'absent', text: missingMessage });
    } catch {
      setStatus({ phase: 'unknown', text: checkFailedMessage });
    } finally {
      inFlight.current = false;
    }
  }

  const busy = status.phase === 'saving' || status.phase === 'checking',
    // A confirmed or found product is not created a second time by the same
    // row and the same values; editing the row starts a new deliberate action.
    createLocked =
      busy ||
      status.phase === 'created' ||
      status.phase === 'unknown' ||
      status.phase === 'found',
    mayCheck = status.phase === 'unknown' || status.phase === 'found',
    alert = status.phase === 'rejected' || status.phase === 'unknown';
  return (
    <div className="offer-draft-position-product">
      <button
        type="button"
        className="tertiary-action"
        aria-label={`${label} als Produkt speichern`}
        title="Produktstamm aus dieser Position anlegen"
        disabled={disabled || createLocked}
        onClick={() => void create()}
      >
        Als Produkt speichern
      </button>
      {mayCheck && (
        <button
          type="button"
          className="tertiary-action"
          disabled={disabled || busy}
          onClick={() => void checkInventory()}
        >
          Bestand prüfen
        </button>
      )}
      {status.text && <p role={alert ? 'alert' : 'status'}>{status.text}</p>}
    </div>
  );
}
