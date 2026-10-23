import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  emptyEventFilters,
  updateUrlSearch,
  useUrlSearch,
} from './url-state.js';
import { useAutoRefresh } from './auto-refresh.js';
import {
  calendarDayLabel,
  calendarDayNumber,
  calendarWeekdayMonthLabel,
  calendarHeading,
  calendarViewFromUrl,
  eventDateLabel,
  eventSpanText,
  plainDateText,
  viewLabel,
  type CalendarView,
} from './calendar-range.js';
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
    eventDate: string | null;
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
// BKP008: a compact per-day summary needs one shape per status, in a stable
// order, so a narrow cell is not a soup of dots in random order.
const statusOrder = [
  'conflict',
  'blocked',
  'unavailable',
  'cancelled',
  'booked',
  'hold',
  'option',
  'inquiry',
];
function dayStatuses(events: Calendar['events']) {
  const distinct = new Set(events.map((event) => event.status));
  return statusOrder
    .filter((status) => distinct.has(status))
    .concat([...distinct].filter((status) => !statusOrder.includes(status)));
}
// Drawn shapes, not colour alone: filled = booked, ring = option/inquiry,
// square = hold, bar = blocked/unavailable, cross = conflict.
function StatusMark({ status }: { status: string }) {
  const shape =
    status === 'booked' ? (
      <circle cx="4" cy="4" r="3" fill="currentColor" />
    ) : status === 'hold' ? (
      <rect
        x="1"
        y="1"
        width="6"
        height="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    ) : status === 'blocked' ||
      status === 'unavailable' ||
      status === 'cancelled' ? (
      <path
        d="M1 4h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    ) : status === 'conflict' ? (
      <path
        d="M1.7 1.7l4.6 4.6M6.3 1.7l-4.6 4.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    ) : (
      <circle
        cx="4"
        cy="4"
        r="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    );
  return (
    <svg
      className="calendar-day-mark"
      viewBox="0 0 8 8"
      aria-hidden="true"
      data-state={status}
    >
      {shape}
    </svg>
  );
}
export function CalendarPanel() {
  const search = useUrlSearch();
  const [date, setDate] = useState(''),
    [view, setView] = useState<CalendarView>(() => calendarViewFromUrl(search)),
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
  function selectedDate() {
    return date || data?.date || '';
  }
  // BKP008: choosing a day never refetches. The loaded month already carries
  // every day, so the agenda is instant, focus stays on the pressed button and
  // a stale response cannot move the user's selection.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById('calendar-day-' + pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const todayDate = data
    ? new Intl.DateTimeFormat('en-CA', { timeZone: data.timeZone }).format(
        new Date(),
      )
    : '';
  const agendaDate =
    pickedDay && data?.days.some((day) => day.date === pickedDay)
      ? pickedDay
      : (data?.date ?? '');
  // A grid without the selected date still needs one tab stop, otherwise the
  // month would be unreachable by keyboard.
  const gridHasSelection = data?.days.some((day) => day.date === agendaDate);
  const agendaDay = data?.days.find((day) => day.date === agendaDate);
  // A day outside the loaded range still shows its date-only bookings instead
  // of pretending the day is empty.
  const agendaEvents = agendaDay
    ? eventsOn(agendaDay)
    : (data?.events.filter((event) => event.eventDate === agendaDate) ?? []);
  // Cursor keys move the day selection; Tab keeps a single stop in the grid.
  function moveDay(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? 7
            : event.key === 'ArrowUp'
              ? -7
              : 0;
    const target = step ? data?.days[index + step] : undefined;
    if (!target) return;
    event.preventDefault();
    pendingFocus.current = target.date;
    setPickedDay(target.date);
  }
  // The visible cell shows number, today and count; the accessible name starts
  // with exactly those words (WCAG 2.5.3) and then names the rest of the day.
  function dayNameText(day: Day, events: Calendar['events'], isToday: boolean) {
    const parts = [calendarDayNumber(day.date)];
    if (isToday) parts.push('heute');
    parts.push(
      events.length
        ? events.length + (events.length === 1 ? ' Event' : ' Events')
        : 'keine Events',
    );
    parts.push(calendarWeekdayMonthLabel(day.date));
    if (events.length)
      parts.push(
        'Status: ' +
          dayStatuses(events)
            .map((status) => labels[status] ?? status)
            .join(', '),
      );
    return parts.join(', ');
  }
  function eventsOn(day: Day) {
    return data!.events.filter((event) =>
      event.startsAt && event.endsAt
        ? overlap(event.startsAt, event.endsAt, day)
        : event.eventDate === day.date,
    );
  }
  function resourcesText(eventId: string) {
    return (
      data!.reservations
        .filter((slot) => slot.eventId === eventId)
        .map((slot) => {
          const unit = data!.units.find((unit) => unit.id === slot.unitId)!;
          return unit.code + ' #' + unit.ordinal;
        })
        .join(', ') || 'Keine zugewiesen'
    );
  }
  // One chip for both grids. The month cell keeps the event link (the BKP001
  // contract), while the agenda below repeats the same target with the full
  // schedule, venue and status.
  function chip(event: Calendar['events'][number]) {
    return (
      <article
        className="calendar-state calendar-chip"
        key={event.id}
        style={{ backgroundColor: colors[event.status] }}
      >
        <a
          className="calendar-chip-link"
          href={'#event-' + event.id}
          onClick={() => updateUrlSearch(emptyEventFilters)}
        >
          {event.name}
        </a>
        <p className="calendar-chip-time calendar-note">
          {eventScheduleText(event)}
        </p>
        <p className="calendar-chip-meta">
          {labels[event.status] ?? event.status} ·{' '}
          {event.eventType ?? 'Eventart offen'} ·{' '}
          {event.contact ?? 'Kontakt offen'}
          {event.location ? ' · ' + event.location : ''}
        </p>
        <p className="calendar-chip-resources">
          Ressourcen: {resourcesText(event.id)}
        </p>
      </article>
    );
  }
  function clockTime(value: string) {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
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
  // Tenant-local calendar day of an instant; en-CA yields YYYY-MM-DD.
  function eventDay(value: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: data!.timeZone,
    }).format(new Date(value));
  }
  function slotPeriod(start: string, end: string) {
    return (
      new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: data!.timeZone,
      }).format(new Date(start)) +
      ' – ' +
      new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: data!.timeZone,
      }).format(new Date(end))
    );
  }
  // H037: only the stored (nullable) start/end decide whether a time exists.
  // A date-only booking never gets a synthetic 00:00; a genuine midnight
  // booking keeps its real clock time. Multi-day bookings show their original
  // interval in every cell they occupy instead of being re-dated per cell.
  function eventScheduleText(event: Calendar['events'][number]) {
    return event.startsAt && event.endsAt
      ? eventSpanText(event, eventDay, clockTime, plainDateText)
      : eventDateLabel(event);
  }
  // The grid always renders the view that the displayed data actually
  // belongs to. After a failed view/date change the previous data stays on
  // screen, so its own grid (and weekday padding) must stay too instead of
  // dressing month data as a day grid.
  const loadedView = (data?.view as CalendarView | undefined) ?? view;
  const heading = data ? calendarHeading(data.from, data.to, loadedView) : null;
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
            className="tertiary-action"
            disabled={loading}
            onClick={() => void refresh()}
          >
            Kalender erneut laden
          </button>
        </div>
      )}
      <div className="calendar-toolbar">
        <div
          className="calendar-navigation"
          role="group"
          aria-label="Kalenderzeitraum"
        >
          <button
            type="button"
            className="icon-action tier-quiet-icon"
            aria-label="Vorheriger Zeitraum"
            title="Vorheriger Zeitraum"
            disabled={!data?.previousDate || (loading && !data)}
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
            className="icon-action tier-quiet-icon"
            aria-label="Heute im Kalender"
            title="Heute im Kalender"
            disabled={loading && !data}
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
            className="icon-action tier-quiet-icon"
            aria-label="Nächster Zeitraum"
            title="Nächster Zeitraum"
            disabled={!data?.nextDate || (loading && !data)}
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
          <p className="calendar-context" aria-live="polite">
            <strong>{heading ? heading.title : viewLabel(view)}</strong>{' '}
            <span>
              {heading ? heading.range : plainDateText(selectedDate())}
            </span>
          </p>
        </div>
        <label className="calendar-view-field">
          Kalenderansicht
          <select
            value={view}
            disabled={loading && !data}
            onChange={(e) => setView(e.target.value as CalendarView)}
          >
            <option value="day">Tag</option>
            <option value="week">Woche</option>
            <option value="month">Monat</option>
          </select>
        </label>
        <label className="calendar-date-field">
          Kalenderdatum
          <input
            type="date"
            value={selectedDate()}
            disabled={loading && !data}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      {loading && <p>Kalender wird geladen …</p>}
      {data && (
        <>
          <p className="calendar-hint">
            Verfügbarkeiten werden beim Buchen erneut geprüft. Events ohne Datum
            stehen in der Eventliste.
          </p>
          {data.pendingPromises > 0 && (
            <p role="alert">
              {data.pendingPromises} ungeprüfte Bestandszusagen: Der
              Kalenderbestand ist unvollständig. Keine freie Kapazität zusagen;
              zuerst Box und Zubehör in der{' '}
              <a href="#import-review">Import-Prüfliste</a> abgleichen.
            </p>
          )}
          <div
            className="calendar-legend"
            role="group"
            aria-label="Kalenderlegende"
          >
            <ul>
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
                <li key={label}>
                  <span
                    className="calendar-legend-swatch"
                    style={{ backgroundColor: colors[key!] }}
                    aria-hidden="true"
                  />
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <h3 className="calendar-events-heading">
            Events ({data.events.length})
          </h3>
          {!data.events.length && <p>Keine Events in diesem Zeitraum.</p>}
          <div
            className="calendar-events"
            role="region"
            aria-label="Eventkalender"
            tabIndex={0}
            data-view={loadedView}
          >
            <ol className="calendar-grid">
              {loadedView === 'month' && (
                <li className="calendar-weekday-head" aria-hidden="true">
                  <ol>
                    {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ol>
                </li>
              )}
              {loadedView === 'month' &&
                Array.from(
                  {
                    length:
                      (new Date(data.days[0]!.date + 'T12:00:00Z').getUTCDay() +
                        6) %
                      7,
                  },
                  (_, index) => <li key={'pad-' + index} aria-hidden="true" />,
                )}
              {data.days.map((day, index) => {
                const dayEvents = eventsOn(day);
                if (loadedView !== 'month')
                  return (
                    <li key={day.date} className="calendar-day">
                      <h4>
                        <time dateTime={day.date}>{dayName(day.date)}</time>
                      </h4>
                      {dayEvents.map((event) => chip(event))}
                    </li>
                  );
                // BKP008: one short number per cell plus a compact summary; the
                // full titles live in the agenda below, so a 40-px cell at 320
                // never clips an event into unreadability.
                const isToday = day.date === todayDate;
                const selected = day.date === agendaDate;
                const statuses = dayStatuses(dayEvents);
                return (
                  <li
                    key={day.date}
                    className="calendar-day"
                    data-selected={String(selected)}
                    data-today={String(isToday)}
                  >
                    <button
                      type="button"
                      id={'calendar-day-' + day.date}
                      className="calendar-day-button"
                      aria-pressed={selected}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={dayNameText(day, dayEvents, isToday)}
                      tabIndex={
                        selected || (!gridHasSelection && index === 0) ? 0 : -1
                      }
                      onClick={() => setPickedDay(day.date)}
                      onKeyDown={(event) => moveDay(event, index)}
                    >
                      <time dateTime={day.date}>
                        {calendarDayNumber(day.date)}
                      </time>{' '}
                      {/* The separating whitespace keeps the visible words
                          tokenised, so the accessible name can start with the
                          same words (WCAG 2.5.3). It creates no flex item. */}
                      <span className="calendar-day-markers" aria-hidden="true">
                        {isToday && (
                          <>
                            <span className="calendar-day-today">
                              Heute
                            </span>{' '}
                          </>
                        )}
                        {dayEvents.length > 1 && (
                          <>
                            <span className="calendar-day-count">
                              {dayEvents.length}
                            </span>{' '}
                          </>
                        )}
                        {statuses.map((status) => (
                          <StatusMark key={status} status={status} />
                        ))}
                      </span>
                    </button>
                    <ul className="calendar-day-events">
                      {dayEvents.map((event) => (
                        <li key={event.id}>{chip(event)}</li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </div>
          {loadedView === 'month' && agendaDate && (
            <section
              className="calendar-agenda"
              aria-labelledby="calendar-agenda-title"
            >
              <div className="calendar-agenda-head">
                <h4 id="calendar-agenda-title">
                  {calendarDayLabel(agendaDate)}
                </h4>
                <p className="calendar-agenda-count" role="status">
                  {agendaEvents.length === 1
                    ? '1 Event'
                    : agendaEvents.length + ' Events'}
                </p>
              </div>
              {agendaEvents.length ? (
                <ul className="calendar-agenda-list">
                  {agendaEvents.map((event) => (
                    <li className="calendar-agenda-item" key={event.id}>
                      <p className="calendar-agenda-time calendar-note">
                        {eventScheduleText(event)}
                      </p>
                      <p className="calendar-agenda-title">
                        <a
                          href={'#event-' + event.id}
                          onClick={() => updateUrlSearch(emptyEventFilters)}
                        >
                          {event.name}
                        </a>
                      </p>
                      <p className="calendar-agenda-meta">
                        {labels[event.status] ?? event.status} ·{' '}
                        {event.eventType ?? 'Eventart offen'} ·{' '}
                        {event.location ?? 'Ort offen'} ·{' '}
                        {event.contact ?? 'Kontakt offen'}
                      </p>
                      <p className="calendar-agenda-resources">
                        Ressourcen: {resourcesText(event.id)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="calendar-agenda-empty">
                  Keine Events an diesem Tag.
                </p>
              )}
            </section>
          )}
          {/* H037: native, uncontrolled disclosure. The browser owns the
              open state, so mouse, keyboard, programmatic `open` and the
              `toggle` event all agree; the content stays mounted and is
              hidden by the native closed behaviour. Toggling is pure DOM
              work and never triggers a fetch. */}
          <details className="calendar-resources">
            <summary>Ressourcenbelegung</summary>
            <p className="calendar-hint">
              Zeitleiste je physischer Einheit mit Reservierungszeitraum,
              Puffern und Konflikten.
            </p>
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
                                  Einschließlich Puffer:{' '}
                                  {slotPeriod(slot.startsAt, slot.endsAt)}
                                </p>
                                <p>
                                  Basiszeitraum:{' '}
                                  {slotPeriod(slot.baseStart, slot.baseEnd)}
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
          </details>
        </>
      )}
    </section>
  );
}
