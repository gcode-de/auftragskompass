import { ImportPromiseReview } from './ImportPromiseReview.js';
import { useEffect, useState } from 'react';
export const sectionLabels: Record<string, string> = {
  contacts: 'Kontakte',
  locations: 'Locations',
  eventTypes: 'Eventarten',
  packages: 'Pakete',
  events: 'Events',
  manifest: 'Dateiformat',
};
type Overview = {
  checkedAt: string;
  counts: Record<string, number>;
  pendingPromises: number;
  mappings: {
    section: string;
    externalId: string;
    targetId: string;
    name: string;
    sourceStatus: string;
    targetVersion: number;
    currentVersion: number;
    locallyChanged: boolean;
    pendingResourceReview: boolean;
    reviewAction: string | null;
  }[];
  promises: {
    id: string;
    version: number;
    externalId: string | null;
    name: string;
    eventDate: string | null;
    startsAt: string | null;
    endsAt: string | null;
    timeZone: string;
    contact: string | null;
    location: string | null;
    package: string | null;
    description: string;
    notesHtml: string;
  }[];
};
function localTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}
export function ImportOverview({
  revision,
  csrfToken,
  onReconciled,
}: {
  revision: number;
  csrfToken?: string;
  onReconciled?: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setOverview(null);
    setMessage('Importbestand wird geladen …');
    void fetch('/api/v1/imports/bookitup')
      .then(async (response) => {
        if (!response.ok) throw Error();
        const data = (await response.json()) as Overview;
        if (
          !Array.isArray(data.mappings) ||
          !Array.isArray(data.promises) ||
          !data.counts
        )
          throw Error();
        if (active) {
          setOverview(data);
          setMessage('');
        }
      })
      .catch(() => {
        if (active)
          setMessage(
            'Importbestand konnte nicht geladen werden. Bitte erneut aktualisieren.',
          );
      });
    return () => {
      active = false;
    };
  }, [revision, refresh]);
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(overview, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'auftragskompass-importbericht.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      id="import-review"
      aria-label="Importbestand und Ressourcen-Prüfliste"
    >
      <h3>Importbestand und Ressourcen-Prüfliste</h3>
      <button
        className="tertiary-action"
        onClick={() => setRefresh((value) => value + 1)}
      >
        Importbestand aktualisieren
      </button>
      <p role="status">{message}</p>
      {overview && (
        <>
          <p>
            Stand: {overview.checkedAt} · Ungeprüfte Bestandszusagen:{' '}
            {overview.pendingPromises}
          </p>
          <p>
            Vor Produktivstart müssen alle zugesagten Boxen und Zubehörteile
            abgeglichen sein. Diese Liste bestätigt keine Ressourcen.
          </p>
          <button className="secondary-action" onClick={download}>
            Privaten Prüfbericht herunterladen
          </button>
          <p>
            Der Bericht enthält personenbezogene Daten. Im privaten
            Sicherungsbestand aufbewahren.
          </p>
          <ul>
            {Object.entries(overview.counts).map(([section, count]) => (
              <li key={section}>
                {sectionLabels[section]}: {count} zugeordnete Quell-IDs
              </li>
            ))}
          </ul>
          <h4>Ungeprüfte Bestandszusagen</h4>
          {!overview.promises.length && (
            <p>
              Keine ungeprüften Bestandszusagen vorhanden. Die fachliche
              Gesamtfreigabe bleibt separat erforderlich.
            </p>
          )}
          <ul>
            {overview.promises.map((promise) => (
              <li key={promise.id}>
                <strong>{promise.name}</strong> ·{' '}
                {promise.eventDate ?? 'Termin offen'} · Box und Zubehör noch
                prüfen
                <p>
                  Quelle: Bookitup · Quell-ID:{' '}
                  {promise.externalId ?? 'Zuordnung fehlt'} · Gebucht · Version{' '}
                  {promise.version}
                </p>
                <p>
                  {promise.startsAt && promise.endsAt
                    ? `${localTime(promise.startsAt, promise.timeZone)} – ${localTime(promise.endsAt, promise.timeZone)}`
                    : 'Uhrzeit offen'}{' '}
                  · Zeitzone: {promise.timeZone}
                </p>
                <p>
                  {promise.contact ?? 'Kontakt offen'} ·{' '}
                  {promise.location ?? 'Ort offen'} ·{' '}
                  {promise.package ?? 'Paket offen'}
                </p>
                {csrfToken && (
                  <button onClick={() => setSelected(promise.id)}>
                    Ressourcen prüfen: {promise.name}
                  </button>
                )}
                {promise.description && <p>{promise.description}</p>}
                {promise.notesHtml && (
                  <details>
                    <summary>Notizen aus Quelle</summary>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>
                      {promise.notesHtml}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {selected && csrfToken && (
            <ImportPromiseReview
              key={selected}
              id={selected}
              csrfToken={csrfToken}
              onClose={() => setSelected(null)}
              onReviewed={async () => {
                setSelected(null);
                setRefresh((value) => value + 1);
                onReconciled?.();
              }}
            />
          )}
          <h4>Übernahmeherkunft</h4>
          {!overview.mappings.length ? (
            <p>Noch keine Daten übernommen.</p>
          ) : (
            <table aria-label="Übernahmeherkunft">
              <thead>
                <tr>
                  <th>Abschnitt</th>
                  <th>Name</th>
                  <th>Quelle / Quell-ID</th>
                  <th>Quellstatus</th>
                  <th>Zielstand</th>
                </tr>
              </thead>
              <tbody>
                {overview.mappings.map((row) => (
                  <tr key={JSON.stringify([row.section, row.externalId])}>
                    <td>{sectionLabels[row.section]}</td>
                    <th scope="row">{row.name}</th>
                    <td>Bookitup · {row.externalId}</td>
                    <td>{row.sourceStatus || '–'}</td>
                    <td>
                      {row.reviewAction === 'excluded_past'
                        ? 'Nach Zeitablauf ausgeschlossen · '
                        : row.pendingResourceReview
                          ? 'Ressourcenprüfung offen · '
                          : ''}
                      {row.locallyChanged
                        ? 'Lokal geändert'
                        : 'Unverändert seit Übernahme'}{' '}
                      · Version {row.currentVersion} (übernommen:{' '}
                      {row.targetVersion})
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
