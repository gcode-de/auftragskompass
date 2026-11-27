import { useEffect, useRef, useState } from 'react';

export type AddressSuggestion = {
  formatted: string;
  attribution?: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
};

export function AddressNameField({
  label,
  value,
  csrfToken,
  onChange,
  onSelect,
  autoFocus,
}: {
  label: string;
  value: string;
  csrfToken: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  function clearSearch() {
    abort.current?.abort();
    setQuery('');
    setSuggestions([]);
    setFailed(false);
  }
  useEffect(() => {
    if (query.length < 3) return;
    const controller = new AbortController();
    abort.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/address-suggestions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Address search unavailable');
        const result: unknown = await response.json();
        if (!controller.signal.aborted && Array.isArray(result))
          setSuggestions(result);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [csrfToken, query]);

  return (
    <div
      className="contact-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) clearSearch();
      }}
      onKeyDown={(event) => {
        if (!suggestions.length) return;
        if (event.key === 'ArrowDown' && event.target === input.current) {
          event.preventDefault();
          event.currentTarget
            .querySelector<HTMLButtonElement>('li button')
            ?.focus();
          return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        input.current?.focus();
        clearSearch();
      }}
    >
      <label>
        {label}
        <input
          ref={input}
          name="name"
          required
          maxLength={200}
          autoFocus={autoFocus}
          autoComplete="off"
          value={value}
          onChange={(event) => {
            const name = event.currentTarget.value;
            onChange(name);
            if (name.trim() === query) return;
            clearSearch();
            setQuery(name.trim());
          }}
        />
      </label>
      {failed && (
        <p role="status">
          Adressvorschläge sind gerade nicht verfügbar. Du kannst die Anschrift
          eingeben.
        </p>
      )}
      {suggestions.length > 0 && (
        <>
          <ul className="contact-picker-hits" aria-label="Adressvorschläge">
            {suggestions.map((suggestion, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="contact-picker-hit"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(suggestion);
                    input.current?.focus();
                    clearSearch();
                  }}
                >
                  <span>{suggestion.formatted}</span>
                  {suggestion.attribution && (
                    <small className="contact-picker-detail">
                      {suggestion.attribution}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <small>
            Vorschläge von{' '}
            <a
              href="https://www.geoapify.com/"
              target="_blank"
              rel="noreferrer"
            >
              Geoapify
            </a>{' '}
            ·{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              © OpenStreetMap-Mitwirkende
            </a>
          </small>
        </>
      )}
    </div>
  );
}
