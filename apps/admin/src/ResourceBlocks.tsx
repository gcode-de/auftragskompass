import { useEffect, useRef, useState } from 'react';
import { EventTimeField } from './EventTimeField.js';
import {
  resolveEventTime,
  type AmbiguousTimeChoice,
  type LocalTime,
} from './event-time.js';
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
// A local wall clock that does not exist (spring gap) or is still ambiguous
// (autumn overlap) is explained by EventTimeField itself. Saving only has to
// focus that control; the choice select carries its own error text.
function intrinsicField(resolution: LocalTime, name: string) {
  if (resolution.kind === 'nonexistent' || resolution.kind === 'invalid')
    return name;
  if (resolution.kind === 'ambiguous') return name + 'Choice';
  return '';
}
type BlockUnit = Overview['units'][number];
type BlockPrefill = { startsAt: string; endsAt: string } | null;
// The creation form keeps its own dirty flag inside, so remounting it with a
// new key (after a confirmed save or an explicit adoption) clears both the
// DOM values and that flag together.
function BlockForm({
  draftKey,
  timeZone,
  units,
  prefill,
  errorsByField,
  onDraft,
  onClear,
  onSubmit,
  disabled,
}: {
  draftKey: number;
  timeZone: string;
  units: BlockUnit[];
  prefill: BlockPrefill;
  errorsByField: Record<string, string>;
  onDraft: (dirty: boolean) => void;
  onClear: (name: string) => void;
  onSubmit: (form: HTMLFormElement) => void;
  disabled: boolean;
}) {
  return (
    <form
      key={draftKey}
      onChange={(event) => {
        const name = (event.target as HTMLElement).getAttribute('name') ?? '';
        onClear(name);
        if (['unitId', 'reason', 'start', 'end'].includes(name)) onDraft(true);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event.currentTarget);
      }}
    >
      <fieldset disabled={disabled}>
        <legend>Zeitraum einer Einheit sperren</legend>
        <label>
          Zu sperrende Einheit
          <select name="unitId" required defaultValue="">
            <option value="">Bitte wählen</option>
            {units.map((unit) => (
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
        <EventTimeField
          name="start"
          label="Sperrbeginn"
          timeZone={timeZone}
          idPrefix="block-start"
          instant={prefill?.startsAt ?? null}
          error={errorsByField.start}
        />
        <EventTimeField
          name="end"
          label="Sperrende"
          timeZone={timeZone}
          idPrefix="block-end"
          instant={prefill?.endsAt ?? null}
          error={errorsByField.end}
        />
        <button className="primary-action">Zeitraum sperren</button>
      </fieldset>
    </form>
  );
}

export function ResourceBlocks({ csrfToken }: { csrfToken: string }) {
  const [data, setData] = useState<Overview | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [errorsByField, setErrorsByField] = useState<Record<string, string>>({}),
    [reloadWarning, setReloadWarning] = useState(false),
    [message, setMessage] = useState('');
  // A stored instant keeps its exact instant (offset, seconds, milliseconds)
  // only while the field still shows that very wall clock; EventTimeField owns
  // that comparison and clears it on any edit. The instants come exclusively
  // from the explicit "Zeiten übernehmen" action: a fresh block form starts
  // empty, so saving cannot silently repeat an existing window.
  const [prefill, setPrefill] = useState<BlockPrefill>(null);
  const [draftKey, setDraftKey] = useState(0);
  // An uncertain POST is retried with the same ID until the input changes.
  const request = useRef<{ id: string; body: string } | null>(null);
  // Reports whether the block form holds unsaved input, so adopting a stored
  // window can ask before it discards that draft.
  const [draft, setDraft] = useState(false);

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
  function clearFieldError(name: string) {
    const base = name.replace(/Choice$/, '');
    setErrorsByField((current) => {
      const next = { ...current };
      delete next[base];
      return next;
    });
  }
  async function save(form: HTMLFormElement) {
    const fields = new FormData(form),
      value = (key: string) => String(fields.get(key) ?? ''),
      // An adopted window is kept byte for byte while its wall clock and saved
      // offset stay unchanged. Every other input resolves freshly in the tenant
      // timezone, so no earlier offset can leak across a date change.
      resolved = (name: 'start' | 'end', storedInstant: string | null) => {
        const choice = value(name + 'Choice');
        return resolveEventTime(value(name), data!.timeZone, {
          originalInstant: storedInstant,
          choice:
            choice === 'earlier' || choice === 'later'
              ? (choice as AmbiguousTimeChoice)
              : '',
        });
      },
      nextErrors: Record<string, string> = {};
    let focus = '';
    // Resolve before any await so the synchronous form values decide.
    const start = resolved('start', prefill?.startsAt ?? null),
      end = resolved('end', prefill?.endsAt ?? null);
    const mark = (name: string) => {
      if (!focus) focus = name;
    };
    // Validate in DOM order so the first reported problem is also focused.
    for (const [name, resolution] of [
      ['start', start],
      ['end', end],
    ] as const) {
      const field = intrinsicField(resolution, name);
      if (field) mark(field);
      else if (resolution.kind === 'empty') {
        nextErrors[name] =
          name === 'start'
            ? 'Bitte einen Sperrbeginn angeben.'
            : 'Bitte ein Sperrende angeben.';
        mark(name);
      }
    }
    if (
      start.kind === 'unique' &&
      end.kind === 'unique' &&
      Date.parse(start.instant) >= Date.parse(end.instant)
    ) {
      nextErrors.end = 'Das Sperrende muss nach dem Beginn liegen.';
      mark('end');
    }
    if (focus) {
      setErrorsByField(nextErrors);
      setMessage('Sperrzeiten prüfen: markierte Felder korrigieren.');
      form.querySelector<HTMLElement>(`[name="${focus}"]`)?.focus();
      return;
    }
    setErrorsByField({});
    setBusy(true);
    setMessage('');
    try {
      const input = {
        unitId: value('unitId'),
        reason: value('reason'),
        startsAt: start.kind === 'unique' ? start.instant : '',
        endsAt: end.kind === 'unique' ? end.instant : '',
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
      // The POST is confirmed. Report it first; a failing reload is a refresh
      // problem, not a reason to send the block again.
      setMessage('Zeitraum gesperrt.');
      request.current = null;
      form.reset();
      // The remount clears the loaded values; the next block is a new one.
      setPrefill(null);
      setDraftKey((current) => current + 1);
      try {
        await refresh();
        setReloadWarning(false);
      } catch {
        setReloadWarning(true);
      }
    } catch {
      setMessage(
        'Verbindung fehlgeschlagen. Vor erneutem Speichern den aktuellen Stand prüfen.',
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
  function retryLoad() {
    setLoading(true);
    setReloadWarning(false);
    void refresh()
      .catch(() => setMessage('Sperren konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
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
      <h2>Zeitweise Ressourcensperren</h2>
      <p role="status">{message}</p>
      {reloadWarning && (
        <div className="reload-warning">
          <p role="alert">
            Sperre gespeichert, aber die Sperrliste konnte nicht neu geladen
            werden. Nicht erneut speichern.
          </p>
          <button
            type="button"
            className="tertiary-action"
            disabled={busy}
            onClick={retryLoad}
          >
            Sperrliste erneut laden
          </button>
        </div>
      )}
      <button
        type="button"
        className="tertiary-action"
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
            Beginn und Ende werden als lokale Uhrzeit in dieser Zeitzone
            gespeichert; der Versatz wird automatisch ermittelt. Nur doppelte
            Herbst-Uhrzeiten verlangen eine Auswahl. Der genaue Sperrzeitraum
            gilt ohne zusätzliche Transportpuffer. Das allgemeine
            Sperrkennzeichen im Ressourcenstamm bleibt davon unabhängig.
          </p>
          <BlockForm
            draftKey={draftKey}
            timeZone={data.timeZone}
            units={data.units}
            prefill={prefill}
            errorsByField={errorsByField}
            onDraft={setDraft}
            onClear={clearFieldError}
            onSubmit={(form) => void save(form)}
            disabled={busy || loading}
          />
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
                  <button
                    type="button"
                    className="tertiary-action"
                    disabled={busy || loading}
                    onClick={() => {
                      // Looking at a stored window never replaces the draft on its
                      // own; the operator either edits on or discards it.
                      if (
                        draft &&
                        !window.confirm(
                          'Gespeicherte Sperrzeiten in das Formular übernehmen und den aktuellen Entwurf ersetzen?',
                        )
                      )
                        return;
                      setPrefill({
                        startsAt: block.startsAt,
                        endsAt: block.endsAt,
                      });
                      setDraftKey((current) => current + 1);
                    }}
                  >
                    Zeiten übernehmen: {block.reason || 'Zeitweise Sperre'}
                  </button>
                  {block.state === 'blocked' && (
                    <button
                      type="button"
                      className="secondary-action"
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
