import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { InquiryForm } from '../../apps/widget/src/InquiryForm.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test('shows actionable field errors, focuses the first and clears them as values are fixed', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<InquiryForm gatewayOrigin="https://gateway.example.invalid" />);
  const honeypot = document.querySelector('input[name="website"]')!;
  fireEvent.input(honeypot, { target: { value: 'synthetic' } });
  fireEvent.blur(honeypot);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Anfrage senden' }).closest('form')!,
  );
  const first = screen.getByLabelText('Vorname *');
  expect(first.getAttribute('aria-invalid')).toBe('true');
  await waitFor(() => expect(document.activeElement).toBe(first));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.input(first, { target: { value: 'Ada' } });
  expect(first.getAttribute('aria-invalid')).toBeNull();
  expect(screen.getByLabelText('Nachname *').getAttribute('aria-invalid')).toBe(
    'true',
  );
  const tel = screen.getByLabelText('Telefonnummer (optional)');
  fireEvent.input(tel, { target: { value: 'falsch' } });
  fireEvent.blur(tel);
  expect(tel.getAttribute('aria-invalid')).toBe('true');
  const error = screen.getByText(/Telefonnummer mit Ziffern/);
  expect(tel.getAttribute('aria-describedby')).toBe(error.id);
  fireEvent.input(tel, { target: { value: '+49 (0) 123-456' } });
  expect(tel.getAttribute('aria-invalid')).toBeNull();
});

test('shows the server name-length limit at the last-name field', () => {
  render(<InquiryForm gatewayOrigin="https://gateway.example.invalid" />);
  fireEvent.input(screen.getByLabelText('Vorname *'), {
    target: { value: 'A'.repeat(100) },
  });
  fireEvent.input(screen.getByLabelText('Nachname *'), {
    target: { value: 'B'.repeat(100) },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Anfrage senden' }).closest('form')!,
  );
  expect(screen.getByText(/Vor- und Nachname dürfen zusammen/)).toBeTruthy();
});

test('explains email and date errors and submits corrected values', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ status: 'received' }, { status: 202 }));
  vi.stubGlobal('fetch', fetcher);
  render(<InquiryForm gatewayOrigin="https://gateway.example.invalid" />);
  const first = screen.getByLabelText('Vorname *');
  const last = screen.getByLabelText('Nachname *');
  const email = screen.getByLabelText('E-Mail *');
  const date = screen.getByLabelText('Veranstaltungsdatum *');
  fireEvent.input(first, { target: { value: 'Fiktiv' } });
  fireEvent.input(last, { target: { value: 'Beispiel' } });
  fireEvent.input(email, { target: { value: 'nicht-gültig' } });
  expect(
    screen.getByText('Bitte geben Sie eine gültige E-Mail-Adresse ein.'),
  ).toBeTruthy();
  fireEvent.blur(date);
  expect(date.getAttribute('aria-invalid')).toBe('true');
  fireEvent.input(email, { target: { value: 'fiktiv@example.invalid' } });
  fireEvent.input(date, { target: { value: '2030-10-27' } });
  expect(email.getAttribute('aria-invalid')).toBeNull();
  expect(date.getAttribute('aria-invalid')).toBeNull();
  fireEvent.submit(
    screen.getByRole('button', { name: 'Anfrage senden' }).closest('form')!,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await screen.findByText(/Ihre Anfrage ist eingegangen/);
});
