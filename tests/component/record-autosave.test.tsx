import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useRecordAutosave } from '../../apps/admin/src/useRecordAutosave.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';

type Input = { name: string; email: string; note: string };
type Row = Input & { id: string; version: number };
const initial: Row = {
  id: 'synthetic',
  version: 1,
  name: 'Original',
  email: 'original@example.invalid',
  note: '',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  write: (input: Input, version: number) => Promise<Row>,
  read = vi.fn(async () => initial),
) {
  const onConfirmed = vi.fn();
  return {
    ...renderHook(() =>
      useRecordAutosave({
        initial,
        toInput: ({ name, email, note }: Row): Input => ({ name, email, note }),
        write,
        read,
        onConfirmed,
      }),
    ),
    onConfirmed,
    read,
  };
}
afterEach(cleanup);

test('serializes only blurred fields against each confirmed version and preserves active drafts', async () => {
  const first = deferred<Row>(),
    second = deferred<Row>();
  const write = vi
    .fn<(input: Input, version: number) => Promise<Row>>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result } = setup(write);
  act(() => result.current.commitFields(['name']));
  expect(write).not.toHaveBeenCalled();
  act(() => {
    result.current.setField('name', '  Updated  ');
    result.current.commitFields(['name']);
    result.current.setField('email', 'next@example.invalid');
    result.current.commitFields(['email']);
    result.current.setField('note', 'Unfinished');
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenNthCalledWith(
    1,
    { ...initialInput(), name: '  Updated  ' },
    1,
  );
  await act(async () =>
    first.resolve({ ...initial, name: 'Updated', version: 2 }),
  );
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write).toHaveBeenNthCalledWith(
    2,
    {
      name: 'Updated',
      email: 'next@example.invalid',
      note: '',
    },
    2,
  );
  await act(async () =>
    second.resolve({
      ...initial,
      name: 'Updated',
      email: 'next@example.invalid',
      version: 3,
    }),
  );
  expect(result.current.values.note).toBe('Unfinished');
  expect(result.current.confirmed.version).toBe(3);
  expect(result.current.dirty).toBe(true);
});
function initialInput(): Input {
  return { name: initial.name, email: initial.email, note: initial.note };
}

