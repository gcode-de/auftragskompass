import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useRecordAutosave } from './useRecordAutosave.js';
import { registerUnsavedChanges } from './unsaved-changes.js';
import { EventTimeField } from './EventTimeField.js';
import { localDateTime, resolveEventTime } from './event-time.js';
import {
  ContactPicker,
  contactHitLimit,
  contactLine,
  useContactSearch,
  type ContactHit,
} from './ContactPicker.js';
import {
  initialVenueText,
  venueMaxLength,
  venuePayload,
  type VenueChoice,
} from './venue.js';
import type { EventRow } from './EventPanel.js';

type Input = Pick<
  EventRow,
  | 'name'
  | 'status'
  | 'eventTypeId'
  | 'packageId'
  | 'locationId'
  | 'venue'
  | 'venueOverride'
  | 'primaryContactId'
  | 'additionalContactIds'
  | 'source'
  | 'eventDate'
  | 'startsAt'
  | 'endsAt'
  | 'description'
  | 'notesHtml'
>;
const inputKeys: (keyof Input)[] = [
  'name',
  'status',
  'eventTypeId',
  'packageId',
  'locationId',
  'venue',
  'venueOverride',
  'primaryContactId',
  'additionalContactIds',
  'source',
  'eventDate',
  'startsAt',
  'endsAt',
  'description',
  'notesHtml',
];
const editableLabels = {
  name: 'Eventname',
  eventDate: 'Eventdatum',
  startsAt: 'Eventbeginn',
  endsAt: 'Eventende',
  eventTypeId: 'Eventart',
  packageId: 'Fotobox-Paket',
  locationId: 'Gespeicherter Ort',
  venue: 'Individuelle Anschrift',
  venueOverride: 'Ortauswahl',
  source: 'Anfragequelle',
  description: 'Beschreibung',
  primaryContactId: 'Hauptkontakt',
  additionalContactIds: 'Weitere Kontakte',
} as const;
export function eventInput(row: EventRow): Input {
  return Object.fromEntries(inputKeys.map((key) => [key, row[key]])) as Input;
}
export function canonicalEventRow(row: EventRow): EventRow {
  return {
    ...eventInput(row),
    id: row.id,
    version: row.version,
    timeZone: row.timeZone,
  };
}
export function validEventRow(
  value: unknown,
  id: string,
  version?: number,
): value is EventRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<EventRow>,
    nullable = (item: unknown) => item === null || typeof item === 'string';
  return (
    row.id === id &&
    Number.isSafeInteger(row.version) &&
    (row.version ?? 0) >= 1 &&
    (version === undefined || row.version === version) &&
    typeof row.name === 'string' &&
    !!row.name.trim() &&
    row.name.length <= 200 &&
    ['inquiry', 'option', 'booked', 'unavailable', 'cancelled'].includes(
      row.status ?? '',
    ) &&
    [
      row.eventTypeId,
      row.packageId,
      row.locationId,
      row.venue,
      row.primaryContactId,
      row.eventDate,
      row.startsAt,
      row.endsAt,
    ].every(nullable) &&
    typeof row.venueOverride === 'boolean' &&
    Array.isArray(row.additionalContactIds) &&
    row.additionalContactIds.every((item) => typeof item === 'string') &&
    typeof row.source === 'string' &&
    typeof row.description === 'string' &&
    typeof row.notesHtml === 'string' &&
    typeof row.timeZone === 'string'
  );
}
export type ConfirmedContact = {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  mobile: string;
  role: string;
};
export type EventInlineSaveState = {
  status: 'idle' | 'saving' | 'paused' | 'checking' | 'review';
  error: string;
  dirty: boolean;
  notesHtml: string;
  confirmedNotesHtml: string;
  remoteNotesHtml: string | null;
};
export type EventInlineHandle = {
  adoptExternal: (row: EventRow) => boolean;
  commitNotes: (value: string) => void;
  getNotesValue: () => string;
  reconcile: () => void;
  useRemote: () => void;
  reapply: () => void;
};
export const EventInlineEditor = forwardRef<
  EventInlineHandle,
  {
    event: EventRow;
    csrfToken: string;
    types: VenueChoice[];
    packages: VenueChoice[];
    locations: VenueChoice[];
    contacts?: { id: string; name: string }[];
    locked: boolean;
    canEdit: () => boolean;
    onDirtyChange: (dirty: boolean) => void;
    onSaveStateChange?: (state: EventInlineSaveState) => void;
    onNotesReset?: (value: string) => void;
    onConfirmed: (
      row: EventRow,
      contact?: ContactHit,
      details?: ConfirmedContact[],
      known?: ContactHit[],
    ) => void;
  }
