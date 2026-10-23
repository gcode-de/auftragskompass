import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// BKP004.1: the activation gate only protects real backlogs if every deployment
// template passes it through paused. `on` is always a deliberate operator edit.
test('deployment templates pass the drain activation through paused', async () => {
  const compose = await readFile('compose.yaml', 'utf8');
  const workerService = compose.slice(
    compose.indexOf('\n  worker:'),
    compose.indexOf('\n  admin:'),
  );
  assert.ok(workerService.includes('AK_INQUIRY_TENANT_ID'));
  assert.ok(workerService.includes('AK_INQUIRY_OPERATOR_ID'));
  assert.match(
    workerService,
    /AK_INQUIRY_OPTION_DRAIN: \$\{AK_INQUIRY_OPTION_DRAIN:-off\}/,
    'the Compose worker must default the automatic drain to off',
  );
  const quadlet = await readFile(
    'infrastructure/podman/ak-test-worker.container',
    'utf8',
  );
  assert.match(
    quadlet,
    /^Environment=AK_INQUIRY_OPTION_DRAIN=off$/m,
    'the worker quadlet must ship the gate explicitly paused',
  );
  assert.doesNotMatch(quadlet, /^Environment=AK_INQUIRY_OPTION_DRAIN=on$/m);
});
