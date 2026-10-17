import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { CalendarFeedsPanel } from '../../apps/admin/src/CalendarFeedsPanel.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const resource = { id: 'fictional-resource', name: 'Fictional box' },
  input = {
    resourceId: null as string | null,
    description: false,
    eventType: false,
    internalLink: false,
  },
  row = { ...input, id: 'fictional-feed', expiresAt: '2031-01-01T00:00:00Z' },
  url = 'https://admin.example.invalid/feeds/v1/fictional-one-time-token.ics';
test('creates optional scoped feeds, shows link once, rotates and revokes with CSRF', async () => {
  let rows: (typeof row)[] = [];
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (options) {
        calls.push(options);
        if (options.method === 'POST')
          rows = [{ ...row, ...JSON.parse(options.body as string) }];
        if (options.method === 'DELETE') rows = [];
        return options.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json({ ...rows[0], url });
      }
      return Response.json(path.endsWith('/resources') ? [resource] : rows);
    }),
  );
  render(<CalendarFeedsPanel csrfToken="fictional-csrf" />);
  const create = screen.getByRole('button', { name: 'Abo erstellen' });
  await waitFor(() =>
    expect((create as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Kalenderumfang'), {
    target: { value: resource.id },
  });
  for (const label of [
    'Eventbeschreibung aufnehmen',
    'Eventart aufnehmen',
    'Internen Eventlink aufnehmen',
  ])
    fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(create);
  expect(
    (
      (await screen.findByLabelText(
        'Neuer Kalenderlink (nur jetzt sichtbar)',
      )) as HTMLInputElement
    ).value,
  ).toBe(url);
  expect(JSON.parse(calls[0]!.body as string)).toEqual({
    resourceId: resource.id,
    description: true,
    eventType: true,
    internalLink: true,
  });
  expect(calls[0]!.headers).toEqual({
    'content-type': 'application/json',
    'x-csrf-token': 'fictional-csrf',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Link erneuern' }));
  await screen.findByText(/Den neuen Link jetzt/);
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.method).toBe('PUT');
  expect(JSON.parse(calls[1]!.body as string)).toEqual({
    resourceId: resource.id,
    description: true,
    eventType: true,
    internalLink: true,
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Abo widerrufen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abo widerrufen' }));
  await screen.findByText(/Bereits heruntergeladene/);
  expect(
    screen.queryByLabelText('Neuer Kalenderlink (nur jetzt sichtbar)'),
  ).toBeNull();
  expect(calls[2]!.headers).toEqual({ 'x-csrf-token': 'fictional-csrf' });
  expect(screen.getByText('Keine aktiven Kalender-Abos.')).toBeTruthy();
});
test('load failures and uncertain mutations clear links and allow explicit reload', async () => {
  let failLoad = true,
    failMutation = false,
    offline = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      if (offline) throw Error('offline');
      if (options)
        return failMutation
          ? new Response(null, { status: 401 })
          : Response.json({ ...row, url });
      if (failLoad) return new Response(null, { status: 503 });
      return Response.json(
        path.endsWith('/resources')
          ? [resource]
          : [{ ...row, resourceId: 'fictional-missing-resource' }],
      );
    }),
  );
  render(<CalendarFeedsPanel csrfToken="fictional-csrf" />);
  await screen.findByText('Kalender-Abos konnten nicht geladen werden.');
  failLoad = false;
  fireEvent.click(screen.getByRole('button', { name: 'Abos neu laden' }));
  await screen.findByText(/Ressource · gültig/);
  fireEvent.click(screen.getByRole('button', { name: 'Abo erstellen' }));
  await screen.findByLabelText('Neuer Kalenderlink (nur jetzt sichtbar)');
  failMutation = true;
  fireEvent.click(screen.getByRole('button', { name: 'Abo erstellen' }));
  await screen.findByText(/Änderung nicht bestätigt/);
  expect(
    screen.queryByLabelText('Neuer Kalenderlink (nur jetzt sichtbar)'),
  ).toBeNull();
  offline = true;
  fireEvent.click(screen.getByRole('button', { name: 'Abos neu laden' }));
  await screen.findByText('Kalender-Abos konnten nicht geladen werden.');
  offline = false;
  failLoad = false;
  failMutation = false;
  fireEvent.click(screen.getByRole('button', { name: 'Abos neu laden' }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Link erneuern',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  offline = true;
  fireEvent.click(screen.getByRole('button', { name: 'Link erneuern' }));
  await screen.findByText(/Änderung nicht bestätigt/);
});
test('unmount ignores late successful or failed loading', async () => {
  const resolvers: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolvers.push(r);
        }),
    ),
  );
  const first = render(<CalendarFeedsPanel csrfToken="fictional-csrf" />);
  first.unmount();
  for (const resolve of resolvers) resolve(Response.json([]));
  await Promise.resolve();
  let reject!: (e: Error) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((_r, j) => {
          reject = j;
        }),
    ),
  );
  const second = render(<CalendarFeedsPanel csrfToken="fictional-csrf" />);
  second.unmount();
  reject(Error('offline'));
  await Promise.resolve();
});
