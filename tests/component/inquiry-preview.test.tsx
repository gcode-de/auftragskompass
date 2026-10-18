import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InquiryPreview } from '../../apps/admin/src/InquiryPreview.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test('previews every existing field and checks locally without sending or storing inputs', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => inquiryFormV1 });
  vi.stubGlobal('fetch', fetcher);
  render(<InquiryPreview />);
  await screen.findByLabelText('Vorname *');
  for (const field of inquiryFormV1.fields) {
    const input = screen.getByLabelText(
      field.label + (field.required ? ' *' : ' (optional)'),
    );
    expect((input as HTMLInputElement).required).toBe(field.required);
  }
  expect(screen.getAllByRole('option')).toHaveLength(4);
  expect(
    screen
      .getByRole('link', { name: 'Datenschutzerklärung' })
      .getAttribute('href'),
  ).toBe(inquiryFormV1.privacyUrl);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Eingaben prüfen' }).closest('form')!,
  );
  expect(screen.getByRole('status').textContent).toContain('nichts versendet');
  expect(fetcher.mock.calls).toEqual([
    ['/api/v1/website-inquiries/form-definition'],
  ]);
  fireEvent.change(screen.getByLabelText('Vorname *'), {
    target: { value: 'Fictional' },
  });
  expect(screen.queryByRole('status')).toBeNull();
});
test('failed loading offers a retry without rendering a usable form', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ok: false });
  vi.stubGlobal('fetch', fetcher);
  render(<InquiryPreview />);
  expect(screen.getByRole('status').textContent).toContain('geladen');
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Eingaben prüfen' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
  await screen.findByRole('alert');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
