import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const core = createRequire(
  new URL('../../packages/core/package.json', import.meta.url),
);
const sanitizer = createRequire(core.resolve('sanitize-html'));
const css = createRequire(sanitizer.resolve('postcss'));
const { SourceMapConsumer } = css('source-map-js');

// CVE-2026-93749: check the actual runtime chain without executing the amplification.
test('runtime CSS source maps reject oversized section offsets before mapping work', () => {
  assert.throws(
    () =>
      new SourceMapConsumer({
        version: 3,
        sections: [
          {
            offset: { line: 100000000, column: 0 },
            map: {
              version: 3,
              sources: ['fictional.ts'],
              names: [],
              mappings: 'AAAA',
            },
          },
        ],
      }),
  );
  const valid = new SourceMapConsumer({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: {
          version: 3,
          sources: ['fictional.ts'],
          names: [],
          mappings: 'AAAA',
        },
      },
    ],
  });
  assert.deepEqual(valid.sources, ['fictional.ts']);
  const plain = new SourceMapConsumer({
    version: 3,
    sources: ['fictional.ts'],
    names: [],
    mappings: 'AAAA',
  });
  assert.equal(
    plain.originalPositionFor({ line: 1, column: 0 }).source,
    'fictional.ts',
  );
});
