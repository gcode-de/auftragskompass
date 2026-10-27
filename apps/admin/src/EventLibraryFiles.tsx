import { useEffect, useRef, useState } from 'react';
import {
  discardForFilesMessage,
  hasUnsavedChanges,
} from './unsaved-changes.js';

type Row = {
  id: string;
  displayName: string;
  mediaType: string;
  sizeBytes: number;
  state: 'available' | 'archived';
  scanState: 'not_scanned';
  uploadedAt: string;
  uploadedDate: string;
  archivedAt: string | null;
};

function validRow(value: unknown): value is Row {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Row>;
  return (
    typeof row.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.id,
    ) &&
    typeof row.displayName === 'string' &&
    !!row.displayName &&
    (row.state === 'available' || row.state === 'archived') &&
    row.scanState === 'not_scanned'
  );
}

export function EventLibraryFiles({
  eventId,
  csrfToken,
  active,
}: {
  eventId: string;
  csrfToken: string;
  active: boolean;
}) {
  const sequence = useRef(0),
    mutating = useRef(false);
  const [linked, setLinked] = useState<Row[]>([]),
    [library, setLibrary] = useState<Row[]>([]),
    [selected, setSelected] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [message, setMessage] = useState('');
  const url = '/api/v1/events/' + eventId + '/library-files';
  async function load() {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const replies = await Promise.all([
        fetch(url),
        fetch('/api/v1/library-files'),
      ]);
      if (replies.some((reply) => !reply.ok)) throw Error('load');
      const [nextLinked, nextLibrary] = (await Promise.all(
        replies.map((reply) => reply.json()),
      )) as [Row[], Row[]];
      if (
        !Array.isArray(nextLinked) ||
        !nextLinked.every(validRow) ||
        !Array.isArray(nextLibrary) ||
        !nextLibrary.every(validRow)
      )
        throw Error('shape');
      if (current !== sequence.current) return;
      setLinked(nextLinked);
      setLibrary(nextLibrary);
      setFailed(false);
    } catch {
      if (current === sequence.current) setFailed(true);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (active) void load();
    return () => {
      ++sequence.current;
    };
  }, [active, eventId]);
  async function change(id: string, link: boolean) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setLoading(false);
    setMessage('');
    ++sequence.current;
    try {
      const reply = await fetch(url + '/' + id, {
        method: link ? 'PUT' : 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!reply.ok) throw Error('write');
      if (link) {
        const row: unknown = await reply.json();
        if (!validRow(row) || row.id !== id) throw Error('shape');
        setLinked((current) => [
          ...current.filter((entry) => entry.id !== row.id),
          row,
        ]);
        setSelected('');
      } else setLinked((current) => current.filter((entry) => entry.id !== id));
      setMessage(link ? 'Datei zugeordnet.' : 'Zuordnung entfernt.');
      await load();
    } catch {
      setMessage(
        'Zuordnung nicht bestätigt. Bitte Liste aktualisieren und erneut prüfen.',
      );
      setFailed(true);
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  const choices = library.filter(
    (row) =>
      row.state === 'available' && !linked.some((entry) => entry.id === row.id),
  );
  return (
    <section aria-label="Eventdateien aus der Bibliothek">
      <h4>Bibliotheksdateien</h4>
      <p>
        Dateien werden nicht auf Schadsoftware geprüft.{' '}
        <a
          href="#files"
          onClick={(event) => {
            if (
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey &&
              event.button === 0 &&
              hasUnsavedChanges() &&
              !window.confirm(discardForFilesMessage)
            )
              event.preventDefault();
          }}
        >
          Dateibibliothek öffnen
        </a>
      </p>
      <label>
        Datei aus der Bibliothek{' '}
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={busy || loading}
        >
          <option value="">Datei auswählen</option>
          {choices.map((row) => (
            <option key={row.id} value={row.id}>
              {row.displayName}
            </option>
          ))}
        </select>
      </label>{' '}
      <button
        type="button"
        className="secondary-action"
        disabled={!selected || busy || loading}
        onClick={() => void change(selected, true)}
      >
        Datei zuordnen
      </button>{' '}
      <button
        type="button"
        className="tertiary-action"
        disabled={loading || busy}
        onClick={() => void load()}
      >
        Dateien aktualisieren
      </button>
      {loading && <p role="status">Dateien werden geladen …</p>}
      {message && <p role="status">{message}</p>}
      {failed && (
        <p role="alert">
          Dateiliste konnte nicht aktualisiert werden. Der letzte Stand bleibt
          sichtbar.
        </p>
      )}
      {!loading && !failed && !linked.length && (
        <p>Keine Bibliotheksdateien zugeordnet.</p>
      )}
      {linked.length > 0 && (
        <ul>
          {linked.map((row) => (
            <li key={row.id}>
              {row.state === 'available' ? (
                <a
                  href={'/api/v1/library-files/' + row.id + '/content'}
                  download
                  aria-label={'Herunterladen: ' + row.displayName}
                >
                  {row.displayName}
                </a>
              ) : (
                row.displayName
              )}
              {' · '}
              {row.state === 'available' ? 'Verfügbar' : 'Archiviert'} ·
              Ungeprüft{' '}
              <button
                type="button"
                className="tertiary-action"
                disabled={busy || loading}
                onClick={() => void change(row.id, false)}
              >
                Zuordnung entfernen: {row.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
