import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
const execFile = promisify(execFileCallback);

test(
  'clean Compose boot, persistent database, backup and isolated restore',
  { timeout: 600000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ak-compose-'));
    const project = `aktest${randomBytes(6).toString('hex')}`;
    const target = `${project}restore`;
    const envFile = join(dir, '.env');
    const passwordFile = join(dir, 'db-password');
    await writeFile(passwordFile, randomBytes(32).toString('hex'), {
      mode: 0o600,
    });
    await writeFile(
      envFile,
      `AK_DB_PASSWORD_FILE=${passwordFile}\nAK_ADMIN_PORT=0\nAK_API_PORT=0\nAK_UID=${process.getuid()}\nAK_GID=${process.getgid()}\n`,
      { mode: 0o600 },
    );
    const run = async (program, args) =>
      (await execFile(program, args, { maxBuffer: 8 * 1024 * 1024 })).stdout;
    const composeArgs = (name) => [
      'compose',
      '--env-file',
      envFile,
      '-p',
      name,
      '-f',
      'compose.yaml',
    ];
    const compose = (name, args) =>
      run('docker', [...composeArgs(name), ...args]);
    const fixture = await readFile('tests/ops/restore_probe.mjs', 'utf8');
    const domainProbe = (name, mode) =>
      spawnSync(
        'docker',
        [
          ...composeArgs(name),
          'run',
          '--rm',
          '--no-deps',
          '-T',
          'api',
          'node',
          '--input-type=module',
          '-',
          mode,
          'database',
        ],
        {
          input: fixture,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );

    const sql = (name, query) =>
      compose(name, [
        'exec',
        '-T',
        'database',
        'psql',
        '-U',
        'ak',
        '-d',
        'auftragskompass',
        '-Atc',
        query,
      ]);
    try {
      await compose(project, [
        'up',
        '-d',
        '--build',
        '--wait',
        '--wait-timeout',
        '120',
      ]);
      const raw = await compose(project, ['ps', '--format', 'json']);
      const state = raw.trim().startsWith('[')
        ? JSON.parse(raw)
        : raw
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
      const services = Array.isArray(state) ? state : [state];
      assert.equal(services.length, 4);
      for (const service of services) assert.equal(service.Health, 'healthy');
      await compose(project, [
        'exec',
        '-T',
        'api',
        'node',
        '--input-type=module',
        '-e',
        "import { readFile } from 'node:fs/promises'; for (const name of ['gateway-0001-receipts.sql','gateway-0002-inquiries.sql']) await readFile('/app/packages/core/gateway-migrations/' + name, 'utf8');",
      ]);
      const adminAddress = (
        await compose(project, ['port', 'admin', '8080'])
      ).trim();
      for (const path of [
        '/',
        '/api/v1/contacts',
        '/feeds/v1/fictional.ics',
        '/missing-route',
      ]) {
        const response = await fetch(`http://${adminAddress}${path}`);
        assert.equal(response.headers.get('x-frame-options'), 'DENY');
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.ok(
          response.headers
            .get('content-security-policy')
            ?.includes("frame-ancestors 'none'"),
        );
      }
      const address = (await compose(project, ['port', 'api', '3000'])).trim();
      await compose(project, ['stop', 'worker']);
      const unavailable = await fetch(`http://${address}/health/ready`);
      assert.equal(unavailable.status, 503);
      assert.equal((await unavailable.json()).dependencies.worker, 'down');
      assert.equal((await fetch(`http://${address}/health/live`)).status, 200);
      await compose(project, ['up', '-d', '--wait']);
      await sql(
        project,
        "CREATE TABLE synthetic_example (label text); INSERT INTO synthetic_example VALUES ('Synthetic backup record')",
      );
      const seeded = domainProbe(project, 'seed');
      assert.equal(seeded.status, 0, seeded.stderr);
      await compose(project, ['down']);
      await compose(project, ['up', '-d', '--wait']);
      assert.equal(
        (await sql(project, 'SELECT label FROM synthetic_example')).trim(),
        'Synthetic backup record',
      );
      const dump = join(dir, 'synthetic.dump');
      await run('python3', [
        'scripts/backup_restore.py',
        'backup',
        '--env-file',
        envFile,
        '--project',
        project,
        '--file',
        dump,
      ]);
      await assert.rejects(
        run('python3', [
          'scripts/backup_restore.py',
          'backup',
          '--env-file',
          envFile,
          '--project',
          project,
          '--file',
          dump,
        ]),
      );
      await compose(target, ['up', '-d', 'database', '--wait']);
      const missing = domainProbe(target, 'verify');
      assert.notEqual(missing.status, 0);
      assert.ok(missing.stderr.includes('Synthetic restore schema missing'));

      await run('python3', [
        'scripts/backup_restore.py',
        'restore',
        '--env-file',
        envFile,
        '--project',
        target,
        '--file',
        dump,
      ]);
      assert.equal(
        (await sql(target, 'SELECT label FROM synthetic_example')).trim(),
        'Synthetic backup record',
      );
      const verified = domainProbe(target, 'verify');
      assert.equal(verified.status, 0, verified.stderr);
      await assert.rejects(
        run('python3', [
          'scripts/backup_restore.py',
          'restore',
          '--env-file',
          envFile,
          '--project',
          target,
          '--file',
          dump,
        ]),
      );
    } finally {
      await Promise.allSettled(
        [project, target].map((name) =>
          compose(name, ['down', '-v', '--remove-orphans']),
        ),
      );
      await rm(dir, { recursive: true, force: true });
    }
  },
);
