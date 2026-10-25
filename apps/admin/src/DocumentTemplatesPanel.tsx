import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseHundredths, formatHundredths } from './decimal.js';
import { grossProductPrice } from './product-price.js';
import { registerUnsavedChanges } from './unsaved-changes.js';

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
type ArchiveReconciliation = {
  id: string;
  outcome: 'unknown' | 'stale' | 'confirmed';
  confirmed?: Template;
};
type ArchiveFocusTarget = 'archive' | 'edit' | 'reconcile' | 'heading';
type ArchiveFocusRequest = {
  id: string;
  target: ArchiveFocusTarget;
};
type ArchiveFocusIntent = {
  id: string;
  moved: boolean;
  stop: () => void;
};
type Product = {
  id: string;
  name: string;
  unit: string;
  priceMinor: number;
  priceBasis: string;
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

function isTemplate(value: unknown): value is Template {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    Number.isSafeInteger(row.version) &&
    Number(row.version) > 0 &&
    typeof row.kind === 'string' &&
    typeof row.name === 'string' &&
    typeof row.subject === 'string' &&
    typeof row.introText === 'string' &&
    typeof row.outroText === 'string' &&
    Number.isSafeInteger(row.validityDays) &&
    Number(row.validityDays) >= 1 &&
    Number(row.validityDays) <= 365 &&
    (row.state === 'active' ||
      row.state === 'inactive' ||
      row.state === 'archived') &&
    Array.isArray(row.positions) &&
    row.positions.length <= 200 &&
    row.positions.every((position: unknown) => {
      if (!position || typeof position !== 'object') return false;
      const line = position as Record<string, unknown>;
      return (
        (line.id === undefined || typeof line.id === 'string') &&
        (line.productId === null || typeof line.productId === 'string') &&
        typeof line.description === 'string' &&
        Number.isSafeInteger(line.quantity) &&
        Number(line.quantity) >= 1 &&
        typeof line.unit === 'string' &&
        Number.isSafeInteger(line.unitPriceMinor) &&
        Number(line.unitPriceMinor) >= 0 &&
        Number.isSafeInteger(line.taxBasisPoints) &&
        Number(line.taxBasisPoints) >= 0 &&
        Number(line.taxBasisPoints) <= 10000 &&
        Number.isSafeInteger(line.discountBasisPoints) &&
        Number(line.discountBasisPoints) >= 0 &&
        Number(line.discountBasisPoints) <= 10000
      );
    })
  );
}

function sameTemplateContent(actual: Template, expected: Template) {
  return (
    actual.id === expected.id &&
    actual.kind === expected.kind &&
    actual.name === expected.name &&
    actual.subject === expected.subject &&
    actual.introText === expected.introText &&
    actual.outroText === expected.outroText &&
    actual.validityDays === expected.validityDays &&
    actual.positions.length === expected.positions.length &&
    actual.positions.every((position, index) => {
      const original = expected.positions[index];
      return (
        original !== undefined &&
        position.productId === original.productId &&
        position.description === original.description &&
        position.quantity === original.quantity &&
        position.unit === original.unit &&
        position.unitPriceMinor === original.unitPriceMinor &&
        position.taxBasisPoints === original.taxBasisPoints &&
        position.discountBasisPoints === original.discountBasisPoints
      );
    })
  );
}

