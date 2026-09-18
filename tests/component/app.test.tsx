import { expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { App } from '../../apps/admin/src/App.js';
afterEach(cleanup);
test('renders the accessible application shell', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'AuftragsKompass',
  );
  expect(screen.getByRole('status').textContent).toContain('Grundgerüst');
});
