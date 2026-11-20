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
type CatalogProduct = {
  id: string;
  name: string;
  description?: string;
  unit: string;
  priceMinor: number;
  priceBasis: string;
  taxBasisPoints: number;
  state: string;
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
};

function valuesOf(values: DraftContentValues): DraftValues {
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
    [focusInitialEditor, setFocusInitialEditor] = useState(false),
    [productPickerOpen, setProductPickerOpen] = useState(false),
    [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]),
    [catalogState, setCatalogState] = useState<
      'idle' | 'loading' | 'ready' | 'error'
    >('idle'),
    [selectedProductId, setSelectedProductId] = useState(''),
    [catalogError, setCatalogError] = useState(false),
    [catalogMessage, setCatalogMessage] = useState(''),
    [dropTarget, setDropTarget] = useState(''),
    [moveAnnouncement, setMoveAnnouncement] = useState({
      sequence: 0,
      text: '',
    }),
    draggedLine = useRef(''),
    pendingMoveFocus = useRef<HTMLButtonElement | null>(null),
    request = useRef(0),
    lineSequence = useRef(0),
    catalogRequest = useRef<Promise<void> | null>(null),
    busyRef = useRef(false),
    dirtyRef = useRef(false),
    subjectInput = useRef<HTMLInputElement | null>(null),
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
    setCatalogError(false);
    setCatalogMessage('');
    const pending = (async () => {
      try {
        const response = await fetch('/api/v1/products');
        if (!response.ok) throw new Error('catalog');
        const loaded: unknown = await response.json();
        if (!Array.isArray(loaded)) throw new Error('catalog');
        const active = loaded.filter(
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
        setCatalogProducts(active);
        setCatalogState('ready');
        setCatalogError(false);
        setCatalogMessage('');
      } catch {
        setCatalogState('error');
        setCatalogError(true);
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
    setProductPickerOpen(true);
    if (catalogState === 'idle' || catalogState === 'error') void loadCatalog();
  }

  function appendCatalogProduct() {
    if (
      busyRef.current ||
      finalizing ||
      loading ||
      isBlocked ||
      lineValues.length >= 1000 ||
      catalogState !== 'ready'
    )
      return;
    const product = catalogProducts.find(
      (entry) => entry.id === selectedProductId,
    );
    if (!product) return;
    const information = product.description?.trim() ?? '';
    if (information.length > infoTextLimit) {
      setCatalogError(true);
      setCatalogMessage(
        'Der Infotext des Produkts ist zu lang. Kürzen Sie die Beschreibung im Katalog auf höchstens 4.000 Zeichen.',
      );
      return;
    }
    lineSequence.current += 1;
    const key = `catalog-${lineSequence.current}`;
    pendingLineFocus.current = key;
    setLineValues((current) => [
      ...current,
      {
        key,
        productId: product.id,
        description: product.name,
        infoText: information,
        quantity: '1',
        unit: product.unit,
        // The catalog price is copied with its basis; the core converts and
        // rounds, the editor never does.
        unitPrice: formatHundredths(product.priceMinor),
        priceBasis: product.priceBasis === 'net' ? 'net' : 'gross',
        tax: formatHundredths(product.taxBasisPoints),
        discount: '0.00',
        discountMode: 'percent',
        discountAmount: '0.00',
        optional: false,
      },
    ]);
    setSelectedProductId('');
    setCatalogError(false);
    setCatalogMessage('');
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
      !validLines ||
      isBlocked
    )
      return;
    busyRef.current = true;
    setSaving(true);
    callbacks.current.onBusyChange(true);
    setMessage('');
    setError(false);
    try {
      const body = JSON.stringify({
        version: detail.version,
        subject: values.subject,
        introText: values.introText,
        outroText: values.outroText,
        validityDays: days,
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
                  : 'Änderungen wurden nicht gespeichert. Bitte Eingaben prüfen und erneut versuchen.',
          );
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
                  onChange={(event) => change('introText', event.target.value)}
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
                      <legend>
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
                        {title}
                      </legend>
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
                            <input
                              ref={(element) =>
                                registerLineInput(line.key, element)
                              }
                              value={line.description}
                              maxLength={300}
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
                          <label>
                            Menge
                            <input
                              type="text"
                              inputMode="numeric"
                              value={line.quantity}
                              required
                              aria-invalid={
                                !/^\d+$/.test(line.quantity) ||
                                Number(line.quantity) < 1 ||
                                Number(line.quantity) > 100000
                              }
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
                              aria-invalid={
                                !line.unit.trim() || line.unit.length > 40
                              }
                              onChange={(event) =>
                                changeLine(line.key, 'unit', event.target.value)
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
                          <label>
                            Preisbasis
                            <select
                              value={line.priceBasis}
                              onChange={(event) =>
                                changeLine(
                                  line.key,
                                  'priceBasis',
                                  event.target.value === 'net'
                                    ? 'net'
                                    : 'gross',
                                )
                              }
                            >
                              <option value="gross">Brutto</option>
                              <option value="net">Netto</option>
                            </select>
                          </label>
                          <label>
                            Steuer in Prozent
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.tax}
                              required
                              aria-invalid={percentInvalid(line.tax)}
                              onChange={(event) =>
                                changeLine(line.key, 'tax', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Rabatt in Prozent
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.discount}
                              required
                              disabled={line.discountMode !== 'percent'}
                              aria-invalid={percentInvalid(line.discount)}
                              onChange={(event) =>
                                changeLine(
                                  line.key,
                                  'discount',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          {/* DOC-PRODUCT-01.4: the mode decides which discount
                              the core uses. The inactive field keeps its value
                              untouched, so switching never converts anything. */}
                          <label>
                            Rabattart
                            <select
                              value={line.discountMode}
                              onChange={(event) =>
                                changeLine(
                                  line.key,
                                  'discountMode',
                                  event.target.value === 'amount'
                                    ? 'amount'
                                    : 'percent',
                                )
                              }
                            >
                              <option value="percent">Prozent</option>
                              <option value="amount">Euro</option>
                            </select>
                          </label>
                          <label>
                            Rabatt in Euro
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.discountAmount}
                              disabled={line.discountMode !== 'amount'}
                              aria-invalid={
                                line.discountMode === 'amount' &&
                                decimalInvalid(line.discountAmount)
                              }
                              onChange={(event) =>
                                changeLine(
                                  line.key,
                                  'discountAmount',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        </div>
                      )}
                      <div className="offer-draft-position-actions">
                        {lineValues.length > 1 &&
                          ([-1, 1] as const).map((direction) => {
                            const destination = index + direction;
                            const label = `${title} nach ${direction === -1 ? 'oben' : 'unten'} verschieben`;
                            return (
                              <button
                                key={direction}
                                type="button"
                                className="tertiary-action offer-draft-move"
                                aria-label={label}
                                title={label}
                                disabled={!canReorder}
                                aria-disabled={
                                  destination < 0 ||
                                  destination >= lineValues.length
                                }
                                onClick={(event) =>
                                  moveLine(
                                    line.key,
                                    destination,
                                    event.currentTarget,
                                  )
                                }
                              >
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 16 16"
                                  width="16"
                                  height="16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path
                                    d={
                                      direction === -1
                                        ? 'M4 9l4-4 4 4'
                                        : 'M4 7l4 4 4-4'
                                    }
                                  />
                                </svg>
                              </button>
                            );
                          })}
                        <button
                          type="button"
                          className="tertiary-action"
                          disabled={lineValues.length <= 1 || busy || loading}
                          onClick={() => removeLine(line.key)}
                        >
                          {title} entfernen
                        </button>
                      </div>
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
                  type="button"
                  className="secondary-action"
                  disabled={
                    busy ||
                    loading ||
                    (isBlocked && !productPickerOpen) ||
                    (lineValues.length >= 1000 && !productPickerOpen)
                  }
                  aria-expanded={productPickerOpen}
                  onClick={() =>
                    productPickerOpen
                      ? setProductPickerOpen(false)
                      : openProductPicker()
                  }
                >
                  {productPickerOpen
                    ? 'Katalogauswahl schließen'
                    : 'Produkt hinzufügen'}
                </button>
              </div>
              {productPickerOpen && (
                <div className="offer-draft-catalog">
                  {catalogState === 'loading' && (
                    <p role="status">Produktkatalog wird geladen.</p>
                  )}
                  {catalogState === 'error' && (
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={busy || loading || isBlocked}
                      onClick={() => void loadCatalog()}
                    >
                      Katalog erneut laden
                    </button>
                  )}
                  {catalogState === 'ready' && catalogProducts.length === 0 && (
                    <p role="status">Keine aktiven Produkte im Katalog.</p>
                  )}
                  {catalogState === 'ready' && catalogProducts.length > 0 && (
                    <>
                      <label>
                        Produkt aus Katalog
                        <select
                          value={selectedProductId}
                          disabled={busy || loading || isBlocked}
                          onChange={(event) =>
                            setSelectedProductId(event.target.value)
                          }
                        >
                          <option value="">Produkt auswählen</option>
                          {catalogProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} —{' '}
                              {formatHundredths(product.priceMinor)} €{' '}
                              {product.priceBasis === 'net'
                                ? 'Netto'
                                : 'Brutto'}{' '}
                              — {formatHundredths(product.taxBasisPoints)} %
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={
                          !selectedProductId ||
                          lineValues.length >= 1000 ||
                          busy ||
                          loading ||
                          isBlocked
                        }
                        onClick={appendCatalogProduct}
                      >
                        Als Position hinzufügen
                      </button>
                    </>
                  )}
                  {catalogMessage && (
                    <p role={catalogError ? 'alert' : 'status'}>
                      {catalogMessage}
                    </p>
                  )}
                </div>
              )}
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
              {hasOptionalLines && (
                <p className="document-hint">
                  Der Gesamtbetrag wird ohne optionale Positionen berechnet.
                </p>
              )}
              <p className="offer-draft-total">
                Gespeicherter Gesamtbetrag:{' '}
                {exactMinorUnits(detail.grossMinor) ?? '—'} €
              </p>
            </section>
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
    </section>
  );
}
