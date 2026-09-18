import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedCoverage } from '../../scripts/changed-coverage.mjs';
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
