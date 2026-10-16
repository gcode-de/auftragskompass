import { ImportPanel } from './ImportPanel.js';
import { CalendarPanel } from './CalendarPanel.js';
import { Navigation } from './Navigation.js';
import { EventPanel } from './EventPanel.js';
import { LocationPanel } from './LocationPanel.js';
import { ContactPanel } from './ContactPanel.js';
import { ProductPanel } from './ProductPanel.js';
import { ResourcePanel } from './ResourcePanel.js';
import { MasterDataSettings } from './MasterDataPanel.js';
import { PasswordPanel } from './PasswordPanel.js';
import { AccessPanel } from './AccessPanel.js';
import { useEffect, useState } from 'react';
export type CurrentUser = { email: string; csrfToken: string };
export function AuthPanel() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState('Anmeldung wird geprüft …');
  const [mode, setMode] = useState('google');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [importRevision, setImportRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void fetch('/auth/me')
      .then(async (response) => {
        if (active) setMode(response.headers.get('x-auth-mode') ?? 'google');
        if (response.ok) {
          const current = (await response.json()) as CurrentUser;
          if (active) {
            setUser(current);
            setStatus('Angemeldet');
          }
        } else if (active) {
          setReady(response.status === 401);
          setStatus(
            response.status === 401
              ? 'Bitte anmelden.'
              : 'Anmeldung ist noch nicht eingerichtet.',
          );
        }
      })
      .catch(() => {
        if (active)
          setStatus(
            'Anmeldung konnte nicht geprüft werden. Bitte Seite neu laden.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  async function login() {
    setBusy(true);
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      setPassword('');
      if (!response.ok) {
        setStatus(
          response.status === 429
            ? 'Zu viele Anfragen. Bitte später erneut versuchen.'
            : 'Anmeldung fehlgeschlagen. Zugangsdaten prüfen oder nach 15 Minuten erneut versuchen.',
        );
        return;
      }
      const current = await fetch('/auth/me');
      if (!current.ok) throw new Error('session');
      setUser((await current.json()) as CurrentUser);
      setStatus('Angemeldet');
    } catch {
      setPassword('');
      setStatus('Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': user!.csrfToken },
      });
      if (!response.ok) throw new Error('Logout failed');
      setUser(null);
      setReady(true);
      setStatus('Abgemeldet');
    } catch {
      setStatus('Abmelden fehlgeschlagen. Bitte erneut versuchen.');
    }
  }
  return (
    <section
      aria-label="Anmeldung"
      className={user ? 'workspace' : 'login-card'}
    >
      <p role="status">{status}</p>
      {user ? (
        <>
          <div className="account-bar">
            <p>{user.email}</p>
            <button onClick={() => void logout()}>Abmelden</button>
          </div>
          <Navigation />
          <EventPanel csrfToken={user.csrfToken} revision={importRevision} />
          <CalendarPanel key={importRevision} />
          <LocationPanel csrfToken={user.csrfToken} />
          <ContactPanel csrfToken={user.csrfToken} />
          <ProductPanel csrfToken={user.csrfToken} />
          <ResourcePanel csrfToken={user.csrfToken} />
          <section id="settings" aria-label="Einstellungen">
            <h2>Einstellungen</h2>
            <MasterDataSettings csrfToken={user.csrfToken} />
            <ImportPanel
              csrfToken={user.csrfToken}
              onImported={() => setImportRevision((value) => value + 1)}
            />
            {mode === 'password' && (
              <PasswordPanel
                csrfToken={user.csrfToken}
                onChanged={() => {
                  setUser(null);
                  setReady(true);
                  setStatus('Passwort geändert. Bitte erneut anmelden.');
                }}
                onSessionEnded={() => {
                  setUser(null);
                  setReady(true);
                  setStatus('Sitzung beendet. Bitte erneut anmelden.');
                }}
              />
            )}
            <AccessPanel
              passwordMode={mode === 'password'}
              csrfToken={user.csrfToken}
              onSessionEnded={() => {
                setUser(null);
                setReady(true);
                setStatus('Sitzung beendet. Bitte erneut anmelden.');
              }}
            />
          </section>
        </>
      ) : ready && mode === 'password' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          <label htmlFor="login-identifier">E-Mail oder Benutzername</label>
          <input
            id="login-identifier"
            autoComplete="username"
            required
            maxLength={254}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
          <label htmlFor="login-password">Passwort</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button disabled={busy}>Anmelden</button>
        </form>
      ) : ready ? (
        <a href="/auth/login">Mit Google anmelden</a>
      ) : null}
    </section>
  );
}
