import { useEffect, useState } from 'react';
export const emptyEventFilters = {
  q: '',
  from: '',
  to: '',
  status: '',
  eventTypeId: '',
  undated: '',
};
export function useUrlSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const changed = () => setSearch(window.location.search);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return search;
}
export function updateUrlSearch(values: Record<string, string>, hash?: string) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const previousHash = url.hash;
  if (hash !== undefined) url.hash = hash;
  const hashChanged = url.hash !== previousHash;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (hashChanged) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function eventQuery(search: string) {
  const source = new URLSearchParams(search),
    result = new URLSearchParams();
  for (const key of Object.keys(emptyEventFilters)) {
    const value = source.get(key);
    if (value) result.set(key, value);
  }
  return result.size ? '?' + result.toString() : '';
}
