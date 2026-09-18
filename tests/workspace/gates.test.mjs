import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(tool, args, input) {
  const result = spawnSync(`node_modules/.bin/${tool}`, args, {
    input,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result.status;
}

test('format gate rejects unformatted TypeScript and accepts formatted input', () => {
  assert.equal(
    run(
      'prettier',
      ['--check', '--stdin-filepath', 'packages/core/src/fixture.ts'],
      'const a=1',
    ),
    1,
  );
  assert.equal(
    run(
      'prettier',
      ['--check', '--stdin-filepath', 'packages/core/src/fixture.ts'],
      'const a = 1;\n',
    ),
    0,
  );
});
test('lint gate rejects unused variables and accepts a module', () => {
  const args = ['--stdin', '--stdin-filename', 'packages/core/src/fixture.ts'];
  assert.equal(run('eslint', args, 'const unused = 1;\n'), 1);
  assert.equal(run('eslint', args, 'export {};\n'), 0);
});
test('commit gate rejects free text and accepts Conventional Commits', () => {
  const args = ['--config', 'scripts/commitlint.config.mjs'];
  assert.equal(run('commitlint', args, 'bad message\n'), 1);
  assert.equal(run('commitlint', args, 'chore: add quality gates\n'), 0);
});
