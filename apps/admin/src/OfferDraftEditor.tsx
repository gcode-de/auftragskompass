import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { registerUnsavedChanges } from './unsaved-changes.js';
import { exactMinorUnits } from './FilesPanel.js';
import { formatHundredths, parseHundredths } from './decimal.js';
import { DiscountField } from './DiscountField.js';
import { PositionRemoveDialog } from './PositionRemoveDialog.js';
import {
  ProductPickerDialog,
  catalogProductsOf,
  type CatalogProduct,
} from './ProductPickerDialog.js';
import {
  PositionProductStatus,
  usePositionProduct,
  type PositionProductSource,
} from './SavePositionAsProduct.js';

type DraftValues = {
  subject: string;
  introText: string;
  outroText: string;
  validityDays: string;
  // RG-07: only an invoice family draft shows these two fields. They stay in the
  // form values for every kind, so one dirty comparison covers the whole editor.
  serviceDate: string;
  paymentTermDays: string;
  // RG-07b: the printed account, free text and possibly multi-line. Field of the
  // same invoice family, and part of the same dirty comparison.
  bankAccount: string;
  // DOC-PRODUCT-01.5: one discount for the whole document. An empty kind is the
  // deliberate "no discount" choice; both values are kept apart so a switch
  // never converts or reinterprets one of them.
  totalDiscountKind: '' | 'percent' | 'amount';
  totalDiscountPercent: string;
  totalDiscountAmount: string;
  totalDiscountNote: string;
};
type DraftItem = {
  kind?: never;
  id: string;
  position: number;
  productId: string | null;
  description: string;
  infoText?: string;
  optional?: boolean;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
  /**
   * DOC-PRODUCT-01.4: a stored fixed discount. Absent or null keeps the
   * percentage meaning of `discountBasisPoints`.
   */
  discountAmountMinor?: number | null;
  /** An older payload omits it; a stored line without a basis is gross. */
  priceBasis?: 'gross' | 'net';
};
type DraftInfo = {
  kind: 'info';
  id: string;
  position: number;
  description: string;
};
type DraftLine = DraftItem | DraftInfo;
const infoTextLimit = 4000;
// DOC-PRODUCT-01.5: the comment printed behind "Gesamtrabatt" is bounded by the
// same number the core enforces.
const totalDiscountNoteLimit = 500;

type DraftItemValues = {
  kind?: never;
  key: string;
  productId: string | null;
  description: string;
  infoText: string;
  optional: boolean;
  quantity: string;
  unit: string;
  unitPrice: string;
  tax: string;
  discount: string;
  // DOC-PRODUCT-01.4: one discount per line. The mode decides which value the
  // core uses; both values are kept so a switch never converts or resets one.
  discountMode: 'percent' | 'amount';
  discountAmount: string;
  priceBasis: 'gross' | 'net';
};
type DraftLineValues =
  DraftItemValues | { kind: 'info'; key: string; description: string };
type DraftDetail = {
  id: string;
  templateId: string | null;
  state: string;
  version: number;
  subject: string | null;
  introText: string | null;
  outroText: string | null;
  validityDays: number | null;
  // RG-07: the invoice dates. Absent for every other kind and in older payloads.
  serviceDate?: string | null;
  paymentTermDays?: number | null;
  dueDate?: string | null;
  // RG-07b: the free-text account, loaded and rewritten with the same payload.
  bankAccount?: string | null;
  /**
   * DOC-PRODUCT-01.5: the one document discount. Absent on every answer without
   * one, so an old payload keeps exactly its old shape.
   */
  totalDiscountKind?: 'percent' | 'amount' | null;
  totalDiscountValue?: number | null;
  totalDiscountNote?: string | null;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  lines: DraftLine[];
};
type DraftTemplate = {
  id: string;
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
};
type Props = {
  documentId: string;
  csrfToken: string;
  // BKP019.b2: one editor serves both draft kinds; only the heading names the
  // document. An offer is the default, so its wording cannot change.
  kind?: string;
  finalizing?: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onProtectedChange: ((protectedEditor: boolean) => void) | undefined;
  onSavedMetadata: (
    metadata: Pick<
      DraftDetail,
      | 'version'
      | 'netMinor'
      | 'taxMinor'
      | 'grossMinor'
      | 'serviceDate'
      | 'paymentTermDays'
      | 'dueDate'
      | 'bankAccount'
    > & { hasPricedLines: boolean },
  ) => void;
};

// RG-07/07b: what the editor loads from a document or a template. The invoice
// fields are optional because a template and an older payload never carry them.
type DraftContentValues = {
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
  serviceDate?: string | null;
  paymentTermDays?: number | null;
  bankAccount?: string | null;
  totalDiscountKind?: 'percent' | 'amount' | null;
  totalDiscountValue?: number | null;
  totalDiscountNote?: string | null;
};

function valuesOf(values: DraftContentValues): DraftValues {
  const totalDiscountKind =
    values.totalDiscountKind === 'percent' ||
    values.totalDiscountKind === 'amount'
      ? values.totalDiscountKind
      : '';
  return {
    subject: values.subject,
    introText: values.introText,
    outroText: values.outroText,
    validityDays: String(values.validityDays),
    // An empty field is "not entered", never the string "null".
    serviceDate: values.serviceDate ?? '',
    paymentTermDays:
      values.paymentTermDays === null || values.paymentTermDays === undefined
        ? ''
        : String(values.paymentTermDays),
    bankAccount: values.bankAccount ?? '',
    // DOC-PRODUCT-01.5: the stored value belongs to the stored kind alone; the
    // other field starts neutral instead of mirroring it.
    totalDiscountKind,
    totalDiscountPercent:
      totalDiscountKind === 'percent'
        ? formatHundredths(values.totalDiscountValue ?? 0)
        : '0.00',
    totalDiscountAmount:
      totalDiscountKind === 'amount'
        ? formatHundredths(values.totalDiscountValue ?? 0)
        : '0.00',
    totalDiscountNote: values.totalDiscountNote ?? '',
  };
}

function isDetail(value: unknown): value is DraftDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<DraftDetail>;
  const allNull =
      detail.subject === null &&
      detail.introText === null &&
      detail.outroText === null &&
      detail.validityDays === null,
    savedContent =
      typeof detail.subject === 'string' &&
      detail.subject.length <= 200 &&
      typeof detail.introText === 'string' &&
      detail.introText.length <= 4000 &&
      typeof detail.outroText === 'string' &&
      detail.outroText.length <= 4000 &&
      Number.isInteger(detail.validityDays) &&
      detail.validityDays! >= 1 &&
      detail.validityDays! <= 365;
  return (
    typeof detail.id === 'string' &&
    (typeof detail.templateId === 'string' || detail.templateId === null) &&
    detail.state === 'draft' &&
    Number.isInteger(detail.version) &&
    Number.isSafeInteger(detail.netMinor) &&
    detail.netMinor! >= 0 &&
    Number.isSafeInteger(detail.taxMinor) &&
    detail.taxMinor! >= 0 &&
    Number.isSafeInteger(detail.grossMinor) &&
    detail.grossMinor! >= 0 &&
    // DOC-PRODUCT-01.5: the discount is optional and judged by the server; the
    // editor only refuses an answer it could not show honestly.
    (detail.totalDiscountKind === undefined ||
      detail.totalDiscountKind === null ||
      detail.totalDiscountKind === 'percent' ||
      detail.totalDiscountKind === 'amount') &&
    (detail.totalDiscountValue === undefined ||
      detail.totalDiscountValue === null ||
      (Number.isSafeInteger(detail.totalDiscountValue) &&
        detail.totalDiscountValue >= 0)) &&
    (detail.totalDiscountNote === undefined ||
      detail.totalDiscountNote === null ||
      (typeof detail.totalDiscountNote === 'string' &&
        detail.totalDiscountNote.length <= totalDiscountNoteLimit)) &&
    Array.isArray(detail.lines) &&
    (detail.templateId === null || detail.lines.length >= 1) &&
    detail.lines.length <= 1000 &&
    detail.lines.every(
      (line) =>
        line &&
        typeof line.id === 'string' &&
        Number.isInteger(line.position) &&
        typeof line.description === 'string' &&
        (line.kind === 'info'
          ? !invalidInfoText(line.description)
          : line.kind === undefined &&
            (line.productId === null || typeof line.productId === 'string') &&
            line.description.length <= 300 &&
            (line.optional === undefined ||
              typeof line.optional === 'boolean') &&
            (line.infoText === undefined ||
              (typeof line.infoText === 'string' &&
                line.infoText.length <= infoTextLimit)) &&
            typeof line.unit === 'string' &&
            line.unit.length <= 40 &&
            Number.isInteger(line.quantity) &&
            line.quantity >= 1 &&
            line.quantity <= 100000 &&
            Number.isSafeInteger(line.unitPriceMinor) &&
            line.unitPriceMinor >= 0 &&
            Number.isInteger(line.taxBasisPoints) &&
            line.taxBasisPoints >= 0 &&
            line.taxBasisPoints <= 10000 &&
            Number.isInteger(line.discountBasisPoints) &&
            line.discountBasisPoints >= 0 &&
            line.discountBasisPoints <= 10000 &&
            (line.discountAmountMinor === undefined ||
              line.discountAmountMinor === null ||
              (Number.isSafeInteger(line.discountAmountMinor) &&
                line.discountAmountMinor >= 0)) &&
            (line.priceBasis === undefined ||
              line.priceBasis === 'gross' ||
              line.priceBasis === 'net')),
    ) &&
    (allNull || savedContent)
  );
}

