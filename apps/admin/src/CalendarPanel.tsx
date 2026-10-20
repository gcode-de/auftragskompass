import { useEffect, useRef, useState } from 'react';
import { emptyEventFilters, updateUrlSearch } from './url-state.js';
import { useAutoRefresh } from './auto-refresh.js';
type Day = { date: string; startsAt: string; endsAt: string };
type Calendar = {
  pendingPromises: number;
  date: string;
  view: string;
  timeZone: string;
  from: string;
  to: string;
  previousDate: string | null;
  nextDate: string | null;
  days: Day[];
  events: {
    id: string;
    name: string;
    status: string;
    eventDate: string;
    startsAt: string | null;
    endsAt: string | null;
    eventType: string | null;
    contact: string | null;
    location: string | null;
  }[];
  units: {
    id: string;
    name: string;
    code: string;
    ordinal: number;
    enabled: boolean;
    blocked: boolean;
  }[];
  reservations: {
    id: string;
    eventId: string | null;
    eventName: string | null;
    unitId: string;
    state: string;
    startsAt: string;
    endsAt: string;
    baseStart: string;
    baseEnd: string;
    reason: string;
    conflict: boolean;
  }[];
};
const labels: Record<string, string> = {
  inquiry: 'Anfrage',
  option: 'Option',
  booked: 'Gebucht',
  unavailable: 'Nicht verfügbar',
  cancelled: 'Annulliert',
  hold: 'Vormerkung',
  blocked: 'Sperre',
};
const colors: Record<string, string> = {
  inquiry: '#f3f4f6',
  option: '#fff3cd',
  booked: '#dbeafe',
  unavailable: '#f3f4f6',
  cancelled: '#f3f4f6',
  hold: '#fff3cd',
  blocked: '#e5e7eb',
  conflict: '#fee2e2',
  free: '#dcfce7',
};
function overlap(start: string, end: string, day: Day) {
  return (
    Date.parse(start) < Date.parse(day.endsAt) &&
    Date.parse(end) > Date.parse(day.startsAt)
  );
}
export function CalendarPanel() {
  const [date, setDate] = useState(''),
    [view, setView] = useState('week'),
    [data, setData] = useState<Calendar | null>(null),
    [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  async function refresh() {
    const current = ++sequence.current;
    setLoading(true);
    const query = new URLSearchParams({ view, ...(date ? { date } : {}) });
    try {
      const response = await fetch('/api/v1/calendar?' + query);
      if (!response.ok) throw Error('load');
      const result = (await response.json()) as Calendar;
      if (
        !Number.isInteger(result.pendingPromises) ||
        result.pendingPromises < 0 ||
        !Array.isArray(result.days) ||
        !Array.isArray(result.events) ||
        !Array.isArray(result.reservations) ||
        !Array.isArray(result.units)
      )
        throw Error('load');
      if (current === sequence.current) {
        setData(result);
        setLoadFailed(false);
      }
    } catch {
      if (current === sequence.current) setLoadFailed(true);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  function refreshOnReturn() {
    void refresh();
  }
  useAutoRefresh(refreshOnReturn, () => loading);
  useEffect(() => {
    void refresh();
  }, [date, view, revision]);
  useEffect(
    () => () => {
      ++sequence.current;
    },
    [],
  );
  function time(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: data!.timeZone,
    }).format(new Date(value));
  }
  function dayName(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }
  function link(id: string, name: string) {
    return (
      <a
        href={'#event-' + id}
        onClick={() => updateUrlSearch(emptyEventFilters)}
      >
        {name}
      </a>
    );
  }
  return (
    <section id="calendar" aria-label="Kalender" aria-busy={loading}>
      <h2>Event- und Ressourcenkalender</h2>
      {loadFailed && (
        <div className="reload-warning">
          <p role="alert">
            Kalender konnte nicht geladen werden.{' '}
            {data
              ? 'Der zuletzt geladene Stand bleibt sichtbar.'
              : 'Bitte erneut versuchen.'}
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={loading}
            onClick={() => void refresh()}
          >
            Kalender erneut laden
          </button>
        </div>
      )}
      <fieldset disabled={loading && !data}>
        <legend>Kalenderzeitraum</legend>
        <label>
          Kalenderdatum
          <input
            type="date"
            value={date || data?.date || ''}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Kalenderansicht
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="day">Tag</option>
            <option value="week">Woche</option>
            <option value="month">Monat</option>
          </select>
        </label>
        <button
          type="button"
          className="icon-action"
          aria-label="Vorheriger Zeitraum"
          title="Vorheriger Zeitraum"
          disabled={!data?.previousDate}
          onClick={() => setDate(data!.previousDate!)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-action"
          aria-label="Heute im Kalender"
          title="Heute im Kalender"
          onClick={() => {
            setDate('');
            setRevision((value) => value + 1);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM12 14v4" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-action"
          aria-label="Nächster Zeitraum"
          title="Nächster Zeitraum"
          disabled={!data?.nextDate}
          onClick={() => setDate(data!.nextDate!)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </fieldset>
      {loading && <p>Kalender wird geladen …</p>}
      {data && (
        <>
          <p>
            {data.from} bis {data.to}. Verfügbarkeiten werden beim Buchen erneut
            geprüft. Events ohne Datum stehen in der Eventliste.
          </p>
          {data.pendingPromises > 0 && (
            <p role="alert">
              {data.pendingPromises} ungeprüfte Bestandszusagen: Der
              Kalenderbestand ist unvollständig. Keine freie Kapazität zusagen;
              zuerst Box und Zubehör in der{' '}
              <a href="#import-review">Import-Prüfliste</a> abgleichen.
            </p>
          )}
          <p role="group" aria-label="Kalenderlegende">
            {[
              [
                data.pendingPromises ? 'hold' : 'free',
                data.pendingPromises ? 'Bestand ungeprüft' : 'Frei',
              ],
              ['hold', 'Vormerkung'],
              ['booked', 'Gebucht'],
              ['blocked', 'Sperre'],
              ['conflict', 'Konflikt mit Vormerkung'],
            ].map(([key, label]) => (
              <span
                key={label}
                style={{
                  display: 'inline-block',
                  padding: '0.25rem',
                  marginRight: '0.5rem',
                  backgroundColor: colors[key!],
                  color: '#111827',
                }}
              >
                {label}
              </span>
            ))}
          </p>
          <h3>Events</h3>
          {!data.events.length && <p>Keine Events in diesem Zeitraum.</p>}
          <div
            role="region"
            aria-label="Eventkalender"
            tabIndex={0}
            style={{ overflowX: 'auto' }}
          >
            <ol
              style={{
                listStyle: 'none',
                padding: 0,
                display: 'grid',
                gridTemplateColumns:
                  'repeat(' +
                  (view === 'day' ? 1 : 7) +
                  ', minmax(10rem, 1fr))',
                gap: '0.5rem',
              }}
            >
              {view === 'month' &&
                Array.from(
                  {
                    length:
                      (new Date(data.days[0]!.date + 'T12:00:00Z').getUTCDay() +
                        6) %
                      7,
                  },
                  (_, index) => <li key={'pad-' + index} aria-hidden="true" />,
                )}
              {data.days.map((day) => (
                <li
                  key={day.date}
                  style={{
                    border: '1px solid #6b7280',
                    padding: '0.5rem',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <h4>{dayName(day.date)}</h4>
                  {data.events
                    .filter((event) =>
                      event.startsAt && event.endsAt
                        ? overlap(event.startsAt, event.endsAt, day)
                        : event.eventDate === day.date,
                    )
                    .map((event) => (
                      <article
                        className="calendar-state"
                        key={event.id}
                        style={{
                          padding: '0.4rem',
                          marginBottom: '0.4rem',
                          backgroundColor: colors[event.status],
                          color: '#111827',
                        }}
                      >
                        {link(event.id, event.name)}
                        <p>
                          {labels[event.status]} ·{' '}
                          {event.startsAt && event.endsAt
                            ? time(event.startsAt) + ' – ' + time(event.endsAt)
                            : 'Uhrzeit offen'}
                        </p>
                        <p>
                          {event.eventType ?? 'Eventart offen'} ·{' '}
                          {event.contact ?? 'Kontakt offen'} ·{' '}
                          {event.location ?? 'Ort offen'}
                        </p>
                        <p>
                          Ressourcen:{' '}
                          {data.reservations
                            .filter((slot) => slot.eventId === event.id)
                            .map((slot) => {
                              const unit = data.units.find(
                                (unit) => unit.id === slot.unitId,
                              )!;
                              return unit.code + ' #' + unit.ordinal;
                            })
                            .join(', ') || 'Keine zugewiesen'}
                        </p>
                      </article>
                    ))}
                </li>
              ))}
            </ol>
          </div>
          <div
            role="region"
            aria-label="Horizontale Ressourcen-Zeitleiste"
            tabIndex={0}
            style={{ overflowX: 'auto' }}
          >
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <caption>Ressourcen-Zeitleiste</caption>
              <thead>
                <tr>
                  <th scope="col">Physische Einheit</th>
                  {data.days.map((day) => (
                    <th scope="col" key={day.date}>
                      {dayName(day.date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.units.map((unit) => (
                  <tr key={unit.id}>
                    <th scope="row">
                      {unit.name} · Einheit {unit.ordinal} ({unit.code})
                    </th>
                    {data.days.map((day) => {
                      const slots = data.reservations.filter(
                        (slot) =>
                          slot.unitId === unit.id &&
                          overlap(slot.startsAt, slot.endsAt, day),
                      );
                      const unavailable = !unit.enabled || unit.blocked;
                      const kind = slots.some((slot) => slot.conflict)
                        ? 'conflict'
                        : unavailable
                          ? 'blocked'
                          : slots.some((slot) => slot.state === 'booked')
                            ? 'booked'
                            : slots.some((slot) => slot.state === 'blocked')
                              ? 'blocked'
                              : slots.length
                                ? 'hold'
                                : data.pendingPromises
                                  ? 'hold'
                                  : 'free';
                      return (
                        <td
                          className="calendar-state"
                          key={day.date}
                          style={{
                            border: '1px solid #6b7280',
                            padding: '0.5rem',
                            minWidth: '10rem',
                            verticalAlign: 'top',
                            backgroundColor: colors[kind],
                            color: '#111827',
                          }}
                        >
                          {unavailable && (
                            <p>
                              {unit.blocked
                                ? 'Allgemein gesperrt'
                                : 'Inaktive Einheit'}
                            </p>
                          )}
                          {!slots.length && !unavailable && (
                            <p>
                              {data.pendingPromises
                                ? 'Bestand ungeprüft'
                                : 'Frei'}
                            </p>
                          )}
                          {slots.map((slot) => (
                            <div key={slot.id}>
                              <strong>
                                {slot.conflict ? 'Konflikt: ' : ''}
                                {labels[slot.state]}
                              </strong>
                              <p>
                                {slot.eventId
                                  ? link(
                                      slot.eventId,
                                      slot.eventName ?? 'Eventreservierung',
                                    )
                                  : slot.reason || 'Zeitweise Sperre'}
                              </p>
                              <p>
                                Einschließlich Puffer: {time(slot.startsAt)} –{' '}
                                {time(slot.endsAt)}
                              </p>
                              <p>
                                Basiszeitraum: {time(slot.baseStart)} –{' '}
                                {time(slot.baseEnd)}
                              </p>
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.units.length && <p>Keine physischen Einheiten vorhanden.</p>}
        </>
      )}
    </section>
  );
}
