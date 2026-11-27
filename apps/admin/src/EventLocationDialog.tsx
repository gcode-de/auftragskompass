import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ModalDialog } from './ModalDialog.js';
import { registerUnsavedChanges } from './unsaved-changes.js';
import type { VenueChoice } from './venue.js';

const addressFields = [
  ['street', 'Straße und Hausnummer', 200],
  ['postalCode', 'PLZ', 20],
  ['city', 'Ort', 120],
] as const;

export function EventLocationDialog({
  csrfToken,
  onClose,
  onCreated,
}: {
  csrfToken: string;
  onClose: () => void;
  onCreated: (location: VenueChoice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = useRef(false);
  const busyRef = useRef(false);
  useEffect(
    () =>
      registerUnsavedChanges(() => changed.current || busyRef.current, true),
    [],
  );

  function dismiss() {
    if (busyRef.current) return;
    if (changed.current && !window.confirm('Location-Entwurf verwerfen?'))
      return;
    onClose();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const fields = new FormData(event.currentTarget);
    const name = (fields.get('name') as string).trim();
    if (!name) {
      setError('Bitte einen Namen für die Location eingeben.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/locations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          name,
          ...Object.fromEntries(
            addressFields.map(([key]) => [
              key,
              (fields.get(key) as string).trim(),
            ]),
          ),
          country: (fields.get('country') as string).toUpperCase(),
          state: 'active',
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 403
            ? 'Du hast keine Berechtigung, Locations anzulegen.'
            : 'Location konnte nicht angelegt werden. Bitte versuche es erneut.',
        );
        return;
      }
      const location: VenueChoice = await response.json();
      if (!location.id) throw Error('Location response is missing the ID');
      changed.current = false;
      onCreated(location);
    } catch {
      setError(
        'Anlage nicht bestätigt. Bitte prüfe vor einem neuen Versuch, ob die Location bereits gespeichert wurde.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ModalDialog
      className="form-dialog event-location-dialog"
      aria-labelledby="event-location-dialog-title"
      busy={busy}
      onDismiss={dismiss}
    >
      <header className="form-dialog-header">
        <h2 id="event-location-dialog-title">Location anlegen</h2>
      </header>
      <form
        onChange={() => {
          changed.current = true;
        }}
        onSubmit={(event) => void create(event)}
        aria-busy={busy}
      >
        <fieldset disabled={busy} aria-label="Location-Daten">
          <label>
            Name
            <input name="name" required maxLength={200} autoFocus />
          </label>
          {addressFields.map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input name={key} maxLength={maxLength} />
            </label>
          ))}
          <label>
            Land (Ländercode)
            <input
              name="country"
              required
              defaultValue="DE"
              maxLength={2}
              pattern="[A-Za-z]{2}"
            />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="form-dialog-footer">
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={dismiss}
          >
            Abbrechen
          </button>
          <button type="submit" className="primary-action" disabled={busy}>
            {busy ? 'Wird angelegt …' : 'Anlegen und zuordnen'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