function hasSavedContent(detail: DraftDetail): detail is DraftDetail & {
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
} {
  return (
    typeof detail.subject === 'string' &&
    typeof detail.introText === 'string' &&
    typeof detail.outroText === 'string' &&
    Number.isInteger(detail.validityDays) &&
    detail.validityDays! >= 1 &&
    detail.validityDays! <= 365
  );
}

function lineValuesOf(lines: DraftLine[], previous: DraftLineValues[] = []) {
  return lines.map((line, index): DraftLineValues => {
    const key = previous[index]?.key ?? `saved-${line.id}`;
    if (line.kind === 'info') {
      return { key, kind: 'info', description: line.description };
    }
    return {
      key,
      productId: line.productId,
      description: line.description,
      infoText: line.infoText ?? '',
      optional: line.optional ?? false,
      quantity: String(line.quantity),
      unit: line.unit,
      unitPrice: formatHundredths(line.unitPriceMinor),
      tax: formatHundredths(line.taxBasisPoints),
      discount: formatHundredths(line.discountBasisPoints),
      // A stored amount is euro mode; an absent or null one keeps percentage
      // mode. The untouched value starts neutral instead of mirroring the rate.
      discountMode:
        typeof line.discountAmountMinor === 'number' ? 'amount' : 'percent',
      discountAmount:
        typeof line.discountAmountMinor === 'number'
          ? formatHundredths(line.discountAmountMinor)
          : '0.00',
      priceBasis: line.priceBasis === 'net' ? 'net' : 'gross',
    };
  });
}

function invalidInfoText(description: string) {
  return !description.trim() || description.length > infoTextLimit;
}

function lineDraft(line: DraftLineValues) {
  if (line.kind === 'info') {
    if (invalidInfoText(line.description)) throw new Error('info');
    return { kind: line.kind, description: line.description };
  }
  if (!line.description.trim() || line.description.length > 300)
    throw new Error('description');
  if (line.infoText.length > infoTextLimit) throw new Error('info');
  if (!line.unit.trim() || line.unit.length > 40) throw new Error('unit');
  if (!/^\d+$/.test(line.quantity)) throw new Error('quantity');
  const quantity = Number(line.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000)
    throw new Error('quantity');
  const unitPriceMinor = parseHundredths(line.unitPrice),
    taxBasisPoints = parseHundredths(line.tax),
    discountBasisPoints = parseHundredths(line.discount);
  if (taxBasisPoints > 10000 || discountBasisPoints > 10000)
    throw new Error('percent');
  return {
    productId: line.productId,
    description: line.description,
    ...(line.infoText.trim() ? { infoText: line.infoText } : {}),
    ...(line.optional ? { optional: true } : {}),
    quantity,
    unit: line.unit,
    unitPriceMinor,
    taxBasisPoints,
    discountBasisPoints,
    // DOC-PRODUCT-01.4: percentage mode names null, never 0 - a zero amount
    // would print "Rabatt 0,00 €". Euro mode sends the exact minor amount.
    discountAmountMinor:
      line.discountMode === 'amount'
        ? parseHundredths(line.discountAmount)
        : null,
    priceBasis: line.priceBasis,
  };
}

function decimalInvalid(value: string) {
  try {
    parseHundredths(value);
    return false;
  } catch {
    return true;
  }
}

// DOC-PRODUCT-01.5: kind and value are one decision, so "Kein Gesamtrabatt"
// names both halves and the note as null. The percentage is sent in basis points
// like a position, the euro amount as exact minor units like a price; a blank
// note is null, never an empty string that would print empty brackets.
function totalDiscountDraft(values: DraftValues) {
  if (
    values.totalDiscountKind !== 'percent' &&
    values.totalDiscountKind !== 'amount'
  )
    return {
      totalDiscountKind: null,
      totalDiscountValue: null,
      totalDiscountNote: null,
    };
  return {
    totalDiscountKind: values.totalDiscountKind,
    totalDiscountValue: parseHundredths(
      values.totalDiscountKind === 'percent'
        ? values.totalDiscountPercent
        : values.totalDiscountAmount,
    ),
    totalDiscountNote: values.totalDiscountNote.trim()
      ? values.totalDiscountNote
      : null,
  };
}

function totalDiscountInvalid(values: DraftValues) {
  if (!values.totalDiscountKind) return false;
  const value =
    values.totalDiscountKind === 'percent'
      ? values.totalDiscountPercent
      : values.totalDiscountAmount;
  try {
    parseHundredths(value);
  } catch {
    return true;
  }
  return (
    (values.totalDiscountKind === 'percent' && percentInvalid(value)) ||
    values.totalDiscountNote.length > totalDiscountNoteLimit
  );
}

function percentInvalid(value: string) {
  try {
    return parseHundredths(value) > 10000;
  } catch {
    return true;
  }
}

// The price field names the basis it stores. Switching the basis only renames
// the field; the amount moves unconverted and the core does the arithmetic.
function priceLabel(priceBasis: 'gross' | 'net') {
  return `Einzelpreis (${priceBasis === 'net' ? 'Netto' : 'Brutto'}) in Euro`;
}

// EDITOR-MOBILE-01: below the widest field-grid breakpoint (44rem, the width the
// stylesheet uses for the full field row) a phone-sized editor folds the five
// value fields of a position (quantity, unit, single price, tax and the discount
// with its kind switch) into one disclosure. The price basis is no longer one of
// them - since EDITOR-VISUAL-01 it is a switch of the row header. The query
// mirrors that breakpoint; without matchMedia the wide layout is the safe
// default.
const compactFieldsQuery = '(max-width: 43.99rem)';

function useCompactFields() {
  const [compact, setCompact] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia(compactFieldsQuery).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia(compactFieldsQuery);
    const changed = () => setCompact(viewport.matches);
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);
  return compact;
}

// The folded summary keeps the typed values readable: quantity and unit, the
// price with its unit and the tax rate. The values are shown exactly as typed -
// the editor never converts or rounds them for a preview.
function priceFieldsPreview(
  quantity: string,
  unit: string,
  price: string,
  tax: string,
) {
  const parts: string[] = [];
  const measure = `${quantity} ${unit}`.trim();
  if (measure) parts.push(measure);
  if (price) parts.push(`${price} €`);
  if (tax) parts.push(`${tax} %`);
  return parts.join(' · ');
}

// The same judgements the inputs publish as aria-invalid. They are named once so
// the disclosure and the field can never disagree about an error.
function quantityInvalid(value: string) {
  return !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100000;
}

function unitInvalid(value: string) {
  return !value.trim() || value.length > 40;
}

// EDITOR-MOBILE-01: the five folded fields decide together whether the group may
// stay closed - an invalid value is never hidden behind the summary.
function valueFieldsInvalid(line: DraftItemValues) {
  return (
    quantityInvalid(line.quantity) ||
    unitInvalid(line.unit) ||
    decimalInvalid(line.unitPrice) ||
    percentInvalid(line.tax) ||
    (line.discountMode === 'percent'
      ? percentInvalid(line.discount)
      : decimalInvalid(line.discountAmount))
  );
}

