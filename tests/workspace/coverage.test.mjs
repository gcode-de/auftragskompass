import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  changedCoverage,
  diffArgs,
  localDiff,
  preflight,
  runGit,
} from '../../scripts/changed-coverage.mjs';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const coverageScript = fileURLToPath(
  new URL('../../scripts/changed-coverage.mjs', import.meta.url),
);
const diff = '+++ b/packages/core/src/example.ts\n@@ -1 +1 @@\n+example();';
test('changed coverage rejects missing data and enforces 80 percent lines and branches', () => {
  assert.throws(() => changedCoverage(diff, ''), /Missing coverage/);
  assert.throws(
    () => changedCoverage(diff, 'SF:packages/core/src/example.ts\nDA:1,0'),
    /80%/,
  );
  assert.throws(
    () =>
      changedCoverage(
        diff,
        'SF:packages/core/src/example.ts\nDA:1,1\nBRDA:1,0,0,-',
      ),
    /80%/,
  );
  assert.equal(
    changedCoverage(
      diff,
      'SF:packages/core/src/example.ts\nDA:1,1\nBRDA:1,0,0,1',
    ).coveredLines,
    1,
  );
});

test('changed coverage accepts exactly 80 percent of changed lines and branches', () => {
  const lines = Array.from({ length: 5 }, (_, index) => index + 1),
    diff =
      '+++ b/packages/core/src/example.ts\n@@ -1,0 +1,5 @@\n' +
      lines.map((line) => `+line-${line}`).join('\n'),
    lcov =
      'SF:packages/core/src/example.ts\n' +
      lines.map((line) => `DA:${line},${line <= 4 ? 1 : 0}`).join('\n') +
      '\n' +
      lines.map((line) => `BRDA:${line},0,0,${line <= 4 ? 1 : '-'}`).join('\n');

  assert.deepEqual(changedCoverage(diff, lcov), {
    lines: 5,
    coveredLines: 4,
    branches: 5,
    coveredBranches: 4,
  });
});

// CI reviews a pushed range; a local pre-commit run must see the worktree,
// otherwise uncommitted and untracked source is silently left out.
test('the diff scope follows the requested revision or the whole worktree', () => {
  assert.deepEqual(diffArgs('abc123'), [
    ['diff', '--unified=0', 'abc123', 'HEAD'],
  ]);
  assert.deepEqual(diffArgs(undefined, true), [
    ['add', '--intent-to-add', '--', 'apps', 'packages'],
    ['diff', '--unified=0', 'HEAD'],
  ]);
});

