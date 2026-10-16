import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('registry validation accepts a repository and rejects incomplete or unsafe configuration without leaking a token', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const script = workflow.match(/run: \|\n((?: {10}.+\n)+)/)[1];
  for (const [image, username, token, success] of [
    ['synthetic/auftragskompass', 'synthetic', 'synthetic-secret', true],
    ['synthetic/team-app.test', 'synthetic', 'synthetic-secret', true],
    ['synthetic/auftragskompass', '', 'synthetic-secret', false],
    ['synthetic/auftragskompass', 'synthetic', '', false],
    ['', 'synthetic', 'synthetic-secret', false],
    [
      'synthetic/auftragskompass:latest',
      'synthetic',
      'synthetic-secret',
      false,
    ],
    ['docker.io/synthetic/app', 'synthetic', 'synthetic-secret', false],
    ['synthetic/app;exit 0', 'synthetic', 'synthetic-secret', false],
  ]) {
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { ...process.env, IMAGE: image, USERNAME: username, TOKEN: token },
      encoding: 'utf8',
    });
    assert.equal(result.status === 0, success, image);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-secret'));
  }
});

test('image publishing requires green quality gates, explicit registry configuration and a trusted push', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
  const publish = workflow.split('\n  images:\n')[1];
  assert.ok(publish, 'image publishing job missing');
  for (const required of [
    'needs: quality',
    "github.event_name == 'push'",
    "github.ref == 'refs/heads/main'",
    "github.ref == 'refs/heads/codex/local-runtime-ci'",
    "vars.DOCKERHUB_IMAGE != ''",
    'secrets.DOCKERHUB_TOKEN',
    'vars.DOCKERHUB_USERNAME',
    'context: .',
    'target: runtime',
    'target: admin',
    'platforms: linux/amd64',
    ':runtime-${{ github.sha }}',
    ':admin-${{ github.sha }}',
    'persist-credentials: false',
  ])
    assert.ok(publish.includes(required), required);
  assert.ok(!publish.includes(':latest'));
  for (const action of workflow.matchAll(/uses: (\S+)/g))
    assert.match(action[1], /@[a-f0-9]{40}$/);
});
