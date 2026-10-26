import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';

// BKP020.1: the file library is its own named region beside the document
// index. It lists uploaded files only and makes the missing malware scan
// explicit instead of implying a check that does not exist.
const maxBytes = 10 * 1024 * 1024,
  mediaTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/zip',
  ] as const;
type MediaType = (typeof mediaTypes)[number];
type Row = {
  id: string;
  displayName: string;
  mediaType: MediaType;
  sizeBytes: number;
  state: 'available' | 'archived';
  scanState: 'not_scanned';
  uploadedAt: string;
  uploadedDate: string;
  archivedAt: string | null;
};
const typeLabels: Record<MediaType, string> = {
    'application/pdf': 'PDF',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'application/zip': 'ZIP',
  },
  extensionTypes: Record<string, MediaType> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    zip: 'application/zip',
  },
  datePattern = /^\d{4}-\d{2}-\d{2}$/,
  uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function knownMediaType(value: unknown): value is MediaType {
  return (
    typeof value === 'string' &&
    (mediaTypes as readonly string[]).includes(value)
  );
}

function validRow(entry: unknown): Row | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Partial<Row>;
  if (
    typeof row.id !== 'string' ||
    !uuidPattern.test(row.id) ||
    typeof row.displayName !== 'string' ||
    !row.displayName ||
    !knownMediaType(row.mediaType) ||
    typeof row.sizeBytes !== 'number' ||
    !Number.isSafeInteger(row.sizeBytes) ||
    row.sizeBytes < 1 ||
    row.sizeBytes > maxBytes ||
    (row.state !== 'available' && row.state !== 'archived') ||
    row.scanState !== 'not_scanned' ||
    typeof row.uploadedDate !== 'string' ||
    !datePattern.test(row.uploadedDate) ||
    typeof row.uploadedAt !== 'string' ||
    !(row.archivedAt === null || typeof row.archivedAt === 'string')
  )
    return null;
  return row as Row;
}

