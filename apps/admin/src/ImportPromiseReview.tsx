import { emptyEventFilters, updateUrlSearch } from './url-state.js';
import { useEffect, useState } from 'react';
import { ResourceAssignments } from './ResourceAssignments.js';
import type { EventRow } from './EventPanel.js';
type Detail = {
  event: EventRow;
  reviewAction: string | null;
  reviewedEventId: string | null;
  canExcludePast: boolean;
};
export function ImportPromiseReview({
  id,
  csrfToken,
  onReviewed,
  onClose,
}: {
  id: string;
  csrfToken: string;
  onReviewed: () => Promise<void>;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [exclude, setExclude] = useState(false),
    [revision, setRevision] = useState(0);
  const path = '/api/v1/imports/bookitup/promises/' + id;
  useEffect(() => {
    let active = true;
    setDetail(null);
    setMessage('Bestandszusage wird geladen …');
    setExclude(false);
    void fetch(path)
      .then(async (response) => {
        if (!response.ok) throw Error();
        const data = (await response.json()) as Detail;
        if (!data.event || typeof data.canExcludePast !== 'boolean')
          throw Error();
        if (active) {
          setDetail(data);
          setMessage('');
        }
      })
      .catch(() => {
        if (active)
          setMessage(
            'Bestandszusage konnte nicht geladen werden. Bitte erneut aktualisieren.',
          );
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  async function excludePast() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(path + '/exclude-past', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ version: detail!.event.version }),
      });
      if (!response.ok) throw Error();
      await onReviewed();
      setRevision((value) => value + 1);
    } catch {
      setMessage(
        'Ausschluss fehlgeschlagen. Aktuellen Stand vor einem erneuten Versuch aktualisieren.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Bestandszusage prüfen">
      <h4>Bestandszusage prüfen{detail ? ': ' + detail.event.name : ''}</h4>
      <button className="tertiary-action" disabled={busy} onClick={onClose}>
        Prüfung schließen
      </button>
      <button
        className="tertiary-action"
        disabled={busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        Bestandszusage aktualisieren
      </button>
      <p role="status">{message}</p>
      {detail &&
        (detail.reviewAction ? (
          <p>
            Diese Bestandszusage wurde bereits geprüft.{' '}
            {detail.reviewedEventId ? (
              <a
                href={'#event-' + detail.reviewedEventId}
                onClick={async (event) => {
                  event.preventDefault();
                  const target = detail.reviewedEventId!;
                  updateUrlSearch(emptyEventFilters);
                  await onReviewed();
                  window.location.hash = 'event-' + target;
                }}
              >
                Geprüften Auftrag öffnen
              </a>
            ) : (
              'Nach Zeitablauf aus dem operativen Bestand ausgeschlossen.'
            )}
          </p>
        ) : (
          <>
            <p>
              Box, Zubehör, Status und vollständige Dispositionszeiträume mit
              dem Originalauftrag abgleichen. Es wird keine Ressource
              automatisch ausgewählt. Eine erfolgreiche Bestätigung legt den
              operativen Auftrag und seine Reservierungen gemeinsam an.
            </p>
            <ResourceAssignments
              key={detail.event.version}
              event={detail.event}
              csrfToken={csrfToken}
              importReview
              onChanged={onReviewed}
            />
            {detail.canExcludePast && (
              <fieldset disabled={busy}>
                <legend>Inzwischen vergangene Zusage</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={exclude}
                    onChange={(event) => setExclude(event.target.checked)}
                  />
                  Termin und Originalauftrag geprüft: nicht mehr operativ
                  übernehmen
                </label>
                <button
                  className="secondary-action"
                  disabled={!exclude}
                  onClick={() => void excludePast()}
                >
                  Vergangene Zusage mit Nachweis ausschließen
                </button>
              </fieldset>
            )}
          </>
        ))}
    </section>
  );
}
