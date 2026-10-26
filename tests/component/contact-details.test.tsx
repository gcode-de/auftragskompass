import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasUnsavedChanges } from '../../apps/admin/src/unsaved-changes.js';
import { ContactPanel } from '../../apps/admin/src/ContactPanel.js';

// BKP011.1: the reading contact record opens inline in its list row. Every
// fixture here is fictional; nothing about a real customer is used.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const company = {
  id: 'synthetic-company',
  version: 2,
  kind: 'company',
  name: 'Synthetic Company',
  contactPerson: 'Fictional Contact',
  street: 'Synthetic Street 1',
  postalCode: '00000',
  city: 'Fictional City',
  country: 'DE',
  email: 'synthetic@example.invalid',
  phone: '030 000000',
  mobile: '',
  state: 'active',
};
const person = {
  id: 'fictional-person',
  version: 3,
  kind: 'private',
  name: 'Fictional Person',
  contactPerson: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'AT',
  email: '',
  phone: '',
  mobile: '',
  state: 'archived',
};
const streetOnly = {
  ...person,
  id: 'fictional-street-only',
  name: 'Fictional Street Only',
  street: 'Synthetic Street 9',
  state: 'active',
};

type Fixture = typeof company;
type EventsAnswer = () => Response | Promise<Response>;

function fetchFor(
  rows: Fixture[],
  events: EventsAnswer = () => Response.json([]),
) {
  return vi.fn(async (url: string, options?: RequestInit) =>
    url.endsWith('/events')
      ? events()
      : Response.json(options ? rows[0] : rows),
  );
}

function mount(
  hash: string,
  rows: Fixture[],
  events: EventsAnswer = () => Response.json([]),
) {
  window.history.replaceState(null, '', '/' + hash);
  const fetcher = fetchFor(rows, events);
  vi.stubGlobal('fetch', fetcher);
  render(<ContactPanel csrfToken="csrf" />);
  return fetcher;
}

async function openRecord(name = 'Synthetic Company') {
  const link = await screen.findByRole('link', { name });
  fireEvent.click(link);
  return screen.findByRole('region', { name: 'Kontakt-Details' });
}

function record() {
  return screen.getByRole('region', { name: 'Kontakt-Details' });
}

async function closeRecord() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Kontakt-Details schließen' }),
  );
  await waitFor(() => expect(window.location.hash).toBe('#contacts'));
}

test('a contact name opens the reading record inline and keeps one list entry', async () => {
  mount('#contacts', [company]);
  await screen.findByText('Synthetic Company');
  expect(screen.queryByRole('region', { name: 'Kontakt-Details' })).toBeNull();
  const link = screen.getByRole('link', { name: 'Synthetic Company' });
  expect(link.getAttribute('href')).toBe('#contact-synthetic-company');
  expect(link.getAttribute('class')).toContain('contact-name-link');
  fireEvent.click(link);
  const details = await screen.findByRole('region', {
    name: 'Kontakt-Details',
  });
  expect(window.location.hash).toBe('#contact-synthetic-company');
  // The list entry stays mounted, so search text, scroll position and the
  // anchor contract survive; only its summary steps aside.
  const entry = document.getElementById('contact-synthetic-company')!;
  expect(entry.contains(details)).toBe(true);
  expect(entry.querySelector('.contact-row')?.hasAttribute('hidden')).toBe(
    true,
  );
  expect(
    within(details).getByRole('heading', { name: 'Synthetic Company' }),
  ).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the record names the contact type and an archived state in plain text', async () => {
  mount('#contacts', [company, person]);
  await screen.findByText('Synthetic Company');
  const active = await openRecord('Synthetic Company');
  expect(within(active).getByText('Firma')).toBeTruthy();
  expect(within(active).getByText('Aktiv')).toBeTruthy();
  await closeRecord();
  const archived = await openRecord('Fictional Person');
  expect(within(archived).getByText('Privatperson')).toBeTruthy();
  expect(within(archived).getByText('Archiviert')).toBeTruthy();
  expect(within(archived).queryByText('Aktiv')).toBeNull();
});

