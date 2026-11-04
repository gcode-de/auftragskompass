import { useEffect, useState, type FormEvent } from 'react';

type TelegramSettings = { configured: boolean; chatId: string | null };

export function TelegramSettingsPanel({ csrfToken }: { csrfToken: string }) {
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function load() {
    const response = await fetch('/api/v1/settings/telegram');
    if (!response.ok) throw Error('load');
    const result = (await response.json()) as TelegramSettings;
    setSettings(result);
    setChatId(result.chatId ?? '');
  }

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/settings/telegram')
      .then(async (response) => {
        if (!response.ok) throw Error('load');
        return (await response.json()) as TelegramSettings;
      })
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setChatId(result.chatId ?? '');
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage('Telegram-Einstellungen konnten nicht geladen werden.');
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
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      const response = await fetch('/api/v1/settings/telegram', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ botToken, chatId: chatId.trim() }),
      });
      if (!response.ok) throw Error('save');
      setBotToken('');
      await load();
      setMessage('Telegram-Einstellungen gespeichert.');
    } catch {
      setError(true);
      setMessage(
        'Speichern nicht bestätigt. Einstellungen neu laden und Zustand prüfen, bevor du erneut speicherst.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      const response = await fetch('/api/v1/settings/telegram', {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw Error('disable');
      setBotToken('');
      await load();
      setMessage('Telegram-Benachrichtigungen deaktiviert.');
    } catch {
      setError(true);
      setMessage(
        'Deaktivierung nicht bestätigt. Einstellungen neu laden und Zustand prüfen, bevor du es erneut versuchst.',
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
      setMessage('Telegram-Einstellungen konnten nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Telegram-Benachrichtigungen" aria-busy={busy}>
      <h2>Telegram-Benachrichtigungen</h2>
      <p>
        Optionaler Bot für Benachrichtigungen. Der Bot-Token wird gespeichert,
        aber aus Sicherheitsgründen nie wieder angezeigt. Das Speichern prüft
        die Verbindung noch nicht.
      </p>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {settings === null ? (
        <>
          {busy && <p>Lade Telegram-Einstellungen …</p>}
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
          <p>
            Status:{' '}
            {settings.configured ? 'Eingerichtet' : 'Nicht eingerichtet'}
          </p>
          <form onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
              <legend>
                {settings.configured ? 'Bot aktualisieren' : 'Bot einrichten'}
              </legend>
              <label>
                Bot-Token
                <input
                  type="password"
                  name="botToken"
                  autoComplete="new-password"
                  required
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                />
              </label>
              <label>
                Chat-ID
                <input
                  name="chatId"
                  autoComplete="off"
                  required
                  value={chatId}
                  onChange={(event) => setChatId(event.target.value)}
                />
              </label>
              <button className="primary-action" type="submit">
                {settings.configured
                  ? 'Einstellungen aktualisieren'
                  : 'Speichern'}
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
          {settings.configured && (
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => void disable()}
            >
              Telegram deaktivieren
            </button>
          )}
        </>
      )}
    </section>
  );
}
