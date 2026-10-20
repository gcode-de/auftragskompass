import {
  useEffect,
  useRef,
  useState,
  type FormEvent as ReactFormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  useUrlSearch,
  updateUrlSearch,
  emptyEventFilters,
} from './url-state.js';
import { appVersionLabel } from './revision.js';
import {
  discardForHomeMessage,
  discardForSearchMessage,
  hasUnsavedChanges,
} from './unsaved-changes.js';

function sidebarPreference(): boolean {
  try {
    return localStorage.getItem('ak-sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

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
  ['settings-templates', 'Dokumentvorlagen'],
  ['settings-numbers', 'Nummernkreise'],
  ['settings-security', 'Konto & Zugriff'],
] as const;
export type WorkspaceRoute =
  | (typeof links)[number][0]
  | 'subscriptions'
  | 'import'
  | 'security'
  | 'inquiry'
  | 'export'
  | 'templates'
  | 'numbers'
  | 'search';
function readRoute(): WorkspaceRoute {
  const hash = window.location.hash.slice(1);
  if (hash === 'import-review') return 'import';
  if (hash === 'settings-calendar') return 'subscriptions';
  if (hash === 'settings-inquiry') return 'inquiry';
  if (hash === 'settings-export') return 'export';
  if (hash === 'settings-security') return 'security';
  if (hash === 'settings-templates') return 'templates';
  if (hash === 'settings-numbers') return 'numbers';
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
    templates: 'settings-templates',
    numbers: 'settings-numbers',
  }[
    route as
      | 'settings'
      | 'subscriptions'
      | 'import'
      | 'security'
      | 'export'
      | 'inquiry'
      | 'templates'
      | 'numbers'
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
    'templates',
    'numbers',
  ].includes(route);
  const title =
    route === 'search'
      ? 'Suchergebnisse'
      : links.find(([id]) => id === (settings ? 'settings' : route))![1];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(sidebarPreference);
  const [searchOpen, setSearchOpen] = useState(() => readRoute() === 'search');
  const [searchDraft, setSearchDraft] = useState(q);
  const sidebar = useRef<HTMLElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const restoreSearchFocus = useRef(false);
  const sidebarHadFocus = useRef(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const viewport = window.matchMedia('(min-width: 901px)');
    const changed = () => {
      if (viewport.matches) {
        if (!dialog.current!.open) return;
        dialog.current!.close();
        setOpen(false);
        const current = sidebar.current!.querySelector<HTMLElement>(
          'a[aria-current="page"]',
        );
        (searchInput.current ?? current ?? searchTrigger.current)?.focus();
        return;
      }
      if (dialog.current?.open) return;
      if (
        sidebarHadFocus.current ||
        sidebar.current?.contains(document.activeElement)
      ) {
        sidebarHadFocus.current = false;
        trigger.current?.focus();
      }
    };
    viewport.addEventListener('change', changed);
    return () => viewport.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const focused = (event: FocusEvent) => {
      sidebarHadFocus.current = Boolean(
        sidebar.current?.contains(event.target as Node),
      );
    };
    document.addEventListener('focusin', focused);
    return () => document.removeEventListener('focusin', focused);
  }, []);
  useEffect(() => {
    const stored = (event: StorageEvent) => {
      if (event.key === 'ak-sidebar' || event.key === null)
        setCollapsed(sidebarPreference());
    };
    window.addEventListener('storage', stored);
    return () => window.removeEventListener('storage', stored);
  }, []);
  useEffect(() => {
    setSearchOpen(route === 'search');
  }, [route]);
  useEffect(() => {
    setSearchDraft(q);
  }, [q]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus({ preventScroll: true });
    else if (restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      searchTrigger.current?.focus({ preventScroll: true });
    }
  }, [searchOpen]);

  function closeMenu() {
    dialog.current!.close();
    setOpen(false);
    trigger.current?.focus();
  }
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('ak-sidebar', next ? 'collapsed' : 'expanded');
    } catch {
      /* Browser privacy settings may disable preference storage. */
    }
  }
  function closeSearch() {
    restoreSearchFocus.current = true;
    setSearchOpen(false);
  }
  function submitSearch(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      route !== 'search' &&
      hasUnsavedChanges() &&
      !window.confirm(discardForSearchMessage)
    )
      return;
    updateUrlSearch(
      { ...emptyEventFilters, q: searchDraft },
      route === 'search' ? undefined : 'search',
    );
    setSearchOpen(true);
  }
  function followHome(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (window.location.hash === '#events') {
      event.preventDefault();
      return;
    }
    if (hasUnsavedChanges() && !window.confirm(discardForHomeMessage))
      event.preventDefault();
  }
  function menu(showAccount = true) {
    return (
      <>
        <a
          className="menu-brand"
          href="#events"
          aria-label="AuftragsKompass – zur Eventübersicht"
          title="AuftragsKompass – zur Eventübersicht"
          onClick={(event) => {
            followHome(event);
            if (dialog.current?.open) closeMenu();
          }}
        >
          <span className="brand-name">AuftragsKompass</span>
          <span className="brand-mark" aria-hidden="true">
            AK
          </span>
        </a>
        <p className="menu-caption">Dein Büro für Events</p>
        <p className="menu-caption">Version {appVersionLabel}</p>
        <nav aria-label="Hauptnavigation">
          {links.map(([id, label, path]) => (
            <a
              key={id}
              href={'#' + id}
              aria-label={label}
              title={label}
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
              <span className="nav-label">{label}</span>
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
        className={'desktop-sidebar' + (collapsed ? ' collapsed' : '')}
        aria-label="Arbeitsbereiche"
      >
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={
            collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'
          }
          title={collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'}
          aria-expanded={!collapsed}
          onClick={toggleSidebar}
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
            <path d={collapsed ? 'M10 6l6 6-6 6' : 'M14 6l-6 6 6 6'} />
          </svg>
        </button>
        {menu()}
      </aside>
      <div className="workspace-toolbar">
        <button
          className="menu-trigger"
          aria-label="Menü öffnen"
          title="Menü öffnen"
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
        <a
          className="workspace-title"
          href="#events"
          aria-label={`${title} – zur Eventübersicht`}
          onClick={followHome}
        >
          {title}
        </a>
        <div className={'global-search-shell' + (searchOpen ? ' open' : '')}>
          {searchOpen ? (
            <form className="global-search" onSubmit={submitSearch}>
              <label className="sr-only" htmlFor="global-search-input">
                Globale Suche
              </label>
              <input
                id="global-search-input"
                ref={searchInput}
                type="search"
                name="q"
                maxLength={200}
                placeholder="Events und Kontakte suchen"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
              />
              <button
                type="submit"
                className="icon-action"
                aria-label="Events und Kontakte suchen"
                title="Events und Kontakte suchen"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m16 16 5 5" />
                </svg>
              </button>
              <button
                type="button"
                className="icon-action"
                aria-label="Suche schließen"
                title="Suche schließen"
                onClick={closeSearch}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </form>
          ) : (
            <button
              ref={searchTrigger}
              type="button"
              className="search-shortcut icon-action"
              aria-label="Suche öffnen"
              title="Suche öffnen"
              aria-expanded={false}
              onClick={() => {
                restoreSearchFocus.current = false;
                setSearchOpen(true);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m16 16 5 5" />
              </svg>
            </button>
          )}
        </div>
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
        <button
          className="menu-close"
          aria-label="Menü schließen"
          title="Menü schließen"
          onClick={closeMenu}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        {menu(open)}
      </dialog>
    </>
  );
}
