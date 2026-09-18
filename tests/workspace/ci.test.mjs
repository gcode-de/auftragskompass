import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('CI runs complete gates on push and PR with pinned actions and read-only permission', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  for (const required of [
    'push:',
    'pull_request:',
    'contents: read',
    'pnpm check',
    '--frozen-lockfile',
    'coverage/',
  ])
    assert.ok(workflow.includes(required));
  for (const action of workflow.matchAll(/uses: (\S+)/g))
    assert.match(action[1], /@[a-f0-9]{40}$/);
  assert.ok(!workflow.includes('pull_request_target'));
});
