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

type DraftValues = {
  subject: string;
  introText: string;
  outroText: string;
  validityDays: string;
};
type DraftLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
};
type DraftDetail = {
  id: string;
  templateId: string;
  state: string;
  version: number;
  subject: string | null;
  introText: string | null;
  outroText: string | null;
  validityDays: number | null;
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
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onVersionChange: (version: number) => void;
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
    typeof detail.templateId === 'string' &&
    detail.state === 'draft' &&
    Number.isInteger(detail.version) &&
    Number.isSafeInteger(detail.grossMinor) &&
    detail.grossMinor! >= 0 &&
    Array.isArray(detail.lines) &&
    detail.lines.every(
      (line) =>
        line &&
        typeof line.id === 'string' &&
        typeof line.description === 'string' &&
        typeof line.unit === 'string' &&
        Number.isFinite(line.quantity) &&
        Number.isSafeInteger(line.unitPriceMinor) &&
        line.unitPriceMinor >= 0,
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

export function OfferDraftEditor({
  documentId,
  csrfToken,
  onClose,
  onDirtyChange,
  onBusyChange,
  onVersionChange,
}: Props) {
  const [values, setValues] = useState<DraftValues | null>(null),
    [baseline, setBaseline] = useState<DraftValues | null>(null),
    [detail, setDetail] = useState<DraftDetail | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [legacy, setLegacy] = useState(false),
    [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [focusInitialEditor, setFocusInitialEditor] = useState(false),
    request = useRef(0),
    busyRef = useRef(false),
    dirtyRef = useRef(false),
    subjectInput = useRef<HTMLInputElement | null>(null),
    callbacks = useRef({ onDirtyChange, onBusyChange, onVersionChange });
  callbacks.current = { onDirtyChange, onBusyChange, onVersionChange };

  const dirty = Boolean(
    values && baseline && JSON.stringify(values) !== JSON.stringify(baseline),
  );
  dirtyRef.current = dirty;
  const needsSave = dirty || legacy;
  const days = Number(values?.validityDays),
    validDays = Number.isInteger(days) && days >= 1 && days <= 365,
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
        setDetail(loaded);
        setValues(formValues);
        setBaseline(formValues);
        setLegacy(fromLegacy);
        setConflict(false);
        setUncertain(false);
        callbacks.current.onDirtyChange(fromLegacy);
        callbacks.current.onVersionChange(loaded.version);
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
    callbacks.current.onDirtyChange(needsSave);
  }, [needsSave]);
  useEffect(() => {
    if (!focusInitialEditor || !values) return;
    subjectInput.current?.scrollIntoView?.({ block: 'start' });
    subjectInput.current?.focus();
    setFocusInitialEditor(false);
  }, [focusInitialEditor, values]);
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
      isBlocked
    )
      return;
    busyRef.current = true;
    setBusy(true);
    callbacks.current.onBusyChange(true);
    setMessage('');
    setError(false);
    try {
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
      setDetail(saved);
      setValues(savedValues);
      setBaseline(savedValues);
      setLegacy(false);
      setConflict(false);
      setUncertain(false);
      callbacks.current.onVersionChange(saved.version);
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
              <p>
                Positionsbearbeitung folgt separat. Die gespeicherten Positionen
                und Summen bleiben unverändert.
              </p>
              {detail.lines.length ? (
                <ul>
                  {detail.lines.map((line) => (
                    <li key={line.id}>
                      <span>{line.description}</span>
                      <span>
                        {line.quantity} {line.unit} · Einzelpreis (Brutto){' '}
                        {exactMinorUnits(line.unitPriceMinor) ?? '—'} €
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Keine gespeicherten Positionen.</p>
              )}
              <p className="offer-draft-total">
                Gesamtbetrag: {exactMinorUnits(detail.grossMinor) ?? '—'} €
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
                  busy ||
                  loading ||
                  isBlocked
                }
              >
                {busy ? 'Wird gespeichert …' : 'Änderungen speichern'}
              </button>
              {dirty || legacy || busy || loading ? (
                <>
                  <button type="button" className="secondary-action" disabled>
                    Vorschau öffnen
                  </button>
                  <span className="document-hint">
                    {loading
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
