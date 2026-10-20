import { useEffect, useRef } from 'react';

// Refreshes only when the application is brought back to the foreground.
// A visibility change and the focus event that follows it belong to the same
// transition; hiding or leaving the document arms the next one. Listeners are
// removed with the component and never poll.
export function useAutoRefresh(
  onReturn: () => void,
  isBusy: () => boolean = () => false,
) {
  const returnHandler = useRef(onReturn);
  const busy = useRef(isBusy);
  returnHandler.current = onReturn;
  busy.current = isBusy;
  useEffect(() => {
    let armed = true;
    const trigger = () => {
      if (document.visibilityState !== 'visible' || !armed) return;
      armed = false;
      if (busy.current()) return;
      returnHandler.current();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') trigger();
      else armed = true;
    };
    const left = () => {
      armed = true;
    };
    window.addEventListener('focus', trigger);
    window.addEventListener('blur', left);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', trigger);
      window.removeEventListener('blur', left);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
}
