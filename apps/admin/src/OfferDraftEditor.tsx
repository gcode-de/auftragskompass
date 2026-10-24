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
import { grossProductPrice } from './product-price.js';

type DraftValues = {
  subject: string;
  introText: string;
  outroText: string;
  validityDays: string;
};
type DraftLine = {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
};
type DraftLineValues = {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  tax: string;
  discount: string;
};
type DraftDetail = {
  id: string;
  templateId: string | null;
  state: string;
  version: number;
  subject: string | null;
  introText: string | null;
  outroText: string | null;
  validityDays: number | null;
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
  unit: string;
  priceMinor: number;
  priceBasis: string;
  taxBasisPoints: number;
  state: string;
};
type Props = {
  documentId: string;
  csrfToken: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onSavedMetadata: (
    metadata: Pick<
      DraftDetail,
      'version' | 'netMinor' | 'taxMinor' | 'grossMinor'
    >,
  ) => void;
};

function valuesOf(values: {
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
}): DraftValues {
  return {
    subject: values.subject,
    introText: values.introText,
    outroText: values.outroText,
    validityDays: String(values.validityDays),
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
        (line.productId === null || typeof line.productId === 'string') &&
        typeof line.description === 'string' &&
        line.description.length <= 300 &&
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
        line.discountBasisPoints <= 10000,
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
  return lines.map((line, index) => ({
    key: previous[index]?.key ?? `saved-${line.id}`,
    productId: line.productId,
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit,
    unitPrice: formatHundredths(line.unitPriceMinor),
    tax: formatHundredths(line.taxBasisPoints),
    discount: formatHundredths(line.discountBasisPoints),
  }));
}

function lineDraft(line: DraftLineValues) {
  if (!line.description.trim() || line.description.length > 300)
    throw new Error('description');
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
    quantity,
    unit: line.unit,
    unitPriceMinor,
    taxBasisPoints,
    discountBasisPoints,
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

export function OfferDraftEditor({
  documentId,
  csrfToken,
  onClose,
  onDirtyChange,
  onBusyChange,
  onSavedMetadata,
}: Props) {
  const [values, setValues] = useState<DraftValues | null>(null),
    [baseline, setBaseline] = useState<DraftValues | null>(null),
    [lineValues, setLineValues] = useState<DraftLineValues[]>([]),
    [baselineLines, setBaselineLines] = useState<DraftLineValues[]>([]),
    [detail, setDetail] = useState<DraftDetail | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
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
    request = useRef(0),
    lineSequence = useRef(0),
    catalogRequest = useRef<Promise<void> | null>(null),
    busyRef = useRef(false),
    dirtyRef = useRef(false),
    subjectInput = useRef<HTMLInputElement | null>(null),
    lineInputRefs = useRef(new Map<string, HTMLInputElement>()),
    pendingLineFocus = useRef(''),
    callbacks = useRef({ onDirtyChange, onBusyChange, onSavedMetadata });
  callbacks.current = { onDirtyChange, onBusyChange, onSavedMetadata };

  const dirty = Boolean(
    values &&
    baseline &&
    (JSON.stringify(values) !== JSON.stringify(baseline) ||
      JSON.stringify(lineValues) !== JSON.stringify(baselineLines)),
  );
  dirtyRef.current = dirty;
  const needsSave = dirty || legacy;
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
        let next = hasSavedContent(loaded)
          ? {
              subject: loaded.subject,
              introText: loaded.introText,
              outroText: loaded.outroText,
              validityDays: loaded.validityDays,
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
    if (!pendingLineFocus.current) return;
    const input = lineInputRefs.current.get(pendingLineFocus.current);
    if (input) {
      input.scrollIntoView?.({ block: 'nearest' });
      input.focus();
    }
    pendingLineFocus.current = '';
  }, [lineValues]);
  useEffect(() => registerUnsavedChanges(() => dirtyRef.current), []);

  function close() {
    if (busyRef.current) return;
    if (
      dirtyRef.current &&
      !window.confirm('Ungespeicherte Angebotsänderungen verwerfen?')
    )
      return;
    callbacks.current.onDirtyChange(false);
    onClose();
  }

  function change<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setValues((current) => (current ? { ...current, [key]: value } : current));
  }

  function changeLine<K extends keyof DraftLineValues>(
    key: string,
    field: K,
    value: DraftLineValues[K],
  ) {
    setLineValues((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line,
      ),
    );
  }

  function addLine() {
    if (lineValues.length >= 1000 || busyRef.current || isBlocked) return;
    lineSequence.current += 1;
    const key = `free-${lineSequence.current}`;
    pendingLineFocus.current = key;
    setLineValues((current) => [
      ...current,
      {
        key,
        productId: null,
        description: '',
        quantity: '1',
        unit: 'Stück',
        unitPrice: '0.00',
        tax: '19.00',
        discount: '0.00',
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
    if (busyRef.current || loading || isBlocked || lineValues.length >= 1000)
      return;
    setProductPickerOpen(true);
    if (catalogState === 'idle' || catalogState === 'error') void loadCatalog();
  }

  function appendCatalogProduct() {
    if (
      busyRef.current ||
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
    try {
      const grossMinor = grossProductPrice(
        product.priceMinor,
        product.priceBasis,
        product.taxBasisPoints,
      );
      lineSequence.current += 1;
      const key = `catalog-${lineSequence.current}`;
      pendingLineFocus.current = key;
      setLineValues((current) => [
        ...current,
        {
          key,
          productId: product.id,
          description: product.name,
          quantity: '1',
          unit: product.unit,
          unitPrice: formatHundredths(grossMinor),
          tax: formatHundredths(product.taxBasisPoints),
          discount: '0.00',
        },
      ]);
      setSelectedProductId('');
      setCatalogError(false);
      setCatalogMessage('');
    } catch {
      setCatalogError(true);
      setCatalogMessage(
        'Der Produktpreis kann nicht in einen sicheren Bruttobetrag umgerechnet werden. Die Positionen blieben unverändert. Produktpreis und Steuersatz prüfen.',
      );
    }
  }

  function removeLine(key: string) {
    if (lineValues.length <= 1) return;
    const index = lineValues.findIndex((line) => line.key === key);
    setLineValues((current) => {
      const remaining = current.filter((line) => line.key !== key),
        next = remaining[Math.min(index, remaining.length - 1)];
      pendingLineFocus.current = next?.key ?? '';
      return remaining;
    });
  }

  async function reload() {
    if (busyRef.current) return;
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
      !values ||
      !detail ||
      !needsSave ||
      !validDays ||
      !validLines ||
      isBlocked
    )
      return;
    busyRef.current = true;
    setBusy(true);
    callbacks.current.onBusyChange(true);
    setMessage('');
    setError(false);
    try {
      const submittedLines = lineValues.map(lineDraft);
      const reply = await fetch('/api/v1/documents/' + documentId + '/draft', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          version: detail.version,
          subject: values.subject,
          introText: values.introText,
          outroText: values.outroText,
          validityDays: days,
          lines: submittedLines,
        }),
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
      setBusy(false);
      callbacks.current.onBusyChange(false);
    }
  }

  function escape(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  return (
    <section
      className="offer-draft-editor"
      aria-labelledby={'offer-editor-' + documentId}
    >
      <div className="offer-draft-editor-heading">
        <h5 id={'offer-editor-' + documentId}>Angebot bearbeiten</h5>
        <button
          type="button"
          className="tertiary-action"
          disabled={busy}
          onClick={close}
        >
          Bearbeitung schließen
        </button>
      </div>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {legacy && (
        <p className="document-hint">
          Dieser ältere Entwurf enthält keine gespeicherten Texte. Die aktuelle
          Vorlage dient nur als Ausgangspunkt; erst beim Speichern werden diese
          Werte in den Entwurf übernommen.
        </p>
      )}
      {detail && (
        <>
          <form onSubmit={(event) => void save(event)} onKeyDown={escape}>
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
                Schlusstext
                <textarea
                  value={values?.outroText ?? ''}
                  maxLength={4000}
                  rows={4}
                  disabled={!values || loading || busy}
                  onChange={(event) => change('outroText', event.target.value)}
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
            </div>
            <section
              className="offer-draft-positions"
              aria-labelledby={'offer-positions-' + documentId}
            >
              <h6 id={'offer-positions-' + documentId}>Positionen</h6>
              <p>Änderungen werden beim Speichern neu berechnet.</p>
              <div className="offer-draft-position-list">
                {lineValues.map((line, index) => (
                  <fieldset
                    className="offer-draft-position"
                    disabled={busy || loading}
                    key={line.key}
                  >
                    <legend>Position {index + 1}</legend>
                    <div className="offer-draft-position-fields">
                      <label>
                        Beschreibung
                        <input
                          ref={(element) => {
                            if (element)
                              lineInputRefs.current.set(line.key, element);
                            else lineInputRefs.current.delete(line.key);
                          }}
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
                            changeLine(line.key, 'quantity', event.target.value)
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
                      <label>
                        Einzelpreis (Brutto) in Euro
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
                          aria-invalid={percentInvalid(line.discount)}
                          onChange={(event) =>
                            changeLine(line.key, 'discount', event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="tertiary-action"
                      disabled={lineValues.length <= 1 || busy || loading}
                      onClick={() => removeLine(line.key)}
                    >
                      Position {index + 1} entfernen
                    </button>
                  </fieldset>
                ))}
              </div>
              <button
                type="button"
                className="secondary-action"
                disabled={
                  lineValues.length >= 1000 || busy || loading || isBlocked
                }
                onClick={addLine}
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
                  Noch keine Positionen. Fügen Sie eine freie Position hinzu
                  oder wählen Sie ein Produkt aus dem Katalog.
                </p>
              )}
              {lineValues.length > 0 && !validLines && (
                <p role="alert">
                  Prüfen Sie Beschreibung, Menge, Einheit, Brutto-Einzelpreis,
                  Steuer und Rabatt. Mindestens eine gültige Position ist
                  erforderlich.
                </p>
              )}
              <p className="offer-draft-total">
                Gespeicherter Gesamtbetrag:{' '}
                {exactMinorUnits(detail.grossMinor) ?? '—'} €
              </p>
            </section>
            <div className="document-actions offer-draft-actions">
              <button
                type="submit"
                className="primary-action"
                disabled={
                  !values ||
                  !needsSave ||
                  !validDays ||
                  !validLines ||
                  busy ||
                  loading ||
                  isBlocked
                }
              >
                {busy ? 'Wird gespeichert …' : 'Änderungen speichern'}
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
                  <span className="document-hint">
                    {!validLines
                      ? 'Fügen Sie zuerst mindestens eine gültige Position hinzu.'
                      : isBlocked
                        ? 'Bitte zuerst den aktuellen Serverstand laden.'
                        : loading
                          ? 'Der Serverstand wird geladen.'
                          : 'Bitte zuerst speichern, damit die Vorschau stimmt.'}
                  </span>
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
              {busy && <span role="status">Entwurf wird gespeichert …</span>}
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
