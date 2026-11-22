import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MailTemplatesPanel } from '../../apps/admin/src/MailTemplatesPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// MAIL-TPL-01b: synthetic templates only; every fetch stub answers fictional
// data and no request ever leaves the test.
const summary = {
  id: '44444444-0000-4000-8000-000000000001',
  name: 'Zahlungserinnerung',
  subject: 'Erinnerung für {{contact}}',
  state: 'active',
  version: 3,
};
const detail = { ...summary, bodyHtml: '<p>Hallo {{contactFirstName}}</p>' };

function stubTemplateFetch(
  handlers: {
    list?: unknown[];
    detail?: unknown;
    preview?: unknown;
    write?: { status: number; body: unknown };
    failList?: boolean;
  } = {},
) {
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  let failedOnce = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      calls.push({ path, options });
      if (!options) {
        if (path === '/api/v1/mail-templates') {
          if (handlers.failList && !failedOnce) {
            failedOnce = true;
            throw Error('fiktive Netzwerkstörung');
          }
          return Response.json(handlers.list ?? [summary]);
        }
        return Response.json(handlers.detail ?? detail);
      }
      if (path === '/api/v1/mail-templates/preview')
        return Response.json(
          handlers.preview ?? {
            subject: 'Erinnerung für Alex Beispiel',
            bodyHtml: '<p>Hallo Alex Paket Beispiel</p>',
            bodyText: 'Hallo Alex Paket Beispiel',
            missing: ['package'],
          },
        );
      if (handlers.write)
        return Response.json(handlers.write.body, {
          status: handlers.write.status,
        });
      return Response.json(handlers.detail ?? detail);
    }),
  );
  return calls;
}

test('lists templates with their state and opens the editor with the stored body', async () => {
  const calls = stubTemplateFetch();
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findByText('Zahlungserinnerung (Aktiv)');
  fireEvent.click(
    screen.getByRole('button', { name: 'Zahlungserinnerung bearbeiten' }),
  );
  await waitFor(() =>
    expect(
      calls.some(
        (call) => call.path === '/api/v1/mail-templates/' + summary.id,
      ),
    ).toBe(true),
  );
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
    'Zahlungserinnerung',
  );
  expect((screen.getByLabelText('Betreff') as HTMLInputElement).value).toBe(
    'Erinnerung für {{contact}}',
  );
  // The fetched body arrives late and lands in the editor exactly once.
  const editor = screen.getByRole('textbox', { name: 'Text (optional)' });
  await waitFor(() =>
    expect(editor.textContent).toContain('{{contactFirstName}}'),
  );
});

test('creating a template posts the edited content and confirms the save', async () => {
  const calls = stubTemplateFetch({ list: [] });
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' }),
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Dank' },
  });
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Danke {{contact}}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
  await screen.findByText('E-Mail-Vorlage gespeichert.');
  const post = calls.find(({ options }) => options?.method === 'POST')!;
  expect(post.path).toBe('/api/v1/mail-templates');
  expect(JSON.parse(String(post.options?.body))).toMatchObject({
    name: 'Dank',
    subject: 'Danke {{contact}}',
    bodyHtml: '',
    state: 'active',
  });
  expect(post.options?.headers).toMatchObject({
    'x-csrf-token': 'fictional-csrf',
  });
});

test('archiving is a visible state change sent with the version', async () => {
  const calls = stubTemplateFetch({
    list: [{ ...summary, state: 'archived' }],
    detail: { ...detail, state: 'archived' },
    write: { status: 200, body: { ...summary, state: 'archived', version: 4 } },
  });
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Zahlungserinnerung bearbeiten',
    }),
  );
  await screen.findByRole('textbox', { name: 'Text (optional)' });
  fireEvent.change(screen.getByLabelText('Zustand'), {
    target: { value: 'archived' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
  await screen.findByText('E-Mail-Vorlage gespeichert.');
  const put = calls.find(({ options }) => options?.method === 'PUT')!;
  expect(put.path).toBe('/api/v1/mail-templates/' + summary.id);
  expect(JSON.parse(String(put.options?.body))).toMatchObject({
    state: 'archived',
    version: 3,
  });
  await screen.findByText('Zahlungserinnerung (Archiviert)');
});

test('the preview shows the example result and names missing values', async () => {
  stubTemplateFetch();
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }));
  await screen.findByText(
    'Beispielvorschau – Betreff: Erinnerung für Alex Beispiel',
  );
  expect(screen.getByText('Hallo Alex Paket Beispiel')).toBeTruthy();
  expect(
    screen.getByText(/Ohne Beispielwert bleiben sichtbar: \{\{package\}\}\./),
  ).toBeTruthy();
});

