import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useRecordAutosave } from './useRecordAutosave.js';
import {
  ContactPicker,
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
export type EventInlineHandle = { adoptExternal: (row: EventRow) => boolean };
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
    onConfirmed: (
      row: EventRow,
      contact?: ContactHit,
      details?: ConfirmedContact[],
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
    onConfirmed,
  },
  ref,
) {
  const suppressed = useRef(false),
    dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const [invalid, setInvalid] = useState<string>('');
  const contactSearch = useContactSearch();
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
          additionalContactIds: latestRow.current.additionalContactIds.filter(
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
    if (!response.ok)
      throw Error(
        response.status === 409
          ? 'Event wurde inzwischen geändert. Bitte Serverstand prüfen.'
          : 'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
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
    onConfirmed: (row) => {
      latestRow.current = row;
      const contact = knownContacts.find(
        (item) => item.id === row.primaryContactId,
      );
      const details =
        remoteDetails.current?.version === row.version
          ? remoteDetails.current.contacts
          : undefined;
      if (details) onConfirmed(row, contact, details);
      else if (contact) onConfirmed(row, contact);
      else onConfirmed(row);
    },
  });
  useImperativeHandle(ref, () => ({ adoptExternal: save.adoptExternal }));
  useEffect(() => {
    onDirtyChange(save.dirty);
  });
  useEffect(() => () => dirtyCallback.current(false), []);
  type Field = keyof Input;
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
                save.useRemote();
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