// BKP019.b2: the same editor edits an offer, an order confirmation and an
// invoice draft. The heading says which document is being corrected; anything
// else keeps the offer wording that existed before.
// BKP019.c2b: a correction draft is a draft like any other, so it is corrected
// here too - a wrong position must not be fixable only through the API.
// BKP019.c3.1: a deposit draft is corrected here as well; the heading names the
// advance so no invoice or offer wording can leak onto it.
function editorHeading(kind: string | undefined) {
  if (kind === 'order_confirmation') return 'Auftragsbestätigung bearbeiten';
  if (kind === 'correction') return 'Rechnungskorrektur bearbeiten';
  if (kind === 'deposit_invoice') return 'Anzahlungsrechnung bearbeiten';
  return kind === 'invoice' ? 'Rechnung bearbeiten' : 'Angebot bearbeiten';
}

// RG-07: the service day and the payment term are invoice fields. Only an
// invoice family draft shows them - an offer has no invoice day, and the server
// refuses the fields on every other kind instead of dropping them silently.
function showsInvoiceDates(kind: string | undefined) {
  return (
    kind === 'invoice' || kind === 'deposit_invoice' || kind === 'correction'
  );
}

function editorDiscardMessage(kind: string | undefined) {
  if (kind === 'order_confirmation')
    return 'Ungespeicherte Änderungen an der Auftragsbestätigung verwerfen?';
  if (kind === 'correction')
    return 'Ungespeicherte Änderungen an der Rechnungskorrektur verwerfen?';
  if (kind === 'deposit_invoice')
    return 'Ungespeicherte Änderungen an der Anzahlungsrechnung verwerfen?';
  return kind === 'invoice'
    ? 'Ungespeicherte Rechnungsänderungen verwerfen?'
    : 'Ungespeicherte Angebotsänderungen verwerfen?';
}

// EDITOR-VISUAL-02 (Bookitup parity, B37 deviation 1): the four row actions of
// a document position are one menu at the end of its header. The toggle is the
// only visible action and names its row; the group behind it carries the four
// entries. Every entry names the row and keeps the visible wording inside that
// name (axe rule label-content-name-mismatch), closes the menu and returns the
// focus to the toggle. The product status stays outside the closed menu, so its
// live messages keep being announced.
type PositionRowActionsProps = {
  title: string;
  menuId: string;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  removeDisabled: boolean;
  productDisabled: boolean;
  product: PositionProductSource | null;
  csrfToken: string;
  onMove: (direction: -1 | 1, origin: HTMLButtonElement) => void;
  onRemove: () => void;
  registerRemoveOrigin: (element: HTMLButtonElement | null) => void;
};

function PositionRowActions({
  title,
  menuId,
  canReorder,
  canMoveUp,
  canMoveDown,
  removeDisabled,
  productDisabled,
  product,
  csrfToken,
  onMove,
  onRemove,
  registerRemoveOrigin,
}: PositionRowActionsProps) {
  const [open, setOpen] = useState(false),
    toggle = useRef<HTMLButtonElement | null>(null),
    productState = usePositionProduct({
      position: product,
      csrfToken,
      disabled: productDisabled,
    }),
    menuLabel = `Aktionen für ${title}`;

  // House pattern: a chosen entry closes the group and the focus returns to the
  // toggle that opened it, never to an entry that is hidden again.
  function closeAndFocus() {
    setOpen(false);
    const element = toggle.current;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }

  function choose(destination: -1 | 1) {
    const origin = toggle.current;
    closeAndFocus();
    if (origin) onMove(destination, origin);
  }

  return (
    <div
      className="offer-draft-position-actions"
      role="group"
      aria-label="Aktionen dieser Zeile"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // Escape closes the menu only; without stopping here the editor-level
        // handler would close the whole draft.
        event.preventDefault();
        event.stopPropagation();
        closeAndFocus();
      }}
    >
      <button
        ref={(element) => {
          toggle.current = element;
          registerRemoveOrigin(element);
        }}
        type="button"
        className="icon-action tier-quiet-icon offer-draft-actions-toggle"
        aria-label={menuLabel}
        title={menuLabel}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      <div
        id={menuId}
        className="offer-draft-actions-menu"
        role="group"
        aria-label={menuLabel}
        hidden={!open}
      >
        <button
          type="button"
          className="tertiary-action"
          aria-label={`${title} nach oben schieben`}
          disabled={!canReorder}
          aria-disabled={!canMoveUp}
          onClick={() => choose(-1)}
        >
          Nach oben schieben
        </button>
        <button
          type="button"
          className="tertiary-action"
          aria-label={`${title} nach unten schieben`}
          disabled={!canReorder}
          aria-disabled={!canMoveDown}
          onClick={() => choose(1)}
        >
          Nach unten schieben
        </button>
        {product && (
          <button
            type="button"
            className="tertiary-action"
            aria-label={`${title} als Produkt speichern`}
            disabled={productDisabled || productState.createLocked}
            onClick={() => {
              closeAndFocus();
              void productState.create();
            }}
          >
            Als Produkt speichern
          </button>
        )}
        <button
          type="button"
          className="tertiary-action"
          aria-label={`${title}: Position entfernen`}
          disabled={removeDisabled}
          onClick={() => {
            closeAndFocus();
            onRemove();
          }}
        >
          Position entfernen
        </button>
      </div>
      {product && (
        <PositionProductStatus
          state={productState}
          disabled={productDisabled}
        />
      )}
    </div>
  );
}