test('a refused save names the problem and keeps the form', async () => {
  stubTemplateFetch({
    write: { status: 409, body: { error: 'conflict' } },
  });
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Zahlungserinnerung bearbeiten',
    }),
  );
  await screen.findByRole('textbox', { name: 'Text (optional)' });
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
  await screen.findByText(
    'Die Vorlage wurde inzwischen geändert. Bitte neu laden und erneut bearbeiten.',
  );
  // The draft stays; nothing claims success.
  expect(screen.queryByText('E-Mail-Vorlage gespeichert.')).toBeNull();
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
    'Zahlungserinnerung',
  );
});

test('a failed load offers a pure GET retry', async () => {
  const calls = stubTemplateFetch({ failList: true });
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  await screen.findByText('E-Mail-Vorlagen konnten nicht geladen werden.');
  fireEvent.click(screen.getByRole('button', { name: 'Vorlagen neu laden' }));
  await screen.findByText('Zahlungserinnerung (Aktiv)');
  expect(calls.every(({ options }) => options === undefined)).toBe(true);
});

test('Abbrechen leaves the form without a write', async () => {
  const calls = stubTemplateFetch();
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Zahlungserinnerung bearbeiten',
    }),
  );
  await screen.findByRole('textbox', { name: 'Text (optional)' });
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' });
  expect(calls.every(({ options }) => options === undefined)).toBe(true);
});

test('every refusal code names its message and a dead preview is honest', async () => {
  let code = 'invalid_name';
  let failNetwork = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return Response.json([summary]);
      if (path === '/api/v1/mail-templates/preview') {
        if (failNetwork) throw Error('fiktive Netzwerkstörung');
        return Response.json({ error: code }, { status: 400 });
      }
      return Response.json(detail);
    }),
  );
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' }),
  );
  const messages: [string, string][] = [
    ['invalid_name', 'Der Name ist nicht gültig.'],
    [
      'invalid_subject',
      'Der Betreff ist nicht gültig. Erlaubt sind einzeilige Texte ohne Steuerzeichen.',
    ],
    ['invalid_body', 'Der Text ist zu lang.'],
    ['invalid_state', 'Der Zustand ist nicht gültig.'],
    [
      'invalid_content',
      'Unbekannter Platzhalter. Nur die Platzhalter aus der Auswahl verwenden; die Eingaben bleiben erhalten.',
    ],
    ['not_found', 'Die Vorlage wurde nicht gefunden.'],
    [
      'unknown-code',
      'Speichern nicht bestätigt. Zustand prüfen, bevor du erneut speicherst.',
    ],
  ];
  for (const [value, text] of messages) {
    code = value;
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }));
    await screen.findByText(text);
  }
  failNetwork = true;
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }));
  await screen.findByText('Die Vorschau konnte nicht geladen werden.');
});

test('a failing detail load returns to the list with a named problem', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (!options && path !== '/api/v1/mail-templates')
        throw Error('fiktive Netzwerkstörung');
      if (!options) return Response.json([summary]);
      return Response.json(detail);
    }),
  );
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Zahlungserinnerung bearbeiten',
    }),
  );
  await screen.findByText('Die Vorlage konnte nicht geladen werden.');
  await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' });
});

test('a save that cannot reload the list is still honestly confirmed', async () => {
  let listCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) {
        listCalls++;
        if (listCalls > 1) throw Error('fiktive Netzwerkstörung');
        return Response.json([]);
      }
      return Response.json(detail, { status: 201 });
    }),
  );
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' }),
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Dank' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
  await screen.findByText(
    'Gespeichert, aber die Liste konnte nicht neu geladen werden.',
  );
});

test('an unconfirmed save keeps the form and names the uncertainty', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return Response.json([]);
      throw Error('fiktive Netzwerkstörung');
    }),
  );
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' }),
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Dank' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
  await screen.findByText(
    'Speichern nicht bestätigt. Zustand prüfen, bevor du erneut speicherst.',
  );
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
    'Dank',
  );
});

test('a preview without formatted body shows its text alternative', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return Response.json([summary]);
      return Response.json({
        subject: 'Betreff Vorschau',
        bodyHtml: '',
        bodyText: 'Nur Text.',
        missing: [],
      });
    }),
  );
  render(<MailTemplatesPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'E-Mail-Vorlage anlegen' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }));
  await screen.findByText('Nur Text.');
});
