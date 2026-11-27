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
import { ThemeToggle } from './ThemeToggle.js';
import { resourceSettingsEvent } from './resource-settings-event.js';
import {
  discardForHomeMessage,
  discardForSearchMessage,
  confirmNavigation,
  installUnsavedNavigationGuard,
} from './unsaved-changes.js';

function sidebarPreference(): boolean {
  try {
    return localStorage.getItem('ak-sidebar-icon-rail') !== 'expanded';
  } catch {
    return true;
  }
}

const links = [
  [
    'events',
    'Events',
    'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
  ],
  [
    'resources',
    'Ressourcen',
    'M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM5 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm14 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM9.5 8 7 14m7.5-6 2.5 6M8 17h8',
  ],
  [
    'documents',
    'Dokumente',
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm-1 1v4h4M9 13h6m-6 3h6',
  ],
  [
    'contacts',
    'Kontakte',
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-8a4 4 0 0 1 0 8',
  ],
  ['settings', 'Einstellungen', 'M4 7h16M4 17h16M8 4v6m8 4v6'],
] as const;
// UI-PARITY-01: the settings follow Bookitup's grouping (observed
// 24.11.2026): single areas and named groups that open on their own page.
// Labels name what AuftragsKompass actually offers, not Bookitup's extras.
type SettingsLink = readonly [hash: string, label: string];
const settingsGroups: readonly (
  | { label: null; links: readonly SettingsLink[] }
  | { label: string; links: readonly SettingsLink[] }
)[] = [
  { label: null, links: [['settings', 'Stammdaten']] },
  {
    label: 'Integrationen',
    links: [
      ['settings-calendar', 'Kalender-Abos'],
      ['settings-telegram', 'Telegram'],
      ['settings-inquiry', 'Website-Formular'],
      ['settings-website', 'Website-Eingänge'],
    ],
  },
  { label: null, links: [['settings-resources', 'Ressourcen']] },
  {
    label: 'E-Mail',
    links: [
      ['settings-mail-templates', 'Vorlagen'],
      ['settings-mail', 'Ein- & Ausgangsserver'],
      ['settings-mail-signatures', 'Signatur'],
    ],
  },
  {
    label: 'Dokumente',
    links: [
      ['settings-templates', 'Dokument-Vorlagen'],
      ['settings-products', 'Produkte'],
      ['settings-document-layout', 'Dokument-Layout'],
      ['settings-numbers', 'Nummernkreise'],
      // UI-BKP-09: the file library is rarely needed; like Bookitup it lives
      // in the settings instead of the main menu.
      ['settings-files', 'Dateibibliothek'],
    ],
  },
  {
    label: 'Daten',
    links: [
      ['import-review', 'Datenimport'],
      ['settings-export', 'Datenexport'],
    ],
  },
  { label: null, links: [['settings-security', 'Passwort & Account']] },
];
export type WorkspaceRoute =
  | (typeof links)[number][0]
  | 'calendar'
  | 'subscriptions'
  | 'telegram'
  | 'mail'
  | 'mail-templates'
  | 'mail-signatures'
  | 'import'
  | 'security'
  | 'inquiry'
  | 'export'
  | 'templates'
  | 'document-layout'
  | 'numbers'
  | 'search'
  | 'files'
  | 'resources'
  | 'resource-settings'
  | 'products'
  | 'website';
