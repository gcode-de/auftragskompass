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

test('runtime dependency audit blocks publication before quality and cannot ignore failures', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const audit = '      - run: pnpm audit --prod --audit-level=high';
  assert.ok(workflow.split('\n').includes(audit));
  assert.ok(
    workflow.indexOf(audit) >
      workflow.indexOf('pnpm install --frozen-lockfile'),
  );
  assert.ok(workflow.indexOf(audit) < workflow.indexOf('pnpm check'));
  assert.ok(!workflow.includes('continue-on-error: true'));
  assert.match(workflow, /images:\s*needs: quality/);
});

test('quality runs every Vitest project once with coverage and keeps the other gates', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  const commands = scripts.check.split(' && ');
  for (const gate of [
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test:workspace',
    'pnpm test:docs',
    'pnpm test:coverage',
    'pnpm test:e2e',
    'pnpm build',
    'pnpm test:ops',
  ])
    assert.equal(
      commands.filter((command) => command === gate).length,
      1,
      gate,
    );
  for (const project of ['unit', 'component', 'integration']) {
    assert.match(
      scripts['test:coverage'],
      new RegExp(`--project ${project}\\b`),
    );
    assert.ok(!commands.includes(`pnpm test:${project}`));
  }
  assert.match(scripts['test:coverage'], /--coverage\b/);
});

test('CI retains only the synthetic Chromium output for seven days, including failed runs', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const step =
    workflow.match(/ {6}- name: Chromium evidence\n(?: {8}.*\n)+/)?.[0] ?? '';
  for (const expected of [
    'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    'if: always()',
    'name: chromium-evidence',
    'path: tests/test-results/',
    'retention-days: 7',
    'if-no-files-found: ignore',
  ])
    assert.ok(step.includes(expected), expected);
  assert.ok(!step.includes('include-hidden-files: true'));
  assert.match(workflow, /images:\s*needs: quality/);
});
