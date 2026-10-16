import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureRepository } from '../../scripts/dockerhub.mjs';

const env = {
  DOCKERHUB_USER: 'synthetic',
  DOCKERHUB_TOKEN: 'synthetic-secret',
  DOCKERHUB_VISIBILITY: 'public',
};
const response = (status, data = {}) =>
  new Response(JSON.stringify(data), { status });

test('Docker Hub creates the fixed public repository only after authenticated 404', async () => {
  const calls = [];
  const responses = [
    response(200, { access_token: 'synthetic-jwt' }),
    response(404),
    response(201),
  ];
  await ensureRepository(env, async (url, options) => {
    calls.push({ url, ...options });
    return responses.shift();
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://hub.docker.com/v2/auth/token');
  assert.deepEqual(JSON.parse(calls[0].body), {
    identifier: 'synthetic',
    secret: 'synthetic-secret',
  });
  assert.equal(
    calls[1].url,
    'https://hub.docker.com/v2/namespaces/synthetic/repositories/auftragskompass',
  );
  assert.equal(calls[2].method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].body), {
    namespace: 'synthetic',
    name: 'auftragskompass',
    registry: 'docker.io',
    is_private: false,
  });
  for (const call of calls) {
    assert.equal(call.redirect, 'error');
    assert.ok(call.signal);
  }
});

test('Docker Hub preserves existing repositories and refuses wrong visibility or failed requests', async () => {
  for (const [statuses, failure] of [
    [
      [
        response(200, { access_token: 'synthetic-jwt' }),
        response(200, { is_private: false }),
      ],
      false,
    ],
    [
      [
        response(200, { access_token: 'synthetic-jwt' }),
        response(200, { is_private: true }),
      ],
      true,
    ],
    [[response(401)], true],
    [[response(200)], true],
    [[response(200, { access_token: 'synthetic-jwt' }), response(403)], true],
    [[response(200, { access_token: 'synthetic-jwt' }), response(500)], true],
    [
      [
        response(200, { access_token: 'synthetic-jwt' }),
        response(404),
        response(403),
      ],
      true,
    ],
  ]) {
    const operation = ensureRepository(env, async () => statuses.shift());
    if (failure) await assert.rejects(operation);
    else await operation;
    assert.equal(statuses.length, 0);
  }
  for (const key of Object.keys(env))
    await assert.rejects(
      ensureRepository({ ...env, [key]: '' }, () =>
        assert.fail('unexpected network call'),
      ),
    );
});
