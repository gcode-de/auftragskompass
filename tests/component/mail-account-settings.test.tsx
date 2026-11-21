import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MailAccountSettingsPanel } from '../../apps/admin/src/MailAccountSettingsPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const account = {
  id: '8b1c4a2e-0000-4000-8000-000000000001',
  name: 'Fictional Versandkonto',
  fromName: 'Fotobox Muster',
  fromAddress: 'versand@example.invalid',
  smtpHost: 'smtp.example.invalid',
  smtpPort: 587,
  smtpSecurity: 'starttls',
  username: 'synthetic.sender@example.invalid',
  enabled: true,
  hasSecret: true,
};

function fillForm() {
  fireEvent.change(screen.getByLabelText('Kontoname'), {
    target: { value: 'Fictional Versandkonto' },
  });
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Fotobox Muster' },
  });
  fireEvent.change(screen.getByLabelText('Absenderadresse'), {
    target: { value: 'versand@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('SMTP-Server'), {
    target: { value: 'smtp.example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('SMTP-Port'), {
    target: { value: '587' },
  });
  fireEvent.change(screen.getByLabelText('Transportverschlüsselung'), {
    target: { value: 'starttls' },
  });
  fireEvent.change(screen.getByLabelText('Benutzername'), {
    target: { value: 'synthetic.sender@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'fictional-secret-password' },
  });
}

test('creates a sending account and never reads the password back', async () => {
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      calls.push({ path, options });
      if (!options) return Response.json([]);
      return Response.json(account, { status: 201 });
    }),
  );

  render(<MailAccountSettingsPanel csrfToken="fictional-csrf" />);
  // With no account yet the form is shown right away.
  await screen.findByLabelText('Kontoname');
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('Versandkonto gespeichert.');

  const post = calls.find(({ options }) => options?.method === 'POST')!;
  expect(post.path).toBe('/api/v1/mail/accounts');
  expect(post.options?.headers).toEqual({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(JSON.parse(post.options?.body as string)).toEqual({
    name: 'Fictional Versandkonto',
    fromName: 'Fotobox Muster',
    fromAddress: 'versand@example.invalid',
    smtpHost: 'smtp.example.invalid',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    username: 'synthetic.sender@example.invalid',
    enabled: true,
    secret: 'fictional-secret-password',
  });
  // The password field is cleared after the save and never prefilled.
  expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe(
    '',
  );
});

test('an empty password keeps the sealed one when changing an account', async () => {
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      calls.push({ path, options });
      if (!options) return Response.json([account]);
      return Response.json({ ...account, fromName: 'Neuer Absender' });
    }),
  );

  render(<MailAccountSettingsPanel csrfToken="fictional-csrf" />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Fictional Versandkonto bearbeiten',
    }),
  );
  expect(
    screen.getByText(/Leer lassen, um es unverändert beizubehalten/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Absendername'), {
    target: { value: 'Neuer Absender' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await screen.findByText('Versandkonto gespeichert.');

  const put = calls.find(({ options }) => options?.method === 'PUT')!;
  expect(put.path).toBe(`/api/v1/mail/accounts/${account.id}`);
  const body = JSON.parse(put.options?.body as string);
  expect(body.fromName).toBe('Neuer Absender');
  // No password typed: the key is absent, the sealed secret stays untouched.
  expect(body).not.toHaveProperty('secret');
});

test('a refused save names the problem and keeps the input', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, options?: RequestInit) => {
      if (!options) return Response.json([]);
      return Response.json({ error: 'secret_required' }, { status: 400 });
    }),
  );

  render(<MailAccountSettingsPanel csrfToken="fictional-csrf" />);
  await screen.findByLabelText('Kontoname');
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('Für ein aktives Konto wird ein Passwort benötigt.');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect((screen.getByLabelText('Kontoname') as HTMLInputElement).value).toBe(
    'Fictional Versandkonto',
  );
});

test('a load failure offers a reload and shows no invented accounts', async () => {
  let attempt = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return new Response(null, { status: 500 });
      return Response.json([]);
    }),
  );

  render(<MailAccountSettingsPanel csrfToken="fictional-csrf" />);
  await screen.findByText('E-Mail-Einstellungen konnten nicht geladen werden.');
  fireEvent.click(
    screen.getByRole('button', { name: 'Einstellungen neu laden' }),
  );
  // The reloaded empty state shows the form, never invented accounts.
  await screen.findByLabelText('Kontoname');
  expect(screen.queryByText('Versandkonten')).toBeNull();
});
