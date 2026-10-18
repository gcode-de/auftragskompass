import { afterEach, test, expect, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { InquiryForm } from '../../apps/widget/src/InquiryForm.js';
const origin = 'https://fictional-gateway.example.invalid';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fill() {
  fireEvent.change(screen.getByLabelText('Vorname *'), {
    target: { value: 'Fictional' },
  });
  fireEvent.change(screen.getByLabelText('Nachname *'), {
    target: { value: 'Visitor' },
  });
  fireEvent.change(screen.getByLabelText('E-Mail *'), {
    target: { value: 'visitor@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Veranstaltungsdatum *'), {
    target: { value: '2030-10-27' },
  });
}
function submit() {
  fireEvent.submit(
    screen
      .getByRole('button', {
        name: /Anfrage senden|Erneut senden|Wird gesendet/,
      })
      .closest('form')!,
  );
}
test('all eight original labels, required flags, package values and privacy remain readable without adding visible fields', () => {
  render(<InquiryForm gatewayOrigin={origin} />);
  for (const label of [
    'Vorname *',
    'Nachname *',
    'E-Mail *',
    'Veranstaltungsdatum *',
  ])
    expect((screen.getByLabelText(label) as HTMLInputElement).required).toBe(
      true,
    );
  for (const label of [
    'Telefonnummer (optional)',
    'Veranstaltungsort (optional)',
    'Gewünschtes Fotobox-Paket (optional)',
    'Kommentar (optional)',
  ])
    expect((screen.getByLabelText(label) as HTMLInputElement).required).toBe(
      false,
    );
  expect(
    screen.getByRole('option', {
      name: 'easy print+ (400 Ausdrucke, Drucklayout)',
    }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole('link', { name: 'Datenschutzerklärung' })
      .getAttribute('href'),
  ).toBe('https://fotobox-bw.de/impressum-datenschutz/');
  expect(screen.queryByLabelText(/Land/)).toBeNull();
});
test('uncertain receipt keeps the same frozen request and disables editing until the retry is confirmed, without echoing inputs', async () => {
  const bodies: string[] = [];
  let first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options?: RequestInit) => {
      bodies.push(options!.body as string);
      if (first) {
        first = false;
        throw new Error('fictional private failure');
      }
      return Response.json({ status: 'received' }, { status: 202 });
    }),
  );
  render(<InquiryForm gatewayOrigin={origin} />);
  fill();
  submit();
  await screen.findByText(/Eingang ist noch unklar/);
  expect(
    (screen.getByLabelText('Vorname *') as HTMLInputElement).readOnly,
  ).toBe(true);
  expect(screen.getByRole('alert').textContent).not.toContain(
    'fictional private failure',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Erneut senden' }));
  await screen.findByText(/Ihre Anfrage ist eingegangen/);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(screen.queryByLabelText('Vorname *')).toBeNull();
  expect(screen.getByRole('status').textContent).not.toContain('Visitor');
  expect(screen.getByRole('status').textContent).toContain('keine Buchung');
});
test('server rejection permits correction; rate limiting preserves the existing attempt and explains recovery', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  render(<InquiryForm gatewayOrigin={origin} />);
  fill();
  submit();
  await screen.findByText(/Bitte prüfen Sie Ihre Angaben/);
  expect((screen.getByLabelText('E-Mail *') as HTMLInputElement).readOnly).toBe(
    false,
  );
  fireEvent.change(screen.getByLabelText('E-Mail *'), {
    target: { value: 'corrected@example.invalid' },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 429 })),
  );
  submit();
  await screen.findByText(/Bitte warten Sie etwas/);
  expect((screen.getByLabelText('E-Mail *') as HTMLInputElement).readOnly).toBe(
    true,
  );
});
test('invalid configuration never sends and an unmounted form ignores late completion', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <InquiryForm gatewayOrigin="http://fictional.example.invalid" />,
  );
  fill();
  submit();
  await screen.findByText(/Formular ist momentan nicht verfügbar/);
  expect(fetcher).not.toHaveBeenCalled();
  view.unmount();
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    ),
  );
  const other = render(<InquiryForm gatewayOrigin={origin} />);
  fill();
  submit();
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Wird gesendet …',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true),
  );
  other.unmount();
  complete(Response.json({ status: 'received' }, { status: 202 }));
});

test('the selected package remains fully readable on narrow screens and can return to undecided without changing the original option labels', () => {
  render(<InquiryForm gatewayOrigin={origin} />);
  const select = screen.getByLabelText('Gewünschtes Fotobox-Paket (optional)');
  fireEvent.change(select, { target: { value: 'easy-print-plus' } });
  expect(document.querySelector('.ak-package-choice')?.textContent).toBe(
    'easy print+ (400 Ausdrucke, Drucklayout)',
  );
  fireEvent.change(select, { target: { value: '' } });
  expect(document.querySelector('.ak-package-choice')).toBeNull();
});
test('a concurrent submit gesture does not create a second attempt; a conflict keeps the unchanged text copyable for a later retry', async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn(
    async () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<InquiryForm gatewayOrigin={origin} />);
  fill();
  submit();
  submit();
  expect(fetcher).toHaveBeenCalledTimes(1);
  complete(new Response('{}', { status: 409 }));
  await screen.findByText(/nicht eindeutig bestätigt/);
  expect(
    (screen.getByLabelText('Vorname *') as HTMLInputElement).readOnly,
  ).toBe(true);
  expect(screen.getByLabelText('Vorname *').matches(':disabled')).toBe(false);
});
