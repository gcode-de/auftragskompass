import { useEffect, useState } from 'react';

export function Snackbar({ message }: { message: string }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown(message);
    if (!message) return;
    const timer = window.setTimeout(() => setShown(''), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return (
    <div className="snackbar" data-open={Boolean(shown)}>
      <span role="status">{shown}</span>
      {shown && (
        <button
          type="button"
          aria-label="Meldung schließen"
          onClick={() => setShown('')}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
