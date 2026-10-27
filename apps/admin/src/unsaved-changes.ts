type DirtyCheck = () => boolean;

const checks = new Set<DirtyCheck>();
const recordChecks = new Set<DirtyCheck>();

export const discardForHomeMessage =
  'Ungespeicherte Eingaben verwerfen und zur Eventübersicht wechseln?';

export const discardForFilesMessage =
  'Ungespeicherte Eingaben verwerfen und zu den Dateien wechseln?';

export const discardForSearchMessage =
  'Ungespeicherte Eingaben verwerfen und zur Suche wechseln?';

export function registerUnsavedChanges(
  check: DirtyCheck,
  protectRecordNavigation = false,
): () => void {
  checks.add(check);
  if (protectRecordNavigation) recordChecks.add(check);
  return () => {
    checks.delete(check);
    recordChecks.delete(check);
  };
}

export function hasUnsavedChanges(): boolean {
  for (const check of checks) {
    if (check()) return true;
  }
  return false;
}

const leaveMessage =
  'Bereich trotz ungespeicherter Eingaben verlassen? Laufende Speicherungen werden fortgesetzt.';
let approvedHash: string | null = null;
let guardUsers = 0;
let removeGuard = () => {};
const hasRecordChanges = () => [...recordChecks].some((check) => check());

export function confirmNavigation(message: string, hash: string): boolean {
  if (!hasUnsavedChanges()) return true;
  if (hasRecordChanges() && approvedHash === hash) return true;
  if (!window.confirm(message)) return false;
  if (hasRecordChanges()) approvedHash = hash;
  return true;
}

/** One shared guard catches links and history changes before route readers. */
export function installUnsavedNavigationGuard(): () => void {
  if (guardUsers++ === 0) {
    let acceptedUrl = window.location.href;
    approvedHash = null;
    const changed = (event: Event) => {
      const next = window.location.href;
      if (next === acceptedUrl) return;
      // Filter updates do not leave the record; its panel guards refreshes.
      if (new URL(next).hash === new URL(acceptedUrl).hash) {
        acceptedUrl = next;
        return;
      }
      const approved = approvedHash === window.location.hash;
      approvedHash = null;
      if (!approved && hasRecordChanges() && !window.confirm(leaveMessage)) {
        // Back restores the forward edge; a new hash entry is replaced in place.
        if (event.type === 'popstate')
          window.history.pushState(null, '', acceptedUrl);
        else window.history.replaceState(null, '', acceptedUrl);
        event.stopImmediatePropagation();
        return;
      }
      acceptedUrl = next;
    };
    const clicked = (event: MouseEvent) => {
      // Other workspace forms stay mounted when hidden and keep their drafts.
      if (!hasRecordChanges()) return;
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (
        !anchor ||
        anchor.download ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      const target = new URL(anchor.href);
      if (
        target.origin !== window.location.origin ||
        target.pathname !== window.location.pathname ||
        target.href === window.location.href ||
        approvedHash === target.hash
      )
        return;
      const message =
        target.hash === '#files'
          ? discardForFilesMessage
          : target.hash === '#events'
            ? discardForHomeMessage
            : target.hash === '#search'
              ? discardForSearchMessage
              : leaveMessage;
      if (!confirmNavigation(message, target.hash)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('popstate', changed, true);
    window.addEventListener('hashchange', changed, true);
    document.addEventListener('click', clicked, true);
    removeGuard = () => {
      window.removeEventListener('popstate', changed, true);
      window.removeEventListener('hashchange', changed, true);
      document.removeEventListener('click', clicked, true);
      approvedHash = null;
    };
  }
  return () => {
    if (--guardUsers === 0) removeGuard();
  };
}
