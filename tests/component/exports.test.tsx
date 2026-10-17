import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ExportPanel } from '../../apps/admin/src/ExportPanel.js';
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
test('offers explicit full exports without collecting session tokens or filter parameters', () => {
  window.history.replaceState(
    null,
    '',
    '/?q=Fictional&status=booked#settings-export',
  );
  render(<ExportPanel />);
  for (const [label, file] of [
    ['Kontakte als CSV herunterladen', 'contacts'],
    ['Alle Events als CSV herunterladen', 'events'],
    ['Produktkatalog als CSV herunterladen', 'products'],
  ] as const)
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(
      '/api/v1/' + file + '/export.csv',
    );
  expect(screen.getByText(/keine vollständige Datensicherung/)).toBeTruthy();
  expect(screen.getByText(/unabhängig von gesetzten Filtern/)).toBeTruthy();
});