export function OfferDraftEditor({
  documentId,
  csrfToken,
  kind,
  finalizing = false,
  onClose,
  onDirtyChange,
  onBusyChange,
  onProtectedChange,
  onSavedMetadata,
}: Props) {
  const [values, setValues] = useState<DraftValues | null>(null),
    [baseline, setBaseline] = useState<DraftValues | null>(null),
    [lineValues, setLineValues] = useState<DraftLineValues[]>([]),
    [baselineLines, setBaselineLines] = useState<DraftLineValues[]>([]),
    [detail, setDetail] = useState<DraftDetail | null>(null),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [legacy, setLegacy] = useState(false),
    [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    // DOC-PRODUCT-01.5: a server refusal that names the content marks the
    // discount field, without a second alert beside the one message line.
    [discountRejected, setDiscountRejected] = useState(false),
    [focusInitialEditor, setFocusInitialEditor] = useState(false),
    [productPickerOpen, setProductPickerOpen] = useState(false),
    [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]),
    [catalogState, setCatalogState] = useState<
      'idle' | 'loading' | 'ready' | 'error'
    >('idle'),
    [catalogMessage, setCatalogMessage] = useState(''),
    [dropTarget, setDropTarget] = useState(''),
    // EDITOR-MOBILE-01: the folded price group of a position is opened by its
    // key and stays open until the operator closes it. A visible field error
    // opens it regardless, so a mistake can never hide behind the summary.
    [openPriceFields, setOpenPriceFields] = useState<string[]>([]),
    // EDITOR-ACTIONS-01: the row that waits for its removal confirmation. No
    // position changes until the question is answered.
    [removeCandidate, setRemoveCandidate] = useState<{
      key: string;
      title: string;
    } | null>(null),
    [moveAnnouncement, setMoveAnnouncement] = useState({
      sequence: 0,
      text: '',
    }),
    draggedLine = useRef(''),
    pendingMoveFocus = useRef<HTMLButtonElement | null>(null),
    removeButtonRefs = useRef(new Map<string, HTMLButtonElement>()),
    request = useRef(0),
    lineSequence = useRef(0),
    catalogRequest = useRef<Promise<void> | null>(null),
    // EDITOR-PICKER-01: one add per gesture. The dialog closes itself, and this
    // lock keeps a same-tick double activation from appending twice.
    catalogAddInFlight = useRef(false),
    busyRef = useRef(false),
    dirtyRef = useRef(false),
    subjectInput = useRef<HTMLInputElement | null>(null),
    productButtonRef = useRef<HTMLButtonElement | null>(null),
    lineInputRefs = useRef(
      new Map<string, HTMLInputElement | HTMLTextAreaElement>(),
    ),
    pendingLineFocus = useRef(''),
    callbacks = useRef({
      onDirtyChange,
      onBusyChange,
      onSavedMetadata,
      onProtectedChange,
    });
  callbacks.current = {
    onDirtyChange,
    onBusyChange,
    onSavedMetadata,
    onProtectedChange,
  };

  const compactFields = useCompactFields();
  const busy = saving || finalizing;
  const dirty = Boolean(
    values &&
    baseline &&
    (JSON.stringify(values) !== JSON.stringify(baseline) ||
      JSON.stringify(lineValues) !== JSON.stringify(baselineLines)),
  );
  dirtyRef.current = dirty;
  const needsSave = dirty || legacy;
  // RG-07: both fields are optional; an empty input means "not entered". The
  // calendar day and the range are judged again on the server, which owns the
  // tenant clock - this guard only keeps an obviously wrong value from being
  // sent.
  const showsDates = showsInvoiceDates(kind),
    serviceDay = values?.serviceDate.trim() ?? '',
    paymentTerm = values?.paymentTermDays.trim() ?? '',
    // RG-07b: the account is printed word for word, so the editor keeps the
    // typed text (the server trims and bounds it once, on save).
    bankAccountText = values?.bankAccount ?? '',
    validServiceDay =
      !showsDates || !serviceDay || /^\d{4}-\d{2}-\d{2}$/.test(serviceDay),
    validPaymentTerm =
      !showsDates ||
      !paymentTerm ||
      (/^\d{1,3}$/.test(paymentTerm) && Number(paymentTerm) <= 365);
  // DOC-PRODUCT-01.5: the one document discount. Only the field the chosen kind
  // drives is shown, so no hidden value can ever be sent by accident.
  const totalDiscountKind = values?.totalDiscountKind ?? '',
    totalDiscountValue =
      totalDiscountKind === 'percent'
        ? (values?.totalDiscountPercent ?? '')
        : totalDiscountKind === 'amount'
          ? (values?.totalDiscountAmount ?? '')
          : '',
    totalDiscountValueInvalid = values ? totalDiscountInvalid(values) : false,
    validTotalDiscount = !totalDiscountValueInvalid,
    totalDiscountNote = values?.totalDiscountNote ?? '';
  const days = Number(values?.validityDays),
    validDays = Number.isInteger(days) && days >= 1 && days <= 365,
    validLines =
      lineValues.length >= 1 &&
      lineValues.length <= 1000 &&
      lineValues.every((line) => {
        try {
          lineDraft(line);
          return true;
        } catch {
          return false;
        }
      }),
    isBlocked = conflict || uncertain;
  const hasPricedLines = lineValues.some((line) => line.kind !== 'info'),
    hasOptionalLines = lineValues.some(
      (line) => line.kind !== 'info' && line.optional,
    );

  const loadDraft = useCallback(
    async (focusEditor = false) => {
      const ticket = ++request.current;
      setLoading(true);
      callbacks.current.onBusyChange(true);
      setMessage('');
      setError(false);
      try {
        const reply = await fetch('/api/v1/documents/' + documentId);
        if (!reply.ok) throw new Error('detail');
        const loaded: unknown = await reply.json();
        if (!isDetail(loaded) || loaded.id !== documentId)
          throw new Error('detail');
        // RG-07b: the stored invoice fields travel into the form as well - a
        // reload shows what is saved instead of an empty field whose next save
        // would clear a value nobody wanted to touch.
        let next: DraftContentValues | null = hasSavedContent(loaded)
          ? {
              subject: loaded.subject,
              introText: loaded.introText,
              outroText: loaded.outroText,
              validityDays: loaded.validityDays,
              serviceDate: loaded.serviceDate ?? null,
              paymentTermDays: loaded.paymentTermDays ?? null,
              bankAccount: loaded.bankAccount ?? null,
              // DOC-PRODUCT-01.5: the stored discount travels with the same
              // payload; a missing one is the deliberate "no discount".
              totalDiscountKind: loaded.totalDiscountKind ?? null,
              totalDiscountValue: loaded.totalDiscountValue ?? null,
              totalDiscountNote: loaded.totalDiscountNote ?? null,
            }
          : null;
        let fromLegacy = false;
        if (!next) {
          const templateReply = await fetch('/api/v1/document-templates');
          if (!templateReply.ok) throw new Error('template');
          const templates = (await templateReply.json()) as DraftTemplate[];
          const template = Array.isArray(templates)
            ? templates.find((entry) => entry.id === loaded.templateId)
            : undefined;
          if (
            !template ||
            typeof template.subject !== 'string' ||
            typeof template.introText !== 'string' ||
            typeof template.outroText !== 'string' ||
            !Number.isInteger(template.validityDays) ||
            template.validityDays < 1 ||
            template.validityDays > 365
          )
            throw new Error('template');
          next = template;
          fromLegacy = true;
        }
        if (ticket !== request.current) return;
        const formValues = valuesOf(next);
        const formLines = lineValuesOf(loaded.lines);
        setDetail(loaded);
        setValues(formValues);
        setBaseline(formValues);
        setLineValues(formLines);
        setBaselineLines(formLines);
        setLegacy(fromLegacy);
        setConflict(false);
        setUncertain(false);
        setDiscountRejected(false);
        callbacks.current.onDirtyChange(
          fromLegacy || loaded.lines.length === 0,
        );
        callbacks.current.onSavedMetadata({
          version: loaded.version,
          netMinor: loaded.netMinor,
          taxMinor: loaded.taxMinor,
          grossMinor: loaded.grossMinor,
          hasPricedLines: loaded.lines.some((line) => line.kind !== 'info'),
          // RG-07: the row shows the saved invoice dates without a reload.
          serviceDate: loaded.serviceDate ?? null,
          paymentTermDays: loaded.paymentTermDays ?? null,
          dueDate: loaded.dueDate ?? null,
          bankAccount: loaded.bankAccount ?? null,
        });
        setMessage(fromLegacy ? '' : 'Entwurf geladen.');
        if (focusEditor) setFocusInitialEditor(true);
      } catch {
        if (ticket !== request.current) return;
        setError(true);
        setMessage(
          'Entwurf konnte nicht geladen werden. Ihre Eingaben bleiben erhalten. Bitte erneut laden.',
        );
      } finally {
        if (ticket === request.current) {
          setLoading(false);
          callbacks.current.onBusyChange(false);
        }
      }
    },
    [documentId],
  );

  useEffect(() => {
    void loadDraft(true);
    return () => {
      request.current += 1;
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    };
  }, [loadDraft]);

  useEffect(() => {
    callbacks.current.onDirtyChange(
      needsSave || isBlocked || lineValues.length === 0,
    );
  }, [isBlocked, lineValues.length, needsSave]);
  useEffect(() => {
    if (!focusInitialEditor || !values) return;
    subjectInput.current?.scrollIntoView?.({ block: 'start' });
    subjectInput.current?.focus();
    setFocusInitialEditor(false);
  }, [focusInitialEditor, values]);
  useEffect(() => {
    if (pendingMoveFocus.current) {
      pendingMoveFocus.current.focus();
      pendingMoveFocus.current = null;
    }
    if (!pendingLineFocus.current) return;
    const input = lineInputRefs.current.get(pendingLineFocus.current);
    if (input) {
      input.scrollIntoView?.({ block: 'nearest' });
      input.focus();
    }
    pendingLineFocus.current = '';
  }, [lineValues]);
  const protectedRef = useRef(false);
  const protectedEditor = dirty || busy;
  protectedRef.current = protectedEditor;
  useEffect(() => registerUnsavedChanges(() => protectedRef.current, true), []);
  useEffect(() => {
    callbacks.current.onProtectedChange?.(protectedEditor);
    return () => callbacks.current.onProtectedChange?.(false);
  }, [protectedEditor]);

  function close() {
    if (busyRef.current || finalizing) return;
    if (dirtyRef.current && !window.confirm(editorDiscardMessage(kind))) return;
    callbacks.current.onDirtyChange(false);
    onClose();
  }

  function change<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    if (finalizing) return;
    setValues((current) => (current ? { ...current, [key]: value } : current));
  }

  // DOC-PRODUCT-01.5: "Kein Gesamtrabatt" clears the whole discount, so a later
  // switch never revives an amount or a note the operator already dropped.
  function changeTotalDiscountKind(next: DraftValues['totalDiscountKind']) {
    if (finalizing) return;
    setDiscountRejected(false);
    setValues((current) =>
      current
        ? {
            ...current,
            totalDiscountKind: next,
            ...(next
              ? {}
              : {
                  totalDiscountPercent: '0.00',
                  totalDiscountAmount: '0.00',
                  totalDiscountNote: '',
                }),
          }
        : current,
    );
  }

  function changeLine<K extends keyof DraftItemValues>(
    key: string,
    field: K,
    value: DraftItemValues[K],
  ) {
    if (finalizing) return;
    setLineValues((current) =>
      current.map((line) =>
        line.key === key && field in line ? { ...line, [field]: value } : line,
      ),
    );
  }

  // EDITOR-MOBILE-01: opening and closing is one deliberate act of the operator.
  // The state survives blur, save and re-renders, so nothing folds away while
  // someone is still working in the group.
  function togglePriceFields(key: string) {
    setOpenPriceFields((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    );
  }

  function registerLineInput(
    key: string,
    element: HTMLInputElement | HTMLTextAreaElement | null,
  ) {
    if (element) lineInputRefs.current.set(key, element);
    else lineInputRefs.current.delete(key);
  }

  function addLine() {
    if (lineValues.length >= 1000 || busyRef.current || finalizing || isBlocked)
      return;
    lineSequence.current += 1;
    const key = `free-${lineSequence.current}`;
    pendingLineFocus.current = key;
    setLineValues((current) => [
      ...current,
      {
        key,
        productId: null,
        description: '',
        infoText: '',
        quantity: '1',
        unit: 'Stück',
        unitPrice: '0.00',
        tax: '19.00',
        discount: '0.00',
        discountMode: 'percent',
        discountAmount: '0.00',
        priceBasis: 'gross',
        optional: false,
      },
    ]);
  }

  function loadCatalog() {
    if (catalogRequest.current) return catalogRequest.current;
    setCatalogState('loading');
    setCatalogMessage('');
    const pending = (async () => {
      try {
        const response = await fetch('/api/v1/products');
        if (!response.ok) throw new Error('catalog');
        const loaded: unknown = await response.json();
        const active = catalogProductsOf(loaded);
        if (!active) throw new Error('catalog');
        setCatalogProducts(active);
        setCatalogState('ready');
        setCatalogMessage('');
      } catch {
        setCatalogState('error');
        setCatalogMessage('Produktkatalog konnte nicht geladen werden.');
      } finally {
        catalogRequest.current = null;
      }
    })();
    catalogRequest.current = pending;
    return pending;
  }

  function openProductPicker() {
    if (
      busyRef.current ||
      finalizing ||
      loading ||
      isBlocked ||
      lineValues.length >= 1000
    )
      return;
    catalogAddInFlight.current = false;
    setCatalogMessage('');
    setProductPickerOpen(true);
    if (catalogState === 'idle' || catalogState === 'error') void loadCatalog();
  }

  // EDITOR-PICKER-01: one deliberate add appends every chosen product as a
  // position, in the order the catalog list showed them. The values are the
  // unchanged catalog snapshot; the core converts and rounds, never the editor.
  function addCatalogProducts(selected: CatalogProduct[]) {
    if (
      catalogAddInFlight.current ||
      busyRef.current ||
      finalizing ||
      loading ||
      isBlocked ||
      catalogState !== 'ready' ||
      selected.length === 0
    )
      return;
    if (lineValues.length + selected.length > 1000) {
      setCatalogMessage(
        'Ein Dokument kann höchstens 1.000 Positionen enthalten. Wählen Sie weniger Produkte.',
      );
      return;
    }
    const information = selected.map(
      (product) => product.description?.trim() ?? '',
    );
    if (information.some((text) => text.length > infoTextLimit)) {
      setCatalogMessage(
        'Der Infotext eines Produkts ist zu lang. Kürzen Sie die Beschreibung im Katalog auf höchstens 4.000 Zeichen.',
      );
      return;
    }
    catalogAddInFlight.current = true;
    const added = selected.map((product, index): DraftItemValues => {
      lineSequence.current += 1;
      return {
        key: `catalog-${lineSequence.current}`,
        productId: product.id,
        description: product.name,
        infoText: information[index] ?? '',
        quantity: '1',
        unit: product.unit,
        unitPrice: formatHundredths(product.priceMinor),
        priceBasis: product.priceBasis === 'net' ? 'net' : 'gross',
        tax: formatHundredths(product.taxBasisPoints),
        discount: '0.00',
        discountMode: 'percent',
        discountAmount: '0.00',
        optional: false,
      };
    });
    pendingLineFocus.current = added[0]!.key;
    setLineValues((current) => [...current, ...added]);
    setProductPickerOpen(false);
    setCatalogMessage('');
  }

  // EDITOR-ACTIONS-01: removal is a deliberate two-step action. The question
  // reuses the shared form dialog; every cancel path returns the focus to the
  // icon that asked, and only the confirmation removes the position.
  function askRemove(key: string, title: string) {
    if (finalizing || busyRef.current) return;
    setRemoveCandidate({ key, title });
  }

  function cancelRemove() {
    const candidate = removeCandidate;
    setRemoveCandidate(null);
    if (candidate) removeButtonRefs.current.get(candidate.key)?.focus();
  }

  function confirmRemove() {
    const candidate = removeCandidate;
    setRemoveCandidate(null);
    if (candidate) removeLine(candidate.key);
  }

  function removeLine(key: string) {
    if (finalizing) return;
    if (lineValues.length <= 1) return;
    const index = lineValues.findIndex((line) => line.key === key);
    setLineValues((current) => {
      const remaining = current.filter((line) => line.key !== key),
        next = remaining[Math.min(index, remaining.length - 1)];
      pendingLineFocus.current = next?.key ?? '';
      return remaining;
    });
  }

  function moveLine(
    key: string,
    destination: number,
    control?: HTMLButtonElement,
  ) {
    if (busyRef.current || busy || loading || isBlocked) return;
    const source = lineValues.findIndex((line) => line.key === key);
    if (
      source < 0 ||
      destination < 0 ||
      destination >= lineValues.length ||
      source === destination
    )
      return;
    const next = [...lineValues];
    const [moved] = next.splice(source, 1);
    next.splice(destination, 0, moved!);
    pendingMoveFocus.current = control ?? null;
    setLineValues(next);
    setMoveAnnouncement(({ sequence }) => ({
      sequence: sequence + 1,
      text: `Zeile von Stelle ${source + 1} an Stelle ${destination + 1} verschoben.`,
    }));
  }

  function clearDrag() {
    draggedLine.current = '';
    setDropTarget('');
  }

  async function reload() {
    if (busyRef.current || finalizing) return;
    if (
      dirtyRef.current &&
      !window.confirm(
        'Ungespeicherte Eingaben verwerfen und aktuellen Serverstand laden?',
      )
    )
      return;
    await loadDraft();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busyRef.current ||
      finalizing ||
      !values ||
      !detail ||
      !needsSave ||
      !validDays ||
      !validServiceDay ||
      !validPaymentTerm ||
      !validTotalDiscount ||
      !validLines ||
      isBlocked
    )
      return;
    busyRef.current = true;
    setSaving(true);
    callbacks.current.onBusyChange(true);
    setMessage('');
    setError(false);
    setDiscountRejected(false);
    try {
      const body = JSON.stringify({
        version: detail.version,
        subject: values.subject,
        introText: values.introText,
        outroText: values.outroText,
        validityDays: days,
        // DOC-PRODUCT-01.5: kind and value travel together, and "Kein
        // Gesamtrabatt" names both halves as null. The editor never computes a
        // second total - the server owns every sum.
        ...totalDiscountDraft(values),
        // RG-07: only an invoice family body carries the two dates, so the
        // offer and the confirmation keep exactly the body they always sent.
        ...(showsDates
          ? {
              serviceDate: serviceDay || null,
              paymentTermDays: paymentTerm === '' ? null : Number(paymentTerm),
              // RG-07b: a blank field clears the account, an omitted one keeps
              // it - the editor always names the field it shows.
              bankAccount: bankAccountText.trim() ? bankAccountText : null,
            }
          : {}),
        lines: lineValues.map(lineDraft),
      });
      // The draft endpoint uses Fastify's default 1 MiB request-body limit.
      if (new TextEncoder().encode(body).byteLength > 1024 * 1024) {
        setError(true);
        setMessage(
          'Der Entwurf ist zu groß. Bitte kürzen Sie die Texte und speichern Sie erneut.',
        );
        return;
      }
      const reply = await fetch('/api/v1/documents/' + documentId + '/draft', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body,
      });
      if (!reply.ok) {
        const result = (await reply.json().catch(() => ({}))) as {
          error?: string;
        };
        if (reply.status === 409) {
          setConflict(true);
          setError(true);
          setMessage(
            'Der Entwurf wurde zwischenzeitlich geändert. Ihre Eingaben bleiben erhalten. Laden Sie den aktuellen Serverstand neu.',
          );
        } else {
          setError(true);
          setMessage(
            result.error === 'invalid_state'
              ? 'Der Entwurf ist nicht mehr bearbeitbar. Bitte neu laden.'
              : result.error === 'forbidden'
                ? 'Speichern nicht erlaubt. Bitte Anmeldung und Berechtigung prüfen.'
                : result.error === 'invalid_line'
                  ? 'Eine Position ist ungültig. Prüfen Sie insbesondere den Rabattbetrag: Er darf die Positionssumme nicht übersteigen.'
                  : // DOC-PRODUCT-01.5: the one document discount has its own
                    // bound - an amount above the total is a typing mistake.
                    result.error === 'invalid_content'
                    ? 'Der Gesamtrabatt wurde abgelehnt. Prüfen Sie Art und Betrag: Der Abzug darf den Gesamtbetrag nicht übersteigen. Auch die Anmerkung darf keine Steuerzeichen enthalten.'
                    : 'Änderungen wurden nicht gespeichert. Bitte Eingaben prüfen und erneut versuchen.',
          );
          if (result.error === 'invalid_content') setDiscountRejected(true);
        }
        return;
      }
      const saved: unknown = await reply.json();
      if (
        !isDetail(saved) ||
        saved.id !== documentId ||
        !hasSavedContent(saved)
      )
        throw new Error('uncertain');
      const savedValues = valuesOf(saved);
      const savedLines = lineValuesOf(saved.lines, lineValues);
      setDetail(saved);
      setValues(savedValues);
      setBaseline(savedValues);
      setLineValues(savedLines);
      setBaselineLines(savedLines);
      setLegacy(false);
      setConflict(false);
      setUncertain(false);
      callbacks.current.onSavedMetadata({
        version: saved.version,
        netMinor: saved.netMinor,
        taxMinor: saved.taxMinor,
        grossMinor: saved.grossMinor,
        hasPricedLines: saved.lines.some((line) => line.kind !== 'info'),
        // RG-07: the row shows the saved invoice dates without a reload.
        serviceDate: saved.serviceDate ?? null,
        paymentTermDays: saved.paymentTermDays ?? null,
        dueDate: saved.dueDate ?? null,
        bankAccount: saved.bankAccount ?? null,
      });
      setMessage('Änderungen gespeichert.');
    } catch {
      setUncertain(true);
      setError(true);
      setMessage(
        'Speicherstatus ist unklar. Bitte den Entwurf neu laden, bevor Sie erneut speichern.',
      );
    } finally {
      busyRef.current = false;
      setSaving(false);
      callbacks.current.onBusyChange(false);
    }
  }

  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  let itemNumber = 0;
  return (
    <section
      className="offer-draft-editor"
      aria-labelledby={'offer-editor-' + documentId}
      onKeyDown={escape}
    >
      <div className="offer-draft-editor-heading">
        <h5 id={'offer-editor-' + documentId}>{editorHeading(kind)}</h5>
        <button
          type="button"
          className="tertiary-action"
          aria-label="Bearbeitung schließen"
          disabled={busy}
          onClick={close}
        >
          Schließen
        </button>
      </div>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {finalizing && <p role="status">Dokument wird finalisiert …</p>}
      {legacy && (
        <p className="document-hint">
          Dieser ältere Entwurf enthält keine gespeicherten Texte. Die aktuelle
          Vorlage dient nur als Ausgangspunkt; erst beim Speichern werden diese
          Werte in den Entwurf übernommen.
        </p>
      )}
      {detail && (
        <>
          <form onSubmit={(event) => void save(event)}>
            {/* EDITOR-LAYOUT-01: the head fields are one named group instead of
                a loose grid, so a narrow editor stacks them without squeezing a
                label or a value. */}
            <fieldset className="offer-draft-group">
              <legend>Kopfdaten und Einleitung</legend>
              <div className="offer-draft-fields">
                <label>
                  Betreff
                  <input
                    ref={subjectInput}
                    className="offer-draft-subject"
                    value={values?.subject ?? ''}
                    maxLength={200}
                    disabled={!values || loading || busy}
                    onChange={(event) => change('subject', event.target.value)}
                  />
                </label>
                <label>
                  Einleitung
                  <textarea
                    value={values?.introText ?? ''}
                    maxLength={4000}
                    rows={4}
                    disabled={!values || loading || busy}
                    onChange={(event) =>
                      change('introText', event.target.value)
                    }
                  />
                </label>
                <label>
                  Gültigkeit in Tagen
                  <input
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={values?.validityDays ?? ''}
                    disabled={!values || loading || busy}
                    onChange={(event) =>
                      change('validityDays', event.target.value)
                    }
                  />
                </label>
                {/* RG-07: the two invoice dates. A draft keeps the input; the due
                  day is computed by the server when the document is finalized. */}
                {showsDates && (
                  <>
                    <label>
                      Leistungsdatum (optional)
                      <input
                        type="date"
                        value={values?.serviceDate ?? ''}
                        disabled={!values || loading || busy}
                        aria-invalid={!validServiceDay}
                        onChange={(event) =>
                          change('serviceDate', event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Zahlungsziel in Tagen (optional)
                      <input
                        type="number"
                        min={0}
                        max={365}
                        step={1}
                        value={values?.paymentTermDays ?? ''}
                        disabled={!values || loading || busy}
                        aria-invalid={!validPaymentTerm}
                        onChange={(event) =>
                          change('paymentTermDays', event.target.value)
                        }
                      />
                    </label>
                    <p className="document-hint">
                      Das Fälligkeitsdatum wird beim Finalisieren aus
                      Rechnungsdatum und Zahlungsziel berechnet und danach nicht
                      mehr geändert. 0 Tage bedeutet „sofort fällig“.
                    </p>
                    {/* RG-07b: the account is printed as typed and is not checked
                      as a bank account - this slice can show one, not judge one. */}
                    <label>
                      Bankverbindung (optional)
                      <textarea
                        value={values?.bankAccount ?? ''}
                        maxLength={500}
                        rows={3}
                        disabled={!values || loading || busy}
                        onChange={(event) =>
                          change('bankAccount', event.target.value)
                        }
                      />
                    </label>
                    <p className="document-hint">
                      Die Bankverbindung wird wörtlich gedruckt, Zeilenumbrüche
                      bleiben erhalten. Sie wird nicht als IBAN geprüft.
                    </p>
                  </>
                )}
              </div>
            </fieldset>
            <section
              className="offer-draft-positions"
              aria-labelledby={'offer-positions-' + documentId}
            >
              <h6 id={'offer-positions-' + documentId}>Positionen</h6>
              <p>Änderungen werden beim Speichern neu berechnet.</p>
              <p className="document-hint">
                Je Position gilt eine Rabattart: Prozent oder Euro. Ein
                Euro-Betrag ersetzt den Prozentsatz, der Prozentwert bleibt
                dabei unverändert gespeichert.
              </p>
              <div className="sr-only" aria-live="polite">
                {/* Renew the live-region content even when the spoken text repeats. */}
                {moveAnnouncement.text && (
                  <span key={moveAnnouncement.sequence}>
                    {moveAnnouncement.text}
                  </span>
                )}
              </div>
              <div className="offer-draft-position-list">
                {lineValues.map((line, index) => {
                  const title =
                    line.kind === 'info'
                      ? 'Infotext'
                      : `Position ${++itemNumber}`;
                  const canReorder =
                    lineValues.length > 1 && !busy && !loading && !isBlocked;
                  // EDITOR-MOBILE-01: the folded summary shows the typed values
                  // even while the fields are closed.
                  const pricePreview =
                    line.kind === 'info'
                      ? ''
                      : priceFieldsPreview(
                          line.quantity,
                          line.unit,
                          line.unitPrice,
                          line.tax,
                        );
                  return (
                    <fieldset
                      className="offer-draft-position"
                      data-drop-target={dropTarget === line.key || undefined}
                      onDragOver={(event) => {
                        if (
                          !canReorder ||
                          !draggedLine.current ||
                          draggedLine.current === line.key
                        )
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDropTarget(line.key);
                      }}
                      onDragLeave={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        )
                          setDropTarget((current) =>
                            current === line.key ? '' : current,
                          );
                      }}
                      onDrop={(event) => {
                        if (!draggedLine.current) return;
                        event.preventDefault();
                        moveLine(draggedLine.current, index);
                        clearDrag();
                      }}
                      disabled={busy || loading}
                      key={line.key}
                    >
                      {/* EDITOR-ACTIONS-01: the legend names the group for
                          assistive technology; the visible header carries the
                          title and one compact icon group for every row
                          action. */}
                      <legend className="sr-only">{title}</legend>
                      <div className="offer-draft-position-head">
                        {lineValues.length > 1 && (
                          <span
                            className="offer-draft-position-grip"
                            aria-hidden="true"
                            title="Zum Verschieben ziehen"
                            draggable={canReorder}
                            onDragStart={(event) => {
                              if (!canReorder || busyRef.current) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData(
                                'application/x-auftragskompass-draft-row',
                                line.key,
                              );
                              draggedLine.current = line.key;
                            }}
                            onDragEnd={clearDrag}
                          >
                            <svg
                              viewBox="0 0 16 16"
                              width="16"
                              height="16"
                              fill="currentColor"
                            >
                              <circle cx="6" cy="4" r="1" />
                              <circle cx="10" cy="4" r="1" />
                              <circle cx="6" cy="8" r="1" />
                              <circle cx="10" cy="8" r="1" />
                              <circle cx="6" cy="12" r="1" />
                              <circle cx="10" cy="12" r="1" />
                            </svg>
                          </span>
                        )}
                        <span
                          className="offer-draft-position-title"
                          aria-hidden="true"
                        >
                          {title}
                        </span>
                        {/* EDITOR-VISUAL-01 (B37 deviation 2): the price basis is
                            one compact Brutto/Netto switch of the row header, not
                            a select beside the price. It keeps the stored value
                            and only renames the price field; the core computes
                            every sum. */}
                        {line.kind !== 'info' && (
                          <div
                            className="offer-draft-position-basis"
                            role="radiogroup"
                            aria-label="Preisbasis"
                          >
                            {(['gross', 'net'] as const).map((basis) => (
                              <label key={basis}>
                                <input
                                  type="radio"
                                  name={`price-basis-${line.key}`}
                                  value={basis}
                                  checked={line.priceBasis === basis}
                                  onChange={() =>
                                    changeLine(line.key, 'priceBasis', basis)
                                  }
                                />
                                {basis === 'net' ? 'Netto' : 'Brutto'}
                              </label>
                            ))}
                          </div>
                        )}
                        {/* EDITOR-VISUAL-02: one compact menu per position
                            replaces the four unnamed icons. The toggle stays
                            the single visible row action; the group holds the
                            four named entries; the product status keeps its
                            place in the row outside the closed group. */}
                        <PositionRowActions
                          title={title}
                          menuId={`offer-draft-actions-${line.key}`}
                          canReorder={canReorder}
                          canMoveUp={index > 0}
                          canMoveDown={
                            lineValues.length > 1 &&
                            index < lineValues.length - 1
                          }
                          removeDisabled={
                            lineValues.length <= 1 || busy || loading
                          }
                          productDisabled={busy || loading || isBlocked}
                          product={
                            line.kind === 'info'
                              ? null
                              : {
                                  description: line.description,
                                  infoText: line.infoText,
                                  unit: line.unit,
                                  price: line.unitPrice,
                                  priceBasis: line.priceBasis,
                                  tax: line.tax,
                                }
                          }
                          csrfToken={csrfToken}
                          onMove={(direction, origin) =>
                            moveLine(line.key, index + direction, origin)
                          }
                          onRemove={() => askRemove(line.key, title)}
                          registerRemoveOrigin={(element) => {
                            if (element)
                              removeButtonRefs.current.set(line.key, element);
                            else removeButtonRefs.current.delete(line.key);
                          }}
                        />
                      </div>
                      {line.kind === 'info' ? (
                        <label className="offer-draft-info-field">
                          Text
                          <textarea
                            ref={(element) =>
                              registerLineInput(line.key, element)
                            }
                            value={line.description}
                            maxLength={infoTextLimit}
                            rows={3}
                            required
                            aria-invalid={invalidInfoText(line.description)}
                            onChange={(event) =>
                              changeLine(
                                line.key,
                                'description',
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ) : (
                        <div className="offer-draft-position-fields">
                          <label className="offer-draft-position-wide-field">
                            Beschreibung
                            <textarea
                              ref={(element) =>
                                registerLineInput(line.key, element)
                              }
                              value={line.description}
                              maxLength={300}
                              rows={2}
                              required
                              aria-invalid={
                                !line.description.trim() ||
                                line.description.length > 300
                              }
                              onChange={(event) =>
                                changeLine(
                                  line.key,
                                  'description',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          {/* EDITOR-MOBILE-01: the five value fields keep exactly
                              this DOM at every width. Above the breakpoint the
                              summary is not displayed and the group is always
                              open; below it the same group folds behind "Preis
                              und Rabatt" and keeps a short value preview. The
                              Brutto/Netto switch of the header (EDITOR-VISUAL-01)
                              stays outside the group. */}
                          <details
                            className="offer-draft-position-price-group"
                            open={
                              !compactFields ||
                              valueFieldsInvalid(line) ||
                              openPriceFields.includes(line.key)
                            }
                          >
                            <summary
                              className="offer-draft-position-price-summary"
                              onClick={(event) => {
                                // The open state belongs to this component. The
                                // native toggle is suppressed so an invalid
                                // group cannot be closed and React never falls
                                // out of sync with the attribute.
                                event.preventDefault();
                                if (valueFieldsInvalid(line)) return;
                                togglePriceFields(line.key);
                              }}
                            >
                              Preis und Rabatt{' '}
                              {pricePreview && (
                                <span className="offer-draft-position-price-preview">
                                  {pricePreview}
                                </span>
                              )}
                            </summary>
                            <div className="offer-draft-position-price-fields">
                              <label>
                                Menge
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={line.quantity}
                                  required
                                  aria-invalid={quantityInvalid(line.quantity)}
                                  onChange={(event) =>
                                    changeLine(
                                      line.key,
                                      'quantity',
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              <label>
                                Einheit
                                <input
                                  value={line.unit}
                                  maxLength={40}
                                  required
                                  aria-invalid={unitInvalid(line.unit)}
                                  onChange={(event) =>
                                    changeLine(
                                      line.key,
                                      'unit',
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              <label className="offer-draft-position-wide-field">
                                {priceLabel(line.priceBasis)}
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={line.unitPrice}
                                  required
                                  aria-invalid={decimalInvalid(line.unitPrice)}
                                  onChange={(event) =>
                                    changeLine(
                                      line.key,
                                      'unitPrice',
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              {/* EDITOR-VISUAL-01: the basis is the switch of the
                                  row header; only the price label keeps naming
                                  the stored basis here. */}
                              <label>
                                Steuer in Prozent
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={line.tax}
                                  required
                                  aria-invalid={percentInvalid(line.tax)}
                                  onChange={(event) =>
                                    changeLine(
                                      line.key,
                                      'tax',
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              {/* DOC-PRODUCT-01.4 / EDITOR-LAYOUT-01: one
                                  number field with its unit switch beside it.
                                  The mode decides which stored value the core
                                  uses and the inactive one keeps its value
                                  untouched. */}
                              <DiscountField
                                mode={line.discountMode}
                                value={
                                  line.discountMode === 'percent'
                                    ? line.discount
                                    : line.discountAmount
                                }
                                valueLabel={
                                  line.discountMode === 'percent'
                                    ? 'Rabatt in Prozent'
                                    : 'Rabatt in Euro'
                                }
                                valueInvalid={
                                  line.discountMode === 'percent'
                                    ? percentInvalid(line.discount)
                                    : decimalInvalid(line.discountAmount)
                                }
                                required
                                onValueChange={(value) =>
                                  changeLine(
                                    line.key,
                                    line.discountMode === 'percent'
                                      ? 'discount'
                                      : 'discountAmount',
                                    value,
                                  )
                                }
                                onModeChange={(mode) =>
                                  changeLine(line.key, 'discountMode', mode)
                                }
                              />
                            </div>
                          </details>
                        </div>
                      )}
                      {line.kind !== 'info' && (
                        <label className="offer-draft-position-option">
                          <input
                            type="checkbox"
                            checked={line.optional}
                            onChange={(event) =>
                              changeLine(
                                line.key,
                                'optional',
                                event.target.checked,
                              )
                            }
                          />
                          Optionale Position
                        </label>
                      )}
                      {line.kind !== 'info' && (
                        <label className="offer-draft-info-field offer-draft-item-info">
                          Infotext (optional)
                          <textarea
                            value={line.infoText}
                            maxLength={infoTextLimit}
                            rows={3}
                            aria-invalid={line.infoText.length > infoTextLimit}
                            onChange={(event) =>
                              changeLine(
                                line.key,
                                'infoText',
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      )}
                    </fieldset>
                  );
                })}
              </div>
              <div className="document-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    lineValues.length >= 1000 || busy || loading || isBlocked
                  }
                  onClick={() => addLine()}
                >
                  Freie Position hinzufügen
                </button>
                <button
                  ref={productButtonRef}
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy ||
                    loading ||
                    (isBlocked && !productPickerOpen) ||
                    (lineValues.length >= 1000 && !productPickerOpen)
                  }
                  aria-haspopup="dialog"
                  onClick={() => openProductPicker()}
                >
                  Produkt hinzufügen
                </button>
              </div>
              {lineValues.length === 0 && (
                <p className="document-hint" role="status">
                  Noch keine Positionen. Fügen Sie eine freie Position oder ein
                  Produkt hinzu.
                </p>
              )}
              {lineValues.length > 0 && !validLines && (
                <p role="alert">
                  {lineValues.some(
                    (line) =>
                      line.kind === 'info' && invalidInfoText(line.description),
                  )
                    ? 'Geben Sie für jeden Infotext einen Text ein.'
                    : 'Prüfen Sie Beschreibung, Menge, Einheit, Einzelpreis, Preisbasis, Steuer, Rabatt und Infotext.'}
                </p>
              )}
              {lineValues.length > 0 && !hasPricedLines && (
                <p className="document-hint">
                  Zum Finalisieren ist mindestens eine Position erforderlich.
                </p>
              )}
            </section>
            {/* EDITOR-LAYOUT-01: the document discount is its own named group
                with one number field and the kind switch right beside it. The
                payable amount stays a server sum; this group only says what
                was agreed. */}
            <fieldset
              className="offer-draft-group offer-draft-total-discount"
              disabled={!values || loading || busy}
            >
              <legend>Gesamtrabatt</legend>
              <div className="discount-field">
                <label>
                  Art des Gesamtrabatts
                  <select
                    value={totalDiscountKind}
                    onChange={(event) =>
                      changeTotalDiscountKind(
                        event.target.value === 'percent'
                          ? 'percent'
                          : event.target.value === 'amount'
                            ? 'amount'
                            : '',
                      )
                    }
                  >
                    <option value="">Kein Gesamtrabatt</option>
                    <option value="percent">Prozent</option>
                    <option value="amount">Euro</option>
                  </select>
                </label>
                {totalDiscountKind && (
                  <label>
                    {totalDiscountKind === 'percent'
                      ? 'Gesamtrabatt in Prozent'
                      : 'Gesamtrabatt in Euro'}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={totalDiscountValue}
                      required
                      aria-invalid={
                        totalDiscountValueInvalid || discountRejected
                      }
                      onChange={(event) =>
                        change(
                          totalDiscountKind === 'percent'
                            ? 'totalDiscountPercent'
                            : 'totalDiscountAmount',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                )}
              </div>
              {totalDiscountKind && (
                <label className="offer-draft-total-discount-note">
                  Anmerkung zum Gesamtrabatt (optional)
                  <textarea
                    value={totalDiscountNote}
                    maxLength={totalDiscountNoteLimit}
                    rows={2}
                    aria-invalid={
                      totalDiscountNote.length > totalDiscountNoteLimit
                    }
                    onChange={(event) =>
                      change('totalDiscountNote', event.target.value)
                    }
                  />
                </label>
              )}
              <p className="document-hint">
                Der Gesamtrabatt mindert den Zahlbetrag; Positionssummen und
                Steuer bleiben unverändert.
              </p>
            </fieldset>
            {/* EDITOR-LAYOUT-01: the stored sum and the hints that belong to it
                keep their own named group, separate from the positions. */}
            <fieldset className="offer-draft-group">
              <legend>Summen und Hinweise</legend>
              <p className="offer-draft-total">
                Gespeicherter Gesamtbetrag:{' '}
                {exactMinorUnits(detail.grossMinor) ?? '—'} €
              </p>
              {hasOptionalLines && (
                <p className="document-hint">
                  Der Gesamtbetrag wird ohne optionale Positionen berechnet.
                </p>
              )}
            </fieldset>
            <label>
              Schlusstext
              <textarea
                value={values?.outroText ?? ''}
                maxLength={4000}
                rows={4}
                disabled={!values || loading || busy}
                onChange={(event) => change('outroText', event.target.value)}
              />
            </label>
            <div className="document-actions offer-draft-actions">
              <button
                type="submit"
                className="primary-action"
                disabled={
                  !values ||
                  !needsSave ||
                  !validDays ||
                  !validServiceDay ||
                  !validPaymentTerm ||
                  !validTotalDiscount ||
                  !validLines ||
                  busy ||
                  loading ||
                  isBlocked
                }
              >
                {saving ? 'Wird gespeichert …' : 'Änderungen speichern'}
              </button>
              {dirty ||
              legacy ||
              busy ||
              loading ||
              isBlocked ||
              !validLines ? (
                <>
                  <button type="button" className="secondary-action" disabled>
                    Vorschau öffnen
                  </button>
                  {!finalizing && (
                    <span className="document-hint">
                      {!validLines
                        ? 'Fügen Sie zuerst eine Zeile hinzu oder prüfen Sie Ihre Eingaben.'
                        : isBlocked
                          ? 'Bitte zuerst den aktuellen Serverstand laden.'
                          : loading
                            ? 'Der Serverstand wird geladen.'
                            : 'Bitte zuerst speichern, damit die Vorschau stimmt.'}
                    </span>
                  )}
                </>
              ) : (
                <a
                  className="document-download"
                  href={'/api/v1/documents/' + documentId + '/preview'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vorschau öffnen
                </a>
              )}
              {(conflict || uncertain || (error && !values)) && (
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={loading || busy}
                  onClick={() => void reload()}
                >
                  Entwurf neu laden
                </button>
              )}
              {saving && <span role="status">Entwurf wird gespeichert …</span>}
              {loading && <span role="status">Entwurf wird geladen …</span>}
            </div>
          </form>
        </>
      )}
      {!detail && (
        <div className="offer-draft-actions">
          {loading ? (
            <p>Entwurf wird geladen …</p>
          ) : (
            <button
              type="button"
              className="secondary-action"
              disabled={busy}
              onClick={() => void loadDraft()}
            >
              Entwurf erneut laden
            </button>
          )}
        </div>
      )}
      {productPickerOpen && (
        <ProductPickerDialog
          products={catalogProducts}
          state={catalogState}
          message={catalogMessage}
          busy={busy || loading || isBlocked}
          onRetry={() => void loadCatalog()}
          onAdd={addCatalogProducts}
          onClose={() => {
            setProductPickerOpen(false);
            productButtonRef.current?.focus();
          }}
        />
      )}
      {removeCandidate && (
        <PositionRemoveDialog
          position={removeCandidate.title}
          message="Die Position wird mit ihren Angaben erst beim Speichern aus dem Dokument entfernt."
          onConfirm={confirmRemove}
          onCancel={cancelRemove}
        />
      )}
    </section>
  );
}
