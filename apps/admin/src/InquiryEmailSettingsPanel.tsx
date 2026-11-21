import { useEffect, useState, type FormEvent } from 'react';

type InquiryEmailSettings = { enabled: boolean; recipients: string };

// MAIL-NOTIFY-01: the e-mail notification is a second channel next to
// Telegram. It stores only target addresses and a switch.
export function InquiryEmailSettingsPanel({
  csrfToken,
}: {
  csrfToken: string;
}) {
  const [settings, setSettings] = useState<InquiryEmailSettings | null>(null);
  const [recipients, setRecipients] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function load() {
    const response = await fetch('/api/v1/settings/inquiry-email');
    if (!response.ok) throw Error('load');
    const result = (await response.json()) as InquiryEmailSettings;
    setSettings(result);
    setRecipients(result.recipients ?? '');
    setEnabled(result.enabled);
  }

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/settings/inquiry-email')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        return (await response.json()) as InquiryEmailSettings;
      })
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setRecipients(result.recipients ?? '');
        setEnabled(result.enabled);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage('E-Mail-Einstellungen konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError(false);
    if (enabled && !recipients.trim()) {
      setError(true);
      setMessage(
        'Bitte eine Zieladresse angeben, bevor du die E-Mail-Benachrichtigung aktivierst.',
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/v1/settings/inquiry-email', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ enabled, recipients: recipients.trim() }),
      });
      if (!response.ok) throw Error('save');
      await load();
      setMessage('E-Mail-Benachrichtigung gespeichert.');
    } catch {
      setError(true);
      setMessage(
        'Speichern nicht bestätigt. Einstellungen neu laden und Zustand prüfen, bevor du erneut speicherst.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      await load();
    } catch {
      setError(true);
      setMessage('E-Mail-Einstellungen konnten nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="E-Mail-Benachrichtigung für Website-Anfragen"
      aria-busy={busy}
    >
      <h2>E-Mail-Benachrichtigung für Website-Anfragen</h2>
      <p>
        Zusätzlich zu Telegram. Neue Website-Anfragen gehen als Klartext-Mail an
        die angegebenen Adressen, sobald sie im AuftragsKompass eingegangen
        sind. Versendet wird über das hinterlegte E-Mail-Konto; ohne aktives
        Konto entsteht kein Versand.
      </p>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {settings === null ? (
        <>
          {busy && <p>Lade E-Mail-Einstellungen …</p>}
          {error && (
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => void reload()}
            >
              Einstellungen neu laden
            </button>
          )}
        </>
      ) : (
        <>
          <p>Status: {settings.enabled ? 'Aktiv' : 'Inaktiv'}</p>
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
              <legend>Zieladressen</legend>
              <label>
                E-Mail-Benachrichtigung aktiv
                <input
                  type="checkbox"
                  name="enabled"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
              </label>
              <label>
                Zieladresse(n)
                <input
                  name="recipients"
                  autoComplete="off"
                  maxLength={4000}
                  value={recipients}
                  onChange={(event) => setRecipients(event.target.value)}
                />
              </label>
              <p>Mehrere Adressen durch Komma trennen.</p>
              <button className="primary-action" type="submit">
                Speichern
              </button>
            </fieldset>
          </form>
          {error && (
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => void reload()}
            >
              Einstellungen neu laden
            </button>
          )}
        </>
      )}
    </section>
  );
}