function validRows(reply: unknown): Row[] | null {
  if (!Array.isArray(reply)) return null;
  const rows: Row[] = [];
  for (const entry of reply) {
    const row = validRow(entry);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

function mediaTypeOf(file: File): MediaType | null {
  if (knownMediaType(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return extensionTypes[extension] ?? null;
}

function fileSizeText(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024)
    return (bytes / 1024).toFixed(1).replace('.', ',') + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

function dateText(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '',
        marker = result.indexOf(',');
      if (marker < 0) reject(new Error('read_failed'));
      else resolve(result.slice(marker + 1));
    };
    reader.readAsDataURL(file);
  });
}

const loadFailure =
  'Dateibibliothek konnte nicht geladen werden. Angezeigt ist der letzte Stand.';

export function LibraryFiles({
  csrfToken,
  active = true,
}: {
  csrfToken: string;
  active?: boolean;
}) {
  const sequence = useRef(0),
    input = useRef<HTMLInputElement>(null),
    [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [pending, setPending] = useState<File | null>(null),
    [uploading, setUploading] = useState(false),
    [archiving, setArchiving] = useState<string | null>(null),
    [confirming, setConfirming] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  async function load() {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const reply = await fetch('/api/v1/library-files');
      if (!reply.ok) throw Error('load');
      const parsed = validRows(await reply.json());
      if (!parsed) throw Error('shape');
      if (current !== sequence.current) return;
      setRows(parsed);
      setFailed(false);
    } catch {
      // Last good rows stay visible; only the honest failure is added.
      if (current === sequence.current) setFailed(true);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (active) void load();
    // Hidden sections never fetch; coming back re-reads the list.
  }, [active]);
  useEffect(() => {
    return () => {
      ++sequence.current;
    };
  }, []);
  function choose(event: ChangeEvent<HTMLInputElement>) {
    setError('');
    setNotice('');
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setPending(null);
      return;
    }
    // The server checks the signature again; this only spares a pointless trip.
    if (file.size > maxBytes) {
      setPending(null);
      setError(
        'Die Datei ist größer als 10 MiB. Bitte eine kleinere Datei wählen.',
      );
      return;
    }
    if (!mediaTypeOf(file)) {
      setPending(null);
      setError('Nur PDF-, PNG-, JPEG- oder ZIP-Dateien sind erlaubt.');
      return;
    }
    setPending(file);
  }
  async function uploadError(reply: Response): Promise<string> {
    if (reply.status === 413)
      return 'Die Datei ist größer als 10 MiB. Bitte eine kleinere Datei wählen.';
    if (reply.status === 415)
      return 'Der Dateiinhalt passt nicht zum Dateityp. Bitte die Datei prüfen.';
    if (reply.status === 400) {
      const body = (await reply.json().catch(() => null)) as {
        error?: string;
      } | null;
      return body?.error === 'invalid_name'
        ? 'Der Dateiname ist ungültig. Bitte einen Namen mit 1 bis 200 Zeichen ohne Steuerzeichen wählen.'
        : 'Die Datei konnte nicht gelesen werden. Bitte erneut wählen.';
    }
    if (reply.status === 401 || reply.status === 403)
      return 'Die Anmeldung ist abgelaufen oder es fehlt die Berechtigung.';
    return 'Der Uploadstand ist unklar. Bitte die Liste neu laden, bevor du es erneut versuchst.';
  }
  async function uploadSelected(event: FormEvent) {
    event.preventDefault();
    if (!pending || uploading) return;
    const file = pending,
      mediaType = mediaTypeOf(file);
    if (!mediaType) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const contentBase64 = await readFileBase64(file),
        reply = await fetch('/api/v1/library-files', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            displayName: file.name,
            mediaType,
            contentBase64,
            requestId: crypto.randomUUID(),
          }),
        });
      if (reply.status !== 201) {
        setError(await uploadError(reply));
        return;
      }
      const row = validRow(await reply.json());
      if (!row) throw Error('shape');
      setRows((current) => [row, ...current]);
      setPending(null);
      if (input.current) input.current.value = '';
      setNotice(file.name + ' wurde hochgeladen. Die Datei ist ungeprüft.');
    } catch {
      setError(
        'Der Uploadstand ist unklar. Bitte die Liste neu laden, bevor du es erneut versuchst.',
      );
    } finally {
      setUploading(false);
    }
  }
  async function archive(row: Row) {
    setArchiving(row.id);
    setError('');
    setNotice('');
    try {
      const reply = await fetch(
        '/api/v1/library-files/' + row.id + '/archive',
        { method: 'POST', headers: { 'x-csrf-token': csrfToken } },
      );
      if (!reply.ok) {
        setError(
          reply.status >= 500
            ? 'Der Archivstand ist unklar. Bitte die Liste neu laden.'
            : 'Die Datei konnte nicht archiviert werden.',
        );
        return;
      }
      const updated = validRow(await reply.json());
      if (!updated) throw Error('shape');
      setRows((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setConfirming(null);
      setNotice(row.displayName + ' wurde archiviert.');
    } catch {
      setError('Der Archivstand ist unklar. Bitte die Liste neu laden.');
    } finally {
      setArchiving(null);
    }
  }
  return (
    <section
      id="library-files"
      className="library-files"
      aria-label="Dateibibliothek"
    >
      <h2>Dateibibliothek</h2>
      <p className="library-files-hint">
        Hochgeladene Dateien werden nicht auf Schadsoftware geprüft; es ist kein
        Virenscan eingerichtet. Lade nur Dateien aus einer vertrauenswürdigen
        Quelle hoch.
      </p>
      <form className="library-files-upload" onSubmit={uploadSelected}>
        <label>
          Datei auswählen
          <input
            ref={input}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.zip,application/pdf,image/png,image/jpeg,application/zip"
            onChange={choose}
            disabled={uploading}
          />
        </label>
        <button
          type="submit"
          className="primary-action"
          disabled={!pending || uploading}
        >
          {uploading ? 'Wird hochgeladen …' : 'Hochladen'}
        </button>
        <button
          type="button"
          className="tertiary-action"
          onClick={() => void load()}
          disabled={loading || uploading}
        >
          Liste aktualisieren
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="library-files-error">
          {error}
        </p>
      )}
      {failed && (
        <div className="reload-warning">
          <p role="alert">{loadFailure}</p>
          <button
            type="button"
            className="tertiary-action"
            onClick={() => void load()}
          >
            Dateien erneut laden
          </button>
        </div>
      )}
      {loading && !rows.length ? (
        <p role="status">Dateibibliothek wird geladen …</p>
      ) : rows.length ? (
        <div
          className="files-table-shell"
          role="group"
          aria-label="Dateibibliothek-Tabelle"
          tabIndex={0}
        >
          <table className="files-table">
            <caption className="sr-only">
              Hochgeladene Dateien mit Typ, Größe, Datum, Status und Aktionen
            </caption>
            <thead>
              <tr>
                <th scope="col">Datei</th>
                <th scope="col">Typ</th>
                <th scope="col">Größe</th>
                <th scope="col">Hochgeladen</th>
                <th scope="col">Status</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} id={'library-file-' + row.id}>
                  <th scope="row">{row.displayName}</th>
                  <td>{typeLabels[row.mediaType]}</td>
                  <td className="numeric">{fileSizeText(row.sizeBytes)}</td>
                  <td>
                    <time dateTime={row.uploadedDate}>
                      {dateText(row.uploadedDate)}
                    </time>
                  </td>
                  <td>
                    <span>
                      {row.state === 'available' ? 'Verfügbar' : 'Archiviert'}
                    </span>
                    {' · '}
                    <span className="muted">Unverprüft</span>
                  </td>
                  <td>
                    <div className="library-files-actions">
                      {row.state === 'available' && (
                        <a
                          href={'/api/v1/library-files/' + row.id + '/content'}
                          aria-label={'Herunterladen: ' + row.displayName}
                          download
                        >
                          Herunterladen
                        </a>
                      )}
                      {row.state === 'available' &&
                        (confirming === row.id ? (
                          <div
                            role="group"
                            aria-label={
                              'Datei ' + row.displayName + ' archivieren?'
                            }
                          >
                            <button
                              type="button"
                              className="secondary-action"
                              disabled={archiving === row.id}
                              onClick={() => void archive(row)}
                            >
                              Archivieren bestätigen
                            </button>
                            <button
                              type="button"
                              className="tertiary-action"
                              onClick={() => setConfirming(null)}
                            >
                              Abbrechen
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="secondary-action"
                            aria-label={'Archivieren: ' + row.displayName}
                            onClick={() => setConfirming(row.id)}
                          >
                            Archivieren
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !failed ? (
        <p>Noch keine Dateien hochgeladen.</p>
      ) : null}
    </section>
  );
}
