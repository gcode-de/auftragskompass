import { ThemeToggle } from './ThemeToggle.js';
import { InquiryPreview } from './InquiryPreview.js';
import { ExportPanel } from './ExportPanel.js';
import { CalendarFeedsPanel } from './CalendarFeedsPanel.js';
import { TelegramSettingsPanel } from './TelegramSettingsPanel.js';
import { InquiryEmailSettingsPanel } from './InquiryEmailSettingsPanel.js';
import { MailAccountSettingsPanel } from './MailAccountSettingsPanel.js';
import { MailTemplatesPanel } from './MailTemplatesPanel.js';
import { ImportPanel } from './ImportPanel.js';
import { CalendarPanel } from './CalendarPanel.js';
import {
  Navigation,
  SettingsNavigation,
  isSettingsRoute,
  useWorkspaceRoute,
} from './Navigation.js';
import { EventPanel } from './EventPanel.js';
import { ContactPanel } from './ContactPanel.js';
import { FilesPanel } from './FilesPanel.js';
import { LibraryFiles } from './LibraryFiles.js';
import { ProductPanel } from './ProductPanel.js';
import { DocumentTemplatesPanel } from './DocumentTemplatesPanel.js';
import { DocumentNumbersPanel } from './DocumentNumbersPanel.js';
import { DocumentLayoutPanel } from './DocumentLayoutPanel.js';
import { ResourcePanel } from './ResourcePanel.js';
import { WebsiteInbox } from './WebsiteInbox.js';
import { UndeliveredMailNotice } from './EventMails.js';
import { MailSignaturesPanel } from './MailSignaturesPanel.js';
import { MasterDataSettings } from './MasterDataPanel.js';
import { PasswordPanel } from './PasswordPanel.js';
import { AccessPanel } from './AccessPanel.js';
import { useEffect, useState } from 'react';
export type CurrentUser = { email: string; csrfToken: string };
export function AuthPanel() {
  const route = useWorkspaceRoute();
  const inSettings = isSettingsRoute(route);
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
      // PERF-MENU-02: the shell reads the page from this direct child instead
      // of scanning every list below for the page's context column.
      data-route={user ? route : undefined}
    >
      {!user && (
        <>
          <div className="login-heading">
            <h1>Anmelden bei AuftragsKompass</h1>
            <ThemeToggle />
          </div>
          <p role="status">{status}</p>
        </>
      )}
      {user ? (
        <>
          <Navigation
            account={
              <div className="account-bar">
                <p
                  role="status"
                  className={
                    status === 'Angemeldet' ? 'session-ready' : undefined
                  }
                >
                  {status}
                </p>
                <p className="account-email">{user.email}</p>
                <button
                  className="icon-action tier-quiet-icon"
                  aria-label="Abmelden"
                  title="Abmelden"
                  onClick={() => void logout()}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h9" />
                  </svg>
                </button>
              </div>
            }
          />
          <UndeliveredMailNotice />
          <div
            className="workspace-page"
            hidden={route !== 'events' && route !== 'search'}
          >
            <EventPanel
              csrfToken={user.csrfToken}
              revision={importRevision}
              showHeading={route === 'search'}
            />
          </div>
          <div className="workspace-page" hidden={route !== 'documents'}>
            <FilesPanel active={route === 'documents'} documentsOnly />
          </div>
          <div className="workspace-page" hidden={route !== 'calendar'}>
            <CalendarPanel key={importRevision} />
          </div>
          <div
            className="workspace-page"
            hidden={route !== 'contacts' && route !== 'search'}
          >
            <ContactPanel
              csrfToken={user.csrfToken}
              showHeading={route === 'search'}
            />
          </div>
          {/* UI-BKP-14: like Bookitup the resources are a page of their own
              with a context column, not a box inside the settings frame. The
              route keeps its settings entry and hashes. */}
          <div className="workspace-page" hidden={route !== 'resources'}>
            <ResourcePanel csrfToken={user.csrfToken} />
          </div>
          <section
            id="settings"
            aria-label="Einstellungen"
            hidden={!inSettings || route === 'resources'}
          >
            <SettingsNavigation />
            <div hidden={route !== 'settings'}>
              <MasterDataSettings csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'products'}>
              <ProductPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'subscriptions'}>
              <CalendarFeedsPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'telegram'}>
              <TelegramSettingsPanel csrfToken={user.csrfToken} />
              <InquiryEmailSettingsPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'mail'}>
              <MailAccountSettingsPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'mail-templates'}>
              <MailTemplatesPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'mail-signatures'}>
              <MailSignaturesPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'import'}>
              <ImportPanel
                csrfToken={user.csrfToken}
                onImported={() => setImportRevision((value) => value + 1)}
              />
            </div>
            {route === 'inquiry' && <InquiryPreview />}
            {route === 'website' && (
              <WebsiteInbox
                csrfToken={user.csrfToken}
                onImported={async () => {
                  // The option appears in the normal event list; refresh it.
                  setImportRevision((value) => value + 1);
                }}
              />
            )}
            <div hidden={route !== 'templates'}>
              <DocumentTemplatesPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'numbers'}>
              <DocumentNumbersPanel csrfToken={user.csrfToken} />
            </div>
            <div hidden={route !== 'document-layout'}>
              <DocumentLayoutPanel
                csrfToken={user.csrfToken}
                active={route === 'document-layout'}
              />
            </div>
            <div hidden={route !== 'export'}>
              <ExportPanel />
            </div>
            {/* UI-BKP-09: the file library as a settings page; the business
                documents live under "Dokumente" only. */}
            <div hidden={route !== 'files'}>
              <LibraryFiles
                csrfToken={user.csrfToken}
                active={route === 'files'}
              />
            </div>
            <div hidden={route !== 'security'}>
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
            </div>
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
          <button className="primary-action" disabled={busy}>
            Anmelden
          </button>
        </form>
      ) : ready ? (
        <a href="/auth/login">Mit Google anmelden</a>
      ) : null}
    </section>
  );
}
