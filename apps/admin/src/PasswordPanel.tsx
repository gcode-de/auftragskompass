import { useState } from 'react';
export function PasswordPanel({
  csrfToken,
  onChanged,
  onSessionEnded,
}: {
  csrfToken: string;
  onChanged: () => void;
  onSessionEnded: () => void;
}) {
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function change() {
    if ([...newPassword].length < 15 || newPassword.length > 128) {
      setMessage('Bitte 15 Zeichen oder mehr verwenden (höchstens 128).');
      return;
    }
    if (newPassword !== confirmation) {
      setMessage('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/auth/password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.status === 401) {
        onSessionEnded();
        return;
      }
      if (!response.ok) {
        setMessage(
          'Änderung fehlgeschlagen. Aktuelles Passwort prüfen oder nach 15 Minuten erneut versuchen.',
        );
        return;
      }
      onChanged();
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setCurrent('');
      setNew('');
      setConfirmation('');
      setBusy(false);
    }
  }
  return (
    <section aria-label="Eigenes Passwort">
      <h2>Eigenes Passwort ändern</h2>
      <p>
        Mindestens 15 Zeichen. Bei Erfolg werden alle Sitzungen dieses Kontos
        beendet; bitte anschließend neu anmelden.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        <fieldset disabled={busy}>
          <legend>Passwort ändern</legend>
          <label>
            Aktuelles Passwort
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={currentPassword}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label>
            Neues Passwort
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNew(event.target.value)}
            />
          </label>
          <label>
            Neues Passwort wiederholen
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button>Passwort ändern</button>
        </fieldset>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