test('local diff includes committed source changes and preserves the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-local-coverage-'));
  try {
    runGit(['init', '-q'], dir);
    const git = (...args) =>
      runGit(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        dir,
      );
    const source = join(dir, 'apps/admin/src/example.ts');
    mkdirSync(join(dir, 'apps/admin/src'), { recursive: true });
    writeFileSync(source, 'const value = 0;\n');
    git('add', 'apps/admin/src/example.ts');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    writeFileSync(source, 'const value = 1;\n');
    git('commit', '-qam', 'committed change');
    const indexBefore = git('write-tree').trim();

    const diff = localDiff(base, dir);

    assert.match(diff, /const value = 0/);
    assert.match(diff, /const value = 1/);
    assert.equal(git('write-tree').trim(), indexBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local diff rejects an unstaged reversion of a committed source change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-local-reversion-'));
  try {
    runGit(['init', '-q'], dir);
    const git = (...args) =>
      runGit(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        dir,
      );
    const source = join(dir, 'apps/admin/src/example.ts');
    mkdirSync(join(dir, 'apps/admin/src'), { recursive: true });
    writeFileSync(source, 'const value = 0;\n');
    git('add', 'apps/admin/src/example.ts');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    writeFileSync(source, 'const value = 1;\n');
    git('commit', '-qam', 'source change');
    const indexBefore = git('write-tree').trim();
    writeFileSync(source, 'const value = 0;\n');

    assert.throws(
      () => localDiff(base, dir),
      /Commit all tracked changes before coverage preflight: apps\/admin\/src\/example\.ts/,
    );
    assert.equal(git('write-tree').trim(), indexBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local diff rejects a staged source change reverted to HEAD in the worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-local-staged-reversion-'));
  try {
    runGit(['init', '-q'], dir);
    const git = (...args) =>
      runGit(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        dir,
      );
    const source = join(dir, 'apps/admin/src/example.ts');
    mkdirSync(join(dir, 'apps/admin/src'), { recursive: true });
    writeFileSync(source, 'const value = 0;\n');
    git('add', 'apps/admin/src/example.ts');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    writeFileSync(source, 'const value = 1;\n');
    git('commit', '-qam', 'source change');
    writeFileSync(source, 'const value = 2;\n');
    git('add', 'apps/admin/src/example.ts');
    writeFileSync(source, 'const value = 1;\n');
    assert.equal(
      git('diff', '--name-only', 'HEAD', '--', 'apps', 'packages').trim(),
      '',
    );
    const indexBefore = git('write-tree').trim();

    assert.throws(
      () => localDiff(base, dir),
      /Commit all tracked changes before coverage preflight: apps\/admin\/src\/example\.ts/,
    );
    assert.equal(git('write-tree').trim(), indexBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight rejects untracked app and test inputs with special characters, but ignores pyc', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-local-untracked-'));
  try {
    runGit(['init', '-q'], dir);
    writeFileSync(
      join(dir, '.gitignore'),
      'scripts/__pycache__/\ntests/test-results/\n',
    );
    runGit(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'add',
        '.gitignore',
      ],
      dir,
    );
    runGit(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '-qm',
        'base',
      ],
      dir,
    );
    const source = join(dir, 'packages/core/src/Über sample.ts');
    const test = join(dir, 'tests/Fictional spec.test.ts');
    mkdirSync(join(dir, 'packages/core/src'), { recursive: true });
    mkdirSync(join(dir, 'tests'), { recursive: true });
    mkdirSync(join(dir, 'scripts/__pycache__'), { recursive: true });
    mkdirSync(join(dir, 'tests/test-results'), { recursive: true });
    writeFileSync(source, 'export const fictional = true;\n');
    writeFileSync(test, 'export {};\n');
    writeFileSync(join(dir, 'scripts/__pycache__/temporary.pyc'), 'ignored');
    writeFileSync(join(dir, 'tests/test-results/temporary.json'), '{}');
    const indexBefore = runGit(['write-tree'], dir).trim();
    assert.throws(() => localDiff(undefined, dir), /BASE_REVISION is required/);
    assert.throws(
      () => localDiff('HEAD', dir),
      /Commit untracked coverage inputs before coverage preflight: .*packages\/core\/src\/Über sample\.ts, tests\/Fictional spec\.test\.ts/,
    );
    assert.deepEqual(
      runGit(
        [
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
          '--',
          'apps',
          'packages',
          'tests',
          'scripts',
        ],
        dir,
      )
        .split('\0')
        .filter(Boolean),
      ['packages/core/src/Über sample.ts', 'tests/Fictional spec.test.ts'],
    );
    assert.equal(runGit(['write-tree'], dir).trim(), indexBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight rejects staged configuration and unstaged test changes without writing the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-preflight-dirty-'));
  try {
    runGit(['init', '-q'], dir);
    const git = (...args) =>
      runGit(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        dir,
      );
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(
      join(dir, 'tests/vitest.config.ts'),
      'export const version = 1;\n',
    );
    writeFileSync(
      join(dir, 'tests/workspace.test.mjs'),
      'export const test = 1;\n',
    );
    git('add', 'tests/vitest.config.ts', 'tests/workspace.test.mjs');
    git('commit', '-qm', 'base');

    writeFileSync(
      join(dir, 'tests/vitest.config.ts'),
      'export const version = 2;\n',
    );
    git('add', 'tests/vitest.config.ts');
    writeFileSync(
      join(dir, 'tests/workspace.test.mjs'),
      'export const test = 2;\n',
    );
    const indexBefore = git('write-tree').trim();

    assert.throws(
      () => preflight(dir),
      /Commit all tracked changes before coverage preflight: tests\/vitest\.config\.ts, tests\/workspace\.test\.mjs/,
    );
    assert.equal(git('write-tree').trim(), indexBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preflight command runs without LCOV and stops on tracked test changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-preflight-cli-'));
  try {
    runGit(['init', '-q'], dir);
    const git = (...args) =>
      runGit(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        dir,
      );
    writeFileSync(join(dir, 'tracked.txt'), 'fixture\n');
    git('add', 'tracked.txt');
    git('commit', '-qm', 'base');
    const env = { ...process.env, COVERAGE_DIFF: 'preflight' };
    const clean = spawnSync(process.execPath, [coverageScript], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /Coverage preflight is clean/);

    writeFileSync(join(dir, 'tracked.txt'), 'changed fixture\n');
    const dirty = spawnSync(process.execPath, [coverageScript], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.notEqual(dirty.status, 0);
    assert.match(
      dirty.stderr,
      /Commit all tracked changes before coverage preflight/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A real release diff exceeds Node's default 1 MiB exec buffer.
test('git diff handles a release-sized output without truncation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-coverage-'));
  try {
    runGit(['init', '-q'], dir);
    runGit(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture',
      ],
      dir,
    );
    writeFileSync(join(dir, 'large.txt'), 'fictional-line\n'.repeat(100000));
    runGit(['add', 'large.txt'], dir);
    const result = runGit(['diff', '--cached', '--unified=0'], dir);
    assert.ok(result.length > 1024 * 1024);
    assert.ok(result.includes('fictional-line'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
