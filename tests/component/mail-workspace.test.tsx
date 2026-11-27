import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MailWorkspace } from '../../apps/admin/src/MailWorkspace.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('the mailbox opens in the inbox and switches to server-filtered folders', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/website-inquiries'))
      return Response.json({ items: [], total: 0, offset: 0, limit: 25 });
    if (url.endsWith('/mail/messages/synthetic-sent'))
      return Response.json({
        bodyText: '<script>Fictional text only</script>',
      });
    return Response.json(
      url.includes('folder=sent')
        ? [
            {
              id: 'synthetic-sent',
              subject: 'Synthetic sent mail',
              direction: 'out',
              createdAt: '2030-01-01T12:00:00Z',
              sentAt: null,
              to: 'fictional@example.invalid',
              sendState: 'sent',
            },
          ]
        : [],
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(
    <MailWorkspace csrfToken="csrf" onInquiryImported={vi.fn()} />,
  );
  const folders = screen.getByRole('navigation', { name: 'Mailordner' });
  expect(folders.textContent).toContain(
    'PosteingangGesendetEntwürfeGeplantFehlgeschlagenPapierkorb',
  );
  await screen.findByRole('heading', { name: 'Website-Anfragen' });
  fireEvent.click(screen.getByRole('button', { name: 'Gesendet' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Synthetic sent mail/ }),
  );
  await screen.findByText('<script>Fictional text only</script>');
  expect(container.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Papierkorb' }));
  await screen.findByText('Keine Mails in diesem Ordner.');
  expect(screen.queryByText('Synthetic sent mail')).toBeNull();
});

test('new, planned and failed mails support explicit save, reschedule and revision-aware resend', async () => {
  const row = {
    id: 'synthetic-row',
    createdAt: '2030-01-01T12:00:00Z',
    sentAt: null,
    subject: 'Synthetic mail',
    direction: 'out',
    to: 'synthetic@example.invalid',
    sendState: 'none',
    scheduledFor: null as string | null,
    sendErrorCode: null as string | null,
  };
  let folder = '';
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/v1/website-inquiries'))
      return Response.json({ items: [], total: 0, offset: 0, limit: 25 });
    if (url.endsWith('/compose')) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        saveAsDraft: true,
        subject: 'Synthetic edit',
      });
      folder = 'draft';
      return Response.json({ messageId: row.id }, { status: 202 });
    }
    if (url.endsWith('/reschedule')) {
      row.scheduledFor = JSON.parse(String(init?.body)).sendAt;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/unschedule')) {
      row.scheduledFor = null;
      row.sendState = 'none';
      folder = 'draft';
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/trash')) {
      folder = JSON.parse(String(init?.body)).restore ? 'draft' : 'trash';
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/send')) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        revision: 'synthetic-new',
      });
      row.sendState = 'scheduled';
      row.scheduledFor = '2090-01-01T11:00:00Z';
      folder = 'planned';
      return Response.json({}, { status: 201 });
    }
    if (url.endsWith('/synthetic-row')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
          revision: 'synthetic-old',
          subject: 'Synthetic revision',
        });
        row.subject = body.subject;
        return Response.json({ revision: 'synthetic-new' });
      }
      return Response.json({
        revision: 'synthetic-old',
        bodyText: 'Mail body',
        bodyHtml: '<p>Mail body</p>',
      });
    }
    return Response.json(
      url.includes('stateGroup=' + folder) ||
        (folder === 'trash' && url.includes('folder=trash'))
        ? [row]
        : [],
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<MailWorkspace csrfToken="csrf" onInquiryImported={vi.fn()} />);
  const button = (name: string | RegExp) =>
    screen.getByRole('button', { name });
  async function open(name = /Synthetic mail/) {
    fireEvent.click(await screen.findByRole('button', { name }));
    await screen.findByText('Mail body');
  }
  fireEvent.click(button('Neue Mail'));
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Synthetic edit' },
  });
  fireEvent.click(button('Als Entwurf speichern'));
  await screen.findByText('Entwurf gespeichert.');
  await open();
  fireEvent.click(button('In den Papierkorb'));
  await screen.findByText('Mail in den Papierkorb verschoben.');
  fireEvent.click(button('Papierkorb'));
  await open();
  fireEvent.click(button('Wiederherstellen'));
  await screen.findByText('Mail wiederhergestellt.');

  folder = 'failed';
  row.sendState = 'failed';
  row.sendErrorCode = 'provider_recipient_rejected';
  fireEvent.click(button('Fehlgeschlagen'));
  await open();
  expect(screen.getByText(/Empfängeradresse abgelehnt/)).toBeTruthy();
  fireEvent.click(button('Überarbeiten und erneut senden'));
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Synthetic revision' },
  });
  fireEvent.click(button('Senden'));
  await screen.findByText('Versand eingeplant.');
  await open(/Synthetic revision/);
  fireEvent.click(button('Planung ändern'));
  fireEvent.change(screen.getByLabelText('Neue Versandzeit'), {
    target: { value: '2090-01-02T13:00' },
  });
  fireEvent.click(button('Zeit speichern'));
  await screen.findByText('Versandzeit geändert.');
  await open(/Synthetic revision/);
  fireEvent.click(button('Planung aufheben'));
  await screen.findByText(
    'Planung aufgehoben. Die Mail liegt in den Entwürfen.',
  );
  expect(screen.getByRole('heading', { name: 'Entwürfe' })).toBeTruthy();
});