test('cancel discards an unsent field and a later blur can save again', async () => {
  const write = vi.fn(async (input: Input, version: number) => ({
    ...input,
    id: initial.id,
    version: version + 1,
  }));
  const { result } = setup(write);
  act(() => {
    result.current.setField('name', 'Discard');
    result.current.setField('note', 'Keep other draft');
    result.current.cancelFields(['name']);
    result.current.commitFields(['name']);
  });
  expect(result.current.values.name).toBe('Original');
  expect(result.current.values.note).toBe('Keep other draft');
  expect(write).not.toHaveBeenCalled();
  await act(async () => {
    result.current.setField('name', 'Later');
    result.current.commitFields(['name']);
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(result.current.values.name).toBe('Later');
});

test('canonical replies preserve newer input and cancel never claims to undo an in-flight save', async () => {
  const pending = deferred<Row>();
  const write = vi.fn(() => pending.promise);
  const { result } = setup(write);
  act(() => {
    result.current.setField('name', 'Sent');
    result.current.commitFields(['name']);
    result.current.setField('name', 'Newer');
  });
  await act(async () =>
    pending.resolve({ ...initial, name: 'SENT', version: 2 }),
  );
  expect(result.current.values.name).toBe('Newer');
  act(() => result.current.cancelFields(['name']));
  expect(result.current.values.name).toBe('SENT');
  expect(write).toHaveBeenCalledTimes(1);
});

test('cancel preserves previous blur submissions and the earlier in-flight write', async () => {
  const pending = deferred<Row>();
  const write = vi
    .fn<(input: Input, version: number) => Promise<Row>>()
    .mockReturnValueOnce(pending.promise)
    .mockImplementation(async (input, version) => ({
      ...input,
      id: initial.id,
      version: version + 1,
    }));
  const { result } = setup(write);
  act(() => {
    result.current.setField('email', 'sent@example.invalid');
    result.current.commitFields(['email']);
    result.current.setField('name', 'Queued');
    result.current.commitFields(['name']);
    result.current.setField('name', 'Newer unsent draft');
    result.current.setField('email', 'Discard unsent newer');
    result.current.cancelFields(['name']);
    result.current.cancelFields(['email']);
  });
  expect(result.current.values.email).toBe('sent@example.invalid');
  expect(result.current.status).toBe('saving');
  await act(async () =>
    pending.resolve({ ...initial, email: 'sent@example.invalid', version: 2 }),
  );
  expect(write).toHaveBeenCalledTimes(2);
  expect(result.current.values.name).toBe('Queued');
  expect(result.current.dirty).toBe(false);
});

test('a newer edit back to the original value survives an older successful reply', async () => {
  const pending = deferred<Row>();
  const { result } = setup(vi.fn(() => pending.promise));
  act(() => {
    result.current.setField('name', 'Sent');
    result.current.commitFields(['name']);
    result.current.setField('name', initial.name);
  });
  await act(async () =>
    pending.resolve({ ...initial, name: 'Sent', version: 2 }),
  );
  expect(result.current.values.name).toBe(initial.name);
  expect(result.current.dirty).toBe(true);
});

test('pauses on a conflict or lost reply and reconciles only through an explicit decision', async () => {
  const remote = {
    ...initial,
    name: 'Remote edit',
    email: 'remote@example.invalid',
    version: 7,
  };
  const read = vi.fn(async () => remote);
  const write = vi
    .fn<(input: Input, version: number) => Promise<Row>>()
    .mockRejectedValueOnce(new Error('Version conflict'))
    .mockImplementation(async (input, version) => ({
      ...input,
      id: initial.id,
      version: version + 1,
    }));
  const { result } = setup(write, read);
  await act(async () => {
    result.current.setField('name', 'My edit');
    result.current.commitFields(['name']);
    result.current.setField('note', 'Keep active');
  });
  expect(result.current.status).toBe('paused');
  expect(write).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  await act(async () => result.current.reconcile());
  expect(result.current.status).toBe('review');
  expect(result.current.values.name).toBe('My edit');
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => result.current.reapply());
  expect(write).toHaveBeenLastCalledWith(
    { name: 'My edit', email: remote.email, note: '' },
    7,
  );
  expect(result.current.values.note).toBe('Keep active');
  expect(result.current.confirmed.version).toBe(8);
});

test('does not repeat an uncertain write already present in the server snapshot', async () => {
  const remote = { ...initial, name: 'Already saved', version: 2 };
  const write = vi
    .fn<(input: Input, version: number) => Promise<Row>>()
    .mockRejectedValueOnce(new Error('Lost response'));
  const { result } = setup(
    write,
    vi.fn(async () => remote),
  );
  await act(async () => {
    result.current.setField('name', remote.name);
    result.current.commitFields(['name']);
  });
  await act(async () => result.current.reconcile());
  await act(async () => result.current.reapply());
  expect(write).toHaveBeenCalledTimes(1);
  expect(result.current.confirmed.version).toBe(2);
  expect(result.current.dirty).toBe(false);
});

test('reconciliation preserves an active field intentionally returned to its original value', async () => {
  const remote = { ...initial, email: 'remote@example.invalid', version: 7 };
  const write = vi
    .fn<(input: Input, version: number) => Promise<Row>>()
    .mockRejectedValueOnce(new Error('Conflict'))
    .mockImplementation(async (input, version) => ({
      ...input,
      id: initial.id,
      version: version + 1,
    }));
  const { result } = setup(
    write,
    vi.fn(async () => remote),
  );
  await act(async () => {
    result.current.setField('name', 'My edit');
    result.current.commitFields(['name']);
    result.current.setField('email', 'Temporary');
    result.current.setField('email', initial.email);
  });
  await act(async () => result.current.reconcile());
  await act(async () => result.current.reapply());
  expect(result.current.values.email).toBe(initial.email);
  expect(result.current.confirmed.email).toBe(remote.email);
  expect(result.current.dirty).toBe(true);
});

test('keeps drafts on a failed reconciliation and adopts remote only on request', async () => {
  const remote = { ...initial, name: 'Server', version: 4 };
  const read = vi
    .fn<() => Promise<Row>>()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(remote);
  const write = vi.fn(async (): Promise<Row> => {
    throw Error('Unknown outcome');
  });
  const { result, onConfirmed } = setup(write, read);
  await act(async () => {
    result.current.setField('name', 'Mine');
    result.current.commitFields(['name']);
  });
  await act(async () => result.current.reconcile());
  expect(result.current.status).toBe('paused');
  expect(result.current.values.name).toBe('Mine');
  await act(async () => result.current.reconcile());
  act(() => result.current.useRemote());
  expect(result.current.values.name).toBe('Server');
  expect(result.current.dirty).toBe(false);
  expect(onConfirmed).toHaveBeenLastCalledWith(remote);
});

test('registers dirty drafts, in-flight writes and unresolved errors for navigation and unload', async () => {
  const pending = deferred<Row>();
  const { result, unmount } = setup(vi.fn(() => pending.promise));
  expect(hasUnsavedChanges()).toBe(false);
  act(() => {
    result.current.setField('name', 'Changed');
    result.current.commitFields(['name']);
  });
  expect(hasUnsavedChanges()).toBe(true);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () =>
    pending.resolve({ ...initial, name: 'Changed', version: 2 }),
  );
  expect(hasUnsavedChanges()).toBe(false);
  unmount();
  expect(hasUnsavedChanges()).toBe(false);
});
