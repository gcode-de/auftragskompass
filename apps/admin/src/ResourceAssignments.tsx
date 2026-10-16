import { useEffect, useRef, useState } from 'react';
import type { EventRow } from './EventPanel.js';
import { fromInstant, toInstant } from './event-time.js';
type Unit = {
  unitId: string;
  resourceId: string;
  name: string;
  code: string;
  category: string;
  ordinal: number;
  selected: boolean;
  periodSource: string;
  baseStart: string | null;
  baseEnd: string | null;
  beforeDays: number;
  afterDays: number;
  startsAt: string | null;
  endsAt: string | null;
  available: boolean;
  reason: string | null;
  conflicts: {
    id: string;
    eventId: string | null;
    state: string;
    startsAt: string;
    endsAt: string;
  }[];
};
const statuses = [
  ['inquiry', 'Anfrage'],
  ['option', 'Option'],
  ['booked', 'Gebucht'],
  ['unavailable', 'Nicht verfügbar'],
  ['cancelled', 'Annulliert'],
];
const errors: Record<string, string> = {
  import_review_required:
    'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.',
  conflict: 'Inzwischen geändert. Eventakte aktualisieren und erneut prüfen.',
  resource_conflict:
    'Belegungskonflikt. Die bisherige Buchung bleibt erhalten.',
  booking_required:
    'Mindestens eine verfügbare Ressource der Kategorie Fotobox wählen.',
  unit_unavailable:
    'Eine gewählte Einheit ist gesperrt, inaktiv oder archiviert.',
  event_unavailable:
    'Bei Annulliert oder Nicht verfügbar alle Zuweisungen abwählen.',
  invalid_period: 'Einen vollständigen, gültigen Dispositionszeitraum angeben.',
  past_reservation:
    'Beendete Dispositionszeiträume können hier nicht neu zugewiesen werden.',
};
export function ResourceAssignments({
  event,
  csrfToken,
  onChanged,
}: {
  event: EventRow;
  csrfToken: string;
  onChanged: () => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null),
    request = useRef(0);
  const [units, setUnits] = useState<Unit[]>([]),
    [sources, setSources] = useState<Record<string, string>>({}),
    [verified, setVerified] = useState(new Set<string>()),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch('/api/v1/events/' + event.id + '/availability')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const data = (await response.json()) as Unit[];
        if (!Array.isArray(data)) throw Error('load');
        if (active) {
          setUnits(data);
          setVerified(new Set(data.map((row) => row.unitId)));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active)
          setMessage(
            'Ressourcen konnten nicht geladen werden. Eventakte aktualisieren.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [event.id]);
  function value(data: FormData, name: string) {
    return String(data.get(name) ?? '');
  }
  function instant(data: FormData, name: string) {
    return toInstant(
      value(data, name),
      event.timeZone,
      value(data, name + 'Offset'),
    );
  }
  function assignment(data: FormData, unit: Unit) {
    const periodSource = value(data, 'source-' + unit.unitId);
    return {
      unitId: unit.unitId,
      periodSource,
      ...(periodSource === 'manual'
        ? {
            baseStart: instant(data, 'start-' + unit.unitId),
            baseEnd: instant(data, 'end-' + unit.unitId),
          }
        : {}),
    };
  }
  async function preview(unit: Unit) {
    const current = ++request.current;
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData(form.current!),
        selected = assignment(data, unit);
      const baseStart =
        selected.periodSource === 'manual'
          ? selected.baseStart
          : instant(data, 'eventStart');
      const baseEnd =
        selected.periodSource === 'manual'
          ? selected.baseEnd
          : instant(data, 'eventEnd');
      if (!baseStart || !baseEnd) throw new RangeError();
      const query = new URLSearchParams({
        unitId: unit.unitId,
        baseStart,
        baseEnd,
      });
      const response = await fetch(
        '/api/v1/events/' + event.id + '/availability?' + query,
      );
      if (!response.ok) throw Error('preview');
      const [result] = (await response.json()) as Unit[];
      if (!result) throw Error('preview');
      if (current === request.current) {
        setUnits((rows) =>
          rows.map((row) =>
            row.unitId === unit.unitId
              ? {
                  ...row,
                  available: result.available,
                  reason: result.reason,
                  conflicts: result.conflicts,
                  startsAt: result.startsAt,
                  endsAt: result.endsAt,
                }
              : row,
          ),
        );
        setVerified((previous) => new Set([...previous, unit.unitId]));
        setMessage('Verfügbarkeit aktualisiert.');
      }
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? 'Zeitraum und UTC-Versatz prüfen.'
          : 'Verfügbarkeit konnte nicht geprüft werden.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData(form.current!);
      const payload = {
        ...event,
        status: value(data, 'bookingStatus'),
        eventDate: value(data, 'bookingDate') || null,
        startsAt: instant(data, 'eventStart'),
        endsAt: instant(data, 'eventEnd'),
        assignments: units
          .filter((unit) => data.has('unit-' + unit.unitId))
          .map((unit) => assignment(data, unit)),
      };
      const response = await fetch('/api/v1/events/' + event.id, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          errors[error.error] ??
            'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      await onChanged();
      setMessage('Zuweisung und Termin gespeichert.');
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? 'Zeitraum und UTC-Versatz prüfen.'
          : 'Verbindung fehlgeschlagen. Aktuellen Stand vor einem erneuten Versuch laden.',
      );
    } finally {
      setBusy(false);
    }
  }
  function time(value: string | null) {
    return value
      ? new Intl.DateTimeFormat('de-DE', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: event.timeZone,
        }).format(new Date(value))
      : 'Offen';
  }
  function timeInputs(name: string, label: string, initial: string | null) {
    const local = fromInstant(initial, event.timeZone);
    return (
      <>
        <label>
          {label}
          <input
            type="datetime-local"
            name={name}
            defaultValue={local.value}
            step="1"
          />
        </label>
        <label>
          UTC-Versatz: {label}
          <input
            name={name + 'Offset'}
            defaultValue={local.offset}
            placeholder="+02:00"
            pattern="[+-][0-9]{2}:[0-9]{2}"
          />
        </label>
      </>
    );
  }
  return (
    <section aria-label="Ressourcenzuweisung" aria-busy={loading || busy}>
      <h4>Ressourcen zuweisen</h4>
      <p role="status">{message}</p>
      {loading && <p>Verfügbarkeit wird geladen …</p>}
      <p>
        Zeitzone: {event.timeZone}. Jede Speicherung prüft die Belegung erneut.
        Vormerkungen sind keine feste Zusage.
      </p>
      <form
        ref={form}
        onChange={() => {
          ++request.current;
          setVerified(new Set());
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy || loading || !loaded}>
          <legend>Buchung, Termin und Ressourcen gemeinsam ändern</legend>
          <label>
            Buchungsstatus
            <select name="bookingStatus" defaultValue={event.status}>
              {statuses.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buchungsdatum
            <input
              type="date"
              name="bookingDate"
              defaultValue={event.eventDate ?? ''}
            />
          </label>
          {timeInputs(
            'eventStart',
            'Eventbeginn für die Disposition',
            event.startsAt,
          )}
          {timeInputs(
            'eventEnd',
            'Eventende für die Disposition',
            event.endsAt,
          )}
          {!units.length && loaded && (
            <p>
              Keine physischen Einheiten vorhanden. Zuerst Ressourcen anlegen.
            </p>
          )}
          {units.map((unit) => {
            const label = unit.name + ' · Einheit ' + unit.ordinal;
            return (
              <fieldset key={unit.unitId}>
                <legend>
                  {label} ({unit.code}, {unit.category})
                </legend>
                <label>
                  <input
                    type="checkbox"
                    name={'unit-' + unit.unitId}
                    defaultChecked={unit.selected}
                  />
                  {label} zuweisen
                </label>
                <p>
                  {unit.beforeDays} Tage vorher, {unit.afterDays} Tage nachher.
                  Einschließlich Puffer: {time(unit.startsAt)} –{' '}
                  {time(unit.endsAt)}
                </p>
                <p>
                  {!verified.has(unit.unitId)
                    ? 'Geändert; Verfügbarkeit erneut prüfen.'
                    : unit.reason === 'import_review_required'
                      ? errors.import_review_required
                      : unit.reason === 'unit_unavailable'
                        ? 'Einheit nicht verfügbar.'
                        : unit.reason
                          ? 'Zeitraum noch offen oder ungültig.'
                          : !unit.available
                            ? 'Belegt oder zeitweise gesperrt.'
                            : unit.conflicts.length
                              ? 'Konkurrierende Vormerkungen vorhanden.'
                              : 'Kein Belegungskonflikt.'}
                </p>
                <ul>
                  {unit.conflicts.map((conflict) => (
                    <li key={conflict.id}>
                      {conflict.state === 'hold'
                        ? 'Vormerkung'
                        : conflict.state === 'blocked'
                          ? 'Sperre'
                          : 'Feste Buchung'}
                      : {time(conflict.startsAt)} – {time(conflict.endsAt)}
                    </li>
                  ))}
                </ul>
                <label>
                  Zeitraum: {label}
                  <select
                    name={'source-' + unit.unitId}
                    defaultValue={unit.periodSource}
                    onChange={(e) =>
                      setSources((previous) => ({
                        ...previous,
                        [unit.unitId]: e.target.value,
                      }))
                    }
                  >
                    <option value="event">Aus Eventtermin</option>
                    <option value="manual">Eigener Dispositionszeitraum</option>
                  </select>
                </label>
                {(sources[unit.unitId] ?? unit.periodSource) === 'manual' && (
                  <>
                    {timeInputs(
                      'start-' + unit.unitId,
                      'Dispositionsbeginn: ' + label,
                      unit.baseStart,
                    )}
                    {timeInputs(
                      'end-' + unit.unitId,
                      'Dispositionsende: ' + label,
                      unit.baseEnd,
                    )}
                  </>
                )}
                <button type="button" onClick={() => void preview(unit)}>
                  Verfügbarkeit prüfen: {label}
                </button>
              </fieldset>
            );
          })}
          <button>Zuweisung und Termin speichern</button>
        </fieldset>
      </form>
    </section>
  );
}
