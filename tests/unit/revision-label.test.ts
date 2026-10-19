import { describe, expect, test } from 'vitest';
import {
  appRevision,
  appVersionLabel,
  versionLabel,
} from '../../apps/admin/src/revision.js';

describe('versionLabel', () => {
  test('shortens a commit revision to its seven character prefix', () => {
    expect(versionLabel('2543107aa779ebf923750e5df643408ad3e09d9')).toBe(
      '2543107',
    );
  });
  test('keeps an already short revision unchanged', () => {
    expect(versionLabel('906a3e0')).toBe('906a3e0');
  });
  test('names the development fallback instead of showing a truncated word', () => {
    expect(versionLabel('development')).toBe('Entwicklung');
  });
  test('uses the development label when the test build defines no revision', () => {
    expect(appRevision).toBe('development');
    expect(appVersionLabel).toBe('Entwicklung');
  });
});
