import { useEffect, useRef, useState } from 'react';
import { emptyEventFilters, updateUrlSearch } from './url-state.js';
type Day = { date: string; startsAt: string; endsAt: string };
type Calendar = {
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
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    setLoading(true);
    setMessage('');
    const query = new URLSearchParams({ view, ...(date ? { date } : {}) });
    void fetch('/api/v1/calendar?' + query)
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        const result = (await response.json()) as Calendar;
        if (
          !Array.isArray(result.days) ||
          !Array.isArray(result.events) ||
          !Array.isArray(result.reservations) ||
          !Array.isArray(result.units)
        )
          throw Error('load');
        if (current === sequence.current) setData(result);
      })
      .catch(() => {
        if (current === sequence.current)
          setMessage(
            'Kalender konnte nicht geladen werden. Bitte erneut aktualisieren.',
          );
      })
      .finally(() => {
        if (current === sequence.current) setLoading(false);
      });
    return () => {
      ++sequence.current;
    };
  }, [date, view, revision]);
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
      <p role="status">{message}</p>
      <fieldset disabled={loading}>
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
          disabled={!data?.previousDate}
          onClick={() => setDate(data!.previousDate!)}
        >
          Vorheriger Zeitraum
        </button>
        <button
          type="button"
          onClick={() => {
            setDate('');
            setRevision((value) => value + 1);
          }}
        >
          Heute im Kalender
        </button>
        <button
          type="button"
          disabled={!data?.nextDate}
          onClick={() => setDate(data!.nextDate!)}
        >
          Nächster Zeitraum
        </button>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Kalender aktualisieren
        </button>
      </fieldset>
      {loading && <p>Kalender wird geladen …</p>}
      {data && !loading && !message && (
        <>
          <p>
            {data.from} bis {data.to} · Zeitzone: {data.timeZone}.
            Verfügbarkeiten werden beim Buchen erneut geprüft. Events ohne Datum
            stehen in der Eventliste.
          </p>
          <p aria-label="Kalenderlegende">
            {[
              ['free', 'Frei'],
              ['hold', 'Vormerkung'],
              ['booked', 'Gebucht'],
              ['blocked', 'Sperre'],
              ['conflict', 'Konflikt mit Vormerkung'],
            ].map(([key, label]) => (
              <span
                key={key}
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
                                : 'free';
                      return (
                        <td
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
                          {!slots.length && !unavailable && <p>Frei</p>}
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
