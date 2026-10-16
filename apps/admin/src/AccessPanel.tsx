import { useEffect, useState } from 'react';
export type Account = {
  id: string;
  email: string;
  active: boolean;
  claimed: boolean;
};
export function AccessPanel({
  csrfToken,
  passwordMode = false,
  onSessionEnded,
}: {
  csrfToken: string;
  passwordMode?: boolean;
  onSessionEnded?: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch('/api/v1/access');
    if (response.status === 401) onSessionEnded?.();
    if (!response.ok) throw new Error('load');
    setAccounts((await response.json()) as Account[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Freigaben konnten nicht geladen werden.'),
    );
  }, []);
  async function save(id?: string, active?: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        id ? `/api/v1/access/${id}` : '/api/v1/access',
        {
          method: id ? 'PATCH' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(id ? { active } : { email }),
        },
      );
      if (response.status === 401) onSessionEnded?.();
      if (!response.ok) {
        const result = (await response.json()) as { error: string };
        setMessage(
          result.error === 'last_administrator'
            ? 'Der letzte aktive Administrator darf nicht gesperrt werden.'
            : result.error === 'already_exists'
              ? 'Dieses Konto ist bereits eingetragen.'
              : 'Änderung fehlgeschlagen. Bitte Anmeldung und Eingabe prüfen.',
        );
        return;
      }
      setEmail('');
      await refresh();
      setMessage('Freigaben gespeichert.');
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Kontofreigaben">
      <h2>{passwordMode ? 'Kontozugriff' : 'Google-Konten freigeben'}</h2>
      <p>
        Freigegebene Konten erhalten Administratorzugriff. Sperren beendet alle
        Sitzungen des Kontos. Ein neu freigegebenes Konto muss sich erst
        anmelden, bevor es den letzten Administrator ersetzen kann.
      </p>
      {passwordMode ? (
        <p>
          Das lokale Inhaberkonto wird beim ersten Start eingerichtet. Weitere
          Passwortkonten sind noch nicht verfügbar.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor="access-email">Google-E-Mail-Adresse</label>
          <input
            id="access-email"
            type="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button disabled={busy}>Konto freigeben</button>
        </form>
      )}
      <p role="status">{message}</p>
      <ul>
        {accounts.map((account) => (
          <li key={account.id}>
            <span>
              {account.email} –{' '}
              {account.active
                ? account.claimed
                  ? 'Aktiv'
                  : 'Erste Anmeldung ausstehend'
                : 'Gesperrt'}
            </span>{' '}
            <button
              disabled={busy}
              aria-label={`${account.active ? 'Sperren' : 'Freigeben'}: ${account.email}`}
              onClick={() => void save(account.id, !account.active)}
            >
              {account.active ? 'Sperren' : 'Freigeben'}
            </button>
          </li>
        ))}
      </ul>
      <p>Notfallzugang ist deaktiviert.</p>
    </section>
  );
}
