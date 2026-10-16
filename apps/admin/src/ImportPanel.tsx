import { ImportOverview, sectionLabels as sections } from './ImportOverview.js';
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
const codes: Record<string, string> = {
  duplicate_review_required:
    'Mögliche Dubletten bewusst zuordnen oder eigenständig anlegen',
  delta_review_required:
    'Geänderte Quelldaten benötigen eine geprüfte Aktualisierung',
  target_conflict:
    'Der Zielstand hat sich geändert. Zuordnung und Version erneut prüfen',
  binding_review_required:
    'Aktualisierung vorhandener Datensätze ausdrücklich erlauben',
  target_already_mapped:
    'Der Zieldatensatz gehört bereits zu einer anderen Quell-ID',
  mapping_conflict:
    'Eine bestehende Quellzuordnung darf nicht umgebunden werden',
  status_review_required:
    'Wechsel zwischen Altzusage und operativem Event fachlich klären',
  promise_binding_unsupported:
    'Altzusagen können hier nicht mit vorhandenen Events verbunden werden',
  database_conflict:
    'Eine Datenbankregel verhindert die Übernahme. Keine Daten übernommen',
  review_closed:
    'Dieser Quellstand wurde bereits geprüft. Änderungen gesondert abgleichen',
  invalid_decision: 'Zuordnungsentscheidung ungültig oder mehrfach angegeben',
  invalid_request: 'Übernahmeanfrage ungültig',
  invalid_reference: 'Eine Verknüpfung im Ziel ist nicht mehr gültig',
  forbidden: 'Die Berechtigung fehlt. Bitte erneut anmelden',

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
type Decision = {
  section: string;
  externalId: string;
  action: 'create' | 'bind';
  targetId?: string;
  version?: number;
};
type Transfer = {
  applied: boolean;
  pendingPromises: number;
  counts: Record<
    string,
    {
      created: number;
      bound: number;
      updated: number;
      unchanged: number;
      excluded: number;
    }
  >;
};
type Conflict = {
  error: string;
  section: string;
  row: number;
  candidates: { id: string; version: number; name?: string }[];
};
export function ImportPanel({
  csrfToken,
  onImported,
}: {
  csrfToken: string;
  onImported?: () => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<Preview | null>(null);
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [dryRunReady, setDryRunReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState(0);
  function resetTransfer() {
    setTransfer(null);
    setConflict(null);
    setDryRunReady(false);
    setConfirmed(false);
  }
  async function run(mode: 'dry_run' | 'apply') {
    setBusy(true);
    setTransfer(null);
    setConflict(null);
    setStatus('Übernahme wird geprüft …');
    setDryRunReady(false);
    setConfirmed(false);
    try {
      const manifest = JSON.parse(input) as Record<
        string,
        { externalId: string; data: { name: string } }[]
      >;
      const response = await fetch('/api/v1/imports/bookitup', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ manifest, mode, allowUpdates, decisions }),
      });
      if (!response.ok) {
        const error = (await response.json()) as Conflict;
        if (error.error === 'duplicate_review_required') {
          const paths: Record<string, string> = {
            contacts: '/contacts',
            locations: '/locations',
            eventTypes: '/master-data/event_type',
            packages: '/master-data/package',
            events: '/events',
          };
          const targets = await fetch('/api/v1' + paths[error.section]);
          if (!targets.ok) throw Error();
          const body = (await targets.json()) as
            | { events?: { id: string; name: string }[] }
            | { id: string; name: string }[];
          const rows = Array.isArray(body) ? body : body.events!;
          setConflict({
            ...error,
            candidates: error.candidates.map((candidate) => ({
              ...candidate,
              name: rows.find((row) => row.id === candidate.id)?.name ?? '',
            })),
          });
        }
        setStatus(
          (codes[error.error] ??
            'Übernahme fehlgeschlagen. Anmeldung und Verbindung prüfen.') +
            (error.section
              ? ` · ${sections[error.section]} · Zeile ${error.row}`
              : ''),
        );
        return;
      }
      const result = (await response.json()) as Transfer;
      if (
        !result.counts ||
        typeof result.applied !== 'boolean' ||
        result.applied !== (mode === 'apply')
      )
        throw Error();
      setTransfer(result);
      setDryRunReady(mode === 'dry_run');
      setStatus(
        result.applied
          ? 'Daten übernommen. Altzusagen benötigen weiterhin Ressourcenprüfung.'
          : 'Transaktionaler Probelauf bestanden. Alle Änderungen wurden zurückgenommen.',
      );
    } catch {
      setStatus(
        'Übernahme fehlgeschlagen. Eingabe, Anmeldung und Verbindung prüfen; vor Wiederholung den Importbestand aktualisieren.',
      );
    } finally {
      setBusy(false);
      if (mode === 'apply') {
        setRevision((value) => value + 1);
        onImported?.();
      }
    }
  }
  function decide(
    action: 'create' | 'bind',
    candidate?: { id: string; version: number },
  ) {
    const manifest = JSON.parse(input) as Record<
      string,
      { externalId: string }[]
    >;
    const externalId =
      manifest[conflict!.section]![conflict!.row - 1]!.externalId;
    setDecisions((current) => [
      ...current.filter(
        (decision) =>
          decision.section !== conflict!.section ||
          decision.externalId !== externalId,
      ),
      {
        section: conflict!.section,
        externalId,
        action,
        ...(candidate
          ? { targetId: candidate.id, version: candidate.version }
          : {}),
      },
    ]);
    resetTransfer();
    setStatus(
      'Zuordnung vorgemerkt. Bei Verknüpfung Aktualisierung erlauben und Probelauf erneut starten.',
    );
  }

  async function preview() {
    resetTransfer();
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
              resetTransfer();
              setDecisions([]);
              setAllowUpdates(false);
              setStatus('');
            }}
          />
        </label>
        <button disabled={busy}>Importvorschau prüfen</button>
      </form>
      <fieldset disabled={busy}>
        <legend>Geprüfte Daten übernehmen</legend>
        <label>
          <input
            type="checkbox"
            checked={allowUpdates}
            onChange={(event) => {
              setAllowUpdates(event.target.checked);
              resetTransfer();
            }}
          />
          Geprüfte Quelldaten dürfen vorhandene Datensätze aktualisieren
          (Versionsschutz bleibt aktiv)
        </label>
        <p>
          {decisions.length} bewusste Dublettenentscheidungen vorgemerkt.
          Eingabeänderungen verwerfen diese Entscheidungen.
        </p>
        <button
          type="button"
          disabled={!report?.valid}
          onClick={() => void run('dry_run')}
        >
          Transaktionalen Probelauf starten
        </button>
        <label>
          <input
            type="checkbox"
            disabled={!dryRunReady}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Mengen, Zuordnungen und Änderungen geprüft; diese Daten jetzt
          übernehmen
        </label>
        <button
          type="button"
          disabled={!dryRunReady || !confirmed}
          onClick={() => void run('apply')}
        >
          Geprüfte Daten übernehmen
        </button>
      </fieldset>
      {conflict && (
        <div role="group" aria-label="Dublettenentscheidung">
          <p>
            {sections[conflict.section]} · Zeile {conflict.row}: Vorhandenen
            Datensatz bewusst verknüpfen und aktualisieren oder eigenständig neu
            anlegen.
          </p>
          {conflict.candidates.map((candidate) => (
            <button
              disabled={busy || !candidate.name}
              key={candidate.id}
              onClick={() => decide('bind', candidate)}
            >
              Verknüpfen:{' '}
              {candidate.name || 'Zieldatensatz nicht mehr vorhanden'} (Version{' '}
              {candidate.version})
            </button>
          ))}
          <button disabled={busy} onClick={() => decide('create')}>
            Bewusst eigenständig anlegen
          </button>
        </div>
      )}
      {transfer && (
        <table aria-label="Ergebnis des Probelaufs oder der Übernahme">
          <thead>
            <tr>
              <th>Abschnitt</th>
              <th>Neu</th>
              <th>Verknüpft</th>
              <th>Aktualisiert</th>
              <th>Unverändert</th>
              <th>Ausgeschlossen</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(transfer.counts).map(([section, count]) => (
              <tr key={section}>
                <th scope="row">{sections[section]}</th>
                <td>{count.created}</td>
                <td>{count.bound}</td>
                <td>{count.updated}</td>
                <td>{count.unchanged}</td>
                <td>{count.excluded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
      <ImportOverview
        revision={revision}
        csrfToken={csrfToken}
        {...(onImported ? { onReconciled: onImported } : {})}
      />
    </section>
  );
}