export function DocumentTemplatesPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Template[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [draft, setDraft] = useState<Template | null>(null),
    [positions, setPositions] = useState<DraftPosition[]>([emptyPosition()]),
    [editorOpen, setEditorOpen] = useState(false),
    [editorGeneration, setEditorGeneration] = useState(0),
    [editing, setEditing] = useState(false),
    [message, setMessage] = useState(''),
    [conversionError, setConversionError] = useState(false),
    [busy, setBusy] = useState(false),
    [archivePendingId, setArchivePendingId] = useState<string | null>(null),
    [archiveReconciliation, setArchiveReconciliation] =
      useState<ArchiveReconciliation | null>(null),
    [archiveFocusRequest, setArchiveFocusRequest] =
      useState<ArchiveFocusRequest | null>(null);
  const archiveInFlight = useRef(false);
  const archiveFocusIntent = useRef<ArchiveFocusIntent | null>(null);
  const archiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const editorFormRef = useRef<HTMLFormElement>(null);
  const editorOpenRef = useRef(false);
  const editorWasOpen = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusAfterClose = useRef(true);
  const baselineFields = useRef('');
  const baselinePositions = useRef('');
  const reconcileButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      archiveFocusIntent.current?.stop();
      archiveFocusIntent.current = null;
    },
    [],
  );
  function trackArchiveFocus(id: string, origin: HTMLElement) {
    archiveFocusIntent.current?.stop();
    archiveFocusIntent.current = null;
    if (document.activeElement !== origin) return;
    const intent: ArchiveFocusIntent = {
      id,
      moved: false,
      stop: () => document.removeEventListener('focusin', onFocusIn),
    };
    function onFocusIn(event: FocusEvent) {
      const target = event.target;
      if (target !== origin && target !== document.body) intent.moved = true;
    }
    document.addEventListener('focusin', onFocusIn);
    archiveFocusIntent.current = intent;
  }
  function requestArchiveFocus(id: string, target: ArchiveFocusTarget) {
    if (archiveFocusIntent.current?.id === id)
      setArchiveFocusRequest({ id, target });
  }
  useLayoutEffect(() => {
    if (!archiveFocusRequest || busy) return;
    const intent = archiveFocusIntent.current;
    setArchiveFocusRequest(null);
    if (!intent || intent.id !== archiveFocusRequest.id) return;
    intent.stop();
    archiveFocusIntent.current = null;
    if (intent.moved) return;
    const target =
      archiveFocusRequest.target === 'archive'
        ? archiveButtonRefs.current.get(archiveFocusRequest.id)
        : archiveFocusRequest.target === 'edit'
          ? editButtonRefs.current.get(archiveFocusRequest.id)
          : archiveFocusRequest.target === 'reconcile'
            ? reconcileButtonRef.current
            : headingRef.current;
    const unavailable =
      !target ||
      (target instanceof HTMLButtonElement && target.disabled) ||
      !target.isConnected ||
      target.closest('[hidden], [inert], [aria-hidden="true"]') !== null;
    const fallback = headingRef.current;
    const destination = unavailable ? fallback : target;
    if (
      destination?.isConnected &&
      !destination.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      destination.focus();
  }, [archiveFocusRequest, busy, archiveReconciliation, rows]);
  async function readTemplates() {
    const response = await fetch('/api/v1/document-templates');
    if (!response.ok) throw new Error('load');
    const result: unknown = await response.json();
    if (!Array.isArray(result) || !result.every(isTemplate))
      throw new Error('load');
    return result;
  }
  async function refresh() {
    const result = await readTemplates();
    setRows(result);
    return result;
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
  function hasUnsavedDraft() {
    const form = editorFormRef.current;
    return (
      editorOpenRef.current &&
      form !== null &&
      (JSON.stringify(
        Array.from(
          form.querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >('[name]'),
        ).map((field) => [field.name, field.value]),
      ) !== baselineFields.current ||
        JSON.stringify(positions) !== baselinePositions.current)
    );
  }
  useEffect(
    () => registerUnsavedChanges(hasUnsavedDraft),
    [editorOpen, positions],
  );
  useLayoutEffect(() => {
    if (editorOpen) {
      const target =
        editorFormRef.current?.querySelector<HTMLElement>('input[name="name"]');
      if (
        target?.isConnected &&
        !target.closest('[hidden], [inert], [aria-hidden="true"]')
      )
        target.focus();
    } else if (editorWasOpen.current) {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      const available = (element: HTMLElement | null): element is HTMLElement =>
        Boolean(
          element?.isConnected &&
          !(element instanceof HTMLButtonElement && element.disabled) &&
          !element.closest('[hidden], [inert], [aria-hidden="true"]'),
        );
      if (restoreFocusAfterClose.current) {
        if (available(target)) target.focus({ preventScroll: true });
        else {
          const fallback = createButtonRef.current;
          if (available(fallback)) fallback.focus({ preventScroll: true });
        }
      }
      restoreFocusAfterClose.current = true;
    }
    editorWasOpen.current = editorOpen;
  }, [editorOpen, editorGeneration, draft, editing]);
  function begin(template: Template | null, copy = false, origin: HTMLElement) {
    if (editorOpenRef.current && hasUnsavedDraft()) {
      if (!window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    }
    if (!archiveReconciliation) {
      setMessage('');
      setConversionError(false);
    }
    const nextDraft =
      template && copy
        ? { ...template, name: `${template.name.slice(0, 112)} (Kopie)` }
        : template;
    const nextPositions = template?.positions.length
      ? template.positions.map(toDraft)
      : [emptyPosition()];
    returnFocusRef.current = origin;
    baselineFields.current = JSON.stringify([
      ['kind', nextDraft?.kind ?? 'offer'],
      ['name', nextDraft?.name ?? ''],
      ['subject', nextDraft?.subject ?? ''],
      ['introText', nextDraft?.introText ?? ''],
      ['outroText', nextDraft?.outroText ?? ''],
      ['validityDays', String(nextDraft?.validityDays ?? 14)],
      ['state', nextDraft?.state ?? 'active'],
    ]);
    baselinePositions.current = JSON.stringify(nextPositions);
    setEditorGeneration((current) => current + 1);
    restoreFocusAfterClose.current = true;
    editorOpenRef.current = true;
    setEditorOpen(true);
    setDraft(nextDraft);
    setPositions(nextPositions);
    setEditing(Boolean(template) && !copy);
  }
  function closeEditor() {
    if (busy || archiveReconciliation) return;
    if (
      hasUnsavedDraft() &&
      !window.confirm('Ungespeicherte Änderungen verwerfen?')
    )
      return;
    editorOpenRef.current = false;
    restoreFocusAfterClose.current = true;
    setEditorOpen(false);
    setDraft(null);
    setEditing(false);
    setPositions([emptyPosition()]);
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
    if (!product) {
      updatePosition(index, { productId: '' });
      setMessage('');
      setConversionError(false);
      return;
    }
    try {
      const grossPrice = grossProductPrice(
        product.priceMinor,
        product.priceBasis,
        product.taxBasisPoints,
      );
      updatePosition(index, {
        productId,
        description: product.name,
        unit: product.unit,
        price: formatHundredths(grossPrice),
        tax: formatHundredths(product.taxBasisPoints),
      });
      setMessage('');
      setConversionError(false);
    } catch {
      setMessage(
        'Produktpreis konnte nicht in den sicheren Bruttobetrag umgerechnet werden. Die Position blieb unverändert. Bitte Produktpreis und Steuersatz prüfen oder Brutto-Einzelpreis manuell eintragen.',
      );
      setConversionError(true);
    }
  }
  async function save(form: HTMLFormElement) {
    if (busy || archiveReconciliation) return;
    setBusy(true);
    setMessage('');
    setConversionError(false);
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
      const activeElement = document.activeElement;
      restoreFocusAfterClose.current =
        activeElement === document.body ||
        editorFormRef.current?.contains(activeElement) === true;
      editorOpenRef.current = false;
      setEditorOpen(false);
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
  async function reconcileArchive(origin: HTMLElement) {
    const current = archiveReconciliation;
    if (!current || busy || archiveInFlight.current) return;
    trackArchiveFocus(current.id, origin);
    archiveInFlight.current = true;
    setBusy(true);
    setMessage('Vorlagen werden neu geladen …');
    setConversionError(false);
    try {
      const result = await readTemplates();
      const row = result.find((template) => template.id === current.id);
      if (current.outcome === 'confirmed' && current.confirmed) {
        if (row && row.version > current.confirmed.version) {
          setRows(result);
          setArchiveReconciliation(null);
          setMessage(
            'Archivierung bestätigt. Die Vorlage wurde inzwischen erneut geändert; der aktuelle Stand wurde geladen.',
          );
          setConversionError(false);
          requestArchiveFocus(
            current.id,
            row.state === 'active' ? 'archive' : 'edit',
          );
          return;
        }
        if (
          row?.state === 'archived' &&
          row.version === current.confirmed.version &&
          sameTemplateContent(row, current.confirmed)
        ) {
          setRows(result);
          setArchiveReconciliation(null);
          setMessage('Vorlagen neu geladen. Die Archivierung ist bestätigt.');
          requestArchiveFocus(current.id, 'edit');
          return;
        }
        const withoutTarget = result.filter(
          (template) => template.id !== current.id,
        );
        setRows([...withoutTarget, current.confirmed]);
        setMessage(
          'Die Archivierung ist bestätigt. Der Listenstand weicht ab. Bitte Vorlagen erneut laden.',
        );
        setConversionError(true);
        requestArchiveFocus(current.id, 'reconcile');
        return;
      }
      setRows(result);
      setArchiveReconciliation(null);
      setConversionError(false);
      setMessage(
        !row
          ? 'Vorlagen neu geladen. Die Vorlage ist nicht mehr vorhanden.'
          : row.state === 'archived'
            ? 'Vorlagen neu geladen. Die Vorlage ist archiviert.'
            : 'Vorlagen neu geladen. Die Vorlage ist nicht archiviert; du kannst den Vorgang erneut starten.',
      );
      requestArchiveFocus(
        current.id,
        !row ? 'heading' : row.state === 'active' ? 'archive' : 'edit',
      );
    } catch {
      setMessage(
        current.outcome === 'confirmed'
          ? 'Vorlage archiviert. Die Liste konnte nicht aktualisiert werden. Bitte Vorlagen erneut laden.'
          : 'Der Serverstand konnte nicht abgeglichen werden. Bitte Vorlagen erneut laden.',
      );
      setConversionError(true);
      requestArchiveFocus(current.id, 'reconcile');
    } finally {
      archiveInFlight.current = false;
      setArchivePendingId(null);
      setBusy(false);
    }
  }
  async function archive(row: Template, origin: HTMLElement) {
    if (
      row.state === 'archived' ||
      busy ||
      archiveInFlight.current ||
      archiveReconciliation !== null
    )
      return;
    trackArchiveFocus(row.id, origin);
    archiveInFlight.current = true;
    setArchivePendingId(row.id);
    setBusy(true);
    setMessage('Vorlage wird archiviert …');
    setConversionError(false);
    try {
      const response = await fetch(`/api/v1/document-templates/${row.id}`, {
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
      });
      if (!response.ok) {
        let focusTarget: ArchiveFocusTarget = 'archive';
        if (response.status === 404 || response.status === 409) {
          focusTarget = 'reconcile';
          setArchiveReconciliation({ id: row.id, outcome: 'stale' });
          setMessage(
            response.status === 409
              ? 'Vorlage wurde inzwischen geändert. Bitte Vorlagen neu laden, bevor du erneut archivierst.'
              : 'Vorlage ist nicht mehr verfügbar. Bitte Vorlagen neu laden, bevor du erneut archivierst.',
          );
        } else if (response.status >= 500) {
          focusTarget = 'reconcile';
          setArchiveReconciliation({ id: row.id, outcome: 'unknown' });
          setMessage(
            'Der Archivierungsstand ist unklar. Bitte Vorlagen neu laden, bevor du erneut archivierst.',
          );
        } else {
          setMessage(
            response.status === 401
              ? 'Bitte erneut anmelden, um die Vorlage zu archivieren.'
              : response.status === 403
                ? 'Du darfst Dokumentvorlagen nicht ändern. Bitte deine Berechtigung prüfen.'
                : 'Archivierung abgelehnt. Angaben und Berechtigung prüfen.',
          );
        }
        setConversionError(true);
        requestArchiveFocus(row.id, focusTarget);
        return;
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        setArchiveReconciliation({ id: row.id, outcome: 'unknown' });
        setMessage(
          'Der Archivierungsstand ist unklar. Bitte Vorlagen neu laden, bevor du erneut archivierst.',
        );
        setConversionError(true);
        requestArchiveFocus(row.id, 'reconcile');
        return;
      }
      if (
        !isTemplate(result) ||
        result.id !== row.id ||
        result.version !== row.version + 1 ||
        result.state !== 'archived' ||
        !sameTemplateContent(result, row)
      ) {
        setArchiveReconciliation({ id: row.id, outcome: 'unknown' });
        setMessage(
          'Die Archivierungsantwort war unplausibel. Bitte Vorlagen neu laden, bevor du erneut archivierst.',
        );
        setConversionError(true);
        requestArchiveFocus(row.id, 'reconcile');
        return;
      }

      setRows((current) =>
        current.map((template) =>
          template.id === result.id ? result : template,
        ),
      );
      setArchiveReconciliation({
        id: result.id,
        outcome: 'confirmed',
        confirmed: result,
      });
      setMessage('Vorlage archiviert.');
      setConversionError(false);
      try {
        const refreshed = await readTemplates();
        const archived = refreshed.find((template) => template.id === row.id);
        if (archived && archived.version > result.version) {
          setRows(refreshed);
          setArchiveReconciliation(null);
          setMessage(
            'Vorlage archiviert. Die Vorlage wurde inzwischen erneut geändert; der aktuelle Stand wurde geladen.',
          );
          setConversionError(false);
          requestArchiveFocus(
            row.id,
            archived.state === 'active' ? 'archive' : 'edit',
          );
          return;
        }
        if (
          archived?.state === 'archived' &&
          archived.version === result.version &&
          sameTemplateContent(archived, result)
        ) {
          setRows(refreshed);
          setArchiveReconciliation(null);
          setMessage('Vorlage archiviert.');
          requestArchiveFocus(row.id, 'edit');
        } else {
          setRows([
            ...refreshed.filter((template) => template.id !== result.id),
            result,
          ]);
          setMessage(
            'Vorlage archiviert. Der Listenstand weicht ab. Bitte Vorlagen erneut laden.',
          );
          setConversionError(true);
          requestArchiveFocus(row.id, 'reconcile');
        }
      } catch {
        setMessage(
          'Vorlage archiviert. Die Liste konnte nicht aktualisiert werden. Bitte Vorlagen erneut laden.',
        );
        setConversionError(true);
        requestArchiveFocus(row.id, 'reconcile');
      }
    } catch {
      setArchiveReconciliation({ id: row.id, outcome: 'unknown' });
      setMessage(
        'Der Archivierungsstand ist unklar. Bitte Vorlagen neu laden, bevor du erneut archivierst.',
      );
      setConversionError(true);
      requestArchiveFocus(row.id, 'reconcile');
    } finally {
      archiveInFlight.current = false;
      setArchivePendingId(null);
      setBusy(false);
    }
  }
  return (
    <section id="document-templates" aria-label="Dokumentvorlagen">
      <h2 ref={headingRef} tabIndex={-1}>
        Dokumentvorlagen
      </h2>
      {!editorOpen && (
        <button
          ref={createButtonRef}
          type="button"
          className="primary-action"
          disabled={busy || archiveReconciliation !== null}
          onClick={(event) => begin(null, false, event.currentTarget)}
        >
          Vorlage anlegen
        </button>
      )}
      {editorOpen && (
        <form
          ref={editorFormRef}
          key={`${editorGeneration}:${draft?.id ?? 'new'}:${draft?.version ?? 0}:${editing}`}
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
        >
          <p>
            Platzhalter: {placeholders.map((name) => `{{${name}}}`).join(', ')}.
            Unbekannte Platzhalter werden beim Speichern abgewiesen.
          </p>
          <fieldset disabled={busy || archiveReconciliation !== null}>
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
                    onChange={(event) =>
                      applyProduct(index, event.target.value)
                    }
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
                  Einzelpreis (Brutto) in Euro
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
            <button
              type="button"
              className="tertiary-action"
              onClick={closeEditor}
            >
              Abbrechen
            </button>
          </fieldset>
        </form>
      )}
      <p role={conversionError ? 'alert' : 'status'}>{message}</p>
      {archiveReconciliation && (
        <button
          ref={reconcileButtonRef}
          type="button"
          className="tertiary-action"
          disabled={busy}
          onClick={(event) => void reconcileArchive(event.currentTarget)}
        >
          Vorlagen neu laden
        </button>
      )}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {kinds.find(([value]) => value === row.kind)?.[1] ?? row.kind}:{' '}
              {row.name} – {row.positions.length} Position(en)
              {row.state === 'archived' ? ' – Archiviert' : ''}
            </span>{' '}
            <button
              ref={(element) => {
                if (element) editButtonRefs.current.set(row.id, element);
                else editButtonRefs.current.delete(row.id);
              }}
              className="secondary-action"
              disabled={busy || archiveReconciliation !== null}
              aria-label={`Vorlage bearbeiten: ${row.name}`}
              onClick={(event) => begin(row, false, event.currentTarget)}
            >
              Bearbeiten
            </button>
            <button
              className="secondary-action"
              disabled={busy || archiveReconciliation !== null}
              aria-label={`Vorlage duplizieren: ${row.name}`}
              onClick={(event) => begin(row, true, event.currentTarget)}
            >
              Duplizieren
            </button>
            <button
              ref={(element) => {
                if (element) archiveButtonRefs.current.set(row.id, element);
                else archiveButtonRefs.current.delete(row.id);
              }}
              className="tertiary-action"
              type="button"
              disabled={
                busy ||
                row.state === 'archived' ||
                archiveReconciliation !== null
              }
              aria-label={`Vorlage archivieren: ${row.name}`}
              onClick={(event) => void archive(row, event.currentTarget)}
            >
              {archivePendingId === row.id
                ? 'Archivierung läuft …'
                : 'Archivieren'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
