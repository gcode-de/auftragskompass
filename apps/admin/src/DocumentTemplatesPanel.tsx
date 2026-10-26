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
type TemplatePayload = Omit<Template, 'id' | 'version'>;
type CreateAttempt = {
  requestId: string;
  body: string;
  payload: TemplatePayload;
};
type SaveRecovery =
  | { kind: 'confirmed'; template: Template }
  | { kind: 'put'; id: string; version: number };
type ArchiveReconciliation = {
  id: string;
  outcome: 'unknown' | 'stale' | 'confirmed';
  confirmed?: Template;
};
type ArchiveFocusTarget = 'actions' | 'reconcile' | 'heading';
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
const templateKindGroups: [string, string][] = [
  ['offer', 'Angebote'],
  ['order_confirmation', 'Auftragsbestätigungen'],
  ['deposit_invoice', 'Anzahlungsrechnungen'],
  ['invoice', 'Rechnungen'],
  ['correction', 'Rechnungskorrekturen'],
];
const states: [string, string][] = [
  ['active', 'Aktiv'],
  ['inactive', 'Inaktiv'],
  ['archived', 'Archiviert'],
];
// The search and the two narrowing selects are an explicit user requirement,
// not an observed Bookitup function: B35 showed no search or archive filters on
// the examined desktop list. The filters therefore run client-side over the
// loaded list and keep GET /api/v1/document-templates queryless.
const otherKindFilterValue = 'other';
const otherKindGroupName = 'Weitere Dokumentarten';
const isKnownTemplateKind = (kind: string) =>
  templateKindGroups.some(([known]) => known === kind);
function matchesTemplateFilters(
  row: Template,
  search: string,
  kindFilter: string,
  stateFilter: string,
) {
  const needle = search.trim().toLowerCase();
  if (needle !== '' && !row.name.toLowerCase().includes(needle)) return false;
  if (kindFilter !== '') {
    if (kindFilter === otherKindFilterValue) {
      if (isKnownTemplateKind(row.kind)) return false;
    } else if (row.kind !== kindFilter) return false;
  }
  return stateFilter === '' || row.state === stateFilter;
}
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

