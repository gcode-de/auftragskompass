import { expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { App } from '../../apps/admin/src/App.js';
afterEach(cleanup);
test('renders one intelligible login heading without the brand hero', async () => {
  render(<App />);
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Anmelden bei AuftragsKompass',
    }),
  ).toBeTruthy();
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  expect(screen.queryByText(/Anfragen, Kontakte und Stammdaten/)).toBeNull();
});
