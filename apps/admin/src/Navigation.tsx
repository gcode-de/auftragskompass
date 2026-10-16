import {
  useUrlSearch,
  updateUrlSearch,
  emptyEventFilters,
} from './url-state.js';
export function Navigation() {
  const search = useUrlSearch(),
    q = new URLSearchParams(search).get('q') ?? '';
  return (
    <>
      <nav aria-label="Hauptnavigation">
        {[
          ['events', 'Events'],
          ['calendar', 'Kalender'],
          ['contacts', 'Kontakte'],
          ['locations', 'Locations'],
          ['products', 'Produkte'],
          ['resources', 'Ressourcen'],
          ['settings', 'Einstellungen'],
        ].map(([id, label]) => (
          <a key={id} href={'#' + id}>
            {label}{' '}
          </a>
        ))}
      </nav>
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
    </>
  );
}
