import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PasswordPanel } from '../../apps/admin/src/PasswordPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fill(
  current = 'Fictional current password',
  next = 'Fictional new password',
  confirm = next,
) {
  for (const [label, value] of [
    ['Aktuelles Passwort', current],
    ['Neues Passwort', next],
    ['Neues Passwort wiederholen', confirm],
  ] as const)
    fireEvent.change(screen.getByLabelText(label, { exact: true }), {
      target: { value },
    });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Passwort ändern' }).closest('form')!,
  );
}
test('validates confirmation and policy before submitting and clears secrets after failure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  render(
    <PasswordPanel
      csrfToken="fictional-csrf"
      onChanged={vi.fn()}
      onSessionEnded={vi.fn()}
    />,
  );
  fill(undefined, 'x'.repeat(129));
  expect(screen.getByRole('status').textContent).toContain('128');
  fill(undefined, 'short');
  expect(screen.getByRole('status').textContent).toContain('15 Zeichen');
  fill(undefined, undefined, 'Fictional mismatch');
  expect(screen.getByRole('status').textContent).toContain('nicht überein');
  expect(fetcher).not.toHaveBeenCalled();
  fill();
  expect(await screen.findByText(/Aktuelles Passwort prüfen/)).toBeTruthy();
  for (const label of [
    'Aktuelles Passwort',
    'Neues Passwort',
    'Neues Passwort wiederholen',
  ])
    expect(
      (screen.getByLabelText(label, { exact: true }) as HTMLInputElement).value,
    ).toBe('');
  expect(fetcher).toHaveBeenCalledWith('/auth/password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': 'fictional-csrf',
    },
    body: JSON.stringify({
      currentPassword: 'Fictional current password',
      newPassword: 'Fictional new password',
    }),
  });
});
test('handles expired sessions, transport errors and successful session revocation', async () => {
  const changed = vi.fn(),
    ended = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  render(
    <PasswordPanel
      csrfToken="fictional-csrf"
      onChanged={changed}
      onSessionEnded={ended}
    />,
  );
  fill();
  await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
  fill();
  expect(await screen.findByText(/Verbindung fehlgeschlagen/)).toBeTruthy();
  fill();
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
});
