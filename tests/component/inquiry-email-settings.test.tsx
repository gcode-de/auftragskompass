import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InquiryEmailSettingsPanel } from '../../apps/admin/src/InquiryEmailSettingsPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('saves the target addresses and the on/off switch with CSRF', async () => {
  let settings = { enabled: false, recipients: '' };
  const calls: { path: string; options: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      calls.push({ path, options });
      if (!options) return Response.json(settings);
      if (options.method === 'PUT')
        settings = JSON.parse(options.body as string);
      return new Response(null, { status: 204 });
    }),
  );

  render(<InquiryEmailSettingsPanel csrfToken="fictional-csrf" />);
  const recipients = await screen.findByLabelText('Zieladresse(n)');
  const toggle = screen.getByLabelText('E-Mail-Benachrichtigung aktiv');
  expect((toggle as HTMLInputElement).checked).toBe(false);
  fireEvent.change(recipients, {
    target: { value: 'fictional.inbox@example.invalid' },
  });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('E-Mail-Benachrichtigung gespeichert.');

  const put = calls.find(({ options }) => options?.method === 'PUT')!;
  expect(put.path).toBe('/api/v1/settings/inquiry-email');
  expect(put.options?.headers).toEqual({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  expect(JSON.parse(put.options?.body as string)).toEqual({
    enabled: true,
    recipients: 'fictional.inbox@example.invalid',
  });
  expect(
    (screen.getByLabelText('Zieladresse(n)') as HTMLInputElement).value,
  ).toBe('fictional.inbox@example.invalid');
  expect(screen.getByText('Status: Aktiv')).toBeTruthy();
});

test('refuses to activate without an address and reports failed writes', async () => {
  let failWrite = false;
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, options?: RequestInit) => {
      if (!options) return Response.json({ enabled: false, recipients: '' });
      calls.push(options);
      return new Response(null, { status: failWrite ? 503 : 204 });
    }),
  );

  render(<InquiryEmailSettingsPanel csrfToken="fictional-csrf" />);
  const toggle = await screen.findByLabelText('E-Mail-Benachrichtigung aktiv');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain(
    'Bitte eine Zieladresse angeben',
  );
  expect(calls).toHaveLength(0);

  fireEvent.change(screen.getByLabelText('Zieladresse(n)'), {
    target: { value: 'fictional.inbox@example.invalid' },
  });
  failWrite = true;
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText(/Speichern nicht bestätigt/);
  expect(calls).toHaveLength(1);
});
