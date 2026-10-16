import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(`infrastructure/podman/${name}`, 'utf8');

test('Podman test services keep data and secrets isolated and publish only the loopback UI', () => {
  for (const service of ['database', 'worker', 'api', 'admin']) {
    const unit = read(`ak-test-${service}.container`);
    assert.ok(unit.includes(`ContainerName=ak-test-${service}`));
    assert.ok(unit.includes('Network=ak-test.network'));
    assert.ok(unit.includes('Notify=healthy'));
    assert.ok(unit.includes('HealthCmd='));
    assert.ok(unit.includes('Restart=always'));
    assert.ok(!unit.includes('AutoUpdate='));
    if (service === 'admin') {
      assert.ok(unit.includes('PublishPort=127.0.0.1:4177:8080'));
      assert.ok(unit.includes('REPLACE_IMAGE:admin-REPLACE_REVISION'));
    } else assert.ok(!unit.includes('PublishPort='));
    if (service === 'api' || service === 'worker') {
      assert.ok(unit.includes('User=1000:1000'));
      assert.ok(unit.includes('REPLACE_IMAGE:runtime-REPLACE_REVISION'));
      assert.ok(unit.includes('AK_BUILD_REVISION=REPLACE_REVISION'));
      assert.ok(unit.includes('AK_DB_HOST=database'));
      assert.ok(unit.includes('uid=1000,gid=1000,mode=0400'));
    }
  }
  assert.ok(
    read('ak-test-database.container').includes('Volume=ak-test-data.volume'),
  );
  assert.ok(read('ak-test-worker.container').includes('NetworkAlias=worker'));
  assert.ok(read('ak-test-api.container').includes('NetworkAlias=api'));
  assert.ok(read('ak-test-api.container').includes('AK_AUTH_ENABLED=true'));
  assert.ok(read('ak-test-data.volume').includes('VolumeName=ak-test-data'));
  assert.ok(read('ak-test.network').includes('NetworkName=ak-test'));
});
