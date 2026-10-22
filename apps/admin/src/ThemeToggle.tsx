import { useLayoutEffect, useRef, useState } from 'react';
type Theme = 'light' | 'dark';
function preference(): Theme | null {
  try {
    const value = localStorage.getItem('ak-theme');
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}
export function ThemeToggle() {
  const explicit = useRef<Theme | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    explicit.current = preference();
    return (
      explicit.current ??
      (window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light')
    );
  });
  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const changed = () =>
      setTheme(explicit.current ?? (media?.matches ? 'dark' : 'light'));
    const stored = (event: StorageEvent) => {
      if (event.key === 'ak-theme' || event.key === null) {
        explicit.current = preference();
        changed();
      }
    };
    media?.addEventListener('change', changed);
    window.addEventListener('storage', stored);
    return () => {
      media?.removeEventListener('change', changed);
      window.removeEventListener('storage', stored);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const nextAction =
    theme === 'dark' ? 'Hellmodus aktivieren' : 'Dunkelmodus aktivieren';
  return (
    <button
      type="button"
      className="theme-toggle tertiary-action"
      aria-label={nextAction}
      title={nextAction}
      aria-pressed={theme === 'dark'}
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        explicit.current = next;
        try {
          localStorage.setItem('ak-theme', next);
        } catch {
          /* Browser privacy settings may disable preference storage. */
        }
        setTheme(next);
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
        <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />
      </svg>
    </button>
  );
}
