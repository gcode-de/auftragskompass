import { useEffect, useState } from 'react';

type Sequence = {
  kind: string;
  pattern: string;
  minLength: number;
  nextValue: number;
  version: number;
};
type Draft = { pattern: string; minLength: string; nextValue: string };
const kinds: [string, string][] = [
  ['offer', 'Angebot'],
  ['order_confirmation', 'Auftragsbestätigung'],
  ['deposit_invoice', 'Anzahlungsrechnung'],
  ['invoice', 'Rechnung'],
  ['correction', 'Rechnungskorrektur'],
];
const defaults: Record<string, string> = {
  offer: 'AN-{YYYY}-{SEQ}',
  order_confirmation: 'AB-{YYYY}-{SEQ}',
  deposit_invoice: 'AZ-{YYYY}-{SEQ}',
  invoice: 'RE-{YYYY}-{SEQ}',
  correction: 'KO-{YYYY}-{SEQ}',
};
const emptyDraft = (kind: string): Draft => ({
  pattern: defaults[kind] ?? '{YYYY}-{SEQ}',
  minLength: '4',
  nextValue: '1',
});

export function DocumentNumbersPanel({ csrfToken }: { csrfToken: string }) {
  const [rows, setRows] = useState<Sequence[]>([]),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [previews, setPreviews] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  // H036: one dominant action per surface. The save primary sits on the range
  // the reader is currently editing (the first not yet configured one, else the
  // first range); every other range keeps a quiet, equally usable save.
  const activeKind =
    kinds.find(([kind]) => !rows.some((entry) => entry.kind === kind))?.[0] ??
    kinds[0]![0];
  function draftFor(kind: string) {
    const row = rows.find((entry) => entry.kind === kind);
    return (
      drafts[kind] ??
      (row
        ? {
            pattern: row.pattern,
            minLength: String(row.minLength),
            nextValue: String(row.nextValue),
          }
        : emptyDraft(kind))
    );
  }
  async function refresh() {
    const response = await fetch('/api/v1/document-numbers');
    if (!response.ok) throw new Error('load');
    setRows((await response.json()) as Sequence[]);
  }
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Nummernkreise konnten nicht geladen werden.'),
    );
  }, []);
  function update(kind: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [kind]: { ...draftFor(kind), ...patch },
    }));
  }
  async function save(kind: string) {
    setBusy(true);
    setMessage('');
    try {
      const draft = draftFor(kind),
        row = rows.find((entry) => entry.kind === kind),
        body = {
          pattern: draft.pattern,
          minLength: Number(draft.minLength),
          nextValue: Number(draft.nextValue),
          ...(row ? { version: row.version } : { kind }),
        };
      const response = await fetch(
        row ? `/api/v1/document-numbers/${kind}` : '/api/v1/document-numbers',
        {
          method: row ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const result = (await response.json()) as { error: string };
        setMessage(
          result.error === 'conflict'
            ? 'Inzwischen geändert. Nummernkreise aktualisieren und erneut bearbeiten.'
            : result.error === 'invalid_pattern'
              ? 'Muster prüfen: genau ein {SEQ} und nur {YYYY}, {YY}, {MM}, {DD} verwenden.'
              : 'Speichern fehlgeschlagen. Angaben und Anmeldung prüfen.',
        );
        return;
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
      await refresh();
      setMessage('Gespeichert.');
    } catch {
      setMessage('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
    } finally {
      setBusy(false);
    }
  }
  async function preview(kind: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/document-numbers/${kind}/preview`);
      if (!response.ok) {
        setMessage(
          'Noch kein Nummernkreis eingerichtet. Erst Muster speichern.',
        );
        return;
      }
      const result = (await response.json()) as { number: string };
      setPreviews((current) => ({ ...current, [kind]: result.number }));
    } catch {
      setMessage('Verbindung fehlgeschlagen. Deine Eingabe bleibt erhalten.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="document-numbers" aria-label="Nummernkreise">
      <h2>Nummernkreise</h2>
      <p>
        Jede Dokumentart hat einen eigenen Nummernkreis. Die Vorschau zeigt die
        nächste Nummer, ohne sie zu verbrauchen. Die nächste Nummer wird nur
        beim bewussten Speichern übernommen.
      </p>
      <p role="status">{message}</p>
      {kinds.map(([kind, label]) => {
        const draft = draftFor(kind),
          configured = rows.some((entry) => entry.kind === kind);
        return (
          <fieldset key={kind} disabled={busy}>
            <legend>{label}</legend>
            <label>
              Muster ({label})
              <input
                value={draft.pattern}
                maxLength={60}
                onChange={(event) =>
                  update(kind, { pattern: event.target.value })
                }
              />
            </label>
            <label>
              Mindestlänge ({label})
              <input
                type="number"
                min={1}
                max={12}
                value={draft.minLength}
                onChange={(event) =>
                  update(kind, { minLength: event.target.value })
                }
              />
            </label>
            <label>
              Nächste Nummer ({label})
              <input
                type="number"
                min={1}
                value={draft.nextValue}
                onChange={(event) =>
                  update(kind, { nextValue: event.target.value })
                }
              />
            </label>
            <button
              type="button"
              className={
                kind === activeKind ? 'primary-action' : 'secondary-action'
              }
              onClick={() => void save(kind)}
            >
              Nummernkreis speichern ({label})
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!configured}
              onClick={() => void preview(kind)}
            >
              Vorschau ({label})
            </button>
            {previews[kind] && <p>Nächste Nummer: {previews[kind]}</p>}
          </fieldset>
        );
      })}
    </section>
  );
}
