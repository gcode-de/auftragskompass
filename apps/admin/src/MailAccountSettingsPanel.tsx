import { useEffect, useState, type FormEvent } from 'react';

type MailAccount = {
  id: string;
  name: string;
  fromName: string;
  fromAddress: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpSecurity: 'starttls' | 'implicit' | 'none';
  username: string;
  enabled: boolean;
  hasSecret: boolean;
};

type ServerError =
  | 'secret_required'
  | 'encryption_unavailable'
  | 'already_exists'
  | 'invalid_sender'
  | 'invalid_security'
  | 'invalid_account'
  | 'invalid_port';

function errorText(code: string | undefined) {
  switch (code as ServerError) {
    case 'secret_required':
      return 'Für ein aktives Konto wird ein Passwort benötigt.';
    case 'encryption_unavailable':
      return 'Ohne hinterlegten Schlüssel kann kein Passwort gespeichert werden. Bitte die Schlüsselbereitstellung prüfen.';
    case 'already_exists':
      return 'Ein Versandkonto mit diesem Namen existiert bereits.';
    case 'invalid_sender':
      return 'Absendername oder Absenderadresse sind nicht gültig.';
    case 'invalid_security':
      return 'Die gewählte Transportverschlüsselung passt nicht zu den Zugangsdaten. „Ohne“ ist nur ohne Benutzername möglich.';
    case 'invalid_account':
    case 'invalid_port':
      return 'Die Eingaben sind nicht gültig. Bitte die Angaben prüfen.';
    default:
      return 'Speichern nicht bestätigt. Einstellungen neu laden und Zustand prüfen, bevor du erneut speicherst.';
  }
}

const emptyForm = {
  name: '',
  fromName: '',
  fromAddress: '',
  smtpHost: '',
  smtpPort: '587',
  smtpSecurity: 'starttls',
  username: '',
  secret: '',
  enabled: true,
};

