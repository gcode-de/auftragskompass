import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { EventNotes } from '../../apps/admin/src/EventNotes.js';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';

// QW3: the rich editor is covered by its own tests; here a plain field stands
// in for it so the list, the writes and their failures stay in focus.
vi.mock('../../apps/admin/src/MailBodyEditor.js', () => ({
  MailBodyEditor: (props: {
    label: string;
    value: string;
    disabled?: boolean;
    replaceKey?: number;
    onChange: (value: string) => void;
  }) => (
    <textarea
      key={props.replaceKey}
      aria-label={props.label}
      defaultValue={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const older = {
  id: 'note-old',
  bodyHtml: '<p>Ältere <strong>Notiz</strong></p>',
  createdAt: '2026-11-20T09:00:00Z',
  author: null,
};
const newer = {
  id: 'note-new',
  bodyHtml: '<p>Neue Notiz</p>',
  createdAt: '2026-11-25T10:00:00Z',
  author: 'notes.owner@example.invalid',
};

function server(initial: unknown[]) {
  let notes = [...initial];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const { bodyHtml } = JSON.parse(String(options.body)) as {
        bodyHtml: string;
      };
      if (bodyHtml.includes('zu lang'))
        return Response.json({ error: 'invalid_note' }, { status: 400 });
      notes = [{ ...newer, bodyHtml }, ...notes];
      return Response.json(notes, { status: 201 });
    }
    if (options?.method === 'DELETE') {
      notes = notes.filter(
        (note) => !url.endsWith((note as { id: string }).id),
      );
      return Response.json(notes);
    }
    return Response.json(notes);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

test('notes list newest first, a note is added and the composer empties', async () => {
  const fetcher = server([older]);
  render(<EventNotes eventId="event-1" csrfToken="csrf" />);
  const region = screen.getByRole('region', { name: 'Notizen' });
  expect(await within(region).findByText('Notiz')).toBeTruthy();
  expect(within(region).getByText('Übernommen')).toBeTruthy();

  const add = screen.getByRole('button', { name: 'Notiz hinzufügen' });
  expect(add).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Neue Notiz'), {
    target: { value: '<p>Kunde ruft zurück</p>' },
  });
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(add);
  await screen.findByText('Notiz hinzugefügt.');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/event-1/notes',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }),
      body: JSON.stringify({ bodyHtml: '<p>Kunde ruft zurück</p>' }),
    }),
  );
  const items = within(region).getAllByRole('listitem');
  expect(items[0]!.textContent).toContain('Kunde ruft zurück');
  expect(items[0]!.textContent).toContain('notes.owner@example.invalid');
  expect(
    (screen.getByLabelText('Neue Notiz') as HTMLTextAreaElement).value,
  ).toBe('');
  expect(hasUnsavedChanges()).toBe(false);
});

test('deleting asks first and a refused or failed write keeps the draft', async () => {
  const fetcher = server([newer, older]);
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  render(<EventNotes eventId="event-1" csrfToken="csrf" />);
  const [remove] = await screen.findAllByRole('button', {
    name: /^Löschen: Notiz vom /,
  });
  fireEvent.click(remove!);
  expect(confirm).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getAllByRole('button', { name: /^Löschen:/ })[0]!);
  await screen.findByText('Notiz gelöscht.');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/event-1/notes/note-new',
    expect.objectContaining({ method: 'DELETE' }),
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(1);

  fireEvent.change(screen.getByLabelText('Neue Notiz'), {
    target: { value: '<p>zu lang</p>' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Notiz hinzufügen' }));
  await screen.findByText('Die Notiz ist zu lang.');
  expect(
    (screen.getByLabelText('Neue Notiz') as HTMLTextAreaElement).value,
  ).toBe('<p>zu lang</p>');

  fetcher.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Notiz hinzufügen' }));
  await screen.findByText(/Verbindung fehlgeschlagen/);
  fetcher.mockResolvedValueOnce(new Response('', { status: 500 }));
  fireEvent.click(screen.getByRole('button', { name: 'Notiz hinzufügen' }));
  await screen.findByText(/konnte nicht gespeichert werden/);
});

test('an empty list says so and a failed load offers a retry', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal('fetch', fetcher);
  render(<EventNotes eventId="event-1" csrfToken="csrf" />);
  expect(screen.getByText('Notizen werden geladen …')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Erneut laden' }));
  expect(await screen.findByText('Noch keine Notizen.')).toBeTruthy();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});
