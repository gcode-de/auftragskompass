"""Manual Linux smoke test with disposable synthetic data and published images."""
import argparse
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def run(*command):
    return subprocess.check_output(command, stderr=subprocess.PIPE).decode().strip()


def wait_for(check):
    for _ in range(90):
        try:
            if check():
                return
        except (subprocess.CalledProcessError, OSError):
            pass
        time.sleep(1)
    raise RuntimeError('Synthetic service did not become ready')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-image', required=True)
    parser.add_argument('--admin-image', required=True)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    for image in [args.runtime_image, args.admin_image]:
        if not re.fullmatch(r'docker\.io/[a-z0-9]+/[a-z0-9._-]+@sha256:[a-f0-9]{64}', image):
            parser.error('Use a Docker Hub image pinned by SHA-256 digest')
    if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
        parser.error('Use the full source commit hash')

    prefix = 'akcheck' + secrets.token_hex(5)
    target = prefix + 'restore'
    containers = []
    volumes = []
    network = None
    secret = None
    with tempfile.TemporaryDirectory(prefix='ak-podman-') as directory:
        directory = Path(directory)
        password = directory / 'password'
        password.write_text(secrets.token_hex(32))
        password.chmod(0o600)
        try:
            print('Pulling pinned images for the synthetic Podman check', flush=True)
            for image in [args.runtime_image, args.admin_image, 'docker.io/library/postgres:17.6-alpine']:
                run('podman', 'pull', image)
            run('podman', 'network', 'create', prefix)
            network = prefix
            run('podman', 'secret', 'create', prefix, str(password))
            secret = prefix

            def start(name, image, options, command=()):
                # Only names absent before this test are eligible for cleanup.
                exists = subprocess.run(['podman', 'container', 'exists', name],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                assert exists.returncode == 1, 'Container name already exists or cannot be checked'
                containers.append(name)
                run('podman', 'run', '-d', '--name', name, '--network', network,
                    *options, image, *command)

            for project, alias in [(prefix, 'database'), (target, 'restore-database')]:
                exists = subprocess.run(['podman', 'volume', 'exists', project + '-data'],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                assert exists.returncode == 1, 'Volume name already exists or cannot be checked'
                volume = run('podman', 'volume', 'create', project + '-data')
                volumes.append(volume)
                start(project + '-database', 'docker.io/library/postgres:17.6-alpine', [
                    '--network-alias', alias,
                    '--secret', secret + ',type=mount,target=db_password,mode=0400',
                    '-e', 'POSTGRES_USER=ak', '-e', 'POSTGRES_DB=auftragskompass',
                    '-e', 'POSTGRES_PASSWORD_FILE=/run/secrets/db_password',
                    '-v', volume + ':/var/lib/postgresql/data',
                ])
                wait_for(lambda project=project: 'accepting connections' in run(
                    'podman', 'exec', project + '-database', 'pg_isready', '-U', 'ak', '-d', 'auftragskompass'))

            common = ['--user', '1000:1000', '--security-opt', 'no-new-privileges',
                      '--secret', secret + ',type=mount,target=db_password,uid=1000,gid=1000,mode=0400']
            for key, value in {'AK_DB_HOST': 'database', 'AK_DB_NAME': 'auftragskompass',
                               'AK_DB_USER': 'ak', 'AK_DB_PASSWORD_FILE': '/run/secrets/db_password',
                               'AK_HOST': '0.0.0.0', 'AK_BUILD_REVISION': args.revision}.items():
                common += ['-e', key + '=' + value]
            print('Starting worker and API with business endpoints closed', flush=True)
            for service, port in [('worker', '3001'), ('api', '3000')]:
                start(prefix + '-' + service, args.runtime_image,
                      common + ['--network-alias', service, '-e', 'AK_PORT=' + port,
                                '-e', 'AK_AUTH_ENABLED=false'],
                      ['node', 'apps/' + service + '/dist/main.js'])
                wait_for(lambda service=service, port=port: run(
                    'podman', 'exec', prefix + '-' + service, 'node', '-e',
                    "fetch('http://127.0.0.1:" + port + "/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))") == '')
                assert run('podman', 'exec', prefix + '-' + service, 'id', '-u') == '1000'

            start(prefix + '-admin', args.admin_image, ['-p', '127.0.0.1::8080'])
            address = run('podman', 'port', prefix + '-admin', '8080')
            assert address.startswith('127.0.0.1:')
            def frontend_ready():
                with urllib.request.urlopen('http://' + address, timeout=3) as response:
                    return 'AuftragsKompass' in response.read().decode()
            wait_for(frontend_ready)
            try:
                urllib.request.urlopen('http://' + address + '/api/v1/events', timeout=3)
                raise AssertionError('Business endpoint unexpectedly accessible')
            except urllib.error.HTTPError as error:
                assert error.code == 503

            def sql(project, statement):
                return run('podman', 'exec', project + '-database', 'psql', '-U', 'ak',
                           '-d', 'auftragskompass', '-Atc', statement)

            sql(prefix, "CREATE TABLE synthetic_backup_check (label text); INSERT INTO synthetic_backup_check VALUES ('Synthetic Podman restore record')")
            dump = directory / 'synthetic.dump'
            tool = [sys.executable, str(ROOT / 'scripts/backup_restore.py')]
            def backup(mode, project):
                return run(*tool, mode, '--runtime', 'podman', '--project', project, '--file', str(dump))
            def refuses(mode, project, reason):
                try:
                    backup(mode, project)
                    raise AssertionError('Unsafe operation unexpectedly accepted')
                except subprocess.CalledProcessError as error:
                    assert reason in error.stderr.decode()

            print('Checking backup, writer guards, restart and isolated restore', flush=True)
            backup('backup', prefix)
            assert dump.stat().st_mode & 0o777 == 0o600
            assert dump.read_bytes().startswith(b'PGDMP')
            refuses('backup', prefix, 'overwrite')
            refuses('restore', prefix, 'API and worker stopped')
            backup('restore', target)
            query = 'SELECT label FROM synthetic_backup_check'
            assert sql(target, query) == 'Synthetic Podman restore record'
            refuses('restore', target, 'empty database')
            run('podman', 'restart', target + '-database')
            wait_for(lambda: 'accepting connections' in run('podman', 'exec', target + '-database', 'pg_isready', '-U', 'ak'))
            assert sql(target, query) == sql(prefix, query)
            assert json.loads(run('podman', 'inspect', prefix + '-api'))[0]['HostConfig']['PortBindings'] in (None, {})
            print('Published images, closed API and backup/restore passed', flush=True)
        finally:
            failures = []
            for command in ([['podman', 'rm', '-f', name] for name in reversed(containers)] +
                            [['podman', 'volume', 'rm', name] for name in volumes] +
                            ([['podman', 'secret', 'rm', secret]] if secret else []) +
                            ([['podman', 'network', 'rm', network]] if network else [])):
                result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                if result.returncode:
                    failures.append(command[-1])
            if failures:
                raise RuntimeError('Remove remaining synthetic resources: ' + ', '.join(failures))
            print('Synthetic containers, volumes, network and secret removed', flush=True)


if __name__ == '__main__':
    main()
