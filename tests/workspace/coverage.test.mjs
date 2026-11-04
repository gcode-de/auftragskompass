import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedCoverage,
  diffArgs,
  runGit,
} from '../../scripts/changed-coverage.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const diff = '+++ b/packages/core/src/example.ts\n@@ -1 +1 @@\n+example();';
test('changed coverage rejects absent, uncovered and missing branch coverage', () => {
  assert.throws(() => changedCoverage(diff, ''), /Missing coverage/);
  assert.throws(
    () => changedCoverage(diff, 'SF:packages/core/src/example.ts\nDA:1,0'),
    /85%/,
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
