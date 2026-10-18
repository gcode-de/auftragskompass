import { afterEach, test, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WebsiteInquiry } from '../../apps/admin/src/WebsiteInquiry.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const original = {
  formId: 'fotobox-bw-main',
  formVersion: 1,
  receivedAt: '2030-10-26T10:00:00.000Z',
  fields: [
    { label: 'Vorname', value: 'Fictional' },
    { label: 'Nachname', value: 'Example' },
    { label: 'E-Mail', value: 'fictional@example.invalid' },
    { label: 'Veranstaltungsdatum', value: '27.10.2030' },
    { label: 'Telefonnummer', value: '' },
    { label: 'Veranstaltungsort', value: 'Fictional venue' },
    {
      label: 'Gewünschtes Fotobox-Paket',
      value: 'easy print+ (400 Ausdrucke, Drucklayout)',
    },
    {
      label: 'Kommentar',
      value: '<script>fictional</script>\n' + 'x'.repeat(5000),
    },
  ],
  privacyNotice: 'Fictional original privacy notice',
  privacyUrl: 'https://fictional.example.invalid/privacy',
};
function open() {
  const details = screen
    .getByText('Originalanfrage der Website')
    .closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  return details;
}
test('loads only when opened and preserves long original values as text without writes', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(original));
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <WebsiteInquiry eventId="fictional-event" timeZone="Europe/Berlin" />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  open();
  await screen.findByText('Fictional original privacy notice');
  expect(view.container.querySelectorAll('dt')).toHaveLength(8);
  expect(screen.getByText('Nicht angegeben')).toBeTruthy();
  expect(screen.getByText(/<script>fictional/).textContent).toContain(
    'x'.repeat(5000),
  );
  expect(view.container.querySelector('script')).toBeNull();
  expect(
    screen
      .getByRole('link', { name: 'Damals verlinkte Datenschutzerklärung' })
      .getAttribute('href'),
  ).toBe(original.privacyUrl);
  open();
  expect(fetcher.mock.calls).toEqual([
    ['/api/v1/events/fictional-event/website-inquiry'],
  ]);
});
test('loading and errors allow an explicit retry without losing the disclosure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(Response.json(original));
  vi.stubGlobal('fetch', fetcher);
  render(<WebsiteInquiry eventId="fictional-event" timeZone="UTC" />);
  open();
  expect(screen.getByRole('status').textContent).toContain('geladen');
  await screen.findByRole('alert');
  fireEvent.click(
    screen.getByRole('button', { name: 'Originalanfrage erneut laden' }),
  );
  await screen.findByRole('alert');
  fireEvent.click(
    screen.getByRole('button', { name: 'Originalanfrage erneut laden' }),
  );
  await screen.findByText('Fictional original privacy notice');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
