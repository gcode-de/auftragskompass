import { useEffect, useRef, useState } from 'react';
import { toInstant } from './event-time.js';
type Overview = {
  timeZone: string;
  units: {
    id: string;
    name: string;
    code: string;
    ordinal: number;
    enabled: boolean;
    state: string;
  }[];
  blocks: {
    id: string;
    unitId: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    state: string;
    reason: string;
  }[];
};
const errors: Record<string, string> = {
  resource_conflict:
    'Der Zeitraum überschneidet sich mit einer festen Buchung oder Sperre.',
  idempotency_conflict:
    'Diese Speicherung wurde bereits mit anderen Werten verarbeitet. Aktuellen Stand prüfen und neue Sperre beginnen.',
  unit_unavailable: 'Diese Einheit ist inaktiv oder archiviert.',
  invalid_period: 'Einen gültigen, noch nicht beendeten Zeitraum angeben.',
  invalid_reason: 'Einen Sperrgrund mit höchstens 200 Zeichen angeben.',
  not_found: 'Sperre nicht gefunden. Liste aktualisieren.',
};
export function ResourceBlocks({ csrfToken }: { csrfToken: string }) {
  const [data, setData] = useState<Overview | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState('');
  const request = useRef<{ id: string; body: string } | null>(null);
  async function refresh() {
    const response = await fetch('/api/v1/resource-blocks');
    if (!response.ok) throw Error('load');
    const result = (await response.json()) as Overview;
    if (!Array.isArray(result.units) || !Array.isArray(result.blocks))
      throw Error('load');
    setData(result);
  }
  useEffect(() => {
    void refresh()
      .catch(() => setMessage('Sperren konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const fields = new FormData(form),
        value = (key: string) => String(fields.get(key) ?? '');
      const input = {
        unitId: value('unitId'),
        reason: value('reason'),
        startsAt: toInstant(
          value('start'),
          data!.timeZone,
          value('startOffset'),
        ),
        endsAt: toInstant(value('end'), data!.timeZone, value('endOffset')),
      };
      const body = JSON.stringify(input);
      // Retry an uncertain request with the same ID; changed input starts a new intent.
      if (request.current?.body !== body)
        request.current = { id: crypto.randomUUID(), body };
      const response = await fetch('/api/v1/resource-blocks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ ...input, requestId: request.current.id }),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          errors[error.error] ??
            'Sperre konnte nicht gespeichert werden. Eingaben und Anmeldung prüfen.',
        );
        return;
      }
      await refresh();
      request.current = null;
      form.reset();
      setMessage('Zeitraum gesperrt.');
    } catch (error) {
      setMessage(
        error instanceof RangeError
          ? 'Zeitpunkt prüfen; bei doppelten Uhrzeiten den UTC-Versatz angeben.'
          : 'Verbindung fehlgeschlagen. Vor erneutem Speichern den aktuellen Stand prüfen.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function release(id: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        '/api/v1/resource-blocks/' + id + '/release',
        { method: 'POST', headers: { 'x-csrf-token': csrfToken } },
      );
      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        setMessage(
          errors[error.error] ??
            'Sperre konnte nicht freigegeben werden. Anmeldung prüfen.',
        );
        return;
      }
      await refresh();
      setMessage('Sperre freigegeben.');
    } catch {
      setMessage(
        'Verbindung fehlgeschlagen. Den aktuellen Stand vor einer Wiederholung laden.',
      );
    } finally {
      setBusy(false);
    }
  }
  function time(value: string, zone: string) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: zone,
    }).format(new Date(value));
  }
  return (
    <section
      aria-label="Zeitweise Ressourcensperren"
      aria-busy={loading || busy}
    >
      <h3>Zeitweise Ressourcensperren</h3>
      <p role="status">{message}</p>
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => {
          setLoading(true);
          void refresh()
            .catch(() => setMessage('Sperren konnten nicht geladen werden.'))
            .finally(() => setLoading(false));
        }}
      >
        Sperren aktualisieren
      </button>
      {loading && <p>Sperren werden geladen …</p>}
      {data && (
        <>
          <p>
            Für Wartung, Reparatur oder Eigenbedarf. Zeitzone: {data.timeZone}.
            Der genaue Sperrzeitraum gilt ohne zusätzliche Transportpuffer. Das
            allgemeine Sperrkennzeichen im Ressourcenstamm bleibt davon
            unabhängig.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(e.currentTarget);
            }}
          >
            <fieldset disabled={busy || loading}>
              <legend>Zeitraum einer Einheit sperren</legend>
              <label>
                Zu sperrende Einheit
                <select name="unitId" required defaultValue="">
                  <option value="">Bitte wählen</option>
                  {data.units.map((unit) => (
                    <option
                      key={unit.id}
                      value={unit.id}
                      disabled={!unit.enabled || unit.state !== 'active'}
                    >
                      {unit.name} · Einheit {unit.ordinal} ({unit.code})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sperrgrund
                <input name="reason" required maxLength={200} />
              </label>
              <label>
                Sperrbeginn
                <input name="start" type="datetime-local" required step="1" />
              </label>
              <label>
                UTC-Versatz: Sperrbeginn
                <input
                  name="startOffset"
                  placeholder="+02:00"
                  pattern="[+-][0-9]{2}:[0-9]{2}"
                />
              </label>
              <label>
                Sperrende
                <input name="end" type="datetime-local" required step="1" />
              </label>
              <label>
                UTC-Versatz: Sperrende
                <input
                  name="endOffset"
                  placeholder="+02:00"
                  pattern="[+-][0-9]{2}:[0-9]{2}"
                />
              </label>
              <button>Zeitraum sperren</button>
            </fieldset>
          </form>
          {!data.blocks.length && <p>Noch keine zeitweisen Sperren.</p>}
          <ul>
            {data.blocks.map((block) => {
              const unit = data.units.find((unit) => unit.id === block.unitId);
              return (
                <li key={block.id}>
                  {block.reason || 'Zeitweise Sperre'} –{' '}
                  {unit
                    ? unit.name + ' · Einheit ' + unit.ordinal
                    : 'Historische Einheit'}{' '}
                  – {time(block.startsAt, block.timeZone)} bis{' '}
                  {time(block.endsAt, block.timeZone)} –{' '}
                  {block.state === 'released' ? 'Freigegeben' : 'Gesperrt'}{' '}
                  {block.state === 'blocked' && (
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() => void release(block.id)}
                    >
                      Sperre freigeben: {block.reason || 'Zeitweise Sperre'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
