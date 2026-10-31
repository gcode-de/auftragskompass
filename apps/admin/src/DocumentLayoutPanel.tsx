import { useEffect, useRef, useState } from 'react';
import { registerUnsavedChanges } from './unsaved-changes.js';

async function resizeLogo(file: File): Promise<Blob> {
  if (file.size <= 512 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, file.type, 0.85),
      );
      if (result && result.type === file.type && result.size <= 512 * 1024)
        return result;
      scale *= 0.7;
    }
    throw new Error('image too large');
  } finally {
    bitmap.close();
  }
}

type LayoutInput = {
  senderName: string;
  senderStreet: string;
  senderPostalCode: string;
  senderCity: string;
  primaryColor: string;
  textColor: string;
  fontFamily: 'system' | 'sans' | 'serif';
  showPageNumbers: boolean;
  showPositionNumbers: boolean;
};
type LayoutRow = LayoutInput & {
  version: number;
  logoKey: string | null;
  logoMediaType: 'image/png' | 'image/jpeg' | null;
};

const emptyLayout: LayoutInput = {
  senderName: '',
  senderStreet: '',
  senderPostalCode: '',
  senderCity: '',
  primaryColor: '#2f6f4f',
  textColor: '#1b1b1b',
  fontFamily: 'system',
  showPageNumbers: true,
  showPositionNumbers: true,
};

function isLayoutRow(value: unknown): value is LayoutRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const hasLogo = row.logoKey !== null,
    logoIsConsistent =
      (row.logoKey === null && row.logoMediaType === null) ||
      (typeof row.logoKey === 'string' &&
        ((row.logoKey.endsWith('.png') && row.logoMediaType === 'image/png') ||
          (row.logoKey.endsWith('.jpg') &&
            row.logoMediaType === 'image/jpeg')));
  return (
    typeof row.senderName === 'string' &&
    row.senderName.trim().length > 0 &&
    row.senderName.length <= 120 &&
    typeof row.senderStreet === 'string' &&
    row.senderStreet.length <= 120 &&
    typeof row.senderPostalCode === 'string' &&
    row.senderPostalCode.length <= 20 &&
    typeof row.senderCity === 'string' &&
    row.senderCity.length <= 80 &&
    typeof row.primaryColor === 'string' &&
    /^#[0-9a-f]{6}$/.test(row.primaryColor) &&
    typeof row.textColor === 'string' &&
    /^#[0-9a-f]{6}$/.test(row.textColor) &&
    (row.fontFamily === 'system' ||
      row.fontFamily === 'sans' ||
      row.fontFamily === 'serif') &&
    typeof row.showPageNumbers === 'boolean' &&
    typeof row.showPositionNumbers === 'boolean' &&
    Number.isSafeInteger(row.version) &&
    Number(row.version) > 0 &&
    (row.logoKey === null || (hasLogo && typeof row.logoKey === 'string')) &&
    (row.logoMediaType === null ||
      row.logoMediaType === 'image/png' ||
      row.logoMediaType === 'image/jpeg') &&
    logoIsConsistent
  );
}

function inputFrom(row: LayoutInput): LayoutInput {
  return {
    senderName: row.senderName,
    senderStreet: row.senderStreet,
    senderPostalCode: row.senderPostalCode,
    senderCity: row.senderCity,
    primaryColor: row.primaryColor,
    textColor: row.textColor,
    fontFamily: row.fontFamily,
    showPageNumbers: row.showPageNumbers,
    showPositionNumbers: row.showPositionNumbers,
  };
}

function fontLabel(fontFamily: LayoutInput['fontFamily']) {
  return fontFamily === 'system'
    ? 'System'
    : fontFamily === 'sans'
      ? 'Serifenlos'
      : 'Serifen';
}