test('a mailbox page preserves older results, incoming metadata and unsaved edits', async () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: 'synthetic-later-' + index,
    subject: 'Synthetic newer message ' + index,
    direction: 'in',
    from: 'incoming@example.invalid',
    to: 'team@example.invalid',
    eventId: 'synthetic-event',
    createdAt: '2040-01-01T10:00:00Z',
    sentAt: null,
    sendState: 'none',
  }));
  const older = {
    ...messages[0]!,
    id: 'synthetic-older',
    subject: '',
    eventId: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/v1/website-inquiries'))
        return Response.json({ items: [], total: 0, offset: 0, limit: 25 });
      if (url.includes('/messages?'))
        return Response.json(url.includes('offset=100') ? [older] : messages);
      return Response.json({ bodyText: '', cc: 'copy@example.invalid' });
    }),
  );
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  render(<MailWorkspace csrfToken="csrf" onInquiryImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ältere Mails' }));
  const entry = await screen.findByRole('button', { name: /ohne Betreff/ });
  fireEvent.click(entry);
  await screen.findByText('(ohne Text)');
  expect(screen.getByText('Von', { exact: true })).toBeTruthy();
  expect(screen.getByText('copy@example.invalid')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '← Zurück' }));
  fireEvent.click(screen.getByRole('button', { name: 'Neuere Mails' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Synthetic newer message 0/ }),
  );
  expect(await screen.findByRole('link', { name: 'Zum Event' })).toHaveProperty(
    'hash',
    '#event-synthetic-event',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Neue Mail' }));
  expect(screen.getByLabelText('Empfänger')).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText('Empfänger'), {
    target: { value: 'draft@example.invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gesendet' }));
  expect(screen.getByLabelText('Empfänger')).toHaveProperty(
    'value',
    'draft@example.invalid',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Gesendet' }));
  expect(screen.queryByLabelText('Empfänger')).toBeNull();
  expect(confirm).toHaveBeenCalledTimes(2);
});

test.each([
  ['invalid_send_at', 'Bitte eine Uhrzeit in der Zukunft wählen.'],
  [
    'not_sendable',
    'Der Versandstatus hat sich geändert. Bitte die Mail erneut öffnen.',
  ],
  ['invalid_recipients', 'Bitte eine gültige Empfängeradresse eingeben.'],
  ['invalid_subject', 'Bitte einen Betreff eingeben.'],
  [
    'invalid_account',
    'Unter Einstellungen → E-Mail bitte ein aktives Versandkonto einrichten.',
  ],
  [
    'missing_placeholder',
    'Bitte fehlende Platzhalterwerte in Betreff und Nachricht ergänzen.',
  ],
  [
    'network',
    'Die Mailaktion konnte nicht abgeschlossen werden. Bitte den aktuellen Stand prüfen.',
  ],
])('the composer preserves edits on %s', async (error, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/compose'))
        return error === 'network'
          ? new Response(null, { status: 503 })
          : Response.json({ error }, { status: 400 });
      if (url.startsWith('/api/v1/website-inquiries'))
        return Response.json({ items: [], total: 0, offset: 0, limit: 25 });
      return Response.json([]);
    }),
  );
  render(<MailWorkspace csrfToken="csrf" onInquiryImported={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Neue Mail' }));
  fireEvent.change(screen.getByLabelText('Empfänger'), {
    target: { value: 'synthetic@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Betreff'), {
    target: { value: 'Synthetic subject' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
  await screen.findByText(message);
  expect(screen.getByLabelText('Betreff')).toHaveProperty(
    'value',
    'Synthetic subject',
  );
});
