import { useEffect, useRef, useState } from 'react';
import { useRecordAutosave } from './useRecordAutosave.js';
import type { Contact } from './ContactDialog.js';

type Input = Omit<Contact, 'id' | 'version'>;
const fields = [
  ['name', 'Name / Firma', 200],
  ['contactPerson', 'Ansprechpartner', 200],
  ['street', 'Straße und Hausnummer', 200],
  ['postalCode', 'Postleitzahl', 20],
  ['city', 'Ort', 120],
  ['country', 'Ländercode', 2],
  ['email', 'E-Mail-Adresse', 254],
  ['phone', 'Festnetz', 60],
  ['mobile', 'Mobilnummer', 60],
] as const;
const keys: (keyof Input)[] = ['kind', ...fields.map(([key]) => key), 'state'];
function toInput(row: Contact): Input {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Input;
}
function validContact(value: unknown, id: string): value is Contact {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Contact>;
  return (
    row.id === id &&
    Number.isSafeInteger(row.version) &&
    (row.version ?? 0) >= 1 &&
    (row.kind === 'private' || row.kind === 'company') &&
    (row.state === 'active' || row.state === 'archived') &&
    fields.every(
      ([key, , max]) => typeof row[key] === 'string' && row[key]!.length <= max,
    ) &&
    !!row.name?.trim() &&
    /^[A-Z]{2}$/.test(row.country ?? '') &&
    /^\s*$|^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$/.test(row.email ?? '') &&
    /^[+0-9() ./-]*$/.test(row.phone ?? '') &&
    /^[+0-9() ./-]*$/.test(row.mobile ?? '')
  );
}
export function ContactInlineEditor({
  contact,
  csrfToken,
  onConfirmed,
  onDirtyChange,
}: {
  contact: Contact;
  csrfToken: string;
  onConfirmed: (row: Contact) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const suppressed = useRef<keyof Input | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const [invalid, setInvalid] = useState<Partial<Record<keyof Input, boolean>>>(
    {},
  );
  function clearInvalid(key: keyof Input) {
    setInvalid((current) => ({ ...current, [key]: false }));
  }
  async function read(): Promise<Contact> {
    const response = await fetch('/api/v1/contacts/' + contact.id);
    if (!response.ok)
      throw Error('Der aktuelle Kontaktstand konnte nicht geladen werden.');
    const result: unknown = await response.json();
    if (!validContact(result, contact.id))
      throw Error('Der aktuelle Kontaktstand konnte nicht gelesen werden.');
    return result;
  }
  async function write(input: Input, version: number): Promise<Contact> {
    const cleaned = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value.trim()]),
    ) as Input;
    let response: Response;
    try {
      response = await fetch('/api/v1/contacts/' + contact.id, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ ...cleaned, version }),
      });
    } catch {
      throw Error(
        'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
    }
    if (!response.ok)
      throw Error(
        response.status === 409
          ? 'Kontakt wurde inzwischen geändert. Bitte Serverstand prüfen.'
          : 'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
    const result: unknown = await response.json().catch(() => null);
    if (!validContact(result, contact.id) || result.version !== version + 1)
      throw Error(
        'Speichern nicht bestätigt. Bitte Serverstand prüfen, bevor du erneut speicherst.',
      );
    return result;
  }
  const save = useRecordAutosave<Input, Contact>({
    initial: contact,
    toInput,
    write,
    read,
    onConfirmed,
  });
  useEffect(() => {
    onDirtyChange?.(save.dirty);
  });
  useEffect(() => () => dirtyCallback.current?.(false), []);
  function handlers(key: keyof Input) {
    return {
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
      ) => {
        save.setField(key, event.currentTarget.value);
        onDirtyChange?.(true);
        clearInvalid(key);
      },
      onBlur: (
        event: React.FocusEvent<HTMLInputElement | HTMLSelectElement>,
      ) => {
        if (suppressed.current === key) {
          suppressed.current = null;
          return;
        }
        const value = event.currentTarget.value;
        if (
          !event.currentTarget.checkValidity() ||
          (key === 'name' && !value.trim()) ||
          (key === 'country' && !/^[A-Z]{2}$/.test(value)) ||
          (key === 'email' &&
            !/^\s*$|^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$/.test(value)) ||
          ((key === 'phone' || key === 'mobile') &&
            !/^[+0-9() ./-]*$/.test(value))
        ) {
          setInvalid((current) => ({ ...current, [key]: true }));
          return;
        }
        clearInvalid(key);
        save.commitFields([key]);
      },
      onKeyDown: (
        event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
      ) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        suppressed.current = key;
        clearInvalid(key);
        save.cancelFields([key]);
        event.currentTarget.blur();
      },
    };
  }
  return (
    <section aria-label="Kontaktdaten direkt bearbeiten">
      <h3>Kontaktdaten bearbeiten</h3>
      <p>
        Änderungen werden beim Verlassen eines Feldes gespeichert. Escape
        verwirft die aktuelle Eingabe.
      </p>
      <div className="contact-inline-fields">
        <label>
          Kontaktart{' '}
          <select value={save.values.kind} {...handlers('kind')}>
            <option value="private">Privatperson</option>
            <option value="company">Firma</option>
          </select>
        </label>
        {fields.map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              value={save.values[key]}
              maxLength={max}
              required={key === 'name' || key === 'country'}
              aria-invalid={Boolean(invalid[key])}
              aria-describedby={
                invalid[key] ? 'contact-inline-invalid' : undefined
              }
              {...handlers(key)}
            />
          </label>
        ))}
        <label>
          Kontaktzustand{' '}
          <select value={save.values.state} {...handlers('state')}>
            <option value="active">Aktiv</option>
            <option value="archived">Archiviert</option>
          </select>
        </label>
      </div>
      {Object.values(invalid).some(Boolean) && (
        <p id="contact-inline-invalid" role="alert">
          Bitte die markierten Felder prüfen.
        </p>
      )}
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
          <p>
            {save.error ||
              'Die Änderung konnte nicht bestätigt werden. Eingaben bleiben erhalten.'}
          </p>
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
        <div className="contact-inline-conflicts">
          <p>
            Der aktuelle Stand unterscheidet sich von deiner Eingabe. Bitte
            auswählen:
          </p>
          <dl>
            {keys
              .filter((key) => save.values[key] !== save.remote![key])
              .map((key) => (
                <div key={key}>
                  <dt>
                    {fields.find(([field]) => field === key)?.[1] ??
                      (key === 'kind' ? 'Kontaktart' : 'Kontaktzustand')}
                  </dt>
                  <dd>
                    Deine Eingabe: {save.values[key] || 'Leer'}; Serverstand:{' '}
                    {save.remote![key] || 'Leer'}
                  </dd>
                </div>
              ))}
          </dl>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              if (
                window.confirm('Deine ungespeicherten Änderungen verwerfen?')
              ) {
                setInvalid({});
                save.useRemote();
              }
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
}
