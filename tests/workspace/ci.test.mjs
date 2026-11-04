import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('CI runs complete gates on push and PR with pinned actions and read-only permission', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  for (const required of [
    'push:',
    'pull_request:',
    'contents: read',
    'pnpm check:quality',
    'pnpm test:e2e',
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
  assert.ok(workflow.indexOf(audit) < workflow.indexOf('pnpm check:quality'));
  assert.ok(!workflow.includes('continue-on-error: true'));
  assert.match(workflow, /images:\s*needs: \[quality, browser\]/);
});

test('quality runs every Vitest project once with coverage and keeps the other gates', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  const commands = scripts['check:quality'].split(' && ');
  for (const gate of [
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test:workspace',
    'pnpm test:docs',
    'pnpm test:coverage',
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
  assert.deepEqual(scripts.check.split(' && '), [
    'pnpm check:quality',
    'pnpm test:e2e',
  ]);
  assert.ok(!commands.includes('pnpm test:e2e'));
});

test('CI retains only the synthetic Chromium output for seven days, including failed runs', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const browser = workflow.split('\n  browser:\n')[1]?.split('\n  images:')[0];
  assert.ok(browser);
  const step =
    (browser + '\n').match(
      / {6}- name: Chromium evidence\n(?: {8}.*\n)+/,
    )?.[0] ?? '';
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
  assert.match(workflow, /images:\s*needs: \[quality, browser\]/);
});

test('browser job runs independently and images require both checks', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const quality = workflow.split('\n  quality:\n')[1]?.split('\n  browser:')[0];
  const browser = workflow.split('\n  browser:\n')[1]?.split('\n  images:')[0];
  assert.ok(quality);
  assert.ok(quality.includes('pnpm check:quality'));
  assert.ok(!quality.includes('pnpm test:e2e'));
  assert.ok(browser);
  assert.doesNotMatch(browser, /\n {4}needs:/);
  for (const command of [
    'pnpm install --frozen-lockfile',
    'pnpm --filter @auftragskompass/core build',
    'pnpm exec playwright install --with-deps chromium',
    'pnpm test:e2e',
  ])
    assert.ok(browser.includes(command), command);
  assert.match(workflow, /images:\s*needs: \[quality, browser\]/);
});
