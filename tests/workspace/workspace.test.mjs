import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all application boundaries are private ESM workspaces with build and typecheck', async () => {
  for (const path of ['apps/admin', 'apps/api', 'apps/worker', 'apps/gateway', 'apps/widget', 'packages/core']) {
    const pkg = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
    assert.equal(pkg.private, true);
    assert.equal(pkg.type, 'module');
    assert.ok(pkg.scripts.build);
    assert.ok(pkg.scripts.typecheck);
  }
});
