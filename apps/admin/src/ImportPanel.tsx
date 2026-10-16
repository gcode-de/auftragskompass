import { useState } from 'react';
type Issue = { section: string; row: number; code: string };
type Preview = {
  valid: boolean;
  checkedAt: string;
  timeZone: string;
  pendingPromises: number;
  counts: Record<
    string,
    { total: number; accepted: number; excluded: number; invalid: number }
  >;
  errors: Issue[];
  warnings: Issue[];
  events: {
    row: number;
    status: string;
    sourceStatus: string;
    requiresResourceReview: boolean;
  }[];
};
const sections: Record<string, string> = {
  manifest: 'Dateiformat',
  contacts: 'Kontakte',
  locations: 'Locations',
  eventTypes: 'Eventarten',
  packages: 'Pakete',
  events: 'Events',
};
const codes: Record<string, string> = {
  invalid_format: 'Formatversion, Quelle oder Abschnitte ungültig',
  invalid_fields: 'Felder, Status oder Feldgrenzen ungültig',
  duplicate_external_id: 'Quell-ID mehrfach vorhanden',
  missing_reference: 'Verknüpfung fehlt oder ist ungültig',
  inactive_reference: 'Verknüpfter Datensatz ist nicht aktiv',
  duplicate_contact: 'Hauptkontakt zugleich als weiterer Kontakt angegeben',
  invalid_schedule: 'Datum und Uhrzeiten widersprechen sich',
  missing_date: 'Termin fehlt',
  invalid_notes: 'Notizen nach Bereinigung zu lang',
  notes_sanitized: 'Unsichere Inhalte werden aus Notizen entfernt',
  past_event_excluded: 'Vergangenes Event ausgeschlossen',
};
export function ImportPanel({ csrfToken }: { csrfToken: string }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<Preview | null>(null);
  async function preview() {
    setReport(null);
    let payload: unknown;
    try {
      payload = JSON.parse(input);
    } catch {
      setStatus(
        'Ungültiges JSON. Bitte das normalisierte Eingabeformat prüfen.',
      );
      return;
    }
    setBusy(true);
    setStatus('Vorschau wird geprüft …');
    try {
      const response = await fetch('/api/v1/imports/bookitup/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw Error();
      const data = (await response.json()) as Preview;
      if (
        !data.counts ||
        !Array.isArray(data.errors) ||
        !Array.isArray(data.warnings) ||
        !Array.isArray(data.events)
      )
        throw Error();
      setReport(data);
      setStatus(
        data.valid
          ? 'Vorschau geprüft. Es wurden keine Daten übernommen.'
          : 'Vorschau enthält Fehler. Es wurden keine Daten übernommen.',
      );
    } catch {
      setStatus(
        'Vorschau fehlgeschlagen. Anmeldung, Dateigröße und Verbindung prüfen und erneut versuchen.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Bookitup-Importvorschau">
      <h3>Bookitup-Importvorschau</h3>
      <p>
        Nur normalisiertes JSON der Formatversion 1, Quelle bookitup. Maximal 4
        MiB und 10.000 Einträge je Abschnitt. Originalexporte zuerst privat
        aufbereiten.
      </p>
      <p>
        Diese Vorschau speichert keine Daten. Ungeprüfte Bestandszusagen sind
        keine bestätigten Ressourcenzuweisungen; ein unvollständiger Kalender
        weist keine freie Kapazität nach.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void preview();
        }}
      >
        <label>
          Normalisierte Importdaten
          <br />
          <textarea
            rows={8}
            cols={80}
            style={{ maxWidth: '100%' }}
            required
            value={input}
            maxLength={4 * 1024 * 1024}
            disabled={busy}
            onChange={(event) => {
              setInput(event.target.value);
              setReport(null);
              setStatus('');
            }}
          />
        </label>
        <button disabled={busy}>Importvorschau prüfen</button>
      </form>
      <p role="status">{status}</p>
      {report && (
        <>
          <p>
            Prüfzeitpunkt: {report.checkedAt} · Zeitzone: {report.timeZone}
          </p>
          <p>
            Ungeprüfte Bestandszusagen: {report.pendingPromises}. Vor
            Produktivstart ist jede Ressourcenzuordnung fachlich zu prüfen.
          </p>
          <table aria-label="Importmengen">
            <thead>
              <tr>
                <th>Abschnitt</th>
                <th>Gesamt</th>
                <th>Gültig</th>
                <th>Ausgeschlossen</th>
                <th>Fehlerhaft</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.counts).map(([section, count]) => (
                <tr key={section}>
                  <th scope="row">{sections[section]}</th>
                  <td>{count.total}</td>
                  <td>{count.accepted}</td>
                  <td>{count.excluded}</td>
                  <td>{count.invalid}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(
            [
              ['Fehler', report.errors],
              ['Hinweise', report.warnings],
            ] as const
          ).map(([title, issues]) => (
            <div key={title}>
              <h4>{title}</h4>
              {issues.length ? (
                <ul>
                  {issues.map((issue, i) => (
                    <li key={i}>
                      {sections[issue.section]} · Zeile {issue.row}:{' '}
                      {codes[issue.code] ?? issue.code}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Keine {title}.</p>
              )}
            </div>
          ))}
          {report.events.length > 0 && (
            <table aria-label="Statuszuordnung der Events">
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Quellstatus</th>
                  <th>Vorschau</th>
                </tr>
              </thead>
              <tbody>
                {report.events.map((event) => (
                  <tr key={event.row}>
                    <th scope="row">{event.row}</th>
                    <td>{event.sourceStatus}</td>
                    <td>
                      {event.requiresResourceReview
                        ? 'Ungeprüfte Bestandszusage'
                        : event.sourceStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
