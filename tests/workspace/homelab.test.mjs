import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('image publishing requires green quality gates, fixed repository name and a trusted push', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const publish = workflow.split('\n  images:\n')[1];
  assert.ok(publish, 'image publishing job missing');
  for (const required of [
    'needs: quality',
    "github.event_name == 'push'",
    'secrets.DOCKERHUB_TOKEN',
    'secrets.DOCKERHUB_USER',
    'node scripts/dockerhub.mjs',
    'DOCKERHUB_VISIBILITY: public',
    'context: .',
    'target: runtime',
    'target: admin',
    'platforms: linux/amd64',
    '/auftragskompass:runtime-${{ github.sha }}',
    '/auftragskompass:admin-${{ github.sha }}',
    'persist-credentials: false',
  ])
    assert.ok(publish.includes(required), required);
  assert.ok(!publish.includes(':latest'));
  for (const action of workflow.matchAll(/uses: (\S+)/g))
    assert.match(action[1], /@[a-f0-9]{40}$/);
});

test('image publication allowlist is exactly the reviewed branch refs in one place', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const publish = workflow.split('\n  images:\n')[1];
  const allowlist = publish.match(
    /contains\(fromJSON\('([^']+)'\), github.ref\)/,
  );
  assert.ok(allowlist, 'publication allowlist missing');
  assert.deepEqual(JSON.parse(allowlist[1]), [
    'refs/heads/main',
    'refs/heads/codex/local-runtime-ci',
    'refs/heads/codex/ux-event-simplification',
  ]);
  const condition = publish.split('\n    runs-on:')[0];
  assert.equal(condition.match(/github\.ref/g).length, 1);
  assert.ok(condition.includes("github.event_name == 'push'"));
  assert.ok(!condition.includes('pull_request'));
  assert.ok(!/github\.ref\s*[!=]=/.test(condition));
  assert.equal(condition.match(/fromJSON\(/g).length, 1);
});

test('both published images identify the exact source revision for operator verification', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const builds = workflow.split('      - name: Publish ').slice(1);
  assert.equal(builds.length, 2);
  for (const build of builds) {
    assert.ok(build.includes('labels: |'));
    assert.ok(
      build.includes('org.opencontainers.image.revision=${{ github.sha }}'),
    );
    assert.ok(
      build.includes(
        'org.opencontainers.image.source=https://github.com/${{ github.repository }}',
      ),
    );
  }
});
