import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('admin responses enforce local resources and reject framing and inline scripts', () => {
  const config = readFileSync('infrastructure/nginx.conf', 'utf8');
  const headers = Object.fromEntries(
    [
      ...config.matchAll(/add_header ([\w-]+) (?:"([^"]+)"|([^; ]+)) always;/g),
    ].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]),
  );
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  const policy = headers['content-security-policy'];
  assert.ok(policy);
  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
    assert.ok(
      policy
        .split(';')
        .map((s) => s.trim())
        .includes(directive),
    );
  assert.ok(!policy.includes('unsafe-inline'));
  assert.ok(!policy.includes('unsafe-eval'));
});

test('the app shell is revalidated after an update, assets and API keep theirs', () => {
  const config = readFileSync('infrastructure/nginx.conf', 'utf8');
  assert.match(config, /add_header Cache-Control \$ak_cache_control always;/);
  const map = config.match(/map \$uri \$ak_cache_control \{([^}]+)\}/)?.[1];
  assert.ok(map);
  assert.match(map, /default "no-cache";/);
  assert.match(map, /~\^\/assets\/ "";/);
  assert.match(map, /~\^\/\(api\|auth\|feeds\)\/ "";/);
});
