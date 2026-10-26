import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { AuthPanel } from '../../apps/admin/src/AuthPanel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

const row = {
  id: 'synthetic',
  version: 1,
  name: 'Synthetic event',
  status: 'inquiry',
  eventDate: null,
  startsAt: null,
  endsAt: null,
  timeZone: 'Europe/Berlin',
  eventTypeId: null,
  packageId: null,
  locationId: null,
  primaryContactId: null,
  additionalContactIds: [],
  source: '',
  description: '',
  notesHtml: '',
};

function fetcher() {
  return vi.fn(async (url: string) => {
    if (url === '/auth/me')
      return Response.json({
        email: 'fictional.owner@example.invalid',
        csrfToken: 'fictional-csrf',
      });
    if (url === '/api/v1/events/synthetic')
      return Response.json({
        event: row,
        contacts: [],
        location: null,
        eventType: null,
        package: null,
        activities: [],
      });
    if (url.startsWith('/api/v1/events'))
      return Response.json({ timeZone: 'Europe/Berlin', events: [row] });
    if (url === '/api/v1/statuses')
      return Response.json([
        { code: 'inquiry', label: 'Anfrage' },
        { code: 'booked', label: 'Gebucht' },
      ]);
    // BKP009.2: a loaded overview makes the maintenance management a real
    // disclosure, so the hash-switch contract below can open it.
    if (url === '/api/v1/resource-blocks')
      return Response.json({
        timeZone: 'Europe/Berlin',
        units: [],
        blocks: [],
      });
    return Response.json([]);
  });
}

async function go(hash: string) {
  window.history.replaceState(null, '', hash);
  fireEvent(window, new HashChangeEvent('hashchange'));
}

test('visible screens keep one page title and the detail uses Event language', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<AuthPanel />);
  await screen.findByRole('region', { name: 'Events' });

  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Events – zur Eventübersicht',
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('heading', { level: 2, name: 'Events' }),
  ).toBeNull();

  fireEvent.click(await screen.findByRole('link', { name: /Synthetic event/ }));
  const details = await screen.findByRole('region', { name: 'Event-Details' });
  expect(
    await within(details).findByRole('heading', {
      name: 'Event: Synthetic event',
    }),
  ).toBeTruthy();
  expect(
    within(details).getByRole('combobox', { name: 'Status des Events' }),
  ).toBeTruthy();
  expect(
    within(details).getByRole('navigation', { name: 'Bereiche des Events' }),
  ).toBeTruthy();
  expect(
    within(details).getByRole('button', { name: 'Event-Details schließen' }),
  ).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Eventakte/);
  expect(
    Array.from(document.querySelectorAll('[aria-label]'))
      .map((element) => element.getAttribute('aria-label'))
      .join(' '),
  ).not.toMatch(/Eventakte/);

  fireEvent.click(
    within(details).getByRole('button', { name: 'Event-Details schließen' }),
  );

  await go('/#contacts');
  await screen.findByRole('region', { name: 'Kontakte' });
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Kontakte – zur Eventübersicht',
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('heading', { level: 2, name: 'Kontakte' }),
  ).toBeNull();

  await go('/#settings');
  await screen.findByRole('heading', { level: 1, name: /Einstellungen/ });
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Einstellungen' }),
    ).toBeNull(),
  );

  await go('/#settings-products');
  await screen.findByRole('region', { name: 'Produkte' });
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Einstellungen – zur Eventübersicht',
    }),
  ).toBeTruthy();
  expect(
    screen.getAllByRole('heading', { level: 2, name: 'Produkte' }),
  ).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Ressourcen' })).toBeNull();
  expect(document.querySelectorAll('#products')).toHaveLength(1);
  const productsSettings = screen.getByRole('navigation', {
    name: 'Einstellungen',
  });
  expect(
    within(productsSettings)
      .getByRole('link', { name: 'Produkte' })
      .getAttribute('aria-current'),
  ).toBe('page');
  expect(
    within(productsSettings)
      .getByRole('link', { name: 'Ressourcen' })
      .getAttribute('aria-current'),
  ).toBeNull();
  expect(
    within(screen.getByLabelText('Arbeitsbereiche'))
      .getByRole('link', { name: 'Einstellungen' })
      .getAttribute('aria-current'),
  ).toBe('page');

  await go('/#calendar');
  expect(
    await screen.findByRole('heading', {
      name: 'Event- und Ressourcenkalender',
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Kalender – zur Eventübersicht',
    }),
  ).toBeTruthy();
});