export function DocumentLayoutPanel({
  csrfToken,
  active,
}: {
  csrfToken: string;
  active: boolean;
}) {
  const [row, setRow] = useState<LayoutRow | null>(null),
    [draft, setDraft] = useState<LayoutInput>(emptyLayout),
    [baseline, setBaseline] = useState<LayoutInput>(emptyLayout),
    [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState(false),
    [editing, setEditing] = useState(false),
    [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [previewBusy, setPreviewBusy] = useState(false),
    [previewUrl, setPreviewUrl] = useState(''),
    [logoFormOpen, setLogoFormOpen] = useState(false),
    [logoFile, setLogoFile] = useState<File | null>(null);
  const dirtyRef = useRef(false),
    baselineRef = useRef<LayoutInput>(emptyLayout),
    draftRef = useRef(draft),
    logoToggleRef = useRef<HTMLButtonElement | null>(null),
    setupButtonRef = useRef<HTMLButtonElement | null>(null),
    logoInputRef = useRef<HTMLInputElement | null>(null),
    focusLogoInput = useRef(false),
    restoreLogoFocus = useRef(false),
    focusAfterReload = useRef<'summary' | 'setup' | null>(null),
    previewUrlRef = useRef(''),
    previewSequence = useRef(0),
    logoSequence = useRef(0),
    requestSequence = useRef(0),
    initialLoadStarted = useRef(false);
  draftRef.current = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  dirtyRef.current = dirty || logoFile !== null;

  useEffect(() => registerUnsavedChanges(() => dirtyRef.current), []);
  useEffect(
    () => () => {
      requestSequence.current++;
      previewSequence.current++;
      logoSequence.current++;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!loading && !busy && focusAfterReload.current) {
      const target = focusAfterReload.current;
      focusAfterReload.current = null;
      if (active) {
        if (target === 'summary') logoToggleRef.current?.focus();
        else setupButtonRef.current?.focus();
      }
      return;
    }
    if (!logoFormOpen && !busy && restoreLogoFocus.current) {
      restoreLogoFocus.current = false;
      if (active) logoToggleRef.current?.focus();
      return;
    }
    if (logoFormOpen && !busy && active && focusLogoInput.current) {
      focusLogoInput.current = false;
      logoInputRef.current?.focus();
    }
  }, [active, busy, loading, logoFormOpen]);

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
  }

  async function reload(restoreFocus = false) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(false);
    setError('');
    try {
      const response = await fetch('/api/v1/document-layout');
      if (sequence !== requestSequence.current) return;
      if (response.status === 404) {
        focusAfterReload.current = restoreFocus ? 'setup' : null;
        setRow(null);
        setDraft(emptyLayout);
        draftRef.current = emptyLayout;
        setBaseline(emptyLayout);
        baselineRef.current = emptyLayout;
        setLoaded(true);
        setEditing(false);
        setConflict(false);
        setUncertain(false);
        setLogoFile(null);
        setLogoFormOpen(false);
        clearPreview();
        setMessage('Noch kein Dokumentlayout eingerichtet.');
        return;
      }
      if (!response.ok) throw new Error('load');
      const result: unknown = await response.json();
      if (!isLayoutRow(result)) throw new Error('load');
      if (sequence !== requestSequence.current) return;
      focusAfterReload.current = restoreFocus ? 'summary' : null;
      const next = inputFrom(result);
      setRow(result);
      setDraft(next);
      draftRef.current = next;
      setBaseline(next);
      baselineRef.current = next;
      setLoaded(true);
      setEditing(false);
      setConflict(false);
      setUncertain(false);
      setLogoFile(null);
      setLogoFormOpen(false);
      previewSequence.current++;
      clearPreview();
      setMessage('Dokumentlayout neu geladen.');
    } catch {
      if (sequence === requestSequence.current) {
        setLoadError(true);
        setError(
          'Dokumentlayout konnte nicht geladen werden. Bitte erneut laden.',
        );
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!active || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void reload();
  }, [active]);

  function update(patch: Partial<LayoutInput>) {
    const next = { ...draft, ...patch };
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current =
      JSON.stringify(next) !== JSON.stringify(baselineRef.current);
    setMessage('');
    setError('');
    previewSequence.current++;
    setPreviewBusy(false);
    if (previewUrlRef.current) clearPreview();
  }

  async function save() {
    if (
      !loaded ||
      loadError ||
      busy ||
      loading ||
      previewBusy ||
      conflict ||
      uncertain ||
      !draft.senderName.trim()
    )
      return;
    setBusy(true);
    setMessage('');
    setError('');
    const submitted = { ...draft };
    const expectedSnapshot = {
      ...submitted,
      senderName: submitted.senderName.trim(),
    };
    try {
      const creating = row === null,
        response = await fetch('/api/v1/document-layout', {
          method: creating ? 'POST' : 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            ...submitted,
            ...(!creating ? { version: row.version } : {}),
          }),
        });
      if (!response.ok) {
        if (response.status === 404 && !creating) {
          setConflict(true);
          setError(
            'Das Dokumentlayout ist nicht mehr verfügbar. Deine Eingaben bleiben erhalten. Bitte den Serverstand laden.',
          );
        } else if (response.status === 409) {
          setConflict(true);
          setError(
            'Das Dokumentlayout wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Bitte den Serverstand laden.',
          );
        } else if (response.status >= 500) {
          setUncertain(true);
          setError(
            'Der Speicherstand ist unklar. Deine Eingaben bleiben erhalten. Bitte den Serverstand laden, bevor du weiterarbeitest.',
          );
        } else {
          setError(
            'Dokumentlayout konnte nicht gespeichert werden. Angaben und Berechtigung prüfen.',
          );
        }
        return;
      }
      const result: unknown = await response.json();
      const expectedVersion = creating ? 1 : row.version + 1;
      if (
        !isLayoutRow(result) ||
        result.version !== expectedVersion ||
        JSON.stringify(inputFrom(result)) !== JSON.stringify(expectedSnapshot)
      ) {
        setUncertain(true);
        setError(
          'Die Speicherantwort war unvollständig. Der Speicherstand ist unklar. Deine Eingaben bleiben erhalten. Bitte den Serverstand laden.',
        );
        return;
      }
      const next = inputFrom(result);
      setRow(result);
      setDraft(next);
      draftRef.current = next;
      setBaseline(next);
      baselineRef.current = next;
      dirtyRef.current = false;
      setLoaded(true);
      setEditing(false);
      setConflict(false);
      setUncertain(false);
      previewSequence.current++;
      clearPreview();
      setMessage('Gespeichert.');
    } catch {
      setUncertain(true);
      setError(
        'Der Speicherstand ist unklar. Deine Eingaben bleiben erhalten. Bitte den Serverstand laden, bevor du weiterarbeitest.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (
      !loaded ||
      loadError ||
      busy ||
      loading ||
      conflict ||
      uncertain ||
      previewBusy
    )
      return;
    const sequence = ++previewSequence.current,
      previewInput = { ...draft };
    setPreviewBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/v1/document-layout/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(previewInput),
      });
      if (!response.ok) {
        if (sequence === previewSequence.current)
          setError(
            response.status === 404
              ? 'Das eingerichtete Logo ist derzeit nicht verfügbar. Deine Eingaben bleiben erhalten. Bitte später erneut versuchen.'
              : 'PDF-Vorschau konnte nicht erstellt werden. Deine Eingaben bleiben erhalten.',
          );
        return;
      }
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('application/pdf')
      )
        throw new Error('preview');
      const blob = await response.blob();
      if (!(await blob.slice(0, 5).text()).startsWith('%PDF-'))
        throw new Error('preview');
      if (
        sequence !== previewSequence.current ||
        JSON.stringify(previewInput) !== JSON.stringify(draftRef.current)
      )
        return;
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setMessage('PDF-Vorschau erstellt.');
    } catch {
      if (sequence === previewSequence.current)
        setError(
          'PDF-Vorschau konnte nicht erstellt werden. Deine Eingaben bleiben erhalten.',
        );
    } finally {
      if (sequence === previewSequence.current) setPreviewBusy(false);
    }
  }

  async function uploadLogo() {
    if (
      !loaded ||
      !row ||
      loadError ||
      busy ||
      loading ||
      previewBusy ||
      conflict ||
      uncertain ||
      !logoFile
    )
      return;
    if (logoFile.size > 10 * 1024 * 1024) {
      setError('Die Logodatei darf höchstens 10 MiB groß sein.');
      return;
    }
    if (logoFile.type !== 'image/png' && logoFile.type !== 'image/jpeg') {
      setError('Bitte eine PNG- oder JPEG-Datei auswählen.');
      return;
    }

    const sequence = ++logoSequence.current,
      expectedRow = row,
      selectedFile = logoFile;
    setBusy(true);
    setError('');
    setMessage('');
    previewSequence.current++;
    setPreviewBusy(false);
    clearPreview();
    let upload: Blob;
    try {
      upload = await resizeLogo(selectedFile);
    } catch {
      if (sequence === logoSequence.current) {
        setError(
          'Das Logo konnte nicht verkleinert werden. Bitte eine gültige PNG- oder JPEG-Datei auswählen.',
        );
        setBusy(false);
      }
      return;
    }
    if (sequence !== logoSequence.current) return;
    try {
      const response = await fetch('/api/v1/document-layout/logo', {
        method: 'PUT',
        headers: {
          'content-type': selectedFile.type,
          'x-csrf-token': csrfToken,
        },
        body: upload,
      });
      if (sequence !== logoSequence.current) return;
      if (!response.ok) {
        if (response.status === 404) {
          setUncertain(true);
          setError(
            'Das Dokumentlayout ist nicht mehr verfügbar. Der Uploadstand ist unklar. Deine Dateiauswahl bleibt erhalten. Bitte den Serverstand laden.',
          );
        } else if (response.status >= 500) {
          setUncertain(true);
          setError(
            'Der Uploadstand ist unklar. Deine Dateiauswahl bleibt erhalten. Bitte den Serverstand laden, bevor du weiterarbeitest.',
          );
        } else if (response.status === 401 || response.status === 403) {
          setError(
            response.status === 401
              ? 'Bitte erneut anmelden, um das Logo hochzuladen.'
              : 'Du darfst das Dokumentlayout nicht ändern. Bitte deine Berechtigung prüfen.',
          );
        } else {
          setError(
            response.status === 413
              ? 'Die Logodatei ist zu groß. Bitte eine Datei bis 512 KiB auswählen.'
              : 'Logo konnte nicht hochgeladen werden. Bitte eine gültige PNG- oder JPEG-Datei auswählen.',
          );
        }
        return;
      }

      const result: unknown = await response.json();
      if (sequence !== logoSequence.current) return;
      if (
        !isLayoutRow(result) ||
        result.version !== expectedRow.version + 1 ||
        JSON.stringify(inputFrom(result)) !==
          JSON.stringify(inputFrom(expectedRow)) ||
        result.logoMediaType !== selectedFile.type ||
        result.logoKey === null ||
        result.logoKey === expectedRow.logoKey
      ) {
        setUncertain(true);
        setError(
          'Die Uploadantwort war unvollständig oder verändert. Der Speicherstand ist unklar. Deine Dateiauswahl bleibt erhalten. Bitte den Serverstand laden.',
        );
        return;
      }

      const next = inputFrom(result);
      setRow(result);
      setBaseline(next);
      baselineRef.current = next;
      setDraft(next);
      draftRef.current = next;
      setLogoFile(null);
      restoreLogoFocus.current = true;
      setLogoFormOpen(false);
      setConflict(false);
      setUncertain(false);
      setMessage('Logo gespeichert.');
    } catch {
      if (sequence === logoSequence.current) {
        setUncertain(true);
        setError(
          'Der Uploadstand ist unklar. Deine Dateiauswahl bleibt erhalten. Bitte den Serverstand laden, bevor du weiterarbeitest.',
        );
      }
    } finally {
      if (sequence === logoSequence.current) setBusy(false);
    }
  }

  const blocked = conflict || uncertain,
    canPreview = Boolean(draft.senderName.trim()),
    disabled = busy || loading || blocked || loadError;

  return (
    <section id="document-layout" aria-label="Dokumentlayout">
      <h2>Dokumentlayout</h2>
      <p>
        Absender, Schrift und Druckdarstellung gelten für neu erzeugte
        Dokumente. Bereits finale PDFs bleiben unverändert.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {!active && !loaded ? null : !loaded && loading ? (
        <p role="status">Dokumentlayout wird geladen …</p>
      ) : !loaded && loadError ? (
        <button
          type="button"
          className="secondary-action"
          disabled={loading}
          onClick={() => void reload(true)}
        >
          Dokumentlayout erneut laden
        </button>
      ) : loaded && row && !editing ? (
        <>
          <dl className="document-layout-summary">
            <div>
              <dt>Absender</dt>
              <dd>
                {row.senderName}
                {row.senderStreet && ` · ${row.senderStreet}`}
                {(row.senderPostalCode || row.senderCity) &&
                  ` · ${row.senderPostalCode} ${row.senderCity}`.trim()}
              </dd>
            </div>
            <div>
              <dt>Darstellung</dt>
              <dd>
                {fontLabel(row.fontFamily)} · Seitenzahlen{' '}
                {row.showPageNumbers ? 'an' : 'aus'} · Positionsnummern{' '}
                {row.showPositionNumbers ? 'an' : 'aus'}
              </dd>
            </div>
          </dl>
          {row.logoKey && <p>Ein Logo ist eingerichtet.</p>}
          {logoFormOpen && (
            <form
              className="document-layout-logo-form"
              onSubmit={(event) => {
                event.preventDefault();
                void uploadLogo();
              }}
            >
              <label>
                Logodatei
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-describedby="document-layout-logo-help"
                  ref={logoInputRef}
                  disabled={disabled || previewBusy}
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    setLogoFile(next);
                    setError('');
                    setMessage('');
                  }}
                />
              </label>
              <p id="document-layout-logo-help">
                PNG oder JPEG, höchstens 10 MiB. Große Dateien werden
                automatisch verkleinert.
              </p>
              {logoFile && <p>{logoFile.name}</p>}
              {busy && <p role="status">Logo wird hochgeladen …</p>}
              <div className="document-layout-actions">
                <button
                  type="submit"
                  className="primary-action"
                  disabled={disabled || previewBusy || logoFile === null}
                >
                  Logo hochladen
                </button>
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={busy || loading || blocked}
                  onClick={() => {
                    restoreLogoFocus.current = true;
                    setLogoFile(null);
                    setLogoFormOpen(false);
                    dirtyRef.current = dirty;
                    setError('');
                    setMessage('');
                  }}
                >
                  Auswahl verwerfen
                </button>
              </div>
            </form>
          )}
          {!logoFormOpen && (
            <div className="document-layout-actions">
              <button
                type="button"
                className="secondary-action"
                disabled={disabled || logoFormOpen}
                onClick={() => {
                  setEditing(true);
                  setMessage('');
                }}
              >
                Dokumentlayout bearbeiten
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={
                  disabled || previewBusy || !canPreview || logoFormOpen
                }
                onClick={() => void preview()}
              >
                Vorschau erstellen
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={disabled || previewBusy || logoFormOpen}
                ref={logoToggleRef}
                onClick={() => {
                  focusLogoInput.current = true;
                  setLogoFormOpen(true);
                  setError('');
                  setMessage('');
                }}
              >
                {row.logoKey ? 'Logo ersetzen' : 'Logo hinzufügen'}
              </button>
            </div>
          )}
          {(blocked || loadError) && (
            <button
              type="button"
              className="tertiary-action"
              disabled={loading || busy}
              onClick={() => void reload(true)}
            >
              {logoFile
                ? 'Logoauswahl verwerfen und neu laden'
                : loadError
                  ? 'Dokumentlayout erneut laden'
                  : dirty
                    ? 'Änderungen verwerfen und neu laden'
                    : 'Dokumentlayout neu laden'}
            </button>
          )}
        </>
      ) : loaded && !row && !editing ? (
        <div className="document-layout-setup">
          <p>
            Noch kein Dokumentlayout eingerichtet. Die gezeigten neutralen
            Startwerte werden erst nach dem Speichern für neue Dokumente
            verwendet.
          </p>
          <button
            type="button"
            className="primary-action"
            ref={setupButtonRef}
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              setMessage('');
            }}
          >
            Dokumentlayout einrichten
          </button>
        </div>
      ) : loaded ? (
        <>
          {!row && (
            <p>Ergänze die Absenderangaben und speichere das Layout bewusst.</p>
          )}
          <form
            className="document-layout-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={disabled}>
              <legend>Absender</legend>
              <div className="document-layout-fields">
                <label>
                  Absendername
                  <input
                    maxLength={120}
                    required
                    value={draft.senderName}
                    onChange={(event) =>
                      update({ senderName: event.target.value })
                    }
                  />
                </label>
                <label>
                  Straße
                  <input
                    maxLength={120}
                    value={draft.senderStreet}
                    onChange={(event) =>
                      update({ senderStreet: event.target.value })
                    }
                  />
                </label>
                <label>
                  Postleitzahl
                  <input
                    maxLength={20}
                    value={draft.senderPostalCode}
                    onChange={(event) =>
                      update({ senderPostalCode: event.target.value })
                    }
                  />
                </label>
                <label>
                  Ort
                  <input
                    maxLength={80}
                    value={draft.senderCity}
                    onChange={(event) =>
                      update({ senderCity: event.target.value })
                    }
                  />
                </label>
              </div>
            </fieldset>
            <details className="document-layout-display">
              <summary>Darstellung</summary>
              <fieldset disabled={disabled}>
                <div className="document-layout-fields">
                  <label>
                    Primärfarbe
                    <input
                      type="color"
                      value={draft.primaryColor}
                      onChange={(event) =>
                        update({ primaryColor: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Textfarbe
                    <input
                      type="color"
                      value={draft.textColor}
                      onChange={(event) =>
                        update({ textColor: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Schrift
                    <select
                      value={draft.fontFamily}
                      onChange={(event) =>
                        update({
                          fontFamily: event.target
                            .value as LayoutInput['fontFamily'],
                        })
                      }
                    >
                      <option value="system">System</option>
                      <option value="sans">Serifenlos</option>
                      <option value="serif">Serifen</option>
                    </select>
                  </label>
                  <label className="document-layout-check">
                    <input
                      type="checkbox"
                      checked={draft.showPageNumbers}
                      onChange={(event) =>
                        update({ showPageNumbers: event.target.checked })
                      }
                    />
                    Seitennummern anzeigen
                  </label>
                  <label className="document-layout-check">
                    <input
                      type="checkbox"
                      checked={draft.showPositionNumbers}
                      onChange={(event) =>
                        update({ showPositionNumbers: event.target.checked })
                      }
                    />
                    Positionsnummern anzeigen
                  </label>
                </div>
              </fieldset>
            </details>
            <div className="document-layout-actions">
              <button
                type="submit"
                className="primary-action"
                disabled={disabled || previewBusy || !draft.senderName.trim()}
              >
                Dokumentlayout speichern
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={disabled || previewBusy || !canPreview}
                onClick={() => void preview()}
              >
                Vorschau erstellen
              </button>
            </div>
          </form>
          {row && editing && (
            <button
              type="button"
              className="tertiary-action"
              disabled={busy || loading || blocked || loadError}
              onClick={() => {
                setDraft(baselineRef.current);
                draftRef.current = baselineRef.current;
                dirtyRef.current = false;
                previewSequence.current++;
                setPreviewBusy(false);
                setEditing(false);
                setError('');
                setMessage('Änderungen verworfen.');
                clearPreview();
              }}
            >
              Bearbeitung abbrechen
            </button>
          )}
          {blocked && (
            <button
              type="button"
              className="tertiary-action"
              disabled={loading || busy}
              onClick={() => void reload(true)}
            >
              {dirty
                ? 'Änderungen verwerfen und neu laden'
                : 'Dokumentlayout neu laden'}
            </button>
          )}
          {loadError && (
            <button
              type="button"
              className="tertiary-action"
              disabled={loading || busy}
              onClick={() => void reload(true)}
            >
              Dokumentlayout erneut laden
            </button>
          )}
        </>
      ) : null}
      {loaded && previewBusy && (
        <p role="status">PDF-Vorschau wird erstellt …</p>
      )}
      {loaded && previewUrl && (
        <p className="document-layout-preview-links">
          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
            Vorschau öffnen
          </a>
          <a href={previewUrl} download="dokumentlayout-vorschau.pdf">
            Vorschau-PDF herunterladen
          </a>
        </p>
      )}
    </section>
  );
}