test('a company names its contact person while a private contact keeps that row out', async () => {
  mount('#contacts', [company, person]);
  await screen.findByText('Synthetic Company');
  const companyRecord = await openRecord('Synthetic Company');
  expect(within(companyRecord).getByText('Ansprechpartner')).toBeTruthy();
  expect(within(companyRecord).getByText('Fictional Contact')).toBeTruthy();
  await closeRecord();
  const personRecord = await openRecord('Fictional Person');
  expect(within(personRecord).queryByText('Ansprechpartner')).toBeNull();
});

test('the address shows only stored parts and says so honestly when nothing is stored', async () => {
  mount('#contacts', [company, person, streetOnly]);
  await screen.findByText('Synthetic Company');
  const complete = await openRecord('Synthetic Company');
  expect(within(complete).getByText('Synthetic Street 1')).toBeTruthy();
  expect(within(complete).getByText('00000 Fictional City')).toBeTruthy();
  expect(within(complete).getByText('Deutschland')).toBeTruthy();
  await closeRecord();
  const missing = await openRecord('Fictional Person');
  expect(within(missing).getByText('Keine Anschrift hinterlegt.')).toBeTruthy();
  expect(within(missing).queryByText(/Fictional City/)).toBeNull();
  await closeRecord();
  // A partial address stays visibly partial: the missing town is not filled.
  const partial = await openRecord('Fictional Street Only');
  expect(within(partial).getByText('Synthetic Street 9')).toBeTruthy();
  expect(within(partial).queryByText(/00000/)).toBeNull();
});

test('the stored country code is shown as a name or falls back to the code', async () => {
  mount('#contacts', [
    { ...company, id: 'austria', name: 'Synthetic Austria', country: 'AT' },
    { ...company, id: 'unknown', name: 'Synthetic Unknown', country: 'ZZ' },
  ]);
  await screen.findByText('Synthetic Austria');
  const austria = await openRecord('Synthetic Austria');
  expect(within(austria).getByText('Österreich')).toBeTruthy();
  await closeRecord();
  const unknown = await openRecord('Synthetic Unknown');
  expect(within(unknown).getByText('ZZ')).toBeTruthy();
});

test('mail and phone stay the stored text while their links are escaped once', async () => {
  const tricky = {
    ...company,
    id: 'tricky',
    name: 'Synthetic "Quoted" Firma & Söhne',
    email: 'synthetic+quote%test@example.invalid',
    phone: '+49 (0)30 000000',
  };
  mount('#contacts', [tricky]);
  await screen.findByText('Synthetic "Quoted" Firma & Söhne');
  const details = await openRecord('Synthetic "Quoted" Firma & Söhne');
  expect(
    within(details).getByRole('heading', {
      name: 'Synthetic "Quoted" Firma & Söhne',
    }),
  ).toBeTruthy();
  const mail = within(details).getByRole('link', {
    name: 'synthetic+quote%test@example.invalid',
  });
  expect(mail.textContent).toBe('synthetic+quote%test@example.invalid');
  expect(mail.getAttribute('href')).toBe(
    'mailto:synthetic+quote%25test@example.invalid',
  );
  const phone = within(details).getByRole('link', {
    name: '+49 (0)30 000000',
  });
  expect(phone.textContent).toBe('+49 (0)30 000000');
  expect(phone.getAttribute('href')).toBe('tel:+49030000000');
});

test('the record omits optional values instead of inventing them', async () => {
  mount('#contacts', [person]);
  await screen.findByRole('link', { name: 'Fictional Person' });
  const details = await openRecord('Fictional Person');
  // Two honest placeholders (e-mail, phone) instead of empty rows; the
  // contact-person row belongs to a company and is simply absent here.
  expect(within(details).getAllByText('Nicht angegeben')).toHaveLength(2);
  expect(within(details).queryByRole('link', { name: /@/ })).toBeNull();
  expect(within(details).queryAllByRole('link', { name: /^\+|^0/ })).toEqual(
    [],
  );
});

