import { EventPanel } from './EventPanel.js';
import { LocationPanel } from './LocationPanel.js';
import { ContactPanel } from './ContactPanel.js';
import { ProductPanel } from './ProductPanel.js';
import { ResourcePanel } from './ResourcePanel.js';
import { MasterDataSettings } from './MasterDataPanel.js';
import { AccessPanel } from './AccessPanel.js';
import { useEffect, useState } from 'react';
export type CurrentUser = { email: string; csrfToken: string };
export function AuthPanel() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState('Anmeldung wird geprüft …');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch('/auth/me')
      .then(async (response) => {
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
              : 'Google-Anmeldung ist noch nicht eingerichtet.',
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
    <section aria-label="Anmeldung">
      <p role="status">{status}</p>
      {user ? (
        <>
          <p>{user.email}</p>
          <EventPanel csrfToken={user.csrfToken} />
          <LocationPanel csrfToken={user.csrfToken} />
          <ContactPanel csrfToken={user.csrfToken} />
          <ProductPanel csrfToken={user.csrfToken} />
          <ResourcePanel csrfToken={user.csrfToken} />
          <MasterDataSettings csrfToken={user.csrfToken} />
          <AccessPanel
            csrfToken={user.csrfToken}
            onSessionEnded={() => {
              setUser(null);
              setReady(true);
              setStatus('Sitzung beendet. Bitte erneut anmelden.');
            }}
          />
          <button onClick={() => void logout()}>Abmelden</button>
        </>
      ) : ready ? (
        <a href="/auth/login">Mit Google anmelden</a>
      ) : null}
    </section>
  );
}