test('search keeps distinct section headings and resources keep a valid outline', async () => {
  vi.stubGlobal('fetch', fetcher());
  render(<AuthPanel />);
  await screen.findByRole('region', { name: 'Events' });

  await go('/?q=Synthetic#search');
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Suchergebnisse – zur Eventübersicht',
    }),
  ).toBeTruthy();
  // H041: the list is already rendered from the previous load, so wait for
  // the searched result before reading the grouped heading.
  await screen.findByRole('link', { name: /Synthetic event/ });
  expect(
    screen.getByRole('heading', { level: 2, name: 'Events' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('heading', { level: 2, name: 'Kontakte' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('heading', { level: 3, name: 'Ohne Datum · 1 Event' }),
  ).toBeTruthy();

  await go('/#resources');
  await screen.findByRole('region', { name: 'Ressourcen' });
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Einstellungen – zur Eventübersicht',
    }),
  ).toBeTruthy();
  expect(
    screen.getAllByRole('heading', { level: 2, name: 'Ressourcen' }),
  ).toHaveLength(1);
  expect(
    screen.getByRole('heading', {
      level: 2,
      name: 'Zeitweise Ressourcensperren',
    }),
  ).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Produkte' })).toBeNull();
  expect(document.querySelectorAll('#resources')).toHaveLength(1);

  await go('/#settings-resources');
  await screen.findByRole('region', { name: 'Ressourcen' });
  expect(
    within(screen.getByRole('navigation', { name: 'Einstellungen' }))
      .getByRole('link', { name: 'Ressourcen' })
      .getAttribute('aria-current'),
  ).toBe('page');
});

