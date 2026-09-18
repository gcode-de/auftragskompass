import { expect, test } from 'vitest';
import { applicationName } from '../../packages/core/src/index.js';
test('shared application identity', () => {
  expect(applicationName).toBe('AuftragsKompass');
});
