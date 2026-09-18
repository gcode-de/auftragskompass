import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
      `AK_DB_PASSWORD_FILE=${passwordFile}\nAK_ADMIN_PORT=0\nAK_API_PORT=0\n`,
      { mode: 0o600 },
    );
    const run = async (program, args) =>
      (await execFile(program, args, { maxBuffer: 8 * 1024 * 1024 })).stdout;
    const compose = (name, args) =>
      run('docker', [
        'compose',
        '--env-file',
        envFile,
        '-p',
        name,
        '-f',
        'compose.yaml',
        ...args,
      ]);
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
      await sql(
        project,
        "CREATE TABLE synthetic_example (label text); INSERT INTO synthetic_example VALUES ('Synthetic backup record')",
      );
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
