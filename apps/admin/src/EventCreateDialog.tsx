import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { localDateTime, resolveEventTime } from './event-time.js';
import { ContactDialog, contactDialogTitleId } from './ContactDialog.js';
import {
  ContactPicker,
  useContactSearch,
  type ContactHit,
} from './ContactPicker.js';
import { EventTimeField } from './EventTimeField.js';
import type { EventRow } from './EventPanel.js';
import {
  initialVenueText,
  venueMaxLength,
  venuePayload,
  type VenueChoice,
} from './venue.js';

type Choice = VenueChoice;
type Status = { code: string; label: string };
type ScheduleErrors = {
  startsAt?: string;
  endsAt?: string;
  eventDate?: string;
};

export function generatedEventName(
  eventTypeId: string,
  primaryContactId: string,
  types: Choice[],
  contacts: Choice[],
) {
  const type = types.find((choice) => choice.id === eventTypeId)?.name,
    contact = contacts.find((choice) => choice.id === primaryContactId)?.name;
  if (type && contact) return `${type} – ${contact}`;
  return type || contact || 'Neues Event';
}

/** The quiet second line of a hit: company form, person and town. */
export function EventCreateDialog({
  csrfToken,
  timeZone,
  statuses,
  types,
  packages,
  locations,
  contacts,
  initial,
  onClose,
  onCreated,
}: {
  csrfToken: string;
  timeZone: string;
  statuses: Status[];
  types: Choice[];
  packages: Choice[];
  locations: Choice[];
  contacts: Choice[];
  initial: EventRow | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDivElement>(null),
    saving = useRef(false),
    contactSearch = useContactSearch(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [eventDate, setEventDate] = useState(
      initial?.eventDate ??
        (initial?.startsAt
          ? localDateTime(initial.startsAt, timeZone).slice(0, 10)
          : ''),
    ),
    [dateDerived, setDateDerived] = useState(Boolean(initial?.startsAt)),
    [eventTypeId, setEventTypeId] = useState(initial?.eventTypeId ?? ''),
    [primaryContactId, setPrimaryContactId] = useState(
      initial?.primaryContactId ?? '',
    ),
    [pickedContact, setPickedContact] = useState<ContactHit | null>(null),
    [additionalContactIds, setAdditionalContactIds] = useState<string[]>(
      (initial?.additionalContactIds ?? []).filter(
        (id) => id !== (initial?.primaryContactId ?? ''),
      ),
    ),
    [name, setName] = useState(initial?.name ?? ''),
    [eventStatus, setEventStatus] = useState(initial?.status ?? 'inquiry'),
    [venue, setVenue] = useState(() =>
      initialVenueText(
        initial,
        locations.find((choice) => choice.id === initial?.locationId),
      ),
    ),
    [venueEdited, setVenueEdited] = useState(false),
    [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>({}),
    // The contact form is a view inside this dialog box, never a second one.
    [view, setView] = useState<'event' | 'contact'>('event'),
    [pickerFocus, setPickerFocus] = useState(0);
  // Locations may arrive after the dialog opened. Hydration only fills an
  // untouched field and never overwrites text the operator already entered.
  useEffect(() => {
    if (venueEdited) return;
    const next = initialVenueText(
      initial,
      locations.find((choice) => choice.id === initial?.locationId),
    );
    setVenue((current) => (current === next ? current : next));
  }, [initial, locations, venueEdited]);
  // A stored assignment stays readable even when it is not among the choices.
  const chosen: ContactHit | null = primaryContactId
    ? ((pickedContact?.id === primaryContactId
        ? pickedContact
        : contacts.find((choice) => choice.id === primaryContactId)) ?? null)
    : null;
  // The freshly stored contact is not part of the panel's list yet; the name
  // generation and the further contacts still have to know it.
  const contactChoices: Choice[] =
    chosen && !contacts.some((choice) => choice.id === chosen.id)
      ? [...contacts, chosen]
      : contacts;
  const generated = generatedEventName(
    eventTypeId,
    primaryContactId,
    types,
    contactChoices,
  );
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLInputElement>('input[name="eventDate"]')
      ?.focus();
  }, []);
  function clearContact() {
    setPrimaryContactId('');
    setPickedContact(null);
  }
  function chooseContact(row: ContactHit) {
    setPrimaryContactId(row.id);
    setPickedContact(row);
    setAdditionalContactIds((current) => current.filter((id) => id !== row.id));
  }
  function backToPicker() {
    setView('event');
    setPickerFocus((value) => value + 1);
  }
  function contactSaved(row: ContactHit) {
    // The stored row is the truth: the selection never depends on a list load.
    setPrimaryContactId(row.id);
    setPickedContact(row);
    setAdditionalContactIds((current) => current.filter((id) => id !== row.id));
    backToPicker();
    if (contactSearch.query.trim()) contactSearch.search(contactSearch.query);
  }
  function clearScheduleError(field: keyof ScheduleErrors) {
    setScheduleErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // While the contact view is open it owns Escape and Tab completely.
    if (view === 'contact') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (saving.current || busy) return;
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href]',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0]!,
      last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  async function save(form: HTMLFormElement) {
    if (saving.current) return;
    setMessage('');
    const data = new FormData(form),
      value = (key: string) => String(data.get(key) ?? ''),
      choice = (key: string) =>
        value(key) === 'later'
          ? ('later' as const)
          : value(key) === 'earlier'
            ? ('earlier' as const)
            : '';
    const [startTime, endTime] = [
      resolveEventTime(value('startsAt'), timeZone, {
        originalInstant: initial?.startsAt ?? null,
        choice: choice('startsAtChoice'),
      }),
      resolveEventTime(value('endsAt'), timeZone, {
        originalInstant: initial?.endsAt ?? null,
        choice: choice('endsAtChoice'),
      }),
    ];
    const times = [startTime, endTime];
    if (
      times.some(
        (time) => time.kind === 'nonexistent' || time.kind === 'invalid',
      )
    ) {
      setMessage(
        'Termin prüfen: Uhrzeit existiert am gewählten Tag nicht. Bitte Beginn und Ende anpassen.',
      );
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (times.some((time) => time.kind === 'ambiguous')) {
      setMessage(
        'Termin prüfen: Die Uhrzeit kommt an diesem Tag zweimal vor. Bitte für Beginn und Ende Sommerzeit oder Normalzeit wählen.',
      );
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const rawStart = value('startsAt'),
      rawEnd = value('endsAt');
    const errors: ScheduleErrors = {};
    if (rawStart && !rawEnd) errors.endsAt = 'Bitte auch das Ende angeben.';
    if (!rawStart && rawEnd) errors.startsAt = 'Bitte auch den Beginn angeben.';
    if (
      startTime.kind === 'unique' &&
      endTime.kind === 'unique' &&
      Date.parse(startTime.instant) >= Date.parse(endTime.instant)
    )
      errors.endsAt = 'Das Ende muss nach dem Beginn liegen.';
    if (Object.keys(errors).length) {
      setScheduleErrors(errors);
      const field = errors.startsAt
        ? 'startsAt'
        : errors.endsAt
          ? 'endsAt'
          : 'eventDate';
      form.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    setScheduleErrors({});
    const businessDate = rawStart
      ? rawStart.slice(0, 10)
      : value('eventDate') || null;
    const typeId = value('eventTypeId'),
      contactId = value('primaryContactId');
    const resolvedName = (
      name.trim() ||
      generatedEventName(typeId, contactId, types, contactChoices)
    ).slice(0, 200);
    saving.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/v1/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          name: resolvedName,
          status: eventStatus,
          eventTypeId: typeId || null,
          packageId: value('packageId') || null,
          locationId: initial?.locationId ?? null,
          ...(venueEdited
            ? venuePayload(venue, true)
            : initial?.venueOverride
              ? // Copying keeps the raw cleared value instead of inventing one.
                { venue: initial.venue, venueOverride: true }
              : {}),
          primaryContactId: contactId || null,
          additionalContactIds: data
            .getAll('additionalContactIds')
            .map(String)
            .filter((id) => id !== contactId),
          source: value('source'),
          eventDate: businessDate,
          startsAt: startTime.kind === 'unique' ? startTime.instant : null,
          endsAt: endTime.kind === 'unique' ? endTime.instant : null,
          description: value('description'),
          notesHtml: value('notesHtml'),
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          error.error === 'conflict'
            ? 'Inzwischen geändert. Bitte Eingaben prüfen und den aktuellen Stand neu laden.'
            : error.error === 'import_review_required'
              ? 'Ungeprüfte Bestandszusagen zuerst in der Import-Prüfliste abgleichen.'
              : error.error === 'reservations_need_review'
                ? 'Für diesen Termin gibt es Reservierungen. Änderungen müssen gemeinsam geprüft werden.'
                : 'Speichern fehlgeschlagen. Termin, Zuordnungen und Anmeldung prüfen.',
        );
        return;
      }
      await onCreated();
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? 'Termin prüfen: Bitte gültige Uhrzeiten für Beginn und Ende angeben.'
          : 'Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function options(choices: Choice[], current: string | string[] | null) {
    return choices.map((option) => (
      <option
        key={option.id}
        value={option.id}
        disabled={
          option.state !== 'active' &&
          !(Array.isArray(current)
            ? current.includes(option.id)
            : current === option.id)
        }
      >
        {option.name}
        {option.state === 'active' ? '' : ' (Archiviert/Inaktiv)'}
      </option>
    ));
  }
  return (
    <div className="event-create-backdrop">
      <div
        className="event-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={
          view === 'contact'
            ? contactDialogTitleId('event-create')
            : 'event-create-title'
        }
        ref={dialog}
        onKeyDown={onKeyDown}
      >
        <header className="event-create-header" hidden={view === 'contact'}>
          <div>
            <h2 id="event-create-title">Neues Event</h2>
            <p>
              Datum, Kunde oder Eventart genügen. Alles Weitere ist optional.
            </p>
          </div>
          <button
            type="button"
            className="tertiary-action event-create-close"
            aria-label="Dialog schließen"
            title="Dialog schließen"
            disabled={busy}
            onClick={() => {
              if (saving.current || busy) return;
              onClose();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <form
          hidden={view === 'contact'}
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
        >
          <fieldset disabled={busy || !timeZone}>
            <legend className="sr-only">Neues Event</legend>
            <label>
              Eventdatum
              <input
                name="eventDate"
                type="date"
                value={eventDate}
                readOnly={dateDerived}
                aria-invalid={Boolean(scheduleErrors.eventDate)}
                aria-describedby={
                  scheduleErrors.eventDate
                    ? 'event-create-date-help event-create-eventDate-error'
                    : 'event-create-date-help'
                }
                onChange={(event) => {
                  setEventDate(event.currentTarget.value);
                  clearScheduleError('eventDate');
                }}
              />
            </label>
            <p id="event-create-date-help">
              {dateDerived
                ? 'Wird aus dem Beginn übernommen. Um das Datum zu ändern, den Beginn ändern.'
                : 'Ohne Datum bleibt das Event undatiert. Uhrzeiten sind optional und stehen unter „Weitere Angaben“.'}
            </p>
            {scheduleErrors.eventDate && (
              <p
                className="field-error"
                id="event-create-eventDate-error"
                role="alert"
              >
                {scheduleErrors.eventDate}
              </p>
            )}
            <ContactPicker
              idPrefix="event-create"
              search={contactSearch}
              value={primaryContactId}
              selected={chosen}
              hiddenName="primaryContactId"
              disabled={busy}
              focusRequest={pickerFocus}
              onSelect={chooseContact}
              onClear={clearContact}
              onCreate={() => setView('contact')}
            />
            <label>
              Eventart
              <select
                name="eventTypeId"
                value={eventTypeId}
                onChange={(event) => setEventTypeId(event.currentTarget.value)}
              >
                <option value="">Eventart wählen</option>
                {options(types, eventTypeId || null)}
              </select>
            </label>
            <details className="event-advanced">
              <summary>Weitere Angaben</summary>
              <div className="event-advanced-fields">
                <label>
                  Eventname
                  <input
                    name="name"
                    maxLength={200}
                    value={name}
                    placeholder={generated}
                    aria-describedby="event-create-name-help"
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </label>
                <p id="event-create-name-help">
                  Ohne eigene Eingabe wird „{generated}“ als Name gespeichert.
                </p>
                <label>
                  Eventstatus
                  <select
                    name="status"
                    value={eventStatus}
                    onChange={(event) =>
                      setEventStatus(event.currentTarget.value)
                    }
                  >
                    {statuses.map((option) => (
                      <option
                        key={option.code}
                        value={option.code}
                        disabled={option.code === 'booked'}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fotobox-Paket
                  <select
                    name="packageId"
                    defaultValue={initial?.packageId ?? ''}
                  >
                    <option value="">Noch offen</option>
                    {options(packages, initial?.packageId ?? null)}
                  </select>
                </label>
                <label>
                  Ort / Adresse
                  <textarea
                    name="venue"
                    maxLength={venueMaxLength}
                    value={venue}
                    onChange={(event) => {
                      setVenue(event.currentTarget.value);
                      setVenueEdited(true);
                    }}
                  />
                </label>
                <label>
                  Anfragequelle
                  <input
                    name="source"
                    maxLength={200}
                    defaultValue={initial?.source ?? ''}
                  />
                </label>
                <label>
                  Weitere Kontakte
                  <select
                    name="additionalContactIds"
                    multiple
                    value={additionalContactIds}
                    onChange={(event) =>
                      setAdditionalContactIds(
                        Array.from(
                          event.currentTarget.selectedOptions,
                          (option) => option.value,
                        ),
                      )
                    }
                  >
                    {options(
                      contactChoices.filter(
                        (choice) => choice.id !== primaryContactId,
                      ),
                      additionalContactIds,
                    )}
                  </select>
                </label>
                <EventTimeField
                  name="startsAt"
                  label="Eventbeginn"
                  timeZone={timeZone}
                  idPrefix="event-create"
                  instant={initial?.startsAt ?? null}
                  error={scheduleErrors.startsAt}
                  onChange={(next) => {
                    setDateDerived(Boolean(next));
                    if (next) {
                      setEventDate(next.slice(0, 10));
                      clearScheduleError('eventDate');
                    }
                    clearScheduleError('startsAt');
                  }}
                />
                <EventTimeField
                  name="endsAt"
                  label="Eventende"
                  timeZone={timeZone}
                  idPrefix="event-create"
                  instant={initial?.endsAt ?? null}
                  error={scheduleErrors.endsAt}
                  onChange={() => clearScheduleError('endsAt')}
                />
                <label>
                  Eventbeschreibung
                  <textarea
                    name="description"
                    maxLength={4000}
                    defaultValue={initial?.description ?? ''}
                  />
                </label>
                <label>
                  Interne Notizen
                  <textarea
                    name="notesHtml"
                    maxLength={20000}
                    defaultValue={initial?.notesHtml ?? ''}
                    aria-describedby="event-create-notes-help"
                  />
                </label>
                <p id="event-create-notes-help">
                  Einfache HTML-Formatierung: &lt;strong&gt;fett&lt;/strong&gt;,
                  &lt;em&gt;kursiv&lt;/em&gt; und &lt;a
                  href="https://…"&gt;Link&lt;/a&gt;.
                </p>
              </div>
            </details>
            {message && (
              <p className="field-error" role="alert">
                {message}
              </p>
            )}
            <div className="event-create-footer">
              <button className="primary-action">
                {busy ? 'Wird gespeichert …' : 'Event speichern'}
              </button>
            </div>
          </fieldset>
        </form>
        {view === 'contact' && (
          <ContactDialog
            inline
            csrfToken={csrfToken}
            idPrefix="event-create"
            discardMessage="Ungespeicherte Eingaben verwerfen und zur Eventanlage zurückkehren?"
            onClose={backToPicker}
            onSaved={contactSaved}
          />
        )}
      </div>
    </div>
  );
}
