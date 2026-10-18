import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  useUrlSearch,
  updateUrlSearch,
  emptyEventFilters,
} from './url-state.js';

const links = [
  [
    'events',
    'Events',
    'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
  ],
  [
    'calendar',
    'Kalender',
    'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 14h3m4 0h3m-10 3h3',
  ],
  [
    'contacts',
    'Kontakte',
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-8a4 4 0 0 1 0 8',
  ],
  ['resources', 'Ressourcen', 'M3 7h18v14H3ZM7 7V3h10v4m-7 4h4v4h-4Z'],
  ['products', 'Produkte', 'm3 7 9-5 9 5v10l-9 5-9-5ZM3 7l9 5 9-5m-9 5v10'],
  [
    'locations',
    'Locations',
    'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
  ['settings', 'Einstellungen', 'M4 7h16M4 17h16M8 4v6m8 4v6'],
] as const;
const settingsLinks = [
  ['settings', 'Stammdaten'],
  ['settings-calendar', 'Kalender-Abos'],
  ['import-review', 'Datenimport'],
  ['settings-export', 'Datenexport'],
  ['settings-inquiry', 'Website-Formular'],
  ['settings-security', 'Konto & Zugriff'],
] as const;
export type WorkspaceRoute =
  | (typeof links)[number][0]
  | 'subscriptions'
  | 'import'
  | 'security'
  | 'inquiry'
  | 'export'
  | 'search';
function readRoute(): WorkspaceRoute {
  const hash = window.location.hash.slice(1);
  if (hash === 'import-review') return 'import';
  if (hash === 'settings-calendar') return 'subscriptions';
  if (hash === 'settings-inquiry') return 'inquiry';
  if (hash === 'settings-export') return 'export';
  if (hash === 'settings-security') return 'security';
  if (hash.startsWith('event-')) return 'events';
  if (hash.startsWith('contact-')) return 'contacts';
  if (hash === 'search') return 'search';
  return links.find(([id]) => id === hash)?.[0] ?? 'events';
}
export function useWorkspaceRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const changed = () => setRoute(readRoute());
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, []);
  return route;
}
export function SettingsNavigation() {
  const route = useWorkspaceRoute();
  const current = {
    settings: 'settings',
    subscriptions: 'settings-calendar',
    import: 'import-review',
    security: 'settings-security',
    export: 'settings-export',
    inquiry: 'settings-inquiry',
  }[
    route as
      | 'settings'
      | 'subscriptions'
      | 'import'
      | 'security'
      | 'export'
      | 'inquiry'
  ];
  return (
    <nav className="settings-navigation" aria-label="Einstellungen">
      {settingsLinks.map(([hash, label]) => (
        <a
          key={hash}
          href={'#' + hash}
          aria-current={hash === current ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
export function Navigation({ account }: { account?: ReactNode }) {
  const search = useUrlSearch(),
    q = new URLSearchParams(search).get('q') ?? '';
  const route = useWorkspaceRoute();
  const settings = [
    'settings',
    'subscriptions',
    'import',
    'security',
    'export',
    'inquiry',
  ].includes(route);
  const title =
    route === 'search'
      ? 'Suchergebnisse'
      : links.find(([id]) => id === (settings ? 'settings' : route))![1];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const searchLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia('(min-width: 901px)');
    const changed = () => {
      if (!viewport.matches || !dialog.current!.open) return;
      dialog.current!.close();
      setOpen(false);
      const current = sidebar.current!.querySelector<HTMLElement>(
        'a[aria-current="page"]',
      );
      (current ?? searchLink.current!).focus();
    };
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);

  function closeMenu() {
    dialog.current!.close();
    setOpen(false);
    trigger.current?.focus();
  }
  function menu(showAccount = true) {
    return (
      <>
        <p className="menu-brand">AuftragsKompass</p>
        <p className="menu-caption">Dein Büro für Events</p>
        <nav aria-label="Hauptnavigation">
          {links.map(([id, label, path]) => (
            <a
              key={id}
              href={'#' + id}
              aria-current={
                id === (settings ? 'settings' : route) ? 'page' : undefined
              }
              onClick={() => {
                if (dialog.current?.open) closeMenu();
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={path} />
              </svg>
              {label}
            </a>
          ))}
        </nav>
        {showAccount && account && (
          <div className="menu-account">{account}</div>
        )}
      </>
    );
  }
  return (
    <>
      <aside
        ref={sidebar}
        className="desktop-sidebar"
        aria-label="Arbeitsbereiche"
      >
        {menu()}
      </aside>
      <div className="workspace-toolbar">
        <button
          className="menu-trigger"
          aria-label="Menü öffnen"
          ref={trigger}
          aria-haspopup="dialog"
          aria-controls="workspace-menu"
          aria-expanded={open}
          onClick={(event) => {
            dialog.current!.dataset.motion = event.detail
              ? 'pointer'
              : 'keyboard';
            dialog.current!.showModal();
            setOpen(true);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <p className="workspace-title">{title}</p>
        <a ref={searchLink} className="search-shortcut" href="#search">
          Suche
        </a>
      </div>
      <dialog
        id="workspace-menu"
        className="mobile-menu"
        ref={dialog}
        aria-label="Menü"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            closeMenu();
        }}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <button className="menu-close" onClick={closeMenu}>
          Menü schließen
        </button>
        {menu(open)}
      </dialog>
      <div hidden={route !== 'search'} className="search-panel">
        <h2>Globale Suche</h2>
        <p>
          Events und Kontakte nach einem gemeinsamen Suchbegriff durchsuchen.
        </p>
        <form
          className="global-search"
          key={q}
          onSubmit={(event) => {
            event.preventDefault();
            updateUrlSearch({
              ...emptyEventFilters,
              q: String(new FormData(event.currentTarget).get('q') ?? ''),
            });
          }}
        >
          <label>
            Globale Suche
            <input name="q" maxLength={200} defaultValue={q} />
          </label>
          <button>Events und Kontakte suchen</button>
        </form>
      </div>
    </>
  );
}
