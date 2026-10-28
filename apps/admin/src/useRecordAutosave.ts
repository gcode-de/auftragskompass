import { useEffect, useRef, useState } from 'react';
import { registerUnsavedChanges } from './unsaved-changes.js';

type Status = 'idle' | 'saving' | 'paused' | 'checking' | 'review';
type Options<Input, Row> = {
  initial: Row;
  toInput: (row: Row) => Input;
  write: (input: Input, version: number) => Promise<Row>;
  read: () => Promise<Row>;
  onConfirmed?: (row: Row) => void;
};
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Blur releases a patch; active drafts never enter another field's PUT. */
export function useRecordAutosave<
  Input extends object,
  Row extends { version: number },
>(options: Options<Input, Row>) {
  type Field = keyof Input;
  type Patch = Partial<Input>;
  type Job = { patch: Patch; edits: Partial<Record<Field, number>> };
  const callbacks = useRef(options);
  callbacks.current = options;
  const state = useRef({
    confirmed: options.initial,
    values: options.toInput(options.initial),
    queue: [] as Job[],
    flight: null as Job | null,
    edits: {} as Partial<Record<Field, number>>,
    cleanEdits: {} as Partial<Record<Field, number>>,
    status: 'idle' as Status,
    error: '',
    remote: null as Row | null,
  });
  const mounted = useRef(true);
  const [, render] = useState(0);
  function publish() {
    if (mounted.current) render((value) => value + 1);
  }
  function base() {
    return callbacks.current.toInput(state.current.confirmed);
  }
  function dirty() {
    const current = state.current;
    return (
      current.flight !== null ||
      current.queue.length > 0 ||
      current.status !== 'idle' ||
      !equal(current.values, base())
    );
  }
  useEffect(() => {
    mounted.current = true;
    const unregister = registerUnsavedChanges(dirty, true);
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      mounted.current = false;
      unregister();
      window.removeEventListener('beforeunload', unload);
    };
  }, []);

  function adopt(row: Row, sent?: Job) {
    const current = state.current,
      previous = base(),
      next = callbacks.current.toInput(row),
      values = { ...current.values };
    for (const key of Object.keys(next) as Field[]) {
      // Edit revisions also distinguish an intentional return to the old value.
      if (
        sent && key in sent.patch
          ? current.edits[key] === sent.edits[key]
          : current.edits[key] === current.cleanEdits[key] &&
            !current.queue.some((job) => key in job.patch) &&
            equal(values[key], previous[key])
      ) {
        values[key] = next[key];
        current.cleanEdits[key] = current.edits[key] ?? 0;
        current.edits[key] = current.cleanEdits[key];
      }
    }
    current.confirmed = row;
    current.values = values;
    callbacks.current.onConfirmed?.(row);
  }
  async function drain() {
    const current = state.current;
    if (current.flight || current.status !== 'idle' || !mounted.current) return;
    while (current.queue.length && mounted.current) {
      const job = current.queue.shift()!,
        patch = job.patch,
        input = base();
      if (
        (Object.keys(patch) as Field[]).every((key) =>
          equal(patch[key], input[key]),
        )
      )
        continue;
      current.flight = job;
      current.status = 'saving';
      publish();
      let row: Row;
      try {
        row = await callbacks.current.write(
          { ...input, ...patch },
          current.confirmed.version,
        );
      } catch (error) {
        // An absent response can mean the write succeeded. Never retry blind.
        current.queue.unshift(job);
        current.flight = null;
        current.status = 'paused';
        current.error =
          error instanceof Error
            ? error.message
            : 'Speichern nicht bestätigt. Bitte Serverstand prüfen.';
        publish();
        return;
      }
      adopt(row, job);
      current.flight = null;
      current.status = 'idle';
      publish();
    }
    publish();
  }
  function setField<Key extends Field>(key: Key, value: Input[Key]) {
    state.current.edits[key] = (state.current.edits[key] ?? 0) + 1;
    state.current.values = { ...state.current.values, [key]: value };
    publish();
  }
  function commitFields(fields: readonly Field[]) {
    const current = state.current,
      expected = {
        ...base(),
        ...current.flight?.patch,
        ...Object.assign({}, ...current.queue.map((job) => job.patch)),
      },
      patch: Patch = {};
    for (const key of fields) {
      if (!equal(current.values[key], expected[key]))
        patch[key] = current.values[key];
      else if (!current.flight && !current.queue.length) {
        current.cleanEdits[key] = current.edits[key] ?? 0;
        current.edits[key] = current.cleanEdits[key];
      }
    }
    if (!Object.keys(patch).length) return;
    current.queue.push({ patch, edits: { ...current.edits } });
    publish();
    void drain();
  }
  function cancelFields(fields: readonly Field[]) {
    const current = state.current;
    // Earlier blurs are already submissions, even while waiting for another PUT.
    const expected = base();
    for (const key of fields) {
      let edit = (current.edits[key] ?? 0) + 1;
      let pending = false;
      for (const job of [current.flight, ...current.queue]) {
        if (job && key in job.patch) {
          pending = true;
          expected[key] = job.patch[key] as Input[typeof key];
          edit = job.edits[key] ?? edit;
        }
      }
      current.edits[key] = edit;
      if (!pending) current.cleanEdits[key] = edit;
      current.values = { ...current.values, [key]: expected[key] };
    }
    publish();
  }
  async function reconcile() {
    const current = state.current;
    if (current.flight || current.status === 'checking') return;
    current.status = 'checking';
    current.error = '';
    current.remote = null;
    publish();
    try {
      const row = await callbacks.current.read();
      if (!mounted.current) return;
      current.remote = row;
      current.status = 'review';
    } catch {
      current.status = 'paused';
      current.error =
        'Serverstand konnte nicht geladen werden. Deine Eingaben bleiben erhalten.';
    }
    publish();
  }
  function useRemote() {
    const current = state.current;
    if (!current.remote || current.flight) return;
    const row = current.remote;
    current.queue = [];
    current.values = callbacks.current.toInput(row);
    current.confirmed = row;
    current.cleanEdits = { ...current.edits };
    current.remote = null;
    current.status = 'idle';
    current.error = '';
    callbacks.current.onConfirmed?.(row);
    publish();
  }
  function reapply() {
    const current = state.current;
    if (!current.remote || current.flight) return;
    adopt(current.remote);
    current.remote = null;
    current.status = 'idle';
    current.error = '';
    publish();
    void drain();
  }
  function adoptExternal(row: Row): boolean {
    const current = state.current;
    if (dirty() || row.version < current.confirmed.version) return false;
    if (row.version === current.confirmed.version)
      return equal(row, current.confirmed);
    adopt(row);
    publish();
    return true;
  }
  return {
    values: state.current.values,
    confirmed: state.current.confirmed,
    status: state.current.status,
    error: state.current.error,
    remote: state.current.remote,
    dirty: dirty(),
    setField,
    commitFields,
    cancelFields,
    reconcile,
    useRemote,
    reapply,
    adoptExternal,
  };
}
