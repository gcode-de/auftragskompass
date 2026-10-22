import { useEffect, useId, useRef, useState } from 'react';
import { useAutoRefresh } from './auto-refresh.js';
import {
  OriginalInquiryContents,
  type OriginalInquiry,
} from './WebsiteInquiry.js';
type Item = { id: string; original: OriginalInquiry };
type Page = { items: Item[]; total: number; offset: number; limit: number };
export function WebsiteInbox({
  csrfToken,
  timeZone,
  onImported,
}: {
  csrfToken: string;
  timeZone: string;
  onImported: () => Promise<void>;
}) {
  const sequence = useRef(0),
    panel = useRef<HTMLDetailsElement>(null);
  const [page, setPage] = useState<Page | null>(null),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [message, setMessage] = useState('');
  async function load(offset = 0) {
    const current = ++sequence.current;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(
        '/api/v1/website-inquiries?offset=' + offset,
      );
      if (!response.ok) throw new Error();
      const value = (await response.json()) as Page;
      if (current === sequence.current) setPage(value);
    } catch {
      if (current === sequence.current) setFailed(true);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }
  // Load on open and on return; never poll. Late answers of an older read are
  // discarded by the sequence guard below.
  useAutoRefresh(
    () => {
      if (panel.current?.open) void load();
    },
    () => loading,
  );
  useEffect(() => {
    return () => {
      ++sequence.current;
    };
  }, []);
  return (
    <details
      ref={panel}
      className="website-inbox"
      onToggle={(event) => {
        if (event.currentTarget.open && !loading) void load();
      }}
    >
      <summary>Website-Eingänge (Ausnahmen)</summary>
      <p>
        Neue Website-Eingänge werden automatisch als Option angelegt, ohne
        Uhrzeit und ohne Reservierung. Hier erscheinen nur noch Eingänge, die
        nicht automatisch angelegt wurden – etwa bei unklarer Kontaktzuordnung
        oder fehlendem Land. Die Prüfung und Übernahme erzeugt eine Option und
        keine feste Buchung.
      </p>
      <button
        type="button"
        className="tertiary-action"
        disabled={loading}
        onClick={() => void load()}
      >
        Website-Eingänge aktualisieren
      </button>
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">Website-Eingänge werden geladen …</p>}
      {failed && (
        <p role="alert">
          Website-Eingänge konnten nicht geladen werden. Bitte Anmeldung und
          Verbindung prüfen und erneut aktualisieren.
        </p>
      )}
      {page && (
        <>
          {page.total === 0 ? (
            <p>
              Keine offenen Ausnahmen. Neue Website-Eingänge werden automatisch
              als Option angelegt.
            </p>
          ) : (
            <>
              <p>
                {page.total}{' '}
                {page.total === 1
                  ? 'Eingang nicht automatisch angelegt'
                  : 'Eingänge nicht automatisch angelegt'}{' '}
                · angezeigt {page.offset + 1}–
                {Math.min(page.offset + page.items.length, page.total)}
              </p>
              <ul>
                {page.items.map((item) => (
                  <li key={item.id}>
                    <InboxEntry
                      item={item}
                      csrfToken={csrfToken}
                      timeZone={timeZone}
                      onSuccess={() => {
                        setMessage(
                          'Als Option übernommen. Du findest den Vorgang in der Eventliste.',
                        );
                        setPage((current) =>
                          current
                            ? {
                                ...current,
                                total: current.total - 1,
                                items: current.items.filter(
                                  (row) => row.id !== item.id,
                                ),
                              }
                            : current,
                        );
                        void load();
                        void onImported().catch(() =>
                          setMessage(
                            'Als Option übernommen. Die Eventliste konnte nicht neu geladen werden; sie wird bei der nächsten Rückkehr aktualisiert.',
                          ),
                        );
                      }}
                    />
                  </li>
                ))}
              </ul>
              <div className="form-actions">
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={loading || page.offset === 0}
                  onClick={() =>
                    void load(Math.max(0, page.offset - page.limit))
                  }
                >
                  Vorherige Eingänge
                </button>
                <button
                  type="button"
                  className="tertiary-action"
                  disabled={loading || page.offset + page.limit >= page.total}
                  onClick={() => void load(page.offset + page.limit)}
                >
                  Weitere Eingänge
                </button>
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
function InboxEntry({
  item,
  csrfToken,
  timeZone,
  onSuccess,
}: {
  item: Item;
  csrfToken: string;
  timeZone: string;
  onSuccess: () => void;
}) {
  // The country is the operator's decision; the inbox never guesses one. It is
  // only needed when the recovery creates a new contact.
  const id = useId(),
    [country, setCountry] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        '/api/v1/website-inquiries/' + item.id + '/import',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(
            country.trim()
              ? { newContactCountry: country.trim().toUpperCase() }
              : {},
          ),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(
          body.error === 'contact_review'
            ? 'Kontaktzuordnung bitte prüfen oder das Land für einen neuen Kontakt angeben. Es wurde nichts angelegt; der Eingang bleibt gespeichert.'
            : 'Übernahme fehlgeschlagen. Bitte Anmeldung und Verbindung prüfen und erneut versuchen.',
        );
        return;
      }
      const result = (await response.json()) as { status?: string };
      if (!['created', 'duplicate'].includes(result.status ?? ''))
        throw new Error();
      onSuccess();
    } catch {
      setError(
        'Übernahme fehlgeschlagen. Bitte Anmeldung und Verbindung prüfen und erneut versuchen.',
      );
    } finally {
      setBusy(false);
    }
  }
  const fields = item.original.fields;
  return (
    <details className="website-inquiry">
      <summary>
        {fields[0]!.value} {fields[1]!.value} · {fields[3]!.value}
      </summary>
      <p>
        Originalangaben beim Absenden. Nicht automatisch angelegt – bitte
        Kontaktzuordnung prüfen. Bestehende Kontaktangaben werden nicht
        überschrieben.
      </p>
      <OriginalInquiryContents original={item.original} timeZone={timeZone} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={id}>
          Land für einen neuen Kontakt (2-Buchstaben-Code)
        </label>
        <input
          id={id}
          value={country}
          maxLength={2}
          pattern="[A-Za-z]{2}"
          autoComplete="off"
          aria-describedby={id + '-hint'}
          disabled={busy}
          onChange={(event) => setCountry(event.target.value)}
        />
        <p id={id + '-hint'}>
          Nur für einen neu anzulegenden Kontakt. Ein bestehender Kontakt wird
          wiederverwendet, ohne das Land zu ändern.
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="primary-action" disabled={busy}>
          {busy ? 'Wird übernommen …' : 'Als Option übernehmen'}
        </button>
      </form>
    </details>
  );
}