test('settings keep resource and product panels mounted once and retain drafts across canonical and legacy hashes', async () => {
  const base = fetcher();
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requested.push(url);
      return base(url);
    }),
  );
  render(<AuthPanel />);
  await screen.findByRole('region', { name: 'Events' });
  // The mounted panels fetch in their own effects; the baseline must observe
  // those first reads, or a later hash change would count them as a refetch
  // (the pre-existing race this suite was hardened against once before).
  await vi.waitFor(() => {
    for (const url of [
      '/api/v1/products',
      '/api/v1/resources',
      '/api/v1/resource-blocks',
    ])
      expect(requested.filter((seen) => seen === url).length).toBeGreaterThan(
        0,
      );
  });
  const initialProducts = requested.filter(
    (url) => url === '/api/v1/products',
  ).length;
  const initialResources = requested.filter(
    (url) => url === '/api/v1/resources',
  ).length;
  const initialBlocks = requested.filter(
    (url) => url === '/api/v1/resource-blocks',
  ).length;

  await go('/?q=Synthetic#settings-products');
  const products = await screen.findByRole('region', { name: 'Produkte' });
  // BKP010.1: the product editor is mounted on demand. Open the dialog and
  // keep its draft dirty; the hash switches below must not remount it.
  fireEvent.click(
    within(products).getByRole('button', { name: 'Produkt anlegen' }),
  );
  const productDialog = await within(products).findByRole('dialog', {
    name: 'Produkt anlegen',
  });
  const productName = within(productDialog).getByLabelText(
    'Produktname',
  ) as HTMLInputElement;
  fireEvent.change(productName, {
    target: { value: 'Synthetic draft product' },
  });
  expect(requested.filter((url) => url === '/api/v1/products')).toHaveLength(
    initialProducts,
  );
  expect(window.location.search).toBe('?q=Synthetic');

  await go('/?q=Synthetic#products');
  expect(
    (
      within(screen.getByRole('region', { name: 'Produkte' })).getByLabelText(
        'Produktname',
      ) as HTMLInputElement
    ).value,
  ).toBe('Synthetic draft product');
  expect(
    within(screen.getByRole('region', { name: 'Produkte' })).getByRole(
      'dialog',
      { name: 'Produkt anlegen' },
    ),
    'the open product editor survives the hash switch',
  ).toBe(productDialog);
  expect(window.location.search).toBe('?q=Synthetic');

  await go('/?q=Synthetic#settings-resources');
  const resources = await screen.findByRole('region', { name: 'Ressourcen' });
  expect(screen.queryByRole('region', { name: 'Produkte' })).toBeNull();
  // BKP009: the resource editor is mounted on demand. Open the dialog and keep
  // its draft dirty; the hash switch below must not remount it.
  fireEvent.click(
    within(resources).getByRole('button', { name: 'Ressource anlegen' }),
  );
  const resourceDialog = await within(resources).findByRole('dialog', {
    name: 'Ressource anlegen',
  });
  fireEvent.change(within(resourceDialog).getByLabelText('Bezeichnung'), {
    target: { value: 'Synthetic draft box' },
  });
  expect(
    (within(resourceDialog).getByLabelText('Bezeichnung') as HTMLInputElement)
      .value,
  ).toBe('Synthetic draft box');

  // BKP009.2: the maintenance management is opened deliberately and stays a
  // plain state of the mounted panel — the hash switch below must neither
  // reload nor close it.
  const blocksSummary = await within(resources).findByText(
    /^Sperrverwaltung öffnen$/,
  );
  fireEvent.click(blocksSummary);
  const blocksDetails = blocksSummary.closest('details')!;
  expect(blocksDetails.hasAttribute('open')).toBe(true);
  expect(within(resources).getByText(/^Sperrverwaltung schließen$/)).toBe(
    blocksSummary,
  );

  await go('/?q=Synthetic#resources');
  const resourcesAfterHash = screen.getByRole('region', { name: 'Ressourcen' });
  expect(
    within(resourcesAfterHash)
      .getByText(/^Sperrverwaltung schließen$/)
      .closest('details'),
    'the opened maintenance management survives the hash switch',
  ).toBe(blocksDetails);
  expect(blocksDetails.hasAttribute('open')).toBe(true);
  expect(
    within(resourcesAfterHash).getByRole('dialog'),
    'the open editor survives the hash switch instead of being remounted',
  ).toBe(resourceDialog);
  expect(
    (
      within(resourcesAfterHash).getByLabelText(
        'Bezeichnung',
      ) as HTMLInputElement
    ).value,
  ).toBe('Synthetic draft box');
  expect(requested.filter((url) => url === '/api/v1/resources')).toHaveLength(
    initialResources,
  );
  expect(
    requested.filter((url) => url === '/api/v1/resource-blocks'),
  ).toHaveLength(initialBlocks);
  expect(requested.filter((url) => url === '/api/v1/products')).toHaveLength(
    initialProducts,
  );
  expect(window.location.search).toBe('?q=Synthetic');
});

test('theme stays reachable and singular before and after login', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  render(<AuthPanel />);
  await screen.findByRole('heading', {
    level: 1,
    name: 'Anmelden bei AuftragsKompass',
  });
  const loginToggle = screen.getByRole('button', {
    name: 'Dunkelmodus aktivieren',
  });
  expect(loginToggle.getAttribute('title')).toBe('Dunkelmodus aktivieren');
  expect(
    screen.getAllByRole('button', { name: /modus aktivieren/ }),
  ).toHaveLength(1);
  fireEvent.click(loginToggle);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('ak-theme')).toBe('dark');

  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal('fetch', fetcher());
  render(<AuthPanel />);
  await screen.findByRole('region', { name: 'Events' });
  expect(
    screen.getAllByRole('button', { name: /modus aktivieren/ }),
  ).toHaveLength(1);
  const toolbarToggle = screen.getByRole('button', {
    name: 'Dunkelmodus aktivieren',
  });
  expect(toolbarToggle.getAttribute('title')).toBe('Dunkelmodus aktivieren');
  expect(toolbarToggle.getAttribute('aria-pressed')).toBe('false');
});