function matchesTemplateWrite(
  value: unknown,
  expected: TemplatePayload,
  id: string | undefined,
  version: number,
): value is Template {
  if (!isTemplate(value)) return false;
  return (
    value.id.trim().length > 0 &&
    (!id || value.id === id) &&
    value.version === version &&
    value.kind === expected.kind &&
    value.name === expected.name.trim() &&
    value.subject === expected.subject &&
    value.introText === expected.introText &&
    value.outroText === expected.outroText &&
    value.validityDays === expected.validityDays &&
    value.state === expected.state &&
    value.positions.length === expected.positions.length &&
    value.positions.every((position, index) => {
      const sent = expected.positions[index];
      return (
        typeof position.id === 'string' &&
        position.id.trim().length > 0 &&
        sent !== undefined &&
        position.productId === (sent.productId ?? null) &&
        position.description === sent.description.trim() &&
        position.quantity === sent.quantity &&
        position.unit === sent.unit.trim() &&
        position.unitPriceMinor === sent.unitPriceMinor &&
        position.taxBasisPoints === sent.taxBasisPoints &&
        position.discountBasisPoints === sent.discountBasisPoints
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
    [saveRecovery, setSaveRecovery] = useState<SaveRecovery | null>(null),
    [uncertainCreate, setUncertainCreate] = useState(false),
    [archiveFocusRequest, setArchiveFocusRequest] =
      useState<ArchiveFocusRequest | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewMessage, setPreviewMessage] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const archiveInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const previewInFlight = useRef(false);
  const previewSequence = useRef(0);
  const previewUrlRef = useRef('');
  const listGeneration = useRef(0);
  const saveFocusWasInForm = useRef(false);
  const saveReconcileFocusOrigin = useRef<SaveRecovery | null>(null);
  const deferredSaveCloseFocus = useRef(false);
  const deferredSaveReturnTarget = useRef<HTMLElement | null>(null);
  const createAttempt = useRef<CreateAttempt | null>(null);
  const archiveFocusIntent = useRef<ArchiveFocusIntent | null>(null);
  const actionRowRefs = useRef(new Map<string, HTMLLIElement>());
  const actionToggleRefs = useRef(new Map<string, HTMLButtonElement>());
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const editorFormRef = useRef<HTMLFormElement>(null);
  const editorOpenRef = useRef(false);
  const editorWasOpen = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusTemplateId = useRef<string | null>(null);
  const restoreFocusAfterClose = useRef(true);
  const baselineFields = useRef('');
  const baselinePositions = useRef('');
  const reconcileButtonRef = useRef<HTMLButtonElement>(null);
  const saveRetryButtonRef = useRef<HTMLButtonElement>(null);
  const saveReconcileButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A narrowing filter removes rows from the list. An open disclosure whose row
  // disappeared would keep aria-expanded pointing at nothing, so it closes with
  // the row instead of staying silently open.
  useEffect(() => {
    if (!openActionsId) return;
    const row = rows.find((entry) => entry.id === openActionsId);
    if (!row || !matchesTemplateFilters(row, search, kindFilter, stateFilter))
      setOpenActionsId(null);
  }, [openActionsId, rows, search, kindFilter, stateFilter]);
  useEffect(
    () => () => {
      archiveFocusIntent.current?.stop();
      archiveFocusIntent.current = null;
      previewSequence.current++;
      previewInFlight.current = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    },
    [],
  );
  useEffect(() => {
    if (!openActionsId) return;
    const closeIfOutside = (target: EventTarget | null) => {
      const row = actionRowRefs.current.get(openActionsId);
      if (row && target instanceof Node && !row.contains(target))
        setOpenActionsId(null);
    };
    const onPointerDown = (event: PointerEvent) => closeIfOutside(event.target);
    const onFocusIn = (event: FocusEvent) => closeIfOutside(event.target);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [openActionsId]);
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
      archiveFocusRequest.target === 'actions'
        ? actionToggleRefs.current.get(archiveFocusRequest.id)
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
    const generation = listGeneration.current;
    const result = await readTemplates();
    if (generation === listGeneration.current) setRows(result);
    return result;
  }
  useEffect(() => {
    const generation = listGeneration.current;
    void refresh().catch(() => {
      if (generation === listGeneration.current)
        setMessage('Vorlagen konnten nicht geladen werden.');
    });
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
      uncertainCreate ||
      (saveInFlight.current && editorOpenRef.current) ||
      (saveRecovery?.kind === 'put' && editorOpenRef.current) ||
      (editorOpenRef.current &&
        form !== null &&
        (JSON.stringify(
          Array.from(
            form.querySelectorAll<
              HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
            >('[name]'),
          ).map((field) => [field.name, field.value]),
        ) !== baselineFields.current ||
          JSON.stringify(positions) !== baselinePositions.current))
    );
  }
  function applyConfirmedTemplateSnapshot(
    confirmed: Template,
    refreshed: Template[],
  ) {
    const current = refreshed.find((row) => row.id === confirmed.id);
    if (
      !current ||
      current.version < confirmed.version ||
      (current.version === confirmed.version &&
        (current.state !== confirmed.state ||
          !sameTemplateContent(current, confirmed)))
    ) {
      setRows((existing) => {
        const previous = existing.find((row) => row.id === confirmed.id);
        const preserved =
          previous && previous.version > confirmed.version
            ? previous
            : confirmed;
        return [
          ...refreshed.filter((row) => row.id !== confirmed.id),
          preserved,
        ];
      });
      setSaveRecovery({ kind: 'confirmed', template: confirmed });
      setMessage(
        'Vorlage gespeichert. Der Listenstand ist noch nicht aktuell. Bitte Vorlagen neu laden.',
      );
      setConversionError(true);
      return false;
    }
    setRows(refreshed);
    setSaveRecovery(null);
    setMessage(
      current.version > confirmed.version
        ? 'Vorlage gespeichert. Die Vorlage wurde inzwischen geändert; der aktuelle Stand wurde geladen.'
        : 'Gespeichert.',
    );
    setConversionError(false);
    return true;
  }
  useEffect(
    () => registerUnsavedChanges(hasUnsavedDraft),
    [editorOpen, positions, saveRecovery, uncertainCreate],
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
      const templateId = returnFocusTemplateId.current;
      returnFocusRef.current = null;
      returnFocusTemplateId.current = null;
      const available = (element: HTMLElement | null): element is HTMLElement =>
        Boolean(
          element?.isConnected &&
          !(element instanceof HTMLButtonElement && element.disabled) &&
          !element.closest('[hidden], [inert], [aria-hidden="true"]'),
        );
      if (restoreFocusAfterClose.current) {
        if (available(target)) target.focus({ preventScroll: true });
        else {
          const fallback =
            (templateId && editButtonRefs.current.get(templateId)) ||
            createButtonRef.current;
          if (available(fallback)) fallback.focus({ preventScroll: true });
          else if (saveFocusWasInForm.current) {
            deferredSaveCloseFocus.current = true;
            deferredSaveReturnTarget.current = target;
          }
        }
      }
      restoreFocusAfterClose.current = true;
    }
    editorWasOpen.current = editorOpen;
  }, [editorOpen, editorGeneration, draft, editing]);
  useLayoutEffect(() => {
    if (busy || !saveFocusWasInForm.current) return;
    const active = document.activeElement;
    const focusWasLost =
      active === document.body ||
      (editorFormRef.current?.contains(active) === true &&
        active instanceof HTMLElement &&
        active.matches(':disabled'));
    if (!focusWasLost) {
      saveFocusWasInForm.current = false;
      saveReconcileFocusOrigin.current = null;
      return;
    }
    if (uncertainCreate) {
      const target = saveRetryButtonRef.current;
      if (target?.isConnected && !target.disabled) {
        target.focus();
        saveFocusWasInForm.current = false;
      }
    } else if (saveRecovery) {
      const target = saveReconcileButtonRef.current;
      if (target?.isConnected && !target.disabled) {
        target.focus();
        saveFocusWasInForm.current = false;
      }
    } else if (saveReconcileFocusOrigin.current) {
      const origin = saveReconcileFocusOrigin.current;
      const target =
        origin.kind === 'put'
          ? editorFormRef.current?.querySelector<HTMLElement>(
              'input[name="name"]',
            )
          : editButtonRefs.current.get(origin.template.id);
      const destination = target ?? headingRef.current;
      if (
        destination?.isConnected &&
        !destination.closest('[hidden], [inert], [aria-hidden="true"]') &&
        !(destination instanceof HTMLButtonElement && destination.disabled)
      )
        destination.focus({ preventScroll: true });
      saveReconcileFocusOrigin.current = null;
      saveFocusWasInForm.current = false;
    } else {
      saveFocusWasInForm.current = false;
    }
  }, [busy, saveRecovery, uncertainCreate]);
  useLayoutEffect(() => {
    if (!deferredSaveCloseFocus.current || busy) return;
    if (document.activeElement !== document.body) {
      deferredSaveCloseFocus.current = false;
      deferredSaveReturnTarget.current = null;
      saveFocusWasInForm.current = false;
      return;
    }
    const recoveryTarget = uncertainCreate
      ? saveRetryButtonRef.current
      : saveRecovery
        ? saveReconcileButtonRef.current
        : null;
    const target = recoveryTarget ?? deferredSaveReturnTarget.current;
    const available =
      target?.isConnected &&
      !(target instanceof HTMLButtonElement && target.disabled) &&
      !target.closest('[hidden], [inert], [aria-hidden="true"]');
    if (available) target.focus({ preventScroll: true });
    deferredSaveCloseFocus.current = false;
    deferredSaveReturnTarget.current = null;
    saveFocusWasInForm.current = false;
  }, [busy, saveRecovery, uncertainCreate]);
  function begin(template: Template | null, copy = false, origin: HTMLElement) {
    if (busy || archiveReconciliation || saveRecovery || uncertainCreate)
      return;
    if (editorOpenRef.current && hasUnsavedDraft()) {
      if (!window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    }
    if (!archiveReconciliation) {
      setMessage('');
      setConversionError(false);
    }
    invalidatePreview(false);
    const nextDraft =
      template && copy
        ? { ...template, name: `${template.name.slice(0, 112)} (Kopie)` }
        : template;
    const nextPositions = template?.positions.length
      ? template.positions.map(toDraft)
      : [emptyPosition()];
    returnFocusRef.current = origin;
    returnFocusTemplateId.current = template && !copy ? template.id : null;
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
    if (busy || archiveReconciliation || saveRecovery || uncertainCreate)
      return;
    if (
      hasUnsavedDraft() &&
      !window.confirm('Ungespeicherte Änderungen verwerfen?')
    )
      return;
    editorOpenRef.current = false;
    invalidatePreview(false);
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
  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
  }
  function invalidatePreview(showStale = true) {
    const hadPreview = Boolean(previewUrlRef.current);
    const wasBusy = previewInFlight.current;
    previewSequence.current++;
    previewInFlight.current = false;
    setPreviewBusy(false);
    clearPreview();
    setPreviewError('');
    if (showStale && (hadPreview || wasBusy))
      setPreviewMessage('Entwurf geändert. Bitte Vorschau erneut erstellen.');
    else setPreviewMessage('');
  }
  function templatePayload(form: HTMLFormElement): TemplatePayload {
    const data = new FormData(form);
    return {
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
    };
  }
  async function preview(form: HTMLFormElement) {
    if (
      previewInFlight.current ||
      busy ||
      archiveReconciliation !== null ||
      saveRecovery !== null ||
      uncertainCreate ||
      !editorOpenRef.current
    )
      return;
    const sequence = ++previewSequence.current;
    previewInFlight.current = true;
    clearPreview();
    setPreviewBusy(true);
    setPreviewMessage('Inhaltsvorschau wird erstellt …');
    setPreviewError('');
    try {
      const input = templatePayload(form);
      const response = await fetch('/api/v1/document-templates/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(input),
      });
      if (sequence !== previewSequence.current) return;
      if (!response.ok) {
        let errorCode = '';
        try {
          const result: unknown = await response.json();
          if (result && typeof result === 'object' && 'error' in result)
            errorCode = String(result.error);
        } catch {
          // The HTTP status still has a safe, actionable fallback.
        }
        if (sequence !== previewSequence.current) return;
        setPreviewError(
          errorCode === 'unknown_placeholder'
            ? 'Unbekannter Platzhalter. Nur die aufgeführten Platzhalter verwenden. Deine Eingaben bleiben erhalten.'
            : errorCode === 'invalid_template'
              ? 'Vorlage ist ungültig. Angaben und Preise prüfen. Deine Eingaben bleiben erhalten.'
              : response.status === 401
                ? 'Bitte erneut anmelden, um die Vorschau zu erstellen. Deine Eingaben bleiben erhalten.'
                : response.status === 403
                  ? 'Du darfst keine Vorschau erstellen. Bitte deine Berechtigung prüfen. Deine Eingaben bleiben erhalten.'
                  : 'PDF-Vorschau konnte nicht erstellt werden. Deine Eingaben bleiben erhalten.',
        );
        setPreviewMessage('');
        return;
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== 'application/pdf') throw new Error('preview');
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024)
        throw new Error('preview');
      const blob = await response.blob();
      if (
        blob.size > 10 * 1024 * 1024 ||
        !(await blob.slice(0, 5).text()).startsWith('%PDF-')
      )
        throw new Error('preview');
      if (sequence !== previewSequence.current) return;
      const url = URL.createObjectURL(blob);
      if (sequence !== previewSequence.current) {
        URL.revokeObjectURL(url);
        return;
      }
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setPreviewMessage('PDF-Vorschau erstellt.');
    } catch (error) {
      if (sequence === previewSequence.current) {
        setPreviewError(
          error instanceof Error && error.message === 'Ungültiger Dezimalwert'
            ? 'Preise, Steuer und Rabatt mit höchstens zwei Nachkommastellen eingeben.'
            : 'PDF-Vorschau konnte nicht erstellt werden. Deine Eingaben bleiben erhalten.',
        );
        setPreviewMessage('');
      }
    } finally {
      if (sequence === previewSequence.current) {
        previewInFlight.current = false;
        setPreviewBusy(false);
      }
    }
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
  async function save(form: HTMLFormElement, retryCreate = false) {
    if (
      saveInFlight.current ||
      previewInFlight.current ||
      busy ||
      archiveReconciliation ||
      saveRecovery
    )
      return;
    if (uncertainCreate && !retryCreate) return;
    saveFocusWasInForm.current =
      editorFormRef.current?.contains(document.activeElement) === true ||
      document.activeElement === saveRetryButtonRef.current;
    saveReconcileFocusOrigin.current = null;
    saveInFlight.current = true;
    setBusy(true);
    setMessage('');
    setConversionError(false);
    try {
      const attempt = retryCreate ? createAttempt.current : null;
      if (retryCreate && (!attempt || editing)) return;
      const input: TemplatePayload = attempt?.payload ?? templatePayload(form);
      const requestId = retryCreate
        ? attempt!.requestId
        : editing
          ? undefined
          : globalThis.crypto.randomUUID();
      const body = retryCreate
        ? attempt!.body
        : JSON.stringify({
            ...input,
            ...(editing ? { version: draft!.version } : { requestId }),
          });
      if (!editing && !retryCreate)
        createAttempt.current = { requestId: requestId!, body, payload: input };
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
          body,
        },
      );
      if (!response.ok) {
        if (
          editing &&
          (response.status === 404 ||
            response.status === 409 ||
            response.status >= 500)
        ) {
          setSaveRecovery({
            kind: 'put',
            id: draft!.id,
            version: draft!.version,
          });
          setMessage(
            response.status === 409
              ? 'Inzwischen geändert. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.'
              : response.status === 404
                ? 'Vorlage ist nicht mehr verfügbar. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.'
                : 'Speicherergebnis unklar. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.',
          );
          setConversionError(true);
          return;
        }
        if (!editing && ![400, 401, 403].includes(response.status)) {
          setUncertainCreate(true);
          setMessage(
            'Der Speicherauftrag ist unklar. Bitte denselben Auftrag sicher wiederholen.',
          );
          setConversionError(true);
          return;
        }
        let result: { error?: string } = {};
        try {
          result = (await response.json()) as { error?: string };
        } catch {
          // A known HTTP rejection remains known even without a JSON body.
        }
        if (!editing && !retryCreate) {
          createAttempt.current = null;
          setUncertainCreate(false);
        }
        setMessage(
          result.error === 'conflict'
            ? 'Inzwischen geändert. Vorlagen aktualisieren und erneut bearbeiten.'
            : result.error === 'unknown_placeholder'
              ? 'Unbekannter Platzhalter. Nur die aufgeführten Platzhalter verwenden.'
              : response.status === 401
                ? 'Bitte erneut anmelden, um die Vorlage zu speichern.'
                : response.status === 403
                  ? 'Du darfst Dokumentvorlagen nicht ändern. Bitte deine Berechtigung prüfen.'
                  : 'Speichern fehlgeschlagen. Angaben und Preise prüfen.',
        );
        setConversionError(true);
        return;
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        if (editing)
          setSaveRecovery({
            kind: 'put',
            id: draft!.id,
            version: draft!.version,
          });
        else setUncertainCreate(true);
        setMessage(
          editing
            ? 'Speicherergebnis unklar. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.'
            : 'Der Speicherauftrag ist unklar. Bitte denselben Auftrag sicher wiederholen.',
        );
        setConversionError(true);
        return;
      }
      const expectedVersion = editing ? draft!.version + 1 : 1;
      if (
        (!editing &&
          !retryCreate &&
          rows.some(
            (row) =>
              row.id ===
              (result && typeof result === 'object' && 'id' in result
                ? result.id
                : undefined),
          )) ||
        !matchesTemplateWrite(
          result,
          input,
          editing ? draft!.id : undefined,
          expectedVersion,
        )
      ) {
        if (editing)
          setSaveRecovery({
            kind: 'put',
            id: draft!.id,
            version: draft!.version,
          });
        else setUncertainCreate(true);
        setMessage(
          editing
            ? 'Die Speicherantwort war unplausibel. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.'
            : 'Die Speicherantwort war unplausibel. Bitte denselben Auftrag sicher wiederholen.',
        );
        setConversionError(true);
        return;
      }
      const saved = result;
      listGeneration.current += 1;
      setRows((current) => {
        const previous = current.find((row) => row.id === saved.id);
        if (previous && previous.version > saved.version) return current;
        return [...current.filter((row) => row.id !== saved.id), saved];
      });
      setSaveRecovery({ kind: 'confirmed', template: saved });
      if (!editing) {
        createAttempt.current = null;
        setUncertainCreate(false);
      }
      const activeElement = document.activeElement;
      restoreFocusAfterClose.current =
        activeElement === document.body ||
        editorFormRef.current?.contains(activeElement) === true;
      invalidatePreview(false);
      editorOpenRef.current = false;
      setEditorOpen(false);
      setDraft(null);
      setEditing(false);
      setPositions([emptyPosition()]);
      form.reset();
      setMessage('Gespeichert.');
      try {
        const refreshed = await readTemplates();
        applyConfirmedTemplateSnapshot(saved, refreshed);
      } catch {
        setSaveRecovery({ kind: 'confirmed', template: saved });
        setMessage(
          'Vorlage gespeichert. Die Liste konnte nicht aktualisiert werden.',
        );
        setConversionError(true);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Ungültiger Dezimalwert'
      ) {
        setMessage(
          'Preise, Steuer und Rabatt mit höchstens zwei Nachkommastellen eingeben.',
        );
        setConversionError(true);
      } else if (editing) {
        setSaveRecovery({
          kind: 'put',
          id: draft!.id,
          version: draft!.version,
        });
        setMessage(
          'Speicherergebnis unklar. Bitte Vorlagen neu laden; dein Entwurf bleibt erhalten.',
        );
        setConversionError(true);
      } else {
        if (createAttempt.current) {
          setUncertainCreate(true);
          setMessage(
            'Der Speicherauftrag ist unklar. Bitte denselben Auftrag sicher wiederholen.',
          );
        } else {
          setMessage('Speichern fehlgeschlagen. Angaben und Preise prüfen.');
        }
        setConversionError(true);
      }
    } finally {
      saveInFlight.current = false;
      setBusy(false);
    }
  }
  async function reconcileSave() {
    const currentRecovery = saveRecovery;
    if (!currentRecovery || busy || saveInFlight.current) return;
    saveFocusWasInForm.current =
      document.activeElement === saveReconcileButtonRef.current;
    saveReconcileFocusOrigin.current = saveFocusWasInForm.current
      ? currentRecovery
      : null;
    saveInFlight.current = true;
    setBusy(true);
    setMessage('Vorlagen werden neu geladen …');
    try {
      const refreshed = await readTemplates();
      if (currentRecovery.kind === 'confirmed') {
        applyConfirmedTemplateSnapshot(currentRecovery.template, refreshed);
      } else {
        setRows(refreshed);
        setSaveRecovery(null);
        const row = refreshed.find((entry) => entry.id === currentRecovery.id);
        setMessage(
          row
            ? 'Serverstand geladen. Dein Entwurf blieb unverändert; zum Speichern bitte die aktuelle Vorlage erneut öffnen.'
            : 'Vorlage nicht mehr vorhanden. Dein Entwurf blieb unverändert.',
        );
        setConversionError(false);
      }
    } catch {
      setMessage(
        currentRecovery.kind === 'confirmed'
          ? 'Vorlage gespeichert. Die Liste konnte nicht aktualisiert werden.'
          : 'Der Serverstand konnte nicht abgeglichen werden. Dein Entwurf bleibt erhalten. Bitte Vorlagen neu laden.',
      );
      setConversionError(true);
    } finally {
      saveInFlight.current = false;
      setBusy(false);
    }
  }
  async function reconcileArchive(origin: HTMLElement) {
    const current = archiveReconciliation;
    if (
      !current ||
      busy ||
      saveRecovery ||
      uncertainCreate ||
      archiveInFlight.current
    )
      return;
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
          requestArchiveFocus(current.id, 'actions');
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
          requestArchiveFocus(current.id, 'actions');
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
      requestArchiveFocus(current.id, !row ? 'heading' : 'actions');
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
      saveRecovery !== null ||
      uncertainCreate ||
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
        let focusTarget: ArchiveFocusTarget = 'actions';
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
          requestArchiveFocus(row.id, 'actions');
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
          requestArchiveFocus(row.id, 'actions');
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
  // Filters only narrow what is rendered; they never change the stored rows and
  // survive editing, previewing and archiving because none of those paths touch
  // this state.
  function resetFilters() {
    setSearch('');
    setKindFilter('');
    setStateFilter('');
  }
  const visibleRows = rows.filter((row) =>
    matchesTemplateFilters(row, search, kindFilter, stateFilter),
  );
  const templateGroups = templateKindGroups
    .map(([kind, name]) => ({
      key: kind,
      name,
      rows: visibleRows.filter((row) => row.kind === kind),
    }))
    .filter((group) => group.rows.length > 0);
  const otherKindRows = visibleRows.filter(
    (row) => !isKnownTemplateKind(row.kind),
  );
  if (otherKindRows.length > 0)
    templateGroups.push({
      key: 'other',
      name: otherKindGroupName,
      rows: otherKindRows,
    });
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
          disabled={
            busy ||
            archiveReconciliation !== null ||
            saveRecovery !== null ||
            uncertainCreate
          }
          onClick={(event) => begin(null, false, event.currentTarget)}
        >
          Vorlage anlegen
        </button>
      )}
      {editorOpen && (
        <form
          ref={editorFormRef}
          key={`${editorGeneration}:${draft?.id ?? 'new'}:${draft?.version ?? 0}:${editing}`}
          onChange={() => invalidatePreview()}
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
        >
          <p>
            Platzhalter: {placeholders.map((name) => `{{${name}}}`).join(', ')}.
            Unbekannte Platzhalter werden beim Speichern abgewiesen.
          </p>
          <p>
            Die Vorschau verwendet Beispieldaten und neutrales Briefpapier.
            Gespeicherte Geschäftsdaten und Logos werden nicht verwendet.
          </p>
          <fieldset
            disabled={
              busy ||
              archiveReconciliation !== null ||
              saveRecovery !== null ||
              uncertainCreate
            }
          >
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
                  onClick={() => {
                    invalidatePreview();
                    setPositions((current) =>
                      current.filter((_row, at) => at !== index),
                    );
                  }}
                >
                  Position entfernen
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                invalidatePreview();
                setPositions((current) => [...current, emptyPosition()]);
              }}
            >
              Position hinzufügen
            </button>
            <button className="primary-action" disabled={previewBusy}>
              Vorlage speichern
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={
                previewBusy ||
                busy ||
                archiveReconciliation !== null ||
                saveRecovery !== null ||
                uncertainCreate
              }
              onClick={(event) => void preview(event.currentTarget.form!)}
            >
              Inhaltsvorschau erstellen
            </button>
            {previewError && <p role="alert">{previewError}</p>}
            {previewMessage && <p role="status">{previewMessage}</p>}
            {previewUrl && (
              <a
                className="document-download"
                href={previewUrl}
                download="VORSCHAU.pdf"
              >
                Vorschau-PDF herunterladen
              </a>
            )}
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
      {uncertainCreate && editorOpen && (
        <button
          ref={saveRetryButtonRef}
          type="button"
          className="secondary-action"
          disabled={busy}
          onClick={() => {
            const form = editorFormRef.current;
            if (form) void save(form, true);
          }}
        >
          Speicherauftrag wiederholen
        </button>
      )}
      {saveRecovery && (
        <button
          ref={saveReconcileButtonRef}
          type="button"
          className="tertiary-action"
          disabled={busy}
          onClick={() => void reconcileSave()}
        >
          Vorlagen neu laden
        </button>
      )}
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
      {/* The toolbar narrows the loaded list in place. "Vorlage anlegen" stays
          where it was so the section keeps its single primary action. */}
      <div className="resource-toolbar">
        <label>
          Vorlagen suchen
          <input
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Art filtern
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value)}
          >
            <option value="">Alle Dokumentarten</option>
            {templateKindGroups.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
            <option value={otherKindFilterValue}>{otherKindGroupName}</option>
          </select>
        </label>
        <label>
          Zustand filtern
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="">Alle Zustände</option>
            {states.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="document-template-empty">
          Noch keine Dokumentvorlagen vorhanden.
        </p>
      ) : (
        <>
          {visibleRows.length === 0 && (
            <>
              <p>Keine Treffer für die aktuellen Filter.</p>
              <button
                type="button"
                className="tertiary-action"
                onClick={resetFilters}
              >
                Filter zurücksetzen
              </button>
            </>
          )}
          {templateGroups.length > 0 && (
            <div className="document-template-groups">
              {templateGroups.map((group) => (
                <section
                  key={group.key}
                  className="document-template-group"
                  aria-labelledby={`document-template-group-${group.key}`}
                >
                  <h3 id={`document-template-group-${group.key}`}>
                    {group.name}
                  </h3>
                  <ul className="document-template-list">
                    {group.rows.map((row) => (
                      <li
                        ref={(element) => {
                          if (element)
                            actionRowRefs.current.set(row.id, element);
                          else actionRowRefs.current.delete(row.id);
                        }}
                        className="document-template-row"
                        key={row.id}
                        onKeyDown={(event) => {
                          if (
                            event.key !== 'Escape' ||
                            openActionsId !== row.id
                          )
                            return;
                          event.preventDefault();
                          setOpenActionsId(null);
                          const toggle = actionToggleRefs.current.get(row.id);
                          if (
                            toggle?.isConnected &&
                            !toggle.disabled &&
                            !toggle.closest(
                              '[hidden], [inert], [aria-hidden="true"]',
                            )
                          )
                            toggle.focus({ preventScroll: true });
                        }}
                      >
                        <span className="document-template-summary">
                          {kinds.find(([value]) => value === row.kind)?.[1] ??
                            row.kind}
                          : {row.name} – {row.positions.length} Position(en)
                          {row.state === 'archived' ? ' – Archiviert' : ''}
                          {row.state === 'inactive' ? ' – Inaktiv' : ''}
                        </span>
                        <div className="document-template-actions">
                          <button
                            ref={(element) => {
                              if (element)
                                editButtonRefs.current.set(row.id, element);
                              else editButtonRefs.current.delete(row.id);
                            }}
                            className="secondary-action"
                            disabled={
                              busy ||
                              archiveReconciliation !== null ||
                              saveRecovery !== null ||
                              uncertainCreate
                            }
                            aria-label={`Vorlage bearbeiten: ${row.name}`}
                            onClick={(event) => {
                              setOpenActionsId(null);
                              begin(row, false, event.currentTarget);
                            }}
                          >
                            Bearbeiten
                          </button>
                          <button
                            ref={(element) => {
                              if (element)
                                actionToggleRefs.current.set(row.id, element);
                              else actionToggleRefs.current.delete(row.id);
                            }}
                            className="tertiary-action document-template-action-toggle"
                            type="button"
                            disabled={
                              busy ||
                              archiveReconciliation !== null ||
                              saveRecovery !== null ||
                              uncertainCreate
                            }
                            aria-label={`Weitere Aktionen für ${row.name}`}
                            aria-expanded={openActionsId === row.id}
                            aria-controls={`document-template-secondary-actions-${row.id}`}
                            onClick={() =>
                              setOpenActionsId((current) =>
                                current === row.id ? null : row.id,
                              )
                            }
                          >
                            Aktionen
                          </button>
                          <div
                            id={`document-template-secondary-actions-${row.id}`}
                            className="document-template-secondary-actions"
                            role="group"
                            aria-label={`Aktionen für ${row.name}`}
                            hidden={openActionsId !== row.id}
                          >
                            <button
                              className="secondary-action"
                              disabled={
                                busy ||
                                archiveReconciliation !== null ||
                                saveRecovery !== null ||
                                uncertainCreate
                              }
                              aria-label={`Vorlage duplizieren: ${row.name}`}
                              onClick={(event) => {
                                const origin = actionToggleRefs.current.get(
                                  row.id,
                                );
                                if (origin?.isConnected && !origin.disabled)
                                  origin.focus({ preventScroll: true });
                                setOpenActionsId(null);
                                begin(row, true, origin ?? event.currentTarget);
                              }}
                            >
                              Duplizieren
                            </button>
                            <button
                              className="tertiary-action"
                              type="button"
                              disabled={
                                busy ||
                                row.state === 'archived' ||
                                archiveReconciliation !== null ||
                                saveRecovery !== null ||
                                uncertainCreate
                              }
                              aria-label={`Vorlage archivieren: ${row.name}`}
                              onClick={(event) => {
                                const origin = actionToggleRefs.current.get(
                                  row.id,
                                );
                                if (origin?.isConnected && !origin.disabled)
                                  origin.focus({ preventScroll: true });
                                setOpenActionsId(null);
                                void archive(
                                  row,
                                  origin ?? event.currentTarget,
                                );
                              }}
                            >
                              {archivePendingId === row.id
                                ? 'Archivierung läuft …'
                                : 'Archivieren'}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