test('related events show name, date or no date and status without their notes', async () => {
  mount('#contacts', [company], () =>
    Response.json([
      {
        id: 'event-one',
        name: 'Fictional linked event',
        eventDate: '2026-10-16',
        status: 'booked',
        notesHtml: '<p>Synthetic secret note</p>',
        description: 'Fictional secret description',
      },
      {
        id: 'event-two',
        name: 'Fictional undated event',
        eventDate: null,
        status: 'inquiry',
        notesHtml: '<p>Synthetic other secret</p>',
        description: '',
      },
    ]),
  );
  await screen.findByText('Synthetic Company');
  const details = await openRecord();
  const first = within(details).getByRole('link', {
    name: 'Fictional linked event',
  });
  expect(first.getAttribute('href')).toBe('#event-event-one');
  expect(within(details).getByText('16.10.2026')).toBeTruthy();
  expect(within(details).getByText('Gebucht')).toBeTruthy();
  const second = within(details).getByRole('link', {
    name: 'Fictional undated event',
  });
  expect(second.getAttribute('href')).toBe('#event-event-two');
  expect(within(details).getByText('Ohne Datum')).toBeTruthy();
  expect(within(details).getByText('Anfrage')).toBeTruthy();
  // Notes stay out of the contact record entirely.
  expect(details.innerHTML).not.toMatch(/secret/i);
  expect(within(details).queryByRole('tab')).toBeNull();
});

test('related events report loading and an honest empty state', async () => {
  let release: (response: Response) => void = () => {};
  mount(
    '#contacts',
    [company],
    () =>
      new Promise<Response>((settle) => {
        release = settle;
      }),
  );
  await screen.findByText('Synthetic Company');
  const details = await openRecord();
  expect(
    within(details).getByText('Zugeordnete Events werden geladen …'),
  ).toBeTruthy();
  await act(async () => release(Response.json([])));
  expect(
    await within(details).findByText('Keine zugeordneten Events.'),
  ).toBeTruthy();
});

test('a failed event load retries with GET only and keeps the record open', async () => {
  let calls = 0;
  const fetcher = mount('#contacts', [company], () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 500 });
    return Response.json([
      {
        id: 'event-one',
        name: 'Fictional linked event',
        eventDate: null,
        status: 'option',
      },
    ]);
  });
  await screen.findByText('Synthetic Company');
  const details = await openRecord();
  expect(
    await within(details).findByText(
      'Zugeordnete Events konnten nicht geladen werden.',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Kontakt-Details' })).toBeTruthy();
  fireEvent.click(
    within(details).getByRole('button', {
      name: 'Zugeordnete Events erneut laden',
    }),
  );
  expect(
    await within(details).findByRole('link', {
      name: 'Fictional linked event',
    }),
  ).toBeTruthy();
  // No request ever carried a method: the retry is a plain GET.
  expect(fetcher.mock.calls.filter(([, options]) => options)).toEqual([]);
  expect(calls).toBe(2);
});

test('closing the record keeps the search text, the list and returns the focus', async () => {
  const fetcher = mount('#contacts', [company]);
  await screen.findByText('Synthetic Company');
  fireEvent.change(screen.getByLabelText('Kontakte suchen'), {
    target: { value: 'Synthetic' },
  });
  const callsBefore = fetcher.mock.calls.length;
  await openRecord();
  await closeRecord();
  expect(
    (screen.getByLabelText('Kontakte suchen') as HTMLInputElement).value,
  ).toBe('Synthetic');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: 'Synthetic Company' }),
    ),
  );
  expect(screen.queryByRole('region', { name: 'Kontakt-Details' })).toBeNull();
  const entry = document.getElementById('contact-synthetic-company')!;
  expect(entry.querySelector('.contact-row')?.hasAttribute('hidden')).toBe(
    false,
  );
  // Only the events request was added; closing never reloads the list.
  expect(fetcher.mock.calls.length).toBe(callsBefore + 1);
  expect(fetcher.mock.calls.every(([, options]) => !options)).toBe(true);
});

