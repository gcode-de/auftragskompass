import { useEffect, useRef, useState } from 'react';
import { canonicalEventRow, validEventRow } from './EventInlineEditor.js';
import type { EventRow } from './EventPanel.js';
import { EventTimeField } from './EventTimeField.js';
import {
  localDateTime,
  resolveEventTime,
  type AmbiguousTimeChoice,
  type LocalTime,
} from './event-time.js';
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
type Assignment =
  | { unitId: string; periodSource: 'event' }
  | {
      unitId: string;
      periodSource: 'manual';
      baseStart: string;
      baseEnd: string;
    };
const statuses = [
  ['inquiry', 'Anfrage'],
  ['option', 'Option'],
  ['booked', 'Gebucht'],
  ['unavailable', 'Nicht verfügbar'],
  ['cancelled', 'Annulliert'],
];
const errors: Record<string, string> = {
  incomplete_import:
    'Kontakt, Paket und Datum im Quelldatensatz vor der Bestätigung vervollständigen.',
  already_reviewed:
    'Diese Bestandszusage wurde bereits geprüft. Prüfliste aktualisieren.',
  mapping_missing:
    'Die Quellzuordnung fehlt. Übernahmebestand vor der Bestätigung klären.',
  timezone_changed:
    'Die Mandantenzeitzone wurde geändert. Termin vor der Übernahme fachlich klären.',
  import_review_required:
    'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.',
  conflict:
    'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.',
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
// Local wall-clock input that does not exist (spring gap) or is ambiguous
// (autumn overlap) is reported by the field itself. Saving must still focus it,
// and inside the collapsed advanced section it must be revealed first.
function intrinsicField(resolution: LocalTime, name: string) {
  if (resolution.kind === 'nonexistent' || resolution.kind === 'invalid')
    return name;
  if (resolution.kind === 'ambiguous') return name + 'Choice';
  return '';
}
export function ResourceAssignments({
  event,
  csrfToken,
  onChanged,
  onReconcile,
  onDirtyChange,
  onConfirmed,
  canMutate,
  onMutationChange,
  onUnconfirmedChange,
  locked = false,
  importReview = false,
}: {
  event: EventRow;
  csrfToken: string;
  onChanged: () => Promise<void>;
  onReconcile?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onConfirmed?: (row: EventRow) => void;
  canMutate?: () => boolean;
  onMutationChange?: (busy: boolean) => void;
  onUnconfirmedChange?: (value: boolean) => void;
  locked?: boolean;
  importReview?: boolean;
}) {
  const path =
    (importReview ? '/api/v1/imports/bookitup/promises/' : '/api/v1/events/') +
    event.id;
  const form = useRef<HTMLFormElement>(null),
    request = useRef(0),
    saving = useRef(false),
    dirty = useRef(false),
    uncertain = useRef(false);
  const [units, setUnits] = useState<Unit[]>([]),
    [sources, setSources] = useState<Record<string, string>>({}),
    [verified, setVerified] = useState(new Set<string>()),
    [message, setMessage] = useState(''),
    [errorsByField, setErrorsByField] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [reloadWarning, setReloadWarning] = useState(false),
    [unconfirmed, setUnconfirmed] = useState(false),
    [eventDate, setEventDate] = useState(
      event.eventDate ??
        (event.startsAt
          ? localDateTime(event.startsAt, event.timeZone).slice(0, 10)
          : ''),
    ),
    [dateDerived, setDateDerived] = useState(Boolean(event.startsAt));
  useEffect(() => {
    let active = true;
    void fetch(path + '/availability')
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
            'Ressourcen konnten nicht geladen werden. Bitte erneut versuchen.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  function value(data: FormData, name: string) {
    return String(data.get(name) ?? '');
  }
  function resolveField(data: FormData, name: string, original: string | null) {
    const choice = value(data, name + 'Choice') as AmbiguousTimeChoice | '';
    return resolveEventTime(value(data, name), event.timeZone, {
      originalInstant: original,
      choice: choice === 'earlier' || choice === 'later' ? choice : '',
    });
  }
  // A corrected field must not keep the message from the last save. Pairing
  // errors belong to both fields of a period, so correcting either one clears
  // both; times that are still impossible keep their own intrinsic error from
  // EventTimeField until they become valid.
  function clearFieldErrors(name: string) {
    const base = name.replace(/Choice$/, ''),
      partner = base.startsWith('start-')
        ? 'end-' + base.slice(6)
        : base.startsWith('end-')
          ? 'start-' + base.slice(4)
          : base === 'startsAt'
            ? 'endsAt'
            : base === 'endsAt'
              ? 'startsAt'
              : '',
      stale = [base, partner].filter((key) => key && errorsByField[key]);
    if (!stale.length) return;
    const next = { ...errorsByField };
    for (const key of stale) delete next[key];
    setErrorsByField(next);
    if (!Object.keys(next).length)
      setMessage((current) =>
        current === 'Termin prüfen: markierte Felder korrigieren.'
          ? ''
          : current,
      );
  }
  function reveal(name: string) {
    const field = form.current?.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!field) return;
    const details = field.closest('details');
    if (details) details.open = true;
    field.focus();
  }
  async function preview(unit: Unit) {
    const current = ++request.current;
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData(form.current!),
        manual = value(data, 'source-' + unit.unitId) === 'manual',
        unitStart = manual
          ? resolveField(data, 'start-' + unit.unitId, unit.baseStart)
          : resolveField(data, 'startsAt', event.startsAt),
        unitEnd = manual
          ? resolveField(data, 'end-' + unit.unitId, unit.baseEnd)
          : resolveField(data, 'endsAt', event.endsAt);
      if (unitStart.kind !== 'unique' || unitEnd.kind !== 'unique') {
        const focusName = manual
          ? intrinsicField(unitStart, 'start-' + unit.unitId) ||
            intrinsicField(unitEnd, 'end-' + unit.unitId) ||
            'start-' + unit.unitId
          : intrinsicField(unitStart, 'startsAt') ||
            intrinsicField(unitEnd, 'endsAt');
        setMessage(
          'Für die Prüfung zuerst einen vollständigen, gültigen Zeitraum angeben.',
        );
        if (focusName) reveal(focusName);
        return;
      }
      const query = new URLSearchParams({
        unitId: unit.unitId,
        baseStart: unitStart.instant,
        baseEnd: unitEnd.instant,
      });
      const response = await fetch(path + '/availability?' + query);
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
    } catch {
      setMessage('Verfügbarkeit konnte nicht geprüft werden.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      saving.current ||
      uncertain.current ||
      !form.current ||
      (canMutate && !canMutate())
    )
      return;
    const data = new FormData(form.current),
      nextErrors: Record<string, string> = {};
    let focus = '';
    const mark = (name: string) => {
      if (!focus) focus = name;
    };
    const rawStart = value(data, 'startsAt'),
      rawEnd = value(data, 'endsAt'),
      start = resolveField(data, 'startsAt', event.startsAt),
      end = resolveField(data, 'endsAt', event.endsAt);
    // Validate in DOM order so the first reported problem is also focused.
    for (const [name, resolution] of [
      ['startsAt', start],
      ['endsAt', end],
    ] as const) {
      const field = intrinsicField(resolution, name);
      if (field) mark(field);
    }
    if (rawStart && !rawEnd) {
      nextErrors.endsAt = 'Bitte auch das Ende angeben.';
      mark('endsAt');
    }
    if (!rawStart && rawEnd) {
      nextErrors.startsAt = 'Bitte auch den Beginn angeben.';
      mark('startsAt');
    }
    if (
      start.kind === 'unique' &&
      end.kind === 'unique' &&
      Date.parse(start.instant) >= Date.parse(end.instant)
    ) {
      nextErrors.endsAt = 'Das Ende muss nach dem Beginn liegen.';
      mark('endsAt');
    }
    const assignments: Assignment[] = units
      .filter((unit) => data.has('unit-' + unit.unitId))
      .map((unit) => {
        if (value(data, 'source-' + unit.unitId) !== 'manual')
          return { unitId: unit.unitId, periodSource: 'event' };
        const startName = 'start-' + unit.unitId,
          endName = 'end-' + unit.unitId,
          unitStart = resolveField(data, startName, unit.baseStart),
          unitEnd = resolveField(data, endName, unit.baseEnd);
        for (const [name, resolution] of [
          [startName, unitStart],
          [endName, unitEnd],
        ] as const) {
          const field = intrinsicField(resolution, name);
          if (field) mark(field);
        }
        if (unitStart.kind === 'empty') {
          nextErrors[startName] = 'Bitte einen Dispositionsbeginn angeben.';
          mark(startName);
        }
        if (unitEnd.kind === 'empty') {
          nextErrors[endName] = 'Bitte ein Dispositionsende angeben.';
          mark(endName);
        }
        if (
          unitStart.kind === 'unique' &&
          unitEnd.kind === 'unique' &&
          Date.parse(unitStart.instant) >= Date.parse(unitEnd.instant)
        ) {
          nextErrors[endName] =
            'Das Dispositionsende muss nach dem Beginn liegen.';
          mark(endName);
        }
        return {
          unitId: unit.unitId,
          periodSource: 'manual',
          baseStart: unitStart.kind === 'unique' ? unitStart.instant : '',
          baseEnd: unitEnd.kind === 'unique' ? unitEnd.instant : '',
        };
      });
    if (focus) {
      setErrorsByField(nextErrors);
      setMessage('Termin prüfen: markierte Felder korrigieren.');
      reveal(focus);
      return;
    }
    setErrorsByField({});
    saving.current = true;
    onMutationChange?.(true);
    setBusy(true);
    setMessage('');
    try {
      const payload = {
        ...event,
        status: value(data, 'bookingStatus'),
        eventDate:
          dateDerived && rawStart ? rawStart.slice(0, 10) : eventDate || null,
        startsAt: start.kind === 'unique' ? start.instant : null,
        endsAt: end.kind === 'unique' ? end.instant : null,
        assignments,
      };
      const response = await fetch(path, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(
          importReview
            ? Object.fromEntries(
                Object.entries(payload).filter(
                  ([key]) => key !== 'id' && key !== 'timeZone',
                ),
              )
            : payload,
        ),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        if (response.status === 409 && onConfirmed) {
          uncertain.current = true;
          onUnconfirmedChange?.(true);
          setUnconfirmed(true);
          dirty.current = true;
          onDirtyChange?.(true);
        }
        setMessage(
          errors[error.error] ??
            'Speichern fehlgeschlagen. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      if (!importReview && onConfirmed) {
        const row: unknown = await response.json().catch(() => null);
        if (!validEventRow(row, event.id, event.version + 1))
          throw Error('unconfirmed');
        onConfirmed(canonicalEventRow(row));
      }
      // The PUT is confirmed. Report it first; a failing reload is a refresh
      // problem, not a reason to submit the booking again.
      setMessage('Zuweisung und Termin gespeichert.');
      dirty.current = false;
      onDirtyChange?.(false);
      try {
        await onChanged();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      if (onConfirmed) {
        uncertain.current = true;
        onUnconfirmedChange?.(true);
        setUnconfirmed(true);
        dirty.current = true;
        onDirtyChange?.(true);
      }
      setMessage(
        'Verbindung fehlgeschlagen. Aktuellen Stand vor einem erneuten Versuch laden.',
      );
    } finally {
      saving.current = false;
      onMutationChange?.(false);
      setBusy(false);
    }
  }
  async function reconcile() {
    if (
      saving.current ||
      !window.confirm('Ungespeicherte Eingaben verwerfen und neu laden?')
    )
      return;
    saving.current = true;
    onMutationChange?.(true);
    dirty.current = false;
    onDirtyChange?.(false);
    try {
      await (onReconcile ?? onChanged)();
      uncertain.current = false;
      onUnconfirmedChange?.(false);
      setUnconfirmed(false);
      setMessage('');
    } catch {
      dirty.current = true;
      onDirtyChange?.(true);
    } finally {
      saving.current = false;
      onMutationChange?.(false);
    }
  }
  function retryLoad() {
    if (
      dirty.current &&
      !window.confirm('Ungespeicherte Eingaben verwerfen und neu laden?')
    )
      return;
    dirty.current = false;
    onDirtyChange?.(false);
    setReloadWarning(false);
    void onChanged().catch(() => setReloadWarning(true));
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
  function manual(unit: Unit) {
    return (sources[unit.unitId] ?? unit.periodSource) === 'manual';
  }
  return (
    <section aria-label="Ressourcenzuweisung" aria-busy={loading || busy}>
      <h3>Ressourcen zuweisen</h3>
      <p role="status">{message}</p>
      {unconfirmed && (
        <button type="button" onClick={() => void reconcile()}>
          Serverstand prüfen und Eingaben verwerfen
        </button>
      )}
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Zuweisung gespeichert, aber die Event-Details konnten nicht neu
            geladen werden. Nichts erneut buchen.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={retryLoad}
          >
            Event-Details erneut laden
          </button>
        </div>
      )}
      {loading && <p>Verfügbarkeit wird geladen …</p>}
      <p>
        Zeitzone: {event.timeZone}. Uhrzeiten werden automatisch in dieser
        Zeitzone gespeichert. Jede Speicherung prüft die Belegung erneut;
        Vormerkungen sind keine feste Zusage.
      </p>
      <form
        ref={form}
        onChange={(event) => {
          clearFieldErrors(
            (event.target as HTMLElement).getAttribute('name') ?? '',
          );
          ++request.current;
          setVerified(new Set());
          dirty.current = true;
          onDirtyChange?.(true);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={busy || loading || !loaded || locked || unconfirmed}
        >
          <legend>Buchungsstatus</legend>
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
        </fieldset>
        <fieldset
          disabled={busy || loading || !loaded || locked || unconfirmed}
        >
          <legend>Termin</legend>
          <label>
            Eventdatum
            <input
              type="date"
              name="eventDate"
              value={eventDate}
              readOnly={dateDerived}
              aria-describedby="assignment-date-help"
              onChange={(e) => setEventDate(e.currentTarget.value)}
            />
          </label>
          <EventTimeField
            name="startsAt"
            label="Eventbeginn"
            timeZone={event.timeZone}
            idPrefix="assignment"
            instant={event.startsAt}
            error={errorsByField.startsAt}
            onChange={(next) => {
              setDateDerived(Boolean(next));
              if (next) setEventDate(next.slice(0, 10));
            }}
          />
          <EventTimeField
            name="endsAt"
            label="Eventende"
            timeZone={event.timeZone}
            idPrefix="assignment"
            instant={event.endsAt}
            error={errorsByField.endsAt}
          />
          <p id="assignment-date-help">
            {dateDerived
              ? 'Wird aus dem Beginn übernommen. Um das Datum zu ändern, den Beginn ändern.'
              : 'Ohne Uhrzeiten bleibt ein Datum oder ein undatiertes Event möglich. Mit Beginn wird das Datum aus dessen lokalem Starttag übernommen.'}
          </p>
          <p>
            Beginn und Ende gemeinsam oder gar nicht. Das Ende muss nach dem
            Beginn liegen. Änderungen hier gelten für das gesamte Event.
          </p>
        </fieldset>
        {!units.length && loaded && (
          <p>
            Keine physischen Einheiten vorhanden. Zuerst Ressourcen anlegen.
          </p>
        )}
        {units.map((unit) => {
          const label = unit.name + ' · Einheit ' + unit.ordinal,
            ownPeriod = manual(unit);
          return (
            <fieldset
              key={unit.unitId}
              disabled={busy || loading || !loaded || locked || unconfirmed}
            >
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
              <button
                type="button"
                className="secondary-action"
                onClick={() => void preview(unit)}
              >
                Verfügbarkeit prüfen: {label}
              </button>
              <details>
                <summary>
                  Erweitert: eigener Dispositionszeitraum
                  {ownPeriod
                    ? unit.baseStart && unit.baseEnd
                      ? ` (gespeichert: ${time(unit.baseStart)} bis ${time(unit.baseEnd)})`
                      : ' (noch nicht vollständig)'
                    : ' (aus Eventtermin)'}
                </summary>
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
                {ownPeriod && (
                  <>
                    <EventTimeField
                      name={'start-' + unit.unitId}
                      label={'Dispositionsbeginn: ' + label}
                      timeZone={event.timeZone}
                      idPrefix="assignment"
                      instant={unit.baseStart}
                      error={errorsByField['start-' + unit.unitId]}
                    />
                    <EventTimeField
                      name={'end-' + unit.unitId}
                      label={'Dispositionsende: ' + label}
                      timeZone={event.timeZone}
                      idPrefix="assignment"
                      instant={unit.baseEnd}
                      error={errorsByField['end-' + unit.unitId]}
                    />
                  </>
                )}
              </details>
            </fieldset>
          );
        })}
        <button
          className="primary-action"
          disabled={busy || loading || !loaded || locked || unconfirmed}
        >
          {importReview
            ? 'Geprüfte Bestandszusage übernehmen'
            : 'Zuweisung und Termin speichern'}
        </button>
      </form>
    </section>
  );
}
