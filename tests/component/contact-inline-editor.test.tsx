import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ContactInlineEditor } from '../../apps/admin/src/ContactInlineEditor.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const contact = {
  id: '44444444-4444-4444-8444-444444444444',
  version: 1,
  kind: 'private',
  name: 'Synthetic',
  contactPerson: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
  email: '',
  phone: '',
  mobile: '',
  state: 'active',
};
test('Escape cancels a field; a later blur saves and adopts the returned version', async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, options?: RequestInit) =>
      Response.json({
        ...contact,
        ...JSON.parse(String(options?.body)),
        version: 2,
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const onConfirmed = vi.fn();
  render(
    <ContactInlineEditor
      contact={contact}
      csrfToken="synthetic"
      onConfirmed={onConfirmed}
    />,
  );
  const name = screen.getByLabelText('Name / Firma');
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: 'Discard' } });
  fireEvent.keyDown(name, { key: 'Escape' });
  fireEvent.blur(name);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: 'Changed' } });
  fireEvent.blur(name);
  await waitFor(() =>
    expect(onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Changed', version: 2 }),
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('retains edits on conflict and explicitly reconciles with the server', async () => {
  const remote = { ...contact, version: 2, name: 'Server name' };
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, options?: RequestInit) =>
      options?.method === 'PUT'
        ? Response.json({ error: 'conflict' }, { status: 409 })
        : Response.json(remote),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ContactInlineEditor
      contact={contact}
      csrfToken="synthetic"
      onConfirmed={vi.fn()}
    />,
  );
  const name = screen.getByLabelText('Name / Firma') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'My name' } });
  fireEvent.blur(name);
  expect(
    await screen.findByText(/Kontakt wurde inzwischen geändert/),
  ).toBeTruthy();
  expect(name.value).toBe('My name');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Aktuellen Stand laden' }),
  );
  expect(await screen.findByText(/Serverstand: Server name/)).toBeTruthy();
  expect(name.value).toBe('My name');
});

test('an invalid field remains visible and never sends a PUT', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(
    <ContactInlineEditor
      contact={contact}
      csrfToken="synthetic"
      onConfirmed={vi.fn()}
    />,
  );
  const email = screen.getByLabelText('E-Mail-Adresse');
  fireEvent.change(email, { target: { value: 'not-an-email' } });
  fireEvent.blur(email);
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(fetcher).not.toHaveBeenCalled();
});

test('serializes two blurred fields using the returned version and preserves in-flight edits', async () => {
  let resolveFirst!: (reply: Response) => void;
  const first = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) return first;
      return Response.json({ ...contact, ...body, version: 3 });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ContactInlineEditor
      contact={contact}
      csrfToken="synthetic"
      onConfirmed={vi.fn()}
    />,
  );
  const name = screen.getByLabelText('Name / Firma') as HTMLInputElement,
    city = screen.getByLabelText('Ort') as HTMLInputElement;
  fireEvent.change(name, { target: { value: ' First ' } });
  fireEvent.blur(name);
  fireEvent.change(city, { target: { value: 'Fictional city' } });
  fireEvent.blur(city);
  expect(bodies).toHaveLength(1);
  resolveFirst(Response.json({ ...contact, name: 'First', version: 2 }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toMatchObject({
    version: 2,
    name: 'First',
    city: 'Fictional city',
  });
  await waitFor(() => expect(name.value).toBe('First'));
  expect(city.value).toBe('Fictional city');
});

test('trims contact fields before saving and adopts canonical server values', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      return Response.json({ ...contact, ...body, version: bodies.length + 1 });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <ContactInlineEditor
      contact={contact}
      csrfToken="synthetic"
      onConfirmed={vi.fn()}
    />,
  );
  for (const [label, value, field, expected] of [
    [
      'Straße und Hausnummer',
      '  Synthetic street  ',
      'street',
      'Synthetic street',
    ],
    ['Ort', '  Example city  ', 'city', 'Example city'],
    ['Festnetz', '  030 000000  ', 'phone', '030 000000'],
  ] as const) {
    const element = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(element, { target: { value } });
    fireEvent.blur(element);
    await waitFor(() =>
      expect(bodies.some((body) => body[field] === expected)).toBe(true),
    );
    await waitFor(() => expect(element.value).toBe(expected));
  }
});