export const settingsRoutes: ReadonlySet<WorkspaceRoute> = new Set([
  'settings',
  'subscriptions',
  'telegram',
  'mail',
  'mail-templates',
  'mail-signatures',
  'import',
  'security',
  'export',
  'inquiry',
  'templates',
  'document-layout',
  'numbers',
  // RES-BKP-01: the resource page is a main area; only its settings are here.
  'resource-settings',
  'products',
  'website',
  'files',
]);
export function isSettingsRoute(route: WorkspaceRoute) {
  return settingsRoutes.has(route);
}
const settingsHashes = {
  settings: 'settings',
  subscriptions: 'settings-calendar',
  telegram: 'settings-telegram',
  mail: 'settings-mail',
  'mail-templates': 'settings-mail-templates',
  'mail-signatures': 'settings-mail-signatures',
  import: 'import-review',
  security: 'settings-security',
  export: 'settings-export',
  inquiry: 'settings-inquiry',
  templates: 'settings-templates',
  'document-layout': 'settings-document-layout',
  numbers: 'settings-numbers',
  'resource-settings': 'settings-resources',
  products: 'settings-products',
  website: 'settings-website',
  files: 'settings-files',
} satisfies Partial<Record<WorkspaceRoute, string>>;
function readRoute(): WorkspaceRoute {
  const hash = window.location.hash.slice(1);
  // H034: locations are no longer a separate area; the old deep link leads to
  // the events overview instead of a blank or hidden master-data page.
  if (hash === 'locations') return 'events';
  if (hash === 'calendar') return 'calendar';
  if (hash === 'resources') return 'resources';
  if (hash === 'products') return 'products';
  if (hash === 'settings-resources') return 'resource-settings';
  if (hash === 'settings-products') return 'products';
  if (hash === 'settings-website') return 'website';
  if (hash === 'import-review') return 'import';
  if (hash === 'settings-calendar') return 'subscriptions';
  if (hash === 'settings-telegram') return 'telegram';
  if (hash === 'settings-mail') return 'mail';
  if (hash === 'settings-mail-templates') return 'mail-templates';
  if (hash === 'settings-mail-signatures') return 'mail-signatures';
  if (hash === 'settings-inquiry') return 'inquiry';
  if (hash === 'settings-export') return 'export';
  if (hash === 'settings-security') return 'security';
  if (hash === 'settings-templates') return 'templates';
  if (hash === 'settings-document-layout') return 'document-layout';
  if (hash === 'settings-numbers') return 'numbers';
  if (hash.startsWith('event-')) return 'events';
  if (hash.startsWith('contact-')) return 'contacts';
  if (hash.startsWith('resource-')) return 'resources';
  if (hash === 'search') return 'search';
  // `#files` stays a working old address of the library.
  if (hash === 'files' || hash === 'settings-files') return 'files';
  return links.find(([id]) => id === hash)?.[0] ?? 'events';
}
// H034: `#locations` is retired. Rewriting it keeps the address honest without
// a reload, a new history entry or losing the query, on cold start and on any
// later hashchange/popstate.
function normalizeLocationsHash() {
  if (window.location.hash !== '#locations') return;
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search + '#events',
  );
}
export function useWorkspaceRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    normalizeLocationsHash();
  }, []);
  useEffect(() => {
    const changed = () => {
      normalizeLocationsHash();
      setRoute(readRoute());
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    changed();
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, []);
  return route;
}
export function SettingsNavigation() {
  const route = useWorkspaceRoute();
  const current = settingsHashes[route as keyof typeof settingsHashes];
  const selected = '#' + (current ?? 'settings');
  return (
    <nav className="settings-navigation" aria-label="Einstellungen">
      <div className="settings-navigation-links">
        {settingsGroups.map((group) => {
          const links = group.links.map(([hash, label]) => (
            <a
              key={hash}
              href={'#' + hash}
              aria-current={hash === current ? 'page' : undefined}
            >
              {label}
            </a>
          ));
          if (!group.label) return links;
          // Simplified from Bookitup's folding groups: always open, so no
          // area costs an extra click; the heading still names the group.
          return (
            <div
              key={group.label}
              className="settings-navigation-group"
              role="group"
              aria-label={group.label}
            >
              <span className="settings-navigation-group-label">
                {group.label}
              </span>
              {links}
            </div>
          );
        })}
      </div>
      <label className="settings-navigation-select">
        Einstellungsbereich
        <select
          aria-label="Einstellungsbereich"
          value={selected}
          onChange={(event) => {
            window.location.hash = event.target.value;
          }}
        >
          {settingsGroups.map((group) => {
            const options = group.links.map(([hash, label]) => (
              <option key={hash} value={'#' + hash}>
                {label}
              </option>
            ));
            return group.label ? (
              <optgroup key={group.label} label={group.label}>
                {options}
              </optgroup>
            ) : (
              options
            );
          })}
        </select>
      </label>
    </nav>
  );
}
// RES-BKP-01: the resource settings may hide the main entry; a change in the
// settings is announced without a reload.
function useHiddenResources() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let current = true;
    const read = () =>
      void fetch('/api/v1/settings/resources')
        .then((response) => (response.ok ? response.json() : null))
        .then((value: { hideNavigation?: boolean } | null) => {
          if (current && value) setHidden(value.hideNavigation === true);
        })
        .catch(() => {});
    read();
    window.addEventListener(resourceSettingsEvent, read);
    return () => {
      current = false;
      window.removeEventListener(resourceSettingsEvent, read);
    };
  }, []);
  return hidden;
}
export function Navigation({ account }: { account?: ReactNode }) {
  useEffect(installUnsavedNavigationGuard, []);
  const search = useUrlSearch(),
    q = new URLSearchParams(search).get('q') ?? '';
  const route = useWorkspaceRoute();
  const settings = isSettingsRoute(route);
  const activeRoute = settings
    ? 'settings'
    : route === 'calendar'
      ? 'events'
      : route;
  const hideResources = useHiddenResources();
  const title =
    route === 'search'
      ? 'Suchergebnisse'
      : route === 'calendar'
        ? 'Kalender'
        : links.find(([id]) => id === activeRoute)![1];
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
      if (event.key === 'ak-sidebar-icon-rail' || event.key === null)
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
      localStorage.setItem(
        'ak-sidebar-icon-rail',
        next ? 'collapsed' : 'expanded',
      );
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
      !confirmNavigation(discardForSearchMessage, '#search')
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
    if (!confirmNavigation(discardForHomeMessage, '#events'))
      event.preventDefault();
  }
  function brand() {
    return (
      <a
        className="menu-brand"
        href="#events"
        aria-label="AK – AuftragsKompass – zur Eventübersicht"
        title="AK – AuftragsKompass – zur Eventübersicht"
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
    );
  }
  function menu(showAccount = true) {
    return (
      <>
        <p className="menu-caption">Dein Büro für Events</p>
        <nav aria-label="Hauptnavigation">
          {links
            // RES-BKP-01: the switch hides the entry, never the open page.
            .filter(
              ([id]) => !(id === 'resources' && hideResources && route !== id),
            )
            .map(([id, label, path]) => (
              <a
                key={id}
                href={'#' + id}
                aria-label={label}
                title={label}
                aria-current={id === activeRoute ? 'page' : undefined}
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
        <p className="sidebar-version">Version {appVersionLabel}</p>
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
        <div className="sidebar-brand-row">
          {brand()}
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={
              collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'
            }
            title={
              collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'
            }
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
        </div>
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
        <h1 className="workspace-heading">
          <a
            className="workspace-title"
            href="#events"
            aria-label={`${title} – zur Eventübersicht`}
            onClick={followHome}
          >
            {title}
          </a>
        </h1>
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
                className="icon-action tier-quiet-icon"
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
                className="icon-action tier-quiet-icon"
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
              className="search-shortcut icon-action tier-quiet-icon"
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
        <ThemeToggle />
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
        {brand()}
        {menu(open)}
      </dialog>
    </>
  );
}
