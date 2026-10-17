"""Manual Linux Podman contract: fictional dump, encryption, authenticated open and restore."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
IMAGE = 'docker.io/library/postgres:17.6-alpine'


def run(command, **options):
    return subprocess.run(command, check=True, capture_output=True, **options).stdout


def main():
    memory = Path('/sys/fs/cgroup/memory.max')
    assert memory.exists(), 'Run on the native Linux Podman host'
    maximum = memory.read_text().strip()
    if maximum != 'max':
        assert int(maximum) - int(memory.with_name('memory.current').read_text()) > 512 * 1024 * 1024, 'Reserve memory for existing apps'
    assert shutil.disk_usage('/var/lib/containers').free > 1024 * 1024 * 1024, 'Reserve disk for existing apps'
    before = set(run(['podman', 'ps', '--format', '{{.Names}}']).decode().splitlines())
    prefix = 'akbackupcheck' + secrets.token_hex(5)
    projects = [prefix, prefix + 'restore']
    containers, volumes = [], []
    network = secret = False
    with tempfile.TemporaryDirectory(prefix='ak-backup-contract-') as directory:
        directory = Path(directory)
        backups = directory / 'backups'; backups.mkdir(mode=0o700)
        password = directory / 'database-password'; password.write_text(secrets.token_hex(32)); password.chmod(0o600)
        key, cert = directory / 'fictional.key', directory / 'fictional.pem'
        run(['openssl', 'req', '-newkey', 'rsa:3072', '-nodes', '-x509', '-days', '1', '-subj', '/CN=FictionalBackup', '-keyout', str(key), '-out', str(cert)])
        key.chmod(0o600); cert.chmod(0o600)
        recovery = directory / 'fictional-passphrase'; recovery.write_text('Fictional recovery passphrase\n'); recovery.chmod(0o600)
        try:
            run(['podman', 'image', 'exists', IMAGE])
            run(['podman', 'network', 'create', '--internal', prefix]); network = True
            run(['podman', 'secret', 'create', prefix, str(password)]); secret = True
            for project in projects:
                name, volume = project + '-database', project + '-data'
                assert subprocess.run(['podman', 'container', 'exists', name], capture_output=True).returncode == 1
                assert subprocess.run(['podman', 'volume', 'exists', volume], capture_output=True).returncode == 1
                run(['podman', 'volume', 'create', volume]); volumes.append(volume)
                containers.append(name)
                run(['podman', 'run', '-d', '--name', name, '--network', prefix, '--secret', prefix + ',type=mount,target=db_password,mode=0400',
                     '-e', 'POSTGRES_USER=ak', '-e', 'POSTGRES_DB=auftragskompass', '-e', 'POSTGRES_PASSWORD_FILE=/run/secrets/db_password',
                     '-v', volume + ':/var/lib/postgresql/data', IMAGE])
                for _ in range(60):
                    result = subprocess.run(['podman', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'ak', '-d', 'auftragskompass'], capture_output=True)
                    if result.returncode == 0: break
                    time.sleep(1)
                else: raise RuntimeError('Fictional PostgreSQL did not become ready')
            run(['podman', 'exec', projects[0] + '-database', 'psql', '-U', 'ak', '-d', 'auftragskompass', '-v', 'ON_ERROR_STOP=1', '-c',
                 "CREATE TABLE fictional_backup_proof(id integer PRIMARY KEY,note text NOT NULL); INSERT INTO fictional_backup_proof VALUES(1,'Fictional restored row');"])
            job = [sys.executable, '-B', str(ROOT / 'scripts/run_backup.py'), '--project', prefix, '--directory', str(backups), '--certificate', str(cert)]
            run(job)
            receipt = json.loads((backups / 'last-success.json').read_text())
            sealed = backups / receipt['file']
            assert receipt['ciphertextSha256'] == hashlib.sha256(sealed.read_bytes()).hexdigest()
            verified = directory / 'verified.dump'
            run([sys.executable, '-B', str(ROOT / 'scripts/seal_backup.py'), 'decrypt', '--input', str(sealed), '--output', str(verified),
                 '--private-key', str(key), '--key-password-file', str(recovery)])
            assert receipt['plaintextSha256'] == hashlib.sha256(verified.read_bytes()).hexdigest()
            run([sys.executable, '-B', str(ROOT / 'scripts/backup_restore.py'), 'restore', '--runtime', 'podman', '--project', projects[1], '--file', str(verified)])
            restored = run(['podman', 'exec', projects[1] + '-database', 'psql', '-U', 'ak', '-d', 'auftragskompass', '-Atc', 'SELECT note FROM fictional_backup_proof']).decode().strip()
            assert restored == 'Fictional restored row'
            previous = (backups / 'last-success.json').read_bytes()
            sys.path.insert(0,str(ROOT/'scripts'))
            import run_backup
            real_hash = run_backup.hash_file
            def bounded_hash(path):
                assert path.stat().st_size <= 1024, 'Child exceeded its temporary-file budget'
                return real_hash(path)
            with patch.object(run_backup.shutil,'disk_usage',return_value=type('Usage',(),{'free':512*1024*1024+2048})()), \
                    patch.object(run_backup,'hash_file',side_effect=bounded_hash), \
                    patch('sys.argv',[str(ROOT/'scripts/run_backup.py'),*job[3:]]), \
                    contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                try: run_backup.main()
                except SystemExit as error: assert error.code != 0
                else: raise AssertionError('Insufficient file budget was accepted')
            assert (backups/'last-success.json').read_bytes() == previous
            assert len(list(backups.glob('*.cms'))) == 1
            run(['podman', 'stop', projects[0] + '-database'])
            assert subprocess.run(job, capture_output=True).returncode != 0
            assert (backups / 'last-success.json').read_bytes() == previous
            assert json.loads((backups / 'last-attempt.json').read_text())['status'] == 'failed'
            assert not any(path.is_dir() for path in backups.iterdir())
        finally:
            cleanup = [['podman','rm','-f',name] for name in reversed(containers)]
            cleanup += [['podman','volume','rm',volume] for volume in reversed(volumes)]
            if secret: cleanup.append(['podman','secret','rm',prefix])
            if network: cleanup.append(['podman','network','rm',prefix])
            failures = [command[-1] for command in cleanup if subprocess.run(command,capture_output=True).returncode]
            if failures: raise RuntimeError('Scratch cleanup failed: ' + ', '.join(failures))
    assert set(run(['podman', 'ps', '--format', '{{.Names}}']).decode().splitlines()) == before
    print(json.dumps({'native_scheduled_backup': 'passed', 'restored_fictional_row': True, 'failed_retry_preserved_success': True, 'file_limit_enforced': True,
                      'scratch_resources': 'removed', 'existing_applications_changed': False}))


if __name__ == '__main__':
    main()
