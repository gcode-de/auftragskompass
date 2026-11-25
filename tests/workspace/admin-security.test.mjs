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
  assert.equal(headers['x-frame-options'], '$ak_frame_options');
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
    "frame-src 'self'",
    'frame-ancestors $ak_frame_ancestors',
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

// The delivery dialog embeds the frozen document PDF. Only that route may be
// framed, and only by the admin itself; every other path stays unframeable.
test('only the document PDF route may be framed, and only by the same origin', () => {
  const config = readFileSync('infrastructure/nginx.conf', 'utf8');
  const entries = (name) => {
    const body = config.match(
      new RegExp('map \\$uri \\$' + name + ' \\{([^}]+)\\}'),
    )?.[1];
    assert.ok(body, name);
    return [...body.matchAll(/^\s*(\S+)\s+(?:"([^"]*)"|(\S*));/gm)].map((m) => [
      m[1],
      m[2] ?? m[3],
    ]);
  };
  const pdf = '~^/api/v1/documents/[0-9a-f-]+/pdf$';
  assert.deepEqual(entries('ak_frame_options'), [
    ['default', 'DENY'],
    [pdf, 'SAMEORIGIN'],
  ]);
  assert.deepEqual(entries('ak_frame_ancestors'), [
    ['default', "'none'"],
    [pdf, "'self'"],
  ]);
  const route = new RegExp(pdf.slice(1));
  assert.ok(
    route.test('/api/v1/documents/0b6f6a1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/pdf'),
  );
  for (const other of [
    '/',
    '/api/v1/documents/0b6f6a1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
    '/api/v1/document-layout/preview',
    '/api/v1/documents/x/pdf/../../events',
    '/api/v1/library-files/0b6f6a1e/pdf',
  ])
    assert.ok(!route.test(other), other);
});
