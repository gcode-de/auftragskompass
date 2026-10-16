import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventDetails } from '../../apps/admin/src/EventDetails.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const statuses = [
  { code: 'inquiry', label: 'Anfrage' },
  { code: 'option', label: 'Option' },
  { code: 'booked', label: 'Gebucht' },
];
const event = {
  id: 'synthetic-event',
  version: 1,
  name: 'Synthetic detail event',
  status: 'inquiry',
  eventDate: '2026-10-16',
  startsAt: '2026-10-16T16:00:00Z',
  endsAt: '2026-10-16T18:00:00Z',
  timeZone: 'Europe/Berlin',
  source: 'Fictional source',
  description: 'Synthetic description',
  notesHtml: '<strong>Fictional note</strong>',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  primaryContactId: null,
  additionalContactIds: [],
};
const detail = {
  event,
  contacts: [
    {
      id: 'synthetic-contact',
      name: 'Fictional contact',
      contactPerson: 'Fictional representative',
      email: 'detail@example.invalid',
      phone: '030 000000',
      mobile: '',
      role: 'primary',
    },
  ],
  location: {
    id: 'synthetic-location',
    name: 'Fictional venue',
    street: '',
    postalCode: '00000',
    city: 'Fictional city',
    country: 'DE',
  },
  eventType: { id: 'synthetic-type', name: 'Fictional type' },
  package: { id: 'synthetic-package', name: 'Fictional package' },
  activities: [
    {
      id: '1',
      kind: 'created',
      eventVersion: null,
      occurredAt: '2026-10-15T12:00:00Z',
      description: 'Event angelegt.',
    },
  ],
};
test('event details collect contacts, venue, notes and activities and save status with current version', async () => {
  const changed = vi.fn().mockResolvedValue(undefined),
    edit = vi.fn(),
    close = vi.fn();
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options) {
      Object.assign(detail.event, JSON.parse(String(options.body)));
      detail.event.version = 2;
      return Response.json(detail.event);
    }
    return Response.json(detail);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={changed}
      onEdit={edit}
      onClose={close}
    />,
  );
  await screen.findByRole('heading', {
    name: 'Eventakte: Synthetic detail event',
  });
  expect(
    screen
      .getByRole('link', { name: 'detail@example.invalid' })
      .getAttribute('href'),
  ).toBe('mailto:detail%40example.invalid');
  expect(
    screen.getByRole('link', { name: '030 000000' }).getAttribute('href'),
  ).toBe('tel:030000000');
  expect(screen.getByText('Fictional venue')).toBeTruthy();
  expect(screen.getByText(/Event angelegt\./)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Status in der Eventakte'), {
    target: { value: 'option' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText('Status gespeichert.');
  expect(changed).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/events/synthetic-event',
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }),
      body: expect.stringContaining('"version":1'),
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Stammdaten bearbeiten' }),
  );
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
  fireEvent.click(screen.getByRole('button', { name: 'Eventakte schließen' }));
  expect(close).toHaveBeenCalledOnce();
});
test('event detail errors preserve loaded data and allow retries', async () => {
  let error = 'conflict';
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options
      ? Response.json({ error }, { status: 409 })
      : Response.json({
          ...detail,
          contacts: [],
          location: null,
          eventType: null,
          package: null,
          activities: [],
          event: { ...event, eventDate: null, startsAt: null, endsAt: null },
        }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <EventDetails
      statuses={statuses}
      id="synthetic-event"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByText('Ohne Datum');
  await screen.findByText('Noch keine Aktivitäten.');
  for (const [code, text] of [
    ['conflict', /Inzwischen geändert/],
    ['invalid', /Status konnte nicht gespeichert/],
    ['import_review_required', /Ungeprüfte Bestandszusagen zuerst/],
  ] as const) {
    error = code;
    fireEvent.submit(
      screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
    );
    await screen.findByText(text);
    error = 'invalid';
  }
  fetcher.mockRejectedValue(Error('offline'));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Status speichern' }).closest('form')!,
  );
  await screen.findByText(/Verbindung fehlgeschlagen/);
  fireEvent.click(
    screen.getByRole('button', { name: 'Eventakte aktualisieren' }),
  );
  await screen.findByText(/Eventakte konnte nicht geladen/);
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  );
  render(
    <EventDetails
      statuses={statuses}
      id="missing"
      csrfToken="csrf"
      onChanged={async () => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />,
  );
  await screen.findByText(/Eventakte konnte nicht geladen/);
});
