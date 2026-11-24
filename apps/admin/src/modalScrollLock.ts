import { useEffect } from 'react';

// UI-SCROLL-01: an open modal dialog must never let the page behind it
// scroll. One observer owns the lock: while any open modal dialog is in the
// document - a native <dialog open> or a [role="dialog"] element - body
// scrolling is off. No per-dialog wiring, so no dialog can be missed, and
// stacked dialogs (a picker inside a form dialog) need no counting: the
// lock lives exactly as long as at least one such element exists.
//
// The selector matches only what this app treats as modal: native dialogs
// carry `open` only while shown, and every [role="dialog"] element of the
// admin is conditionally rendered while it is open (all of them also carry
// aria-modal="true").
const openDialogs = 'dialog[open], [role="dialog"]';

let installs = 0;
let observer: MutationObserver | null = null;
let previousOverflow: string | null = null;

function syncLock() {
  const anyOpen = document.querySelectorAll(openDialogs).length > 0;
  if (anyOpen && previousOverflow === null) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else if (!anyOpen && previousOverflow !== null) {
    document.body.style.overflow = previousOverflow;
    previousOverflow = null;
  }
}

/** Idempotent install; the returned function releases it again. */
export function installModalScrollLock(): () => void {
  installs += 1;
  if (installs === 1) {
    observer = new MutationObserver(syncLock);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'role'],
    });
    syncLock();
  }
  return () => {
    installs -= 1;
    if (installs !== 0) return;
    observer?.disconnect();
    observer = null;
    if (previousOverflow !== null) {
      document.body.style.overflow = previousOverflow;
      previousOverflow = null;
    }
  };
}

/** The app shell installs the lock once for its lifetime. */
export function useModalScrollLock(): void {
  useEffect(() => installModalScrollLock(), []);
}