test('a deep link and a reload open the same record without a stale editor', async () => {
  mount('#contact-synthetic-company', [company]);
  expect(
    await screen.findByRole('region', { name: 'Kontakt-Details' }),
  ).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  cleanup();
  window.history.replaceState(null, '', '/#contact-synthetic-company');
  render(<ContactPanel csrfToken="csrf" />);
  const reloaded = await screen.findByRole('region', {
    name: 'Kontakt-Details',
  });
  expect(
    within(reloaded).getByRole('heading', { name: 'Synthetic Company' }),
  ).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('editing from the record reuses the dialog and a conflict keeps draft and record', async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/events')) return Response.json([]);
      if (options) return Response.json({ error: 'conflict' }, { status: 409 });
      return Response.json([company]);
    }),
  );
  window.history.replaceState(null, '', '/#contacts');
  render(<ContactPanel csrfToken="csrf" />);
  await screen.findByText('Synthetic Company');
  await openRecord();
  fireEvent.click(
    within(record()).getByRole('button', {
      name: 'Kontakt bearbeiten: Synthetic Company',
    }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Kontakt bearbeiten',
  });
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic Company');
  expect(screen.getByLabelText('Kontaktart')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Name / Firma'), {
    target: { value: 'Synthetic draft' },
  });
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Kontakt speichern' })
      .closest('form')!,
  );
  await screen.findByText(/Inzwischen geändert/);
  expect(
    (screen.getByLabelText('Name / Firma') as HTMLInputElement).value,
  ).toBe('Synthetic draft');
  expect(record()).toBeTruthy();
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(confirm).toHaveBeenCalledWith(
    'Ungespeicherte Eingaben verwerfen und den Kontaktdialog schließen?',
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
});

test('the record keeps exactly one secondary and one tertiary action', async () => {
  mount('#contacts', [company]);
  await screen.findByText('Synthetic Company');
  const details = await openRecord();
  const buttons = within(details).getAllByRole('button');
  expect(
    buttons.filter((button) =>
      (button.getAttribute('class') ?? '').includes('secondary-action'),
    ),
  ).toHaveLength(1);
  expect(
    buttons.filter((button) =>
      (button.getAttribute('class') ?? '').includes('tertiary-action'),
    ),
  ).toHaveLength(1);
  expect(
    within(details)
      .getByRole('button', { name: 'Kontakt bearbeiten: Synthetic Company' })
      .getAttribute('class'),
  ).toContain('secondary-action');
  expect(
    within(details)
      .getByRole('button', { name: 'Kontakt-Details schließen' })
      .getAttribute('class'),
  ).toContain('tertiary-action');
});

test('long fictional values stay complete and wrap instead of clipping', async () => {
  const longName = 'Synthetic ' + 'N'.repeat(190);
  const longStreet = 'Synthetic Street ' + 'S'.repeat(184);
  const longEmail = 'e'.repeat(238) + '@example.invalid';
  mount('#contacts', [
    { ...company, name: longName, street: longStreet, email: longEmail },
  ]);
  const details = await openRecord(longName);
  expect(within(details).getByRole('heading', { name: longName })).toBeTruthy();
  expect(within(details).getByText(longStreet)).toBeTruthy();
  expect(
    within(details).getByRole('link', { name: longEmail }).textContent,
  ).toBe(longEmail);
  const css = readFileSync(
    resolve(process.cwd(), 'apps/admin/src/styles.css'),
    'utf8',
  );
  expect(css).toMatch(/\.contact-record dd \{[^}]*overflow-wrap: anywhere/);
  expect(css).toMatch(
    /\.contact-record-head h2 \{[^}]*overflow-wrap: anywhere/,
  );
  // BKP011.1d: the text assertion above only proves the rule exists. The
  // computed style proves it reaches the record's heading, which is where the
  // heading rename silently dropped it: an unselected h2 falls back to the UA
  // 24px/UA margins without a jump offset. jsdom applies the real stylesheet
  // and resolves rem to px, so the documented sizes are checked as applied.
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  try {
    const heading = within(details).getByRole('heading', { name: longName });
    const applied = window.getComputedStyle(heading);
    expect(applied.overflowWrap).toBe('anywhere');
    expect(applied.scrollMarginTop).toBe('96px');
    expect(applied.marginTop).toBe('0px');
    expect(applied.marginBottom).toBe('0px');
    expect(applied.fontSize).toBe('19.2px');
    // The sub-sections keep the quiet record sizes, not the UA h3 ones.
    const sectionHeading = within(details).getByRole('heading', {
      name: 'Anschrift',
    });
    expect(window.getComputedStyle(sectionHeading).fontSize).toBe('14.4px');
    expect(window.getComputedStyle(sectionHeading).fontWeight).toBe('650');
  } finally {
    style.remove();
  }
});
