import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { TelegramSettingsPanel } from '../../apps/admin/src/TelegramSettingsPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('sets up or replaces a bot without ever reading its token back, then disables it', async () => {
  let settings = { configured: false, chatId: null as string | null };
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      calls.push({ path, options });
      if (!options) return Response.json(settings);
      if (options.method === 'PUT')
        settings = {
          configured: true,
          chatId: JSON.parse(options.body as string).chatId,
        };
      if (options.method === 'DELETE')
        settings = { configured: false, chatId: null };
      return new Response(null, { status: 204 });
    }),
  );

  render(<TelegramSettingsPanel csrfToken="fictional-csrf" />);
  const token = await screen.findByLabelText('Bot-Token');
  fireEvent.change(token, { target: { value: 'fictional-secret-token' } });
  fireEvent.change(screen.getByLabelText('Chat-ID'), {
    target: { value: 'fictional-chat-42' },
  });
  fireEvent.change(screen.getByLabelText('Topic-ID (optional)'), {
    target: { value: '12345' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('Telegram-Einstellungen gespeichert.');

  const put = calls.find(({ options }) => options?.method === 'PUT')!;
  expect(put.path).toBe('/api/v1/settings/telegram');
  expect(put.options?.headers).toEqual({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(JSON.parse(put.options?.body as string)).toEqual({
    botToken: 'fictional-secret-token',
    chatId: 'fictional-chat-42',
    topicId: '12345',
  });
  expect((token as HTMLInputElement).value).toBe('');
  expect(screen.getByText('Status: Eingerichtet')).toBeTruthy();

  fireEvent.change(token, { target: { value: 'fictional-replacement-token' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Einstellungen aktualisieren' }),
  );
  await screen.findByText('Telegram-Einstellungen gespeichert.');
  const puts = calls.filter(({ options }) => options?.method === 'PUT');
  expect(JSON.parse(puts[1]!.options?.body as string).botToken).toBe(
    'fictional-replacement-token',
  );
  expect((token as HTMLInputElement).value).toBe('');

  fireEvent.click(
    screen.getByRole('button', { name: 'Telegram deaktivieren' }),
  );
  await screen.findByText('Telegram-Benachrichtigungen deaktiviert.');
  const deletion = calls.find(({ options }) => options?.method === 'DELETE')!;
  expect(deletion.path).toBe('/api/v1/settings/telegram');
  expect(deletion.options?.headers).toEqual({
    'x-csrf-token': 'fictional-csrf',
  });
  expect(screen.getByText('Status: Nicht eingerichtet')).toBeTruthy();
});

test('shows a reload action for load errors and reports failed writes', async () => {
  let failLoad = true;
  let failWrite = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, options?: RequestInit) => {
      if (options) return new Response(null, { status: failWrite ? 503 : 204 });
      return failLoad
        ? new Response(null, { status: 503 })
        : Response.json({ configured: false, chatId: null });
    }),
  );
  render(<TelegramSettingsPanel csrfToken="fictional-csrf" />);
  await screen.findByRole('alert');
  failLoad = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Einstellungen neu laden' }),
  );
  await screen.findByRole('button', { name: 'Speichern' });
  fireEvent.change(screen.getByLabelText('Bot-Token'), {
    target: { value: 'fictional-secret-token' },
  });
  fireEvent.change(screen.getByLabelText('Chat-ID'), {
    target: { value: 'fictional-chat-42' },
  });
  failWrite = true;
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText(/Speichern nicht bestätigt/);
  expect((screen.getByLabelText('Bot-Token') as HTMLInputElement).value).toBe(
    'fictional-secret-token',
  );
});

test('keeps configured state on failed disable, reload, and reconciliation requests', async () => {
  const failDelete = true;
  let failLoad = false;
  const settings = { configured: true, chatId: 'fictional-chat-84' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, options?: RequestInit) => {
      if (options?.method === 'DELETE')
        return new Response(null, { status: failDelete ? 503 : 204 });
      if (options?.method === 'PUT') return new Response(null, { status: 204 });
      if (failLoad) return new Response(null, { status: 503 });
      return Response.json(settings);
    }),
  );

  render(<TelegramSettingsPanel csrfToken="fictional-csrf" />);
  await screen.findByRole('button', { name: 'Telegram deaktivieren' });
  expect((screen.getByLabelText('Chat-ID') as HTMLInputElement).value).toBe(
    settings.chatId,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Telegram deaktivieren' }),
  );
  await screen.findByText(/Deaktivierung nicht bestätigt/);
  expect(screen.getByText('Status: Eingerichtet')).toBeTruthy();

  failLoad = true;
  fireEvent.click(
    screen.getByRole('button', { name: 'Einstellungen neu laden' }),
  );
  await screen.findByText(
    'Telegram-Einstellungen konnten nicht geladen werden.',
  );
  expect(
    screen.getByRole('button', { name: 'Einstellungen neu laden' }),
  ).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Bot-Token'), {
    target: { value: 'fictional-secret-token' },
  });
  fireEvent.change(screen.getByLabelText('Chat-ID'), {
    target: { value: 'fictional-chat-99' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Einstellungen aktualisieren' }),
  );
  await screen.findByText(/Speichern nicht bestätigt/);
  expect((screen.getByLabelText('Bot-Token') as HTMLInputElement).value).toBe(
    '',
  );

  failLoad = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Einstellungen neu laden' }),
  );
  await screen.findByRole('button', { name: 'Telegram deaktivieren' });
});

test('does not update state when initial settings resolve after unmount', async () => {
  const pending: {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    ),
  );

  const first = render(<TelegramSettingsPanel csrfToken="fictional-csrf" />);
  first.unmount();
  await act(async () => {
    pending[0]!.resolve(Response.json({ configured: false, chatId: null }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const second = render(<TelegramSettingsPanel csrfToken="fictional-csrf" />);
  second.unmount();
  await act(async () => {
    pending[1]!.reject(Error('fictional network failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