>(function EventInlineEditor(
  {
    event,
    csrfToken,
    types,
    packages,
    locations,
    contacts = [],
    locked,
    canEdit,
    onDirtyChange,
    onSaveStateChange,
    onNotesReset,
    onConfirmed,
  },
  ref,
) {
  const suppressed = useRef(false),
    dirtyCallback = useRef(onDirtyChange),
    saveStateCallback = useRef(onSaveStateChange),
    notesResetCallback = useRef(onNotesReset);
  dirtyCallback.current = onDirtyChange;
  saveStateCallback.current = onSaveStateChange;
  notesResetCallback.current = onNotesReset;
  const [invalid, setInvalid] = useState<string>('');
  const [schedule, setSchedule] = useState(() => ({
    eventDate: event.eventDate ?? '',
    startsAt: localDateTime(event.startsAt, event.timeZone),
    endsAt: localDateTime(event.endsAt, event.timeZone),
  }));
  const [scheduleKey, setScheduleKey] = useState(0);
  const [scheduleError, setScheduleError] = useState('');
  const scheduleDirty = useRef(false);
  const scheduleGroup = useRef<HTMLFieldSetElement>(null);
  const restoreScheduleFocus = useRef<string | null>(null);
  const scheduleRevision = useRef(0);
  const scheduleSubmission = useRef<{
    eventDate: string | null;
    startsAt: string | null;
    endsAt: string | null;
    revision: number;
  } | null>(null);
  const contactSearch = useContactSearch();
  const additionalSearch = useContactSearch();
  const additionalInput = useRef<HTMLInputElement>(null);
  const [knownContacts, setKnownContacts] = useState<ContactHit[]>([]);
  const latestRow = useRef(event);
  const remoteDetails = useRef<{
    version: number;
    contacts: ConfirmedContact[];
  } | null>(null);
  const removedContact = useRef<{ id: string; index: number } | null>(null);
  async function read(): Promise<EventRow> {
    const response = await fetch('/api/v1/events/' + event.id);
    if (!response.ok) throw Error('Event konnte nicht geladen werden.');
    const detail = (await response.json()) as {
      event?: unknown;
      contacts?: unknown;
    };
    if (!validEventRow(detail.event, event.id))
      throw Error('Event konnte nicht gelesen werden.');
    const contacts = detail.contacts;
    if (
      Array.isArray(contacts) &&
      contacts.every(
        (item) =>
          item &&
          [
            item.id,
            item.name,
            item.contactPerson,
            item.email,
            item.phone,
            item.mobile,
            item.role,
          ].every((value) => typeof value === 'string'),
      )
    )
      remoteDetails.current = { version: detail.event.version, contacts };
    else remoteDetails.current = null;
    latestRow.current = canonicalEventRow(detail.event);
    return latestRow.current;
  }
  async function write(input: Input, version: number): Promise<EventRow> {
    let response: Response;
    try {
      response = await fetch('/api/v1/events/' + event.id, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          ...input,
          additionalContactIds: input.additionalContactIds.filter(
            (id) => id !== input.primaryContactId,
          ),
          version,
        }),
      });
    } catch {
      throw Error(
        'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
    }
    if (!response.ok) {
      const failure: unknown = await response.json().catch(() => null);
      if (
        response.status === 409 &&
        failure &&
        typeof failure === 'object' &&
        'error' in failure &&
        failure.error === 'reservations_need_review'
      )
        throw Error(
          'Termin kann wegen bestehender Buchungen nicht verschoben werden. Bitte zuerst die Ressourcenzuweisung prüfen; es wurde nichts automatisch geändert.',
        );
      throw Error(
        response.status === 409
          ? 'Event wurde inzwischen geändert. Bitte Serverstand prüfen.'
          : 'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
    }
    const row: unknown = await response.json().catch(() => null);
    if (!validEventRow(row, event.id, version + 1))
      throw Error(
        'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
    latestRow.current = canonicalEventRow(row);
    return latestRow.current;
  }
  const save = useRecordAutosave<Input, EventRow>({
    initial: event,
    toInput: eventInput,
    write,
    read,
    rebasePatch: (patch, previous, current) => {
      if (!patch.additionalContactIds) return patch;
      const removed = new Set(
        previous.additionalContactIds.filter(
          (id) => !patch.additionalContactIds!.includes(id),
        ),
      );
      const added = patch.additionalContactIds.filter(
        (id) => !previous.additionalContactIds.includes(id),
      );
      return {
        ...patch,
        additionalContactIds: [
          ...current.additionalContactIds.filter((id) => !removed.has(id)),
          ...added.filter((id) => !current.additionalContactIds.includes(id)),
        ],
      };
    },
    onConfirmed: (row) => {
      const currentSchedule = scheduleSubmission.current;
      if (
        currentSchedule &&
        currentSchedule.eventDate === row.eventDate &&
        currentSchedule.startsAt === row.startsAt &&
        currentSchedule.endsAt === row.endsAt &&
        currentSchedule.revision === scheduleRevision.current
      ) {
        scheduleDirty.current = false;
        scheduleSubmission.current = null;
      }
      if (
        !scheduleDirty.current &&
        (schedule.eventDate !== (row.eventDate ?? '') ||
          schedule.startsAt !== localDateTime(row.startsAt, row.timeZone) ||
          schedule.endsAt !== localDateTime(row.endsAt, row.timeZone))
      ) {
        setSchedule({
          eventDate: row.eventDate ?? '',
          startsAt: localDateTime(row.startsAt, row.timeZone),
          endsAt: localDateTime(row.endsAt, row.timeZone),
        });
        setScheduleKey((value) => value + 1);
        setScheduleError('');
      }
      latestRow.current = row;
      const contact = knownContacts.find(
        (item) => item.id === row.primaryContactId,
      );
      const details =
        remoteDetails.current?.version === row.version
          ? remoteDetails.current.contacts
          : undefined;
      if (knownContacts.length)
        onConfirmed(row, contact, details, knownContacts);
      else if (details) onConfirmed(row, contact, details);
      else if (contact) onConfirmed(row, contact);
      else onConfirmed(row);
    },
  });
  function useRemote() {
    const row = save.remote;
    if (!row) return;
    scheduleSubmission.current = null;
    scheduleDirty.current = false;
    save.useRemote();
    setSchedule({
      eventDate: row.eventDate ?? '',
      startsAt: localDateTime(row.startsAt, row.timeZone),
      endsAt: localDateTime(row.endsAt, row.timeZone),
    });
    setScheduleKey((value) => value + 1);
    setScheduleError('');
    scheduleRevision.current += 1;
    notesResetCallback.current?.(row.notesHtml);
  }
  useImperativeHandle(ref, () => ({
    adoptExternal: (row) => {
      if (scheduleDirty.current) return false;
      scheduleSubmission.current = null;
      return save.adoptExternal(row);
    },
    commitNotes: (value) => {
      if (!canEdit()) return;
      save.setField('notesHtml', value);
      save.commitFields(['notesHtml']);
    },
    getNotesValue: () => save.values.notesHtml,
    reconcile: () => void save.reconcile(),
    useRemote,
    reapply: save.reapply,
  }));
  useEffect(() => {
    saveStateCallback.current?.({
      status: save.status,
      error: save.error,
      dirty: save.dirty,
      notesHtml: save.values.notesHtml,
      confirmedNotesHtml: save.confirmed.notesHtml,
      remoteNotesHtml: save.remote?.notesHtml ?? null,
    });
  }, [
    save.status,
    save.error,
    save.dirty,
    save.values.notesHtml,
    save.confirmed,
    save.remote,
  ]);
  useEffect(() => {
    onDirtyChange(save.dirty || scheduleDirty.current);
  });
  useEffect(() => {
    const name = restoreScheduleFocus.current;
    if (!name) return;
    restoreScheduleFocus.current = null;
    const target =
      scheduleGroup.current?.querySelector<HTMLElement>(`[name="${name}"]`) ??
      (name.endsWith('Choice')
        ? scheduleGroup.current?.querySelector<HTMLElement>(
            `[name="${name.slice(0, -'Choice'.length)}"]`,
          )
        : null);
    target?.focus();
  }, [scheduleKey]);
  useEffect(
    () =>
      registerUnsavedChanges(() => save.dirty || scheduleDirty.current, true),
    [save.dirty],
  );
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!scheduleDirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(() => () => dirtyCallback.current(false), []);
  type Field = keyof Input;
  function resetSchedule() {
    const current = save.values;
    setSchedule({
      eventDate: current.eventDate ?? '',
      startsAt: localDateTime(current.startsAt, event.timeZone),
      endsAt: localDateTime(current.endsAt, event.timeZone),
    });
    setScheduleKey((value) => value + 1);
    setScheduleError('');
    scheduleDirty.current = false;
    scheduleRevision.current += 1;
    dirtyCallback.current(save.dirty);
  }
  function commitSchedule(group: HTMLFieldSetElement) {
    if (!canEdit()) return;
    const startInput = group.querySelector<HTMLInputElement>(
        'input[name="startsAt"]',
      ),
      endInput = group.querySelector<HTMLInputElement>('input[name="endsAt"]'),
      startChoice = group.querySelector<HTMLSelectElement>(
        'select[name="startsAtChoice"]',
      ),
      endChoice = group.querySelector<HTMLSelectElement>(
        'select[name="endsAtChoice"]',
      ),
      startLocal = startInput?.value ?? '',
      endLocal = endInput?.value ?? '';
    if (Boolean(startLocal) !== Boolean(endLocal)) {
      scheduleSubmission.current = null;
      setScheduleError('Beginn und Ende müssen gemeinsam angegeben werden.');
      return;
    }
    const start = resolveEventTime(startLocal, event.timeZone, {
        originalInstant: save.values.startsAt,
        choice: (startChoice?.value ?? '') as 'earlier' | 'later' | '',
      }),
      end = resolveEventTime(endLocal, event.timeZone, {
        originalInstant: save.values.endsAt,
        choice: (endChoice?.value ?? '') as 'earlier' | 'later' | '',
      });
    if (
      (start.kind !== 'unique' && start.kind !== 'empty') ||
      (end.kind !== 'unique' && end.kind !== 'empty')
    ) {
      scheduleSubmission.current = null;
      setScheduleError(
        'Bitte gültige Uhrzeiten wählen; doppelte Herbstzeiten brauchen eine bewusste Auswahl.',
      );
      return;
    }
    const startsAt = start.kind === 'unique' ? start.instant : null,
      endsAt = end.kind === 'unique' ? end.instant : null;
    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
      scheduleSubmission.current = null;
      setScheduleError('Das Ende muss nach dem Beginn liegen.');
      return;
    }
    const eventDate = startLocal
      ? startLocal.slice(0, 10)
      : group.querySelector<HTMLInputElement>('input[name="eventDate"]')
          ?.value || null;
    if (
      eventDate === save.values.eventDate &&
      startsAt === save.values.startsAt &&
      endsAt === save.values.endsAt
    ) {
      scheduleDirty.current = false;
      scheduleSubmission.current = null;
      setScheduleError('');
      dirtyCallback.current(save.dirty);
      return;
    }
    scheduleSubmission.current = {
      eventDate,
      startsAt,
      endsAt,
      revision: scheduleRevision.current,
    };
    save.setField('eventDate', eventDate);
    save.setField('startsAt', startsAt);
    save.setField('endsAt', endsAt);
    save.commitFields(['eventDate', 'startsAt', 'endsAt']);
    setScheduleError('');
  }
  function field(keys: Field[], key: Field) {
    return {
      onChange: (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => {
        if (!canEdit()) return;
        onDirtyChange(true);
        setInvalid('');
        if (key === 'locationId') {
          save.setField('locationId', e.currentTarget.value || null);
          save.setField('venueOverride', false);
        } else if (key === 'venue') {
          const venue = venuePayload(e.currentTarget.value, true);
          save.setField('venue', venue.venue ?? '');
          save.setField('venueOverride', true);
        } else
          save.setField(
            key,
            (e.currentTarget.value ||
              (key === 'eventTypeId' || key === 'packageId'
                ? null
                : '')) as never,
          );
      },
      onBlur: (
        e: React.FocusEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => {
        if (suppressed.current) {
          suppressed.current = false;
          return;
        }
        if (!canEdit()) return;
        if (
          !e.currentTarget.checkValidity() ||
          (key === 'name' && !e.currentTarget.value.trim())
        ) {
          setInvalid(String(key));
          return;
        }
        setInvalid('');
        save.commitFields(keys);
      },
      onKeyDown: (
        e: React.KeyboardEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        suppressed.current = true;
        setInvalid('');
        save.cancelFields(keys);
        e.currentTarget.blur();
      },
    };
  }
  const choices = (rows: VenueChoice[], selected: string | null) =>
    rows
      .filter((row) => row.state === 'active' || row.id === selected)
      .map((row) => (
        <option key={row.id} value={row.id}>
          {row.name}
        </option>
      ));
  function chooseContact(hit: ContactHit | null) {
    if (!canEdit()) return;
    onDirtyChange(true);
    const additional = [...save.values.additionalContactIds];
    if (removedContact.current) {
      additional.splice(
        removedContact.current.index,
        0,
        removedContact.current.id,
      );
      removedContact.current = null;
    }
    const index = hit ? additional.indexOf(hit.id) : -1;
    if (hit && index >= 0) {
      additional.splice(index, 1);
      removedContact.current = { id: hit.id, index };
    }
    save.setField('primaryContactId', hit?.id ?? null);
    save.setField('additionalContactIds', additional);
    if (hit)
      setKnownContacts((current) => [
        ...current.filter((item) => item.id !== hit.id),
        hit,
      ]);
  }
  const selectedContact =
    knownContacts.find((item) => item.id === save.values.primaryContactId) ??
    (contacts.find((item) => item.id === save.values.primaryContactId)
      ? {
          ...contacts.find((item) => item.id === save.values.primaryContactId)!,
          state: 'unknown',
        }
      : null);
  const availableAdditional = additionalSearch.hits.filter(
    (hit) =>
      hit.id !== save.values.primaryContactId &&
      !save.values.additionalContactIds.includes(hit.id),
  );
  const place = locations.find((row) => row.id === save.values.locationId);
  const venue = initialVenueText(save.values, place);
  function displayValue(
    key: keyof typeof editableLabels,
    value: Input[keyof Input],
  ) {
    if (key === 'venueOverride')
      return value ? 'Individuelle Anschrift' : 'Gespeicherter Ort';
    const choices =
      key === 'eventTypeId'
        ? types
        : key === 'packageId'
          ? packages
          : key === 'locationId'
            ? locations
            : [];
    if (typeof value === 'string' && choices.length)
      return choices.find((choice) => choice.id === value)?.name ?? value;
    return value === null || value === '' ? 'Leer' : String(value);
  }
  return (
    <section aria-label="Eventstammdaten direkt bearbeiten">
      <h4>Eventstammdaten bearbeiten</h4>
      <p>
        Änderungen werden beim Verlassen eines Feldes gespeichert. Escape
        verwirft die aktuelle Eingabe.
      </p>
      <fieldset disabled={locked} className="event-inline-fields">
        <legend className="sr-only">Eventstammdaten</legend>
        <fieldset
          key={'schedule:' + scheduleKey}
          ref={scheduleGroup}
          aria-label="Termin"
          onChange={(event) => {
            const target = event.target;
            if (
              !(target instanceof HTMLInputElement) &&
              !(target instanceof HTMLSelectElement)
            )
              return;
            if (
              target instanceof HTMLSelectElement &&
              target.name.endsWith('Choice')
            ) {
              scheduleDirty.current = true;
              scheduleRevision.current += 1;
              dirtyCallback.current(true);
              return;
            }
            if (target.name === 'eventDate') {
              setSchedule((current) => ({
                ...current,
                eventDate: target.value,
              }));
            } else if (target.name === 'startsAt') {
              setSchedule((current) => ({
                ...current,
                startsAt: target.value,
                eventDate: target.value.slice(0, 10),
              }));
            } else if (target.name === 'endsAt') {
              setSchedule((current) => ({ ...current, endsAt: target.value }));
            }
            scheduleDirty.current = true;
            scheduleRevision.current += 1;
            dirtyCallback.current(true);
          }}
          onBlur={(event) => {
            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              return;
            if (scheduleDirty.current) commitSchedule(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            restoreScheduleFocus.current =
              event.target instanceof HTMLElement
                ? event.target.getAttribute('name')
                : null;
            save.cancelFields(['eventDate', 'startsAt', 'endsAt']);
            resetSchedule();
          }}
        >
          <legend>Termin</legend>
          <label>
            Eventdatum
            <input
              name="eventDate"
              type="date"
              value={schedule.eventDate}
              readOnly={Boolean(schedule.startsAt)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSchedule((current) => ({
                  ...current,
                  eventDate: value,
                }));
              }}
            />
          </label>
          <p className="event-panel-hint">
            Bei Beginn gilt das Startdatum. Ohne Uhrzeiten: Tagesbuchung oder
            ohne Datum.
          </p>
          <EventTimeField
            key={'start:' + scheduleKey}
            name="startsAt"
            label="Terminbeginn"
            timeZone={event.timeZone}
            instant={save.values.startsAt}
            idPrefix="event-inline-schedule"
            onChange={(value) => {
              setSchedule((current) => ({
                ...current,
                startsAt: value,
                eventDate: value.slice(0, 10),
              }));
              scheduleDirty.current = true;
              dirtyCallback.current(true);
            }}
          />
          <EventTimeField
            key={'end:' + scheduleKey}
            name="endsAt"
            label="Terminende"
            timeZone={event.timeZone}
            instant={save.values.endsAt}
            idPrefix="event-inline-schedule"
            onChange={(value) => {
              setSchedule((current) => ({ ...current, endsAt: value }));
              scheduleDirty.current = true;
              dirtyCallback.current(true);
            }}
          />
          <p className="event-panel-hint">
            Beginn und Ende gemeinsam oder gar nicht.
          </p>
          {scheduleError && <p role="alert">{scheduleError}</p>}
        </fieldset>
        <label>
          Eventname
          <input
            value={save.values.name}
            required
            maxLength={200}
            aria-invalid={invalid === 'name'}
            {...field(['name'], 'name')}
          />
        </label>
        <fieldset
          aria-label="Hauptkontakt"
          onBlur={(event) => {
            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              return;
            if (!canEdit()) return;
            removedContact.current = null;
            save.commitFields(['primaryContactId', 'additionalContactIds']);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            removedContact.current = null;
            save.cancelFields(['primaryContactId', 'additionalContactIds']);
            contactSearch.reset();
          }}
        >
          <legend>Hauptkontakt</legend>
          <ContactPicker
            search={contactSearch}
            idPrefix="event-inline"
            label="Hauptkontakt suchen"
            value={save.values.primaryContactId ?? ''}
            selected={selectedContact}
            hiddenName="primaryContactId"
            onSelect={chooseContact}
            onClear={() => chooseContact(null)}
          />
        </fieldset>
        <fieldset
          aria-label="Weitere Kontakte"
          onBlur={(event) => {
            if (
              event.currentTarget.contains(
                event.relatedTarget as Node | null,
              ) ||
              !canEdit()
            )
              return;
            save.commitFields(['additionalContactIds']);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            save.cancelFields(['additionalContactIds']);
            additionalSearch.reset();
          }}
        >
          <legend>Weitere Kontakte</legend>
          {save.values.additionalContactIds.length === 0 ? (
            <p>Keine weiteren Kontakte zugeordnet.</p>
          ) : (
            <ul>
              {save.values.additionalContactIds.map((id) => {
                const name =
                  knownContacts.find((item) => item.id === id)?.name ??
                  contacts.find((item) => item.id === id)?.name ??
                  'Zugeordneter Kontakt';
                return (
                  <li key={id}>
                    {name}{' '}
                    <button
                      type="button"
                      className="tertiary-action"
                      aria-label={`${name} entfernen`}
                      onClick={() => {
                        if (!canEdit()) return;
                        additionalInput.current?.focus();
                        onDirtyChange(true);
                        save.setField(
                          'additionalContactIds',
                          save.values.additionalContactIds.filter(
                            (item) => item !== id,
                          ),
                        );
                      }}
                    >
                      Entfernen
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <label>
            Weitere Kontakte suchen
            <input
              ref={additionalInput}
              type="search"
              maxLength={200}
              autoComplete="off"
              value={additionalSearch.query}
              onChange={(event) =>
                additionalSearch.search(event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
            />
          </label>
          {additionalSearch.state === 'loading' && (
            <p role="status">Kontakte werden gesucht …</p>
          )}
          {additionalSearch.state === 'failed' && (
            <p role="status">
              Kontakte konnten nicht gesucht werden. Die bisherige Auswahl
              bleibt bestehen.
            </p>
          )}
          {additionalSearch.state === 'ready' &&
            availableAdditional.length === 0 && (
              <p role="status">Keine weiteren Kontakte gefunden.</p>
            )}
          {save.values.additionalContactIds.length >= 50 && (
            <p role="status">Maximal 50 weitere Kontakte möglich.</p>
          )}
          <ul
            className="contact-picker-hits"
            aria-label="Weitere Kontakte gefunden"
          >
            {availableAdditional.slice(0, contactHitLimit).map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="contact-picker-hit"
                  disabled={
                    hit.state !== 'active' ||
                    save.values.additionalContactIds.length >= 50
                  }
                  onClick={() => {
                    if (!canEdit()) return;
                    additionalInput.current?.focus();
                    onDirtyChange(true);
                    setKnownContacts((current) => [
                      ...current.filter((item) => item.id !== hit.id),
                      hit,
                    ]);
                    save.setField('additionalContactIds', [
                      ...save.values.additionalContactIds,
                      hit.id,
                    ]);
                  }}
                >
                  <span className="contact-picker-name">{hit.name}</span>
                  <span className="contact-picker-detail">
                    {contactLine(hit)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        <label>
          Eventart
          <select
            value={save.values.eventTypeId ?? ''}
            {...field(['eventTypeId'], 'eventTypeId')}
          >
            <option value="">Noch offen</option>
            {choices(types, save.values.eventTypeId)}
          </select>
        </label>
        <label>
          Fotobox-Paket
          <select
            value={save.values.packageId ?? ''}
            {...field(['packageId'], 'packageId')}
          >
            <option value="">Noch offen</option>
            {choices(packages, save.values.packageId)}
          </select>
        </label>
        <label>
          Anfragequelle
          <input
            value={save.values.source}
            maxLength={200}
            {...field(['source'], 'source')}
          />
        </label>
        <label>
          Gespeicherter Ort
          <select
            value={save.values.locationId ?? ''}
            {...field(['locationId', 'venueOverride'], 'locationId')}
          >
            <option value="">Kein gespeicherter Ort</option>
            {choices(locations, save.values.locationId)}
          </select>
        </label>
        {save.values.locationId && save.values.venueOverride && (
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              if (!canEdit()) return;
              onDirtyChange(true);
              save.setField('venueOverride', false);
              save.commitFields(['venueOverride']);
            }}
          >
            Gespeicherten Ort verwenden
          </button>
        )}
        <label>
          Individuelle Anschrift
          <textarea
            value={venue}
            maxLength={venueMaxLength}
            {...field(['venue', 'venueOverride'], 'venue')}
          />
        </label>
        <label>
          Beschreibung
          <textarea
            value={save.values.description}
            maxLength={4000}
            {...field(['description'], 'description')}
          />
        </label>
      </fieldset>
      <p>
        Eine unveränderte Anschrift folgt dem gespeicherten Ort. Beim Bearbeiten
        wird sie als individuelle Anschrift gespeichert.
      </p>
      {invalid && <p role="alert">Bitte das markierte Feld prüfen.</p>}
      <p role="status">
        {save.status === 'saving'
          ? 'Wird gespeichert …'
          : save.status === 'checking'
            ? 'Aktueller Stand wird geladen …'
            : save.status === 'idle'
              ? save.dirty
                ? 'Eingaben noch nicht gespeichert.'
                : 'Alle Änderungen gespeichert.'
              : ''}
      </p>
      {save.status === 'paused' && (
        <div role="alert">
          <p>{save.error}</p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => void save.reconcile()}
          >
            Aktuellen Stand laden
          </button>
        </div>
      )}
      {save.status === 'review' && save.remote && (
        <div>
          <p>
            Der aktuelle Stand unterscheidet sich von deiner Eingabe. Bitte
            auswählen:
          </p>
          <dl>
            {(Object.keys(editableLabels) as (keyof typeof editableLabels)[])
              .filter(
                (key) =>
                  JSON.stringify(save.values[key]) !==
                  JSON.stringify(save.remote![key]),
              )
              .map((key) => (
                <div key={key}>
                  <dt>{editableLabels[key]}</dt>
                  <dd>
                    Deine Eingabe: {displayValue(key, save.values[key])};
                    Serverstand: {displayValue(key, save.remote![key])}
                  </dd>
                </div>
              ))}
          </dl>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              if (window.confirm('Deine ungespeicherten Änderungen verwerfen?'))
                useRemote();
            }}
          >
            Serverstand übernehmen
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={save.reapply}
          >
            Meine abgeschlossenen Änderungen anwenden
          </button>
        </div>
      )}
    </section>
  );
});