export function MailAccountSettingsPanel({ csrfToken }: { csrfToken: string }) {
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  // MAIL-FWD-01: the address a mail can additionally be forwarded to. The
  // switch lives per mail; this only stores the address.
  const [accountingRecipient, setAccountingRecipient] = useState('');

  async function load(): Promise<MailAccount[]> {
    const response = await fetch('/api/v1/mail/accounts');
    if (!response.ok) throw Error('load');
    return (await response.json()) as MailAccount[];
  }

  useEffect(() => {
    let active = true;
    // MAIL-FWD-01: the stored accounting address; a failure leaves the field
    // empty and the save offers the honest retry.
    void fetch('/api/v1/settings/mail-accounting')
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (!active || !value) return;
        setAccountingRecipient(
          (value as { accountingRecipient?: string }).accountingRecipient ?? '',
        );
      })
      .catch(() => undefined);
    void load()
      .then((result) => {
        if (!active) return;
        setAccounts(result);
        // No account yet: the form is the only sensible first step.
        if (result.length === 0) setEditing('new');
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

  // MAIL-FWD-01: store the accounting address; empty only disables the
  // switch in the dialogs. The same address validation as every recipient.
  async function saveAccounting() {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      const response = await fetch('/api/v1/settings/mail-accounting', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          accountingRecipient: accountingRecipient.trim(),
        }),
      });
      if (response.status === 400) {
        setError(true);
        setMessage('Bitte eine gültige Adresse eingeben.');
        return;
      }
      if (!response.ok) throw Error('save');
      setError(false);
      setMessage('Buchhaltungs-Mail gespeichert.');
    } catch {
      setError(true);
      setMessage(
        'Der Speicherstand ist unklar. Bitte erneut speichern; es wurde keine Mail versendet.',
      );
    } finally {
      setBusy(false);
    }
  }

  function editAccount(account: MailAccount) {
    setEditing(account.id);
    setForm({
      name: account.name,
      fromName: account.fromName,
      fromAddress: account.fromAddress,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort === null ? '' : String(account.smtpPort),
      smtpSecurity: account.smtpSecurity,
      username: account.username,
      secret: '',
      enabled: account.enabled,
    });
    setMessage('');
    setError(false);
  }

  function createAccount() {
    setEditing('new');
    setForm(emptyForm);
    setMessage('');
    setError(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError(false);
    // An empty password keeps the sealed one: the key is simply left out.
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      fromName: form.fromName.trim(),
      fromAddress: form.fromAddress.trim(),
      smtpHost: form.smtpHost.trim(),
      smtpPort: Number(form.smtpPort),
      smtpSecurity: form.smtpSecurity,
      username: form.username.trim(),
      enabled: form.enabled,
    };
    if (form.secret) body.secret = form.secret;
    try {
      const response = await fetch(
        editing !== null && editing !== 'new'
          ? `/api/v1/mail/accounts/${editing}`
          : '/api/v1/mail/accounts',
        {
          method: editing !== null && editing !== 'new' ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(true);
        setMessage(errorText(answer.error));
        return;
      }
      const saved = (await response.json()) as MailAccount;
      setForm((current) => ({ ...current, secret: '' }));
      setEditing(saved.id);
      try {
        setAccounts(await load());
      } catch {
        // The save is confirmed; the list is not. Keep the form as it is.
        setError(true);
        setMessage(
          'Gespeichert, aber die Liste konnte nicht neu geladen werden. Einstellungen neu laden, um den Bestand abzugleichen.',
        );
        return;
      }
      setMessage('Versandkonto gespeichert.');
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
      const result = await load();
      setAccounts(result);
      if (result.length === 0) setEditing('new');
    } catch {
      setError(true);
      setMessage('E-Mail-Einstellungen konnten nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }

  const selected =
    accounts && editing && editing !== 'new'
      ? accounts.find((account) => account.id === editing)
      : undefined;

  return (
    <section aria-label="E-Mail-Versand" aria-busy={busy}>
      <h2>E-Mail-Versand</h2>
      <p>
        Hier wird das Versandkonto für ausgehende E-Mails eingerichtet –
        Absender, SMTP-Server und Zugangsdaten. Das Passwort wird verschlüsselt
        gespeichert und nie wieder angezeigt. Das Speichern dieser Einstellungen
        versendet keine E-Mail.
      </p>
      {/* MAIL-FWD-01: where a mail can additionally be forwarded to. */}
      <h3>Buchhaltungs-Mail</h3>
      <p>
        Diese Adresse kann im Mail-Dialog als Kopie gewählt werden. Ohne
        hinterlegte Adresse ist der Schalter dort nicht eingerichtet.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveAccounting();
        }}
      >
        <label>
          Adresse der Buchhaltung
          <input
            type="email"
            value={accountingRecipient}
            onChange={(event) =>
              setAccountingRecipient(event.currentTarget.value)
            }
          />
        </label>
        <button className="secondary-action" disabled={busy}>
          Buchhaltungs-Mail festlegen
        </button>
      </form>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {accounts === null ? (
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
          {accounts.length > 0 && (
            <>
              <h3>Versandkonten</h3>
              <ul className="master-data-list">
                {accounts.map((account) => (
                  <li key={account.id}>
                    <span>
                      {account.name} – {account.fromAddress || 'ohne Absender'}{' '}
                      ({account.enabled ? 'Aktiv' : 'Inaktiv'}
                      {account.hasSecret ? ', Passwort gesetzt' : ''})
                    </span>{' '}
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={busy || editing === account.id}
                      onClick={() => editAccount(account)}
                    >
                      {account.name} bearbeiten
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {editing === null ? (
            <button
              className="primary-action"
              type="button"
              disabled={busy}
              onClick={createAccount}
            >
              Versandkonto anlegen
            </button>
          ) : (
            <form onSubmit={(event) => void save(event)}>
              <fieldset disabled={busy}>
                <legend>
                  {editing === 'new'
                    ? 'Versandkonto einrichten'
                    : `Versandkonto bearbeiten: ${selected?.name ?? form.name}`}
                </legend>
                <label>
                  Kontoname
                  <input
                    name="name"
                    autoComplete="off"
                    required
                    maxLength={200}
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Absendername
                  <input
                    name="fromName"
                    autoComplete="off"
                    maxLength={200}
                    value={form.fromName}
                    onChange={(event) =>
                      setForm({ ...form, fromName: event.target.value })
                    }
                  />
                </label>
                <label>
                  Absenderadresse
                  <input
                    name="fromAddress"
                    type="email"
                    autoComplete="off"
                    required
                    maxLength={254}
                    value={form.fromAddress}
                    onChange={(event) =>
                      setForm({ ...form, fromAddress: event.target.value })
                    }
                  />
                </label>
                <label>
                  SMTP-Server
                  <input
                    name="smtpHost"
                    autoComplete="off"
                    required
                    maxLength={255}
                    value={form.smtpHost}
                    onChange={(event) =>
                      setForm({ ...form, smtpHost: event.target.value })
                    }
                  />
                </label>
                <label>
                  SMTP-Port
                  <input
                    name="smtpPort"
                    inputMode="numeric"
                    pattern="[0-9]{1,5}"
                    required
                    value={form.smtpPort}
                    onChange={(event) =>
                      setForm({ ...form, smtpPort: event.target.value })
                    }
                  />
                </label>
                <label>
                  Transportverschlüsselung
                  <select
                    name="smtpSecurity"
                    value={form.smtpSecurity}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        smtpSecurity: event.target
                          .value as typeof form.smtpSecurity,
                      })
                    }
                  >
                    <option value="starttls">STARTTLS</option>
                    <option value="implicit">SSL/TLS (SMTPS)</option>
                    <option value="none">Ohne (nur lokales Relay)</option>
                  </select>
                </label>
                <label>
                  Benutzername
                  <input
                    name="username"
                    autoComplete="off"
                    maxLength={255}
                    value={form.username}
                    onChange={(event) =>
                      setForm({ ...form, username: event.target.value })
                    }
                  />
                </label>
                <label>
                  Passwort
                  <input
                    name="secret"
                    type="password"
                    autoComplete="new-password"
                    maxLength={512}
                    required={editing === 'new' && form.enabled}
                    value={form.secret}
                    onChange={(event) =>
                      setForm({ ...form, secret: event.target.value })
                    }
                  />
                </label>
                <p>
                  {selected?.hasSecret
                    ? 'Es ist ein Passwort gespeichert. Leer lassen, um es unverändert beizubehalten.'
                    : 'Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt.'}
                </p>
                <label>
                  <input
                    name="enabled"
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) =>
                      setForm({ ...form, enabled: event.target.checked })
                    }
                  />
                  Konto aktiv
                </label>
                <p>Ein aktives Konto wird für den Versand verwendet.</p>
                <button className="primary-action" type="submit">
                  {editing === 'new' ? 'Speichern' : 'Änderungen speichern'}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setMessage('');
                    setError(false);
                  }}
                >
                  Abbrechen
                </button>
              </fieldset>
            </form>
          )}
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
