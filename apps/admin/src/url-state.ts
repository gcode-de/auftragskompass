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
// `only` restricts a write to one namespace, so an area-specific reset can
// never erase the global search or another area's filters. Keys outside the
// namespace are dropped before anything is written.
export function updateUrlSearch(
  values: Record<string, string>,
  hash?: string,
  only?: readonly string[],
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (only && !only.includes(key)) continue;
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

// H035: Dateien keeps its own namespace, so global search, event filters and
// the calendar never collide with the file filters and a reset stays local.
export const filesKeys = ['df_kind', 'df_state', 'df_from', 'df_to'] as const;
const filesApiNames: Record<(typeof filesKeys)[number], string> = {
  df_kind: 'kind',
  df_state: 'state',
  df_from: 'from',
  df_to: 'to',
};
export const filesStatePattern = /^[a-z_]{1,20}$/;
export const filesDatePattern = /^\d{4}-\d{2}-\d{2}$/;
export function filesFilterQuery(search: string) {
  const source = new URLSearchParams(search),
    result = new URLSearchParams();
  for (const key of filesKeys) {
    const value = source.get(key) ?? '';
    const valid =
      key === 'df_from' || key === 'df_to'
        ? filesDatePattern.test(value)
        : filesStatePattern.test(value);
    if (valid) result.set(filesApiNames[key], value);
  }
  return result.size ? '?' + result.toString() : '';
}
export function filesPage(search: string, pageSize: number) {
  const raw = Number(new URLSearchParams(search).get('df_page') ?? '0'),
    page = Number.isInteger(raw) && raw > 0 ? raw : 0;
  return { page, offset: page * pageSize };
}

// One builder for the metadata request: filters first, then paging. The extra
// row is the caller's business; this helper never adds a count or a total.
export function filesRequest(
  search: string,
  pageSize: number,
  path = '/api/v1/documents',
) {
  const { offset } = filesPage(search, pageSize),
    filters = filesFilterQuery(search),
    params = new URLSearchParams({
      include: 'metadata',
      limit: String(pageSize + 1),
      offset: String(offset),
    });
  for (const [key, value] of new URLSearchParams(filters))
    params.set(key, value);
  return path + '?' + params.toString();
}

// H035: a document row links to its event. The target must actually be listed
// there, so the Event filter namespace (`q`, dates, status, art, undated) is
// cleared while Dateien's own `df_*` filters and unrelated state stay.
export function eventTargetHref(search: string, eventId: string) {
  const url = new URLSearchParams(search);
  for (const key of Object.keys(emptyEventFilters)) url.delete(key);
  const query = url.toString();
  return (query ? '/?' + query : '/') + '#event-' + eventId;
}
